import { readFile } from "node:fs/promises";
import { moneyFast, prepCells, bandFast } from "./fast-858.mjs";
const inp = JSON.parse(await readFile(new URL("./input-858.json", import.meta.url), "utf8"));
const byD = new Map(inp.byDistrict); const lv = new Map(inp.levels);
const ok = inp.districts.map((d) => d.code).filter((c) => (byD.get(c) ?? []).length >= 30).sort();
for (const R of [200, 2000, 4000]) {
  const t = performance.now();
  const P = new Map(ok.map((c) => [c, prepCells(lv.get(c))]));
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) moneyFast(P.get(ok[i]), P.get(ok[j]), R, 20261001);
  console.log("빠른 money", R, "ms", Math.round(performance.now() - t));
}
for (const R of [400, 2000]) { const t = performance.now(); for (const c of ok) bandFast(byD.get(c), R, 20261001); console.log("빠른 band", R, "ms", Math.round(performance.now() - t)); }
