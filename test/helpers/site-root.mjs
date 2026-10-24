// 시험이 "나가는 사이트"를 읽는 자리 (#510, 구조 B-4).
//
// B4 이전에는 생성 HTML 53장이 docs/ 에 커밋돼 있어 시험이 docs/<장>.html 을 곧바로 읽었다. 이제 main 은 생성 HTML 을 안 들고 있다 -
// 사이트는 `node scripts/render-pipeline.ts --out=build/site` 가 main HEAD(코드 + 데이터)로 새로 만든다(.gitignore 의 build/). 그래서
// 생성 장(자치구·예산대·거래유형·금리·뉴스)이나 "채워진 장 전체"를 읽는 시험은 이 헬퍼를 지나 build/site 를 읽는다.
//
// 이 헬퍼를 import 하는 시험 파일이 곧 **배포 게이트**(`npm run test:site`, scripts/run-tests.mjs --site)의 대상이다 - 배포 전에 build/site 가 읽히는
// 모양인지만 본다. 기능 시험(손으로 고치는 틀·스크립트·워크플로 글자)은 PR 의 test.yml 에 남는다(데이터 배포가 기능 시험 실패에 막히지 않게).
// 파일을 게이트에 넣고 빼는 길은 이 import 하나다 - 목록 파일을 따로 두지 않는다(목록과 시험이 갈라지지 않게).
//
// 위치: 기본은 저장소 루트의 build/site. 환경변수 JIPGYE_TEST_SITE 로 다른 디렉터리를 줄 수 있다(렌더 출력의 JIPGYE_SITE_DIR 과 이름이 다르다 -
// 시험이 고정 데이터로 렌더 스크립트를 자식으로 돌릴 때 그 환경변수가 새어 들어가 자식의 출력 위치를 바꾸면 안 된다).
// 아직 안 만들었으면 import 에서 던진다 - "파일이 없다"(ENOENT) 수백 줄 대신 무엇을 먼저 돌려야 하는지 한 줄로 말한다.
import { existsSync } from "node:fs";
import path from "node:path";

export const SITE_TEST_ENV = "JIPGYE_TEST_SITE";
const repo = path.resolve(import.meta.dirname, "../..");

/** 나가는 사이트의 절대 경로. */
export const SITE_DIR = path.resolve(repo, process.env[SITE_TEST_ENV] || "build/site");

if (!existsSync(path.join(SITE_DIR, "index.html"))) {
  throw new Error(
    `나가는 사이트(${SITE_DIR})가 없다 - 먼저 \`node scripts/render-pipeline.ts --out=build/site\` 를 돌린다(\`npm test\` 는 pretest 로 이걸 자동으로 한다).`,
  );
}

/** 저장소 루트 기준 상대 경로. `path.join(root, ...)`·`read(rel)` 꼴로 쓰는 시험이 `docs/${file}` 자리에 `${SITE}/${file}` 로 쓴다. */
export const SITE = path.relative(repo, SITE_DIR).split(path.sep).join("/");

/** 사이트 안 파일의 절대 경로. */
export const sitePath = (rel) => path.join(SITE_DIR, rel);
