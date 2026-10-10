import test from "node:test";
import assert from "node:assert/strict";
import { DISTRICTS } from "../scripts/realestate-districts.mjs";
import { OTHER_KEY } from "../scripts/housing-permits-merge.mjs";
import { SERIES } from "../scripts/housing-permits-spec.mjs";
import { seoulMonthly, measureB1, measureB2, measureB3, measureB4 } from "../scripts/housing-permits-measure.mjs";
import { flawedB2Verdict } from "./helpers/housing-permits-mutants.mjs";

// B1~B4 측정 (#133, PREREG 4절). 정의는 PREREG에서 그대로 옮겼다. 전부 합성 입력.

const ALL = DISTRICTS.map((d) => d.code);
const months = (from, count) => {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  for (let i = 0; i < count; i += 1) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { y += 1; m = 1; } }
  return out;
};
/** 모든 계열이 같은 달 목록을 갖는 접기 결과. 칸은 기타 구 한 곳에 둔다. */
function foldedOf(list, { units = 1000, withData = ALL, cancelled = {}, meta = {} } = {}) {
  const series = Object.fromEntries(SERIES.map((s) => [s, { [OTHER_KEY]: Object.fromEntries(list.map((mo) => [mo, { projects: 5, units }])) }]));
  return { meta: { calls: 100, pages: 90, dongs: 20, districtsWithData: [...withData], ...meta }, series, unknown: {}, cancelledPermit: cancelled };
}

test("seoulMonthly: 공개 구와 기타 구를 모두 더한다", () => {
  const f = foldedOf(["2024-01"]);
  f.series.permit["11110"] = { "2024-01": { projects: 3, units: 500 } };
  assert.equal(seoulMonthly(f.series.permit).get("2024-01"), 1500);
});

test("B1: 25구 모두 응답, 시작 2012-12 이전, 150개월 이상이면 통과", () => {
  const r = measureB1(foldedOf(months("2011-01", 168)));
  assert.equal(r.verdict, "pass");
  assert.equal(r.series.permit.start, "2011-01");
  assert.equal(r.series.permit.months, 168);
});

test("B1: 경계 - 시작 2012-12는 통과, 2013-01은 불가", () => {
  assert.equal(measureB1(foldedOf(months("2012-12", 160))).verdict, "pass");
  assert.equal(measureB1(foldedOf(months("2013-01", 160))).verdict, "unable");
});

test("B1: 150개월 경계 - 150은 통과, 149는 불가(시작 조건은 만족)", () => {
  assert.equal(measureB1(foldedOf(months("2012-01", 150))).verdict, "pass");
  const r = measureB1(foldedOf(months("2012-01", 149)));
  assert.equal(r.verdict, "unable");
  assert.match(r.reasons.join(" "), /150/);
});

test("B1: 한 구라도 응답이 없으면 불가이고 빠진 구를 적는다", () => {
  const r = measureB1(foldedOf(months("2011-01", 168), { withData: ALL.slice(1) }));
  assert.equal(r.verdict, "unable");
  assert.deepEqual(r.districts.missing, [ALL[0]]);
});

test("B1: 세 계열 중 하나라도 짧으면 불가(후보 ①②와 B2가 각각 쓴다)", () => {
  const f = foldedOf(months("2011-01", 168));
  f.series.complete[OTHER_KEY] = Object.fromEntries(months("2016-01", 100).map((m) => [m, { projects: 5, units: 1 }]));
  const r = measureB1(f);
  assert.equal(r.verdict, "unable");
  assert.equal(r.series.complete.months, 100);
});

// ---- B2 ----
const toMap = (list, f) => new Map(list.map((m, i) => [Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1, f(i)]));
/** 매달 e를 내는 ECOS 누계 행. 해마다 1월부터 쌓는다. */
function ecosRows(list, e) {
  let ytd = 0;
  return list.map((m) => { ytd = m.endsWith("-01") ? e : ytd + e; return [m.replace("-", ""), ytd]; });
}
const list36 = months("2020-01", 36);

test("B2: 차이 5%면 통과, 20%면 불통과 - 판정은 취소 제외 값", () => {
  assert.equal(measureB2(foldedOf(list36, { units: 1050 }), ecosRows(list36, 1000)).verdict, "pass");
  assert.equal(measureB2(foldedOf(list36, { units: 1200 }), ecosRows(list36, 1000)).verdict, "fail");
});

test("B2: 창이 12개 미만이면 보류(통과로 쓰지 않는다)", () => {
  const short = months("2020-01", 12 + 10); // 창 11개
  const r = measureB2(foldedOf(short, { units: 1000 }), ecosRows(short, 1000));
  assert.equal(r.windows, 11);
  assert.equal(r.verdict, "hold");
  const none = measureB2(foldedOf(months("2020-01", 5)), ecosRows(months("2020-01", 5), 1000));
  assert.equal(none.verdict, "hold");
});

test("B2: 창이 정확히 12개면 판정한다", () => {
  const l = months("2020-01", 23);
  const r = measureB2(foldedOf(l, { units: 1000 }), ecosRows(l, 1000));
  assert.equal(r.windows, 12);
  assert.equal(r.verdict, "pass");
});

test("B2: 취소를 포함한 값도 적지만 판정에는 쓰지 않는다", () => {
  const cancelled = Object.fromEntries(list36.map((m) => [m, { projects: 5, units: 300 }]));
  const r = measureB2(foldedOf(list36, { units: 1000, cancelled }), ecosRows(list36, 1000));
  assert.equal(r.verdict, "pass");
  assert.ok(Math.abs(r.medianExcl) < 1e-9);
  assert.ok(Math.abs(r.medianIncl - 0.3) < 1e-9, `포함 값 ${r.medianIncl}`);
});

test("B2: 12개월 창 합의 상대 차이 중앙값을 쓴다 - 한 달 어긋남은 합에서 상쇄되지 않고 창마다 센다", () => {
  // HUB는 ECOS보다 한 해 앞 달 값이 크고 뒤 달이 작다: 월별 차이는 크지만 12개월 합은 대부분 같다.
  const hub = foldedOf(list36, { units: 1000 });
  hub.series.permit[OTHER_KEY] = Object.fromEntries(list36.map((m, i) => [m, { projects: 5, units: i === 10 ? 1500 : i === 11 ? 500 : 1000 }]));
  const r = measureB2(hub, ecosRows(list36, 1000));
  assert.equal(r.verdict, "pass");
  assert.equal(r.medianExcl, 0);
});

test("낙제 시험 ⑥: 취소 포함 값으로 판정하거나 창 부족을 통과시키는 사본은 빨강이다", () => {
  const e = toMap(list36, () => 1000);
  const excl = toMap(list36, () => 1050); // 5% 차이
  const incl = toMap(list36, () => 1350); // 35% 차이
  assert.equal(flawedB2Verdict(excl, incl, e), "pass");
  assert.equal(measureB2(foldedOf(list36, { units: 1050, cancelled: Object.fromEntries(list36.map((m) => [m, { projects: 5, units: 300 }])) }), ecosRows(list36, 1000)).verdict, "pass");
  assert.notEqual(flawedB2Verdict(excl, incl, e, { useInclusive: true }), "pass", "사본이 정말 다른 답을 내는지");
  const short = list36.slice(0, 20);
  const shortE = toMap(short, () => 1000);
  assert.equal(flawedB2Verdict(shortE, shortE, shortE), "hold");
  assert.notEqual(flawedB2Verdict(shortE, shortE, shortE, { holdShort: false }), "hold");
  assert.equal(measureB2(foldedOf(short, { units: 1000 }), ecosRows(short, 1000)).verdict, "hold", "진짜는 보류");
});

// ---- B3·B4 ----
test("B3: 호출량과 한도 대비 비율을 보고만 한다", () => {
  const r = measureB3({ calls: 2500, pages: 2400, dongs: 467 }, 5000);
  assert.deepEqual({ calls: r.calls, pages: r.pages, dongs: r.dongs, limit: r.limit, pctOfLimit: r.pctOfLimit }, { calls: 2500, pages: 2400, dongs: 467, limit: 5000, pctOfLimit: 50 });
  assert.equal(r.verdict, undefined, "합격 판정에 쓰지 않는다");
});

test("B4: 입력 시점 필드를 지정하지 않으면 규칙 2 - n은 3", () => {
  const r = measureB4({ responseFields: ["a", "b"] });
  assert.equal(r.rule, 2);
  assert.equal(r.n, 3);
  assert.deepEqual(r.responseFields, ["a", "b"]);
});

test("B4: 입력 시점 필드의 지연 분포가 있으면 n = max(3, ceil(P90))", () => {
  const f = (histogram) => ({ responseFields: [], inputLag: { field: "x", histogram, unparsed: 0 } });
  assert.deepEqual([measureB4(f({ 1: 100 })).n, measureB4(f({ 1: 100 })).rule], [3, 3]);
  assert.equal(measureB4(f({ 4: 100 })).n, 4);
  assert.equal(measureB4(f({ 2: 10, 3: 80, 5: 10 })).n, 3, "P90은 누적 90번째 = 3");
  assert.equal(measureB4(f({ 2: 10, 3: 79, 7: 11 })).n, 7, "누적 90번째가 7");
  assert.equal(measureB4(f({ [-1]: 5, 6: 95 })).n, 6, "음수 지연도 분포에 센다");
});
