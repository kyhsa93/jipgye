import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { barRows, districtBarsHtml, BAR_KINDS, priceBand } from "../scripts/district-bars.ts";
import { SEOUL_MAP_PATHS } from "../scripts/seoul-map-paths.ts";
import { DISTRICT_SLUGS } from "../scripts/district-slugs.ts";

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
  assert.doesNotMatch(html, /dbars-track|dbars-bar|width:/);
});

test("매매/전세/월세 전환: CSS 라디오 셋과 각 유형의 두 지역 비교", () => {
  assert.match(html, /<fieldset class="dbars-tabs"><legend class="sr-only">/);
  for (const kind of BAR_KINDS) {
    assert.match(html, new RegExp(`<label class="c-chip"><input class="sr-only" type="radio" name="dbars-kind" id="dbars-${kind}"`));
    assert.match(html, new RegExp(`data-kind="${kind}"`));
  }
  assert.match(html, /id="dbars-sale" value="sale" checked>/);
  assert.doesNotMatch(html, /onclick|onchange/);
  assert.match(html, /src="\.\/district-prices.js" defer/);
  assert.equal((html.match(/data-compare-slot=/g) ?? []).length, 6);
  // 월세 막대는 보증금과 월세를 함께 적는다.
  assert.match(panel("wolse"), /3억 6,755만원 \/ 월 223만원 · 630건/);
});

test("CSS :has 로 패널을 바꾼다(JS 0 B), 모르는 브라우저는 매매만", async () => {
  const css = await readFile(path.join(root, "src/css/c-data.css"), "utf8");
  assert.ok(css.includes('.dbars-panel:not([data-kind="sale"])'));
  for (const kind of ["jeonse", "wolse"]) assert.ok(css.includes(`.dbars:has(#dbars-${kind}:checked) [data-kind="${kind}"]`), kind);
});

test("단위·기준 기간·거래 건수를 적는다(ko/en 쌍)", () => {
  assert.match(html, /기준: 계약일 2026-08-24 ~ 2026-09-20\(최근 4주\)/);
  assert.match(html, /Basis: contracts 2026-08-24 to 2026-09-20 \(last 4 weeks\)/);
  assert.match(panel("sale"), /매매 3\.3㎡당 평균 가격/);
  assert.match(panel("sale"), /average price per 3\.3㎡/);
  assert.match(panel("sale"), /1억 1,430만원 · 201건/);
  assert.match(panel("sale"), /₩114\.3M · 201 deals/);
  assert.match(html, /<span lang="en">Gangnam-gu<\/span>/);
});

test("신고 관측 기준과 계약 기준의 창을 혼동하지 않는다", () => {
  const arrival = districtBarsHtml({ ...DATA, window: { ...DATA.window, basis: "arrival" } }, { variant: "home" });
  assert.match(arrival, /기준: 신고 관측일 2026-08-24 ~ 2026-09-20/);
  assert.match(arrival, /Basis: filings observed 2026-08-24 to 2026-09-20/);
  assert.doesNotMatch(arrival, /기준: 계약일|Basis: contracts/);
});

test("표본 부족 구는 가격 대신 「표본 부족」", () => {
  const thin = panel("sale").match(/<li class="dbars-row is-thin"[^>]*>.*?<\/li>/)[0];
  assert.match(thin, /중구/);
  assert.match(thin, /표본 부족 \(3건, 5건 미만\)/);
  assert.match(thin, /Too few deals \(3 deals, under 5\)/);
  assert.doesNotMatch(thin, /dbars-bar/);
  assert.doesNotMatch(thin, /5,783만원/);
});

test("막대는 그 구의 장으로 가는 링크", () => {
  assert.match(panel("sale"), /<a href="\.\/district-gangnam\.html"><span class="dbars-name">/);
  assert.match(panel("sale"), /<a href="\.\/district-jung\.html">/);
});

test("대체 표는 따로 굽지 않고 같은 장의 시세 표로 잇는다", () => {
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /<a href="#district-section">/);
});

test("메인: 지도와 지역 카드, 작은 구도 고를 수 있는 한영 선택 목록", () => {
  const home = districtBarsHtml(DATA, { variant: "home" });
  assert.match(home, /<h3 id="dbars-heading">/);
  assert.doesNotMatch(home, /type="radio"|<table|<fieldset/);
  assert.equal((home.match(/data-map-district=/g) ?? []).length, 4);
  assert.equal((home.match(/data-map-card=/g) ?? []).length, 4);
  assert.equal((home.match(/data-district-select/g) ?? []).length, 2);
  assert.equal((home.match(/data-map-card="[^"]+" hidden/g) ?? []).length, 3);
  assert.match(home, /data-band="thin"/);
  assert.match(home, /표본 부족/);
  assert.match(home, /<svg[^>]*role="group"/);
  assert.doesNotMatch(home, /dbars-list|dbars-track|dbars-bar/);
  assert.match(home, /<a href="\.\/realestate\.html#district-bars">/);
  assert.doesNotMatch(home, /id="district-bars"/);
});

test("지도는 25개 구의 실제 경계를 한 번씩 포함하고 가격 구간은 고정 기준", () => {
  assert.deepEqual(SEOUL_MAP_PATHS.map((r) => r.name).sort(), Object.keys(DISTRICT_SLUGS).sort());
  for (const row of SEOUL_MAP_PATHS) {
    assert.match(row.path, /^M[\d.,LZM]+$/);
    assert.ok(Number.isFinite(row.x) && Number.isFinite(row.y));
  }
  assert.deepEqual([null, 2999, 3000, 4999, 5000, 7000, 10000].map(priceBand), ["thin", "0", "1", "1", "2", "3", "4"]);
});

test("데이터가 없으면 빈 문자열(자리표시가 빈 채로)", () => {
  assert.equal(districtBarsHtml(null), "");
  assert.equal(districtBarsHtml({ districts: [] }), "");
});

test("시세 틀과 메인에 자리표시가 하나씩, 메인은 시세 구역 끝", async () => {
  for (const rel of ["scripts/realestate-template.html", "docs/index.html"]) {
    const page = await readFile(path.join(root, rel), "utf8");
    assert.equal(page.split("<!--prerender:districtBars-->").length, 2, rel);
  }
  const index = await readFile(path.join(root, "docs/index.html"), "utf8");
  assert.match(index, /id="realestate-history-note"><\/div>\s*<!--prerender:districtBars--><!--\/prerender:districtBars-->\s*<\/section>/);
});
