import test from "node:test";
import assert from "node:assert/strict";
import { budgetYearOn, budgetFactSentences, withYearOn } from "../scripts/budget-facts.ts";

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

// ---- 문장(R) ----

const yearOnText = (facts, locale) => budgetFactSentences(facts, locale).join(" ");

test("완료 조건 1~3: n칸 → 밖 a칸(x%), 밖→안 b칸, 나간 칸 상위 구, 뺀 칸 수, 같은 칸 한 줄", () => {
  const facts = { yearOn: budgetYearOn(FILES, 80000, 90000) };
  const ko = yearOnText(facts, "ko");
  assert.match(ko, /1년 전\(2025년 6~8월 중앙값\) 이 예산 안이던 7칸 가운데 6칸\(86%\)이 지금\(2026년 8월 값으로 고친 중앙값\)은 밖으로 나갔고\(그 가운데 1칸은 아래로\), 밖에서 들어온 칸은 1칸입니다\./);
  assert.match(ko, /나간 칸은 가구 2칸·나구 2칸·다구 1칸 순으로 많습니다\./);
  assert.match(ko, /지금 이 예산 안 3칸 가운데 1년 전 같은 칸 거래가 3건이 안 돼 값이 없는 1칸은 뺐습니다\./);
  assert.match(ko, /칸마다 자기 자신과 견준 것이라/);
  const en = yearOnText(facts, "en");
  assert.match(en, /of the 7 cells inside this budget a year ago \(Jun–Aug 2025 median\), 6 \(86%\) are now outside it \(Aug 2026-adjusted median\), 1 of them below it, and 1 moved in from outside\./);
  assert.match(en, /mostly in 가구 \(2\), 나구 \(2\), 다구 \(1\)\./);
  for (const apt of ["A", "B", "E", "H", "J"]) assert.doesNotMatch(ko, new RegExp(`(^|[^가-힣A-Za-z])${apt}([^A-Za-z]|$)`), `단지 이름 ${apt}을 적었다`);
});

test("두 언어가 같은 개수의 문장을 낸다 - 1년 전 안 칸이 없을 때·나간 칸이 없을 때·뺀 칸이 없을 때도", () => {
  const cases = [
    budgetYearOn(FILES, 80000, 90000),
    { was: 0, out: 0, up: 0, down: 0, came: 4, current: 4, missing: 0, top: [], months: null, reference: null },
    { was: 3, out: 0, up: 0, down: 0, came: 0, current: 5, missing: 2, top: [], months: ["202412", "202502"], reference: "202608" },
  ];
  for (const yearOn of cases) {
    const ko = budgetFactSentences({ yearOn }, "ko");
    const en = budgetFactSentences({ yearOn }, "en");
    assert.equal(ko.length, en.length);
    assert.ok(ko.length >= 2);
  }
  assert.match(yearOnText({ yearOn: cases[1] }, "ko"), /이 예산 안이던 칸은 없고 지금 밖에서 들어온 칸이 4칸입니다/);
  assert.match(yearOnText({ yearOn: cases[2] }, "ko"), /2024년 12월~2025년 2월/);
  assert.match(yearOnText({ yearOn: cases[2] }, "en"), /Dec 2024–Feb 2025/);
});

test("withYearOn: 사실 문단 끝에 붙고 원본 band 는 그대로, 견줄 칸이 없으면 band 그대로", () => {
  const band = { min10k: 80000, max10k: 90000, facts: { total: 3 } };
  const next = withYearOn(band, FILES);
  assert.equal(band.facts.yearOn, undefined, "원본을 바꿨다");
  assert.equal(next.facts.total, 3);
  assert.equal(next.facts.yearOn.was, 7);
  const sentences = budgetFactSentences(next.facts, "ko");
  assert.match(sentences.at(-1), /착시는 섞이지 않습니다/, "1년 비교가 사실 문장 뒤가 아니다");
  assert.equal(withYearOn(band, []), band);
  assert.equal(withYearOn(null, FILES), null);
  assert.equal(withYearOn({ min10k: 80000, max10k: 90000, facts: null }, FILES).facts.yearOn.was, 7, "facts 가 없어도 1년 비교는 낸다");
});
