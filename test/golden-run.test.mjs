import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/dev/golden-run.sh (#605): 실행마다 전용 작업 폴더(GOLDEN_CACHE_DIR)와 opt-in 공유 기준 캐시(GOLDEN_SHA_CACHE_DIR).
// 합성 저장소의 가짜 tools/golden/bin/invariants.ts 만 부른다 - 실제 렌더·골든·~/workspace/jipgye.worktrees 는 쓰지 않는다.
const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "dev", "golden-run.sh");
const sh = (cwd, ...a) => spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });

// 가짜 invariants: STUB_LOG 에 한 줄(작업 폴더·공유 폴더·인자)을 남기고 작업 폴더에 표지 파일을 만든다. STUB_SLEEP 초만큼 기다린다.
function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "jipgye-grun-"));
  const tmp = path.join(base, "tmp"), repo = path.join(base, "repo"), log = path.join(base, "calls.log");
  mkdirSync(tmp);
  mkdirSync(path.join(repo, "tools/golden/bin"), { recursive: true });
  writeFileSync(path.join(repo, "tools/golden/bin/invariants.ts"),
    `import fs from "node:fs";\n` +
    `fs.appendFileSync(process.env.STUB_LOG, [process.env.GOLDEN_CACHE_DIR, process.env.GOLDEN_SHA_CACHE_DIR || "-"].join(" ") + "\\n");\n` +
    `fs.writeFileSync(process.env.GOLDEN_CACHE_DIR + "/marker", "x");\n` +
    `if (process.env.STUB_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.STUB_SLEEP) * 1000));\n` +
    `console.log("불변 비교: 하드 실패 0건 가짜");\n`);
  sh(repo, "init", "-q");
  sh(repo, "add", ".");
  sh(repo, "commit", "-q", "-m", "init");
  sh(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  const head = sh(repo, "rev-parse", "HEAD").stdout.trim();
  return { base, tmp, repo, log, head, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ")) : []), done: () => rmSync(base, { recursive: true, force: true }) };
}
const env = (f, extra = {}) => ({ PATH: process.env.PATH, HOME: f.base, TMPDIR: f.tmp, NODE24_BIN: process.execPath, STUB_LOG: f.log, ...extra });
const run = (f, args = [], extra = {}) => spawnSync("/bin/bash", [SCRIPT, "--worktree", f.repo, ...args], { encoding: "utf8", env: env(f, extra) });
const runDirs = (f) => readdirSync(f.tmp).filter((n) => n.startsWith("jipgye-golden-run-"));

test("실행마다 전용 작업 폴더를 새로 만들고 끝나면 그 폴더만 지운다(이름에 머리 SHA 8자·pid)", () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.tmp, "jipgye-golden"));
    writeFileSync(path.join(f.tmp, "jipgye-golden/other-agents-cache"), "x"); // 예전 공용 폴더: 건드리면 안 된다
    const a = run(f, ["one"]);
    const b = run(f, ["two"]);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const [[dirA], [dirB]] = f.calls();
    assert.notEqual(dirA, dirB, "두 실행이 같은 폴더를 썼다");
    for (const d of [dirA, dirB]) assert.match(path.basename(d), new RegExp(`^jipgye-golden-run-${f.head.slice(0, 8)}-\\d+\\.[A-Za-z0-9]+$`));
    assert.deepEqual(runDirs(f), [], "끝난 실행의 폴더가 남았다");
    assert.ok(existsSync(path.join(f.tmp, "jipgye-golden/other-agents-cache")), "공용 jipgye-golden 을 지웠다");
    assert.match(a.stdout, /골든 1차 rc=0/);
    assert.match(a.stdout, /불변 비교: 하드 실패 0건/);
  } finally { f.done(); }
});

test("동시에 도는 다른 실행의 작업 폴더는 지우지 않는다(내 것만 지운다)", () => {
  const f = fixture();
  try {
    const other = path.join(f.tmp, "jipgye-golden-run-deadbeef-1.AAAAAA");
    mkdirSync(other);
    writeFileSync(path.join(other, "work"), "다른 실행이 쓰는 중");
    const r = run(f, ["mine"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(path.join(other, "work")), "남의 폴더를 지웠다");
  } finally { f.done(); }
});

test("죽은 실행이 남긴 24시간 넘은 전용 폴더는 다음 실행이 치운다", () => {
  const f = fixture();
  try {
    const stale = path.join(f.tmp, "jipgye-golden-run-deadbeef-1.OLDOLD");
    mkdirSync(stale);
    const old = new Date(Date.now() - 25 * 3600 * 1000);
    utimesSync(stale, old, old);
    assert.equal(run(f, ["x"]).status, 0);
    assert.equal(existsSync(stale), false);
  } finally { f.done(); }
});

test("GOLDEN_CACHE_DIR 을 주면 그 폴더를 쓰고 끝나도 지우지 않는다", () => {
  const f = fixture();
  try {
    const mine = path.join(f.base, "mine");
    mkdirSync(mine);
    assert.equal(run(f, ["x"], { GOLDEN_CACHE_DIR: mine }).status, 0);
    assert.equal(f.calls()[0][0], mine);
    assert.ok(existsSync(path.join(mine, "marker")));
    assert.deepEqual(runDirs(f), []);
  } finally { f.done(); }
});

test("기본은 공유 캐시를 쓰지 않는다 — GOLDEN_SHA_CACHE_DIR 이 안 넘어가고 기준 캐시 줄도 없다", () => {
  const f = fixture();
  try {
    const r = run(f, ["x"], { GOLDEN_SHA_CACHE_DIR: "" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.calls()[0][1], "-");
    assert.doesNotMatch(r.stdout, /기준 캐시/);
  } finally { f.done(); }
});

test("--shared-cache: 공유 폴더(기본 <공유>/golden-cache)를 넘기고, 기준 SHA 캐시가 있으면 적중·없으면 없음을 알린다", () => {
  const f = fixture();
  try {
    const shared = path.join(f.base, "shared");
    const first = run(f, ["--shared-cache", "x"], { JIPGYE_SHARED: shared });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal(f.calls()[0][1], path.join(shared, "golden-cache"));
    assert.ok(existsSync(path.join(shared, "golden-cache")));
    assert.match(first.stdout, new RegExp(`골든 기준 캐시: sha-${f.head} 없음`));
    mkdirSync(path.join(shared, "golden-cache", `sha-${f.head}`, ".done"), { recursive: true }); // 기준 SHA 의 캐시가 확정돼 있다
    const second = run(f, ["x"], { JIPGYE_SHARED: shared, GOLDEN_SHARED_CACHE: "1" });
    assert.match(second.stdout, new RegExp(`골든 기준 캐시: sha-${f.head} 적중`));
    // 다른 SHA 의 캐시만 있으면 적중이 아니다
    rmSync(path.join(shared, "golden-cache", `sha-${f.head}`), { recursive: true });
    mkdirSync(path.join(shared, "golden-cache", `sha-${"0".repeat(40)}`, ".done"), { recursive: true });
    assert.match(run(f, ["--shared-cache", "x"], { JIPGYE_SHARED: shared }).stdout, /기준 캐시: sha-[0-9a-f]{40} 없음/);
    assert.deepEqual(runDirs(f), [], "공유 캐시를 켜도 전용 작업 폴더는 지운다");
    assert.ok(existsSync(path.join(shared, "golden-cache", `sha-${"0".repeat(40)}`)), "공유 캐시는 지우지 않는다");
  } finally { f.done(); }
});

test("GOLDEN_SHARED_CACHE_DIR 로 공유 위치를 바꾼다", () => {
  const f = fixture();
  try {
    const dir = path.join(f.base, "elsewhere");
    assert.equal(run(f, ["--shared-cache", "x"], { GOLDEN_SHARED_CACHE_DIR: dir }).status, 0);
    assert.equal(f.calls()[0][1], dir);
  } finally { f.done(); }
});

test("TERM 로 끝나도 전용 작업 폴더를 지운다", async () => {
  const f = fixture();
  try {
    const child = spawn("/bin/bash", [SCRIPT, "--worktree", f.repo, "x"], { env: env(f, { STUB_SLEEP: "2" }), stdio: "ignore" });
    const closed = new Promise((resolve) => child.on("close", (code) => resolve(code)));
    for (let i = 0; i < 100 && f.calls().length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(runDirs(f).length, 1, "실행 중에는 전용 폴더가 있다");
    child.kill("SIGTERM");
    await closed;
    assert.deepEqual(runDirs(f), []);
  } finally { f.done(); }
});
