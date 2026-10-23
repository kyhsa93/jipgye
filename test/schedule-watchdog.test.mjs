import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { MISSING_CHECK_WINDOW_HOURS, countCrons, countInWindow, parseArgs, verdict } from "../scripts/check-schedule-runs.ts";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts/check-schedule-runs.ts");

/**
 * 이 파일은 **고정 입력만 읽는다** - 네트워크도, 오늘 날짜도 보지 않는다(#8: 데이터·날짜에 따라
 * 갈리는 검사는 `npm test` 에 넣지 않는다). 실제 실행 이력에 대고 도는 대조군은 PR 증빙 쪽이다.
 */

// ── cron 수 세기 (문턱의 출처) ──────────────────────────────────────────────

test("daily-update.yml 의 cron 은 지금 1개다 - 이 수가 문턱이 된다 (#506: 뉴스 하루 1회)", async () => {
  // ⚠️ 못박아 둔 수다. cron 을 늘리거나 줄이면 이 시험이 실패해 **사람에게 알린다.**
  // 장치(scripts/check-schedule-runs.ts)는 이 시험을 기다리지 않고 파일을 다시 세어 바로 따라간다 -
  // 자동 연동이 본체고, 이 줄은 변경을 소리나게 하는 표식이다(#322 완료 조건 1).
  const text = await readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8");
  assert.equal(countCrons(text), 1);
});

test("cron 을 하나 더하면 세어지는 수도 같이 는다", () => {
  const four = `name: x\non:\n  schedule:\n    - cron: "7 23 * * *"\n    - cron: "7 3 * * *"\n    - cron: "7 7 * * *"\n    - cron: "7 11 * * *"\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-latest\n`;
  assert.equal(countCrons(four), 4);
  const five = four.replace('    - cron: "7 11 * * *"\n', '    - cron: "7 11 * * *"\n    - cron: "7 15 * * *"\n');
  assert.equal(countCrons(five), 5);
});

test("on.schedule 밖의 cron·schedule 은 안 센다", () => {
  // dispatch 입력 이름이 schedule 이고 값이 붙은 줄, 그리고 jobs 아래의 cron 글자.
  const text = [
    "name: x",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      schedule: dummy",
    "  schedule:",
    '    - cron: "7 23 * * *"',
    "jobs:",
    "  a:",
    "    steps:",
    '      - run: echo "- cron: 7 1 * * *"',
    "",
  ].join("\n");
  assert.equal(countCrons(text), 1);
});

test("주석으로 막아 둔 cron 은 안 센다", () => {
  const text = `name: x\non:\n  schedule:\n    - cron: "7 23 * * *"\n    # - cron: "7 3 * * *"\njobs:\n  a: {}\n`;
  assert.equal(countCrons(text), 1);
});

test("schedule 블록이 없거나 비면 4로 되돌아가지 않고 던진다", () => {
  assert.throws(() => countCrons("name: x\non:\n  workflow_dispatch:\njobs:\n  a: {}\n"), /on\.schedule 블록을 못 찾았다/);
  assert.throws(() => countCrons("name: x\non:\n  schedule:\njobs:\n  a: {}\n"), /on\.schedule 블록을 못 찾았다|cron 이 0개다/);
});

// ── 창 세기 ────────────────────────────────────────────────────────────────

const run = (created_at, conclusion = "success", extra = {}) => ({ id: created_at, created_at, conclusion, status: "completed", event: "schedule", ...extra });

test("창은 (now-24h, now] - 시작은 열고 끝은 닫는다", () => {
  const now = "2026-10-15T00:00:00Z";
  const runs = [
    run("2026-10-13T23:59:59Z"), // 창 밖
    run("2026-10-14T00:00:00Z"), // 경계 정각 = 창 밖(열린 쪽)
    run("2026-10-14T00:00:01Z"), // 창 안
    run("2026-10-15T00:00:00Z"), // 경계 정각 = 창 안(닫힌 쪽)
  ];
  const w = countInWindow(runs, { now, windowHours: 24 });
  assert.equal(w.fired, 2);
  assert.deepEqual(
    w.runs.map((r) => r.created_at),
    ["2026-10-14T00:00:01Z", "2026-10-15T00:00:00Z"],
  );
});

test("미끄러지는 창이라 날짜 경계에서 수가 깎이지 않는다", () => {
  // 23:07 틱이 매일 자정을 넘겨 다음 날 00:30 에 뜨는 모양. 고정 날짜로 「그날의 네 틱」을 세려 들면
  // 한 번이 다음 칸으로 넘어가 3으로 보이지만, 미끄러지는 창에는 그 자리가 없다.
  const runs = [];
  for (const d of [12, 13, 14, 15]) {
    const dd = String(d).padStart(2, "0");
    const next = String(d + 1).padStart(2, "0");
    runs.push(run(`2026-10-${dd}T03:07:00Z`), run(`2026-10-${dd}T07:07:00Z`), run(`2026-10-${dd}T11:07:00Z`), run(`2026-10-${next}T00:30:00Z`));
  }
  // 10분 간격으로 하루를 훑어도 한 번도 4 아래로 안 내려간다.
  const base = Date.parse("2026-10-14T00:00:00Z");
  let lowest = Infinity;
  for (let i = 0; i <= 144; i += 1) lowest = Math.min(lowest, countInWindow(runs, { now: base + i * 600000, windowHours: 24 }).fired);
  assert.equal(lowest, 4);
});

test("발화와 성공을 따로 센다", () => {
  const runs = [
    run("2026-10-14T03:00:00Z", "success"),
    run("2026-10-14T07:00:00Z", "failure"),
    run("2026-10-14T11:00:00Z", "success"),
    run("2026-10-14T23:00:00Z", null, { status: "in_progress" }),
  ];
  const w = countInWindow(runs, { now: "2026-10-15T00:00:00Z", windowHours: 24 });
  assert.equal(w.fired, 4);
  assert.equal(w.success, 2);
});

test("schedule 이 아닌 실행은 안 센다 - dispatch 로 수를 채울 수 없다", () => {
  const runs = [
    run("2026-10-14T03:00:00Z"),
    run("2026-10-14T07:00:00Z"),
    { ...run("2026-10-14T09:00:00Z"), event: "workflow_dispatch" },
    { ...run("2026-10-14T10:00:00Z"), event: "workflow_dispatch" },
  ];
  assert.equal(countInWindow(runs, { now: "2026-10-15T00:00:00Z", windowHours: 24 }).fired, 2);
});

test("created_at 을 못 읽으면 조용히 버리지 않고 던진다", () => {
  assert.throws(() => countInWindow([{ id: 1, created_at: "어제", event: "schedule" }], { now: "2026-10-15T00:00:00Z", windowHours: 24 }), /created_at 을 못 읽었다/);
});

// ── 판정 ───────────────────────────────────────────────────────────────────

test("문턱 미만이면 떨어지고 같거나 많으면 통과한다", () => {
  assert.equal(verdict({ fired: 3, success: 3, expected: 4, mode: "fired" }).ok, false);
  assert.equal(verdict({ fired: 4, success: 4, expected: 4, mode: "fired" }).ok, true);
  assert.equal(verdict({ fired: 5, success: 5, expected: 4, mode: "fired" }).ok, true);
});

test("--count 가 보는 수를 바꾼다", () => {
  const w = { fired: 4, success: 3, expected: 4 };
  assert.equal(verdict({ ...w, mode: "fired" }).ok, true);
  assert.equal(verdict({ ...w, mode: "success" }).ok, false);
});

test("기본 창은 MISSING_CHECK_WINDOW_HOURS 고, 정상 최대 간격 24h + 지연 7h = 31h 보다 길다 (#506)", () => {
  // cron 넷이던 때(#322)는 24h 처방이 실측에서 118 시점 거짓 경보라 28h 를 골랐다(옛 근거).
  // cron 이 하나뿐인 지금의 하한은 31h 이고, 36 은 cto 판정 2026-10-23(지연 최대 7.8h, 간격 21.1~28.9h, 24h 는 거짓 경보·28~40h 는 0)이다 - 값은 상수 한 줄이고, 이 시험은 하한만 못박는다.
  assert.equal(parseArgs([]).windowHours, MISSING_CHECK_WINDOW_HOURS);
  assert.ok(MISSING_CHECK_WINDOW_HOURS > 24 + 7, `창 ${MISSING_CHECK_WINDOW_HOURS}h 가 정상 최대 간격 24h + 지연 7h 이하다 - 지연 하나에 거짓 경보가 난다`);
  assert.equal(parseArgs([]).count, "fired");
});

test("인자를 모르면 멈춘다", () => {
  assert.deepEqual(parseArgs(["--window-hours=26", "--count=success"]).windowHours, 26);
  assert.throws(() => parseArgs(["--count=maybe"]), /--count 는 fired 또는 success/);
  assert.throws(() => parseArgs(["--window-hours=0"]), /양수가 아니다/);
  assert.throws(() => parseArgs(["--nope"]), /모르는 옵션/);
});

// ── 종료 코드 (실제로 우는가 / 안 우는가) ──────────────────────────────────

const yml = (crons) => `name: d\non:\n  schedule:\n${crons.map((c) => `    - cron: "${c}"\n`).join("")}  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-latest\n`;

async function bed(runs, crons = ["7 23 * * *", "7 3 * * *", "7 7 * * *", "7 11 * * *"]) {
  const dir = await mkdtemp(path.join(tmpdir(), "sw-"));
  const runsFile = path.join(dir, "runs.json");
  const wf = path.join(dir, "daily-update.yml");
  await writeFile(runsFile, JSON.stringify(runs));
  await writeFile(wf, yml(crons));
  return { runsFile, wf };
}

const call = (args) => spawnSync("node", [script, ...args], { encoding: "utf8" });

const FOUR = ["2026-10-14T03:07:00Z", "2026-10-14T07:07:00Z", "2026-10-14T11:07:00Z", "2026-10-14T23:07:00Z"].map((t) => run(t));

test("창 안 schedule 성공이 3이면 종료 코드 1로 운다 (#322 완료 조건 2)", async () => {
  const { runsFile, wf } = await bed(FOUR.slice(0, 3));
  const r = call([`--runs-file=${runsFile}`, `--workflow=${wf}`, "--now=2026-10-15T02:00:00Z"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /::error::daily-update 정기 실행 누락/);
  assert.match(r.stdout, /발화 3 · 그중 성공 3/);
});

test("창 안에 네 번 다 있으면 종료 코드 0으로 조용하다 (#322 완료 조건 3)", async () => {
  const { runsFile, wf } = await bed(FOUR);
  const r = call([`--runs-file=${runsFile}`, `--workflow=${wf}`, "--now=2026-10-15T02:00:00Z"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
});

test("cron 이 다섯이 되면 같은 네 번짜리 입력이 그때부터 운다 - 4 ↔ cron 연동", async () => {
  const five = ["7 23 * * *", "7 3 * * *", "7 7 * * *", "7 11 * * *", "7 15 * * *"];
  const { runsFile, wf } = await bed(FOUR, five);
  const r = call([`--runs-file=${runsFile}`, `--workflow=${wf}`, "--now=2026-10-15T02:00:00Z"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /문턱: 5/);
});

// ── cron 하나(#506): 거짓 경보 없음 / 진짜 경보 ────────────────────────────

const ONE = ["7 23 * * *"];

test("cron 하나 - 직전 run 이 정상 최대 지연(24h + 7h = 31h 전)이어도 안 운다 (#506)", async () => {
  // 다음 run 이 7시간 늦어 아직 안 뜬 순간: 직전 run 은 now 에서 31h - 1분 전.
  const now = "2026-10-15T06:06:00Z";
  const { runsFile, wf } = await bed([run("2026-10-14T23:07:00Z"), run("2026-10-13T23:07:00Z")], ONE);
  const r = call([`--runs-file=${runsFile}`, `--workflow=${wf}`, `--now=${now}`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /문턱: 1 /);
  assert.equal(r.stderr, "");
});

test("cron 하나 - 창 안에 run 이 0이면 종료 코드 1로 운다 (#506)", async () => {
  // 직전 run 이 창보다 오래됐다: 하루가 통째로 빠지고 지연까지 겹친 모양.
  const { runsFile, wf } = await bed([run("2026-10-12T23:07:00Z")], ONE);
  const r = call([`--runs-file=${runsFile}`, `--workflow=${wf}`, "--now=2026-10-15T06:06:00Z"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /::error::daily-update 정기 실행 누락/);
  assert.match(r.stdout, /창 안 schedule 발화 0 /);
});

test("cron 블록이 없으면 4로 되돌아가지 않고 종료 코드 2로 죽는다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sw-"));
  const wf = path.join(dir, "no-cron.yml");
  const runsFile = path.join(dir, "runs.json");
  await writeFile(wf, "name: d\non:\n  workflow_dispatch:\njobs:\n  a: {}\n");
  await writeFile(runsFile, JSON.stringify(FOUR));
  const r = call([`--runs-file=${runsFile}`, `--workflow=${wf}`, "--now=2026-10-15T02:00:00Z"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /탐지기가 돌지 못했다/);
});

test("지연으로 늦게 와도 창 안에 들어오면 안 운다", async () => {
  // 네 번이 전부 6~7시간씩 밀린 모양(#294 가 정상으로 둔 폭).
  const late = ["2026-10-14T09:30:00Z", "2026-10-14T14:10:00Z", "2026-10-14T17:50:00Z", "2026-10-15T05:40:00Z"].map((t) => run(t));
  const { runsFile, wf } = await bed(late);
  const r = call([`--runs-file=${runsFile}`, `--workflow=${wf}`, "--now=2026-10-15T06:00:00Z"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ── 워크플로 자리 (완료 조건 4) ────────────────────────────────────────────

test("탐지기는 daily-update·summarize 밖의 별도 워크플로에서, 자기 cron 둘로 돈다", async () => {
  const dir = path.join(root, ".github/workflows");
  const watchdog = await readFile(path.join(dir, "schedule-watchdog.yml"), "utf8");
  assert.equal(countCrons(watchdog), 2, "한 틱이 버려져도 다음 틱이 덮게 둘 이상이어야 한다");
  assert.match(watchdog, /node scripts\/check-schedule-runs\.ts/);
  assert.match(watchdog, /actions: read/, "다른 워크플로의 run 목록을 읽을 권한");

  for (const f of ["daily-update.yml", "summarize.yml", "test.yml"]) {
    const text = await readFile(path.join(dir, f), "utf8");
    assert.doesNotMatch(text, /check-schedule-runs\.(?:mjs|ts)/, `${f} 안에 두면 그 실행이 안 뜰 때 탐지기도 안 뜬다 (#322 완료 조건 4)`);
  }
});

test("탐지기 cron 은 daily-update 의 cron 과 같은 시각이 아니다", async () => {
  const dir = path.join(root, ".github/workflows");
  const crons = async (f) => [...(await readFile(path.join(dir, f), "utf8")).matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  const mine = await crons("schedule-watchdog.yml");
  const daily = await crons("daily-update.yml");
  assert.equal(mine.filter((c) => daily.includes(c)).length, 0, "같은 틱에 몰리면 같은 지연·같은 버림을 맞는다");
});
