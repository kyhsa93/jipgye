// 이번 주 새로 신고된 거래(#703 W1) 계산. 저장소의 raw·docs/data 는 읽지 않는다 - 고정 입력만(데이터 날짜에 따라 갈리는 시험 금지).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addDays, buildDigest, gapDays, recordVerdict, saleCells, summarizeWindow, uniqueArrivals, windows } from "../scripts/week-digest.ts";
import { buildWeekDigest } from "../scripts/build-week-digest.ts";
import { itemKey } from "../scripts/realestate-raw.ts";

const END = "2026-10-25";
const NOW = new Date("2026-10-25T23:30:00Z");

const sale = (over = {}) => ({
  aptNm: "가단지", sggCd: 11350, excluUseAr: 84.9, floor: 5, dealingGbn: "중개거래", cdealType: "", cdealDay: "",
  dealAmount: "100,000", dealYear: 2026, dealMonth: 10, dealDay: 10, ...over,
});
const rent = (over = {}) => ({ aptNm: "나단지", sggCd: 11500, excluUseAr: 59, deposit: "50,000", monthlyRent: 0, dealYear: 2026, dealMonth: 10, dealDay: 3, ...over });

let seq = 0;
const row = (kind, day, item, district = String(item.sggCd)) => ({ kind, district, key: `k${(seq += 1)}`, day, item });

/** from~to 모든 날에 전월세 도착 1건(수집일 표지), skip 날은 뺀다. */
function filler(from, to, skip = []) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!skip.includes(d)) out.push(row("rent", d, rent({ dealDay: 1 })));
  return out;
}

test("창: 끝 날 포함 7일과 직전 7일, 가드는 직전 창 시작 전날부터", () => {
  const w = windows(END);
  assert.deepEqual(w.current, { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(w.previous, { from: "2026-10-12", to: "2026-10-18" });
  assert.equal(w.guardFrom, "2026-10-11");
  // 월 경계
  assert.deepEqual(windows("2026-11-03").previous, { from: "2026-10-21", to: "2026-10-27" });
});

test("고유 키: 같은 내용 줄 셋은 한 건, 도착 기록 없는 파일은 빠진다", () => {
  const item = sale({ dealingGbn: "직거래" });
  const other = sale({ floor: 9 });
  const slots = [
    { kind: "sale", district: "11350", items: [item, { ...item }, { ...item }, other], arrivals: { [itemKey(item)]: "2026-10-20", [itemKey(other)]: "2026-10-01" } },
    { kind: "sale", district: "11500", items: [sale({ sggCd: 11500 })], arrivals: null },
  ];
  const rows = uniqueArrivals(slots, itemKey);
  assert.equal(rows.length, 2);
  const s = summarizeWindow(rows, windows(END).current, new Map(), []);
  assert.equal(s.sale, 1, "행 3줄이 아니라 고유 키 1건");
  assert.equal(s.direct, 1);
  assert.equal(s.directShare, 100);
});

test("가드: 공백 없는 두 주만 비교한다", () => {
  const rows = filler("2026-10-11", END);
  const d = buildDigest({ rows, saleItems: [], now: NOW });
  assert.equal(d.asOf, END);
  assert.deepEqual(d.gaps, []);
  assert.equal(d.comparable, true);
  // 가드 범위 밖(10-10) 공백은 상관없다.
  const before = buildDigest({ rows: [...filler("2026-10-01", "2026-10-09"), ...filler("2026-10-11", END)], saleItems: [], now: NOW });
  assert.equal(before.comparable, true);
});

test("가드: 이번 창 안 공백(10-23 형)이면 비교 억제", () => {
  const d = buildDigest({ rows: filler("2026-10-11", END, ["2026-10-23"]), saleItems: [], now: NOW });
  assert.deepEqual(d.gaps, ["2026-10-23"]);
  assert.equal(d.comparable, false);
});

test("가드: 직전 창 시작 전날 공백(10-11 형)이면 비교 억제 - 그 다음 날에 몰린다", () => {
  const d = buildDigest({ rows: filler("2026-10-11", END, ["2026-10-11"]), saleItems: [], now: NOW });
  assert.deepEqual(d.gaps, ["2026-10-11"]);
  assert.equal(d.comparable, false);
  assert.deepEqual(gapDays(new Set(["2026-10-12"]), "2026-10-12").length, 14, "추적 시작 전은 전부 공백");
});

test("신고가: 선행 3건·180일 칸만 판정, 이전 최고 초과만 신고가, 직거래·해제는 판정 밖", () => {
  const history = [
    sale({ dealYear: 2025, dealMonth: 12, dealDay: 1, dealAmount: "90,000" }),
    sale({ dealYear: 2026, dealMonth: 3, dealDay: 1, dealAmount: "95,000" }),
    sale({ dealYear: 2026, dealMonth: 8, dealDay: 1, dealAmount: "98,000" }),
  ];
  const high = sale({ dealDay: 10, dealAmount: "99,000" });
  const low = sale({ dealDay: 11, dealAmount: "97,000" });
  const young = sale({ aptNm: "다단지", dealDay: 12 }); // 선행 0
  const direct = sale({ dealDay: 13, dealAmount: "120,000", dealingGbn: "직거래" });
  const cancel = sale({ dealDay: 14, cdealType: "O", cdealDay: "26.10.20" });
  const cells = saleCells([...history, high, low, young, direct, cancel]);
  assert.equal(recordVerdict(high, cells), true);
  assert.equal(recordVerdict(low, cells), false);
  assert.equal(recordVerdict(young, cells), null);
  assert.equal(recordVerdict(direct, cells), null);
  // 180일 미달: 선행 3건이 다 최근
  const short = saleCells([sale({ dealMonth: 7, dealDay: 1 }), sale({ dealMonth: 8, dealDay: 1 }), sale({ dealMonth: 9, dealDay: 1 }), high]);
  assert.equal(recordVerdict(high, short), null);

  const rows = [high, low, young, direct, cancel].map((it) => row("sale", "2026-10-20", it));
  const d = buildDigest({ rows, saleItems: [...history, high, low, young, direct, cancel], now: NOW });
  assert.equal(d.current.sale, 4, "해제행은 새 신고에서 뺀다");
  assert.equal(d.current.records, 1);
  assert.equal(d.current.judged, 2);
  assert.equal(d.current.direct, 1);
  assert.equal(d.current.cancelArrived, 1);
  assert.equal(d.current.cancelDated, 1);
});

test("해제: 해제일 기준으로 창을 고른다 - 도착이 다음 창이어도 해제일 창에 센다", () => {
  const rows = [
    ...filler("2026-10-11", END),
    row("sale", "2026-10-19", sale({ cdealType: "O", cdealDay: "26.10.17" })),
    row("sale", "2026-10-21", sale({ cdealType: "O", cdealDay: "26.10.21", floor: 2 })),
  ];
  const d = buildDigest({ rows, saleItems: [], now: NOW });
  assert.equal(d.current.cancelArrived, 2);
  assert.equal(d.current.cancelDated, 1);
  assert.equal(d.previous.cancelDated, 1);
  assert.equal(d.previous.cancelArrived, 0);
});

test("전세·월세 가르기, 계약월 분포, 많은 구(같은 수면 코드 순)", () => {
  const rows = [
    row("rent", "2026-10-20", rent({ monthlyRent: 50 })),
    row("rent", "2026-10-20", rent({ dealMonth: 9 })),
    row("sale", "2026-10-20", sale({ sggCd: 11500 })),
    row("sale", "2026-10-21", sale({ sggCd: 11500, dealMonth: 9 })),
    row("sale", "2026-10-21", sale({ sggCd: 11350 })),
    row("sale", "2026-10-21", sale({ sggCd: 11110 })),
    row("sale", "2026-10-22", sale({ sggCd: 11740 })),
  ];
  const c = buildDigest({ rows, saleItems: [], now: NOW }).current;
  assert.equal(c.jeonse, 1);
  assert.equal(c.wolse, 1);
  assert.deepEqual(c.months.sale, { "202610": 4, "202609": 1 });
  assert.deepEqual(c.months.rent, { "202610": 1, "202609": 1 });
  assert.deepEqual(c.districts, ["11500", "11110", "11350"]);
});

test("빌더: 임시 원본 폴더에서 json 을 쓰고, 단지명은 싣지 않는다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "week-digest-"));
  try {
    const item = sale({ aptNm: "비밀단지" });
    const r = rent({ aptNm: "비밀단지" });
    await mkdir(path.join(dir, "sale"));
    await mkdir(path.join(dir, "rent"));
    await writeFile(path.join(dir, "sale", "11350-202610.json"), JSON.stringify({ ok: true, district: "11350", items: [item], arrivals: { [itemKey(item)]: "2026-10-20" } }));
    await writeFile(path.join(dir, "rent", "11500-202610.json"), JSON.stringify({ ok: true, district: "11500", items: [r], arrivals: { [itemKey(r)]: "2026-10-21" } }));
    await writeFile(path.join(dir, "rent", "11530-202610.json"), JSON.stringify({ ok: false, items: [] }));
    const out = path.join(dir, "out.json");
    const d = await buildWeekDigest({ now: NOW, dir, out });
    const text = await readFile(out, "utf8");
    assert.deepEqual(JSON.parse(text), d);
    assert.equal(d.asOf, "2026-10-21");
    assert.equal(d.current.sale, 1);
    assert.equal(d.current.jeonse, 1);
    assert.doesNotMatch(text, /비밀단지/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
