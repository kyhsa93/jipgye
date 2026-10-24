import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { S6_BUDGET_BYTES, addedBytes, buildExceptions, readReasons } from "../scripts/dev/golden-expect.mjs";

// scripts/dev/golden-expect.mjs (#548): 골든 --json 결과 → 예외 목록. 이유 문구는 .claude/patterns.md 에서 읽고, s6 예산 +400 B 를 강제한다.
// 합성 골든 결과만 쓴다 — 실제 골든은 돌리지 않는다.
const root = path.resolve(import.meta.dirname, "..");
const patterns = readFileSync(path.join(root, ".claude", "patterns.md"), "utf8");
const URL = "https://github.com/kyhsa93/jipgye/pull/1#issuecomment-1";

const inline = { id: "inline-script", missing: ["1: a"], added: ["1: b"] };
const s6 = (n) => ({ id: "s6-inline-bytes", missing: ["55000B"], added: [`${55000 + n}B (+${n})`] });
const gold = (pages) => ({ failing: pages.map(([file, ...findings]) => ({ file, findings })) });

test("patterns.md 의 P1 절에서 이유 문구 둘을 읽는다 - 인자로 받지 않는다", () => {
  const r = readReasons(patterns, "P1");
  assert.match(r["inline-script"], /패턴 P1/);
  assert.match(r["s6-inline-bytes"], /\{bytes\}/);
  assert.throws(() => readReasons(patterns, "P9"), /P9 절/);
  assert.throws(() => readReasons("## P1 — x\n- inline-script: 하나뿐\n", "P1"), /s6-inline-bytes/);
});

test("addedBytes: (+N)만 읽고 줄거나 같으면 0", () => {
  assert.equal(addedBytes(["56220B (+358)"]), 358);
  assert.equal(addedBytes(["56220B (-12)"]), 0);
  assert.equal(addedBytes([]), 0);
});

test("예산 안: inline-script 가 모든 장에서 같으면 * 한 줄 + s6 장별, confirmedBy 는 댓글 URL 하나", () => {
  const reasons = readReasons(patterns, "P1");
  const g = gold([["a.html", inline, s6(358)], ["b.html", inline, s6(400)]]);
  const r = buildExceptions(g, { url: URL, reasons, refs: "#410" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.exceptions.map((e) => `${e.page}:${e.check}`), ["*:inline-script", "a.html:s6-inline-bytes", "b.html:s6-inline-bytes"]);
  assert.match(r.exceptions[1].reason, /^#410 패턴 P1 .*\+358 B\/장/);
  assert.equal(r.exceptions[0].confirmedBy, `po ${URL} · cmo ${URL} · cto ${URL}`);
});

test("장마다 다른 inline-script 는 장별 항목", () => {
  const reasons = readReasons(patterns, "P1");
  const other = { id: "inline-script", missing: ["1: a"], added: ["1: c"] };
  const r = buildExceptions(gold([["a.html", inline], ["b.html", other]]), { url: URL, reasons });
  assert.deepEqual(r.exceptions.map((e) => e.page), ["a.html", "b.html"]);
});

test("예산 초과(+401 B)·새 하드 실패 id 는 expect 대신 「전체 판정」이다", () => {
  const reasons = readReasons(patterns, "P1");
  assert.equal(S6_BUDGET_BYTES, 400);
  const over = buildExceptions(gold([["a.html", inline, s6(358)], ["b.html", inline, s6(401)]]), { url: URL, reasons });
  assert.equal(over.ok, false);
  assert.match(over.lines.join("\n"), /전체 판정.*\n.*S6 예산 초과.*1장, 최대 \+401 B — b\.html \+401/);
  const unknown = buildExceptions(gold([["a.html", { id: "role-changed", missing: [], added: [] }]]), { url: URL, reasons });
  assert.equal(unknown.ok, false);
  assert.match(unknown.lines.join("\n"), /등록되지 않은 하드 실패 id: a\.html role-changed/);
});

test("CLI: 예산 안이면 0·파일을 쓰고, 초과면 2·「전체 판정」·파일 없음, 패턴 절이 없으면 2", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "jipgye-golden-expect-"));
  const cli = (goldObj, extra = []) => {
    writeFileSync(path.join(dir, "gold.json"), JSON.stringify(goldObj));
    return spawnSync(process.execPath, [path.join(root, "scripts", "dev", "golden-expect.mjs"), path.join(dir, "gold.json"), URL, path.join(dir, "expect.json"), ...extra], { encoding: "utf8" });
  };
  const ok = cli(gold([["a.html", inline, s6(358)]]), ["--pattern", "P1"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(dir, "expect.json"), "utf8")).exceptions.length, 2);
  rmSync(path.join(dir, "expect.json"));
  const over = cli(gold([["a.html", inline, s6(500)]]), ["--pattern", "P1"]);
  assert.equal(over.status, 2);
  assert.match(over.stderr, /전체 판정/);
  assert.throws(() => readFileSync(path.join(dir, "expect.json")), /ENOENT/);
  assert.equal(cli(gold([]), ["--pattern", "P9"]).status, 2);
  rmSync(dir, { recursive: true, force: true });
});
