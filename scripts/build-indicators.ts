import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_FILE } from "./fetch-price-index.ts";
import { INDICATOR_FILE, KB_HISTORY_FILE, KB_SERIES, kbHistoryProblem } from "./fetch-indicators.ts";
import { judge, leadSentence, priceSeries, tableHtml } from "./indicator-backtest.ts";

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.OUTLOOK_INDICATORS_FILE
  ? path.resolve(process.env.OUTLOOK_INDICATORS_FILE)
  : path.join(root, "docs/data/outlook-indicators.json");

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * KB 두 계열은 저장소 raw 가 아니라 같은 잡의 fetch-indicators 가 받은 임시 사본(KB_HISTORY_FILE)에서 온다(#588).
 * 사본이 없거나 온전하지 않으면 null - 그날은 판정을 내지 않고 어제 파일을 둔다. raw 에 남아 있는 옛 kb_* 로
 * 대신하지 않는다(더 갱신되지 않는 값이고, 정리 PR 뒤에는 없다).
 */
export function readKbSeries(kb) {
  if (!kb?.series) return null;
  for (const name of Object.keys(KB_SERIES)) if (kbHistoryProblem(kb.series[name])) return null;
  return Object.fromEntries(Object.keys(KB_SERIES).map((name) => [name, kb.series[name]]));
}

/** raw 계열(옛 모양은 kb_* 가 있고 새 모양은 없다)에 KB 사본을 얹는다. KB 가 앞 - 옛 raw 의 키 순서와 같게. */
export function withKb(indicators, kbSeries) {
  if (!indicators?.series || !kbSeries) return null;
  const rest = Object.fromEntries(Object.entries(indicators.series).filter(([name]) => !(name in KB_SERIES)));
  return { ...indicators, series: { ...kbSeries, ...rest } };
}

export function buildPayload({ index, indicators, now }) {
  if (!index?.series?.["200"] || !indicators?.series) return null;
  const prices = Object.fromEntries(Object.entries(index.series).map(([code, rows]) => [code, priceSeries(rows)]));
  const rows = judge(prices, indicators.series);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });
  // 판정에 쓴 지표 계열의 마지막 달. 화면이 "어디까지 보고 낸 판정인가"를 적는다.
  const lastMonths = Object.fromEntries((Object.entries(indicators.series) as [string, unknown[][]][]).map(([k, v]) => [k, v.at(-1)?.[0] ?? null]));
  return {
    updatedAt: now.toISOString(),
    priceLast: index.series["200"].at(-1)[0],
    lastMonths,
    rows: rows.map(({ fn, ...row }) => row),
    lead: both((l) => leadSentence(rows, l)),
    table: both((l) => tableHtml(rows, l)),
  };
}

export async function buildFile({
  indexFile = INDEX_FILE,
  indicatorFile = INDICATOR_FILE,
  kbFile = KB_HISTORY_FILE,
  out = outFile,
  now = new Date(),
  log = console.log,
} = {}) {
  const [index, raw, kb] = await Promise.all([readJson(indexFile), readJson(indicatorFile), readJson(kbFile)]);
  const kbSeries = readKbSeries(kb);
  if (raw?.series && !kbSeries) {
    log("::warning::앞서지 않은 지표: KB 계열 전체 이력(임시 사본)이 없거나 온전하지 않아 건너뜀(어제 파일 유지)");
    return null;
  }
  const payload = buildPayload({ index, indicators: withKb(raw, kbSeries), now });
  if (!payload) {
    log("  앞서지 않은 지표: 가격지수나 지표 계열이 없어 건너뜀(어제 파일 유지)");
    return null;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload, null, 2));
  const count = (v) => payload.rows.filter((r) => r.verdict === v).length;
  log(
    `  앞서지 않은 지표: ${payload.rows.length}가지 중 앞섬 ${count("leads")}, 서울에서만 ${count("seoulOnly")}, ` +
      `먼저 공표 ${count("published")}, 앞서지 않음 ${count("no")}`
  );
  return payload;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  buildFile();
}
