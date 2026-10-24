import test from "node:test";
import assert from "node:assert/strict";
import { buildBands, mergeBands } from "../scripts/budget-bands.ts";
import { BUDGET_PAGES } from "../scripts/budget-pages.ts";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const REALESTATE = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  period: "202608",
  overall: {
    sale: { avgPricePerM2: 13_457_520, avgPricePerPyeong10k: 4449, transactionCount: 575 },
    jeonse: { avgDepositPerM2: 7_777_223, avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: [],
};

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

const BUDGET = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  periods: ["202608"],
  bands: mergeBands({
    "202608": buildBands([
      deal(72_000, { apt: "칠억단지" }),
      deal(85_000, { apt: "팔억가단지" }),
      deal(88_000, { apt: "팔억나단지", district: "도봉구", dong: "창동", floor: 12 }),
      deal(95_000, { apt: "구억단지" }),
    ]),
  }),
};

const open = (extra = {}) => loadRealestatePage({ realestate: REALESTATE, budget: BUDGET, ...extra });

test("시세 페이지에서는 예산으로 찾기를 열지 않는다", async () => {
  const page = await open();

  assert.equal(page.byId("budget-section").hidden, true, "거래내역 검색과 겹치는 기능이 남아 있다");
  assert.equal(page.budgetHtml(), "");
});

test("주소에 예산이 붙어 있어도 열지 않는다", async () => {
  const page = await open({ search: "?budget=9" });

  assert.equal(page.byId("budget-section").hidden, true);
  assert.equal(page.sandbox.location.search, "?budget=9", "주소를 건드렸다");
});

test("자치구·거래 유형 페이지에서도 열지 않는다", async () => {
  for (const extra of [{ districtName: "노원구" }, { kind: "sale" }]) {
    const page = await open(extra);
    assert.equal(page.byId("budget-section").hidden, true, JSON.stringify(extra));
  }
});

// 여기부터는 반대쪽이다(#288). 예산대 장에서 이 구획은 그 장의 본문이고(요약·한눈에·후보 단지·비용 문단·거래 목록),
// 빌드가 구워서 내보낸다. 전에는 화면 스크립트가 예산 데이터가 올 때까지 구획을 통째로 숨겼다 - 예산 데이터는
// 시세·단지 전세가율·추이 다음, 네 번째로 받으므로 그동안 본문이 비어 보였고, 요청이 실패하면 그 방문 내내 숨겨진 채
// 남았다. 숨겼다 펴는 동안 아래 구획이 두 번 밀려 CLS 0.69가 나왔다(#274 기준선). 끝 상태만 보면 "숨겼다가 다시 편"
// 것을 못 보므로 hidden에 쓴 값을 전부 본다.
const BAND_8EOK = 80_000;
// 받은 HTML에 구워져 있던 본문 자리. 스크립트가 손대지 않았는지 글자 그대로 견준다.
const BAKED = '<p class="budget-summary">구운 요약</p><ul class="budget-deals"><li class="budget-deal">구운 거래</li></ul>';
const openBudgetPage = (extra = {}) =>
  open({ budgetBand: BAND_8EOK, baked: { "budget-result": { innerHTML: BAKED } }, ...extra });

/** 적은 데이터 파일의 응답을 `release()`를 부를 때까지 붙들어 둔다. */
function hold(...names) {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  return { gate: (name) => (names.includes(name) ? held : undefined), release };
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function assertBakedKept(page, label) {
  assert.equal(page.byId("budget-section").hidden, false, `${label}: 구운 예산 구획이 숨겨져 있다`);
  assert.ok(!page.hiddenWrites("budget-section").includes(true), `${label}: 구운 예산 구획을 한 번이라도 숨겼다`);
  assert.equal(page.budgetHtml(), BAKED, `${label}: 구운 본문을 지우거나 바꿨다`);
}

test("예산대 장: 예산 데이터를 받는 중에도 구운 구획을 숨기거나 지우지 않고, 도착하면 다시 그린다 (#288)", async () => {
  for (const [locale, summary] of [
    ["ko", /8억대에서 2건이 거래됐습니다/],
    ["en", /2 deals filed in the /],
  ]) {
    const { gate, release } = hold("budget-deals");
    const page = await openBudgetPage({ gate, locale });
    assertBakedKept(page, `${locale} 받는 중`);

    release();
    await settle();
    assert.match(page.budgetHtml(), summary, `${locale}: 도착한 데이터로 다시 그리지 않았다`);
    assert.equal(page.byId("budget-section").hidden, false);
    assert.ok(!page.hiddenWrites("budget-section").includes(true), `${locale}: 받는 동안 한 번 숨겼다`);
  }
});

test("예산대 장: 앞선 요청(시세·단지 전세가율·추이)이 늦어도 구운 구획은 그대로다 (#288)", async () => {
  for (const name of ["realestate", "complex-ratio", "realestate-trend"]) {
    const { gate } = hold(name);
    assertBakedKept(await openBudgetPage({ gate }), `${name} 받는 중`);
  }
});

test("예산대 장: 예산 데이터를 못 받아도 구운 구획이 그 방문 내내 남는다 (#288)", async () => {
  const refused = (name) => {
    if (name === "budget-deals") throw new TypeError("network down");
  };
  for (const locale of ["ko", "en"]) {
    assertBakedKept(await openBudgetPage({ budget: undefined, locale }), `${locale} 404`);
    assertBakedKept(await openBudgetPage({ gate: refused, locale }), `${locale} 요청 거부`);
    // 파일은 왔는데 구간이 하나도 없다(수집이 빈 날). 빌드도 이런 날에는 예산대 장을 다시 굽지 않고 둔다.
    assertBakedKept(await openBudgetPage({ budget: { ...BUDGET, bands: [] }, locale }), `${locale} 구간 없음`);
  }
});

test("찍어낸 예산대 열여덟 장에 실려 나간 스크립트도 받는 중에 구운 구획을 숨기지 않는다 (#288)", async () => {
  for (const { file, min10k } of BUDGET_PAGES) {
    const { gate } = hold("budget-deals");
    const page = await openBudgetPage({ file: `${SITE}/${file}`, budgetBand: min10k, gate });
    assertBakedKept(page, `${SITE}/${file}`);
  }
});
