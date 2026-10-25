// 원본: test/record-high.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "../../../test/helpers/site-root.mjs";
import { koOnly } from "../../../scripts/bilingual-cell.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

test("정적 HTML이 오늘 데이터의 문장과 표를 싣는다", async () => {
  const [html, data] = await Promise.all([
    readFile(path.join(root, `${SITE}/record-high.html`), "utf8"),
    readFile(path.join(root, "docs/data/record-high.json"), "utf8").then(JSON.parse),
  ]);
  const block = (name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];
  // #708: 표 칸은 한국어·영어 두 벌(m-ko·m-en)로 굽는다 - 영어 스팬을 걷고 한국어 스팬을 벗기면 json 의 한국어 조각이다.
  const ko = (name) => koOnly(block(name)).replace(/<span class="m-ko">([\s\S]*?)<\/span>/g, "$1");
  assert.equal(ko("recordRobust"), data.tables.robust.ko);
  assert.equal(ko("recordDistricts"), data.tables.districts.ko);
  assert.equal(ko("recordBands"), data.tables.bands.ko);
  assert.ok(block("recordLead")?.includes(String(data.main.record)), "첫 문장이 오늘 숫자를 싣지 않는다");
  assert.ok(data.lead.en && data.tables.robust.en);
});
