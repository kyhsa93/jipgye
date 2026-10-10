import test from "node:test";
import assert from "node:assert/strict";
import { DISTRICTS } from "../scripts/realestate-districts.mjs";
import { OTHER_KEY } from "../scripts/housing-permits-merge.mjs";
import { SERIES } from "../scripts/housing-permits-spec.mjs";
import { B2_MAX_MEDIAN, seoulMonthly, measureB1, measureB2, measureB3, measureB4 } from "../scripts/housing-permits-measure.mjs";
import { flawedB2Verdict } from "./helpers/housing-permits-mutants.mjs";

// B1~B4 측정 (#133, PREREG 4절). 정의는 PREREG에서 그대로 옮겼다. 전부 합성 입력.

const ALL = DISTRICTS.map((d) => d.code);
const months = (from, count) => {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  for (let i = 0; i < count; i += 1) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { y += 1; m = 1; } }
  return out;
};
/** 모든 계열이 같은 달 목록을 갖는 접기 결과. 칸은 기타 구 한 곳에 둔다. complete 필드는 정해진 것으로 둔다(미정 시험만 지운다). */
function foldedOf(list, { units = 1000, withData = ALL, meta = {} } = {}) {
  const series = Object.fromEntries(SERIES.map((s) => [s, { [OTHER_KEY]: Object.fromEntries(list.map((mo) => [mo, { projects: 5, units }])) }]));
  return { meta: { calls: 100, pages: 90, dongs: 20, districtsWithData: [...withData], completeField: "useInsptDay", ...meta }, series, unknown: {} };
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

test("B1: complete 필드가 미정이면 그 계열은 길이를 따지지 않고 '대기'로 보고한다 - 통과로도 시험 불가로도 쓰지 않는다 (PREREG 「complete 필드 해소 규칙」)", () => {
  const f = foldedOf(months("2011-01", 168), { meta: { completeField: null } });
  f.series.complete = {};
  const r = measureB1(f);
  assert.equal(r.verdict, "pending");
  assert.deepEqual(r.pending, ["complete"]);
  assert.equal(r.series.complete.pending, true);
  assert.equal(r.series.permit.months, 168, "나머지 계열은 평소대로 잰다");
  assert.match(r.reasons.join(" "), /complete 필드 미정/);
  // 필드가 안 정해진 채로도 다른 확정 사유(짧은 계열·빠진 구)가 있으면 시험 불가가 우선한다
  const short = foldedOf(months("2016-01", 100), { meta: { completeField: null } });
  short.series.complete = {};
  assert.equal(measureB1(short).verdict, "unable");
  const missing = foldedOf(months("2011-01", 168), { withData: ALL.slice(1), meta: { completeField: null } });
  assert.equal(measureB1(missing).verdict, "unable");
  // meta.completeField가 아예 없는 옛 모양도 미정으로 본다
  const bare = foldedOf(months("2011-01", 168));
  delete bare.meta.completeField;
  assert.equal(measureB1(bare).verdict, "pending");
});

// ---- B2 ----
const toMap = (list, f) => new Map(list.map((m, i) => [Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1, f(i)]));
/** 매달 e를 내는 ECOS 누계 행. 해마다 1월부터 쌓는다. */
function ecosRows(list, e) {
  let ytd = 0;
  return list.map((m) => { ytd = m.endsWith("-01") ? e : ytd + e; return [m.replace("-", ""), ytd]; });
}
const list36 = months("2020-01", 36);

test("B2: 차이 5%면 통과, 20%면 불통과", () => {
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

test("B2: 값은 하나뿐이다 - 취소 미반영 단일 값으로 판정하고, 취소 포함·제외 두 값을 나란히 내지 않는다 (PREREG 4절 B2)", () => {
  const r = measureB2(foldedOf(list36, { units: 1000 }), ecosRows(list36, 1000));
  assert.equal(r.verdict, "pass");
  assert.ok(Math.abs(r.median) < 1e-9);
  assert.ok(!("medianIncl" in r) && !("medianExcl" in r), "두 값을 내지 않는다");
  assert.ok(!/취소 제외/.test(r.note), "'취소 제외 값'이라 적지 않는다");
  assert.match(r.note, /취소 미반영 단일 값/);
  assert.match(r.note, /착공·준공 집계는 B2로 검증되지 않는다/);
  // folded에 옛 취소 칸이 남아 있어도 판정에 쓰지 않는다
  const legacy = foldedOf(list36, { units: 1000 });
  legacy.cancelledPermit = Object.fromEntries(list36.map((m) => [m, { projects: 5, units: 300 }]));
  assert.equal(measureB2(legacy, ecosRows(list36, 1000)).median, r.median);
});

test("B2: 10%를 넘으면 선을 올려 통과시키지 않고 원인 후보(정의 차이·누락·취소 미반영)를 적는다", () => {
  const r = measureB2(foldedOf(list36, { units: 1200 }), ecosRows(list36, 1000));
  assert.equal(r.verdict, "fail");
  assert.deepEqual(r.causeCandidates, ["정의 차이", "누락", "취소 미반영"]);
  assert.equal(measureB2(foldedOf(list36, { units: 1000 }), ecosRows(list36, 1000)).causeCandidates, undefined);
});

test("B2: 12개월 창 합의 상대 차이 중앙값을 쓴다 - 한 달 어긋남은 합에서 상쇄되지 않고 창마다 센다", () => {
  // HUB는 ECOS보다 한 해 앞 달 값이 크고 뒤 달이 작다: 월별 차이는 크지만 12개월 합은 대부분 같다.
  const hub = foldedOf(list36, { units: 1000 });
  hub.series.permit[OTHER_KEY] = Object.fromEntries(list36.map((m, i) => [m, { projects: 5, units: i === 10 ? 1500 : i === 11 ? 500 : 1000 }]));
  const r = measureB2(hub, ecosRows(list36, 1000));
  assert.equal(r.verdict, "pass");
  assert.equal(r.median, 0);
});

test("낙제 시험 ⑥: 창 부족을 통과시키는 사본은 빨강이다", () => {
  const e = toMap(list36, () => 1000);
  const hub = toMap(list36, () => 1050); // 5% 차이
  assert.equal(flawedB2Verdict(hub, e), "pass");
  assert.equal(measureB2(foldedOf(list36, { units: 1050 }), ecosRows(list36, 1000)).verdict, "pass");
  const short = list36.slice(0, 20);
  const shortE = toMap(short, () => 1000);
  assert.equal(flawedB2Verdict(shortE, shortE), "hold");
  assert.notEqual(flawedB2Verdict(shortE, shortE, { holdShort: false }), "hold");
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

test("B2 경계: 문턱은 0.1이고, 중앙값 정확히 0.10은 통과, 0.10을 넘으면 불통과", () => {
  assert.equal(B2_MAX_MEDIAN, 0.1);
  const at = measureB2(foldedOf(list36, { units: 1100 }), ecosRows(list36, 1000));
  assert.equal(at.median, 0.1);
  assert.equal(at.verdict, "pass");
  const over = measureB2(foldedOf(list36, { units: 1101 }), ecosRows(list36, 1000));
  assert.ok(over.median > 0.1);
  assert.equal(over.verdict, "fail");
});
