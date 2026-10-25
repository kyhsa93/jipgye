// 재계약 확인기 데이터(#652 V3) 빌더의 시험: 칸 집계·문턱·구간 경계·요구권 두 줄·크기 한도·소프트 실패·쓰기 경로 허용 목록.
// 오프라인 - 원본은 손으로 만든 줄(또는 임시 폴더의 슬롯 파일)이다. 데이터 값·날짜로 갈리는 검사는 없다(#8):
// 커밋된 파일의 크기 검사는 빌더가 그 한도를 넘는 파일을 쓰지 않으므로 늘 참이어야 하는 약속이다.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { BANDS, THRESHOLDS, bandOf, countLines, districtCells, packLines, renewalPair } from "../scripts/renewal-cells.ts";
import {
  ALLOWED_FILES,
  MAX_FILE_BYTES,
  MAX_GZIP_BYTES,
  WINDOW_MONTHS,
  buildFiles,
  renewalCellsFileName,
  runRenewalCells,
  writeCellsFile,
} from "../scripts/build-renewal-cells.ts";
import { MIN_DEALS } from "../scripts/complex-price.ts";
import { MIN_SAMPLE } from "../scripts/realestate-format.ts";
import { DISTRICT_SLUGS } from "../scripts/district-slugs.ts";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-25T00:00:00Z");
const MONTHS = ["202410", "202610"];

const lease = (extra = {}) => ({
  aptNm: "가상단지",
  excluUseAr: 84.97,
  contractType: "갱신",
  deposit: "50,000",
  preDeposit: "48,000",
  monthlyRent: 0,
  preMonthlyRent: "",
  useRRRight: "사용",
  dealYear: 2026,
  dealMonth: 9,
  ...extra,
});
const many = (n, extra) => Array.from({ length: n }, () => lease(extra));
const sum = (a) => a.reduce((x, y) => x + y, 0);

test("구간 경계는 정수 비교다 - 정확히 4.5%는 0~4.5%, 정확히 5.0%는 상한 근처, 그 위 1만원부터 5% 초과", () => {
  assert.deepEqual(BANDS, ["down", "frozen", "low", "near", "over"]);
  const cases = [
    [10000, 9999, "down"],
    [10000, 10000, "frozen"],
    [10000, 10001, "low"],
    [10000, 10450, "low"], // 정확히 4.5%
    [10000, 10451, "near"],
    [10000, 10500, "near"], // 정확히 5.0%
    [10000, 10501, "over"],
    // 부동소수로 견주면 7000×1.045 = 7314.999… 이라 7315 가 「상한 근처」로 넘어간다. 정수 비교는 0~4.5% 에 둔다.
    [7000, 7315, "low"],
    [7000, 7350, "near"],
    [7000, 7351, "over"],
    [33333, 34999, "near"], // 4.9997%
    [33333, 35000, "over"], // 5.0002%
  ];
  for (const [pre, dep, want] of cases) assert.equal(bandOf(dep, pre), want, `${pre}→${dep}`);
});

test("순수 전세 갱신만 짝이 된다 - 신규·반전세·종전 월세·종전 보증금 없음·미기재는 뺀다", () => {
  assert.deepEqual(renewalPair(lease()), { apt: "가상단지", area: 84.97, rr: true, band: "low" });
  assert.equal(renewalPair(lease({ contractType: "신규" })), null);
  assert.equal(renewalPair(lease({ contractType: "" })), null, "갱신 여부 미기재");
  assert.equal(renewalPair(lease({ monthlyRent: 4 })), null, "반전세(지금 월세)");
  assert.equal(renewalPair(lease({ preMonthlyRent: "5" })), null, "반전세(종전 월세)");
  assert.equal(renewalPair(lease({ preDeposit: "" })), null);
  assert.equal(renewalPair(lease({ preDeposit: "0" })), null);
  assert.equal(renewalPair(lease({ monthlyRent: "x" })), null, "읽을 수 없는 월세는 0 으로 보지 않는다");
  assert.equal(renewalPair(lease({ aptNm: " " })), null);
  assert.equal(renewalPair(lease({ useRRRight: "" })).rr, false, "표시 없음");
  assert.equal(renewalPair(lease({ useRRRight: " 사용 " })).rr, true);
  assert.equal(renewalPair(lease({ excluUseAr: 84.967 })).area, 84.97, "complex-price 와 같은 자리수");
});

test("요구권 사용과 표시 없음을 두 줄로 센다 - 칸 n 은 두 줄의 합", () => {
  const pairs = [
    ...many(2, { deposit: "50,400" }), // 사용·5.0% → near
    ...many(1, { deposit: "48,000" }), // 사용·동결
    ...many(3, { useRRRight: "", deposit: "52,000" }), // 표시 없음·8.3% → over
    ...many(1, { useRRRight: "", deposit: "47,000" }), // 표시 없음·인하
  ].map(renewalPair);
  const lines = countLines(pairs);
  assert.deepEqual(lines.rr, { n: 3, down: 0, frozen: 1, low: 0, near: 2, over: 0 });
  assert.deepEqual(lines.other, { n: 4, down: 1, frozen: 0, low: 0, near: 0, over: 3 });
  assert.equal(lines.n, 7);
  assert.deepEqual(packLines(lines), [0, 1, 0, 2, 0, 1, 0, 0, 0, 3]);
});

test("칸 문턱: n=2 는 cells 에 없고 fallback 에만, n=3·4·5 는 cells 에 있다 (MIN_DEALS)", () => {
  assert.equal(MIN_DEALS, 3);
  for (const n of [2, 3, 4, 5]) {
    const { cells, fallback } = districtCells(many(n, { aptNm: `단지${n}` }));
    if (n < 3) assert.deepEqual(cells, {}, `n=${n} 이 cells 에 실렸다`);
    else assert.equal(sum(cells[`단지${n}`]["84.97"].slice(0, 10)), n, `n=${n}`);
    assert.equal(sum(fallback["60to85"]), n, `n=${n} 의 짝이 fallback 에 없다`);
  }
});

test("평형 묶음은 complex-price 의 1㎡ 첫 면적 규칙이고, 이름은 거래가 많은 면적이다", () => {
  const { cells } = districtCells([...many(2, { excluUseAr: 84.95 }), ...many(1, { excluUseAr: 84.99 }), ...many(3, { excluUseAr: 59.9 })]);
  assert.deepEqual(Object.keys(cells["가상단지"]), ["59.9", "84.95"], "84.95·84.99 가 한 칸으로 묶이지 않았다");
  assert.equal(sum(cells["가상단지"]["84.95"].slice(0, 10)), 3);
});

test("fallback 은 자치구×면적대(conversion AREA_BANDS) - 60㎡ 미만·60~85㎡·85㎡ 이상 경계", () => {
  const { fallback } = districtCells([...many(1, { excluUseAr: 59.99 }), ...many(1, { excluUseAr: 60 }), ...many(1, { excluUseAr: 84.99 }), ...many(1, { excluUseAr: 85 })]);
  assert.deepEqual(Object.fromEntries(Object.entries(fallback).map(([k, v]) => [k, sum(v)])), { under60: 1, "60to85": 2, over85: 1 });
});

test("신규 쪽은 같은 칸 면적의 신규 전세 건수와 중앙값(3건 이상일 때만, 금액은 칸 중앙값으로만 나간다)", () => {
  const renewals = many(3);
  const fresh = (dep, extra = {}) => lease({ contractType: "신규", deposit: dep, preDeposit: "", useRRRight: "", ...extra });
  const two = districtCells(renewals, [fresh("60,000"), fresh("62,000")]).cells["가상단지"]["84.97"];
  assert.deepEqual(two.slice(10), [2, null], "두 건으로 중앙값을 냈다");
  const three = districtCells(renewals, [fresh("60,000"), fresh("62,000"), fresh("70,000"), fresh("99,000", { excluUseAr: 59.9 }), fresh("99,000", { monthlyRent: 10 }), fresh("99,000", { contractType: "갱신" })]).cells["가상단지"]["84.97"];
  assert.deepEqual(three.slice(10), [3, 62000], "다른 평형·반전세·갱신이 신규에 섞였다");
});

test("파일 모양: updatedAt·window·min(기존 문턱 둘)·cells·fallback 만, 건별 값·보증금이 없다", () => {
  assert.deepEqual(THRESHOLDS, { show: MIN_DEALS, ratio: MIN_SAMPLE });
  assert.equal(MIN_SAMPLE, 5);
  const files = buildFiles({ rentsByDistrict: { 11350: many(4, { deposit: "50,100" }) }, months: MONTHS, now: NOW });
  assert.deepEqual(Object.keys(files), ["nowon"]);
  const f = files.nowon;
  assert.deepEqual(Object.keys(f), ["updatedAt", "window", "min", "cells", "fallback"]);
  assert.deepEqual(f.window, ["202410", "202610"]);
  assert.deepEqual(f.cells, { 가상단지: { "84.97": [0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, null] } });
  assert.doesNotMatch(JSON.stringify(f), /50100|48000|50,100/, "보증금 금액이 실렸다");
});

test("결정성: 원본 줄 순서를 섞어도 같은 바이트", () => {
  const items = [...many(3, { aptNm: "나" }), ...many(4, { aptNm: "가", useRRRight: "" }), ...many(3, { aptNm: "가", excluUseAr: 59.9 })];
  const a = JSON.stringify(buildFiles({ rentsByDistrict: { 11350: items }, months: MONTHS, now: NOW }));
  const b = JSON.stringify(buildFiles({ rentsByDistrict: { 11350: [...items].reverse() }, months: MONTHS, now: NOW }));
  assert.equal(a, b);
  assert.deepEqual(Object.keys(JSON.parse(a).nowon.cells), ["가", "나"]);
});

test("쓰기 경로 허용 목록: 25개 구 파일 이름뿐이고, 그 밖의 이름은 던진다", async () => {
  assert.equal(ALLOWED_FILES.size, 25);
  for (const name of ALLOWED_FILES) assert.match(name, /^renewal-cells-[a-z]+\.json$/);
  assert.deepEqual([...ALLOWED_FILES].sort(), Object.values(DISTRICT_SLUGS).map(renewalCellsFileName).sort());
  const dir = await mkdtemp(path.join(os.tmpdir(), "renewal-cells-"));
  try {
    for (const slug of ["../x", "seoul", "gangnam/../../y", ""]) await assert.rejects(writeCellsFile(dir, slug, {}), /허용 목록 밖/, slug);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("크기 한도를 넘는 구는 쓰지 않고 어제 파일을 둔다 (40KB·gzip 10KB), 임시 파일도 남기지 않는다", async () => {
  assert.equal(MAX_FILE_BYTES, 40 * 1024);
  assert.equal(MAX_GZIP_BYTES, 10 * 1024);
  const dir = await mkdtemp(path.join(os.tmpdir(), "renewal-cells-"));
  try {
    await writeCellsFile(dir, "gangnam", { v: 1 });
    // 잘 압축되는 41KB: 원문 한도
    await assert.rejects(writeCellsFile(dir, "gangnam", { a: "a".repeat(41 * 1024) }), /\d+B > 40960B/);
    const noise = Array.from({ length: 6000 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join("");
    // 원문은 한도 안이지만 gzip 이 10KB 를 넘는 것
    await assert.rejects(writeCellsFile(dir, "gangnam", { noise: noise.slice(0, 30 * 1024) }), /gzip \d+B > 10240B/);
    assert.equal(await readFile(path.join(dir, "renewal-cells-gangnam.json"), "utf8"), '{"v":1}\n', "어제 파일이 바뀌었다");
    assert.deepEqual(await readdir(dir), ["renewal-cells-gangnam.json"], "임시 파일이 남았다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function rawFixture(dir, months) {
  const items = [...many(3, { useRRRight: "" }), ...many(1, { aptNm: "얇은단지" })];
  for (const ym of months) {
    await mkdir(path.join(dir, "rent"), { recursive: true });
    await writeFile(path.join(dir, "rent", `11350-${ym}.json`), JSON.stringify({ ok: true, items }));
  }
}

test("runRenewalCells: 24개월 원본에서 구 파일을 쓰고, 실패는 ::warning 한 줄로 바꾸고 던지지 않는다", async () => {
  assert.equal(WINDOW_MONTHS, 24);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "renewal-cells-"));
  const logs = [];
  const log = (line) => logs.push(line);
  try {
    const raw = path.join(tmp, "raw");
    await rawFixture(raw, ["202410", "202411", "202610"]); // 202410 은 24개월 창(202411~202610) 밖
    const out = path.join(tmp, "out");
    const { written, warnings } = await runRenewalCells({ now: NOW, dir: out, rawDir: raw, log });
    assert.deepEqual(warnings, []);
    assert.deepEqual(Object.keys(written), ["nowon"]);
    const file = JSON.parse(await readFile(path.join(out, "renewal-cells-nowon.json"), "utf8"));
    assert.deepEqual(file.window, ["202411", "202610"]);
    assert.equal(sum(file.cells["가상단지"]["84.97"].slice(0, 10)), 6, "창 밖 달이 섞였거나 달이 빠졌다");
    assert.equal(file.cells["얇은단지"], undefined, "창 안 두 건(n<3) 칸이 실렸다");
    assert.equal(sum(file.fallback["60to85"]), 8);

    // 소프트 실패: 쓰는 곳이 파일이라 mkdir 이 실패해도 던지지 않고 경고만 남긴다.
    const blocker = path.join(tmp, "blocker");
    await writeFile(blocker, "x");
    const failed = await runRenewalCells({ now: NOW, dir: path.join(blocker, "data"), rawDir: raw, log });
    assert.deepEqual(failed.written, {});
    assert.equal(failed.warnings.length, 1);
    assert.match(logs.at(-1), /^::warning::재계약 확인기 데이터: .* 어제 파일을 그대로 둡니다$/);

    // 원본이 하나도 없으면 아무것도 쓰지 않고 경고만.
    const empty = await runRenewalCells({ now: NOW, dir: out, rawDir: path.join(tmp, "none"), log });
    assert.deepEqual(empty.written, {});
    assert.match(empty.warnings[0], /갱신 짝이 하나도 없음/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("등록: Daily 의 실거래 수집 단계가 부르는 build-complex-ratio 가 main 에서 runRenewalCells 를 부른다(소프트 실패라 await 만, 결과로 멈추지 않는다)", async () => {
  const src = await readFile(path.join(root, "scripts/build-complex-ratio.ts"), "utf8");
  assert.match(src, /^import \{ runRenewalCells \} from "\.\/build-renewal-cells\.ts";$/m);
  const main = src.slice(src.indexOf("async function main()"));
  assert.match(main, /^\s*await runRenewalCells\(\{ now, newMonths: MONTHS \}\);$/m);
  const daily = await readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8");
  assert.match(daily, /^\s*node scripts\/build-complex-ratio\.ts$/m);
  const all = await readFile(path.join(root, "scripts/update-all.mjs"), "utf8");
  assert.match(all, /run\("node scripts\/build-complex-ratio\.ts"\)/);
});

test("커밋된 구 파일은 25개 이하이고 하나하나 40KB·gzip 10KB 이하, 합 600KB 이하 (빌더가 넘는 파일을 쓰지 않는다)", async () => {
  const names = (await readdir(path.join(root, "docs/data"))).filter((f) => f.startsWith("renewal-cells-"));
  assert.ok(names.length <= 25);
  let total = 0;
  for (const name of names) {
    assert.ok(ALLOWED_FILES.has(name), `허용 목록 밖 파일: ${name}`);
    const body = await readFile(path.join(root, "docs/data", name));
    assert.ok(body.length <= MAX_FILE_BYTES, `${name} ${body.length}B`);
    assert.ok(gzipSync(body).length <= MAX_GZIP_BYTES, `${name} gzip`);
    total += body.length;
  }
  assert.ok(total <= 600 * 1024, `합 ${total}B`);
});
