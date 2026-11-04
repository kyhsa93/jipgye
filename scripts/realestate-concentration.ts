// 서울 매매 대표값의 표본이 한 단지·한 계약일 행으로 차 있을 때의 규칙과 그 문구(#862 1단계). 순수 모듈 - 빌드(realestate-metrics·build-realestate)와 칸(realestate-rows·realestate-table·realestate-overall)과 칩(news-context)이 같이 쓴다.
// 화면 JS(docs/index.html, realestate-template.html)는 이 판정을 다시 하지 않고 빌드가 `changeWithheld.text` 에 구워 둔 두 언어 문구를 고르기만 한다 - DIRECTION 체크리스트 10(드리프트). 틀은 47장에 실려 인라인 한도(S6)도 빠듯하다.
//
// 이 규칙은 표시만 한다: 대표값을 바꾸지 않고, 어느 값이 맞다고 말하지 않으며, 다시 찍힌 행을 막지도 않는다(그것은 2단계). 그래서 문구에 재도장을 말하지 않는다 - 계약 기준 날에는 같은 행이 실제 그 창의 계약이다.
import { baselineEn, baselineKo, formatMan, formatPercent, hasEnoughSample } from "./realestate-format.ts";

// 11-03 일 수집 도장으로 한 단지 313행이 다시 들어간 주의 기록들. 이 날짜의 기록은 규칙이 생기기 전에 얼렸고 지난 값은 고치지 않으므로(조건 5) 발동 정보가 없어 날짜로 막는다.
// 판정은 오늘이 아니라 findBaseline 이 고른 기준일로 한다 - 기록이 하루 빠지면 11-16 도 11-08 을 기준으로 삼기 때문이다.
export const CONCENTRATED_BASELINE_DATES = Object.freeze(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);

export const REASON_CURRENT = "concentration";
export const REASON_BASELINE = "baseline-concentration";

// 문턱: 한 단지·한 계약일 행이 표본의 5% 이상이면서 10행 이상. #862 data-analyst 판정의 값 판단이다 - 313행 사건을 본 뒤 정했고 사전 등록이 아니다.
// 표본 100건 이상 39일에서 5%~10.7% 어디에 놓아도 같은 11일이 발동하고, 주별 묶음 9,641개에 6~21행 묶음이 0개라 행 하한은 6~22 어디든 같다. 4.60~4.76% 날이 바로 아래에 있어 깔끔한 경계는 아니다.
export const CONCENTRATION = { minShare: 0.05, minRows: 10 };

/** 부동소수 비교를 피해 정수로 판정한다(n/N >= 0.05 ⇔ n*20 >= N). 3,423건에서 171행은 유지, 172행은 발동이다. */
export const isConcentrated = (rows, total) => rows * 20 >= total && rows >= CONCENTRATION.minRows;

/** 묶음 키: 구 코드 + 동 + 단지명 + 계약일. 빌드 안에서만 쓰고 realestate.json·history 에 남기지 않는다. 단지명이나 계약일이 없는 행은 어느 묶음에도 넣지 않는다(표본 수에는 든다). */
export function concentrationKey(code, item, date) {
  const apt = String(item?.aptNm ?? "").trim();
  return apt && date ? `${code}|${String(item?.umdNm ?? "").trim()}|${apt}|${date}` : null;
}

/** 이 기록을 7일 비교의 기준으로 쓰면 안 되는가. 규칙이 생긴 뒤의 기록은 `overall.sale.concentration` 이 말하고, 그 전 엿새는 날짜 목록이 말한다. */
export const isConcentratedBaseline = (record) =>
  Boolean(record) && (CONCENTRATED_BASELINE_DATES.includes(record.date) || Boolean(record.overall?.sale?.concentration));

const unitEn = (n, window) => {
  const word = window?.basis === "arrival" ? "filing" : "deal";
  return n === 1 ? word : `${word}s`;
};
const countEn = (n, window) => `${n.toLocaleString("en-US")} ${unitEn(n, window)}`;
const countKo = (n) => `${n.toLocaleString("ko-KR")}건`;

// 뺀 쪽이 MIN_SAMPLE 아래면 값을 내지 않는다(DIRECTION 해자 2). 빌드가 값을 null 로 두므로 이 판정은 옛 모양까지 막는 이중 안전이다.
const canShowWithout = (without) => hasEnoughSample(without) && typeof without.avgPricePerPyeong10k === "number";

/**
 * 「한 단지·한 계약일 313건을 빼면 5,422만원(441건)」 한 조각. `format` 은 값을 어떤 자로 적을지(칸은 3.3㎡당, 칩은 84㎡ 환산)를 정한다.
 * 두 값과 표본만 말하고 어느 쪽이 맞다고 하지 않는다. 단지 이름은 입력에 없다.
 */
export function concentrationClause(concentration, window, locale, format = formatMan) {
  const { rows, without } = concentration;
  const left = without.transactionCount;
  if (locale === "en") {
    const head = `excluding ${rows.toLocaleString("en-US")} from one complex on one contract date:`;
    return canShowWithout(without)
      ? `${head} ${format(without.avgPricePerPyeong10k, "en")} (${countEn(left, window)})`
      : `${head} only ${countEn(left, window)} ${left === 1 ? "remains" : "remain"}, too few to average`;
  }
  const head = `한 단지·한 계약일 ${countKo(rows)}을 빼면`;
  return canShowWithout(without)
    ? `${head} ${format(without.avgPricePerPyeong10k, "ko")}(${countKo(left)})`
    : `${head} ${countKo(left)}이라 값을 내지 않습니다`;
}

/**
 * 전세 장 전세가율 카드의 건수 줄에 더하는 단서(#862 pm 최종 판정). 값 하나를 보여 주는 칸이라 대표값으로 낸 값은 그대로 두고, 그 행을 뺀 매매 값으로 나눈 값을 함께 밝힌다.
 * 뺀 쪽 값이나 전세 값이 없으면 숫자 없이 단서만 적는다. 나누는 식은 realestate-format.ts jeonseRatio 와 같다.
 */
function ratioNote(concentration, jeonse) {
  const { rows, without } = concentration;
  const deposit = hasEnoughSample(jeonse) ? jeonse.avgDepositPerPyeong10k : null;
  const ratio = canShowWithout(without) && typeof deposit === "number" ? formatPercent((deposit / without.avgPricePerPyeong10k) * 100) : null;
  return {
    ko: ratio
      ? `매매 표본에 한 단지·한 계약일 ${countKo(rows)}이 들어 있어, 빼면 ${ratio}`
      : `매매 표본에 한 단지·한 계약일 ${countKo(rows)}이 들어 있습니다`,
    en: `the sale sample includes ${rows.toLocaleString("en-US")} from one complex on one contract date${ratio ? `; without them ${ratio}` : ""}`,
  };
}

/** 지금 표본이 걸린 칸의 글자(국·영). cell 은 건수까지, detail 은 건수가 따로 있는 카드용, ratio 는 전세가율 카드용이다. 화면 JS 는 이것을 고르기만 한다. */
export function concentrationText(metric, window, jeonse = null) {
  const count = metric.transactionCount;
  const ratio = ratioNote(metric.concentration, jeonse);
  const detailKo = `증감 보류 · ${concentrationClause(metric.concentration, window, "ko")}`;
  const detailEn = `change withheld · ${concentrationClause(metric.concentration, window, "en")}`;
  return {
    ko: { cell: `${countKo(count)} · ${detailKo}`, detail: detailKo, ratio: ratio.ko },
    en: { cell: `${countEn(count, window)} · ${detailEn}`, detail: detailEn, ratio: ratio.en },
  };
}

/** 구 장 문장: 서울 평균을 그대로 쓰는 문장 바로 뒤에 붙는 단서. 비교 자체(0.9배)는 대표값 그대로다(#862 pm 판정). */
export function concentrationSentence(metric, window, locale) {
  const { rows, without } = metric.concentration;
  if (locale === "en") {
    const tail = canShowWithout(without)
      ? `the average without them is ${formatMan(without.avgPricePerPyeong10k, "en")} (${countEn(without.transactionCount, window)})`
      : `without them only ${countEn(without.transactionCount, window)} ${without.transactionCount === 1 ? "remains" : "remain"}, too few to average`;
    return `The Seoul sample of ${countEn(metric.transactionCount, window)} includes ${rows.toLocaleString("en-US")} from one complex on one contract date; ${tail}.`;
  }
  const tail = canShowWithout(without)
    ? `${formatMan(without.avgPricePerPyeong10k, "ko")}(${countKo(without.transactionCount)})입니다`
    : `${countKo(without.transactionCount)}이라 값을 내지 않습니다`;
  return `서울 평균 표본 ${countKo(metric.transactionCount)}에는 한 단지·한 계약일 ${countKo(rows)}이 들어 있어, 빼면 ${tail}.`;
}

/** 기준일 표본에 걸려 증감을 보류한 칸의 글자(국·영). 건수는 지금 표본의 것이고 기준일 값은 적지 않는다. */
export function baselineHeldText(metric, baselineDate, window) {
  const count = metric.transactionCount;
  return {
    ko: { cell: `${countKo(count)} · 증감 보류 — ${baselineKo(baselineDate)} 표본에 한 단지·한 계약일 행이 5% 이상` },
    en: { cell: `${countEn(count, window)} · change withheld — 5%+ of the ${baselineEn(baselineDate)} sample was one complex on one contract date` },
  };
}
