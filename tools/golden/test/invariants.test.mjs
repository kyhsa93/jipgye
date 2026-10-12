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
  hookListFindings,
  isTextAttr,
  jsClassRefs,
  markupClassRefs,
  readHookList,
  resolveInternal,
  SITE_PAGE,
  snapshotDir,
  snapshotHash,
  TEXT_BLOCK,
  NEUTRAL_INLINE,
  withSiteFindings,
} from "../lib/invariants.mjs";

// invariants 비교기의 변이 시험(#274 범위 2). mutation.test.mjs와 같은 방식이다: 입력은 test/fixtures/의 고정 HTML 사본과
// 이 파일 안의 합성 HTML뿐이고 오늘의 docs/를 읽지 않는다(단 하나, 맨 아래 "훅 클래스 목록이 소스와 맞는다"는 저장소의
// **코드**를 읽는다 — 데이터가 아니라 선택자·class 문자열이라 그날 값에 따라 갈리지 않는다).
//   잡혀야 하는 것: 문장 삭제·숫자 한 자리·noindex 제거·canonical 변경·링크 제거·제목 레벨 변경·훅 클래스 제거·인라인 스크립트 증가,
//                   title 문구 변경·data-label 삭제·aria-label 변경·html[lang] 변경·인라인 문자열 변경(바이트 수는 같게)·
//                   .skip-link 제거·main 추가·훅 목록과 소스의 어긋남.
//   통과해야 하는 것: class·style만 바꾼 것.
//   못 잡는 것(시험으로 적어 둔다): 유틸리티 class로 본문을 숨긴 변이 — #278 PR A의 렌더 검사가 맡는다.
// #289(cto 후속 여덟 개)의 변이 시험은 이름에 "#289 n번"을 적었다. 4번(블록 단위 글자 흐름)은 통과해야 하는 것(중립 인라인으로
// 일부를 감싸기·풀기, 공백 자리의 br)과 계속 하드여야 하는 것(래퍼 안의 글자·숫자, 블록 안 공백 추가·삭제, 블록 나눔·합침·이동,
// 뜻 있는 태그, 숨김이 붙은 래퍼)을 각각 둔다.
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
/** 변이가 하드 없이 소프트만 남기고, 남긴 소프트 check가 정확히 ids다. */
function softOnly(a, b, ids, why, opts) {
  const r = cmp(a, b, opts);
  assert.equal(r.ok, true, `${why}: 하드가 없어야 한다\n${formatInvariantsReport(r)}`);
  assert.deepEqual(hardIds(r), [], why);
  assert.deepEqual(softIds(r), [...ids].sort(), why);
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
  // a는 뜻 있는 인라인이라 글자 흐름에 `‹a›…‹/a›`로 남는다 — 링크가 글자만 남기고 사라지면 본문 텍스트도 건다(#289 4번).
  caught(BUDGET, mutate(BUDGET, '<a href="./index.html" id="nav-digest">오늘</a>', '<span id="nav-digest">오늘</span>'), ["links", "text"], "링크 제거(글자는 남김)");
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
  // aria-hidden="true" 아래 글자에는 숨김 표시가 붙는다(#289 4번) — 떼면 훅과 본문 텍스트가 함께 건다.
  const lost = caught(BUDGET, mutate(BUDGET, '<span aria-hidden="true">🌓</span>', "<span>🌓</span>"), ["hooks", "text"], "aria-hidden 제거");
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
  // 링크가 다른 블록(nav) 안으로 옮겨 갔으므로 본문 텍스트도 건다(블록을 넘는 이동, #289 4번).
  const r = caught(BUDGET, moved, ["landmarks", "text"], "건너뛰기 링크가 첫 링크가 아니다");
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
  // 인라인 래퍼로 텍스트 노드가 잘려도 블록의 글자 흐름이 같으면 통과하고 소프트로 적는다(#289 4번 — 그 전에는 하드였다).
  const split = cmp(page("<p>가격은 7억입니다</p>"), page('<p>가격은 <span class="tw:font-bold">7억</span>입니다</p>'));
  assert.equal(split.ok, true);
  assert.deepEqual(softIds(split), ["text-wrap"]);
  // 공백을 뺀 글자가 같고 공백만 다르면 하드이고, 그 사실을 읽는 사람에게 알린다.
  const glued = cmp(page("<p>가격은 7억입니다</p>"), page('<p>가격은<span class="tw:font-bold">7억</span>입니다</p>'));
  assert.equal(glued.ok, false);
  assert.match(finding(glued, "text").note, /글자는 같고 블록 안 공백이나 블록 경계가 달라졌다/);
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
    assert.equal(JSON.parse(snapOut.stdout).version, 2, "#289에서 추출 항목이 바뀌어 스냅숏 판이 올랐다");
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

// ───────────────────────── #289: cto 후속 여덟 개의 변이 시험 ─────────────────────────

/** 합성 한 장. body는 main 안에, head는 title 뒤에 들어간다. */
const doc = (body, head = "") => `<!doctype html><html lang="ko"><head><title>t</title>${head}</head><body><main id="main">${body}</main></body></html>`;
const SENTENCE = '<p class="budget-summary">7억대에서 575건이 거래됐습니다(직거래 13건 포함). <span class="when">8월, 9월, 10월 신고분 기준</span></p>';
/** 고정 사본의 요약 문장 한 줄을 바꾼다. */
const sentence = (to) => mutate(BUDGET, SENTENCE, to);

test("#289 1번 검출: 인라인 이벤트 핸들러 속성(on*) — 새로 생기거나 값이 바뀌면 하드(s6-handlers), 줄기만 하면 소프트", () => {
  const r = caught(BUDGET, mutate(BUDGET, '<h2 id="budget-heading">', '<h2 id="budget-heading" onclick="track(\'h\')">'), ["s6-handlers"], "onclick 추가");
  assert.deepEqual([finding(r, "s6-handlers").missing, finding(r, "s6-handlers").added], [[], ['onclick="track(\'h\')"']]);
  caught(BUDGET, mutate(BUDGET, "<body>", '<body onload="boot()">'), ["s6-handlers"], "body onload");
  caught(BUDGET, mutate(BUDGET, '<main id="main">', '<main id="main" onmouseover="x()">'), ["s6-handlers"], "다른 이벤트 이름");
  // head의 link에 붙이면 head 줄도 달라진다.
  caught(BUDGET, mutate(BUDGET, '<link rel="stylesheet" href="./style.css">', '<link rel="stylesheet" href="./style.css" onload="x()">'), ["head", "s6-handlers"], "link onload");
  // 값이 바뀜: 기준에 있던 핸들러의 본문이 달라졌다(속성 안의 JS는 inline-script·바이트 합이 보지 못한다).
  const withHandler = doc('<button type="button" onclick="open(1)">열기</button>');
  const changed = caught(withHandler, withHandler.replace("open(1)", "open(2)"), ["s6-handlers"], "값 변경");
  assert.deepEqual([finding(changed, "s6-handlers").missing, finding(changed, "s6-handlers").added], [['onclick="open(1)"'], ['onclick="open(2)"']]);
  // 다른 요소로 옮긴 것은 다중집합이 같아 보지 않는다(태그 이름은 디자인이다). 줄기만 하면 소프트.
  softOnly(withHandler, withHandler.replace(' onclick="open(1)"', ""), ["handlers-removed"], "핸들러 제거");
  passes(withHandler, withHandler, "그대로");
  assert.deepEqual(extractPage(doc('<p data-on="x" one="1">가</p>')).handlers, ['one="1"'], "이름이 on으로 시작하면 모두 센다(data-on은 아니다)");
});

test("#289 2번 검출: robots 메타 전부 — 앞에 끼운 none, 대문자 ROBOTS, body 안의 robots·refresh·base, head 안 noscript", () => {
  const robots = '<meta name="robots" content="noindex, follow">';
  // 기준의 메타는 그대로 두고 앞에 하나 더 넣는다 — 마지막 값만 보면 지나간다.
  const r = caught(RATES, mutate(RATES, robots, `<meta name="robots" content="none">${robots}`), ["noindex"], "앞에 끼운 none");
  assert.deepEqual([finding(r, "noindex").missing, finding(r, "noindex").added], [[], ["none"]]);
  caught(RATES, mutate(RATES, robots, `${robots}<meta name="robots" content="noindex, nofollow">`), ["noindex"], "뒤에 더한 것");
  // 색인 장: 대문자 이름도 robots다. noindex 집합에도 들어간다(none은 noindex와 같은 뜻).
  const upper = caught(BUDGET, mutate(BUDGET, "<title>", '<meta name="ROBOTS" content="none"><title>'), ["noindex"], "대문자 ROBOTS");
  assert.deepEqual([finding(upper, "noindex").missing, finding(upper, "noindex").added], [["(robots 없음)"], ["none"]]);
  assert.deepEqual([upper.noindexA, upper.noindexB], [[], ["page.html"]]);
  // 둘 가운데 하나만 지워도 잡힌다. 둘의 순서만 바꾼 것은 뜻이 같아 통과한다.
  const two = doc("<p>가</p>", '<meta name="robots" content="noindex"><meta name="robots" content="max-snippet:0">');
  const one = caught(two, two.replace('<meta name="robots" content="noindex">', ""), ["noindex"], "둘 중 하나 제거");
  assert.deepEqual([finding(one, "noindex").missing, finding(one, "noindex").added, one.noindexA, one.noindexB], [["noindex"], [], ["page.html"], []]);
  passes(two, doc("<p>가</p>", '<meta name="robots" content="max-snippet:0"><meta name="robots" content="noindex">'), "순서만");
  // body 안: 크롤러·브라우저는 body에 놓인 robots·refresh·base도 읽는다.
  for (const [why, meta] of [["robots", '<meta name="robots" content="noindex">'], ["refresh", '<meta http-equiv="refresh" content="0;url=https://example.com/">'], ["base", '<base href="https://example.com/">']]) {
    const body = caught(BUDGET, mutate(BUDGET, '<main id="main">', `<main id="main">${meta}`), ["body-meta"], `body 안 ${why}`);
    assert.equal(finding(body, "body-meta").added.length, 1);
  }
  // head 안 noscript: 파서에게는 글자라 meta 줄로 안 잡힌다 — 본문째로 head에 넣어 견준다.
  caught(BUDGET, mutate(BUDGET, "<title>", '<noscript><meta http-equiv="refresh" content="0;url=./index.html"></noscript><title>'), ["head"], "head 안 noscript의 refresh");
});

test("#289 3번 검출: 태그로 숨기기 — template·닫힌 dialog·noscript·noembed·canvas 아래 글자에 숨김 표시, details[open]은 소프트(po 필독)", () => {
  const p = '<p id="method-callout-text">';
  const body = "매물 호가가 아니라 국토교통부에 신고된 실거래입니다. 자치구는 한 주 표본이 얇아 최근 4주를 겹쳐 세고, 신고가 5건 미만인 구는 평균을 내지 않고 비워 둡니다.";
  const whole = `${p}${body}</p>`;
  const wrap = (open, close) => mutate(BUDGET, whole, `${open}${whole}${close}`);
  const tpl = caught(BUDGET, wrap("<template>", "</template>"), ["text"], "template으로 감쌈");
  assert.deepEqual([finding(tpl, "text").missing, finding(tpl, "text").added], [[JSON.stringify(body)], [`${JSON.stringify(body)} [hidden:template]`]]);
  caught(BUDGET, wrap("<dialog>", "</dialog>"), ["text"], "닫힌 dialog로 감쌈");
  passes(BUDGET, wrap("<dialog open>", "</dialog>"), "열린 dialog는 보인다");
  caught(wrap("<dialog open>", "</dialog>"), wrap("<dialog>", "</dialog>"), ["text"], "dialog의 open 제거");
  // 문장만(블록 안쪽에서) 감싸면 텍스트 노드의 글자는 그대로다 — 숨김 표시가 없으면 지나간다.
  for (const tag of ["noscript", "noembed", "canvas", "template", "object", "video", "audio", "datalist"]) {
    const inner = caught(BUDGET, mutate(BUDGET, whole, `${p}<${tag}>${body}</${tag}></p>`), ["text"], `${tag} 안쪽에 넣음`);
    assert.deepEqual(finding(inner, "text").added, [`${JSON.stringify(body)} [hidden:${tag}]`]);
  }
  // 문장의 일부만 template으로: 보이는 조각과 숨은 조각으로 갈린다.
  const part = caught(BUDGET, mutate(BUDGET, whole, `${p}매물 호가가 아니라 국토교통부에 신고된 실거래입니다.<template> 자치구는 한 주 표본이 얇아 최근 4주를 겹쳐 세고, 신고가 5건 미만인 구는 평균을 내지 않고 비워 둡니다.</template></p>`), ["text"], "일부만 template");
  assert.equal(finding(part, "text").added.length, 2);
  // details: open이 빠지면 본문이 접힌다 — 하드는 아니고 소프트 목록(details-open)에 반드시 나온다. 펴는 것도 같다.
  const open = doc('<details open class="fold"><summary>자세히</summary><p>접히는 본문</p></details>');
  const closed = open.replace("<details open", "<details");
  const folded = softOnly(open, closed, ["details-open"], "open 제거");
  assert.deepEqual([finding(folded, "details-open").missing, finding(folded, "details-open").added], [['details[open] 요약="자세히"'], ['details[닫힘] 요약="자세히"']]);
  assert.match(formatInvariantsReport(folded), /\[소프트\] details 접힘·펼침\(open\) — 본문을 접거나 펴는 변화, po가 반드시 읽는다 <details-open>/);
  softOnly(closed, open, ["details-open"], "open 추가");
  passes(open, open.replace('class="fold"', 'class="tw:rounded"'), "class만");
});

test("#289 4번 통과: 텍스트 노드의 일부를 중립 인라인으로 감싸기·풀기, 공백 자리의 br — 글자 흐름이 같으면 통과하고 소프트(text-wrap)에 수와 모양을 낸다", () => {
  const strong = softOnly(BUDGET, sentence(SENTENCE.replace("575건이", '<strong class="tw:font-bold">575</strong>건이')), ["text-wrap"], "숫자를 strong으로");
  const f = finding(strong, "text-wrap");
  assert.equal(f.level, "soft");
  assert.deepEqual(f.missing, ['"7억대에서 575건이 거래됐습니다(직거래 13건 포함). ‹span›8월, 9월, 10월 신고분 기준‹/span›"']);
  assert.deepEqual(f.added, ['"7억대에서 ‹strong›575‹/strong›건이 거래됐습니다(직거래 13건 포함). ‹span›8월, 9월, 10월 신고분 기준‹/span›"'], "무엇이 감싸졌는지 보인다");
  assert.equal(f.note, "블록 1개 — 래퍼 1→2개, br 0→0개");
  assert.match(formatInvariantsReport(strong), /인라인 경계만 다른 블록\(text-wrap, 통과\): 1장 1개/, "보고서 머리에 장 수와 블록 수");
  // 중립 인라인 여덟 가지 모두, 겹쳐 감싸기, 여러 곳.
  for (const tag of NEUTRAL_INLINE) softOnly(BUDGET, sentence(SENTENCE.replace("575건이", `<${tag}>575</${tag}>건이`)), ["text-wrap"], tag);
  assert.deepEqual([...NEUTRAL_INLINE].sort(), ["abbr", "b", "em", "i", "mark", "small", "span", "strong"], "허용 래퍼 목록(README와 같다)");
  softOnly(BUDGET, sentence(SENTENCE.replace("7억대에서 575건이", "<b><i>7억</i></b>대에서 <strong>575</strong><em>건</em>이").replace("직거래 13건", "직거래 <mark>13</mark>건")), ["text-wrap"], "여러 곳·겹침");
  // 풀기: 기준에 있던 부분 래퍼를 없앤다.
  const unwrapped = softOnly(BUDGET, sentence(SENTENCE.replace('<span class="when">8월, 9월, 10월 신고분 기준</span>', "8월, 9월, 10월 신고분 기준")), ["text-wrap"], "span 풀기");
  assert.equal(finding(unwrapped, "text-wrap").note, "블록 1개 — 래퍼 1→0개, br 0→0개");
  // br: 공백 한 칸으로 센다 — 낱말 사이 공백 자리에 넣으면 흐름이 같다(공백을 남기든 br로 바꾸든).
  const br = softOnly(BUDGET, sentence(SENTENCE.replace("575건이 거래됐습니다", "575건이<br>거래됐습니다")), ["text-wrap"], "공백을 br로");
  assert.equal(finding(br, "text-wrap").note, "블록 1개 — 래퍼 1→1개, br 0→1개");
  softOnly(BUDGET, sentence(SENTENCE.replace("575건이 거래됐습니다", "575건이 <br>거래됐습니다")), ["text-wrap"], "공백 뒤에 br");
  // 노드 전체를 감싸거나(잘린 자리가 없다) 중립 태그끼리 바꾸는 것은 보고조차 하지 않는다 — 전부터 통과하던 것이다.
  passes(BUDGET, mutate(BUDGET, '<h2 id="budget-heading">예산으로 찾기</h2>', '<h2 id="budget-heading"><span class="tw:text-lg">예산으로 찾기</span></h2>'), "노드 전체를 감쌈");
  passes(BUDGET, sentence(SENTENCE.replace('<span class="when">', '<small class="when">').replace("</span>", "</small>")), "span → small");
  // 블록 태그끼리 바꾸는 것, 블록을 블록으로 감싸는 것은 흐름을 바꾸지 않는다.
  passes(BUDGET, sentence(SENTENCE.replace('<p class="budget-summary">', '<div class="budget-summary">').replace("</p>", "</div>")), "p → div");
  passes(BUDGET, sentence(`<div class="tw:p-4">${SENTENCE}</div>`), "블록 래퍼");
  // 아이콘(img·svg)은 흐름을 끊지도 보태지도 않는다(새 aria-hidden은 전과 같이 hooks-added 소프트). SVG 안의 글자는 요소마다 따로 센다.
  softOnly(BUDGET, sentence(SENTENCE.replace("7억대에서 575건이", '7억대에서 <svg class="icon" aria-hidden="true"><path d="M0 0"/></svg>575건이')), ["hooks-added"], "문장 안 svg 아이콘");
  passes(BUDGET, sentence(SENTENCE.replace("7억대에서 575건이", '7억대에서 <img src="./icons/i.png">575건이')), "문장 안 img 아이콘");
  assert.deepEqual(extractPage(doc('<p>추이 <svg role="img"><text>1월<tspan>2월</tspan></text><g><text>3월</text></g></svg> 끝</p>')).texts, ['"1월"', '"2월"', '"3월"', '"추이 끝"'], "SVG 덩어리는 바깥 흐름을 끊지 않고 안쪽은 요소마다 한 항목");
});

test("#289 4번 검출(a): 글자 한 글자·숫자 한 자리는 래퍼 안에서도 하드", () => {
  const digit = caught(BUDGET, sentence(SENTENCE.replace("575건이", "<strong>576</strong>건이")), ["text"], "래퍼 안 숫자 한 자리");
  assert.deepEqual(finding(digit, "text").missing, ['"7억대에서 575건이 거래됐습니다(직거래 13건 포함). 8월, 9월, 10월 신고분 기준"'], "항목은 블록 하나의 글자 흐름이다");
  assert.deepEqual(finding(digit, "text").added, ['"7억대에서 576건이 거래됐습니다(직거래 13건 포함). 8월, 9월, 10월 신고분 기준"']);
  assert.equal(finding(digit, "text").note, undefined, "글자가 바뀐 것은 '공백만 달라졌다'가 아니다");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<strong>575</strong>껀이")), ["text"], "래퍼 밖 한 글자");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<span><b>5</b>85</span>건이")), ["text"], "겹친 래퍼 안 숫자");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<strong>575</strong>건이").replace("10월 신고분", "11월 신고분")), ["text"], "기준에 있던 래퍼 안 글자");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<strong></strong>건이")), ["text"], "래퍼만 남기고 숫자를 지움");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<strong>575</strong><strong>575</strong>건이")), ["text"], "글자를 한 번 더");
});

test("#289 4번 검출(b): 블록 안 공백은 추가도 삭제도, 래퍼 경계에서도 하드 — 인라인 사이 공백을 없애 낱말이 붙는 것(cto 거짓 통과 7번)도 잡는다", () => {
  const note = /글자는 같고 블록 안 공백이나 블록 경계가 달라졌다/;
  const added = caught(BUDGET, sentence(SENTENCE.replace("575건이", "<strong>575</strong> 건이")), ["text"], "래퍼 뒤에 공백 추가");
  assert.match(finding(added, "text").note, note);
  caught(BUDGET, sentence(SENTENCE.replace("7억대에서 575건이", "7억대에서<strong>575</strong>건이")), ["text"], "래퍼 앞 공백 삭제");
  softOnly(BUDGET, sentence(SENTENCE.replace("7억대에서 575건이", "7억대에서<strong> </strong>575건이")), ["text-wrap"], "대조: 공백을 래퍼 안으로 옮긴 것은 흐름이 같다");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "575<br>건이")), ["text"], "낱말 한가운데 br(공백이 생긴다)");
  caught(BUDGET, sentence(SENTENCE.replace("575건이 거래됐습니다", "575건이거래됐습니다")), ["text"], "노드 안 공백 삭제");
  // `</strong> 입니다` ↔ `</strong>입니다`: 텍스트 노드로는 둘 다 ["평균은", "8억", "입니다"]라 #285 판은 못 잡았다.
  const spaced = doc("<p>평균은 <strong>8억</strong> 입니다</p>");
  const tight = doc("<p>평균은 <strong>8억</strong>입니다</p>");
  assert.match(finding(caught(spaced, tight, ["text"], "인라인 뒤 공백 삭제(낱말 붙음)"), "text").note, note);
  caught(tight, spaced, ["text"], "인라인 뒤 공백 추가");
  caught(doc('<p><a href="./a.html">자세히</a> 보기</p>'), doc('<p><a href="./a.html">자세히</a>보기</p>'), ["text"], "링크 뒤 공백 삭제");
  // 공백 줄이기(여러 칸 → 한 칸)와 블록 가장자리의 공백은 화면에서 같으므로 통과한다(canon과 같은 규칙).
  passes(spaced, doc("<p>\n   평균은   <strong>8억</strong>\n 입니다  </p>"), "공백 줄이기·블록 가장자리");
});

test("#289 4번 검출(c): 블록 경계를 넘는 이동·합침·나눔은 하드 — 블록으로 치는 태그 목록", () => {
  const moved = caught(doc("<p>가 나</p><p>다</p>"), doc("<p>가</p><p>나 다</p>"), ["text"], "글자가 옆 문단으로 옮겨 감");
  assert.deepEqual([finding(moved, "text").missing, finding(moved, "text").added], [['"가 나"', '"다"'], ['"가"', '"나 다"']]);
  caught(doc("<p>가</p><p>나</p>"), doc("<p>가 나</p>"), ["text"], "두 문단이 하나로");
  caught(doc("<p><span>가</span></p><p><span>나</span></p>"), doc("<p><span>가</span> <span>나</span></p>"), ["text"], "텍스트 노드는 그대로 두고 두 블록을 합침");
  caught(doc("<p>가 나</p>"), doc("<p>가</p><p>나</p>"), ["text"], "한 문단을 둘로");
  caught(doc("<table><tbody><tr><td>1</td><td>2</td></tr></tbody></table>"), doc("<table><tbody><tr><td>1 2</td><td></td></tr></tbody></table>"), ["text"], "옆 칸으로");
  caught(doc("<ul><li>가</li><li>나</li></ul>"), doc("<ul><li>가 나</li></ul>"), ["text"], "li 합침");
  caught(doc("<h2>제목</h2><p>본문</p>"), doc("<h2>제목 본문</h2>"), ["headings", "text"], "본문이 제목 안으로");
  caught(doc("<dl><dt>이름</dt><dd>값</dd></dl>"), doc("<dl><dt>이름 값</dt><dd></dd></dl>"), ["text"], "dd → dt");
  caught(doc("<table><caption>표 제목</caption><tbody><tr><th>구</th></tr></tbody></table>"), doc("<table><caption>표 제목 구</caption><tbody><tr><th></th></tr></tbody></table>"), ["text"], "th → caption");
  // 인라인 형제를 블록으로 바꾸는 것도 블록 나눔이다(텍스트 노드는 같아도 흐름이 갈린다).
  caught(doc("<div><span>가</span> <span>나</span></div>"), doc("<div><div>가</div> <div>나</div></div>"), ["text"], "span → div");
  // 블록을 통째로 옮기는 것(순서)은 전과 같이 소프트다.
  softOnly(doc("<p>가</p><p>나</p>"), doc("<p>나</p><p>가</p>"), ["text-order"], "블록 순서");
  for (const tag of ["p", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd", "caption", "div", "section", "summary", "figcaption", "blockquote", "button", "label", "option"]) assert.ok(TEXT_BLOCK.has(tag), `${tag}는 블록이다`);
  for (const tag of ["br", "span", "strong", "a", "code", "del", "sup", "img", "svg"]) assert.ok(!TEXT_BLOCK.has(tag), `${tag}는 블록이 아니다`);
});

test("#289 4번 검출(d): 허용 래퍼는 중립 인라인 목록뿐 — del·s·ins·sub·sup·a·code와 template·script·style·noscript로 감싸면 하드", () => {
  for (const tag of ["del", "s", "ins", "sub", "sup", "u", "code", "q", "cite", "time", "x-custom"]) {
    const r = caught(BUDGET, sentence(SENTENCE.replace("575건이", `<${tag}>575</${tag}>건이`)), ["text"], `${tag}로 일부를 감쌈`);
    assert.ok(finding(r, "text").added[0].includes(`7억대에서 ‹${tag}›575‹/${tag}›건이`), `${tag}: 흐름에 태그가 남는다`);
  }
  // 노드 전체를 감싸도 같다(#285 판은 태그 이름을 보지 않아 문단 전체에 취소선을 그어도 통과했다).
  caught(doc("<p>가격은 7억입니다</p>"), doc("<p><del>가격은 7억입니다</del></p>"), ["text"], "문단 전체를 del로");
  caught(doc("<p>10<sup>2</sup></p>"), doc("<p>10<sub>2</sub></p>"), ["text"], "sup → sub");
  caught(doc("<p>10<sup>2</sup></p>"), doc("<p>10<span>2</span></p>"), ["text"], "뜻 있는 태그를 중립 태그로");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", '<a href="./index.html">575</a>건이')), ["links", "text"], "a로 감쌈");
  // 그리지 않는 태그로 일부를 감싸면 그 조각이 흐름에서 빠지거나 숨김 표시가 붙는다.
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<template>575</template>건이")), ["text"], "template");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<noscript>575</noscript>건이")), ["text"], "noscript");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", "<style>575</style>건이")), ["text"], "style");
  caught(BUDGET, sentence(SENTENCE.replace("575건이", '<script type="text/plain">575</script>건이')), ["inline-script", "s6-inline-bytes", "text"], "script");
});

test("#289 4번 검출(e): 래퍼에 hidden·aria-hidden·inert가 붙으면 하드 — 일부만 가리는 길", () => {
  const hidden = caught(BUDGET, sentence(SENTENCE.replace("575건이", "<span hidden>575</span>건이")), ["text"], "hidden");
  assert.ok(finding(hidden, "text").added.includes('"575" [hidden]'));
  assert.deepEqual(softIds(hidden), ["semantic"]);
  const aria = caught(BUDGET, sentence(SENTENCE.replace("575건이", '<span aria-hidden="true">575</span>건이')), ["text"], "aria-hidden");
  assert.ok(finding(aria, "text").added.includes('"575" [aria-hidden]'));
  assert.deepEqual(softIds(aria), ["hooks-added"], "전에는 이 소프트 한 줄뿐이었다");
  const inert = caught(BUDGET, sentence(SENTENCE.replace("575건이", "<span inert>575</span>건이")), ["text"], "inert");
  assert.ok(finding(inert, "text").added.includes('"575" [inert]'));
  // 블록 전체에 붙여도 같다. aria-hidden="false"는 가리는 것이 아니다.
  caught(BUDGET, sentence(SENTENCE.replace('<p class="budget-summary">', '<p class="budget-summary" aria-hidden="true">')), ["text"], "문단 전체 aria-hidden");
  caught(BUDGET, sentence(SENTENCE.replace('<p class="budget-summary">', '<p class="budget-summary" inert>')), ["text"], "문단 전체 inert");
  softOnly(BUDGET, sentence(SENTENCE.replace("575건이", '<span aria-hidden="false">575</span>건이')), ["hooks-added", "text-wrap"], 'aria-hidden="false"');
  // 숨김이 겹치면 표시도 겹쳐 적는다 — 안쪽 것 하나를 떼도 잡힌다.
  const nested = doc('<div aria-hidden="true"><p hidden>가</p></div>');
  assert.deepEqual(extractPage(nested).texts, ['"가" [aria-hidden] [hidden]']);
  caught(nested, nested.replace("<p hidden>", "<p>"), ["text"], "겹친 숨김에서 하나 제거");
});

test("#289 4번 (h): 제목·링크 글자·속성 글자 check는 이 완화의 영향을 받지 않는다 — 래퍼 안의 변경도 각자 이름으로 건다", () => {
  const h2 = '<h2 id="budget-heading">예산으로 찾기</h2>';
  const link = '<a href="./method.html" id="method-callout-link">숫자를 만드는 방법 →</a>';
  // 글자가 같으면 제목·링크 check는 조용하고(전과 같다) 본문 쪽 소프트만 남는다.
  softOnly(BUDGET, mutate(BUDGET, h2, '<h2 id="budget-heading">예산으로 <span>찾기</span></h2>'), ["text-wrap"], "제목 안 부분 래퍼");
  softOnly(BUDGET, mutate(BUDGET, link, '<a href="./method.html" id="method-callout-link"><b>숫자</b>를 만드는 방법 →</a>'), ["text-wrap"], "링크 안 부분 래퍼");
  // 래퍼 안에서 글자·공백이 바뀌면 제목은 headings, 링크는 links로(본문 text와 함께) 건다.
  const heading = caught(BUDGET, mutate(BUDGET, h2, '<h2 id="budget-heading">예산으로 <span>찾끼</span></h2>'), ["headings", "text"], "제목: 래퍼 안 한 글자");
  assert.deepEqual([finding(heading, "headings").missing, finding(heading, "headings").added], [['h2 "예산으로 찾기"'], ['h2 "예산으로 찾끼"']]);
  caught(BUDGET, mutate(BUDGET, h2, '<h2 id="budget-heading">예산으로<span>찾기</span></h2>'), ["headings", "text"], "제목: 래퍼 경계의 공백 삭제");
  caught(BUDGET, mutate(BUDGET, h2, '<h2 id="budget-heading">예산<span> </span>으로 찾기</h2>'), ["headings", "text"], "제목: 래퍼로 공백 추가");
  // 제목·링크 글자에서 br은 아무것도 보태지 않는다(전과 같다): 공백을 남기고 넣으면 같고, 공백을 br로 바꾸면 본문 흐름은 같아도 headings가 건다.
  softOnly(BUDGET, mutate(BUDGET, h2, '<h2 id="budget-heading">예산으로 <br>찾기</h2>'), ["text-wrap"], "제목: 공백 뒤 br");
  caught(BUDGET, mutate(BUDGET, h2, '<h2 id="budget-heading">예산으로<br>찾기</h2>'), ["headings"], "제목: 공백을 br로 바꿈");
  const linked = caught(BUDGET, mutate(BUDGET, link, '<a href="./method.html" id="method-callout-link"><b>숫지</b>를 만드는 방법 →</a>'), ["links", "text"], "링크: 래퍼 안 한 글자");
  assert.match(finding(linked, "links").added[0], /글자="숫지를 만드는 방법 →"$/);
  caught(BUDGET, mutate(BUDGET, link, '<a href="./method.html" id="method-callout-link"><b>숫자</b> 를 만드는 방법 →</a>'), ["links", "text"], "링크: 래퍼 뒤 공백 추가");
  // 속성 글자는 요소를 감싸든 말든 값 그대로 견준다.
  const wrapped = mutate(SYNTH, "<h1>표</h1>", "<h1><span>표</span></h1>").replace("표본 부족</span>", "<b>표본</b> 부족</span>");
  softOnly(SYNTH, wrapped, ["text-wrap"], "속성은 그대로");
  caught(SYNTH, mutate(wrapped, 'title="신고 2건이라 평균을 내기엔 표본이 부족합니다"', 'title="신고 3건이라 평균을 내기엔 표본이 부족합니다"'), ["attr-text"], "속성 글자: 래퍼가 있어도 숫자 한 자리");
  caught(SYNTH, mutate(wrapped, 'data-label="평당가"', 'data-label="평당 가"'), ["attr-text"], "속성 글자: 공백 추가");
});

test("#289 4번 (f): 통과시킨 부분 래퍼는 장별 소프트로 — 같은 흐름이 여럿이면 모양이 다른 것만 센다", () => {
  const a = doc("<table><tbody><tr><td>575</td><td>575건</td><td>575건</td></tr></tbody></table><p>합계 575건이고 평균 8억입니다</p>");
  const b = doc("<table><tbody><tr><td>575</td><td><strong>575</strong>건</td><td>575건</td></tr></tbody></table><p>합계 <strong>575</strong>건이고<br>평균 <em>8억</em>입니다</p>");
  const r = softOnly(a, b, ["text-wrap"], "두 블록");
  const f = finding(r, "text-wrap");
  assert.deepEqual(f.missing, ['"575건"', '"합계 575건이고 평균 8억입니다"']);
  assert.deepEqual(f.added, ['"‹strong›575‹/strong›건"', '"합계 ‹strong›575‹/strong›건이고⏎평균 ‹em›8억‹/em›입니다"']);
  assert.equal(f.note, "블록 2개 — 래퍼 0→3개, br 0→1개");
  assert.deepEqual([r.pass, r.soft, r.hard], [0, 1, 0]);
  // 하드가 함께 있어도 통과시킨 래퍼는 따로 적힌다(무엇이 감싸졌는지는 늘 보인다).
  const mixed = cmp(a, b.replace("<td>575</td>", "<td>576</td>"));
  assert.deepEqual([hardIds(mixed), softIds(mixed)], [["text"], ["text-wrap"]]);
  assert.deepEqual([finding(mixed, "text").missing, finding(mixed, "text").added], [['"575"'], ['"576"']], "하드 목록에는 바뀐 블록만 나온다(감싼 블록은 섞이지 않는다)");
});

test("#289 5번: 훅 목록 어긋남과 기준 대비 빠진 이름을 폴더 단위 소프트로 — --render가 보고에 같이 낸다", () => {
  const list = { js: ["a", "b", "old"], markup: ["m"] };
  const head = { js: ["a", "b", "new"], markup: ["m"] };
  const base = { js: ["a", "b", "gone"], markup: ["m", "moved", "b"] };
  const findings = hookListFindings({ list, head: { ...head, markup: ["m", "moved"] }, base });
  assert.deepEqual(
    findings.map((f) => [f.id, f.level, f.missing, f.added]),
    [
      ["hook-list", "soft", ["js: old"], ["js: new", "markup: moved"]],
      ["hook-list-dropped", "soft", ["gone"], []],
    ],
    "목록에만(old)·소스에만(new, moved) / 기준 소스에서는 훅이었고 후보에서는 아닌 이름(gone)"
  );
  assert.deepEqual(hookListFindings({ list: head, head, base: head }), [], "맞으면 아무것도 내지 않는다");
  assert.deepEqual(hookListFindings({ list, head }).map((f) => f.id), ["hook-list"], "기준을 안 주면 어긋남만");
  // 결과에 보태도 종료 코드는 그대로(소프트)이고 보고서에 이름이 나온다.
  const r = withSiteFindings(cmp(BUDGET, BUDGET), findings);
  assert.deepEqual([r.ok, r.pass, r.site.length], [true, 1, 2]);
  const text = formatInvariantsReport(r);
  assert.match(text, /\[소프트\] 훅 클래스 목록\(hook-classes\.json\)이 후보 소스와 어긋났다\(- 목록에만, \+ 소스에만\) — --hooks-write로 다시 만든다 <hook-list>: 기준에만 1, 후보에만 2\n  - js: old\n  \+ js: new\n  \+ markup: moved/);
  assert.match(text, /\[소프트\] 기준 소스에서는 훅이었고 후보 소스에서는 아닌 class\(더는 훅으로 보지 않는다\) <hook-list-dropped>: 기준에만 1, 후보에만 0\n  - gone/);
  // 하드 항목이 있으면 보태도 실패 그대로다.
  assert.equal(withSiteFindings(cmp(BUDGET, sentence(SENTENCE.replace("575", "576"))), findings).ok, false);
});

test("#289 6번 검출: 참조 자원의 대상 파일 — style.css·manifest·아이콘·img를 지우면 하드(resource-target), JS가 읽는 data/는 소프트 목록", async () => {
  const head = '<link rel="stylesheet" href="./style.css"><link rel="manifest" href="./manifest.webmanifest"><link rel="icon" href="./icons/icon-192.png"><link rel="canonical" href="https://kyhsa93.github.io/jipgye/index.html"><link rel="preconnect" href="https://fonts.example/">';
  const base = { "index.html": mini('<img src="./icons/a.png" alt="그림" srcset="./icons/a.png 1x, ./icons/a2.png 2x"> <a href="./a.html">a</a>', head), "a.html": mini("둘째 장", head), "nav.js": "// nav\n", "style.css": ".a{color:red}", "manifest.webmanifest": "{}", "icons/icon-192.png": "png", "icons/a.png": "png", "icons/a2.png": "png", "data/x.json": "{}" };
  const dirs = { a: await dirWith(base), same: await dirWith(base), noCss: await dirWith({ ...base, "style.css": undefined }), noManifest: await dirWith({ ...base, "manifest.webmanifest": undefined, "icons/icon-192.png": undefined }), noImg: await dirWith({ ...base, "icons/a2.png": undefined }), noData: await dirWith({ ...base, "data/x.json": undefined }) };
  try {
    const ok = await compareInvariants(dirs.a, dirs.same, { hookList: [] });
    assert.deepEqual([ok.ok, ok.pass, ok.site], [true, 2, []]);

    const css = await compareInvariants(dirs.a, dirs.noCss, { hookList: [] });
    assert.equal(css.ok, false);
    assert.deepEqual(css.pages.map((p) => [p.file, p.status, p.findings.map((f) => [f.id, f.level, f.added])]), [["a.html", "hard", [["resource-target", "hard", ["./style.css"]]]], ["index.html", "hard", [["resource-target", "hard", ["./style.css"]]]]], "head의 link 줄은 그대로여도 대상이 없으면 장마다 건다");
    assert.deepEqual(css.site.map((f) => [f.id, f.level, f.missing]), [["files-removed", "soft", ["style.css"]]]);

    const manifest = await compareInvariants(dirs.a, dirs.noManifest, { hookList: [] });
    assert.deepEqual(manifest.pages.map((p) => p.findings.map((f) => [f.id, f.added])), [[["resource-target", ["./manifest.webmanifest", "./icons/icon-192.png"]]], [["resource-target", ["./manifest.webmanifest", "./icons/icon-192.png"]]]], "manifest·icon");

    const img = await compareInvariants(dirs.a, dirs.noImg, { hookList: [] });
    assert.deepEqual(img.pages.map((p) => [p.file, p.status, p.findings.map((f) => [f.id, f.added])]), [["a.html", "pass", []], ["index.html", "hard", [["resource-target", ["./icons/a2.png"]]]]], "img srcset의 대상");

    // HTML이 속성으로 가리키지 않는 파일(JS가 fetch로 읽는 data/)은 참조를 못 읽는다 — 폴더 단위 소프트 목록으로만 낸다.
    const data = await compareInvariants(dirs.a, dirs.noData, { hookList: [] });
    assert.deepEqual([data.ok, data.hard, data.site.map((f) => [f.id, f.level, f.missing])], [true, 0, [["files-removed", "soft", ["data/x.json"]]]]);
    assert.match(formatInvariantsReport(data), /\[소프트\] 폴더에서 사라진 파일\(\.html 밖\) <files-removed>: 기준에만 1, 후보에만 0\n  - data\/x\.json/);

    // 기준에서도 없던 대상은 새 실패가 아니다(바깥 주소는 보지 않는다).
    const already = await compareInvariants(dirs.noCss, dirs.noCss, { hookList: [] });
    assert.equal(already.ok, true);
  } finally {
    await Promise.all(Object.values(dirs).map((d) => rm(d, { recursive: true })));
  }
  assert.deepEqual(extractPage(doc('<video poster="./p.png" src="./v.mp4"></video><object data="./o.svg"></object><img srcset="data:image/png;base64,AAAA 1x, ./b.png 2x">')).resources, ["./v.mp4", "./p.png", "./o.svg"], "poster·object[data]도 본다. data: 주소가 섞인 srcset은 읽지 않는다");
});

test("#289 7번: theme-color 메타가 여럿이면 전부 보고한다(마지막 값만 보지 않는다)", () => {
  const head = (light, dark) => `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${light}"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="${dark}">`;
  const a = doc("<p>가</p>", head("#253e81", "#0b1220"));
  // 앞의 것만 바꾼다 — 마지막 값만 보면 조용히 지나간다.
  const first = softOnly(a, doc("<p>가</p>", head("#0f766e", "#0b1220")), ["head-exception"], "앞의 것만");
  assert.deepEqual([finding(first, "head-exception").missing, finding(first, "head-exception").added], [['meta[name=theme-color][media="(prefers-color-scheme: light)"] content=#253e81'], ['meta[name=theme-color][media="(prefers-color-scheme: light)"] content=#0f766e']]);
  const both = softOnly(a, doc("<p>가</p>", head("#0f766e", "#000000")), ["head-exception"], "둘 다");
  assert.equal(finding(both, "head-exception").added.length, 2, "둘 다 적힌다");
  // media를 바꾸거나 하나를 지우는 것은 값이 아니라 줄이 달라진 것이라 head 하드다.
  caught(a, a.replace("(prefers-color-scheme: dark)", "(min-width: 600px)"), ["head"], "media 변경");
  caught(a, doc("<p>가</p>", '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#253e81">'), ["head"], "하나 제거");
  // 하나뿐일 때의 항목 모양은 전과 같다.
  const single = softOnly(BUDGET, mutate(BUDGET, '<meta name="theme-color" content="#253e81">', '<meta name="theme-color" content="#0f766e">'), ["head-exception"], "하나");
  assert.deepEqual([finding(single, "head-exception").missing, finding(single, "head-exception").added], [["meta[name=theme-color] content=#253e81"], ["meta[name=theme-color] content=#0f766e"]]);
});

test("#289 8번 못 잡는 것(적어 둔다): 글자 없는 요소 추가(img·iframe·body 안 link), form action·disabled·tabindex 변경은 통과한다 — README '못 잡는 것'", () => {
  const form = '<form class="site-search" action="./deal-search.html"><input type="search" name="q"><button type="submit">찾기</button></form>';
  const a = doc(`<p>가</p>${form}`);
  passes(a, a.replace("<p>가</p>", '<p>가</p><img src="https://example.com/t.gif">'), "글자 없는 img(alt 없음)");
  passes(a, a.replace("<p>가</p>", '<p>가</p><iframe src="https://example.com/"></iframe>'), "iframe");
  passes(a, a.replace("<p>가</p>", '<p>가</p><link rel="stylesheet" href="https://example.com/x.css">'), "body 안 link");
  passes(a, a.replace('action="./deal-search.html"', 'action="https://example.com/collect"'), "form action");
  passes(a, a.replace('<button type="submit">', '<button type="submit" disabled>'), "disabled");
  passes(a, a.replace('<input type="search"', '<input tabindex="-1" type="search"'), "tabindex");
  // 같은 줄에 적힌 것 가운데 이번에 닫은 것: inert는 글자 위에 붙으면 하드, alt가 있는 img는 속성 글자로 하드.
  caught(a, a.replace("<p>가</p>", "<p inert>가</p>"), ["text"], "inert");
  caught(a, a.replace("<p>가</p>", '<p>가</p><img src="./x.png" alt="그림">'), ["attr-text"], "alt가 있는 img");
});

test("#289 그 밖: 형식이 틀린 예외 목록은 사용법 오류(종료 2, 스택 없이 한 줄)", async () => {
  const base = { "index.html": mini("가"), "nav.js": "// nav\n" };
  const [a, b] = [await dirWith(base), await dirWith({ ...base, "index.html": mini("나") })];
  const expect = path.join(a, "..", `${path.basename(a)}.expect.json`);
  const run = (...args) => spawnSync(process.execPath, [BIN, a, b, ...args], { encoding: "utf8" });
  try {
    assert.equal(run().status, 1, "예외 목록 없이는 하드 실패 1");
    const cases = { "JSON이 아님": "{ exceptions: [", "배열이 아님": '{"exceptions": {"page": "*"}}', "confirmedBy 없음": JSON.stringify({ exceptions: [{ page: "*", check: "text", missing: ['"가"'], reason: "r" }] }), "check 통째": JSON.stringify([{ page: "*", check: "text", reason: "r", confirmedBy: "c" }]) };
    for (const [why, body] of Object.entries(cases)) {
      await writeFile(expect, body);
      const r = run("--expect", expect);
      assert.equal(r.status, 2, `${why}: ${r.stderr}`);
      assert.match(r.stderr, /^예외 목록\(--expect .*\)을 받을 수 없습니다: .+\n$/, why);
      assert.doesNotMatch(r.stderr, /\n\s+at /, `${why}: 스택을 쏟지 않는다`);
    }
    assert.equal(run("--expect", path.join(a, "없는-파일.json")).status, 2, "파일이 없음");
    // 맞는 목록은 전과 같이 받는다.
    await writeFile(expect, JSON.stringify({ exceptions: [{ page: "index.html", check: "text", missing: ['"가"'], added: ['"나"'], reason: "문구 교체", confirmedBy: "po 댓글 주소" }] }));
    const ok = run("--expect", expect);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /의도한 차이로 지운 항목 2개/);
  } finally {
    await Promise.all([a, b].map((d) => rm(d, { recursive: true })));
    await rm(expect, { force: true });
  }
});

// ───────────────────────── PR #292 cto 검증의 보완 ─────────────────────────

test("#289 4번 검출(d) 보완: 뜻 있는 인라인이 블록을 바깥에서 감싸도 하드 — 안쪽 블록의 항목에 [in:태그] 표시가 붙는다", () => {
  const base = doc('<p>▲ 상승</p><div class="answer">답</div><ul><li>가</li><li>나</li></ul>');
  // cto가 넣어 통과를 확인한 다섯 가지(391f6901). 여는 표시(`‹del›`)가 든 통에 글자가 없어 통째로 버려지던 자리다.
  const outside = {
    del: [base.replace("<p>▲ 상승</p>", "<del><p>▲ 상승</p></del>"), ['"▲ 상승" [in:del]']],
    s: [base.replace('<div class="answer">답</div>', '<s><div class="answer">답</div></s>'), ['"답" [in:s]']],
    ins: [base.replace("<ul><li>가</li><li>나</li></ul>", "<ins><ul><li>가</li><li>나</li></ul></ins>"), ['"가" [in:ins]', '"나" [in:ins]']],
    sub: [base.replace("<p>▲ 상승</p>", "<sub><p>▲ 상승</p></sub>"), ['"▲ 상승" [in:sub]']],
    "href 없는 a": [base.replace("<p>▲ 상승</p>", "<a><p>▲ 상승</p></a>"), ['"▲ 상승" [in:a]']],
  };
  for (const [why, [wrapped, items]] of Object.entries(outside)) {
    assert.notEqual(wrapped, base, why);
    const r = caught(base, wrapped, ["text"], `${why}: 블록을 바깥에서 감쌈`);
    assert.deepEqual(finding(r, "text").added, items, why);
    assert.deepEqual(finding(r, "text").missing, items.map((x) => x.replace(/ \[in:[a-z]+\]$/, "")), why);
    // 반대 방향: 기준에 있던 바깥 감싸기를 벗긴다.
    const back = caught(wrapped, base, ["text"], `${why}: 바깥 감싸기를 벗김`);
    assert.deepEqual(finding(back, "text").missing, items, why);
  }
  // 고정 사본의 문단, 블록을 더 깊이 둔 것, 블록 여럿을 한꺼번에, 모르는 태그.
  const callout = '<p id="method-callout-text">매물 호가가 아니라 국토교통부에 신고된 실거래입니다. 자치구는 한 주 표본이 얇아 최근 4주를 겹쳐 세고, 신고가 5건 미만인 구는 평균을 내지 않고 비워 둡니다.</p>';
  caught(BUDGET, mutate(BUDGET, callout, `<del>${callout}</del>`), ["text"], "고정 사본의 문단을 del로");
  // aside째 감싸면 안의 문단과 링크 글자가 모두 달라진다(링크의 href·글자는 그대로라 links는 조용하다).
  const aside = caught(BUDGET, mutate(BUDGET, '<aside class="method-callout">', '<del><aside class="method-callout">').replace("</aside>", "</aside></del>"), ["text"], "aside 전체를 del로");
  assert.equal(finding(aside, "text").added.length, 2);
  assert.ok(finding(aside, "text").added.every((x) => x.endsWith(" [in:del]")));
  assert.deepEqual(extractPage(doc("<del><div><section><p>깊이</p></section></div></del><x-note><p>모르는 태그</p></x-note>")).texts, ['"깊이" [in:del]', '"모르는 태그" [in:x-note]']);
  // 안쪽에서 감싼 것과 바깥에서 감싼 것은 항목 모양이 다르다(둘 다 기준의 맨 문단과는 다르다).
  caught(doc("<p><del>가</del></p>"), doc("<del><p>가</p></del>"), ["text"], "del을 블록 밖으로 옮김");
  // 여는 표시가 든 통에 글자가 있으면 그 통에는 표시(`‹del›`)가 남고, 뒤따르는 블록과 이어지는 통에 [in:del]이 붙는다. 숨김 표시와 겹쳐 적는다.
  assert.deepEqual(extractPage(doc("<div><del>앞<p>문단</p>뒤</del></div><div><ins><p hidden>숨김</p></ins></div>")).texts, ['"‹del›앞"', '"문단" [in:del]', '"뒤‹/del›" [in:del]', '"숨김" [hidden] [in:ins]']);
  // 블록 링크(a가 블록을 감싼다)는 기준·후보가 같으면 통과한다. class·블록 태그만 바꿔도 같다.
  const card = doc('<a href="./a.html" class="card"><div class="card-title">제목</div><p class="card-note">설명</p></a>');
  assert.deepEqual(extractPage(card).texts, ['"제목" [in:a]', '"설명" [in:a]']);
  passes(card, card, "블록 링크 그대로");
  passes(card, doc('<a href="./a.html" class="tw:block tw:p-4"><h3 class="tw:font-bold">제목</h3><div class="tw:text-sm">설명</div></a>').replace("<h3", "<div").replace("</h3>", "</div>"), "블록 링크: class·블록 태그만");
  // 블록 링크를 벗기거나 새로 씌우면 links와 text가 함께 건다.
  caught(card, doc('<div class="card"><div class="card-title">제목</div><p class="card-note">설명</p></div>'), ["links", "text"], "블록 링크를 벗김");
  caught(base, base.replace("<p>▲ 상승</p>", '<a href="./a.html"><p>▲ 상승</p></a>'), ["links", "text"], "블록을 링크로 감쌈");
  // 중립 인라인이 블록을 감싸는 것은 뜻을 바꾸지 않는다(전과 같이 보고 없음).
  passes(base, base.replace("<p>▲ 상승</p>", "<strong><p>▲ 상승</p></strong>"), "strong이 블록을 감쌈");
});

test("#289 4번: 블록 나눔이 하드인 동안 #279가 쓸 수 있는 통과하는 길 둘 — 인라인 태그를 유지하고 class로 블록처럼, 붙어 있는 형제를 함께 감싸는 블록 래퍼", () => {
  const li = '<li><span class="answer-label">자기 돈이 적어도</span><strong class="answer-value">4억 6,950만원</strong><span class="answer-note">생애최초면 2억 4,250만원</span></li>';
  const inner = li.slice("<li>".length, -"</li>".length);
  // 길 1: 태그는 span·strong 그대로 두고 class로 블록처럼 그린다.
  passes(BUDGET, mutate(BUDGET, li, li.replace('class="answer-label"', 'class="answer-label tw:block tw:text-sm"').replace('class="answer-value"', 'class="answer-value tw:block tw:text-2xl"').replace('class="answer-note"', 'class="answer-note tw:block"')), "class로 블록처럼");
  // 길 2: 붙어 있는 형제 셋을 **함께** 감싸는 블록 래퍼(블록 하나의 글자 흐름이 그대로다).
  passes(BUDGET, mutate(BUDGET, li, `<li><div class="tw:flex tw:flex-col tw:gap-1">${inner}</div></li>`), "함께 감싸는 블록 래퍼");
  passes(BUDGET, mutate(BUDGET, li, `<li><div class="tw:p-2"><div class="tw:flex">${inner}</div></div></li>`), "블록 래퍼 겹침");
  // 길이 아닌 것: 형제의 일부만 블록으로 감싸거나 인라인을 블록 태그로 바꾸면 한 블록이 둘로 갈린다(하드, 보고서가 사유를 적는다).
  const partial = caught(BUDGET, mutate(BUDGET, li, li.replace('<span class="answer-label">자기 돈이 적어도</span><strong class="answer-value">4억 6,950만원</strong>', '<div class="tw:flex"><span class="answer-label">자기 돈이 적어도</span><strong class="answer-value">4억 6,950만원</strong></div>')), ["text"], "형제의 일부만 감싸는 블록 래퍼");
  assert.match(finding(partial, "text").note, /글자는 같고 블록 안 공백이나 블록 경계가 달라졌다/);
  assert.deepEqual([finding(partial, "text").missing, finding(partial, "text").added], [['"자기 돈이 적어도4억 6,950만원생애최초면 2억 4,250만원"'], ['"자기 돈이 적어도4억 6,950만원"', '"생애최초면 2억 4,250만원"']]);
  caught(BUDGET, mutate(BUDGET, li, li.replace('<span class="answer-note">생애최초면 2억 4,250만원</span>', '<div class="answer-note">생애최초면 2억 4,250만원</div>')), ["text"], "span → div");
});

test("못 잡는 것(적어 둔다, PR #292 cto): 글자를 option·textarea·SVG title/desc로 옮김, javascript: action·formaction·srcdoc, 0바이트 style.css, 빈 블록으로 통째 옮김 — README '못 잡는 것'", async () => {
  const a = doc('<p>표본이 부족합니다</p><form action="./deal-search.html"><button type="submit">찾기</button></form><table><tbody><tr><td>7억</td><td></td><td>-</td></tr></tbody></table>');
  // 글자를 그려지지 않거나 다르게 그려지는 자리로 옮겨도 블록 하나의 글자 흐름은 같다.
  passes(a, a.replace("<p>표본이 부족합니다</p>", "<select><option>표본이 부족합니다</option></select>"), "option으로");
  passes(a, a.replace("<p>표본이 부족합니다</p>", "<textarea>표본이 부족합니다</textarea>"), "textarea로");
  passes(a, a.replace("<p>표본이 부족합니다</p>", "<svg><title>표본이 부족합니다</title></svg>"), "SVG title로");
  passes(a, a.replace("<p>표본이 부족합니다</p>", "<svg><desc>표본이 부족합니다</desc></svg>"), "SVG desc로");
  // on*이 아닌 자리의 스크립트.
  passes(a, a.replace('action="./deal-search.html"', 'action="javascript:steal()"'), 'form action="javascript:"');
  passes(a, a.replace('<button type="submit">', '<button type="submit" formaction="javascript:steal()">'), "button formaction");
  passes(a, a.replace("<p>표본이 부족합니다</p>", '<p>표본이 부족합니다</p><iframe srcdoc="&lt;script&gt;x()&lt;/script&gt;"></iframe>'), "iframe srcdoc");
  // 블록의 글자 전체를 **빈** 블록으로 옮기면 다중집합도 순서도 같아 보고가 없다. 글자가 있는 칸과 맞바꾸면 순서 소프트로 나온다.
  passes(a, a.replace("<td>7억</td><td></td>", "<td></td><td>7억</td>"), "빈 칸으로 통째 옮김");
  softOnly(a, a.replace("<td>7억</td><td></td><td>-</td>", "<td>-</td><td></td><td>7억</td>"), ["text-order"], "글자 있는 칸과 맞바꿈");
  // 인라인 style로 숨기는 것은 CSS다(#278 PR A의 렌더 검사 몫).
  passes(a, a.replace("<p>표본이 부족합니다</p>", '<p style="display:none">표본이 부족합니다</p>'), 'style="display:none"');
  // 거짓 실패 쪽: 문장 안에 빈 alt의 아이콘을 넣으면 속성 글자(alt="")가 하나 늘어 하드다.
  const icon = caught(a, a.replace("<p>표본이 부족합니다</p>", '<p><img src="./icons/warn.png" alt="">표본이 부족합니다</p>'), ["attr-text"], '문장 안 <img alt="">');
  assert.deepEqual(finding(icon, "attr-text").added, ['alt=""']);
  // 참조 자원은 있는지만 본다 — style.css를 0바이트로 비워도 통과한다.
  const base = { "index.html": mini("가", '<link rel="stylesheet" href="./style.css">'), "nav.js": "// nav\n", "style.css": ".a{color:red}" };
  const [full, empty] = [await dirWith(base), await dirWith({ ...base, "style.css": "" })];
  try {
    const r = await compareInvariants(full, empty, { hookList: [] });
    assert.deepEqual([r.ok, r.pass, r.site], [true, 1, []]);
  } finally {
    await Promise.all([full, empty].map((d) => rm(d, { recursive: true })));
  }
});
