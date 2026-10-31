// 원본: test/district-change.test.mjs 의 "빌드된 갈아타기 자료에서 금액과 %가 25개 구 모두 맞는다"(#520 이전 판) 단언을 옮겼다(#524). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 docs/data/district-change.json 안 두 수(줄의 %와 84㎡ 환산 금액)의 관계라 데이터가 한쪽만 바뀐 모양(합성 교란: 모든 수 +1)에서 결과가 갈린다 -
// 루트 `npm test`에는 합성 거래로 같은 빌더(buildPayload)를 돌려 같은 단언을 하는 판이 남아 있고(코드 쪽 약속), 이 판은 오늘 커밋된 파일이 그 약속을 지키는지(데이터 쪽)를 비차단으로 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "../../../test/helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

test("커밋된 갈아타기 자료(docs/data/district-change.json)에서 금액과 %가 25개 구 모두 맞는다", async () => {
  const d = JSON.parse(await readFile(path.join(root, "docs/data/district-change.json"), "utf8"));
  const rows = d.rows.filter((r) => r.change !== null && r.level84);
  assert.ok(rows.length >= 20, "값을 낸 구가 거의 없다 - 검사가 아무것도 안 본다");
  for (const r of rows) {
    const money = (r.level84.recent / r.level84.base - 1) * 100;
    assert.ok(Math.abs(money - r.change) < 0.15, `${r.name}: 줄은 ${r.change}%, 금액은 ${money.toFixed(2)}%`);
  }
});

// 원본: test/district-change.test.mjs 의 "정적 HTML이 오늘 데이터의 문장과 표를 싣는다"를 옮겼다(#805, #507 과 같은 길). 읽는 장만 docs/ 틀 -> build/site 의 찍은 장이다.
// 옮긴 이유: 손으로 고치는 틀 docs/switch-house.html 에 남은 옛 구운 조각을 오늘 docs/data/district-change.json 과 맞대는 검사라, 공식 지수 달이 바뀌면(10-30 데일리) 결과가 갈린다(#8).
// 루트 `npm test`에는 고정 데이터로 같은 단언을 하는 짝이 test/fixture-site.test.mjs 에 있다.
test("정적 HTML이 오늘 데이터의 문장과 표를 싣는다", async () => {
  const [html, data] = await Promise.all([
    readFile(path.join(root, `${SITE}/switch-house.html`), "utf8"),
    readFile(path.join(root, "docs/data/district-change.json"), "utf8").then(JSON.parse),
  ]);
  const block = (name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];
  assert.equal(block("switchTable"), data.table.ko);
  assert.equal(block("switchRegions"), data.regionTable.ko);
  assert.ok(data.lead.en && Object.keys(data.pairs).length > 0);
});
