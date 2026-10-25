// 원본: test/site-dir.test.mjs 의 아래 시험을 옮겼다(#520). 경로 접두(../ 한 단 -> 세 단)와 시험 안의 도움 함수 복사만 다르고 단언은 같았다.
// (#510, B4) 단언의 방향은 뒤집혔다 - 생성 49장을 걷어낸 복사본이 아니라 이미 생성 장이 있는 디렉터리 위에 다시 그려 맞댄다(아래 시험 머리 주석). 루트 판과 같은 방향이다.
// 옮긴 이유: 실제 docs/data 로 생성 페이지 49장을 그려 전체와 맞대는 검사라 데이터 모양이 바뀌면 결과가 갈린다(예산 밴드의 min10k 가 어긋나
// build-budget-pages 가 '3억대' 장을 건너뛰면 build-updated-stamp 가 budget-3eok.html 이 없다고 던진다 - 합성 교란에서 재현) - 루트 `npm test`에서는 비차단 점검으로 뺐다.
// 같은 약속의 고정 데이터 판(생성 49장 전부, 예산 18장 포함 - #524)은 루트 test/site-dir.test.mjs 에 남아 있다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RENDER_STEPS } from "../../../scripts/render-pipeline.ts";
import { REPO_ROOT, SITE_DIR_ENV } from "../../../scripts/site-dir.ts";

const run = promisify(execFile);
const made = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "site-dir-health-"));
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

// 렌더가 만드는 생성 페이지 49장(news 3 + budget 18 + realestate 3 + district 25 - 금리 4장은 #577 B2 로 지웠다). 나머지 18장은 docs/ 의 소스다(손으로 고치는 틀 13장 + 금리 종료 안내 5장).
const GENERATED = /^(rate-news|realestate-news|stock-news|apartment-(sale|jeonse|rent)|budget-\d+eok|district-[a-z]+)\.html$/;

// (#510, 구조 B-4) 방향이 뒤집혔다: main 의 docs/ 는 생성 49장을 안 들고 있으므로 "걷어낸 복사본" 판은 항상 같다. 남은 약속은 "이미 생성 장이 있는 디렉터리 위에 다시 그려도
// 처음 그린 것과 같다"이다 - 롤백(옛 docs/ 복원)이나 한 디렉터리를 두 번 렌더하는 길에서 낡은 생성 장이 입력으로 새지 않는다. 입력은 실제 docs/data 다(고정 데이터 판은 루트에 있다).
test("생성 49장이 이미 있는 디렉터리 위에 다시 그려도 처음 그린 것과 같다 - 생성 페이지는 입력이 아니다 (B4: 실제 docs/data 로 도는 판)", async () => {
  assert.deepEqual(readdirSync(path.join(REPO_ROOT, "docs")).filter((f) => GENERATED.test(f)), [], "main 의 docs/ 에 생성 장이 있다 - 산출물은 build/site 에만 생긴다");
  const full = path.join(tmp(), "full");
  await run(process.execPath, [path.join(REPO_ROOT, "scripts/render-pipeline.ts"), `--out=${full}`], { env: pipelineEnv() });
  assert.equal(readdirSync(full).filter((f) => GENERATED.test(f)).length, 49, "처음 그린 산출에 생성 49장이 있어야 한다");

  const again = path.join(tmp(), "again");
  cpSync(full, again, { recursive: true });
  for (const step of RENDER_STEPS) {
    await run(process.execPath, [path.join(REPO_ROOT, step)], { env: { ...pipelineEnv(), [SITE_DIR_ENV]: again } });
  }
  assert.deepEqual([...tree(again)], [...tree(full)]);
});
