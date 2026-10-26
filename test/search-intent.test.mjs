// V12 #658: 예산대 장의 「단지 후보가 많은 구」 줄·맨 위 안내·자치구 링크 순서, 예산대·자치구 장의 description, 손 틀 제목.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AREA_DISTRICTS, areaLine, areasShape, budgetLeadText, districtOrder } from "../scripts/budget-fragments.ts";
import { BUDGET_PAGES, budgetDescription } from "../scripts/budget-pages.ts";
import { districtDescription } from "../scripts/build-realestate-pages.ts";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cell = (median, n = 5) => ({ n, median, low: median - 1000, high: median + 1000, quartile: n >= 5 });
const FILES = [
  {
    district: "노원구",
    reference: "202609",
    cells: { 가: { "59.9": cell(65000, 20), "84.9": cell(66000, 9) }, 나: { "59.9": cell(69000, 7) }, 라: { "39.6": cell(61000, 4) } },
    meta: { 가: { dong: "상계동", buildYear: 1988 }, 나: { dong: "중계동", buildYear: 1995 }, 라: { dong: "상계동", buildYear: 1987 } },
  },
  { district: "강서구", reference: "202609", cells: { 다: { "84.2": cell(60000, 9) } }, meta: { 다: { dong: "등촌동", buildYear: 1994 } } },
  { district: "강남구", reference: "202609", cells: { 마: { "84.9": cell(250000, 9) } }, meta: { 마: { dong: "대치동", buildYear: 1979 } } },
];
const BAND6 = { min10k: 60000, max10k: 70000, count: 12, districts: [{ name: "강서구", count: 7 }, { name: "노원구", count: 5 }] };

test("단지 후보가 많은 구: 예산대 안의 후보만, 후보가 많은 구부터, 동·연식·전용 가운데값·거래가 많은 단지", () => {
  const areas = areasShape(BAND6, FILES);
  assert.deepEqual(areas.map((a) => [a.district, a.count]), [["노원구", 4], ["강서구", 1]], "예산대 밖(강남구) 후보가 들어갔거나 순서가 다르다");
  const [nowon] = areas;
  assert.deepEqual(nowon.dongs, ["상계동", "중계동"], "후보가 많은 동부터");
  assert.deepEqual(nowon.years, [1987, 1995]);
  assert.equal(nowon.area, 59, "가운데값은 소수를 버린다(59.9㎡ → 59㎡)");
  assert.deepEqual(nowon.apts, ["가", "나"], "거래가 많은 단지 둘, 같은 단지는 한 번");
  assert.equal(areaLine(nowon), "노원구 4곳 — 1987~1995년 준공, 전용 가운데값 59㎡, 상계동·중계동. 거래가 많은 곳: 가·나");
  assert.equal(areaLine(areas[1]), "강서구 1곳 — 1994년 준공, 전용 가운데값 84㎡, 등촌동. 거래가 많은 곳: 다");
  assert.ok(AREA_DISTRICTS >= 3);
  assert.deepEqual(areasShape(null, FILES), []);
  assert.deepEqual(areasShape(BAND6, []), []);
});

test("예산대 장 맨 위 안내: 후보가 많은 세 구와 그 구의 동, 120자 이하, 후보가 없으면 null(틀 문장 유지)", () => {
  const lead = budgetLeadText(BAND6, FILES);
  assert.equal(lead, "6억대로 살 수 있는 단지·평형은 노원구(상계동)·강서구(등촌동)에 가장 많습니다. 매물 호가가 아니라 국토교통부에 신고된 실거래입니다.");
  assert.ok(lead.length <= 120);
  assert.equal(budgetLeadText({ min10k: 900000, max10k: 1000000 }, FILES), null);
});

test("자치구 링크 순서는 이 예산대 거래가 많은 구부터", () => {
  assert.deepEqual(districtOrder(BAND6), ["강서구", "노원구"]);
  assert.deepEqual(districtOrder(null), []);
});

test("예산대 description: 데이터가 있으면 답(구·후보 수·거래 수)을 앞에, 없으면 고정 문장", () => {
  const page = BUDGET_PAGES.find((p) => p.eok === 6);
  const text = budgetDescription(page, { deals: 1234, candidates: 257, places: ["노원구", "구로구"] });
  assert.match(text, /^6억대\(6억~7억\)로 살 수 있는 단지·평형은 노원구·구로구에 가장 많습니다\./);
  assert.match(text, /단지·평형 257곳과 최근 신고된 매매 1,234건/);
  assert.equal(budgetDescription(page, { deals: 0, candidates: 0, places: [] }), page.description);
});

test("자치구 description: 매매 84㎡ 환산가와 값을 낸 구 가운데 순서, 값이 없으면 고정 문장", () => {
  const re = { districts: [{ name: "가구", sale: { avgPricePerPyeong10k: 5000, transactionCount: 30 } }, { name: "나구", sale: { avgPricePerPyeong10k: 3000, transactionCount: 30 } }, { name: "다구" }] };
  const text = districtDescription("나구", re);
  assert.match(text, /^나구 아파트값은 얼마인가 - 매매 84㎡ 환산 .+원으로 값을 낸 서울 2개 구 가운데 비싼 순 2번째\./);
  assert.match(districtDescription("다구", re), /^다구 아파트 매매·전세·월세 실거래가를/);
});

test("구운 예산대 장: 안내·사전·자치구 링크 머리글이 같은 글자이고, description 이 그 장의 숫자를 싣는다", async () => {
  const html = await readFile(path.join(root, SITE, "budget-6eok.html"), "utf8");
  const baked = /<p id="method-callout-text" class="tw:text-fg">([^<]*)<\/p>/.exec(html)?.[1];
  assert.ok(baked && baked.startsWith("6억대로 살 수 있는 단지·평형은 "), "맨 위 안내가 예산대 문장이 아니다");
  assert.ok(html.includes(`methodCalloutText:\n      ${JSON.stringify(baked)},`), "한국어 사전이 구운 안내와 다르다 - 화면 스크립트가 되돌린다");
  assert.ok(html.includes('otherDistricts: "자치구별 시세 보기 (이 예산대 거래가 많은 구부터)",'), "자치구 링크 머리글 사전");
  assert.match(html, /<meta name="description" content="6억대\(6억~7억\)로 살 수 있는 단지·평형은 /);
  assert.match(html, /<section class="budget-dist" data-prerendered=""><h3>구별 분포<\/h3>[^]*?<div class="budget-areas"><p>단지 후보가 많은 구:<\/p><ul><li>/); // #745 PR7: 구별 분포 절 안
});

test("색인 손 틀 제목은 서로 다르고, 메인 제목에 「금리」가 없다", async () => {
  const files = ["index", "about", "cancelled-deals", "floor-gap", "jeonse-vs-wolse", "method", "price-outlook", "realestate", "record-high", "renewal-vs-new", "switch-house"];
  const titles = await Promise.all(files.map(async (f) => /<title>([^<]*)<\/title>/.exec(await readFile(path.join(root, "docs", `${f}.html`), "utf8"))?.[1]));
  assert.equal(new Set(titles).size, titles.length, `제목 중복: ${titles.join(" | ")}`);
  assert.ok(!titles[0].includes("금리"), titles[0]);
});
