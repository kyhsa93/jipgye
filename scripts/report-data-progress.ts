/**
 * 데이터 진척 경고의 출구 - 이슈 (#657 D1·D2·D3).
 *
 * 워치독의 넷째 검사(scripts/check-data-progress.ts)는 경고를 `::warning::` 으로만 낸다. run 은 초록이고 메일도 없어 사람이 안 본다(V1: 「run 은 초록, 진척은 0」이 사흘간 안 보였다).
 * 이 스크립트는 `schedule-watchdog.yml` 의 `report` job 에서 돌며, watch job 이 넘긴 판정으로 이슈를 연다. **쓰기 권한(`issues: write`)은 이 job 에만 있다.**
 *
 * 규칙:
 *   - 묶음(소스 이름의 첫 조각)당 열린 이슈 1건. 제목 `[오류] 데이터 진척 경고: <묶음>`, 라벨 audit·bug. 같은 제목이 열려 있으면 아무것도 안 한다.
 *     소스당 1건이 아닌 이유: ECOS 가 멈추면 `series/*` 15건이 한꺼번에 열린다(cto, #657 D3).
 *   - 틱당 새 이슈 `MAX_NEW_ISSUES`건. 넘친 묶음은 코드 목록 순서로 뒤로 밀려 `::warning::` 을 남기고 다음 틱에 열린다.
 *   - 자동으로 닫지 않고 댓글도 없다. 사람이 닫았는데 경고가 남아 있으면 다음 틱에 다시 열린다. 상태 파일이 없어 연속을 세지 않는다.
 *   - 묶음에 실패 판정만 있으면 열지 않는다. 그 경로는 빨간 run 과 실패 메일이다. 코드 목록(ISSUE_GROUPS)에 없는 묶음은 조용히 넘기지 않고 멈춘다.
 *
 * 멈추는 때(종료 1, 이슈 0건): watch 의 결과를 못 읽음(watch 가 그 스텝 전에 죽으면 빈 값이다), 코드 목록에 없는 소스, 열린 이슈 목록을 못 읽음.
 * 중복 확인은 Search API 가 아니라 REST 열린 이슈 목록이다(#657 판정): 끝쪽까지 읽어 제목을 정확히 비교하고, 목록에 섞인 PR 은 뺀다.
 *
 * 시험 표지(`ISSUE_TEST=dispatch-test`, workflow_dispatch 의 choice 입력): 판정과 무관하게 표지 이슈 한 건을 후보 맨 앞에 넣어 실제 쓰기 경로를 잰다(#657 완료 조건 12). 정기 실행에서는 입력이 비어 안 나온다.
 *
 * `npm ci` 가 필요 없다(의존 0, Node 24 의 전역 fetch). 시험은 고정 입력과 스텁 fetch 로만 돈다(test/data-progress.test.mjs).
 */

import { fileURLToPath } from "node:url";
import { ISSUE_GROUPS, NO_ISSUE_GROUPS, groupOf } from "./check-data-progress.ts";

const API = "https://api.github.com";
/** cpo 제안, #657 D3. 값을 바꾸는 것은 판정자 몫이다. */
export const MAX_NEW_ISSUES = 3;
export const ISSUE_LABELS = ["audit", "bug"];
export const TITLE_PREFIX = "[오류] 데이터 진척 경고: ";
export const TEST_MARKER = "dispatch-test";
/** workflow_dispatch 입력의 기본값. 정기 실행에서는 입력 자체가 비어 있다. */
export const TEST_MARKER_OFF = "none";
/** 목록이 이보다 길면 끝을 못 본 것이다 - 조용히 멈추지 않고 실패한다. */
const MAX_PAGES = 100;

type Row = { source: string; cadence?: string; level: "warn" | "fail"; last: string | null; detail: string };
type Report = { version: 1; now: string; checks: Row[] };

/** watch 가 넘긴 한 줄을 읽는다. 비었거나 모양이 다르면 던진다. 경고 없음은 `checks: []` 이지 빈 값이 아니다. */
export function parseReport(text: unknown): Report {
  if (typeof text !== "string" || !text.trim()) throw new Error("watch job 의 결과가 비었다(그 스텝이 돌지 못했거나 출력이 넘어오지 않았다)");
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`watch job 의 결과를 JSON 으로 못 읽었다: ${e.message}`);
  }
  const valid = (r) => typeof r?.source === "string" && (r.level === "warn" || r.level === "fail") && typeof r.detail === "string";
  if (data?.version !== 1 || typeof data.now !== "string" || !Array.isArray(data.checks) || !data.checks.every(valid)) throw new Error("watch job 의 결과 모양이 다르다");
  return data;
}

const issueBody = (group: string, rows: Row[], now: string, runUrl: string | undefined) =>
  [
    `워치독 데이터 진척 경고(#657). 묶음 \`${group}\`.`,
    "",
    "| 소스 | 판정 | 주기 | 마지막 값 | 내용(문턱) |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| \`${r.source}\` | ${r.level} | ${r.cadence ?? ""} | ${r.last ?? "없음"} | ${r.detail} |`),
    "",
    `재현: \`node scripts/check-data-progress.ts --now=${now}\` (이 틱의 main 에서)`,
    ...(runUrl ? [`워치독 run: ${runUrl}`] : []),
    "",
    "받는 주인: ops. 자동으로 닫히지 않는다. 확인 뒤 사람이 닫고, 경고가 남아 있으면 다음 틱에 다시 열린다. 절차: `audit/갱신-사고-대응.md`.",
  ].join("\n");

/** 판정 -> 이슈 후보(코드 목록 순서). 표지가 있으면 맨 앞. 코드 목록에 없는 묶음은 던진다. */
export function planIssues(report: Report, { marker = false, runUrl }: { marker?: boolean; runUrl?: string } = {}) {
  const byGroup = new Map<string, Row[]>();
  for (const row of report.checks) {
    const group = groupOf(row.source);
    if (NO_ISSUE_GROUPS.includes(group)) continue;
    if (!ISSUE_GROUPS.includes(group)) throw new Error(`코드 목록에 없는 소스다: ${row.source}. check-data-progress.ts 의 ISSUE_GROUPS·NO_ISSUE_GROUPS 중 하나에 넣는다(값은 판정자가 정한다)`);
    byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
  }
  const plan = ISSUE_GROUPS.filter((g) => byGroup.get(g)?.some((r) => r.level === "warn")).map((g) => ({ group: g, title: `${TITLE_PREFIX}${g}`, body: issueBody(g, byGroup.get(g), report.now, runUrl) }));
  if (marker) plan.unshift({ group: TEST_MARKER, title: `${TITLE_PREFIX}${TEST_MARKER}`, body: `시험 표지 dispatch 로 연 이슈다(#657 완료 조건 12). 데이터 경고가 아니다. 실측 뒤 닫는다.${runUrl ? `\n\n워치독 run: ${runUrl}` : ""}` });
  return plan;
}

const headers = (token: string | undefined) => {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "jipgye-schedule-watchdog" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

/** 열린 이슈 제목 전부. Link 머리의 next 를 끝까지 따라간다. PR 은 뺀다. 못 읽으면 던진다. */
export async function listOpenIssueTitles({ repo, token, fetchImpl = fetch }: { repo: string; token?: string; fetchImpl?: typeof fetch }) {
  const titles = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${API}/repos/${repo}/issues?state=open&per_page=100&page=${page}`;
    const res = await fetchImpl(url, { headers: headers(token) });
    if (!res.ok) throw new Error(`열린 이슈 목록을 못 읽었다: GitHub API ${res.status} ${res.statusText} - ${url}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("열린 이슈 목록 응답이 배열이 아니다");
    for (const row of rows) if (!row.pull_request) titles.add(row.title);
    if (!/rel="next"/.test(res.headers.get("link") ?? "")) return titles;
  }
  throw new Error(`열린 이슈 목록이 ${MAX_PAGES}쪽을 넘는다 - 끝을 못 봤다`);
}

async function createIssue({ repo, token, fetchImpl, issue }: { repo: string; token?: string; fetchImpl: typeof fetch; issue: { title: string; body: string } }) {
  const url = `${API}/repos/${repo}/issues`;
  const res = await fetchImpl(url, { method: "POST", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify({ title: issue.title, body: issue.body, labels: ISSUE_LABELS }) });
  if (!res.ok) throw new Error(`이슈를 못 열었다: GitHub API ${res.status} ${res.statusText} - ${issue.title}`);
  return (await res.json())?.html_url ?? "(주소 없음)";
}

/** 본체. 돌려주는 값은 시험·로그용이다. 멈출 일이 있으면 던진다(호출자가 종료 1 로 바꾼다). */
export async function runReport({ text, marker = false, repo, token, runUrl, fetchImpl = fetch, log = console.log }: { text: unknown; marker?: boolean; repo: string; token?: string; runUrl?: string; fetchImpl?: typeof fetch; log?: (m: string) => void }) {
  const plan = planIssues(parseReport(text), { marker, runUrl });
  if (!plan.length) {
    log("이슈를 열 묶음이 없다");
    return { created: [], open: [], deferred: [] };
  }
  const titles = await listOpenIssueTitles({ repo, token, fetchImpl });
  const open = plan.filter((p) => titles.has(p.title));
  const fresh = plan.filter((p) => !titles.has(p.title));
  const created = fresh.slice(0, MAX_NEW_ISSUES);
  const deferred = fresh.slice(MAX_NEW_ISSUES);
  for (const p of open) log(`이미 열림: ${p.title}`);
  for (const p of created) log(`이슈 열림: ${await createIssue({ repo, token, fetchImpl, issue: p })} ${p.title}`);
  for (const p of deferred) log(`::warning::틱당 새 이슈 상한 ${MAX_NEW_ISSUES}건을 넘어 다음 틱으로 미룬다: ${p.group}`);
  return { created: created.map((p) => p.group), open: open.map((p) => p.group), deferred: deferred.map((p) => p.group) };
}

/** 표지 입력을 읽는다. dispatch 밖에서는 꺼져 있고, 목록 밖 값은 던진다. */
export function readMarker(env: Record<string, string | undefined>) {
  const value = env.ISSUE_TEST ?? "";
  if (value && value !== TEST_MARKER && value !== TEST_MARKER_OFF) throw new Error(`ISSUE_TEST 값을 모른다: ${value}`);
  return env.GITHUB_EVENT_NAME === "workflow_dispatch" && value === TEST_MARKER;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env;
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  try {
    if (!env.GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY 가 없다");
    const r = await runReport({ text: env.PROGRESS_REPORT, marker: readMarker(env), repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, runUrl });
    console.log(`새 이슈 ${r.created.length}건, 이미 열림 ${r.open.length}건, 미룸 ${r.deferred.length}건`);
  } catch (e) {
    console.log(`::error::데이터 진척 이슈 단계가 돌지 못했다 - ${e.message}`);
    process.exitCode = 1;
  }
}
