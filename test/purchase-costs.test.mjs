import test from "node:test";
import assert from "node:assert/strict";
import {
  BASIS_DATE,
  acquisitionRate,
  brokerFee,
  costsSentence,
  educationRate,
  purchaseCosts,
} from "../scripts/purchase-costs.mjs";

// 값은 법령 원문에서 손으로 옮긴 것이다(지방세법 제11조 제1항 제8호, 제151조; 농어촌특별세법 제5조;
// 공인중개사법 시행규칙 별표 1). 계산 코드와 같은 식으로 기대값을 만들면 검사가 아니다.

test("취득세율: 6억 이하 1%, 9억 초과 3%, 그 사이는 법이 정한 식", () => {
  assert.equal(acquisitionRate(60000), 1);
  assert.equal(acquisitionRate(75000), 2, "(7.5억 × 2/3억 - 3) × 1/100 = 2%");
  assert.equal(acquisitionRate(80000), 2.33, "8억은 2.3333...%를 소수점 넷째 자리(비율) 반올림 - 2.33%");
  assert.equal(acquisitionRate(90000), 3, "9억은 '9억 이하' 식으로 정확히 3%");
  assert.equal(acquisitionRate(90001), 3);
});

test("지방교육세는 주택 유상취득 세율의 10분의 1", () => {
  assert.equal(educationRate(60000), 0.1);
  assert.equal(educationRate(100000), 0.3);
});

test("농어촌특별세는 전용 85㎡를 넘을 때만 0.2%", () => {
  assert.equal(purchaseCosts(100000).rural, 0);
  assert.equal(purchaseCosts(100000, { over85: true }).rural, 200);
});

test("중개보수 상한: 구간별 요율과 한도액", () => {
  assert.deepEqual(brokerFee(4000), { rate: 0.6, fee: 24 });
  assert.deepEqual(brokerFee(18000), { rate: 0.5, fee: 80 }, "1.8억 × 0.5% = 90만원이지만 한도 80만원");
  assert.deepEqual(brokerFee(50000), { rate: 0.4, fee: 200 });
  assert.deepEqual(brokerFee(110000), { rate: 0.5, fee: 550 });
  assert.deepEqual(brokerFee(130000), { rate: 0.6, fee: 780 });
  assert.deepEqual(brokerFee(150000), { rate: 0.7, fee: 1050 }, "15억 '이상'은 0.7%");
});

test("문단은 무주택 한 채 기준이라는 것과 기준일을 적는다", () => {
  const text = costsSentence(11);
  assert.match(text, /집이 없던 사람이 11억 5,000만원짜리를/);
  assert.match(text, /4,370만원/, "11.5억: 취득세·교육세 3,795 + 중개보수 575");
  assert.match(text, /중과/, "다주택 중과로 계산이 안 맞는다는 말이 없다");
  assert.ok(text.includes(BASIS_DATE), "원문을 대조한 날이 문장에 없다");
});
