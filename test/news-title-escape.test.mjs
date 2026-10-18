import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Parser from "rss-parser";
import { normalizeFeedTitle } from "../scripts/article-body.mjs";
import { newsListHtml } from "../scripts/prerender.mjs";

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

// fetch-news.mjs는 import하면 main()이 돌아 불러 쓸 수 없다. 수집이 풀이 함수를 거치는지는 소스로 지킨다.
test("fetch-news.mjs가 피드 제목을 normalizeFeedTitle로 거친다 (#354)", async () => {
  const src = await readFile(new URL("../scripts/fetch-news.mjs", import.meta.url), "utf8");
  assert.match(src, /const title = normalizeFeedTitle\(item\.title\);/);
});
