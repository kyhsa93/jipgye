/**
 * 가격대별 해제율 - 비싼 집일수록 계약이 더 깨지나.
 *
 * 그냥 세면 최근 계약일수록 해제율이 낮다(2026-09 1.5% … 2025-08 7.3%). 해제는 계약 뒤 시간이 지나며
 * 쌓이니 최근 달은 아직 덜 쌓인 것이다(DIRECTION 체크리스트 7). 그래서 해제까지 걸린 날의 95분위
 * (지금 104일)만큼 지난 계약월 - "해제가 다 쌓인 달" - 만 센다.
 *
 * 그것으로도 모자라다. 해제가 다 쌓인 달 사이에도 해제율이 크게 다르고(10·15 대책 무렵), 달마다 가격대
 * 구성도 다르다. 해제율이 높던 달에 비싼 거래가 몰렸다면 가격대 차이는 시기 차이일 뿐이다. 그래서
 * 같은 계약월 안에서만 가격대를 견준다(달마다 "그 대의 해제율 - 그 달 전체 해제율"을 계약 수로 가중 평균).
 * 가장 싼 대와 가장 비싼 대의 차이는 달 안에서 계약을 다시 뽑아 90% 구간을 내고, 그 구간이 0을 품으면
 * "가격대로 갈리지 않는다"고 적는다.
 *
 * 조사: research/cancel-by-price/ (2026-10-01: 25억 초과 - 6억 이하 = +1.80%p, 90% +1.26~+2.39%p).
 */

export const BANDS = [
  { key: "upTo6", lo: 0, hi: 60_000, ko: "6억 이하", en: "up to ₩600M" },
  { key: "upTo9", lo: 60_000, hi: 90_000, ko: "6억~9억", en: "₩600–900M" },
  { key: "upTo15", lo: 90_000, hi: 150_000, ko: "9억~15억", en: "₩0.9–1.5B" },
  { key: "upTo25", lo: 150_000, hi: 250_000, ko: "15억~25억", en: "₩1.5–2.5B" },
  { key: "over25", lo: 250_000, hi: Infinity, ko: "25억 초과", en: "above ₩2.5B" },
];
export const SETTLE_QUANTILE = 0.95;
export const ROUNDS = 400;

const isCancelled = (item) => String(item?.cdealType ?? "").trim().length > 0;
const amountOf = (item) => Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
const monthOf = (item) => `${item.dealYear}${String(item.dealMonth).padStart(2, "0")}`;
const dealTime = (item) => Date.UTC(Number(item.dealYear), Number(item.dealMonth) - 1, Number(item.dealDay));
function cancelTime(item) {
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(item?.cdealDay ?? "").trim());
  return m ? Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const DAY = 86400000;

/** 해제가 다 쌓인 계약월: 그 달 마지막 날에서 해제까지 걸린 날의 95분위만큼 지난 달. */
export function settledMonths(items) {
  const gaps = items
    .filter(isCancelled)
    .map((item) => (cancelTime(item) === null ? null : (cancelTime(item) - dealTime(item)) / DAY))
    .filter((g) => g !== null && g >= 0)
    .sort((a, b) => a - b);
  if (!gaps.length) return { settleDays: null, months: [] };
  const settleDays = gaps[Math.floor(gaps.length * SETTLE_QUANTILE)];
  // 스프레드는 인자 수만큼 호출 스택을 쓴다. 원본 전체(13만 건 넘음)를 받는 자리라 reduce로 센다(#97).
  const end = items.reduce((m, item) => Math.max(m, dealTime(item)), -Infinity);
  const months = [...new Set(items.map(monthOf))].filter((m) => {
    const last = Date.UTC(Number(m.slice(0, 4)), Number(m.slice(4)), 0);
    return (end - last) / DAY >= settleDays;
  });
  return { settleDays, months: months.sort() };
}

/** 같은 달 안에서 한 가격대가 그 달 전체보다 얼마나 높나(%p), 계약 수 가중. */
function stratified(byMonth, band) {
  let num = 0;
  let den = 0;
  for (const deals of byMonth.values()) {
    const base = deals.reduce((s, d) => s + d.c, 0) / deals.length;
    const inBand = deals.filter((d) => d.a > band.lo && d.a <= band.hi);
    if (!inBand.length) continue;
    num += (inBand.reduce((s, d) => s + d.c, 0) / inBand.length - base) * inBand.length;
    den += inBand.length;
  }
  return den ? num / den : null;
}

export function priceBandStats(items, { rounds = ROUNDS, seed = 20261001 } = {}) {
  const { settleDays, months } = settledMonths(items);
  if (!months.length) return null;
  const keep = new Set(months);
  const byMonth = new Map();
  for (const item of items) {
    const m = monthOf(item);
    if (!keep.has(m)) continue;
    const a = amountOf(item);
    if (!(a > 0)) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push({ a, c: isCancelled(item) ? 1 : 0 });
  }
  const all = [...byMonth.values()].flat();
  const pct = (v) => Math.round(v * 1000) / 10;
  const pp = (v) => Math.round(v * 10000) / 100;
  const rows = BANDS.map((band) => {
    const inBand = all.filter((d) => d.a > band.lo && d.a <= band.hi);
    const s = stratified(byMonth, band);
    return { key: band.key, ko: band.ko, en: band.en, n: inBand.length, rate: inBand.length ? pct(inBand.reduce((x, d) => x + d.c, 0) / inBand.length) : null, withinMonth: s === null ? null : pp(s) };
  });

  // 가장 싼 대와 가장 비싼 대의 같은-달 차이, 달 안에서 다시 뽑은 90% 구간.
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const [low, high] = [BANDS[0], BANDS.at(-1)];
  const diff = (bm) => stratified(bm, high) - stratified(bm, low);
  const diffs = [];
  for (let r = 0; r < rounds; r += 1) {
    const sample = new Map();
    for (const [m, deals] of byMonth) sample.set(m, Array.from({ length: deals.length }, () => deals[Math.floor(next() * deals.length)]));
    diffs.push(diff(sample));
  }
  diffs.sort((a, b) => a - b);
  return {
    settleDays,
    months,
    deals: all.length,
    rows,
    gap: { point: pp(diff(byMonth)), low: pp(diffs[Math.floor(rounds * 0.05)]), high: pp(diffs[Math.floor(rounds * 0.95)]) },
  };
}

const span = (ms, en) => {
  const f = (m) => (en ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(4)) - 1]} ${m.slice(0, 4)}` : `${m.slice(0, 4)}년 ${Number(m.slice(4))}월`);
  return `${f(ms[0])}~${f(ms.at(-1))}`;
};

export function priceBandSentence(stats, locale = "ko") {
  if (!stats) return null;
  const en = locale === "en";
  const [low, high] = [stats.rows[0], stats.rows.at(-1)];
  const { point, low: lo, high: hi } = stats.gap;
  const differs = lo > 0 || hi < 0;
  const head = en
    ? `Counting only contract months where cancellations have settled (95% of cancellations come within ${stats.settleDays} days; ${span(stats.months, true)}), ${low.rate}% of deals ${low.en} and ${high.rate}% of deals ${high.en} were cancelled. `
    : `해제가 다 쌓인 계약월(해제의 95%가 계약 뒤 ${stats.settleDays}일 안에 일어난다 — ${span(stats.months)})만 놓고 보면, ${low.ko} 계약은 ${low.rate}%, ${high.ko}는 ${high.rate}%가 해제됐습니다. `;
  if (!differs) {
    return head + (en
      ? `Comparing within the same months only, the gap is ${point}pp (90% ${lo} to ${hi}pp), which includes zero — price band does not separate them.`
      : `같은 달 안에서만 견주면 차이가 ${point}%p(90% ${lo}~${hi}%p)로 0을 품습니다 — 가격대로 갈리지 않습니다.`);
  }
  return head + (en
    ? `Comparing within the same months only — so a month with many cancellations cannot lend its rate to the price band that happened to trade then — the dearest band still runs ${point}pp higher (90% ${lo} to ${hi}pp).`
    : `해제가 많던 달에 비싼 거래가 몰려서 생긴 차이일 수 있어 같은 달 안에서만 견줘도, 가장 비싼 대가 ${point}%p(90% ${lo}~${hi}%p) 높습니다 — 비싼 집일수록 계약이 깨지는 일이 조금 더 잦습니다.`);
}

export function priceBandTableHtml(stats, locale = "ko") {
  if (!stats) return null;
  const en = locale === "en";
  const head = en ? ["Price band", "Deals", "Cancelled", "vs same month"] : ["가격대", "계약", "해제율", "같은 달 대비"];
  const pp = en ? "pp" : "%p";
  const tag = en ? "en-US" : "ko-KR";
  const body = stats.rows
    .map((r) => `<tr><td>${en ? r.en : r.ko}</td><td>${r.n.toLocaleString(tag)}</td><td>${r.rate === null ? "-" : `${r.rate}%`}</td><td>${r.withinMonth === null ? "-" : `${r.withinMonth > 0 ? "+" : ""}${r.withinMonth}${pp}`}</td></tr>`)
    .join("");
  return `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody>`;
}
