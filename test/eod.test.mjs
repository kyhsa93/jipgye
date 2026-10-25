import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/dev/eod.sh (#605): 하루 끝 의식. 합성 저장소 + 가짜 gh·npm 만 쓴다 - 실제 GitHub·시험·~/workspace 는 건드리지 않는다.
const EOD = path.resolve(import.meta.dirname, "..", "scripts", "dev", "eod.sh");
const put = (p, text = "", mode) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); if (mode) chmodSync(p, mode); };
const g = (cwd, ...a) => spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
const sha = (cwd, ref = "HEAD") => g(cwd, "rev-parse", ref).stdout.trim();

const S6_ORIG = '{"a": 1}\n';
// 가짜 npm: 인자를 남기고 count:bump 를 흉내 낸다. 가짜 gh: 읽기 호출만 흉내 내고 인자를 남긴다(STUB_GH_FAIL=1 이면 실패).
function fixture() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "jipgye-eod-")));
  const main = path.join(base, "main"), bin = path.join(base, "bin"), log = path.join(base, "calls.log");
  mkdirSync(main);
  put(path.join(main, "test/s6-baseline.json"), S6_ORIG);
  put(path.join(main, "test/load-failure.test.mjs"),
    `import test from "node:test"; import fs from "node:fs";\n` +
    `test("S6 롤링 기준선", () => { if (process.env.S6_BASELINE_UPDATE === "1") fs.writeFileSync(new URL("./s6-baseline.json", import.meta.url), '{"a": 2}\\n'); });\n`);
  put(path.join(main, "README"), "x");
  g(main, "init", "-q", "-b", "main");
  g(main, "add", ".");
  g(main, "commit", "-q", "-m", "init");
  const base0 = sha(main);
  const wt = (name, branch) => { const p = path.join(main, ".claude/worktrees", name); g(main, "worktree", "add", "-q", "-b", branch, p, base0); return p; };
  const tree = {
    cur: wt("agent-cur", "feat/cur"),       // 지금 돌리는 워크트리(병합됨이어도 건너뛴다)
    done: wt("agent-done", "feat/done"),    // 후보
    open: wt("agent-open", "feat/open"),    // 병합된 PR 없음
    moved: wt("agent-moved", "feat/moved"), // 병합 뒤 로컬 커밋
    locked: wt("agent-locked", "feat/locked"),
    dirty: wt("agent-dirty", "feat/dirty"),
  };
  const detached = path.join(main, ".claude/worktrees/agent-det");
  g(main, "worktree", "add", "-q", "--detach", detached, base0);
  const outside = path.join(base, "outside");              // .claude/worktrees 밖의 소유자 워크트리: 병합됐어도 건드리지 않는다
  g(main, "worktree", "add", "-q", "-b", "owner/branch", outside, base0);
  g(main, "worktree", "lock", tree.locked);
  put(path.join(tree.dirty, "scratch.txt"), "미커밋");
  put(path.join(tree.moved, "later.txt"), "병합 뒤");
  g(tree.moved, "add", ".");
  g(tree.moved, "commit", "-q", "-m", "later");
  const merged = [
    { number: 11, headRefName: "feat/done", headRefOid: sha(tree.done) },
    { number: 12, headRefName: "feat/cur", headRefOid: sha(tree.cur) },
    { number: 13, headRefName: "feat/moved", headRefOid: base0 },       // 병합 당시 head 는 커밋 전
    { number: 14, headRefName: "feat/locked", headRefOid: sha(tree.locked) },
    { number: 15, headRefName: "feat/dirty", headRefOid: sha(tree.dirty) },
    { number: 16, headRefName: "owner/branch", headRefOid: sha(outside) },
    { number: 17, headRefName: "main", headRefOid: base0 },
  ];
  put(path.join(base, "merged-all.json"), JSON.stringify(merged));
  put(path.join(base, "merged-today.json"), JSON.stringify([{ number: 11, title: "오늘 병합한 것", headRefName: "feat/done" }, { number: 12, title: "또 하나", headRefName: "feat/cur" }]));
  put(path.join(base, "open.json"), JSON.stringify([{ number: 20, title: "열린 PR", statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }, { status: "IN_PROGRESS", conclusion: "" }, { conclusion: "SKIPPED" }] }]));
  put(path.join(bin, "gh"),
    `#!/bin/bash\necho "gh $*" >> "$STUB_LOG"\n` +
    `[ "$STUB_GH_FAIL" = 1 ] && { echo "boom" >&2; exit 1; }\n` +
    `case "$*" in\n  *"--state open"*) cat "$STUB_DIR/open.json" ;;\n  *"--state merged"*"--search"*) cat "$STUB_DIR/merged-today.json" ;;\n  *"--state merged"*) cat "$STUB_DIR/merged-all.json" ;;\n  *) echo "[]" ;;\nesac\n`, 0o755);
  put(path.join(bin, "npm"),
    `#!/bin/bash\necho "npm $*" >> "$STUB_LOG"\n` +
    `echo "[root] npm test (cwd .)"\necho "[root] test/COUNT: 갱신: tests 100 → 110 · pass 90 → 95"\necho "[site] test/COUNT-site: 그대로: tests 50 · pass 50"\n` +
    `echo "[s6] test/s6-baseline.json: --dry-run 이라 다시 쓰지 않는다(쓰면 node --test ...)"\necho "(--dry-run: 파일을 쓰지 않았다)"\n` +
    `[ "$STUB_BUMP_REFUSE" = 1 ] && { echo "[golden] tools/golden/test/COUNT: 거부[내림]: tests 1 < 하한 2" >&2; exit 1; }\nexit 0\n`, 0o755);
  const snapshot = () => g(main, "worktree", "list", "--porcelain").stdout + g(main, "branch", "--format=%(refname:short) %(objectname)").stdout + g(main, "log", "--all", "--oneline").stdout;
  return { base, main, tree, detached, outside, log, base0, snapshot, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []), done: () => rmSync(base, { recursive: true, force: true }) };
}
const run = (f, args = [], env = {}) => spawnSync("/bin/bash", [EOD, "--root", f.tree.cur, ...args], {
  encoding: "utf8",
  env: { PATH: `${path.join(f.base, "bin")}:/usr/bin:/bin`, HOME: f.base, TMPDIR: f.base, NODE24_BIN: process.execPath, STUB_LOG: f.log, STUB_DIR: f.base, ...env },
});
const rel = (f, p) => path.relative(path.join(f.main, ".claude/worktrees"), p);

test("보기만 할 때: 오늘 병합·COUNT 계획·후보·열린 PR·요약 줄을 찍고, 저장소 상태(워크트리·브랜치·커밋)를 바꾸지 않는다", () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    const r = run(f, ["--date", "2026-10-25"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /① 오늘 병합 2건/);
    assert.match(r.stdout, /#11 오늘 병합한 것 \[feat\/done\]/);
    assert.match(r.stdout, /\[root\] test\/COUNT: 갱신: tests 100 → 110 · pass 90 → 95/);
    assert.match(r.stdout, /\[site\] .*그대로/);
    assert.match(r.stdout, /\(--dry-run: 파일을 쓰지 않았다\)/);
    assert.match(r.stdout, /③ 정리 후보 1개/);
    assert.match(r.stdout, /후보 agent-done \[feat\/done\] PR #11/);
    assert.match(r.stdout, /\(지우려면 --clean/);
    assert.match(r.stdout, /#20 열린 PR - 검사 통과 2 · 실패 1 · 대기 1/);
    assert.match(r.stdout, /⑤ 상태 요약 갱신 줄: 2026-10-25 병합 2건 \(#11 #12\) · 열린 PR 1건 · 정리 후보 1개/);
    assert.equal(f.snapshot(), before, "저장소 상태가 바뀌었다");
    assert.ok(existsSync(f.tree.done), "--clean 없이 워크트리를 지웠다");
    // gh 는 읽기 호출만, npm 은 count:bump --dry-run 한 번
    const calls = f.calls();
    assert.ok(calls.every((c) => /^(gh pr list |npm run count:bump -- --dry-run$)/.test(c)), calls.join("\n"));
    assert.ok(calls.includes("gh pr list -R kyhsa93/jipgye --state merged --search merged:>=2026-10-25 --limit 100 --json number,title,headRefName"));
    assert.equal(calls.filter((c) => c.startsWith("npm")).length, 1);
  } finally { f.done(); }
});

test("건너뜀 사유: 지금 워크트리·병합된 PR 없음·병합 뒤 커밋·잠김·미커밋·분리된 HEAD. .claude/worktrees 밖과 기본 저장소는 목록에도 없다", () => {
  const f = fixture();
  try {
    const r = run(f, ["--no-bump"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /건너뜀 agent-cur: 지금 이 워크트리/);
    assert.match(r.stdout, /건너뜀 agent-open \[feat\/open\]: 병합된 PR 없음/);
    assert.match(r.stdout, /건너뜀 agent-moved \[feat\/moved\]: PR #13 병합됨, 하지만 로컬 끝이 PR head 와 다르다/);
    assert.match(r.stdout, /건너뜀 agent-locked \[feat\/locked\]: 잠김/);
    assert.match(r.stdout, /건너뜀 agent-dirty \[feat\/dirty\]: PR #15 병합됨, 미커밋 변경 있음/);
    assert.match(r.stdout, /건너뜀 agent-det: 분리된 HEAD/);
    assert.doesNotMatch(r.stdout, /owner\/branch|outside/);
    assert.match(r.stdout, /② 시험 하한 계획: --no-bump 로 건너뜀/);
    assert.equal(f.calls().filter((c) => c.startsWith("npm")).length, 0, "--no-bump 인데 시험을 돌렸다");
  } finally { f.done(); }
});

test("--clean: 후보(워크트리+브랜치)만 지운다. 나머지·소유자 워크트리·기본 브랜치는 그대로, 커밋도 만들지 않는다", () => {
  const f = fixture();
  try {
    const logBefore = g(f.main, "log", "--all", "--oneline").stdout;
    const r = run(f, ["--clean", "--no-bump"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /지움 agent-done \[feat\/done\]/);
    assert.match(r.stdout, /--clean: 1개 지움/);
    assert.equal(existsSync(f.tree.done), false);
    assert.equal(g(f.main, "branch", "--list", "feat/done").stdout.trim(), "", "브랜치가 남았다");
    for (const keep of [f.tree.cur, f.tree.open, f.tree.moved, f.tree.locked, f.tree.dirty, f.detached, f.outside, f.main]) assert.ok(existsSync(keep), `지우면 안 되는 것을 지웠다: ${keep}`);
    for (const b of ["feat/cur", "feat/open", "feat/moved", "feat/locked", "feat/dirty", "owner/branch", "main"]) assert.notEqual(g(f.main, "branch", "--list", b).stdout.trim(), "", `지우면 안 되는 브랜치: ${b}`);
    assert.equal(g(f.main, "log", "--all", "--oneline").stdout, logBefore, "커밋이 생기거나 사라졌다");
    // 같은 걸 다시 돌리면 후보가 없다(멱등)
    assert.match(run(f, ["--clean", "--no-bump"]).stdout, /③ 정리 후보 0개/);
  } finally { f.done(); }
});

test("count:bump 가 거부한 패키지가 있으면 그 줄을 보여 주고 S6 는 건너뛴다(루트가 초록이 아니면)", () => {
  const f = fixture();
  try {
    put(path.join(f.base, "bin/npm"), `#!/bin/bash\necho "npm $*" >> "$STUB_LOG"\necho "[root] test/COUNT: 거부[실패]: fail 2" >&2\nexit 1\n`, 0o755);
    const r = run(f);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[root\] test\/COUNT: 거부\[실패\]/);
    assert.match(r.stdout, /count:bump 종료 1/);
    assert.match(r.stdout, /\[s6\] 건너뜀/);
    assert.equal(readFileSync(path.join(f.tree.cur, "test/s6-baseline.json"), "utf8"), S6_ORIG);
  } finally { f.done(); }
});

test("S6 기준선: 다시 만들어 diff 를 보여 준 뒤 원래 파일로 되돌린다(저장소가 깨끗하다)", () => {
  const f = fixture();
  try {
    const r = run(f);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[s6\] test\/s6-baseline.json: 갱신 예정/);
    assert.match(r.stdout, /^ +[-+]\{"a": [12]\}$/m);
    assert.equal(readFileSync(path.join(f.tree.cur, "test/s6-baseline.json"), "utf8"), S6_ORIG, "기준선이 되돌려지지 않았다");
    assert.equal(g(f.tree.cur, "status", "--porcelain").stdout, "", "작업 트리가 더러워졌다");
  } finally { f.done(); }
});

test("gh 가 실패하면 종료 1, 후보를 만들지 못했다고 알리고 --clean 도 아무것도 지우지 않는다", () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    const r = run(f, ["--clean", "--no-bump"], { STUB_GH_FAIL: "1" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /③ 정리 후보: gh 호출이 실패해/);
    assert.equal(f.snapshot(), before);
  } finally { f.done(); }
});

test("사용법 오류는 종료 2: 모르는 인자·--date 모양·값 없는 플래그", () => {
  const f = fixture();
  try {
    for (const args of [["--nope"], ["--date", "10/25"], ["--date"], ["extra"]]) {
      const r = run(f, args);
      assert.equal(r.status, 2, args.join(" ") + r.stderr);
      assert.match(r.stderr, /사용법/);
    }
    assert.equal(f.calls().length, 0);
  } finally { f.done(); }
});
