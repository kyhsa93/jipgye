// #908 후보 규칙 - PREREG.md 에 적은 그대로. 모든 규칙은 "up" | "down" | "none" 을 낸다.
// 끝값은 Math.round 한 뒤 견준다(공개 파일은 만원 정수). 폭(margin)은 반올림하지 않는다.
// 값은 측정 전에 PREREG.md 에 고정했고 결과를 본 뒤 바꾸지 않는다.

export const Z = 1.645; // 한쪽 5% - 90% 구간의 양 끝이 쓰는 수준과 같다
export const P = 0.05;
export const ROUNDS = 4000; // main 8eb314f7 의 MONEY_ROUNDS(scripts/district-change.ts:207)
const phi = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
/** 정규 근사로 본 (ROUNDS 번에서 5% 끝값의 추첨 표준오차) ÷ (90% 구간 폭). */
export const KAPPA = Math.sqrt(P * (1 - P) / ROUNDS) / phi(Z) / (2 * Z);
/** (나) 폭 = C_WIDTH × (high − low). */
export const C_WIDTH = Z * KAPPA;
/** (가) 끝값이 50만원 미만이면 영어 화면에서 0 으로 적힌다(eokText: ₩ Math.round(n / 100) M). */
export const X_FIXED = 50;
/** (다) 빌드 때 지금 씨앗 말고 더 돌리는 씨앗 수. */
export const K_EXTRA = 3;

const dir = (lo, hi, mLo, mHi) => (lo > mLo ? "up" : hi < -mHi ? "down" : "none");

/**
 * m: 반올림 전 { low, high, seLow, seHigh }.
 * ctx.sdLow / ctx.sdHigh: (다) - 그 규칙이 쓰는 씨앗 묶음에서 끝값의 표본표준편차.
 */
export const RULES = {
  ra: (m) => dir(Math.round(m.low), Math.round(m.high), 0, 0), // (라) 규칙 없음 - 지금 인라인 규칙 그대로
  ga: (m) => (Math.round(m.low) >= X_FIXED ? "up" : Math.round(m.high) <= -X_FIXED ? "down" : "none"),
  na: (m) => { const w = C_WIDTH * (m.high - m.low); return dir(Math.round(m.low), Math.round(m.high), w, w); },
  da2: (m) => dir(Math.round(m.low), Math.round(m.high), Z * m.seLow, Z * m.seHigh),
  da: (m, ctx) => dir(Math.round(m.low), Math.round(m.high), Z * ctx.sdLow, Z * ctx.sdHigh),
};
/** 동률일 때 고르는 순서(단순한 것 먼저). */
export const ORDER = ["ra", "ga", "na", "da2", "da"];
export const LABEL = { ra: "(라) 규칙 없음", ga: "(가) 고정 50만원", na: "(나) 폭 비례", da2: "(다′) 순서통계량", da: "(다) 씨앗 4개" };

export const sampleSd = (xs) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
};
