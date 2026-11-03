// 슬롯 동결 측정(#820). 규칙은 같은 폴더 PREREG.md가 정하고, 이 파일은 그 계산을 옮긴 것이다.
//
//   node research/slot-freeze-2026-11/measure.mjs plan                                  호출 없음. 슬롯·고정값·분모를 찍는다
//   node research/slot-freeze-2026-11/measure.mjs fetch --out <저장소 밖 폴더>            매매 API 호출(상한 150회). 저장소에 쓰지 않는다
//   node research/slot-freeze-2026-11/measure.mjs compare --refetched <fetch의 --out> --out <폴더>   호출 없음. 판정을 낸다
//
// fetch는 MOLIT_API_KEY·MOLIT_API_ENDPOINT를 환경에서 읽고 키와 주소를 출력하지 않는다.
// --root <경로>는 원본을 읽을 저장소, --now <ISO>는 시각, --no-pin은 고정값 확인 생략(시험의 합성 입력에만 쓴다).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { buildFiles } from "../../scripts/build-complex-price.ts";
import { buildPayload, MONTHS } from "../../scripts/build-cancellation.ts";
import { contractKey, isCancelled } from "../../scripts/cancellation.ts";
import { marketDeal } from "../../scripts/complex-price.ts";
import { DISTRICTS } from "../../scripts/realestate-districts.ts";
import { buildSlotFile, itemKey, rawPath, readSlotFile } from "../../scripts/realestate-raw.ts";
import { RETENTION_MONTHS } from "../../scripts/realestate-slots.ts";
import { recentMonths } from "../../scripts/realestate-source.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CODES = DISTRICTS.map((d) => d.code);

// ── 사전 등록 값 (PREREG 3·4절). 측정 뒤에는 새 버전으로만 바꾼다. ──
export const THRESHOLDS = {
  /** A1. 값 행 / 시장 행 (202607·202608). */
  rowShare: 0.01,
  /** A2. 칸 변화(|Δ|≥1% + n≥3 탈락 + n≥3 진입) / n≥3 칸. */
  cellShare: 0.02,
  /** A2에서 움직임으로 세는 칸의 상대 변화. */
  cellMove: 0.01,
  /** A3. 억 구간이 바뀐 칸 / n≥3 칸. */
  bandShare: 0.01,
  /** B2. 서울 해제율 표시값 변화(%p). */
  cancelPp: 0.2,
};
export const MAX_CALLS = 150;
export const CORE_MONTHS = ["202604", "202605", "202606", "202607", "202608"];
export const ROW_TEST_MONTHS = ["202607", "202608"];
export const CONTROL_MONTH = "202610";
export const OLDER_MONTH = "202603";
export const CONTROL_CODES = [0, 5, 10, 15, 20].map((i) => CODES[i]);
export const OLDER_CODES = Array.from({ length: 10 }, (_, i) => CODES[Math.floor(i * 2.5)]);
/** 저장 원본의 고정값. `plan`이 찍는 값과 같아야 호출을 시작한다(PREREG 2절). */
export const PIN_DIGEST = "cc87632f7335f8a7fa790b659f36f1df8d4001423b0379bbf94e6eb05161f204";

export const FIELDS = [
  "aptDong", "aptNm", "buildYear", "buyerGbn", "cdealDay", "cdealType", "dealAmount", "dealDay", "dealMonth", "dealYear",
  "dealingGbn", "estateAgentSggNm", "excluUseAr", "floor", "jibun", "landLeaseholdGbn", "rgstDate", "sggCd", "slerGbn", "umdNm",
];

const DELAY_MS = 200;
const TIMEOUT_MS = 15_000;
const RETRY_WAIT_MS = 3_000;
const STOP_AFTER_FAILED_SLOTS = 5;
export const STARTED_MARKER = "fetch-started.json";
/** 이 행 수 이상인 슬롯이 절반 아래로 줄면 출력에 따로 적는다. 판정에는 안 쓴다(PREREG 6절). */
const SHRUNK_MIN_ROWS = 20;
/** 이 시각 안에는 호출을 시작하지 않는다. 수집·요약·배포가 겹치는 시간이다(PREREG 5절). */
const QUIET = { from: 8 * 60, to: 12 * 60 + 30 };

export function plannedSlots() {
  const slots = [];
  for (const yearMonth of CORE_MONTHS) for (const code of CODES) slots.push({ group: "core", code, yearMonth });
  for (const code of CONTROL_CODES) slots.push({ group: "control", code, yearMonth: CONTROL_MONTH });
  for (const code of OLDER_CODES) slots.push({ group: "older", code, yearMonth: OLDER_MONTH });
  return slots;
}

export function inQuietHours(now) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const minutes = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  return minutes >= QUIET.from && minutes < QUIET.to;
}

// ── 비교: 한 슬롯 ──
const REGISTRATION_FIELDS = new Set(["rgstDate", "aptDong"]);
const filled = (v) => String(v ?? "").trim().length > 0;

export function classifyPair(stored, fetched) {
  const was = isCancelled(stored);
  const is = isCancelled(fetched);
  if (!was && is) return "cancelMarked";
  if (was && !is) return "cancelUndone";
  const changed = FIELDS.filter((f) => stored[f] !== fetched[f]);
  if (changed.every((f) => REGISTRATION_FIELDS.has(f)) && !filled(stored.rgstDate) && filled(fetched.rgstDate)) return "registered";
  return "other";
}

const valueKey = (item) => {
  const d = marketDeal(item);
  return d ? JSON.stringify([d.district, d.apt, d.area, d.date, d.amount]) : null;
};

function countBy(rows, keyOf) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

function subtract(left, right) {
  const out = [];
  for (const [key, rows] of left) out.push(...rows.slice(right.get(key)?.length ?? 0));
  return out;
}

/** 저장 행과 다시 받은 행을 대조한다. 같은 키가 여러 행일 수 있어 집합이 아니라 건수로 뺀다. */
export function diffSlot(storedItems, fetchedItems) {
  const storedByHash = countBy(storedItems, itemKey);
  const fetchedByHash = countBy(fetchedItems, itemKey);
  const storedLeft = countBy(subtract(storedByHash, fetchedByHash), contractKey);
  const fetchedLeft = countBy(subtract(fetchedByHash, storedByHash), contractKey);
  const liveKeys = new Set(fetchedItems.filter((i) => !isCancelled(i)).map(contractKey));

  const counts = { registered: 0, cancelMarked: 0, cancelUndone: 0, other: 0, gone: 0, gonePublic: 0, appeared: 0, appearedCancelled: 0, cancelWithTwin: 0, cancelNoTwin: 0 };
  const changes = [];
  const note = (kind, stored, fetched) => {
    counts[kind] += 1;
    changes.push({ kind, stored: stored ?? null, fetched: fetched ?? null });
  };
  const noteCancel = (item) => {
    if (liveKeys.has(contractKey(item))) counts.cancelWithTwin += 1;
    else counts.cancelNoTwin += 1;
  };
  const liveFirst = (a, b) => Number(isCancelled(a)) - Number(isCancelled(b));

  for (const key of new Set([...storedLeft.keys(), ...fetchedLeft.keys()])) {
    const before = [...(storedLeft.get(key) ?? [])].sort(liveFirst);
    const after = [...(fetchedLeft.get(key) ?? [])].sort(liveFirst);
    const paired = Math.min(before.length, after.length);
    for (let i = 0; i < paired; i += 1) {
      const kind = classifyPair(before[i], after[i]);
      note(kind, before[i], after[i]);
      if (kind === "cancelMarked") noteCancel(after[i]);
    }
    for (const row of before.slice(paired)) {
      note("gone", row, null);
      if (marketDeal(row)) counts.gonePublic += 1;
    }
    for (const row of after.slice(paired)) {
      if (isCancelled(row)) {
        note("appearedCancelled", null, row);
        noteCancel(row);
      } else note("appeared", null, row);
    }
  }

  // 값 행: 시세 칸 값을 가르는 다섯 필드(구·단지·면적·계약일·금액)의 건수 차이. 금액 정정은 나간 행 + 들어온 행 = 2다.
  const storedValue = countBy(storedItems, valueKey);
  const fetchedValue = countBy(fetchedItems, valueKey);
  const valueOut = subtract(storedValue, fetchedValue).length;
  const valueIn = subtract(fetchedValue, storedValue).length;
  const marketRows = storedItems.filter((i) => marketDeal(i)).length;

  return {
    rows: storedItems.length,
    fetchedRows: fetchedItems.length,
    hashGone: subtract(storedByHash, fetchedByHash).length,
    marketRows,
    valueOut,
    valueIn,
    counts,
    changes,
  };
}

/** 판정. 호출 없는 순수 함수로 둔다. 경계값(정확히 문턱)은 넘은 것으로 본다. */
export function judge({ invalid = [], rows, cells, cancelShare, mature }) {
  if (invalid.length) return { verdict: "무효", invalid };
  const a1 = rows.value * 100 >= rows.market;
  const a2 = cells.changed * 50 >= cells.base;
  const a3 = cells.band * 100 >= cells.base;
  const b1 = JSON.stringify(mature.before) !== JSON.stringify(mature.after);
  const b2 = cancelShare.before !== null && cancelShare.after !== null && Math.abs(Math.round(cancelShare.after * 10) - Math.round(cancelShare.before * 10)) >= 2;
  const a = a1 || a2 || a3;
  const b = b1 || b2;
  const verdict = a ? "재수집 필요: 시세 칸" : b ? "재수집 필요: 해제·등기 화면만" : "재수집 불필요";
  return { verdict, a, b, triggers: { a1, a2, a3, b1, b2 } };
}

// ── 비교: 화면 값 ──
function cellMedians(built) {
  const out = new Map();
  for (const [slug, file] of Object.entries(built?.files ?? {})) {
    for (const [apt, areas] of Object.entries(file.cells)) {
      for (const [name, cell] of Object.entries(areas)) if (cell.median) out.set(`${slug}\u0000${apt}\u0000${name}`, cell.median);
    }
  }
  return out;
}

export function compareCells(before, after) {
  let moved = 0;
  let lost = 0;
  let band = 0;
  const shifts = [];
  for (const [key, was] of before) {
    const is = after.get(key);
    if (is === undefined) {
      lost += 1;
      continue;
    }
    const shift = Math.abs(is - was) / was;
    if (shift > 0) shifts.push(shift);
    if (shift >= THRESHOLDS.cellMove) moved += 1;
    if (Math.floor(is / 10000) !== Math.floor(was / 10000)) band += 1;
  }
  let gained = 0;
  for (const key of after.keys()) if (!before.has(key)) gained += 1;
  shifts.sort((a, b) => a - b);
  const at = (q) => (shifts.length ? Math.round(shifts[Math.floor((shifts.length - 1) * q)] * 10000) / 100 : null);
  return { base: before.size, changed: moved + lost + gained, moved, lost, gained, band, anyShift: shifts.length, shiftP50: at(0.5), shiftP90: at(0.9), shiftMax: at(1) };
}

function screenValues(payload) {
  const s = payload?.seoul;
  return {
    months: payload?.months ?? [],
    deals: s?.deals ?? null,
    cancelled: s?.cancelled ?? null,
    cancelledShare: s?.cancelledShare ?? null,
    settleDays: s?.settleDays ?? null,
    medianDays: s?.registration?.medianDays ?? null,
    matureMonths: s?.registration?.matureMonths ?? [],
    matured: s?.registration?.matured ?? null,
    stale: s?.registration?.stale ?? null,
    staleShare: s?.registration?.staleShare ?? null,
  };
}

// ── 명령 ──
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function pinDigest(root) {
  const lines = plannedSlots()
    .filter((s) => s.group !== "control")
    .map((s) => `sale/${s.code}-${s.yearMonth}.json ${sha256(readFileSync(rawPath("sale", s.code, s.yearMonth, path.join(root, "raw"))))}`)
    .sort();
  return sha256(lines.join("\n"));
}

async function cmdPlan({ root }) {
  const slots = plannedSlots();
  const dir = path.join(root, "raw");
  const stats = {};
  const fieldSets = new Set();
  for (const slot of slots) {
    const file = await readSlotFile("sale", slot.code, slot.yearMonth, dir);
    for (const item of file.items) fieldSets.add(Object.keys(item).sort().join(","));
    const row = (stats[slot.yearMonth] ??= { group: slot.group, slots: 0, rows: 0, marketRows: 0, cancelled: 0, noRegistration: 0, observedMin: file.observedAt, observedMax: file.observedAt });
    row.slots += 1;
    row.rows += file.items.length;
    row.marketRows += file.items.filter((i) => marketDeal(i)).length;
    row.cancelled += file.items.filter(isCancelled).length;
    row.noRegistration += file.items.filter((i) => !isCancelled(i) && !filled(i.rgstDate)).length;
    if (file.observedAt < row.observedMin) row.observedMin = file.observedAt;
    if (file.observedAt > row.observedMax) row.observedMax = file.observedAt;
  }
  console.log(`슬롯 ${slots.length} (본 ${slots.filter((s) => s.group === "core").length} · 대조 ${CONTROL_CODES.length} · 오래된 달 ${OLDER_CODES.length}), 호출 상한 ${MAX_CALLS}`);
  console.log(`대조 구 ${CONTROL_CODES.join(" ")}`);
  console.log(`오래된 달 구 ${OLDER_CODES.join(" ")}`);
  console.log(`고정값 ${pinDigest(root)}`);
  console.log(`필드 조합 ${fieldSets.size}개, FIELDS와 일치 ${fieldSets.size === 1 && [...fieldSets][0] === [...FIELDS].sort().join(",")}`);
  console.log("달 | 묶음 | 슬롯 | 행 | 시장 행 | 해제 표시 | 등기 빈 정상 행 | 관측 최소~최대");
  for (const [month, r] of Object.entries(stats).sort()) {
    console.log([month, r.group, r.slots, r.rows, r.marketRows, r.cancelled, r.noRegistration, `${r.observedMin.slice(0, 10)}~${r.observedMax.slice(0, 10)}`].join(" | "));
  }
  const rowTest = ROW_TEST_MONTHS.reduce((a, m) => a + stats[m].marketRows, 0);
  console.log(`A1 분모(202607·202608 시장 행) ${rowTest}, 문턱 값 행 ≥ ${Math.ceil(rowTest * THRESHOLDS.rowShare)}`);
}

function redactor(secrets) {
  const needles = secrets.filter(Boolean).flatMap((s) => {
    const forms = [s, encodeURIComponent(s)];
    try {
      forms.push(decodeURIComponent(s));
    } catch {
      // 퍼센트 인코딩이 아닌 키다.
    }
    return forms;
  });
  const unique = [...new Set(needles)].sort((a, b) => b.length - a.length);
  return { needles: unique, clean: (text) => unique.reduce((out, n) => out.split(n).join("***"), String(text)) };
}

const errorText = (err) => {
  const parts = [err?.message ?? String(err)];
  let cause = err?.cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    parts.push(cause.code ?? cause.message ?? String(cause));
    cause = cause.cause;
  }
  return parts.filter(Boolean).join(" <- ");
};

/** scripts/fetch-realestate.ts fetchApiOnce와 같은 호출·해석. 그쪽이 내보내지 않아 옮겨 적었고, 어긋나면 대조 슬롯이 잡는다(PREREG 6절). */
async function fetchOnce(apiUrl, serviceKey, code, yearMonth) {
  const params = new URLSearchParams({ LAWD_CD: code, DEAL_YMD: yearMonth, numOfRows: "9999" });
  const res = await fetch(`${apiUrl}?serviceKey=${serviceKey}&${params.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const parsed = new XMLParser().parse(await res.text());
  const header = parsed?.response?.header;
  if (!header) throw new Error(parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? "알 수 없는 응답 형식");
  if (Number(header.resultCode) !== 0) throw new Error(header.resultMsg ?? `resultCode ${header.resultCode}`);
  const totalCount = Number(parsed?.response?.body?.totalCount);
  const items = parsed?.response?.body?.items?.item;
  return { items: items ? (Array.isArray(items) ? items : [items]) : [], totalCount: Number.isInteger(totalCount) ? totalCount : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cmdFetch({ root, out, now, noPin, delayMs, retryWaitMs }) {
  const key = process.env.MOLIT_API_KEY;
  const endpoint = process.env.MOLIT_API_ENDPOINT;
  if (!key || !endpoint) return fail(2, "MOLIT_API_KEY·MOLIT_API_ENDPOINT가 없어 호출하지 않는다");
  if (!out) return fail(2, "--out이 없다");
  const outDir = path.resolve(out);
  const relative = path.relative(REPO_ROOT, outDir);
  const relativeRoot = path.relative(path.resolve(root), outDir);
  if (!relative.startsWith("..") || !relativeRoot.startsWith("..")) return fail(2, "--out은 저장소 밖이어야 한다(쓰기 0)");
  if (inQuietHours(now)) return fail(3, "08:00~12:30 KST 안에서는 호출을 시작하지 않는다");
  if (!noPin) {
    const digest = pinDigest(root);
    if (digest !== PIN_DIGEST) return fail(4, `저장 원본이 등록한 고정값과 다르다: ${digest}`);
  }

  const { clean, needles } = redactor([key, endpoint]);
  const slots = plannedSlots();
  mkdirSync(path.join(outDir, "sale"), { recursive: true });
  const observedAt = now.toISOString();
  // 호출을 시작한 실행은 어떻게 끝나도 이 파일이 아티팩트로 남아 다음 dispatch를 막는다. 호출 전에 멈춘 실행에는 없다(PREREG 5절).
  const started = `${JSON.stringify({ startedAt: observedAt, commit: process.env.GITHUB_SHA ?? null })}\n`;
  writeFileSync(path.join(outDir, STARTED_MARKER), started);
  const log = [];
  let calls = 0;
  let failedInARow = 0;
  let stopped = false;

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const remainingAfter = slots.length - i - 1;
    const entry = { ...slot, ok: false, attempts: 0, count: null, totalCount: null, error: null };
    let response = null;
    // 첫 시도는 늘 한다. 다시 시도는 뒤 슬롯의 첫 시도 몫을 남기고 상한 안에서만 한다.
    while (entry.attempts === 0 || (!response && entry.attempts < 2 && calls + 1 + remainingAfter <= MAX_CALLS)) {
      if (entry.attempts > 0) await sleep(retryWaitMs);
      calls += 1;
      entry.attempts += 1;
      try {
        response = await fetchOnce(endpoint, key, slot.code, slot.yearMonth);
        entry.error = null;
      } catch (err) {
        entry.error = clean(errorText(err)).slice(0, 200);
      }
    }
    if (response) {
      const file = buildSlotFile({ kind: "sale", code: slot.code, yearMonth: slot.yearMonth, items: response.items, totalCount: response.totalCount, observedAt });
      writeFileSync(path.join(outDir, "sale", `${slot.code}-${slot.yearMonth}.json`), `${JSON.stringify(file)}\n`);
      Object.assign(entry, { ok: true, count: file.count, totalCount: file.totalCount });
      failedInARow = 0;
    } else {
      failedInARow += 1;
    }
    log.push(entry);
    if (failedInARow >= STOP_AFTER_FAILED_SLOTS) {
      stopped = true;
      break;
    }
    if (delayMs) await sleep(delayMs);
  }

  const summary = { startedAt: observedAt, finishedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, calls, maxCalls: MAX_CALLS, planned: slots.length, stopped, slots: log };
  writeFileSync(path.join(outDir, "fetch-log.json"), `${JSON.stringify(summary, null, 1)}\n`);

  // 마지막 방어선: 쓴 파일에 키·주소가 있으면 지우고 실패한다.
  const leaked = walk(outDir).filter((file) => {
    const text = readFileSync(file, "utf8");
    return needles.some((n) => text.includes(n));
  });
  if (leaked.length) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, STARTED_MARKER), started);
    return fail(5, `출력 ${leaked.length}개에 비밀값이 있어 출력 폴더를 지웠다`);
  }
  const okSlots = log.filter((s) => s.ok).length;
  console.log(`호출 ${calls}/${MAX_CALLS}, 슬롯 성공 ${okSlots}/${slots.length}${stopped ? `, ${STOP_AFTER_FAILED_SLOTS}슬롯 연속 실패로 중단` : ""}`);
  for (const s of log.filter((row) => !row.ok)) console.log(`실패 ${s.code}-${s.yearMonth}: ${s.error}`);
  return 0;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

function fail(code, message) {
  console.error(`[slot-freeze] ${message}`);
  return code;
}

async function loadRefetched(dir, log, root) {
  const out = [];
  for (const slot of plannedSlots()) {
    const entry = log.slots.find((s) => s.code === slot.code && s.yearMonth === slot.yearMonth);
    const file = path.join(dir, "sale", `${slot.code}-${slot.yearMonth}.json`);
    const stored = await readSlotFile("sale", slot.code, slot.yearMonth, path.join(root, "raw"));
    const fetched = entry?.ok && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    let problem = null;
    if (!stored) problem = "저장 슬롯 없음";
    else if (!fetched) problem = entry?.error ?? "호출 안 됨";
    else if (fetched.totalCount !== fetched.count) problem = `totalCount ${fetched.totalCount} ≠ 행 ${fetched.count}`;
    else if (stored.items.length > 0 && fetched.count === 0) problem = `행 ${stored.items.length} → 0, 빈 응답`;
    out.push({ ...slot, stored, fetched, problem });
  }
  return out;
}

async function cmdCompare({ root, refetched, out, now: nowArg }) {
  if (!refetched || !out) return fail(2, "--refetched와 --out이 필요하다");
  const log = JSON.parse(readFileSync(path.join(refetched, "fetch-log.json"), "utf8"));
  const now = nowArg ?? new Date(log.startedAt);
  const slots = await loadRefetched(refetched, log, root);
  const invalid = [];

  // 필드 확인. 없어진 필드는 무효, 새 필드는 빼고 비교하며 적는다.
  const seen = new Set();
  for (const s of slots) for (const item of s.fetched?.items ?? []) for (const k of Object.keys(item)) seen.add(k);
  const extraFields = [...seen].filter((f) => !FIELDS.includes(f)).sort();
  const missingFields = seen.size ? FIELDS.filter((f) => !seen.has(f)) : [];
  if (missingFields.length) invalid.push(`응답에서 필드가 없어졌다: ${missingFields.join(",")}`);
  const project = (item) => Object.fromEntries(Object.entries(item).filter(([k]) => FIELDS.includes(k)));

  const diffs = [];
  mkdirSync(out, { recursive: true });
  const changesFile = [];
  for (const s of slots) {
    if (s.problem) continue;
    const fetchedItems = s.fetched.items.map(project);
    const d = diffSlot(s.stored.items, fetchedItems);
    diffs.push({ ...s, fetchedItems, d });
    for (const c of d.changes) changesFile.push(JSON.stringify({ code: s.code, yearMonth: s.yearMonth, group: s.group, ...c }));
  }
  writeFileSync(path.join(out, "changed-rows.jsonl"), changesFile.length ? `${changesFile.join("\n")}\n` : "");

  // 절반 아래로 줄어도 totalCount가 맞으면 원본의 답이므로 변화로 센다. 판정에 손대지 않고 눈에 띄게 적기만 한다.
  const shrunk = diffs
    .filter((s) => s.d.rows >= SHRUNK_MIN_ROWS && s.d.fetchedRows < s.d.rows * 0.5)
    .map((s) => ({ code: s.code, yearMonth: s.yearMonth, group: s.group, stored: s.d.rows, fetched: s.d.fetchedRows, gone: s.d.counts.gone, gonePublic: s.d.counts.gonePublic, valueOut: s.d.valueOut }));

  // 대조: 해석이 어긋나면 다섯 슬롯이 다 망가진다. 한 슬롯의 일괄 삭제는 중앙값을 안 움직인다.
  const control = diffs.filter((s) => s.group === "control");
  const controlShares = control.map((s) => (s.d.rows ? s.d.hashGone / s.d.rows : 0)).sort((a, b) => a - b);
  const controlMedian = controlShares.length ? controlShares[Math.floor(controlShares.length / 2)] : null;
  if (control.length < 3) invalid.push(`대조 슬롯 ${control.length}개만 받았다`);
  else if (controlMedian >= 0.2) invalid.push(`대조 슬롯 중앙 변화 ${(controlMedian * 100).toFixed(1)}% ≥ 20%`);

  // 받은 범위: 저장 행 기준 95% 미만이면 무효.
  const coreSlots = slots.filter((s) => s.group === "core");
  const coverage = (months) => {
    const inMonths = coreSlots.filter((s) => months.includes(s.yearMonth));
    const all = inMonths.reduce((a, s) => a + (s.stored?.items.length ?? 0), 0);
    const got = inMonths.filter((s) => !s.problem).reduce((a, s) => a + s.stored.items.length, 0);
    return all ? got / all : 0;
  };
  const coverageCore = coverage(CORE_MONTHS);
  const coverageRow = coverage(ROW_TEST_MONTHS);
  if (coverageCore < 0.95) invalid.push(`본 슬롯 수신 ${(coverageCore * 100).toFixed(1)}% < 95%`);
  if (coverageRow < 0.95) invalid.push(`202607·202608 수신 ${(coverageRow * 100).toFixed(1)}% < 95%`);

  // 달별 표.
  const blank = () => ({ slots: 0, rows: 0, marketRows: 0, valueOut: 0, valueIn: 0, hashGone: 0, registered: 0, cancelMarked: 0, cancelUndone: 0, other: 0, gone: 0, gonePublic: 0, appeared: 0, appearedCancelled: 0, cancelWithTwin: 0, cancelNoTwin: 0 });
  const byMonth = {};
  for (const s of diffs) {
    const row = (byMonth[s.yearMonth] ??= blank());
    row.slots += 1;
    for (const k of ["rows", "marketRows", "valueOut", "valueIn", "hashGone"]) row[k] += s.d[k];
    for (const [k, v] of Object.entries(s.d.counts)) row[k] += v;
  }
  const rowTest = ROW_TEST_MONTHS.map((m) => byMonth[m] ?? blank());
  const rows = {
    value: rowTest.reduce((a, r) => a + r.valueOut + r.valueIn, 0),
    market: rowTest.reduce((a, r) => a + r.marketRows, 0),
  };

  // 화면 값. 다시 받은 슬롯만 바꿔 끼우고 나머지·지수·전망은 그대로 둔다.
  const replaced = new Map(diffs.filter((s) => s.group !== "control").map((s) => [`${s.code}-${s.yearMonth}`, s.fetchedItems]));
  const rawDir = path.join(root, "raw");
  const allMonths = recentMonths(now, RETENTION_MONTHS);
  const storedItems = new Map();
  for (const { code } of DISTRICTS) {
    for (const m of allMonths) {
      const file = await readSlotFile("sale", code, m, rawDir);
      if (file?.ok !== false && Array.isArray(file?.items)) storedItems.set(`${code}-${m}`, file.items);
    }
  }
  const gather = (months, swap) => Object.fromEntries(
    DISTRICTS.map(({ code, name }) => [
      name,
      months.flatMap((m) => (swap && replaced.get(`${code}-${m}`)) || storedItems.get(`${code}-${m}`) || []),
    ]).filter(([, items]) => items.length)
  );
  const toCodes = (byName) => Object.fromEntries(DISTRICTS.filter((d) => byName[d.name]).map((d) => [d.code, byName[d.name]]));

  const index = JSON.parse(readFileSync(path.join(rawDir, "ecos/apt-price-index.json"), "utf8"));
  const outlook = JSON.parse(readFileSync(path.join(root, "docs/data/outlook.json"), "utf8"));
  const priceMonths = recentMonths(now, 7);
  const cellsBefore = cellMedians(buildFiles({ itemsByDistrict: toCodes(gather(priceMonths, false)), index, outlook, now }));
  const cellsAfter = cellMedians(buildFiles({ itemsByDistrict: toCodes(gather(priceMonths, true)), index, outlook, now }));
  const cells = compareCells(cellsBefore, cellsAfter);

  const screenMonths = recentMonths(now, MONTHS);
  const before = screenValues(buildPayload({ byDistrict: gather(screenMonths, false), months: screenMonths, now, registrationByDistrict: gather(allMonths, false) }));
  const after = screenValues(buildPayload({ byDistrict: gather(screenMonths, true), months: screenMonths, now, registrationByDistrict: gather(allMonths, true) }));

  const result = judge({ invalid, rows, cells, cancelShare: { before: before.cancelledShare, after: after.cancelledShare }, mature: { before: before.matureMonths, after: after.matureMonths } });

  const failed = slots.filter((s) => s.problem).map((s) => ({ code: s.code, yearMonth: s.yearMonth, group: s.group, problem: s.problem }));
  const summary = {
    prereg: "research/slot-freeze-2026-11/PREREG.md",
    now: now.toISOString(),
    commit: log.commit,
    calls: log.calls,
    thresholds: THRESHOLDS,
    result,
    rowTest: { ...rows, share: rows.market ? rows.value / rows.market : null, threshold: Math.ceil(rows.market * THRESHOLDS.rowShare) },
    cells,
    screen: { before, after },
    byMonth,
    control: { median: controlMedian, shares: controlShares },
    coverage: { core: coverageCore, rowTest: coverageRow },
    extraFields,
    failed,
    shrunk,
  };
  writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);

  const pct = (x) => (x === null ? "-" : `${(x * 100).toFixed(2)}%`);
  console.log(`판정: ${result.verdict}`);
  if (result.invalid) for (const why of result.invalid) console.log(`  무효 사유: ${why}`);
  if (result.triggers) console.log(`  문턱: ${Object.entries(result.triggers).map(([k, v]) => `${k}=${v ? "넘음" : "안 넘음"}`).join(" ")}`);
  console.log(`호출 ${log.calls}/${MAX_CALLS}, 실패 슬롯 ${failed.length}, 대조 중앙 ${pct(controlMedian)}, 수신 본 ${pct(coverageCore)} · 07~08 ${pct(coverageRow)}, 새 필드 ${extraFields.join(",") || "없음"}`);
  for (const s of shrunk) console.log(`절반 아래(변화로 셈) ${s.code}-${s.yearMonth} ${s.group}: 행 ${s.stored} → ${s.fetched}, 사라짐 ${s.gone}(시장 ${s.gonePublic}), 값 나감 ${s.valueOut}`);
  console.log(`A1 값 행 ${rows.value} / 시장 행 ${rows.market} = ${pct(summary.rowTest.share)} (문턱 ${pct(THRESHOLDS.rowShare)}, ${summary.rowTest.threshold}행)`);
  console.log(`A2 칸 변화 ${cells.changed} / ${cells.base} = ${pct(cells.base ? cells.changed / cells.base : null)} (문턱 ${pct(THRESHOLDS.cellShare)}): |Δ|≥1% ${cells.moved}, 탈락 ${cells.lost}, 진입 ${cells.gained}. 값이 조금이라도 바뀐 칸 ${cells.anyShift}, |Δ| P50 ${cells.shiftP50}% P90 ${cells.shiftP90}% 최대 ${cells.shiftMax}%`);
  console.log(`A3 억 구간 ${cells.band} / ${cells.base} = ${pct(cells.base ? cells.band / cells.base : null)} (문턱 ${pct(THRESHOLDS.bandShare)})`);
  console.log(`B1 익은 달 ${before.matureMonths.at(-1) ?? "-"}(${before.matureMonths.length}개) → ${after.matureMonths.at(-1) ?? "-"}(${after.matureMonths.length}개)`);
  console.log(`B2 서울 해제율 ${before.cancelledShare} → ${after.cancelledShare} (문턱 ${THRESHOLDS.cancelPp}%p), 미등기 ${before.staleShare} → ${after.staleShare}, 등기 중간값 ${before.medianDays}일 → ${after.medianDays}일`);
  console.log("달 | 슬롯 | 행 | 시장 행 | 값 나감 | 값 들어옴 | 값 행% | 등기 | 해제 표시(짝 있음+없음) | 해제 복귀 | 기타 | 사라짐(시장) | 새 행 | 새 해제 행");
  for (const [m, r] of Object.entries(byMonth).sort()) {
    const share = r.marketRows ? ((r.valueOut + r.valueIn) / r.marketRows * 100).toFixed(2) : "-";
    console.log([m, r.slots, r.rows, r.marketRows, r.valueOut, r.valueIn, share, r.registered, `${r.cancelMarked + r.appearedCancelled}(${r.cancelWithTwin}+${r.cancelNoTwin})`, r.cancelUndone, r.other, `${r.gone}(${r.gonePublic})`, r.appeared, r.appearedCancelled].join(" | "));
  }
  return 0;
}

async function main() {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      out: { type: "string" },
      refetched: { type: "string" },
      now: { type: "string" },
      "no-pin": { type: "boolean" },
      "delay-ms": { type: "string" },
      "retry-wait-ms": { type: "string" },
    },
  });
  const root = path.resolve(v.root ?? REPO_ROOT);
  const now = v.now ? new Date(v.now) : null;
  const command = positionals[0];
  if (command === "plan") {
    await cmdPlan({ root });
    return 0;
  }
  if (command === "fetch") {
    return cmdFetch({
      root,
      out: v.out,
      now: now ?? new Date(),
      noPin: v["no-pin"],
      delayMs: v["delay-ms"] === undefined ? DELAY_MS : Number(v["delay-ms"]),
      retryWaitMs: v["retry-wait-ms"] === undefined ? RETRY_WAIT_MS : Number(v["retry-wait-ms"]),
    });
  }
  if (command === "compare") return cmdCompare({ root, refetched: v.refetched, out: v.out, now });
  return fail(2, "명령은 plan·fetch·compare 가운데 하나다");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`[slot-freeze] ${String(err?.message ?? err).slice(0, 300)}`);
      process.exitCode = 1;
    }
  );
}
