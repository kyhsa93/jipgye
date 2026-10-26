// 전세가율 높고 값이 내린 칸(#690 N8) 데이터의 시험: 문턱 재사용·칸 맞물림·하락 판정·구 행 미달·서울 합·칸 이름 0·소프트 실패·등록.
// 오프라인 - 원본은 손으로 만든 줄과 임시 폴더의 complex-price 파일이다. 데이터 값·날짜로 갈리는 검사는 없다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MIN_CELLS, MIN_DEALS_PER_SIDE, cellRatioEntries, cellRatios } from "../scripts/complex-ratio.ts";
import { HIGH_RATIO, THRESHOLDS, buildRisk, districtCounts, priceLookup, riskRow } from "../scripts/jeonse-risk.ts";
import { MAX_FILE_BYTES, runJeonseRisk } from "../scripts/build-jeonse-risk.ts";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-26T00:00:00Z");
const APT = "가상단지";
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const sale = (amount, area = "84.97", apt = APT) => ({ aptNm: apt, excluUseAr: area, dealAmount: String(amount) });
const rent = (deposit, area = "84.97", apt = APT) => ({ aptNm: apt, excluUseAr: area, deposit: String(deposit), monthlyRent: "0", contractType: "신규" });

test("문턱은 complex-ratio 의 것을 그대로 쓴다 (새 숫자는 질문 정의 80% 하나)", () => {
  assert.deepEqual(THRESHOLDS, { dealsPerSide: MIN_DEALS_PER_SIDE, cells: MIN_CELLS, highRatio: 80 });
  assert.equal(HIGH_RATIO, 80);
});

test("cellRatioEntries 는 cellRatios 와 같은 칸을 칸 이름과 함께 낸다 (cellRatios 결과는 그대로)", () => {
  const sales = [...many(3, () => sale(100000)), ...many(3, () => sale(50000, "59.9")), ...many(2, () => sale(70000, "39"))];
  const rents = [...many(3, () => rent(85000)), ...many(3, () => rent(30000, "59.9")), ...many(3, () => rent(40000, "39"))];
  assert.deepEqual(cellRatios(sales, rents), [85, 60]);
  assert.deepEqual(cellRatioEntries(sales, rents), [
    { key: `${APT}|84.97`, ratio: 85 },
    { key: `${APT}|59.9`, ratio: 60 },
  ]);
});

test("단지 가격 위치의 묶인 면적(areas)은 하나하나 같은 칸으로 찾는다", () => {
  const cell = { n: 4, median: 1, raw: 1, areas: [84.95, 84.99] };
  const lookup = priceLookup({ [` ${APT} `]: { "84.99": cell } });
  assert.equal(lookup.get(`${APT}\u000084.95`), cell);
  assert.equal(lookup.get(`${APT}\u000084.99`), cell);
});

test("80% 이상 칸 가운데 1년 전 값이 있으면 견주고, 지금(raw)이 1년 전보다 낮을 때만 하락으로 센다", () => {
  const entries = [
    { key: `${APT}|84.97`, ratio: 85 }, // 하락
    { key: `${APT}|59.9`, ratio: 80 }, // 경계 포함, 상승
    { key: `${APT}|39`, ratio: 90 }, // 1년 전 값 없음
    { key: `${APT}|114.5`, ratio: 79.9 }, // 80% 미만, 하락이어도 안 셈
  ];
  const priceCells = {
    [APT]: {
      "84.97": { raw: 90000, yearAgo: { median: 100000 } },
      "59.9": { raw: 52000, yearAgo: { median: 50000 } },
      "39": { raw: 40000 },
      "114.5": { raw: 90000, yearAgo: { median: 120000 } },
    },
  };
  assert.deepEqual(districtCounts(entries, priceCells), { cells: 4, compared: 3, high: 3, highCompared: 2, highFell: 1 });
  assert.deepEqual(districtCounts(entries, null), { cells: 4, compared: 0, high: 3, highCompared: 0, highFell: 0 }, "가격 파일이 없어도 던지지 않는다");
});

test("구 행은 칸이 MIN_CELLS 미만이면 비율 없이 칸 수만 (「표본 부족(n=…)」)", () => {
  const base = { compared: 0, high: 0, highCompared: 0, highFell: 0 };
  assert.deepEqual(riskRow({ ...base, cells: MIN_CELLS - 1 }), { cells: MIN_CELLS - 1, short: true });
  const row = riskRow({ cells: MIN_CELLS, compared: 15, high: 5, highCompared: 4, highFell: 1 });
  assert.equal(row.short, undefined);
  assert.equal(row.highShare, 25);
  assert.equal(row.fellShare, null, "분모 4칸 < MIN_CELLS");
  assert.equal(riskRow({ ...base, cells: 40 }).fellShare, null, "견줄 칸이 없으면 0% 가 아니라 null");
});

test("모든 비율은 분모가 MIN_CELLS 미만이면 null (1/1=100% 가 json 에 남지 않는다, PR #701 판정)", () => {
  const one = riskRow({ cells: 55, compared: 36, high: 1, highCompared: 1, highFell: 1 });
  assert.equal(one.fellShare, null);
  assert.equal(one.highFell, 1, "건수는 남긴다");
  const edge = riskRow({ cells: 100, compared: 60, high: 30, highCompared: MIN_CELLS, highFell: 5 });
  assert.equal(edge.fellShare, 25, "분모가 정확히 MIN_CELLS 면 낸다");
  assert.equal(riskRow({ cells: 100, compared: 60, high: 30, highCompared: MIN_CELLS - 1, highFell: 5 }).fellShare, null);
});

test("서울 행은 미달 구까지 모두 더하고, json 에 단지명·칸 키가 없다", () => {
  const counts = (cells, high, highCompared, highFell) => ({ cells, compared: highCompared, high, highCompared, highFell });
  const payload = buildRisk({ byDistrict: { 가구: counts(30, 6, 4, 2), 나구: counts(5, 2, 2, 2) }, now: NOW, months: ["202605", "202610"] });
  assert.deepEqual(payload.seoul, { cells: 35, compared: 6, high: 8, highShare: 22.9, highCompared: 6, highFell: 4, fellShare: null });
  assert.deepEqual(payload.districts.나구, { cells: 5, short: true });
  assert.equal(payload.min, THRESHOLDS);
  assert.equal(buildRisk({ byDistrict: {}, now: NOW }), null);
});

test("빌더: 쓰는 파일에 단지명이 없고 한도 안이며, 실패하면 던지지 않고 어제 파일을 그대로 둔다", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "jeonse-risk-"));
  try {
    const file = path.join(tmp, "jeonse-risk.json");
    await writeFile(
      path.join(tmp, "complex-price-gangnam.json"),
      JSON.stringify({ cells: { [APT]: { "84.97": { raw: 90000, yearAgo: { median: 100000 } } } } })
    );
    const logs = [];
    const byDistrict = { 강남구: { sales: many(3, () => sale(100000)), rents: many(3, () => rent(85000)) } };
    const payload = await runJeonseRisk({ byDistrict, now: NOW, dir: tmp, file, log: (m) => logs.push(m) });
    assert.deepEqual(payload.districts.강남구, { cells: 1, short: true });
    assert.deepEqual(payload.seoul, { cells: 1, short: true }, "서울 행도 같은 문턱");
    const body = await readFile(file, "utf8");
    assert.ok(!body.includes(APT), "단지명이 새어 나갔다");
    assert.ok(Buffer.byteLength(body) <= MAX_FILE_BYTES);

    const warned = [];
    assert.equal(await runJeonseRisk({ byDistrict: { 강남구: null }, now: NOW, dir: tmp, file, log: (m) => warned.push(m) }), null);
    assert.match(warned[0], /^::warning::/);
    assert.equal(await readFile(file, "utf8"), body, "실패가 어제 파일을 건드렸다");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("등록: build-complex-ratio 의 main 끝에서 부르고(소프트 실패), update-all·daily-update 에는 줄이 없다", async () => {
  const src = await readFile(path.join(root, "scripts/build-complex-ratio.ts"), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  assert.match(main, /^\s*await runJeonseRisk\(\{ byDistrict, months: \[months\[0\], months\.at\(-1\)\], now \}\);$/m);
  for (const file of ["scripts/update-all.mjs", ".github/workflows/daily-update.yml"]) {
    assert.ok(!(await readFile(path.join(root, file), "utf8")).includes("jeonse-risk"), file);
  }
});

test("커밋된 jeonse-risk.json 은 한도 안이고 구 집계 키만 있다", async () => {
  const body = await readFile(path.join(root, "docs/data/jeonse-risk.json"), "utf8");
  assert.ok(Buffer.byteLength(body) <= MAX_FILE_BYTES);
  const data = JSON.parse(body);
  assert.deepEqual(Object.keys(data).sort(), ["districts", "min", "months", "seoul", "updatedAt"]);
  for (const row of [data.seoul, ...Object.values(data.districts)]) {
    for (const key of Object.keys(row)) assert.ok(["cells", "short", "compared", "high", "highShare", "highCompared", "highFell", "fellShare"].includes(key), key);
  }
});
