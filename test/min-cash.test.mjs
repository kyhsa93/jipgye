import test from "node:test";
import assert from "node:assert/strict";
import { BASIS_DATE, MIN_CASH_RULES, minCash, minCashSentence } from "../scripts/min-cash.mjs";

// LTV(40/70%)는 10·15 대책 원문, 생애최초 감면(12억 이하 200만원)은 지방세특례제한법 제36조의3에서 옮겼다.
test("대출 천장은 min(LTV×집값, 구간 상한)", () => {
  assert.equal(minCash(75_000).loan, 30_000, "7.5억 × 40%");
  assert.equal(minCash(75_000, { firstTime: true }).loan, 52_500, "7.5억 × 70%");
  assert.equal(minCash(115_000, { firstTime: true }).loan, 60_000, "11.5억 × 70% = 8.05억이지만 15억 이하 상한 6억");
  assert.equal(minCash(155_000).loan, 40_000, "15억 초과 상한 4억 < 40% 6.2억");
});

test("최소 필요 현금 = 집값 − 대출 천장 + 부대비용, 생애최초는 12억 이하에서 200만원 감면", () => {
  const g = minCash(75_000);
  assert.equal(g.cash, 75_000 - 30_000 + g.costs);
  const f = minCash(75_000, { firstTime: true });
  assert.equal(f.relief, 200);
  assert.equal(minCash(125_000, { firstTime: true }).relief, 0, "12억 넘는 집에 생애최초 감면을 줬다");
});

test("문장은 DSR로 더 적게 빌릴 수 있다는 것과 유주택자 원칙·처분조건부 예외, 기준일을 적는다", () => {
  const s = minCashSentence(7);
  assert.match(s, /자기 돈이 적어도 4억 6,950만원/);
  assert.doesNotMatch(s, /처분조건부/, "옮긴 예외 문단이 장에 또 실렸다(#66)");
  // 소득·기존 주택 단서와 기준일은 method.html 한 자리로 갔다. 글자는 상수에 그대로 있다.
  assert.match(MIN_CASH_RULES, /소득\(DSR\)에 따라 장에 적은 천장보다 적을 수/);
  // 숫자 바로 옆 한 줄은 장에 남는다(clo): 부족한 돈을 낮게 읽지 않게.
  assert.match(s, /소득\(DSR\)에 따라 더 필요할 수 있고, 이미 집이 있으면 이 계산이 맞지 않습니다\.$/);
  assert.match(MIN_CASH_RULES, /이미 집이 있으면 규제지역 주택구입 대출은 원칙적으로 막힙니다/);
  assert.match(MIN_CASH_RULES, /6개월 안에 팔기로 약정하면\(처분조건부\) 받을 수 있어/, "갈아타는 1주택자 예외가 없다 (#37)");
  assert.doesNotMatch(s, /LTV 0%/, "예외 없는 단정이 남았다");
  assert.ok(MIN_CASH_RULES.includes(BASIS_DATE));
  assert.match(minCashSentence(15), /생애최초여도 이 가격대는 천장이 같아/, "생애최초 천장이 같은데 '올라'라고 썼다");
});
