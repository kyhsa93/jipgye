import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// 사전 등록 순서 확인 (#133 완료 조건 1). 임시 git 저장소로만 돈다.
const execFileAsync = promisify(execFile);
const script = path.resolve(import.meta.dirname, "../scripts/check-prereg-order.mjs");
const PREREG = "research/housing-permits/PREREG.md";
const OUT = "research/housing-permits/folded.json";

async function git(cwd, ...args) {
  const r = await execFileAsync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
  return r.stdout.trim();
}
async function commit(cwd, files, msg) {
  for (const [p, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, p)), { recursive: true });
    await writeFile(path.join(cwd, p), text);
  }
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-q", "-m", msg);
  return git(cwd, "rev-parse", "HEAD");
}
async function repo() {
  const dir = await mkdtemp(path.join(tmpdir(), "prereg-"));
  await git(dir, "init", "-q", "-b", "main");
  return dir;
}
async function check(cwd, sha, extra = []) {
  try {
    const r = await execFileAsync(process.execPath, [script, "--prereg", sha, "--prereg-path", PREREG, "--output", OUT, ...extra], { cwd });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    return { code: e.code, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("사전 등록 순서: PREREG가 조상이고 결과 파일이 아직 없으면 통과", async () => {
  const dir = await repo();
  const sha = await commit(dir, { [PREREG]: "p" }, "prereg");
  await commit(dir, { "a.txt": "x" }, "other");
  assert.equal((await check(dir, sha)).code, 0);
});

test("사전 등록 순서: 결과 파일이 PREREG 뒤에 처음 올라왔으면 통과", async () => {
  const dir = await repo();
  const sha = await commit(dir, { [PREREG]: "p" }, "prereg");
  await commit(dir, { [OUT]: "{}" }, "folded");
  await commit(dir, { [OUT]: "{\"a\":1}" }, "folded 2");
  assert.equal((await check(dir, sha)).code, 0);
});

test("사전 등록 순서: 결과 파일이 PREREG보다 먼저 올라갔으면 실패", async () => {
  const dir = await repo();
  await commit(dir, { [OUT]: "{}" }, "folded first");
  const sha = await commit(dir, { [PREREG]: "p" }, "prereg");
  const r = await check(dir, sha);
  assert.equal(r.code, 1);
  assert.match(r.out, /먼저|앞/);
});

test("사전 등록 순서: PREREG 커밋이 현재 기록의 조상이 아니면 실패", async () => {
  const dir = await repo();
  await commit(dir, { "a.txt": "x" }, "base");
  await git(dir, "checkout", "-q", "-b", "side");
  const sha = await commit(dir, { [PREREG]: "p" }, "prereg on side");
  await git(dir, "checkout", "-q", "main");
  await commit(dir, { "b.txt": "y" }, "main moves");
  const r = await check(dir, sha);
  assert.equal(r.code, 1);
  assert.match(r.out, /조상/);
});

test("사전 등록 순서: 그 커밋에 PREREG 파일이 없거나 해시 꼴이 아니면 실패", async () => {
  const dir = await repo();
  const sha = await commit(dir, { "a.txt": "x" }, "no prereg");
  assert.equal((await check(dir, sha)).code, 1);
  assert.equal((await check(dir, "dac5e98")).code, 1, "짧은 해시는 받지 않는다");
  assert.equal((await check(dir, "not-a-sha")).code, 1);
});
