// #863 - 일 수집이 크게 줄어든 응답을 슬롯에 쓰지 않는다. 판정 함수(#861 이 같이 쓴다)·보류 일수·보류 상태 파일·재생·첫 관측일(#885)과의 상호작용·수집기 연결.
// 입력은 전부 고정이다(#8): 판정은 손으로 만든 슬롯, 재생은 저장 원본 이력에서 떼어 온 픽스처(아래), 수집기는 가짜 국토부 서버.
//
// 픽스처 test/fixtures/collection-drop/sale-11230-202610.json.gz 는 raw/sale/11230-202610.json 의 다섯 판을 바이트 그대로 담았다:
//   10-31 3b0a7399 (390행) · 11-01 7eb99beb (77행) · 11-02 01ca6bc2 (77행) · 11-03 5fd78e5c (399행) · 11-04 51047e5f (411행)
// 만든 명령: 각 커밋에서 `git show <커밋>:raw/sale/11230-202610.json` 을 { slot, source: {날짜: 커밋}, files: {날짜: 본문} } 로 묶어 gzip -9.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { saleItem, rentItem, startFakeMolit, successXml } from "./helpers/fake-molit.mjs";
import {
  DROP_ROWS, HOLD_DAYS, MIN_SAVED_ROWS, REASONS, holdsPath, judgeSlotResponse, nextHold, pruneHolds, readHolds, reasonText, receiveSlot, writeHolds,
} from "../scripts/realestate-guard.ts";
import { CONCENTRATION } from "../scripts/realestate-concentration.ts";
import { buildSlotFile, itemKey, readSlotFile, writeSlotFile } from "../scripts/realestate-raw.ts";
import { IDENTITY_SKIP, firstSeenPath, readFirstSeen, refreshFirstSeen, rowIdentity } from "../scripts/realestate-first-seen.ts";
import { readWindowItems } from "../scripts/build-realestate.ts";
import { c1Lines } from "../scripts/ledger-snapshot.ts";
import { windowMonths } from "../scripts/realestate-slots.ts";

const root = path.resolve(import.meta.dirname, "..");
const run = promisify(execFile);

const rows = (n, extra = {}) => Array.from({ length: n }, (_, i) => saleItem({ floor: i + 1, ...extra }));
const saved = (n, extra = {}) => ({ ok: true, count: n, totalCount: n, items: rows(n), ...extra });
const resp = (n, totalCount = n) => ({ items: rows(n), totalCount });

test("판정: 행 수 문턱은 쏠림 규칙의 행 하한을 그대로 쓰고(복제 없음), 저장 20행 이상에서 절반 아래·문턱 이상 감소를 막는다", async () => {
  assert.equal(DROP_ROWS, CONCENTRATION.minRows);
  assert.match(await readFile(path.join(root, "scripts/realestate-guard.ts"), "utf8"), /export const DROP_ROWS = CONCENTRATION\.minRows;/);
  assert.equal(MIN_SAVED_ROWS, 20);
  assert.equal(HOLD_DAYS, 3);

  const cases = [
    // [저장, 응답, 이유]
    [MIN_SAVED_ROWS - 1, 0, REASONS.zero],
    [MIN_SAVED_ROWS - 1, 9, null], // 20행 아래는 절반이 무너져도 반영
    [MIN_SAVED_ROWS, 9, REASONS.half],
    [MIN_SAVED_ROWS, MIN_SAVED_ROWS - DROP_ROWS, REASONS.rows], // 20 → 10: 절반 아래는 아니고(10×2=20) 10행 감소
    [MIN_SAVED_ROWS, MIN_SAVED_ROWS - DROP_ROWS + 1, null],
    [390, 77, REASONS.half], // 11230-202610 매매 11-01
    [445, 320, REASONS.rows], // 11260-202610 전월세 10-15: 절반 규칙만으로는 놓친다
    [1000, 1000 - DROP_ROWS + 1, null],
    [1000, 1000 - DROP_ROWS, REASONS.rows],
    [100, 101, null],
  ];
  for (const [s, r, reason] of cases) {
    const v = judgeSlotResponse(saved(s), resp(r));
    assert.equal(v.reason, reason, `${s} → ${r}`);
    assert.equal(v.apply, reason === null, `${s} → ${r}`);
    assert.equal(v.releasable, reason === REASONS.half || reason === REASONS.rows, `${s} → ${r}`);
    assert.equal(v.saved, s);
    assert.equal(v.received, r);
  }
});

test("판정: 0행·totalCount 불일치는 일수와 무관하게 막고, 저장이 없거나 깨진 슬롯은 지킬 것이 없어 그대로 반영한다", () => {
  assert.deepEqual(judgeSlotResponse(saved(1), resp(0)), { apply: false, reason: REASONS.zero, saved: 1, received: 0, releasable: false });
  assert.equal(judgeSlotResponse(saved(0), resp(0)).apply, true);
  const cut = judgeSlotResponse(saved(5), resp(5, 9999));
  assert.equal(cut.reason, REASONS.totalCount);
  assert.equal(cut.releasable, false);
  assert.equal(cut.totalCount, 9999);
  assert.equal(judgeSlotResponse(saved(5), resp(5, null)).apply, true, "totalCount 를 못 읽은 응답은 불일치로 보지 않는다");
  // 첫 응답이 잘렸으면 지금처럼 쓰고 slotStateOf 가 broken 으로 보아 다음에 다시 받는다(test/realestate-collect 「잘린 응답」).
  assert.equal(judgeSlotResponse(null, resp(1, 9999)).apply, true);
  assert.equal(judgeSlotResponse(null, resp(0)).apply, true);
  assert.equal(judgeSlotResponse({ ok: false }, resp(0)).apply, true);
  assert.equal(judgeSlotResponse({ ok: true }, resp(0)).apply, true, "count 가 없는 깨진 슬롯");

  assert.equal(reasonText(judgeSlotResponse(saved(390), resp(77))), "절반 아래(저장 390행 → 응답 77행)");
  assert.equal(reasonText(judgeSlotResponse(saved(445), resp(320))), `${DROP_ROWS}행 이상 감소(저장 445행 → 응답 320행)`);
  assert.equal(reasonText(judgeSlotResponse(saved(3), resp(0))), "0행 응답(저장 3행 → 응답 0행)");
  assert.equal(reasonText(cut), "totalCount 불일치(응답 5행, totalCount 9,999)");
});

test("보류 일수: KST 날짜로 세고(같은 날 두 번은 하루), 3 수집일 뒤에도 걸리면 반영한다. 반영할 응답이 오면 보류를 지우고, 0행·totalCount 는 보류를 건드리지 않는다", () => {
  const drop = judgeSlotResponse(saved(390), resp(77));
  let step = nextHold(undefined, drop, "2026-11-01");
  assert.deepEqual(step, { apply: false, entry: { days: ["2026-11-01"], reason: "half", saved: 390, received: 77 }, released: false });
  step = nextHold(step.entry, drop, "2026-11-01");
  assert.deepEqual(step.entry.days, ["2026-11-01"], "같은 날 두 번째 회차");
  step = nextHold(step.entry, drop, "2026-11-02");
  step = nextHold(step.entry, drop, "2026-11-03");
  assert.deepEqual(step, { apply: false, entry: { days: ["2026-11-01", "2026-11-02", "2026-11-03"], reason: "half", saved: 390, received: 77 }, released: false });
  const zero = judgeSlotResponse(saved(390), resp(0));
  assert.deepEqual(nextHold(step.entry, zero, "2026-11-04"), { apply: false, entry: step.entry, released: false });
  assert.deepEqual(nextHold(step.entry, drop, "2026-11-04"), { apply: true, entry: null, released: true });
  assert.deepEqual(nextHold(step.entry, judgeSlotResponse(saved(390), resp(399)), "2026-11-04"), { apply: true, entry: null, released: false });
});

test("보류 상태 파일: raw/realestate-holds.json, 키 순으로 같은 바이트, 보류가 없으면 파일이 없다. 받지 않은 슬롯의 보류는 지운다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "holds-"));
  assert.equal(holdsPath(dir), path.join(dir, "realestate-holds.json"));
  assert.deepEqual(await readHolds(dir), {});
  assert.equal(await writeHolds({}, dir), false);
  assert.equal(existsSync(holdsPath(dir)), false);

  const entry = { days: ["2026-11-01"], reason: "half", saved: 390, received: 77 };
  assert.equal(await writeHolds({ "sale:11230:202610": entry, "rent:11110:202610": entry }, dir), true);
  const text = await readFile(holdsPath(dir), "utf8");
  assert.ok(text.indexOf("rent:11110:202610") < text.indexOf("sale:11230:202610"), text);
  assert.equal(await writeHolds({ "rent:11110:202610": entry, "sale:11230:202610": entry }, dir), false, "같은 상태면 다시 쓰지 않는다");
  assert.deepEqual(await readHolds(dir), { "rent:11110:202610": entry, "sale:11230:202610": entry });

  const holds = await readHolds(dir);
  pruneHolds(holds, new Set(["sale:11230:202610"]));
  assert.deepEqual(Object.keys(holds), ["sale:11230:202610"]);
  await writeHolds({}, dir);
  assert.equal(existsSync(holdsPath(dir)), false);
});

const fixture = JSON.parse(gunzipSync(await readFile(path.join(import.meta.dirname, "fixtures/collection-drop/sale-11230-202610.json.gz"))));
const DAYS = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
// 행 신원: 정의 원본은 scripts/realestate-first-seen.ts 의 IDENTITY_SKIP·rowIdentity 하나다(#885 cto 후속 - 이 시험이 따로 두던 정의를 걷었다).
// data-analyst 판정(#863 11-15)과 같은 네 칸(등기·해제·동)을 뺀 나머지이고, 이 네 칸만 바뀐 행은 같은 거래다.
const identity = rowIdentity;

test("신원 정의는 한 곳: research 의 Python 사본(drops.py VOLATILE)은 import 할 수 없어 글자로 대조한다", async () => {
  const py = await readFile(path.join(root, "research/collection-drop-2026-11/drops.py"), "utf8");
  const tuple = /^VOLATILE = \(([^)]*)\)$/m.exec(py)?.[1];
  assert.ok(tuple, "drops.py 에 VOLATILE 줄이 없다");
  assert.deepEqual(tuple.split(",").map((name) => name.trim().replace(/^'|'$/g, "")), [...IDENTITY_SKIP]);
});
const rowsStamped = (file, day) => file.items.filter((item) => file.arrivals[itemKey(item)] === day).length;

// firstSeen: 빌드(build-realestate main)처럼 그날 수집 뒤 행 첫 관측일 상태(#862 2단계, raw/first-seen)를 갱신하고, 그 파일 글자와 갱신 수를 함께 남긴다.
// 10-31 판에서 한 번 갱신해 둔다(이 픽스처 이전 이력은 없으므로 도장 없는 행은 추적 전 날이다).
const SEEN_NOW = new Date("2026-11-04T03:00:00Z");
const refreshSeen = (dir) => refreshFirstSeen(windowMonths(SEEN_NOW), ["11230"], { dir, readSlot: readSlotFile });
const seenText = (dir) => readFile(firstSeenPath("sale", "11230", "202610", dir), "utf8");

async function replay({ firstSeen = false, days = DAYS } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "drop-replay-"));
  await mkdir(path.join(dir, "sale"));
  const file = path.join(dir, "sale", "11230-202610.json");
  await writeFile(file, fixture.files["2026-10-31"]);
  if (firstSeen) await refreshSeen(dir);
  const out = { dir, base: firstSeen ? await seenText(dir) : null };
  for (const day of days) {
    const version = JSON.parse(fixture.files[day]);
    const holds = await readHolds(dir);
    const result = await receiveSlot({
      kind: "sale", code: "11230", yearMonth: "202610", response: { items: version.items, totalCount: version.totalCount }, observedAt: version.observedAt, holds, dir,
    });
    await writeHolds(holds, dir);
    out[day] = { result, text: await readFile(file, "utf8"), holds: await readHolds(dir) };
    if (firstSeen) Object.assign(out[day], { refresh: await refreshSeen(dir), seen: await seenText(dir) });
  }
  return out;
}

/** 보류 없이 저장된 실제 이력을 같은 방식으로 재생한다: 10-31 부터 days 까지 그날 판을 바이트 그대로 쓰고 첫 관측일을 갱신한다. */
async function actualHistory(days = DAYS) {
  const dir = await mkdtemp(path.join(tmpdir(), "drop-actual-"));
  await mkdir(path.join(dir, "sale"));
  for (const day of ["2026-10-31", ...days]) {
    await writeFile(path.join(dir, "sale", "11230-202610.json"), fixture.files[day]);
    await refreshSeen(dir);
  }
  return dir;
}

test("재생 ①②: 11230-202610 은 11-01·02 응답(77행)을 쓰지 않고 슬롯·arrivals 가 바이트까지 그대로다. 11-03 응답(399행)을 쓰고 보류는 2일로 끝난다", async () => {
  assert.equal(fixture.source["2026-10-31"], "3b0a73999ca75521ee38973710785021115b1c48");
  const out = await replay();
  for (const [day, n] of [["2026-11-01", 1], ["2026-11-02", 2]]) {
    assert.equal(out[day].result.applied, false, day);
    assert.equal(out[day].result.verdict.reason, REASONS.half, day);
    assert.equal(out[day].text, fixture.files["2026-10-31"], `${day}: 보류 중 슬롯이 바뀌었다`);
    assert.deepEqual(out[day].holds, { "sale:11230:202610": { days: DAYS.slice(0, n), reason: "half", saved: 390, received: 77 } });
  }
  assert.equal(out["2026-11-03"].result.applied, true);
  assert.equal(out["2026-11-03"].result.released, false, "11-03 응답은 줄지 않아 보류가 풀린 것이다(3일 강제 반영이 아니다)");
  assert.equal(JSON.parse(out["2026-11-03"].text).count, 399);
  assert.deepEqual(out["2026-11-03"].holds, {});
  assert.equal(JSON.parse(out["2026-11-04"].text).count, 411);
});

test("재생 ③: 신원 기준 늦어진 새 행 0행. 돌아온 313행 재도장은 남는다. itemKey(전체 해시) 기준으로는 1행 도장이 11-02 → 11-03 으로 하루 밀린다", async () => {
  const out = await replay();
  const base = JSON.parse(fixture.files["2026-10-31"]);
  const baseIds = new Set(base.items.map(identity));
  const baseKeys = new Set(base.items.map(itemKey));
  const mine = JSON.parse(out["2026-11-03"].text);
  const actual = JSON.parse(fixture.files["2026-11-03"]);

  // 보류가 있어도 11-03 에 새 도착으로 찍히는 행: 신원은 10-31 에 있었는데 해시가 바뀐(등기일·동이 붙은) 행 314행 + 진짜 새 신원 9행.
  assert.equal(out["2026-11-03"].result.added, 323);
  assert.equal(rowsStamped(mine, "2026-11-03"), 323);
  const restamped = mine.items.filter((item) => mine.arrivals[itemKey(item)] === "2026-11-03" && baseIds.has(identity(item)) && !baseKeys.has(itemKey(item)));
  assert.equal(restamped.length, 314, "11-01 에 빠졌다 11-03 에 돌아온 313행 + 11-02 에 등기일이 붙은 1행");

  // 늦어짐: 실제 이력(보류 없음)보다 늦게 찍힌 행.
  const later = mine.items.filter((item) => mine.arrivals[itemKey(item)] > actual.arrivals[itemKey(item)]);
  assert.equal(later.filter((item) => !baseIds.has(identity(item))).length, 0, "신원 기준 늦어진 새 행");
  assert.equal(later.length, 1, "itemKey 기준: 11-02 에 등기일이 채워진 행 하나");
  assert.equal(actual.arrivals[itemKey(later[0])], "2026-11-02");
  assert.ok(baseIds.has(identity(later[0])), "그 행은 10-31 에 이미 있던 거래다");

  // 11-04 판은 그 한 행의 도착일만 다르고 나머지 바이트는 실제 이력과 같다(previousObservedAt 도 11-03 으로 같다).
  const mine4 = out["2026-11-04"].text;
  const key = itemKey(later[0]);
  assert.notEqual(mine4, fixture.files["2026-11-04"]);
  assert.equal(mine4.replace(`"${key}":"2026-11-03"`, `"${key}":"2026-11-02"`), fixture.files["2026-11-04"]);
});

test("첫 관측일(#885)과 보류: 보류 중엔 슬롯이 그대로라 first-seen 도 바이트까지 그대로다. 11-03 반영 날 돌아온 행은 새 신고로 세지 않고, 신고 창은 실제 이력(보류 없음)과 같은 행을 든다", async () => {
  const days = DAYS.slice(0, 3); // 11-01·02 보류, 11-03 반영
  const out = await replay({ firstSeen: true, days });
  for (const day of ["2026-11-01", "2026-11-02"]) {
    assert.equal(out[day].result.applied, false, day);
    assert.deepEqual(out[day].refresh, { written: 0, removed: 0 }, `${day}: 보류 중에 첫 관측일 상태를 다시 썼다`);
    assert.equal(out[day].seen, out.base, `${day}: 보류 중 첫 관측일 상태가 바뀌었다`);
  }
  assert.equal(out["2026-11-03"].result.applied, true);
  assert.deepEqual(out["2026-11-03"].refresh, { written: 1, removed: 0 });

  // 11-03 판을 그 주 신고 창(11-02 주)으로 읽는다. 도장만 보면 11-03 에 찍힌 323행(재생 ③)이 새 신고이고, 첫 관측일로 읽으면 진짜 새 신원 9행만 남는다.
  const WEEK = { basis: "arrival", from: "2026-11-02", to: "2026-11-04", until: "2026-11-09", weeks: 1 };
  const pick = async (dir, withSeen) => {
    const read = (kind, code, ym) => readSlotFile(kind, code, ym, dir);
    const seen = withSeen ? (kind, code, ym) => readFirstSeen(kind, code, ym, dir) : undefined;
    const { items } = await readWindowItems(SEEN_NOW, WEEK, read, seen);
    return (items.get("sale:11230") ?? []).map((row) => row.item);
  };
  const keys = (rows) => rows.map(itemKey).sort();
  assert.equal((await pick(out.dir, false)).length, 323);
  const counted = await pick(out.dir, true);
  assert.equal(counted.length, 9);
  const baseIds = new Set(JSON.parse(fixture.files["2026-10-31"]).items.map(identity));
  assert.equal(counted.filter((item) => baseIds.has(identity(item))).length, 0, "10-31 에 있던 신원이 새 신고로 셌다");
  // 실제 이력(11-01·02 의 77행 판도 쓰고 첫 관측일을 갱신)과 같은 행을 든다 - 보류가 신고 창을 바꾸지 않는다.
  const actualDir = await actualHistory(days);
  assert.deepEqual(keys(counted), keys(await pick(actualDir, true)));
  assert.equal(out["2026-11-03"].seen, await seenText(actualDir), "11-03 첫 관측일 상태도 실제 이력과 바이트까지 같다");
});

test("조건 5: 반영하는 응답은 지금까지의 buildSlotFile → writeSlotFile 과 바이트까지 같다(trackArrivals 뜻 불변). 보류 중 C1 입력은 저장 슬롯 그대로다", async () => {
  // 같은 연쇄(11-03 실제 판 → 11-04 응답)를 옛 경로와 새 경로로 쓴다.
  const dirs = await Promise.all([0, 1].map(() => mkdtemp(path.join(tmpdir(), "drop-same-"))));
  const v4 = JSON.parse(fixture.files["2026-11-04"]);
  for (const dir of dirs) {
    await mkdir(path.join(dir, "sale"));
    await writeFile(path.join(dir, "sale", "11230-202610.json"), fixture.files["2026-11-03"]);
  }
  await writeSlotFile(buildSlotFile({ kind: "sale", code: "11230", yearMonth: "202610", items: v4.items, totalCount: v4.totalCount, observedAt: v4.observedAt }), dirs[0]);
  const result = await receiveSlot({ kind: "sale", code: "11230", yearMonth: "202610", response: { items: v4.items, totalCount: v4.totalCount }, observedAt: v4.observedAt, holds: {}, dir: dirs[1] });
  assert.equal(result.applied, true);
  assert.equal(result.added, 12);
  const [old, now] = await Promise.all(dirs.map((dir) => readFile(path.join(dir, "sale", "11230-202610.json"), "utf8")));
  assert.equal(now, old);
  assert.equal(now, fixture.files["2026-11-04"], "실제 이력의 11-04 판과도 같다");

  // C1 함수는 그대로 두고 입력이 바뀐다: 보류한 날의 원장 C1 은 10-31 판(390행)을 읽는다. 11-01 실제 판(77행)과는 다르다.
  const out = await replay();
  const c1 = (text) => c1Lines("2026-11-01", [{ kind: "sale", json: JSON.parse(text) }]);
  assert.deepEqual(c1(out["2026-11-01"].text), c1(fixture.files["2026-10-31"]));
  assert.notDeepEqual(c1(out["2026-11-01"].text), c1(fixture.files["2026-11-01"]));
});

test("수집기: 줄어든 응답은 슬롯을 쓰지 않고 실행 요약에 경고하며, 4번째 수집일에도 같으면 반영한다(같은 날 회차는 하루로 센다)", async (t) => {
  const NOW = new Date("2026-10-21T03:00:00Z");
  const month = windowMonths(NOW)[0];
  let dropped = false;
  const server = await startFakeMolit((kind, { code, yearMonth }) => {
    if (kind === "rent") return successXml([rentItem()]);
    if (code === "11110" && yearMonth === month) return successXml(rows(dropped ? 5 : 40).map((item) => ({ ...item, dealMonth: Number(month.slice(4)) })));
    return successXml([saleItem()]);
  });
  t.after(() => server.close());
  const dir = await mkdtemp(path.join(tmpdir(), "drop-collect-"));
  const rawDir = path.join(dir, "raw");
  const summaryFile = path.join(dir, "summary.md");
  const slotFile = path.join(rawDir, "sale", `11110-${month}.json`);

  const collect = async (now) => {
    const { stdout, stderr } = await run("node", ["scripts/fetch-realestate.ts"], {
      cwd: root,
      env: {
        ...process.env,
        MOLIT_API_ENDPOINT: server.saleUrl, MOLIT_API_KEY: "test", MOLIT_RENT_API_ENDPOINT: server.rentUrl, MOLIT_RENT_API_KEY: "test",
        REALESTATE_RAW_DIR: rawDir, MOLIT_BACKFILL_LIMIT: "0", MOLIT_SWEEP_DELAY_MS: "0", MOLIT_RETRY_MS: "0",
        REALESTATE_NOW: now, GITHUB_STEP_SUMMARY: summaryFile,
      },
    });
    return stdout + stderr;
  };

  await collect("2026-10-21T03:00:00Z");
  const before = await readFile(slotFile, "utf8");
  assert.equal(JSON.parse(before).count, 40);
  assert.equal(existsSync(path.join(rawDir, "realestate-holds.json")), false, "보류가 없으면 파일도 없다");

  dropped = true;
  const plan = [
    ["2026-10-22T03:00:00Z", 1],
    ["2026-10-22T09:00:00Z", 1], // 같은 KST 날짜의 두 번째 회차
    ["2026-10-23T03:00:00Z", 2],
    ["2026-10-24T03:00:00Z", 3],
  ];
  for (const [now, n] of plan) {
    const out = await collect(now);
    assert.equal(await readFile(slotFile, "utf8"), before, `${now}: 보류 중 슬롯이 바뀌었다`);
    assert.match(out, new RegExp(`::warning::실거래 원본 종로구 ${month} 매매: 절반 아래\\(저장 40행 → 응답 5행\\) - 보류 ${n}/3 수집일째`), out);
    const holds = JSON.parse(await readFile(path.join(rawDir, "realestate-holds.json"), "utf8"));
    assert.deepEqual(Object.keys(holds), [`sale:11110:${month}`]);
    assert.equal(holds[`sale:11110:${month}`].days.length, n);
  }
  const summary = await readFile(summaryFile, "utf8");
  assert.match(summary, /### 실거래 수집: 줄어든 응답 \(#863\)/);
  assert.match(summary, new RegExp(`\\| 종로구 ${month} 매매 \\(\`sale:11110:${month}\`\\) \\| 절반 아래\\(저장 40행 → 응답 5행\\) \\| 보류 3/3 수집일째`));

  const out = await collect("2026-10-25T03:00:00Z");
  assert.match(out, /3 수집일 보류 뒤에도 같아 반영/, out);
  assert.equal(JSON.parse(await readFile(slotFile, "utf8")).count, 5);
  assert.equal(existsSync(path.join(rawDir, "realestate-holds.json")), false, "반영하면 보류 파일이 지워진다");
});
