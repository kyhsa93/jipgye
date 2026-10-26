import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MATURE_SHARE, registrationStats, withoutCorrections } from "../scripts/cancellation.ts";
import { byCell, measure, toDeal } from "../scripts/record-high.ts";
import {
  REGISTRATION_NAME,
  buildRegistrationPayload,
  diffInterval,
  outcomeOf,
  outcomeStats,
  quantile,
  recordClasses,
  recordComparison,
  registrationFile,
  writeRegistrationSoft,
} from "../scripts/registration.ts";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-26T00:00:00Z");
const short = (y, m, d) => `${String(y).slice(2)}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;

/** 원본 한 줄. date "2025-01-05", amount 만원, rgst 는 계약 뒤 날 수(null 이면 등기일자 없음). */
function item(apt, date, amount, { rgst = 60, cancel = false, gbn = "중개거래", gu = 11680 } = {}) {
  const [y, m, d] = date.split("-").map(Number);
  const r = rgst === null ? null : new Date(Date.UTC(y, m - 1, d) + rgst * 86400000);
  return {
    sggCd: gu,
    umdNm: "동",
    jibun: "1",
    aptNm: apt,
    excluUseAr: 84,
    floor: 5,
    dealYear: y,
    dealMonth: m,
    dealDay: d,
    dealAmount: amount.toLocaleString("en-US"),
    dealingGbn: gbn,
    rgstDate: r ? short(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate()) : "",
    cdealType: cancel ? "O" : "",
    cdealDay: cancel ? short(y, m, d + 1) : "",
  };
}

// 익은 달 2025-01~08(모두 등기일자), 덜 익은 달 2025-09(열에 둘만 등기일자).
const filler = [];
for (let m = 1; m <= 8; m += 1) for (let i = 0; i < 10; i += 1) filler.push(item(`채움${m}-${i}`, `2025-0${m}-10`, 40_000 + i, { rgst: 30 + i * 10 }));
for (let i = 0; i < 10; i += 1) filler.push(item(`덜${i}`, "2025-09-10", 40_000, { rgst: i < 2 ? 20 : null }));

// 한 칸(A): 선행 셋(01-05·02-05·03-05) 뒤 180일 넘은 08-01 은 신고가, 08-02 는 나머지, 08-03 해제 건은 이력 최고가 넘어 신고가.
const cellA = [
  item("A", "2025-01-05", 50_000),
  item("A", "2025-02-05", 51_000),
  item("A", "2025-03-05", 52_000),
  item("A", "2025-08-01", 60_000),
  item("A", "2025-08-02", 50_000, { rgst: null }),
  item("A", "2025-08-03", 70_000, { rgst: null, cancel: true }),
  item("A", "2025-08-04", 80_000, { gbn: "직거래" }),
];
// 정정: 해제 기록이 해제 표시 없이 그대로 다시 있다 - 해제에서 빠지고 짝만 남는다.
const twin = item("B", "2025-05-10", 45_000);
const correction = { ...twin, cdealType: "O", cdealDay: "25.05.20", rgstDate: "" };
const FIXTURE = [...filler, ...cellA, twin, correction];

test("세 갈래는 겹치지 않는다 - 해제가 먼저, 그다음 등기일자 기록", () => {
  assert.equal(outcomeOf(item("x", "2025-01-01", 1, { cancel: true })), "cancelled");
  assert.equal(outcomeOf(item("x", "2025-01-01", 1)), "registered");
  assert.equal(outcomeOf(item("x", "2025-01-01", 1, { rgst: null })), "neither");
  const s = outcomeStats(cellA, 1);
  assert.equal(s.registered + s.cancelled + s.neither, s.n);
});

test("정정은 먼저 뺀다 - 해제 수에 들지 않고, 짝 하나만 남는다", () => {
  const p = buildRegistrationPayload({ items: FIXTURE, now: NOW });
  assert.deepEqual(p.corrections, { reportedCancellations: 2, removed: 1 });
  // 남은 해제는 A 칸 08-03 하나뿐.
  assert.equal(p.seoul.cancelled, 1);
  assert.equal(p.seoul.n, FIXTURE.length - 1 - 10);
});

test("익은 달은 cancellation.ts 의 MATURE_SHARE 정의 그대로, 덜 익은 달은 달·건수만 「확정 전」", () => {
  assert.equal(MATURE_SHARE, 0.8);
  const p = buildRegistrationPayload({ items: FIXTURE, now: NOW });
  const expected = registrationStats(withoutCorrections(FIXTURE).items).matureMonths;
  assert.deepEqual(p.matureMonths, expected);
  assert.ok(!p.matureMonths.includes("2025-09"));
  assert.deepEqual(p.pending, [{ month: "2025-09", deals: 10 }]);
  assert.deepEqual(Object.keys(p.pending[0]), ["month", "deals"]); // 비율 없음
  assert.equal(buildRegistrationPayload({ items: filler.slice(-10), now: NOW }), null); // 익은 달 없음
});

test("p90 은 가장 가까운 순위, 중앙값은 registrationStats 의 걸린 날과 같다", () => {
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(quantile([5], 0.9), 5);
  assert.equal(quantile([], 0.9), null);
  const kept = withoutCorrections(FIXTURE).items;
  const reg = registrationStats(kept);
  const mature = new Set(reg.matureMonths);
  // 픽스처는 서울 n 이 문턱(100) 아래라 문턱 1 로 같은 무리를 센다.
  const s = outcomeStats(kept.filter((i) => mature.has(`${i.dealYear}-${String(i.dealMonth).padStart(2, "0")}`)), 1);
  assert.equal(s.medianDays, reg.medianDays);
  assert.ok(s.p90Days > s.medianDays);
  assert.equal(buildRegistrationPayload({ items: FIXTURE, now: NOW }).seoul.p90Days, null); // 문턱 미달
});

test("구 행은 MIN_DEALS(100) 미달이면 비율·날을 비우고 건수만", () => {
  const p = buildRegistrationPayload({ items: FIXTURE, now: NOW });
  assert.equal(p.districts.length, 25);
  const gangnam = p.districts.find((d) => d.code === "11680");
  assert.equal(gangnam.n, p.seoul.n);
  assert.equal(gangnam.registeredShare, null);
  assert.equal(gangnam.p90Days, null);
});

test("신고가는 record-high.ts 규칙 - 해제 건도 같은 이력에 견주고, 해제 안 된 신고가 수는 measure() 와 같다", () => {
  const kept = withoutCorrections(FIXTURE).items;
  const classes = recordClasses(kept);
  const of = (date) => classes.get(kept.find((i) => i.aptNm === "A" && `${i.dealYear}-0${i.dealMonth}-0${i.dealDay}` === date));
  assert.equal(of("2025-01-05"), undefined); // 선행 부족
  assert.equal(of("2025-08-01"), "record");
  assert.equal(of("2025-08-02"), "rest");
  assert.equal(of("2025-08-03"), "record"); // 해제 건
  assert.equal(of("2025-08-04"), undefined); // 직거래
  const live = [...classes].filter(([i, c]) => c === "record" && toDeal(i)).length;
  assert.equal(live, measure(byCell(kept.map(toDeal).filter(Boolean)), Infinity, { wait: 0 }).records);
});

test("신고가 vs 나머지: 문턱 미달이면 차이를 내지 않고, 90% 구간이 0 을 품으면 「차이 없음」", () => {
  const thin = recordComparison([item("x", "2025-01-01", 1)], [item("y", "2025-01-01", 1)]);
  assert.equal(thin.enough, false);
  assert.equal(thin.diff.cancelled, null);
  const mk = (n, cancelled) => Array.from({ length: n }, (_, i) => item(`r${i}`, "2025-01-01", 1, { cancel: i < cancelled }));
  const same = recordComparison(mk(200, 4), mk(400, 8));
  assert.equal(same.enough, true);
  assert.equal(same.diff.cancelled.verdict, "none");
  const apart = recordComparison(mk(1000, 100), mk(1000, 10));
  assert.equal(apart.diff.cancelled.verdict, "higher");
  const d = diffInterval(100, 1000, 10, 1000);
  assert.ok(d.lo > 0 && d.hi < 0.2 && d.lo < d.diff && d.diff < d.hi);
});

test("재계산 동일성 - 같은 원본이면 같은 결과", () => {
  const a = buildRegistrationPayload({ items: FIXTURE, now: NOW });
  const b = buildRegistrationPayload({ items: [...FIXTURE].reverse(), now: NOW });
  assert.deepEqual(a, b);
});

const tmpDir = () => mkdtemp(path.join(os.tmpdir(), "registration-"));

test("출력 경로: 기본은 docs/data/registration.json, 다른 이름은 거절", async () => {
  if (!process.env.REGISTRATION_FILE) assert.equal(registrationFile, path.join(root, "docs/data", REGISTRATION_NAME));
  const dir = await tmpDir();
  try {
    const logs = [];
    assert.equal(await writeRegistrationSoft({ items: FIXTURE, now: NOW, file: path.join(dir, REGISTRATION_NAME), log: (s) => logs.push(s) }), true);
    assert.deepEqual(await readdir(dir), [REGISTRATION_NAME]);
    assert.equal(await writeRegistrationSoft({ items: FIXTURE, now: NOW, file: path.join(dir, "cancellation.json"), log: (s) => logs.push(s) }), false);
    assert.deepEqual(await readdir(dir), [REGISTRATION_NAME]);
    assert.match(logs.at(-1), /^::warning::.*허용되지 않은 출력 경로/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("soft-fail: 생성이 던지거나 익은 달이 없어도 ::warning·안내만 남기고 이전 파일을 그대로 둔다", async () => {
  const dir = await tmpDir();
  try {
    const file = path.join(dir, REGISTRATION_NAME);
    await writeFile(file, "PREVIOUS");
    const logs = [];
    const boom = () => {
      throw new Error("boom");
    };
    assert.equal(await writeRegistrationSoft({ items: FIXTURE, now: NOW, file, log: (s) => logs.push(s), build: boom }), false);
    assert.match(logs.at(-1), /^::warning::등기·해제 비율 생성 실패 - 이전 파일을 그대로 둡니다: boom/);
    assert.equal(await writeRegistrationSoft({ items: [], now: NOW, file, log: (s) => logs.push(s) }), false);
    assert.equal(await readFile(file, "utf8"), "PREVIOUS");
    assert.deepEqual(await readdir(dir), [REGISTRATION_NAME]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Daily 등록은 build-district-change 안 soft-fail 호출 하나 - 갈아타기 계산보다 먼저 부른다", async () => {
  const src = await readFile(path.join(root, "scripts/build-district-change.ts"), "utf8");
  assert.equal([...src.matchAll(/writeRegistrationSoft\(/g)].length, 1);
  assert.ok(src.indexOf("await writeRegistrationSoft(") < src.indexOf("const payload = buildPayload("));
});

test("공개 파일: 8 KB 이하, 집계만(단지·지번·동 0), 「둘 다 없음」 사유는 모름", async () => {
  const body = await readFile(path.join(root, "docs/data", REGISTRATION_NAME), "utf8");
  assert.ok(Buffer.byteLength(body) <= 8 * 1024, `${Buffer.byteLength(body)} B`);
  assert.doesNotMatch(body, /aptNm|jibun|umdNm|"cell"|\d{5}\|/);
  assert.doesNotMatch(body, /허위/);
  const p = JSON.parse(body);
  assert.deepEqual(Object.keys(p), ["updatedAt", "basis", "corrections", "matureMonths", "pending", "seoul", "districts", "records"]);
  assert.equal(p.basis.neitherReason, "unknown");
  assert.match(p.basis.registered, /등기일자/);
  assert.equal(p.districts.length, 25);
  for (const d of p.districts) assert.deepEqual(Object.keys(d).slice(0, 2), ["code", "name"]);
});
