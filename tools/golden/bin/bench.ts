#!/usr/bin/env node
// 렌더 단계 시간 기준선(#236 기준선 2, S4의 분모). 깨끗한 사본을 N번 새로 만들어 단계마다 시간을 재고
// 단계별·합계의 중앙값과 상한(최댓값)을 낸다. S4는 이 값 자체가 아니라 같은 실행에서 legacy·react를 함께 잰 비율이다.
//   node bin/bench.ts --repo <저장소> [--sha <SHA>] [--runs 10] [--env K=V ...]
// 첫 실행은 파일 캐시가 덜 데워져 있을 수 있어 `--warmup 1`(기본)로 한 번 돌리고 버린다.
import { DiskSpaceError, installSignalHandlers, isTerminating } from "../lib/cleanup.ts";
import { preparePristine, renderIsolated, RENDER_STAGES } from "../lib/render.ts";

const argv = process.argv.slice(2);
// 이름을 아는 옵션은 따로 적고, 나머지 `--이름 값`은 인덱스 시그니처로 받는다.
const opt: { env: Record<string, string>; runs: string; warmup: string; repo?: string; sha?: string; [flag: string]: string | Record<string, string> } = { env: {}, runs: "10", warmup: "1" };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--env") {
    const [k, ...v] = argv[++i].split("=");
    opt.env[k] = v.join("=");
  } else if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
}
if (!opt.repo) {
  console.error("사용: node bin/bench.ts --repo <저장소> [--sha <SHA>] [--runs 10] [--warmup 1] [--env K=V]");
  process.exit(2);
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
installSignalHandlers();
let pristine;
const runs = [];
let failed = false;
try {
  pristine = await preparePristine({ repo: opt.repo, sha: opt.sha });
  for (let i = 0; i < Number(opt.warmup); i++) await (await renderIsolated(pristine, { env: opt.env })).dispose();
  for (let i = 0; i < Number(opt.runs); i++) {
    const r = await renderIsolated(pristine, { env: opt.env });
    runs.push(r);
    await r.dispose();
  }
} catch (e) {
  failed = true;
  if (!isTerminating()) {
    // 신호로 끝나는 중이면 신호 처리기가 정리를 마치고 종료 코드를 정한다.
    console.error(e instanceof DiskSpaceError ? e.message : e.stack ?? e.message);
    process.exitCode = e instanceof DiskSpaceError ? 3 : 1;
  }
} finally {
  await pristine?.dispose(); // SHA 캐시는 남고(개수 상한으로 정리) --src 스냅숏이면 여기서 지운다
}
if (!failed) {
  const fmt = (xs) => ({ median: +(median(xs) / 1000).toFixed(3), max: +(Math.max(...xs) / 1000).toFixed(3), min: +(Math.min(...xs) / 1000).toFixed(3) });
  console.log(
    JSON.stringify(
      {
        source: pristine.label,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        runs: runs.length,
        warmup: Number(opt.warmup),
        stageSet: RENDER_STAGES.length,
        unit: "초",
        total: fmt(runs.map((r) => r.totalMs)),
        stages: Object.fromEntries(RENDER_STAGES.map((s, i) => [s, fmt(runs.map((r) => r.timings[i].ms))])),
        prerenderOnly: fmt(runs.map((r) => r.timings[0].ms)),
        totalPerRun: runs.map((r) => +(r.totalMs / 1000).toFixed(3)),
      },
      null,
      2
    )
  );
}
