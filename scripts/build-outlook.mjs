import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_FILE } from "./fetch-price-index.mjs";
import { INDICATOR_FILE } from "./fetch-indicators.mjs";
import { SHADOW, priceSeries, shadowForecast } from "./indicator-backtest.mjs";
import {
  HORIZONS,
  REGIONS,
  backtest,
  forecastCell,
  leadSentence,
  longSentence,
  nowcast,
  nowcastSentence,
  nowcastTableHtml,
  predict,
  coverageSummary,
  recordSentence,
  regionRows,
  regionTableHtml,
  scoreTableHtml,
  toDeal,
  toSeries,
} from "./outlook.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { RETENTION_MONTHS, shiftMonth, yearMonthOf } from "./realestate-slots.mjs";
import { recentMonths } from "./realestate-source.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = process.env.OUTLOOK_DIR ? path.resolve(process.env.OUTLOOK_DIR) : path.join(root, "docs/data");

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * 한 번 낸 예측은 고치지 않고 쌓는다. 지수가 나오면 그때 채점한다.
 *
 * 백테스트는 지금의(고쳐진) 지수로 과거를 다시 푼 것이라 실제보다 잘 나온다 - 그 시점에는
 * 고쳐지기 전 값밖에 없었다. 진짜 성적은 그날 그날 낸 예측을 나중에 채점한 이것뿐이다.
 */
export function updateLog(log, regions, lastOfficial) {
  const entries = [...(log?.entries ?? [])];
  const seen = new Set(entries.map((e) => `${e.origin}|${e.region}|${e.h}`));

  for (const region of regions) {
    for (const card of region.cards) {
      const id = `${lastOfficial}|${region.code}|${card.h}`;
      if (!card.forecast || seen.has(id)) continue;
      entries.push({ origin: lastOfficial, region: region.code, h: card.h, ...card.forecast });
    }
  }
  return { entries };
}

/**
 * 이미 쌓인 예측에 빠진 "늘 오른다" 값을 채운다. #64 전에 쌓은 항목에는 이 값이 없다.
 * origin 시점까지의 지수만으로 다시 계산하므로 그날 낼 수 있던 값과 같고(origin 달이
 * 공식 마지막 달이었다면 고쳐진 값의 영향도 거의 없다), 언제 넣었는지를 `driftAddedOn`에
 * 남겨 "그날 낸 값"이 아니라 "나중에 같은 식으로 채운 값"임을 밝힌다. 있는 값은 건드리지 않는다.
 */
export function backfillDrift(log, seriesByRegion, today) {
  const entries = (log?.entries ?? []).map((entry) => {
    if (entry.drift !== undefined) return entry;
    const series = seriesByRegion[entry.region];
    const origin = series?.months.indexOf(entry.origin) ?? -1;
    const guess = origin >= 0 ? predict(series.logs, origin, entry.h) : null;
    if (!guess) return entry;
    return { ...entry, drift: round2(guess.drift * 100), driftAddedOn: today };
  });
  return { ...log, entries };
}

/**
 * 지수가 처음 나온 날 채점값을 얼린다(#64). `actual`은 목표 달 지수가 처음 실린 빌드의 값이고
 * `scoredOn`은 그 날짜다. 이후 지수가 고쳐져도 바꾸지 않는다 - 12월 첫 채점을 결과를 본 뒤
 * 다시 계산한 값으로 갈아 끼우면 사전 등록이 무의미해진다. 얼리지 않으면 매 빌드가 그때그때의
 * 지수로 다시 재서 채점값이 흔들린다.
 */
export function freezeScores(log, seriesByRegion, today) {
  const entries = log.entries.map((entry) => {
    if (entry.actual !== undefined) return entry; // 얼리기
    const series = seriesByRegion[entry.region];
    const a = series?.months.indexOf(entry.origin) ?? -1;
    const b = series?.months.indexOf(entry.target) ?? -1;
    if (a < 0 || b < 0) return entry;
    return { ...entry, actual: round2((series.logs[b] - series.logs[a]) * 100), scoredOn: today };
  });
  return { ...log, entries };
}

/** 채점. 얼린 `actual`이 있는 항목만 센다 - 안 얼린 항목은 `freezeScores`를 먼저 거쳐야 한다. */
export function scoreLog(log) {
  const scored = log.entries
    .filter((entry) => entry.actual !== undefined)
    .map((entry) => ({ ...entry, inside: entry.actual >= entry.low && entry.actual <= entry.high }));
  // "그대로다"는 변화 0이라 오차가 |actual|이다. 두 기준선 값이 다 있는 항목만 비교한다.
  const comparable = scored.filter((entry) => entry.drift !== undefined);
  const won = comparable.filter((entry) => {
    const model = Math.abs(entry.actual - entry.change);
    return model < Math.abs(entry.actual) && model < Math.abs(entry.actual - entry.drift);
  }).length;
  return {
    made: log.entries.length,
    scored: scored.length,
    mae: scored.length ? round2(scored.reduce((s, e) => s + Math.abs(e.actual - e.change), 0) / scored.length) : null,
    insideCount: scored.filter((e) => e.inside).length,
    beatBoth: comparable.length ? { won, of: comparable.length } : null,
    recent: scored.slice(-12),
    pending: log.entries.filter((e) => e.actual === undefined),
  };
}

/**
 * 그림자 예측 한 줄을 쌓는다(공식 달마다 한 번, 고치지 않는다). 화면에는 싣지 않는다.
 * 같은 오리진에 이미 있으면 그대로 둔다 - 다음 날 다시 낸 값으로 덮으면 그때 낸 예측이 아니게 된다.
 */
export function updateShadow(log, origin, forecast, { region = "200", h = SHADOW.h, indicator = `${SHADOW.id}+${SHADOW.lag}` } = {}) {
  const shadow = [...(log?.shadow ?? [])];
  if (!forecast || shadow.some((e) => e.origin === origin && e.region === region && e.h === h)) return shadow;
  shadow.push({ origin, region, h, target: shiftMonth(origin, h), indicator, base: forecast.base, with: forecast.with });
  return shadow;
}

/** 지수가 나온 그림자 예측만 채점한다. 두 모델의 평균 오차를 나란히. */
export function scoreShadow(shadow, seriesByRegion) {
  const scored = [];
  for (const e of shadow ?? []) {
    const s = seriesByRegion[e.region];
    const a = s?.months.indexOf(e.origin) ?? -1;
    const b = s?.months.indexOf(e.target) ?? -1;
    if (a < 0 || b < 0) continue;
    const actual = (s.logs[b] - s.logs[a]) * 100;
    scored.push({ base: Math.abs(actual - e.base), with: Math.abs(actual - e.with) });
  }
  const mae = (k) => (scored.length ? round2(scored.reduce((sum, x) => sum + x[k], 0) / scored.length) : null);
  return { made: shadow?.length ?? 0, scored: scored.length, base: mae("base"), with: mae("with") };
}

export function buildPayload({ index, deals, months, now, log, indicators = null }) {
  const seriesByRegion = {};
  for (const { code } of REGIONS) {
    const rows = index?.series?.[code];
    if (rows?.length) seriesByRegion[code] = toSeries(rows);
  }
  const seoul = seriesByRegion["200"];
  if (!seoul?.months.length) return null;
  const lastOfficial = seoul.months.at(-1);

  const regions = REGIONS.filter(({ code }) => seriesByRegion[code]).map((region) => {
    const series = seriesByRegion[region.code];
    const cards = HORIZONS.map((h) => forecastCell(series, h)).filter(Boolean);

    // 메운 달이 견줄 상대는 모델의 1개월 예측이다. 그보다 못하면 메우지 않는다.
    const one = backtest(series, 1);
    const oneMonthMae = one.length ? round2(one.reduce((s, r) => s + Math.abs(r.model), 0) / one.length) : null;
    const inRegion = region.districts ? deals.filter((d) => region.districts.includes(d.district)) : deals;

    return {
      code: region.code,
      name: region.name,
      last: series.months.at(-1),
      cards,
      nowcast: nowcast({ deals: inRegion, months, official: series, oneMonthMae }),
    };
  });

  // 한국 날짜로 적는다 - UTC로 끊으면 아침 빌드가 전날로 찍힌다.
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const nextLog = freezeScores(backfillDrift(updateLog(log, regions, lastOfficial), seriesByRegion, today), seriesByRegion, today);
  nextLog.shadow = updateShadow(
    log,
    lastOfficial,
    indicators?.series ? shadowForecast(priceSeries(index.series["200"]), indicators.series) : null
  );
  const seoulRegion = regions.find((r) => r.code === "200");
  const record = scoreLog(nextLog);
  // 범위가 실시간으로 든 횟수(3개월 뒤, 값을 내는 권역). 문서의 64%가 이 계산이다.
  const covered = regions.filter((r) => r.cards.find((c) => c.h === 3)?.beats);
  const rangeCoverage = coverageSummary(covered.map((r) => ({ code: r.code, series: seriesByRegion[r.code] })), 3);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });

  return {
    payload: {
      updatedAt: now.toISOString(),
      lastOfficial,
      horizons: HORIZONS,
      regions,
      rows: regionRows(regions),
      record,
      rangeCoverage,
      // 화면에는 싣지 않는다(#22). 12개 넘게 채점되면(2027 하반기) 이긴 쪽을 다시 본다.
      shadow: scoreShadow(nextLog.shadow, seriesByRegion),
      lead: both((l) => leadSentence(seoulRegion, lastOfficial, l)),
      longLead: both((l) => longSentence(seoulRegion, l)),
      nowcastLead: both((l) => nowcastSentence(seoulRegion, l)),
      recordLead: both((l) => recordSentence(record, l)),
      tables: {
        regions: both((l) => regionTableHtml(regions, l)),
        nowcast: both((l) => nowcastTableHtml(regions, l)),
        score: both((l) => scoreTableHtml(seoulRegion, l)),
      },
    },
    log: nextLog,
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 원본이 있는 달 가운데 신고 기한이 닫힌 달만. 계약 후 30일 안에 신고하므로 9월 계약은
 * 10월 말에야 다 들어온다. 10월 1일의 9월은 일찍 신고된 절반뿐이다.
 *
 * 메운 값의 성적은 공식 지수와 겹치는 달 - 신고가 다 끝난 달 - 에서만 잰다. 덜 들어온
 * 달을 같이 실으면 그 성적이 보증하지 않는 값을 같은 성적표 아래 싣게 된다.
 */
export const closedBefore = (now) => shiftMonth(yearMonthOf(now), -1);

async function readDeals(now) {
  const current = closedBefore(now);
  const months = recentMonths(now, RETENTION_MONTHS).filter((m) => m < current);
  const { DISTRICTS } = await import("./realestate-districts.mjs");
  const files = await Promise.all(
    DISTRICTS.flatMap(({ code }) => months.map((month) => readSlotFile("sale", code, month)))
  );
  const deals = files
    .filter((file) => file?.ok !== false && Array.isArray(file?.items))
    .flatMap((file) => file.items)
    .map(toDeal)
    .filter((deal) => deal && deal.month < current);
  const present = new Set(deals.map((d) => d.month));
  // 앞쪽에 원본이 빈 달이 있으면 거기서부터 잇는다. 빈 달을 건너뛰어 이으면 두 달치를 한 달로 읽는다.
  let first = months.length - 1;
  while (first > 0 && present.has(months[first - 1])) first -= 1;
  return { deals, months: months.slice(first) };
}

async function main() {
  const now = new Date();
  const index = await readJson(INDEX_FILE);
  if (!index) {
    console.log("  전망: 실거래가격지수가 없어 건너뜀");
    return;
  }
  const { deals, months } = await readDeals(now);
  const log = await readJson(path.join(dataDir, "outlook-log.json"));
  const indicators = await readJson(INDICATOR_FILE);

  const built = buildPayload({ index, deals, months, now, log, indicators });
  if (!built) {
    console.log("  전망: 서울 계열이 없어 건너뜀");
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "outlook.json"), JSON.stringify(built.payload, null, 2));
  await writeFile(path.join(dataDir, "outlook-log.json"), `${JSON.stringify(built.log, null, 2)}\n`);

  const seoul = built.payload.regions.find((r) => r.code === "200");
  const three = seoul.cards.find((c) => c.h === 3);
  console.log(
    `  전망: 공식 ${built.payload.lastOfficial}, 서울 3개월 ${three?.forecast ? `${three.forecast.change}% (${three.forecast.low}~${three.forecast.high})` : "값 없음"}, ` +
      `범위 실시간 적중 ${built.payload.rangeCoverage?.inside}/${built.payload.rangeCoverage?.origins}, 값을 낸 칸 ${built.payload.regions.flatMap((r) => r.cards).filter((c) => c.forecast).length}/${built.payload.regions.length * HORIZONS.length}, ` +
      `메운 달 ${seoul.nowcast.months.map((m) => `${m.month}:${m.change ?? "-"}`).join(" ")} (${months[0]}~${shiftMonth(months.at(-1), 0)})`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
