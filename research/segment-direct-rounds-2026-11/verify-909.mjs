// 동등 검사(cto 조건 3). 인자: <OUT 폴더> <A|B>. 하나라도 다르면 종료 1(멈춤) - 측정을 돌리지 않는다.
//  1. 판정에 들어가는 모든 구간(segment 칸 ≥ MIN_CELLS 인 구간, 직거래 판정 구간)에서 bandFast(values, 400, 20261001) 이
//     원본 band(values) 와 비트까지 같다(Object.is). 덧붙여 1,000번·씨앗 777 에서도 같아야 한다(#858 verify 와 같은 추가 확인).
//  2. bandFast 400번 끝값을 빌더 반올림(pct·round1)에 넣은 값과 pairsWithin 판정이 공개 파일의 low·high·pairs 와 같다.
import { network, assertNoKeys, finish, pct, round1, pairsWithin, CURRENT } from "./lib-909.mjs";
import { bandFast } from "../district-change-rounds-2026-11/fast-858.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

void network;
assertNoKeys({ quiet: true });
const [OUT, label] = [path.resolve(process.argv[2] ?? ""), process.argv[3]];
const dc = await import(new URL("../../scripts/district-change.ts", import.meta.url).href);
const inp = JSON.parse(await readFile(path.join(OUT, `input-909-${label}.json`), "utf8"));

let bad = 0;
let n = 0;
const same = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
const units = [
  ...Object.entries(inp.segment).flatMap(([dim, xs]) => xs.filter((x) => x.values.length >= inp.minCells.segment).map((x) => [`segment ${dim} ${x.code}`, x.values])),
  ...inp.direct.map((d) => [`direct ${d.unit}`, d.values]),
];
for (const [name, values] of units) {
  for (const [rounds, seed, orig] of [
    [CURRENT.rounds, CURRENT.seed, () => dc.band(values)],
    [1000, 777, () => dc.band(values, { rounds: 1000, seed: 777 })],
  ]) {
    n += 1;
    if (!same(bandFast(values, rounds, seed), orig())) {
      bad += 1;
      console.log(`  다름: ${name} ${rounds}번 씨앗 ${seed}`);
    }
  }
}
console.log(`[verify ${label}] bandFast = band (Object.is): 불일치 ${bad} / ${n} (구간 ${units.length}개 × {400번·씨앗 20261001, 1,000번·씨앗 777})`);

let pubBad = 0;
for (const [dim, xs] of Object.entries(inp.segment)) {
  const rows = xs.map((x) => {
    if (x.values.length < inp.minCells.segment) return { code: x.code, low: null, high: null };
    const [lo, hi] = bandFast(x.values, CURRENT.rounds, CURRENT.seed);
    return { code: x.code, low: pct(lo), high: pct(hi) };
  });
  rows.forEach((r, i) => {
    const pub = inp.public.segment[dim][i];
    if (r.code !== pub.code || r.low !== pub.low || r.high !== pub.high) {
      pubBad += 1;
      console.log(`  다름: segment ${dim} ${r.code} ${r.low}~${r.high} / 공개 ${pub.low}~${pub.high}`);
    }
  });
  if (inp.public.pairs[dim] && JSON.stringify(pairsWithin(rows)) !== JSON.stringify(inp.public.pairs[dim])) {
    pubBad += 1;
    console.log(`  다름: segment ${dim} 쌍 판정`);
  }
  if (!inp.public.pairs[dim] && dim !== "area") {
    pubBad += 1;
    console.log(`  다름: segment ${dim} 공개 쌍 없음`);
  }
}
for (const d of inp.direct) {
  const [lo, hi] = bandFast(d.values, CURRENT.rounds, CURRENT.seed);
  const pub = inp.public.direct[d.unit];
  if (round1(lo) !== pub.low || round1(hi) !== pub.high) {
    pubBad += 1;
    console.log(`  다름: direct ${d.unit} ${round1(lo)}~${round1(hi)} / 공개 ${pub.low}~${pub.high}`);
  }
}
console.log(`[verify ${label}] 400번·지금 씨앗 끝값·쌍 판정 = 공개 파일: 불일치 ${pubBad}`);
if (bad || pubBad) {
  console.error(`멈춤: 입력 ${label} 동등 검사 실패`);
  process.exit(1);
}
finish(`verify ${label}`);
