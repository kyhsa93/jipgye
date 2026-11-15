// #908 측정 계산. scripts/district-change.ts moneyGapRaw(main 8eb314f7)와 같은 LCG·같은 추첨 순서(한 판마다 A 칸 전부 → B 칸 전부)·
// 같은 중앙값·같은 간격 식. 측정 전에 verify-908.mjs 가 change·low·high 를 그 함수와 Object.is 로 견준다.
// change·low·high 말고 (다′)가 쓰는 순서통계량을 같은 정렬된 sims 에서 같이 낸다.
export const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; };
const medSorted = (a) => { const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const medianOf = (arr) => medSorted(Float64Array.from(arr).sort());
const AREA = 84;
export const prepCells = (cells) => ({ r: Float64Array.from(cells, (c) => c.r), lr: Float64Array.from(cells, (c) => Math.log(c.r / c.b)) });
const levelsOf = (r, lr) => { const recent = medianOf(r) * AREA; return { recent, base: recent / Math.exp(medianOf(lr)) }; };

/** p 분위수의 순서통계량 표준오차 순위 반폭: round(sqrt(R p (1-p))). R=4000, p=0.05 → 14. */
export const rankHalfWidth = (rounds, p = 0.05) => Math.round(Math.sqrt(rounds * p * (1 - p)));

/**
 * 반올림 전 { change, low, high, seLow, seHigh } (만원).
 * seLow  = (sims[iLo + m] − sims[iLo − m]) / 2, iLo = floor(R × 0.05)
 * seHigh = (sims[iHi + m] − sims[iHi − m]) / 2, iHi = floor(R × 0.95), m = rankHalfWidth(R)
 */
export function moneyFull(A, B, rounds, seed) {
  const next = lcg(seed);
  const nA = A.r.length, nB = B.r.length;
  const rA = new Float64Array(nA), lA = new Float64Array(nA), rB = new Float64Array(nB), lB = new Float64Array(nB);
  const sims = new Float64Array(rounds);
  for (let i = 0; i < rounds; i++) {
    for (let k = 0; k < nA; k++) { const j = Math.floor(next() * nA); rA[k] = A.r[j]; lA[k] = A.lr[j]; }
    const aRecent = medSorted(rA.sort()) * AREA; const aBase = aRecent / Math.exp(medSorted(lA.sort()));
    for (let k = 0; k < nB; k++) { const j = Math.floor(next() * nB); rB[k] = B.r[j]; lB[k] = B.lr[j]; }
    const bRecent = medSorted(rB.sort()) * AREA; const bBase = bRecent / Math.exp(medSorted(lB.sort()));
    sims[i] = bRecent - aRecent - (bBase - aBase);
  }
  sims.sort();
  const [la, lb] = [levelsOf(A.r, A.lr), levelsOf(B.r, B.lr)];
  const iLo = Math.floor(rounds * 0.05), iHi = Math.floor(rounds * 0.95), m = rankHalfWidth(rounds);
  return {
    change: lb.recent - la.recent - (lb.base - la.base),
    low: sims[iLo],
    high: sims[iHi],
    seLow: (sims[Math.min(iLo + m, rounds - 1)] - sims[Math.max(iLo - m, 0)]) / 2,
    seHigh: (sims[Math.min(iHi + m, rounds - 1)] - sims[Math.max(iHi - m, 0)]) / 2,
  };
}
