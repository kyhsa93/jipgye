// 렌더 단계 전체를 "깨끗한 작업 사본"에서 한 번 돌린다 (#236 범위 3).
//
// 왜 사본인가: prerender.mjs는 docs HTML을 읽어 같은 파일 위에 덮어쓴다. 같은 SHA에서 두 번 렌더하거나 legacy와
// react를 나란히 렌더하려면 매번 같은 출발점이 있어야 하고, 저장소 작업 트리의 docs/는 바뀌면 안 된다.
//   1. 출발점(pristine)을 한 번 만든다: `git archive <sha>`(커밋된 상태) 또는 작업 트리 스냅숏(미커밋 상태, rsync).
//   2. 렌더마다 pristine을 새 디렉터리로 복제한다(macOS는 APFS clone, Linux는 reflink → 비용이 거의 없다).
//   3. 복제본 안에서 렌더 단계를 순서대로 돌리고, 끝나면 docs/를 돌려준다. 저장소는 건드리지 않는다.
// #238의 shadow가 "같은 렌더 전 스냅숏"을 요구할 때 쓰는 것이 이 모양이다(srcDir 모드).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listFiles } from "./compare.mjs";

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
 * 반환: { dir, label, nodeModules } — label은 보고에 적는 출처(SHA 또는 srcDir).
 */
export async function preparePristine({ repo, sha, srcDir, cacheDir = path.join(os.tmpdir(), "jipgye-golden") }) {
  await mkdir(cacheDir, { recursive: true });
  if (srcDir) {
    const dir = await mkdtemp(path.join(cacheDir, "snap-"));
    run("rsync", ["-a", "--exclude=.git", "--exclude=node_modules", `${srcDir}/`, `${dir}/`]);
    const nm = path.join(srcDir, "node_modules");
    return { dir, label: `dir:${srcDir}`, nodeModules: existsSync(nm) ? nm : null, temporary: true };
  }
  const full = run("git", ["-C", repo, "rev-parse", sha ?? "HEAD"]).trim();
  const dir = path.join(cacheDir, `sha-${full}`);
  if (!existsSync(path.join(dir, ".done"))) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const tar = spawnSync("sh", ["-c", `git -C "${repo}" archive ${full} | tar -x -C "${dir}"`], { encoding: "utf8" });
    if (tar.status !== 0) throw new Error(`git archive 실패: ${tar.stderr}`);
    await mkdir(path.join(dir, ".done")).catch(() => {});
  }
  const nm = path.join(repo, "node_modules");
  return { dir, label: full, nodeModules: existsSync(nm) ? nm : null, temporary: false };
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
 * 반환: { workDir, docsDir, timings:[{stage,ms}], totalMs, touched:[rel], dispose() }
 *   touched — 렌더 단계가 쓰거나 만들거나 지운 파일(렌더 전후 크기·mtime 스냅숏 차이). docs/ 밖이 섞이면 격리를 다시 봐야 한다.
 */
export async function renderIsolated(pristine, { env = {}, mockNow = null, stages = RENDER_STAGES, tmpRoot } = {}) {
  const root = await mkdtemp(path.join(tmpRoot ?? os.tmpdir(), "jipgye-render-"));
  const workDir = path.join(root, "work");
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
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
