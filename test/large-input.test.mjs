import test from "node:test";
import assert from "node:assert/strict";
import { settledMonths } from "../scripts/cancel-by-price.mjs";
import { buildPayload } from "../scripts/build-record-high.mjs";

// raw/sale 전체가 13만 건을 넘기며 Math.max(...배열)이 RangeError를 냈다(#97).
// 건수가 더 늘어도 깨지지 않게 20만 건으로 못 박는다.
const N = 200_000;
const item = (i) => ({
  sggCd: "11110", aptNm: `단지${i % 500}`, excluUseAr: "84", floor: String(1 + (i % 20)),
  dealYear: 2026, dealMonth: 1 + (i % 9), dealDay: 1 + (i % 28), dealAmount: String(50_000 + (i % 1000)),
  dealingGbn: "중개거래", cdealType: i % 20 === 0 ? "O" : "", cdealDay: i % 20 === 0 ? "26.09.30" : "",
});

test("settledMonths는 20만 건에서도 스택이 터지지 않는다", () => {
  const items = Array.from({ length: N }, (_, i) => item(i));
  const s = settledMonths(items);
  assert.ok(Array.isArray(s.months));
});

test("record-high buildPayload는 20만 건에서도 스택이 터지지 않는다", () => {
  const items = Array.from({ length: N }, (_, i) => item(i));
  const p = buildPayload({ items, now: new Date("2026-10-10T00:00:00Z") });
  assert.equal(p.end, "2026-09-28");
});
