import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { SITE } from "./helpers/site-root.mjs";
import { RATE_NOTICE_PAGES } from "../scripts/updated-stamp.ts";

const root = path.resolve(import.meta.dirname, "..");
const docs = path.join(root, SITE);

const pages = async () =>
  (await readdir(docs)).filter((f) => f.endsWith(".html")).sort();

// 훅 class 뒤에 유틸리티 class가 더 붙어도 같은 내비로 읽는다(#280).
const navBlock = (html, cls) =>
  new RegExp(`<nav class="${cls}(?: [^"]*)?"[\\s\\S]*?</nav>`).exec(html)?.[0] ?? null;

const links = (block) => [...(block ?? "").matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((m) => ({
  attrs: m[0].slice(0, m[0].indexOf(">")),
  text: m[1].trim(),
}));

// 「금리 비교」는 #577 B2(금감원 자료 제거)로 1층에서 뺐다 - 넷에서 셋.
const SECTION_COUNT = 3;

/**
 * 섹션 넷 가운데 어디에도 속하지 않는 페이지.
 *
 * 방법론은 읽을거리지 섹션이 아니다 — 푸터에서 닿고, 다 읽으면 원래 보던 데이터로
 * 돌아간다. 1층에서 넷 중 하나를 굳이 켜 두면 거기서 왔다는 거짓말이 되고, 다섯 번째
 * 항목으로 올리면 매일 쓰는 네 곳 옆에 한 번 읽고 마는 문서가 끼는 셈이 된다.
 */
// 금리 종료 안내 다섯 장(#577 B2)도 섹션이 아니다 - 지운 주소에 남긴 안내라 1층 어디도 켜지 않는다.
const OUTSIDE_SECTIONS = new Set(["method.html", "about.html", ...RATE_NOTICE_PAGES]);

test("모든 페이지의 1층 내비게이션이 섹션 넷을 넘지 않는다", async () => {
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "page-nav");
    if (!block) continue;
    const items = links(block);
    assert.ok(
      items.length <= SECTION_COUNT,
      `${file}: 1층이 ${items.length}개다(${items.map((i) => i.text).join(", ")}). 세부 분류는 sub-nav로 옮기세요.`
    );
  }
});

test("페이지마다 지금 보고 있는 섹션이 하나만 표시된다", async () => {
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "page-nav");
    if (!block) continue;
    const active = links(block).filter((i) => i.attrs.includes('class="active"'));
    const want = OUTSIDE_SECTIONS.has(file) ? 0 : 1;
    assert.equal(active.length, want, `${file}: 1층 활성 표시가 ${active.length}개다`);
  }
});

test("현재 페이지 표시는 페이지당 하나뿐이다", async () => {
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const blocks = [navBlock(html, "page-nav"), navBlock(html, "sub-nav")].filter(Boolean);
    if (!blocks.length) continue;
    const current = blocks
      .flatMap((b) => links(b))
      .filter((i) => i.attrs.includes('aria-current="page"'));
    assert.ok(
      current.length <= 1,
      `${file}: aria-current가 ${current.length}개다(${current.map((i) => i.text).join(", ")})`
    );
  }
});

test("세부 분류가 있는 페이지는 2층에서 자기 위치를 표시한다", async () => {
  const expected = {
    "news.html": "전체",
    "realestate-news.html": "부동산",
    "stock-news.html": "증시·환율",
    "rate-news.html": "금리",
    "realestate.html": "전체",
    "apartment-sale.html": "매매",
    "apartment-jeonse.html": "전세",
    "apartment-rent.html": "월세",
    "deal-search.html": "실거래 검색",
    "jeonse-vs-wolse.html": "전세 vs 월세",
    "renewal-vs-new.html": "재계약",
    "cancelled-deals.html": "해제·등기",
  };

  for (const [file, label] of Object.entries(expected)) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "sub-nav");
    assert.ok(block, `${file}: 2층 내비게이션이 없다`);
    const current = links(block).filter((i) => i.attrs.includes('aria-current="page"'));
    assert.equal(current.length, 1, `${file}: 2층 현재 표시가 ${current.length}개다`);
    assert.equal(current[0].text, label, `${file}: 2층 현재 표시가 "${current[0].text}"다`);
  }
});

test("시세 계열 페이지의 2층 항목이 서로 같다", async () => {
  const items = async (file) =>
    links(navBlock(await readFile(path.join(docs, file), "utf8"), "sub-nav")).map((i) => i.text);

  const expected = ["전체", "매매", "전세", "월세", "실거래 검색", "전세 vs 월세", "재계약", "해제·등기"];
  for (const file of [
    "realestate.html",
    "apartment-sale.html",
    "district-gangnam.html",
    "deal-search.html",
    "jeonse-vs-wolse.html",
    "cancelled-deals.html",
  ]) {
    assert.deepEqual(await items(file), expected, `${file}: 2층 항목이 다르다`);
  }
});

test("모든 페이지가 세 섹션 서로에게 닿는다", async () => {
  const targets = ["./index.html", "./news.html", "./realestate.html"];
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "page-nav");
    if (!block) continue;
    for (const target of targets) {
      assert.ok(block.includes(`href="${target}"`), `${file}: ${target} 링크가 없다`);
    }
    assert.equal(links(block).length, SECTION_COUNT, `${file}: 1층 항목이 ${SECTION_COUNT}개가 아니다`);
  }
});

test("어느 장의 1층에도 「금리 비교」(rates.html)가 없다 - 금감원 금리 화면을 지웠다 (#577 B2)", async () => {
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "page-nav") ?? "";
    assert.ok(!block.includes("rates.html") && !block.includes("금리 비교"), `${file}: 1층에 금리 비교가 남아 있다`);
    assert.ok(!html.includes('id="nav-rates"') && !html.includes('id="nav-rate-compare"'), `${file}: 옛 내비 id 가 남아 있다`);
  }
});
