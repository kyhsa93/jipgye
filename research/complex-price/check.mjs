// #10 완료 조건 1(#32 뒤로 면적 묶음 반영): 2026-06·07 계약을 직전 183일 같은 칸(scripts/complex-price.mjs 규칙)으로 견준 치우침.
// 서울 ±1%p, 자치구 잔여 ±2.5%p 안이어야 한다. 데이터에 따라 갈리므로 테스트가 아니라 이 스크립트로 잰다(#8).
// 저장소 루트에서: node research/complex-price/check.mjs
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { adjust, areaGroups, indexLevels, marketDeal, MIN_DEALS, WINDOW_DAYS } from "../../scripts/complex-price.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const index = JSON.parse(await readFile(path.join(root, "raw/ecos/apt-price-index.json"), "utf8"));
const { levels } = indexLevels(index, null); // 대상 달(6·7월)은 공식 지수가 있다 - 메운 달 없이 잰다
const deals = [];
for (const f of await readdir(path.join(root, "raw/sale"))) {
  const file = JSON.parse(await readFile(path.join(root, "raw/sale", f), "utf8"));
  for (const item of file.items ?? []) {
    const d = marketDeal(item);
    if (d) deals.push(d);
  }
}
// 화면과 같이 같은 단지 안 1㎡ 안쪽 면적은 한 칸으로 묶는다(#32).
const byApt = new Map();
for (const d of deals) {
  const k = `${d.district}|${d.apt}`;
  if (!byApt.has(k)) byApt.set(k, []);
  byApt.get(k).push(d);
}
for (const group of byApt.values()) {
  const label = areaGroups(group);
  for (const d of group) d.area = label.get(d.area);
}
const byCell = new Map();
for (const d of deals) {
  const k = `${d.district}|${d.apt}|${d.area}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(d);
}
const med = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const day = 86400000;
const gaps = new Map();
let all = [];
let fit = 0;
let targets = 0;
for (const d of deals) {
  if (d.month !== "202606" && d.month !== "202607") continue;
  targets += 1;
  const t0 = Date.parse(d.date);
  const prior = byCell.get(`${d.district}|${d.apt}|${d.area}`).filter((x) => {
    const t = Date.parse(x.date);
    return t < t0 && t >= t0 - WINDOW_DAYS * day;
  });
  if (prior.length < MIN_DEALS) continue;
  fit += 1;
  const ref = prior.map((x) => adjust(x, levels, d.month).value);
  const g = d.amount / med(ref) - 1;
  all.push(g);
  if (!gaps.has(d.district)) gaps.set(d.district, []);
  gaps.get(d.district).push(g);
}
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
console.log(`대상 ${targets}건 중 직전 ${MIN_DEALS}건↑ ${fit}건 (${((fit / targets) * 100).toFixed(1)}%), 서울 치우침 ${pct(med(all))}`);
const rows = [...gaps].map(([k, v]) => [k, med(v), v.length]).sort((a, b) => a[1] - b[1]);
for (const [k, m, n] of rows) console.log(`  ${k} ${pct(m)} (n=${n})${Math.abs(m) > 0.025 ? "  ← ±2.5%p 밖" : ""}`);
console.log(`자치구 잔여 ${pct(rows[0][1])} ~ ${pct(rows.at(-1)[1])}`);
