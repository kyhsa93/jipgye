import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

// faithful: 구운 조각 자리(#296)는 실제 DOM 처럼 textContent 를 쓰면 안쪽 마크업이 글자로 바뀌고, 읽으면 마크업을 걷은 글자가 나온다.
function stubElement(faithful = false) {
  const listeners = {};
  const base = {
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
  };
  if (faithful) {
    let html = "";
    delete base.innerHTML;
    delete base.textContent;
    Object.defineProperties(base, {
      innerHTML: { get: () => html, set: (v) => void (html = String(v)), enumerable: true },
      textContent: { get: () => html.replace(/<[^>]*>/g, ""), set: (v) => void (html = String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])), enumerable: true },
    });
  }
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : () => {}),
    set: (t, p, v) => ((t[p] = v), true),
  });
}

// 구운 조각이 든 자리(#296). 빌드가 docs/index.html 에 구운 글자를 그대로 심어, 실패해도 그 글자가 남는지 본다.
// #575 PR2: 시장 지표 표 → 값 한 줄(market-line), 요약·뉴스 다섯 건 → 뉴스 화면으로 가는 한 줄(news-link-row).
const BAKED_SPOTS = { "market-line": "market", "realestate-grid": "realestate", "news-link-row": "news" };

export async function loadIndexPage({ analytics, fetch: fetchImpl, search = "", serviceWorker, storage, baked = false, mutate } = {}) {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const script0 = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script0.includes("hasEnoughSample"), "렌더링 스크립트를 찾지 못했다");
  const script = mutate ? mutate(script0) : script0;

  const store = { ...storage };
  const observed = [];
  const byId = new Map();
  const bakedHtml = {};
  if (baked) {
    for (const [id, name] of Object.entries(BAKED_SPOTS)) {
      const fragment = html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1] ?? "";
      assert.ok(fragment, `docs/index.html 에 구운 ${name} 조각이 없다`);
      const el = stubElement(true);
      el.innerHTML = bakedHtml[id] = fragment;
      byId.set(id, el);
    }
    const stamp = html.match(/<div class="updated" id="updated" data-updated="([^"]*)">([^<]*)<\/div>/);
    assert.ok(stamp, "docs/index.html 의 구운 기준일 줄을 못 찾았다");
    const el = stubElement();
    el.textContent = bakedHtml.updatedText = stamp[2];
    el.getAttribute = (name) => (name === "data-updated" ? stamp[1] : null);
    bakedHtml.day = stamp[1];
    byId.set("updated", el);
  }
  const listeners = { window: {}, document: {} };
  const reloads = [];
  const replaced = [];

  const listen = (where) => (type, fn) => (listeners[where][type] ||= []).push(fn);
  const fire = (where, type, event = {}) => {
    for (const fn of listeners[where][type] ?? []) fn(event);
  };

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: fetchImpl ?? (async () => ({ ok: false, json: async () => ({}) })),
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: "ko", ...(serviceWorker ? { serviceWorker } : {}) },
    location: {
      search,
      origin: "https://x",
      pathname: "/",
      href: "https://x/",
      reload: () => reloads.push(true),
      replace: (url) => replaced.push(url),
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: listen("window"),
    removeEventListener() {},
    history: { pushState() {}, replaceState() {} },
    IntersectionObserver: class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        observed.push(this);
        this.targets = [];
        this.active = new Set();
      }
      observe(el) {
        this.targets.push(el);
        this.active.add(el);
      }
      unobserve(el) {
        this.active.delete(el);
      }
      disconnect() {
        this.active.clear();
      }
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement());
        return byId.get(id);
      },
      querySelectorAll: (sel) => {
        const m = /^#([\w-]+) tr\[data-([\w-]+)\]$/.exec(String(sel));
        if (!m) return [];
        const parent = byId.get(m[1]);
        if (!parent) return [];

        const html = String(parent.innerHTML ?? "");
        if (parent._rowsHtml !== html) {
          const attr = `data-${m[2]}`;
          const re = new RegExp(`<tr[^>]*${attr}="([^"]*)"`, "g");
          parent._rowsHtml = html;
          parent._rows = [...html.matchAll(re)].map(([, value]) => {
            const row = stubElement();
            row.getAttribute = (name) => (name === attr ? value : null);
            return row;
          });
        }
        return parent._rows;
      },
      querySelector: (sel) => {
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
      createElement: () => stubElement(),
      addEventListener: listen("document"),
      visibilityState: "visible",
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
  new vm.Script(script + "\nglobalThis.__cache = cache; globalThis.__realestateSort = realestateSort;", { filename: "docs/index.html:inline" }).runInContext(sandbox);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    baked: bakedHtml,
    fire,
    reloads: () => reloads.length,
    replaced: () => [...replaced],
    byId: (id) => sandbox.document.getElementById(id),
    scrollTo: (index) => {
      const observer = observed[0];
      assert.ok(observer, "섹션 관찰이 걸리지 않았다");
      const target = observer.targets[index];
      if (!target || !observer.active.has(target)) return false;
      observer.callback([{ target, isIntersecting: true }]);
      return true;
    },
    observer: () => {
      assert.ok(observed[0], "섹션 관찰이 걸리지 않았다");
      return observed[0];
    },
    observerCount: () => observed.length,
    observedCount: () => observed[0]?.targets.length ?? 0,
  };
}
