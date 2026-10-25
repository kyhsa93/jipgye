// 로드 실패 사이트 공통 규칙(docs/load-state.js)의 시험 (#173·#174).
//
// 규칙: 데이터를 못 받으면 "불러오는 중..."/"찾는 중..."을 남기지 않고, 실패 문구와 재시도 단추를
// 보인다. jsdom 없이 저장소가 이미 쓰는 방식(vm 샌드박스 + 손으로 만든 DOM, test/helpers/)으로 돌린다 -
// fetch를 거부하도록 주입하고, 화면 조각의 innerHTML과 단추의 click 리스너를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadNewsPage } from "./helpers/news-page.mjs";
import { loadAnalysisPage } from "./helpers/analysis-page.mjs";
import { stripInlineScriptComments } from "../scripts/strip-inline-comments.ts";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const settle = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};

test("공용 규칙 파일을 쓰는 페이지는 인라인 스크립트보다 먼저 물고 있다", async () => {
  for (const name of ["deal-search"]) { // 금리 4장(#577 B2 로 지움)도 여기 있었다
    const html = await readFile(path.join(root, `${SITE}/${name}.html`), "utf8");
    const tag = html.indexOf('<script src="./load-state.js"></script>');
    assert.ok(tag > 0, `${name}.html이 load-state.js를 물고 있지 않다`);
    assert.ok(tag < html.lastIndexOf("<script>\n"), `${name}.html: load-state.js가 인라인 스크립트보다 뒤에 있다`);
  }
});

async function dealSearch(query, extra = {}) {
  const [budget, search, deals, rents] = await Promise.all([readJson("budget-deals"), readJson("deal-search"), readJson("deals-nowon"), readJson("rents-nowon")]);
  return loadDealSearchPage({ budget, search, deals: { 노원구: deals }, rents: { 노원구: rents }, query, ...extra });
}

test("단지로 묶어 보기: 단지 가격 파일 fetch가 거부되면 찾는 중이 멈추고 실패 문구 + 재시도 단추가 나온다", async () => {
  for (const query of ["?group=1&district=노원구&budget=6", "?group=1&budget=6"]) {
    for (const [locale, error, retry] of [
      ["ko", "단지 가격을 불러오지 못했습니다.", "다시 시도"],
      ["en", "Could not load complex prices.", "Retry"],
    ]) {
      const page = await dealSearch(query, { locale, network: { failComplexPrice: true } });
      await page.settle();
      const html = page.resultHtml();
      const label = `${query} ${locale}`;
      assert.ok(!/찾는 중|Searching/.test(html), `${label}: 찾는 중이 영구히 남았다`);
      assert.ok(html.includes(error), `${label}: 실패 문구가 없다`);
      assert.match(html, new RegExp(`<button type="button" id="load-retry">${retry}</button>`), `${label}: 재시도 단추가 없다`);
    }
  }
});

test("단지로 묶어 보기: 재시도 단추를 누르면 다시 받아 순위를 그린다", async () => {
  const net = { failComplexPrice: true };
  const price = {
    district: "노원구",
    reference: "202608",
    cells: { 가: { "59.9": { n: 20, median: 65000, low: 64000, high: 66000, quartile: true, raw: 63000, unadjusted: 0 } } },
    meta: { 가: { dong: "상계동", buildYear: 2001 } },
  };
  const page = await dealSearch("?group=1&district=노원구&budget=6", { network: net, complexPrices: { 노원구: price } });
  await page.settle();
  assert.ok(page.resultHtml().includes("id=\"load-retry\""));

  net.failComplexPrice = false;
  page.byId("load-retry").dispatch("click");
  await page.settle();

  const html = page.resultHtml();
  assert.ok(!html.includes("load-retry"), "재시도가 성공했는데 실패 문구가 남았다");
  assert.ok(!html.includes("찾는 중"));
  assert.match(html, /상계동/, "재시도 뒤 순위에 단지가 없다");
});

test("단지로 묶어 보기: 파일이 아직 없는 날(404)은 실패가 아니라 빈 결과로 끝난다", async () => {
  const page = await dealSearch("?group=1&district=노원구&budget=6");
  await page.settle();
  const html = page.resultHtml();
  assert.ok(!html.includes("load-retry"), "404를 실패로 보였다");
  assert.ok(!html.includes("찾는 중"));
});

// --- ?apt= 단지 카드의 가격 블록 (#187) ---
const APT_QUERY = "?district=노원구&apt=상계주공7(고층)";
const slotHtml = (page) => page.byId("complex-price-status").innerHTML;

test("단지 카드: 단지 가격 fetch가 거부되면 가격 블록 자리에 실패 문구(한·영) + 재시도 단추가 보이고 거래 비율은 그대로다", async () => {
  for (const [locale, error, retry] of [
    ["ko", "단지 가격을 불러오지 못했습니다.", "다시 시도"],
    ["en", "Could not load complex prices.", "Retry"],
  ]) {
    const page = await dealSearch(APT_QUERY, { locale, network: { failComplexPrice: true } });
    await page.settle();
    const label = `${APT_QUERY} ${locale}`;
    assert.ok(slotHtml(page).includes(error), `${label}: 가격 블록 자리에 실패 문구가 없다`);
    assert.match(slotHtml(page), new RegExp(`<button type="button" id="load-retry-price">${retry}</button>`), `${label}: 재시도 단추가 없다`);
    assert.ok(page.byId("complex-card").innerHTML.includes('id="complex-price-status"'), `${label}: 실패 자리가 카드 안에 없다`);
    assert.match(page.byId("complex-card").innerHTML, /전세가율|Jeonse ratio|\d+\.\d%/, `${label}: 거래 목록 쪽 표가 같이 사라졌다`);
  }
});

test("단지 카드: 재시도가 성공하면 가격 블록이 그려지고 실패 문구가 사라진다", async () => {
  const net = { failComplexPrice: true };
  const price = await readJson("complex-price-nowon");
  const page = await dealSearch(APT_QUERY, { network: net, complexPrices: { 노원구: price } });
  await page.settle();
  assert.ok(slotHtml(page).includes("load-retry-price"));

  net.failComplexPrice = false;
  page.byId("load-retry-price").dispatch("click");
  await page.settle();

  const card = page.byId("complex-card").innerHTML;
  assert.ok(!card.includes("complex-price-status"), "재시도가 성공했는데 실패 자리가 남았다");
  assert.ok(card.includes("complex-price-table"), "재시도 뒤 가격 블록이 없다");
});

test("단지 카드: 가격 파일이 아직 없는 날(404)은 실패로 보이지 않는다", async () => {
  const page = await dealSearch(APT_QUERY);
  await page.settle();
  assert.ok(!page.byId("complex-card").innerHTML.includes("complex-price-status"), "404를 실패 자리로 그렸다");
  assert.ok(!page.byId("complex-card").innerHTML.includes("load-retry"), "404에 재시도 단추를 보였다");
});

test("단지 카드: 실패 표시는 공용 규칙으로만 만든다 - 페이지에 재시도 단추 마크업을 직접 쓰지 않는다", async () => {
  const html = await readFile(path.join(root, `${SITE}/deal-search.html`), "utf8");
  assert.ok(!html.includes('id="load-retry-price"'), "load-retry-price 마크업을 직접 썼다");
});

// --- ?apt= 이름을 풀 수 없는 경로 (#191) ---
// 최근 두 달 목록에도 6개월 가격 파일에도 이름이 없고 가격 파일마저 실패하면, 이전에는 카드가 아예
// 안 그려져 "그 단지가 없다"와 구분되지 않았다. 없는 단지는 그대로 조용해야 하고(404·받았는데 이름 없음),
// 실패일 때만 실패 문구 + 재시도가 나와야 한다.
const UNKNOWN_QUERY = "?district=노원구&apt=없는단지가나다라마바사";

test("단지 카드(이름 미해결): 가격 파일이 거부되면 카드 자리에 실패 문구(한·영) + 재시도 단추가 나온다", async () => {
  for (const [locale, error, retry] of [
    ["ko", "단지 가격을 불러오지 못했습니다.", "다시 시도"],
    ["en", "Could not load complex prices.", "Retry"],
  ]) {
    const page = await dealSearch(UNKNOWN_QUERY, { locale, network: { failComplexPrice: true } });
    await page.settle();
    // 가짜 DOM은 없는 id도 빈 요소로 돌려주므로 카드 HTML에 자리가 실제로 있는지를 따로 본다.
    assert.ok(page.byId("complex-card").innerHTML.includes('id="complex-price-status"'), `${locale}: 카드가 안 그려져 실패 자리가 없다`);
    assert.ok(slotHtml(page).includes(error), `${locale}: 이름 미해결 경로에 실패 문구가 없다`);
    assert.match(slotHtml(page), new RegExp(`<button type="button" id="load-retry-price">${retry}</button>`), `${locale}: 재시도 단추가 없다`);
  }
});

test("단지 카드(이름 미해결): 재시도가 성공하면 실패 문구가 사라지고 없는 단지로 끝난다", async () => {
  const net = { failComplexPrice: true };
  const price = await readJson("complex-price-nowon");
  const page = await dealSearch(UNKNOWN_QUERY, { network: net, complexPrices: { 노원구: price } });
  await page.settle();
  assert.ok(page.byId("complex-card").innerHTML.includes('id="complex-price-status"'), "카드가 안 그려져 실패 자리가 없다");
  assert.ok(slotHtml(page).includes("load-retry-price"));

  net.failComplexPrice = false;
  page.byId("load-retry-price").dispatch("click");
  await page.settle();

  const card = page.byId("complex-card").innerHTML;
  assert.ok(!card.includes("complex-price-status") && !card.includes("load-retry"), "재시도가 성공했는데 실패 자리가 남았다");
});

test("단지 카드(이름 미해결): 없는 단지는 실패로 보이지 않는다 - 가격 파일 404, 받았는데 이름 없음 모두", async () => {
  const price = await readJson("complex-price-nowon");
  for (const [label, extra] of [["404", {}], ["받았는데 이름 없음", { complexPrices: { 노원구: price } }]]) {
    const page = await dealSearch(UNKNOWN_QUERY, extra);
    await page.settle();
    const card = page.byId("complex-card").innerHTML;
    assert.ok(!card.includes("complex-price-status"), `${label}: 없는 단지를 실패 자리로 그렸다`);
    assert.ok(!card.includes("load-retry"), `${label}: 없는 단지에 재시도 단추를 보였다`);
  }
});

// --- 최근 두 달 거래(deals-*)·전월세(rents-*) 목록 (#196) ---
// 이 목록이 거부되면 이전에는 빈 catch가 삼켜 결과·단지 카드가 조용히 빠졌다(전월세는 "준비 중"으로 보였다).
// 가짜 DOM은 없는 id도 빈 요소로 돌려주므로 먼저 실제 HTML에 결과 자리(#search-result)가 있는지 단언한다.
const LIST_CASES = [
  { name: "deals", query: "?district=노원구", retryId: "load-retry-deals", fail: "failDeals", slow: "rents" },
  { name: "rents", query: "?kind=jeonse&district=노원구", retryId: "load-retry-rents", fail: "failRents", slow: "deals" },
];

test("거래 목록: 결과 자리와 카드 자리는 실제 HTML에 있다 (가짜 DOM 함정 방지)", async () => {
  const html = await readFile(path.join(root, `${SITE}/deal-search.html`), "utf8");
  assert.ok(html.includes('<div id="search-result"></div>'), "#search-result 자리가 HTML에 없다");
  assert.ok(html.includes('<div id="complex-card"></div>'), "#complex-card 자리가 HTML에 없다");
  assert.ok(!html.includes('id="load-retry-deals"') && !html.includes('id="load-retry-rents"'), "재시도 단추 마크업을 직접 썼다");
});

test("거래 목록: deals-*/rents-* fetch가 거부되면 결과 자리에 실패 문구(한·영) + 재시도 단추가 나온다", async () => {
  for (const c of LIST_CASES) {
    for (const [locale, error, retry] of [
      ["ko", "실거래를 불러오지 못했습니다.", "다시 시도"],
      ["en", "Could not load transaction data.", "Retry"],
    ]) {
      const page = await dealSearch(c.query, { locale, network: { [c.fail]: true } });
      await page.settle();
      const html = page.resultHtml();
      const label = `${c.name} ${locale}`;
      assert.ok(html.includes(error), `${label}: 실패 문구가 없다`);
      assert.match(html, new RegExp(`<button type="button" id="${c.retryId}">${retry}</button>`), `${label}: 재시도 단추가 없다`);
      assert.ok(!/불러오는 중|Loading|준비 중|not ready/i.test(html), `${label}: 로드 중/준비 중 문구가 남았다`);
      assert.ok((page.byId(c.retryId).listeners.click ?? []).length > 0, `${label}: 단추에 누름 처리가 없다`);
    }
  }
});

test("거래 목록: 재시도가 성공하면 실패 표시가 사라지고 정상 결과가 그려진다", async () => {
  for (const c of LIST_CASES) {
    const net = { [c.fail]: true };
    const page = await dealSearch(c.query, { network: net });
    await page.settle();
    assert.ok(page.resultHtml().includes(c.retryId), `${c.name}: 실패 표시가 처음부터 없다`);

    net[c.fail] = false;
    page.byId(c.retryId).dispatch("click");
    await page.settle();

    const html = page.resultHtml();
    assert.ok(!html.includes("load-retry"), `${c.name}: 재시도가 성공했는데 실패 표시가 남았다`);
    assert.ok(!html.includes("실거래를 불러오지 못했습니다."), `${c.name}: 실패 문구가 남았다`);
    assert.ok(html.includes("budget-summary") || html.includes("budget-deals"), `${c.name}: 재시도 뒤 정상 결과가 없다`);
  }
});

test("거래 목록: 파일이 없는 구(404)는 실패로 보이지 않는다 - 실패와 없음이 갈린다", async () => {
  for (const c of LIST_CASES) {
    const page = await loadDealSearchPage({
      budget: await readJson("budget-deals"),
      search: await readJson("deal-search"),
      query: c.query,
    });
    await page.settle();
    const html = page.resultHtml();
    assert.ok(!html.includes("load-retry"), `${c.name}: 404에 재시도 단추를 보였다`);
    assert.ok(!html.includes("실거래를 불러오지 못했습니다."), `${c.name}: 404를 실패 문구로 보였다`);
  }
});

test("거래 목록: 재시도 단추를 연달아 눌러도 다시 받기는 한 번뿐이다", async () => {
  for (const c of LIST_CASES) {
    const net = { [c.fail]: true };
    const page = await dealSearch(c.query, { network: net });
    await page.settle();
    let fetches = 0;
    const real = page.sandbox.fetch;
    page.sandbox.fetch = async (url) => {
      if (new RegExp(`/${c.name}-[a-z]+\\.json`).test(String(url))) fetches += 1;
      return real(url);
    };
    net[c.fail] = false;
    const button = page.byId(c.retryId);
    for (let i = 0; i < 3; i += 1) if (button.disabled !== true) button.dispatch("click");
    await page.settle();
    assert.equal(fetches, 1, `${c.name}: 연타에 목록을 ${fetches}번 받았다`);
  }
});

test("거래 목록: deals 실패는 구 하나만 실패해도 빠진 구 없는 목록을 내놓지 않는다 (전체 구 + 상세 조건)", async () => {
  const page = await dealSearch("?apt=상계", { network: { failDeals: true } });
  await page.settle();
  assert.ok(page.resultHtml().includes("load-retry-deals"), "전체 구 + 단지명 조건에서 실패 표시가 없다");
});

// --- 단지 카드 안 전세 쪽(rents-*) 로드 실패 (#199) ---
// 매매 결과는 정상인데 카드가 전세가율을 위해 받는 rents-*만 실패한 경우. 이전에는 rentsFailed에 기록만 되고
// 카드의 전세·전세가율 칸이 값 없이 빠져 "표본 부족"과 구분되지 않았다.
// 가짜 DOM은 없는 id도 빈 요소를 돌려주므로(page.byId), 자리·단추의 존재는 카드 innerHTML 문자열로 먼저 확인한다.
// 카드 HTML에는 자리(#complex-rents-status)만 있고, 문구·단추는 공용 규칙이 그 자리 요소에 써 넣는다.
const cardHtml = (page) => page.byId("complex-card").innerHTML;
const rentsSlot = (page) => page.byId("complex-rents-status").innerHTML;

test("단지 카드(전세 쪽): rents-* fetch가 거부되면 카드 안에 실패 문구(한·영) + 재시도 단추, 전세·전세가율 칸은 불러오지 못함", async () => {
  for (const [locale, error, retry, unloaded] of [
    ["ko", "실거래를 불러오지 못했습니다.", "다시 시도", "불러오지 못함"],
    ["en", "Could not load transaction data.", "Retry", "Not loaded"],
  ]) {
    const page = await dealSearch(APT_QUERY, { locale, network: { failRents: true } });
    await page.settle();
    const card = cardHtml(page);
    const label = `${APT_QUERY} ${locale}`;
    assert.ok(card.includes('id="complex-rents-status"'), `${label}: 실패 자리가 카드 안에 없다`);
    assert.ok(rentsSlot(page).includes(error), `${label}: 카드 안에 실패 문구가 없다`);
    assert.match(rentsSlot(page), new RegExp(`<button type="button" id="load-retry-rents-card">${retry}</button>`), `${label}: 카드 안에 재시도 단추가 없다`);
    // 전세·전세가율 두 칸이 모두 불러오지 못함이어야 한다 - 행마다 2칸.
    const rowCount = (card.match(/<tr><td>/g) ?? []).length;
    assert.ok(rowCount > 0, `${label}: 매매 쪽 행이 사라졌다`);
    assert.equal(card.split(`<span class="low-sample">${unloaded}</span>`).length - 1, rowCount * 2, `${label}: 전세·전세가율 칸이 불러오지 못함이 아니다`);
    assert.ok(!/\d+\.\d%/.test(card), `${label}: 실패인데 전세가율 값이 보인다`);
    assert.ok((page.byId("load-retry-rents-card").listeners.click ?? []).length > 0, `${label}: 단추에 누름 처리가 없다`);
    // 결과 자리(매매)는 정상이어야 한다 - 실패가 결과 전체로 번지지 않는다.
    assert.ok(!page.resultHtml().includes("load-retry"), `${label}: 매매 결과 자리까지 실패로 바뀌었다`);
  }
});

test("단지 카드(전세 쪽): 재시도가 성공하면 실패 문구가 사라지고 전세가율이 채워진다", async () => {
  const net = { failRents: true };
  const page = await dealSearch(APT_QUERY, { network: net });
  await page.settle();
  assert.ok(cardHtml(page).includes('id="complex-rents-status"'), "처음부터 실패 자리가 없다");
  assert.ok(rentsSlot(page).includes("load-retry-rents-card"), "처음부터 실패 표시가 없다");

  net.failRents = false;
  page.byId("load-retry-rents-card").dispatch("click");
  await page.settle();

  const card = cardHtml(page);
  assert.ok(!card.includes("complex-rents-status"), "재시도가 성공했는데 실패 자리가 남았다");
  assert.ok(!card.includes("load-retry"), "재시도가 성공했는데 재시도 단추가 남았다");
  assert.ok(!card.includes("불러오지 못함"), "재시도가 성공했는데 불러오지 못함이 남았다");
  assert.match(card, /\d+\.\d%/, "재시도 뒤 전세가율 값이 채워지지 않았다");
});

test("단지 카드(전세 쪽): rents-* 파일이 없는 날(404)은 실패로 보이지 않는다", async () => {
  const [budget, search, deals] = await Promise.all([readJson("budget-deals"), readJson("deal-search"), readJson("deals-nowon")]);
  const page = await loadDealSearchPage({ budget, search, deals: { 노원구: deals }, query: APT_QUERY });
  await page.settle();
  const card = cardHtml(page);
  assert.ok(/전세가율/.test(card) && card.includes("<table"), "카드가 그려지지 않았다 - 404 시험이 비어 있다");
  assert.ok(!card.includes("complex-rents-status"), "404를 실패 자리로 그렸다");
  // 자리 요소 자체는 시험 DOM이 없는 id에도 빈 요소를 주고 showFailure가 거기에 쓰므로, 404 판정은 카드 HTML의 자리 유무로만 한다.
  assert.ok(!card.includes("load-retry"), "404에 재시도 단추를 보였다");
  assert.ok(!card.includes("불러오지 못함"), "404를 불러오지 못함으로 적었다");
});

test("단지 카드(전세 쪽): 재시도 단추를 연달아 눌러도 rents-* 요청은 한 번뿐이다", async () => {
  const net = { failRents: true };
  const page = await dealSearch(APT_QUERY, { network: net });
  await page.settle();
  let fetches = 0;
  const real = page.sandbox.fetch;
  page.sandbox.fetch = async (url) => {
    if (/\/rents-[a-z]+\.json/.test(String(url))) fetches += 1;
    return real(url);
  };
  net.failRents = false;
  assert.ok(cardHtml(page).includes('id="complex-rents-status"'), "실패 자리가 카드에 없다");
  assert.ok(rentsSlot(page).includes("load-retry-rents-card"), "재시도 단추가 없다");
  const button = page.byId("load-retry-rents-card");
  for (let i = 0; i < 3; i += 1) if (button.disabled !== true) button.dispatch("click");
  assert.strictEqual(button.disabled, true, "첫 클릭 뒤 단추가 잠기지 않았다");
  await page.settle();
  assert.equal(fetches, 1, `연타에 rents를 ${fetches}번 받았다`);
});

test("단지 카드(전세 쪽): 실패 표시는 공용 규칙으로만 만든다 - 재시도 단추 마크업을 직접 쓰지 않는다", async () => {
  const html = await readFile(path.join(root, `${SITE}/deal-search.html`), "utf8");
  assert.ok(html.includes('<div id="complex-card"></div>'), "#complex-card 자리가 HTML에 없다");
  assert.ok(!html.includes('id="load-retry-rents-card"'), "load-retry-rents-card 마크업을 직접 썼다");
  assert.ok(!/<button[^>]*load-retry-rents-card/.test(html), "재시도 단추를 직접 만들었다");
});

// ============================================================================================================
// 구운 자리를 남기고 옆에 알리는 길 (#296 조건 4, 규칙 2~5). 틀별 행으로 두어 다음 틀 PR 은 행만 더한다.
// 첫 행: 시세 틀(realestate) 47장 - 알림 대상 29장(자치구 25 + 거래유형 3 + realestate)과, 코드만 실리고 알림이 없는 예산대 18장.
// 화면에 "보인다"의 뜻 중 (i)~(iv) 는 실제 Chrome 에서 잰다(PR 증빙). 여기서는 손으로 만든 DOM 이 알림을 어디에 세우고 무엇을 쓰는지 본다.
// ============================================================================================================
const loadStateSource = await readFile(path.join(root, "docs/load-state.js"), "utf8");
const FN_START = loadStateSource.indexOf("  function notifyBeside(");
const FN_END = loadStateSource.indexOf("\n  }\n", FN_START) + "\n  }\n".length;
// 들여쓰기(2칸)만 걷은 본문 - 틀과 구운 47장에 이 글자 그대로 실려야 한다.
const NOTIFY_FN = loadStateSource.slice(FN_START, FN_END).split("\n").map((l) => l.replace(/^ {2}/, "")).join("\n");
const scriptOf = (html) => [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
const templateScript = scriptOf(stripInlineScriptComments(await readFile(path.join(root, "scripts/realestate-template.html"), "utf8")));

const REAL = await readJson("realestate");
const KO_ONLY = "Some of it is in Korean only.";
const BAD_WORDS = /오늘|최신|today|latest/i;

const slice = (html, open, close) => {
  const a = html.indexOf(open);
  return a < 0 ? "" : html.slice(a + open.length, html.indexOf(close, a + open.length));
};
const frames = [];
{
  const files = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html")).sort();
  const pages = [];
  for (const file of files) {
    const html = await readFile(path.join(root, SITE, file), "utf8");
    if (!html.includes('id="trend-section"')) continue;
    const budgetBand = /name="budget-band" content="(\d+)"/.exec(html)?.[1];
    const district = /name="realestate-district" content="([^"]+)"/.exec(html)?.[1];
    const kind = /name="realestate-kind" content="([^"]+)"/.exec(html)?.[1];
    pages.push({
      file,
      html,
      script: scriptOf(html),
      budget: budgetBand !== undefined,
      budgetBand: budgetBand === undefined ? null : Number(budgetBand),
      district: district ?? null,
      kind: kind ?? null,
      hasArea: Boolean(district) || kind === "sale" || kind === "jeonse",
      grid: slice(html, '<tbody id="district-grid">', "</tbody>"),
      cards: slice(html, 'id="overall-cards">', "</div>\n  </section>"),
      budgetResult: slice(html, '<div id="budget-result">', "</div>\n    <p class=\"district-summary budget-facts\""),
      updated: /id="updated" data-updated="([^"]+)"/.exec(html)?.[1] ?? null,
    });
  }
  frames.push({
    name: "시세 틀(realestate)",
    pages,
    /** mode: "404"(응답이 404) | "reject"(요청이 거부). down: 아직 실패 중인지(고쳐 두면 다시 시도가 성공한다). */
    async open(page, { locale = "ko", search = "", mode = "reject", only, wait = false, mutate } = {}) {
      // wait: 처음 요청이 "받는 중"에 머문다(#410). state.release() 가 풀고, state.hold() 가 다음 요청을 다시 붙든다(재시도 응답 대기).
      const state = {
        down: true,
        sets: [],
        wall: null,
        release() {},
        hold() {
          state.wall = new Promise((resolve) => {
            state.release = () => {
              state.wall = null;
              resolve();
            };
          });
        },
      };
      if (wait) state.hold();
      const fails = only ? (name) => name === only : () => true;
      const web = await loadRealestatePage({
        file: `${SITE}/${page.file}`,
        mutate,
        locale,
        search,
        kind: page.kind,
        district: page.district,
        budgetBand: page.budgetBand,
        prerenderedBudget: page.budgetResult,
        realestate: mode === "404" && fails("realestate") ? undefined : REAL,
        gate: async (name) => {
          await state.wall;
          if (mode === "reject" && state.down && fails(name)) throw new TypeError("Failed to fetch");
        },
        baked: {
          "district-grid": { innerHTML: page.grid },
          "overall-cards": { innerHTML: page.cards },
          "budget-result": { innerHTML: page.budgetResult },
          updated: { getAttribute: (n) => (n === "data-updated" ? page.updated : null), setAttribute: (n) => state.sets.push(n) },
        },
      });
      const notices = () => web.byId("area-controls").inserted.filter((n) => n.tag === "p" && n.isConnected);
      const textOf = (n) => n.ownText + (n.inserted.length ? ` ${n.lastElementChild.textContent}` : "");
      return { ...web, state, notices, textOf, koOnly: () => notices().filter((n) => textOf(n).includes(KO_ONLY)).length };
    },
  });
}
const settleMany = () => settle(30);
const { pages: PAGES } = frames[0];
const NOTICE_PAGES = PAGES.filter((p) => !p.budget);
const BUDGET_PAGES = PAGES.filter((p) => p.budget);
const AREA_PAGES = NOTICE_PAGES.filter((p) => p.hasArea);
const retryButton = (n) => n.lastElementChild;

test("(바) 범위: 시세 틀은 47장이고 알림 대상은 29장(자치구 25 + 거래유형 3 + realestate), 예산대는 18장, 면적 고르기는 27장", () => {
  assert.equal(PAGES.length, 47);
  assert.equal(NOTICE_PAGES.length, 29);
  assert.equal(BUDGET_PAGES.length, 18);
  assert.equal(AREA_PAGES.length, 27);
  assert.deepEqual(NOTICE_PAGES.filter((p) => !p.hasArea).map((p) => p.file), ["apartment-rent.html", "realestate.html"]);
});

test("ⓕ 공통 함수는 docs/load-state.js 에 한 번 쓰고, 틀과 구운 47장에 들여쓰기만 걷은 같은 글자로 실린다 - 외부 script 는 더하지 않는다", async () => {
  // 머리 주석의 규칙은 다섯 줄이다(조건 4): 번호 1~5 가 하나씩, 옛 한 줄 문장은 없다.
  const rules = loadStateSource.match(/^\/\/ {3}[1-5]\. /gm) ?? [];
  assert.deepEqual(rules.map((r) => r.match(/[1-5]/)[0]), ["1", "2", "3", "4", "5"], "docs/load-state.js 머리 주석의 규칙이 다섯 줄이 아니다");
  assert.ok(!loadStateSource.includes("로드 중과 실패는 다른 상태다"), "옛 한 줄 규칙이 남았다");
  assert.ok(NOTIFY_FN.startsWith("function notifyBeside(anchor, message, retryLabel, onRetry) {\n") && NOTIFY_FN.endsWith("\n}\n"), "load-state.js 에서 함수를 못 뽑았다");
  assert.ok(templateScript.includes(NOTIFY_FN), "scripts/realestate-template.html 의 notifyBeside 가 docs/load-state.js 와 다르다");
  for (const p of PAGES) {
    assert.ok(p.script.includes(NOTIFY_FN), `${SITE}/${p.file}: notifyBeside 가 docs/load-state.js 와 한 글자라도 다르다 - 틀을 고치고 굽지 않았다`);
    assert.ok(!p.html.includes("load-state.js"), `${SITE}/${p.file}: 시세 장이 load-state.js 를 <script src> 로 문다 - 정상 방문 47장의 요청이 +1 이다`);
    assert.doesNotMatch(NOTIFY_FN, /\/\/|\/\*/, "함수 본문에 주석이 있다 - 구운 장에서 걷혀 글자가 갈라진다");
  }
  // 함수는 밖의 변수를 쓰지 않는다: 함수 본문만 따로 돌려도 돈다(전역 document 외 이름이 없다).
  assert.doesNotMatch(NOTIFY_FN, /\b(?:cache|locale|t\(|escapeHtml|areaM2|main)\b/, "함수가 화면 코드의 이름을 쓴다 - 본문이 두 곳에서 같을 수 없다");
});

test("ⓕ 구운 자리의 실패 표시는 이 함수로만 만든다: 알림 마크업·재시도 단추 마크업이 틀과 47장에 더 없다", () => {
  for (const [name, script] of [["template", templateScript], ...PAGES.map((p) => [p.file, p.script])]) {
    assert.equal(script.match(/<p class="content-notice">/g)?.length, 2, `${name}: <p class="content-notice"> 가 2(withKoOnly 의 옛 것 + notifyBeside)가 아니다`);
    assert.equal(script.match(/<button type="button" id="load-retry">/g)?.length, 2, `${name}: 재시도 단추 마크업이 2(notifyBeside + 빈 자리 옛 행)가 아니다`);
    assert.equal(script.match(/notifyBeside\(/g)?.length, 3, `${name}: notifyBeside 정의 1 + 호출 2(바깥 catch · 면적 변경 뒤 영어 고지)가 아니다`);
    assert.doesNotMatch(script, /dataset|classList|className/, `${name}: 새 훅(dataset·class 쓰기)을 만들었다`);
    assert.ok(script.includes('getAttribute("data-updated")'), `${name}: 기준일을 getAttribute 로 읽지 않는다`);
    assert.doesNotMatch(script, /\/\/|\/\*/, `${name}: 주석이 구워져 나갔다`);
  }
});

test("(바) 범위 선: complex-ratio·realestate-trend·budget-deals 의 무음 갈래 글자는 그대로이고, 새 코드는 바깥 catch 에서 reportLoadFailure(error); foldReserve(); 바로 뒤에만 있다", () => {
  const RATIO = "    try {\n      const ratioRes = await fetch(`./data/complex-ratio.json?_=${Date.now()}`);\n      if (ratioRes.ok) {\n        cache.complexRatio = await ratioRes.json();\n        renderAll();\n      }\n    } catch {\n    }\n";
  const TREND = "    try {\n      const trendRes = await fetch(`./data/realestate-trend.json?_=${Date.now()}`);\n      if (trendRes.ok) {\n        cache.trend = await trendRes.json();\n        renderTrend();\n      } else {\n        foldReserve();\n      }\n    } catch {\n      foldReserve();\n    }\n";
  const BUDGET = "    if (budgetEnabled) {\n      try {\n        const budgetRes = await fetch(`./data/budget-deals.json?_=${Date.now()}`);\n        if (budgetRes.ok) {\n          cache.budget = await budgetRes.json();\n          renderBudget();\n          renderUpdated(cache.realestate);\n        }\n      } catch {\n      }\n    }\n";
  const CALL = "  } catch (error) {\n    reportLoadFailure(error);\n    foldReserve();\n    if (!budgetEnabled && bakedGrid && (!hasAreaColumn || areaM2 === DEFAULT_AREA_M2)) {\n      note = 2;\n      drawNote();\n      return;\n    }\n    showGridFailure();\n  }\n}\n";
  for (const [name, script] of [["template", templateScript], ...PAGES.map((p) => [p.file, p.script])]) {
    for (const [label, block] of [["complex-ratio", RATIO], ["realestate-trend", TREND], ["budget-deals", BUDGET]]) assert.ok(script.includes(block), `${name}: ${label} 블록의 글자가 바뀌었다 - 이 PR 은 건드리지 않는다`);
    assert.ok(script.includes(CALL), `${name}: 바깥 catch 의 새 코드가 계약한 모양이 아니다`);
    const main = script.slice(script.indexOf("async function main()"));
    assert.equal(main.slice(0, main.indexOf("  } catch (error) {")).match(/notifyBeside|showGridFailure/g), null, `${name}: 정상 경로(try 본문)에 알림 코드가 있다`);
  }
});

for (const mode of ["404", "reject"]) {
  test(`ⓐⓑⓒⓔ 알림 대상 29장(${mode}): 구운 표·머리는 실패 뒤에도 그대로이고, 알림은 #area-controls 바로 아래에 하나, 기준일은 data-updated 에서 읽는다 - 한국어·영어`, async () => {
    for (const p of NOTICE_PAGES) {
      for (const locale of ["ko", "en"]) {
        const page = await frames[0].open(p, { locale, mode });
        const label = `${p.file} ${locale} ${mode}`;
        // ⓐ 구운 표가 그대로이고 숨지 않는다
        assert.equal(page.tableHtml(), p.grid, `${label}: 구운 표가 바뀌었다`);
        assert.equal(page.overallHtml(), p.cards, `${label}: 구운 카드가 바뀌었다`);
        assert.deepEqual(page.hiddenWrites("district-section"), [], `${label}: 구획의 hidden 을 건드렸다`);
        assert.deepEqual(page.hiddenWrites("district-grid"), [], `${label}: 표의 hidden 을 건드렸다`);
        // ⓑ 알림 하나, #area-controls 바로 아래(.table-wrap 위), 재시도 단추
        const [note, ...rest] = page.notices();
        assert.ok(note && rest.length === 0, `${label}: 알림이 ${page.notices().length}개다`);
        assert.equal(page.byId("area-controls").nextElementSibling, note, `${label}: 알림이 #area-controls 바로 아래가 아니다`);
        assert.equal(note.cls, "content-notice", `${label}: 알림 class`);
        assert.equal(retryButton(note).id, "load-retry", `${label}: 재시도 단추 id`);
        assert.ok(retryButton(note).listeners.click?.length, `${label}: 재시도 단추에 누름 처리가 없다`);
        assert.ok(!page.byId("load-retry").hidden && retryButton(note).textContent === (locale === "en" ? "Retry" : "다시 시도"), `${label}: 재시도 단추 글자`);
        const text = page.textOf(note);
        assert.ok(text.startsWith(locale === "en" ? "Could not load transaction data." : "실거래가를 불러오지 못했습니다."), `${label}: 실패 문구로 시작하지 않는다: ${text}`);
        // ⓒ 기준일은 구운 data-updated 를 그대로 적고, #updated 도 data-updated 도 건드리지 않는다
        assert.ok(p.updated && text.includes(p.updated), `${label}: 알림이 구운 기준일(${p.updated})을 말하지 않는다`);
        assert.ok(text.includes(locale === "en" ? `Shown below is what this page was built with on ${p.updated}.` : `아래는 기준일(${p.updated})에 만든 값입니다.`), `${label}: 둘째 문장`);
        assert.deepEqual(page.state.sets, [], `${label}: #updated 의 속성을 썼다`);
        assert.equal(page.byId("updated").textContent, "", `${label}: #updated 의 글자를 바꿨다`);
        // ⓔ "오늘"·"최신" 류를 쓰지 않는다
        assert.doesNotMatch(text, BAD_WORDS, `${label}: 알림이 지금 값처럼 말한다: ${text}`);
      }
    }
  });
}

test("ⓑ 알림 자리는 #district-section 안, #area-controls 아래·.table-wrap 위이고 .trend-reserve 와 표의 밖이다 (구운 47장 마크업)", () => {
  for (const p of PAGES) {
    const sec = p.html.indexOf('<section id="district-section"');
    const reserve = p.html.indexOf('<div class="trend-reserve ');
    const controls = p.html.indexOf('id="area-controls"', sec);
    const table = p.html.indexOf("<table", sec);
    assert.ok(reserve > 0 && reserve < sec && sec > 0 && sec < controls && controls < table, `${SITE}/${p.file}: 구획·컨트롤·표 자리의 순서가 다르다`);
    // 컨트롤 상자 바로 뒤가 표를 감싼 상자(.table-wrap)이고 그 사이에 다른 것이 없다 - 알림(afterend)은 그 사이에 선다.
    assert.match(p.html.slice(p.html.indexOf("</div>", controls), table), /^<\/div>\s*<div[^>]*>\s*$/, `${SITE}/${p.file}: #area-controls 와 표 사이에 다른 것이 있다`);
  }
});

test("ⓑ 예산대 18장: 알림 요소를 만들지 않는다 - 실패해도 구운 예산 본문 자리는 merge-base 와 같은 옛 실패 행만 쓴다", async () => {
  for (const p of BUDGET_PAGES) {
    for (const locale of ["ko", "en"]) {
      for (const mode of ["404", "reject"]) {
        const page = await frames[0].open(p, { locale, mode });
        const label = `${p.file} ${locale} ${mode}`;
        assert.equal(page.byId("area-controls").inserted.length, 0, `${label}: 예산대 장에 알림 요소를 만들었다`);
        assert.equal(page.notices().length, 0, label);
        assert.equal(
          page.tableHtml(),
          `<tr><td colspan="4">${locale === "en" ? "Could not load transaction data." : "실거래가를 불러오지 못했습니다."} <button type="button" id="load-retry">${locale === "en" ? "Retry" : "다시 시도"}</button></td></tr>`,
          `${label}: 옛 실패 행이 아니다`
        );
      }
    }
  }
});

test("ⓗ 영어 + 실패: 29장은 `Some of it is in Korean only.` 정확히 1(알림 안), 18장은 `Some of it…` 0 이고 budgetKoOnly 의 \"in Korean only\" 보이는 요소 정확히 1", async () => {
  const inKoOnly = (html) => html.match(/in Korean only/g)?.length ?? 0;
  for (const mode of ["404", "reject"]) {
    for (const p of NOTICE_PAGES) {
      const page = await frames[0].open(p, { locale: "en", mode });
      assert.equal(page.koOnly(), 1, `${p.file} ${mode}: 영어 실패에서 고지가 ${page.koOnly()}개다`);
      const total = page.notices().reduce((a, n) => a + (page.textOf(n).match(/in Korean only/g)?.length ?? 0), 0) + inKoOnly(page.budgetHtml()) + inKoOnly(page.tableHtml());
      assert.equal(total, 1, `${p.file} ${mode}: 화면에 \"in Korean only\" 가 ${total}번 보인다`);
    }
    for (const p of BUDGET_PAGES) {
      const page = await frames[0].open(p, { locale: "en", mode });
      assert.equal(page.koOnly(), 0, `${p.file} ${mode}: 예산대 장에 새 고지가 떴다`);
      assert.equal(inKoOnly(page.budgetHtml()), 1, `${p.file} ${mode}: budgetKoOnly 가 정확히 1 이 아니다`);
    }
  }
});

test("ⓗ 한국어 + 실패: 29장은 알림 1·영어 고지 0, 18장은 알림 0", async () => {
  for (const p of PAGES) {
    const page = await frames[0].open(p, { locale: "ko", mode: "reject" });
    assert.equal(page.notices().length, p.budget ? 0 : 1, `${p.file}: 한국어 실패의 알림 수`);
    assert.equal(page.koOnly(), 0, `${p.file}: 한국어에 영어 고지가 떴다`);
    assert.doesNotMatch(page.notices().map(page.textOf).join(""), /[A-Za-z]{4}/, `${p.file}: 한국어 알림에 영어가 섞였다`);
  }
});

test("ⓖ 재시도: 다시 시도가 성공하면 알림이 사라지고 구운 표가 받은 값으로 바뀐다 (영어 고지도 0), 또 실패하면 알림은 갈아 끼워 하나뿐이다", async () => {
  for (const p of NOTICE_PAGES) {
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale });
      const first = page.notices()[0];
      // 또 실패: 고치지 않고 누른다
      retryButton(first).dispatch("click");
      await settleMany();
      assert.equal(first.isConnected, false, `${p.file} ${locale}: 누른 알림이 남았다`);
      assert.equal(page.notices().length, 1, `${p.file} ${locale}: 또 실패했는데 알림이 ${page.notices().length}개다`);
      assert.equal(page.koOnly(), locale === "en" ? 1 : 0, `${p.file} ${locale}: 또 실패 뒤 고지 수`);
      // 성공
      page.state.down = false;
      retryButton(page.notices()[0]).dispatch("click");
      await settleMany();
      assert.equal(page.notices().length, 0, `${p.file} ${locale}: 재시도가 성공했는데 알림이 남았다`);
      assert.equal(page.koOnly(), 0, `${p.file} ${locale}: 재시도 성공 뒤 고지가 남았다`);
      assert.notEqual(page.tableHtml(), p.grid, `${p.file} ${locale}: 재시도가 성공했는데 구운 표 그대로다`);
      assert.match(page.tableHtml(), /<td/, `${p.file} ${locale}: 표가 안 그려졌다`);
    }
  }
});

test("ⓓ(i) 처음부터 ?area=59·114 로 연 27장: 실패하면 구운 84㎡ 표를 남기지 않고 실패 문구 + 재시도(빈 자리)로 간다 - 기준일 문장 없음, 영어는 구운 카드가 남는 동안 영어 고지 하나(#410)", async () => {
  for (const p of AREA_PAGES) {
    for (const area of [59, 114]) {
      for (const locale of ["ko", "en"]) {
        const page = await frames[0].open(p, { locale, search: `?area=${area}` });
        const label = `${p.file} ?area=${area} ${locale}`;
        // 받는 중에 선 영어 고지는 실패로 넘어가도 구운 카드(한국어)가 남아 있으면 그대로다 - 실패 문장·기준일 문장·재시도 단추는 없다.
        const expected = locale === "en" && p.cards ? 1 : 0;
        assert.equal(page.notices().length, expected, `${label}: 면적을 바꾼 보기의 알림 수`);
        assert.equal(page.koOnly(), expected, label);
        assert.doesNotMatch(page.notices().map(page.textOf).join(""), /기준일|Shown below|Could not|Retry/, `${label}: 면적을 바꾼 보기에서 알림에 기준일·실패 문장이 섰다`);
        const grid = page.tableHtml();
        assert.ok(grid.startsWith('<tr><td colspan="4">') && grid.includes('id="load-retry"') && !grid.includes("data-label"), `${label}: 실패 행이 아니다: ${grid.slice(0, 80)}`);
        assert.notEqual(grid, p.grid, `${label}: 구운 84㎡ 표가 남았다`);
        assert.ok(!page.tableHtml().includes(p.grid.slice(0, 60)), label);
      }
    }
  }
});

test("ⓓ(i) 양성 대조: realestate·apartment-rent 는 면적 컨트롤이 hidden 이라 ?area=59 를 무시한다 - 구운 표를 남기고 알림이 선다", async () => {
  for (const file of ["realestate.html", "apartment-rent.html"]) {
    const p = PAGES.find((x) => x.file === file);
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale, search: "?area=59" });
      assert.equal(page.tableHtml(), p.grid, `${file} ${locale}: 구운 표를 걷었다`);
      assert.equal(page.notices().length, 1, `${file} ${locale}: 알림 수`);
    }
  }
  // ?area=84(기본)는 59 가 아니므로 구운 표를 남긴다
  const gangnam = PAGES.find((x) => x.file === "district-gangnam.html");
  const page = await frames[0].open(gangnam, { search: "?area=84" });
  assert.equal(page.tableHtml(), gangnam.grid);
  assert.equal(page.notices().length, 1);
});

test("ⓓ(ii) 실패한 뒤 면적을 바꾸면(27장): 구운 표를 걷고 실패 문구 + 재시도로 바꾸고 알림의 기준일 문장을 뺀다 - 영어는 구운 한국어가 남는 동안 고지 하나, 84 로 되돌려도 복원하지 않는다", async () => {
  const change = (page, value) => page.byId("area-controls").dispatch("change", { target: { id: "area-select", value }, currentTarget: page.byId("area-controls") });
  for (const p of AREA_PAGES) {
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale });
      const label = `${p.file} ${locale}`;
      const before = page.notices()[0];
      assert.ok(before && page.tableHtml() === p.grid, `${label}: 시작 상태`);
      change(page, "59");
      const grid = page.tableHtml();
      assert.ok(grid.startsWith('<tr><td colspan="4">') && grid.includes('id="load-retry"') && !grid.includes("data-label"), `${label}: 면적 변경 뒤 구운 표가 남았다: ${grid.slice(0, 80)}`);
      assert.equal(before.isConnected, false, `${label}: 변경 뒤 옛 알림(기준일 문장)이 남았다`);
      assert.doesNotMatch(page.notices().map(page.textOf).join(""), /기준일|Shown below/, `${label}: 변경 뒤 알림에 기준일 문장이 남았다`);
      // 구운 카드(#overall-cards)는 그대로라 영어에서는 고지가 정확히 하나, 한국어는 알림이 없다
      assert.equal(page.overallHtml(), p.cards, `${label}: 카드를 건드렸다`);
      assert.equal(page.notices().length, locale === "en" ? 1 : 0, `${label}: 변경 뒤 알림 수`);
      assert.equal(page.koOnly(), locale === "en" ? 1 : 0, `${label}: 변경 뒤 고지 수`);
      assert.match(page.headHtml(), /59/, `${label}: 머리가 59㎡ 로 안 바뀌었다`);
      assert.ok(page.byId("load-retry").listeners.click?.length, `${label}: 변경 뒤 재시도 단추에 누름 처리가 없다`);
      // 84 로 되돌려도 구운 표를 복원하지 않는다
      change(page, "84");
      assert.ok(page.tableHtml().includes("load-retry") && page.tableHtml() !== p.grid, `${label}: 84 로 되돌리자 구운 표가 돌아왔다`);
      assert.equal(page.koOnly(), locale === "en" ? 1 : 0, `${label}: 되돌린 뒤 고지 수`);
      // 재시도가 성공하면 고른 면적으로 그려진다
      change(page, "59");
      page.state.down = false;
      page.byId("load-retry").dispatch("click", { currentTarget: page.byId("load-retry") });
      await settleMany();
      assert.match(page.tableHtml(), /<td/, `${label}: 변경 뒤 재시도 성공이 표를 안 그렸다`);
      assert.match(page.headHtml(), /59/, `${label}: 재시도 성공 뒤 머리`);
      assert.equal(page.notices().length, 0, `${label}: 재시도 성공 뒤 알림이 남았다`);
    }
  }
});

test("ⓓ(ii) 변경 뒤 또 실패하면(재시도 실패) 면적을 바꾼 보기라 알림 없이 실패 행만 남는다", async () => {
  const p = PAGES.find((x) => x.file === "apartment-sale.html");
  const page = await frames[0].open(p);
  page.byId("area-controls").dispatch("change", { target: { id: "area-select", value: "59" }, currentTarget: page.byId("area-controls") });
  page.byId("load-retry").dispatch("click", { currentTarget: page.byId("load-retry") });
  await settleMany();
  assert.ok(page.tableHtml().includes("load-retry"));
  assert.equal(page.notices().length, 0);
});

test("(바) 범위 선: complex-ratio·realestate-trend 한 가지만 실패하면 알림이 서지 않고, 예산대의 budget-deals.json 실패도 알림이 없다", async () => {
  for (const only of ["complex-ratio", "realestate-trend"]) {
    for (const p of PAGES.filter((x) => ["realestate.html", "apartment-sale.html", "district-gangnam.html", "budget-7eok.html"].includes(x.file))) {
      const page = await frames[0].open(p, { locale: "en", only });
      assert.equal(page.notices().length, 0, `${p.file} ${only}: 다른 데이터의 실패에 알림이 섰다`);
    }
  }
  for (const p of BUDGET_PAGES) {
    const page = await frames[0].open(p, { locale: "en", only: "budget-deals" });
    assert.equal(page.notices().length, 0, `${p.file}: budget-deals 실패에 알림이 섰다`);
  }
});

// ============================================================================================================
// (바) 이어받기: 받는 중(#410)·재시도 응답 대기·언어 전환(#413). 같은 함수 notifyBeside 를 상태 하나(note: 0 없음 · 1 영어 고지만 · 2 실패)로 같은 자리에 세운다.
// 예산대 18장은 상태가 늘 0 이라 알림 요소를 만들지 않는다(budgetKoOnly 가 상시 고지). 새 문장·새 id·새 data-* 는 없다.
// ============================================================================================================
const flip = (page) => page.byId("lang-toggle").dispatch("click");
const changeArea = (page, value) => page.byId("area-controls").dispatch("change", { target: { id: "area-select", value }, currentTarget: page.byId("area-controls") });
const noteTexts = (page) => page.notices().map(page.textOf);
const inKoOnly = (html) => html.match(/in Korean only/g)?.length ?? 0;
const FAIL_KO = (p) => `실거래가를 불러오지 못했습니다. 아래는 기준일(${p.updated})에 만든 값입니다.`;
const FAIL_EN = (p) => `Could not load transaction data. Shown below is what this page was built with on ${p.updated}. ${KO_ONLY}`;

/** 받는 중의 29장·영어: 알림은 영어 고지 한 줄뿐(재시도 단추 없음)이고 #area-controls 바로 아래에 하나, 구운 것은 그대로다. */
const assertWaitingEn = (page, p, label) => {
  assert.deepEqual(noteTexts(page), [KO_ONLY], `${label}: 받는 중 알림`);
  const [note] = page.notices();
  assert.equal(page.byId("area-controls").nextElementSibling, note, `${label}: 알림 자리`);
  assert.equal(note.inserted.length, 0, `${label}: 받는 중 알림에 재시도 단추가 있다`);
  assert.equal(page.koOnly(), 1, label);
  assert.equal(page.overallHtml(), p.cards, `${label}: 구운 카드가 바뀌었다`);
  assert.deepEqual(page.hiddenWrites("district-section"), [], `${label}: 구획의 hidden 을 건드렸다`);
};
/** 구운 표의 면적 칸이 전부 가려졌다(칸은 그대로 있다 - 자리 높이 유지). */
const assertHeld = (page, label) => {
  const hidden = page.areaCellsHidden();
  assert.ok(hidden.length > 0 && hidden.every(Boolean), `${label}: 구운 84㎡ 칸이 가려지지 않았다 (${hidden.length}칸)`);
};
const assertShown = (page, label) => {
  const hidden = page.areaCellsHidden();
  assert.ok(hidden.every((x) => !x), `${label}: 구운 칸이 가려져 있다`);
};
/** 실패 알림 하나가 locale 의 말로 서 있다. */
const assertFailNote = (page, p, locale, label) => {
  assert.equal(page.notices().length, 1, `${label}: 알림이 ${page.notices().length}개다`);
  const [note] = page.notices();
  assert.equal(page.textOf(note), `${locale === "en" ? FAIL_EN(p) : FAIL_KO(p)} ${locale === "en" ? "Retry" : "다시 시도"}`, `${label}: 알림 문장`);
  assert.equal(page.koOnly(), locale === "en" ? 1 : 0, `${label}: 고지 수`);
  assert.ok(retryButton(note).listeners.click?.length, `${label}: 재시도 단추에 누름 처리가 없다`);
  assert.equal(page.byId("area-controls").nextElementSibling, note, `${label}: 알림 자리`);
};

test("#410 받는 중: 29장은 영어에서 `Some of it is in Korean only.` 한 줄뿐인 알림이 정확히 1(한국어는 0), 구운 표·카드·기준일은 그대로 - 18장은 새 알림 0 이고 budgetKoOnly 의 \"in Korean only\" 가 정확히 1", async () => {
  for (const p of PAGES) {
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale, wait: true });
      const label = `${p.file} ${locale}`;
      assert.equal(page.tableHtml(), p.grid, `${label}: 받는 중에 구운 표가 바뀌었다`);
      assert.deepEqual(page.state.sets, [], `${label}: #updated 의 속성을 썼다`);
      if (p.budget || locale === "ko") {
        assert.equal(page.notices().length, 0, `${label}: 받는 중 알림 수`);
        assert.equal(page.byId("area-controls").inserted.length, 0, `${label}: 알림 요소를 만들었다`);
        if (p.budget && locale === "en") assert.equal(inKoOnly(page.budgetHtml()), 1, `${label}: budgetKoOnly 가 정확히 1 이 아니다`);
        if (p.budget) assert.equal(page.koOnly(), 0, `${label}: 예산대 장에 새 고지가 떴다`);
      } else assertWaitingEn(page, p, label);
    }
  }
});

for (const mode of ["404", "reject"]) {
  test(`#410 받는 중에서 실패(${mode})로 넘어가면 받는 중 고지는 사라지고 실패 알림 하나가 서며 영어 고지는 정확히 1 - 29장, 두 문장이 한 화면에 같이 서지 않는다`, async () => {
    for (const p of NOTICE_PAGES) {
      for (const locale of ["ko", "en"]) {
        const page = await frames[0].open(p, { locale, mode, wait: true });
        const label = `${p.file} ${locale} ${mode}`;
        const waiting = page.notices();
        assert.equal(waiting.length, locale === "en" ? 1 : 0, `${label}: 받는 중 알림 수`);
        page.state.release();
        await settleMany();
        for (const n of waiting) assert.equal(n.isConnected, false, `${label}: 받는 중 알림이 실패 알림과 같이 남았다`);
        assertFailNote(page, p, locale, label);
        assert.equal(page.tableHtml(), p.grid, `${label}: 실패 뒤 구운 표가 바뀌었다`);
      }
    }
  });
}

test("#410 받는 중에서 응답이 오면(성공) 알림이 걷히고 표가 받은 값으로 바뀐다 - 영어 고지 0, 29장", async () => {
  for (const p of NOTICE_PAGES) {
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale, wait: true });
      const label = `${p.file} ${locale}`;
      page.state.down = false;
      page.state.release();
      await settleMany();
      assert.equal(page.notices().length, 0, `${label}: 응답이 왔는데 알림이 남았다`);
      assert.equal(page.koOnly(), 0, label);
      assert.notEqual(page.tableHtml(), p.grid, `${label}: 구운 표 그대로다`);
      assert.match(page.tableHtml(), /<td/, label);
    }
  }
});

test("#410 재시도 응답 대기(po 판정): 실패 알림에서 다시 시도를 누르면 기다리는 동안도 영어 고지 정확히 1(실패 문장·재시도 단추 없음), 한국어 0 - 또 실패하면 실패 알림 하나, 성공이면 0, 29장", async () => {
  for (const p of NOTICE_PAGES) {
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale });
      const label = `${p.file} ${locale}`;
      const first = page.notices()[0];
      // 한 번 더: 응답 대기
      page.state.hold();
      retryButton(first).dispatch("click");
      await settleMany();
      assert.equal(first.isConnected, false, `${label}: 누른 알림이 남았다`);
      if (locale === "en") assertWaitingEn(page, p, `${label} 재시도 대기`);
      else assert.equal(page.notices().length, 0, `${label}: 재시도 대기 중 알림 수`);
      assert.equal(page.tableHtml(), p.grid, `${label}: 재시도 대기 중 구운 표가 바뀌었다`);
      // 대기 끝, 또 실패
      page.state.release();
      await settleMany();
      assertFailNote(page, p, locale, `${label} 또 실패`);
      // 다시 한 번 대기 뒤 성공
      page.state.down = false;
      page.state.hold();
      retryButton(page.notices()[0]).dispatch("click");
      await settleMany();
      assert.equal(page.notices().length, locale === "en" ? 1 : 0, `${label}: 두 번째 대기 중 알림 수`);
      page.state.release();
      await settleMany();
      assert.equal(page.notices().length, 0, `${label}: 성공했는데 알림이 남았다`);
      assert.notEqual(page.tableHtml(), p.grid, `${label}: 성공했는데 구운 표 그대로다`);
    }
  }
});

test("#410 받는 중 ?area=59·114(27장): 구운 84㎡ 칸이 가려지고 칸은 그대로 있다(자리 높이 유지) - 응답이 오면 받은 값, 영어는 고지 하나", async () => {
  for (const p of AREA_PAGES) {
    for (const area of [59, 114]) {
      for (const locale of ["ko", "en"]) {
        const label = `${p.file} ?area=${area} ${locale}`;
        const page = await frames[0].open(p, { locale, search: `?area=${area}`, wait: true });
        assertHeld(page, label);
        assert.equal(page.tableHtml(), p.grid, `${label}: 구운 표의 행이 바뀌었다 - 자리 높이가 달라진다`);
        assert.match(page.headHtml(), new RegExp(String(area)), `${label}: 머리가 ${area}㎡ 가 아니다`);
        assert.equal(page.notices().length, locale === "en" ? 1 : 0, `${label}: 알림 수`);
        page.state.down = false;
        page.state.release();
        await settleMany();
        assertShown(page, `${label} 응답 뒤`);
        assert.notEqual(page.tableHtml(), p.grid, `${label}: 구운 84㎡ 표 그대로다`);
        assert.equal(page.notices().length, 0, label);
      }
    }
  }
});

test("#410 받는 중 양성 대조: ?area=84·없음(27장)과 면적 칸이 없는 realestate·apartment-rent 의 ?area=59 는 구운 표를 가리지 않는다", async () => {
  for (const p of AREA_PAGES) {
    for (const search of ["", "?area=84"]) {
      const page = await frames[0].open(p, { search, wait: true });
      assert.ok(page.areaCellsHidden().length > 0, `${p.file}: 면적 칸이 없다`);
      assertShown(page, `${p.file} ${search}: 기본 면적`);
    }
  }
  for (const file of ["realestate.html", "apartment-rent.html"]) {
    const p = PAGES.find((x) => x.file === file);
    const page = await frames[0].open(p, { search: "?area=59", wait: true });
    assertShown(page, `${file}: 면적을 무시하는 장`);
    assert.equal(page.tableHtml(), p.grid, file);
  }
});

test("#410 받는 중에 면적을 바꾸면(27장): 59 로 가면 구운 칸을 가리고 84 로 되돌리면 다시 보인다 - 영어 고지는 그대로 하나", async () => {
  for (const p of AREA_PAGES) {
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale, wait: true });
      const label = `${p.file} ${locale}`;
      assertShown(page, `${label} 시작`);
      changeArea(page, "59");
      assertHeld(page, `${label} 59`);
      assert.equal(page.notices().length, locale === "en" ? 1 : 0, `${label}: 면적을 바꾼 뒤 알림 수`);
      assert.equal(page.koOnly(), locale === "en" ? 1 : 0, label);
      changeArea(page, "84");
      assertShown(page, `${label} 84 로 되돌림`);
      assert.equal(page.notices().length, locale === "en" ? 1 : 0, `${label}: 되돌린 뒤 알림 수`);
      assert.equal(page.tableHtml(), p.grid, label);
    }
  }
});

test("#410 처음부터 ?area=59 로 실패한 뒤 다시 시도(27장): 응답을 기다리는 동안 구운 84㎡ 값은 없고(실패 행) 영어는 구운 카드가 남는 동안 고지 하나", async () => {
  for (const p of AREA_PAGES) {
    for (const locale of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale, search: "?area=59" });
      const label = `${p.file} ${locale}`;
      page.state.hold();
      page.byId("load-retry").dispatch("click", { currentTarget: page.byId("load-retry") });
      await settleMany();
      assert.ok(page.tableHtml().includes("load-retry") && page.tableHtml() !== p.grid, `${label}: 재시도 대기 중 구운 표가 돌아왔다`);
      assert.equal(page.notices().length, locale === "en" && p.cards ? 1 : 0, `${label}: 재시도 대기 중 알림 수`);
      page.state.down = false;
      page.state.release();
      await settleMany();
      assert.match(page.tableHtml(), /<td/, label);
      assert.equal(page.notices().length, 0, `${label}: 성공했는데 알림이 남았다`);
    }
  }
});

for (const mode of ["404", "reject"]) {
  test(`#413 실패 알림(${mode})이 떠 있는 동안 ko↔en 을 바꾸면 알림이 새 언어로 다시 그려진다 - 왕복해도 하나, 영어 고지는 영어에서만 정확히 1, 구운 표·기준일은 그대로, 29장`, async () => {
    for (const p of NOTICE_PAGES) {
      for (const start of ["ko", "en"]) {
        const page = await frames[0].open(p, { locale: start, mode });
        let locale = start;
        for (let i = 0; i < 4; i += 1) {
          flip(page);
          locale = locale === "ko" ? "en" : "ko";
          assertFailNote(page, p, locale, `${p.file} ${start} 전환 ${i + 1}번째(${locale}) ${mode}`);
          assert.equal(page.tableHtml(), p.grid, `${p.file}: 전환이 구운 표를 바꿨다`);
          assert.equal(page.overallHtml(), p.cards, `${p.file}: 전환이 구운 카드를 바꿨다`);
          assert.deepEqual(page.state.sets, [], `${p.file}: #updated 의 속성을 썼다`);
        }
        // 전환 뒤 다시 시도: 또 실패하면 알림 하나가 새로 서고, 성공하면 사라진다
        retryButton(page.notices()[0]).dispatch("click");
        await settleMany();
        assertFailNote(page, p, locale, `${p.file} ${start} 전환 뒤 또 실패 ${mode}`);
        page.state.down = false;
        retryButton(page.notices()[0]).dispatch("click");
        await settleMany();
        assert.equal(page.notices().length, mode === "404" ? 1 : 0, `${p.file}: 전환 뒤 재시도 뒤 알림 수 (404 는 고쳐도 계속 404)`);
        assert.equal(page.koOnly(), mode === "404" && locale === "en" ? 1 : 0, p.file);
      }
    }
  });
}

test("#413 받는 중에 언어를 바꾸면 영어에서는 영어 고지 한 줄이 서고 한국어에서는 걷힌다 - 18장은 알림 요소를 만들지 않는다", async () => {
  for (const p of PAGES) {
    for (const start of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale: start, wait: true });
      let locale = start;
      for (let i = 0; i < 3; i += 1) {
        flip(page);
        locale = locale === "ko" ? "en" : "ko";
        const label = `${p.file} ${start} 전환 ${i + 1}번째(${locale})`;
        if (p.budget) assert.equal(page.byId("area-controls").inserted.length, 0, `${label}: 예산대 장에 알림 요소를 만들었다`);
        else if (locale === "en") assertWaitingEn(page, p, label);
        else assert.equal(page.notices().length, 0, `${label}: 한국어에 고지가 남았다`);
      }
    }
  }
});

test("#413 실패 뒤 면적을 바꾼 화면(27장)에서 언어를 바꾸면 영어에서는 구운 카드가 남는 동안 고지 하나, 한국어에서는 0", async () => {
  for (const p of AREA_PAGES) {
    for (const start of ["ko", "en"]) {
      const page = await frames[0].open(p, { locale: start });
      changeArea(page, "59");
      let locale = start;
      for (let i = 0; i < 3; i += 1) {
        const label = `${p.file} ${start} 면적 변경 뒤 ${i}번 전환(${locale})`;
        assert.deepEqual(noteTexts(page), locale === "en" && p.cards ? [KO_ONLY] : [], label);
        flip(page);
        locale = locale === "ko" ? "en" : "ko";
      }
    }
  }
});

test("#413 예산대 18장: 실패해도 언어를 바꿔도 알림 요소가 없다 - 옛 실패 행·budgetKoOnly 만", async () => {
  for (const p of BUDGET_PAGES) {
    for (const mode of ["404", "reject"]) {
      const page = await frames[0].open(p, { locale: "ko", mode });
      flip(page);
      assert.equal(page.byId("area-controls").inserted.length, 0, `${p.file} ${mode}: 알림 요소를 만들었다`);
      assert.equal(page.koOnly(), 0, p.file);
      assert.equal(inKoOnly(page.budgetHtml()), 1, `${p.file} ${mode}: 영어 전환 뒤 budgetKoOnly 가 정확히 1 이 아니다`);
    }
  }
});

test("ⓕ (#410·#413) 알림은 drawNote 한 곳에서만 세운다 - notifyBeside 호출은 그 안의 둘뿐이고, 언어 전환이 그 함수를 부르며, 새 훅이 없다", () => {
  for (const [name, script] of [["template", templateScript], ...PAGES.map((p) => [p.file, p.script])]) {
    const a = script.indexOf("function drawNote() {");
    const body = script.slice(a, script.indexOf("\n}\n", a) + 3);
    assert.equal(body.match(/notifyBeside\(/g)?.length, 2, `${name}: drawNote 안의 notifyBeside 호출이 둘이 아니다`);
    assert.equal(script.replace(NOTIFY_FN, "").replace(body, "").match(/notifyBeside\(/g), null, `${name}: drawNote 밖에서 알림을 세운다`);
    assert.ok(script.includes('renderAll();\n  drawNote();\n  window.analytics?.event("language_switch"'), `${name}: 언어 전환이 알림을 다시 그리지 않는다`);
    assert.equal(script.match(/style\.visibility/g)?.length, 1, `${name}: 가림 코드가 하나가 아니다`);
    assert.doesNotMatch(script, /dataset|classList|className/, `${name}: 새 훅(dataset·class 쓰기)을 만들었다`);
  }
});

test("변이 증빙 (#410·#413): 받는 중 알림을 안 세우는 사본, 면적 칸을 안 가리는 사본, 언어 전환이 알림을 안 그리는 사본은 위 점검이 실패시킨다", async () => {
  const mutation = (from, to) => (script) => {
    assert.ok(script.includes(from), `변이 대상이 없다: ${from}`);
    return script.replace(from, to);
  };
  const sale = PAGES.find((x) => x.file === "apartment-sale.html");
  const noWait = await frames[0].open(sale, { locale: "en", wait: true, mutate: mutation("note = budgetEnabled ? 0 : 1;", "note = 0;") });
  assert.throws(() => assertWaitingEn(noWait, sale, "변이1"), /받는 중 알림/, "받는 중 알림을 안 세워도 점검이 통과한다");

  const noHold = await frames[0].open(sale, { search: "?area=59", wait: true, mutate: mutation('td.style.visibility = areaM2 === DEFAULT_AREA_M2 ? "" : "hidden"', 'td.style.visibility = ""') });
  assert.throws(() => assertHeld(noHold, "변이2"), /가려지지 않았다/, "칸을 안 가려도 점검이 통과한다");

  const kept = await frames[0].open(sale, { locale: "ko" });
  const noRedraw = await frames[0].open(sale, { locale: "ko", mutate: mutation('renderAll();\n  drawNote();\n  window.analytics?.event("language_switch"', 'renderAll();\n  window.analytics?.event("language_switch"') });
  flip(kept);
  assertFailNote(kept, sale, "en", "대조(고친 코드)");
  flip(noRedraw);
  assert.throws(() => assertFailNote(noRedraw, sale, "en", "변이3"), /알림 문장|고지 수/, "언어 전환이 알림을 안 그려도 점검이 통과한다");
});

// ============================================================================================================
// 둘째 행: 첫 화면(docs/index.html, 틀 (다), F1~F4). 같은 규칙 2~5 를 이 장의 머리 배너(#load-error)로 지킨다 -
// 구운 자리 셋(#market-line·#realestate-grid·#news-link-row)과 구운 기준일(#updated)을 실패해도 지우지 않고, 배너가
// [무엇을 못 받았는지] + [아래는 기준일(구운 data-updated)에 만든 값입니다] + (영어) [Some of it is in Korean only.] + [다시 시도] 를 말한다.
// 이 장은 load-state.js 를 <script src> 로 물지 않는다(S6) - 문장 글자만 같게 두고 그것을 아래에서 맞대 본다. 실패 이유("HTTP 503")는 보이지 않는다.
// #575 PR2: 메인은 시장 지표 표 → 값 한 줄, AI 요약·뉴스 다섯 건 → 뉴스 화면 링크 한 줄이 되었고 받는 것은 market·realestate 둘이다.
// 지난 날짜 보기(?date=)는 뉴스 화면으로 옮겨 메인에는 없다(옛 주소는 news.html?date= 로 보낸다 - url-state 시험). 그래서 옛 ⓓ·ⓖ(지난 날짜)
// 시험 넷과 요약·뉴스 칸 갈래는 지웠다. 뉴스 링크 줄은 스크립트가 받지 않는 자리라(건수는 구운 data-n) 실패해도 늘 구운 채다.
// ============================================================================================================
const INDEX_SPOTS = ["market-line", "realestate-grid", "news-link-row"];
const INDEX_TODAY = ["market", "realestate"];
const indexSource = await readFile(path.join(root, `${SITE}/index.html`), "utf8");
const indexScript = scriptOf(indexSource);
const HTTP_WORDS = /HTTP|\b(?:404|503)\b/;
// 받은 market.json 으로 화면이 쓰는 한 줄(renderMarket 과 같은 식) - 데이터 값과 무관하게 "받은 값으로 바뀌었다"를 글자로 맞댄다.
const marketLine = (m) =>
  `한국은행 기준금리 ${m.baseRate.value}% · 원/달러 환율 ${Number(m.usdKrw.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원${/^\d{1,2}\/\d{1,2}$/.test(m.usdKrw.asOf) ? `(${m.usdKrw.asOf} 기준)` : ""}`;

// 데이터 요청을 막는 서버. mode 는 바꿔 끼울 수 있다(재시도 시험). only 가 있으면 그 파일만 실패한다.
function indexServer(mode, only = null) {
  const state = { mode };
  state.fetch = async (url) => {
    const name = String(url).split("/data/")[1]?.split(".json")[0];
    const down = state.mode !== "ok" && (!only || only === name);
    if (down && state.mode === "network") throw new TypeError("Failed to fetch");
    if (down) return { ok: false, status: state.mode === "404" ? 404 : 503, json: async () => ({}) };
    if (!name) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: () => readJson(name) };
  };
  return state;
}
const openIndex = async ({ lang = "ko", mode = "network", only = null, search = "", mutate } = {}) => {
  const server = indexServer(mode, only);
  const page = await loadIndexPage({ baked: true, fetch: server.fetch, storage: { lang }, search, mutate });
  await settle(60);
  return { page, server };
};
const bannerOf = (page) => ({
  hidden: page.byId("load-error").hidden,
  text: String(page.byId("load-error-text").textContent),
  retry: String(page.byId("load-error-retry").textContent),
});
const countOf = (text, needle) => text.split(needle).length - 1;
const clickRetry = async (page) => {
  const button = page.byId("load-error-retry");
  button.dispatch("click", { currentTarget: button });
  await settle(60);
};

// ⓐⓒ 구운 자리·구운 기준일이 실패 뒤에도 그대로다. 변이 시험이 같은 함수를 쓴다.
function assertBakedKept(page, label) {
  for (const id of INDEX_SPOTS) assert.equal(page.byId(id).innerHTML, page.baked[id], `${label}: #${id} 의 구운 내용이 바뀌었다`);
  assert.equal(page.byId("updated").textContent, page.baked.updatedText, `${label}: 구운 기준일 글자가 바뀌었다`);
  assert.equal(page.byId("updated").getAttribute("data-updated"), page.baked.day, `${label}: data-updated 가 바뀌었다`);
}

test("(다) 범위: index 는 구운 조각 셋과 구운 기준일(data-updated)을 갖고, load-state.js 를 <script src> 로 물지 않는다 (S6)", () => {
  assert.equal(indexSource.includes("load-state.js"), false, "index 가 load-state.js 를 문다 - 외부 JS 를 더하는 일이라 cto 허용 표가 먼저다");
  for (const name of ["market", "realestate", "news"]) {
    assert.match(indexSource, new RegExp(`<!--prerender:${name}-->[\\s\\S]+<!--/prerender:${name}-->`), `구운 ${name} 조각이 비었다`);
  }
  assert.match(indexSource, /<div class="updated" id="updated" data-updated="\d{4}-\d{2}-\d{2}">/, "구운 기준일 줄에 data-updated 가 없다");
});

test("ⓐⓒ (다) 요청이 전부 실패(네트워크·404·503)해도 구운 자리 셋과 구운 기준일 글자·data-updated 가 한 글자도 안 바뀐다 - 한국어·영어", async () => {
  for (const lang of ["ko", "en"]) {
    for (const mode of ["network", "404", "503"]) {
      const { page } = await openIndex({ lang, mode });
      assertBakedKept(page, `${lang} ${mode}`);
    }
  }
});

test("ⓑⓔ (다) 실패하면 머리 배너가 보이고 이름 + 구운 기준일 문장 + 다시 시도를 말한다 - 영어는 한국어 고지 정확히 1, 한국어는 0, 실패 이유·오늘·최신은 없다", async () => {
  for (const [lang, names, kept, retry] of [
    ["ko", "시장지표, 부동산을 불러오지 못했습니다.", (day) => `아래는 기준일(${day})에 만든 값입니다.`, "다시 시도"],
    ["en", "Could not load: market data, real estate.", (day) => `Shown below is what this page was built with on ${day}.`, "Retry"],
  ]) {
    for (const mode of ["network", "404", "503"]) {
      const { page } = await openIndex({ lang, mode });
      const banner = bannerOf(page);
      const label = `${lang} ${mode}`;
      assert.equal(banner.hidden, false, `${label}: 배너가 안 보인다`);
      assert.ok(banner.text.startsWith(names), `${label}: 못 받은 것의 이름이 다르다: ${banner.text}`);
      assert.ok(banner.text.includes(kept(page.baked.day)), `${label}: 구운 기준일 문장이 없다: ${banner.text}`);
      assert.equal(countOf(banner.text, KO_ONLY), lang === "en" ? 1 : 0, `${label}: 한국어 고지 수가 다르다: ${banner.text}`);
      assert.equal(banner.retry, retry, `${label}: 다시 시도 단추 글자`);
      assert.ok((page.byId("load-error-retry").listeners.click ?? []).length > 0, `${label}: 다시 시도 단추에 누름 처리가 없다`);
      assert.equal(HTTP_WORDS.test(banner.text), false, `${label}: 실패 이유가 방문자에게 보인다: ${banner.text}`);
      assert.equal(BAD_WORDS.test(banner.text), false, `${label}: 알림이 지금 값처럼 말한다: ${banner.text}`);
    }
  }
});

test("ⓑ (다) 실패한 뒤 언어를 바꾸면 배너 문구가 그 언어로 바뀌고 구운 표는 그대로다", async () => {
  const { page } = await openIndex({ lang: "ko" });
  assert.equal(countOf(bannerOf(page).text, KO_ONLY), 0);
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  const en = bannerOf(page);
  assert.equal(en.hidden, false);
  assert.ok(en.text.startsWith("Could not load:") && countOf(en.text, KO_ONLY) === 1 && en.retry === "Retry", `영어 배너: ${en.text}`);
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  assert.equal(countOf(bannerOf(page).text, KO_ONLY), 0);
  assertBakedKept(page, "언어 전환 뒤");
});

test("ⓐ (다) 한 가지만 실패하면 그 자리만 구운 채로 남고 나머지는 받은 값으로 바뀐다 - 배너는 실패한 것만 말한다", async () => {
  const market = await readJson("market");
  const label = { market: "시장지표를", realestate: "부동산을" };
  {
    const { page } = await openIndex({ mode: "503", only: "market" });
    assert.equal(page.byId("market-line").innerHTML, page.baked["market-line"], "market: 못 받은 자리의 구운 내용이 바뀌었다");
    assert.notEqual(page.byId("realestate-grid").innerHTML, page.baked["realestate-grid"], "market 실패인데 realestate 는 받은 값으로 안 바뀌었다");
  }
  {
    const { page } = await openIndex({ mode: "503", only: "realestate" });
    assert.equal(page.byId("realestate-grid").innerHTML, page.baked["realestate-grid"], "realestate: 못 받은 자리의 구운 내용이 바뀌었다");
    assert.equal(page.byId("market-line").textContent, marketLine(market), "realestate 실패인데 market 은 받은 값으로 안 바뀌었다");
  }
  for (const failing of INDEX_TODAY) {
    const banner = bannerOf((await openIndex({ mode: "503", only: failing })).page);
    assert.equal(banner.hidden, false);
    assert.ok(banner.text.startsWith(`${label[failing]} 불러오지 못했습니다.`), `${failing}: ${banner.text}`);
  }
});

test("ⓖ (다) 다시 시도가 성공하면 배너가 걷히고 구운 자리가 받은 값으로 바뀐다, 또 실패하면 구운 채로 배너가 남는다", async () => {
  const market = await readJson("market");
  for (const lang of ["ko", "en"]) {
    const { page, server } = await openIndex({ lang });
    await clickRetry(page);
    assert.equal(bannerOf(page).hidden, false, `${lang}: 다시 실패했는데 배너가 걷혔다`);
    assertBakedKept(page, `${lang} 재시도 실패`);

    server.mode = "ok";
    await clickRetry(page);
    const banner = bannerOf(page);
    assert.equal(banner.hidden, true, `${lang}: 성공했는데 배너가 남았다`);
    assert.equal(banner.text, "", `${lang}: 걷힌 배너에 글자가 남았다`);
    assert.notEqual(page.byId("realestate-grid").innerHTML, page.baked["realestate-grid"], `${lang}: #realestate-grid 가 받은 값으로 안 바뀌었다`);
    if (lang === "ko") assert.equal(page.byId("market-line").textContent, marketLine(market), "ko: 돈의 값 줄이 받은 값으로 안 바뀌었다");
    else assert.match(String(page.byId("market-line").textContent), /^BOK Base Rate .+% · USD\/KRW [\d,.]+(?: \(as of \d{1,2}\/\d{1,2}\))?$/, "en: 돈의 값 줄이 영어로 안 바뀌었다");
  }
});

test("(다) 규칙 1: 구운 내용이 없는 빈 자리는 실패하면 실패 문구로 바꾸고 구운 기준일 문장은 말하지 않는다", async () => {
  const server = indexServer("network");
  const page = await loadIndexPage({ fetch: server.fetch });
  await settle(60);
  assert.ok(String(page.byId("realestate-grid").innerHTML).includes("불러오지 못했습니다"), "#realestate-grid 빈 자리에 실패 문구가 없다");
  // 돈의 값 한 줄은 못 받으면 쓰지 않는다 - 빈 자리는 빈 채(머리 배너가 시장지표를 못 받았다고 말한다).
  assert.equal(String(page.byId("market-line").textContent), "", "#market-line 빈 자리에 무엇을 썼다");
  assert.ok(bannerOf(page).text.includes("시장지표"), "배너가 시장지표 실패를 말하지 않는다");
  assert.equal(/기준일\(/.test(bannerOf(page).text), false, "구운 기준일이 없는데 기준일 문장이 붙었다");
});

test("ⓕ (다) 구운 자리의 실패 갈래는 쓰기 전에 먼저 나간다 - 새 실패 마크업은 없고 알림은 머리 배너 한 곳이다", () => {
  for (const [fn, guard] of [
    ["renderMarket", "!parts.length"],
    ["renderRealestate", "baked(tbody, realestate)"],
  ]) {
    const a = indexScript.indexOf(`function ${fn}(`);
    const body = indexScript.slice(a, indexScript.indexOf("\n  function ", a + 10));
    const g = body.indexOf(`if (${guard}) return;`);
    assert.ok(g > 0, `${fn}: 구운 내용을 남기는 갈래가 없다`);
    assert.equal(/innerHTML\s*=|textContent\s*=|classList\.add|hidden\s*=/.test(body.slice(0, g)), false, `${fn}: 구운 내용을 남기는 갈래보다 먼저 자리를 건드린다`);
  }
  assert.equal(countOf(indexScript, "const baked = "), 1);
  assert.equal(countOf(indexScript, 'id="load-retry"'), 0, "index 에 재시도 단추 마크업이 새로 생겼다 - 머리 배너(#load-error-retry) 하나만 쓴다");
  assert.equal(/insertAdjacentHTML|notifyBeside|showFailure/.test(indexScript), false, "index 에 알림 요소를 직접 만들었다");
});

test("(다) 배너의 둘째 문장은 load-state.js 의 notifyBeside 와 같은 말이다 (한·영) - 문구가 두 곳에서 갈라지지 않게", () => {
  assert.ok(loadStateSource.includes("`Shown below is what this page was built with${day ? ` on ${day}` :"), "load-state.js 의 영어 문장이 바뀌었다");
  assert.ok(indexScript.includes("Shown below is what this page was built with on ${day}. Some of it is in Korean only."), "index 의 영어 문장이 load-state.js 와 다르다");
  assert.ok(loadStateSource.includes('en && "Some of it is in Korean only."'));
  assert.ok(loadStateSource.includes("`아래는 ${day ? `기준일(${day})` :") && loadStateSource.includes("에 만든 값입니다.`"), "load-state.js 의 한국어 문장이 바뀌었다");
  assert.ok(indexScript.includes("아래는 기준일(${day})에 만든 값입니다."), "index 의 한국어 문장이 load-state.js 와 다르다");
});

// 변이 증빙: 같은 점검이 규칙을 어긴 사본에서는 실패해야 한다(통과만 하는 시험이 아님을 보인다).
const mutation = (from, to) => (script) => {
  assert.ok(script.includes(from), `변이 대상 글자를 못 찾았다: ${from}`);
  return script.replace(from, to);
};

test("변이 증빙 (다): 구운 내용을 남기는 갈래를 지운 사본, 구운 기준일을 지우는 사본은 위 점검이 실패시킨다", async () => {
  const noKeep = await openIndex({ mutate: mutation("const baked = (el, data) => !data && el.textContent;", "const baked = () => false;") });
  assert.throws(() => assertBakedKept(noKeep.page, "변이1"), /구운 내용이 바뀌었다/, "구운 내용을 안 남겨도 ⓐ 가 통과한다");

  const noMarketKeep = await openIndex({ mutate: mutation("    if (!parts.length) return;\n", "") });
  assert.throws(() => assertBakedKept(noMarketKeep.page, "변이2"), /#market-line 의 구운 내용이 바뀌었다/, "돈의 값 줄을 비워도 ⓐ 가 통과한다");

  const noStamp = await openIndex({
    mutate: mutation(
      'if (latest) document.getElementById("updated").textContent = t("lastUpdated")(fmtUpdated(latest));',
      'document.getElementById("updated").textContent = latest ? t("lastUpdated")(fmtUpdated(latest)) : "-";',
    ),
  });
  assert.throws(() => assertBakedKept(noStamp.page, "변이3"), /구운 기준일 글자가 바뀌었다/, "기준일을 '-'로 바꿔도 ⓒ 가 통과한다");
});

// ============================================================================================================
// 셋째 행: 뉴스 틀(docs/news.html)과 그 틀로 찍은 3장(rate-news·realestate-news·stock-news), 틀 (나), F5·F6·H2. 같은 규칙 2~5 를
// #content 안의 알림 한 줄로 지킨다 - 구운 기사 목록(#news-list)·AI 요약(#summary-box)·시세 카드(#realestate-stats)와 구운 기준일(#updated)을
// 실패해도 지우지·숨기지 않고, 알림이 [못 받은 것의 이름] + [아래는 기준일(구운 data-updated)에 만든 값입니다] + (영어) [Some of it is in Korean only.] +
// [다시 시도] 를 말한다. 이 4장은 load-state.js 를 <script src> 로 물지 않는다(S6) - 문장 글자만 같게 두고 아래에서 맞대 본다. 실패 이유("HTTP 503")는 보이지 않는다.
// 분류는 <meta name="news-category"> 로 장마다 고정이고 방문자가 바꾸지 않는다 - 규칙 3번이 걸리는 보기가 없다(po 2026-10-14 실측).
// 구운 한국어 본문은 영어 화면에서도 한국어이므로 영어 고지를 붙인다(금리 틀만 뺀다는 po 판정, 이 틀은 붙이는 쪽).
// ============================================================================================================
const NEWS_FILES = ["news", "rate-news", "realestate-news", "stock-news"];
const newsSources = {};
for (const name of NEWS_FILES) {
  const html = await readFile(path.join(root, `${SITE}/${name}.html`), "utf8");
  newsSources[name] = { html, script: scriptOf(html), category: /name="news-category" content="([^"]+)"/.exec(html)?.[1] ?? null };
}

// 데이터 요청을 막는 서버(index 와 같은 모양). only 가 있으면 그 파일만 실패한다. overrides 는 성공 응답을 바꿔 끼운다.
function newsServer(mode, only = null, overrides = {}) {
  const state = { mode, requests: [] };
  state.fetch = async (url) => {
    const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
    state.requests.push(name);
    const down = state.mode !== "ok" && (!only || only === name);
    if (down && state.mode === "network") throw new TypeError("Failed to fetch");
    if (down) return { ok: false, status: state.mode === "404" ? 404 : 503, json: async () => ({}) };
    if (name in overrides) return { ok: true, status: 200, json: async () => overrides[name] };
    return { ok: true, status: 200, json: () => readJson(name) };
  };
  return state;
}
const openNews = async (name, { lang = "ko", mode = "network", only = null, overrides = {}, mutate } = {}) => {
  const server = newsServer(mode, only, overrides);
  const page = await loadNewsPage({ file: `${SITE}/${name}.html`, category: newsSources[name].category, locale: lang, fetch: server.fetch, baked: true, mutate });
  await settle(30);
  return { page, server };
};
const NEWS_SPOTS = ["news-list", "summary-box", "realestate-stats"];
const clickNewsRetry = async (page) => {
  page.byId("load-retry").dispatch("click");
  await settle(30);
};

// ⓐⓒ 구운 자리·구운 기준일·H2 구획의 hidden 이 실패 뒤에도 그대로다. 변이 시험이 같은 함수를 쓴다.
function assertNewsBakedKept(page, label) {
  for (const id of NEWS_SPOTS) assert.equal(page.byId(id).innerHTML, page.baked[id], `${label}: #${id} 의 구운 내용이 바뀌었다`);
  assert.equal(page.byId("realestate-stats-section").hidden, page.baked.statsHidden, `${label}: 시세 구획의 hidden 이 바뀌었다`);
  assert.equal(page.byId("updated").textContent, page.baked.updatedText, `${label}: 구운 기준일 글자가 바뀌었다`);
  assert.equal(page.byId("updated").getAttribute("data-updated"), page.baked.day, `${label}: data-updated 가 바뀌었다`);
}

test("(나) 범위: 뉴스 4장은 구운 기사 목록·요약·기준일(data-updated)을 갖고 load-state.js 를 <script src> 로 물지 않으며, 시세 카드가 열려 구워진 것은 realestate-news 하나다 (S6)", async () => {
  for (const name of NEWS_FILES) {
    const { html } = newsSources[name];
    assert.equal(html.includes("load-state.js"), false, `${name}: load-state.js 를 문다 - 외부 JS 를 더하는 일이라 cto 허용 표가 먼저다`);
    const page = await loadNewsPage({ file: `${SITE}/${name}.html`, baked: true });
    assert.ok(page.baked["news-list"].includes("news-item"), `${name}: 구운 기사 목록이 비었다`);
    assert.ok(page.baked["summary-box"].includes("<p>"), `${name}: 구운 요약이 비었다`);
    assert.match(page.baked.day, /^\d{4}-\d{2}-\d{2}$/, `${name}: 구운 기준일 줄에 data-updated 가 없다`);
    assert.equal(page.baked.statsHidden, name !== "realestate-news", `${name}: 시세 구획의 구운 hidden`);
    if (name === "realestate-news") assert.ok(page.baked["realestate-stats"].includes("stat-card"), "구운 시세 카드가 비었다");
  }
  assert.equal(newsSources.news.category, null, "news.html 은 분류가 없는 전체 장이다");
});

test("ⓐⓒ (나) 요청이 전부 실패(네트워크·404·503)해도 구운 기사 목록·요약·시세 카드와 구운 기준일 글자·data-updated 가 한 글자도 안 바뀐다 - 4장 × 한국어·영어", async () => {
  for (const name of NEWS_FILES) {
    for (const lang of ["ko", "en"]) {
      for (const mode of ["network", "404", "503"]) {
        const { page } = await openNews(name, { lang, mode });
        assertNewsBakedKept(page, `${name} ${lang} ${mode}`);
      }
    }
  }
});

test("ⓑⓔⓗ (나) 실패하면 알림이 보이고 이름 + 구운 기준일 문장 + 다시 시도를 말한다 - 영어는 한국어 고지 정확히 1, 한국어는 0, 실패 이유·오늘·최신은 없다", async () => {
  for (const name of NEWS_FILES) {
    for (const [lang, names, kept, retry] of [
      ["ko", "기사를 불러오지 못했습니다. AI 요약을 불러오지 못했습니다.", (day) => `아래는 기준일(${day})에 만든 값입니다.`, "다시 시도"],
      ["en", "Could not load the articles. Could not load the AI summary.", (day) => `Shown below is what this page was built with on ${day}. ${KO_ONLY}`, "Retry"],
    ]) {
      for (const mode of ["network", "404", "503"]) {
        const { page } = await openNews(name, { lang, mode });
        const notice = page.notice();
        const label = `${name} ${lang} ${mode}`;
        assert.ok(notice, `${label}: 알림이 안 보인다`);
        assert.equal(notice.text, `${names} ${kept(page.baked.day)}`, `${label}: 알림 문장`);
        assert.equal(notice.retry, retry, `${label}: 다시 시도 단추 글자`);
        assert.ok((notice.button.listeners.click ?? []).length > 0, `${label}: 다시 시도 단추에 누름 처리가 없다`);
        assert.equal(countOf(notice.text, KO_ONLY), lang === "en" ? 1 : 0, `${label}: 한국어 고지 수`);
        assert.equal(HTTP_WORDS.test(notice.html), false, `${label}: 실패 이유가 방문자에게 보인다: ${notice.text}`);
        assert.equal(BAD_WORDS.test(notice.text), false, `${label}: 알림이 지금 값처럼 말한다: ${notice.text}`);
      }
    }
  }
});

test("ⓑ (나) F6: 요약을 못 받았으면 '요약이 아직 없다'가 아니라 'AI 요약을 불러오지 못했습니다'로 말하고 구운 요약을 남긴다", async () => {
  for (const [lang, failed, empty] of [
    ["ko", "AI 요약을 불러오지 못했습니다.", "오늘 요약이 아직 없습니다."],
    ["en", "Could not load the AI summary.", "No summary yet today."],
  ]) {
    for (const mode of ["network", "404"]) {
      const { page } = await openNews("realestate-news", { lang, mode, only: "summary" });
      assert.ok(page.notice().text.includes(failed), `${lang} ${mode}: ${page.notice().text}`);
      assert.equal(page.byId("summary-box").innerHTML, page.baked["summary-box"], `${lang} ${mode}: 구운 요약이 바뀌었다`);
      assert.equal(page.byId("summary-box").innerHTML.includes(empty), false, `${lang} ${mode}: 실패를 '아직 없음'으로 말한다`);
    }
  }
  // 메인의 같은 글자(summaryLoadError)는 요약 상자와 함께 뉴스 화면으로 옮기며 지웠다(#575 PR2) - 두 곳에서 다르게 부를 일이 없다.
  assert.ok(!indexSource.includes("summaryLoadError"), "메인에 요약 실패 문구가 다시 생겼다");
});

test("ⓐ (나) 한 가지만 실패하면 그 자리만 구운 채로 남고 나머지는 받은 값으로 바뀐다 - 알림은 실패한 것만 말한다", async () => {
  // 기사(news.json) 실패: 목록·시세 카드·기준일은 구운 채, 요약은 받은 값
  for (const lang of ["ko", "en"]) {
    const { page } = await openNews("realestate-news", { lang, mode: "503", only: "news" });
    for (const id of ["news-list", "realestate-stats"]) assert.equal(page.byId(id).innerHTML, page.baked[id], `기사 실패 ${lang}: #${id}`);
    assert.equal(page.byId("realestate-stats-section").hidden, false, `기사 실패 ${lang}: 시세 구획이 숨었다(H2)`);
    assert.equal(page.byId("updated").textContent, page.baked.updatedText, `기사 실패 ${lang}: 구운 기준일이 바뀌었다`);
    assert.notEqual(page.byId("summary-box").innerHTML, page.baked["summary-box"], `기사 실패 ${lang}: 받은 요약이 안 그려졌다`);
    const text = page.notice().text;
    assert.ok(text.startsWith(lang === "ko" ? "기사를 불러오지 못했습니다. 아래는" : "Could not load the articles. Shown below"), text);
    assert.equal(/AI 요약|AI summary/.test(text), false, `기사 실패 ${lang}: 받은 요약을 못 받았다고 말한다`);
  }
  // 요약(summary.json) 실패: 요약은 구운 채, 목록은 받은 값
  const { page } = await openNews("news", { mode: "503", only: "summary" });
  assert.equal(page.byId("summary-box").innerHTML, page.baked["summary-box"]);
  assert.notEqual(page.byId("news-list").innerHTML, page.baked["news-list"]);
  assert.ok(page.byId("news-list").innerHTML.includes("news-item"));
  assert.ok(page.notice().text.startsWith("AI 요약을 불러오지 못했습니다. 아래는"), page.notice().text);
  assert.equal(page.byId("updated").getAttribute("data-updated"), page.baked.day);
});

test("ⓑ (나) 실패한 뒤 언어를 바꾸면 알림 문구가 그 언어로 바뀌고 구운 자리는 그대로다", async () => {
  const { page } = await openNews("realestate-news", { lang: "ko" });
  assert.equal(countOf(page.notice().text, KO_ONLY), 0);
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  const en = page.notice();
  assert.ok(en.text.startsWith("Could not load the articles.") && countOf(en.text, KO_ONLY) === 1 && en.retry === "Retry", `영어 알림: ${en.text}`);
  assertNewsBakedKept(page, "언어 전환 뒤");
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  assert.equal(countOf(page.notice().text, KO_ONLY), 0);
});

test("ⓖ (나) 다시 시도가 성공하면 알림이 걷히고 구운 자리가 받은 값으로 바뀐다, 또 실패하면 구운 채로 알림이 남는다", async () => {
  for (const name of NEWS_FILES) {
    for (const lang of ["ko", "en"]) {
      const { page, server } = await openNews(name, { lang });
      const first = server.requests.length;
      await clickNewsRetry(page);
      assert.ok(server.requests.length > first, `${name} ${lang}: 다시 시도가 요청을 안 보냈다`);
      assert.ok(page.notice(), `${name} ${lang}: 다시 실패했는데 알림이 걷혔다`);
      assertNewsBakedKept(page, `${name} ${lang} 재시도 실패`);

      server.mode = "ok";
      await clickNewsRetry(page);
      assert.equal(page.notice(), null, `${name} ${lang}: 성공했는데 알림이 남았다`);
      assert.notEqual(page.byId("news-list").innerHTML, page.baked["news-list"], `${name} ${lang}: 목록이 받은 값으로 안 바뀌었다`);
      assert.notEqual(page.byId("summary-box").innerHTML, page.baked["summary-box"], `${name} ${lang}: 요약이 받은 값으로 안 바뀌었다`);
      assert.notEqual(page.byId("updated").textContent, page.baked.updatedText, `${name} ${lang}: 기준일 줄이 받은 갱신 시각으로 안 바뀌었다`);
    }
  }
});

test("(나) 규칙 5·H2: 받았는데 비어 있는 것은 실패가 아니다 - 구운 값을 남기지 않고 '아직 없음'으로 말하며 알림이 뜨지 않고, 받은 시세가 비면 구획을 닫는다", async () => {
  const news = await readJson("news");
  const { page } = await openNews("realestate-news", { mode: "ok", overrides: { news: { ...news, items: [], realestateStats: [] }, summary: { categories: [] } } });
  assert.notEqual(page.byId("news-list").innerHTML, page.baked["news-list"], "받은 빈 목록인데 구운 목록이 남았다");
  assert.ok(page.byId("news-list").innerHTML.includes("오늘 이 분야 기사가 아직 없습니다."), page.byId("news-list").innerHTML);
  assert.ok(page.byId("summary-box").innerHTML.includes("오늘 요약이 아직 없습니다."), page.byId("summary-box").innerHTML);
  assert.equal(page.byId("realestate-stats-section").hidden, true, "받은 시세가 비었는데 구획이 열려 있다");
  assert.equal(page.notice(), null, "받았는데 실패 알림이 떴다");
});

test("ⓕ (나) 구운 자리·구운 기준일을 건드리는 그림은 받은 값이 있을 때만 돈다 - 실패 표시는 알림 함수 한 곳이고 새 알림 요소·옛 실패 줄은 없다", () => {
  for (const name of NEWS_FILES) {
    const { script } = newsSources[name];
    const apply = script.slice(script.indexOf("function applyLocale("), script.indexOf("const cache = "));
    assert.ok(/if \(cache\.news\) \{\s+renderUpdated\(\);\s+renderRealestateStats\(\);\s+renderNews\(\);\s+\}/.test(apply), `${name}: 기사·시세·기준일 그림이 news 가드 안에 없다`);
    assert.ok(apply.includes("if (cache.summary) renderSummary();"), `${name}: 요약 그림이 summary 가드 안에 없다`);
    for (const call of ["renderUpdated();", "renderRealestateStats();", "renderNews();", "renderSummary();"]) {
      assert.equal(countOf(script, call), 1, `${name}: ${call} 를 가드 밖에서도 부른다`);
    }
    assert.equal(/textContent = [^;\n]*"-"|: "-"/.test(script), false, `${name}: 구운 기준일을 "-"로 바꾸는 갈래가 남았다`);
    assert.equal(/insertAdjacentHTML|notifyBeside|showFailure|loadError\)\(/.test(script), false, `${name}: 알림 요소를 직접 만들거나 옛 실패 줄이 남았다`);
    assert.equal(countOf(script, 'id="load-retry"'), 1, `${name}: 재시도 단추 마크업이 하나가 아니다`);
    const fn = script.slice(script.indexOf("function renderLoadNotice("), script.indexOf("function statCardsHtml"));
    assert.ok(fn.includes('document.getElementById("content").innerHTML'), `${name}: 알림 자리가 #content 가 아니다`);
    assert.ok(fn.includes('getAttribute("data-updated")'), `${name}: 구운 data-updated 를 읽지 않는다`);
    assert.equal(/new Date\(|Date\.now/.test(fn), false, `${name}: 알림이 새 날짜를 계산한다`);
  }
});

test("(나) 알림의 둘째 문장은 load-state.js 의 notifyBeside 와 같은 말이다 (한·영) - 문구가 두 곳에서 갈라지지 않게", () => {
  const { script } = newsSources.news;
  assert.ok(script.includes("Shown below is what this page was built with on ${day}. Some of it is in Korean only."), "news 의 영어 문장이 load-state.js 와 다르다");
  assert.ok(script.includes("아래는 기준일(${day})에 만든 값입니다."), "news 의 한국어 문장이 load-state.js 와 다르다");
  assert.ok(loadStateSource.includes("`Shown below is what this page was built with${day ? ` on ${day}` :"));
  assert.ok(loadStateSource.includes("`아래는 ${day ? `기준일(${day})` :") && loadStateSource.includes("에 만든 값입니다.`"));
});

test("변이 증빙 (나): 기사·시세·기준일 가드를 지운 사본, 요약 가드를 지운 사본, 알림을 안 세우는 사본은 위 점검이 실패시킨다", async () => {
  const noNewsGuard = await openNews("realestate-news", {
    mutate: (script) => mutation("if (cache.news) {", "if (true) {")(script.replaceAll("cache.news.", "cache.news?.")),
  });
  assert.throws(() => assertNewsBakedKept(noNewsGuard.page, "변이1"), /구운 내용이 바뀌었다|hidden 이 바뀌었다/, "기사 가드를 지워도 ⓐ 가 통과한다");

  const noSummaryGuard = await openNews("news", {
    mutate: (script) => mutation("if (cache.summary) renderSummary();", "renderSummary();")(script.replaceAll("cache.summary.categories", "cache.summary?.categories")),
  });
  assert.throws(() => assertNewsBakedKept(noSummaryGuard.page, "변이2"), /#summary-box 의 구운 내용이 바뀌었다/, "요약 가드를 지워도 ⓐ 가 통과한다");

  const noNotice = await openNews("news", { mutate: mutation("const failed = [", "const failed = false && [") });
  assert.equal(noNotice.page.notice(), null, "알림을 안 세우는 사본이 알림을 세웠다 - ⓑ 가 눈이 멀었다");
});

// ============================================================================================================
// 다섯째 행: 분석 6장 중 price-outlook (docs/price-outlook.html, 손으로 쓴 장), 틀 (가), H1 + F7·F8.
// 규칙 2~5 를 outlook.json·move-in.json 이 안 올 때 구운 머리 문단(#lead)과 구운 표·문단·기준일(#updated)을 지우지·숨기지 않고,
// #content 안 알림 한 줄이 [못 받은 것의 이름] + [아래는 기준일(구운 data-updated)에 만든 값입니다.] + (영어) [Some of it is in Korean only.] + [다시 시도] 를 말하는 것으로 지킨다.
//   - F7(네트워크 실패)·F8(404·빈 파일): 예전에는 #lead 를 실패 문구/"준비 중"으로 갈아 끼우고 #updated 를 "-"로 바꿨다(404 갈래). 지금은 둘 다 구운 채로 남고 알림이 선다.
//     404·빈 응답도 "새로 받지 못했다"다(규칙 5) - 구운 머리 문단이 있는 장이라 "아직 없습니다"로 말하지 않는다.
//   - H1: move-in.json 이 안 오면(실패·404 모두 null) 구운 #move-in-section(입주 예정 문단·표·자치구별 줄)을 방문 내내 숨겼다. 지금은 열어 둔다.
//     숨김만 풀면 영어 화면에 말없이 한국어가 들어서므로(po) 영어 알림 끝에 고지를 붙인다. 받았는데 lead 가 없는 응답은 예전처럼 구획을 닫는다.
// 이 장은 load-state.js 를 <script src> 로 물지 않는다(S6) - 문장 글자만 같게 두고 아래에서 맞대 본다. 알림은 #content 에 쓰므로 새 id·class 가 없다.
// 보기를 바꾸는 입력이 없어 규칙 3번이 걸리지 않는다(po 실측). outlook-indicators.json 의 무음 갈래는 건드리지 않는다(알려진 잔여).
// ============================================================================================================
const OUTLOOK_BAKED = ["lead", "long-lead", "nowcast-lead", "record-lead", "region-table", "nowcast-table", "score-table", "move-in-lead", "move-in-table", "move-in-districts"];
const outlookSource = await readFile(path.join(root, `${SITE}/price-outlook.html`), "utf8");
const outlookScript = scriptOf(outlookSource);

// 데이터 요청을 막는 서버. only 가 있으면 그 파일만 실패한다(여러 파일이면 배열). overrides 는 성공 응답을 바꿔 끼운다.
function analysisServer(mode, only = null, overrides = {}) {
  const state = { mode, requests: [] };
  state.fetch = async (url) => {
    const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
    state.requests.push(name);
    const down = state.mode !== "ok" && (!only || [].concat(only).includes(name));
    if (down && state.mode === "network") throw new TypeError("Failed to fetch");
    if (down) return { ok: false, status: state.mode === "404" ? 404 : 503, json: async () => ({}) };
    if (name in overrides) return { ok: true, status: 200, json: async () => overrides[name] };
    return { ok: true, status: 200, json: () => readJson(name) };
  };
  return state;
}
const openOutlook = async ({ lang = "ko", mode = "network", only = null, overrides = {}, mutate } = {}) => {
  const server = analysisServer(mode, only, overrides);
  const page = await loadAnalysisPage({ file: `${SITE}/price-outlook.html`, locale: lang, fetch: server.fetch, bake: OUTLOOK_BAKED, hiddenIds: ["move-in-section"], mutate });
  await settle(30);
  return { page, server };
};
const clickAnalysisRetry = async (page) => {
  page.byId("load-retry").dispatch("click");
  await settle(30);
};

// ⓐⓒ 구운 자리·구운 기준일·H1 구획의 hidden 이 실패 뒤에도 그대로다. 변이 시험이 같은 함수를 쓴다.
function assertAnalysisBakedKept(page, ids, hiddenIds, label, { stamp = true } = {}) {
  for (const id of ids) assert.equal(page.byId(id).innerHTML, page.baked[id], `${label}: #${id} 의 구운 내용이 바뀌었다`);
  for (const id of hiddenIds) assert.equal(page.byId(id).hidden, page.baked.hidden[id], `${label}: #${id} 의 hidden 이 바뀌었다`);
  if (stamp) assert.equal(page.byId("updated").textContent, page.baked.updatedText, `${label}: 구운 기준일 글자가 바뀌었다`);
  assert.equal(page.byId("updated").getAttribute("data-updated"), page.baked.day, `${label}: data-updated 가 바뀌었다`);
}
const assertOutlookKept = (page, label, ids = OUTLOOK_BAKED, opts) => assertAnalysisBakedKept(page, ids, ["move-in-section"], label, opts);

const OUTLOOK_NAMES = {
  ko: { moveIn: "입주 예정 자료를 불러오지 못했습니다.", indicator: "지표 자료를 불러오지 못했습니다." },
  en: { moveIn: "Could not load the move-in data.", indicator: "Could not load the indicator data." },
};
const ANALYSIS_ASOF = { ko: (day) => `아래는 기준일(${day})에 만든 값입니다.`, en: (day) => `Shown below is what this page was built with on ${day}. ${KO_ONLY}` };

test("(가) 범위: price-outlook 은 구운 머리 문단·표·입주 예정 구획(hidden 아님)·기준일(data-updated)을 갖고 load-state.js 를 <script src> 로 물지 않는다 (S6)", async () => {
  assert.equal(outlookSource.includes("load-state.js"), false, "load-state.js 를 문다 - 외부 JS 를 더하는 일이라 cto 허용 표가 먼저다");
  const { page } = await openOutlook({ mode: "ok" });
  for (const id of ["lead", "region-table", "move-in-lead", "move-in-table", "move-in-districts"]) assert.ok(page.baked[id].length > 20, `구운 #${id} 가 비었다`);
  assert.equal(page.baked.hidden["move-in-section"], false, "구운 입주 예정 구획이 처음부터 숨어 있다");
  assert.match(page.baked.day, /^\d{4}-\d{2}-\d{2}$/, "구운 기준일 줄에 data-updated 가 없다");
});

test("ⓐⓒ F7·F8 요청이 전부 실패(네트워크·404·503)해도 구운 머리 문단·표·입주 예정 구획과 구운 기준일 글자·data-updated 가 한 글자도 안 바뀐다 - 한국어·영어", async () => {
  for (const lang of ["ko", "en"]) {
    for (const mode of ["network", "404", "503"]) {
      const { page } = await openOutlook({ lang, mode });
      assertOutlookKept(page, `${lang} ${mode}`);
    }
  }
});

test("ⓑⓔⓗ F7·F8 실패하면 알림이 보이고 [이름] + [구운 기준일 문장] + 다시 시도를 말한다 - 영어는 한국어 고지 정확히 1, 한국어는 0, 실패 이유·오늘·최신은 없다", async () => {
  for (const [lang, name, retry] of [
    ["ko", "전망 자료를 불러오지 못했습니다.", "다시 시도"],
    ["en", "Could not load the outlook data.", "Retry"],
  ]) {
    for (const mode of ["network", "404", "503"]) {
      const { page } = await openOutlook({ lang, mode });
      const notice = page.notice();
      const label = `${lang} ${mode}`;
      assert.ok(notice, `${label}: 알림이 안 보인다`);
      // 404 는 세 파일이 다 "안 왔다"고 끝난다 - 알림이 셋 다 말한다(전망·입주 예정·지표, #537). 네트워크·503 은 한 번에 거부돼 전망 자료 하나만 말한다(나머지는 알 수 없다).
      const names = mode === "404" ? `${name} ${OUTLOOK_NAMES[lang].moveIn} ${OUTLOOK_NAMES[lang].indicator}` : name;
      assert.equal(notice.text, `${names} ${ANALYSIS_ASOF[lang](page.baked.day)}`, `${label}: 알림 문장`);
      assert.equal(notice.retry, retry, `${label}: 다시 시도 단추 글자`);
      assert.ok((notice.button.listeners.click ?? []).length > 0, `${label}: 다시 시도 단추에 누름 처리가 없다`);
      assert.equal(countOf(notice.text, KO_ONLY), lang === "en" ? 1 : 0, `${label}: 한국어 고지 수`);
      assert.equal(HTTP_WORDS.test(notice.html), false, `${label}: 실패 이유가 방문자에게 보인다: ${notice.text}`);
      assert.equal(BAD_WORDS.test(notice.text), false, `${label}: 알림이 지금 값처럼 말한다: ${notice.text}`);
    }
  }
});

test("규칙 5 F8: 404 와 빈 응답은 '준비 중'이 아니라 새로 받지 못했다고 알리고 구운 머리 문단을 남긴다", async () => {
  for (const [label, server] of [["404", { mode: "404" }], ["빈 regions", { mode: "ok", overrides: { outlook: { regions: [] } } }], ["빈 파일 {}", { mode: "ok", overrides: { outlook: {} } }]]) {
    const { page } = await openOutlook(server);
    assert.equal(page.byId("lead").innerHTML, page.baked.lead, `${label}: 구운 머리 문단이 바뀌었다`);
    assert.equal(page.byId("updated").textContent, page.baked.updatedText, `${label}: 구운 기준일이 바뀌었다`);
    assert.ok(page.notice()?.text.startsWith("전망 자료를 불러오지 못했습니다."), `${label}: ${page.notice()?.text}`);
    assert.equal(/아직|준비 중/.test(page.byId("lead").innerHTML + page.notice().text), false, `${label}: 못 받은 것을 '아직 없음'으로 말한다`);
  }
});

test("ⓐⓑⓗ H1 move-in.json 만 못 받으면(네트워크·404·503) 구운 입주 예정 구획이 열린 채 구운 글자로 남고 알림이 그 이름을 말한다 - 나머지는 받은 값이다", async () => {
  const data = await readJson("outlook");
  for (const lang of ["ko", "en"]) {
    for (const mode of ["network", "404", "503"]) {
      const { page } = await openOutlook({ lang, mode, only: "move-in" });
      const label = `${lang} ${mode}`;
      assertOutlookKept(page, label, ["move-in-lead", "move-in-table", "move-in-districts"], { stamp: false });
      assert.equal(page.byId("move-in-section").hidden, false, `${label}: 입주 예정 구획이 숨었다(H1)`);
      assert.equal(page.byId("lead").textContent, data.lead[lang], `${label}: 받은 머리 문단이 안 그려졌다`);
      const notice = page.notice();
      assert.ok(notice, `${label}: 알림이 안 보인다`);
      assert.equal(notice.text, `${OUTLOOK_NAMES[lang].moveIn} ${ANALYSIS_ASOF[lang](page.baked.day)}`, `${label}: 알림 문장`);
      assert.equal(countOf(notice.text, KO_ONLY), lang === "en" ? 1 : 0, `${label}: 한국어 고지 수`);
      assert.equal(/전망 자료|outlook data|지표 자료|indicator data/.test(notice.text), false, `${label}: 받은 자료를 못 받았다고 말한다`);
    }
  }
});

// #537: outlook-indicators.json 만 못 받으면(네트워크·404·503 모두 null) 같은 알림이 "지표 자료" 이름을 말한다. 접힌 표(#indicator-fold)·구운 지표 문단·표는 구운 채다.
test("ⓐⓑⓗ #537 outlook-indicators.json 만 못 받으면(네트워크·404·503) 알림이 지표 자료를 말하고 구운 지표 자리는 그대로다 - 영어 고지 1, 한국어 0, 나머지는 받은 값이다", async () => {
  const data = await readJson("outlook");
  const bakedIds = [...OUTLOOK_BAKED, "indicator-lead", "indicator-table"];
  for (const lang of ["ko", "en"]) {
    for (const mode of ["network", "404", "503"]) {
      const server = analysisServer(mode, "outlook-indicators");
      const page = await loadAnalysisPage({ file: `${SITE}/price-outlook.html`, locale: lang, fetch: server.fetch, bake: bakedIds, hiddenIds: ["move-in-section"] });
      await settle(30);
      const label = `${lang} ${mode}`;
      assertOutlookKept(page, label, ["indicator-lead", "indicator-table"], { stamp: false });
      assert.equal(page.byId("lead").textContent, data.lead[lang], `${label}: 받은 머리 문단이 안 그려졌다`);
      const notice = page.notice();
      assert.ok(notice, `${label}: 알림이 안 보인다`);
      assert.equal(notice.text, `${OUTLOOK_NAMES[lang].indicator} ${ANALYSIS_ASOF[lang](page.baked.day)}`, `${label}: 알림 문장`);
      assert.equal(notice.retry, lang === "ko" ? "다시 시도" : "Retry", `${label}: 다시 시도 단추 글자`);
      assert.equal(countOf(notice.text, KO_ONLY), lang === "en" ? 1 : 0, `${label}: 한국어 고지 수`);
      assert.equal(HTTP_WORDS.test(notice.html), false, `${label}: 실패 이유가 방문자에게 보인다`);
      assert.equal(/전망 자료|outlook data|입주 예정 자료|move-in data/.test(notice.text), false, `${label}: 받은 자료를 못 받았다고 말한다`);
      // 지표와 입주 예정이 같이 안 오면 한 알림이 둘 다 말한다 - 알림 요소는 하나다.
      assert.equal(countOf(notice.html, 'id="load-retry"'), 1, `${label}: 다시 시도 단추가 하나가 아니다`);
    }
  }
  const both = analysisServer("404", ["outlook-indicators", "move-in"]);
  const page = await loadAnalysisPage({ file: `${SITE}/price-outlook.html`, locale: "en", fetch: both.fetch, bake: OUTLOOK_BAKED, hiddenIds: ["move-in-section"] });
  await settle(30);
  assert.equal(page.notice().text, `${OUTLOOK_NAMES.en.moveIn} ${OUTLOOK_NAMES.en.indicator} ${ANALYSIS_ASOF.en(page.baked.day)}`, "두 파일이 안 오면 알림이 둘 다 말한다");
  assert.equal(countOf(page.notice().text, KO_ONLY), 1);
});

test("(가) H1 경계: 받았는데 lead 가 없는 입주 예정 응답은 구획을 닫고 알림이 없다 - 실패와 '아직 없음'이 갈린다. 받은 지표 응답은 lead 가 없어도 알림이 없다(#537)", async () => {
  const { page } = await openOutlook({ mode: "ok", overrides: { "move-in": { table: {} } } });
  assert.equal(page.byId("move-in-section").hidden, true, "받은 빈 입주 예정인데 구획이 열려 있다");
  assert.equal(page.notice(), null, "받았는데 실패 알림이 떴다");
  const empty = await openOutlook({ mode: "ok", overrides: { "outlook-indicators": { table: {} } } });
  assert.equal(empty.page.notice(), null, "받은 지표 응답인데 실패 알림이 떴다 - 실패(null)와 받은 빈 응답이 갈려야 한다");
});

test("ⓑ (가) 실패한 뒤 언어를 바꾸면 알림 문구가 그 언어로 바뀌고 구운 자리·기준일은 그대로다 - 구운 표를 비우지 않는다", async () => {
  const { page } = await openOutlook({ lang: "ko" });
  assert.equal(countOf(page.notice().text, KO_ONLY), 0);
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  const en = page.notice();
  assert.ok(en.text.startsWith("Could not load the outlook data.") && countOf(en.text, KO_ONLY) === 1 && en.retry === "Retry", `영어 알림: ${en.text}`);
  assertOutlookKept(page, "언어 전환 뒤");
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  assert.equal(countOf(page.notice().text, KO_ONLY), 0);
  assertOutlookKept(page, "언어 전환 되돌린 뒤");
});

test("(가) 받는 중에 언어를 바꿔도 실패 알림이 미리 서지 않는다", async () => {
  const gate = Promise.withResolvers();
  const server = analysisServer("ok");
  const page = await loadAnalysisPage({ file: `${SITE}/price-outlook.html`, fetch: async (url) => (await gate.promise, server.fetch(url)), bake: OUTLOOK_BAKED, hiddenIds: ["move-in-section"] });
  page.byId("lang-toggle").dispatch("click");
  await settle(5);
  assert.equal(page.notice(), null, "받는 중인데 실패 알림이 섰다");
  gate.resolve();
  await settle(30);
  assert.equal(page.notice(), null);
});

test("ⓖ (가) 다시 시도가 성공하면 알림이 걷히고 구운 자리가 받은 값으로 바뀐다, 또 실패하면 구운 채로 알림이 남는다 - H1 도 같다", async () => {
  const data = await readJson("outlook");
  const moveIn = await readJson("move-in");
  for (const lang of ["ko", "en"]) {
    const { page, server } = await openOutlook({ lang });
    const first = server.requests.length;
    await clickAnalysisRetry(page);
    assert.ok(server.requests.length > first, `${lang}: 다시 시도가 요청을 안 보냈다`);
    assert.ok(page.notice(), `${lang}: 다시 실패했는데 알림이 걷혔다`);
    assertOutlookKept(page, `${lang} 재시도 실패`);

    server.mode = "ok";
    await clickAnalysisRetry(page);
    assert.equal(page.notice(), null, `${lang}: 성공했는데 알림이 남았다`);
    assert.equal(page.byId("lead").textContent, data.lead[lang], `${lang}: 머리 문단이 받은 값으로 안 바뀌었다`);
    assert.equal(page.byId("move-in-lead").textContent, moveIn.lead[lang], `${lang}: 입주 예정 문단이 받은 값으로 안 바뀌었다`);
    assert.notEqual(page.byId("updated").textContent, page.baked.updatedText, `${lang}: 기준일 줄이 받은 갱신일로 안 바뀌었다`);
  }
  const { page, server } = await openOutlook({ lang: "en", mode: "503", only: "move-in" });
  assert.ok(page.notice());
  server.mode = "ok";
  await clickAnalysisRetry(page);
  assert.equal(page.notice(), null, "H1: 성공했는데 알림이 남았다");
  assert.equal(page.byId("move-in-lead").textContent, moveIn.lead.en);
});

test("ⓕ (가) 구운 자리·구운 기준일을 건드리는 그림은 받은 값이 있을 때만 돈다 - 실패 표시는 알림 함수 한 곳이고 옛 실패 줄·'준비 중'·기준일 '-' 갈래가 없다", () => {
  const script = outlookScript;
  const all = script.slice(script.indexOf("function renderAll("), script.indexOf("async function loadJson("));
  assert.ok(/renderLoadNotice\(\);\s+if \(!cache\.data\) return;/.test(all), "renderAll 이 받은 값이 없을 때 알림 뒤에서 끝나지 않는다 - 언어를 바꾸면 구운 표를 비운다");
  assert.ok(all.includes("hidden = !!mi && !mi.lead;"), "입주 예정 구획이 못 받은 때(null)도 숨는다(H1)");
  const main = script.slice(script.indexOf("async function main("), script.indexOf('document.getElementById("theme-toggle")'));
  assert.equal(/"-"|notReady|document\.getElementById\("lead"\)\.innerHTML/.test(main), false, "main 에 구운 기준일을 지우거나 머리 문단을 갈아 끼우는 옛 갈래가 남았다");
  assert.equal(script.includes("notReady"), false, "받은 것이 없을 때 '준비 중'으로 말하는 문자열이 남았다");
  assert.equal(countOf(script, 'id="load-retry"'), 1, "재시도 단추 마크업이 하나가 아니다");
  assert.equal(/insertAdjacentHTML|notifyBeside|showFailure/.test(script), false, "알림 요소를 직접 만드는 길이 있다");
  const fn = script.slice(script.indexOf("function renderLoadNotice("), script.indexOf("function applyLocale("));
  assert.ok(fn.includes('document.getElementById("content").innerHTML'), "알림 자리가 #content 가 아니다");
  assert.ok(fn.includes('getAttribute("data-updated")'), "구운 data-updated 를 읽지 않는다");
  assert.equal(/new Date\(|Date\.now/.test(fn), false, "알림이 새 날짜를 계산한다");
});

test("(가) 알림의 둘째 문장은 load-state.js 의 notifyBeside 와 같은 말이다 (한·영) - 문구가 두 곳에서 갈라지지 않게", () => {
  assert.ok(outlookScript.includes("Shown below is what this page was built with on ${day}. Some of it is in Korean only."), "영어 문장이 load-state.js 와 다르다");
  assert.ok(outlookScript.includes("아래는 기준일(${day})에 만든 값입니다."), "한국어 문장이 load-state.js 와 다르다");
  assert.ok(loadStateSource.includes("`Shown below is what this page was built with${day ? ` on ${day}` :"));
  assert.ok(loadStateSource.includes("`아래는 ${day ? `기준일(${day})` :") && loadStateSource.includes("에 만든 값입니다.`"));
});

test("변이 증빙 (가): 입주 예정 숨김을 되돌린 사본, 받은 값 가드를 지운 사본, 알림을 안 세우는 사본은 위 점검이 실패시킨다", async () => {
  const hides = await openOutlook({ lang: "en", mode: "503", only: "move-in", mutate: mutation("hidden = !!mi && !mi.lead;", "hidden = !mi?.lead;") });
  assert.throws(() => assertOutlookKept(hides.page, "변이1", ["move-in-lead"], { stamp: false }), /hidden 이 바뀌었다/, "숨김을 되돌려도 ⓐ 가 통과한다");

  const noGuard = await openOutlook({ mutate: mutation("if (!cache.data) return;", "") });
  noGuard.page.byId("lang-toggle").dispatch("click");
  await settle(10);
  assert.throws(() => assertOutlookKept(noGuard.page, "변이2"), /기준일 글자가 바뀌었다|구운 내용이 바뀌었다/, "받은 값 가드를 지워도 언어 전환 뒤 ⓐⓒ 가 통과한다");

  const noNotice = await openOutlook({ mutate: mutation("cache.failed = !cache.data;", "cache.failed = false;") });
  assert.equal(noNotice.page.notice(), null, "알림을 안 세우는 사본이 알림을 세웠다 - ⓑ 가 눈이 멀었다");

  // #537: 지표 이름을 알림 배열에서 뺀 사본은 지표만 못 받은 때 알림이 안 서고, 사전 키를 지운 사본은 이름이 비어 위 문장 대조가 실패한다.
  const noIndicator = await openOutlook({ mode: "503", only: "outlook-indicators", mutate: mutation(' cache.indicators === null && "indicatorLoadError"', "") });
  assert.equal(noIndicator.page.notice(), null, "지표 이름을 뺀 사본이 알림을 세웠다 - #537 시험이 눈이 멀었다");
  const noKey = await openOutlook({ lang: "en", mode: "503", only: "outlook-indicators", mutate: mutation('    indicatorLoadError: "Could not load the indicator data.",\n', "") });
  assert.notEqual(noKey.page.notice()?.text, `${OUTLOOK_NAMES.en.indicator} ${ANALYSIS_ASOF.en(noKey.page.baked.day)}`, "영어 사전 키를 지운 사본이 같은 알림을 낸다 - #537 시험이 눈이 멀었다");
});

// ============================================================================================================
// 여섯째 행: 분석 나머지 5장(cancelled-deals·renewal-vs-new·floor-gap·record-high·switch-house, 손으로 쓴 장), 틀 (라), F7·F8.
// (가) price-outlook 과 같은 길이다: 데이터 파일 하나가 안 오면(네트워크·404·빈 파일) 구운 머리 문단(#lead)·구운 표·구운 기준일(#updated)을 지우지 않고,
// #content 안 알림 한 줄이 [못 받은 것의 이름] + [아래는 기준일(구운 data-updated)에 만든 값입니다.] + (영어) [Some of it is in Korean only.] + [다시 시도] 를 말한다.
// 예전에는 #lead 를 실패 문구(네트워크 실패)나 "준비 중"(404·빈 파일)으로 갈아 끼우고 404 갈래에서 #updated 를 "-"로 바꿨다. 404·빈 응답도 "새로 받지 못했다"다(규칙 5).
// switch-house 의 도구 영역(#from-select·#to-select·#compare-result)은 이 알림이 건드리지 않는다 - 실패 때 쓸 수 없음을 말하는 것은 #538 이고 아래 「switch-house 도구 영역」 시험이다.
// 이 5장은 load-state.js 를 <script src> 로 물지 않는다(S6). 보기를 바꾸는 입력이 없어 규칙 3번이 걸리지 않는다(분석 6장은 po 실측으로 해당 없음).
// ============================================================================================================
const leadOf = (data, lang) => data.lead[lang];
const ANALYSIS_PAGES = [
  { name: "cancelled-deals", json: "cancellation", error: ["해제·등기 자료를 불러오지 못했습니다.", "Could not load the cancellation data."], empty: { districts: [] }, lead: (d, l) => d.seoul[l === "en" ? "leadEn" : "leadKo"], bake: ["lead", "correction-lead", "district-table", "month-lead", "month-table", "district-links", "price-lead", "price-table"] },
  { name: "renewal-vs-new", json: "renewal-facts", error: ["재계약 자료를 불러오지 못했습니다.", "Could not load the renewal data."], empty: { table: [] }, lead: (d, l) => d.lead[l], bake: ["lead", "district-table", "wolse-lead", "wolse-table", "cap-lead", "district-links"] },
  { name: "floor-gap", json: "floor-gap", error: ["층 격차 자료를 불러오지 못했습니다.", "Could not load the floor data."], empty: { districts: [] }, lead: leadOf, bake: ["lead", "top-lead", "district-lead", "district-table", "district-links"] },
  { name: "record-high", json: "record-high", error: ["신고가 자료를 불러오지 못했습니다.", "Could not load the record-high data."], empty: {}, lead: leadOf, bake: ["lead", "control-lead", "survival-lead", "robust-table"] },
  { name: "switch-house", json: "district-change", error: ["갈아타기 자료를 불러오지 못했습니다.", "Could not load the data."], empty: { rows: [] }, lead: leadOf, bake: ["lead", "district-table", "region-table"] },
];
const analysisSources = {};
for (const spec of ANALYSIS_PAGES) {
  const html = await readFile(path.join(root, `${SITE}/${spec.name}.html`), "utf8");
  analysisSources[spec.name] = { html, script: scriptOf(html) };
}
const openAnalysis = async (spec, { lang = "ko", mode = "network", overrides = {}, mutate } = {}) => {
  const server = analysisServer(mode, null, overrides);
  const page = await loadAnalysisPage({ file: `${SITE}/${spec.name}.html`, locale: lang, fetch: server.fetch, bake: spec.bake, mutate });
  await settle(30);
  return { page, server };
};
const assertAnalysisKept = (spec, page, label) => assertAnalysisBakedKept(page, spec.bake, [], label);

test("(라) 범위: 분석 5장은 구운 머리 문단·표·기준일(data-updated)을 갖고 load-state.js 를 <script src> 로 물지 않는다 (S6)", async () => {
  for (const spec of ANALYSIS_PAGES) {
    assert.equal(analysisSources[spec.name].html.includes("load-state.js"), false, `${spec.name}: load-state.js 를 문다 - 외부 JS 를 더하는 일이라 cto 허용 표가 먼저다`);
    const { page } = await openAnalysis(spec, { mode: "ok" });
    for (const id of spec.bake) assert.ok(page.baked[id].length > 10, `${spec.name}: 구운 #${id} 가 비었다`);
    assert.match(page.baked.day, /^\d{4}-\d{2}-\d{2}$/, `${spec.name}: 구운 기준일 줄에 data-updated 가 없다`);
  }
});

test("ⓐⓒ (라) F7·F8 요청이 실패(네트워크·404·503)해도 구운 머리 문단·표와 구운 기준일 글자·data-updated 가 한 글자도 안 바뀐다 - 5장 × 한국어·영어", async () => {
  for (const spec of ANALYSIS_PAGES) {
    for (const lang of ["ko", "en"]) {
      for (const mode of ["network", "404", "503"]) {
        const { page } = await openAnalysis(spec, { lang, mode });
        assertAnalysisKept(spec, page, `${spec.name} ${lang} ${mode}`);
      }
    }
  }
});

test("ⓑⓔⓗ (라) 실패하면 알림이 보이고 [이름] + [구운 기준일 문장] + 다시 시도를 말한다 - 영어는 한국어 고지 정확히 1, 한국어는 0, 실패 이유·오늘·최신은 없다", async () => {
  for (const spec of ANALYSIS_PAGES) {
    for (const [lang, name, retry] of [["ko", spec.error[0], "다시 시도"], ["en", spec.error[1], "Retry"]]) {
      for (const mode of ["network", "404", "503"]) {
        const { page } = await openAnalysis(spec, { lang, mode });
        const notice = page.notice();
        const label = `${spec.name} ${lang} ${mode}`;
        assert.ok(notice, `${label}: 알림이 안 보인다`);
        assert.equal(notice.text, `${name} ${ANALYSIS_ASOF[lang](page.baked.day)}`, `${label}: 알림 문장`);
        assert.equal(notice.retry, retry, `${label}: 다시 시도 단추 글자`);
        assert.ok((notice.button.listeners.click ?? []).length > 0, `${label}: 다시 시도 단추에 누름 처리가 없다`);
        assert.equal(countOf(notice.text, KO_ONLY), lang === "en" ? 1 : 0, `${label}: 한국어 고지 수`);
        assert.equal(HTTP_WORDS.test(notice.html), false, `${label}: 실패 이유가 방문자에게 보인다: ${notice.text}`);
        assert.equal(BAD_WORDS.test(notice.text), false, `${label}: 알림이 지금 값처럼 말한다: ${notice.text}`);
      }
    }
  }
});

test("규칙 5 F8 (라): 404 와 빈 응답은 '준비 중'이 아니라 새로 받지 못했다고 알리고 구운 머리 문단·기준일을 남긴다", async () => {
  for (const spec of ANALYSIS_PAGES) {
    for (const [label, opts] of [["404", { mode: "404" }], ["빈 응답", { mode: "ok", overrides: { [spec.json]: spec.empty } }]]) {
      const { page } = await openAnalysis(spec, opts);
      assertAnalysisKept(spec, page, `${spec.name} ${label}`);
      assert.ok(page.notice()?.text.startsWith(spec.error[0]), `${spec.name} ${label}: ${page.notice()?.text}`);
      assert.equal(/아직|준비 중/.test(page.byId("lead").innerHTML + page.notice().text), false, `${spec.name} ${label}: 못 받은 것을 '아직 없음'으로 말한다`);
    }
  }
});

test("ⓑ (라) 실패한 뒤 언어를 바꾸면 알림 문구가 그 언어로 바뀌고 구운 표·기준일은 그대로다 - 구운 표를 비우지 않는다", async () => {
  for (const spec of ANALYSIS_PAGES) {
    const { page } = await openAnalysis(spec, { lang: "ko" });
    page.byId("lang-toggle").dispatch("click");
    await settle(10);
    const en = page.notice();
    assert.ok(en.text.startsWith(spec.error[1]) && countOf(en.text, KO_ONLY) === 1 && en.retry === "Retry", `${spec.name} 영어 알림: ${en.text}`);
    assertAnalysisKept(spec, page, `${spec.name} 언어 전환 뒤`);
    page.byId("lang-toggle").dispatch("click");
    await settle(10);
    assert.equal(countOf(page.notice().text, KO_ONLY), 0, `${spec.name}: 한국어로 돌아왔는데 고지가 남았다`);
    assertAnalysisKept(spec, page, `${spec.name} 언어 되돌린 뒤`);
  }
});

test("(라) 받는 중에 언어를 바꿔도 실패 알림이 미리 서지 않는다", async () => {
  for (const spec of ANALYSIS_PAGES) {
    const gate = Promise.withResolvers();
    const server = analysisServer("ok");
    const page = await loadAnalysisPage({ file: `${SITE}/${spec.name}.html`, fetch: async (url) => (await gate.promise, server.fetch(url)), bake: spec.bake });
    page.byId("lang-toggle").dispatch("click");
    await settle(5);
    assert.equal(page.notice(), null, `${spec.name}: 받는 중인데 실패 알림이 섰다`);
    gate.resolve();
    await settle(30);
    assert.equal(page.notice(), null, `${spec.name}: 받은 뒤에 알림이 남았다`);
  }
});

test("ⓖ (라) 다시 시도가 성공하면 알림이 걷히고 구운 머리 문단이 받은 값으로 바뀐다, 또 실패하면 구운 채로 알림이 남는다", async () => {
  for (const spec of ANALYSIS_PAGES) {
    const data = await readJson(spec.json);
    for (const lang of ["ko", "en"]) {
      const { page, server } = await openAnalysis(spec, { lang });
      const first = server.requests.length;
      await clickAnalysisRetry(page);
      assert.ok(server.requests.length > first, `${spec.name} ${lang}: 다시 시도가 요청을 안 보냈다`);
      assert.ok(page.notice(), `${spec.name} ${lang}: 다시 실패했는데 알림이 걷혔다`);
      assertAnalysisKept(spec, page, `${spec.name} ${lang} 재시도 실패`);

      server.mode = "ok";
      await clickAnalysisRetry(page);
      assert.equal(page.notice(), null, `${spec.name} ${lang}: 성공했는데 알림이 남았다`);
      assert.equal(page.byId("lead").textContent, spec.lead(data, lang), `${spec.name} ${lang}: 머리 문단이 받은 값으로 안 바뀌었다`);
      assert.notEqual(page.byId("updated").textContent, page.baked.updatedText, `${spec.name} ${lang}: 기준일 줄이 받은 갱신일로 안 바뀌었다`);
    }
  }
});

test("ⓕ (라) 구운 자리·구운 기준일을 건드리는 그림은 받은 값이 있을 때만 돈다 - 실패 표시는 알림 함수 한 곳이고 옛 실패 줄·'준비 중'·기준일 '-' 갈래가 없다", () => {
  for (const spec of ANALYSIS_PAGES) {
    const { script } = analysisSources[spec.name];
    const all = script.slice(script.indexOf("function renderAll("), script.indexOf("async function loadJson("));
    assert.ok(/renderLoadNotice\(\);\s+if \(!cache\.data\) return;/.test(all), `${spec.name}: renderAll 이 받은 값이 없을 때 알림 뒤에서 끝나지 않는다 - 언어를 바꾸면 구운 표를 비운다`);
    const main = script.slice(script.indexOf("async function main("), script.indexOf('document.getElementById("theme-toggle")'));
    assert.equal(/"-"|notReady|document\.getElementById\("lead"\)\.innerHTML/.test(main), false, `${spec.name}: main 에 구운 기준일을 지우거나 머리 문단을 갈아 끼우는 옛 갈래가 남았다`);
    assert.ok(main.includes("cache.failed = !cache.data;"), `${spec.name}: 실패 여부를 받은 값 하나로 가르지 않는다`);
    assert.equal(script.includes("notReady"), false, `${spec.name}: 받은 것이 없을 때 '준비 중'으로 말하는 문자열이 남았다`);
    assert.equal(countOf(script, 'id="load-retry"'), 1, `${spec.name}: 재시도 단추 마크업이 하나가 아니다`);
    assert.equal(/insertAdjacentHTML|notifyBeside|showFailure/.test(script), false, `${spec.name}: 알림 요소를 직접 만드는 길이 있다`);
    const fn = script.slice(script.indexOf("function renderLoadNotice("), script.indexOf("function applyLocale("));
    assert.ok(fn.includes('document.getElementById("content").innerHTML'), `${spec.name}: 알림 자리가 #content 가 아니다`);
    assert.ok(fn.includes('getAttribute("data-updated")'), `${spec.name}: 구운 data-updated 를 읽지 않는다`);
    assert.equal(/new Date\(|Date\.now/.test(fn), false, `${spec.name}: 알림이 새 날짜를 계산한다`);
  }
});

test("(라) 알림의 둘째 문장은 load-state.js 의 notifyBeside 와 같은 말이다 (한·영) - 5장 모두 문구가 두 곳에서 갈라지지 않게", () => {
  for (const spec of ANALYSIS_PAGES) {
    const { script } = analysisSources[spec.name];
    assert.ok(script.includes("Shown below is what this page was built with on ${day}. Some of it is in Korean only."), `${spec.name}: 영어 문장이 load-state.js 와 다르다`);
    assert.ok(script.includes("아래는 기준일(${day})에 만든 값입니다."), `${spec.name}: 한국어 문장이 load-state.js 와 다르다`);
    assert.ok(script.includes(`loadError: "${spec.error[0]}"`) && script.includes(`loadError: "${spec.error[1]}"`), `${spec.name}: 실패 문구가 바뀌었다`);
  }
});

test("변이 증빙 (라): 받은 값 가드를 지운 사본, 알림을 안 세우는 사본, 기준일을 '-'로 되돌린 사본은 위 점검이 실패시킨다", async () => {
  const cancelled = ANALYSIS_PAGES[0];
  const noGuard = await openAnalysis(cancelled, { mutate: mutation("if (!cache.data) return;", "") });
  noGuard.page.byId("lang-toggle").dispatch("click");
  await settle(10);
  assert.throws(() => assertAnalysisKept(cancelled, noGuard.page, "변이1"), /구운 내용이 바뀌었다/, "받은 값 가드를 지워도 언어 전환 뒤 ⓐ 가 통과한다");

  for (const spec of ANALYSIS_PAGES) {
    const noNotice = await openAnalysis(spec, { mutate: mutation("cache.failed = !cache.data;", "cache.failed = false;") });
    assert.equal(noNotice.page.notice(), null, `${spec.name}: 알림을 안 세우는 사본이 알림을 세웠다 - ⓑ 가 눈이 멀었다`);
  }

  const dash = await openAnalysis(cancelled, { mode: "404", mutate: mutation("cache.failed = !cache.data;", 'cache.failed = !cache.data; if (cache.failed) document.getElementById("updated").textContent = "-";') });
  assert.throws(() => assertAnalysisKept(cancelled, dash.page, "변이3"), /구운 기준일 글자가 바뀌었다/, "기준일을 '-'로 되돌려도 ⓒ 가 통과한다");
});

// ------------------------------------------------------------------------------------------------------------
// switch-house 도구 영역 (#538, po 2026-10-24): 실패(cache.failed)하면 도구를 숨기지 않고 제자리에 둔 채 쓸 수 없음을 말한다.
//   - 두 select: 비활성 옵션 `—` 하나(value="") + disabled. #compare-result: 사전 키 하나(`down`). 숨기면 아래 표가 끌려 올라가 실패 경로 CLS 라 숨기지 않는다.
//   - 재시도가 성공하면 fillSelects 가 25개 구 옵션과 disabled=false 를 되돌리고 문장은 비교 결과로 바뀐다.
// 높이 변화 0·CLS 네 줄·axe 는 실제 Chrome 증빙(PR 본문)이다 - 이 시험은 손으로 만든 DOM 에서 상태를 본다.
// ------------------------------------------------------------------------------------------------------------
const SWITCH = ANALYSIS_PAGES.find((spec) => spec.name === "switch-house");
const DOWN = { ko: "자료를 받지 못해 지금은 견줄 수 없습니다.", en: "Can't compare: the data did not load." };
const DASH_OPTION = '<option value="" disabled>—</option>';
// 손으로 만든 DOM 의 빈 요소는 .value 가 함수다 - 진짜 select 처럼 빈 문자열로 시작하게 스크립트 앞에 붙인다(옵션 선택 규칙 자체는 실제 Chrome 증빙).
const SELECT_INIT = 'document.getElementById("from-select").value = ""; document.getElementById("to-select").value = "";\n';
const withSelects = (mutate) => (script) => SELECT_INIT + (mutate ? mutate(script) : script);
const openSwitch = ({ mutate, ...opts } = {}) => openAnalysis(SWITCH, { ...opts, mutate: withSelects(mutate) });
function assertCompareDown(page, lang, label) {
  for (const id of ["from-select", "to-select"]) {
    const el = page.byId(id);
    assert.equal(el.innerHTML, DASH_OPTION, `${label}: #${id} 옵션이 비활성 — 하나가 아니다`);
    assert.equal(el.disabled, true, `${label}: #${id} 가 잠기지 않았다`);
    assert.equal(el.value, "", `${label}: #${id} 값이 비어 있지 않다`);
  }
  assert.equal(page.byId("compare-result").textContent, DOWN[lang], `${label}: #compare-result 문장`);
  assert.equal(countOf(page.byId("compare-result").textContent, KO_ONLY), 0, `${label}: 도구 문장에 한국어 고지가 붙었다(알림에 알림당 1회가 이미 있다)`);
  assert.equal(page.byId("compare-answer").textContent, "", `${label}: 답 한 줄이 남았다`);
  assert.equal(page.byId("compare-section").hidden, false, `${label}: 도구 구획을 숨겼다`);
}

test("#538 실패(네트워크·404·503·빈 응답)하면 두 select 는 비활성 — 하나, #compare-result 는 쓸 수 없음 문장이고 도구 구획은 그대로다 - 한국어·영어", async () => {
  for (const lang of ["ko", "en"]) {
    for (const [label, opts] of [["network", { mode: "network" }], ["404", { mode: "404" }], ["503", { mode: "503" }], ["빈 응답", { mode: "ok", overrides: { "district-change": SWITCH.empty } }]]) {
      const { page } = await openSwitch({ lang, ...opts });
      assertCompareDown(page, lang, `${lang} ${label}`);
      assert.ok(page.notice(), `${lang} ${label}: 알림이 사라졌다`);
    }
  }
});

test("#538 받는 중에는 도구 자리를 건드리지 않고(실패 확정 전), 정상 경로는 25개 구 옵션과 비교 결과를 그린다", async () => {
  const gate = Promise.withResolvers();
  const server = analysisServer("ok");
  const pending = await loadAnalysisPage({ file: `${SITE}/switch-house.html`, fetch: async (url) => (await gate.promise, server.fetch(url)), bake: SWITCH.bake, mutate: withSelects() });
  assert.notEqual(pending.byId("from-select").disabled, true, "받는 중인데 select 를 잠갔다");
  assert.equal(pending.byId("compare-result").textContent, "", "받는 중인데 문장이 섰다");
  gate.resolve();
  await settle(30);
  for (const id of ["from-select", "to-select"]) {
    assert.equal(pending.byId(id).disabled, false, `정상 경로: #${id} 가 잠겼다`);
    assert.equal(countOf(pending.byId(id).innerHTML, "<option "), 25, `정상 경로: #${id} 옵션이 25개가 아니다`);
    assert.equal(pending.byId(id).innerHTML.includes("—"), false, `정상 경로: #${id} 에 — 옵션이 남았다`);
  }
  assert.notEqual(pending.byId("compare-result").textContent, DOWN.ko, "정상 경로에서 쓸 수 없음 문장이 남았다");
  assert.match(pending.byId("compare-result").textContent, /종로구/, "정상 경로에서 첫 두 구(종로구는 칸이 모자라 값 없음)의 문장이 안 그려졌다");
});

test("#538 실패한 뒤 언어를 바꾸면 문장이 그 언어로 바뀌고 select 는 잠긴 채다, 또 실패해도 그대로다", async () => {
  const { page, server } = await openSwitch({ lang: "ko" });
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  assertCompareDown(page, "en", "영어로 전환");
  page.byId("lang-toggle").dispatch("click");
  await settle(10);
  assertCompareDown(page, "ko", "한국어로 되돌림");
  await clickAnalysisRetry(page);
  assert.ok(server.requests.length > 1, "다시 시도가 요청을 안 보냈다");
  assertCompareDown(page, "ko", "재시도 실패");
});

test("#538 다시 시도가 성공하면 select 가 풀리고 25개 구 옵션과 비교 결과가 돌아온다 - 한국어·영어", async () => {
  for (const lang of ["ko", "en"]) {
    const { page, server } = await openSwitch({ lang });
    assertCompareDown(page, lang, `${lang} 시작`);
    server.mode = "ok";
    await clickAnalysisRetry(page);
    for (const id of ["from-select", "to-select"]) {
      assert.equal(page.byId(id).disabled, false, `${lang}: 성공했는데 #${id} 가 잠겨 있다`);
      assert.equal(countOf(page.byId(id).innerHTML, "<option "), 25, `${lang}: #${id} 옵션이 25개로 돌아오지 않았다`);
      assert.equal(page.byId(id).innerHTML.includes("—"), false, `${lang}: #${id} 에 — 옵션이 남았다`);
    }
    assert.notEqual(page.byId("compare-result").textContent, DOWN[lang], `${lang}: 성공했는데 쓸 수 없음 문장이 남았다`);
    assert.ok(page.byId("compare-result").textContent.length > 20, `${lang}: 비교 문장이 안 그려졌다`);
    assert.equal(page.notice(), null, `${lang}: 알림이 남았다`);
  }
});

test("#538 변이 대조군: 실패 분기를 지운 사본, 옵션을 비우는 옛 모양, disabled 를 안 푸는 사본은 위 점검이 실패시킨다", async () => {
  const noBranch = await openSwitch({ mutate: mutation('fillSelects();\n    setText("compare-result", t("down"));', "") });
  assert.throws(() => assertCompareDown(noBranch.page, "ko", "변이1"), /옵션이 비활성 — 하나가 아니다/, "실패 분기를 지워도 점검이 통과한다");
  const empty = await openSwitch({ mutate: mutation(` || '${DASH_OPTION}'`, "") });
  assert.throws(() => assertCompareDown(empty.page, "ko", "변이2"), /옵션이 비활성 — 하나가 아니다/, "옵션을 비워도 점검이 통과한다");
  const stuck = await openSwitch({ mutate: mutation("from.disabled = to.disabled = !rows[0];", "") });
  assert.throws(() => assertCompareDown(stuck.page, "ko", "변이3"), /잠기지 않았다/, "잠그지 않아도 점검이 통과한다");
  const locked = await openSwitch({ mutate: mutation("from.disabled = to.disabled = !rows[0];", "from.disabled = to.disabled = true;") });
  locked.server.mode = "ok";
  await clickAnalysisRetry(locked.page);
  assert.equal(locked.page.byId("from-select").disabled, true, "변이4: 성공해도 잠긴 사본이 잠기지 않은 것으로 읽힌다 - 복원 점검이 눈이 멀었다");
});

// ============================================================================================================
// S6 인라인 스크립트 바이트 한도 (#543) - 틀 행마다 따로 쌓이던 S6 시험(+150→+750, +580→+1180 …)을 롤링 기준선 하나로 모았다.
// 정책: 장 하나의 인라인 script 는 기준선(test/s6-baseline.json = 병합 시점 build/site 의 장별 바이트)보다 한 번의 변경에 +400 B 넘게 늘지 않는다.
//       docs/load-state.js 는 4,574 B 를 넘지 않는다(이 값은 기준선이 아니라 고정이다 - 늘리려면 PR 전에 cto 에게 묻는다).
// 기준선 갱신: 병합 담당이 병합 뒤 `npm run count:bump` 를 돌리면 루트 시험이 초록일 때 이어서 `S6_BASELINE_UPDATE=1 node --test --test-name-pattern="S6 롤링" test/load-failure.test.mjs`
//       가 돌아 파일을 지금 바이트로 다시 쓰고 diff 를 찍는다(#561) - 그 diff 를 커밋한다. PR 은 기준선 파일을 건드리지 않는다 - 의도해서 +400 B 를 넘기는 PR 은 골든 S6 예외
//       절차(cto 판정, 이유 문구)를 거치고, 그때만 기준선 파일을 본문에 사유와 함께 고친다(허용 목록 밖 파일이라 전체 판정이다).
// 측정 대상: 시세 틀(scripts/realestate-template.html, 주석을 걷은 것)과 build/site 의 모든 장(#561)의 마지막 인라인 <script>. 시세 틀 47장의 접는 줄(#338, 옛 장당 +360 B·합 16,920 B)도 이 기준선이 지킨다(#560).
// ============================================================================================================
test("S6 롤링 기준선: 장별 인라인 스크립트 순증가 +400B 이하(test/s6-baseline.json 기준), docs/load-state.js 4,574B 이하", async () => {
  const S6_BASELINE_PATH = path.join(import.meta.dirname, "s6-baseline.json");
  // 측정 대상은 build/site 의 모든 장(.html)과 시세 틀이다 - 장이 늘면 기준선 파일의 장 목록도 같이 늘어야 해서 아래 키 비교가 먼저 말해 준다(#561).
  const siteFiles = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html")).sort();
  const measured = { "realestate-template": templateScript };
  for (const f of siteFiles) measured[f.replace(/\.html$/, "")] = scriptOf(await readFile(path.join(root, SITE, f), "utf8")) ?? "";
  const bytes = Object.fromEntries(Object.entries(measured).map(([name, script]) => [name, Buffer.byteLength(script)]));
  assert.ok(Buffer.byteLength(loadStateSource) <= 4_574, "docs/load-state.js 가 늘었다 - cto 기본값은 순증가 0B, 필요하면 PR 전에 묻는다");
  // 시세 틀의 알림 상태 코드는 47장 모두에 같은 글자로 실려 있어야 한다(장마다 달라지는 몫 - 예산대 구간 값 따위 - 은 한도와 무관하다).
  const state = templateScript.slice(templateScript.indexOf("let note = 0;"), templateScript.indexOf("async function main()"));
  for (const p of PAGES) assert.ok(p.script.includes(state), `${SITE}/${p.file}: 알림 상태 코드가 틀과 다르다`);
  if (process.env.S6_BASELINE_UPDATE === "1") {
    await writeFile(S6_BASELINE_PATH, `${JSON.stringify(bytes, null, 2)}\n`);
    return;
  }
  const baseline = JSON.parse(await readFile(S6_BASELINE_PATH, "utf8"));
  assert.deepEqual(Object.keys(baseline).sort(), Object.keys(bytes).sort(), "기준선 파일의 장 목록이 측정 대상과 다르다 - S6_BASELINE_UPDATE=1 로 다시 쓴다");
  for (const [name, now] of Object.entries(bytes)) {
    const added = now - baseline[name];
    assert.ok(added <= 400, `${name}: 인라인 증가가 기준선 ${baseline[name]}B 보다 ${added}B - cto 기본 한도 +400B/장, 넘으면 PR 전에 묻는다`);
  }
});
