import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { SITE } from "./helpers/site-root.mjs";

// #178: 가로로 넘치는 표(.table-scroll)에 오른쪽 페이드 신호. 실측(scrollWidth)은 headless 브라우저가
// 필요해 이 시험에 없다 - 여기서는 (1) 훅이 모든 .table-scroll 화면에 붙는지 (2) 토글 논리 (3) CSS 규칙을 본다.

const root = path.resolve(import.meta.dirname, "..");
const docs = path.join(root, SITE); // 나가는 사이트 전체(#510)

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
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
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
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const v = finalFocusOffset(css);
  assert.ok(v !== undefined && v < 0, `최종 outline-offset=${v}px - mask(border-box)에 테두리가 잘린다`);
});

// #745 PR9: 560px 이하에서 넓은 표를 카드로. nav.js 가 머리글 한 줄짜리 표의 본문 칸마다 열 이름을 data-label 로 붙인다.
function fakeNode(extra = {}) {
  const attrs = {};
  return { attrs, getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => (attrs[k] = v), ...extra };
}
function fakeCell(text = "", colSpan = 1, tagName = "TD") {
  return fakeNode({ textContent: text, colSpan, tagName });
}
function fakeGrid({ heads, rows, headRows = 1, cls = "rate-table" }) {
  const classes = new Set([cls]);
  const head = fakeNode({ rows: Array.from({ length: headRows }, () => fakeNode({ cells: heads.map((h) => fakeCell(h, 1, "TH")) })) });
  const body = fakeNode({ rows: rows.map((r) => fakeNode({ cells: r.map((v, i) => fakeCell(v, 1, i === 0 && cls === "th-row" ? "TH" : "TD")) })) });
  return fakeNode({ tagName: "TABLE", tHead: head, tBodies: [body], classes, classList: { add: (n) => classes.add(n), contains: (n) => classes.has(n) } });
}
function scrollWith(table) {
  const t = fakeTable({ scrollWidth: 300, clientWidth: 358 });
  t.querySelector = (sel) => (sel === "table" ? table : null);
  return t;
}

test("카드 표: 머리글 한 줄 표는 본문 칸마다 열 이름 data-label 과 .cards 를 받고, 칸 수가 다른 줄은 그대로다 (#745 PR9)", async () => {
  const grid = fakeGrid({ heads: ["자치구", "1층", "3층 이상", "차이"], rows: [["강남구", "1", "2", "3"], ["데이터 없음"]] });
  await run([scrollWith(grid)]);
  assert.ok(grid.classes.has("cards"), "표에 .cards 가 없다");
  assert.deepEqual(grid.tBodies[0].rows[0].cells.map((c) => c.attrs["data-label"]), ["자치구", "1층", "3층 이상", "차이"]);
  assert.deepEqual(grid.tBodies[0].rows[1].cells[0].attrs, { role: "cell" }, "한 칸짜리 안내 줄에 라벨이 붙었다");
});

test("카드 표: 머리글이 두 줄이거나 colspan 이 있거나 .data-table(자체 라벨) 이면 라벨·.cards 를 달지 않는다 (#745 PR9)", async () => {
  const two = fakeGrid({ heads: ["a", "b", "c"], rows: [["1", "2", "3"]], headRows: 2 });
  const own = fakeGrid({ heads: ["a", "b", "c"], rows: [["1", "2", "3"]], cls: "data-table" });
  const span = fakeGrid({ heads: ["a", "b", "c"], rows: [["1", "2", "3"]] });
  span.tHead.rows[0].cells[1].colSpan = 2;
  await run([scrollWith(two), scrollWith(own), scrollWith(span)]);
  for (const g of [two, own, span]) {
    assert.ok(!g.classes.has("cards"));
    assert.equal(g.tBodies[0].rows[0].cells[0].attrs["data-label"], undefined);
  }
  // 카드가 안 되는 표는 표 그대로라 역할을 붙이지 않는다.
  assert.deepEqual(two.attrs, {});
  assert.deepEqual(span.attrs, {});
});

test("카드 표 낭독기: 카드가 되는 표와 .data-table 은 table/rowgroup/row/columnheader/rowheader/cell 역할을 받는다 (#745 PR9b)", async () => {
  const grid = fakeGrid({ heads: ["자치구", "1층", "차이"], rows: [["강남구", "1", "2"]], cls: "th-row" });
  const own = fakeGrid({ heads: ["지역", "매매", "전세"], rows: [["강남구", "1", "2"]], cls: "data-table" });
  // .data-table 은 .table-scroll 밖(.table-wrap)에 있어 표 자체가 넘어온다 - 내비 고리가 건드릴 메서드만 흉내 낸다.
  Object.assign(own, { scrollWidth: 0, clientWidth: 0, matches: () => false, querySelector: () => null, addEventListener() {}, classList: { ...own.classList, toggle() {} } });
  await run([scrollWith(grid), own]);
  for (const g of [grid, own]) {
    assert.equal(g.attrs.role, "table");
    assert.equal(g.tHead.attrs.role, "rowgroup");
    assert.equal(g.tBodies[0].attrs.role, "rowgroup");
    assert.equal(g.tHead.rows[0].attrs.role, "row");
    assert.deepEqual(g.tHead.rows[0].cells.map((c) => c.attrs.role), ["columnheader", "columnheader", "columnheader"]);
    assert.equal(g.tBodies[0].rows[0].attrs.role, "row");
  }
  assert.deepEqual(grid.tBodies[0].rows[0].cells.map((c) => c.attrs.role), ["rowheader", "cell", "cell"]);
  assert.deepEqual(own.tBodies[0].rows[0].cells.map((c) => c.attrs.role), ["cell", "cell", "cell"]);
  assert.equal(own.tBodies[0].rows[0].cells[1].attrs["data-label"], undefined, ".data-table 은 자체 라벨을 쓴다");
});

test("카드 라벨·역할은 관찰 하나(main)로 다시 붙인다 - 표 단위 관찰은 페이드만 센다 (#745 PR9b)", async () => {
  const source = await readFile(path.join(docs, "nav.js"), "utf8");
  const observers = source.match(/new MutationObserver\(([^)]*\)?)/g) ?? [];
  const cards = observers.filter((o) => /toCards|cardAll/.test(o));
  assert.equal(cards.length, 1, `카드 갱신 관찰이 ${cards.length}개다`);
  assert.doesNotMatch(source, /MutationObserver\(\(\) => \(toCards/, "표 단위 관찰이 아직 toCards 를 부른다");
});

test("CSS: 560px 이하에서 .cards 표는 머리글을 숨기고 칸마다 라벨을 앞에 적는다, 시세 표 카드도 560px 까지 (#745 PR9)", async () => {
  const css = (await readFile(path.join(root, "src/css/legacy.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const block = css.slice(css.indexOf("@media (max-width: 560px) {\n  .table-scroll > table.cards"));
  assert.ok(block.length < css.length, "카드 표 미디어 블록이 없다");
  // 머리글은 눈에서만 숨긴다(#745 PR9b) - display:none 이면 낭독기가 열 이름을 잃는다.
  assert.match(block, /table\.cards > thead \{\s*position: absolute;[^}]*clip-path: inset\(50%\);/);
  assert.doesNotMatch(block.slice(0, block.indexOf("}\n}")), /thead \{\s*display: none;/);
  assert.match(block, /table\.cards tr > \[data-label\]::before \{\s*content: attr\(data-label\);/);
  assert.match(css, /@media \(max-width: 560px\) \{\s*\.data-table \{\s*white-space: normal;/, "시세 표 카드 분기점이 560px 가 아니다");
});

test("CSS: 560px 이하 시세 표는 머리글을 눈에서만 숨기되 정렬 단추 줄은 보인다(44px) (#745 PR9b)", async () => {
  const css = (await readFile(path.join(root, "src/css/legacy.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const start = css.search(/@media \(max-width: 560px\) \{\s*\.data-table \{/);
  assert.ok(start > 0);
  const block = css.slice(start, css.indexOf("\n}\n", start));
  assert.match(block, /\.data-table thead \{\s*position: absolute;[^}]*clip-path: inset\(50%\);/);
  assert.match(block, /\.realestate-table > thead \{\s*position: static;\s*display: block;[^}]*clip-path: none;/, "시세 표 정렬 단추가 숨는다");
  assert.match(block, /\.realestate-table > thead tr \{\s*display: flex;/);
  assert.match(block, /\.realestate-table th\.sortable button \{[^}]*min-height: var\(--tap\);/);
});
