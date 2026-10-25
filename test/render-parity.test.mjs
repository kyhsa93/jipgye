import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as prerender from "../scripts/prerender.ts";
import { INDEX_NEWS, indexNewsItems } from "../scripts/news-items.ts";
import { escapeHtml } from "../scripts/html-escape.ts";
import { linksBlockHtml, linksBlockShape, slugLinkEntries, slugLinkHref, slugLinksHtml } from "../scripts/district-links.ts";
import { DISTRICT_PAGES } from "../scripts/district-slugs.ts";
import { CONVERSION_BAND, cancelDistricts, cancelMonths, conversionTable, count, floorDistricts, pct, renewalDistricts, renewalWolseDistricts, signed } from "../scripts/district-tables.ts";
import { MAX_DISTRICTS, changeOf, countOf, man, metricCell, topDistricts } from "../scripts/realestate-rows.ts";
import { MIN_SAMPLE, hasEnoughSample } from "../scripts/realestate-format.ts";
import { RE_LABELS, headLabels, reAllCells, reCells, reChange, reCount, reCountSpan, reDistrictLink, reDistrictRows, reEok, reHeadLabels, reLowSample, reMan, reRow, reSorted, reStaleTag, reWolseChange, realestateTable } from "../scripts/realestate-table.ts";
import { overallCards, ratioBasis } from "../scripts/realestate-overall.ts";
import { BUDGET_MORE_LINKS, CANDIDATE_LIST, bodyShape, budgetAnswers, budgetBandLabel, budgetRuleHref, budgetWhen, candidatesShape, capNote, costsNote, dealShape, eokOf, eokText, loanNote, minCashNote, policyNote, whereText } from "../scripts/budget-fragments.ts";
import { makeFragment, rendererMode } from "../scripts/renderer.ts";
import { DESIGN_ATTRS, stripDesignAttrs } from "../scripts/design-attrs.ts";
import { createReactRenderer } from "../scripts/render/react.ts";
import { JAVASCRIPT_URL_DIFF, NEWS_MARKET_BRANCHES } from "./fixtures/render/news-market-branches.mjs";
import { LEAD_LINKS_BRANCHES, LEAD_LINKS_FNS } from "./fixtures/render/lead-links-branches.mjs";
import { RAW_COUNT_DIFF, REALESTATE_BRANCHES } from "./fixtures/render/realestate-branches.mjs";
import { DISTRICT_TABLES_BRANCHES, DISTRICT_TABLES_FNS, DISTRICT_TABLES_THROWS, RAW_TEXT_DIFF } from "./fixtures/render/district-tables-branches.mjs";
import { REALESTATE_TABLE_BRANCHES, REALESTATE_TABLE_FNS, REALESTATE_TABLE_THROWS } from "./fixtures/render/realestate-table-branches.mjs";
import { REALESTATE_OVERALL_BRANCHES, REALESTATE_OVERALL_FNS, REALESTATE_OVERALL_THROWS } from "./fixtures/render/realestate-overall-branches.mjs";
import { BUDGET_LEAVES_BRANCHES, BUDGET_LEAVES_FNS, BUDGET_LEAVES_THROWS } from "./fixtures/render/budget-leaves-branches.mjs";
import { BUDGET_BODY_KNOWN_DIFFS, BUDGET_CB_BRANCHES, BUDGET_CB_FNS, BUDGET_CB_THROWS } from "./fixtures/render/budget-candidates-body-branches.mjs";

// #237: 렌더러 스위치와 legacy↔react parity 시험의 골격. #240이 금리 조각(ratesHtml·ratesHeadHtml)의 분기별 케이스를 더했고(#577 B2 로 금리 4장과 함께 지웠다)
// #241 PR 1이 문장·목록 8개(summaryHtml·marketHtml·뉴스 6개)를, PR 2가 리드·링크 10개(*LeadHtml 6·*DistrictLinksHtml 4)를,
// PR 3이 첫 화면 실거래 요약(realestateHtml)을, #242 PR 1이 자치구 문장·링크 4개와 표 6개를, PR 2가 시세표 머리글·표(realestateHeadHtml·realestateTableHtml)를, PR 3이 시세 요약 카드(realestateOverallHtml)를,
// #243 PR A가 예산대 잎 조각 8개(budgetAnswersHtml·budgetMoreHtml·budgetMinCashHtml·budgetPolicyHtml·budgetCapHtml·budgetCostsHtml·budgetFactsHtml·budgetLoanHtml)를, PR B가 후보 단지와 합성(budgetCandidatesHtml·budgetBodyHtml)을
// 더해 prerender.ts의 조각 44개(지금은 42개)가 모두 이식됐다(서브프로세스 시험이 "이식 완료 상태"를 검증한다).
// 입력은 이 파일 안의 값과 test/fixtures/render/의 고정 파일뿐이다(R3): 저장소의 docs/·docs/data는 읽지 않는다.

const root = path.resolve(import.meta.dirname, "..");
const fixture = (name) => path.join(root, "test/fixtures/render", name);
const tmpDirs = [];
after(() => Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))));

// 내용 비교(#277). 조각 출력이 한쪽에 오는 "같다" 비교는 전부 이 helper를 거친다 — 양쪽에 **같은** 정규화를 걸고,
// 지우는 속성은 scripts/design-attrs.mjs의 DESIGN_ATTRS(class·style) 둘뿐이다. 그래서 조각 JSX나 legacy 쌍둥이의
// class·style이 바뀌어도 이 시험은 빨개지지 않고(디자인 개편 #279~#283이 이 시험에 막히지 않게 하는 것이 이 이슈다),
// 본문 글자·수치·링크 href·태그 이름과 트리·id·data-*·aria-*·속성에 든 글자가 바뀌면 그대로 빨개진다
// (DIRECTION.md 369행이 지키는 여덟 가지는 하나도 완화 대상이 아니다).
// 문자열이 아닌 값(null·undefined)은 정규화가 그대로 돌려준다 — 조각이 null을 내는 자리가 있어서다.
const norm = (v) => stripDesignAttrs(v);
const sameHtml = (actual, expected, msg) => assert.equal(norm(actual), norm(expected), msg);
const sameHtmlStrict = (actual, expected, msg) => assert.strictEqual(norm(actual), norm(expected), msg);
// 서브프로세스가 돌려주는 [id, html] 짝 목록(legacy 모드 프로세스 ↔ react 모드 프로세스)도 같은 정규화를 거친다.
const normRows = (rows) => rows.map(([id, html]) => [id, norm(html)]);

test("내용 비교의 정규화는 class·style 둘만 지운다(셋째가 생기면 DIRECTION.md 369행을 깎는 것이라 cto 판정)", () => {
  assert.deepEqual([...DESIGN_ATTRS], ["class", "style"]);
  // class 값은 Tailwind 접두(tw:)를 쓴다 - 훅 클래스 추출기(tools/golden collectHookClasses)가 test/*.mjs의
  // class="…"를 읽으므로, 여기 적은 글자가 새 훅 이름으로 잡히지 않게 한다.
  assert.equal(norm('<p class="tw:mt-4" style="color:red" id="x" data-k="v" aria-label="L" title="T">글 자</p>'), '<p id="x" data-k="v" aria-label="L" title="T">글 자</p>');
  assert.equal(norm(null), null);
  assert.equal(norm(undefined), undefined);
  assert.equal(norm(""), "");
  // 본문 글자에 든 class=·style= 는 속성이 아니므로 건드리지 않는다.
  assert.equal(norm('<p>class="tw:p-2" style="y"</p>'), '<p>class="tw:p-2" style="y"</p>');
});

test("JIPGYE_RENDERER: 미설정·빈 문자열은 react(#246 컷오버), legacy·react만 받고 나머지는 멈춘다", () => {
  assert.equal(rendererMode({}), "react");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "" }), "react");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "legacy" }), "legacy");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "react" }), "react");
  for (const bad of ["React", "jsx", " react", "1"]) {
    assert.throws(() => rendererMode({ JIPGYE_RENDERER: bad }), /JIPGYE_RENDERER를 읽을 수 없습니다/, bad);
  }
});

test("prerender.ts의 *Html() 조각은 전부 래퍼를 거치고 이름이 그대로다", () => {
  const names = Object.keys(prerender).filter((k) => k.endsWith("Html") && k !== "escapeHtml");
  assert.ok(names.length >= 40, `조각 함수를 ${names.length}개밖에 못 찾았다`);
  for (const name of names) {
    assert.equal(typeof prerender[name].legacy, "function", `${name}에 legacy 원본이 없다`);
    assert.equal(prerender[name].name, name);
  }
  // 순수 도구(escapeHtml)는 래퍼 밖이다 - 모든 조각이 쓰는 한 글자 단위 함수라서다.
  assert.equal(prerender.escapeHtml.legacy, undefined);
});

test("기본값(react): 래퍼의 출력이 legacy 원본과 같다", () => {
  const summary = { highlights: [{ title: "제목", textKo: "본문" }], categories: [{ name: "분야", lineKo: "한 줄" }] };
  sameHtml(prerender.summaryHtml(summary), prerender.summaryHtml.legacy(summary));
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
  assert.ok(summary({ categories: [{ name: "a", lineKo: "b" }] }).includes('<div class="summary-category-label">a</div>'));
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
    // 분류가 없으면(하이라이트만 있어도) 양쪽 다 null이다.
    { highlights: [{ title: "제목", link: "u", source: "S", textKo: "본문" }] },
    { categories: [{ name: "분야", lineKo: "한 줄" }] },
    { highlights: [{ title: "a", link: "u", source: "S", textKo: "b" }], categories: [{ name: "c", lineKo: "d" }] },
    { model: "m", updatedAt: "2026-10-18T03:05:38.770Z", categories: [{ name: "c", lineKo: "d", fallbackReason: "x" }] },
    // 특수문자: React가 `'`만 다르게(&#x27;) 내므로 래퍼의 치환 한 줄이 맞춰야 한다. & < > "는 양쪽이 같다.
    { highlights: [{ title: `it's <b> & "q"`, link: "https://e.com/?a=1&b=2", source: `s'<`, textKo: "don't & <i>" }], categories: [{ name: `a'b`, lineKo: `c'd` }] },
    // 글이 비어도 legacy는 스크립트처럼 그린다(거르지 않는다).
    { highlights: [{ title: "빈 글", link: "u", source: "S", textKo: "" }, { title: "남음", link: "u", source: "S", textKo: "x" }], categories: [{ name: "n", lineKo: "" }] },
  ];
  for (const input of inputs) {
    sameHtml(react(input), prerender.summaryHtml.legacy(input), JSON.stringify(input));
  }
});

// 명시한 legacy(롤백·시험용)가 로더를 만지지 않는다는 것, react 모드(기본값 포함)의 실패가 삼켜지지 않는다는 것을 한 번에 본다:
// node_modules가 없는 scripts/ 복사본에서는 esbuild·react를 읽을 수 없다. legacy는 그래도 import가 되고, react는 import에서 던진다.
// 컷오버(#246) 전에는 기본값이 legacy라 이 복사본에서 통과했다. 이제 기본값이 react라서 `npm ci` 없이 prerender.ts·renderer.mjs를 부르는 길은 던진다.
async function importIn(dir, env) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", 'const r = await import("./scripts/renderer.ts"); await import("./scripts/prerender.ts"); console.log(JSON.stringify({ mode: r.RENDERER, ported: r.portedFragments() }));'],
    { cwd: dir, encoding: "utf8", env: { ...process.env, JIPGYE_RENDERER: "", ...env } }
  );
}

test("명시한 legacy는 esbuild·react 없이도 import되고, 기본값(react)·react 모드는 로더가 못 뜨면 import에서 던진다", async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "jipgye-nomods-")));
  tmpDirs.push(dir);
  await cp(path.join(root, "scripts"), path.join(dir, "scripts"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}');

  const legacy = await importIn(dir, { JIPGYE_RENDERER: "legacy" });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.deepEqual(JSON.parse(legacy.stdout), { mode: "legacy", ported: [] });

  const byDefault = await importIn(dir, {});
  assert.notEqual(byDefault.status, 0, "기본값이 react인데 로더를 못 띄우고 조용히 지나갔다");
  assert.match(byDefault.stderr, /Cannot find (package|module) '(react-dom|esbuild|react)/);

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
  "budgetAnswersHtml",
  "budgetBodyHtml",
  "budgetCandidatesHtml",
  "budgetCapHtml",
  "budgetCostsHtml",
  "budgetFactsHtml",
  "budgetLoanHtml",
  "budgetMinCashHtml",
  "budgetMoreHtml",
  "budgetPolicyHtml",
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
  "realestateHeadHtml",
  "realestateHtml",
  "realestateOverallHtml",
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

test("react 모드: 이식된 조각 목록이 PORTED와 같고, 그 이름은 전부 .legacy를 가진 prerender.ts 조각이다(오타·없는 조각을 막는다)", async () => {
  const renderer = await createReactRenderer();
  assert.deepEqual(renderer.names(), PORTED);
  for (const name of renderer.names()) {
    assert.equal(typeof prerender[name]?.legacy, "function", `entry.jsx의 ${name}은 prerender.ts의 *Html() 조각이 아니다`);
    assert.equal(prerender[name].name, name);
  }
});

test("react 모드(진입 목록 PORTED): 이식 완료 상태(.legacy를 가진 조각 42개 전부 React - 금리 조각 둘은 #577 B2 로 지웠다)이고, 모든 분기 표에서 prerender.ts 조각 출력이 legacy 모드와 같다", async () => {
  const newsUrl = pathToFileURL(fixture("news-market-branches.mjs")).href;
  const leadUrl = pathToFileURL(fixture("lead-links-branches.mjs")).href;
  const realestateUrl = pathToFileURL(fixture("realestate-branches.mjs")).href;
  const districtUrl = pathToFileURL(fixture("district-tables-branches.mjs")).href;
  const tableUrl = pathToFileURL(fixture("realestate-table-branches.mjs")).href;
  const overallUrl = pathToFileURL(fixture("realestate-overall-branches.mjs")).href;
  const budgetLeavesUrl = pathToFileURL(fixture("budget-leaves-branches.mjs")).href;
  const budgetCbUrl = pathToFileURL(fixture("budget-candidates-body-branches.mjs")).href;
  const run = (env) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const r = await import("./scripts/renderer.ts"); const p = await import("./scripts/prerender.ts");
         const { NEWS_MARKET_BRANCHES } = await import(${JSON.stringify(newsUrl)});
         const { LEAD_LINKS_BRANCHES } = await import(${JSON.stringify(leadUrl)});
         const { REALESTATE_BRANCHES } = await import(${JSON.stringify(realestateUrl)});
         const { DISTRICT_TABLES_BRANCHES } = await import(${JSON.stringify(districtUrl)});
         const { REALESTATE_TABLE_BRANCHES } = await import(${JSON.stringify(tableUrl)});
         const { REALESTATE_OVERALL_BRANCHES } = await import(${JSON.stringify(overallUrl)});
         const { BUDGET_LEAVES_BRANCHES } = await import(${JSON.stringify(budgetLeavesUrl)});
         const { BUDGET_CB_BRANCHES } = await import(${JSON.stringify(budgetCbUrl)});
         const run = (rows) => rows.map((b) => [b.id, p[b.fn](...b.args)]);
         // 이식 완료 상태(#243 PR B): prerender.ts에서 .legacy를 가진 조각 이름 전부를 함께 내보낸다 - react 모드의 portedFragments()가 이것과 같아야 하고 legacy 모드는 []다.
         // 합성 조각 budgetBodyHtml은 하위 조각의 래퍼를 부르므로(legacy 원본 안에서) react 모드 프로세스의 .legacy는 이식된 하위 조각을 쓴다 - 순수 legacy가 아니다. 그래서 parity는 이 프로세스의 래퍼 출력을 legacy 모드 프로세스의 출력과 맞댄다.
         const legacyNames = Object.keys(p).filter((k) => typeof p[k]?.legacy === "function").sort();
         console.log(JSON.stringify({ mode: r.RENDERER, ported: r.portedFragments(), legacyNames, news: run(NEWS_MARKET_BRANCHES), leadLinks: run(LEAD_LINKS_BRANCHES), realestate: run(REALESTATE_BRANCHES), districtTables: run(DISTRICT_TABLES_BRANCHES), realestateTable: run(REALESTATE_TABLE_BRANCHES), realestateOverall: run(REALESTATE_OVERALL_BRANCHES), budgetLeaves: run(BUDGET_LEAVES_BRANCHES), budgetCb: run(BUDGET_CB_BRANCHES) }));`,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, JIPGYE_RENDERER: "", ...env } }
    );
  const legacy = run({ JIPGYE_RENDERER: "legacy" });
  const react = run({}); // 기본값 = react(#246 컷오버)
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(react.status, 0, react.stderr);
  assert.equal(react.stderr, "", "react 모드 렌더가 경고를 냈다(DOM 중첩·key 등)");
  const [a, b] = [JSON.parse(legacy.stdout), JSON.parse(react.stdout)];
  assert.equal(a.mode, "legacy");
  assert.equal(b.mode, "react");
  // 이식 완료 상태 검증: legacy 모드는 이식된 조각이 없고([]), react 모드는 .legacy를 가진 조각 이름 전부(42개)를 React로 낸다(남는 조각이 없다).
  // 위임 동작 자체(이식 안 된 조각은 legacy로 간다)는 makeFragment와 가짜 렌더러(fixtures/fragments.jsx)를 쓰는 시험이 계속 지킨다 - #248이 legacy를 지울 때 이 상태 검증이 사라지는 것은 그대로다.
  assert.deepEqual(a.ported, []);
  assert.equal(a.legacyNames.length, 42, "prerender.ts의 조각이 42개가 아니다");
  assert.deepEqual(b.ported, a.legacyNames, "react 모드가 이식하지 않은 조각이 남았다(또는 entry.jsx에 prerender.ts에 없는 이름이 있다)");
  assert.deepEqual(b.ported, PORTED);
  assert.equal(PORTED.length, 42);
  assert.equal(b.news.length, NEWS_MARKET_BRANCHES.length);
  assert.deepEqual(normRows(b.news), normRows(a.news), "react 모드의 prerender.ts 조각 출력이 legacy 모드와 다르다(문장·목록)");
  assert.equal(b.leadLinks.length, LEAD_LINKS_BRANCHES.length);
  assert.deepEqual(normRows(b.leadLinks), normRows(a.leadLinks), "react 모드의 prerender.ts 조각 출력이 legacy 모드와 다르다(리드·링크)");
  assert.equal(b.realestate.length, REALESTATE_BRANCHES.length);
  assert.deepEqual(normRows(b.realestate), normRows(a.realestate), "react 모드의 prerender.ts 조각 출력이 legacy 모드와 다르다(실거래 요약)");
  assert.equal(b.districtTables.length, DISTRICT_TABLES_BRANCHES.length);
  assert.deepEqual(normRows(b.districtTables), normRows(a.districtTables), "react 모드의 prerender.ts 조각 출력이 legacy 모드와 다르다(자치구 문장·링크·표)");
  assert.equal(b.realestateTable.length, REALESTATE_TABLE_BRANCHES.length);
  assert.deepEqual(normRows(b.realestateTable), normRows(a.realestateTable), "react 모드의 prerender.ts 조각 출력이 legacy 모드와 다르다(시세표 머리글·표)");
  assert.equal(b.realestateOverall.length, REALESTATE_OVERALL_BRANCHES.length);
  assert.deepEqual(normRows(b.realestateOverall), normRows(a.realestateOverall), "react 모드의 prerender.ts 조각 출력이 legacy 모드와 다르다(시세 요약 카드)");
  assert.equal(b.budgetLeaves.length, BUDGET_LEAVES_BRANCHES.length);
  assert.deepEqual(normRows(b.budgetLeaves), normRows(a.budgetLeaves), "react 모드의 prerender.ts 조각 출력이 legacy 모드와 다르다(예산대 잎 조각)");
  assert.equal(b.budgetCb.length, BUDGET_CB_BRANCHES.length);
  assert.deepEqual(normRows(b.budgetCb), normRows(a.budgetCb), "react 모드의 prerender.ts 조각 출력이 순수 legacy(legacy 모드 프로세스)와 다르다(후보 단지·본문 합성)");
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
    if ("expect" in b) sameHtml(out, b.expect, `${b.id} ${b.cond}`);
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
    sameHtml(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
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
  sameHtml(prerender[fn].legacy(...args), legacy);
  sameHtml(fragment(fn, prerender[fn].legacy)(...args), react);
});

test("news-items.mjs: legacy·JSX가 같이 쓰는 순수 모듈이고, prerender.ts가 같은 함수를 다시 내보낸다", () => {
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
    sameHtml(prerender[b.fn].legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
  }
});

test("리드·링크 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of LEAD_LINKS_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    sameHtml(react, b.expect, `${b.id} ${b.cond}`);
    sameHtml(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
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
  // escapeHtml: prerender.ts가 같은 함수를 다시 내보내고(다른 모듈의 import 호환), 래퍼 밖의 순수 도구다.
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
    sameHtml(prerender.realestateHtml.legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
  }
});

test("실거래 요약 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  const react = fragment("realestateHtml", prerender.realestateHtml.legacy);
  for (const b of REALESTATE_BRANCHES) {
    const out = react(...b.args);
    sameHtml(out, b.expect, `${b.id} ${b.cond}`);
    sameHtml(out, prerender.realestateHtml.legacy(...b.args), `${b.id} ${b.cond}`);
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
    sameHtml(prerender.realestateHtml.legacy(input), row(legacy), id);
    sameHtml(fragment("realestateHtml", prerender.realestateHtml.legacy)(input), row(react), id);
  }
});

test("realestate-rows.mjs: legacy·JSX가 같이 쓰는 순수 모듈이고, 표본 문턱은 realestate-format.mjs의 하나만 쓴다", async () => {
  // 문턱은 하나다: prerender.ts는 다시 내보낼 뿐이고(이 모듈에서 import하던 쪽의 호환), 값은 realestate-format.mjs의 것이다.
  assert.equal(MIN_SAMPLE, 5);
  assert.equal(prerender.MIN_SAMPLE, MIN_SAMPLE);
  const scripts = (await readdir(path.join(root, "scripts"))).filter((f) => /\.(?:mjs|ts)$/.test(f)); // 확장자를 .mjs 하나로 박지 않는다(#418): 개명이 전수를 조용히 줄이지 않게
  const definers = [];
  for (const f of scripts) {
    if (/^\s*(export\s+)?const\s+MIN_SAMPLE\s*=/m.test(await readFile(path.join(root, "scripts", f), "utf8"))) definers.push(f);
  }
  assert.deepEqual(definers, ["realestate-format.ts"], "MIN_SAMPLE을 정의하는 파일이 둘 이상이다");
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
    sameHtml(prerender[b.fn].legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
  }
});

test("자치구 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of DISTRICT_TABLES_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    sameHtml(react, b.expect, `${b.id} ${b.cond}`);
    sameHtml(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
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
    sameHtml(prerender[fn].legacy(...args), legacy, `${id} legacy`);
    sameHtml(fragment(fn, prerender[fn].legacy)(...args), react, `${id} react`);
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
  // 같은 모듈을 쓰므로 prerender.ts가 이 이름을 다시 내보내는 것은 CONVERSION_BAND 하나뿐이다(다른 이름은 밖에서 쓰지 않는다)
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
    if (hasExpect(b)) sameHtml(out, b.expect, `${b.id} ${b.cond}`);
    else assert.deepEqual(TABLE_NAMES(out), b.order, `${b.id} ${b.cond}`);
  }
});

test("시세표 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of REALESTATE_TABLE_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    if (hasExpect(b)) sameHtml(react, b.expect, `${b.id} ${b.cond}`);
    else assert.deepEqual(TABLE_NAMES(react), b.order, `${b.id} ${b.cond}`);
    sameHtml(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
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
  const source = await readFile(path.join(root, "scripts/realestate-table.ts"), "utf8");
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /MIN_SAMPLE|hasEnoughSample|metricOf/, "문턱을 이 모듈이 다시 부른다");
  assert.match(code, /resolveMetric\(entry, kind\)/);
  assert.doesNotMatch(code, /prerender\.(?:mjs|ts)|renderer\.(?:mjs|ts)/, "순수 모듈이 렌더러 스위치를 부른다");
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

// ---- 시세 요약 카드(#242 PR 3): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const OVERALL_ROWS = REALESTATE_OVERALL_BRANCHES;

test("시세 요약 분기 표: id가 겹치지 않고, 조각을 덮고, 모든 행에 기대값이 있다", () => {
  const ids = OVERALL_ROWS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual([...new Set(OVERALL_ROWS.map((b) => b.fn))].sort(), REALESTATE_OVERALL_FNS);
  for (const b of OVERALL_ROWS) {
    assert.ok("expect" in b, `${b.id}: 기대값이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  const toIds = new Set(REALESTATE_OVERALL_THROWS.map((b) => b.id));
  assert.equal(toIds.size, REALESTATE_OVERALL_THROWS.length, "던지는 입력 id가 겹친다");
  assert.ok(OVERALL_ROWS.length >= 500, `분기 표가 ${OVERALL_ROWS.length}행뿐이다`);
});

test("시세 요약 분기 표: 값 종류별 행이 있다 - 데이터 없음(null)·비문자열·null·undefined·특수문자·빈 값·세 보기(세 카드·종류·자치구)", () => {
  const outs = OVERALL_ROWS.map((b) => b.expect);
  const strings = outs.filter((o) => typeof o === "string");
  const has = (re) => strings.some((o) => re.test(o));
  assert.ok(outs.includes(null), "데이터 없음(null) 행이 없다");
  assert.ok(OVERALL_ROWS.some((b) => b.args[0] === null), "null 입력 행이 없다");
  assert.ok(OVERALL_ROWS.some((b) => b.args[0] === undefined), "undefined 입력 행이 없다");
  // 특수문자: 건수 글자(값은 9)와 단지·평형 칸 수 글자 자리가 이스케이프된다
  assert.ok(has(/A&amp;B &lt;i&gt; &quot;q&quot; it's건/), "건수 글자 자리의 특수문자 행이 없다");
  assert.ok(has(/단지·평형 A&amp;B &lt;i&gt; &quot;q&quot; it's칸/), "칸 수 글자 자리의 특수문자 행이 없다");
  assert.ok(has(/&amp;amp;건/) && has(/단지·평형 &amp;amp;칸/), "이미 이스케이프된 글자 행이 없다");
  assert.ok(has(/<div class="sub">건<\/div>/) || has(/ · 건<\/div>/) || has(/>건<\/div>/), "빈 글자(건수 글자가 빈 값) 행이 없다");
  assert.ok(has(/단지·평형 칸/), "칸 수 빈 문자열 행이 없다");
  assert.ok(has(/단지·평형 false칸/) && has(/단지·평형 true칸/) && has(/단지·평형 NaN칸/) && has(/단지·평형 \[object Object\]칸/) && has(/단지·평형 7칸/), "칸 수 비문자열(false·true·NaN·{}·[7]) 행이 없다");
  assert.ok(has(/>7건<\/div>/) && has(/>∞건</) && has(/>9건</), "건수 비숫자 값 행(\"9\"·[7]·Infinity)이 없다");
  // 세 보기: 세 카드(kind 없음)·종류 카드·자치구 페이지 카드가 같은 상태 표를 돈다
  for (const prefix of ["OA-S-", "OK-S-", "OD-S-", "OA-J-", "OK-J-", "OD-J-", "OA-W-", "OK-W-", "OD-W-"]) {
    assert.ok(OVERALL_ROWS.filter((b) => b.id.startsWith(prefix)).length >= 5, `${prefix} 보기 행이 모자란다`);
  }
  // 값 종류: 0·음수·소수·1억 경계·1억 이상·월세 "월 -"
  assert.ok(has(/>0만원</) && has(/>-5만원</) && has(/>124만원</) && has(/>1억원</) && has(/>2억 264만원</) && has(/월 -</), "값 종류(0·음수·소수·1억 경계·월 -) 행이 없다");
  // 서울 전체 줄·district 우선·같은 이름 첫째
  assert.ok(OVERALL_ROWS.some((b) => b.id === "OM-21") && OVERALL_ROWS.some((b) => b.id === "OM-22"));
});

test("시세 요약 분기 표: 해자 2(표본이 모자라면 값을 내지 않는다) - 건수 4건은 값이 있어도 \"-\", 5건부터 값, 전세가율은 두 쪽이 다 5건 이상일 때만; 이 조각에는 low-sample 스팬이 없다", () => {
  const byId = (id) => OVERALL_ROWS.find((b) => b.id === id);
  const held = (kind) => OVERALL_ROWS.filter((b) => b.held === kind);
  assert.ok(held("sample").length >= 60 && held("value").length >= 40 && held("absent").length >= 30, `held 행이 모자란다: ${held("sample").length}·${held("value").length}·${held("absent").length}`);
  // 표본 부족(값 6000은 있다): 세 보기마다 그 값 글자가 나오지 않는다. 자치구 페이지의 전세 상태는 매매 6000을 함께 둔 행이라 제외한다.
  const sampleRows = held("sample").filter((b) => /^(OA-[SJW]|OK-[SJW]|OD-S)-/.test(b.id) && /-n\d\d$/.test(b.id));
  assert.ok(sampleRows.length >= 60, `표본 부족 행 ${sampleRows.length}`);
  for (const b of sampleRows) {
    assert.ok(!b.expect.includes("6,000만원") && !b.expect.includes("2억 264만원"), `${b.id}: 표본 부족인데 값이 나왔다 ${b.cond}`);
    assert.ok(b.expect.includes(">-</div>"), `${b.id}: "-" 카드가 없다`);
  }
  // 문턱: 5건이 경계(n01은 값, n02는 값 없이 "-"), "5" 문자열도 같다
  assert.match(byId("OK-S-n01").expect, /6,000만원/);
  assert.doesNotMatch(byId("OK-S-n02").expect, /6,000만원/);
  assert.match(byId("OK-S-n08").expect, /6,000만원/);
  assert.doesNotMatch(byId("OK-S-n09").expect, /6,000만원/);
  assert.match(byId("OD-S-n01").expect, /6,000만원/);
  assert.doesNotMatch(byId("OD-S-n02").expect, /6,000만원/);
  assert.match(byId("OA-W-n01").expect, /2억 264만원/);
  assert.doesNotMatch(byId("OA-W-n02").expect, /2억 264만원/);
  assert.equal(MIN_SAMPLE, 5);
  // 순서: 표본 부족이든 값 없음이든 지표가 아예 없든 같은 "-"다(이유를 적지 않는다 - 예전 그대로). 순서가 갈리는 곳은 이 조각에 없다.
  assert.equal(byId("OK-S-o01").expect, byId("OK-S-n02").expect);
  assert.equal(byId("OK-S-o02").expect, byId("OK-S-z01").expect);
  assert.equal(byId("OK-S-z01").expect, '<div class="overall-card"><div class="label">서울 전체</div><div class="value">-</div></div>');
  // 전세가율 카드는 매매·전세가 모두 값을 낼 때만, 그 밑에 두 건수가 붙는다
  assert.match(byId("OR-05").expect, /<div class="sub">매매 5건 · 전세 5건<\/div>/);
  assert.doesNotMatch(byId("OR-06").expect, /전세가율/);
  assert.doesNotMatch(byId("OR-07").expect, /전세가율/);
  assert.doesNotMatch(byId("OR-08").expect, /전세가율/);
  assert.doesNotMatch(byId("OR-17").expect, /전세가율/);
  for (const b of OVERALL_ROWS) assert.ok(typeof b.expect !== "string" || !b.expect.includes("low-sample"), `${b.id}: 이 조각에는 low-sample 스팬이 없다`);
});

test("시세 요약 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다)", () => {
  for (const b of OVERALL_ROWS) sameHtml(prerender[b.fn].legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
});

test("시세 요약 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of OVERALL_ROWS) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    sameHtml(react, b.expect, `${b.id} ${b.cond}`);
    sameHtml(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("시세 요약 분기 표: 같은 입력을 두 번 넣어도 같고 입력을 바꾸지 않는다", async () => {
  const fragment = makeFragment(await createReactRenderer());
  const snap = (args) => JSON.stringify(args, (_, v) => (v === undefined ? "(undefined)" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
  for (const b of OVERALL_ROWS) {
    const before = snap(b.args);
    const react = fragment(b.fn, prerender[b.fn].legacy);
    assert.equal(react(...b.args), react(...b.args), b.id);
    prerender[b.fn].legacy(...b.args);
    assert.equal(snap(b.args), before, `${b.id}: 입력이 바뀌었다`);
  }
});

test("시세 요약 조각: 예전 코드가 던지는 입력은 legacy도 React 조각도 같이 던진다(조용히 빈 카드를 내지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  assert.equal(REALESTATE_OVERALL_THROWS.length, 20);
  for (const b of REALESTATE_OVERALL_THROWS) {
    assert.throws(() => prerender[b.fn].legacy(...b.args), TypeError, `${b.id} legacy ${b.cond}`);
    assert.throws(() => fragment(b.fn, prerender[b.fn].legacy)(...b.args), TypeError, `${b.id} react ${b.cond}`);
  }
});

test("시세 요약 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(데이터 없음은 null)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const spy = () => (called++, "legacy");
  for (const none of [null, undefined, {}, { districts: [] }, { overall: null }]) assert.equal(fragment("realestateOverallHtml", spy)(none), null);
  assert.equal(fragment("realestateOverallHtml", spy)({ districts: [{ name: "중구" }] }, null, "종로구"), null);
  assert.ok(fragment("realestateOverallHtml", spy)({ overall: {} }).startsWith('<div class="overall-card">'));
  assert.equal(called, 0);
});

test("realestate-overall.mjs: legacy·JSX가 같이 쓰는 순수 모듈이다 - 카드 모양·글자 규칙·ratioBasis", () => {
  const sale = { avgPricePerPyeong10k: 6000, transactionCount: 40 };
  const jeonse = { avgDepositPerPyeong10k: 3000, transactionCount: 30 };
  const seg = (text, esc) => ({ text, esc });
  // 데이터 없음
  assert.equal(overallCards(null), null);
  assert.equal(overallCards({ districts: [{ name: "가" }] }), null);
  assert.equal(overallCards({ overall: {} }, null, "가"), null);
  // 카드 모양: 라벨(상수)·값 조각·부가 조각(없으면 null)
  assert.deepEqual(overallCards({ overall: { sale } }, "sale"), [
    { label: "평당가", value: [seg("6,000만원", false)], sub: null },
    { label: "84㎡ 환산", value: [seg("15억 2,459만원", false)], sub: null },
    { label: "거래건수", value: [seg("40건", true)], sub: null },
  ]);
  assert.deepEqual(overallCards({ overall: { sale, jeonse } }, null)[0], {
    label: "매매 평당가",
    value: [seg("6,000만원", false)],
    sub: [seg("84㎡ 환산", true), seg(" 15억 2,459만원 · ", false), seg("40건", true)],
  });
  assert.deepEqual(overallCards({ overall: {} }), [
    { label: "매매 평당가", value: [seg("-", false)], sub: null },
    { label: "전세 평당 보증금", value: [seg("-", false)], sub: null },
    { label: "월세 보증금 / 월세", value: [seg("-", false)], sub: null },
  ]);
  assert.deepEqual(overallCards({ overall: { sale, jeonse } }, "jeonse", null, { median: 46.7, cells: 13 }).map((c) => c.label), ["평당 보증금", "84㎡ 환산", "전세가율", "전세가율 단지별 중앙값", "거래건수"]);
  assert.deepEqual(overallCards({ overall: { sale, jeonse } }, "jeonse")[2], { label: "전세가율", value: [seg("50.0%", false)], sub: [seg("매매 40건 · 전세 30건", true)] });
  assert.deepEqual(overallCards({ districts: [{ name: "가", sale }] }, null, "가", { median: 46.7, cells: 1234 }).at(-1), {
    label: "전세가율 단지별 중앙값",
    value: [seg("46.7%", false)],
    sub: [seg("단지·평형 1,234칸", true)],
  });
  // 마크업은 만들지 않는다: 클래스·태그는 쓰는 쪽(legacy·JSX)이 각자 입힌다
  const json = JSON.stringify(overallCards({ overall: { sale, jeonse } }, "jeonse", null, { median: 46.7, cells: 13 }));
  assert.doesNotMatch(json, /overall-card|class|<div|<span/);
  // ratioBasis: 두 지표가 값을 낼 때 두 건수를 한 줄로(이스케이프하지 않은 글자)
  assert.equal(ratioBasis({ sale, jeonse }), "매매 40건 · 전세 30건");
  assert.equal(ratioBasis({ sale: { ...sale, transactionCount: 1234567 }, jeonse: { ...jeonse, transactionCount: "9" } }), "매매 1,234,567건 · 전세 9건");
  assert.throws(() => ratioBasis({ sale }), TypeError, "전세 지표가 없으면 던진다(예전 그대로 - jeonseRatio가 null일 때는 부르지 않는다)");
  assert.throws(() => ratioBasis({}), TypeError);
});

test("realestate-overall.mjs: 표본 문턱을 정의하거나 다시 적용하지 않고, 클래스·마크업을 들고 있지 않다 - resolveMetric(realestate-format.mjs)이 한 곳에서 정한다", async () => {
  const source = await readFile(path.join(root, "scripts/realestate-overall.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /MIN_SAMPLE|hasEnoughSample|metricOf/, "문턱을 이 모듈이 다시 부른다");
  assert.match(code, /resolveMetric\(overall, "sale"\)/);
  assert.match(code, /jeonseRatio\(overall\)/);
  assert.doesNotMatch(code, /prerender\.(?:mjs|ts)|renderer\.(?:mjs|ts)/, "순수 모듈이 렌더러 스위치를 부른다");
  assert.doesNotMatch(code, /overall-card|"label"|"value"|"sub"|<div|escapeHtml/, "순수 모듈이 마크업·클래스를 들고 있다 - 한 곳의 오타를 같은 실행 비교가 못 잡는다");
  // 문턱 정의는 realestate-format.mjs 하나다
  assert.equal(hasEnoughSample({ transactionCount: 5 }), true);
  assert.equal(hasEnoughSample({ transactionCount: 4 }), false);
  // 단지별 중앙값의 칸 수 문턱은 빌더(complex-ratio.mjs spreadOf)가 이미 적용한다 - 이 모듈은 다시 적용하지 않는다(10칸 미만도 spread가 오면 그대로 낸다)
  assert.equal(overallCards({ overall: {} }, "jeonse")[0].label, "서울 전체");
  assert.equal(overallCards({ districts: [{ name: "가" }] }, null, "가", { median: 1, cells: 3 }).at(-1).sub[0].text, "단지·평형 3칸");
});

test("realestate-overall.mjs: 이스케이프 없이 문자열에 끼우는 조각(esc=false)의 글자에는 & < > \"가 들 수 없다 - 난수 입력 3만 건(고정 시드)", () => {
  // 입력 값 자리마다 특수문자·비문자열·null·undefined를 섞는다. 입력 글자는 건수·칸 수뿐이고 전부 esc=true 자리다(이스케이프 한다). esc=false는 숫자 서식 글자와 코드 상수 구분자다.
  let seed = 20261012;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const STR = ["", "a", "종로구", `A&B <i> "q" it's`, "&amp;", "&#x27;", "5", "9", "x", "</td><td>", "\ud800", "1,2"];
  const ODD = [false, true, 0, 1, -1, 7, 4, 5, 6, 4.5, 1380.5, NaN, Infinity, -Infinity, {}, [], [1, 2], [7], null, undefined, { valueOf: () => 9, toLocaleString: () => `A&B <i> "q" it's` }];
  const NUM = [0, 1, 3, 4, 5, 6, 40, 684, 1234567, -3, 6000, 3000, 20264, 123.5];
  const v = () => (rnd() < 0.5 ? pick(NUM) : rnd() < 0.5 ? pick(STR) : pick(ODD));
  const metric = (f) => {
    const r = rnd();
    if (r < 0.1) return pick([undefined, null, 0, "", false, 5, "x", true, [], {}]);
    const m = {};
    if (rnd() < 0.9) m.transactionCount = rnd() < 0.6 ? pick([4, 5, 6, 30, 40, 684]) : v();
    if (rnd() < 0.9) m[f] = rnd() < 0.6 ? pick(NUM) : v();
    if (f === "avgDeposit10k" && rnd() < 0.9) m.avgMonthlyRent10k = v();
    return m;
  };
  const entry = () => ({ name: v(), sale: metric("avgPricePerPyeong10k"), jeonse: metric("avgDepositPerPyeong10k"), wolse: metric("avgDeposit10k") });
  const spreadOf = () => pick([null, undefined, 0, { median: v(), cells: v() }, { median: v(), cells: pick([13, 1173, 20]) }, { median: 46.7, cells: v() }]);
  const LABELS = new Set(Object.values(RE_LABELS));
  let rawSegs = 0;
  let escSegs = 0;
  let cardsTotal = 0;
  for (let i = 0; i < 30000; i++) {
    const e = entry();
    const kind = pick([null, "sale", "jeonse", "wolse", "foo"]);
    const district = rnd() < 0.3 ? "가" : null;
    const spread = spreadOf();
    let cards;
    try {
      cards = overallCards({ overall: e, districts: [{ ...e, name: "가" }] }, kind, district, spread);
    } catch (err) {
      assert.ok(err instanceof TypeError); // spread.cells가 null·undefined면 예전 코드도 던진다
      continue;
    }
    for (const card of cards) {
      cardsTotal++;
      assert.ok(LABELS.has(card.label), `라벨이 상수가 아니다: ${card.label}`);
      for (const s of [...card.value, ...(card.sub ?? [])]) {
        assert.equal(typeof s.text, "string");
        if (s.esc) escSegs++;
        else {
          rawSegs++;
          assert.doesNotMatch(s.text, /[&<>"]/, `raw 조각 글자에 특수문자가 있다: ${JSON.stringify(s)}`);
        }
      }
      if (card.sub) assert.ok(card.sub.length > 0 && card.sub.some((s) => s.text !== ""), "sub는 비어 있지 않다(legacy의 `sub ? … : \"\"` 판정과 같다)");
    }
  }
  assert.ok(rawSegs > 30000 && escSegs > 10000 && cardsTotal > 60000, `raw ${rawSegs}·esc ${escSegs}·카드 ${cardsTotal} - 입력이 조각 자리를 거의 밟지 않았다`);
});

// ---- 예산대 잎 조각 8개(#243 PR A): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const LEAF_ROWS = BUDGET_LEAVES_BRANCHES;
const LEAF_FNS = ["budgetAnswersHtml", "budgetCapHtml", "budgetCostsHtml", "budgetFactsHtml", "budgetLoanHtml", "budgetMinCashHtml", "budgetMoreHtml", "budgetPolicyHtml"];

test("예산대 잎 분기 표: id가 겹치지 않고, 여덟 조각을 모두 덮고, 모든 행에 기대값이 있다", () => {
  const ids = LEAF_ROWS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual(BUDGET_LEAVES_FNS, LEAF_FNS);
  assert.deepEqual([...new Set(LEAF_ROWS.map((b) => b.fn))].sort(), LEAF_FNS);
  for (const b of LEAF_ROWS) {
    assert.ok("expect" in b && typeof b.expect === "string", `${b.id}: 기대값이 문자열이 아니다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  const toIds = BUDGET_LEAVES_THROWS.map((b) => b.id);
  assert.equal(new Set(toIds).size, toIds.length, "던지는 입력 id가 겹친다");
  assert.ok(LEAF_ROWS.length >= 500, `분기 표가 ${LEAF_ROWS.length}행뿐이다`);
  // 금리 인자가 한국은행 평균금리 { rate, month } 로 바뀌어(#577) 옛 금리 모양에서 던지던 12행(AN-T01~05·LO-T01~07)이 "읽지 않는다" 행(AN-O·LO-O)이 됐다.
  assert.equal(BUDGET_LEAVES_THROWS.length, 5);
});

test("예산대 잎 분기 표: 빈 결과는 null이 아니라 빈 문자열(\"\")이고 엄격 비교로 고정한다 - 조각마다 빈 문자열 행이 있다", () => {
  // 자리표시 치환(applyPrerender)에서 null은 틀의 내용을 그대로 두고 ""는 비운다 - 둘은 다르다. 이 조각 여덟은 null을 내지 않는다(budgetBodyHtml만 null이다, PR B).
  for (const fn of LEAF_FNS) {
    const outs = LEAF_ROWS.filter((b) => b.fn === fn);
    if (fn === "budgetMoreHtml") {
      assert.ok(outs.every((b) => b.expect.startsWith('<section class="budget-more-links" data-prerendered="">')), "budgetMoreHtml은 항상 같은 절이다(빈 결과가 없다)");
      continue;
    }
    assert.ok(outs.filter((b) => b.expect === "").length >= 10, `${fn}: 빈 문자열 행이 모자란다`);
  }
  for (const b of LEAF_ROWS.filter((r) => r.expect === "")) {
    assert.strictEqual(prerender[b.fn].legacy(...b.args), "", `${b.id} legacy ${b.cond}`);
    assert.notStrictEqual(prerender[b.fn].legacy(...b.args), null, b.id);
  }
  assert.ok(LEAF_ROWS.every((b) => b.expect !== null), "기대값이 null인 행이 있다 - 이 조각들은 null을 내지 않는다");
});

test("예산대 잎 분기 표: 값 종류별 행이 있다 - 비문자열·null·undefined·특수문자·이미 이스케이프된 글자·빈 값·경계", () => {
  // 입력(args)을 끝까지 걸어 값의 종류를 센다: 조각마다 이 종류가 모두 한 번 이상 입력 자리에 들어간다.
  const kinds = (v, out = new Set()) => {
    if (v === null) out.add("null");
    else if (v === undefined) out.add("undefined");
    else if (typeof v === "boolean") out.add(String(v));
    else if (typeof v === "number") out.add(Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === 0 ? "0" : "number");
    else if (typeof v === "string") out.add(v === "" ? "빈 문자열" : v === "&amp;" ? "이미 이스케이프" : v.includes("&") && v.includes("<") && v.includes('"') ? "특수문자" : "문자열");
    else if (Array.isArray(v)) {
      out.add(v.length ? "배열" : "빈 배열");
      v.forEach((x) => kinds(x, out));
    } else if (typeof v === "object") {
      out.add(Object.keys(v).length ? "객체" : "빈 객체");
      Object.values(v).forEach((x) => kinds(x, out));
    }
    return out;
  };
  const NEED = ["null", "undefined", "true", "false", "0", "NaN", "Infinity", "number", "빈 문자열", "이미 이스케이프", "특수문자", "문자열", "빈 배열", "배열", "빈 객체", "객체"];
  for (const fn of LEAF_FNS) {
    const seen = new Set();
    for (const b of LEAF_ROWS.filter((r) => r.fn === fn)) kinds(b.args, seen);
    for (const k of NEED) assert.ok(seen.has(k), `${fn}: 입력 값 종류 '${k}' 행이 없다`);
  }
  const argsOf = (fn) => LEAF_ROWS.filter((b) => b.fn === fn).map((b) => b.args);
  for (const fn of LEAF_FNS.filter((f) => f !== "budgetMoreHtml")) {
    assert.ok(argsOf(fn).some((a) => a[0] === null), `${fn}: null 입력 행이 없다`);
    assert.ok(argsOf(fn).some((a) => a[0] === undefined), `${fn}: undefined 입력 행이 없다`);
    if (fn !== "budgetFactsHtml") assert.ok(argsOf(fn).some((a) => a[0]?.min10k === "50000"), `${fn}: 숫자 문자열 행이 없다`);
  }
  assert.ok(argsOf("budgetFactsHtml").some((a) => a[0]?.facts?.standard?.count === "1234567"), "budgetFactsHtml: 숫자 문자열 행이 없다");
  // 특수문자가 글자로 나오는 자리: 상한 문장의 통계 값·한눈에 이야기의 장소·구 이름·건수·연수·언어. 이스케이프는 legacy(escapeHtml)와 React가 같고 ' 만 래퍼가 되돌린다.
  const outs = (fn) => LEAF_ROWS.filter((b) => b.fn === fn).map((b) => b.expect);
  assert.ok(outs("budgetCapHtml").some((o) => /A&amp;B &lt;i&gt; &quot;q&quot; it's/.test(o)), "상한: 특수문자 행이 없다");
  assert.ok(outs("budgetCapHtml").some((o) => o.includes("&amp;amp;") && o.includes("&amp;#x27;")), "상한: 이미 이스케이프된 글자 행이 없다");
  assert.ok(outs("budgetFactsHtml").some((o) => /A&amp;B &lt;i&gt; &quot;q&quot; it's/.test(o)) && outs("budgetFactsHtml").some((o) => o.includes("&amp;amp;")), "이야기: 특수문자 행이 없다");
  assert.ok(outs("budgetFactsHtml").some((o) => o.includes("[object Object]")) && outs("budgetFactsHtml").some((o) => o.includes("NaN%")) && outs("budgetFactsHtml").some((o) => o.includes("false건")), "이야기: 비문자열 글자 행이 없다");
  assert.ok(outs("budgetCapHtml").some((o) => o.includes("[object Object]")) && outs("budgetCapHtml").some((o) => o.includes("undefined")) && outs("budgetCapHtml").some((o) => o.includes("1,2")), "상한: 비문자열 글자 행이 없다");
  // 경계: 정책대출 3~9억대 양끝·밖, 상한 14·15·16~24 양끝·밖, 취득세 6·9억 경계, 중개보수 구간, 소형·대형·오래됨·새것·직거래 모두, 생애최초 감면 12억 경계, 천장이 같아지는 15억
  assert.ok(["PO-B3", "PO-B9", "PO-O2", "PO-O10", "PO-O3.5"].every((id) => LEAF_ROWS.some((b) => b.id === id)), "정책대출 경계 행이 없다");
  assert.ok(["CP-14a", "CP-15a", "CP-H16.0", "CP-H24.0", "CP-O245000", "CP-O159900"].every((id) => LEAF_ROWS.some((b) => b.id === id)), "상한 경계 행이 없다");
  assert.ok(["MC-B11", "MC-B12", "MC-B15", "MC-B25", "MC-B-10", "MC-B-0.5"].every((id) => LEAF_ROWS.some((b) => b.id === id)), "최소 현금 경계 행이 없다");
  assert.ok(["CO-B5", "CO-B6", "CO-B8", "CO-B9", "CO-B1.5", "CO-B0", "CO-B11", "CO-B12", "CO-B14", "CO-B15"].every((id) => LEAF_ROWS.some((b) => b.id === id)), "부대비용 경계 행이 없다");
  assert.ok(["FA-S-smallko", "FA-S-largeko", "FA-S-oldko", "FA-S-freshko", "FA-S-directko", "FA-S-spanen", "FA-S-stden"].every((id) => LEAF_ROWS.some((b) => b.id === id)), "이야기 문장 행이 없다");
  assert.ok(["LO-B12", "LO-B13"].every((id) => LEAF_ROWS.some((b) => b.id === id)), "대출 상한 경계 행이 없다");
});

test("예산대 잎 분기 표: 해자 2 - 표본 문턱·low-sample 스팬이 이 조각들에는 없다(문턱은 빌더가 데이터 칸에 이미 반영), 렌더 때 정하는 것은 예산대 구간과 글자뿐", () => {
  for (const b of LEAF_ROWS) assert.ok(!b.expect.includes("low-sample") && !b.expect.includes("표본 부족"), `${b.id}: 이 조각에는 low-sample 스팬이 없다`);
  // 정책대출 건수(policyCounts.n)는 있는지만 본다: 건수 값이 얼마든 문장은 같고(건수 문장은 method.html로 갔다), 거짓이면 문단 전체가 없다
  const sevens = LEAF_ROWS.filter((b) => b.id.startsWith("PO-N") && b.expect !== "");
  assert.ok(sevens.length >= 10);
  assert.equal(new Set(sevens.map((b) => b.expect)).size, 1, "건수 값이 문장을 바꾼다");
  assert.ok(LEAF_ROWS.filter((b) => b.id.startsWith("PO-N") && b.expect === "").length >= 10);
  // 몰림 통계(capStats)는 빌더 clustering(minEach 100)이 이미 걸렀다: null이면 몰림 문장이 없고 있으면 그대로 싣는다
  assert.ok(!LEAF_ROWS.find((b) => b.id === "CP-14b").expect.includes("대책 뒤"));
  assert.ok(LEAF_ROWS.find((b) => b.id === "CP-14a").expect.includes("대책 뒤(2025-10-16~)"));
  // 예산대 이야기(facts)의 문턱(MIN_DEALS 120·STANDARD_MIN_DEALS 30)은 빌더 budgetFacts가 적용한다: 조각은 facts에 있는 것만 말한다(건수가 1건이어도 그대로 싣는다)
  assert.ok(LEAF_ROWS.find((b) => b.id === "FA-S-fewko").expect.includes("5건뿐"));
});

test("예산대 잎 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다, 엄격 비교)", () => {
  for (const b of LEAF_ROWS) sameHtmlStrict(prerender[b.fn].legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
});

test("예산대 잎 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나) - 빈 결과도 null이 아니라 \"\"", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of LEAF_ROWS) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    sameHtmlStrict(react, b.expect, `${b.id} ${b.cond}`);
    sameHtmlStrict(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("예산대 잎 분기 표: 같은 입력을 두 번 넣어도 같고 입력을 바꾸지 않는다", async () => {
  const fragment = makeFragment(await createReactRenderer());
  const snap = (args) => JSON.stringify(args, (_, v) => (v === undefined ? "(undefined)" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
  for (const b of LEAF_ROWS) {
    const before = snap(b.args);
    const react = fragment(b.fn, prerender[b.fn].legacy);
    assert.equal(react(...b.args), react(...b.args), b.id);
    prerender[b.fn].legacy(...b.args);
    assert.equal(snap(b.args), before, `${b.id}: 입력이 바뀌었다`);
  }
});

test("예산대 잎 조각: 예전 코드가 던지는 입력은 legacy도 React 조각도 같이 던진다(조용히 빈 문단을 내지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of BUDGET_LEAVES_THROWS) {
    assert.throws(() => prerender[b.fn].legacy(...b.args), TypeError, `${b.id} legacy ${b.cond}`);
    assert.throws(() => fragment(b.fn, prerender[b.fn].legacy)(...b.args), TypeError, `${b.id} react ${b.cond}`);
  }
});

test("예산대 잎 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(빈 결과는 null이 아니라 빈 문자열)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const spy = () => (called++, "legacy");
  for (const fn of LEAF_FNS.filter((f) => f !== "budgetMoreHtml")) {
    assert.strictEqual(fragment(fn, spy)(null, null), "", fn);
    assert.strictEqual(fragment(fn, spy)(), "", fn);
  }
  assert.ok(fragment("budgetMoreHtml", spy)().startsWith('<section class="budget-more-links" data-prerendered="">'));
  assert.ok(fragment("budgetMinCashHtml", spy)({ min10k: 70_000 }).startsWith('<p class="budget-loan budget-mincash" data-prerendered="">'));
  assert.equal(called, 0);
});

// ---- 예산대 후보 단지·본문 합성(#243 PR B): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const CB_ROWS = BUDGET_CB_BRANCHES;
const CB_FNS = ["budgetBodyHtml", "budgetCandidatesHtml"];

test("후보 단지·본문 분기 표: id가 겹치지 않고, 두 조각을 모두 덮고, 모든 행에 기대값이 있다", () => {
  const ids = CB_ROWS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual(BUDGET_CB_FNS, CB_FNS);
  assert.deepEqual([...new Set(CB_ROWS.map((b) => b.fn))].sort(), CB_FNS);
  for (const b of CB_ROWS) {
    assert.ok(b.expect === null ? b.fn === "budgetBodyHtml" && b.nullOut === true : typeof b.expect === "string", `${b.id}: 기대값이 문자열도 (본문의) null도 아니다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
  const toIds = BUDGET_CB_THROWS.map((b) => b.id);
  assert.equal(new Set(toIds).size, toIds.length, "던지는 입력 id가 겹친다");
  assert.ok(CB_ROWS.length >= 180, `분기 표가 ${CB_ROWS.length}행뿐이다`);
  // BO-T19(옛 금리 모양에서 던짐)는 #577 에서 "읽지 않는다" 행 BO-K12 가 됐다.
  assert.equal(BUDGET_CB_THROWS.length, 33);
});

test("후보 단지·본문 분기 표: 빈 결과 계약 - 후보 단지는 \"\"(null 아님), 본문은 예산대가 없을 때만 null(\"\" 아님)이고 엄격 비교로 고정한다", () => {
  // 본문이 하위 조각의 반환값을 이어 붙이는 자리(legacy `+`)에 null이 들어가면 글자 "null"이 박힌다 - 그래서 잎(후보 단지 포함)은 null을 내지 않는다.
  const cands = CB_ROWS.filter((b) => b.fn === "budgetCandidatesHtml");
  assert.ok(cands.filter((b) => b.expect === "").length >= 18, "후보 단지의 빈 문자열 행이 모자란다");
  for (const b of cands) assert.ok(b.expect !== null, `${b.id}: 후보 단지 조각은 null을 내지 않는다`);
  const nulls = CB_ROWS.filter((b) => b.expect === null);
  assert.ok(nulls.length >= 7 && nulls.every((b) => b.fn === "budgetBodyHtml"), "본문의 null 행이 모자라거나 다른 조각에 null이 있다");
  for (const b of CB_ROWS.filter((r) => r.fn === "budgetBodyHtml" && r.expect !== null)) assert.ok(b.expect.length > 500, `${b.id}: 본문이 비어 있다`);
  for (const b of CB_ROWS.filter((r) => r.expect === "")) {
    assert.strictEqual(prerender[b.fn].legacy(...b.args), "", `${b.id} legacy ${b.cond}`);
    assert.notStrictEqual(prerender[b.fn].legacy(...b.args), null, b.id);
  }
  for (const b of nulls) {
    assert.strictEqual(prerender[b.fn].legacy(...b.args), null, `${b.id} legacy ${b.cond}`);
    assert.notStrictEqual(prerender[b.fn].legacy(...b.args), "", b.id);
  }
});

test("후보 단지·본문 분기 표: 값 종류별 행이 있다 - 비문자열·null·undefined·특수문자·작은따옴표·이미 이스케이프된 글자·빈 값·경계", () => {
  const kinds = (v, out = new Set(), depth = 0) => {
    if (depth > 8) return out;
    if (v === null) out.add("null");
    else if (v === undefined) out.add("undefined");
    else if (typeof v === "boolean") out.add(String(v));
    else if (typeof v === "number") out.add(Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === 0 ? "0" : "number");
    else if (typeof v === "string") out.add(v === "" ? "빈 문자열" : v === "&amp;" ? "이미 이스케이프" : v.includes("&") && v.includes("<") && v.includes('"') ? "특수문자" : "문자열");
    else if (Array.isArray(v)) {
      out.add(v.length ? "배열" : "빈 배열");
      for (const x of v.slice(0, 40)) kinds(x, out, depth + 1);
    } else if (typeof v === "object") {
      out.add(Object.keys(v).length ? "객체" : "빈 객체");
      for (const x of Object.values(v).slice(0, 40)) kinds(x, out, depth + 1);
    }
    return out;
  };
  const NEED = ["null", "undefined", "true", "false", "0", "NaN", "number", "빈 문자열", "이미 이스케이프", "특수문자", "문자열", "빈 배열", "배열", "빈 객체", "객체"];
  for (const fn of CB_FNS) {
    const seen = new Set();
    for (const b of CB_ROWS.filter((r) => r.fn === fn)) kinds(b.args, seen);
    for (const k of NEED) assert.ok(seen.has(k), `${fn}: 입력 값 종류 '${k}' 행이 없다`);
  }
  const outs = (fn) => CB_ROWS.filter((b) => b.fn === fn && typeof b.expect === "string").map((b) => b.expect);
  // 작은따옴표 단지(역삼I'PARK): 글자·주소 모두 그대로(legacy), React는 &#x27;로 내고 래퍼가 되돌린다 - 후보 줄과 거래 줄 둘 다
  assert.ok(outs("budgetCandidatesHtml").some((o) => o.includes(">역삼I'PARK</a>") && o.includes("apt=%EC%97%AD%EC%82%BCI'PARK")), "후보: 작은따옴표 단지 행이 없다");
  assert.ok(outs("budgetBodyHtml").some((o) => o.includes("역삼I'PARK</span>")), "본문 거래 줄: 작은따옴표 단지 행이 없다");
  assert.ok(outs("budgetCandidatesHtml").some((o) => /A&amp;B &lt;i&gt; &quot;q&quot; it's<\/a>/.test(o) && o.includes("apt=A%26B%20%3Ci%3E%20%22q%22%20it's")), "후보: 특수문자 단지 행이 없다");
  assert.ok(outs("budgetCandidatesHtml").some((o) => o.includes("&amp;amp;</a>")), "후보: 이미 이스케이프된 단지 행이 없다");
  assert.ok(outs("budgetBodyHtml").some((o) => o.includes("A&amp;B &lt;i&gt; &quot;q&quot; it's &amp;amp; &amp;#x27;")), "본문 거래 줄: 특수문자 행이 없다");
  assert.ok(outs("budgetBodyHtml").some((o) => o.includes("false 300 ·  200 · [object Object] 100")), "본문: 비문자열 구 이름 행이 없다");
  // 경계: 어디로 가는가 0.5·10개 구, 후보 12·13곳, 평형 경계 59.99·60·85·85.01, 예산대 하한 포함·상한 제외
  for (const id of ["BO-G02", "BO-G03", "BO-G04", "BO-G05", "BO-G12", "CA-F12", "CA-F13", "CA-F-AREA", "CA-N16", "CA-F-BIG", "CA-F14", "CA-F85"]) assert.ok(CB_ROWS.some((b) => b.id === id), `경계 행 ${id}이 없다`);
});

test("후보 단지·본문 분기 표: 해자 2 - 표본 문턱·low-sample 스팬이 이 조각들에는 없다(문턱은 빌더가 데이터 칸에 이미 반영, 어디로 가는가의 0.5·10개 구는 문장 선택 문턱)", () => {
  for (const b of CB_ROWS.filter((r) => typeof r.expect === "string")) assert.ok(!b.expect.includes("low-sample") && !b.expect.includes("표본 부족"), `${b.id}: 이 조각에는 low-sample 스팬이 없다`);
  // 렌더 때 n(같은 평형 거래 수)을 거르지 않는다: n이 1이어도 중앙값이 범위에 들면 후보다(빌더가 이미 3 미만 칸을 만들지 않는다)
  assert.ok(CB_ROWS.find((b) => b.id === "CA-W12").expect.includes("· 1건"));
  // 어디로 가는가: 정확히 0.5는 몰렸다, 0.49는 구 10개 이상일 때만 흩어졌다
  assert.ok(CB_ROWS.find((b) => b.id === "BO-G02").expect.includes("거래의 50%가"));
  assert.ok(CB_ROWS.find((b) => b.id === "BO-G03").expect.includes("10개 구에 흩어져"));
  assert.ok(!CB_ROWS.find((b) => b.id === "BO-G04").expect.includes("budget-where"));
});

test("후보 단지·본문 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다, 엄격 비교)", () => {
  for (const b of CB_ROWS) sameHtmlStrict(prerender[b.fn].legacy(...b.args), b.expect, `${b.id} ${b.cond}`);
});

test("후보 단지·본문 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나) - 후보 단지의 빈 결과는 \"\", 본문은 null", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of CB_ROWS) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    sameHtmlStrict(react, b.expect, `${b.id} ${b.cond}`);
    sameHtmlStrict(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("후보 단지·본문 분기 표: 같은 입력을 두 번 넣어도 같고 입력을 바꾸지 않는다", async () => {
  const fragment = makeFragment(await createReactRenderer());
  const snap = (args) => JSON.stringify(args, (_, v) => (v === undefined ? "(undefined)" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "(fn)" : v));
  for (const b of CB_ROWS) {
    const before = snap(b.args);
    const react = fragment(b.fn, prerender[b.fn].legacy);
    assert.equal(react(...b.args), react(...b.args), b.id);
    prerender[b.fn].legacy(...b.args);
    assert.equal(snap(b.args), before, `${b.id}: 입력이 바뀌었다`);
  }
});

test("후보 단지·본문 조각: 예전 코드가 던지는 입력은 legacy도 React 조각도 같은 오류로 던진다(조용히 빈 본문을 내지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of BUDGET_CB_THROWS) {
    const ErrorClass = globalThis[b.error];
    assert.throws(() => prerender[b.fn].legacy(...b.args), ErrorClass, `${b.id} legacy ${b.cond}`);
    assert.throws(() => fragment(b.fn, prerender[b.fn].legacy)(...b.args), ErrorClass, `${b.id} react ${b.cond}`);
  }
});

test("후보 단지·본문 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(후보 단지의 빈 결과는 빈 문자열, 본문은 null)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const spy = () => (called++, "legacy");
  assert.strictEqual(fragment("budgetCandidatesHtml", spy)(null, null), "");
  assert.strictEqual(fragment("budgetCandidatesHtml", spy)(), "");
  assert.strictEqual(fragment("budgetBodyHtml", spy)(null), null);
  assert.strictEqual(fragment("budgetBodyHtml", spy)(), null);
  assert.ok(norm(fragment("budgetBodyHtml", spy)({ min10k: 30_000, max10k: 40_000, count: 5, deals: [] })).startsWith(norm('<p class="budget-summary">3억대에서 5건이 거래됐습니다.</p>')));
  assert.equal(called, 0);
});

test("후보 단지·본문: 알려진 차이(허용 변환 아님) - 구 건수가 & < > \" 가 든 문자열일 때만 legacy는 raw로, React는 이스케이프해서 낸다(실데이터는 전부 숫자라 닿지 않는다)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const d of BUDGET_BODY_KNOWN_DIFFS) {
    const legacy = prerender[d.fn].legacy(...d.args);
    const react = fragment(d.fn, prerender[d.fn].legacy)(...d.args);
    // 알려진 차이 목록(#277 범위 3)은 그대로다. 비교만 내용 비교로 간다 - 찾는 글자(d.legacy·d.react)에도 class가 들어 있어서 양쪽 다 정규화한다.
    assert.ok(norm(legacy).includes(norm(d.legacy)), `${d.id} legacy 글자 ${d.cond}`);
    assert.ok(norm(react).includes(norm(d.react)), `${d.id} react 글자 ${d.cond}`);
    assert.notEqual(norm(legacy), norm(react), `${d.id}: 차이가 사라졌다 - 표를 고친다`);
    // 이 한 자리(지역 줄의 건수) 말고는 같다: 서로의 차이 글자를 바꿔 끼우면 같은 출력이 된다
    assert.equal(norm(legacy).replace(norm(d.legacy), norm(d.react)), norm(react), `${d.id}: 다른 자리도 다르다`);
  }
});

test("budget-fragments.mjs: 후보 단지·본문 모양 - 거래 한 줄·월/일·어디로 가는가·후보 단지·본문 앞부분(순수 모듈)", () => {
  assert.equal(CANDIDATE_LIST, 12);
  // budgetWhen
  assert.equal(budgetWhen("2026-09-05"), "9/5");
  assert.equal(budgetWhen("2026-12-31"), "12/31");
  for (const bad of [null, undefined, "", "2026", "2026-09", "2026-09-", 20260905, true, {}, []]) assert.equal(budgetWhen(bad), "", JSON.stringify(bad));
  assert.equal(budgetWhen("2026-ab-cd"), "NaN/NaN");
  // dealShape: 네 칸이 모두 문자열이다(legacy가 escapeHtml에 넘기던 값)
  assert.deepEqual(dealShape({ district: "노원구", dong: "상계동", apt: "A", area: 84.97, floor: 12, date: "2026-09-05", amount10k: 75_000 }), { place: "노원구 상계동 A", spec: "84.97㎡ · 12층", when: "9/5", price: "7억 5,000만원" });
  assert.deepEqual(dealShape({}), { place: "", spec: "undefined㎡", when: "", price: "-" });
  for (const v of Object.values(dealShape({ district: {}, area: [1, 2], floor: true, date: 5, amount10k: "1" }))) assert.equal(typeof v, "string");
  assert.throws(() => dealShape(null), TypeError);
  assert.throws(() => dealShape(undefined), TypeError);
  // whereText: 경계 0.5·10개 구(문장 선택 문턱, 표본 문턱이 아니다)
  const d = (...counts) => counts.map((count, i) => ({ name: `구${i + 1}`, count }));
  assert.equal(whereText({ count: 100, districts: d(20, 15, 15) }), "NaN억대 거래의 50%가 구1·구2·구3 세 곳에서 나왔습니다. 이 예산으로 서울에서 고를 수 있는 곳은 사실상 여기입니다.".replace("NaN억 대", "").replace("NaN억대", "NaN억대"), "예산대 이름이 NaN이어도 문장은 낸다");
  assert.equal(whereText({ min10k: 30_000, max10k: 40_000, count: 100, districts: d(20, 15, 15) }), "3억대 거래의 50%가 구1·구2·구3 세 곳에서 나왔습니다. 이 예산으로 서울에서 고를 수 있는 곳은 사실상 여기입니다.");
  assert.equal(whereText({ min10k: 30_000, max10k: 40_000, count: 100, districts: d(20, 15, 14, 7, 7, 7, 7, 7, 7, 7) }), "3억대 거래는 10개 구에 흩어져 있고 상위 세 곳(구1·구2·구3)을 합쳐도 49%입니다. 이 예산에서는 지역이 아니라 단지가 선택을 가릅니다.");
  assert.equal(whereText({ min10k: 30_000, max10k: 40_000, count: 100, districts: d(20, 15, 14, 7, 7, 7, 7, 7, 7) }), "", "구 9개·몫 0.49는 문장 없음");
  for (const bad of [{ count: 100 }, { count: 100, districts: [] }, { count: 100, districts: d(60, 40) }, { count: 0, districts: d(60, 20, 10) }, { count: undefined, districts: d(60, 20, 10) }, { count: "", districts: d(60, 20, 10) }, { count: null, districts: d(60, 20, 10) }]) assert.equal(whereText(bad), "", JSON.stringify(bad));
  assert.throws(() => whereText(null), TypeError);
  assert.throws(() => whereText({ count: 100, districts: "abc" }), TypeError);
  // candidatesShape: 없으면 null, 후보 없음 { empty }, 있으면 줄·문구·주소
  const cell = (median, n = 5) => ({ median, low: median - 1000, high: median + 1000, n, quartile: true });
  assert.equal(candidatesShape(null, [{}]), null);
  assert.equal(candidatesShape({ min10k: 70_000 }, null), null);
  assert.equal(candidatesShape({ min10k: 70_000 }, []), null);
  assert.deepEqual(Object.keys(candidatesShape({ min10k: 70_000 }, [{ reference: "202609" }])), ["empty"]);
  const one = candidatesShape({ min10k: 70_000, max10k: 80_000 }, [{ district: "노원구", reference: "202609", cells: { 가: { 84: cell(72_000) } } }]);
  assert.deepEqual(Object.keys(one), ["intro", "bandCounts", "districts", "rows", "moreHref", "moreText"]);
  assert.equal(one.moreHref, "./deal-search.html?budget=7&group=1", "& 는 그대로(legacy는 &amp;로 적고 React는 속성값에서 &amp;로 낸다)");
  assert.deepEqual(one.rows, [{ href: "./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&apt=%EA%B0%80", apt: "가", facts: "노원구 · 84㎡", amount: "7억 2,000만원", meta: "가운데 절반 7억 1,000만원~7억 3,000만원 · 5건" }]);
  for (const row of one.rows) for (const key of ["href", "facts", "amount", "meta"]) assert.equal(typeof row[key], "string");
  assert.ok(one.rows[0].href.startsWith("./deal-search.html?"), "주소는 코드가 정한 상대 경로다(javascript: 불가)");
  // 12곳 상한: 13곳이어도 12곳만
  const many = (k) => [{ district: "노원구", reference: "202609", cells: Object.fromEntries(Array.from({ length: k }, (_, i) => [`단지${i}`, { 84: cell(72_000 + i, 30 - i) }])) }];
  assert.equal(candidatesShape({ min10k: 70_000, max10k: 80_000 }, many(12)).rows.length, 12);
  assert.equal(candidatesShape({ min10k: 70_000, max10k: 80_000 }, many(12)).moreText, "평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →");
  assert.equal(candidatesShape({ min10k: 70_000, max10k: 80_000 }, many(13)).rows.length, 12);
  assert.match(candidatesShape({ min10k: 70_000, max10k: 80_000 }, many(13)).moreText, /^평형대마다 거래가 많은 곳을 고루 12곳만 적었습니다\. 13곳 전부와/);
  // bodyShape: 예산대 없으면 null, 신고분·지역·요약 글자
  assert.equal(bodyShape(null, ["202609"]), null);
  assert.equal(bodyShape(0), null);
  assert.deepEqual(bodyShape({ min10k: 30_000, max10k: 40_000, count: 1234, direct: 5, districts: [{ name: "가구", count: 1200 }] }, ["202609", "abc", "202608"]), { summary: "3억대에서 1,234건이 거래됐습니다(직거래 5건 포함).", periods: "9월, 8월 신고분 기준", districts: [{ name: "가구", count: "1,200" }] });
  assert.deepEqual(bodyShape({ min10k: 30_000, max10k: 40_000, count: 5 }, undefined), { summary: "3억대에서 5건이 거래됐습니다.", periods: "", districts: [] });
  assert.throws(() => bodyShape({ min10k: 30_000 }, []), TypeError, "건수가 없으면 던진다");
  assert.throws(() => bodyShape({ min10k: 30_000, count: 1 }, "x"), TypeError, "신고분이 배열이 아니면 던진다");
});

test("budget-fragments.mjs: legacy·JSX가 같이 쓰는 순수 모듈이다 - 예산대 이름·억 글자·예산대 하한·규칙 주소·다음 질문 링크", () => {
  // budgetBandLabel: 억 단위 반올림, 위가 비면 이상, 아래가 0이면 미만
  assert.equal(budgetBandLabel({ min10k: 50_000, max10k: 60_000 }), "5억대");
  assert.equal(budgetBandLabel({ min10k: 0, max10k: 30_000 }), "3억 미만");
  assert.equal(budgetBandLabel({ min10k: 300_000, max10k: null }), "30억 이상");
  assert.equal(budgetBandLabel({ min10k: 45_000, max10k: 55_000 }), "5억대", "4.5억은 반올림해 5억");
  assert.equal(budgetBandLabel({ min10k: 4_999, max10k: 30_000 }), "3억 미만", "0.4999억은 0으로 반올림");
  assert.equal(budgetBandLabel({ min10k: 50_000 }), "5억대", "max10k가 없어도(undefined) 하한만으로 N억대다");
  assert.equal(budgetBandLabel({ min10k: 0 }), "NaN억 미만", "하한 0에 max10k가 undefined면(null이 아니면) 상한이 NaN으로 읽힌다 - 예전 그대로(빌더는 null을 넣는다)");
  assert.equal(budgetBandLabel({ min10k: -20_000, max10k: 30_000 }), "-2억대", "하한이 음수면 0 판정(===)에 안 걸린다 - 예전 그대로");
  assert.throws(() => budgetBandLabel(null), TypeError);
  assert.equal(prerender.budgetBandLabel, budgetBandLabel, "prerender.ts가 같은 이름으로 다시 내보낸다");
  // eokText: 만원 → N억 M만원(반올림은 Math.round)
  assert.equal(eokText(0), "0만원");
  assert.equal(eokText(9_999), "9,999만원");
  assert.equal(eokText(10_000), "1억원");
  assert.equal(eokText(12_345), "1억 2,345만원");
  assert.equal(eokText(1_234_567), "123억 4,567만원");
  assert.equal(eokText(100_000), "10억원");
  assert.equal(eokText(0.5), "1만원");
  assert.equal(eokText(-0.5), "-0만원", "Math.round(-0.5)가 -0이라 toLocaleString이 \"-0\"을 낸다 - 예전 그대로");
  assert.equal(eokText(NaN), "NaN만원");
  assert.equal(eokText(-95_000), "-10억 -5,000만원");
  // eokOf: 유한한 숫자만(문자열 숫자도 아니다)
  assert.equal(eokOf({ min10k: 50_000 }), 5);
  assert.equal(eokOf({ min10k: 0 }), 0);
  assert.equal(eokOf({ min10k: -10_000 }), -1);
  for (const bad of [null, undefined, 0, "", "x", true, {}, [], [5], { min10k: "50000" }, { min10k: null }, { min10k: NaN }, { min10k: Infinity }, { min10k: [] }]) assert.equal(eokOf(bad), null, JSON.stringify(bad));
  // 규칙 주소: 코드가 정한 상대 경로
  for (const id of ["mincash", "policy", "cap", "costs", "loan"]) assert.equal(budgetRuleHref(id), `./method.html#budget-rules-${id}`);
  assert.equal(prerender.budgetRuleLink("loan", "글"), ' <a class="budget-rule-link" href="./method.html#budget-rules-loan">글</a>');
  assert.equal(prerender.budgetRuleLink("x", SPECIAL_TEXT), ` <a class="budget-rule-link" href="./method.html#budget-rules-x">A&amp;B &lt;i&gt; &quot;q&quot; it's</a>`, "글자는 이스케이프된다");
  // 다음 질문 링크: 다섯, 전부 상대 경로(javascript: 불가), 얼려 있다
  assert.equal(BUDGET_MORE_LINKS.length, 5);
  for (const [href, text] of BUDGET_MORE_LINKS) {
    assert.match(href, /^\.\/[a-z-]+\.html(#[a-z-]+)?$/);
    assert.ok(text.length > 5);
  }
  assert.ok(Object.isFrozen(BUDGET_MORE_LINKS) && BUDGET_MORE_LINKS.every((pair) => Object.isFrozen(pair)));
});
const SPECIAL_TEXT = `A&B <i> "q" it's`;

test("budget-fragments.mjs: 문단 모양 - 문장이 비면 null, 링크는 코드가 정한 id와 글자, 상한은 16~24억대에만 링크", () => {
  const link = (id, text) => ({ id, text });
  assert.equal(minCashNote(null), null);
  assert.equal(minCashNote({ min10k: "70000" }), null);
  assert.deepEqual(minCashNote({ min10k: 70_000 }).link, link("mincash", "소득·기존 주택 예외와 원문(2026-10-01 확인) →"));
  assert.match(minCashNote({ min10k: 70_000 }).sentence, /^7억 5,000만원짜리를 산다면, /);
  assert.equal(policyNote({ min10k: 70_000 }, null), null);
  assert.equal(policyNote({ min10k: 70_000 }, { n: 0 }), null);
  assert.equal(policyNote({ min10k: 100_000 }, { n: 5 }), null, "10억대는 가격선 밖");
  assert.deepEqual(policyNote({ min10k: 70_000 }, { n: 5 }).link, link("policy", "가격선 정의와 거래 수(2026-10-01 확인) →"));
  assert.equal(capNote({ min10k: 130_000 }, null), null);
  assert.equal(capNote({ min10k: 140_000 }, null).link, null, "14·15억대는 문장이 장에 그대로 있어 링크가 없다");
  assert.equal(capNote({ min10k: 150_000 }, null).link, null);
  assert.deepEqual(capNote({ min10k: 160_000 }, null).link, link("cap", "구간표와 원문(2026-10-01 확인) →"));
  assert.deepEqual(capNote({ min10k: 240_000 }, null).link, link("cap", "구간표와 원문(2026-10-01 확인) →"));
  assert.equal(capNote({ min10k: 245_000 }, null), null, "24.5억대는 16~24억대 밖");
  assert.match(capNote({ min10k: 140_000 }, { since: "2025-10-16", times: 1.8 }).sentence, / 대책 뒤\(2025-10-16~\) 거래를 세면 .*이웃 경계\(14억·16억\)의 1\.8배입니다/);
  assert.doesNotMatch(capNote({ min10k: 140_000 }, null).sentence, /대책 뒤/);
  assert.equal(costsNote({}), null);
  assert.deepEqual(costsNote({ min10k: 70_000 }).link, link("costs", "중과·예외와 원문(2026-10-01 확인) →"));
  assert.equal(loanNote({ min10k: 70_000 }, null), null);
  assert.equal(loanNote(null, {}), null);
  // 금리 근거는 한국은행 ECOS 평균금리 { rate, month }다(#577). 옛 금감원 상품 목록 모양은 읽지 않는다(전에는 던졌다).
  const basis = { rate: 5, month: "202608" };
  assert.deepEqual(loanNote({ min10k: 70_000 }, basis).link, link("loan", "1억당 값과 금리 근거 →"));
  assert.match(loanNote({ min10k: 70_000 }, basis).sentence, /^이 예산에서 절반인 3\.5억을 빌린다면 매달 188만원입니다 — /);
  assert.match(loanNote(null, basis).sentence, /^1억을 30년 원리금균등으로 빌리면 매달 54만원입니다\. 한국은행 ECOS 주택담보대출 신규취급 평균금리 2026년 8월 연 5% 기준입니다\. /, "예산대가 없으면 1억당 문장만");
  assert.equal(loanNote({ min10k: 70_000 }, { mortgage: {} }), null);
});

test("budget-fragments.mjs: 한눈에 줄 모양 - 예산대 없으면 null, 줄은 셋이고 금리가 있으면 넷, 글자 값은 정책대출 줄뿐, 부가 글자는 생애최초·1억당·부대비용", () => {
  assert.equal(budgetAnswers(null), null);
  assert.equal(budgetAnswers({ min10k: "70000" }, { rate: 5.25, month: "202608" }), null);
  const none = budgetAnswers({ min10k: 70_000 });
  assert.equal(none.heading, "7억 5,000만원짜리를 산다면 — 한눈에");
  assert.deepEqual(none.lines.map((l) => l.label), ["자기 돈이 적어도", "매매가 위에 더 드는 돈", "정책대출 가격선"]);
  assert.deepEqual(none.lines.map((l) => l.text), [false, false, true]);
  assert.deepEqual(none.lines.map((l) => l.note), ["생애최초면 2억 4,250만원", "취득세·지방교육세·중개보수 상한", ""]);
  const rates = { rate: 5.25, month: "202608" };
  const withRates = budgetAnswers({ min10k: 70_000 }, rates);
  assert.deepEqual(withRates.lines.map((l) => l.label), ["자기 돈이 적어도", "1억을 빌리면 매달", "매매가 위에 더 드는 돈", "정책대출 가격선"]);
  assert.deepEqual([withRates.lines[1].value, withRates.lines[1].note], ["55만원", "30년 원리금균등, 한국은행 평균 연 5.25%(2026년 8월)"]);
  assert.equal(budgetAnswers({ min10k: 160_000 }).lines[0].note, "", "15억 초과는 생애최초도 천장이 같아 부가 글자가 없다");
  assert.equal(budgetAnswers({ min10k: 160_000 }, rates).lines.length, 4);
});

test("budget-fragments.mjs: 표본 문턱을 정의하거나 부르지 않고, 클래스·마크업·이스케이프를 들고 있지 않다 - 마크업은 legacy(prerender.ts)·JSX(entry.jsx)가 각자 입힌다", async () => {
  const source = await readFile(path.join(root, "scripts/budget-fragments.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /MIN_SAMPLE|hasEnoughSample|metricOf|low-sample/, "표본 문턱이 이 모듈에 있다");
  assert.doesNotMatch(code, /prerender\.(?:mjs|ts)|renderer\.(?:mjs|ts)|escapeHtml|html-escape/, "순수 모듈이 렌더러 스위치·이스케이프를 부른다");
  assert.doesNotMatch(code, /class=|className|data-prerendered|<[a-z]|<\/|answer-|budget-loan|budget-rule-link|budget-answers/, "순수 모듈이 마크업·클래스를 들고 있다 - 한 곳의 오타를 같은 실행 비교가 못 잡는다");
  // import는 순수 모듈뿐이다(렌더러·prerender·JSX 없음): 후보 고르기(complex-price)·억 글자·월 이름(realestate-format)과 문장 모듈 다섯
  const imports = [...code.matchAll(/from "(\.\/[^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./complex-price.ts", "./loan-cap.ts", "./min-cash.ts", "./mortgage.ts", "./policy-loan.ts", "./purchase-costs.ts", "./realestate-format.ts"]);
});

test("prerender.ts의 공개 export는 추출 뒤에도 같은 이름이다 - budgetRuleLink·budgetBandLabel·CANDIDATE_LIST(PR B에서 옮겼다)·MIN_SAMPLE·escapeHtml", () => {
  assert.equal(typeof prerender.budgetRuleLink, "function");
  assert.equal(prerender.budgetBandLabel, budgetBandLabel);
  assert.equal(prerender.CANDIDATE_LIST, 12);
  assert.equal(prerender.CANDIDATE_LIST, CANDIDATE_LIST, "순수 모듈로 옮긴 CANDIDATE_LIST를 prerender.ts가 같은 이름으로 다시 내보낸다(test/complex-candidates.test.mjs가 === 12를 확인한다)");
  assert.equal(prerender.MIN_SAMPLE, MIN_SAMPLE);
  assert.equal(prerender.escapeHtml, escapeHtml);
  assert.equal(prerender.budgetRuleLink("costs", "x"), prerender.budgetRuleLink("costs", "x"));
});

test("budget-fragments.mjs: 이스케이프 없이 문자열에 끼우는 대출 문장(budgetLoanHtml의 ${sentence})에는 & < > \"가 들 수 없다 - 난수 입력 3만 건(고정 시드)", () => {
  // 입력 값 자리마다 특수문자·비문자열·null·undefined를 섞는다. 금리(rate)는 typeof number 일 때만, 달(month)은 YYYYMM 일 때만 문장에 닿고 예산대 하한은 Number.isFinite로 읽혀 숫자 서식 글자만 문장에 닿는다(#577).
  let seed = 20261012;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const STR = ["", "a", "4.5", SP_RAW, "&amp;", "&#x27;", "<b>", "1e3", " 7 ", "0x10", "-3", "\ud800"];
  const ODD = [false, true, 0, -1, 7, 4.5, 1e21, NaN, Infinity, -Infinity, {}, [], [5], ["4.5"], null, undefined, { valueOf: () => 4, toString: () => SP_RAW }, { toString: () => SP_RAW }];
  const NUM = [0, 0.01, 1, 3.5, 4.11, 4.114, 5.25, 6.21, 12, 100, 1e-7, 123456.789];
  const v = () => (rnd() < 0.5 ? pick(NUM) : rnd() < 0.5 ? pick(STR) : pick(ODD));
  const MONTHS = ["202608", "199901", "2026-08", "20268", SP_RAW, ""];
  const band = () => (rnd() < 0.1 ? v() : { min10k: rnd() < 0.5 ? Math.floor(rnd() * 25) * 10_000 : v() });
  let made = 0;
  let withHalf = 0;
  for (let i = 0; i < 30000; i++) {
    const basis = rnd() < 0.05 ? v() : { rate: v(), month: rnd() < 0.7 ? pick(MONTHS) : v(), extra: v() };
    let note;
    try {
      note = loanNote(band(), basis);
    } catch (err) {
      assert.ok(err instanceof TypeError);
      continue;
    }
    if (!note) continue;
    made++;
    if (note.sentence.startsWith("이 예산")) withHalf++;
    assert.doesNotMatch(note.sentence, /[&<>"]/, `대출 문장에 특수문자가 있다: ${note.sentence}`);
    assert.equal(typeof note.sentence, "string");
  }
  assert.ok(made > 3000 && withHalf > 1000, `문장 ${made}개·절반 문장 ${withHalf}개 - 입력이 raw 자리를 거의 밟지 않았다`);
});
const SP_RAW = `A&B <i> "q" it's`;
