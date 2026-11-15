import { readFile } from "node:fs/promises";
import { bandFast, moneyFast, prepCells } from "./fast-858.mjs";
const dc = await import(new URL("../../scripts/district-change.ts", import.meta.url).href);
const inp = JSON.parse(await readFile(new URL("./input-858.json", import.meta.url), "utf8"));
const byD = new Map(inp.byDistrict); const lv = new Map(inp.levels);
const ok = inp.districts.map((d) => d.code).filter((c) => (byD.get(c) ?? []).length >= dc.MIN_CELLS).sort();
let bad = 0, n = 0;
for (const seed of [20261001, 777]) for (const R of [400, 1000]) for (const c of ok) {
  const a = dc.band(byD.get(c), { rounds: R, seed }); const b = bandFast(byD.get(c), R, seed); n++;
  if (a[0] !== b[0] || a[1] !== b[1]) bad++;
}
console.log("band 불일치", bad, "/", n);
bad = 0; n = 0; let t1 = 0, t2 = 0;
const P = new Map(ok.map((c) => [c, prepCells(lv.get(c))]));
for (const seed of [20261001, 777]) for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
  let t = performance.now(); const a = dc.moneyGap(lv.get(ok[i]), lv.get(ok[j]), { rounds: 200, seed }); t1 += performance.now() - t;
  t = performance.now(); const b = moneyFast(P.get(ok[i]), P.get(ok[j]), 200, seed); t2 += performance.now() - t; n++;
  if (a.change !== Math.round(b.change) || a.low !== Math.round(b.low) || a.high !== Math.round(b.high)) bad++;
}
console.log("money 불일치", bad, "/", n, "ms 원본", Math.round(t1), "빠른", Math.round(t2));
