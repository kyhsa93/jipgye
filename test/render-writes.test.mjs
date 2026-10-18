import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWriteSet } from "../scripts/render-writes.mjs";
import { findJsComments, stripInlineScriptComments } from "../scripts/strip-inline-comments.mjs";
import { jsInlineScripts } from "./helpers/comment-proof.mjs";

// #237: 한 렌더 스크립트는 전부 메모리에서 렌더에 성공한 뒤에 쓴다 - 중간에서 던지면 어느 파일도 바뀌지 않는다.
// 입력은 test/fixtures/render/의 고정 틀과 이 파일 안의 작은 JSON뿐이다(R3): 저장소의 docs/·docs/data는 읽지 않는다.

const root = path.resolve(import.meta.dirname, "..");
const TEMPLATE = path.join(root, "test/fixtures/render/template.html");
const tmpDirs = [];
after(() => Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))));

/** scripts/를 통째로 복사한 임시 저장소. 스크립트의 root가 import.meta.dirname/..라서 복사본 안에서만 쓴다. */
async function tempRepo() {
  // realpath: 스크립트는 `argv[1]`과 `import.meta.filename`이 같을 때만 main을 돈다. macOS의 /var는 /private/var 심볼릭 링크라 그대로 쓰면 아무것도 안 하고 끝난다.
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "jipgye-writes-")));
  tmpDirs.push(dir);
  await cp(path.join(root, "scripts"), path.join(dir, "scripts"), { recursive: true });
  await mkdir(path.join(dir, "docs/data"), { recursive: true });
  return dir;
}
const run = (dir, script) => spawnSync(process.execPath, [path.join(dir, "scripts", script)], { cwd: dir, encoding: "utf8", env: { ...process.env, JIPGYE_RENDERER: "legacy" } });
const readAll = async (dir) =>
  Object.fromEntries(await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".html")).sort().map(async (f) => [f, await readFile(path.join(dir, f), "utf8")])));

test("쓰기 묶음: commit 전에는 디스크에 아무것도 쓰지 않고, commit이 올린 순서대로 쓴다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jipgye-writeset-"));
  tmpDirs.push(dir);
  const a = path.join(dir, "a.txt");
  const b = path.join(dir, "b.txt");
  const set = createWriteSet();
  set.stage(a, "A", "a 썼다");
  set.stage(b, "B");
  set.stage(a, "A2", "a 썼다"); // 같은 파일은 나중 것이 이긴다
  assert.equal(set.size, 2);
  assert.equal(set.peek(a), "A2");
  assert.deepEqual(await readdir(dir), []);
  const logs = [];
  assert.deepEqual(set.commit({ log: (m) => logs.push(m) }), [a, b]);
  assert.equal(await readFile(a, "utf8"), "A2");
  assert.equal(await readFile(b, "utf8"), "B");
  assert.deepEqual(logs, ["a 썼다"]);
  assert.equal(set.size, 0);
});

test("prerender.mjs: 마지막 장의 마커가 지워져 던지면 앞 장들도 새 출력이 되지 않는다", async () => {
  const dir = await tempRepo();
  const files = ["index", "rates", "news", "realestate", "jeonse-vs-wolse", "renewal-vs-new", "floor-gap", "switch-house", "record-high", "price-outlook", "method", "cancelled-deals"];
  const template = await readFile(TEMPLATE, "utf8");
  for (const f of files) await writeFile(path.join(dir, "docs", `${f}.html`), template);

  // 대조군: 틀이 멀쩡하면 데이터 없이도 rates·realestate는 바뀐다(허브 링크·자치구 머리글) - 이 시험이 보는 "앞 장"이다.
  const control = run(dir, "prerender.mjs");
  assert.equal(control.status, 0, control.stderr);
  const after1 = await readAll(path.join(dir, "docs"));
  assert.notEqual(after1["rates.html"], template, "대조군에서 rates.html이 바뀌지 않았다 - 시험이 아무것도 못 본다");
  assert.notEqual(after1["realestate.html"], template);

  // 다시 틀로 되돌리고 마지막 장(cancelled-deals)의 닫는 마커 하나를 지운다.
  for (const f of files) await writeFile(path.join(dir, "docs", `${f}.html`), template);
  await writeFile(path.join(dir, "docs/cancelled-deals.html"), template.replace("<!--/prerender:cancelLead-->", ""));
  const before = await readAll(path.join(dir, "docs"));
  const failed = run(dir, "prerender.mjs");
  assert.notEqual(failed.status, 0, "마커가 없는데 성공했다");
  assert.match(failed.stderr, /cancelLead 자리표시 주석을 찾지 못했습니다/);
  assert.deepEqual(await readAll(path.join(dir, "docs")), before, "렌더가 실패했는데 일부 장이 이미 새 출력이 되었다");
});

test("prerender.mjs: 시세 장은 scripts/ 의 틀을 읽어 docs/realestate.html 로 쓰고, 그 자리에서 인라인 스크립트 주석을 뗀다 (#374)", async () => {
  const dir = await tempRepo();
  const files = ["index", "rates", "news", "jeonse-vs-wolse", "renewal-vs-new", "floor-gap", "switch-house", "record-high", "price-outlook", "method", "cancelled-deals"];
  const fixture = await readFile(TEMPLATE, "utf8");
  for (const f of files) await writeFile(path.join(dir, "docs", `${f}.html`), fixture);
  // docs/realestate.html 을 일부러 만들지 않는다 - 입력이 나가는 장이면 읽다가 던진다. 틀(scripts/ 안 복사본)은 주석을 가진 채 그대로 있어야 한다.
  const templatePath = path.join(dir, "scripts/realestate-template.html");
  const template = await readFile(templatePath, "utf8");
  assert.ok(jsInlineScripts(template).flatMap((x) => findJsComments(x.body)).length > 5, "틀에 주석이 없다 - 시험이 아무것도 못 본다");

  const r = run(dir, "prerender.mjs");
  assert.equal(r.status, 0, r.stderr);
  const out = await readFile(path.join(dir, "docs/realestate.html"), "utf8");
  // 표지 안쪽과 표 캡션(채워진 행 수를 센다)은 데이터에 따라 달라서 마크업은 견주지 않는다 - 스크립트가 틀에서 주석만 뗀 것과 같은지 본다.
  const want = jsInlineScripts(stripInlineScriptComments(template)).map((x) => x.body);
  assert.deepEqual(jsInlineScripts(out).map((x) => x.body), want, "나가는 장의 스크립트가 틀에서 주석만 뗀 것과 다르다");
  assert.equal(jsInlineScripts(out).flatMap((x) => findJsComments(x.body)).length, 0, "나가는 장에 주석이 남았다");
  assert.equal(await readFile(templatePath, "utf8"), template, "틀이 덮어 써졌다 - 생성물만 쓰고 틀은 건드리지 않는다");
});

test("build-rate-pages.mjs: 뒤 상품군 장을 그리다 던지면 앞 상품군 장도 만들어지지 않는다", async () => {
  const dir = await tempRepo();
  const rates = (mortgage) => JSON.stringify({ deposit: [], saving: [], mortgage, rentLoan: [] });
  // 대조군: 전부 멀쩡하면 네 장이 생긴다.
  await writeFile(path.join(dir, "docs/data/rates.json"), rates([]));
  const control = run(dir, "build-rate-pages.mjs");
  assert.equal(control.status, 0, control.stderr);
  const made = (await readdir(path.join(dir, "docs"))).filter((f) => f.endsWith(".html")).sort();
  assert.equal(made.length, 4, `상품군 장 넷이 생겨야 한다: ${made}`);
  for (const f of made) await rm(path.join(dir, "docs", f));

  // options가 배열이 아닌 상품 하나 - 주담대 장을 그릴 때만 던진다(예적금 장은 이미 그려진 뒤다).
  await writeFile(path.join(dir, "docs/data/rates.json"), rates([{ name: "x", options: 5 }]));
  const failed = run(dir, "build-rate-pages.mjs");
  assert.notEqual(failed.status, 0, "던져야 한다");
  assert.deepEqual((await readdir(path.join(dir, "docs"))).filter((f) => f.endsWith(".html")), [], "앞 장이 이미 만들어졌다");
});

test("stampAll(io): 뒤 장에서 던지면 쓰기 묶음에 올린 앞 장은 디스크에 내려가지 않고, 이어받기는 올린 것을 읽는다", async () => {
  const { stampAll } = await import("../scripts/updated-stamp.mjs");
  const { readFileSync } = await import("node:fs");
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "jipgye-stamp-")));
  tmpDirs.push(dir);
  const docs = path.join(dir, "docs");
  await mkdir(path.join(docs, "data"), { recursive: true });
  await writeFile(path.join(docs, "data/news.json"), JSON.stringify({ updatedAt: "2026-10-10T00:00:00Z" }));
  const shell = '<div class="updated" id="updated">불러오는 중...</div>';
  await writeFile(path.join(docs, "a.html"), shell);
  await writeFile(path.join(docs, "b.html"), "<p>기준일 줄이 없는 장</p>");
  const writes = createWriteSet();
  const io = { read: (f) => writes.peek(f) ?? readFileSync(f, "utf8"), write: (f, t) => writes.stage(f, t) };
  assert.throws(() => stampAll({ docsDir: docs, dataDir: path.join(docs, "data"), pages: { "a.html": ["news"], "b.html": ["news"] }, io }), /id="updated" 줄을 찾지 못했다/);
  assert.equal(await readFile(path.join(docs, "a.html"), "utf8"), shell, "던졌는데 a.html이 이미 디스크에서 바뀌었다");
  assert.match(writes.peek(path.join(docs, "a.html")), /data-updated="2026-10-10"/, "올려 둔 내용은 뒤 단계가 이어 받을 수 있다");
});
