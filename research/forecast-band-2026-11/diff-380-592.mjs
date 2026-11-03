// method·price-outlook 의 380/592 와 outlook.json 의 384/596 차이를 칸마다 대조한다(#819). 분위는 현행 q=0.10 뿐이다.
// 저장소 루트에서: node research/forecast-band-2026-11/diff-380-592.mjs
import { execFileSync } from "node:child_process";
import { coverageSummary, realtimeCoverage, toSeries } from "../../scripts/outlook.ts";

const REGIONS = ["200", "240", "250", "230"];
const read = (commit) => JSON.parse(execFileSync("git", ["show", `${commit}:raw/ecos/apt-price-index.json`], { encoding: "utf8", maxBuffer: 1 << 26 })).series;
const before = read("bf78f8f7~1");
const after = read("bf78f8f7");

for (const [name, index] of [["bf78f8f7~1", before], ["bf78f8f7", after]]) {
  const s = coverageSummary(REGIONS.map((code) => ({ code, series: toSeries(index[code]) })), 3);
  console.log(`${name}: 지수 끝 ${index["200"].at(-1)[0]}, 시점 ${s.from}~${s.to}, ${s.inside}/${s.origins}, 범위 안 개수 분포 ${s.countDist.join("·")}`);
}

let common = 0;
const flips = [];
const added = [];
for (const code of REGIONS) {
  const old = new Map(before[code]);
  const changed = after[code].filter(([month, value]) => old.has(month) && old.get(month) !== value);
  const largest = Math.max(0, ...changed.map(([month, value]) => Math.abs(old.get(month) - value)));
  console.log(`권역 ${code}: 겹치는 달 중 값이 바뀐 달 ${changed.length}개, 가장 큰 차이 ${largest.toFixed(1)}`);
  const was = new Map(realtimeCoverage(toSeries(before[code]), 3).map((row) => [row.origin, row.inside]));
  for (const row of realtimeCoverage(toSeries(after[code]), 3)) {
    if (!was.has(row.origin)) added.push(`${code}/${row.origin}=${row.inside ? "안" : "밖"}`);
    else {
      common += 1;
      if (was.get(row.origin) !== row.inside) flips.push(`${code}/${row.origin}`);
    }
  }
}
console.log(`겹치는 칸 ${common}개 중 안·밖이 바뀐 칸 ${flips.length}개${flips.length ? `: ${flips.join(" ")}` : ""}`);
console.log(`새로 생긴 칸 ${added.length}개: ${added.join(" ")}`);
