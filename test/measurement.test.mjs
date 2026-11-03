import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const source = await read("docs/analytics.js");
const watch = await read("docs/watchlist.js");
const conversion = await read("docs/jeonse-vs-wolse.html");
const renewal = await read("docs/renewal-vs-new.html");

function runtime({ query = "", items = new Map(), blocked = false, hostname = "kyhsa93.github.io", history } = {}) {
  const timers = new Map();
  let next = 0;
  const scripts = [];
  const context = vm.createContext({
    window: {}, URL, URLSearchParams,
    ...(history ? { history } : {}),
    location: { href: `https://${hostname}/jipgye/${query}`, search: query, hostname },
    document: { title: "집계", querySelector: () => null, createElement: () => ({}), head: { appendChild: (s) => scripts.push(s) } },
    localStorage: {
      getItem(k) { if (blocked) throw Error("blocked"); return items.get(k) ?? null; },
      setItem(k, v) { if (blocked) throw Error("blocked"); items.set(k, v); },
      removeItem(k) { if (blocked) throw Error("blocked"); items.delete(k); },
    },
    setTimeout(fn) { timers.set(++next, fn); return next; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context);
  const calls = () => JSON.parse(JSON.stringify(context.window.dataLayer.map((a) => Array.from(a))));
  return {
    context, scripts, items, api: context.window.analytics,
    config: () => calls().find(([n]) => n === "config")[2],
    events: (name) => calls().filter(([kind, n]) => kind === "event" && n === name).map(([, , p]) => p),
    flush() { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); },
  };
}

test("내부 방문은 명시적으로 켠 브라우저에만 유지되고 0으로 해제된다", () => {
  const items = new Map();
  const on = runtime({ query: "?ga_internal=1", items });
  assert.equal(on.config().traffic_type, "internal");
  assert.equal(runtime({ items }).config().traffic_type, "internal");
  assert.equal(runtime({ query: "?ga_internal=0", items }).config().traffic_type, undefined);
  assert.equal(runtime({ items }).config().traffic_type, undefined);
  assert.equal(runtime().config().traffic_type, undefined);
});

test("저장소 차단 시에도 명시적 내부 표시를 현재 페이지에 적용한다", () => {
  assert.equal(runtime({ blocked: true, query: "?ga_internal=1" }).config().traffic_type, "internal");
  assert.equal(runtime({ blocked: true }).config().traffic_type, undefined);
});

test("제어 플래그와 자유 입력을 전송 URL에서 제거한다", () => {
  const a = runtime({ query: "?ga_internal=1&ga_debug=1&q=private&apt=private&dong=private&cash=3.24&district=nowon" });
  a.api.event("watchlist_add", { watchlist_count: 1 });
  assert.equal(a.config().debug_mode, true);
  assert.equal(a.config().page_location, "https://kyhsa93.github.io/jipgye/?district=nowon");
  assert.equal(a.events("watchlist_add")[0].page_location, a.config().page_location);
});

/** replaceState 를 적어 두는 history. */
function recordingHistory(state) {
  const calls = [];
  return { calls, history: { state, replaceState: (s, _, url) => calls.push({ state: s, url: String(url) }) } };
}

function runtimeWithReferrer(referrer) {
  const context = vm.createContext({
    window: {}, URL, URLSearchParams,
    location: { href: "https://kyhsa93.github.io/jipgye/", search: "", hostname: "localhost" },
    document: { title: "집계", referrer, querySelector: () => null, createElement: () => ({}), head: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(source, context);
  const layer = JSON.parse(JSON.stringify(context.window.dataLayer.map((a) => Array.from(a))));
  return { config: () => layer.find(([n]) => n === "config")[2] };
}

test("사이트 검색 키 다섯은 gtag 보다 먼저 주소에서 지우고 history.state 는 그대로 둔다 (#818)", () => {
  const state = { keep: 1 };
  const h = recordingHistory(state);
  const a = runtime({ query: "?q=a&s=b&search=c&query=d&keyword=e&district=nowon&apt=x", history: h.history });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].state, state);
  assert.equal(h.calls[0].url, "https://kyhsa93.github.io/jipgye/?district=nowon&apt=x");
  assert.equal(a.config().page_location, "https://kyhsa93.github.io/jipgye/?district=nowon");
});

test("gtag 를 시작하기 전에 주소를 지운다 - 첫 hit 부터 검색어가 없다 (#818)", () => {
  const order = [];
  const history = { state: null, replaceState: () => order.push("replaceState") };
  const context = vm.createContext({
    window: {
      set dataLayer(value) { order.push("dataLayer"); this._layer = value; },
      get dataLayer() { return this._layer; },
    },
    URL, URLSearchParams, history,
    location: { href: "https://kyhsa93.github.io/jipgye/?s=a", search: "?s=a", hostname: "localhost" },
    document: { title: "집계", querySelector: () => null, createElement: () => ({}), head: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(source, context);
  assert.deepEqual(order, ["replaceState", "dataLayer"]);
});

test("검색 키가 없으면 주소를 건드리지 않는다 - GA 목록의 값은 전송 주소에서만 지운다 (#818)", () => {
  const h = recordingHistory(null);
  const a = runtime({ query: "?compare=x&from=y&budget=1&max=2&deposit=3&rent=4&apt=z&dong=w&cash=5&district=nowon", history: h.history });
  assert.deepEqual(h.calls, []);
  assert.equal(a.config().page_location, "https://kyhsa93.github.io/jipgye/?district=nowon");
});

test("앞 장 주소도 같은 규칙으로 지운다 - 검색 키와 금액·비교 단지 (#818)", () => {
  const context = runtimeWithReferrer("https://kyhsa93.github.io/jipgye/a.html?s=a&keyword=b&compare=x&from=y&budget=1&max=2&deposit=3&rent=4&district=nowon");
  assert.equal(context.config().page_referrer, "https://kyhsa93.github.io/jipgye/a.html?district=nowon");
});

test("입력 연속 변경은 마지막 표시 결과만 세고 재렌더는 중복 계산하지 않는다", () => {
  const a = runtime();
  a.api.result("renewal_vs_new", "private signature 1", { result_scope: "matched_complex" });
  a.api.result("renewal_vs_new", "private signature 2", { result_scope: "district_band" });
  a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  assert.equal(a.events("calculator_result")[0].result_scope, "district_band");
  a.api.result("renewal_vs_new", "private signature 2", { result_scope: "district_band" });
  a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  assert.ok(!JSON.stringify(a.events("calculator_result")).includes("private signature"));
});

test("결과가 무효해지면 예약 이벤트를 취소하고 이후 유효한 재입력을 센다", () => {
  const a = runtime();
  a.api.result("jeonse_vs_wolse", "x", {});
  a.api.result("jeonse_vs_wolse", null);
  a.flush();
  assert.equal(a.events("calculator_result").length, 0);
  a.api.result("jeonse_vs_wolse", "x", {});
  a.flush();
  assert.equal(a.events("calculator_result")[0].calculator_type, "jeonse_vs_wolse");
  assert.equal(a.events("calculator_result")[0].result_status, "success");
});

test("로컬에서 외부 분석 스크립트를 붙이지 않는다", () => {
  assert.deepEqual(runtime({ hostname: "localhost" }).scripts, []);
});

function watchPage({ saved = [], fail = false } = {}) {
  const a = runtime();
  const nodes = new Map(["watch-list", "card-watch", "watch-toggle"].map((k) => [k, { innerHTML: "" }]));
  Object.assign(a.context, {
    district: "노원구", locale: "ko", squash: (s) => s.replace(/\s/g, ""), escapeHtml: (s) => String(s),
    fullDeals: new Map([["노원구", []]]), cache: {}, loadJson: async () => ({ deals: [] }),
    localStorage: { getItem: () => JSON.stringify(saved), setItem: () => { if (fail) throw Error("blocked"); } },
  });
  a.context.document.getElementById = (k) => nodes.get(k);
  a.context.window.cardApt = "비공개 단지 이름";
  vm.runInContext(watch, a.context);
  return { ...a, click: () => nodes.get("watch-toggle").onclick() };
}

test("관심 단지 저장 성공과 삭제 성공만 집계하고 이름은 전송하지 않는다", () => {
  const a = watchPage();
  assert.equal(a.events("watchlist_add").length, 0);
  a.click();
  assert.equal(a.events("watchlist_add").length, 1);
  assert.equal(a.events("watchlist_add")[0].watchlist_count, 1);
  a.context.window.cardWatch();
  assert.equal(a.events("watchlist_add").length, 1);
  a.click();
  assert.equal(a.events("watchlist_remove")[0].watchlist_count, 0);
  assert.ok(!JSON.stringify(a.events("watchlist_add")).includes("비공개"));
});

test("저장 실패와 10개 한도 초과를 저장 성공으로 세지 않는다", () => {
  const failed = watchPage({ fail: true });
  failed.click();
  assert.equal(failed.events("watchlist_add").length, 0);
  const full = watchPage({ saved: Array.from({ length: 10 }, (_, i) => ["노원구", `apt${i}`, []]) });
  full.click();
  assert.equal(full.events("watchlist_add").length, 0);
});

test("관심 단지 스크립트는 기존 gzip 2KB 한도를 지킨다", () => {
  assert.ok(gzipSync(watch, { level: 9 }).length <= 2048);
});

function conversionPage() {
  const a = runtime();
  const box = { innerHTML: "", style: {} };
  a.context.document.getElementById = () => box;
  Object.assign(a.context, {
    cell: { noteKo: "안내" }, outcome: { comparable: true, cheaper: "jeonse", gap10k: 1 },
    currentCell() { return a.context.cell; }, compare() { return a.context.outcome; },
    cache: { conversion: { loan: {}, deposit: {} } }, cash10k: 30000, district: "서울", bandKey: "84", locale: "ko",
    t: () => () => "결과", man: () => "1", escapeHtml: String, optionHtml: () => "<p>option</p>",
    showEmpty: () => { box.innerHTML = "empty"; }, setText() {},
  });
  const fn = conversion.slice(conversion.indexOf("function renderResult()"), conversion.indexOf("function renderControls()"));
  vm.runInContext(fn, a.context);
  return { ...a, box, render: () => a.context.renderResult() };
}

test("전세·월세 결과 표시 후에만 계산 성공이 전송되고 불가능한 비교는 제외된다", () => {
  const a = conversionPage();
  a.render();
  assert.ok(a.box.innerHTML.includes("verdict"));
  assert.equal(a.events("calculator_result").length, 0);
  a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  a.context.outcome.comparable = false;
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  a.context.cell = null;
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 1);
});

function renewalPage() {
  const a = runtime();
  const nodes = new Map(Object.entries({ "check-apt": "비공개", "check-area": "84", "check-old": "10000", "check-ask": "10500" }).map(([k, value]) => [k, { value }]));
  const row = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
  Object.assign(a.context, {
    cache: { data: { slugs: { 서울: "seoul" } } },
    ck: { slug: "seoul", want: "", files: { seoul: { cells: { 비공개: { 84: row } }, fallback: { large: row }, min: { show: 5, ratio: 10 } } } },
    $: (id) => nodes.get(id), history: { replaceState() {} }, locale: "ko",
    ckFill: (id, opts, prev) => prev, ckSum: (x) => x.reduce((s, n) => s + n, 0), ckPct: () => 5, ckBand: () => 3,
    setTable() {}, setText() {}, num: String, escapeHtml: String,
    t: (k) => k === "ckBands" ? { large: "large" } : k === "ckCols" ? ["col"] : k === "ckRows" ? ["a", "b"] : () => "結果",
  });
  const fn = renewal.slice(renewal.indexOf("function renderCheck(full)"), renewal.indexOf("function renderUpdated()"));
  vm.runInContext(fn, a.context);
  return { ...a, nodes, row, render: () => a.context.renderCheck(false) };
}

test("갱신 비교는 유효한 입력·표본을 갖춘 결과만 세고 단지명·금액을 보내지 않는다", () => {
  const a = renewalPage();
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  assert.equal(a.events("calculator_result")[0].result_scope, "matched_complex");
  assert.ok(!/비공개|10000|10500/.test(JSON.stringify(a.events("calculator_result"))));
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  a.nodes.get("check-old").value = "";
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 1);
  a.nodes.get("check-old").value = "10000";
  a.row.fill(0);
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 1);
});

test("갱신 비교에서 결과를 못 찾으면 대기 중인 성공 이벤트를 취소한다", () => {
  const a = renewalPage();
  a.render();
  a.nodes.get("check-apt").value = "없는 단지";
  a.render(); a.flush();
  assert.equal(a.events("calculator_result").length, 0);
});
