// 빌드 시간(S3, cto 조건 5). 원본 코드로 잰다: segment 는 districtRows(…, { rounds }) 세 차원 + pairVerdicts(가격대·연식),
// direct 는 판정 구간마다 band(gaps, { rounds }). 후보 R 마다 3회(인자로 바꿀 수 있다) 재서 중앙값. 회차마다 후보를 돌아가며 잰다.
// 시작 때 1분 부하 평균이 코어 수의 절반을 넘으면 60초씩 최대 10번 기다린다(기다린 횟수를 찍는다). 그래도 넘으면 그대로 재고 그 사실을 찍는다.
// 인자: <OUT 폴더> <A|B> [회수]. 결과: 표준 출력 + OUT/time-909.json(analyze-909.mjs 가 읽는다).
import { network, assertNoKeys, finish, CANDIDATES, stat } from "./lib-909.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";

void network;
assertNoKeys({ quiet: true });
const [OUT, label, reps] = [path.resolve(process.argv[2]), process.argv[3], Number(process.argv[4] ?? 3)];
const dc = await import(new URL("../../scripts/district-change.ts", import.meta.url).href);
const inp = JSON.parse(await readFile(path.join(OUT, `input-909-${label}.json`), "utf8"));

const cores = os.cpus().length;
let waited = 0;
while (os.loadavg()[0] > cores / 2 && waited < 10) {
  waited += 1;
  await sleep(60_000);
}
const load0 = os.loadavg().map((x) => x.toFixed(2));
console.log(`[time ${label}] 시작 부하 ${load0.join(" ")} (코어 ${cores}, 기다림 ${waited}회${os.loadavg()[0] > cores / 2 ? ", 문턱 넘은 채 잼" : ""}) · node ${process.version}`);

const dims = Object.entries(inp.segment).map(([dim, xs]) => ({
  dim,
  byKey: new Map(xs.map((x) => [x.code, x.values])),
  defs: xs.map((x) => ({ code: x.code, name: x.code })),
}));
const segmentOnce = (rounds) => {
  const t = performance.now();
  const rows = {};
  for (const { dim, byKey, defs } of dims) rows[dim] = dc.districtRows(byKey, defs, { rounds });
  dc.pairVerdicts(rows.price);
  dc.pairVerdicts(rows.age);
  return performance.now() - t;
};
const directOnce = (rounds) => {
  const t = performance.now();
  for (const d of inp.direct) dc.band(d.values, { rounds });
  return performance.now() - t;
};

const ms = { segment: {}, direct: {} };
for (const R of CANDIDATES) ms.segment[R] = [], ms.direct[R] = [];
for (let r = 0; r < reps; r += 1) for (const R of CANDIDATES) {
  ms.segment[R].push(segmentOnce(R));
  ms.direct[R].push(directOnce(R));
}
const med = (a) => stat(a).median;
const result = { label, reps, cores, waited, load: { start: load0, end: os.loadavg().map((x) => x.toFixed(2)) }, segment: {}, direct: {} };
for (const R of CANDIDATES) {
  result.segment[R] = Math.round(med(ms.segment[R]));
  result.direct[R] = Math.round(med(ms.direct[R]));
  console.log(
    `[time ${label}] R=${R}: segment 중앙 ${result.segment[R]}ms (${ms.segment[R].map(Math.round).join(",")}) · ` +
      `direct 중앙 ${result.direct[R]}ms (${ms.direct[R].map(Math.round).join(",")})`
  );
}
console.log(`[time ${label}] 끝 부하 ${result.load.end.join(" ")}`);
await writeFile(path.join(OUT, "time-909.json"), JSON.stringify(result));
finish(`time ${label}`);
