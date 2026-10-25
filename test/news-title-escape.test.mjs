import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Parser from "rss-parser";
import { normalizeFeedTitle } from "../scripts/article-body.ts";
import { newsListHtml } from "../scripts/prerender.ts";
import { loadNewsPage } from "./helpers/news-page.mjs";

// #354: 뉴시스 RSS 제목은 `<![CDATA[...S&amp;P...]]>`로 온다. rss-parser는 CDATA 안을 풀지 않아 저장값에 `&amp;`가 남았고,
// 굽는 쪽 escapeHtml이 한 번 더 감싸 구운 HTML에 `S&amp;amp;P`가 실렸다(브라우저는 `S&amp;P` 글자 그대로 그린다).
// 네트워크 없이 픽스처 XML만 쓴다.
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>fixture</title>
<item><title><![CDATA[[속보] 뉴욕증시 혼조 출발…다우·S&amp;P↑·나스닥↓]]></title><link>https://example.test/cdata</link></item>
<item><title>뉴욕증시 강세…S&amp;P500 사상 최고치</title><link>https://example.test/plain</link></item>
<item><title>두 번 감싼 피드…S&amp;amp;P 지수</title><link>https://example.test/double</link></item>
<item><title>  &quot;금리&quot; &#38; 환율 &lt;속보&gt;  </title><link>https://example.test/misc</link></item>
</channel></rss>`;

const parsedTitles = async () => (await new Parser().parseString(FEED)).items.map((i) => normalizeFeedTitle(i.title));

test("RSS 제목은 CDATA 안이든 두 번 감싼 것이든 엔티티가 풀린 글자로 저장된다 (#354)", async () => {
  assert.deepEqual(await parsedTitles(), [
    "[속보] 뉴욕증시 혼조 출발…다우·S&P↑·나스닥↓",
    "뉴욕증시 강세…S&P500 사상 최고치",
    "두 번 감싼 피드…S&P 지수",
    '"금리" & 환율 <속보>',
  ]);
});

test("저장된 제목은 굽는 쪽에서 정확히 한 번만 이스케이프된다 — amp;amp; 가 없다 (#354)", async () => {
  const items = (await parsedTitles()).map((title, i) => ({ title, link: `https://example.test/${i}`, source: "fixture", category: "stocks" }));
  const html = newsListHtml({ items });
  assert.ok(!html.includes("amp;amp;"), "이중 이스케이프가 구운 HTML에 남았다");
  assert.ok(html.includes("다우·S&amp;P↑·나스닥↓"), "S&P는 구운 HTML에서 `&amp;` 한 겹이어야 한다");
  assert.ok(html.includes("&quot;금리&quot; &amp; 환율 &lt;속보&gt;"));
});

test("normalizeFeedTitle: 없는 제목은 빈 문자열, 모르는 엔티티는 그대로 둔다", () => {
  assert.equal(normalizeFeedTitle(undefined), "");
  assert.equal(normalizeFeedTitle(null), "");
  assert.equal(normalizeFeedTitle("AT&T; &unknownentity; 끝"), "AT&T; &unknownentity; 끝");
});

// fetch-news.ts는 import하면 main()이 돌아 불러 쓸 수 없다. 수집이 풀이 함수를 거치는지는 소스로 지킨다.
test("fetch-news.ts가 피드 제목을 normalizeFeedTitle로 거친다 (#354)", async () => {
  const src = await readFile(new URL("../scripts/fetch-news.ts", import.meta.url), "utf8");
  assert.match(src, /const title = normalizeFeedTitle\(item\.title\);/);
});

// 저장값이 엔티티가 풀린 순수 글자가 되면(위) 소비자마다 자기 몫의 이스케이프를 해야 한다. 기사 목록은 news.html 의
// renderNews 가 제목을 innerHTML 에 넣는다 — 여기서 한 번 감싸지 않으면 제목의 `<`·`>` 가 태그로 읽힌다.
// (전에는 index.html 의 오늘 뉴스 칸을 봤다 - 그 칸은 #575 PR2 에서 뉴스 화면으로 옮겼다.)
// 인라인 스크립트를 helpers/news-page.mjs 의 vm 샌드박스에서 돌려 renderNews 가 쓴 #news-list 를 본다.
test("news.html 기사 목록은 제목·출처의 `<`·`>`·`&` 를 정확히 한 번 이스케이프한다 (#354)", async () => {
  const hostile = { title: "<img src=x onerror=1> S&P <ESG 경영>", source: "A&B <b>", link: "https://example.test/h", category: "stocks" };
  const page = await loadNewsPage({ news: { items: [hostile] }, summary: { categories: [] } });
  for (let i = 0; i < 200 && !String(page.byId("news-list").innerHTML).includes("news-item"); i += 1) await new Promise((r) => setTimeout(r, 5));
  const html = String(page.byId("news-list").innerHTML);
  assert.ok(html.includes("news-item"), "기사 목록이 그려지지 않았다");
  assert.ok(!html.includes("<img"), "제목의 <img 가 태그로 실렸다");
  assert.ok(!html.includes("<b>"), "출처의 <b> 가 태그로 실렸다");
  assert.ok(html.includes("&lt;img src=x onerror=1&gt; S&amp;P &lt;ESG 경영&gt;"), "제목이 한 겹 이스케이프로 실리지 않았다");
  assert.ok(html.includes("A&amp;B &lt;b&gt;"), "출처가 한 겹 이스케이프로 실리지 않았다");
  assert.ok(!html.includes("&amp;amp;") && !html.includes("&amp;lt;"), "이중 이스케이프");
});
