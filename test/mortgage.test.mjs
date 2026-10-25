import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { latestRate, loanHeadSentence, loanSentence, monthlyPayment } from "../scripts/mortgage.ts";
import { budgetLoanHtml } from "../scripts/prerender.ts";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} ≈ ${expected}`.trim());

// 한국은행 ECOS 121Y006(예금은행 주택담보대출 신규취급 평균금리) 계열 모양 - raw/indicators/series.json 의 mortgage_rate (#577).
const SERIES = [
  ["202507", 4.1],
  ["202508", 3.96],
  ["202607", 4.48],
  ["202608", 4.66],
];

test("원리금균등 월 상환액을 낸다", () => {
  // 1억(10,000만원)을 30년 5.11%로 빌리면 매달 54.36만원이다.
  near(monthlyPayment(10_000, 5.11, 30), 54.36, 0.02, "1억 30년 5.11%");
  // 기간이 짧아지면 매달 더 낸다.
  assert.ok(monthlyPayment(10_000, 5.11, 20) > monthlyPayment(10_000, 5.11, 30));
});

test("금리가 0이어도 무너지지 않는다", () => {
  // 실무에 0%는 없지만 값이 비어 온 날 Number("")가 0이 되어 흘러드는 것을 이미 겪었다.
  near(monthlyPayment(3_600, 0, 30), 10, 0.001, "원금을 개월로 나눈 값");
  assert.equal(monthlyPayment(0, 5), null);
  assert.equal(monthlyPayment(10_000, Number.NaN), null);
});

test("ECOS 평균금리 계열의 가장 최근 달을 쓴다 (#577)", () => {
  assert.deepEqual(latestRate(SERIES), { rate: 4.66, month: "202608" });
  // 숫자 문자열도 숫자로 읽는다(수집 원본이 문자열일 수 있다).
  assert.deepEqual(latestRate([["202608", "4.5"]]), { rate: 4.5, month: "202608" });
});

test("비거나 0 이하인 달은 0%로 세지 않고 건너뛴다 (#269)", () => {
  // Number(null)·Number("")·Number(false)·Number([])는 모두 0이다 - 값 없음이 0%로 흘러들면 월 상환액이 원금÷개월이 된다.
  for (const empty of [null, undefined, "", "  ", false, true, [], 0, -1, "abc", Number.NaN]) {
    assert.deepEqual(latestRate([["202607", 4.48], ["202608", empty]]), { rate: 4.48, month: "202607" }, `빈 값 ${JSON.stringify(empty)}을 썼다`);
  }
  // 달이 YYYYMM 이 아니면 그 줄을 쓰지 않는다.
  assert.deepEqual(latestRate([["202607", 4.48], ["2026-08", 5]]), { rate: 4.48, month: "202607" });
});

test("계열이 없거나 쓸 달이 없으면 문장을 만들지 않는다", () => {
  for (const series of [null, undefined, [], {}, "x", [["202608", null]], [null, 5]]) {
    assert.equal(latestRate(series), null, JSON.stringify(series));
    assert.equal(loanHeadSentence(latestRate(series)), null);
    assert.equal(loanSentence(latestRate(series), { eok: 10 }), null);
  }
  // 금리가 숫자가 아니면(직접 넘긴 값) 문장이 없다.
  assert.equal(loanHeadSentence({ rate: "4.66", month: "202608" }), null);
});

test("1억당 문장은 한국은행 ECOS 평균금리와 그 달을 근거로 적는다 (#577)", () => {
  const head = loanHeadSentence(latestRate(SERIES));
  assert.equal(
    head,
    "1억을 30년 원리금균등으로 빌리면 매달 52만원입니다. 한국은행 ECOS 주택담보대출 신규취급 평균금리 2026년 8월 연 4.66% 기준입니다. " +
      "시장 평균 금리라, 개인이 받는 금리는 신용·우대조건에 따라 이와 다릅니다."
  );
  // 금감원 공시 상품 근거(상품 수·최저금리 범위)는 더 쓰지 않는다.
  assert.doesNotMatch(head, /상품|최저금리|중앙값|금융감독원/);
  // 달을 모르면 달 없이 적는다.
  assert.match(loanHeadSentence({ rate: 4.66 }), /평균금리 연 4\.66% 기준입니다/);
});

test("금리가 없으면 문단을 만들지 않는다", () => {
  // 금리 수집이 실패한 날에도 예산 페이지 자체는 나와야 한다.
  assert.equal(latestRate([]), null);
  assert.equal(loanSentence(null, { eok: 10 }), null);
  assert.equal(budgetLoanHtml({ min10k: 100_000 }, null), "");
});

test("한도는 가정하지 않고 1억당 값으로 말한다", () => {
  const sentence = loanSentence(latestRate(SERIES), { eok: 10 });
  assert.match(loanHeadSentence(latestRate(SERIES)), /^1억을 30년 원리금균등으로/);
  assert.match(sentence, /1억당 값을 곱하시면/);
  // 소득에 갈리는 한도(DSR)를 하나로 정해 적으면 해마다 조용히 틀린 화면이 된다 - 갈린다고만 적는다.
  assert.match(sentence, /소득\(DSR\)에 따라 갈리므로 여기서는 정하지 않고/);
  assert.doesNotMatch(sentence, /LTV/);
});

test("예산 페이지에 월 상환액 문단이 붙어 있다", async () => {
  const html = await readFile(path.join(root, `${SITE}/budget-10eok.html`), "utf8");
  assert.match(html, /<p class="budget-loan" data-prerendered(="")?>/, "예산 페이지에 문단이 없다(또는 화면이 다시 그릴 때 지워지지 않게 하는 표시가 없다)");
  // 1억당 값·금리 범위는 열여덟 장 공통이라 method.html 한 자리로 옮겼다(#66). 장에는 한눈에 줄과 링크가 남는다.
  assert.doesNotMatch(html, /1억을 30년 원리금균등으로 빌리면 매달/, "옮긴 문단이 장에 또 실렸다");
  assert.match(html, /href="\.\/method\.html#budget-rules-loan"/);
  assert.match(html, /answer-label">1억을 빌리면 매달/);
  const method = await readFile(path.join(root, `${SITE}/method.html`), "utf8");
  assert.match(method, /id="budget-rules-loan"[\s\S]*1억을 30년 원리금균등으로 빌리면 매달/, "옮겨 간 자리에 문단이 없다");
  // 금리 근거는 한국은행 ECOS 평균금리다(#577) - 장의 한눈에 줄도 출처를 적는다.
  assert.match(method, /id="budget-rules-loan"[\s\S]*한국은행 ECOS 주택담보대출 신규취급 평균금리/);
  assert.match(html, /answer-note">30년 원리금균등, 한국은행 평균 연 [0-9.]+%\(\d{4}년 \d{1,2}월\)</);
});
