// 원본: test/inline-comments.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stripJsComments, stripInlineScriptComments } from "../../../scripts/strip-inline-comments.ts";
import { districtBarsHtml } from "../../../scripts/district-bars.ts";
import { REALESTATE_TEMPLATE_PATH, applyPrerender, realestateHeadHtml, realestateOverallHtml, realestateTableHtml } from "../../../scripts/prerender.ts";
import { jsInlineScripts, proveCommentsOnly } from "../../../test/helpers/comment-proof.mjs";
import { stampSources } from "../../../scripts/source-lines.ts";
import { pageAssetHtml, stylesheetVersion } from "../../../scripts/page-assets.ts";
import { SITE } from "../../../test/helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const TEMPLATE = "scripts/realestate-template.html";

test("나가는 docs/realestate.html 은 틀을 채우고 훑개를 건 것뿐이다 - 스크립트는 주석만, 마크업은 표지 안과 기준일만 다르다 (#374)", async () => {
  // 출처 줄 자리표시({{src:…}}, #588)는 틀 채우기와 같은 길(applyPrerender)에서 꽂히므로 틀을 꽂은 글자로 견준다.
  // 최종 렌더가 찍는 CSS 내용 버전·기능 분류까지 재현한다. 출력에서 값을 베끼지 않는다.
  const version = stylesheetVersion(await read(`${SITE}/style.css`));
  const template = pageAssetHtml(stampSources(await read(TEMPLATE)), "realestate.html", version);
  const baked = await read(`${SITE}/realestate.html`);

  // 스크립트: 나가는 장의 인라인 스크립트는 틀의 것에서 훑개가 주석을 뗀 글자와 같고, 증명기(구문 + 지운 글자)도 통과한다.
  const a = jsInlineScripts(template);
  const b = jsInlineScripts(baked);
  assert.equal(a.length, b.length, "인라인 스크립트 수가 다르다");
  let removed = 0;
  for (let k = 0; k < a.length; k += 1) {
    assert.equal(b[k].body, stripJsComments(a[k].body), `${k + 1}번째 스크립트가 틀에서 주석만 뗀 것과 다르다`);
    const proof = proveCommentsOnly(a[k].body, b[k].body);
    assert.ok(proof.ok, `${k + 1}번째 스크립트: ${proof.chars.why ?? "구문이 다르다"}`);
    removed += proof.removed;
  }
  assert.ok(removed >= 40, `틀의 주석을 거의 못 뗐다(${removed}개) - 증명이 빈손이다`);

  // 마크업: 스크립트 본문을 비우고 표지 안쪽·기준일 줄을 접으면 둘이 글자까지 같다.
  const fold = (html) =>
    html
      .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2")
      .replace(/<!--prerender:(\w+)-->[\s\S]*?<!--\/prerender:\1-->/g, "<!--prerender:$1-->")
      .replace(/<div class="updated" id="updated"[^>]*>[^<]*<\/div>/, '<div class="updated" id="updated"></div>');
  assert.equal(fold(baked), fold(template), "표지 안과 기준일 말고도 틀과 다른 곳이 있다 - 생성물을 손으로 고쳤다");

  // 지금 데이터로 prerender.ts 가 하는 일(틀 채우기 -> 훑개)을 그대로 해 보면 커밋된 장과 같다(기준일 줄만 build-updated-stamp 가 마지막에 찍는다).
  const realestate = JSON.parse(await read("docs/data/realestate.json"));
  const stamp = (html) => html.replace(/<div class="updated" id="updated"[^>]*>[^<]*<\/div>/, '<div class="updated" id="updated"></div>');
  const rebuilt = stripInlineScriptComments(
    applyPrerender(template, {
      realestateOverall: realestateOverallHtml(realestate),
      realestateHead: realestateHeadHtml(),
      realestateTable: realestateTableHtml(realestate),
      districtBars: districtBarsHtml(realestate),
    })
  );
  assert.equal(stamp(baked), stamp(rebuilt), "커밋된 docs/realestate.html 이 지금 틀·데이터로 찍은 결과와 다르다 - 재굽기를 빠뜨렸거나 생성물을 손으로 고쳤다");
});
