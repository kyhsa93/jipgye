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
