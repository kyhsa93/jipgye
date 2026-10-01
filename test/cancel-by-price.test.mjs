import test from "node:test";
import assert from "node:assert/strict";
import { priceBandSentence, priceBandStats, settledMonths } from "../scripts/cancel-by-price.mjs";

/** 계약 y-m-15, 해제면 cancelAfter일 뒤 해제. */
const deal = (y, m, amount, cancelAfter = null) => {
  const c = cancelAfter === null ? null : new Date(Date.UTC(y, m - 1, 15 + cancelAfter));
  return {
    dealYear: y, dealMonth: m, dealDay: 15, dealAmount: String(amount),
    cdealType: c ? "O" : "",
    cdealDay: c ? `${String(c.getUTCFullYear()).slice(2)}.${String(c.getUTCMonth() + 1).padStart(2, "0")}.${String(c.getUTCDate()).padStart(2, "0")}` : "",
  };
};
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test("해제가 다 쌓인 달만 센다 — 최근 달은 아직 덜 쌓였다", () => {
  const items = [...many(100, (i) => deal(2026, 1, 50_000, i < 10 ? 60 : null)), ...many(100, () => deal(2026, 9, 50_000))];
  const s = settledMonths(items);
  assert.equal(s.settleDays, 60);
  assert.deepEqual(s.months, ["202601"], "해제가 쌓일 시간이 안 된 9월을 셌다");
});

test("해제율이 높던 달에 비싼 거래가 몰렸을 뿐이면 '갈리지 않는다'고 적는다", () => {
  // 1월: 모두 비싸고 해제 10%. 2월: 모두 싸고 해제 2%. 그냥 세면 비싼 대가 높지만 같은 달 안에선 차이가 없다.
  const items = [
    ...many(500, (i) => deal(2026, 1, 300_000, i % 10 === 0 ? 30 : null)),
    ...many(500, (i) => deal(2026, 1, 50_000, i % 10 === 0 ? 30 : null)),
    ...many(1000, (i) => deal(2026, 2, 50_000, i % 50 === 0 ? 30 : null)),
    ...many(10, () => deal(2026, 9, 50_000)),
  ];
  const s = priceBandStats(items);
  assert.ok(s.rows.at(-1).rate > s.rows[0].rate, "그냥 세면 비싼 대가 높아야 이 검사가 뜻이 있다");
  assert.ok(Math.abs(s.gap.point) < 0.5);
  assert.match(priceBandSentence(s, "ko"), /가격대로 갈리지 않습니다/);
});

test("같은 달 안에서도 비싼 대가 높으면 그렇게 적는다", () => {
  const items = [
    ...many(1000, (i) => deal(2026, 1, 300_000, i % 10 === 0 ? 30 : null)),
    ...many(1000, (i) => deal(2026, 1, 50_000, i % 50 === 0 ? 30 : null)),
    ...many(10, () => deal(2026, 9, 50_000)),
  ];
  const s = priceBandStats(items);
  assert.ok(s.gap.low > 0);
  assert.match(priceBandSentence(s, "ko"), /비싼 집일수록 계약이 깨지는 일이 조금 더 잦습니다/);
});

test("차이가 있어 보여도 구간이 0을 품으면 말하지 않는다", () => {
  // 비싼 대 6%, 싼 대 4% - 점 추정은 +2%p지만 각 100건이라 흔들림이 그보다 크다.
  const items = [
    ...many(100, (i) => deal(2026, 1, 300_000, i % 50 < 3 ? 30 : null)),
    ...many(100, (i) => deal(2026, 1, 50_000, i % 50 < 2 ? 30 : null)),
    ...many(10, () => deal(2026, 9, 50_000)),
  ];
  const s = priceBandStats(items);
  assert.ok(s.gap.point > 1, "점 추정은 차이가 있어 보여야 이 검사가 뜻이 있다");
  assert.ok(s.gap.low <= 0);
  assert.match(priceBandSentence(s, "ko"), /가격대로 갈리지 않습니다/);
});
