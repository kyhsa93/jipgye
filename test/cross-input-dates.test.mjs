import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { measure, words } from "../scripts/prose-share.mjs";
import { STALE_DAYS, readDataSources } from "../scripts/source-age.mjs";
import { CROSS_PAGES, baselineFor, crossStampHtml } from "../scripts/updated-stamp.mjs";

/**
 * 교차값(실거래 x 금리)에 입력별 기준일을 병기하고, 입력 하나라도 낡으면 글로 경고한다 (#154, #107·#111 후속).
 *
 * #111의 규칙을 그대로 따른다: 기준일은 빌드가 HTML에 글자로 박고, "n일 전 자료"는 보는 순간 nav.js가
 * KST 오늘로 센다(빌드·배포가 멈추면 HTML이 얼어도 경고가 사라지지 않게). 날짜 의존 검사는 넣지 않는다(#8) -
 * 오늘은 전부 인자로 주입하고, 저장소 docs/는 '생성물이 소스와 맞나'만 본다(오늘과 비교하지 않는다).
 */

const root = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(root, "docs");

/** 교차값이 있는 화면 전수: 금리로 계산한 값이 실거래 값과 한 문장·한 줄에 나오는 화면. */
const BUDGET_FILES = Array.from({ length: 18 }, (_, i) => `budget-${i + 3}eok.html`);
const EXPECTED = ["jeonse-vs-wolse.html", ...BUDGET_FILES].sort();

const frame = (inner = "") => `<main><section id="budget-section"><div id="budget-result">${inner}</div></section></main>`;
const stampedBudget = (deals, rates) => crossStampHtml(frame(), "budget-10eok.html", deals, rates);

/** nav.js를 가짜 문서에서 돌린다. nowIso는 주입하는 '지금'. 경고·기준일 줄의 최종 상태를 돌려준다. */
async function runNav(html, nowIso, lang = "ko") {
  const source = await readFile(path.join(DOCS, "nav.js"), "utf8");
  const attr = (name) => html.match(new RegExp(`id="cross-basis"[^>]*data-${name}="([^"]*)"`))?.[1] ?? null;
  const has = html.includes('id="cross-basis"');
  const text = html.match(/id="cross-basis"[^>]*>([^<]*)</)?.[1] ?? "";
  const basis = { textContent: text, getAttribute: (n) => (n === "data-deals" ? attr("deals") : n === "data-rates" ? attr("rates") : null) };
  const warn = { hidden: true, textContent: "" };
  const els = has ? { "cross-basis": basis, "cross-warn": warn } : {};
  let current = lang;
  const observers = [];
  class FakeObserver {
    constructor(cb) {
      observers.push(cb);
    }
    observe() {}
  }
  const RealDate = Date;
  const fixed = RealDate.parse(nowIso);
  class FakeDate extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  vm.runInNewContext(source, {
    Date: FakeDate,
    document: {
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: (id) => els[id] ?? null,
      documentElement: { getAttribute: () => current },
    },
    MutationObserver: FakeObserver,
    window: { addEventListener() {} },
  });
  const setLang = (l) => {
    current = l;
    for (const cb of observers) cb([]);
  };
  return { basis, warn, setLang };
}

test("정적 HTML: 입력별 기준일이 '실거래 MM-DD x 금리 MM-DD' 한 줄로 찍히고 경고 자리는 숨겨져 있다", () => {
  const html = stampedBudget("2026-10-10", "2026-10-08");
  assert.match(html, /<p class="updated cross-basis" id="cross-basis" data-deals="2026-10-10" data-rates="2026-10-08">실거래 10-10 x 금리 10-08<\/p>/);
  assert.match(html, /id="cross-warn"[^>]*hidden/);
  assert.equal([...html.matchAll(/id="cross-basis"/g)].length, 1);
});

test("다시 찍어도 같고 (멱등), 날짜가 바뀌면 한 줄만 바뀐다", () => {
  const once = stampedBudget("2026-10-10", "2026-10-08");
  assert.equal(crossStampHtml(once, "budget-10eok.html", "2026-10-10", "2026-10-08"), once);
  const next = crossStampHtml(once, "budget-10eok.html", "2026-10-11", "2026-10-11");
  assert.match(next, /실거래 10-11 x 금리 10-11</);
  assert.equal([...next.matchAll(/id="cross-basis"/g)].length, 1);
  assert.equal([...next.matchAll(/id="cross-warn"/g)].length, 1);
});

test("경계: 입력 하나가 1일 낡으면 경고가 없고 2일이면 그 입력만 이름 붙여 나온다", async () => {
  // 오늘 KST 2026-10-10. 실거래는 오늘 것으로 고정하고 금리 날짜만 바꾼다.
  const now = "2026-10-10T03:00:00Z";
  const fresh = await runNav(stampedBudget("2026-10-10", "2026-10-10"), now);
  assert.equal(fresh.warn.hidden, true, "둘 다 최신인데 경고가 열렸다");
  assert.equal(fresh.warn.textContent, "");
  const one = await runNav(stampedBudget("2026-10-10", "2026-10-09"), now);
  assert.equal(one.warn.hidden, true, "1일 경과는 정상이다 (full 실행이 하루 한 번)");
  const two = await runNav(stampedBudget("2026-10-10", "2026-10-08"), now);
  assert.equal(two.warn.hidden, false);
  assert.equal(two.warn.textContent, "금리 2일 전 자료");
  assert.equal(two.basis.textContent, "실거래 10-10 x 금리 10-08", "경고가 떠도 기준일 줄은 그대로다");
});

test("실거래만 낡아도, 둘 다 낡아도 경고가 맞게 나온다", async () => {
  const now = "2026-10-10T03:00:00Z";
  assert.equal((await runNav(stampedBudget("2026-10-07", "2026-10-10"), now)).warn.textContent, "실거래 3일 전 자료");
  assert.equal((await runNav(stampedBudget("2026-10-07", "2026-10-08"), now)).warn.textContent, "실거래 3일 전 자료 · 금리 2일 전 자료");
});

test("같은 HTML에 다른 날짜를 넣으면 HTML은 그대로고 경고만 달라진다", async () => {
  const html = stampedBudget("2026-10-10", "2026-10-08");
  const before = html;
  const a = await runNav(html, "2026-10-09T03:00:00Z");
  const b = await runNav(html, "2026-10-10T03:00:00Z");
  const c = await runNav(html, "2026-10-15T03:00:00Z");
  assert.equal(html, before, "시험이 HTML을 건드렸다");
  assert.equal(a.warn.hidden, true);
  assert.equal(b.warn.textContent, "금리 2일 전 자료");
  assert.equal(c.warn.textContent, "실거래 5일 전 자료 · 금리 7일 전 자료");
});

test("날짜 경계는 KST다 (UTC 15시에 하루가 넘어간다)", async () => {
  const html = stampedBudget("2026-10-10", "2026-10-08");
  // 금리 기준일 10-08. UTC 10-09 14:59 = KST 10-09 23:59 -> 1일, UTC 10-09 15:00 = KST 10-10 00:00 -> 2일.
  assert.equal((await runNav(html, "2026-10-09T14:59:59Z")).warn.hidden, true);
  assert.equal((await runNav(html, "2026-10-09T15:00:00Z")).warn.textContent, "금리 2일 전 자료");
});

test("영어 화면: 줄과 경고가 영어로 바뀌고, 언어를 바꾸면 따라간다", async () => {
  const html = stampedBudget("2026-10-10", "2026-10-08");
  const en = await runNav(html, "2026-10-10T03:00:00Z", "en");
  assert.equal(en.basis.textContent, "Deals 10-10 x Rates 10-08");
  assert.equal(en.warn.textContent, "Rates data from 2 days ago");
  en.setLang("ko");
  assert.equal(en.basis.textContent, "실거래 10-10 x 금리 10-08");
  assert.equal(en.warn.textContent, "금리 2일 전 자료");
});

test("JS가 안 돌면 기준일 줄은 정적으로 보이고 경고만 없다", () => {
  const html = stampedBudget("2026-10-10", "2026-10-08");
  // nav.js를 돌리지 않은 상태 = 받은 HTML 그대로.
  assert.match(html, /<p class="updated cross-basis"[^>]*>실거래 10-10 x 금리 10-08<\/p>/);
  assert.match(html, /<p class="updated updated-warn" id="cross-warn" role="status" hidden><\/p>/, "경고 문장이 정적으로 박히면 빌드가 멈출 때 같이 얼어붙는다");
});

test("기준일 속성이 없거나 깨진 입력은 경고하지 않는다 (없는 날짜로 겁주지 않는다)", async () => {
  const broken = stampedBudget("2026-10-10", "2026-10-08").replace('data-rates="2026-10-08"', 'data-rates="어제"');
  const r = await runNav(broken, "2027-01-01T00:00:00Z");
  // 2027-01-01(KST) - 2026-10-10 = 83일. 깨진 금리 날짜는 빠지고 멀쩡한 실거래는 계속 본다.
  assert.equal(r.warn.textContent, "실거래 83일 전 자료");
  const none = await runNav("<main></main>", "2027-01-01T00:00:00Z");
  assert.equal(none.warn.hidden, true);
});

test("문턱이 source-age.mjs와 같다 (nav.js의 모든 STALE_DAYS)", async () => {
  const nav = await readFile(path.join(DOCS, "nav.js"), "utf8");
  const found = [...nav.matchAll(/const STALE_DAYS = (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(found.length >= 1);
  for (const n of found) assert.equal(n, STALE_DAYS);
});

test("저장소 docs: 교차값이 있는 화면 전수 - 표와 같다", async () => {
  assert.deepEqual(Object.keys(CROSS_PAGES).sort(), EXPECTED);
  // 표에 없는데 금리로 계산한 값을 싣는 화면이 생기면 빨강: 예산대 '한눈에'(budget-answers)와 전환율 리드가 그 표지다.
  const files = (await readdir(DOCS)).filter((f) => f.endsWith(".html")).sort();
  const carrying = [];
  for (const f of files) {
    const html = await readFile(path.join(DOCS, f), "utf8");
    if (html.includes('class="budget-answers"') || html.includes("<!--prerender:conversionLead-->")) carrying.push(f);
  }
  assert.deepEqual(carrying, EXPECTED, "교차값을 싣는 화면과 CROSS_PAGES가 다르다");
});

test("저장소 docs: 그 화면 전부의 정적 HTML에 입력별 기준일 줄이 있고, 값은 소스 updatedAt의 가장 오래된 날짜다", async () => {
  const sources = readDataSources(path.join(DOCS, "data"));
  for (const [file, inputs] of Object.entries(CROSS_PAGES)) {
    const html = await readFile(path.join(DOCS, file), "utf8");
    const deals = baselineFor(inputs.deals, sources);
    const rates = baselineFor(inputs.rates, sources);
    const line = `<p class="updated cross-basis" id="cross-basis" data-deals="${deals}" data-rates="${rates}">실거래 ${deals.slice(5)} x 금리 ${rates.slice(5)}</p>`;
    assert.ok(html.includes(line), `docs/${file}: 기준일 줄이 ${line} 이어야 한다 (node scripts/build-updated-stamp.mjs)`);
    assert.equal([...html.matchAll(/id="cross-basis"/g)].length, 1, `docs/${file}: 기준일 줄이 한 번이어야 한다`);
    assert.match(html, /<p class="updated updated-warn" id="cross-warn" role="status" hidden><\/p>/, `docs/${file}: 경고 자리`);
  }
});

test("교차 입력의 소스는 그 화면이 읽는 소스 또는 금리다 (소스 표와 어긋나지 않는다)", async () => {
  const { PAGE_SOURCES } = await import("../scripts/updated-stamp.mjs");
  for (const [file, inputs] of Object.entries(CROSS_PAGES)) {
    for (const n of inputs.deals) assert.ok(PAGE_SOURCES[file].includes(n), `${file}: 실거래 소스 ${n}이 화면 소스 표에 없다`);
    assert.deepEqual(inputs.rates, ["rates"], `${file}: 금리 소스는 rates.json 하나다`);
  }
});

test("반복 문구 점검 (#66): 화면 간 공통 한 줄 틀의 길이 상한", () => {
  const html = stampedBudget("2026-10-10", "2026-10-08");
  const basis = html.match(/id="cross-basis"[^>]*>([^<]*)</)[1];
  // 숫자를 가리면 모든 화면에서 똑같은 틀이다. 길어지면 열여덟 장이 같은 문장을 더 나눠 갖는다.
  const frameKo = words(`<p>${basis}</p>`, { maskNumbers: true }).join(" ");
  assert.equal(frameKo, "실거래 # x 금리 #");
  assert.ok(frameKo.length <= 20, `기준일 줄 틀이 ${frameKo.length}자 - 상한 20자`);
  assert.ok(words(`<p>${basis}</p>`, { maskNumbers: true }).length <= 5, "기준일 줄 틀은 5단어 이내");
  // 경고 문장은 정적 HTML에 없고(위 시험) nav.js가 만든다 - 그 틀도 한 줄: '<입력> n일 전 자료'(두 입력이면 ' · '로 이은 두 줄).
  assert.ok("실거래 99일 전 자료".length <= 20, "경고 한 입력 최대 길이");
  assert.ok("실거래 99일 전 자료 · 금리 99일 전 자료".length <= 30, "경고 두 입력 최대 길이");
});

test("반복 문구 점검 (#66): 줄을 넣어도 예산대 18장 공통 산문 비율이 0.5%p 넘게 늘지 않는다 (전 대비 이후)", async () => {
  const withLine = new Map();
  const without = new Map();
  for (const f of BUDGET_FILES) {
    const html = await readFile(path.join(DOCS, f), "utf8");
    withLine.set(f, html);
    without.set(f, html.replace(/<p class="updated cross-basis"[\s\S]*?<\/p>\s*<p class="updated updated-warn" id="cross-warn"[^>]*><\/p>\s*/, ""));
  }
  assert.ok([...withLine.values()].every((h) => h.includes('id="cross-basis"')), "줄이 있는 쪽이어야 비교가 된다");
  assert.ok([...without.values()].every((h) => !h.includes('id="cross-basis"')));
  for (const maskNumbers of [true, false]) {
    const after = measure(withLine, { maskNumbers }).commonShare;
    const before = measure(without, { maskNumbers }).commonShare;
    assert.ok(after - before <= 0.005, `maskNumbers=${maskNumbers}: 공통 산문 ${(before * 100).toFixed(2)}% -> ${(after * 100).toFixed(2)}%`);
  }
});
