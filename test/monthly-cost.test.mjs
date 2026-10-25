import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { monthlyCost } from "../scripts/conversion.ts";
import {
  NAME,
  PUBLIC_ITERATIONS,
  PUBLIC_WIDTH,
  WITHHELD_WIDTH,
  buildPayload,
  bootstrapYoy,
  convertedCost,
  mulberry32,
  quantile,
  ratesAt,
} from "../scripts/build-monthly-cost.ts";
import { shiftMonth } from "../scripts/realestate-slots.ts";

// #620(#587 PR2) 환산 월 비용. 픽스처는 data-analyst ① 댓글(#587 issuecomment-6396586831)의 입력값으로 만든다:
// 서울 단지쌍 중앙 전세보증금 5.5억→6.4억, 월세보증금 1.5억→2억, 월세 130→140만원, 전세대출 3.98→4.23%, 예금 2.48→3.14%.
// 기대값(같은 댓글): 전세안 165.2→208.8 +26.4%, 금리 몫 +8.65%, 월세안 175.0→205.3 +17.3%. 허용 오차 ±0.1.

const ITER = 200;
const near = (got, want, tol = 0.1, msg = "") => assert.ok(Math.abs(got - want) <= tol, `${msg} ${got} vs ${want} (±${tol})`);

const DISTRICTS = ["노원구", "강남구", "금천구"];
const FIRST = "202411";
const LAST = "202608";
const monthsBetween = (a, b) => {
  const out = [];
  for (let m = a; m <= b; m = shiftMonth(m, 1)) out.push(m);
  return out;
};
const RAW_MONTHS = monthsBetween(FIRST, LAST);

// 21개 단지(자치구 셋 × 7), 면적대 하나(60~85㎡). 값은 중앙에서 대칭으로 퍼져 서울 중앙값이 정확히 분석가 입력이 된다.
function dealsFor(month) {
  const current = month >= "202509";
  const lv = current ? { jeonse: 64_000, deposit: 20_000, rent: 140 } : { jeonse: 55_000, deposit: 15_000, rent: 130 };
  const deals = [];
  for (let i = 0; i < 21; i += 1) {
    const o = i - 10;
    const common = { district: DISTRICTS[i % 3], dong: `동${i % 3}`, apt: `단지${String(i).padStart(2, "0")}`, area: 84, renewal: false, date: `${month.slice(0, 4)}-${month.slice(4)}-15` };
    deals.push({ ...common, deposit10k: lv.jeonse + 1_000 * o });
    deals.push({ ...common, deposit10k: lv.deposit + 500 * o, monthlyRent10k: lv.rent + 5 * o });
  }
  return deals;
}

const fixtureDeals = (months = RAW_MONTHS) => Object.fromEntries(months.map((m) => [m, dealsFor(m)]));

// 전 기간 금리(분석가 두 달은 실제 값, 나머지는 그럴듯한 상수).
function fixtureSeries(months = RAW_MONTHS) {
  const loan = months.map((m) => [m, m === "202508" ? 3.98 : m === "202608" ? 4.23 : 4.0]);
  const deposit = months.map((m) => [m, m === "202508" ? 2.48 : m === "202608" ? 3.14 : 2.7]);
  return { jeonse_loan_rate: loan, deposit_rate: deposit };
}

const run = (over = {}) =>
  buildPayload({ dealsByMonth: fixtureDeals(), series: fixtureSeries(), lastClosed: "202609", iterations: ITER, ...over });

test("convertedCost 는 화면의 monthlyCost 를 그대로 부른다 - 80/20 분석가 값 재현(±0.1)", () => {
  const r0 = { loanRate: 3.98, depositRate: 2.48 };
  const r1 = { loanRate: 4.23, depositRate: 3.14 };
  near(convertedCost({ deposit10k: 55_000, ...r0 }), 165.2, 0.1, "전세안 202508");
  near(convertedCost({ deposit10k: 64_000, ...r1 }), 208.8, 0.1, "전세안 202608");
  near(convertedCost({ deposit10k: 15_000, monthlyRent10k: 130, ...r0 }), 175.0, 0.1, "월세안 202508");
  near(convertedCost({ deposit10k: 20_000, monthlyRent10k: 140, ...r1 }), 205.3, 0.1, "월세안 202608");

  // 같은 식: 80% 대출이자(monthlyCost, 가진 돈 20%) + 그 20% 를 예금에 둘 때 받았을 세후 이자(monthlyCost 의 earned).
  const housing = monthlyCost({ deposit10k: 55_000, cash10k: 11_000, ...r0 });
  const idle = monthlyCost({ deposit10k: 0, cash10k: 11_000, ...r0 });
  near(convertedCost({ deposit10k: 55_000, ...r0 }), housing.cost10k + idle.earned10k, 0.1, "monthlyCost 두 호출의 합");

  // 사본 금지: 생성기 소스에 금리 산식이 따로 있지 않다(이자 = 금액 × 연율/100/12 는 conversion.ts 한 곳).
  const src = readFileSync(path.join(import.meta.dirname, "../scripts/build-monthly-cost.ts"), "utf8");
  assert.ok(!/\/\s*100\s*\/\s*12/.test(src), "생성기에 월 이자 산식 사본이 있다");
  assert.ok(/monthlyCost\(/.test(src));
});

test("서울 전체 202508→202608 이 분석가 수치를 재현한다(±0.1): 전세안 +26.4%, 금리 몫 +8.65%, 월세안 +17.3%", () => {
  const out = run();
  const p = out.seoul.points.find((x) => x.month === "202608");
  assert.ok(p, "202608 점이 없다");
  assert.equal(p.base, "202508");
  assert.deepEqual(p.window, ["202603", "202604", "202605", "202606", "202607", "202608"]);
  assert.equal(p.jeonse.baseDeposit10k, 55_000);
  assert.equal(p.jeonse.deposit10k, 64_000);
  near(p.jeonse.baseCost10k, 165.2);
  near(p.jeonse.cost10k, 208.8);
  near(p.jeonse.yoy, 26.4);
  near(p.jeonse.rateShare, 8.65);
  near(p.jeonse.depositShare, (64_000 / 55_000 - 1) * 100, 0.01, "보증금 몫 = 보증금 변화");
  near(p.wolse.baseCost10k, 175.0);
  near(p.wolse.cost10k, 205.3);
  near(p.wolse.yoy, 17.3);
  // 두 몫은 곱으로 전체가 된다(금리 몫과 보증금 몫을 늘 나란히 적는다).
  near((1 + p.jeonse.rateShare / 100) * (1 + p.jeonse.depositShare / 100) * 100 - 100, p.jeonse.yoy, 0.01, "전세안 분해");
  near((1 + p.wolse.rateShare / 100) * (1 + p.wolse.levelShare / 100) * 100 - 100, p.wolse.yoy, 0.01, "월세안 분해");
  assert.deepEqual(p.rates, { loan: 4.23, deposit: 3.14 });
  assert.deepEqual(p.baseRates, { loan: 3.98, deposit: 2.48 });
  assert.deepEqual(out.seoul.name, NAME);
  assert.equal(NAME.ko, "환산 월 비용(평균금리 가정)");
});

test("점은 마감된 달 ∩ 두 금리 계열 ∩ 원본 창 - 원본 22개월이면 202604~202608 다섯 점", () => {
  const out = run();
  assert.deepEqual(out.seoul.points.map((p) => p.month), ["202604", "202605", "202606", "202607", "202608"]);
  // 마감 전 달은 넣지 않는다.
  assert.deepEqual(run({ lastClosed: "202607" }).seoul.points.map((p) => p.month), ["202604", "202605", "202606", "202607"]);
});

test("같은 입력이면 같은 바이트 - 입력 순서를 섞어도 같다", () => {
  const a = run();
  const b = run();
  assert.equal(JSON.stringify(a.seoul), JSON.stringify(b.seoul));
  assert.equal(JSON.stringify(a.cells), JSON.stringify(b.cells));
  const shuffled = Object.fromEntries(Object.entries(fixtureDeals()).reverse().map(([m, list]) => [m, [...list].reverse()]));
  const c = buildPayload({ dealsByMonth: shuffled, series: fixtureSeries(), lastClosed: "202609", iterations: ITER });
  assert.equal(JSON.stringify(c.seoul), JSON.stringify(a.seoul));
  assert.equal(JSON.stringify(c.cells), JSON.stringify(a.cells));
  assert.ok(!/updatedAt|generatedAt/.test(JSON.stringify(a.seoul)), "시각이 들어가면 같은 입력에서 바이트가 갈린다");
});

test("금리 계열이 없거나 모자라면 값을 지어내지 않는다", () => {
  assert.equal(run({ series: null }), null);
  assert.equal(run({ series: {} }), null);
  assert.equal(run({ series: { jeonse_loan_rate: fixtureSeries().jeonse_loan_rate } }), null, "예금 금리 없이 점을 냈다");

  // 지금 main 처럼 두 계열이 13개월(202508~202608)뿐이면 202608 한 점만.
  const thirteen = monthsBetween("202508", "202608");
  const only = run({ series: fixtureSeries(thirteen) });
  assert.deepEqual(only.seoul.points.map((p) => p.month), ["202608"]);

  // 기준 달 금리가 0·빈 값이면 그 점을 빼고, 다른 점은 남긴다.
  const s = fixtureSeries();
  s.deposit_rate = s.deposit_rate.map(([m, v]) => [m, m === "202508" ? "" : v]);
  s.jeonse_loan_rate = s.jeonse_loan_rate.map(([m, v]) => [m, m === "202505" ? 0 : v]);
  assert.deepEqual(run({ series: s }).seoul.points.map((p) => p.month), ["202604", "202606", "202607"]);

  // 원본 달이 빠지면 그 달을 창에 품는 점은 빠진다(채우지 않는다). 202412 가 없으면 202604·202605 의 기준 창이 깨진다.
  const deals = fixtureDeals();
  delete deals["202412"];
  assert.deepEqual(run({ dealsByMonth: deals }).seoul.points.map((p) => p.month), ["202606", "202607", "202608"]);

  assert.equal(run({ dealsByMonth: {} }), null);
  const text = JSON.stringify(run());
  assert.ok(!/NaN|Infinity|null,null/.test(text), "숫자가 아닌 값이 새었다");
});

test("구간: 백분위 분위수(R type 7)와 고정 시드 부트스트랩", () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  near(quantile([0, 10], 0.025), 0.25, 1e-12);
  near(quantile([0, 10], 0.975), 9.75, 1e-12);
  assert.equal(quantile([], 0.5), null);

  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 5; i += 1) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }

  // 모든 단지쌍이 같으면 구간은 점 하나로 닫힌다.
  const pair = (jeonse10k) => ({ district: "노원구", dong: "하계동", apt: "a", band: "60to85", jeonse10k, deposit10k: 15_000, monthly10k: 130 });
  const flat = bootstrapYoy({
    basePairs: Array.from({ length: 5 }, () => pair(55_000)),
    pairs: Array.from({ length: 5 }, () => pair(64_000)),
    baseRates: { loanRate: 3.98, depositRate: 2.48 },
    rates: { loanRate: 4.23, depositRate: 3.14 },
    key: "flat",
    iterations: 50,
  });
  assert.equal(flat.jeonse[0], flat.jeonse[1]);
  near(flat.jeonse[0], 26.4);

  // 픽스처에서 구간은 점 추정을 품고, 아래 끝 ≤ 위 끝이다.
  for (const p of run().seoul.points) {
    for (const side of ["jeonse", "wolse"]) {
      const [lo, hi] = p[side].ci;
      assert.ok(lo <= p[side].yoy && p[side].yoy <= hi, `${p.month} ${side} ${lo}~${hi} 가 ${p[side].yoy} 를 품지 않는다`);
    }
  }
  const out = run();
  assert.deepEqual(out.seoul.interval, { method: "bootstrap-percentile", resample: "complex-band pair", iterations: ITER, seed: 587, level: 0.95 });
});

test("칸 값은 docs 파일로 새지 않는다 - research 쪽에만, 10,000회·시드 587·폭 ≤29%p 일 때만 public(29~31%p 는 withheld)", () => {
  const out = run();
  const docs = JSON.stringify(out.seoul);
  assert.ok(!("cells" in out.seoul));
  for (const name of DISTRICTS) assert.ok(!docs.includes(name), `docs 파일에 ${name} 이 들어갔다`);
  assert.ok(!/60to85|under60|over85/.test(docs));

  const last = out.cells.points.at(-1);
  assert.equal(last.month, "202608");
  assert.equal(last.cells.length, 3, "자치구 셋 × 면적대 하나");
  assert.equal(out.cells.publicWidth, PUBLIC_WIDTH);
  assert.equal(PUBLIC_WIDTH, 29);
  assert.equal(WITHHELD_WIDTH, 31);
  assert.equal(PUBLIC_ITERATIONS, 10_000);
  for (const c of last.cells) {
    assert.equal(c.public, false, `${ITER}회로는 public 이 될 수 없다 (${c.district} 폭 ${c.width})`);
    assert.equal(c.withheld, c.width > PUBLIC_WIDTH && c.width <= WITHHELD_WIDTH);
    assert.equal(c.excludesZero, c.ci[0] > 0 || c.ci[1] < 0);
    assert.ok(c.pairs >= 3 && c.basePairs >= 3);
  }
});

test("칸 public 은 10,000회·시드 587 일 때 폭 ≤29%p 로 정해지고, 서울 한 줄은 칸 계산 여부와 무관하게 같은 바이트다", () => {
  const full = run({ cellIterations: PUBLIC_ITERATIONS });
  assert.equal(full.cells.interval.iterations, PUBLIC_ITERATIONS);
  for (const c of full.cells.points.at(-1).cells) assert.equal(c.public, c.width <= PUBLIC_WIDTH, `${c.district} 폭 ${c.width}`);
  const otherSeed = run({ cellIterations: PUBLIC_ITERATIONS, seed: 588 });
  assert.ok(otherSeed.cells.points.every((p) => p.cells.every((c) => c.public === false)), "시드 587 이 아니면 public 이 아니다");
  const seoulOnly = run({ withCells: false });
  assert.equal(seoulOnly.cells, null);
  assert.equal(JSON.stringify(seoulOnly.seoul), JSON.stringify(full.seoul));
});

test("ratesAt 은 그 달 두 값이 다 있을 때만 준다", () => {
  const s = { jeonse_loan_rate: [["202608", 4.23]], deposit_rate: [["202608", "3.14"], ["202607", 3.15]] };
  assert.deepEqual(ratesAt(s, "202608"), { loanRate: 4.23, depositRate: 3.14 });
  assert.equal(ratesAt(s, "202607"), null);
  assert.equal(ratesAt({ jeonse_loan_rate: [["202608", -1]], deposit_rate: [["202608", 3]] }, "202608"), null);
  assert.equal(ratesAt(undefined, "202608"), null);
});
