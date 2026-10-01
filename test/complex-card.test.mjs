import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MIN_DEALS_PER_SIDE, cellRatios } from "../scripts/complex-ratio.mjs";
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
  const { DISTRICT_SLUGS } = await import("../scripts/district-slugs.mjs");

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
