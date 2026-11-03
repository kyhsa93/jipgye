// 슬롯 동결 측정의 문턱 재료(#820). API를 부르지 않고 저장된 원본만 읽는다. 행을 무작위로 지웠을 때 시세 칸이 얼마나 움직이는지 잰다.
//
//   node research/slot-freeze-2026-11/dose.mjs [저장소 경로] > research/slot-freeze-2026-11/dose.out
//
// 숨은 해제의 크기를 추정하는 계산이 아니다. "행이 r% 빠지면 칸이 이만큼 움직인다"는 환산표다(PREREG 4절).
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../.."));
const { districtCells, indexLevels, marketDeal, referenceMonth, windowStart } = await import(path.join(root, "scripts/complex-price.ts"));
const { DISTRICTS } = await import(path.join(root, "scripts/realestate-districts.ts"));
const { recentMonths } = await import(path.join(root, "scripts/realestate-source.ts"));

const NOW = new Date("2026-11-03T05:00:00Z");
const REPS = 100;
const RATES = [0.25, 0.5, 1, 1.5, 2, 3, 5];
const SCENARIOS = {
  "202605~08": new Set(["202605", "202606", "202607", "202608"]),
  "202607~08": new Set(["202607", "202608"]),
};

const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const { levels } = indexLevels(read("raw/ecos/apt-price-index.json"), read("docs/data/outlook.json"));
const reference = referenceMonth(levels);
const since = windowStart(NOW);
const months = recentMonths(NOW, 7);

const dealsByDistrict = DISTRICTS.map(({ code }) =>
  months.flatMap((m) => read(`raw/sale/${code}-${m}.json`).items.map(marketDeal).filter((d) => d && d.date >= since))
);

const medians = (cells) => {
  const out = new Map();
  for (const [apt, areas] of Object.entries(cells)) {
    for (const [name, cell] of Object.entries(areas)) if (cell.median) out.set(`${apt}\u0000${name}`, cell.median);
  }
  return out;
};
const base = dealsByDistrict.map((deals) => medians(districtCells(deals, levels, reference)));
const baseCells = base.reduce((a, m) => a + m.size, 0);

let seed = 820;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function once(rate, inScope) {
  let removed = 0;
  let moved = 0;
  let lost = 0;
  let gained = 0;
  let band = 0;
  dealsByDistrict.forEach((deals, i) => {
    const kept = deals.filter((d) => {
      if (!inScope.has(d.month) || rnd() >= rate) return true;
      removed += 1;
      return false;
    });
    const after = medians(districtCells(kept, levels, reference));
    for (const [key, before] of base[i]) {
      const now = after.get(key);
      if (now === undefined) {
        lost += 1;
        continue;
      }
      if (Math.abs(now - before) / before >= 0.01) moved += 1;
      if (Math.floor(now / 10000) !== Math.floor(before / 10000)) band += 1;
    }
    for (const key of after.keys()) if (!base[i].has(key)) gained += 1;
  });
  return { removed, changed: moved + lost + gained, moved, lost, gained, band };
}

const sorted = (a) => [...a].sort((x, y) => x - y);
const summary = (a) => {
  const s = sorted(a);
  const avg = s.reduce((x, y) => x + y, 0) / s.length;
  return `${avg.toFixed(1)} (${s[Math.floor(s.length * 0.05)]}~${s[Math.floor(s.length * 0.95)]})`;
};
const share = (a) => {
  const avg = a.reduce((x, y) => x + y, 0) / a.length;
  return ((avg / baseCells) * 100).toFixed(2);
};

console.log(`기준 시각 ${NOW.toISOString()}, 창 시작 ${since}, 기준 달 ${reference}, n≥3 칸 ${baseCells}, 시드 820, 반복 ${REPS}`);
console.log(`칸 변화 = |Δ|≥1% + n≥3 탈락 + n≥3 진입. 괄호는 반복의 P5~P95.`);
for (const [label, scope] of Object.entries(SCENARIOS)) {
  const rows = dealsByDistrict.flat().filter((d) => scope.has(d.month)).length;
  console.log(`\n시나리오: 창 안 ${label} 시장 거래 ${rows}행에서 무작위 제거`);
  console.log("r% | 지운 행 | 칸 변화 | 칸 변화% | |Δ|≥1% | 탈락 | 진입 | 억 구간 | 억 구간%");
  for (const pct of RATES) {
    const runs = Array.from({ length: REPS }, () => once(pct / 100, scope));
    const col = (k) => runs.map((r) => r[k]);
    console.log(
      [pct, summary(col("removed")), summary(col("changed")), share(col("changed")), summary(col("moved")), summary(col("lost")), summary(col("gained")), summary(col("band")), share(col("band"))].join(" | ")
    );
  }
}
