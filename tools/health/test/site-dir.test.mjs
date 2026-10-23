// 원본: test/site-dir.test.mjs 의 아래 시험을 옮겼다(#520). 경로 접두(../ 한 단 -> 세 단)와 시험 안의 도움 함수 복사만 다르고 단언은 같다.
// 옮긴 이유: 실제 docs/data 로 생성 페이지 53장을 걷어낸 복사본에서 다시 그려 전체와 맞대는 검사라 데이터 모양이 바뀌면 결과가 갈린다(예산 밴드의 min10k 가 어긋나
// build-budget-pages 가 '3억대' 장을 건너뛰면 build-updated-stamp 가 budget-3eok.html 이 없다고 던진다 - 합성 교란에서 재현) - 루트 `npm test`에서는 비차단 점검으로 뺐다.
// 같은 약속의 고정 데이터 판(생성 53장 전부, 예산 18장 포함 - #524)은 루트 test/site-dir.test.mjs 에 남아 있다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

// 렌더가 만드는 생성 페이지 53장(rate 4 + news 3 + budget 18 + realestate 3 + district 25). 나머지 14장은 손으로 고치는 소스다.
const GENERATED = /^(deposit-rates|saving-rates|mortgage-rates|rent-loan-rates|rate-news|realestate-news|stock-news|apartment-(sale|jeonse|rent)|budget-\d+eok|district-[a-z]+)\.html$/;

test("생성 53장이 없는 복사본에서 그려도 전체를 그린 것과 같다 - 생성 페이지는 입력이 아니다 (B4에서 docs/ 의 생성물을 걷어내도 안전)", async () => {
  const full = path.join(tmp(), "full");
  await run(process.execPath, [path.join(REPO_ROOT, "scripts/render-pipeline.ts"), `--out=${full}`], { env: pipelineEnv() });

  const bare = path.join(tmp(), "bare");
  await run(process.execPath, [path.join(REPO_ROOT, "scripts/stage-site.ts"), `--out=${bare}`], { env: pipelineEnv() });
  let removed = 0;
  for (const f of readdirSync(bare)) {
    if (!GENERATED.test(f)) continue;
    rmSync(path.join(bare, f));
    removed += 1;
  }
  assert.equal(removed, 53);
  for (const step of RENDER_STEPS) {
    await run(process.execPath, [path.join(REPO_ROOT, step)], { env: { ...pipelineEnv(), [SITE_DIR_ENV]: bare } });
  }
  assert.deepEqual([...tree(bare)], [...tree(full)]);
});
