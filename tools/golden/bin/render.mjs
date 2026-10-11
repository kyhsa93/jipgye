#!/usr/bin/env node
// 렌더 단계 여섯 개를 깨끗한 작업 사본에서 돌리고 docs/를 --out으로 복사한다. 저장소 작업 트리는 건드리지 않는다.
//   node bin/render.mjs --repo <저장소> [--sha <SHA>|--src <디렉터리>] --out <디렉터리>
//        [--env KEY=VAL ...] [--mock-now <ISO>] [--cache <디렉터리>]
// 예) TZ=Asia/Seoul·BUILD_NOW 고정: --env TZ=Asia/Seoul --env BUILD_NOW=2026-10-11T00:00:00Z
// 나중에 react와 비교할 때는 같은 pristine에서 --env JIPGYE_RENDERER=react를 더해 한 번 더 돌린다.
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { preparePristine, renderIsolated } from "../lib/render.mjs";

const argv = process.argv.slice(2);
const opt = { env: {} };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === "--env") {
    const [name, ...rest] = argv[++i].split("=");
    opt.env[name] = rest.join("=");
  } else if (k.startsWith("--")) opt[k.slice(2)] = argv[++i];
}
if (!opt.repo && !opt.src || !opt.out) {
  console.error("사용: node bin/render.mjs --repo <저장소> [--sha <SHA>|--src <디렉터리>] --out <디렉터리> [--env K=V] [--mock-now ISO]");
  process.exit(2);
}
const pristine = await preparePristine({ repo: opt.repo, sha: opt.sha, srcDir: opt.src, cacheDir: opt.cache });
const r = await renderIsolated(pristine, { env: opt.env, mockNow: opt["mock-now"] ?? null });
await rm(opt.out, { recursive: true, force: true });
await mkdir(path.dirname(path.resolve(opt.out)), { recursive: true });
await cp(r.docsDir, opt.out, { recursive: true });
await r.dispose();
console.log(JSON.stringify({ source: pristine.label, env: opt.env, mockNow: opt["mock-now"] ?? null, totalMs: Math.round(r.totalMs), timings: r.timings.map((t) => ({ stage: t.stage, ms: Math.round(t.ms) })), touchedOutsideDocs: r.touched.filter((f) => !f.startsWith("docs/")) }, null, 2));
