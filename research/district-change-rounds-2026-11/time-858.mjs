// 실제 코드(dc.band, dc.moneyGap)로 횟수별 계산 시간. 인자: 종류(band|money) 횟수 반복
import { readFile } from "node:fs/promises";
const dc = await import(new URL("../../scripts/district-change.ts", import.meta.url).href);
const inp = JSON.parse(await readFile(new URL("./input-858.json", import.meta.url), "utf8"));
const byD = new Map(inp.byDistrict); const lv = new Map(inp.levels);
const ok = inp.districts.map((d) => d.code).filter((c) => (byD.get(c) ?? []).length >= dc.MIN_CELLS).sort();
const [kind, R, reps] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4] ?? 3)];
const ts = [];
for (let r = 0; r < reps; r++) {
  const t = performance.now();
  if (kind === "band") for (const c of ok) dc.band(byD.get(c), { rounds: R });
  else for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) dc.moneyGap(lv.get(ok[i]), lv.get(ok[j]), { rounds: R });
  ts.push(performance.now() - t);
}
ts.sort((a, b) => a - b);
console.log(kind, R, "ms median", Math.round(ts[ts.length >> 1]), "all", ts.map(Math.round).join(","));
