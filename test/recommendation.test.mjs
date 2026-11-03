// 근거표 값 규칙(#816 P1-1). 값은 전부 지어낸 고정 데이터다 - 실데이터 값·건수·날짜에 기대지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { GRADE as PREREG_GRADE, gradeOf as preregGrade } from "../research/sample-grade-2026-11/grade.mjs";
import { minCash } from "../scripts/min-cash.ts";
import { purchaseCosts } from "../scripts/purchase-costs.ts";
import { addPeers, checksOf, REG_LINES } from "../scripts/recommendation-reasons.ts";
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

test("유형: 실거주는 꺼져 있고, 미래가치·균형은 낼 계획이 없다(시험에 기대는 사유 코드가 없다)", () => {
  assert.deepEqual(TYPES, {
    living: { status: "off", reasons: ["no_transit", "no_households"] },
    future: { status: "none", reasons: ["not_planned"] },
    balanced: { status: "none", reasons: ["not_planned"] },
  });
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
  assert.deepEqual(checksOf({ n: 5, age: 90, median: 100_000 }), []);
  assert.deepEqual(checksOf({ n: 4, age: 91, median: 100_000 }), [["few_deals", 4], ["stale_deal", 91]]);
  assert.deepEqual(REG_LINES, [15, 25]);
  assert.deepEqual(checksOf({ n: 5, age: 0, median: 145_000 }), [["reg_line", 15]]);
  assert.deepEqual(checksOf({ n: 5, age: 0, median: 155_000 }), [["reg_line", 15]]);
  assert.deepEqual(checksOf({ n: 5, age: 0, median: 155_001 }), []);
  assert.deepEqual(checksOf({ n: 5, age: 0, median: 250_000 }), [["reg_line", 25]]);
});

const cell = (area, n, median) => {
  const out = new Array(CELL_FIELDS.length).fill(null);
  out[cellField("areaSqm")] = area;
  out[cellField("n")] = n;
  out[cellField("median")] = median;
  out[cellField("position")] = [];
  return out;
};
const row = (cells) => {
  const out = new Array(APARTMENT_FIELDS.length).fill(null);
  out[APARTMENT_FIELDS.indexOf("cells")] = cells;
  return out;
};

test("같은 값대의 위치: 값대×면적대로만 묶고 서울 전체를 본다. 칸 수만 싣고 몇 번째인지는 싣지 않는다", () => {
  const [a, b, c, other] = [cell(84, 10, 100_000), cell(84, 10, 109_999), cell(84, 3, 110_000), cell(59, 9, 100_000)];
  addPeers([{ apartments: [row([a]), row([b])] }, { apartments: [row([c, other])] }]);
  const position = (x) => x[cellField("position")];
  assert.deepEqual(position(a), [["peers_n", 2]]);
  assert.deepEqual(position(b), [["peers_n", 2]]);
  assert.deepEqual(position(c), [["peers_n", 1]]);
  assert.deepEqual(position(other), [["peers_n", 1]]);
});

test("필드 목록과 한도: 파일 머리가 칸 모양을 말한다, 한도는 40KiB·500,000B·25개", () => {
  assert.equal(new Set(CELL_FIELDS).size, CELL_FIELDS.length);
  assert.deepEqual(CELL_FIELDS.slice(-4), ["sampleGrade", "scores", "position", "checks"]);
  assert.deepEqual(CELL_FIELDS.filter((name) => /confidence|reasons|risks|rank/i.test(name)), [], "판정으로 읽히는 필드 이름을 다시 쓰지 않는다(clo, #856)");
  assert.deepEqual(LIMITS, { fileGzip: 40_960, totalGzip: 500_000, files: 25 });
});
