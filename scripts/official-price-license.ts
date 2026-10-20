/**
 * 공시가격 API(건축HUB 건축물대장, data.go.kr/data/15134735)의 이용허락 값 (#68 C3).
 *
 * 저장소 변수(OFFICIAL_PRICE_LICENSE·OFFICIAL_PRICE_LICENSE_CHECKED)로 받던 두 값을 코드 상수로 둔다
 * (소유자 지시 2026-10-11: 환경변수로 뺄 것까지는 아니다). 근거는 clo의 확인 기록이다:
 * https://github.com/kyhsa93/jipgye/issues/68#issuecomment-6103695893 (2026-10-11, 상세 페이지의 이용허락범위 "제한 없음").
 *
 * 갱신: 확인일에서 365일이 지나면(scripts/official-price-api.mjs의 LICENSE_MAX_AGE_DAYS) 수집이 쓰기 전에 멈추고
 * test/official-price-api.test.mjs의 "기본 이용허락 상수" 시험이 실패해 알린다. 그때 상세 페이지를 다시 보고
 * 이용허락범위가 그대로면 아래 확인일을 그날로 고쳐 PR로 올린다. 달라졌으면 값을 고치지 말고 소유자 결정을 요청한다.
 * 이 상수는 페이지가 실제로 바뀌는 것을 감지하지 못한다 - 사람이 다시 확인한 날짜의 기록일 뿐이다.
 */
export const OFFICIAL_PRICE_LICENSE = "제한 없음";
export const OFFICIAL_PRICE_LICENSE_CHECKED = "2026-10-11";
