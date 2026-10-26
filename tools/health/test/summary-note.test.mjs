// 원본: test/summary-note.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES } from "../../../scripts/build-news-pages.ts";
import { failedLineKo } from "../../../scripts/summary-note.ts";
import { SITE } from "../../../test/helpers/site-root.mjs";

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

test("커밋된 구운 장 다섯에서 검증 폴백 분야는 실패 줄로 나온다 - 데이터가 바뀌면 다시 구워야 한다 (#350 → #745 PR6)", async () => {
  const summary = await readJson("summary");
  const check = (box, shown, where) => {
    for (const c of shown) {
      assert.equal(box.includes(failedLineKo(c.fallbackReason)), Boolean(c.fallbackReason), `${where}: ${c.key} 의 실패 줄 유무가 summary.json 과 어긋난다. node scripts/build-news-pages.ts 를 실행하세요.`);
    }
  };
  // 메인 요약 상자는 #575 PR2 에서 뉴스 화면으로 옮겼다 - 장 다섯은 뉴스 장 넷(허브 포함)이다.
  check(boxOf(await read(`${SITE}/news.html`), "newsSummary"), summary.categories.filter((c) => c.lineKo), `${SITE}/news.html`);
  for (const page of NEWS_PAGES) {
    check(boxOf(await read(`${SITE}/${page.file}`), "newsSummary"), summary.categories.filter((c) => c.key === page.category && c.lineKo), `${SITE}/${page.file}`);
  }
});
