export const BUDGET_PAGE_EOK = Array.from({ length: 18 }, (_, i) => i + 3);

export const budgetPageFile = (eok) => `budget-${eok}eok.html`;

export const BUDGET_PAGES = BUDGET_PAGE_EOK.map((eok) => ({
  eok,
  min10k: eok * 10_000,
  file: budgetPageFile(eok),
  title: `${eok}억대로 살 수 있는 서울 아파트 - 최근 실거래`,
  description:
    `예산 ${eok}억대(${eok}억~${eok + 1}억)로 서울에서 실제 거래된 아파트를 모았습니다.` +
    " 국토교통부에 신고된 실거래 자료이며, 단지·전용면적·층·거래일과 거래가 많은 지역을 함께 보여줍니다.",
  titleEn: `Seoul Apartments Around \u20a9${(eok / 10).toFixed(1)}B - Recent Deals`,
}));

/**
 * 머리 도장의 금리 칸(#411 확장): 「금리(8월분) 10-26 갱신」 - 갱신일과 값의 기준월을 따로 적어 「10-26 금리」로 읽히지 않게.
 * month 는 장에 구운 금리 칩의 data-rate-month(YYYYMM, 한눈에 금리 줄과 같은 latestRate 값)다. 못 읽으면 달 없이 「금리 10-26 갱신」.
 */
export function rateStampText(ratesYmd, month = null) {
  const m = /^\d{6}$/.test(String(month ?? "")) ? Number(String(month).slice(4)) : 0;
  return `금리${m >= 1 && m <= 12 ? `(${m}월분)` : ""} ${String(ratesYmd).slice(5)} 갱신`;
}

/**
 * 장의 meta description(V12 #658) - 그 예산대의 답(단지 후보가 많은 구·후보 수·거래 수)을 앞에 둔다. 구 순서는 후보 수라 「단지·평형은 … 가장 많습니다」로 적는다(거래 수 순서인 본문 지역 줄·자치구 링크와 다른 축). 장 본문과 같은 값(band.count·candidatesInBand·areasShape)이다.
 * 거래나 후보 구가 없으면 위의 고정 문장(page.description)을 그대로 쓴다.
 */
export function budgetDescription(page, { deals = 0, candidates = 0, places = [] } = {}) {
  if (!deals || !candidates || !places.length) return page.description;
  return (
    `${page.eok}억대(${page.eok}억~${page.eok + 1}억)로 살 수 있는 단지·평형은 ${places.join("·")}에 가장 많습니다. ` +
    `중간값이 이 범위인 단지·평형 ${candidates.toLocaleString("ko-KR")}곳과 최근 신고된 매매 ${deals.toLocaleString("ko-KR")}건을 국토교통부 실거래로 모으고, 자기 돈·대출·취득세를 함께 셉니다.`
  );
}
