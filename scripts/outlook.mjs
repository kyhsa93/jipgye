/**
 * 서울 아파트값이 몇 달 뒤 어디쯤 있을까 - 그리고 그 짐작이 지난 14년 동안 얼마나 틀렸나.
 *
 * 이 사이트는 오래 "전망은 하지 않는다"를 지켰다. 예측을 내는 순간 표본을 밝히는 것이
 * 차별점인 곳이 그냥 하나 더 있는 전망 매체가 되기 때문이다. 그래서 예측을 내되
 * <strong>예측보다 오차를 먼저 적는다.</strong> 같은 방식의 예측을 과거 매달 다시 해 보고
 * (백테스트) 실제와 얼마나 벌어졌는지를 같이 싣고, 아무 생각 없이 찍는 두 기준선
 * ("그대로다", "지금까지처럼 오른다")을 이기지 못하는 칸은 값을 비운다.
 *
 * 대상은 한국부동산원 아파트 매매 실거래가격지수(ECOS 901Y089)다. 우리가 매일 받는 것과
 * 같은 국토부 신고로 만든 반복거래 지수라 단지 구성이 바뀌어도 흔들리지 않고, 2006년부터
 * 서울과 5개 권역이 있다. 자치구는 없다 - 그래서 이 화면도 자치구 값을 내지 않는다.
 *
 * 모델은 일부러 작다. 지난 몇 달의 상승률로 h달 뒤를 바로 회귀하는 것(직접 예측)이
 * 전부다. 기준금리 변화와 전세 상승률을 더 넣어 봤지만 3개월 오차가 2.44%p에서
 * 2.38%p로 줄었을 뿐이었다(2026-10-01, 서울) - 입력 둘을 매일 더 받아 올 값이 없다.
 */

/** 예측하는 거리(개월). 공식 지수의 마지막 달에서 센다. */
export const HORIZONS = [3, 6, 12];

/**
 * 백테스트를 시작하는 달. 지수가 2006-01부터라 그 앞 6년을 학습에 쓴다.
 * 첫 예측이 볼 수 있는 과거가 너무 짧으면 회귀가 흔들려 오차가 부풀고, 그 부푼 오차가
 * 화면의 범위를 넓힌다.
 */
export const BACKTEST_FROM = "201201";

/** 회귀에 쓰는 과거: 지난달, 그 전달, 그 앞 넉 달의 평균. */
export const LAGS = 6;

/**
 * 모델이 기준선을 이겼다고 말하려면 얼마나 자주 이겨야 하나.
 *
 * 오차 시계열을 12개월 덩어리째 다시 뽑아(블록 부트스트랩) 평균 오차를 견준다. 겹치는
 * 예측의 오차는 서로 붙어 다녀서 한 달씩 뽑으면 우연을 실력으로 읽는다. 다시 뽑은 것의
 * 90%에서 두 기준선을 다 이겨야 값을 낸다.
 */
export const WIN_SHARE = 0.9;
export const BLOCK = 12;
export const ROUNDS = 1000;

/** 화면에 싣는 범위. 지난 예측 오차의 가운데 80%. */
export const BAND = [0.1, 0.9];

export const REGIONS = [
  { code: "200", name: { ko: "서울", en: "Seoul" } },
  { code: "210", name: { ko: "도심권", en: "Central" }, districts: ["11110", "11140", "11170"] },
  {
    code: "220",
    name: { ko: "동북권", en: "Northeast" },
    districts: ["11200", "11215", "11230", "11260", "11290", "11305", "11320", "11350"],
  },
  { code: "240", name: { ko: "서북권", en: "Northwest" }, districts: ["11380", "11410", "11440"] },
  {
    code: "250",
    name: { ko: "서남권", en: "Southwest" },
    districts: ["11470", "11500", "11530", "11545", "11560", "11590", "11620"],
  },
  { code: "230", name: { ko: "동남권", en: "Southeast" }, districts: ["11650", "11680", "11710", "11740"] },
];

const round2 = (value) => Math.round(value * 100) / 100;
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

export function shiftMonth(yearMonth, delta) {
  const index = Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(4, 6)) - 1 + delta;
  return `${Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, "0")}`;
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * [["200601", 28.8], ...]를 빈 달 없는 로그 계열로. 중간에 달이 빠지면 거기서 끊는다 -
 * 빠진 달을 건너뛰고 이으면 두 달치 변화가 한 달 변화로 읽힌다.
 */
export function toSeries(rows) {
  const sorted = [...rows].filter(([, v]) => v > 0).sort(([a], [b]) => (a < b ? -1 : 1));
  const months = [];
  const logs = [];
  for (const [month, value] of sorted) {
    if (months.length && shiftMonth(months.at(-1), 1) !== month) {
      months.length = 0;
      logs.length = 0;
    }
    months.push(month);
    logs.push(Math.log(value));
  }
  return { months, logs };
}

/** i번째 달에서 볼 수 있는 입력. 앞의 LAGS달이 없으면 null. */
function features(logs, i) {
  if (i < LAGS) return null;
  const r = (k) => logs[k] - logs[k - 1];
  return [1, r(i), r(i - 1), mean([r(i - 2), r(i - 3), r(i - 4), r(i - 5)])];
}

/** 최소제곱. 열이 넷뿐이라 정규방정식을 가우스 소거로 바로 푼다. */
export function leastSquares(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let n = 0; n < X.length; n += 1) {
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) A[i][j] += X[n][i] * X[n][j];
      A[i][k] += X[n][i] * y[n];
    }
  }
  for (let col = 0; col < k; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < k; row += 1) if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) return null;
    for (let row = 0; row < k; row += 1) {
      if (row === col) continue;
      const f = A[row][col] / A[col][col];
      for (let j = col; j <= k; j += 1) A[row][j] -= f * A[col][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/**
 * origin달까지만 보고 h달 뒤의 로그 변화를 짐작한다. 세 가지를 같이 낸다.
 *
 * - naive: 그대로다(0).
 * - drift: 지금까지의 평균 월 상승률이 이어진다. 2012~2026의 서울은 거의 늘 올랐으므로
 *   이 기준선이 의외로 세다. 12개월에서는 회귀 모델이 이걸 못 이긴다.
 * - model: 지난 몇 달의 상승률로 h달 뒤를 바로 회귀한다. 학습은 origin 시점에 이미
 *   결과가 나와 있던 것(j + h <= origin)만 쓴다 - 미래를 엿보면 백테스트가 거짓말을 한다.
 */
export function predict(logs, origin, h) {
  const x = features(logs, origin);
  if (!x) return null;

  const X = [];
  const y = [];
  for (let j = LAGS; j + h <= origin; j += 1) {
    X.push(features(logs, j));
    y.push(logs[j + h] - logs[j]);
  }
  if (X.length < 24) return null;
  const beta = leastSquares(X, y);
  if (!beta) return null;

  const steps = logs.slice(1, origin + 1).map((v, k) => v - logs[k]);
  return {
    naive: 0,
    drift: h * mean(steps),
    model: x.reduce((sum, v, k) => sum + v * beta[k], 0),
  };
}

/** 과거 매달을 그 시점에 서서 다시 예측해 보고, 실제와의 차이(%p)를 모은다. */
export function backtest({ months, logs }, h, from = BACKTEST_FROM) {
  const rows = [];
  for (let i = 0; i + h < logs.length; i += 1) {
    if (months[i] < from) continue;
    const guess = predict(logs, i, h);
    if (!guess) continue;
    const actual = (logs[i + h] - logs[i]) * 100;
    rows.push({
      origin: months[i],
      actual,
      naive: actual - guess.naive * 100,
      drift: actual - guess.drift * 100,
      model: actual - guess.model * 100,
      up: guess.model > 0,
    });
  }
  return rows;
}

/**
 * 덩어리째 다시 뽑아 모델이 두 기준선을 다 이긴 비율. 씨앗을 고정한다 - 같은 입력에
 * 빌드마다 다른 판정이 나오면 그것부터가 오류다.
 */
export function winShare(rows, { rounds = ROUNDS, block = BLOCK, seed = 20261001 } = {}) {
  if (rows.length < block * 2) return 0;
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };

  let wins = 0;
  for (let round = 0; round < rounds; round += 1) {
    let model = 0;
    let naive = 0;
    let drift = 0;
    let n = 0;
    while (n < rows.length) {
      const start = Math.floor(next() * (rows.length - block + 1));
      for (let k = start; k < start + block && n < rows.length; k += 1, n += 1) {
        model += Math.abs(rows[k].model);
        naive += Math.abs(rows[k].naive);
        drift += Math.abs(rows[k].drift);
      }
    }
    if (model < naive && model < drift) wins += 1;
  }
  return wins / rounds;
}

/** 한 권역 × 한 거리의 성적표와, 이겼으면 오늘의 예측. */
export function forecastCell(series, h) {
  const rows = backtest(series, h);
  if (!rows.length) return null;

  const mae = (key) => round2(mean(rows.map((row) => Math.abs(row[key]))));
  const errors = rows.map((row) => row.model).sort((a, b) => a - b);
  const share = winShare(rows);

  // 방향 적중. "늘 오른다"고 찍었을 때의 적중도 같이 둔다 - 오르는 시기만 있었다면
  // 모델의 적중률 80%는 아무것도 아니다.
  const moved = rows.filter((row) => Math.abs(row.actual) >= 0.5);
  const hit = moved.length ? round2((moved.filter((row) => row.up === row.actual > 0).length / moved.length) * 100) : null;
  const alwaysUp = moved.length ? round2((moved.filter((row) => row.actual > 0).length / moved.length) * 100) : null;

  const card = {
    h,
    origins: rows.length,
    from: rows[0].origin,
    mae: { model: mae("model"), naive: mae("naive"), drift: mae("drift") },
    hit,
    alwaysUp,
    winShare: round2(share),
    beats: share >= WIN_SHARE,
    forecast: null,
  };

  if (!card.beats) return card;

  const last = series.logs.length - 1;
  const guess = predict(series.logs, last, h);
  if (!guess) return card;

  // 범위는 지난 오차를 오늘 예측에 더한 것이다. 오차 = 실제 - 예측이므로 그대로 더한다.
  const point = guess.model * 100;
  card.forecast = {
    target: shiftMonth(series.months[last], h),
    change: round2(point),
    // 두 기준선 가운데 "늘 오른다"의 값. "그대로다"는 늘 0이라 적지 않는다. 채점 때 모델이
    // 기준선을 이겼는지 보려면 그날 낸 값이 남아 있어야 한다 - 나중에 다시 계산하면 고쳐진 지수가 섞인다(#64).
    drift: round2(guess.drift * 100),
    low: round2(point + quantile(errors, BAND[0])),
    high: round2(point + quantile(errors, BAND[1])),
  };
  return card;
}

/**
 * 범위가 실시간으로 얼마나 들었나. 매달 그 시점에 서서, 그때까지 결과가 나와 있던 오차
 * (j + h <= i)만으로 범위를 만들었다면 그 달의 오차가 범위 안이었나를 센다.
 *
 * 화면에 싣는 범위는 14년치 오차 전체의 가운데 80%라 그 14년에는 80%가 든다(순환). 실제로는
 * 앞선 오차만 볼 수 있었으므로 이쪽이 "그때 냈다면"에 가깝다. 시작은 2014-01 - 2012-01부터
 * 쌓은 오차가 한 해 가까이는 있어야 분위가 흔들리지 않는다.
 */
export const COVERAGE_FROM = "201401";

export function realtimeCoverage(series, h, from = COVERAGE_FROM) {
  const rows = backtest(series, h);
  const at = new Map(series.months.map((month, i) => [month, i]));
  const out = [];
  for (const row of rows) {
    if (row.origin < from) continue;
    const i = at.get(row.origin);
    const past = rows
      .filter((p) => at.get(p.origin) + h <= i)
      .map((p) => p.model)
      .sort((a, b) => a - b);
    if (!past.length) continue;
    out.push({
      origin: row.origin,
      error: row.model,
      inside: row.model >= quantile(past, BAND[0]) && row.model <= quantile(past, BAND[1]),
    });
  }
  return out;
}

const pearson = (a, b) => {
  const [ma, mb] = [mean(a), mean(b)];
  let ab = 0;
  let aa = 0;
  let bb = 0;
  a.forEach((v, i) => {
    ab += (v - ma) * (b[i] - mb);
    aa += (v - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  });
  return ab / Math.sqrt(aa * bb);
};

/**
 * 값을 내는 권역들의 실시간 범위 적중을 한 묶음으로. method.html의 사전 등록 문단이 인용하는
 * 숫자(64%, 2022년 이후 71~75%, 범위 안 개수 분포, 권역 간 오차 상관)가 전부 여기서 나온다.
 * 문서의 숫자는 이 값을 옮겨 적은 것이라 날짜가 붙어 있고, 이 값이 바뀌어도 판정표는 바뀌지 않는다.
 */
export function coverageSummary(entries, h = 3, since = "202201") {
  const rowsBy = entries.map(({ code, series }) => ({ code, rows: realtimeCoverage(series, h) }));
  if (!rowsBy.length) return null;
  const all = rowsBy.flatMap(({ rows }) => rows);
  const byOrigin = new Map();
  for (const { rows } of rowsBy) for (const row of rows) byOrigin.set(row.origin, [...(byOrigin.get(row.origin) ?? []), row]);
  const full = [...byOrigin.values()].filter((rows) => rows.length === rowsBy.length);
  const countDist = new Array(rowsBy.length + 1).fill(0);
  for (const rows of full) countDist[rows.filter((r) => r.inside).length] += 1;

  const corr = [];
  for (let i = 0; i < rowsBy.length; i += 1) {
    for (let j = i + 1; j < rowsBy.length; j += 1) {
      const shared = rowsBy[i].rows.filter((r) => rowsBy[j].rows.some((x) => x.origin === r.origin));
      const other = new Map(rowsBy[j].rows.map((r) => [r.origin, r.error]));
      corr.push(pearson(shared.map((r) => r.error), shared.map((r) => other.get(r.origin))));
    }
  }
  return {
    h,
    from: all.map((r) => r.origin).sort()[0],
    to: all.map((r) => r.origin).sort().at(-1),
    regions: rowsBy.map(({ code }) => code),
    origins: all.length,
    inside: all.filter((r) => r.inside).length,
    since,
    sinceByRegion: Object.fromEntries(
      rowsBy.map(({ code, rows }) => {
        const part = rows.filter((r) => r.origin >= since);
        return [code, { n: part.length, inside: part.filter((r) => r.inside).length }];
      })
    ),
    countDist,
    countOrigins: full.length,
    errorCorr: { min: round2(Math.min(...corr)), max: round2(Math.max(...corr)) },
  };
}

// --- 공식 지수가 아직 안 나온 달 ------------------------------------------------

/**
 * 실거래가격지수는 두 달 늦게 나온다. 10월 1일에 볼 수 있는 마지막 값이 7월이다.
 * 그 사이를 우리가 매일 받는 신고로 메운다 - 같은 단지·같은 동·같은 지번·같은 면적
 * (반올림 ㎡)을 한 칸으로 묶고, 이웃한 두 달 모두 거래가 있는 칸에서 ㎡당 중앙값이
 * 얼마나 변했는지의 중앙값을 그 달의 변화로 본다.
 *
 * 공식 지수와 겹치는 달에서 이 값을 견주어 얼마나 맞았는지를 같이 낸다. 겹치는 달이
 * 몇 달 안 되므로 치우침을 빼서 맞추지는 않는다 - 그 몇 달에 맞춘 보정은 다음 달에
 * 틀린다. 치우침은 그대로 적는다.
 */
export const MIN_PAIRS = 20;

export const cellKey = (item) =>
  [item.sggCd, item.umdNm, item.jibun, item.aptNm, Math.round(Number(item.excluUseAr))].join("|");

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** 신고 한 줄을 { district, cell, month, perM2 }로. 해제된 거래는 뺀다. */
export function toDeal(item) {
  if (String(item?.cdealType ?? "").trim()) return null;
  const price = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
  const area = Number(item?.excluUseAr);
  if (!(price > 0) || !(area > 0) || !item.dealYear || !item.dealMonth) return null;
  return {
    district: String(item.sggCd),
    cell: cellKey(item),
    month: `${item.dealYear}${String(item.dealMonth).padStart(2, "0")}`,
    perM2: price / area,
  };
}

/** 칸을 이어 붙인 월간 변화(%). 맞물린 칸이 모자라면 그 달은 값 없이 칸 수만 남긴다. */
export function chainChanges(deals, months) {
  const cells = new Map();
  for (const deal of deals) {
    if (!cells.has(deal.cell)) cells.set(deal.cell, new Map());
    const byMonth = cells.get(deal.cell);
    if (!byMonth.has(deal.month)) byMonth.set(deal.month, []);
    byMonth.get(deal.month).push(deal.perM2);
  }

  const out = [];
  for (let k = 1; k < months.length; k += 1) {
    const [a, b] = [months[k - 1], months[k]];
    const changes = [];
    for (const byMonth of cells.values()) {
      if (byMonth.has(a) && byMonth.has(b)) changes.push(Math.log(median(byMonth.get(b)) / median(byMonth.get(a))));
    }
    out.push({
      month: b,
      pairs: changes.length,
      change: changes.length >= MIN_PAIRS ? round2(median(changes) * 100) : null,
    });
  }
  return out;
}

/**
 * 한 권역의 메운 달과 그 성적. 공식 지수가 있는 달은 견주는 데 쓰고, 없는 달은 화면에
 * 싣는다. 견준 달이 여섯 달이 못 되거나, 견준 오차가 모델의 1개월 예측 오차보다 크면
 * 메운 값을 싣지 않는다 - 더 못한 짐작으로 빈칸을 채우는 것은 채우지 않느니만 못하다.
 */
export const MIN_OVERLAP = 6;

export function nowcast({ deals, months, official, oneMonthMae }) {
  const chain = chainChanges(deals, months);
  const officialChange = new Map();
  for (let k = 1; k < official.months.length; k += 1) {
    officialChange.set(official.months[k], (official.logs[k] - official.logs[k - 1]) * 100);
  }

  const overlap = chain.filter((row) => row.change !== null && officialChange.has(row.month));
  const diffs = overlap.map((row) => row.change - officialChange.get(row.month));
  const mae = diffs.length ? round2(mean(diffs.map(Math.abs))) : null;
  const bias = diffs.length ? round2(mean(diffs)) : null;

  const last = official.months.at(-1);
  const pending = chain.filter((row) => row.month > last);
  const usable = overlap.length >= MIN_OVERLAP && mae !== null && oneMonthMae !== null && mae < oneMonthMae;

  return {
    overlap: overlap.length,
    mae,
    bias,
    oneMonthMae,
    usable,
    months: pending.map((row) => ({ ...row, change: usable ? row.change : null })),
  };
}

// --- 문장 ---------------------------------------------------------------------

const ym = (month, locale) =>
  locale === "en"
    ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4)) - 1, 1)).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : `${month.slice(0, 4)}년 ${Number(month.slice(4))}월`;

const signed = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
// 단지 카드도 같은 치우침을 소수 둘째 자리로 적는다 - 한 값이 화면마다 +0.3과 +0.35로 갈리지 않게(#41).
const signedPp = (value, locale = "ko") => `${value > 0 ? "+" : ""}${value.toFixed(2)}${locale === "en" ? "pp" : "%p"}`;
const whole = (value) => Math.round(value);

/** 10억짜리 집이 어디서 어디까지 움직이나. 퍼센트만으로는 감이 안 온다. */
const onTenEok = (pct, locale) => {
  const won = Math.round(10 * (1 + pct / 100) * 100) / 100;
  return locale === "en" ? `₩${Math.round(won * 100).toLocaleString("en-US")}M` : `${won.toFixed(2)}억`;
};

export function leadSentence(seoul, last, locale = "ko") {
  const card = seoul?.cards?.find((c) => c.h === 3);
  if (!card) return null;
  const f = card.forecast;
  if (!f) {
    return locale === "en"
      ? `For Seoul three months out, the model does not reliably beat simply guessing "no change" or "up as usual" over ${card.origins} past months, so no figure is given.`
      : `서울 3개월 뒤는 값을 내지 않습니다. 지난 ${card.origins}개월에 같은 방식으로 예측해 보면 "그대로다"나 "늘 오르던 대로 오른다"고 찍는 것을 믿을 만큼 이기지 못했습니다.`;
  }
  return locale === "en"
    ? `Using the official index up to ${ym(last, "en")}, Seoul apartments in ${ym(f.target, "en")} come out at ${signed(f.change)}, ` +
        `with the middle 80% of past errors putting it between ${signed(f.low)} and ${signed(f.high)}. ` +
        `A flat worth ₩1bn in ${ym(last, "en")} would be ${onTenEok(f.low, "en")} to ${onTenEok(f.high, "en")} — measured from ${ym(last, "en")}, not from today's price. ` +
        `The same forecast made every month since ${ym(card.from, "en")} missed by ${card.mae.model}pp on average; guessing "no change" missed by ${card.mae.naive}pp.`
    : `공식 지수 ${ym(last, "ko")}까지로 짐작하면 ${ym(f.target, "ko")} 서울 아파트값은 ${signed(f.change)}입니다. ` +
        `지난 예측 오차의 가운데 80%를 얹으면 ${signed(f.low)}에서 ${signed(f.high)} 사이입니다 — ${ym(last, "ko")}에 10억이던 집이면 ${onTenEok(f.low, "ko")}~${onTenEok(f.high, "ko")}입니다(오늘 값이 아니라 ${ym(last, "ko")} 값에서 잰 것입니다). ` +
        `${ym(card.from, "ko")}부터 매달 같은 방식으로 예측해 보면 평균 ${card.mae.model}%p 빗나갔고, "그대로다"라고 찍으면 ${card.mae.naive}%p 빗나갔습니다.`;
}

/** 12개월은 대개 지는 칸이다. 지는 이유를 같이 적는다 - 그게 이 화면에서 가장 쓸모 있는 문장이다. */
export function longSentence(seoul, locale = "ko") {
  const card = seoul?.cards?.find((c) => c.h === 12);
  if (!card) return null;
  if (card.forecast) {
    return locale === "en"
      ? `A year out, the model beats both baselines in ${Math.round(card.winShare * 100)}% of resamples, but its average miss is still ${card.mae.model}pp.`
      : `1년 뒤도 다시 뽑은 표본의 ${Math.round(card.winShare * 100)}%에서 두 기준선을 이겼습니다. 그래도 평균 ${card.mae.model}%p 빗나갑니다.`;
  }
  return locale === "en"
    ? `A year out there is no figure. Saying "up as usual" missed by ${card.mae.drift}pp, the model by ${card.mae.model}pp. ` +
        `Of the months that moved, ${whole(card.alwaysUp)}% went up — in a period that rose almost throughout, betting on the trend is hard to beat, and that says more about the period than about any model.`
    : `1년 뒤는 값을 내지 않습니다. "늘 오르던 대로 오른다"고만 해도 평균 ${card.mae.drift}%p 빗나갔는데 모델은 ${card.mae.model}%p 빗나갔습니다. ` +
        `움직인 달의 ${whole(card.alwaysUp)}%가 올랐습니다 — 거의 내내 오른 시기에는 추세에 거는 것을 이기기 어렵고, 그건 모델이 아니라 그 시기에 대한 이야기입니다.`;
}

export function nowcastSentence(seoul, locale = "ko") {
  const now = seoul?.nowcast;
  if (!now || !now.months.length) return null;
  const filled = now.months.filter((row) => row.change !== null);
  if (!now.usable || !filled.length) {
    return locale === "en"
      ? `The official index has not reached the last ${now.months.length} month(s). Our own filings could fill them, but across ${now.overlap} overlapping months they missed the official figure by ${now.mae ?? "-"}pp, not enough to beat the model's one-month error, so they stay blank.`
      : `공식 지수는 아직 최근 ${now.months.length}개월이 없습니다. 우리가 받는 신고로 메울 수는 있지만, 공식 지수와 겹치는 ${now.overlap}개월에서 평균 ${now.mae ?? "-"}%p 차이가 나 모델의 1개월 오차보다 낫지 않아 비워 둡니다.`;
  }
  const list = filled.map((row) => `${ym(row.month, locale)} ${signed(row.change)}`).join(locale === "en" ? ", " : ", ");
  return locale === "en"
    ? `The official index stops two months short, and the most recent month is still open for filing, so only closed months are filled. Matching the same flats month to month in the filings we collect daily gives ${list}. ` +
        `Across the ${now.overlap} months where both exist, this ran ${now.mae}pp from the official figure on average and ran ${signedPp(now.bias, "en")} high — read it with that lean in mind.`
    : `공식 지수는 두 달 늦게 나옵니다. 그 사이 가운데 신고 기한(계약 후 30일)이 닫힌 달을 매일 받는 신고에서 같은 집끼리 이어 재면 ${list}입니다. ` +
        `공식 지수와 겹치는 ${now.overlap}개월에서 이 값은 평균 ${now.mae}%p 차이가 났고, 평균 ${signedPp(now.bias)}만큼 높게 나왔습니다 — 그만큼 기울어 있다고 읽어야 합니다.`;
}

/** 권역 표의 한 줄. 이기지 못한 칸은 값 대신 이유가 들어갈 자리를 비워 둔다. */
export function regionRows(regions) {
  return regions.map((region) => ({
    code: region.code,
    name: region.name,
    cells: HORIZONS.map((h) => {
      const card = region.cards.find((c) => c.h === h);
      return card?.forecast
        ? { h, change: card.forecast.change, low: card.forecast.low, high: card.forecast.high, mae: card.mae.model }
        : { h, change: null, mae: card?.mae.model ?? null, drift: card?.mae.drift ?? null, naive: card?.mae.naive ?? null };
    }),
  }));
}

// --- 표 -------------------------------------------------------------------------
//
// 표도 문장처럼 빌드에서 두 언어로 다 만든다. 화면은 고르기만 한다 - 같은 표를 브라우저가
// 다시 그리면 두 벌의 규칙이 생기고, 언젠가 둘이 다른 말을 한다.

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const TABLE_TEXT = {
  ko: {
    region: "권역",
    after: (h) => `${h}개월 뒤`,
    blank: "비움",
    range: (low, high) => `${signed(low)} ~ ${signed(high)}`,
    month: "달",
    pairs: "맞물린 칸",
    change: "변화",
    officialGap: "공식과 평균 차이",
    thin: "칸이 모자람",
    notUsed: "메우지 않음",
    horizon: "거리",
    model: "모델",
    naive: '"그대로다"',
    drift: '"늘 오른다"',
    hit: "방향 적중",
    upHit: '"오른다" 적중',
    verdict: "값을 내나",
    yes: "낸다",
    no: "안 낸다",
  },
  en: {
    region: "Region",
    after: (h) => `${h} months`,
    blank: "blank",
    range: (low, high) => `${signed(low)} to ${signed(high)}`,
    month: "Month",
    pairs: "Matched",
    change: "Change",
    officialGap: "Avg gap to official",
    thin: "too few cells",
    notUsed: "not filled",
    horizon: "Horizon",
    model: "Model",
    naive: '"No change"',
    drift: '"Up as usual"',
    hit: "Direction hit",
    upHit: '"Up" hit',
    verdict: "Published?",
    yes: "yes",
    no: "no",
  },
};

/** 권역 × 거리. 못 이긴 칸은 비우되 왜 비었는지(모델 오차 vs 기준선 오차)를 남긴다. */
export function regionTableHtml(regions, locale = "ko") {
  if (!regions?.length) return null;
  const t = TABLE_TEXT[locale];
  const head = `<thead><tr><th>${t.region}</th>${HORIZONS.map((h) => `<th>${t.after(h)}</th>`).join("")}</tr></thead>`;
  const body = regionRows(regions)
    .map((row) => {
      const cells = row.cells
        .map((cell) =>
          cell.change === null
            ? `<td><span class="low-sample">${t.blank}</span></td>`
            : `<td><strong>${signed(cell.change)}</strong><div class="sub">${t.range(cell.low, cell.high)}</div></td>`
        )
        .join("");
      return `<tr><td>${esc(row.name[locale])}</td>${cells}</tr>`;
    })
    .join("");
  return `${head}<tbody>${body}</tbody>`;
}

/** 공식 지수가 아직 없는 달. 권역마다 맞물린 칸 수와 그 권역에서 잰 성적을 같이 싣는다. */
export function nowcastTableHtml(regions, locale = "ko") {
  const months = [...new Set(regions.flatMap((r) => r.nowcast?.months.map((m) => m.month) ?? []))].sort();
  if (!months.length) return null;
  const t = TABLE_TEXT[locale];
  const head =
    `<thead><tr><th>${t.region}</th>` +
    months.map((m) => `<th>${esc(ym(m, locale))}</th>`).join("") +
    `<th>${t.officialGap}</th></tr></thead>`;
  const body = regions
    .map((region) => {
      const now = region.nowcast;
      const cells = months
        .map((m) => {
          const row = now.months.find((x) => x.month === m);
          if (!row) return "<td>-</td>";
          if (row.change === null) {
            const why = now.usable ? t.thin : t.notUsed;
            return `<td><span class="low-sample">${why}</span><div class="sub">${t.pairs} ${row.pairs.toLocaleString(locale === "en" ? "en-US" : "ko-KR")}</div></td>`;
          }
          return `<td>${signed(row.change)}<div class="sub">${t.pairs} ${row.pairs.toLocaleString(locale === "en" ? "en-US" : "ko-KR")}</div></td>`;
        })
        .join("");
      const gap = now.mae === null ? "-" : `${now.mae}${locale === "en" ? "pp" : "%p"} (${now.overlap})`;
      return `<tr><td>${esc(region.name[locale])}</td>${cells}<td>${gap}</td></tr>`;
    })
    .join("");
  return `${head}<tbody>${body}</tbody>`;
}

/** 서울의 성적표. 모델과 두 기준선의 평균 오차, 그리고 "늘 오른다"의 적중률을 나란히. */
export function scoreTableHtml(region, locale = "ko") {
  if (!region?.cards?.length) return null;
  const t = TABLE_TEXT[locale];
  const pp = locale === "en" ? "pp" : "%p";
  const head =
    `<thead><tr><th>${t.horizon}</th><th>${t.model}</th><th>${t.naive}</th><th>${t.drift}</th>` +
    `<th>${t.hit}</th><th>${t.upHit}</th><th>${t.verdict}</th></tr></thead>`;
  const body = region.cards
    .map(
      (card) =>
        `<tr><td>${t.after(card.h)}</td><td>${card.mae.model}${pp}</td><td>${card.mae.naive}${pp}</td>` +
        `<td>${card.mae.drift}${pp}</td><td>${whole(card.hit)}%</td><td>${whole(card.alwaysUp)}%</td>` +
        `<td>${card.forecast ? t.yes : `<span class="low-sample">${t.no}</span>`}</td></tr>`
    )
    .join("");
  return `${head}<tbody>${body}</tbody>`;
}

/**
 * 실제로 낸 예측의 채점. 처음 몇 달은 채점할 것이 없다 - 없다고 적는다.
 *
 * 채점이 쌓여도 %로 적지 않는다(#64). 같은 판의 네 권역은 오차가 0.84~0.95로 붙어 다녀서
 * 4개가 들어도 사실상 한 건이고, 한 건으로 낸 "100%"는 숫자의 모양을 한 거짓말이다.
 * 개수와 두 기준선과의 비교만 적고, 한 번으로는 판정하지 못한다고 밝힌다.
 */
export function recordSentence(record, locale = "ko") {
  if (!record) return null;
  if (!record.scored) {
    const first = [...record.pending].sort((a, b) => (a.target < b.target ? -1 : 1))[0];
    if (!first) return null;
    return locale === "en"
      ? `This page has made ${record.made} forecast(s) so far and none can be scored yet. The first is scored when the official index for ${ym(first.target, "en")} is published, about two months later. The table above is a re-run on today's index, which flatters it: back then the index had not yet been revised.`
      : `이 화면이 지금까지 낸 예측은 ${record.made}개이고 아직 채점할 수 있는 것이 없습니다. 첫 채점은 ${ym(first.target, "ko")} 지수가 나오는 두 달 뒤입니다. 위 표는 지금의 지수로 과거를 다시 푼 것이라 실제보다 좋게 나옵니다 — 그때는 지수가 고쳐지기 전이었습니다.`;
  }
  const beat = record.beatBoth === null ? null : record.beatBoth;
  return locale === "en"
    ? `Of the ${record.made} forecasts this page has published, ${record.scored} can now be scored. ${record.insideCount} of the ${record.scored} landed inside the stated range, and the average miss was ${record.mae}pp. ` +
        (beat === null ? "" : `The model beat both baselines (“no change” and “up as usual”) in ${beat.won} of ${beat.of}. `) +
        `Forecasts for the four regions made from the same index miss together (their errors are strongly correlated), so they count as roughly one observation: a single scoring cannot say whether the model is right or wrong. Each score is frozen the first time it is computed and is not changed when the index is later revised.`
    : `이 화면이 실제로 낸 예측 ${record.made}개 가운데 ${record.scored}개를 채점할 수 있게 됐습니다. ${record.scored}개 중 ${record.insideCount}개가 적어 둔 범위 안에 들었고 평균 ${record.mae}%p 빗나갔습니다. ` +
        (beat === null ? "" : `두 기준선("그대로다"·"늘 오른다")을 모두 이긴 것은 ${beat.of}개 중 ${beat.won}개입니다. `) +
        `같은 지수에서 낸 네 권역의 예측은 오차가 서로 붙어 다녀 사실상 한 건이므로, 한 번의 채점으로는 모델이 맞는지 틀린지 판정하지 못합니다. 채점값은 처음 계산한 날 얼려 두고, 뒤에 지수가 고쳐져도 바꾸지 않습니다.`;
}
