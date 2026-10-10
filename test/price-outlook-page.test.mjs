import test from "node:test";
import assert from "node:assert/strict";

test("전망 화면: 성적표가 지표 표보다 위, 지표 표는 결론 한 줄 아래 접혀 있다 (#53)", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../docs/price-outlook.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('<section id="score-section">') < html.indexOf('<section id="indicator-section">'), "성적표가 아래다");
  const section = html.slice(html.indexOf('<section id="indicator-section">'));
  assert.ok(section.indexOf('id="indicator-lead"') < section.indexOf("<details"), "결론이 접힌 것 안에 있다");
  assert.ok(section.indexOf("<details") < section.indexOf('id="indicator-table"') && section.indexOf('id="indicator-table"') < section.indexOf("</details>"), "표가 접혀 있지 않다");
});

test("전망 화면에 앞으로 2년 서울 입주 예정이 빌드가 구운 그대로 실린다 (#60)", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../docs/price-outlook.html", import.meta.url), "utf8");
  const section = html.slice(html.indexOf('<section id="move-in-section">'), html.indexOf("</section>", html.indexOf('<section id="move-in-section">')));
  assert.ok(section, "입주 예정 절이 없다");
  assert.match(section, /<!--prerender:moveInLead-->한국부동산원·부동산114 추정/);
  assert.match(section, /<th scope="col">그중 순수 임대<\/th>/);
  assert.ok(html.indexOf('id="move-in-section"') < html.indexOf('id="indicator-section"'), "검증 안 된 지표 표보다 아래다");
});
