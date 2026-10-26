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
  // #575 안 B 1단계: 묶음은 <div> 에서 <details> 로, 묶음 제목 h3 은 <summary>(상황 단추) 안으로 들어갔다. 묶음 셋·순서·예산이 첫 질문인 것은 그대로다.
  const html = await indexHtml();
  const block = /<nav class="question-nav(?: [^"]*)?"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  const groups = [...block.matchAll(/<details class="question-group"[^>]*>([\s\S]*?)<\/details>/g)].map((m) => m[1]);
  assert.equal(groups.length, 3, "묶음이 셋이 아니다");
  assert.match(groups[0], /집을 사려는 사람<\/h3><\/summary>\s*<div class="question-links">\s*<a id="q-budget"/, "예산 질문이 맨 앞이 아니다");
  assert.match(groups[1], /전월세/);
  assert.match(groups[2], /옮기거나 파는/);
  assert.ok(!block.includes("deposit-rates"), "예금 질문은 금리 탭에 있다 - 질문 입구에서 뺐다");

  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const links = /\.question-links \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(links, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, "펼친 질문이 모바일에서 한 줄씩 늘어선다");
});

const homeForm = (html) => /<form class="home-search"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";

test("대표 검색이 첫 화면에 보이고 JS 없이 GET 으로 deal-search 에 조건을 넘긴다 (#745 PR4 - #575 안 B 지표를 대체)", async () => {
  // 소유자 지시(2026-10-26, O-A=예): 메인은 질문 입구가 아니라 대표 검색이 먼저다. #575 안 B 의 「첫 화면 선택지 ≤9」 대신
  // 헤드라인 h1 → 가치 문구 → 출처 한 줄(태그라인, 지우지 않는다) → 폼(유형·지역·예산·검색)이 질문 입구·데이터 구획보다 앞에 있는지 본다.
  const html = await indexHtml();
  const hero = /<div class="home-hero"[\s\S]*?<\/form>\n {2}<\/div>/.exec(html)?.[0] ?? "";
  assert.ok(hero, "대표 검색 블록이 없다");
  assert.match(hero, /<h1 class="home-title"><span lang="ko">내 예산에 맞는 서울 아파트를 찾아보세요<\/span><span lang="en">[\x20-\x7E]+<\/span><\/h1>/, "헤드라인 h1 이 한·영 두 벌이 아니다");
  assert.match(hero, /<p class="home-value"><span lang="ko">실제 거래된 가격을 기준으로[^<]+<\/span><span lang="en">[\x20-\x7E]+<\/span><\/p>/);
  assert.ok(hero.indexOf('class="home-value"') < hero.indexOf('id="tagline"'), "태그라인(출처 한 줄)이 가치 문구 아래가 아니다");
  assert.ok(hero.includes("신고된 거래만 세어서 말합니다"), "태그라인이 지워졌다(소유자 결정 2026-10-26: 유지)");
  const at = html.indexOf('class="home-hero"');
  assert.ok(at < html.indexOf('class="question-nav') && at < html.search(/<section id="/), "대표 검색이 질문 입구·데이터 구획보다 뒤에 있다");
  assert.ok(html.indexOf('class="home-goals"') < html.indexOf('class="question-nav'), "4목적이 질문 입구보다 뒤에 있다");

  const form = homeForm(html);
  assert.match(form, /^<form class="home-search" id="home-search" action="\.\/deal-search\.html" method="get">/, "폼이 deal-search 로 GET 하지 않는다");
  assert.ok(!/\son[a-z]+=/.test(form), "폼에 인라인 이벤트가 있다 - JS 없이 돌아야 한다");
  // 스크립트는 보내는 것을 막지 않는다 - 전월세일 때 매매 예산(max)을 비우는 일 하나만 한다(JS 가 없어도 폼은 그대로 간다).
  const submit = /addEventListener\("submit", \(e\) => \{([\s\S]*?)\}\);/.exec(html)?.[1] ?? "";
  assert.ok(!/preventDefault|location|fetch/.test(submit), "스크립트가 폼 제출을 가로챈다 - JS 없이도 같은 GET 이어야 한다");
  assert.match(form, /<button class="c-btn" type="submit">/);

  // 질문 링크 열은 지우지 않고 「더 알아보기」 아래 접힌 <details> 로 남는다(색인·내부 링크).
  const block = /<nav class="question-nav(?: [^"]*)?"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  const opens = [...block.matchAll(/<details\b([^>]*)>/g)].map((m) => m[1]);
  assert.equal(opens.length, 3, "상황이 셋이 아니다");
  for (const attrs of opens) assert.doesNotMatch(attrs, /\bopen\b/, "상황 하나가 처음부터 열려 있다");
  const summaries = [...block.matchAll(/<summary class="question-situation"><h3 class="question-group-title" id="(qg-[a-z]+)">/g)].map((m) => m[1]);
  assert.deepEqual(summaries, ["qg-buy", "qg-rent", "qg-move"], "상황 단추(summary 안의 묶음 제목 h3)가 언어 전환이 찾는 id 를 잃었다");
  assert.equal((block.match(/<a id="q-/g) ?? []).length, 10, "질문 링크 열이 DOM 에 다 있지 않다 - 접어도 지우지 않는다(색인·내부 링크)");

  // 상황 단추의 누르는 높이는 44px(--tap) 이상이다 - #406 에서 summary 가 34.5px 이던 일.
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const title = /\.question-situation \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(title, /min-height: var\(--tap\)/, "상황 단추 높이가 --tap 아래일 수 있다");
});

test("대표 검색 폼의 칸 이름·값은 deal-search 가 읽는 파라미터와 맞다 (#745 PR4)", async () => {
  const form = homeForm(await indexHtml());
  const deal = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
  const read = new Set([...deal.matchAll(/params\.get\("([a-z]+)"\)/g)].map((m) => m[1]));
  const names = [...new Set([...form.matchAll(/<(?:input|select)\b[^>]*\bname="([a-z]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(names.sort(), ["district", "kind", "max"].sort(), "칸이 유형·지역·예산(max) 셋이 아니다");
  const filters = await readFile(path.join(root, "docs/deal-filters.js"), "utf8");
  for (const n of filters.matchAll(/params\.get\("([a-z]+)"\)/g)) read.add(n[1]);
  for (const n of names) assert.ok(read.has(n), `deal-search 가 ${n} 을 읽지 않는다`);

  const kinds = JSON.parse(/const KINDS = (\[[^\]]*\]);/.exec(deal)?.[1] ?? "[]");
  const radios = [...form.matchAll(/<input type="radio" name="kind" value="([a-z]+)"( checked)?>/g)];
  assert.deepEqual(radios.map((m) => m[1]), kinds, "거래 유형이 deal-search 의 KINDS 와 다르다");
  assert.deepEqual(radios.filter((m) => m[2]).map((m) => m[1]), ["sale"], "기본 유형이 매매 하나가 아니다");

  const { DISTRICTS } = await import(path.join(root, "scripts/realestate-districts.ts"));
  const district = /<select class="c-select" name="district">([\s\S]*?)<\/select>/.exec(form)?.[1] ?? "";
  assert.match(district, /^<option value="">서울 전체/, "첫 칸이 서울 전체(빈 값 = deal-search 의 ALL)가 아니다");
  const options = [...district.matchAll(/<option>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual([...options].sort(), DISTRICTS.map((d) => d.name).sort(), "자치구가 25개 전부가 아니다");

  // 예산은 deal-search 의 max(억, 이하, deal-filters.js 의 선택지 M)와 같은 값·같은 「N억 이하」 라벨이다(시나리오 B 「서울 8억 이하 매매」).
  const budget = /<select class="c-select" name="max">([\s\S]*?)<\/select>/.exec(form)?.[1] ?? "";
  assert.match(budget, /^<option value="">/, "예산 첫 칸이 조건 없음이 아니다");
  const opts = [...budget.matchAll(/<option value="(\d+)">([^<]+)/g)];
  const M = JSON.parse(/const M = (\[[^\]]*\]);/.exec(filters)?.[1] ?? "[]");
  assert.deepEqual(opts.map((m) => Number(m[1])), M, "예산 선택지가 deal-search 의 max 선택지와 다르다");
  for (const [, v, text] of opts) assert.equal(text, `${v}억 이하`, `예산 라벨이 「N억 이하」가 아니다: ${text}`);

  // 전세·월세: deal-search 는 예산 칸 대신 보증금·월세를 쓴다. 메인은 예산 칸을 감추고(CSS) 보낼 때 비운다(인라인 스크립트).
  const css = await readFile(path.join(root, "src/css/c-home.css"), "utf8");
  assert.ok(css.includes('.home-search:has(input[name="kind"]:not([value="sale"]):checked) .home-budget {\n  display: none;'), "전월세에서 예산 칸이 보인다");
  assert.match(form, /<label class="c-field home-budget">[\s\S]*?name="max"/, "감출 예산 칸 묶음이 없다");
  const html = await indexHtml();
  assert.match(html, /getElementById\("home-search"\)\.addEventListener\("submit", \(e\) => \{\s*const f = e\.currentTarget;\s*if \(f\.kind\.value !== "sale"\) f\.max\.value = "";\s*\}\);/, "전월세로 보낼 때 max 를 비우지 않는다");
});

test("대표 검색·4목적은 320px 에서 가로로 넘치지 않는다 - 칸은 minmax(0, 1fr), 고정 폭 없음 (#745 PR4)", async () => {
  const css = await readFile(path.join(root, "src/css/c-home.css"), "utf8");
  const rule = (sel) => new RegExp(`(?:^|\\n)${sel.replace(/[.*]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  for (const sel of [".home-search", ".home-goals"]) {
    assert.match(rule(sel), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, `${sel} 칸이 내용 폭만큼 늘 수 있다`);
  }
  assert.match(rule(".home-kind"), /min-width: 0/, "fieldset 의 min-content 폭이 320px 을 밀 수 있다");
  // 고정 폭(px/rem)·nowrap 이 하나도 없다 - 화면 너비 320px(본문 폭 288px)을 미는 것은 이 둘뿐이다.
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(body, /(?:^|[\s;{])(?:min-)?width:\s*(?:[2-9]\d|\d{3,})(?:px|rem)/, "c-home.css 에 고정 폭이 있다");
  assert.doesNotMatch(body, /white-space:\s*nowrap/, "c-home.css 에 줄바꿈 금지가 있다");
  const base = await readFile(path.join(root, "src/css/c-base.css"), "utf8");
  assert.match(/\.c-input,\n\.c-select \{([^}]*)\}/.exec(base)?.[1] ?? "", /box-sizing: border-box;[\s\S]*width: 100%/, "드롭다운이 칸 폭을 넘을 수 있다");
  assert.match(/\.c-chips \{([^}]*)\}/.exec(base)?.[1] ?? "", /flex-wrap: wrap/, "유형 칩이 한 줄로 넘칠 수 있다");
});

test("사는 사람 조건 폼은 닫힌 첫 묶음 안에만 있어 첫 화면 선택지가 늘지 않는다 (#733, #575 안 B)", async () => {
  const html = await indexHtml();
  const block = /<nav class="question-nav(?: [^"]*)?"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  const groups = [...block.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)];
  assert.equal(groups.length, 3);
  assert.doesNotMatch(groups[0][1], /\bopen\b/, "폼이 든 묶음이 처음부터 열려 있다");
  assert.match(groups[0][2], /<\/summary>[\s\S]*<form class="question-form"[^>]*action="\.\/deal-search\.html"[\s\S]*<\/form>/, "폼이 사는 사람 묶음 안에 없다");
  assert.equal((html.match(/<form class="question-form"/g) ?? []).length, 1);
  // 묶음 밖(첫 화면)에 남는 것은 상황 단추 셋뿐이다 - 폼 칸·단추가 details 밖으로 새면 선택지가 는다.
  const outside = block.replace(/<details\b[\s\S]*?<\/details>/g, (d) => (/<summary[\s\S]*?<\/summary>/.exec(d)?.[0] ?? ""));
  assert.equal((outside.match(/<(?:a|input|select|button|textarea)\b/g) ?? []).length, 0, "질문 입구에서 접히지 않은 선택지가 늘었다");
  assert.equal((outside.match(/<summary\b/g) ?? []).length, 3);

  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  assert.ok(css.includes('html:lang(en) .question-form [lang="ko"],\nhtml:not(:lang(en)) .question-form [lang="en"] {\n  display: none;'), "폼 글자가 화면 언어 하나만 보이지 않는다");
  const control = /\.question-form input,\n\.question-form select,\n\.question-form button \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(control, /min-height: var\(--tap\)/, "폼 칸 높이가 --tap 아래일 수 있다");
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
