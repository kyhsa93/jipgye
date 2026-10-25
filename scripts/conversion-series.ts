import { conversionPairs, median } from "./conversion.ts";
import { DISTRICTS } from "./realestate-districts.ts";

// 전월세전환율 월별 추이(#678 N7). conversion.json 의 cells 는 최근 6개월을 한 덩이로 묶은 한 점이고, 여기서는 같은 짝 규칙
// (conversionPairs: 같은 단지·면적대의 신규 전세-월세 짝)을 **달 하나씩** 따로 돌려 24개월 선을 만든다.

// 월 문턱: 한 달의 짝 수가 이보다 적으면 그 달의 rate 는 null 이다. **계산 전에 PR 본문에 고정한 값**이다(#678 판정).
// 근거는 raw/rent 24개월 계수(2026-10-26): 서울 월 짝 수 422~1,351, 자치구×월 600칸의 최솟값 3, 달마다 가운데 구의 짝 수 16~56이고,
// 10 미만은 14칸(2.3%)뿐이다. 6개월 묶음 cells 의 문턱 3(MIN_PAIRS)을 한 달에 그대로 쓰면 달마다 중앙값이 한두 단지 값으로
// 흔들리므로 10으로 올린다. 값을 바꾸려면 데이터를 본 뒤가 아니라 PR 본문 문턱부터 고친다.
export const MIN_MONTH_PAIRS = 10;

// 마지막 N개월은 아직 덜 찬 달이다: 마지막은 진행 중인 달이고, 그 앞 달은 계약 뒤 30일 신고 기한 때문에 늦은 신고가 계속 들어온다.
export const PARTIAL_MONTHS = 2;

const round2 = (value) => Math.round(value * 100) / 100;

function monthPoint(pairs, minPairs) {
  const n = pairs.length;
  return { rate: n >= minPairs ? round2(median(pairs.map((p) => p.rate))) : null, pairs: n };
}

/**
 * 달별 짝에서 서울 + 자치구의 월별 선을 만든다. 모양은 줄이려고 열 방향이다(26선×24달 객체로 쓰면 ≈25KB, 이쪽은 ≈7KB).
 *
 * months: 오래된 달 → 최근 달(YYYYMM). dealsByMonth: months 와 같은 길이, 달마다 그 달 슬롯에서 읽은 전월세 신고 배열.
 * 반환: { months, minPairs, partial[], seoul: { rate[], pairs[] }, districts: { 구이름: { rate[], pairs[] } } }
 * - rate: 그 달 짝 비율 중앙값(소수 둘째 자리). n<minPairs 이면 null. pairs: 그 달 짝 수(집계 수치 하나, 건별 값 아님).
 * - partial[i]: months[i] 가 덜 찬 달인가(마지막 partialMonths 개).
 * - districts 의 키는 자치구 이름 가나다순(결정적 출력). 신고가 한 건도 없는 구도 null 선으로 둔다(칸이 사라지지 않는다).
 */
export function buildSeries(dealsByMonth, months, { minPairs = MIN_MONTH_PAIRS, partialMonths = PARTIAL_MONTHS, districts = DISTRICTS } = {}) {
  if (!Array.isArray(months) || !months.length) throw new Error("series: months 가 비었습니다");
  if (!Array.isArray(dealsByMonth) || dealsByMonth.length !== months.length) throw new Error("series: 달 수와 신고 묶음 수가 다릅니다");

  const names = districts.map((d) => d.name).sort((a, b) => a.localeCompare(b, "ko"));
  const seoul = { rate: [], pairs: [] };
  const byDistrict = Object.fromEntries(names.map((name) => [name, { rate: [], pairs: [] }]));

  for (const deals of dealsByMonth) {
    const pairs = conversionPairs(deals);
    const total = monthPoint(pairs, minPairs);
    seoul.rate.push(total.rate);
    seoul.pairs.push(total.pairs);

    const grouped = new Map(names.map((name) => [name, []]));
    for (const pair of pairs) grouped.get(pair.district)?.push(pair);
    for (const name of names) {
      const point = monthPoint(grouped.get(name), minPairs);
      byDistrict[name].rate.push(point.rate);
      byDistrict[name].pairs.push(point.pairs);
    }
  }

  return {
    months: [...months],
    minPairs,
    partial: months.map((_, i) => i >= months.length - partialMonths),
    seoul,
    districts: byDistrict,
  };
}

/**
 * 소프트 실패 래퍼: 계산이 던지거나 서울 선에 값이 한 점도 없으면 null. 호출자는 null 이면 series 키를 아예 두지 않아
 * 기존 산출(cells·seoul·lead)이 그대로 나간다(#678 판정).
 */
export function trySeries(dealsByMonth, months, options = {}) {
  try {
    const series = buildSeries(dealsByMonth, months, options);
    return series.seoul.rate.some((rate) => rate != null) ? series : null;
  } catch (err) {
    console.log(`  전환율 월별 추이를 만들지 못했습니다 - 기존 전환율 데이터만 냅니다: ${err?.message ?? err}`);
    return null;
  }
}
