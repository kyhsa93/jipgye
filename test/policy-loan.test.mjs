import test from "node:test";
import assert from "node:assert/strict";
import { BASIS_DATE, lineCounts, policySentence } from "../scripts/policy-loan.mjs";

// 선은 마이홈포털(디딤돌)과 한국주택금융공사(보금자리론) 원문에서 손으로 옮긴 것이다.
test("디딤돌은 가격과 면적을 둘 다, 보금자리론은 가격만 본다 — 경계값은 안에 든다", () => {
  const c = lineCounts([
    { amount: 50_000, area: 84.9 }, // 디딤돌 일반·신혼·보금자리 모두 안
    { amount: 50_000, area: 101 }, // 85㎡ 초과 - 디딤돌 밖, 보금자리 안
    { amount: 60_000, area: 59 }, // 신혼 디딤돌·보금자리 안, 일반 디딤돌 밖
    { amount: 60_001, area: 59 }, // 모두 밖
  ]);
  assert.deepEqual(c, { n: 4, didim: 1, family: 2, bogeum: 3 });
});

test("가격선에 걸친 예산대(4·5·6억대)에만 쓰고, 소득 요건은 적지 않는다고 말한다", () => {
  const counts = { n: 100, didim: 15, family: 23, bogeum: 24 };
  assert.equal(policySentence(3, counts), null);
  assert.equal(policySentence(7, counts), null);
  const s5 = policySentence(5, counts);
  assert.match(s5, /5억을 넘는 집은 디딤돌 일반 선 밖/);
  assert.match(s5, /15건\(15%\)/);
  assert.match(s5, /소득·자산 요건과 한도는 따로/);
  assert.ok(s5.includes(BASIS_DATE));
  assert.match(policySentence(6, counts), /딱 6억인 집 말고는/);
});
