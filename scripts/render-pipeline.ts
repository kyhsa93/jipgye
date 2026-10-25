// 렌더 파이프라인 (#238 F1 에서 시작, #248 P1 에서 legacy 폴백을 걷었다).
//
// `deploy.yml`·`test.yml` 의 "사이트 생성 (build/site)" 단계(id: render)와 `npm test` 의 pretest 가 부른다. 다섯 렌더 스크립트를 순서대로 돌리고
// **첫 실패에서 멈춰 종료 1** 이다. 재시도·폴백은 없다(#248 P1, 소유자 결정 2026-10-25): 전에는 React 렌더가 실패하면 legacy 로 처음부터
// 다시 그리고 `$GITHUB_OUTPUT` 에 `fallback=true` 를 썼지만, 그 산출물은 워크플로의 게이트가 배포·통과를 이미 막고 있었다 - 폴백은 가용성을
// 주지 않는 진단용이었다. 이제 렌더 실패가 곧 그 단계의 실패이고, 배포가 안 나가 사이트는 직전 배포에 머문다(수집분은 daily 가 따로 커밋한다).
//
// 실패하면 실패한 단계와 이유를 stderr 와 `$GITHUB_STEP_SUMMARY`(있을 때만)에 남긴다. 단계의 오류 출력은 그대로 흘린다(stdio inherit).
//
// 단계 목록은 인자로 주입할 수 있다(`node scripts/render-pipeline.ts a.mjs b.mjs`) - 시험이 가짜 단계로 실패를 만든다.
// 인자가 없으면 기본 다섯이다. 상대 경로는 저장소 루트 기준이다.
//
// 출력 디렉터리(#508, 구조 B-2): `--out=<디렉터리>` 인자나 환경변수 JIPGYE_SITE_DIR 이 docs/ 가 아닌 디렉터리를 가리키면, 첫 단계 전에
// docs/ 를 그 디렉터리로 통째로 복사하고(scripts/site-dir.ts stageSite) 다섯 스크립트가 거기서 읽고 쓴다. docs/ 는 한 바이트도 안 바뀐다.
// 인자도 환경변수도 없으면 docs/ 를 제자리에서 갱신한다.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { DOCS_DIR, SITE_DIR_ENV, shownPath, siteDir, stageSite } from "./site-dir.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

/** 기본 단계: 지금까지 워크플로가 이 순서로 부르던 다섯 스크립트(순서가 곧 의존 순서다 - 기준일 찍기가 마지막). */
export const RENDER_STEPS = [
  "scripts/prerender.ts",
  "scripts/build-news-pages.ts",
  "scripts/build-budget-pages.ts",
  "scripts/build-realestate-pages.ts",
  "scripts/build-updated-stamp.ts",
];

/** 같은 순서로 단계를 돌린다. 첫 실패에서 멈춘다. */
function runAll(steps, env, cwd) {
  for (const step of steps) {
    console.log(`[render-pipeline] ${step}`);
    const r = spawnSync(process.execPath, [path.resolve(cwd, step)], { cwd, env, stdio: "inherit" });
    if (r.status !== 0) {
      const why = r.error ? `실행 오류 ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}` : r.signal ? `신호 ${r.signal}` : `종료 코드 ${r.status}`;
      return { ok: false, step, why };
    }
  }
  return { ok: true };
}

function appendIfSet(file, text) {
  if (file) appendFileSync(file, text);
}

/**
 * 파이프라인 한 번. 종료 코드를 돌려준다(0: 성공, 1: 실패).
 * `$GITHUB_STEP_SUMMARY`가 없으면(로컬) 요약 기록은 건너뛴다.
 */
export function runRenderPipeline({ steps = RENDER_STEPS, env = process.env, cwd = repoRoot } = {}) {
  const summary = (text) => appendIfSet(env.GITHUB_STEP_SUMMARY, `${text}\n`);

  // 출력 디렉터리가 docs/ 가 아니면 첫 단계 전에 복사한다. 복사가 막히면(docs/ 안, 비사이트 디렉터리 등) 렌더를 시작하지 않고 종료 1이다.
  const out = siteDir(env);
  if (out !== DOCS_DIR) {
    try {
      const { copied } = stageSite({ out });
      console.log(`[render-pipeline] 출력 디렉터리 ${shownPath(out)} <- docs/ ${copied}개 파일`);
    } catch (err) {
      const why = (err as Error).message;
      console.error(`[render-pipeline] 출력 디렉터리 준비 실패: ${why}`);
      summary(`### 렌더 실패\n\n출력 디렉터리 \`${shownPath(out)}\` 준비에서 멈췄다(${why}). 배포가 돌지 않는다.`);
      return 1;
    }
  }

  const result = runAll(steps, env, cwd);
  if (result.ok) return 0;

  console.error(`[render-pipeline] 렌더 실패: ${result.step} (${result.why}) - 뒤 단계는 돌리지 않는다`);
  summary(`### 렌더 실패\n\n\`${result.step}\`(${result.why})에서 멈췄다. 뒤 단계는 돌지 않았고 배포가 돌지 않는다(사이트는 직전 배포에 머문다). 원인은 이 단계 로그의 오류 출력이다.`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
  const rest = args.filter((a) => !a.startsWith("--out="));
  const steps = rest.length > 0 ? rest : RENDER_STEPS;
  process.exitCode = runRenderPipeline({ steps, env: outArg ? { ...process.env, [SITE_DIR_ENV]: outArg } : process.env });
}
