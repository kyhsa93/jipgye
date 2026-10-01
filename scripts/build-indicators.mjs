import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_FILE } from "./fetch-price-index.mjs";
import { INDICATOR_FILE } from "./fetch-indicators.mjs";
import { judge, leadSentence, priceSeries, tableHtml } from "./indicator-backtest.mjs";

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

export function buildPayload({ index, indicators, now }) {
  if (!index?.series?.["200"] || !indicators?.series) return null;
  const prices = Object.fromEntries(Object.entries(index.series).map(([code, rows]) => [code, priceSeries(rows)]));
  const rows = judge(prices, indicators.series);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });
  // 판정에 쓴 지표 계열의 마지막 달. 화면이 "어디까지 보고 낸 판정인가"를 적는다.
  const lastMonths = Object.fromEntries(Object.entries(indicators.series).map(([k, v]) => [k, v.at(-1)?.[0] ?? null]));
  return {
    updatedAt: now.toISOString(),
    priceLast: index.series["200"].at(-1)[0],
    lastMonths,
    rows: rows.map(({ fn, ...row }) => row),
    lead: both((l) => leadSentence(rows, l)),
    table: both((l) => tableHtml(rows, l)),
  };
}

async function main() {
  const [index, indicators] = await Promise.all([readJson(INDEX_FILE), readJson(INDICATOR_FILE)]);
  const payload = buildPayload({ index, indicators, now: new Date() });
  if (!payload) {
    console.log("  앞서지 않은 지표: 가격지수나 지표 계열이 없어 건너뜀(어제 파일 유지)");
    return;
  }
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  const count = (v) => payload.rows.filter((r) => r.verdict === v).length;
  console.log(
    `  앞서지 않은 지표: ${payload.rows.length}가지 중 앞섬 ${count("leads")}, 서울에서만 ${count("seoulOnly")}, ` +
      `먼저 공표 ${count("published")}, 앞서지 않음 ${count("no")}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
