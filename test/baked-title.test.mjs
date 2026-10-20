import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES } from "../scripts/budget-pages.ts";
import { DISTRICT_PAGES } from "../scripts/district-slugs.ts";
import { REALESTATE_PAGES } from "../scripts/build-realestate-pages.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

/**
 * 한국어 화면에서 스크립트를 실행한 뒤의 `document.title`은 구운 `<title>`과 같다 (#299).
 *
 * 화면 스크립트 `applyLocale()`이 `document.title = heading`으로 짧은 제목("강남구 아파트 시세")을 덮어써서, 구운 긴 `<title>`
 * ("강남구 아파트 시세 - 매매·전세·월세 실거래가")이 스크립트를 실행하는 수집기·탭·북마크·공유에서 29장 모두 사라졌다.
 * cmo 판정(#299 댓글): 구운 긴 제목이 맞다. 한국어에서는 스크립트가 제목을 건드리지 않고, 영어만 영어 제목을 넣는다.
 *
 * 구운 `<title>`의 출처가 생성 스크립트이고 화면 스크립트가 넣는 글자의 출처가 사전(`T`)이라, 한쪽만 고치면 갈린다.
 * 그래서 그 장에 실려 나간 스크립트를 실제로 돌려(문서에는 구운 `<title>`이 이미 들어 있다) 나온 `document.title`을 견준다.
 * 값은 장 안에서 읽는다 - 목록에서 꺼내 넣으면 장과 목록이 어긋난 것을 못 본다. 데이터·날짜에 기대지 않는다(#8).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const bakedTitle = (html) => {
  const m = /<title>([^<]*)<\/title>/.exec(html);
  assert.ok(m, "<title>이 없다");
  return m[1];
};
const metaOf = (html, name) => new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html)?.[1] ?? null;

/** 영향받은 29장: 틀 1 · 자치구 25 · 거래유형 3. */
const AFFECTED = ["realestate.html", ...DISTRICT_PAGES.map((p) => p.file), ...REALESTATE_PAGES.map((p) => p.file)];
/** 두 글자가 원래 같았던 예산대 18장. 같은 글자라는 것도 함께 지킨다. */
const SAME_TEXT = BUDGET_PAGES.map((p) => p.file);

const load = async (file, locale) => {
  const html = await read(`docs/${file}`);
  const page = await loadRealestatePage({
    file: `docs/${file}`,
    locale,
    kind: metaOf(html, "realestate-kind"),
    district: metaOf(html, "realestate-district"),
    budgetBand: metaOf(html, "budget-band"),
    title: bakedTitle(html),
  });
  return { html, page };
};

test("영향받은 장은 29장이다(틀 1·자치구 25·거래유형 3)", () => {
  assert.equal(AFFECTED.length, 29);
  assert.equal(new Set(AFFECTED).size, 29);
  assert.equal(SAME_TEXT.length, 18);
});

test("한국어 화면: 스크립트를 실행한 뒤의 document.title = 구운 <title> (29장 전수)", async (t) => {
  for (const file of AFFECTED) {
    await t.test(file, async () => {
      const { html, page } = await load(file, "ko");
      const baked = bakedTitle(html);
      assert.equal(page.sandbox.document.title, baked);
      // 짧은 제목(h1)으로 덮이지 않았다는 것: 구운 제목은 h1보다 길다(틀 포함 29장 모두).
      assert.ok(baked.length > page.byId("page-title").textContent.length, `${file}: 구운 제목이 h1보다 길지 않다`);
    });
  }
});

test("한국어 화면: 예산대 18장도 구운 <title>이 그대로다", async (t) => {
  for (const file of SAME_TEXT) {
    await t.test(file, async () => {
      const { html, page } = await load(file, "ko");
      assert.equal(page.sandbox.document.title, bakedTitle(html));
    });
  }
});

test("영어 화면은 지금처럼 영어 제목을 넣는다(틀·자치구·거래유형·예산대 대표 장)", async () => {
  for (const [file, expected] of [
    ["realestate.html", "Seoul Apartment Prices"],
    ["district-gangnam.html", "강남구 apartment prices"],
    ["apartment-sale.html", "Seoul Apartment Sale Prices"],
    ["budget-7eok.html", "Seoul Apartments Around ₩0.7B - Recent Deals"],
  ]) {
    const { page } = await load(file, "en");
    assert.equal(page.sandbox.document.title, expected, file);
    assert.equal(page.sandbox.document.title, page.byId("page-title").textContent, `${file}: 영어에서는 title = h1 (이 PR 전과 같다)`);
  }
});

test("언어를 영어로 바꿨다가 한국어로 돌리면 구운 <title>로 돌아온다", async () => {
  const { html, page } = await load("district-gangnam.html", "ko");
  const baked = bakedTitle(html);
  const toggle = page.byId("lang-toggle");
  toggle.dispatch("click");
  assert.equal(page.sandbox.document.title, "강남구 apartment prices");
  toggle.dispatch("click");
  assert.equal(page.sandbox.document.title, baked);
});
