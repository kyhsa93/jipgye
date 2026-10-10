import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

// #178: 가로로 넘치는 표(.table-scroll)에 오른쪽 페이드 신호. 실측(scrollWidth)은 headless 브라우저가
// 필요해 이 시험에 없다 - 여기서는 (1) 훅이 모든 .table-scroll 화면에 붙는지 (2) 토글 논리 (3) CSS 규칙을 본다.

const root = path.resolve(import.meta.dirname, "..");
const docs = path.join(root, "docs");

function fakeTable({ scrollWidth, clientWidth, scrollLeft = 0, current = null }) {
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  return {
    scrollWidth,
    clientWidth,
    scrollLeft,
    classes,
    attrs,
    firstElementChild: null,
    matches: (sel) => sel === ".table-scroll",
    classList: { toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)) },
    setAttribute: (k, v) => (attrs[k] = v),
    removeAttribute: (k) => delete attrs[k],
    querySelector: () => current,
    addEventListener: (t, fn) => ((listeners[t] ||= []).push(fn), undefined),
    fire: (t) => (listeners[t] ?? []).forEach((fn) => fn()),
  };
}

async function run(tables, lang = "ko") {
  const source = await readFile(path.join(docs, "nav.js"), "utf8");
  const skip = { textContent: "", getAttribute: () => "Skip" };
  vm.runInNewContext(source, {
    document: { querySelectorAll: () => tables, querySelector: () => skip, documentElement: { getAttribute: () => lang } },
    window: { addEventListener() {} },
  });
  return tables;
}

test("넘치는 표는 오른쪽 페이드와 키보드 초점을 받고, 끝까지 밀면 페이드가 사라진다", async () => {
  const [t] = await run([fakeTable({ scrollWidth: 670, clientWidth: 358 })]);
  assert.deepEqual([...t.classes], ["scroll-end"]);
  assert.equal(t.attrs.tabindex, "0", "넘치는 표에 키보드로 닿을 수 없다");
  t.scrollLeft = 670 - 358;
  t.fire("scroll");
  assert.deepEqual([...t.classes], ["scroll-start"], "끝까지 밀었는데 더 있다고 말한다");
});

test("넘치지 않는 표에는 페이드도 tabindex도 없다", async () => {
  const [t] = await run([fakeTable({ scrollWidth: 300, clientWidth: 358 })]);
  assert.deepEqual([...t.classes], []);
  assert.equal(t.attrs.tabindex, undefined, "안 넘치는 표가 탭 순서를 차지한다");
});

test("표는 시작 위치(첫 열이 보이는 자리)에서 움직이지 않는다", async () => {
  const [t] = await run([fakeTable({ scrollWidth: 670, clientWidth: 358, current: { offsetLeft: 500, offsetWidth: 80 } })]);
  assert.equal(t.scrollLeft, 0, "표 스크롤이 시작 위치에서 밀렸다");
});

test("표에는 역할·이름 같은 스크린리더 소음을 붙이지 않는다", async () => {
  const [t] = await run([fakeTable({ scrollWidth: 670, clientWidth: 358 })]);
  assert.deepEqual(Object.keys(t.attrs), ["tabindex"]);
});

test(".table-scroll을 쓰는 모든 화면이 nav.js(신호 훅)를 부르고, 표는 래퍼 안에 있다", async () => {
  const bad = [];
  let pages = 0;
  for (const file of (await readdir(docs)).filter((f) => f.endsWith(".html"))) {
    const html = await readFile(path.join(docs, file), "utf8");
    if (!/class="[^"]*\btable-scroll\b/.test(html)) continue;
    pages++;
    if (!html.includes('src="./nav.js"')) bad.push(`${file}: nav.js 없음`);
    // 래퍼에 자체 tabindex/role이 박혀 있으면 nav.js의 넘침 판정과 어긋난다.
    if (/class="[^"]*\btable-scroll\b[^"]*"[^>]*\b(tabindex|role)=/.test(html)) bad.push(`${file}: 래퍼에 정적 tabindex/role`);
  }
  assert.ok(pages >= 8, `table-scroll 화면이 ${pages}장뿐이다`);
  assert.deepEqual(bad, []);
});

test("#178이 가리킨 네 표가 .table-scroll 안에 있다", async () => {
  const wanted = [
    ["record-high.html", 'id="robust-table"'],
    ["renewal-vs-new.html", "rate-table"],
    ["cancelled-deals.html", "rate-table"],
    ["price-outlook.html", 'id="score-table"'],
  ];
  for (const [file, marker] of wanted) {
    const html = await readFile(path.join(docs, file), "utf8");
    const re = new RegExp(`<div class="table-scroll">\\s*<table[^>]*${marker.replace(/"/g, '"')}`);
    assert.match(html, re, `${file}: ${marker} 표가 .table-scroll 래퍼 안에 없다`);
  }
});

test("CSS: .table-scroll에도 양끝 페이드 mask 규칙이 있다", async () => {
  const css = await readFile(path.join(docs, "style.css"), "utf8");
  for (const sel of [".table-scroll.scroll-end:not(.scroll-start)", ".table-scroll.scroll-start:not(.scroll-end)", ".table-scroll.scroll-start.scroll-end"]) {
    assert.ok(css.includes(sel), `${sel} 규칙이 없다`);
  }
  assert.match(css, /\[tabindex\]:focus-visible\s*\{[^}]*outline:/, "tabindex 초점 표시 규칙이 없다");
});

// 규칙이 있는지가 아니라 캐스케이드를 거친 최종 값을 본다: 초점 받은 <div class="table-scroll" tabindex="0">에
// 걸리는 :focus-visible 규칙 중 명시도가 가장 높은(같으면 소스에서 뒤인) 것의 outline-offset.
function finalFocusOffset(css) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const allowed = new Set([".table-scroll", "[tabindex]", ":focus-visible"]);
  let best = null;
  let order = 0;
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    order++;
    const off = m[2].match(/outline-offset:\s*(-?\d+(?:\.\d+)?)px/);
    if (!off) continue;
    for (const sel of m[1].split(",").map((s) => s.trim())) {
      const parts = sel.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? [];
      // 이 요소에 걸릴 수 있는 선택자만: 태그 없이 위 세 조각으로만 이뤄진 것.
      if (parts.join("") !== sel || !parts.includes(":focus-visible") || !parts.every((p) => allowed.has(p))) continue;
      const spec = parts.length; // 클래스·속성·의사 클래스는 모두 (0,1,0)씩
      if (!best || spec > best.spec || (spec === best.spec && order > best.order)) best = { spec, order, value: Number(off[1]) };
    }
  }
  return best?.value;
}

test("CSS: 초점 받은 .table-scroll의 최종 outline-offset이 음수다(뒤 규칙이 덮지 않는다)", async () => {
  const css = await readFile(path.join(docs, "style.css"), "utf8");
  const v = finalFocusOffset(css);
  assert.ok(v !== undefined && v < 0, `최종 outline-offset=${v}px - mask(border-box)에 테두리가 잘린다`);
});
