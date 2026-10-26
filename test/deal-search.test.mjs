import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-budget-deals.ts";
import { buildDealFiles } from "../scripts/deal-files.ts";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const NOW = new Date("2026-08-17T00:00:00Z");

const deal = (amount10k, extra = {}) => ({
  district: "노원구",
  dong: "하계동",
  apt: "극동아파트",
  area: 55.72,
  floor: 7,
  amount10k,
  date: "2026-08-14",
  buildYear: 1988,
  ...extra,
});

const DEALS = [
  deal(85_000, { apt: "노원팔억가", direct: false }),
  deal(86_000, { apt: "노원팔억나", date: "2026-08-15", area: 84.97, buildYear: 2023 }),
  deal(95_000, { apt: "노원구억", direct: true }),
  deal(85_500, { district: "도봉구", dong: "창동", apt: "도봉팔억", floor: 12, date: "2026-08-16" }),
  deal(120_000, { district: "강남구", dong: "역삼동", apt: "강남십이억", buildYear: null }),
];

function fixtureOf(deals, period = "202608") {
  const payload = buildPayload({ period, districts: { seoul: deals } }, NOW);
  const files = buildDealFiles({ period, districts: { seoul: deals } }, NOW) ?? {};
  return {
    budget: payload.screen,
    search: payload.search,
    deals: Object.fromEntries(Object.values(files).map((file) => [file.district, file])),
  };
}

const FIXTURE = fixtureOf(DEALS);

const open = (extra = {}) => loadDealSearchPage({ ...FIXTURE, ...extra });

test("지역과 예산을 같이 걸면 그 칸의 거래만 나온다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /노원팔억가/);
  assert.match(html, /노원팔억나/);
  assert.ok(!html.includes("도봉팔억"), "예산은 맞지만 다른 지역 거래가 섞였다");
  assert.ok(!html.includes("노원구억"), "지역은 맞지만 다른 예산대 거래가 섞였다");
});

test("지역만 고르면 그 지역의 모든 예산대를 최근 순으로 모은다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");

  const html = page.resultHtml();
  assert.match(html, /노원구에서 3건이 거래됐습니다/);
  assert.ok(!html.includes("도봉팔억"), "다른 지역 거래가 섞였다");
  assert.ok(
    html.indexOf("노원팔억나") < html.indexOf("노원팔억가"),
    "최근 거래가 먼저 나와야 한다"
  );
});

test("예산만 고르면 서울 전체에서 그 구간을 보여준다", async () => {
  const page = await open();
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /서울 전체 8억대에서 3건이 거래됐습니다/);
  assert.match(html, /<strong class="apt">도봉팔억<\/strong><span class="place">도봉구 창동<\/span>/);
  assert.ok(!html.includes("강남십이억"), "다른 예산대 거래가 섞였다");
});

test("서울 전체에서 구간을 고르면 어느 지역에 몰렸는지 같이 적는다", async () => {
  const page = await open();
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /거래가 많은 지역: 노원구 2 · 도봉구 1/);
});

test("지역을 고른 뒤에는 지역 분포를 적지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");
  assert.ok(!page.resultHtml().includes("거래가 많은 지역"));
});

test("거래마다 단지·면적·층·거래일·거래가를 적는다", async () => {
  const page = await open();
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /<strong class="apt">도봉팔억<\/strong><span class="place">도봉구 창동<\/span>/);
  assert.match(html, /55\.72㎡ · 12층/);
  assert.match(html, /8\/16/);
  assert.match(html, /8억 5,500만원/);
});

test("지역 이름이 빠진 자료에도 고른 지역을 붙여 적는다", async () => {
  const page = await open();
  await page.chooseDistrict("도봉구");
  assert.match(page.resultHtml(), /<strong class="apt">도봉팔억<\/strong><span class="place">도봉구 창동<\/span>/);
});

test("조건에 맞는 거래가 없으면 빈 상태로 알린다", async () => {
  const page = await open();
  await page.chooseDistrict("강남구");
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /조건에 맞는 신고 거래가 없습니다/);
});

test("선택지는 자료에 있는 지역·구간으로만 만든다", async () => {
  const page = await open();

  const districts = page.districtOptions();
  assert.match(districts, /value="all"[^>]*>서울 전체/);
  for (const name of ["강남구", "노원구", "도봉구"]) assert.match(districts, new RegExp(`>${name}<`));
  assert.ok(!districts.includes("송파구"), "거래가 없는 지역까지 고르게 뒀다");

  const budgets = page.budgetOptions();
  assert.match(budgets, /value="8"[^>]*>8억대/);
  assert.match(budgets, /value="12"[^>]*>12억대/);
  assert.ok(!budgets.includes(">10억대<"), "거래가 없는 구간까지 고르게 뒀다");
});

test("주소로 조건을 받고, 바꾸면 주소에 남긴다", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=9" });
  assert.match(page.resultHtml(), /노원구억/);

  await page.chooseBudget("8");
  assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=8");
});

test("기본 조건은 주소에 남기지 않는다", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=8" });
  await page.chooseDistrict("all");
  await page.chooseBudget("all");
  assert.equal(page.sandbox.location.search, "");
});

test("자료에 없는 지역이 주소로 들어오면 서울 전체로 되돌린다", async () => {
  const page = await open({ query: "?district=%EC%84%B1%EB%82%A8%EC%8B%9C" });
  assert.equal(page.sandbox.location.search, "");
  assert.match(page.resultHtml(), /서울 전체에서 5건이 거래됐습니다/);
});

test("서울 전체에서 고른 구간은 그 예산대 페이지로 이어진다", async () => {
  const page = await open();
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /href="\.\/budget-8eok\.html"/);
});

test("지역을 고른 상태에서는 예산대 페이지로 보내지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");
  assert.ok(!page.resultHtml().includes("budget-8eok.html"));
});

test("매물이 아니라 신고된 거래라는 안내가 붙는다", async () => {
  const note = (await open()).byId("search-note").textContent;
  assert.match(note, /신고된 아파트 매매 실거래 기록/);
  assert.match(note, /매물이 아니며/);
});

test("자료가 아직 없는 날은 오류가 아니라 준비 중이라고 알린다", async () => {
  const page = await loadDealSearchPage({ status: 404 });
  assert.match(page.resultHtml(), /아직 검색할 실거래 자료가 없습니다/);
  assert.ok(!page.resultHtml().includes("load-retry"), "다시 시도해도 달라질 게 없다");
  assert.equal(page.byId("search-controls").hidden, true, "고를 수 없는 조건을 남겨 뒀다");
});

test("자료를 못 받으면 다시 시도할 길을 준다", async () => {
  const page = await loadDealSearchPage({ status: 500 });
  assert.match(page.resultHtml(), /실거래를 불러오지 못했습니다/);
  assert.match(page.resultHtml(), /id="load-retry"/);
});

test("영어 화면은 결과도 조건도 영어로 그린다", async () => {
  const page = await open({ locale: "en" });
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /3 deals filed in All of Seoul, ₩0\.8B–0\.9B/);
  assert.match(html, /12F/);
  assert.ok(!html.includes("거래됐습니다"), "영어 화면에 한국어가 남아 있다");
  assert.match(page.byId("search-note").textContent, /not listings for sale/);
  assert.equal(page.navLinks[4].textContent, "Deal search");
});

test("면적 구간을 걸면 그 구간의 거래만 남는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseArea("60-85");

  const html = page.resultHtml();
  assert.match(html, /노원팔억나/, "84.97㎡가 60~85㎡ 칸에서 빠졌다");
  assert.ok(!html.includes("노원팔억가"), "55.72㎡가 60~85㎡ 칸에 섞였다");
  assert.match(html, /1건이 거래됐습니다/);
});

test("면적 경계는 위쪽을 포함한다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseArea("85-135");
  assert.match(page.resultHtml(), /조건에 맞는 신고 거래가 없습니다/);
});

test("단지명으로 서울 전체를 훑는다", async () => {
  const page = await open();
  await page.typeApt("팔억");

  const html = page.resultHtml();
  assert.match(html, /3건이 거래됐습니다/);
  assert.match(html, /<strong class="apt">도봉팔억<\/strong><span class="place">도봉구 창동<\/span>/, "다른 지역 파일까지 훑지 않았다");
  assert.ok(!html.includes("노원구억"), "단지명이 안 맞는 거래가 섞였다");
});

test("단지명은 띄어쓰기를 무시하고 찾는다", async () => {
  const page = await open();
  await page.typeApt("노원 팔억");
  assert.match(page.resultHtml(), /2건이 거래됐습니다/);
});

test("연식을 걸면 준공연도로 거른다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseAge("5");

  const html = page.resultHtml();
  assert.match(html, /노원팔억나/, "2023년 준공이 5년 이내에서 빠졌다");
  assert.match(html, /1건이 거래됐습니다/);

  await page.chooseAge("30");
  const old = page.resultHtml();
  assert.match(old, /노원팔억가/);
  assert.match(old, /노원구억/);
  assert.ok(!old.includes("노원팔억나"), "2023년 준공이 30년 이상에 섞였다");
});

test("준공연도가 없는 거래는 연식 조건에서 뺀다", async () => {
  const page = await open();
  await page.chooseDistrict("강남구");
  await page.chooseAge("30");
  assert.match(page.resultHtml(), /조건에 맞는 신고 거래가 없습니다/);
});

test("직거래를 빼면 직거래로 신고된 거래만 사라진다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.toggleDirect(true);

  const html = page.resultHtml();
  assert.ok(!html.includes("노원구억"), "직거래가 남았다");
  assert.match(html, /2건이 거래됐습니다/);
});

test("거래 형태가 없는 거래는 직거래 제외에 걸리지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("도봉구");
  await page.toggleDirect(true);
  assert.match(page.resultHtml(), /도봉팔억/);
});

test("직거래는 목록에 표시하고 중개거래에는 아무 표시도 하지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");

  const html = page.resultHtml();
  const direct = html.slice(html.indexOf("노원구억"));
  assert.match(direct.slice(0, 200), /class="tag">직거래</);
  assert.equal(html.match(/class="tag"/g).length, 1, "중개거래·미상에도 표시가 붙었다");
});

test("무엇으로 걸렀는지 결과와 같은 자리에 적는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");
  await page.chooseArea("60-85");
  await page.chooseAge("5");
  await page.toggleDirect(true);

  assert.match(page.resultHtml(), /노원구 8억대 60~85㎡ 5년 이내 직거래 제외에서 1건/);
});

test("상세 조건도 주소에 남고, 주소로 받아 그대로 연다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseArea("60-85");
  await page.chooseAge("5");
  await page.typeApt("팔억");
  await page.toggleDirect(true);

  const query = page.sandbox.location.search;
  assert.match(query, /area=60-85/);
  assert.match(query, /age=5/);
  assert.match(query, /apt=/);
  assert.match(query, /direct=exclude/);

  const reopened = await open({ query });
  assert.match(reopened.resultHtml(), /노원팔억나/);
  assert.match(reopened.resultHtml(), /1건이 거래됐습니다/);
});

test("모르는 면적·연식 값이 주소로 들어오면 무시한다", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&area=42&age=99" });
  assert.match(page.resultHtml(), /노원구에서 3건이 거래됐습니다/);
  assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC");
});

test("상세 조건이 걸리면 예산대 페이지로 보내지 않는다", async () => {
  const page = await open();
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /budget-8eok\.html/);

  await page.chooseArea("60-85");
  assert.ok(!page.resultHtml().includes("budget-8eok.html"));
});

test("전수 자료가 없으면 상세 조건에 요약으로 답하지 않는다", async () => {
  const page = await loadDealSearchPage({ budget: FIXTURE.budget, search: FIXTURE.search });
  await page.chooseArea("60-85");

  const html = page.resultHtml();
  assert.match(html, /지역별 실거래 자료가 있어야/);
  assert.ok(!html.includes("노원팔억"), "조건을 못 거는 자료로 목록을 그렸다");
});

test("지역을 고르면 표본이 아니라 전수를 보여준다", async () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    deal(85_000 + i * 10, { apt: `노원많음${i}`, date: `2026-08-${String(i + 1).padStart(2, "0")}` })
  );
  const page = await loadDealSearchPage(fixtureOf(many));
  await page.chooseDistrict("노원구");

  const html = page.resultHtml();
  assert.match(html, /9건이 거래됐습니다/);
  assert.equal(html.match(/class="budget-deal"/g).length, 9, "대표 표본 수에서 목록이 멈췄다");
});

test("서울 전체 건수는 지역별 건수의 합과 같다", () => {
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, NOW);

  const seoul = payload.screen.bands.reduce((sum, b) => sum + b.count, 0);
  const byDistrict = Object.values(payload.search.districts)
    .flat()
    .reduce((sum, b) => sum + b.count, 0);

  assert.equal(seoul, DEALS.length);
  assert.equal(byDistrict, DEALS.length);
});

test("검색 자료는 지역별로 나뉘고 지역 이름을 다시 담지 않는다", () => {
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, NOW);

  assert.deepEqual(Object.keys(payload.search.districts).sort(), ["강남구", "노원구", "도봉구"]);

  const band = payload.search.districts["노원구"].find((b) => b.min10k === 80_000);
  assert.equal(band.count, 2);
  assert.ok(!("districts" in band), "지역 분포가 지역별 파일에 남았다");
  assert.ok(band.deals.every((d) => !("district" in d)), "지역 이름이 거래마다 남았다");

  assert.ok(!("months" in payload.search));
});

test("전수 파일 주소는 자료가 알려준다", () => {
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, NOW);
  assert.equal(payload.search.slugs["노원구"], "nowon");
  assert.equal(payload.search.slugs["강남구"], "gangnam");
  assert.ok(!("송파구" in payload.search.slugs), "거래가 없는 지역까지 주소를 냈다");
});

// deal-search의 CLS는 "조건 칸과 결과 목록이 빈 채로 태어나 데이터가 온 뒤에 채워지는 것"이었다
// (#287 (다), 2026-10-16 실측 0.4861 — 이 저장소에서 가장 나빴다). 고친 방식은 비어 있는 동안만 서는
// 자리를 CSS로 까는 것이라, 되풀이는 네 길로 들어온다 — 구운 자리가 안 비거나(또는 이름이 바뀌거나),
// 예약 규칙이 사라지거나, 칩 예약이 진짜 칩 규칙에서 떨어져 나오거나, 줄 묶음을 못박은 규칙이 빠지거나.
// 넷 다 여기서 막는다. 값(시세·날짜)에 기대지 않는 구조 검사다(#8).
test("조건 칸과 결과 자리는 데이터가 오기 전에도 자리를 잡는다 (#287)", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const read = (p) => readFile(path.join(root, p), "utf8");

  const html = await read("docs/deal-search.html");

  // (1) 예약이 걸리는 자리는 ":empty"다 - 구운 장에서 비어 있지 않으면 규칙이 아예 안 붙는다.
  for (const id of ["kind-chips", "deposit-chips", "rent-chips", "area-chips", "age-chips"]) {
    assert.match(
      html,
      new RegExp(`<div class="chip-group" id="${id}"[^>]*></div>`),
      `docs/deal-search.html: #${id}가 빈 칩 묶음으로 구워지지 않는다 - :empty 예약이 안 붙는다`
    );
  }
  assert.match(html, /<div id="search-result"><\/div>/, "docs/deal-search.html: #search-result가 빈 채로 구워지지 않는다");
  assert.match(html, /<div class="search-controls" id="search-controls">/, "docs/deal-search.html: #search-controls가 없다 - 줄 묶음 예약의 범위가 사라졌다");

  // 폭별 둘째 줄을 여는 미디어 쿼리가 이름으로 집는 묶음 둘은 반드시 이 장에 있어야 한다.
  for (const id of ["area-chips", "age-chips"]) {
    assert.ok(html.includes(`id="${id}"`), `docs/deal-search.html: #${id}가 없다 - 둘째 줄 예약이 아무것도 안 집는다`);
  }

  const css = await read("src/css/legacy.css");

  // (2) 칩 한 줄의 높이는 진짜 칩과 "같은 규칙"에서 와야 한다. 떨어져 나오면 min-height·padding·테두리가
  // 따로 놀아 예약이 남거나 모자란다(#287 (마)가 숫자를 베껴 적었다가 7.5px 어긋난 자리).
  assert.match(
    css,
    /\n\.chip,\n\.chip-group:empty::before,\n\.chip-group:empty::after \{/,
    "src/css/legacy.css: 칩 자리 예약이 .chip 규칙에서 떨어져 나왔다"
  );

  // (3) 예약을 세우는 규칙들. 하나라도 빠지면 같은 밀림이 돌아온다.
  for (const rule of [
    /\.chip-group:empty::before,\n\.chip-group:empty::after \{\n  content: "\\00a0";\n  box-sizing: border-box;\n  flex-basis: 100%;\n  visibility: hidden;\n\}/,
    /#search-controls \.search-field:has\(\.chip-group\) \{\n  flex-basis: 100%;\n\}/,
    /#search-controls \.search-field:has\(select\) \{\n  flex-basis: calc\(50% - var\(--controls-gap-x\) \/ 2\);\n\}/,
    /@media \(max-width: 519px\) \{\n  #area-chips:empty::after \{\n    content: "\\00a0";\n  \}\n\}/,
    /@media \(max-width: 502px\) \{\n  #age-chips:empty::after \{\n    content: "\\00a0";\n  \}\n\}/,
    /#search-result:empty,\n#search-result:has\(> p:only-child\) \{\n  min-height: 100vh;\n\}/,
  ]) {
    assert.match(css, rule, "src/css/legacy.css: deal-search 자리 예약 규칙이 사라졌다");
  }

  // (4) 셀렉트 칸의 반 줄은 .search-controls의 가로 간격을 나눠 쓴다. 토큰이 없어지면 calc가 죽는다.
  assert.match(
    css,
    /\.search-controls \{\n(?:[^}]*\n)?  --controls-gap-x: 16px;\n(?:[^}]*\n)?  gap: 10px var\(--controls-gap-x\);/,
    "src/css/legacy.css: --controls-gap-x가 없어졌거나 gap이 그 토큰을 안 쓴다"
  );
});

// 메인 「집을 사려는 사람」 묶음 안의 JS 없는 GET 폼(#733). 브라우저가 보내는 주소를 그대로 만들어 이 화면이 그 조건으로 열리는지 본다.
const mainForm = async () => {
  const { readFile } = await import("node:fs/promises");
  const docs = new URL("../docs/", import.meta.url);
  const index = await readFile(new URL("index.html", docs), "utf8");
  const search = await readFile(new URL("deal-search.html", docs), "utf8");
  const form = /<form class="question-form"[^>]*>[\s\S]*?<\/form>/.exec(index)?.[0] ?? "";
  return { search, form };
};

test("메인 사는 사람 폼은 실거래 검색이 읽는 이름·값으로 보낸다 (#733)", async () => {
  const { search, form } = await mainForm();
  const tag = /<form[^>]*>/.exec(form)?.[0] ?? "";
  assert.match(tag, /action="\.\/deal-search\.html"/, "폼이 실거래 검색으로 가지 않는다");
  assert.doesNotMatch(tag, /method="post"/i, "GET 이 아니면 주소에 조건이 남지 않는다");
  assert.doesNotMatch(form, /<script|\son[a-z]+=/i, "폼에 JS 가 붙었다");
  const names = [...form.matchAll(/<(?:input|select)[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["budget", "district", "area"]);
  for (const name of names) assert.ok(search.includes(`params.get("${name}")`), `실거래 검색이 ${name} 을 읽지 않는다`);
  // 칸마다 label 로 감싸 이름이 붙고, 한국어·영어 글자가 하나씩 있다(화면 언어 쪽만 CSS 로 보인다).
  const labels = [...form.matchAll(/<label>([\s\S]*?)<\/label>/g)].map((m) => m[1]);
  assert.equal(labels.length, 3);
  for (const label of labels) {
    assert.match(label, /^<span lang="ko">[^<]*[가-힣][^<]*<\/span><span lang="en">[\x20-\x7E㎡₩]+<\/span><(?:input|select)/);
  }
  // 면적 값은 실거래 검색이 아는 구간 키만(모르는 값은 조용히 무시돼 조건이 사라진다).
  const keys = [...(/const AREA_BUCKETS = \[([\s\S]*?)\];/.exec(search)?.[1] ?? "").matchAll(/key: "([^"]+)"/g)].map((m) => m[1]);
  const select = /<select name="area">([\s\S]*?)<\/select>/.exec(form)?.[1] ?? "";
  const values = [...select.matchAll(/<option(?: value="([^"]*)")?>([^<]*)/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(values, ["", ...keys]);
});

test("메인 폼의 세 조건으로 실거래 검색이 열린다 (#733)", async () => {
  const query = `?${new URLSearchParams({ budget: "8", district: "노원구", area: "60-85" })}`;
  const page = await open({ query });
  const html = page.resultHtml();
  assert.match(html, /노원팔억나/);
  assert.ok(!html.includes("노원팔억가"), "면적 조건이 빠졌다");
  assert.ok(!html.includes("도봉팔억"), "지역 조건이 빠졌다");
  assert.match(html, /1건이 거래됐습니다/);

  // 빈 칸으로 보내면(budget=&district=&area=) 기본 조건 그대로 서울 전체다.
  const blank = await open({ query: "?budget=&district=&area=" });
  assert.match(blank.resultHtml(), /서울 전체에서 5건이 거래됐습니다/);
});

test("자유 입력 자치구는 앞뒤 공백을 다듬고 빠진 「구」를 붙여 연다 (#733)", async () => {
  for (const typed of ["노원", " 노원 ", "노원구 "]) {
    const page = await open({ query: `?${new URLSearchParams({ district: typed })}` });
    assert.match(page.resultHtml(), /노원구에서 3건이 거래됐습니다/, `「${typed}」가 노원구로 열리지 않는다`);
    assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC", "주소가 다듬은 이름으로 남지 않는다");
  }
});

test("자료에 없는 자유 입력 자치구는 서울 전체로 연다 (#733)", async () => {
  for (const typed of ["노원동", "분당", "  "]) {
    const page = await open({ query: `?${new URLSearchParams({ district: typed })}` });
    assert.match(page.resultHtml(), /서울 전체에서 5건이 거래됐습니다/, `「${typed}」가 서울 전체로 돌아가지 않는다`);
    assert.equal(page.sandbox.location.search, "");
  }
});

// #745 PR2: 기본은 거래 유형·지역·예산 셋, 나머지는 「상세 조건 더 보기」(<details>, JS 없이 접고 편다) 안.
test("기본 조건은 유형·지역·예산 셋이고 나머지는 상세 조건 접기 안에 있다 (#745)", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../docs/deal-search.html", import.meta.url), "utf8");
  const controls = /<div class="search-controls" id="search-controls">([\s\S]*?)\n    <\/div>\n    <p class="sr-only"/.exec(html)?.[1] ?? "";
  const details = /<details class="more-filters" id="more-filters">([\s\S]*?)<\/details>/.exec(controls)?.[1];
  assert.ok(details, "상세 조건 접기(<details>)가 없거나 조건 칸 밖에 있다");
  assert.match(details, /^\s*<summary id="more-label">상세 조건 더 보기<\/summary>/, "접기 머리(summary)가 맨 앞에 없다");
  const basic = controls.replace(details, "");
  for (const id of ["kind-chips", "district-select", "budget-select"]) {
    assert.ok(basic.includes(`id="${id}"`), `#${id} 가 기본 줄에 없다`);
    assert.ok(!details.includes(`id="${id}"`), `#${id} 가 접기 안에 들어갔다`);
  }
  for (const id of ["area-chips", "age-chips", "apt-input", "direct-check", "group-check"]) {
    assert.ok(details.includes(`id="${id}"`), `#${id} 가 상세 조건 접기 밖에 있다`);
  }
  // 이름표 연결: 입력 칸은 label for, 칩 묶음은 aria-labelledby.
  for (const id of ["district-select", "budget-select", "apt-input", "direct-check", "group-check"]) {
    assert.ok(controls.includes(`<label for="${id}"`), `#${id} 에 label 이 안 붙었다`);
  }
  assert.doesNotMatch(html, /<details class="more-filters"[^>]*\sopen/, "구운 장이 펼친 채로 태어난다 - 기본은 접힘");
  const css = await readFile(new URL("../src/css/legacy.css", import.meta.url), "utf8");
  assert.match(css, /\.more-filters > summary \{[^}]*min-height: 44px;/, "접기 머리의 손가락 자리 44px 이 없다");
});

test("상세 조건은 기본으로 접히고, 값이 걸린 주소로 들어오면 펼친 채 시작한다 (#745)", async () => {
  const closed = await open({ query: "?budget=8&district=%EB%85%B8%EC%9B%90%EA%B5%AC" });
  assert.equal(closed.byId("more-filters").open, false, "기본 조건만 있는데 펼쳐졌다");
  assert.equal(closed.byId("more-label").textContent, "상세 조건 더 보기");
  for (const query of ["?area=60-85", "?apt=%ED%8C%94%EC%96%B5", "?direct=exclude", "?group=1"]) {
    const page = await open({ query });
    assert.equal(page.byId("more-filters").open, true, `${query}: 상세 조건이 걸렸는데 접힌 채 시작한다`);
    assert.equal(page.byId("more-label").textContent, "상세 조건 더 보기 (1개 적용)", `${query}: 적용 개수가 안 보인다`);
  }
  // 접어도 값과 주소는 그대로다 - 접기는 보이는 것만 바꾼다.
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&area=60-85" });
  page.byId("more-filters").open = false;
  await page.chooseBudget("8");
  assert.match(page.sandbox.location.search, /area=60-85/, "접은 뒤 다른 조건을 바꾸니 상세 조건이 주소에서 빠졌다");
  assert.match(page.resultHtml(), /노원팔억나/);
  assert.ok(!page.resultHtml().includes("노원팔억가"), "접은 뒤 면적 조건이 풀렸다");
});

test("예산 이하(max)는 그 금액 이하 거래만 남기고 주소에 남는다 - 시나리오 B (#745)", async () => {
  // 구를 고르면 전수 파일로 정확히 거른다(9억 이하: 8.5·8.6억은 남고 9.5억은 빠진다).
  const nowon = await open({ query: `?${new URLSearchParams({ district: "노원구", max: "9" })}` });
  assert.match(nowon.resultHtml(), /노원팔억가/);
  assert.match(nowon.resultHtml(), /노원팔억나/);
  assert.ok(!nowon.resultHtml().includes("노원구억"), "9억 넘는 거래가 섞였다");
  assert.match(nowon.resultHtml(), /9억 이하/, "결과 문장에 예산 이하 조건이 안 적힌다");
  assert.match(nowon.byId("budget-select").innerHTML, /<option value="m9" selected>9억 이하<\/option>/, "주소의 max 가 선택지에 안 보인다");

  // 서울 전체도 전수 파일로 거른다 - 경계 금액(정확히 8억)은 들고, 8억대 나머지는 빠진다(시나리오 B 「서울 8억 이하 매매」).
  const seoul = await open({ ...fixtureOf([...DEALS, deal(80_000, { district: "도봉구", dong: "창동", apt: "도봉딱팔억" }), deal(79_000, { apt: "노원칠억" })]), query: "?max=8" });
  assert.match(seoul.resultHtml(), /서울 전체 8억 이하에서 2건이 거래됐습니다/);
  assert.match(seoul.resultHtml(), /도봉딱팔억/, "정확히 8억인 거래가 빠졌다");
  assert.match(seoul.resultHtml(), /노원칠억/);
  assert.ok(!seoul.resultHtml().includes("노원팔억가"), "8억 넘는 거래가 섞였다");

  // 선택지로 고르면 max 만 남고 budget(구간)은 지워진다. 다시 구간을 고르면 반대.
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=9" });
  await page.chooseBudget("m10");
  assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&max=10");
  assert.match(page.resultHtml(), /노원구억/);
  await page.chooseBudget("8");
  assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=8");
  // 엉터리 값은 무시한다.
  for (const bad of ["abc", "-3", "0"]) {
    const odd = await open({ query: `?max=${bad}` });
    assert.equal(odd.sandbox.location.search, "", `max=${bad} 가 주소에 남았다`);
  }
});

test("deal-filters.js 는 gzip ≤2,048B, deal-search 만 defer 로 한 번 읽고 서비스워커 사전캐시에 없다 (#681 예외 확장, #745)", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const { gzipSync } = await import("node:zlib");
  const { SITE } = await import("./helpers/site-root.mjs");
  const at = (p) => new URL(`../${p}`, import.meta.url);
  const size = gzipSync(await readFile(at("docs/deal-filters.js")), { level: 9 }).length;
  assert.ok(size <= 2048, `docs/deal-filters.js gzip ${size}B`);
  const html = await readFile(at("docs/deal-search.html"), "utf8");
  assert.equal(html.split('<script src="./deal-filters.js" defer></script>').length, 2);
  assert.ok(!(await readFile(at("docs/sw.js"), "utf8")).includes("deal-filters"), "sw.js 사전캐시에 들어갔다");
  const users = [];
  for (const f of (await readdir(at(SITE))).filter((x) => x.endsWith(".html")).sort()) {
    if ((await readFile(at(`${SITE}/${f}`), "utf8")).includes("deal-filters.js")) users.push(f);
  }
  assert.deepEqual(users, ["deal-search.html"]);
});

// #745 PR3: 결과 위 적용 조건 칩(× 로 하나씩)·전체 초기화·정렬·빈 결과 풀기 링크·오류 상자. 결과 칸 보조는 쪽 전용 docs/deal-results.js.
const barHtml = (page) => page.byId("result-bar").innerHTML;
const press = async (page, id, drop) => {
  const target = { dataset: { drop }, closest: () => target };
  page.byId(id).dispatch("click", { target });
  await page.settle();
};
const sortBy = async (page, value) => {
  page.byId("result-bar").dispatch("change", { target: { id: "sort-select", value } });
  await page.settle();
};
const prices = (html) => [...html.matchAll(/<span class="price">([^<]+)<\/span>/g)].map((m) => m[1]);

test("적용 조건이 결과 위에 칩으로 서고, × 하나가 그 조건만 주소에서 뺀다 (#745 PR3)", async () => {
  const page = await open({ query: `?${new URLSearchParams({ district: "노원구", max: "9", area: "60-85" })}` });
  const bar = barHtml(page);
  for (const name of ["노원구", "9억 이하", "60~85㎡"]) {
    assert.match(bar, new RegExp(`<li class="c-filter-chip">${name}[^<]*<button type="button" class="c-filter-chip__x" data-drop="[a-z]+" aria-label="[^"]*해제">×</button>`), `${name} 칩이 없다`);
  }
  assert.match(bar, /<ul class="c-chips" aria-label="적용 조건">/);
  await press(page, "result-bar", "max");
  assert.equal(page.sandbox.location.search, `?${new URLSearchParams({ district: "노원구", area: "60-85" })}`);
  assert.ok(!barHtml(page).includes("9억 이하"), "지운 조건 칩이 남았다");
  assert.match(page.resultHtml(), /노원팔억나/);
  await press(page, "result-bar", "district");
  assert.equal(page.sandbox.location.search, "?area=60-85");
  assert.ok(!barHtml(page).includes(">노원구<"), "지운 지역 칩이 남았다");
});

test("전체 초기화는 조건을 모두 지우고 칩 줄을 비운다 (#745 PR3)", async () => {
  const page = await open({ query: `?${new URLSearchParams({ district: "노원구", budget: "8", apt: "팔억", direct: "exclude" })}` });
  assert.match(barHtml(page), /data-drop="all">전체 초기화<\/button>/);
  await press(page, "result-bar", "all");
  assert.equal(page.sandbox.location.search, "");
  assert.ok(!barHtml(page).includes("c-filter-chip"), "초기화 뒤 칩이 남았다");
  assert.match(page.resultHtml(), /서울 전체에서 \d+건이 거래됐습니다/);
});

test("정렬: 자치구를 고르면 가격 낮은/높은 순으로 30건 자르기 전에 줄 세우고, 서울 전체에서는 이유와 함께 잠근다 (#745 PR3)", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC" });
  assert.deepEqual(prices(page.resultHtml()), ["8억 6,000만원", "9억 5,000만원", "8억 5,000만원"], "기본은 최근 거래순(같은 날은 비싼 것 먼저)");
  await sortBy(page, "low");
  assert.deepEqual(prices(page.resultHtml()), ["8억 5,000만원", "8억 6,000만원", "9억 5,000만원"]);
  assert.match(page.sandbox.location.search, /sort=low/);
  assert.match(barHtml(page), /<option value="low" selected>가격 낮은 순<\/option>/);
  await sortBy(page, "high");
  assert.deepEqual(prices(page.resultHtml()), ["9억 5,000만원", "8억 6,000만원", "8억 5,000만원"]);
  // 서울 전체 목록은 표본이라 가격순을 켜지 않는다 - 주소에 sort 가 와도 무시하고 지운다.
  const seoul = await open({ query: "?budget=8&sort=high" });
  assert.equal(seoul.sandbox.location.search, "?budget=8");
  assert.match(barHtml(seoul), /<option value="low" disabled>가격 낮은 순<\/option>/);
  assert.match(barHtml(seoul), /class="result-note">가격순은 자치구를 고르면 켜집니다/);
  // 정렬 칸은 거래 목록이 있을 때만(단지로 묶어 보기·빈 결과에는 없다).
  const empty = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&max=3" });
  assert.ok(!barHtml(empty).includes("sort-select"));
});

test("빈 결과는 상태 상자 안에 조건마다 「그것만 뺀 주소」 링크를 준다 (#745 PR3)", async () => {
  const page = await open({ query: `?${new URLSearchParams({ district: "노원구", max: "3", age: "5" })}` });
  const html = page.resultHtml();
  assert.match(html, /^<div class="c-state c-state--empty"><p class="budget-empty">조건에 맞는 신고 거래가 없습니다/);
  assert.match(html, /<p class="c-state__body">조건을 하나씩 풀어 보세요\.<\/p>/);
  const links = [...html.matchAll(/<a class="c-chip" href="([^"]+)" data-drop="([a-z]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1].replaceAll("&amp;", "&"), m[3]]);
  assert.deepEqual(links.map(([k]) => k), ["district", "max", "age"]);
  assert.equal(links[1][1], `/deal-search.html?${new URLSearchParams({ district: "노원구", age: "5" })}`, "max 풀기 링크가 다른 조건까지 지웠다");
  assert.equal(links[1][2], "「3억 이하」 풀기");
  // 링크를 눌러도(JS) 주소와 같은 결과로 간다.
  await press(page, "search-result", "max");
  assert.equal(page.sandbox.location.search, `?${new URLSearchParams({ district: "노원구", age: "5" })}`);
});

test("오류 상자는 「오류」 낱말 + role=\"alert\" + 다시 시도 단추다 (#745 PR3)", async () => {
  const failed = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC", network: { failDeals: true } });
  await failed.settle();
  assert.match(failed.resultHtml(), /^<div class="c-state c-state--error" role="alert"><p class="c-state__title">오류<\/p><p class="empty">실거래를 불러오지 못했습니다\. <button type="button" id="load-retry-deals">다시 시도<\/button><\/p><\/div>$/);
  const boot = await loadDealSearchPage({ status: 500, locale: "en" });
  assert.match(boot.resultHtml(), /^<div class="c-state c-state--error" role="alert"><p class="c-state__title">Error<\/p>.*id="load-retry">Retry<\/button>/);
});

test("#747 후속: 전월세에서 숨은 max 는 주소·조건 지우기에 남지 않고, budget+max 는 max 하나로, 목록 밖 max 는 숫자 순 자리에 (#745 PR3)", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&max=9" });
  await page.chooseKind("jeonse");
  assert.ok(!page.sandbox.location.search.includes("max="), "전세로 바꿨는데 숨은 max 가 주소에 남았다");
  await page.chooseDistrict("all");
  assert.equal(page.fieldHidden("reset-field"), true, "숨은 max 만으로 「조건 지우기」가 떴다");
  await page.chooseKind("sale");
  assert.match(page.sandbox.location.search, /max=9/, "매매로 돌아오면 max 가 되살아나야 한다");

  const both = await open({ query: "?budget=8&max=9" });
  assert.equal(both.sandbox.location.search, "?max=9", "budget 과 max 를 함께 적용했다");
  assert.match(both.resultHtml(), /서울 전체 9억 이하에서/);

  const odd = await open({ query: "?max=7" });
  const order = [...odd.budgetOptions().matchAll(/value="m(\d+)"/g)].map((m) => +m[1]);
  assert.deepEqual(order, [3, 5, 7, 8, 10, 15, 20]);
});

test("결과 줄은 단지명(굵게) → 위치 → 가격(단위) → 전용면적·층·거래일 순이다 (#745 PR3)", async () => {
  const page = await open({ query: "?district=%EB%8F%84%EB%B4%89%EA%B5%AC" });
  assert.match(page.resultHtml(), /<li class="budget-deal"><strong class="apt">도봉팔억<\/strong><span class="place">도봉구 창동<\/span><span class="price">8억 5,500만원<\/span><span class="spec">전용 55\.72㎡ · 12층 · <span class="when">8\/16<\/span><\/span><\/li>/);
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/css/c-search.css", import.meta.url), "utf8");
  assert.match(css, /\.budget-deal > strong\.apt \{[^}]*font-weight: 700;/);
  assert.match(css, /\.budget-deal > strong\.apt ~ \.spec \{[^}]*flex-basis: 100%;/, "전용·층·거래일이 둘째 줄로 안 내려간다");
});

test("deal-results.js 는 gzip ≤2,048B, deal-search 만 deal-filters.js 다음에 defer 로 한 번 읽고 서비스워커 사전캐시에 없다 (#681 예외 확장, #745 PR3)", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const { gzipSync } = await import("node:zlib");
  const { SITE } = await import("./helpers/site-root.mjs");
  const at = (p) => new URL(`../${p}`, import.meta.url);
  const size = gzipSync(await readFile(at("docs/deal-results.js")), { level: 9 }).length;
  assert.ok(size <= 2048, `docs/deal-results.js gzip ${size}B`);
  const html = await readFile(at("docs/deal-search.html"), "utf8");
  assert.equal(html.split('<script src="./deal-results.js" defer></script>').length, 2);
  assert.ok(html.indexOf("./deal-filters.js") < html.indexOf("./deal-results.js"), "deal-results.js 가 deal-filters.js(조건 목록·정렬) 보다 먼저 돈다");
  assert.ok(!(await readFile(at("docs/sw.js"), "utf8")).includes("deal-results"), "sw.js 사전캐시에 들어갔다");
  const users = [];
  for (const f of (await readdir(at(SITE))).filter((x) => x.endsWith(".html")).sort()) {
    if ((await readFile(at(`${SITE}/${f}`), "utf8")).includes("deal-results.js")) users.push(f);
  }
  assert.deepEqual(users, ["deal-search.html"]);
});
