/**
 * 직거래는 같은 칸 중개거래보다 얼마나 낮게 신고되나, 구마다 직거래가 얼마나 되나(#691 N9).
 *
 * 「옆집이 3억 싸게 팔렸다」는 말을 들은 사람이 그게 시세인지 직거래 예외인지 가를 근거가 없었다. 시세 화면은
 * 직거래를 빼고 세고(complex-price·district-change), 실거래 검색에는 「직거래 제외」 토글만 있다.
 *
 * 견주는 자리는 층 격차와 같은 칸(같은 자치구·단지·전용면적, floor-gap.ts cellKey)이다. 칸마다 직거래 중앙값이
 * 중개거래 중앙값보다 몇 % 낮은지를 재고, 그 칸 값들의 중앙값을 낸다. 90% 구간은 칸을 다시 뽑아 낸
 * 중앙값의 5~95%다(district-change.ts band, 씨앗 고정).
 *
 * 문턱은 계산 전에 고정했다(#691 판정): 칸은 양쪽 각각 complex-price.ts MIN_DEALS(3건) 이상, 자치구는
 * floor-gap.ts MIN_CELLS(20칸) 이상일 때만 격차를 적는다. 새 문턱은 없다. 층 격차와 달리 OUTLIER(±50%)로
 * 칸을 버리지 않는다 - 시세와 크게 다른 직거래가 바로 이 화면이 재려는 것이라, 그것을 버리면 격차가 줄어 보인다.
 *
 * 창은 원본 24개월 전체다(RETENTION_MONTHS). 직거래가 한 칸에 세 건 모이려면 그만큼 길어야 한다. 그래서 칸
 * 안의 시점 차이는 통제되지 않는다 - 화면 단서에 적는다. 만들 때 재 보니(2026-10-26, 맞물린 115칸) 직거래의
 * 중앙 계약월이 중개거래보다 칸마다 중앙값 1개월(평균 0.68개월) 일렀다. 그래서 시점 교란을 따로 쟀다(#702 data-analyst,
 * raw 600파일·115칸): 중개거래로 만든 칸 고정·월 효과 지수는 24개월 +30.4%(월 ~1.2%)이고, 그 지수로 값을 고르면 격차는
 * -14.1%(오히려 커짐), 칸별 계약월 차이가 설명하는 몫은 평균 -0.8%p다. 칸×6개월(양쪽 3건 이상, 20칸) -13.3%,
 * 칸×분기(2건 이상, 87칸) -17.3%. 시점 차이는 -12.3%를 설명하지 못한다 - 숫자는 고치지 않고 단서 문장만 그렇게 적는다.
 *
 * 직거래 표시(dealingGbn)는 24개월 원본 전부에서 빈칸 0건이었다(2026-10-26 raw/sale 600파일 계수: 해제 뺀
 * 137,712건 모두 「직거래」 또는 「중개거래」). 그래도 비거나 다른 값이면 비중의 분모에서 뺀다 - 0으로 세지 않는다.
 *
 * 이 계산은 직거래가 왜 직거래인지 모른다. 가족 간 거래·분양 정산·시세대로 한 당사자 거래가 모두 같은 표시로
 * 들어온다. 문장도 그 이상을 말하지 않는다. 단지명·칸 키·건별 값은 출력에 없다.
 */

import { MIN_DEALS } from "./complex-price.ts";
import { MIN_CELLS, cellKey, median } from "./floor-gap.ts";
import { band } from "./district-change.ts";
import { PARTIAL_MONTHS } from "./conversion-series.ts";

export { MIN_DEALS, MIN_CELLS, PARTIAL_MONTHS };

const round1 = (value) => Math.round(value * 10) / 10;
const amountOf = (item) => Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
const monthOf = (item) => `${item?.dealYear}${String(item?.dealMonth).padStart(2, "0")}`;

/** 원본 한 줄의 거래 형태. 해제된 것·값 없는 것·표시가 비거나 낯선 것은 null. */
export function dealKind(item) {
  if (String(item?.cdealType ?? "").trim()) return null;
  const kind = String(item?.dealingGbn ?? "").trim();
  if (kind === "직거래") return "direct";
  if (kind === "중개거래") return "brokered";
  return null;
}

/**
 * 달마다 거래 수와 직거래 수. 거래가 0건인 달(원본이 없거나 비었다)은 share 를 0이 아니라 null 로 둔다 -
 * 빈 달과 직거래 0%인 달은 다르다.
 */
export function monthlyShare(items, months: string[]) {
  const deals = months.map(() => 0);
  const direct = months.map(() => 0);
  const index = new Map<string, number>(months.map((m, i) => [m, i]));
  for (const item of items ?? []) {
    const kind = dealKind(item);
    const i = index.get(monthOf(item));
    if (!kind || i === undefined) continue;
    deals[i] += 1;
    if (kind === "direct") direct[i] += 1;
  }
  return { deals, direct, share: deals.map((n, i) => (n ? round1((direct[i] / n) * 100) : null)) };
}

/** 칸 하나의 직거래 격차(%). 양쪽 모두 MIN_DEALS 이상일 때만, 아니면 null. 음수면 직거래가 낮다. */
export function cellGap(direct, brokered) {
  if (direct.length < MIN_DEALS || brokered.length < MIN_DEALS) return null;
  const base = median(brokered);
  if (!(base > 0)) return null;
  const gap = (median(direct) / base - 1) * 100;
  return Number.isFinite(gap) ? gap : null;
}

/** 자치구별 칸 격차 목록. 칸 키는 여기서만 쓰고 밖으로 내지 않는다. 출력 순서는 입력(자치구) 순서다. */
export function districtGaps(byDistrict) {
  const out = new Map();
  for (const [district, items] of Object.entries(byDistrict ?? {}) as [string, any[]][]) {
    const cells = new Map();
    for (const item of items ?? []) {
      const kind = dealKind(item);
      const price = amountOf(item);
      if (!kind || !(price > 0)) continue;
      const key = cellKey(item);
      if (!cells.has(key)) cells.set(key, { direct: [], brokered: [] });
      cells.get(key)[kind].push(price);
    }
    const gaps = [];
    let directDeals = 0;
    // 칸 순서가 재추출 결과를 바꾸므로 키로 정렬한다(파일을 읽은 순서가 답을 흔들지 않게).
    for (const key of [...cells.keys()].sort()) {
      const cell = cells.get(key);
      const gap = cellGap(cell.direct, cell.brokered);
      if (gap === null) continue;
      gaps.push(gap);
      directDeals += cell.direct.length;
    }
    out.set(district, { gaps, directDeals });
  }
  return out;
}

/** 칸 격차 목록을 한 줄로. minCells 에 못 미치면 값을 비우고 칸 수만 남긴다. */
export function summarizeGaps(gaps, directDeals, minCells) {
  if (!gaps.length || gaps.length < minCells) return { cells: gaps.length, directDeals, median: null, low: null, high: null, lowerShare: null };
  const [lo, hi] = band(gaps);
  return {
    cells: gaps.length,
    directDeals,
    median: round1(median(gaps)),
    low: round1(lo),
    high: round1(hi),
    lowerShare: round1((gaps.filter((g) => g < 0).length / gaps.length) * 100),
  };
}

/** 덜 찬 달을 뺀 합계 비중. 닫힌 달이 비면 null. */
export function closedShare(series, partial) {
  let deals = 0;
  let direct = 0;
  series.deals.forEach((n, i) => {
    if (partial[i]) return;
    deals += n;
    direct += series.direct[i];
  });
  return deals ? round1((direct / deals) * 100) : null;
}

/**
 * 서울 + 자치구. byDistrict: { 구이름: 원본 매매 배열 }(24개월), months: 오래된 달 → 최근 달(YYYYMM).
 * districts: [{ name }] - 원본이 없는 구도 빈 줄로 남긴다(칸이 사라지지 않는다). 키는 가나다순.
 */
export function directDealStats(byDistrict, months, districts) {
  const partial = months.map((_, i) => i >= months.length - PARTIAL_MONTHS);
  const names = districts.map((d) => d.name).sort((a, b) => a.localeCompare(b, "ko"));
  const gaps = districtGaps(byDistrict);

  const seoulSeries = monthlyShare(Object.values(byDistrict ?? {}).flat(), months);
  const allGaps = [...gaps.values()].flatMap((g) => g.gaps);
  const allDirect = [...gaps.values()].reduce((s, g) => s + g.directDeals, 0);

  const row = (series, gap) => ({ ...series, closedShare: closedShare(series, partial), gap });
  const out = {
    months: [...months],
    partial,
    minDeals: MIN_DEALS,
    minCells: MIN_CELLS,
    // 서울은 칸을 다 모은 것이라 자치구 문턱(MIN_CELLS)을 같이 건다 - 서울만 다른 규칙을 쓰지 않는다.
    seoul: row(seoulSeries, summarizeGaps(allGaps, allDirect, MIN_CELLS)),
    districts: {},
  };
  for (const name of names) {
    const g = gaps.get(name) ?? { gaps: [], directDeals: 0 };
    out.districts[name] = row(monthlyShare(byDistrict?.[name] ?? [], months), summarizeGaps(g.gaps, g.directDeals, MIN_CELLS));
  }
  return out;
}

/** 절 제목. 화면(cancelled-deals.html)에 구운 한국어와 같아야 한다 - 시험이 대조한다. */
// 「낮게 신고」는 거짓·다운 신고(부동산 거래신고법)로 읽힐 수 있어 쓰지 않는다(#702 legal 판정).
export const DIRECT_HEADING = { ko: "직거래는 중개거래보다 얼마에 거래되나", en: "How do direct-deal prices compare?" };

const signed = (v) => `${v > 0 ? "+" : ""}${v}`;
/** 구간은 끝에만 % 를 붙인다 - 「-14.3%~-10.7%」는 375폭 표에서 넘치고 물결과 빼기가 붙어 읽힌다. */
const range = (g) => `${signed(g.low)}~${signed(g.high)}%`;
const ym = (m, en) =>
  en
    ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(4)) - 1]} ${m.slice(0, 4)}`
    : `${m.slice(0, 4)}년 ${Number(m.slice(4))}월`;

/** 화면 첫 문단. 격차가 없으면(칸 미달) 비중만 말한다. */
export function directLead(stats, locale = "ko") {
  if (!stats?.months?.length) return null;
  const en = locale === "en";
  const tag = en ? "en-US" : "ko-KR";
  const closed = stats.months.filter((_, i) => !stats.partial[i]);
  const shares = stats.seoul.share.filter((v, i) => !stats.partial[i] && v !== null);
  if (!closed.length || !shares.length) return null;
  const span = `${ym(closed[0], en)}~${ym(closed.at(-1), en)}`;
  const lo = Math.min(...shares);
  const hi = Math.max(...shares);
  const share = en
    ? `From ${span}, direct deals — filed without an agent — were ${stats.seoul.closedShare}% of Seoul apartment sales, between ${lo}% and ${hi}% in any one month.`
    : `${span} 서울 아파트 매매 가운데 중개사 없이 신고된 직거래는 ${stats.seoul.closedShare}%였습니다. 달마다 ${lo}~${hi}% 사이였습니다.`;

  const gap = stats.seoul.gap;
  if (gap?.median === null || !gap?.cells) return share;
  const cells = gap.cells.toLocaleString(tag);
  const size = Math.abs(gap.median);
  const dir = en ? (gap.median < 0 ? "below" : "above") : gap.median < 0 ? "낮았습니다" : "높았습니다";
  const body = en
    ? ` Within the same complex and unit size, direct deals were a median ${size}% ${dir} agent-brokered ones (90% range ${range(gap)}, across ${cells} unit types with at least ${stats.minDeals} of each), and came in lower in ${gap.lowerShare}% of those unit types.`
    : ` 같은 단지·같은 전용면적에서 견주면 직거래는 중개거래보다 중앙값 ${size}% ${dir}(90% 구간 ${range(gap)}, 양쪽 모두 ${stats.minDeals}건 이상인 ${cells}칸). 그 칸의 ${gap.lowerShare}%에서 직거래가 더 낮았습니다.`;

  // 자치구가 하나도 문턱을 못 넘으면 표의 빈칸이 왜 비었는지 문장으로 적는다.
  const rows = Object.values(stats.districts ?? {}) as any[];
  if (!rows.length || rows.some((r) => r.gap.median !== null)) return share + body;
  const most = Math.max(...rows.map((r) => r.gap.cells));
  const tail = en
    ? ` Split by district, even the best-covered district has only ${most} such unit types (the floor is ${stats.minCells}), so districts show only the direct-deal share.`
    : ` 자치구로 나누면 맞물린 칸이 가장 많은 구도 ${most}칸이라(문턱 ${stats.minCells}칸) 구별로는 직거래 비중만 적습니다.`;
  return share + body + tail;
}

/** 표 아래 단서. 사유를 모른다는 것과 무엇을 통제하지 못했는지. */
export function directNote(stats, locale = "ko") {
  const en = locale === "en";
  const partial = (stats?.months ?? []).filter((_, i) => stats.partial[i]).map((m) => ym(m, en));
  const minDeals = stats?.minDeals ?? MIN_DEALS;
  const minCells = stats?.minCells ?? MIN_CELLS;
  return en
    ? `A direct deal is one the parties filed without a licensed agent. Transfers within a family, settlements with a developer or redevelopment association and ordinary sales between strangers all carry the same mark, and the filing gives no reason, so why they come in lower is unknown. This gap does not show that any one deal was between related parties, improper, or filed with false details. ` +
        `A unit type counts only when it has at least ${minDeals} direct and ${minDeals} brokered deals (the same floor as the price screens); districts have too few unit types for a gap of their own, so none is given. ` +
        `The two years go into one comparison. Direct deals were usually signed about a month earlier, but re-measuring with month-to-month price movement removed did not shrink the gap (checked 2026-10-26). ${partial.length ? `${partial.join(" and ")} are still filling up — filings arrive for 30 days after a contract — so they are marked, their share is not shown, and they are left out of the totals.` : ""}`
    : `직거래는 공인중개사 없이 당사자끼리 신고한 거래입니다. 가족 간 거래, 분양·조합 정산, 모르는 사람끼리 시세대로 한 거래가 모두 같은 표시로 들어오고, 신고 자료에는 사유가 없어 왜 낮은지는 알 수 없습니다. 이 격차로 어느 한 거래가 특수관계 거래라거나, 부당했다거나, 신고가 사실과 다르다고 말할 수 없습니다. ` +
        `칸은 직거래·중개거래가 각각 ${minDeals}건 이상인 같은 구·단지·전용면적만 세고(시세 화면의 칸 문턱), 자치구별 격차는 칸이 모자라 적지 않습니다. ` +
        `두 해를 한 칸에 담았습니다. 직거래가 대체로 한 달쯤 먼저 계약됐지만, 달마다의 시세 변화를 걸러 다시 재도 격차는 줄지 않았습니다(2026-10-26 확인). ${partial.length ? `${partial.join("·")}은 계약 뒤 30일까지 신고가 들어오는 덜 찬 달이라 건수만 적고 비중은 적지 않으며 합계에서도 뺍니다.` : ""}`;
}

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** 자치구 표(서울 줄 먼저). 구별 격차 열은 칸이 모자라 두지 않는다 - 문턱 넘는 구가 생겨도 열 복귀는 별도 판정(#702). JSON 의 gap 은 둔다. */
export function directTableHtml(stats, locale = "ko") {
  const en = locale === "en";
  const head = en ? ["District", "Direct deals"] : ["자치구", "직거래"];
  const tr = (name, r) =>
    `<tr><td>${esc(name)}</td><td>${r.closedShare === null ? "-" : `${r.closedShare}%`}</td></tr>`;
  const rows = [tr(en ? "Seoul" : "서울", stats.seoul), ...Object.entries(stats.districts).map(([name, r]) => tr(name, r))];
  return `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
}

/** 서울 월별 표. 덜 찬 달은 표시를 붙이고 비중은 「-」다 - 신고 지연이 거래 형태마다 달라 치우친 값이 헤드라인처럼 읽힌다(#702). */
export function directMonthsHtml(stats, locale = "ko") {
  const en = locale === "en";
  const tag = en ? "en-US" : "ko-KR";
  const head = en ? ["Contract month", "Deals", "Direct", "Share"] : ["계약월", "거래", "직거래", "비중"];
  const mark = en ? " (filling)" : " (덜 참)";
  const s = stats.seoul;
  const rows = stats.months.map(
    (m, i) =>
      `<tr><td>${m.slice(0, 4)}-${m.slice(4)}${stats.partial[i] ? mark : ""}</td><td>${s.deals[i].toLocaleString(tag)}</td>` +
      `<td>${s.direct[i].toLocaleString(tag)}</td><td>${stats.partial[i] || s.share[i] === null ? "-" : `${s.share[i]}%`}</td></tr>`
  );
  return `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
}
