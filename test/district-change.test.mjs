import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MIN_CELLS, cellChanges, districtRows, pairVerdicts, periods, surveyChange, toDeal } from "../scripts/district-change.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("1년 전 석 달이 다 있으면 그것을, 없으면 가장 이른 석 달과 실제 간격을 쓴다", () => {
  const full = ["202506", "202507", "202508", "202606", "202607", "202608"];
  assert.deepEqual(periods("202608", full), { base: ["202506", "202507", "202508"], recent: ["202606", "202607", "202608"], months: 12 });
  const short = ["202508", "202509", "202510", "202511", "202606", "202607", "202608"];
  assert.deepEqual(periods("202608", short), { base: ["202508", "202509", "202510"], recent: ["202606", "202607", "202608"], months: 10 });
  assert.equal(periods("202608", ["202606", "202607", "202608"]), null);
});

test("해제·직거래는 세지 않는다", () => {
  const item = { sggCd: 11350, aptNm: "가", excluUseAr: 59.9, dealAmount: "60,000", dealYear: 2026, dealMonth: 7, dealingGbn: "중개거래" };
  assert.ok(toDeal(item));
  assert.equal(toDeal({ ...item, cdealType: "O" }), null);
  assert.equal(toDeal({ ...item, dealingGbn: "직거래" }), null);
});

const p = { base: ["202508", "202509", "202510"], recent: ["202606", "202607", "202608"] };
const d = (district, cell, month, amount) => ({ district, cell: `${district}|${cell}`, month, amount });

test("두 시기 모두 거래된 칸만, 칸 안에서 견준다 — 구성이 바뀐 것을 변화로 읽지 않는다", () => {
  const deals = [
    d("A", "싼", "202509", 50_000), d("A", "싼", "202607", 55_000),
    d("A", "비싼", "202509", 200_000), d("A", "비싼", "202607", 220_000),
    d("A", "최근만", "202607", 900_000), // 한 시기에만 있는 칸 - 평균은 끌어올리지만 변화가 아니다
  ];
  const v = cellChanges(deals, p).get("A");
  assert.equal(v.length, 2);
  for (const x of v) assert.ok(Math.abs(Math.expm1(x) - 0.1) < 1e-9);
});

function cells(district, n, change) {
  return Array.from({ length: n }, (_, i) => [d(district, `c${i}`, "202509", 100_000), d(district, `c${i}`, "202607", 100_000 * (1 + change + (i % 5) * 0.002))]).flat();
}

test("칸이 모자란 구는 값 없이 칸 수만 남긴다", () => {
  const byDistrict = cellChanges(cells("A", MIN_CELLS - 1, 0.1), p);
  const [row] = districtRows(byDistrict, [{ code: "A", name: "가구" }]);
  assert.equal(row.change, null);
  assert.equal(row.cells, MIN_CELLS - 1);
});

test("구간이 겹치지 않는 쌍만 갈라 볼 수 있다고 한다", () => {
  const byDistrict = cellChanges([...cells("A", 40, 0.2), ...cells("B", 40, 0.02), ...cells("C", 40, 0.201)], p);
  const rows = districtRows(byDistrict, [{ code: "A", name: "가" }, { code: "B", name: "나" }, { code: "C", name: "다" }]);
  const pairs = pairVerdicts(rows);
  assert.equal(pairs["A-B"], true);
  assert.equal(pairs["A-C"], false, "구간이 겹치는데 차이를 말했다");
  assert.equal(Object.keys(pairs).length, 3);
});

test("조사 지수는 두 시기 평균 사이 변화", () => {
  const s = [["202508", 100], ["202509", 100], ["202510", 100], ["202606", 110], ["202607", 110], ["202608", 110]];
  assert.equal(surveyChange(s, p), 10);
  assert.equal(surveyChange(s.slice(0, 5), p), null, "한 달이 빠졌는데 평균을 냈다");
});

test("정적 HTML이 오늘 데이터의 문장과 표를 싣는다", async () => {
  const [html, data] = await Promise.all([
    readFile(path.join(root, "docs/switch-house.html"), "utf8"),
    readFile(path.join(root, "docs/data/district-change.json"), "utf8").then(JSON.parse),
  ]);
  const block = (name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];
  assert.equal(block("switchTable"), data.table.ko);
  assert.equal(block("switchRegions"), data.regionTable.ko);
  assert.ok(data.lead.en && Object.keys(data.pairs).length > 0);
});

test("두 구 견주기는 금액 간격의 변화를 옮겨 갈 구 기준 부호로 적는다", async () => {
  const { loadPage } = await import("./helpers/digest-page.mjs");
  const lv = (base, recent) => ({ base, recent });
  const payload = {
    updatedAt: "2026-10-01T00:00:00Z",
    rows: [
      { code: "A", name: "가구", cells: 100, change: 13.1, low: 12, high: 15, level84: lv(80_000, 90_000) },
      { code: "B", name: "나구", cells: 100, change: 15.7, low: 13, high: 18, level84: lv(170_000, 200_000) },
      { code: "C", name: "다구", cells: 100, change: 13.0, low: 12, high: 14, level84: lv(81_000, 91_000) },
    ],
    pairs: { "A-B": false, "A-C": false, "B-C": false },
    // 키는 작은코드-큰코드, 값은 큰코드 - 작은코드
    money: { "A-B": { change: 20_000, low: 14_000, high: 32_000 }, "A-C": { change: 0, low: -3_000, high: 3_000 }, "B-C": { change: -20_000, low: -32_000, high: -14_000 } },
    lead: { ko: "x", en: "x" },
    table: { ko: "", en: "" },
    regionTable: { ko: "", en: "" },
    slugs: {},
  };
  const page = await loadPage({ file: "switch-house.html", data: { "district-change": payload } });
  const pick = async (from, to) => {
    page.byId("from-select").value = from;
    page.byId("to-select").value = to;
    page.byId("to-select").dispatch("change");
    await page.settle();
    return page.text("compare-result");
  };
  const ab = await pick("A", "B");
  assert.match(ab, /표본의 흔들림 안입니다/, "% 구간은 겹친다");
  assert.match(ab, /나구로 옮기는 데 드는 돈\(두 값의 차이\)은 그 사이 2억원 늘었습니다/, "% 구간이 겹쳐도 금액 간격은 벌어질 수 있다");
  assert.match(ab, /가구 8억원 → 9억원/);
  assert.match(await pick("B", "A"), /가구로 옮기는 데 드는 돈\(두 값의 차이\)은 그 사이 2억원 줄었습니다/, "옮기는 방향을 바꿨는데 부호가 그대로다");
  assert.match(await pick("A", "C"), /0을 품어 늘었는지 줄었는지 말할 수 없습니다/);
  assert.match(await pick("B", "B"), /다른 두 구를 고르세요/);
});

test("금액 간격: 같은 %라도 비싼 구가 더 많이 오른다", async () => {
  const { moneyGap, cellLevels, districtLevel } = await import("../scripts/district-change.mjs");
  const cheap = Array.from({ length: 40 }, (_, i) => ({ b: 1000 + i, r: (1000 + i) * 1.1 })); // 만원/㎡
  const dear = Array.from({ length: 40 }, (_, i) => ({ b: 3000 + i, r: (3000 + i) * 1.1 }));
  const g = moneyGap(cheap, dear);
  // 84㎡: 싼 구 약 8.6억 → 9.5억, 비싼 구 약 25.3억 → 27.8억 - 같은 10%인데 차이는 약 1.7억 벌어진다
  assert.ok(g.change > 15_000 && g.change < 18_000, `${g.change}`);
  assert.ok(g.low > 0, "같은 %인데 금액 간격이 안 벌어졌다고 했다");
  const levels = cellLevels(
    [{ district: "A", cell: "A|x|84", month: "202509", perM2: 1000 }, { district: "A", cell: "A|x|84", month: "202607", perM2: 1100 }, { district: "A", cell: "A|y|84", month: "202607", perM2: 9999 }],
    { base: ["202508", "202509", "202510"], recent: ["202606", "202607", "202608"] }
  );
  assert.deepEqual(districtLevel(levels.get("A")), { base: 84_000, recent: 92_400 }, "한 시기에만 있는 칸이 대표 가격에 섞였다");
});
