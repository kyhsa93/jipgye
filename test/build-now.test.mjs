import test from "node:test";
import assert from "node:assert/strict";
import { buildNowMs } from "../scripts/build-budget-pages.ts";

// #236: 예산대 빌더의 시각(`since` = 183일 전)을 BUILD_NOW로 고정할 수 있어야 하고, 미설정이면 전과 똑같아야 한다.
// 고정 값만 쓴다 — 오늘 날짜나 오늘의 docs/data에 기대지 않는다.

test("BUILD_NOW가 없거나 빈 문자열이면 Date.now()를 그대로 쓴다", (t) => {
  t.mock.method(Date, "now", () => 1_790_000_000_000);
  assert.equal(buildNowMs({}), 1_790_000_000_000);
  assert.equal(buildNowMs({ BUILD_NOW: "" }), 1_790_000_000_000);
});

test("BUILD_NOW가 있으면 Date.now()와 무관하게 그 시각이다", (t) => {
  t.mock.method(Date, "now", () => 1_790_000_000_000);
  assert.equal(buildNowMs({ BUILD_NOW: "2026-10-11T00:00:00Z" }), Date.UTC(2026, 9, 11));
  // 하루 다른 값은 하루 다른 since를 낸다(빌더가 쓰는 식 그대로).
  const since = (env) => new Date(buildNowMs(env) - 183 * 86400000).toISOString().slice(0, 10);
  assert.equal(since({ BUILD_NOW: "2026-10-11T00:00:00Z" }), "2026-04-11");
  assert.equal(since({ BUILD_NOW: "2026-10-12T00:00:00Z" }), "2026-04-12");
});

test("읽을 수 없는 BUILD_NOW는 현재 시각으로 넘기지 않고 멈춘다", () => {
  assert.throws(() => buildNowMs({ BUILD_NOW: "어제" }), /BUILD_NOW를 읽을 수 없습니다/);
});
