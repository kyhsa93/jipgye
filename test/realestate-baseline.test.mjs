import test from "node:test";
import assert from "node:assert/strict";
import { WOLSE_CONVERSION_RATE, attachChanges, findBaseline, summarizeRent } from "../scripts/realestate-metrics.mjs";

const entry = (date, period, count, perPyeong) => ({
  date,
  period,
  overall: { sale: { avgPricePerM2: perPyeong * 3, avgPricePerPyeong10k: perPyeong, transactionCount: count } },
  districts: [
    { code: "11110", sale: { avgPricePerPyeong10k: perPyeong, transactionCount: count } },
  ],
});

const AUGUST = [
  entry("2026-08-01", "202608", 40, 3500),
  entry("2026-08-08", "202608", 300, 3600),
  entry("2026-08-15", "202608", 575, 3620),
  entry("2026-08-25", "202608", 1180, 3640),
  entry("2026-08-31", "202608", 1400, 3650),
];

const at = (date) => new Date(`${date}T00:00:00Z`);

test("같은 달 안에서는 이레 전 값을 기준으로 잡는다", () => {
  const baseline = findBaseline(AUGUST, at("2026-08-15"));
  assert.equal(baseline.date, "2026-08-08");
});

test("달이 바뀌어도 이레 전 값을 그대로 견준다", () => {
  const history = [...AUGUST, entry("2026-09-01", "202609", 1210, 3660)];

  const baseline = findBaseline(history, at("2026-09-01"));
  assert.equal(baseline.date, "2026-08-25", "달이 바뀌었다고 기준을 놓쳤다");
});

test("기준값이 없으면 증감을 붙이지 않는다", () => {
  const overall = { sale: { avgPricePerPyeong10k: 3200, transactionCount: 45 }, saleNational84: null, jeonse: null, wolse: null };
  const districts = [{ code: "11110", name: "종로구", sale: { avgPricePerPyeong10k: 3200, transactionCount: 45 } }];

  const withChanges = attachChanges(overall, districts, null);

  assert.equal(withChanges.overall.sale.change, undefined, "기준 없이 증감을 만들어냈다");
  assert.equal(withChanges.overall.sale.baselineDate, undefined);
  assert.equal(withChanges.districts[0].sale.change, undefined);
});

test("기록이 비어 있어도 기준값을 지어내지 않는다", () => {
  assert.equal(findBaseline([], at("2026-08-15")), null);
  assert.equal(findBaseline(AUGUST.slice(0, 1), at("2026-08-01")), null);
});

test("수집이 멈춰 이레 전 값이 없고 한참 낡은 값만 있으면 증감을 붙이지 않는다 (#6)", () => {
  // 2026-09-02 다음 기록이 10-01이었다 - 29일 전 값을 '전주 대비'로 견주고 있었다.
  const history = [...AUGUST, entry("2026-09-02", "202609", 1300, 3660)];
  assert.equal(findBaseline(history, at("2026-10-01")), null, "29일 전 값을 기준으로 잡았다");
  assert.equal(findBaseline(history, at("2026-09-14")).date, "2026-09-02", "12일 전 값은 기준으로 써야 한다");
});

test("월세 증감은 방 크기 구성이 바뀌어도 시세가 그대로면 0이다 (#6)", () => {
  // ㎡당 값이 같은 두 시장: 지난주는 큰 집이, 이번 주는 작은 집이 많이 신고됐다.
  const deal = (area, deposit, rent) => ({ contractType: "신규", deposit: String(deposit), monthlyRent: String(rent), excluUseAr: area });
  const big = (k) => deal(84 * k, 84 * k * 300, 84 * k);
  const lastWeek = summarizeRent([big(1), big(1), big(1), big(0.5)]).wolse;
  const thisWeek = summarizeRent([big(0.5), big(0.5), big(0.5), big(1)]).wolse;
  assert.notEqual(lastWeek.avgDeposit10k, thisWeek.avgDeposit10k, "전제: 단순평균은 달라야 한다");
  assert.equal(lastWeek.avgConvertedPerPyeong10k, thisWeek.avgConvertedPerPyeong10k);

  const { districts } = attachChanges(
    { sale: null, saleNational84: null, jeonse: null, wolse: null },
    [{ code: "11110", wolse: thisWeek }],
    { date: "2026-09-24", districts: [{ code: "11110", wolse: lastWeek }] }
  );
  assert.equal(districts[0].wolse.change.percent, 0, "방 크기 구성 변화가 증감으로 나왔다");
  assert.equal(districts[0].wolse.depositChange, undefined, "단순평균 증감이 남아 있다");
});

test("보증금을 월세로 바꿔 받은 같은 값의 계약은 같은 환산값이다", () => {
  const rate = WOLSE_CONVERSION_RATE;
  const a = summarizeRent([{ contractType: "신규", deposit: "30,000", monthlyRent: "10", excluUseAr: 59 }]).wolse;
  const b = summarizeRent([{ contractType: "신규", deposit: String(30000 - Math.round((50 * 12) / rate)), monthlyRent: "60", excluUseAr: 59 }]).wolse;
  assert.ok(Math.abs(a.avgConvertedPerPyeong10k - b.avgConvertedPerPyeong10k) <= 1);
});

test("화면이 적는 전환율이 계산에 쓰는 값과 같다", async () => {
  const { readFile } = await import("node:fs/promises");
  const rate = `${(WOLSE_CONVERSION_RATE * 100).toFixed(1)}%`;
  for (const page of ["realestate", "apartment-sale", "apartment-rent", "apartment-jeonse", "method"]) {
    const html = await readFile(new URL(`../docs/${page}.html`, import.meta.url), "utf8");
    const written = [...html.matchAll(/(?:×|&times;)12(?:÷|&divide;)([\d.]+%)/g)].map((m) => m[1]);
    assert.ok(written.length >= 2, `${page}: 전환율 문구가 없다`);
    for (const w of written) assert.equal(w, rate, `${page}: 화면은 ${w}, 계산은 ${rate}`);
  }
});
