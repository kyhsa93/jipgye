// 임시 사본·캐시 정리 (#263). 이 도구가 만드는 디렉터리는 셋이다.
//   snap-*            `--src` 스냅숏(pristine). 렌더가 끝나면 지우는 것이 기본이다.
//   sha-<전체 SHA>    `git archive` 캐시. 같은 SHA를 다시 쓰려고 남기되 개수 상한을 둔다.
//   jipgye-render-*   렌더 한 번의 작업 사본(`os.tmpdir()`). 렌더마다 지운다.
// 이슈 #263의 사고: `--src` 변형 비교가 snap-* 69개(약 20GB)를 쌓아 디스크가 찼다. 한 사본이 약 290MB다.
// 이 모듈은 (1) 시작 전 디스크 점검 (2) 신호·예외에서의 정리 (3) 처리 못 하는 종료(SIGKILL·ENOSPC)가 남긴 고아 정리
// (4) SHA 캐시 상한을 맡는다. 파일을 만들고 지우는 쪽(render.ts)은 여기 함수를 부르기만 한다.
import type { ChildProcess } from "node:child_process";
import { readdir, readFile, lstat, rename, rm, stat, statfs, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const GiB = 1024 ** 3;
const HOUR = 3600 * 1000;

/** 사본 한 폴더의 주인 표지. 안의 pid가 살아 있으면 고아 정리가 건드리지 않는다. */
export const OWNER = ".golden-owner";

// 상한·문턱의 기본값. 모두 환경변수로 바꿀 수 있어야 시험이 된다(cpo 체크리스트 iii).
//   GOLDEN_MIN_FREE_GB     시작 전 디스크 여유 문턱(GiB, 기본 5). 캐시 폴더와 렌더 사본 폴더를 둘 다 본다.
//   GOLDEN_CACHE_MAX_SHA   `sha-*` 캐시를 몇 개까지 둘지(기본 8 ≈ 2.3GB: 한 개 약 290MB, #263 측정).
//   GOLDEN_CACHE_GRACE_MIN 이 시간 안에 쓴 캐시는 상한을 넘어도 지우지 않는다(분, 기본 10) — 다른 실행이 쓰는 중일 수 있다.
//   GOLDEN_ORPHAN_HOURS    이 시간 넘은 snap-*·jipgye-render-*를 시작 때 지운다(시간, 기본 24).
const num = (env: NodeJS.ProcessEnv, name: string, dflt: number) => {
  if (env[name] === undefined || env[name] === "") return dflt;
  const v = Number(env[name]);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${name}=${env[name]}는 0 이상의 숫자가 아닙니다`);
  return v;
};

/** 디스크 문턱·정리 상한 넷. 전부 숫자다(minFreeBytes·graceMs·orphanMs는 바이트·밀리초). */
export interface Limits {
  minFreeBytes: number;
  maxShaCaches: number;
  graceMs: number;
  orphanMs: number;
}

/** `statfs`와 같은 모양에서 쓰는 두 필드만 든 시험 주입용 함수 모양. */
export type StatfsFn = (path: string) => Promise<{ bsize: number | bigint; bavail: number | bigint }>;

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): Limits {
  return {
    minFreeBytes: num(env, "GOLDEN_MIN_FREE_GB", 5) * GiB,
    maxShaCaches: num(env, "GOLDEN_CACHE_MAX_SHA", 8),
    graceMs: num(env, "GOLDEN_CACHE_GRACE_MIN", 10) * 60 * 1000,
    orphanMs: num(env, "GOLDEN_ORPHAN_HOURS", 24) * HOUR,
  };
}

/** 호출자가 준 옵션(undefined는 건너뜀)이 환경변수 값을 덮는다. */
export function resolveLimits(opts: Partial<Limits> = {}, env: NodeJS.ProcessEnv = process.env): Limits {
  const out = limitsFromEnv(env);
  for (const k of Object.keys(out)) if (opts[k] !== undefined) out[k] = opts[k];
  return out;
}

// `--keep`으로 남긴 스냅숏은 영영 남기면 또 쌓이므로 7일 뒤에는 고아와 같이 지운다.
const KEPT_MS = 7 * 24 * HOUR;

// ---------------------------------------------------------------- 디스크 점검

export class DiskSpaceError extends Error {
  constructor(message) {
    super(message);
    this.name = "DiskSpaceError";
  }
}

const fmtGiB = (b) => `${(b / GiB).toFixed(1)}GiB`;

async function nearestExisting(p) {
  let cur = path.resolve(p);
  for (;;) {
    try {
      await stat(cur);
      return cur;
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return cur;
      cur = up;
    }
  }
}

/**
 * paths의 여유(`statfs`의 bavail × bsize)가 하나라도 minFreeBytes 미만이면 DiskSpaceError.
 * 아직 없는 폴더는 있는 가장 가까운 윗 폴더를 본다. statfsFn은 시험이 여유를 흉내 낼 때 쓴다.
 */
export async function assertDiskSpace(paths: Iterable<string>, { minFreeBytes = 5 * GiB, statfsFn = statfs }: { minFreeBytes?: number; statfsFn?: StatfsFn } = {}) {
  for (const p of new Set(paths)) {
    const probe = await nearestExisting(p);
    const s = await statfsFn(probe);
    const free = Number(s.bavail) * Number(s.bsize);
    if (free < minFreeBytes) {
      throw new DiskSpaceError(
        `디스크 여유가 모자라 렌더를 시작하지 않습니다: ${p} 여유 ${fmtGiB(free)} < 문턱 ${fmtGiB(minFreeBytes)}. ` +
          `임시 사본을 지우거나(예: ${path.join(os.tmpdir(), "jipgye-golden")}) 문턱을 GOLDEN_MIN_FREE_GB로 조정하세요.`
      );
    }
  }
}

// ---------------------------------------------------------------- 주인 표지·고아 정리

export async function writeOwner(dir, extra = {}) {
  await writeFile(path.join(dir, OWNER), JSON.stringify({ pid: process.pid, createdAt: Date.now(), ...extra }));
}

async function readOwner(dir) {
  try {
    const o = JSON.parse(await readFile(path.join(dir, OWNER), "utf8"));
    return typeof o?.pid === "number" ? o : null;
  } catch {
    return null;
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** 다른 실행과 겹쳐도 한 번에 사라져 보이게: 먼저 이름을 바꾼 뒤 지운다(지우는 도중의 반쪽 폴더를 남이 읽지 않는다). */
export async function removeDir(dir) {
  const trash = path.join(path.dirname(dir), `.trash-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await rename(dir, trash);
  } catch (e) {
    if (e.code === "ENOENT") return;
    await rm(dir, { recursive: true, force: true });
    return;
  }
  await rm(trash, { recursive: true, force: true });
}

/**
 * SIGKILL·ENOSPC 같은 처리 못 하는 종료가 남긴 고아를 시작 때 지운다(#263, cpo 체크리스트 ii).
 *   cacheDir 안: snap-*, sha-*.tmp-*(만들다 만 캐시), .trash-*  /  tmpRoot 안: jipgye-render-*
 * 지우는 조건: orphanMs(기본 24시간) 넘게 묵었고 주인 표지의 pid가 살아 있지 않다. 나이는 표지의 createdAt(없으면 ctime)이다 —
 * 폴더 mtime은 rsync -a가 원본의 시각으로 덮으므로 믿지 않는다. 표지 없는 옛 폴더는 ctime으로 같은 규칙을 탄다.
 * 실패는 삼킨다(정리는 최선, 렌더를 막지 않는다). 지운 경로를 돌려준다.
 */
export async function sweepOrphans({ cacheDir, tmpRoot, orphanMs, now = Date.now() }) {
  const targets = [
    [cacheDir, [/^snap-/, /^sha-[0-9a-f]+\.tmp-/, /^\.trash-/]],
    [tmpRoot, [/^jipgye-render-/]],
  ];
  const removed = [];
  for (const [root, patterns] of targets) {
    let names;
    try {
      names = await readdir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!patterns.some((re) => re.test(name))) continue;
      const dir = path.join(root, name);
      try {
        const st = await lstat(dir);
        if (!st.isDirectory()) continue;
        const owner = await readOwner(dir);
        if (owner && owner.pid !== undefined && isAlive(owner.pid)) continue;
        const age = now - (owner?.createdAt ?? st.ctimeMs);
        if (age < (owner?.kept ? Math.max(KEPT_MS, orphanMs) : orphanMs)) continue;
        await removeDir(dir);
        removed.push(dir);
      } catch {
        // 다른 실행이 먼저 지웠거나 권한 문제 — 넘어간다.
      }
    }
  }
  return removed;
}

// ---------------------------------------------------------------- SHA 캐시 상한·확정

const SHA_DIR = /^sha-[0-9a-f]{40,64}$/;

/** 캐시를 쓸 때마다 `.done`의 mtime을 지금으로 올린다 — atime은 믿지 못하므로 "최근 사용"은 이것으로만 기록한다. */
export async function touchCache(dir) {
  const t = new Date();
  await utimes(path.join(dir, ".done"), t, t).catch(() => {});
}

/**
 * 완성된 SHA 캐시(.done 있음)가 maxShaCaches개를 넘으면 `.done` mtime이 오래된 것부터 지운다.
 *   keep    — 지금 쓰는 캐시(방금 만든 것 포함)는 개수에 넣되 지우지 않는다.
 *   graceMs — 이 안에 쓴 것은 상한을 넘어도 남긴다(다른 실행이 그 사본을 복제하는 중일 수 있다).
 * 지운 경로를 돌려준다.
 */
export async function pruneShaCaches(cacheDir, { keep, maxShaCaches, graceMs, now = Date.now() }) {
  let names;
  try {
    names = await readdir(cacheDir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (!SHA_DIR.test(name)) continue;
    const dir = path.join(cacheDir, name);
    try {
      entries.push({ dir, mtime: (await stat(path.join(dir, ".done"))).mtimeMs });
    } catch {
      // .done이 없으면 만드는 중이거나 반쪽이다 — 상한 계산에도 정리에도 넣지 않는다(고아 정리·재생성 몫).
    }
  }
  const others = entries.filter((e) => e.dir !== keep).sort((a, b) => b.mtime - a.mtime);
  const keepCounted = entries.length - others.length; // keep이 완성된 캐시면 1, 아니면 0
  const room = Math.max(1, maxShaCaches) - keepCounted;
  const removed = [];
  for (const e of others.slice(room)) {
    if (now - e.mtime < graceMs) continue;
    await removeDir(e.dir).catch(() => {});
    removed.push(e.dir);
  }
  return removed;
}

/**
 * 임시 이름으로 다 만든 폴더를 최종 이름으로 확정한다(rename은 한 번에 일어난다).
 * 최종 이름이 이미 있으면(동시 실행이 먼저 확정) 내 것을 지우고 false — 호출자는 이미 있는 것을 쓴다.
 * `.done` 표지는 잠금이 아니라 "다 만들었다"는 표시일 뿐이므로, 만드는 도중 상태는 이 임시 이름에만 있다.
 */
export async function commitDir(tmp, final) {
  try {
    await rename(tmp, final);
    return true;
  } catch (e) {
    if (e.code === "ENOTEMPTY" || e.code === "EEXIST") {
      await rm(tmp, { recursive: true, force: true });
      return false;
    }
    throw e;
  }
}

// ---------------------------------------------------------------- 신호·예외 때 정리할 목록

const live = new Map();
const children = new Set<ChildProcess>();
let terminating = false;

/** 정리가 필요한 것(사본 폴더)을 등록한다. 돌려주는 함수로 등록을 푼다. */
export function track(disposer) {
  const key = Symbol("dispose");
  live.set(key, disposer);
  return () => live.delete(key);
}

export function trackChild(child) {
  children.add(child);
  child.once("close", () => children.delete(child));
}

export const isTerminating = () => terminating;

/** 중단 신호를 받은 뒤에는 새 사본을 만들지 않는다. */
export function assertNotTerminating() {
  if (terminating) throw new Error("중단 신호를 받아 정리 중입니다");
}

/** 등록된 사본을 전부 지우고 렌더 단계 자식 프로세스를 끝낸다. 여러 번 불러도 안전하다. */
export async function disposeAll() {
  for (const c of children) c.kill("SIGTERM");
  await Promise.allSettled([...live.values()].map((f) => f()));
}

/**
 * SIGINT·SIGTERM·SIGHUP을 받으면 등록된 사본을 지우고 128+신호 번호로 끝낸다.
 * 한계: `spawnSync`(rsync·cp·git)가 도는 동안은 이벤트 루프가 막혀 신호 처리가 그 호출이 끝난 뒤로 미뤄진다.
 */
export function installSignalHandlers({ exit = (code) => process.exit(code), signals = ["SIGINT", "SIGTERM", "SIGHUP"] } = {}) {
  for (const sig of signals) {
    process.once(sig, async () => {
      terminating = true;
      console.error(`${sig} 받음 — 임시 사본을 지우고 끝냅니다`);
      await disposeAll();
      exit(128 + os.constants.signals[sig]);
    });
  }
}
