import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/dev/weekly-metrics.mjs (#604): 주간 측정. PATH 앞의 가짜 `gh` 로만 돈다 - 네트워크·실제 저장소를 쓰지 않는다.
// 가짜 gh 는 상태 파일(STUB_STATE)의 prs·runs 를 그대로 JSON 으로 답하고, 부른 인자를 STUB_LOG 에 한 줄씩 남긴다.
const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "dev", "weekly-metrics.mjs");
const NOW = "2026-10-25T12:00:00Z";

const SHIM = (nodeBin) => `#!${nodeBin}
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(a) + "\\n");
const st = JSON.parse(fs.readFileSync(process.env.STUB_STATE, "utf8"));
if (st.fail) { console.error("가짜 gh: 실패"); process.exit(1); }
if (a[0] === "pr" && a[1] === "list") console.log(JSON.stringify(st.prs));
else if (a[0] === "run" && a[1] === "list") console.log(JSON.stringify(st.runs));
else { console.error("가짜 gh: 모르는 호출 " + a.join(" ")); process.exit(9); }
`;

const pr = (number, mergedAt, hours, verdicts, oid) => ({
  number,
  createdAt: new Date(new Date(mergedAt) - hours * 3600000).toISOString(),
  mergedAt,
  mergeCommit: { oid },
  reviews: Array.from({ length: Math.floor(verdicts / 2) }, () => ({})),
  comments: Array.from({ length: verdicts - Math.floor(verdicts / 2) }, () => ({})),
});

function fixture(state) {
  const base = mkdtempSync(path.join(os.tmpdir(), "jipgye-weekly-"));
  const bin = path.join(base, "bin"); mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), SHIM(process.execPath)); chmodSync(path.join(bin, "gh"), 0o755);
  const stateFile = path.join(base, "state.json"), log = path.join(base, "gh.log");
  writeFileSync(stateFile, JSON.stringify(state));
  const calls = () => { try { return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const run = (args = []) => spawnSync(process.execPath, [SCRIPT, "--repo", "o/r", "--now", NOW, ...args], {
    encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, STUB_STATE: stateFile, STUB_LOG: log },
  });
  return { run, calls, done: () => rmSync(base, { recursive: true, force: true }) };
}

const STATE = {
  prs: [
    pr(1, "2026-10-24T10:00:00Z", 1, 2, "a1"),
    pr(2, "2026-10-23T10:00:00Z", 3, 4, "b2"),   // 병합 커밋의 Test push 가 failure
    pr(3, "2026-10-22T10:00:00Z", 2, 0, "c3"),
    pr(4, "2026-10-10T10:00:00Z", 9, 9, "d4"),   // 7일 밖: 센다면 평균이 틀어진다
  ],
  runs: [
    { headSha: "a1", conclusion: "success", status: "completed" },
    { headSha: "b2", conclusion: "failure", status: "completed" },
    { headSha: "c3", conclusion: "success", status: "completed" },
    { headSha: "d4", conclusion: "failure", status: "completed" },
    { headSha: "zz", conclusion: "failure", status: "completed" }, // PR 과 무관한 커밋
  ],
};

test("--json: 7일 안 병합 PR 만 세고 판정 수 근사·Test 빨강·주기 중앙값을 낸다", () => {
  const f = fixture(STATE);
  try {
    const r = f.run(["--json"]);
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(r.stdout);
    assert.equal(m.mergedPrs, 3);
    assert.equal(m.verdictsPerPr, 2); // (2+4+0)/3
    assert.equal(m.verdictsMax, 4);
    assert.equal(m.prsWith3PlusVerdicts, 1);
    assert.equal(m.ciRedAfterMerge, 1);
    assert.deepEqual(m.ciRedPrs, [2]);
    assert.equal(m.medianCycleHours, 2); // 1·2·3 시간의 중앙값
    assert.match(m.note, /토큰/);
    assert.deepEqual(m.targets, { verdictsPerPr: 1.2, ciRedAfterMerge: 0 });
  } finally { f.done(); }
});

test("사람이 읽는 출력: 머리에 에이전트 토큰이 없다는 말, 목표 대비 판정", () => {
  const f = fixture(STATE);
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assert.match(lines[1], /GitHub 데이터만.*토큰.*GitHub 에 없/);
    assert.match(r.stdout, /병합 PR: 3건/);
    assert.match(r.stdout, /\/PR: 2 \(목표 ≤1\.2, 목표 밖\)/);
    assert.match(r.stdout, /main Test 빨강: 1건 \(PR #2\) \(목표 0, 목표 밖\)/);
    assert.match(r.stdout, /중앙값\(만듦→병합\): 2시간/);
  } finally { f.done(); }
});

test("gh 는 읽기 호출(pr list·run list)만, test.yml·main·push 로 좁혀 부른다", () => {
  const f = fixture(STATE);
  try {
    f.run(["--json"]);
    const calls = f.calls();
    assert.deepEqual(calls.map((c) => c.slice(0, 2).join(" ")).sort(), ["pr list", "run list"]);
    const runs = calls.find((c) => c[0] === "run");
    for (const x of ["test.yml", "main", "push"]) assert.ok(runs.includes(x), x);
    const prs = calls.find((c) => c[0] === "pr");
    assert.ok(prs.includes("merged:>=2026-10-18"));
  } finally { f.done(); }
});

test("병합 PR 이 없으면 평균·중앙값은 null, 빨강 0 은 목표 안", () => {
  const f = fixture({ prs: [], runs: [] });
  try {
    const m = JSON.parse(f.run(["--json"]).stdout);
    assert.equal(m.mergedPrs, 0);
    assert.equal(m.verdictsPerPr, null);
    assert.equal(m.medianCycleHours, null);
    assert.equal(m.ciRedAfterMerge, 0);
    assert.match(f.run().stdout, /main Test 빨강: 0건 \(목표 0, 목표 안\)/);
  } finally { f.done(); }
});

test("gh 가 실패하면 종료 1, 모르는 인자는 종료 2", () => {
  const f = fixture({ ...STATE, fail: true });
  try {
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /weekly-metrics 실패/);
    const bad = f.run(["--nope"]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /사용법/);
  } finally { f.done(); }
});
