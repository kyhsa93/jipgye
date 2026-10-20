import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareBytes, treeHash } from "../lib/compare.ts";
import { preparePristine, readWorkflowStages, renderIsolated } from "../lib/render.ts";

// 렌더 격리와 환경 주입(#236 범위 3·4). 작은 가짜 저장소(고정 파일)를 만들어 쓴다 — 실제 docs/나 raw/는 읽지 않는다.
//   step1은 docs/a.html을 읽어 덮어쓴다(prerender.mjs와 같은 모양: 두 번 돌리면 두 번 덧칠된다).
//   step2는 환경(TZ·BUILD_NOW·JIPGYE_RENDERER)과 Date.now()를 docs/env.html에 적는다.
const STEP1 = `import { readFile, writeFile } from "node:fs/promises";
const f = new URL("../docs/a.html", import.meta.url);
const n = Number((await readFile(f, "utf8")).match(/count=(\\d+)/)[1]);
await writeFile(f, \`<p>count=\${n + 1}</p>\`);
`;
const STEP2 = `import { writeFile } from "node:fs/promises";
const e = process.env;
const tz = new Date(Date.UTC(2026, 0, 1, 20, 0)).toLocaleString("en-US", { hour: "numeric", hour12: false });
await writeFile(new URL("../docs/env.html", import.meta.url),
  \`<p>TZ=\${e.TZ}|hour=\${tz}|BUILD_NOW=\${e.BUILD_NOW ?? "-"}|R=\${e.JIPGYE_RENDERER ?? "-"}|now=\${new Date(Date.now()).toISOString()}</p>\`);
`;
const STAGES = ["scripts/step1.mjs", "scripts/step2.mjs"];

async function fakeRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "golden-fake-"));
  await mkdir(path.join(dir, "scripts"));
  await mkdir(path.join(dir, "docs"));
  await writeFile(path.join(dir, "scripts/step1.mjs"), STEP1);
  await writeFile(path.join(dir, "scripts/step2.mjs"), STEP2);
  await writeFile(path.join(dir, "docs/a.html"), "<p>count=0</p>");
  const git = (...a) => spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return dir;
}
const read = (dir, f) => readFile(path.join(dir, f), "utf8");

test("격리: 같은 SHA에서 두 번 렌더해도 같은 출력이고 저장소 docs/는 그대로다", async () => {
  const repo = await fakeRepo();
  const cache = await mkdtemp(path.join(os.tmpdir(), "golden-cache-"));
  try {
    const before = await treeHash(repo, (f) => !f.startsWith(".git/"));
    const pristine = await preparePristine({ repo, sha: "HEAD", cacheDir: cache });
    // env.html에는 Date.now()가 찍히므로 시각을 고정해야 두 렌더가 바이트로 같다(실제 렌더 단계에서는 BUILD_NOW가 그 일을 한다).
    const one = await renderIsolated(pristine, { stages: STAGES, mockNow: "2026-10-11T00:00:00Z" });
    const two = await renderIsolated(pristine, { stages: STAGES, mockNow: "2026-10-11T00:00:00Z" });
    try {
      assert.equal(await read(one.docsDir, "a.html"), "<p>count=1</p>");
      assert.equal(await read(two.docsDir, "a.html"), "<p>count=1</p>", "두 번째 렌더도 깨끗한 사본에서 시작한다(덧칠되지 않는다)");
      assert.equal((await compareBytes(one.docsDir, two.docsDir)).diffs.length, 0);
      assert.deepEqual(one.touched.sort(), ["docs/a.html", "docs/env.html"]);
      assert.equal(await read(repo, "docs/a.html"), "<p>count=0</p>");
      assert.equal(await treeHash(repo, (f) => !f.startsWith(".git/")), before, "저장소 작업 트리는 바뀌지 않는다");
      assert.deepEqual(one.timings.map((t) => t.stage), STAGES);
    } finally {
      await Promise.all([one.dispose(), two.dispose()]);
    }
  } finally {
    await Promise.all([rm(repo, { recursive: true }), rm(cache, { recursive: true })]);
  }
});

test("격리: 커밋 뒤에 생긴 미커밋 변경은 sha 모드에 들어가지 않고 srcDir 모드(스냅숏)에는 들어간다", async () => {
  const repo = await fakeRepo();
  const cache = await mkdtemp(path.join(os.tmpdir(), "golden-cache-"));
  try {
    await writeFile(path.join(repo, "docs/a.html"), "<p>count=40</p>"); // 미커밋
    const fromSha = await preparePristine({ repo, sha: "HEAD", cacheDir: cache });
    const fromDir = await preparePristine({ srcDir: repo, cacheDir: cache });
    const a = await renderIsolated(fromSha, { stages: STAGES });
    const b = await renderIsolated(fromDir, { stages: STAGES });
    try {
      assert.equal(await read(a.docsDir, "a.html"), "<p>count=1</p>");
      assert.equal(await read(b.docsDir, "a.html"), "<p>count=41</p>");
    } finally {
      await Promise.all([a.dispose(), b.dispose(), rm(fromDir.dir, { recursive: true })]);
    }
  } finally {
    await Promise.all([rm(repo, { recursive: true }), rm(cache, { recursive: true })]);
  }
});

test("환경 주입: TZ·BUILD_NOW·JIPGYE_RENDERER는 준 것만 들어가고, 상속된 값은 지운다", async () => {
  const repo = await fakeRepo();
  const cache = await mkdtemp(path.join(os.tmpdir(), "golden-cache-"));
  const saved = { BUILD_NOW: process.env.BUILD_NOW, JIPGYE_RENDERER: process.env.JIPGYE_RENDERER };
  process.env.BUILD_NOW = "2000-01-01T00:00:00Z"; // 호출자 환경에 새어 있는 값
  process.env.JIPGYE_RENDERER = "react";
  try {
    const pristine = await preparePristine({ repo, sha: "HEAD", cacheDir: cache });
    const plain = await renderIsolated(pristine, { stages: STAGES });
    const seoul = await renderIsolated(pristine, { stages: STAGES, env: { TZ: "Asia/Seoul", BUILD_NOW: "2026-10-11T00:00:00Z", JIPGYE_RENDERER: "legacy" } });
    const mocked = await renderIsolated(pristine, { stages: STAGES, mockNow: "2026-03-04T05:06:07.000Z" });
    try {
      const t = await read(plain.docsDir, "env.html");
      assert.match(t, /TZ=UTC\|hour=20\|BUILD_NOW=-\|R=-\|/, "기본은 TZ=UTC이고 상속된 BUILD_NOW·JIPGYE_RENDERER는 없다");
      assert.match(await read(seoul.docsDir, "env.html"), /TZ=Asia\/Seoul\|hour=05\|BUILD_NOW=2026-10-11T00:00:00Z\|R=legacy\|/, "Asia/Seoul이면 UTC 20시가 5시");
      assert.match(await read(mocked.docsDir, "env.html"), /now=2026-03-04T05:06:07\.000Z/, "mockNow는 Date.now를 고정한다");
      assert.doesNotMatch(t, /now=2026-03-04/);
    } finally {
      await Promise.all([plain.dispose(), seoul.dispose(), mocked.dispose()]);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    await Promise.all([rm(repo, { recursive: true }), rm(cache, { recursive: true })]);
  }
});

test("단계가 실패하면 어느 스크립트인지 적어 예외로 낸다", async () => {
  const repo = await fakeRepo();
  const cache = await mkdtemp(path.join(os.tmpdir(), "golden-cache-"));
  try {
    await writeFile(path.join(repo, "scripts/boom.mjs"), 'throw new Error("펑");\n');
    const pristine = await preparePristine({ srcDir: repo, cacheDir: cache });
    await assert.rejects(renderIsolated(pristine, { stages: ["scripts/step1.mjs", "scripts/boom.mjs"] }), /scripts\/boom\.mjs 실패.*펑/s);
    await rm(pristine.dir, { recursive: true });
  } finally {
    await Promise.all([rm(repo, { recursive: true }), rm(cache, { recursive: true })]);
  }
});

test("readWorkflowStages: 워크플로의 렌더 단계 줄을 순서대로 읽는다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "golden-wf-"));
  try {
    const file = path.join(dir, "wf.yml");
    await writeFile(
      file,
      `jobs:
  x:
    steps:
      - name: 정적 HTML에 오늘 내용 심기
        run: |
          node scripts/prerender.mjs
          node scripts/build-rate-pages.mjs

      # 커밋이 테스트보다 먼저다.
      - name: 변경사항 커밋 및 푸시
        run: |
          node scripts/not-a-stage.mjs
`
    );
    assert.deepEqual(await readWorkflowStages(file), ["scripts/prerender.mjs", "scripts/build-rate-pages.mjs"]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("readWorkflowStages: render-pipeline 한 줄이면 그 저장소의 기본 단계(RENDER_STEPS)로 펼친다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "golden-wf-"));
  try {
    await mkdir(path.join(dir, ".github/workflows"), { recursive: true });
    await mkdir(path.join(dir, "scripts"), { recursive: true });
    await writeFile(path.join(dir, "scripts/render-pipeline.mjs"), 'export const RENDER_STEPS = ["scripts/a.mjs", "scripts/b.mjs"];\n');
    const file = path.join(dir, ".github/workflows/wf.yml");
    await writeFile(
      file,
      `jobs:
  x:
    steps:
      - name: 정적 HTML에 오늘 내용 심기
        id: render
        run: node scripts/render-pipeline.mjs

      # 커밋이 테스트보다 먼저다.
      - name: 변경사항 커밋 및 푸시
        run: |
          node scripts/not-a-stage.mjs
`
    );
    assert.deepEqual(await readWorkflowStages(file), ["scripts/a.mjs", "scripts/b.mjs"]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("#418 readWorkflowStages: 확장자가 .ts 로 바뀐 줄·render-pipeline 도 같은 단계 수로 읽는다(개명해도 빈 배열이 되지 않는다)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "golden-wf-"));
  try {
    await mkdir(path.join(dir, ".github/workflows"), { recursive: true });
    await mkdir(path.join(dir, "scripts"), { recursive: true });
    const wf = (lines) => `jobs:\n  x:\n    steps:\n      - name: 정적 HTML에 오늘 내용 심기\n        run: |\n${lines.map((l) => `          ${l}\n`).join("")}\n      - name: 변경사항 커밋 및 푸시\n        run: |\n          node scripts/not-a-stage.ts\n`;
    const file = path.join(dir, ".github/workflows/wf.yml");
    // 직접 부르는 줄: .mjs 와 .ts 가 섞여도 둘 다 읽는다.
    await writeFile(file, wf(["node scripts/prerender.ts", "node scripts/build-rate-pages.mjs"]));
    assert.deepEqual(await readWorkflowStages(file), ["scripts/prerender.ts", "scripts/build-rate-pages.mjs"]);
    // render-pipeline 한 줄: 파일이 .ts 로 바뀌어도 워크플로가 적은 이름 그대로 찾아 펼친다.
    await writeFile(path.join(dir, "scripts/render-pipeline.ts"), 'export const RENDER_STEPS: string[] = ["scripts/a.ts", "scripts/b.mjs"];\n');
    await writeFile(file, wf(["node scripts/render-pipeline.ts"]));
    assert.deepEqual(await readWorkflowStages(file), ["scripts/a.ts", "scripts/b.mjs"]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("상대경로 --repo로 줘도 node_modules 링크가 절대경로로 걸려 렌더 사본에서 풀린다", async () => {
  const repo = await fakeRepo();
  const cache = await mkdtemp(path.join(os.tmpdir(), "golden-cache-"));
  try {
    await mkdir(path.join(repo, "node_modules/marker"), { recursive: true });
    await writeFile(path.join(repo, "node_modules/marker/index.js"), "");
    const rel = path.relative(process.cwd(), repo);
    assert.ok(!path.isAbsolute(rel));
    const pristine = await preparePristine({ repo: rel, sha: "HEAD", cacheDir: cache });
    assert.equal(pristine.nodeModules, path.join(repo, "node_modules"));
    const r = await renderIsolated(pristine, { stages: ["scripts/step1.mjs"] });
    try {
      const { existsSync } = await import("node:fs");
      assert.ok(existsSync(path.join(r.workDir, "node_modules/marker/index.js")), "작업 사본의 node_modules 링크가 끊겼다");
    } finally {
      await r.dispose();
    }
  } finally {
    await Promise.all([rm(repo, { recursive: true }), rm(cache, { recursive: true })]);
  }
});
