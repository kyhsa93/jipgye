import { REASON_NOTE, concentrationText } from "./realestate-concentration.ts";

const PYEONG_M2 = 3.3058;

/**
 * 월세 증감은 보증금과 월세를 이 전환율로 한 값(환산보증금 = 보증금 + 월세×12÷전환율)으로 묶어 ㎡당으로 잰다(#6).
 * 보증금 단순평균은 그 주에 신고된 방 크기와 보증금·월세 배합이 바뀌기만 해도 흔들렸다 — 4주 창을 이레씩 밀어
 * 자치구 1,200주를 다시 재 보니 이레 사이 10% 넘게 움직인 주가 보증금 단순평균 17.6%, 월세 단순평균 13.6%,
 * ㎡당 보증금 10.4%, ㎡당 월세 6.7%, ㎡당 환산값 4.3%였다(같은 방법으로 전세 ㎡당 0.8%; 2025-10~2026-08 계약분).
 * 전환율을 3%에서 10%까지 바꿔도 4.3~4.7%라 결론이 이 값에 달려 있지 않다. 값은 서울 실측(conversion.json,
 * 2026-10 기준 4.8%)에 맞췄고, 견주는 두 날이 같은 배수를 써야 하므로 날마다 따라가지 않고 고정한다.
 */
export const WOLSE_CONVERSION_RATE = 0.048;

/** 증감의 기준은 이레 전 값이다. 수집이 멈춰 그보다 훨씬 낡은 값밖에 없으면 '전주 대비'라 부를 수 없어 붙이지 않는다(findBaseline). */
export const BASELINE_MAX_DAYS = 14;
const NATIONAL_PYEONG_MIN_M2 = 82;
const NATIONAL_PYEONG_MAX_M2 = 86;

export function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function parseWon10k(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function filterByArea(items, minArea, maxArea) {
  return items.filter((item) => {
    const area = Number(item.excluUseAr);
    return Number.isFinite(area) && area >= minArea && area <= maxArea;
  });
}

function weightedAverage(list, getValue, getWeight) {
  let totalWeighted = 0;
  let totalWeight = 0;
  for (const item of list) {
    const v = getValue(item);
    const w = getWeight(item);
    if (v == null || !w) continue;
    totalWeighted += v * w;
    totalWeight += w;
  }
  return totalWeight ? totalWeighted / totalWeight : null;
}

export function isCancelledDeal(item) {
  const filled = (value) => String(value ?? "").trim().length > 0;
  return filled(item?.cdealType) || filled(item?.cdealDay);
}

export function dropCancelled(items) {
  return items.filter((item) => !isCancelledDeal(item));
}

export function dealingDirect(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text === "직거래";
}

function commonDealFields(item, districtName) {
  const area = Number(item?.excluUseAr);
  const apt = String(item?.aptNm ?? "").trim();
  const year = Number(item?.dealYear);
  const month = Number(item?.dealMonth);
  const day = Number(item?.dealDay);

  if (!apt) return null;
  if (!Number.isFinite(area) || area <= 0) return null;
  const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!inRange(year, 1900, 2999) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) return null;

  const floor = Number(item?.floor);
  const buildYear = Number(item?.buildYear);

  return {
    district: districtName,
    dong: String(item?.umdNm ?? "").trim(),
    apt,
    area: Math.round(area * 100) / 100,
    floor: Number.isFinite(floor) && floor > 0 ? floor : null,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    buildYear: Number.isInteger(buildYear) && buildYear > 1900 ? buildYear : null,
  };
}

export function normalizeDeal(item, districtName) {
  const amount10k = parseWon10k(item?.dealAmount);
  if (amount10k == null || amount10k <= 0) return null;

  const common = commonDealFields(item, districtName);
  if (!common) return null;

  const direct = dealingDirect(item?.dealingGbn);
  const { date, buildYear, ...rest } = common;

  return {
    ...rest,
    amount10k,
    date,
    buildYear,
    ...(direct === null ? {} : { direct }),
  };
}

export function contractRenewal(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text === "갱신";
}

export function normalizeRentDeal(item, districtName) {
  const deposit10k = parseWon10k(item?.deposit);
  if (deposit10k == null || deposit10k <= 0) return null;

  const common = commonDealFields(item, districtName);
  if (!common) return null;

  const monthlyRent10k = parseWon10k(item?.monthlyRent) ?? 0;
  const renewal = contractRenewal(item?.contractType);
  const { date, buildYear, ...rest } = common;

  return {
    ...rest,
    deposit10k,
    ...(monthlyRent10k > 0 ? { monthlyRent10k } : {}),
    date,
    buildYear,
    ...(renewal === null ? {} : { renewal }),
  };
}

// 대표값이 세는 행(해제 아님 + 금액·면적이 0 초과). 쏠림 판정의 표본이 이 값과 어긋나면 분모가 다른 비중이 되므로 판정을 여기 한 곳에 둔다(#862).
const hasSaleAmounts = (item) => {
  const amount10k = parseWon10k(item.dealAmount);
  const area = Number(item.excluUseAr);
  return amount10k != null && amount10k > 0 && Number.isFinite(area) && area > 0;
};
export const inSaleSample = (item) => !isCancelledDeal(item) && hasSaleAmounts(item);

function summarizeSale(items) {
  let totalAmountWon = 0;
  let totalArea = 0;
  let count = 0;

  for (const item of items) {
    if (!hasSaleAmounts(item)) continue;
    const amount10k = parseWon10k(item.dealAmount);
    const area = Number(item.excluUseAr);
    totalAmountWon += amount10k * 10_000;
    totalArea += area;
    count += 1;
  }

  if (count === 0 || totalArea === 0) return null;

  const avgPricePerM2 = totalAmountWon / totalArea;
  return {
    avgPricePerM2,
    avgPricePerPyeong10k: Math.round((avgPricePerM2 * PYEONG_M2) / 10_000),
    transactionCount: count,
  };
}

export function isRenewalContract(item) {
  return contractRenewal(item?.contractType) === true;
}

export function summarizeRent(items) {
  const jeonseRows = [];
  const wolseRows = [];
  let renewalCount = 0;

  for (const item of items) {
    if (isRenewalContract(item)) {
      renewalCount += 1;
      continue;
    }

    const deposit10k = parseWon10k(item.deposit);
    const monthlyRent10k = parseWon10k(item.monthlyRent);
    const area = Number(item.excluUseAr);
    if (deposit10k == null || deposit10k <= 0 || !Number.isFinite(area) || area <= 0) continue;

    if (monthlyRent10k && monthlyRent10k > 0) {
      wolseRows.push({ deposit10k, monthlyRent10k, area });
    } else {
      jeonseRows.push({ deposit10k, area });
    }
  }

  let jeonse = null;
  if (jeonseRows.length > 0) {
    const totalDepositWon = jeonseRows.reduce((sum, r) => sum + r.deposit10k * 10_000, 0);
    const totalArea = jeonseRows.reduce((sum, r) => sum + r.area, 0);
    const avgDepositPerM2 = totalDepositWon / totalArea;
    jeonse = {
      avgDepositPerM2,
      avgDepositPerPyeong10k: Math.round((avgDepositPerM2 * PYEONG_M2) / 10_000),
      transactionCount: jeonseRows.length,
    };
  }

  let wolse = null;
  if (wolseRows.length > 0) {
    const converted10k = wolseRows.reduce((sum, r) => sum + r.deposit10k + (r.monthlyRent10k * 12) / WOLSE_CONVERSION_RATE, 0);
    const totalArea = wolseRows.reduce((sum, r) => sum + r.area, 0);
    wolse = {
      avgConvertedPerPyeong10k: Math.round((converted10k / totalArea) * PYEONG_M2),
      avgDeposit10k: Math.round(wolseRows.reduce((sum, r) => sum + r.deposit10k, 0) / wolseRows.length),
      avgMonthlyRent10k: Math.round(wolseRows.reduce((sum, r) => sum + r.monthlyRent10k, 0) / wolseRows.length),
      transactionCount: wolseRows.length,
    };
  }

  return { jeonse, wolse, renewalCount };
}

export function summarizeSaleItems(all) {
  const items = dropCancelled(all);
  return {
    sale: summarizeSale(items),
    saleNational84: summarizeSale(filterByArea(items, NATIONAL_PYEONG_MIN_M2, NATIONAL_PYEONG_MAX_M2)),
    items,
    cancelledCount: all.length - items.length,
  };
}

export function computeOverall(districts) {
  const saleDistricts = districts.filter((d) => d.sale);
  const overallSaleAvgM2 = weightedAverage(saleDistricts, (d) => d.sale.avgPricePerM2, (d) => d.sale.transactionCount);
  const overallSale =
    overallSaleAvgM2 == null
      ? null
      : {
          avgPricePerM2: overallSaleAvgM2,
          avgPricePerPyeong10k: Math.round((overallSaleAvgM2 * PYEONG_M2) / 10_000),
          transactionCount: saleDistricts.reduce((sum, d) => sum + d.sale.transactionCount, 0),
        };

  const saleNational84Districts = districts.filter((d) => d.saleNational84);
  const overallSaleNational84AvgM2 = weightedAverage(
    saleNational84Districts,
    (d) => d.saleNational84.avgPricePerM2,
    (d) => d.saleNational84.transactionCount
  );
  const overallSaleNational84 =
    overallSaleNational84AvgM2 == null
      ? null
      : {
          avgPricePerM2: overallSaleNational84AvgM2,
          avgPricePerPyeong10k: Math.round((overallSaleNational84AvgM2 * PYEONG_M2) / 10_000),
          transactionCount: saleNational84Districts.reduce((sum, d) => sum + d.saleNational84.transactionCount, 0),
        };

  const jeonseDistricts = districts.filter((d) => d.jeonse);
  const overallJeonseAvgM2 = weightedAverage(
    jeonseDistricts,
    (d) => d.jeonse.avgDepositPerM2,
    (d) => d.jeonse.transactionCount
  );
  const overallJeonse =
    overallJeonseAvgM2 == null
      ? null
      : {
          avgDepositPerM2: overallJeonseAvgM2,
          avgDepositPerPyeong10k: Math.round((overallJeonseAvgM2 * PYEONG_M2) / 10_000),
          transactionCount: jeonseDistricts.reduce((sum, d) => sum + d.jeonse.transactionCount, 0),
        };

  const wolseDistricts = districts.filter((d) => d.wolse);
  const overallWolse =
    wolseDistricts.length === 0
      ? null
      : {
          ...(wolseDistricts.every((d) => d.wolse.avgConvertedPerPyeong10k != null)
            ? {
                avgConvertedPerPyeong10k: Math.round(
                  weightedAverage(wolseDistricts, (d) => d.wolse.avgConvertedPerPyeong10k, (d) => d.wolse.transactionCount)
                ),
              }
            : {}),
          avgDeposit10k: Math.round(
            weightedAverage(wolseDistricts, (d) => d.wolse.avgDeposit10k, (d) => d.wolse.transactionCount)
          ),
          avgMonthlyRent10k: Math.round(
            weightedAverage(wolseDistricts, (d) => d.wolse.avgMonthlyRent10k, (d) => d.wolse.transactionCount)
          ),
          transactionCount: wolseDistricts.reduce((sum, d) => sum + d.wolse.transactionCount, 0),
        };

  return { sale: overallSale, saleNational84: overallSaleNational84, jeonse: overallJeonse, wolse: overallWolse };
}

// 7일 증감의 기준 기록 고르기. 지금 빌드는 어느 날에도 증감을 싣지 않아 이 함수를 부르지 않는다(#862 3단계, attachChanges).
// research/arrival-change-2026-11 재현 스크립트(overall2·district7)가 이 규칙으로 기준을 고르고, 계약 대 계약 증감을 다시 재는 새 이슈(pm 11-15)도 쓸 것이라 남긴다.
export function findBaseline(history, now) {
  const target = new Date(now);
  target.setDate(target.getDate() - 7);
  const targetDate = kstDateString(target);

  const older = history.filter((h) => h.date <= targetDate);
  if (!older.length) return null;

  const baseline = older[older.length - 1];
  if (baseline.date === kstDateString(now)) return null;
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - BASELINE_MAX_DAYS);
  return baseline.date < kstDateString(oldest) ? null : baseline;
}

// 증감 필드를 걷는다. 지난번 값으로 채운 구(carryForward)는 옛 증감·보류를 들고 오므로 걷어야 한다.
const withoutChange = (metric) => {
  if (!metric) return metric;
  const { change: _c, baselineDate: _d, changeWithheld: _w, ...rest } = metric;
  return rest;
};

// 쏠림이 걸린 매매 칸: 증감이 없는 자리라 「증감 보류」 없이 단서(건수·뺀 값)만 남긴다(REASON_NOTE). 문턱은 서울·구 같은 isConcentrated 다(빌드가 판정해 `concentration` 을 붙인다).
// 단서 문구(concentrationClause)는 계약 기준 날에도 재도장을 말하지 않는다 - 그날 같은 행은 실제 그 창의 계약이다.
const noted = (sale, window, jeonse) =>
  sale?.concentration ? { ...sale, changeWithheld: { reason: REASON_NOTE, text: concentrationText(sale, window, jeonse) } } : sale;

/**
 * 서울·자치구 어느 값에도 7일 증감을 싣지 않는다 - 신고 기준 날(#862 2단계)도, 계약 기준으로 물러난 날(#862 3단계, pm 11-15)도 같다.
 * 자리에는 기간과 건수만 남고, 건수 문턱 보류(#290) 문구도 낼 증감이 없어 함께 사라진다.
 * 신고 기준 규칙: 잰 날들의 |Δ| 중앙값이 행 재추출 90% 구간 반폭 중앙값보다 커야 싣는다. 서울(2026-08-25~11-15 신고 기준 40일)은 매매 2.49% 대 ±5.62%, 전세 1.84% 대 ±3.62%,
 * 월세 2.76% 대 ±4.22% 였다(data-analyst 11-15 - 11-04 값을 본 뒤 정한 규칙이라 사전 등록이 아니다, pm 11-15 판정). 자치구(같은 기간 44일, 구-일 1,008~1,070개, 짝 재추출)는
 * 매매 1.55% 대 ±3.65%, 전세 1.49% 대 ±2.89%, 월세 1.64% 대 ±3.29% 였다(재기 전에 등록한 규칙, data-analyst 11-17). 여섯 값 모두 못 넘었다. 재현은 research/arrival-change-2026-11.
 * 계약 기준 날: 2026-08-18~11-15 기록 60일 중 6일이고, 서울 매매 증감이 실린 4일 중 3일은 정의가 다른 기록(기간 정보 없는 옛 정의·신고 기준)과 견준 것이었다.
 * 계약 기준끼리 견준 날은 10-26 하루뿐이라 같은 규칙으로 잴 표본이 없다(pm 11-15 판정, #862 issuecomment-6890869728).
 * 84㎡ 부근(saleNational84)은 화면에 실리지 않지만 공개 JSON 이 같은 뜻이 되게 같이 걷는다.
 */
export function attachChanges(overall, districts, window = null) {
  const strip = (entry) => ({
    ...entry,
    sale: noted(withoutChange(entry.sale), window, entry.jeonse),
    saleNational84: withoutChange(entry.saleNational84),
    jeonse: withoutChange(entry.jeonse),
    wolse: withoutChange(entry.wolse),
  });
  return { overall: strip(overall), districts: districts.map(strip) };
}

export function carryForward(allDistricts, fetched, existing, existingIsToday) {
  const fetchedByCode = new Map((fetched ?? []).map((d) => [d.code, d]));
  const existingByCode = new Map<string, any>((existing?.districts ?? []).map((d) => [d.code, d]));

  const districts = [];
  const carriedNames = [];

  for (const { code, name } of allDistricts) {
    const fresh = fetchedByCode.get(code);
    if (fresh) {
      districts.push(fresh);
      continue;
    }

    const old = existingByCode.get(code);
    if (!old) continue;

    if (existingIsToday) {
      districts.push(old);
      continue;
    }

    districts.push({ ...old, staleAt: old.staleAt ?? existing.updatedAt });
    carriedNames.push(name);
  }

  return { districts, carriedNames };
}

export function fetchSummary(districts) {
  const countOf = (key) => (districts ?? []).filter((d) => d?.[key]).length;
  return `매매 ${countOf("sale")}개구, 전세 ${countOf("jeonse")}개구, 월세 ${countOf("wolse")}개구`;
}
