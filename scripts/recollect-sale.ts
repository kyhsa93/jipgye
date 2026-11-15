// 얼린 매매 슬롯 재수집 회차(#861). 슬롯·`arrivals`·첫 관측일(raw/first-seen)은 쓰지 않고, 덧씌움(raw/recollect/sale)과 회차 기록(raw/recollect/round-<달>.json)만 쓴다.
//
//   node scripts/recollect-sale.ts --dry-run --responses <폴더> [--now <ISO>] [--out-dir <폴더>]
//       호출 0회. <폴더>/<구>-<달>.json(슬롯 모양: items·totalCount - #820 아티팩트 got/sale 그대로)을 응답으로 보고 회차를 계산해 --out-dir(기본 build/recollect-dry-run)에만 쓴다.
//   node scripts/recollect-sale.ts --run --approved-calls <N> --owner-notice <이슈 댓글 URL>
//       매매 API 호출. 아래 거부 조건을 호출 전에 전부 본다. 쓰는 곳은 raw/recollect 뿐이고 커밋은 부르는 쪽(워크플로의 push-docs.sh)이 한다.
//
// 창(완료 조건 5, pm·cpo 정정): 현재월-6 ~ 동결 직전(현재월-2)의 5달. 1회차에 한해 202604 를 더한다(pm 11-04 판정) - 2026-11 이면 6달 150회, 상한 160회.
// 호출 상한 = 달 수 × 25 + 10. 2회차부터 202604 가 창에 들면 거부한다.
//
// 호출 전에 거부하는 것(시험: test/recollect-sale.test.mjs):
//   - 달 초 3일(refreshMonths 가 현재월-2 까지 받는 날 - 창이 일 수집과 겹친다)과 08:00~12:30 KST(수집·요약·배포 시간).
//   - 1회차가 2026-11 밖(12-01 부터 거부, cpo 11-04 보완 - 12월 공식대로면 202605 가 빠지고, 넣으면 7달 175회로 상한을 넘는다).
//   - 이번 달 회차가 이미 있음(월 1회), 회차 기록이 지금보다 뒤 달에 있음.
//   - 소유자 답이 없거나 답한 호출 수가 이번 상한보다 작음(135회 답으로 160회 회차를 돌리지 않는다).
//   - daily-update 가 돌고 있거나 줄 서 있음(gh 로 확인하고, 확인하지 못해도 거부). 같은 시각에 원본을 다투면 push-docs.sh 가 실패한다(#92).
//
// 반영 판정(완료 조건 3): #863 의 judgeSlotResponse 를 보류 일수 없이 쓴다(pm 11-15 기록) - 0행·totalCount 불일치·절반 아래·10행 이상 감소는 그 회차에 반영하지 않는다.
// 기준(저장)은 지금 소비자가 보는 값, 곧 슬롯 + 지난 덧씌움이다. 같은 슬롯이 두 회차 연속 거부되면 pm 11-15 판정 네 갈래를 따른다(consecutiveStep).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { collectionNow } from "./collection-now.ts";
import { DISTRICTS, districtNames } from "./realestate-districts.ts";
import { RAW_DIR, buildSlotFile, readSlotFile } from "./realestate-raw.ts";
import { REASONS, judgeSlotResponse, reasonText } from "./realestate-guard.ts";
import { IDENTITY_SKIP, rowIdentity } from "./realestate-first-seen.ts";
import { MONTH_START_GRACE_DAYS, kstDateParts, shiftMonth, yearMonthOf } from "./realestate-slots.ts";
import { RECOLLECT_DIR, buildOverlay, diffRows, mergeRecollect, readOverlay, unknownFields, writeOverlay } from "./realestate-recollect.ts";

const root = path.resolve(import.meta.dirname, "..");

export const CALLS_PER_MONTH = DISTRICTS.length;
export const CALL_MARGIN = 10;
/** 1회차의 달과, 그 회차에만 더하는 달(pm 11-04 판정 - 202604 가 등기 채움 82.1% 로 창 밖에 남지 않게). */
export const FIRST_ROUND = "202611";
export const FIRST_ROUND_EXTRA = "202604";
/** 상대 창: 현재월에서 몇 달 전부터 몇 달 전까지(양끝 포함). 현재월-2 는 4일부터 일 수집이 받지 않는 첫 달이다(realestate-slots refreshMonths). */
export const WINDOW_FROM = -6;
export const WINDOW_TO = -2;
/** 이 시각 안에는 호출을 시작하지 않는다(분, KST). #820 측정(PREREG 5절)과 같다. */
export const QUIET = Object.freeze({ from: 8 * 60, to: 12 * 60 + 30 });
const OWNER_NOTICE = /^https:\/\/github\.com\/kyhsa93\/jipgye\/issues\/\d+#issuecomment-\d+$/;
const ROUND_FILE = /^round-(\d{6})\.json$/;
const DELAY_MS = 200;
const RETRY_WAIT_MS = 3000;
const STOP_AFTER_FAILED_SLOTS = 5;

export const roundPath = (round, dir = RAW_DIR) => path.join(dir, RECOLLECT_DIR, `round-${round}.json`);
export const slotName = (code, yearMonth) => `${code}-${yearMonth}`;

export function inQuietHours(now) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const minutes = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  return minutes >= QUIET.from && minutes < QUIET.to;
}

export const recentMonths = (now) => {
  const current = yearMonthOf(now);
  const out = [];
  for (let delta = WINDOW_FROM; delta <= WINDOW_TO; delta += 1) out.push(shiftMonth(current, delta));
  return out;
};

/**
 * 이번 회차의 달과 호출 수. 거부면 { ok: false, reason }. rounds: 이미 있는 회차 기록의 달(raw/recollect/round-<달>.json).
 * clock=false 는 드라이런용 - 시각 거부(달 초·조용한 시간)만 건너뛰고 나머지 규칙은 같다.
 */
export function planRound({ now, rounds = [], clock = true }): any {
  const round = yearMonthOf(now);
  const refuse = (reason) => ({ ok: false, round, reason });
  if (clock && kstDateParts(now).day <= MONTH_START_GRACE_DAYS) return refuse(`달 초 ${MONTH_START_GRACE_DAYS}일에는 돌지 않는다(일 수집이 현재월-2 까지 받는 날)`);
  if (clock && inQuietHours(now)) return refuse("08:00~12:30 KST 에는 호출을 시작하지 않는다");
  const done = [...rounds].sort();
  if (done.includes(round)) return refuse(`${round} 회차 기록이 이미 있다 - 월 1회다`);
  if (done.length && done.at(-1) > round) return refuse(`회차 기록(${done.at(-1)})이 지금(${round})보다 뒤다`);
  const first = done.length === 0;
  if (first && round !== FIRST_ROUND) return refuse(`1회차는 ${FIRST_ROUND} 안에만 돈다 - 그 밖이면 호출하지 않고 다시 고지한다`);
  const months = first ? [FIRST_ROUND_EXTRA, ...recentMonths(now)] : recentMonths(now);
  if (!first && months.includes(FIRST_ROUND_EXTRA)) return refuse(`${FIRST_ROUND_EXTRA} 는 1회차에만 받는다`);
  const planned = months.length * CALLS_PER_MONTH;
  return { ok: true, round, first, months, planned, cap: planned + CALL_MARGIN };
}

/** 소유자 답 확인. 답한 호출 수가 이번 상한보다 작으면 거부한다. */
export function checkApproval(plan, { approvedCalls, ownerNotice }) {
  if (!OWNER_NOTICE.test(String(ownerNotice ?? ""))) return { ok: false, reason: "소유자 답(이슈 댓글 URL)이 없다 - 고지 전에는 호출하지 않는다" };
  if (!Number.isInteger(approvedCalls) || approvedCalls < plan.cap) {
    return { ok: false, reason: `소유자가 답한 호출 수(${approvedCalls ?? "없음"})가 이번 회차 상한 ${plan.cap}회(${plan.months.length}달 × ${CALLS_PER_MONTH} + ${CALL_MARGIN})보다 작다` };
  }
  return { ok: true };
}

/** daily-update 실행 목록(gh run list --json status) 가운데 돌거나 줄 선 것. */
export function dailyBusy(runs) {
  return (runs ?? []).filter((run) => ["in_progress", "queued", "waiting", "requested", "pending"].includes(run?.status));
}

/** gh 로 daily-update 실행을 읽는다. 읽지 못하면 던진다(부르는 쪽이 거부한다). */
export function readDailyRuns() {
  const text = execFileSync("gh", ["run", "list", "--workflow", "daily-update.yml", "--limit", "20", "--json", "status,databaseId,createdAt"], { encoding: "utf8" });
  return JSON.parse(text);
}

/** 응답의 행 신원 집합(#863 판정의 신원 - IDENTITY_SKIP 칸을 뺀 나머지)의 지문. 두 회차 응답이 「같은 집합」인지만 본다. */
export function identityDigest(items) {
  const ids = [...new Set((items ?? []).map(rowIdentity))].sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
}

/**
 * 연속 거부 네 갈래(pm 11-15 판정). verdict: 이번 판정, prev: 지난 회차의 같은 슬롯 기록(없으면 undefined), identity: 이번 응답 지문.
 * 결과 { apply, status, note }.
 *  1. 이번 이유가 0행·totalCount 불일치면 몇 회차든 반영하지 않는다(연속이면 [오류] 이슈).
 *  2. 절반 아래·10행 감소가 두 회차 연속이고 응답 신원 집합이 같으면 둘째 회차에 반영한다.
 *  3. 연속인데 신원 집합이 다르면 반영하지 않는다(셋째 회차에도 걸리면 pm 판정).
 *  4. 거부 뒤 창 밖으로 나간 슬롯은 여기 오지 않는다 - outOfWindow 가 따로 적는다.
 */
export function consecutiveStep(verdict, prev, identity) {
  if (verdict.apply) return { apply: true, status: "applied", note: null };
  const repeated = prev?.status?.startsWith("rejected") ?? false;
  const blocking = verdict.reason === REASONS.zero || verdict.reason === REASONS.totalCount;
  if (blocking) return { apply: false, status: repeated ? "rejected-repeat-error" : "rejected", note: repeated ? "연속 거부(0행·totalCount) - [오류] 이슈" : null };
  if (!repeated) return { apply: false, status: "rejected", note: null };
  const prevSoft = prev.reason === REASONS.half || prev.reason === REASONS.rows;
  if (prevSoft && prev.identity === identity) return { apply: true, status: "applied-repeat", note: "연속 거부·같은 응답 - 반영" };
  return { apply: false, status: "rejected-repeat-mismatch", note: "연속 거부·응답 불일치" };
}

export async function listRounds(dir = RAW_DIR) {
  const names = await readdir(path.join(dir, RECOLLECT_DIR)).catch(() => []);
  return names.map((name) => ROUND_FILE.exec(name)?.[1]).filter(Boolean).sort();
}

export async function readRound(round, dir = RAW_DIR) {
  try {
    return JSON.parse(await readFile(roundPath(round, dir), "utf8"));
  } catch {
    return null;
  }
}

const emptyRow = (month) => ({ month, slots: 0, applied: 0, rejected: 0, missing: 0, rows: 0, market: 0, valueOut: 0, valueIn: 0, changed: 0, appeared: 0, gone: 0, gonePublic: 0 });

/**
 * 한 회차를 계산하고 out 에 쓴다(덧씌움·회차 기록). 호출은 하지 않는다 - responses 는 이미 받은 것이다.
 * responses: Map(slotName → { items, totalCount } | { error }). 없는 슬롯은 응답 없음으로 센다(드라이런: 아티팩트에 없는 달).
 * dir: 슬롯·지난 덧씌움·지난 회차를 읽는 raw. out: 쓰는 raw(실행이면 dir 와 같다).
 */
export async function processRound({ plan, responses, observedAt, dir = RAW_DIR, out = dir, calls = 0, meta = {} }) {
  const done = await listRounds(dir);
  const prevRound = done.length ? await readRound(done.at(-1), dir) : null;
  const prevSlots = prevRound?.slots ?? {};
  const slots = {};
  const table = [];
  let written = 0;

  for (const yearMonth of plan.months) {
    const row = emptyRow(yearMonth);
    for (const { code } of DISTRICTS) {
      const name = slotName(code, yearMonth);
      const slot = await readSlotFile("sale", code, yearMonth, dir);
      const response = responses.get(name);
      if (!slot || slot.ok === false || !Array.isArray(slot.items)) {
        slots[name] = { status: "no-slot" };
        continue;
      }
      if (!response || response.error) {
        row.missing += 1;
        slots[name] = { status: response?.error ? "failed" : "missing", ...(response?.error ? { error: response.error } : {}) };
        continue;
      }
      row.slots += 1;
      const fetched = buildSlotFile({ kind: "sale", code, yearMonth, items: response.items, totalCount: response.totalCount, observedAt });
      const current = mergeRecollect(slot, await readOverlay(code, yearMonth, dir));
      const diff = diffRows(current.items, fetched.items).counts;
      const identity = identityDigest(fetched.items);
      const fields = unknownFields(fetched.items);
      const verdict = fields.length
        ? { apply: false, reason: "fields", saved: current.count, received: fetched.count, releasable: false }
        : judgeSlotResponse(current, { items: fetched.items, totalCount: response.totalCount });
      const step = fields.length ? { apply: false, status: "rejected", note: `사본에 없는 칸: ${fields.join(",")}` } : consecutiveStep(verdict, prevSlots[name], identity);
      slots[name] = {
        status: step.status,
        reason: verdict.reason,
        ...(verdict.reason && verdict.reason !== "fields" ? { text: reasonText(verdict) } : {}),
        ...(step.note ? { note: step.note } : {}),
        saved: current.count,
        received: fetched.count,
        identity,
        diff,
      };
      if (!step.apply) {
        row.rejected += 1;
        continue;
      }
      row.applied += 1;
      for (const key of ["rows", "market", "valueOut", "valueIn", "changed", "appeared", "gone", "gonePublic"]) row[key] += diff[key];
      if (await writeOverlay(code, yearMonth, buildOverlay({ slot, items: fetched.items, totalCount: response.totalCount, observedAt }), out)) written += 1;
    }
    table.push(row);
  }

  // 4번 갈래: 지난 회차에 거부됐는데 이번 창 밖인 슬롯. 따로 받지 않고 얼린 값 그대로 둔다.
  const outOfWindow = Object.entries<any>(prevSlots)
    .filter(([name, entry]) => entry?.status?.startsWith("rejected") && !plan.months.includes(name.slice(6)))
    .map(([name]) => name)
    .sort();

  const record = {
    round: plan.round,
    observedAt,
    months: plan.months,
    first: plan.first,
    planned: plan.planned,
    cap: plan.cap,
    calls,
    ...meta,
    identitySkip: IDENTITY_SKIP,
    table,
    outOfWindow,
    slots,
  };
  await mkdir(path.dirname(roundPath(plan.round, out)), { recursive: true });
  await writeFile(roundPath(plan.round, out), `${JSON.stringify(record, null, 1)}\n`);
  return { record, written };
}

const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(2) : "-");

/** 회차 표(조건 6)와 반영하지 않은 슬롯 목록. 실행 요약·드라이런 출력이 같은 글자를 쓴다. */
export function roundLines(record) {
  const lines = [
    `### 매매 재수집 ${record.round} (#861)${record.dryRun ? " - 드라이런, 호출 0" : ""}`,
    "",
    `달 ${record.months.join("·")} · 호출 ${record.calls}/${record.cap} · 계획 ${record.planned}`,
    "",
    "| 달 | 응답 슬롯 | 반영 | 거부 | 응답 없음 | 저장 행 | 시장 행 | 값 나감 | 값 들어옴 | 값 행 | 값 행% | 바뀐 행 | 새 행 | 사라진 행(시장) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  const sum = emptyRow("합계");
  for (const row of record.table) {
    for (const key of Object.keys(sum)) if (key !== "month") sum[key] += row[key];
    lines.push(`| ${row.month} | ${row.slots} | ${row.applied} | ${row.rejected} | ${row.missing} | ${row.rows} | ${row.market} | ${row.valueOut} | ${row.valueIn} | ${row.valueOut + row.valueIn} | ${pct(row.valueOut + row.valueIn, row.market)} | ${row.changed} | ${row.appeared} | ${row.gone}(${row.gonePublic}) |`);
  }
  lines.push(`| 합계 | ${sum.slots} | ${sum.applied} | ${sum.rejected} | ${sum.missing} | ${sum.rows} | ${sum.market} | ${sum.valueOut} | ${sum.valueIn} | ${sum.valueOut + sum.valueIn} | ${pct(sum.valueOut + sum.valueIn, sum.market)} | ${sum.changed} | ${sum.appeared} | ${sum.gone}(${sum.gonePublic}) |`);
  lines.push("", "값·사라진 행은 반영한 슬롯만 센다(거부한 슬롯은 아래 목록). 기준은 회차 전 소비자가 보던 값(슬롯 + 지난 덧씌움)이다.");
  const notable = Object.entries<any>(record.slots).filter(([, s]) => s.status !== "applied" && s.status !== "no-slot" && s.status !== "missing");
  if (notable.length) {
    lines.push("", "| 슬롯 | 처리 | 이유 |", "|---|---|---|");
    for (const [name, s] of notable.sort(([a], [b]) => (a < b ? -1 : 1))) {
      const label = `${districtNames.get(name.slice(0, 5)) ?? name.slice(0, 5)} ${name.slice(6)}`;
      lines.push(`| ${label} (\`${name}\`) | ${s.status}${s.note ? ` - ${s.note}` : ""} | ${s.text ?? s.error ?? s.reason ?? ""} |`);
    }
  }
  if (record.outOfWindow.length) lines.push("", `거부 후 창 밖(얼린 값 그대로, 따로 받지 않음): ${record.outOfWindow.join(", ")}`);
  return lines;
}

// ---- 호출 ----

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 계획한 슬롯을 차례로 받는다. 시도마다 호출 1회로 세고 상한(cap)을 넘지 않는다 - 다시 시도는 뒤 슬롯의 첫 시도 몫을 남긴 만큼만 한다(#820 measure 와 같다).
 * fetchOnce(code, yearMonth) → { items, totalCount }. 오류 글자에서 비밀값(secrets)을 지운다.
 */
export async function fetchRound({ plan, fetchOnce, secrets = [], delayMs = DELAY_MS, retryWaitMs = RETRY_WAIT_MS }) {
  const queue = plan.months.flatMap((yearMonth) => DISTRICTS.map(({ code }) => ({ code, yearMonth })));
  const clean = (text) => secrets.filter(Boolean).reduce((acc, secret) => acc.split(secret).join("***"), String(text)).slice(0, 200);
  const responses = new Map();
  let calls = 0;
  let failedInARow = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const { code, yearMonth } = queue[i];
    const remainingAfter = queue.length - i - 1;
    let attempts = 0;
    let response = null;
    let error = null;
    while (attempts === 0 || (!response && attempts < 2 && calls + 1 + remainingAfter <= plan.cap)) {
      if (calls >= plan.cap) break;
      if (attempts > 0) await sleep(retryWaitMs);
      calls += 1;
      attempts += 1;
      try {
        response = await fetchOnce(code, yearMonth);
        error = null;
      } catch (err) {
        error = clean(err?.message ?? err);
      }
    }
    responses.set(slotName(code, yearMonth), response ?? { error: error ?? "호출하지 않음(상한)" });
    failedInARow = response ? 0 : failedInARow + 1;
    if (failedInARow >= STOP_AFTER_FAILED_SLOTS) break;
    if (delayMs) await sleep(delayMs);
  }
  return { responses, calls };
}

/** 덧씌움이 남았는데 슬롯이 없어진(보관 창 24달을 지나 지운) 것을 지운다. */
export async function pruneOverlays(dir = RAW_DIR) {
  const folder = path.join(dir, RECOLLECT_DIR, "sale");
  let removed = 0;
  for (const name of (await readdir(folder).catch(() => [])).sort()) {
    const m = /^(\d{5})-(\d{6})\.json$/.exec(name);
    if (!m || (await readSlotFile("sale", m[1], m[2], dir))) continue;
    await rm(path.join(folder, name), { force: true });
    removed += 1;
  }
  return removed;
}

async function readResponses(folder) {
  const responses = new Map();
  for (const name of (await readdir(folder)).sort()) {
    const m = /^(\d{5})-(\d{6})\.json$/.exec(name);
    if (!m) continue;
    const file = JSON.parse(await readFile(path.join(folder, name), "utf8"));
    responses.set(slotName(m[1], m[2]), { items: file.items ?? [], totalCount: Number.isInteger(file.totalCount) ? file.totalCount : null });
  }
  return responses;
}

const report = (lines) => {
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
};

class Refusal extends Error {}
const refuse = (reason) => {
  throw new Refusal(reason);
};

export async function main(argv = process.argv.slice(2), { readRuns = readDailyRuns } = {}) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      run: { type: "boolean", default: false },
      responses: { type: "string" },
      now: { type: "string" },
      "out-dir": { type: "string" },
      "approved-calls": { type: "string" },
      "owner-notice": { type: "string" },
    },
  });
  if (v["dry-run"] === v.run) refuse("--dry-run 과 --run 중 하나만 준다");
  const now = v.now ? collectionNow("now", { now: v.now }) : collectionNow("REALESTATE_NOW");
  const rounds = await listRounds(RAW_DIR);

  if (v["dry-run"]) {
    if (!v.responses) refuse("--dry-run 에는 --responses <폴더> 가 필요하다");
    const plan = planRound({ now, rounds, clock: false });
    if (!plan.ok) refuse(plan.reason);
    const clock = planRound({ now, rounds });
    const out = path.resolve(v["out-dir"] ?? path.join(root, "build", "recollect-dry-run"));
    if (path.resolve(out) === path.resolve(RAW_DIR)) refuse("드라이런은 raw 에 쓰지 않는다 - --out-dir 를 따로 준다");
    await rm(path.join(out, RECOLLECT_DIR), { recursive: true, force: true });
    const { record } = await processRound({ plan, responses: await readResponses(path.resolve(v.responses)), observedAt: now.toISOString(), dir: RAW_DIR, out, calls: 0, meta: { dryRun: true } });
    report(roundLines(record));
    if (!clock.ok) console.log(`(실행이었다면 거부: ${clock.reason})`);
    console.log(`드라이런 출력: ${path.join(out, RECOLLECT_DIR)}`);
    return record;
  }

  // ---- 실행: 아래 거부를 모두 지나야 첫 호출을 한다 ----
  const plan = planRound({ now, rounds });
  if (!plan.ok) refuse(plan.reason);
  const approval = checkApproval(plan, { approvedCalls: v["approved-calls"] === undefined ? undefined : Number(v["approved-calls"]), ownerNotice: v["owner-notice"] });
  if (!approval.ok) refuse(approval.reason);
  const endpoint = process.env.MOLIT_API_ENDPOINT;
  const key = process.env.MOLIT_API_KEY;
  if (!endpoint || !key) refuse("MOLIT_API_KEY·MOLIT_API_ENDPOINT 가 없다");
  let busy;
  try {
    busy = dailyBusy(readRuns());
  } catch (err) {
    refuse(`daily-update 실행 상태를 확인하지 못했다(${String(err?.message ?? err).split("\n")[0]}) - 겹칠 수 있어 돌지 않는다`);
  }
  if (busy.length) refuse(`daily-update 가 돌고 있다(${busy.map((run) => `${run.databaseId} ${run.status}`).join(", ")})`);

  // 일 수집과 같은 호출·해석(fetch-realestate fetchApiOnce). 거부를 다 지난 뒤에만 불러온다.
  const { fetchApiOnce } = await import("./fetch-realestate.ts");
  const fetchOnce = (code, yearMonth) => fetchApiOnce(endpoint, key, code, yearMonth);
  const observedAt = now.toISOString();
  console.log(`[recollect] ${plan.round} 회차: ${plan.months.join("·")} · 계획 ${plan.planned}회 · 상한 ${plan.cap}회`);
  const { responses, calls } = await fetchRound({ plan, fetchOnce, secrets: [key, endpoint] });
  const { record, written } = await processRound({
    plan, responses, observedAt, dir: RAW_DIR, out: RAW_DIR, calls,
    meta: { approvedCalls: Number(v["approved-calls"]), ownerNotice: v["owner-notice"] },
  });
  const pruned = await pruneOverlays(RAW_DIR);
  report(roundLines(record));
  for (const [name, s] of Object.entries<any>(record.slots)) if (s.note?.includes("[오류]")) console.log(`::warning::매매 재수집 ${name}: ${s.note} - ${s.text}`);
  console.log(`[recollect] 덧씌움 ${written}개 바뀜${pruned ? ` · 슬롯 없는 덧씌움 ${pruned}개 지움` : ""} · 호출 ${calls}/${plan.cap}`);
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`[recollect] ${err instanceof Refusal ? "거부(호출 0)" : "실패"}: ${err.message}`);
    process.exitCode = err instanceof Refusal ? 3 : 1;
  });
}
