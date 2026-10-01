import test from "node:test";
import assert from "node:assert/strict";
import { BASIS_DATE, minCash, minCashSentence } from "../scripts/min-cash.mjs";

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

test("문장은 DSR로 더 적게 빌릴 수 있다는 것과 유주택 LTV 0%, 기준일을 적는다", () => {
  const s = minCashSentence(7);
  assert.match(s, /자기 돈이 적어도 4억 6,950만원/);
  assert.match(s, /소득\(DSR\)에 따라 이보다 적을 수/);
  assert.match(s, /LTV 0%/);
  assert.ok(s.includes(BASIS_DATE));
  assert.match(minCashSentence(15), /생애최초여도 이 가격대는 천장이 같아/, "생애최초 천장이 같은데 '올라'라고 썼다");
});
