// 금리 표 조각(`ratesHtml`·`ratesHeadHtml`)의 계산 (#240). 상수·값 모양·행 선택·정렬·세후 이자 칸의 값이 여기 한 곳에 있다.
//
// 두 곳이 같이 쓴다: `prerender.mjs`의 legacy 문자열 조각과 `render/entry.jsx`의 JSX 조각. JSX 진입 파일은 `prerender.mjs`를
// 불러올 수 없으므로(로더가 막는다 - #237) 이 계산을 두 곳에 복제하는 대신 부르는 쪽이 같은 모듈을 가져온다 - 같은 계산이 두 곳에
// 있으면 한쪽만 고쳐 드리프트가 난다(DIRECTION 새 아이디어 10). 마크업(어떤 태그에 어떤 클래스를 붙이나)만 두 곳에 따로 있고,
// 그 차이는 test/render-parity.test.mjs가 분기마다 견준다.
//
// 순수해야 한다: JSX 로더가 이 파일을 묶어 들어가므로 파일을 읽거나 환경을 보는 코드를 넣지 않는다.
import { DEFAULT_AMOUNT, formatWon, netInterestOf } from "./interest.mjs";

export const RATES_TERM = 12;
export const RATES_ROWS = 20;
export const SAVING_CATEGORIES = new Set(["deposit", "saving"]);

export const isSavingCategory = (category) => SAVING_CATEGORIES.has(category);

export const rate = (value) => (typeof value === "number" ? `${value.toFixed(2)}%` : "-");
export const rateRange = (min, max) =>
  typeof min === "number" && typeof max === "number" ? `${min.toFixed(2)}~${max.toFixed(2)}%` : rate(min ?? max);

/**
 * 상품군의 표 행. 상품이 없거나 고른 행이 없으면 null(조각이 null을 돌려준다), 아니면 `limit`개로 자른 `[{ product, option }]`.
 *
 * 상품마다 옵션 하나를 고른다: 예금·적금은 12개월 옵션 중 최고금리(`maxRate`)가 가장 높은 것, 대출은 최저금리(`min`)가 가장 낮은 것.
 * 값이 없는(null·undefined) 옵션은 비교에서 빠지고, 비교할 값이 하나도 없으면 첫 후보 옵션을 그대로 쓰되(fallback) 정렬 맨 뒤로 보낸다.
 */
export function selectRateRows(rates, category = "deposit", limit = RATES_ROWS) {
  const products = rates?.[category] ?? [];
  if (!products.length) return null;

  const saving = isSavingCategory(category);
  const key = saving ? "maxRate" : "min";
  const asc = !saving;

  const rows = [];
  for (const product of products) {
    let best = null;
    let bestValue = null;
    let fallback = null;
    for (const option of product.options ?? []) {
      if (saving && option.term !== RATES_TERM) continue;
      fallback ??= option;
      const value = option[key];
      if (value === null || value === undefined) continue;
      if (best === null || (asc ? value < bestValue : value > bestValue)) {
        best = option;
        bestValue = value;
      }
    }
    if (best) rows.push({ product, option: best, sort: bestValue });
    else if (fallback) rows.push({ product, option: fallback, sort: null });
  }

  rows.sort((a, b) => {
    if (a.sort === null || b.sort === null) return (a.sort === null) - (b.sort === null);
    return asc ? a.sort - b.sort : b.sort - a.sort;
  });

  if (!rows.length) return null;

  return rows.slice(0, limit).map(({ product, option }) => ({ product, option }));
}

/** 예금·적금 표의 '세후 이자' 칸 글자. 이자를 못 구하면 "-". 적금만 월 납입액 기준이다. */
export function netInterestText(option, category) {
  const saving = category === "saving";
  const net = netInterestOf(option, { amount: DEFAULT_AMOUNT[saving ? "saving" : "deposit"], saving });
  return net === null ? "-" : formatWon(net);
}
