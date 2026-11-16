/**
 * 2년 전에 맺은 전세 계약의 보증금보다 지금 같은 칸 신규 전세 보증금이 낮은 칸은 얼마나 되나(#693 N11).
 * 순수 모듈 - 파일을 읽지도 쓰지도 않는다(읽기·쓰기는 build-reverse-jeonse.ts).
 *
 * 질문은 만기를 앞둔 세입자의 것이다: 「2년 전에 맺은 계약의 보증금(돌려받을 돈)만큼 지금 새로 들어오는 세입자가 내는가」.
 * 그래서 두 창의 줄 정의가 다르다(pm 판정 ①, #693 issuecomment-6908107066).
 *   - 2년 전 창: 순수 전세의 신규·갱신·계약구분 빈칸 전부(baseRows "all"). 갱신한 세입자도 만기가 돌아온다 - 그 창 순수 전세
 *     38,470줄 중 갱신이 14,282줄(37%)이다(b360dcfb, pm 판정). 갱신 보증금은 5% 상한이 걸린 값이라 이 쪽 값을 「시세」라 부르지
 *     않는다 - 「2년 전 계약 보증금」이다(DIRECTION 체크리스트 5).
 *   - 지금 창: 신규만(renewal-cells.ts newJeonse, #781). 계약구분 빈칸은 뺀다 - 빈칸 비율이 두 창에서 12.7% 대 4.9%로 달라
 *     (cto 계수, b360dcfb) 「신규+빈칸」으로 세면 신고 양식 차이가 비교에 섞인다.
 * 칸마다 신규·갱신이 섞인 비율이 달라서 칸의 격차는 같은 집의 시세 변화가 아니다. 개별 계약의 판정도 아니다 - 구 집계만 낸다.
 *
 * 문턱은 새로 정하지 않는다: 칸은 창마다 MIN_DEALS_PER_SIDE(3건), 구 행은 MIN_CELLS(20칸), 중앙값은 complex-ratio.ts 의 median.
 */

import { complexKey } from "./complex-id.ts";
import { areaGroups } from "./complex-price.ts";
import { MIN_CELLS, MIN_DEALS_PER_SIDE, median } from "./complex-ratio.ts";
import { RETENTION_MONTHS, shiftMonth, yearMonthOf } from "./realestate-slots.ts";
import { recentMonths } from "./realestate-source.ts";
// 같은 이름의 complex-ratio.ts newJeonse(「갱신」만 빼서 빈칸이 들어감, #910 판정 대상)와 헷갈리지 않게 별칭으로 받는다(cto 조건 2).
import { newJeonse as newJeonseRow } from "./renewal-cells.ts";

/** 2년 전 창 줄 정의. json 에 그대로 싣고 화면·method 가 이 값을 쓴다. */
export const BASE_ROWS = "all";

/** 창 하나의 달 수. 두 창이 같다. */
export const WINDOW_SPAN = 3;

export const THRESHOLDS = { perSide: MIN_DEALS_PER_SIDE, cells: MIN_CELLS };

/**
 * 실행 시각의 두 창: { base: [첫 달, 끝 달], now: [첫 달, 끝 달] }. 달은 KST 로 센다(yearMonthOf) - Daily 는 KST 1일 08:07,
 * UTC 로는 전달 말일에 돈다. 날짜를 코드에 박지 않는다.
 *   - base = 보관 창(RETENTION_MONTHS)의 앞 3개월 = M−23~M−21. 보관 상수에 묶여 「raw 창의 첫 3개월」을 따라간다 -
 *     곧 만기가 돌아오는 세입자가 계약한 때다. 정확히 24개월 전(M−27~M−25)은 raw 창에도 핀에도 없다.
 *   - now = 신고 기한(계약 후 30일)이 닫힌 최근 3개월 = M−4~M−2. 끝 달은 같은 장 빌더(build-district-change.ts·
 *     build-complex-price.ts·segment-change.ts)와 같은 shiftMonth(yearMonthOf(now), -2).
 * #586 판정 (c): 보관 창은 Daily 의 삭제 커밋으로 매달 밀리고, 두 창이 매달 한 달씩 함께 밀리는 것은 정해진 동작이다.
 * 가운데 달끼리 간격은 늘 19개월(M−22 ↔ M−3)이다.
 */
export function windowsOf(now: Date) {
  const kept = recentMonths(now, RETENTION_MONTHS);
  const nowEnd = shiftMonth(yearMonthOf(now), -2);
  return {
    base: [kept[0], kept[WINDOW_SPAN - 1]],
    now: [shiftMonth(nowEnd, -(WINDOW_SPAN - 1)), nowEnd],
  };
}

/** [첫 달, 끝 달]을 달 목록으로. */
export const monthsOf = ([first]: string[]) => Array.from({ length: WINDOW_SPAN }, (_, i) => shiftMonth(first, i));

/** 두 창의 여섯 달(2년 전 셋, 지금 셋 순서). 읽을 슬롯 목록이다. */
export const windowMonthsOf = (windows) => [...monthsOf(windows.base), ...monthsOf(windows.now)];

/** 줄의 계약월(YYYYMM). 줄이 어느 창에 드는지는 이 값으로 정한다 - 슬롯 이름이 아니다. */
export const dealMonthOf = (item) => `${item?.dealYear}${String(item?.dealMonth ?? "").padStart(2, "0")}`;

// renewal-cells.ts 와 같은 숫자 읽기 - 아래 jeonseRow 가 newJeonse 와 같은 줄에서 같은 값을 내야 해서다(동치는 시험이 고정한다).
const number = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return /^-?\d+$/.test(text) ? Number(text) : text === "" ? 0 : NaN;
};

/**
 * 2년 전 창의 줄: 순수 전세(월세 0·보증금 있음)면 계약구분을 보지 않고 받는다. newJeonse 에서 계약구분 관문만 뺀 것이라
 * newJeonse(x) 는 「계약구분이 신규면 jeonseRow(x), 아니면 null」과 같다(시험). 계약구분 문자열 비교는 여기 두지 않는다.
 */
export function jeonseRow(item, same = undefined) {
  const apt = String(item?.aptNm ?? "").trim();
  const area = Number(item?.excluUseAr);
  const deposit = number(item?.deposit);
  if (!apt || !(area > 0) || !(deposit > 0) || number(item?.monthlyRent) !== 0) return null;
  return { apt: complexKey(apt, item?.umdNm, same), area: Math.round(area * 100) / 100, deposit };
}

/**
 * 자치구 하나의 칸 짝: [{ base, now }](두 창 보증금 중앙값, 만원). 칸 = 단지 키(complex-id.ts) × 면적 묶음(complex-price.ts areaGroups).
 * 면적 묶음은 단지마다 두 창 줄을 합친 면적으로 한 번 만든다(cto 조건 3) - 창마다 따로 묶으면 묶음 경계와 이름이 갈라져
 * 같은 평형이 짝을 잃는다. 단지명 순서·평형 오름차순이라 출력이 입력 순서에 기대지 않는다.
 */
export function cellPairs(rentItems, windows, same = undefined) {
  const baseMonths = new Set(monthsOf(windows.base));
  const nowMonths = new Set(monthsOf(windows.now));
  const byApt = new Map();
  let baseRows = 0;
  let nowRows = 0;
  const add = (row, side) => {
    if (!byApt.has(row.apt)) byApt.set(row.apt, []);
    byApt.get(row.apt).push({ ...row, side });
  };
  for (const item of rentItems ?? []) {
    const month = dealMonthOf(item);
    if (baseMonths.has(month)) {
      const row = jeonseRow(item, same);
      if (!row) continue;
      add(row, "base");
      baseRows += 1;
    } else if (nowMonths.has(month)) {
      const row = newJeonseRow(item, same);
      if (!row) continue;
      add(row, "now");
      nowRows += 1;
    }
  }

  const cells = [];
  for (const [, rows] of [...byApt].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const label = areaGroups(rows);
    const groups = new Map();
    for (const row of rows) {
      const name = label.get(row.area);
      if (!groups.has(name)) groups.set(name, { base: [], now: [] });
      groups.get(name)[row.side].push(row.deposit);
    }
    for (const [, { base, now }] of [...groups].sort(([a], [b]) => a - b)) {
      if (base.length < MIN_DEALS_PER_SIDE || now.length < MIN_DEALS_PER_SIDE) continue;
      cells.push({ base: median(base), now: median(now) });
    }
  }
  return { cells, rows: { base: baseRows, now: nowRows } };
}

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * 칸 짝들의 한 행. 칸이 MIN_CELLS 에 못 미치면 값 없이 칸 수만(「표본 부족」, jeonse-risk.ts riskRow 와 같은 모양).
 *   fell     지금 신규 중앙값이 2년 전 계약 중앙값보다 낮은 칸(같으면 넣지 않는다)
 *   fellShare 그 칸의 비율(%)
 *   gap      내린 칸들의 격차 중앙값 - pct: (지금 ÷ 2년 전 − 1)×100(%), amount: 지금 − 2년 전(만원). 둘 다 0 보다 작다.
 *            내린 칸이 MIN_CELLS 에 못 미치면 null - 분모가 MIN_CELLS 미만인 값은 json 에 남기지 않는다(jeonse-risk.ts share, PR #701 판정).
 *            내린 칸이 한두 개인 구에서 「중앙값」은 단지 한 칸의 보증금 변화 그 자체다.
 */
export function pairRow(cells) {
  const n = cells.length;
  if (n < MIN_CELLS) return { cells: n, short: true };
  const fell = cells.filter((c) => c.now < c.base);
  const gap =
    fell.length >= MIN_CELLS
      ? {
          pct: round1(median(fell.map((c) => (c.now / c.base - 1) * 100))),
          amount: Math.round(median(fell.map((c) => c.now - c.base))),
        }
      : null;
  return { cells: n, fell: fell.length, fellShare: round1((fell.length / n) * 100), gap };
}

/**
 * 구별 원본을 받아 json 본문을 만든다. districts: [{ name, items, same, missing }](DISTRICTS 순서).
 * missing 인 구(여섯 슬롯 가운데 하나라도 없거나 ok:false)는 셈하지 않고 { missing: true } 만 둔다 - 일부 달로 세면
 * 그 구의 값이 빠진 달만큼 조용히 달라진다(cto 조건 6). 서울 행은 셈한 구의 모든 칸이다(표본 부족 구 포함).
 * 칸이 하나도 없으면 null.
 */
export function buildReverseJeonse({ districts, now }: { districts: { name: string; items?: unknown[]; same?: Set<string>; missing?: boolean }[]; now: Date }) {
  const windows = windowsOf(now);
  const all = [];
  const rows = { base: 0, now: 0 };
  const out = {};
  for (const { name, items, same, missing } of districts ?? []) {
    if (missing) {
      out[name] = { missing: true };
      continue;
    }
    const pairs = cellPairs(items, windows, same);
    rows.base += pairs.rows.base;
    rows.now += pairs.rows.now;
    all.push(...pairs.cells);
    out[name] = pairRow(pairs.cells);
  }
  if (!all.length) return null;
  return { updatedAt: now.toISOString(), windows, min: THRESHOLDS, baseRows: BASE_ROWS, rows, seoul: pairRow(all), districts: out };
}
