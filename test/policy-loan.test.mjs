import test from "node:test";
import assert from "node:assert/strict";
import { BASIS_DATE, POLICY_LINES, POLICY_TAIL, lineCounts, policySentence, policyShareSentence } from "../scripts/policy-loan.mjs";

// 선은 마이홈포털(디딤돌)과 한국주택금융공사(보금자리론) 원문에서 손으로 옮긴 것이다.
test("디딤돌은 가격과 면적을 둘 다, 보금자리론은 가격만 본다 — 경계값은 안에 든다", () => {
  const c = lineCounts([
    { amount: 50_000, area: 84.9 }, // 디딤돌 일반·신혼·보금자리 모두 안
    { amount: 50_000, area: 101 }, // 85㎡ 초과 - 디딤돌 밖, 보금자리 안
    { amount: 60_000, area: 59 }, // 신혼 디딤돌·보금자리 안, 일반 디딤돌 밖
    { amount: 60_001, area: 59 }, // 모두 밖
  ]);
  assert.deepEqual(c, { n: 4, didim: 1, family: 2, bogeum: 3, newborn: 3 });
});

test("가격선 아래·걸친 예산대(3~9억대)에만 쓰고, 소득 요건은 적지 않는다고 말한다", () => {
  const counts = { n: 100, didim: 15, family: 23, bogeum: 24 };
  // 3억대는 전부 세 선 아래라 쓸 것이 있다 - 3억대 매수자가 가장 많이 묻는 것이 정책대출이다(PO 2차 #41).
  assert.match(policySentence(3, counts), /3억대\)는 전용 85㎡ 이하라면 디딤돌·보금자리론·신생아 특례 세 상품 모두 가격선 안/);
  assert.doesNotMatch(policySentence(4, counts), /두 상품 모두/, "세 상품을 늘어놓고 '두 상품'이라 했다");
  assert.equal(policySentence(10, counts), null);
  assert.match(policySentence(8, counts), /신생아 특례 선\(9억\) 안/);
  const s5 = policySentence(5, counts);
  assert.match(s5, /5억을 넘는 집은 디딤돌 일반 선 밖/);
  // 가격선 정의·거래 수·소득 단서는 3~9억대 일곱 장 공통이라 method.html 한 자리로 옮겼다(#66). 글자는 그대로다.
  assert.match(policyShareSentence(counts), /15건\(15%\)/);
  assert.match(POLICY_LINES, /디딤돌대출\(주택도시기금\)은 5억 이하/);
  assert.match(POLICY_TAIL, /소득·자산 요건과 한도는 따로/);
  assert.ok(POLICY_TAIL.includes(BASIS_DATE));
  assert.match(s5, /가격선만 본 것이며 소득·자산 요건은 따로 있습니다\.$/, "자격처럼 읽히지 않게 하는 한 줄이 장에 없다");
  assert.doesNotMatch(s5, /한도는 따로|정책대출에는 주택가격 선이 있습니다|\d건/, "옮긴 문단이 장에 또 실렸다");
  assert.match(policySentence(6, counts), /딱 6억인 집 말고는/);
});
