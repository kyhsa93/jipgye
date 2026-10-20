import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { FALLBACK_OUTPUT, RENDER_STEPS } from "../scripts/render-pipeline.mjs";

// 렌더 파이프라인의 legacy 폴백 (#238 F1 최소판). 단계는 임시 폴더의 가짜 노드 스크립트로 주입하고(고정 fixture, 외부 의존 없음),
// 호출 기록(어느 단계가 어느 JIPGYE_RENDERER로 몇 번 돌았는지)으로 재시도의 범위를 본다.
const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const PIPELINE = path.join(root, "scripts/render-pipeline.mjs");
const read = (rel) => readFile(path.join(root, rel), "utf8");

// 가짜 단계의 행동. 호출마다 `<이름> <JIPGYE_RENDERER>` 한 줄을 기록 파일에 남기고 아래 규칙대로 끝난다.
//   ok: 항상 성공 / reactFails: JIPGYE_RENDERER=react일 때만 실패 / needsLegacy: legacy가 아니면(미설정 포함 = 컷오버 뒤의 react 기본) 실패 / fail: 항상 실패
const BEHAVIORS = {
  ok: "",
  reactFails: 'if (mode === "react") { console.error("boom: react 렌더 예외"); process.exit(1); }',
  needsLegacy: 'if (mode !== "legacy") { console.error("boom: legacy가 아니면 실패"); process.exit(1); }',
  fail: 'console.error("boom: 항상 실패"); process.exit(1);',
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

// 환경은 통째로 새로 만든다 - 이 시험이 Actions 안에서 돌 때 진짜 $GITHUB_OUTPUT·JIPGYE_RENDERER가 새어 들어오면 안 된다.
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
const legacyAll = Array.from({ length: 6 }, (_, i) => `step${i + 1} legacy keep`);

test("정상: 여섯 단계가 한 번씩 돌고 재시도도 폴백도 없다", withFixture(SIX("ok"), async (fx) => {
  const r = await pipeline(fx, { renderer: "react" });
  assert.equal(r.code, 0);
  assert.deepEqual(await fx.calls(), Array.from({ length: 6 }, (_, i) => `step${i + 1} react keep`));
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=false\n`);
  assert.ok(!r.stdout.includes("::warning::"), r.stdout);
  assert.equal(await fx.file("summary"), null, "정상인 날에는 요약에 아무것도 쓰지 않는다");
}));

test("react 실패 → legacy 성공: 여섯 단계 전부 legacy로 처음부터 다시 돌고 fallback=true, 종료 0", withFixture(SIX("reactFails"), async (fx) => {
  const r = await pipeline(fx, { renderer: "react" });
  assert.equal(r.code, 0, "폴백이 성공하면 이 단계는 성공이다 - 커밋·배포가 이어져야 한다");
  // 1차: 첫 단계에서 멈춘다. 2차: 여섯 전부 legacy(다른 환경변수는 그대로).
  assert.deepEqual(await fx.calls(), ["step1 react keep", ...legacyAll]);
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=true\n`);
}));

test("중간(3번째) 단계만 react에서 실패해도 앞 두 단계까지 포함해 처음부터 legacy로 다시 돈다", withFixture(["ok", "ok", "reactFails", "ok", "ok", "ok"], async (fx) => {
  const r = await pipeline(fx, { renderer: "react" });
  assert.equal(r.code, 0);
  assert.deepEqual(await fx.calls(), ["step1 react keep", "step2 react keep", "step3 react keep", ...legacyAll]);
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=true\n`);
}));

test("폴백이 발동하면 ::warning::(stdout)과 stderr·$GITHUB_STEP_SUMMARY에 원인 단계와 함께 남는다", withFixture(["ok", "ok", "reactFails", "ok", "ok", "ok"], async (fx) => {
  const r = await pipeline(fx, { renderer: "react" });
  const thirdStep = fx.steps[2];
  assert.match(r.stdout, /::warning::.*legacy/, r.stdout);
  assert.ok(r.stdout.includes(thirdStep), "::warning::에 실패한 단계가 없다");
  assert.ok(r.stdout.split("\n").filter((l) => l.startsWith("::warning::")).every((l) => !l.includes("\r")), "경고는 한 줄이어야 한다");
  assert.match(r.stderr, /legacy로 폴백/, r.stderr);
  assert.match(r.stderr, /boom: react 렌더 예외/, "1차 시도의 오류 출력은 그대로 남아야 원인을 본다");
  const summary = await fx.file("summary");
  assert.match(summary, /렌더 폴백 발동/);
  assert.ok(summary.includes(thirdStep) && summary.includes("JIPGYE_RENDERER=react"), summary);
}));

test("legacy 재시도도 실패하면 종료 1, fallback=false, 요약에 둘 다 남는다", withFixture(SIX("fail"), async (fx) => {
  const r = await pipeline(fx, { renderer: "react" });
  assert.equal(r.code, 1);
  assert.deepEqual(await fx.calls(), ["step1 react keep", "step1 legacy keep"]);
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=false\n`, "폴백이 성공하지 못했으니 '폴백했음'이 아니다");
  assert.match(await fx.file("summary"), /렌더 실패/);
  assert.match(r.stderr, /legacy 재시도도 실패/);
}));

test("legacy 재시도가 중간(5번째)에서 죽으면 거기서 멈추고 종료 1이다", async () => {
  // 1차는 첫 단계(reactFails)에서 죽고, 재시도는 다섯째(fail)에서 죽는다.
  const fx = await fixture(["reactFails", "ok", "ok", "ok", "fail", "ok"]);
  try {
    const r = await pipeline(fx, { renderer: "react" });
    assert.equal(r.code, 1);
    assert.deepEqual(await fx.calls(), ["step1 react keep", "step1 legacy keep", "step2 legacy keep", "step3 legacy keep", "step4 legacy keep", "step5 legacy keep"]);
    assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=false\n`);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("JIPGYE_RENDERER=legacy가 명시돼 있으면 1차 실패에도 재시도하지 않는다", withFixture(SIX("fail"), async (fx) => {
  const r = await pipeline(fx, { renderer: "legacy" });
  assert.equal(r.code, 1);
  assert.deepEqual(await fx.calls(), ["step1 legacy keep"], "같은 legacy를 다시 돌리지 않는다");
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=false\n`);
  assert.ok(!r.stdout.includes("::warning::"));
}));

test("JIPGYE_RENDERER 미설정은 재시도 대상이다(기본값은 컷오버 뒤 react) - 재시도는 legacy를 명시한다", withFixture(SIX("needsLegacy"), async (fx) => {
  const r = await pipeline(fx);
  assert.equal(r.code, 0);
  assert.deepEqual(await fx.calls(), ["step1 unset keep", ...legacyAll]);
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=true\n`);
}));

test("빈 문자열도 미설정과 같다(재시도 대상)", withFixture(SIX("needsLegacy"), async (fx) => {
  const r = await pipeline(fx, { renderer: "" });
  assert.equal(r.code, 0);
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=true\n`);
}));

test("읽을 수 없는 JIPGYE_RENDERER 값으로 1차가 죽어도 legacy 재시도로 이어진다(명시된 legacy만 재시도하지 않는다)", withFixture(SIX("needsLegacy"), async (fx) => {
  const r = await pipeline(fx, { renderer: "reakt" });
  assert.equal(r.code, 0);
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=true\n`);
}));

test("$GITHUB_OUTPUT·$GITHUB_STEP_SUMMARY가 없으면(로컬) 기록을 건너뛰고 폴백은 그대로 돈다", withFixture(SIX("reactFails"), async (fx) => {
  const r = await pipeline(fx, { renderer: "react", github: false });
  assert.equal(r.code, 0);
  assert.deepEqual(await fx.calls(), ["step1 react keep", ...legacyAll]);
  assert.equal(await fx.file("output"), null);
  assert.equal(await fx.file("summary"), null);
  assert.deepEqual((await readdir(fx.dir)).filter((n) => !n.startsWith("step") && n !== "calls.log"), [], "기록 파일을 새로 만들었다");
}));

test("$GITHUB_OUTPUT에는 이어 붙인다(앞 단계가 쓴 출력을 지우지 않는다)", withFixture(SIX("ok"), async (fx) => {
  await writeFile(fx.out, "earlier=1\n");
  await pipeline(fx, { renderer: "react" });
  assert.equal(await fx.file("output"), `earlier=1\n${FALLBACK_OUTPUT}=false\n`);
}));

test("존재하지 않는 단계는 실패다(조용히 건너뛰지 않는다)", withFixture(["ok"], async (fx) => {
  const r = await pipeline(fx, { renderer: "react", args: [fx.steps[0], path.join(fx.dir, "없는-단계.mjs")] });
  assert.equal(r.code, 1);
  assert.equal(await fx.file("output"), `${FALLBACK_OUTPUT}=false\n`);
}));

test("기본 단계는 지금까지 워크플로가 부르던 여섯 스크립트의 순서 그대로이고 update-all의 렌더 꼬리와 같다", async () => {
  assert.deepEqual(RENDER_STEPS, [
    "scripts/prerender.mjs",
    "scripts/build-rate-pages.ts",
    "scripts/build-news-pages.mjs",
    "scripts/build-budget-pages.mjs",
    "scripts/build-realestate-pages.mjs",
    "scripts/build-updated-stamp.mjs",
  ]);
  const all = [...(await read("scripts/update-all.mjs")).matchAll(/run\("node (scripts\/[a-z-]+\.(?:mjs|ts))"\)/g)].map((m) => m[1]);
  assert.deepEqual(all.slice(all.indexOf("scripts/prerender.mjs")), RENDER_STEPS, "update-all의 렌더 순서와 기본 단계가 갈라졌다");
});

// #427: 위 시험은 소스의 목록과 시험 안의 목록을 맞댈 뿐이라 둘이 같이 옛 이름으로 남으면 초록이다(개명이 두 곳을 같이 놓치면 무인 렌더만 죽는다).
// 목록이 가리키는 파일이 저장소에 실제로 있는지를 따로 본다 - 확장자를 박지 않고 목록에 적힌 이름 그대로 연다.
test("RENDER_STEPS와 update-all의 렌더 꼬리가 가리키는 파일이 모두 저장소에 있다 - 개명이 목록을 놓치면 무인 렌더만 죽는다", async () => {
  const tail = [...(await read("scripts/update-all.mjs")).matchAll(/run\("node (scripts\/[a-z-]+\.(?:mjs|ts))"\)/g)].map((m) => m[1]);
  const fromPrerender = tail.slice(tail.findIndex((s) => /^scripts\/prerender\.(?:mjs|ts)$/.test(s)));
  assert.ok(RENDER_STEPS.length >= 6 && fromPrerender.length >= 6, `목록이 비었다: RENDER_STEPS ${RENDER_STEPS.length}, update-all 꼬리 ${fromPrerender.length}`);
  const missing = [...new Set([...RENDER_STEPS, ...fromPrerender])].filter((rel) => !existsSync(path.join(root, rel)));
  assert.deepEqual(missing, [], `렌더 단계가 가리키는 파일이 없다(개명 때 목록을 같이 고쳤는지 본다): ${missing.join(", ")}`);
});

// --- 워크플로 문자열 ---------------------------------------------------------------------------------------------------------

const WORKFLOWS = [".github/workflows/daily-update.yml", ".github/workflows/summarize.yml"];

const stepOf = (yml, name) => {
  const at = yml.indexOf(`- name: ${name}\n`);
  assert.ok(at >= 0, `단계 "${name}"이 없다`);
  return yml.slice(at).split("\n      - ")[0].split(/\n      #/)[0];
};

test("두 워크플로의 렌더 단계는 render-pipeline을 부르고 id: render를 갖는다 - 인라인 렌더 스크립트가 남지 않는다", async () => {
  for (const file of WORKFLOWS) {
    const yml = await read(file);
    const step = stepOf(yml, "정적 HTML에 오늘 내용 심기");
    assert.match(step, /^ {8}id: render$/m, `${file}: 렌더 단계에 id: render가 없다`);
    assert.match(step, /node scripts\/render-pipeline\.mjs/, `${file}: 렌더 단계가 render-pipeline을 부르지 않는다`);
    assert.ok(!/node scripts\/(prerender|build-[a-z]+-pages|build-updated-stamp)\.(?:mjs|ts)/.test(step), `${file}: 렌더 스크립트를 인라인으로 다시 부른다(폴백을 우회한다)`);
  }
  // 어느 워크플로 파일에도 인라인 렌더 호출이 남으면 안 된다(렌더 단계가 하나 더 생겨 폴백을 우회하는 것을 막는다).
  const dir = path.join(root, ".github/workflows");
  for (const name of await readdir(dir)) {
    const text = await readFile(path.join(dir, name), "utf8");
    assert.ok(!/node scripts\/prerender\.(?:mjs|ts)/.test(text), `${name}: prerender.mjs를 워크플로에서 직접 부른다`);
  }
});

test("daily-update는 기본 여섯, summarize는 같은 순서의 다섯(build-rate-pages 없음 - 전에도 안 불렀다)을 넘기고 news-context는 파이프라인 앞에 있다", async () => {
  const daily = stepOf(await read(WORKFLOWS[0]), "정적 HTML에 오늘 내용 심기");
  assert.match(daily, /run: node scripts\/render-pipeline\.mjs$/m, "daily-update는 기본 단계(인자 없음)를 쓴다");

  const summarize = stepOf(await read(WORKFLOWS[1]), "정적 HTML에 오늘 내용 심기");
  const args = [...summarize.matchAll(/^ {12}(scripts\/[a-z-]+\.(?:mjs|ts))/gm)].map((m) => m[1]);
  assert.deepEqual(args, RENDER_STEPS.filter((s) => s !== "scripts/build-rate-pages.ts"));
  assert.ok(summarize.indexOf("news-context.mjs") >= 0 && summarize.indexOf("news-context.mjs") < summarize.indexOf("render-pipeline.mjs"), "news-context는 폴백 밖, 파이프라인 앞에 둔다");
});

test("마지막 실패 단계의 if가 스크립트가 쓰는 $GITHUB_OUTPUT 키와 렌더 단계 id를 정확히 읽고, 커밋·테스트·배포 뒤에서 job을 실패시킨다", withFixture(SIX("reactFails"), async (fx) => {
  await pipeline(fx, { renderer: "react" });
  const [key, value] = (await fx.file("output")).trim().split("=");
  assert.equal(key, FALLBACK_OUTPUT);
  assert.equal(value, "true");

  for (const file of WORKFLOWS) {
    const yml = await read(file);
    const render = stepOf(yml, "정적 HTML에 오늘 내용 심기");
    const id = render.match(/^ {8}id: (\S+)$/m)[1];
    const fail = stepOf(yml, "렌더 폴백 반영");
    assert.ok(fail.includes(`if: steps.${id}.outputs.${key} == 'true'`), `${file}: 마지막 단계의 if가 steps.${id}.outputs.${key}를 읽지 않는다\n${fail}`);
    assert.match(fail, /exit 1/);
    assert.ok(fail.includes("React 렌더 실패 → legacy로 폴백했음. 사이트는 정상 배포됨, 원인 조사 필요"), `${file}: 실패 메시지가 다르다`);
    // 커밋·배포가 모두 끝난 뒤에야 실패로 끝낸다 - 폴백이 사이트를 막지 않는다.
    const at = (name) => yml.indexOf(`- name: ${name}\n`);
    assert.ok(at("변경사항 커밋 및 푸시") > at("정적 HTML에 오늘 내용 심기"));
    assert.ok(at("렌더 폴백 반영") > at("Pages에 배포"), `${file}: 실패 단계가 배포보다 앞에 있다`);
  }
}));

test("렌더 단계는 폴백이 발동해도 job을 막지 않는다 - 렌더 단계에 continue-on-error나 if가 붙지 않는다", async () => {
  for (const file of WORKFLOWS) {
    const step = stepOf(await read(file), "정적 HTML에 오늘 내용 심기");
    assert.ok(!/continue-on-error|^ {8}if:/m.test(step), `${file}: 렌더 단계에 조건이 붙었다`);
  }
});
