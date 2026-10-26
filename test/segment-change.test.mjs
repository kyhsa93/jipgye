import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MIN_CELLS } from "../scripts/district-change.ts";
import {
  AGES,
  AREAS,
  SEGMENT_CHANGE_NAME,
  ageKeyOf,
  areaKeyOf,
  buildSegmentPayload,
  priceKeyOf,
  segmentCells,
  toSegmentDeal,
  writeSegmentChangeSoft,
} from "../scripts/segment-change.ts";

const root = path.resolve(import.meta.dirname, "..");
// 2026-10-26 이면 신고 기한이 닫힌 마지막 달은 8월 - 두 시기는 2025-06~08 과 2026-06~08.
const NOW = new Date("2026-10-26T00:00:00Z");

/** 원본 한 줄. amount 는 만원. */
const item = (apt, area, month, amount, buildYear = 2000, extra = {}) => ({
  sggCd: 11350,
  aptNm: apt,
  excluUseAr: area,
  dealAmount: amount.toLocaleString("en-US"),
  dealYear: Number(month.slice(0, 4)),
  dealMonth: Number(month.slice(4)),
  dealingGbn: "중개거래",
  buildYear,
  ...extra,
});

/** n 칸, 칸마다 기준 시기 base 만원 → 최근 시기 base × (1 + rate ± 작은 흔들림). */
function cellsOf(prefix, n, base, rate, buildYear) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const wobble = ((i % 5) - 2) * 0.002;
    out.push(item(`${prefix}${i}`, 84, "202507", base, buildYear));
    out.push(item(`${prefix}${i}`, 84, "202607", Math.round(base * (1 + rate + wobble)), buildYear));
  }
  return out;
}

// 싼 신축(+5%), 비싼 구축(+20%) - 둘 다 문턱을 넘는다. 15억~25억 대는 문턱 아래.
// 기준 석 달이 원본에 다 있어야 1년 간격이 된다 - 한 시기에만 거래된 칸(맞물리지 않음)으로 달만 채운다.
const FILL = ["202506", "202508"].map((m) => item(`채움${m}`, 59, m, 40_000));
const FIXTURE = [
  ...FILL,
  ...cellsOf("싼", MIN_CELLS, 50_000, 0.05, 2020),
  ...cellsOf("비싼", MIN_CELLS + 10, 300_000, 0.2, 1990),
  ...cellsOf("중", MIN_CELLS - 1, 200_000, 0.1, 2010),
];

test("가격대는 BANDS 5개 키, 경계는 위쪽 포함(6억은 6억 이하)", () => {
  assert.equal(priceKeyOf(60_000), "upTo6");
  assert.equal(priceKeyOf(60_001), "upTo9");
  assert.equal(priceKeyOf(250_000), "upTo25");
  assert.equal(priceKeyOf(250_001), "over25");
});

test("연식은 10년 미만·10~29년·30년 이상, 준공 연도가 없으면 연식 구간에서만 뺀다", () => {
  assert.equal(ageKeyOf(2016, 2025), "under10");
  assert.equal(ageKeyOf(2015, 2025), "y10to29");
  assert.equal(ageKeyOf(1996, 2025), "y10to29");
  assert.equal(ageKeyOf(1995, 2025), "over30");
  assert.equal(ageKeyOf(2027, 2025), "under10");
  assert.equal(ageKeyOf(null, 2025), null);
  assert.deepEqual(AGES.map((a) => a.key), ["under10", "y10to29", "over30"]);
  assert.equal(toSegmentDeal(item("가", 84, "202507", 50_000, 0)).buildYear, null);
});

test("면적대는 4개, 경계는 위쪽 포함(60·85·135㎡는 아래 대) - 면적이 없거나 0 이하면 면적 구간에서만 뺀다", () => {
  assert.deepEqual(AREAS.map((a) => a.key), ["upTo60", "a60to85", "a85to135", "over135"]);
  assert.equal(areaKeyOf(59.99), "upTo60");
  assert.equal(areaKeyOf(60), "upTo60");
  assert.equal(areaKeyOf(60.01), "a60to85");
  assert.equal(areaKeyOf(84.97), "a60to85");
  assert.equal(areaKeyOf(85), "a60to85");
  assert.equal(areaKeyOf(85.01), "a85to135");
  assert.equal(areaKeyOf(135), "a85to135");
  assert.equal(areaKeyOf(135.01), "over135");
  assert.equal(areaKeyOf(0), null);
  assert.equal(areaKeyOf(null), null);
  assert.equal(toSegmentDeal(item("가", "", "202507", 50_000)).area, null);
  assert.equal(toSegmentDeal(item("가", "84.97", "202507", 50_000)).area, 84.97);
  const deals = [item("가", "", "202507", 50_000), item("가", "", "202607", 55_000)].map(toSegmentDeal);
  const [cell] = segmentCells(deals, { base: ["202507"], recent: ["202607"] });
  assert.equal(areaKeyOf(cell.area), null);
  assert.equal(priceKeyOf(cell.base), "upTo6"); // 가격대·연식 쪽은 그대로 센다
});

test("해제·직거래는 district-change 의 toDeal 그대로 뺀다", () => {
  assert.equal(toSegmentDeal(item("가", 84, "202507", 50_000, 2000, { cdealType: "O" })), null);
  assert.equal(toSegmentDeal(item("가", 84, "202507", 50_000, 2000, { dealingGbn: "직거래" })), null);
});

test("칸의 가격대는 기준 시기 중앙값으로 정한다 - 최근에 많이 움직여 대를 옮겨도 원래 대에 남는다", () => {
  const deals = [item("가", 84, "202507", 58_000), item("가", 84, "202607", 70_000)].map(toSegmentDeal);
  const [cell] = segmentCells(deals, { base: ["202507"], recent: ["202607"] });
  assert.equal(priceKeyOf(cell.base), "upTo6");
  // 한 시기에만 거래된 칸은 없다.
  assert.equal(segmentCells([deals[0]], { base: ["202507"], recent: ["202607"] }).length, 0);
});

test("픽스처 집계: 구간마다 변화 중앙값·90% 구간·칸 수, 문턱 아래는 값 없이 칸 수만", () => {
  const p = buildSegmentPayload({ items: FIXTURE, now: NOW });
  assert.deepEqual(p.periods, { base: ["202506", "202507", "202508"], recent: ["202606", "202607", "202608"], months: 12 });
  assert.equal(p.minCells, MIN_CELLS);
  const price = Object.fromEntries(p.price.map((r) => [r.key, r]));
  assert.deepEqual(Object.keys(price), ["upTo6", "upTo9", "upTo15", "upTo25", "over25"]);
  assert.equal(price.upTo6.cells, MIN_CELLS);
  assert.equal(price.upTo6.change, 5);
  assert.ok(price.upTo6.low <= 5 && price.upTo6.high >= 5);
  assert.equal(price.over25.change, 20);
  assert.equal(price.upTo25.cells, MIN_CELLS - 1);
  assert.equal(price.upTo25.change, null);
  assert.equal(price.upTo9.cells, 0);
  const age = Object.fromEntries(p.age.map((r) => [r.key, r]));
  assert.equal(age.under10.change, 5);
  assert.equal(age.over30.change, 20);
  assert.equal(age.y10to29.change, null);
  assert.deepEqual(p.grid.rows.upTo6, [MIN_CELLS, 0, 0]);
  assert.deepEqual(p.grid.rows.over25, [0, 0, MIN_CELLS + 10]);
});

/** 면적대별로 칸을 달리 둔 픽스처 - 면적마다 칸 수가 다르고, 변화율도 다르다. */
const AREA_FIXTURE = [
  ...FILL,
  ...cellsOf("소", MIN_CELLS, 50_000, 0.3, 2020).map((r) => ({ ...r, excluUseAr: 59 })),
  ...cellsOf("중", MIN_CELLS + 5, 80_000, 0.15, 2010).map((r) => ({ ...r, excluUseAr: 84.97 })),
  ...cellsOf("준대", MIN_CELLS, 120_000, 0.1, 2005).map((r) => ({ ...r, excluUseAr: 135 })),
  ...cellsOf("대", MIN_CELLS - 1, 300_000, 0.02, 1995).map((r) => ({ ...r, excluUseAr: 200 })),
];

test("면적 집계: 구간마다 칸 수·변화·90% 구간, 문턱(MIN_CELLS) 아래(>135㎡)는 값 없이 칸 수만 - 합치지 않는다", () => {
  const p = buildSegmentPayload({ items: AREA_FIXTURE, now: NOW });
  assert.deepEqual(p.area.map((r) => r.key), ["upTo60", "a60to85", "a85to135", "over135"]);
  const area = Object.fromEntries(p.area.map((r) => [r.key, r]));
  assert.equal(area.upTo60.cells, MIN_CELLS);
  assert.equal(area.upTo60.change, 30);
  assert.ok(area.upTo60.low <= 30 && area.upTo60.high >= 30);
  assert.equal(area.a60to85.cells, MIN_CELLS + 5);
  assert.equal(area.a60to85.change, 15);
  assert.equal(area.a85to135.cells, MIN_CELLS); // 135㎡ 는 아래 대
  assert.equal(area.a85to135.change, 10);
  assert.equal(area.over135.cells, MIN_CELLS - 1);
  assert.equal(area.over135.change, null);
  assert.equal(area.over135.low, undefined);
  assert.equal(p.area.reduce((a, r) => a + r.cells, 0), p.cells);
});

test("price·age·pairs·grid 는 면적과 무관 - 면적을 모두 바꿔도 값·모양이 그대로(#697 이 읽는다), area 만 늘었다", () => {
  const moved = FIXTURE.map((r) => ({ ...r, excluUseAr: r.excluUseAr === 84 ? 140 : r.excluUseAr }));
  const a = buildSegmentPayload({ items: FIXTURE, now: NOW });
  const b = buildSegmentPayload({ items: moved, now: NOW });
  for (const k of ["price", "age", "pairs", "grid", "cells", "noBuildYear", "periods", "ageRefYear", "minCells"]) {
    assert.equal(JSON.stringify(a[k]), JSON.stringify(b[k]), k);
  }
  assert.notEqual(JSON.stringify(a.area), JSON.stringify(b.area));
  assert.deepEqual(Object.keys(a.pairs), ["price", "age"]);
  assert.deepEqual(Object.keys(a.price[0]), ["key", "ko", "en", "cells", "change", "low", "high"]);
  assert.deepEqual(Object.keys(a.area[1]), Object.keys(a.price[0])); // 값을 낸 행은 price 와 같은 모양
});

test("구간 쌍 판정은 pairVerdicts 그대로 - 값을 낸 구간끼리만, 구간이 안 겹칠 때만 말할 수 있음", () => {
  const p = buildSegmentPayload({ items: FIXTURE, now: NOW });
  assert.deepEqual(p.pairs.price, { "upTo6-over25": true });
  assert.deepEqual(p.pairs.age, { "under10-over30": true });
  // 같은 변화라면 갈라 볼 수 없다.
  const same = [...FILL, ...cellsOf("가", MIN_CELLS, 50_000, 0.1, 2020), ...cellsOf("나", MIN_CELLS, 300_000, 0.1, 1990)];
  assert.deepEqual(buildSegmentPayload({ items: same, now: NOW }).pairs.price, { "upTo6-over25": false });
});

test("결정적: 원본 순서가 바뀌어도 같은 결과(다시 뽑기 씨앗 고정)", () => {
  const a = buildSegmentPayload({ items: FIXTURE, now: NOW });
  const b = buildSegmentPayload({ items: [...FIXTURE].reverse(), now: NOW });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("두 시기를 정할 원본이 모자라면 null", () => {
  assert.equal(buildSegmentPayload({ items: [item("가", 84, "202607", 50_000)], now: NOW }), null);
});

async function tmpDir() {
  return mkdtemp(path.join(os.tmpdir(), "segment-change-"));
}

test("쓰기: 허용된 이름 하나만 쓰고 임시 파일을 남기지 않는다", async () => {
  const dir = await tmpDir();
  try {
    const logs = [];
    assert.equal(await writeSegmentChangeSoft({ items: FIXTURE, now: NOW, file: path.join(dir, SEGMENT_CHANGE_NAME), log: (s) => logs.push(s) }), true);
    assert.deepEqual(await readdir(dir), [SEGMENT_CHANGE_NAME]);
    // 다른 이름은 거절한다 - 경고만, 아무것도 쓰지 않는다.
    assert.equal(await writeSegmentChangeSoft({ items: FIXTURE, now: NOW, file: path.join(dir, "district-change.json"), log: (s) => logs.push(s) }), false);
    assert.deepEqual(await readdir(dir), [SEGMENT_CHANGE_NAME]);
    assert.match(logs.at(-1), /^::warning::.*허용되지 않은 출력 경로/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("soft-fail: 생성이 던지거나 원본이 모자라도 ::warning·안내만 남기고 이전 파일을 그대로 둔다", async () => {
  const dir = await tmpDir();
  try {
    const file = path.join(dir, SEGMENT_CHANGE_NAME);
    await writeFile(file, "PREVIOUS");
    const logs = [];
    const boom = () => {
      throw new Error("boom");
    };
    assert.equal(await writeSegmentChangeSoft({ items: FIXTURE, now: NOW, file, log: (s) => logs.push(s), build: boom }), false);
    assert.match(logs.at(-1), /^::warning::가격대·연식 변화 생성 실패 - 이전 파일을 그대로 둡니다: boom/);
    assert.equal(await writeSegmentChangeSoft({ items: [], now: NOW, file, log: (s) => logs.push(s) }), false);
    assert.equal(await readFile(file, "utf8"), "PREVIOUS");
    assert.deepEqual(await readdir(dir), [SEGMENT_CHANGE_NAME]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Daily 등록은 build-district-change 안 soft-fail 호출 하나 - 갈아타기 파일을 쓴 뒤에 부른다", async () => {
  const src = await readFile(path.join(root, "scripts/build-district-change.ts"), "utf8");
  const calls = [...src.matchAll(/writeSegmentChangeSoft\(/g)];
  assert.equal(calls.length, 1);
  assert.ok(src.indexOf("await writeFile(outFile") < src.indexOf("await writeSegmentChangeSoft("));
});

test("공개 파일: 10 KB 이하, 집계만(단지명 0), 금지어 0", async () => {
  const body = await readFile(path.join(root, "docs/data", SEGMENT_CHANGE_NAME), "utf8");
  assert.ok(Buffer.byteLength(body) <= 10 * 1024, `${Buffer.byteLength(body)} B`);
  assert.doesNotMatch(body, /오를|내릴|전망/);
  assert.doesNotMatch(body, /aptNm|"cell"|\d{5}\|/); // 칸·단지 키가 새지 않는다
  const j = JSON.parse(body);
  assert.deepEqual(j.price.map((r) => r.key), ["upTo6", "upTo9", "upTo15", "upTo25", "over25"]);
  assert.deepEqual(j.age.map((r) => r.key), ["under10", "y10to29", "over30"]);
  assert.deepEqual(j.area.map((r) => r.key), ["upTo60", "a60to85", "a85to135", "over135"]);
  assert.ok(j.area.reduce((a, r) => a + r.cells, 0) <= j.cells);
  assert.deepEqual(Object.keys(j).sort(), ["age", "ageRefYear", "area", "cells", "grid", "minCells", "noBuildYear", "pairs", "periods", "price", "updatedAt"]);
});
