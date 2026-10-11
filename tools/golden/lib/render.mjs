// 렌더 단계 전체를 "깨끗한 작업 사본"에서 한 번 돌린다 (#236 범위 3).
//
// 왜 사본인가: prerender.mjs는 docs HTML을 읽어 같은 파일 위에 덮어쓴다. 같은 SHA에서 두 번 렌더하거나 legacy와
// react를 나란히 렌더하려면 매번 같은 출발점이 있어야 하고, 저장소 작업 트리의 docs/는 바뀌면 안 된다.
//   1. 출발점(pristine)을 한 번 만든다: `git archive <sha>`(커밋된 상태) 또는 작업 트리 스냅숏(미커밋 상태, rsync).
//   2. 렌더마다 pristine을 새 디렉터리로 복제한다(macOS는 APFS clone, Linux는 reflink → 비용이 거의 없다).
//   3. 복제본 안에서 렌더 단계를 순서대로 돌리고, 끝나면 docs/를 돌려준다. 저장소는 건드리지 않는다.
// #238의 shadow가 "같은 렌더 전 스냅숏"을 요구할 때 쓰는 것이 이 모양이다(srcDir 모드).
//
// 만든 사본은 지우는 길이 하나씩 있다(#263): pristine.dispose()·render.dispose(). `--src` 스냅숏(snap-*)은 dispose가 지우고,
// SHA 캐시(sha-*)는 개수 상한으로 정리한다. 신호·예외 때는 cleanup.mjs의 등록 목록이 같은 dispose를 대신 부른다.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listFiles } from "./compare.mjs";
import {
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
} from "./cleanup.mjs";

/** origin/main `daily-update.yml`의 "정적 HTML에 오늘 내용 심기" 단계(#236 범위 3, 6단계). */
export const RENDER_STAGES = [
  "scripts/prerender.mjs",
  "scripts/build-rate-pages.mjs",
  "scripts/build-news-pages.mjs",
  "scripts/build-budget-pages.mjs",
  "scripts/build-realestate-pages.mjs",
  "scripts/build-updated-stamp.mjs",
];

const MOCK_NOW = pathToFileURL(path.join(import.meta.dirname, "mock-date-now.mjs")).href;

// 렌더 결과를 흔드는 환경변수는 호출자가 명시한 것만 들어가게 상속에서 뺀다.
const SCRUB = ["BUILD_NOW", "JIPGYE_RENDERER", "GOLDEN_MOCK_NOW", "NODE_OPTIONS"];

/** 워크플로의 렌더 단계 줄(`node scripts/x.mjs`)을 읽는다. RENDER_STAGES와 어긋났는지 시험이 본다. */
export async function readWorkflowStages(workflowFile) {
  const text = await readFile(workflowFile, "utf8");
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes("정적 HTML에 오늘 내용 심기"));
  if (at < 0) throw new Error("워크플로에서 렌더 단계를 찾지 못했습니다");
  const out = [];
  for (const line of lines.slice(at + 1)) {
    const m = line.match(/^\s+node (scripts\/[\w.-]+\.mjs)\s*$/);
    if (m) out.push(m[1]);
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

/**
 * 출발점 만들기. { repo, sha } → 커밋된 상태, { srcDir } → 작업 트리 스냅숏(.git·node_modules 제외).
 * 반환: { dir, label, nodeModules, temporary, keep(), dispose() }
 *   label     — 보고에 적는 출처(SHA 또는 srcDir).
 *   temporary — true면 이 실행이 만든 일회용 스냅숏(snap-*)이다. dispose()가 지운다(keep()을 불렀으면 남긴다).
 *   keep()    — 스냅숏을 남긴다(`--keep`). 7일 뒤에는 고아 정리가 지운다. SHA 캐시에는 할 일이 없다.
 *   dispose() — 스냅숏이면 지운다. SHA 캐시는 남긴다(다음 실행이 재사용, 개수 상한으로만 정리).
 * 시작 때 하는 일(#263): 디스크 여유 점검(cacheDir·tmpRoot 둘, 문턱 미만이면 DiskSpaceError), 24시간 넘은 고아 정리.
 * 문턱·상한은 옵션(minFreeBytes·maxShaCaches·graceMs·orphanMs)이나 GOLDEN_* 환경변수로 준다(cleanup.mjs).
 */
export async function preparePristine({ repo, sha, srcDir, cacheDir = path.join(os.tmpdir(), "jipgye-golden"), tmpRoot = os.tmpdir(), statfsFn, ...limitOpts }) {
  // 상대경로(README 예: --repo ../..)로 받아도 node_modules 링크가 렌더 사본 안에서 끊기지 않게 절대경로로 바꾼다(#237: react 모드가 처음 읽었다).
  if (repo) repo = path.resolve(repo);
  if (srcDir) srcDir = path.resolve(srcDir);
  assertNotTerminating();
  const limits = resolveLimits(limitOpts);
  await assertDiskSpace([cacheDir, tmpRoot], { minFreeBytes: limits.minFreeBytes, statfsFn });
  await mkdir(cacheDir, { recursive: true });
  await sweepOrphans({ cacheDir, tmpRoot, orphanMs: limits.orphanMs });
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
  const dir = path.join(cacheDir, `sha-${full}`);
  if (existsSync(path.join(dir, ".done"))) {
    await touchCache(dir);
  } else {
    await buildShaCache({ repo, full, dir });
  }
  await pruneShaCaches(cacheDir, { keep: dir, ...limits });
  const nm = path.join(repo, "node_modules");
  return {
    dir,
    label: full,
    nodeModules: existsSync(nm) ? nm : null,
    temporary: false,
    touch: () => touchCache(dir),
    keep: async () => {},
    dispose: async () => {},
  };
}

// `.done`는 잠금이 아니다(둘이 동시에 같은 SHA를 만들면 서로의 rm·tar가 엇갈렸다, #263). 그래서 임시 이름(sha-<SHA>.tmp-XXXXXX)에
// 끝까지 만들고 `.done`을 찍은 뒤 rename으로 확정한다. 먼저 확정한 쪽이 이기고, 진 쪽은 자기 것을 지우고 이긴 쪽을 쓴다.
// `.done` 없이 최종 이름만 있는 폴더(옛 판이 만들다 만 것)는 먼저 치운다.
async function buildShaCache({ repo, full, dir }) {
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

function runStage(script, cwd, env, nodeArgs) {
  return new Promise((resolve, reject) => {
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
 *   env      — 이 렌더에 줄 환경변수(TZ·BUILD_NOW·JIPGYE_RENDERER 등). 상속된 같은 이름은 먼저 지운다.
 *   mockNow  — Date.now를 이 ISO 값으로 고정(--import로 미리 읽는다). BUILD_NOW 이전 코드와 견줄 때 쓴다.
 *   stages   — 기본 RENDER_STAGES.
 *   tmpRoot  — 작업 사본을 만들 폴더(기본 os.tmpdir()). minFreeBytes·statfsFn은 시작 전 디스크 점검의 문턱·시험용 주입(cleanup.mjs).
 * 반환: { workDir, docsDir, timings:[{stage,ms}], totalMs, touched:[rel], dispose() }
 *   touched — 렌더 단계가 쓰거나 만들거나 지운 파일(렌더 전후 크기·mtime 스냅숏 차이). docs/ 밖이 섞이면 격리를 다시 봐야 한다.
 * 사본(jipgye-render-*)은 dispose()가 지운다. 복제·단계가 예외로 끝나면 여기서 먼저 지우고 던진다(옛 판은 남겼다, #263).
 */
export async function renderIsolated(pristine, { env = {}, mockNow = null, stages = RENDER_STAGES, tmpRoot, minFreeBytes, statfsFn } = {}) {
  assertNotTerminating();
  const base = tmpRoot ?? os.tmpdir();
  await assertDiskSpace([base], { minFreeBytes: resolveLimits({ minFreeBytes }).minFreeBytes, statfsFn });
  await pristine.touch?.(); // 쓸 때마다 SHA 캐시의 최근 사용 시각을 올린다(오래 안 쓴 것부터 정리하려고)
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
    const full = { ...process.env };
    for (const k of SCRUB) delete full[k];
    Object.assign(full, { TZ: "UTC" }, env);
    const nodeArgs = [];
    if (mockNow) {
      full.GOLDEN_MOCK_NOW = mockNow;
      nodeArgs.push("--import", MOCK_NOW);
    }
    const before = await statSnapshot(workDir);
    const timings = [];
    for (const stage of stages) {
      assertNotTerminating();
      const { ms } = await runStage(stage, workDir, full, nodeArgs);
      timings.push({ stage, ms });
    }
    const after = await statSnapshot(workDir);
    const touched = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f)).sort();
    return {
      workDir,
      docsDir: path.join(workDir, "docs"),
      timings,
      totalMs: timings.reduce((s, t) => s + t.ms, 0),
      touched,
      dispose,
    };
  } catch (e) {
    await dispose();
    throw e;
  }
}
