// 원본: test/indicator-backtest.test.mjs 의 아래 두 시험을 옮겼다(#805, #507 과 같은 길). 경로 접두(../ 한 단 -> 세 단)와 읽는 장(docs/ 틀 -> build/site 의 찍은 장)만 다르다.
// 옮긴 이유: 손으로 고치는 틀 docs/price-outlook.html 에 남은 옛 구운 조각을 오늘 docs/data/outlook-indicators.json 과 맞대는 검사라, 공식 지수 달이 바뀌면(10-30 데일리) 결과가 갈린다(#8).
// 루트 `npm test`에는 고정 데이터로 같은 단언을 하는 짝이 test/fixture-site.test.mjs 에 있고, 이 판은 오늘 데이터와 그 생성물이 맞는지를 비차단으로 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "../../../test/helpers/site-root.mjs";
import { koOnly } from "../../../scripts/bilingual-cell.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = () =>
  Promise.all([
    readFile(path.join(root, `${SITE}/price-outlook.html`), "utf8"),
    readFile(path.join(root, "docs/data/outlook-indicators.json"), "utf8").then(JSON.parse),
  ]);
// #708: 표 칸은 한국어·영어 두 벌(m-ko·m-en)로 굽는다 - 영어 스팬을 걷고 한국어 스팬을 벗기면 json 의 한국어 조각이다.
const indicatorKo = (html) =>
  koOnly(html.match(/<!--prerender:indicatorTable-->([\s\S]*?)<!--\/prerender:indicatorTable-->/)?.[1] ?? "").replace(/<span class="m-ko">([\s\S]*?)<\/span>/g, "$1");

test("정적 HTML이 오늘 판정 표를 싣는다", async () => {
  const [html, data] = await read();
  assert.equal(indicatorKo(html), data.table.ko);
  assert.ok(data.lead.en && data.table.en);
});

test("표 끝에 백테스트에 못 들어간 건축HUB 주택인허가 한 행이 정적으로 붙고, 매일 판정 행 수는 그대로다 (#153)", async () => {
  const { NOT_TESTED } = await import("../../../scripts/indicator-backtest.ts");
  const [html, payload] = await read();
  assert.equal(NOT_TESTED.length, 1);
  // 판정 행(payload.rows)에는 정적 행이 섞이지 않는다 - 판정식·합격선은 건드리지 않았다.
  assert.ok(payload.rows.every((r) => r.id && r.verdict), "정적 행이 판정 행에 섞였다");
  const bodyRows = (h) => (h.match(/<tr>/g) ?? []).length - 1; // 머리 한 줄 제외
  assert.equal(bodyRows(payload.table.ko), payload.rows.length + NOT_TESTED.length);
  assert.equal(bodyRows(payload.table.en), payload.rows.length + NOT_TESTED.length);
  // 정적 HTML(ko)은 JSON 표 그대로이고, 접근성 caption 행 수도 맞다.
  assert.equal(indicatorKo(html), payload.table.ko, "정적 HTML 표가 JSON과 다르다");
  assert.ok(html.includes(`${bodyRows(payload.table.ko)}행 4열`), "caption 행 수가 표와 다르다");
  assert.equal(html.split("건축HUB 주택인허가</td>").length - 1, 1);
  assert.equal(payload.table.en.split("Building HUB housing permits</td>").length - 1, 1);
});
