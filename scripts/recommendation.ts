/**
 * 예산으로 보는 서울 아파트 근거표의 값 규칙 (#816 P1-1). 빌더가 쓰고(build-recommendation.ts), 브라우저는 구워진 파일만 받아 거른다.
 *
 * 이 표에는 점수도 순위도 없다. 칸마다 값·표본·비용 사실만 싣고, 어느 칸이 낫다는 값은 어디에도 없다. 세 유형은 전부 꺼져 있고 꺼진 값은 0 이 아니라 null 이다.
 * 사용자 입력(예산·면적·구)은 화면에서 거르기만 하고, 자기자금·대출액은 이 파일들에 들어오지 않는다.
 */

import { MIN_DEALS } from "./complex-price.ts";
import { minCash } from "./min-cash.ts";
import { purchaseCosts } from "./purchase-costs.ts";

export const SCHEMA_VERSION = 1;
export const ALGORITHM_VERSION = "reco-0";

/**
 * 파일 한도(gzip level 9). 시장 상황에 걸리는 값이면 안 되므로 뜨거운 창(2025-08-02 기준)에도 안 터지게 잡았다(값과 재현은 #816 cto 검토).
 * 구당은 complex-history 전례. 넘으면 25개 전부 어제 판을 둔다(build-recommendation.ts).
 */
export const LIMITS = { fileGzip: 40_960, totalGzip: 500_000, files: 25 };

/**
 * 표본 등급. 문턱은 research/sample-grade-2026-11/PREREG.md 2절 그대로이고 그 문서의 새 버전으로만 바꾼다. 경계값 n=5, 90일은 충분이다.
 * 값의 표본 이야기이지 점수의 신뢰도가 아니다.
 */
export const GRADE = { minDeals: MIN_DEALS, enoughDeals: 5, recentDays: 90 };

/** n<3 은 값을 내지 않고 뺀 곳으로 센다(null). age 는 기준일에서 그 칸 마지막 계약일까지의 날 수. */
export function gradeOf({ n, age }) {
  if (n < GRADE.minDeals) return null;
  return n >= GRADE.enoughDeals && age <= GRADE.recentDays ? "enough" : "partial";
}

/**
 * 유형 상태. 코드만 싣고 문장은 화면이 두 언어로 받는다. 켜는 일은 이 파일의 범위가 아니다 - 실거주는 PREREG 6절 조건을 모두 넘고 소유자가 확인해야 하고, 미래가치·균형은 내지 않는다.
 * K-apt·서울 값은 쓰지 않는다(#823 미달, #847 대조 전). 세대수(households)도 #24 전까지 null 이다.
 */
export const TYPES = Object.freeze({
  living: { status: "off", reasons: ["no_transit", "no_households"] },
  future: { status: "off", reasons: ["failed_prereg", "one_regime_only"] },
  balanced: { status: "off", reasons: ["needs_both"] },
});

/** 면적대. 칸 이름(거래가 가장 많은 면적)으로 가른다. */
export function areaBand(area) {
  if (area < 60) return "under-60";
  return area <= 85 ? "60-85" : "over-85";
}

/** 값대. 값 ∈ [N억, N+1억) 이면 N. */
export const priceBand = (value10k) => Math.floor(value10k / 10_000);

/**
 * 파일이 배열로 싣는 필드의 이름. 칸마다 키를 되풀이하면 뜨거운 창에서 합 한도에 닿아(#816 PR 본문의 측정) 배열로 싣고, 위치가 코드에만 있지 않게 파일 머리에 이 목록을 같이 싣는다.
 * reasons·risks 는 [코드, 측정값] 쌍의 목록이다(recommendation-reasons.ts).
 */
export const APARTMENT_FIELDS = ["id", "name", "dong", "buildYear", "households", "aliases", "cells"];
export const CELL_FIELDS = [
  "areaSqm", "n", "median", "low", "high", "rawMedian", "unadjustedDeals",
  "extraCost", "totalCost", "loanCapGeneral", "loanCapFirstTime", "cashGeneral", "cashFirstTime",
  "lastAmount", "lastDate", "lastFloor", "deals12m", "jeonseN",
  "confidence", "scores", "reasons", "risks",
];
export const apartmentField = (name) => APARTMENT_FIELDS.indexOf(name);
export const cellField = (name) => CELL_FIELDS.indexOf(name);

const won = (value) => Math.round(value);

/**
 * 집이 없던 사람이 한 채를 살 때의 비용·제도 상한 추정·이 가정에서 필요한 현금(모두 만원). 비용은 빌드가 굽고 브라우저는 비교만 한다.
 * minCash 는 면적을 받지 않아 85㎡ 초과의 농어촌특별세를 모른다 - 상한과 감면만 받아 현금은 면적을 아는 비용으로 다시 계산한다.
 */
export function costFields(median, area) {
  const extra = won(purchaseCosts(median, { over85: area > 85 }).total);
  const general = minCash(median);
  const firstTime = minCash(median, { firstTime: true });
  const total = median + extra;
  return {
    extra,
    total,
    loanGeneral: won(general.loan),
    loanFirstTime: won(firstTime.loan),
    cashGeneral: won(total - general.loan),
    cashFirstTime: won(total - firstTime.loan - firstTime.relief),
  };
}
