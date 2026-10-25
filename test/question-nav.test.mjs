import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const indexHtml = () => readFile(path.join(root, `${SITE}/index.html`), "utf8");

const links = async () => {
  const html = await indexHtml();
  const block = /<nav class="question-nav(?: [^"]*)?"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...block.matchAll(/<a id="([^"]+)" href="([^"]+)">([^<]*)<\/a>/g)].map((m) => ({
    id: m[1],
    href: m[2],
    text: m[3],
  }));
};

test("질문 입구가 첫 화면에 있다", async () => {
  const items = await links();
  assert.ok(items.length >= 5, `질문이 ${items.length}개뿐이다`);
  for (const item of items) {
    assert.match(item.text, /[가-힣]/, `${item.id}에 글이 없다`);
  }
});

test("질문은 조건을 넣지 않아도 답이 보이는 화면으로 보낸다", async () => {
  // 빈 화면으로 보내면 질문을 누른 사람이 다시 막힌다. 실거래 검색만 예외인데,
  // 그건 "조건을 걸어 찾기"라고 적혀 있어 무엇을 해야 하는지 알고 들어간다.
  const files = new Set((await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html")));
  const items = await links();

  for (const item of items) {
    const file = item.href.replace("./", "");
    assert.ok(files.has(file), `${item.id}가 없는 페이지 ${file}로 보낸다`);
    if (file === "deal-search.html") continue;
    const html = await readFile(path.join(root, SITE, file), "utf8");
    assert.ok(
      /<!--prerender:[a-zA-Z]+-->[\s\S]{40,}?<!--\/prerender/.test(html),
      `${file}이 미리 그려 둔 답 없이 비어 있다`
    );
  }
});

test("데이터 섹션보다 앞에 있다", async () => {
  const html = await indexHtml();
  assert.ok(
    html.indexOf('class="question-nav') < html.search(/<section id="/), // 닫는 따옴표를 뺀 접두사: 훅 class 뒤에 유틸리티 class 가 붙어도 같은 입구다(#398)
    "질문 입구가 표 밑에 있다"
  );
});

test("여섯 개가 스크롤 없이 한눈에 보인다", async () => {
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const block = /\.question-nav \{([^}]*)\}/.exec(css)?.[1] ?? "";

  // 전에는 한 줄로 접어 가로로 밀게 했다. 사이트에서 제일 눌려야 하는 자리를
  // 스크롤 뒤에 감춰 두면 뒤의 셋은 없는 것이나 같다.
  assert.match(block, /display: grid/, "질문 입구가 격자가 아니다");
  assert.doesNotMatch(block, /overflow-x: auto/, "질문 입구가 아직 가로로 잘린다");
  assert.ok(!css.includes(".question-nav.scroll-"), "가로 페이드 규칙이 남아 있다");
});

test("영어 화면에서는 질문도 영어다", async () => {
  const load = (storage) =>
    loadIndexPage({ storage, fetch: async () => ({ ok: false, json: async () => ({}) }) });
  const items = await links();

  const ko = await load();
  const en = await load({ lang: "en" });
  for (const item of items) {
    assert.match(ko.byId(item.id).textContent, /[가-힣]/, `${item.id} 한국어가 비었다`);
    assert.match(en.byId(item.id).textContent, /^[\x20-\x7E₩]+$/, `${item.id} 영어 화면에 한국어가 남았다`);
  }
});

test("질문 입구는 장면별 세 묶음이고, 사는 사람 묶음의 첫 질문이 예산이다 (#44)", async () => {
  // #575 안 B 1단계: 묶음은 <div>+<h3> 에서 <details>+<summary>(상황 단추)로 바뀌었다. 묶음 셋·순서·예산이 첫 질문인 것은 그대로다.
  const html = await indexHtml();
  const block = /<nav class="question-nav(?: [^"]*)?"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  const groups = [...block.matchAll(/<details class="question-group"[^>]*>([\s\S]*?)<\/details>/g)].map((m) => m[1]);
  assert.equal(groups.length, 3, "묶음이 셋이 아니다");
  assert.match(groups[0], /집을 사려는 사람<\/summary>\s*<div class="question-links">\s*<a id="q-budget"/, "예산 질문이 맨 앞이 아니다");
  assert.match(groups[1], /전월세/);
  assert.match(groups[2], /옮기거나 파는/);
  assert.ok(!block.includes("deposit-rates"), "예금 질문은 금리 탭에 있다 - 질문 입구에서 뺐다");

  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const links = /\.question-links \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(links, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, "펼친 질문이 모바일에서 한 줄씩 늘어선다");
});

test("첫 화면은 질문 하나와 상황 단추 셋이다 - 질문 열은 접힌 <details> 안에 JS 없이 (#575 안 B 1단계)", async () => {
  // 소유자 지시(2026-10-25): 메인에 글과 메뉴가 너무 많다. 질문 열 개가 같은 무게로 늘어선 것이 첫 화면 선택지 17개 중 10개였다.
  // 처음에는 셋 다 닫혀 있어야 하고(open 이 붙으면 첫 화면에 다시 질문이 깔린다), 여닫기는 브라우저 기본 동작이다.
  const html = await indexHtml();
  const block = /<nav class="question-nav(?: [^"]*)?"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  const opens = [...block.matchAll(/<details\b([^>]*)>/g)].map((m) => m[1]);
  assert.equal(opens.length, 3, "상황이 셋이 아니다");
  for (const attrs of opens) assert.doesNotMatch(attrs, /\bopen\b/, "상황 하나가 처음부터 열려 있다");
  const summaries = [...block.matchAll(/<summary class="question-group-title" id="(qg-[a-z]+)">/g)].map((m) => m[1]);
  assert.deepEqual(summaries, ["qg-buy", "qg-rent", "qg-move"], "상황 단추(summary)가 언어 전환이 찾는 id 를 잃었다");
  assert.equal((block.match(/<a id="q-/g) ?? []).length, 10, "질문 링크 열이 DOM 에 다 있지 않다 - 접어도 지우지 않는다(색인·내부 링크)");

  // 상황 단추의 누르는 높이는 44px(--tap) 이상이다 - #406 에서 summary 가 34.5px 이던 일.
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const title = /\.question-group-title \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(title, /min-height: var\(--tap\)/, "상황 단추 높이가 --tap 아래일 수 있다");
});

test("묶음 제목도 영어로 바뀐다", async () => {
  const en = await loadIndexPage({ storage: { lang: "en" }, fetch: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(en.byId("qg-buy").textContent, "Buying");
  assert.equal(en.byId("qg-move").textContent, "Moving or selling");
});

test("검색창이 화면 머리에 있는 장은 전부다 - 질문 화면에 들어가면 검색이 사라지지 않게 (#45)", async () => {
  const files = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html"));
  const missing = [];
  for (const f of files) {
    const html = await readFile(path.join(root, SITE, f), "utf8");
    if (!/<nav class="page-nav(?: [^"]*)?"/.test(html)) continue; // 훅 class 뒤에 유틸리티 class가 붙어도 1층 내비가 있는 장이다(#280)
    if (!html.includes('class="site-search"') || !html.includes('src="./search.js"')) missing.push(f);
  }
  assert.ok(files.length > 50, "전제: 장이 거의 없다");
  assert.deepEqual(missing, [], `검색창이 없는 장: ${missing.join(", ")}`);
});

test("'다른 질문' 목록은 첫 화면 질문 입구와 같다 - 두 벌이 갈라지지 않게 (#45)", async () => {
  const nav = await readFile(path.join(root, "docs/nav.js"), "utf8");
  const sandbox = { window: {}, document: { querySelectorAll: () => [], querySelector: () => null, documentElement: { getAttribute: () => "ko" } } };
  new Function("window", "document", nav)(sandbox.window, sandbox.document);
  const fromNav = sandbox.window.QUESTION_GROUPS.flatMap((g) => g.items.map(([href, ko]) => `${href} ${ko}`));
  const fromIndex = (await links()).map((l) => `${l.href} ${l.text}`);
  assert.deepEqual(fromNav, fromIndex);
  for (const f of ["floor-gap", "record-high", "switch-house", "price-outlook", "jeonse-vs-wolse", "renewal-vs-new", "cancelled-deals"]) {
    const html = await readFile(path.join(root, `${SITE}/${f}.html`), "utf8");
    assert.match(html, /<section id="other-questions"/, `${f}에 다른 질문 자리가 없다`);
  }
});
