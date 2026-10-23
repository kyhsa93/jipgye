// docs/ 를 출력 디렉터리로 복사한다 (#508). render-pipeline 이 출력 디렉터리가 docs/ 가 아닐 때 시작에 한 번 부르는 같은 함수다.
// 렌더 스크립트(prerender·build-*-pages)를 파이프라인 밖에서 하나씩 돌릴 때 먼저 이걸 돌린다.
//   node scripts/stage-site.ts --out=build/site          (또는 JIPGYE_SITE_DIR=build/site node scripts/stage-site.ts)
import { SITE_DIR_ENV, shownPath, siteDir, stageSite } from "./site-dir.ts";

const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="))?.slice("--out=".length);
const env = outArg ? { ...process.env, [SITE_DIR_ENV]: outArg } : process.env;
const out = siteDir(env);
const { copied, skipped } = stageSite({ out });
if (skipped) console.log(`[stage-site] 출력 디렉터리가 docs/ 라 복사하지 않는다`);
else console.log(`[stage-site] docs/ -> ${shownPath(out)} (${copied}개 파일)`);
