import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/dev/merge.sh (#602): 병합 큐 스크립트. PATH 앞의 가짜 `gh` 로만 돈다 - 네트워크·실제 PR·저장소 상태를 쓰지 않는다.
// 가짜 gh 는 상태 파일(STUB_STATE)이 시키는 대로 답하고, 부른 인자를 STUB_LOG 에 한 줄(JSON)씩 남긴다.
// 응답 목록(views·merges·...)은 하나씩 꺼내 쓰고 마지막 하나는 계속 쓴다.
// 파일 목록(#887)은 `gh api --paginate repos/o/r/pulls/601/files?per_page=100 --jq <JQ>` 로만 답한다(`pr diff` 는 모르는 호출 - 300파일 초과에서 406 이던 길).
// 가짜는 jq 를 돌리지 못하므로 JQ 글자가 같을 때만 그 출력(F 새 경로, 이름 바뀐 파일은 다음 줄 P 옛 경로)을 흉내 낸다 - 식이 바뀌면 이 시험부터 깨진다.
// 실제 출력 형태는 PR #496(이름 변경 1건)으로 확인했다(2026-11-15).
const MERGE = path.resolve(import.meta.dirname, "..", "scripts", "dev", "merge.sh");
const HEAD = "a".repeat(40);
const MSHA = "b".repeat(40);
const JQ = '.[] | "F " + .filename, (.previous_filename // empty | "P " + .)';

const SHIM = (nodeBin) => `#!${nodeBin}
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(a) + "\\n");
const st = JSON.parse(fs.readFileSync(process.env.STUB_STATE, "utf8"));
const save = () => fs.writeFileSync(process.env.STUB_STATE, JSON.stringify(st));
const next = (arr) => (arr.length > 1 ? arr.shift() : arr[0]);
const has = (x) => a.includes(x);
const [g, sub] = a;
const files = () => st.files.map((f) => (typeof f === "string" ? { filename: f } : f));
if (g === "api") {
  const ok = has("--paginate") && has("repos/o/r/pulls/601/files?per_page=100") && a[a.indexOf("--jq") + 1] === ${JSON.stringify(JQ)};
  if (!ok) { console.error("가짜 gh: 기대와 다른 api 호출 " + a.join(" ")); process.exit(9); }
  if (st.apiFail) { console.error(st.apiFail); process.exit(1); }
  // --paginate 는 페이지(100개)마다 jq 를 돌려 출력을 이어 붙인다 - 이어 붙인 결과를 그대로 낸다.
  const out = files().flatMap((f) => (f.previous_filename ? ["F " + f.filename, "P " + f.previous_filename] : ["F " + f.filename]));
  if (out.length) console.log(out.join("\\n"));
}
else if (g === "pr" && sub === "view" && has("changedFiles")) { console.log(String(st.changedFiles ?? files().length)); }
else if (g === "pr" && sub === "view" && a.join(" ").includes("statusCheckRollup")) { const v = next(st.views); save(); console.log(JSON.stringify(v)); }
else if (g === "pr" && sub === "view") { console.log(JSON.stringify({ state: "MERGED", mergeCommit: { oid: st.mergeSha } })); }
else if (g === "pr" && sub === "comment") { /* 기록만 */ }
else if (g === "pr" && sub === "merge") { const m = next(st.merges); save(); if (m.out) console.log(m.out); process.exit(m.rc); }
else if (g === "run" && sub === "list" && has("--commit")) { console.log(JSON.stringify(next(st.postRuns))); save(); }
else if (g === "run" && sub === "list") { console.log(JSON.stringify(next(st.runs))); save(); }
else { console.error("가짜 gh: 모르는 호출 " + a.join(" ")); process.exit(9); }
`;

const ck = (name, conclusion) => ({ name, conclusion, status: "COMPLETED" });
const GREEN = [ck("test", "SUCCESS"), ck("render", "SUCCESS")];
const view = (checks, head = HEAD) => ({ headRefOid: head, statusCheckRollup: checks });
const POST_OK = [{ workflowName: "Test", status: "completed", conclusion: "success" }, { workflowName: "Deploy site", status: "completed", conclusion: "success" }];
const SAFE_FILES = ["docs/index.html", "src/css/a.css", "test/x.test.mjs", "README.md"];

function fixture(state = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), "jipgye-merge-"));
  const bin = path.join(base, "bin"); mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), SHIM(process.execPath)); chmodSync(path.join(bin, "gh"), 0o755);
  const stateFile = path.join(base, "state.json"), log = path.join(base, "gh.log");
  const full = { files: SAFE_FILES, views: [view(GREEN)], merges: [{ rc: 0, out: "" }], runs: [[]], postRuns: [POST_OK], mergeSha: MSHA, ...state };
  writeFileSync(stateFile, JSON.stringify(full));
  const calls = () => { try { return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const of = (g, sub) => calls().filter((c) => c[0] === g && c[1] === sub);
  const run = (args, env = {}) => spawnSync("/bin/bash", [MERGE, ...args], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:/usr/bin:/bin`, NODE24_BIN: process.execPath, STUB_STATE: stateFile, STUB_LOG: log, MERGE_REPO: "o/r",
      MERGE_CHECK_SLEEP: "0", MERGE_CHECK_POLLS: "5", MERGE_BUSY_SLEEP: "0", MERGE_BUSY_POLLS: "3", MERGE_RETRY_SLEEP: "0", MERGE_POST_SLEEP: "0", MERGE_POST_POLLS: "3", ...env,
    },
  });
  return { run, calls, of, done: () => rmSync(base, { recursive: true, force: true }) };
}
const ARGS = (extra = []) => ["601", "--head", HEAD, "--subject", "feat: 가짜 (Refs #601)", "--body", "본문 한 줄", "--note", "판정 SHA 일치", ...extra];

test("검사는 이름(test·render)으로 본다: 다른 검사가 SUCCESS 여도 render 가 없으면 기다렸다가 둘 다 SUCCESS 일 때 병합한다", () => {
  const f = fixture({ views: [view([ck("test", "SUCCESS"), ck("lint", "SUCCESS")]), view([ck("test", "SUCCESS"), ck("render", "IN_PROGRESS" )]), view(GREEN)] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.of("pr", "view").filter((c) => c.join(" ").includes("statusCheckRollup")).length, 4); // 3번 기다림 + 병합 직전 재확인
    const merge = f.of("pr", "merge");
    assert.equal(merge.length, 1);
    assert.deepEqual(merge[0].slice(0, 2), ["pr", "merge"]);
    for (const x of ["--squash", "--admin", "--match-head-commit", HEAD]) assert.ok(merge[0].includes(x), x);
    assert.equal(merge[0][merge[0].indexOf("--subject") + 1], "feat: 가짜 (Refs #601)");
    assert.match(r.stdout, new RegExp(`^MERGED ${MSHA}$`, "m"));
    assert.match(r.stdout, /^Test: success$/m);
    assert.match(r.stdout, /^Deploy site: success$/m);
    // 순서: 댓글이 병합보다 앞
    const order = f.calls().map((c) => c[1]);
    assert.ok(order.indexOf("comment") < order.indexOf("merge"));
  } finally { f.done(); }
});

test("검사가 FAILURE 면(이름이 test·render 가 아니어도) 즉시 중단하고 댓글·병합을 하지 않는다", () => {
  for (const bad of [[ck("test", "SUCCESS"), ck("render", "FAILURE")], [ck("test", "SUCCESS"), ck("render", "SUCCESS"), ck("lint", "FAILURE")]]) {
    const f = fixture({ views: [view(bad)] });
    try {
      const r = f.run(ARGS());
      assert.equal(r.status, 1);
      assert.match(r.stderr, /실패한 검사가 있다/);
      assert.equal(f.of("pr", "merge").length, 0);
      assert.equal(f.of("pr", "comment").length, 0);
      assert.equal(f.of("pr", "view").filter((c) => c.join(" ").includes("statusCheckRollup")).length, 1, "기다리지 않고 한 번 읽고 끝");
    } finally { f.done(); }
  }
});

test("test·render 가 끝내 SUCCESS 가 안 되면 시간 초과로 중단한다", () => {
  const f = fixture({ views: [view([ck("test", "SUCCESS")])] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 1);
    assert.match(r.stderr, /제한 시간 안에/);
    assert.equal(f.of("pr", "merge").length, 0);
  } finally { f.done(); }
});

test("PR head 가 기대한 SHA 와 다르면 중단한다(처음부터든 기다리는 중이든)", () => {
  const other = "c".repeat(40);
  for (const views of [[view(GREEN, other)], [view([ck("test", "SUCCESS")]), view(GREEN, other)]]) {
    const f = fixture({ views });
    try {
      const r = f.run(ARGS());
      assert.equal(r.status, 1);
      assert.match(r.stderr, /head 가 움직였다/);
      assert.ok(r.stderr.includes(other));
      assert.equal(f.of("pr", "merge").length, 0);
      assert.equal(f.of("pr", "comment").length, 0);
    } finally { f.done(); }
  }
});

test("`Base branch was modified` 는 최대 3번까지 다시 해서 병합한다", () => {
  const modified = { rc: 1, out: "GraphQL: Pull Request is not mergeable: Base branch was modified. Review and try the merge again." };
  const f = fixture({ merges: [modified, modified, { rc: 0, out: "" }] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.of("pr", "merge").length, 3);
    assert.equal(f.of("pr", "comment").length, 1, "댓글은 한 번만");
    assert.match(r.stdout, /재시도 2\/3/);
    assert.match(r.stdout, new RegExp(`^MERGED ${MSHA}$`, "m"));
  } finally { f.done(); }
});

test("`Base branch was modified` 가 3번 이어지면 중단한다(MERGED 를 찍지 않는다)", () => {
  const modified = { rc: 1, out: "Base branch was modified" };
  const f = fixture({ merges: [modified] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 1);
    assert.equal(f.of("pr", "merge").length, 3);
    assert.doesNotMatch(r.stdout, /^MERGED/m);
    assert.match(r.stderr, /3번 이어졌다/);
  } finally { f.done(); }
});

test("다른 이유의 병합 실패는 다시 하지 않고 중단한다", () => {
  const f = fixture({ merges: [{ rc: 1, out: "Head branch was modified. Review and try the merge again." }] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 1);
    assert.equal(f.of("pr", "merge").length, 1);
    assert.match(r.stderr, /병합 실패/);
  } finally { f.done(); }
});

test("--dry-run 은 읽기만 한다: 댓글·병합 호출 0, 계획을 찍고 종료 0", () => {
  const f = fixture({ files: [...SAFE_FILES, "docs/data/x.json"] });
  try {
    const r = f.run(ARGS(["--dry-run"]));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.of("pr", "merge").length, 0);
    assert.equal(f.of("pr", "comment").length, 0);
    assert.match(r.stdout, /\[dry-run\] 병합: gh pr merge 601 .*--squash --admin --match-head-commit a{40}/);
    assert.match(r.stdout, /\[dry-run\] 남길 댓글: .*test·render SUCCESS · 판정 SHA 일치/);
    assert.match(r.stdout, /부류=데이터/);
    assert.match(r.stdout, /busy 규칙: PR 이벤트가 아닌 실행이 0/);
    assert.doesNotMatch(r.stdout, /^MERGED/m);
  } finally { f.done(); }
});

test("--dry-run 도 실패 검사·head 이동은 종료 1 로 알린다", () => {
  const f = fixture({ views: [view([ck("test", "FAILURE"), ck("render", "SUCCESS")])] });
  try { assert.equal(f.run(ARGS(["--dry-run"])).status, 1); } finally { f.done(); }
  const g = fixture({ views: [view(GREEN, "d".repeat(40))] });
  try { assert.equal(g.run(ARGS(["--dry-run"])).status, 1); } finally { g.done(); }
});

test("안전 부류(틀·CSS·시험·문서)는 진행 중인 Daily·Summarize 를 기다리지 않는다", () => {
  const busy = [{ status: "in_progress", event: "schedule" }, { status: "queued", event: "workflow_run" }];
  const f = fixture({ runs: [busy] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /부류=안전/);
    // 병합 전 실행 목록(--commit 없는 run list)을 아예 부르지 않는다
    assert.equal(f.of("run", "list").filter((c) => !c.includes("--commit")).length, 0);
    const comment = f.of("pr", "comment")[0];
    assert.match(comment[comment.indexOf("--body") + 1], /busy 규칙 생략\(안전 부류\)/);
  } finally { f.done(); }
});

test("데이터·워크플로·수집기 경로를 건드리는 PR 은 busy 규칙을 적용한다: 계속 바쁘면 중단, 비면 병합", () => {
  const busy = [{ status: "in_progress", event: "schedule" }];
  const pathsHit = ["docs/data/series.json", "raw/indicators/series.json", ".github/workflows/x.yml", "scripts/fetch-news.ts", "scripts/build-realestate.ts", "scripts/news-context.ts", "scripts/push-docs.sh", "scripts/update-all.mjs", ".gitignore", "package.json"];
  for (const p of pathsHit) {
    const f = fixture({ files: ["test/a.test.mjs", p], runs: [busy] });
    try {
      const r = f.run(ARGS());
      assert.equal(r.status, 1, `${p}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /busy 규칙/);
      assert.equal(f.of("pr", "merge").length, 0);
      assert.ok(f.of("run", "list").length >= 3, "여러 번 기다린 뒤 포기");
    } finally { f.done(); }
  }
  const g = fixture({ files: ["docs/data/x.json"], runs: [busy, busy, [{ status: "completed", event: "schedule" }, { status: "in_progress", event: "pull_request" }]] });
  try {
    const r = g.run(ARGS());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const comment = g.of("pr", "comment")[0];
    assert.match(comment[comment.indexOf("--body") + 1], /push\/schedule\/workflow_run 실행 중 0/);
  } finally { g.done(); }
});

test("scripts/ 아래 데이터와 무관한 파일(예: scripts/dev/·scripts/render-*)은 안전 부류다", () => {
  const f = fixture({ files: ["scripts/dev/merge.sh", "scripts/render-pipeline.ts", "docs/data-guide.html", "src/fetch-notes.md"], runs: [[{ status: "in_progress", event: "schedule" }]] });
  try {
    const r = f.run(ARGS(["--dry-run"]));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /부류=안전/);
  } finally { f.done(); }
});

// #887: 300파일을 넘는 PR(실제 #885 329파일)도 파일 API 로 부류를 정한다.
const MANY = (n) => Array.from({ length: n }, (_, i) => `test/case-${String(i).padStart(3, "0")}.test.mjs`);

test("300파일을 넘는 PR 도 파일 API(--paginate)로 부류를 정한다 - `gh pr diff` 를 부르지 않는다", () => {
  const f = fixture({ files: MANY(329) });
  try {
    const r = f.run(ARGS(["--dry-run"]));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /부류=안전\(busy 규칙 생략\) 파일 329개/);
    assert.equal(f.of("pr", "diff").length, 0);
    assert.equal(f.calls().filter((c) => c[0] === "api").length, 1, "목록은 한 번 읽는다");
  } finally { f.done(); }
});

test("데이터 경로가 2페이지(101번째 뒤)에만 있어도 데이터 부류다", () => {
  const files = MANY(329); files[250] = "docs/data/series.json";
  const f = fixture({ files, runs: [[{ status: "in_progress", event: "schedule" }]] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /부류=데이터\(busy 규칙 적용; 닿은 경로: docs\/data\/series\.json\) 파일 329개/);
    assert.match(r.stderr, /busy 규칙/);
    assert.equal(f.of("pr", "merge").length, 0);
  } finally { f.done(); }
});

test("이름 변경은 옛 경로도 본다: 옛 경로만 raw/ 여도 데이터 부류이고, 옛 경로 줄은 파일 수에 넣지 않는다", () => {
  const f = fixture({ files: ["test/a.test.mjs", { filename: "archive/old.json", previous_filename: "raw/indicators/old.json" }], changedFiles: 2 });
  try {
    const r = f.run(ARGS(["--dry-run"]));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /부류=데이터\(busy 규칙 적용; 닿은 경로: raw\/indicators\/old\.json\) 파일 2개/);
  } finally { f.done(); }
  const g = fixture({ files: [{ filename: "src/b.ts", previous_filename: "src/a.ts" }], changedFiles: 1 });
  try {
    const r = g.run(ARGS(["--dry-run"]));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /부류=안전\(busy 규칙 생략\) 파일 1개/);
  } finally { g.done(); }
});

test("목록 수가 changedFiles 와 다르면(3000파일 잘림 등) 댓글·병합 없이 종료 1", () => {
  for (const dry of [[], ["--dry-run"]]) {
    const f = fixture({ files: MANY(329), changedFiles: 3500 });
    try {
      const r = f.run(ARGS(dry));
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /파일 목록 329개가 changedFiles 3500개와 다르다/);
      assert.doesNotMatch(r.stdout, /부류=/);
      assert.equal(f.of("pr", "merge").length, 0);
      assert.equal(f.of("pr", "comment").length, 0);
    } finally { f.done(); }
  }
});

test("파일 목록을 못 읽으면(API 오류) 종료 1 이고 병합하지 않는다", () => {
  const f = fixture({ apiFail: "HTTP 502: Bad Gateway" });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 1);
    assert.match(r.stderr, /파일 목록을 못 읽었다: HTTP 502/);
    assert.equal(f.of("pr", "merge").length, 0);
  } finally { f.done(); }
});

test("병합 뒤 병합 커밋의 Test·Deploy site 결론을 찍고, 하나라도 success 가 아니면 종료 4", () => {
  const pending = [{ workflowName: "Test", status: "completed", conclusion: "success" }, { workflowName: "Deploy site", status: "in_progress", conclusion: "" }];
  const failed = [{ workflowName: "Test", status: "completed", conclusion: "failure" }, { workflowName: "Deploy site", status: "completed", conclusion: "success" }];
  const f = fixture({ postRuns: [pending, POST_OK] });
  try {
    const r = f.run(ARGS());
    assert.equal(r.status, 0);
    assert.ok(f.of("run", "list").every((c) => c.includes(MSHA)), "병합 커밋으로 묻는다");
    assert.equal(f.of("run", "list").length, 2);
  } finally { f.done(); }
  const g = fixture({ postRuns: [failed] });
  try {
    const r = g.run(ARGS());
    assert.equal(r.status, 4);
    assert.match(r.stdout, /^MERGED /m);
    assert.match(r.stdout, /^Test: failure$/m);
  } finally { g.done(); }
  const h = fixture({ postRuns: [[]] });
  try {
    const r = h.run(ARGS());
    assert.equal(r.status, 4);
    assert.match(r.stdout, /^Test: pending$/m);
  } finally { h.done(); }
});

test("메시지에 귀속 줄이 있으면 gh 를 부르기 전에 거부하고, 쓰는 댓글에는 그런 줄이 없다", () => {
  for (const extra of [["--subject", "x\n\nCo-Authored-By: Someone <a@b>"], ["--body", "Claude-Session: https://claude.ai/code/session_1"], ["--note", "🤖 Generated with [Claude Code](https://claude.com/claude-code)"]]) {
    const f = fixture();
    try {
      const r = f.run([...ARGS(), ...extra]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Co-Authored-By/);
      assert.deepEqual(f.calls(), []);
    } finally { f.done(); }
  }
  const g = fixture();
  try {
    g.run(ARGS());
    const sent = JSON.stringify(g.calls());
    assert.doesNotMatch(sent, /Co-Authored-By|Claude-Session|Generated with/i);
  } finally { g.done(); }
});

test("위치 인자(pr head 제목 본문 메모)로도 받는다", () => {
  const f = fixture();
  try {
    const r = f.run(["601", HEAD, "feat: 위치", "본문", "메모"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const merge = f.of("pr", "merge")[0];
    assert.equal(merge[merge.indexOf("--subject") + 1], "feat: 위치");
  } finally { f.done(); }
});

test("입력 오류는 종료 2 이고 gh 를 부르지 않는다(PR 번호·짧은 SHA·제목·메모 없음)", () => {
  const f = fixture();
  try {
    assert.equal(f.run(["abc", "--head", HEAD, "--subject", "s", "--note", "n"]).status, 2);
    assert.equal(f.run(["601", "--head", "abc123", "--subject", "s", "--note", "n"]).status, 2);
    assert.equal(f.run(["601", "--head", HEAD, "--note", "n"]).status, 2);
    assert.equal(f.run(["601", "--head", HEAD, "--subject", "s"]).status, 2);
    assert.equal(f.run(["601", "--nope"]).status, 2);
    assert.deepEqual(f.calls(), []);
  } finally { f.done(); }
});
