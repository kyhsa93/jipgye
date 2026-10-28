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
