/**
 * 3차 후보(#57). 결과를 보기 전에 정해 커밋했다(research/indicators-3/candidates.mjs로 처음 커밋, 13bc8bf) -
 * 결과(research/indicators-3/)를 보고 고치지 않는다. 매일 판정(scripts/indicator-backtest.mjs)에 같이 들어간다.
 *
 * 지표 하나에 변환은 둘까지, 거리는 3·6·12개월. 판정 기준은 1·2차와 같다
 * (scripts/indicator-backtest.mjs: 서울 부트스트랩 0.9 이상 + 5권역 중 4곳 이상).
 * 12개월은 공급(인허가) 때문에 이번에 처음 넣는다 - 이 라운드의 다른 후보도 12개월을 같이 잰다.
 *
 * lag: 가격지수는 두 달 늦게 나온다. 거래량과 같은 표에서 나오는 매입자 거주지는 한 달 뒤 값까지(lag 1),
 * ECOS 대출 잔액·인허가는 보수적으로 같은 달(lag 0)만.
 */

const ymi = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;
const toMap = (rows) => new Map((rows ?? []).filter(([, v]) => Number.isFinite(Number(v))).map(([m, v]) => [ymi(m), Number(v)]));

/** 인허가는 해마다 1월부터 쌓인 누계로 온다 - 달 값으로 푼다(1월은 그대로). */
export function monthlyFromYtd(rows) {
  const ytd = toMap(rows);
  const out = new Map();
  for (const [k, v] of ytd) {
    const month = (k % 12) + 1;
    if (month === 1) out.set(k, v);
    else if (ytd.has(k - 1)) out.set(k, v - ytd.get(k - 1));
  }
  return out;
}

const sumN = (map, t, n) => {
  let s = 0;
  for (let k = 0; k < n; k += 1) {
    if (!map.has(t - k)) return null;
    s += map.get(t - k);
  }
  return s;
};

export function candidates3(series) {
  const total = toMap(series.buyer_total_seoul);
  const outside = toMap(series.buyer_outside_seoul);
  const bal = toMap(series.mort_bal);
  const balSeoul = toMap(series.mort_bal_seoul);
  const permits = monthlyFromYtd(series.permits_seoul);

  // 서울 밖에 사는 사람이 산 서울 아파트 비중(3개월 합으로 - 한 달 표본은 흔들린다).
  const share = (t) => {
    const a = sumN(outside, t, 3);
    const b = sumN(total, t, 3);
    return a === null || !b ? null : a / b;
  };
  const growth12 = (map, t) => (map.has(t) && map.has(t - 12) && map.get(t - 12) > 0 ? [Math.log(map.get(t) / map.get(t - 12))] : null);
  const s12 = (t) => sumN(permits, t, 12);
  const logRatio = (a, b) => (a && b && a > 0 && b > 0 ? [Math.log(a / b)] : null);

  return [
    { id: "out_share", ko: "서울 아파트 외지인 매입 비중", en: "Share of Seoul apartments bought by non-Seoul residents", lags: [0, 1],
      fn: (t) => { const v = share(t); return v === null ? null : [v]; } },
    { id: "out_share12", ko: "외지인 매입 비중 12개월 변화", en: "Non-resident buyer share, 12-month change", lags: [0, 1],
      fn: (t) => { const a = share(t); const b = share(t - 12); return a === null || b === null ? null : [a - b]; } },
    { id: "mort_bal12", ko: "주택관련대출 잔액(전국 은행) 12개월 증가율", en: "Bank housing-loan balance (Korea), 12-month growth", lags: [0],
      fn: (t) => growth12(bal, t) },
    { id: "mort_bal_seoul12", ko: "주택관련대출 잔액(서울 은행) 12개월 증가율", en: "Bank housing-loan balance (Seoul), 12-month growth", lags: [0],
      fn: (t) => growth12(balSeoul, t) },
    { id: "permits12", ko: "서울 주택 인허가 12개월 합 전년 대비", en: "Seoul housing permits, 12-month sum year on year", lags: [0],
      fn: (t) => logRatio(s12(t), s12(t - 12)) },
    { id: "permits_lag36", ko: "3년 전 서울 주택 인허가(지금 들어오는 공급) 전년 대비", en: "Seoul housing permits 3 years earlier (supply arriving now), year on year", lags: [0],
      fn: (t) => logRatio(s12(t - 36), s12(t - 48)) },
  ];
}
