/**
 * 최소 필요 현금 - 이 예산대 집을 사려면 자기 돈이 적어도 얼마 있어야 하나.
 *
 * 이 사이트는 오래 "대출 한도는 가정하지 않는다"를 지켰다(DIRECTION 2부). 소득에 갈리는 DSR을 하나로
 * 정해 적으면 조용히 틀린 화면이 되기 때문이다. 그런데 서울 전역이 규제지역이 된 뒤(2025-10-16) LTV와
 * 가격 구간 상한은 소득과 무관하게 집값만으로 정해지는 천장이다. 그 천장으로는 "아무리 대출이 잘
 * 나와도 이만큼은 자기 돈"을 계산할 수 있다 - 실제로는 DSR 때문에 덜 빌려 더 필요할 수 있다고 같이 적는다
 * (2026-10-01 소유자 결정, #31).
 *
 * 기준일이 6개월 넘으면 점검 봇이 원문 재대조 이슈를 올린다(audit/HOWTO.md).
 */

import { capFor } from "./loan-cap.mjs";
import { purchaseCosts } from "./purchase-costs.mjs";

export const BASIS_DATE = "2026-10-01";

export const SOURCES = [
  { name: "주택시장 안정화 대책(10·15 대책) 규제지역 금융규제: 무주택 LTV 40%, 생애최초 70%(6개월 내 전입)", date: "2025-10-15", url: "https://www.korea.kr/briefing/policyBriefingView.do?newsId=156722073" },
  { name: "가계부채 관리 강화 방안: 수도권·규제지역 2주택 이상 보유자 추가 주택구입 주담대 금지, 1주택자는 6개월 이내 기존주택 처분 약정 시 허용", date: "2025-06-27", url: "https://www.fsc.go.kr/no010101/84824" },
  { name: "지방세특례제한법 제36조의3(생애최초 주택 구입 취득세 감면: 12억 이하, 아파트 200만원, 2028-12-31까지)", date: "2026-06-02", url: "https://www.law.go.kr/법령/지방세특례제한법" },
];

/**
 * 규제지역 주택구입 주담대 LTV(%). 유주택자는 이 문장의 대상이 아니다 - 원칙적으로 막히고, 1주택자가
 * 기존 집을 6개월 안에 팔기로 약정하면(처분조건부) 받을 수 있다. 그 경우의 한도는 계산하지 않고
 * 예외가 있다는 것과 출처만 적는다(#37, DIRECTION 1부: 개인 사정에 갈리는 판단은 하지 않는다).
 */
export const LTV = { general: 40, firstTime: 70 };

/** 생애최초 취득세 감면: 취득당시가액 12억 이하 아파트는 산출세액에서 200만원 공제(만원). */
export const FIRST_TIME_RELIEF = { upTo: 120_000, amount: 200 };

const EOK = 10_000;

/** 가격 하나(만원)의 최소 필요 현금. 대출 천장 = min(LTV×가격, 구간 상한). */
export function minCash(price10k, { firstTime = false } = {}) {
  const ltv = firstTime ? LTV.firstTime : LTV.general;
  const byLtv = (price10k * ltv) / 100;
  const cap = capFor(price10k);
  const loan = Math.min(byLtv, cap);
  const costs = purchaseCosts(price10k);
  const relief = firstTime && price10k <= FIRST_TIME_RELIEF.upTo ? Math.min(FIRST_TIME_RELIEF.amount, costs.acquisition) : 0;
  const extra = costs.total - relief;
  return { ltv, loan, cappedBy: byLtv > cap ? "cap" : "ltv", costs: extra, relief, cash: price10k - loan + extra };
}

const man = (v) => {
  const n = Math.round(v);
  const eok = Math.floor(n / EOK);
  const rest = n % EOK;
  if (!eok) return `${rest.toLocaleString("ko-KR")}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString("ko-KR")}만원` : `${eok}억원`;
};

/** 열여덟 장에 똑같이 실리던 규칙 문단(#66) - method.html 한 자리로 옮겼다. 글자는 그대로다. */
export const MIN_CASH_RULES =
  `실제로 빌릴 수 있는 돈은 소득(DSR)에 따라 이보다 적을 수 있어, 그만큼 더 필요할 수 있습니다. ` +
  `이미 집이 있으면 규제지역 주택구입 대출은 원칙적으로 막힙니다. 다만 1주택자가 지금 집을 6개월 안에 팔기로 약정하면(처분조건부) 받을 수 있어, 갈아타는 사람은 이 계산 대신 은행에 그 조건으로 물어야 합니다. ` +
  `(10·15 대책·가계부채 관리 강화 방안(2025-06-27)·지방세특례제한법 원문 기준, ${BASIS_DATE} 확인)`;

/** 예산대 한 문단(숫자만). 그 예산대 가운데 값으로 계산한다. 소득·기존 주택 예외와 원문은 MIN_CASH_RULES. */
export function minCashSentence(bandEok) {
  if (!Number.isFinite(bandEok)) return null;
  const price = (bandEok + 0.5) * EOK;
  const g = minCash(price);
  const f = minCash(price, { firstTime: true });
  const why = (x) => (x.cappedBy === "cap" ? `가격 구간 상한 ${man(x.loan)}` : `LTV ${x.ltv}%인 ${man(x.loan)}`);
  return (
    `${man(price)}짜리를 산다면, 대출이 아무리 잘 나와도 빌릴 수 있는 천장은 ${why(g)}이라 ` +
    `자기 돈이 적어도 ${man(g.cash)} 필요합니다(부대비용 ${man(g.costs)} 포함). ` +
    (f.loan > g.loan
      ? `생애최초 구입이면 천장이 ${why(f)}으로 올라 ${man(f.cash)}입니다` + (f.relief ? `(취득세 감면 ${man(f.relief)} 반영)` : "") + "."
      : f.relief
        ? `생애최초여도 이 가격대는 천장이 같고, 취득세 감면 ${man(f.relief)}만큼 줄어 ${man(f.cash)}입니다.`
        : "생애최초여도 이 가격대는 천장이 같아 차이가 없습니다.")
  );
}
