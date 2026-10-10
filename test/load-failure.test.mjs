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
      if (!button.disabled) button.dispatch("click");
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
