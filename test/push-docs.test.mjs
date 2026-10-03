import test from "node:test";
import assert from "node:assert/strict";
import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const WORKFLOWS = [".github/workflows/daily-update.yml", ".github/workflows/summarize.yml"];

test("푸시 스크립트는 실행 가능해야 한다", async () => {
  await access(path.join(root, "scripts/push-docs.sh"), constants.X_OK);
});

test("두 워크플로가 같은 푸시 스크립트를 쓴다", async () => {
  for (const file of WORKFLOWS) {
    assert.match(await read(file), /\.\/scripts\/push-docs\.sh/, `${file}가 푸시 스크립트를 쓰지 않는다`);
  }
});

test("워크플로가 직접 push하지 않는다", async () => {
  for (const file of WORKFLOWS) {
    const text = await read(file);
    assert.ok(!/^\s+git push\b/m.test(text), `${file}에 직접 push가 남아 있다`);
    assert.ok(!/^\s+git commit\b/m.test(text), `${file}에 직접 commit이 남아 있다`);
  }
});

test("실거래 원본도 함께 커밋한다", async () => {
  for (const file of ["scripts/push-docs.sh", "scripts/update-all.mjs"]) {
    const text = await read(file);
    assert.match(text, /git status --porcelain -- docs raw/, `${file}가 원본 변경을 보지 않는다`);
  }
});

test("원본 디렉터리가 없는 날에도 커밋이 된다", async () => {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const base = await mkdtemp(path.join(tmpdir(), "push-docs-"));
  const remote = path.join(base, "remote.git");
  const work = path.join(base, "work");

  await run("git", ["init", "-q", "--bare", remote]);
  await run("git", ["clone", "-q", remote, work]);
  await run("git", ["config", "user.email", "t@t"], { cwd: work });
  await run("git", ["config", "user.name", "t"], { cwd: work });
  await mkdir(path.join(work, "docs"), { recursive: true });
  await writeFile(path.join(work, "docs/data.json"), "{}");

  const { stdout } = await run(path.join(root, "scripts/push-docs.sh"), ["테스트 커밋"], { cwd: work });

  const { stdout: log } = await run("git", ["log", "--oneline", "-1"], { cwd: work });
  assert.match(log, /테스트 커밋/, `커밋되지 않았다: ${stdout}`);

  const { stdout: files } = await run("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: work });
  assert.match(files, /docs\/data\.json/);
});

test("재시도는 rebase를 반드시 되돌리고 다음으로 넘어간다", async () => {
  const script = await read("scripts/push-docs.sh");
  assert.match(script, /git rebase --abort/, "충돌로 멈춘 rebase를 정리하지 않는다");
  assert.match(script, /git pull --rebase -X theirs/, "충돌을 우리 산출물로 풀지 않는다");
});

test("실거래는 날마다 받는다", async () => {
  const yml = await read(".github/workflows/daily-update.yml");

  const step = yml.split("- name: 실거래 수집")[1]?.split("- name:")[0] ?? "";
  assert.match(step, /if: env\.MODE == 'full'/, "실거래가 날마다 도는 자리에 없다");
  assert.match(step, /fetch-realestate\.mjs/);
  assert.ok(!yml.includes("weekly"), "주 1회 모드가 남아 있다");
});

test("경로를 주면 그 경로만 커밋한다", async () => {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const base = await mkdtemp(path.join(tmpdir(), "push-docs-"));
  const remote = path.join(base, "remote.git");
  const work = path.join(base, "work");

  await run("git", ["init", "-q", "--bare", remote]);
  await run("git", ["clone", "-q", remote, work]);
  await mkdir(path.join(work, "docs"), { recursive: true });
  await mkdir(path.join(work, "raw/sale"), { recursive: true });
  await writeFile(path.join(work, "docs/data.json"), "{}");
  await writeFile(path.join(work, "raw/sale/11110-202610.json"), "[]");

  await run(path.join(root, "scripts/push-docs.sh"), ["원본만", "raw"], { cwd: work });

  const { stdout: files } = await run("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: work });
  assert.match(files, /raw\/sale\/11110-202610\.json/);
  assert.ok(!files.includes("docs/"), `docs까지 커밋했다: ${files}`);
  const { stdout: remoteLog } = await run("git", ["--git-dir", remote, "log", "--oneline", "-1"]);
  assert.match(remoteLog, /원본만/, "푸시되지 않았다");
});

test("데일리 워크플로가 실거래 원본을 받자마자 먼저 커밋한다", async () => {
  const yml = await read(".github/workflows/daily-update.yml");
  const step = yml.split("- name: 실거래 수집")[1]?.split("- name:")[0] ?? "";
  const fetchAt = step.indexOf("fetch-realestate.mjs");
  const commitAt = step.search(/push-docs\.sh "[^"]*" raw\b/);
  const buildAt = step.indexOf("build-realestate.mjs");
  assert.ok(fetchAt >= 0 && commitAt > fetchAt, "원본 수집 뒤에 원본 커밋이 없다");
  assert.ok(commitAt < buildAt, "원본 커밋이 빌더보다 뒤에 있다");
});
