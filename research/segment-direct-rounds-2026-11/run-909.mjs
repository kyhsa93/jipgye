// (입력, 횟수, 씨앗) 하나의 반올림 전 끝값을 OUT/<입력>-<횟수>-<씨앗>.json 에 쓴다. 인자: <OUT 폴더> <A|B> <R> <seed>
// segment 는 칸이 MIN_CELLS 이상인 구간 전부(면적대 포함 - 보조 지표), direct 는 판정 구간 전부.
import { network, assertNoKeys } from "./lib-909.mjs";
import { bandFast } from "../district-change-rounds-2026-11/fast-858.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

assertNoKeys({ quiet: true });
const [OUT, label, R, seed] = [path.resolve(process.argv[2]), process.argv[3], Number(process.argv[4]), Number(process.argv[5])];
if (!["A", "B"].includes(label) || !(R > 0) || !Number.isInteger(seed)) {
  console.error("쓰는 법: node run-909.mjs <OUT 폴더> <A|B> <R> <seed>");
  process.exit(1);
}
const inp = JSON.parse(await readFile(path.join(OUT, `input-909-${label}.json`), "utf8"));
const segment = {};
for (const [dim, xs] of Object.entries(inp.segment)) {
  segment[dim] = {};
  for (const x of xs) if (x.values.length >= inp.minCells.segment) segment[dim][x.code] = bandFast(x.values, R, seed);
}
const direct = Object.fromEntries(inp.direct.map((d) => [d.unit, bandFast(d.values, R, seed)]));
await writeFile(path.join(OUT, `${label}-${R}-${seed}.json`), JSON.stringify({ label, rounds: R, seed, segment, direct, network: network.calls }));
if (network.calls) process.exit(2);
