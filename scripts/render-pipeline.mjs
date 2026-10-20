// 렌더 파이프라인 + legacy 폴백 (#238 F1의 최소판, 컷오버 전 안전장치).
//
// `daily-update.yml`·`summarize.yml`의 "정적 HTML에 오늘 내용 심기" 단계가 부른다. 여섯 렌더 스크립트를 순서대로 돌리다 하나라도
// 실패하면 **같은 단계에서 `JIPGYE_RENDERER=legacy`를 못박고 여섯을 처음부터 다시 돌린다.** 왜:
//
// - 렌더가 예외로 죽으면 뒤의 "변경사항 커밋 및 푸시"가 안 돌아, 그 실행이 이미 받은 `docs/data`의 market-history·rates-history·
//   news-history 항목이 사라진다. 금리는 금감원의 당일 스냅숏이라 다시 받을 수도 없다.
// - 앞 스크립트가 react로 이미 쓴 장이 있어도 처음부터 다시 돌려 안전하다. 스크립트마다 쓰기는 전 장 렌더가 끝난 뒤에만 하므로
//   (`render-writes.mjs`, #237) 한 스크립트의 반쪽 출력은 없고, 이식된 조각은 legacy와 같은 바이트를 내므로(조각마다 parity 시험)
//   앞 스크립트의 react 출력 위에 legacy를 덮어도 처음부터 legacy로 그린 것과 같다.
//
// 폴백이 발동하면 `::warning::`과 `$GITHUB_STEP_SUMMARY`에 남기고 `$GITHUB_OUTPUT`에 `fallback=true`를 쓴다 - 종료 코드는 0이라
// 커밋·배포는 정상으로 이어지고, 워크플로 끝의 "렌더 폴백 반영" 단계가 그 출력을 읽어 job을 빨갛게 끝낸다(조용히 지나가지 않게).
// legacy 재시도까지 실패하면 종료 1이다(전과 같은 동작: 뒤 단계가 안 돈다).
//
// `JIPGYE_RENDERER=legacy`가 **명시된** 1차 실패는 재시도하지 않는다 - 같은 legacy를 다시 돌려 봐야 같은 실패다. 미설정은 재시도 대상이다:
// 기본값은 컷오버 뒤 react이고(`renderer.mjs`), 이 스크립트는 그 기본값을 읽지 않는다(react를 import하지 않는다) - 환경변수 글자만 본다.
//
// 단계 목록은 인자로 주입할 수 있다(`node scripts/render-pipeline.mjs a.mjs b.mjs`) - 시험이 가짜 단계로 실패를 만든다.
// 인자가 없으면 기본 여섯이다. 상대 경로는 저장소 루트 기준이다.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

/** 기본 단계: 지금까지 워크플로가 이 순서로 부르던 여섯 스크립트(순서가 곧 의존 순서다 - 기준일 찍기가 마지막). */
export const RENDER_STEPS = [
  "scripts/prerender.mjs",
  "scripts/build-rate-pages.ts",
  "scripts/build-news-pages.mjs",
  "scripts/build-budget-pages.mjs",
  "scripts/build-realestate-pages.mjs",
  "scripts/build-updated-stamp.mjs",
];

/** `$GITHUB_OUTPUT`에 쓰는 키. 워크플로의 마지막 단계 `if`가 이 이름을 읽는다(시험이 둘을 맞댄다). */
export const FALLBACK_OUTPUT = "fallback";

/** 같은 순서로 단계를 돌린다. 첫 실패에서 멈춘다. */
function runAll(steps, env, cwd) {
  for (const step of steps) {
    console.log(`[render-pipeline] ${step}`);
    const r = spawnSync(process.execPath, [path.resolve(cwd, step)], { cwd, env, stdio: "inherit" });
    if (r.status !== 0) {
      const why = r.error ? `실행 오류 ${r.error.code ?? r.error.message}` : r.signal ? `신호 ${r.signal}` : `종료 코드 ${r.status}`;
      return { ok: false, step, why };
    }
  }
  return { ok: true };
}

function appendIfSet(file, text) {
  if (file) appendFileSync(file, text);
}

/**
 * 파이프라인 한 번. 종료 코드를 돌려준다(0: 성공 또는 폴백 성공, 1: 실패).
 * `env`는 1차 시도의 환경이고, 재시도는 거기에 `JIPGYE_RENDERER=legacy`를 덮은 것이다.
 * `$GITHUB_OUTPUT`·`$GITHUB_STEP_SUMMARY`가 없으면(로컬) 그 기록은 건너뛴다.
 */
export function runRenderPipeline({ steps = RENDER_STEPS, env = process.env, cwd = repoRoot } = {}) {
  const mode = env.JIPGYE_RENDERER;
  const record = (fallback) => appendIfSet(env.GITHUB_OUTPUT, `${FALLBACK_OUTPUT}=${fallback}\n`);
  const summary = (text) => appendIfSet(env.GITHUB_STEP_SUMMARY, `${text}\n`);

  const first = runAll(steps, env, cwd);
  if (first.ok) {
    record(false);
    return 0;
  }

  const modeLabel = mode === undefined || mode === "" ? "(미설정)" : mode;
  console.error(`[render-pipeline] 렌더 실패: ${first.step} (${first.why}), JIPGYE_RENDERER=${modeLabel}`);
  if (mode === "legacy") {
    // 이미 legacy다. 다시 돌려도 같은 실패라 재시도하지 않는다.
    console.error("[render-pipeline] JIPGYE_RENDERER=legacy가 명시돼 있어 legacy 재시도는 하지 않는다");
    record(false);
    return 1;
  }

  console.log(`::warning::렌더 실패(${first.step}, ${first.why}) - JIPGYE_RENDERER=legacy로 여섯 단계를 처음부터 다시 렌더한다`);
  const retry = runAll(steps, { ...env, JIPGYE_RENDERER: "legacy" }, cwd);
  if (!retry.ok) {
    console.error(`[render-pipeline] legacy 재시도도 실패: ${retry.step} (${retry.why})`);
    summary(`### 렌더 실패\n\n1차(JIPGYE_RENDERER=${modeLabel})에서 \`${first.step}\`(${first.why})가 실패했고, legacy 재시도에서도 \`${retry.step}\`(${retry.why})가 실패했다. 커밋·배포가 돌지 않는다.`);
    record(false);
    return 1;
  }

  const warning = `React 렌더가 실패해 legacy로 폴백했다: 1차(JIPGYE_RENDERER=${modeLabel})의 \`${first.step}\`(${first.why}). legacy로 여섯 단계를 처음부터 다시 렌더해 성공했다`;
  console.error(`[render-pipeline] ${warning.replaceAll("`", "")}`);
  console.log(`::warning::${warning.replaceAll("`", "")}. 커밋·배포는 이어지고 job은 마지막 단계에서 실패로 끝난다`);
  summary(`### 렌더 폴백 발동\n\n${warning}. 사이트는 legacy 출력으로 정상 배포되고, 원인 조사가 필요하다(위 1차 시도 로그).`);
  record(true);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const steps = process.argv.length > 2 ? process.argv.slice(2) : RENDER_STEPS;
  process.exitCode = runRenderPipeline({ steps });
}
