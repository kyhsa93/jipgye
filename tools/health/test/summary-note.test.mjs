// 원본: test/summary-note.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES } from "../../../scripts/build-news-pages.ts";
import { FALLBACK_NOTE_KO, hasFallback } from "../../../scripts/summary-note.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

/** 구운 HTML 에서 #summary-box 안쪽(자리표시 주석 사이)만 꺼낸다. */
const boxOf = (html, marker) => {
  const open = `<!--prerender:${marker}-->`;
  const a = html.indexOf(open);
  const b = html.indexOf(`<!--/prerender:${marker}-->`);
  assert.ok(a > 0 && b > a, `${marker} 자리표시를 찾지 못했다`);
  return html.slice(a + open.length, b);
};

test("커밋된 구운 장 다섯의 안내 줄 유무가 summary.json 과 맞는다 - 데이터가 바뀌면 다시 구워야 한다 (#350)", async () => {
  const summary = await readJson("summary");
  const noteOf = (html, cls) => html.includes(`<div class="${cls}">${FALLBACK_NOTE_KO}</div>`);

  const index = boxOf(await read("docs/index.html"), "summary");
  assert.equal(noteOf(index, "summary-fallback-note"), hasFallback(summary.categories), "docs/index.html 의 안내 줄이 summary.json 과 어긋난다. node scripts/prerender.ts 를 실행하세요.");

  const hub = boxOf(await read("docs/news.html"), "newsSummary");
  assert.equal(noteOf(hub, "summary-note"), hasFallback(summary.categories.filter((c) => c.lineKo)), "docs/news.html 의 안내 줄이 summary.json 과 어긋난다.");
  for (const page of NEWS_PAGES) {
    const box = boxOf(await read(`docs/${page.file}`), "newsSummary");
    const shown = summary.categories.filter((c) => c.key === page.category && c.lineKo);
    assert.equal(noteOf(box, "summary-note"), hasFallback(shown), `docs/${page.file} 의 안내 줄이 summary.json 과 어긋난다. node scripts/build-news-pages.ts 를 실행하세요.`);
  }
});
