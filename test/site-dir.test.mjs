import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RENDER_STEPS } from "../scripts/render-pipeline.ts";
import { buildFixtureSite } from "./helpers/fixture-site.mjs";
import { DOCS_DIR, REPO_ROOT, SITE_DIR_ENV, requireSite, siteDir, siteLabel, sitePath, stageSite } from "../scripts/site-dir.ts";

// 출력 디렉터리 (#508, 구조 B-2). 렌더 여섯 스크립트가 docs/ 대신 다른 디렉터리의 복사본을 읽고 쓰게 하는 길이다.
// 합격선은 "사이트 바이트 diff 0" - 기본(docs/)은 전과 같고, 다른 디렉터리에 낸 산출도 같은 바이트다.
// 아래는 날짜·데이터에 따라 갈리지 않는 것만 본다: docs/ 의 현재 내용이 오늘 날짜의 렌더와 같은지는 시험이 아니라 전후 `git status`로 본다.
const run = promisify(execFile);
const made = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "site-dir-"));
  made.push(d);
  return d;
};
test.after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const BUILD_NOW = "2026-10-23T01:39:58Z"; // 예산 장의 "최근 6개월" 창이 시계에 안 흔들리게 못박는다

/** 디렉터리 아래 모든 파일의 상대 경로 -> sha256. */
function tree(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(dir, p).split(path.sep).join("/"), createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))); // readdir 순서는 파일시스템마다 다르다
}

const pipelineEnv = () => {
  const env = { ...process.env, BUILD_NOW };
  delete env.JIPGYE_RENDERER;
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_STEP_SUMMARY;
  delete env[SITE_DIR_ENV];
  return env;
};

// 렌더가 만드는 생성 페이지 53장(rate 4 + news 3 + budget 18 + realestate 3 + district 25). 나머지 14장은 손으로 고치는 소스다.
const GENERATED = /^(deposit-rates|saving-rates|mortgage-rates|rent-loan-rates|rate-news|realestate-news|stock-news|apartment-(sale|jeonse|rent)|budget-\d+eok|district-[a-z]+)\.html$/;

test("출력 디렉터리 환경변수가 없거나 비어 있으면 docs/ 다 (기본 경로 불변)", () => {
  assert.equal(siteDir({}), DOCS_DIR);
  assert.equal(siteDir({ [SITE_DIR_ENV]: "" }), DOCS_DIR);
  assert.equal(sitePath("news.html", {}), path.join(DOCS_DIR, "news.html"));
  assert.equal(siteLabel("news.html", {}), "docs/news.html"); // 로그 글자도 전과 같다
});

test("상대 경로는 저장소 루트 기준, 절대 경로는 그대로 읽는다", () => {
  assert.equal(siteDir({ [SITE_DIR_ENV]: "build/site" }), path.join(REPO_ROOT, "build/site"));
  assert.equal(siteLabel("news.html", { [SITE_DIR_ENV]: "build/site" }), "build/site/news.html");
  const abs = path.join(tmpdir(), "somewhere");
  assert.equal(siteDir({ [SITE_DIR_ENV]: abs }), abs);
});

test("docs/ 복사본이 없는 출력 디렉터리에서 렌더 스크립트를 단독으로 돌리면 무엇을 먼저 할지 말하고 멈춘다", async () => {
  assert.doesNotThrow(() => requireSite({}));
  const missing = path.join(tmp(), "nope");
  assert.throws(() => requireSite({ [SITE_DIR_ENV]: missing }), /stage-site|render-pipeline/);
  const r = await run(process.execPath, [path.join(REPO_ROOT, "scripts/build-rate-pages.ts")], { env: { ...pipelineEnv(), [SITE_DIR_ENV]: missing } }).catch((e) => e);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /docs\/ 복사본이 없다/);
  assert.equal(existsSync(missing), false, "멈추면서 디렉터리를 만들지 않는다");
});

test("stageSite: 파일 집합과 바이트를 그대로 복사하고, 지난 실행의 낡은 파일은 지운다", () => {
  const root = tmp();
  const docs = path.join(root, "docs");
  mkdirSync(path.join(docs, "data"), { recursive: true });
  writeFileSync(path.join(docs, "index.html"), "<html>새 틀</html>");
  writeFileSync(path.join(docs, "data/a.json"), '{"a":1}\n');
  writeFileSync(path.join(docs, "icon.bin"), Buffer.from([0, 255, 1, 254]));
  const out = path.join(root, "build/site");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "index.html"), "낡은 것");
  writeFileSync(path.join(out, "stale.html"), "지난 실행에만 있던 장");

  const r = stageSite({ out: "build/site", docs, root });
  assert.deepEqual(r, { copied: 3, skipped: false });
  assert.deepEqual([...tree(out)], [...tree(docs)]);
  assert.equal(existsSync(path.join(out, "stale.html")), false);
});

test("stageSite: 출력 디렉터리가 docs/ 면 아무것도 안 한다", () => {
  const root = tmp();
  const docs = path.join(root, "docs");
  mkdirSync(docs);
  writeFileSync(path.join(docs, "index.html"), "x");
  assert.deepEqual(stageSite({ out: "docs", docs, root }), { copied: 0, skipped: true });
  assert.equal(readFileSync(path.join(docs, "index.html"), "utf8"), "x");
});

test("stageSite: docs/ 안, docs/·저장소 루트를 품은 곳, 사이트가 아닌 비어 있지 않은 디렉터리는 지우기 전에 거절한다", () => {
  const root = tmp();
  const docs = path.join(root, "docs");
  mkdirSync(docs);
  writeFileSync(path.join(docs, "index.html"), "x");
  mkdirSync(path.join(root, "notes"));
  writeFileSync(path.join(root, "notes/keep.txt"), "지우면 안 되는 것");

  assert.throws(() => stageSite({ out: "docs/sub", docs, root }), /docs\/ 안/);
  assert.throws(() => stageSite({ out: ".", docs, root }), /품고 있다/);
  assert.throws(() => stageSite({ out: "..", docs, root }), /품고 있다/);
  assert.throws(() => stageSite({ out: "notes", docs, root }), /지우지 않는다/);
  assert.equal(readFileSync(path.join(root, "notes/keep.txt"), "utf8"), "지우면 안 되는 것");
  assert.equal(readFileSync(path.join(docs, "index.html"), "utf8"), "x");
});

test("stage-site: 실제 docs/ 를 복사한 디렉터리는 파일 집합·바이트가 docs/ 와 같다", async () => {
  const out = path.join(tmp(), "site");
  await run(process.execPath, [path.join(REPO_ROOT, "scripts/stage-site.ts"), `--out=${out}`], { env: pipelineEnv() });
  assert.deepEqual([...tree(out)], [...tree(DOCS_DIR)]);
});

test("render-pipeline --out: docs/ 는 한 바이트도 안 바뀌고 출력 디렉터리에 같은 파일 집합이 나온다", async () => {
  const before = tree(DOCS_DIR);
  const out = path.join(tmp(), "site");
  await run(process.execPath, [path.join(REPO_ROOT, "scripts/render-pipeline.ts"), `--out=${out}`], { env: pipelineEnv() });
  const after = tree(DOCS_DIR);
  assert.deepEqual([...after], [...before], "docs/ 는 그대로");

  const rendered = tree(out);
  assert.deepEqual([...rendered.keys()], [...before.keys()], "파일 집합 동일 - 더하지도 빼지도 않는다");
  const htmls = [...rendered.keys()].filter((f) => f.endsWith(".html"));
  assert.equal(htmls.length, 67);
  // 렌더가 만지지 않는 것(스타일시트·스크립트·SW·매니페스트·아이콘·데이터)은 복사 그대로 - 배포 산출물에 정적 자산이 들어 있다는 뜻이다.
  for (const f of rendered.keys()) {
    if (f.endsWith(".html")) continue;
    assert.equal(rendered.get(f), before.get(f), `${f} 바이트`);
  }
  for (const f of ["style.css", "nav.js", "sw.js", "manifest.webmanifest"]) assert.ok(rendered.has(f), `${f} 가 출력 디렉터리에 있다`);
});

// (#520) 이 시험은 처음에 실제 docs/data 로 돌았다(생성 53장 전부). 그 판은 tools/health/test/site-dir.test.mjs 로 옮겼다(비차단) - 실제 데이터의 모양이 바뀌면
// (예산 밴드의 min10k 가 어긋나 build-budget-pages 가 '3억대' 장을 건너뛰면 build-updated-stamp 가 budget-3eok.html 이 없다고 던진다) 기능 PR 시험이 막혔다.
// 여기는 같은 약속("생성 페이지는 입력이 아니다")을 고정 데이터로 지킨다: 저장소 복사본(test/helpers/fixture-site.mjs)에서 `--out` 판과 생성 페이지를 걷어낸 판을 같은 데이터로 렌더해 맞댄다.
// 고정 데이터에는 예산 밴드가 없어 build-budget-pages 가 장을 만들지 않으므로(그 단계는 '예산 데이터가 없습니다'로 끝난다) 예산 18장은 걷어내지 않는다 - 그 18장은 health 판이 본다.
test("생성 35장이 없는 복사본에서 고정 데이터로 그려도 전체를 그린 것과 같다 - 생성 페이지는 입력이 아니다 (B4에서 docs/ 의 생성물을 걷어내도 안전)", async () => {
  const site = buildFixtureSite({ steps: [] });
  try {
    const env = { ...pipelineEnv() };
    const full = path.join(tmp(), "full");
    await run(process.execPath, [path.join(site.root, "scripts/render-pipeline.ts"), `--out=${full}`], { env });

    const bare = path.join(tmp(), "bare");
    await run(process.execPath, [path.join(site.root, "scripts/stage-site.ts"), `--out=${bare}`], { env });
    let removed = 0;
    for (const f of readdirSync(bare)) {
      if (!GENERATED.test(f) || /^budget-/.test(f)) continue;
      rmSync(path.join(bare, f));
      removed += 1;
    }
    assert.equal(removed, 35);
    for (const step of RENDER_STEPS) {
      await run(process.execPath, [path.join(site.root, step)], { env: { ...env, [SITE_DIR_ENV]: bare } });
    }
    assert.deepEqual([...tree(bare)], [...tree(full)]);
  } finally {
    site.cleanup();
  }
});

test("render-pipeline: 출력 디렉터리를 준비할 수 없으면(docs/ 안) 렌더를 시작하지 않고 종료 1이다 - docs/ 는 그대로", async () => {
  const before = tree(DOCS_DIR);
  const r = await run(process.execPath, [path.join(REPO_ROOT, "scripts/render-pipeline.ts"), `--out=${path.join(DOCS_DIR, "build")}`], { env: pipelineEnv() }).catch((e) => e);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /출력 디렉터리 준비 실패.*docs\/ 안/);
  assert.doesNotMatch(r.stdout, /\[render-pipeline\] scripts\//, "단계가 하나도 안 돌았다");
  assert.deepEqual([...tree(DOCS_DIR)], [...before]);
});
