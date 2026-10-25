import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { loadJsxModule } from "../scripts/render/load-jsx.ts";
import { createReactRenderer } from "../scripts/render/react.ts";

// #237: esbuild 자작 로더와 react 진입점. 읽는 것은 test/fixtures/render/의 고정 JSX뿐이다(R3) - docs/data도 골든 파일도 아니다.

const root = path.resolve(import.meta.dirname, "..");
const fixture = (name) => path.join(root, "test/fixtures/render", name);
// 다른 시험 파일(별도 프로세스)이 같은 시각에 로더를 돌려도 남은 것 검사가 흔들리지 않게 이 파일 전용 임시 위치를 쓴다.
// bare import(react)를 풀어야 하므로 node_modules 안쪽이어야 한다.
const CACHE = path.join(root, "node_modules/.cache", `jipgye-render-test-${process.pid}`);
const leftovers = async () => (await readdir(CACHE).catch(() => [])).filter((f) => f.startsWith("jsx-"));
after(() => rm(CACHE, { recursive: true, force: true }));

test("로더: JSX를 컴파일해 모듈로 돌려주고 임시 산출물을 남기지 않는다", async () => {
  const before = await leftovers();
  const mod = await loadJsxModule(fixture("fragments.jsx"), { cacheDir: CACHE });
  assert.deepEqual(Object.keys(mod.fragments).sort(), ["marketHtml", "newsHtml", "summaryHtml"]);
  assert.deepEqual(await leftovers(), before, "node_modules/.cache/jipgye-render에 임시 폴더가 남았다");
});

test("로더: 컴파일 오류는 던진다(삼키지 않고 임시 산출물도 남기지 않는다)", async () => {
  const before = await leftovers();
  await assert.rejects(loadJsxModule(fixture("broken.jsx"), { cacheDir: CACHE }), /Expected|Unexpected|error/i);
  assert.deepEqual(await leftovers(), before);
});

test("로더: 진입 파일이 렌더러를 만드는 모듈(prerender.ts)을 불러오면 거부한다(묶인 사본이 렌더러를 또 만들어 도는 것을 막는다)", async () => {
  await assert.rejects(loadJsxModule(fixture("imports-prerender.jsx"), { cacheDir: CACHE }), /렌더러를 만드는 모듈/);
  assert.deepEqual(await leftovers(), []);
});

test("react 진입점: 이식된 조각 목록을 조회하고 React 요소를 문자열로 그린다", async () => {
  const r = await createReactRenderer({ entry: fixture("fragments.jsx") });
  assert.deepEqual(r.names(), ["marketHtml", "newsHtml", "summaryHtml"]);
  assert.equal(r.has("summaryHtml"), true);
  assert.equal(r.has("ratesHtml"), false);
  const html = r.render("summaryHtml", [{ highlights: [{ title: "제목", link: "u", source: "S", textKo: "본문" }], categories: [{ name: "분야", lineKo: "한 줄" }] }]);
  assert.ok(html.includes("<div class=\"summary-category-label\">분야</div><div class=\"summary-category-line\">한 줄</div>"), html);
  assert.ok(html.includes("<a href=\"u\" target=\"_blank\" rel=\"noopener\">제목</a>"), html);
});

test("react 진입점: `'`는 그대로 두고(옛 legacy escapeHtml 과 같은 글자) &, <, >, \"는 React가 낸 대로 이스케이프한다", async () => {
  const r = await createReactRenderer({ entry: fixture("fragments.jsx") });
  const html = r.render("summaryHtml", [{ highlights: [{ title: `it's <b> & "q"`, link: "u", source: "S", textKo: "x" }], categories: [{ name: "c", lineKo: "l" }] }]);
  assert.ok(html.includes(`>it's &lt;b&gt; &amp; &quot;q&quot;</a>`), html);
  assert.ok(!html.includes("&#x27;"));
});

test("react 진입점: 조각이 null을 주면(데이터 없음) null이고, 던지면 그 오류가 그대로 올라온다", async () => {
  const r = await createReactRenderer({ entry: fixture("fragments.jsx") });
  assert.equal(r.render("marketHtml", [null]), null);
  assert.equal(r.render("summaryHtml", [null]), null);
  assert.throws(() => r.render("newsHtml", [null]), /의도한 조각 실패/);
});

test("react 진입점: fragments가 없거나 함수가 아닌 값이 있으면 멈춘다", async () => {
  await assert.rejects(createReactRenderer({ entry: fixture("no-fragments.jsx") }), /fragments 객체/);
  await assert.rejects(createReactRenderer({ entry: fixture("bad-shape.jsx") }), /notAFunction은 함수여야/);
});

test("react 진입점: 저장소의 진입 파일(scripts/render/entry.jsx)이 로드되고, 등록된 이름은 전부 prerender.ts의 조각이다", async () => {
  const r = await createReactRenderer();
  const prerender = await import("../scripts/prerender.ts");
  for (const name of r.names()) {
    assert.equal(typeof prerender[name], "function", `${name}은 prerender.ts의 *Html() 조각이 아니다`);
    assert.equal(prerender[name].name, name);
  }
});
