import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { preparePristine, pruneRenderCaches, renderCacheName, renderIsolated, resolveCacheDirs, shaCacheName } from "../lib/render.ts";
import { commit, fakeRepo, git } from "./helpers/fake-repo.ts";

// 골든 작업 폴더 격리·공유 기준 캐시(#605). 실행마다 따로 쓰는 작업 폴더(GOLDEN_CACHE_DIR)와, 키가 전체 SHA 라 나눠 써도 되는
// SHA 캐시 폴더(GOLDEN_SHA_CACHE_DIR)를 가른다. 가짜 저장소만 쓴다(실제 docs/ 없음). 시험마다 자기 폴더 하나에서 끝나고 통째로 지운다.
const PREPARE = path.join(import.meta.dirname, "helpers/prepare-env.ts");
const FULL = "a".repeat(40);

async function sandbox(fn) {
  const base = await mkdtemp(path.join(os.tmpdir(), "golden-cdirs-"));
  const d = { base, tmp: path.join(base, "tmp"), shared: path.join(base, "shared"), repo: await fakeRepo(base) };
  await mkdir(d.tmp);
  try {
    return await fn(d);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
const ls = async (dir) => (existsSync(dir) ? (await readdir(dir)).sort() : []);
const headOf = (d) => git(d.repo, "rev-parse", "HEAD").stdout.trim();
// 한 "실행": 새 프로세스, 자기 작업 폴더, 공유 SHA 캐시(shared 가 빈 문자열이면 공유 없음).
const run = (d, work, arg, { shared = d.shared } = {}) =>
  new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: d.tmp, GOLDEN_CACHE_DIR: work, GOLDEN_MIN_FREE_GB: "0" };
    if (shared) env.GOLDEN_SHA_CACHE_DIR = shared;
    else delete env.GOLDEN_SHA_CACHE_DIR;
    const c = spawn(process.execPath, [PREPARE, d.repo, arg], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    c.stdout.on("data", (x) => (out += x));
    c.stderr.on("data", (x) => (err += x));
    c.on("close", (code) => resolve({ code, out: out.trim(), err }));
  });

test("resolveCacheDirs: 명시 > 환경변수 > 예전 기본(<tmp>/jipgye-golden), SHA 캐시는 작업 폴더를 따라간다", () => {
  const tmp = "/t";
  assert.deepEqual(resolveCacheDirs({}, {}, tmp), { cacheDir: "/t/jipgye-golden", shaCacheDir: "/t/jipgye-golden" }, "환경변수가 없으면 예전 모양 그대로(CI·기존 시험)");
  assert.deepEqual(resolveCacheDirs({}, { GOLDEN_CACHE_DIR: "/w" }, tmp), { cacheDir: "/w", shaCacheDir: "/w" });
  assert.deepEqual(resolveCacheDirs({}, { GOLDEN_CACHE_DIR: "/w", GOLDEN_SHA_CACHE_DIR: "/s" }, tmp), { cacheDir: "/w", shaCacheDir: "/s" });
  assert.deepEqual(resolveCacheDirs({ cacheDir: "/x" }, { GOLDEN_CACHE_DIR: "/w", GOLDEN_SHA_CACHE_DIR: "/s" }, tmp), { cacheDir: "/x", shaCacheDir: "/x" }, "cacheDir 를 명시하면 공유 환경변수가 새지 않는다");
  assert.deepEqual(resolveCacheDirs({ cacheDir: "/x", shaCacheDir: "/y" }, {}, tmp), { cacheDir: "/x", shaCacheDir: "/y" });
});

test("shaCacheName: 키는 전체 SHA 뿐이다 — 줄임·ref·대문자는 거부", () => {
  assert.equal(shaCacheName(FULL), `sha-${FULL}`);
  assert.equal(shaCacheName("b".repeat(64)), `sha-${"b".repeat(64)}`);
  for (const bad of ["main", "HEAD", "abc1234", "a".repeat(39), "A".repeat(40), `${FULL}/../x`, ""]) assert.throws(() => shaCacheName(bad), /전체 SHA/, bad);
});

test("공유 SHA 캐시: sha-<전체 SHA> 는 공유 폴더에, --src 스냅숏은 작업 폴더에 생긴다", async () => {
  await sandbox(async (d) => {
    const work = path.join(d.base, "work");
    const sha = headOf(d);
    const a = await run(d, work, sha);
    assert.equal(a.code, 0, a.err);
    assert.equal(a.out, path.join(d.shared, `sha-${sha}`));
    assert.deepEqual(await ls(d.shared), [`sha-${sha}`]);
    const b = await run(d, work, "--src");
    assert.equal(b.code, 0, b.err);
    assert.equal(path.dirname(b.out), work, "스냅숏은 전용 작업 폴더");
    assert.deepEqual(await ls(d.shared), [`sha-${sha}`], "공유 폴더에 스냅숏이 새지 않는다");
  });
});

test("공유 SHA 캐시: 같은 SHA 는 두 번째 실행부터 다시 만들지 않고, 작업 폴더를 지워도 살아 있다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    const work1 = path.join(d.base, "w1");
    const a = await run(d, work1, sha);
    assert.equal(a.code, 0, a.err);
    await writeFile(path.join(a.out, "sentinel"), "처음 만든 사본");
    await rm(work1, { recursive: true, force: true }); // 다른 실행이 자기 작업 폴더를 지우는 것과 같다
    const b = await run(d, path.join(d.base, "w2"), sha);
    assert.equal(b.code, 0, b.err);
    assert.equal(b.out, a.out);
    assert.ok(existsSync(path.join(b.out, "sentinel")), "다시 만들었다면 sentinel 이 없다 — 캐시 적중이 아니다");
    assert.ok(existsSync(path.join(b.out, ".done")));
  });
});

test("공유 SHA 캐시: 다른 SHA 의 캐시는 쓰지 않는다(키가 전체 SHA)", async () => {
  await sandbox(async (d) => {
    const a = await run(d, path.join(d.base, "w1"), headOf(d));
    await writeFile(path.join(a.out, "sentinel"), "첫 SHA 의 것");
    const sha2 = await commit(d.repo, 7);
    const b = await run(d, path.join(d.base, "w2"), sha2);
    assert.equal(b.code, 0, b.err);
    assert.notEqual(b.out, a.out);
    assert.equal(b.out, path.join(d.shared, `sha-${sha2}`));
    assert.equal(existsSync(path.join(b.out, "sentinel")), false, "다른 SHA 의 사본이 섞였다");
    assert.equal((await run(d, path.join(d.base, "w3"), sha2.slice(0, 12))).out, b.out, "줄임 SHA 도 전체 SHA 로 풀려 같은 캐시");
  });
});

test("공유 SHA 캐시: 서로 다른 작업 폴더의 여섯 프로세스가 같은 SHA 를 동시에 만들어도 캐시는 하나고 찌꺼기가 없다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    const works = Array.from({ length: 6 }, (_, i) => path.join(d.base, `w${i}`));
    const results = await Promise.all(works.map((w) => run(d, w, sha)));
    for (const r of results) assert.equal(r.code, 0, r.err);
    assert.equal(new Set(results.map((r) => r.out)).size, 1);
    assert.deepEqual(await ls(d.shared), [`sha-${sha}`], "임시 이름(.tmp-)·휴지통이 남지 않는다");
    assert.ok(existsSync(path.join(d.shared, `sha-${sha}`, ".done")));
    for (const w of works) assert.deepEqual(await ls(w), [], "작업 폴더에도 찌꺼기가 없다");
  });
});

test("공유 폴더 없이 작업 폴더만 주면 SHA 캐시도 거기에 생긴다 — 작업 폴더를 지우면 같이 사라진다(기본 격리)", async () => {
  await sandbox(async (d) => {
    const work = path.join(d.base, "w");
    const sha = headOf(d);
    const a = await run(d, work, sha, { shared: "" });
    assert.equal(a.out, path.join(work, `sha-${sha}`));
    assert.deepEqual(await ls(d.shared), []);
  });
});

test("preparePristine 옵션 shaCacheDir: 명시하면 그 폴더에 만든다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    const p = await preparePristine({ repo: d.repo, sha, cacheDir: path.join(d.base, "w"), shaCacheDir: d.shared, tmpRoot: d.tmp, minFreeBytes: 0 });
    assert.equal(p.dir, path.join(d.shared, `sha-${sha}`));
  });
});

// ---- 렌더 결과 캐시(opt-in): 기준 렌더를 같은 SHA·같은 입력이면 다시 굽지 않는다

const STAGES = ["scripts/step1.mjs"];
const renderOpts = (d, extra = {}) => ({ env: { BUILD_NOW: "2026-10-25T00:00:00Z" }, stages: STAGES, tmpRoot: d.tmp, minFreeBytes: 0, ...extra });
const prep = (d, sha, extra = {}) => preparePristine({ repo: d.repo, sha, cacheDir: path.join(d.base, "w"), shaCacheDir: d.shared, tmpRoot: d.tmp, minFreeBytes: 0, ...extra });
const renders = async (d) => (await ls(d.shared)).filter((n) => n.startsWith("render-"));

test("renderCacheName: 같은 SHA·같은 입력이면 같은 이름, 입력이나 SHA 가 다르면 다른 이름, 전체 SHA 만 받는다", () => {
  const a = renderCacheName(FULL, { env: { BUILD_NOW: "x" }, stages: ["s"] });
  assert.match(a, new RegExp(`^render-${FULL}-[0-9a-f]{16}$`));
  assert.equal(renderCacheName(FULL, { env: { BUILD_NOW: "x" }, stages: ["s"] }), a);
  assert.notEqual(renderCacheName(FULL, { env: { BUILD_NOW: "y" }, stages: ["s"] }), a);
  assert.notEqual(renderCacheName(FULL, { env: { BUILD_NOW: "x" }, stages: ["t"] }), a);
  assert.notEqual(renderCacheName("b".repeat(40), { env: { BUILD_NOW: "x" }, stages: ["s"] }), a);
  assert.throws(() => renderCacheName("main", {}), /전체 SHA/);
});

test("렌더 캐시: 공유 SHA 캐시를 켜면 첫 렌더가 결과를 두고 다음 실행은 렌더 단계 없이 그것을 쓴다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    const first = await renderIsolated(await prep(d, sha), renderOpts(d));
    assert.equal(first.cached, false);
    assert.equal(await readFile(path.join(first.docsDir, "a.html"), "utf8"), "<p>count=1</p>");
    await first.dispose();
    const [name] = await renders(d);
    assert.ok(name, "렌더 결과가 캐시에 없다");
    assert.ok(existsSync(path.join(d.shared, name, ".done")) && existsSync(path.join(d.shared, name, "docs/a.html")));
    assert.deepEqual(await ls(d.tmp), [], "렌더 사본이 남았다");
    await writeFile(path.join(d.shared, name, "docs/a.html"), "<p>from-cache</p>"); // 적중이면 이 내용이 나온다(다시 구우면 count=1)
    const second = await renderIsolated(await prep(d, sha), renderOpts(d));
    assert.equal(second.cached, true);
    assert.equal(await readFile(path.join(second.docsDir, "a.html"), "utf8"), "<p>from-cache</p>");
    assert.deepEqual(second.timings, []);
    assert.deepEqual(second.touched, first.touched, "touched 도 그대로 돌려준다");
    await second.dispose();
    assert.ok(existsSync(path.join(d.shared, name, ".done")), "dispose 가 공유 캐시를 지웠다");
    assert.deepEqual(await ls(d.tmp), []);
    assert.equal((await ls(d.shared)).filter((n) => n.includes(".tmp-")).length, 0, "임시 이름이 남았다");
  });
});

test("렌더 캐시: 입력(BUILD_NOW·단계)이나 SHA 가 다르면 쓰지 않는다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    await (await renderIsolated(await prep(d, sha), renderOpts(d))).dispose();
    const [name] = await renders(d);
    await writeFile(path.join(d.shared, name, "docs/a.html"), "<p>from-cache</p>");
    const otherNow = await renderIsolated(await prep(d, sha), renderOpts(d, { env: { BUILD_NOW: "2026-01-01T00:00:00Z" } }));
    assert.equal(otherNow.cached, false);
    assert.equal(await readFile(path.join(otherNow.docsDir, "a.html"), "utf8"), "<p>count=1</p>");
    await otherNow.dispose();
    const otherStages = await renderIsolated(await prep(d, sha), renderOpts(d, { stages: [] }));
    assert.equal(otherStages.cached, false);
    await otherStages.dispose();
    const sha2 = await commit(d.repo, 7);
    const otherSha = await renderIsolated(await prep(d, sha2), renderOpts(d));
    assert.equal(otherSha.cached, false);
    assert.equal(await readFile(path.join(otherSha.docsDir, "a.html"), "utf8"), "<p>count=8</p>");
    await otherSha.dispose();
    assert.equal((await renders(d)).length, 4);
  });
});

test("렌더 캐시: 공유 폴더가 없으면(기본) 결과를 캐시하지 않는다 — cacheRenders 로만 켠다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    const w = path.join(d.base, "w");
    const p = await preparePristine({ repo: d.repo, sha, cacheDir: w, tmpRoot: d.tmp, minFreeBytes: 0 });
    const r = await renderIsolated(p, renderOpts(d));
    assert.equal(r.cached, false);
    await r.dispose();
    assert.equal((await ls(w)).filter((n) => n.startsWith("render-")).length, 0);
    const on = await preparePristine({ repo: d.repo, sha, cacheDir: w, tmpRoot: d.tmp, minFreeBytes: 0, cacheRenders: true });
    await (await renderIsolated(on, renderOpts(d))).dispose();
    assert.equal((await ls(w)).filter((n) => n.startsWith("render-")).length, 1);
  });
});

test("렌더 캐시: 깨진 항목(meta 없음)은 쓰지 않고 새로 구워 채운다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    await (await renderIsolated(await prep(d, sha), renderOpts(d))).dispose();
    const [name] = await renders(d);
    await rm(path.join(d.shared, name, "meta.json"));
    await writeFile(path.join(d.shared, name, "docs/a.html"), "<p>broken</p>");
    const r = await renderIsolated(await prep(d, sha), renderOpts(d));
    assert.equal(r.cached, false);
    assert.equal(await readFile(path.join(r.docsDir, "a.html"), "utf8"), "<p>count=1</p>");
    await r.dispose();
    assert.equal(await readFile(path.join(d.shared, name, "docs/a.html"), "utf8"), "<p>count=1</p>", "깨진 항목이 새 결과로 바뀌었다");
    assert.ok(existsSync(path.join(d.shared, name, "meta.json")));
  });
});

test("렌더 캐시: 서로 다른 작업 폴더의 동시 렌더도 결과는 하나고 찌꺼기가 없다", async () => {
  await sandbox(async (d) => {
    const sha = headOf(d);
    const rs = await Promise.all(
      [0, 1, 2, 3].map(async (i) => renderIsolated(await prep(d, sha, { cacheDir: path.join(d.base, `w${i}`) }), renderOpts(d)))
    );
    for (const r of rs) assert.equal(await readFile(path.join(r.docsDir, "a.html"), "utf8"), "<p>count=1</p>");
    for (const r of rs) await r.dispose();
    assert.equal((await renders(d)).length, 1);
    assert.deepEqual((await ls(d.shared)).filter((n) => !n.startsWith("sha-") || n.includes(".tmp-")).filter((n) => !n.startsWith("render-")), []);
    assert.equal((await ls(d.shared)).filter((n) => n.includes(".tmp-")).length, 0);
  });
});

test("pruneRenderCaches: 상한을 넘으면 .done mtime 이 오래된 것부터 지운다(grace 안의 것은 남긴다)", async () => {
  await sandbox(async (d) => {
    await mkdir(d.shared, { recursive: true });
    const names = [];
    for (const [i, hours] of [50, 40, 30, 20].entries()) {
      const n = `render-${String(i).repeat(40)}-${"a".repeat(16)}`;
      names.push(n);
      await mkdir(path.join(d.shared, n, ".done"), { recursive: true });
      const t = new Date(Date.now() - hours * 3600 * 1000);
      await utimes(path.join(d.shared, n, ".done"), t, t);
    }
    await mkdir(path.join(d.shared, `sha-${FULL}`, ".done"), { recursive: true }); // 다른 종류는 건드리지 않는다
    const removed = await pruneRenderCaches(d.shared, { graceMs: 10 * 60 * 1000, maxRenders: 2 });
    assert.deepEqual(removed.map((p) => path.basename(p)).sort(), names.slice(0, 2).sort());
    assert.deepEqual(await ls(d.shared), [names[2], names[3], `sha-${FULL}`].sort());
    assert.deepEqual(await pruneRenderCaches(d.shared, { graceMs: 10 * 60 * 1000, maxRenders: 2 }), []);
  });
});
