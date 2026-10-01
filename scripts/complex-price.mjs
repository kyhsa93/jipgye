/**
 * 이 단지 이 평형의 매매가는 지금 어디쯤인가.
 *
 * 중개사가 13억 5천을 불렀을 때 묻는 것은 "이 단지 84㎡가 요즘 얼마냐"다. 단지 카드는
 * 두 달치만 보고 있어서, 같은 평형에 거래가 세 건 이상 있는 경우가 절반(47.8%)뿐이었다.
 *
 * 창을 넓히면 표본은 늘지만 그 창의 중앙값은 "지금"이 아니라 "창 한가운데"의 값이 된다.
 * 12개월로 넓혀 보니 같은 칸 중앙값이 대상 거래보다 8.8% 낮게 나왔다 - 1년 사이 서울이
 * 13~15% 올랐다(DIRECTION 체크리스트 12). 그래서 여섯 달만 보고, 그 안의 거래를 권역
 * 실거래가격지수로 <strong>기준 달 값으로 고친다.</strong> 2026-06·07 계약을 직전 여섯 달
 * 같은 칸으로 견주면 치우침 +0.4%, 자치구 잔여 -2.0~+1.8%였다(research/buyer-planning-2026-10/).
 *
 * 지수는 권역(서울 생활권 다섯)까지만 있다. 같은 권역 안에서도 자치구가 다르게 움직이므로
 * 고친 값에도 그만큼의 오차가 남는다(체크리스트 13) - 보정 전 중앙값을 옆에 같이 싣는다.
 */

import { REGIONS } from "./outlook.mjs";

/** 창. 시세 화면과 같은 여섯 달. */
export const WINDOW_DAYS = 183;

/** 범위를 내는 문턱. 둘로 낸 중앙값은 그냥 두 값의 평균이다(단지별 전세가율과 같은 규칙). */
export const MIN_DEALS = 3;

/** 이만큼 모이면 가운데 절반을 내고, 그보다 적으면 최저~최고를 낸다. 넷으로 낸 사분위는 거의 최저·최고다. */
export const QUARTILE_FROM = 5;

const regionOf = new Map(REGIONS.flatMap((r) => (r.districts ?? []).map((code) => [code, r.code])));

export const amountOf = (item) => Number(String(item?.dealAmount ?? "").replace(/,/g, ""));

/** 원본 한 줄의 계약일. 날이 없으면 null. */
export function dealDate(item) {
  const y = Number(item?.dealYear);
  const m = Number(item?.dealMonth);
  const d = Number(item?.dealDay);
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 범위에 넣는 거래. 해제된 것과 직거래는 뺀다 - 직거래는 가족 간 거래처럼 시세와 무관한
 * 값이 섞여 있어 시세 화면도 따로 센다.
 */
export function marketDeal(item) {
  if (String(item?.cdealType ?? "").trim()) return null;
  if (String(item?.dealingGbn ?? "").trim() === "직거래") return null;
  const amount = amountOf(item);
  const area = Number(item?.excluUseAr);
  const date = dealDate(item);
  const apt = String(item?.aptNm ?? "").trim();
  if (!(amount > 0) || !(area > 0) || !date || !apt) return null;
  const buildYear = Number(item?.buildYear);
  return {
    district: String(item.sggCd),
    apt,
    dong: String(item?.umdNm ?? "").trim(),
    buildYear: Number.isInteger(buildYear) && buildYear > 1900 ? buildYear : null,
    // 화면의 거래 목록(deals-*.json)과 같은 자리수. 다르면 카드가 평형을 못 찾는다.
    area: Math.round(area * 100) / 100,
    month: date.slice(0, 4) + date.slice(5, 7),
    date,
    amount,
  };
}

/**
 * 권역별 지수 계열. 공식 지수 뒤에, 공식 지수가 아직 없는 달 가운데 우리 원본으로 메운 달
 * (전망 화면이 이미 계산해 둔 것, 신고 기한이 닫힌 달만)을 잇는다. 메운 달은 공식보다
 * 평균 +0.35%p 높게 나와 왔다 - 그만큼 최근 거래를 덜 올려 고치게 된다. 화면에 적는다.
 */
export function indexLevels(index, outlook) {
  const levels = {};
  const filled = {};
  for (const { code } of REGIONS) {
    const rows = index?.series?.[code];
    if (!rows?.length) continue;
    const byMonth = new Map(rows.map(([m, v]) => [m, Number(v)]));
    let last = rows.at(-1)[0];
    filled[code] = [];
    const region = outlook?.regions?.find((r) => r.code === code);
    for (const row of region?.nowcast?.months ?? []) {
      if (row.change === null || row.month <= last) continue;
      byMonth.set(row.month, byMonth.get(last) * Math.exp(row.change / 100));
      filled[code].push(row.month);
      last = row.month;
    }
    levels[code] = { byMonth, last };
  }
  return { levels, filled };
}

/** 기준 달. 서울 계열의 마지막 달(공식 또는 메운 달). 권역마다 다르면 가장 이른 것을 쓴다. */
export function referenceMonth(levels) {
  const lasts = Object.values(levels).map((l) => l.last);
  return lasts.length ? lasts.sort()[0] : null;
}

export function quantile(sorted, q) {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

const median = (values) => quantile([...values].sort((a, b) => a - b), 0.5);
const won = (value) => Math.round(value);

/**
 * 한 거래를 기준 달 값으로. 기준 달보다 뒤에 계약된 거래는 고칠 지수가 없어 그대로 둔다 -
 * 기준 달에서 한 달 안쪽이라 고쳐도 차이가 작고, 고치지 않았다고 따로 센다.
 */
export function adjust(deal, levels, reference) {
  const level = levels[regionOf.get(deal.district)];
  if (!level || deal.month > reference) return { value: deal.amount, adjusted: false };
  const from = level.byMonth.get(deal.month);
  const to = level.byMonth.get(reference);
  if (!(from > 0) || !(to > 0)) return { value: deal.amount, adjusted: false };
  return { value: (deal.amount * to) / from, adjusted: true };
}

/** 한 칸(단지·평형)의 요약. 문턱을 못 넘으면 건수만 남긴다 - 빈칸과 "모자람"은 다르다. */
export function summarize(deals, levels, reference) {
  const n = deals.length;
  const base = { n };
  if (n < MIN_DEALS) return base;

  const values = deals.map((deal) => adjust(deal, levels, reference));
  const sorted = values.map((v) => v.value).sort((a, b) => a - b);
  const quartile = n >= QUARTILE_FROM;
  return {
    ...base,
    median: won(quantile(sorted, 0.5)),
    low: won(quartile ? quantile(sorted, 0.25) : sorted[0]),
    high: won(quartile ? quantile(sorted, 0.75) : sorted.at(-1)),
    quartile,
    raw: won(median(deals.map((deal) => deal.amount))),
    unadjusted: values.filter((v) => !v.adjusted).length,
    from: deals.map((d) => d.date).sort()[0],
  };
}

/** 오늘에서 WINDOW_DAYS 안. */
export function windowStart(now) {
  return new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
}

/** 자치구 하나의 칸 요약: { 단지명: { 평형: 요약 } }. */
export function districtCells(deals, levels, reference) {
  const cells = new Map();
  for (const deal of deals) {
    const key = `${deal.apt}\u0000${deal.area}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(deal);
  }

  const out = {};
  for (const [key, group] of [...cells].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [apt, area] = key.split("\u0000");
    out[apt] ??= {};
    out[apt][area] = summarize(group, levels, reference);
  }
  return out;
}

/** 가장 흔한 값. 같은 단지명이 여러 동에 걸치는 일은 드물지만, 있으면 거래가 많은 쪽을 쓴다. */
function mode(values) {
  const counts = new Map();
  for (const v of values) if (v !== null && v !== "") counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  for (const [v, c] of [...counts].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1))) if (best === null || c > counts.get(best)) best = v;
  return best;
}

/** 단지별 동과 준공연도. 단지 후보를 연식과 동으로 거르고 적는 데 쓴다. */
export function districtMeta(deals) {
  const byApt = new Map();
  for (const deal of deals) {
    if (!byApt.has(deal.apt)) byApt.set(deal.apt, []);
    byApt.get(deal.apt).push(deal);
  }
  const out = {};
  for (const [apt, group] of [...byApt].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    out[apt] = { dong: mode(group.map((d) => d.dong)), buildYear: mode(group.map((d) => d.buildYear)) };
  }
  return out;
}

// --- 단지 후보 -------------------------------------------------------------------
//
// 조건 필터 화면은 만들지 않는다 - 호갱노노가 평형·세대수·금액·입주년차로 이미 거른다(DIRECTION 3부 0번 ③).
// 우리 자리는 후보마다 "기준 달 값으로 고친 범위"와 "몇 건으로 낸 값인지"를 붙이는 것이다.
// 그래서 후보는 범위를 낼 수 있었던 칸(같은 평형 6개월 3건 이상)만이다.

/** 자치구 파일들(complex-price-*.json)에서 고친 중앙값이 [min, max) 안인 단지·평형. 거래가 많은 순. */
export function candidatesInBand(files, min10k, max10k) {
  const rows = [];
  for (const file of files) {
    for (const [apt, areas] of Object.entries(file?.cells ?? {})) {
      for (const [area, cell] of Object.entries(areas)) {
        if (!cell.median || cell.median < min10k || cell.median >= max10k) continue;
        rows.push({ district: file.district, apt, area: Number(area), ...file.meta?.[apt], ...cell });
      }
    }
  }
  return rows.sort((a, b) => b.n - a.n || a.median - b.median || (a.apt < b.apt ? -1 : 1));
}
