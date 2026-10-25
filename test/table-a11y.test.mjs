import test from "node:test";
import assert from "node:assert/strict";
import { accessibleTables } from "../scripts/table-a11y.ts";

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

test("표 꼬리(tfoot, 출처·기준일 한 줄)는 caption 의 행 수에 넣지 않는다 (#677)", () => {
  const withFoot =
    `<table><thead><tr><th>자치구</th><th>세대</th></tr></thead>` +
    `<tbody><tr><th>가구</th><td>1</td></tr><tr><th>나구</th><td>2</td></tr></tbody>` +
    `<tfoot><tr><td colspan="2">추정치 · 출처</td></tr></tfoot></table>`;
  assert.match(accessibleTables(PAGE(withFoot)), /<caption[^>]*>[^<]*: 2행 2열\(/);
});

// ---- #707: 표가 말하는 것 한 줄 + 영어 caption ---------------------------------------------------------------

const row = (label, value, seoul = false) => `<tr><td>${seoul ? `<strong>${label}</strong>` : label}</td><td>${value}</td></tr>`;
const SUMMARY_TABLE = (attrs, rows) =>
  `<table ${attrs}><thead><tr><th>자치구</th><th>신고가 뒤<br>≥</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
const DISTRICTS = [
  row("서울 전체", "44.2%", true),
  row("강남구", "49.1%"),
  row("중랑구", "32.3%"),
  row("광진구", "54.9%"),
  row("종로구", "-"),
];
const captionOf = (html) => /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(html)[1];
const HANGUL = /[가-힣]/;

test("data-summary: 가장 높은 행·가장 낮은 행·서울을 표의 글자 그대로 한 줄로 붙인다 (서울 행은 비교에서 뺀다)", () => {
  const out = accessibleTables(PAGE(SUMMARY_TABLE('data-summary="신고가 뒤≥"', DISTRICTS)));
  assert.match(
    captionOf(out),
    /: 5행 2열\(자치구·신고가 뒤≥\)\. 신고가 뒤≥: 가장 높은 행 광진구\(54\.9%\)·가장 낮은 행 중랑구\(32\.3%\)·서울 44\.2%$/
  );
  // 숫자가 아닌 칸(-)의 행은 높고 낮음에 못 든다.
  assert.doesNotMatch(captionOf(out), /종로구/);
});

test("data-summary: 서울 행이 없으면 그 조각을 쓰지 않고, 숫자 행이 하나뿐이거나 값이 모두 같으면 높고 낮음을 쓰지 않는다", () => {
  const noSeoul = accessibleTables(PAGE(SUMMARY_TABLE('data-summary="신고가 뒤≥"', DISTRICTS.slice(1))));
  assert.match(captionOf(noSeoul), /가장 낮은 행 중랑구\(32\.3%\)$/);
  assert.doesNotMatch(captionOf(noSeoul), /서울 \d/);
  const one = accessibleTables(PAGE(SUMMARY_TABLE('data-summary="신고가 뒤≥"', [DISTRICTS[1], DISTRICTS[4]])));
  assert.doesNotMatch(captionOf(one), /가장 높은 행/);
  const same = accessibleTables(PAGE(SUMMARY_TABLE('data-summary="신고가 뒤≥"', [row("가구", "1%"), row("나구", "1%")])));
  assert.doesNotMatch(captionOf(same), /가장 높은 행/);
});

test("data-summary: 없는 열 이름·칸 수가 머리글과 다른 행은 지어 쓰지 않는다", () => {
  const wrong = accessibleTables(PAGE(SUMMARY_TABLE('data-summary="없는 열"', DISTRICTS)));
  assert.doesNotMatch(captionOf(wrong), /가장 높은 행/);
  const colspan = accessibleTables(
    PAGE(SUMMARY_TABLE('data-summary="신고가 뒤≥"', [row("가구", "5%"), `<tr><td>나구</td><td colspan="3">9%</td><td>9%</td></tr>`, row("다구", "1%")]))
  );
  assert.match(captionOf(colspan), /가장 높은 행 가구\(5%\)·가장 낮은 행 다구\(1%\)$/);
});

test("data-summary-label: 행 이름을 앞 N칸으로 잇는다", () => {
  const table =
    `<table data-summary="값" data-summary-label="2"><thead><tr><th>건</th><th>일</th><th>값</th></tr></thead><tbody>` +
    `<tr><td>2건↑</td><td>90일</td><td>10%</td></tr><tr><td>3건↑</td><td>180일</td><td>20%</td></tr></tbody></table>`;
  assert.match(captionOf(accessibleTables(PAGE(table))), /가장 높은 행 3건↑·180일\(20%\)·가장 낮은 행 2건↑·90일\(10%\)$/);
});

test("data-caption-en: caption 을 m-ko/m-en 두 벌로 굽고 영어 쪽에는 한글이 한 글자도 없다", () => {
  const out = accessibleTables(
    PAGE(SUMMARY_TABLE('data-caption-en="Record highs by district" data-summary="신고가 뒤≥"', DISTRICTS))
  );
  const caption = captionOf(out);
  const ko = /<span class="m-ko">([\s\S]*?)<\/span>/.exec(caption)[1];
  const en = /<span class="m-en">([\s\S]*?)<\/span>/.exec(caption)[1];
  assert.match(ko, /가장 높은 행 광진구\(54\.9%\)/);
  assert.equal(
    en,
    "Record highs by district: 5 rows, 2 columns. Highest row Gwangjin-gu (54.9%), lowest row Jungnang-gu (32.3%), Seoul 44.2%"
  );
  assert.doesNotMatch(en, HANGUL);
  assert.match(out, /<caption class="sr-only" data-auto><span class="m-ko">/);
  // 나가는 표에서는 영어 제목 속성을 뗀다(바이트) - 요약 속성은 남는다.
  assert.doesNotMatch(out, /data-caption-en/);
});

test("영어 caption 의 행 이름: 권역은 영어 이름, 그 밖의 한글은 몇 번째 행인지", () => {
  const table =
    `<table data-caption-en="Regions" data-summary="값"><thead><tr><th>권역</th><th>값</th></tr></thead><tbody>` +
    `<tr><td>서울</td><td>+2.6%</td></tr><tr><td>동남권</td><td>+3.0%</td></tr><tr><td>서남권</td><td>+2.5%</td></tr></tbody></table>`;
  const enOf = (html) => /<span class="m-en">([\s\S]*?)<\/span>/.exec(captionOf(accessibleTables(PAGE(html))))[1];
  assert.equal(enOf(table), "Regions: 3 rows, 2 columns. Highest row Southeast (+3.0%), lowest row Southwest (+2.5%), Seoul +2.6%");
  const odd = enOf(table.replace("동남권", "제3지대").replace("서남권", "제4지대"));
  assert.match(odd, /Highest row number 2 \(\+3\.0%\), lowest row number 3 \(\+2\.5%\)/);
  assert.doesNotMatch(odd, HANGUL);
});

test('lang="en" 표: 한국어 장 제목을 빼고 영어 소제목·머리글만으로 쓴다', () => {
  const html =
    `<html><head><title>집계의 숫자</title></head><body><h2>Scoring rule</h2>` +
    `<table lang="en" data-summary="Model"><thead><tr><th>Region</th><th>Model</th></tr></thead><tbody>` +
    `<tr><td>Seoul</td><td>+2.58%</td></tr><tr><td>Northwest</td><td>&minus;0.37%</td></tr><tr><td>Southeast</td><td>+2.99%</td></tr></tbody></table></body></html>`;
  const caption = captionOf(accessibleTables(html));
  assert.equal(
    caption,
    "Scoring rule: 3 rows, 2 columns (Region, Model). Model: highest row Southeast (+2.99%), lowest row Northwest (−0.37%), Seoul +2.58%"
  );
  assert.doesNotMatch(caption, HANGUL);
});

test("속성이 없는 표의 caption 은 그대로고, 속성이 있어도 다시 돌려 같다", () => {
  assert.doesNotMatch(accessibleTables(PAGE(TABLE)), /m-ko|가장 높은 행/);
  const out = accessibleTables(PAGE(SUMMARY_TABLE('data-caption-en="X" data-summary="신고가 뒤≥"', DISTRICTS)));
  assert.equal(accessibleTables(out), out);
  assert.equal(out.match(/<caption/g).length, 1);
});
