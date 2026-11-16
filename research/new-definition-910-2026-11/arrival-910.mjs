// #910: 도착일(arrivals) 주별 계약구분 미표기 비율. 실행: node arrival-910.mjs <worktree>
import path from "node:path";
const wt = path.resolve(process.argv[2]);
const { readSlotFile, itemKey } = await import(`${wt}/scripts/realestate-raw.ts`);
const { DISTRICTS } = await import(`${wt}/scripts/realestate-districts.ts`);
const { weekStart } = await import(`${wt}/scripts/realestate-weekly.ts`);
const RAW = `${wt}/raw`;
const num = (v) => { const t = String(v ?? "").replace(/,/g, "").trim(); return /^-?\d+$/.test(t) ? Number(t) : 0; };
const months = ["202606","202607","202608","202609","202610","202611"];
const byWeek = {};
for (const ym of months) for (const { code } of DISTRICTS) {
  const f = await readSlotFile("rent", code, ym, RAW);
  if (!f?.items) continue;
  const arr = f.arrivals ?? {};
  for (const it of f.items) {
    const day = arr[itemKey(it)];
    if (!day || day < "2026-09-01") continue;
    const w = weekStart(new Date(`${day}T03:00:00Z`));
    const ct = String(it?.contractType ?? "").trim() || "blank";
    const pure = String(it?.aptNm ?? "").trim() && num(it.monthlyRent) === 0 && num(it.deposit) > 0;
    byWeek[w] ??= { all: {}, jeonse: {} };
    byWeek[w].all[ct] = (byWeek[w].all[ct] ?? 0) + 1;
    if (pure) byWeek[w].jeonse[ct] = (byWeek[w].jeonse[ct] ?? 0) + 1;
  }
}
for (const w of Object.keys(byWeek).sort()) {
  const { all, jeonse } = byWeek[w];
  const r = (o) => `신규 ${o["신규"] ?? 0} 갱신 ${o["갱신"] ?? 0} 빈칸 ${o.blank ?? 0} (갱신 아닌 줄 중 ${((100 * (o.blank ?? 0)) / Math.max(1, (o["신규"] ?? 0) + (o.blank ?? 0))).toFixed(1)}%)`;
  console.log(w, "| 전체", r(all), "| 순수전세", r(jeonse));
}
