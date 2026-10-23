import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRatchet, readFloors } from "../scripts/test-count-ratchet.mjs";

// `npm test` 안의 시험 개수 래칫(#319). 래퍼(scripts/run-tests.mjs)를 가짜 패키지(임시 폴더의 test/*.test.mjs +
// test/COUNT)에서 돌려, 대조군마다 종료 코드와 **어느 가드가 물었는지**(메시지의 `[...]`)를 본다.
const root = path.resolve(import.meta.dirname, "..");
const wrapper = path.join(root, "scripts", "run-tests.mjs");
const ratchetCli = path.join(root, "scripts", "test-count-ratchet.mjs");

const PASS = 'import test from "node:test";\ntest("통과 한 개", () => {});\n';
const SKIP = 'import test from "node:test";\ntest("건너뜀 한 개", { skip: true }, () => {});\n';
const RED = 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("빨강 한 개", () => assert.equal(1, 2));\n';

// 가짜 패키지를 만든다. files: { "a.test.mjs": 내용 }, count: COUNT 파일 내용(null이면 만들지 않는다).
function fixture(files, count) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "jipgye-run-tests-"));
  mkdirSync(path.join(dir, "test"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "test", name), body);
  if (count !== null) writeFileSync(path.join(dir, "test", "COUNT"), count);
  return dir;
}

// 바깥 러너가 물려 준 NODE_TEST_CONTEXT가 있으면 안쪽 `node --test`가 리포터를 못 쓰고 v8 직렬화로 말한다.
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return { ...env, ...extra };
}

function run(dir, { args = [], nodeArgs = [], env = {} } = {}) {
  const r = spawnSync(process.execPath, [...nodeArgs, wrapper, ...args], { cwd: dir, env: cleanEnv(env), encoding: "utf8", timeout: 60000 });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, signal: r.signal, out: r.stdout, err: r.stderr };
}

test("정상: 출력이 흐르고 래칫이 한 줄 늘며 종료 0", () => {
  const r = run(fixture({ "a.test.mjs": PASS }, "1\n1\n"));
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✔ 통과 한 개/);
  assert.match(r.out, /^ℹ tests 1$/m);
  assert.match(r.out, /래칫 통과: tests 1개 >= 1 · pass 1개 >= 1/);
});

test("글롭 매치 0(#315 구멍 2): 러너는 종료 0이지만 래퍼는 [개수]로 종료 1", () => {
  const dir = fixture({}, "1\n1\n");
  const raw = spawnSync(process.execPath, ["--test", "test/*.test.{mjs,ts}"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  assert.equal(raw.status, 0, "전제: 맨 `node --test`는 매치 0이어도 종료 0이다 - 아니면 이 구멍이 막혔으니 래퍼의 근거를 다시 본다");
  assert.match(raw.stdout, /^ℹ tests 0$/m);
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.err, /래칫 실패\[개수\]: tests 0개 < 하한 1개/);
  assert.doesNotMatch(r.err, /\[종료 코드\]|\[형식\]|\[하한 파일\]|\[Node\]|\[시그널\]/, "개수 가드만 물었다");
});

test("전부 skip: tests는 하한을 넘어도 pass 하한이 [개수]로 문다", () => {
  const r = run(fixture({ "a.test.mjs": SKIP }, "1\n1\n"));
  assert.equal(r.status, 1);
  assert.match(r.out, /^ℹ skipped 1$/m);
  assert.match(r.err, /래칫 실패\[개수\]: pass 0개 < 하한 1개/);
  assert.doesNotMatch(r.err, /tests 0개 < /);
});

test("시험 빨강: 러너의 종료 코드가 그대로 가고 [종료 코드]가 찍히며 실패 내역이 흐른다", () => {
  const r = run(fixture({ "a.test.mjs": PASS, "b.test.mjs": RED }, "0\n0\n"));
  assert.equal(r.status, 1);
  assert.match(r.out, /✖ 빨강 한 개/);
  assert.match(r.err, /run-tests 실패\[종료 코드\]: 러너가 종료 코드 1로/);
  assert.doesNotMatch(r.out + r.err, /래칫 통과/, "시험 빨강 + 래칫 통과가 초록이 되는 길이 없다");
});

test("하한 파일: 없으면 시험을 돌리기 전에 [하한 파일]로 종료 1", () => {
  const r = run(fixture({ "a.test.mjs": PASS }, null));
  assert.equal(r.status, 1);
  assert.match(r.err, /래칫 실패\[하한 파일\].*읽지 못했다\(ENOENT\)/);
  assert.equal(r.out, "", "러너를 띄우지 않았다");
});

test("하한 파일: 읽기 실패(파일이 아니라 폴더)도 [하한 파일]로 종료 1", () => {
  const dir = fixture({ "a.test.mjs": PASS }, null);
  mkdirSync(path.join(dir, "test", "COUNT"));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.err, /래칫 실패\[하한 파일\].*읽지 못했다\(EISDIR\)/);
});

test("하한 파일: 숫자 줄이 셋·넷이거나 하나이거나 숫자가 아니면 [하한 파일]로 종료 1 - 래퍼와 래칫 스크립트 둘 다", () => {
  const cases = {
    "셋": "# 낡은 쌍\n1\n1\n9\n",
    "넷": "1\n1\n# 센 법\n2\n2\n",
    "하나": "# 주석\n1\n",
    "숫자 아님": "1\nabc\n",
    "빈 파일": "# 주석뿐\n",
  };
  for (const [name, count] of Object.entries(cases)) {
    const r = run(fixture({ "a.test.mjs": PASS }, count));
    assert.equal(r.status, 1, `${name}: 래퍼`);
    assert.match(r.err, /래칫 실패\[하한 파일\]/, name);
    assert.equal(r.out, "", `${name}: 시험을 돌리기 전에 멈춘다`);

    const dir = fixture({}, count);
    writeFileSync(path.join(dir, "log.txt"), "ℹ tests 5\nℹ pass 5\n");
    const cli = spawnSync(process.execPath, [ratchetCli, "test/COUNT", "log.txt"], { cwd: dir, encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    assert.equal(cli.status, 1, `${name}: 래칫 스크립트`);
    assert.match(cli.stderr, /래칫 실패\[하한 파일\]/, name);
  }
});

test("하한 파일: 주석과 빈 줄을 사이에 두어도 숫자 줄이 정확히 둘이면 읽는다", () => {
  const dir = fixture({}, "# a\n\n12\n# b\n\n11\n# c\n");
  assert.deepEqual(readFloors(path.join(dir, "test", "COUNT")), { tests: 12, pass: 11 });
  rmSync(dir, { recursive: true, force: true });
});

test("형식 드리프트: 합계 줄이 없는 출력은 통과가 아니라 [형식] 실패다", () => {
  const floors = { tests: 1, pass: 1 };
  const label = { floorPath: "test/COUNT", logLabel: "로그" };
  assert.deepEqual(checkRatchet(floors, "ℹ tests 5\nℹ pass 5\n", label).ok, true);
  assert.deepEqual(checkRatchet(floors, "# tests 5\n# pass 5\n", label).ok, true, "tap 리포터 모양도 읽는다");
  assert.deepEqual(checkRatchet(floors, "\x1b[34mℹ\x1b[39m tests 5\n\x1b[34mℹ\x1b[39m pass 5\n", label).ok, true, "터미널의 색 이스케이프는 벗기고 읽는다");
  const noTests = checkRatchet(floors, "ℹ pass 5\n", label);
  assert.equal(noTests.ok, false);
  assert.match(noTests.lines[0], /래칫 실패\[형식\].*"ℹ tests N"/);
  const noPass = checkRatchet(floors, "ℹ tests 5\n", label);
  assert.match(noPass.lines[0], /래칫 실패\[형식\].*"ℹ pass N"/);
  assert.equal(checkRatchet(floors, "", label).ok, false);
});

test("리포터 가로채기(NODE_OPTIONS=--test-reporter=tap): 틀린 통과가 없다 - 나온 모양은 관측이다", (t) => {
  const r = run(fixture({ "a.test.mjs": PASS }, "1\n1\n"), { env: { NODE_OPTIONS: "--test-reporter=tap" } });
  // 합격선은 하나다: 형식이 바뀌었는데 종료 0으로 통과하는 것이 불합격. 어떤 모양으로 막혔는지는 단언하지 않는다(좁히지 않는다).
  if (r.status === 0) assert.match(r.out, /래칫 통과/, "종료 0이면 래칫이 정상 형식을 읽고 통과했어야 한다");
  else assert.ok(r.status > 0 || r.signal !== null);
  t.diagnostic(`관측: 종료 ${r.status} · ${r.err.includes("ERR_INVALID_ARG_VALUE") ? "러너 크래시(ERR_INVALID_ARG_VALUE)" : r.status === 0 ? "argv가 이김" : "그 밖"} · ${(r.err + r.out).match(/래칫 [^\n]*|run-tests 실패[^\n]*/g)?.join(" / ")}`);
});

test("출력 동일: 합계 줄과 실패 목록이 맨 `node --test`와 같고 래칫 한 줄만 는다", () => {
  const files = { "a.test.mjs": PASS, "b.test.mjs": RED };
  const strip = (s) =>
    s
      .split("\n")
      .filter((l) => !/^ℹ (duration_ms|suites)/.test(l) && !/^\s*$/.test(l))
      .map((l) => l.replace(/ \([0-9.]+ms\)/g, "").replace(/\bduration_ms\b.*/, ""))
      .filter((l) => /^(ℹ |✖|✔|\s+(✖|✔))/.test(l) || /빨강|AssertionError|expected|actual/.test(l));
  const dir = fixture(files, "0\n0\n");
  const raw = spawnSync(process.execPath, ["--test", "--test-reporter=spec", "--test-reporter-destination=stdout", "test/*.test.{mjs,ts}"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  const wrapped = run(dir);
  assert.equal(raw.status, wrapped.status);
  assert.deepEqual(strip(wrapped.out), strip(raw.stdout));
  assert.match(wrapped.err, /\[종료 코드\]/);
});

test("인자 통과: `npm test -- <인자>`가 러너에 닿는다", () => {
  const two = 'import test from "node:test";\ntest("고른 것", () => {});\ntest("안 고른 것", () => {});\n';
  const r = run(fixture({ "a.test.mjs": two }, "0\n0\n"), { args: ["--test-name-pattern=^고른 것$"] });
  assert.match(r.out, /✔ 고른 것/);
  assert.doesNotMatch(r.out, /✔ 안 고른 것/);
});

test("시그널: 러너가 SIGKILL로 죽으면 래칫을 돌리지 않고 [시그널]로 종료 1", async () => {
  // 시험 파일이 자기 부모(= 러너)를 죽인다.
  const kill = 'import test from "node:test";\ntest("부모를 죽인다", async () => { process.kill(process.ppid, "SIGKILL"); await new Promise((r) => setTimeout(r, 5000)); });\n';
  const r = run(fixture({ "a.test.mjs": kill }, "1\n1\n"));
  assert.equal(r.status, 1);
  assert.match(r.err, /run-tests 실패\[시그널\]: 러너가 SIGKILL로 끝났다/);
  assert.doesNotMatch(r.out + r.err, /래칫 (통과|실패)/, "래칫이 돌지 않았다");
});

test("시그널: 러너가 SIGTERM을 잡아 비0으로 끝나도 시험 빨강처럼 비0이고 통과가 없다", () => {
  const term = 'import test from "node:test";\ntest("부모를 죽인다", async () => { process.kill(process.ppid, "SIGTERM"); await new Promise((r) => setTimeout(r, 5000)); });\n';
  const r = run(fixture({ "a.test.mjs": term }, "1\n1\n"));
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.out + r.err, /래칫 통과/);
});

test("Node 기능 단언: 타입 스트리핑이 strip이 아니면 시험을 돌리기 전에 [Node]로 종료 1 - 찾은 버전과 값을 말한다", () => {
  for (const [flag, value] of [["--experimental-transform-types", "transform"], ["--no-experimental-strip-types", "false"]]) {
    const r = run(fixture({ "a.test.mjs": PASS }, "1\n1\n"), { nodeArgs: [flag] });
    assert.equal(r.status, 1, flag);
    assert.match(r.err, /run-tests 실패\[Node\]: 타입 스트리핑이 켜진 Node 24 이상이 필요하다/, flag);
    assert.ok(r.err.includes(`찾은 Node: ${process.version}`), flag);
    assert.ok(r.err.includes(`process.features.typescript: ${JSON.stringify(value === "false" ? false : value)}`), `${flag}: ${r.err}`);
    assert.equal(r.out, "", `${flag}: 러너를 띄우지 않았다`);
  }
});

test("래칫 스크립트는 로그 파일로도 그대로 돈다(test.yml의 옛 스텝 모양)", () => {
  const dir = fixture({}, "5\n5\n");
  writeFileSync(path.join(dir, "ok.log"), "ℹ tests 5\nℹ pass 5\n");
  writeFileSync(path.join(dir, "low.log"), "ℹ tests 4\nℹ pass 4\n");
  const ok = spawnSync(process.execPath, [ratchetCli, "test/COUNT", "ok.log"], { cwd: dir, encoding: "utf8" });
  const low = spawnSync(process.execPath, [ratchetCli, "test/COUNT", "low.log"], { cwd: dir, encoding: "utf8" });
  const usage = spawnSync(process.execPath, [ratchetCli], { cwd: dir, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /래칫 통과: tests 5개 >= 5/);
  assert.equal(low.status, 1);
  assert.match(low.stderr, /래칫 실패\[개수\]: tests 4개 < 하한 5개/);
  assert.equal(usage.status, 2);
});

test("저장소의 COUNT 셋은 숫자 줄이 정확히 둘이다(쌍을 덧붙이지 않고 첫 두 줄을 고친다)", () => {
  for (const p of ["test/COUNT", "tools/golden/test/COUNT", "tools/render/test/COUNT", "tools/health/test/COUNT"]) {
    const f = readFloors(path.join(root, p));
    assert.ok(f.tests >= f.pass && f.pass > 0, `${p}: ${JSON.stringify(f)}`);
  }
});

// ---- 호출 불변: `node --test`를 적은 곳이 허용 목록(test/NODE-TEST-CALLS)뿐이다 (#319 범위 9) ----
// 모든 호출이 `npm test`를 지난다는 전제에 이 전략이 기댄다. #320의 「발견」 불변(어느 파일이 시험인가)과 달리 「호출」 불변이다.
// 확장자 필터는 `.mjs`로 박지 않는다(#316 0단계 직전에 새 축 ⑥ 자리를 만들지 않는다).
const SCANNED = /\.(mjs|ts)$/;
const DIRECT_CALL = /(?:\bnode\b[^\n]*\s|["'`])--test(?![\w-])/;

function isComment(file, trimmed) {
  if (file.endsWith(".yml") || file.endsWith(".yaml")) return trimmed.startsWith("#");
  if (SCANNED.test(file)) return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
  return false;
}

// files: [{ file, text }] -> 명령 위치에서 러너를 부르는 줄들 `파일 | 줄`.
export function findDirectRunnerCalls(files) {
  const hits = [];
  for (const { file, text } of files) {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t !== "" && !isComment(file, t) && DIRECT_CALL.test(t)) hits.push(`${file} | ${t}`);
    }
  }
  return hits;
}

function readAllowlist() {
  return readFileSync(path.join(root, "test", "NODE-TEST-CALLS"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function scannedFiles() {
  const rel = (p) => path.relative(root, p).split(path.sep).join("/");
  const picked = [
    ...walk(path.join(root, ".github", "workflows")).filter((p) => /\.ya?ml$/.test(p)),
    ...walk(path.join(root, "scripts")).filter((p) => SCANNED.test(p)),
    path.join(root, "package.json"),
    path.join(root, "tools", "golden", "package.json"),
    path.join(root, "tools", "render", "package.json"),
    path.join(root, "tools", "health", "package.json"),
  ];
  return picked.map((p) => ({ file: rel(p), text: readFileSync(p, "utf8") }));
}

test("호출 불변: 러너를 직접 부르는 곳이 허용 목록뿐이고, 허용 목록의 줄이 모두 실제로 있다", () => {
  const files = scannedFiles();
  assert.ok(files.filter((f) => f.file.startsWith(".github/workflows/")).length >= 10, "워크플로 10개 전수를 훑는다");
  assert.ok(files.some((f) => f.file === "scripts/run-tests.mjs"));
  const allow = readAllowlist();
  const hits = findDirectRunnerCalls(files);
  assert.deepEqual(hits.filter((h) => !allow.includes(h)), [], "허용 목록에 없는 곳이 `node --test`를 직접 부른다 - `npm test`를 지나게 한다");
  assert.deepEqual(allow.filter((a) => !hits.includes(a)), [], "허용 목록에 있는데 파일에서 사라진 줄이 있다 - 목록에서도 뺀다");
});

test("호출 불변: 네 package.json의 test는 래퍼 한 줄이고 test:live만 러너를 직접 부른다", () => {
  const want = { "package.json": "node scripts/run-tests.mjs", "tools/golden/package.json": "node ../../scripts/run-tests.mjs", "tools/render/package.json": "node ../../scripts/run-tests.mjs", "tools/health/package.json": "node ../../scripts/run-tests.mjs" };
  for (const [p, cmd] of Object.entries(want)) {
    const scripts = JSON.parse(readFileSync(path.join(root, p), "utf8")).scripts;
    assert.equal(scripts.test, cmd, p);
    for (const [name, line] of Object.entries(scripts)) {
      if (name !== "test") assert.equal(DIRECT_CALL.test(line), p === "tools/golden/package.json" && name === "test:live", `${p} ${name}`);
    }
  }
});

test("호출 불변 대조군: 명령 위치의 `node --test`는 잡고, 주석·test:live 허용·래퍼 호출은 거짓 실패를 안 낸다", () => {
  const f = (file, text) => findDirectRunnerCalls([{ file, text }]);
  // 양성: 워크플로 명령 위치(들여쓴 run, 파이프 뒤, 블록 안), .mjs의 spawn 인자, package.json.
  assert.deepEqual(f(".github/workflows/x.yml", "      - run: node --test test/a.test.mjs\n"), [".github/workflows/x.yml | - run: node --test test/a.test.mjs"]);
  assert.equal(f(".github/workflows/x.yml", "        run: |\n          set -e\n          node --test 'test/*.test.{mjs,ts}' | tee log\n").length, 1);
  assert.equal(f(".github/workflows/x.yml", "        run: GOLDEN_LIVE=1 node --experimental-test-coverage --test test/\n").length, 1);
  assert.equal(f("scripts/x.mjs", 'spawn(process.execPath, ["--test", "a"]);\n').length, 1);
  assert.equal(f("scripts/x.ts", "execSync('node --test');\n").length, 1);
  assert.equal(f("package.json", '    "t": "node --test x"\n').length, 1);
  // 음성: 주석 줄(지금 main에 있는 둘 - test.yml 53행, test-count-ratchet.mjs 4행 - 과 같은 모양).
  assert.deepEqual(f(".github/workflows/test.yml", "      # (2) 글롭이 하나도 안 맞아도 `node --test`의 종료 코드가 0이다\n"), []);
  assert.deepEqual(f("scripts/x.mjs", "// `node --test`에는 구멍이 둘 있다\n"), []);
  assert.deepEqual(f("scripts/x.mjs", " * node --test 를 부른다\n/* node --test */\n"), []);
  // 음성: 래퍼 호출·리포터 인자·`--test-name-pattern` 같은 이름이 긴 옵션.
  assert.deepEqual(f("package.json", '    "test": "node scripts/run-tests.mjs"\n'), []);
  assert.deepEqual(f("scripts/x.mjs", 'const a = ["--test-reporter=spec"];\n'), []);
  assert.deepEqual(f("scripts/x.mjs", 'run("node", ["scripts/a.mjs", "--test-mode"]);\n'), []);
  // 허용 목록: test:live는 목록에 있어 거짓 실패를 안 낸다.
  const live = f("tools/golden/package.json", '    "test:live": "GOLDEN_LIVE=1 node --test test/live.test.ts"\n');
  assert.equal(live.length, 1);
  assert.ok(readAllowlist().includes(live[0]));
});
