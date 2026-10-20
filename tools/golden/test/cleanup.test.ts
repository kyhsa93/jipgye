import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DiskSpaceError, OWNER, assertDiskSpace, commitDir, limitsFromEnv, pruneShaCaches, sweepOrphans, writeOwner } from "../lib/cleanup.ts";
import { preparePristine, renderIsolated } from "../lib/render.ts";
import { commit, fakeRepo, git } from "./helpers/fake-repo.ts";

// 임시 사본·캐시 정리(#263). 고정 가짜 저장소(test/helpers/fake-repo.ts)만 쓰고 실제 docs/·raw/는 읽지 않는다.
// 시험마다 자기 폴더(base) 하나 안에 repo·cache·tmp를 만들고 끝에 base째 지운다 — 시험이 디스크를 채우지 않게(이 이슈의 주제).
// 이 폴더의 시험은 CI(.github/workflows/test.yml 70~80행)가 루트 시험 뒤 `npm ci`·`npm test`로 따로 돌린다(#309).
// 로컬에서 돌리는 명령은 같다: `cd tools/golden && npm ci && npm test`.
const BIN = path.join(import.meta.dirname, "../bin/render.ts");
const HOUR = 3600 * 1000;
const STAGES = ["scripts/step1.mjs"];

async function sandbox(fn) {
  const base = await mkdtemp(path.join(os.tmpdir(), "golden-clean-"));
  const dirs = { base, cache: path.join(base, "cache"), tmp: path.join(base, "tmp"), repo: await fakeRepo(base) };
  await mkdir(dirs.tmp);
  try {
    return await fn(dirs);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
const ls = async (dir) => (existsSync(dir) ? (await readdir(dir)).sort() : []);
const ago = (hours) => new Date(Date.now() - hours * HOUR);
const age = (p, hours) => utimes(p, ago(hours), ago(hours));
// bin을 돌린다. TMPDIR을 sandbox/tmp로 돌려 os.tmpdir()의 렌더 사본도 거기에만 생기게 한다.
const bin = (d, args, env = {}) =>
  spawnSync(process.execPath, [BIN, "--out", path.join(d.base, "out"), "--cache", d.cache, "--stages", STAGES.join(","), ...args], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: d.tmp, ...env },
  });

test("--src 렌더가 끝나면 스냅숏(snap-*)과 렌더 사본(jipgye-render-*)이 남지 않는다", async () => {
  await sandbox(async (d) => {
    const r = bin(d, ["--src", d.repo]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(await readFile(path.join(d.base, "out/a.html"), "utf8"), "<p>count=1</p>");
    assert.deepEqual(await ls(d.cache), [], "스냅숏이 남았다");
    assert.deepEqual(await ls(d.tmp), [], "렌더 사본이 남았다");
    assert.equal(JSON.parse(r.stdout).keptSnapshot, null);
  });
});

test("--keep이면 스냅숏이 남고 경로를 출력한다(렌더 사본은 지운다)", async () => {
  await sandbox(async (d) => {
    const r = bin(d, ["--src", d.repo, "--keep"]);
    assert.equal(r.status, 0, r.stderr);
    const kept = JSON.parse(r.stdout).keptSnapshot;
    assert.ok(kept && existsSync(path.join(kept, "docs/a.html")), "스냅숏이 없다");
    assert.equal(path.dirname(kept), d.cache);
    assert.match(r.stderr, /스냅숏을 남겼습니다/);
    assert.deepEqual(await ls(d.tmp), []);
    assert.equal(JSON.parse(await readFile(path.join(kept, OWNER), "utf8")).kept, true);
  });
});

test("실패 경로: 렌더 단계가 예외로 끝나도 스냅숏·렌더 사본이 남지 않고 종료 1이다", async () => {
  await sandbox(async (d) => {
    const r = spawnSync(process.execPath, [BIN, "--src", d.repo, "--out", path.join(d.base, "out"), "--cache", d.cache, "--stages", "scripts/step1.mjs,scripts/boom.mjs"], {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: d.tmp },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /scripts\/boom\.mjs 실패.*펑/s);
    assert.deepEqual(await ls(d.cache), []);
    assert.deepEqual(await ls(d.tmp), []);
  });
});

for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  test(`${sig}: 렌더 도중 신호를 받으면 스냅숏·렌더 사본을 지우고 단계 프로세스도 끝내며 종료 ${code}`, async () => {
    await sandbox(async (d) => {
      const child = spawn(process.execPath, [BIN, "--src", d.repo, "--out", path.join(d.base, "out"), "--cache", d.cache, "--stages", "scripts/sleep.mjs"], {
        env: { ...process.env, TMPDIR: d.tmp },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = new Promise((resolve) => child.on("close", (c, s) => resolve({ c, s })));
      // 렌더 단계가 `started`(자기 pid)를 쓸 때까지 기다린다 = 사본 두 개가 실제로 있는 시점.
      let stagePid = null;
      for (let i = 0; i < 400 && !stagePid; i++) {
        for (const n of (await ls(d.tmp)).filter((n) => n.startsWith("jipgye-render-"))) {
          stagePid = Number(await readFile(path.join(d.tmp, n, "work/docs/started"), "utf8").catch(() => "")) || null;
        }
        if (!stagePid) await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(stagePid, "렌더 단계가 시작되지 않았다");
      assert.equal((await ls(d.cache)).filter((n) => n.startsWith("snap-")).length, 1, "신호 전에는 스냅숏이 있다");
      child.kill(sig);
      const { c } = await closed;
      assert.equal(c, code);
      assert.deepEqual(await ls(d.cache), [], "스냅숏이 남았다");
      assert.deepEqual(await ls(d.tmp), [], "렌더 사본이 남았다");
      for (let i = 0; i < 100; i++) {
        try {
          process.kill(stagePid, 0);
        } catch {
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.fail("단계 프로세스가 살아 있다");
    });
  });
}

test("pristine.dispose(): --src 스냅숏은 지우고 SHA 캐시는 남긴다", async () => {
  await sandbox(async (d) => {
    const lim = { minFreeBytes: 0 };
    const snap = await preparePristine({ srcDir: d.repo, cacheDir: d.cache, tmpRoot: d.tmp, ...lim });
    assert.equal(snap.temporary, true);
    assert.ok(existsSync(snap.dir));
    await snap.dispose();
    await snap.dispose(); // 두 번 불러도 안전
    assert.equal(existsSync(snap.dir), false);
    const sha = await preparePristine({ repo: d.repo, sha: "HEAD", cacheDir: d.cache, tmpRoot: d.tmp, ...lim });
    assert.equal(sha.temporary, false);
    await sha.dispose();
    assert.ok(existsSync(path.join(sha.dir, ".done")), "SHA 캐시는 재사용하려고 남는다");
    assert.deepEqual((await ls(d.cache)).filter((n) => n.startsWith("snap-")), []);
  });
});

test("renderIsolated가 예외로 끝나면 자기 사본(jipgye-render-*)을 지우고 던진다", async () => {
  await sandbox(async (d) => {
    const p = await preparePristine({ srcDir: d.repo, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0 });
    await assert.rejects(renderIsolated(p, { stages: ["scripts/boom.mjs"], tmpRoot: d.tmp, minFreeBytes: 0 }), /펑/);
    assert.deepEqual(await ls(d.tmp), []);
    await p.dispose();
  });
});

// ---- SHA 캐시 상한

async function shaCaches(d, n) {
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const sha = await commit(d.repo, (d.seq = (d.seq ?? 0) + 1)); // 커밋마다 다른 내용 = 다른 SHA
    dirs.push((await preparePristine({ repo: d.repo, sha, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0, maxShaCaches: 99 })).dir);
  }
  return dirs;
}

test("SHA 캐시 상한: 상한을 넘으면 .done의 mtime이 오래된 것부터 지운다", async () => {
  await sandbox(async (d) => {
    const dirs = await shaCaches(d, 5);
    // 만든 순서와 쓴 순서를 다르게: 3번째가 가장 오래 안 쓴 것, 1번째는 최근에 다시 썼다.
    const hours = [1, 3, 6, 5, 4];
    for (const [i, h] of hours.entries()) await age(path.join(dirs[i], ".done"), h);
    const removed = await pruneShaCaches(d.cache, { keep: dirs[4], maxShaCaches: 3, graceMs: 0 });
    // keep(4h)이 한 자리를 차지하므로 나머지 둘을 최근 순(1h·3h)으로 남기고 6h·5h를 지운다.
    assert.deepEqual(removed.sort(), [dirs[2], dirs[3]].sort(), "가장 오래 안 쓴 둘");
    assert.deepEqual((await ls(d.cache)).map((n) => path.join(d.cache, n)).sort(), [dirs[0], dirs[1], dirs[4]].sort());
  });
});

test("SHA 캐시 상한: 지금 쓰는(keep) 캐시와 grace 안에 쓴 캐시는 상한을 넘어도 지우지 않는다", async () => {
  await sandbox(async (d) => {
    const dirs = await shaCaches(d, 4);
    for (const [i, h] of [10, 9, 8, 7].entries()) await age(path.join(dirs[i], ".done"), h);
    // keep이 가장 오래된 것이어도 지우지 않는다.
    let removed = await pruneShaCaches(d.cache, { keep: dirs[0], maxShaCaches: 1, graceMs: 0 });
    assert.ok(existsSync(dirs[0]), "keep은 남는다");
    assert.equal(removed.length, 3);
    // grace: 방금 쓴 것은 상한을 넘어도 남는다.
    const fresh = await shaCaches(d, 3);
    removed = await pruneShaCaches(d.cache, { keep: fresh[2], maxShaCaches: 1, graceMs: 10 * 60 * 1000 });
    assert.deepEqual(removed, [dirs[0]], "묵은 것(10h)만 지우고 방금 만든(쓴) 것 셋은 상한(1)을 넘어도 남긴다");
    for (const f of fresh) assert.ok(existsSync(f));
  });
});

test("SHA 캐시: 다시 쓰면 .done의 mtime이 올라가 가장 최근 사용이 된다", async () => {
  await sandbox(async (d) => {
    const [first] = await shaCaches(d, 2);
    await age(path.join(first, ".done"), 48);
    const sha = git(d.repo, "rev-parse", "HEAD~1").stdout.trim();
    assert.equal(path.basename(first), `sha-${sha}`);
    const before = (await stat(path.join(first, ".done"))).mtimeMs;
    const p = await preparePristine({ repo: d.repo, sha, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0 });
    assert.ok((await stat(path.join(p.dir, ".done"))).mtimeMs > before + 47 * HOUR, "preparePristine이 mtime을 올린다");
    await age(path.join(p.dir, ".done"), 48);
    const r = await renderIsolated(p, { stages: STAGES, tmpRoot: d.tmp, minFreeBytes: 0 });
    await r.dispose();
    assert.ok((await stat(path.join(p.dir, ".done"))).mtimeMs > Date.now() - HOUR, "렌더 때도 올린다");
  });
});

test("SHA 캐시: preparePristine이 새 캐시를 만들면 상한까지 오래된 것을 정리한다(기본 환경 상한 8)", async () => {
  assert.equal(limitsFromEnv({}).maxShaCaches, 8);
  await sandbox(async (d) => {
    const dirs = await shaCaches(d, 3);
    for (const [i, h] of [30, 20, 10].entries()) await age(path.join(dirs[i], ".done"), h);
    const sha = await commit(d.repo, 100);
    const p = await preparePristine({ repo: d.repo, sha, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0, maxShaCaches: 2, graceMs: 0 });
    assert.deepEqual((await ls(d.cache)).map((n) => path.join(d.cache, n)).sort(), [dirs[2], p.dir].sort(), "새 것 + 가장 최근 것 1개만");
  });
});

// ---- 동시 실행

test("동시 실행: 같은 SHA를 여섯 프로세스가 동시에 만들어도 모두 같은 완성된 캐시를 받고 찌꺼기가 없다", async () => {
  await sandbox(async (d) => {
    const sha = git(d.repo, "rev-parse", "HEAD").stdout.trim();
    const script = path.join(import.meta.dirname, "helpers/prepare.ts");
    const runs = Array.from({ length: 6 }, () =>
      new Promise((resolve) => {
        const c = spawn(process.execPath, [script, d.repo, sha, d.cache], { env: { ...process.env, TMPDIR: d.tmp }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        c.stdout.on("data", (x) => (out += x));
        c.stderr.on("data", (x) => (err += x));
        c.on("close", (code) => resolve({ code, out: out.trim(), err }));
      })
    );
    const results = await Promise.all(runs);
    for (const r of results) assert.equal(r.code, 0, r.err);
    assert.equal(new Set(results.map((r) => r.out)).size, 1);
    assert.deepEqual(await ls(d.cache), [`sha-${sha}`], "임시 이름(.tmp-)·휴지통이 남지 않는다");
    const dir = path.join(d.cache, `sha-${sha}`);
    assert.ok(existsSync(path.join(dir, ".done")) && existsSync(path.join(dir, "docs/a.html")) && existsSync(path.join(dir, "scripts/step1.mjs")));
    assert.equal(existsSync(path.join(dir, OWNER)), false, "주인 표지는 확정 전에 뗀다");
  });
});

test("commitDir: 최종 이름이 이미 있으면 내 임시 폴더를 지우고 false(이긴 쪽을 쓴다)", async () => {
  await sandbox(async (d) => {
    const win = path.join(d.base, "sha-win");
    const mine = path.join(d.base, "sha-win.tmp-a");
    const other = path.join(d.base, "sha-new.tmp-a");
    for (const p of [win, mine, other]) await mkdir(path.join(p, ".done"), { recursive: true });
    await writeFile(path.join(win, "x"), "먼저 확정된 것");
    assert.equal(await commitDir(mine, win), false);
    assert.equal(existsSync(mine), false);
    assert.equal(await readFile(path.join(win, "x"), "utf8"), "먼저 확정된 것", "이긴 쪽은 그대로");
    assert.equal(await commitDir(other, path.join(d.base, "sha-new")), true);
  });
});

test("옛 판이 만들다 만 sha-*(.done 없음)는 치우고 다시 만든다", async () => {
  await sandbox(async (d) => {
    const sha = git(d.repo, "rev-parse", "HEAD").stdout.trim();
    const half = path.join(d.cache, `sha-${sha}`);
    await mkdir(half, { recursive: true });
    await writeFile(path.join(half, "stale"), "반쪽");
    const p = await preparePristine({ repo: d.repo, sha, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0 });
    assert.equal(p.dir, half);
    assert.equal(existsSync(path.join(half, "stale")), false);
    assert.ok(existsSync(path.join(half, ".done")) && existsSync(path.join(half, "docs/a.html")));
  });
});

// ---- 디스크 점검

test("디스크 점검: 여유가 문턱 미만이면 DiskSpaceError로 멈추고 아무것도 만들지 않는다", async () => {
  await sandbox(async (d) => {
    await assert.rejects(
      preparePristine({ srcDir: d.repo, cacheDir: path.join(d.base, "never"), tmpRoot: d.tmp, minFreeBytes: Number.MAX_SAFE_INTEGER }),
      (e) => e instanceof DiskSpaceError && /디스크 여유가 모자라/.test(e.message)
    );
    assert.equal(existsSync(path.join(d.base, "never")), false, "캐시 폴더도 만들지 않는다");
    assert.deepEqual(await ls(d.tmp), []);
    // 0이면 통과한다.
    const ok = await preparePristine({ srcDir: d.repo, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0 });
    await ok.dispose();
  });
});

test("디스크 점검: 캐시 폴더와 렌더 사본 폴더(os.tmpdir) 둘 다 본다 — 한쪽만 모자라도 멈춘다", async () => {
  const GiB = 1024 ** 3;
  // 경로별로 여유를 흉내 낸다: tmp 쪽만 1GiB.
  const fake = (low) => async (p) => ({ bsize: 1, bavail: p.startsWith(low) ? GiB : 100 * GiB });
  await sandbox(async (d) => {
    const opts = { minFreeBytes: 5 * GiB };
    await mkdir(d.cache); // 없는 폴더는 있는 윗 폴더를 보므로(위 시험), 경로별 흉내를 위해 먼저 만든다
    await assert.rejects(assertDiskSpace([d.cache, d.tmp], { ...opts, statfsFn: fake(d.tmp) }), (e) => e instanceof DiskSpaceError && e.message.includes(d.tmp));
    await assert.rejects(assertDiskSpace([d.cache, d.tmp], { ...opts, statfsFn: fake(d.cache) }), (e) => e instanceof DiskSpaceError && e.message.includes(d.cache));
    await assertDiskSpace([d.cache, d.tmp], { ...opts, statfsFn: fake("/없는경로") });
    // preparePristine·renderIsolated도 같은 점검을 부른다.
    await assert.rejects(preparePristine({ srcDir: d.repo, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 5 * GiB, statfsFn: fake(d.tmp) }), DiskSpaceError);
    const p = await preparePristine({ srcDir: d.repo, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0 });
    await assert.rejects(renderIsolated(p, { stages: STAGES, tmpRoot: d.tmp, minFreeBytes: 5 * GiB, statfsFn: fake(d.tmp) }), DiskSpaceError);
    assert.deepEqual(await ls(d.tmp), []);
    await p.dispose();
  });
});

test("디스크 점검: 실제 statfs로 읽고 환경변수 GOLDEN_MIN_FREE_GB로 문턱을 주입하면 종료 3·분명한 메시지로 멈춘다", async () => {
  await sandbox(async (d) => {
    const r = bin(d, ["--src", d.repo], { GOLDEN_MIN_FREE_GB: "1000000000" });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /디스크 여유가 모자라 렌더를 시작하지 않습니다.*GOLDEN_MIN_FREE_GB/s);
    assert.deepEqual(await ls(d.cache), []);
    assert.deepEqual(await ls(d.tmp), []);
    assert.equal(existsSync(path.join(d.base, "out")), false);
    assert.equal(bin(d, ["--src", d.repo], { GOLDEN_MIN_FREE_GB: "0" }).status, 0);
    assert.throws(() => limitsFromEnv({ GOLDEN_MIN_FREE_GB: "abc" }), /숫자가 아닙니다/);
  });
});

// ---- 고아 정리

test("고아 정리: 24시간 넘은 snap-*·jipgye-render-*는 지우고, 젊은 것·살아 있는 pid·sha-* 캐시는 남긴다", async () => {
  await sandbox(async (d) => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid; // 이미 끝난 프로세스의 pid
    const mk = async (root, name, { pid = deadPid, hours, extra } = {}) => {
      const dir = path.join(root, name);
      await mkdir(dir, { recursive: true });
      await writeOwner(dir, extra);
      const o = JSON.parse(await readFile(path.join(dir, OWNER), "utf8"));
      await writeFile(path.join(dir, OWNER), JSON.stringify({ ...o, pid, createdAt: Date.now() - hours * HOUR }));
      return dir;
    };
    await mkdir(d.cache, { recursive: true });
    const oldSnap = await mk(d.cache, "snap-old", { hours: 25 });
    const oldRender = await mk(d.tmp, "jipgye-render-old", { hours: 30 });
    const oldTmp = await mk(d.cache, `sha-${"a".repeat(40)}.tmp-x1y2z3`, { hours: 26 });
    const youngSnap = await mk(d.cache, "snap-young", { hours: 2 });
    const aliveSnap = await mk(d.cache, "snap-alive", { pid: process.pid, hours: 99 });
    const keptSnap = await mk(d.cache, "snap-kept", { hours: 48, extra: { kept: true } });
    const keptOld = await mk(d.cache, "snap-kept-old", { hours: 24 * 8, extra: { kept: true } });
    const sha = path.join(d.cache, `sha-${"b".repeat(40)}`);
    await mkdir(path.join(sha, ".done"), { recursive: true });
    await age(path.join(sha, ".done"), 24 * 30);
    const other = path.join(d.tmp, "남의-폴더");
    await mkdir(other);
    const removed = await sweepOrphans({ cacheDir: d.cache, tmpRoot: d.tmp, orphanMs: 24 * HOUR });
    assert.deepEqual(removed.sort(), [oldSnap, oldRender, oldTmp, keptOld].sort());
    for (const keep of [youngSnap, aliveSnap, keptSnap, sha, other]) assert.ok(existsSync(keep), `${keep}을 지웠다`);
    // 표지 없는 옛 폴더는 ctime 규칙을 탄다: 문턱을 0으로 두면 지워진다.
    const legacy = path.join(d.cache, "snap-legacy");
    await mkdir(legacy);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await sweepOrphans({ cacheDir: d.cache, tmpRoot: d.tmp, orphanMs: 0 }).then((r) => r.filter((x) => x === legacy)), [legacy]);
  });
});

test("고아 정리: preparePristine이 시작할 때 부른다(GOLDEN_ORPHAN_HOURS 옵션 orphanMs)", async () => {
  await sandbox(async (d) => {
    const dir = path.join(d.cache, "snap-orphan");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, OWNER), JSON.stringify({ pid: spawnSync(process.execPath, ["-e", ""]).pid, createdAt: Date.now() - 25 * HOUR }));
    const p = await preparePristine({ srcDir: d.repo, cacheDir: d.cache, tmpRoot: d.tmp, minFreeBytes: 0 });
    assert.equal(existsSync(dir), false, "24시간 넘은 고아가 시작 때 지워진다");
    await p.dispose();
  });
});
