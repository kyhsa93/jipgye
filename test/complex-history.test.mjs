import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  GZIP_BUDGET,
  HISTORY_MONTHS,
  buildComplexHistorySoft,
  buildHistoryFiles,
  districtHistory,
  fitBudget,
  gzipSize,
  median,
  writeComplexHistory,
} from "../scripts/build-complex-history.ts";
import { marketDeal } from "../scripts/complex-price.ts";

const root = path.resolve(import.meta.dirname, "..");
const now = new Date("2026-10-26T00:00:00Z");

const item = (over = {}) => ({
  sggCd: 11680,
  aptNm: "가단지",
  excluUseAr: 84.98,
  dealAmount: "100,000",
  dealYear: 2026,
  dealMonth: 6,
  dealDay: 15,
  dealingGbn: "중개거래",
  cdealType: "",
  ...over,
});
const deal = (over) => marketDeal(item(over));

test("median: 홀수는 가운데, 짝수는 가운데 둘의 평균(반올림)", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([100000, 100001]), 100001);
  assert.equal(median([5]), 5);
});

test("districtHistory: 24개월 창 밖 거래는 버리고, 달마다 [달, 중앙값, 건수]", () => {
  const months = ["202411", "202412", "202610"];
  const cells = districtHistory(
    [
      deal({ dealYear: 2024, dealMonth: 10, dealAmount: "1" }), // 창 앞
      deal({ dealYear: 2024, dealMonth: 11, dealAmount: "90,000" }),
      deal({ dealYear: 2026, dealMonth: 10, dealAmount: "100,000" }),
      deal({ dealYear: 2026, dealMonth: 10, dealAmount: "110,000" }),
      deal({ dealYear: 2026, dealMonth: 11, dealAmount: "999,999" }), // 창 뒤
    ],
    months
  );
  assert.deepEqual(cells, { 가단지: { 84.98: [["202411", 90000, 1], ["202610", 105000, 2]] } });
});

test("districtHistory: 1㎡ 안쪽 면적은 complex-price 와 같은 한 칸(거래 많은 면적 이름)", () => {
  const cells = districtHistory(
    [deal({ excluUseAr: 84.98 }), deal({ excluUseAr: 84.98 }), deal({ excluUseAr: 84.95 }), deal({ excluUseAr: 59.9 })],
    ["202606"]
  );
  assert.deepEqual(Object.keys(cells.가단지).map(Number).sort((a, b) => a - b), [59.9, 84.98]);
  assert.deepEqual(cells.가단지["84.98"], [["202606", 100000, 3]]);
});

test("districtHistory: 칸 이름은 위치 칸 이름 가운데 1㎡ 안쪽 가장 가까운 것, 남는 거래만 따로 묶음", () => {
  // 24개월로 묶으면 84.95가 많아 묶음 이름이 84.95지만, 위치(183일) 칸은 84.98이다.
  const deals = [84.95, 84.95, 84.95, 84.98, 59.9].map((a) => deal({ excluUseAr: a }));
  assert.deepEqual(Object.keys(districtHistory(deals, ["202606"]).가단지).sort(), ["59.9", "84.95"]);
  const cells = districtHistory(deals, ["202606"], new Map([["가단지", [84.98]]]));
  assert.deepEqual(Object.keys(cells.가단지).sort(), ["59.9", "84.98"]);
  assert.equal(cells.가단지["84.98"][0][2], 4);
});

test("buildHistoryFiles: 해제·직거래는 빼고 창은 이번 달 포함 24개월", () => {
  const files = buildHistoryFiles({
    itemsByDistrict: {
      11680: [item(), item({ dealingGbn: "직거래", dealAmount: "1" }), item({ cdealType: "O", dealAmount: "1" })],
    },
    now,
  });
  assert.equal(HISTORY_MONTHS, 24);
  const f = files.gangnam;
  assert.equal(f.from, "202411");
  assert.equal(f.to, "202610");
  assert.equal(f.trimmed, 0);
  assert.deepEqual(f.cells.가단지["84.98"], [["202606", 100000, 1]]);
  assert.equal(Object.keys(files).length, 1, "거래 없는 구는 파일을 내지 않는다");
});

test("fitBudget: 예산을 넘치면 거래가 적은 칸부터 덜어 내고 수를 적는다", () => {
  const cells = {};
  for (let i = 0; i < 300; i++) {
    const series = Array.from({ length: 24 }, (_, m) => [`2025${String(m).padStart(2, "0")}`, 100000 + i * 37 + m * 11, (i % 7) + 1]);
    cells[`단지${i}`] = { 84.98: series };
  }
  const file = { district: "강남구", trimmed: 0, cells };
  const budget = Math.floor(gzipSize(file) / 2);
  const fit = fitBudget(file, budget);
  assert.ok(gzipSize(fit) <= budget);
  assert.ok(fit.trimmed > 0);
  assert.equal(Object.keys(fit.cells).length, 300 - fit.trimmed);
  const total = (s) => s.reduce((a, [, , n]) => a + n, 0);
  const kept = Object.values(fit.cells).map((a) => total(a["84.98"]));
  const dropped = Object.keys(cells).filter((k) => !fit.cells[k]).map((k) => total(cells[k]["84.98"]));
  assert.ok(Math.min(...kept) >= Math.max(...dropped), "남긴 칸이 덜어 낸 칸보다 거래가 적지 않다");
  assert.equal(fitBudget(file, gzipSize(file)), file, "예산 안이면 그대로");
});

test("writeComplexHistory: 원본 폴더를 읽어 구 파일을 쓴다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "complex-history-"));
  try {
    await mkdir(path.join(dir, "raw/sale"), { recursive: true });
    await writeFile(path.join(dir, "raw/sale/11680-202606.json"), JSON.stringify({ items: [item(), item({ dealAmount: "120,000" })] }));
    await writeFile(path.join(dir, "raw/sale/11680-202607.json"), JSON.stringify({ ok: false, items: [item({ dealMonth: 7 })] }));
    const sizes = await writeComplexHistory({ dataDir: path.join(dir, "data"), rawDir: path.join(dir, "raw"), now });
    assert.deepEqual(Object.keys(sizes), ["gangnam"]);
    const file = JSON.parse(await readFile(path.join(dir, "data/complex-history-gangnam.json"), "utf8"));
    assert.deepEqual(file.cells.가단지["84.98"], [["202606", 110000, 2]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildComplexHistorySoft: 실패해도 던지지 않고 false", async () => {
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(await buildComplexHistorySoft({}, async () => { throw new Error("원본 없음"); }), false);
    assert.equal(await buildComplexHistorySoft({}, async () => ({ gangnam: 1024 })), true);
  } finally {
    console.log = log;
  }
});

test("build-complex-price 진입점: 추이를 soft-fail 로 이어 부른다", async () => {
  const src = await readFile(path.join(root, "scripts/build-complex-price.ts"), "utf8");
  assert.match(src, /import \{ buildComplexHistorySoft \} from "\.\/build-complex-history\.ts"/);
  assert.match(src, /finally \{\s*await history\(\{ dataDir \}\);/);
});

test("커밋된 파일: 중앙값이 있는 complex-price 칸은 모두 같은 이름의 추이 칸이 있다", async () => {
  const dataDir = path.join(root, "docs/data");
  const names = (await readdir(dataDir)).filter((f) => /^complex-price-[a-z]+\.json$/.test(f));
  assert.ok(names.length > 0);
  const missing = [];
  let total = 0;
  for (const name of names) {
    const price = JSON.parse(await readFile(path.join(dataDir, name), "utf8"));
    const history = JSON.parse(await readFile(path.join(dataDir, name.replace("complex-price-", "complex-history-")), "utf8"));
    for (const [apt, areas] of Object.entries(price.cells)) {
      for (const [area, cell] of Object.entries(areas)) {
        if (!cell.median) continue;
        total += 1;
        if (!history.cells[apt]?.[area]) missing.push(`${name} ${apt} ${area}`);
      }
    }
  }
  assert.ok(total > 0);
  assert.deepEqual(missing, []);
});

test("커밋된 complex-history-*.json: 구당 gzip 40 KB 안, 달마다 건수", async () => {
  const dataDir = path.join(root, "docs/data");
  const names = (await readdir(dataDir)).filter((f) => /^complex-history-[a-z]+\.json$/.test(f));
  assert.equal(names.length, 25);
  for (const name of names) {
    const buf = await readFile(path.join(dataDir, name));
    assert.ok(gzipSync(buf).length <= GZIP_BUDGET, `${name} gzip ${gzipSync(buf).length}`);
    const file = JSON.parse(buf);
    const [apt, areas] = Object.entries(file.cells)[0];
    const series = Object.values(areas)[0];
    assert.ok(apt && series.length >= 1);
    for (const [m, med, n] of series) {
      assert.ok(m >= file.from && m <= file.to);
      assert.ok(med > 0 && Number.isInteger(n) && n >= 1);
    }
  }
});

// #920 - 추이도 complex-price 와 같은 읽기 층(재수집 덧씌움, #861)을 읽는다. 아래 두 시험의 입력은 손으로 만든 슬롯·덧씌움이다(#8).
const recollectNow = new Date("2026-11-16T02:42:23.254Z");

/** 강남구(11680) 두 달 슬롯, 그 가운데 202606 슬롯에 덧씌움(appeared 에만 있는 나단지 두 줄)을 만든다. writeOverlay 는 부른 쪽이 정한다. */
async function recollectFixture(dir) {
  const { buildSlotFile, readSlotFile, writeSlotFile } = await import("../scripts/realestate-raw.ts");
  const { buildOverlay } = await import("../scripts/realestate-recollect.ts");
  const raw = path.join(dir, "raw");
  const stored = {
    202605: [item({ dealMonth: 5 }), item({ dealMonth: 5, dealDay: 20, dealAmount: "104,000" })],
    202606: [item(), item({ dealDay: 3, dealAmount: "120,000" }), item({ aptNm: "다단지", excluUseAr: 59.9, dealAmount: "80,000" })],
  };
  for (const [yearMonth, items] of Object.entries(stored)) {
    await writeSlotFile(buildSlotFile({ kind: "sale", code: "11680", yearMonth, items, observedAt: "2026-08-17T00:00:00.000Z" }), raw);
  }
  const slot = await readSlotFile("sale", "11680", "202606", raw);
  const fetched = [...stored[202606], item({ aptNm: "나단지", excluUseAr: 59.97, dealDay: 9, dealAmount: "90,000" }), item({ aptNm: "나단지", excluUseAr: 59.97, dealDay: 21, dealAmount: "94,000" })];
  const overlay = buildOverlay({ slot, items: buildSlotFile({ kind: "sale", code: "11680", yearMonth: "202606", items: fetched, observedAt: "2026-11-15T11:36:00.000Z" }).items, totalCount: fetched.length, observedAt: "2026-11-15T11:36:00.000Z" });
  assert.equal(overlay.appeared.length, 2, "픽스처: 나단지 두 줄은 덧씌움 appeared 에만 있다");
  assert.equal(overlay.changed.length + overlay.gone.length, 0);
  // 같은 Daily 의 complex-price 가 덧씌움을 읽어 낸 칸(나단지 포함). 칸 이름은 이 파일에서 온다.
  const data = path.join(dir, "data");
  await mkdir(data, { recursive: true });
  const priceCells = { 가단지: { 84.98: { median: 110000, n: 2 } }, 나단지: { 59.97: { median: 92000, n: 2 } }, 다단지: { 59.9: { median: 80000, n: 1 } } };
  await writeFile(path.join(data, "complex-price-gangnam.json"), `${JSON.stringify({ district: "강남구", cells: priceCells })}\n`);
  return { raw, data, overlay, priceCells };
}

test("writeComplexHistory: 덧씌움 appeared 에만 있는 단지도 추이 칸이 생긴다(#920)", async () => {
  const { writeOverlay } = await import("../scripts/realestate-recollect.ts");
  const dir = await mkdtemp(path.join(tmpdir(), "complex-history-recollect-"));
  try {
    const { raw, data, overlay, priceCells } = await recollectFixture(dir);
    assert.equal(await writeOverlay("11680", "202606", overlay, raw), true);
    await writeComplexHistory({ dataDir: data, rawDir: raw, now: recollectNow });
    const file = JSON.parse(await readFile(path.join(data, "complex-history-gangnam.json"), "utf8"));
    assert.deepEqual(file.cells.나단지, { 59.97: [["202606", 92000, 2]] });
    // 144행 시험과 같은 단언: 중앙값이 있는 위치 칸마다 같은 이름의 추이 칸.
    const missing = Object.entries(priceCells).flatMap(([apt, areas]) => Object.keys(areas).filter((area) => !file.cells[apt]?.[area]).map((area) => `${apt} ${area}`));
    assert.deepEqual(missing, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeComplexHistory: 덧씌움이 없거나 낡았으면 저장 슬롯만 읽은 것과 바이트가 같다(#920, #861 조건 2)", async () => {
  const { readSameNames, readSlotFile } = await import("../scripts/realestate-raw.ts");
  const { overlayPath, writeOverlay } = await import("../scripts/realestate-recollect.ts");
  const { DISTRICTS } = await import("../scripts/realestate-districts.ts");
  const { recentMonths } = await import("../scripts/realestate-source.ts");
  const dir = await mkdtemp(path.join(tmpdir(), "complex-history-recollect-"));
  try {
    const { raw, data, overlay, priceCells } = await recollectFixture(dir);
    // 기대 바이트: 고치기 전 경로와 같은 계산(readSlotFile → buildHistoryFiles → JSON 한 줄).
    const itemsByDistrict = {};
    for (const { code } of DISTRICTS) {
      const files = await Promise.all(recentMonths(recollectNow, HISTORY_MONTHS).map((m) => readSlotFile("sale", code, m, raw)));
      itemsByDistrict[code] = files.filter((f) => f?.ok !== false && Array.isArray(f?.items)).flatMap((f) => f.items);
    }
    const expected = buildHistoryFiles({ itemsByDistrict, now: recollectNow, priceCells: { gangnam: priceCells }, sameNames: await readSameNames(raw) });
    assert.deepEqual(Object.keys(expected), ["gangnam"]);
    const want = `${JSON.stringify(expected.gangnam)}\n`;
    assert.equal(JSON.parse(want).cells.나단지, undefined);

    // (i) 덧씌움 폴더가 없다.
    await writeComplexHistory({ dataDir: data, rawDir: raw, now: recollectNow });
    assert.equal(await readFile(path.join(data, "complex-history-gangnam.json"), "utf8"), want);

    // (ii) 덧씌움이 낡았다(base.count 불일치 → mergeRecollect 가 슬롯을 그대로 돌려준다).
    await writeOverlay("11680", "202606", { ...overlay, base: { ...overlay.base, count: overlay.base.count + 1 } }, raw);
    assert.ok(JSON.parse(await readFile(overlayPath("11680", "202606", raw), "utf8")).appeared.length === 2, "낡은 덧씌움 파일이 실제로 있다");
    await rm(path.join(data, "complex-history-gangnam.json"));
    await writeComplexHistory({ dataDir: data, rawDir: raw, now: recollectNow });
    assert.equal(await readFile(path.join(data, "complex-history-gangnam.json"), "utf8"), want);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
