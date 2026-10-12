import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyExceptions,
  bagDiff,
  collectHookClasses,
  compareHtmlInvariants,
  compareInvariants,
  extractPage,
  formatHookList,
  formatInvariantsReport,
  formatSnapshotTable,
  hookListDrift,
  isTextAttr,
  jsClassRefs,
  markupClassRefs,
  readHookList,
  resolveInternal,
  SITE_PAGE,
  snapshotDir,
  snapshotHash,
} from "../lib/invariants.mjs";

// invariants 비교기의 변이 시험(#274 범위 2). mutation.test.mjs와 같은 방식이다: 입력은 test/fixtures/의 고정 HTML 사본과
// 이 파일 안의 합성 HTML뿐이고 오늘의 docs/를 읽지 않는다(단 하나, 맨 아래 "훅 클래스 목록이 소스와 맞는다"는 저장소의
// **코드**를 읽는다 — 데이터가 아니라 선택자·class 문자열이라 그날 값에 따라 갈리지 않는다).
//   잡혀야 하는 것: 문장 삭제·숫자 한 자리·noindex 제거·canonical 변경·링크 제거·제목 레벨 변경·훅 클래스 제거·인라인 스크립트 증가,
//                   title 문구 변경·data-label 삭제·aria-label 변경·html[lang] 변경·인라인 문자열 변경(바이트 수는 같게)·
//                   .skip-link 제거·main 추가·훅 목록과 소스의 어긋남.
//   통과해야 하는 것: class·style만 바꾼 것.
//   못 잡는 것(시험으로 적어 둔다): 유틸리티 class로 본문을 숨긴 변이 — #278 PR A의 렌더 검사가 맡는다.
const fx = (name) => readFile(path.join(import.meta.dirname, "fixtures", name), "utf8");
const [BUDGET, RATES, ABOUT] = await Promise.all([fx("budget-7eok.html"), fx("rates.html"), fx("about.html")]);
const PAGES = { "budget-7eok": BUDGET, rates: RATES, about: ABOUT };
const REPO = path.resolve(import.meta.dirname, "../../..");
const BIN = path.join(import.meta.dirname, "../bin/invariants.mjs");

// 고정 사본이 싣는 외부 JS의 대역. 실제 nav.js가 읽는 선택자 한 줄만 옮겼다(훅 추출의 입력).
const JS = { "nav.js": 'document.querySelectorAll(".page-nav, .sub-nav, .table-scroll");\ndocument.querySelector(".skip-link[data-skip-en]");\n', "search.js": "// search\n", "analytics.js": "// analytics\n" };

/** from이 정확히 한 번 있어야 바꾼다 — 고정 사본이 바뀌어 변이가 헛돌면 시험이 먼저 멈춘다. */
function mutate(html, from, to) {
  assert.equal(html.split(from).length - 1, 1, `변이 대상이 정확히 한 번 있어야 한다: ${from.slice(0, 60)}`);
  return html.replace(from, to);
}
const cmp = (a, b, opts = {}) => compareHtmlInvariants(a, b, { jsA: JS, ...opts });
/** 하드로 걸린 check 이름들(정렬). */
const hardIds = (r) => [...new Set([...r.site, ...r.pages.flatMap((p) => p.findings)].filter((f) => f.level === "hard").map((f) => f.id))].sort();
const softIds = (r) => [...new Set(r.pages.flatMap((p) => p.findings).filter((f) => f.level === "soft").map((f) => f.id))].sort();
const finding = (r, id) => r.pages.flatMap((p) => p.findings).find((f) => f.id === id);
/** 변이가 하드로 걸리고, 걸린 check가 정확히 ids다. */
function caught(a, b, ids, why, opts) {
  const r = cmp(a, b, opts);
  assert.equal(r.ok, false, `${why}: 잡혀야 한다`);
  assert.deepEqual(hardIds(r), [...ids].sort(), why);
  return r;
}
/** 변이가 하드도 소프트도 남기지 않는다. */
function passes(a, b, why, opts) {
  const r = cmp(a, b, opts);
  assert.equal(r.ok, true, `${why}: 통과해야 한다\n${formatInvariantsReport(r)}`);
  assert.deepEqual(r.pages.flatMap((p) => p.findings), [], why);
  return r;
}

// 합성 한 장: 고정 사본에 없는 것(구운 title·data-label·alt)을 시험한다.
const SYNTH = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>합성</title></head><body>
<a class="skip-link" href="#main">본문 바로가기</a>
<main id="main"><h1>표</h1>
<table><thead><tr><th scope="col">구</th><th scope="col">평당가</th></tr></thead>
<tbody><tr><td data-label="구">종로</td><td data-label="평당가"><span class="low-sample" title="신고 2건이라 평균을 내기엔 표본이 부족합니다">표본 부족</span></td></tr></tbody></table>
<img src="./icons/a.png" alt="추이 그림"><input type="search" placeholder="단지 이름">
</main></body></html>`;

test("대조군: 같은 입력은 통과한다(하드·소프트 0)", () => {
  for (const [name, html] of Object.entries(PAGES)) passes(html, html, name);
  passes(SYNTH, SYNTH, "합성");
});

test("검출: 문장 삭제(표본 부족 문장) — 본문 텍스트", () => {
  const sentence = " 자치구는 한 주 표본이 얇아 최근 4주를 겹쳐 세고, 신고가 5건 미만인 구는 평균을 내지 않고 비워 둡니다.";
  const html = mutate(BUDGET, `<p id="method-callout-text">매물 호가가 아니라 국토교통부에 신고된 실거래입니다.${sentence}</p>`, `<p id="method-callout-text">매물 호가가 아니라 국토교통부에 신고된 실거래입니다.</p>`);
  const r = caught(BUDGET, html, ["text"], "문장 삭제");
  assert.match(formatInvariantsReport(r), /\[하드\] 본문 텍스트\(다중집합\) <text>: 기준에만 1, 후보에만 1/);
  assert.match(formatInvariantsReport(r), /- "매물 호가가 아니라 .*비워 둡니다\."/, "사람이 읽는 차이 보고에 사라진 문장이 보인다");
});

test("검출: 본문 숫자 한 자리·한 글자", () => {
  caught(BUDGET, mutate(BUDGET, "7억대에서 575건이 거래됐습니다", "7억대에서 576건이 거래됐습니다"), ["text"], "숫자 한 자리");
  caught(BUDGET, mutate(BUDGET, "7억대에서 575건이 거래됐습니다", "7억대에서 575건이 거래됬습니다"), ["text"], "한 글자");
  caught(BUDGET, mutate(BUDGET, "7억대에서 575건이 거래됐습니다", "7억대에서575건이 거래됐습니다"), ["text"], "노드 안 공백 없애기");
});

test("검출: noindex 제거·값 변경, noindex 추가", () => {
  const r = caught(RATES, mutate(RATES, '<meta name="robots" content="noindex, follow">', ""), ["noindex"], "noindex 제거");
  assert.deepEqual([r.noindexA, r.noindexB], [["page.html"], []], "보고서의 noindex 집합이 달라진다");
  caught(RATES, mutate(RATES, 'content="noindex, follow"', 'content="noindex"'), ["noindex"], "값 변경");
  caught(BUDGET, mutate(BUDGET, "<title>", '<meta name="robots" content="noindex, follow"><title>'), ["noindex"], "색인 장에 noindex가 생김");
});

test("검출: canonical·og·title 변경은 head, theme-color는 허용 예외(소프트)", () => {
  caught(BUDGET, mutate(BUDGET, '<link rel="canonical" href="https://kyhsa93.github.io/jipgye/budget-7eok.html">', '<link rel="canonical" href="https://kyhsa93.github.io/jipgye/budget-7eok">'), ["head"], "canonical");
  caught(BUDGET, mutate(BUDGET, '<meta property="og:title" content="7억대로', '<meta property="og:title" content="8억대로'), ["head"], "og:title");
  caught(RATES, mutate(RATES, "<title>금리 비교 · 집계</title>", "<title>금리 비교</title>"), ["head"], "title");
  caught(RATES, mutate(RATES, '<link rel="stylesheet" href="./style.css">', '<link rel="stylesheet" href="./style.css"><link rel="stylesheet" href="./tw.css">'), ["head"], "link 추가");
  const theme = cmp(BUDGET, mutate(BUDGET, '<meta name="theme-color" content="#253e81">', '<meta name="theme-color" content="#0f766e">'));
  assert.equal(theme.ok, true, "브랜드색은 하드 실패가 아니다");
  assert.deepEqual(softIds(theme), ["head-exception"], "그래도 조용히 지나가지 않는다");
  caught(BUDGET, mutate(BUDGET, '<meta name="theme-color" content="#253e81">', ""), ["head"], "theme-color를 지우는 것은 예외가 아니다");
});

test("검출: 링크 제거·href 변경·rel 추가·링크 글자 바꿔치기", () => {
  caught(BUDGET, mutate(BUDGET, '<a href="./index.html" id="nav-digest">오늘</a>', '<span id="nav-digest">오늘</span>'), ["links"], "링크 제거(글자는 남김)");
  caught(BUDGET, mutate(BUDGET, '<a href="./index.html" id="nav-digest">', '<a href="./index" id="nav-digest">'), ["links"], "href 원문");
  caught(BUDGET, mutate(BUDGET, '<a href="./index.html" id="nav-digest">', '<a href="./index.html" rel="nofollow" id="nav-digest">'), ["links"], "rel");
  // 두 링크의 href만 맞바꾼다 — href 집합도 글자 집합도 그대로지만 짝이 달라졌다.
  const swapped = mutate(mutate(BUDGET, '<a href="./index.html" id="nav-digest">', '<a href="./news.html" id="nav-digest">'), '<a href="./news.html" id="nav-news">', '<a href="./index.html" id="nav-news">');
  caught(BUDGET, swapped, ["links"], "href와 글자의 짝");
});

test("검출: 제목 레벨 변경·제목 글자·제목 순서", () => {
  const r = caught(BUDGET, mutate(BUDGET, '<h2 id="budget-heading">예산으로 찾기</h2>', '<h3 id="budget-heading">예산으로 찾기</h3>'), ["headings"], "h2 → h3");
  assert.deepEqual([finding(r, "headings").missing, finding(r, "headings").added], [['h2 "예산으로 찾기"'], ['h3 "예산으로 찾기"']]);
  caught(BUDGET, mutate(BUDGET, '<h2 id="budget-heading">예산으로 찾기</h2>', '<div id="budget-heading">예산으로 찾기</div>'), ["headings"], "제목이 div가 됨");
});

test("검출: 훅 클래스 제거 — JS가 읽는 class와 목록 파일의 class", async () => {
  // 후보 JS(nav.js 대역)가 읽는 .page-nav
  const r = caught(BUDGET, mutate(BUDGET, '<nav class="page-nav" aria-label="섹션">', '<nav class="tw:flex" aria-label="섹션">'), ["hooks"], "page-nav");
  assert.deepEqual(finding(r, "hooks").missing, ["class~=page-nav"]);
  // 인라인 script가 읽는 class(고정 사본의 인라인 script에 `.marker` 선택자가 있다)는 JS 대역 없이도 잡힌다.
  assert.ok(extractPage(BUDGET).jsRefs.includes("marker"), "인라인 script에서 뽑은 훅");
  // 목록 파일(test/·scripts/가 문자열로 쓰는 class)에만 있는 class: JS가 읽지 않아도 목록을 주면 잡힌다.
  const list = (await readHookList()).all;
  assert.ok(list.includes("method-callout") && !JS["nav.js"].includes("method-callout"));
  const noCallout = BUDGET.replace(/class="method-callout"/, 'class="tw:rounded"');
  assert.notEqual(noCallout, BUDGET);
  passes(BUDGET, noCallout, "목록 없이는 꾸밈 class로 본다");
  caught(BUDGET, noCallout, ["hooks"], "목록을 주면 훅", { hookList: list });
  // 훅 class를 남기고 유틸리티를 더하는 것(이식 규칙)은 통과한다.
  passes(BUDGET, mutate(BUDGET, '<nav class="page-nav" aria-label="섹션">', '<nav class="page-nav tw:flex tw:gap-2" aria-label="섹션">'), "훅은 남기고 더하기");
  // 후보 쪽 JS가 새로 읽기 시작한 class도 훅이다(목록을 고치기 전에도 잡힌다).
  const jsB = { ...JS, "nav.js": `${JS["nav.js"]}document.querySelector(".budget-nav");\n` };
  const r2 = cmp(BUDGET, mutate(BUDGET, '<div class="budget-nav" id="budget-page-nav">', '<div class="tw:flex" id="budget-page-nav">'), { jsB });
  assert.ok(hardIds(r2).includes("hooks"), "후보 JS가 읽는 class");
});

test("검출: id 제거·data-* 제거·aria-* 변경, 늘어난 훅은 소프트(PR에 목록)", () => {
  caught(BUDGET, mutate(BUDGET, '<h2 id="budget-heading">', "<h2>"), ["hooks"], "id 제거");
  const data = caught(BUDGET, mutate(BUDGET, ' data-updated="2026-10-11"', ""), ["hooks"], "data-* 제거");
  assert.deepEqual(finding(data, "hooks").missing, ['data-updated="2026-10-11"']);
  const changed = caught(BUDGET, mutate(BUDGET, ' data-re-page="wolse"', ' data-re-page="rent"'), ["hooks"], "data-* 값 변경(값까지 본다)");
  assert.deepEqual(softIds(changed), ["hooks-added"], "새 값은 '늘어난 훅' 목록에 적힌다");
  const lost = caught(BUDGET, mutate(BUDGET, '<span aria-hidden="true">🌓</span>', "<span>🌓</span>"), ["hooks"], "aria-hidden 제거");
  assert.deepEqual(finding(lost, "hooks").missing, ['aria-hidden="true"']);
  const added = cmp(BUDGET, mutate(BUDGET, '<h2 id="budget-heading">', '<h2 id="budget-heading" data-new="1" aria-level="2">'));
  assert.equal(added.ok, true, "훅이 느는 것은 하드가 아니다");
  assert.deepEqual(finding(added, "hooks-added").added.sort(), ['aria-level="2"', 'data-new="1"']);
});

test("검출: 속성에 든 글자 — title 문구·data-label 삭제·aria-label·html[lang]·placeholder·alt·data-*-en", () => {
  caught(SYNTH, mutate(SYNTH, 'title="신고 2건이라 평균을 내기엔 표본이 부족합니다"', 'title="신고 2건"'), ["attr-text"], "title 문구 변경");
  caught(SYNTH, mutate(SYNTH, ' title="신고 2건이라 평균을 내기엔 표본이 부족합니다"', ""), ["attr-text"], "title 삭제");
  const r = caught(SYNTH, mutate(SYNTH, '<td data-label="평당가">', "<td>"), ["attr-text"], "data-label 삭제");
  assert.deepEqual(finding(r, "attr-text").missing, ['data-label="평당가"']);
  caught(SYNTH, mutate(SYNTH, 'alt="추이 그림"', 'alt=""'), ["attr-text"], "alt");
  caught(SYNTH, mutate(SYNTH, 'placeholder="단지 이름"', 'placeholder="검색"'), ["attr-text"], "placeholder");
  caught(BUDGET, mutate(BUDGET, '<nav class="page-nav" aria-label="섹션">', '<nav class="page-nav" aria-label="Section">'), ["attr-text"], "aria-label 변경");
  caught(BUDGET, mutate(BUDGET, '<html lang="ko">', '<html lang="en">'), ["attr-text"], "html[lang] 변경");
  caught(BUDGET, mutate(BUDGET, '<html lang="ko">', "<html>"), ["attr-text"], "html[lang] 삭제");
  caught(BUDGET, mutate(BUDGET, ' data-skip-en="Skip to content"', ' data-skip-en="Skip"'), ["attr-text"], "data-skip-en(영어 모드 글자)");
  // 늘어나는 것도 하드다(훅과 달리 글자는 다중집합 동일).
  caught(SYNTH, mutate(SYNTH, "<h1>표</h1>", '<h1 title="툴팁">표</h1>'), ["attr-text"], "title 추가");
  for (const name of ["title", "alt", "placeholder", "lang", "aria-label", "data-label", "data-skip-en", "data-brand-en"]) assert.ok(isTextAttr(name), name);
  for (const name of ["data-sort", "aria-hidden", "href", "class", "data-summary-lang"]) assert.ok(!isTextAttr(name), name);
});

test("검출: 인라인 스크립트 — 증가(S6), 바이트 수가 같은 문자열 변경, 순서", () => {
  const grown = caught(ABOUT, ABOUT.replace("</script>\n</body>", "// x\n</script>\n</body>"), ["inline-script", "s6-inline-bytes"], "인라인 스크립트 증가");
  assert.match(finding(grown, "s6-inline-bytes").added[0], /\(\+5\)$/);
  // 한·영 문자열표의 한 글자: 바이트 합은 같아서 S6으로는 못 잡고 본문 비교가 잡는다.
  const same = mutate(BUDGET, 'budgetHeading: "Search by budget",', 'budgetHeading: "Search by budgit",');
  assert.equal(Buffer.byteLength(same), Buffer.byteLength(BUDGET));
  const r = caught(BUDGET, same, ["inline-script"], "바이트 수가 같은 문자열 변경");
  assert.match(finding(r, "inline-script").missing[0], /^\d+:\s+budgetHeading: "Search by budget",$/, "어느 줄인지 보인다");
  // 줄어든 변경도 본문이 다르면 잡힌다(바이트 합은 기준 이하).
  caught(BUDGET, mutate(BUDGET, 'budgetHeading: "Search by budget",', 'budgetHeading: "Budget",'), ["inline-script"], "줄어든 문자열");
  // CRLF는 통과한다: HTML 파서가 입력의 CRLF를 LF로 바꾸므로 본문도 바이트 합도 파서가 본 값으로 같다.
  const crlf = ABOUT.replace(/<script>([\s\S]*?)<\/script>/, (m, body) => `<script>${body.replace(/\n/g, "\r\n")}</script>`);
  assert.notEqual(crlf, ABOUT);
  passes(ABOUT, crlf, "script 본문의 CRLF");
  // 인라인 script 둘의 순서
  const two = (x, y) => `<!doctype html><html lang="ko"><head><title>t</title></head><body><p>a</p><script>${x}</script><script>${y}</script></body></html>`;
  caught(two("var a=1;", "var b=2;"), two("var b=2;", "var a=1;"), ["inline-script"], "순서");
});

test("검출: S6 — script 추가·속성 변경·순서, 외부 JS 바이트 증가. 줄어드는 것은 통과", () => {
  caught(BUDGET, mutate(BUDGET, '<script src="./analytics.js"></script>', '<script src="./analytics.js"></script><script src="https://cdn.example/x.js"></script>'), ["s6-scripts"], "바깥 script 추가");
  caught(BUDGET, mutate(BUDGET, '<script src="./nav.js" defer></script>', '<script src="./nav.js"></script>'), ["s6-scripts"], "defer 제거");
  const swap = mutate(mutate(BUDGET, '<script src="./nav.js" defer></script>', "@@N@@"), '<script src="./search.js" defer></script>', '<script src="./nav.js" defer></script>').replace("@@N@@", '<script src="./search.js" defer></script>');
  const order = caught(BUDGET, swap, ["s6-scripts"], "script 순서");
  assert.equal(finding(order, "s6-scripts").note, "script 순서가 바뀌었다");
  const bigger = { ...JS, "nav.js": `${JS["nav.js"]}// 한 줄\n` };
  caught(BUDGET, BUDGET, ["s6-external-bytes", "s6-js-total"], "외부 JS 바이트 증가(HTML은 그대로)", { jsB: bigger });
  caught(BUDGET, mutate(BUDGET, '<script src="./analytics.js"></script>', '<script src="./extra.js"></script><script src="./analytics.js"></script>'), ["s6-scripts", "s6-src-missing"], "없는 파일을 가리키는 script");
  // 줄어드는 것만 허용: script 하나를 빼고 외부 JS가 준다.
  const removed = cmp(BUDGET, mutate(BUDGET, '<script src="./search.js" defer></script>', ""), { jsB: { ...JS, "nav.js": "//\n" } });
  assert.equal(removed.ok, true);
  assert.deepEqual(softIds(removed), ["scripts-removed"]);
});

test("검출: JSON-LD가 새로 생김, tw:dark: 변형", () => {
  caught(BUDGET, mutate(BUDGET, "</head>", '<script type="application/ld+json">{"@type":"WebSite"}</script></head>'), ["inline-script", "ld-json", "s6-inline-bytes"], "JSON-LD");
  caught(BUDGET, mutate(BUDGET, '<nav class="page-nav" aria-label="섹션">', '<nav class="page-nav tw:dark:bg-black" aria-label="섹션">'), ["tw-dark"], "class의 tw:dark:");
  caught(BUDGET, mutate(BUDGET, '<nav class="page-nav" aria-label="섹션">', '<nav class="page-nav tw:md:dark:hidden" aria-label="섹션">'), ["tw-dark"], "변형이 겹친 tw:md:dark:");
  caught(BUDGET, BUDGET, ["s6-external-bytes", "s6-js-total", "tw-dark"], "JS가 붙이는 tw:dark:", { jsB: { ...JS, "nav.js": `${JS["nav.js"]}el.className = "tw:dark:text-white";\n` } });
  passes(BUDGET, mutate(BUDGET, '<nav class="page-nav" aria-label="섹션">', '<nav class="page-nav tw:bg-card darkish" aria-label="섹션">'), "dark가 아닌 유틸리티");
});

test("검출: 랜드마크 — .skip-link 제거·class만 제거·순서 밀림·대상 사라짐, main 추가·nav 제거", () => {
  const skip = '<a class="skip-link" href="#main" data-skip-en="Skip to content">본문 바로가기</a>';
  const gone = cmp(BUDGET, mutate(BUDGET, skip, ""));
  assert.ok(hardIds(gone).includes("landmarks"), ".skip-link 제거");
  assert.deepEqual(finding(gone, "landmarks").added, ["(.skip-link 없음)"]);
  // class만 지워도(링크·글자는 그대로) 랜드마크와 훅이 건다.
  caught(BUDGET, mutate(BUDGET, '<a class="skip-link" href="#main"', '<a class="tw:sr-only" href="#main"'), ["hooks", "landmarks"], "skip-link class 제거");
  // 본문 첫 링크 자리를 내줌: 글자·링크 다중집합은 같고 순서만 바뀐다.
  const moved = mutate(mutate(BUDGET, skip, ""), '<nav class="page-nav" aria-label="섹션">', `<nav class="page-nav" aria-label="섹션">${skip}`);
  const r = caught(BUDGET, moved, ["landmarks"], "건너뛰기 링크가 첫 링크가 아니다");
  assert.match(finding(r, "landmarks").missing[0], /href="#main" → <main id=main>, 본문 링크 중 1번째$/);
  assert.match(finding(r, "landmarks").added[0], /본문 링크 중 2번째$/);
  // 대상: #main이 main이 아니게 되거나 사라진다.
  const noMain = mutate(mutate(BUDGET, '<main id="main">', '<div id="main">'), "</main>", "</div>");
  assert.match(finding(caught(BUDGET, noMain, ["landmarks"], "main → div"), "landmarks").added.join("\n"), /→ <div id=main>/);
  caught(BUDGET, mutate(BUDGET, '<main id="main">', "<main>"), ["hooks", "landmarks"], "id=main 사라짐(대상 없음)");
  caught(BUDGET, mutate(BUDGET, "</main>", "</main><main></main>"), ["landmarks"], "main 추가");
  caught(BUDGET, mutate(mutate(BUDGET, '<nav class="sub-nav" aria-label="거래 유형">', '<div class="sub-nav" aria-label="거래 유형">'), '</nav>\n\n  <form class="site-search"', '</div>\n\n  <form class="site-search"'), ["landmarks"], "nav → div");
});

test("검출: hidden 속성으로 숨김 — 텍스트의 [hidden] 표시가 달라진다", () => {
  const r = cmp(BUDGET, mutate(BUDGET, '<p id="method-callout-text">', '<p id="method-callout-text" hidden>'));
  assert.equal(r.ok, false);
  assert.ok(hardIds(r).includes("text"));
});

test("통과: class·style만 바꾼 변이(유틸리티 더하기·꾸밈 class 갈아 끼우기·style 변경·없던 class 붙이기)", () => {
  for (const [name, html] of Object.entries(PAGES)) {
    // 훅(외부 JS 대역과 그 장의 인라인 script가 읽는 class)은 남긴다 — "새 class를 더하기만 하고 훅은 지우지 않는다"가 이식 규칙이다.
    const hooks = new Set([...Object.values(JS).flatMap(jsClassRefs), ...extractPage(html).jsRefs]);
    // 인라인 script 본문은 건드리지 않는다(거기의 class 문자열은 JS다).
    const stash = [];
    const bare = html.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/g, (m) => `\u0000${stash.push(m) - 1}\u0000`);
    let changed = 0;
    const mutated = bare
      // 모든 class 속성: 훅은 남기고 나머지는 갈아 끼운 뒤 유틸리티를 더한다.
      .replace(/ class="([^"]*)"/g, (m, v) => {
        changed++;
        const kept = v.split(/\s+/).filter((c) => hooks.has(c));
        return ` class="${[...kept, "tw:flex", "tw:p-4", `x${changed}`].join(" ")}"`;
      })
      // style 값 변경
      .replace(/ style="[^"]*"/g, ' style="margin:0;color:red"')
      // class가 없던 요소에 붙이기
      .replace(/<p>/g, '<p class="tw:leading-7" style="margin-top:1rem">')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
    assert.ok(changed > 10, `${name}: 바뀐 class 속성이 충분히 많아야 의미가 있다(${changed})`);
    assert.notEqual(mutated, html);
    passes(html, mutated, `${name}: class·style만`);
  }
});

test("통과: 껍데기 구조 변경(래퍼 추가·태그 교체)과 canon이 허용하던 차이(주석·속성 순서·엔티티·들여쓰기)", () => {
  passes(BUDGET, mutate(BUDGET, '<nav class="page-nav" aria-label="섹션">', '<div class="tw:container"><nav class="page-nav" aria-label="섹션">').replace('</nav>\n\n  <nav class="sub-nav"', '</nav></div>\n\n  <nav class="sub-nav"'), "래퍼 div");
  passes(BUDGET, mutate(BUDGET, '<div class="header-actions">', '<section class="header-actions">').replace(/(<section class="header-actions">[\s\S]*?)<\/div>/, "$1</section>"), "div → section");
  passes(BUDGET, BUDGET.replace("<main", "<!-- 주석 --><main"), "주석");
  passes(BUDGET, mutate(BUDGET, '<a href="./index.html" id="nav-digest">', '<a id="nav-digest" href="./index.html">'), "속성 순서");
  passes(BUDGET, BUDGET.replace("&amp;", "&#38;"), "엔티티 표기");
  passes(RATES, RATES.replace("<body>", "<body>\n\n   ").replace("</body>", "\n  </body>"), "들여쓰기");
});

test("소프트: 텍스트 순서만 바뀜(다중집합은 같다) — 종료 코드는 바꾸지 않고 목록을 낸다", () => {
  const a = '<p id="x">첫째 문단</p><p id="y">둘째 문단</p>';
  const page = (body) => `<!doctype html><html lang="ko"><head><title>t</title></head><body><main>${body}</main></body></html>`;
  const r = cmp(page(a), page('<p id="y">둘째 문단</p><p id="x">첫째 문단</p>'));
  assert.equal(r.ok, true);
  assert.deepEqual([r.pass, r.soft, r.hard], [0, 1, 0]);
  assert.deepEqual(softIds(r), ["text-order"]);
  assert.match(formatInvariantsReport(r), /\[소프트\] 텍스트 순서 <text-order>/);
  // 인라인 래퍼로 텍스트 노드가 잘리면 하드다(본문 기준). 글자 흐름이 같다는 것은 읽는 사람에게 알린다.
  const split = cmp(page("<p>가격은 7억입니다</p>"), page('<p>가격은 <span class="tw:font-bold">7억</span>입니다</p>'));
  assert.equal(split.ok, false);
  assert.match(finding(split, "text").note, /글자 흐름은 같고/);
});

test("못 잡는 것(적어 둔다): 유틸리티 class로 본문을 숨긴 변이는 통과한다 — parse5는 CSS를 모른다, #278 PR A의 렌더 검사가 맡는다", () => {
  for (const util of ["tw:hidden", "tw:sr-only", "tw:invisible", "tw:opacity-0"]) {
    const hiddenByClass = mutate(BUDGET, '<p id="method-callout-text">', `<p id="method-callout-text" class="${util}">`);
    passes(BUDGET, hiddenByClass, `${util}로 표본 부족 문장을 숨겨도 이 도구는 모른다`);
  }
  // style 속성으로 숨겨도 같다(style은 비교하지 않는다).
  passes(BUDGET, mutate(BUDGET, '<p id="method-callout-text">', '<p id="method-callout-text" style="display:none">'), "style=display:none");
});

test("의도한 차이(예외 목록): 글자 그대로 적은 항목만 지우고, 목록에 없는 차이는 하드로 남는다", () => {
  const html = mutate(mutate(BUDGET, 'budgetHeading: "Search by budget",', 'budgetHeading: "Find by budget",'), "7억대에서 575건이 거래됐습니다", "7억대에서 576건이 거래됐습니다");
  const r = cmp(BUDGET, html);
  assert.deepEqual(hardIds(r), ["inline-script", "text"]);
  const f = finding(r, "inline-script");
  const entry = { page: "page.html", check: "inline-script", missing: f.missing, added: f.added, reason: "영어 제목 문구 교체", confirmedBy: "po 댓글 주소" };
  const partly = applyExceptions(r, [entry]);
  assert.deepEqual(hardIds(partly), ["text"], "목록에 없는 숫자 변경은 그대로 실패");
  assert.equal(partly.ok, false);
  assert.equal(partly.excused.length, 2);
  assert.match(formatInvariantsReport(partly), /의도한 차이로 지운 항목 2개/);
  const t = finding(r, "text");
  const all = applyExceptions(r, [{ ...entry, page: "*" }, { page: "page.html", check: "text", missing: t.missing, added: t.added, reason: "오타", confirmedBy: "cmo 댓글 주소" }]);
  assert.equal(all.ok, true);
  assert.deepEqual([all.hard, all.pass], [0, 1]);
  // 항목이 한 글자라도 다르면 지워지지 않고, 그 줄은 "쓰이지 않은 예외"로 남는다.
  const off = applyExceptions(r, [{ ...entry, missing: [f.missing[0].replace("budget", "budgets")], added: [] }]);
  assert.deepEqual(hardIds(off), ["inline-script", "text"]);
  assert.equal(off.unusedExceptions.length, 1);
  assert.match(formatInvariantsReport(off), /쓰이지 않은 예외/);
  // 한 쪽만 적으면 그쪽만 지워진다.
  assert.deepEqual(hardIds(applyExceptions(r, [{ ...entry, added: [] }])), ["inline-script", "text"]);
  // 사유·확인자가 없거나 check를 통째로 면제하려는 줄은 받지 않는다.
  assert.throws(() => applyExceptions(r, [{ ...entry, confirmedBy: "" }]), /confirmedBy/);
  assert.throws(() => applyExceptions(r, [{ ...entry, reason: undefined }]), /reason/);
  assert.throws(() => applyExceptions(r, [{ page: "*", check: "text", reason: "r", confirmedBy: "c" }]), /통째로/);
  // 소프트 항목은 예외 대상이 아니다(애초에 실패가 아니다).
  const soft = cmp(BUDGET, mutate(BUDGET, '<meta name="theme-color" content="#253e81">', '<meta name="theme-color" content="#000000">'));
  assert.equal(applyExceptions(soft, [{ page: "*", check: "head-exception", added: ["x"], reason: "r", confirmedBy: "c" }]).unusedExceptions.length, 1);
});

test("훅 추출: jsClassRefs·markupClassRefs가 읽는 것과 읽지 않는 것", () => {
  const js = `
    document.querySelectorAll(".page-nav, .sub-nav > a.active, [data-x='.no']");
    el.closest(".news-item .context-chip"); el.matches('.table-scroll');
    root.querySelector(\`#\${chartId} .marker\`); root.querySelector('a[href$=".html"]');
    el.classList.toggle("on", block.getAttribute("data-lang") === lang); el.classList.add("read", 'seen');
    row.className = "summary-meta"; btn.className = first?.className || "icon-toggle wide";
    document.getElementsByClassName("stat-card big");
    const html = '<span class="markup-only">x</span>'; fetch("./data/a.json"); querySelector(selector);`;
  assert.deepEqual(jsClassRefs(js), ["active", "big", "context-chip", "icon-toggle", "marker", "news-item", "on", "page-nav", "read", "seen", "stat-card", "sub-nav", "summary-meta", "table-scroll", "wide"]);
  assert.ok(!jsClassRefs(js).includes("markup-only"), "JS가 찍는 마크업의 class는 훅이 아니다");
  const src = String.raw`assert.match(html, /<div class="stat-card wide">/); replaceOnce(t, '<nav class=\"budget-chips\">', x); const a = \`<p class="\${cls} x[^"]*">\`; f('<i class=\'spot\'>')`;
  assert.deepEqual(markupClassRefs(src), ["budget-chips", "spot", "stat-card", "wide"]);
});

test("훅 목록과 소스의 어긋남을 잡는다(합성): 소스에만 있는 이름·목록에만 남은 이름", () => {
  const collected = { js: ["a", "b"], markup: ["m"] };
  assert.deepEqual(hookListDrift({ js: ["a", "b"], markup: ["m"] }, collected), { missing: [], stale: [], ok: true });
  assert.deepEqual(hookListDrift({ js: ["a"], markup: ["m"] }, collected), { missing: ["js: b"], stale: [], ok: false }, "JS가 새로 읽기 시작한 class");
  assert.deepEqual(hookListDrift({ js: ["a", "b", "old"], markup: ["m", "gone"] }, collected), { missing: [], stale: ["js: old", "markup: gone"], ok: false }, "소스에서 사라진 이름");
  assert.deepEqual(hookListDrift({ js: ["a", "b"], markup: [] }, collected).missing, ["markup: m"]);
});

test("훅 클래스 목록(hook-classes.json)이 소스와 맞는다 — 어긋나면 `node bin/invariants.mjs --hooks-write --repo ../..`", async () => {
  // 읽는 것: docs/ 아래 .js·docs/*.html의 인라인 script, test/*.mjs, scripts/build-*-pages.mjs. 전부 코드다(구운 HTML의 class 속성은 읽지 않는다).
  const collected = await collectHookClasses(REPO);
  const list = await readHookList();
  const drift = hookListDrift(list, collected);
  assert.deepEqual([drift.missing, drift.stale], [[], []], "목록 파일이 소스와 어긋났다");
  assert.equal(await readFile(path.join(import.meta.dirname, "../hook-classes.json"), "utf8"), formatHookList(collected), "파일 모양까지 같다(다시 만들어도 바뀌지 않는다)");
  // ceo 계획 문서(개정 B안 B2-3)가 사람이 확인해 둔 훅이 기계 추출에 전부 들어 있다.
  const known = "table-scroll page-nav sub-nav site-search site-search-results header-actions skip-link brand marker marker-line marker-dot news-item context-chip stat-card news-chip history-more realestate-table budget-summary budget-empty empty read sorted scroll-start scroll-end on placeholder icon-toggle summary-meta".split(" ");
  assert.deepEqual(known.filter((c) => !list.js.includes(c)), []);
});

async function dirWith(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "golden-inv-"));
  for (const [name, content] of Object.entries(files)) {
    if (content === undefined) continue; // { ...base, "a.html": undefined }로 한 장을 뺀다
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}
const mini = (body, head = "") => `<!doctype html><html lang="ko"><head><title>t</title>${head}</head><body><main>${body}</main><script src="./nav.js" defer></script></body></html>`;

test("폴더 비교: URL 집합·noindex 집합·내부 링크 대상·폴더 JS 바이트 합·CSS의 tw:dark:·스냅숏 JSON", async () => {
  const base = { "index.html": mini('<a href="./a.html">a</a> <a href="https://example.com/x">밖</a> <a href="#top">위</a>'), "a.html": mini('<a href="./index.html?x=1#y">홈</a>', '<meta name="robots" content="noindex, follow">'), "nav.js": "// nav\n", "sw.js": "// sw\n", "style.css": ".a{color:red}", "data/x.json": "{}" };
  const a = await dirWith(base);
  const same = await dirWith(base);
  const removed = await dirWith({ ...base, "a.html": undefined, "b.html": mini("새 장") });
  const dangling = await dirWith({ ...base, "index.html": mini('<a href="./a.html">a</a> <a href="https://example.com/x">밖</a> <a href="#top">위</a>'), "a.html": undefined });
  const fatter = await dirWith({ ...base, "sw.js": "// sw 더 큼\n", "style.css": ".tw\\:dark\\:bg-black{color:#000}" });
  const snapFile = path.join(a, "..", `${path.basename(a)}.snap.json`);
  try {
    const ok = await compareInvariants(a, same, { hookList: [] });
    assert.deepEqual([ok.ok, ok.total, ok.pass, ok.countA, ok.noindexA], [true, 2, 2, 2, ["a.html"]]);

    const r1 = await compareInvariants(a, removed, { hookList: [] });
    assert.equal(r1.ok, false);
    assert.deepEqual(r1.site.find((f) => f.id === "url-set"), { id: "url-set", check: "URL 집합(.html 파일)", level: "hard", missing: ["a.html"], added: ["b.html"] });
    assert.deepEqual(r1.pages.map((p) => `${p.file}:${p.status}`), ["a.html:onlyA", "b.html:onlyB", "index.html:hard"], "index의 링크 대상(a.html)도 사라졌다");
    assert.deepEqual(r1.noindexB, []);
    assert.match(formatInvariantsReport(r1), /- a\.html: 기준에만 있다 \(하드\)/);

    const r2 = await compareInvariants(a, dangling, { hookList: [] });
    assert.deepEqual(r2.pages.find((p) => p.file === "index.html").findings.map((f) => [f.id, f.added]), [["link-target", ["./a.html"]]], "바깥 주소·조각 링크는 대상 확인에서 빠진다");

    const r3 = await compareInvariants(a, fatter, { hookList: [] });
    assert.deepEqual(r3.site.map((f) => f.id), ["s6-js-total", "tw-dark"], "script 태그가 싣지 않는 sw.js도 폴더 합으로 본다");
    assert.equal(r3.hard, 0, "장은 그대로다 — 폴더 단위 항목만으로 실패한다");
    assert.equal(r3.ok, false);
    assert.equal(applyExceptions(r3, [{ page: SITE_PAGE, check: "tw-dark", added: ["style.css: tw\\:dark\\:bg-black"], reason: "r", confirmedBy: "c" }]).site.length, 1, "폴더 단위 항목도 예외 목록을 받는다");

    // 스냅숏 JSON: 폴더 대신 넣어도 결과가 같고, 지문은 뜬 자리(경로)와 무관하다.
    const snap = await snapshotDir(a);
    await writeFile(snapFile, JSON.stringify(snap));
    assert.equal(snapshotHash(snap), snapshotHash(await snapshotDir(same)));
    assert.notEqual(snapshotHash(snap), snapshotHash(await snapshotDir(fatter)));
    assert.deepEqual((await compareInvariants(snapFile, removed, { hookList: [] })).site, r1.site);
    assert.match(formatSnapshotTable(snap), /\| a\.html \| noindex, follow \| \(없음\) \|/);
    assert.match(formatSnapshotTable(snap), /\| \*\*합계 2장\*\* \|/);

    // CLI: 통과 0, 하드 실패 1, 쓰는 법 오류 2.
    const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
    const pass = run(a, same);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /2장 — 통과 2, 소프트만 0, 하드 실패 0 → 통과/);
    const fail = run(a, removed, "--json", `${snapFile}.result.json`);
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /→ 실패/);
    assert.equal(JSON.parse(await readFile(`${snapFile}.result.json`, "utf8")).ok, false);
    assert.equal(run(a).status, 2);
    const snapOut = run("--snapshot", a);
    assert.equal(snapOut.status, 0);
    assert.equal(JSON.parse(snapOut.stdout).version, 1);
    assert.match(snapOut.stderr, /스냅숏 2장, sha256 [0-9a-f]{64}/);
  } finally {
    await Promise.all([a, same, removed, dangling, fatter].map((d) => rm(d, { recursive: true })));
    await Promise.all([snapFile, `${snapFile}.result.json`].map((f) => rm(f, { force: true })));
  }
});

test("resolveInternal·bagDiff", () => {
  assert.equal(resolveInternal("index.html", "./a.html?x#y"), "a.html");
  assert.equal(resolveInternal("sub/p.html", "../a.html"), "a.html");
  assert.equal(resolveInternal("index.html", "./"), "index.html");
  assert.equal(resolveInternal("index.html", "https://kyhsa93.github.io/jipgye/rates.html"), "rates.html");
  assert.equal(resolveInternal("index.html", "https://kyhsa93.github.io/jipgye/"), "index.html");
  assert.equal(resolveInternal("index.html", "/jipgye/news.html"), "news.html");
  for (const out of ["#main", "", "https://example.com/a.html", "//cdn.example/x.js", "mailto:a@b.c", "javascript:void(0)", "/other/x.html", "../up.html"]) assert.equal(resolveInternal("index.html", out), null, out);
  assert.deepEqual(bagDiff(["a", "a", "b"], ["a", "c", "c"]), { missing: ["a", "b"], added: ["c ×2"] });
  assert.deepEqual(bagDiff(["x", "y"], ["y", "x"]), { missing: [], added: [] }, "순서는 보지 않는다");
});
