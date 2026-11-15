import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/dev/verify-monthly-cost-index.mjs (#883): 생성기를 두 번 돌려 「같은 바이트」를 보는데, 생성기는 updatedAt 에 실행 시각을 쓴다
// (#657 D6). 두 실행에 같은 REALESTATE_NOW 를 넘기지 않으면 그 한 칸 때문에 늘 실패했다. 합성 저장소 루트에 검증 스크립트만 복사하고
// 생성기 둘은 가짜(받은 REALESTATE_NOW 를 기록하고, 없으면 지금 시각을 쓰는 - 실제 생성기와 같은 시계 의존)로 둔다.
// 실제 데이터·몬테카를로를 쓰지 않으므로 데이터 값이나 날짜에 따라 결과가 갈리지 않는다. 점·값 항목은 가짜 출력이라 FAIL 이고 보지 않는다.
const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "dev", "verify-monthly-cost-index.mjs");
const put = (p, text) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };

// 가짜 생성기: 출력 파일에 시각 한 칸만 쓰고, 받은 REALESTATE_NOW(없으면 빈 줄)를 STUB_LOG 에 한 줄 남긴다.
const stub = (outVar) => `import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(process.env.STUB_LOG, (process.env.REALESTATE_NOW ?? "") + "\\n");
writeFileSync(process.env.${outVar}, JSON.stringify({ updatedAt: process.env.REALESTATE_NOW || new Date().toISOString(), points: [] }));
`;

function run(extraEnv = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), "jipgye-verify-mc-"));
  try {
    mkdirSync(path.join(base, "scripts/dev"), { recursive: true });
    copyFileSync(SCRIPT, path.join(base, "scripts/dev/verify-monthly-cost-index.mjs"));
    put(path.join(base, "scripts/build-monthly-cost.ts"), stub("MONTHLY_COST_FILE"));
    put(path.join(base, "scripts/dev/build-monthly-cost-cells.mjs"), stub("MONTHLY_COST_CELLS_FILE"));
    put(path.join(base, "raw/indicators/series.json"), '{"series":{}}');
    const log = path.join(base, "stub.log");
    const env = { ...process.env, STUB_LOG: log, ...extraEnv };
    if (!("REALESTATE_NOW" in extraEnv)) delete env.REALESTATE_NOW;
    const r = spawnSync(process.execPath, [path.join(base, "scripts/dev/verify-monthly-cost-index.mjs")], { cwd: base, env, encoding: "utf8" });
    return { out: r.stdout + r.stderr, seen: readFileSync(log, "utf8").trim().split("\n") };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("REALESTATE_NOW 가 없으면 시각을 한 번 정해 두 실행·두 생성기에 똑같이 넘기고 「같은 바이트」가 PASS 다", () => {
  const { out, seen } = run();
  assert.equal(seen.length, 4, out);
  assert.equal(new Set(seen).size, 1, `생성기가 받은 시각이 갈렸다: ${seen.join(" / ")}`);
  assert.match(seen[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(out, /^PASS 같은 입력 같은 바이트 /m, out);
});

test("호출자가 준 REALESTATE_NOW 는 바꾸지 않고 그대로 넘긴다", () => {
  const { out, seen } = run({ REALESTATE_NOW: "2026-11-15T02:42:10.103Z" });
  assert.deepEqual(seen, Array(4).fill("2026-11-15T02:42:10.103Z"), out);
  assert.match(out, /^PASS 같은 입력 같은 바이트 .*REALESTATE_NOW 2026-11-15T02:42:10\.103Z\)$/m, out);
});
