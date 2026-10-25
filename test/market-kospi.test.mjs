import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fxRowsFrom, kospiFrom, marketFiles, shortYmd, usdKrwAt } from "../scripts/fetch-market.ts";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { sitePath } from "./helpers/site-root.mjs";

// 환율은 ECOS 731Y001 실제 응답(2026-10-12~23) 으로 잰다(#639).
const fixtureRows = JSON.parse(await readFile(new URL("./fixtures/ecos/usdkrw-731y001.json", import.meta.url), "utf8")).StatisticSearch.row;
// 2026-10-25(일) 09:30 KST - ECOS 의 마지막 값은 금요일(10-23)이다.
const SUNDAY = new Date("2026-10-25T00:30:00Z");

const close = (time, value) => ({ TIME: time, DATA_VALUE: String(value) });

test("등락은 같은 계열의 종가 둘에서 뺀다", async () => {
  // 이슈 #1: 값은 이쪽에서, 등락은 저쪽에서 받아 오면 둘이 서로를 설명하지 못한다.
  // 저장된 값끼리 빼면 45.87이 움직인 날 등락에 0.00이 적혀 있었다.
  const kospi = kospiFrom([close("20260827", 6912.37), close("20260828", 6788.88)]);

  assert.equal(kospi.value, "6,788.88");
  assert.equal(kospi.change, "-123.49");
  assert.equal(kospi.direction, "FALLING");
  // 등락이 그 계열에서 나온 값인지를 못 박는다. 부동소수점 끝자리는 상관없다.
  const derived = Number(kospi.change.replace(/,/g, ""));
  assert.ok(Math.abs(derived - (6788.88 - 6912.37)) < 0.005, `등락 ${derived}가 종가 차이와 다르다`);
});

test("앞 종가가 없으면 등락을 0.00이 아니라 비운다", async () => {
  // 0.00은 "안 움직였다"는 뜻이다. "모른다"의 자리에 놓으면 그게 바로 이 오류였다.
  const kospi = kospiFrom([close("20260828", 6788.88)]);

  assert.equal(kospi.value, "6,788.88");
  assert.equal(kospi.change, null);
  assert.equal(kospi.direction, null);
});

test("주말과 연휴를 건너뛴 두 종가로도 잰다", async () => {
  // 8월 15~17일이 비어도 14일 종가와 18일 종가로 재야 한다.
  const kospi = kospiFrom([close("20260814", 6977.94), close("20260818", 6869.83)]);
  assert.equal(kospi.change, "-108.11");
  assert.equal(kospi.asOf, "8/18");
});

test("어느 장의 종가인지 남긴다", async () => {
  // 하루 늦은 값이라 날짜를 안 적으면 "오늘 코스피"로 읽힌다.
  assert.equal(shortYmd("20260828"), "8/28");
  assert.equal(shortYmd("2026-08-28"), null);
  assert.equal(shortYmd(""), null);
});

// 환율 등락은 수집분끼리가 아니라 ECOS 계열 안에서 잰다(#639). 나머지 수집기 시험은 test/market-fx-ecos.test.mjs.
test("환율 등락은 앞 영업일 값과 뺀다 - 주말을 건너뛰어도", () => {
  const series = fxRowsFrom(fixtureRows);
  const monday = usdKrwAt(series, series.findIndex(([d]) => d === "2026-10-19"));
  assert.equal(monday.prevValue, 1348.5, "금요일(10-16) 값과 견줘야 한다");
  assert.equal(monday.change, "-6.10");
  assert.equal(monday.direction, "FALLING");
  assert.equal(monday.asOf, "10/19");
});

test("환율 앞 영업일 값이 없으면 지어내지 않는다", () => {
  const series = fxRowsFrom(fixtureRows);
  const first = usdKrwAt(series, 0);
  assert.equal(first.change, null, "앞 값이 없으면 0.00 이 아니라 비운다");
  assert.equal(first.direction, null);
  assert.equal(usdKrwAt([]), null);
});

test("오늘 값은 받을 수 있는 마지막 영업일 값이고 그 날짜를 따로 적는다 (하루 늦음)", () => {
  const { market, history } = marketFiles({ now: SUNDAY, fxSeries: fxRowsFrom(fixtureRows), history: [] });
  assert.equal(typeof market.usdKrw.value, "number", "화면(prerender·entry.jsx)은 숫자를 기대한다");
  assert.equal(market.usdKrw.value, 1324.6);
  assert.equal(market.usdKrw.asOf, "10/23");
  assert.equal(market.usdKrw.prevValue, 1325.5);
  assert.equal(market.usdKrw.change, "-0.90");
  assert.deepEqual(Object.keys(market), ["updatedAt", "kospi", "usdKrw", "baseRate", "usdKrwDaily"]);
  const today = history.find((h) => h.date === "2026-10-25");
  assert.ok(today, "오늘 기록이 없다");
  assert.ok(!("usdKrw" in today), "일요일 기록에 금요일 환율을 끌어다 채웠다");
});

// 메인의 돈의 값은 표·차트가 아니라 값 한 줄이다(#575 PR2) - 증감·시행일 칸은 뺐다.
test("화면이 기준금리·환율을 한 줄로 적고 코스피는 싣지 않는다", async () => {
  const page = await loadIndexPage({ fetch: async () => ({ ok: false, json: async () => ({}) }) });
  page.app.renderMarket({
    kospi: { value: "6,788.88", change: "-123.49", direction: "FALLING", asOf: "8/28" },
    usdKrw: { value: 1377.94, prevValue: 1381.57, change: "-3.63", direction: "FALLING" },
    baseRate: { value: "3.00", effectiveFrom: "2026년 08월 27일" },
  });

  const text = page.byId("market-line").textContent;
  assert.doesNotMatch(text, /6,788\.88/, "코스피가 첫 화면에 남았다 - 증시 뉴스 장으로 옮겼다(#56)");
  assert.equal(text, "한국은행 기준금리 3.00% · 원/달러 환율 1,377.94원");
});

test("코스피는 증시 뉴스 장에 종가 날짜와 함께 실린다 (#56)", async () => {
  const { newsKospiHtml } = await import("../scripts/prerender.ts");
  const html = newsKospiHtml({ kospi: { value: "6,788.88", change: "-123.49", asOf: "8/28" } });
  assert.match(html, /코스피 8\/28 종가/);
  assert.match(html, /6,788\.88/);
  assert.match(html, /전 거래일 대비 -123\.49/);
  assert.equal(newsKospiHtml({}), null);
  const { readFile } = await import("node:fs/promises");
  const stock = await readFile(sitePath("stock-news.html"), "utf8");
  assert.match(stock, /<section id="kospi-section">/, "증시 뉴스 장에서 코스피 절이 숨어 있다");
  const realestate = await readFile(sitePath("realestate-news.html"), "utf8");
  assert.match(realestate, /<section id="kospi-section" hidden>/, "부동산 뉴스 장에 코스피가 떴다");
});
