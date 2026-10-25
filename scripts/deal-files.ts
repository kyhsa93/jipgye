import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { normalizeDeal } from "./realestate-metrics.ts";
import { byCell, recordHighOf, toDeal } from "./record-high.ts";

export const MAX_MONTHS = 3;

export function periodOf(date) {
  const text = String(date ?? "");
  const period = text.slice(0, 4) + text.slice(5, 7);
  return /^\d{6}$/.test(period) ? period : null;
}

function trimDeal({ district: _name, ...deal }) {
  return deal;
}

const NAME_OF = new Map(DISTRICTS.map(({ code, name }) => [code, name]));

const recordKey = (d) => `${d.district}|${d.apt}|${d.area}|${d.floor}|${d.amount10k}|${d.date}`;

/**
 * 신고가 표지(D1, #704). 원본 매매 전부(raw/sale, 해제 포함 그대로)를 신고가 화면(build-record-high.ts)과 같은 칸으로 묶어
 * recordHighOf 로 가르고, 거래 파일의 건과 같은 정규화(normalizeDeal)로 맞춘 키에 true 인 것만 담는다.
 * 판단 불가(선행 부족)·직거래·해제는 toDeal/recordHighOf 가 빼므로 표지가 붙지 않는다. 같은 키에 판정이 갈리면(원본 이름
 * 공백 차 등) 붙이지 않는다 - 확실한 것만 표시한다.
 */
export function recordHighKeys(items) {
  const deals = [];
  for (const item of items ?? []) {
    const deal = toDeal(item);
    if (deal) deals.push({ deal, item });
  }
  const cells = byCell(deals.map((x) => x.deal));
  const flags = new Map();
  for (const { deal, item } of deals) {
    const name = NAME_OF.get(String(item.sggCd));
    const norm = name && normalizeDeal(item, name);
    if (!norm) continue;
    const key = recordKey(norm);
    const flag = recordHighOf(cells.get(deal.cell), deal) === true;
    flags.set(key, flags.has(key) && flags.get(key) !== flag ? null : flag);
  }
  return new Set([...flags].filter(([, flag]) => flag === true).map(([key]) => key));
}

/** 거래 파일 건에 표지를 단다. 신고가인 건에만 recordHigh: true - 나머지는 키를 두지 않는다(파일 바이트). */
export function markRecordHighs(deals, keys) {
  if (!keys?.size) return deals;
  return deals.map((deal) => (keys.has(recordKey(deal)) ? { ...deal, recordHigh: true } : deal));
}

const byAmount = (deal) => deal.amount10k ?? 0;
const byDeposit = (deal) => deal.deposit10k ?? 0;

export function collectDeals(freshDeals, maxMonths = MAX_MONTHS, valueOf = byAmount) {
  const all = (freshDeals ?? []).map(trimDeal).filter((deal) => periodOf(deal?.date));

  const periods = [...new Set(all.map((deal) => periodOf(deal.date)))].sort().slice(-maxMonths);
  const within = new Set(periods);

  const deals = all
    .filter((deal) => within.has(periodOf(deal.date)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || valueOf(b) - valueOf(a));

  return { periods, deals };
}

export function buildDealFiles(source, now, maxMonths = MAX_MONTHS, valueOf = byAmount, recordKeys = null) {
  if (!source?.period) return null;

  const byDistrict = new Map();
  for (const deal of Object.values<any>(source?.districts ?? {}).flat()) {
    const name = String(deal?.district ?? "").trim();
    if (!name || !DISTRICT_SLUGS[name]) continue;
    if (!byDistrict.has(name)) byDistrict.set(name, []);
    byDistrict.get(name).push(deal);
  }

  const updatedAt = now.toISOString();
  const files = {};

  for (const name of [...byDistrict.keys()].sort((a, b) => a.localeCompare(b, "ko"))) {
    const { periods, deals } = collectDeals(markRecordHighs(byDistrict.get(name), recordKeys), maxMonths, valueOf);
    if (!deals.length) continue;

    files[DISTRICT_SLUGS[name]] = { district: name, updatedAt, periods, deals };
  }

  return files;
}

export const dealFileName = (slug) => `deals-${slug}.json`;

export const rentFileName = (slug) => `rents-${slug}.json`;

export function buildRentFiles(source, now, maxMonths = MAX_MONTHS) {
  return buildDealFiles(source, now, maxMonths, byDeposit);
}
