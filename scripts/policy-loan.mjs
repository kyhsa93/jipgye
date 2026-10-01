/**
 * 정책대출의 주택가격 선 - 이 예산이면 디딤돌·보금자리론 대상 집인가.
 *
 * 첫 집을 사는 사람의 후보 좁히기 질문이다(장면 3). 정책대출은 금리가 낮지만 주택가격에 선이 있어,
 * 그 선 아래에서 실제로 얼마나 거래되는지가 곧 "이 대출로 살 수 있는 집이 서울에 얼마나 있나"다.
 *
 * 소득·자산 요건과 대출 한도는 사람마다 달라 적지 않는다 - 소득에 갈리는 한도를 계산하지 않는 것과
 * 같은 이유다(DIRECTION 2부). 가격선만 기준일·출처와 함께 적고, 기준일이 6개월 넘으면 점검 봇이 원문
 * 재대조 이슈를 올린다(audit/HOWTO.md).
 *
 * 신생아 특례 디딤돌(9억 이하·85㎡)은 처음엔 원문으로 확인하지 못해 뺐다가, 마이홈포털 신생아 특례 디딤돌대출
 * 안내로 확인해 넣었다(2026-10-01, #31).
 */

export const BASIS_DATE = "2026-10-01";

export const SOURCES = [
  { name: "마이홈포털(국토교통부·LH) 내집마련 디딤돌대출", url: "https://www.myhome.go.kr/hws/portal/cont/selectSteppingStoneLoanView.do" },
  { name: "한국주택금융공사 보금자리론 설명서", url: "https://www.hf.go.kr/ko/sub01/sub01_01_02.do" },
  { name: "마이홈포털 신생아 특례 디딤돌대출", url: "https://www.myhome.go.kr/hws/portal/cont/selectBabySpecialCaseStepStoneLoneView.do" },
];

/** 만원. 디딤돌은 전용 85㎡ 이하만(서울은 수도권이라 예외 없음). */
export const LINES = {
  didimdol: { price: 50_000, priceFamily: 60_000, area: 85 },
  bogeumjari: { price: 60_000 },
  newborn: { price: 90_000, area: 85 },
};

/** 가격선에 걸친 예산대(4억대·5억대·6억대)에만 쓴다. */
export const PAGES = [3, 4, 5, 6, 7, 8, 9];

/** 최근 거래 가운데 각 선 아래에 든 수. deals: [{ amount, area }]. */
export function lineCounts(deals) {
  const n = deals.length;
  const didim = deals.filter((d) => d.amount <= LINES.didimdol.price && d.area <= LINES.didimdol.area).length;
  const family = deals.filter((d) => d.amount <= LINES.didimdol.priceFamily && d.area <= LINES.didimdol.area).length;
  const bogeum = deals.filter((d) => d.amount <= LINES.bogeumjari.price).length;
  const newborn = deals.filter((d) => d.amount <= LINES.newborn.price && d.area <= LINES.newborn.area).length;
  return { n, didim, family, bogeum, newborn };
}

const pct = (part, n) => `${Math.round((part / n) * 1000) / 10}%`;
const num = (v) => v.toLocaleString("ko-KR");

/**
 * 예산대 장 맨 위 "한눈에" 줄에 쓰는 짧은 판정. 문단(policySentence)과 같은 가격선에서 나온다.
 * 3억대 아래로는 예산대 장이 없고, 10억대 위로는 세 선을 모두 넘는다.
 */
export function policyShort(bandEok) {
  if (!Number.isFinite(bandEok)) return null;
  if (bandEok <= 4) return "디딤돌·보금자리론·신생아 특례 모두 가격선 안(전용 85㎡ 이하)";
  if (bandEok === 5) return "디딤돌 일반 선 밖, 신혼·2자녀 디딤돌과 보금자리론 선 안";
  if (bandEok < 9) return "신생아 특례 선(9억) 안(전용 85㎡ 이하), 다른 상품 선 밖";
  if (bandEok === 9) return "딱 9억 말고는 신생아 특례 선도 밖";
  return "정책대출 가격선을 모두 넘음";
}

export function policySentence(bandEok, counts, months = 6) {
  if (!PAGES.includes(bandEok) || !counts?.n) return null;
  const lines =
    "정책대출에는 주택가격 선이 있습니다. 디딤돌대출(주택도시기금)은 5억 이하(신혼·2자녀 이상 가구는 6억 이하)이면서 전용 85㎡ 이하, " +
    "보금자리론(한국주택금융공사)은 6억 이하, 신생아 특례 디딤돌(2년 내 출산 가구)은 9억 이하이면서 전용 85㎡ 이하입니다. ";
  const share =
    `최근 ${months}개월 서울 아파트 중개거래 ${num(counts.n)}건(직거래 제외) 가운데 디딤돌 일반 선 아래는 ${num(counts.didim)}건(${pct(counts.didim, counts.n)}), ` +
    `신혼·2자녀 선 아래는 ${num(counts.family)}건(${pct(counts.family, counts.n)}), 보금자리론 선 아래는 ${num(counts.bogeum)}건(${pct(counts.bogeum, counts.n)}), ` +
    `신생아 특례 선 아래는 ${num(counts.newborn ?? 0)}건(${pct(counts.newborn ?? 0, counts.n)})입니다. `;
  const here =
    bandEok <= 4
      ? `이 예산대(${bandEok}억대)는 전용 85㎡ 이하라면 디딤돌·보금자리론·신생아 특례 세 상품 모두 가격선 안입니다. `
      : bandEok === 5
        ? "이 예산대(5억대)에서 5억을 넘는 집은 디딤돌 일반 선 밖이고, 신혼·2자녀 가구 디딤돌과 보금자리론 선(6억) 안입니다. "
        : bandEok === 6
          ? "이 예산대(6억대)는 딱 6억인 집 말고는 디딤돌 일반·신혼과 보금자리론 선을 넘고, 신생아 특례 선(9억) 안입니다. "
          : bandEok < 9
            ? `이 예산대(${bandEok}억대)는 전용 85㎡ 이하라면 신생아 특례 선(9억) 안이고, 다른 두 상품의 선은 넘습니다. `
            : "이 예산대(9억대)는 딱 9억인 집 말고는 신생아 특례 선도 넘습니다. ";
  return (
    lines + here + share +
    `소득·자산 요건과 한도는 따로 있어 여기서는 가격선만 적습니다(신생아 특례도 수도권·규제지역은 LTV 70%). (마이홈포털·한국주택금융공사 기준, ${BASIS_DATE} 확인)`
  );
}
