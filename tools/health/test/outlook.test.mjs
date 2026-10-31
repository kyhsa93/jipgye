// 원본: test/outlook.test.mjs 의 아래 시험을 옮겼다(#805, #507 과 같은 길). 경로 접두(../ 한 단 -> 세 단)와 읽는 장(docs/ 틀 -> build/site 의 찍은 장)만 다르다.
// 옮긴 이유: 손으로 고치는 틀 docs/price-outlook.html 에 남은 옛 구운 조각을 오늘 docs/data/outlook.json 과 맞대는 검사라, 공식 지수 달이 바뀌면(10-30 데일리) 결과가 갈린다(#8).
// 루트 `npm test`에는 고정 데이터로 같은 단언을 하는 짝이 test/fixture-site.test.mjs 에 있고, 이 판은 오늘 데이터와 그 생성물이 맞는지를 비차단으로 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "../../../test/helpers/site-root.mjs";
import { koOnly } from "../../../scripts/bilingual-cell.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

test("정적 HTML이 오늘 데이터의 문장과 표를 싣는다", async () => {
  const [html, data] = await Promise.all([
    readFile(path.join(root, `${SITE}/price-outlook.html`), "utf8"),
    readFile(path.join(root, "docs/data/outlook.json"), "utf8").then(JSON.parse),
  ]);
  const block = (name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];
  // #708: 표 칸은 한국어·영어 두 벌(m-ko·m-en)로 굽는다 - 영어 스팬을 걷고 한국어 스팬을 벗기면 json 의 한국어 조각이다.
  const ko = (name) => koOnly(block(name)).replace(/<span class="m-ko">([\s\S]*?)<\/span>/g, "$1");
  assert.equal(ko("outlookRegions"), data.tables.regions.ko);
  assert.equal(ko("outlookScore"), data.tables.score.ko);
  assert.ok(block("outlookLead")?.length > 20, "첫 문장이 비어 있다");
  // 화면은 빌드가 만든 두 언어를 고르기만 한다. 영어 표도 같이 와야 한다.
  assert.ok(data.tables.regions.en && data.lead.en && data.recordLead.en);
});
