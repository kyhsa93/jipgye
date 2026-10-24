// 원본: test/complex-ratio.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { formatPercent } from "../../../scripts/realestate-format.ts";
import { SITE } from "../../../test/helpers/site-root.mjs";

test("정적 HTML과 자바스크립트가 같은 카드를 그린다", async () => {
  const { readFile } = await import("node:fs/promises");
  const { loadRealestatePage } = await import("../../../test/helpers/realestate-page.mjs");
  const root = path.resolve(import.meta.dirname, "..", "..", "..");
  const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

  const [realestate, complexRatio] = await Promise.all([readJson("realestate"), readJson("complex-ratio")]);
  const district = "노원구";
  const spread = complexRatio.districts[district];
  assert.ok(spread, `${district}에 분포가 없다 - 다른 구로 검사를 바꿔야 한다`);

  // 56.0처럼 정수로 떨어지는 날에도 화면은 "56.0%"를 적는다. 숫자를 그대로 붙이면 "56%"를 찾는다.
  const shown = formatPercent(spread.median).replace(".", "\\.");

  // 정적 HTML에 들어 있는 값
  const html = await readFile(path.join(root, `${SITE}/district-nowon.html`), "utf8");
  assert.match(html, new RegExp(`단지별 중앙값</div><div class="value">${shown}`));

  // 자바스크립트가 붙은 뒤의 값. 다르면 화면이 한 번 튄다.
  const page = await loadRealestatePage({ realestate, complexRatio, district });
  for (let i = 0; i < 200 && !String(page.byId("overall-cards").innerHTML).includes("단지별"); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const rendered = String(page.byId("overall-cards").innerHTML);
  assert.match(rendered, new RegExp(`단지별 중앙값</div><div class="value">${shown}`));
  assert.match(rendered, new RegExp(`단지·평형 ${spread.cells.toLocaleString("ko-KR")}칸`));
});
