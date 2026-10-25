import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "../..");

function stubElement(attrs = {}) {
  const listeners = {};
  const base = {
    listeners,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    dispatch(type, extra = {}) {
      for (const fn of listeners[type] ?? []) fn({ target: this, currentTarget: this, ...extra });
    },
    textContent: "",
    innerHTML: "",
    hidden: false,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute() {},
    remove() {},
  };
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : () => {}),
    set: (t, p, v) => ((t[p] = v), true),
  });
}

const between = (html, open, close) => {
  const a = html.indexOf(open);
  assert.ok(a >= 0, `${open} 를 못 찾았다`);
  return html.slice(a + open.length, html.indexOf(close, a + open.length));
};

/**
 * 뉴스 틀(docs/news.html)이나 그 틀로 찍은 장(`file`)의 인라인 스크립트를 손으로 만든 DOM 에서 돌린다.
 *
 * - `fetch`: 데이터 요청에 답하는 함수. 없으면 `news`·`summary` 인자로 답한다(없는 파일은 404).
 * - `baked`: true 면 받은 HTML 에 이미 구워진 자리(#news-list·#summary-box·#realestate-stats(+구획의 hidden)·#updated·data-updated)를
 *   그 글자 그대로 채워 둔다. 스크립트가 구운 내용을 건드렸는지 보려면 이것이 있어야 한다(#296 틀 (나)).
 * - `mutate`: 스크립트 본문을 바꿔 끼우는 함수(변이 증빙용).
 * - `notice()`: 실패 알림(#content 안 한 줄)의 글자·단추 글자·단추. 없으면 null.
 */
export async function loadNewsPage({ news, summary, category = null, locale = "ko", analytics, file = "docs/news.html", fetch: fetchImpl, baked = false, mutate, search = "", history } = {}) {
  const html = await readFile(path.join(root, file), "utf8");
  const script0 = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  const script = mutate ? mutate(script0) : script0;

  const store = { lang: locale };
  const byId = new Map();
  const data = { news, summary, "news-history": history?.news, "summary-history": history?.summary };
  const bakedHtml = {};
  if (baked) {
    const spots = {
      "news-list": between(html, '<ul class="news-list" id="news-list">', "</ul>"),
      "summary-box": between(html, '<div class="summary-box" id="summary-box">', "</div>\n  </section>"),
      "realestate-stats": between(html, '<div class="stat-cards" id="realestate-stats">', "</div>\n    <div"),
    };
    for (const [id, inner] of Object.entries(spots)) {
      const el = stubElement();
      el.innerHTML = bakedHtml[id] = inner;
      byId.set(id, el);
    }
    const section = stubElement();
    section.hidden = bakedHtml.statsHidden = /id="realestate-stats-section" hidden>/.test(html);
    byId.set("realestate-stats-section", section);
    const stamp = html.match(/<div class="updated" id="updated" data-updated="([^"]*)">([^<]*)<\/div>/);
    assert.ok(stamp, `${file} 의 구운 기준일 줄을 못 찾았다`);
    const updated = stubElement({ "data-updated": stamp[1] });
    updated.textContent = bakedHtml.updatedText = stamp[2];
    bakedHtml.day = stamp[1];
    byId.set("updated", updated);
  }
  // #content 에 쓴 알림 마크업을 실제 DOM 처럼 다룬다: 쓰면 그 안의 단추(#load-retry)가 생기고, 비우면 사라진다.
  const content = stubElement();
  let contentHtml = "";
  Object.defineProperty(content, "innerHTML", {
    get: () => contentHtml,
    set(v) {
      contentHtml = String(v);
      byId.delete("load-retry");
      const label = /<button[^>]*id="load-retry"[^>]*>([^<]*)<\/button>/.exec(contentHtml)?.[1];
      if (label !== undefined) {
        const button = stubElement();
        button.textContent = label;
        byId.set("load-retry", button);
      }
    },
  });
  byId.set("content", content);

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: fetchImpl ?? (async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      const body = data[name];
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    }),
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: locale },
    location: { search, origin: "https://x", pathname: "/", href: "https://x/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    history: { pushState() {}, replaceState() {} },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement());
        return byId.get(id);
      },
      querySelector: (sel) => {
        if (sel.includes("news-category")) return category ? stubElement({ content: category }) : null;
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
      querySelectorAll: () => [],
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
  new vm.Script(script, { filename: "docs/news.html:inline" }).runInContext(sandbox);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    byId: (id) => sandbox.document.getElementById(id),
    baked: bakedHtml,
    notice: () => {
      if (!contentHtml) return null;
      const button = byId.get("load-retry");
      return { html: contentHtml, text: contentHtml.replace(/<button[\s\S]*<\/button>/, "").replace(/<[^>]*>/g, "").trim(), retry: button?.textContent ?? null, button };
    },
    newsListHtml: () => sandbox.document.getElementById("news-list").innerHTML,
  };
}
