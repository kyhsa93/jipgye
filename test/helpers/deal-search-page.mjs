import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { DISTRICT_SLUGS } from "../../scripts/district-slugs.mjs";

const root = path.resolve(import.meta.dirname, "../..");

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function stubElement(attrs = {}, id = "") {
  const listeners = {};
  const base = {
    id,
    listeners,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    dispatch(type, extra = {}) {
      for (const fn of listeners[type] ?? []) fn({ target: this, ...extra });
    },
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute() {},
  };
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : () => {}),
    set: (t, p, v) => ((t[p] = v), true),
  });
}

export async function loadDealSearchPage({
  budget,
  search,
  deals,
  rents,
  rentPreview,
  complexPrices,
  status = 404,
  // 실패 주입 손잡이: network.failComplexPrice를 켜면 단지 가격 fetch가 거부된다. failDeals/failRents는
  // 최근 두 달 거래(deals-*)·전월세(rents-*) 목록을 거부한다(#196). 시험이 도중에 끌 수 있다.
  network = { failComplexPrice: false, failDeals: false, failRents: false },
  locale = "ko",
  query = "",
  analytics,
} = {}) {
  const html = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();

  const store = { lang: locale };
  const byId = new Map();
  const data = { "budget-deals": budget, "deal-search": search, "rent-preview": rentPreview };

  for (const [name, file] of Object.entries(deals ?? {})) {
    data[`deals-${DISTRICT_SLUGS[name] ?? name}`] = file;
  }

  for (const [name, file] of Object.entries(rents ?? {})) {
    data[`rents-${DISTRICT_SLUGS[name] ?? name}`] = file;
  }

  for (const [name, file] of Object.entries(complexPrices ?? {})) {
    data[`complex-price-${DISTRICT_SLUGS[name] ?? name}`] = file;
  }

  const navLinks = ["all", "sale", "jeonse", "wolse", "search"].map((page) =>
    stubElement({ "data-re-page": page })
  );

  function applyUrl(url) {
    const [pathname, q = ""] = String(url).split("?");
    sandbox.location.pathname = pathname;
    sandbox.location.search = q ? `?${q}` : "";
    sandbox.location.href = `https://x${pathname}${q ? `?${q}` : ""}`;
  }

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams, Promise,
    setTimeout, clearTimeout,
    fetch: async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      // 단지 가격 파일만 네트워크 오류로 거부한다(#174 실패 주입). 나머지는 그대로.
      if (network.failComplexPrice && String(name).startsWith("complex-price-")) throw new TypeError("network down");
      if (network.failDeals && String(name).startsWith("deals-")) throw new TypeError("network down");
      if (network.failRents && String(name).startsWith("rents-")) throw new TypeError("network down");
      const body = data[name];
      if (!body) return { ok: false, status, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    },
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: locale },
    location: { search: query, origin: "https://x", pathname: "/deal-search.html", href: `https://x/deal-search.html${query}` },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_state, _title, url) {
        applyUrl(url);
      },
      replaceState(_state, _title, url) {
        applyUrl(url);
      },
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement({}, id));
        return byId.get(id);
      },
      querySelector: (sel) => {
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
      querySelectorAll: (sel) => (sel === "[data-re-page]" ? navLinks : []),
      createElement: () => stubElement(),
      addEventListener() {},
      documentElement: stubElement(),
      body: stubElement(),
      head: stubElement(),
      title: "",
    },
  };
  if (analytics) sandbox.analytics = analytics;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const loadState = await readFile(path.join(root, "docs/load-state.js"), "utf8");
  new vm.Script(loadState, { filename: "docs/load-state.js" }).runInContext(sandbox);
  new vm.Script(script, { filename: "docs/deal-search.html:inline" }).runInContext(sandbox);

  await settle();

  const dispatch = (id, type, mutate) => {
    const el = sandbox.document.getElementById(id);
    mutate(el);
    sandbox.document.getElementById("search-controls").dispatch(type, { target: el });
    return settle();
  };

  const select = (id, value) => dispatch(id, "change", (el) => (el.value = value));

  // 칩은 셀렉트가 아니다. 눌린 칩을 흉내 내 클릭을 흘려보낸다.
  const chip = (field, value) => {
    const target = { dataset: { filter: field, value: String(value) }, closest: () => target };
    sandbox.document.getElementById("search-controls").dispatch("click", { target });
    return settle();
  };
  const chipHtml = (field) => sandbox.document.getElementById(`${field}-chips`).innerHTML;

  return {
    sandbox,
    navLinks,
    settle,
    byId: (id) => sandbox.document.getElementById(id),
    resultHtml: () => sandbox.document.getElementById("search-result").innerHTML,
    districtOptions: () => sandbox.document.getElementById("district-select").innerHTML,
    budgetOptions: () => sandbox.document.getElementById("budget-select").innerHTML,
    areaOptions: () => chipHtml("area"),
    ageOptions: () => chipHtml("age"),
    chooseDistrict: (value) => select("district-select", value),
    chooseBudget: (value) => select("budget-select", value),
    chooseArea: (value) => chip("area", value),
    chooseAge: (value) => chip("age", value),
    typeApt: (value) => dispatch("apt-input", "input", (el) => (el.value = value)),
    toggleDirect: (checked) => dispatch("direct-check", "change", (el) => (el.checked = checked)),
    resetFilters: () => {
      const target = { id: "reset-filters" };
      sandbox.document.getElementById("search-controls").dispatch("click", { target });
      return settle();
    },
    kindOptions: () => chipHtml("kind"),
    depositOptions: () => chipHtml("deposit"),
    rentOptions: () => chipHtml("rent"),
    chooseKind: (value) => chip("kind", value),
    chooseDeposit: (value) => chip("deposit", value),
    chooseRent: (value) => chip("rent", value),
    fieldHidden: (id) => sandbox.document.getElementById(id).hidden,
  };
}
