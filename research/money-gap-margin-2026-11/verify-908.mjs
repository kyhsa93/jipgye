// 측정 전 확인: fast-908 moneyFull 의 change·low·high 가 scripts/district-change.ts moneyGapRaw 와 Object.is 로 같은가.
// 인자: <입력 이름>. 전 쌍 × 씨앗 2개(20261001, 777) × 횟수 200, 그리고 MONEY_ROUNDS(4000)·지금 씨앗 첫 3쌍.
// 순서통계량(seLow·seHigh)은 원본에 없어 견줄 것이 없다 - 같은 정렬된 sims 의 다른 칸이다.
// 하나라도 다르면 멈춘다(측정하지 않는다).
import { readFile } from "node:fs/promises";
import { moneyFull, prepCells, rankHalfWidth } from "./fast-908.mjs";
const dc = await import(new URL("../../scripts/district-change.ts", import.meta.url).href);
const name = process.argv[2];
const inp = JSON.parse(await readFile(new URL(`./input-908-${name}.json`, import.meta.url), "utf8"));
const byD = new Map(inp.byDistrict); const lv = new Map(inp.levels);
const ok = inp.districts.map((d) => d.code).filter((c) => (byD.get(c) ?? []).length >= dc.MIN_CELLS).sort();
const P = new Map(ok.map((c) => [c, prepCells(lv.get(c))]));
const same = (a, b) => Object.is(a.change, b.change) && Object.is(a.low, b.low) && Object.is(a.high, b.high);
let bad = 0, n = 0;
for (const seed of [20261001, 777]) for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
  n++; if (!same(dc.moneyGapRaw(lv.get(ok[i]), lv.get(ok[j]), { rounds: 200, seed }), moneyFull(P.get(ok[i]), P.get(ok[j]), 200, seed))) bad++;
}
let pairs = 0;
outer: for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
  if (pairs++ >= 3) break outer;
  n++; if (!same(dc.moneyGapRaw(lv.get(ok[i]), lv.get(ok[j])), moneyFull(P.get(ok[i]), P.get(ok[j]), dc.MONEY_ROUNDS, 20261001))) bad++;
}
console.log(`입력 ${name}: 구 ${ok.length} 쌍 ${ok.length * (ok.length - 1) / 2} | 불일치 ${bad} / ${n} | MONEY_ROUNDS ${dc.MONEY_ROUNDS} 순위 반폭 ${rankHalfWidth(dc.MONEY_ROUNDS)}`);
if (bad || dc.MONEY_ROUNDS !== 4000) throw new Error("확인 실패 - 측정하지 않는다");
