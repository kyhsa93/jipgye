/**
 * 근거표 칸의 근거 코드 (#816 P1-1). 코드 + 측정값만 싣고 문장은 화면이 두 언어로 받는다. 판정 낱말은 코드에도 쓰지 않는다.
 *
 * risks 「확인할 것」: 표본이 적음(few_deals, 값은 n), 마지막 거래가 오래됨(stale_deal, 값은 경과일), 규제선 근처(reg_line, 값은 억). 예산 위로 걸치는지는 입력에 달려 화면이 본다.
 * reasons 「같은 값대에서의 위치」: 같은 값대·면적대 칸 수(peers_n), 그 안에서 준공이 몇 번째로 최근인가(build_rank), 거래 수가 몇 번째인가(deals_rank).
 * 뒤 둘은 사실의 자리이고 목록의 순서가 아니다 - 이 값으로 줄을 세우거나 합치지 않는다.
 */

import { areaBand, cellField, apartmentField, GRADE, priceBand } from "./recommendation.ts";

/** 대출 상한이 바뀌는 선(loan-cap.ts). 그 선에 거래가 몰리므로 값 ±0.5억 칸에 확인 표시를 단다. */
export const REG_LINES = [15, 25];
const REG_MARGIN = 5_000;

export function risksOf({ n, age, median }) {
  const risks = [];
  if (n < GRADE.enoughDeals) risks.push(["few_deals", n]);
  if (age > GRADE.recentDays) risks.push(["stale_deal", age]);
  for (const line of REG_LINES) if (Math.abs(median - line * 10_000) <= REG_MARGIN) risks.push(["reg_line", line]);
  return risks;
}

/** 서울 전체 칸을 값대×면적대로 묶어 reasons 를 채운다. 동률은 같은 자리다(입력 순서에 안 기댄다). 준공을 모르는 칸은 build_rank 를 싣지 않는다. */
export function addPeers(files) {
  const [AREA, N, MEDIAN, REASONS] = ["areaSqm", "n", "median", "reasons"].map(cellField);
  const [YEAR, CELLS] = ["buildYear", "cells"].map(apartmentField);
  const peers = new Map<string, { n: number; year: number | null; cell: unknown[] }[]>();
  for (const file of files) {
    for (const row of file.apartments) {
      for (const cell of row[CELLS]) {
        const key = `${priceBand(cell[MEDIAN])}|${areaBand(cell[AREA])}`;
        if (!peers.has(key)) peers.set(key, []);
        peers.get(key).push({ n: cell[N], year: row[YEAR], cell });
      }
    }
  }
  for (const group of peers.values()) {
    for (const { n, year, cell } of group) {
      const reasons: [string, number][] = [["peers_n", group.length]];
      if (year !== null) reasons.push(["build_rank", 1 + group.filter((p) => p.year !== null && p.year > year).length]);
      reasons.push(["deals_rank", 1 + group.filter((p) => p.n > n).length]);
      cell[REASONS] = reasons;
    }
  }
}
