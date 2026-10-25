#!/usr/bin/env node
// #170 N6 판정(6403691545) 브리프 4의 대조: 고정 입력 39c24811(5-2 ③)을 git archive 로 임시 폴더에 꺼내 scripts/repeat-sales.ts 의 computeBands 로
// 사전 등록 창(202411~202608)을 계산하고, repeat_bands_n6.out 1~5절의 줄을 같은 모양으로 다시 써서 한 줄씩 같은지 본다
// (쌍 수·경계·집·앞 거래가는 정확히, 로그 척도 소수 6자리, % 1자리, 간격·흔들림까지 - 난수가 파이썬 random 과 같은 PyRandom 이다).
// N4 대조 상대는 .out 0절에 적힌 segment-change.json blob(ea82130d)을 git 에서 꺼낸다. 저장소 파일을 쓰지 않는다. 고정 커밋이 로컬에 있어야 한다.
//
// 쓰는 법: node scripts/dev/verify-repeat-bands-n6.mjs [--out <repeat_bands_n6.out 경로>]
// 종료 0 = 전부 같음, 1 = 하나라도 다름, 2 = 고정 커밋·blob 이 없음(대조하지 못함).
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BAND_PAIRS, compute, computeBands, REGISTERED } from "../repeat-sales.ts";

const root = path.resolve(import.meta.dirname, "../..");
const OUT_REL = "research/repeat-sales-2026-10/repeat_bands_n6.out";
export const N4_BLOB = "ea82130d1f17aaa137126666b2d70f911c376567";
const NAMES = ["낮은 쪽", "가운데", "높은 쪽"];

const f6 = (x) => (x == null ? "" : x.toFixed(6));
const pct = (x) => {
  if (x == null) return "";
  const v = Math.expm1(x) * 100;
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`;
};
const sgn = (x) => (x > 0 ? "+1" : x < 0 ? "-1" : "+0");

/** .out 1~5절과 같은 모양의 줄(머리 기록 0절과 6절의 고정 문구는 뺀다). */
export function outLines(b, before, excluded) {
  const L = [
    `이상치 제외 뒤 서울 쌍 ${b.n} (제외 전 ${before}, 이상치 제외 ${excluded})`,
    `B1 = ${b.b1}, B2 = ${b.b2} (낮은 쪽 <= B1 < 가운데 <= B2 < 높은 쪽)`,
    `가격대별 쌍 수 합 = ${b.stats.reduce((a, s) => a + s.n, 0)}`,
  ];
  b.stats.forEach((s, k) => {
    const marks = [];
    if (!s.qualified) marks.push(`쌍이 모자람(${s.n}쌍) - 값 비움`);
    if (s.shaky) marks.push("흔들림 - 값 비움");
    L.push([NAMES[k], s.n, s.houses, s.frontMin, s.frontMax, s.frontMedian, f6(s.median), pct(s.median), f6(s.lo), f6(s.hi), `${pct(s.lo)}~${pct(s.hi)}`, f6(s.width), s.gapMedian, f6(s.jitter), marks.join(", ")].join(" | "));
  });
  BAND_PAIRS.forEach(([i, j], k) => {
    const v = b.verdicts[k];
    L.push(`${NAMES[i]}-${NAMES[j]}: ${v.ok ? "말할 수 있음" : "말할 수 없음(구간이 겹침)"}${v.ok && v.dir ? `, 높은 쪽 가격대 값이 ${v.dir > 0 ? "더 큼" : "더 작음"}` : ""}`);
  });
  L.push(`② 쌍 수 >= 91인 가격대: ${b.stats.filter((s) => s.qualified).length}곳 / 3`);
  L.push(`⑥ F 흔들림 가격대: ${NAMES.filter((_, k) => b.stats[k].shaky).join(", ") || "없음"}`);
  L.push(`② 공개된 가격대 ${b.published}곳 -> ${b.tablePublic ? "3곳, 표 공개 가능" : "3곳 미만 - 표 보류"}`);
  L.push(`⑥ E 간격 중앙값 ${b.stats.map((s) => s.gapMedian).join(", ")}일, 최대-최소 = ${b.gapSpread}일 -> ${b.dropDiff ? "가격대 사이 「차이」 문장 삭제(>= 90일)" : "문장 유지(< 90일)"}`);
  const n4 = b.n4;
  L.push(`대응(가격대 쌍의 앞 거래가 중앙값이 속하는 N4 가격대): ${NAMES.map((nm, k) => `${nm}(${b.stats[k].frontMedian}만원) -> ${n4.map[k]}`).join(", ")}`);
  for (const p of n4.pairs) {
    L.push(p.comparable ? `${NAMES[p.i]}-${NAMES[p.j]}: N6 부호 ${sgn(p.s6)}, N4 부호 ${sgn(p.s4)} -> ${p.hit ? "일치" : "불일치"}` : `${NAMES[p.i]}-${NAMES[p.j]}: 같은 N4 가격대에 걸려 비교하지 않음`);
  }
  L.push(`비교 가능 ${n4.comparable}쌍, 일치 ${n4.agree}쌍 -> ${n4.show ? "표시" : "접음"}`);
  return L;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const outArg = process.argv.indexOf("--out");
  const outText = readFileSync(outArg > 0 ? process.argv[outArg + 1] : path.join(root, OUT_REL), "utf8");
  try {
    execFileSync("git", ["cat-file", "-e", `${REGISTERED.input}^{commit}`], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["cat-file", "-e", N4_BLOB], { cwd: root, stdio: "ignore" });
  } catch {
    console.log(`SKIP 고정 커밋 ${REGISTERED.input.slice(0, 8)} 또는 N4 blob ${N4_BLOB.slice(0, 8)} 이 로컬에 없다(git fetch origin)`);
    process.exit(2);
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "jipgye-repeat-n6-"));
  let failed = 0;
  try {
    execSync(`git archive ${REGISTERED.input} raw/sale | tar -x -C "${tmp}"`, { cwd: root });
    const dir = path.join(tmp, "raw/sale");
    const rows = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((n) => JSON.parse(readFileSync(path.join(dir, n), "utf8")).items ?? []);
    const n4Json = JSON.parse(execFileSync("git", ["cat-file", "blob", N4_BLOB], { cwd: root, encoding: "utf8" }));
    const n4 = Object.fromEntries(n4Json.price.map((r) => [r.key, r.change]));
    // R-ONE 은 가격대 계산에 안 쓴다(빈 계열).
    const result = compute(rows, new Map(), REGISTERED.window);
    const b = computeBands(result.seoulUnits, n4);
    const before = result.rows.reduce((a, r) => a + r.before, 0);
    const excluded = result.rows.reduce((a, r) => a + r.excluded, 0);
    const want = new Set(outText.split("\n"));
    for (const line of outLines(b, before, excluded)) {
      if (!want.has(line)) {
        failed += 1;
        console.log(`FAIL .out 에 없는 줄: ${line}`);
      }
    }
    console.log(failed ? `FAIL ${failed}건` : `PASS repeat_bands_n6.out 1~5절 경계·3가격대 × 15칸·차이·점검·N4 대조 모두 같음 (입력 ${REGISTERED.input.slice(0, 8)}, 창 ${REGISTERED.window.join("~")})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}
