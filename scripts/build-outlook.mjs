import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_FILE } from "./fetch-price-index.mjs";
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

/** 지수가 나온 예측만 채점한다. 실제 변화는 지금 지수로 잰다(고쳐진 값이 정답이다). */
export function scoreLog(log, seriesByRegion) {
  const scored = [];
  for (const entry of log.entries) {
    const series = seriesByRegion[entry.region];
    const a = series?.months.indexOf(entry.origin) ?? -1;
    const b = series?.months.indexOf(entry.target) ?? -1;
    if (a < 0 || b < 0) continue;
    const actual = round2((series.logs[b] - series.logs[a]) * 100);
    scored.push({ ...entry, actual, inside: actual >= entry.low && actual <= entry.high });
  }
  return {
    made: log.entries.length,
    scored: scored.length,
    mae: scored.length ? round2(scored.reduce((s, e) => s + Math.abs(e.actual - e.change), 0) / scored.length) : null,
    inside: scored.length ? round2((scored.filter((e) => e.inside).length / scored.length) * 100) : null,
    recent: scored.slice(-12),
    pending: log.entries.filter((e) => !scored.some((s) => s.origin === e.origin && s.region === e.region && s.h === e.h)),
  };
}

export function buildPayload({ index, deals, months, now, log }) {
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

  const nextLog = updateLog(log, regions, lastOfficial);
  const seoulRegion = regions.find((r) => r.code === "200");
  const record = scoreLog(nextLog, seriesByRegion);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });

  return {
    payload: {
      updatedAt: now.toISOString(),
      lastOfficial,
      horizons: HORIZONS,
      regions,
      rows: regionRows(regions),
      record,
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

  const built = buildPayload({ index, deals, months, now, log });
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
      `값을 낸 칸 ${built.payload.regions.flatMap((r) => r.cards).filter((c) => c.forecast).length}/${built.payload.regions.length * HORIZONS.length}, ` +
      `메운 달 ${seoul.nowcast.months.map((m) => `${m.month}:${m.change ?? "-"}`).join(" ")} (${months[0]}~${shiftMonth(months.at(-1), 0)})`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
