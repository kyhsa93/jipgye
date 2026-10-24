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

// (#510, 구조 B-4) 뒤집었다: 전에는 `git status --porcelain -- docs raw` 로 docs 전체(렌더가 제자리에서 고친 생성 HTML 포함)와 raw 를 봤다. 이제 데이터 경로 둘(docs/data·raw)만 본다.
test("실거래 원본도 함께 커밋한다 - 그리고 커밋·상태 확인은 데이터 경로(docs/data·raw) 둘로 한정된다", async () => {
  const sh = await read("scripts/push-docs.sh");
  assert.match(sh, /^DATA_PATHS=\(docs\/data raw\)$/m, "push-docs.sh 의 DATA_PATHS 가 docs/data·raw 가 아니다");
  assert.match(sh, /git status --porcelain -- "\$\{DATA_PATHS\[@\]\}"/, "push-docs.sh 가 데이터 경로의 변경을 보지 않는다");
  assert.ok(!/git add docs\s*$/m.test(sh) && !/git status --porcelain -- docs raw/.test(sh), "push-docs.sh 에 docs 통째로 커밋하는 옛 줄이 남았다");
  const all = await read("scripts/update-all.mjs");
  assert.match(all, /const DATA_PATHS = \["docs\/data", "raw"\];/, "update-all 의 DATA_PATHS 가 docs/data·raw 가 아니다");
  assert.match(all, /git status --porcelain -- \$\{DATA_PATHS\.join\(" "\)\}/, "update-all 이 데이터 경로의 변경을 보지 않는다");
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
  await mkdir(path.join(work, "docs/data"), { recursive: true });
  await writeFile(path.join(work, "docs/data/x.json"), "{}");
  // (#510) 렌더가 docs/ 에 만든 HTML·정적 파일은 커밋에 실리지 않는다 - 데이터 경로만 커밋한다.
  await writeFile(path.join(work, "docs/district-gangnam.html"), "<html></html>");
  await writeFile(path.join(work, "docs/data.json"), "{}");

  const { stdout } = await run(path.join(root, "scripts/push-docs.sh"), ["테스트 커밋"], { cwd: work });

  const { stdout: log } = await run("git", ["log", "--oneline", "-1"], { cwd: work });
  assert.match(log, /테스트 커밋/, `커밋되지 않았다: ${stdout}`);

  const { stdout: files } = await run("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: work });
  assert.match(files, /docs\/data\/x\.json/);
  assert.ok(!/district-gangnam\.html|docs\/data\.json/.test(files), `데이터 경로 밖(docs/*.html·docs/data.json)까지 커밋했다: ${files}`);
});

test("재시도는 rebase를 반드시 되돌리고 다음으로 넘어간다", async () => {
  const script = await read("scripts/push-docs.sh");
  assert.match(script, /git rebase --abort/, "충돌로 멈춘 rebase를 정리하지 않는다");
  // #94: 충돌을 우리(낡은) 산출물로 풀면 최신 main을 덮는다. 주석 말고 코드에 -X가 없어야 한다.
  const code = script.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/-X\s*theirs|--strategy-option/.test(code), "충돌을 우리 산출물로 푼다(-X theirs)");
});

test("실거래는 날마다 받는다", async () => {
  const yml = await read(".github/workflows/daily-update.yml");

  const step = yml.split("- name: 실거래 수집")[1]?.split("- name:")[0] ?? "";
  assert.match(step, /if: env\.MODE == 'full'/, "실거래가 날마다 도는 자리에 없다");
  assert.match(step, /fetch-realestate\.ts/);
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
  const fetchAt = step.indexOf("fetch-realestate.ts");
  const commitAt = step.search(/push-docs\.sh "[^"]*" raw\b/);
  const buildAt = step.indexOf("build-realestate.ts");
  assert.ok(fetchAt >= 0 && commitAt > fetchAt, "원본 수집 뒤에 원본 커밋이 없다");
  assert.ok(commitAt < buildAt, "원본 커밋이 빌더보다 뒤에 있다");
});

// ---- (#510, 구조 B-4) 데이터 커밋과 기능 병합이 겹쳐도 수집분이 버려지지 않는다 ------------------------------------------------------------
// 생성 HTML 이 main 에서 빠져 데이터 커밋(docs/data·raw)과 기능 병합(코드·틀·시험·워크플로)은 같은 파일을 건드리지 않는다. 그래서 수집이 도는 10여 분 사이에 기능 PR 이 병합돼
// 원격이 앞서 있어도(뉴스·시장·금리 이력은 다시 받을 수 없다) 충돌 없이 얹는다. 원격의 새 커밋이 데이터 경로를 바꿨으면 예전처럼 낡은 산출물로 덮어쓰지 않고 실패한다.
async function twoClones() {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const base = await mkdtemp(path.join(tmpdir(), "push-docs-race-"));
  const remote = path.join(base, "remote.git");
  await run("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const clone = async (name) => {
    const dir = path.join(base, name);
    await run("git", ["clone", "-q", remote, dir]);
    await run("git", ["config", "user.email", "t@t"], { cwd: dir });
    await run("git", ["config", "user.name", "t"], { cwd: dir });
    return dir;
  };
  const seed = await clone("seed");
  await mkdir(path.join(seed, "docs/data"), { recursive: true });
  await mkdir(path.join(seed, "scripts"), { recursive: true });
  await writeFile(path.join(seed, "docs/data/a.json"), "{}");
  await writeFile(path.join(seed, "scripts/code.ts"), "1");
  await run("git", ["add", "-A"], { cwd: seed });
  await run("git", ["commit", "-q", "-m", "시작"], { cwd: seed });
  await run("git", ["push", "-q", "origin", "HEAD:main"], { cwd: seed });
  const collector = await clone("collector"); // 수집 job: 이 시점의 main 을 체크아웃했다
  const merger = await clone("merger"); // 그 사이 main 에 병합하는 쪽
  return { run, remote, collector, merger, write: writeFile, mk: mkdir };
}

test("원격이 앞서 있어도 그 새 커밋이 데이터 경로를 안 건드렸으면(기능 병합) 충돌 없이 얹어 푸시한다 - 수집분이 버려지지 않는다", async () => {
  const { run, remote, collector, merger, write } = await twoClones();
  await write(path.join(merger, "scripts/code.ts"), "2"); // 기능 PR 병합: 코드만
  await run("git", ["commit", "-q", "-am", "기능 병합"], { cwd: merger });
  await run("git", ["push", "-q", "origin", "HEAD:main"], { cwd: merger });

  await write(path.join(collector, "docs/data/a.json"), '{"day":2}'); // 수집분
  const r = await run(path.join(root, "scripts/push-docs.sh"), ["chore: 데일리 데이터 갱신"], { cwd: collector });
  assert.match(r.stdout, /데이터 경로를 안 건드렸다/);
  const { stdout: log } = await run("git", ["--git-dir", remote, "log", "--format=%s", "main"]);
  assert.deepEqual(log.trim().split("\n"), ["chore: 데일리 데이터 갱신", "기능 병합", "시작"], "수집 커밋이 기능 병합 위에 얹히지 않았다");
  const { stdout: code } = await run("git", ["--git-dir", remote, "show", "main:scripts/code.ts"]);
  assert.equal(code, "2", "기능 병합이 덮였다");
});

test("원격이 앞서 있고 그 새 커밋이 데이터 경로를 바꿨으면 실패한다 - 낡은 산출물로 덮어쓰지 않는다(다음 실행이 최신 위에서 다시 생성)", async () => {
  const { run, remote, collector, merger, write } = await twoClones();
  await write(path.join(merger, "docs/data/a.json"), '{"other":true}'); // 다른 데이터 쓰기
  await run("git", ["commit", "-q", "-am", "다른 데이터"], { cwd: merger });
  await run("git", ["push", "-q", "origin", "HEAD:main"], { cwd: merger });

  await write(path.join(collector, "docs/data/a.json"), '{"day":2}');
  const r = await run(path.join(root, "scripts/push-docs.sh"), ["chore: 데일리 데이터 갱신"], { cwd: collector }).catch((e) => e);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /데이터 경로.*바꿨다/);
  const { stdout: log } = await run("git", ["--git-dir", remote, "log", "--format=%s", "main"]);
  assert.deepEqual(log.trim().split("\n"), ["다른 데이터", "시작"], "실패해야 하는데 원격이 바뀌었다");
});

test("새 데이터 파일을 얹는 rebase 가 끝난 뒤 작업 트리에 rebase 흔적이 없고, 푸시된 팁이 수집 커밋이다", async () => {
  const { run, remote, collector, merger, write } = await twoClones();
  // 데이터 경로 밖(scripts/)에서 충돌을 만들 수는 없다 - 수집은 거기를 안 만진다. 충돌은 수집 job 이 docs/data 를 바꿨는데 원격도 같은 파일을 바꾼 경우뿐이고 위 시험이 그 길을 막는다.
  // 여기서는 rebase 중간에 멈추지 않고 깨끗한 상태로 끝나는지만 본다: 원격이 코드만 바꾼 경우 collector 작업 트리에 rebase 흔적이 없다.
  await write(path.join(merger, "scripts/code.ts"), "3");
  await run("git", ["commit", "-q", "-am", "기능 병합 2"], { cwd: merger });
  await run("git", ["push", "-q", "origin", "HEAD:main"], { cwd: merger });
  await write(path.join(collector, "docs/data/b.json"), "{}"); // 새 데이터 파일(충돌 없음)
  await run(path.join(root, "scripts/push-docs.sh"), ["chore: 뉴스 갱신"], { cwd: collector });
  const { stdout: st } = await run("git", ["status", "--porcelain=v1", "--branch"], { cwd: collector });
  assert.ok(!/rebase/.test(st), `rebase 가 중간에 멈춰 있다: ${st}`);
  const { stdout: tip } = await run("git", ["--git-dir", remote, "log", "-1", "--format=%s", "main"]);
  assert.equal(tip.trim(), "chore: 뉴스 갱신");
});

test("데이터 경로에 변경이 없으면 docs/*.html 이 바뀌어 있어도 커밋하지 않는다 (렌더가 제자리에서 고친 장은 수집 커밋이 아니다)", async () => {
  const { run, remote, collector, write } = await twoClones();
  await write(path.join(collector, "docs/index.html"), "<html>렌더가 고친 장</html>");
  const r = await run(path.join(root, "scripts/push-docs.sh"), ["chore: 뉴스 갱신"], { cwd: collector });
  assert.match(r.stdout, /변경사항 없음/);
  const { stdout: log } = await run("git", ["--git-dir", remote, "log", "--format=%s", "main"]);
  assert.deepEqual(log.trim().split("\n"), ["시작"]);
});
