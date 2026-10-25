/**
 * 이번 주 새로 신고된 거래 (#703 W1). 순수 함수만 - 파일은 build-week-digest.ts 가 읽고 쓰고, 화면 문장은 week-digest-view.ts 가 굽는다.
 *
 * 「이번 주」는 계약일도 신고일도 아니고 **수집일**이다. 원본(raw/sale·raw/rent)의 `arrivals` 는 그 줄이 처음 보인 수집일(KST)이라
 * 「이번 7일 수집에 새로 보인 신고」를 센다. 중앙값 신고 지연이 13~18일이라(#703 data-analyst 집계) 대부분은 지난달·이번 달 계약이다.
 *
 * 세는 법(#703 판정·data-analyst 제안):
 * - 건수는 **고유 도착 키**(itemKey)다. 같은 내용의 줄은 키가 같아 도착일이 하나로 합쳐지므로 원본 행 수(1,274)와 고유 키 수(1,011)가 다르다.
 *   한 키를 한 건으로 센다 - 행으로 세면 같은 키가 한 번 도착했는데 여러 건으로 불어난다.
 * - 수집일 = 매매∪전월세 도착이 1건이라도 있는 날. 전월세는 주말에도 7건 넘게 들어와 0이면 수집이 안 된 날이다.
 * - 수집 공백 가드: 두 7일 창 어느 쪽에든, 또는 직전 창 시작 전날에 수집 없는 날이 있으면 「늘었다/줄었다」를 쓰지 않는다.
 *   공백 다음 날 신고가 몰리므로(10-24 전월세 1,263건, 평일 600~900) 공백이 창 안에 있든 창 바로 앞에 있든 비교가 기운다.
 *   문턱은 「수집 공백 0일」 하나로 미리 고정했다 - 수집일 수(<5)로 재면 10-19~25(6/7) 같은 기운 쌍이 통과한다.
 * - 신고가: record-high.ts 와 같은 규칙(중개·해제 아님, 같은 칸 선행 ≥3건·기간 ≥180일, 그 전 최고가 초과). 판정 못 하는 건은 따로 센다.
 * - 해제: 매매 해제행(cdealType/cdealDay)은 원행이 사라지고 새로 도착한다. 「해제일이 이 7일 안」인 고유 키를 센다(도착 기준 수도 함께 싣는다).
 * - 단지명은 싣지 않는다. 구는 이름만, 순위가 아니라 「많은 곳」이다.
 */
import { MIN_PRIOR, MIN_SPAN_DAYS, toDeal } from "./record-high.ts";

const DAY = 86400000;
export const WINDOW_DAYS = 7;
/** 많은 구 몇 곳을 싣나. */
export const TOP_DISTRICTS = 3;

const toTime = (day) => Date.parse(`${day}T00:00:00Z`);
const toDay = (time) => new Date(time).toISOString().slice(0, 10);
export const addDays = (day, n) => toDay(toTime(day) + n * DAY);

const isCancel = (item) => String(item?.cdealType ?? "").trim().length > 0 || String(item?.cdealDay ?? "").trim().length > 0;
/** 해제일 「26.10.07」 → 2026-10-07. 모양이 다르면 null. */
export function cancelDay(item) {
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(item?.cdealDay ?? "").trim());
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}
const isWolse = (item) => Number(String(item?.monthlyRent ?? "0").replace(/,/g, "")) > 0;
const contractMonth = (item) => `${item.dealYear}${String(item.dealMonth).padStart(2, "0")}`;

/**
 * 원본 파일들을 고유 키 단위로 편다. 파일 안 같은 키의 줄은 하나로 친다(도착일이 하나뿐이다).
 * slots: [{ kind, district, items, arrivals }] - ok:false 나 items 없는 파일은 부르는 쪽이 뺀다. keyOf 는 realestate-raw.ts 의 itemKey(주입 - 이 모듈은 fs 를 안 읽는다).
 */
export function uniqueArrivals(slots, keyOf) {
  const rows = [];
  for (const { kind, district, items, arrivals } of slots) {
    if (!arrivals) continue;
    const byKey = new Map();
    for (const item of items ?? []) {
      const key = keyOf(item);
      if (!byKey.has(key)) byKey.set(key, item);
    }
    for (const [key, day] of Object.entries(arrivals)) {
      const item = byKey.get(key);
      if (item) rows.push({ kind, district: String(district), key, day, item });
    }
  }
  return rows;
}

/** 수집일 집합(도착이 1건이라도 있는 날). */
export const collectionDays = (rows) => new Set(rows.map((r) => r.day));

/** 끝 날(포함)에서 두 7일 창과 가드 범위. */
export function windows(end) {
  const current = { from: addDays(end, -(WINDOW_DAYS - 1)), to: end };
  const previous = { from: addDays(end, -(2 * WINDOW_DAYS - 1)), to: addDays(end, -WINDOW_DAYS) };
  return { current, previous, guardFrom: addDays(previous.from, -1) };
}

/** 가드 범위(직전 창 시작 전날~끝 날) 안에서 수집이 없는 날. */
export function gapDays(days, end) {
  const { guardFrom } = windows(end);
  const out = [];
  for (let d = guardFrom; d <= end; d = addDays(d, 1)) if (!days.has(d)) out.push(d);
  return out;
}

/** 매매 원본 전체로 칸별 거래 목록(계약일 순). 신고가 판정의 「그 전 거래」다. */
export function saleCells(items) {
  const cells = new Map();
  for (const item of items) {
    const deal = toDeal(item);
    if (!deal) continue;
    if (!cells.has(deal.cell)) cells.set(deal.cell, []);
    cells.get(deal.cell).push(deal);
  }
  return cells;
}

/** 한 건이 신고가인가: null(판정 불가) · true · false. record-high.ts measure 의 선행 조건과 같다. */
export function recordVerdict(item, cells) {
  const deal = toDeal(item);
  if (!deal) return null;
  const before = (cells.get(deal.cell) ?? []).filter((x) => x.time < deal.time);
  if (before.length < MIN_PRIOR) return null;
  const first = before.reduce((m, x) => Math.min(m, x.time), Infinity);
  if (deal.time - first < MIN_SPAN_DAYS * DAY) return null;
  return deal.amount > before.reduce((m, x) => Math.max(m, x.amount), -Infinity);
}

const inWindow = (day, w) => day != null && day >= w.from && day <= w.to;

/** 한 창의 수. */
export function summarizeWindow(rows, w, cells, allSaleCancels) {
  const sale = [];
  const rent = { jeonse: 0, wolse: 0 };
  let cancelArrived = 0;
  const months = { sale: {}, rent: {} };
  const perDistrict = new Map();
  for (const r of rows) {
    if (!inWindow(r.day, w)) continue;
    if (r.kind === "sale") {
      if (isCancel(r.item)) {
        cancelArrived += 1;
        continue;
      }
      sale.push(r.item);
      perDistrict.set(r.district, (perDistrict.get(r.district) ?? 0) + 1);
      const m = contractMonth(r.item);
      months.sale[m] = (months.sale[m] ?? 0) + 1;
    } else {
      rent[isWolse(r.item) ? "wolse" : "jeonse"] += 1;
      const m = contractMonth(r.item);
      months.rent[m] = (months.rent[m] ?? 0) + 1;
    }
  }
  let direct = 0;
  let judged = 0;
  let records = 0;
  for (const item of sale) {
    if (String(item.dealingGbn ?? "").trim() === "직거래") direct += 1;
    const v = recordVerdict(item, cells);
    if (v === null) continue;
    judged += 1;
    if (v) records += 1;
  }
  const cancelDated = allSaleCancels.filter((r) => inWindow(cancelDay(r.item), w)).length;
  // 같은 수면 구 코드 순 - 같은 입력이면 같은 출력(결정성).
  const districts = [...perDistrict.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_DISTRICTS)
    .map(([code]) => code);
  return {
    ...w,
    sale: sale.length,
    jeonse: rent.jeonse,
    wolse: rent.wolse,
    cancelArrived,
    cancelDated,
    direct,
    directShare: sale.length ? Math.round((direct / sale.length) * 1000) / 10 : null,
    records,
    judged,
    districts,
    months,
  };
}

/**
 * 묶음 전체. rows 는 uniqueArrivals 의 결과, saleItems 는 매매 원본 전부(신고가 판정용), now 는 Date.
 * 도착이 하나도 없으면 null.
 */
export function buildDigest({ rows, saleItems, now }) {
  if (!rows.length) return null;
  const days = collectionDays(rows);
  const sorted = [...days].sort();
  // 끝 날 = 마지막 수집일. Daily 가 수집한 날이면 그날이다. 끝에 공백이 있으면(수집이 멈춤) 창이 그 날에 머물고 날짜가 화면에 보인다.
  const end = sorted.at(-1);
  const { current, previous } = windows(end);
  const gaps = gapDays(days, end);
  const cells = saleCells(saleItems);
  // 해제행은 고유 키로, 도착 창과 상관없이 해제일로 다시 고른다(해제일이 이번 주인데 다음 날 도착한 줄도 센다).
  const saleCancels = rows.filter((r) => r.kind === "sale" && isCancel(r.item));
  return {
    updatedAt: now.toISOString(),
    asOf: end,
    trackedFrom: sorted[0],
    basis: "unique-arrival-key",
    comparable: gaps.length === 0,
    gaps,
    current: summarizeWindow(rows, current, cells, saleCancels),
    previous: summarizeWindow(rows, previous, cells, saleCancels),
  };
}
