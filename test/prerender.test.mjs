import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPrerender,
  escapeHtml,
  marketHtml,
  newsHtml,
  ratesHtml,
  realestateHtml,
  summaryHtml,
} from "../scripts/prerender.mjs";
import { loadRatesPage } from "./helpers/rates-page.mjs";
import { rateBridgeHtml } from "../scripts/rate-bridge.ts";

const root = path.resolve(import.meta.dirname, "..");
const readIndex = () => readFile(path.join(root, "docs/index.html"), "utf8");
// docs/rates.html은 허브(#193)라 표가 없다. 표 자리표시는 예금 페이지(틀에서 찍은 것)에서 본다.
const readRates = () => readFile(path.join(root, "docs/deposit-rates.html"), "utf8");
const readHub = () => readFile(path.join(root, "docs/rates.html"), "utf8");

// 구운 조각에는 #279에서 Tailwind 유틸리티가 붙었고, 틀의 인라인 스크립트가 데이터를 받아 다시 그리는 마크업에는 붙지 않는다
// (그 스크립트를 고치는 길은 S6와 #282로 막혀 있다 - scripts/prerender.mjs의 금리 조각 주석). 이 시험은 두 쪽을 맞대므로 둘 다 받는다.
// class를 글자 그대로 적는 이유: tools/golden의 훅 class 추출기가 이 줄의 class="…"를 읽어 hook-classes.json의 markup 쪽을 만든다 -
// `[^"]*` 같은 조각으로 적으면 그 이름이 훅 목록에서 조용히 빠진다(실측).
const PRODUCT_NAME = ['class="product-name tw:whitespace-normal tw:break-keep"', 'class="product-name"'];
const productNames = (html) => [...html.matchAll(new RegExp(`(?:${PRODUCT_NAME.join("|")})>([^<]*)`, "g"))].map((m) => m[1].trim());
const readData = async (name) =>
  JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8"));

const wrap = (name, inner) => `<div><!--prerender:${name}-->${inner}<!--/prerender:${name}--></div>`;

test("자리표시 주석 사이를 갈아끼우고, 다시 돌려도 결과가 같다", () => {
  const once = applyPrerender(wrap("news", "불러오는 중..."), { news: "<li>기사</li>" });
  assert.equal(once, wrap("news", "<li>기사</li>"));
  assert.equal(applyPrerender(once, { news: "<li>기사</li>" }), once);
});

test("데이터가 없으면 기존 안내 문구를 그대로 둔다", () => {
  const html = wrap("news", "불러오는 중...");
  assert.equal(applyPrerender(html, { news: null }), html);
});

test("자리표시 주석이 사라졌으면 조용히 넘어가지 않는다", () => {
  assert.throws(() => applyPrerender("<div>표시 없음</div>", { news: "<li>기사</li>" }), /자리표시/);
});

test("기사 제목의 따옴표·꺾쇠는 마크업으로 새지 않는다", () => {
  const html = newsHtml({
    items: [{ title: '<script>alert("x")</script> & 금리', link: "https://x/a?b=1&c=2", source: "매체" }],
  });
  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
  assert.ok(html.includes("&amp;c=2"), html);
  assert.equal(escapeHtml('a"b'), "a&quot;b");
});

test("신고 건수가 적은 구는 정적 HTML에도 값이 실리지 않는다", () => {
  const html = realestateHtml({
    overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 575 } },
    districts: [
      { name: "표본부족구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 } },
      {
        name: "정상구",
        sale: { avgPricePerPyeong10k: 5000, transactionCount: 40 },
        jeonse: { avgDepositPerPyeong10k: 3000, transactionCount: 3 },
      },
    ],
  });

  assert.ok(!html.includes("9,999"), "표본이 부족한 구의 값이 실렸다");
  assert.ok(html.includes("표본 2건"), "표본이 부족하다는 사실 자체를 안 적었다");
  assert.ok(html.includes("정상구") && html.includes("5,000만원"));
  assert.ok(!html.includes("3,000만원"), "표본이 부족한 전세 값이 실렸다");
  assert.ok(html.includes("표본 3건"));
  assert.ok(html.indexOf("정상구") < html.indexOf("표본부족구"), "표본이 부족한 구가 위로 갔다");
});

test("시장지표는 값이 있는 항목만 줄을 만든다", () => {
  assert.equal(marketHtml(null), null);
  assert.equal(marketHtml({}), null);
  const html = marketHtml({ kospi: { value: "6,977.94", change: "164.60" }, baseRate: { value: "2.75" } });
  assert.ok(!html.includes("코스피"), "코스피는 첫 화면에서 뺐다(#56)");
  assert.ok(html.includes("기준금리") && html.includes("2.75%"));
  assert.ok(!html.includes("환율"), "값이 없는 환율까지 줄을 만들었다");
});

// 마크업은 스크립트가 그리는 모양(분류 라벨 + 줄 div)이다 (#352).
test("요약은 카테고리별 한국어 문장을 싣는다", () => {
  assert.equal(summaryHtml({ categories: [] }), null);
  const html = summaryHtml({ categories: [{ name: "부동산", lineKo: "서울 주택난" }, { name: "증시" }] });
  assert.ok(html.includes('<div class="summary-category-label">부동산</div><div class="summary-category-line">서울 주택난</div>'));
  // 문장이 없는 분류도 스크립트는 라벨과 빈 줄로 그린다 - 구운 쪽이 걸러 내면 스크립트가 다시 그릴 때 상자 높이가 달라진다.
  assert.ok(html.includes('<div class="summary-category-label">증시</div><div class="summary-category-line"></div>'));
});

test("배포된 index.html에 자리표시 주석 네 쌍이 남아 있다", async () => {
  const html = await readIndex();
  for (const name of ["summary", "market", "realestate", "news"]) {
    assert.ok(html.includes(`<!--prerender:${name}-->`), `${name} 여는 주석이 없다`);
    assert.ok(html.includes(`<!--/prerender:${name}-->`), `${name} 닫는 주석이 없다`);
  }
});

test("커밋된 HTML이 지금 데이터로 다시 그린 결과와 같다", async () => {
  const html = await readIndex();
  const [summary, market, realestate, news] = await Promise.all(
    ["summary", "market", "realestate", "news"].map(readData)
  );

  const expected = applyPrerender(html, {
    summary: summaryHtml(summary),
    market: marketHtml(market),
    realestate: realestateHtml(realestate),
    news: newsHtml(news),
  });

  assert.equal(html, expected, "docs/index.html이 데이터와 어긋납니다. node scripts/prerender.mjs를 실행하세요.");
});

test("금리 표의 정적 HTML이 실제 첫 화면과 같은 상품·순서다", async () => {
  const [rates, { byId }] = await Promise.all([
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
    loadRatesPage(),
  ]);

  const rendered = productNames(byId.get("products-body").innerHTML);
  const prerendered = productNames(ratesHtml(rates));

  assert.ok(prerendered.length > 0, "정적 표가 비어 있다");
  assert.deepEqual(prerendered, rendered.slice(0, prerendered.length));
});

test("금리 표는 첫 화면에 없는 탭까지 심지 않는다", async () => {
  const [rates, html] = await Promise.all([
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
    readRates(),
  ]);

  const staticNames = new Set(productNames(ratesHtml(rates)));
  for (const product of rates.mortgage ?? []) {
    assert.ok(!staticNames.has(product.name), `대출 상품이 실렸다: ${product.name}`);
  }
  assert.ok(html.includes("<!--prerender:rates-->"), "deposit-rates.html에 자리표시 주석이 없다");
});

test("커밋된 rates.html(허브)이 지금 문구 원본으로 다시 그린 결과와 같다", async () => {
  const html = await readHub();

  assert.equal(
    html,
    applyPrerender(html, { rateBridgeKo: rateBridgeHtml("rates", "ko"), rateBridgeEn: rateBridgeHtml("rates", "en") }),
    "docs/rates.html이 문구 원본과 어긋납니다. node scripts/prerender.mjs를 실행하세요."
  );
});

test("크롤러가 받는 HTML에 오늘 기사 제목이 실제로 들어 있다", async () => {
  const [html, news] = await Promise.all([readIndex(), readData("news")]);
  // 첫 화면은 다섯 건만, 부동산 먼저 싣는다(#48) - 그 첫 건이 실려 있어야 한다.
  const { indexNewsItems } = await import("../scripts/prerender.mjs");
  const first = indexNewsItems(news.items)[0];
  assert.ok(first, "기사가 한 건도 없다 - 수집이 통째로 실패했다");
  assert.ok(html.includes(escapeHtml(first.title)), "첫 기사 제목이 정적 HTML에 없다");
  assert.ok(html.includes(escapeHtml(first.link)), "첫 기사 링크가 정적 HTML에 없다");
});

test("좁은 화면 카드 라벨이 클라이언트 사전과 같은 글자다", async () => {
  const [ratesHtmlSource, indexHtml] = await Promise.all([readRates(), readIndex()]);

  const labelsIn = (html, block) => {
    const body = new RegExp(`<!--prerender:${block}-->([\\s\\S]*?)<!--/prerender:${block}-->`).exec(html)?.[1] ?? "";
    return new Set([...body.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]));
  };

  for (const label of labelsIn(ratesHtmlSource, "rates")) {
    assert.ok(ratesHtmlSource.includes(`: "${label}"`), `금리 표 라벨이 사전에 없다: ${label}`);
  }
  for (const label of labelsIn(indexHtml, "realestate")) {
    assert.ok(indexHtml.includes(`: "${label}"`), `부동산 표 라벨이 사전에 없다: ${label}`);
  }
  for (const label of labelsIn(indexHtml, "market")) {
    assert.ok(indexHtml.includes(`: "${label}"`), `시장지표 표 라벨이 사전에 없다: ${label}`);
  }
});

test("정적 마크업이 클라이언트가 그리는 구조와 같은 뼈대다", async () => {
  const news = await readData("news");
  const item = newsHtml(news).split("</li>")[0];
  assert.ok(item, "기사가 한 건도 없다 - 수집이 통째로 실패했다");

  assert.ok(item.includes('<div class="news-meta">'), "매체 줄이 다른 요소로 그려진다");
  assert.ok(!item.includes('class="news-source"'), "클라이언트에 없는 클래스를 쓴다");

  const realestate = realestateHtml({
    overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 575, change: { value10k: 12 } } },
    districts: [
      { name: "강남구", sale: { avgPricePerPyeong10k: 10870, transactionCount: 14, change: { value10k: -30 } } },
    ],
  });
  assert.ok(realestate.includes('<span class="change">'), "증감이 빠져 있다");
  assert.ok(realestate.includes('<span class="count">'), "거래 건수가 빠져 있다");
});

test("첫 화면 뉴스는 다섯 건, 부동산 먼저, 나머지는 뉴스 화면으로 (#48)", async () => {
  const { indexNewsItems, INDEX_NEWS } = await import("../scripts/prerender.mjs");
  const items = [
    ...Array.from({ length: 4 }, (_, i) => ({ title: `금리${i}`, link: `https://x/r${i}`, category: "rates" })),
    ...Array.from({ length: 3 }, (_, i) => ({ title: `부동산${i}`, link: `https://x/e${i}`, category: "realestate" })),
  ];
  assert.equal(INDEX_NEWS, 5);
  assert.deepEqual(indexNewsItems(items).map((i) => i.title), ["부동산0", "부동산1", "부동산2", "금리0", "금리1"]);
  const html = newsHtml({ items });
  assert.equal((html.match(/class="news-item"/g) ?? []).length, 5);
  assert.match(html, /<li class="news-more"><a href="\.\/news\.html">뉴스 전체 7건 보기 →<\/a><\/li>$/);
});
