import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { DISTRICT_SLUGS } from "../scripts/district-slugs.ts";
import { BUDGET_PAGE_EOK } from "../scripts/budget-pages.ts";
import { SITE } from "./helpers/site-root.mjs";
import { loadPage } from "./helpers/digest-page.mjs";
import { loadConversionPage } from "./helpers/conversion-page.mjs";
import { loadIndexPage } from "./helpers/index-page.mjs";

// 내 조건 기억 (#654 V5, #679 에서 nav.js 끝으로 옮김): nav.js 끝의 작은 묶음이 화면에서 고른 구·면적·예산을 적어 두고 메인 질문 링크에 붙인다.
const root = path.resolve(import.meta.dirname, "..");
const source = () => readFile(path.join(root, "docs/nav.js"), "utf8");
const QUESTION_IDS = ["q-budget", "q-realestate", "q-search", "q-floor", "q-record", "q-outlook", "q-conversion", "q-renewal", "q-switch", "q-cancelled"];

/** 구운 메인의 질문 링크 열 개(id → href). */
async function bakedHrefs() {
  const html = await readFile(path.join(root, SITE, "index.html"), "utf8");
  const block = /<nav class="question-nav(?: [^"]*)?"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return Object.fromEntries([...block.matchAll(/<a id="(q-[a-z]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]));
}

test("메인 질문 링크 열 개의 구운 주소는 그대로다 - 조건은 스크립트가 붙인다 (#654)", async () => {
  assert.deepEqual(await bakedHrefs(), {
    "q-budget": "./budget-10eok.html",
    "q-realestate": "./realestate.html",
    "q-search": "./deal-search.html",
    "q-floor": "./floor-gap.html",
    "q-record": "./record-high.html",
    "q-outlook": "./price-outlook.html",
    "q-conversion": "./jeonse-vs-wolse.html",
    "q-renewal": "./renewal-vs-new.html",
    "q-switch": "./switch-house.html",
    "q-cancelled": "./cancelled-deals.html",
  });
});

/** nav.js 를 가짜 문서에 올린다. 다른 묶음은 자리가 없어 바로 빠지고 조건 묶음만 돈다. */
async function run({ file = "index.html", search = "", saved, storage, referrer = "https://kyhsa93.github.io/jipgye/index.html" } = {}) {
  const items = new Map(saved === undefined ? [] : [["myConditions", JSON.stringify(saved)]]);
  const localStorage = storage ?? {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
  };
  const hrefs = {};
  const baked = await bakedHrefs();
  const links = new Map(
    QUESTION_IDS.map((id) => [
      id,
      {
        getAttribute: (name) => (name === "href" ? hrefs[id] ?? baked[id] : null),
        setAttribute: (name, value) => name === "href" && (hrefs[id] = value),
        closest: (sel) => (sel === "#question-nav" ? {} : null),
      },
    ])
  );
  const listeners = {};
  const on = (type, fn) => (listeners[type] ||= []).push(fn);
  const location = { origin: "https://kyhsa93.github.io", pathname: `/jipgye/${file}`, search, href: "" };
  vm.runInNewContext(await source(), {
    document: { referrer, querySelector: () => null, querySelectorAll: () => [], documentElement: { getAttribute: () => "ko" }, getElementById: (id) => (file === "index.html" ? links.get(id) ?? null : null), addEventListener: on },
    window: { localStorage, addEventListener: on },
    location,
    URLSearchParams,
  });
  const stored = () => (items.has("myConditions") ? JSON.parse(items.get("myConditions")) : undefined);
  const fire = (type, event = {}) => (listeners[type] ?? []).forEach((fn) => fn(event));
  return { hrefs, stored, fire, location };
}

test("적어 둔 조건이 없으면 메인 질문 링크는 구운 그대로다 (#654)", async () => {
  assert.deepEqual((await run()).hrefs, {});
  assert.deepEqual((await run({ saved: {} })).hrefs, {});
  assert.deepEqual((await run({ saved: { district: "성남시", area: "99", budget: "열" } })).hrefs, {}, "모르는 값으로 링크를 바꿨다");
  assert.deepEqual((await run({ saved: { district: "constructor", area: "toString", home: "__proto__" } })).hrefs, {}, "상속 속성 이름을 조건으로 받았다");
  assert.deepEqual((await run({ saved: [1, 2] })).hrefs, {});
});

test("적어 둔 구·면적·예산이 메인 질문 링크의 매개변수로 넘어간다 - 조건을 받는 다섯만 (#654)", async () => {
  const { hrefs } = await run({ saved: { district: "마포구", area: "60", budget: 12, home: "노원구" } });
  const enc = encodeURIComponent;
  assert.deepEqual(hrefs, {
    "q-budget": "./budget-12eok.html",
    "q-realestate": "./district-mapo.html?area=59",
    "q-search": `./deal-search.html?district=${enc("마포구")}&budget=12&area=60`,
    "q-conversion": `./jeonse-vs-wolse.html?district=${enc("마포구")}&band=under60`,
    "q-switch": `./switch-house.html?from=${enc("노원구")}&to=${enc("마포구")}`,
  });
});

test("일부 조건만 있으면 있는 것만 붙이고, 기본값과 같은 면적·범위 밖 예산은 붙이지 않는다 (#654)", async () => {
  const enc = encodeURIComponent;
  assert.deepEqual((await run({ saved: { area: "60-85", budget: 25 } })).hrefs, {
    "q-search": "./deal-search.html?budget=25&area=60-85",
    "q-conversion": "./jeonse-vs-wolse.html?band=60to85",
  });
  assert.deepEqual((await run({ saved: { district: "강남구", home: "강남구", area: "135" } })).hrefs, {
    "q-realestate": "./district-gangnam.html?area=114",
    "q-search": `./deal-search.html?district=${enc("강남구")}&area=135`,
    "q-conversion": `./jeonse-vs-wolse.html?district=${enc("강남구")}&band=over85`,
    "q-switch": `./switch-house.html?from=${enc("종로구")}&to=${enc("강남구")}`,
  });
  assert.deepEqual((await run({ saved: { home: "노원구" } })).hrefs, { "q-switch": `./switch-house.html?from=${enc("노원구")}` });
});

test("화면에 들어온 주소의 조건을 적는다 - 검색·다른 화면이 넘긴 것 (#654)", async () => {
  const enc = encodeURIComponent;
  const cases = [
    ["deal-search.html", `?district=${enc("강남구")}&budget=12&area=85-135&kind=jeonse`, { district: "강남구", area: "85-135", budget: 12 }],
    ["jeonse-vs-wolse.html", `?district=${enc("노원구")}&band=60to85&cash=2`, { district: "노원구", area: "60-85" }],
    ["switch-house.html", `?from=${enc("노원구")}&to=${enc("송파구")}`, { district: "송파구", home: "노원구" }],
    ["district-gangnam.html", "?area=114", { area: "85-135" }],
    ["realestate.html", "?area=59", { area: "60" }],
  ];
  for (const [file, search, want] of cases) {
    assert.deepEqual((await run({ file, search })).stored(), want, file);
  }
  assert.equal((await run({ file: "floor-gap.html", search: "?district=x" })).stored(), undefined, "조건이 없는 화면에서 적었다");
  assert.equal((await run({ file: "deal-search.html", search: `?district=${enc("성남시")}&budget=-1` })).stored(), undefined, "모르는 구·음수 예산을 적었다");
});

test("들어온 주소는 같은 사이트에서 왔을 때만 적는다 - 바깥 공유 링크가 내 조건을 덮지 않게 (#654)", async () => {
  const search = `?district=${encodeURIComponent("마포구")}&budget=9`;
  const saved = { district: "노원구", budget: 12 };
  for (const referrer of ["https://example.com/post", "", "https://kyhsa93.github.io.evil.com/x"]) {
    const page = await run({ file: "deal-search.html", search, saved, referrer });
    assert.deepEqual(page.stored(), saved, `참조 「${referrer}」 에서 온 주소로 내 조건을 덮었다`);
  }
  const same = await run({ file: "deal-search.html", search, saved, referrer: "https://kyhsa93.github.io/jipgye/index.html" });
  assert.deepEqual(same.stored(), { district: "마포구", budget: 9 }, "같은 사이트에서 넘긴 조건을 적지 않았다");
  // 바깥에서 왔어도 화면에서 고르면 적는다.
  const ext = await run({ file: "deal-search.html", search, referrer: "" });
  ext.fire("change", { target: {} });
  ext.fire("pagehide");
  assert.deepEqual(ext.stored(), { district: "마포구", budget: 9 });
});

test("화면이 기본값으로 채운 주소는 사람이 고르기 전에는 적지 않는다 (#654)", async () => {
  const page = await run({ file: "jeonse-vs-wolse.html" });
  page.location.search = `?district=${encodeURIComponent("종로구")}&band=under60`; // 화면 스크립트가 첫 구로 채운 주소
  page.fire("pagehide");
  assert.equal(page.stored(), undefined, "기본값을 내 조건으로 적었다");
  page.fire("change", { target: {} });
  page.fire("pagehide");
  assert.deepEqual(page.stored(), { district: "종로구", area: "60" });

  const chips = await run({ file: "deal-search.html" });
  chips.location.search = "?area=60-85";
  chips.fire("click", { target: { closest: (sel) => (sel === "[role=radio]" ? {} : null) } });
  chips.fire("pagehide");
  assert.deepEqual(chips.stored(), { area: "60-85" }, "칩을 눌러 고른 면적을 적지 않았다");
});

test("들어온 것만으로는 기본값을 적지 않는다 - 장 종류마다, 예산대 장은 주소가 없어도 (#654)", async () => {
  for (const file of ["index.html", "deal-search.html", "jeonse-vs-wolse.html", "switch-house.html", "realestate.html", "district-gangnam.html", "budget-10eok.html", "budget-7eok.html", "floor-gap.html"]) {
    const page = await run({ file });
    page.fire("pagehide");
    assert.equal(page.stored(), undefined, `${file}: 연 것만으로 적었다`);
  }
  // 저장 없는 첫 방문자가 메인 기본 링크(budget-10eok)로 갔다 와도 실거래 찾기가 좁혀지지 않는다.
  const first = await run({ file: "budget-10eok.html" });
  assert.equal(first.stored(), undefined, "메인 기본 예산대 링크를 내 예산으로 적었다");
  assert.deepEqual((await run({ saved: first.stored() })).hrefs, {});
  // 예산대 장에서 무언가 고른 뒤에는 적는다.
  const chose = await run({ file: "budget-7eok.html" });
  chose.fire("change", { target: {} });
  chose.fire("pagehide");
  assert.deepEqual(chose.stored(), { budget: 7 });
  const gu = await run({ file: "district-gangnam.html" });
  gu.location.search = "?area=59";
  gu.fire("change", { target: {} });
  gu.fire("pagehide");
  assert.deepEqual(gu.stored(), { district: "강남구", area: "60" });
});

test("저장소가 막혀도 링크는 구운 그대로이고 화면은 멈추지 않는다 (#654)", async () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual((await run({ storage: blocked })).hrefs, {});
  await run({ file: "deal-search.html", search: "?budget=9", storage: blocked });
  const quota = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  const page = await run({ file: "jeonse-vs-wolse.html", search: "?band=under60", storage: quota });
  page.fire("change", { target: {} });
  assert.doesNotThrow(() => page.fire("pagehide"), "저장 실패가 pagehide 밖으로 샜다");
  const broken = { getItem: () => "{not json", setItem() {} };
  assert.deepEqual((await run({ storage: broken })).hrefs, {});
});

test("조건 묶음의 표는 사이트 목록과 같다 - 자치구 이름·예산대 장·면적 구간 (#654)", async () => {
  const js = await source();
  const slugs = JSON.parse(JSON.stringify(vm.runInNewContext(`(${/const SLUGS = (\{[^}]+\});/.exec(js)[1]})`)));
  assert.deepEqual(slugs, DISTRICT_SLUGS, "nav.js 의 자치구 slug 가 scripts/district-slugs.ts 와 갈라졌다");
  assert.match(js, /b >= (\d+) && b <= (\d+)/);
  const [, lo, hi] = /b >= (\d+) && b <= (\d+)/.exec(js);
  assert.deepEqual([+lo, +hi], [Math.min(...BUDGET_PAGE_EOK), Math.max(...BUDGET_PAGE_EOK)], "예산대 장 범위와 다르다");

  const deal = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
  const areaKeys = [.../const AREA_BUCKETS = \[([\s\S]*?)\];/.exec(deal)[1].matchAll(/key: "([^"]+)"/g)].map((m) => m[1]);
  const band = vm.runInNewContext(`(${/const BAND = (\{[^}]+\});/.exec(js)[1]})`);
  const m2 = vm.runInNewContext(`(${/const M2 = (\{[^}]+\});/.exec(js)[1]})`);
  assert.deepEqual(Object.keys(band).sort(), [...areaKeys].sort(), "면적 열쇠가 deal-search 구간과 다르다");
  assert.deepEqual(Object.keys(m2).sort(), [...areaKeys].sort());
  const conversion = JSON.parse(await readFile(path.join(root, "docs/data/conversion.json"), "utf8"));
  for (const key of Object.values(band)) assert.ok(conversion.bands.some((b) => b.key === key), `전세 vs 월세에 없는 구간 ${key}`);
  const realestate = await readFile(path.join(root, "docs/realestate.html"), "utf8");
  const options = JSON.parse(/const AREA_OPTIONS = (\[[^\]]+\]);/.exec(realestate)[1]);
  for (const value of Object.values(m2)) assert.ok(options.includes(value), `자치구 장에 없는 면적 ${value}`);
  assert.match(realestate, /const DEFAULT_AREA_M2 = 84;/, "기본 면적(붙이지 않는 값)이 바뀌었다");

  // 넘어가는 장이 모두 있다.
  const files = new Set(await readdir(path.join(root, SITE)));
  for (const slug of Object.values(DISTRICT_SLUGS)) assert.ok(files.has(`district-${slug}.html`), slug);
  for (const eok of BUDGET_PAGE_EOK) assert.ok(files.has(`budget-${eok}eok.html`), String(eok));
});

// 도착 화면이 넘겨받은 조건으로 답을 낸다 - 저장소의 실제 데이터로(#654 완료 조건 1의 스크립트 측정 몫).
test("갈아타기 링크는 갈 구와 다른 구를 견주고 답 문장을 낸다 - 지금 사는 구를 몰라도 (#654)", async () => {
  const data = JSON.parse(await readFile(path.join(root, "docs/data/district-change.json"), "utf8"));
  const codeOf = (name) => data.rows.find((r) => r.name === name)?.code;
  for (const saved of [{ district: "종로구" }, { district: "마포구" }, { district: "송파구", home: "노원구" }]) {
    const href = (await run({ saved })).hrefs["q-switch"];
    const page = await loadPage({ file: "switch-house.html", data: { "district-change": data }, query: href.slice(href.indexOf("?")) });
    await page.settle();
    const [from, to] = [page.byId("from-select").value, page.byId("to-select").value];
    assert.equal(to, codeOf(saved.district), `${saved.district}: 갈 구를 안 읽었다 (${href})`);
    assert.notEqual(from, to, `${saved.district}: 같은 구끼리 견줬다`);
    if (saved.home) assert.equal(from, codeOf(saved.home));
    assert.ok(page.text("compare-result") || page.text("compare-answer"), `${saved.district}: 답 문장이 없다`);
  }
});

test("전세 vs 월세 링크는 넘긴 구·면적으로 답을 낸다 (#654)", async () => {
  const conversion = JSON.parse(await readFile(path.join(root, "docs/data/conversion.json"), "utf8"));
  const { district, band } = conversion.cells.find((c) => c.district !== conversion.cells[0].district);
  const area = { under60: "60", "60to85": "60-85", over85: "85-135" }[band];
  const href = (await run({ saved: { district, area } })).hrefs["q-conversion"];
  const page = await loadConversionPage({ conversion, query: href.slice(href.indexOf("?")) });
  await page.settle();
  const params = new URLSearchParams(page.sandbox.location.search);
  assert.deepEqual([params.get("district"), params.get("band")], [district, band], `넘긴 조건을 기본값으로 덮었다 (${href})`);
  assert.match(String(page.resultHtml()), /월/, "답이 비었다");
});

// 메인 「이번 주 신고된 값」 표의 내 구 (#718 K1): 적어 둔 구가 접힌 표 밖이면 마지막 줄 자리에 바꿔 보이고 「내 구」 표지가 붙는다.
// 합성 표(구 일곱, 매매 평당가 내림차순 = 처음 보이는 네 구가 정해져 있다)로 돈다 - 실제 데이터의 순위에 기대지 않는다.
const SEVEN = ["종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구"];
const TOP4 = SEVEN.slice(0, 4);
const metric = (n) => ({ sale: { avgPricePerPyeong10k: n, transactionCount: 30 }, jeonse: { avgDepositPerPyeong10k: n / 2, transactionCount: 30 }, wolse: { avgDeposit10k: n, avgMonthlyRent10k: 100, transactionCount: 30 } });
const synthetic = () => ({
  updatedAt: "2026-10-26T00:00:00.000Z",
  window: { basis: "contract", from: "2026-09-28", to: "2026-10-25", districtFrom: "2026-09-28", weeks: 4 },
  overall: metric(5000),
  districts: SEVEN.map((name, i) => ({ code: String(11110 + i), name, ...metric(9000 - i * 500) })),
});

async function mainTable({ saved, lang, mutate } = {}) {
  const storage = { ...(saved === undefined ? {} : { myConditions: typeof saved === "string" ? saved : JSON.stringify(saved) }), ...(lang ? { lang } : {}) };
  const p = await loadIndexPage({
    storage,
    mutate,
    fetch: async (url) => (/\/realestate\.json/.test(String(url)) ? { ok: true, json: async () => synthetic() } : { ok: false, json: async () => ({}) }),
  });
  const rows = () => p.app.document.querySelectorAll("#realestate-grid tr[data-district-name]");
  const names = () => rows().filter((r) => !r.hidden).map((r) => r.getAttribute("data-district-name"));
  const labelled = () => [...String(p.byId("realestate-grid").innerHTML).matchAll(/<tr[^>]*data-district-name="([^"]*)"[^>]*>\s*<td>[^<]*<span class="tx-count">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
  const showMore = () => p.byId("realestate-show-more").dispatch("click", { target: { id: "realestate-show-more-button" } });
  return { p, names, labelled, showMore, count: () => rows().length };
}

test("적어 둔 구가 없거나 이상한 값이면 표는 지금 그대로다 - 위 네 구, 표지 없음 (#718)", async () => {
  for (const saved of [undefined, {}, { district: 7 }, { district: "" }, { district: "성남시" }, { district: "constructor" }, [1, 2], "{not json", "null", { area: "60" }]) {
    const t = await mainTable({ saved });
    assert.deepEqual(t.names(), TOP4, `저장값 ${JSON.stringify(saved)} 에서 표가 바뀌었다`);
    assert.deepEqual(t.labelled(), [], `저장값 ${JSON.stringify(saved)} 에서 표지가 붙었다`);
  }
});

test("접힌 표 밖의 구는 마지막 줄 자리에 바뀌어 보이고 「내 구」 표지가 붙는다 - 줄 수는 그대로 (#718)", async () => {
  const t = await mainTable({ saved: { district: "중랑구" } });
  assert.deepEqual(t.names(), ["종로구", "중구", "용산구", "중랑구"], "넷째 줄이 내 구로 바뀌지 않았다");
  assert.equal(t.names().length, TOP4.length, "줄 수가 바뀌었다(CLS)");
  assert.deepEqual(t.labelled(), [["중랑구", "내 구"]]);
  // 더 보기 문구는 그대로: 보이는 수가 같으니 남은 수도 같다.
  assert.match(t.p.byId("realestate-show-more").innerHTML, new RegExp(`${SEVEN.length - 4}`));
  assert.deepEqual((await mainTable({ saved: { district: "광진구" } })).names(), ["종로구", "중구", "용산구", "광진구"]);
});

test("내 구가 이미 위 네 구에 있으면 줄은 그대로고 표지만 붙는다 (#718)", async () => {
  const t = await mainTable({ saved: { district: "중구" } });
  assert.deepEqual(t.names(), TOP4);
  assert.deepEqual(t.labelled(), [["중구", "내 구"]]);
});

test("더 보기·검색·정렬은 그대로다 - 펼치면 전부, 검색하면 일치만, 접으면 다시 바꿔 보인다 (#718)", async () => {
  const t = await mainTable({ saved: { district: "중랑구" } });
  t.showMore();
  assert.deepEqual(t.names(), SEVEN, "펼쳤는데 전부 보이지 않는다");
  t.showMore();
  assert.deepEqual(t.names(), ["종로구", "중구", "용산구", "중랑구"], "접었는데 내 구 자리가 돌아오지 않았다");

  const input = t.p.byId("realestate-search-input");
  input.value = "성동";
  input.dispatch("input");
  assert.deepEqual(t.names(), ["성동구"], "검색이 내 구 때문에 흐트러졌다");
  input.value = "";
  input.dispatch("input");
  assert.deepEqual(t.names(), ["종로구", "중구", "용산구", "중랑구"]);
  assert.equal(t.count(), SEVEN.length, "받은 구가 DOM에 다 있어야 검색이 된다");

  // 매매 열을 한 번 더 누르면 오름차순(중랑·동대문·광진·성동·용산·중·종로): 위 넷은 바뀌고, 내 구(중랑구)는 이미 그 안이라 표지만.
  const sortSale = (page) => page.p.app.document.querySelector(".realestate-table thead").dispatch("click", { target: { closest: () => ({ dataset: { reSort: "sale" } }) } });
  sortSale(t);
  assert.deepEqual(t.names(), ["중랑구", "동대문구", "광진구", "성동구"]);
  assert.deepEqual(t.labelled(), [["중랑구", "내 구"]]);
  const other = await mainTable({ saved: { district: "중구" } });
  sortSale(other);
  assert.deepEqual(other.names(),["중랑구", "동대문구", "광진구", "중구"], "정렬이 바뀐 뒤에도 마지막 줄 자리에 바꿔 보여야 한다");
});

test("저장소 접근 자체가 던져도(사생활 보호 창·사이트 데이터 차단) 메인 스크립트가 끝까지 돌아 표를 그린다 (#726)", async () => {
  const blocked = (script) => `Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("SecurityError"); } });\n${script}`;
  const t = await mainTable({ mutate: blocked, saved: { district: "중랑구" } });
  assert.deepEqual(t.names(), TOP4, "저장소가 던질 때 표가 그려지지 않았다");
  assert.deepEqual(t.labelled(), []);
  // 테마 단추를 눌러도(쓰기) 멈추지 않는다.
  t.p.byId("theme-toggle").dispatch("click");
});

test("모든 장·nav.js·시세 틀의 localStorage 접근은 try 안에 있다 - 저장소가 던져도 다른 장 스크립트가 끝까지 돈다 (#726)", async () => {
  const files = [...(await readdir(path.join(root, "docs"))).filter((f) => /\.(html|js)$/.test(f)).map((f) => `docs/${f}`), "scripts/realestate-template.html"];
  for (const f of files) {
    const lines = (await readFile(path.join(root, f), "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (!/localStorage\.|=\s*(window\.)?localStorage\s*;/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      assert.ok(/try \{/.test(line) || /try \{\s*$/.test(lines[i - 1] ?? ""), `${f}:${i + 1}: try 밖의 localStorage 접근 - ${line.trim()}`);
    });
  }
});

test("영어 화면도 같다 - 표지만 영어다 (#718)", async () => {
  const t = await mainTable({ saved: { district: "중랑구" }, lang: "en" });
  assert.equal(t.names().at(-1), "중랑구");
  assert.deepEqual(t.labelled(), [["중랑구", "My district"]]);
});

test("저장소가 막혀도 표는 그대로 그려지고, 메인은 저장값을 적지 않는다 (#718)", async () => {
  // 내 조건 키만 던지게 한다(저장소 전체가 던지는 경우는 아래 #726 시험).
  const blocked = (script) => `const __ls = globalThis.localStorage; globalThis.localStorage = { ...__ls, getItem: (k) => { if (k === "myConditions") throw new Error("blocked"); return __ls.getItem(k); } };\n${script}`;
  const t = await mainTable({ mutate: blocked, saved: { district: "중랑구" } });
  assert.deepEqual(t.names(), TOP4);
  assert.deepEqual(t.labelled(), []);
  // 읽기만 한다 - 열고 떠나도 저장값은 그대로다(들어온 것만으로는 적지 않는다, #654).
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  assert.ok(!/setItem\(\s*["']myConditions/.test(html), "메인이 myConditions 를 적는다");
  const same = await mainTable({ saved: { district: "중랑구", area: "60" } });
  same.p.fire("window", "pagehide");
  assert.deepEqual(JSON.parse(same.p.app.localStorage.getItem("myConditions")), { district: "중랑구", area: "60" }, "메인이 저장값을 바꿨다");
});
