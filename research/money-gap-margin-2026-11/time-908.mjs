// 규칙마다 늘어나는 빌드 시간(cto 조건 3). 입력 A, 이 머신, 각 3회 중앙값, 1분 부하 평균을 시작·끝에 적는다.
// 바탕: 빌드와 같은 moneyGap(scripts/district-change.ts, MONEY_ROUNDS, 지금 씨앗)으로 모든 쌍.
// (가)·(나): 바탕 결과에 규칙을 거는 시간만 더해진다 - 그 단계만 잰다.
// (다′): 같은 정렬된 sims 에서 두 칸을 더 읽는다 - moneyFull(순서통계량 포함)과 #858 의 moneyFast(없음)의 차 + 규칙 시간.
// (다): 바탕 + 씨앗 K_EXTRA 개를 더 돌린 전체 시간 − 바탕.
// 결과를 out/time-908.json 에 쓴다. 인자: 반복 횟수(기본 3).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadavg } from "node:os";
import { moneyFull, prepCells } from "./fast-908.mjs";
import { moneyFast } from "../district-change-rounds-2026-11/fast-858.mjs";
import { RULES, K_EXTRA, sampleSd } from "./rules-908.mjs";
const dc = await import(new URL("../../scripts/district-change.ts", import.meta.url).href);
const reps = Number(process.argv[2] ?? 3);
const inp = JSON.parse(await readFile(new URL("./input-908-A.json", import.meta.url), "utf8"));
const byD = new Map(inp.byDistrict); const lv = new Map(inp.levels);
const ok = inp.districts.map((d) => d.code).filter((c) => (byD.get(c) ?? []).length >= dc.MIN_CELLS).sort();
const pairs = []; for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) pairs.push([ok[i], ok[j]]);
const P = new Map(ok.map((c) => [c, prepCells(lv.get(c))]));
const SEED0 = 20261001;
const timeIt = (label, fn) => {
  const ts = []; const la0 = loadavg()[0];
  for (let r = 0; r < reps; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b);
  const med = ts[ts.length >> 1];
  console.log(`${label}: 중앙 ${Math.round(med)}ms 모두 ${ts.map(Math.round).join(",")} 부하 ${la0.toFixed(2)}→${loadavg()[0].toFixed(2)}`);
  return med;
};
const base = () => pairs.map(([a, b]) => dc.moneyGapRaw(lv.get(a), lv.get(b)));
const once = base();
const full = pairs.map(([a, b]) => moneyFull(P.get(a), P.get(b), dc.MONEY_ROUNDS, SEED0));
const tBase = timeIt("바탕 moneyGap 전 쌍", base);
const tGa = timeIt("(가) 규칙만", () => once.map((m) => RULES.ga(m)));
const tNa = timeIt("(나) 규칙만", () => once.map((m) => RULES.na(m)));
const tFull = timeIt("moneyFull 전 쌍", () => pairs.map(([a, b]) => moneyFull(P.get(a), P.get(b), dc.MONEY_ROUNDS, SEED0)));
const tFast = timeIt("moneyFast(#858) 전 쌍", () => pairs.map(([a, b]) => moneyFast(P.get(a), P.get(b), dc.MONEY_ROUNDS, SEED0)));
const tDa2 = timeIt("(다′) 규칙만", () => full.map((m) => RULES.da2(m)));
const tDa = timeIt(`(다) 바탕 + 씨앗 ${K_EXTRA}개`, () => {
  const runs = [base(), ...Array.from({ length: K_EXTRA }, (_, j) => pairs.map(([a, b]) => dc.moneyGapRaw(lv.get(a), lv.get(b), { seed: SEED0 + 7919 * (j + 1) })))];
  return runs[0].map((m, i) => RULES.da(m, { sdLow: sampleSd(runs.map((r) => r[i].low)), sdHigh: sampleSd(runs.map((r) => r[i].high)) }));
});
const out = {
  ra: { increaseMs: 0 },
  ga: { increaseMs: Math.round(tGa) },
  na: { increaseMs: Math.round(tNa) },
  da2: { increaseMs: Math.round(tFull - tFast + tDa2) },
  da: { increaseMs: Math.round(tDa - tBase) },
  baseMs: Math.round(tBase), reps,
};
await mkdir(new URL("./out/", import.meta.url), { recursive: true });
await writeFile(new URL("./out/time-908.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
