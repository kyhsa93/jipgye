import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MIN_CELLS,
  MIN_DEALS,
  PARTIAL_MONTHS,
  cellGap,
  closedShare,
  dealKind,
  directDealStats,
  monthlyShare,
} from "../scripts/direct-deals.ts";
import { MIN_DEALS as COMPLEX_MIN_DEALS } from "../scripts/complex-price.ts";
import { MIN_CELLS as FLOOR_MIN_CELLS } from "../scripts/floor-gap.ts";
import { buildPayload, tryWriteDirectDeals } from "../scripts/build-direct-deals.ts";

const MONTHS = ["202608", "202609", "202610"];
const DISTRICTS = [{ name: "노원구" }, { name: "강남구" }];

const deal = (extra = {}) => ({
  sggCd: 11350,
  aptNm: "가단지",
  excluUseAr: 84.9,
  dealYear: 2026,
  dealMonth: 8,
  dealAmount: "100,000",
  dealingGbn: "중개거래",
  cdealType: "",
  ...extra,
});
const direct = (extra = {}) => deal({ dealingGbn: "직거래", ...extra });

test("문턱은 기존 상수를 그대로 쓴다 - 새 문턱 0 (#691 판정)", () => {
  assert.equal(MIN_DEALS, COMPLEX_MIN_DEALS);
  assert.equal(MIN_CELLS, FLOOR_MIN_CELLS);
  assert.equal(PARTIAL_MONTHS, 2);
});

test("거래 형태: 해제·빈 표시·낯선 표시는 세지 않는다", () => {
  assert.equal(dealKind(direct()), "direct");
  assert.equal(dealKind(deal()), "brokered");
  assert.equal(dealKind(direct({ cdealType: "O" })), null);
  assert.equal(dealKind(deal({ dealingGbn: "" })), null);
  assert.equal(dealKind(deal({ dealingGbn: "기타" })), null);
});

test("월별 비중: 거래 0건인 달은 0이 아니라 null", () => {
  const s = monthlyShare([deal(), deal(), deal(), direct(), deal({ dealMonth: 10 })], MONTHS);
  assert.deepEqual(s.deals, [4, 0, 1]);
  assert.deepEqual(s.direct, [1, 0, 0]);
  assert.deepEqual(s.share, [25, null, 0]);
});

test("칸 격차: 양쪽 각각 MIN_DEALS 이상일 때만", () => {
  assert.equal(cellGap([80000, 80000], [100000, 100000, 100000]), null, "직거래 2건");
  assert.equal(cellGap([80000, 80000, 80000], [100000, 100000]), null, "중개 2건");
  assert.ok(Math.abs(cellGap([80000, 90000, 70000], [100000, 100000, 100000]) + 20) < 1e-9);
});

test("덜 찬 달은 비중 합계에서 뺀다", () => {
  const series = { deals: [10, 10, 10], direct: [1, 5, 9] };
  assert.equal(closedShare(series, [false, true, true]), 10);
  assert.equal(closedShare(series, [true, true, true]), null);
});

test("자치구가 MIN_CELLS 칸에 못 미치면 격차를 비우고 칸 수만 남긴다", () => {
  const cells = (n, district) =>
    Array.from({ length: n }, (_, k) => [
      ...[0, 1, 2].map(() => direct({ aptNm: `단지${k}`, sggCd: district, dealAmount: "90,000" })),
      ...[0, 1, 2].map(() => deal({ aptNm: `단지${k}`, sggCd: district })),
    ]).flat();
  const stats = directDealStats({ 노원구: cells(MIN_CELLS, 11350), 강남구: cells(MIN_CELLS - 1, 11680) }, MONTHS, DISTRICTS);
  assert.equal(stats.districts["노원구"].gap.cells, MIN_CELLS);
  assert.equal(stats.districts["노원구"].gap.median, -10);
  assert.deepEqual([stats.districts["노원구"].gap.low, stats.districts["노원구"].gap.high], [-10, -10]);
  assert.equal(stats.districts["노원구"].gap.lowerShare, 100);
  assert.equal(stats.districts["강남구"].gap.cells, MIN_CELLS - 1);
  assert.equal(stats.districts["강남구"].gap.median, null);
  assert.equal(stats.seoul.gap.cells, MIN_CELLS * 2 - 1);
  assert.deepEqual(Object.keys(stats.districts), ["강남구", "노원구"], "가나다순");
  assert.deepEqual(stats.partial, [false, true, true]);
});

test("원본이 없는 구도 빈 줄로 남는다", () => {
  const stats = directDealStats({ 노원구: [deal()] }, MONTHS, DISTRICTS);
  assert.deepEqual(stats.districts["강남구"].share, [null, null, null]);
  assert.equal(stats.districts["강남구"].gap.cells, 0);
});

test("출력에 단지명·칸 키·건별 금액이 없다", () => {
  const items = [0, 1, 2].flatMap(() => [direct({ aptNm: "비밀단지", dealAmount: "77,777" }), deal({ aptNm: "비밀단지", dealAmount: "123,456" })]);
  const json = JSON.stringify(buildPayload({ byDistrict: { 노원구: items }, months: MONTHS, now: new Date("2026-10-26T00:00:00Z") }));
  assert.ok(!json.includes("비밀단지"));
  assert.ok(!json.includes("84.9"));
  assert.ok(!json.includes("77777") && !json.includes("123456"));
});

test("원본이 비면 payload 없음", () => {
  assert.equal(buildPayload({ byDistrict: {}, months: MONTHS, now: new Date() }), null);
});

test("소프트 실패: 계산이 던져도 null 을 돌려주고 파일을 쓰지 않는다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "direct-deals-"));
  const file = path.join(dir, "direct-deals.json");
  const prev = process.env.DIRECT_DEALS_FILE;
  process.env.DIRECT_DEALS_FILE = file;
  try {
    const bad = { 노원구: [deal()] };
    assert.equal(await tryWriteDirectDeals({ byDistrict: bad, months: null, now: new Date() }), null);
    assert.equal(existsSync(file), false);
    const ok = await tryWriteDirectDeals({ byDistrict: bad, months: MONTHS, now: new Date("2026-10-26T00:00:00Z") });
    assert.equal(ok.seoul.deals[0], 1);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).seoul.deals[0], 1);
  } finally {
    if (prev === undefined) delete process.env.DIRECT_DEALS_FILE;
    else process.env.DIRECT_DEALS_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("해제 빌더가 직거래 빌더를 소프트 실패로 부른다 - 빌더 등록 줄은 늘리지 않는다", () => {
  const src = readFileSync(new URL("../scripts/build-cancellation.ts", import.meta.url), "utf8");
  assert.match(src, /await tryWriteDirectDeals\(/);
  for (const f of ["../scripts/update-all.mjs", "../.github/workflows/daily-update.yml"]) {
    assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes("build-direct-deals"), f);
  }
});
