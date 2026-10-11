// 예산대 장 조각의 모양과 값 글자 (#243 PR A, 잎 조각 여덟 개: budgetAnswersHtml·budgetMoreHtml·budgetMinCashHtml·budgetPolicyHtml·
// budgetCapHtml·budgetCostsHtml·budgetFactsHtml·budgetLoanHtml). 순수 모듈 - prerender.mjs(legacy)와 render/entry.jsx(JSX)가 같은 규칙을 쓴다.
//
// 이 모듈은 HTML을 만들지 않는다: 어느 문단이 나오는지·어떤 줄이 있는지·글자가 무엇인지만 정하고, 클래스·태그·`data-prerendered`·이스케이프는
// 쓰는 쪽(legacy 문자열·JSX 요소)이 각자 입힌다. 모듈이 마크업을 들고 있으면 한 곳의 오타를 같은 실행 비교가 못 잡는다(#255~#257·#242 PR 3과 같은 방식).
// 표본 문턱·해자 `low-sample` 분기는 없다 - 이 조각들은 값을 못 낸 자리를 비우거나 줄을 빼기만 하고, "같은 평형 6개월 3번 이상" 문턱은
// 빌더가 만든 데이터 칸(`cell.n`)에 이미 반영돼 있다(후보 단지는 PR B). 정책대출 건수가 없으면 문장 자체가 빠진다(policySentence).
// 렌더러·prerender.mjs를 부르지 않는다(로더가 막는다).
import { BASIS_DATE as CAP_DATE, capSentence } from "./loan-cap.mjs";
import { BASIS_DATE as MIN_CASH_DATE, minCash, minCashSentence } from "./min-cash.mjs";
import { apartmentOptions, loanSentence, monthlyPayment, rateSpread } from "./mortgage.mjs";
import { BASIS_DATE as POLICY_DATE_BASIS, policySentence, policyShort } from "./policy-loan.mjs";
import { BASIS_DATE as COSTS_DATE, costsSentence, purchaseCosts } from "./purchase-costs.mjs";

/** 예산대 이름("5억대"·"3억 미만"·"20억 이상"). 두 억 단위는 반올림이다. prerender.mjs가 같은 이름으로 다시 내보낸다. */
export const budgetBandLabel = (band) => {
  const from = Math.round(band.min10k / 10_000);
  const to = band.max10k === null ? null : Math.round(band.max10k / 10_000);
  if (to === null) return `${from}억 이상`;
  if (from === 0) return `${to}억 미만`;
  return `${from}억대`;
};

/** 만원 → "N억 M만원"·"N억원"·"M만원". 반올림은 Math.round. */
export const eokText = (value10k) => {
  const n = Math.round(value10k);
  const eok = Math.floor(n / 10_000);
  const man = n % 10_000;
  if (!eok) return `${man.toLocaleString("ko-KR")}만원`;
  return man ? `${eok}억 ${man.toLocaleString("ko-KR")}만원` : `${eok}억원`;
};

/**
 * 예산대 하한(억). 유한한 숫자가 아니면(없음·문자열·NaN·Infinity) null이고, 조각은 문단을 내지 않는다.
 * 문자열 "50000"도 null이다 - Number.isFinite는 엄격하다(legacy 그대로).
 */
export const eokOf = (band) => (Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null);

/** 장마다 똑같던 규칙 문단이 옮겨 간 자리(method.html의 #budget-rules-*)로 가는 주소(#66). id는 코드가 정한 상수 다섯(mincash·policy·cap·costs·loan)이다. */
export const budgetRuleHref = (id) => `./method.html#budget-rules-${id}`;

// 문단 하나 = 문장 + 규칙 링크 { id, text }(링크가 없는 문단은 null). 문장이 비면 문단이 없다(null).
const note = (sentence, link) => (sentence ? { sentence, link } : null);

/** 최소 필요 현금 문단(scripts/min-cash.mjs). */
export function minCashNote(band) {
  const sentence = minCashSentence(eokOf(band));
  return note(sentence, { id: "mincash", text: `소득·기존 주택 예외와 원문(${MIN_CASH_DATE} 확인) →` });
}

/** 정책대출 가격선 문단(scripts/policy-loan.mjs, 4~9억대에만). 건수가 없으면 문장이 없다. */
export function policyNote(band, policyCounts) {
  const sentence = policySentence(eokOf(band), policyCounts);
  return note(sentence, { id: "policy", text: `가격선 정의와 거래 수(${POLICY_DATE_BASIS} 확인) →` });
}

/** 15억 경계에 걸친 예산대의 주담대 상한 문단(scripts/loan-cap.mjs). 16~24억대는 구간표·소득 단서가 method.html로 갔으므로 링크가 붙는다. */
export function capNote(band, capStats) {
  const eok = eokOf(band);
  const sentence = capSentence(eok, capStats);
  // 16억대 이상은 구간표·소득 단서가 method.html로 갔다. 14·15억대 문장은 그대로 장에 있다.
  const moved = Number.isFinite(eok) && eok >= 16 && eok <= 24;
  return note(sentence, moved ? { id: "cap", text: `구간표와 원문(${CAP_DATE} 확인) →` } : null);
}

/** "매매가 말고 드는 돈" 문단(scripts/purchase-costs.mjs). */
export function costsNote(band) {
  const sentence = costsSentence(eokOf(band));
  return note(sentence, { id: "costs", text: `중과·예외와 원문(${COSTS_DATE} 확인) →` });
}

/**
 * "그래서 매달 얼마" 문단(scripts/mortgage.mjs). 금리가 없으면(아파트 분할상환 상품이 없으면) 문장이 없다.
 * 문장은 legacy가 이스케이프 없이 끼우던 자리다 - 글자는 전부 숫자 서식과 코드 상수(mortgage.mjs)라 `& < > "`가 들 수 없다(PR 본문의 raw 보간 전수표).
 * mortgageSeries(조각의 셋째 인자)는 호출부 호환으로만 남아 있다(1년 사이 변화 문장은 method.html로 갔다, #66) - 읽지 않는다.
 */
export function loanNote(band, rates) {
  const spread = rateSpread(apartmentOptions(rates));
  const sentence = loanSentence(spread, { eok: eokOf(band) });
  return note(sentence, { id: "loan", text: "1억당 값과 금리 근거 →" });
}

/**
 * 예산대 장 맨 위 "한눈에" - 아래 문단 넷의 답만 한 줄씩(UIUX #43). 숫자는 문단과 같은 함수에서 나온다(min-cash·purchase-costs·mortgage·policy-loan).
 * 예산대가 없으면(eokOf가 null) null이다. 줄은 { label, value, note, text }: note가 ""이면 부가 글자 없음, text가 참이면 글자 값(정책대출 가격선)이다.
 * 금리가 없으면 "1억을 빌리면 매달" 줄이 빠진다.
 */
export function budgetAnswers(band, rates = null) {
  const eok = eokOf(band);
  if (eok === null) return null;
  const price = (eok + 0.5) * 10_000;
  const g = minCash(price);
  const f = minCash(price, { firstTime: true });
  const costs = purchaseCosts(price);
  const spread = rateSpread(apartmentOptions(rates));
  const perEok = spread ? monthlyPayment(10_000, spread.mid) : null;
  const policy = policyShort(eok);
  const line = (label, value, extra, text = false) => ({ label, value, note: extra, text });
  const lines = [
    line("자기 돈이 적어도", eokText(g.cash), f.cash < g.cash ? `생애최초면 ${eokText(f.cash)}` : ""),
    perEok ? line("1억을 빌리면 매달", eokText(Math.round(perEok)), `30년 원리금균등, 연 ${spread.mid}%`) : null,
    line("매매가 위에 더 드는 돈", eokText(costs.total), "취득세·지방교육세·중개보수 상한"),
    policy ? line("정책대출 가격선", policy, "", true) : null,
  ].filter(Boolean);
  return { heading: `${eokText(price)}짜리를 산다면 — 한눈에`, lines };
}

/** 예산을 정한 사람이 다음에 묻는 것들로 가는 길(PO 검토 #33 - 예산대에서 이 화면들로 가는 링크가 0개였다). 주소는 코드가 정한 상대 경로뿐이다. */
export const BUDGET_MORE_LINKS = Object.freeze([
  Object.freeze(["./floor-gap.html", "1층·최상층은 얼마나 싸야 정상인가"]),
  Object.freeze(["./record-high.html", "신고가가 나왔다는데 그 값인가"]),
  Object.freeze(["./switch-house.html", "갈아타기 — 갈 동네는 얼마나 올랐나"]),
  Object.freeze(["./price-outlook.html", "3개월 뒤 아파트값과 그 오차"]),
  Object.freeze(["./cancelled-deals.html#month-section", "계약에서 등기(잔금)까지 걸리는 날"]),
]);
