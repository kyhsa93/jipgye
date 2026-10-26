import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { barRows, districtBarsHtml, BAR_KINDS } from "../scripts/district-bars.ts";

const root = path.resolve(import.meta.dirname, "..");

const district = (name, sale, saleN, jeonse, jeonseN, deposit, monthly, wolseN, change) => ({
  name,
  sale: { avgPricePerPyeong10k: sale, transactionCount: saleN, ...(change != null ? { change: { value10k: change } } : {}) },
  jeonse: { avgDepositPerPyeong10k: jeonse, transactionCount: jeonseN },
  wolse: { avgDeposit10k: deposit, avgMonthlyRent10k: monthly, transactionCount: wolseN },
});

const DATA = {
  window: { from: "2026-08-24", to: "2026-09-20", districtFrom: "2026-08-24", districtWeeks: 4, weeks: 4 },
  districts: [
    district("종로구", 4882, 29, 2775, 18, 11873, 118, 67, 25),
    district("강남구", 11430, 201, 4327, 465, 36755, 223, 630, -119),
    district("중구", 5783, 3, 3132, 67, 15753, 181, 163),
    district("노원구", 3644, 753, 2141, 463, 9571, 93, 466, 0),
  ],
};

const html = districtBarsHtml(DATA);
const panel = (kind) => html.match(new RegExp(`<div class="dbars-panel" data-kind="${kind}">(.*?)</ol></div>`))[1];
const namesIn = (fragment) => [...fragment.matchAll(/<span class="dbars-name"><span lang="ko">([^<]+)</g)].map((m) => m[1]);

test("가격순: 값 큰 구가 먼저, 표본 부족 구는 맨 뒤", () => {
  assert.deepEqual(barRows(DATA, "sale").map((r) => r.name), ["강남구", "종로구", "노원구", "중구"]);
  assert.deepEqual(namesIn(panel("sale")), ["강남구", "종로구", "노원구", "중구"]);
  // 전세는 중구 표본이 넉넉하므로 값 순서에 들어간다.
  assert.deepEqual(namesIn(panel("jeonse")), ["강남구", "중구", "종로구", "노원구"]);
  // 가장 큰 막대가 100%, 나머지는 비례.
  assert.match(panel("sale"), /width:100%/);
  assert.match(panel("sale"), new RegExp(`width:${Math.round((4882 / 11430) * 1000) / 10}%`));
});

test("매매/전세/월세 전환: 라디오 셋(매매 기본) + 패널 셋, 스크립트 없음", () => {
  for (const kind of BAR_KINDS) {
    assert.match(html, new RegExp(`<input class="sr-only" type="radio" name="dbars-kind" id="dbars-${kind}"`));
    assert.match(html, new RegExp(`<label class="c-chip" for="dbars-${kind}">`));
    assert.match(html, new RegExp(`data-kind="${kind}"`));
  }
  assert.match(html, /id="dbars-sale" value="sale" checked>/);
  assert.doesNotMatch(html, /<script|onclick|onchange/);
  // 월세 막대는 보증금과 월세를 함께 적는다.
  assert.match(panel("wolse"), /3억 6,755만원 \/ 월 223만원 · 630건/);
});

test("CSS 가 형제 선택자로 패널을 바꾼다(JS 0 B)", async () => {
  const css = await readFile(path.join(root, "src/css/c-data.css"), "utf8");
  for (const kind of BAR_KINDS) assert.ok(css.includes(`#dbars-${kind}:checked ~ .dbars-panels [data-kind="${kind}"]`), kind);
  assert.match(css, /\.dbars-panel \{\n  display: none;/);
});

test("단위·기준 기간·거래 건수를 적는다(ko/en 쌍)", () => {
  assert.match(html, /기준: 계약일 2026-08-24 ~ 2026-09-20\(최근 4주\) 신고분/);
  assert.match(html, /Basis: contracts 2026-08-24 to 2026-09-20 \(last 4 weeks\)/);
  assert.match(panel("sale"), /매매 3\.3㎡당 평균 가격/);
  assert.match(panel("sale"), /average price per 3\.3㎡/);
  assert.match(panel("sale"), /1억 1,430만원 · 201건/);
  assert.match(panel("sale"), /₩114\.3M · 201 deals/);
  assert.match(html, /<span lang="en">Gangnam-gu<\/span>/);
});

test("표본 부족 구는 막대 대신 「표본 부족」", () => {
  const thin = panel("sale").match(/<li class="dbars-row is-thin">.*?<\/li>/)[0];
  assert.match(thin, /중구/);
  assert.match(thin, /표본 부족 \(3건, 5건 미만\)/);
  assert.match(thin, /Too few deals \(3 deals, under 5\)/);
  assert.doesNotMatch(thin, /dbars-bar/);
  assert.equal((panel("sale").match(/class="dbars-bar"/g) ?? []).length, 3);
});

test("막대는 그 구의 장으로 가는 링크", () => {
  assert.match(panel("sale"), /<a href="\.\/district-gangnam\.html"><span class="dbars-name">/);
  assert.match(panel("sale"), /<a href="\.\/district-jung\.html">/);
});

test("대체 표: 같은 값·건수, 증감은 ▲▼와 부호(색만 아님)", () => {
  const table = html.match(/<details class="c-fold dbars-alt">.*<\/details>/)[0];
  assert.match(table, /<table class="data-table dbars-table"><caption/);
  const rows = [...table.matchAll(/<tr><th scope="row">(.*?)<\/tr>/g)].map((m) => m[1]);
  assert.equal(rows.length, 4);
  assert.match(rows[0], /district-gangnam\.html.*1억 1,430만원.*201건.*4,327만원.*465건.*3억 6,755만원 \/ 월 223만원.*630건/);
  assert.match(rows[0], /▼−119만원/);
  assert.match(rows[1], /▲\+25만원/);
  assert.match(rows[2], /변동 없음/);
  assert.match(rows[3], /중구.*표본 부족.*3건/);
});

test("데이터가 없으면 빈 문자열(자리표시가 빈 채로)", () => {
  assert.equal(districtBarsHtml(null), "");
  assert.equal(districtBarsHtml({ districts: [] }), "");
  assert.match(districtBarsHtml(DATA, { heading: "h3" }), /<h3 id="dbars-heading">/);
});

test("시세 틀과 메인에 자리표시가 하나씩", async () => {
  for (const rel of ["scripts/realestate-template.html", "docs/index.html"]) {
    const page = await readFile(path.join(root, rel), "utf8");
    assert.equal(page.split("<!--prerender:districtBars-->").length, 2, rel);
  }
});
