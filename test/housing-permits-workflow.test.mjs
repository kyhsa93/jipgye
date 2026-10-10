import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// housing-permits.yml 배선 (#133). official-price.yml 선례와 같은 방어선 + 시크릿 범위.
const root = path.resolve(import.meta.dirname, "..");
const text = await readFile(path.join(root, ".github/workflows/housing-permits.yml"), "utf8");
const daily = await readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8");

test("워크플로: dispatch 전용이고 일일 워크플로에는 들어가지 않는다", () => {
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /schedule:|pull_request|push:/);
  assert.doesNotMatch(daily, /housing-permits|BUILDINGHUB/);
});

test("워크플로: 최소 권한, 액션 SHA 고정, 입력이 run에 직접 박히지 않는다", () => {
  assert.match(text, /permissions:\n  contents: write\n/);
  for (const m of text.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  assert.doesNotMatch(text.split("\n").filter((l) => /^\s+(- )?run:/.test(l) || /^\s{10,}\S/.test(l)).join("\n"), /\$\{\{\s*inputs\./);
  for (const block of text.split(/\n\s+run: /).slice(1)) assert.doesNotMatch(block.split("\n      - ")[0], /\$\{\{/);
  assert.match(text, /license:[\s\S]*page_modified:/, "이용허락 문자열은 코드가 아니라 입력으로 받는다");
});

test("워크플로: 시크릿은 이름만 참조하고 수집 스텝 env에만 있다. 원본은 러너 임시 폴더(저장소 밖)", () => {
  const uses = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(uses)].sort(), ["BUILDINGHUB_API_KEY"]);
  const idx = text.indexOf("secrets.BUILDINGHUB_API_KEY");
  const stepStart = text.lastIndexOf("\n      - ", idx);
  const before = text.slice(0, stepStart);
  assert.doesNotMatch(before, /secrets\./, "잡 env나 앞선 스텝에 시크릿을 두지 않는다");
  // 잡 수준 env에서는 runner 컨텍스트를 못 쓴다(actionlint). 수집 스텝 env에서 받고 정리는 $RUNNER_TEMP로 한다.
  const jobEnv = text.slice(text.indexOf("    env:"), text.indexOf("    steps:"));
  assert.doesNotMatch(jobEnv, /runner\./);
  assert.match(text, /BUILDINGHUB_RAW_DIR: \$\{\{ runner\.temp \}\}\/housing-raw/);
  assert.match(text, /rm -rf "\$RUNNER_TEMP\/housing-raw"/);
  assert.doesNotMatch(text, /최초 입력 시점으로 확인된/);
  assert.doesNotMatch(text, /echo[^\n]*BUILDINGHUB_API_KEY|set -x/);
});

test("워크플로: 사전 등록 순서 확인이 첫 호출 스텝보다 앞에 있고 전체 이력을 받는다", () => {
  assert.match(text, /fetch-depth: 0/);
  const check = text.indexOf("check-prereg-order.mjs");
  const collect = text.indexOf("fetch-housing-permits.mjs");
  assert.ok(check > 0 && collect > check, "확인 → 수집 순서");
  assert.match(text, /dac5e98db7d00aca37dfa57dda1da9f4d39314ca/);
});

test("워크플로: 커밋은 접힌 결과와 측정 메타만(원본·raw 폴더 아님)", () => {
  const commit = text.slice(text.lastIndexOf("push-docs.sh"));
  assert.match(commit, /research\/housing-permits\/folded\.json/);
  assert.doesNotMatch(commit, /housing-raw|RUNNER_TEMP|raw\//);
});

test("워크플로: concurrency는 official-price 선례대로 digest-pipeline을 공유한다(같은 main에 push하므로)", () => {
  assert.match(text, /concurrency:\n  group: digest-pipeline\n  cancel-in-progress: false/);
});

// ---- 시험 호출 입력 (#141) ----

test("워크플로: 시험 호출 입력(district·max_calls)은 잡 env로 받고 run에 보간하지 않는다", () => {
  assert.match(text, /^      district:/m);
  assert.match(text, /^      max_calls:/m);
  assert.match(text, /^      DISTRICT_CODE: \$\{\{ inputs\.district \}\}$/m);
  assert.match(text, /^      MAX_CALLS: \$\{\{ inputs\.max_calls \}\}$/m);
  assert.match(text, /\$\{DISTRICT_CODE:\+--only-district "\$DISTRICT_CODE"\}/);
  assert.match(text, /\$\{MAX_CALLS:\+--max-calls "\$MAX_CALLS"\}/);
});

test("워크플로: 시험 호출이면 측정·커밋 스텝을 건너뛴다(folded.json·measure.json을 올리지 않는다)", () => {
  for (const name of ["B1~B4 측정", "커밋 (접힌 결과와 측정 메타만)"]) {
    const start = text.indexOf(`- name: ${name}`);
    assert.ok(start > 0, name);
    const step = text.slice(start, text.indexOf("\n      - ", start + 1) > 0 ? text.indexOf("\n      - ", start + 1) : undefined);
    assert.match(step, /if: \$\{\{ inputs\.district == '' && inputs\.max_calls == '' \}\}/, name);
  }
});

test("워크플로: 일 한도 환경변수·상수는 건드리지 않는다(올리는 것은 소유자 조건 5 변경)", () => {
  assert.doesNotMatch(text, /BUILDINGHUB_DAILY_LIMIT/);
});
