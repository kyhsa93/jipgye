#!/usr/bin/env node
// 렌더 단계 여섯 개를 깨끗한 작업 사본에서 돌리고 docs/를 --out으로 복사한다. 저장소 작업 트리는 건드리지 않는다.
//   node bin/render.ts --repo <저장소> [--sha <SHA>|--src <디렉터리>] --out <디렉터리>
//        [--env KEY=VAL ...] [--mock-now <ISO>] [--cache <디렉터리>] [--keep]
//   --src로 만든 스냅숏(snap-*)은 렌더가 끝나면(성공·실패·SIGINT·SIGTERM 모두) 지운다. 남기려면 --keep(경로를 출력에 적는다, 7일 뒤 고아 정리).
//   시작 전 디스크 여유가 5GiB 미만이면(GOLDEN_MIN_FREE_GB로 조정) 아무것도 만들지 않고 종료 3으로 멈춘다.
// 예) TZ=Asia/Seoul·BUILD_NOW 고정: --env TZ=Asia/Seoul --env BUILD_NOW=2026-10-11T00:00:00Z
// 나중에 react와 비교할 때는 같은 pristine에서 --env JIPGYE_RENDERER=react를 더해 한 번 더 돌린다.
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { DiskSpaceError, installSignalHandlers, isTerminating } from "../lib/cleanup.ts";
import { preparePristine, renderIsolated } from "../lib/render.ts";

const argv = process.argv.slice(2);
// 이름을 아는 옵션은 따로 적고(--keep 만 불리언), 나머지 `--이름 값`은 인덱스 시그니처로 받는다.
const opt: { env: Record<string, string>; keep?: boolean; repo?: string; sha?: string; src?: string; out?: string; cache?: string; stages?: string; "mock-now"?: string; [flag: string]: string | boolean | Record<string, string> } = { env: {} };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === "--env") {
    const [name, ...rest] = argv[++i].split("=");
    opt.env[name] = rest.join("=");
  } else if (k === "--keep") opt.keep = true;
  else if (k.startsWith("--")) opt[k.slice(2)] = argv[++i];
}
if (!opt.repo && !opt.src || !opt.out) {
  console.error("사용: node bin/render.ts --repo <저장소> [--sha <SHA>|--src <디렉터리>] --out <디렉터리> [--env K=V] [--mock-now ISO] [--keep]");
  process.exit(2);
}
installSignalHandlers();
let pristine;
let r;
try {
  pristine = await preparePristine({ repo: opt.repo, sha: opt.sha, srcDir: opt.src, cacheDir: opt.cache });
  if (opt.keep) await pristine.keep(); // 렌더 전에 정한다 — 중간에 끊겨도 남긴다
  r = await renderIsolated(pristine, { env: opt.env, mockNow: opt["mock-now"] ?? null, stages: opt.stages?.split(",") }); // --stages: 시험·진단용(기본은 RENDER_STAGES)
  await rm(opt.out, { recursive: true, force: true });
  await mkdir(path.dirname(path.resolve(opt.out)), { recursive: true });
  await cp(r.docsDir, opt.out, { recursive: true });
  console.log(
    JSON.stringify(
      {
        source: pristine.label,
        env: opt.env,
        mockNow: opt["mock-now"] ?? null,
        totalMs: Math.round(r.totalMs),
        timings: r.timings.map((t) => ({ stage: t.stage, ms: Math.round(t.ms) })),
        touchedOutsideDocs: r.touched.filter((f) => !f.startsWith("docs/")),
        keptSnapshot: opt.keep && pristine.temporary ? pristine.dir : null,
      },
      null,
      2
    )
  );
} catch (e) {
  // 신호로 끝나는 중이면 신호 처리기가 종료 코드를 정한다.
  if (!isTerminating()) {
    console.error(e instanceof DiskSpaceError ? e.message : e.stack ?? e.message);
    process.exitCode = e instanceof DiskSpaceError ? 3 : 1;
  }
} finally {
  // 렌더 사본은 항상, --src 스냅숏은 --keep이 아니면 지운다.
  await r?.dispose();
  await pristine?.dispose();
  if (opt.keep && pristine?.temporary) console.error(`스냅숏을 남겼습니다: ${pristine.dir}`);
}
