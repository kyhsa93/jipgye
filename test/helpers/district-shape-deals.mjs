/**
 * 자치구 관찰 조합 합성 입력(#813). 실데이터를 읽지 않고, 원하는 관찰 키만 켜지는 거래 파일을 만든다.
 *
 * 바탕(아무 키도 안 켜짐 = typical): 한 동이 30%(몰림 40%·흩어짐 20% 어느 쪽도 아님), 전용 70㎡(소형 60·대형 85 어느 쪽도 아님),
 * 준공 15년(노후 30·신축 5 어느 쪽도 아님), 단지 스물다섯 곳에 고르게(한 단지 ≤3% < 5%), 직거래 없음.
 * 키마다 그 축 하나만 문턱 너머로 민다 - concentrated 한 동 50%, spreadOut 열 개 동에 10%씩, smallHeavy 전부 50㎡, largeHeavy 전부 100㎡,
 * old 준공 35년, fresh 준공 2년, oneComplex 첫 10%가 한 동 한 단지, directHeavy 다섯 건에 하나 직거래.
 * 연도는 updatedAt 에서 읽으므로(districtFacts) 날짜가 고정이면 결과도 고정이다.
 */
export const SHAPE_UPDATED_AT = "2026-08-20T00:00:00.000Z";

export function shapeDeals(keys, { updatedAt = SHAPE_UPDATED_AT, n = 200 } = {}) {
  const on = new Set(keys);
  const year = new Date(updatedAt).getUTCFullYear();
  const block = n / 10;
  const dongOf = (i) =>
    on.has("concentrated") ? (i < n / 2 ? "몰린동" : `흩어진동${i % 9}`)
      : on.has("spreadOut") ? `흩어진동${Math.floor(i / block)}`
        : i < n * 0.3 ? "몰린동" : `흩어진동${i % 9}`;
  const deals = [];
  for (let i = 0; i < n; i += 1) {
    deals.push({
      dong: dongOf(i),
      // 첫 10% 는 어느 모드에서도 같은 동(i=0 의 동)이라 oneComplex 면 한 단지 10%다.
      apt: on.has("oneComplex") && i < block ? "큰단지" : `단지${i % 25}`,
      area: on.has("smallHeavy") ? 50 : on.has("largeHeavy") ? 100 : 70,
      floor: 5,
      amount10k: 100000 + i,
      date: "2026-08-01",
      buildYear: year - (on.has("old") ? 35 : on.has("fresh") ? 2 : 15),
      direct: on.has("directHeavy") && i % 5 === 0,
    });
  }
  return { deals, updatedAt, periods: ["202606", "202607", "202608"] };
}
