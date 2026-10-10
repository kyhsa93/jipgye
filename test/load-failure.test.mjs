// 로드 실패 사이트 공통 규칙(docs/load-state.js)의 시험 (#173·#174).
//
// 규칙: 데이터를 못 받으면 "불러오는 중..."/"찾는 중..."을 남기지 않고, 실패 문구와 재시도 단추를
// 보인다. jsdom 없이 저장소가 이미 쓰는 방식(vm 샌드박스 + 손으로 만든 DOM, test/helpers/)으로 돌린다 -
// fetch를 거부하도록 주입하고, 화면 조각의 innerHTML과 단추의 click 리스너를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadRatesPage } from "./helpers/rates-page.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const RATE_PAGES = ["rates", "deposit-rates", "saving-rates", "mortgage-rates", "rent-loan-rates"];
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
