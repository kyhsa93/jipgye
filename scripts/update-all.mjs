import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(cmd) {
  execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
}

function trackedPaths() {
  return ["docs", "raw"].filter((dir) => existsSync(path.join(repoRoot, dir)));
}

// 실거래(fetch-realestate)·금리(fetch-rates) 수집은 일부러 부르지 않는다. 둘 다 인증키가
// 있어야 하고 fetch-rates는 키가 없으면 예외로 끝나서, 키 없이 도는 이 로컬 갱신 전체를
// 멈춘다. 그 둘은 daily-update.yml의 full 실행이 시크릿을 넣어 부른다. 빌더는
// 커밋돼 있는 실거래 원본(raw/)으로 다시 계산하므로 여기서도 그대로 돈다.
async function main() {
  run("node scripts/fetch-news.mjs");
  run("node scripts/fetch-market.mjs");
  run("node scripts/fetch-price-index.mjs");
  run("node scripts/fetch-indicators.mjs");
  run("node scripts/fetch-move-in.mjs");
  run("node scripts/fetch-district-index.mjs");
  run("node scripts/build-realestate.mjs");
  run("node scripts/build-budget-deals.mjs");
  run("node scripts/build-conversion.mjs");
  run("node scripts/build-cancellation.mjs");
  run("node scripts/build-renewal-facts.mjs");
  run("node scripts/build-floor-gap.mjs");
  run("node scripts/build-outlook.mjs");
  run("node scripts/build-indicators.mjs");
  run("node scripts/build-move-in.mjs");
  run("node scripts/build-complex-price.mjs");
  run("node scripts/build-record-high.mjs");
  run("node scripts/build-district-change.mjs");
  run("node scripts/build-complex-ratio.mjs");
  run("node scripts/build-rent-preview.mjs");
  run("node scripts/build-search-index.mjs");
  run("node scripts/news-context.mjs");
  run("node scripts/prerender.mjs");
  run("node scripts/build-rate-pages.mjs");
  run("node scripts/build-news-pages.mjs");
  run("node scripts/build-budget-pages.mjs");
  run("node scripts/build-realestate-pages.mjs");
  run("node scripts/build-updated-stamp.mjs");

  const status = execSync("git status --porcelain -- docs raw", { cwd: repoRoot }).toString().trim();
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
