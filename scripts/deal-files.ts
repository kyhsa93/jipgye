import { keyedDeal } from "./complex-id.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { DISTRICTS } from "./realestate-districts.ts";

export const MAX_MONTHS = 3;

export function periodOf(date) {
  const text = String(date ?? "");
  const period = text.slice(0, 4) + text.slice(5, 7);
  return /^\d{6}$/.test(period) ? period : null;
}

function trimDeal({ district: _name, ...deal }) {
  return deal;
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

const CODE_OF = new Map(DISTRICTS.map(({ code, name }) => [name, code]));

/**
 * 구별 전수 파일. apt 는 칸과 같은 단지 키(#821)다 - 카드·관심 단지·검색 색인이 이 글자로 칸을 찾고 줄을 거른다.
 * sameNames: readSameNames 결과(구 코드 → 동명 단지). 이름이 유일한 줄은 그대로다.
 */
export function buildDealFiles(source, now, maxMonths = MAX_MONTHS, valueOf = byAmount, sameNames = {}) {
  if (!source?.period) return null;

  const byDistrict = new Map();
  for (const deal of Object.values<any>(source?.districts ?? {}).flat()) {
    const name = String(deal?.district ?? "").trim();
    if (!name || !DISTRICT_SLUGS[name]) continue;
    if (!byDistrict.has(name)) byDistrict.set(name, []);
    byDistrict.get(name).push(keyedDeal(deal, sameNames[CODE_OF.get(name)]));
  }

  const updatedAt = now.toISOString();
  const files = {};

  for (const name of [...byDistrict.keys()].sort((a, b) => a.localeCompare(b, "ko"))) {
    const { periods, deals } = collectDeals(byDistrict.get(name), maxMonths, valueOf);
    if (!deals.length) continue;

    files[DISTRICT_SLUGS[name]] = { district: name, updatedAt, periods, deals };
  }

  return files;
}

export const dealFileName = (slug) => `deals-${slug}.json`;

export const rentFileName = (slug) => `rents-${slug}.json`;

export function buildRentFiles(source, now, maxMonths = MAX_MONTHS, sameNames = {}) {
  return buildDealFiles(source, now, maxMonths, byDeposit, sameNames);
}
