import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RENDER_STEPS } from "../scripts/render-pipeline.ts";

// 렌더 파이프라인 (#238 F1 에서 시작, #248 P1 에서 legacy 폴백을 걷었다 - 첫 실패에서 멈추고 종료 1). 단계는 임시 폴더의 가짜 노드 스크립트로
// 주입하고(고정 fixture, 외부 의존 없음), 호출 기록(어느 단계가 몇 번, 어떤 환경으로 돌았는지)으로 멈춤의 범위를 본다.
const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const PIPELINE = path.join(root, "scripts/render-pipeline.ts");
const read = (rel) => readFile(path.join(root, rel), "utf8");

// 가짜 단계의 행동. 호출마다 `<이름> <JIPGYE_RENDERER> <CARRY>` 한 줄을 기록 파일에 남기고 아래 규칙대로 끝난다.
//   ok: 항상 성공 / fail: 항상 실패
const BEHAVIORS = {
  ok: "",
  fail: 'console.error("boom: 렌더 예외"); process.exit(1);',
};

async function fixture(kinds) {
  const dir = await mkdtemp(path.join(tmpdir(), "render-pipeline-"));
  const log = path.join(dir, "calls.log");
  const steps = [];
  for (const [i, kind] of kinds.entries()) {
    const file = path.join(dir, `step${i + 1}.mjs`);
    await writeFile(
      file,
      `import { appendFileSync } from "node:fs";
const mode = process.env.JIPGYE_RENDERER;
appendFileSync(${JSON.stringify(log)}, "step${i + 1} " + (mode ?? "unset") + " " + (process.env.CARRY ?? "-") + "\\n");
${BEHAVIORS[kind]}
`
    );
    steps.push(file);
  }
  return {
    dir,
    steps,
    out: path.join(dir, "output"),
    summary: path.join(dir, "summary"),
    calls: async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean),
    file: async (name) => readFile(path.join(dir, name), "utf8").catch(() => null),
  };
}

// 환경은 통째로 새로 만든다 - 이 시험이 Actions 안에서 돌 때 진짜 $GITHUB_OUTPUT·$GITHUB_STEP_SUMMARY 가 새어 들어오면 안 된다.
async function pipeline(fx, { renderer, github = true, args = fx.steps } = {}) {
  const env = { PATH: process.env.PATH, CARRY: "keep" };
  if (renderer !== undefined) env.JIPGYE_RENDERER = renderer;
  if (github) Object.assign(env, { GITHUB_OUTPUT: fx.out, GITHUB_STEP_SUMMARY: fx.summary });
  try {
    const r = await run(process.execPath, [PIPELINE, ...args], { cwd: root, env });
    return { code: 0, ...r };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

const withFixture = (kinds, body) => async () => {
  const fx = await fixture(kinds);
  try {
    await body(fx);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
};

const SIX = (kind) => Array(6).fill(kind);

test("정상: 여섯 단계가 한 번씩 돌고 종료 0, $GITHUB_OUTPUT·요약에 아무것도 쓰지 않는다", withFixture(SIX("ok"), async (fx) => {
  const r = await pipeline(fx);
  assert.equal(r.code, 0);
  assert.deepEqual(await fx.calls(), Array.from({ length: 6 }, (_, i) => `step${i + 1} unset keep`));
  assert.equal(await fx.file("output"), null, "출력 키(옛 fallback)를 쓰지 않는다 - 워크플로가 읽을 출력이 없다");
  assert.ok(!r.stdout.includes("::warning::"), r.stdout);
  assert.equal(await fx.file("summary"), null, "정상인 날에는 요약에 아무것도 쓰지 않는다");
}));

test("첫 단계가 실패하면 거기서 멈추고 종료 1 - 재시도하지 않는다(폴백 없음, #248)", withFixture(SIX("fail"), async (fx) => {
  const r = await pipeline(fx);
  assert.equal(r.code, 1);
  assert.deepEqual(await fx.calls(), ["step1 unset keep"], "실패한 단계를 다시 돌리거나 뒤 단계로 넘어갔다");
  assert.equal(await fx.file("output"), null);
}));

test("중간(3번째) 단계가 실패하면 앞 두 단계까지만 돌고 거기서 멈춘다 - 뒤 단계는 돌지 않는다", withFixture(["ok", "ok", "fail", "ok", "ok", "ok"], async (fx) => {
  const r = await pipeline(fx);
  assert.equal(r.code, 1);
  assert.deepEqual(await fx.calls(), ["step1 unset keep", "step2 unset keep", "step3 unset keep"]);
}));

test("실패하면 stderr 와 $GITHUB_STEP_SUMMARY 에 실패한 단계와 이유가 남고, 단계의 오류 출력도 그대로 흐른다", withFixture(["ok", "ok", "fail", "ok", "ok", "ok"], async (fx) => {
  const r = await pipeline(fx);
  const thirdStep = fx.steps[2];
  assert.ok(r.stderr.includes(thirdStep) && /렌더 실패/.test(r.stderr) && /종료 코드 1/.test(r.stderr), r.stderr);
  assert.match(r.stderr, /boom: 렌더 예외/, "단계의 오류 출력은 그대로 남아야 원인을 본다");
  assert.ok(!/legacy|폴백/.test(r.stdout + r.stderr), "폴백을 말한다 - 폴백은 지웠다");
  const summary = await fx.file("summary");
  assert.match(summary, /### 렌더 실패/);
  assert.ok(summary.includes(thirdStep) && summary.includes("종료 코드 1"), summary);
}));

test("JIPGYE_RENDERER 를 읽지도 덮지도 않는다 - 어떤 값이든 단계에 그대로 넘기고, 실패해도 다른 값으로 다시 돌리지 않는다", withFixture(SIX("fail"), async (fx) => {
  const r = await pipeline(fx, { renderer: "react" });
  assert.equal(r.code, 1);
  assert.deepEqual(await fx.calls(), ["step1 react keep"]);
  assert.ok(!r.stdout.includes("::warning::"));
}));

test("$GITHUB_OUTPUT·$GITHUB_STEP_SUMMARY가 없으면(로컬) 실패해도 기록 파일을 만들지 않고 종료 1 이다", withFixture(SIX("fail"), async (fx) => {
  const r = await pipeline(fx, { github: false });
  assert.equal(r.code, 1);
  assert.deepEqual(await fx.calls(), ["step1 unset keep"]);
  assert.deepEqual((await readdir(fx.dir)).filter((n) => !n.startsWith("step") && n !== "calls.log"), [], "기록 파일을 새로 만들었다");
}));

test("$GITHUB_OUTPUT 에는 손대지 않는다(앞 단계가 쓴 출력을 지우지도, 키를 덧붙이지도 않는다)", withFixture(SIX("ok"), async (fx) => {
  await writeFile(fx.out, "earlier=1\n");
  await pipeline(fx);
  assert.equal(await fx.file("output"), "earlier=1\n");
}));

test("존재하지 않는 단계는 실패다(조용히 건너뛰지 않는다)", withFixture(["ok"], async (fx) => {
  const r = await pipeline(fx, { args: [fx.steps[0], path.join(fx.dir, "없는-단계.mjs")] });
  assert.equal(r.code, 1);
  assert.match(await fx.file("summary"), /없는-단계\.mjs/);
}));

// (#510, 구조 B-4) 뒤집었다: 이전에는 update-all 의 렌더 꼬리가 기본 단계와 같다고 맞댔다. 이제 update-all(수집 + 데이터 커밋)은 렌더를 안 부른다 - 렌더는 deploy.yml 의 일이다.
test("기본 단계는 지금까지 워크플로가 부르던 다섯 스크립트의 순서 그대로이고 update-all 은 이 다섯을 부르지 않는다 (렌더는 deploy.yml 의 일)", async () => {
  // 금리 4장 단계(build-rate-pages)는 #577 B2 로 지웠다(여섯 -> 다섯).
  assert.deepEqual(RENDER_STEPS, [
    "scripts/prerender.ts",
    "scripts/build-news-pages.ts",
    "scripts/build-budget-pages.ts",
    "scripts/build-realestate-pages.ts",
    "scripts/build-updated-stamp.ts",
  ]);
  const all = [...(await read("scripts/update-all.mjs")).matchAll(/run\("node (scripts\/[a-z-]+\.(?:mjs|ts))"\)/g)].map((m) => m[1]);
  assert.ok(all.length >= 20, `update-all 이 부르는 스크립트를 ${all.length}개밖에 못 읽었다`);
  assert.deepEqual(all.filter((s) => RENDER_STEPS.includes(s)), [], "update-all 이 렌더 스크립트를 부른다 - 수집·커밋이 렌더에 묶이고 docs/ 에 생성 HTML 이 생긴다(#510)");
  assert.ok(!all.includes("scripts/render-pipeline.ts"));
});

// #427: 위 시험은 소스의 목록과 시험 안의 목록을 맞댈 뿐이라 둘이 같이 옛 이름으로 남으면 초록이다(개명이 두 곳을 같이 놓치면 무인 렌더만 죽는다).
// 목록이 가리키는 파일이 저장소에 실제로 있는지를 따로 본다 - 확장자를 박지 않고 목록에 적힌 이름 그대로 연다.
test("RENDER_STEPS와 update-all이 부르는 스크립트가 가리키는 파일이 모두 저장소에 있다 - 개명이 목록을 놓치면 무인 렌더·수집만 죽는다", async () => {
  // (#510) update-all 의 렌더 꼬리가 없어졌으므로 update-all 쪽은 부르는 스크립트 전부가 대상이다.
  const called = [...(await read("scripts/update-all.mjs")).matchAll(/run\("node (scripts\/[a-z-]+\.(?:mjs|ts))"\)/g)].map((m) => m[1]);
  assert.ok(RENDER_STEPS.length >= 5 && called.length >= 20, `목록이 비었다: RENDER_STEPS ${RENDER_STEPS.length}, update-all 호출 ${called.length}`);
  const missing = [...new Set([...RENDER_STEPS, ...called])].filter((rel) => !existsSync(path.join(root, rel)));
  assert.deepEqual(missing, [], `단계가 가리키는 파일이 없다(개명 때 목록을 같이 고쳤는지 본다): ${missing.join(", ")}`);
});

// --- 워크플로 문자열 ---------------------------------------------------------------------------------------------------------

// (#510, 구조 B-4) 렌더는 deploy.yml 한 곳이다. 수집 두 워크플로(daily-update·summarize)는 렌더를 안 부른다 - 아래 시험이 그 경계를 지킨다.
const DEPLOY = ".github/workflows/deploy.yml";
const COLLECTORS = [".github/workflows/daily-update.yml", ".github/workflows/summarize.yml"];

const stepOf = (yml, name) => {
  const at = yml.indexOf(`- name: ${name}\n`);
  assert.ok(at >= 0, `단계 "${name}"이 없다`);
  return yml.slice(at).split("\n      - ")[0].split(/\n      #/)[0];
};

test("렌더 단계는 deploy.yml 에 id: render 로 하나이고 render-pipeline --out=build/site 를 부른다 - 인라인 렌더 스크립트가 어느 워크플로에도 없다", async () => {
  const yml = await read(DEPLOY);
  const step = stepOf(yml, "사이트 생성 (build/site)");
  assert.match(step, /^ {8}id: render$/m, `${DEPLOY}: 렌더 단계에 id: render가 없다`);
  assert.match(step, /run: node scripts\/render-pipeline\.ts --out=build\/site$/m, `${DEPLOY}: 렌더 단계가 render-pipeline --out=build/site 가 아니다`);
  assert.ok(!/node scripts\/(prerender|build-[a-z]+-pages|build-updated-stamp)\.(?:mjs|ts)/.test(step), `${DEPLOY}: 렌더 스크립트를 인라인으로 다시 부른다(폴백을 우회한다)`);
  // 어느 워크플로 파일에도 인라인 렌더 호출이 남으면 안 된다(렌더 단계가 하나 더 생겨 폴백을 우회하는 것을 막는다).
  const dir = path.join(root, ".github/workflows");
  for (const name of await readdir(dir)) {
    const text = await readFile(path.join(dir, name), "utf8");
    assert.ok(!/node scripts\/prerender\.(?:mjs|ts)/.test(text), `${name}: prerender.ts를 워크플로에서 직접 부른다`);
  }
  // 수집 두 워크플로에는 render-pipeline 도 없다(렌더가 수집에 묶이면 9월 모양이다).
  // 주석은 걷고 본다(주석은 일부러 이 이름을 적는다).
  for (const file of COLLECTORS) assert.ok(!/render-pipeline/.test((await read(file)).replace(/^\s*#.*$/gm, "")), `${file}: 수집 워크플로가 렌더를 부른다 - deploy.yml 의 일이다`);
});

test("deploy.yml 은 기본 다섯 단계(인자 없음)로 그린다 - summarize 의 「일부러 다섯」(rate 4장 제외)은 없어졌고 금리 4장 단계는 #577 B2 로 지웠다", async () => {
  const step = stepOf(await read(DEPLOY), "사이트 생성 (build/site)");
  assert.ok(!/^ {12}scripts\//m.test(step), "deploy.yml 이 단계 목록을 인자로 넘긴다 - 기본 다섯(RENDER_STEPS)이어야 생성 장이 빠지지 않는다");
  assert.equal(RENDER_STEPS.length, 5);
  // summarize 에는 단계 인자도 render-pipeline 도 없다(위 시험). news-context 는 렌더 밖 데이터 가공이라 수집 워크플로에 남는다.
  const summarize = await read(COLLECTORS[1]);
  assert.match(summarize, /^ {8}run: node scripts\/news-context\.ts$/m, "summarize 의 news-context 단계가 사라졌다");
});

// (#248 P1) 폴백 게이트 단계(「렌더 폴백이면 배포하지 않는다」·「렌더 폴백이면 실패」)를 지웠다. 렌더 실패는 렌더 단계의 종료 1 이 곧 job 의 실패다 -
// 그래서 렌더 단계에 실패를 삼키는 continue-on-error 나 if 가 붙으면 안 되고, 어느 워크플로도 렌더 단계의 출력(옛 fallback 키)을 읽지 않는다.
test("렌더 단계에는 continue-on-error·if 가 없다(실패가 곧 job 실패) - 어느 워크플로도 steps.render.outputs 를 읽지 않는다", async () => {
  for (const file of [DEPLOY, ".github/workflows/test.yml"]) {
    const step = stepOf(await read(file), "사이트 생성 (build/site)");
    assert.match(step, /^ {8}id: render$/m, `${file}: 렌더 단계에 id: render가 없다`);
    assert.ok(!/continue-on-error|^ {8}if:/m.test(step), `${file}: 렌더 단계에 조건이 붙었다 - 렌더 실패가 job 을 멈추지 않는다`);
  }
  const dir = path.join(root, ".github/workflows");
  for (const name of await readdir(dir)) {
    const text = await readFile(path.join(dir, name), "utf8");
    assert.ok(!/steps\.render\.outputs/.test(text), `${name}: 렌더 단계의 출력을 읽는다 - render-pipeline 은 출력을 쓰지 않는다(폴백 없음, #248)`);
  }
});
