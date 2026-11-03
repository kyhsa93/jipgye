// 소급 계산: 지난 범위의 적중(#656). 규칙은 같은 폴더 PREREG.md 가 정하고, 이 파일은 그 규칙을 옮긴 것이다.
//
//   git worktree add --detach <R1 워크트리> 554320660d420525132b6b17d01605a00c821a19
//   node research/retro-band-2026-11/retro.mjs --replay --src <R1 워크트리>
//       대조값을 확인하고 2026-11-01 의 칸 값이 원장 ledger/2026-11.jsonl.gz 와 같은지만 본다. 적중률은 계산하지 않는다.
//   node research/retro-band-2026-11/retro.mjs --score --src <R1 워크트리> --prereg <PREREG 병합 커밋 40자리> --out research/retro-band-2026-11/retro.json
//       #819 판정 뒤에 공식 1회만 돌린다(PREREG 「실행 순서」). 대조값·재연·사전 등록 순서가 하나라도 어긋나면 쓰지 않는다.
//
// 범위 계산은 여기 없다. buildFiles·marketDeal·c6Lines 와 칸 가격대 함수는 --src 커밋의 파일에서 그대로 부른다(R5, 재구현 0).
// 합성 시험(test/retro-band.test.mjs)은 같은 자리에 작업 트리 함수를 넣어 돈다. 네트워크·API·모델 호출은 없다(R8).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "../..");

// R1. 하나라도 다르면 멈춘다.
export const PINS = {
  commit: "554320660d420525132b6b17d01605a00c821a19",
  "raw/sale": "bc128925db127384f7c6db23f5fb093cf3550b30",
  "raw/ecos/apt-price-index.json": "ab989c4eb49e20b6e72a4f9c946efb2b262f4b71",
  "scripts/complex-price.ts": "98d383218d087f76926c0fa817858d9d16580cff",
};
export const INPUT_DATE = "2026-11-01";
export const LEDGER_CELLS = 3066;
const LEDGER_FILE = path.join(ROOT, "ledger/2026-11.jsonl.gz");
const PREREG_PATH = "research/retro-band-2026-11/PREREG.md";
const OUTPUT_PATH = "research/retro-band-2026-11/retro.json";

// R2·R3·R6. 달초 후보, 창, 신고 기한, 공칭, 최소 n.
export const CANDIDATES = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => `${m}-01`);
export const HORIZONS = [30, 60, 90];
const REPORTING_DAYS = 30;
export const MIN_N = 100;
const NOMINAL = 0.5;
const LATE_DAYS = 30; // R7 ②
export const VARIANTS = ["main", "indexOff", "dropLast30"];

// 공개 단위. 구·단지·칸은 여기 들어올 자리가 없다.
const PRICE_SEGMENTS = ["6eok-or-less", "6-9eok", "9-15eok", "15-25eok", "over-25eok"]; // 원장 c6.band 1~5 순서
export const UNITS = [
  { unit: "seoul", segment: "all" },
  ...PRICE_SEGMENTS.map((segment) => ({ unit: "price", segment })),
  { unit: "cellN", segment: "3-4" },
  { unit: "cellN", segment: "5+" },
];

export class RetroError extends Error {
  constructor(code, message) {
    super(message);
    this.exitCode = code;
  }
}
const EXIT = { usage: 2, pins: 3, replay: 4, order: 5, output: 6 };

export const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** S−k개월의 YYYYMM. */
export function monthsBack(day, k) {
  const total = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 - k;
  return `${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, "0")}`;
}

/** R3. S+h+30 ≤ 입력 커밋 날짜. */
export const isClosed = (s, h) => addDays(s, h + REPORTING_DAYS) <= INPUT_DATE;
export const closedSnapshots = (h) => CANDIDATES.filter((s) => isClosed(s, h));
export const notClosed = () => CANDIDATES.filter((s) => !HORIZONS.some((h) => isClosed(s, h)));

/** 고정 커밋(또는 시험의 작업 트리)의 함수를 그대로 받아 온다. 대조값 확인 뒤에만 부른다. */
export async function loadLib(src) {
  const at = (file) => import(pathToFileURL(path.join(src, file)).href);
  const [price, files, ledger, districts] = await Promise.all([
    at("scripts/complex-price.ts"),
    at("scripts/build-complex-price.ts"),
    at("scripts/ledger-snapshot.ts"),
    at("scripts/realestate-districts.ts"),
  ]);
  return {
    buildFiles: files.buildFiles,
    marketDeal: price.marketDeal,
    dealDate: price.dealDate,
    yearAgoCells: price.yearAgoCells,
    c6Lines: ledger.c6Lines,
    band: ledger.band,
    complexHash: ledger.complexHash,
    DISTRICTS: districts.DISTRICTS,
  };
}

/** R1. 커밋·트리·블롭이 같고, 분리된 HEAD 이고, 꺼낸 파일이 커밋과 같아야 한다. */
export function verifyPins(src, pins = PINS) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const git = (...args) => {
    try {
      return execFileSync("git", ["-C", src, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      return null;
    }
  };
  const wrong = [];
  for (const [name, want] of Object.entries(pins)) {
    const got = git("rev-parse", name === "commit" ? "HEAD" : `HEAD:${name}`);
    if (got !== want) wrong.push(`${name}: 기대 ${want}, 실제 ${got ?? "없음"}`);
  }
  if (wrong.length) throw new RetroError(EXIT.pins, `대조값 불일치 - 멈춘다. ${wrong.join("; ")}`);
  if (git("symbolic-ref", "-q", "HEAD") !== null) throw new RetroError(EXIT.pins, "대조값: --src 가 분리된(detached) 워크트리가 아니다");
  if (git("status", "--porcelain") !== "") throw new RetroError(EXIT.pins, "대조값: --src 워크트리에 커밋과 다른 파일이 있다");
}

export function readItems(src, lib) {
  const dir = path.join(src, "raw/sale");
  const items = Object.fromEntries(lib.DISTRICTS.map(({ code }) => [code, []]));
  for (const name of readdirSync(dir).sort()) {
    const code = /^(\d{5})-\d{6}\.json$/.exec(name)?.[1];
    if (!items[code]) continue;
    const slot = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    if (slot?.ok !== false && Array.isArray(slot?.items)) for (const item of slot.items) items[code].push(item);
  }
  return items;
}

export const readIndex = (src) => JSON.parse(readFileSync(path.join(src, "raw/ecos/apt-price-index.json"), "utf8"));

/** R4(지수를 기준 달까지 자른다). R7 ① 은 같은 달의 지수를 평평하게 두어 보정 배율을 1로 만든다. */
function cutIndex(index, reference, flat) {
  const series = {};
  for (const [code, rows] of Object.entries(index.series)) {
    const kept = rows.filter(([month]) => month <= reference);
    series[code] = flat ? kept.map(([month]) => [month, 1]) : kept;
  }
  return { ...index, series };
}

/** R2·R4·R7. 한 달초 S 에 그 규칙으로 낸 자치구 파일들. buildFiles 를 그대로 부른다. */
export function snapshotFiles(lib, itemsByDistrict, index, s, variant = "main") {
  if (!VARIANTS.includes(variant)) throw new RetroError(EXIT.usage, `모르는 참고 값: ${variant}`);
  const reference = monthsBack(s, 3);
  const before = variant === "dropLast30" ? addDays(s, -LATE_DAYS) : s;
  const windowItems = {};
  for (const [code, items] of Object.entries(itemsByDistrict)) {
    windowItems[code] = items.filter((item) => {
      const date = lib.dealDate(item);
      return date !== null && date < before;
    });
  }
  const built = lib.buildFiles({
    itemsByDistrict: windowItems,
    index: cutIndex(index, reference, variant === "indexOff"),
    outlook: null,
    now: new Date(`${s}T00:00:00Z`),
  });
  if (built?.reference !== reference) throw new RetroError(EXIT.replay, `${s} 기준 달이 ${built?.reference} 다. R4 는 ${reference}`);
  return built.files;
}

export const cellLines = (lib, s, files) => lib.c6Lines(s, Object.values(files).map((json) => ({ json })));

/** R5·R6. S 뒤 90일까지의 후속 거래를 칸에 붙인다. 값은 원값, 건수는 행 수다. 이름 전체에 붙인 뒤 n<3 칸의 것은 버린다. */
export function followUps(lib, itemsByDistrict, index, s, variant = "main") {
  const files = snapshotFiles(lib, itemsByDistrict, index, s, variant);
  const lines = new Map(cellLines(lib, s, files).map(({ c6 }) => [`${c6.d}|${c6.h}|${c6.a}`, c6]));
  const codeOf = new Map(lib.DISTRICTS.map(({ code, name }) => [name, code]));
  const last = addDays(s, Math.max(...HORIZONS));
  const out = [];
  for (const json of Object.values(files)) {
    const code = codeOf.get(json.district);
    const names = new Map(Object.entries(json.cells).map(([apt, areas]) => [apt, Object.keys(areas).map(Number)]));
    const later = (itemsByDistrict[code] ?? []).map((item) => lib.marketDeal(item)).filter((deal) => deal && deal.date > s && deal.date <= last);
    for (const [key, deals] of lib.yearAgoCells(names, later)) {
      const [apt, name] = key.split("\u0000");
      const line = lines.get(`${code}|${lib.complexHash(code, apt)}|${name}`);
      if (!line) continue;
      if (lib.band(json.cells[apt][name].median) !== line.band) throw new RetroError(EXIT.output, `${s} 가격대가 c6 줄과 다르다`);
      for (const deal of deals) out.push({ date: deal.date, amount: deal.amount, lo: line.lo, hi: line.hi, cellN: line.n, price: line.band });
    }
  }
  return out;
}

/** R6. 양끝 포함. */
export const outcome = (amount, lo, hi) => (amount < lo ? "below" : amount > hi ? "above" : "hits");

const emptyTally = () => ({ n: 0, hits: 0, above: 0, below: 0 });
const unitKeys = (row) => ["seoul|all", `price|${PRICE_SEGMENTS[row.price - 1]}`, `cellN|${row.cellN <= 4 ? "3-4" : "5+"}`];

/** R3·R6. 한 달초 S 의 후속 거래를 (S, S+h] 로 잘라 단위별로 센다. 안 닫힌 창은 세지 않는다. */
export function tallySnapshot(rows, s, h, table = {}) {
  if (!isClosed(s, h)) return table;
  const end = addDays(s, h);
  for (const row of rows) {
    if (row.date > end) continue;
    for (const key of unitKeys(row)) {
      table[key] ??= emptyTally();
      table[key].n += 1;
      table[key][outcome(row.amount, row.lo, row.hi)] += 1;
    }
  }
  return table;
}

// 정칙 불완전 베타 함수(Numerical Recipes 연분수). Clopper–Pearson 구간에만 쓴다.
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of c) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betaFraction(x, a, b) {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 100000; m += 1) {
    const even = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + even * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + even / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    const odd = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + odd * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + odd / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-14) return h;
  }
  throw new RetroError(EXIT.output, "베타 함수가 수렴하지 않았다");
}
function betaCdf(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b;
}
function betaInverse(p, a, b) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i += 1) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Clopper–Pearson 95% (R6). */
export function clopperPearson(k, n) {
  return [k === 0 ? 0 : betaInverse(0.025, k, n - k + 1), k === n ? 1 : betaInverse(0.975, k + 1, n - k)];
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;

/** 한 줄. n<100 이면 건수 n 만 남긴다 - 적중 수와 빗나감 수는 적중률을 되돌려 주므로 같이 비운다. */
function rowOf({ unit, segment }, h, tally, reference) {
  const { n, hits, above, below } = tally;
  const base = { unit, segment, h, snapshots: closedSnapshots(h).length, n };
  const blank = { hits: null, rate: null, ciLow: null, ciHigh: null, above: null, below: null, aboveRate: null, belowRate: null };
  if (n < MIN_N) return { ...base, ...blank, reference };
  const [ciLow, ciHigh] = clopperPearson(hits, n);
  return { ...base, hits, rate: round4(hits / n), ciLow: round4(ciLow), ciHigh: round4(ciHigh), above, below, aboveRate: round4(above / n), belowRate: round4(below / n), reference };
}

const refOf = ({ n, hits }) => ({ n, rate: n < MIN_N ? null : round4(hits / n) });

/** 12개 달초 × 세 계산(주 숫자와 R7 둘)을 돌려 24줄과 S별 서울 최저~최고를 낸다. */
export function scoreAll(lib, itemsByDistrict, index) {
  const tables = Object.fromEntries(VARIANTS.map((v) => [v, Object.fromEntries(HORIZONS.map((h) => [h, {}]))]));
  const bySnapshot = Object.fromEntries(HORIZONS.map((h) => [h, []]));
  for (const variant of VARIANTS) {
    for (const s of CANDIDATES) {
      if (!HORIZONS.some((h) => isClosed(s, h))) continue;
      const rows = followUps(lib, itemsByDistrict, index, s, variant);
      for (const h of HORIZONS) {
        tallySnapshot(rows, s, h, tables[variant][h]);
        if (variant === "main" && isClosed(s, h)) {
          const seoul = tallySnapshot(rows, s, h)["seoul|all"];
          if (seoul && seoul.n >= MIN_N) bySnapshot[h].push({ s, rate: round4(seoul.hits / seoul.n) });
        }
      }
    }
  }
  const pick = (variant, h, { unit, segment }) => tables[variant][h][`${unit}|${segment}`] ?? emptyTally();
  const rows = HORIZONS.flatMap((h) =>
    UNITS.map((u) => rowOf(u, h, pick("main", h, u), { indexOff: refOf(pick("indexOff", h, u)), dropLast30: refOf(pick("dropLast30", h, u)) })),
  );
  const seoulBySnapshot = HORIZONS.map((h) => {
    const sorted = [...bySnapshot[h]].sort((a, b) => a.rate - b.rate || (a.s < b.s ? -1 : 1));
    return { h, low: sorted[0] ?? null, high: sorted.at(-1) ?? null };
  });
  return { rows, seoulBySnapshot };
}

export function buildOutput({ prereg, replay, scored }) {
  return {
    label: "소급",
    inputCommit: PINS.commit,
    inputDate: INPUT_DATE,
    prereg,
    command: `node research/retro-band-2026-11/retro.mjs --score --src <R1 워크트리> --prereg ${prereg} --out ${OUTPUT_PATH}`,
    nominal: NOMINAL,
    minN: MIN_N,
    interval: "clopper-pearson-95",
    replay,
    snapshots: {
      notClosed: notClosed(),
      horizons: HORIZONS.map((h) => ({ h, count: closedSnapshots(h).length, last: closedSnapshots(h).at(-1) })),
    },
    seoulBySnapshot: scored.seoulBySnapshot,
    rows: scored.rows,
  };
}

// R8·P1-8. 이 키 밖은 하나도 싣지 않는다. 키와 순서가 정확히 같아야 통과한다.
export const ALLOWED_KEYS = {
  top: ["label", "inputCommit", "inputDate", "prereg", "command", "nominal", "minN", "interval", "replay", "snapshots", "seoulBySnapshot", "rows"],
  replay: ["matched", "total"],
  snapshots: ["notClosed", "horizons"],
  horizon: ["h", "count", "last"],
  seoulBySnapshot: ["h", "low", "high"],
  extreme: ["s", "rate"],
  row: ["unit", "segment", "h", "snapshots", "n", "hits", "rate", "ciLow", "ciHigh", "above", "below", "aboveRate", "belowRate", "reference"],
  reference: ["indexOff", "dropLast30"],
  refValue: ["n", "rate"],
};

function assertKeys(value, kind) {
  const got = Object.keys(value ?? {});
  if (JSON.stringify(got) !== JSON.stringify(ALLOWED_KEYS[kind])) throw new RetroError(EXIT.output, `허용 키 밖: ${kind} = ${got.join(",")}`);
}

/** 실제 retro.json 에도 그대로 쓴다. forbidden: 합성 시험의 단지명처럼 문자열에 나오면 안 되는 말. */
export function validateOutput(output, districts, forbidden = []) {
  assertKeys(output, "top");
  assertKeys(output.replay, "replay");
  assertKeys(output.snapshots, "snapshots");
  output.snapshots.horizons.forEach((row) => assertKeys(row, "horizon"));
  for (const row of output.seoulBySnapshot) {
    assertKeys(row, "seoulBySnapshot");
    for (const end of [row.low, row.high]) if (end !== null) assertKeys(end, "extreme");
  }
  const seen = new Set();
  for (const row of output.rows) {
    assertKeys(row, "row");
    assertKeys(row.reference, "reference");
    assertKeys(row.reference.indexOff, "refValue");
    assertKeys(row.reference.dropLast30, "refValue");
    if (!UNITS.some((u) => u.unit === row.unit && u.segment === row.segment) || !HORIZONS.includes(row.h)) throw new RetroError(EXIT.output, `공개 단위 밖: ${row.unit}/${row.segment}/${row.h}`);
    seen.add(`${row.unit}|${row.segment}|${row.h}`);
    if (row.n < MIN_N && row.rate !== null) throw new RetroError(EXIT.output, `n<${MIN_N} 줄에 적중률이 있다: ${row.unit}/${row.segment}/${row.h}`);
  }
  if (seen.size !== UNITS.length * HORIZONS.length || output.rows.length !== seen.size) throw new RetroError(EXIT.output, `줄이 ${UNITS.length * HORIZONS.length}개가 아니다: ${output.rows.length}`);

  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => (strings.push(k), walk(v)));
  };
  walk(output);
  for (const text of strings) {
    for (const { code, name } of districts) {
      if (text.includes(name) || new RegExp(`(?<!\\d)${code}(?!\\d)`).test(text)) throw new RetroError(EXIT.output, `구 이름·코드가 실렸다: ${text}`);
    }
    if (/(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])/.test(text)) throw new RetroError(EXIT.output, `칸 해시가 실렸다: ${text}`);
    for (const word of forbidden) if (text.includes(word)) throw new RetroError(EXIT.output, `실리면 안 되는 말: ${word}`);
  }
}

export function readLedger(file) {
  const lines = gunzipSync(readFileSync(file)).toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { meta: lines.find((line) => line.meta)?.meta, c6: lines.filter((line) => line.c6) };
}

/** P1-6. 입력 커밋 날짜의 칸 값이 원장과 줄까지 같은가. 칸 값만 비교한다. */
export function replay(lib, itemsByDistrict, index, ledger, { commit = PINS.commit, expected = LEDGER_CELLS } = {}) {
  if (ledger.meta?.sourceCommit !== commit) throw new RetroError(EXIT.replay, `원장 sourceCommit 이 R1 과 다르다: ${ledger.meta?.sourceCommit}`);
  if (ledger.meta?.s !== INPUT_DATE) throw new RetroError(EXIT.replay, `원장 스냅샷일이 ${INPUT_DATE} 가 아니다: ${ledger.meta?.s}`);
  if (ledger.c6.length !== expected) throw new RetroError(EXIT.replay, `원장 c6 이 ${expected}줄이 아니다: ${ledger.c6.length}`);
  const mine = cellLines(lib, INPUT_DATE, snapshotFiles(lib, itemsByDistrict, index, INPUT_DATE));
  const left = new Map();
  for (const line of mine) left.set(JSON.stringify(line), (left.get(JSON.stringify(line)) ?? 0) + 1);
  let matched = 0;
  for (const line of ledger.c6) {
    const key = JSON.stringify(line);
    if (left.get(key) > 0) {
      left.set(key, left.get(key) - 1);
      matched += 1;
    }
  }
  return { matched, total: ledger.c6.length, computed: mine.length };
}

async function preregOrder(prereg) {
  const { checkOrder } = await import(pathToFileURL(path.join(ROOT, "scripts/check-prereg-order.ts")).href);
  process.chdir(ROOT);
  return checkOrder({ prereg, preregPath: PREREG_PATH, output: OUTPUT_PATH });
}

/** over 는 합성 시험만 쓴다. 명령줄에는 대조값·함수를 바꾸는 자리가 없다. */
export async function runCli(argv, over = {}) {
  const { pins = PINS, lib: givenLib, expected = LEDGER_CELLS, order = preregOrder, log = console.log, err = console.error } = over;
  try {
    let values;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: { replay: { type: "boolean" }, score: { type: "boolean" }, src: { type: "string" }, ledger: { type: "string" }, prereg: { type: "string" }, out: { type: "string" } },
      }));
    } catch (e) {
      throw new RetroError(EXIT.usage, e.message);
    }
    if (Boolean(values.replay) === Boolean(values.score)) throw new RetroError(EXIT.usage, "--replay 와 --score 중 하나만 준다");
    if (!values.src) throw new RetroError(EXIT.usage, "--src <R1 워크트리> 가 없다");
    const src = path.resolve(values.src);
    const out = values.out && path.resolve(values.out);
    const ledgerFile = values.ledger ? path.resolve(values.ledger) : LEDGER_FILE;
    if (values.score) {
      if (!/^[0-9a-f]{40}$/.test(values.prereg ?? "")) throw new RetroError(EXIT.usage, "--score 는 --prereg <PREREG 병합 커밋 40자리> 없이는 돌지 않는다");
      if (!out) throw new RetroError(EXIT.usage, "--score 는 --out 없이는 돌지 않는다");
      if (existsSync(out)) throw new RetroError(EXIT.usage, `${values.out} 가 이미 있다 - 덮어쓰지 않는다`);
    }

    verifyPins(src, pins);
    log(`[retro] 대조값 일치: ${pins.commit}`);
    if (values.score) {
      try {
        await order(values.prereg);
      } catch (e) {
        throw new RetroError(EXIT.order, `사전 등록 순서: ${e.message}`);
      }
    }

    const lib = givenLib ?? (await loadLib(src));
    const items = readItems(src, lib);
    const index = readIndex(src);
    const result = replay(lib, items, index, readLedger(ledgerFile), { commit: pins.commit, expected });
    log(`[retro] 재연: ${result.matched}/${result.total} 칸 일치 (이 규칙으로 낸 칸 ${result.computed}개)`);
    if (result.matched !== result.total || result.computed !== result.total) throw new RetroError(EXIT.replay, "재연 불일치 - 멈춘다. --score 는 돌지 않는다");
    if (values.replay) return 0;

    const output = buildOutput({ prereg: values.prereg, replay: { matched: result.matched, total: result.total }, scored: scoreAll(lib, items, index) });
    validateOutput(output, lib.DISTRICTS);
    writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
    log(`[retro] 썼다: ${values.out}`);
    return 0;
  } catch (e) {
    err(`[retro] ${e.message}`);
    return e instanceof RetroError ? e.exitCode : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await runCli(process.argv.slice(2));
}
