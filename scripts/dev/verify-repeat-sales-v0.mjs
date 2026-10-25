#!/usr/bin/env node
// #170 V8 판정 ②의 대조: 고정 입력 39c24811(5-1 ③)을 git archive 로 임시 폴더에 꺼내 scripts/repeat-sales.ts 로 사전 등록 창(202411~202608)을 계산하고,
// repeat_index_v0.out 1~3절의 모든 값과 같은지 본다(로그 척도 소수 6자리, % 1자리, 스피어만 4자리, 쌍·집·제외 수는 정확히).
// 저장소 파일을 쓰지 않는다. 고정 커밋이 로컬에 있어야 한다(`git fetch origin`).
//
// 쓰는 법: node scripts/dev/verify-repeat-sales-v0.mjs [--out <repeat_index_v0.out 경로>]
//   --out 이 없으면 research/repeat-sales-2026-10/repeat_index_v0.out(PR #669 로 병합된 실행 기록).
// 종료 0 = 전부 같음, 1 = 하나라도 다름.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checks, compute, loadRone, REGISTERED } from "../repeat-sales.ts";

const root = path.resolve(import.meta.dirname, "../..");
const OUT_REL = "research/repeat-sales-2026-10/repeat_index_v0.out";
const outArg = process.argv.indexOf("--out");
const outText = readFileSync(outArg > 0 ? process.argv[outArg + 1] : path.join(root, OUT_REL), "utf8");

const tmp = mkdtempSync(path.join(os.tmpdir(), "jipgye-repeat-v0-"));
let failed = 0;
try {
  execSync(`git archive ${REGISTERED.input} raw/sale raw/indicators/rone-districts.json | tar -x -C "${tmp}"`, { cwd: root });
  const dir = path.join(tmp, "raw/sale");
  const names = execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".json")).sort();
  const rows = names.flatMap((n) => JSON.parse(readFileSync(path.join(dir, n), "utf8")).items ?? []);
  const rone = loadRone(JSON.parse(readFileSync(path.join(tmp, "raw/indicators/rone-districts.json"), "utf8")));
  const { rows: got, seoul } = compute(rows, rone, REGISTERED.window);
  const c = checks(got);

  const f6 = (x) => (x == null ? "" : x.toFixed(6));
  const pct = (x) => (x == null ? "" : `${Math.expm1(x) * 100 >= 0 ? "+" : ""}${(Math.expm1(x) * 100).toFixed(1)}%`);
  const g = (x) => (x == null ? "" : String(x));
  const same = (label, a, b) => {
    if (a !== b) {
      failed += 1;
      console.log(`FAIL ${label}: 계산 ${a} / .out ${b}`);
    }
  };

  const lines = outText.split("\n");
  const head = lines.findIndex((l) => l.startsWith("구 | 제외 전 쌍"));
  for (let i = 0; i < 25; i++) {
    const cells = lines[head + 1 + i].split(" | ");
    const r = got[i];
    const s = r.stat ?? {};
    const mine = [
      r.gu, String(r.before), String(r.excluded), r.before ? `${((r.excluded / r.before) * 100).toFixed(1)}%` : "", String(r.n), String(r.houses),
      f6(s.median), pct(s.median), f6(s.lo), f6(s.hi), r.stat ? `${pct(s.lo)}~${pct(s.hi)}` : "", f6(s.width), g(s.gapMedian),
      f6(r.rone), pct(r.rone), String(r.roneN), String(r.roneDropped), f6(r.diff), f6(r.jitter),
    ];
    mine.forEach((v, k) => same(`${r.gu} 칸 ${k}`, v, cells[k]));
    same(`${r.gu} 값 비움`, !r.qualified || r.shaky, cells[19].includes("값 비움"));
  }
  const sl = lines.find((l) => l.startsWith("25구 이상치 제외 뒤 쌍"));
  same("서울 쌍·집", `${seoul.n}/${seoul.houses}`, sl.match(/쌍 (\d+) .*집 (\d+)/).slice(1).join("/"));
  const sm = lines.find((l) => l.startsWith("중앙값 "));
  same("서울 줄", `중앙값 ${f6(seoul.median)} (${pct(seoul.median)}), 구간 ${f6(seoul.lo)}~${f6(seoul.hi)} (${pct(seoul.lo)}~${pct(seoul.hi)}), R-ONE 쌍맞춤 ${f6(seoul.rone)} (${pct(seoul.rone)}), 비교 쌍 ${seoul.roneN}, 비교 제외 ${seoul.roneDropped}`, sm);
  same("n_g>=91", `n_g >= 91인 구: ${c.qualified}곳`, lines.find((l) => l.startsWith("n_g >= 91")));
  same("D(i)", c.mismatch.length, Number(lines.find((l) => l.startsWith("D(i)")).match(/: (\d+)곳/)[1]));
  same("D(ii)", c.rho.toFixed(4), lines.find((l) => l.startsWith("D(ii)")).match(/= (-?[\d.]+)/)[1]);
  same("E", c.gapRho.toFixed(4), lines.find((l) => l.startsWith("E ")).match(/= (-?[\d.]+)/)[1]);
  same("F", c.shaky.join(", ") || "없음", lines.find((l) => l.startsWith("F ")).match(/: (.*) \(값 비움\)/)[1]);
  same("공표 가능", c.published.length, Number(lines.find((l) => l.startsWith("공표 가능")).match(/: (\d+)곳/)[1]));
  same("킬 스위치", c.kill, !lines.find((l) => l.startsWith("판정:")).includes("킬 스위치 미발동"));
  console.log(failed ? `FAIL ${failed}건` : `PASS repeat_index_v0.out 1~3절 25구 × 19칸·서울·점검 모두 같음 (입력 ${REGISTERED.input.slice(0, 8)}, 창 ${REGISTERED.window.join("~")})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
