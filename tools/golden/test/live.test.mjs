import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonLines } from "../lib/canon.mjs";
import { compareBytes, compareDirs, formatReport, listFiles, treeHash } from "../lib/compare.mjs";
import { RENDER_STAGES, preparePristine, readWorkflowStages, renderIsolated } from "../lib/render.mjs";

// 실제 저장소로 돌리는 측정(#236 완료 조건 1·2와 변이 시험의 시각 의존 확인). `npm run test:live`(GOLDEN_LIVE=1)에서만 돈다.
// 읽는 것: 저장소의 실제 docs/·raw/ — 그래서 `npm test`(고정 fixture만)와 갈랐고 CI에도 넣지 않는다(#8 재발 방지, R3).
//
// 환경변수
//   GOLDEN_REPO       저장소 경로(기본: 이 폴더의 두 단계 위)
//   GOLDEN_SHA        렌더할 커밋(기본 HEAD). 렌더는 `git archive`한 깨끗한 사본에서 돈다.
//   GOLDEN_BUILD_NOW  자기 비교에 고정해 줄 시각(기본 2026-10-11T00:00:00Z)
//   GOLDEN_BASE_SHA   (선택) BUILD_NOW 이전 코드의 커밋. 있으면 "미설정이면 바이트 동일"을 변경 전·후 코드로 시험한다.
const LIVE = process.env.GOLDEN_LIVE === "1";
const REPO = path.resolve(process.env.GOLDEN_REPO ?? path.join(import.meta.dirname, "../../.."));
const SHA = process.env.GOLDEN_SHA ?? "HEAD";
const NOW = process.env.GOLDEN_BUILD_NOW ?? "2026-10-11T00:00:00Z";
const BASE_SHA = process.env.GOLDEN_BASE_SHA ?? null;
const opts = { skip: LIVE ? false : "GOLDEN_LIVE=1(npm run test:live)에서만 돈다" };
const say = (...a) => console.log("GOLDEN-LIVE", ...a);

const git = (...a) => spawnSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).stdout.trim();

let pristine;
async function getPristine() {
  pristine ??= await preparePristine({ repo: REPO, sha: SHA });
  return pristine;
}
const dayAfter = (iso, n = 1) => new Date(Date.parse(iso) + n * 86400000).toISOString();

async function pair(env, { a = {}, b = {} } = {}) {
  const p = await getPristine();
  const [one, two] = [await renderIsolated(p, { env: { ...env, ...a } }), await renderIsolated(p, { env: { ...env, ...b } })];
  try {
    return { cmp: await compareDirs(one.docsDir, two.docsDir), bytes: await compareBytes(one.docsDir, two.docsDir), one, two, touched: [...one.touched, ...two.touched] };
  } finally {
    await Promise.all([one.dispose(), two.dispose()]);
  }
}

test("입력 기록: SHA와 raw/ 지문", opts, async () => {
  const full = git("rev-parse", SHA);
  say("HEAD", full, `(${git("log", "-1", "--format=%s", full)})`);
  say("raw tree", git("rev-parse", `${full}:raw`));
  say("raw/indicators/series.json blob", git("rev-parse", `${full}:raw/indicators/series.json`));
  say("docs/data tree", git("rev-parse", `${full}:docs/data`));
  say("node", process.version, "TZ(호출자)", process.env.TZ ?? "(미설정)");
  const htmlCount = (await listFiles(path.join(REPO, "docs"), (f) => f.endsWith(".html"))).length;
  say("find docs -name '*.html' | wc -l =", htmlCount);
  assert.equal(htmlCount, 67, "착수 때 센 장 수(이슈 본문 67)가 바뀌었다 — 이슈의 숫자를 다시 확인한다");
});

test("렌더 단계 목록이 daily-update.yml과 같다", opts, async () => {
  const fromWorkflow = await readWorkflowStages(path.join(REPO, ".github/workflows/daily-update.yml"));
  assert.deepEqual(RENDER_STAGES, fromWorkflow);
});

for (const tz of ["UTC", "Asia/Seoul"]) {
  test(`같은 SHA legacy 2회 자기 비교 diff 0 (TZ=${tz}, BUILD_NOW 고정)`, opts, async () => {
    const docsBefore = await treeHash(path.join(REPO, "docs"));
    const r = await pair({ TZ: tz, BUILD_NOW: NOW });
    say(`TZ=${tz} BUILD_NOW=${NOW}`, `정준 ${r.cmp.equal}/${r.cmp.total}장 일치`, `바이트 ${r.bytes.same}/${r.bytes.total}개 일치`, `렌더 ${Math.round(r.one.totalMs)}ms·${Math.round(r.two.totalMs)}ms`);
    assert.equal(r.cmp.failing.length, 0, formatReport(r.cmp));
    assert.equal(r.cmp.total, 67);
    assert.deepEqual(r.bytes.diffs, [], "정준뿐 아니라 바이트로도 같다");
    assert.deepEqual(r.touched.filter((f) => !f.startsWith("docs/")), [], "렌더가 docs/ 밖을 쓰지 않았다");
    assert.equal(await treeHash(path.join(REPO, "docs")), docsBefore, "저장소 작업 트리의 docs/는 렌더 전후로 같다");
  });
}

test("TZ가 달라도(UTC vs Asia/Seoul) 출력이 같다 — 시각 의존 지점 탐색", opts, async () => {
  const r = await pair({ BUILD_NOW: NOW }, { a: { TZ: "UTC" }, b: { TZ: "Asia/Seoul" } });
  say(`UTC vs Asia/Seoul: 정준 ${r.cmp.equal}/${r.cmp.total}장 일치, 바이트 ${r.bytes.same}/${r.bytes.total}`);
  assert.equal(r.cmp.failing.length, 0, formatReport(r.cmp));
  assert.deepEqual(r.bytes.diffs, []);
});

test("시각 의존 확인: BUILD_NOW를 하루 다르게 준 두 렌더는 정책대출 문장을 가진 장에서 1장 이상 낙제, 같은 값이면 0장", opts, async () => {
  const policyPages = async (dir) => {
    const out = [];
    for (const f of await listFiles(dir, (n) => n.endsWith(".html"))) {
      if (canonLines(await readFile(path.join(dir, f), "utf8")).some((l) => l.includes('class="budget-loan budget-policy"'))) out.push(f);
    }
    return out;
  };
  // 같은 값(대조군)
  const control = await pair({ TZ: "UTC", BUILD_NOW: NOW });
  say(`같은 값 ${NOW} 두 렌더: 낙제 ${control.cmp.failing.length}장`);
  assert.equal(control.cmp.failing.length, 0);

  // 하루 다른 쌍: 경계 거래가 없는 날은 0장일 수 있으므로 날짜 쌍을 하루씩 밀어 가며 1장 이상 나오는 쌍을 찾는다.
  const p = await getPristine();
  let found = null;
  const tried = [];
  for (let k = 0; k < 14 && !found; k++) {
    const d1 = dayAfter(NOW, k);
    const d2 = dayAfter(NOW, k + 1);
    const one = await renderIsolated(p, { env: { TZ: "UTC", BUILD_NOW: d1 } });
    const two = await renderIsolated(p, { env: { TZ: "UTC", BUILD_NOW: d2 } });
    try {
      const cmp = await compareDirs(one.docsDir, two.docsDir);
      const policy = await policyPages(one.docsDir);
      tried.push({ d1, d2, failing: cmp.failing.length });
      say(`쌍 ${d1} vs ${d2}: 낙제 ${cmp.failing.length}장 (정책대출 문장을 가진 장 ${policy.length}장)`);
      if (cmp.failing.length) found = { d1, d2, cmp, policy };
    } finally {
      await Promise.all([one.dispose(), two.dispose()]);
    }
  }
  assert.ok(found, `14쌍을 밀어 봤지만 낙제가 없다: ${JSON.stringify(tried)}`);
  const failNames = found.cmp.failing.map((f) => f.file);
  say(`낙제 ${failNames.length}장: ${failNames.join(", ")}`);
  say(formatReport(found.cmp, { maxHunks: 1, maxLines: 2 }).split("\n").slice(0, 8).join("\n"));
  assert.ok(failNames.every((f) => found.policy.includes(f)), "낙제한 장은 모두 정책대출 문장을 가진 장이다");
});

test("BUILD_NOW 미설정이면 현행 코드와 바이트 동일 (Date.now를 같은 값으로 모킹한 변경 전·후 비교)", { ...opts, skip: LIVE && BASE_SHA ? false : opts.skip || "GOLDEN_BASE_SHA가 없다" }, async () => {
  const mock = NOW;
  const base = await preparePristine({ repo: REPO, sha: BASE_SHA });
  const head = await getPristine();
  say("변경 전", base.label, "변경 후", head.label, "Date.now 모킹", mock);
  const a = await renderIsolated(base, { mockNow: mock });
  const b = await renderIsolated(head, { mockNow: mock });
  const c = await renderIsolated(head, { env: { BUILD_NOW: mock } });
  try {
    const ab = await compareBytes(a.docsDir, b.docsDir);
    const ac = await compareBytes(a.docsDir, c.docsDir);
    say(`변경 전(모킹) vs 변경 후(BUILD_NOW 미설정, 모킹): 바이트 ${ab.same}/${ab.total}개 일치`);
    say(`변경 전(모킹) vs 변경 후(BUILD_NOW=모킹값): 바이트 ${ac.same}/${ac.total}개 일치`);
    assert.deepEqual(ab.diffs, []);
    assert.deepEqual(ac.diffs, []);
    assert.ok(ab.total >= 180);
  } finally {
    await Promise.all([a.dispose(), b.dispose(), c.dispose()]);
  }
});
