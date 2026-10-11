/**
 * 공시가격 API 수집 실행기 (#68 E1·E3). 건축HUB 건축물대장 API에서 지번별로 받아 칸으로 접는다.
 *
 *   PUBLIC_DATA_PORTAL_API_KEY=... OFFICIAL_PRICE_LICENSE="제한 없음" OFFICIAL_PRICE_LICENSE_CHECKED=2026-10-11 \
 *     node scripts/fetch-official-price-api.mjs --raw-commit <40자리> [--raw-dir raw-at-commit/raw] [--out-dir raw/official-price]
 *   ... --explore   # 쓰기 없음, 집계만(E3)
 *
 * 하루 호출 예산(기본 9,000, env DAILY_CALL_BUDGET)·초당 1회 이하·한도 코드(22)에서 "끝난 지번까지 저장하고 정상 종료"
 * 같은 규칙은 official-price-api.mjs 머리말. 검증이 어긋나면 아무것도 쓰지 않고 종료 코드 1.
 * 출력(stdout·GITHUB_STEP_SUMMARY)은 집계뿐이다 - 키·URL·응답 원문·호 단위 값·지번 키가 없다(C1).
 */
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ApiFatalError, ApiValidationError, DEFAULT_BASE, DEFAULT_DAILY_BUDGET, DEFAULT_END_DATE, DEFAULT_START_DATE, MIN_GAP_MS, normalizeKey, runCollector, summaryLines } from "./official-price-api.mjs";
import { runExplore } from "./official-price-explore.mjs";
import { loadTargets } from "./official-price-targets.mjs";

const LOCAL_BASE = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

function emit(lines) {
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

const intEnv = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; };

async function main() {
  const { values: v } = parseArgs({
    options: {
      "raw-commit": { type: "string", default: "" }, "raw-dir": { type: "string", default: "raw-at-commit/raw" },
      "names-file": { type: "string", default: "research/official-price/bjdong-names-seoul.json" },
      "out-dir": { type: "string", default: "raw/official-price" },
      "start-date": { type: "string", default: DEFAULT_START_DATE }, "end-date": { type: "string", default: DEFAULT_END_DATE },
      budget: { type: "string", default: "" }, "max-runtime-min": { type: "string", default: "" },
      explore: { type: "boolean", default: false },
      "explore-jibun": { type: "string", default: "" }, "explore-big": { type: "string", default: "" },
    },
  });
  const env = process.env;
  const base = (env.OFFICIAL_PRICE_API_BASE ?? "").trim() || DEFAULT_BASE;
  const local = LOCAL_BASE.test(base);
  if (base !== DEFAULT_BASE && !local) throw new ApiValidationError("OFFICIAL_PRICE_API_BASE는 시험용 로컬 주소만 받는다", "input");
  // 초당 1회 이하는 실제 서버에서 고정이다. 시험(로컬 모의 서버)만 CALL_GAP_MS로 줄일 수 있다.
  const gapMs = local ? Math.max(0, Number(env.CALL_GAP_MS ?? 0) || 0) : MIN_GAP_MS;
  const budget = intEnv(v.budget || env.DAILY_CALL_BUDGET, DEFAULT_DAILY_BUDGET);
  const runtimeMin = intEnv(v["max-runtime-min"] || env.MAX_RUNTIME_MIN, 270);
  const startedAt = Date.now();
  const key = normalizeKey(env.PUBLIC_DATA_PORTAL_API_KEY);
  const names = JSON.parse(await readFile(v["names-file"], "utf8"));
  const { targets, unmappedRows } = await loadTargets({ rawDir: v["raw-dir"], names });
  if (targets.size === 0) throw new ApiValidationError("대상 지번이 비었다(raw-dir에 sale 슬롯이 없다)", "input");

  if (v.explore) {
    if (!key) throw new ApiValidationError("PUBLIC_DATA_PORTAL_API_KEY가 비었다", "input");
    const r = await runExplore({
      key, baseUrl: base, targets, startDate: v["start-date"], endDate: v["end-date"], gapMs,
      sampleN: intEnv(v["explore-jibun"] || env.EXPLORE_JIBUN, 40), bigN: intEnv(v["explore-big"] || env.EXPLORE_BIG, 8),
      budget: intEnv(v.budget || env.DAILY_CALL_BUDGET, 6000), // 탐색 기본 6,000회 - 일 한도 단서(e)를 보려면 10,000 이상을 직접 준다(그날 본 수집과 한도를 나눠 쓴다)
      dailyBudget: budget, deadlineMs: startedAt + runtimeMin * 60000,
    });
    emit([...r.lines, `- 대상 지번 ${targets.size}(raw에서 못 푼 줄 ${unmappedRows}). 이 모드는 파일을 쓰지 않았다.`]);
    if (r.fatal) process.exitCode = 1;
    return;
  }

  const summary = await runCollector({
    key, baseUrl: base, targets, outDir: v["out-dir"], rawCommit: v["raw-commit"], startDate: v["start-date"], endDate: v["end-date"],
    budget, gapMs, license: env.OFFICIAL_PRICE_LICENSE, licenseChecked: env.OFFICIAL_PRICE_LICENSE_CHECKED,
    softDeadlineMs: startedAt + runtimeMin * 60000, deadlineMs: startedAt + (runtimeMin + 15) * 60000,
  });
  const lines = summaryLines(summary, budget);
  emit(lines);
  if (summary.stopReason) console.log(`::notice::공시가격 수집 중단(정상 종료): ${summary.stopReason}`);
}

main().catch((e) => {
  // 알려진 오류만 문구를 낸다. 그 밖의 오류는 이름·코드만 - err.message에 URL·본문이 섞일 수 있다(C1).
  const known = e instanceof ApiValidationError || e instanceof ApiFatalError;
  console.error(`공시가격 API 수집 실패(아무것도 쓰지 않음): ${known ? e.message : `${e?.name ?? "Error"} ${e?.code ?? ""}`.trim()}`);
  process.exit(1);
});
