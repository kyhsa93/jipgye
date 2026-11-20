// 원/달러 환율 화면 문구 (#639 PR-2, po·cpo·legal 판정 2026-10-26). 환율은 ECOS 일 계열(731Y001)의 매매기준율이라 값마다 기준일을 붙이고,
// 「실시간」·LIVE 문구는 우리가 쓰는 글(고정 문구와 생성 요약 ko·en) 어디에도 없다. 출처·링크가 붙은 목록 항목의 인용 기사 제목(title·titleEn)은
// 우리 주장이 아니라서 「실시간」 낱말 검사에서만 빠지고, 나가는 장의 「실시간 환율/값/시세」·LIVE·exchangerate 검사는 그대로 받는다(#945 H1, 2026-11-18).
// 값은 데이터 쪽 약속(수집기 PR #640: usdKrw {value, asOf="10/23", prevValue, change, direction})이고,
// 이 시험은 고정 값으로 구운 장·화면 스크립트가 판정 문구를 그대로 내는지, 값이 없을 때 그 줄·카드만 조용히 빠지는지 본다(저장소의 docs/data 는 읽지 않는다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES, buildNewsPage } from "../scripts/build-news-pages.ts";
import { marketHtml, newsKospiHtml } from "../scripts/prerender.ts";
import { FOOTERS } from "../scripts/source-lines.ts";
import { bannedWordsIn } from "../scripts/summary-banned-words.ts";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { readFixture } from "./helpers/fixture-data.mjs";
import { SITE_DIR, sitePath } from "./helpers/site-root.mjs";
import { QUOTED_TITLE } from "./helpers/quoted-title.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

const ECOS_FX = { value: 1324.7, asOf: "10/23", prevValue: 1325.9, change: "-1.20", direction: "FALLING" };
// 옛 수집기(open.er-api.com)의 모양: asOf 가 RFC 날짜 글이다. #640 병합 뒤 첫 Daily 까지 docs/data/market.json 이 이 모양이다.
const OLD_FX = { value: 1324.953768, asOf: "Fri, 23 Oct 2026 00:02:31 +0000", prevValue: 1326.143133, change: "-1.19", direction: "FALLING" };
const market = (usdKrw) => ({ updatedAt: "2026-10-25T00:00:00Z", kospi: { value: "5,001.01", change: "182.92", direction: "RISING", asOf: "10/21" }, usdKrw, baseRate: { value: "3.00" } });

const KO = { line: "원/달러 환율 1,324.70원(10/23 기준)", label: "원/달러 환율 10/23 매매기준율", sub: "전 영업일 대비 -1.20" };
const EN = { line: "USD/KRW 1,324.70 (as of 10/23)", label: "USD/KRW 10/23 reference rate", sub: "vs previous business day -1.20" };

const stockPage = NEWS_PAGES.find((p) => p.category === "stocks");
const otherPages = NEWS_PAGES.filter((p) => p.category !== "stocks");
const newsTemplate = await read("docs/news.html");
const [news, summary] = await Promise.all([readFixture("news"), readFixture("summary")]);
const build = (page, m) => buildNewsPage(newsTemplate, page, { news, summary, market: m });

// ---- 첫 화면 값 한 줄 ----

test("구운 값 줄: 기준일이 있으면 「원/달러 환율 1,324.70원(10/23 기준)」", () => {
  assert.equal(marketHtml(market(ECOS_FX)), `한국은행 기준금리 3.00% · ${KO.line}`);
});

test("구운 값 줄: 기준일이 없거나 옛 모양이면 괄호를 생략하고, 환율이 null 이면 줄에서 빠진다", () => {
  assert.equal(marketHtml(market({ value: 1324.7 })), "한국은행 기준금리 3.00% · 원/달러 환율 1,324.70원");
  assert.equal(marketHtml(market(OLD_FX)), "한국은행 기준금리 3.00% · 원/달러 환율 1,324.95원", "옛 값에 「기준」을 붙였다");
  assert.equal(marketHtml(market(null)), "한국은행 기준금리 3.00%");
  assert.equal(marketHtml({ usdKrw: null }), null);
});

// 화면 스크립트: 구운 줄과 같은 글을 언어만 바꿔 다시 쓴다.
const lineOf = async (lang, m) => {
  const page = await loadIndexPage({ fetch: async () => ({ ok: false, json: async () => ({}) }), storage: { lang } });
  page.app.renderMarket(m);
  return page.byId("market-line").textContent;
};

test("화면 값 줄: ko 「원/달러 환율 1,324.70원(10/23 기준)」, en 「USD/KRW 1,324.70 (as of 10/23)」", async () => {
  assert.equal(await lineOf("ko", market(ECOS_FX)), `한국은행 기준금리 3.00% · ${KO.line}`);
  assert.equal(await lineOf("en", market(ECOS_FX)), `BOK Base Rate 3.00% · ${EN.line}`);
});

test("화면 값 줄: 기준일이 없거나 옛 모양이면 괄호를 생략하고, 환율이 없으면 줄에서 빠진다", async () => {
  for (const fx of [{ value: 1324.7 }, OLD_FX, { value: 1324.7, asOf: null }]) {
    assert.doesNotMatch(await lineOf("ko", market(fx)), /기준\)/);
    assert.doesNotMatch(await lineOf("en", market(fx)), /as of/);
  }
  assert.equal(await lineOf("ko", market(null)), "한국은행 기준금리 3.00%");
  assert.equal(await lineOf("en", market(null)), "BOK Base Rate 3.00%");
});

// ---- 증시·환율 장 ----

test("증시·환율 장: 환율 카드가 코스피 카드 옆에 ko·en 문구로 있다", () => {
  const html = build(stockPage, market(ECOS_FX));
  const cards = html.match(/id="kospi-stats">([\s\S]*?)<!--\/prerender:newsKospi--><\/div>/)?.[1] ?? "";
  assert.ok(cards.indexOf("코스피 10/21 종가") !== -1 && cards.indexOf("코스피 10/21 종가") < cards.indexOf(KO.label), "환율 카드가 코스피 카드 뒤에 없다");
  for (const s of [KO.label, EN.label, KO.sub, EN.sub, "1,324.70"]) assert.ok(cards.includes(s), s);
  assert.ok(html.includes('<section id="kospi-section">'), "카드가 있는데 구획이 숨어 있다");
});

test("증시·환율 장: 환율이 null·옛 모양·값 없음이면 환율 카드만 빠지고 코스피 카드와 구획은 그대로다", () => {
  for (const fx of [null, undefined, OLD_FX, { value: null, asOf: "10/23" }, { value: "1324.7", asOf: "10/23" }]) {
    const html = build(stockPage, market(fx));
    assert.ok(!html.includes("매매기준율") && !html.includes("reference rate"), `카드가 남았다: ${JSON.stringify(fx)}`);
    assert.ok(html.includes("코스피 10/21 종가") && html.includes('<section id="kospi-section">'));
  }
  const noChange = build(stockPage, market({ value: 1324.7, asOf: "10/23" }));
  assert.ok(noChange.includes(KO.label) && !noChange.includes("전 영업일 대비"), "증감이 없는데 보조 줄을 냈다");
  assert.equal(newsKospiHtml({ usdKrw: ECOS_FX }) !== null, true, "코스피 없이 환율만 있어도 카드는 난다");
  assert.equal(build(stockPage, { updatedAt: "x" }).includes('<section id="kospi-section" hidden>'), true, "카드가 하나도 없으면 구획은 숨는다");
});

test("환율 카드는 증시·환율 장에만 있다 - 다른 뉴스 장에는 카드도 ECOS 출처 줄도 없다", () => {
  for (const page of otherPages) {
    const html = build(page, market(ECOS_FX));
    assert.ok(!html.includes("매매기준율") && !html.includes("reference rate"), page.file);
    assert.ok(!html.includes(FOOTERS.stocks.ko) && !html.includes(FOOTERS.stocks.en), `${page.file}: ECOS 출처 줄이 있다`);
  }
});

test("증시·환율 장 출처 줄: 「출처: 한국은행 경제통계시스템(ECOS).」 / 「Source: Bank of Korea ECOS.」 가 RSS 줄 앞에 div·ko 사전·en 사전 세 곳이다", () => {
  assert.equal(FOOTERS.stocks.ko, "출처: 한국은행 경제통계시스템(ECOS).");
  assert.equal(FOOTERS.stocks.en, "Source: Bank of Korea ECOS.");
  const html = build(stockPage, market(ECOS_FX));
  assert.equal(html.split(`${FOOTERS.stocks.ko} 기사 제목과 링크는`).length - 1, 2, "ko 두 벌(div·사전)");
  assert.equal(html.split(`${FOOTERS.stocks.en} Headlines and links come from`).length - 1, 1, "en 한 벌(사전)");
  assert.equal(html.split(FOOTERS.stocks.ko).length - 1, 2);
  assert.equal(html.split(FOOTERS.stocks.en).length - 1, 1);
});

// ---- 나가는 장(build/site) ----

test("나가는 증시·환율 장: 출처 줄이 맨 앞에 ECOS 이고 다른 뉴스 장은 RSS 줄 그대로다", async () => {
  const footer = (html) => html.match(/<div id="footer-source">([^<]*)<\/div>/)?.[1] ?? "";
  assert.match(footer(await readFile(sitePath("stock-news.html"), "utf8")), new RegExp(`^${FOOTERS.stocks.ko.replace(/[()]/g, "\\$&")} 기사 제목과 링크는`));
  for (const f of ["news.html", "realestate-news.html", "rate-news.html"]) {
    const line = footer(await readFile(sitePath(f), "utf8"));
    assert.match(line, /^기사 제목과 링크는/, f);
    assert.doesNotMatch(line, /ECOS/, f);
  }
});

test("나가는 첫 화면 출처 줄: 기준금리와 원/달러 환율(매매기준율)이 모두 ECOS 다", async () => {
  assert.equal(FOOTERS.index.ko, "출처: 한국은행 경제통계시스템(ECOS) 기준금리·원/달러 환율(매매기준율).");
  assert.equal(FOOTERS.index.en, "Source: Bank of Korea ECOS (base rate, KRW/USD reference rate).");
  const html = await readFile(sitePath("index.html"), "utf8");
  assert.equal(html.split(FOOTERS.index.ko).length - 1, 2);
  assert.equal(html.split(FOOTERS.index.en).length - 1, 1);
});

test("방법 장: 환율은 ECOS 일 계열(매매기준율, 영업일 하루 값)이다", async () => {
  const html = await readFile(sitePath("method.html"), "utf8");
  assert.ok(html.includes("<strong>시장 지표</strong> — 코스피, 원/달러 환율(매매기준율, 영업일 하루 값), 한국은행 기준금리. 모두 한국은행 경제통계시스템(ECOS) Open API, 하루 1회."));
  assert.ok(html.includes("<strong>Market indicators</strong> — KOSPI, KRW/USD (reference rate, one value per business day) and the base rate, all from Bank of Korea ECOS Open API. Daily."));
});

// ---- 「실시간」·LIVE 약속(#639)을 세 범위로 나눠 본다 (#945) ----
// 2026-11-18 금리 요약에 모델이 지어낸 「실시간」 한 문장이 아래 전수 검사에 걸려 그날 데이터 배포 전체가 막혔다(Deploy run 44239714050).
// 나가는 장의 글은 출처가 셋이라 따로 본다: (a) 고정 문구(틀·화면 스크립트) (b) 생성 요약(요약기가 금지어 문장을 떼므로 늘 성립해야 하는 불변식)
// (c) 인용 헤드라인(기사 제목 원문, 출처·링크와 함께 나간다). 환율 주장(「실시간 환율/값/시세」)·LIVE·exchangerate 검사는 범위를 나누지 않고 모든 글에 그대로다.
//
// (c) 는 cpo·legal 결정 H1(#945, 2026-11-18)을 따른다: 인용 제목은 「실시간」 낱말 검사에서만 빠지고(08-12 「… 확정일자 실시간 확인 …」 같은 기자 제목 하나로
// 그날 배포 전체가 막히지 않게) 환율 주장·LIVE·exchangerate 검사는 그대로 받는다. 빠지는 범위는 출처·링크 붙은 목록 항목의 제목 글자뿐이다(legal 조건) -
// 둘레 고정 문구와 요약은 (a)·(b) 가 계속 0 으로 본다. 제목을 고치거나 숨기지 않는다(인용 변경).
// HEADLINE_SCOPE 는 그 결정의 값이다. "claims-only"(H1) = 인용 제목은 환율 주장·LIVE·exchangerate 검사만, "all-words" = 결정 전 동작(인용 제목도 「실시간」 0).
const HEADLINE_SCOPE = "claims-only";

// (b) 의 자리: 뉴스 장의 프리렌더 요약 블록(scripts/render/entry.jsx newsSummary - 분야 이름 + lineKo).
const SUMMARY_BLOCK = /<!--prerender:newsSummary-->[\s\S]*?<!--\/prerender:newsSummary-->/g;
// (c) 의 자리: 출처·링크 붙은 목록 항목의 제목 글자 - QUOTED_TITLE(test/helpers/quoted-title.mjs, news-pages 의 상대 시간 검사와 같은 한 벌, #950).

const { readdir } = await import("node:fs/promises");
const shipped = async () => {
  const files = (await readdir(SITE_DIR)).filter((f) => /\.(html|js|css|webmanifest)$/.test(f));
  assert.ok(files.length > 50, "전제: 나가는 장을 못 읽었다");
  return Promise.all(files.map(async (f) => [f, await readFile(sitePath(f), "utf8")]));
};

test("「실시간」 환율·LIVE 배지·exchangerate·er-api 흔적이 나가는 장과 화면 스크립트에 없다 - 요약·인용 제목 포함 모든 글 (#639, #96)", async () => {
  for (const [f, text] of await shipped()) {
    assert.doesNotMatch(text, /exchangerate|er-api/i, f);
    assert.doesNotMatch(text, /\bLIVE\b/, `${f}: LIVE 문구`);
    assert.doesNotMatch(text, /실시간 (?:환율|값|시세)|실시간 환율/, `${f}: 실시간 환율 문구`);
  }
});

test("(a) 고정 문구: 요약 블록과 인용 제목을 뺀 글에서 「실시간」은 방법 장의 범위 적중 문단에만 있다 (#945)", async () => {
  let titles = 0;
  for (const [f, text] of await shipped()) {
    titles += [...text.matchAll(QUOTED_TITLE)].length;
    const fixed = text.replace(SUMMARY_BLOCK, "").replace(QUOTED_TITLE, "$1$3");
    // 방법 장의 「실시간」은 범위 적중(예측 범위가 실제로 맞았는지) 문단의 낱말이다 - 환율과 무관하다.
    if (f !== "method.html") assert.ok(!fixed.includes("실시간"), `${f}: 「실시간」`);
  }
  assert.ok(titles > 0, "전제: 인용 제목 자리를 하나도 못 찾았다 - 목록 마크업이 바뀌었으면 QUOTED_TITLE 을 고친다");
});

test("(b) 생성 요약: 프리렌더 요약 블록과 data/summary.json 의 요약 글(ko·en)에 금지어가 없다 (#945)", async () => {
  let blocks = 0;
  for (const [f, text] of await shipped()) {
    for (const [block] of text.matchAll(SUMMARY_BLOCK)) {
      blocks += 1;
      assert.deepEqual(bannedWordsIn(block), [], `${f}: 요약 블록에 금지어`);
    }
  }
  assert.ok(blocks > 0, "전제: 요약 블록을 하나도 못 찾았다");
  // 모델이 쓴 글만 본다: 분야 줄(폴백이 아닌 lineKo·lineEn)과 핵심 기사 요약(textKo·textEn). 폴백 줄과 summary.ko·en 묶음에는 기사 제목이 섞여 있어
  // 그 몫은 (c) 다 - 영문 화면은 이 필드들을 data/summary.json 에서 읽는다.
  const data = JSON.parse(await readFile(sitePath("data/summary.json"), "utf8"));
  const generated = [
    ...(data.categories ?? []).filter((c) => !c.isFallback).flatMap((c) => [[`${c.key}.lineKo`, c.lineKo], [`${c.key}.lineEn`, c.lineEn]]),
    ...(data.highlights ?? []).flatMap((h, i) => [[`highlights[${i}].textKo`, h.textKo], [`highlights[${i}].textEn`, h.textEn]]),
  ].filter(([, t]) => typeof t === "string");
  assert.ok(generated.length > 0, "전제: data/summary.json 에 요약 글이 없다");
  for (const [where, t] of generated) assert.deepEqual(bannedWordsIn(t), [], `data/summary.json ${where}: ${t}`);
});

test("(c) 인용 헤드라인: 출처·링크 붙은 목록 제목은 「실시간」 낱말 검사에서만 빠지고 환율 주장·LIVE·exchangerate 검사는 받는다 (#945 H1)", async () => {
  // 빼는 범위가 제목 글자뿐인지 고정 마크업으로 먼저 본다 - 같은 낱말이 둘레 글·출처 줄에 있으면 (a) 에 남는다.
  const sample =
    '<ul><li><a href="https://example.com/a" target="_blank" rel="noopener">안심전세 앱에서 확정일자 실시간 확인 가능해진다</a> <span class="news-meta">실시간 매체</span></li></ul><p>실시간</p>';
  assert.equal(
    sample.replace(QUOTED_TITLE, "$1$3"),
    '<ul><li><a href="https://example.com/a" target="_blank" rel="noopener"></a> <span class="news-meta">실시간 매체</span></li></ul><p>실시간</p>'
  );
  assert.equal('<p><a href="https://example.com/a" target="_blank" rel="noopener">실시간</a></p>'.replace(QUOTED_TITLE, "$1$3").includes("실시간"), true, "목록 항목이 아닌 링크도 뺐다");
  let titles = 0;
  for (const [f, text] of await shipped()) {
    for (const [, , title] of text.matchAll(QUOTED_TITLE)) {
      titles += 1;
      assert.doesNotMatch(title, /exchangerate|er-api/i, `${f}: ${title}`);
      assert.doesNotMatch(title, /\bLIVE\b/, `${f}: 인용 제목에 LIVE: ${title}`);
      assert.doesNotMatch(title, /실시간 (?:환율|값|시세)/, `${f}: 인용 제목에 실시간 환율 주장: ${title}`);
      if (HEADLINE_SCOPE === "all-words") assert.ok(!title.includes("실시간"), `${f}: 인용 제목에 「실시간」: ${title}`);
    }
  }
  assert.ok(titles > 0, "전제: 인용 제목을 하나도 못 찾았다");
});

test("증시·환율 장 구획 제목은 「시장 지표」/「Market indicators」다 - 코스피·환율 두 카드를 함께 덮는다", async () => {
  const html = await readFile(sitePath("stock-news.html"), "utf8");
  assert.ok(html.includes('<h2 id="kospi-heading">시장 지표</h2>'));
  assert.ok(html.includes('kospiHeading: "시장 지표",'));
  assert.ok(html.includes('kospiHeading: "Market indicators",'));
  assert.ok(!html.includes('kospiHeading: "KOSPI"') && !html.includes('<h2 id="kospi-heading">코스피</h2>'));
});
