// 근거표 건수 파일 (#871 PR-B). 사이트 빌드 단계(render-pipeline)가 `<출력 디렉터리>/data/reco-counts.json` 하나를 만든다.
//
// 왜: 근거표 장(buy-by-budget.html)의 폼이 값대·면적대를 바꾸면 서울 머리와 25구 건수가 바로 바뀌어야 한다. reco-<구>.json 25개를 다 받으면 gzip 193KB 라
// (cto 착수 판정 1), 빌드가 같은 순수 함수(scripts/budget-table.ts recoCounts - 구운 기본 보기와 같은 budgetModel)로 값대×면적대마다 센 숫자만 내려 둔다.
// 브라우저는 이 파일을 읽기만 한다(cto 조건 E). 줄은 「줄 보기」를 누른 구의 reco 파일 하나만 받는다.
//
// 구조 B 를 지킨다: 수집은 이 파일을 모르고 main 에 커밋되는 것은 0 이다(제자리 렌더 때 생기는 docs/data/reco-counts.json 은 .gitignore 가 막는다).
// docs/data 의 reco 25개는 읽기만 한다.
//
// 실패해도 배포를 막지 않는다(cto 착수 판정 4b): reco 가 없거나 모양이 다르면 `::warning::` 한 줄을 남기고 파일 없이 종료 0 이다 - render-pipeline 은 첫 실패에서
// 멈추므로, 여기서 던지면 근거표 한 장 때문에 사이트 전체 배포가 선다. 파일이 없으면 장은 구운 머리를 그대로 두고 「건수를 불러오지 못했습니다」를 붙인다.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { recoCountsOf } from "./budget-table.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { REPO_ROOT, shownPath, siteDir } from "./site-dir.ts";

export const COUNTS_FILE = "data/reco-counts.json";

const readOrNull = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** reco 25개를 읽어 건수 파일을 쓴다. 쓰면 바이트 수, 못 쓰면 null(지난 실행의 낡은 파일도 지운다 - 오늘 reco 와 어긋난 숫자가 나가지 않게). */
export function writeRecoCounts({ out, dataDir = path.join(REPO_ROOT, "docs/data") }: { out: string; dataDir?: string }): number | null {
  const target = path.join(out, COUNTS_FILE);
  rmSync(target, { force: true });
  const counts = recoCountsOf(Object.values(DISTRICT_SLUGS).map((slug) => readOrNull(path.join(dataDir, `reco-${slug}.json`))));
  if (!counts) return null;
  const text = JSON.stringify(counts);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  return Buffer.byteLength(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const out = siteDir();
  let bytes: number | null = null;
  try {
    bytes = writeRecoCounts({ out });
  } catch (err) {
    console.error(`[build-reco-counts] ${(err as Error).message}`);
  }
  if (bytes == null) console.log(`::warning::[build-reco-counts] reco 25개를 읽지 못해 ${COUNTS_FILE} 를 만들지 않았다 - 근거표 장은 구운 기본 보기만 보인다(배포는 계속)`);
  else console.log(`[build-reco-counts] ${shownPath(path.join(out, COUNTS_FILE))} (${bytes}B)`);
}
