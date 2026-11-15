// 지금 씨앗(20261001)으로 band 2000·money 4000 이면 공개 숫자가 어떻게 바뀌나(완료 조건 4 미리보기).
import { readFileSync } from "node:fs";
const at = (f) => JSON.parse(readFileSync(new URL(`./out/${f}.json`, import.meta.url), "utf8"));
const pub = JSON.parse(readFileSync(new URL("../../docs/data/district-change.json", import.meta.url), "utf8"));
const rPct = (x) => Math.round(Math.expm1(x) * 1000) / 10;
const s = 20261001;
for (const R of [400, 2000]) {
  const b = at(`band-${R}-${s}`);
  const rows = pub.rows.filter((r) => r.change !== null);
  let changed = 0, maxd = 0;
  for (const r of rows) { const [lo, hi] = b[r.code].map(rPct); if (lo !== r.low || hi !== r.high) changed++; maxd = Math.max(maxd, Math.abs(lo - r.low), Math.abs(hi - r.high)); }
  const codes = Object.keys(b).sort(); let n = 0;
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) { const [x, y] = [b[codes[i]].map(rPct), b[codes[j]].map(rPct)]; if (x[0] > y[1] || y[0] > x[1]) n++; }
  console.log(`band ${R}: 구간이 바뀐 구 ${changed}/${rows.length}, 끝값 최대 이동 ${maxd.toFixed(1)}%p, 갈라 볼 수 있는 쌍 ${n}/276 (공개 ${Object.values(pub.pairs).filter(Boolean).length}), 성동 ${b["11200"].map(rPct)} 노원 ${b["11350"].map(rPct)}`);
}
for (const R of [200, 4000]) {
  const m = at(`money-${R}-${s}`); let sure = 0, flip = 0, ch = 0;
  for (const [k, v] of Object.entries(m)) { const [lo, hi] = [Math.round(v.low), Math.round(v.high)]; const a = lo > 0 || hi < 0; if (a) sure++; const p = pub.money[k]; if (a !== (p.low > 0 || p.high < 0)) flip++; if (lo !== p.low || hi !== p.high) ch++; }
  console.log(`money ${R}: 말할 수 있는 쌍 ${sure}/276 (공개 ${Object.values(pub.money).filter((v) => v.low > 0 || v.high < 0).length}), 답 한 줄이 바뀌는 쌍 ${flip}, 구간 숫자가 바뀌는 쌍 ${ch}`);
}
