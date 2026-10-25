// 렌더 단계 전체를 "깨끗한 작업 사본"에서 한 번 돌린다 (#236 범위 3).
//
// 왜 사본인가: prerender.ts는 docs HTML을 읽어 같은 파일 위에 덮어쓴다. 같은 SHA에서 두 번 렌더하거나 두 SHA를
// 나란히 렌더하려면 매번 같은 출발점이 있어야 하고, 저장소 작업 트리의 docs/는 바뀌면 안 된다.
//   1. 출발점(pristine)을 한 번 만든다: `git archive <sha>`(커밋된 상태) 또는 작업 트리 스냅숏(미커밋 상태, rsync).
//   2. 렌더마다 pristine을 새 디렉터리로 복제한다(macOS는 APFS clone, Linux는 reflink → 비용이 거의 없다).
//   3. 복제본 안에서 렌더 단계를 순서대로 돌리고, 끝나면 docs/를 돌려준다. 저장소는 건드리지 않는다.
// #238의 shadow가 "같은 렌더 전 스냅숏"을 요구할 때 쓰는 것이 이 모양이다(srcDir 모드).
//
// 만든 사본은 지우는 길이 하나씩 있다(#263): pristine.dispose()·render.dispose(). `--src` 스냅숏(snap-*)은 dispose가 지우고,
// SHA 캐시(sha-*)는 개수 상한으로 정리한다. 신호·예외 때는 cleanup.ts의 등록 목록이 같은 dispose를 대신 부른다.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listFiles } from "./compare.ts";
import {
  type Limits,
  type StatfsFn,
  assertDiskSpace,
  OWNER,
  assertNotTerminating,
  commitDir,
  pruneShaCaches,
  removeDir,
  resolveLimits,
  sweepOrphans,
  touchCache,
  track,
  trackChild,
  writeOwner,
} from "./cleanup.ts";

/** origin/main `daily-update.yml`의 "정적 HTML에 오늘 내용 심기" 단계(#236 범위 3, 5단계 — 금리 단계는 #577 C 에서 뺐다). 확장자는 렌더 때 사본에서 해소한다(`resolveStage`, #428). */
export const RENDER_STAGES = [
  "scripts/prerender.mjs",
  "scripts/build-news-pages.mjs",
  "scripts/build-budget-pages.mjs",
  "scripts/build-realestate-pages.mjs",
  "scripts/build-updated-stamp.mjs",
];

const MOCK_NOW = pathToFileURL(path.join(import.meta.dirname, "mock-date-now.ts")).href;

// 렌더 결과를 흔드는 환경변수는 호출자가 명시한 것만 들어가게 상속에서 뺀다.
const SCRUB = ["BUILD_NOW", "GOLDEN_MOCK_NOW", "NODE_OPTIONS"];

// 워크플로 줄의 스크립트 확장자는 .mjs 한 가지로 박지 않는다(#418, #316 0단계). 박아 두면 개명 순간 줄이 안 잡혀 단계 수가
// 예외 없이 줄어든다(render-pipeline을 .ts로 바꾸면 빈 배열).
const SCRIPT_LINE = /^\s+(?:run: )?node (scripts\/[\w.-]+\.(?:mjs|ts))\s*$/;
export const withoutExt = (file) => file.replace(/\.(?:mjs|ts)$/, "");

/**
 * 워크플로의 렌더 단계 줄(`node scripts/x.mjs`)을 읽는다. RENDER_STAGES와 어긋났는지 시험이 본다.
 * 워크플로가 `node scripts/render-pipeline.ts`(렌더 폴백, #238 F1 최소판) 한 줄로 부르면 그 저장소의 기본 단계(`RENDER_STEPS`)로 펼친다
 * (워크플로 파일 기준 `../../scripts/render-pipeline.ts`). 인자를 넘기는 호출은 이 시험의 대상이 아니다(daily-update는 기본 단계를 쓴다).
 */
export async function readWorkflowStages(workflowFile) {
  const text = await readFile(workflowFile, "utf8");
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes("정적 HTML에 오늘 내용 심기"));
  if (at < 0) throw new Error("워크플로에서 렌더 단계를 찾지 못했습니다");
  const out = [];
  for (const line of lines.slice(at + 1)) {
    const m = line.match(SCRIPT_LINE);
    if (m && withoutExt(m[1]) === "scripts/render-pipeline") {
      // 확장자는 워크플로가 적은 그대로 따른다(.mjs → .ts 개명 단계에서도 같은 코드가 읽는다, #418).
      const pipeline = path.resolve(path.dirname(workflowFile), "../..", m[1]);
      out.push(...(await import(pathToFileURL(pipeline).href)).RENDER_STEPS);
    } else if (m) out.push(m[1]);
    else if (/^\s+(run:|-)/.test(line) && out.length) break;
    else if (/^\s*$/.test(line) && out.length) break;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 실패(${r.status}): ${r.stderr || r.error}`);
  return r.stdout;
}

/** `preparePristine` 의 인자. repo+sha(커밋된 상태) 또는 srcDir(작업 트리 스냅숏) 중 하나를 준다. 나머지는 Limits 넷(문턱·상한)을 덮는 옵션이다. */
export interface PristineOptions extends Partial<Limits> {
  repo?: string;
  sha?: string;
  srcDir?: string;
  /** 이 실행의 작업 폴더(snap-*). 기본: GOLDEN_CACHE_DIR, 없으면 <tmp>/jipgye-golden. */
  cacheDir?: string;
  /** SHA 캐시(sha-<전체 SHA>) 폴더. 기본: cacheDir 를 명시했으면 그것, 아니면 GOLDEN_SHA_CACHE_DIR, 없으면 cacheDir. 여러 실행이 나눠 쓰는 공유 캐시를 켜는 자리다. */
  shaCacheDir?: string;
  tmpRoot?: string;
  statfsFn?: StatfsFn;
  /** true 면 이 SHA 의 렌더 결과(docs/)도 shaCacheDir 에 둔다. 기본: 공유 SHA 캐시를 켰을 때(shaCacheDir ≠ cacheDir)만. */
  cacheRenders?: boolean;
}

/**
 * 캐시 폴더 둘을 정한다(#605). 작업 폴더(snap-*)는 실행마다 따로 쓰는 것이 안전하고(다른 실행이 폴더째 지우면 도중에 rc=2 로 깨졌다),
 * SHA 캐시는 키가 전체 SHA 라 내용이 불변이므로 여러 실행이 나눠 써도 된다(원자적 rename 확정 — buildShaCache).
 *   cacheDir    명시 > GOLDEN_CACHE_DIR > <tmp>/jipgye-golden(예전 기본, CI 와 시험이 쓰는 모양 그대로)
 *   shaCacheDir 명시 > (cacheDir 를 명시했으면 cacheDir) > GOLDEN_SHA_CACHE_DIR > 작업 폴더
 */
export function resolveCacheDirs({ cacheDir, shaCacheDir }: { cacheDir?: string; shaCacheDir?: string } = {}, env: NodeJS.ProcessEnv = process.env, tmp = os.tmpdir()) {
  const work = path.resolve(cacheDir ?? (env.GOLDEN_CACHE_DIR || path.join(tmp, "jipgye-golden")));
  const sha = path.resolve(shaCacheDir ?? (cacheDir ? work : env.GOLDEN_SHA_CACHE_DIR || work));
  return { cacheDir: work, shaCacheDir: sha };
}

/** SHA 캐시 폴더 이름. 키는 **전체** SHA(40~64자 16진)뿐이다 — 줄임·ref 는 rev-parse 로 풀어 온 뒤에만 쓴다. */
export function shaCacheName(full: string): string {
  if (!/^[0-9a-f]{40,64}$/.test(full)) throw new Error(`SHA 캐시 키는 전체 SHA 여야 합니다: ${full}`);
  return `sha-${full}`;
}

/** `renderIsolated` 의 인자. */
export interface RenderOptions {
  env?: Record<string, string>;
  mockNow?: string | null;
  stages?: string[];
  tmpRoot?: string;
  minFreeBytes?: number;
  statfsFn?: StatfsFn;
}

/**
 * 출발점 만들기. { repo, sha } → 커밋된 상태, { srcDir } → 작업 트리 스냅숏(.git·node_modules 제외).
 * 반환: { dir, label, nodeModules, temporary, keep(), dispose() }
 *   label     — 보고에 적는 출처(SHA 또는 srcDir).
 *   temporary — true면 이 실행이 만든 일회용 스냅숏(snap-*)이다. dispose()가 지운다(keep()을 불렀으면 남긴다).
 *   keep()    — 스냅숏을 남긴다(`--keep`). 7일 뒤에는 고아 정리가 지운다. SHA 캐시에는 할 일이 없다.
 *   dispose() — 스냅숏이면 지운다. SHA 캐시는 남긴다(다음 실행이 재사용, 개수 상한으로만 정리).
 * 시작 때 하는 일(#263): 디스크 여유 점검(cacheDir·tmpRoot 둘, 문턱 미만이면 DiskSpaceError), 24시간 넘은 고아 정리.
 * 문턱·상한은 옵션(minFreeBytes·maxShaCaches·graceMs·orphanMs)이나 GOLDEN_* 환경변수로 준다(cleanup.ts).
 */
export async function preparePristine({ repo, sha, srcDir, cacheDir: cacheDirOpt, shaCacheDir: shaCacheDirOpt, cacheRenders: cacheRendersOpt, tmpRoot = os.tmpdir(), statfsFn, ...limitOpts }: PristineOptions) {
  const { cacheDir, shaCacheDir } = resolveCacheDirs({ cacheDir: cacheDirOpt, shaCacheDir: shaCacheDirOpt });
  // 상대경로(README 예: --repo ../..)로 받아도 node_modules 링크가 렌더 사본 안에서 끊기지 않게 절대경로로 바꾼다(#237: react 모드가 처음 읽었다).
  if (repo) repo = path.resolve(repo);
  if (srcDir) srcDir = path.resolve(srcDir);
  assertNotTerminating();
  const limits = resolveLimits(limitOpts);
  await assertDiskSpace([cacheDir, shaCacheDir, tmpRoot], { minFreeBytes: limits.minFreeBytes, statfsFn });
  await mkdir(cacheDir, { recursive: true });
  await sweepOrphans({ cacheDir, tmpRoot, orphanMs: limits.orphanMs });
  if (shaCacheDir !== cacheDir) {
    await mkdir(shaCacheDir, { recursive: true });
    await sweepOrphans({ cacheDir: shaCacheDir, tmpRoot: shaCacheDir, orphanMs: limits.orphanMs }); // 공유 캐시의 만들다 만 sha-*.tmp-*(주인이 죽은 것만)
  }
  if (srcDir) {
    const dir = await mkdtemp(path.join(cacheDir, "snap-"));
    let kept = false;
    const dispose = async () => {
      untrack();
      if (!kept) await removeDir(dir);
    };
    const untrack = track(dispose);
    try {
      await writeOwner(dir);
      run("rsync", ["-a", "--exclude=.git", "--exclude=node_modules", `--exclude=${OWNER}`, `${srcDir}/`, `${dir}/`]);
    } catch (e) {
      await dispose();
      throw e;
    }
    const nm = path.join(srcDir, "node_modules");
    return {
      dir,
      label: `dir:${srcDir}`,
      nodeModules: existsSync(nm) ? nm : null,
      temporary: true,
      keep: async () => {
        kept = true;
        untrack();
        await writeOwner(dir, { kept: true });
      },
      dispose,
    };
  }
  const full = run("git", ["-C", repo, "rev-parse", sha ?? "HEAD"]).trim();
  const dir = path.join(shaCacheDir, shaCacheName(full));
  if (existsSync(path.join(dir, ".done"))) {
    await touchCache(dir);
  } else {
    await buildShaCache({ repo, full, dir });
  }
  await pruneShaCaches(shaCacheDir, { keep: dir, ...limits });
  const cacheRenders = cacheRendersOpt ?? shaCacheDir !== cacheDir;
  if (cacheRenders) await pruneRenderCaches(shaCacheDir, { graceMs: limits.graceMs });
  const nm = path.join(repo, "node_modules");
  return {
    dir,
    label: full,
    nodeModules: existsSync(nm) ? nm : null,
    temporary: false,
    touch: () => touchCache(dir),
    renderCache: cacheRenders ? { dir: shaCacheDir, sha: full } : null,
    keep: async () => {},
    dispose: async () => {},
  };
}

// `.done`는 잠금이 아니다(둘이 동시에 같은 SHA를 만들면 서로의 rm·tar가 엇갈렸다, #263). 그래서 임시 이름(sha-<SHA>.tmp-XXXXXX)에
// 끝까지 만들고 `.done`을 찍은 뒤 rename으로 확정한다. 먼저 확정한 쪽이 이기고, 진 쪽은 자기 것을 지우고 이긴 쪽을 쓴다.
// `.done` 없이 최종 이름만 있는 폴더(옛 판이 만들다 만 것)는 먼저 치운다.
// 호출자가 `.done`을 보고 "없다"고 한 뒤 여기 들어서는 사이 남이 확정할 수 있다(#544). 그때 이미 확정된 것은 지우지 않고 쓴다 —
// 지우면 같은 SHA를 쓰던 다른 실행의 commitDir가 ENOTEMPTY로 졌다가 `.done`이 사라진 것을 보고 던진다.
export async function buildShaCache({ repo, full, dir }) {
  if (existsSync(path.join(dir, ".done"))) return;
  if (existsSync(dir)) await removeDir(dir);
  const tmp = await mkdtemp(`${dir}.tmp-`);
  const dispose = () => rm(tmp, { recursive: true, force: true });
  const untrack = track(dispose);
  try {
    await writeOwner(tmp);
    const tar = spawnSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", repo, full, tmp], { encoding: "utf8" });
    if (tar.status !== 0) throw new Error(`git archive 실패: ${tar.stderr}`);
    await rm(path.join(tmp, OWNER), { force: true });
    await mkdir(path.join(tmp, ".done"));
    await commitDir(tmp, dir);
  } catch (e) {
    await dispose();
    throw e;
  } finally {
    untrack();
  }
  if (!existsSync(path.join(dir, ".done"))) throw new Error(`SHA 캐시를 만들지 못했습니다: ${dir}`);
}

// ---------------------------------------------------------------- 렌더 결과 캐시(opt-in, #605)
// 기준(base) 렌더는 "기준 SHA + 같은 입력"이면 결과(docs/)가 같다(TZ=UTC·BUILD_NOW 고정). 공유 SHA 캐시를 켰을 때만 그 docs/ 를
// <shaCacheDir>/render-<전체 SHA>-<입력 지문16>/ 에 두고 다음 실행이 렌더 단계 없이 쓴다(렌더 약 10초 + 사본 복제를 아낀다).
// 지문 = 단계 목록·호출자가 준 환경·mockNow·고정되는 환경변수(JIPGYE_*·BUILD_*·TZ·LANG·LC_*)·Node 버전·플랫폼·그 SHA 의 package-lock.json.
// 한계: 지문에 없는 입력(예: 렌더가 읽는 저장소 밖 파일, 링크된 node_modules 의 실제 버전)이 바뀌면 낡은 결과를 줄 수 있다 — 그래서 opt-in 이다.
// 읽는 쪽은 docsDir 를 **읽기만** 해야 한다(쓰면 공유 캐시가 망가진다). 만들 때는 임시 이름(sha-<SHA>.tmp-render-*, 고아 정리가 치운다)에
// 다 만들고 `.done` 을 찍은 뒤 rename 으로 확정한다(동시에 만들면 먼저 확정한 쪽이 이긴다).
const RENDER_ENTRY = /^render-[0-9a-f]{40,64}-[0-9a-f]{16}$/;
const FIXED_ENV = /^(JIPGYE_|BUILD_|TZ$|LANG$|LC_)/;

/** 렌더 결과 캐시 폴더 이름(순수 함수 — 시험이 키를 본다). `inputs` 가 달라지면 이름이 달라진다. */
export function renderCacheName(full: string, inputs: unknown): string {
  shaCacheName(full); // 전체 SHA 검증
  const h = createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16);
  return `render-${full}-${h}`;
}

async function renderInputs(pristine, { stages, mockNow, env }: { stages: string[]; mockNow: string | null; env: Record<string, string> }, merged: NodeJS.ProcessEnv) {
  let lock = "";
  try {
    lock = createHash("sha256").update(await readFile(path.join(pristine.dir, "package-lock.json"))).digest("hex");
  } catch {}
  const fixed = Object.fromEntries(Object.entries(merged).filter(([k]) => FIXED_ENV.test(k)).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { stages, mockNow, env: Object.fromEntries(Object.entries(env).sort(([a], [b]) => (a < b ? -1 : 1))), fixed, node: process.version, platform: process.platform, lock };
}

/** 완성된 렌더 결과 캐시가 maxRenders(GOLDEN_CACHE_MAX_RENDER, 기본 16 ≈ 300MB)개를 넘으면 `.done` mtime 이 오래된 것부터 지운다(graceMs 안에 쓴 것은 남긴다). */
export async function pruneRenderCaches(cacheDir: string, { graceMs, maxRenders = Number(process.env.GOLDEN_CACHE_MAX_RENDER ?? 16), now = Date.now() }: { graceMs: number; maxRenders?: number; now?: number }) {
  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (!RENDER_ENTRY.test(name)) continue;
    try {
      entries.push({ dir: path.join(cacheDir, name), mtime: (await stat(path.join(cacheDir, name, ".done"))).mtimeMs });
    } catch {}
  }
  const removed = [];
  for (const e of entries.sort((a, b) => b.mtime - a.mtime).slice(Math.max(1, maxRenders))) {
    if (now - e.mtime < graceMs) continue;
    await removeDir(e.dir).catch(() => {});
    removed.push(e.dir);
  }
  return removed;
}

async function storeRender(entry: string, docsDir: string, touched: string[], sha: string) {
  await mkdir(path.dirname(entry), { recursive: true });
  const tmp = await mkdtemp(path.join(path.dirname(entry), `sha-${sha}.tmp-render-`));
  const dispose = () => rm(tmp, { recursive: true, force: true });
  const untrack = track(dispose);
  try {
    await writeOwner(tmp);
    await clone(docsDir, path.join(tmp, "docs"));
    await writeFile(path.join(tmp, "meta.json"), JSON.stringify({ touched, createdAt: Date.now() }));
    await rm(path.join(tmp, OWNER), { force: true });
    await mkdir(path.join(tmp, ".done"));
    if (existsSync(path.join(entry, ".done"))) await dispose(); // 깨진 항목이 아니라 남이 먼저 확정한 것이면 그쪽을 쓴다
    else {
      if (existsSync(entry)) await removeDir(entry); // .done 없는/깨진 옛 항목을 치운다
      await commitDir(tmp, entry);
    }
  } catch (e) {
    await dispose();
    throw e;
  } finally {
    untrack();
  }
}

async function clone(from, to) {
  const flags = process.platform === "darwin" ? ["-cR"] : process.platform === "linux" ? ["-R", "--reflink=auto"] : ["-R"];
  const r = spawnSync("cp", [...flags, from, to], { encoding: "utf8" });
  if (r.status !== 0) {
    const retry = spawnSync("cp", ["-R", from, to], { encoding: "utf8" });
    if (retry.status !== 0) throw new Error(`복제 실패: ${retry.stderr}`);
  }
}

async function statSnapshot(dir) {
  const map = new Map();
  for (const rel of await listFiles(dir, (f) => !f.startsWith("node_modules/"))) {
    const st = await stat(path.join(dir, rel));
    map.set(rel, `${st.size}:${st.mtimeMs}`);
  }
  return map;
}

/**
 * 목록에 적힌 단계 이름(`scripts/x.mjs`)을 작업 사본에서 실제 파일로 푼다(#428, #316 3단계 선행). 개명(.mjs → .ts)을 건너는 base·head 를
 * 같은 목록으로 굽기 위해서다. stem(`withoutExt`)이 같은 `.mjs`·`.ts` 중 사본에 있는 쪽을 돌리고, 둘 다 있으면 던지고, 둘 다 없으면
 * 이름 그대로 둔다(지금처럼 모듈 없음으로 죽는다).
 */
export function resolveStage(stage: string, workDir: string): string {
  const stem = withoutExt(stage);
  const found = [".mjs", ".ts"].map((ext) => stem + ext).filter((f) => existsSync(path.join(workDir, f)));
  if (found.length > 1) throw new Error(`렌더 단계 ${stem} 이 .mjs 와 .ts 로 둘 다 있습니다`);
  return found[0] ?? stage;
}

function runStage(script, cwd, env, nodeArgs) {
  return new Promise<{ stage: string; ms: number; log: string }>((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [...nodeArgs, script], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    trackChild(child); // 신호로 끝낼 때 단계 프로세스도 같이 끝낸다(사본을 지우는 중에 계속 쓰지 않게)
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const ms = performance.now() - t0;
      if (code !== 0) reject(new Error(`${script} 실패(종료 ${code}):\n${out.slice(-2000)}`));
      else resolve({ stage: script, ms, log: out });
    });
  });
}

/**
 * pristine을 새 작업 사본으로 복제해 렌더 단계를 돌린다.
 *   env      — 이 렌더에 줄 환경변수(TZ·BUILD_NOW 등). 상속된 같은 이름은 먼저 지운다.
 *   mockNow  — Date.now를 이 ISO 값으로 고정(--import로 미리 읽는다). BUILD_NOW 이전 코드와 견줄 때 쓴다.
 *   stages   — 기본 RENDER_STAGES.
 *   tmpRoot  — 작업 사본을 만들 폴더(기본 os.tmpdir()). minFreeBytes·statfsFn은 시작 전 디스크 점검의 문턱·시험용 주입(cleanup.ts).
 * 반환: { workDir, docsDir, timings:[{stage,ms}], totalMs, touched:[rel], dispose() }
 *   touched — 렌더 단계가 쓰거나 만들거나 지운 파일(렌더 전후 크기·mtime 스냅숏 차이). docs/ 밖이 섞이면 격리를 다시 봐야 한다.
 * 사본(jipgye-render-*)은 dispose()가 지운다. 복제·단계가 예외로 끝나면 여기서 먼저 지우고 던진다(옛 판은 남겼다, #263).
 */
export async function renderIsolated(pristine, { env = {}, mockNow = null, stages = RENDER_STAGES, tmpRoot, minFreeBytes, statfsFn }: RenderOptions = {}) {
  assertNotTerminating();
  const base = tmpRoot ?? os.tmpdir();
  await assertDiskSpace([base], { minFreeBytes: resolveLimits({ minFreeBytes }).minFreeBytes, statfsFn });
  await pristine.touch?.(); // 쓸 때마다 SHA 캐시의 최근 사용 시각을 올린다(오래 안 쓴 것부터 정리하려고)
  // 환경은 사본을 만들기 전에 정한다(렌더 결과 캐시의 지문이 이것을 본다).
  const full = { ...process.env };
  for (const k of SCRUB) delete full[k];
  Object.assign(full, { TZ: "UTC" }, env);
  let entry: string | null = null;
  if (pristine.renderCache) {
    entry = path.join(pristine.renderCache.dir, renderCacheName(pristine.renderCache.sha, await renderInputs(pristine, { stages, mockNow, env }, full)));
    if (existsSync(path.join(entry, ".done"))) {
      try {
        const meta = JSON.parse(await readFile(path.join(entry, "meta.json"), "utf8"));
        await touchCache(entry);
        return { workDir: entry, docsDir: path.join(entry, "docs"), timings: [] as { stage: string; ms: number }[], totalMs: 0, touched: meta.touched as string[], cached: true, dispose: async () => {} };
      } catch {
        await removeDir(entry).catch(() => {}); // 깨진 항목(meta 없음 등)은 쓰지 않고 치운 뒤 새로 렌더해 채운다
      }
    }
  }
  const root = await mkdtemp(path.join(base, "jipgye-render-"));
  const workDir = path.join(root, "work");
  const dispose = async () => {
    untrack();
    await removeDir(root);
  };
  const untrack = track(dispose);
  try {
    await writeOwner(root);
    await clone(pristine.dir, workDir);
    if (pristine.nodeModules && !existsSync(path.join(workDir, "node_modules"))) {
      await symlink(pristine.nodeModules, path.join(workDir, "node_modules"));
    }
    const nodeArgs = [];
    if (mockNow) {
      full.GOLDEN_MOCK_NOW = mockNow;
      nodeArgs.push("--import", MOCK_NOW);
    }
    const before = await statSnapshot(workDir);
    const timings = [];
    for (const stage of stages) {
      assertNotTerminating();
      const script = resolveStage(stage, workDir);
      const { ms } = await runStage(script, workDir, full, nodeArgs);
      timings.push({ stage, ms });
    }
    const after = await statSnapshot(workDir);
    const touched = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f)).sort();
    if (entry) await storeRender(entry, path.join(workDir, "docs"), touched, pristine.renderCache.sha).catch(() => {}); // 캐시는 최선 — 못 만들어도 렌더 결과는 그대로 돌려준다
    return {
      workDir,
      docsDir: path.join(workDir, "docs"),
      timings,
      totalMs: timings.reduce((s, t) => s + t.ms, 0),
      touched,
      cached: false,
      dispose,
    };
  } catch (e) {
    await dispose();
    throw e;
  }
}
