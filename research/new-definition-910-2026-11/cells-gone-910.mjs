// #910 A1: 사라진 칸이 어느 문턱 때문인지(신규 전세 건수 <3 인지, 비율 범위 밖인지). 실행: node cells-gone-910.mjs <worktree> <da-910 dir>
import path from "node:path"; import { readFile } from "node:fs/promises";
const [wt, D] = process.argv.slice(2).map((p) => path.resolve(p));
const { readRaw } = await import(`${wt}/scripts/build-complex-ratio.ts`);
const { cellKey, MIN_DEALS_PER_SIDE } = await import(`${wt}/scripts/complex-ratio.ts`);
const { recentMonths } = await import(`${wt}/scripts/realestate-source.ts`);
const by = await readRaw(recentMonths(new Date("2026-11-16T02:45:01.520Z"), 6), `${wt}/raw`);
const B = JSON.parse(await readFile(`${D}/out/before/a1-cells.json`, "utf8")), A = JSON.parse(await readFile(`${D}/out/after/a1-cells.json`, "utf8"));
const num = (v) => { const t = String(v ?? "").replace(/,/g, "").trim(); return /^-?\d+$/.test(t) ? Number(t) : 0; };
const reasons = {}; const blanks = [];
for (const [name, cells] of Object.entries(B)) {
  const after = new Set(A[name].map((c) => c.key));
  const { rents, same } = by[name];
  for (const c of cells) {
    if (after.has(c.key)) continue;
    const rows = rents.filter((it) => String(it?.aptNm ?? "").trim() && cellKey(it, same) === c.key && num(it.monthlyRent) === 0 && num(it.deposit) > 0);
    const nNew = rows.filter((it) => String(it.contractType ?? "").trim() === "신규").length;
    const nBlank = rows.filter((it) => !String(it.contractType ?? "").trim()).length;
    const r = nNew < MIN_DEALS_PER_SIDE ? "신규 전세 3건 미만" : "비율 범위 밖";
    reasons[r] = (reasons[r] ?? 0) + 1; blanks.push(`${nNew}+${nBlank}`);
  }
}
console.log(JSON.stringify(reasons), "신규+미표기 건수:", blanks.sort().join(" "));
