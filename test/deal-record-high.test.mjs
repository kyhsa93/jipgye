// 단지 검색 카드의 신고가 표지(D1, #704). 표지는 신고가 화면(record-high.json)과 같은 규칙이어야 한다 -
// 같은 칸·같은 날 제외·선행 3건·180일·그 전 최고가 초과, 선행이 모자라면 판단 불가로 비운다.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDealFiles, buildRentFiles, recordHighKeys } from "../scripts/deal-files.ts";
import { byCell, measure, MIN_PRIOR, recordHighOf, toDeal, WAIT_DAYS } from "../scripts/record-high.ts";

const NOW = new Date("2026-08-17T00:00:00Z");
const DAY = 86400000;

/** 원본(raw/sale) 한 줄. */
const raw = (date, amount, extra = {}) => {
  const [y, m, d] = date.split("-").map(Number);
  return {
    sggCd: 11350,
    aptNm: "상계주공7",
    umdNm: "상계동",
    excluUseAr: 45.9,
    floor: 5,
    buildYear: 1988,
    dealYear: y,
    dealMonth: m,
    dealDay: d,
    dealAmount: amount.toLocaleString("en-US"),
    dealingGbn: "중개거래",
    cdealType: "",
    cdealDay: "",
    ...extra,
  };
};

/** 거래 파일 쪽 한 건(normalizeDeal 결과 꼴). */
const deal = (date, amount10k, extra = {}) => ({
  district: "노원구",
  dong: "상계동",
  apt: "상계주공7",
  area: 45.9,
  floor: 5,
  amount10k,
  date,
  buildYear: 1988,
  direct: false,
  ...extra,
});

// 선행 3건이 2025-12 ~ 2026-03(180일 넘게)에 있다.
const HISTORY = [raw("2025-12-01", 50_000), raw("2026-02-01", 52_000), raw("2026-06-10", 51_000)];

const cellOf = (items) => {
  const deals = items.map(toDeal).filter(Boolean);
  return { deals, list: byCell(deals).values().next().value };
};

test("recordHighOf: 그 전 최고가를 넘어야 신고가, 같으면 아니다", () => {
  const { deals, list } = cellOf([...HISTORY, raw("2026-08-10", 52_500), raw("2026-08-12", 52_000)]);
  assert.equal(recordHighOf(list, deals[3]), true);
  assert.equal(recordHighOf(list, deals[4]), false, "앞선 신고가와 같은 값은 신고가가 아니다");
});

test("recordHighOf: 선행이 모자라거나 기간이 짧으면 판단 불가(null)", () => {
  const short = cellOf([raw("2026-07-01", 50_000), raw("2026-07-05", 51_000), raw("2026-07-09", 52_000), raw("2026-08-10", 60_000)]);
  assert.equal(recordHighOf(short.list, short.deals[3]), null, "선행 3건이 180일에 못 미친다");
  const few = cellOf([raw("2025-12-01", 50_000), raw("2026-02-01", 52_000), raw("2026-08-10", 60_000)]);
  assert.equal(MIN_PRIOR, 3);
  assert.equal(recordHighOf(few.list, few.deals[2]), null, "선행 2건");
});

test("recordHighOf: 같은 날 거래는 선행으로 치지 않는다", () => {
  const { deals, list } = cellOf([...HISTORY, raw("2026-08-10", 70_000), raw("2026-08-10", 60_000)]);
  assert.equal(recordHighOf(list, deals[4]), true, "같은 날 더 비싼 건이 있어도 그 전 최고가만 본다");
});

test("신고가 화면과 같은 규칙: measure() 의 신고가 수와 recordHighOf 로 센 수가 같다", () => {
  // 칸 셋, 서로 다른 흐름. measure 는 끝에서 WAIT_DAYS 안쪽 거래를 세지 않으므로 같은 자르기로 센다.
  const items = [];
  const amounts = [50, 53, 51, 55, 54, 58, 58, 57, 60, 59, 62, 61];
  ["가", "나", "다"].forEach((apt, k) => {
    amounts.forEach((a, i) => {
      const day = new Date(Date.UTC(2025, 0, 1) + (i * 45 + k * 7) * DAY).toISOString().slice(0, 10);
      items.push(raw(day, (a + k) * 1000, { aptNm: apt, floor: (i % 4) + 1 }));
    });
  });
  const deals = items.map(toDeal).filter(Boolean);
  const cells = byCell(deals);
  const end = deals.reduce((m, d) => Math.max(m, d.time), -Infinity);
  const cut = end - WAIT_DAYS * DAY;
  let counted = 0;
  for (const list of cells.values()) for (const d of list) if (d.time <= cut && recordHighOf(list, d) === true) counted += 1;
  const m = measure(cells, end);
  assert.ok(m.records > 0);
  assert.equal(counted, m.records);
});

test("거래 파일: 신고가인 건에만 recordHigh: true, 나머지는 키가 없다", () => {
  const items = [...HISTORY, raw("2026-08-10", 52_500), raw("2026-08-12", 51_500)];
  const source = { period: "202608", districts: { s: [deal("2026-08-10", 52_500), deal("2026-08-12", 51_500)] } };
  const files = buildDealFiles(source, NOW, undefined, undefined, recordHighKeys(items));
  const byDate = Object.fromEntries(files.nowon.deals.map((d) => [d.date, d]));
  assert.equal(byDate["2026-08-10"].recordHigh, true);
  assert.ok(!("recordHigh" in byDate["2026-08-12"]), "신고가가 아닌 건에 키가 남았다");
});

test("거래 파일: 판단 불가·직거래·해제·다른 칸은 표지가 없다", () => {
  const items = [
    ...HISTORY,
    raw("2026-08-10", 90_000, { dealingGbn: "직거래" }),
    raw("2026-08-11", 91_000, { cdealType: "O", cdealDay: "26.08.14" }),
    raw("2026-08-12", 92_000, { excluUseAr: 59.9 }),
  ];
  const keys = recordHighKeys(items);
  assert.equal(keys.size, 0);
  const source = {
    period: "202608",
    districts: { s: [deal("2026-08-10", 90_000, { direct: true }), deal("2026-08-12", 92_000, { area: 59.9 })] },
  };
  const files = buildDealFiles(source, NOW, undefined, undefined, keys);
  assert.ok(files.nowon.deals.every((d) => !("recordHigh" in d)));
});

test("거래 파일: 표지 재료가 없으면 지금과 같은 파일, 전월세 파일은 건드리지 않는다", () => {
  const source = { period: "202608", districts: { s: [deal("2026-08-10", 52_500)] } };
  assert.deepEqual(buildDealFiles(source, NOW), buildDealFiles(source, NOW, undefined, undefined, new Set()));
  const rents = buildRentFiles({ period: "202608", districts: { s: [{ ...deal("2026-08-10", 0), deposit10k: 30_000 }] } }, NOW);
  assert.ok(rents.nowon.deals.every((d) => !("recordHigh" in d)));
});
