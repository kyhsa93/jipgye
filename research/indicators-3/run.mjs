// 3차 후보 백테스트. node research/indicators-3/run.mjs → 표준출력 + cache/result.json
import { readFile, writeFile } from "node:fs/promises";
import { INDEX_FILE } from "../../scripts/fetch-price-index.mjs";
import { REGION_WINS, priceSeries, score } from "../../scripts/indicator-backtest.mjs";
import { candidates3 } from "../../scripts/indicator-candidates-3.mjs";

const HORIZONS = [3, 6, 12];
const index = JSON.parse(await readFile(INDEX_FILE, "utf8"));
const series = JSON.parse(await readFile(new URL("./cache/series.json", import.meta.url), "utf8"));
const prices = Object.fromEntries(Object.entries(index.series).map(([c, rows]) => [c, priceSeries(rows)]));
const seoul = prices["200"];
const regions = Object.entries(prices).filter(([c]) => c !== "200");

// 지표 없이 푼 기준선이 3·6·12개월에 얼마나 빗나가는지(같은 오리진에서 지표가 있으면 바뀐다 - 행마다 base를 같이 적는다).
const out = [];
let shots = 0;
for (const c of candidates3(series)) {
  for (const lag of c.lags) {
    const row = { id: c.id, ko: c.ko, lag, h: {} };
    for (const h of HORIZONS) {
      shots += 1;
      const s = score(seoul, h, c.fn, lag);
      if (s?.passes) {
        s.regionWins = regions.filter(([, p]) => score(p, h, c.fn, lag)?.passes).length;
        s.regions = regions.length;
      }
      row.h[h] = s;
    }
    row.leads = HORIZONS.filter((h) => row.h[h]?.passes && row.h[h].regionWins >= REGION_WINS);
    out.push(row);
    const cell = (s) => (s ? `${s.base}→${s.with} (${s.win})${s.passes ? ` 권역 ${s.regionWins}/${s.regions}` : ""}` : "-");
    console.log(`${c.ko}${lag ? ` (+${lag})` : ""} | 3개월 ${cell(row.h[3])} | 6개월 ${cell(row.h[6])} | 12개월 ${cell(row.h[12])}${row.leads.length ? `  ← 앞섬 ${row.leads.join(",")}` : ""}`);
  }
}
console.log(`쏜 횟수 ${shots}`);
await writeFile(new URL("./cache/result.json", import.meta.url), JSON.stringify({ shots, rows: out }, null, 2));
