// 원본: test/cross-input-dates.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readDataSources } from "../../../scripts/source-age.ts";
import { CROSS_PAGES, baselineFor } from "../../../scripts/updated-stamp.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const DOCS = path.join(root, "docs");

test("저장소 docs: 그 화면 전부의 정적 HTML에 입력별 기준일 줄이 있고, 값은 소스 updatedAt의 가장 오래된 날짜다", async () => {
  const sources = readDataSources(path.join(DOCS, "data"));
  for (const [file, inputs] of Object.entries(CROSS_PAGES)) {
    const html = await readFile(path.join(DOCS, file), "utf8");
    const deals = baselineFor(inputs.deals, sources);
    const rates = baselineFor(inputs.rates, sources);
    const line = `<p class="updated cross-basis" id="cross-basis" data-deals="${deals}" data-rates="${rates}">실거래 ${deals.slice(5)} x 금리 ${rates.slice(5)}</p>`;
    assert.ok(html.includes(line), `docs/${file}: 기준일 줄이 ${line} 이어야 한다 (node scripts/build-updated-stamp.ts)`);
    assert.equal([...html.matchAll(/id="cross-basis"/g)].length, 1, `docs/${file}: 기준일 줄이 한 번이어야 한다`);
    assert.match(html, /<p class="updated updated-warn" id="cross-warn" role="status" hidden><\/p>/, `docs/${file}: 경고 자리`);
  }
});
