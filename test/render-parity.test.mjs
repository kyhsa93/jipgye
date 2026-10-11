import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as prerender from "../scripts/prerender.mjs";
import { INDEX_NEWS, indexNewsItems } from "../scripts/news-items.mjs";
import { escapeHtml } from "../scripts/html-escape.mjs";
import { linksBlockHtml, linksBlockShape, slugLinkEntries, slugLinkHref, slugLinksHtml } from "../scripts/district-links.mjs";
import { DISTRICT_PAGES } from "../scripts/district-slugs.mjs";
import { CONVERSION_BAND, cancelDistricts, cancelMonths, conversionTable, count, floorDistricts, pct, renewalDistricts, renewalWolseDistricts, signed } from "../scripts/district-tables.mjs";
import { MAX_DISTRICTS, changeOf, countOf, man, metricCell, topDistricts } from "../scripts/realestate-rows.mjs";
import { MIN_SAMPLE, hasEnoughSample } from "../scripts/realestate-format.mjs";
import { RE_LABELS, headLabels, reAllCells, reCells, reChange, reCount, reCountSpan, reDistrictLink, reDistrictRows, reEok, reHeadLabels, reLowSample, reMan, reRow, reSorted, reStaleTag, reWolseChange, realestateTable } from "../scripts/realestate-table.mjs";
import { makeFragment, rendererMode } from "../scripts/renderer.mjs";
import { createReactRenderer } from "../scripts/render/react.mjs";
import { RATES_BRANCHES } from "./fixtures/render/rates-branches.mjs";
import { JAVASCRIPT_URL_DIFF, NEWS_MARKET_BRANCHES } from "./fixtures/render/news-market-branches.mjs";
import { LEAD_LINKS_BRANCHES, LEAD_LINKS_FNS } from "./fixtures/render/lead-links-branches.mjs";
import { RAW_COUNT_DIFF, REALESTATE_BRANCHES } from "./fixtures/render/realestate-branches.mjs";
import { DISTRICT_TABLES_BRANCHES, DISTRICT_TABLES_FNS, DISTRICT_TABLES_THROWS, RAW_TEXT_DIFF } from "./fixtures/render/district-tables-branches.mjs";
import { REALESTATE_TABLE_BRANCHES, REALESTATE_TABLE_FNS, REALESTATE_TABLE_THROWS } from "./fixtures/render/realestate-table-branches.mjs";

// #237: 렌더러 스위치와 legacy↔react parity 시험의 골격. #240이 금리 조각(ratesHtml·ratesHeadHtml)의 분기별 케이스를 더했고
// #241 PR 1이 문장·목록 8개(summaryHtml·marketHtml·뉴스 6개)를, PR 2가 리드·링크 10개(*LeadHtml 6·*DistrictLinksHtml 4)를,
// PR 3이 첫 화면 실거래 요약(realestateHtml)을, #242 PR 1이 자치구 문장·링크 4개와 표 6개를, PR 2가 시세표 머리글·표(realestateHeadHtml·realestateTableHtml)를 더했다. #242 PR 3과 #243이 이어서 더한다.
// 입력은 이 파일 안의 값과 test/fixtures/render/의 고정 파일뿐이다(R3): 저장소의 docs/·docs/data는 읽지 않는다.

const root = path.resolve(import.meta.dirname, "..");
const fixture = (name) => path.join(root, "test/fixtures/render", name);
const tmpDirs = [];
after(() => Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))));

test("JIPGYE_RENDERER: 미설정·빈 문자열은 legacy, legacy·react만 받고 나머지는 멈춘다", () => {
  assert.equal(rendererMode({}), "legacy");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "" }), "legacy");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "legacy" }), "legacy");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "react" }), "react");
  for (const bad of ["React", "jsx", " react", "1"]) {
    assert.throws(() => rendererMode({ JIPGYE_RENDERER: bad }), /JIPGYE_RENDERER를 읽을 수 없습니다/, bad);
  }
});

test("prerender.mjs의 *Html() 조각은 전부 래퍼를 거치고 이름이 그대로다", () => {
  const names = Object.keys(prerender).filter((k) => k.endsWith("Html") && k !== "escapeHtml");
  assert.ok(names.length >= 40, `조각 함수를 ${names.length}개밖에 못 찾았다`);
  for (const name of names) {
    assert.equal(typeof prerender[name].legacy, "function", `${name}에 legacy 원본이 없다`);
    assert.equal(prerender[name].name, name);
  }
  // 순수 도구(escapeHtml)는 래퍼 밖이다 - 모든 조각이 쓰는 한 글자 단위 함수라서다.
  assert.equal(prerender.escapeHtml.legacy, undefined);
});

test("기본값(legacy): 래퍼의 출력이 legacy 원본과 같다", () => {
  const summary = { highlights: [{ title: "제목", textKo: "본문" }], categories: [{ name: "분야", lineKo: "한 줄" }] };
  assert.equal(prerender.summaryHtml(summary), prerender.summaryHtml.legacy(summary));
  assert.equal(prerender.summaryHtml(null), null);
  assert.equal(prerender.marketHtml(null), null);
});

test("래퍼: 이식된 조각만 React로 그리고 나머지는 legacy에 맡긴다", async () => {
  const renderer = await createReactRenderer({ entry: fixture("fragments.jsx") });
  const fragment = makeFragment(renderer);
  const calls = [];
  const summary = fragment("summaryHtml", (s) => (calls.push("legacy-summary"), prerender.summaryHtml.legacy(s)));
  const rates = fragment("ratesHtml", (r) => (calls.push("legacy-rates"), `legacy:${r}`)); // 이식 목록에 없다
  assert.equal(rates("x"), "legacy:x");
  assert.deepEqual(calls, ["legacy-rates"]);
  assert.equal(summary({ highlights: [{ title: "a", textKo: "b" }] }), "<p><strong>a</strong> b</p>");
  assert.deepEqual(calls, ["legacy-rates"], "이식된 조각을 그리면서 legacy를 부르면 안 된다");
  assert.equal(summary.name, "summaryHtml");
  assert.equal(typeof summary.legacy, "function");
});

test("래퍼: react 조각이 던지면 legacy로 넘기지 않고 그대로 던진다(폴백은 #238)", async () => {
  const fragment = makeFragment(await createReactRenderer({ entry: fixture("fragments.jsx") }));
  let legacyCalled = false;
  const news = fragment("newsHtml", () => ((legacyCalled = true), "legacy"));
  assert.throws(() => news({}), /의도한 조각 실패/);
  assert.equal(legacyCalled, false);
});

test("parity 골격: 같은 입력에서 legacy와 React 쌍둥이의 출력이 바이트까지 같다(summaryHtml fixture 쌍둥이)", async () => {
  const fragment = makeFragment(await createReactRenderer({ entry: fixture("fragments.jsx") }));
  const react = fragment("summaryHtml", prerender.summaryHtml.legacy);
  const inputs = [
    null,
    {},
    { highlights: [], categories: [] },
    { highlights: [{ title: "제목", textKo: "본문" }] },
    { categories: [{ name: "분야", lineKo: "한 줄" }] },
    { highlights: [{ title: "a", textKo: "b" }], categories: [{ name: "c", lineKo: "d" }] },
    // 특수문자: React가 `'`만 다르게(&#x27;) 내므로 래퍼의 치환 한 줄이 맞춰야 한다. & < > "는 양쪽이 같다.
    { highlights: [{ title: `it's <b> & "q"`, textKo: "don't & <i>" }], categories: [{ name: `a'b`, lineKo: `c'd` }] },
    // textKo가 비면 legacy는 그 항목을 거른다.
    { highlights: [{ title: "빠짐", textKo: "" }, { title: "남음", textKo: "x" }] },
  ];
  for (const input of inputs) {
    assert.equal(react(input), prerender.summaryHtml.legacy(input), JSON.stringify(input));
  }
});

// 기본값 legacy가 로더를 만지지 않는다는 것, react 모드의 실패가 삼켜지지 않는다는 것을 한 번에 본다:
// node_modules가 없는 scripts/ 복사본에서는 esbuild·react를 읽을 수 없다. legacy는 그래도 import가 되고, react는 import에서 던진다.
async function importIn(dir, env) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", 'const r = await import("./scripts/renderer.mjs"); await import("./scripts/prerender.mjs"); console.log(JSON.stringify({ mode: r.RENDERER, ported: r.portedFragments() }));'],
    { cwd: dir, encoding: "utf8", env: { ...process.env, JIPGYE_RENDERER: "", ...env } }
  );
}

test("기본값 legacy는 esbuild·react 없이도 import되고, react 모드는 로더가 못 뜨면 import에서 던진다", async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "jipgye-nomods-")));
  tmpDirs.push(dir);
  await cp(path.join(root, "scripts"), path.join(dir, "scripts"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}');

  const legacy = await importIn(dir, {});
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.deepEqual(JSON.parse(legacy.stdout), { mode: "legacy", ported: [] });
  const explicit = await importIn(dir, { JIPGYE_RENDERER: "legacy" });
  assert.equal(explicit.status, 0, explicit.stderr);

  const react = await importIn(dir, { JIPGYE_RENDERER: "react" });
  assert.notEqual(react.status, 0, "로더를 못 띄웠는데 react 모드가 조용히 지나갔다");
  assert.match(react.stderr, /Cannot find (package|module) '(react-dom|esbuild|react)/);

  const bad = await importIn(dir, { JIPGYE_RENDERER: "bogus" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /JIPGYE_RENDERER를 읽을 수 없습니다/);
});

// 저장소의 진입 파일(scripts/render/entry.jsx)에 이식된 조각. 조각을 이식할 때마다 이 목록과 분기 표(아래)를 같이 늘린다.
// 이름 순(renderer.names()가 정렬해 준다).
const PORTED = [
  "cancelDistrictLinksHtml",
  "cancelDistrictsHtml",
  "cancelLeadHtml",
  "cancelMonthLeadHtml",
  "cancelMonthsHtml",
  "conversionDistrictLinksHtml",
  "conversionLeadHtml",
  "conversionTableHtml",
  "districtFactsHtml",
  "districtLinksHtml",
  "districtRenewalHtml",
  "districtSummaryHtml",
  "floorDistrictLinksHtml",
  "floorDistrictsHtml",
  "marketHtml",
  "newsContextHtml",
  "newsHtml",
  "newsKospiHtml",
  "newsListHtml",
  "newsRealestateStatsHtml",
  "newsSummaryHtml",
  "ratesHeadHtml",
  "ratesHtml",
  "realestateHeadHtml",
  "realestateHtml",
  "realestateTableHtml",
  "renewalCapLeadHtml",
  "renewalDistrictLinksHtml",
  "renewalDistrictsHtml",
  "renewalLeadHtml",
  "renewalWolseDistrictsHtml",
  "renewalWolseLeadHtml",
  "summaryHtml",
];
const NEWS_MARKET_FNS = ["marketHtml", "newsContextHtml", "newsHtml", "newsKospiHtml", "newsListHtml", "newsRealestateStatsHtml", "newsSummaryHtml", "summaryHtml"];

test("react 모드: 이식된 조각 목록이 PORTED와 같고, 그 이름은 전부 .legacy를 가진 prerender.mjs 조각이다(오타·없는 조각을 막는다)", async () => {
  const renderer = await createReactRenderer();
  assert.deepEqual(renderer.names(), PORTED);
  for (const name of renderer.names()) {
    assert.equal(typeof prerender[name]?.legacy, "function", `entry.jsx의 ${name}은 prerender.mjs의 *Html() 조각이 아니다`);
    assert.equal(prerender[name].name, name);
  }
});

// ---- 금리 조각(#240): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const productNames = (html) => [...html.matchAll(/class="product-name">([^<]*)</g)].map((m) => m[1]);

test("금리 분기 표: id가 겹치지 않고, 두 조각을 모두 덮는다", () => {
  const ids = RATES_BRANCHES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual([...new Set(RATES_BRANCHES.map((b) => b.fn))].sort(), ["ratesHeadHtml", "ratesHtml"]);
  for (const b of RATES_BRANCHES) {
    assert.ok("expect" in b || b.order, `${b.id}: 기대값(expect 또는 order)이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
});

test("금리 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다)", () => {
  for (const b of RATES_BRANCHES) {
    const out = prerender[b.fn].legacy(...b.args);
    if ("expect" in b) assert.equal(out, b.expect, `${b.id} ${b.cond}`);
    else assert.deepEqual(productNames(out), b.order, `${b.id} ${b.cond}`);
  }
});

test("금리 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of RATES_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    assert.equal(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("금리 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(null은 null, 빈 문자열은 빈 문자열 그대로)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const rates = fragment("ratesHtml", () => (called++, "legacy"));
  assert.equal(rates(null), null);
  assert.equal(rates({ deposit: [{ name: "a", options: [{ term: 12, rate: 1, maxRate: 2, rateTypeName: "단리" }] }] }, { limit: 0 }), "");
  assert.equal(called, 0);
});

test("react 모드(진입 목록 PORTED): 이식 안 된 조각은 legacy에 위임되어 같고, 이식된 조각은 분기 표 전부에서 legacy와 같다", async () => {
  const ratesUrl = pathToFileURL(fixture("rates-branches.mjs")).href;
  const newsUrl = pathToFileURL(fixture("news-market-branches.mjs")).href;
  const leadUrl = pathToFileURL(fixture("lead-links-branches.mjs")).href;
  const realestateUrl = pathToFileURL(fixture("realestate-branches.mjs")).href;
  const districtUrl = pathToFileURL(fixture("district-tables-branches.mjs")).href;
  const tableUrl = pathToFileURL(fixture("realestate-table-branches.mjs")).href;
  const run = (env) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const r = await import("./scripts/renderer.mjs"); const p = await import("./scripts/prerender.mjs");
         const { RATES_BRANCHES } = await import(${JSON.stringify(ratesUrl)});
         const { NEWS_MARKET_BRANCHES } = await import(${JSON.stringify(newsUrl)});
         const { LEAD_LINKS_BRANCHES } = await import(${JSON.stringify(leadUrl)});
         const { REALESTATE_BRANCHES } = await import(${JSON.stringify(realestateUrl)});
         const { DISTRICT_TABLES_BRANCHES } = await import(${JSON.stringify(districtUrl)});
         const { REALESTATE_TABLE_BRANCHES } = await import(${JSON.stringify(tableUrl)});
         const run = (rows) => rows.map((b) => [b.id, p[b.fn](...b.args)]);
         // 이식 안 된 조각(아직 legacy): 예산 최소 현금 문장·예산 단지 후보(둘 다 #243이 이식한다 - 오래 미이식으로 남는 budget* 조각).
         // 이식되면 이 줄의 조각을 다른 미이식 조각으로 바꾼다(districtLinksHtml은 #242 PR 1이 이식해 budgetCandidatesHtml로 바꿨다).
         const legacyOnly = [p.budgetMinCashHtml({ min10k: 50000 }), p.budgetCandidatesHtml({ min10k: 50000 }, [{ reference: "202609" }])];
         console.log(JSON.stringify({ mode: r.RENDERER, ported: r.portedFragments(), legacyOnly, rates: run(RATES_BRANCHES), news: run(NEWS_MARKET_BRANCHES), leadLinks: run(LEAD_LINKS_BRANCHES), realestate: run(REALESTATE_BRANCHES), districtTables: run(DISTRICT_TABLES_BRANCHES), realestateTable: run(REALESTATE_TABLE_BRANCHES) }));`,
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env, JIPGYE_RENDERER: "", ...env } }
    );
  const legacy = run({});
  const react = run({ JIPGYE_RENDERER: "react" });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(react.status, 0, react.stderr);
  assert.equal(react.stderr, "", "react 모드 렌더가 경고를 냈다(DOM 중첩·key 등)");
  const [a, b] = [JSON.parse(legacy.stdout), JSON.parse(react.stdout)];
  assert.equal(a.mode, "legacy");
  assert.equal(b.mode, "react");
  assert.deepEqual(a.ported, []);
  assert.deepEqual(b.ported, PORTED);
  assert.ok(a.legacyOnly.every((html) => html.length > 0), "이식 안 된 조각 입력이 빈 출력이면 이 확인이 아무것도 안 본다");
  assert.deepEqual(b.legacyOnly, a.legacyOnly, "이식 안 된 조각은 legacy 그대로");
  assert.equal(b.rates.length, RATES_BRANCHES.length);
  assert.equal(b.news.length, NEWS_MARKET_BRANCHES.length);
  assert.deepEqual(b.rates, a.rates, "react 모드의 prerender.mjs 조각 출력이 legacy 모드와 다르다(금리)");
  assert.deepEqual(b.news, a.news, "react 모드의 prerender.mjs 조각 출력이 legacy 모드와 다르다(문장·목록)");
  assert.equal(b.leadLinks.length, LEAD_LINKS_BRANCHES.length);
  assert.deepEqual(b.leadLinks, a.leadLinks, "react 모드의 prerender.mjs 조각 출력이 legacy 모드와 다르다(리드·링크)");
  assert.equal(b.realestate.length, REALESTATE_BRANCHES.length);
  assert.deepEqual(b.realestate, a.realestate, "react 모드의 prerender.mjs 조각 출력이 legacy 모드와 다르다(실거래 요약)");
  assert.equal(b.districtTables.length, DISTRICT_TABLES_BRANCHES.length);
  assert.deepEqual(b.districtTables, a.districtTables, "react 모드의 prerender.mjs 조각 출력이 legacy 모드와 다르다(자치구 문장·링크·표)");
  assert.equal(b.realestateTable.length, REALESTATE_TABLE_BRANCHES.length);
  assert.deepEqual(b.realestateTable, a.realestateTable, "react 모드의 prerender.mjs 조각 출력이 legacy 모드와 다르다(시세표 머리글·표)");
});

// ---- 문장·목록 8개 조각(#241 PR 1): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const newsTitles = (html) => [...html.matchAll(/target="_blank" rel="noopener">([^<]*)</g)].map((m) => m[1]);

test("문장·목록 분기 표: id가 겹치지 않고, 여덟 조각을 모두 덮고, 모든 행에 기대값이 있다", () => {
  const ids = NEWS_MARKET_BRANCHES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual([...new Set(NEWS_MARKET_BRANCHES.map((b) => b.fn))].sort(), NEWS_MARKET_FNS);
  for (const b of NEWS_MARKET_BRANCHES) {
    assert.ok("expect" in b || b.order, `${b.id}: 기대값(expect 또는 order)이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  // 값 종류별 행이 조각마다 있다: 비문자열(false·{})·null·특수문자(&amp;)·빈 값(데이터 없음 null 또는 빈 문자열).
  for (const fn of NEWS_MARKET_FNS) {
    const outs = NEWS_MARKET_BRANCHES.filter((b) => b.fn === fn).map((b) => (typeof b.expect === "string" ? b.expect : ""));
    assert.ok(outs.some((o) => o.includes("&amp;") && o.includes("&lt;") && o.includes("&quot;")), `${fn}: 특수문자 행이 없다`);
    if (fn !== "marketHtml") assert.ok(outs.some((o) => /false|\[object Object\]/.test(o)), `${fn}: 비문자열(false·{}) 행이 없다`);
  }
});

test("문장·목록 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다)", () => {
  for (const b of NEWS_MARKET_BRANCHES) {
    const out = prerender[b.fn].legacy(...b.args);
    if ("expect" in b) assert.equal(out, b.expect, `${b.id} ${b.cond}`);
    else assert.deepEqual(newsTitles(out), b.order, `${b.id} ${b.cond}`);
    if (b.noMore) assert.ok(!out.includes("news-more"), `${b.id}: '더 보기' 줄이 있다`);
    if (b.more) assert.ok(out.includes(`뉴스 전체 ${b.more}건 보기 →`), `${b.id}: '뉴스 전체 ${b.more}건' 줄이 없다`);
    if (b.noPreview) assert.ok(!out.includes("news-preview"), `${b.id}: 미리보기가 있다`);
  }
});

test("문장·목록 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of NEWS_MARKET_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    assert.equal(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("문장·목록 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(null은 null, 빈 문자열은 빈 문자열 그대로)", async () => {
  let called = 0;
  const renderer = await createReactRenderer();
  const fragment = makeFragment(renderer);
  const spy = () => (called++, "legacy");
  assert.equal(fragment("summaryHtml", spy)(null), null);
  assert.equal(fragment("marketHtml", spy)({}), null);
  assert.equal(fragment("newsHtml", spy)({ items: [] }), null);
  assert.equal(fragment("newsListHtml", spy)(null), null);
  assert.equal(fragment("newsKospiHtml", spy)({}), null);
  assert.equal(fragment("newsRealestateStatsHtml", spy)({}), null);
  assert.equal(fragment("newsSummaryHtml", spy)({}), null);
  // 맥락 칩이 없으면 legacy는 null이 아니라 ""를 낸다 - 자리표시 치환이 null과 ""를 다르게 다루므로 그대로 지켜야 한다.
  assert.equal(fragment("newsContextHtml", spy)(undefined), "");
  assert.equal(fragment("newsContextHtml", spy)([]), "");
  assert.equal(called, 0);
});

test("문장·목록 조각: React 19는 javascript: URL을 막아 legacy와 달라진다(알려진 차이 — 실제 입력에는 나오지 않는다)", async () => {
  const { fn, args, legacy, react } = JAVASCRIPT_URL_DIFF;
  const fragment = makeFragment(await createReactRenderer());
  assert.equal(prerender[fn].legacy(...args), legacy);
  assert.equal(fragment(fn, prerender[fn].legacy)(...args), react);
});

test("news-items.mjs: legacy·JSX가 같이 쓰는 순수 모듈이고, prerender.mjs가 같은 함수를 다시 내보낸다", () => {
  assert.equal(INDEX_NEWS, 5);
  assert.equal(prerender.INDEX_NEWS, INDEX_NEWS);
  assert.equal(prerender.indexNewsItems, indexNewsItems);
  // 입력이 없으면 빈 목록(방어: 조각이 먼저 거르므로 조각 경로로는 닿지 않는다).
  assert.deepEqual(indexNewsItems(undefined), []);
  assert.deepEqual(indexNewsItems(null), []);
  const items = ["e0", "e1", "r0", "e2", "r1", "e3", "e4"].map((title) => ({ title, category: title[0] === "r" ? "realestate" : "economy" }));
  assert.deepEqual(indexNewsItems(items).map((i) => i.title), ["r0", "r1", "e0", "e1", "e2"]);
});

// ---- 리드·링크 10개 조각(#241 PR 2): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

test("리드·링크 분기 표: id가 겹치지 않고, 열 조각을 모두 덮고, 모든 행에 기대값이 있고, 조각마다 값 종류별 행이 있다", () => {
  const ids = LEAD_LINKS_BRANCHES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual([...new Set(LEAD_LINKS_BRANCHES.map((b) => b.fn))].sort(), LEAD_LINKS_FNS);
  assert.equal(LEAD_LINKS_FNS.length, 10);
  for (const b of LEAD_LINKS_BRANCHES) {
    assert.ok("expect" in b, `${b.id}: 기대값(expect)이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  // 조각마다: 데이터 없음(null 출력)·특수문자(&amp; &lt; &quot;)·비문자열(false·[object Object])·빈 값 행이 있다.
  for (const fn of LEAD_LINKS_FNS) {
    const rows = LEAD_LINKS_BRANCHES.filter((b) => b.fn === fn);
    const outs = rows.map((b) => b.expect);
    assert.ok(outs.includes(null), `${fn}: 데이터 없음(null) 행이 없다`);
    assert.ok(outs.some((o) => typeof o === "string" && o.includes("&amp;") && o.includes("&lt;") && o.includes("&quot;")), `${fn}: 특수문자 행이 없다`);
    assert.ok(outs.some((o) => typeof o === "string" && /\[object Object\]/.test(o)), `${fn}: 비문자열({}) 행이 없다`);
    assert.ok(outs.some((o) => o === "true" || (typeof o === "string" && o.includes("false"))), `${fn}: 비문자열(false·true) 행이 없다`);
    assert.ok(rows.some((b) => b.args[0] === null), `${fn}: null 입력 행이 없다`);
  }
  // 리드는 빈 배열(truthy)이 null이 아니라 빈 문자열을 내는 행이 있다(null과 ""는 자리표시 치환에서 다르다).
  for (const fn of LEAD_LINKS_FNS.filter((f) => f.endsWith("LeadHtml"))) {
    assert.ok(LEAD_LINKS_BRANCHES.some((b) => b.fn === fn && b.expect === ""), `${fn}: 빈 문자열을 내는 행이 없다`);
  }
});

test("리드·링크 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다)", () => {
  for (const b of LEAD_LINKS_BRANCHES) {
    assert.equal(prerender[b.fn].legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
  }
});

test("리드·링크 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of LEAD_LINKS_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    assert.equal(react, b.expect, `${b.id} ${b.cond}`);
    assert.equal(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("리드·링크 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(데이터 없음은 null, 빈 배열 글은 빈 문자열 그대로)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const spy = () => (called++, "legacy");
  for (const fn of LEAD_LINKS_FNS) {
    assert.equal(fragment(fn, spy)(null), null, fn);
    assert.equal(fragment(fn, spy)({}), null, fn);
  }
  assert.equal(fragment("renewalLeadHtml", spy)({ lead: { ko: [] } }), "");
  assert.equal(fragment("conversionLeadHtml", spy)({ seoul: { leadKo: [] } }), "");
  assert.equal(called, 0);
});

test("district-links.mjs: legacy·JSX가 같이 쓰는 순수 모듈이고, linksBlockHtml 추출 뒤에도 districtLinksHtml(legacy)의 글자가 그대로다", () => {
  // linksBlockHtml: 링크가 없으면 머리글도 없다(빈 문자열), 머리글은 이스케이프하고 id는 그대로.
  for (const none of ["", null, undefined, 0, false]) assert.equal(linksBlockHtml("x", "머리", none), "", String(none));
  assert.equal(
    linksBlockHtml("district-links", "다른 지역", "<a>1</a>"),
    '<h3 class="district-links-heading" id="district-links-heading">다른 지역</h3><div class="district-links" id="district-links"><a>1</a></div>'
  );
  assert.equal(linksBlockHtml("i", `a&<"'`, "L"), `<h3 class="district-links-heading" id="i-heading">a&amp;&lt;&quot;'</h3><div class="district-links" id="i">L</div>`);
  assert.equal(linksBlockHtml("i", false, "L"), '<h3 class="district-links-heading" id="i-heading">false</h3><div class="district-links" id="i">L</div>');
  assert.equal(linksBlockHtml("i", null, "L"), '<h3 class="district-links-heading" id="i-heading"></h3><div class="district-links" id="i">L</div>');
  assert.equal(linksBlockHtml("i", undefined, "L"), '<h3 class="district-links-heading" id="i-heading"></h3><div class="district-links" id="i">L</div>');
  // slug 항목·경로·묶음
  assert.deepEqual(slugLinkEntries(null), []);
  assert.deepEqual(slugLinkEntries(undefined), []);
  assert.deepEqual(slugLinkEntries({}), []);
  assert.deepEqual(slugLinkEntries({ slugs: null }), []);
  assert.deepEqual(slugLinkEntries({ slugs: { 종로구: "jongno" } }), [["종로구", "jongno"]]);
  assert.equal(slugLinkHref("jongno"), "./district-jongno.html");
  assert.equal(slugLinkHref(null), "./district-.html");
  assert.equal(slugLinkHref(undefined), "./district-.html");
  assert.equal(slugLinkHref(false), "./district-false.html");
  assert.equal(slugLinksHtml({}), null);
  assert.equal(slugLinksHtml({ slugs: { 종로구: "jongno" } }), '<a href="./district-jongno.html">종로구</a>');
  // districtLinksHtml(legacy): helper를 뽑은 뒤에도 글자가 같다(#242 PR 1이 JSX 쪽도 이 모듈로 이식했다).
  const all = prerender.districtLinksHtml.legacy();
  assert.ok(all.startsWith('<h3 class="district-links-heading" id="district-links-heading">다른 지역</h3><div class="district-links" id="district-links"><a href="./district-jongno.html">종로구</a><a href="./district-jung.html">중구</a>'));
  assert.ok(all.endsWith("</a></div>"));
  assert.equal(all.match(/<a /g).length, DISTRICT_PAGES.length);
  assert.ok(!all.includes("aria-current"));
  const here = prerender.districtLinksHtml.legacy("중구", "자치구별 시세 보기");
  assert.ok(here.startsWith('<h3 class="district-links-heading" id="district-links-heading">자치구별 시세 보기</h3>'));
  assert.ok(here.includes('<a href="./district-jung.html" aria-current="page">중구</a>'));
  assert.equal(here.match(/aria-current/g).length, 1);
  // escapeHtml: prerender.mjs가 같은 함수를 다시 내보내고(다른 모듈의 import 호환), 래퍼 밖의 순수 도구다.
  assert.equal(prerender.escapeHtml, escapeHtml);
  assert.equal(escapeHtml(`a&<>"'`), "a&amp;&lt;&gt;&quot;'");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(false), "false");
});

// ---- 첫 화면 실거래 요약 realestateHtml(#241 PR 3): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

test("실거래 요약 분기 표: id가 겹치지 않고, 모든 행에 기대값이 있고, 해자 2 분기(표본 부족)·\"-\"·증감 부호 셋·정렬·자름·비문자열 행이 있다", () => {
  const ids = REALESTATE_BRANCHES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  for (const b of REALESTATE_BRANCHES) {
    assert.equal(b.fn, "realestateHtml", b.id);
    assert.ok("expect" in b, `${b.id}: 기대값(expect)이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  const outs = REALESTATE_BRANCHES.map((b) => b.expect).filter((o) => typeof o === "string");
  const has = (re) => outs.some((o) => re.test(o));
  // DIRECTION 해자 2: 표본이 모자라면 값을 내지 않고 "표본 N건" 스팬(바이트 그대로)
  assert.ok(outs.some((o) => o.includes('<span class="low-sample" title="신고 4건이라 평균을 내기엔 표본이 부족합니다">표본 4건</span>')), "표본 부족 스팬 행이 없다");
  assert.ok(REALESTATE_BRANCHES.some((b) => b.expect === null && b.args[0] === null), "null 입력 행이 없다");
  assert.ok(REALESTATE_BRANCHES.some((b) => b.expect === null && b.args[0] === undefined), "undefined 입력 행이 없다");
  assert.ok(has(/>-<\/td><td data-label="전세">-<\/td><td data-label="월세">-<\/td>/), "빈 값(\"-\") 행이 없다");
  assert.ok(has(/class="change">\+/) && has(/class="change">-/) && has(/class="change">0만/), "증감 부호 셋(+·-·없음) 행이 없다");
  assert.ok(has(/월 NaN만원/) && has(/월 120만원/), "월세 칸 행이 없다");
  assert.ok(has(/<td>false<\/td>/) && has(/\[object Object\]/) && has(/<td>1,2<\/td>/) && has(/<td>0<\/td>/), "이름 비문자열 행(false·{}·[1,2]·0)이 없다");
  assert.ok(has(/A&amp;B &lt;i&gt; &quot;q&quot; it's/), "이름 특수문자 행이 없다");
  assert.ok(has(/표본 undefined건/) && has(/표본 null건/) && has(/표본 false건/) && has(/표본 \[object Object\]건/), "건수 비숫자 표본 부족 행이 없다");
  // 자름: 다섯째 이후가 나오지 않는 행의 <tr> 수는 서울 전체 + MAX_DISTRICTS
  const six = REALESTATE_BRANCHES.find((b) => b.id === "D-03");
  assert.equal(six.expect.match(/<tr>/g).length, 1 + MAX_DISTRICTS);
});

test("실거래 요약 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다)", () => {
  for (const b of REALESTATE_BRANCHES) {
    assert.equal(prerender.realestateHtml.legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
  }
});

test("실거래 요약 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  const react = fragment("realestateHtml", prerender.realestateHtml.legacy);
  for (const b of REALESTATE_BRANCHES) {
    const out = react(...b.args);
    assert.equal(out, b.expect, `${b.id} ${b.cond}`);
    assert.equal(out, prerender.realestateHtml.legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("실거래 요약 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(데이터 없음은 null)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const spy = () => (called++, "legacy");
  assert.equal(fragment("realestateHtml", spy)(null), null);
  assert.equal(fragment("realestateHtml", spy)({}), null);
  assert.equal(called, 0);
});

test("실거래 요약 조각: 표본 부족 칸의 건수가 문자열이면 legacy는 이스케이프 없이, React는 이스케이프해서 낸다(알려진 차이 — 실제 입력에는 나오지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const { id, count, legacy, react } of RAW_COUNT_DIFF) {
    const input = { overall: { sale: { avgPricePerPyeong10k: 5, transactionCount: count } } };
    const row = (cell) => `<tr><td>서울 전체</td><td data-label="매매">${cell}</td><td data-label="전세">-</td><td data-label="월세">-</td></tr>`;
    assert.equal(prerender.realestateHtml.legacy(input), row(legacy), id);
    assert.equal(fragment("realestateHtml", prerender.realestateHtml.legacy)(input), row(react), id);
  }
});

test("realestate-rows.mjs: legacy·JSX가 같이 쓰는 순수 모듈이고, 표본 문턱은 realestate-format.mjs의 하나만 쓴다", async () => {
  // 문턱은 하나다: prerender.mjs는 다시 내보낼 뿐이고(이 모듈에서 import하던 쪽의 호환), 값은 realestate-format.mjs의 것이다.
  assert.equal(MIN_SAMPLE, 5);
  assert.equal(prerender.MIN_SAMPLE, MIN_SAMPLE);
  const scripts = (await readdir(path.join(root, "scripts"))).filter((f) => f.endsWith(".mjs"));
  const definers = [];
  for (const f of scripts) {
    if (/^\s*(export\s+)?const\s+MIN_SAMPLE\s*=/m.test(await readFile(path.join(root, "scripts", f), "utf8"))) definers.push(f);
  }
  assert.deepEqual(definers, ["realestate-format.mjs"], "MIN_SAMPLE을 정의하는 파일이 둘 이상이다");
  assert.equal(MAX_DISTRICTS, 4);
  assert.equal(man(5530), "5,530만원");
  assert.equal(man("abc"), "NaN만원");
  assert.equal(hasEnoughSample({ transactionCount: 4 }), false);
  assert.equal(hasEnoughSample({ transactionCount: 5 }), true);
  // metricCell: 없음·표본 부족·값(건수는 그대로 들고 간다)
  assert.deepEqual(metricCell("sale", undefined), { type: "none" });
  assert.deepEqual(metricCell("sale", { avgPricePerPyeong10k: 9, transactionCount: 4 }), { type: "low", count: 4 });
  assert.deepEqual(metricCell("sale", { transactionCount: 9 }), { type: "none" });
  assert.deepEqual(metricCell("sale", { avgPricePerPyeong10k: 5530, transactionCount: 684, change: { value10k: -25 } }), { type: "value", text: "5,530만원", change: { sign: "-", text: "25만" }, count: "684건" });
  assert.deepEqual(metricCell("wolse", { avgDeposit10k: 5000, avgMonthlyRent10k: 100, transactionCount: 50, change: { value10k: 1 } }), { type: "value", text: "5,000만원 / 월 100만원", change: null, count: "50건" });
  assert.deepEqual(changeOf({ value10k: 7 }), { sign: "+", text: "7만" });
  assert.deepEqual(changeOf({ value10k: 0 }), { sign: "", text: "0만" });
  assert.equal(changeOf({ value10k: "7" }), null);
  assert.equal(changeOf(undefined), null);
  assert.equal(countOf({ transactionCount: 1234 }), "1,234건");
  assert.equal(countOf({ transactionCount: "1" }), null);
  assert.equal(countOf(undefined), null);
  // topDistricts: 높은 순·자름·값 없는 곳은 뒤(들어온 순서)
  const mk = (name, price, count = 10) => ({ name, sale: { avgPricePerPyeong10k: price, transactionCount: count } });
  assert.deepEqual(topDistricts({ districts: [mk("a", 1), mk("b", 5), mk("c", 3), mk("x", 99, 4), mk("d", 2), mk("e", 4)] }).map((d) => d.name), ["b", "e", "c", "d"]);
  assert.deepEqual(topDistricts({}), []);
  assert.deepEqual(topDistricts({ districts: null }), []);
  // 예순 곳으로 늘려도 같은 약속이다(V8의 정렬이 짧은 배열과 긴 배열에서 다른 알고리즘을 쓴다): 값이 있는 곳이 앞, 값이 없는 곳(표본 부족·평당가 없음)은 그 뒤에 들어온 순서.
  // 값 있는 곳 둘을 맨 뒤에 두고, 앞 마흔 곳을 값 없는 곳으로 채우면 위 네 곳은 [값 둘 + 값 없는 곳 첫 둘]이다(독립 계산: 정렬 함수를 쓰지 않는다).
  const many = [...Array.from({ length: 58 }, (_, i) => (i % 2 ? { name: `n${i}` } : mk(`l${i}`, 777, 4))), mk("v1", 100), mk("v2", 200)];
  assert.deepEqual(topDistricts({ districts: many }).map((d) => d.name), ["v2", "v1", "l0", "n1"]);
  // 입력 배열을 바꾸지 않는다
  const input = [mk("a", 1), mk("b", 5)];
  topDistricts({ districts: input });
  assert.deepEqual(input.map((d) => d.name), ["a", "b"]);
});

// ---- 자치구 문장·링크 4개와 표 6개(#242 PR 1): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const TABLE_FNS = ["cancelDistrictsHtml", "cancelMonthsHtml", "conversionTableHtml", "floorDistrictsHtml", "renewalDistrictsHtml", "renewalWolseDistrictsHtml"];

test("자치구 분기 표: id가 겹치지 않고, 열 조각을 모두 덮고, 모든 행에 기대값이 있다", () => {
  const ids = DISTRICT_TABLES_BRANCHES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual([...new Set(DISTRICT_TABLES_BRANCHES.map((b) => b.fn))].sort(), DISTRICT_TABLES_FNS);
  assert.equal(DISTRICT_TABLES_FNS.length, 10);
  for (const b of DISTRICT_TABLES_BRANCHES) {
    assert.ok("expect" in b, `${b.id}: 기대값(expect)이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  const toIds = new Set(DISTRICT_TABLES_THROWS.map((b) => b.id));
  assert.equal(toIds.size, DISTRICT_TABLES_THROWS.length, "던지는 입력 id가 겹친다");
  for (const b of DISTRICT_TABLES_THROWS) assert.ok(DISTRICT_TABLES_FNS.includes(b.fn), `${b.id}: 모르는 조각(${b.fn})`);
});

test("자치구 분기 표: 조각마다 데이터 없음(null 출력)·특수문자·비문자열·null·undefined·빈 값 행이 있다", () => {
  for (const fn of DISTRICT_TABLES_FNS) {
    const rows = DISTRICT_TABLES_BRANCHES.filter((b) => b.fn === fn);
    const outs = rows.map((b) => b.expect);
    const strings = outs.filter((o) => typeof o === "string");
    if (TABLE_FNS.includes(fn)) assert.ok(outs.includes(null), `${fn}: 데이터 없음(null) 행이 없다`);
    // 자치구 링크는 스물다섯 곳이 상수라 빈 출력이 없다(링크가 없는 분기는 linksBlockShape 시험이 닫는다)
    else if (fn !== "districtLinksHtml") assert.ok(strings.includes(""), `${fn}: 빈 문자열 행이 없다`);
    assert.ok(strings.some((o) => o.includes("&amp;") && o.includes("&lt;") && o.includes("&quot;")), `${fn}: 특수문자 행이 없다`);
    assert.ok(strings.some((o) => /false|true/.test(o)), `${fn}: 비문자열(false·true) 행이 없다`);
    assert.ok(strings.some((o) => /\[object Object\]/.test(o)), `${fn}: 비문자열({}) 행이 없다`);
    assert.ok(rows.some((b) => b.args[0] === null || b.args.length === 0), `${fn}: null 입력 행이 없다`);
    assert.ok(rows.some((b) => b.args[0] === undefined), `${fn}: undefined 입력 행이 없다`);
  }
});

test("자치구 분기 표: 해자 2(표본 부족) 행이 세 표에 있고, 표본 부족이 값 없음보다 먼저 판정되는 순서 행이 있다", () => {
  for (const fn of ["renewalDistrictsHtml", "renewalWolseDistrictsHtml", "floorDistrictsHtml"]) {
    const moat = DISTRICT_TABLES_BRANCHES.filter((b) => b.fn === fn && b.moat);
    assert.ok(moat.some((b) => b.expect.includes('<span class="low-sample">')), `${fn}: 표본 부족 스팬 행이 없다`);
    assert.ok(moat.some((b) => !b.expect.includes("low-sample") && !b.order), `${fn}: 표본 부족이 아닌 값 행이 없다`);
    assert.ok(DISTRICT_TABLES_BRANCHES.some((b) => b.fn === fn && b.order), `${fn}: 순서 행이 없다`);
  }
  // 순서 행의 모양: 같은 줄에 표본 부족 스팬과 값 없음 칸("-")이 함께 있다
  for (const id of ["RD-L02", "RW-L02", "FD-L03"]) {
    const row = DISTRICT_TABLES_BRANCHES.find((b) => b.id === id);
    assert.match(row.expect, /<span class="low-sample">[^<]+<\/span>/, id);
    assert.match(row.expect, /<td>-<\/td>/, id);
  }
  // 문장 쪽 표본 부족(이번 달 매매 신고가 N건뿐이라 평균을 내지 않았다)
  assert.ok(DISTRICT_TABLES_BRANCHES.some((b) => b.fn === "districtSummaryHtml" && /신고가 4건뿐이라 평균을 내지 않았습니다/.test(b.expect)));
});

test("자치구 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다)", () => {
  for (const b of DISTRICT_TABLES_BRANCHES) {
    assert.equal(prerender[b.fn].legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
  }
});

test("자치구 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of DISTRICT_TABLES_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    assert.equal(react, b.expect, `${b.id} ${b.cond}`);
    assert.equal(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("자치구 분기 표: 같은 입력을 두 번 넣어도 같고 입력을 바꾸지 않는다(정렬은 사본에)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of DISTRICT_TABLES_BRANCHES) {
    const before = JSON.stringify(b.args, (_, v) => (v === undefined ? "(undefined)" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
    const react = fragment(b.fn, prerender[b.fn].legacy);
    assert.equal(react(...b.args), react(...b.args), b.id);
    prerender[b.fn].legacy(...b.args);
    assert.equal(JSON.stringify(b.args, (_, v) => (v === undefined ? "(undefined)" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v)), before, `${b.id}: 입력이 바뀌었다`);
  }
});

test("자치구 조각: 숫자 칸에 null·undefined가 오면 legacy도 React 조각도 던진다(조용히 빈 칸을 내지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of DISTRICT_TABLES_THROWS) {
    assert.throws(() => prerender[b.fn].legacy(...b.args), TypeError, `${b.id} legacy ${b.cond}`);
    assert.throws(() => fragment(b.fn, prerender[b.fn].legacy)(...b.args), TypeError, `${b.id} react ${b.cond}`);
  }
});

test("자치구 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(데이터 없음은 null, 문장·링크는 빈 문자열 그대로)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const spy = () => (called++, "legacy");
  for (const fn of TABLE_FNS) {
    assert.equal(fragment(fn, spy)(null), null, fn);
    assert.equal(fragment(fn, spy)({}), null, fn);
  }
  // 문장은 말할 것이 없어도 null이 아니라 빈 문자열이다(자리표시 치환은 null과 ""를 다르게 다룬다)
  assert.equal(fragment("districtSummaryHtml", spy)(null, "종로구"), "");
  assert.equal(fragment("districtSummaryHtml", spy)({}, null), "");
  assert.equal(fragment("districtRenewalHtml", spy)(null), "");
  assert.equal(fragment("districtFactsHtml", spy)(undefined), "");
  assert.ok(fragment("districtLinksHtml", spy)().startsWith('<h3 class="district-links-heading"'));
  assert.equal(called, 0);
});

test("자치구 표: 이스케이프 없이 문자열에 끼우던 칸에 `& < > \"`가 든 문자열이 오면 legacy는 그대로, React는 이스케이프해서 낸다(알려진 차이 — 실제 입력에는 나오지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  assert.equal(RAW_TEXT_DIFF.length, 13);
  assert.equal(new Set(RAW_TEXT_DIFF.map((d) => d.id)).size, RAW_TEXT_DIFF.length);
  for (const { id, fn, args, legacy, react } of RAW_TEXT_DIFF) {
    assert.notEqual(legacy, react, `${id}: 두 글자가 같으면 알려진 차이가 아니다`);
    assert.equal(prerender[fn].legacy(...args), legacy, `${id} legacy`);
    assert.equal(fragment(fn, prerender[fn].legacy)(...args), react, `${id} react`);
  }
});

test("district-tables.mjs: legacy·JSX가 같이 쓰는 순수 모듈이다 - 글자 규칙·행 선택·표본 부족 판정", () => {
  assert.equal(CONVERSION_BAND, "60to85");
  assert.equal(prerender.CONVERSION_BAND, CONVERSION_BAND);
  // pct·signed: null·undefined만 "-"
  assert.equal(pct(null), "-");
  assert.equal(pct(undefined), "-");
  assert.equal(pct(0), "0%");
  assert.equal(pct(false), "false%");
  assert.equal(signed(null), "-");
  assert.equal(signed(undefined), "-");
  assert.equal(signed(0), "0%");
  assert.equal(signed(3), "+3%");
  assert.equal(signed(-3), "-3%");
  assert.equal(count(1234567), "1,234,567");
  assert.throws(() => count(null), TypeError);
  // 데이터 없음은 null(표 조각이 null을 돌려 자리표시를 비운다)
  for (const fn of [conversionTable, cancelDistricts, cancelMonths, renewalDistricts, renewalWolseDistricts, floorDistricts]) {
    assert.equal(fn(null), null, fn.name);
    assert.equal(fn(undefined), null, fn.name);
    assert.equal(fn({}), null, fn.name);
  }
  // 해자 2: 표본 부족 판정은 null만(엄격 비교), undefined·0·""·false는 값이다. 건수 문턱은 여기서 다시 적용하지 않는다.
  const rd = (gapMedian) => renewalDistricts({ table: [{ district: "가", gapMedian, gapMatched: 0, rightUsed: 0 }] })[0].gap;
  assert.deepEqual(rd(null), { low: true });
  assert.deepEqual(rd(undefined), { text: "-" });
  assert.deepEqual(rd(0), { text: "0%" });
  assert.deepEqual(rd(""), { text: "%" });
  assert.deepEqual(rd(false), { text: "false%" });
  const rw = (median) => renewalWolseDistricts({ wolseTable: [{ district: "가", median, range: [], matched: 0 }], seoul: { wolse: { rate: 4, range: [{ rate: 3 }] } } }).rows[0].gap;
  assert.deepEqual(rw(null), { low: true });
  assert.deepEqual(rw(undefined), { text: "-" });
  assert.deepEqual(rw(0), { text: "0%" });
  assert.deepEqual(rw(2), { text: "+2%" });
  const fl = (distinct, band) => floorDistricts({ districts: [{ district: "가", median: null, cells: 0, distinct, band }] })[0].lowText;
  assert.equal(fl(true, null), null);
  assert.equal(fl(true, {}), null);
  assert.equal(fl(false, {}), "갈라 볼 수 없음");
  assert.equal(fl(false, null), "칸이 모자람");
  assert.equal(fl(undefined, undefined), "칸이 모자람");
  assert.equal(fl("0", null), null);
  // 정렬은 사본에서(입력 순서를 바꾸지 않는다), 같은 전환율은 들어온 순서
  const cells = [{ district: "가", band: "60to85", rate: 1, pairs: 1 }, { district: "나", band: "60to85", rate: 2, pairs: 1 }, { district: "다", band: "60to85", rate: 2, pairs: 1 }];
  assert.deepEqual(conversionTable({ cells }).rows.map((r) => r.district), ["나", "다", "가"]);
  assert.deepEqual(cells.map((c) => c.district), ["가", "나", "다"]);
  // 같은 모듈을 쓰므로 prerender.mjs가 이 이름을 다시 내보내는 것은 CONVERSION_BAND 하나뿐이다(다른 이름은 밖에서 쓰지 않는다)
});

test("district-links.mjs: linksBlockShape는 JSX가 쓰는 분기이고 linksBlockHtml(legacy)이 같은 분기를 쓴다", () => {
  for (const none of ["", null, undefined, 0, false, NaN]) assert.equal(linksBlockShape("x", "머리", none), null, String(none));
  assert.deepEqual(linksBlockShape("district-links", "다른 지역", "<a>1</a>"), { headingId: "district-links-heading", boxId: "district-links", heading: "다른 지역" });
  assert.deepEqual(linksBlockShape("i", false, 25), { headingId: "i-heading", boxId: "i", heading: false });
  // 링크가 있으면 어떤 값이든 같은 모양(개수 0은 없음)
  assert.equal(linksBlockShape("i", "h", 0), null);
  assert.notEqual(linksBlockShape("i", "h", 1), null);
  // JSX가 쓰는 경로 규칙은 코드가 정한 `./district-<slug>.html` 하나다: legacy의 `./${file}`과 25곳 모두 같다
  for (const { slug, file } of DISTRICT_PAGES) assert.equal(slugLinkHref(slug), `./${file}`);
  for (const { slug } of DISTRICT_PAGES) assert.match(slugLinkHref(slug), /^\.\/district-[a-z]+\.html$/, "javascript: 등 다른 스킴이 들어갈 자리가 없다");
});

// ---- 시세표 머리글·표(#242 PR 2): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const TABLE_NAMES = (html) => [...html.matchAll(/<tr class="[^"]*"><td>(?:<a[^>]*>)?([^<]*)/g)].map((m) => m[1]);
const hasExpect = (b) => "expect" in b;

test("시세표 분기 표: id가 겹치지 않고, 두 조각을 모두 덮고, 모든 행에 기대값(expect 또는 정렬 순서 order)이 있다", () => {
  const ids = REALESTATE_TABLE_BRANCHES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual([...new Set(REALESTATE_TABLE_BRANCHES.map((b) => b.fn))].sort(), REALESTATE_TABLE_FNS);
  for (const b of REALESTATE_TABLE_BRANCHES) {
    assert.ok(hasExpect(b) || Array.isArray(b.order), `${b.id}: 기대값(expect 또는 order)이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  const toIds = new Set(REALESTATE_TABLE_THROWS.map((b) => b.id));
  assert.equal(toIds.size, REALESTATE_TABLE_THROWS.length, "던지는 입력 id가 겹친다");
  assert.ok(REALESTATE_TABLE_BRANCHES.length >= 700, `분기 표가 ${REALESTATE_TABLE_BRANCHES.length}행뿐이다`);
});

test("시세표 분기 표: 값 종류별 행이 있다 - 데이터 없음(null)·비문자열·null·undefined·특수문자·빈 값·낡음 태그·월세·정렬", () => {
  const table = REALESTATE_TABLE_BRANCHES.filter((b) => b.fn === "realestateTableHtml");
  const outs = table.filter(hasExpect).map((b) => b.expect);
  const strings = outs.filter((o) => typeof o === "string");
  const has = (re) => strings.some((o) => re.test(o));
  assert.ok(outs.includes(null), "데이터 없음(null) 행이 없다");
  assert.ok(table.some((b) => b.args[0] === null), "null 입력 행이 없다");
  assert.ok(table.some((b) => b.args[0] === undefined), "undefined 입력 행이 없다");
  assert.ok(has(/A&amp;B &lt;i&gt; &quot;q&quot; it's/), "특수문자 행이 없다");
  assert.ok(has(/a&amp;amp;b&amp;#x27;/), "이미 이스케이프된 글자 행이 없다");
  assert.ok(has(/<td>false<\/td>/) && has(/<td>true<\/td>/) && has(/<td>NaN<\/td>/) && has(/\[object Object\]/) && has(/<td>1,2<\/td>/), "비문자열(false·true·NaN·{}·[1,2]) 이름 행이 없다");
  assert.ok(has(/<td><\/td>/), "빈 값(빈 이름) 행이 없다");
  assert.ok(has(/<td>-<\/td>/), "이름 없음(null·undefined → \"-\") 행이 없다");
  assert.ok(has(/신고 NaN건/) && has(/신고 false건/) && has(/신고 \[object Object\]건/) && has(/신고 건/) && has(/신고 0건/), "건수 비숫자 표본 부족 행이 없다");
  assert.ok(has(/class="prev-tag"/), "낡음 태그 행이 없다");
  assert.ok(has(/class="overall-row"/) && has(/<tr class="">/), "서울 전체 줄·자치구 줄 행이 없다");
  assert.ok(has(/월 -<\/span>/) && has(/class="change (up|down)" title="[^"]*보증금 \+ 월세/), "월세 칸(월 -·월세 증감) 행이 없다");
  assert.ok(has(/class="ratio"/), "전세가율 행이 없다");
  assert.equal(table.filter((b) => Array.isArray(b.order) && !hasExpect(b)).length, 18, "정렬 행이 열여덟 개가 아니다");
  // 낡음 태그가 붙지 않는 행도 있다(키 없음·null·날짜 아님)
  assert.ok(table.filter((b) => b.id.startsWith("ST-")).some((b) => typeof b.expect === "string" && !b.expect.includes("prev-tag")));
});

test("시세표 분기 표: 해자 2(표본 부족)가 세 보기(한 줄 표·종류 표·자치구 페이지 표)마다 행으로 있고, 표본 부족이 값 없음보다 먼저 판정되는 순서 행이 있다", () => {
  const table = REALESTATE_TABLE_BRANCHES.filter((b) => b.fn === "realestateTableHtml" && hasExpect(b));
  const views = {
    "한 줄 표(reAllCells)": (b) => b.id.startsWith("TA-"),
    "종류 표(reCells)": (b) => /^T[SJW]-/.test(b.id) || b.id.startsWith("TO-1") || b.id.startsWith("TR-") || b.id.startsWith("TJ-M"),
    "자치구 페이지 표(reDistrictRows)": (b) => b.id.startsWith("DR-"),
  };
  for (const [name, pick] of Object.entries(views)) {
    const moat = table.filter((b) => b.moat && pick(b));
    assert.ok(moat.some((b) => /<span class="low-sample" title="이번 달 신고가 \d+건뿐이라 평균을 내지 않았습니다\.">신고 \d+건<\/span>/.test(b.expect)), `${name}: 표본 부족 스팬 행이 없다`);
    assert.ok(moat.some((b) => b.order), `${name}: 순서 행(표본 부족이 값 없음보다 먼저)이 없다`);
    assert.ok(table.some((b) => pick(b) && !b.moat && !b.expect.includes("low-sample") && /6,000만원/.test(b.expect)), `${name}: 표본 부족이 아닌 값 행이 없다`);
    assert.ok(table.some((b) => pick(b) && !b.expect.includes("low-sample") && !/만원|억/.test(b.expect.replace(/만원 ?\//g, ""))), `${name}: 값 없음("-") 행이 없다`);
  }
  // 순서: 지표가 있으면(값이 없어도) "-"가 아니라 표본 부족이다. 지표 자체가 없을 때만 "-"다.
  const get = (id) => REALESTATE_TABLE_BRANCHES.find((b) => b.id === id).expect;
  assert.match(get("TA-S-o01"), /<td data-label="매매 평당가"><span class="low-sample"[^>]*>신고 4건<\/span><\/td>/);
  assert.match(get("TA-S-o02"), /<td data-label="매매 평당가"><span class="low-sample"[^>]*>신고 40건<\/span><\/td>/);
  assert.match(get("TA-S-z01"), /<td data-label="매매 평당가">-<\/td>/);
  assert.match(get("TA-S-z03"), /<td data-label="매매 평당가">-<\/td>/);
  // 문턱: 5건부터 값이다(4건은 값이 있어도 내지 않는다). 이 표는 건수 문턱을 따로 정하지 않고 resolveMetric이 정한 것을 따른다.
  assert.match(get("TA-S-n01"), /6,000만원/);
  assert.doesNotMatch(get("TA-S-n02"), /6,000만원/);
  assert.equal(MIN_SAMPLE, 5);
});

test("시세표 분기 표: legacy 출력이 손으로 적은 기대값(또는 정렬 순서)과 같다(분기마다)", () => {
  for (const b of REALESTATE_TABLE_BRANCHES) {
    const out = prerender[b.fn].legacy(...b.args);
    if (hasExpect(b)) assert.equal(out, b.expect, `${b.id} ${b.cond}`);
    else assert.deepEqual(TABLE_NAMES(out), b.order, `${b.id} ${b.cond}`);
  }
});

test("시세표 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of REALESTATE_TABLE_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    if (hasExpect(b)) assert.equal(react, b.expect, `${b.id} ${b.cond}`);
    else assert.deepEqual(TABLE_NAMES(react), b.order, `${b.id} ${b.cond}`);
    assert.equal(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("시세표 분기 표: 같은 입력을 두 번 넣어도 같고 입력을 바꾸지 않는다(정렬은 사본에)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  const snap = (args) => JSON.stringify(args, (_, v) => (v === undefined ? "(undefined)" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
  for (const b of REALESTATE_TABLE_BRANCHES) {
    const before = snap(b.args);
    const react = fragment(b.fn, prerender[b.fn].legacy);
    assert.equal(react(...b.args), react(...b.args), b.id);
    prerender[b.fn].legacy(...b.args);
    assert.equal(snap(b.args), before, `${b.id}: 입력이 바뀌었다`);
  }
});

test("시세표 조각: 예전 코드가 던지는 입력은 legacy도 React 조각도 같이 던진다(조용히 빈 표를 내지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  assert.equal(REALESTATE_TABLE_THROWS.length, 10);
  for (const b of REALESTATE_TABLE_THROWS) {
    assert.throws(() => prerender[b.fn].legacy(...b.args), TypeError, `${b.id} legacy ${b.cond}`);
    assert.throws(() => fragment(b.fn, prerender[b.fn].legacy)(...b.args), TypeError, `${b.id} react ${b.cond}`);
  }
});

test("시세표 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(데이터 없음은 null, 머리글은 언제나 한 줄)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const spy = () => (called++, "legacy");
  for (const none of [null, undefined, {}, { districts: [] }]) assert.equal(fragment("realestateTableHtml", spy)(none), null);
  assert.equal(fragment("realestateTableHtml", spy)({ districts: [{ name: "중구" }] }, null, "종로구"), null);
  assert.ok(fragment("realestateHeadHtml", spy)().startsWith('<tr><th scope="col">지역</th>'));
  assert.ok(fragment("realestateHeadHtml", spy)(null, "종로구").startsWith('<tr><th scope="col">구분</th>'));
  assert.equal(called, 0);
});

test("realestate-table.mjs: legacy·JSX가 같이 쓰는 순수 모듈이다 - 라벨·글자 규칙·칸 모양·정렬", () => {
  // 라벨(손으로 적은 값)
  assert.deepEqual(RE_LABELS, {
    district: "지역", sale: "매매", jeonse: "전세", wolse: "월세", colSale: "매매 평당가", colJeonse: "전세 평당 보증금", colWolse: "월세 보증금 / 월세",
    perPyeong: "평당가", perPyeongDeposit: "평당 보증금", area: "84㎡ 환산", deposit: "평균 보증금", monthly: "평균 월세", count: "거래건수", ratio: "전세가율",
    ratioByComplex: "전세가율 단지별 중앙값", overall: "서울 전체",
  });
  assert.deepEqual(reHeadLabels(null), ["지역", "매매 평당가", "전세 평당 보증금", "월세 보증금 / 월세"]);
  assert.deepEqual(reHeadLabels("wolse"), ["지역", "평균 보증금", "평균 월세", "거래건수"]);
  assert.deepEqual(reHeadLabels("jeonse"), ["지역", "평당 보증금", "84㎡ 환산", "전세가율", "거래건수"]);
  assert.deepEqual(reHeadLabels("sale"), ["지역", "평당가", "84㎡ 환산", "거래건수"]);
  assert.deepEqual(reHeadLabels("x"), reHeadLabels("sale"));
  assert.deepEqual(headLabels(), reHeadLabels(null));
  assert.deepEqual(headLabels("jeonse", "종로구"), ["구분", "평당가", "84㎡ 환산", "거래건수"]);
  // 글자
  assert.equal(reCount(1234), "1,234건");
  assert.equal(reCount("9"), "9건");
  assert.equal(reCount([7]), "7건");
  assert.throws(() => reCount(null), TypeError);
  assert.throws(() => reCount(undefined), TypeError);
  assert.equal(reMan(5530), "5,530만원");
  assert.equal(reMan(20264), "2억 264만원");
  assert.equal(reMan("5"), "-");
  assert.equal(reEok(152459), "15억 2,459만원");
  assert.equal(reEok(null), "-");
  // 증감: 매매·전세는 value10k, 월세는 percent(방향은 value10k)
  const sp = (type, text, { title = null, dir = null, esc = false } = {}) => ({ type, text, title, dir, esc });
  const SPACE = sp("text", " ");
  assert.deepEqual(reChange({ value10k: 5 }, "2026-10-04"), [SPACE, sp("change", "▲5만원", { title: "2026-10-04 대비", dir: "up" })]);
  assert.deepEqual(reChange({ value10k: -5 }, null), [SPACE, sp("change", "▼5만원", { dir: "down" })]);
  for (const none of [undefined, null, {}, { value10k: 0 }, { value10k: -0 }, { value10k: "5" }, 5, "x"]) assert.deepEqual(reChange(none, "d"), [], String(none));
  assert.deepEqual(reWolseChange({ value10k: 1, percent: 2.34 }, null), [SPACE, sp("change", "▲2.3%", { dir: "up" })]);
  assert.match(reWolseChange({ value10k: -1, percent: 2 }, "d")[1].title, /^d 대비 · 보증금과 월세를 묶은 ㎡당 값\(보증금 \+ 월세×12÷4\.8%\)의 증감/);
  for (const none of [undefined, {}, { value10k: 1 }, { value10k: 1, percent: "2" }, { value10k: 0, percent: 2 }]) assert.deepEqual(reWolseChange(none, "d"), [], JSON.stringify(none));
  assert.deepEqual(reCountSpan({ transactionCount: 1234 }), [SPACE, sp("count", "1,234건", { esc: true })]);
  for (const none of [{ transactionCount: "5" }, { transactionCount: null }, {}, undefined]) assert.deepEqual(reCountSpan(none), [], String(none));
  // 표본 부족: n은 transactionCount 그대로, 없으면(null·undefined) 0 - 0은 0이다. 문턱은 여기서 정하지 않는다(100건이어도 이 함수는 표본 부족 글자를 낸다).
  const low = (n, txt = n) => sp("low", `신고 ${txt}건`, { title: `이번 달 신고가 ${txt}건뿐이라 평균을 내지 않았습니다.`, esc: true });
  assert.deepEqual(reLowSample({ transactionCount: 4 }), low(4));
  assert.deepEqual(reLowSample({ transactionCount: 100 }), low(100));
  assert.deepEqual(reLowSample({ transactionCount: 0 }), low(0));
  assert.deepEqual(reLowSample({}), low(0));
  assert.deepEqual(reLowSample(undefined), low(0));
  assert.deepEqual(reLowSample({ transactionCount: null }), low(0));
  assert.deepEqual(reLowSample(5), low(0));
  assert.deepEqual(reLowSample({ transactionCount: NaN }), low("NaN"));
  // 칸 모양: 지표 없음 → "-", 지표 있는데 못 낸 값 → 표본 부족, 값 → 값
  const none = [sp("text", "-")];
  assert.deepEqual(reCells({}, "sale"), [none, none, none]);
  assert.deepEqual(reCells({ sale: { transactionCount: 4 } }, "sale"), [[low(4)], none, none]);
  assert.deepEqual(reCells({ sale: { transactionCount: 40 } }, "sale"), [[low(40)], none, none]);
  assert.equal(reCells({ sale: { avgPricePerPyeong10k: 6000, transactionCount: 40 } }, "sale").length, 3);
  assert.equal(reCells({ sale: { avgPricePerPyeong10k: 6000, transactionCount: 40 }, jeonse: { avgDepositPerPyeong10k: 3000, transactionCount: 30 } }, "jeonse").length, 4);
  assert.equal(reCells({ jeonse: { transactionCount: 2 } }, "jeonse").length, 3);
  assert.throws(() => reCells({}, "foo"), TypeError);
  assert.deepEqual(reAllCells({}), [none, none, none]);
  assert.deepEqual(reAllCells({ wolse: { transactionCount: 3 } }), [none, none, [low(3)]]);
  assert.equal(reDistrictRows({}).length, 3);
  assert.deepEqual(reDistrictRows({}).map((r) => r.label), ["매매", "전세", "월세"]);
  assert.deepEqual(reDistrictRows({}).map((r) => r.cells.map((c) => c.label)), Array(3).fill(["평당가", "84㎡ 환산", "거래건수"]));
  // 낡음 태그
  assert.deepEqual(reStaleTag({}), []);
  assert.deepEqual(reStaleTag({ staleAt: "그날쯤" }), []);
  assert.deepEqual(reStaleTag({ staleAt: "2026-10-04T15:30:00Z" }).map((p) => p.text), [" ", "10. 5."]);
  assert.equal(reStaleTag({ staleAt: "2026-10-04T15:30:00Z" })[1].title, "이 지역은 오늘 실거래 조회에 실패해 지난번에 받은 값을 그대로 보여줍니다.");
  // 이름: 자치구 25곳은 링크(상대 경로), 나머지는 글자만
  assert.deepEqual(reDistrictLink("종로구"), { text: "종로구", href: "./district-jongno.html" });
  assert.deepEqual(reDistrictLink("없는구"), { text: "없는구", href: null });
  assert.deepEqual(reRow({}, "서울 전체", true, null).name, { text: "서울 전체", href: null });
  assert.equal(reRow({}, "서울 전체", true, null).overall, true);
  assert.equal(reRow({}, "종로구", false, null).overall, false);
  assert.deepEqual(reRow({}, "종로구", false, "wolse").cells.map((c) => c.label), ["평균 보증금", "평균 월세", "거래건수"]);
  // 정렬: 값이 높은 순·값 없는 곳은 뒤·둘 다 없으면 이름순, 입력은 그대로
  const mk = (name, price) => ({ name, ...(price === undefined ? {} : { sale: { avgPricePerPyeong10k: price, transactionCount: 10 } }) });
  const input = [mk("다"), mk("나", 1), mk("가"), mk("라", 2)];
  assert.deepEqual(reSorted(input, null).map((d) => d.name), ["라", "나", "가", "다"]);
  assert.deepEqual(reSorted(input, "sale").map((d) => d.name), ["라", "나", "가", "다"]);
  assert.deepEqual(input.map((d) => d.name), ["다", "나", "가", "라"]);
  // 표: 없으면 null, 자치구 페이지는 byDistrict
  assert.equal(realestateTable(null), null);
  assert.equal(realestateTable({ districts: [mk("가", 1)] }, null, "나"), null);
  assert.equal(realestateTable({ districts: [mk("가", 1)] }, null, "가").byDistrict, true);
  assert.equal(realestateTable({ districts: [mk("가", 1)] }).byDistrict, false);
  assert.equal(realestateTable({ overall: mk("x", 1), districts: [mk("가", 1)] }).rows.length, 2);
});

test("realestate-table.mjs: 표본 문턱을 정의하거나 다시 적용하지 않는다 - resolveMetric(realestate-format.mjs)이 한 곳에서 정한다", async () => {
  const source = await readFile(path.join(root, "scripts/realestate-table.mjs"), "utf8");
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /MIN_SAMPLE|hasEnoughSample|metricOf/, "문턱을 이 모듈이 다시 부른다");
  assert.match(code, /resolveMetric\(entry, kind\)/);
  assert.doesNotMatch(code, /prerender\.mjs|renderer\.mjs/, "순수 모듈이 렌더러 스위치를 부른다");
  // 문턱은 realestate-format.mjs의 5건 하나다(위 realestate-rows 시험이 정의가 하나뿐임을 지킨다)
  assert.equal(hasEnoughSample({ transactionCount: 5 }), true);
  assert.equal(hasEnoughSample({ transactionCount: 4 }), false);
});

test("realestate-table.mjs: 이스케이프 없이 문자열에 끼우는 조각(esc=false)의 글자에는 & < > \"가 들 수 없다 - 난수 입력 3만 건(고정 시드)", () => {
  // 입력 값 자리마다 특수문자·비문자열·null·undefined를 섞는다. 입력 글자는 건수·이름·날짜·기준일뿐이고 전부 esc=true 자리다(이스케이프 한다). esc=false는 숫자 서식 글자다.
  let seed = 20261011;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const STR = ["", "a", "종로구", `A&B <i> "q" it's`, "&amp;", "&#x27;", "5", "9", "x", "</td><td>", "\ud800", "1,2"];
  const ODD = [false, true, 0, 1, -1, 7, 4, 5, 6, 4.5, 1380.5, NaN, Infinity, -Infinity, {}, [], [1, 2], [7], null, undefined];
  const NUM = [0, 1, 3, 4, 5, 6, 40, 684, 1234567, -3];
  const v = () => (rnd() < 0.4 ? pick(NUM) : rnd() < 0.5 ? pick(STR) : pick(ODD));
  const metric = (f) => {
    const r = rnd();
    if (r < 0.1) return pick([undefined, null, 0, "", false, 5, "x", true, [], {}]);
    const m = {};
    if (rnd() < 0.9) m.transactionCount = v();
    if (rnd() < 0.9) m[f] = v();
    if (f === "avgDeposit10k" && rnd() < 0.9) m.avgMonthlyRent10k = v();
    if (rnd() < 0.7) m.change = pick([undefined, null, {}, { value10k: v() }, { value10k: v(), percent: v() }, 5, "x"]);
    if (rnd() < 0.5) m.baselineDate = v();
    return m;
  };
  const entry = () => ({ name: v(), sale: metric("avgPricePerPyeong10k"), jeonse: metric("avgDepositPerPyeong10k"), wolse: metric("avgDeposit10k"), ...(rnd() < 0.3 ? { staleAt: v() } : {}) });
  let rawParts = 0;
  let total = 0;
  for (let i = 0; i < 30000; i++) {
    const e = entry();
    const kind = pick([null, "sale", "jeonse", "wolse"]);
    const label = rnd() < 0.5 ? pick(["종로구", "constructor", "__proto__", "toString", "없는구"]) : v();
    const parts = [];
    for (const cells of [kind ? reCells(e, kind) : reAllCells(e), reDistrictRows(e).flatMap((r) => r.cells.map((c) => c.parts)), reRow(e, label, false, kind).cells.map((c) => c.parts), [reRow(e, label, false, kind).stale]]) {
      for (const cell of cells) parts.push(...cell);
    }
    for (const p of parts) {
      total++;
      assert.equal(typeof p.text, "string");
      if (!p.esc) {
        rawParts++;
        assert.doesNotMatch(p.text, /[&<>"]/, `raw 조각 글자에 특수문자가 있다: ${JSON.stringify(p)}`);
      }
      if (p.type === "text") assert.equal(p.title, null);
    }
    assert.match(reDistrictLink(label).href ?? "./", /^\.\//, "링크 경로가 ./로 시작하지 않는다(javascript: 불가)");
  }
  assert.ok(rawParts > 30000 && total > rawParts, `raw ${rawParts}개·전체 ${total}개 - 입력이 raw 자리를 거의 밟지 않았다`);
});
