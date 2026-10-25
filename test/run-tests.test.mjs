import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRatchet, parseTotals, readFloors } from "../scripts/test-count-ratchet.mjs";
import { COUNT_HEADER, S6_UPDATE, SUITES, bumpFloor, decideBump, renderCount } from "../scripts/count-bump.mjs";

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

// ---- COUNT 머리 주석 ≤6줄 + 하한 갱신(scripts/count-bump.mjs) 대조군 (#548) ----
// 설명 블록은 PR 본문·이력에 둔다 — COUNT 는 고정 머리와 숫자 둘뿐이다. 실제 시험을 돌리지 않고 임시 사본과 합성 로그로만 본다.
const COUNT_FILES = [
  "test/COUNT",
  "test/COUNT-site",
  ...readdirSync(path.join(root, "tools"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join("tools", d.name, "test", "COUNT"))
    .filter((p) => existsSync(path.join(root, p))),
];

function logOf({ tests, pass, skipped = 0, fail = 0, cancelled = 0 }) {
  return `ℹ tests ${tests}\nℹ suites 0\nℹ pass ${pass}\nℹ fail ${fail}\nℹ cancelled ${cancelled}\nℹ skipped ${skipped}\nℹ todo 0\n`;
}

function countFixture(text) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "jipgye-count-bump-"));
  const file = path.join(dir, "COUNT");
  writeFileSync(file, text);
  return { dir, file };
}

test("COUNT 파일: 머리 주석은 ≤6줄이고 숫자 둘 앞에만 있다(설명 블록 금지)", () => {
  assert.deepEqual(
    COUNT_FILES.slice(0, 2).concat(COUNT_FILES.slice(2).sort()),
    ["test/COUNT", "test/COUNT-site", ...["golden", "health", "render"].map((n) => `tools/${n}/test/COUNT`)],
    "전제: 다섯 COUNT 파일이 모두 잡힌다 - 새 패키지는 SUITES 와 이 목록을 같이 고친다",
  );
  for (const p of COUNT_FILES) {
    const lines = readFileSync(path.join(root, p), "utf8").trimEnd().split("\n");
    const numbers = lines.filter((l) => /^\d+$/.test(l));
    const comments = lines.filter((l) => l.startsWith("#"));
    assert.equal(numbers.length, 2, `${p}: 숫자 줄 둘`);
    assert.equal(comments.length + numbers.length, lines.length, `${p}: 주석·숫자 말고 다른 줄이 있다`);
    assert.ok(comments.length <= 6, `${p}: 머리 주석 ${comments.length}줄 > 6 - 설명은 PR 본문에 둔다`);
    assert.deepEqual(lines.slice(0, comments.length), comments, `${p}: 주석은 숫자 앞 머리에만 둔다`);
  }
  assert.ok(COUNT_HEADER.split("\n").length <= 6, "count-bump 가 쓰는 고정 머리도 ≤6줄");
});

test("parseTotals: spec·tap·색 이스케이프를 읽고 마지막 합계를 쓰며 없는 줄은 null", () => {
  assert.deepEqual(parseTotals(logOf({ tests: 5, pass: 4, skipped: 1 })), { tests: 5, pass: 4, skipped: 1, fail: 0, cancelled: 0 });
  assert.equal(parseTotals("# tests 7\n# pass 6\n# skipped 1\n# fail 0\n# cancelled 0\n").tests, 7);
  assert.equal(parseTotals("\x1b[34mℹ\x1b[39m tests 5\n\x1b[34mℹ\x1b[39m pass 5\n").pass, 5);
  assert.equal(parseTotals("ℹ tests 1\nℹ pass 1\nℹ tests 9\nℹ pass 8\n").tests, 9, "마지막 합계");
  assert.deepEqual(parseTotals(""), { tests: null, pass: null, skipped: null, fail: null, cancelled: null });
});

test("count-bump: 올릴 때 고정 머리 + 숫자 둘만 쓴다(옛 설명 블록은 사라진다)", () => {
  const long = "# 옛 설명\n".repeat(30) + "5\n4\n";
  const { dir, file } = countFixture(long);
  const d = bumpFloor(file, logOf({ tests: 9, pass: 8, skipped: 1 }), { exitCode: 0 });
  const text = readFileSync(file, "utf8");
  rmSync(dir, { recursive: true, force: true });
  assert.equal(d.ok, true, d.lines.join("\n"));
  assert.equal(text, renderCount({ tests: 9, pass: 8 }));
  assert.equal(text, `${COUNT_HEADER}\n9\n8\n`);
  assert.ok(text.trimEnd().split("\n").length <= 8, "머리 ≤6줄 + 숫자 둘");
});

test("count-bump: 하한을 내리는 쓰기는 --allow-lower 없이 거부하고 파일은 그대로, 있으면 쓴다", () => {
  const before = "10\n9\n";
  const { dir, file } = countFixture(before);
  const lower = logOf({ tests: 8, pass: 7, skipped: 1 });
  const d = bumpFloor(file, lower, { exitCode: 0 });
  assert.equal(d.ok, false);
  assert.match(d.lines[0], /거부\[내림\].*tests 8 < 하한 10.*pass 7 < 하한 9/);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(bumpFloor(file, logOf({ tests: 11, pass: 8, skipped: 3 }), { exitCode: 0, allowLower: true }).ok, true, "tests 는 올라도 pass 가 내리면 내림이다 - 허용 플래그로만");
  assert.equal(readFileSync(file, "utf8"), renderCount({ tests: 11, pass: 8 }));
  rmSync(dir, { recursive: true, force: true });
});

test("count-bump: 초록이 아닌 로그는 거부한다(fail·cancelled·종료 코드·합계 줄 없음·skip 증가·0)", () => {
  const before = "10\n9\n";
  const { dir, file } = countFixture(before);
  const cases = [
    ["fail 1", logOf({ tests: 20, pass: 19, skipped: 0, fail: 1 }), 0, /거부\[실패\]/],
    ["cancelled 1", logOf({ tests: 20, pass: 19, cancelled: 1 }), 0, /거부\[실패\]/],
    ["종료 코드 1", logOf({ tests: 20, pass: 19, skipped: 1 }), 1, /거부\[종료 코드\]/],
    ["합계 줄 없음", "ℹ tests 20\nℹ pass 19\n", 0, /거부\[형식\]/],
    ["빈 로그", "", 0, /거부\[형식\]/],
    ["skip 증가", logOf({ tests: 20, pass: 18, skipped: 2 }), 0, /거부\[skip\].*skipped 2 > .*1/],
    ["pass 0", logOf({ tests: 20, pass: 0, skipped: 20 }), 0, /거부\[(개수|skip)\]/],
  ];
  for (const [name, log, exitCode, re] of cases) {
    const d = bumpFloor(file, log, { exitCode });
    assert.equal(d.ok, false, name);
    assert.match(d.lines[0], re, name);
    assert.equal(readFileSync(file, "utf8"), before, `${name}: 파일 그대로`);
  }
  // --allow-lower 도 빨강은 받지 않는다. 래칫([개수])으로만 빨간 것은 받는다.
  assert.equal(bumpFloor(file, logOf({ tests: 20, pass: 19, fail: 1 }), { exitCode: 1, allowLower: true }).ok, false);
  const redRun = `${logOf({ tests: 20, pass: 19, skipped: 1 })}run-tests 실패[종료 코드]: 러너가 종료 코드 1로 끝났다.\n`;
  assert.equal(bumpFloor(file, redRun, { exitCode: 1, allowLower: true }).ok, false);
  assert.equal(readFileSync(file, "utf8"), before);
  rmSync(dir, { recursive: true, force: true });
});

test("count-bump: 하한과 같거나 오른 값은 받는다 - 같으면 그대로, 오르면 쓴다, skip 이 줄면 받는다", () => {
  assert.deepEqual(decideBump({ tests: 121, pass: 110 }, logOf({ tests: 121, pass: 110, skipped: 11 }), { exitCode: 0 }).write, { tests: 121, pass: 110 });
  assert.match(decideBump({ tests: 121, pass: 110 }, logOf({ tests: 121, pass: 110, skipped: 11 }), { exitCode: 0 }).lines[0], /^그대로/);
  const { dir, file } = countFixture(renderCount({ tests: 5, pass: 5 }));
  const same = bumpFloor(file, logOf({ tests: 5, pass: 5 }), { exitCode: 0 });
  assert.equal(same.ok, true);
  assert.equal(readFileSync(file, "utf8"), renderCount({ tests: 5, pass: 5 }));
  const up = bumpFloor(file, logOf({ tests: 7, pass: 7 }), { exitCode: 0 });
  assert.equal(up.ok, true);
  assert.match(up.lines[0], /^갱신: tests 5 → 7 · pass 5 → 7/);
  assert.deepEqual(readFloors(file), { tests: 7, pass: 7 });
  const fewerSkips = bumpFloor(file, logOf({ tests: 7, pass: 7 }), { exitCode: 0 });
  assert.equal(fewerSkips.ok, true);
  const dry = bumpFloor(file, logOf({ tests: 9, pass: 9 }), { exitCode: 0, dryRun: true });
  assert.equal(dry.ok, true);
  assert.deepEqual(readFloors(file), { tests: 7, pass: 7 }, "--dry-run 은 쓰지 않는다");
  rmSync(dir, { recursive: true, force: true });
});

test("count-bump CLI(--floor/--log): 올리면 0·쓰고, 내리면 1·그대로, --dry-run 은 쓰지 않는다 - 시험은 돌리지 않는다", () => {
  const { dir, file } = countFixture("# 옛 설명\n3\n3\n");
  const logFile = path.join(dir, "run.log");
  const cli = (args) => spawnSync(process.execPath, [path.join(root, "scripts", "count-bump.mjs"), "--floor", file, "--log", logFile, ...args], { encoding: "utf8" });
  writeFileSync(logFile, logOf({ tests: 4, pass: 4 }));
  assert.equal(cli(["--dry-run"]).status, 0);
  assert.equal(readFileSync(file, "utf8"), "# 옛 설명\n3\n3\n");
  const up = cli(["--exit", "0"]);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(readFileSync(file, "utf8"), renderCount({ tests: 4, pass: 4 }));
  writeFileSync(logFile, logOf({ tests: 2, pass: 2 }));
  const low = cli([]);
  assert.equal(low.status, 1);
  assert.match(low.stderr, /거부\[내림\]/);
  assert.deepEqual(readFloors(file), { tests: 4, pass: 4 });
  assert.equal(cli(["--allow-lower"]).status, 0);
  assert.deepEqual(readFloors(file), { tests: 2, pass: 2 });
  assert.equal(spawnSync(process.execPath, [path.join(root, "scripts", "count-bump.mjs"), "--floor", file], { encoding: "utf8" }).status, 2, "--log 없이는 사용법 오류");
  rmSync(dir, { recursive: true, force: true });
});

test("count-bump 배선: SUITES 의 하한 파일이 COUNT 파일 목록과 같고, cwd 가 있고, package.json 에 count:bump 가 있다", () => {
  assert.deepEqual(SUITES.map((s) => s.floor).sort(), [...COUNT_FILES].sort(), "COUNT 파일마다 그것을 갱신하는 패키지 시험이 하나씩");
  for (const s of SUITES) assert.ok(existsSync(path.join(root, s.cwd)), `${s.name}: cwd ${s.cwd}`);
  assert.equal(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts["count:bump"], "node scripts/count-bump.mjs");
});

test("count-bump S6 기준선 갱신 배선(#561): 기준선 파일·시험 파일이 있고 이름 패턴이 시험 하나를 가리키며 갱신 환경변수가 1이다", () => {
  assert.ok(existsSync(path.join(root, S6_UPDATE.file)));
  const file = S6_UPDATE.cmd[S6_UPDATE.cmd.length - 1];
  const pattern = S6_UPDATE.cmd.find((a) => a.startsWith("--test-name-pattern=")).slice("--test-name-pattern=".length);
  const names = [...readFileSync(path.join(root, file), "utf8").matchAll(/^test\("([^"]+)"/gm)].map((m) => m[1]).filter((n) => n.includes(pattern));
  assert.equal(names.length, 1, `패턴 "${pattern}" 이 ${file} 의 시험 ${names.length}개를 가리킨다 - 정확히 하나여야 한다`);
  assert.equal(S6_UPDATE.env.S6_BASELINE_UPDATE, "1");
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
