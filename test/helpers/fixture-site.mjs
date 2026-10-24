// 고정 데이터로 렌더 스크립트를 실제로 돌려 보는 격리 작업 폴더 (#507, 구조 B-1).
//
// 왜: 예전에는 "커밋된 docs/*.html 이 지금 docs/data 로 다시 찍은 것과 같다" 같은 시험이 루트 `npm test`에 있었다. 그 시험의 주제는
// 커밋된 데이터와 커밋된 생성물의 짝이라서, 데이터가 하루에 한 번 바뀌는 구조(B)에서는 기능 PR 시험이 그날 데이터에 기댄다.
// 그 짝 검사는 tools/health(비차단)로 옮겼고, 이 헬퍼는 그 검사가 잡던 **코드 쪽** 약속 - 렌더 스크립트(prerender·build-*-pages·
// build-updated-stamp)가 데이터를 장의 제자리에 꽂는가 - 을 고정 데이터로 지킨다. 저장소의 docs/data·raw 는 읽지 않는다.
//
// 어떻게: 임시 폴더에 scripts/·src/·package.json 과 docs/ 의 손으로 쓴 틀·정적 파일(docs/data 는 빼고)을 복사하고, node_modules 는 링크한다.
// 스크립트는 `import.meta.dirname/..` 을 저장소 루트로 삼으므로 복사본의 scripts/ 를 돌리면 쓰기도 복사본 docs/ 로만 간다.
// docs/data 자리에는 test/fixtures/site/data 를 둔다 - 실제 docs/data 의 모양을 줄여 얼린 사본과 손으로 쓴 합성 기사·요약(검증 폴백 하나 포함),
// 그리고 updated-stamp 시험이 쓰는 기준일만 있는 소스들이다(fixtures/site/README 대신 이 주석이 출처다: 2026-10-23 origin/main 5bff9be4 의 docs/data 에서
// rates 의 예금·적금·주담대는 앞 6개만, 나머지는 그대로 얼렸다. 얼린 뒤에는 오늘 데이터와 아무 관계가 없다).
//
// (#520) district-change.json 은 기준일만 있던 소스에 합성 권역 5줄(regions)과 그 표(regionTable)를 더했다 - switch-house 권역표 시험의 입력이다. 칸 수를 오늘 값과 일부러 다르게 뒀다.
//
// (#524) budget-deals.json 은 기준일만 있던 소스에 예산 밴드 18개(3억대~20억대)를 더했다 - 오늘 docs/data/budget-deals.json(origin/main 136dcf7d)에서 밴드별 거래를 앞 3건으로 줄여 얼린 것이다.
// build-budget-pages 가 이 밴드로 예산 18장을 만든다(site-dir 시험이 53장 전부를 걷어내고 다시 그리는 데 쓴다). B4(#510)부터 SITE_STEPS 에도 그 단계가 있어 모든 고정 데이터 작업 폴더가 이 밴드로 예산 18장을 찍는다.
//
// 복사하는 docs/*.html 은 손으로 고치는 틀 14장뿐이다(#510, 구조 B-4: 생성 53장은 main 에서 걷혔다). 생성 장은 아래 SITE_STEPS 가 이 작업 폴더에서 새로 찍는다 -
// 예산 장(build-budget-pages)도 이제 그 단계에 든다(기준일 찍기가 예산 18장을 읽는다). 렌더 시각은 BUILD_NOW 로 못박아 날짜에 기대지 않는다(#8).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "../..");
/** 고정 데이터 렌더의 "지금". build-budget-pages 의 최근 6개월 창이 읽는 유일한 시각이다. */
export const FIXTURE_NOW = "2026-10-23T00:00:00Z";
export const FIXTURE_DATA =path.join(repo, "test/fixtures/site/data");

/** 이 순서로 돈다: 프리렌더가 틀을 채우고, 페이지 빌더가 장을 찍고, 기준일 찍기가 마지막이다(render-pipeline.ts 의 순서와 같다). */
export const SITE_STEPS = [
  "scripts/prerender.ts",
  "scripts/build-rate-pages.ts",
  "scripts/build-news-pages.ts",
  "scripts/build-budget-pages.ts",
  "scripts/build-realestate-pages.ts",
  "scripts/build-updated-stamp.ts",
];

/**
 * 작업 폴더를 만들고 렌더 스크립트를 돌린다. 돌려주는 객체의 `root`는 작업 폴더, `read`·`json`은 그 안의 파일을 읽는다.
 * 스크립트가 하나라도 실패하면 던진다(stderr 를 메시지에 싣는다). 다 쓰면 `cleanup()`.
 * `env` 로 JIPGYE_RENDERER 같은 것을 넘길 수 있다.
 */
export function buildFixtureSite({ steps = SITE_STEPS, env = {} } = {}) {
  // realpath: macOS 의 tmpdir 은 /var -> /private/var 심볼릭 링크다. 스크립트는 `process.argv[1]` 과 `import.meta.filename`(실경로)이 같을 때만 main 을 돌려서,
  // 링크가 낀 경로로 부르면 아무것도 안 하고 종료 코드 0 으로 끝난다(실측).
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jipgye-site-")));
  cpSync(path.join(repo, "scripts"), path.join(root, "scripts"), { recursive: true });
  cpSync(path.join(repo, "src"), path.join(root, "src"), { recursive: true });
  cpSync(path.join(repo, "package.json"), path.join(root, "package.json"));
  cpSync(path.join(repo, "docs"), path.join(root, "docs"), { recursive: true, filter: (src) => src !== path.join(repo, "docs/data") });
  mkdirSync(path.join(root, "docs/data"), { recursive: true });
  cpSync(FIXTURE_DATA, path.join(root, "docs/data"), { recursive: true });
  symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"), "dir");
  for (const step of steps) {
    const r = spawnSync(process.execPath, [path.join(root, step)], { cwd: root, env: { ...process.env, BUILD_NOW: FIXTURE_NOW, ...env }, encoding: "utf8" });
    if (r.status !== 0) {
      rmSync(root, { recursive: true, force: true });
      throw new Error(`고정 데이터 렌더 실패: ${step} (종료 ${r.status}${r.signal ? `, ${r.signal}` : ""})\n${r.stderr}`);
    }
  }
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  return {
    root,
    docs: path.join(root, "docs"),
    data: path.join(root, "docs/data"),
    read,
    json: (name) => JSON.parse(read(`docs/data/${name}.json`)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
