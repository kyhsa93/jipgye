// 뉴스 분류 규칙(scripts/categories.ts)의 실제 오분류 회귀 사례와 빌드 때 다시 매기기(#745 PR6).
// 사례는 docs/data/news-history.json 에 실제로 잘못 들어갔던 제목이다(2026-10 기준). 규칙은 키워드·제외어뿐이다 - 유료 API 를 부르지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { categorizeTitle, categoryOf } from "../scripts/categories.ts";
import { NEWS_PAGES, buildNewsPage, recategorize } from "../scripts/build-news-pages.ts";
import { loadNewsPage } from "./helpers/news-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const key = (title) => categorizeTitle(title).key;

// 부동산이 아닌데 부동산으로 갔던 제목 → 맞는 분류.
const FALSE_REALESTATE = [
  ['"태국서만 月 1억씩 번다"…전세계서 난리 난 한국 식당 [권용훈의 트렌드워치]', "other"], // 「전세계」의 「전세」
  ['"한국서 먹히면 전세계 통한다"…강남 한복판 644평 매장 정체 [장서우의 하입:hype]', "other"],
  ["美, 전세계 비자 면접 일시 중단", "other"],
  ["[단독] 日·호주까지 기웃…빅테크, 전세계서 자금 긁어모은다", "other"],
  ["전세계 GDP 14% 묶은 거대블록 CPTPP…트럼프 시대 뜨거운 감자", "other"],
  ['"지금도 비싼데 더 오른다"…전세계 식량값 2027년까지 고공행진', "other"],
  ["후티 공격에 사우디 전세기 요금 급등", "other"], // 「전세기」
  ["[다음주 경제] 경제부처 국정감사 개막…은행권 해킹·세제 개편 등 쟁점", "other"], // 세법 전반의 「세제」
  ["[올댓차이나] 中 증시, 중동 불안·차익매물에 반락 마감…창업판 0.45%↓", "stocks"], // 증시의 「차익매물」
  ["[올댓차이나] 홍콩 증시, 기술주에 이익매물로 나흘째 속락 마감… H주 1.02%↓", "stocks"],
  ["[올댓차이나] 대만 증시, 차익매물로 엿새 만에 소폭 반락…0.03%↓", "stocks"],
  ["전세계 국채시장 매도 폭풍…美 10년물 4.8%·日 30년 만 최고", "other"],
];

// 부동산인데 기타로 갔던 제목(「집값」·「종부세」를 키워드로 몰랐다).
const MISSED_REALESTATE = [
  "LH 사장 “집값 상승은 前정부 공급부족 탓…공급 본격화하면 폭락”",
  '"집값 2035년까지 오른다…지금이라도 내집마련 해야" 대학교수의 조언',
  "서울 집값 89주째 상승…'반도체 벨트'도 강세",
  "집값 5000만원 차이에 비거주 종부세 200만원↑…보완할까?",
];

// 바뀌면 안 되는 제목(제외어가 진짜 부동산 기사를 놓치지 않는다).
const KEEP = [
  ["바짝 마른 '전세 가뭄' … 서울 아파트 월세 비중 처음으로 55% 넘어", "realestate"],
  ['국토부 "강남 집값 떨어지고 매물 쌓여…시장 하향 안정 신호"', "realestate"],
  ['"전세사기 피해 외국인도 지원해야"…경기도, 국토부에 건의', "realestate"],
  ['"아파트 서로 바꿉시다"…세제 개편에 \'교환 거래\' 최고치', "realestate"],
  ["전세계 집값 들썩…서울 아파트도 신고가", "realestate"], // 제외어를 지워도 다른 키워드가 남으면 부동산
  ["국고채 금리 일제히 상승…3년물 연 3.778%", "rates"],
  // cto 판정(#755): 제외어 「전세계」·「전세기」가 「전세계약」·「전세기간」을 먹지 않는다.
  ["전세계약 갱신 거절 급증", "realestate"],
  ["서울 전세계약 10건 중 4건 갱신", "realestate"],
  ["전세계약갱신청구권 4년", "realestate"],
  ["전세기간 만료 앞둔 세입자", "realestate"],
  ["코스피, 1%대 상승…코스닥은 하락", "stocks"],
];

test("실제 오분류 회귀: 부동산이 아닌 제목은 부동산으로 가지 않는다(전세계·전세기·차익매물·세제 개편) (#745 PR6)", () => {
  for (const [title, want] of FALSE_REALESTATE) assert.equal(key(title), want, title);
});

test("실제 오분류 회귀: 「집값」·「종부세」 기사는 부동산이다 (#745 PR6)", () => {
  for (const title of MISSED_REALESTATE) assert.equal(key(title), "realestate", title);
});

test("제외어가 진짜 부동산·금리·증시 기사를 바꾸지 않는다 (#745 PR6)", () => {
  for (const [title, want] of KEEP) assert.equal(key(title), want, title);
  assert.equal(key(null), "other");
  assert.equal(categoryOf({ title: "아파트", category: "rates" }).key, "rates", "categoryOf 는 저장된 분류를 먼저 쓴다(수집 쪽 동작 그대로)");
});

const NEWS = {
  updatedAt: "2026-10-24T00:00:00Z",
  items: [
    { title: '"태국서만 月 1억씩 번다"…전세계서 난리 난 한국 식당', link: "https://e.com/thai?a=1&b=2", source: "한국경제 경제", category: "realestate" },
    { title: "서울 집값 89주째 상승", link: "https://e.com/up", source: "뉴시스 경제", category: "other" },
    { title: "서울 아파트 전세 8억", link: "https://e.com/apt", source: "한국경제 부동산", category: "realestate" },
  ],
};

test("빌드는 저장된 분류를 규칙으로 다시 매겨 굽고, 화면 스크립트에 같은 표(data-recat)를 넘긴다 (#745 PR6)", async () => {
  assert.deepEqual(recategorize(NEWS), { "https://e.com/thai?a=1&b=2": "other", "https://e.com/up": "realestate" });
  assert.deepEqual(recategorize({ items: [] }), {});
  assert.deepEqual(recategorize(null), {});
  const baseHtml = await read("docs/news.html");
  const page = NEWS_PAGES.find((p) => p.category === "realestate");
  const html = buildNewsPage(baseHtml, page, { news: NEWS, summary: { categories: [] }, market: null });
  const list = html.slice(html.indexOf("<!--prerender:newsList-->"), html.indexOf("<!--/prerender:newsList-->"));
  assert.ok(!list.includes("태국"), "오분류 기사가 부동산 장에 구워졌다");
  assert.ok(list.includes("서울 집값 89주째 상승") && list.includes("서울 아파트 전세 8억"));
  const meta = html.match(/<meta name="news-category" content="realestate" data-recat="([^"]*)">/);
  assert.ok(meta, "분야 meta 에 data-recat 이 없다");
  assert.deepEqual(JSON.parse(meta[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&")), recategorize(NEWS));
  // 다시 매길 것이 없으면 속성을 달지 않는다.
  const plain = buildNewsPage(baseHtml, page, { news: { items: [NEWS.items[2]] }, summary: { categories: [] }, market: null });
  assert.ok(plain.includes('<meta name="news-category" content="realestate">\n'));
});

test("화면 스크립트는 data-recat 으로 받은 news.json 을 같은 분류로 거른다 (#745 PR6)", async () => {
  const recat = JSON.stringify(recategorize(NEWS));
  const page = await loadNewsPage({ news: NEWS, summary: { categories: [] }, category: "realestate", file: "docs/news.html" });
  // 표가 없으면(빈 표) 옛 분류 그대로다 - 스크립트가 표를 쓰는지 대조군.
  assert.ok(page.newsListHtml().includes("태국"));
  const withRecat = await loadNewsPage({
    news: NEWS,
    summary: { categories: [] },
    category: "realestate",
    mutate: (s) => s.replace('meta?.getAttribute("data-recat")', `${JSON.stringify(recat)}`),
  });
  const html = withRecat.newsListHtml();
  assert.ok(!html.includes("태국"), "오분류 기사가 화면 목록에 남았다");
  assert.ok(html.includes("서울 집값 89주째 상승") && html.includes("서울 아파트 전세 8억"));
});

test("뉴스 화면 안의 제목 거르기: 입력 상자와 거르는 함수가 있고, 통합 검색과 이름이 다르다 (#745 PR6)", async () => {
  const html = await read("docs/news.html");
  assert.ok(html.includes('<input type="search" id="news-q"'), "제목 거르기 입력이 없다");
  assert.ok(/<label class="news-filter" id="news-filter"><span class="m-ko">기사 제목에서 찾기<\/span><span class="m-en">Filter headlines<\/span>/.test(html));
  assert.ok(html.includes('document.getElementById("news-q").addEventListener("input", filterNews);'));
  // 목록을 다시 그린 뒤에도(언어 전환·데이터 도착) 거르기가 다시 걸린다.
  const render = html.slice(html.indexOf("function renderNews()"), html.indexOf("function filterNews()"));
  assert.ok(render.includes("filterNews();"));
});
