import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/dev/gate.sh (#601): 한 줄 로컬 관문. 합성 저장소 루트의 가짜 단계 스크립트만 부른다 - 실제 렌더·시험·~/workspace/jipgye.worktrees 는 쓰지 않는다.
const GATE = path.resolve(import.meta.dirname, "..", "scripts", "dev", "gate.sh");
const put = (p, text = "") => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };

// 가짜 단계: STUB_LOG 에 "<이름> <인자>" 를 한 줄씩 남기고, STUB_FAIL(쉼표 목록)에 이름이 있으면 30줄을 찍고 종료 1.
// 이름: render · test(루트) · site(루트 --site) · health · golden(tools/golden 의 시험) · hooks · doctor · golden-run
function fixture({ doctor = false } = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), "jipgye-gate-"));
  const root = path.join(base, "repo"), log = path.join(base, "calls.log");
  const stub = (rel, name, body = "") => put(path.join(root, rel),
    `import fs from "node:fs"; const args = process.argv.slice(2);\n` +
    `fs.appendFileSync(process.env.STUB_LOG, ${JSON.stringify(name)} + " " + args.join(" ") + "\\n");\n${body}\n` +
    `if ((process.env.STUB_FAIL || "").split(",").includes(${JSON.stringify(name)})) { for (let i = 1; i <= 30; i++) console.log("출력 줄 " + i); console.error("뭔가 틀렸다 ${name}"); process.exit(1); }\n`);
  stub("scripts/render-pipeline.ts", "render", `console.log(process.env.STUB_RENDER_TEXT || "렌더 끝");`);
  // run-tests: 루트(cwd=repo)·--site·tools/health·tools/golden 을 cwd 와 인자로 구분한다.
  put(path.join(root, "scripts/run-tests.mjs"),
    `import fs from "node:fs"; import path from "node:path";\n` +
    `const args = process.argv.slice(2); const cwd = path.basename(process.cwd());\n` +
    `const name = cwd === "health" ? "health" : cwd === "golden" ? "golden" : args.includes("--site") ? "site" : "test";\n` +
    `fs.appendFileSync(process.env.STUB_LOG, name + " " + args.join(" ") + "\\n");\n` +
    `console.log("ℹ tests 7\\nℹ pass 6\\nℹ fail 0");\n` +
    `if ((process.env.STUB_FAIL || "").split(",").includes(name)) { for (let i = 1; i <= 30; i++) console.log("출력 줄 " + i); process.exit(1); }\n`);
  mkdirSync(path.join(root, "tools/health"), { recursive: true });
  stub("tools/golden/bin/invariants.ts", "hooks", `console.log("훅 클래스 목록 점검");`);
  put(path.join(root, "package.json"), '{"name":"jipgye","type":"module"}\n');
  if (doctor) {
    put(path.join(root, "scripts/dev/doctor.sh"), `#!/bin/bash\necho "doctor $*" >> "$STUB_LOG"\ncase ",$STUB_FAIL," in *,doctor,*) echo "doctor 실패: 가짜" >&2; exit 1;; esac\necho "doctor 통과"\n`);
    chmodSync(path.join(root, "scripts/dev/doctor.sh"), 0o755);
  }
  put(path.join(root, "scripts/dev/golden-run.sh"), `#!/bin/bash\necho "golden-run $*" >> "$STUB_LOG"\ncase ",$STUB_FAIL," in *,golden-run,*) echo "골든 실패: 가짜" >&2; exit 1;; esac\necho "골든 1차 rc=1"\necho "불변 비교: 하드 실패 0건 가짜"\n`);
  chmodSync(path.join(root, "scripts/dev/golden-run.sh"), 0o755);
  return { base, root, log, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []), done: () => rmSync(base, { recursive: true, force: true }) };
}
const run = (f, args = [], env = {}) => spawnSync("/bin/bash", [GATE, "--root", f.root, ...args], {
  encoding: "utf8", env: { PATH: "/usr/bin:/bin", TMPDIR: f.base, NODE24_BIN: process.execPath, STUB_LOG: f.log, ...env },
});
const names = (f) => f.calls().map((l) => l.split(" ")[0]);
const summaryLines = (stdout) => stdout.split("\n").filter((l) => /^(PASS|FAIL|SKIP) /.test(l));

test("전부 통과하면 종료 0, 단계 순서대로 돌고, 요약은 ≤10줄이며 시험 개수가 붙는다", () => {
  const f = fixture({ doctor: true });
  try {
    const r = run(f);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(names(f), ["doctor", "render", "test", "site", "health", "golden", "hooks"]);
    assert.ok(r.stdout.trim().split("\n").length <= 10, r.stdout);
    assert.equal(summaryLines(r.stdout).length, 7);
    assert.match(r.stdout, /PASS test +tests 7 pass 6/);
    assert.match(r.stdout, /^gate 통과$/m);
    // 실제 호출 모양: 렌더 출력 위치, 건강·골든 폴더, 훅 점검 플래그
    const calls = f.calls();
    assert.ok(calls.includes("render --out=build/site"));
    assert.ok(calls.includes("site --site"));
    assert.ok(calls.includes("hooks --hooks-check --repo ../.."));
    // 통과하면 로그 임시 폴더를 지운다
    assert.deepEqual(readdirSync(f.base).filter((n) => n.startsWith("jipgye-gate.")), []);
  } finally { f.done(); }
});

test("doctor.sh 가 없으면 건너뛰고(SKIP) 나머지는 돈다", () => {
  const f = fixture();
  try {
    const r = run(f);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /SKIP doctor/);
    assert.equal(names(f)[0], "render");
  } finally { f.done(); }
});

test("훅 목록 단계가 실패하면 종료 1, 그 단계의 마지막 20줄만 보이고, 다른 단계는 끝까지 돈다", () => {
  const f = fixture();
  try {
    const r = run(f, [], { STUB_FAIL: "hooks" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^FAIL hooks/m);
    assert.match(r.stdout, /gate 실패: 1단계 \(첫 실패: hooks\)/);
    assert.match(r.stdout, /출력 줄 30/);
    assert.match(r.stdout, /출력 줄 12\b/); // 30줄 + stderr 1줄 중 끝 20줄 = 12..30 + stderr
    assert.doesNotMatch(r.stdout, /출력 줄 11\b/);
    assert.match(r.stdout, /뭔가 틀렸다 hooks/); // stderr 도 같은 로그에 들어 있다
    assert.deepEqual(names(f), ["render", "test", "site", "health", "golden", "hooks"]);
    // 실패하면 전체 로그를 남기고 위치를 알린다
    assert.match(r.stdout, /전체 로그: \S+\/hooks\.log/);
  } finally { f.done(); }
});

test("여러 단계가 실패하면 첫 실패 단계의 끝 20줄을 보인다", () => {
  const f = fixture();
  try {
    const r = run(f, [], { STUB_FAIL: "site,golden" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /gate 실패: 2단계 \(첫 실패: site\)/);
    assert.match(r.stdout, /--- site 마지막 20줄 ---/);
    assert.doesNotMatch(r.stdout, /--- golden 마지막/);
  } finally { f.done(); }
});

test("렌더가 실패하면 build/site 를 읽는 test·site·health 는 건너뛰고, 독립인 golden·hooks 는 돈다", () => {
  const f = fixture();
  try {
    const r = run(f, [], { STUB_FAIL: "render" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^SKIP test .*render 실패/m);
    assert.match(r.stdout, /^SKIP site /m);
    assert.match(r.stdout, /^SKIP health /m);
    assert.deepEqual(names(f), ["render", "golden", "hooks"]);
  } finally { f.done(); }
});

test("렌더가 종료 0 이어도 폴백 표시(fallback=true)가 나오면 실패다", () => {
  const f = fixture();
  try {
    const r = run(f, [], { STUB_RENDER_TEXT: "fallback=true" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^FAIL render +폴백/m);
    assert.match(r.stdout, /첫 실패: render/);
  } finally { f.done(); }
});

test("doctor 가 실패하면 나머지를 돌리지 않는다", () => {
  const f = fixture({ doctor: true });
  try {
    const r = run(f, [], { STUB_FAIL: "doctor" });
    assert.equal(r.status, 1);
    assert.deepEqual(names(f), ["doctor"]);
    assert.match(r.stdout, /^SKIP render .*doctor 실패/m);
    assert.match(r.stdout, /doctor 실패: 가짜/);
  } finally { f.done(); }
});

test("--golden <이름> 은 golden-run.sh 를 맨 끝에 한 번 부르고, 그 실패도 관문 실패다", () => {
  const f = fixture();
  try {
    const ok = run(f, ["--golden", "n601"]);
    assert.equal(ok.status, 0, ok.stdout);
    assert.equal(names(f).at(-1), "golden-run");
    assert.ok(f.calls().includes("golden-run n601"));
    assert.match(ok.stdout, /PASS golden-run .*불변 비교: 하드 실패 0건/);
    assert.ok(ok.stdout.trim().split("\n").length <= 10);
  } finally { f.done(); }
  const g = fixture();
  try {
    const bad = run(g, ["--golden", "n601"], { STUB_FAIL: "golden-run" });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /첫 실패: golden-run/);
  } finally { g.done(); }
});

test("--golden 없이는 golden-run.sh 를 부르지 않는다", () => {
  const f = fixture();
  try {
    run(f);
    assert.ok(!names(f).includes("golden-run"));
  } finally { f.done(); }
});

test("저장소 안의 어떤 파일도 고치지 않는다(가짜 단계는 아무것도 쓰지 않는다)", () => {
  const f = fixture({ doctor: true });
  try {
    const snap = () => readdirSync(f.root, { recursive: true }).sort().map((p) => {
      const full = path.join(f.root, p);
      try { return p + ":" + readFileSync(full, "utf8").length; } catch { return p; }
    });
    const before = snap();
    run(f, [], { STUB_FAIL: "hooks" });
    assert.deepEqual(snap(), before);
  } finally { f.done(); }
});

test("알 수 없는 인자·빈 --golden 은 종료 2", () => {
  const f = fixture();
  try {
    assert.equal(run(f, ["--nope"]).status, 2);
    assert.equal(run(f, ["--golden"]).status, 2);
    assert.deepEqual(f.calls(), []);
  } finally { f.done(); }
});
