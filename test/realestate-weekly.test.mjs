import test from "node:test";
import assert from "node:assert/strict";
import {
  WEEKS_KEPT,
  buildWeekly,
  firstFullWeek,
  nextWeek,
  settledWeek,
  weekStart,
} from "../scripts/realestate-weekly.ts";
import { arrivalShortfall, arrivalWindowReady, contractRows, readWindowItems, representWindow } from "../scripts/build-realestate.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { MIN_SAMPLE } from "../scripts/realestate-format.ts";
import { RETENTION_MONTHS, TREND_MONTHS, WINDOW_MONTHS, windowMonths } from "../scripts/realestate-slots.ts";

const NOW = new Date("2026-09-07T00:00:00Z");

const sale = (observedOn, extra = {}) => ({
  type: "sale",
  district: "노원구",
  observedOn,
  amount10k: 60_000,
  area: 60,
  ...extra,
});

const jeonse = (observedOn, extra = {}) => ({
  type: "jeonse",
  district: "노원구",
  observedOn,
  deposit10k: 30_000,
  area: 60,
  ...extra,
});

const wolse = (observedOn, extra = {}) => ({
  type: "wolse",
  district: "노원구",
  observedOn,
  deposit10k: 10_000,
  monthlyRent10k: 80,
  area: 60,
  ...extra,
});

test("한 주는 월요일에 시작한다", () => {
  assert.equal(weekStart("2026-08-24"), "2026-08-24");
  assert.equal(weekStart("2026-08-30"), "2026-08-24");
  assert.equal(weekStart("2026-08-31"), "2026-08-31");
  assert.equal(weekStart(new Date("2026-08-30T15:30:00Z")), "2026-08-31", "KST로 날짜를 세지 않는다");
});

test("주는 달과 해를 넘어서도 이어진다", () => {
  assert.equal(nextWeek("2026-08-31", -1), "2026-08-24");
  assert.equal(nextWeek("2026-12-28", 1), "2027-01-04");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
});

test("이번 주는 아직 끝나지 않았으므로 확정 주는 지난주다", () => {
  assert.equal(settledWeek(NOW), "2026-08-31");
});

test("진행 중인 주는 집계에 넣지 않는다", () => {
  const weekly = buildWeekly([sale("2026-08-25"), sale("2026-09-01"), sale("2026-09-07")], NOW);

  assert.deepEqual(weekly.weeks, ["2026-08-24", "2026-08-31"]);
  assert.ok(!weekly.overall["2026-09-07"], "이번 주를 확정으로 셌다");
});

test("신고 기한이 남은 주는 잠정으로 따로 낸다", () => {
  const days = ["2026-07-28", "2026-08-04", "2026-08-11", "2026-08-25", "2026-09-01"];
  const weekly = buildWeekly(days.map((day) => sale(day)), NOW, { graceDays: 30 });

  assert.deepEqual(weekly.weeks, ["2026-07-27"], "기한이 지난 주가 확정에 다 들어가지 않았다");
  assert.deepEqual(
    weekly.pendingWeeks,
    ["2026-08-03", "2026-08-10", "2026-08-24", "2026-08-31"],
    "기한이 남은 주를 버렸다"
  );
  assert.ok(weekly.overall["2026-08-31"], "잠정 주의 값을 내지 않았다");
  assert.ok(weekly.districts.노원구["2026-08-31"], "자치구는 잠정 주가 비었다");
});

test("이번 주는 잠정에도 넣지 않는다", () => {
  const weekly = buildWeekly([sale("2026-07-28"), sale("2026-09-07")], NOW, { graceDays: 30 });

  assert.ok(!weekly.pendingWeeks.includes("2026-09-07"), "아직 흐르는 주를 그린다");
  assert.ok(!weekly.overall["2026-09-07"]);
});

test("기한을 두지 않으면 잠정 주도 없다", () => {
  const weekly = buildWeekly([sale("2026-08-25"), sale("2026-09-01")], NOW);
  assert.deepEqual(weekly.pendingWeeks, []);
});

test("서울 전체는 그 주 신고분만으로 센다", () => {
  const weekly = buildWeekly(
    [
      sale("2026-08-25", { amount10k: 60_000, area: 60 }),
      sale("2026-08-26", { amount10k: 90_000, area: 60 }),
      sale("2026-09-01", { amount10k: 120_000, area: 60 }),
    ],
    NOW
  );

  assert.equal(weekly.overall["2026-08-24"].sale.transactionCount, 2);
  assert.equal(weekly.overall["2026-08-31"].sale.transactionCount, 1, "지난주 거래가 이번 확정 주에 섞였다");
});

test("자치구는 네 주를 겹쳐 센다", () => {
  const arrivals = ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"].map((day) => sale(day));
  const weekly = buildWeekly(arrivals, NOW);

  assert.equal(weekly.districts.노원구["2026-08-31"].sale.transactionCount, 4, "이동평균이 아니다");
  assert.equal(weekly.overall["2026-08-31"].sale.transactionCount, 1, "서울 전체까지 겹쳐 셌다");
  assert.equal(weekly.movingWeeks, 4);
});

test("전세와 월세를 갈라 센다", () => {
  const weekly = buildWeekly(
    [jeonse("2026-08-25"), jeonse("2026-08-26", { deposit10k: 50_000 }), wolse("2026-08-27")],
    NOW
  );

  const week = weekly.overall["2026-08-24"];
  assert.equal(week.jeonse.transactionCount, 2);
  assert.equal(week.wolse.transactionCount, 1);
  assert.equal(week.wolse.avgMonthlyRent10k, 80);
  assert.ok(!week.sale, "매매가 없는데 값을 만들었다");
});

test("평당가는 면적으로 가중해 낸다", () => {
  const weekly = buildWeekly(
    [sale("2026-08-25", { amount10k: 60_000, area: 60 }), sale("2026-08-26", { amount10k: 30_000, area: 30 })],
    NOW
  );

  assert.equal(weekly.overall["2026-08-24"].sale.avgPricePerPyeong10k, Math.round((1000 * 3.3058)));
});

test("신고 기록이 없으면 아무것도 만들지 않는다", () => {
  assert.equal(buildWeekly([], NOW), null);
  assert.equal(buildWeekly([sale("2026-09-07")], NOW), null, "이번 주뿐인데 주간값을 만들었다");
});

test("보관 주 수를 넘기면 오래된 주부터 떨어뜨린다", () => {
  const arrivals = [];
  for (let i = 0; i < 30; i += 1) arrivals.push(sale(nextWeek("2026-02-02", i)));

  const weekly = buildWeekly(arrivals, NOW, { weeksKept: 26 });
  assert.equal(weekly.weeks.length, 26);
  assert.equal(weekly.weeks.at(-1), "2026-08-24");
});

test("기본 보관 주 수는 1년(52주)이다 - 60주를 주면 최근 52주만 남긴다", () => {
  assert.equal(WEEKS_KEPT, 52);
  const arrivals = [];
  for (let i = 0; i < 60; i += 1) arrivals.push(sale(nextWeek("2025-07-07", i)));

  const weekly = buildWeekly(arrivals, NOW);
  assert.equal(weekly.weeks.length, 52, `기본값이 52주가 아니다: ${weekly.weeks.length}`);
  assert.equal(weekly.weeks.at(-1), "2026-08-24");
  assert.equal(weekly.weeks[0], nextWeek("2026-08-24", -51));
});

// 추이 창(TREND_MONTHS)은 시세 표 창(WINDOW_MONTHS)과 따로 움직인다. writeTrend 와 같은 셈(첫 달의 첫 온전한 주 ~ 신고 기한 30일이 지난 주)으로
// 한 해의 모든 날을 돌려, 그 창이 확정 주를 거의 늘 52주 채우는지(달 초 며칠만 51주) 본다. 원본 보관 창 안에 있어야 다시 만들 수 있다.
test("추이 창은 시세 표 창과 따로이고 한 해 내내 확정 주를 51~52주 채운다", () => {
  assert.equal(WINDOW_MONTHS, 6, "추이를 넓히려고 시세 표 창을 건드렸다");
  assert.ok(TREND_MONTHS > WINDOW_MONTHS && TREND_MONTHS <= RETENTION_MONTHS);
  const counts = new Set();
  for (let day = 0; day < 366; day += 1) {
    const now = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000);
    const oldest = windowMonths(now, TREND_MONTHS).at(-1);
    const from = firstFullWeek(`${oldest.slice(0, 4)}-${oldest.slice(4, 6)}-01`);
    const settled = settledWeek(now, 30);
    let weeks = 0;
    for (let week = from; week <= settled; week = nextWeek(week, 1)) weeks += 1;
    counts.add(Math.min(weeks, WEEKS_KEPT));
  }
  assert.deepEqual([...counts].sort(), [51, 52], `확정 주 수가 1년에 못 미치는 날이 있다: ${[...counts].join(",")}`);
});

const rawFile = (kind, items) => ({ kind, items });

const saleRaw = (extra = {}) => ({
  aptNm: "단지",
  dealAmount: "60,000",
  dealDay: 3,
  dealMonth: 8,
  dealYear: 2026,
  excluUseAr: 60,
  umdNm: "동",
  ...extra,
});

const rentRaw = (extra = {}) => ({
  aptNm: "단지",
  deposit: "30,000",
  dealDay: 3,
  dealMonth: 8,
  dealYear: 2026,
  excluUseAr: 60,
  monthlyRent: 0,
  umdNm: "동",
  ...extra,
});

test("계약일을 그대로 관측일로 삼는다", () => {
  const rows = contractRows(rawFile("sale", [saleRaw({ aptNm: "단지" })]), "노원구");

  assert.deepEqual(rows, [
    { type: "sale", district: "노원구", observedOn: "2026-08-03", amount10k: 60_000, area: 60 },
  ]);
});

test("해제된 거래는 주간 시세에서 뺀다", () => {
  const items = [saleRaw({ aptNm: "해제", cdealType: "해제", cdealDay: "26.08.20" }), saleRaw({ aptNm: "성사" })];
  const rows = contractRows(rawFile("sale", items), "노원구");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount10k, 60_000);
});

test("전세와 월세를 원본에서 갈라 담는다", () => {
  const items = [rentRaw({ aptNm: "전세" }), rentRaw({ aptNm: "월세", monthlyRent: "80" })];
  const rows = contractRows(rawFile("rent", items), "노원구");

  assert.deepEqual(rows.map((row) => row.type), ["jeonse", "wolse"]);
  assert.equal(rows[0].monthlyRent10k, 0);
  assert.equal(rows[1].monthlyRent10k, 80);
});

test("계약일이 성하지 않은 원본은 아무것도 내놓지 않는다", () => {
  assert.deepEqual(contractRows(rawFile("sale", [saleRaw({ dealMonth: null })]), "노원구"), []);
  assert.deepEqual(contractRows(null, "노원구"), []);
});

test("주간 시세에서도 갱신계약을 뺀다", () => {
  const items = [rentRaw({ aptNm: "신규" }), rentRaw({ aptNm: "갱신", contractType: "갱신" })];
  const rows = contractRows(rawFile("rent", items), "노원구");

  assert.equal(rows.length, 1, "갱신계약이 주간 집계에 들어갔다");
});

// 이번 주 신고분 Map(`readWindowItems`의 items 모양): 키 `sale:<코드>`·`rent:<코드>`, 값은 { item, date } 배열.
const arrivalItems = (districtCount, { sale = 0, jeonse = 0, wolse = 0 } = {}) => {
  const items = new Map();
  const rows = (make, count) => Array.from({ length: count }, (_, i) => ({ item: make(i), date: "2026-10-19" }));
  for (const { code } of DISTRICTS.slice(0, districtCount)) {
    if (sale) items.set(`sale:${code}`, rows((i) => saleRaw({ aptNm: `매매${i}` }), sale));
    const rent = [...rows((i) => rentRaw({ aptNm: `전세${i}` }), jeonse), ...rows((i) => rentRaw({ aptNm: `월세${i}`, monthlyRent: "50" }), wolse)];
    if (rent.length) items.set(`rent:${code}`, rent);
  }
  return items;
};

test("신고일 기준 전환: 자치구 절반(13)을 못 채우면 표본이 많아도 안 넘어간다", () => {
  const items = arrivalItems(12, { sale: 9, jeonse: 9, wolse: 9 });
  assert.equal(arrivalWindowReady(items), false);
  assert.equal(arrivalShortfall(items).reason, "districts");
  assert.equal(arrivalWindowReady(arrivalItems(13, { sale: 9, jeonse: 9, wolse: 9 })), true, "13곳이면 문턱을 넘는다(ceil(25/2))");
});

test("신고일 기준 전환: 자치구가 걸쳐도 서울 전체 전세가 0건이면 안 넘어간다 (#387)", () => {
  // 2026-10-19 새벽: 16개 구에 매매 17건·월세 4건, 전세는 없었다.
  const items = arrivalItems(16, { sale: 1, wolse: 0 });
  const shortfall = arrivalShortfall(items);
  assert.equal(shortfall.reason, "sample");
  assert.deepEqual(shortfall.short, ["전세", "월세"]);
  assert.equal(shortfall.counts.jeonse, 0);
  assert.equal(arrivalWindowReady(items), false);
});

// 종류별 서울 전체 건수를 정확히 맞춘다: 매매·전세·월세 모두 앞 구부터 한 구에 한 건씩이다. 다른 두 종류가 13곳씩 깔려 있으면 자치구 문턱(13)은 늘 넘는다.
const exactCounts = ({ sale, jeonse, wolse }) => {
  const items = new Map();
  const put = (key, row) => items.set(key, [...(items.get(key) ?? []), { item: row, date: "2026-10-19" }]);
  DISTRICTS.slice(0, sale).forEach(({ code }, i) => put(`sale:${code}`, saleRaw({ aptNm: `매매${i}` })));
  DISTRICTS.slice(0, jeonse).forEach(({ code }, i) => put(`rent:${code}`, rentRaw({ aptNm: `전세${i}` })));
  DISTRICTS.slice(0, wolse).forEach(({ code }, i) => put(`rent:${code}`, rentRaw({ aptNm: `월세${i}`, monthlyRent: "50" })));
  return items;
};

test("신고일 기준 전환: 매매·전세·월세 각각 MIN_SAMPLE 건부터 넘어간다, 하나라도 모자라면 안 넘어간다 (#387)", () => {
  const full = { sale: 13, jeonse: 13, wolse: 13 };
  assert.equal(arrivalWindowReady(exactCounts(full)), true);

  for (const [kind, label] of [["sale", "매매"], ["jeonse", "전세"], ["wolse", "월세"]]) {
    const short = arrivalShortfall(exactCounts({ ...full, [kind]: MIN_SAMPLE - 1 }));
    assert.equal(short?.reason, "sample", `${label} ${MIN_SAMPLE - 1}건인데 넘어갔다`);
    assert.deepEqual(short.short, [label]);
    assert.equal(short.counts[kind], MIN_SAMPLE - 1);
    assert.equal(arrivalWindowReady(exactCounts({ ...full, [kind]: MIN_SAMPLE })), true, `${label} 딱 ${MIN_SAMPLE}건이면 넘어가야 한다`);
  }
});

// #477: readWindowItems 는 읽기를 동시에 하되 합치는 순서를 완료 순서가 아닌 고정 순서(months -> DISTRICTS -> sale·rent)로 둔다.
// 읽기 함수를 갈아 끼워 슬롯마다 끝나는 순서를 바꿔 본다 - 완료 순서가 새면 항목 배열 순서가 달라진다.
const WINDOW_477 = { basis: "contract", from: "2026-07-01", until: "2026-10-01" };
const MONTHS_477 = ["202607", "202608", "202609"];
const readerWith = (delayOf) => async (kind, code, yearMonth) => {
  await new Promise((resolve) => setTimeout(resolve, delayOf(kind, code, yearMonth)));
  const make = kind === "sale" ? saleRaw : rentRaw;
  return rawFile(kind, [make({ aptNm: `${kind}-${code}-${yearMonth}`, dealMonth: Number(yearMonth.slice(4)), dealDay: 5 })]);
};

test("readWindowItems: 항목은 완료 순서가 아니라 months -> DISTRICTS -> sale·rent 고정 순서로 쌓인다 (#477)", async () => {
  // 늦은 달이 먼저 끝나고 같은 달 안에서도 뒤 구·rent 가 먼저 끝나도록 지연을 거꾸로 준다.
  const slotIndex = (kind, code, yearMonth) =>
    MONTHS_477.indexOf(yearMonth) * DISTRICTS.length * 2 + DISTRICTS.findIndex((d) => d.code === code) * 2 + (kind === "rent" ? 1 : 0);
  const total = MONTHS_477.length * DISTRICTS.length * 2;
  const reversed = readerWith((kind, code, yearMonth) => total - slotIndex(kind, code, yearMonth));

  const { items } = await readWindowItems(NOW, WINDOW_477, reversed);

  const keys = [...items.keys()];
  assert.deepEqual(
    keys,
    DISTRICTS.flatMap(({ code }) => [`sale:${code}`, `rent:${code}`]),
    "Map 키 순서는 DISTRICTS 순서에 sale·rent 가 붙은 모양이다"
  );
  for (const [key, rows] of items) {
    const [kind, code] = key.split(":");
    assert.deepEqual(
      rows.map((row) => row.item.aptNm),
      MONTHS_477.map((m) => `${kind}-${code}-${m}`),
      `${key} 의 항목은 달 순서(값 정렬이 아니라 months 인덱스 순)다`
    );
  }
});

test("readWindowItems: 슬롯이 끝나는 순서가 달라도 결과가 같다 (#477)", async () => {
  const schedules = [
    () => 0,
    (kind, code, yearMonth) => 30 - MONTHS_477.indexOf(yearMonth) * 10,
    (kind, code) => (Number(code) * 7) % 11,
  ];
  const results = [];
  for (const delayOf of schedules) {
    const { items } = await readWindowItems(NOW, WINDOW_477, readerWith(delayOf));
    results.push(JSON.stringify([...items]));
  }
  assert.equal(results[1], results[0]);
  assert.equal(results[2], results[0]);
});
