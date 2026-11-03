import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  addDays,
  buildOutput,
  cellLines,
  closedSnapshots,
  clopperPearson,
  followUps,
  HORIZONS,
  INPUT_DATE,
  isClosed,
  loadLib,
  monthsBack,
  notClosed,
  outcome,
  PINS,
  readIndex,
  readItems,
  RetroError,
  runCli,
  scoreAll,
  snapshotFiles,
  tallySnapshot,
  UNITS,
  validateOutput,
  verifyPins,
} from "../research/retro-band-2026-11/retro.mjs";
import { REGIONS } from "../scripts/outlook.ts";

// 소급 계산(#656 P1). 합성 입력과 임시 git 저장소로만 돈다 - 인증키·네트워크가 없고 원본 값·오늘 날짜에 갈리지 않는다.
// 범위 계산은 작업 트리 함수로 돈다(P1-4). 실제 입력의 재연은 PR 본문의 --replay 출력이 맡는다.
const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "research/retro-band-2026-11/retro.mjs");
const lib = await loadLib(ROOT);

const CODE = "11110"; // 도심권(지수 210)
const OTHER = "11140";
const S = "2026-03-01"; // 세 창이 모두 닫힌 달초
const APT = "합성가나아파트";
const SHA = "b".repeat(40);

function deal({ code = CODE, apt = APT, area = 84, amount, date, cancel = "", gbn = "중개거래" }) {
  const [y, m, d] = date.split("-").map(Number);
  return { sggCd: code, aptNm: apt, umdNm: "합성동", excluUseAr: String(area), dealAmount: amount.toLocaleString("en-US"), dealYear: String(y), dealMonth: String(m), dealDay: String(d), floor: "3", buildYear: "2000", cdealType: cancel, dealingGbn: gbn };
}

/** S 직전 달에 값 세 개짜리 칸(n=3, 최저~최고). */
const cell = (over = {}, amounts = [10000, 11000, 12000], month = "2026-02") => amounts.map((amount, i) => deal({ ...over, amount, date: `${month}-1${i}` }));

function months(from, to) {
  const out = [];
  for (let m = from; m <= to; m = monthsBack(`${m.slice(0, 4)}-${m.slice(4)}-01`, -1)) out.push(m);
  return out;
}
/** 평평한 지수(202401~202612). over: 달 → 값. */
function index(over = {}) {
  const rows = months("202401", "202612").map((m) => [m, over[m] ?? 100]);
  return { source: "합성", series: Object.fromEntries(REGIONS.map((r) => [r.code, rows])) };
}
const items = (...deals) => {
  const out = {};
  for (const d of deals.flat()) (out[d.sggCd] ??= []).push(d);
  return out;
};
const follow = (input, s = S, variant = "main", idx = index()) => followUps(lib, input, idx, s, variant);
const lineOf = (input, s = S, variant = "main", idx = index()) => cellLines(lib, s, snapshotFiles(lib, input, idx, s, variant)).map((l) => l.c6);
const nOf = (rows, s, h, key = "seoul|all") => tallySnapshot(rows, s, h)[key]?.n ?? 0;
const output = (input, idx = index()) => buildOutput({ prereg: SHA, replay: { matched: 1, total: 1 }, scored: scoreAll(lib, input, idx) });
const rowOf = (out, unit, segment, h) => out.rows.find((r) => r.unit === unit && r.segment === segment && r.h === h);

test("R2 S 당일 거래는 창에도 후속에도 들지 않는다", () => {
  const input = items(cell(), deal({ amount: 99999, date: S }), deal({ amount: 11000, date: addDays(S, 1) }));
  const [line] = lineOf(input);
  assert.equal(line.n, 3);
  assert.equal(line.hi, 12000);
  assert.deepEqual(follow(input).map((r) => r.date), [addDays(S, 1)]);
});

test("R2 창은 S−183일부터다: 그날은 들고 하루 전은 안 든다", () => {
  const edge = addDays(S, -183);
  const base = cell();
  assert.equal(lineOf(items(base, deal({ amount: 11000, date: edge })))[0].n, 4);
  assert.equal(lineOf(items(base, deal({ amount: 11000, date: addDays(S, -184) })))[0].n, 3);
});

test("R6 S+h 는 들고 S+h+1 은 안 든다, 세 창 모두", () => {
  const dates = [1, 30, 31, 60, 61, 90, 91].map((d) => addDays(S, d));
  const rows = follow(items(cell(), dates.map((date) => deal({ amount: 11000, date }))));
  assert.equal(rows.length, 6, "S+91 은 어느 창에도 안 든다");
  assert.deepEqual(HORIZONS.map((h) => nOf(rows, S, h)), [2, 4, 6]);
});

test("R6 양끝은 적중이고 그 밖은 위·아래 빗나감이다", () => {
  assert.deepEqual([[10000, 10000, 12000], [12000, 10000, 12000], [9999, 10000, 12000], [12001, 10000, 12000]].map((a) => outcome(...a)), ["hits", "hits", "below", "above"]);
  const later = [10000, 12000, 9999, 12001].map((amount, i) => deal({ amount, date: addDays(S, i + 1) }));
  const tally = tallySnapshot(follow(items(cell(), later)), S, 30)["seoul|all"];
  assert.deepEqual(tally, { n: 4, hits: 2, above: 1, below: 1 });
});

test("R5 해제·직거래는 창과 후속 어디에도 안 들고, 후속은 보정 전 원값이다", () => {
  const noise = [deal({ amount: 99999, date: "2026-02-20", cancel: "O" }), deal({ amount: 99999, date: "2026-02-21", gbn: "직거래" })];
  const later = [deal({ amount: 11000, date: "2026-03-05", cancel: "O" }), deal({ amount: 11000, date: "2026-03-06", gbn: "직거래" })];
  const input = items(cell(), noise, later);
  assert.equal(lineOf(input)[0].n, 3);
  assert.equal(lineOf(input)[0].hi, 12000);
  assert.deepEqual(follow(input), []);

  const rising = index({ "202511": 100, "202512": 200 });
  const old = cell({}, [10000, 10000, 10000], "2025-11");
  const rows = follow(items(old, deal({ amount: 15000, date: "2026-03-05" })), S, "main", rising);
  assert.equal(rows[0].amount, 15000);
  assert.equal(rows[0].lo, 20000, "칸은 보정하고 후속은 원값이다");
});

test("R5 후속은 같은 구·단지명의 1㎡ 안쪽 가장 가까운 칸에 붙는다", () => {
  const near = cell({ area: 84 });
  const far = cell({ area: 85.2 }, [20000, 21000, 22000]);
  const at = (over) => follow(items(near, far, deal({ amount: 11000, date: "2026-03-05", ...over }))).map((r) => r.lo);
  assert.deepEqual(at({ area: 84.5 }), [10000]);
  assert.deepEqual(at({ area: 84.9 }), [20000], "85.2 가 더 가깝다");
  assert.deepEqual(at({ area: 86.3 }), [], "1㎡ 를 넘으면 안 붙는다");
  assert.deepEqual(at({ apt: "합성다른단지" }), [], "단지명이 다르면 안 붙는다");
  assert.deepEqual(at({ code: OTHER }), [], "구가 다르면 안 붙는다");
});

test("R5 가장 가까운 칸이 n<3 이면 채점하지 않고 옆 칸으로 옮기지 않는다", () => {
  const big = cell({ area: 84 });
  const small = [deal({ area: 85.5, amount: 30000, date: "2026-02-15" }), deal({ area: 85.5, amount: 31000, date: "2026-02-16" })];
  assert.deepEqual(follow(items(big, small, deal({ area: 84.9, amount: 11000, date: "2026-03-05" }))), []);
  assert.equal(follow(items(big, small, deal({ area: 84.5, amount: 11000, date: "2026-03-05" }))).length, 1);
});

test("R3 닫힌 S 는 11·10·9 회이고 2026-10-01 은 안 닫혔다", () => {
  assert.deepEqual(HORIZONS.map((h) => closedSnapshots(h).length), [11, 10, 9]);
  assert.deepEqual(HORIZONS.map((h) => closedSnapshots(h).at(-1)), ["2026-09-01", "2026-08-01", "2026-07-01"]);
  assert.deepEqual(notClosed(), ["2026-10-01"]);
  assert.equal(addDays("2026-07-01", 90 + 30) <= INPUT_DATE, true);
  assert.equal(isClosed("2026-08-01", 90), false);
  assert.equal(isClosed("2026-09-01", 60), false);
});

test("R3 미닫힘 창은 칸과 후속이 있어도 세지 않는다", () => {
  // 8월 거래로 낸 칸은 09-01·10-01 에 있다. 09-15 는 09-01 의 h30 으로만 세고, 10-15 는 09-01 의 h60·10-01 의 h30 이라 어디에도 안 든다.
  const out = output(items(cell({}, undefined, "2026-08"), deal({ amount: 11000, date: "2026-09-15" }), deal({ amount: 11000, date: "2026-10-15" })));
  assert.deepEqual(HORIZONS.map((h) => rowOf(out, "seoul", "all", h).n), [1, 0, 0]);
  assert.deepEqual(out.snapshots, { notClosed: ["2026-10-01"], horizons: [{ h: 30, count: 11, last: "2026-09-01" }, { h: 60, count: 10, last: "2026-08-01" }, { h: 90, count: 9, last: "2026-07-01" }] });
});

test("R4 지수는 S−3개월까지 자르고 outlook 없이 넣는다", () => {
  const idx = index({ "202511": 100, "202512": 110, "202601": 999, "202602": 999 });
  const input = items(cell({}, [10000, 10000, 10000], "2025-11"));
  const files = snapshotFiles(lib, input, idx, S);
  assert.equal(Object.values(files)[0].reference, "202512");
  assert.equal(Object.values(files)[0].referenceFilled, false);
  assert.equal(lineOf(input, S, "main", idx)[0].lo, 11000);
  assert.equal(monthsBack("2026-11-01", 3), "202608");
  assert.equal(monthsBack("2026-01-01", 3), "202510");
  const short = { series: Object.fromEntries(REGIONS.map((r) => [r.code, [["202511", 100]]])) };
  assert.throws(() => snapshotFiles(lib, input, short, S), RetroError);
});

test("R7 ① 지수 보정 끔은 배율을 1로, ② 는 S−30일까지 뺀다", () => {
  const idx = index({ "202511": 100, "202512": 110 });
  const old = items(cell({}, [10000, 10000, 10000], "2025-11"));
  assert.equal(lineOf(old, S, "main", idx)[0].lo, 11000);
  assert.equal(lineOf(old, S, "indexOff", idx)[0].lo, 10000);

  const base = cell({}, undefined, "2025-12");
  const input = items(base, deal({ amount: 11000, date: addDays(S, -31) }), deal({ amount: 11000, date: addDays(S, -30) }), deal({ amount: 11000, date: addDays(S, -1) }));
  assert.equal(lineOf(input)[0].n, 6);
  assert.equal(lineOf(input, S, "dropLast30")[0].n, 4, "S−31 만 남는다");
});

test("줄: n≥100 이면 값을 내고 n<100 이면 건수만 남긴다. 가격대·칸 n 은 칸 기준이다", () => {
  const later = (count) => Array.from({ length: count }, (_, i) => deal({ amount: i < 60 ? 11000 : 12500, date: "2026-09-02" }));
  const window = cell({}, undefined, "2026-08");
  const full = output(items(window, later(100)));
  const seoul = rowOf(full, "seoul", "all", 30);
  const [ciLow, ciHigh] = clopperPearson(60, 100);
  assert.deepEqual({ ...seoul, reference: null }, { unit: "seoul", segment: "all", h: 30, snapshots: 11, n: 100, hits: 60, rate: 0.6, ciLow: Math.round(ciLow * 1e4) / 1e4, ciHigh: Math.round(ciHigh * 1e4) / 1e4, above: 40, below: 0, aboveRate: 0.4, belowRate: 0, reference: null });
  assert.deepEqual(seoul.reference.indexOff, { n: 100, rate: 0.6 });
  assert.deepEqual(seoul.reference.dropLast30, { n: 0, rate: null }, "직전 30일을 빼면 칸이 없다");
  assert.equal(rowOf(full, "price", "6eok-or-less", 30).n, 100);
  assert.equal(rowOf(full, "price", "6-9eok", 30).n, 0);
  assert.equal(rowOf(full, "cellN", "3-4", 30).n, 100);
  assert.equal(rowOf(full, "cellN", "5+", 30).n, 0);
  assert.deepEqual(full.seoulBySnapshot[0], { h: 30, low: { s: "2026-09-01", rate: 0.6 }, high: { s: "2026-09-01", rate: 0.6 } });

  const thin = rowOf(output(items(window, later(99))), "seoul", "all", 30);
  assert.equal(thin.n, 99);
  for (const key of ["hits", "rate", "ciLow", "ciHigh", "above", "below", "aboveRate", "belowRate"]) assert.equal(thin[key], null, key);
  assert.equal(thin.reference.indexOff.rate, null);
  assert.deepEqual(output(items(window, later(99))).seoulBySnapshot[0], { h: 30, low: null, high: null });
});

test("단위: 가격대 5구간과 칸 n 구간은 칸마다 나뉘어 세어진다", () => {
  const medians = [["6eok-or-less", 60000], ["6-9eok", 60001], ["9-15eok", 150000], ["15-25eok", 250000], ["over-25eok", 250001]];
  const priced = medians.flatMap(([, amount], i) => [...cell({ apt: `합성가격${i}` }, [amount, amount, amount], "2026-08"), deal({ apt: `합성가격${i}`, amount, date: "2026-09-02" })]);
  const byPrice = output(items(priced));
  for (const [segment] of medians) assert.equal(rowOf(byPrice, "price", segment, 30).n, 1, segment);
  assert.equal(rowOf(byPrice, "seoul", "all", 30).n, 5);

  const sized = (count, apt) => [...Array.from({ length: count }, (_, i) => deal({ apt, amount: 11000, date: `2026-08-1${i}` })), deal({ apt, amount: 11000, date: "2026-09-02" })];
  const bySize = (count) => output(items(sized(count, "합성크기")));
  assert.deepEqual([3, 4, 5].map((count) => [rowOf(bySize(count), "cellN", "3-4", 30).n, rowOf(bySize(count), "cellN", "5+", 30).n]), [[1, 0], [1, 0], [0, 1]]);
});

test("R2 후보는 2025-11-01 부터다: 그 전 달초는 세지 않는다", () => {
  const first = output(items(cell({}, undefined, "2025-10"), deal({ amount: 11000, date: "2025-11-10" })));
  assert.equal(rowOf(first, "seoul", "all", 30).n, 1);
  const earlier = output(items(cell({}, undefined, "2025-09"), deal({ amount: 11000, date: "2025-10-10" })));
  assert.equal(rowOf(earlier, "seoul", "all", 30).n, 0);
});

test("R7 S별 서울 최저~최고는 그 달초와 함께 싣고 n<100 달초는 뺀다", () => {
  const many = (date, amount, count) => Array.from({ length: count }, () => deal({ amount, date }));
  const out = output(items(cell({}, undefined, "2026-05"), many("2026-06-15", 11000, 100), many("2026-07-15", 12500, 100), many("2026-08-15", 11000, 99)));
  assert.deepEqual(out.seoulBySnapshot[0], { h: 30, low: { s: "2026-07-01", rate: 0 }, high: { s: "2026-06-01", rate: 1 } });
  assert.equal(rowOf(out, "seoul", "all", 30).n, 299);
});

test("Clopper–Pearson 95% 는 알려진 값과 같다", () => {
  const near = ([a, b], [c, d]) => assert.ok(Math.abs(a - c) < 1e-4 && Math.abs(b - d) < 1e-4, `${a},${b} ≠ ${c},${d}`);
  near(clopperPearson(50, 100), [0.3983, 0.6017]);
  near(clopperPearson(0, 10), [0, 0.3085]);
  near(clopperPearson(10, 10), [0.6915, 1]);
  near(clopperPearson(1, 10), [0.0025, 0.445]);
  near(clopperPearson(5000, 10000), [0.4902, 0.5098]);
});

test("P1-8 합성 출력은 허용 키 안이고 24줄이며 구·단지·칸 해시가 없다", () => {
  const input = items(cell({}, undefined, "2026-08"), deal({ amount: 11000, date: "2026-09-02" }));
  const out = output(input);
  validateOutput(out, lib.DISTRICTS, [APT]);
  assert.equal(out.rows.length, 24);
  assert.equal(UNITS.length, 8);
  const text = JSON.stringify(out);
  for (const { code, name } of lib.DISTRICTS) {
    assert.ok(!text.includes(name), name);
    assert.ok(!text.includes(code), code);
  }
  assert.equal(lib.DISTRICTS.length, 25);
  assert.ok(!text.includes(lib.complexHash(CODE, APT)));
  assert.ok(!text.includes(APT));
  assert.ok(!/median|updatedAt|calculatedAt|now\b/.test(text), "칸별 중간값·실행 시각 키가 없다");
});

test("P1-8 허용 키 밖이나 공개 단위 밖이 하나라도 있으면 실패한다", () => {
  const input = items(cell({}, undefined, "2026-08"));
  const broken = (edit) => {
    const out = structuredClone(output(input));
    edit(out);
    return () => validateOutput(out, lib.DISTRICTS, [APT]);
  };
  assert.throws(broken((o) => (o.calculatedAt = "x")), /허용 키 밖/);
  assert.throws(broken((o) => (o.rows[0].district = "x")), /허용 키 밖/);
  assert.throws(broken((o) => (o.rows[0].reference.cells = 1)), /허용 키 밖/);
  assert.throws(broken((o) => (o.rows[0].reference.indexOff.median = 1)), /허용 키 밖/);
  assert.throws(broken((o) => (o.replay.cells = [])), /허용 키 밖/);
  assert.throws(broken((o) => (o.rows[0].segment = "종로구")), /공개 단위 밖/);
  assert.throws(broken((o) => o.rows.pop()), /24개가 아니다/);
  assert.throws(broken((o) => o.rows.push(structuredClone(o.rows[0]))), /24개가 아니다/);
  assert.throws(broken((o) => (o.rows[0].rate = 0.5)), /적중률이 있다/);
  assert.throws(broken((o) => (o.label = "종로구")), /구 이름/);
  assert.throws(broken((o) => (o.label = "11110")), /구 이름/);
  assert.throws(broken((o) => (o.label = lib.complexHash(CODE, APT))), /칸 해시/);
  assert.throws(broken((o) => (o.label = APT)), /실리면 안 되는 말/);
});

test("같은 입력이면 같은 바이트다", () => {
  const input = () => items(cell({}, undefined, "2026-08"), deal({ amount: 11000, date: "2026-09-02" }));
  assert.equal(JSON.stringify(output(input())), JSON.stringify(output(input())));
});

test("P1-4·R8 범위 함수 정의가 없고, 고정 파일을 --src 로만 불러오며, 네트워크가 없다", () => {
  const src = readFileSync(SCRIPT, "utf8");
  for (const name of ["buildFiles", "marketDeal", "c6Lines", "band", "quantile", "QUARTILE_FROM"]) {
    assert.ok(!new RegExp(`(?:function\\*?|class|const|let|var)\\s+${name}\\b`).test(src), `${name} 정의`);
    assert.ok(!new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(src), `${name} 구조 분해`);
  }
  assert.ok(!/\bfrom\s+["'][^"']*scripts\//.test(src), "scripts 정적 import 가 없다");
  assert.ok(!/\bfetch\(|node:https?|node:net|https?:\/\//.test(src), "네트워크 호출이 없다");
  assert.ok(src.indexOf("validateOutput(output, lib.DISTRICTS)") !== -1 && src.indexOf("validateOutput(output, lib.DISTRICTS)") < src.indexOf("writeFileSync(out,"), "쓰기 전에 허용 키를 본다");
});

// --- 명령줄: 임시 git 저장소에 원본·지수를 커밋해 대조값·재연·채점의 순서를 본다 ---

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: cleanEnv() }).trim();

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "retro-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, "src");
  mkdirSync(path.join(src, "raw/sale"), { recursive: true });
  mkdirSync(path.join(src, "raw/ecos"), { recursive: true });
  mkdirSync(path.join(src, "scripts"), { recursive: true });
  writeFileSync(path.join(src, `raw/sale/${CODE}-202608.json`), JSON.stringify({ items: cell({}, undefined, "2026-08") }));
  writeFileSync(path.join(src, `raw/sale/${CODE}-202609.json`), JSON.stringify({ items: [deal({ amount: 11000, date: "2026-09-02" })] }));
  writeFileSync(path.join(src, `raw/sale/${CODE}-202607.json`), JSON.stringify({ ok: false, items: [deal({ amount: 99999, date: "2026-07-02" })] }));
  writeFileSync(path.join(src, "raw/ecos/apt-price-index.json"), JSON.stringify(index()));
  writeFileSync(path.join(src, "scripts/complex-price.ts"), "// 합성\n");
  git(src, "init", "-q", "-b", "main");
  git(src, "add", "-A");
  git(src, "commit", "-q", "-m", "합성 입력");
  const pins = {
    commit: git(src, "rev-parse", "HEAD"),
    "raw/sale": git(src, "rev-parse", "HEAD:raw/sale"),
    "raw/ecos/apt-price-index.json": git(src, "rev-parse", "HEAD:raw/ecos/apt-price-index.json"),
    "scripts/complex-price.ts": git(src, "rev-parse", "HEAD:scripts/complex-price.ts"),
  };
  git(src, "checkout", "-q", "--detach");
  const lines = cellLines(lib, INPUT_DATE, snapshotFiles(lib, readItems(src, lib), readIndex(src), INPUT_DATE));
  const ledger = (edit = (rows) => rows, meta = {}) => {
    const file = path.join(dir, `ledger-${Math.random().toString(36).slice(2)}.jsonl.gz`);
    const rows = [{ meta: { v: 1, s: INPUT_DATE, sourceCommit: pins.commit, ...meta } }, ...edit(structuredClone(lines))];
    writeFileSync(file, gzipSync(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"));
    return file;
  };
  return { dir, src, pins, ledger, expected: lines.length };
}

function capture() {
  const said = [];
  return { said, log: (m) => said.push(m), err: (m) => said.push(m) };
}
const noOrder = async () => ({ touching: 0 });

test("P1-5 대조값을 하나만 바꿔도 0 이 아닌 코드로 멈춘다", (t) => {
  const { src, pins, ledger } = fixture(t);
  const file = ledger();
  const url = pathToFileURL(SCRIPT).href;
  const run = (given) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", `import { runCli } from ${JSON.stringify(url)}; process.exitCode = await runCli(JSON.parse(process.env.RETRO_ARGV), { pins: JSON.parse(process.env.RETRO_PINS) });`], {
      encoding: "utf8",
      env: { ...cleanEnv(), RETRO_ARGV: JSON.stringify(["--replay", "--src", src, "--ledger", file]), RETRO_PINS: JSON.stringify(given) },
    });
  for (const key of Object.keys(PINS)) {
    const r = run({ ...pins, [key]: "0".repeat(40) });
    assert.equal(r.status, 3, `${key}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`대조값 불일치.*${key.replace(/[/.]/g, "\\$&")}`));
    assert.ok(!r.stdout.includes("재연"), `${key}: 대조값에서 멈춰야 한다`);
  }
  // 고정값 그대로의 명령줄도 임시 저장소에서는 멈춘다.
  const direct = spawnSync(process.execPath, [SCRIPT, "--replay", "--src", src, "--ledger", file], { encoding: "utf8", env: cleanEnv() });
  assert.equal(direct.status, 3);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "--replay", "--src", path.join(src, "없는 경로")], { encoding: "utf8", env: cleanEnv() }).status, 3);
});

test("P1-5 분리되지 않았거나 꺼낸 파일이 커밋과 다르면 멈춘다", (t) => {
  const { src, pins } = fixture(t);
  verifyPins(src, pins);
  writeFileSync(path.join(src, "scripts/complex-price.ts"), "// 고침\n");
  assert.throws(() => verifyPins(src, pins), /커밋과 다른 파일/);
  git(src, "checkout", "-q", "--", "scripts/complex-price.ts");
  git(src, "checkout", "-q", "-b", "가지");
  assert.throws(() => verifyPins(src, pins), /분리된/);
});

test("P1-6 재연이 일치하면 통과하고 칸 하나가 다르면 --replay·--score 가 멈춘다", async (t) => {
  const { dir, src, pins, ledger, expected } = fixture(t);
  const base = { pins, lib, expected, order: noOrder };
  const ok = capture();
  assert.equal(await runCli(["--replay", "--src", src, "--ledger", ledger()], { ...base, ...ok }), 0);
  assert.ok(ok.said.some((m) => m.includes(`재연: ${expected}/${expected} 칸 일치`)), ok.said.join("\n"));
  assert.ok(!ok.said.join("\n").match(/적중/), "재연은 적중률을 말하지 않는다");

  const out = path.join(dir, "retro.json");
  const score = (file) => ["--score", "--src", src, "--ledger", file, "--prereg", SHA, "--out", out];
  const changed = ledger((rows) => (rows[0].c6.lo += 1, rows));
  for (const argv of [["--replay", "--src", src, "--ledger", changed], score(changed)]) {
    const c = capture();
    assert.equal(await runCli(argv, { ...base, ...c }), 4);
    assert.ok(c.said.some((m) => m.includes(`재연: ${expected - 1}/${expected}`)), c.said.join("\n"));
  }
  assert.equal(existsSync(out), false);

  const fewer = capture();
  assert.equal(await runCli(score(ledger((rows) => rows.slice(1))), { ...base, ...fewer }), 4);
  const wrongCommit = capture();
  assert.equal(await runCli(score(ledger(undefined, { sourceCommit: SHA })), { ...base, ...wrongCommit }), 4);
  assert.match(wrongCommit.said.join("\n"), /sourceCommit/);
  assert.equal(existsSync(out), false);
});

test("--score 는 사전 등록 순서·인자·기존 파일을 먼저 보고, 통과하면 허용 키만 쓴다", async (t) => {
  const { dir, src, pins, ledger, expected } = fixture(t);
  const base = { pins, lib, expected, ...capture() };
  const file = ledger();
  const out = path.join(dir, "retro.json");
  const argv = ["--score", "--src", src, "--ledger", file, "--prereg", SHA, "--out", out];

  assert.equal(await runCli(argv.filter((a) => a !== "--prereg" && a !== SHA), { ...base, order: noOrder }), 2);
  assert.equal(await runCli(argv.slice(0, -2), { ...base, order: noOrder }), 2);
  assert.equal(await runCli(argv, { ...base, order: async () => { throw new Error("조상이 아니다"); } }), 5);
  assert.equal(existsSync(out), false);
  assert.equal(await runCli(["--replay", "--score", "--src", src], { ...base, order: noOrder }), 2);
  assert.equal(await runCli(["--replay", "--src", src, "--모르는값"], { ...base, order: noOrder }), 2);

  let asked = null;
  assert.equal(await runCli(argv, { ...base, order: async (sha) => { asked = sha; } }), 0);
  assert.equal(asked, SHA);
  const written = readFileSync(out, "utf8");
  const parsed = JSON.parse(written);
  validateOutput(parsed, lib.DISTRICTS, [APT]);
  assert.equal(parsed.prereg, SHA);
  assert.deepEqual(parsed.replay, { matched: expected, total: expected });
  assert.equal(rowOf(parsed, "seoul", "all", 30).n, 1);
  assert.equal(readItems(src, lib)[CODE].length, 4, "ok:false 슬롯의 거래는 읽지 않는다");

  assert.equal(await runCli(argv, { ...base, order: noOrder }), 2, "있는 파일은 덮어쓰지 않는다");
  const again = path.join(dir, "retro-again.json");
  assert.equal(await runCli([...argv.slice(0, -1), again], { ...base, order: noOrder }), 0);
  assert.equal(readFileSync(again, "utf8"), written, "다른 경로·같은 입력이면 같은 바이트다");
});

// --- 문서 ---

test("P1-2 retro PREREG 에 R1~R8·공개 단위·노출 문장이 있고 대조값이 스크립트와 같다", () => {
  const doc = readFileSync(path.join(ROOT, "research/retro-band-2026-11/PREREG.md"), "utf8");
  for (const r of ["R1 입력", "R2 달초", "R3 닫힘", "R4 기준 달", "R5 범위", "R6 채점", "R7 참고 값", "R8 호출 0"]) assert.ok(doc.includes(`**${r}:**`), r);
  assert.ok(doc.includes("## 공개 단위"));
  assert.ok(doc.includes("## 노출"));
  assert.ok(doc.includes("결과 전 고정은 정식 실행 기준일 뿐, 블라인드가 아니다."));
  assert.ok(doc.includes("가격대 기준(v3)도 결과를 본 뒤 정했다"));
  assert.ok(doc.includes("https://github.com/kyhsa93/jipgye/issues/656#issuecomment-6402009995"));
  for (const value of Object.values(PINS)) assert.ok(doc.includes(value), value);
});

test("P1-3 원장 PREREG 는 v5 이고 v4 줄·0절 2항·7절 문장은 그대로다", () => {
  const doc = readFileSync(path.join(ROOT, "research/ledger-prereg-2026-10/PREREG.md"), "utf8");
  assert.match(doc, /^- 버전: v5 /m);
  assert.match(doc, /^- 변경 이력: v4\(\d{4}-\d{2}-\d{2}\) — 0절 2항 「2026-12 첫 Release 는 방법·건수 예고만」은 사전 등록 적중률에 그대로 적용한다\. 소유자 결정\(O1, 2026-11-03\)에 따라 같은 Release·method에 「소급」 표기 숫자를 따로 더하고, 3절 끝 줄대로 섞지 않는다\. v1~v3 의 모든 값은 그대로다\. 출처: https:\/\/github\.com\/kyhsa93\/jipgye\/issues\/656#issuecomment-6592343606$/m);
  // v5(#821, 칸 키). 12월 스냅샷 전에 들어가고 이전 값을 지우지 않는다. 「재지 않았다」는 문장은 사실이어야 하는 약속이라 그대로 고정한다.
  assert.ok(doc.includes("- 변경 이력: v5(2026-11-03) — 2026-12 스냅샷(meta.v 2)부터 칸의 단지 구분은 scripts/complex-id.ts 키다"));
  assert.ok(doc.includes("이 변경의 적중률 효과는 재지 않았다. 이전 스냅샷은 v1 정의로 채점한다. 공칭·문턱·창은 그대로다."));
  assert.ok(doc.includes("2. 「스냅샷 3회 이상」 규칙을 유지한다(A안). 원장이 11월에 시작하면 2026-12 첫 Release 는 방법·건수 예고만 싣고, 적중률 숫자는 스냅샷 3회가 쌓인 뒤에 나온다(빨라도 2027-01)."));
  assert.ok(doc.includes("> 결과가 나빠도 공개하고, 공칭에서 벗어난 칸은 범위를 비운다"));
});

test("공개 저장소: 새 파일에 비공개 경로가 없다", () => {
  for (const file of ["research/retro-band-2026-11/PREREG.md", "research/retro-band-2026-11/retro.mjs"]) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(!/\/home\/|\.claude|\/handoff\/|\/agents\/|\/tmp\//.test(text), file);
  }
});
