import test from "node:test";
import assert from "node:assert/strict";
import { accessibleTables } from "../scripts/table-a11y.mjs";

const PAGE = (table) =>
  `<html><head><title>서울 아파트 시세</title></head><body><h2>자치구별</h2>${table}</body></html>`;
const TABLE =
  `<table class="t"><thead><tr><th>자치구</th><th>평당가</th></tr></thead>` +
  `<tbody><tr><th>강남구</th><td>1</td></tr><tr><td>서초구</td><td>2</td></tr></tbody></table>`;

test("머리글에는 scope=col, 본문 행 머리글에는 scope=row를 단다", () => {
  const out = accessibleTables(PAGE(TABLE));
  assert.match(out, /<th scope="col">자치구<\/th><th scope="col">평당가<\/th>/);
  assert.match(out, /<tbody><tr><th scope="row">강남구<\/th>/);
});

test("이미 scope가 있으면 건드리지 않는다", () => {
  const html = PAGE(TABLE.replace("<th>자치구</th>", '<th scope="colgroup">자치구</th>'));
  assert.match(accessibleTables(html), /<th scope="colgroup">자치구<\/th>/);
});

test("caption에 장 제목·소제목·행 수·열 수가 들어가고 화면에서는 숨는다", () => {
  const out = accessibleTables(PAGE(TABLE));
  assert.match(out, /<caption class="sr-only" data-auto>서울 아파트 시세 - 자치구별: 2행 2열\(자치구·평당가\)<\/caption>/);
  // caption은 표 안 첫 자식이어야 한다.
  assert.match(out, /<table class="t"><caption/);
});

test("행이 없는 표는 행 수를 지어 쓰지 않고, 머리글도 없으면 제목만 쓴다", () => {
  const noRows = accessibleTables(PAGE(`<table><thead><tr><th>a</th></tr></thead><tbody></tbody></table>`));
  assert.match(noRows, /자치구별: 1열\(a\)/);
  assert.doesNotMatch(noRows, /행/);
  const empty = accessibleTables(PAGE(`<table><thead></thead><tbody></tbody></table>`));
  assert.match(empty, /<caption[^>]*>서울 아파트 시세 - 자치구별<\/caption>/);
});

test("다시 돌려도 같고, 행이 늘면 낡은 숫자가 남지 않는다", () => {
  const once = accessibleTables(PAGE(TABLE));
  assert.equal(accessibleTables(once), once);
  const more = once.replace("</tbody>", "<tr><td>송파구</td><td>3</td></tr></tbody>");
  const next = accessibleTables(more);
  assert.match(next, /3행 2열/);
  assert.equal(next.match(/<caption/g).length, 1);
});

test("손으로 쓴 caption은 지우지도 덮지도 않는다", () => {
  const out = accessibleTables(PAGE(TABLE.replace("<thead>", "<caption>직접 쓴 이름 60~85㎡</caption><thead>")));
  assert.match(out, /<caption>직접 쓴 이름 60~85㎡<\/caption>/);
  assert.doesNotMatch(out, /data-auto/);
});

test("스크립트 안 문자열의 표는 건드리지 않는다", () => {
  const html = `<title>x</title><script>const s = "<table><thead><tr><th>a</th></tr></thead></table>";</script>`;
  assert.equal(accessibleTables(html), html);
});

test("영어 장은 영어로 쓴다", () => {
  const html = `<title>Seoul prices</title><h2>By district</h2><table><thead><tr><th>District</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>`;
  assert.match(accessibleTables(html), /Seoul prices - By district: 1 row, 1 column \(District\)/);
});
