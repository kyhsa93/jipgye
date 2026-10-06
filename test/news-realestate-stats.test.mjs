import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachContext, buildRealestateStats } from "../scripts/news-context.mjs";
import { newsRealestateStatsHtml } from "../scripts/prerender.mjs";
import { NEWS_PAGES, buildNewsPage } from "../scripts/build-news-pages.mjs";
import { loadNewsPage } from "./helpers/news-page.mjs";

const root = path.resolve(import.meta.dirname, "..");

const REALESTATE = {
  window: { from: "2026-06-15", to: "2026-07-12", weeks: 4 },
  overall: {
    sale: {
      avgPricePerPyeong10k: 4449,
      transactionCount: 575,
      change: { value10k: 340, percent: 8.27451934777318 },
      baselineDate: "2026-08-10",
    },
    jeonse: { avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: [],
};

const newsWith = (realestate) =>
  attachContext(
    {
      updatedAt: new Date().toISOString(),
      items: [
        {
          title: "송파 9억대 아파트",
          titleEn: "Songpa apartment",
          link: "https://example.com/a",
          source: "가상경제",
          category: "realestate",
          publishedAt: new Date().toISOString(),
        },
      ],
    },
    { realestate }
  );

test("서울 매매·전세·월세 세 장이 각자 제 페이지로 간다", () => {
  const stats = buildRealestateStats(REALESTATE);
  assert.deepEqual(
    stats.map((s) => [s.label, s.value, s.href]),
    [
      ["서울 아파트 84㎡ 매매", "11억 3,049만원", "./apartment-sale.html"],
      ["서울 아파트 84㎡ 전세", "6억 5,329만원", "./apartment-jeonse.html"],
      ["서울 아파트 월세", "보증금 22,166만원 / 월 96만원", "./apartment-rent.html"],
    ]
  );
  assert.equal(stats[0].note, "최근 4주 계약 575건 · 8/10 대비 +8.3%");
});

test("세 지표가 다 서지 않으면 지표 줄 자체를 만들지 않는다", () => {
  const thin = {
    window: { from: "2026-06-15", to: "2026-07-12", weeks: 4 },
    overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 3 }, jeonse: null, wolse: null },
  };
  assert.equal(buildRealestateStats(thin), null);
  assert.ok(!("realestateStats" in newsWith(thin)));
});

test("부동산 페이지에서 프리렌더와 화면 렌더가 같은 카드를 그린다", async () => {
  const news = newsWith(REALESTATE);
  const page = await loadNewsPage({ news, summary: { categories: [] }, category: "realestate" });

  assert.equal(page.byId("realestate-stats-section").hidden, false);
  assert.equal(page.byId("realestate-stats").innerHTML, newsRealestateStatsHtml(news));
});

test("부동산이 아닌 페이지에서는 지표 줄이 숨어 있다", async () => {
  const news = newsWith(REALESTATE);

  for (const category of [null, "stocks", "rates"]) {
    const page = await loadNewsPage({ news, summary: { categories: [] }, category });
    assert.equal(page.byId("realestate-stats-section").hidden, true, `${category ?? "전체"} 페이지에 지표가 떴다`);
  }
});

test("영어 화면은 카드도 영어로 그린다", async () => {
  const news = newsWith(REALESTATE);
  const page = await loadNewsPage({
    news,
    summary: { categories: [] },
    category: "realestate",
    locale: "en",
  });

  const html = page.byId("realestate-stats").innerHTML;
  assert.ok(html.includes("Seoul apartment 84㎡ sale"), "영어 라벨이 안 보인다");
  assert.ok(html.includes("575 deals in the last 4 weeks"), "영어 보조 설명이 안 보인다");
  assert.ok(!html.includes("11억 3,049만원"), "영어 화면에 한국어 표기가 남아 있다");
});

// 빌더 규칙: 지표 줄은 부동산 장에서만, 그리고 뉴스 데이터에 지표가 있을 때만 편다.
// 이 검사는 커밋된 데이터 값에 기대지 않는다 - 서울 전체 표본이 MIN_SAMPLE 아래면(신고 기준 첫 주처럼)
// 지표가 정당하게 비어 부동산 장도 접혀 나오는데, 예전 검사는 그날 데이터가 지표를 낼 거라 가정해
// 데일리 갱신(2026-10-06)이 바뀐 날부터 main과 데일리 수집 전 테스트를 막았다.
test("빌더는 부동산 장에서만, 지표가 있을 때만 지표 줄을 편다", async () => {
  const base = await readFile(path.join(root, "docs", "news.html"), "utf8");
  const summary = { categories: [] };
  const open = '<section id="realestate-stats-section">';
  const closed = '<section id="realestate-stats-section" hidden>';

  const withStats = newsWith(REALESTATE);
  const without = newsWith({ ...REALESTATE, overall: {} });
  assert.ok(withStats.realestateStats && !without.realestateStats, "검사 입력이 지표 유무를 못 가른다");

  for (const page of NEWS_PAGES) {
    const html = buildNewsPage(base, page, { news: withStats, summary });
    if (page.category === "realestate") {
      assert.ok(html.includes(open), "부동산 장에 지표가 안 펴졌다");
      assert.match(html, /<a class="stat-card" href="\.\/apartment-sale\.html">/);
    } else {
      assert.ok(html.includes(closed), `${page.file}에 지표가 펴져 있다`);
    }
    assert.ok(buildNewsPage(base, page, { news: without, summary }).includes(closed), `${page.file}: 지표가 없는데 펴졌다`);
  }
});

// 커밋된 페이지가 커밋된 뉴스 데이터와 맞는지(값이 아니라 일치만 본다) - 생성물이 낡았는지 잡는다.
test("커밋된 뉴스 페이지의 지표 줄이 커밋된 뉴스 데이터와 맞다", async () => {
  const news = JSON.parse(await readFile(path.join(root, "docs/data/news.json"), "utf8"));
  const stats = newsRealestateStatsHtml(news);

  for (const page of NEWS_PAGES) {
    const html = await readFile(path.join(root, "docs", page.file), "utf8");
    const shouldOpen = page.category === "realestate" && Boolean(stats);
    assert.equal(
      html.includes('<section id="realestate-stats-section">'),
      shouldOpen,
      `${page.file}의 지표 줄이 news.json과 어긋난다 - node scripts/build-news-pages.mjs`
    );
  }
});
