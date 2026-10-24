// 원본: test/summary-box.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { summaryHtml } from "../../../scripts/prerender.ts";
import { SITE } from "../../../test/helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

test("커밋된 구운 index.html 의 상자가 summary.json 으로 다시 찍은 것과 같다 - 데이터가 바뀌면 다시 구워야 한다 (#352)", async () => {
  const [html, summary] = await Promise.all([read(`${SITE}/index.html`), readJson("summary")]);
  const a = html.indexOf("<!--prerender:summary-->") + "<!--prerender:summary-->".length;
  const baked = html.slice(a, html.indexOf("<!--/prerender:summary-->"));
  const strip = (h) => h.replace(/<span class="summary-meta">[^<]*<\/span>$/, "");
  assert.equal(strip(baked), strip(summaryHtml.legacy(summary)), "docs/index.html 의 구운 상자가 summary.json 과 어긋난다. node scripts/prerender.ts 를 실행하세요.");
  // 날짜 글자는 ICU 판에 따라 달라질 수 있어 형태만 본다(같은 판 안의 정확한 글자는 위 스크립트 대조가 본다).
  const meta = baked.match(/<span class="summary-meta">([^<]*)<\/span>$/)?.[1];
  assert.match(meta ?? "", /^.+ 생성 · \d{4}\. \d{1,2}\. \d{1,2}\. (오전|오후) \d{1,2}:\d{2} KST$/, ".summary-meta 의 형태가 다르다");
});
