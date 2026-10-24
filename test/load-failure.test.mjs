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
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadNewsPage } from "./helpers/news-page.mjs";
import { stripInlineScriptComments } from "../scripts/strip-inline-comments.ts";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const RATE_PAGES = ["deposit-rates", "saving-rates", "mortgage-rates", "rent-loan-rates"];
const settle = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};

test("공용 규칙 파일을 쓰는 페이지는 인라인 스크립트보다 먼저 물고 있다", async () => {
  for (const name of [...RATE_PAGES, "deal-search"]) {
    const html = await readFile(path.join(root, `${SITE}/${name}.html`), "utf8");
    const tag = html.indexOf('<script src="./load-state.js"></script>');
    assert.ok(tag > 0, `${name}.html이 load-state.js를 물고 있지 않다`);
    assert.ok(tag < html.lastIndexOf("<script>\n"), `${name}.html: load-state.js가 인라인 스크립트보다 뒤에 있다`);
  }
});

test("금리 5장: rates.json 로드가 거부되면 추이 구역과 표가 모두 실패 문구 + 재시도 단추를 보인다", async () => {
  // #296 틀 (마): 추이 구역(구운 내용이 없는 빈 자리)은 실패 문구 + 재시도(규칙 1)이고, 표(구운 내용이 있는 자리)는 구운 채로 두고 그 위 알림이 실패 문구 + 재시도를 말한다(규칙 2).
  for (const name of RATE_PAGES) {
    for (const [locale, error, retry] of [
      ["ko", "금리 추이를 불러오지 못했습니다.", "다시 시도"],
      ["en", "Could not load the rate trend.", "Retry"],
    ]) {
      const page = await loadRatesPage({
        file: `${SITE}/${name}.html`,
        locale,
        baked: true,
        fetch: async () => {
          throw new TypeError("network down");
        },
      });
      const label = `${name} ${locale}`;
      const spot = page.byId.get("history-placeholder").innerHTML;
      assert.ok(!/불러오는 중|Loading/.test(spot), `${label}: 추이 구역에 로드 중 문구가 남았다`);
      assert.ok(spot.includes(error), `${label}: 추이 구역에 실패 문구가 없다`);
      assert.match(spot, new RegExp(`<button type="button" id="load-retry-history">${retry}</button>`), `${label}: 추이 구역에 재시도 단추가 없다`);
      assert.equal(page.byId.get("history-grid").innerHTML, page.baked.grid, `${label}: 추이 격자의 칸을 갈아 끼웠다(안내 칸 하나만 바꾼다)`);
      assert.equal(page.byId.get("products-body").innerHTML, page.baked.body, `${label}: 구운 표가 바뀌었다`);
      assert.equal(page.notice()?.retry, retry, `${label}: 표 위 알림의 재시도 단추가 사라졌다`);
      assert.ok((page.byId.get("load-retry-history").listeners.click ?? []).length > 0, `${label}: 추이 단추에 누름 처리가 없다`);
      assert.ok((page.byId.get("load-retry").listeners.click ?? []).length > 0, `${label}: 알림 단추에 누름 처리가 없다`);
    }
  }
});

test("금리 5장: 추이 구역의 재시도 단추를 누르면 다시 받아 추이를 그린다", async () => {
  const rates = await readJson("rates");
  const history = await readJson("rates-history");
  let down = true;
  const events = [];
  const page = await loadRatesPage({
    file: `${SITE}/deposit-rates.html`,
    analytics: { event: (...args) => events.push(args), pageView() {} },
    fetch: async (url) => {
      if (down) throw new TypeError("network down");
      return { ok: true, json: async () => (String(url).includes("rates-history") ? history : rates) };
    },
  });
  assert.ok(page.byId.get("history-placeholder").innerHTML.includes("load-retry-history"));

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
      file: `${SITE}/${name}.html`,
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
    async open(page, { locale = "ko", search = "", mode = "reject", only } = {}) {
      const state = { down: true, sets: [] };
      const fails = only ? (name) => name === only : () => true;
      const web = await loadRealestatePage({
        file: `${SITE}/${page.file}`,
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
    assert.ok(added > 1000 && added <= 1800, `${SITE}/${p.file}: 이 PR 의 인라인 증가가 ${added}B - cto 한도 1,800B/장`);
    total += added;
  }
  assert.ok(total <= 84_600, `47장 합 ${total}B - cto 한도 84,600B 를 넘었다`);
  const base = Buffer.byteLength(loadStateSource) - 2578;
  assert.ok(base <= 2000, `docs/load-state.js 순증가 ${base}B - cto 한도 2,000B`);
});

// ============================================================================================================
// 둘째 행: 첫 화면(docs/index.html, 틀 (다), F1~F4). 같은 규칙 2~5 를 이 장의 머리 배너(#load-error)로 지킨다 -
// 구운 표 넷(#market-grid·#realestate-grid·#news-list·#summary-box)과 구운 기준일(#updated)을 실패해도 지우지 않고, 배너가
// [무엇을 못 받았는지] + [아래는 기준일(구운 data-updated)에 만든 값입니다] + (영어) [Some of it is in Korean only.] + [다시 시도] 를 말한다.
// 이 장은 load-state.js 를 <script src> 로 물지 않는다(S6) - 문장 글자만 같게 두고 그것을 아래에서 맞대 본다. 실패 이유("HTTP 503")는 보이지 않는다.
// 오늘 값이 구운 것이므로 지난 날짜 보기(?date=)는 구운 것을 남기지 않는다(규칙 3): 그 자리는 실패 문구 + 배너의 다시 시도(규칙 1)다.
// ============================================================================================================
const INDEX_SPOTS = ["market-grid", "realestate-grid", "summary-box", "news-list"];
const INDEX_TODAY = ["market", "news", "summary", "realestate"];
const indexSource = await readFile(path.join(root, `${SITE}/index.html`), "utf8");
const indexScript = scriptOf(indexSource);
const HTTP_WORDS = /HTTP|\b(?:404|503)\b/;

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

test("(다) 범위: index 는 구운 조각 넷과 구운 기준일(data-updated)을 갖고, load-state.js 를 <script src> 로 물지 않는다 (S6)", () => {
  assert.equal(indexSource.includes("load-state.js"), false, "index 가 load-state.js 를 문다 - 외부 JS 를 더하는 일이라 cto 허용 표가 먼저다");
  for (const name of ["market", "realestate", "summary", "news"]) {
    assert.match(indexSource, new RegExp(`<!--prerender:${name}-->[\\s\\S]+<!--/prerender:${name}-->`), `구운 ${name} 조각이 비었다`);
  }
  assert.match(indexSource, /<div class="updated" id="updated" data-updated="\d{4}-\d{2}-\d{2}">/, "구운 기준일 줄에 data-updated 가 없다");
});

test("ⓐⓒ (다) 요청이 전부 실패(네트워크·404·503)해도 구운 표 넷과 구운 기준일 글자·data-updated 가 한 글자도 안 바뀐다 - 한국어·영어", async () => {
  for (const lang of ["ko", "en"]) {
    for (const mode of ["network", "404", "503"]) {
      const { page } = await openIndex({ lang, mode });
      assertBakedKept(page, `${lang} ${mode}`);
    }
  }
});

test("ⓑⓔ (다) 실패하면 머리 배너가 보이고 이름 + 구운 기준일 문장 + 다시 시도를 말한다 - 영어는 한국어 고지 정확히 1, 한국어는 0, 실패 이유·오늘·최신은 없다", async () => {
  for (const [lang, names, kept, retry] of [
    ["ko", "시장지표, 뉴스, AI 요약, 부동산을 불러오지 못했습니다.", (day) => `아래는 기준일(${day})에 만든 값입니다.`, "다시 시도"],
    ["en", "Could not load: market data, news, AI summary, real estate.", (day) => `Shown below is what this page was built with on ${day}.`, "Retry"],
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
  const ids = { market: "market-grid", news: "news-list", summary: "summary-box", realestate: "realestate-grid" };
  const label = { market: "시장지표를", news: "뉴스를", summary: "AI 요약을", realestate: "부동산을" };
  for (const failing of INDEX_TODAY) {
    const { page } = await openIndex({ mode: "503", only: failing });
    assert.equal(page.byId(ids[failing]).innerHTML, page.baked[ids[failing]], `${failing}: 못 받은 자리의 구운 내용이 바뀌었다`);
    for (const other of INDEX_TODAY.filter((k) => k !== failing)) {
      assert.notEqual(page.byId(ids[other]).innerHTML, page.baked[ids[other]], `${failing} 실패인데 ${other} 는 받은 값으로 안 바뀌었다`);
    }
    const banner = bannerOf(page);
    assert.equal(banner.hidden, false);
    assert.ok(banner.text.startsWith(`${label[failing]} 불러오지 못했습니다.`), `${failing}: ${banner.text}`);
  }
});

test("ⓖ (다) 다시 시도가 성공하면 배너가 걷히고 구운 자리가 받은 값으로 바뀐다, 또 실패하면 구운 채로 배너가 남는다", async () => {
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
    for (const id of ["market-grid", "news-list", "summary-box"]) assert.notEqual(page.byId(id).innerHTML, page.baked[id], `${lang}: #${id} 가 받은 값으로 안 바뀌었다`);
    assert.ok(String(page.byId("news-list").innerHTML).includes("news-item"), `${lang}: 뉴스가 안 그려졌다`);
  }
});

test("ⓓ (다) 지난 날짜 보기(?date=)에서 요청이 실패하면 오늘 구운 값이 남지 않고, 실패 문구 + 배너의 다시 시도가 보인다 - 기준일 줄은 그 날짜를 말한다", async () => {
  const DATE = "2026-09-01";
  for (const lang of ["ko", "en"]) {
    for (const mode of ["network", "404", "503"]) {
      const { page } = await openIndex({ lang, mode, search: `?date=${DATE}` });
      const label = `${lang} ${mode}`;
      for (const id of ["market-grid", "news-list", "summary-box"]) {
        assert.notEqual(page.byId(id).innerHTML, page.baked[id], `${label}: #${id} 에 오늘 구운 값이 남았다`);
      }
      assert.match(String(page.byId("market-grid").innerHTML), /불러오지 못했습니다|Failed to load data/, `${label}: 시장지표 실패 문구`);
      assert.match(String(page.byId("news-list").innerHTML), /불러오지 못했습니다|Failed to load data/, `${label}: 뉴스 실패 문구`);
      assert.ok(
        String(page.byId("summary-box").textContent).includes(lang === "ko" ? "AI 요약을 불러오지 못했습니다." : "Could not load the AI summary."),
        `${label}: 요약이 실패를 '아직 없음'으로 말한다: ${page.byId("summary-box").textContent}`,
      );
      assert.equal(page.byId("realestate-section").hidden, true, `${label}: 지난 날짜에 부동산 구획이 열렸다`);
      assert.ok(String(page.byId("updated").textContent).includes(DATE), `${label}: 기준일 줄이 그 날짜를 말하지 않는다: ${page.byId("updated").textContent}`);
      assert.notEqual(page.byId("updated").textContent, page.baked.updatedText, `${label}: 기준일 줄이 구운 기준일로 되돌아갔다`);
      const banner = bannerOf(page);
      assert.equal(banner.hidden, false, `${label}: 배너가 안 보인다 (재시도 단추가 없다)`);
      assert.equal(banner.retry, lang === "ko" ? "다시 시도" : "Retry", `${label}: 다시 시도 단추`);
      assert.ok(banner.text.includes(lang === "ko" ? "시장지표, AI 요약, 뉴스" : "market data, AI summary, news"), `${label}: 못 받은 것의 이름: ${banner.text}`);
      assert.equal(/기준일\(|Shown below|Korean only/.test(banner.text), false, `${label}: 가리킬 구운 값이 없는데 기준일 문장이 붙었다: ${banner.text}`);
      assert.equal(HTTP_WORDS.test(banner.text), false, `${label}: 실패 이유가 보인다: ${banner.text}`);
      const notice = page.byId("content-notice");
      assert.equal(/기록이 없습니다|No record/.test(String(notice.textContent)), false, `${label}: 실패를 '기록이 없다'고 말한다: ${notice.textContent}`);
    }
  }
});

test("ⓖ (다) 지난 날짜 보기에서 다시 시도가 성공하면 배너가 걷히고 그날 기록이 그려진다", async () => {
  const newsHistory = await readJson("news-history");
  const day = newsHistory.findLast((entry) => entry.items?.length)?.date;
  const { page, server } = await openIndex({ search: `?date=${day}` });
  assert.equal(bannerOf(page).hidden, false);
  server.mode = "ok";
  await clickRetry(page);
  assert.equal(bannerOf(page).hidden, true, "성공했는데 배너가 남았다");
  assert.ok(String(page.byId("news-list").innerHTML).includes("news-item"), "그날 뉴스가 안 그려졌다");
});

test("ⓓ (다) 지난 날짜의 기록이 없을 때(받았는데 비었다)도 오늘 구운 값이 남지 않는다 - 배너는 없고 '기록이 없습니다'로 말한다", async () => {
  const { page } = await openIndex({ mode: "ok", search: "?date=2020-01-01" });
  for (const id of ["market-grid", "news-list", "summary-box"]) {
    assert.notEqual(page.byId(id).innerHTML, page.baked[id], `#${id} 에 오늘 구운 값이 남았다`);
    assert.ok(String(page.byId(id).textContent + page.byId(id).innerHTML).includes("이 날짜의 기록이 없습니다."), `#${id} 가 기록 없음을 말하지 않는다`);
  }
  assert.equal(bannerOf(page).hidden, true, "기록 없음에 실패 배너가 떴다");
});

test("(다) 규칙 5: 받았는데 비어 있는 것은 실패가 아니다 - 구운 값을 남기지 않고 '아직 없음'으로 말하며 실패 배너가 뜨지 않는다", async () => {
  const server = indexServer("ok");
  const fetchEmpty = async (url) => {
    const name = String(url).split("/data/")[1]?.split(".json")[0];
    if (name === "news") return { ok: true, json: async () => ({ items: [] }) };
    if (name === "summary") return { ok: true, json: async () => ({}) };
    return server.fetch(url);
  };
  const page = await loadIndexPage({ baked: true, fetch: fetchEmpty });
  await settle(60);
  assert.notEqual(page.byId("news-list").innerHTML, page.baked["news-list"], "받은 빈 뉴스인데 구운 뉴스가 남았다");
  assert.notEqual(page.byId("summary-box").innerHTML, page.baked["summary-box"], "받은 빈 요약인데 구운 요약이 남았다");
  assert.ok(String(page.byId("summary-box").textContent).includes("아직 생성된 요약이 없습니다."), page.byId("summary-box").textContent);
  assert.equal(bannerOf(page).hidden, true, "받았는데 실패 배너가 떴다");
});

test("(다) 규칙 1: 구운 내용이 없는 빈 자리는 실패하면 실패 문구로 바꾸고 구운 기준일 문장은 말하지 않는다", async () => {
  const server = indexServer("network");
  const page = await loadIndexPage({ fetch: server.fetch });
  await settle(60);
  for (const id of ["market-grid", "news-list"]) assert.ok(String(page.byId(id).innerHTML).includes("불러오지 못했습니다"), `#${id} 빈 자리에 실패 문구가 없다`);
  assert.ok(String(page.byId("summary-box").textContent).includes("AI 요약을 불러오지 못했습니다."));
  assert.equal(/기준일\(/.test(bannerOf(page).text), false, "구운 기준일이 없는데 기준일 문장이 붙었다");
});

test("ⓕ (다) 구운 자리 넷의 실패 갈래는 쓰기 전에 baked() 로 먼저 나간다 - 새 실패 마크업은 없고 알림은 머리 배너 한 곳이다", () => {
  for (const [fn, guard] of [
    ["renderMarket", "baked(tbody, market)"],
    ["renderRealestate", "baked(tbody, realestate)"],
    ["renderNews", "baked(list, news)"],
    ["renderSummary", "baked(box, summary)"],
  ]) {
    const a = indexScript.indexOf(`function ${fn}(`);
    const body = indexScript.slice(a, indexScript.indexOf("\n  function ", a + 10));
    const g = body.indexOf(`if (${guard}) return;`);
    assert.ok(g > 0, `${fn}: 구운 내용을 남기는 갈래가 없다`);
    assert.equal(/innerHTML\s*=|textContent\s*=|classList\.add|hidden\s*=/.test(body.slice(0, g)), false, `${fn}: baked() 보다 먼저 자리를 건드린다`);
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

test("변이 증빙 (다): 구운 내용을 남기는 갈래를 지운 사본, 지난 날짜 가드를 지운 사본, 구운 기준일을 지우는 사본은 위 점검이 실패시킨다", async () => {
  const noKeep = await openIndex({ mutate: mutation("const baked = (el, data) => !data && !isArchiveView && el.textContent;", "const baked = () => false;") });
  assert.throws(() => assertBakedKept(noKeep.page, "변이1"), /구운 내용이 바뀌었다/, "구운 내용을 안 남겨도 ⓐ 가 통과한다");

  const noArchiveGuard = await openIndex({ search: "?date=2026-09-01", mutate: mutation("!data && !isArchiveView && el.textContent", "!data && el.textContent") });
  const left = ["market-grid", "news-list", "summary-box"].filter((id) => noArchiveGuard.page.byId(id).innerHTML === noArchiveGuard.page.baked[id]);
  assert.ok(left.length > 0, "지난 날짜 가드를 지워도 오늘 구운 값이 안 남는다 - ⓓ 가 눈이 멀었다");

  const noStamp = await openIndex({
    mutate: mutation(
      'if (latest) document.getElementById("updated").textContent = t("lastUpdated")(fmtUpdated(latest));',
      'document.getElementById("updated").textContent = latest ? t("lastUpdated")(fmtUpdated(latest)) : "-";',
    ),
  });
  assert.throws(() => assertBakedKept(noStamp.page, "변이3"), /구운 기준일 글자가 바뀌었다/, "기준일을 '-'로 바꿔도 ⓒ 가 통과한다");
});

test("S6 의도한 차이 (#296 (다)): index 인라인 스크립트 순증가 +400B 이하 (merge-base 75,413B)", () => {
  const added = Buffer.byteLength(indexScript) - 75_413;
  assert.ok(added <= 400, `index 인라인 증가가 ${added}B - cto 기본 한도 +400B/장, 넘으면 PR 전에 묻는다`);
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

test("ⓑ (나) F6: 요약을 못 받았으면 '요약이 아직 없다'가 아니라 'AI 요약을 불러오지 못했습니다'(index 와 같은 글자)로 말하고 구운 요약을 남긴다", async () => {
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
  // index 의 문자열표와 같은 글자인지(같은 것을 두 곳에서 다르게 부르지 않는다)
  assert.ok(indexSource.includes('summaryLoadError: "AI 요약을 불러오지 못했습니다."') && indexSource.includes('summaryLoadError: "Could not load the AI summary."'));
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

test("S6 의도한 차이 (#296 (나)): 뉴스 4장 인라인 스크립트 순증가 +400B 이하 (merge-base 6521bb9c), load-state.js 순증가 0B", () => {
  const BASE = { news: 13_647, "rate-news": 13_711, "realestate-news": 13_726, "stock-news": 13_710 };
  for (const name of NEWS_FILES) {
    const added = Buffer.byteLength(newsSources[name].script) - BASE[name];
    assert.ok(added > 0 && added <= 400, `${SITE}/${name}.html: 인라인 증가가 ${added}B - cto 기본 한도 +400B/장, 넘으면 PR 전에 묻는다`);
  }
  assert.ok(Buffer.byteLength(loadStateSource) <= 4_574, "docs/load-state.js 가 늘었다 - cto 기본값은 순증가 0B, 필요하면 PR 전에 묻는다");
});

// ============================================================================================================
// 넷째 행: 금리 틀(scripts/rates-template.html)과 그 틀로 찍은 4장(deposit·saving·mortgage·rent-loan), 틀 (마), F9 + 흡수한 #323. 규칙 2~5 를
// rates.json 이 안 올 때 구운 금리표(#products-head·#products-body)와 구운 기준일(#updated)을 지우지 않고, #content 안 알림 한 줄이
// [금리 데이터를 불러오지 못했습니다.] + [아래는 기준일(구운 data-updated)에 만든 값입니다.] + [다시 시도] 를 말하는 것으로 지킨다.
// 추이 구역(#history-grid)은 구운 내용이 없는 빈 자리라 규칙 1(실패 문구 + 재시도)이다. 예전에는 격자 전체를 안내 칸 하나로 갈아 끼워 넉 칸 높이(412px 폭 580px)가
// 한 칸(136px)으로 접히며 아래를 밀었다(#323). 지금은 안내 칸(#history-placeholder) 안만 바꿔 빈 칸 셋이 그대로 남는다.
// 금리 틀은 영어 고지("Some of it is in Korean only.")를 붙이지 않는다 - 구운 표와 받아서 그린 표가 둘 다 한국어라 실패가 언어를 바꾸지 않는다(po 판정). ⓗ 는 「고지 0」으로 고정한다.
// 보기를 바꾸는 입력은 주소의 ?tab·term·type·q·amt 다(구운 표는 기본 탭·12개월·유형 전체·검색어 없음·기본 금액). 그 보기에서는 구운 표가 그 보기의 답이 아니므로 규칙 3 이 걸린다.
// ============================================================================================================
const ratesSources = {};
for (const name of RATE_PAGES) ratesSources[name] = scriptOf(await readFile(path.join(root, `${SITE}/${name}.html`), "utf8"));

function ratesServer(mode, only = null, overrides = {}) {
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
const openRates = async (name, { lang = "ko", mode = "network", only = null, search = "", overrides = {}, mutate } = {}) => {
  const server = ratesServer(mode, only, overrides);
  const page = await loadRatesPage({ file: `${SITE}/${name}.html`, locale: lang, baked: true, fetch: server.fetch, search, mutate });
  await settle(30);
  return { page, server };
};
const clickRatesRetry = async (page) => {
  page.byId.get("load-retry").dispatch("click");
  await settle(30);
};
const RATES_ASOF = { ko: (day) => `아래는 기준일(${day})에 만든 값입니다.`, en: (day) => `Shown below is what this page was built with on ${day}.` };
const RATES_ERROR = { ko: "금리 데이터를 불러오지 못했습니다.", en: "Could not load the rate data." };
const RATES_TREND_ERROR = { ko: "금리 추이를 불러오지 못했습니다.", en: "Could not load the rate trend." };
const RATES_RETRY = { ko: "다시 시도", en: "Retry" };

// ⓐⓒ 구운 표 머리·표 본문·추이 격자와 구운 기준일 글자·data-updated 가 그대로다. 변이 시험이 같은 함수를 쓴다.
function assertRatesBakedKept(page, label) {
  assert.equal(page.byId.get("products-head").innerHTML, page.baked.head, `${label}: 구운 표 머리가 바뀌었다`);
  assert.equal(page.byId.get("products-body").innerHTML, page.baked.body, `${label}: 구운 표 본문이 바뀌었다`);
  assert.equal(page.byId.get("history-grid").innerHTML, page.baked.grid, `${label}: 추이 격자의 칸을 갈아 끼웠다 - 빈 칸 셋이 사라지면 격자가 접힌다(#323)`);
  assert.equal(page.byId.get("updated").textContent, page.baked.updatedText, `${label}: 구운 기준일 글자가 바뀌었다`);
  assert.equal(page.byId.get("updated").getAttribute("data-updated"), page.baked.day, `${label}: data-updated 가 바뀌었다`);
}

test("(마) 범위: 금리 4장은 구운 표·기준일(data-updated)과 넉 칸 추이 격자(안내 칸 + 빈 칸 셋)를 갖고 load-state.js 를 문다", async () => {
  for (const name of RATE_PAGES) {
    const { page } = await openRates(name, { mode: "ok" });
    assert.ok(page.baked.body.includes("<tr"), `${name}: 구운 표 본문이 비었다`);
    assert.match(page.baked.day, /^\d{4}-\d{2}-\d{2}$/, `${name}: 구운 기준일 줄에 data-updated 가 없다`);
    assert.equal(countOf(page.baked.grid, "history-reserve"), 3, `${name}: 추이 격자의 빈 칸이 셋이 아니다`);
    assert.ok(page.baked.grid.includes('id="history-placeholder"'), `${name}: 안내 칸(#history-placeholder)이 없다`);
  }
});

test("ⓐⓒ (마) #323 요청이 전부 실패(네트워크·404·503)해도 구운 표·기준일이 안 바뀌고 추이 격자의 빈 칸 셋이 남는다 - 4장 × 한국어·영어", async () => {
  for (const name of RATE_PAGES) {
    for (const lang of ["ko", "en"]) {
      for (const mode of ["network", "404", "503"]) {
        const { page } = await openRates(name, { lang, mode });
        const label = `${name} ${lang} ${mode}`;
        assertRatesBakedKept(page, label);
        // 안내 칸은 실패를 말하고 "불러오는 중..." 을 남기지 않는다(규칙 1)
        const spot = page.byId.get("history-placeholder").innerHTML;
        assert.ok(spot.includes(RATES_TREND_ERROR[lang]) && !/불러오는 중|Loading/.test(spot), `${label}: 추이 안내 칸: ${spot}`);
      }
    }
  }
});

test("ⓑⓔⓗ (마) 실패하면 알림이 보이고 [금리 데이터 실패] + [구운 기준일 문장] + 다시 시도를 말한다 - 영어 고지는 한국어·영어 모두 0, 실패 이유·오늘·최신은 없다", async () => {
  for (const name of RATE_PAGES) {
    for (const lang of ["ko", "en"]) {
      for (const mode of ["network", "404", "503"]) {
        const { page } = await openRates(name, { lang, mode });
        const label = `${name} ${lang} ${mode}`;
        const notice = page.notice();
        assert.ok(notice, `${label}: 알림이 안 보인다`);
        assert.equal(notice.text, `${RATES_ERROR[lang]} ${RATES_ASOF[lang](page.baked.day)}`, `${label}: 알림 문장`);
        assert.equal(notice.retry, RATES_RETRY[lang], `${label}: 다시 시도 단추 글자`);
        assert.ok(notice.html.startsWith('<p class="content-notice">'), `${label}: 알림이 기존 content-notice 모양이 아니다`);
        assert.ok((notice.button.listeners.click ?? []).length > 0, `${label}: 다시 시도 단추에 누름 처리가 없다`);
        // ⓗ 금리 틀은 「고지 0」: 화면에 보이는 글자(알림 + 추이 안내 칸)에 한국어 고지가 없다
        const visible = `${notice.text} ${page.byId.get("history-placeholder").innerHTML}`;
        assert.equal(countOf(visible, KO_ONLY), 0, `${label}: 금리 틀이 한국어 고지를 붙였다 - 구운 것과 받은 것이 같은 언어라 붙이지 않는다`);
        assert.equal(HTTP_WORDS.test(notice.html), false, `${label}: 실패 이유가 방문자에게 보인다: ${notice.text}`);
        assert.equal(BAD_WORDS.test(notice.text), false, `${label}: 알림이 지금 값처럼 말한다: ${notice.text}`);
      }
    }
  }
});

test("규칙 3 (마): 주소로 구운 표와 다른 보기(?tab·term·type·q·amt)를 연 채 실패하면 구운 표를 남기지 않는다 - 표 자리 실패 문구 + 재시도, 알림·기준일 문장 없음, 기준일은 '-'", async () => {
  const VIEWS = [
    ["?tab=mortgage", "deposit-rates"],
    ["?tab=deposit", "rent-loan-rates"],
    ["?term=24", "deposit-rates"],
    ["?type=변동금리", "mortgage-rates"],
    ["?q=국민", "saving-rates"],
    ["?amt=5000000", "deposit-rates"],
  ];
  for (const [search, name] of VIEWS) {
    for (const lang of ["ko", "en"]) {
      const { page } = await openRates(name, { lang, search });
      const label = `${name}${search} ${lang}`;
      const body = page.byId.get("products-body").innerHTML;
      assert.notEqual(body, page.baked.body, `${label}: 다른 보기인데 구운 표가 남았다`);
      assert.ok(body.includes(RATES_ERROR[lang]) && body.includes(`id="load-retry">${RATES_RETRY[lang]}</button>`), `${label}: 표 자리의 실패 문구·재시도 단추: ${body}`);
      assert.equal(page.notice(), null, `${label}: 구운 값이 없는데 '구운 값입니다' 알림이 떴다`);
      assert.equal(page.byId.get("updated").textContent, "-", `${label}: 구운 기준일을 되살렸다`);
      assert.equal(body.includes("기준일(") || body.includes("built with"), false, `${label}: 표 자리에 기준일 문장이 붙었다`);
    }
  }
  // 양성 대조: 보기를 안 바꾸는 주소(광고 꼬리표, 기본값과 같은 값, 금리 틀이 무시하는 값)는 구운 표를 남기고 알림을 세운다
  for (const search of ["?utm_source=x", "?tab=deposit", "?term=12", "?q=", "?amt=0"]) {
    const { page } = await openRates("deposit-rates", { search });
    assertRatesBakedKept(page, `deposit-rates${search}`);
    assert.ok(page.notice(), `deposit-rates${search}: 같은 보기인데 알림이 없다`);
  }
});

test("ⓑ (마) 실패한 뒤 언어를 바꾸면 알림·추이 안내 문구가 그 언어로 바뀌고 구운 표는 그대로다 - 표를 '조건에 맞는 상품이 없습니다'로 갈아 끼우지 않는다", async () => {
  const { page } = await openRates("deposit-rates", { lang: "ko" });
  assert.equal(page.notice().text, `${RATES_ERROR.ko} ${RATES_ASOF.ko(page.baked.day)}`);
  page.byId.get("lang-toggle").dispatch("click");
  await settle(10);
  assert.equal(page.notice().text, `${RATES_ERROR.en} ${RATES_ASOF.en(page.baked.day)}`);
  assert.equal(page.notice().retry, "Retry");
  assert.ok(page.byId.get("history-placeholder").innerHTML.includes(RATES_TREND_ERROR.en));
  assertRatesBakedKept(page, "언어 전환 뒤");
  page.byId.get("lang-toggle").dispatch("click");
  await settle(10);
  assert.equal(page.notice().text, `${RATES_ERROR.ko} ${RATES_ASOF.ko(page.baked.day)}`);
  assertRatesBakedKept(page, "언어 전환 두 번 뒤");
});

test("ⓖ (마) 다시 시도가 성공하면 알림이 걷히고 표·추이·기준일이 받은 값으로 바뀐다, 또 실패하면 구운 채로 알림이 남는다 - 한 번의 실패에 다시 받기는 한 번", async () => {
  for (const name of RATE_PAGES) {
    for (const lang of ["ko", "en"]) {
      const { page, server } = await openRates(name, { lang });
      const label = `${name} ${lang}`;
      const first = server.requests.filter((n) => n === "rates").length;
      await clickRatesRetry(page);
      assert.equal(server.requests.filter((n) => n === "rates").length, first + 1, `${label}: 다시 시도가 rates.json 을 한 번 요청하지 않았다`);
      assert.ok(page.notice(), `${label}: 다시 실패했는데 알림이 걷혔다`);
      assertRatesBakedKept(page, `${label} 재시도 실패`);

      server.mode = "ok";
      await clickRatesRetry(page);
      assert.equal(page.notice(), null, `${label}: 성공했는데 알림이 남았다`);
      assert.notEqual(page.byId.get("products-body").innerHTML, page.baked.body, `${label}: 표가 받은 값으로 안 바뀌었다`);
      assert.notEqual(page.byId.get("history-grid").innerHTML, page.baked.grid, `${label}: 추이 격자가 받은 값으로 안 바뀌었다`);
      assert.notEqual(page.byId.get("updated").textContent, page.baked.updatedText, `${label}: 기준일 줄이 받은 갱신 시각으로 안 바뀌었다`);
    }
  }
});

test("(마) 규칙 5·정상: 받았는데 빈 응답은 실패가 아니다(알림 없음), 정상이면 알림이 없고 표가 받은 값이다", async () => {
  const rates = await readJson("rates");
  const { page: ok } = await openRates("deposit-rates", { mode: "ok" });
  assert.equal(ok.notice(), null, "정상인데 알림이 떴다");
  assert.notEqual(ok.byId.get("updated").textContent, ok.baked.updatedText);
  const { page: empty } = await openRates("deposit-rates", { mode: "ok", overrides: { rates: { ...rates, deposit: [] } } });
  assert.equal(empty.notice(), null, "받았는데 빈 목록이 실패 알림을 띄웠다");
  assert.notEqual(empty.byId.get("products-body").innerHTML, empty.baked.body, "받은 빈 목록인데 구운 표가 남았다");
});

test("ⓕ (마) 실패 표시는 renderFailure 한 곳이고 공용 함수로만 만든다 - 추이 격자를 통째로 갈아 끼우거나 기준일을 '-'로 바꾸는 옛 갈래가 없다", () => {
  for (const name of RATE_PAGES) {
    const script = ratesSources[name];
    assert.equal(countOf(script, "showFailure("), 1, `${name}: showFailure 호출이 한 곳이 아니다`);
    assert.equal(countOf(script, "renderFailure()"), 3, `${name}: renderFailure 부름(정의 1 + catch 1 + renderAll 1)이 달라졌다`);
    assert.ok(!script.includes('showFailure(document.getElementById("history-grid")'), `${name}: 추이 격자를 통째로 갈아 끼운다`);
    assert.ok(script.includes('show("history-placeholder"'), `${name}: 추이 안내 칸 하나만 바꾸지 않는다`);
    assert.equal(countOf(script, '.textContent = "-"'), 1, `${name}: 기준일을 "-"로 바꾸는 갈래가 하나(다른 보기)가 아니다`);
    const fn = script.slice(script.indexOf("function renderFailure("), script.indexOf("async function main("));
    assert.ok(fn.includes('document.getElementById("updated").dataset.updated'), `${name}: 구운 data-updated 를 읽지 않는다`);
    assert.ok(/\} else \{[\s\S]*textContent = "-"/.test(fn), `${name}: "-" 가 다른 보기 갈래 밖에 있다`);
    assert.equal(/new Date\(|Date\.now/.test(fn), false, `${name}: 알림이 새 날짜를 계산한다`);
    assert.ok(script.includes("if (!cache.rates) return renderFailure();"), `${name}: 실패한 채로 renderAll(언어 전환·뒤로 가기)이 표를 갈아 끼운다`);
    const meta = script.slice(script.indexOf("function renderMeta("), script.indexOf("function renderAll("));
    assert.ok(meta.includes('if (cache.rates?.updatedAt) document.getElementById("updated")'), `${name}: renderMeta 가 못 받았을 때 기준일을 지운다`);
  }
  assert.ok(ratesSources["deposit-rates"].includes("아래는 기준일(${day})에 만든 값입니다."));
  assert.ok(ratesSources["deposit-rates"].includes("Shown below is what this page was built with on ${day}."));
  assert.equal(ratesSources["deposit-rates"].includes("Some of it is in Korean only"), false, "금리 틀에 한국어 고지가 들어갔다");
});

test("변이 증빙 (마): 격자를 통째로 갈아 끼우는 사본, 보기 가드를 지운 사본, renderAll 가드를 지운 사본, 알림을 안 세우는 사본은 위 점검이 실패시킨다", async () => {
  const wholeGrid = await openRates("deposit-rates", {
    mutate: mutation(
      'show("history-placeholder", t("historyLoadError"), undefined, "load-retry-history");',
      'document.getElementById("history-grid").innerHTML = `<div id="history-placeholder">${t("historyLoadError")}</div>`;',
    ),
  });
  assert.throws(() => assertRatesBakedKept(wholeGrid.page, "변이1"), /추이 격자의 칸을 갈아 끼웠다/, "격자를 갈아 끼워도 #323 점검이 통과한다");

  // 보기 가드를 지우면(항상 구운 보기로 본다) ?tab=mortgage 에서도 구운 표가 남는다 - 규칙 3 점검이 이것을 잡는다
  const noViewGuard = await openRates("deposit-rates", { search: "?tab=mortgage", mutate: mutation("if (state.category === DEFAULT_CATEGORY &&", "if (true ||") });
  assert.equal(noViewGuard.page.byId.get("products-body").innerHTML, noViewGuard.page.baked.body, "변이2 가 구운 표를 남기지 않았다 - 규칙 3 점검이 눈이 멀었다");
  assert.ok(noViewGuard.page.notice(), "변이2: 다른 보기인데 '구운 값입니다' 알림이 떴다");

  const noRenderAllGuard = await openRates("deposit-rates", { mutate: mutation("if (!cache.rates) return renderFailure();", "") });
  noRenderAllGuard.page.byId.get("lang-toggle").dispatch("click");
  await settle(10);
  assert.throws(() => assertRatesBakedKept(noRenderAllGuard.page, "변이3"), /구운 표 본문이 바뀌었다|구운 표 머리가 바뀌었다/, "renderAll 가드를 지워도 언어 전환 점검이 통과한다");

  const noNotice = await openRates("deposit-rates", { mutate: mutation('show("content",', "void (") });
  assert.equal(noNotice.page.notice(), null, "알림을 안 세우는 사본이 알림을 세웠다 - ⓑ 가 눈이 멀었다");
});

test("S6 의도한 차이 (#296 (마)): 금리 4장 인라인 스크립트 순증가 +400B 이하 (merge-base 5af7d1aa), load-state.js 순증가 0B", () => {
  const BASE = { "deposit-rates": 38_022, "saving-rates": 38_032, "mortgage-rates": 38_003, "rent-loan-rates": 37_995 };
  for (const name of RATE_PAGES) {
    const added = Buffer.byteLength(ratesSources[name]) - BASE[name];
    assert.ok(added > 0 && added <= 400, `${SITE}/${name}.html: 인라인 증가가 ${added}B - cto 기본 한도 +400B/장, 넘으면 PR 전에 묻는다`);
  }
  assert.ok(Buffer.byteLength(loadStateSource) <= 4_574, "docs/load-state.js 가 늘었다 - cto 기본값은 순증가 0B, 필요하면 PR 전에 묻는다");
});
