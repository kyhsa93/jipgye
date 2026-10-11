// 이식된 조각의 목록 (#237). 이름은 prerender.mjs의 `*Html()` 함수 이름 그대로, 값은 같은 인자를 받아 React 요소를 돌려주는 함수다.
// 데이터가 없을 때는 legacy처럼 null을 돌려준다(그러면 자리표시가 legacy와 같은 방식으로 비게 된다).
// 여기서 `scripts/renderer.mjs`·`scripts/prerender.mjs`를 불러오면 안 된다(로더가 막는다). 계산은 순수 모듈에서 가져온다.
//
// 이식된 것: ratesHtml·ratesHeadHtml (#240, 금리 4개 상품군). #241~#243이 이어서 채운다.
import { RATES_ROWS, isSavingCategory, netInterestText, rate, rateRange, selectRateRows } from "../rates-table.mjs";

// legacy의 `escapeHtml(value ?? "")`는 String()으로 바꿔 쓴다 - React는 숫자 아닌 값(false·객체)을 글자로 내지 않으므로 같게 맞춘다.
const ProductCell = ({ product }) => (
  <td>
    <div className="product-name">{String(product.name ?? "-")}</div>
    <div className="product-company">{String(product.company ?? "")}</div>
  </td>
);

function ratesHead(category = "deposit") {
  return isSavingCategory(category) ? (
    <tr>
      <th scope="col">상품</th>
      <th scope="col">기본금리</th>
      <th scope="col">최고금리</th>
      <th scope="col">세후 이자</th>
    </tr>
  ) : (
    <tr>
      <th scope="col">상품</th>
      <th scope="col">금리 유형</th>
      <th scope="col">금리(최저~최고)</th>
      <th scope="col">평균</th>
    </tr>
  );
}

function ratesRows(rates, { category = "deposit", limit = RATES_ROWS } = {}) {
  const rows = selectRateRows(rates, category, limit);
  if (!rows) return null;

  const saving = isSavingCategory(category);
  return (
    <>
      {rows.map(({ product, option }, i) =>
        saving ? (
          <tr key={i}>
            <ProductCell product={product} />
            <td data-label="기본금리">{rate(option.rate)}</td>
            <td className="rate-strong" data-label="최고금리">
              {rate(option.maxRate ?? option.rate)}
            </td>
            <td className="net-interest" data-label="세후 이자">
              {netInterestText(option, category)}
            </td>
          </tr>
        ) : (
          <tr key={i}>
            <ProductCell product={product} />
            <td data-label="금리 유형">{String(option.rateType ?? "-")}</td>
            <td data-label="금리(최저~최고)">{rateRange(option.min, option.max)}</td>
            <td className="rate-low" data-label="평균">
              {rate(option.avg)}
            </td>
          </tr>
        )
      )}
    </>
  );
}

export const fragments = {
  ratesHeadHtml: ratesHead,
  ratesHtml: ratesRows,
};
