import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { band, bucketOf, buildLedger, canonicalHash, gzipLedger, run, validateLedger } from "../scripts/ledger-snapshot.ts";
import { complexFiles, rawSlots } from "./ledger-fixtures/source.mjs";

// 월간 원장 스냅샷 (#482, 설계 판정 6396016952 ⑤ 합격선 1·2). 픽스처와 임시 git 저장소로만 돈다 - 데이터 값·날짜에 따라 갈리지 않는다.
const SHA = "a".repeat(40);
const OK = "제한 없음";
const license = { sale: OK, rent: OK, checkedOn: "2026-11-01" };
const build = (over = {}) => buildLedger({ month: "2026-11", sourceCommit: SHA, license, complexFiles: complexFiles(), rawSlots: rawSlots(), ...over });
const parse = (jsonl) => jsonl.trim().split("\n").map((l) => JSON.parse(l));
// 픽스처 골든: 픽스처나 줄 규칙이 바뀌면 이 값이 바뀐다 - 바꿀 때는 PR 본문에 이유를 적는다.
const GOLDEN = "34c7be7c163b679ecf136b624de4f4e749b8092b5711f0d24943964a23e7e11a";

test("허용 목록: 줄은 meta|c6|c1 뿐이고 키·순서가 판정 ① 과 같다. n<3 칸·단지명·동·층·일자가 없다", () => {
  const jsonl = build();
  const lines = parse(jsonl);
  assert.deepEqual(lines[0].meta, { v: 1, s: "2026-11-01", sourceCommit: SHA, prereg: "d1dcaaf73e441e88c2813e580f09839eabb65c46", license, counts: { c6: 6, c1: 6, rows: 7, skipped: 2 } });
  const c6 = lines.filter((l) => l.c6).map((l) => l.c6);
  assert.equal(c6.length, 6);
  assert.ok(c6.every((c) => c.n >= 3 && /^[0-9a-f]{16}$/.test(c.h) && c.d === "11110"));
  for (const word of ["가나아파트", "다라마을", "바사힐스", "자차타워", "창신동", "숭인동", "평창동", "median", "top", "yearAgo", "floor", "raw", "2026-06-16", "2026-05-02", "2026-10-"]) {
    assert.ok(!jsonl.includes(word), `원장에 ${word} 가 실렸다`);
  }
  // 날짜 모양은 s 와 checkedOn 뿐이다.
  assert.deepEqual([...new Set(jsonl.match(/\d{4}-\d{2}-\d{2}/g))].sort(), ["2026-11-01"]);
});

test("c6: 값은 옮기기만 하고 k 는 소스의 quartile, band 는 median 의 (하한, 상한] 6·9·15·25억", () => {
  const c6 = parse(build()).filter((l) => l.c6).map((l) => l.c6);
  const by = Object.fromEntries(c6.map((c) => [c.a, c]));
  assert.deepEqual(by["59.9"], { s: "2026-11-01", d: "11110", h: by["59.9"].h, a: "59.9", n: 3, lo: 58000, hi: 61000, k: "r", band: 1 });
  assert.deepEqual(Object.values(by).map((c) => [c.a, c.k, c.band]).sort(), [["114.2", "q", 2], ["134.6", "q", 4], ["164.1", "r", 5], ["59.9", "r", 1], ["84.84", "r", 2], ["84.95", "q", 3]]);
  assert.deepEqual([60000, 60001, 90000, 90001, 150000, 250000, 250001].map(band), [1, 2, 2, 3, 3, 4, 5]);
});

test("c1: 행 수로 세고(같은 행 두 줄 = 2), 계약월 ≥202610, 경과일 구간 양끝 포함, 전월세 줄에는 해제·등기 열이 없다", () => {
  const c1 = parse(build()).filter((l) => l.c1).map((l) => l.c1);
  assert.deepEqual(
    c1.map(({ m, d, kind, b, rows, cancel, rgst }) => [m, d, kind, b, rows, cancel, rgst]),
    [
      ["202610", "11110", "sale", "0-7", 2, 0, 0],
      ["202610", "11110", "sale", "8-14", 1, 0, 0],
      ["202610", "11110", "sale", "15-21", 1, 1, 0],
      ["202610", "11110", "sale", "22-30", 1, 0, 1],
      ["202610", "11110", "rent", "15-21", 1, undefined, undefined],
      ["202610", "11110", "rent", "22-30", 1, undefined, undefined],
    ],
  );
  assert.deepEqual([0, 7, 8, 14, 15, 21, 22, 30, 31, 45, 46, 400, -1].map(bucketOf), ["0-7", "0-7", "8-14", "8-14", "15-21", "15-21", "22-30", "22-30", "31-45", "31-45", "46+", "46+", null]);
});

test("결정성: 같은 입력 → 같은 JSONL·같은 gz 바이트, 입력 순서를 뒤집어도 같다. 픽스처 정본 해시 고정", () => {
  const a = build();
  const b = build({ complexFiles: complexFiles().reverse(), rawSlots: rawSlots().reverse() });
  assert.equal(a, b);
  assert.ok(gzipLedger(a).equals(gzipLedger(b)));
  assert.equal(gunzipSync(gzipLedger(a)).toString("utf8"), a);
  assert.equal(gzipLedger(a)[9], 3, "gzip OS 바이트 고정");
  assert.equal(canonicalHash(a), GOLDEN, "픽스처 정본 해시가 바뀌었다");
});

test("검사기: 허용 밖 키·최상위 키·n<3 줄·이용허락 불일치·잘못된 month 를 거절한다", () => {
  const [meta, ...rest] = build().trim().split("\n");
  const c6 = JSON.parse(rest[0]);
  const bad = (line) => [meta, line].join("\n") + "\n";
  assert.throws(() => validateLedger(bad(JSON.stringify({ c6: { ...c6.c6, name: "x" } }))), /허용 목록/);
  assert.throws(() => validateLedger(bad(JSON.stringify({ c6: { ...c6.c6, n: 2 } }))), /n<3/);
  assert.throws(() => validateLedger(bad(JSON.stringify({ deals: {} }))), /허용 밖 최상위 키/);
  assert.throws(() => validateLedger(bad(JSON.stringify({ c1: { s: "2026-11-01", m: "202610", d: "11110", kind: "sale", b: "0-7", rows: 1, cancel: 0, rgst: 0, date: "2026-10-03" } }))), /허용 목록/);
  for (const sale of ["제한없음", "이용허락범위 제한 없음", "", undefined]) assert.throws(() => build({ license: { ...license, sale } }), /license_sale/);
  assert.throws(() => build({ license: { ...license, rent: "출처표시" } }), /license_rent/);
  assert.throws(() => build({ month: "2026-13" }), /YYYY-MM/);
  const windowed = complexFiles();
  windowed[3].json.windowDays = 90;
  assert.throws(() => build({ complexFiles: windowed }), /PREREG 는 183일/);
});

test("워크플로: dispatch 전용·digest-pipeline 공유·contents: write 하나·액션 SHA 고정·입력은 env 로만, 커밋은 ledger 만이고 dry_run 이면 건너뛴다", () => {
  const wf = readFileSync(path.resolve(import.meta.dirname, "../.github/workflows/ledger-snapshot.yml"), "utf8");
  const code = wf.replace(/^\s*#.*\n/gm, "");
  assert.match(code, /^on:\n  workflow_dispatch:\n    inputs:\n      month:[\s\S]*license_sale:[\s\S]*license_rent:[\s\S]*dry_run:[\s\S]*source_commit:/m);
  assert.doesNotMatch(code, /schedule:|cron|pull_request|push:|workflow_run/);
  assert.match(code, /\npermissions:\n  contents: write\n\nconcurrency:\n  group: digest-pipeline\n  cancel-in-progress: false\n/);
  assert.doesNotMatch(code, /secrets\./);
  for (const m of code.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  for (const block of code.split(/\n\s+run: /).slice(1)) assert.doesNotMatch(block.split("\n      - ")[0], /\$\{\{/, "run 안에 ${{ }} 보간");
  const commitStep = code.slice(code.indexOf("- name: 커밋"));
  assert.match(commitStep, /if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.match(commitStep, /push-docs\.sh "chore: 원장 스냅샷 \$\{MONTH\}" ledger\n/);
  assert.ok(code.indexOf("node scripts/ledger-snapshot.ts") < code.indexOf("- name: 커밋"), "스냅샷 → 커밋 순서");
});

// ---- 임시 git 저장소: 소스 커밋 찾기·대체 금지·덮어쓰기 금지 ----

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
function commit(cwd, files, msg) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(cwd, p)), { recursive: true });
    writeFileSync(path.join(cwd, p), text);
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--allow-empty", "-m", msg);
  return git(cwd, "rev-parse", "HEAD");
}
function sourceFiles(slots = rawSlots()) {
  const files = {};
  complexFiles().forEach(({ json }, i) => (files[`docs/data/complex-price-d${String.fromCharCode(97 + i)}.json`] = `${JSON.stringify(json)}\n`));
  for (const { kind, json } of slots) files[`raw/${kind}/${json.district}-${json.yearMonth}.json`] = `${JSON.stringify(json)}\n`;
  return files;
}
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  git(dir, "init", "-q", "-b", "main");
  const prereg = commit(dir, { "research/PREREG.md": "v1\n" }, "docs: 사전 등록");
  return { dir, prereg };
}
const quiet = () => {};
const go = (r, over = {}) => run({ month: "2026-11", licenseSale: OK, licenseRent: OK, cwd: r.dir, prereg: r.prereg, today: "2026-11-01", log: quiet, ...over });

test("소스 커밋: 제목이 정확히 맞는 첫 커밋만 쓰고, 없으면 대체하지 않고 실패한다", () => {
  const r = repo();
  commit(r.dir, sourceFiles(), "chore: 데일리 데이터 갱신 2026-10-31");
  assert.throws(() => go(r), /소스 커밋이 없다/);
  commit(r.dir, {}, "chore: 데일리 데이터 갱신 2026-11-01 (재실행)");
  assert.throws(() => go(r), /소스 커밋이 없다/, "제목이 정확히 같지 않으면 쓰지 않는다");
  const first = commit(r.dir, {}, "chore: 데일리 데이터 갱신 2026-11-01");
  const res = go(r);
  assert.equal(res.status, "written");
  assert.equal(res.sourceCommit, first);
  const text = gunzipSync(readFileSync(path.join(r.dir, "ledger/2026-11.jsonl.gz"))).toString("utf8");
  assert.equal(text, buildLedger({ month: "2026-11", sourceCommit: first, license, complexFiles: complexFiles(), rawSlots: rawSlots(), prereg: r.prereg }));
});

test("재실행: 11-02·03 에 돌려도 같은 커밋·같은 해시라 아무것도 안 한다. 다르면 덮어쓰지 않고 실패한다", () => {
  const r = repo();
  commit(r.dir, sourceFiles(), "chore: 데일리 데이터 갱신 2026-11-01");
  const once = go(r);
  commit(r.dir, { "ledger/2026-11.jsonl.gz": readFileSync(path.join(r.dir, "ledger/2026-11.jsonl.gz")) }, "chore: 원장 스냅샷 2026-11");
  // 다음 날 Daily 가 raw 를 바꾸고 같은 날짜 제목의 두 번째 커밋까지 있어도 첫 커밋만 읽는다.
  commit(r.dir, sourceFiles(rawSlots().slice(0, 1)), "chore: 데일리 데이터 갱신 2026-11-02");
  commit(r.dir, {}, "chore: 데일리 데이터 갱신 2026-11-01");
  const again = go(r, { today: "2026-11-03" });
  assert.equal(again.status, "unchanged");
  assert.equal(again.hash, once.hash);
  const file = path.join(r.dir, "ledger/2026-11.jsonl.gz");
  const tampered = gzipLedger(build({ sourceCommit: once.sourceCommit, prereg: r.prereg, rawSlots: [] }));
  writeFileSync(file, tampered);
  assert.throws(() => go(r), /정본 해시가 다르다/);
  assert.ok(readFileSync(file).equals(tampered), "실패할 때 파일을 건드리지 않는다");
});

test("dry_run: source_commit 은 dry_run 에서만 받고 40자리 전체여야 한다. 결과는 out-dir 에만 쓴다", () => {
  const r = repo();
  const sha = commit(r.dir, sourceFiles(), "chore: 데일리 데이터 갱신 2026-10-30");
  assert.throws(() => go(r, { sourceCommit: sha }), /dry_run 전용/);
  assert.throws(() => go(r, { dryRun: true, sourceCommit: sha.slice(0, 12) }), /40자리/);
  const out = path.join(r.dir, "tmp-out");
  const res = go(r, { dryRun: true, sourceCommit: sha, outDir: out });
  assert.equal(res.status, "dry-run");
  assert.equal(res.file, path.join(out, "2026-11.jsonl.gz"));
  assert.equal(git(r.dir, "status", "--porcelain", "--", "ledger"), "");
  assert.throws(() => go(r, { dryRun: true, sourceCommit: sha, licenseRent: "제한 있음" }), /license_rent/);
});
