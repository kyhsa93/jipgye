// 금리 틀(scripts/rates-template.html → 상품군 4장)과 허브(docs/rates.html)의 껍데기를 Tailwind 유틸리티로 바꾼 개편(#282)이 지켜야 하는 것.
//
// 이 개편의 범위는 머리·1층 내비·본문 구획 하나의 여는 태그뿐이다. 상품군 4장은 색인 대상(robots index, follow)이고 허브는 noindex 로 남는다.
// 틀의 인라인 스크립트가 데이터를 받아 다시 그리는 조각(탭·조건 칸·표·추이 카드)과 굽는 조각(prerender 마커)은 건드리지 않는다 -
// 거기에 모양이 바뀌는 유틸리티를 두면 구운 첫 화면과 다시 그린 화면이 어긋나는데, 그 스크립트를 맞추는 길은 S6 이 막는다(#279 PR 본문).
// 이 시험에는 class 속성을 글자 그대로 적은 줄이 없다: tools/golden 의 훅 class 추출기가 시험 파일의 그런 줄에서 이름을 읽어
// hook-classes.json 의 markup 쪽에 끼워 넣는다(#384 에서 겪은 부작용). 그래서 속성은 조각으로 조립한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RATE_PAGES, buildRatePage } from "../scripts/build-rate-pages.ts";
import { countShared, renderedBody } from "../scripts/rate-dup.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const tokens = (cls) => cls.split(/\s+/).filter(Boolean);
const attr = (name, value) => ` ${name}=${JSON.stringify(value)}`;

// 껍데기 셋. 훅 class(JS·시험·다른 장의 규칙이 읽는 이름)는 그대로 있고 뒤에 유틸리티가 붙는다.
// 값은 방향 C 의 머리·내비는 조밀하게(8)·본문 구획 사이는 넉넉하게(40)이고, 높이 예산은 머리 아래 여백 16→8, 내비 아래 여백 16→8 로 16px 를 사서
// 두 구획 사이 24→40 에 다시 쓴다(첫 h2 −16, 답 시작 #products-body 는 −16+16=0). 이 수를 바꾸면 PR 본문의 윗변 표를 다시 재야 한다.
// 두 번째 구획(#products-section)에는 달지 않는다: 그 아래는 .site-footer 의 margin-top 40 과 겹쳐(마진 상쇄) 40 이 이미 나오므로 달아도 높이가 같다.
const HEADER = { name: "머리글", pattern: /<header(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-2", "tw:1024:mb-6"] };
const NAV = { name: "1층 내비", hooks: ["page-nav"], utilities: ["tw:gap-2", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] };
const SHELL_PAGE = [
  HEADER,
  { ...NAV, pattern: /<nav class="([^"]*)" aria-label="섹션">/ },
  { name: "추이 구획", pattern: /<section id="history-section"(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-10", "tw:1024:mb-16"] },
  { name: "상품 구획", pattern: /<section id="products-section"(?: class="([^"]*)")?>/, hooks: [], utilities: [] },
];
// 허브는 구획이 하나(본문 구획 method-body, about·method 와 같은 모양)이고 바닥글이 .site-footer 가 아닌 맨 <footer> 라 margin-top 이 없다 -
// 상쇄되는 마진이 없어 구획 아래 24 가 그대로 남으므로 40 을 단다(cmo·po 판정 #399 po 7). 달면 허브 장 높이가 −16 에서 0 으로 돌아온다.
const SHELL_HUB = [
  HEADER,
  { ...NAV, pattern: /<nav class="([^"]*)" aria-label="섹션">/ },
  { name: "본문 구획", pattern: /<section class="([^"]*)">\s*<div data-lang="ko"/, hooks: ["method-body"], utilities: ["tw:max-w-read", "tw:mb-10", "tw:1024:mb-16"] },
];

function checkShell(html, file, shell) {
  for (const { name, pattern, hooks, utilities } of shell) {
    const m = html.match(pattern);
    assert.ok(m, `${file}: ${name}를 못 찾았다`);
    const have = tokens(m[1] ?? "");
    assert.deepEqual(have.filter((t) => !t.startsWith("tw:")), hooks, `${file}: ${name}의 훅 class가 바뀌었다`);
    assert.deepEqual(have.filter((t) => t.startsWith("tw:")).sort(), [...utilities].sort(), `${file}: ${name}의 유틸리티가 다르다 - 높이 예산(첫 h2 ≤ merge-base)을 다시 재야 한다`);
  }
}

test("금리 4장과 허브의 껍데기는 같은 유틸리티를 갖고 훅 class는 그대로다 (#282)", async () => {
  for (const { file } of RATE_PAGES) checkShell(await read(`docs/${file}`), file, SHELL_PAGE);
  checkShell(await read("docs/rates.html"), "rates.html", SHELL_HUB);
  // 틀(scripts/rates-template.html)이 원본이므로 틀도 같은 모양이어야 4장이 다시 구워져도 유지된다.
  checkShell(await read("scripts/rates-template.html"), "rates-template.html", SHELL_PAGE);
});

// 빌더가 틀에서 글자 그대로 찾는 문자열 여덟 곳. 속성은 조각으로 조립한다(위 머리말).
const TITLE_EN = "Deposit, Savings & Loan Rates";
const NEEDLES = [
  ["영어 공유 제목 사전", `shareTitle: "${TITLE_EN}",`],
  ["영어 h1 사전", `h1: "${TITLE_EN}",`],
  ["영어 제목 사전", `title: "${TITLE_EN}",`],
  ["영어 설명 사전", 'description: "Daily-updated Korean bank and savings bank deposit, installment savings, mortgage and jeonse loan rates, from the FSS financial product disclosure data.",'],
  ["색인 지시", '<meta name="robots" content="noindex, follow">'],
  ["정규 URL 링크", '<link rel="canonical"'],
  ["금리 비교 내비게이션", `<a id="nav-rates" href="./rates.html"${attr("class", "active")} aria-current="page">`],
  ...RATE_PAGES.map(({ file, category }) => [`상품군 링크 ${category}`, `<a href="./${file}" data-rate-page="${category}">`]),
];

test("문자열 패치(replaceOnce) 여덟 곳의 needle이 틀에 글자 그대로 한 번씩 있고 호출 수는 여덟이다 (#282)", async () => {
  const template = await read("scripts/rates-template.html");
  const count = (s, needle) => s.split(needle).length - 1;
  for (const [what, needle] of NEEDLES) assert.equal(count(template, needle), 1, `틀에 needle이 한 번이 아니다(${what}): ${needle}`);

  // 호출 여덟 곳(정의 한 줄과 주석은 센 것이 아니다) - 영어 사전 넷 + 색인 지시 + 정규 URL + 금리 내비 + 상품군 링크(장마다 needle 이 달라도 호출은 한 곳).
  const builder = await read("scripts/build-rate-pages.ts");
  const calls = builder.split("\n").filter((l) => /\breplaceOnce\(/.test(l) && !/^\s*(?:function |\/\/)/.test(l) && !/^\s*export function/.test(l));
  assert.equal(calls.length, 8, `replaceOnce 호출이 ${calls.length}곳이다 - 여덟 needle과 짝이 맞아야 한다(상품군 링크 네 장은 한 호출)`);
  assert.equal(new Set(NEEDLES.map(([what]) => what.replace(/ (deposit|saving|mortgage|rentLoan)$/, ""))).size, 8, "시험의 needle 목록이 여덟 종이 아니다");
});

test("needle 한 곳을 깬 틀에서는 빌더가 던지고, 깨지 않은 틀에서는 네 장이 찍힌다 (#282)", async () => {
  const [template, rates] = await Promise.all([read("scripts/rates-template.html"), read("docs/data/rates.json").then(JSON.parse)]);
  for (const page of RATE_PAGES) assert.doesNotThrow(() => buildRatePage(template, page, rates), `${page.file}: 고치지 않은 틀에서 빌더가 던졌다`);
  // 1층 내비의 링크에 class 를 더하는 것이 가장 흔한 사고다 - 달 때는 부모 <nav> 에 유틸리티를 단다(#384).
  const [, navNeedle] = NEEDLES.find(([what]) => what === "금리 비교 내비게이션");
  const withUtility = template.replace(navNeedle, navNeedle.replace('"active"', '"active tw:rounded"'));
  assert.notEqual(withUtility, template, "전제: 변이가 틀을 바꾸지 못했다");
  assert.throws(() => buildRatePage(withUtility, RATE_PAGES[0], rates), /금리 비교 내비게이션를 찾지 못했습니다/);
  // 여덟 곳 어느 한 곳이든 깨면 던진다(장마다 다른 상품군 링크는 그 장의 것만 깬다).
  for (const [what, needle] of NEEDLES) {
    const page = RATE_PAGES.find(({ category }) => what === `상품군 링크 ${category}`) ?? RATE_PAGES[0];
    const broken = template.replace(needle, `${needle.slice(0, 4)}X${needle.slice(4)}`);
    assert.notEqual(broken, template, `전제: ${what} 변이가 틀을 바꾸지 못했다`);
    assert.throws(() => buildRatePage(broken, page, rates), /찾지 못했습니다/, `${what}: needle 을 깼는데 빌더가 던지지 않았다`);
  }
});

test("다시 그려지는 조각과 인라인 스크립트에는 유틸리티를 새로 두지 않는다 - 구운 화면과 다시 그린 화면이 어긋난다 (#282)", async () => {
  for (const file of [...RATE_PAGES.map((p) => p.file), "rates-template.html"]) {
    const html = await read(file === "rates-template.html" ? "scripts/rates-template.html" : `docs/${file}`);
    const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script && script.length > 5000, `${file}: 인라인 스크립트를 못 찾았다`);
    assert.ok(!script.includes("tw:"), `${file}: 인라인 스크립트에 유틸리티가 있다`);
    // 추이 격자(스크립트가 카드 넉 장을 채운다)와 상품군 링크 내비(빌더 needle)는 여는 태그에도 유틸리티가 없다.
    const grid = html.match(/<div [^>]*id="history-grid"[^>]*>/)?.[0];
    assert.ok(grid && !grid.includes("tw:"), `${file}: 추이 격자에 유틸리티가 있다`);
    const links = html.match(/<nav [^>]*id="rate-links"[^>]*>/)?.[0];
    assert.ok(links && !links.includes("tw:"), `${file}: 상품군 링크 내비에 유틸리티가 있다`);
    // 이 틀에는 <code> 가 없다. 처음 들이는 PR 은 글자 크기 유틸리티를 단다(#385).
    const codes = [...html.matchAll(/<code\b[^>]*>/g)].map((m) => m[0]);
    for (const tag of codes) assert.equal(tag, `<code${attr("class", "tw:text-sm")}>`, `${file}: <code>에 글자 크기 유틸리티가 없다: ${tag}`);
  }
});

test("금리 4장은 색인 대상으로, 허브는 noindex 로 남는다 - 캐노니컬·robots·제목 계층은 한 글자도 안 바뀐다 (#282)", async () => {
  const headingLevels = (html) => [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  const check = (file, html) => {
    const levels = headingLevels(html);
    assert.equal(levels.filter((n) => n === 1).length, 1, `${file}: h1이 하나가 아니다`);
    assert.equal(levels[0], 1, `${file}: 첫 제목이 h1이 아니다`);
    for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] - levels[i - 1] <= 1, `${file}: 제목 단계를 건너뛴다(h${levels[i - 1]} → h${levels[i]})`);
    assert.ok(html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/jipgye/${file}">`), `${file}: 캐노니컬이 자기 자신이 아니다`);
    return html.match(/<meta name="robots" content="([^"]*)">/)?.[1];
  };
  for (const { file } of RATE_PAGES) assert.equal(check(file, await read(`docs/${file}`)), "index, follow", `${file}: 색인 지시가 index, follow 가 아니다`);
  assert.equal(check("rates.html", await read("docs/rates.html")), "noindex, follow", "허브가 noindex 를 잃었다");
});

test("rate-dup 은 훅 class 뒤에 유틸리티가 붙은 1층 내비도 걷어 낸다 - 내비 글자가 중복으로 세이지 않는다 (#282)", () => {
  const SENTENCE = "이 문장은 내비게이션 안에 있는 열다섯 자가 넘는 글입니다.";
  const BODY = (text) => `<main><p>${text}</p></main>`;
  const page = (navAttrs, text) => `<html><head></head><body><nav${navAttrs}><p>${SENTENCE}</p></nav>${BODY(text)}</body></html>`;
  const withNav = (navAttrs) => renderedBody(page(navAttrs, "본문은 장마다 다른 글이 한 줄 들어갑니다."));

  // 걷어 내야 하는 모양: 훅만 / 훅 뒤에 유틸리티 / 유틸리티 뒤에 훅 / class 앞에 다른 속성.
  for (const navAttrs of [
    attr("class", "page-nav"),
    attr("class", "page-nav tw:gap-2 tw:mb-2 tw:*:rounded"),
    attr("class", "tw:mb-2 page-nav"),
    attr("aria-label", "섹션") + attr("class", "page-nav tw:gap-2"),
    attr("class", "page-nav tw:gap-2") + attr("aria-label", "섹션"),
  ]) assert.ok(!withNav(navAttrs).includes(SENTENCE), `1층 내비를 못 걷어 냈다: <nav${navAttrs}>`);

  // 걷으면 안 되는 모양: 이름이 비슷한 다른 class, 2층 내비, 본문의 상품군 링크 내비. 이들은 본문이다.
  for (const navAttrs of [attr("class", "page-nav-x"), attr("class", "my-page-nav"), attr("class", "sub-nav tw:gap-2"), attr("class", "rate-links") + attr("id", "rate-links")]) {
    assert.ok(withNav(navAttrs).includes(SENTENCE), `걷으면 안 되는 내비를 걷었다: <nav${navAttrs}>`);
  }

  // 양성 대조 1: 옛 정규식(훅 class 가 속성의 전부일 때만 맞는다)은 유틸리티를 단 내비를 못 걷는다 - 이 시험이 그 사고를 잡는다는 증거.
  const OLD = new RegExp(`<nav${attr("class", "page-nav")}[\\s\\S]*?</nav>`, "gi"); // 옛 rate-dup.mjs 22행과 같은 모양
  const tw = page(attr("class", "page-nav tw:gap-2"), "본문");
  assert.ok(tw.replace(OLD, " ").includes(SENTENCE), "전제: 옛 정규식이 유틸리티를 단 내비를 걷어 버렸다 - 이 시험이 아무것도 안 본 것이다");

  // 양성 대조 2: 두 장의 내비 글이 같아도 걷히면 0쌍, 내비가 아닌 것으로 바뀌면(훅 class 이름이 틀리면) 1쌍 이상으로 세진다.
  const a = page(attr("class", "page-nav tw:gap-2"), "첫째 장에만 있는 본문 문장입니다 하나.");
  const b = page(attr("class", "page-nav tw:gap-2"), "둘째 장에만 있는 본문 문장입니다 둘.");
  assert.equal(countShared(a, b).sharedParagraphs, 0, "내비 글이 중복으로 세였다");
  assert.equal(countShared(a, b).sharedSentences, 0, "내비 글이 중복 문장으로 세였다");
  const broken = (h) => h.replace("page-nav", "pagenav");
  assert.ok(countShared(broken(a), broken(b)).sharedParagraphs >= 1, "양성 대조: 내비를 못 걷으면 중복이 세여야 한다");
});
