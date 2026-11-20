// #861 - 얼린 매매 슬롯 재수집. 덧씌움 읽기 층(realestate-recollect.ts)·회차(recollect-sale.ts)·소비자 연결·불변 조건(슬롯·arrivals·첫 관측일·주간 집계·C1).
// 입력은 전부 손으로 만든 슬롯·임시 git 저장소·가짜 국토부 서버·가짜 gh 다(#8). 국토부 API 는 부르지 않는다(소유자 고지 전).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { errorXml, rentItem, saleItem, startFakeMolit, successXml } from "./helpers/fake-molit.mjs";
import {
  SALE_FIELDS, buildOverlay, diffRows, mergeRecollect, overlayPath, readOverlay, readRecollectedSlot, serializeOverlay, unknownFields, writeOverlay,
} from "../scripts/realestate-recollect.ts";
import {
  CALL_MARGIN, FIRST_ROUND, FIRST_ROUND_EXTRA, checkApproval, consecutiveStep, dailyBusy, fetchRound, identityDigest, planRound, processRound, roundLines, roundPath,
} from "../scripts/recollect-sale.ts";
import { DROP_ROWS, REASONS, judgeSlotResponse, reasonText } from "../scripts/realestate-guard.ts";
import { buildSlotFile, itemKey, readSlotFile, writeSlotFile } from "../scripts/realestate-raw.ts";
import { readFirstSeen, refreshFirstSeen, rowIdentity } from "../scripts/realestate-first-seen.ts";
import { readRawSales } from "../scripts/build-cancellation.ts";
import { readAll } from "../scripts/build-district-change.ts";
import { readWindowItems } from "../scripts/build-realestate.ts";
import { buildWeekDigest } from "../scripts/build-week-digest.ts";
import { buildLedger, canonicalHash, readSource, run as ledgerRun } from "../scripts/ledger-snapshot.ts";
import { complexFiles, rawSlots } from "./ledger-fixtures/source.mjs";

const root = path.resolve(import.meta.dirname, "..");
const exec = promisify(execFile);
const src = (rel) => readFile(path.join(root, rel), "utf8");

// 저장 사본과 같은 20칸 행. i 로 층을 갈라 행마다 해시가 다르다.
const row = (yearMonth, i, extra = {}) =>
  saleItem({
    aptDong: "", buyerGbn: "개인", cdealDay: "", cdealType: "", estateAgentSggNm: "서울 종로구", jibun: 10 + (i % 3), landLeaseholdGbn: "N", rgstDate: "",
    sggCd: 11110, slerGbn: "개인", dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)), dealDay: 1 + (i % 28), floor: i + 1, ...extra,
  });
const rows = (yearMonth, n, from = 0) => Array.from({ length: n }, (_, i) => row(yearMonth, from + i));
const canon = (yearMonth, items) => buildSlotFile({ kind: "sale", code: "11110", yearMonth, items, observedAt: "2026-11-10T05:00:00.000Z" }).items;

/** 슬롯 하나를 두 번 받아 arrivals 가 있는 모양으로 쓴다(둘째 판에 새로 보인 행이 도장을 받는다). */
async function writeTwice(dir, code, yearMonth, first, second) {
  await writeSlotFile(buildSlotFile({ kind: "sale", code, yearMonth, items: first, observedAt: "2026-08-10T00:00:00.000Z" }), dir);
  await writeSlotFile(buildSlotFile({ kind: "sale", code, yearMonth, items: second, observedAt: "2026-08-17T00:00:00.000Z" }), dir);
}

/** 매매 두 슬롯(202605 30행·202606 25행)과 전월세 하나, 첫 관측일 상태까지 갖춘 raw. */
async function fixtureRaw() {
  const dir = await mkdtemp(path.join(tmpdir(), "recollect-"));
  const raw = path.join(dir, "raw");
  await writeTwice(raw, "11110", "202605", rows("202605", 25), rows("202605", 30));
  await writeTwice(raw, "11140", "202606", rows("202606", 20), rows("202606", 25));
  await writeSlotFile(buildSlotFile({ kind: "rent", code: "11110", yearMonth: "202605", items: [{ aptNm: "가", deposit: "1", dealYear: 2026, dealMonth: 5, dealDay: 1 }], observedAt: "2026-08-17T00:00:00.000Z" }), raw);
  await refreshFirstSeen(["202605", "202606"], ["11110", "11140"], { dir: raw, readSlot: readSlotFile });
  return { dir, raw };
}

/** 202605 응답: 앞 10행에 등기일이 붙고, 마지막 행이 사라지고, 새 행 하나. */
const response0605 = () => {
  const base = rows("202605", 30);
  const items = base.slice(0, 29).map((item, i) => (i < 10 ? { ...item, rgstDate: "26.09.01", aptDong: `${i}동` } : item));
  items.push(row("202605", 40, { dealingGbn: "직거래" }));
  return { items, totalCount: items.length };
};

/** raw 아래 파일(덧씌움 폴더 제외) → sha256. */
function snapshot(raw) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const rel = path.relative(raw, p);
      if (rel === "recollect") continue;
      if (statSync(p).isDirectory()) walk(p);
      else out[rel] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(raw);
  return out;
}

const NOW = new Date("2026-11-10T05:00:00Z"); // KST 14:00, 10일
const plan = () => planRound({ now: NOW });

// ---- 읽기 층 ----

test("덧씌움: 변경 행·새 행·사라진 행(해시)만 담고, 합치면 다시 받은 응답과 행 단위로 같다. 차이가 없으면 파일이 없다", async () => {
  const { raw } = await fixtureRaw();
  const slot = await readSlotFile("sale", "11110", "202605", raw);
  const fetched = canon("202605", response0605().items);
  const overlay = buildOverlay({ slot, items: fetched, totalCount: fetched.length, observedAt: NOW.toISOString() });
  assert.equal(overlay.changed.length, 10);
  assert.equal(overlay.appeared.length, 1);
  assert.equal(overlay.gone.length, 1);
  assert.match(overlay.gone[0], /^[0-9a-f]{12}$/, "사라진 행은 해시만 - 본문은 슬롯에 그대로 있다");
  assert.deepEqual(overlay.base, { observedAt: slot.observedAt, count: 30 });
  assert.deepEqual(mergeRecollect(slot, overlay).items, fetched);
  assert.equal(mergeRecollect(slot, overlay).arrivals, slot.arrivals, "합친 값의 arrivals 는 슬롯 것 그대로");
  assert.equal(buildOverlay({ slot, items: slot.items, totalCount: 30, observedAt: NOW.toISOString() }), null);

  // 덧씌움 행의 칸은 저장 사본의 칸뿐이다(#175 제한 1).
  for (const item of [...overlay.changed.map((r) => r.item), ...overlay.appeared]) assert.deepEqual(Object.keys(item).filter((k) => !SALE_FIELDS.includes(k)), []);
  assert.deepEqual(unknownFields([{ ...row("202605", 1), newField: 1 }]), ["newField"]);

  // 같은 입력이면 같은 바이트, 한 행이 한 줄.
  const text = serializeOverlay(overlay);
  assert.equal(serializeOverlay(buildOverlay({ slot, items: [...fetched].reverse(), totalCount: fetched.length, observedAt: NOW.toISOString() })), text);
  assert.equal(text.trimEnd().split("\n").length, 1 + 10 + 1 + 1 + 1, "머리+changed 10줄+appeared 1줄+닫는 줄");
  assert.deepEqual(JSON.parse(text), overlay);
});

test("덧씌움: 없거나 낡았거나(슬롯이 다시 쓰임) 없앨 행이 슬롯에 없으면 슬롯 그대로 읽는다", async () => {
  const { raw } = await fixtureRaw();
  const slot = await readSlotFile("sale", "11110", "202605", raw);
  const fetched = canon("202605", response0605().items);
  const overlay = buildOverlay({ slot, items: fetched, totalCount: fetched.length, observedAt: NOW.toISOString() });
  assert.equal(mergeRecollect(slot, null), slot);
  assert.equal(mergeRecollect(slot, { ...overlay, base: { ...overlay.base, observedAt: "2026-11-01T00:00:00.000Z" } }), slot);
  assert.equal(mergeRecollect(slot, { ...overlay, base: { ...overlay.base, count: 31 } }), slot);
  assert.equal(mergeRecollect(slot, { ...overlay, gone: [...overlay.gone, "ffffffffffff"] }), slot);

  // 파일로: 쓰고 읽고, 차이가 없어지면 지운다. 덧씌움은 전월세에 걸지 않는다.
  assert.equal(await writeOverlay("11110", "202605", overlay, raw), true);
  assert.equal(await writeOverlay("11110", "202605", overlay, raw), false);
  assert.deepEqual((await readRecollectedSlot("sale", "11110", "202605", raw)).items, fetched);
  assert.deepEqual(await readRecollectedSlot("rent", "11110", "202605", raw), await readSlotFile("rent", "11110", "202605", raw));
  assert.deepEqual(await readRecollectedSlot("sale", "11140", "202606", raw), await readSlotFile("sale", "11140", "202606", raw));
  assert.equal(await writeOverlay("11110", "202605", null, raw), true);
  assert.equal(await readOverlay("11110", "202605", raw), null);
});

test("자리: raw/recollect/sale/<구>-<달>.json - 슬롯 읽기(raw/<kind>/ 바로 아래)와 원장 C1 의 경로 패턴 밖이다", () => {
  const rel = path.relative("/r", overlayPath("11110", "202605", "/r"));
  assert.equal(rel, "recollect/sale/11110-202605.json");
  assert.doesNotMatch(`raw/${rel}`, /^raw\/(sale|rent)\/(\d{5})-(\d{6})\.json$/);
  assert.equal(path.relative("/r", roundPath("202611", "/r")), "recollect/round-202611.json");
});

// ---- 소비자 ----

test("소비자: 시세 칸·해제·등기는 합친 값을, 직거래·갈아타기·주간 집계·week-digest·동명 단지는 저장 그대로 읽는다. 덧씌움이 없으면 같다", async () => {
  const { raw } = await fixtureRaw();
  const stored = await readRawSales(["202605", "202606"], raw, readSlotFile);
  assert.deepEqual(await readRawSales(["202605", "202606"], raw), stored, "덧씌움 없음 = 저장");
  const before = await readAll(raw);
  assert.deepEqual(before.recollected, before.items);

  const slot = await readSlotFile("sale", "11110", "202605", raw);
  const fetched = canon("202605", response0605().items);
  await writeOverlay("11110", "202605", buildOverlay({ slot, items: fetched, totalCount: fetched.length, observedAt: NOW.toISOString() }), raw);
  const merged = await readRawSales(["202605", "202606"], raw);
  assert.equal(merged["종로구"].filter((item) => item.rgstDate === "26.09.01").length, 10);
  assert.equal(merged["종로구"].length, 30);
  assert.deepEqual(await readRawSales(["202605", "202606"], raw, readSlotFile), stored);
  const after = await readAll(raw);
  assert.deepEqual(after.items, before.items, "갈아타기·가격대 변화는 저장 그대로");
  assert.equal(after.recollected.filter((item) => item.rgstDate === "26.09.01").length, 10);

  // 연결(글자): 사이트 빌더 가운데 읽기 층을 부르는 것은 여섯이다 - 시세 칸·해제·등기(#861), 단지 추이(#920), 거래 검색·예산(realestate-source.ts)과
  // 전세가율·전세 비중(build-complex-ratio.ts readRaw)의 매매(#900 (가)). 정정 Release(build-correction-release.ts)는 correction-release-recollect 시험이 본다.
  const price = await src("scripts/build-complex-price.ts");
  assert.equal([...price.matchAll(/readRecollectedSlot\("sale", code, m\)/g)].length, 2, "창 일곱 달과 1년 전 석 달");
  assert.match(price, /readSameNames\(\)/);
  const cancel = await src("scripts/build-cancellation.ts");
  assert.match(cancel, /export async function readRawSales\(months, dir\?, read = readRecollectedSlot\)/);
  assert.match(cancel, /tryWriteDirectDeals\(\{ byDistrict: await readRawSales\(retentionMonths, undefined, readSlotFile\)/);
  const change = await src("scripts/build-district-change.ts");
  assert.match(change, /writeRegistrationSoft\(\{ items: recollected, now, sameNames \}\)/);
  assert.match(change, /buildPayload\(\{ items, now, official, survey, sameNames(, timing)? \}\)/); // timing: #858 계산 시간 로그
  const history = await src("scripts/build-complex-history.ts");
  assert.match(history, /readRecollectedSlot\("sale", code, m, rawDir\)/);
  // 거래 검색·예산: 매매만 기본값이 합친 값이고, 전월세(대표 시세가 쓰는 readRentSource)와 collect 의 기본값은 저장 그대로다.
  const source = await src("scripts/realestate-source.ts");
  assert.match(source, /export async function readDealSource\(now, months = recentMonths\(now\), read = readRecollectedSlot\)/);
  assert.match(source, /export async function readRentSource\(now, months = recentMonths\(now\), read = readSlotFile\)/);
  assert.match(source, /async function collect\(kind, months, normalize, read = readSlotFile\)/);
  assert.match(await src("scripts/build-budget-deals.ts"), /const source = await readDealSource\(now\);/);
  // 전세가율·전세 비중: readRaw 의 매매 한 줄만 합친 값이고 전월세 줄은 저장 그대로다.
  const ratio = await src("scripts/build-complex-ratio.ts");
  assert.match(ratio, /readRecollectedSlot\("sale", code, ym, dir\)/);
  assert.match(ratio, /readSlotFile\("rent", code, ym, dir\)/);
  assert.doesNotMatch(ratio, /readSlotFile\("sale"/);
  for (const file of ["scripts/build-week-digest.ts", "scripts/build-realestate.ts", "scripts/ledger-snapshot.ts", "scripts/realestate-first-seen.ts", "scripts/build-direct-deals.ts", "scripts/realestate-raw.ts"]) {
    assert.doesNotMatch(await src(file), /realestate-recollect/, file);
  }
});

test("조건 1·4: 회차는 슬롯·arrivals·첫 관측일·전월세를 바이트까지 그대로 두고, 신고 기준 주간 집계·week-digest 가 회차 전후 같다", async () => {
  const { dir, raw } = await fixtureRaw();
  const before = snapshot(raw);
  const week = { basis: "arrival", from: "2026-08-17", until: "2026-08-24" };
  const read = (kind, code, ym) => readSlotFile(kind, code, ym, raw);
  const seen = (kind, code, ym) => readFirstSeen(kind, code, ym, raw);
  const windowBefore = await readWindowItems(new Date("2026-08-20T03:00:00Z"), week, read, seen);
  const digestBefore = await buildWeekDigest({ now: new Date("2026-08-20T03:00:00Z"), dir: raw, out: path.join(dir, "a.json") });

  const responses = new Map([["11110-202605", response0605()], ["11140-202606", { items: rows("202606", 25).map((item) => ({ ...item, rgstDate: "26.09.02" })), totalCount: 25 }]]);
  const { record, written } = await processRound({ plan: plan(), responses, observedAt: NOW.toISOString(), dir: raw, out: raw });
  assert.equal(written, 2);
  assert.equal(record.slots["11110-202605"].status, "applied");
  assert.deepEqual(snapshot(raw), before, "덧씌움 폴더 밖은 한 바이트도 바뀌지 않는다");

  assert.deepEqual(await readWindowItems(new Date("2026-08-20T03:00:00Z"), week, read, seen), windowBefore);
  const digestAfter = await buildWeekDigest({ now: new Date("2026-08-20T03:00:00Z"), dir: raw, out: path.join(dir, "b.json") });
  assert.deepEqual(digestAfter, digestBefore);
  assert.equal(await readFile(path.join(dir, "a.json"), "utf8"), await readFile(path.join(dir, "b.json"), "utf8"));
  assert.ok(digestBefore.current.sale > 0, "대조가 빈 값끼리가 아니다");
});

// ---- 원장 C1 (data-analyst 11-15 판정) ----

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

test("C1: 202610 이상 달의 덧씌움을 둔 커밋과 없는 커밋에서 ledger-snapshot --dry-run 정본 sha256 이 같다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "recollect-ledger-"));
  git(dir, "init", "-q", "-b", "main");
  const prereg = commit(dir, { "research/PREREG.md": "v1\n" }, "docs: 사전 등록");
  const files = {};
  complexFiles().forEach(({ json }, i) => (files[`docs/data/complex-price-d${String.fromCharCode(97 + i)}.json`] = `${JSON.stringify(json)}\n`));
  const slots = rawSlots();
  for (const { kind, json } of slots) files[`raw/${kind}/${json.district}-${json.yearMonth}.json`] = `${JSON.stringify(json)}\n`;
  const without = commit(dir, files, "chore: 데일리 데이터 갱신 2026-10-30");

  // 202610 매매 슬롯의 덧씌움: 등기가 붙은 행(changed), 사라진 행(gone), 새 행(appeared). C1 이 읽었다면 행·등기 수가 바뀐다.
  const sale = slots.find(({ kind, json }) => kind === "sale" && json.yearMonth === "202610").json;
  const items = sale.items.slice(1).map((item, i) => (i === 0 ? { ...item, rgstDate: "26.11.05" } : item));
  items.push({ ...sale.items[0], dealDay: 20, floor: 15 });
  const fetched = buildSlotFile({ kind: "sale", code: "11110", yearMonth: "202610", items, observedAt: "2026-11-10T05:00:00.000Z" }).items;
  const overlay = buildOverlay({ slot: sale, items: fetched, totalCount: fetched.length, observedAt: "2026-11-10T05:00:00.000Z" });
  assert.ok(overlay.changed.length && overlay.gone.length && overlay.appeared.length, "세 갈래가 다 있다");
  const withOverlay = commit(dir, { [`raw/${path.relative("/r", overlayPath("11110", "202610", "/r"))}`]: serializeOverlay(overlay) }, "chore: 매매 재수집 202611");

  const go = (sourceCommit) =>
    ledgerRun({ month: "2026-11", licenseSale: "제한 없음", licenseRent: "제한 없음", dryRun: true, sourceCommit, outDir: path.join(dir, "out", sourceCommit), cwd: dir, prereg, today: "2026-11-01", log: () => {} });
  // 정본 meta 에 sourceCommit 이 들어 있어 커밋이 다르면 해시도 다르다. 그래서 「같은 소스 커밋」으로 맞춰 본다:
  // 덧씌움이 든 커밋(withOverlay)의 dry-run 해시 = 덧씌움이 없는 트리의 소스를 같은 sourceCommit 으로 센 정본 해시.
  const b = go(withOverlay);
  const plain = readSource(without, dir, prereg);
  const expected = buildLedger({ month: "2026-11", sourceCommit: withOverlay, license: { sale: "제한 없음", rent: "제한 없음", checkedOn: "2026-11-01" }, ...plain, prereg });
  assert.equal(b.hash, canonicalHash(expected));
  assert.equal(readSource(withOverlay, dir, prereg).rawSlots.length, plain.rawSlots.length, "덧씌움 파일은 C1 입력에 들지 않는다");
  const text = (res, sha) => gunzipSync(readFileSync(res.file)).toString("utf8").split(sha).join("<소스>");
  const a = go(without);
  assert.equal(text(b, withOverlay), text(a, without), "sourceCommit 밖은 한 글자도 같다");
  // 대조: 같은 행을 슬롯에 직접 썼다면 c1 이 갈린다(시험이 항상 참이 아니다).
  const direct = commit(dir, { "raw/sale/11110-202610.json": `${JSON.stringify({ ...sale, items: fetched, count: fetched.length, totalCount: fetched.length })}\n` }, "대조");
  assert.notEqual(text(go(direct), direct), text(a, without));
});

// ---- 판정·회차 ----

test("거부(조건 3): #863 판정 함수를 보류 일수 없이 쓴다 - 0행·totalCount·절반·10행 감소는 그 회차에 반영하지 않고 이유 글자를 남긴다", async () => {
  const text = await src("scripts/recollect-sale.ts");
  assert.match(text, /import \{ REASONS, judgeSlotResponse, reasonText \} from "\.\/realestate-guard\.ts";/);
  assert.match(text, /import \{ IDENTITY_SKIP, rowIdentity \} from "\.\/realestate-first-seen\.ts";/);
  assert.doesNotMatch(text, /nextHold|HOLD_DAYS|"rgstDate", "cdealType"/, "보류 일수·신원 칸을 복제하지 않는다");

  const cases = [
    ["zero", { items: [], totalCount: 0 }],
    ["totalCount", { items: rows("202605", 30), totalCount: 31 }],
    ["half", { items: rows("202605", 14), totalCount: 14 }],
    ["rows", { items: rows("202605", 30 - DROP_ROWS), totalCount: 30 - DROP_ROWS }],
  ];
  for (const [reason, response] of cases) {
    const { raw } = await fixtureRaw();
    const { record, written } = await processRound({ plan: plan(), responses: new Map([["11110-202605", response]]), observedAt: NOW.toISOString(), dir: raw, out: raw });
    const s = record.slots["11110-202605"];
    assert.equal(s.status, "rejected", reason);
    assert.equal(s.reason, reason);
    assert.equal(s.text, reasonText(judgeSlotResponse({ ok: true, count: 30 }, response)));
    assert.equal(written, 0);
    assert.equal(await readOverlay("11110", "202605", raw), null);
    assert.equal(record.table.find((r) => r.month === "202605").rejected, 1);
    assert.ok(roundLines(record).some((line) => line.includes("`11110-202605`") && line.includes(s.text)), reason);
  }
  // 사본에 없는 칸이 온 응답도 반영하지 않는다(#175 제한 1).
  const { raw } = await fixtureRaw();
  const extra = { items: rows("202605", 30).map((item) => ({ ...item, newField: "x" })), totalCount: 30 };
  const { record } = await processRound({ plan: plan(), responses: new Map([["11110-202605", extra]]), observedAt: NOW.toISOString(), dir: raw, out: raw });
  assert.equal(record.slots["11110-202605"].reason, "fields");
  assert.equal(await readOverlay("11110", "202605", raw), null);
});

test("연속 거부 네 갈래(pm 11-15): 0행·totalCount 는 늘 막고, 같은 신원 집합이면 둘째 회차에 반영, 다르면 막고, 창 밖으로 나가면 따로 적는다", async () => {
  const half = judgeSlotResponse({ ok: true, count: 40 }, { items: rows("202605", 15), totalCount: 15 });
  const zero = judgeSlotResponse({ ok: true, count: 40 }, { items: [], totalCount: 0 });
  const id = identityDigest(rows("202605", 15));
  assert.deepEqual(consecutiveStep(half, undefined, id), { apply: false, status: "rejected", note: null });
  // 1: 0행·totalCount 는 연속이어도 반영하지 않고 [오류] 이슈로.
  assert.equal(consecutiveStep(zero, { status: "rejected", reason: "zero", identity: identityDigest([]) }, identityDigest([])).apply, false);
  assert.equal(consecutiveStep(zero, { status: "rejected", reason: "half", identity: id }, identityDigest([])).status, "rejected-repeat-error");
  // 2: 같은 신원 집합(등기·해제·동만 달라도 같은 신원).
  const again = rows("202605", 15).map((item) => ({ ...item, rgstDate: "26.10.01", aptDong: "1동" }));
  assert.equal(identityDigest(again), id);
  assert.equal(rowIdentity(again[0]), rowIdentity(rows("202605", 1)[0]));
  assert.deepEqual(consecutiveStep(half, { status: "rejected", reason: "rows", identity: id }, identityDigest(again)), { apply: true, status: "applied-repeat", note: "연속 거부·같은 응답 - 반영" });
  // 3: 신원 집합이 다르면 막는다.
  assert.equal(consecutiveStep(half, { status: "rejected", reason: "half", identity: id }, identityDigest(rows("202605", 16))).status, "rejected-repeat-mismatch");

  // 회차 파일로 이어서: 1회차 거부 → 2회차 같은 응답이면 사라진 행까지 덧씌움에 담고 사라진 행 열에 센다. 슬롯·arrivals 는 그대로.
  const { raw } = await fixtureRaw();
  const before = snapshot(raw);
  const shrunk = { items: rows("202605", 18), totalCount: 18 }; // 30 → 18: 12행 감소(절반은 아님)
  const r1 = await processRound({ plan: plan(), responses: new Map([["11110-202605", shrunk]]), observedAt: NOW.toISOString(), dir: raw, out: raw });
  assert.equal(r1.record.slots["11110-202605"].reason, REASONS.rows);
  assert.equal(r1.record.table[1].gone, 0, "거부한 슬롯의 사라진 행은 열에 들지 않는다");
  const dec = new Date("2026-12-10T05:00:00Z");
  const plan2 = planRound({ now: dec, rounds: ["202611"] });
  assert.deepEqual(plan2.months, ["202606", "202607", "202608", "202609", "202610"]);
  // 4: 202605 는 12월 창 밖이다 - 연속이 생기지 않고 「거부 후 창 밖」으로 적는다.
  const r2 = await processRound({ plan: plan2, responses: new Map(), observedAt: dec.toISOString(), dir: raw, out: raw });
  assert.deepEqual(r2.record.outOfWindow, [{ slot: "11110-202605", why: "거부 후 창 밖" }]);
  assert.ok(roundLines(r2.record).some((line) => line.includes("거부 후 창 밖") && line.includes("11110-202605")));
  assert.equal(await readOverlay("11110", "202605", raw), null, "따로 받지 않고 얼린 값 그대로");

  // 2번 갈래를 회차 파일로: 창 안 슬롯(202606)이 두 회차 연속 같은 집합으로 줄어 온다.
  const { raw: raw2 } = await fixtureRaw();
  const cut = { items: rows("202606", 12), totalCount: 12 }; // 25 → 12: 절반 아래
  const n1 = await processRound({ plan: plan(), responses: new Map([["11140-202606", cut]]), observedAt: NOW.toISOString(), dir: raw2, out: raw2 });
  assert.equal(n1.record.slots["11140-202606"].status, "rejected");
  const n2 = await processRound({ plan: plan2, responses: new Map([["11140-202606", cut]]), observedAt: dec.toISOString(), dir: raw2, out: raw2 });
  assert.equal(n2.record.slots["11140-202606"].status, "applied-repeat");
  const row06 = n2.record.table.find((r) => r.month === "202606");
  assert.equal(row06.gone, 13, "사라진 행 열에 센다");
  assert.equal((await readOverlay("11140", "202606", raw2)).gone.length, 13);
  assert.equal((await readRecollectedSlot("sale", "11140", "202606", raw2)).items.length, 12);
  assert.deepEqual(snapshot(raw), before);
});

test("창·상한(조건 5): 1회차 202604 + 현재월-6~-2 = 6달 150회·상한 160회, 2회차부터 5달 125회·상한 135회", () => {
  const first = planRound({ now: NOW });
  assert.deepEqual(first, { ok: true, round: FIRST_ROUND, first: true, months: [FIRST_ROUND_EXTRA, "202605", "202606", "202607", "202608", "202609"], retry: false, planned: 150, cap: 160 });
  assert.equal(CALL_MARGIN, 10);
  const second = planRound({ now: new Date("2026-12-10T05:00:00Z"), rounds: ["202611"] });
  assert.deepEqual([second.planned, second.cap, second.months.length], [125, 135, 5]);
  const third = planRound({ now: new Date("2027-01-10T05:00:00Z"), rounds: ["202611", "202612"] });
  assert.deepEqual(third.months, ["202607", "202608", "202609", "202610", "202611"]);
});

test("호출 전 거부: 달 초 3일·08:00~12:30 KST·12-01 부터 1회차·같은 달 두 번째·2회차의 202604·소유자 답 부족·daily-update 진행 중", () => {
  const no = (p) => assert.equal(p.ok, false, JSON.stringify(p));
  no(planRound({ now: new Date("2026-11-03T05:00:00Z") })); // KST 11-03 14:00
  assert.equal(planRound({ now: new Date("2026-11-03T15:00:00Z") }).ok, true, "KST 11-04 00:00");
  no(planRound({ now: new Date("2026-11-09T23:00:00Z") })); // KST 08:00
  no(planRound({ now: new Date("2026-11-10T03:29:00Z") })); // KST 12:29
  assert.equal(planRound({ now: new Date("2026-11-10T03:30:00Z") }).ok, true, "KST 12:30 부터는 된다");
  no(planRound({ now: new Date("2026-11-30T15:00:00Z") })); // KST 12-01 00:00 - 달 초로도 막히고
  assert.match(planRound({ now: new Date("2026-11-30T15:00:00Z"), clock: false }).reason, /1회차는 202611 안에만/, "1회차 규칙으로도 막힌다");
  assert.match(planRound({ now: new Date("2026-12-04T05:00:00Z") }).reason, /1회차는 202611 안에만/);
  assert.match(planRound({ now: NOW, rounds: ["202611"] }).reason, /이미 있다/);
  assert.match(planRound({ now: NOW, rounds: ["202612"] }).reason, /뒤다/);
  assert.match(planRound({ now: new Date("2026-08-10T05:00:00Z"), rounds: ["202605"] }).reason, /202604 는 1회차에만/);
  assert.equal(planRound({ now: new Date("2026-11-03T05:00:00Z"), clock: false }).ok, true, "드라이런은 시각만 건너뛴다");

  const p = planRound({ now: NOW });
  const url = "https://github.com/kyhsa93/jipgye/issues/861#issuecomment-1";
  assert.equal(checkApproval(p, { approvedCalls: 160, ownerNotice: url }).ok, true);
  assert.match(checkApproval(p, { approvedCalls: 135, ownerNotice: url }).reason, /상한 160회/);
  assert.equal(checkApproval(p, { approvedCalls: 160, ownerNotice: "" }).ok, false);
  assert.equal(checkApproval(p, { approvedCalls: undefined, ownerNotice: url }).ok, false);
  // 다른 호스트·다른 저장소·이슈 본문(댓글 아님)의 URL 은 소유자 답으로 보지 않는다.
  for (const other of [
    "https://example.com/kyhsa93/jipgye/issues/861#issuecomment-1",
    "https://github.com/someone/jipgye/issues/861#issuecomment-1",
    "https://github.com/kyhsa93/other/issues/861#issuecomment-1",
    "https://github.com/kyhsa93/jipgye/issues/861",
    "http://github.com/kyhsa93/jipgye/issues/861#issuecomment-1",
  ]) assert.equal(checkApproval(p, { approvedCalls: 160, ownerNotice: other }).ok, false, other);

  assert.deepEqual(dailyBusy([{ status: "completed" }]), []);
  assert.equal(dailyBusy([{ status: "completed" }, { status: "in_progress", databaseId: 1 }, { status: "queued", databaseId: 2 }]).length, 2);
});

test("호출 수: 시도마다 1회로 세고 상한을 넘지 않는다 - 다시 시도는 뒤 슬롯 몫을 남긴 만큼만, 오류 글자에서 비밀값을 지운다", async () => {
  const p = { ...planRound({ now: NOW }) };
  let calls = 0;
  const failing = new Set(["11110-202604", "11140-202604"]);
  const fetchOnce = async (code, yearMonth) => {
    calls += 1;
    if (failing.has(`${code}-${yearMonth}`)) throw new Error("http 500 SECRETKEY");
    return { items: [], totalCount: 0 };
  };
  const res = await fetchRound({ plan: p, fetchOnce, secrets: ["SECRETKEY"], delayMs: 0, retryWaitMs: 0 });
  assert.equal(res.calls, calls);
  assert.equal(res.calls, 150 + 2, "실패한 두 슬롯만 한 번 더");
  assert.equal(res.responses.get("11110-202604").error, "http 500 ***");
  // 상한이 빠듯하면 다시 시도하지 않는다.
  calls = 0;
  const tight = await fetchRound({ plan: { ...p, cap: 150 }, fetchOnce, delayMs: 0, retryWaitMs: 0 });
  assert.equal(tight.calls, 150);
});

// ---- 진입점: 가짜 국토부 서버·가짜 gh ----

function fakeGh(dir, status) {
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "gh");
  writeFileSync(file, status === null ? "#!/bin/sh\necho 'gh: 인증 없음' >&2\nexit 1\n" : `#!/bin/sh\necho '[{"status":"${status}","databaseId":7,"createdAt":"2026-11-10T04:00:00Z"}]'\n`);
  chmodSync(file, 0o755);
  return bin;
}

async function cli(args, { raw, now, server, bin }) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["scripts/recollect-sale.ts", ...args], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        REALESTATE_RAW_DIR: raw, REALESTATE_NOW: now, GITHUB_STEP_SUMMARY: "",
        MOLIT_API_ENDPOINT: server?.saleUrl ?? "", MOLIT_API_KEY: server ? "test-key" : "", MOLIT_DELAY_MS: "0", MOLIT_RETRY_MS: "0",
      },
    });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    return { code: err.code, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

test("--run: 거부 조건이면 호출 0회로 끝나고(종료 3), 통과하면 상한 안에서 받아 raw/recollect 에만 쓴다", async (t) => {
  const response = response0605();
  const server = await startFakeMolit((kind, { code, yearMonth }) => (code === "11110" && yearMonth === "202605" ? successXml(response.items) : successXml([])));
  t.after(() => server.close());
  const url = "https://github.com/kyhsa93/jipgye/issues/861#issuecomment-1";
  const { dir, raw } = await fixtureRaw();
  const before = snapshot(raw);
  const ok = fakeGh(path.join(dir, "ok"), "completed");
  const busy = fakeGh(path.join(dir, "busy"), "in_progress");
  const broken = fakeGh(path.join(dir, "broken"), null);
  const at = "2026-11-10T05:00:00Z";
  const refused = [
    [["--run", "--approved-calls", "135", "--owner-notice", url], { now: at, bin: ok }, /상한 160회/],
    [["--run", "--approved-calls", "160"], { now: at, bin: ok }, /소유자 답/],
    [["--run", "--approved-calls", "160", "--owner-notice", url], { now: "2026-12-04T05:00:00Z", bin: ok }, /1회차는 202611 안에만/],
    [["--run", "--approved-calls", "160", "--owner-notice", url], { now: "2026-11-10T00:00:00Z", bin: ok }, /08:00~12:30/],
    [["--run", "--approved-calls", "160", "--owner-notice", url], { now: "2026-11-02T05:00:00Z", bin: ok }, /달 초/],
    [["--run", "--approved-calls", "160", "--owner-notice", url], { now: at, bin: busy }, /daily-update 가 돌고 있다/],
    [["--run", "--approved-calls", "160", "--owner-notice", url], { now: at, bin: broken }, /확인하지 못했다/],
  ];
  for (const [args, opts, pattern] of refused) {
    const res = await cli(args, { raw, server, ...opts });
    assert.equal(res.code, 3, res.out);
    assert.match(res.out, pattern);
    assert.match(res.out, /거부\(호출 0\)/);
  }
  assert.equal(server.calls.length, 0, "거부된 실행은 한 번도 부르지 않는다");

  const res = await cli(["--run", "--approved-calls", "160", "--owner-notice", url], { raw, server, now: at, bin: ok });
  assert.equal(res.code, 0, res.out);
  assert.equal(server.calls.length, 150);
  assert.ok(server.calls.every((c) => c.kind === "sale"));
  assert.match(res.out, /호출 150\/160/);
  assert.deepEqual(snapshot(raw), before, "슬롯·arrivals·첫 관측일·전월세 그대로");
  assert.deepEqual((await readRecollectedSlot("sale", "11110", "202605", raw)).items, canon("202605", response.items));
  const record = JSON.parse(await readFile(roundPath("202611", raw), "utf8"));
  assert.equal(record.ownerNotice, url);
  assert.equal(record.approvedCalls, 160);
  // 빈 응답이 온 11140-202606 은 0행이라 반영하지 않는다(저장 25행).
  assert.equal(record.slots["11140-202606"].reason, REASONS.zero);
  assert.ok(!(await readFile(roundPath("202611", raw), "utf8")).includes("test-key"));

  // 같은 달 두 번째 실행은 거부.
  const again = await cli(["--run", "--approved-calls", "160", "--owner-notice", url], { raw, server, now: "2026-11-20T05:00:00Z", bin: ok });
  assert.equal(again.code, 3, again.out);
  assert.equal(server.calls.length, 150);
});

test("--dry-run: 호출 없이 응답 폴더(#820 아티팩트 모양)로 회차 표를 내고 --out-dir 에만 쓴다", async () => {
  const { dir, raw } = await fixtureRaw();
  const before = snapshot(raw);
  const got = path.join(dir, "got");
  await mkdir(got, { recursive: true });
  const r = response0605();
  await writeFile(path.join(got, "11110-202605.json"), JSON.stringify(buildSlotFile({ kind: "sale", code: "11110", yearMonth: "202605", items: r.items, observedAt: "2026-11-04T03:47:11.982Z" })));
  const out = path.join(dir, "dry");
  const res = await cli(["--dry-run", "--responses", got, "--out-dir", out, "--now", "2026-11-04T03:47:11.982Z"], { raw, bin: fakeGh(path.join(dir, "gh"), null) });
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /드라이런, 호출 0/);
  // 202605: 저장 30행·시장 30행 → 값 나감 1(사라진 행)·들어옴 0(새 행은 직거래), 사라진 행 1(1).
  assert.match(res.out, /\| 202605 \| 1 \| 1 \| 0 \| 0 \| 30 \| 30 \| 1 \| 0 \| 1 \| 3\.33 \| 10 \| 1 \| 1\(1\) \|/);
  assert.deepEqual(snapshot(raw), before);
  assert.equal(await readOverlay("11110", "202605", raw), null, "raw 에는 쓰지 않는다");
  assert.ok(await readOverlay("11110", "202605", out));
  const record = JSON.parse(await readFile(roundPath("202611", out), "utf8"));
  assert.equal(record.dryRun, true);
  assert.equal(record.calls, 0);
  const same = await cli(["--dry-run", "--responses", got, "--out-dir", raw, "--now", "2026-11-04T03:47:11.982Z"], { raw, bin: fakeGh(path.join(dir, "gh"), null) });
  assert.equal(same.code, 3, "드라이런이 raw 에 쓰려 하면 거부");
});

test("diffRows: #820 측정의 값 행 정의(구·단지·면적·계약일·금액 건수 차이)와 사라진 행(시장 행)을 센다", () => {
  const stored = canon("202605", rows("202605", 5));
  const fetched = canon("202605", [...rows("202605", 4).map((item, i) => (i === 0 ? { ...item, dealAmount: "53,000" } : item)), row("202605", 9, { cdealType: "O", cdealDay: "26.09.01" })]);
  const { counts } = diffRows(stored, fetched);
  // 금액 정정 1건 = 값 나감 1 + 들어옴 1, 사라진 시장 행 1건 = 나감 1. 해제 행은 시장 행이 아니다.
  // 짝짓기는 계약 키(금액 포함)로 하므로 금액 정정은 「바뀐 행」이 아니라 사라진 행 + 새 행이다(#820 측정과 같다).
  assert.deepEqual(
    { valueOut: counts.valueOut, valueIn: counts.valueIn, gone: counts.gone, gonePublic: counts.gonePublic, appeared: counts.appeared, changed: counts.changed },
    { valueOut: 2, valueIn: 1, gone: 2, gonePublic: 2, appeared: 2, changed: 0 }
  );
  const registered = diffRows(stored, stored.map((item, i) => (i === 0 ? { ...item, rgstDate: "26.09.01" } : item))).counts;
  assert.deepEqual([registered.changed, registered.gone, registered.appeared, registered.valueOut + registered.valueIn], [1, 0, 0, 0], "등기일만 붙은 행은 바뀐 행이고 값 행이 아니다");
  assert.equal(itemKey(stored[0]).length, 12);
});

// ---- cto #890 F1·F2: 실패한 회차가 그 달을 다 써 버리지 않는다 ----

const URL_OK = "https://github.com/kyhsa93/jipgye/issues/861#issuecomment-1";

test("F2: --run 에 --now 가 오면 호출 전에 거부한다(실행 시각은 진짜 시계)", async (t) => {
  const server = await startFakeMolit(() => successXml([]));
  t.after(() => server.close());
  const { dir, raw } = await fixtureRaw();
  const res = await cli(["--run", "--approved-calls", "160", "--owner-notice", URL_OK, "--now", "2026-11-10T05:00:00Z"], { raw, server, now: "2026-11-10T05:00:00Z", bin: fakeGh(path.join(dir, "gh"), "completed") });
  assert.equal(res.code, 3, res.out);
  assert.match(res.out, /--now 를 줄 수 없다/);
  assert.equal(server.calls.length, 0);
});

test("F1: 전면 오류면 종료 4·불완전 기록(complete:false), 같은 달 재실행은 받지 못한 슬롯만 받고 누적 호출이 승인 안이다. 끝나면 그 달은 닫힌다", async (t) => {
  let broken = true;
  const response = response0605();
  const server = await startFakeMolit((kind, { code, yearMonth }) => {
    if (broken) return errorXml("SERVICE KEY IS NOT REGISTERED ERROR.");
    return code === "11110" && yearMonth === "202605" ? successXml(response.items) : successXml(rows(yearMonth, 25));
  });
  t.after(() => server.close());
  const { dir, raw } = await fixtureRaw();
  const before = snapshot(raw);
  const bin = fakeGh(path.join(dir, "gh"), "completed");
  const args = ["--run", "--approved-calls", "160", "--owner-notice", URL_OK];

  const first = await cli(args, { raw, server, now: "2026-11-10T05:00:00Z", bin });
  assert.equal(first.code, 4, first.out);
  assert.match(first.out, /::error::.*받지 못한 슬롯 2개/);
  assert.equal(server.calls.length, 10, "5슬롯 연속 실패로 멈춘다(슬롯당 2회)");
  const r1 = JSON.parse(await readFile(roundPath("202611", raw), "utf8"));
  assert.equal(r1.complete, false);
  assert.equal(r1.calls, 10);
  assert.deepEqual(Object.entries(r1.slots).filter(([, s]) => ["failed", "missing"].includes(s.status)).map(([n]) => n).sort(), ["11110-202605", "11140-202606"]);
  assert.match(roundLines(r1).join("\n"), /불완전/);
  assert.deepEqual(snapshot(raw), before);

  // 같은 달 재실행: 받지 못한 두 슬롯만, 누적 12회 ≤ 승인 160회.
  broken = false;
  const second = await cli(args, { raw, server, now: "2026-11-11T05:00:00Z", bin });
  assert.equal(second.code, 0, second.out);
  assert.equal(server.calls.length, 12);
  assert.deepEqual(server.calls.slice(10).map((c) => `${c.code}-${c.yearMonth}`).sort(), ["11110-202605", "11140-202606"]);
  const r2 = JSON.parse(await readFile(roundPath("202611", raw), "utf8"));
  assert.equal(r2.complete, true);
  assert.equal(r2.calls, 12);
  assert.ok(r2.calls <= r2.approvedCalls);
  assert.deepEqual(r2.runs.map((r) => r.calls), [10, 2]);
  assert.equal(r2.slots["11110-202605"].status, "applied");
  assert.equal(r2.slots["11110-202606"].status, "no-slot", "첫 실행의 다른 슬롯 기록은 그대로 이어진다");
  assert.deepEqual((await readRecollectedSlot("sale", "11110", "202605", raw)).items, canon("202605", response.items));
  assert.deepEqual(snapshot(raw), before);

  // 완료된 달은 다시 돌지 않는다.
  const third = await cli(args, { raw, server, now: "2026-11-12T05:00:00Z", bin });
  assert.equal(third.code, 3, third.out);
  assert.match(third.out, /이미 있다/);
  assert.equal(server.calls.length, 12);
});

test("F1: 같은 달 재실행은 소유자 답이 기록과 같아야 하고, 남은 호출(승인 − 누적)이 모자라면 호출 전에 거부한다", async (t) => {
  const server = await startFakeMolit(() => successXml([]));
  t.after(() => server.close());
  const { dir, raw } = await fixtureRaw();
  const bin = fakeGh(path.join(dir, "gh"), "completed");
  const record = (calls) => ({
    round: "202611", months: plan().months, first: true, planned: 150, cap: 160, calls, complete: false, approvedCalls: 160, ownerNotice: URL_OK,
    slots: { "11110-202605": { status: "failed", error: "http 500" }, "11140-202606": { status: "missing" } }, outOfWindow: [], table: [],
  });
  await mkdir(path.dirname(roundPath("202611", raw)), { recursive: true });
  await writeFile(roundPath("202611", raw), JSON.stringify(record(159)));
  const over = await cli(["--run", "--approved-calls", "160", "--owner-notice", URL_OK], { raw, server, now: "2026-11-10T05:00:00Z", bin });
  assert.equal(over.code, 3, over.out);
  assert.match(over.out, /남은 호출 1회\(승인 160 − 이번 달 누적 159\)가 받지 못한 슬롯 2개보다 모자라다/);
  await writeFile(roundPath("202611", raw), JSON.stringify(record(10)));
  const other = await cli(["--run", "--approved-calls", "160", "--owner-notice", "https://github.com/kyhsa93/jipgye/issues/861#issuecomment-2"], { raw, server, now: "2026-11-10T05:00:00Z", bin });
  assert.equal(other.code, 3, other.out);
  assert.match(other.out, /회차 기록.*과 다르다/);
  const more = await cli(["--run", "--approved-calls", "200", "--owner-notice", URL_OK], { raw, server, now: "2026-11-10T05:00:00Z", bin });
  assert.equal(more.code, 3, more.out);
  assert.equal(server.calls.length, 0);

  // 순수 함수: 재실행 계획은 받지 못한 슬롯만, 상한은 승인 − 누적.
  const p = planRound({ now: NOW, rounds: ["202611"], latest: record(10) });
  assert.deepEqual([p.ok, p.retry, p.targets, p.planned, p.used], [true, true, ["11110-202605", "11140-202606"], 2, 10]);
  assert.deepEqual(checkApproval(p, { approvedCalls: 160, ownerNotice: URL_OK }), { ok: true, cap: 150 });
  assert.equal(planRound({ now: NOW, rounds: ["202611"], latest: { ...record(10), complete: true } }).ok, false);
});

test("F1: 12-01 에 불완전한 202611 이 있으면 2회차로 계산하고, 받지 못한 202604·202605 는 「미수신 후 창 밖」으로 적는다", async () => {
  const { raw } = await fixtureRaw();
  await writeTwice(raw, "11110", "202604", rows("202604", 20), rows("202604", 22));
  const responses = new Map([["11140-202606", { items: rows("202606", 25), totalCount: 25 }]]);
  const r1 = await processRound({ plan: plan(), responses, observedAt: NOW.toISOString(), dir: raw, out: raw, calls: 3 });
  assert.equal(r1.record.complete, false);
  assert.deepEqual(Object.entries(r1.record.slots).filter(([, s]) => s.status === "missing").map(([n]) => n).sort(), ["11110-202604", "11110-202605"]);

  const dec = new Date("2026-12-01T05:00:00Z");
  const latest = null; // 12월 기록은 아직 없다 - 11월 기록은 이번 달이 아니다
  const p2 = planRound({ now: dec, rounds: ["202611"], latest, clock: false });
  assert.deepEqual([p2.ok, p2.first, p2.retry, p2.months], [true, false, false, ["202606", "202607", "202608", "202609", "202610"]]);
  assert.equal(planRound({ now: dec, rounds: ["202611"] }).ok, false, "시계로는 12-01 이 달 초라 막힌다");
  const r2 = await processRound({ plan: p2, responses: new Map(), observedAt: dec.toISOString(), dir: raw, out: raw });
  assert.deepEqual(r2.record.outOfWindow, [
    { slot: "11110-202604", why: "미수신 후 창 밖" },
    { slot: "11110-202605", why: "미수신 후 창 밖" },
  ]);
  assert.ok(roundLines(r2.record).some((line) => line.startsWith("미수신 후 창 밖") && line.includes("11110-202604, 11110-202605")));
});

test("legal 보완 1: 일 수집이 보관 창(24달)을 벗어난 매매 슬롯을 지울 때 같은 달 덧씌움도 지운다", async (t) => {
  const server = await startFakeMolit((kind) => (kind === "rent" ? successXml([rentItem()]) : successXml([saleItem()])));
  t.after(() => server.close());
  const { dir, raw } = await fixtureRaw();
  await writeTwice(raw, "11110", "202410", rows("202410", 5), rows("202410", 6));
  const overlay = (ym, n) => buildOverlay({ slot: { district: "11110", yearMonth: ym, observedAt: "2026-08-17T00:00:00.000Z", count: n, items: canon(ym, rows(ym, n)) }, items: canon(ym, rows(ym, n + 1)), totalCount: n + 1, observedAt: NOW.toISOString() });
  await writeOverlay("11110", "202410", overlay("202410", 6), raw);
  await writeOverlay("11110", "202605", overlay("202605", 30), raw);
  await exec(process.execPath, ["scripts/fetch-realestate.ts"], {
    cwd: root,
    env: {
      ...process.env,
      MOLIT_API_ENDPOINT: server.saleUrl, MOLIT_API_KEY: "test", MOLIT_RENT_API_ENDPOINT: server.rentUrl, MOLIT_RENT_API_KEY: "test",
      REALESTATE_RAW_DIR: raw, MOLIT_BACKFILL_LIMIT: "0", MOLIT_SWEEP_DELAY_MS: "0", MOLIT_RETRY_MS: "0", REALESTATE_NOW: "2026-11-10T05:00:00Z", GITHUB_STEP_SUMMARY: path.join(dir, "s.md"),
    },
  });
  assert.equal(await readSlotFile("sale", "11110", "202410", raw), null, "만료 슬롯은 지워졌다");
  assert.equal(await readOverlay("11110", "202410", raw), null, "같은 달 덧씌움도 지워졌다");
  assert.ok(await readOverlay("11110", "202605", raw), "창 안 덧씌움은 그대로");
  assert.match(await src("scripts/fetch-realestate.ts"), /removeSlotFile\(slot\.kind, slot\.code, slot\.yearMonth\);\n\s+if \(slot\.kind === "sale"\) await removeOverlay\(slot\.code, slot\.yearMonth\);/);
});
