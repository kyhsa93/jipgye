// #862 2단계 조건 6·7 - 등기·해제·동만 붙어 해시가 바뀐 행과 응답에서 빠졌다 돌아온 행은 신고 기준 대표값과 week-digest 에서 새 신고가 아니다.
// 도착일은 슬롯 밖 상태(raw/first-seen)에 쌓은 「행 신원의 첫 관측일」로 앞당겨 읽고, 슬롯·arrivals 는 바이트까지 그대로이며, 원장 C1 은 상태를 읽지 않는다.
// 입력은 전부 고정이고 임시 폴더·임시 저장소에서만 돈다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { buildSlotFile, itemKey, readSlotFile, writeSlotFile } from "../scripts/realestate-raw.ts";
import {
  BEFORE_TRACKING,
  IDENTITY_SKIP,
  effectiveArrivals,
  firstSeenPath,
  parseFirstSeen,
  readFirstSeen,
  refreshFirstSeen,
  rowIdentity,
  serializeFirstSeen,
  updateFirstSeen,
} from "../scripts/realestate-first-seen.ts";
import { readWindowItems } from "../scripts/build-realestate.ts";
import { buildWeekDigest } from "../scripts/build-week-digest.ts";
import { summarizeWindow, uniqueArrivals } from "../scripts/week-digest.ts";
import { buildLedger, run as ledgerRun } from "../scripts/ledger-snapshot.ts";
import { complexFiles, rawSlots } from "./ledger-fixtures/source.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sale = (floor, extra = {}) => ({
  aptDong: "", aptNm: "시험단지", buildYear: 2010, cdealDay: "", cdealType: "", dealAmount: "50,000", dealDay: 8, dealMonth: 10, dealYear: 2026,
  dealingGbn: "직거래", excluUseAr: 30, floor, rgstDate: "", sggCd: 11230, umdNm: "답십리동", ...extra,
});
const REG = { rgstDate: "26.11.02", aptDong: "101" };

test("신원: 등기일·해제·동만 다르면 같은 신원, 다른 칸이 다르면 다른 신원", () => {
  assert.deepEqual([...IDENTITY_SKIP], ["rgstDate", "cdealType", "cdealDay", "aptDong"]);
  const base = rowIdentity(sale(3));
  for (const extra of [REG, { cdealType: "O", cdealDay: "26.11.03" }, { aptDong: "102" }]) assert.equal(rowIdentity(sale(3, extra)), base, JSON.stringify(extra));
  for (const extra of [{ floor: 4 }, { dealAmount: "50,001" }, { dealDay: 9 }, { dealingGbn: "중개거래" }]) assert.notEqual(rowIdentity(sale(3, extra)), base, JSON.stringify(extra));
  assert.notEqual(itemKey(sale(3, REG)), itemKey(sale(3)), "전제: 등기일이 붙으면 해시(itemKey)는 바뀐다");
});

const slotOf = (rows, arrivals) => ({ items: rows, arrivals: Object.fromEntries(arrivals.map(([item, day]) => [itemKey(item), day])) });

test("짝짓기: 같은 신원의 행이 여럿이면 정렬한 도장과 정렬한 기억을 차례로 짝지어 이른 쪽을 쓴다 - 새 거래 하나는 새 도착으로 남는다", () => {
  const seen = new Map([[rowIdentity(sale(3)), ["2026-10-21"]]]);
  // 같은 신원 둘: 하나는 등기가 붙어 11-03 에 다시 찍혔고, 하나는 11-04 에 새로 들어온 다른 거래다.
  const file = slotOf([sale(3, REG), sale(3, { aptDong: "105" })], [[sale(3, REG), "2026-11-03"], [sale(3, { aptDong: "105" }), "2026-11-04"]]);
  assert.deepEqual(effectiveArrivals(file, seen), ["2026-10-21", "2026-11-04"]);
  assert.deepEqual(effectiveArrivals(file, null), ["2026-11-03", "2026-11-04"], "기억이 없으면 도장 그대로(예전 결과)");
  assert.equal(updateFirstSeen(seen, file), true);
  assert.deepEqual(seen.get(rowIdentity(sale(3))), ["2026-10-21", "2026-11-04"]);
  assert.deepEqual(effectiveArrivals(file, seen), ["2026-10-21", "2026-11-04"], "갱신 전이든 뒤든 답이 같다");
  assert.equal(updateFirstSeen(seen, file), false, "같은 판으로 다시 갱신하면 바뀌지 않는다");
  // 도장 없는 행(추적 전부터 있던 행)은 어느 창에도 들지 않고, 그 신원이 나중에 다시 찍혀도 추적 전 날로 읽는다.
  const old = slotOf([sale(7)], []);
  const mem = new Map();
  updateFirstSeen(mem, old);
  assert.deepEqual(mem.get(rowIdentity(sale(7))), [BEFORE_TRACKING]);
  assert.deepEqual(effectiveArrivals(old, mem), [undefined]);
  assert.deepEqual(effectiveArrivals(slotOf([sale(7, REG)], [[sale(7, REG), "2026-11-03"]]), mem), [BEFORE_TRACKING]);
});

test("상태 파일: 날 순·신원 순 한 날 한 줄이고 같은 입력이면 같은 바이트다, 다시 읽으면 같은 기억이다", () => {
  const seen = new Map([["bbbbbbbbbbbb", ["2026-11-03"]], ["aaaaaaaaaaaa", [BEFORE_TRACKING, "2026-11-03"]]]);
  const text = serializeFirstSeen(seen);
  assert.equal(text, '{\n"0000-00-00":["aaaaaaaaaaaa"],\n"2026-11-03":["aaaaaaaaaaaa","bbbbbbbbbbbb"]\n}\n');
  assert.equal(serializeFirstSeen(parseFirstSeen(JSON.parse(text))), text);
  assert.equal(serializeFirstSeen(new Map()), "{}\n");
});

// 하루 수집을 흉내 낸다: 슬롯을 그날 판으로 쓰고(trackArrivals 가 도장을 찍는다) 빌드처럼 기억을 갱신한다.
async function day(dir, date, rows, { refresh = true } = {}) {
  const observedAt = `${date}T03:00:00.000Z`;
  await writeSlotFile(buildSlotFile({ kind: "sale", code: "11230", yearMonth: "202610", items: rows, observedAt }), dir);
  if (refresh) await refreshFirstSeen(["202611", "202610"], ["11230"], { dir, readSlot: readSlotFile });
}
const bulk = (extra = {}) => Array.from({ length: 12 }, (_, i) => sale(10 + i, extra));
const other = [sale(1, { aptNm: "다른단지", dealingGbn: "중개거래", dealAmount: "80,000" })];

/** 313행 사건의 축소판: 10-21 에 12행이 들어오고, 11-01 에 빠졌다가, 11-03 에 등기일·동이 붙어 돌아온다. 11-03 에는 진짜 새 행 하나도 들어온다. */
async function restampHistory({ refresh = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "first-seen-"));
  await day(dir, "2026-10-10", other, { refresh });
  await day(dir, "2026-10-21", [...other, ...bulk()], { refresh });
  await day(dir, "2026-11-01", other, { refresh });
  const fresh = sale(30, { aptNm: "새단지", dealDay: 30 });
  await day(dir, "2026-11-03", [...other, ...bulk(REG), fresh], { refresh });
  return { dir, fresh };
}
const NOW = new Date("2026-11-04T03:00:00Z");
const WEEK = { basis: "arrival", from: "2026-11-02", to: "2026-11-04", until: "2026-11-09", weeks: 1 };
const picked = async (dir, readSeen) => {
  const read = (kind, code, ym) => readSlotFile(kind, code, ym, dir);
  const { items } = await readWindowItems(NOW, WEEK, read, readSeen ? (kind, code, ym) => readFirstSeen(kind, code, ym, dir) : undefined);
  return (items.get("sale:11230") ?? []).map((row) => row.item);
};

test("대표값 창: 등기가 붙어 다시 찍힌 행과 빠졌다 돌아온 행은 이번 주 새 신고가 아니고, 진짜 새 행만 든다", async () => {
  const { dir, fresh } = await restampHistory();
  const before = await picked(dir, false);
  assert.equal(before.length, 13, "전제: 도장만 보면 다시 찍힌 12행이 새 신고로 든다");
  assert.deepEqual(await picked(dir, true), [fresh]);
  // 기억에는 12행이 10-21 로 남아 있다(빠졌던 11-01 에도 지우지 않았다).
  const seen = await readFirstSeen("sale", "11230", "202610", dir);
  assert.deepEqual(seen.get(rowIdentity(sale(10))), ["2026-10-21"]);
  // 10-19 주 창으로 읽으면 그 12행은 첫 관측 주(10-21)에 든다.
  const read = (kind, code, ym) => readSlotFile(kind, code, ym, dir);
  const october = await readWindowItems(NOW, { ...WEEK, from: "2026-10-19", until: "2026-10-26" }, read, (k, c, ym) => readFirstSeen(k, c, ym, dir));
  assert.equal(october.items.get("sale:11230").length, 12);
});

test("조건 7: 기억을 갱신하고 창을 읽어도 슬롯 파일(arrivals 포함)은 바이트까지 같다, 기억 없이 쓴 슬롯과도 같다", async () => {
  const withSeen = await restampHistory();
  const without = await restampHistory({ refresh: false });
  const bytes = (dir) => readFileSync(path.join(dir, "sale", "11230-202610.json"));
  const sha = (dir) => createHash("sha256").update(bytes(dir)).digest("hex");
  const first = sha(withSeen.dir);
  await refreshFirstSeen(["202611", "202610"], ["11230"], { dir: withSeen.dir, readSlot: readSlotFile });
  await picked(withSeen.dir, true);
  await buildWeekDigest({ now: NOW, dir: withSeen.dir, out: path.join(withSeen.dir, "out", "week-digest.json") });
  assert.equal(sha(withSeen.dir), first, "갱신·읽기 뒤에도 같다");
  // 슬롯 내용(관측 시각 두 칸 제외)은 기억을 쓰든 안 쓰든 같다 - 수집기(trackArrivals)가 기억을 읽지 않는다.
  const strip = (dir) => {
    const { observedAt: _a, previousObservedAt: _b, ...rest } = JSON.parse(bytes(dir));
    return rest;
  };
  assert.deepEqual(strip(withSeen.dir), strip(without.dir));
  assert.deepEqual(readdirSync(withSeen.dir).sort(), ["first-seen", "out", "sale"], "상태는 raw/<kind>/ 밖(first-seen)에만 쓴다");
});

test("갱신은 바뀐 파일만 쓰고, 창 밖 달의 상태는 지운다", async () => {
  const { dir } = await restampHistory();
  const again = await refreshFirstSeen(["202611", "202610"], ["11230"], { dir, readSlot: readSlotFile });
  assert.deepEqual(again, { written: 0, removed: 0 });
  const moved = await refreshFirstSeen(["202612", "202611"], ["11230"], { dir, readSlot: readSlotFile });
  assert.deepEqual(moved, { written: 0, removed: 1 });
  assert.equal(await readFirstSeen("sale", "11230", "202610", dir), null);
});

test("week-digest: 신고 건수는 첫 관측일로 창을 고르고, 해제 도착 수와 수집일은 도장 그대로다", async () => {
  const { dir } = await restampHistory();
  // 11-03 에 해제가 붙어 다시 찍힌 행도 하나 둔다.
  const cancelled = sale(10, { ...REG, cdealType: "O", cdealDay: "26.11.04" });
  await day(dir, "2026-11-05", [...other, cancelled, ...bulk(REG).slice(1), sale(30, { aptNm: "새단지", dealDay: 30 })]);
  const out = path.join(dir, "out", "week-digest.json");
  const digest = await buildWeekDigest({ now: new Date("2026-11-05T03:00:00Z"), dir, out });
  // 이번 창(10-30~11-05): 새 행 하나만 매매다. 다시 찍힌 11행은 10-21 주로 돌아가고, 해제행은 해제 도착으로 한 번 센다.
  assert.equal(digest.current.sale, 1);
  assert.equal(digest.current.cancelArrived, 1);
  assert.equal(digest.previous.sale, 0);
  // 같은 원본을 기억 없이 세면(예전) 다시 찍힌 행이 이번 창에 든다.
  const file = await readSlotFile("sale", "11230", "202610", dir);
  const rows = uniqueArrivals([{ kind: "sale", district: "11230", items: file.items, arrivals: file.arrivals }], itemKey);
  assert.equal(summarizeWindow(rows, digest.current, new Map(), []).sale, 12);
});

test("빌드 프로세스: build-realestate 가 상태를 만들고 슬롯·arrivals 바이트는 그대로다", async () => {
  const { dir } = await restampHistory({ refresh: false });
  const slotPath = path.join(dir, "sale", "11230-202610.json");
  const before = readFileSync(slotPath);
  const dataDir = await mkdtemp(path.join(tmpdir(), "first-seen-data-"));
  await promisify(execFile)("node", ["scripts/build-realestate.ts"], {
    cwd: root,
    env: { ...process.env, REALESTATE_RAW_DIR: dir, REALESTATE_DATA_DIR: dataDir, REALESTATE_NOW: NOW.toISOString() },
  });
  assert.ok(readFileSync(slotPath).equals(before));
  assert.ok(readFileSync(firstSeenPath("sale", "11230", "202610", dir), "utf8").includes('"2026-11-03"'), "상태 파일이 생겼다");
  assert.deepEqual((await readdir(path.join(dir, "first-seen"))).sort(), ["sale"]);
});

// 조건 7: 원장 C1 은 상태를 읽지 않는다 - 같은 소스 커밋 모양에 상태 파일이 있든 없든 정본 해시가 같다. 픽스처는 202610(C1 범위) 슬롯이고 등기가 붙은 행이 있다.
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
function commit(cwd, files, msg) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(cwd, p)), { recursive: true });
    writeFileSync(path.join(cwd, p), text);
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--allow-empty", "-m", msg);
  return git(cwd, "rev-parse", "HEAD");
}
function sourceFiles() {
  const files = {};
  complexFiles().forEach(({ json }, i) => (files[`docs/data/complex-price-d${String.fromCharCode(97 + i)}.json`] = `${JSON.stringify(json)}\n`));
  for (const { kind, json } of rawSlots()) files[`raw/${kind}/${json.district}-${json.yearMonth}.json`] = `${JSON.stringify(json)}\n`;
  return files;
}

test("조건 7: ledger-snapshot --dry-run 의 C1 줄은 상태 파일이 있든 없든 같다(메타 줄만 소스 커밋이 다르다)", () => {
  const OK = "제한 없음";
  const linesOf = (withState) => {
    const dir = mkdtempSync(path.join(tmpdir(), "ledger-fs-"));
    git(dir, "init", "-q", "-b", "main");
    const prereg = commit(dir, { "research/PREREG.md": "v1\n" }, "docs: 사전 등록");
    const files = sourceFiles();
    if (withState) {
      // 등기가 붙어 다시 찍힌 행(rgstDate 26.10.30)의 신원을 더 이른 날로 기억하는 상태 - C1 이 읽는다면 그 행의 경과일 구간이 바뀐다.
      const seen = new Map([[rowIdentity(rawSlots()[0].json.items[3]), ["2026-10-02"]]]);
      for (const [kind, name] of [["sale", "11110-202610"], ["rent", "11110-202610"]]) files[`raw/first-seen/${kind}/${name}.json`] = serializeFirstSeen(seen);
    }
    const sha = commit(dir, files, "chore: 데일리 데이터 갱신 2026-10-31");
    const outDir = path.join(dir, "tmp-out");
    ledgerRun({ month: "2026-11", licenseSale: OK, licenseRent: OK, cwd: dir, prereg, today: "2026-11-01", log: () => {}, dryRun: true, sourceCommit: sha, outDir });
    const text = gunzipSync(readFileSync(path.join(outDir, "2026-11.jsonl.gz"))).toString("utf8");
    return { text, sha, prereg };
  };
  const plain = linesOf(false);
  const stated = linesOf(true);
  const c1 = (text) => text.split("\n").filter((line) => line.startsWith('{"c1"'));
  assert.ok(c1(plain.text).length > 0, "전제: C1 줄이 있다");
  assert.deepEqual(c1(stated.text), c1(plain.text));
  // 상태 파일만 다른 두 소스의 정본은 메타 줄(소스 커밋)만 빼면 같고, 상태 없는 쪽은 상태를 모르는 buildLedger 의 출력과 같다.
  const body = (text) => text.split("\n").filter((line) => !line.startsWith('{"meta"'));
  assert.deepEqual(body(stated.text), body(plain.text));
  assert.equal(plain.text, buildLedger({ month: "2026-11", sourceCommit: plain.sha, license: { sale: OK, rent: OK, checkedOn: "2026-11-01" }, complexFiles: complexFiles(), rawSlots: rawSlots(), prereg: plain.prereg }));
});
