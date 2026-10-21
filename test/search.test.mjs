import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { buildPayload, complexesByDistrict, squash } from "../scripts/build-search-index.ts";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-08-29T00:00:00Z");

// --- 색인 -------------------------------------------------------------------

test("자치구는 '구'를 떼고도, 영문 슬러그로도 찾힌다", () => {
  const { entries } = buildPayload({ byDistrict: {}, now: NOW });
  const gangnam = entries.find((e) => e.text === "강남구");
  assert.ok(gangnam);
  assert.ok(gangnam.also.includes("강남"), "'강남'으로 못 찾는다");
  assert.ok(gangnam.also.includes("gangnam"), "영문 슬러그로 못 찾는다");
});

test("단지는 자치구별로 묶어 이름만 담는다", () => {
  // 항목마다 자치구와 주소를 되풀이하면 색인이 579KB가 됐다. 주소는 브라우저가 만든다.
  const grouped = complexesByDistrict({
    노원구: [{ apt: "상계주공7" }, { apt: "상계주공7" }, { apt: "중계무지개" }],
    강남구: [{ apt: "래미안" }, { apt: "" }],
  });
  assert.deepEqual(grouped.노원구, ["상계주공7", "중계무지개"], "같은 단지를 두 번 담았다");
  assert.deepEqual(grouped.강남구, ["래미안"], "이름 없는 거래를 담았다");
});

test("담는 순서가 매일 같다", () => {
  // 읽어 온 순서대로 담으면 값이 그대로여도 매일 diff가 난다.
  const a = complexesByDistrict({ 노원구: [{ apt: "나" }, { apt: "가" }, { apt: "다" }] });
  const b = complexesByDistrict({ 노원구: [{ apt: "다" }, { apt: "가" }, { apt: "나" }] });
  assert.deepEqual(a.노원구, b.노원구);
});

test("실제 색인이 브라우저가 들고 있어도 되는 크기다", async () => {
  const raw = await readFile(path.join(root, "docs/data/search-index.json"), "utf8");
  const kb = Buffer.byteLength(raw) / 1024;
  // 페이지마다 받는 파일이다. 100KB를 넘으면 항목 대신 다른 방법을 찾아야 한다.
  assert.ok(kb < 100, `색인이 ${kb.toFixed(0)}KB다`);

  const data = JSON.parse(raw);
  const complexes = Object.values(data.complexes).reduce((n, v) => n + v.length, 0);
  assert.ok(complexes > 1000, `단지가 ${complexes}개뿐이다`);
});

test("색인의 화면 주소가 전부 실재한다", async () => {
  const files = new Set((await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html")));
  const { entries } = buildPayload({ byDistrict: {}, now: NOW });
  for (const entry of entries) {
    const file = entry.href.replace("./", "").split(/[?#]/)[0];
    assert.ok(files.has(file), `${entry.text} → 없는 페이지 ${file}`);
  }
});

// --- 찾는 쪽 ----------------------------------------------------------------

const INDEX = {
  entries: [
    { kind: "district", text: "강남구", href: "./district-gangnam.html", also: ["강남", "gangnam"] },
    { kind: "district", text: "노원구", href: "./district-nowon.html", also: ["노원"] },
    { kind: "district", text: "송파구", href: "./district-songpa.html", also: ["송파"] },
    { kind: "budget", text: "10억대 아파트", href: "./budget-10eok.html", also: ["10억", "10"] },
    { kind: "screen", text: "전세 vs 월세", href: "./jeonse-vs-wolse.html", also: ["전환율"] },
  ],
  dongs: { 강남구: ["역삼동"], 노원구: ["상계동"] },
  complexes: { 강남구: ["강남래미안", "개포주공"], 노원구: ["상계주공7"] },
};

/** search.js를 가짜 DOM에 올려 검색 동작만 꺼내 본다. */
async function runSearch(query) {
  const source = await readFile(path.join(root, "docs/search.js"), "utf8");
  const listeners = {};
  const el = (extra = {}) => ({
    addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn), undefined),
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    contains: () => true,
    innerHTML: "",
    hidden: true,
    value: "",
    ...extra,
  });
  const input = el({ value: query });
  const list = el();
  const form = el({ querySelector: (sel) => (sel === "input" ? input : list) });

  const events = [];
  vm.runInNewContext(source, {
    document: { querySelector: (sel) => (sel === ".site-search" ? form : null), addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => INDEX }),
    location: { href: "" },
    URLSearchParams,
    window: {
      analytics: {
        debouncedEvent: (name, params) => events.push({ name, params }),
        termShape: (term) => ({ search_term_length: String(term.trim().length) }),
      },
    },
  });

  for (const fn of listeners.input ?? []) await fn({});
  await new Promise((r) => setTimeout(r, 5));
  runSearch.events = events;
  return list.innerHTML;
}

test("자치구를 친 사람에게 자치구 페이지를 먼저 준다", async () => {
  const html = await runSearch("강남");
  const first = /<span class="hit">([^<]*)</.exec(html)?.[1];
  // "강남"을 친 사람은 대개 강남구를 찾지, 강남이 이름에 든 단지를 찾지 않는다.
  assert.equal(first, "강남구", `첫 결과가 ${first}다`);
  assert.match(html, /강남래미안/, "단지가 아예 안 나온다");
});

test("단지 이름을 자치구 고르지 않고 서울 전체에서 찾는다", async () => {
  // 전에는 deal-search에서 자치구를 먼저 골라야 단지명 검색이 동작했다.
  const html = await runSearch("상계주공");
  assert.match(html, /상계주공7/);
  assert.match(html, /district=%EB%85%B8%EC%9B%90%EA%B5%AC/, "어느 구인지 주소에 안 담겼다");
  assert.match(html, /class="where">노원구</, "어느 구인지 안 보여준다");
});

test("예산과 지표 이름으로도 들어간다", async () => {
  assert.match(await runSearch("10억"), /budget-10eok\.html/);
  assert.match(await runSearch("전환율"), /jeonse-vs-wolse\.html/);
});

test("빈 검색어에는 아무것도 띄우지 않는다", async () => {
  assert.equal(await runSearch("   "), "");
});

test("공백과 대소문자를 무시하고 맞춘다", () => {
  assert.equal(squash(" Gangnam 구 "), "gangnam구");
});

// --- 정해진 이름이 아닌 말 --------------------------------------------------

test("동 이름으로 찾는다", async () => {
  // 사람은 "강남구"보다 "역삼동"으로 동네를 부른다.
  const html = await runSearch("역삼동");
  assert.match(html, /역삼동/);
  assert.match(html, /dong=%EC%97%AD%EC%82%BC%EB%8F%99/, "동 조건이 주소에 안 담겼다");
});

test("이름으로 딱 맞으면 조건 추측을 얹지 않는다", async () => {
  // "상계동"을 친 사람에게 "노원구 상계동 (조건으로 찾기)"를 먼저 주면 같은 말이 두 번이다.
  const html = await runSearch("상계동");
  const first = /<span class="hit">([^<]*)</.exec(html)?.[1];
  assert.equal(first, "상계동");
});

test("금액과 면적을 조건으로 읽는다", async () => {
  assert.match(await runSearch("3억5천"), /3\.5억대/);
  assert.match(await runSearch("84㎡"), /84㎡/);
  // 34평을 쳤는데 112㎡라고 답하면 맞게 읽혔는지 알 수 없다.
  assert.match(await runSearch("34평"), /34평/);
  assert.match(await runSearch("34평"), /area=85-135/, "평을 제곱미터로 환산해 구간을 못 잡았다");
});

test("두 가지를 같이 쳐도 받는다", async () => {
  const html = await runSearch("강남구 84㎡");
  assert.match(html, /강남구 · 84㎡/);
  assert.match(html, /district=%EA%B0%95%EB%82%A8%EA%B5%AC/);
  assert.match(html, /area=60-85/);
});

test("긴 이름이 짧은 이름에 먹히지 않는다", async () => {
  const html = await runSearch("상계동 60㎡");
  assert.match(html, /상계동/);
  assert.match(html, /area=60(?!-)/);
});

test("못 찾으면 무엇을 찾을 수 있는지 말한다", async () => {
  // 전에는 드롭다운이 그냥 사라졌다 - 고장 났는지 잘못 쳤는지 알 수 없었다.
  const html = await runSearch("학군");
  assert.match(html, /찾지 못했습니다|site-search-miss/);
  assert.match(html, /자치구·동·단지 이름/, "무엇을 찾을 수 있는지 안 알려준다");
  assert.match(html, /다루지 않습니다/, "없는 데이터를 없다고 말하지 않는다");
  assert.match(html, /학군/, "친 글자를 되비추지 않는다");
  assert.match(html, /보유세·양도세 계산은 이 사이트가 다루지 않습니다/, "세금을 친 사람에게 없는 것을 말하지 않는다");
  assert.match(html, /취득세·중개보수는 예산대 화면/);
});

test("못 찾은 검색은 세되 친 글자는 보내지 않는다", async () => {
  await runSearch("학군");
  const miss = runSearch.events.find((e) => e.name === "search_miss");
  assert.ok(miss, "못 찾은 검색을 기록하지 않는다");
  assert.equal(miss.params.search_term, undefined);
  assert.equal(miss.params.search_term_length, "2");
});

test("빈 검색어에는 안내도 띄우지 않는다", async () => {
  assert.equal(await runSearch("   "), "");
});

test("색인의 동이 실제 자치구에 붙어 있다", async () => {
  const data = JSON.parse(await readFile(path.join(root, "docs/data/search-index.json"), "utf8"));
  const districts = new Set(
    buildPayload({ byDistrict: {}, now: NOW }).entries.filter((e) => e.kind === "district").map((e) => e.text)
  );
  const dongs = Object.entries(data.dongs ?? {});
  assert.ok(dongs.length >= 20, `동을 담은 자치구가 ${dongs.length}개뿐이다`);
  for (const [district, names] of dongs) {
    assert.ok(districts.has(district), `${district}는 자치구가 아니다`);
    assert.ok(names.length > 0);
  }
});

test("사이트 안에 답이 있는 주제어로도 찾아진다 (PO 검토 #33)", () => {
  const { entries } = buildPayload({ byDistrict: {}, now: NOW });
  const words = entries.flatMap((e) => [e.text, ...(e.also ?? [])]);
  for (const w of ["취득세", "대출 한도", "잔금", "신혼", "디딤돌"]) assert.ok(words.includes(w), `${w}로는 아무것도 안 찾아진다`);
});

test("두 단어 질문: 자치구 둘이면 갈아타기, 전세·월세면 전세 vs 월세 (#55)", async () => {
  const pair = await runSearch("노원 송파");
  assert.match(pair, /노원구 → 송파구/, "자치구 둘을 못 읽었다");
  assert.match(pair, /switch-house\.html\?from=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;to=%EC%86%A1%ED%8C%8C%EA%B5%AC|switch-house\.html\?from=%EB%85%B8%EC%9B%90%EA%B5%AC&to=%EC%86%A1%ED%8C%8C%EA%B5%AC/);
  const rent = await runSearch("전세 월세");
  assert.match(rent, /jeonse-vs-wolse\.html/);
  assert.doesNotMatch(await runSearch("노원 노원"), /switch-house/, "같은 구 둘을 갈아타기로 보냈다");
});

// --- 영어 모드의 검색창 안내문·라벨 (#291) -------------------------------------
//
// 구운 HTML은 ko 글자를 박고, search.js가 html[lang]을 보고 영어로 바꾼다(nav.js의 머리 버튼 라벨과 같은 방식).
// 문안은 po 확정(#291 댓글 6244732875): 영어 예시는 한국어로 둔다 - 색인이 한국어 이름뿐이라서.

const KO_HINT = "자치구·단지·예산으로 찾기 (예: 강남구, 래미안, 10억)";
const EN_HINT = "Find district, complex, budget (Korean, e.g. 강남구, 래미안, 10억)";
const EN_SHORT = "Find district, complex, budget";

/** search.js를 가짜 문서에 올리고 lang 속성과 폭을 손으로 바꿀 수 있게 돌려준다. */
async function mountSearch({ lang = "ko", narrow = false } = {}) {
  const source = await readFile(path.join(root, "docs/search.js"), "utf8");
  const mq = { matches: narrow, fns: [], addEventListener(type, fn) { if (type === "change") this.fns.push(fn); } };
  const observers = [];
  const state = { lang };
  const documentElement = { getAttribute: (k) => (k === "lang" ? state.lang : null) };
  const input = { placeholder: KO_HINT, value: "", addEventListener() {}, setAttribute() {}, removeAttribute() {} };
  const label = { textContent: "무엇이든 찾기" };
  const list = { innerHTML: "", hidden: true, addEventListener() {}, setAttribute() {}, removeAttribute() {}, contains: () => true };
  const form = {
    addEventListener() {},
    querySelector: (sel) => (sel === "input" ? input : sel === "label" ? label : list),
    contains: () => true,
  };
  vm.runInNewContext(source, {
    document: { documentElement, querySelector: (sel) => (sel === ".site-search" ? form : null), addEventListener() {} },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    window: { matchMedia: () => mq },
    fetch: async () => ({ ok: true, json: async () => INDEX }),
    location: { href: "" },
    URLSearchParams,
  });
  return {
    input,
    label,
    setLang(next) { state.lang = next; for (const fn of observers) fn(); },
    setNarrow(next) { mq.matches = next; for (const fn of mq.fns) fn(); },
  };
}

test("영어 모드로 열면 안내문과 라벨이 확정 영어 문안이다", async () => {
  const page = await mountSearch({ lang: "en" });
  assert.equal(page.input.placeholder, EN_HINT);
  assert.equal(page.label.textContent, "Search anything");
});

test("한국어 모드는 구운 글자 그대로다", async () => {
  const wide = await mountSearch({ lang: "ko" });
  assert.equal(wide.input.placeholder, KO_HINT);
  assert.equal(wide.label.textContent, "무엇이든 찾기");
  const narrow = await mountSearch({ lang: "ko", narrow: true });
  assert.equal(narrow.input.placeholder, "자치구·단지·예산으로 찾기", "좁은 화면의 한국어 동작이 달라졌다");
  assert.equal(narrow.label.textContent, "무엇이든 찾기");
});

test("언어를 바꾸면 새로 고치지 않아도 안내문이 따라 바뀌고 좁은 폭 판정을 다시 한다", async () => {
  const page = await mountSearch({ lang: "ko" });
  page.setLang("en");
  assert.equal(page.input.placeholder, EN_HINT);
  assert.equal(page.label.textContent, "Search anything");
  page.setNarrow(true);
  assert.equal(page.input.placeholder, EN_SHORT, "좁은 화면에서 영어 예시를 떼지 않았다");
  assert.equal(EN_SHORT.length, 30);
  page.setLang("ko");
  assert.equal(page.input.placeholder, "자치구·단지·예산으로 찾기", "좁은 화면에서 영어로 바꾼 뒤 한국어로 못 돌아온다");
  assert.equal(page.label.textContent, "무엇이든 찾기");
  page.setLang("en");
  page.setNarrow(false);
  assert.equal(page.input.placeholder, EN_HINT);
});

test("검색창을 싣는 장은 모두 한국어 안내문·라벨로 구워져 있고 예시가 괄호 안에 있다", async () => {
  const dir = path.join(root, "docs");
  let seen = 0;
  for (const f of (await readdir(dir)).filter((n) => n.endsWith(".html"))) {
    const html = await readFile(path.join(dir, f), "utf8");
    if (!html.includes('class="site-search"')) continue;
    seen += 1;
    assert.match(html, /<html lang="ko"/, `${f}: 구운 lang 이 ko 가 아니다`);
    assert.ok(html.includes(`placeholder="${KO_HINT}"`), `${f}: 구운 안내문이 바뀌었다`);
    assert.ok(html.includes(">무엇이든 찾기</label>"), `${f}: 구운 라벨이 바뀌었다`);
  }
  assert.ok(seen > 60, `검색창을 실은 장이 ${seen}장뿐이다 - 검사가 헛돈다`);
});

// --- 영어 모드의 검색 결과 쪽 문안 (#291, 둘째) -------------------------------------
//
// 결과 보조 줄·결과 제목·N평·N억대·결과 없음 두 문단. 문안은 po 확정(#291 댓글 6245588745).
// 결과 항목 이름(자치구·단지)은 색인이 한국어뿐이라 한국어 그대로다.

/** 언어를 정해 search.js 를 올리고, 글자를 치고, 중간에 언어를 바꿀 수 있게 한다. */
async function searchSession({ lang = "ko" } = {}) {
  const source = await readFile(path.join(root, "docs/search.js"), "utf8");
  const listeners = {};
  const observers = [];
  const state = { lang };
  const events = [];
  const el = (extra = {}) => ({
    addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn), undefined),
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    contains: () => true,
    innerHTML: "",
    hidden: true,
    value: "",
    ...extra,
  });
  const input = el({ placeholder: "자치구·단지·예산으로 찾기 (예: 강남구, 래미안, 10억)" });
  const list = el();
  const label = { textContent: "무엇이든 찾기" };
  const form = el({ querySelector: (sel) => (sel === "input" ? input : sel === "label" ? label : list) });
  vm.runInNewContext(source, {
    document: {
      documentElement: { getAttribute: (k) => (k === "lang" ? state.lang : null) },
      querySelector: (sel) => (sel === ".site-search" ? form : null),
      addEventListener() {},
    },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    fetch: async () => ({ ok: true, json: async () => INDEX }),
    location: { href: "" },
    URLSearchParams,
    window: {
      analytics: { debouncedEvent: (name) => events.push(name), termShape: () => ({}) },
    },
  });
  return {
    events,
    get html() { return list.innerHTML; },
    async type(query) {
      input.value = query;
      for (const fn of listeners.input ?? []) await fn({});
      await new Promise((r) => setTimeout(r, 5));
      return list.innerHTML;
    },
    setLang(next) { state.lang = next; for (const fn of observers) fn(); },
  };
}

const EN_CAN =
  "Only Korean names are searched: district, neighbourhood or complex name, budget (8억), size (84㎡, 34평). You can combine two: 강남구 84㎡. No Korean keyboard? Try Deal search.";
const EN_CANNOT =
  "This site does not cover schools, transit, redevelopment, or holding-tax and capital-gains-tax calculations. Official prices (공시가격) are not available yet. Acquisition tax and brokerage fee are on the budget pages (try 10억).";
const KO_CAN = "자치구·동·단지 이름, 예산(8억), 면적(84㎡·34평)으로 찾을 수 있습니다. 두 가지를 같이 쳐도 됩니다 &mdash; 강남구 84㎡";
const KO_CANNOT =
  "학군·교통·재건축 정보와 보유세·양도세 계산은 이 사이트가 다루지 않습니다. 공시가격은 아직 없고, 취득세·중개보수는 예산대 화면(예: 10억)에 있습니다.";

test("영어 모드: 조건으로 찾기 카드의 보조 줄과 평·억대가 영어다", async () => {
  const s = await searchSession({ lang: "en" });
  const eight = await s.type("8억");
  assert.match(eight, /class="hit">₩800M band</, "8억대 -> ₩800M band");
  assert.match(eight, /class="where">Search by conditions</);
  assert.match(await s.type("8.5억"), /class="hit">₩850M band</, "소수 억대를 반올림해 M 으로 못 옮겼다");
  assert.match(await s.type("12억"), /class="hit">₩1,200M band</, "천 단위 쉼표가 없다");
  assert.match(await s.type("34평"), /class="hit">34 pyeong</);
  assert.match(await s.type("84㎡"), /class="hit">84㎡</, "㎡ 라벨은 그대로여야 한다");
  const combo = await s.type("강남구 8억 34평");
  assert.match(combo, /강남구 · ₩800M band · 34 pyeong/);
  assert.doesNotMatch(combo, /억대|34평|조건으로/, "영어 모드에 한국어 문안이 남았다");
});

test("영어 모드: 전세 vs 월세와 갈아타기 카드가 영어 제목·보조 줄이다", async () => {
  const s = await searchSession({ lang: "en" });
  const rent = await s.type("전세 월세");
  assert.match(rent, /class="hit">Jeonse vs Monthly Rent</);
  assert.match(rent, /class="where">Which is cheaper</);
  assert.match(rent, /jeonse-vs-wolse\.html/, "주소가 바뀌면 안 된다");
  const move = await s.type("노원 송파");
  assert.match(move, /class="hit">노원구 → 송파구</, "자치구 이름은 한국어 그대로다");
  assert.match(move, /class="where">Moving house: how far it rose</);
  assert.match(move, /switch-house\.html/);
});

test("영어 모드: 결과 없음 두 문단이 확정 문안이고 머리 글자는 data-note 로 준다", async () => {
  const s = await searchSession({ lang: "en" });
  const html = await s.type("Seocho");
  assert.ok(html.includes(`<p class="miss-can">${EN_CAN}</p>`), "miss-can 문안이 다르다");
  assert.ok(html.includes(`<p class="miss-cannot">${EN_CANNOT}</p>`), "miss-cannot 문안이 다르다");
  assert.ok(html.includes(`<p class="miss-head" data-note=" — Not found">Seocho</p>`), "머리 글자가 영어가 아니다");
  assert.doesNotMatch(html, /찾지 못했습니다|다루지 않습니다/, "영어 모드에 한국어 문안이 남았다");
  assert.ok(EN_CAN.includes("(8억)") && EN_CAN.includes("(84㎡, 34평)") && EN_CAN.includes("강남구 84㎡"), "한국어 예시는 풀지 않는다");
});

test("한국어 모드: 결과 카드와 결과 없음 글자는 이전과 같다", async () => {
  const s = await searchSession({ lang: "ko" });
  const eight = await s.type("8.5억");
  assert.match(eight, /class="hit">8\.5억대</);
  assert.match(eight, /class="where">조건으로 찾기</);
  assert.match(await s.type("8억"), /class="hit">8억대</);
  assert.match(await s.type("34평"), /class="hit">34평</);
  const rent = await s.type("전세 월세");
  assert.match(rent, /class="hit">전세 vs 월세</);
  assert.match(rent, /class="where">어느 쪽이 싼가</);
  assert.match(await s.type("노원 송파"), /class="where">갈아타기 — 갈 동네는 얼마나 올랐나</);
  const miss = await s.type("학군");
  assert.ok(miss.includes(`<p class="miss-head" data-note=" — 찾지 못했습니다">학군</p>`));
  assert.ok(miss.includes(`<p class="miss-can">${KO_CAN}</p>`));
  assert.ok(miss.includes(`<p class="miss-cannot">${KO_CANNOT}</p>`));
});

test("목록이 떠 있는 채로 언어를 바꾸면 새로 고침 없이 결과 문안이 따라 바뀌고 못 찾음을 두 번 세지 않는다", async () => {
  const s = await searchSession({ lang: "ko" });
  await s.type("8억");
  assert.match(s.html, /8억대/);
  s.setLang("en");
  assert.match(s.html, /₩800M band/, "영어로 바꿨는데 카드가 그대로다");
  assert.match(s.html, /Search by conditions/);
  s.setLang("ko");
  assert.match(s.html, /8억대/);
  assert.match(s.html, /조건으로 찾기/);

  await s.type("학군");
  assert.deepEqual(s.events, ["search_miss"]);
  s.setLang("en");
  assert.ok(s.html.includes(EN_CAN), "결과 없음이 영어로 안 바뀌었다");
  assert.ok(s.html.includes('data-note=" — Not found"'));
  s.setLang("ko");
  assert.ok(s.html.includes(KO_CAN));
  assert.deepEqual(s.events, ["search_miss"], "언어를 바꿀 때 못 찾음을 다시 셌다");
});

test("스타일시트는 결과 없음 머리 글자를 data-note 에서 읽고 한국어 글자를 박지 않는다", async () => {
  const css = await readFile(path.join(root, "docs/style.css"), "utf8");
  const rule = /\.site-search-miss \.miss-head::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /content:\s*attr\(data-note\)/, "::after 가 data-note 를 읽지 않는다");
  assert.doesNotMatch(css, /찾지 못했습니다/, "style.css 에 박힌 한국어 문안이 남았다");
});
