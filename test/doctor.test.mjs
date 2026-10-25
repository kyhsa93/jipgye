import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/dev/doctor.sh (#600): 워크트리 사전 점검 + --link. 합성 저장소 루트·공유 폴더만 쓴다 - 실제 node_modules 는 건드리지 않는다.
const DOCTOR = path.resolve(import.meta.dirname, "..", "scripts", "dev", "doctor.sh");
const put = (p, text = "") => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };
const pkg = (dir, name) => { put(path.join(dir, name, "package.json"), `{"name":"${name}","main":"index.js"}`); put(path.join(dir, name, "index.js"), ""); put(path.join(dir, name, "server.js"), ""); };

// 합성 저장소: opts.nodeModules / opts.golden 이 true 면 실제 폴더를 만든다. react-dom 은 opts.reactDom 일 때만 넣는다.
function fixture(opts = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), "jipgye-doctor-"));
  const root = path.join(base, "repo"), shared = path.join(base, "shared");
  put(path.join(root, "package.json"), '{\n  "name": "jipgye"\n}\n');
  put(path.join(root, "scripts/dev/golden-run.sh"), "#!/bin/bash\n"); chmodSync(path.join(root, "scripts/dev/golden-run.sh"), 0o755);
  put(path.join(root, "scripts/dev/golden-expect.mjs"));
  mkdirSync(path.join(root, "tools/golden"), { recursive: true });
  if (opts.nodeModules) { mkdirSync(path.join(root, "node_modules"), { recursive: true }); if (opts.reactDom) pkg(path.join(root, "node_modules"), "react-dom"); }
  if (opts.golden) pkg(path.join(root, "tools/golden/node_modules"), "parse5");
  // 공유 폴더(링크 원본)
  mkdirSync(path.join(shared, "node_modules"), { recursive: true }); pkg(path.join(shared, "node_modules"), "react-dom");
  pkg(path.join(shared, "tools/golden/node_modules"), "parse5");
  return { base, root, shared, done: () => rmSync(base, { recursive: true, force: true }) };
}
const run = (f, args = [], env = {}) => spawnSync("/bin/bash", [DOCTOR, "--root", f.root, "--shared", f.shared, ...args], {
  encoding: "utf8", env: { PATH: "/usr/bin:/bin", NODE24_BIN: process.execPath, ...env },
});

test("모두 갖춰지면 종료 0, 출력 ≤8줄, 설치 없이 점검만 한다", () => {
  const f = fixture({ nodeModules: true, reactDom: true, golden: true });
  try {
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.trim().split("\n").length <= 8);
    assert.match(r.stdout, /typescript=strip/);
    assert.equal(r.stderr, "");
  } finally { f.done(); }
});

test("react-dom 이 없으면 비0 종료하고 한 줄 이유를 stderr 로 찍는다", () => {
  const f = fixture({ nodeModules: true, reactDom: false, golden: true });
  try {
    const r = run(f);
    assert.equal(r.status, 1);
    const lines = r.stderr.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^doctor 실패: react-dom:/);
  } finally { f.done(); }
});

test("Node 가 strip 이 아니면 비0 종료한다", () => {
  const f = fixture({ nodeModules: true, reactDom: true, golden: true });
  try {
    const fake = path.join(f.base, "fakenode"); put(fake, "#!/bin/bash\necho false\n"); chmodSync(fake, 0o755);
    const r = run(f, [], { NODE24_BIN: fake });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /doctor 실패: Node: .*strip/);
  } finally { f.done(); }
});

test("골든 실행기·예외 도구가 없으면 한 줄씩 실패로 센다", () => {
  const f = fixture({ nodeModules: true, reactDom: true, golden: true });
  try {
    rmSync(path.join(f.root, "scripts/dev/golden-run.sh")); rmSync(path.join(f.root, "scripts/dev/golden-expect.mjs"));
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /golden-run\.sh: 없다/);
    assert.match(r.stderr, /golden-expect\.mjs: 없다/);
  } finally { f.done(); }
});

test("끊긴 node_modules 링크는 점검이 실패시키고 --link 가 고친다(멱등)", () => {
  const f = fixture({ golden: true });
  try {
    symlinkSync(path.join(f.base, "nowhere"), path.join(f.root, "node_modules"));
    const bad = run(f);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /node_modules: 심볼릭 링크가 끊겼다/);
    const r1 = run(f, ["--link"]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(readlinkSync(path.join(f.root, "node_modules")), path.join(f.shared, "node_modules"));
    const r2 = run(f, ["--link"]);
    assert.equal(r2.status, 0, r2.stderr);
    assert.doesNotMatch(r2.stdout, /새로 연결/);
  } finally { f.done(); }
});

test("--link: 없는 두 곳만 링크하고, 이미 있는 실제 폴더와 공유 폴더·저장소 밖은 건드리지 않는다", () => {
  const f = fixture({ nodeModules: true, reactDom: true });
  try {
    const sharedBefore = readdirSync(f.shared, { recursive: true }).sort();
    const rootBefore = readdirSync(f.root).sort();
    const r = run(f, ["--link"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!lstatSync(path.join(f.root, "node_modules")).isSymbolicLink(), "실제 node_modules 는 그대로");
    assert.ok(lstatSync(path.join(f.root, "tools/golden/node_modules")).isSymbolicLink());
    assert.deepEqual(readdirSync(f.shared, { recursive: true }).sort(), sharedBefore);
    assert.deepEqual(readdirSync(f.root).sort(), rootBefore);
    assert.deepEqual(readdirSync(f.base).sort(), ["repo", "shared"]);
  } finally { f.done(); }
});

test("--link 는 jipgye 저장소 루트가 아니면 아무것도 만들지 않고 종료 1", () => {
  const f = fixture({ golden: true });
  try {
    writeFileSync(path.join(f.root, "package.json"), '{"name":"other"}');
    const r = run(f, ["--link"]);
    assert.equal(r.status, 1);
    assert.ok(!existsSync(path.join(f.root, "node_modules")));
  } finally { f.done(); }
});
