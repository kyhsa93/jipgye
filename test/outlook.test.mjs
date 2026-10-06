import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  MIN_OVERLAP,
  MIN_PAIRS,
  backtest,
  chainChanges,
  forecastCell,
  nowcast,
  predict,
  shiftMonth,
  toDeal,
  toSeries,
} from "../scripts/outlook.mjs";
import { backfillDrift, buildPayload, closedBefore, freezeScores, scoreLog, updateLog } from "../scripts/build-outlook.mjs";
import { coverageSummary, realtimeCoverage, recordSentence } from "../scripts/outlook.mjs";

const root = path.resolve(import.meta.dirname, "..");

/** 씨앗을 고정한 정규난수. 같은 검사가 날마다 다른 계열을 보면 안 된다. */
function noise(seed) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 2 ** 32;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** 월 변화가 phi만큼 이어지는 계열. phi=0이면 다음 달을 맞출 단서가 없다. */
function synthetic({ phi, months = 240, seed = 7, sd = 0.01 }) {
  const next = noise(seed);
  const rows = [];
  let level = Math.log(100);
  let r = 0;
  let month = "200601";
  for (let i = 0; i < months; i += 1) {
    r = phi * r + sd * next();
    level += r;
    rows.push([month, Math.exp(level)]);
    month = shiftMonth(month, 1);
  }
  return rows;
}

test("예측은 그 시점 뒤의 값을 보지 않는다", () => {
  const series = toSeries(synthetic({ phi: 0.6 }));
  const origin = 150;
  const before = predict(series.logs, origin, 3);

  // origin 뒤를 통째로 바꿔도 그 시점의 예측은 같아야 한다.
  const tampered = [...series.logs];
  for (let i = origin + 1; i < tampered.length; i += 1) tampered[i] += 5;
  assert.deepEqual(predict(tampered, origin, 3), before, "미래 값이 학습에 섞였다");
});

test("다음 달을 맞출 단서가 없는 계열에서는 값을 내지 않는다", () => {
  // 월 변화가 서로 독립이면 어떤 회귀도 "그대로다"를 꾸준히 이길 수 없다.
  const series = toSeries(synthetic({ phi: 0, seed: 11 }));
  const card = forecastCell(series, 3);
  assert.equal(card.beats, false, `우연을 실력으로 읽었다 (winShare ${card.winShare})`);
  assert.equal(card.forecast, null);
});

test("추세가 이어지는 계열에서는 값을 내고, 범위가 예측을 감싼다", () => {
  const series = toSeries(synthetic({ phi: 0.7, seed: 3 }));
  const card = forecastCell(series, 3);
  assert.equal(card.beats, true, `이어지는 추세를 못 잡았다 (winShare ${card.winShare})`);
  assert.ok(card.forecast.low <= card.forecast.change && card.forecast.change <= card.forecast.high);
  assert.equal(card.forecast.target, shiftMonth(series.months.at(-1), 3));
});

test("백테스트의 오차는 실제 - 예측이다", () => {
  const series = toSeries(synthetic({ phi: 0.5 }));
  const [row] = backtest(series, 3, "201501");
  const i = series.months.indexOf(row.origin);
  const actual = (series.logs[i + 3] - series.logs[i]) * 100;
  assert.ok(Math.abs(row.actual - actual) < 1e-9);
  assert.ok(Math.abs(row.naive - actual) < 1e-9, "'그대로다'의 오차는 실제 변화 그 자체다");
});

test("빠진 달이 있으면 거기서 계열을 끊는다", () => {
  const { months } = toSeries([
    ["202601", 100],
    ["202602", 101],
    ["202604", 103],
    ["202605", 104],
  ]);
  assert.deepEqual(months, ["202604", "202605"], "두 달치 변화를 한 달로 읽었다");
});

// --- 공식 지수가 아직 없는 달 ---------------------------------------------------

const deal = (month, cell, perM2) => ({ district: "11350", cell, month, perM2 });

test("맞물린 칸이 모자라면 그 달은 값을 내지 않는다", () => {
  const deals = [];
  for (let k = 0; k < MIN_PAIRS - 1; k += 1) deals.push(deal("202607", `c${k}`, 100), deal("202608", `c${k}`, 101));
  const [row] = chainChanges(deals, ["202607", "202608"]);
  assert.equal(row.pairs, MIN_PAIRS - 1);
  assert.equal(row.change, null);

  deals.push(deal("202607", "extra", 100), deal("202608", "extra", 101));
  assert.ok(chainChanges(deals, ["202607", "202608"])[0].change > 0);
});

function nowcastFixture({ gap, overlapMonths }) {
  // 공식 지수는 매달 +1%. 우리 칸은 매달 1% + gap만큼 오른다.
  const months = Array.from({ length: overlapMonths + 2 }, (_, k) => shiftMonth("202501", k));
  const official = toSeries(months.slice(0, -1).map((m, k) => [m, 100 * Math.exp(0.01 * k)]));
  const deals = [];
  for (let c = 0; c < MIN_PAIRS + 5; c += 1) {
    months.forEach((m, k) => deals.push(deal(m, `c${c}`, 100 * Math.exp((0.01 + gap / 100) * k))));
  }
  return { deals, months, official };
}

test("공식 지수와 견준 오차가 모델보다 크면 메우지 않는다", () => {
  const close = nowcast({ ...nowcastFixture({ gap: 0.2, overlapMonths: 8 }), oneMonthMae: 0.7 });
  assert.equal(close.usable, true);
  assert.equal(close.months.length, 1, "공식 지수가 없는 달만 실어야 한다");
  assert.ok(close.months[0].change !== null);
  assert.ok(Math.abs(close.bias - 0.2) < 0.01, "치우침을 빼서 맞추지 않고 그대로 적는다");

  const far = nowcast({ ...nowcastFixture({ gap: 0.9, overlapMonths: 8 }), oneMonthMae: 0.7 });
  assert.equal(far.usable, false);
  assert.equal(far.months[0].change, null, "더 못한 짐작으로 빈칸을 채웠다");
});

test("견준 달이 모자라면 메우지 않는다", () => {
  const few = nowcast({ ...nowcastFixture({ gap: 0.1, overlapMonths: MIN_OVERLAP - 2 }), oneMonthMae: 0.7 });
  assert.ok(few.overlap < MIN_OVERLAP);
  assert.equal(few.usable, false);
});

test("메우는 달은 신고 기한이 닫힌 달까지다", () => {
  // 10월 1일의 9월은 일찍 신고된 절반뿐이다.
  assert.equal(closedBefore(new Date("2026-10-01T03:00:00+09:00")), "202609");
});

test("해제된 거래는 메우는 데 쓰지 않는다", () => {
  const base = { sggCd: 11350, umdNm: "상계동", jibun: "1", aptNm: "가", excluUseAr: 59.9, dealAmount: "60,000", dealYear: 2026, dealMonth: 8 };
  assert.ok(toDeal(base));
  assert.equal(toDeal({ ...base, cdealType: "O" }), null);
});

// --- 실제로 낸 예측 ---------------------------------------------------------------

const region = (code, change) => ({
  code,
  cards: [{ h: 3, forecast: change === null ? null : { target: "202610", change, low: change - 3, high: change + 3 } }],
});

test("한 번 낸 예측은 다음 빌드가 덮어쓰지 않는다", () => {
  const first = updateLog(null, [region("200", 2.5)], "202607");
  const again = updateLog(first, [region("200", 9.9)], "202607");
  assert.equal(again.entries.length, 1);
  assert.equal(again.entries[0].change, 2.5, "지난 예측을 오늘 값으로 고쳤다");

  const next = updateLog(again, [region("200", 1.0)], "202608");
  assert.equal(next.entries.length, 2, "새 지수가 나온 달의 예측이 쌓이지 않았다");
});

test("값을 비운 칸은 예측으로 쌓지 않는다", () => {
  assert.equal(updateLog(null, [region("210", null)], "202607").entries.length, 0);
});

test("지수가 나온 예측만 채점한다", () => {
  const log = updateLog(null, [region("200", 2.5)], "202607");
  const early = { 200: toSeries([["202607", 100]]) };
  const pending = scoreLog(freezeScores(log, early, "2026-10-07"));
  assert.equal(pending.scored, 0);
  assert.equal(pending.pending.length, 1);

  const rows = [["202607", 100], ["202608", 101], ["202609", 102], ["202610", 110]];
  const scored = scoreLog(freezeScores(log, { 200: toSeries(rows) }, "2026-12-15"));
  assert.equal(scored.scored, 1);
  assert.equal(scored.recent[0].inside, false, "+9.5%를 -0.5~+5.5% 안이라고 했다");
});

// --- 채점값 얼리기 (#64) ------------------------------------------------------------
// 고정 입력: 첫 판 202610 = 110, 고친 두 번째 판 202610 = 104. 입력이 날짜·데이터에 안 흔들린다.

const FIRST = { 200: toSeries([["202607", 100], ["202608", 101], ["202609", 102], ["202610", 110]]) };
const REVISED = { 200: toSeries([["202607", 100], ["202608", 101], ["202609", 102], ["202610", 104]]) };
const withDrift = () => {
  const log = updateLog(null, [{ code: "200", cards: [{ h: 3, forecast: { target: "202610", change: 2.5, drift: 1.5, low: -0.5, high: 5.5 } }] }], "202607");
  return log;
};

test("고친 두 번째 판을 넣어도 actual은 첫 판 값이다", () => {
  const first = freezeScores(withDrift(), FIRST, "2026-12-15");
  const [entry] = first.entries;
  assert.equal(entry.actual, 9.53, "첫 판의 +9.53%(ln 1.10)가 아니다");
  assert.equal(entry.scoredOn, "2026-12-15");

  const second = freezeScores(first, REVISED, "2027-01-20");
  assert.equal(second.entries[0].actual, 9.53, "고쳐진 지수가 얼린 채점값을 덮어썼다");
  assert.equal(second.entries[0].scoredOn, "2026-12-15", "채점일이 바뀌었다");
  assert.equal(scoreLog(second).recent[0].actual, 9.53);
});

test("채점은 개수로 낸다: 범위 안 개수와 두 기준선을 모두 이긴 개수", () => {
  const record = scoreLog(freezeScores(withDrift(), FIRST, "2026-12-15"));
  // 실제 +9.53, 범위 -0.5~5.5 밖. 모델 오차 7.03 < |실제| 9.53, < |9.53-1.5|=8.03 -> 이긴다.
  assert.equal(record.insideCount, 0);
  assert.deepEqual(record.beatBoth, { won: 1, of: 1 });
  const text = recordSentence(record, "ko");
  assert.match(text, /1개 중 0개가 적어 둔 범위 안/);
  assert.match(text, /한 번의 채점으로는 모델이 맞는지 틀린지 판정하지 못합니다/);
  assert.doesNotMatch(text, /%가 적어 둔 범위|80% 안팎/, "채점 문장에 %로 적은 적중률이 남아 있다");
  assert.doesNotMatch(recordSentence(record, "en"), /about 80%|\d%\s+landed/);
});

test("drift가 없던 옛 항목은 그날까지의 지수로 채우고 넣은 날짜를 남긴다", () => {
  const legacy = { entries: [{ origin: "202607", region: "200", h: 3, target: "202610", change: 2.5, low: -0.5, high: 5.5 }] };
  const series = toSeries(synthetic({ phi: 0.6, months: 200 }));
  const origin = series.months.at(-4);
  const log = { entries: [{ ...legacy.entries[0], origin, target: series.months.at(-1) }] };
  const filled = backfillDrift(log, { 200: series }, "2026-10-07");
  assert.equal(filled.entries[0].driftAddedOn, "2026-10-07");
  const i = series.months.indexOf(origin);
  assert.equal(filled.entries[0].drift, Math.round(predict(series.logs, i, 3).drift * 100 * 100) / 100);
  // 두 번째 부름은 아무것도 바꾸지 않는다.
  assert.deepEqual(backfillDrift(filled, { 200: series }, "2026-11-01"), filled);
});

test("얼리기를 뺀 사본은 위 검사에서 빨갛게 된다 (낙제 시험)", async () => {
  const { readFile: read, rm, writeFile } = await import("node:fs/promises");
  const scripts = path.join(root, "scripts");
  const source = await read(path.join(scripts, "build-outlook.mjs"), "utf8");
  const guard = "if (entry.actual !== undefined) return entry; // 얼리기";
  assert.ok(source.includes(guard), "얼리기 줄을 못 찾았다 - 이 낙제 시험도 같이 고쳐야 한다");
  // 사본은 scripts/ 안에 둬야 상대 import가 풀린다. 끝나면 지운다.
  const copy = path.join(scripts, `.mutant-build-outlook-${process.pid}.mjs`);
  await writeFile(copy, source.replace(guard, ""));
  try {
    const mutant = await import(copy);
    const first = mutant.freezeScores(withDrift(), FIRST, "2026-12-15");
    const second = mutant.freezeScores(first, REVISED, "2027-01-20");
    assert.notEqual(second.entries[0].actual, 9.53, "얼리기를 빼도 통과한다 - 이 검사가 얼리기를 지키지 못한다");
  } finally {
    await rm(copy, { force: true });
  }
});

// --- 범위가 실시간으로 든 횟수 -------------------------------------------------------

test("실시간 범위는 그 시점 뒤의 오차를 보지 않는다", () => {
  const series = toSeries(synthetic({ phi: 0.6, months: 220 }));
  const before = realtimeCoverage(series, 3, "201801");
  // 마지막 달들의 값을 크게 흔들어도 그보다 앞 시점의 적중 여부는 같아야 한다.
  const tampered = { months: series.months, logs: series.logs.map((v, i) => (i >= series.logs.length - 2 ? v + 3 : v)) };
  const after = realtimeCoverage(tampered, 3, "201801");
  const cut = series.months.at(-1 - 3 - 3); // 흔든 값이 오차로 들어오는 시점의 앞
  const early = (rows) => rows.filter((r) => r.origin < cut);
  assert.ok(early(before).length > 10);
  assert.deepEqual(early(after), early(before), "미래 오차로 범위를 만들었다");
});

test("범위 안 개수 분포의 합은 시점 수와 같다", () => {
  const entries = ["a", "b", "c"].map((code, k) => ({ code, series: toSeries(synthetic({ phi: 0.5, months: 200, seed: 5 + k })) }));
  const summary = coverageSummary(entries, 3);
  assert.equal(summary.countDist.reduce((a, b) => a + b, 0), summary.countOrigins);
  assert.equal(summary.countDist.length, 4);
  assert.ok(summary.errorCorr.min <= summary.errorCorr.max);
});

// --- 빌드에서 화면까지 -------------------------------------------------------------

test("백테스트를 시작하기에 지수가 모자라면 아무것도 내지 않는다", () => {
  const built = buildPayload({
    index: { series: { 200: synthetic({ phi: 0.5, months: 30 }) } },
    deals: [],
    months: [],
    now: new Date("2026-10-01T00:00:00Z"),
    log: null,
  });
  assert.ok(built.payload.regions[0].cards.every((card) => card === null || card.forecast === null));
});

test("정적 HTML이 오늘 데이터의 문장과 표를 싣는다", async () => {
  const [html, data] = await Promise.all([
    readFile(path.join(root, "docs/price-outlook.html"), "utf8"),
    readFile(path.join(root, "docs/data/outlook.json"), "utf8").then(JSON.parse),
  ]);
  const block = (name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];

  assert.equal(block("outlookRegions"), data.tables.regions.ko);
  assert.equal(block("outlookScore"), data.tables.score.ko);
  assert.ok(block("outlookLead")?.length > 20, "첫 문장이 비어 있다");
  // 화면은 빌드가 만든 두 언어를 고르기만 한다. 영어 표도 같이 와야 한다.
  assert.ok(data.tables.regions.en && data.lead.en && data.recordLead.en);
});

test("'10억이면'은 오늘 값이 아니라 공식 지수 마지막 달 값에서 잰 것이라고 적는다 (#34)", async () => {
  const { leadSentence } = await import("../scripts/outlook.mjs");
  const seoul = { cards: [{ h: 3, origins: 170, from: "201201", mae: { model: 2.4, naive: 3.1 }, forecast: { target: "202610", change: 2.6, low: -0.3, high: 6.3 } }] };
  assert.match(leadSentence(seoul, "202607", "ko"), /2026년 7월에 10억이던 집이면 [0-9.]+억~[0-9.]+억입니다\(오늘 값이 아니라 2026년 7월 값에서 잰 것입니다\)/);
});
