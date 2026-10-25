import test from "node:test";
import assert from "node:assert/strict";
import { MIN_MONTH_PAIRS, PARTIAL_MONTHS, buildSeries, trySeries } from "../scripts/conversion-series.ts";
import { buildPayload } from "../scripts/build-conversion.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";

const NOW = new Date("2026-08-26T00:00:00Z");
const ECOS = { jeonse_loan_rate: [["202608", 4]], deposit_rate: [["202608", 3.8]] };

// 한 단지 = 전세 5억 + 월세(보증금 2억, 월세 monthly). 월세 125만 → 전환율 5.00%, 월세 100만 → 4.00%.
const apartment = (district, apt, monthly = 125) => [
  { district, dong: "하계동", apt, area: 84.9, floor: 7, date: "2026-08-14", buildYear: 1988, deposit10k: 50_000, renewal: false },
  { district, dong: "하계동", apt, area: 84.9, floor: 7, date: "2026-08-14", buildYear: 1988, deposit10k: 20_000, monthlyRent10k: monthly, renewal: false },
];
// 한 달 신고: 구마다 단지 수를 정한다. 단지 i 의 월세는 100+i 라 전환율이 단지마다 다르다.
const month = (counts, base = 100) =>
  Object.entries(counts).flatMap(([district, n]) => Array.from({ length: n }, (_, i) => apartment(district, `${district}-${i}`, base + i)).flat());

const MONTHS = ["202606", "202607", "202608", "202609", "202610"];

test("월별 선: 달마다 따로 짝을 세어 서울 + 구의 rate·pairs 를 낸다", () => {
  const byMonth = [
    month({ 노원구: 10, 마포구: 12 }),
    month({ 노원구: 11, 마포구: 10 }, 110),
    month({ 노원구: 10, 마포구: 10 }),
    month({ 노원구: 10 }),
    month({ 마포구: 10 }),
  ];
  const s = buildSeries(byMonth, MONTHS);

  assert.deepEqual(s.months, MONTHS);
  assert.deepEqual(s.seoul.pairs, [22, 21, 20, 10, 10]);
  assert.deepEqual(s.districts["노원구"].pairs, [10, 11, 10, 10, 0]);
  assert.deepEqual(s.districts["마포구"].pairs, [12, 10, 10, 0, 10]);
  // 월세 100..109만, 보증금 차 3억 → 전환율 4.00..4.36 의 중앙값(4.00+0.04*4.5)=4.18
  assert.equal(s.districts["노원구"].rate[0], 4.18);
  // 한 달 신고가 없으면 그 달은 짝 0, rate null
  assert.equal(s.districts["노원구"].rate[4], null);
  // 서울 선은 그 달 전체 짝의 중앙값이다(구를 가중 없이 섞는다)
  assert.equal(s.seoul.rate[3], 4.18);
});

test("월 문턱: n<10 달은 rate null, n=10 은 값이 있다(문턱은 계산 전 PR 본문에 고정한 10)", () => {
  assert.equal(MIN_MONTH_PAIRS, 10);
  const s = buildSeries([month({ 노원구: 9 }), month({ 노원구: 10 })], ["202609", "202610"]);
  assert.deepEqual(s.districts["노원구"].rate.map((r) => r === null), [true, false]);
  assert.deepEqual(s.districts["노원구"].pairs, [9, 10]);
  // 서울도 같은 문턱: 9 → null, 10 → 값
  assert.deepEqual(s.seoul.rate.map((r) => r === null), [true, false]);
  assert.equal(s.minPairs, 10);
  // 문턱은 옵션으로만 바뀐다(기본값을 낮춰 통과시키지 못하게 위 단언이 고정한다)
  const loose = buildSeries([month({ 노원구: 3 })], ["202610"], { minPairs: 3 });
  assert.notEqual(loose.seoul.rate[0], null);
});

test("최근 2개월은 partial: true, 나머지는 false", () => {
  assert.equal(PARTIAL_MONTHS, 2);
  const s = buildSeries(MONTHS.map(() => month({ 노원구: 10 })), MONTHS);
  assert.deepEqual(s.partial, [false, false, false, true, true]);
  assert.equal(s.partial.length, s.months.length);
});

test("선은 25개 구 전부를 같은 길이로 가진다(신고 없는 구도 null 선), 이름은 가나다순", () => {
  const s = buildSeries([month({ 노원구: 10 })], ["202610"]);
  const names = Object.keys(s.districts);
  assert.equal(names.length, DISTRICTS.length);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "ko")));
  for (const line of Object.values(s.districts)) {
    assert.equal(line.rate.length, 1);
    assert.equal(line.pairs.length, 1);
  }
  assert.deepEqual(s.districts["종로구"], { rate: [null], pairs: [0] });
});

test("갱신계약·짝 없는 단지는 월별에서도 세지 않는다(cells 와 같은 짝 규칙)", () => {
  const renewals = month({ 노원구: 10 }).map((d) => ({ ...d, renewal: true }));
  const jeonseOnly = month({ 노원구: 10 }).filter((d) => !(d.monthlyRent10k > 0));
  const s = buildSeries([renewals, jeonseOnly], ["202609", "202610"]);
  assert.deepEqual(s.seoul.pairs, [0, 0]);
});

test("cells·seoul·lead 는 series 유무와 상관없이 바이트까지 같다(N1 이 cells 를 읽는다)", () => {
  const deals = month({ 노원구: 12, 마포구: 11 });
  const base = { deals, series: ECOS, months: ["202608"], now: NOW };
  const without = buildPayload(base);
  const withSeries = buildPayload({ ...base, dealsByMonth: MONTHS.map(() => deals), seriesMonths: MONTHS });

  assert.ok(withSeries.series);
  const { series, ...rest } = withSeries;
  assert.equal(JSON.stringify(rest), JSON.stringify(without));
  assert.equal(JSON.stringify(withSeries.cells), JSON.stringify(without.cells));
  assert.equal(JSON.stringify(withSeries.seoul), JSON.stringify(without.seoul));
  // series 는 마지막 키 - 앞 키의 순서·값은 그대로 두고 뒤에만 붙는다
  assert.deepEqual(Object.keys(withSeries), [...Object.keys(without), "series"]);
  assert.ok(JSON.stringify(withSeries).startsWith(JSON.stringify(without).slice(0, -1)));
});

test("soft-fail: series 계산이 실패하면 키 없이 기존 산출 그대로, 던지지 않는다", () => {
  const deals = month({ 노원구: 12 });
  const base = { deals, series: ECOS, months: ["202608"], now: NOW };
  const without = buildPayload(base);
  const lines = [];
  const log = console.log;
  console.log = (msg) => lines.push(String(msg));
  let broken, noData;
  try {
    // 달 수와 묶음 수가 어긋남 → buildSeries 가 던진다
    broken = buildPayload({ ...base, dealsByMonth: [deals], seriesMonths: MONTHS });
    // 신고 항목이 깨진 달 → 던짐
    assert.equal(trySeries([null], ["202610"]), null);
    // 모든 달이 문턱 미만 → 서울 선에 값이 없어 series 를 만들지 않는다
    noData = buildPayload({ ...base, dealsByMonth: [month({ 노원구: 2 })], seriesMonths: ["202610"] });
  } finally {
    console.log = log;
  }
  assert.equal("series" in broken, false);
  assert.equal(JSON.stringify(broken), JSON.stringify(without));
  assert.equal("series" in noData, false);
  assert.equal(JSON.stringify(noData), JSON.stringify(without));
  assert.ok(lines.some((l) => l.includes("월별 추이를 만들지 못했습니다")));
  // 읽기 실패(null)로 dealsByMonth 가 없을 때도 같다
  assert.equal(JSON.stringify(buildPayload({ ...base, dealsByMonth: null })), JSON.stringify(without));
});

test("결정성: 신고 순서·월별 읽기 순서가 달라도 같은 JSON, 값에 시계가 끼지 않는다", () => {
  const byMonth = MONTHS.map((_, i) => month({ 노원구: 10 + i, 마포구: 12, 강남구: 10 }, 100 + i));
  const a = buildSeries(byMonth, MONTHS);
  const reordered = byMonth.map((deals) => [...deals].reverse());
  const b = buildSeries(reordered, MONTHS);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(buildSeries(byMonth, MONTHS)), JSON.stringify(a));
});

test("크기: 24개월×서울+25구 선이 12KB 증가 한도 안에 든다", () => {
  const months = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor((10 + i) / 12)}${String(((10 + i) % 12) + 1).padStart(2, "0")}`);
  const counts = Object.fromEntries(DISTRICTS.map(({ name }) => [name, 40]));
  const s = buildSeries(months.map((_, i) => month(counts, 100 + (i % 7))), months);
  assert.equal(s.months.length, 24);
  assert.equal(Object.keys(s.districts).length, 25);
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < 12 * 1024);
});
