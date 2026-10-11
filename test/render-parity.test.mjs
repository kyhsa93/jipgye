import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as prerender from "../scripts/prerender.mjs";
import { makeFragment, rendererMode } from "../scripts/renderer.mjs";
import { createReactRenderer } from "../scripts/render/react.mjs";
import { RATES_BRANCHES } from "./fixtures/render/rates-branches.mjs";

// #237: 렌더러 스위치와 legacy↔react parity 시험의 골격. #240이 금리 조각(ratesHtml·ratesHeadHtml)의 분기별 케이스를 더했고
// #241~#243이 이어서 더한다.
// 입력은 이 파일 안의 값과 test/fixtures/render/의 고정 파일뿐이다(R3): 저장소의 docs/·docs/data는 읽지 않는다.

const root = path.resolve(import.meta.dirname, "..");
const fixture = (name) => path.join(root, "test/fixtures/render", name);
const tmpDirs = [];
after(() => Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))));

test("JIPGYE_RENDERER: 미설정·빈 문자열은 legacy, legacy·react만 받고 나머지는 멈춘다", () => {
  assert.equal(rendererMode({}), "legacy");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "" }), "legacy");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "legacy" }), "legacy");
  assert.equal(rendererMode({ JIPGYE_RENDERER: "react" }), "react");
  for (const bad of ["React", "jsx", " react", "1"]) {
    assert.throws(() => rendererMode({ JIPGYE_RENDERER: bad }), /JIPGYE_RENDERER를 읽을 수 없습니다/, bad);
  }
});

test("prerender.mjs의 *Html() 조각은 전부 래퍼를 거치고 이름이 그대로다", () => {
  const names = Object.keys(prerender).filter((k) => k.endsWith("Html") && k !== "escapeHtml");
  assert.ok(names.length >= 40, `조각 함수를 ${names.length}개밖에 못 찾았다`);
  for (const name of names) {
    assert.equal(typeof prerender[name].legacy, "function", `${name}에 legacy 원본이 없다`);
    assert.equal(prerender[name].name, name);
  }
  // 순수 도구(escapeHtml)는 래퍼 밖이다 - 모든 조각이 쓰는 한 글자 단위 함수라서다.
  assert.equal(prerender.escapeHtml.legacy, undefined);
});

test("기본값(legacy): 래퍼의 출력이 legacy 원본과 같다", () => {
  const summary = { highlights: [{ title: "제목", textKo: "본문" }], categories: [{ name: "분야", lineKo: "한 줄" }] };
  assert.equal(prerender.summaryHtml(summary), prerender.summaryHtml.legacy(summary));
  assert.equal(prerender.summaryHtml(null), null);
  assert.equal(prerender.marketHtml(null), null);
});

test("래퍼: 이식된 조각만 React로 그리고 나머지는 legacy에 맡긴다", async () => {
  const renderer = await createReactRenderer({ entry: fixture("fragments.jsx") });
  const fragment = makeFragment(renderer);
  const calls = [];
  const summary = fragment("summaryHtml", (s) => (calls.push("legacy-summary"), prerender.summaryHtml.legacy(s)));
  const rates = fragment("ratesHtml", (r) => (calls.push("legacy-rates"), `legacy:${r}`)); // 이식 목록에 없다
  assert.equal(rates("x"), "legacy:x");
  assert.deepEqual(calls, ["legacy-rates"]);
  assert.equal(summary({ highlights: [{ title: "a", textKo: "b" }] }), "<p><strong>a</strong> b</p>");
  assert.deepEqual(calls, ["legacy-rates"], "이식된 조각을 그리면서 legacy를 부르면 안 된다");
  assert.equal(summary.name, "summaryHtml");
  assert.equal(typeof summary.legacy, "function");
});

test("래퍼: react 조각이 던지면 legacy로 넘기지 않고 그대로 던진다(폴백은 #238)", async () => {
  const fragment = makeFragment(await createReactRenderer({ entry: fixture("fragments.jsx") }));
  let legacyCalled = false;
  const news = fragment("newsHtml", () => ((legacyCalled = true), "legacy"));
  assert.throws(() => news({}), /의도한 조각 실패/);
  assert.equal(legacyCalled, false);
});

test("parity 골격: 같은 입력에서 legacy와 React 쌍둥이의 출력이 바이트까지 같다(summaryHtml fixture 쌍둥이)", async () => {
  const fragment = makeFragment(await createReactRenderer({ entry: fixture("fragments.jsx") }));
  const react = fragment("summaryHtml", prerender.summaryHtml.legacy);
  const inputs = [
    null,
    {},
    { highlights: [], categories: [] },
    { highlights: [{ title: "제목", textKo: "본문" }] },
    { categories: [{ name: "분야", lineKo: "한 줄" }] },
    { highlights: [{ title: "a", textKo: "b" }], categories: [{ name: "c", lineKo: "d" }] },
    // 특수문자: React가 `'`만 다르게(&#x27;) 내므로 래퍼의 치환 한 줄이 맞춰야 한다. & < > "는 양쪽이 같다.
    { highlights: [{ title: `it's <b> & "q"`, textKo: "don't & <i>" }], categories: [{ name: `a'b`, lineKo: `c'd` }] },
    // textKo가 비면 legacy는 그 항목을 거른다.
    { highlights: [{ title: "빠짐", textKo: "" }, { title: "남음", textKo: "x" }] },
  ];
  for (const input of inputs) {
    assert.equal(react(input), prerender.summaryHtml.legacy(input), JSON.stringify(input));
  }
});

// 기본값 legacy가 로더를 만지지 않는다는 것, react 모드의 실패가 삼켜지지 않는다는 것을 한 번에 본다:
// node_modules가 없는 scripts/ 복사본에서는 esbuild·react를 읽을 수 없다. legacy는 그래도 import가 되고, react는 import에서 던진다.
async function importIn(dir, env) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", 'const r = await import("./scripts/renderer.mjs"); await import("./scripts/prerender.mjs"); console.log(JSON.stringify({ mode: r.RENDERER, ported: r.portedFragments() }));'],
    { cwd: dir, encoding: "utf8", env: { ...process.env, JIPGYE_RENDERER: "", ...env } }
  );
}

test("기본값 legacy는 esbuild·react 없이도 import되고, react 모드는 로더가 못 뜨면 import에서 던진다", async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "jipgye-nomods-")));
  tmpDirs.push(dir);
  await cp(path.join(root, "scripts"), path.join(dir, "scripts"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}');

  const legacy = await importIn(dir, {});
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.deepEqual(JSON.parse(legacy.stdout), { mode: "legacy", ported: [] });
  const explicit = await importIn(dir, { JIPGYE_RENDERER: "legacy" });
  assert.equal(explicit.status, 0, explicit.stderr);

  const react = await importIn(dir, { JIPGYE_RENDERER: "react" });
  assert.notEqual(react.status, 0, "로더를 못 띄웠는데 react 모드가 조용히 지나갔다");
  assert.match(react.stderr, /Cannot find (package|module) '(react-dom|esbuild|react)/);

  const bad = await importIn(dir, { JIPGYE_RENDERER: "bogus" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /JIPGYE_RENDERER를 읽을 수 없습니다/);
});

// 저장소의 진입 파일(scripts/render/entry.jsx)에 이식된 조각. 조각을 이식할 때마다 이 목록과 분기 표(아래)를 같이 늘린다.
const PORTED = ["ratesHeadHtml", "ratesHtml"];

test("react 모드: 이식된 조각 목록이 PORTED와 같고, 그 이름은 전부 .legacy를 가진 prerender.mjs 조각이다(오타·없는 조각을 막는다)", async () => {
  const renderer = await createReactRenderer();
  assert.deepEqual(renderer.names(), PORTED);
  for (const name of renderer.names()) {
    assert.equal(typeof prerender[name]?.legacy, "function", `entry.jsx의 ${name}은 prerender.mjs의 *Html() 조각이 아니다`);
    assert.equal(prerender[name].name, name);
  }
});

// ---- 금리 조각(#240): 분기마다 fixture, 분기마다 legacy 기대값과 legacy↔react 바이트 일치 ----

const productNames = (html) => [...html.matchAll(/class="product-name">([^<]*)</g)].map((m) => m[1]);

test("금리 분기 표: id가 겹치지 않고, 두 조각을 모두 덮는다", () => {
  const ids = RATES_BRANCHES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "분기 id가 겹친다");
  assert.deepEqual([...new Set(RATES_BRANCHES.map((b) => b.fn))].sort(), ["ratesHeadHtml", "ratesHtml"]);
  for (const b of RATES_BRANCHES) {
    assert.ok("expect" in b || b.order, `${b.id}: 기대값(expect 또는 order)이 없다`);
    assert.ok(PORTED.includes(b.fn), `${b.id}: 이식 목록에 없는 조각(${b.fn})`);
  }
});

test("금리 분기 표: legacy 출력이 손으로 적은 기대값과 같다(분기마다)", () => {
  for (const b of RATES_BRANCHES) {
    const out = prerender[b.fn].legacy(...b.args);
    if ("expect" in b) assert.equal(out, b.expect, `${b.id} ${b.cond}`);
    else assert.deepEqual(productNames(out), b.order, `${b.id} ${b.cond}`);
  }
});

test("금리 분기 표: React 조각이 legacy와 바이트까지 같다(분기마다, 허용 변환은 래퍼의 &#x27; 되돌림 하나)", async () => {
  const fragment = makeFragment(await createReactRenderer());
  for (const b of RATES_BRANCHES) {
    const react = fragment(b.fn, prerender[b.fn].legacy)(...b.args);
    assert.equal(react, prerender[b.fn].legacy(...b.args), `${b.id} ${b.cond}`);
  }
});

test("금리 조각: 이식된 이름이라 legacy가 조각 안에서 불리지 않는다(null은 null, 빈 문자열은 빈 문자열 그대로)", async () => {
  let called = 0;
  const fragment = makeFragment(await createReactRenderer());
  const rates = fragment("ratesHtml", () => (called++, "legacy"));
  assert.equal(rates(null), null);
  assert.equal(rates({ deposit: [{ name: "a", options: [{ term: 12, rate: 1, maxRate: 2, rateTypeName: "단리" }] }] }, { limit: 0 }), "");
  assert.equal(called, 0);
});

test("react 모드(진입 목록: ratesHeadHtml·ratesHtml): 이식 안 된 조각은 legacy에 위임되어 같고, 이식된 조각은 분기 표 전부에서 legacy와 같다", async () => {
  const fixtureUrl = pathToFileURL(fixture("rates-branches.mjs")).href;
  const run = (env) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const r = await import("./scripts/renderer.mjs"); const p = await import("./scripts/prerender.mjs");
         const { RATES_BRANCHES } = await import(${JSON.stringify(fixtureUrl)});
         const rates = RATES_BRANCHES.map((b) => [b.id, p[b.fn](...b.args)]);
         console.log(JSON.stringify({ mode: r.RENDERER, ported: r.portedFragments(), out: p.summaryHtml({ highlights: [{ title: "it's", textKo: "x" }] }), rates }));`,
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env, JIPGYE_RENDERER: "", ...env } }
    );
  const legacy = run({});
  const react = run({ JIPGYE_RENDERER: "react" });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(react.status, 0, react.stderr);
  assert.equal(react.stderr, "", "react 모드 렌더가 경고를 냈다(DOM 중첩·key 등)");
  const [a, b] = [JSON.parse(legacy.stdout), JSON.parse(react.stdout)];
  assert.equal(a.mode, "legacy");
  assert.equal(b.mode, "react");
  assert.deepEqual(a.ported, []);
  assert.deepEqual(b.ported, PORTED);
  assert.equal(b.out, a.out, "이식 안 된 조각(summaryHtml)은 legacy 그대로");
  assert.equal(b.rates.length, RATES_BRANCHES.length);
  assert.deepEqual(b.rates, a.rates, "react 모드의 prerender.mjs 조각 출력이 legacy 모드와 다르다");
});
