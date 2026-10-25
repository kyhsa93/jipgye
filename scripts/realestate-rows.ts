// 첫 화면 실거래 요약 표(realestateHtml)가 같이 쓰는 것. 순수 모듈 - render/entry.jsx(JSX)가 이 칸 규칙·정렬을 쓴다(#241 PR 3).
// 여기서 `prerender.ts`·`renderer.mjs`를 불러오면 안 된다(로더가 막는다). 글자(HTML)는 만들지 않는다 - 칸 하나가 어떤 모양인지(없음·표본 부족·값)와
// 그 값의 글자만 정하고, 마크업은 쓰는 쪽(JSX 요소)이 입힌다. 그래야 분기가 한 곳에만 있다.
//
// 표본 문턱(MIN_SAMPLE)과 그 판정(hasEnoughSample)은 realestate-format.mjs의 것을 쓴다 - 둘이던 것(prerender.ts 49행)을 하나로 했다.
// DIRECTION 해자 2: 표본이 모자라면 값을 내지 않고 모자란다고 적는다(`low`) - 이 판정을 건너뛰는 변경은 방향에 어긋난다.
import { hasEnoughSample, kindField } from "./realestate-format.ts";

// 첫 화면에 그리는 자치구 수. 모바일에서 표는 행마다 카드로 펼쳐지므로
// 열한 행이면 요약까지 1,500px을 내려야 한다. 나머지는 표 밑 '더 보기'로 편다.
// index.html의 MAX_VISIBLE_DISTRICTS와 같아야 한다 - 다르면 자바스크립트가
// 붙는 순간 표 길이가 튀고, 그걸 index-realestate-rows 검사가 잡는다.
export const MAX_DISTRICTS = 4;

/** 만원 단위 값을 "1,234만원"으로. 숫자가 아닌 값은 Number()를 거친 대로(NaN이면 "NaN만원") 낸다 - 예전 prerender.ts의 `man`과 같다. */
export const man = (value) => `${Number(value).toLocaleString("ko-KR")}만원`;

/** 직전 대비 증감. 없거나 숫자가 아니면 null, 있으면 부호(+·-·없음)와 "1,234만"(절댓값). */
export function changeOf(change) {
  if (!change || typeof change.value10k !== "number") return null;
  const sign = change.value10k > 0 ? "+" : change.value10k < 0 ? "-" : "";
  return { sign, text: `${Math.abs(change.value10k).toLocaleString("ko-KR")}만` };
}

/** 신고 건수. 숫자가 아니면 null(칸에서 건수를 뺀다), 숫자면 "1,234건". */
export const countOf = (metric) =>
  typeof metric?.transactionCount === "number" ? `${metric.transactionCount.toLocaleString("ko-KR")}건` : null;

/**
 * 증감을 보류한 칸의 흐린 글자(#290). 현재 주 쪽이 얇으면 현재 건수, 아니면 기준 주 건수를 적는다. 브라우저(docs/index.html)의 realestateWithheld* 와 같은 문장이다.
 * `changeWithheld` 가 없으면 null.
 */
export function withheldOf(metric) {
  const w = metric?.changeWithheld;
  if (!w) return null;
  return w.current < w.min
    ? `증감 보류 — 이번 주 집계 중(${w.current.toLocaleString("ko-KR")}건)`
    : `증감 보류 — 비교 주 표본 부족(${w.baseline.toLocaleString("ko-KR")}건)`;
}

/**
 * 표 한 칸(매매·전세·월세)이 어떤 모양인가.
 *  - { type: "none" }: 지표가 없거나 값이 없다 → "-"
 *  - { type: "low", count }: 신고가 MIN_SAMPLE 건 아래라 평균을 내지 않는다 → "표본 N건". `count`는 `transactionCount` 그대로(숫자가 아니어도 그대로 적는다)
 *  - { type: "value", text, change, count }: 값. 월세는 증감을 내지 않는다(change는 null)
 *    서울 전체 줄(`overall`)에서 증감을 보류했으면 건수 자리에 보류 문구가 온다(그 문구가 건수를 품는다). 자치구 줄은 증감만 빠지고 건수는 그대로다.
 * `kind`는 realestate-format.mjs의 KIND_FIELDS 키인 문자열(sale·jeonse·wolse)이다 - 배열 등 다른 값은 던진다.
 */
export function metricCell(kind, metric, overall = false) {
  if (!metric) return { type: "none" };
  if (!hasEnoughSample(metric)) return { type: "low", count: metric.transactionCount };
  const value = metric[kindField(kind).value];
  if (!value) return { type: "none" };
  if (kind === "wolse") return { type: "value", text: `${man(value)} / 월 ${man(metric.avgMonthlyRent10k)}`, change: null, count: countOf(metric) };
  const withheld = overall ? withheldOf(metric) : null;
  return { type: "value", text: man(value), change: changeOf(metric.change), count: withheld ?? countOf(metric) };
}

/**
 * 첫 화면에 올릴 자치구: 매매 평당가가 높은 순(표본이 모자란 곳은 값이 없는 것으로 쳐 뒤로), 같으면 들어온 순서, 앞에서 MAX_DISTRICTS곳.
 * 값이 없는 곳(표본 부족·평당가 없음)끼리도 들어온 순서다.
 */
export function topDistricts(realestate) {
  const priceOf = (d) => (hasEnoughSample(d.sale) ? d.sale.avgPricePerPyeong10k ?? null : null);
  return [...(realestate.districts ?? [])]
    .sort((a, b) => {
      const [x, y] = [priceOf(a), priceOf(b)];
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    })
    .slice(0, MAX_DISTRICTS);
}
