// 근거표 장(docs/buy-by-budget.html)의 폼·장 전용 JS·건수 파일 (#871 PR-B).
//
// 손으로 고치는 틀과 docs/budget-rows.js·docs/budget-table.js(배포 사본 = 주석 뗀 것, #784)를 작은 가짜 DOM 에 올려 돌린다. 가짜 DOM 은 틀에 실제로 있는
// id 만 만든다 - 없는 id 를 찾으면 던진다(#777: 아무 id 나 만들어 주는 가짜 DOM 위에서는 틀에서 빠진 자리를 시험이 못 잡는다). 그래도 먼저 틀에 그 id 가 있는지 단언한다.
// 건수 파일은 구운 기본 보기와 같은 고정 데이터(test/helpers/budget-fixture.mjs)를 같은 순수 함수(scripts/budget-table.ts recoCounts)로 만든 것이다 -
// 그래서 「JS 의 머리·구 건수·over_band = 구운 쪽」을 같은 입력으로 맞댈 수 있다(cto 조건 E). 오늘 데이터를 읽지 않는다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { AREAS, BANDS, budgetModel, budgetTableHtml, COUNTS_VERSION, headText, overBand, recoCounts, recoCountsOf, recoView, recoViews, relaxText, rowOrder } from "../scripts/budget-table.ts";
import { COUNTS_FILE, writeRecoCounts } from "../scripts/build-reco-counts.ts";
import { DISTRICT_SLUGS } from "../scripts/district-slugs.ts";
import { areaBand, priceBand } from "../scripts/recommendation.ts";
import { stripJsComments } from "../scripts/strip-inline-comments.ts";
import { apt, assertNoBanned, cell, files, FIXTURE, views } from "./helpers/budget-fixture.mjs";
import { buildFixtureSite } from "./helpers/fixture-site.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(repo, rel), "utf8");
const TEMPLATE = read("docs/buy-by-budget.html");
const JS = ["budget-rows.js", "budget-table.js"];
// 나가는 사본(#784): 주석을 뗀 것. 시험은 이것을 돌린다 - gzip 2KB 도 이것으로 잰다.
const SHIPPED = JS.map((f) => stripJsComments(read(`docs/${f}`)));
const IDS = ["bt-band", "bt-area", "bt-first", "bt-go", "bt-range", "bt-nojs", "bt-head", "bt-baked", "bt-live", "bt-rows", "lang-toggle"];

// ---- 가짜 DOM ------------------------------------------------------------------------------------------------------------------

const attrsOf = (id) => {
  const tag = TEMPLATE.match(new RegExp(`<\\w+\\b[^>]*\\sid="${id}"[^>]*>`))[0];
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
};
const optionsOf = (id) => {
  const select = TEMPLATE.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1];
  return [...select.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], selected: !!m[2], textContent: m[3] }));
};

function element(id) {
  const attrs = attrsOf(id);
  const listeners = {};
  const el = {
    id,
    hidden: "hidden" in attrs,
    textContent: "",
    innerHTML: "",
    checked: false,
    getAttribute: (k) => attrs[k] ?? null,
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    fire: (type, target = el) => (listeners[type] ?? []).forEach((fn) => fn({ target })),
  };
  if (TEMPLATE.includes(`<select id="${id}">`)) {
    el.options = optionsOf(id);
    Object.defineProperty(el, "value", {
      get: () => el.options.find((o) => o.selected)?.value ?? "",
      set: (v) => el.options.forEach((o) => (o.selected = o.value === String(v))),
    });
  }
  return el;
}

/** 장 하나를 연다. data: { "reco-counts": 객체, "reco-<slug>": 객체 } - 없으면 503. analytics: 같은 자리에서 docs/analytics.js 도 돌린다. */
async function open({ hash = "", data = {}, lang = "ko", analytics = false } = {}) {
  const els = Object.fromEntries(IDS.map((id) => [id, element(id)]));
  const fetched = [];
  const writes = [];
  const htmlLang = { value: lang };
  const dataLayer = [];
  const href = `https://x/buy-by-budget.html${hash}`;
  const location = new Proxy({ href, hash, search: "", hostname: "x", pathname: "/buy-by-budget.html", origin: "https://x" }, {
    set: (t, k, v) => (writes.push(`location.${String(k)}=${v}`), (t[k] = v), true),
  });
  const timers = [];
  const sandbox = {
    console, URL, URLSearchParams, Promise, JSON, Math, Number, String, Array, Set, Object,
    location,
    history: { pushState: () => writes.push("pushState"), replaceState: () => writes.push("replaceState"), state: null },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout() {},
    fetch: async (url) => {
      fetched.push(url);
      const body = data[String(url).match(/\/data\/([\w-]+)\.json$/)?.[1]];
      return body ? { ok: true, json: async () => structuredClone(body) } : { ok: false, json: async () => ({}) };
    },
    document: {
      title: "예산대로 보는 단지 근거표",
      referrer: "",
      head: { appendChild() {} },
      createElement: () => ({}),
      querySelector: (sel) => (sel === 'meta[name="site-group"]' ? { getAttribute: () => "budget" } : null),
      documentElement: { getAttribute: (k) => (k === "lang" ? htmlLang.value : null) },
      getElementById: (id) => {
        if (!els[id]) throw new Error(`틀에 없는 id: ${id}`);
        return els[id];
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.dataLayer = dataLayer;
  vm.createContext(sandbox);
  if (analytics) new vm.Script(read("docs/analytics.js")).runInContext(sandbox);
  SHIPPED.forEach((src, i) => new vm.Script(src, { filename: `docs/${JS[i]}` }).runInContext(sandbox));
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  };
  await settle();
  return {
    els,
    fetched,
    writes,
    sandbox,
    settle,
    set: async (id, value) => {
      if (id === "bt-first") els[id].checked = value;
      else els[id].value = value;
      els[id].fire("change");
      await settle();
    },
    lang: async (next) => {
      htmlLang.value = next;
      els["lang-toggle"].fire("click");
      await settle();
    },
    showRows: async (district) => {
      const i = counts().d.findIndex((d) => d[0] === district);
      els["bt-live"].fire("click", { getAttribute: (k) => (k === "data-d" ? String(i) : null) });
      await settle();
    },
    runTimers: () => timers.splice(0).forEach((fn) => fn()),
  };
}

const counts = (f = files(FIXTURE)) => recoCounts(recoViews(f));
const DATA = () => ({ "reco-counts": counts(), ...Object.fromEntries(files(FIXTURE).map((f) => [`reco-${DISTRICT_SLUGS[f.district]}`, f])) });
const districtRows = (html) => [...html.matchAll(/<tr><th>([^<]+?)(?: <small>~[\d-]+<\/small>)?(?: <button type="button" data-d="(\d+)">[^<]+<\/button>)?<\/th><td>([\d,]+)<\/td><td>([\d,]+)<\/td><\/tr>/g)];
const num = (s) => Number(s.replaceAll(",", ""));

// ---- 틀과 파일 ----------------------------------------------------------------------------------------------------------------

test("틀: JS 가 찾는 id 가 틀에 하나씩 실제로 있다 (#777 - 가짜 DOM 이 없는 id 를 만들어 주지 않게 먼저 단언)", () => {
  for (const id of IDS) assert.equal(TEMPLATE.split(`id="${id}"`).length, 2, id);
  // 두 JS 가 getElementById 로 찾는 이름이 위 목록 안이다.
  for (const src of SHIPPED) for (const m of src.matchAll(/\$\("([\w-]+)"\)|getElementById\("([\w-]+)"\)/g)) assert.ok(IDS.includes(m[1] ?? m[2]), m[0]);
  for (const id of ["bt-band", "bt-area", "bt-first", "bt-go", "bt-range", "bt-nojs"]) assert.ok(TEMPLATE.indexOf(`id="${id}"`) < TEMPLATE.indexOf('id="bt-result"'), `${id} 는 결과 위 폼 자리`);
  // 값대 3억대~20억대 18개, 기본 7억대·전체 면적(po 명세 ①). 생애최초는 기본 꺼짐(cpo 답 3).
  assert.deepEqual(optionsOf("bt-band").map((o) => o.value), BANDS.map(String));
  assert.deepEqual(optionsOf("bt-band").filter((o) => o.selected).map((o) => o.value), ["7"]);
  assert.deepEqual(optionsOf("bt-area").map((o) => o.value), ["all", ...AREAS]);
  assert.match(TEMPLATE, /<input type="checkbox" id="bt-first">/);
});

test("틀: 폼에 form 요소·name 0, 버튼은 type=button, 입력 안내 문장(clo) (cto 조건 B, 완료 조건 5)", () => {
  const body = TEMPLATE.slice(TEMPLATE.indexOf("<body>"));
  assert.equal((body.match(/<form\b/g) ?? []).length, 1, "사이트 검색 하나뿐");
  assert.equal((body.match(/\sname=/g) ?? []).length, 0);
  const form = TEMPLATE.slice(TEMPLATE.indexOf('<section id="bt-form"'), TEMPLATE.indexOf('<section id="bt-result"'));
  for (const b of form.match(/<button\b[^>]*>/g)) assert.match(b, /type="button"/);
  assert.ok(form.includes("고른 값대·면적은 이 브라우저 안에서만 쓰며, 주소에 붙이거나 분석 도구로 보내지 않습니다."));
  assert.ok(form.includes("The band and size you pick are used only in this browser; they are not added to the address or sent to analytics."));
});

test("장 전용 JS 둘: 배포 사본 gzip 각 ≤2,048B, 이 장만 defer 로 한 번씩(줄 → 배선 순), 서비스워커 사전캐시 밖 (#681, cto 답 3)", () => {
  for (const [i, f] of JS.entries()) {
    const size = gzipSync(SHIPPED[i], { level: 9 }).length;
    assert.ok(size <= 2048, `docs/${f} gzip ${size}B`);
    assert.equal(TEMPLATE.split(`<script src="./${f}" defer></script>`).length, 2, f);
    assert.ok(!read("docs/sw.js").includes(f), `${f} 가 sw.js 에 있다`);
    const users = readdirSync(path.join(repo, "docs")).filter((n) => n.endsWith(".html") && read(`docs/${n}`).includes(`./${f}`));
    assert.deepEqual(users, ["buy-by-budget.html"], f);
  }
  assert.ok(TEMPLATE.indexOf("./budget-rows.js") < TEMPLATE.indexOf("./budget-table.js"), "budget-table.js 가 btRows 를 부른다 - 줄 파일이 먼저");
});

test("JS 는 주소를 쓰지 않고 시계를 읽지 않는다: pushState·replaceState·location 대입·Date 0, 새 분석 이벤트 0 (완료 조건 5, cto 조건 E)", () => {
  for (const src of SHIPPED) {
    assert.doesNotMatch(src, /pushState|replaceState|location(?:\.\w+)?\s*=(?!=)|location\.assign|location\.replace|\bDate\b/);
    assert.doesNotMatch(src, /analytics|gtag|dataLayer/, "이벤트를 새로 두지 않는다(po 명세 ②)");
    assert.doesNotMatch(src, /\bname\b\s*=/);
  }
  assert.ok(SHIPPED[1].includes(`j?.v == ${COUNTS_VERSION}`), "건수 파일 형식 버전이 TS 와 같다");
});

// ---- 건수 파일 --------------------------------------------------------------------------------------------------------------

test("건수 파일: 값대×면적대마다 budgetModel 그대로(머리 M·K·relax·구 건수), 구별 자료 날짜·형식 버전·범위 밖 수 (cto 답 1)", () => {
  const v = views();
  const c = recoCounts(v);
  assert.equal(c.v, COUNTS_VERSION);
  assert.deepEqual(Object.keys(c.b).map(Number), BANDS);
  assert.deepEqual(c.d[0], ["강남구", "gangnam", "Gangnam-gu", "2026-11-14"]);
  assert.equal(c.d.length, 25);
  for (const band of BANDS) {
    for (const area of ["all", ...AREAS]) {
      const m = budgetModel(v, { band, area });
      assert.deepEqual(c.b[band][area], [m.M, m.K, m.relax, m.districts.flatMap((d) => [d.M, d.K])], `${band} ${area}`);
    }
  }
  assert.equal(c.out, 0);
  // 3억 미만·21억 이상 칸은 폼으로 고를 수 없다 - 그 수만 따로 센다(cpo 답 1).
  const wide = files({ ...FIXTURE, 강남구: { apartments: [apt("x|y|1|z", "z", "y", [cell(84, 250_000), cell(59, 21_000), cell(59, 30_000)])] } });
  assert.equal(recoCounts(recoViews(wide)).out, 2);
  assert.equal(recoCountsOf(files(FIXTURE).slice(1)), null, "24구");
  assert.equal(recoCountsOf(null), null);
});

test("건수 단계: reco 를 못 읽으면 ::warning:: 만 남기고 파일 없이 종료 0, 읽으면 파일 하나 - 지난 실행의 낡은 파일은 지운다 (cto 답 4b)", () => {
  const site = buildFixtureSite({ steps: [] });
  try {
    const target = path.join(site.docs, COUNTS_FILE);
    writeFileSync(target, "낡은 것");
    const run = () => spawnSync(process.execPath, [path.join(site.root, "scripts/build-reco-counts.ts")], { cwd: site.root, encoding: "utf8" });
    const bad = run(); // 고정 데이터 사이트의 reco 는 5개뿐이다
    assert.equal(bad.status, 0, bad.stderr);
    assert.match(bad.stdout, /^::warning::\[build-reco-counts\]/m);
    assert.equal(existsSync(target), false, "낡은 파일이 남았다");
    for (const f of files(FIXTURE)) writeFileSync(path.join(site.data, `reco-${DISTRICT_SLUGS[f.district]}.json`), JSON.stringify(f));
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), counts());
    assert.equal(writeRecoCounts({ out: site.root, dataDir: path.join(site.root, "nope") }), null);
  } finally {
    site.cleanup();
  }
});

// ---- 드리프트: JS 출력 = 구운 쪽 (cto 조건 E) ------------------------------------------------------------------------------

test("드리프트: 18값대 × 4면적 × 두 언어에서 JS 의 머리·0곳 문장·구 건수·면적대 표가 구운 쪽(budgetModel·headText)과 같다", async () => {
  const page = await open({ data: DATA() });
  const v = views();
  for (const lang of ["ko", "en"]) {
    await page.lang(lang);
    for (const band of BANDS) {
      for (const area of ["all", ...AREAS]) {
        await page.set("bt-band", band);
        await page.set("bt-area", area);
        const m = budgetModel(v, { band, area });
        const at = `${lang} ${band} ${area}`;
        assert.equal(page.els["bt-head"].textContent, headText(m, lang), at);
        const live = page.els["bt-live"].innerHTML;
        assert.equal(live.includes(m.relax == null ? "\u0000" : relaxText(m.relax, lang)), m.relax != null, `${at} relax`);
        const rows = districtRows(live.slice(live.indexOf(lang === "en" ? "Counts by district" : "자치구별 건수")));
        assert.deepEqual(rows.map((r) => [num(r[3]), num(r[4])]), m.districts.map((d) => [d.M, d.K]), `${at} 구 건수`);
        // 값 낸 곳이 0인 구에는 「줄 보기」가 없다.
        assert.deepEqual(rows.map((r) => r[2] != null), m.districts.map((d) => d.M > 0), `${at} 줄 보기`);
        // 면적대 표는 뺀 곳이 있을 때만(N6), 숫자는 grid 그대로.
        const grid = [...live.matchAll(/<tr><th>([^<]+)<\/th><td>([\d,]+)<\/td><td>([\d,]+)<\/td><\/tr>/g)].slice(0, m.K > 0 ? 3 : 0);
        if (m.K > 0) assert.deepEqual(grid.map((g) => [num(g[2]), num(g[3])]), m.grid.map((g) => [g.M, g.K]), `${at} 면적대 표`);
        assert.equal(live.includes(lang === "en" ? "Counts by floor area" : "전용면적별 건수"), m.K > 0, `${at} 면적대 표 유무`);
      }
    }
  }
  assert.deepEqual(page.writes, []);
});

test("드리프트: 줄 보기 - 구운 예시 줄의 <tr> 이 JS 줄에 글자 그대로 있고, 줄 순서·over_band 가 TS 와 같다", async () => {
  const page = await open({ data: DATA() });
  await page.showRows("노원구");
  assert.deepEqual(page.fetched, ["./data/reco-counts.json", "./data/reco-nowon.json"], "누른 구 파일 하나만 받는다");
  for (const lang of ["ko", "en"]) {
    await page.lang(lang);
    const js = page.els["bt-rows"].innerHTML;
    const baked = budgetTableHtml(budgetModel(views()));
    const block = lang === "ko" ? baked.slice(0, baked.indexOf('<div data-lang="en"')) : baked.slice(baked.indexOf('<div data-lang="en"'));
    const examples = block.slice(block.lastIndexOf("<table")).match(/<tr><td>[\s\S]*?<\/tr>/g);
    assert.equal(examples.length, 3);
    for (const tr of examples) assert.ok(js.includes(tr), `${lang}: ${tr.slice(0, 80)}`);
  }
  // 구·값대마다: JS 줄 = 그 구에서 값대·면적대에 드는 칸을 rowOrder 로 늘어놓은 것, over_band 는 overBand 식 그대로.
  // 은평구 8억대에는 over_band 경계 칸(high = 9억)과 이름이 같고 동만 다른 단지 쌍이 있다(고정 데이터 주석) - 비교식·정렬 키 변이를 잡는다.
  await page.lang("ko");
  let checked = { over: 0, sameName: 0 };
  for (const [district, band] of [["노원구", 7], ["은평구", 8]]) {
    await page.set("bt-band", band);
    await page.set("bt-area", "all");
    await page.showRows(district);
    const view = recoView(files(FIXTURE).find((f) => f.district === district));
    for (const area of ["all", ...AREAS]) {
      await page.set("bt-area", area);
      const want = view.apartments.flatMap((apt) => apt.cells.map((cell) => ({ apt, cell }))).filter(({ cell }) => priceBand(cell.median) === band && (area === "all" || areaBand(cell.areaSqm) === area)).sort(rowOrder);
      const trs = page.els["bt-rows"].innerHTML.match(/<tr><td>[\s\S]*?<\/tr>/g) ?? [];
      assert.equal(trs.length, want.length, `${district} ${area}`);
      want.forEach(({ apt, cell }, i) => {
        const named = apt.name.endsWith(`(${apt.dong})`) || !apt.dong ? apt.name : `${apt.name} (${apt.dong})`;
        assert.ok(trs[i].startsWith(`<tr><td>${named} · `) && trs[i].includes(`<td>${cell.areaSqm}㎡</td>`), `${district} ${area} ${i} 순서: ${named} ${cell.areaSqm}`);
        assert.equal(trs[i].includes("지난 거래 범위가 이 값대 위로 걸침"), overBand(cell, band), `${district} ${area} ${named} ${cell.areaSqm} over_band`);
        if (cell.high === (band + 1) * 10_000) checked.over++;
      });
      if (new Set(want.map((r) => r.apt.name)).size < new Set(want.map((r) => r.apt.id)).size) checked.sameName++;
    }
  }
  assert.ok(checked.over > 0 && checked.sameName > 0, `경계 칸·같은 이름 쌍을 한 번도 안 봤다 ${JSON.stringify(checked)}`);
  // 경계 칸은 걸침이다(>=). 갈현동이 불광동보다 앞이다(동 비교) - 위 순서 단언과 같은 것을 글자로 한 번 더.
  await page.set("bt-area", "all");
  const ep = page.els["bt-rows"].innerHTML.match(/<tr><td>[\s\S]*?<\/tr>/g);
  assert.deepEqual(ep.map((tr) => tr.match(/^<tr><td>([^<·]+) · /)[1] + " " + tr.match(/<td>([\d.]+)㎡<\/td>/)[1]), ["북한산 (갈현동) 85", "북한산 (불광동) 59", "북한산 (불광동) 84"]);
  assert.ok(ep[1].includes("지난 거래 범위가 이 값대 위로 걸침"), "high = 9억 경계 칸이 걸침이 아니다");
});

test("생애최초 체크는 대출 상한·필요 현금 두 열만 바꾸고 기본은 꺼짐(일반 값)이다 (cpo 답 3)", async () => {
  const page = await open({ data: DATA() });
  await page.showRows("노원구");
  const general = page.els["bt-rows"].innerHTML;
  assert.ok(general.includes("<td>2억 9,000만원</td>") && !general.includes("<td>4억원</td>"));
  await page.set("bt-first", true);
  const first = page.els["bt-rows"].innerHTML;
  assert.ok(first.includes("<td>4억원</td>") && !first.includes("<td>2억 9,000만원</td>"));
  // 다른 열은 그대로다: 두 열을 걷어 내면 같은 글자.
  const drop = (h) => h.replace(/<td>(?:2억 9,000만원|4억원)<\/td><td>[^<]*<\/td>/g, "");
  assert.equal(drop(general), drop(first));
});

// ---- 주소·분석 (완료 조건 5) ------------------------------------------------------------------------------------------------

test("#bN 은 처음 한 번만 읽는다: #b9 → 9억대, #b3·#b20 은 경계, #b99·#bx·#b07·#b2 는 기본 7억대", async () => {
  for (const [hash, band] of [["#b9", "9"], ["#b3", "3"], ["#b20", "20"], ["#b99", "7"], ["#bx", "7"], ["#b07", "7"], ["#b2", "7"], ["", "7"]]) {
    const page = await open({ hash, data: DATA() });
    assert.equal(page.els["bt-band"].value, band, hash);
    assert.ok(page.els["bt-head"].textContent.startsWith(`${band}억대·전체 면적:`), hash);
  }
});

test("폼 조작·줄 보기·언어 전환 뒤에도 주소는 그대로이고, #b9 로 열어도 page_location·page_view 에 # 가 없고 이벤트 params 에 값대·면적·구가 없다", async () => {
  const page = await open({ hash: "#b9", data: DATA(), analytics: true });
  await page.set("bt-band", 12);
  await page.set("bt-area", "over-85");
  await page.set("bt-first", true);
  await page.set("bt-band", 7);
  await page.showRows("마포구");
  await page.lang("en");
  page.els["bt-go"].fire("click");
  page.runTimers();
  assert.deepEqual(page.writes, [], "주소를 바꾸는 호출");
  assert.equal(page.sandbox.location.href, "https://x/buy-by-budget.html#b9");
  const layer = page.sandbox.dataLayer.map((args) => Array.from(args));
  const params = layer.filter(([kind]) => kind === "config" || kind === "event").map((a) => a[2]);
  assert.ok(params.length >= 2, "config·page_view");
  const ALLOWED = ["page_location", "page_referrer", "page_title", "send_page_view", "content_group", "traffic_type", "debug_mode"];
  for (const p of params) {
    assert.deepEqual(Object.keys(p).filter((k) => !ALLOWED.includes(k)), [], JSON.stringify(p));
    assert.equal(p.page_location, "https://x/buy-by-budget.html", "page_location 에 해시");
  }
  assert.deepEqual(layer.filter(([kind]) => kind === "event").map((a) => a[1]), ["page_view"], "새 이벤트 0");
  const text = JSON.stringify(layer);
  for (const bad of ["#b", "under-60", "60-85", "over-85", "마포구", "mapo", "first"]) assert.ok(!text.includes(bad), bad);
});

test("실거래 검색 링크는 구·단지·동만 싣는다 - 값대·면적·생애최초 없음, 별칭 이름 링크 동반 (완료 조건 5, cto 5-(i))", async () => {
  const page = await open({ data: DATA() });
  await page.set("bt-first", true);
  await page.showRows("마포구");
  const hrefs = [...page.els["bt-rows"].innerHTML.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
  assert.equal(hrefs.length, 4, "두 칸 × (본 이름 + 별칭)");
  for (const h of hrefs) {
    const u = new URL(h, "https://x/");
    assert.equal(u.pathname, "/deal-search.html");
    assert.deepEqual([...u.searchParams.keys()], ["district", "apt", "dong"], h);
  }
  assert.ok(hrefs.some((h) => new URL(h, "https://x/").searchParams.get("apt") === "신촌숲아이파크"));
});

// ---- 실패 상태 -------------------------------------------------------------------------------------------------------------

test("건수 파일 503: 구운 보기를 그대로 두고 실패 문구, JS 꺼짐 안내는 숨긴다 (po 명세 ① 실패 상태)", async () => {
  const page = await open({ data: {} });
  assert.equal(page.els["bt-baked"].hidden, false);
  assert.equal(page.els["bt-nojs"].hidden, true);
  assert.equal(page.els["bt-head"].textContent, "");
  assert.equal(page.els["bt-live"].innerHTML, '<p class="content-notice">건수를 불러오지 못했습니다. 위 숫자는 기본 조건(7억대·전체 면적) 기준입니다.</p>');
  await page.lang("en");
  assert.ok(page.els["bt-live"].innerHTML.includes("Could not load counts; the figures above are for the default (₩0.7B band, all sizes)."));
  const wrong = await open({ data: { "reco-counts": { ...counts(), v: COUNTS_VERSION + 1 } } });
  assert.equal(wrong.els["bt-baked"].hidden, false, "형식 버전이 다르면 읽지 않는다");
});

test("구 파일 503·모양 다름: 그 구 자리에 실패 문구와 실거래 검색 링크, 나머지는 그대로", async () => {
  for (const nowon of [undefined, { ...files(FIXTURE).find((f) => f.district === "노원구"), schemaVersion: 2 }, { ...files(FIXTURE).find((f) => f.district === "노원구"), cellFields: ["areaSqm"] }]) {
    const data = { ...DATA(), "reco-nowon": nowon };
    const page = await open({ data });
    await page.showRows("노원구");
    assert.equal(page.els["bt-baked"].hidden, true);
    assert.equal(page.els["bt-rows"].innerHTML, `<p class="content-notice"><a href="./deal-search.html?district=${encodeURIComponent("노원구")}">이 구의 줄을 불러오지 못했습니다. 실거래 검색에서 볼 수 있습니다 →</a></p>`);
    assert.ok(page.els["bt-head"].textContent.startsWith("7억대·전체 면적: 조건에 드는 단지·평형 18곳"));
  }
});

test("구마다 자료 날짜가 다르면 그 구 줄에 날짜를 붙인다(구운 쪽과 같은 규칙)", async () => {
  const late = files(FIXTURE).map((f) => (f.district === "강남구" ? { ...f, asOf: { ...f.asOf, deals: "2026-11-13" } } : f));
  const page = await open({ data: { ...DATA(), "reco-counts": recoCounts(recoViews(late)) } });
  const live = page.els["bt-live"].innerHTML;
  assert.ok(live.includes("<tr><th>강남구 <small>~2026-11-13</small></th>"));
  assert.equal((live.match(/<small>~/g) ?? []).length, 1);
  assert.ok(budgetTableHtml(budgetModel(recoViews(late))).includes("강남구 <small>~2026-11-13</small>"), "구운 쪽도 같은 표시");
});

// ---- 글자 -----------------------------------------------------------------------------------------------------------------

test("JS 가 그리는 글자(두 언어·0곳·줄·실패)와 틀의 data-msg 에 금지어·「후보」·순번 0, 실거주는 「검증 전」, 범위 밖 한 줄 (완료 조건 4, cpo 답 1)", async () => {
  for (const attr of ["data-msg", "data-msg-en", "data-cols", "data-cols-en"]) {
    for (const id of ["bt-live", "bt-rows"]) {
      const v = attrsOf(id)[attr];
      if (v) assertNoBanned(v, `${id} ${attr}`);
    }
  }
  const wide = files({ ...FIXTURE, 강남구: { apartments: [apt("x|y|1|z", "z", "y", [cell(84, 250_000)])] } });
  const page = await open({ data: { ...DATA(), "reco-counts": recoCounts(recoViews(wide)) } });
  await page.showRows("노원구");
  for (const lang of ["ko", "en"]) {
    await page.lang(lang);
    for (const [band, area] of [[7, "all"], [9, "over-85"]]) {
      await page.set("bt-band", band);
      await page.set("bt-area", area);
      // JS 가 그린 네 자리 각각(완료 조건 4, clo PR #879): innerHTML 은 태그·속성째 본다 - 링크 글자·캡션·버튼까지.
      const out = { "bt-head": page.els["bt-head"].textContent, "bt-range": page.els["bt-range"].textContent, "bt-live": page.els["bt-live"].innerHTML, "bt-rows": page.els["bt-rows"].innerHTML };
      for (const [id, v] of Object.entries(out)) {
        // 9억대·85㎡ 초과는 0곳 조건이라 노원구 줄이 없다(그 경우 줄 자리는 비는 것이 맞다).
        if (!(id === "bt-rows" && band !== 7)) assert.ok(v.length > 0, `${lang} ${band} ${area} ${id}: 비었다 - 금지어 검사가 허공을 친다`);
        assertNoBanned(v, `${lang} ${band} ${area} ${id}`);
      }
      const shown = Object.values(out).join(" ").replace(/<[^>]+>/g, " ");
      for (const w of ["미래가치", "균형", "Future value", "Balanced", "같은 값대·면적대 칸", "Same-band cells"]) assert.ok(!shown.includes(w), w);
      assert.ok(shown.includes(lang === "ko" ? "실거주 항목: 검증 전" : "Day-to-day living: not yet verified"));
    }
    assert.equal(page.els["bt-range"].textContent, lang === "ko" ? "고를 수 있는 값대(3억대~20억대) 밖에 값을 낸 곳이 1곳 더 있습니다." : "1 more priced pairs fall outside the bands you can pick (₩0.3B–₩2.0B bands).");
  }
  // 값대 select 의 글자도 언어를 따른다.
  assert.equal(page.els["bt-band"].options[4].textContent, "₩0.7B band (₩0.7–0.8B)");
  await page.lang("ko");
  assert.equal(page.els["bt-band"].options[4].textContent, "7억대(7억~8억)");
  assert.equal(page.els["bt-area"].options[0].textContent, "전체 면적");
});

// ---- 좁은 화면 (cto PR #879 수정 요청) -------------------------------------------------------------------------------------
// 320px 한·영에서 근거표 폼이 359/459px 로 넘쳤다(라벨이 줄바꿈 없이 select 와 한 줄). 브라우저 측정은 판정에서 하고, 여기서는 그 측정이 기대는
// CSS 구조를 정적으로 지킨다: (1) 560px 이하 세로 쌓기 규칙 셋(칸·라벨·입력)이 #bt-form 을 품는다 (2) 값대 select 의 상한 풀기는 561px 이상에서만이고
// 그 분기점이 세로 쌓기의 560px 와 맞붙는다(사이에 잘리는 폭이 없다) (3) 폼의 칸이 전부 #bt-form 안의 .search-field 이고 체크 칸만 .toggle 이다.
test("좁은 화면: 560px 이하 세로 쌓기 규칙 셋이 #bt-form 을 품고, 값대 상한 풀기는 561px 부터다 (320px 넘침 0, cto PR #879)", () => {
  const css = read("docs/style.css");
  const narrow = [...css.matchAll(/@media \(max-width: 560px\) \{/g)].map((m) => css.slice(m.index, css.indexOf("\n  }\n", m.index)));
  const stack = narrow.find((b) => b.includes(".search-field:not(.toggle) {"));
  assert.ok(stack, "560px 세로 쌓기 블록이 없다");
  for (const tail of [".search-field:not(.toggle) {", ".search-field:not(.toggle) label {", ".search-field:not(.toggle) :is(input, select) {"]) {
    const line = stack.split("\n").find((l) => l.trim().endsWith(tail));
    assert.ok(line, tail);
    assert.match(line, /^\s*:is\([^)]*#bt-form[^)]*\) /, `${tail} 의 :is() 목록에 #bt-form 이 없다`);
  }
  assert.match(stack, /:is\(input, select\) \{\s*width: 100%;\s*max-width: none;/);
  // #bt-band 는 min-width 561px 블록 안에서만 상한을 푼다.
  const free = [...css.matchAll(/#bt-band \{\s*max-width: none;/g)];
  assert.equal(free.length, 1);
  assert.match(css.slice(0, free[0].index), /@media \(min-width: 561px\) \{\s*$/, "#bt-band 상한 풀기가 561px 블록 밖이다");
  // 폼의 칸: select 둘·버튼은 .search-field(세로 쌓기 대상), 체크 칸만 .toggle 이다.
  const form = TEMPLATE.slice(TEMPLATE.indexOf('<section id="bt-form"'), TEMPLATE.indexOf("</section>", TEMPLATE.indexOf('<section id="bt-form"')));
  const fields = [...form.matchAll(/<div class="(search-field[^"]*)">([\s\S]*?)<\/div>/g)];
  assert.deepEqual(fields.map((f) => [f[1], f[2].match(/id="(bt-[\w-]+)"/)[1]]), [["search-field", "bt-band"], ["search-field", "bt-area"], ["search-field toggle", "bt-first"], ["search-field", "bt-go"]]);
});
