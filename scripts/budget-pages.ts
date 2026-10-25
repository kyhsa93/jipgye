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
 * \uc7a5\uc758 meta description(V12 #658) - \uadf8 \uc608\uc0b0\ub300\uc758 \ub2f5(\ud6c4\ubcf4\uac00 \ub9ce\uc740 \uad6c\u00b7\ud6c4\ubcf4 \uc218\u00b7\uac70\ub798 \uc218)\uc744 \uc55e\uc5d0 \ub454\ub2e4. \uc7a5 \ubcf8\ubb38\uacfc \uac19\uc740 \uac12(band.count\u00b7candidatesInBand\u00b7areasShape)\uc774\ub2e4.
 * \uac70\ub798\ub098 \ud6c4\ubcf4 \uad6c\uac00 \uc5c6\uc73c\uba74 \uc704\uc758 \uace0\uc815 \ubb38\uc7a5(page.description)\uc744 \uadf8\ub300\ub85c \uc4f4\ub2e4.
 */
export function budgetDescription(page, { deals = 0, candidates = 0, places = [] } = {}) {
  if (!deals || !candidates || !places.length) return page.description;
  return (
    `${page.eok}\uc5b5\ub300(${page.eok}\uc5b5~${page.eok + 1}\uc5b5)\ub85c \uc0b4 \uc218 \uc788\ub294 \uc11c\uc6b8 \uc544\ud30c\ud2b8\ub294 ${places.join("\u00b7")}\uc5d0 \ub9ce\uc2b5\ub2c8\ub2e4. ` +
    `\uc911\uc559\uac12\uc774 \uc774 \ubc94\uc704\uc778 \ub2e8\uc9c0\u00b7\ud3c9\ud615 ${candidates.toLocaleString("ko-KR")}\uacf3\uacfc \ucd5c\uadfc \uc2e0\uace0\ub41c \ub9e4\ub9e4 ${deals.toLocaleString("ko-KR")}\uac74\uc744 \uad6d\ud1a0\uad50\ud1b5\ubd80 \uc2e4\uac70\ub798\ub85c \ubaa8\uc73c\uace0, \uc790\uae30 \ub3c8\u00b7\ub300\ucd9c\u00b7\ucde8\ub4dd\uc138\ub97c \ud568\uaed8 \uc149\ub2c8\ub2e4.`
  );
}
