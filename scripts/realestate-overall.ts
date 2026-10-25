// 실거래 시세 요약 카드(realestateOverallHtml)와 그 전용 보조 함수 `ratioBasis`가 같이 쓰는 카드 규칙. 순수 모듈 - render/entry.jsx(JSX)가 이 함수를 쓴다(#242 PR 3).
// 여기서 `prerender.ts`·`renderer.mjs`를 불러오면 안 된다(로더가 막는다). 예전에 prerender.ts에 있던 `ratioBasis`와 옛 문자열 렌더 본문의 분기가 여기 있다.
//
// 이 모듈은 마크업(HTML)을 만들지 않는다. 카드가 몇 장이고 어떤 라벨·값·부가 글자를 갖는지만 정하고, `<div class="overall-card">` 같은 마크업(클래스 포함)은 쓰는 쪽(JSX 요소)이 입힌다
// (#255 `realestate-rows.mjs`, #256 `district-tables.mjs`, #242 PR 2 `realestate-table.mjs`와 같은 방식). 클래스를 모듈이 들고 있으면 한 곳의 오타를 같은 실행 비교가 못 잡는다.
//
// 카드는 { label, value, sub }이다. label은 글자(상수 RE_LABELS, JSX 가 이스케이프한다). value와 sub는 조각(seg)의 배열이고 sub는 없으면 null이다(없으면 `<div class="sub">`를 내지 않는다).
// 조각 하나는 { text, esc }이다(표본 부족 이유 조각만 low: true 가 더 붙는다): esc는 예전 문자열 렌더가 그 글자를 `escapeHtml`에 거치던 자리(true)와 이스케이프 없이 문자열에 끼우던 자리(false, raw)를 가른다. JSX는 어느 쪽이든 글자를 요소의 텍스트로 낸다 - React가 이스케이프한다.
// raw 자리(esc=false)의 글자는 전부 숫자 서식 함수(formatMan·formatEok·formatPercent)와 코드 상수 구분자(" / "·" · "·"월 ")가 만든 것이라 `& < > "`가 들 수 없다 - 그래서 예전 문자열 렌더와 React가 달라질 수 없었다(PR 본문의 raw 보간 표).
// 입력 글자(신고 건수·단지·평형 칸 수)가 닿는 자리는 전부 esc=true다.
//
// 표본 문턱(MIN_SAMPLE)은 여기서 정의하지도 다시 적용하지도 않는다. `resolveMetric`·`jeonseRatio`(realestate-format.mjs, `hasEnoughSample`)가 한 곳에서 판정하고, 이 모듈은 그 결과(값 있음 / 없음)를 따른다.
// 단지별 중앙값(`spread`)의 칸 수 문턱(MIN_CELLS_MEDIAN 10·MIN_CELLS 20)은 빌더(`complex-ratio.mjs`의 `spreadOf`)가 이미 적용해 문턱 미달이면 `spread`가 null로 온다 - 이 모듈은 있으면 낸다.
// DIRECTION 해자 2: 표본이 모자라면 값을 내지 않는다 - 이 판정을 건너뛰는 변경은 방향에 어긋난다. 값을 못 낸 카드는 「-」이되, 신고가 1~4건이라 비운 카드만 이유를 적는다(#264 - lowSampleCount). n=0·지표 없음·값 null 은 「-」 그대로다.
import {
  areaPrice,
  formatPercent,
  jeonseRatio,
  lowSampleCount,
  resolveMetric,
  valueOf,
} from "./realestate-format.ts";
import { RE_LABELS, reCount, reEok, reMan } from "./realestate-table.ts";

const raw = (text) => ({ text, esc: false });
const esc = (text) => ({ text, esc: true });
const card = (label, value, sub = null) => ({ label, value, sub });

// 신고가 1~4건이라 값을 비운 카드는 「-」 대신 이유를 적는다(#264, DIRECTION 해자 2). `low` 조각은 쓰는 쪽(JSX)이 `<span class="low-sample">`로 입힌다(표의 low 조각과 같은 클래스, title 은 붙이지 않는다 - 이유는 보이는 글자가 맡는다).
// n=0·지표 없음·값 null 은 lowSampleCount 가 null 을 줘서 「-」 그대로다. 브라우저의 renderOverall(lowOr)이 같은 글자를 만든다.
export const lowSampleReason = (n) => `신고 ${n}건이라 비움`;
const dashOrLow = (entry, kind) => {
  const n = lowSampleCount(entry, kind);
  return n === null ? [raw("-")] : [{ text: lowSampleReason(n), esc: true, low: true }];
};

/**
 * 전세가율 카드 밑에 그 값을 낸 매매·전세 신고 건수를 적는다(#172). 값은 이 두 평균의 비다.
 * 브라우저의 renderOverall(scripts/realestate-template.html)이 같은 문자열을 만든다. 글자만 돌려준다(이스케이프는 쓰는 쪽 - JSX 는 React).
 * 두 지표가 모두 값을 낼 때(`jeonseRatio`가 null이 아닐 때)만 부른다 - 아니면 `resolveMetric`이 null이라 던진다(예전 그대로).
 */
export const ratioBasis = (entry) =>
  `${RE_LABELS.sale} ${reCount(resolveMetric(entry, "sale").metric.transactionCount)} · ` +
  `${RE_LABELS.jeonse} ${reCount(resolveMetric(entry, "jeonse").metric.transactionCount)}`;

/**
 * 시세 요약 카드. 자치구 페이지(district)면 그 자치구의 매매 세 장 + 전세가율 + 단지별 중앙값, 아니면 서울 전체:
 * 종류(kind)가 없으면 매매·전세·월세 한 장씩, 있으면 그 종류의 카드들. 서울 전체도(자치구면 그 자치구도) 없으면 null이다.
 * `spread`는 단지·평형 칸에서 낸 전세가율의 중앙값({ median, cells })이고 없으면 그 카드를 뺀다.
 */
export function overallCards(realestate, kind = null, district = null, spread = null) {
  const overall = district ? (realestate?.districts ?? []).find((d) => d.name === district) : realestate?.overall;
  if (!overall) return null;

  // 전세가율 카드 옆에 칸 하나하나에서 낸 값의 중앙값을 나란히 둔다.
  // 표의 값은 이 표의 두 열을 나눈 것이라 표와는 맞고, 이 값은 실제 단지와 맞는다.
  // 하나를 다른 하나로 갈아 끼우면 같은 행의 숫자들과 어긋나므로 둘을 같이 둔다.
  const complexCard = () =>
    spread
      ? [card(RE_LABELS.ratioByComplex, [raw(formatPercent(spread.median))], [esc(`단지·평형 ${spread.cells.toLocaleString("ko-KR")}칸`)])]
      : [];

  if (district) {
    const sale = resolveMetric(overall, "sale")?.metric;
    const ratio = jeonseRatio(overall);
    return [
      ...(sale
        ? [
            card(RE_LABELS.perPyeong, [raw(reMan(valueOf(sale, "sale")))]),
            card(RE_LABELS.area, [raw(reEok(areaPrice(valueOf(sale, "sale"))))]),
            card(RE_LABELS.count, [esc(reCount(sale.transactionCount))]),
          ]
        : [card(RE_LABELS.sale, dashOrLow(overall, "sale"))]),
      ...(ratio ? [card(RE_LABELS.ratio, [raw(formatPercent(ratio.ratio))], [esc(ratioBasis(overall))])] : []),
      ...complexCard(),
    ];
  }

  if (!kind) {
    return ["sale", "jeonse", "wolse"].map((k) => {
      const metric = resolveMetric(overall, k)?.metric;
      const label = RE_LABELS[k === "sale" ? "colSale" : k === "jeonse" ? "colJeonse" : "colWolse"];
      if (!metric) return card(label, dashOrLow(overall, k));
      if (k === "wolse") {
        return card(label, [raw(`${reMan(metric.avgDeposit10k)} / 월 ${reMan(metric.avgMonthlyRent10k)}`)], [esc(reCount(metric.transactionCount))]);
      }
      return card(label, [raw(reMan(valueOf(metric, k)))], [esc(RE_LABELS.area), raw(` ${reEok(areaPrice(valueOf(metric, k)))} · `), esc(reCount(metric.transactionCount))]);
    });
  }

  const metric = resolveMetric(overall, kind)?.metric;
  if (!metric) return [card(RE_LABELS.overall, dashOrLow(overall, kind))];
  if (kind === "wolse") {
    return [
      card(RE_LABELS.deposit, [raw(reMan(metric.avgDeposit10k))]),
      card(RE_LABELS.monthly, [raw(`월 ${reMan(metric.avgMonthlyRent10k)}`)]),
      card(RE_LABELS.count, [esc(reCount(metric.transactionCount))]),
    ];
  }
  const perPyeong = valueOf(metric, kind);
  const ratio = kind === "jeonse" ? jeonseRatio(overall) : null;
  return [
    card(kind === "jeonse" ? RE_LABELS.perPyeongDeposit : RE_LABELS.perPyeong, [raw(reMan(perPyeong))]),
    card(RE_LABELS.area, [raw(reEok(areaPrice(perPyeong)))]),
    ...(ratio ? [card(RE_LABELS.ratio, [raw(formatPercent(ratio.ratio))], [esc(ratioBasis(overall))])] : []),
    ...(kind === "jeonse" ? complexCard() : []),
    card(RE_LABELS.count, [esc(reCount(metric.transactionCount))]),
  ];
}
