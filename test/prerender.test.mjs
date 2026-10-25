import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPrerender,
  escapeHtml,
  marketHtml,
  newsHtml,
  newsListHtml,
  realestateHtml,
} from "../scripts/prerender.ts";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readIndex = () => readFile(path.join(root, `${SITE}/index.html`), "utf8");

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

// 기사 제목은 뉴스 화면 목록(newsListHtml)에만 굽는다 - 메인 뉴스 자리는 #575 PR2 부터 링크 한 줄이다.
test("기사 제목의 따옴표·꺾쇠는 마크업으로 새지 않는다", () => {
  const html = newsListHtml({
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

test("배포된 index.html에 자리표시 주석 세 쌍이 남아 있다", async () => {
  const html = await readIndex();
  for (const name of ["market", "realestate", "news"]) {
    assert.ok(html.includes(`<!--prerender:${name}-->`), `${name} 여는 주석이 없다`);
    assert.ok(html.includes(`<!--/prerender:${name}-->`), `${name} 닫는 주석이 없다`);
  }
  // AI 요약 상자는 뉴스 화면에만 있다(#575 PR2).
  assert.ok(!html.includes("<!--prerender:summary-->"), "메인에 요약 자리표시가 남았다");
});

// (#507) "커밋된 HTML이 지금 데이터로 다시 그린 결과와 같다" 는 커밋된 데이터와 커밋된 생성물을 맞대는 검사라 tools/health/test/prerender.test.mjs 로 옮겼다(비차단). 같은 단언의 고정 데이터 짝은 test/fixture-site.test.mjs 에 있다.

// (#507) "크롤러가 받는 HTML에 오늘 기사 제목이 실제로 들어 있다" 는 커밋된 데이터와 커밋된 생성물을 맞대는 검사라 tools/health/test/prerender.test.mjs 로 옮겼다(비차단). 같은 단언의 고정 데이터 짝은 test/fixture-site.test.mjs 에 있다.

test("좁은 화면 카드 라벨이 클라이언트 사전과 같은 글자다", async () => {
  const indexHtml = await readIndex();

  const labelsIn = (html, block) => {
    const body = new RegExp(`<!--prerender:${block}-->([\\s\\S]*?)<!--/prerender:${block}-->`).exec(html)?.[1] ?? "";
    return new Set([...body.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]));
  };

  for (const label of labelsIn(indexHtml, "realestate")) {
    assert.ok(indexHtml.includes(`: "${label}"`), `부동산 표 라벨이 사전에 없다: ${label}`);
  }
  for (const label of labelsIn(indexHtml, "market")) {
    assert.ok(indexHtml.includes(`: "${label}"`), `시장지표 표 라벨이 사전에 없다: ${label}`);
  }
});

test("정적 마크업이 클라이언트가 그리는 구조와 같은 뼈대다", async () => {
  const news = await readData("news");
  const item = newsListHtml(news).split("</li>")[0];
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

// 첫 화면 뉴스는 #575 PR2 부터 다섯 건이 아니라 뉴스 화면으로 가는 한 줄이다.
test("첫 화면 뉴스는 기사 수를 단 링크 한 줄이고, 기사는 뉴스 화면으로 (#48, #575)", () => {
  const items = [
    ...Array.from({ length: 4 }, (_, i) => ({ title: `금리${i}`, link: `https://x/r${i}`, category: "rates" })),
    ...Array.from({ length: 3 }, (_, i) => ({ title: `부동산${i}`, link: `https://x/e${i}`, category: "realestate" })),
  ];
  assert.equal(newsHtml({ items }), '<a href="./news.html" id="news-link" data-n="7">오늘 뉴스 7건·AI 요약 →</a>');
  assert.equal(newsHtml({ items: [] }), null);
});
