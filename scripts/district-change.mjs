/**
 * 갈아타기 - 내 동네가 오른 만큼 갈 동네도 올랐나.
 *
 * 지금 집을 팔고 다른 동네로 옮기려는 사람(DIRECTION 1부 장면 4)에게 자치구 평균 시세의 변화는
 * 답이 못 된다. 그 평균은 그 기간에 어떤 단지가 팔렸느냐에 따라 움직인다 - 비싼 단지가 많이 팔린
 * 달이면 아무것도 안 올라도 평균이 오른다.
 *
 * 그래서 같은 칸(구·단지·전용면적)을 두 시기에 견준다. 두 시기 모두 거래가 있는 칸마다 중앙값이
 * 얼마나 변했는지를 재고, 그 변화의 중앙값을 그 구의 변화로 본다. 칸을 다시 뽑아(부트스트랩) 90%
 * 구간을 같이 내고, 두 구의 구간이 겹치면 "갈라 볼 수 없다"고 적는다.
 *
 * 두 시기는 신고 기한이 닫힌 최근 석 달과 그 1년 전 석 달이다. 원본이 아직 1년 전 석 달을 다
 * 갖고 있지 않으면(백필 중) 가장 이른 석 달을 쓰고 실제 간격을 적는다 - 간격을 1년으로 늘려
 * 적지 않는다.
 */

import { REGIONS, shiftMonth } from "./outlook.mjs";

export const PERIOD = 3;
export const MIN_CELLS = 30;
export const ROUNDS = 400;

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (logChange) => Math.round(Math.expm1(logChange) * 1000) / 10;

/** 원본 한 줄 → { district, cell, month, amount }. 해제·직거래는 뺀다. */
export function toDeal(item) {
  if (String(item?.cdealType ?? "").trim()) return null;
  if (String(item?.dealingGbn ?? "").trim() === "직거래") return null;
  const amount = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
  if (!(amount > 0) || !item.dealYear || !item.dealMonth) return null;
  return {
    district: String(item.sggCd),
    cell: `${item.sggCd}|${item.aptNm}|${item.excluUseAr}`,
    month: `${item.dealYear}${String(item.dealMonth).padStart(2, "0")}`,
    amount,
  };
}

/**
 * 두 시기. recentEnd는 신고 기한이 닫힌 마지막 달. 1년 전 석 달이 원본에 다 있으면 그것을, 아니면
 * 원본의 가장 이른 석 달(최근 시기와 겹치지 않는 것)을 쓴다.
 */
export function periods(recentEnd, available) {
  const recent = Array.from({ length: PERIOD }, (_, k) => shiftMonth(recentEnd, k - PERIOD + 1));
  const yearAgo = recent.map((m) => shiftMonth(m, -12));
  const have = new Set(available);
  if (yearAgo.every((m) => have.has(m))) return { base: yearAgo, recent, months: 12 };
  const earliest = [...have].filter((m) => m < recent[0]).sort().slice(0, PERIOD);
  if (earliest.length < PERIOD) return null;
  const gap = (Number(recent[1].slice(0, 4)) * 12 + Number(recent[1].slice(4))) - (Number(earliest[1].slice(0, 4)) * 12 + Number(earliest[1].slice(4)));
  return { base: earliest, recent, months: gap };
}

/** 칸마다 두 시기 중앙값의 로그 변화. 자치구별로 모은다. */
export function cellChanges(deals, { base, recent }) {
  const b = new Set(base);
  const r = new Set(recent);
  const cells = new Map();
  for (const d of deals) {
    const side = b.has(d.month) ? "base" : r.has(d.month) ? "recent" : null;
    if (!side) continue;
    if (!cells.has(d.cell)) cells.set(d.cell, { district: d.district, base: [], recent: [] });
    cells.get(d.cell)[side].push(d.amount);
  }
  const byDistrict = new Map();
  for (const c of [...cells.values()].sort((x, y) => (x.district < y.district ? -1 : 1))) {
    if (!c.base.length || !c.recent.length) continue;
    if (!byDistrict.has(c.district)) byDistrict.set(c.district, []);
    byDistrict.get(c.district).push(Math.log(median(c.recent) / median(c.base)));
  }
  return byDistrict;
}

/** 칸을 다시 뽑아 중앙값의 5~95% 구간. 씨앗 고정 - 빌드마다 판정이 흔들리면 안 된다. */
export function band(values, { rounds = ROUNDS, seed = 20261001 } = {}) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const meds = [];
  for (let i = 0; i < rounds; i += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(next() * values.length)]);
    meds.push(median(sample));
  }
  meds.sort((a, b) => a - b);
  return [meds[Math.floor(rounds * 0.05)], meds[Math.floor(rounds * 0.95)]];
}

/** 자치구 행. 칸이 모자라면 값 없이 칸 수만 남긴다 - 빈칸과 "모자람"은 다르다. */
export function districtRows(byDistrict, districts) {
  return districts.map(({ code, name }) => {
    const values = byDistrict.get(code) ?? [];
    if (values.length < MIN_CELLS) return { code, name, cells: values.length, change: null };
    const [lo, hi] = band(values);
    return { code, name, cells: values.length, change: pct(median(values)), low: pct(lo), high: pct(hi) };
  });
}

/** 두 구를 갈라 볼 수 있나 - 90% 구간이 겹치지 않을 때만. 300쌍을 빌드에서 다 정해 둔다. */
export function pairVerdicts(rows) {
  const ok = rows.filter((r) => r.change !== null);
  const out = {};
  for (let i = 0; i < ok.length; i += 1) {
    for (let j = i + 1; j < ok.length; j += 1) {
      const [a, b] = [ok[i], ok[j]];
      out[`${a.code}-${b.code}`] = a.low > b.high || b.low > a.high;
    }
  }
  return out;
}

/** 권역으로 묶은 칸 변화와 공식 실거래가격지수의 같은 기간 변화. 우리 자가 크게 어긋나지 않는지 본다. */
export function regionCheck(byDistrict, official, { base, recent }) {
  return REGIONS.filter((r) => r.districts).map((r) => {
    const values = r.districts.flatMap((code) => byDistrict.get(code) ?? []);
    const rows = official?.[r.code];
    const map = new Map(rows ?? []);
    const at = (m) => map.get(m);
    const ours = values.length >= MIN_CELLS ? pct(median(values)) : null;
    const from = at(base[1]);
    const to = at(recent[1]) ?? at(recent[0]);
    const theirs = from && to ? pct(Math.log(to / from)) : null;
    return { code: r.code, name: r.name, ours, official: theirs, gap: ours !== null && theirs !== null ? Math.round((ours - theirs) * 10) / 10 : null };
  });
}

/** 자치구 조사 지수(R-ONE)의 같은 두 시기 평균 사이 변화. */
export function surveyChange(series, { base, recent }) {
  const map = new Map(series ?? []);
  const avg = (ms) => {
    const v = ms.map((m) => map.get(m)).filter((x) => Number.isFinite(x));
    return v.length === ms.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const a = avg(base);
  const b = avg(recent);
  return a && b ? pct(Math.log(b / a)) : null;
}

const label = (m, en) =>
  en
    ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(4)) - 1]} ${m.slice(0, 4)}`
    : `${m.slice(0, 4)}년 ${Number(m.slice(4))}월`;
/** 같은 해면 "2025년 8~10월", 해가 걸치면 "2025년 12월~2026년 2월". */
const span = (ms, en) => {
  const [a, b] = [ms[0], ms.at(-1)];
  if (en) return `${label(a, true)}–${label(b, true)}`;
  return a.slice(0, 4) === b.slice(0, 4) ? `${a.slice(0, 4)}년 ${Number(a.slice(4))}~${Number(b.slice(4))}월` : `${label(a)}~${label(b)}`;
};
const signed = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export function leadSentence(rows, pairs, p, locale = "ko") {
  const en = locale === "en";
  const ok = rows.filter((r) => r.change !== null).sort((a, b) => b.change - a.change);
  if (ok.length < 2) return null;
  const distinct = Object.values(pairs).filter(Boolean).length;
  const total = Object.keys(pairs).length;
  const [top, bottom] = [ok[0], ok.at(-1)];
  return en
    ? `Comparing the same complexes and unit types in ${span(p.base, true)} and ${span(p.recent, true)} (${p.months} months apart), ` +
        `${top.name} moved ${signed(top.change)} and ${bottom.name} ${signed(bottom.change)}. ` +
        `Of ${total} district pairs, ${distinct} can be told apart — for the rest the gap sits inside the noise.`
    : `같은 단지 같은 평형을 ${span(p.base)}과 ${span(p.recent)}(${p.months}개월 간격)에 견주면 ` +
        `${top.name}는 ${signed(top.change)}, ${bottom.name}는 ${signed(bottom.change)} 움직였습니다. ` +
        `두 구씩 짝지은 ${total}쌍 가운데 ${distinct}쌍만 차이를 말할 수 있습니다 — 나머지는 그 차이가 표본이 만드는 흔들림 안에 있습니다.`;
}
