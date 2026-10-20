// 예산대 장 조각의 모양과 값 글자 (#243 PR A: 잎 조각 여덟 개 budgetAnswersHtml·budgetMoreHtml·budgetMinCashHtml·budgetPolicyHtml·
// budgetCapHtml·budgetCostsHtml·budgetFactsHtml·budgetLoanHtml, PR B: 후보 단지 budgetCandidatesHtml·합성 budgetBodyHtml과 helper budgetDealHtml·budgetWhereHtml·budgetWhen).
// 순수 모듈 - prerender.mjs(legacy)와 render/entry.jsx(JSX)가 같은 규칙을 쓴다.
//
// 이 모듈은 HTML을 만들지 않는다: 어느 문단이 나오는지·어떤 줄이 있는지·글자가 무엇인지만 정하고, 클래스·태그·`data-prerendered`·이스케이프는
// 쓰는 쪽(legacy 문자열·JSX 요소)이 각자 입힌다. 모듈이 마크업을 들고 있으면 한 곳의 오타를 같은 실행 비교가 못 잡는다(#255~#257·#242 PR 3과 같은 방식).
// 표본 문턱·해자 `low-sample` 분기는 없다 - 이 조각들은 값을 못 낸 자리를 비우거나 줄을 빼기만 하고, 후보 단지의 "같은 평형 6개월 3번 이상" 문턱은
// 렌더 때가 아니라 빌더가 만든 데이터 칸(`cell.n`, complex-price.mjs MIN_DEALS)에 이미 반영돼 있다(candidatesInBand는 거르지 않는다). 정책대출 건수가 없으면 문장 자체가 빠진다(policySentence).
// budgetWhereHtml의 0.5·10개 구는 표본 문턱이 아니라 문장 선택 문턱이다(상위 세 구가 절반을 넘으면 "몰렸다", 아니면 열 개 구 이상일 때만 "흩어졌다").
// 렌더러·prerender.mjs를 부르지 않는다(로더가 막는다).
import { candidatesInBand } from "./complex-price.ts";
import { BASIS_DATE as CAP_DATE, capSentence } from "./loan-cap.ts";
import { BASIS_DATE as MIN_CASH_DATE, minCash, minCashSentence } from "./min-cash.ts";
import { apartmentOptions, loanSentence, monthlyPayment, rateSpread } from "./mortgage.ts";
import { BASIS_DATE as POLICY_DATE_BASIS, policySentence, policyShort } from "./policy-loan.ts";
import { BASIS_DATE as COSTS_DATE, costsSentence, purchaseCosts } from "./purchase-costs.ts";
import { formatEok, monthLabel } from "./realestate-format.ts";

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

// ---- 후보 단지·합성 (#243 PR B) ----

/** 목록에 이름을 올리는 단지 수. 나머지는 검색의 "단지로 묶어 보기"로 보낸다 - 열여덟 장이 같은 긴 목록이 되지 않게. prerender.mjs가 같은 이름으로 다시 내보낸다. */
export const CANDIDATE_LIST = 12;

/** 거래일("2026-09-15") → "9/15". 월·일이 없으면 "". */
export const budgetWhen = (date) => {
  const [, month, day] = String(date ?? "").split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : "";
};

/**
 * 거래 한 줄의 네 칸 글자({ place, spec, when, price }). 전부 문자열이다(legacy가 escapeHtml에 넘기던 값 - 입력 글자는 `join`·템플릿을 거쳐 이미 문자열).
 * 장소는 구·동·단지 중 있는 것만 공백으로 잇고, 규격은 "면적㎡ · N층"이다.
 */
export function dealShape(deal) {
  const place = [deal.district, deal.dong, deal.apt].filter(Boolean).join(" ");
  const spec = [`${deal.area}㎡`, deal.floor ? `${deal.floor}층` : null].filter(Boolean).join(" · ");
  return { place, spec, when: budgetWhen(deal.date), price: formatEok(deal.amount10k) };
}

/**
 * 이 예산이 서울에서 어디로 가는가 - 문장 하나("" = 말하지 않음).
 *
 * 지역 순위는 이미 아래 줄에 숫자로 있지만, 숫자를 세 개 읽고 나서야 알게 되는 것과 한 문장으로 읽는 것은 다르다. 그리고 예산대마다 답이 실제로 다르다 - 4억대는 노원·
 * 도봉·중랑이고 18억대는 강동·송파·성동이라, 이 한 줄이 열여덟 장에서 열여덟 번 다른 말을 한다.
 *
 * 상위 세 구가 절반(0.5)을 넘을 때만 "몰렸다"고 쓴다. 고르게 흩어진 예산대에서 "여기에 몰려 있다"고 하면 사실이 아니고, 그럴 때는 흩어졌다는 것이 답이다 -
 * 다만 구가 열 개(10) 이상일 때만 그렇게 쓴다(적은 구에서는 흩어졌다는 말이 성립하지 않는다). 둘 다 표본 문턱이 아니라 문장 선택 문턱이다(해자 `low-sample` 분기가 아니다).
 */
export function whereText(band) {
  const districts = band.districts ?? [];
  if (districts.length < 3 || !band.count) return "";

  const top3 = districts.slice(0, 3);
  const share = top3.reduce((sum, d) => sum + d.count, 0) / band.count;
  const names = top3.map((d) => d.name).join("·");
  const label = budgetBandLabel(band);

  return share >= 0.5
    ? `${label} 거래의 ${Math.round(share * 100)}%가 ${names} 세 곳에서 나왔습니다. 이 예산으로 서울에서 고를 수 있는 곳은 사실상 여기입니다.`
    : districts.length >= 10
      ? `${label} 거래는 ${districts.length}개 구에 흩어져 있고 상위 세 곳(${names})을 합쳐도 ${Math.round(share * 100)}%입니다. 이 예산에서는 지역이 아니라 단지가 선택을 가릅니다.`
      : "";
}

// 평형대로 나눈다 - 상위가 재건축 소형으로만 채워지면 59·84형을 찾는 사람이 다시 걸러야 했다(#35).
const AREA_BANDS: [string, (r: { area: number }) => boolean][] = [
  ["60㎡ 미만", (r) => r.area < 60],
  ["60~85㎡", (r) => r.area >= 60 && r.area <= 85],
  ["85㎡ 초과", (r) => r.area > 85],
];

/**
 * 이 예산대에 드는 단지·평형(단지 후보)의 모양. 기준 달 값으로 고친 중앙값으로 가른다 - 거래 목록은 "언제 얼마에 팔렸나"이고, 이것은 "지금 이 예산이면 어느 단지의
 * 어느 평형인가"다(scripts/complex-price.mjs). 자치구는 거르는 조건이 아니라 묶는 축이다 - 자치구를 먼저 고르게 하면 겹친 조건에서 빈 화면이 잦다.
 *
 * 예산대나 단지 파일이 없으면 null(조각은 빈 문자열). 후보가 없으면 { empty: 문장 }, 있으면 { intro, bandCounts, districts, rows, moreHref, moreText }.
 * 문턱("같은 평형이 6개월에 3번 이상")은 여기서 정하지 않는다 - 빌더가 이미 칸(`cell.n`)에 반영했고 candidatesInBand는 거르지 않는다.
 * rows[].apt은 입력 그대로(legacy가 escapeHtml(값 ?? "")하던 자리라 JSX가 str()로 바꾼다), 나머지 글자는 전부 문자열이다. moreHref는 `&`를 그대로 쓴다(legacy는 `&amp;`로 적고 React는 속성값의 `&`를 `&amp;`로 낸다).
 */
export function candidatesShape(band, complexFiles) {
  if (!band || !complexFiles?.length) return null;
  const min = band.min10k;
  const max = band.max10k ?? min + 10_000;
  const rows = candidatesInBand(complexFiles, min, max);
  const reference = complexFiles[0]?.reference;
  const month = reference ? `${reference.slice(0, 4)}년 ${Number(reference.slice(4))}월` : "기준 달";
  const label = `${min / 10_000}억대`;
  if (!rows.length) {
    return { empty: `${month} 값으로 고친 중앙값이 ${label}인 단지·평형이 없습니다. 같은 평형이 6개월 동안 3번 이상 거래돼야 범위를 낼 수 있습니다.` };
  }
  const byDistrict = new Map();
  for (const row of rows) byDistrict.set(row.district, (byDistrict.get(row.district) ?? 0) + 1);
  const districts = [...byDistrict].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  const per = Math.floor(CANDIDATE_LIST / AREA_BANDS.length);
  const first = AREA_BANDS.flatMap(([, f]) => rows.filter(f).slice(0, per));
  // 한 평형대가 모자라면 남은 자리는 다른 평형대의 다음 순번으로 채운다 - 목록 길이는 예산대마다 같다.
  const picked = [...first, ...rows.filter((r) => !first.includes(r)).slice(0, CANDIDATE_LIST - first.length)];
  const list = picked
    .sort((a, b) => a.area - b.area || b.n - a.n)
    .map((row) => {
      const href = `./deal-search.html?district=${encodeURIComponent(row.district)}&apt=${encodeURIComponent(row.apt)}`;
      const facts = [row.district, row.dong, `${row.area}\u33a1`, row.buildYear ? `${row.buildYear}년` : null].filter(Boolean).join(" · ");
      const range = `${row.quartile ? "가운데 절반" : "최저~최고"} ${eokText(row.low)}~${eokText(row.high)}`;
      return { href, apt: row.apt, facts, amount: eokText(row.median), meta: `${range} · ${row.n}건` };
    });
  const bandCounts = AREA_BANDS.map(([bandLabel, f]) => `${bandLabel} ${rows.filter(f).length}`).join(" · ");
  return {
    intro:
      `${month} 값으로 고친 중앙값이 ${label}인 단지·평형은 서울에 ${rows.length.toLocaleString("ko-KR")}곳입니다. ` +
      `같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.`,
    bandCounts: `평형대별: ${bandCounts}`,
    districts: `자치구별: ${districts.map(([d, n]) => `${d} ${n}`).join(" · ")}`,
    rows: list,
    moreHref: `./deal-search.html?budget=${min / 10_000}&group=1`,
    moreText:
      rows.length > CANDIDATE_LIST
        ? `평형대마다 거래가 많은 곳을 고루 ${picked.length}곳만 적었습니다. ${rows.length}곳 전부와 평형·연식 조건은 실거래 검색에서 단지로 묶어 보세요 →`
        : "평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →",
  };
}

/**
 * 예산대 본문 맨 앞(거래 요약·신고분 기준·거래가 많은 지역)의 모양. 예산대가 없으면 null(조각도 null - 합성 조각 가운데 이것만 빈 결과가 null이다).
 * { summary, periods, districts }: periods는 "" 또는 "9월, 8월 신고분 기준", districts는 [{ name(입력 그대로 - JSX가 str()), count(숫자 서식 글자) }].
 * 읽는 순서(신고분 → 지역 → 요약)는 legacy 그대로다 - 입력이 이상할 때 던지는 자리가 같아야 한다.
 */
export function bodyShape(band, periodList) {
  if (!band) return null;
  const periods = (periodList ?? []).map((p) => monthLabel(p)).filter(Boolean).join(", ");
  const districts = (band.districts ?? []).map((d) => ({ name: d.name, count: d.count.toLocaleString("ko-KR") }));
  const summary = `${budgetBandLabel(band)}에서 ${band.count.toLocaleString("ko-KR")}건이 거래됐습니다${band.direct ? `(직거래 ${band.direct.toLocaleString("ko-KR")}건 포함)` : ""}.`;
  return { summary, periods: periods ? `${periods} 신고분 기준` : "", districts };
}
