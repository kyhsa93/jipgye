import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

/**
 * 그래프 폭. 실제 화면에서 재는 값을 대신한다.
 *
 * 손이 어느 주 위에 있는지는 `(clientX - rect.left) / rect.width`로 정하므로, 이 숫자가
 * 있어야 포인터 경로가 돌아간다. 없으면 `rect.width`에서 멈춘다.
 */
const CHART_WIDTH = 300;

function stubElement(attrs = {}, id = "", shared = null, reg = null) {
  const listeners = {};
  // 안쪽 요소들. svg는 그래프 칸과 같은 주머니를 쓴다 — 실제 DOM에서 `#trend-chart .marker`
  // 와 `#trend-chart svg`의 `.marker`는 같은 하나이기 때문이다. 따로 두면 마커를 찍는
  // 경로와 지우는 경로가 서로 다른 것을 만지게 되고, 검사만 통과하고 화면은 안 지워진다.
  const children = shared ?? new Map();
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
    hidden: false,
    // 이 요소의 hidden에 쓴 값을 순서대로 남긴다. 끝 상태만 보면 "숨겼다가 다시 편" 것을 못 본다(#288).
    hiddenWrites: [],
    offsetWidth: 110,
    style: {},
    dataset: {},
    attrs,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: CHART_WIDTH,
      height: 120,
      right: CHART_WIDTH,
      bottom: 120,
    }),
    // 마커처럼 그래프 안쪽에서 찾는 것들. 같은 선택자는 같은 것을 돌려줘야 검사에서
    // 좌표를 읽을 수 있다.
    querySelector(sel) {
      if (!children.has(sel)) {
        // 마커는 마크업에서 `hidden`으로 태어난다. 스텁도 그래야 "한 번도 안 찍힌 것"과
        // "찍혔다 지워진 것"이 같게 보인다.
        const born = sel === ".marker" ? { hidden: "hidden" } : {};
        children.set(sel, stubElement(born, `${id}${sel}`, sel === "svg" ? children : null, reg));
      }
      return children.get(sel);
    },
    querySelectorAll: () => [],
    closest: () => null,
    // insertAdjacentHTML 로 세운 노드(#296 notifyBeside). 실제 DOM 처럼 id 가 있으면 getElementById 가 그 노드를 돌려주고,
    // afterend 는 앵커의 nextElementSibling, beforeend 는 부모의 lastElementChild 가 된다. remove() 는 isConnected 를 끄고 그 id 를 놓는다.
    isConnected: true,
    inserted: [],
    ownText: "",
    insertAdjacentHTML(pos, html) {
      const node = stubElement({}, /\bid="([^"]*)"/.exec(html)?.[1] ?? "", null, reg);
      node.tag = /^\s*<([a-z]+)/.exec(html)?.[1] ?? null;
      node.markup = html;
      node.cls = /\bclass="([^"]*)"/.exec(html)?.[1] ?? null;
      if (node.id) reg?.(node.id, node);
      if (pos === "afterend") this.nextElementSibling = node;
      if (pos === "beforeend") this.lastElementChild = node;
      this.inserted.push(node);
    },
    append(text) {
      this.ownText += text;
    },
    remove() {
      this.isConnected = false;
      if (this.id) reg?.(this.id, null);
    },
  };
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : () => {}),
    set: (t, p, v) => {
      if (p === "hidden") t.hiddenWrites.push(v);
      t[p] = v;
      return true;
    },
  });
}

/**
 * 시세 틀(또는 그 틀로 찍어낸 장)의 인라인 스크립트를 손으로 만든 DOM 위에서 돌린다.
 *
 * - `file`: 스크립트를 읽을 장. 기본은 틀이고, 찍어낸 장(`docs/budget-8eok.html`)을 주면 그 장에 실려 나간 스크립트가 돈다.
 * - `gate(name)`: 데이터 파일(`realestate`·`budget-deals`…)에 답하기 전에 기다릴 것. 시험이 쥔 약속을 돌려주면 그 응답이
 *   "받는 중"에 머물고, 던지면 요청이 거부된다(네트워크 실패).
 * - `title`: 스크립트가 도는 시점의 `document.title`. 실제 문서에서는 구운 `<title>`이 이미 들어 있다(#299). 기본은 빈 글자.
 * - `baked`: 받은 HTML에 이미 들어 있던 것(`{ "budget-result": { innerHTML } }`). 스텁 요소는 빈 채로 태어나므로,
 *   스크립트가 구운 내용을 건드렸는지 보려면 여기서 채워 둔다.
 * - `mutate(script)`: 변이 증빙용. 읽은 스크립트를 고쳐 돌린다(시험이 눈이 멀지 않았는지 보려고 일부러 망가뜨린 사본).
 * - `globals`: 스크립트가 도는 전역에 얹을 값(`innerHeight` 처럼 실제 창에만 있는 것, #338). 기본 창 높이는 823(412x823).
 *   `trend-section` 바로 뒤 형제(.trend-reserve)는 `baked["trend-section"].nextElementSibling` 으로 바꿔 끼운다. 기본은 윗변 1230 · 높이 725 인 스텁이다 -
 *   실패 경로를 타는 시험이 접는 줄(foldReserve, #338)에서 멈추지 않게 한다.
 */
export async function loadRealestatePage({ realestate, trend, budget, complexRatio, budgetBand = null, prerenderedBudget = "", kind = null, district = null, locale = "ko", search = "", analytics, file = "docs/realestate.html", gate = null, baked = {}, title = "", globals = {}, mutate } = {}) {
  const html = await readFile(path.join(root, file), "utf8");
  const written = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  const script = mutate ? mutate(written) : written;

  const store = { lang: locale };
  const byId = new Map();
  // 추이 격자 하나. 이 화면의 그래프는 전부 여기 들어 있고, 서로 같은 주를 x축으로 쓴다.
  const CHART_PREFIXES = ["trend", "rent", "volume", "ratio"];
  const reg = (id, node) => (node ? byId.set(id, node) : byId.delete(id));
  const grid = stubElement({}, "history-grid", null, reg);
  grid.querySelectorAll = (sel) =>
    sel === ".history-chart"
      ? CHART_PREFIXES.map((prefix) => sandbox.document.getElementById(`${prefix}-chart`))
      : [];
  // 구운 표의 면적 칸(#district-grid 의 행마다 셋째 td, #410). 표를 다시 쓰면(innerHTML 이 바뀌면) 새 칸이 된다 - 실제 DOM 과 같다.
  let areaCellsHtml = null;
  let areaCells = [];
  const areaCellsOf = () => {
    const html = String(sandbox.document.getElementById("district-grid").innerHTML);
    if (html !== areaCellsHtml) {
      areaCellsHtml = html;
      areaCells = [...html.matchAll(/<tr\b[^>]*>(?:<td\b[\s\S]*?<\/td>){3}/g)].map(() => stubElement());
    }
    return areaCells;
  };
  const data = { realestate, "realestate-trend": trend, "budget-deals": budget, "complex-ratio": complexRatio };

  function applyUrl(url) {
    const [pathname, query = ""] = String(url).split("?");
    sandbox.location.pathname = pathname;
    sandbox.location.search = query ? `?${query}` : "";
    sandbox.location.href = `https://x${pathname}${query ? `?${query}` : ""}`;
  }

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    innerHeight: 823,
    ...globals,
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      await gate?.(name);
      const body = data[name];
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    },
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
        applyUrl(url);
      },
      replaceState(_state, _title, url) {
        applyUrl(url);
      },
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) {
          const el = stubElement({}, id, null, reg);
          if (id === "trend-section") {
            const reserve = stubElement({}, "trend-reserve", null, reg);
            reserve.getBoundingClientRect = () => ({ top: 1230 });
            reserve.offsetHeight = 725;
            el.nextElementSibling = reserve;
          }
          Object.assign(el, baked[id] ?? {});
          el.hiddenWrites.length = 0;
          // 그래프는 자기 카드 안에 있고, 카드는 모두 한 격자 안에 있다. 같은 축을
          // 쓰는 그래프를 찾는 코드가 이 두 관계를 타고 올라간다.
          const chart = /^(.+)-chart$/.exec(id);
          if (chart) {
            el.closest = (sel) =>
              sel === ".history-card"
                ? sandbox.document.getElementById(`${chart[1]}-card`)
                : sel === ".history-grid"
                  ? grid
                  : null;
          }
          byId.set(id, el);
        }
        return byId.get(id);
      },
      querySelector: (sel) => {
        if (sel.includes("realestate-kind")) return kind ? stubElement({ content: kind }) : null;
        if (sel.includes("realestate-district")) return district ? stubElement({ content: district }) : null;
        if (sel.includes("budget-band")) return budgetBand === null ? null : stubElement({ content: String(budgetBand) });
        // "#trend-chart svg", "#trend-chart .marker" 처럼 한 요소 안쪽을 가리키는 것은
        // 그 요소에게 넘긴다. 그래야 검사가 마커에 찍힌 좌표를 같은 경로로 되읽는다.
        const inside = /^#([a-zA-Z0-9_-]+)\s+(.+)$/.exec(sel);
        if (inside) return sandbox.document.getElementById(inside[1]).querySelector(inside[2]);
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
      // 예산 페이지는 빌드가 #budget-result에 구워 둔 덩어리(data-prerendered)를 로드 때 떼어 둔다.
      // 받은 HTML(prerenderedBudget)에서 그 덩어리만 꺼내 준다. 덩어리 안에 같은 태그가 다시 열리지는 않는다(예산으로 찾기 제목+칩은 div 덩어리다, #460).
      // 시세 요약 카드(#overall-cards)도 같은 부류다(#311) - 거기 구워져 있던 카드를 로드 때 떼어 둔다.
      // 이쪽은 `baked`로 채운 그 요소의 지금 innerHTML에서 꺼낸다. 실제 DOM처럼 스크립트가 다시 쓴 뒤에는 새 내용이 보인다.
      querySelectorAll: (sel) =>
        sel === "#district-grid td:nth-child(3)"
          ? areaCellsOf()
          : sel === "#budget-result [data-prerendered]"
          ? [...String(prerenderedBudget).matchAll(/<(p|section|div)\b[^>]*data-prerendered[^>]*>[\s\S]*?<\/\1>/g)].map((m) => ({ outerHTML: m[0] }))
          : sel === "#overall-cards .overall-card"
            ? [...String(sandbox.document.getElementById("overall-cards").innerHTML).matchAll(/<div class="overall-card">[\s\S]*?<\/div><\/div>/g)].map((m) => ({
                outerHTML: m[0],
                textContent: m[0].replace(/<[^>]*>/g, ""),
                // 카드 안쪽의 label·value·sub. 스크립트가 구운 카드에서 숫자만 떼어 갈 때 쓴다(#311).
                querySelector: (inner) => {
                  const hit = new RegExp(`<div class="${inner.slice(1)}">([\\s\\S]*?)</div>`).exec(m[0]);
                  return hit ? { textContent: hit[1].replace(/<[^>]*>/g, "") } : null;
                },
              }))
            : [],
      createElement: () => stubElement(),
      addEventListener() {},
      documentElement: stubElement(),
      body: stubElement(),
      head: stubElement(),
      title,
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
    sandbox,
    byId: (id) => sandbox.document.getElementById(id),
    tableHtml: () => sandbox.document.getElementById("district-grid").innerHTML,
    /** 표의 면적 칸들이 지금 가려져 있나(style.visibility). 칸이 없으면 빈 배열. */
    areaCellsHidden: () => areaCellsOf().map((td) => td.style.visibility === "hidden"),
    trendHtml: () => sandbox.document.getElementById("trend-chart").innerHTML,
    trendMeta: () => sandbox.document.getElementById("trend-meta").textContent,
    volumeHtml: () => sandbox.document.getElementById("volume-chart").innerHTML,
    ratioHtml: () => sandbox.document.getElementById("ratio-chart").innerHTML,
    cardLabel: (prefix) => sandbox.document.getElementById(`${prefix}-label`).textContent,
    cardCurrent: (prefix) => sandbox.document.getElementById(`${prefix}-current`).textContent,
    cardMinMax: (prefix) => sandbox.document.getElementById(`${prefix}-minmax`).textContent,
    cardHidden: (id) => sandbox.document.getElementById(id).hidden,
    /** 스크립트가 그 요소의 hidden에 쓴 값들(순서대로). 한 번도 안 썼으면 빈 배열. */
    hiddenWrites: (id) => [...sandbox.document.getElementById(id).hiddenWrites],
    headHtml: () => sandbox.document.getElementById("district-head").innerHTML,
    overallHtml: () => sandbox.document.getElementById("overall-cards").innerHTML,
    budgetHtml: () => sandbox.document.getElementById("budget-result").innerHTML,
    tipHtml: () => sandbox.document.getElementById("chart-tip").innerHTML,
    tipHidden: () => sandbox.document.getElementById("chart-tip").hidden,
    /** 그래프 위 어느 지점을 짚는다. 0이 왼쪽 끝, 1이 오른쪽 끝. */
    pointAt: (prefix, ratio) => {
      const holder = sandbox.document.getElementById(`${prefix}-chart`);
      sandbox.document.getElementById("trend-section").dispatch("click", {
        target: { ...holder, closest: (sel) => (sel === ".history-chart" ? holder : null) },
        clientX: ratio * CHART_WIDTH,
        clientY: 100,
      });
    },
    /** 그 그래프의 마커가 지금 어디에 찍혀 있나. 숨었으면 null. */
    marker: (prefix) => {
      const svg = sandbox.document.getElementById(`${prefix}-chart`).querySelector("svg");
      const marker = svg.querySelector(".marker");
      if (marker.getAttribute("hidden") !== null) return null;
      return {
        x: Number(marker.querySelector(".marker-dot").getAttribute("cx")),
        y: Number(marker.querySelector(".marker-dot").getAttribute("cy")),
      };
    },
  };
}
