// 근거표 값 규칙(#816 P1-1). 값은 전부 지어낸 고정 데이터다 - 실데이터 값·건수·날짜에 기대지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { GRADE as PREREG_GRADE, gradeOf as preregGrade } from "../research/sample-grade-2026-11/grade.mjs";
import { minCash } from "../scripts/min-cash.ts";
import { purchaseCosts } from "../scripts/purchase-costs.ts";
import { addPeers, REG_LINES, risksOf } from "../scripts/recommendation-reasons.ts";
import { APARTMENT_FIELDS, areaBand, CELL_FIELDS, cellField, costFields, GRADE, gradeOf, LIMITS, priceBand, TYPES } from "../scripts/recommendation.ts";

test("표본 등급: 경계값 n=5·90일은 충분, n<3 은 값을 내지 않는다", () => {
  assert.equal(gradeOf({ n: 2, age: 0 }), null);
  assert.equal(gradeOf({ n: 3, age: 0 }), "partial");
  assert.equal(gradeOf({ n: 4, age: 0 }), "partial");
  assert.equal(gradeOf({ n: 5, age: 90 }), "enough");
  assert.equal(gradeOf({ n: 5, age: 91 }), "partial");
  assert.equal(gradeOf({ n: 50, age: 91 }), "partial");
});

test("표본 등급은 사전 등록 계산(grade.mjs)과 같다 - 문턱을 이쪽에서만 옮기면 시험이 실패한다", () => {
  assert.equal(GRADE.minDeals, PREREG_GRADE.minDeals);
  assert.equal(GRADE.enoughDeals, PREREG_GRADE.enoughDeals);
  assert.equal(GRADE.recentDays, PREREG_GRADE.recentDays);
  const names = { enough: "충분", partial: "일부 부족" };
  for (let n = 0; n <= 8; n += 1) {
    for (const age of [0, 1, 89, 90, 91, 183]) {
      assert.equal(names[gradeOf({ n, age })] ?? "근거 부족", preregGrade({ n, age }), `n=${n} age=${age}`);
    }
  }
});

test("유형: 셋 다 꺼져 있다", () => {
  assert.deepEqual(Object.keys(TYPES), ["living", "future", "balanced"]);
  for (const type of Object.values(TYPES)) {
    assert.equal(type.status, "off");
    assert.ok(type.reasons.length > 0);
  }
  assert.ok(Object.isFrozen(TYPES));
});

test("면적대·값대 경계", () => {
  assert.equal(areaBand(59.99), "under-60");
  assert.equal(areaBand(60), "60-85");
  assert.equal(areaBand(85), "60-85");
  assert.equal(areaBand(85.01), "over-85");
  assert.equal(priceBand(99_999), 9);
  assert.equal(priceBand(100_000), 10);
});

test("비용: 85㎡ 초과는 농어촌특별세를 포함하고, 현금은 그 비용 + 값 - 상한이다", () => {
  const price = 100_000;
  const small = costFields(price, 84.9);
  const big = costFields(price, 85.1);
  assert.equal(small.extra, Math.round(purchaseCosts(price).total));
  assert.equal(big.extra, Math.round(purchaseCosts(price, { over85: true }).total));
  assert.ok(big.extra > small.extra);
  assert.equal(small.total, price + small.extra);
  assert.equal(small.loanGeneral, minCash(price).loan);
  assert.equal(small.cashGeneral, small.total - small.loanGeneral);
  assert.equal(big.cashGeneral, big.total - big.loanGeneral, "minCash 의 cash 는 면적을 몰라 85㎡ 초과에서 다르다");
  assert.notEqual(big.cashGeneral, minCash(price).cash);
});

test("비용: 생애최초 감면은 12억 이하 현금에만 들어간다", () => {
  const under = costFields(100_000, 84);
  assert.equal(under.cashFirstTime, under.total - under.loanFirstTime - 200);
  const over = costFields(130_000, 84);
  assert.equal(over.cashFirstTime, over.total - over.loanFirstTime);
});

test("확인할 것: 코드 + 측정값. 표본·경과·규제선 ±0.5억, 없으면 빈 목록", () => {
  assert.deepEqual(risksOf({ n: 5, age: 90, median: 100_000 }), []);
  assert.deepEqual(risksOf({ n: 4, age: 91, median: 100_000 }), [["few_deals", 4], ["stale_deal", 91]]);
  assert.deepEqual(REG_LINES, [15, 25]);
  assert.deepEqual(risksOf({ n: 5, age: 0, median: 145_000 }), [["reg_line", 15]]);
  assert.deepEqual(risksOf({ n: 5, age: 0, median: 155_000 }), [["reg_line", 15]]);
  assert.deepEqual(risksOf({ n: 5, age: 0, median: 155_001 }), []);
  assert.deepEqual(risksOf({ n: 5, age: 0, median: 250_000 }), [["reg_line", 25]]);
});

const cell = (area, n, median) => {
  const out = new Array(CELL_FIELDS.length).fill(null);
  out[cellField("areaSqm")] = area;
  out[cellField("n")] = n;
  out[cellField("median")] = median;
  out[cellField("reasons")] = [];
  return out;
};
const row = (id, year, cells) => {
  const out = new Array(APARTMENT_FIELDS.length).fill(null);
  out[APARTMENT_FIELDS.indexOf("id")] = id;
  out[APARTMENT_FIELDS.indexOf("buildYear")] = year;
  out[APARTMENT_FIELDS.indexOf("cells")] = cells;
  return out;
};

test("같은 값대의 위치: 값대×면적대로만 묶고 서울 전체를 보며, 동률은 같은 자리, 준공을 모르면 그 코드가 없다", () => {
  const [a, b, c, d, other] = [cell(84, 10, 100_000), cell(84, 10, 105_000), cell(84, 3, 109_999), cell(84, 7, 101_000), cell(59, 9, 100_000)];
  addPeers([{ apartments: [row("a", 2000, [a]), row("b", 2010, [b])] }, { apartments: [row("c", 2010, [c]), row("d", null, [d]), row("e", 1990, [other])] }]);
  const reasons = (x) => Object.fromEntries(x[cellField("reasons")]);
  assert.deepEqual(reasons(a), { peers_n: 4, build_rank: 3, deals_rank: 1 });
  assert.deepEqual(reasons(b), { peers_n: 4, build_rank: 1, deals_rank: 1 });
  assert.deepEqual(reasons(c), { peers_n: 4, build_rank: 1, deals_rank: 4 });
  assert.deepEqual(reasons(d), { peers_n: 4, deals_rank: 3 });
  assert.deepEqual(reasons(other), { peers_n: 1, build_rank: 1, deals_rank: 1 });
});

test("필드 목록과 한도: 파일 머리가 칸 모양을 말한다, 한도는 40KiB·500,000B·25개", () => {
  assert.equal(new Set(CELL_FIELDS).size, CELL_FIELDS.length);
  assert.deepEqual(LIMITS, { fileGzip: 40_960, totalGzip: 500_000, files: 25 });
});
