import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-budget-deals.ts";
import { buildDealFiles } from "../scripts/deal-files.ts";
import { buildFixtureSite } from "./helpers/fixture-site.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

/**
 * UI/UX 개편(#745) 소유자 지시서의 시나리오 A~E 를 사용자가 밟는 길 그대로 잇는 회귀 시험 (PR10).
 *
 * 장별 시험은 각 PR 이 자기 장 안에서 지킨다. 이 파일은 그 사이의 이음매 - 메인 폼이 보내는 GET 주소를 deal-search 가 그대로 읽는가,
 * 자치구 장에서 거래·단지 찾기로 가는 길이 이어지는가 - 를 한 번에 본다. 고정 데이터 작업 폴더(test/helpers/fixture-site.mjs)로 장을 찍어
 * 오늘 데이터에 기대지 않는다. deal-search 는 기존 시험 도우미(vm 샌드박스)로 돌린다.
 * 실제 브라우저(5폭 × Chrome·WebKit)의 가로 넘침·콘솔 오류는 이 시험이 아니라 PR 본문의 측정표가 맡는다(새 의존성 금지).
 */

const site = buildFixtureSite();
after(() => site.cleanup());

const NOW = new Date("2026-08-17T00:00:00Z");
const deal = (district, dong, apt, amount10k, extra = {}) => ({
  district, dong, apt, area: 84.9, floor: 7, amount10k, date: "2026-08-14", buildYear: 2005, ...extra,
});
const DEALS = [
  deal("도봉구", "창동", "도봉딱팔억", 80_000),
  deal("노원구", "하계동", "노원칠억", 79_000, { date: "2026-08-15" }),
  deal("노원구", "하계동", "노원팔억반", 85_000),
  deal("강남구", "역삼동", "강남십이억", 120_000),
  deal("동작구", "상도동", "상도래미안", 110_000, { date: "2026-08-10" }),
  deal("동작구", "상도동", "상도래미안", 112_000, { date: "2026-08-12" }),
  deal("동작구", "흑석동", "흑석자이", 150_000, { date: "2026-08-11" }),
];
function fixtureOf(deals, period = "202608") {
  const payload = buildPayload({ period, districts: { seoul: deals } }, NOW);
  const files = buildDealFiles({ period, districts: { seoul: deals } }, NOW) ?? {};
  return { budget: payload.screen, search: payload.search, deals: Object.fromEntries(Object.values(files).map((f) => [f.district, f])) };
}
const FIXTURE = fixtureOf(DEALS);

const index = site.read("docs/index.html");
const main = index.slice(index.indexOf("<main"));
/** 메인 대표 검색 폼(#home-search) 한 덩어리. */
const homeForm = main.match(/<form class="home-search" id="home-search"[\s\S]*?<\/form>/)?.[0] ?? "";

/** 폼을 손대지 않고 「찾기」를 눌렀을 때 브라우저가 보내는 GET 질의 - 라디오는 checked 것, select 는 첫 option(또는 selected). */
function defaultQuery(form, picks = {}) {
  const q = new URLSearchParams();
  for (const m of form.matchAll(/<input[^>]*type="radio"[^>]*>/g)) {
    if (/\bchecked\b/.test(m[0])) q.set(m[0].match(/name="([^"]+)"/)[1], m[0].match(/value="([^"]*)"/)[1]);
  }
  for (const m of form.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const first = m[2].match(/<option(?: value="([^"]*)")?[^>]*>([^<]*)/);
    q.set(m[1], first[1] ?? first[2]);
  }
  for (const [k, v] of Object.entries(picks)) q.set(k, v);
  return q;
}
const optionsOf = (form, name) =>
  [...(form.match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? "").matchAll(/<option(?: value="([^"]*)")?[^>]*>([^<]*)/g)].map((m) => ({ value: m[1] ?? m[2], text: m[2] }));

test("A 첫 방문자: 첫 화면 맨 위에 무엇을 하는 곳인지 말하는 헤드라인과, 접히지 않은 대표 검색이 있다", () => {
  const h1 = main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(h1, "메인에 h1 이 없다");
  assert.match(h1[1], /<span lang="ko">[^<]*(예산|아파트)[^<]*<\/span>/, "헤드라인이 목적(예산·아파트 찾기)을 말하지 않는다");
  assert.match(h1[1], /<span lang="en">[^<]+<\/span>/, "헤드라인 영어 짝이 없다");
  assert.ok(homeForm, "메인 대표 검색 폼(#home-search)이 없다");
  // 헤드라인 바로 아래 - 질문 묶음(더 알아보기)·시세 표보다 앞이고, 닫힌 <details> 안이 아니다(개편 전 문제).
  const at = main.indexOf(homeForm);
  assert.ok(main.indexOf(h1[0]) < at, "대표 검색이 헤드라인보다 앞에 있다");
  assert.ok(at < main.indexOf('id="question-heading"') && at < main.indexOf('id="realestate-heading"'), "대표 검색이 질문 묶음·시세 표 뒤로 밀렸다");
  const before = main.slice(0, at);
  assert.equal((before.match(/<details/g) ?? []).length, (before.match(/<\/details>/g) ?? []).length, "대표 검색이 접힌 details 안에 있다");
  // JS 없이 GET 으로 deal-search 에 간다. 기본 3조건: 거래 유형·지역·예산.
  assert.match(homeForm, /action="\.\/deal-search\.html"/);
  assert.match(homeForm, /method="get"/i);
  assert.match(homeForm, /<button[^>]*type="submit"|<button(?![^>]*type=)[^>]*>/, "제출 버튼이 없다");
  for (const name of ["kind", "district", "max"]) assert.match(homeForm, new RegExp(`name="${name}"`), `대표 검색에 ${name} 조건이 없다`);
});

test("B 서울 8억 이하 매매: 메인 폼 기본값에 8억 이하만 고르면 deal-search 가 정확히 8억까지의 매매만 보여 준다", async () => {
  assert.deepEqual(optionsOf(homeForm, "max").find((o) => o.value === "8"), { value: "8", text: "8억 이하" }, "예산 선택지에 8억 이하가 없다");
  assert.equal(optionsOf(homeForm, "district")[0].value, "", "지역 첫 선택지가 서울 전체가 아니다");
  const query = defaultQuery(homeForm, { max: "8" });
  assert.equal(query.toString(), "kind=sale&district=&max=8", "메인 폼이 보내는 주소가 바뀌었다");

  const page = await loadDealSearchPage({ ...FIXTURE, query: `?${query}` });
  const html = page.resultHtml();
  assert.match(html, /서울 전체 8억 이하에서 2건이 거래됐습니다/, "결과 건수·적용 조건 문장이 없다");
  assert.match(html, /도봉딱팔억/, "정확히 8억인 거래가 빠졌다(이하가 미만으로 읽힘)");
  assert.match(html, /노원칠억/);
  for (const over of ["노원팔억반", "강남십이억", "흑석자이"]) assert.ok(!html.includes(over), `8억 넘는 ${over} 가 섞였다`);
  assert.match(html, /8억원|7억 9,000만원/, "가격에 단위(억·만원)가 안 붙는다");
  // 주소가 그대로 남아 공유·뒤로 가기가 된다. 빈 district 는 지운다.
  assert.match(page.sandbox.location.search, /max=8/);
  assert.ok(!/district=(&|$)/.test(page.sandbox.location.search), "빈 지역 조건이 주소에 남았다");
});

test("C 동작구 최근 시세: 자치구 장이 3.3㎡당 평균·거래 건수를 단위와 함께 싣고, 거래·단지 찾기로 이어진다", async () => {
  assert.ok(index.includes('href="./district-dongjak.html"') || site.read("docs/realestate.html").includes('href="./district-dongjak.html"'), "메인·시세 장에서 동작구 장으로 가는 길이 없다");
  const page = site.read("docs/district-dongjak.html");
  assert.match(page, /<h1[^>]*>동작구 아파트 시세<\/h1>/);
  assert.match(page, /<th scope="col">3\.3㎡당 평균<\/th>/, "시세 칸 머리에 기준(3.3㎡당 평균)이 없다");
  assert.match(page, /<th scope="col">거래 건수<\/th>/, "거래 건수 칸이 없다");
  assert.match(page, /[\d,]+만원/, "시세 값에 단위가 없다");
  assert.match(page, /\d+건/, "거래 건수에 단위가 없다");
  const toSearch = page.match(/href="\.\/deal-search\.html\?([^"]+)"/);
  assert.ok(toSearch, "자치구 장에서 거래 찾기로 가는 링크가 없다");
  const q = new URLSearchParams(toSearch[1].replace(/&amp;/g, "&"));
  assert.equal(q.get("district"), "동작구");

  // 주요 단지: 같은 주소에 단지로 묶어 보기(group=1)를 켜면 동작구 단지(단지·평형 중간값 파일 complex-price-*)만 나온다.
  q.set("group", "1");
  const cell = (median, n) => ({ n, median, low: median - 1000, high: median + 1000, quartile: n >= 5, raw: median - 2000, unadjusted: 0 });
  const complexPrices = {
    동작구: { district: "동작구", reference: "202608", cells: { 상도래미안: { "84.9": cell(111_000, 12) }, 흑석자이: { "84.9": cell(150_000, 6) } }, meta: { 상도래미안: { dong: "상도동", buildYear: 2005 }, 흑석자이: { dong: "흑석동", buildYear: 2012 } } },
    노원구: { district: "노원구", reference: "202608", cells: { 노원칠억: { "84.9": cell(79_000, 9) } }, meta: { 노원칠억: { dong: "하계동", buildYear: 1990 } } },
  };
  const search = await loadDealSearchPage({ ...FIXTURE, complexPrices, query: `?${q}` });
  const html = search.resultHtml();
  assert.match(html, /상도래미안/);
  assert.match(html, /흑석자이/);
  for (const other of ["도봉딱팔억", "노원칠억", "강남십이억"]) assert.ok(!html.includes(other), `다른 구 ${other} 가 섞였다`);
});

test("D 강서구 vs 동작구: 메인 「비교」에서 갈아타기 장으로 가고, 두 구를 같은 84㎡ 기준으로 견준다", async () => {
  assert.match(main, /<a href="\.\/switch-house\.html"><span lang="ko">[^<]*비교/, "메인에서 비교로 가는 길이 없다");
  const { loadPage } = await import("./helpers/digest-page.mjs");
  const lv = (base, recent) => ({ base, recent });
  const payload = {
    updatedAt: "2026-10-01T00:00:00Z",
    rows: [
      { code: "11500", name: "강서구", cells: 120, change: 8.1, low: 7, high: 9.5, level84: lv(90_000, 97_000) },
      { code: "11590", name: "동작구", cells: 110, change: 14.2, low: 12.8, high: 15.6, level84: lv(120_000, 137_000) },
    ],
    pairs: { "11500-11590": true },
    money: { "11500-11590": { change: 10_000, low: 6_000, high: 14_000 } },
    lead: { ko: "x", en: "x" }, table: { ko: "", en: "" }, regionTable: { ko: "", en: "" }, slugs: {},
  };
  const page = await loadPage({ file: "switch-house.html", data: { "district-change": payload }, query: `?from=${encodeURIComponent("강서구")}&to=${encodeURIComponent("동작구")}` });
  await page.settle();
  assert.equal(page.byId("from-select").value, "11500");
  assert.equal(page.byId("to-select").value, "11590");
  assert.match(page.text("compare-answer"), /^강서구 → 동작구: 옮기는 데 드는 돈이 1억원 늘었습니다$/);
  const result = page.text("compare-result");
  assert.match(result, /84㎡/, "두 구를 견준 기준(84㎡ 환산)이 안 적힌다");
  assert.match(result, /강서구 9억원 → 9억 7,000만원/, "출발 구의 두 시기 값이 같은 기준으로 안 적힌다");
  assert.match(result, /동작구 12억원 → 13억 7,000만원/, "도착 구의 두 시기 값이 같은 기준으로 안 적힌다");
});

test("E 모바일: 시나리오 장은 기기 폭 viewport 이고, 넓은 표는 가로 스크롤 틀 안에 있으며 고정 폭 인라인 스타일이 없다", () => {
  const pages = ["docs/index.html", "docs/deal-search.html", "docs/district-dongjak.html", "docs/switch-house.html", "docs/realestate.html", "docs/budget-8eok.html"];
  for (const file of pages) {
    const html = site.read(file);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, `${file}: viewport 가 기기 폭이 아니다`);
    assert.doesNotMatch(html, /style="[^"]*\b(min-)?width:\s*(3[2-9]\d|[4-9]\d\d|\d{4,})px/, `${file}: 320px 를 넘는 고정 폭 인라인 스타일`);
    for (const m of html.matchAll(/<table class="data-table"/g)) {
      const before = html.slice(Math.max(0, m.index - 300), m.index);
      assert.match(before, /class="[^"]*table-wrap[^"]*"[^>]*>\s*$/, `${file}: 넓은 표가 가로 스크롤 틀(.table-wrap) 밖에 있다`);
    }
  }
  // deal-search 첫 화면은 기본 조건만 펼치고 나머지는 「상세 조건 더 보기」로 접는다(좁은 화면에서 결과가 밀려나지 않게).
  assert.match(site.read("docs/deal-search.html"), /<details class="more-filters" id="more-filters">\s*<summary id="more-label">상세 조건 더 보기<\/summary>/);
});
