/**
 * 재계약 확인기(#652 V3)의 칸 집계. 순수 모듈 - 파일을 읽지도 쓰지도 않는다(쓰기는 build-renewal-cells.ts).
 *
 * 세입자가 재계약 자리에서 묻는 것은 "우리 단지 이 평형은 갱신 때 얼마나 올렸나"다. 서울·자치구 집계(renewal-facts)로는
 * 그 칸이 안 보인다. 그래서 단지×평형 칸마다 갱신 인상률을 다섯 구간으로 세고, 계약갱신요구권을 쓴 줄과 사용 표시가 없는 줄로
 * 나눈다(#652 판정 3). 중앙값·평균은 내지 않는다 - 상한이 걸린 시장에서 평균은 법조문을 다시 읽는 것이다(DIRECTION 5,
 * renewal-facts.ts 머리 주석). 표본 계수(#652 data-analyst): 요구권 사용 줄은 0.3%만 5%를 넘고 표시 없는 줄은 42.5%가 넘는다 -
 * 두 줄을 섞으면 그 차이가 사라진다.
 *
 * 공개 단위는 칸 집계다. 건별 값·보증금 금액은 싣지 않는다(판정 7). 신규 쪽만 같은 평형 신규 전세의 중앙값과 건수를 싣는다(판정 3).
 */

import { areaGroups, MIN_DEALS } from "./complex-price.ts";
import { bandOf as areaBandOf } from "./conversion.ts";
import { MIN_DEALS_PER_SIDE, median } from "./complex-ratio.ts";
import { MIN_SAMPLE } from "./realestate-format.ts";

/** 인상률 구간(판정 3, 결과 보기 전 고정). 순서가 곧 화면 표의 열 순서다. */
export const BANDS = ["down", "frozen", "low", "near", "over"] as const;

const number = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return /^-?\d+$/.test(text) ? Number(text) : text === "" ? 0 : NaN;
};

/**
 * 종전→새 보증금(만원, 정수)의 구간. 경계는 소수 없이 정수끼리 견준다(판정 3: `dep×1000` vs `pre×1045/1050`) -
 * 4.5%·5.0% 같은 경계값이 부동소수 반올림으로 이웃 구간에 떨어지지 않게.
 *   인하 <0 · 동결 0 · 0 초과 4.5% 이하 · 상한 근처 4.5% 초과 5% 이하 · 5% 초과
 */
export function bandOf(deposit: number, preDeposit: number) {
  if (deposit < preDeposit) return "down";
  if (deposit === preDeposit) return "frozen";
  const scaled = deposit * 1000;
  if (scaled <= preDeposit * 1045) return "low";
  if (scaled <= preDeposit * 1050) return "near";
  return "over";
}

/**
 * 원본 한 줄을 갱신 짝으로. 순수 전세 갱신만이다(판정 3, v0): 갱신이라고 적혔고, 종전 보증금이 있고, 지금·종전 월세가 모두 0.
 * 반전세 짝은 보증금과 월세를 한 값으로 묶는 배수(전환율)를 가정해야 해서 뺀다(#652 계수: 82,170짝 v0 제외).
 */
export function renewalPair(item) {
  if (String(item?.contractType ?? "").trim() !== "갱신") return null;
  const apt = String(item?.aptNm ?? "").trim();
  const area = Number(item?.excluUseAr);
  const deposit = number(item?.deposit);
  const preDeposit = number(item?.preDeposit);
  if (!apt || !(area > 0) || !(deposit > 0) || !(preDeposit > 0)) return null;
  if (number(item?.monthlyRent) !== 0 || number(item?.preMonthlyRent) !== 0) return null;
  return {
    apt,
    // complex-price.ts marketDeal 과 같은 자리수 - 같은 묶음 함수(areaGroups)에 넣는다.
    area: Math.round(area * 100) / 100,
    rr: String(item?.useRRRight ?? "").trim() === "사용",
    band: bandOf(deposit, preDeposit),
  };
}

/** complex-ratio.ts 의 신규 전세 규칙(갱신 아님·월세 0·보증금 있음)과 같은 줄. 금액은 칸 중앙값으로만 나간다. */
export function newJeonse(item) {
  if (String(item?.contractType ?? "").trim() === "갱신") return null;
  const apt = String(item?.aptNm ?? "").trim();
  const area = Number(item?.excluUseAr);
  const deposit = number(item?.deposit);
  if (!apt || !(area > 0) || !(deposit > 0) || number(item?.monthlyRent) !== 0) return null;
  return { apt, area: Math.round(area * 100) / 100, deposit };
}

const emptyLine = () => ({ n: 0, down: 0, frozen: 0, low: 0, near: 0, over: 0 });

/** 짝들을 요구권 사용(rr)·표시 없음(other) 두 줄로 센다. */
export function countLines(pairs) {
  const rr = emptyLine();
  const other = emptyLine();
  for (const p of pairs) {
    const line = p.rr ? rr : other;
    line.n += 1;
    line[p.band] += 1;
  }
  return { n: pairs.length, rr, other };
}

/** 두 줄을 한 배열로: [요구권 사용 다섯 구간, 표시 없음 다섯 구간]. 줄 n·칸 n 은 합으로 나온다. */
export const packLines = ({ rr, other }) => [...BANDS.map((b) => rr[b]), ...BANDS.map((b) => other[b])];

/**
 * 자치구 하나의 파일 본문(updatedAt·window 는 부르는 쪽이 붙인다).
 *
 * 모양은 판정 7 의 이름 붙은 객체({n, rr:{n,down,…}, other:{…}})를 **위치 배열**로 줄인 것이다 - 이름 붙은 모양으로 쓰면
 * 강남구가 117KB 로 구 파일 한도 40KB 의 세 배였다(2026-10-25 원본, PR 본문 「일탈」). 뜻은 같다:
 *   cells[단지][평형] = [rr.down, rr.frozen, rr.low, rr.near, rr.over, other.down, …, other.over, nw.n, nw.median|null]
 *                       — 칸 n(= 앞 열 칸의 합) ≥ MIN_DEALS(3)일 때만.
 *   칸 n < 3 은 cells 에 싣지 않는다(판정 9 ④) - 그 짝들은 fallback 에만 든다. 건수만이라도 남기면 강남구 gzip 이 12.3KB 로
 *   한도 10KB 를 넘었다(남긴 칸 487개·그 칸만 가진 단지 224곳의 이름 값). 화면은 목록에 없는 단지·평형을 자치구×면적대로 본다.
 *   fallback[면적대] = 앞 열 칸(두 줄) — 자치구×면적대(conversion.ts AREA_BANDS, 기존 상수).
 * 칸 = 단지명×면적 묶음(complex-price.ts areaGroups 를 그대로 - 1㎡ 첫 면적 규칙, 판정 2). 평형 이름은 묶음 이름(거래가 가장 많은 면적).
 * nw = 같은 칸 면적들의 신규 전세 건수와 중앙값(만원, n ≥ MIN_DEALS_PER_SIDE 일 때만 - complex-ratio 와 같은 문턱, 아니면 null).
 */
export function districtCells(rentItems, newItems = []) {
  const byApt = new Map();
  for (const item of rentItems ?? []) {
    const pair = renewalPair(item);
    if (!pair) continue;
    if (!byApt.has(pair.apt)) byApt.set(pair.apt, []);
    byApt.get(pair.apt).push(pair);
  }
  const newByApt = new Map();
  for (const item of newItems ?? []) {
    const deal = newJeonse(item);
    if (!deal) continue;
    if (!newByApt.has(deal.apt)) newByApt.set(deal.apt, []);
    newByApt.get(deal.apt).push(deal);
  }

  const cells = {};
  const byBand = new Map();
  // 단지명 순서, 평형은 작은 것부터 - 완료 순서·삽입 순서가 출력 순서가 되지 않게(결정성).
  for (const [apt, pairs] of [...byApt].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const label = areaGroups(pairs);
    const groups = new Map();
    for (const p of pairs) {
      const name = label.get(p.area);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(p);
      const band = areaBandOf(p.area)?.key;
      if (band) {
        if (!byBand.has(band)) byBand.set(band, []);
        byBand.get(band).push(p);
      }
    }
    const shown = {};
    for (const [name, group] of [...groups].sort(([a], [b]) => a - b)) {
      if (group.length < MIN_DEALS) continue;
      const inCell = new Set(group.map((p) => p.area));
      const deposits = (newByApt.get(apt) ?? []).filter((d) => inCell.has(d.area)).map((d) => d.deposit);
      const nwMedian = deposits.length >= MIN_DEALS_PER_SIDE ? Math.round(median(deposits)) : null;
      shown[name] = [...packLines(countLines(group)), deposits.length, nwMedian];
    }
    if (Object.keys(shown).length) cells[apt] = shown;
  }

  const fallback = {};
  for (const band of ["under60", "60to85", "over85"]) {
    const pairs = byBand.get(band);
    if (pairs?.length) fallback[band] = packLines(countLines(pairs));
  }
  return { cells, fallback };
}

/** 화면이 쓰는 두 문턱. 화면에 새 숫자를 두지 않으려고 빌드가 기존 상수를 그대로 싣는다(판정 4·9 ⑧). */
export const THRESHOLDS = { show: MIN_DEALS, ratio: MIN_SAMPLE };
