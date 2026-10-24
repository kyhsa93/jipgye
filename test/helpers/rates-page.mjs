import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { SITE } from "./site-root.mjs";

const root = path.resolve(import.meta.dirname, "../..");

function makeDom(html = "") {
  const byId = new Map();

  function makeNode(id) {
    const node = {
      id,
      children: [],
      listeners: {},
      dataset: {},
      textContent: "",
      value: "",
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      },
      removeEventListener() {},
      // 화면 스크립트가 쓴 속성을 남긴다(영어 모드에서 meta[name=description]에 무엇이 들어가는지 읽는다, #337).
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      removeAttribute() {},
      getAttribute: () => null,
      appendChild(child) {
        this.children.push(child);
      },
      closest(sel) {
        const key = /\[data-([a-z]+)\]/.exec(sel)?.[1];
        return key && this.dataset[key] !== undefined ? this : null;
      },
      querySelectorAll: (sel) => collect(node, sel),
      querySelector: (sel) => collect(node, sel)[0] ?? null,
      focus() {},
      getBoundingClientRect: () => ({ width: 600, height: 300, top: 0, left: 0 }),
      dispatch(type, extra = {}) {
        for (const fn of this.listeners[type] ?? []) fn({ target: this, ...extra });
      },
      get innerHTML() {
        return this._html ?? "";
      },
      set innerHTML(html) {
        this._html = html;
        this.children = [...String(html).matchAll(/data-(category|detail|sort)="([^"]*)"/g)].map((m) => {
          const child = makeNode(`${this.id}>${m[2]}`);
          child.dataset[m[1]] = m[2];
          return child;
        });
      },
    };
    return node;
  }

  function collect(node, sel) {
    const key = /\[data-([a-z]+)\]/.exec(sel)?.[1] ?? null;
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (!key || c.dataset[key] !== undefined) out.push(c);
        walk(c);
      }
    };
    if (node) walk(node);
    return out;
  }

  const document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeNode(id));
      return byId.get(id);
    },
    querySelectorAll(sel) {
      const all = [];
      for (const node of byId.values()) all.push(...collect(node, sel));
      return all;
    },
    querySelector(sel) {
      if (!byId.has(sel)) {
        const node = makeNode(sel);
        if (sel === 'meta[name="rates-category"]') {
          const value = /<meta name="rates-category" content="([^"]*)"/.exec(html)?.[1] ?? null;
          node.getAttribute = (name) => (name === "content" ? value : null);
        }
        byId.set(sel, node);
      }
      return byId.get(sel);
    },
    createElement: (tag) => makeNode(tag),
    createTextNode: () => makeNode("#text"),
    addEventListener() {},
    documentElement: makeNode("html"),
    body: makeNode("body"),
    head: makeNode("head"),
    title: "",
  };
  return { document, byId };
}

const between = (html, open, close) => {
  const a = html.indexOf(open);
  assert.ok(a >= 0, `${open} 를 못 찾았다`);
  return html.slice(a + open.length, html.indexOf(close, a + open.length));
};

/**
 * 금리 틀(scripts/rates-template.html)로 찍은 장(`file`)의 인라인 스크립트를 손으로 만든 DOM 에서 돌린다.
 *
 * - `baked`: true 면 받은 HTML 에 구워진 자리(#products-head·#products-body·#history-grid)를 그 글자 그대로 채워 둔다. 스크립트가 구운 내용을
 *   건드렸는지 보려면 이것이 있어야 한다(#296 틀 (마)). 구운 기준일 줄(#updated 의 글자·data-updated)은 늘 채운다.
 * - `mutate`: 스크립트 본문을 바꿔 끼우는 함수(변이 증빙용).
 * - `baked` 결과: 구운 글자(head·body·grid·updatedText·day). `notice()`: #content 안 알림 한 줄의 글자·단추 글자·단추, 없으면 null.
 */
export async function loadRatesPage({
  analytics,
  fetch: fetchImpl,
  file = `${SITE}/deposit-rates.html`,
  search = "",
  rates: ratesOverride,
  locale = "ko",
  baked = false,
  mutate,
} = {}) {
  const html = await readFile(path.join(root, file), "utf8");
  const script0 = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script0.includes("CATEGORY_KEYS"), "금리 페이지 스크립트를 찾지 못했다");
  const script = mutate ? mutate(script0) : script0;

  const rates =
    ratesOverride ?? JSON.parse(await readFile(path.join(root, "docs/data/rates.json"), "utf8"));
  const history = JSON.parse(await readFile(path.join(root, "docs/data/rates-history.json"), "utf8"));
  const { document, byId } = makeDom(html);
  const store = { lang: locale };

  // 구운 기준일 줄: 글자와 data-updated 는 늘 있다.
  const stamp = /<div class="updated" id="updated" data-updated="([^"]*)">([^<]*)<\/div>/.exec(html);
  assert.ok(stamp, `${file} 의 구운 기준일 줄을 못 찾았다`);
  const updated = document.getElementById("updated");
  updated.dataset.updated = stamp[1];
  updated.getAttribute = (name) => (name === "data-updated" ? stamp[1] : null);
  updated.textContent = stamp[2];
  const bakedHtml = { day: stamp[1], updatedText: stamp[2] };
  if (baked) {
    bakedHtml.head = between(html, '<thead id="products-head">', "</thead>");
    bakedHtml.body = between(html, '<tbody id="products-body">', "</tbody>");
    bakedHtml.grid = between(html, '<div class="history-grid" id="history-grid">', "\n    </div>\n  </section>");
    document.getElementById("products-head").innerHTML = bakedHtml.head;
    document.getElementById("products-body").innerHTML = bakedHtml.body;
    document.getElementById("history-grid").innerHTML = bakedHtml.grid;
  }
  // #content 는 실제 DOM 처럼 textContent = "" 가 안의 마크업을 비운다(성공한 다시 받기가 알림을 걷는 길).
  const content = document.getElementById("content");
  Object.defineProperty(content, "textContent", {
    get: () => "",
    set: () => {
      content._html = "";
    },
  });

  const pushed = [];
  const replaced = [];
  function applyUrl(url) {
    const [pathname, query = ""] = String(url).split("?");
    sandbox.location.pathname = pathname;
    sandbox.location.search = query ? `?${query}` : "";
    sandbox.location.href = `https://x${pathname}${query ? `?${query}` : ""}`;
  }

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    fetch:
      fetchImpl ??
      (async (url) => ({
        ok: true,
        json: async () => (String(url).includes("rates-history") ? history : rates),
      })),
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: locale },
    location: { search, origin: "https://x", pathname: "/", href: `https://x/${search}` },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_state, _title, url) {
        pushed.push(url);
        applyUrl(url);
      },
      replaceState(_state, _title, url) {
        replaced.push(url);
        applyUrl(url);
      },
    },
    document,
  };
  if (analytics) sandbox.analytics = analytics;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // 페이지가 <script src="./load-state.js">로 먼저 받는 공용 로드 실패 규칙.
  const loadState = await readFile(path.join(root, "docs/load-state.js"), "utf8");
  new vm.Script(loadState, { filename: "docs/load-state.js" }).runInContext(sandbox);
  new vm.Script(script + "\nglobalThis.__state = state;", { filename: "docs/rates.html:inline" }).runInContext(sandbox);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const clickTab = (category) => {
    const tabs = byId.get("tabs");
    const tab = tabs.children.find((c) => c.dataset.category === category);
    assert.ok(tab, `${category} 탭이 없다`);
    if ((tab.listeners.click ?? []).length > 0) tab.dispatch("click");
    else for (const fn of tabs.listeners.click ?? []) fn({ target: tab });
  };

  const clickSortHeader = (key) => {
    const head = byId.get("products-head");
    const button = head.children.find((c) => c.dataset.sort === key);
    assert.ok(button, `${key} 정렬 머리글이 없다`);
    if ((button.listeners.click ?? []).length > 0) button.dispatch("click");
    else for (const fn of head.listeners.click ?? []) fn({ target: button });
  };

  const notice = () => {
    const html = content.innerHTML;
    if (!html) return null;
    const button = byId.get("load-retry");
    return { html, text: html.replace(/<button[\s\S]*<\/button>/, "").replace(/<[^>]*>/g, "").trim(), retry: /<button[^>]*>([^<]*)<\/button>/.exec(html)?.[1] ?? null, button };
  };

  return { sandbox, byId, clickTab, clickSortHeader, rates, state: sandbox.__state, pushed, replaced, baked: bakedHtml, notice };
}
