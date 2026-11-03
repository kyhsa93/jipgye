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
 * 갈리는 검사는 `npm test` 에 넣지 않는다). 실제 실행 이력에 대고 도는 대조군은 PR 증빙 쪽이고, #822 재생만 동결한 이력을 고정 입력으로 읽는다.
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

// ── 「뜨지만 매번 실패」: 창 안 성공이 0이면 운다 (#499, #449 의 449-B) ─────────
// 위 검사는 「떴는가」만 센다. 이쪽은 `--check=success` 로 「성공이 있는가」만 본다 - 문턱은 cron 수가 아니라 1회, 창은 54시간이다.
// 합성 입력만 읽는다(네트워크·오늘 날짜 없음). 실제 이력 재생은 PR 증빙 쪽이다.

import { SUCCESS_CHECK_WINDOW_HOURS, successVerdict } from "../scripts/check-schedule-runs.ts";

const NOW = "2026-10-20T10:00:00Z";
const ago = (hours) => new Date(Date.parse(NOW) - hours * 3600 * 1000).toISOString();
const callSuccess = async (runs, extra = []) => {
  const { runsFile, wf } = await bed(runs);
  return call(["--check=success", `--runs-file=${runsFile}`, `--workflow=${wf}`, `--now=${NOW}`, ...extra]);
};

test("success 검사 - 창 안에 run 은 있지만 성공이 0이면 종료 코드 1로 운다", async () => {
  const r = await callSuccess([run(ago(50), "failure"), run(ago(26), "failure"), run(ago(2), "failure")]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /::error::daily-update 정기 실행이 뜨지만 성공이 없다/);
  assert.match(r.stdout, /발화 3 · 그중 성공 0/);
});

test("success 검사 - 성공이 하나라도 있으면 종료 코드 0으로 조용하다 (단발·연속 실패라도 직전 성공이 창 안이면)", async () => {
  // 단발 실패: 직전 성공 26h 전 + 방금 실패. 빨간 run 이 이미 울고, 이 장치는 안 운다.
  const single = await callSuccess([run(ago(26), "success"), run(ago(2), "failure")]);
  assert.equal(single.status, 0, single.stdout + single.stderr);
  assert.equal(single.stderr, "");
  // 이틀째 실패 직전: 마지막 성공이 창 끝 가까이(53h 전)여도 안 운다.
  const edge = await callSuccess([run(ago(53), "success"), run(ago(29), "failure"), run(ago(5), "failure")]);
  assert.equal(edge.status, 0, edge.stdout + edge.stderr);
  assert.match(edge.stdout, /발화 3 · 그중 성공 1/);
});

test("success 검사 - 창 경계: 54시간 정각 전 성공은 창 밖이라 울고, 1분 안쪽이면 안 운다", async () => {
  assert.equal(SUCCESS_CHECK_WINDOW_HOURS, 54);
  const out = await callSuccess([run(ago(54), "success"), run(ago(30), "failure"), run(ago(6), "failure")]);
  assert.equal(out.status, 1, out.stdout + out.stderr); // (now-54h, now] - 시작은 열려 있다
  const inside = await callSuccess([run(new Date(Date.parse(ago(54)) + 60000).toISOString(), "success"), run(ago(6), "failure")]);
  assert.equal(inside.status, 0, inside.stdout + inside.stderr);
});

test("success 검사 - 실행 중·취소·dispatch 의 성공은 성공으로 세지 않는다", async () => {
  const runs = [
    run(ago(40), "cancelled"),
    run(ago(30), "skipped"),
    run(ago(20), null, { status: "in_progress" }),
    { ...run(ago(10), "success"), event: "workflow_dispatch" }, // 수동 dispatch 로 경보를 덮을 수 없다
  ];
  const r = await callSuccess(runs);
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test("success 검사 - run 이 하나도 없어도 운다 (0 = 성공 0)", async () => {
  const r = await callSuccess([]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /발화 0 · 그중 성공 0/);
});

test("success 검사 - cron 수와 무관하다: cron 이 없는 워크플로 파일이어도 죽지 않고 성공 수만 본다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sw-"));
  const wf = path.join(dir, "no-cron.yml");
  const runsFile = path.join(dir, "runs.json");
  await writeFile(wf, "name: d\non:\n  workflow_dispatch:\njobs:\n  a: {}\n");
  await writeFile(runsFile, JSON.stringify([run(ago(10), "success")]));
  const r = call(["--check=success", `--runs-file=${runsFile}`, `--workflow=${wf}`, `--now=${NOW}`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("success 검사 - --window-hours 가 기본 창을 덮고, 기본 검사의 창은 그대로다", () => {
  assert.equal(parseArgs(["--check=success"]).windowHours, SUCCESS_CHECK_WINDOW_HOURS);
  assert.equal(parseArgs(["--check=success", "--window-hours=30"]).windowHours, 30);
  assert.equal(parseArgs([]).check, "missing");
  assert.equal(parseArgs([]).windowHours, parseArgs(["--check=missing"]).windowHours, "success 창이 첫 검사의 기본 창으로 새지 않는다");
  assert.notEqual(parseArgs([]).windowHours, SUCCESS_CHECK_WINDOW_HOURS);
  assert.throws(() => parseArgs(["--check=maybe"]), /--check 는 missing·success·deploy 중 하나다/);
  assert.deepEqual(successVerdict({ success: 0 }), { ok: false, counted: 0, expected: 1 });
  assert.equal(successVerdict({ success: 1 }).ok, true);
});

test("success 창 54h 는 daily-update 정상 최대 간격의 두 배보다 길다 - cron 이 바뀌면 소리 난다 (#499, cto: 54 > 2×24)", async () => {
  // 첫 검사의 「cron 은 지금 N개다」 표식과 짝이다. 여기서는 cron 시각에서 최대 간격을 직접 구해,
  // 간격이 늘어(예: 하루 1회 → 이틀 1회) 54h 가 단발 실패에 울게 되거나 줄어 창이 낭비되는 변경을 막는다.
  const text = await readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8");
  const hours = [...text.matchAll(/- cron: "(\d+) (\d+) \* \* \*"/g)].map((m) => Number(m[2]) + Number(m[1]) / 60).sort((a, b) => a - b);
  assert.equal(hours.length, countCrons(text), "하루 1회 이상 꼴(`M H * * *`)이 아닌 cron 이 있다 - 최대 간격을 못 구한다. cto 재판정");
  const gaps = hours.map((h, i) => (i === hours.length - 1 ? hours[0] + 24 - h : hours[i + 1] - h));
  const maxGap = Math.max(...gaps);
  assert.ok(SUCCESS_CHECK_WINDOW_HOURS > 2 * maxGap, `창 ${SUCCESS_CHECK_WINDOW_HOURS}h 가 정상 최대 간격 ${maxGap}h 의 두 배 이하다 - 단발 실패에 운다`);
  assert.ok(SUCCESS_CHECK_WINDOW_HOURS <= 62, "cto 판정의 상한(이틀 연속 실패를 둘째 점검 안에 잡는 한계 약 62h)을 넘었다");
});

test("워치독 워크플로는 success 검사 스텝을 두고, 앞 스텝이 실패해도 돈다", async () => {
  const watchdog = await readFile(path.join(root, ".github/workflows/schedule-watchdog.yml"), "utf8");
  assert.match(watchdog, /run: node scripts\/check-schedule-runs\.ts --check=success\n/);
  assert.match(watchdog, /if: \$\{\{ !cancelled\(\) \}\}\n\s+env:\n\s+GITHUB_TOKEN:[^\n]*\n\s+run: node scripts\/check-schedule-runs\.ts --check=success/, "앞 스텝이 실패해도 돌아야 두 경보가 서로를 가리지 않는다");
  assert.match(watchdog, /run: node scripts\/check-schedule-runs\.ts\n/, "첫 검사 스텝은 그대로 남아 있다");
});

// ── 「배포가 조용히 멈춤」: Deploy site 의 창 안 성공이 0이면 운다 (#530, 부모 #505) ─────
// `--check=deploy`. Daily 가 초록이어도 deploy.yml 이 멈추면 사이트가 낡아 간다. push·workflow_run 만 세고(dispatch 는 롤백 전용), 취소는 성공도 실패도 아니다.
// 합성 입력만 읽는다(네트워크·오늘 날짜 없음).

import { DEPLOY_CHECK_WINDOW_HOURS, DEPLOY_EVENTS, DEPLOY_WORKFLOW, fetchRuns } from "../scripts/check-schedule-runs.ts";

const dep = (hours, conclusion = "success", event = "push", extra = {}) => run(ago(hours), conclusion, { event, ...extra });
const callDeploy = async (runs, extra = []) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sw-"));
  const runsFile = path.join(dir, "runs.json");
  await writeFile(runsFile, JSON.stringify(runs));
  // --workflow 를 안 준다: 배포 검사는 deploy.yml 을 기본으로 안다(--runs-file 이면 읽지 않으므로 cron 이 없어도 죽지 않아야 한다).
  return call(["--check=deploy", `--runs-file=${runsFile}`, `--now=${NOW}`, ...extra]);
};

test("deploy 검사 - 창 안에 run 은 있지만 성공이 0이면 종료 코드 1로 운다 (완료 조건 1)", async () => {
  const r = await callDeploy([dep(40, "failure"), dep(20, "failure", "workflow_run"), dep(2, "failure")]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /::error::Deploy site 가 멈춘 것 같다/);
  assert.match(r.stdout, /Deploy site 실행 3 · 그중 성공 0/);
});

test("deploy 검사 - 마지막 성공이 창을 넘기면 운다, 창 안이면 조용하다 (완료 조건 1·2)", async () => {
  // 성공은 있지만 60h 전이고 그 뒤로는 전부 실패·취소·진행 중: 창(54h) 밖이라 운다.
  const stale = await callDeploy([dep(60, "success"), dep(30, "failure", "workflow_run"), dep(10, "cancelled"), dep(1, null, "push", { status: "in_progress" })]);
  assert.equal(stale.status, 1, stale.stdout + stale.stderr);
  // 같은 모양에서 마지막 성공만 50h 전으로: 창 안이라 조용하다.
  const fresh = await callDeploy([dep(50, "success"), dep(30, "failure", "workflow_run"), dep(10, "cancelled"), dep(1, null, "push", { status: "in_progress" })]);
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  assert.equal(fresh.stderr, "");
  assert.match(fresh.stdout, /합격/);
});

test("deploy 검사 - 취소된 run 이 최신이어도 창 안 성공이 있으면 안 운다 (취소는 실패가 아니다)", async () => {
  // deploy.yml 은 cancel-in-progress: false 라 대기 중 실행이 최신 것에 밀려 cancelled 로 끝난다 - 정상이다.
  const r = await callDeploy([dep(5, "success"), dep(3, "cancelled", "workflow_run"), dep(1, "cancelled"), dep(0.5, "skipped", "workflow_run")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /Deploy site 실행 4 · 그중 성공 1/);
});

test("deploy 검사 - 취소·건너뜀·진행 중뿐이면 성공 0이라 운다 (취소를 성공으로 세지 않는다)", async () => {
  const r = await callDeploy([dep(40, "cancelled"), dep(30, "skipped", "workflow_run"), dep(2, null, "push", { status: "in_progress" })]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test("deploy 검사 - workflow_dispatch(롤백 전용)의 성공은 경보를 덮지 못한다", async () => {
  const r = await callDeploy([dep(3, "success", "workflow_dispatch"), dep(2, "success", "workflow_dispatch")]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Deploy site 실행 0 /);
  // 자연 경로(push·workflow_run)의 성공은 각각 따로 센다.
  assert.equal((await callDeploy([dep(3, "success", "workflow_run")])).status, 0);
  assert.equal((await callDeploy([dep(3, "success", "push")])).status, 0);
  assert.deepEqual(DEPLOY_EVENTS, ["push", "workflow_run"]);
});

test("deploy 검사 - schedule 이벤트는 세지 않는다 (daily-update 검사와 섞이지 않는다)", async () => {
  const r = await callDeploy([dep(3, "success", "schedule")]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test("deploy 검사 - run 이 하나도 없어도 운다", async () => {
  const r = await callDeploy([]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Deploy site 실행 0 · 그중 성공 0/);
});

test("deploy 검사 - 창 경계: 54시간 정각 전 성공은 창 밖이라 울고, 1분 안쪽이면 안 운다", async () => {
  assert.equal(DEPLOY_CHECK_WINDOW_HOURS, 54);
  assert.equal((await callDeploy([dep(54, "success"), dep(6, "failure")])).status, 1);
  assert.equal((await callDeploy([dep(54 - 1 / 60, "success"), dep(6, "failure")])).status, 0);
});

test("deploy 검사 - 기본 워크플로·창은 deploy 몫이고 다른 검사로 새지 않는다", () => {
  const d = parseArgs(["--check=deploy"]);
  assert.equal(d.workflow, DEPLOY_WORKFLOW);
  assert.equal(d.workflow, ".github/workflows/deploy.yml");
  assert.equal(d.windowHours, DEPLOY_CHECK_WINDOW_HOURS);
  assert.equal(parseArgs(["--check=deploy", "--window-hours=30"]).windowHours, 30);
  assert.equal(parseArgs(["--check=deploy", "--workflow=x.yml"]).workflow, "x.yml");
  assert.equal(parseArgs([]).workflow, ".github/workflows/daily-update.yml", "기본 검사의 워크플로가 deploy 로 새지 않는다");
  assert.equal(parseArgs(["--check=success"]).workflow, ".github/workflows/daily-update.yml");
});

test("deploy 검사 - API 조회에 event=schedule 을 걸지 않는다 (Deploy site 에는 schedule run 이 없다)", async () => {
  const urls = [];
  const stub = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ workflow_runs: [] }) };
  };
  await fetchRuns({ repo: "o/r", workflowFile: "deploy.yml", fetchImpl: stub, event: null });
  await fetchRuns({ repo: "o/r", workflowFile: "daily-update.yml", fetchImpl: stub });
  assert.match(urls[0], /\/workflows\/deploy\.yml\/runs\?per_page=100/);
  assert.doesNotMatch(urls[0], /event=/);
  assert.match(urls[1], /\/workflows\/daily-update\.yml\/runs\?event=schedule&per_page=100/, "기존 두 검사의 URL 은 그대로다");
});

test("deploy 창 54h 는 daily-update 정상 최대 간격의 두 배보다 길고 상한 62h 이하다 - cron 이 바뀌면 소리 난다 (#530)", async () => {
  const text = await readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8");
  const hours = [...text.matchAll(/- cron: "(\d+) (\d+) \* \* \*"/g)].map((m) => Number(m[2]) + Number(m[1]) / 60).sort((a, b) => a - b);
  assert.equal(hours.length, countCrons(text), "하루 1회 이상 꼴(`M H * * *`)이 아닌 cron 이 있다 - 최대 간격을 못 구한다. cto 재판정");
  const gaps = hours.map((h, i) => (i === hours.length - 1 ? hours[0] + 24 - h : hours[i + 1] - h));
  const maxGap = Math.max(...gaps);
  assert.ok(DEPLOY_CHECK_WINDOW_HOURS > 2 * maxGap, `창 ${DEPLOY_CHECK_WINDOW_HOURS}h 가 정상 최대 간격 ${maxGap}h 의 두 배 이하다 - 단발 실패에 운다`);
  assert.ok(DEPLOY_CHECK_WINDOW_HOURS <= 62, "이틀 연속 실패를 둘째 점검 안에 잡는 한계 약 62h 를 넘었다");
});

test("deploy.yml 의 워크플로 이름은 Deploy site 고, 워치독은 deploy 검사 스텝을 `!cancelled()` 로 둔다", async () => {
  const deploy = await readFile(path.join(root, ".github/workflows/deploy.yml"), "utf8");
  assert.match(deploy, /^name: Deploy site$/m);
  const watchdog = await readFile(path.join(root, ".github/workflows/schedule-watchdog.yml"), "utf8");
  assert.match(watchdog, /if: \$\{\{ !cancelled\(\) \}\}\n\s+env:\n\s+GITHUB_TOKEN:[^\n]*\n\s+run: node scripts\/check-schedule-runs\.ts --check=deploy\n/, "앞 스텝이 실패해도 돌아야 세 경보가 서로를 가리지 않는다");
  assert.match(watchdog, /run: node scripts\/check-schedule-runs\.ts --check=success\n/, "둘째 스텝은 그대로 남아 있다");
  assert.match(watchdog, /run: node scripts\/check-schedule-runs\.ts\n/, "첫 검사 스텝은 그대로 남아 있다");
  assert.match(watchdog, /permissions:\n  contents: read\n  actions: read\n/, "권한은 읽기 둘 그대로다");
});

test("deploy 검사 - main 이 API 경로에서 deploy.yml 을 이벤트 필터 없이 부르고, 그 결과로 판정한다", async () => {
  const { main } = await import("../scripts/check-schedule-runs.ts");
  const urls = [];
  const realFetch = globalThis.fetch;
  const body = (runs) => async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ workflow_runs: runs }) };
  };
  const sink = { log: () => {}, error: () => {} };
  try {
    globalThis.fetch = body([dep(3, "success", "workflow_run")]);
    assert.equal(await main(["--check=deploy", `--now=${NOW}`], sink), 0);
    globalThis.fetch = body([dep(3, "failure", "workflow_run")]);
    assert.equal(await main(["--check=deploy", `--now=${NOW}`], sink), 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  for (const u of urls) {
    assert.match(u, /\/workflows\/deploy\.yml\/runs\?per_page=100/);
    assert.doesNotMatch(u, /event=/, "event=schedule 을 걸면 Deploy site 는 늘 0 이라 영구 거짓 경보가 된다");
  }
});

// ── 「Deploy site 연속 2회 실패」: 같은 `--check=deploy` 의 둘째 규칙 (#822) ─────
// 10-30 사고: 빨간 run 4번·사이트 49.1h 정지인데 54h 창 아래라 안 울었다. 합성 입력 + 동결한 실제 이력만 읽는다(네트워크·오늘 날짜 없음).

import { DEPLOY_FAILURE_CONCLUSIONS, DEPLOY_FAILURE_STREAK, deployFailureStreak } from "../scripts/check-schedule-runs.ts";

const streakOf = (runs, now = NOW) => deployFailureStreak(runs, { now }).count;

test("연속 2회 - 창 안에 성공이 있어도 성공 뒤 실패가 둘이면 운다. 54h 경보와 문구가 다르다", async () => {
  const r = await callDeploy([dep(5, "success"), dep(3, "failure", "workflow_run"), dep(2.5, "failure", "workflow_run")]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /::error::Deploy site 연속 2회 실패/);
  assert.doesNotMatch(r.stderr, /멈춘 것 같다/);
  assert.match(r.stdout, /이어진 실패 2회 · 문턱: 2회/);
  assert.equal(DEPLOY_FAILURE_STREAK, 2);
});

test("연속 2회 - 단발 실패는 안 운다, 실패 뒤 성공이 오면 앞의 실패가 몇 번이든 안 운다", async () => {
  const single = await callDeploy([dep(5, "success"), dep(1, "failure")]);
  assert.equal(single.status, 0, single.stdout + single.stderr);
  assert.equal(single.stderr, "");
  const recovered = await callDeploy([dep(9, "success"), dep(8, "failure"), dep(7, "failure"), dep(6, "failure"), dep(1, "success")]);
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  // 복구 뒤 새 단발 실패 하나: 복구 전 실패와 합치지 않는다.
  assert.equal(streakOf([dep(8, "failure"), dep(7, "failure"), dep(6, "success"), dep(1, "failure")]), 1);
});

test("연속 2회 - 입력 순서가 아니라 created_at 순이다, 같은 초면 id 로 가른다", () => {
  assert.equal(streakOf([dep(1, "failure"), dep(5, "success"), dep(3, "failure")]), 2);
  assert.equal(streakOf([dep(1, "success"), dep(5, "failure"), dep(3, "failure")]), 0);
  const t = ago(1);
  const same = [run(t, "failure", { id: 12, event: "push" }), run(t, "success", { id: 11, event: "push" }), run(ago(2), "failure", { id: 10, event: "push" })];
  assert.equal(streakOf(same), 1, "같은 초의 성공(id 11)이 실패(id 12)보다 앞이라 실패 하나만 이어진다");
});

test("연속 2회 - 취소·건너뜀·진행 중은 연속을 끊지도 더하지도 않는다", async () => {
  const between = await callDeploy([dep(5, "success"), dep(3, "failure"), dep(2.5, "cancelled"), dep(2.2, "skipped", "workflow_run"), dep(2, "failure", "workflow_run"), dep(0.1, null, "push", { status: "in_progress" })]);
  assert.equal(between.status, 1, "실패 사이의 취소·건너뜀, 끝의 진행 중이 연속을 끊지 않는다");
  assert.match(between.stderr, /연속 2회 실패/);
  const added = await callDeploy([dep(5, "success"), dep(3, "failure"), dep(2, "cancelled"), dep(1, "skipped", "workflow_run"), dep(0.1, null, "push", { status: "queued" })]);
  assert.equal(added.status, 0, "실패 하나에 취소·건너뜀·대기가 붙어도 2회가 아니다");
});

test("연속 2회 - 재실행은 같은 회다: 성공하면 실패가 없어지고, 재실행도 실패하면 한 회, 재실행 중이면 그 회는 결론이 없다", () => {
  const before = dep(9, "success");
  const failed = dep(3, "failure");
  assert.equal(streakOf([before, failed, dep(2, "success", "push", { run_attempt: 2 })]), 0, "앞 run 이 재실행으로 성공: 뒤에 이어질 실패가 없다");
  assert.equal(streakOf([before, dep(2, "failure", "push", { run_attempt: 3 })]), 1, "같은 run 을 세 번 돌려 다 실패해도 한 회다");
  assert.equal(streakOf([before, failed, dep(2, null, "push", { run_attempt: 2, status: "in_progress" })]), 1);
  // created_at 은 재실행해도 그대로라, 옛 run 을 다시 돌려 성공해도 그보다 뒤의 실패 수는 그대로다.
  assert.equal(streakOf([dep(3, "success", "push", { run_attempt: 2 }), dep(2, "failure"), dep(1, "failure")]), 2);
});

test("연속 2회 - dispatch 는 연속을 끊지도 더하지도 않고, schedule 도 안 센다", () => {
  assert.equal(streakOf([dep(3, "failure"), dep(2, "success", "workflow_dispatch"), dep(1, "failure", "workflow_run")]), 2, "손으로 돌린 성공이 자연 경로의 연속 실패를 덮지 못한다(#530 과 같은 이유)");
  assert.equal(streakOf([dep(9, "success"), dep(2, "failure"), dep(1, "failure", "workflow_dispatch")]), 1);
  assert.equal(streakOf([dep(9, "success"), dep(2, "failure"), dep(1, "failure", "schedule")]), 1);
});

test("연속 2회 - 실패로 치는 결론은 셋이고, 그 밖의 결론은 실패가 아니다", () => {
  assert.deepEqual(DEPLOY_FAILURE_CONCLUSIONS, ["failure", "timed_out", "startup_failure"]);
  assert.equal(streakOf([dep(9, "success"), dep(3, "timed_out"), dep(2, "startup_failure"), dep(1, "failure")]), 3);
  assert.equal(streakOf([dep(9, "success"), dep(3, "neutral"), dep(2, "stale"), dep(1, "action_required")]), 0);
});

test("연속 2회 - 시간 창이 없다: 28분 간격도, 40시간 간격도 2회다. now 뒤의 run 은 안 본다", () => {
  assert.equal(streakOf([dep(9, "success"), dep(3, "failure"), dep(3 - 28 / 60, "failure")]), 2);
  assert.equal(streakOf([dep(50, "success"), dep(41, "failure"), dep(1, "failure")]), 2);
  assert.equal(streakOf([dep(9, "success"), dep(3, "failure"), dep(-1, "failure")]), 1, "--now 재생에서 그 뒤에 만들어진 run 이 끼면 안 된다");
  assert.throws(() => deployFailureStreak([], { now: "아무말" }), /--now/);
  assert.throws(() => deployFailureStreak([{ id: 1, event: "push", created_at: "?", conclusion: "failure" }], { now: NOW }), /created_at/);
});

test("연속 2회 - 두 규칙은 서로를 가리지 않는다: 54h 도 넘고 연속 실패도 차면 경보가 둘 다 나온다", async () => {
  const r = await callDeploy([dep(60, "success"), dep(3, "failure"), dep(2, "failure")]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /멈춘 것 같다/);
  assert.match(r.stderr, /연속 2회 실패/);
  assert.match(r.stderr, /run 2026-/, "마지막 성공 뒤 첫 실패 run 을 적는다");
});

// 실제 이력 재생. 어느 시각 t 의 API 가 보여 주었을 모양을 동결본에서 다시 만든다: t 에 시작한 마지막 attempt 의 결론, 그 attempt 가 안 끝났으면 진행 중(conclusion 없음).
const history = JSON.parse(await readFile(path.join(root, "test/fixtures/watchdog/deploy-history-2026-11-03.json"), "utf8"));
const snapshotAt = (t) => {
  const ms = Date.parse(t);
  return history.runs
    .filter((r) => Date.parse(r.created_at) <= ms)
    .map((r) => {
      const started = r.attempts.filter(([, s]) => Date.parse(s) <= ms);
      const [conclusion, , finished] = started.at(-1) ?? r.attempts[0];
      const done = Date.parse(finished) <= ms;
      return { id: r.id, event: r.event, created_at: r.created_at, status: done ? "completed" : "in_progress", conclusion: done ? conclusion : null };
    });
};
const rings = (t) => deployFailureStreak(snapshotAt(t), { now: t }).count >= DEPLOY_FAILURE_STREAK;
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");

test("재생(실제 틱) - 워치독 틱 20개 중 10-30 사고의 둘만 운다, 첫 실패 뒤 8시간 55분 44초 (#822 완료 조건 2)", () => {
  assert.equal(history.runs.length, 208);
  assert.equal(history.ticks.length, 20);
  assert.deepEqual(history.ticks.filter(rings), ["2026-10-30T11:32:00Z", "2026-10-30T21:37:06Z"]);
  assert.equal(Date.parse("2026-10-30T11:32:00Z") - Date.parse("2026-10-30T02:36:16Z"), (8 * 3600 + 55 * 60 + 44) * 1000);
  // 옛 규칙(#530, 54h)은 같은 틱들에서 한 번도 안 운다 - 이 규칙을 더한 이유다.
  const stale = history.ticks.filter((t) => successVerdict({ success: countInWindow(snapshotAt(t), { now: t, windowHours: DEPLOY_CHECK_WINDOW_HOURS, events: DEPLOY_EVENTS }).success }).ok === false);
  assert.deepEqual(stale, []);
});

test("재생(모든 상태 변화) - 조건이 참인 구간은 10-30 사고와 11-01 의 22.5분 둘뿐이고, 단발 실패 구간에서는 어느 순간에도 안 운다", () => {
  const instants = [...new Set(history.runs.flatMap((r) => [r.created_at, ...r.attempts.flatMap(([, s, f]) => [s, f])]).map(Date.parse))].sort((a, b) => a - b);
  const intervals = (threshold) => {
    const out = [];
    let on = null;
    for (const ms of instants) {
      const hit = deployFailureStreak(snapshotAt(iso(ms)), { now: ms }).count >= threshold;
      if (hit && on === null) on = ms;
      if (!hit && on !== null) {
        out.push([iso(on), iso(ms)]);
        on = null;
      }
    }
    assert.equal(on, null, "동결본 끝에서 조건이 켜진 채면 안 된다");
    return out;
  };
  assert.deepEqual(intervals(DEPLOY_FAILURE_STREAK), [
    ["2026-10-30T03:06:02Z", "2026-10-31T05:40:39Z"],
    ["2026-11-01T02:40:22Z", "2026-11-01T03:02:54Z"],
  ]);
  // 1회 규칙이면 여섯 구간이다. 실제 틱은 단발 구간 넷을 우연히 비껴갔을 뿐이라 틱 결과로는 1·2 가 안 갈린다.
  assert.deepEqual(intervals(1), [
    ["2026-10-24T00:16:04Z", "2026-10-24T01:36:10Z"],
    ["2026-10-24T04:14:21Z", "2026-10-24T04:21:28Z"],
    ["2026-10-28T12:59:09Z", "2026-10-28T13:11:38Z"],
    ["2026-10-30T02:37:38Z", "2026-10-31T05:40:39Z"],
    ["2026-11-01T02:13:13Z", "2026-11-01T03:02:54Z"],
    ["2026-11-03T01:48:56Z", "2026-11-03T01:53:11Z"],
  ]);
  assert.deepEqual(history.ticks.filter((t) => deployFailureStreak(snapshotAt(t), { now: t }).count >= 1), history.ticks.filter(rings));
});

test("재생(11-03 단발) - 41562029140: 1차 실패 뒤 재실행 전에 틱이 왔어도 안 운다, 재실행이 성공하면 실패가 사라진다", async () => {
  const r = history.runs.find((x) => x.id === 41562029140);
  assert.deepEqual(r.attempts, [
    ["failure", "2026-11-03T01:47:36Z", "2026-11-03T01:48:56Z"],
    ["success", "2026-11-03T01:53:11Z", "2026-11-03T01:54:48Z"],
  ]);
  assert.equal(history.runs.filter((x) => x.attempts.length > 1).length, 1, "동결본의 재실행은 이것 하나다");
  for (const [t, expected] of [["2026-11-03T01:48:56Z", 1], ["2026-11-03T01:50:00Z", 1], ["2026-11-03T01:53:11Z", 0], ["2026-11-03T01:54:48Z", 0]]) {
    assert.equal(deployFailureStreak(snapshotAt(t), { now: t }).count, expected, t);
    const cli = await callDeploy(snapshotAt(t), [`--now=${t}`]);
    assert.equal(cli.status, 0, `${t}: ${cli.stdout}${cli.stderr}`);
  }
});

test("재생(CLI) - 사고 틱은 종료 1, 복구 뒤 첫 틱은 종료 0 (파일 → main → 종료 코드까지)", async () => {
  const hit = await callDeploy(snapshotAt("2026-10-30T11:32:00Z"), ["--now=2026-10-30T11:32:00Z"]);
  assert.equal(hit.status, 1, hit.stdout + hit.stderr);
  assert.match(hit.stderr, /연속 2회 실패 - 마지막 성공 뒤 첫 실패 2026-10-30T02:36:16Z\(run 40992653615\), 최근 실패 run 40995314958/);
  assert.doesNotMatch(hit.stderr, /멈춘 것 같다/, "54h 규칙은 이 틱에 안 운다");
  const after = await callDeploy(snapshotAt("2026-10-31T11:04:53Z"), ["--now=2026-10-31T11:04:53Z"]);
  assert.equal(after.status, 0, after.stdout + after.stderr);
});
