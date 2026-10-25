#!/usr/bin/env node
// 주간 측정 (#604, 계획 #583 11-4 의 「GitHub 에서 재는 지표」). pm 이 주 1회 돌려 상태 요약 파일에 한 줄씩 적는다.
//
// 쓰는 법: node scripts/dev/weekly-metrics.mjs [--json] [--days 7] [--repo 소유자/저장소] [--now ISO시각]
// 읽기 전용이다. 네트워크는 `gh` CLI 호출뿐(PATH 의 gh) - 파일을 쓰지 않는다. 종료 0, `gh` 실패 시 1, 사용법 오류 2.
// 지표(GitHub 데이터만):
//   1. 병합 PR 수(최근 N일)  2. PR 당 판정 수 근사 = (리뷰 + 댓글) / PR  3. 병합 뒤 main Test 빨강 = 병합 커밋의 `test.yml` push 실행이 failure·timed_out 인 PR  4. PR 주기 중앙값 = 만든 때→병합한 때
// 없는 것: 에이전트 토큰·sonnet 비율·재개율·engineer 중앙 시간은 GitHub 에 없다(세션 기록 집계 필요). 이 도구는 그 숫자를 내지 않는다.
import { execFileSync } from "node:child_process";

const USAGE = "사용법: node scripts/dev/weekly-metrics.mjs [--json] [--days 7] [--repo 소유자/저장소] [--now ISO시각]";
const TARGETS = { verdictsPerPr: 1.2, ciRedAfterMerge: 0 }; // #583 11-4 의 11-08 목표(판정/PR ≤1.2, main Test 빨강 0)

function parseArgs(argv) {
  const o = { json: false, days: 7, repo: process.env.WEEKLY_REPO || "kyhsa93/jipgye", now: new Date() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} 뒤에 값이 필요하다`); return argv[++i]; };
    if (a === "--json") o.json = true;
    else if (a === "--days") { o.days = Number(val()); if (!(o.days > 0)) throw new Error("--days 는 양수"); }
    else if (a === "--repo") o.repo = val();
    else if (a === "--now") { o.now = new Date(val()); if (Number.isNaN(o.now.getTime())) throw new Error("--now 가 날짜가 아니다"); }
    else throw new Error(`모르는 인자 ${a}`);
  }
  return o;
}

const gh = (args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function collect({ repo, days, now }) {
  const since = new Date(now.getTime() - days * 86400000);
  const prs = gh(["pr", "list", "-R", repo, "--state", "merged", "--search", `merged:>=${since.toISOString().slice(0, 10)}`, "--limit", "500", "--json", "number,createdAt,mergedAt,mergeCommit,reviews,comments"])
    .filter((p) => p.mergedAt && new Date(p.mergedAt) >= since && new Date(p.mergedAt) <= now);
  const runs = gh(["run", "list", "-R", repo, "--workflow", "test.yml", "--branch", "main", "--event", "push", "--limit", "500", "--json", "headSha,conclusion,status"]);
  const bad = new Set(runs.filter((r) => r.status === "completed" && ["failure", "timed_out"].includes(r.conclusion)).map((r) => r.headSha));
  const rows = prs.map((p) => ({
    number: p.number,
    verdicts: (p.reviews || []).length + (p.comments || []).length,
    cycleHours: (new Date(p.mergedAt) - new Date(p.createdAt)) / 3600000,
    ciRed: Boolean(p.mergeCommit?.oid && bad.has(p.mergeCommit.oid)),
  }));
  const n = rows.length, total = rows.reduce((s, r) => s + r.verdicts, 0);
  return {
    repo, days, since: since.toISOString(), until: now.toISOString(),
    note: "GitHub 데이터만. 에이전트 토큰·sonnet 비율·재개율·engineer 중앙 시간은 GitHub 에 없어 여기 없다(세션 기록 집계 필요).",
    mergedPrs: n,
    verdictsPerPr: n ? round(total / n, 2) : null, // 리뷰+댓글 수 근사 - 판정 에이전트 실행 수와 같지 않다
    verdictsMax: n ? Math.max(...rows.map((r) => r.verdicts)) : null,
    prsWith3PlusVerdicts: rows.filter((r) => r.verdicts >= 3).length,
    ciRedAfterMerge: rows.filter((r) => r.ciRed).length,
    ciRedPrs: rows.filter((r) => r.ciRed).map((r) => r.number),
    medianCycleHours: round(median(rows.map((r) => r.cycleHours)), 1),
    targets: TARGETS,
  };
}

const verdict = (ok) => (ok === null ? "-" : ok ? "목표 안" : "목표 밖");
export function render(m) {
  const vOk = m.verdictsPerPr === null ? null : m.verdictsPerPr <= TARGETS.verdictsPerPr;
  const lines = [
    `주간 측정 ${m.repo} · 최근 ${m.days}일 (${m.since.slice(0, 10)} ~ ${m.until.slice(0, 10)})`,
    `※ ${m.note}`,
    `병합 PR: ${m.mergedPrs}건`,
    `판정 수 근사(리뷰+댓글)/PR: ${m.verdictsPerPr ?? "-"} (목표 ≤${TARGETS.verdictsPerPr}, ${verdict(vOk)}) · 최대 ${m.verdictsMax ?? "-"} · 3 이상 ${m.prsWith3PlusVerdicts}건`,
    `병합 뒤 main Test 빨강: ${m.ciRedAfterMerge}건${m.ciRedPrs.length ? ` (PR ${m.ciRedPrs.map((x) => "#" + x).join(" ")})` : ""} (목표 ${TARGETS.ciRedAfterMerge}, ${verdict(m.ciRedAfterMerge <= TARGETS.ciRedAfterMerge)})`,
    `PR 주기 중앙값(만듦→병합): ${m.medianCycleHours === null ? "-" : m.medianCycleHours + "시간"}`,
  ];
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("weekly-metrics.mjs")) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
  try {
    const m = collect(opts);
    console.log(opts.json ? JSON.stringify(m, null, 2) : render(m));
  } catch (e) { console.error(`weekly-metrics 실패: ${String(e.message).split("\n")[0]}`); process.exit(1); }
}
