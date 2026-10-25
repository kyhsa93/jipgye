import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(cmd) {
  execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
}

// 수집·빌더가 만드는 것은 데이터뿐이다 - docs/data 와 raw 만 커밋한다(#510, 구조 B-4. scripts/push-docs.sh 의 DATA_PATHS 와 같다).
// 사이트 HTML 은 만들지도 커밋하지도 않는다: 보고 싶으면 scripts/render-pipeline.ts 에 --out=build/site 를 줘서 build/site 에 만든다(.gitignore).
const DATA_PATHS = ["docs/data", "raw"];
function trackedPaths() {
  return DATA_PATHS.filter((dir) => existsSync(path.join(repoRoot, dir)));
}

// 실거래(fetch-realestate) 수집은 일부러 부르지 않는다. 인증키가 있어야 해서 daily-update.yml 의
// full 실행이 시크릿을 넣어 부른다(금감원 금리 수집 fetch-rates 는 #577 에서 지웠다). 빌더는
// 커밋돼 있는 실거래 원본(raw/)으로 다시 계산하므로 여기서도 그대로 돈다.
// 월간 원장 스냅샷(#482)은 매일 돌지 않는다 - `--ledger` 를 줄 때만 부르고, 그때는 수집·빌드·커밋 없이 그것만 돈다.
// 나머지 인자(--month·--license-sale·--license-rent·--dry-run …)는 그대로 넘긴다. 실제 스냅샷은 ledger-snapshot.yml 이 dispatch로 만든다.
const LEDGER = "node scripts/ledger-snapshot.ts";

async function main() {
  if (process.argv.includes("--ledger")) {
    const [cmd, script] = LEDGER.split(" ");
    execFileSync(cmd, [script, ...process.argv.slice(2).filter((a) => a !== "--ledger")], { cwd: repoRoot, stdio: "inherit" });
    return;
  }
  run("node scripts/fetch-news.ts");
  run("node scripts/fetch-market.ts");
  run("node scripts/fetch-price-index.ts");
  run("node scripts/fetch-indicators.ts");
  run("node scripts/fetch-move-in.ts");
  run("node scripts/fetch-district-index.ts");
  run("node scripts/build-realestate.ts");
  run("node scripts/build-budget-deals.ts");
  run("node scripts/build-conversion.ts");
  run("node scripts/build-cancellation.ts");
  run("node scripts/build-renewal-facts.ts");
  run("node scripts/build-floor-gap.ts");
  run("node scripts/build-outlook.ts");
  run("node scripts/build-indicators.ts");
  run("node scripts/build-move-in.ts");
  run("node scripts/build-complex-price.ts");
  run("node scripts/build-record-high.ts");
  run("node scripts/build-district-change.ts");
  run("node scripts/build-complex-ratio.ts");
  run("node scripts/build-rent-preview.ts");
  run("node scripts/build-search-index.ts");
  // 같은 집 쌍(#170 V8): 5-1 ② 의 운영 창이 매일 옮겨 가므로 매일 다시 센다. 맨 뒤에 둔다 - 25구 밖 코드처럼 사전 기준이 멈추라는 입력이면 던지는데, 그때 앞 빌더들은 이미 끝나 있다.
  run("node scripts/build-repeat-sales.ts");
  run("node scripts/news-context.ts");

  const status = execSync(`git status --porcelain -- ${DATA_PATHS.join(" ")}`, { cwd: repoRoot }).toString().trim();
  if (!status) {
    console.log("[update-all] 변경사항 없음, 커밋 생략");
    return;
  }

  run(`git add ${trackedPaths().join(" ")}`);
  run(
    `git commit -m "chore: 데일리 데이터 갱신 $(TZ=Asia/Seoul date +%Y-%m-%d)"`
  );
  run("git push");
  console.log("[update-all] 커밋 및 푸시 완료");
}

main();
