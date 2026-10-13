import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES } from "../scripts/budget-pages.mjs";
import { buildBands } from "../scripts/budget-bands.mjs";
import { DISTRICT_PAGES } from "../scripts/district-slugs.mjs";
import { REALESTATE_PAGES, buildDistrictPage, buildRealestatePage } from "../scripts/build-realestate-pages.mjs";
import { buildBudgetPage } from "../scripts/build-budget-pages.mjs";
import { BASE_H1, bakeHeading, koHeading } from "../scripts/page-heading.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

/**
 * 구운 `h1`이 그 장의 제목이다 (#295).
 *
 * 찍어낸 46장은 틀 `docs/realestate.html`의 `h1`("서울 아파트 시세")을 그대로 물려받았고, 화면 스크립트
 * `applyLocale()`이 열린 뒤에야 그 장의 제목으로 바꿨다. 이제 생성 스크립트가 굽는다.
 *
 * 이 시험이 한 번 확인하고 끝내지 않고 남는 이유: 고친 뒤에는 그 글자의 출처가 **사전**(`T.ko`)과
 * **생성 스크립트** 두 곳이 된다. 한쪽만 고치면 구운 글자와 스크립트가 넣는 글자가 갈리고, 그러면 열자마자
 * 제목이 바뀌며 아래가 밀리던 일이 조용히 돌아온다(#295 완료 조건 5, cpo 권고).
 *
 * 그래서 사전을 읽어 비교하지 않고 **그 장에 실려 나간 스크립트를 실제로 돌려** `h1`에 들어가는 글자를 받아
 * 구운 글자와 견준다. 46장 전수다. 날짜·데이터에 따라 갈리는 값은 쓰지 않는다 — `applyLocale()`은 데이터를
 * 받기 전에 돌고, 제목 문자열은 그날 수집 결과와 무관하다(#8).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

/** 찍어낸 46장: 예산대 18 · 자치구 25 · 거래유형 3. 틀 자신(realestate.html)은 들어가지 않는다(#295 범위 3). */
const GENERATED = [
  ...BUDGET_PAGES.map((p) => p.file),
  ...DISTRICT_PAGES.map((p) => p.file),
  ...REALESTATE_PAGES.map((p) => p.file),
];

const bakedH1 = (html) => {
  const m = /<h1 id="page-title">([\s\S]*?)<\/h1>/.exec(html);
  assert.ok(m, "h1#page-title이 없다");
  return m[1];
};

/** 그 장이 스스로 들고 있는 표시. 시험이 목록에서 꺼내 넣으면 장과 목록이 어긋난 것을 못 본다. */
const metaOf = (html, name) =>
  new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html)?.[1] ?? null;

test("찍어낸 장은 46장이다(예산대 18·자치구 25·거래유형 3)", () => {
  assert.equal(BUDGET_PAGES.length, 18);
  assert.equal(DISTRICT_PAGES.length, 25);
  assert.equal(REALESTATE_PAGES.length, 3);
  assert.equal(GENERATED.length, 46);
  assert.equal(new Set(GENERATED).size, 46);
});

test("틀 realestate.html의 h1은 그대로다", async () => {
  const html = await read("docs/realestate.html");
  assert.ok(html.includes(BASE_H1), "틀의 h1 한 줄이 바뀌었다");
  assert.equal(bakedH1(html), "서울 아파트 시세");
});

test("찍어낸 46장의 구운 h1 = 그 장의 스크립트가 한국어에서 넣는 글자", async (t) => {
  for (const file of GENERATED) {
    await t.test(file, async () => {
      const html = await read(`docs/${file}`);
      const baked = bakedH1(html);

      // 그 장에 실려 나간 인라인 스크립트를 그대로 돌린다(데이터 없음 - applyLocale()은 받기 전에 돈다).
      const page = await loadRealestatePage({
        file: `docs/${file}`,
        locale: "ko",
        kind: metaOf(html, "realestate-kind"),
        district: metaOf(html, "realestate-district"),
        budgetBand: metaOf(html, "budget-band"),
      });

      assert.equal(baked, page.byId("page-title").textContent);
      assert.notEqual(baked, "서울 아파트 시세", "틀의 글자가 그대로 남았다");
    });
  }
});

test("영어로 바꾸면 영어 제목이 그대로 들어온다(구운 한국어 h1은 그 뒤에 덮인다)", async () => {
  for (const [file, expected] of [
    ["docs/budget-7eok.html", "Seoul Apartments Around \u20a90.7B - Recent Deals"],
    ["docs/district-gangnam.html", "강남구 apartment prices"],
    ["docs/apartment-sale.html", "Seoul Apartment Sale Prices"],
  ]) {
    const html = await read(file);
    const page = await loadRealestatePage({
      file,
      locale: "en",
      kind: metaOf(html, "realestate-kind"),
      district: metaOf(html, "realestate-district"),
      budgetBand: metaOf(html, "budget-band"),
    });
    assert.equal(page.byId("page-title").textContent, expected, file);
  }
});

test("생성 스크립트가 굽는 h1은 사전에서 고른 글자다", async () => {
  const base = await read("docs/realestate.html");
  const lowest = BUDGET_PAGES.at(0);
  const budget = {
    periods: ["202608"],
    bands: buildBands([
      { district: "노원구", dong: "하계동", apt: "극동아파트", area: 55.72, floor: 7, amount10k: lowest.min10k + 500, date: "2026-08-14", buildYear: 1988 },
    ]),
  };
  const realestate = {
    updatedAt: "2026-08-17T00:00:00.000Z",
    period: "202608",
    overall: {
      sale: { avgPricePerM2: 13_457_520, avgPricePerPyeong10k: 4449, transactionCount: 575 },
      jeonse: { avgDepositPerM2: 7_777_223, avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
      wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
    },
    districts: [],
  };

  const budgetHtml = buildBudgetPage(base, lowest, budget);
  assert.equal(bakedH1(budgetHtml), lowest.title);
  assert.equal(koHeading(budgetHtml), lowest.title, "예산대는 사전의 title을 그 장 제목으로 바꾼 뒤 굽는다");

  const sale = REALESTATE_PAGES.find((p) => p.kind === "sale");
  const saleHtml = buildRealestatePage(base, sale, realestate);
  assert.equal(bakedH1(saleHtml), "서울 아파트 매매 시세");
  assert.notEqual(bakedH1(saleHtml), sale.title, "h1은 긴 <title>이 아니라 사전의 titleSale이다");

  const district = DISTRICT_PAGES.find((d) => d.name === "강남구");
  const districtHtml = buildDistrictPage(base, district, realestate);
  assert.equal(bakedH1(districtHtml), "강남구 아파트 시세");
  assert.notEqual(bakedH1(districtHtml), `${district.name} 아파트 시세 - 매매·전세·월세 실거래가`, "h1은 긴 <title>이 아니라 사전의 districtTitle이다");
});

test("틀의 h1을 못 찾으면 조용히 틀의 글자를 내보내지 않고 던진다", () => {
  assert.throws(() => bakeHeading("<h1>다른 틀</h1>", "아무 제목"), /h1/);
});

test("사전이 없거나 키가 없으면 던진다", async () => {
  const base = await read("docs/realestate.html");
  assert.throws(() => koHeading("<html></html>"), /한국어 문자열표/);
  assert.throws(() => koHeading(base.replace('    title: "서울 아파트 시세",\n', "")), /title/);
  assert.throws(
    () => koHeading(base.replace("    districtTitle: (name) => `${name} 아파트 시세`,\n", ""), { districtName: "강남구" }),
    /districtTitle/
  );
});

test("한국어 문자열표만 읽는다(영어 블록의 같은 키에 걸리지 않는다)", async () => {
  const base = await read("docs/realestate.html");
  assert.equal(koHeading(base), "서울 아파트 시세");
  assert.equal(koHeading(base, { kind: "wolse" }), "서울 아파트 월세 시세");
  assert.notEqual(koHeading(base, { kind: "sale" }), "Seoul Apartment Sale Prices");
});
