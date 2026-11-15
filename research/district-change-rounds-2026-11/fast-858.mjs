// district-change.ts 의 band·moneyGap 과 같은 결과를 내는 빠른 구현(같은 LCG, 같은 추첨 순서, 같은 중앙값).
// 차이: 칸마다 r·log(r/b) 를 미리 계산하고 Float64Array 정렬을 쓴다. 값은 같아야 한다 - verify 로 확인.
export const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; };
const medSorted = (a) => { const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const medianOf = (arr) => { const s = Float64Array.from(arr).sort(); return medSorted(s); };

/** band 와 같은 5%·95% 값(로그 변화, 반올림 전). */
export function bandFast(values, rounds, seed) {
  const next = lcg(seed); const n = values.length; const buf = new Float64Array(n); const meds = new Float64Array(rounds);
  for (let i = 0; i < rounds; i++) { for (let k = 0; k < n; k++) buf[k] = values[Math.floor(next() * n)]; buf.sort(); meds[i] = medSorted(buf); }
  meds.sort();
  return [meds[Math.floor(rounds * 0.05)], meds[Math.floor(rounds * 0.95)]];
}

const AREA = 84;
export const prepCells = (cells) => ({ r: Float64Array.from(cells, (c) => c.r), lr: Float64Array.from(cells, (c) => Math.log(c.r / c.b)) });
const levelsOf = (r, lr) => { const recent = medianOf(r) * AREA; return { recent, base: recent / Math.exp(medianOf(lr)) }; };

/** moneyGap 과 같은 { change, low, high } 를 반올림 전 값으로. */
export function moneyFast(A, B, rounds, seed) {
  const next = lcg(seed);
  const gapOf = (ra, la, rb, lb) => {
    const [x, y] = [levelsOf(ra, la), levelsOf(rb, lb)];
    return y.recent - x.recent - (y.base - x.base);
  };
  const nA = A.r.length, nB = B.r.length;
  const rA = new Float64Array(nA), lA = new Float64Array(nA), rB = new Float64Array(nB), lB = new Float64Array(nB);
  const sims = new Float64Array(rounds);
  for (let i = 0; i < rounds; i++) {
    for (let k = 0; k < nA; k++) { const j = Math.floor(next() * nA); rA[k] = A.r[j]; lA[k] = A.lr[j]; }
    for (let k = 0; k < nB; k++) { const j = Math.floor(next() * nB); rB[k] = B.r[j]; lB[k] = B.lr[j]; }
    rA.sort(); lA.sort(); rB.sort(); lB.sort();
    const xa = { recent: medSorted(rA) * AREA }; xa.base = xa.recent / Math.exp(medSorted(lA));
    const xb = { recent: medSorted(rB) * AREA }; xb.base = xb.recent / Math.exp(medSorted(lB));
    sims[i] = xb.recent - xa.recent - (xb.base - xa.base);
  }
  sims.sort();
  return { change: gapOf(A.r, A.lr, B.r, B.lr), low: sims[Math.floor(rounds * 0.05)], high: sims[Math.floor(rounds * 0.95)] };
}
