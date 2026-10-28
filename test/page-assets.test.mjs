import test from "node:test";
import assert from "node:assert/strict";
import { groupForPage, pageAssetHtml, stylesheetVersion } from "../scripts/page-assets.ts";

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
