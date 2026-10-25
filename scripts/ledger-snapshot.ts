/**
 * 월간 원장 스냅샷 (#482, 설계 판정 6396016952). 한 달에 한 번, 그달 1일(S, KST)의 사이트 산출을 얼려 `ledger/YYYY-MM.jsonl.gz` 한 파일로 남긴다.
 *
 *   node scripts/ledger-snapshot.ts --month 2026-11 --license-sale "제한 없음" --license-rent "제한 없음"
 *     [--dry-run [--source-commit <40자리>] [--out-dir <폴더>]]
 *
 * 무엇을 싣나(허용 키는 ALLOWED 뿐 - 밖의 키가 하나라도 있으면 쓰기 전에 실패한다):
 *  - meta: v·s·sourceCommit·prereg·license{sale,rent,checkedOn}·counts
 *  - c6(지난 범위 얼림, PREREG 3절): 소스 커밋의 docs/data/complex-price-*.json 이 낸 칸 가운데 n≥3 만, 값을 그대로 옮긴다(재계산 금지).
 *    단지명은 `구코드|단지명` sha256 앞 16자(h)로만 남고, 동·층·일자·top·yearAgo·raw·median 은 싣지 않는다. band 는 칸 median 의 가격대(1~5).
 *  - c1(신고 도착 삼각표, PREREG 5절): 같은 커밋 raw 의 arrivals 로 계약월(≥202610) × 구 × 종류 × 경과일 구간의 행 수와, 그 구간에서 해제·등기를
 *    처음 관측한 행 수. 행이 바뀌면(해제·등기가 붙으면) 수집기가 그 행을 새 키로 다시 도장 찍으므로(realestate-raw.ts trackArrivals) 지금 행의 도착일이
 *    곧 해제·등기를 처음 본 날이다. 전월세 원본에는 해제·등기 열이 없어 rent 줄에는 cancel·rgst 를 싣지 않는다(셀 수 없는 열은 빼고 보고 - 판정 ④).
 *
 * 소스 커밋은 제목이 정확히 `chore: 데일리 데이터 갱신 <S>` 인 main 의 첫 커밋이다. 없으면 쓰지 않고 실패한다(다른 커밋으로 대체 금지) -
 * 그래서 11-02·03 에 돌려도 결과가 같다. 같은 달 파일이 이미 있으면 다시 계산해 정본 해시(압축 푼 JSONL 의 sha256)가 같으면 아무것도 안 하고,
 * 다르면 실패한다(덮어쓰기 금지). 재계산 때 license.checkedOn 은 기존 파일의 값을 물려받는다 - 확인한 날짜가 달라 해시가 갈리면 안 되므로.
 *
 * 저장소가 공개라 「비공개 적재」는 사이트·Release·공지 없음이라는 뜻이다. c6 은 이미 docs/data 에 공개된 값의 부분집합이라 새 노출이 아니고,
 * c1 은 구 단위 집계 건수뿐이다. 이용허락 문자열은 dispatch 마다 사람이 상세 페이지(15126469·15126474)에서 읽어 넣고, 「제한 없음」이 아니면 멈춘다(PREREG 8절).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { dealDate, dayGap, isCancelled, isRegistered } from "./cancellation.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { itemKey } from "./realestate-raw.ts";

export const VERSION = 1;
export const LICENSE_OK = "제한 없음";
// PREREG v1 병합 커밋(#584). 소스 커밋의 조상이어야 한다 - 사전 등록이 얼림보다 먼저다.
export const PREREG_COMMIT = "d1dcaaf73e441e88c2813e580f09839eabb65c46";
export const WINDOW_DAYS = 183; // PREREG 3절 - 소스 파일의 windowDays 가 다르면 멈춘다
export const MIN_N = 3; // PREREG 1절 - n<3 비공개
// 가격대 경계(만원, 칸 median 기준 (하한, 상한]): 6·9·15·25억. PREREG 1절 (b).
export const BAND_EDGES = [60000, 90000, 150000, 250000];
export const C1_FROM = "202610"; // PREREG 5절 - 계약일 2026-10-01 이상
// 경과일 구간(양끝 포함). PREREG 5절.
export const BUCKETS = [["0-7", 0, 7], ["8-14", 8, 14], ["15-21", 15, 21], ["22-30", 22, 30], ["31-45", 31, 45], ["46+", 46, Infinity]] as const;
export const KINDS = ["sale", "rent"];
export const SIZE_FAIL = 5 * 1024 * 1024;
export const SIZE_WARN = 1024 * 1024;

// 줄마다 최상위 키 하나(meta|c6|c1)이고, 그 안의 키와 순서가 이 목록과 정확히 같아야 한다(rent 의 c1 은 cancel·rgst 없음).
export const ALLOWED = {
  meta: ["v", "s", "sourceCommit", "prereg", "license", "counts"],
  license: ["sale", "rent", "checkedOn"],
  counts: ["c6", "c1", "rows", "skipped"],
  c6: ["s", "d", "h", "a", "n", "lo", "hi", "k", "band"],
  c1: ["s", "m", "d", "kind", "b", "rows", "cancel", "rgst"],
  c1Rent: ["s", "m", "d", "kind", "b", "rows"],
};

class LedgerError extends Error {}
const fail = (msg) => {
  throw new LedgerError(msg);
};

export const subjectFor = (s) => `chore: 데일리 데이터 갱신 ${s}`;
export const snapshotDay = (month) => `${month}-01`;
export const complexHash = (code, name) => createHash("sha256").update(`${code}|${name}`).digest("hex").slice(0, 16);
export const canonicalHash = (jsonl) => createHash("sha256").update(jsonl).digest("hex");

export function band(median) {
  const i = BAND_EDGES.findIndex((edge) => median <= edge);
  return i === -1 ? BAND_EDGES.length + 1 : i + 1;
}

export function bucketOf(days) {
  return BUCKETS.find(([, lo, hi]) => days >= lo && days <= hi)?.[0] ?? null;
}

export function checkLicense(sale, rent) {
  for (const [name, value] of [["license_sale", sale], ["license_rent", rent]]) {
    if (value !== LICENSE_OK) fail(`${name} 가 「${LICENSE_OK}」이 아니다(받은 값: ${JSON.stringify(value ?? "")}) - 상세 페이지 문자열이 바뀌었으면 clo 확인 전까지 멈춘다`);
  }
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** c6 줄. complexFiles: [{ json }] - complex-price-*.json 의 파싱 결과. 값은 옮기기만 한다. */
export function c6Lines(s, complexFiles) {
  const codeOf = new Map(DISTRICTS.map((d) => [d.name, d.code]));
  const lines = [];
  for (const { json } of complexFiles) {
    const code = codeOf.get(json?.district) ?? fail(`complex-price 의 구 이름을 모른다: ${json?.district}`);
    if (json.windowDays !== WINDOW_DAYS) fail(`complex-price(${json.district}) 창이 ${json.windowDays}일이다 - PREREG 는 ${WINDOW_DAYS}일`);
    for (const [name, areas] of Object.entries(json.cells ?? {})) {
      const h = complexHash(code, name);
      for (const [a, cell] of Object.entries(areas as Record<string, any>)) {
        if (!(cell?.n >= MIN_N)) continue;
        for (const k of ["low", "high", "median"]) if (typeof cell[k] !== "number") fail(`n≥${MIN_N} 칸에 ${k} 가 없다(${code} ${h} ${a})`);
        if (typeof cell.quartile !== "boolean") fail(`n≥${MIN_N} 칸에 quartile 이 없다(${code} ${h} ${a})`);
        lines.push({ c6: { s, d: code, h, a, n: cell.n, lo: cell.low, hi: cell.high, k: cell.quartile ? "q" : "r", band: band(cell.median) } });
      }
    }
  }
  return lines.sort((x, y) => byText(x.c6.d, y.c6.d) || byText(x.c6.h, y.c6.h) || byText(x.c6.a, y.c6.a));
}

/** c1 줄. rawSlots: [{ kind, json }] - raw/<kind>/<code>-<yyyymm>.json 의 파싱 결과. 건수는 키가 아니라 행으로 센다. */
export function c1Lines(s, rawSlots) {
  const cells = new Map();
  let rows = 0;
  let skipped = 0;
  for (const { kind, json } of rawSlots) {
    if (!KINDS.includes(kind)) fail(`모르는 종류: ${kind}`);
    const arrivals = json?.arrivals ?? {};
    for (const item of json?.items ?? []) {
      const m = `${item.dealYear}${String(item.dealMonth).padStart(2, "0")}`;
      if (m < C1_FROM) continue;
      const arrived = arrivals[itemKey(item)];
      const contract = dealDate(item);
      const days = arrived && contract ? dayGap(contract, new Date(`${arrived}T00:00:00Z`)) : null;
      const b = days === null ? null : bucketOf(days);
      // 첫 관측이 없는 행(슬롯의 첫 수집분)이나 계약일보다 앞선 도착은 구간을 정할 수 없다 - 세지 않고 counts.skipped 로 남긴다.
      if (!b) {
        skipped += 1;
        continue;
      }
      rows += 1;
      const d = String(json.district ?? item.sggCd);
      const key = `${m}|${d}|${KINDS.indexOf(kind)}|${BUCKETS.findIndex(([name]) => name === b)}`;
      const cell = cells.get(key) ?? (kind === "sale" ? { s, m, d, kind, b, rows: 0, cancel: 0, rgst: 0 } : { s, m, d, kind, b, rows: 0 });
      cell.rows += 1;
      if (kind === "sale") {
        if (isCancelled(item)) cell.cancel += 1;
        if (isRegistered(item)) cell.rgst += 1;
      }
      cells.set(key, cell);
    }
  }
  const order = (key) => key.split("|");
  const keys = [...cells.keys()].sort((x, y) => {
    const [a, b] = [order(x), order(y)];
    return byText(a[0], b[0]) || byText(a[1], b[1]) || Number(a[2]) - Number(b[2]) || Number(a[3]) - Number(b[3]);
  });
  return { lines: keys.map((key) => ({ c1: cells.get(key) })), rows, skipped };
}

/** 원장 JSONL(정본). 같은 입력이면 같은 바이트다 - 입력 파일 순서와 무관하게 줄을 정렬한다. */
export function buildLedger({ month, sourceCommit, license, complexFiles, rawSlots, prereg = PREREG_COMMIT }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "")) fail(`month 는 YYYY-MM 이어야 한다: ${month}`);
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) fail(`sourceCommit 이 40자리 해시가 아니다: ${sourceCommit}`);
  checkLicense(license.sale, license.rent);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(license.checkedOn ?? "")) fail(`checkedOn 이 YYYY-MM-DD 가 아니다: ${license.checkedOn}`);
  const s = snapshotDay(month);
  const c6 = c6Lines(s, complexFiles);
  const c1 = c1Lines(s, rawSlots);
  const meta = {
    meta: {
      v: VERSION,
      s,
      sourceCommit,
      prereg,
      license: { sale: license.sale, rent: license.rent, checkedOn: license.checkedOn },
      counts: { c6: c6.length, c1: c1.lines.length, rows: c1.rows, skipped: c1.skipped },
    },
  };
  const jsonl = [meta, ...c6, ...c1.lines].map((line) => JSON.stringify(line)).join("\n") + "\n";
  validateLedger(jsonl);
  return jsonl;
}

/** 허용 목록 검사. 쓰기 전에 부르고, 시험도 같은 함수를 쓴다. 키 이름·순서·n≥3·h 모양을 본다. */
export function validateLedger(jsonl) {
  const lines = jsonl.split("\n");
  if (lines.pop() !== "") fail("JSONL 은 줄바꿈으로 끝나야 한다");
  const same = (obj, keys, where) => {
    const got = Object.keys(obj ?? {});
    if (got.join(",") !== keys.join(",")) fail(`${where}: 키가 허용 목록과 다르다 - 받은 [${got}] / 허용 [${keys}]`);
  };
  lines.forEach((text, i) => {
    const line = JSON.parse(text);
    const [top, ...rest] = Object.keys(line);
    if (rest.length) fail(`${i + 1}행: 최상위 키가 둘 이상이다`);
    if (i === 0 && top !== "meta") fail("첫 줄은 meta 여야 한다");
    if (i > 0 && top !== "c6" && top !== "c1") fail(`${i + 1}행: 허용 밖 최상위 키 ${top}`);
    const body = line[top];
    if (top === "meta") {
      same(body, ALLOWED.meta, "meta");
      same(body.license, ALLOWED.license, "meta.license");
      same(body.counts, ALLOWED.counts, "meta.counts");
    } else if (top === "c6") {
      same(body, ALLOWED.c6, `${i + 1}행 c6`);
      if (!(Number.isInteger(body.n) && body.n >= MIN_N)) fail(`${i + 1}행: n<${MIN_N} 칸이 실렸다`);
      if (!/^[0-9a-f]{16}$/.test(body.h)) fail(`${i + 1}행: h 가 16자 해시가 아니다`);
    } else {
      same(body, body.kind === "rent" ? ALLOWED.c1Rent : ALLOWED.c1, `${i + 1}행 c1`);
    }
  });
}

/** gzip. mtime 0(노드 기본)에 OS 바이트를 3(Unix)으로 고정해, 같은 zlib 이면 기기와 무관하게 같은 바이트가 된다. 정본 해시는 압축 전 JSONL 이다. */
export function gzipLedger(jsonl) {
  const gz = gzipSync(Buffer.from(jsonl, "utf8"), { level: 9 });
  gz[9] = 3;
  return gz;
}

// ---- git 에서 소스 읽기 ----

const gitIn = (cwd) => (...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

/** 제목이 정확히 `chore: 데일리 데이터 갱신 <S>` 인 HEAD 의 첫(가장 이른) first-parent 커밋. 없으면 실패 - 다른 커밋으로 대체하지 않는다. */
export function findSourceCommit(s, cwd) {
  const want = subjectFor(s);
  const log = gitIn(cwd)("log", "--first-parent", "--reverse", "--format=%H%x09%s", "HEAD");
  for (const line of log.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0 && line.slice(tab + 1) === want) return line.slice(0, tab);
  }
  return fail(`소스 커밋이 없다: 제목이 정확히 「${want}」인 main 커밋을 못 찾았다 - Daily 가 그날 돌았는지 확인하고, 다른 커밋으로 대체하지 않는다`);
}

/** 소스 커밋의 complex-price 25개와 계약월 ≥202610 raw 슬롯을 읽는다. PREREG 커밋이 소스 커밋의 조상인지도 본다. */
export function readSource(sourceCommit, cwd, prereg = PREREG_COMMIT) {
  const git = gitIn(cwd);
  try {
    git("merge-base", "--is-ancestor", prereg, sourceCommit);
  } catch {
    fail(`PREREG 커밋 ${prereg} 이 소스 커밋 ${sourceCommit} 의 조상이 아니다`);
  }
  const names = git("ls-tree", "-r", "--name-only", sourceCommit, "--", "docs/data", "raw/sale", "raw/rent").split("\n").filter(Boolean);
  const show = (p) => JSON.parse(git("show", `${sourceCommit}:${p}`));
  const complex = names.filter((p) => /^docs\/data\/complex-price-[a-z]+\.json$/.test(p));
  if (complex.length !== DISTRICTS.length) fail(`complex-price 파일이 ${complex.length}개다 - ${DISTRICTS.length}개여야 한다`);
  const rawSlots = names
    .map((p) => /^raw\/(sale|rent)\/(\d{5})-(\d{6})\.json$/.exec(p))
    .filter((m) => m && m[3] >= C1_FROM)
    .map((m) => ({ kind: m[1], json: show(m[0]) }));
  return { complexFiles: complex.map((p) => ({ json: show(p) })), rawSlots };
}

/** 크기 문턱: 5MB 를 넘으면 실패(정확히 5MB 는 통과), 1MB 를 넘으면 경고. */
export function checkSize(len, log = console.log) {
  if (len > SIZE_FAIL) fail(`gz 가 ${len}B 로 5MB 를 넘는다 - 쓰지 않는다`);
  if (len > SIZE_WARN) log(`::warning::원장 gz 가 ${len}B 로 1MB 를 넘었다(예상 ≤0.5MB)`);
}

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

/** 한 번의 실행. 반환값의 status: written | unchanged | dry-run. 실패는 예외. prereg 는 시험이 임시 저장소에서만 바꾼다. */
export function run({ month, licenseSale, licenseRent, dryRun = false, sourceCommit = "", outDir, cwd, today = kstToday(), log = console.log, prereg = PREREG_COMMIT }) {
  checkLicense(licenseSale, licenseRent);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "")) fail(`month 는 YYYY-MM 이어야 한다: ${month}`);
  if (sourceCommit && !dryRun) fail("source_commit 은 dry_run 전용이다 - 실제 스냅샷은 제목으로 찾은 소스 커밋만 쓴다");
  const s = snapshotDay(month);
  const commit = sourceCommit ? gitIn(cwd)("rev-parse", "--verify", `${sourceCommit}^{commit}`).trim() : findSourceCommit(s, cwd);
  if (sourceCommit && commit !== sourceCommit) fail(`source_commit 은 40자리 전체 해시여야 한다: ${sourceCommit}`);
  const source = readSource(commit, cwd, prereg);
  const target = path.join(cwd, "ledger", `${month}.jsonl.gz`);

  // 같은 달 파일이 있으면 그 checkedOn 을 물려받아 다시 계산하고, 정본 해시가 같으면 아무것도 안 한다. 다르면 실패(덮어쓰기 금지).
  let checkedOn = today;
  const existing = !dryRun && existsSync(target) ? gunzipSync(readFileSync(target)).toString("utf8") : null;
  if (existing) checkedOn = JSON.parse(existing.slice(0, existing.indexOf("\n"))).meta.license.checkedOn;

  const jsonl = buildLedger({ month, sourceCommit: commit, license: { sale: licenseSale, rent: licenseRent, checkedOn }, complexFiles: source.complexFiles, rawSlots: source.rawSlots, prereg });
  const gz = gzipLedger(jsonl);
  const hash = canonicalHash(jsonl);
  const meta = JSON.parse(jsonl.slice(0, jsonl.indexOf("\n"))).meta;
  log(`[ledger] S=${s} source=${commit} 정본 sha256=${hash} gz=${gz.length}B counts=${JSON.stringify(meta.counts)}`);
  checkSize(gz.length, log);

  if (existing) {
    const before = canonicalHash(existing);
    if (before !== hash) fail(`ledger/${month}.jsonl.gz 가 이미 있고 정본 해시가 다르다(있는 것 ${before} / 다시 센 것 ${hash}) - 덮어쓰지 않는다`);
    log(`[ledger] ledger/${month}.jsonl.gz 가 이미 있고 정본 해시가 같다 - 아무것도 안 한다`);
    return { status: "unchanged", hash, size: gz.length, sourceCommit: commit };
  }
  const file = dryRun ? path.join(outDir ?? path.join(cwd, "build", "ledger"), `${month}.jsonl.gz`) : target;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, gz);
  log(`[ledger] ${dryRun ? "dry-run " : ""}썼다: ${dryRun ? file : path.relative(cwd, file)}`);
  return { status: dryRun ? "dry-run" : "written", hash, size: gz.length, sourceCommit: commit, file };
}

function main() {
  const { values: v } = parseArgs({
    options: {
      month: { type: "string" },
      "license-sale": { type: "string" },
      "license-rent": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "source-commit": { type: "string", default: "" },
      "out-dir": { type: "string" },
    },
  });
  run({
    month: v.month,
    licenseSale: v["license-sale"],
    licenseRent: v["license-rent"],
    dryRun: v["dry-run"],
    sourceCommit: v["source-commit"],
    outDir: v["out-dir"] ? path.resolve(v["out-dir"]) : undefined,
    cwd: path.resolve(import.meta.dirname, ".."),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (err) {
    console.error(`[ledger] ${err.message}`);
    process.exitCode = 1;
  }
}
