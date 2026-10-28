import test from "node:test";
import assert from "node:assert/strict";
import { groupForPage, pageAssetHtml, stylesheetVersion } from "../scripts/page-assets.ts";
import { readFile, readdir } from "node:fs/promises";
import { sitePath } from "./helpers/site-root.mjs";

test("스타일 내용이 바뀌면 새 URL, 같은 내용은 같은 URL, 다시 찍어도 같다", () => {
  const before = '<meta name="site-group" content="digest"><link rel="stylesheet" href="./style.css">';
  const a = stylesheetVersion('body{color:navy}'), b = stylesheetVersion('body{color:teal}');
  assert.notEqual(a, b);
  assert.equal(a, stylesheetVersion('body{color:navy}'));
  const stamped = pageAssetHtml(before, "deal-search.html", a);
  assert.ok(stamped.includes(`href="./style.css?v=${a}"`));
  assert.equal(pageAssetHtml(stamped, "deal-search.html", a), stamped);
  assert.ok(pageAssetHtml(stamped, "deal-search.html", b).includes(`?v=${b}`));
  assert.ok(stamped.includes('content="search"'));
  assert.equal(pageAssetHtml('<script src="./analytics.js"></script>', "index.html", a), '<script src="./analytics.js"></script>');
});

test("주요 기능과 생성된 지역·예산·뉴스 변형이 같은 분류를 쓴다", () => {
  for (const [file, group] of Object.entries({ "index.html":"overview", "jeonse-vs-wolse.html":"calculators", "renewal-vs-new.html":"calculators", "realestate.html":"prices", "district-nowon.html":"prices", "apartment-rent.html":"prices", "budget-10eok.html":"budget", "stock-news.html":"news", "price-outlook.html":"outlook", "cancelled-deals.html":"analysis", "method.html":"info" })) assert.equal(groupForPage(file), group);
});

test("배포되는 모든 페이지가 현재 CSS 버전과 기능별 계측 분류를 싣는다", async () => {
  const version = stylesheetVersion(await readFile(sitePath("style.css")));
  const files = (await readdir(sitePath("."))).filter(file => file.endsWith(".html"));
  assert.ok(files.length > 50, "생성된 지역·예산 페이지까지 검사해야 한다");
  for (const file of files) {
    const html = await readFile(sitePath(file), "utf8");
    if (html.includes('./style.css')) {
      assert.ok(html.includes(`href="./style.css?v=${version}"`), `${file}: CSS가 현재 내용의 버전과 다르다`);
      assert.ok(!html.includes('href="./style.css"'), `${file}: 버전 없는 CSS가 남았다`);
    }
    if (html.includes('name="site-group"')) {
      assert.ok(html.includes(`<meta name="site-group" content="${groupForPage(file)}">`), `${file}: 기능 분류가 다르다`);
    }
  }
});

// 장 전용 외부 JS 주석 떼기(#784): 나가는 사본(build/site)에서만, 주석만 뗀다. 소스(docs/)와 공용 셸 JS·sw.js 는 그대로다.
test("장 전용 JS 는 나가는 사본에서 주석만 떼고, 셸 JS·sw.js·docs/ 는 건드리지 않는다 (#784)", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const { pageScripts, stripPageScripts } = await import("../scripts/page-assets.ts");
  const { findJsComments } = await import("../scripts/strip-inline-comments.ts");
  const { proveCommentsOnly } = await import("./helpers/comment-proof.mjs");
  const { SITE } = await import("./helpers/site-root.mjs");
  const root = path.resolve(import.meta.dirname, "..");
  const docs = path.join(root, "docs");
  const site = path.join(root, SITE);
  const sw = await readFile(path.join(docs, "sw.js"), "utf8");
  const shell = [...sw.matchAll(/"\.\/([\w-]+\.js)"/g)].map((m) => m[1]);
  assert.ok(shell.includes("nav.js") && shell.includes("analytics.js"), "sw.js 사전캐시 목록을 못 읽었다");
  const page = pageScripts(docs);
  assert.ok(page.includes("renewal-convert.js") && page.includes("lease-expiry.js"), `장 전용 목록: ${page}`);
  assert.deepEqual(page.filter((f) => shell.includes(f) || f === "sw.js"), []);
  assert.deepEqual((await readdir(docs)).filter((f) => f.endsWith(".js")).sort(), [...page, ...shell, "sw.js"].sort(), "docs/*.js 가 장 전용·셸·sw 셋으로 다 나뉘어야 한다");
  assert.equal(stripPageScripts({ siteRoot: docs, io: { read: () => { throw new Error("docs/ 를 읽었다"); }, write: () => { throw new Error("docs/ 를 고쳤다"); } } }), 0);
  if (SITE === "docs") return; // 소스 틀로 돌릴 때는 나가는 사본이 없다
  for (const name of page) {
    const before = await readFile(path.join(docs, name), "utf8");
    const after = await readFile(path.join(site, name), "utf8");
    assert.deepEqual(findJsComments(after), [], `${name}: 나가는 사본에 주석이 남았다`);
    if (before !== after) assert.ok(proveCommentsOnly(before, after).ok, `${name}: 주석 말고 다른 것이 바뀌었다`);
  }
  for (const name of [...shell, "sw.js"]) {
    assert.equal(await readFile(path.join(site, name), "utf8"), await readFile(path.join(docs, name), "utf8"), `${name}: 셸 JS 가 바뀌었다`);
  }
});
