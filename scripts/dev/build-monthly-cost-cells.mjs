#!/usr/bin/env node
// #631 환산 월 비용 75칸(research 전용, 수동 실행). Daily·update-all 은 이 스크립트를 부르지 않는다 — 칸 값은 링크·문구로 내보내지 않고
// 봇이 커밋하지 않는다(#630 판정). 서울 한 줄(docs/data/monthly-cost.json)은 scripts/build-monthly-cost.ts 가 Daily 에서 쓴다.
//
// 쓰는 법: node scripts/dev/build-monthly-cost-cells.mjs [--iterations N]
//   기본 10,000회·시드 587 — 칸 public 은 이 조건에서 폭 ≤29%p 일 때만 참(29~31%p 는 withheld). 반복을 줄이면 public 은 모두 거짓.
// 환경: MONTHLY_COST_CELLS_FILE(출력, 기본 research/monthly-cost/cells.json) · SERIES_FILE · REALESTATE_NOW · REALESTATE_RAW_DIR.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_ITERATIONS, buildPayload, readDealsByMonth, writeAtomic } from "../build-monthly-cost.ts";
import { collectionNow } from "../collection-now.ts";
import { shiftMonth, yearMonthOf } from "../realestate-slots.ts";

const root = path.resolve(import.meta.dirname, "../..");
const cellsFile = process.env.MONTHLY_COST_CELLS_FILE ? path.resolve(process.env.MONTHLY_COST_CELLS_FILE) : path.join(root, "research/monthly-cost/cells.json");
const seriesFile = process.env.SERIES_FILE ? path.resolve(process.env.SERIES_FILE) : path.join(root, "raw/indicators/series.json");
const idx = process.argv.indexOf("--iterations");
const cellIterations = idx > 0 ? Number(process.argv[idx + 1]) : PUBLIC_ITERATIONS;

const lastClosed = shiftMonth(yearMonthOf(collectionNow("REALESTATE_NOW")), -1);
const series = JSON.parse(await readFile(seriesFile, "utf-8")).series ?? null;
const months = Array.from({ length: 24 }, (_, i) => shiftMonth(lastClosed, i - 23));
const payload = buildPayload({ dealsByMonth: await readDealsByMonth(months), series, lastClosed, cellIterations });
if (!payload) {
  console.error("1년 변화를 낼 수 있는 달이 없습니다 - 칸 파일을 쓰지 않습니다");
  process.exit(1);
}
await writeAtomic(cellsFile, JSON.stringify(payload.cells));
const last = payload.cells.points.at(-1);
const count = (f) => last.cells.filter(f).length;
console.log(
  `  칸(research): ${last.month} ${last.cells.length}칸 · ${cellIterations}회 · public(≤${payload.cells.publicWidth}%p) ${count((c) => c.public)}칸 · withheld ${count((c) => c.withheld)}칸 · 0 을 벗어난 칸 ${count((c) => c.excludesZero)}`
);
