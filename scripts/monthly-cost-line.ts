import { escapeHtml } from "./html-escape.ts";
import { shiftMonth } from "./realestate-slots.ts";

/**
 * 전세 vs 월세 장의 「환산 월 비용(평균금리 가정)」 서울 전체 한 줄 — #621(#587 PR3). 판정: https://github.com/kyhsa93/jipgye/issues/587#issuecomment-6397183813
 *
 * docs/data/monthly-cost.json(scripts/build-monthly-cost.ts 가 쓴다)의 마지막 1년 변화 점을 빌드 때 구워 넣는다(인라인 JS 는 언어 전환 한 줄뿐).
 * 값은 파일의 숫자를 그대로 적는다(다시 반올림하지 않는다). 값 옆에는 95% 구간과 금리 몫·보증금 몫 분해를 항상 같이 적는다.
 * 칸(75칸) 값은 이 파일에 없고 여기서도 쓰지 않는다.
 *
 * 안전 폴백: 파일이 없거나, 모양이 어긋나거나(숫자가 아니거나 0 이하 비용·구간 없음), 마지막 점이 전환율 창 끝 달보다
 * STALE_MONTHS 넘게 오래됐으면 null — 줄을 아예 그리지 않는다(지어낸 값이나 0 을 내지 않는다).
 *
 * 문구(ko/en): po·cmo·cpo 판정 원문 그대로(https://github.com/kyhsa93/jipgye/pull/634#issuecomment-6398156677).
 * 「아직 계열이 아니」 구절은 점이 SERIES_POINTS 개 미만일 때만 붙인다.
 */

export const NAME = { ko: "환산 월 비용(평균금리 가정)", en: "Estimated monthly cost (at average rates)" };
/** 전환율 창 끝 달(conversion.json months 의 마지막)보다 이만큼 넘게 오래된 점은 낡은 것으로 본다. ECOS 두 계열은 1~2달 늦게 나온다. */
export const STALE_MONTHS = 4;
/** 1년 변화 점이 이만큼 모이면 「계열」이다(#586: 원본 29개월 = 202411~202703). */
export const SERIES_POINTS = 12;

const num = (v) => typeof v === "number" && Number.isFinite(v);
const ym = (v) => typeof v === "string" && /^\d{6}$/.test(v);
const signed = (v) => (v > 0 ? `+${v}` : String(v));
const dot = (m) => `${m.slice(0, 4)}.${m.slice(4)}`;

function sideOk(side, shareKey) {
  return (
    side &&
    num(side.cost10k) && side.cost10k > 0 &&
    num(side.baseCost10k) && side.baseCost10k > 0 &&
    num(side.yoy) && num(side.rateShare) && num(side[shareKey]) &&
    Array.isArray(side.ci) && side.ci.length === 2 && num(side.ci[0]) && num(side.ci[1]) && side.ci[0] <= side.ci[1]
  );
}

/** 그릴 수 있는 마지막 점과 점 개수. 못 그리면 null. refMonth: 전환율 창 끝 달(YYYYMM). */
export function latestPoint(data, refMonth) {
  const points = Array.isArray(data?.points) ? data.points : [];
  const point = points.at(-1);
  if (!point || !ym(point.month) || !ym(point.base) || !ym(refMonth)) return null;
  if (point.month < shiftMonth(refMonth, -STALE_MONTHS) || point.month > refMonth) return null;
  if (!sideOk(point.jeonse, "depositShare") || !sideOk(point.wolse, "levelShare")) return null;
  return { point, count: points.length };
}

const LINE = {
  ko: ({ point: p, count }) =>
    `${NAME.ko} · 서울 전체, ${dot(p.base)}→${dot(p.month)}: ` +
    `전세안 월 ${p.jeonse.baseCost10k}만원 → ${p.jeonse.cost10k}만원, ${signed(p.jeonse.yoy)}%(95% 구간 ${signed(p.jeonse.ci[0])}~${signed(p.jeonse.ci[1])}%; ` +
    `금리 몫 ${signed(p.jeonse.rateShare)}%, 보증금 몫 ${signed(p.jeonse.depositShare)}%). ` +
    `월세안 월 ${p.wolse.baseCost10k}만원 → ${p.wolse.cost10k}만원, ${signed(p.wolse.yoy)}%(95% 구간 ${signed(p.wolse.ci[0])}~${signed(p.wolse.ci[1])}%; ` +
    `금리 몫 ${signed(p.wolse.rateShare)}%, 보증금·월세 몫 ${signed(p.wolse.levelShare)}%). ` +
    `6개월 신규 계약 중앙값에 보증금 80% 대출·20% 자기 돈을 가정한 환산입니다. ` +
    `대출·예금 금리는 시장 평균이며, 개인이 지금 새로 받는 금리와 다릅니다. ` +
    `1년 변화 점 ${count}개 가운데 마지막 점이며${count < SERIES_POINTS ? " 아직 계열이 아니고" : ""}, 전망이 아닙니다.`,
  en: ({ point: p, count }) =>
    `${NAME.en}, all of Seoul, ${dot(p.base)}→${dot(p.month)}: ` +
    `jeonse ${p.jeonse.baseCost10k} → ${p.jeonse.cost10k} (10k KRW a month), ${signed(p.jeonse.yoy)}% (95% interval ${signed(p.jeonse.ci[0])}~${signed(p.jeonse.ci[1])}%; ` +
    `rate share ${signed(p.jeonse.rateShare)}%, deposit share ${signed(p.jeonse.depositShare)}%). ` +
    `Monthly rent ${p.wolse.baseCost10k} → ${p.wolse.cost10k}, ${signed(p.wolse.yoy)}% (95% interval ${signed(p.wolse.ci[0])}~${signed(p.wolse.ci[1])}%; ` +
    `rate share ${signed(p.wolse.rateShare)}%, deposit-and-rent share ${signed(p.wolse.levelShare)}%). ` +
    `Medians of six months of new contracts, assuming 80% of the deposit is borrowed and 20% is your own money. ` +
    `Loan and deposit rates are market averages, not the rate you would get on a new loan. ` +
    `The last of ${count} year-over-year points${count < SERIES_POINTS ? ", not yet a series" : ""}; not a forecast.`,
};

/** 한 줄의 글(ko/en). 못 그리면 null. */
export function monthlyCostText(data, refMonth) {
  const latest = latestPoint(data, refMonth);
  return latest ? { ko: LINE.ko(latest), en: LINE.en(latest) } : null;
}

/** 프리렌더 칸에 꽂을 마크업. 못 그리면 "" — 칸을 비워 둔다(null 이면 틀의 옛 내용이 남으므로 빈 글을 준다). */
export function monthlyCostLineHtml(data, refMonth) {
  const text = monthlyCostText(data, refMonth);
  if (!text) return "";
  return `<p class="updated" data-mc="ko">${escapeHtml(text.ko)}</p><p class="updated" data-mc="en" hidden>${escapeHtml(text.en)}</p>`;
}
