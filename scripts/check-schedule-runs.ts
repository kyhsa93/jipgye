/**
 * 정기 실행 누락 탐지 (#322).
 *
 * 무엇을 재는가 — **「지난 N시간 창 안에 `daily-update` 의 `schedule` 실행이 몇 번 떴는가」** 하나다.
 * 그 수가 **`daily-update.yml` 의 cron 수**보다 적으면 종료 코드 1로 끝난다(= 워크플로가 빨개지고 실패 알림이 간다).
 *
 * 왜 「간격」이 아니라 「센다」인가 (#322 범위 2, cpo 실측):
 *   cron 은 23:07·03:07·07:07·11:07(UTC) 이라 간격이 `4·4·12·4` 다. 「마지막 성공으로부터 N시간」 규칙은
 *   정상 밤 구간(12h) + #294 가 정상으로 둔 지연(3~7h) = 19h 를 안 울려야 하고, 네 번 중 한 번이 버려진 날
 *   (간격 8h)에는 울어야 한다 — **19 < N ≤ 8 인 N 은 없다.** 세는 쪽은 어느 자리가 빠져도 잡고 지연에 둔감하다.
 *
 * 문턱 둘:
 *   - **창 28시간** — 고정 날짜가 아니라 **미끄러지는 창**이다(`--now` 에서 28시간 뒤로). 날짜 경계로 세면
 *     23:07 분이 자정을 넘어 밀릴 때 한 번 적게 세어진다(#322 cpo 경계 지적). 미끄러지는 창에는 그 자리가 없다.
 *     ⚠️ **24 가 아니라 28 인 이유는 실측이다.** #322 가 처방한 24시간으로 실제 이력(10-05~10-13, 10분 간격
 *     1,296 시점)에 돌리면 **118 시점이 운다**(최저 2) — cpo 가 「남는 거짓 경보 자리」로 미리 적어 둔 바로 그
 *     자리다(지연이 커지는 순간 어제 성공이 창 밖으로 밀린다). 그래서 **미리 승인된 길 ⓐ(창 26~28h)** 를 쓴다.
 *     같은 이력에서 25h→55 · 26h→30 · 27h→9 · **28h→0** 이고, 28h 는 2026-08-26 의 실제 누락은 그대로 잡는다.
 *   - **횟수 = cron 수** — 상수로 박지 않는다. 이 스크립트가 `--workflow` 가 가리키는 워크플로 파일의
 *     `on.schedule` 아래 `- cron:` 줄을 세어 쓴다(**자동 연동**). cron 이 늘면 문턱도 같이 는다.
 *     cron 블록을 못 찾거나 0개면 **4로 되돌아가지 않고 종료 코드 2로 죽는다** — 조용히 느슨해지는 것이
 *     이 이슈가 막으려는 바로 그 모양이다.
 *
 * 무엇을 세는가 — **축을 적는다.**
 *   - 시각 축: run 의 **`created_at`**(= GitHub 이 cron 틱으로 run 을 만든 시각). 이 저장소 실측에서
 *     `created_at` 과 `run_started_at` 은 255건 전부 같다(2026-10-15 확인, 아래 「재현」).
 *   - 창: `(now - 창시간, now]` — 시작은 열고 끝은 닫는다.
 *   - 집합(`--count`):
 *       `fired`(기본) = 창 안에 생긴 `schedule` run **전부**(결론 무관). 「방아쇠가 당겨졌는가」.
 *       `success`     = 그중 `conclusion === "success"` 인 것만.
 *     기본이 `fired` 인 이유는 실측이다(#322 PR 본문): `success` 로 세면 **지난 15일 중 5일**(10-01·10-03·
 *     10-06·10-09·10-10)이 울고, 그 날들은 **실행이 빠진 날이 아니라 실행이 실패한 날**이다 — 실패는 이미
 *     빨간 run 과 실패 메일로 시끄럽게 울고 있다. 조용한 누락을 잡으려고 세우는 장치가 이미 시끄러운 것을
 *     3분의 1의 날에 다시 울리면, #322 「비용」 절이 경계한 대로 **아무도 안 보게 되어 장치가 죽는다.**
 *     두 수는 **언제나 둘 다 출력한다** — 판정만 `--count` 가 고른다.
 *
 * 어디에서 도는가 — `.github/workflows/schedule-watchdog.yml`(별도 워크플로·별도 cron 둘).
 *   `daily-update` 안에 두면 그 실행이 안 뜰 때 탐지기도 안 뜬다(#322 완료 조건 4).
 *   한계도 같이 적는다: **별도 cron 도 버려질 수 있어 완전 자가면역은 없다.** 그 워크플로 머리 주석 참조.
 *
 * 사용:
 *   node scripts/check-schedule-runs.ts                       # GitHub API 조회, 지금 기준
 *   node scripts/check-schedule-runs.ts --runs-file runs.json --now 2026-08-27T04:00:00Z
 *   node scripts/check-schedule-runs.ts --count=success --window-hours=24
 *
 * 재현(이 저장소의 실행 이력을 파일로 내려 두고 돌리는 법):
 *   gh api "repos/kyhsa93/jipgye/actions/workflows/daily-update.yml/runs?event=schedule&per_page=100&page=1" \
 *     --jq '[.workflow_runs[] | {id, created_at, run_started_at, status, conclusion}]' > runs.json
 */

const API = "https://api.github.com";

/**
 * 워크플로 파일의 `on.schedule` 아래 `- cron:` 줄 수.
 * 블록을 못 찾거나 0개면 던진다 — 기본값으로 되돌아가지 않는다.
 */
export function countCrons(text, label = "워크플로") {
  const lines = text.split("\n");
  let onIndent = null;
  let schedIndent = null;
  let sawSchedule = false;
  let count = 0;

  for (const raw of lines) {
    if (raw.trim() === "") continue;
    const body = raw.trimStart();
    if (body.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;

    if (onIndent === null) {
      // YAML 1.1 에서 on 은 true 로도 읽히지만 여기서는 원문 글자만 본다.
      if (indent === 0 && /^(on|"on"|'on'|true):\s*(#.*)?$/.test(body)) onIndent = indent;
      continue;
    }
    if (schedIndent === null) {
      if (indent <= onIndent) break; // on: 블록이 끝났다
      // 값이 붙은 `schedule: x`(예: dispatch 입력 이름)는 안 센다 - 뒤에 아무것도 없는 줄만 본다.
      if (/^schedule:\s*(#.*)?$/.test(body)) {
        schedIndent = indent;
        sawSchedule = true;
      }
      continue;
    }
    if (indent <= schedIndent) break; // schedule: 블록이 끝났다
    if (/^-\s+cron:/.test(body)) count += 1;
  }

  if (!sawSchedule) throw new Error(`${label}: on.schedule 블록을 못 찾았다 - cron 수를 셀 수 없다`);
  if (count === 0) throw new Error(`${label}: on.schedule 아래 cron 이 0개다 - 문턱을 세울 수 없다`);
  return count;
}

/** ISO 문자열 → epoch ms. 못 읽으면 던진다(조용히 버리면 수가 줄어 거짓 경보가 된다). */
function at(run) {
  const v = run.created_at;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error(`run ${run.id ?? "?"}: created_at 을 못 읽었다 (${JSON.stringify(v)})`);
  return ms;
}

/**
 * 창 `(now - windowHours, now]` 안의 `schedule` run 을 센다.
 * 창 밖·다른 이벤트는 세지 않는다. 결과는 발화 수와 성공 수 둘 다 준다.
 */
export function countInWindow(runs, { now, windowHours }) {
  const end = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(end)) throw new Error(`--now 를 못 읽었다 (${JSON.stringify(now)})`);
  const start = end - windowHours * 3600 * 1000;

  const inWindow = runs.filter((r) => {
    if (r.event && r.event !== "schedule") return false;
    const t = at(r);
    return t > start && t <= end;
  });

  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    fired: inWindow.length,
    success: inWindow.filter((r) => r.conclusion === "success").length,
    runs: inWindow,
  };
}

/** 판정 하나. ok 가 false 면 호출자가 종료 코드 1로 끝낸다. */
export function verdict({ fired, success, expected, mode }) {
  const counted = mode === "success" ? success : fired;
  return {
    ok: counted >= expected,
    counted,
    mode,
    expected,
  };
}

/** GitHub API 에서 schedule run 100건(≈25일치)을 한 번에 받는다. 28시간 창에는 넘치고도 남는다. */
export async function fetchRuns({ repo, workflowFile, token, fetchImpl = fetch }) {
  const url = `${API}/repos/${repo}/actions/workflows/${workflowFile}/runs?event=schedule&per_page=100&page=1`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "jipgye-schedule-watchdog",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText} - ${url}`);
  const body: { workflow_runs?: unknown } = await res.json();
  if (!Array.isArray(body.workflow_runs)) throw new Error("GitHub API 응답에 workflow_runs 배열이 없다");
  return body.workflow_runs;
}

export function parseArgs(argv) {
  const opts = {
    workflow: ".github/workflows/daily-update.yml",
    windowHours: 28,
    count: "fired",
    now: null,
    runsFile: null,
    repo: process.env.GITHUB_REPOSITORY ?? "kyhsa93/jipgye",
  };
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`모르는 인자: ${a}`);
    const [, key, value] = m;
    if (key === "workflow") opts.workflow = value;
    else if (key === "window-hours") opts.windowHours = Number(value);
    else if (key === "count") opts.count = value;
    else if (key === "now") opts.now = value;
    else if (key === "runs-file") opts.runsFile = value;
    else if (key === "repo") opts.repo = value;
    else throw new Error(`모르는 옵션: --${key}`);
  }
  if (!Number.isFinite(opts.windowHours) || opts.windowHours <= 0) throw new Error(`--window-hours 가 양수가 아니다: ${opts.windowHours}`);
  if (opts.count !== "fired" && opts.count !== "success") throw new Error(`--count 는 fired 또는 success 다: ${opts.count}`);
  return opts;
}

export async function main(
  argv: string[],
  { readFile, log = console.log, error = console.error }: { readFile?: (path: string, encoding: "utf8") => Promise<string>; log?: (message: string) => void; error?: (message: string) => void } = {},
) {
  const opts: number = parseArgs(argv);
  const expected = countCrons(await readFile(opts.workflow, "utf8"), opts.workflow);

  const runs = opts.runsFile
    ? JSON.parse(await readFile(opts.runsFile, "utf8"))
    : await fetchRuns({ repo: opts.repo, workflowFile: opts.workflow.split("/").pop(), token: process.env.GITHUB_TOKEN });

  const win = countInWindow(runs, { now: opts.now ?? Date.now(), windowHours: opts.windowHours });
  const v = verdict({ fired: win.fired, success: win.success, expected, mode: opts.count });

  log(`창: ${win.start} ~ ${win.end} (${opts.windowHours}시간, created_at 축, 끝만 포함)`);
  log(`문턱: ${expected} (${opts.workflow} 의 cron 수에서 자동으로 센 것)`);
  log(`창 안 schedule 발화 ${win.fired} · 그중 성공 ${win.success} · 판정 기준 ${opts.count}=${v.counted}`);
  for (const r of win.runs) log(`  - ${r.created_at} ${r.conclusion ?? r.status ?? "?"} ${r.id ?? ""}`);

  if (!v.ok) {
    error(
      `::error::daily-update 정기 실행 누락 - 지난 ${opts.windowHours}시간의 schedule ${opts.count} 가 ${v.counted}회로 문턱 ${expected}(cron 수)에 못 미친다. ` +
        `GitHub 이 cron 틱을 버렸을 수 있다. Actions 에서 Daily update 를 mode=full 로 한 번 돌리고, 계속 모자라면 #322 에 적는다`,
    );
    return 1;
  }
  log("합격 - 창 안에 cron 수만큼 떴다");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile } = await import("node:fs/promises");
  process.exitCode = await main(process.argv.slice(2), { readFile }).catch((e) => {
    console.error(`::error::탐지기가 돌지 못했다 - ${e.message}`);
    return 2;
  });
}
