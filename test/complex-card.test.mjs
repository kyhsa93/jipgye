import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { MIN_DEALS_PER_SIDE, cellRatios } from "../scripts/complex-ratio.ts";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

const settle = async (n = 300) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 5));
};

async function page(query) {
  const [budget, search, deals, rents] = await Promise.all([
    readJson("budget-deals"),
    readJson("deal-search"),
    readJson("deals-nowon"),
    readJson("rents-nowon"),
  ]);
  const p = await loadDealSearchPage({
    budget,
    search,
    deals: { 노원구: deals },
    rents: { 노원구: rents },
    query,
  });
  await settle();
  return p;
}

test("고른 단지의 평형별 값이 뜬다", async () => {
  const p = await page("?district=노원구&apt=상계주공7(고층)");
  const html = p.byId("complex-card").innerHTML;

  assert.match(html, /상계주공7\(고층\) 평형별/);
  assert.match(html, /전세가율/);
  assert.match(html, /\d+\.\d%/, "전세가율 값이 하나도 없다");
});

test("표본이 모자란 평형은 값 대신 몇 건인지 적는다", async () => {
  // 이 화면의 값어치는 숫자가 아니라 그 숫자를 낼 수 있었는지까지 보이는 데 있다.
  const p = await page("?district=노원구&apt=상계주공7(고층)");
  const html = p.byId("complex-card").innerHTML;
  assert.match(html, /신고 \d건/, "표본이 모자란 평형을 그냥 비워 뒀다");
  assert.match(html, /low-sample/);
});

test("단지를 고르지 않으면 카드가 없다", async () => {
  const p = await page("?district=노원구");
  assert.equal(p.byId("complex-card").innerHTML, "");
});

test("자치구 없이 단지 이름만으로는 카드를 그리지 않는다", async () => {
  // 전수 파일이 자치구별이라 어느 구인지 모르면 셀 수가 없다.
  const p = await page("?apt=상계주공7(고층)");
  assert.equal(p.byId("complex-card").innerHTML, "");
});

test("갱신계약과 반전세는 전세가율에서 뺀다", async () => {
  const p = await page("?district=노원구&apt=상계주공7(고층)");
  const rows = p.sandbox.complexAreas(
    "가상",
    Array.from({ length: 3 }, () => ({ apt: "가상", area: 59, amount10k: 100000 })),
    [
      ...Array.from({ length: 3 }, () => ({ apt: "가상", area: 59, deposit10k: 60000 })),
      { apt: "가상", area: 59, deposit10k: 90000, renewal: true },
      { apt: "가상", area: 59, deposit10k: 90000, monthlyRent10k: 50 },
    ]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jeonse.length, 3, "갱신이나 반전세를 전세로 셌다");
  assert.equal(rows[0].ratio, 60);
});

test("한쪽이 세 건에 못 미치면 값을 내지 않는다", async () => {
  const p = await page("?district=노원구&apt=상계주공7(고층)");
  assert.equal(MIN_DEALS_PER_SIDE, 3);
  const rows = p.sandbox.complexAreas(
    "가상",
    Array.from({ length: 2 }, () => ({ apt: "가상", area: 59, amount10k: 100000 })),
    Array.from({ length: 5 }, () => ({ apt: "가상", area: 59, deposit10k: 60000 }))
  );
  assert.equal(rows[0].saleMedian, null, "두 건으로 낸 중앙값은 그냥 두 값의 평균이다");
  assert.equal(rows[0].ratio, null);
});

test("화면이 낸 전세가율이 빌드 쪽 계산과 같다", async () => {
  // 같은 규칙이 scripts/complex-ratio.mjs와 이 화면 양쪽에 있다. 갈라지면
  // 자치구 페이지의 '단지별 중앙값'과 이 카드가 서로 다른 말을 하게 된다.
  //
  // 한 구만 보면 그날 신고가 얇을 때 견줄 칸이 모자라 검사가 빨개진다 - 노원구가
  // 19칸으로 떨어진 날 배포가 멈췄다. 25개 구를 전부 대조해 표본을 데이터에 맡기지 않는다.
  const p = await page("?district=노원구&apt=상계주공7(고층)");
  const { DISTRICT_SLUGS } = await import("../scripts/district-slugs.ts");

  const fromScreen = [];
  const fromBuild = [];
  for (const slug of Object.values(DISTRICT_SLUGS)) {
    const [deals, rents] = await Promise.all([readJson(`deals-${slug}`), readJson(`rents-${slug}`)]);

    for (const apt of new Set(deals.deals.map((d) => d.apt))) {
      for (const row of p.sandbox.complexAreas(apt, deals.deals, rents.deals)) {
        if (row.ratio !== null) fromScreen.push(Math.round(row.ratio * 100) / 100);
      }
    }

    fromBuild.push(
      ...cellRatios(
        deals.deals.map((d) => ({ aptNm: d.apt, excluUseAr: d.area, dealAmount: String(d.amount10k) })),
        rents.deals.map((d) => ({
          aptNm: d.apt,
          excluUseAr: d.area,
          deposit: String(d.deposit10k),
          monthlyRent: d.monthlyRent10k ?? 0,
          contractType: d.renewal ? "갱신" : "신규",
        }))
      ).map((r) => Math.round(r * 100) / 100)
    );
  }

  assert.ok(fromBuild.length > 20, `견줄 칸이 ${fromBuild.length}개뿐이다`);
  assert.deepEqual(fromScreen.sort((a, b) => a - b), fromBuild.sort((a, b) => a - b));
});

test("손으로 친 글자도 단지가 하나로 좁혀지면 받는다", async () => {
  const p = await page("?district=노원구&apt=중계무지개");
  assert.match(p.byId("complex-card").innerHTML, /중계무지개 평형별/);
});

test("여러 단지에 걸리는 글자에는 카드를 그리지 않는다", async () => {
  // "상계주공"은 4단지와 7단지에 다 걸린다. 묶어 그리면 다른 단지를 한 단지로 만든다.
  const p = await page("?district=노원구&apt=상계주공");
  assert.equal(p.byId("complex-card").innerHTML, "", "여러 단지를 한 카드로 묶었다");
  // 목록은 그대로 걸러진다 - 카드만 없다.
  assert.match(p.resultHtml(), /상계주공/);
});

test("최근 두 달 표도 빌드가 묶은 평형으로 묶는다 - 소수점 면적끼리 쪼개져 전세가율이 비지 않게 (#39)", async () => {
  const p = await page("?district=노원구&apt=상계주공7(고층)");
  // 헬리오시티 84형처럼 84.95/84.98/84.99로 신고됐다. 따로 두면 어느 칸도 세 건이 안 된다.
  const sales = [84.95, 84.98, 84.99].map((area) => ({ apt: "가상", area, amount10k: 300000 }));
  const rents = [84.95, 84.96, 84.99, 84.98].map((area) => ({ apt: "가상", area, deposit10k: 150000 }));
  rents.push({ apt: "가상", area: 59.9, deposit10k: 100000 });
  const cells = { "84.98": { areas: [84.95, 84.96, 84.98, 84.99] } };

  const rows = p.sandbox.complexAreas("가상", sales, rents, cells);
  const big = rows.find((r) => r.area === 84.98);
  assert.equal(big.sale.length, 3);
  assert.equal(big.jeonse.length, 4);
  assert.equal(big.ratio, 50, "묶었으면 전세가율이 나와야 한다");
  assert.ok(rows.some((r) => r.area === 59.9), "빌드가 못 본 면적은 제 면적 그대로 남는다");
  assert.equal(p.sandbox.complexAreas("가상", sales, rents).filter((r) => r.ratio !== null).length, 0, "전제: 묶지 않으면 비어야 한다");
});

test("카드의 최근 두 달 표가 묶인 면적 폭을 적는다", async () => {
  const [deals, rents] = await Promise.all([readJson("deals-nowon"), readJson("rents-nowon")]);
  const target = deals.deals[0];
  const twin = Math.round((target.area + 0.03) * 100) / 100;
  deals.deals.push({ ...target, area: twin });
  const complexPrice = { reference: "202608", cells: { [target.apt]: { [String(target.area)]: { n: 2, areas: [target.area, twin] } } } };
  const p = await loadDealSearchPage({
    budget: await readJson("budget-deals"),
    search: await readJson("deal-search"),
    deals: { 노원구: deals },
    rents: { 노원구: rents },
    complexPrices: { 노원구: complexPrice },
    query: `?district=노원구&apt=${encodeURIComponent(target.apt)}`,
  });
  await settle();
  const html = p.byId("complex-card").innerHTML;
  const ratioTable = html.slice(html.indexOf("최근 두 달"));
  assert.ok(ratioTable.includes(`${target.area}~${twin}`), "묶인 면적 폭이 없다");
  assert.ok(!ratioTable.includes(`<td>${twin}㎡`), "묶인 면적이 따로 줄을 차지했다");
});

// --- V4: 단지 카드의 최근 전월세 셋 ------------------------------------------------

// 가상 단지 하나의 고정 픽스처. 실데이터 하루치에 기대지 않는다. rents-* 는 빌드(deal-files.ts)가 최신순으로 둔다.
const V4_APT = "가상V4단지";
const v4Fixture = () => ({
  deals: {
    district: "노원구",
    periods: ["202609", "202610"],
    deals: [59.9, 59.9, 59.9, 84.9].map((area, i) => ({ dong: "상계동", apt: V4_APT, area, floor: 3, amount10k: 60000 + i * 1000, date: `2026-10-0${i + 1}` })),
  },
  rents: {
    district: "노원구",
    periods: ["202609", "202610"],
    deals: [
      { dong: "상계동", apt: V4_APT, area: 59.9, floor: 7, deposit10k: 41000, date: "2026-10-20", renewal: false },
      { dong: "상계동", apt: "다른단지", area: 59.9, floor: 2, deposit10k: 99000, date: "2026-10-19", renewal: false },
      { dong: "상계동", apt: V4_APT, area: 59.9, floor: 5, deposit10k: 10000, monthlyRent10k: 90, date: "2026-10-15", renewal: false },
      { dong: "상계동", apt: V4_APT, area: 84.9, floor: 9, deposit10k: 52000, date: "2026-10-11", renewal: true },
      { dong: "상계동", apt: V4_APT, area: 59.9, floor: 1, deposit10k: 39000, date: "2026-09-30", renewal: false },
      { dong: "상계동", apt: V4_APT, area: 59.9, floor: 4, deposit10k: 40000, date: "2026-09-02", renewal: false },
    ],
  },
  // 59.9 형은 범위를 낼 만큼, 84.9 형은 두 건뿐이라 범위를 내지 않는다(문턱은 빌드가 정한다).
  complexPrice: {
    reference: "202610",
    cells: {
      [V4_APT]: {
        "59.9": { n: 5, median: 61000, low: 60000, high: 62500, quartile: true, raw: 60500 },
        "84.9": { n: 2 },
      },
    },
  },
});

async function v4Page(locale = "ko", network) {
  const f = v4Fixture();
  const p = await loadDealSearchPage({
    budget: await readJson("budget-deals"),
    search: await readJson("deal-search"),
    deals: { 노원구: f.deals },
    rents: { 노원구: f.rents },
    complexPrices: { 노원구: f.complexPrice },
    status: 200,
    locale,
    network,
    query: `?district=노원구&apt=${encodeURIComponent(V4_APT)}`,
  });
  await settle();
  return p.byId("complex-card").innerHTML;
}

const recentBlock = (html) => html.slice(html.lastIndexOf("<h3>"));
const whens = (block) => [...block.matchAll(/<span class="when">([^<]*)<\/span>/g)].map((m) => m[1]);

test("V4 카드: 같은 단지 최근 전월세를 최신순 셋까지, 전체 신고 수와 함께 적는다", async () => {
  const html = await v4Page();
  const block = recentBlock(html);
  assert.match(block, /^<h3>최근 전월세 \(신고 5건, 최신순\)<\/h3>/, "제목에 n 이 없다");
  assert.equal((block.match(/<li class="budget-deal">/g) ?? []).length, 3, "셋을 넘게(또는 덜) 그렸다");
  // 날짜 표시가 붙고 최신이 먼저다. 다른 단지 행은 섞이지 않는다.
  assert.deepEqual(whens(block), ["10/20", "10/15", "10/11"]);
  assert.doesNotMatch(block, /다른단지/);
  assert.match(block, /갱신/, "갱신 계약 표시가 빠졌다");
  // 카드 안 순서: 범위 → 전세가율 → 최근 전월세(B3).
  assert.ok(html.indexOf("가운데 절반") < html.indexOf("전세가율"));
  assert.ok(html.indexOf("전세가율") < html.indexOf("최근 전월세"));
});

test("V4 카드: 표본이 모자란 평형은 범위 대신 n 을 적는다(ko/en)", async () => {
  const ko = await v4Page();
  assert.match(ko, /가운데 절반 6억원 ~ 6억 2,500만원 · 5건/);
  assert.match(ko, /<span class="low-sample">신고 2건 — 범위를 내지 않습니다<\/span>/);
  const en = await v4Page("en");
  assert.match(en, /<span class="low-sample">2 filed — no range<\/span>/);
});

test("범위 말은 지난 거래의 폭이고 다음 거래 범위가 아니라고 표 바로 아래(접지 않고) 적는다 (#656 판정)", async () => {
  const ko = await v4Page();
  assert.doesNotMatch(ko, /기준 시세/);
  assert.match(ko, /<th scope="col">2026년 10월 값으로 고친 중간값<\/th>/);
  assert.match(ko, /<h3>지난 6개월 거래의 폭 — 2026년 10월 값으로 고침<\/h3>/);
  assert.match(ko, /<caption class="sr-only">가상V4단지 - 지난 6개월 거래의 폭 — 2026년 10월 값으로 고침 \(2\)<\/caption>/);
  assert.match(ko, /지난 거래 가운데 절반 6억원 ~ /);
  const note = '<p class="content-notice">이 폭은 지난 거래가 퍼진 모양이지 다음 거래가 들어올 범위가 아닙니다.';
  assert.ok(ko.includes(`</table></div>${note}`), "설명이 표 바로 아래에 없다");
  assert.ok(ko.indexOf(note) < ko.indexOf("<details"), "설명이 접힌 곳 안에 들어갔다");
  assert.doesNotMatch(ko, /28\.5/, "소급 숫자는 화면에 싣지 않는다");

  const en = await v4Page("en");
  assert.match(en, /<th scope="col">Median \([^)]* terms\)<\/th>/);
  assert.match(en, /<h3>Spread of the last 6 months' deals — adjusted to [^<]*<\/h3>/);
  assert.match(en, /middle half of past deals /);
  assert.match(en, /<\/table><\/div><p class="content-notice">This is how past deals spread, not where the next deal will land\./);
});

test("V4 카드: 영어 화면은 영어 제목과 영어 날짜로 같은 셋을 그린다", async () => {
  const block = recentBlock(await v4Page("en"));
  assert.match(block, /^<h3>Latest rentals \(5 filed\)<\/h3>/);
  assert.deepEqual(whens(block), ["Oct 20", "Oct 15", "Oct 11"]);
});

test("V4 카드: 전월세 파일을 못 받으면 최근 전월세 칸 없이 실패 자리만 남긴다", async () => {
  const html = await v4Page("ko", { failComplexPrice: false, failDeals: false, failRents: true });
  assert.doesNotMatch(html, /최근 전월세/, "받지 못한 파일로 목록을 그렸다");
  assert.match(html, /id="complex-rents-status"/);
});

// ============================================================================================================
// #731 X4 가격 위치 한 줄 - docs/complex-card.js(페이지 전용 외부 JS, deal-search 만 defer, #729 X2 가 이어 쓴다).
// 인라인 S6 여유(기준선 대비 +243B)로는 문구 두 벌과 입력 처리가 안 들어가 판정의 「넘으면 X2 의 페이지 전용 파일로」를 따랐다.
// 바이트 한도 때문에 설명을 여기 둔다:
// - 인라인 카드가 #card-rank 자리와 window.cardApt 를 두고 window.complexCard() 를 부른다. 인라인 전역(complexAreas·fullDeals·
//   complexPrices·district·locale·escapeHtml·EOK)을 그대로 쓴다. 새 데이터 0 - 카드가 이미 쥔 두 달 매매(deals-*)만 센다.
// - 평형은 매매가 가장 많은 한 칸(complexAreas 에 전세를 비워 넘기면 매매 건수순). 값을 억으로 넣으면 「지난 거래 n건 중 l건이
//   이 값보다 낮고 e건이 같음」. 같은 값은 낮은 쪽에 넣지 않고 따로 센다.
// - n<3 은 입력칸 없이 #637 틀 이유(「신고 n건이라 비움」), 0건은 줄을 비운다. 판정 문구(비싸다·싸다·적정)·백분위·색 경고는 없다.
// ============================================================================================================
const RANK_JS = await readFile(path.join(root, "docs/complex-card.js"), "utf8");
const VERDICT = /비싸|싸다|싼 |저렴|적정|고평가|저평가|합리|바가지|expensive|cheap|fair|overpriced|underpriced|bargain|reasonable/i;

async function rankPage(locale = "ko") {
  const [budget, search, deals, rents] = await Promise.all([readJson("budget-deals"), readJson("deal-search"), readJson("deals-nowon"), readJson("rents-nowon")]);
  const p = await loadDealSearchPage({ budget, search, deals: { 노원구: deals }, rents: { 노원구: rents }, locale, query: "?district=노원구&apt=상계주공7(고층)" });
  await settle(40);
  new vm.Script(RANK_JS, { filename: "docs/complex-card.js" }).runInContext(p.sandbox);
  const run = (code) => new vm.Script(code).runInContext(p.sandbox);
  // 가상 단지의 매매만 바꿔 카드 한 줄을 다시 그린다.
  const drawWith = (amounts) => {
    run(`fullDeals.set("노원구", ${JSON.stringify(amounts.map((a) => ({ apt: "가상X4", area: 59.9, amount10k: a })))}); window.cardApt = "가상X4"; window.complexCard();`);
    return p.byId("card-rank").innerHTML;
  };
  const type = (value) => {
    p.byId("complex-card").dispatch("input", { target: { id: "rank-in", value } });
    return p.byId("rank-out").textContent;
  };
  return { ...p, rank: p.sandbox.window.complexCard.rank, drawWith, type };
}

test("#731 같은 값은 낮은 쪽에 넣지 않고 따로 센다", async () => {
  const p = await rankPage();
  assert.equal(p.rank([40000, 50000, 50000, 60000], 50000), "지난 거래 4건 중 1건이 이 값보다 낮고 2건이 같음");
  assert.equal(p.rank([50000, 50000, 50000], 50000), "지난 거래 3건 중 0건이 이 값보다 낮고 3건이 같음");
  assert.equal(p.rank([50000, 50000, 50000], 90000), "지난 거래 3건 중 3건이 이 값보다 낮고 0건이 같음");
  assert.equal(p.rank([50000, 60000, 70000]), "", "값을 넣기 전에 문장을 냈다");
});

test("#731 입력칸에 억으로 넣으면 그 평형 거래 사이 위치 문장이 뜬다(소수 억도 같은 값으로 센다)", async () => {
  const p = await rankPage();
  const html = p.drawWith([81500, 81500, 90000, 70000]);
  assert.match(html, /^59\.9㎡ <label>가격\(억\) <input id="rank-in"/);
  assert.equal(p.type("8.15"), "지난 거래 4건 중 1건이 이 값보다 낮고 2건이 같음");
  assert.equal(p.type(""), "", "빈칸에 문장이 남았다");
  assert.equal(p.type("-1"), "");
});

test("#731 0건이면 줄을 비우고, n<3 이면 입력칸 없이 #637 틀 이유를 적는다", async () => {
  const p = await rankPage();
  assert.equal(p.drawWith([]), "");
  for (const n of [1, 2]) {
    const html = p.drawWith(Array.from({ length: n }, () => 50000));
    assert.equal(html, `59.9㎡ <span class="low-sample">신고 ${n}건이라 비움</span>`);
    assert.doesNotMatch(html, /<input/);
  }
  assert.match(p.drawWith([10000, 20000, 30000]), /<input/, "3건인데 입력칸이 없다");
});

test("#731 판정 문구(비싸다·싸다·적정 등)가 문구 원본에도 화면에도 없다", async () => {
  assert.doesNotMatch(RANK_JS, VERDICT);
  for (const locale of ["ko", "en"]) {
    const p = await rankPage(locale);
    const s = [30000, 40000, 50000, 50000, 60000];
    for (const v of [0, 10000, 30000, 50000, 55000, 99000]) assert.doesNotMatch(p.rank(s, v), VERDICT, `${locale} ${v}`);
    assert.doesNotMatch(p.drawWith(s) + p.drawWith([10000]), VERDICT);
    assert.doesNotMatch(p.rank(s, 50000), /%|백분위|percentile/i, "백분위로 바꿔 말했다");
  }
});

test("#731 영어 화면은 영어 문장·이유·입력칸 이름을 쓴다", async () => {
  const p = await rankPage("en");
  assert.equal(p.rank([40000, 50000, 50000, 60000], 50000), "Of 4 past deals, 1 below this and 2 equal");
  assert.equal(p.drawWith([50000, 50000]), '59.9㎡ <span class="low-sample">Blank: only 2 reported</span>');
  assert.match(p.drawWith([10000, 20000, 30000]), /<label>Price \(₩100M\) <input/);
  assert.equal(p.type("2"), "Of 3 past deals, 1 below this and 1 equal");
});

test("#731 실제 단지 카드에 자리가 있고, 외부 JS 는 deal-search 만 defer 로 읽으며 sw.js 사전캐시 밖, gzip ≤2,048B(X2 와 합계)", async () => {
  const p = await rankPage();
  assert.match(p.byId("complex-card").innerHTML, /<p id="card-rank"><\/p><div id="card-renewal">/);
  p.sandbox.window.complexCard();
  assert.match(p.byId("card-rank").innerHTML, /^\d+(\.\d+)?㎡ /, "실제 단지에서 줄이 안 그려졌다");
  const html = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
  assert.equal(html.split('<script src="./complex-card.js" defer></script>').length, 2);
  assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes("complex-card.js"), "sw.js 사전캐시에 들어갔다");
  assert.ok(gzipSync(RANK_JS, { level: 9 }).length <= 2048);
});

// ============================================================================================================
// #729 X2 비슷한 근처 단지 - 같은 docs/complex-card.js. 새 데이터 0: 카드가 이미 받은 complex-price-* 의 cells·meta 만 쓴다.
// 규칙: 고른 단지의 n 가장 큰 칸(중앙값 있음)이 기준. 같은 구 다른 단지 중 중앙값·n≥3 칸이 면적 ±10㎡ 안이고 준공 ±10년 안이면 후보.
// 같은 동 먼저, 그다음 기준 중앙값과 가까운 순으로 셋. 0곳이면 조건을 푼(같은 구, 값 있는 단지) 수만 적는다.
// ============================================================================================================
const nearCell = (median, n = 5) => ({ n, median });
const nearPrices = () => ({
  reference: "202610",
  cells: {
    기준: { "59.9": nearCell(60000, 9), "84.9": nearCell(90000, 4) },
    같은동먼값: { "59.5": nearCell(80000) },
    같은동가까움: { "60.1": nearCell(61000) },
    다른동가까움: { "59.9": nearCell(60500) },
    다른동중간: { 65: nearCell(64000) },
    다른동넷째: { 50: nearCell(70000) },
    면적밖: { "84.9": nearCell(60000) },
    준공밖: { "59.9": nearCell(60000) },
    표본얇음: { "59.9": nearCell(60000, 2) },
  },
  meta: {
    기준: { dong: "상계동", buildYear: 1990 },
    같은동먼값: { dong: "상계동", buildYear: 1995 },
    같은동가까움: { dong: "상계동", buildYear: 1985 },
    다른동가까움: { dong: "중계동", buildYear: 1992 },
    다른동중간: { dong: "중계동", buildYear: 2000 },
    다른동넷째: { dong: "하계동", buildYear: 1980 },
    면적밖: { dong: "상계동", buildYear: 1990 },
    준공밖: { dong: "상계동", buildYear: 2001 },
    표본얇음: { dong: "상계동", buildYear: 1990 },
  },
});
const OTHERS = ["같은동먼값", "같은동가까움", "다른동가까움", "다른동중간", "다른동넷째"];
const nearNone = () => {
  const f = nearPrices();
  for (const a of OTHERS) delete f.cells[a];
  return f;
};

async function nearPage(locale = "ko", prices = nearPrices(), apt = "기준") {
  const p = await rankPage(locale);
  new vm.Script(`complexPrices.set("노원구", ${JSON.stringify(prices)}); window.cardApt = ${JSON.stringify(apt)}; window.complexCard();`).runInContext(p.sandbox);
  return { ...p, html: p.byId("card-near").innerHTML, near: p.sandbox.window.complexCard.near };
}

test("#729 같은 동 먼저, 값 가까운 순 셋 - 면적 ±10㎡·준공 ±10년·n≥3 밖은 뺀다", async () => {
  const p = await nearPage();
  assert.deepEqual(
    [...p.near(nearPrices(), "기준")].map(([a, [k]]) => `${a} ${k}`),
    ["같은동가까움 60.1", "같은동먼값 59.5", "다른동가까움 59.9"]
  );
  assert.ok(p.html.startsWith(`<h3>비슷한 근처 단지</h3><ul><li><a href="?district=${encodeURIComponent("노원구")}&apt=${encodeURIComponent("같은동가까움")}">`));
  assert.match(p.html, /같은동가까움<\/a> 60\.1㎡ 6억 1,000만원 <a href="[^"]+">비교<\/a><\/li>/);
  for (const out of ["면적밖", "준공밖", "표본얇음", "다른동넷째", "다른동중간"]) assert.ok(!p.html.includes(out), out);
});

test("#729 후보가 셋보다 적으면 있는 만큼만, 0곳이면 「조건을 풀면 n곳」, 기준 칸이 없으면 비운다", async () => {
  const two = nearPrices();
  for (const a of ["같은동먼값", "다른동가까움", "다른동중간"]) delete two.cells[a];
  assert.equal(((await nearPage("ko", two)).html.match(/<li>/g) ?? []).length, 2);

  // 면적밖·준공밖은 조건을 풀면 들어오고, 표본얇음은 값이 없어 풀어도 못 든다.
  assert.equal((await nearPage("ko", nearNone())).html, '<h3>비슷한 근처 단지</h3><p class="low-sample">조건을 풀면 2곳</p>');

  const bare = nearPrices();
  bare.cells.기준 = { "59.9": { n: 2 } };
  assert.equal((await nearPage("ko", bare)).html, "", "기준 칸 없이 후보를 냈다");
  const alone = { reference: "202610", cells: { 기준: nearPrices().cells.기준 }, meta: { 기준: nearPrices().meta.기준 } };
  assert.equal((await nearPage("ko", alone)).html, "", "풀어도 0곳인데 문장을 냈다");
});

test("#729 영어 화면은 영어 제목·문구, 판정 문구는 없고 floor-gap 링크는 카드에 한 줄뿐", async () => {
  const p = await nearPage("en");
  assert.match(p.html, /^<h3>Similar complexes nearby<\/h3><ul>/);
  assert.match(p.html, /60\.1㎡ ₩610M <a href="[^"]+">Compare<\/a><\/li>/);
  assert.equal((await nearPage("en", nearNone())).html, '<h3>Similar complexes nearby</h3><p class="low-sample">2 if loosened</p>');
  assert.doesNotMatch(p.html, VERDICT);
  // floor-gap 링크는 가격 표 아래 한 줄(card-links)만 - 근처 단지 칸이 또 달지 않는다.
  assert.doesNotMatch(p.html, /floor-gap/);
  assert.ok(p.byId("complex-card").innerHTML.split("floor-gap.html").length <= 2);
});

test("#729 실데이터 단지 카드에 근처 단지가 그려지고 complex-card.js 합계 gzip ≤2,048B", async () => {
  const real = JSON.parse(await readFile(path.join(root, "docs/data/complex-price-nowon.json"), "utf8"));
  const p = await nearPage("ko", real, "상계주공7(고층)");
  assert.match(p.html, /<li><a href="\?district=/);
  const size = gzipSync(RANK_JS, { level: 9 }).length;
  assert.ok(size <= 2048, `${size}B`);
});

// ============================================================================================================
// #730 X3 나란히 보기 - 같은 docs/complex-card.js. ?compare=B 또는 B,C 로 고른 단지 옆에 둘까지(합 셋) 한 표로 놓는다.
// 칸은 고른 단지의 기준 칸(n 가장 큼)과 면적이 가장 가까운 칸(중앙값·n≥3). 한 줄에 면적·중앙값·가운데 절반(또는 최저~최고)·n,
// 기준 기간은 표 제목(priceHeading) 한 곳. 넷 이상(compare 셋 이상)은 통째로 안 그리고, 모르는/값 없는 이름은 조용히 뺀다.
// 근처 단지 줄마다 「비교」 링크가 그 단지 하나를 compare 에 담는다. 순위·판정 문구 없음. compare 는 syncUrl 이 지우지 않는다.
// ============================================================================================================
const cmpPrices = () => {
  const f = nearPrices();
  for (const a of Object.values(f.cells)) for (const c of Object.values(a)) Object.assign(c, { low: c.median - 5000, high: c.median + 5000, quartile: true });
  return f;
};

async function cmpPage(search, locale = "ko") {
  const p = await rankPage(locale);
  const run = (code) => new vm.Script(code).runInContext(p.sandbox);
  const draw = (s) => {
    run(`location.search = ${JSON.stringify(s)}; complexPrices.set("노원구", ${JSON.stringify(cmpPrices())}); window.cardApt = "기준"; window.complexCard();`);
    return p.byId("card-near").innerHTML;
  };
  return { ...p, run, draw, html: draw(search) };
}
const base = `?district=${encodeURIComponent("노원구")}&apt=${encodeURIComponent("기준")}`;
const cmp = (...a) => `${base}&compare=${encodeURIComponent(a.join(","))}`;
const rows = (html) => [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th><td>([^<]+)<\/td>/g)].map((m) => `${m[1]} ${m[2]}`);

test("#730 근처 단지 「비교」 링크 → URL → 같은 표로 복원, syncUrl 이 compare 를 남긴다", async () => {
  const p = await cmpPage(base);
  assert.doesNotMatch(p.html, /<table/, "compare 없이 표를 그렸다");
  const href = p.html.match(/<a href="([^"]+compare=[^"]+)">비교<\/a>/)[1];
  assert.equal(href, cmp("같은동가까움"));
  const html = p.draw(href);
  assert.match(html, /<h3>지난 6개월 거래의 폭 — 2026년 10월 값으로 고침<\/h3><table class="data-table">/);
  assert.deepEqual(rows(html), ["기준 59.9㎡", "같은동가까움 60.1㎡"]);
  assert.match(html, /6억 1,000만원 · 지난 거래 가운데 절반 5억 6,000만원 ~ 6억 6,000만원 · 5건<\/td>/);
  // 셋(compare 둘)까지, 면적은 기준 칸과 가장 가까운 칸.
  assert.deepEqual(rows(p.draw(cmp("다른동중간", "면적밖"))), ["기준 59.9㎡", "다른동중간 65㎡", "면적밖 84.9㎡"]);
  p.run(`location.search = ${JSON.stringify(cmp("같은동가까움"))}; syncUrl();`);
  assert.match(p.sandbox.location.search, /compare=/, "syncUrl 이 compare 를 지웠다");
});

test("#730 모르는·값 없는·자기 자신·중복 이름은 조용히 빼고, 넷 이상은 그리지 않는다", async () => {
  const p = await cmpPage(base);
  const two = ["기준 59.9㎡", "같은동먼값 59.5㎡"];
  assert.deepEqual(rows(p.draw(cmp("없는단지", "같은동먼값"))), two);
  assert.deepEqual(rows(p.draw(cmp("표본얇음", "같은동먼값"))), two);
  assert.deepEqual(rows(p.draw(cmp("기준", "같은동먼값"))), two);
  assert.deepEqual(rows(p.draw(cmp("같은동먼값", "같은동먼값"))), two);
  for (const s of [cmp("없는단지"), cmp("없는단지", "표본얇음"), `${base}&compare=`, `${base}&compare=,,`, `${base}&compare=%E0%A4%A`, cmp("같은동먼값", "같은동가까움", "다른동가까움")]) {
    const html = p.draw(s);
    assert.doesNotMatch(html, /<table/, s);
    assert.match(html, /^<h3>비슷한 근처 단지<\/h3><ul>/, `근처 단지가 깨졌다 ${s}`);
  }
  // 가격 파일이 없어도 던지지 않는다.
  p.run(`complexPrices.delete("노원구"); location.search = ${JSON.stringify(cmp("같은동먼값"))}; window.complexCard();`);
  assert.equal(p.byId("card-near").innerHTML, "");
});

test("#730 영어 화면은 영어 제목·링크·n, 판정·순위 문구는 원본에도 화면에도 없다", async () => {
  const p = await cmpPage(cmp("같은동가까움", "다른동가까움"), "en");
  assert.match(p.html, /<a href="[^"]+compare=[^"]+">Compare<\/a>/);
  assert.match(p.html, /<h3>Spread of the last 6 months' deals — adjusted to [^<]+<\/h3>/);
  assert.match(p.html, /₩610M · middle half of past deals ₩560M ~ ₩660M · 5 deals<\/td>/);
  for (const locale of ["ko", "en"]) assert.doesNotMatch((await cmpPage(cmp("같은동가까움", "다른동가까움"), locale)).html, VERDICT);
  assert.doesNotMatch(RANK_JS, /순위|더 싸|더 비싸|cheaper|winner|1위/);
});

test("#730 X3 를 더해도 complex-card.js 합계 gzip ≤2,048B", () => {
  const size = gzipSync(RANK_JS, { level: 9 }).length;
  assert.ok(size <= 2048, `${size}B`);
});
