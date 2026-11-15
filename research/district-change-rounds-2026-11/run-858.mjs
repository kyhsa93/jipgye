// 한 (종류, 횟수, 씨앗)의 반올림 전 결과를 out/ 에 쓴다. 인자: band|money R seed
import { readFile, writeFile } from "node:fs/promises";
import { bandFast, moneyFast, prepCells } from "./fast-858.mjs";
const inp = JSON.parse(await readFile(new URL("./input-858.json", import.meta.url), "utf8"));
const byD = new Map(inp.byDistrict); const lv = new Map(inp.levels);
const ok = inp.districts.map((d) => d.code).filter((c) => (byD.get(c) ?? []).length >= 30).sort();
const [kind, R, seed] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const out = {};
if (kind === "band") for (const c of ok) out[c] = bandFast(byD.get(c), R, seed);
else {
  const P = new Map(ok.map((c) => [c, prepCells(lv.get(c))]));
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) out[`${ok[i]}-${ok[j]}`] = moneyFast(P.get(ok[i]), P.get(ok[j]), R, seed);
}
await writeFile(new URL(`./out/${kind}-${R}-${seed}.json`, import.meta.url), JSON.stringify(out));
