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

// 월간 제외 목록(한 곳): update-all 에 등록돼 있지만 매일 돌지 않고 자기 dispatch 워크플로가 부르는 스크립트 → 그 워크플로.
const MONTHLY = { "ledger-snapshot.ts": ".github/workflows/ledger-snapshot.yml" };

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
  const missing = wanted.filter((name) => !running.has(name) && !(name in MONTHLY));
  assert.deepEqual(missing, [], `워크플로가 안 부르는 빌더: ${missing.join(", ")}`);
});

// 원장 스냅샷(#482 판정 ⑤-4): update-all 에는 `--ledger` 를 줄 때만 부르게 등록돼 있고, 자기 워크플로가 부르며, Daily 는 부르지 않는다.
test("월간 스크립트는 update-all(--ledger 일 때만)과 자기 dispatch 워크플로 양쪽에 있고 daily-update.yml 에는 없다 (#482)", async () => {
  const [daily, updateAll] = await Promise.all([readWorkflow(".github/workflows/daily-update.yml"), read("scripts/update-all.mjs")]);
  const guarded = updateAll.slice(updateAll.indexOf('process.argv.includes("--ledger")'));
  assert.ok(guarded.length < updateAll.length, "update-all 에 --ledger 분기가 없다");
  for (const [name, file] of Object.entries(MONTHLY)) {
    assert.ok(scriptsIn(updateAll).includes(name), `update-all 에 ${name} 이 등록돼 있지 않다`);
    assert.ok(!scriptsIn(daily).includes(name), `daily-update.yml 이 월간 ${name} 을 부른다`);
    const own = (await read(file)).replace(/^\s*#.*\n/gm, "");
    assert.ok(scriptsIn(own).includes(name), `${file} 이 ${name} 을 부르지 않는다`);
    assert.match(own, /^on:\n  workflow_dispatch:/m, `${file} 은 dispatch 전용이다`);
    assert.doesNotMatch(own, /schedule:|cron|pull_request|push:/, `${file} 에 예약·push 트리거가 있다`);
  }
  assert.ok(guarded.indexOf("LEDGER.split") < guarded.indexOf("return;"), "--ledger 분기가 원장 스크립트를 부르고 끝나지 않는다");
  assert.ok(updateAll.indexOf('const LEDGER = "node scripts/ledger-snapshot.ts"') >= 0);
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
 * (#510, 구조 B-4) 뒤집었다. summarize.yml 도 정적 HTML 을 틀에서 다시 쓰던 시절에는 기준일 찍기(build-updated-stamp)가 빠져 Summarize 가 4회 연속 실패했다(#212:
 * 시험 228·231 - 기준일 줄이 틀 상태로 돌아감). 렌더가 deploy.yml 한 곳으로 모인 지금은 그 어긋남이 구조적으로 없다: 렌더는 render-pipeline 의 기본 여섯 단계 한 줄이고, 기준일
 * 찍기가 그 맨 끝이다. 이 시험은 (1) 수집 두 워크플로에 렌더가 없고 (2) deploy.yml 이 기본 여섯(인자 없음)을 부르며 (3) 그 순서가 기준일 찍기로 끝난다는 것을 본다.
 * 「일부러 다섯」(rate 4장 제외)은 커밋된 docs/ 에 rate 4장이 있어서만 성립하던 모양이라 없어졌다.
 */
test("렌더는 deploy.yml 의 기본 여섯 단계 한 줄이고 기준일 찍기로 끝난다 - summarize.yml·daily-update.yml 에는 렌더가 없다", async () => {
  const [daily, summarize, deploy] = await Promise.all([
    readWorkflow(".github/workflows/daily-update.yml"),
    readWorkflow(".github/workflows/summarize.yml"),
    readWorkflow(".github/workflows/deploy.yml"),
  ]);
  const RENDERERS = /prerender|build-(?:rate|news|budget|realestate)-pages|build-news-days|build-updated-stamp/;
  for (const [name, text] of [["daily-update.yml", daily], ["summarize.yml", summarize]]) {
    assert.deepEqual(scriptsIn(text).filter((s) => RENDERERS.test(s)), [], `${name}이 렌더 스크립트를 부른다 - 렌더는 deploy.yml 의 일이다`);
  }
  const d = scriptsIn(deploy);
  assert.deepEqual(d, ["prerender.ts", "build-news-pages.ts", "build-budget-pages.ts", "build-realestate-pages.ts", "build-news-days.ts", "build-updated-stamp.ts"], "deploy.yml 의 렌더 순서가 기본 여섯과 다르다");
  assert.equal(d.at(-1), "build-updated-stamp.ts", "deploy.yml 렌더가 build-updated-stamp로 끝나지 않는다");
});

/**
 * conversion.json 은 ECOS 금리 계열(raw/indicators/series.json)과 실거래 원본을 읽는다. build-conversion 은 "실거래 수집" 단계 안에서 한 번만 돈다: 같은 Daily 의 "시장 지표 수집"
 * (fetch-indicators)이 series.json 을 먼저 써 두고 그 뒤에 실거래 수집이 오므로 다시 만들 일이 없다(#580·#607). 옛날에는 금감원 공시 rates.json 을 읽어서, 금리 수집이 실거래 수집 뒤에 있던
 * 날(2026-10-22)에 conversion 만 어제 금리로 남아 수집 후 테스트(sample-size 154행)가 빨개졌다(#467) - 그래서 금리 뒤에 한 번 더 만드는 단계가 있었다.
 * (#577 A·B1b·C2) 금감원 금리 수집과 rates.json 읽기가 없어져 그 두 번째 단계도 지웠다. 이 시험은 build-conversion 호출이 하나뿐이고, 시장 지표 수집(fetch-indicators) 뒤 ·
 * 실거래 수집 안 · news-context·커밋 앞이며 fetch-rates 가 돌아오지 않았다고 단언한다.
 * (#510) 렌더와 시험은 deploy.yml 로 갔으므로 "커밋 앞"이 기준이다 - 커밋 뒤에 만들면 낡은 conversion 이 커밋된다.
 */
test("full 모드에서 build-conversion 은 시장 지표 수집 뒤 실거래 수집 안에서 한 번만 돌고 news-context·커밋 앞이다 - fetch-rates 는 없다 (#467·#577)", async () => {
  const workflow = await read(".github/workflows/daily-update.yml");
  // 스텝 머리는 6칸 들여쓴 `- ` 다. 스텝마다 그 본문(주석 포함)까지 한 덩어리로 자른다.
  const steps = workflow.split(/\n(?=      - )/).filter((s) => s.startsWith("      - "));
  const indexesOf = (needle) => steps.flatMap((s, i) => (s.includes(needle) ? [i] : []));
  const only = (needle) => {
    const at = indexesOf(needle);
    assert.equal(at.length, 1, `${needle}을 부르는 스텝이 ${at.length}개다`);
    return at[0];
  };

  assert.deepEqual(indexesOf("node scripts/fetch-rates.ts"), [], "daily-update.yml 이 fetch-rates 를 부른다 - 금감원 수집은 뺐다(#577 A)");
  assert.ok(!/FSS_FINLIFE_API_KEY/.test(workflow.replace(/^\s*#.*$/gm, "")), "daily-update.yml 이 FSS 키를 넘긴다(#577 A)");
  const indicators = only("node scripts/fetch-indicators.ts");
  const realestate = only("node scripts/fetch-realestate.ts");
  const context = only("node scripts/news-context.ts");
  const commit = only("./scripts/push-docs.sh \"chore: 데일리 데이터 갱신");
  const conversion = only("node scripts/build-conversion.ts");

  assert.equal(conversion, realestate, "build-conversion 이 실거래 수집 단계 밖에 있다 - 두 번째 전환율 단계를 도로 만들지 않는다(#577 C2)");
  assert.ok(indicators < conversion, "conversion 이 시장 지표 수집(ECOS series.json)보다 앞이다 - conversion 이 어제 금리 계열로 남는다");
  assert.ok(conversion < context, "build-conversion이 news-context보다 뒤다 - 기사에 붙는 수치가 낡은 conversion을 읽는다");
  assert.ok(conversion < commit, "build-conversion이 커밋보다 뒤다 - 낡은 conversion이 커밋된다");
  assert.ok(!workflow.replace(/^\s*#.*$/gm, "").includes("render-pipeline"), "수집 워크플로가 렌더를 부른다(#510)");

  // 시장 지표 수집·실거래 수집이 full에서만 돌므로 conversion 도 full에서만 돈다.
  assert.match(steps[indicators], /if: env\.MODE == 'full'/);
  assert.match(steps[realestate], /if: env\.MODE == 'full'/);
});
