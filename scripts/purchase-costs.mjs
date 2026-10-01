/**
 * 매매가 말고 드는 돈 - 취득세와 그에 붙는 세금, 중개보수 상한.
 *
 * 예산대 화면은 "이 예산이면 어디까지, 매달 얼마"까지 답한다. 그런데 10억짜리 집을 사는
 * 사람은 10억만 내지 않는다. 그 위에 얹히는 돈을 같이 적어야 예산이 예산이 된다.
 *
 * 규칙은 전부 이 파일 하나에 기준일과 출처를 붙여 둔다. 세율과 요율은 해마다 바뀔 수 있고,
 * 바뀐 줄 모르고 옛 값을 자신 있게 적는 화면이 되는 것이 가장 나쁘다. 기준일이 6개월을 넘으면
 * 자동 점검 봇이 이슈를 올린다(audit/HOWTO.md) - 테스트로 막지 않는다. 날짜에 따라 갈리는
 * 검사는 그날 배포를 멈춘다(#8).
 *
 * 다루는 것은 <strong>집이 없던 사람이 한 채를 사는 경우</strong>뿐이다. 이미 집이 있는 사람이
 * 서울(조정대상지역)에서 한 채를 더 사면 취득세가 중과되어(지방세법 제13조의2, 2주택 8%)
 * 이 계산이 맞지 않는다 - 그렇다고 문장에 적는다. 법무사 보수·등기 비용·국민주택채권 할인은
 * 사람과 은행마다 달라 넣지 않는다.
 */

/** 원문을 마지막으로 대조한 날. */
export const BASIS_DATE = "2026-10-01";

export const SOURCES = [
  { name: "지방세법 제11조 제1항 제8호(주택 유상취득 세율), 제151조(지방교육세)", effective: "2026-01-01" },
  { name: "농어촌특별세법 제5조 제1항 제6호, 같은 법 시행령 제4조 제5항(국민주택 규모 이하 비과세)", effective: "2026-05-12" },
  { name: "공인중개사법 시행규칙 제20조, 별표 1(주택 중개보수 상한요율)", effective: "2026-08-28" },
];

const EOK = 10_000; // 만원

/**
 * 취득세율(%). 6억 이하 1%, 9억 초과 3%, 그 사이는 (가액 × 2/3억 - 3) × 1/100을
 * 소수점 이하 다섯째 자리에서 반올림한다(지방세법 제11조 제1항 제8호 나목).
 */
export function acquisitionRate(price10k) {
  if (price10k <= 6 * EOK) return 1;
  if (price10k > 9 * EOK) return 3;
  const fraction = ((price10k / (3 * EOK)) * 2 - 3) / 100;
  return Math.round(fraction * 10_000) / 100;
}

/** 지방교육세율(%). 주택 유상취득은 취득세율의 100분의 50에 100분의 20 - 취득세율의 10분의 1. */
export const educationRate = (price10k) => Math.round(acquisitionRate(price10k) * 0.5 * 0.2 * 10_000) / 10_000;

/** 농어촌특별세율(%). 표준세율 2%로 낸 취득세의 100분의 10. 전용 85㎡ 이하는 비과세. */
export const RURAL_RATE = 0.2;
export const RURAL_EXEMPT_AREA = 85;

/** 주택 매매 중개보수 상한(시행규칙 별표 1). 한쪽이 내는 몫. */
export const BROKER_BANDS = [
  { below: 0.5 * EOK, rate: 0.6, cap: 25 },
  { below: 2 * EOK, rate: 0.5, cap: 80 },
  { below: 9 * EOK, rate: 0.4, cap: null },
  { below: 12 * EOK, rate: 0.5, cap: null },
  { below: 15 * EOK, rate: 0.6, cap: null },
  { below: Infinity, rate: 0.7, cap: null },
];

export function brokerFee(price10k) {
  const band = BROKER_BANDS.find((b) => price10k < b.below);
  const fee = (price10k * band.rate) / 100;
  return { rate: band.rate, fee: band.cap === null ? fee : Math.min(fee, band.cap) };
}

/** 가격 하나의 부대비용(만원). over85면 농어촌특별세가 붙는다. */
export function purchaseCosts(price10k, { over85 = false } = {}) {
  const acqRate = acquisitionRate(price10k);
  const acquisition = (price10k * acqRate) / 100;
  const education = (price10k * educationRate(price10k)) / 100;
  const rural = over85 ? (price10k * RURAL_RATE) / 100 : 0;
  const broker = brokerFee(price10k);
  return {
    acqRate,
    acquisition,
    education,
    rural,
    brokerRate: broker.rate,
    broker: broker.fee,
    total: acquisition + education + rural + broker.fee,
  };
}

const man = (value10k) => {
  const n = Math.round(value10k);
  const eok = Math.floor(n / EOK);
  const rest = n % EOK;
  if (!eok) return `${rest.toLocaleString("ko-KR")}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString("ko-KR")}만원` : `${eok}억원`;
};

const pct = (value) => `${Number(value.toFixed(2))}%`;

/** 예산대 한 문단. 그 예산대의 가운데 값(예: 11억대면 11.5억)으로 계산한다. */
export function costsSentence(eok) {
  if (!Number.isFinite(eok)) return null;
  const price = (eok + 0.5) * EOK;
  const c = purchaseCosts(price);
  const withRural = purchaseCosts(price, { over85: true });
  return (
    `집이 없던 사람이 ${man(price)}짜리를 사면 매매가 위에 ` +
    `취득세 ${pct(c.acqRate)}와 지방교육세 ${pct(educationRate(price))}로 ${man(c.acquisition + c.education)}, ` +
    `중개보수 상한 ${pct(c.brokerRate)}로 ${man(c.broker)}, 합쳐 ${man(c.total)}이 더 듭니다. ` +
    `전용 85㎡를 넘으면 농어촌특별세 ${pct(RURAL_RATE)}(${man(withRural.rural)})가 붙어 ${man(withRural.total)}입니다. ` +
    `이미 집이 있는 사람이 한 채를 더 사면 서울은 취득세가 중과돼(2주택 8%) 이 계산이 맞지 않습니다. ` +
    `법무사·등기 비용과 국민주택채권 할인은 넣지 않았습니다. ` +
    `중개보수는 상한이라 협의로 낮출 수 있습니다. (지방세법·공인중개사법 시행규칙 원문 기준, ${BASIS_DATE} 확인)`
  );
}
