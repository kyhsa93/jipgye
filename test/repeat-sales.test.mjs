// 같은 집 쌍(#170 V8) 계산·빌더 시험. 현재 데이터나 날짜에 기대는 검사는 없다 - 합성 입력과 얼린 v0 출력(fixtures/repeat-sales/v0.json)만 쓴다.
// v0.json 은 고정 입력 39c24811 을 사전 등록 창으로 돌린 빌더 출력이고, 그 출력이 repeat_index_v0.out 전 칸과 같다는 대조는
// scripts/dev/verify-repeat-sales-v0.mjs 가 한다(고정 커밋이 필요해 시험에 넣지 않았다). 여기서는 v0.json 이 .out 의 숫자 그대로인지를 잠근다.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checks, compute, FORBIDDEN, payload, PyRandom, spearman, windowFor } from "../scripts/repeat-sales.ts";
import { runRepeatSales } from "../scripts/build-repeat-sales.ts";

const V0 = JSON.parse(await readFile(new URL("./fixtures/repeat-sales/v0.json", import.meta.url), "utf8"));

// repeat_index_v0.out 1절: 구, n_g, 중앙값, 구간 하한, 구간 상한, 간격 중앙값(일), R-ONE 쌍맞춤, [%, 구간 하한 %, 구간 상한 %, R-ONE %] (91쌍 미만 두 구는 화면·JSON 에서 비운다)
const OUT = [
  ["11110", 53, 0.097374, 0.072321, 0.149169, 377, 0.074863, ["+10.2%", "+7.5%", "+16.1%", "+7.8%"]],
  ["11140", 88, 0.185340, 0.177162, 0.254479, 369.5, 0.104592, ["+20.4%", "+19.4%", "+29.0%", "+11.0%"]],
  ["11170", 119, 0.178075, 0.141430, 0.209840, 378, 0.127475, ["+19.5%", "+15.2%", "+23.3%", "+13.6%"]],
  ["11200", 255, 0.276531, 0.262989, 0.300819, 377, 0.186413, ["+31.9%", "+30.1%", "+35.1%", "+20.5%"]],
  ["11215", 117, 0.258661, 0.229574, 0.286265, 374, 0.133464, ["+29.5%", "+25.8%", "+33.1%", "+14.3%"]],
  ["11230", 295, 0.199489, 0.185717, 0.216486, 364, 0.084452, ["+22.1%", "+20.4%", "+24.2%", "+8.8%"]],
  ["11260", 205, 0.070422, 0.061423, 0.084056, 376, 0.027490, ["+7.3%", "+6.3%", "+8.8%", "+2.8%"]],
  ["11290", 378, 0.182862, 0.167881, 0.196086, 369.5, 0.084804, ["+20.1%", "+18.3%", "+21.7%", "+8.9%"]],
  ["11305", 105, 0.076734, 0.059719, 0.096228, 371, 0.042591, ["+8.0%", "+6.2%", "+10.1%", "+4.4%"]],
  ["11320", 226, 0.056364, 0.042481, 0.074801, 384, 0.036717, ["+5.8%", "+4.3%", "+7.8%", "+3.7%"]],
  ["11350", 617, 0.102279, 0.095848, 0.108634, 375, 0.056867, ["+10.8%", "+10.1%", "+11.5%", "+5.9%"]],
  ["11380", 222, 0.099501, 0.086543, 0.106197, 380, 0.064627, ["+10.5%", "+9.0%", "+11.2%", "+6.7%"]],
  ["11410", 238, 0.175810, 0.157557, 0.186727, 372.5, 0.082437, ["+19.2%", "+17.1%", "+20.5%", "+8.6%"]],
  ["11440", 209, 0.208372, 0.193983, 0.223144, 371, 0.147691, ["+23.2%", "+21.4%", "+25.0%", "+15.9%"]],
  ["11470", 240, 0.174353, 0.159895, 0.189242, 365.5, 0.137445, ["+19.0%", "+17.3%", "+20.8%", "+14.7%"]],
  ["11500", 334, 0.156933, 0.138916, 0.167702, 370, 0.096401, ["+17.0%", "+14.9%", "+18.3%", "+10.1%"]],
  ["11530", 345, 0.117783, 0.106768, 0.135802, 372, 0.077439, ["+12.5%", "+11.3%", "+14.5%", "+8.1%"]],
  ["11545", 100, 0.031061, 0.011798, 0.047037, 376.5, 0.026424, ["+3.2%", "+1.2%", "+4.8%", "+2.7%"]],
  ["11560", 369, 0.238892, 0.226382, 0.248280, 392, 0.140358, ["+27.0%", "+25.4%", "+28.2%", "+15.1%"]],
  ["11590", 306, 0.266111, 0.254234, 0.275561, 369.5, 0.128014, ["+30.5%", "+28.9%", "+31.7%", "+13.7%"]],
  ["11620", 185, 0.160121, 0.137621, 0.182761, 376, 0.085576, ["+17.4%", "+14.8%", "+20.1%", "+8.9%"]],
  ["11650", 229, 0.140773, 0.131028, 0.154151, 397, 0.125967, ["+15.1%", "+14.0%", "+16.7%", "+13.4%"]],
  ["11680", 291, 0.137201, 0.124454, 0.154151, 380, 0.108386, ["+14.7%", "+13.3%", "+16.7%", "+11.4%"]],
  ["11710", 483, 0.246400, 0.232276, 0.259511, 384, 0.179902, ["+27.9%", "+26.1%", "+29.6%", "+19.7%"]],
  ["11740", 315, 0.218939, 0.213093, 0.230727, 359, 0.129488, ["+24.5%", "+23.8%", "+26.0%", "+13.8%"]],
];

test("v0.json 은 repeat_index_v0.out 1~3절 숫자 그대로다 (판정 ②)", () => {
  assert.deepEqual(V0.window, { from: "202411", to: "202608", gap: [300, 730] });
  assert.equal(V0.rows.length, 25);
  OUT.forEach(([gu, n, m, lo, hi, gap, r, pct], i) => {
    const row = V0.rows[i];
    assert.equal(row.gu, gu);
    assert.equal(row.n, n);
    if (n < 91) {
      assert.deepEqual(row, { gu, n, st: "thin" }, `${gu}: 91쌍 미만은 값 없이 쌍 수만`);
      return;
    }
    assert.deepEqual([row.st, row.m, row.lo, row.hi, row.gap, row.r], ["ok", m, lo, hi, gap, r], gu);
    const shown = row.p.map((v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
    assert.deepEqual(shown, pct, `${gu} % 칸(.out 의 %·구간 %·R-ONE %)`);
  });
  assert.deepEqual(V0.seoul, { n: 6324, m: 0.167734, lo: 0.164303, hi: 0.173358, r: 0.104884, p: [18.3, 11.1] });
  assert.deepEqual([V0.higher, V0.compared], [25, 25]);
  assert.deepEqual(V0.checks, {
    qualified: 23, mismatch: 0, rho: 0.8646, kill: false, gapRho: -0.2172, dropCompare: false,
    shaky: [], published: 23, enough: true, manyOutliers: [],
  });
  assert.equal(V0.provenance.saleTree, "0578a78dc2647aa967adbb309045eb50a430b7e9");
  assert.equal(V0.provenance.roneBlob, "e6e8e667d4e1524e4273b13f73de2c7d8f258591");
  assert.equal(V0.provenance.registered.input, "39c2481150a68f8862af5b0745889084da232c8b");
});

test("v0.json 은 4 KB 이하이고 금지어가 없다 (판정 ⑥·5-1 ⑦)", async () => {
  const text = await readFile(new URL("./fixtures/repeat-sales/v0.json", import.meta.url), "utf8");
  assert.ok(Buffer.byteLength(text) <= 4096, `${Buffer.byteLength(text)}B`);
  for (const w of FORBIDDEN) assert.ok(!text.includes(w), w);
});

test("PyRandom 은 CPython random.Random 과 같은 난수열을 낸다 (파이썬 3.14 로 낸 값)", () => {
  let r = new PyRandom(1);
  assert.deepEqual([r.random(), r.random(), r.random()], [0.13436424411240122, 0.8474337369372327, 0.763774618976614]);
  r = new PyRandom(1);
  assert.deepEqual(r.choiceIndexes(53, 10), [7, 44, 40, 13, 26, 23, 34, 41, 4, 1]); // choices(range(53), k=10)
  r = new PyRandom(2);
  assert.deepEqual(r.sample(30, 3), [27, 1, 2]); // 작은 n: 목록 교환 갈래
  assert.deepEqual(r.sample(300, 30), [43, 184, 86, 157, 128, 108, 18, 297, 81, 220, 201, 260, 190, 278, 227, 257, 137, 14, 186, 238, 163, 194, 216, 269, 84, 286, 90, 120, 118, 12]);
  assert.deepEqual(r.sample(5000, 500).slice(0, 5), [1447, 2663, 1422, 1119, 4179]); // 큰 n: 집합 갈래
  r = new PyRandom(2);
  assert.deepEqual([r.getrandbits(7), r.getrandbits(32)], [122, 3707026329]);
});

test("창: 원본 24개월의 첫 달 ~ 이번 달 −2 (2026-10 이면 사전 등록 창)", () => {
  assert.deepEqual(windowFor("202610"), ["202411", "202608"]);
  assert.deepEqual(windowFor("202611"), ["202412", "202609"]);
  assert.deepEqual(windowFor("202702"), ["202503", "202612"]);
});

// ---------------------------------------------------------------- 합성 입력

let seq = 0;
const deal = (gu, apt, y, m, d, amount, extra = {}) => ({
  sggCd: Number(gu), umdNm: "동", aptNm: apt, excluUseAr: 84.9, floor: 5, dealYear: y, dealMonth: m, dealDay: d,
  dealAmount: amount.toLocaleString("en-US"), dealingGbn: "중개거래", cdealType: "", seq: seq++, ...extra,
});
const WIN = ["202411", "202608"];
const RONE = (gus) => new Map(gus.map((g) => [g, new Map([[202411, 100], [202511, 105], [202512, 106], [202608, 110]])]));

test("쌍 규칙: 해제는 빼고 다시 잇고, 직거래·창 밖은 빼고, 간격 300일은 들고 299일은 뺀다(창이 22개월이라 730일 끝은 창 안에 안 생긴다)", () => {
  const rows = [
    deal("11110", "가", 2024, 11, 1, 100000),
    deal("11110", "가", 2025, 3, 1, 200000, { cdealType: "O" }), // 해제 - 사이에서 빠지고 앞뒤가 다시 이어진다
    deal("11110", "가", 2025, 11, 1, 110000), // 2024-11-01 → 2025-11-01 = 365일
    deal("11110", "나", 2024, 11, 1, 100000),
    deal("11110", "나", 2025, 8, 28, 110000), // 300일
    deal("11110", "다", 2024, 11, 1, 100000),
    deal("11110", "다", 2026, 11, 1, 110000), // 창 밖(202611)
    deal("11110", "라", 2024, 11, 1, 100000),
    deal("11110", "라", 2025, 8, 27, 110000), // 299일
    deal("11110", "마", 2024, 11, 1, 100000),
    deal("11110", "마", 2025, 11, 1, 120000, { dealingGbn: "직거래" }),
    deal("11110", "바", 2024, 11, 1, 100000),
    deal("11110", "바", 2026, 11, 1, 100000), // 창 밖
    deal("11110", "차", 2024, 11, 1, 100000),
    deal("11110", "차", 2026, 10, 31, 100000), // 730일이지만 창 밖
    deal("11110", "카", 2024, 11, 1, 100000),
    deal("11110", "카", 2026, 8, 1, 100000), // 638일, 창 안
    deal("11110", "타", 2024, 8, 31, 100000), // 창 앞
    deal("11110", "타", 2025, 8, 31, 100000),
  ];
  const { rows: out } = compute(rows, RONE(["11110"]), WIN);
  const jongno = out[0];
  assert.equal(jongno.n, 3, "가(365일)·나(300일)·카(638일)");
  assert.equal(jongno.houses, 3);
  assert.equal(jongno.qualified, false);
});

test("이상치: 정확히 두 배는 남기고 두 배를 넘으면 뺀다(제외 전·제외 수를 센다)", () => {
  const rows = [
    deal("11110", "가", 2024, 11, 1, 100000),
    deal("11110", "가", 2025, 11, 1, 200000), // ln 2 - 남는다
    deal("11110", "나", 2024, 11, 1, 100000),
    deal("11110", "나", 2025, 11, 1, 200001), // 넘는다
  ];
  const { rows: out } = compute(rows, RONE(["11110"]), WIN);
  assert.deepEqual([out[0].before, out[0].excluded, out[0].n], [2, 1, 1]);
});

test("같은 집: 면적은 1㎡ 묶음, 층은 문자열 그대로(다른 층은 다른 집)", () => {
  const rows = [
    deal("11110", "가", 2024, 11, 1, 100000, { excluUseAr: 84.1 }),
    deal("11110", "가", 2025, 11, 1, 110000, { excluUseAr: 84.9 }), // 같은 묶음
    deal("11110", "나", 2024, 11, 1, 100000, { floor: 3 }),
    deal("11110", "나", 2025, 11, 1, 110000, { floor: 4 }), // 다른 집
  ];
  const { rows: out } = compute(rows, RONE(["11110"]), WIN);
  assert.equal(out[0].n, 1);
});

/** 구마다 n 쌍(집 하나에 쌍 하나), 쌍 로그 비율이 base 근처로 고르게 퍼진 합성 원본. */
function districtRows(gu, n, base) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = 100000;
    out.push(deal(gu, `단지${i}`, 2024, 11, 1, a), deal(gu, `단지${i}`, 2025, 11, 1, Math.round(a * Math.exp(base + (i - n / 2) / (n * 50)))));
  }
  return out;
}

/** checks() 에 넣을 줄 하나(compute 의 행 모양). */
const row = (gu, median, rone, { n = 100, lo = median - 0.01, hi = median + 0.01, gap = 370, shaky = false } = {}) => ({
  gu, n, qualified: n >= 91, shaky, manyOutliers: false, rone,
  stat: { median, lo, hi, width: hi - lo, gapMedian: gap },
});
const GUS = ["11110", "11140", "11170", "11200", "11215", "11230", "11260", "11290", "11305", "11320", "11350", "11380", "11410", "11440", "11470"];

test("13곳 문턱: 값을 낼 수 있는 구가 13곳이면 통과, 12곳이면 enough=false", () => {
  const ok = GUS.slice(0, 13).map((g, i) => row(g, 0.1 + i / 100, 0.05 + i / 100));
  assert.equal(checks(ok).enough, true);
  assert.equal(checks(ok).pass, true);
  const short = GUS.slice(0, 12).map((g, i) => row(g, 0.1 + i / 100, 0.05 + i / 100));
  assert.equal(checks(short).enough, false);
  assert.equal(checks(short).pass, false);
  // 흔들림으로 비운 구는 13곳에서 빠진다(F)
  const shaky = GUS.slice(0, 13).map((g, i) => row(g, 0.1 + i / 100, 0.05 + i / 100, { shaky: i === 0 }));
  assert.deepEqual([checks(shaky).published.length, checks(shaky).enough], [12, false]);
});

test("킬 스위치: 구간이 0을 안 품는 구 3곳에서 부호가 갈리거나, 스피어만 < 0.3 이면 발동", () => {
  const base = GUS.map((g, i) => row(g, 0.1 + i / 100, 0.05 + i / 100));
  assert.equal(checks(base).kill, false);
  const flip = base.map((r, i) => (i < 3 ? { ...r, rone: -0.01 - i / 1000 } : r));
  assert.equal(checks(flip).killSign, true);
  // 구간이 0을 품는 구의 부호 불일치는 세지 않는다
  const straddle = base.map((r, i) => (i < 3 ? { ...r, rone: -0.01, stat: { ...r.stat, lo: -0.01 } } : r));
  assert.equal(checks(straddle).killSign, false);
  const reversed = GUS.map((g, i) => row(g, 0.1 + i / 100, 0.3 - i / 100));
  assert.equal(checks(reversed).killRho, true);
  assert.equal(checks(reversed).kill, true);
  assert.equal(spearman([1, 2], [1, 1]), null);
});

test("E: 간격 상관 |ρ| ≥ 0.5 면 구 사이 비교 문구를 지운다(dropCompare), 값은 둔다", () => {
  const corr = GUS.map((g, i) => row(g, 0.1 + i / 100, 0.05 + i / 100, { gap: 300 + i }));
  assert.equal(checks(corr).dropCompare, true);
  assert.equal(checks(corr).pass, true);
});

test("payload: 91쌍 미만·흔들림 구는 값 없이 쌍 수와 사유만, 서울·창·출처를 싣는다", () => {
  const rows = [...districtRows("11110", 40, 0.1), ...districtRows("11140", 95, 0.2)];
  const result = compute(rows, RONE(["11110", "11140"]), WIN);
  const p = payload(result, WIN, { test: true });
  assert.deepEqual(p.rows[0], { gu: "11110", n: 40, st: "thin" });
  assert.equal(p.rows[1].st, "ok");
  assert.equal(p.rows[1].n, 95);
  for (const k of ["m", "lo", "hi", "gap", "r"]) assert.equal(typeof p.rows[1][k], "number", k);
  assert.deepEqual(p.rows[2], { gu: "11170", n: 0, st: "thin" });
  assert.equal(p.seoul.n, 135);
  assert.deepEqual(p.provenance, { test: true });
  assert.equal(p.checks.enough, false, "값을 낸 구 1곳");
  const shaky = { ...result, rows: result.rows.map((r) => (r.gu === "11140" ? { ...r, shaky: true } : r)) };
  assert.deepEqual(payload(shaky, WIN, {}).rows[1], { gu: "11140", n: 95, st: "shaky" });
});

test("25구 밖 sggCd 는 파이썬처럼 멈춘다", () => {
  assert.throws(() => compute([deal("41135", "가", 2025, 1, 1, 1)], RONE([]), WIN), /25구 밖/);
});

// ---------------------------------------------------------------- 등록·소프트 실패 (PR #684 판정 조건, #662 와 같은 모양)

test("등록: update-all·daily-update 에 따로 줄이 없고, build-district-change 끝에서 runRepeatSales 를 부른다", async () => {
  const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  const [src, daily, all] = await Promise.all([read("scripts/build-district-change.ts"), read(".github/workflows/daily-update.yml"), read("scripts/update-all.mjs")]);
  assert.match(src, /^import \{ runRepeatSales \} from "\.\/build-repeat-sales\.ts";$/m);
  const entry = src.slice(src.lastIndexOf("if (process.argv[1]"));
  assert.match(entry, /try \{\n\s*await main\(\);\n\s*\} finally \{\n\s*await runRepeatSales\(\);\n\s*\}/, "갈아타기 main(N4 구간 변화 포함) 뒤에, main 결과와 무관하게");
  assert.ok(!daily.includes("build-repeat-sales") && !all.includes("build-repeat-sales"), "따로 등록하지 않는다");
  assert.match(daily, /^\s*node scripts\/build-district-change\.ts$/m);
  assert.match(all, /run\("node scripts\/build-district-change\.ts"\)/);
});

test("runRepeatSales: 실패는 ::warning 한 줄로 바꾸고 던지지 않으며 어제 파일을 둔다, 성공하면 rename 으로 갈아 끼운다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jipgye-repeat-"));
  try {
    const file = path.join(dir, "out", "repeat-sales.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "어제\n");
    const logs = [];
    const bad = await runRepeatSales({ rawDir: path.join(dir, "none"), file, log: (m) => logs.push(m) });
    assert.equal(bad.ok, false);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^::warning::같은 집 쌍 데이터: .* - 어제 파일을 그대로 둡니다$/);
    assert.equal(await readFile(file, "utf8"), "어제\n");
    const raw = path.join(dir, "raw");
    await mkdir(path.join(raw, "sale"), { recursive: true });
    await writeFile(path.join(raw, "sale", "11110-202411.json"), JSON.stringify({ items: districtRows("11110", 5, 0.1) }));
    const rone = path.join(dir, "rone.json");
    await writeFile(rone, JSON.stringify({ source: "R-ONE A_2024_00045", series: { 11110: [["202411", 100], ["202511", 105]] } }));
    const good = await runRepeatSales({ rawDir: raw, roneFile: rone, window: ["202411", "202608"], file, log: () => {} });
    assert.equal(good.ok, true);
    assert.equal(JSON.parse(await readFile(file, "utf8")).rows[0].n, 5);
    assert.deepEqual(await readdir(path.dirname(file)), ["repeat-sales.json"], "임시 파일이 남지 않는다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
