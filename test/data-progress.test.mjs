// 데이터 진척 감시(#657 V11): 고정 입력과 고정 시각으로만 돈다. 실제 docs/data·raw 나 시계를 읽지 않는다(#8 교훈).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUSINESS_FAIL_DAYS, BUSINESS_WARN_DAYS, MONTHLY_LAG, collectChecks, collectStatus, dateOf, main, monthlyCheck, weekdaysBetween,
} from "../scripts/check-data-progress.ts";
import { ECOS_SERIES, RONE_SERIES } from "../scripts/fetch-indicators.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { shiftMonth } from "../scripts/realestate-slots.ts";

const root = path.resolve(import.meta.dirname, "..");
const months = (last, n) => Array.from({ length: n }, (_, i) => [shiftMonth(last, i - n + 1), 1]);

/** 2026-10-26(월) 기준으로 모두 정상인 저장소 사본. over 로 파일 하나씩 바꾼다. */
function fixture(over = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "data-progress-"));
  const put = (rel, obj) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), JSON.stringify(obj));
  };
  const files = {
    "docs/data/news.json": { items: [{ publishedAt: "2026-10-25T16:00:00Z" }, { publishedAt: "2026-10-25T04:00:00Z" }] },
    "docs/data/market.json": { kospi: { asOf: "10/23" }, usdKrw: { asOf: "10/23" }, usdKrwDaily: [["2026-10-22", 1], ["2026-10-23", 1]] },
    "raw/indicators/series.json": { series: Object.fromEntries(Object.entries(MONTHLY_LAG).map(([k, lag]) => [k, months(shiftMonth("202610", -lag), 30)])) },
    "raw/indicators/rone-districts.json": { series: { 11110: months("202609", 30), 11140: months("202609", 30) } },
    "raw/ecos/apt-price-index.json": { series: { 200: months("202607", 30) } },
    "raw/move-in/meta.json": { basis: "2026-06-30" },
    "raw/official-price/status/progress.json": { lastProgressAt: "2026-10-25T21:00:00Z", zeroProgressRuns: 0, doneParcels: 2094, targetParcels: 6764 },
    ...over,
  };
  for (const [rel, obj] of Object.entries(files)) if (obj !== null) put(rel, obj);
  if (!("raw/sale" in over)) {
    for (const kind of ["sale", "rent"]) {
      for (let i = 0; i < 24; i += 1) {
        for (const { code } of DISTRICTS) put(`raw/${kind}/${code}-${shiftMonth("202610", -i)}.json`, { observedAt: i === 0 ? "2026-10-25T23:30:00Z" : "2026-09-01T00:00:00Z" });
      }
    }
  }
  return dir;
}
const at = (iso) => new Date(iso);
const by = (checks, source) => checks.find((c) => c.source === source);
const run = (dir, now) => {
  const lines = [];
  const code = main([`--root=${dir}`, `--now=${now}`], { log: (m) => lines.push(m) });
  return { code, text: lines.join("\n") };
};

test("정상 사본: 2026-10-26(월) 14:29 KST 에는 전부 ok, 종료 0, 경고 줄 없음", () => {
  const dir = fixture();
  try {
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    assert.deepEqual(checks.filter((c) => c.level !== "ok").map((c) => c.source), []);
    const { code, text } = run(dir, "2026-10-26T05:29:00Z");
    assert.equal(code, 0);
    assert.doesNotMatch(text, /::warning::|::error::/, "정상일 때는 매일 새 소음이 없다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("주말 지연: 금요일 값은 월·화 새벽까지 조용하고, 목요일(사이 평일 3)에 경고, 다음 주 수요일(7)에 실패", () => {
  assert.equal(weekdaysBetween("2026-10-23", "2026-10-26"), 0); // 금 -> 월
  assert.equal(weekdaysBetween("2026-10-23", "2026-10-27"), 1); // 화 새벽(오늘 run 전)
  assert.equal(weekdaysBetween("2026-10-23", "2026-10-29"), BUSINESS_WARN_DAYS);
  assert.equal(weekdaysBetween("2026-10-23", "2026-11-04"), BUSINESS_FAIL_DAYS);
  const dir = fixture();
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "market/kospi").level;
    assert.equal(level("2026-10-26T17:29:00Z"), "ok"); // 화 02:29 KST
    assert.equal(level("2026-10-28T05:29:00Z"), "ok"); // 수 14:29 - 단발 실패(평일 2)는 조용
    assert.equal(level("2026-10-29T05:29:00Z"), "warn");
    assert.equal(level("2026-11-03T05:29:00Z"), "warn"); // 평일 6
    assert.equal(level("2026-11-04T05:29:00Z"), "fail"); // 평일 7
    // 가장 긴 휴장(평일 5일, 2025-10-03~09)에 단발 실패가 겹쳐도(6) 실패로 울지 않는다(#667 cto)
    assert.equal(weekdaysBetween("2025-10-02", "2025-10-10"), 5);
    assert.equal(weekdaysBetween("2025-10-02", "2025-10-11"), 6);
    assert.ok(6 < BUSINESS_FAIL_DAYS);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("하루 주기(뉴스): 가장 새 기사 36h 넘으면 경고, 60h 넘으면 실패해 종료 1", () => {
  const dir = fixture();
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "news").level;
    assert.equal(level("2026-10-27T03:59:00Z"), "ok"); // 35.98h
    assert.equal(level("2026-10-27T04:01:00Z"), "warn");
    assert.equal(level("2026-10-28T04:01:00Z"), "fail");
    const { code, text } = run(dir, "2026-10-28T04:01:00Z");
    assert.equal(code, 1);
    assert.match(text, /::error::데이터가 멈췄다: news/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("월 주기: 정상 지연 L 이하 조용, L+1 경고, L+2 실패. 빈 달은 경고", () => {
  assert.equal(monthlyCheck("x", months("202608", 5), 2, "202610").level, "ok");
  assert.equal(monthlyCheck("x", months("202607", 5), 2, "202610").level, "warn");
  assert.equal(monthlyCheck("x", months("202606", 5), 2, "202610").level, "fail");
  assert.equal(monthlyCheck("x", [["202601", 1], ["202603", 1], ["202609", 1]], 2, "202610").level, "warn");
  // 해가 바뀌어도 달 수로 센다
  assert.equal(monthlyCheck("x", months("202611", 3), 2, "202701").level, "ok");
  // 사본에서: 기준금리가 두 달 더 늦으면 실패, 자치구 25개 중 하나만 늦어도 그 소스가 늦다
  const dir = fixture({
    "raw/indicators/series.json": { series: { ...Object.fromEntries(Object.entries(MONTHLY_LAG).map(([k, lag]) => [k, months(shiftMonth("202610", -lag), 30)])), base_rate: months("202606", 30) } },
    "raw/indicators/rone-districts.json": { series: { 11110: months("202609", 30), 11140: months("202607", 30) } },
  });
  try {
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    assert.equal(by(checks, "series/base_rate").level, "fail");
    assert.equal(by(checks, "rone-districts").level, "warn");
    assert.match(by(checks, "rone-districts").detail, /2계열 중 가장 늦은 것: 마지막 달 202607/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("주기 표는 수집기의 계열 목록과 같다(계열을 더하면 여기서 소리 난다)", () => {
  assert.deepEqual(Object.keys(MONTHLY_LAG).sort(), [...Object.keys(ECOS_SERIES), ...Object.keys(RONE_SERIES)].sort());
});

test("파일 없음: 뉴스·시장·계열 파일이 없으면 실패, 공시가격 상태 파일이 없으면 경고만", () => {
  const dir = fixture({ "docs/data/news.json": null, "docs/data/market.json": null, "raw/ecos/apt-price-index.json": null, "raw/official-price/status/progress.json": null });
  try {
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    for (const s of ["news", "market/kospi", "market/usdKrw", "apt-price-index"]) assert.equal(by(checks, s).level, "fail", s);
    assert.equal(by(checks, "official-price").level, "warn");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("실거래 원본: 슬롯이 빠지면 경고(감소), 도착이 멈추면 영업일 문턱으로", () => {
  const dir = fixture();
  try {
    rmSync(path.join(dir, "raw/sale/11110-202509.json"));
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    assert.equal(by(checks, "raw/sale").level, "warn");
    assert.match(by(checks, "raw/sale").detail, /슬롯 599\/600\(빠진 슬롯 1\)/);
    assert.equal(by(checks, "raw/rent").level, "ok");
    assert.equal(by(collectChecks({ root: dir, now: at("2026-11-05T05:29:00Z") }), "raw/rent").level, "fail"); // 10-26 도착 뒤 평일 7일
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("공시가격: 진척 0 이 2일 이어지면 경고, 3일이 넘어도 실패는 내지 않는다(그 워크플로가 낸다, #660)", () => {
  const p = { lastProgressAt: "2026-10-22T21:53:51.000Z", zeroProgressRuns: 3, doneParcels: 2094, targetParcels: 6764 };
  const dir = fixture({ "raw/official-price/status/progress.json": p });
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "official-price").level;
    assert.equal(level("2026-10-24T05:29:00Z"), "ok"); // 1일
    assert.equal(level("2026-10-25T05:29:00Z"), "warn"); // 2일
    assert.equal(level("2026-10-30T05:29:00Z"), "warn"); // 7일 - 여전히 경고
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("월간 원장: 첫 달(2026-11) 전에는 안 보고, 3일 0시(KST) 뒤 없으면 경고, 54h 넘으면 실패, 있으면 ok", () => {
  const dir = fixture();
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "ledger")?.level;
    assert.equal(level("2026-10-26T05:29:00Z"), undefined);
    assert.equal(level("2026-11-02T05:29:00Z"), "ok"); // 기한 전
    assert.equal(level("2026-11-03T05:29:00Z"), "warn");
    assert.equal(level("2026-11-05T05:29:00Z"), "fail"); // 3일 0시 KST + 62.5h
    mkdirSync(path.join(dir, "ledger"));
    writeFileSync(path.join(dir, "ledger/2026-11.jsonl.gz"), "");
    assert.equal(level("2026-11-05T05:29:00Z"), "ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("날짜 읽기: 해 없는 M/D 는 오늘보다 늦지 않은 해, ISO·RFC 도 읽는다", () => {
  assert.equal(dateOf("10/23", "2026-10-26"), "2026-10-23");
  assert.equal(dateOf("12/31", "2027-01-02"), "2026-12-31");
  assert.equal(dateOf("2026-10-23", "2026-10-26"), "2026-10-23");
  assert.equal(dateOf("Sun, 25 Oct 2026 00:02:31 +0000", "2026-10-26"), "2026-10-25");
  assert.equal(dateOf("", "2026-10-26"), null);
});

test("method 수집 상태 줄: 마지막 수집 성공·10-01 이후 수집이 빠진 날을 두 언어로(공시가격 진척 없음), 데이터 없으면 null", () => {
  const history = ["2026-09-02", "2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05"].map((date) => ({ date }));
  const s = collectStatus(history);
  assert.equal(s.ko, '<p>수집 상태: 마지막 수집 성공 10-05 · 10-01 이후 수집이 빠진 날 1일</p>');
  assert.equal(s.en, '<p>Collection: last successful run 10-05 · 1 day without collection since 10-01</p>');
  assert.equal(collectStatus([]), null);
  assert.equal(collectStatus(undefined), null);
});

test("워치독 워크플로는 데이터 진척 스텝을 두고, 앞 스텝이 실패해도 돈다", () => {
  const text = readFileSync(path.join(root, ".github/workflows/schedule-watchdog.yml"), "utf8");
  assert.match(text, /if: \$\{\{ !cancelled\(\) \}\}\n\s+run: node scripts\/check-data-progress\.ts\n/);
});
