import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildFiles } from "../scripts/build-complex-price.mjs";
import {
  MIN_DEALS,
  QUARTILE_FROM,
  adjust,
  districtCells,
  indexLevels,
  marketDeal,
  summarize,
} from "../scripts/complex-price.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

const item = (over = {}) => ({
  sggCd: 11350,
  aptNm: "가단지",
  excluUseAr: 84.9876,
  dealAmount: "100,000",
  dealYear: 2026,
  dealMonth: 6,
  dealDay: 15,
  dealingGbn: "중개거래",
  cdealType: "",
  ...over,
});

// 동북권(220) 지수: 4월 100, 7월 110. 8월은 공식 지수가 없고 메운 달로 +1%.
const index = { series: { 200: [["202604", 100], ["202607", 110]], 220: [["202604", 100], ["202605", 100], ["202606", 105], ["202607", 110]] } };
const outlook = {
  regions: [
    { code: "200", nowcast: { bias: 0.35, months: [{ month: "202608", change: 1 }] } },
    { code: "220", nowcast: { months: [{ month: "202608", change: 1 }] } },
  ],
};

test("해제된 거래와 직거래는 범위에 넣지 않는다", () => {
  assert.ok(marketDeal(item()));
  assert.equal(marketDeal(item({ cdealType: "O" })), null);
  assert.equal(marketDeal(item({ dealingGbn: "직거래" })), null, "가족 간 거래 같은 값이 시세에 섞였다");
});

test("평형 키는 거래 목록(deals-*.json)과 같은 자리수다", () => {
  // 화면은 deals 파일의 area(소수 둘째 자리)로 평형을 찾는다. 다르면 카드가 비어 보인다.
  assert.equal(marketDeal(item()).area, 84.99);
});

test("메운 달은 공식 지수 뒤에만 잇는다", () => {
  const { levels, filled } = indexLevels(index, outlook);
  assert.equal(levels["220"].last, "202608");
  assert.deepEqual(filled["220"], ["202608"]);
  assert.ok(Math.abs(levels["220"].byMonth.get("202608") - 110 * Math.exp(0.01)) < 1e-9);

  const stale = indexLevels(index, { regions: [{ code: "220", nowcast: { months: [{ month: "202606", change: 9 }] } }] });
  assert.equal(stale.levels["220"].byMonth.get("202606"), 105, "공식 지수가 있는 달을 메운 값으로 덮었다");
});

test("지난 거래는 기준 달 값으로 고치고, 기준 달 뒤 거래는 그대로 둔다", () => {
  const { levels } = indexLevels(index, null);
  const april = marketDeal(item({ dealMonth: 4 }));
  const fixed = adjust(april, levels, "202607");
  assert.equal(fixed.adjusted, true);
  assert.ok(Math.abs(fixed.value - 110000) < 1e-6, "4월 10억이 7월 값(지수 100→110)으로 11억이 되어야 한다");

  const august = adjust(marketDeal(item({ dealMonth: 8 })), levels, "202607");
  assert.deepEqual(august, { value: 100000, adjusted: false });
});

test("권역마다 마지막 달이 달라도 기준 달 뒤 거래는 거꾸로 고치지 않는다", () => {
  // 동북권만 8월을 메웠고 기준 달은 가장 이른 7월이다. 8월 지수가 있다고 8월 거래를 7월 값으로
  // 깎아 내리면, 가장 최근 거래가 가장 많이 틀린 값이 된다.
  const { levels } = indexLevels(index, outlook);
  assert.ok(levels["220"].byMonth.has("202608"));
  assert.deepEqual(adjust(marketDeal(item({ dealMonth: 8 })), levels, "202607"), { value: 100000, adjusted: false });
});

test("문턱 아래면 건수만 남긴다 — 빈칸과 '모자람'은 다르다", () => {
  const { levels } = indexLevels(index, null);
  const deals = (n) => Array.from({ length: n }, (_, i) => marketDeal(item({ dealAmount: String(100000 + i * 1000) })));
  assert.deepEqual(summarize(deals(MIN_DEALS - 1), levels, "202607"), { n: MIN_DEALS - 1 });

  const few = summarize(deals(MIN_DEALS), levels, "202607");
  assert.equal(few.quartile, false, "세 건으로 사분위를 냈다");
  assert.ok(few.low < few.median && few.median < few.high);

  const many = summarize(deals(QUARTILE_FROM), levels, "202607");
  assert.equal(many.quartile, true);
  assert.ok(many.raw < many.median, "6월 거래를 7월 값으로 올려 고쳤는데 고치기 전보다 작다");
});

test("창 밖의 거래는 범위에 들어가지 않는다", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const items = [item({ dealMonth: 6 }), item({ dealMonth: 6, dealDay: 20 }), item({ dealMonth: 3, dealDay: 1 })];
  const built = buildFiles({ itemsByDistrict: { 11350: items }, index, outlook, now });
  const cell = built.files.nowon.cells["가단지"]["84.99"];
  assert.equal(cell.n, 2, "183일보다 오래된 3월 거래가 들어갔다");
  assert.equal(built.reference, "202608");
  assert.equal(built.files.nowon.referenceFilled, true);
  assert.equal(built.files.nowon.referenceBias, 0.35);
});

test("단지마다 평형별로 묶는다", () => {
  const { levels } = indexLevels(index, null);
  const deals = [item(), item({ excluUseAr: 59.9 }), item({ aptNm: "나단지" })].map(marketDeal);
  const cells = districtCells(deals, levels, "202607");
  assert.deepEqual(Object.keys(cells).sort(), ["가단지", "나단지"]);
  assert.deepEqual(Object.keys(cells["가단지"]).sort(), ["59.9", "84.99"]);
});

// --- 화면 ------------------------------------------------------------------------

const settle = async (n = 300) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 5));
};

async function page(query, complexPrice) {
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
    complexPrices: { 노원구: complexPrice },
    query,
  });
  await settle();
  return p;
}

const eok = (n) => {
  const e = Math.floor(n / 10000);
  const m = n % 10000;
  return !e ? `${m.toLocaleString("ko-KR")}만원` : !m ? `${e}억원` : `${e}억 ${m.toLocaleString("ko-KR")}만원`;
};

test("카드가 빌드가 낸 범위를 그대로 그린다", async () => {
  const file = await readJson("complex-price-nowon");
  const [apt, areas] = Object.entries(file.cells).find(([, a]) => Object.values(a).some((c) => c.quartile));
  const [, cell] = Object.entries(areas).find(([, c]) => c.quartile);

  const p = await page(`?district=노원구&apt=${encodeURIComponent(apt)}`, file);
  const html = p.byId("complex-card").innerHTML;
  assert.match(html, /매매가 범위/);
  assert.ok(html.includes(eok(cell.median)), `중앙값 ${eok(cell.median)}이 카드에 없다`);
  assert.ok(html.includes(`${eok(cell.low)} ~ ${eok(cell.high)}`), "범위가 빌드 값과 다르다");
});

test("두 달 목록에 없는 단지도 여섯 달 안에 거래가 있으면 카드가 뜬다", async () => {
  const file = {
    reference: "202608",
    referenceFilled: true,
    referenceBias: 0.35,
    cells: { 여섯달단지: { 59.9: { n: 4, median: 70000, low: 68000, high: 72000, quartile: false, raw: 69000, unadjusted: 0 }, 84.9: { n: 2 } } },
  };
  const p = await page("?district=노원구&apt=여섯달단지", file);
  const html = p.byId("complex-card").innerHTML;
  assert.match(html, /여섯달단지/);
  assert.match(html, /7억원/);
  assert.match(html, /최저~최고/, "네 건인데 사분위라고 적었다");
  assert.match(html, /신고 2건 — 범위를 내지 않습니다/);
  assert.match(html, /2026년 8월/);
  assert.match(html, /\+0\.35%p/, "메운 달의 치우침을 적지 않았다");
});

test("한 단지 안 1㎡ 안쪽 면적은 한 칸으로 묶되, 사슬로 번지지 않는다 (#32)", async () => {
  const { areaGroups } = await import("../scripts/complex-price.mjs");
  const deals = [84.95, 84.96, 84.98, 84.98, 84.99, 59.9, 84.0, 84.9, 85.8].map((area) => ({ area }));
  const label = areaGroups(deals);
  // 84.0부터 1㎡ 안(84.0~84.99)은 한 묶음, 85.8은 84.0에서 1㎡를 넘어 따로 - 84.9를 거쳐 사슬로 붙지 않는다.
  assert.equal(label.get(84.95), label.get(84.0));
  assert.equal(label.get(84.95), 84.98, "묶음 이름은 거래가 가장 많은 면적");
  assert.equal(label.get(85.8), 85.8);
  assert.equal(label.get(59.9), 59.9);
});

test("묶인 칸은 묶인 면적들을 남기고, 거래를 합쳐 범위를 낸다", () => {
  const { levels } = indexLevels(index, null);
  const deals = [84.95, 84.96, 84.98].map((a) => marketDeal(item({ excluUseAr: a })));
  const cells = districtCells(deals, levels, "202607");
  assert.deepEqual(Object.keys(cells["가단지"]), ["84.95"]);
  assert.deepEqual(cells["가단지"]["84.95"].areas, [84.95, 84.96, 84.98]);
  assert.equal(cells["가단지"]["84.95"].n, 3, "같은 평형 세 건이 합쳐지지 않았다");
});

test("칸에 창 안 최고 한 건(층)과 1년 전 같은 칸 중앙값을 남긴다 (#35)", () => {
  const { levels } = indexLevels(index, null);
  const deals = [100000, 104000, 98000].map((a, i) => marketDeal(item({ dealAmount: String(a), floor: String(10 + i) })));
  const old = [90000, 92000, 94000, 70000].map((a) => marketDeal(item({ dealAmount: String(a), dealYear: 2025, excluUseAr: 84.5 })));
  const cells = districtCells(deals, levels, "202607", { yearAgo: old, yearAgoMonths: ["202506", "202507", "202508"] });
  const c = cells["가단지"]["84.99"];
  assert.deepEqual(c.top, { amount: 104000, floor: 11, date: "2026-06-15" });
  assert.equal(c.yearAgo.median, 91000, "1년 전 중앙값이 고치기 전 값이 아니다");
  assert.equal(c.yearAgo.n, 4);
  assert.deepEqual(c.yearAgo.months, ["202506", "202507", "202508"]);
});

test("1년 전 거래가 3건 미만이면 비교값을 두지 않는다", () => {
  const { levels } = indexLevels(index, null);
  const deals = [100000, 104000, 98000].map((a) => marketDeal(item({ dealAmount: String(a) })));
  const old = [90000, 92000].map((a) => marketDeal(item({ dealAmount: String(a), dealYear: 2025 })));
  const cells = districtCells(deals, levels, "202607", { yearAgo: old, yearAgoMonths: ["202506"] });
  assert.equal(cells["가단지"]["84.99"].yearAgo, undefined);
});

test("카드가 1년 전 중앙값과 6개월 최고(층)를 그린다 (#35)", async () => {
  const file = {
    reference: "202608",
    cells: {
      비교단지: {
        84.9: {
          n: 6, median: 80000, low: 78000, high: 82000, quartile: true, raw: 79000, unadjusted: 0,
          top: { amount: 85000, floor: 15, date: "2026-08-01" },
          yearAgo: { median: 72000, n: 5, months: ["202508", "202509", "202510"] },
        },
      },
    },
  };
  const p = await page("?district=노원구&apt=비교단지", file);
  const html = p.byId("complex-card").innerHTML;
  assert.match(html, /1년 전 중앙값/);
  assert.match(html, /7억 2,000만원/);
  assert.match(html, /8억 5,000만원/);
  assert.match(html, /15층/);
  assert.match(html, /2025년 8~10월/);
});

test("고친 범위와 고치지 않은 실제 최고 신고를 머리글에서 갈라 적는다 (#38)", async () => {
  // 값이 오른 칸: 실제 최고(36.8억)가 8월 값으로 고친 범위 하단(37.9억)보다 낮다 - 모순이 아니라 서로 다른 값이라는 게 읽혀야 한다.
  const file = {
    reference: "202608",
    cells: {
      오른단지: {
        130.06: { n: 3, median: 387821, low: 379390, high: 387841, quartile: false, raw: 365000, unadjusted: 0, top: { amount: 368000, floor: 12, date: "2026-05-01" } },
      },
    },
  };
  const p = await page("?district=노원구&apt=오른단지", file);
  const html = p.byId("complex-card").innerHTML;
  assert.match(html, /<th>중앙값 \(2026년 8월 값\)<\/th>/);
  assert.match(html, /<th>범위 \(2026년 8월 값\)<\/th>/);
  assert.match(html, /고친 최저~최고/);
  assert.match(html, /<th>실제 최고 신고 \(고치기 전\)<\/th>/);
  assert.match(html, /실제 최고가 고친 범위보다 낮게 나올 수 있습니다/, "1년 전 값이 없어도 실제 최고 설명이 나와야 한다");
  assert.doesNotMatch(html, /6개월 최고/);
});
