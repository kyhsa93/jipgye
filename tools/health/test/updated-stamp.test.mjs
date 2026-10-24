// 원본: test/updated-stamp.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readDataSources } from "../../../scripts/source-age.ts";
import { PAGE_SOURCES, baselineFor } from "../../../scripts/updated-stamp.ts";
import { SITE } from "../../../test/helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const DOCS = path.join(root, SITE);

test("저장소 docs: 찍힌 기준일이 그 장 소스의 가장 오래된 updatedAt과 같다 (오늘과 비교하지 않는다)", async () => {
  const sources = readDataSources(path.join(DOCS, "data"));
  for (const [file, names] of Object.entries(PAGE_SOURCES)) {
    const html = await readFile(path.join(DOCS, file), "utf8");
    const want = baselineFor(names, sources);
    assert.match(html, new RegExp(`id="updated" data-updated="${want}">기준일 ${want}<`), `${SITE}/${file}: 기준일이 ${want}이어야 한다 (node scripts/build-updated-stamp.ts)`);
  }
});
