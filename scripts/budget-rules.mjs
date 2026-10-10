// 예산대 18장에 똑같이 실리던 규칙 문단을 한 자리(method.html의 #budget-rules)에 굽는다(#66).
//
// 왜: 18장이 같은 규칙 문단(세율·대출 규제·정책대출 가격선·1억당 상환액)을 글자까지 똑같이 싣고 있었다.
// 애드센스 반려 사유가 이 반복이었고, 장마다 다른 것(그 예산대의 숫자·거래·단지)이 중심이어야 한다.
// 규칙의 글자는 바꾸지 않았다 - 각 모듈(purchase-costs·min-cash·policy-loan·loan-cap·mortgage)이
// 상수로 내보낸 원문을 그대로 놓고, 장은 숫자만 남기고 #budget-rules-* 로 링크한다.
// 기준일은 각 모듈의 BASIS_DATE라 규칙 문구와 확인일이 한 곳에서만 바뀐다.
import { escapeHtml } from "./prerender.mjs";
import { apartmentOptions, loanHeadSentence, rateSpread, yearChangeSentence } from "./mortgage.mjs";
import { COSTS_RULES } from "./purchase-costs.mjs";
import { MIN_CASH_RULES } from "./min-cash.mjs";
import { POLICY_LINES, POLICY_TAIL, policyShareSentence } from "./policy-loan.mjs";
import { CAP_RULES_HIGH } from "./loan-cap.mjs";

const para = (text) => `<p>${escapeHtml(text)}</p>`;

/**
 * method.html 한국어 블록의 <!--prerender:budgetRules--> 자리에 들어갈 HTML.
 * rates·mortgageSeries·policyCounts가 없으면 그 데이터에 기대는 문장만 빠진다(예산 장과 같은 규칙).
 */
export function budgetRulesHtml({ rates = null, mortgageSeries = null, policyCounts = null } = {}) {
  const head = loanHeadSentence(rateSpread(apartmentOptions(rates)));
  const year = yearChangeSentence(mortgageSeries);
  const share = policyShareSentence(policyCounts);
  return [
    `<p>예산대 장(3억대~20억대)에 똑같이 실리던 규칙 문단을 이 한 자리로 옮겼습니다. 각 장에는 그 예산대의 숫자만 남기고 이리로 링크합니다. 글자는 그대로입니다.</p>`,
    `<h3 id="budget-rules-loan">월 상환액: 1억당 값과 금리 근거</h3>`,
    head ? para(head) : "",
    year ? para(year) : "",
    `<h3 id="budget-rules-costs">매매가 위에 더 드는 돈: 중과·예외와 원문</h3>`,
    para(COSTS_RULES),
    `<h3 id="budget-rules-mincash">자기 돈이 적어도: 소득·기존 주택 예외와 원문</h3>`,
    para(MIN_CASH_RULES),
    `<h3 id="budget-rules-cap">16억대~20억대: 주택담보대출 상한 구간표</h3>`,
    para(`이 예산대 집의 주택담보대출 상한은 장마다 적힌 값입니다. ${CAP_RULES_HIGH}`),
    `<h3 id="budget-rules-policy">3억대~9억대: 정책대출 가격선 정의와 거래 수</h3>`,
    para(POLICY_LINES),
    share ? para(share) : "",
    para(POLICY_TAIL),
  ]
    .filter(Boolean)
    .join("\n    ");
}
