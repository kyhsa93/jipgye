// 로드 실패 사이트 공통 규칙(docs/load-state.js)의 시험 (#173·#174).
//
// 규칙: 데이터를 못 받으면 "불러오는 중..."/"찾는 중..."을 남기지 않고, 실패 문구와 재시도 단추를
// 보인다. jsdom 없이 저장소가 이미 쓰는 방식(vm 샌드박스 + 손으로 만든 DOM, test/helpers/)으로 돌린다 -
// fetch를 거부하도록 주입하고, 화면 조각의 innerHTML과 단추의 click 리스너를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadRatesPage } from "./helpers/rates-page.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { stripInlineScriptComments } from "../scripts/strip-inline-comments.ts";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const RATE_PAGES = ["deposit-rates", "saving-rates", "mortgage-rates", "rent-loan-rates"];
const settle = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};

test("공용 규칙 파일을 쓰는 페이지는 인라인 스크립트보다 먼저 물고 있다", async () => {
  for (const name of [...RATE_PAGES, "deal-search"]) {
    const html = await readFile(path.join(root, `docs/${name}.html`), "utf8");
    const tag = html.indexOf('<script src="./load-state.js"></script>');
    assert.ok(tag > 0, `${name}.html이 load-state.js를 물고 있지 않다`);
    assert.ok(tag < html.lastIndexOf("<script>\n"), `${name}.html: load-state.js가 인라인 스크립트보다 뒤에 있다`);
  }
});

test("금리 5장: rates.json 로드가 거부되면 추이 구역과 표가 모두 실패 문구 + 재시도 단추를 보인다", async () => {
  for (const name of RATE_PAGES) {
    for (const [locale, error, retry] of [
      ["ko", "금리 추이를 불러오지 못했습니다.", "다시 시도"],
      ["en", "Could not load the rate trend.", "Retry"],
    ]) {
      const page = await loadRatesPage({
        file: `docs/${name}.html`,
        locale,
        fetch: async () => {
          throw new TypeError("network down");
        },
      });
      const label = `${name} ${locale}`;
      const history = page.byId.get("history-grid").innerHTML;
      assert.ok(!/불러오는 중|Loading/.test(history), `${label}: 추이 구역에 로드 중 문구가 남았다`);
      assert.ok(history.includes(error), `${label}: 추이 구역에 실패 문구가 없다`);
      assert.match(history, new RegExp(`<button type="button" id="load-retry-history">${retry}</button>`), `${label}: 추이 구역에 재시도 단추가 없다`);
      assert.match(history, /id="history-placeholder"/, `${label}: 자리 표시자 id를 잃었다`);
      assert.match(page.byId.get("products-body").innerHTML, new RegExp(`id="load-retry">${retry}</button>`), `${label}: 표의 재시도 단추가 사라졌다`);
      assert.ok((page.byId.get("load-retry-history").listeners.click ?? []).length > 0, `${label}: 추이 단추에 누름 처리가 없다`);
    }
  }
});

test("금리 5장: 추이 구역의 재시도 단추를 누르면 다시 받아 추이를 그린다", async () => {
  const rates = await readJson("rates");
  const history = await readJson("rates-history");
  let down = true;
  const events = [];
  const page = await loadRatesPage({
    file: "docs/deposit-rates.html",
    analytics: { event: (...args) => events.push(args), pageView() {} },
    fetch: async (url) => {
      if (down) throw new TypeError("network down");
      return { ok: true, json: async () => (String(url).includes("rates-history") ? history : rates) };
    },
  });
  assert.ok(page.byId.get("history-grid").innerHTML.includes("load-retry-history"));

  down = false;
  page.byId.get("load-retry-history").dispatch("click");
  await settle();

  const grid = page.byId.get("history-grid").innerHTML;
  assert.ok(!grid.includes("load-retry-history"), "재시도가 성공했는데 실패 문구가 남았다");
  assert.ok(!grid.includes("불러오는 중"), "재시도 뒤에 로드 중 문구가 남았다");
  assert.ok(events.some(([name]) => name === "load_retry"), "재시도를 세지 않았다");
});

test("금리 5장: 표와 추이 구역의 재시도 단추를 연달아 눌러도 다시 받기는 한 번뿐이다 (#187)", async () => {
  // 한 번의 실패에 단추가 둘이다. 하나를 누르면 다른 하나도 잠겨야 main()이 한 번만 돈다.
  // 진짜 브라우저는 잠긴(disabled) 단추의 클릭을 흘려보내지 않는다 - 시험도 그대로 흉내 낸다.
  const rates = await readJson("rates");
  const history = await readJson("rates-history");
  for (const name of RATE_PAGES) {
    let down = true;
    let ratesFetches = 0;
    const page = await loadRatesPage({
      file: `docs/${name}.html`,
      fetch: async (url) => {
        const isRates = !String(url).includes("rates-history");
        if (isRates) ratesFetches += 1;
        if (down) throw new TypeError("network down");
        return { ok: true, json: async () => (isRates ? rates : history) };
      },
    });
    assert.equal(ratesFetches, 1, `${name}: 첫 로드의 rates.json 요청이 한 번이 아니다`);
    const table = page.byId.get("load-retry");
    const trend = page.byId.get("load-retry-history");

    down = false;
    const press = (button) => {
      if (button.disabled !== true) button.dispatch("click");
    };
    press(trend);
    press(table);
    press(trend);
    await settle();

    assert.equal(table.disabled, true, `${name}: 표의 단추가 잠기지 않았다`);
    assert.equal(ratesFetches, 2, `${name}: 두 단추를 연달아 누르자 main()이 ${ratesFetches - 1}번 돌았다`);
  }
});

test("금리 5장: rates.json만 받고 rates-history가 거부되면 전과 같이 추이 없음 문구로 떨어진다", async () => {
  const rates = await readJson("rates");
  const page = await loadRatesPage({
    fetch: async (url) => {
      if (String(url).includes("rates-history")) throw new TypeError("network down");
      return { ok: true, json: async () => rates };
    },
  });
  const grid = page.byId.get("history-grid").innerHTML;
  assert.ok(!grid.includes("불러오는 중"));
  assert.ok(grid.includes("추이는 데이터가 하루 이상 쌓이면 표시됩니다."));
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
  const html = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
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
  const html = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
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
  const html = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
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
  const files = (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html")).sort();
  const pages = [];
  for (const file of files) {
    const html = await readFile(path.join(root, "docs", file), "utf8");
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
    async open(page, { locale = "ko", search = "", mode = "reject", only } = {}) {
      const state = { down: true, sets: [] };
      const fails = only ? (name) => name === only : () => true;
      const web = await loadRealestatePage({
        file: `docs/${page.file}`,
        locale,
        search,
        kind: page.kind,
        district: page.district,
        budgetBand: page.budgetBand,
        prerenderedBudget: page.budgetResult,
        realestate: mode === "404" && fails("realestate") ? undefined : REAL,
        gate: async (name) => {
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
      const textOf = (n) => n.ownText + (n.lastElementChild ? ` ${n.lastElementChild.textContent}` : "");
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
    assert.ok(p.script.includes(NOTIFY_FN), `docs/${p.file}: notifyBeside 가 docs/load-state.js 와 한 글자라도 다르다 - 틀을 고치고 굽지 않았다`);
    assert.ok(!p.html.includes("load-state.js"), `docs/${p.file}: 시세 장이 load-state.js 를 <script src> 로 문다 - 정상 방문 47장의 요청이 +1 이다`);
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
  const CALL = "  } catch (error) {\n    reportLoadFailure(error);\n    foldReserve();\n    if (!budgetEnabled && bakedGrid && (!hasAreaColumn || areaM2 === DEFAULT_AREA_M2)) {\n      notifyBeside(document.getElementById(\"area-controls\"), t(\"loadError\"), t(\"retry\"), main);\n      return;\n    }\n    showGridFailure();\n  }\n}\n";
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
    assert.ok(reserve > 0 && reserve < sec && sec > 0 && sec < controls && controls < table, `docs/${p.file}: 구획·컨트롤·표 자리의 순서가 다르다`);
    // 컨트롤 상자 바로 뒤가 표를 감싼 상자(.table-wrap)이고 그 사이에 다른 것이 없다 - 알림(afterend)은 그 사이에 선다.
    assert.match(p.html.slice(p.html.indexOf("</div>", controls), table), /^<\/div>\s*<div[^>]*>\s*$/, `docs/${p.file}: #area-controls 와 표 사이에 다른 것이 있다`);
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

test("ⓓ(i) 처음부터 ?area=59·114 로 연 27장: 실패하면 구운 84㎡ 표를 남기지 않고 실패 문구 + 재시도(빈 자리)로 간다 - 알림·기준일 문장 없음", async () => {
  for (const p of AREA_PAGES) {
    for (const area of [59, 114]) {
      for (const locale of ["ko", "en"]) {
        const page = await frames[0].open(p, { locale, search: `?area=${area}` });
        const label = `${p.file} ?area=${area} ${locale}`;
        assert.equal(page.notices().length, 0, `${label}: 면적을 바꾼 보기에서 알림(기준일 문장)이 섰다`);
        assert.equal(page.byId("area-controls").inserted.length, 0, label);
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
      assert.equal(page.byId("area-controls").inserted.length, 0);
    }
  }
  for (const p of BUDGET_PAGES) {
    const page = await frames[0].open(p, { locale: "en", only: "budget-deals" });
    assert.equal(page.notices().length, 0, `${p.file}: budget-deals 실패에 알림이 섰다`);
  }
});

test("S6 의도한 차이 (#296 (바)): 인라인 장당 +1,800B 이하, 47장 합 84,600B 이하, docs/load-state.js 순증가 2,000B 이하", async () => {
  // 이 PR 이 스크립트에 더한 바이트: 되돌려 놓은 사본과 견준다(옛 실패 행은 showGridFailure 로 옮겨졌을 뿐 같은 글자다).
  const revert = (script) => {
    const a = script.indexOf("function notifyBeside(");
    const b = script.indexOf("async function main()");
    const catchNew = script.slice(script.indexOf("    if (!budgetEnabled && bakedGrid"), script.indexOf("    showGridFailure();\n") + "    showGridFailure();\n".length);
    const row = script.slice(script.indexOf("function showGridFailure() {\n  bakedGrid = false;\n") + "function showGridFailure() {\n  bakedGrid = false;\n".length, script.indexOf("\n}\n\nasync function main()")).split("\n").map((l) => `  ${l}`).join("\n");
    const guardOpen = script.indexOf("  if (notifyBeside.last?.isConnected) {");
    const guard = script.slice(guardOpen, script.indexOf("  }\n", script.indexOf("notifyBeside(e.currentTarget)")) + "  }\n".length);
    return script.slice(0, a) + script.slice(b).replace(catchNew, `${row}\n`).replace(guard, "");
  };
  let total = 0;
  for (const p of PAGES) {
    const added = Buffer.byteLength(p.script) - Buffer.byteLength(revert(p.script));
    assert.ok(added > 1000 && added <= 1800, `docs/${p.file}: 이 PR 의 인라인 증가가 ${added}B - cto 한도 1,800B/장`);
    total += added;
  }
  assert.ok(total <= 84_600, `47장 합 ${total}B - cto 한도 84,600B 를 넘었다`);
  const base = Buffer.byteLength(loadStateSource) - 2578;
  assert.ok(base <= 2000, `docs/load-state.js 순증가 ${base}B - cto 한도 2,000B`);
});
