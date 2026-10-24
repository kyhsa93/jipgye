// 배포 게이트가 도는 시험 파일을 고른다 (#510, 구조 B-4). `npm run test:site` = `node scripts/run-tests.mjs --site` 가 이 목록만 돌린다.
//
// 기준은 하나다: 시험이 test/helpers/site-root.mjs(나가는 사이트 build/site 를 읽는 자리)를 부르는가. 그 헬퍼를 직접 import 하거나, 그 헬퍼를 import 하는
// 헬퍼(예: digest-page·rates-page)를 거쳐 부르면 "build/site 기준 시험"이다. 목록 파일을 따로 두지 않는 이유: 목록과 시험이 갈라지면 새 시험이 게이트 밖에서 조용히
// 안 돈다 - import 한 줄이 곧 게이트 가입이다. 기능 시험(틀·스크립트·워크플로 글자를 읽는 것)은 이 기준에 안 걸려 PR 의 test.yml 에만 남는다(데이터 배포가 기능 시험 실패에
// 막히지 않게, cto 판정).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT_HELPER = "site-root";
const IMPORT = /from\s+["']([^"']+)["']/g;
const stem = (spec) => path.basename(spec).replace(/\.(mjs|ts)$/, "");
const importsOf = (body) => [...body.matchAll(IMPORT)].map((m) => stem(m[1]));

/** 헬퍼 이름(확장자 뺀 것) 집합: site-root 와, site-root 를 (간접으로라도) import 하는 헬퍼들. */
function siteHelpers(helpersDir) {
  const bodies = new Map(readdirSync(helpersDir).filter((f) => /\.(mjs|ts)$/.test(f)).map((f) => [stem(f), readFileSync(path.join(helpersDir, f), "utf8")]));
  const site = new Set([ROOT_HELPER]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of bodies) {
      if (!site.has(name) && importsOf(body).some((n) => site.has(n))) {
        site.add(name);
        changed = true;
      }
    }
  }
  return site;
}

/** test/ 아래 `*.test.mjs|ts` 중 build/site 기준 시험의 경로(cwd 기준 상대, `test/x.test.mjs`) 목록. 글자순. */
export function siteTestFiles(testDir = "test") {
  const helpers = siteHelpers(path.join(testDir, "helpers"));
  const out = [];
  for (const f of readdirSync(testDir).filter((n) => /\.test\.(mjs|ts)$/.test(n)).sort()) {
    if (importsOf(readFileSync(path.join(testDir, f), "utf8")).some((n) => helpers.has(n))) out.push(`${testDir}/${f}`);
  }
  return out;
}
