/**
 * 우리 구 전세, 보증금이 집값에 너무 가까운 칸은 얼마나 흔한가(#690 N8).
 *
 * 칸은 단지별 전세가율(complex-ratio.ts)과 같다 - 같은 단지 같은 전용면적에서 최근 여섯 달 매매·신규 전세를
 * 각각 중앙값으로 내어 나눈 값. 거기에 단지 가격 위치(complex-price-*.json)의 같은 칸 「1년 전 매매 중앙값」을 붙여
 * 그 칸의 매매값이 1년 새 내렸는지 본다. 두 값 모두 지수로 고치지 않은 신고값이다(yearAgo 가 고치지 않은 값이라 raw 와 견준다).
 *
 * 문턱은 새로 정하지 않는다: 칸은 MIN_DEALS_PER_SIDE(매매·전세 각 3건), 구 행은 MIN_CELLS(20칸). 미달 구는 칸 수만 남긴다.
 * 80% 는 질문 자체의 정의다(이슈 완료 조건 1). 칸 이름(단지명)은 결과에 남기지 않는다 - 구 집계만 낸다.
 * 이것은 위험 판정이나 보증 가입 기준이 아니다(화면 단서).
 */

import { MIN_CELLS, MIN_DEALS_PER_SIDE } from "./complex-ratio.ts";

/** 질문의 정의: 전세 보증금이 매매 중앙값의 80% 이상인 칸. */
export const HIGH_RATIO = 80;

export const THRESHOLDS = { dealsPerSide: MIN_DEALS_PER_SIDE, cells: MIN_CELLS, highRatio: HIGH_RATIO };

/** 비율은 분모가 MIN_CELLS 이상일 때만 낸다(PR #701 판정) - 1/1=100% 같은 값이 json 에 남지 않게. 건수는 그대로 둔다. */
const share = (part, whole) => (whole >= MIN_CELLS ? Math.round((part / whole) * 1000) / 10 : null);

/** 단지 가격 위치 파일의 칸을 「단지\u0000면적(소수 둘째 자리)」로 찾게 편다. 묶인 면적(areas)은 하나하나 같은 칸을 가리킨다. */
export function priceLookup(priceCells) {
  const out = new Map();
  for (const [apt, areas] of Object.entries<Record<string, { areas?: number[] }>>(priceCells ?? {})) {
    for (const [name, cell] of Object.entries(areas ?? {})) {
      for (const area of cell?.areas ?? [Number(name)]) out.set(`${apt.trim()}\u0000${Math.round(area * 100) / 100}`, cell);
    }
  }
  return out;
}

/**
 * 자치구 하나의 셈. entries 는 cellRatioEntries 결과({ key: "단지|면적", ratio }).
 * compared 는 1년 전 값이 붙어 견줄 수 있는 칸, fell 은 그중 지금 중앙값(raw)이 1년 전 중앙값보다 낮은 칸.
 */
export function districtCounts(entries, priceCells) {
  const lookup = priceLookup(priceCells);
  const counts = { cells: 0, compared: 0, high: 0, highCompared: 0, highFell: 0 };
  for (const { key, ratio } of entries ?? []) {
    const cut = key.lastIndexOf("|");
    const cell = lookup.get(`${key.slice(0, cut).trim()}\u0000${Math.round(Number(key.slice(cut + 1)) * 100) / 100}`);
    const before = cell?.yearAgo?.median;
    const comparable = before > 0 && cell?.raw > 0;
    const high = ratio >= HIGH_RATIO;
    counts.cells += 1;
    if (comparable) counts.compared += 1;
    if (!high) continue;
    counts.high += 1;
    if (!comparable) continue;
    counts.highCompared += 1;
    if (cell.raw < before) counts.highFell += 1;
  }
  return counts;
}

/** 표 한 행. 칸이 MIN_CELLS 에 못 미치면 비율을 내지 않고 칸 수만 둔다(「표본 부족(n=…)」). */
export function riskRow(counts) {
  const { cells, compared, high, highCompared, highFell } = counts;
  if (cells < MIN_CELLS) return { cells, short: true };
  return { cells, compared, high, highShare: share(high, cells), highCompared, highFell, fellShare: share(highFell, highCompared) };
}

/** 구별 셈을 받아 json 본문을 만든다. 서울 행은 미달 구의 칸까지 모두 더한 것이다. 칸이 하나도 없으면 null. */
export function buildRisk({ byDistrict, now, months = null }) {
  const total = { cells: 0, compared: 0, high: 0, highCompared: 0, highFell: 0 };
  const districts = {};
  for (const [name, counts] of Object.entries<typeof total>(byDistrict ?? {})) {
    for (const k of Object.keys(total)) total[k] += counts[k] ?? 0;
    districts[name] = riskRow(counts);
  }
  if (!total.cells) return null;
  return { updatedAt: now.toISOString(), months, min: THRESHOLDS, seoul: riskRow(total), districts };
}
