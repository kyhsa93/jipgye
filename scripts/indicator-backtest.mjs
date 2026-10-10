/**
 * 이 지표를 넣으면 몇 달 뒤 아파트값을 더 잘 맞히는가.
 *
 * "거래량이 먼저 움직인다", "전세가율이 오르면 매매가 따라간다" 같은 말은 흔하다. 전망 화면은
 * 지난 가격 변화만 쓴다(scripts/outlook.mjs). 그 모델에 지표 하나를 더 넣어 2012년부터 매달
 * 다시 예측해 보고, 넣은 쪽이 꾸준히 덜 틀렸는지를 센다. 덜 틀리지 않았다면 그 지표는 적어도
 * 이 자로 잰 "앞섬"이 없다 - 그것을 그대로 적는다(시장 온도 게이지는 만들지 않는다, DIRECTION 2부).
 *
 * 2026-10-01 조사(research/buyer-search-timing-2026-10/backtest_indicators.py)를 옮긴 것이다.
 * 후보도 그때 미리 정한 것 그대로다. 결과를 보고 후보를 고르지 않는다.
 *
 * "앞섰다"는 셋을 다 넘어야 쓴다.
 * - 서울에서, 같은 시점에 지표 없이 푼 기준 모델(전체 학습 창)과 지표가 있는 달만으로 푼 기준
 *   모델(같은 창) 둘 다를 12개월 블록 부트스트랩 1,000회의 90% 이상에서 이긴다.
 * - 5개 권역 가운데 4곳 이상에서도 같은 문턱을 넘는다. 조사 때 주담대 금리 수준이 서울에서만
 *   넘고 동북·서북에서 깨졌다 - 17개 지표를 66번 재면 하나쯤은 우연히 넘는다.
 * - 지표가 "먼저 공표된" 값이 아니다. 가격지수는 두 달 늦게 나오므로, 같은 달을 먼저 내는 다른
 *   조사(KB)의 그 달 값은 앞선 것이 아니라 답을 일찍 본 것이다. 그런 변형은 따로 표시한다.
 */

import { leastSquares } from "./outlook.mjs";
import { candidates3 } from "./indicator-candidates-3.mjs";

export const HORIZONS = [3, 6];
export const START = "201201";
export const WIN = 0.9;
export const REGION_WINS = 4;
export const ROUNDS = 1000;
export const BLOCK = 12;
const MIN_TRAIN = 24;
const MIN_ORIGINS = 36;

const ymi = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;

const toMap = (rows, fn = (v) => v) => {
  const map = new Map();
  for (const [m, v] of rows ?? []) {
    const value = fn(Number(v));
    if (Number.isFinite(value)) map.set(ymi(m), value);
  }
  return map;
};
const logOf = (rows) => toMap(rows, (v) => (v > 0 ? Math.log(v) : NaN));

function avg(map, t, n) {
  const vals = [];
  for (let k = 0; k < n; k += 1) {
    if (!map.has(t - k)) return null;
    vals.push(map.get(t - k));
  }
  return mean(vals);
}

/**
 * 후보. published는 "같은 달을 가격지수보다 먼저 내는 다른 조사"라 앞섬이 아니라 답을 일찍 본 것이
 * 되는 변형이다. lags는 오리진 달에서 몇 달 뒤 값까지 쓰는가 - 가격지수가 두 달 늦으므로 그보다
 * 빨리 나오는 지표는 그만큼 뒤 값을 그 시점에 이미 볼 수 있다.
 */
export function candidates(series) {
  const vol = new Map([...logOf(series.vol_seoul)].filter(([k]) => k >= ymi("200602")));
  const kbs = logOf(series.kb_sale);
  const kbj = logOf(series.kb_jeonse);
  const base = toMap(series.base_rate);
  const mort = toMap(series.mortgage_rate);
  const ktb = toMap(series.ktb3);
  const unsold = logOf(series.unsold_seoul);
  const csi = toMap(series.csi_house_seoul);
  const jr = toMap(series.jratio_seoul);
  const sd = toMap(series.supply_demand_seoul);
  const has = (...pairs) => pairs.every(([map, t]) => map.has(t));
  const diff = (map, t, k) => (has([map, t], [map, t - k]) ? [map.get(t) - map.get(t - k)] : null);
  const level = (map, t) => (map.has(t) ? [map.get(t)] : null);

  return [
    { id: "vol_norm", ko: "거래량: 최근 3개월 / 그 전 24개월", en: "Volume: last 3 months vs prior 24", lags: [0, 1],
      fn: (t) => { const a = avg(vol, t, 3); const b = avg(vol, t - 3, 24); return a === null || b === null ? null : [a - b]; } },
    { id: "vol_yoy", ko: "거래량: 3개월 전년 대비", en: "Volume: 3-month, year on year", lags: [0, 1],
      fn: (t) => { const a = avg(vol, t, 3); const b = avg(vol, t - 12, 3); return a === null || b === null ? null : [a - b]; } },
    { id: "jr_kb", ko: "전세가율(KB 지수비) 수준", en: "Jeonse ratio (KB index ratio), level", lags: [0, 1],
      fn: (t) => (has([kbs, t], [kbj, t]) ? [kbj.get(t) - kbs.get(t)] : null) },
    { id: "jr_kb_chg", ko: "전세가율(KB 지수비) 12개월 변화", en: "Jeonse ratio (KB), 12-month change", lags: [0, 1],
      fn: (t) => (has([kbs, t], [kbj, t], [kbs, t - 12], [kbj, t - 12])
        ? [kbj.get(t) - kbs.get(t) - (kbj.get(t - 12) - kbs.get(t - 12))] : null) },
    { id: "jeonse3", ko: "KB 전세 3개월 상승률", en: "KB jeonse, 3-month change", lags: [0, 1], fn: (t) => diff(kbj, t, 3) },
    { id: "jr_rone", ko: "전세가율(부동산원) 수준", en: "Jeonse ratio (REB), level", lags: [0, 1], fn: (t) => level(jr, t) },
    { id: "base12", ko: "기준금리 12개월 변화", en: "Base rate, 12-month change", lags: [0, 1], fn: (t) => diff(base, t, 12) },
    { id: "mort12", ko: "주담대 금리 12개월 변화", en: "Mortgage rate, 12-month change", lags: [0, 1], fn: (t) => diff(mort, t, 12) },
    { id: "mort_lvl", ko: "주담대 금리 수준", en: "Mortgage rate, level", lags: [0, 1], fn: (t) => level(mort, t) },
    { id: "ktb12", ko: "국고채 3년 12개월 변화", en: "3-year treasury, 12-month change", lags: [0, 1], fn: (t) => diff(ktb, t, 12) },
    { id: "unsold", ko: "서울 미분양 수준", en: "Seoul unsold homes, level", lags: [0], fn: (t) => level(unsold, t) },
    { id: "unsold_yoy", ko: "서울 미분양 전년 대비", en: "Seoul unsold homes, year on year", lags: [0], fn: (t) => diff(unsold, t, 12) },
    { id: "csi", ko: "주택가격전망 소비자심리(서울)", en: "Consumer house-price outlook (Seoul)", lags: [0, 1], fn: (t) => level(csi, t) },
    { id: "sd", ko: "매매수급지수(서울)", en: "Buyer-seller balance index (Seoul)", lags: [0, 1], fn: (t) => level(sd, t) },
    // KB 매매는 같은 시장의 같은 달을 다른 조사가 먼저 낸 값이다. 가격지수가 두 달 늦으므로 오리진 뒤
    // 한두 달의 KB 매매 값은 "앞선 지표"가 아니라 그 달의 답을 일찍 본 것이다(조사 땐 +2개월만 그렇게 봤다).
    { id: "kb3", ko: "KB 매매 3개월 상승률", en: "KB sale index, 3-month change", lags: [0, 1], published: [1], fn: (t) => diff(kbs, t, 3) },
    { id: "kb1", ko: "KB 매매 1개월 상승률", en: "KB sale index, 1-month change", lags: [0, 1, 2], published: [1, 2], fn: (t) => diff(kbs, t, 1) },
    { id: "month", ko: "계절(달)", en: "Season (calendar month)", lags: [0],
      fn: (t) => Array.from({ length: 11 }, (_, k) => ((t % 12) === k + 1 ? 1 : 0)) },
    // 3차(#57): 외지인 매입 비중, 주택관련대출 잔액, 서울 주택 인허가. 미리 정한 것 그대로.
    ...candidates3(series),
  ];
}

/** 가격 계열(빈 달 없이 이어진 것). */
export function priceSeries(rows) {
  const map = logOf(rows);
  const keys = [...map.keys()].sort((a, b) => a - b);
  const months = [];
  for (let m = keys[0]; m <= keys.at(-1); m += 1) {
    if (!map.has(m)) throw new Error(`가격 계열에 빈 달: ${m}`);
    months.push(m);
  }
  const lp = months.map((m) => map.get(m));
  const r = lp.map((v, i) => (i ? v - lp[i - 1] : NaN));
  return { months, lp, r };
}

const baseFeat = ({ r }, i) => (i < 6 ? null : [1, r[i], r[i - 1], mean([r[i - 5], r[i - 4], r[i - 3], r[i - 2]])]);
const dot = (x, b) => x.reduce((s, v, k) => s + v * b[k], 0);

/**
 * 롤링 오리진. 학습은 그 시점에 결과가 이미 나온 것(j + h ≤ i)만 쓴다.
 * 돌려주는 것: [오리진, 기준 오차, 추가 오차, 같은 창 기준 오차] (%p).
 */
export function run(price, h, fn, lag) {
  const { months, lp } = price;
  const start = ymi(START);
  const out = [];
  for (let i = 0; i + h < months.length; i += 1) {
    if (months[i] < start) continue;
    const xb = baseFeat(price, i);
    if (!xb) continue;
    const xa = fn(months[i] + lag);
    if (!xa) continue;

    const Xb = [];
    const yb = [];
    const Xa = [];
    const ya = [];
    for (let j = 6; j + h <= i; j += 1) {
      const fb = baseFeat(price, j);
      const y = lp[j + h] - lp[j];
      Xb.push(fb);
      yb.push(y);
      const fa = fn(months[j] + lag);
      if (fa) {
        Xa.push([...fb, ...fa]);
        ya.push(y);
      }
    }
    if (Xa.length < Math.max(MIN_TRAIN, (4 + xa.length) * 4)) continue;
    const bb = leastSquares(Xb, yb);
    const ba = leastSquares(Xa, ya);
    const bw = leastSquares(Xa.map((row) => row.slice(0, 4)), ya);
    if (!bb || !ba || !bw) continue;

    const actual = (lp[i + h] - lp[i]) * 100;
    out.push([
      months[i],
      actual - dot(xb, bb) * 100,
      actual - dot([...xb, ...xa], ba) * 100,
      actual - dot(xb, bw) * 100,
    ]);
  }
  return out;
}

/** 덩어리째 다시 뽑아 a열 평균 오차가 b열보다 작았던 비율. 씨앗 고정 - 빌드마다 판정이 흔들리면 안 된다. */
export function boot(rows, a, b, { rounds = ROUNDS, block = BLOCK, seed = 20261001 } = {}) {
  const n = rows.length;
  if (n < block * 2) return 0;
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const ea = rows.map((row) => Math.abs(row[a]));
  const eb = rows.map((row) => Math.abs(row[b]));
  let wins = 0;
  for (let round = 0; round < rounds; round += 1) {
    let sa = 0;
    let sb = 0;
    let count = 0;
    while (count < n) {
      const s = Math.floor(next() * (n - block + 1));
      for (let k = s; k < s + block && count < n; k += 1, count += 1) {
        sa += ea[k];
        sb += eb[k];
      }
    }
    if (sa < sb) wins += 1;
  }
  return wins / rounds;
}

const round2 = (v) => Math.round(v * 100) / 100;
const mae = (rows, k) => round2(mean(rows.map((row) => Math.abs(row[k]))));

/** 한 지표·한 lag·한 거리의 성적. 오리진이 모자라면 null. */
export function score(price, h, fn, lag) {
  const rows = run(price, h, fn, lag);
  if (rows.length < MIN_ORIGINS) return null;
  const share = Math.min(boot(rows, 2, 1), boot(rows, 2, 3));
  return {
    origins: rows.length,
    base: mae(rows, 1),
    with: mae(rows, 2),
    gain: round2(mae(rows, 1) - mae(rows, 2)),
    win: round2(share),
    passes: share >= WIN,
  };
}

/**
 * 전 후보의 판정. 서울에서 넘은 것만 권역에서 다시 잰다(비용 때문이 아니라, 넘지 못한 것은
 * 권역에서 넘어도 쓸 곳이 없다).
 */
export function judge(prices, series) {
  const seoul = prices["200"];
  const regions = Object.entries(prices).filter(([code]) => code !== "200");
  const rows = [];
  for (const c of candidates(series)) {
    for (const lag of c.lags) {
      const published = (c.published ?? []).includes(lag);
      const byH = {};
      for (const h of HORIZONS) {
        const s = score(seoul, h, c.fn, lag);
        if (s?.passes) {
          s.regionWins = regions.filter(([, p]) => score(p, h, c.fn, lag)?.passes).length;
          s.regions = regions.length;
        }
        byH[h] = s;
      }
      const passes = HORIZONS.some((h) => byH[h]?.passes);
      const leads = HORIZONS.some((h) => byH[h]?.passes && byH[h].regionWins >= REGION_WINS);
      rows.push({
        id: c.id,
        ko: c.ko,
        en: c.en,
        lag,
        published,
        h: byH,
        // 먼저 공표된 값은 이겨도 앞섬이 아니다 - 이 판정이 맨 앞이다.
        verdict: !passes ? "no" : published ? "published" : leads ? "leads" : "seoulOnly",
      });
    }
  }
  return rows;
}

// --- 문장과 표 ---------------------------------------------------------------------

export function leadSentence(rows, locale = "ko") {
  const leads = rows.filter((r) => r.verdict === "leads");
  const tried = new Set(rows.map((r) => r.id)).size;
  const vol = rows.find((r) => r.id === "vol_yoy" && r.lag === 0)?.h?.[3];
  if (!leads.length) {
    const volText =
      vol && vol.gain < 0
        ? locale === "en"
          ? ` Volume, the usual suspect, made the three-month forecast worse (${vol.base}pp → ${vol.with}pp).`
          : ` 흔히 먼저 움직인다고 하는 거래량은 넣으면 3개월 오차가 오히려 ${vol.base}%p에서 ${vol.with}%p로 커졌습니다.`
        : "";
    return locale === "en"
      ? `Of the ${tried} indicators tried, none consistently beat the price-only model three or six months out — in Seoul and in at least four of the five regions.` + volText
      : `넣어 본 지표 ${tried}개 가운데 3개월·6개월 뒤를 지난 가격 변화만 쓰는 모델보다 꾸준히 더 잘 맞힌 것은 없었습니다(서울과 5개 권역 중 4곳 이상 기준).` + volText;
  }
  const names = leads.map((r) => r[locale === "en" ? "en" : "ko"]).join(locale === "en" ? ", " : ", ");
  return locale === "en"
    ? `Of the ${tried} indicators tried, ${leads.length} consistently improved the forecast in Seoul and most regions: ${names}. The forecast above does not use them yet — they are tracked as shadow forecasts first.`
    : `넣어 본 지표 ${tried}개 가운데 서울과 대부분의 권역에서 꾸준히 예측을 낫게 한 것은 ${leads.length}개입니다: ${names}. 위 예측에는 아직 넣지 않았습니다 — 먼저 따로 쌓아 채점합니다.`;
}

const VERDICT = {
  ko: { no: "앞서지 않음", seoulOnly: "서울에서만, 권역 재현 안 됨", published: "먼저 공표된 효과(앞섬 아님)", leads: "앞섬" },
  en: { no: "does not lead", seoulOnly: "Seoul only, not in regions", published: "earlier publication, not leading", leads: "leads" },
};

export function tableHtml(rows, locale = "ko") {
  if (!rows?.length) return null;
  const en = locale === "en";
  const pp = en ? "pp" : "%p";
  const lagText = (lag) => (lag === 0 ? "" : en ? ` (+${lag}m)` : ` (+${lag}개월)`);
  const cell = (s) =>
    !s
      ? `<td>-</td>`
      : `<td>${s.with}${pp}<div class="sub">${en ? "base" : "기준"} ${s.base}${pp} · ${Math.round(s.win * 100)}%</div></td>`;
  const head =
    `<thead><tr><th scope="col">${en ? "Indicator added" : "넣은 지표"}</th>` +
    `<th scope="col">${en ? "3 months" : "3개월 뒤 오차"}</th><th scope="col">${en ? "6 months" : "6개월 뒤 오차"}</th>` +
    `<th scope="col">${en ? "Verdict" : "판정"}</th></tr></thead>`;
  const body = rows
    .map((r) => {
      const verdict = VERDICT[locale][r.verdict];
      const v = r.verdict === "leads" ? verdict : `<span class="low-sample">${verdict}</span>`;
      return `<tr><td>${en ? r.en : r.ko}${lagText(r.lag)}</td>${cell(r.h[3])}${cell(r.h[6])}<td>${v}</td></tr>`;
    })
    .join("");
  return `${head}<tbody>${body}</tbody>`;
}

// --- 그림자 예측 ------------------------------------------------------------------
//
// 서울에서만 기준을 넘은 지표(주담대 금리 수준, +1개월)는 화면에 넣지 않는다. 대신 지금 모델과 그
// 지표를 더한 모델이 매달 낸 예측을 나란히 쌓아 두고, 지수가 나오면 둘 다 채점한다(#22). 백테스트는
// 지금의(고쳐진) 지수로 푼 것이라 실제보다 좋게 나온다 - 그때 그때 낸 예측의 성적이 진짜다.

export const SHADOW = { id: "mort_lvl", lag: 1, h: 3 };

/** 마지막 공식 달에 서서 h달 뒤를 두 모델로 짐작한다(%). 지표 값이 아직 없으면 null. */
export function shadowForecast(price, series, { id = SHADOW.id, lag = SHADOW.lag, h = SHADOW.h } = {}) {
  const c = candidates(series).find((x) => x.id === id);
  const { months, lp } = price;
  const i = months.length - 1;
  const xb = baseFeat(price, i);
  const xa = c?.fn(months[i] + lag);
  if (!xb || !xa) return null;
  const Xb = [];
  const yb = [];
  const Xa = [];
  const ya = [];
  for (let j = 6; j + h <= i; j += 1) {
    const fb = baseFeat(price, j);
    const y = lp[j + h] - lp[j];
    Xb.push(fb);
    yb.push(y);
    const fa = c.fn(months[j] + lag);
    if (fa) {
      Xa.push([...fb, ...fa]);
      ya.push(y);
    }
  }
  const bb = leastSquares(Xb, yb);
  const ba = leastSquares(Xa, ya);
  if (!bb || !ba) return null;
  const round2 = (v) => Math.round(v * 10_000) / 100;
  return { base: round2(dot(xb, bb)), with: round2(dot([...xb, ...xa], ba)) };
}
