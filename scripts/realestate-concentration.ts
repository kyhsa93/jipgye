// 서울 매매 대표값의 표본이 한 단지·한 계약일 행으로 차 있을 때의 규칙과 그 문구(#862 1단계). 순수 모듈 - 빌드(realestate-metrics·build-realestate)와 칸(realestate-rows·realestate-table·realestate-overall)과 칩(news-context)이 같이 쓴다.
// 화면 JS(docs/index.html, realestate-template.html)는 이 판정을 다시 하지 않고 빌드가 `changeWithheld.text` 에 구워 둔 두 언어 문구를 고르기만 한다 - DIRECTION 체크리스트 10(드리프트). 틀은 47장에 실려 인라인 한도(S6)도 빠듯하다.
//
// 이 규칙은 표시만 한다: 대표값을 바꾸지 않고, 어느 값이 맞다고 말하지 않으며, 다시 찍힌 행을 막지도 않는다(그것은 2단계). 그래서 문구에 재도장을 말하지 않는다 - 계약 기준 날에는 같은 행이 실제 그 창의 계약이다.
import { baselineEn, baselineKo } from "./realestate-format.ts";

// 11-03 재수집 도장으로 한 단지 313행이 다시 들어간 주의 기록들. 이 날짜의 기록은 규칙이 생기기 전에 얼렸고 지난 값은 고치지 않으므로(조건 5) 발동 정보가 없어 날짜로 막는다.
// 판정은 오늘이 아니라 findBaseline 이 고른 기준일로 한다 - 기록이 하루 빠지면 11-16 도 11-08 을 기준으로 삼기 때문이다.
export const CONCENTRATED_BASELINE_DATES = Object.freeze(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);

export const REASON_BASELINE = "baseline-concentration";

/** 이 기록을 7일 비교의 기준으로 쓰면 안 되는가. 규칙이 생긴 뒤의 기록은 `overall.sale.concentration` 이 말하고, 그 전 엿새는 날짜 목록이 말한다. */
export const isConcentratedBaseline = (record) =>
  Boolean(record) && (CONCENTRATED_BASELINE_DATES.includes(record.date) || Boolean(record.overall?.sale?.concentration));

const countEn = (n, window) => `${n.toLocaleString("en-US")} ${window?.basis === "arrival" ? "filings" : "deals"}`;

/** 기준일 표본에 걸려 증감을 보류한 칸의 글자(국·영). 건수는 지금 표본의 것이고 기준일 값은 적지 않는다. */
export function baselineHeldText(metric, baselineDate, window) {
  const count = metric.transactionCount;
  return {
    ko: { cell: `${count.toLocaleString("ko-KR")}건 · 증감 보류 — ${baselineKo(baselineDate)} 표본에 한 단지·한 계약일 행이 5% 이상` },
    en: { cell: `${countEn(count, window)} · change withheld — 5%+ of the ${baselineEn(baselineDate)} sample was one complex on one contract date` },
  };
}
