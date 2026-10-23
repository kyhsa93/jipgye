import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { diffManifests, formatManifest, hashTree, isSame, main, parseManifest, treeHash } from "../scripts/site-hashes.ts";

// 산출 해시 목록·대조 (#509, 구조 B-3). deploy.yml 이 커밋된 docs/ 와 build/site 를 맞대는 도구다.
// 합성 디렉터리만 읽는다 - 오늘 날짜도 docs/ 의 현재 내용도 보지 않는다(#8). 실제 docs/ -> build/site 일치는 시험이 아니라 PR·틱 증빙이다.
const run = promisify(execFile);
const made = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "site-hashes-"));
  made.push(d);
  return d;
};
test.after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const sha = (s) => createHash("sha256").update(s).digest("hex");
const put = (dir, rel, body) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), body);
};
/** 같은 내용의 디렉터리 둘을 만든다(파일 만든 순서는 일부러 다르게). */
const pair = () => {
  const a = tmp();
  const b = tmp();
  for (const f of ["index.html", "data/x.json", "icons/a.svg", "Z.html"]) put(a, f, `내용 ${f}`);
  for (const f of ["Z.html", "icons/a.svg", "data/x.json", "index.html"]) put(b, f, `내용 ${f}`);
  return [a, b];
};
const capture = (argv, env = {}) => {
  let out = "";
  const code = main(argv, env, (s) => (out += s));
  return { code, out };
};

test("목록은 sha256sum 모양(해시 + 두 칸 + 경로)이고 경로 글자순이며, 만든 순서와 무관하다", () => {
  const [a, b] = pair();
  const text = formatManifest(hashTree(a));
  assert.equal(text, formatManifest(hashTree(b)));
  assert.deepEqual(
    text.trimEnd().split("\n").map((l) => l.slice(66)),
    ["Z.html", "data/x.json", "icons/a.svg", "index.html"], // 대문자가 소문자보다 앞(바이트 순서)
  );
  assert.equal(text.split("\n")[0], `${sha("내용 Z.html")}  Z.html`);
});

test("같은 내용은 일치(종료 0), 한 바이트·파일 하나가 달라도 어긋남(종료 1)이고 종류별로 적는다", () => {
  const [a, b] = pair();
  assert.equal(capture(["compare", a, b]).code, 0);
  assert.match(capture(["compare", a, b]).out, /결과: 일치/);

  put(b, "index.html", "내용 index.html!"); // 내용만 다름
  put(b, "new/only-b.html", "b"); // B 에만
  put(a, "only-a.css", "a"); // A 에만
  const r = capture(["compare", a, b]);
  assert.equal(r.code, 1);
  assert.match(r.out, /어긋남\(A 에만 1 · B 에만 1 · 내용 다름 1\)/);
  assert.match(r.out, /A 에만 있다\(1\):\n {2}only-a\.css/);
  assert.match(r.out, /B 에만 있다\(1\):\n {2}new\/only-b\.html/);
  assert.match(r.out, /내용이 다르다\(1\):\n {2}index\.html/);
  assert.notEqual(treeHash(hashTree(a)), treeHash(hashTree(b)));
});

test("목록 해시는 경로가 바뀌면(내용이 같아도) 달라진다 - 이름만 바꾼 산출이 일치로 보이지 않는다", () => {
  const a = tmp();
  const b = tmp();
  put(a, "a.html", "x");
  put(b, "b.html", "x");
  assert.notEqual(treeHash(hashTree(a)), treeHash(hashTree(b)));
  const d = diffManifests(hashTree(a), hashTree(b));
  assert.deepEqual([d.onlyA, d.onlyB, d.differs], [["a.html"], ["b.html"], []]);
  assert.equal(isSame(d), false);
});

test("compare 는 디렉터리와 목록 파일을 섞어 받는다 - 실행마다 올라간 목록끼리도 같은 명령으로 맞댄다", () => {
  const [a, b] = pair();
  const list = path.join(tmp(), "a.txt");
  writeFileSync(list, formatManifest(hashTree(a)));
  assert.equal(capture(["compare", list, b]).code, 0);
  assert.equal(capture(["compare", list, list]).code, 0);
  assert.equal(capture(["manifest", a]).out, formatManifest(hashTree(a)));
  put(b, "Z.html", "달라짐");
  assert.equal(capture(["compare", list, b]).code, 1);
});

test("--out-dir 은 a.txt·b.txt·report.txt 를 쓰고, 단계 요약 파일이 있으면 요약을 덧붙인다", () => {
  const [a, b] = pair();
  const outDir = path.join(tmp(), "hashes");
  const summary = path.join(tmp(), "summary.md");
  writeFileSync(summary, "앞 내용\n");
  const r = capture(["compare", a, b, `--out-dir=${outDir}`], { GITHUB_STEP_SUMMARY: summary });
  assert.equal(r.code, 0);
  assert.equal(readFileSync(path.join(outDir, "a.txt"), "utf8"), readFileSync(path.join(outDir, "b.txt"), "utf8"));
  assert.equal(readFileSync(path.join(outDir, "report.txt"), "utf8"), r.out);
  const md = readFileSync(summary, "utf8");
  assert.ok(md.startsWith("앞 내용\n"), "요약은 덧붙이는 것이지 덮어쓰는 것이 아니다");
  assert.match(md, /### 사이트 산출 해시 대조/);
  assert.match(md, /목록 해시 [0-9a-f]{64}/);
});

test("어긋나는 파일이 많아도 보고서는 종류마다 앞 40개까지만 적고 개수는 전부 적는다", () => {
  const a = tmp();
  const b = tmp();
  for (let i = 0; i < 55; i++) put(a, `p${String(i).padStart(2, "0")}.html`, "a");
  const r = capture(["compare", a, b]);
  assert.equal(r.code, 1);
  assert.match(r.out, /A 에만 55/);
  assert.match(r.out, /그 밖에 15개/);
  assert.equal(r.out.split("\n").filter((l) => /^ {2}p\d\d\.html$/.test(l)).length, 40);
});

test("읽을 수 없는 목록·중복 경로·심볼릭 링크·잘못된 인자는 일치로 넘기지 않고 멈춘다", () => {
  assert.throws(() => parseManifest("zzz  a.html\n"), /1행을 읽을 수 없다/);
  assert.throws(() => parseManifest(`${sha("1")}  a.html\n${sha("2")}  a.html\n`), /같은 경로가 둘/);
  const d = tmp();
  put(d, "real.html", "x");
  symlinkSync(path.join(d, "real.html"), path.join(d, "link.html"));
  assert.throws(() => hashTree(d), /일반 파일도 디렉터리도 아닌 항목/);
  assert.equal(capture(["bogus"]).code, 2);
  assert.equal(capture(["compare", d]).code, 2);
  assert.equal(capture(["manifest", d, "--x=1"]).code, 2);
});

test("CLI: 일치면 종료 0, 어긋나면 1, 없는 경로는 2 - 워크플로 스텝이 종료 코드로 갈린다", async () => {
  const script = path.resolve(import.meta.dirname, "..", "scripts", "site-hashes.ts");
  const [a, b] = pair();
  assert.equal((await run(process.execPath, [script, "compare", a, b])).stdout.includes("일치"), true);
  put(b, "index.html", "달라짐");
  await assert.rejects(run(process.execPath, [script, "compare", a, b]), (e) => e.code === 1 && /내용이 다르다\(1\)/.test(e.stdout));
  await assert.rejects(run(process.execPath, [script, "compare", a, path.join(a, "없음")]), (e) => e.code === 2);
  assert.ok(!existsSync(path.join(a, "report.txt")), "--out-dir 없이는 아무 것도 쓰지 않는다");
});
