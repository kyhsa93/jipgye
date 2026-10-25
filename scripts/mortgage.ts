import { capFor } from "./loan-cap.ts";
/**
 * 예산을 월 상환액으로 옮긴다.
 *
 * 예산대 화면은 "10억대면 어디까지"에는 답했지만 "그래서 매달 얼마"에는 답하지 않았다.
 * 그 답을 내려면 실거래와 대출 금리가 같이 있어야 하는데, 이 저장소는 둘 다 매일 받는다.
 * 부동산계산기 류가 금리를 사용자에게 직접 입력하라고 하는 자리가 정확히 여기다.
 *
 * <strong>소득에 갈리는 대출 한도는 가정하지 않는다.</strong> DSR은 소득에 따라 갈리고
 * 해마다 바뀌는데, 그것을 하나로 정해 적으면 이 화면은 매년 조용히 틀린 숫자를 자신 있게
 * 적는 화면이 된다. 그래서 <strong>1억당 매달 얼마</strong>로 낸다 - 얼마를 빌릴지는
 * 읽는 사람이 알고, 그 사람이 곱하면 된다.
 */

/** 금액은 이 저장소 어디서나 만원 단위다. */
export const MAN_PER_EOK = 10_000;

/** 원리금균등 30년. 주택담보대출에서 가장 흔한 조건이고, 화면에 그렇게 적는다. */
export const YEARS = 30;

/**
 * 월 상환액에 쓰는 금리: 한국은행 ECOS 예금은행 주택담보대출 신규취급 평균금리(121Y006 BECBLA0302)의 가장 최근 달.
 *
 * 전에는 금융감독원 공시 상품의 최저금리 중앙값이었다. FSS 자료는 수익 사이트에서 쓰려면 사전 협의가 필요해
 * 빼기로 했고(#577, 소유자 결정 2026-10-25), 지표 수집(fetch-indicators)이 이미 매일 받는 이 계열로 바꿨다.
 * 은행이 그 달 실제로 내준 대출의 평균이라 상품별 폭(최저~최고)은 없다 - 그래서 문장도 범위 대신 "평균"이라고만 적는다.
 * 비거나 0 이하인 달은 건너뛴다 - "값 없음"을 0%로 만들지 않는다(#269, 기준금리 0.00% 사건과 같은 이유).
 * 돌려주는 것은 { rate, month }(month는 "YYYYMM")이고, 쓸 달이 없으면 null이다.
 */
export function latestRate(mortgageSeries) {
  if (!Array.isArray(mortgageSeries)) return null;
  const rows = mortgageSeries.filter(
    (row) =>
      Array.isArray(row) &&
      /^\d{6}$/.test(String(row[0])) &&
      (typeof row[1] === "number" || (typeof row[1] === "string" && row[1].trim() !== "")) &&
      Number.isFinite(Number(row[1])) &&
      Number(row[1]) > 0
  );
  if (!rows.length) return null;
  const [month, rate] = rows.at(-1);
  return { rate: Number(rate), month: String(month) };
}

const monthLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(4, 6))}월`;

/** 문장에 적는 금리 근거. 달을 모르면(직접 넘긴 값) 달 없이 적는다. */
const basisLabel = (basis) =>
  `한국은행 ECOS 주택담보대출 신규취급 평균금리${/^\d{6}$/.test(String(basis?.month ?? "")) ? ` ${monthLabel(String(basis.month))}` : ""} 연 ${basis.rate}%`;

/** 금리 근거가 쓸 수 있는 값인가. 숫자가 아니면(없음·문자열·NaN) 문장을 만들지 않는다. */
const usable = (basis) => typeof basis?.rate === "number" && Number.isFinite(basis.rate);

/**
 * 원리금균등 월 상환액. 원금과 결과 모두 만원 단위다.
 *
 * 금리가 0이면 나눗셈이 무너지므로 따로 본다. 실무에서 0%는 없지만, 값이 비어 온 날
 * Number("")가 0이 되어 흘러드는 것을 이 저장소는 이미 겪었다(기준금리 0.00% 사건).
 */
export function monthlyPayment(principal, annualPercent, years = YEARS) {
  const months = Math.round(years * 12);
  if (!(principal > 0) || !Number.isFinite(annualPercent) || months <= 0) return null;
  if (annualPercent <= 0) return principal / months;

  const rate = annualPercent / 100 / 12;
  const growth = (1 + rate) ** months;
  return (principal * rate * growth) / (growth - 1);
}

const man = (value) => `${Math.round(value).toLocaleString("ko-KR")}만원`;

/**
 * 1억당 매달 얼마(method.html #budget-rules-loan). basis는 latestRate의 { rate, month }다.
 *
 * 평균금리는 사람마다 받는 금리가 아니다 - 그래서 "평균"이라고 적고, 신용·우대조건에 따라 갈린다는 단서를 같은 문단에 둔다.
 * 전의 상품 최저금리 범위(최저~최고)는 평균 계열에 없는 값이라 지웠다(#577).
 */
export function loanHeadSentence(basis, years = YEARS) {
  if (!usable(basis)) return null;

  const perEok = monthlyPayment(MAN_PER_EOK, basis.rate, years);
  if (!perEok) return null;

  return (
    `1억을 ${years}년 원리금균등으로 빌리면 매달 ${man(perEok)}입니다. ` +
    `${basisLabel(basis)} 기준입니다. ` +
    `시장 평균 금리라, 개인이 받는 금리는 신용·우대조건에 따라 이와 다릅니다.`
  );
}

/**
 * 예산대 한 문단(그 예산에서 절반을 빌리는 경우만). 1억당 값·금리 근거(loanHeadSentence)와 1년 사이 변화
 * (yearChangeSentence)는 열여덟 장에서 똑같은 값이라 method.html 한 자리로 옮겼다(#66). 1억당 값은 장 맨 위
 * "한눈에"에도 있다. "한도는 가정하지 않는다"는 단서(소득·DSR)는 이 화면의 원칙이라 장에 남긴다.
 */
export function loanSentence(basis, { eok, years = YEARS }: { eok?: number; years?: number } = {}) {
  const head = loanHeadSentence(basis, years);
  if (!head || !Number.isFinite(eok)) return head;

  // 예시 대출액은 예산의 절반이되, 그 예산대 집값의 주담대 구간 상한(소득과 무관한 천장)을 넘지 않는다.
  // 16억 장에 "8억을 빌린다면"을 적던 때가 있었다 - 16억대 상한은 4억이다(#29).
  const halfMan = (eok * MAN_PER_EOK) / 2;
  const cap = capFor((eok + 0.5) * MAN_PER_EOK);
  const capped = halfMan > cap;
  const borrow = capped ? cap : halfMan;
  const pay = monthlyPayment(borrow, basis.rate, years);
  if (!pay) return head;
  const amount = `${(borrow / MAN_PER_EOK).toLocaleString("ko-KR")}억`;

  return (
    (capped
      ? `이 예산의 절반(${(eok / 2).toLocaleString("ko-KR")}억)은 이 가격대 주담대 상한 ${amount}을 넘어, 상한인 ${amount}을 빌린다면 매달 ${man(pay)}입니다`
      : `이 예산에서 절반인 ${amount}을 빌린다면 매달 ${man(pay)}입니다`) +
    ` — 실제로 얼마를 빌릴 수 있는지는 소득(DSR)에 따라 갈리므로 여기서는 정하지 않고, 1억당 값을 곱하시면 됩니다.`
  );
}

/**
 * 1년 사이 같은 1억의 매달 상환액이 얼마나 바뀌었나. "지금 사야 하나"는 이 사이트가 답하지 않지만,
 * "1년 전보다 매달 얼마 더 드나"는 숫자로 답할 수 있다.
 *
 * 금리는 위 문단과 같은 자(ECOS 121Y006 예금은행 주택담보대출 신규취급 평균금리)다. 전에는 위 문단이 금감원 공시
 * 상품 최저금리라 "다른 자"라는 단서를 붙였는데, 위 문단도 이 계열로 바뀌어(#577) 그 단서를 지웠다.
 */
export function yearChangeSentence(mortgageSeries, years = YEARS) {
  const rows = (mortgageSeries ?? []).filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0);
  if (!rows.length) return null;
  const [lastMonth, lastRate] = rows.at(-1);
  const prevMonth = `${Number(lastMonth.slice(0, 4)) - 1}${lastMonth.slice(4, 6)}`;
  const prev = rows.find(([m]) => m === prevMonth);
  if (!prev) return null;
  const now = monthlyPayment(MAN_PER_EOK, Number(lastRate), years);
  const then = monthlyPayment(MAN_PER_EOK, Number(prev[1]), years);
  if (!now || !then) return null;
  const diff = Math.round(now) - Math.round(then);
  const move = diff === 0 ? "같습니다" : diff > 0 ? `${man(diff)} 늘었습니다` : `${man(-diff)} 줄었습니다`;
  return (
    `1년 사이로 보면, 같은 평균 금리가 ${monthLabel(prevMonth)} 연 ${Number(prev[1])}%에서 ` +
    `${monthLabel(lastMonth)} 연 ${Number(lastRate)}%가 되어, 같은 1억의 매달 상환액이 ${man(then)}에서 ${man(now)}으로 ${move}.`
  );
}
