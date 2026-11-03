/**
 * 근거표 칸의 근거 코드 (#816 P1-1). 코드 + 측정값만 싣고 문장은 화면이 두 언어로 받는다. 판정 낱말은 코드에도 쓰지 않는다.
 *
 * checks 「확인할 것」: 표본이 적음(few_deals, 값은 n), 마지막 거래가 오래됨(stale_deal, 값은 경과일), 규제선 근처(reg_line, 값은 억). 예산 위로 걸치는지는 입력에 달려 화면이 본다.
 * position 「같은 값대에서의 위치」: 같은 값대·면적대 칸 수(peers_n)뿐이다. 그 안에서 몇 번째인지는 싣지 않는다 - 순위가 없다는 답과 부딪힌다(pm, #856).
 */

import { areaBand, cellField, apartmentField, GRADE, priceBand } from "./recommendation.ts";

/** 대출 상한이 바뀌는 선(loan-cap.ts). 그 선에 거래가 몰리므로 값 ±0.5억 칸에 확인 표시를 단다. */
export const REG_LINES = [15, 25];
const REG_MARGIN = 5_000;

export function checksOf({ n, age, median }) {
  const checks = [];
  if (n < GRADE.enoughDeals) checks.push(["few_deals", n]);
  if (age > GRADE.recentDays) checks.push(["stale_deal", age]);
  for (const line of REG_LINES) if (Math.abs(median - line * 10_000) <= REG_MARGIN) checks.push(["reg_line", line]);
  return checks;
}

/** 서울 전체 칸을 값대×면적대로 묶어 position 을 채운다. */
export function addPeers(files) {
  const [AREA, MEDIAN, POSITION] = ["areaSqm", "median", "position"].map(cellField);
  const CELLS = apartmentField("cells");
  const peers = new Map<string, unknown[][]>();
  for (const file of files) {
    for (const row of file.apartments) {
      for (const cell of row[CELLS]) {
        const key = `${priceBand(cell[MEDIAN])}|${areaBand(cell[AREA])}`;
        if (!peers.has(key)) peers.set(key, []);
        peers.get(key).push(cell);
      }
    }
  }
  for (const group of peers.values()) {
    for (const cell of group) cell[POSITION] = [["peers_n", group.length]];
  }
}
