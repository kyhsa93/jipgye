import test from "node:test";
import assert from "node:assert/strict";
import { budgetYearOn } from "../scripts/budget-facts.ts";

// 내 예산, 1년 새(#692). 그날 데이터를 읽지 않는다 - 칸을 여기서 만든다(budget-facts.test.mjs 와 같은 규칙).

const MONTHS = ["202506", "202507", "202508"];
const cell = (median, yearAgo) => ({ n: 4, median, ...(yearAgo === undefined ? {} : { yearAgo: { median: yearAgo, n: 3, months: MONTHS } }) });
const file = (district, cells) => ({ district, reference: "202608", cells });

// 8억대 [80000, 90000)
const FILES = [
  file("가구", {
    A: { 59: cell(95000, 85000), 84: cell(120000, 88000) }, // 둘 다 위로 나감
    B: { 59: cell(86000, 82000) }, // 안 → 안
    C: { 59: cell(84000, 70000) }, // 밖(아래) → 안: 들어옴
    D: { 59: cell(83000) }, // 지금 안, 1년 전 값 없음 → 뺌
  }),
  file("나구", {
    E: { 84: cell(91000, 81000) }, // 위로 나감
    F: { 84: cell(79000, 81000) }, // 아래로 나감
    G: { 84: { n: 2 } }, // 범위 없는 칸 - 셀 수 없음
  }),
  file("다구", {
    H: { 84: cell(99000, 89000) }, // 위로 나감
    I: { 84: cell(150000) }, // 지금 밖, 1년 전 값 없음 → 뺀 수에 안 든다
  }),
  file("라구", { J: { 84: cell(93000, 85000) } }), // 위로 나감
];

test("같은 칸을 1년 전과 지금으로 견줘 나간 칸·들어온 칸·뺀 칸을 센다", () => {
  const y = budgetYearOn(FILES, 80000, 90000);
  assert.equal(y.was, 7, "1년 전 8억대 안 칸");
  assert.equal(y.out, 6);
  assert.equal(y.up, 5);
  assert.equal(y.down, 1);
  assert.equal(y.came, 1);
  assert.equal(y.current, 3, "지금 8억대 안 칸(B·C·D) = 단지 후보 수와 같은 정의");
  assert.equal(y.missing, 1, "지금 안인데 1년 전 값이 없는 칸만 뺀 수로 센다");
  assert.deepEqual(y.months, ["202506", "202508"]);
  assert.equal(y.reference, "202608");
});

test("나간 칸이 많은 구 셋 - 구 이름만, 같은 수면 이름순", () => {
  const y = budgetYearOn(FILES, 80000, 90000);
  assert.deepEqual(y.top, [
    { name: "가구", count: 2 },
    { name: "나구", count: 2 },
    { name: "다구", count: 1 },
  ]);
  assert.ok(!JSON.stringify(y).includes('"A"'), "단지 이름이 결과에 들어갔다");
});

test("구간 경계: 하한은 안, 상한은 밖(candidatesInBand 와 같다)", () => {
  const y = budgetYearOn([file("가구", { A: { 84: cell(90000, 80000) } })], 80000, 90000);
  assert.equal(y.was, 1);
  assert.equal(y.up, 1);
});

test("맨 위 구간(max 없음)은 단지 후보처럼 min + 1억", () => {
  const y = budgetYearOn([file("가구", { A: { 84: cell(305000, 301000) } })], 300000, null);
  assert.equal(y.was, 1);
  assert.equal(y.out, 0);
});

test("견줄 칸이 없으면 null, 입력이 없어도 null", () => {
  assert.equal(budgetYearOn([file("가구", { A: { 84: cell(150000, 140000) } })], 80000, 90000), null);
  assert.equal(budgetYearOn([], 80000, 90000), null);
  assert.equal(budgetYearOn(null, 80000, 90000), null);
});
