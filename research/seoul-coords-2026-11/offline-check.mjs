// 호출 없는 사전 점검(#847). 서울 API를 부르지 않고 저장소 안 K-apt 엑셀 2026-09-25분을 서울 행 자리에 넣어 겹침 계산을 돌린다.
//   node research/seoul-coords-2026-11/offline-check.mjs [--now 2026-11-03T00:00:00Z]
// 두 가지를 본다. 계산이 옛 값(지번 81.9%, 지번+도로명 89.1%)을 재현하는가. 도로명 경로가 K-apt 지번 없이 얼마나 닿는가.
// 좌표는 가짜 값이다. 그래서 「좌표까지」 칸은 좌표가 다 찼을 때의 값이다. 서울 실제 행(위키 2,893)은 엑셀 3,189보다 적어 이 값이 서울 값의 예측은 아니다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildIndex, foldRent, foldSale, measureOverlap, PATH_NAMES, windowCells } from "./measure.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const { values } = parseArgs({ options: { now: { type: "string" } } });
const now = values.now ? new Date(values.now) : new Date();

const seen = new Set();
const rows = [];
for (const row of JSON.parse(readFileSync(path.join(ROOT, "research/buyer-search-timing-2026-10/cache/kapt-seoul.json"), "utf8"))) {
  if (seen.has(row["단지코드"])) continue;
  seen.add(row["단지코드"]);
  rows.push({ APT_CD: row["단지코드"], APT_NM: row["단지명"], SGG_ADDR: row["시군구"], EMD_ADDR: row["동리"], APT_STDG_ADDR: row["법정동주소"], APT_RDN_ADDR: row["도로명주소"], XCRD: "127.0", YCRD: "37.5", USE_YN: "Y" });
}

const sale = foldSale(ROOT, now);
const rent = foldRent(ROOT);
const cells = windowCells(sale.inWindow, rent.same);
const { deals, cells: onCells } = measureOverlap(sale, cells, buildIndex(rows), rent);
const pct = (a, b) => `${((a / b) * 100).toFixed(2)}%`;
const live = sale.totals.live;
console.log(`입력: K-apt 엑셀 고유 코드 ${rows.length}, 호출 0회, 좌표는 가짜. 기준 ${now.toISOString().slice(0, 10)}, 창 ${sale.since}~`);
console.log(`분모: 거래 ${live}, n≥3 칸 ${cells.length}`);
for (const name of PATH_NAMES) {
  if (["jibunDaddr", "roadSeoul", "kaptExcelJibun"].includes(name)) continue; // 엑셀에 없는 칸이라 0으로만 나온다
  const d = deals[name];
  const c = onCells[name];
  console.log(`${name}: 거래 붙음 ${pct(d.attached.live, live)}, 하나로 풀림 ${pct(d.unique.live, live)}, 여러 코드 ${d.ambiguous.live}건 / n≥3 칸 하나로 풀림 ${c.unique} (${pct(c.unique, cells.length)}), 여러 코드 ${c.ambiguous}, 안 붙음 ${cells.length - c.attached}`);
}
