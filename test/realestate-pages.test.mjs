import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BASE_AREA_PYEONG,
  areaPrice,
  formatEok,
  jeonseRatio,
  metricOf,
  normalizeArea,
} from "../scripts/realestate-format.ts";
import {
  realestateHeadHtml,
  realestateOverallHtml,
  realestateTableHtml,
} from "../scripts/prerender.ts";
import {
  REALESTATE_PAGES,
  buildDistrictPage,
  buildRealestatePage,
} from "../scripts/build-realestate-pages.ts";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "../scripts/district-slugs.ts";
import { districtSentences } from "../scripts/district-summary.ts";
import { stampHtml } from "../scripts/updated-stamp.ts";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { readFixture } from "./helpers/fixture-data.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

const cells = (html) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim());
const names = (html) => [...html.matchAll(/<tr[^>]*><td>([^<]*)</g)].map((m) => m[1]);
const headCells = (html) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);

const district = (name, extra = {}) => ({
  name,
  sale: { avgPricePerPyeong10k: 4000, transactionCount: 10, change: null },
  jeonse: { avgDepositPerPyeong10k: 2000, transactionCount: 20 },
  wolse: { avgDeposit10k: 20000, avgMonthlyRent10k: 90, transactionCount: 30 },
  ...extra,
});

const metrics = (offset = 0) => ({
  sale: { avgPricePerPyeong10k: 4400 + offset, transactionCount: 50 },
  saleNational84: { avgPricePerPyeong10k: 4100 + offset, transactionCount: 30 },
  jeonse: { avgDepositPerPyeong10k: 2500 + offset, transactionCount: 40 },
  wolse: { avgDeposit10k: 22000 + offset, avgMonthlyRent10k: 96, transactionCount: 35 },
});

const TREND_DISTRICT = { code: "11680", name: "강남구" };

const trendRealestate = () => ({
  period: "202608",
  updatedAt: "2026-08-15T00:00:00.000Z",
  overall: metrics(),
  districts: [{ ...TREND_DISTRICT, ...metrics(500) }, { code: "11350", name: "노원구", ...metrics(-500) }],
});

const TREND_WEEKS = ["2026-07-27", "2026-08-03", "2026-08-10"];

const PENDING_WEEKS = ["2026-08-17", "2026-08-24"];

const pendingTrendData = () => {
  const trend = trendData();
  trend.pendingWeeks = PENDING_WEEKS;
  trend.overall["2026-08-17"] = metrics(-300);
  trend.overall["2026-08-24"] = metrics(-600);
  trend.districts[TREND_DISTRICT.name]["2026-08-17"] = metrics(200);
  trend.districts[TREND_DISTRICT.name]["2026-08-24"] = metrics(100);
  return trend;
};

const trendData = () => ({
  weeks: TREND_WEEKS,
  overall: {
    "2026-07-27": metrics(-40),
    "2026-08-03": metrics(-20),
    "2026-08-10": metrics(),
  },
  districts: {
    [TREND_DISTRICT.name]: {
      "2026-07-27": metrics(460),
      "2026-08-03": metrics(480),
      "2026-08-10": metrics(500),
    },
  },
});

test("84㎡ 환산이 손계산과 같다", () => {
  assert.equal(BASE_AREA_PYEONG.toFixed(3), "25.410");
  assert.equal(areaPrice(4449), Math.round(4449 * BASE_AREA_PYEONG));
  assert.equal(formatEok(areaPrice(4449)), "11억 3,049만원");
  assert.equal(formatEok(30000), "3억원");
  assert.equal(formatEok(5000), "5,000만원");
  assert.equal(areaPrice(null), null);
  assert.equal(formatEok(null), "-");
});

test("신고 건수가 5건 미만이면 값을 내지 않는다", () => {
  const thin = district("노원구", {
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
  });
  assert.equal(metricOf(thin, "sale"), null);

  const html = realestateTableHtml({ districts: [thin] }, "sale");
  assert.ok(html.includes("신고 2건"), "표본 부족 표시가 없다");
  assert.ok(!html.includes("9,999"), "가려야 할 평당가가 그대로 나왔다");
});

test("거래 유형마다 열 구성이 다르다", () => {
  assert.deepEqual(headCells(realestateHeadHtml("sale")), ["지역", "평당가", "84㎡ 환산", "거래건수"]);
  assert.deepEqual(headCells(realestateHeadHtml("jeonse")), ["지역", "평당 보증금", "84㎡ 환산", "전세가율", "거래건수"]);
  assert.deepEqual(headCells(realestateHeadHtml("wolse")), ["지역", "평균 보증금", "평균 월세", "거래건수"]);
  assert.deepEqual(headCells(realestateHeadHtml()), ["지역", "매매 평당가", "전세 평당 보증금", "월세 보증금 / 월세"]);
});

test("월세 표에는 84㎡ 환산이 들어가지 않는다", () => {
  const html = realestateTableHtml({ districts: [district("강남구")] }, "wolse");
  assert.ok(html.includes("월 90만원"), "월세 금액이 없다");
  // 보증금은 1억이 넘으면 "2억원" 꼴이라(#46) "억" 글자로는 못 가른다 - 환산 열이 없는지를 본다.
  assert.ok(!html.includes("84㎡ 환산"), "월세인데 84㎡ 환산가가 붙었다");
  assert.equal(cells(html).length, 4, "월세 행은 구·보증금·월세·건수 넷이다");
});

test("월세 증감은 하나, 보증금과 월세를 묶은 ㎡당 값의 % 로 월세 칸에 붙는다 (#6)", () => {
  const wolse = { avgDeposit10k: 20000, avgMonthlyRent10k: 90, transactionCount: 30, change: { value10k: 60, percent: 2.04 }, baselineDate: "2026-09-24" };
  const html = realestateTableHtml({ districts: [district("강남구", { wolse })] }, "wolse");
  const [, deposit, monthly] = cells(html);
  assert.doesNotMatch(deposit, /change/, "보증금 칸에 증감이 붙었다");
  assert.match(monthly, /class="change up"[^>]*>▲2\.0%</);
  assert.match(monthly, /2026-09-24 대비 · 보증금과 월세를 묶은 ㎡당 값/);
});

test("비싼 지역이 위로 오고, 값을 못 내는 지역은 맨 아래로 간다", () => {
  const data = {
    districts: [
      district("싼구", { sale: { avgPricePerPyeong10k: 3000, transactionCount: 10 } }),
      district("표본부족구", { sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 } }),
      district("비싼구", { sale: { avgPricePerPyeong10k: 8000, transactionCount: 10 } }),
    ],
  };
  assert.deepEqual(names(realestateTableHtml(data, "sale")), ["비싼구", "싼구", "표본부족구"]);
});

test("서울 전체가 표 맨 위에 온다", async () => {
  const realestate = await readJson("realestate");
  const html = realestateTableHtml(realestate, "sale");
  assert.equal(names(html)[0], "서울 전체");
  assert.ok(html.startsWith('<tr class="overall-row">'));
});

test("정적 HTML의 표가 실제 화면과 같다", async () => {
  const realestate = await readJson("realestate");

  for (const kind of [null, "sale", "jeonse", "wolse"]) {
    const page = await loadRealestatePage({ realestate, kind });
    assert.deepEqual(
      cells(page.tableHtml()),
      cells(realestateTableHtml(realestate, kind)),
      `${kind ?? "전체"} 표가 프리렌더와 다르다`
    );
    assert.equal(page.headHtml(), realestateHeadHtml(kind), `${kind ?? "전체"} 머리글이 다르다`);
    assert.equal(
      page.overallHtml(),
      realestateOverallHtml(realestate, kind),
      `${kind ?? "전체"} 요약 카드가 다르다`
    );
  }
});

// (#507) "커밋된 거래 유형별 페이지가 지금 원본·데이터로 찍은 결과와 같다" 는 커밋된 데이터와 커밋된 생성물을 맞대는 검사라 tools/health/test/realestate-pages.test.mjs 로 옮겼다(비차단). 같은 단언의 고정 데이터 짝은 test/fixture-site.test.mjs 에 있다.

test("생성된 페이지는 화면을 그린 뒤에도 자기 제목을 유지한다", async () => {
  const realestate = await readJson("realestate");
  const html = await read(`${SITE}/apartment-sale.html`);
  const baked = /<title>([^<]*)<\/title>/.exec(html)[1];
  const { sandbox } = await loadRealestatePage({ realestate, file: `${SITE}/apartment-sale.html`, kind: "sale", title: baked });
  assert.equal(sandbox.document.title, baked);
  assert.match(sandbox.document.title, /매매/);
  assert.ok(!sandbox.document.title.includes("전세"), sandbox.document.title);
});

test("영어 화면은 억 단위 대신 백만원 단위로 적는다", async () => {
  const realestate = await readJson("realestate");
  const { overallHtml } = await loadRealestatePage({ realestate, kind: "sale", locale: "en" });
  const html = overallHtml();
  assert.ok(html.includes("For 84m²"), "영어 라벨이 없다");
  assert.ok(/₩[\d,]+M/.test(html), `영어 금액 표기가 없다: ${html.slice(0, 200)}`);
  assert.ok(!html.includes("억"), "영어 화면에 억 표기가 남았다");
});

const thinWithPrev = (name) => ({
  name,
  sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
  jeonse: { avgDepositPerPyeong10k: 2000, transactionCount: 20 },
  wolse: null,
  prev: {
    sale: { avgPricePerPyeong10k: 4000, transactionCount: 40 },
    jeonse: { avgDepositPerPyeong10k: 1900, transactionCount: 60 },
  },
});

test("이번 달 표본이 충분하면 지난달 값을 쓰지 않는다", () => {
  const entry = { ...thinWithPrev("강남구"), sale: { avgPricePerPyeong10k: 8000, transactionCount: 30 } };
  const html = realestateTableHtml({ previousPeriod: "202607", districts: [entry] }, "sale");
  assert.ok(html.includes("8,000만원"));
  assert.ok(!html.includes("prev-tag"), "이번 달 값인데 지난달 표시가 붙었다");
});

test("지난달로 대체한 셀에는 증감을 붙이지 않는다", () => {
  const entry = thinWithPrev("도봉구");
  entry.prev.sale.change = { value10k: 500 };
  entry.prev.sale.baselineDate = "2026-07-10";
  const html = realestateTableHtml({ previousPeriod: "202607", districts: [entry] }, "sale");
  assert.ok(!html.includes("change up"), "대체된 셀에 증감이 붙었다");
});

test("지난달 값도 없으면 표본 부족으로 남긴다", () => {
  const entry = { name: "종로구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 }, prev: {} };
  const html = realestateTableHtml({ previousPeriod: "202607", districts: [entry] }, "sale");
  assert.ok(html.includes("신고 1건"));
  assert.ok(!html.includes("9,999"));
});

test("전세가율은 전세를 매매로 나눈 값이다", () => {
  const entry = district("강남구", {
    sale: { avgPricePerPyeong10k: 10000, transactionCount: 10 },
    jeonse: { avgDepositPerPyeong10k: 4000, transactionCount: 20 },
  });
  assert.equal(jeonseRatio(entry).ratio.toFixed(1), "40.0");
  assert.ok(realestateTableHtml({ districts: [entry] }, "jeonse").includes("40.0%"));
});

test("한쪽 표본이 모자라면 전세가율을 내지 않는다", () => {
  const entry = district("종로구", {
    sale: { avgPricePerPyeong10k: 13358, transactionCount: 2 },
  });
  assert.equal(jeonseRatio(entry), null);
  const html = realestateTableHtml({ districts: [entry] }, "jeonse");
  assert.ok(html.includes("<td data-label=\"전세가율\">-</td>"), "표본이 모자란데 비율이 나왔다");
});

test("기준 달이 서로 다르면 전세가율을 내지 않는다", () => {
  const entry = {
    name: "노원구",
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
    jeonse: { avgDepositPerPyeong10k: 1900, transactionCount: 60 },
    prev: { sale: { avgPricePerPyeong10k: 4000, transactionCount: 40 } },
  };
  assert.equal(jeonseRatio(entry), null);
});

test("매매·월세 페이지에는 전세가율이 없다", () => {
  assert.ok(!realestateHeadHtml("sale").includes("전세가율"));
  assert.ok(!realestateHeadHtml("wolse").includes("전세가율"));
});

test("평형을 바꾸면 환산가와 열 제목이 같이 바뀐다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale" });

  const before = cells(page.tableHtml());
  assert.ok(page.headHtml().includes("84㎡ 환산"));

  const select = page.byId("area-select");
  select.value = "59";
  page.byId("area-controls").dispatch("change", { target: select });

  const after = cells(page.tableHtml());
  assert.ok(page.headHtml().includes("59㎡ 환산"), `열 제목이 안 바뀌었다: ${page.headHtml()}`);
  assert.notDeepEqual(after, before, "평형을 바꿨는데 표가 그대로다");
  assert.ok(page.sandbox.location.search.includes("area=59"), page.sandbox.location.search);
});

test("기본 평형은 주소에 남기지 않는다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale" });
  const select = page.byId("area-select");

  select.value = "59";
  page.byId("area-controls").dispatch("change", { target: select });
  select.value = "84";
  page.byId("area-controls").dispatch("change", { target: select });

  assert.ok(!page.sandbox.location.search.includes("area="), page.sandbox.location.search);
});

test("지원하지 않는 평형은 기본값으로 돌린다", () => {
  assert.equal(normalizeArea("999"), 84);
  assert.equal(normalizeArea(null), 84);
  assert.equal(normalizeArea("59"), 59);
});

test("환산가가 없는 화면에는 평형 선택을 띄우지 않는다", async () => {
  const realestate = await readJson("realestate");
  for (const kind of ["wolse", null]) {
    const page = await loadRealestatePage({ realestate, kind });
    assert.equal(page.byId("area-controls").hidden, true, `${kind ?? "허브"}에 평형 선택이 떴다`);
  }
  const sale = await loadRealestatePage({ realestate, kind: "sale" });
  assert.equal(sale.byId("area-controls").hidden, false);
});

test("주소로 들어온 평형으로 시작한다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale", search: "?area=114" });
  assert.ok(page.headHtml().includes("114㎡ 환산"), page.headHtml());
});

test("거래 유형마다 자기 지표의 추이를 그린다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  for (const kind of ["sale", "jeonse", "wolse"]) {
    const page = await loadRealestatePage({ realestate, trend, kind });
    assert.ok(page.trendHtml().includes("polyline"), `${kind}: 그래프가 없다`);
    assert.equal(page.byId("trend-section").hidden, false);
  }
});

test("추이는 주 단위로 적는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.match(page.trendMeta(), /2026-07-27 ~ 2026-08-10/);
  assert.match(page.trendMeta(), /3주/, page.trendMeta());
});

test("값이 없는 주는 추이에서 뺀다", async () => {
  const realestate = await readJson("realestate");
  const trend = {
    weeks: ["2026-07-27", "2026-08-03", "2026-08-10"],
    overall: {
      "2026-08-03": { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } },
      "2026-08-10": { sale: { avgPricePerPyeong10k: 4100, transactionCount: 60 } },
    },
    districts: {},
  };
  const page = await loadRealestatePage({ realestate, trend, kind: "sale" });

  assert.match(page.trendMeta(), /2026-08-03 ~ 2026-08-10/, `값 없는 주가 남았다: ${page.trendMeta()}`);
  assert.match(page.trendMeta(), /2주/);
});

test("한 주뿐이면 빈 그래프 대신 이유를 적는다", async () => {
  const realestate = await readJson("realestate");
  const trend = {
    weeks: ["2026-08-10"],
    overall: { "2026-08-10": { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } } },
    districts: {},
  };
  const page = await loadRealestatePage({ realestate, trend, kind: "sale" });

  assert.equal(page.trendHtml(), "");
  assert.match(page.trendMeta(), /두 주 이상/);
});

test("추이를 못 받아도 표는 그대로 나온다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale" });
  assert.ok(cells(page.tableHtml()).length > 0, "추이가 없다고 표까지 비었다");
});

test("자치구 페이지는 한 지역의 세 유형을 행으로 보여준다", async () => {
  const realestate = await readJson("realestate");
  const baked = /<title>([^<]*)<\/title>/.exec(await read(`${SITE}/district-gangnam.html`))[1];
  const page = await loadRealestatePage({ realestate, file: `${SITE}/district-gangnam.html`, district: "강남구", title: baked });

  assert.deepEqual(headCells(page.headHtml()), ["구분", "평당가", "84㎡ 환산", "거래건수"]);
  assert.deepEqual(names(page.tableHtml()), ["매매", "전세", "월세"]);
  assert.match(page.sandbox.document.title, /강남구/);
});

test("자치구 페이지의 월세 행에는 환산가가 없다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });
  const rows = page.tableHtml().split("</tr>");
  const wolseRow = rows.find((r) => r.includes(">월세<"));
  assert.ok(wolseRow.includes('data-label="84㎡ 환산">-<'), `월세 행: ${wolseRow}`);
});

test("자치구 페이지 추이는 그 지역 값을 그린다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  const seoul = await loadRealestatePage({ realestate, trend, kind: "sale" });
  const page = await loadRealestatePage({ realestate, trend, district: TREND_DISTRICT.name });
  assert.notEqual(page.trendHtml(), seoul.trendHtml(), "서울 전체 추이를 그대로 쓰고 있다");

  const now = realestate.districts.find((d) => d.name === TREND_DISTRICT.name).sale.avgPricePerPyeong10k;
  assert.match(page.cardCurrent("trend"), new RegExp(`${now.toLocaleString("ko-KR")}만원`));
});

test("자치구 페이지에는 평형 선택이 뜬다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });
  assert.equal(page.byId("area-controls").hidden, false);
});

// (#507) "커밋된 자치구 페이지 25개가 지금 원본·데이터로 찍은 결과와 같다" 는 커밋된 데이터와 커밋된 생성물을 맞대는 검사라 tools/health/test/realestate-pages.test.mjs 로 옮겼다(비차단). 같은 단언의 고정 데이터 짝은 test/fixture-site.test.mjs 에 있다.

test("모든 시세 페이지가 25개 자치구로 링크한다", async () => {
  for (const file of ["realestate.html", "apartment-sale.html", "district-gangnam.html"]) {
    const html = await read(`${SITE}/${file}`);
    for (const { file: target } of DISTRICT_PAGES) {
      assert.ok(html.includes(`href="./${target}"`), `${file}: ${target} 링크가 없다`);
    }
  }
});

test("표가 있는 페이지에는 하단 지역 목록을 두지 않는다", async () => {
  const block = async (file) =>
    (await read(`${SITE}/${file}`)).split("<!--prerender:districtLinks-->")[1]?.split("<!--/prerender")[0] ?? "";

  for (const file of ["realestate.html", "apartment-sale.html", "apartment-jeonse.html"]) {
    assert.equal(await block(file), "", `${file}: 하단 목록이 남아 있다`);
  }

  assert.equal((await block("district-gangnam.html")).match(/<a /g)?.length, 25);
});

test("표의 지역 이름이 그 지역 페이지로 간다", async () => {
  const html = await read(`${SITE}/realestate.html`);
  assert.match(html, /<td><a href="\.\/district-gangnam\.html">강남구<\/a>/);
  assert.match(html, /<tr class="overall-row"><td>서울 전체<\/td>/);
});

test("자치구 페이지는 자기 지역을 링크 목록에서 표시한다", async () => {
  const html = await read(`${SITE}/district-songpa.html`);
  const block = html.split("<!--prerender:districtLinks-->")[1].split("<!--/prerender")[0];
  assert.ok(block.includes('<a href="./district-songpa.html" aria-current="page">송파구</a>'));
});

// (#520) 표본이 충분한 구가 둘 미만이면 `t.diagnostic` 만 남기고 `return` 해서 순위 문장 단언이 안 돌았다(그날 데이터가 한쪽 갈래로 굳으면 조용히 통과).
// 고정 데이터(test/fixtures/site/data/realestate.json)로 돌리고, 둘 미만이면 건너뛰지 않고 실패로 만든다.
test("지역마다 다른 문장이 나온다", async () => {
  const realestate = await readFixture("realestate");
  const of = (entry) => districtSentences(entry, realestate).join(" ");

  const priced = realestate.districts
    .filter((d) => typeof d.sale?.avgPricePerPyeong10k === "number" && d.sale.transactionCount >= 5)
    .sort((a, b) => b.sale.avgPricePerPyeong10k - a.sale.avgPricePerPyeong10k);

  assert.ok(priced.length >= 2, `표본이 충분한 구가 ${priced.length}개뿐이라 순위 문장 검사가 아무것도 안 본다`);

  const top = of(priced[0]);
  const bottom = of(priced[priced.length - 1]);

  assert.notEqual(top, bottom);
  assert.match(top, /가장 높습니다/);
  assert.match(bottom, /가장 낮습니다/);
  assert.ok(!top.includes(priced[priced.length - 1].name) || !bottom.includes(priced[0].name));
});

test("서울 평균 대비 배수와 순위가 맞다", () => {
  const realestate = {
    overall: { sale: { avgPricePerPyeong10k: 4000, transactionCount: 500 } },
    districts: [
      district("비싼구", { sale: { avgPricePerPyeong10k: 8000, transactionCount: 10 } }),
      district("보통구", { sale: { avgPricePerPyeong10k: 4000, transactionCount: 10 } }),
      district("싼구", { sale: { avgPricePerPyeong10k: 2000, transactionCount: 10 } }),
    ],
  };
  const text = districtSentences(realestate.districts[0], realestate).join(" ");
  assert.match(text, /2배/);
  assert.match(text, /3개 구 가운데 가장 높습니다/);

  const same = districtSentences(realestate.districts[1], realestate).join(" ");
  assert.match(same, /같은 수준/, `1.0배는 '같다'로 써야 한다: ${same}`);
});

test("표본이 모자라면 지어내지 않고 그 사실을 쓴다", () => {
  const thin = {
    name: "종로구",
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
    jeonse: { avgDepositPerPyeong10k: 3478, transactionCount: 11 },
    wolse: { avgDeposit10k: 27349, avgMonthlyRent10k: 110, transactionCount: 18 },
  };
  const realestate = {
    period: "202608",
    overall: {
      sale: { avgPricePerPyeong10k: 4449, transactionCount: 575 },
      jeonse: { avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
      wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
    },
    districts: [thin],
  };
  const text = districtSentences(thin, realestate).join(" ");

  assert.match(text, /신고가 2건뿐이라 평균을 내지 않았습니다/);
  assert.ok(!text.includes("배입니다"), `평균을 못 내는데 배수를 썼다: ${text}`);
  assert.match(text, /전세는 평당 보증금/);
});

test("조사를 받침에 맞춰 고른다", () => {
  const thin = (name) => ({ name, sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 } });
  assert.match(districtSentences(thin("종로구"), {}).join(" "), /종로구는/);
  assert.match(districtSentences(thin("서울시"), {}).join(" "), /서울시는/);
  assert.match(districtSentences(thin("한남동"), {}).join(" "), /한남동은/);
});

test("정적 HTML에 한국어·영어 문단이 모두 심긴다", async () => {
  const html = await read(`${SITE}/district-songpa.html`);
  const ko = html.split("<!--prerender:districtSummaryKo-->")[1].split("<!--/prerender")[0];
  const en = html.split("<!--prerender:districtSummaryEn-->")[1].split("<!--/prerender")[0];

  assert.ok(ko.includes("송파구"), `한국어 문단이 비었거나 다른 지역이다: ${ko.slice(0, 80)}`);
  assert.ok(en.includes("송파구"), `영어 문단이 비었거나 다른 지역이다: ${en.slice(0, 80)}`);
  assert.match(ko, /니다\./, "한국어 문단이 문장으로 안 끝난다");
  assert.match(en, /[a-z]{4,}/, "영어 문단에 영어가 없다");
  assert.ok(!/니다\./.test(en), `영어 문단에 한국어 문장이 남았다: ${en.slice(0, 80)}`);
});

test("자치구가 아닌 페이지에는 서술이 없다", async () => {
  for (const file of ["realestate.html", "apartment-sale.html"]) {
    const html = await read(`${SITE}/${file}`);
    const ko = html.split("<!--prerender:districtSummaryKo-->")[1].split("<!--/prerender")[0];
    assert.equal(ko, "", `${file}에 서술이 들어갔다`);
  }
});

test("추이가 어느 날짜 기준인지 밝힌다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const meta = page.trendMeta();

  assert.match(meta, /계약일 기준/, meta);
  assert.match(meta, /신고 기한/, meta);
  assert.ok(!meta.includes("현재 "), `마지막 주 값을 현재 시세처럼 적었다: ${meta}`);
});

test("추이가 어느 지표인지 라벨로 밝힌다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  const expected = {
    sale: "매매 평당가",
    jeonse: "전세 평당 보증금",
    wolse: "월세 보증금(평당 아님)",
  };

  for (const [kind, label] of Object.entries(expected)) {
    const page = await loadRealestatePage({ realestate, trend, kind });
    assert.match(page.cardLabel("trend"), new RegExp(label.replace(/[()]/g, "\\$&")), `${kind}: ${page.cardLabel("trend")}`);
  }
});

test("거래량 추이를 함께 그린다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.ok(page.volumeHtml().includes("polyline"), "거래량 그래프가 없다");
  assert.match(page.cardLabel("volume"), /매매 거래량/, page.cardLabel("volume"));
  assert.match(page.cardCurrent("volume"), /50건/, page.cardCurrent("volume"));
  assert.match(page.cardMinMax("volume"), /최고 .*건 · 최저 .*건/, page.cardMinMax("volume"));
  assert.equal(page.cardHidden("volume-card"), false);
});

test("거래 유형을 바꾸면 거래량도 그 유형을 센다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  const jeonse = await loadRealestatePage({ realestate, trend, kind: "jeonse" });
  assert.match(jeonse.cardLabel("volume"), /전세 거래량/);
  assert.match(jeonse.cardCurrent("volume"), /40건/, jeonse.cardCurrent("volume"));

  const wolse = await loadRealestatePage({ realestate, trend, kind: "wolse" });
  assert.match(wolse.cardLabel("volume"), /월세 거래량/);
});

test("전세가율 추이를 그린다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.ok(page.ratioHtml().includes("polyline"), "전세가율 그래프가 없다");
  assert.match(page.cardLabel("ratio"), /전세가율/, page.cardLabel("ratio"));
  assert.match(page.cardCurrent("ratio"), /56\.8%/, `2500/4400 = 56.8%가 아니다: ${page.cardCurrent("ratio")}`);
});

test("월세 페이지에는 전세가율을 두지 않는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "wolse" });
  assert.equal(page.cardHidden("ratio-card"), true, "월세와 상관없는 지표가 남았다");
});

test("매매나 전세 값이 없는 주는 전세가율에서 뺀다", async () => {
  const realestate = await readJson("realestate");
  const trend = {
    weeks: ["2026-07-27", "2026-08-03", "2026-08-10"],
    overall: {
      "2026-07-27": { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } },
      "2026-08-03": {
        sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 },
        jeonse: { avgDepositPerPyeong10k: 2400, transactionCount: 40 },
      },
      "2026-08-10": {
        sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 },
        jeonse: { avgDepositPerPyeong10k: 2000, transactionCount: 40 },
      },
    },
    districts: {},
  };
  const page = await loadRealestatePage({ realestate, trend, kind: "sale" });

  const weeks = [...page.ratioHtml().matchAll(/class="axis x[^"]*">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(weeks, ["8/3", "8/10"], `값 없는 주가 남았다: ${weeks.join(" ")}`);
  assert.match(page.cardCurrent("ratio"), /50\.0%/);
});

test("신고가 덜 찬 주는 점선으로 이어 그린다", async () => {
  const page = await loadRealestatePage({
    realestate: trendRealestate(),
    trend: pendingTrendData(),
    kind: "sale",
  });
  const svg = page.trendHtml();

  const lines = [...svg.matchAll(/<polyline([^>]*)>/g)].map((m) => m[1]);
  assert.equal(lines.length, 2, `실선과 점선 두 줄이어야 한다: ${lines.length}줄`);
  assert.ok(!lines[0].includes("stroke-dasharray"), "확정 구간까지 점선으로 그렸다");
  assert.match(lines[1], /class="[^"]*\bpending\b/, "잠정 구간에 표시가 없다");
  assert.match(lines[1], /stroke-dasharray/, "잠정 구간이 실선이다");

  const weeks = [...svg.matchAll(/class="axis x[^"]*">([^<]+)</g)].map((m) => m[1]);
  assert.equal(weeks.at(-1), "8/24", `잠정 주까지 가로축에 담기지 않았다: ${weeks.join(" ")}`);
});

test("점선은 마지막 확정 지점에서 이어 나간다", async () => {
  const page = await loadRealestatePage({
    realestate: trendRealestate(),
    trend: pendingTrendData(),
    kind: "sale",
  });
  const [firm, pending] = [...page.trendHtml().matchAll(/points="([^"]+)"/g)].map((m) => m[1].split(" "));

  assert.equal(firm.length, TREND_WEEKS.length, "확정 구간 지점 수가 다르다");
  assert.equal(pending.length, PENDING_WEEKS.length + 1, "점선이 이어 붙지 않고 떨어져 있다");
  assert.equal(pending[0], firm.at(-1), "점선이 마지막 확정 지점에서 시작하지 않는다");
});

test("잠정 주는 카드에 적는 숫자로 세지 않는다", async () => {
  const firm = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const withPending = await loadRealestatePage({
    realestate: trendRealestate(),
    trend: pendingTrendData(),
    kind: "sale",
  });

  assert.equal(withPending.cardCurrent("trend"), firm.cardCurrent("trend"), "덜 찬 주를 현재값으로 적었다");
  assert.equal(withPending.cardMinMax("trend"), firm.cardMinMax("trend"), "덜 찬 주가 최고·최저에 섞였다");
  assert.match(withPending.trendMeta(), /2026-07-27 ~ 2026-08-10/, "잠정 주까지 기간에 넣었다");
  assert.match(withPending.trendMeta(), /점선/, "점선이 무엇인지 밝히지 않았다");
});

test("잠정 주가 없으면 점선도 안내도 없다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.ok(!page.trendHtml().includes("stroke-dasharray"), "그릴 잠정 주가 없는데 점선을 그었다");
  assert.ok(!page.trendMeta().includes("점선"), "점선이 없는데 점선을 설명한다");
});

test("표본이 모자란 지역은 값을 비운다", () => {
  const html = realestateTableHtml({ districts: [thinWithPrev("노원구")] }, "sale");

  assert.ok(!html.includes("9999"), `표본 한 건짜리 평균이 표에 남았다: ${html}`);
  assert.ok(!html.includes("지난달"), "지난달로 대체하는 표시가 남았다");
});

test("추이 그래프에 양 축 눈금을 적는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const svg = page.trendHtml();

  const yLabels = [...svg.matchAll(/class="axis y[^"]*">([^<]+)</g)].map((m) => m[1]);
  const xLabels = [...svg.matchAll(/class="axis x[^"]*">([^<]+)</g)].map((m) => m[1]);

  assert.equal(yLabels.length, 3, `세로 눈금이 없다: ${svg}`);
  assert.ok(yLabels[0].includes("만원"), `세로 눈금에 단위가 없다: ${yLabels[0]}`);
  assert.deepEqual(xLabels, ["7/27", "8/3", "8/10"], "가로 눈금이 주 날짜가 아니다");
  assert.ok(!svg.includes('preserveAspectRatio="none"'), "가로로 늘어나 글자가 찌그러진다");
});

// 1년 그림(합성 60주 = 확정 56 + 잠정 4, 2025-08-25 ~ 2026-10-12). 확정 주 수가 보관 상한(52)을 넘어도 화면은 받은 대로 다 그린다 -
// 자르는 것은 buildWeekly 의 몫이다. 해가 바뀌므로 첫 눈금과 해가 바뀐 가운데 눈금에 두 자리 해가 붙고, 끝 눈금은 가운데와 같은 해라 안 붙는다.
const YEAR_WEEKS = Array.from({ length: 60 }, (_, i) => new Date(Date.parse("2025-08-25T00:00:00Z") + i * 7 * 86_400_000).toISOString().slice(0, 10));
const yearTrend = () => ({
  weeks: YEAR_WEEKS.slice(0, 56),
  pendingWeeks: YEAR_WEEKS.slice(56),
  overall: Object.fromEntries(YEAR_WEEKS.map((week, i) => [week, metrics(i * 5)])),
  districts: { [TREND_DISTRICT.name]: Object.fromEntries(YEAR_WEEKS.map((week, i) => [week, metrics(400 + i * 5)])) },
});

for (const locale of ["ko", "en"]) {
  test(`1년 추이는 60주를 다 그리고 첫·끝 눈금을 해로 가른다 (${locale})`, async () => {
    const page = await loadRealestatePage({ realestate: trendRealestate(), trend: yearTrend(), kind: "sale", locale, file: `${SITE}/realestate.html` });
    const svg = page.trendHtml();

    const [firm, pending] = [...svg.matchAll(/points="([^"]+)"/g)].map((m) => m[1].split(" "));
    assert.equal(firm.length, 56, "확정 구간을 다 그리지 않았다");
    assert.equal(pending.length, 5, "잠정 구간이 마지막 확정 지점에서 이어지지 않는다");

    const xLabels = [...svg.matchAll(/class="axis x[^"]*">([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(xLabels, ["'25 8/25", "'26 3/16", "10/12"], `해 표시가 없거나 어긋났다: ${xLabels.join(" | ")}`);
  });
}

test("눈금 위아래로 값의 범위를 담는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const yLabels = [...page.trendHtml().matchAll(/class="axis y[^"]*">([^<]+)</g)].map((m) => m[1]);

  const nums = yLabels.map((s) => Number(s.replace(/[^\d]/g, "")));
  assert.ok(nums[0] > nums[2], `위쪽이 더 큰 값이어야 한다: ${yLabels.join(" / ")}`);
  assert.equal(nums[0], 4400, "최댓값이 눈금에 없다");
  assert.equal(nums[2], 4360, "최솟값이 눈금에 없다");
});

test("가로 위치에서 가장 가까운 지점을 고른다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const at = page.app.chartIndexAt;

  assert.equal(at(0, 3), 0, "왼쪽 끝이 첫 지점이 아니다");
  assert.equal(at(1, 3), 2, "오른쪽 끝이 마지막 지점이 아니다");
  assert.equal(at(0.5, 3), 1);
  assert.equal(at(-5, 3), 0, "그래프 밖을 벗어난 좌표를 가두지 못했다");
  assert.equal(at(9, 3), 2);
  assert.equal(at(0.5, 0), null);
});

// 전에는 "축 글자를 시세 표 글자와 같은 크기로 적는다"였다. 방향 C(#275 D1, #278 PR C)가 그 결정을
// 바꿨다 - 축척이 13px과 15px 둘로 갈리면서 **축은 라벨**(13px)이고 **표 칸은 문장**(15px)이다
// (po 기준 5: "13px은 문장이 아닌 라벨에만 쓴다 - 표 머리글·축·꼬리표·브랜드 줄·좁은 폭의 내비").
// 같게 두면 축의 숫자가 표 칸과 같은 무게로 읽혀 그래프가 표처럼 보인다. 바뀐 것은 어느 단을
// 가리키느냐이지 "축척 안에서 고른다"는 규칙이 아니라, 둘 다 축척 안에 있는 것을 여기서 센다.
test("축은 라벨 단이고 표 칸은 문장 단이다 (#278 PR C)", async () => {
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const table = css.match(/\.data-table \{[^}]*font-size: ([^;]+);/)?.[1];
  const axis = css.match(/\.history-card \.axis \{[^}]*font-size: ([^;]+);/)?.[1];
  const scale = Object.fromEntries(
    [...css.matchAll(/(--fs-[a-z0-9]+):\s*([\d.]+)rem;/g)].map((m) => [`var(${m[1]})`, Number(m[2])])
  );

  assert.ok(table, "시세 표 글자 크기를 읽지 못했다");
  assert.equal(axis, "var(--fs-xs)", "그래프 축이 라벨 단이 아니다");
  assert.equal(table, "var(--fs-sm)", "시세 표 칸이 문장 단이 아니다");
  // 두 단이 뒤집히면(축이 표보다 크면) 위 두 줄이 다 맞아도 화면은 틀린다.
  assert.ok(scale[axis] < scale[table], `축 ${scale[axis]}rem이 표 칸 ${scale[table]}rem보다 작지 않다`);
});

// 전에는 두 화면의 카드 CSS를 한 줄씩 맞대어 갈라졌는지 봤다. 스타일시트가 한 장이
// 된 지금 그 비교는 늘 참이라 아무것도 못 잡는다. 대신 갈라짐 자체를 막는다 -
// 페이지 안에 <style>이 다시 생기는 순간 예순두 갈래로 가는 길이 열린다.
test("페이지가 스타일을 따로 품지 않는다", async () => {
  const { readdir } = await import("node:fs/promises");
  const pages = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length >= 60, `HTML을 ${pages.length}장밖에 못 찾았다`);

  for (const page of pages) {
    const html = await readFile(path.join(root, SITE, page), "utf8");
    assert.ok(!html.includes("<style>"), `${SITE}/${page}에 <style>이 다시 생겼다`);
    assert.ok(html.includes('href="./style.css"'), `${SITE}/${page}이 스타일시트를 부르지 않는다`);
  }
});

test("시세 페이지 추이 카드가 첫 화면과 같은 짜임이다", async () => {
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  for (const selector of [
    ".history-grid",
    ".history-card",
    ".history-card .label",
    ".history-stats",
    ".history-current",
    ".history-minmax",
    ".history-card .axis",
  ]) {
    assert.ok(css.includes(`${selector} {`), `${selector} 규칙이 없다`);
  }

  const [realestate, index] = await Promise.all([
    readFile(path.join(root, `${SITE}/realestate.html`), "utf8"),
    readFile(path.join(root, `${SITE}/index.html`), "utf8"),
  ]);
  for (const [what, html] of [["시세", realestate], ["첫 화면", index]]) {
    assert.match(html, /class="history-card"/, `${what}: 카드 짜임이 다르다`);
    assert.match(html, /class="history-stats"/, `${what}: 값 줄이 없다`);
    assert.match(html, /class="history-chart"/, `${what}: 그래프 자리가 없다`);
  }
});

test("두 화면의 그래프가 같은 좌표계로 그려진다", async () => {
  const [realestate, index] = await Promise.all([
    readFile(path.join(root, `${SITE}/realestate.html`), "utf8"),
    readFile(path.join(root, `${SITE}/index.html`), "utf8"),
  ]);

  const chartConst = (html) => html.match(/const CHART = \{[^}]*\}/)?.[0].replace(/\s+/g, " ");
  assert.ok(chartConst(realestate), "시세 페이지 좌표계를 읽지 못했다");
  assert.equal(chartConst(realestate), chartConst(index), "두 화면의 그래프 크기 규칙이 갈라졌다");
});

test("그래프 좌표계를 그려질 자리의 픽셀과 1:1로 잡는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const box = page.app.chartBox(700, ["11,607만원", "9,983만원", "8,360만원"]);

  assert.equal(box.w, 700, "가로 좌표가 그려질 자리 너비와 어긋나면 글자가 확대된다");
  assert.equal(box.h, Math.round(700 * 0.7 * (132 / 320)), "예전 높이의 70%가 아니다");
  assert.ok(box.left >= page.app.axisTextWidth("11,607만원"), `세로 눈금 글자가 잘린다: ${box.left}`);
});

test("좁은 화면에서도 그래프가 납작해지지 않는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const box = page.app.chartBox(300, ["4,400만원"]);

  assert.ok(box.h >= 120, `높이가 너무 낮다: ${box.h}`);
  assert.ok(box.left < box.w * 0.45, `세로 눈금이 그림 자리를 다 먹었다: ${box.left}`);
});

test("거래량·전세가율 눈금에는 마지막 주 문구를 붙이지 않는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  for (const [what, svg] of [["거래량", page.volumeHtml()], ["전세가율", page.ratioHtml()]]) {
    const labels = [...svg.matchAll(/class="axis y[^"]*">([^<]+)</g)].map((m) => m[1]);
    assert.equal(labels.length, 3, `${what} 세로 눈금이 없다`);
    for (const label of labels) {
      assert.ok(!label.includes("마지막 주"), `${what} 눈금에 설명 문구가 들어가 잘린다: ${label}`);
    }
  }
  assert.match(page.cardCurrent("volume"), /^\d[\d,]*건$/, "카드 값에 설명 문구가 붙었다");
});

test("그래프에 마우스를 올릴 자리를 마련해 둔다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  assert.match(page.trendHtml(), /class="marker" hidden/, "짚어줄 표시가 없다");

  const html = await readFile(path.join(root, `${SITE}/realestate.html`), "utf8");
  assert.match(html, /<div class="chart-tip" id="chart-tip" hidden>/, "말풍선이 처음부터 떠 있다");
  assert.match(html, /trendSection\.addEventListener\("mousemove"/, "마우스를 따라가지 않는다");
  assert.match(html, /trendSection\.addEventListener\("touchstart"/, "손가락으로는 볼 수 없다");
});

test("월세 페이지(브라우저)도 증감 하나를 월세 칸에 % 로 붙인다 (#6)", async () => {
  const realestate = trendRealestate();
  for (const d of realestate.districts) {
    d.wolse = { ...d.wolse, change: { value10k: -45, percent: -1.53 }, baselineDate: "2026-08-08" };
  }
  for (const [locale, vs] of [["ko", /2026-08-08 대비 · 보증금과 월세를 묶은/], ["en", /vs 2026-08-08 · change in deposit and rent combined/]]) {
    const page = await loadRealestatePage({ realestate, trend: trendData(), kind: "wolse", locale });
    const html = page.tableHtml();
    assert.match(html, /class="change down"[^>]*>▼1\.5%</, `${locale}: 월세 증감 배지가 없다`);
    assert.match(html, vs);
    assert.equal((html.match(/class="change /g) ?? []).length, 2, `${locale}: 자치구마다 배지가 하나여야 한다`);
  }
});

test("자치구 페이지 제목은 그 구를 말한다 - '서울 전체 평균' 아래 그 구의 숫자가 나오지 않게 (#42)", async () => {
  const html = await read(`${SITE}/district-songpa.html`);
  assert.match(html, /<h2 id="overall-heading">송파구 평균<\/h2>/);
  assert.match(html, /<h2 id="district-heading">거래 유형별<\/h2>/);
  assert.doesNotMatch(html, /<h2 id="overall-heading">서울 전체 평균/);
  assert.match(await read(`${SITE}/realestate.html`), /<h2 id="overall-heading">서울 전체 평균<\/h2>/, "서울 시세 화면은 그대로");

  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });
  assert.equal(page.byId("overall-heading").textContent, "강남구 평균", "자바스크립트가 템플릿 제목으로 되돌렸다");
  assert.equal(page.byId("district-heading").textContent, "거래 유형별");
});

test("자치구 요약 절은 제 문단으로만 열린다 - 예산대 문단이 빈 절을 열지 않게 (#42)", async () => {
  const html = await read(`${SITE}/budget-7eok.html`);
  const start = html.indexOf('<section id="district-summary-section"');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.ok(!section.includes("budget-facts"), "예산대 문단이 요약 절 안으로 들어왔다 - 아래 검사의 전제가 바뀌었다");
  assert.ok(html.includes('class="district-summary budget-facts" data-summary-lang="ko"'), "전제: 예산대 문단도 같은 속성을 단다");
  const body = html.slice(html.indexOf("function renderDistrictSummary"), html.indexOf("function renderTrend"));
  assert.match(body, /section\.querySelectorAll\("\[data-summary-lang\]"\)/, "절을 열지 판단할 때 문서 전체 문단을 본다");
});

test("1억이 넘는 돈은 늘 'n억 n만원' 꼴로 적는다 (#46)", async () => {
  const { formatMan } = await import("../scripts/realestate-format.ts");
  assert.equal(formatMan(20264), "2억 264만원");
  assert.equal(formatMan(20000), "2억원");
  assert.equal(formatMan(9999), "9,999만원");
  assert.equal(formatMan(128), "128만원");
  const html = realestateTableHtml({ districts: [district("강남구", { wolse: { avgDeposit10k: 20264, avgMonthlyRent10k: 128, transactionCount: 30 } })] }, "wolse");
  assert.match(html, /2억 264만원/);
  assert.doesNotMatch(html, /20,264만원/);
});

test("한국어는 띄어쓰기에서만 줄을 바꾼다 - 돈이 '30 / 억'으로 갈라지지 않게 (#46)", async () => {
  const css = await read("src/css/legacy.css");
  const body = css.match(/\nbody \{([^}]*)\}/)?.[1] ?? "";
  assert.match(body, /word-break:\s*keep-all/);
  assert.match(body, /overflow-wrap:\s*break-word/, "띄어쓰기 없는 긴 낱말이 넘친다");
});

test("자치구 장에 '이 구에서' 길 - 이 구의 실거래, 84㎡ 값의 예산대, 재계약, 갈아타기 (#45)", async () => {
  const { districtHereHtml } = await import("../scripts/build-realestate-pages.ts");
  const realestate = { districts: [{ name: "가구", sale: { avgPricePerPyeong10k: 3000 } }, { name: "나구", sale: { avgPricePerPyeong10k: 20000 } }] };
  const html = districtHereHtml("가구", realestate);
  assert.match(html, /deal-search\.html\?district=%EA%B0%80%EA%B5%AC/);
  assert.match(html, /budget-7eok\.html">가구 84㎡ 값에 맞는 7억대 후보/, "3,000만원/평 × 84㎡ ≈ 7.6억");
  assert.match(districtHereHtml("나구", realestate), /budget-20eok\.html/, "20억대 위는 끝 장으로");
  assert.doesNotMatch(districtHereHtml("다구", realestate), /budget-/, "값이 없는 구에 예산대를 지어냈다");
  assert.match(await read(`${SITE}/district-songpa.html`), /class="card-links district-here"/);
  assert.match(html, /switch-house\.html\?from=%EA%B0%80%EA%B5%AC/, "갈아타기로 갈 때 이 구를 골라 두지 않는다 (#52)");
});

// realestate.html 틀 47장의 CLS는 "#trend-section이 데이터가 온 뒤에야 펴지면서 412폭에서 727px을
// 한 프레임에 밀어 넣는 것"이었다(#287 (마)). 고친 방식은 그 구획이 hidden인 동안만 보이는 빈 자리를
// 깔고 높이를 CSS가 잡는 것이라, 되풀이는 세 길로 들어온다 — 자리가 사라지거나, 칸 수가 그릴 카드 수와
// 어긋나거나, 높이를 잡는 규칙이 없어지거나. 셋 다 여기서 막는다.
// 값(시세·날짜)에 기대지 않는 구조 검사다(#8).
test("추이 구획이 hidden인 동안 같은 높이의 빈 자리가 대신 선다 (#287)", async () => {
  const { REALESTATE_PAGES: pages } = await import("../scripts/build-realestate-pages.ts");
  const { BUDGET_PAGES } = await import("../scripts/budget-pages.ts");
  const files = [
    "realestate.html",
    ...pages.map((p) => p.file),
    ...DISTRICT_PAGES.map((d) => d.file),
    ...BUDGET_PAGES.map((b) => b.file),
  ];
  assert.equal(files.length, 47, "틀을 쓰는 장 수가 바뀌었다 - 예약이 닿는 범위를 다시 세라");

  for (const file of files) {
    const html = await read(`${SITE}/${file}`);
    assert.ok(html.includes('<section id="trend-section" class="tw:mb-10 tw:1024:mb-16" hidden>'), `${file}: 추이 구획이 hidden으로 구워지지 않는다`);

    // 예약은 구획 바로 뒤에 온다 - CSS가 `#trend-section[hidden] + .trend-reserve`로 집는다.
    const after = html.slice(html.indexOf('<section id="trend-section" class="tw:mb-10 tw:1024:mb-16" hidden>'));
    const reserve = /<\/section>\s*(?:<!--[\s\S]*?-->\s*)?<div class="trend-reserve tw:mb-10 tw:1024:mb-16">([\s\S]*?)<\/div>\s*<\/div>/.exec(after);
    assert.ok(reserve, `${file}: 추이 구획 바로 뒤의 자리 예약을 찾지 못했다`);

    const cells = [...reserve[1].matchAll(/<div class="trend-reserve-card">/g)].length;
    // 3은 코드에서 유도한 수가 아니라 실측이다 - 47장 × 412폭을 헤드리스 Chrome으로 돌려 전부
    // "보이는 카드 3장 · 구획 727px"이었다(2026-10-16). 넉 장 중 월세 카드와 전세가율 카드가
    // 서로 배타라 동시에 서는 것은 석 장이다. 카드 구성이 바뀌면 그 실측이 깨지므로 아래에서 같이 묶는다.
    assert.equal(cells, 3, `${file}: 예약이 ${cells}칸이다 - 동시에 서는 카드는 석 장이다`);
    const ids = [...after.slice(0, after.indexOf("</section>")).matchAll(/<div class="history-card" id="([a-z-]+)">/g)].map((m) => m[1]);
    assert.deepEqual(
      ids,
      ["trend-card", "rent-card", "volume-card", "ratio-card"],
      `${file}: 추이 카드 구성이 바뀌었다 - 예약 칸 수와 높이를 다시 재라`
    );
  }

  // 자리만 깔고 높이를 안 잡으면 0px이라 같은 밀림이 돌아온다.
  const css = await read("src/css/legacy.css");
  for (const rule of [
    /#trend-section\[hidden\] \+ \.trend-reserve \{[^}]*display: block;[^}]*visibility: hidden;/,
    /\.trend-reserve::before \{\s*content: "\\00a0";/,
    /\.trend-reserve-card \{[^}]*padding: 12px 14px;/,
    /\.trend-reserve-card::before \{\s*content: "\\00a0";/,
    /\.trend-reserve-card::after \{\s*content: "\\00a0";[^}]*padding-bottom: 124px;/,
    /\.trend-reserve::after \{\s*content: "\\00a0\\A\\00a0";/,
  ]) {
    assert.match(css, rule, "src/css/legacy.css: 추이 자리 예약의 높이를 잡는 규칙이 사라졌다");
  }

  // 제목 한 줄은 h2 규칙을 같이 받아야 한다. 떨어지면 글자 크기·줄 높이·여백이 따로 놀아
  // 예약이 남거나 모자란다(#278 PR C에서 7.5px이 남았던 자리).
  assert.match(
    css,
    /\nh2,\n\.trend-reserve::before \{/,
    "src/css/legacy.css: 예약 제목이 h2 규칙에서 떨어져 나왔다"
  );

  // 구운 산출물에 개발자용 설명문을 싣지 않는다(장부 규칙 3). 설명은 이 CSS와
  // scripts/build-realestate-pages.ts에 있고, 틀과 생성 47장에는 주석이 0줄이다.
  for (const file of files) {
    const html = await read(`${SITE}/${file}`);
    const block = html.slice(html.indexOf('<section id="trend-section" class="tw:mb-10 tw:1024:mb-16" hidden>'), html.indexOf('<div class="trend-reserve '));
    const comments = [...block.matchAll(/<!--(?!\/?prerender:)/g)].length;
    assert.equal(comments, 0, `${file}: 예약 둘레에 구운 주석이 ${comments}줄 남았다 - 설명은 빌드 소스에 적는다`);
  }
});
