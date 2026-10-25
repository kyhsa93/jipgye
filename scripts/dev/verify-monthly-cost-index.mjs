#!/usr/bin/env node
// #620(#587 PR2) 실데이터 확인. 오늘 밤 Daily 가 ECOS 백필(#628: 121Y015 201501~, 121Y002 200001~)을 series.json 에 채운 뒤
// 메인 세션이 저장소 루트에서 한 번 돌린다. 저장소 파일을 쓰지 않는다 — 생성기를 임시 폴더로 두 번 돌려 비교한다.
//
// 쓰는 법: node scripts/dev/verify-monthly-cost-index.mjs [--expect-months 202604,202605,202606,202607,202608]
// 환경: REALESTATE_NOW(선택, 마감된 달을 정하는 시각 - 생성기와 같은 이름). 종료 0 = 전부 통과, 1 = 하나라도 실패.
//
// 기대(2026-10-25 기준 원본 202411~202610, data-analyst #587 ① 댓글):
//   - series.json: jeonse_loan_rate·deposit_rate 가 202411~202608 공백 0
//   - 점 다섯 202604~202608, 202608 점 전세안 165.2→208.8 +26.4%(금리 몫 +8.65%), 월세안 175.0→205.3 +17.3% (±0.1)
//   - 202608 전세안 95% 구간 ≈ 22.2~28.4 (±0.5), 전세안 1년 변화 다섯: +10.3·+11.8·+16.9·+22.0·+26.4 (±0.5, 참고)
//   - research 칸 202608: 75칸, 0 을 벗어난 칸 51 안팎, 폭 ≤30%p 25 안팎(몬테카를로 ±3 은 경고만)
//   - docs 파일에 자치구 이름·면적대 키 없음, 두 번 돌린 바이트 같음
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const argIdx = process.argv.indexOf("--expect-months");
const expectMonths = (argIdx > 0 ? process.argv[argIdx + 1] : "202604,202605,202606,202607,202608").split(",");

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failed += 1;
};
const warn = (cond, msg) => console.log(`${cond ? "PASS" : "WARN"} ${msg}`);
const near = (got, want, tol) => typeof got === "number" && Math.abs(got - want) <= tol;

const series = JSON.parse(readFileSync(path.join(root, "raw/indicators/series.json"), "utf8")).series ?? {};
for (const name of ["jeonse_loan_rate", "deposit_rate"]) {
  const have = new Set((series[name] ?? []).filter((r) => Number(r[1]) > 0).map((r) => String(r[0])));
  const missing = [];
  for (let y = 2024, m = 11; y * 100 + m <= 202608; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const key = `${y}${String(m).padStart(2, "0")}`;
    if (!have.has(key)) missing.push(key);
  }
  const first = (series[name] ?? [])[0]?.[0];
  ok(missing.length === 0, `${name}: 202411~202608 공백 ${missing.length}${missing.length ? ` (${missing.slice(0, 5).join(",")}…)` : ""} · 첫 달 ${first} · ${(series[name] ?? []).length}개월`);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "jipgye-monthly-cost-"));
const runOnce = (tag) => {
  const env = { ...process.env, MONTHLY_COST_FILE: path.join(tmp, `${tag}.json`), MONTHLY_COST_CELLS_FILE: path.join(tmp, `${tag}-cells.json`) };
  const log = execFileSync(process.execPath, [path.join(root, "scripts/build-monthly-cost.ts")], { cwd: root, env, encoding: "utf8" });
  process.stdout.write(tag === "a" ? log : "");
  return { docs: readFileSync(env.MONTHLY_COST_FILE, "utf8"), cells: readFileSync(env.MONTHLY_COST_CELLS_FILE, "utf8") };
};

try {
  const a = runOnce("a");
  const b = runOnce("b");
  ok(a.docs === b.docs && a.cells === b.cells, `같은 입력 같은 바이트 (docs ${Buffer.byteLength(a.docs)} B · cells ${Buffer.byteLength(a.cells)} B)`);

  const docs = JSON.parse(a.docs);
  const months = docs.points.map((p) => p.month);
  ok(JSON.stringify(months) === JSON.stringify(expectMonths), `점 ${months.join(",")} (기대 ${expectMonths.join(",")})`);

  const p = docs.points.find((x) => x.month === "202608");
  ok(Boolean(p), "202608 점이 있다");
  if (p) {
    ok(near(p.jeonse.baseCost10k, 165.2, 0.1) && near(p.jeonse.cost10k, 208.8, 0.1), `전세안 ${p.jeonse.baseCost10k}→${p.jeonse.cost10k} (기대 165.2→208.8)`);
    ok(near(p.jeonse.yoy, 26.4, 0.1), `전세안 1년 변화 ${p.jeonse.yoy}% (기대 26.4)`);
    ok(near(p.jeonse.rateShare, 8.65, 0.1), `금리 몫 ${p.jeonse.rateShare}% · 보증금 몫 ${p.jeonse.depositShare}% (기대 8.65)`);
    ok(near(p.wolse.baseCost10k, 175.0, 0.1) && near(p.wolse.cost10k, 205.3, 0.1) && near(p.wolse.yoy, 17.3, 0.1), `월세안 ${p.wolse.baseCost10k}→${p.wolse.cost10k} ${p.wolse.yoy}% (기대 175.0→205.3 17.3)`);
    ok(near(p.jeonse.ci?.[0], 22.2, 0.5) && near(p.jeonse.ci?.[1], 28.4, 0.5), `전세안 95% ${p.jeonse.ci?.join("~")} (기대 22.2~28.4 ±0.5)`);
  }
  const yoys = docs.points.map((x) => x.jeonse.yoy);
  const want = [10.3, 11.8, 16.9, 22.0, 26.4];
  warn(yoys.length === 5 && yoys.every((v, i) => near(v, want[i], 0.5)), `전세안 1년 변화 ${yoys.join(" · ")} (분석가 ${want.join(" · ")}, ±0.5 참고)`);

  ok(!/"cells"|60to85|under60|over85/.test(a.docs) && !/[가-힣]+구"/.test(a.docs), "docs 파일에 칸 값(자치구·면적대)이 없다");

  const cells = JSON.parse(a.cells).points.find((x) => x.month === "202608")?.cells ?? [];
  ok(cells.length === 75, `research 칸 202608: ${cells.length}칸 (기대 75)`);
  const excl = cells.filter((c) => c.excludesZero).length;
  const pub = cells.filter((c) => c.public).length;
  warn(Math.abs(excl - 51) <= 3, `0 을 벗어난 칸 ${excl} (분석가 51)`);
  warn(Math.abs(pub - 25) <= 3, `구간 폭 ≤30%p 칸 ${pub} (분석가 25)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `결과: 실패 ${failed}건` : "결과: 통과");
process.exit(failed ? 1 : 0);
