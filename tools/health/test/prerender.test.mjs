// 원본: test/prerender.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyPrerender, escapeHtml, marketHtml, newsHtml, realestateHtml, summaryHtml } from "../../../scripts/prerender.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const readIndex = () => readFile(path.join(root, "docs/index.html"), "utf8");
const readData = async (name) =>
  JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8"));

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

  assert.equal(html, expected, "docs/index.html이 데이터와 어긋납니다. node scripts/prerender.ts를 실행하세요.");
});

test("크롤러가 받는 HTML에 오늘 기사 제목이 실제로 들어 있다", async () => {
  const [html, news] = await Promise.all([readIndex(), readData("news")]);
  // 첫 화면은 다섯 건만, 부동산 먼저 싣는다(#48) - 그 첫 건이 실려 있어야 한다.
  const { indexNewsItems } = await import("../../../scripts/prerender.ts");
  const first = indexNewsItems(news.items)[0];
  assert.ok(first, "기사가 한 건도 없다 - 수집이 통째로 실패했다");
  assert.ok(html.includes(escapeHtml(first.title)), "첫 기사 제목이 정적 HTML에 없다");
  assert.ok(html.includes(escapeHtml(first.link)), "첫 기사 링크가 정적 HTML에 없다");
});
