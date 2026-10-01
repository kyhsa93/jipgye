import test from "node:test";
import assert from "node:assert/strict";
import { BASIS_DATE, capFor, capSentence, clustering } from "../scripts/loan-cap.mjs";

// 상한은 금융위원회 원문(10·15 대책, '26년도 가계부채 관리방안)에서 손으로 옮긴 것이다.
test("15억 '이하'는 6억, 25억 이하는 4억, 그 위는 2억", () => {
  assert.equal(capFor(150_000), 60_000, "정확히 15억은 아래 구간이다");
  assert.equal(capFor(150_001), 40_000);
  assert.equal(capFor(250_000), 40_000);
  assert.equal(capFor(250_001), 20_000);
});

const deals = (amount, n, date = "2026-01-01") => Array.from({ length: n }, () => ({ date, amount }));

test("15억 몰림은 이웃 경계(14억·16억)의 비와 견준다 — 어림수 몫을 뺀다", () => {
  const data = [
    // 각 경계 바로 아래(경계 포함) : 바로 위 = 14억 2:1, 15억 4:1, 16억 2:1
    ...deals(140_000, 200), ...deals(141_000, 100),
    ...deals(150_000, 400), ...deals(151_000, 100),
    ...deals(160_000, 200), ...deals(161_000, 100),
    // 대책 전 거래는 세지 않는다
    ...deals(150_000, 5000, "2025-09-01"),
  ];
  const s = clustering(data);
  assert.equal(s.ratio, 4);
  assert.equal(s.neighbour, 2);
  assert.equal(s.times, 2);
});

test("표본이 모자라면 몰림을 말하지 않는다", () => {
  assert.equal(clustering([...deals(150_000, 10), ...deals(151_000, 5)]), null);
});

test("15억 경계에 걸친 예산대에만, LTV·DSR로 더 낮을 수 있다는 말과 기준일을 붙인다", () => {
  assert.equal(capSentence(10, null), null);
  assert.equal(capSentence(25, null), null, "예산대 장은 20억대까지라 그 위는 쓸 일이 없다");
  const s14 = capSentence(14, { since: "2025-10-16", times: 1.7 });
  assert.match(s14, /6억에서 4억으로/);
  assert.match(s14, /이웃 경계\(14억·16억\)의 1.7배/);
  assert.match(s14, /LTV와 소득\(DSR\)/);
  assert.ok(s14.includes(BASIS_DATE));
  assert.match(capSentence(15, null), /상한이 4억입니다/);
});

test("예산대 '절반을 빌린다면' 예시는 그 가격대 상한을 넘지 않는다 (#29)", async () => {
  const { loanSentence } = await import("../scripts/mortgage.mjs");
  const spread = { low: 4, mid: 5, high: 6, count: 10 };
  assert.match(loanSentence(spread, { eok: 10 }), /절반인 5억을 빌린다면/);
  const s16 = loanSentence(spread, { eok: 16 });
  assert.match(s16, /상한인 4억을 빌린다면/, "16억대에 8억 대출 예시를 냈다");
  assert.doesNotMatch(s16, /8억을 빌린다면/);
  assert.match(loanSentence(spread, { eok: 14 }), /상한인 6억을 빌린다면/);
  assert.doesNotMatch(s16, /규제지역인지와 소득에 따라/, "낡은 문장이 남았다");
});

test("16~20억대에도 4억 천장 한 줄", () => {
  assert.match(capSentence(18, null), /상한은 4억입니다/);
  assert.match(capSentence(20, null), /소득\(DSR\)/);
});
