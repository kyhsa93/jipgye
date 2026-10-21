import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expandRenderPipeline } from "./helpers/workflow-text.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
// 워크플로는 렌더 여섯을 render-pipeline.ts 한 줄로 부른다(#238) - 순서·포함을 읽는 시험은 그 줄을 펼쳐서 본다.
const readWorkflow = async (rel) => expandRenderPipeline(await read(rel));

const scriptsIn = (text) =>
  [...text.matchAll(/node scripts\/([a-z-]+\.(?:mjs|ts))/g)].map((m) => m[1]);

/**
 * 매일 도는 워크플로가 update-all이 부르는 빌더를 하나라도 빠뜨리면, 그 빌더가
 * 만드는 파일은 사람이 손으로 돌릴 때까지 그대로 멈춘다. 화면은 멀쩡하고 숫자도
 * 그럴듯해서 아무도 모른다 - 실제로 전세vs월세·해제·등기·재계약 셋이 사흘 동안
 * 8월 26일자에 멈춰 있었다.
 */
test("워크플로가 update-all이 부르는 빌더를 다 부른다", async () => {
  const [workflow, updateAll] = await Promise.all([
    readWorkflow(".github/workflows/daily-update.yml"),
    read("scripts/update-all.mjs"),
  ]);

  const wanted = scriptsIn(updateAll);
  assert.ok(wanted.length >= 10, `update-all이 부르는 스크립트를 ${wanted.length}개밖에 못 읽었다`);

  const running = new Set(scriptsIn(workflow));
  const missing = wanted.filter((name) => !running.has(name));
  assert.deepEqual(missing, [], `워크플로가 안 부르는 빌더: ${missing.join(", ")}`);
});

test("파생 데이터를 만드는 빌더가 원본 수집과 같은 단계에 있다", async () => {
  const workflow = await read(".github/workflows/daily-update.yml");
  // 원본(raw)을 읽는 빌더들이다. 수집이 건너뛰어지는 날에는 이들도 같이 쉬어야
  // 어제 원본으로 오늘 값을 다시 만드는 일이 없다.
  const step = workflow.split("- name: 실거래 수집")[1]?.split("- name:")[0] ?? "";
  for (const name of ["build-conversion.ts", "build-cancellation.ts", "build-renewal-facts.ts", "build-complex-ratio.ts", "build-complex-price.ts", "build-record-high.ts", "build-district-change.ts"]) {
    assert.ok(step.includes(name), `${name}이 실거래 수집 단계 밖에 있다`);
  }
});

/**
 * summarize.yml도 정적 HTML을 틀에서 다시 쓴다(prerender·build-*-pages). 기준일 찍기
 * (build-updated-stamp)는 그 뒤에 돌아야 하는데, 이게 빠져 Summarize가 4회 연속
 * 실패했다(#212: 시험 228·231 - 기준일 줄이 틀 상태로 돌아감). 이 시험은 두 워크플로의
 * "정적 HTML에 오늘 내용 심기" 단계가 같은 순서를 지키는지 본다. summarize는 금리를
 * 수집하지 않아 build-rate-pages를 안 부르므로(없어도 통과함을 재현으로 확인) 부분 순서만 본다.
 */
test("summarize.yml의 페이지 빌드 순서가 daily-update.yml과 어긋나지 않고 기준일 찍기로 끝난다", async () => {
  const [daily, summarize] = await Promise.all([
    readWorkflow(".github/workflows/daily-update.yml"),
    readWorkflow(".github/workflows/summarize.yml"),
  ]);
  const stepOf = (text) => scriptsIn(text.split("- name: 정적 HTML에 오늘 내용 심기")[1]?.split("\n      - name:")[0] ?? "");
  // daily는 news-context를 앞 단계(기사에 수치 붙이기)에서 부르므로, 순서는 daily 전체에서 대조한다.
  const d = scriptsIn(daily);
  const s = stepOf(summarize);
  assert.ok(d.length >= 20 && s.length >= 5, `단계를 못 읽었다: daily ${d.length}개, summarize ${s.length}개`);
  assert.equal(s.at(-1), "build-updated-stamp.ts", "summarize.yml 페이지 빌드 단계가 build-updated-stamp로 끝나지 않는다");

  let from = 0;
  for (const name of s) {
    const at = d.indexOf(name, from);
    assert.ok(at >= 0, `summarize.yml의 ${name}이 daily-update.yml에 없거나 순서가 다르다`);
    from = at + 1;
  }
});

/**
 * conversion.json은 rates.json의 대출 금리·옵션 수를 읽는다. 첫 build-conversion은 "실거래 수집"
 * 단계 안에서 금리 수집보다 먼저 돌아서, 금감원 공시월이 바뀐 날(2026-10-22) rates만 새것이 되고
 * conversion은 어제 금리로 남아 수집 후 테스트(sample-size 154행)가 빨개졌다(#467).
 * 이 시험은 워크플로 스텝 순서를 읽어, 마지막 build-conversion이 fetch-rates 뒤 · conversion을
 * 읽는 렌더(render-pipeline)·커밋·수집 후 테스트 앞에서 돈다고 단언한다. 같은 호출이 앞 단계에만
 * 있으면(옛 워크플로) 실패한다.
 */
test("full 모드에서 build-conversion이 fetch-rates 뒤 · 렌더·커밋·수집 후 테스트 앞에서 다시 돈다", async () => {
  const workflow = await read(".github/workflows/daily-update.yml");
  // 스텝 머리는 6칸 들여쓴 `- ` 다. 스텝마다 그 본문(주석 포함)까지 한 덩어리로 자른다.
  const steps = workflow.split(/\n(?=      - )/).filter((s) => s.startsWith("      - "));
  const indexesOf = (needle) => steps.flatMap((s, i) => (s.includes(needle) ? [i] : []));
  const only = (needle) => {
    const at = indexesOf(needle);
    assert.equal(at.length, 1, `${needle}을 부르는 스텝이 ${at.length}개다`);
    return at[0];
  };

  const rates = only("node scripts/fetch-rates.mjs");
  const render = only("node scripts/render-pipeline.ts");
  const commit = only("./scripts/push-docs.sh \"chore: 데일리 데이터 갱신");
  const testsAfter = indexesOf("npm test").at(-1);
  const conversions = indexesOf("node scripts/build-conversion.ts");

  assert.ok(conversions.length >= 2, `build-conversion을 부르는 스텝이 ${conversions.length}개다 - 실거래 수집 안의 것 하나뿐이면 금리 수집 전 값으로 남는다(#467)`);
  const last = conversions.at(-1);
  assert.ok(last > rates, "마지막 build-conversion이 fetch-rates보다 앞이다 - conversion이 어제 금리로 남는다(#467)");
  assert.ok(last < render, "마지막 build-conversion이 render-pipeline보다 뒤다 - 렌더가 낡은 conversion을 읽는다");
  assert.ok(last < commit && last < testsAfter, "마지막 build-conversion이 커밋·수집 후 테스트보다 뒤다");

  // 금리 수집이 full에서만 돌므로 다시 만들기도 full에서만 돈다(news 모드에서 금리 없이 도는 일이 없게).
  assert.match(steps[rates], /if: env\.MODE == 'full'/);
  assert.match(steps[last], /if: env\.MODE == 'full'/);
  // 이 단계 실패가 job을 멈추면 같은 실행의 수집분 커밋이 안 돈다(#62) - 멈추지 않는다.
  assert.match(steps[last], /continue-on-error: true/);
});
