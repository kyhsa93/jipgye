/**
 * 공시가격 API 수집 실행기 (#68 E1·E3). 건축HUB 건축물대장 API에서 지번별로 받아 칸으로 접는다.
 *
 *   PUBLIC_DATA_PORTAL_API_KEY=... \
 *     node scripts/fetch-official-price-api.ts --raw-commit <40자리> [--raw-dir raw-at-commit/raw] [--out-dir raw/official-price]
 *   ... --explore   # 쓰기 없음, 집계만(E3)
 *
 * 하루 호출 예산(기본 9,000, env DAILY_CALL_BUDGET)·초당 1회 이하·한도 코드(22)에서 "끝난 지번까지 저장하고 정상 종료"
 * 같은 규칙은 official-price-api.mjs 머리말. 검증이 어긋나면 아무것도 쓰지 않고 종료 코드 1.
 * 출력(stdout·GITHUB_STEP_SUMMARY)은 집계뿐이다 - 키·URL·응답 원문·호 단위 값·지번 키가 없다(C1).
 */
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  ApiFatalError, ApiValidationError, DEFAULT_BASE, DEFAULT_DAILY_BUDGET, DEFAULT_END_DATE, DEFAULT_START_DATE, MIN_GAP_MS, PROGRESS_FILE, STALL_FAIL_DAYS,
  nextProgress, normalizeKey, progressLines, readProgress, runCollector, stallVerdict, summaryLines,
} from "./official-price-api.ts";
import { runExplore } from "./official-price-explore.ts";
import { loadTargets } from "./official-price-targets.ts";

/** collect 모드 호출 예산 입력의 상한(개발계정 일 10,000건 안). 입력이 더 크면 이 값으로 자른다. */
const MAX_COLLECT_BUDGET = 9000;
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
  // 수집(collect)의 호출 예산은 하루 9,000이 상한이다(개발계정 일 10,000건 안). 입력이 더 크면 자르고 알린다. 탐색은 기존대로(10,000 이상도 허용).
  const requestedBudget = intEnv(v.budget || env.DAILY_CALL_BUDGET, DEFAULT_DAILY_BUDGET);
  const budget = v.explore ? requestedBudget : Math.min(requestedBudget, MAX_COLLECT_BUDGET);
  if (!v.explore && requestedBudget > MAX_COLLECT_BUDGET) console.log(`::notice::호출 예산 입력 ${requestedBudget}회가 상한 ${MAX_COLLECT_BUDGET}회를 넘어 ${MAX_COLLECT_BUDGET}회로 잘랐다.`);
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
    budget, gapMs,
    softDeadlineMs: startedAt + runtimeMin * 60000, deadlineMs: startedAt + (runtimeMin + 15) * 60000,
    log: (line) => console.log(line), // 지번 단위 한 줄(범위 밖 stdDay 등, #802) - 키·호 값은 runCollector 가 넣지 않는다
  });
  const lines = summaryLines(summary, budget);
  if (summary.status === "complete") { emit(lines); return; }

  // 진척 상태(#68 V1): 끝난 지번이 0인 실행을 ::warning 으로 올리고, 마지막 진척에서 STALL_FAIL_DAYS 일이 지나면
  // GITHUB_OUTPUT stall=1 을 낸다 - 워크플로의 마지막 스텝이 그것을 보고 실패한다(커밋 스텝은 이미 상태 파일을 올린 뒤).
  const outDir = v["out-dir"];
  const nowDate = env.OFFICIAL_PRICE_NOW ? new Date(env.OFFICIAL_PRICE_NOW) : new Date(); // 시험만 시각을 준다
  const progress = nextProgress(await readProgress(outDir), summary, nowDate.toISOString());
  const verdict = stallVerdict(progress, nowDate);
  await mkdir(path.dirname(path.join(outDir, PROGRESS_FILE)), { recursive: true });
  await writeFile(path.join(outDir, PROGRESS_FILE), JSON.stringify(progress, null, 2) + "\n");
  emit([...lines, ...progressLines(progress, verdict)]);
  const errs = Object.keys(summary.errCodes ?? {}).join(", ") || "없음";
  if (verdict.level === "ok") {
    if (summary.stopReason) console.log(`::notice::공시가격 수집 중단(정상 종료): ${summary.stopReason}`);
  } else {
    const since = progress.lastProgressAt ? `마지막 진척 ${verdict.days}일 전` : `진척 0 실행 ${progress.zeroProgressRuns}회`;
    console.log(`::warning::공시가격 수집 진척 0(${since}): 중단 ${summary.stopReason ?? "없음"}, 오류 분류 ${errs}`);
  }
  if (verdict.level === "fail" && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, "stall=1\n");
  if (verdict.level === "fail") console.log(`공시가격 수집 정지: 마지막 진척에서 ${STALL_FAIL_DAYS}일 이상(이 실행은 상태 파일을 커밋한 뒤 실패로 끝난다).`);
}

main().catch((e) => {
  // 알려진 오류만 문구를 낸다. 그 밖의 오류는 이름·코드만 - err.message에 URL·본문이 섞일 수 있다(C1).
  const known = e instanceof ApiValidationError || e instanceof ApiFatalError;
  console.error(`공시가격 API 수집 실패(아무것도 쓰지 않음): ${known ? e.message : `${e?.name ?? "Error"} ${e?.code ?? ""}`.trim()}`);
  process.exit(1);
});
