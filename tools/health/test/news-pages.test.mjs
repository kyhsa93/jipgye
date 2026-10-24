// 원본: test/news-pages.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES, buildNewsPage } from "../../../scripts/build-news-pages.ts";
import { SITE } from "../../../test/helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

test("커밋된 카테고리 페이지가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, news, summary, market] = await Promise.all([read(`${SITE}/news.html`), readJson("news"), readJson("summary"), readJson("market")]);

  for (const page of NEWS_PAGES) {
    const built = buildNewsPage(baseHtml, page, { news, summary, market });
    assert.equal(
      await read(`${SITE}/${page.file}`),
      built,
      `${SITE}/${page.file}이 원본과 어긋납니다. node scripts/build-news-pages.ts를 실행하세요.`
    );
  }
});
