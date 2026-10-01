import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { candidatesInBand } from "../scripts/complex-price.mjs";
import { CANDIDATE_LIST, budgetCandidatesHtml } from "../scripts/prerender.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

const cell = (median, n = 5) => ({ n, median, low: median - 1000, high: median + 1000, quartile: n >= 5, raw: median - 2000, unadjusted: 0 });
const FILES = [
  {
    district: "노원구",
    reference: "202608",
    cells: { 가: { "59.9": cell(65000, 20), "84.9": cell(80000) }, 나: { "59.9": cell(69000, 7), "84.9": { n: 2 } } },
    meta: { 가: { dong: "상계동", buildYear: 2001 }, 나: { dong: "중계동", buildYear: 2020 } },
  },
  { district: "강서구", reference: "202608", cells: { 다: { "59.9": cell(60000, 9) } }, meta: { 다: { dong: "등촌동", buildYear: 1994 } } },
];

test("고친 중앙값이 예산대 안인 칸만, 거래가 많은 순으로", () => {
  const rows = candidatesInBand(FILES, 60000, 70000);
  assert.deepEqual(rows.map((r) => `${r.apt}${r.area}`), ["가59.9", "다59.9", "나59.9"]);
  assert.equal(rows[0].dong, "상계동");
  assert.ok(!rows.some((r) => r.apt === "나" && r.area === 84.9), "범위를 못 낸 칸이 후보에 들어갔다");
});

test("예산대 절은 화면이 다시 그려도 남도록 표시하고, 구별로 묶고, 나머지는 검색으로 보낸다", () => {
  const html = budgetCandidatesHtml({ min10k: 60000, max10k: 70000 }, FILES);
  assert.match(html, /^<section class="budget-candidates" data-prerendered>/);
  assert.match(html, /서울에 3곳/);
  assert.match(html, /자치구별: 노원구 2 · 강서구 1/);
  assert.match(html, /deal-search\.html\?budget=6&amp;group=1/);
  assert.match(html, /3번 이상/);

  const many = [{ district: "노원구", reference: "202608", cells: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`단지${i}`, { "59.9": cell(65000) }])) }];
  const list = budgetCandidatesHtml({ min10k: 60000, max10k: 70000 }, many);
  assert.equal((list.match(/<li /g) ?? []).length, CANDIDATE_LIST, "열여덟 장이 긴 목록을 똑같이 싣는다");
});

test("후보 목록은 평형대를 고루 싣고, 평형대별 개수를 적는다", () => {
  const cells = {};
  for (let i = 0; i < 20; i += 1) cells[`소형${i}`] = { "49.9": cell(65000, 50 - i) };
  for (let i = 0; i < 3; i += 1) cells[`중형${i}`] = { "84.9": cell(65000, 6) };
  cells.대형 = { "114.9": cell(65000, 5) };
  const html = budgetCandidatesHtml({ min10k: 60000, max10k: 70000 }, [{ district: "노원구", reference: "202608", cells }]);
  assert.match(html, /평형대별: 60㎡ 미만 20 · 60~85㎡ 3 · 85㎡ 초과 1/);
  assert.equal((html.match(/<li /g) ?? []).length, CANDIDATE_LIST, "모자란 평형대 자리를 채우지 않았다");
  assert.match(html, /중형0/, "거래 적은 중형이 소형에 밀려 빠졌다");
  assert.match(html, /대형/, "대형이 빠졌다");
});

test("후보가 없으면 그렇다고 적는다", () => {
  assert.match(budgetCandidatesHtml({ min10k: 300000, max10k: 310000 }, FILES), /단지·평형이 없습니다/);
});

async function page(query) {
  const [budget, search, deals, rents] = await Promise.all([readJson("budget-deals"), readJson("deal-search"), readJson("deals-nowon"), readJson("rents-nowon")]);
  const p = await loadDealSearchPage({ budget, search, deals: { 노원구: deals }, rents: { 노원구: rents }, complexPrices: { 노원구: FILES[0] }, query });
  for (let i = 0; i < 300; i += 1) await new Promise((r) => setTimeout(r, 5));
  return p;
}

test("검색에서 단지로 묶어 보면 조건에 맞는 단지·평형이 나온다", async () => {
  const p = await page("?group=1&district=노원구&budget=6");
  const html = p.resultHtml();
  assert.match(html, /조건에 맞는 단지·평형 2곳/);
  assert.match(html, /상계동 · 59\.9㎡ · 2001년/);
  assert.doesNotMatch(html, /84\.9㎡/, "8억대 칸이 6억대 결과에 섞였다");
});

test("묶어 본 결과가 비면 조건 하나씩을 풀었을 때 몇 곳인지 준다", async () => {
  // 8억대는 2001년 '가' 84.9㎡ 하나뿐이고, 10년 이내 단지는 2020년 '나'뿐(8억대 칸은 범위가 없다).
  const p = await page("?group=1&district=노원구&budget=8&age=10");
  const html = p.resultHtml();
  assert.match(html, /이 조건에 맞는 단지·평형이 없습니다/);
  assert.match(html, /연식 조건을 풀면 1곳/);
  assert.match(html, /예산 조건을 풀면 1곳/);
  assert.match(html, /서울 전체/, "자치구를 넓혀 보라는 말이 없다");
});

test("풀어도 0곳인 조건은 권하지 않는다", async () => {
  // 5년 이내 단지가 하나도 없으니 예산을 풀어도 0곳이다 - "예산 조건을 풀면 0곳"은 막다른 길을 하나 더 주는 것이다.
  const p = await page("?group=1&district=노원구&budget=6&age=5");
  const html = p.resultHtml();
  assert.match(html, /연식 조건을 풀면 2곳/);
  assert.doesNotMatch(html, /예산 조건을 풀면/);
});
