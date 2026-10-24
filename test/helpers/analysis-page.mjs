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

// id 가 붙은 요소 하나의 안쪽 마크업. 이 장들의 구운 자리(p·table·div)는 같은 태그가 안에 또 들어 있지 않다.
function innerOf(html, id) {
  const open = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>`).exec(html);
  assert.ok(open, `#${id} 를 못 찾았다`);
  const start = open.index + open[0].length;
  return html.slice(start, html.indexOf(`</${open[1]}>`, start));
}

/**
 * 분석 6장(docs/{price-outlook,cancelled-deals,renewal-vs-new,floor-gap,record-high,switch-house}.html)의 인라인 스크립트를
 * 손으로 만든 DOM 에서 돌린다 (#296 틀 (가)·(라)).
 *
 * - `file`: 저장소 루트 기준 상대 경로(SITE/…). `fetch`: 데이터 요청에 답하는 함수.
 * - `bake`: 받은 HTML 에서 그 글자 그대로 채워 둘 요소 id 들. 구운 기준일 줄(#updated 의 글자·data-updated)은 늘 채운다.
 *   `hiddenIds` 의 요소는 구운 hidden 값을 그대로 둔다. 스크립트가 구운 내용을 건드렸는지 보려면 이것이 있어야 한다.
 * - `mutate`: 스크립트 본문을 바꿔 끼우는 함수(변이 증빙용).
 * - `baked`: 구운 글자(id → innerHTML, `hidden` → id → hidden, updatedText, day). `notice()`: #content 안 알림 한 줄의 글자·단추 글자·단추, 없으면 null.
 */
export async function loadAnalysisPage({ file, locale = "ko", fetch: fetchImpl, bake = [], hiddenIds = [], mutate, analytics } = {}) {
  const html = await readFile(path.join(root, file), "utf8");
  const script0 = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  const script = mutate ? mutate(script0) : script0;

  const store = { lang: locale };
  const byId = new Map();
  const baked = { hidden: {} };
  for (const id of bake) {
    const el = stubElement();
    el.innerHTML = baked[id] = innerOf(html, id);
    byId.set(id, el);
  }
  for (const id of hiddenIds) {
    const el = byId.get(id) ?? stubElement();
    el.hidden = baked.hidden[id] = new RegExp(`id="${id}"[^>]*\\shidden[\\s>]`).test(html);
    byId.set(id, el);
  }
  const stamp = html.match(/<div class="updated" id="updated" data-updated="([^"]*)">([^<]*)<\/div>/);
  assert.ok(stamp, `${file} 의 구운 기준일 줄을 못 찾았다`);
  const updated = stubElement({ "data-updated": stamp[1] });
  updated.textContent = baked.updatedText = stamp[2];
  baked.day = stamp[1];
  byId.set("updated", updated);

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
    fetch: fetchImpl,
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: locale },
    location: { search: "", origin: "https://x", pathname: "/", href: "https://x/" },
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
  new vm.Script(script, { filename: `${file}:inline` }).runInContext(sandbox);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    byId: (id) => sandbox.document.getElementById(id),
    baked,
    script,
    notice: () => {
      if (!contentHtml) return null;
      const button = byId.get("load-retry");
      return { html: contentHtml, text: contentHtml.replace(/<button[\s\S]*<\/button>/, "").replace(/<[^>]*>/g, "").trim(), retry: button?.textContent ?? null, button };
    },
  };
}
