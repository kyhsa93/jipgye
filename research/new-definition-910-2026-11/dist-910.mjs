// #910 계수 0단계: R0 raw/rent 의 contractType 값 분포(창별). 실행: node dist-910.mjs <worktree>
import path from "node:path";
const wt = path.resolve(process.argv[2]);
const { readSlotFile } = await import(`${wt}/scripts/realestate-raw.ts`);
const { DISTRICTS } = await import(`${wt}/scripts/realestate-districts.ts`);
const RAW = `${wt}/raw`;
const num = (v) => { const t = String(v ?? "").replace(/,/g, "").trim(); return /^-?\d+$/.test(t) ? Number(t) : 0; };
const months = [];
for (let y = 2024, m = 12; y * 100 + m <= 202611; ) { months.push(`${y}${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
const perMonth = {};
for (const ym of months) {
  const all = {}, jeonse = {}; // all rows by contractType; 순수 전세 후보(단지명·월세0·보증금>0)
  let slots = 0;
  for (const { code } of DISTRICTS) {
    const f = await readSlotFile("rent", code, ym, RAW);
    if (!f || f.ok === false || !Array.isArray(f.items)) continue;
    slots++;
    for (const it of f.items) {
      const ct = JSON.stringify(String(it?.contractType ?? "").trim());
      all[ct] = (all[ct] ?? 0) + 1;
      if (String(it?.aptNm ?? "").trim() && num(it.monthlyRent) === 0 && num(it.deposit) > 0) jeonse[ct] = (jeonse[ct] ?? 0) + 1;
    }
  }
  perMonth[ym] = { slots, all, jeonse };
}
console.log(JSON.stringify(perMonth));
