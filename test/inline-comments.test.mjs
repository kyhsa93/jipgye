import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { findJsComments, stripJsComments, stripInlineScriptComments } from "../scripts/strip-inline-comments.ts";
import { BUDGET_PAGES } from "../scripts/budget-pages.ts";
import { DISTRICT_PAGES } from "../scripts/district-slugs.ts";
import { REALESTATE_PAGES, buildDistrictPage, buildRealestatePage } from "../scripts/build-realestate-pages.ts";
import { buildBudgetPage } from "../scripts/build-budget-pages.ts";
import { REALESTATE_TEMPLATE_PATH, applyPrerender, realestateHeadHtml, realestateOverallHtml, realestateTableHtml } from "../scripts/prerender.ts";
import { RATE_PAGES, buildRatePage } from "../scripts/build-rate-pages.ts";
import { NEWS_PAGES, buildNewsPage } from "../scripts/build-news-pages.ts";
import { buildBands, mergeBands } from "../scripts/budget-bands.ts";
import { jsInlineScripts, proveCommentsOnly, proveHtmlCommentsOnly, onlyWhitespaceAndCommentsRemoved, sameSyntax } from "./helpers/comment-proof.mjs";

/**
 * 틀의 인라인 스크립트 주석은 굽는 단계에서 뗀다 (#313).
 *
 * 틀(scripts/realestate-template.html · scripts/rates-template.html)에는 "왜"를 마음껏 적는다. 그 주석이 장마다 글자 그대로 복사돼
 * 브라우저로 나가면 S6(나가는 JS를 늘리지 않는다)와 매번 부딪친다(#297: 11줄 → 5줄 → +184B). 이 파일이 지키는 것은 셋이다.
 *
 *   1. 굽는 장 전수에 인라인 스크립트 주석이 0이다(되풀이 방지 - 틀을 고치다 빌더의 마지막 단계를 빼면 여기서 걸린다).
 *   2. 훑개는 주석만 뗀다(구문 트리가 같고, 지워진 글자가 공백과 주석뿐이다). 증명기 자신이 다른 변화를 잡는지도 본다.
 *   3. 틀은 주석을 그대로 갖는다(소스가 단일 출처다 - 소스맵은 쓰지 않는다).
 *
 * 범위: 틀에서 찍어 내는 장 54장. 시세 틀은 #374 에서 docs/ 밖(scripts/realestate-template.html)으로 옮겼고, 틀 자신이 나가는 장
 * docs/realestate.html 도 prerender.ts 가 틀을 채운 뒤 훑개를 걸어 낸다 - 그래서 이 장도 53장과 같은 줄에 선다.
 * 손으로 쓴 나머지 장(index·deal-search …)은 제자리 원본이라 범위 밖이다 - 아래 "범위 밖" 시험이 숫자로 고정한다.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

// 구운 장 = 빌더 넷이 찍어 내는 장 + 시세 틀을 prerender.ts 가 채워 내는 docs/realestate.html(#374). 장 수는 아래 시험이 고정한다.
const TEMPLATE = "scripts/realestate-template.html";
const BAKED = [
  "realestate.html",
  ...BUDGET_PAGES.map((p) => p.file),
  ...DISTRICT_PAGES.map((p) => p.file),
  ...REALESTATE_PAGES.map((p) => p.file),
  ...RATE_PAGES.map((p) => p.file),
  ...NEWS_PAGES.map((p) => p.file),
];

/** 훑개와는 따로 쓴 거친 그물: 줄 머리 `//`·`/*`·`*`, 코드 뒤 ` // ` 주석(문자열 속 `://`은 앞에 공백이 없어 안 걸린다). */
const COARSE = [/^[ \t]*\/\//m, /^[ \t]*\/\*/m, /^[ \t]*\*[ \t/]/m, /\S[ \t]+\/\/[ \t]/];

const commentLines = (html) => jsInlineScripts(html).flatMap((s) => s.body.split("\n").filter((l) => COARSE.some((re) => re.test(l))));

test("구운 장 수: 예산대 18 · 자치구 25 · 거래유형 3 · 금리 4 · 뉴스 3 · 시세 틀이 낸 장 1", () => {
  assert.deepEqual([BUDGET_PAGES.length, DISTRICT_PAGES.length, REALESTATE_PAGES.length, RATE_PAGES.length, NEWS_PAGES.length], [18, 25, 3, 4, 3]);
  assert.equal(new Set(BAKED).size, 54, "장 이름이 겹친다");
});

test("구운 54장 전수: 인라인 스크립트에 줄 주석도 블록 주석도 없다", async () => {
  const bad = [];
  for (const file of BAKED) {
    const html = await read(`docs/${file}`);
    const scripts = jsInlineScripts(html);
    assert.ok(scripts.length >= 1, `${file}: 인라인 스크립트가 없다 - 이 시험이 아무것도 안 본 것이다`);
    for (const s of scripts) {
      const found = findJsComments(s.body).length;
      const coarse = s.body.split("\n").filter((l) => COARSE.some((re) => re.test(l))).length;
      if (found || coarse) bad.push(`${file}: 훑개 ${found}개 · 거친 그물 ${coarse}줄`);
    }
  }
  assert.deepEqual(bad, [], "굽는 단계의 마지막(stripInlineScriptComments)이 빠졌거나 틀이 직접 나가고 있다");
});

test("훑개는 문자열·템플릿·정규식 속 // 와 /* 를 주석으로 읽지 않는다", () => {
  const code = [
    'const url = "https://example.com/a//b"; const s = \'/* not */\';',
    "const t = `a // b ${x /* c */ + `n // ${y}`} /* d */`;",
    "const re = /\\/\\/|[/*]/g; const div = a / b / c; const d2 = (a) / 2;",
    "const q = x.replace(/https?:\\/\\//, '');",
  ].join("\n");
  const found = findJsComments(code).map((c) => code.slice(c.start, c.end));
  assert.deepEqual(found, ["/* c */"], "템플릿의 ${…} 안 주석 하나만 주석이다");
  assert.equal(stripJsComments(code), code.replace("/* c */", "").replace("x  + `", "x + `"));
});

test("훑개: 줄째·줄 끝·인라인 블록 주석을 떼고 나머지는 한 글자도 안 바꾼다", () => {
  const src = [
    "function f() {",
    "  // 줄째",
    "  const a = 1; // 줄 끝",
    "",
    "  /**",
    "   * 문서 주석",
    "   */",
    "  const b = /* 안 */ 2;",
    "  const c = a/* 붙음 */b;",
    "  return a + b;",
    "}",
    "",
  ].join("\n");
  assert.equal(
    stripJsComments(src),
    ["function f() {", "  const a = 1;", "", "  const b = 2;", "  const c = a b;", "  return a + b;", "}", ""].join("\n")
  );
});

test("훑개: 줄바꿈을 품은 블록 주석은 줄바꿈 하나를 남긴다(ASI)", () => {
  const src = "const a = 1 /* x\n y */ + 2\nconst b = a /* x\n y */\nfoo()";
  const out = stripJsComments(src);
  assert.equal(out, "const a = 1\n+ 2\nconst b = a\nfoo()");
  assert.ok(sameSyntax(src, out), "구문이 같다");
});

test("훑개: 주석이 없으면 같은 문자열을 돌려준다", () => {
  const src = 'const a = "x // y";\nlet n = 1 / 2;\n';
  assert.equal(stripJsComments(src), src);
  assert.equal(stripJsComments(""), "");
});

test("훑개: 닫히지 않은 구조는 조용히 넘기지 않고 던진다", () => {
  for (const bad of ["/* 열림", 'const a = "닫힘 없음', "const t = `열림", "const r = /열림", "const t = `a ${b"]) {
    assert.throws(() => stripJsComments(bad), /닫히지 않았습니다/, bad);
  }
});

test("stripInlineScriptComments: 스크립트 밖·JSON 섬·외부 script 태그는 한 글자도 안 바뀐다", () => {
  const html = [
    "<!-- // 마크업 주석은 대상이 아니다 -->",
    '<p>// 본문 글자 /* 도 */ 그대로</p>',
    '<script type="application/ld+json">{"a": "// 섬 안은 JSON"}</script>',
    '<script src="./nav.js"></script>',
    "<script>",
    "// 떼는 주석",
    "const a = 1; // 떼는 주석 둘",
    "</script>",
    '<script type="module">/* 모듈 */ export const b = 2;</script>',
    "",
  ].join("\n");
  const out = stripInlineScriptComments(html);
  assert.equal(
    out,
    html.replace("\n// 떼는 주석\nconst a = 1; // 떼는 주석 둘\n", "\nconst a = 1;\n").replace("/* 모듈 */ export", "export")
  );
});

test("빌더 출력: 틀에 주석이 있어도 나가는 장에는 없다(예산대·자치구·거래유형·금리)", async () => {
  const [realestateTemplate, ratesTemplate, rates, realestate] = await Promise.all([
    read(TEMPLATE),
    read("scripts/rates-template.html"),
    read("docs/data/rates.json").then(JSON.parse),
    read("docs/data/realestate.json").then(JSON.parse),
  ]);
  const budget = {
    updatedAt: "2026-08-17T00:00:00.000Z",
    periods: ["202608"],
    bands: mergeBands({
      "202608": buildBands([{ district: "노원구", dong: "하계동", apt: "극동아파트", area: 55.72, floor: 7, amount10k: 85_000, date: "2026-08-14", buildYear: 1988 }]),
    }),
  };
  const outputs = {
    "예산대": buildBudgetPage(realestateTemplate, BUDGET_PAGES.find((p) => p.eok === 8), budget),
    "자치구": buildDistrictPage(realestateTemplate, DISTRICT_PAGES[0], realestate),
    "거래유형": buildRealestatePage(realestateTemplate, REALESTATE_PAGES[0], realestate),
    "금리": buildRatePage(ratesTemplate, RATE_PAGES[0], rates),
  };
  for (const [name, html] of Object.entries(outputs)) {
    assert.ok(html, `${name}: 장이 안 찍혔다`);
    assert.deepEqual(commentLines(html), [], `${name} 장에 주석이 남았다`);
    assert.equal(findJsComments(jsInlineScripts(html)[0].body).length, 0, name);
  }
  // 대조군: 이 시험이 빈손으로 통과하지 않는다 - 틀 자체에는 주석이 있다.
  assert.ok(commentLines(realestateTemplate).length > 20, "시세 틀에 주석이 없다면 이 시험은 아무것도 안 본 것이다");
  assert.ok(commentLines(ratesTemplate).length > 5, "금리 틀에 주석이 없다면 이 시험은 아무것도 안 본 것이다");
});

test("뉴스 장: 틀(news.html)에 주석이 생겨도 찍은 세 장에는 안 실린다", async () => {
  const base = await read("docs/news.html");
  const marked = base.replace("<script>\n", "<script>\n// 시험이 끼운 주석 - 찍힌 장에는 없어야 한다\n");
  assert.notEqual(marked, base, "news.html 의 인라인 <script> 시작을 못 찾았다");
  const page = NEWS_PAGES[0];
  const html = buildNewsPage(marked, page, { news: await read("docs/data/news.json").then(JSON.parse), summary: await read("docs/data/summary.json").then(JSON.parse) });
  assert.ok(!html.includes("시험이 끼운 주석"));
  assert.ok(html.includes("<script>\nconst") || html.includes("<script>\n"), "스크립트 자체는 남았다");
});

test("주석만 바뀌었다 - 기계 증명: 주석을 가진 모든 스크립트(틀 둘 + 손으로 쓴 장 전부)", async () => {
  // 굽는 장의 "전"은 틀이다(빌더가 틀에 문자열 패치를 한 뒤 훑개를 돌린다) - 그래서 입력은 틀 둘과, 틀이 아닌 docs 안 원본 전부다.
  // docs/realestate.html 은 이제 구운 장이라 주석이 0이다(고정점). 그 장의 "전"은 시세 틀이다 - 틀과 견준 증명은 아래 #374 시험이 선다.
  // 이미 구워진 장(주석 0)은 위 전수 시험이 고정점으로 본다. 기준 main 의 구운 장 50장과 견준 결과는 PR 본문에 있다.
  const names = (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html")).sort();
  const files = [...names.map((f) => `docs/${f}`), TEMPLATE, "scripts/rates-template.html"];
  assert.ok(names.length >= 67);
  let removedTotal = 0;
  let pagesWithComments = 0;
  const failures = [];
  for (const rel of files) {
    const before = await read(rel);
    const after = stripInlineScriptComments(before);
    const proof = proveHtmlCommentsOnly(before, after);
    if (!proof.ok) failures.push(`${rel}: ${proof.why}`);
    removedTotal += proof.removed;
    if (after !== before) pagesWithComments += 1;
  }
  assert.deepEqual(failures, []);
  assert.ok(pagesWithComments >= 14 && removedTotal > 150, `증명이 빈손이다(${pagesWithComments}장 ${removedTotal}개)`);
});

test("증명기는 주석 말고 바뀐 것을 잡는다(변이)", () => {
  const before = [
    "const T = {",
    "  // 주석",
    '  title: "서울 아파트 시세",',
    '  url: "https://a.b/c//d",',
    "};",
    "const n = (a, b) => a + b;",
    "",
  ].join("\n");
  const good = stripJsComments(before);
  assert.ok(proveCommentsOnly(before, good).ok, "정상 제거는 통과");
  assert.equal(proveCommentsOnly(before, good).removed, 1);
  const mutants = {
    "식별자": good.replace("const n =", "const m ="),
    "문자열 글자": good.replace("서울 아파트", "서울 아파티"),
    "문자열 속 공백(주석 없이 공백만)": good.replace("서울 아파트", "서울아파트"),
    "끝 쉼표": good.replace('c//d",', 'c//d"'),
    "따옴표": good.replace('"https://a.b/c//d"', "'https://a.b/c//d'"),
    "세미콜론": good.replace("a + b;", "a + b"),
    "문자열 속 //": good.replace("c//d", "c/d"),
    "숫자": good.replace("(a, b) =>", "(a, b, c) =>"),
    "주석 말고 한 글자 더 지움": good.replace("const n", "cons n"),
    "코드 한 줄 통째로": good.replace("const n = (a, b) => a + b;\n", ""),
  };
  for (const [name, bad] of Object.entries(mutants)) {
    assert.notEqual(bad, good, `${name}: 변이가 안 걸렸다`);
    assert.equal(proveCommentsOnly(before, bad).ok, false, `${name}: 증명기가 통과시켰다`);
  }
  // 글자 눈이 따로 일하는 것: 구문 트리는 같지만(끝 쉼표) 글자 눈이 잡는다.
  assert.ok(sameSyntax(before, good.replace('c//d",', 'c//d"')), "끝 쉼표는 구문 트리가 못 본다");
  assert.equal(onlyWhitespaceAndCommentsRemoved(before, good.replace('c//d",', 'c//d"')).ok, false);
});

test("틀은 주석을 그대로 갖는다(소스가 단일 출처다) - 구운 장만 주석이 없다", async () => {
  for (const rel of [TEMPLATE, "scripts/rates-template.html"]) {
    const html = await read(rel);
    assert.ok(findJsComments(jsInlineScripts(html)[0].body).length > 5, `${rel}: 틀에서 주석을 지우면 "왜"가 사라진다 - 지우는 곳은 굽는 단계다`);
  }
});

test("범위 밖을 숫자로 고정한다: 손으로 쓴 제자리 장은 주석을 그대로 싣는다", async () => {
  // 이 장들은 틀에서 찍는 장이 아니라 docs 안의 원본이다(prerender.ts 가 제자리에서 채운다). 굽는 단계에서 떼면 원본이 지워진다.
  // 이 목록이 줄면 좋은 일이다(원본을 docs 밖으로 옮겼다는 뜻) - 그때 이 시험의 숫자를 줄인다. #374 가 realestate.html 을 뺐다(13 -> 12).
  const names = (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html"));
  const rest = names.filter((f) => !BAKED.includes(f)).sort();
  const withComments = [];
  for (const f of rest) {
    const html = await read(`docs/${f}`);
    if (jsInlineScripts(html).some((s) => findJsComments(s.body).length)) withComments.push(f);
  }
  assert.deepEqual(
    withComments,
    ["about.html", "cancelled-deals.html", "deal-search.html", "floor-gap.html", "index.html", "jeonse-vs-wolse.html", "method.html", "price-outlook.html", "rates.html", "record-high.html", "renewal-vs-new.html", "switch-house.html"],
    "범위 밖 장의 목록이 바뀌었다 - 틀에서 찍는 장이 늘었거나 줄었다면 BAKED 와 이 목록을 같이 고친다"
  );
});

// ---- #374: 시세 틀을 docs/ 밖으로 옮긴다 -------------------------------------------------------------------------------------
// 읽는 쪽이 둘로 갈린다. 틀을 읽는 쪽(prerender.ts · build-realestate-pages · build-budget-pages · 빌더를 부르는 시험)은 빈 <!--prerender:…--> 표지가
// 있는 scripts/realestate-template.html 을, 나가는 장을 보는 쪽(화면 스크립트를 돌리는 시험 · 마크업을 보는 시험)은 docs/realestate.html 을 읽는다.
// 둘을 섞으면 시험이 조용히 다른 파일을 본다 - 아래 셋이 그 경계를 못박는다.

const MARKERS = ["realestateOverall", "realestateHead", "realestateTable"];
const markerBody = (html, name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];

test("시세 틀은 docs 밖에 있고 표지가 비어 있다 - 틀 읽는 쪽 셋은 틀을, 나가는 장은 채워진 것을 본다 (#374)", async () => {
  await access(path.join(root, TEMPLATE));
  await assert.rejects(access(path.join(root, "docs/realestate-template.html")), "틀이 docs 안에 또 있다");

  const template = await read(TEMPLATE);
  const baked = await read("docs/realestate.html");
  for (const name of MARKERS) {
    assert.equal(markerBody(template, name), "", `틀의 ${name} 표지가 비어 있지 않다 - 빌더가 채워진 장을 틀로 물려받는다`);
    assert.ok(markerBody(baked, name)?.length > 0, `나가는 장의 ${name} 표지가 비었다 - prerender.ts 가 틀을 채우지 못했다`);
  }
  assert.match(template, /<div class="updated" id="updated"><\/div>/, "틀에 찍힌 기준일이 남아 있다 - 날마다 틀이 바뀐다");
  assert.match(baked, /<div class="updated" id="updated" data-updated="\d{4}-\d{2}-\d{2}">/, "나가는 장에 기준일이 안 찍혔다");

  // 읽는 쪽 셋: 틀 경로는 prerender.ts 가 하나만 내보내고, 두 빌더는 그 값을 읽는다. 나가는 장의 경로 글자를 입력으로 쓰지 않는다.
  assert.equal(REALESTATE_TEMPLATE_PATH, path.join(root, TEMPLATE));
  for (const rel of ["scripts/build-realestate-pages.ts", "scripts/build-budget-pages.ts"]) {
    const src = await read(rel);
    assert.match(src, /REALESTATE_TEMPLATE_PATH/, `${rel}: 틀 경로를 읽지 않는다`);
    assert.doesNotMatch(src, /["'`]docs\/realestate\.html["'`]/, `${rel}: 나가는 장(docs/realestate.html)을 틀로 읽는다`);
  }
  const prerender = await read("scripts/prerender.ts");
  assert.equal(prerender.match(/["'`]docs\/realestate\.html["'`]/g).length, 2, "prerender.ts 에서 나가는 장의 경로는 출력 경로와 항목 이름 두 곳뿐이다");
});

test("시세 틀에는 #312 판정 §6 이 뺀 주석 다섯 줄이 있고 나가는 장에는 한 줄도 없다 (#374)", async () => {
  const FIVE = [
    "// 구운 예산 본문. 예산 데이터가 오기 전에도 이것이 화면이다(#293) - 안내를 끼워 다시 건다(#297).",
    '// 구운 한국어 문단 앞에 "한국어로만 있다"를 먼저 알린다(PO 2차 #41). 받는 중·실패에도 붙는다(#297).',
    "// 지금 쓸 본문(구운 것 또는 renderBudget이 갈아 끼운 것). 화면에 거는 곳은 여기 하나다.",
    "  // 안내 둘은 거래 목록이 보이는 한 늘 같이 있어야 한다 - 첫 실행에서 붙인다(#297).",
    "  // 예산 기간을 모르면 구운 기준일 줄을 그대로 둔다 - 그 창을 적어 본문과 어긋났다(#297).",
  ];
  const template = (await read(TEMPLATE)).split("\n");
  const baked = await read("docs/realestate.html");
  for (const line of FIVE) {
    assert.equal(template.filter((l) => l === line).length, 1, `틀에 한 번 있어야 한다: ${line.trim()}`);
    assert.ok(!baked.includes(line.trim()), `나가는 장에 실렸다: ${line.trim()}`);
  }
  // 주석은 자기가 설명하는 줄 바로 위에 선다(자리가 어긋나면 "왜"가 엉뚱한 줄을 설명한다).
  const next = (line) => template[template.indexOf(line) + 1];
  assert.match(next(FIVE[0]), /^const bakedBudgetResult = /);
  assert.match(next(FIVE[1]), /^function withKoOnly\(html\) \{/);
  assert.match(next(FIVE[2]), /^let budgetResultHtml = bakedBudgetResult;/);
  assert.match(next(FIVE[3]), /^ {2}document\.getElementById\("budget-note"\)\.textContent = t\("budgetNote"\);/);
  assert.match(next(FIVE[4]), /^ {2}if \(isBudgetPage\) \{/);
});

// (#507) "나가는 docs/realestate.html 은 틀을 채우고 훑개를 건 것뿐이다 - 스크립트는 주석만, 마크업은 표지 안과 기준일만 다르다 (#374)" 는 커밋된 데이터와 커밋된 생성물을 맞대는 검사라 tools/health/test/inline-comments.test.mjs 로 옮겼다(비차단). 같은 단언의 고정 데이터 짝은 test/fixture-site.test.mjs 에 있다.
