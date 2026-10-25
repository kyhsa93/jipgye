import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generate } from "../scripts/build-monthly-cost.ts";
import { shiftMonth } from "../scripts/realestate-slots.ts";

// #631(#587 PR2b): 환산 월 비용 생성기를 Daily 에 등록 — docs/data/monthly-cost.json 하나만, 실패해도 Daily 를 멈추지 않고 기존 파일 유지,
// 같은 입력이면 같은 바이트, 칸(research/monthly-cost/cells.json)은 파이프라인이 만지지 않는다. 오프라인 시험(네트워크 없음).

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const code = (text) => text.replace(/^\s*#.*\n/gm, "");
const daily = read(".github/workflows/daily-update.yml");
const updateAll = read("scripts/update-all.mjs");
const generator = read("scripts/build-monthly-cost.ts");

/** 워크플로 스텝: [이름, run 본문] (주석 줄 제외). */
const steps = code(daily)
  .split(/\n(?= {6}- )/)
  .filter((s) => s.startsWith("      - "))
  .map((s) => [s.match(/^ {6}- name: (.+)$|^ {8}name: (.+)$/m)?.slice(1).find(Boolean) ?? null, s]);

test("Daily 스텝 이름 목록은 그대로다 - 생성기는 새 스텝이 아니라 「실거래 수집」 안, build-conversion 바로 뒤에 한 번만 --soft-fail 로 돈다", () => {
  assert.deepEqual(
    steps.map(([n]) => n).filter(Boolean),
    ["뉴스 수집", "시장 지표 수집", "실거래 수집", "기사에 실거래가 수치 붙이기", "변경사항 커밋 및 푸시"]
  );
  const calls = code(daily).match(/node scripts\/build-monthly-cost\.ts[^\n]*/g) ?? [];
  assert.deepEqual(calls, ["node scripts/build-monthly-cost.ts --soft-fail"]);
  const [, collect] = steps.find(([n]) => n === "실거래 수집");
  assert.ok(collect.indexOf("build-conversion.ts") < collect.indexOf("build-monthly-cost.ts"), "전환율과 같은 원본·계열을 읽고 그 뒤에 돈다");
  // ECOS 두 계열은 앞 스텝 「시장 지표 수집」(fetch-indicators)이 raw/indicators/series.json 에 쓴다 - 이 생성기는 네트워크를 쓰지 않는다.
  assert.ok(code(daily).indexOf("fetch-indicators.ts") < code(daily).indexOf("build-monthly-cost.ts"));
  assert.ok(!/fetch\(|https?:\/\//.test(generator.replace(/\/\*[\s\S]*?\*\//g, "")), "생성기가 네트워크를 부른다");
  // 수동 칸 스크립트는 Daily·update-all 어디서도 부르지 않는다.
  assert.ok(!/build-monthly-cost-cells/.test(code(daily)) && !/build-monthly-cost-cells\.mjs"\)/.test(updateAll));
});

test("update-all 도 같은 자리(build-conversion 뒤)에서 --soft-fail 로 한 번 부른다", () => {
  const calls = updateAll.match(/run\("node scripts\/build-monthly-cost\.ts[^"]*"\)/g) ?? [];
  assert.deepEqual(calls, ['run("node scripts/build-monthly-cost.ts --soft-fail")']);
  assert.ok(updateAll.indexOf("build-conversion.ts") < updateAll.indexOf("build-monthly-cost.ts"));
});

test("출력 경로 허용 목록: 생성기 소스가 가리키는 저장소 경로는 docs/data/monthly-cost.json·raw 뿐 - research·cells.json 글자가 없다", () => {
  const src = generator.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  assert.ok(!/research|cells\.json|MONTHLY_COST_CELLS_FILE/.test(src), "Daily 생성기에 칸 파일 경로가 남아 있다");
  const literals = [...src.matchAll(/"((?:docs|raw|research|build|cache)\/[^"]*)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(literals, ["docs/data/monthly-cost.json", "raw/indicators/series.json"]);
});

// ── generate(): 주입한 원본·계열로 돌린다(시드 587, 2,000회 - 서울 한 줄 그대로) ──

const tmpdirs = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "jipgye-mc631-"));
  tmpdirs.push(d);
  return d;
};
test.after(() => tmpdirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const NOW = new Date("2026-10-15T00:00:00Z");
function dealsFor(month) {
  const current = month >= "202509";
  const lv = current ? { jeonse: 64_000, deposit: 20_000, rent: 140 } : { jeonse: 55_000, deposit: 15_000, rent: 130 };
  const out = [];
  for (let i = 0; i < 9; i += 1) {
    const o = i - 4;
    const common = { district: "노원구", dong: "동", apt: `단지${i}`, area: 84, renewal: false, date: `${month.slice(0, 4)}-${month.slice(4)}-15` };
    out.push({ ...common, deposit10k: lv.jeonse + 1_000 * o });
    out.push({ ...common, deposit10k: lv.deposit + 500 * o, monthlyRent10k: lv.rent + 5 * o });
  }
  return out;
}
const readDeals = async (months) => Object.fromEntries(months.filter((m) => m >= "202411").map((m) => [m, dealsFor(m)]));
function seriesFile(dir) {
  const months = [];
  for (let m = "202411"; m <= "202609"; m = shiftMonth(m, 1)) months.push(m);
  const file = path.join(dir, "series.json");
  writeFileSync(file, JSON.stringify({ series: { jeonse_loan_rate: months.map((m) => [m, m === "202608" ? 4.23 : 4.0]), deposit_rate: months.map((m) => [m, m === "202608" ? 3.14 : 2.7]) } }));
  return file;
}

test("Daily 생성은 출력 폴더에 monthly-cost.json 하나만 남긴다(칸 없음, 임시 파일 찌꺼기 없음)", async () => {
  const dir = tmp();
  const out = path.join(dir, "data", "monthly-cost.json");
  const seoul = await generate({ now: NOW, outFile: out, seriesFile: seriesFile(dir), readDeals });
  assert.ok(seoul && seoul.points.length > 0);
  assert.deepEqual(readdirSync(path.dirname(out)), ["monthly-cost.json"]);
  const text = readFileSync(out, "utf8");
  assert.ok(!/"cells"|노원구|60to85/.test(text), "docs 파일에 칸 값이 들어갔다");
  assert.equal(JSON.parse(text).interval.seed, 587);
  assert.equal(JSON.parse(text).interval.iterations, 2000);
});

test("같은 입력으로 다시 돌리면 같은 바이트다(멱등)", async () => {
  const dir = tmp();
  const out = path.join(dir, "monthly-cost.json");
  const series = seriesFile(dir);
  await generate({ now: NOW, outFile: out, seriesFile: series, readDeals });
  const first = readFileSync(out, "utf8");
  await generate({ now: NOW, outFile: out, seriesFile: series, readDeals });
  assert.equal(readFileSync(out, "utf8"), first);
  assert.deepEqual(readdirSync(dir).sort(), ["monthly-cost.json", "series.json"]);
});

test("실패하면 기존 파일을 그대로 둔다 - 원본 읽기 오류·쓰기 도중 오류·쓸 값 없음", async () => {
  const dir = tmp();
  const out = path.join(dir, "monthly-cost.json");
  writeFileSync(out, "PREVIOUS");
  const series = seriesFile(dir);
  await assert.rejects(generate({ now: NOW, outFile: out, seriesFile: series, readDeals: async () => { throw new Error("raw 읽기 실패"); } }));
  assert.equal(readFileSync(out, "utf8"), "PREVIOUS");
  // 쓰기 도중 죽음: 임시 파일은 다 썼는데 rename 이 실패하는 경우(대상이 폴더) - 임시 파일을 지우고 대상은 건드리지 않는다.
  const blocked = path.join(dir, "blocked");
  mkdirSync(blocked);
  writeFileSync(path.join(blocked, "keep"), "x");
  await assert.rejects(generate({ now: NOW, outFile: blocked, seriesFile: series, readDeals }));
  assert.deepEqual(readdirSync(blocked), ["keep"]);
  rmSync(blocked, { recursive: true });
  // 쓰기 함수가 던지면(디스크 가득 등) 기존 파일 그대로.
  await assert.rejects(generate({ now: NOW, outFile: out, seriesFile: series, readDeals, write: async () => { throw new Error("ENOSPC"); } }));
  assert.equal(readFileSync(out, "utf8"), "PREVIOUS");
  assert.deepEqual(readdirSync(dir).sort(), ["monthly-cost.json", "series.json"], "임시 파일이 남았다");
  // 계열이 없거나 점이 없으면 null 이고 파일을 그대로 둔다.
  assert.equal(await generate({ now: NOW, outFile: out, seriesFile: path.join(dir, "없음.json"), readDeals }), null);
  assert.equal(await generate({ now: NOW, outFile: out, seriesFile: series, readDeals: async () => ({}) }), null);
  assert.equal(readFileSync(out, "utf8"), "PREVIOUS");
});

test("--soft-fail 이면 생성기 실패에도 종료 0(경고), 플래그 없으면 종료 1 - 어느 쪽이든 기존 파일 유지", () => {
  const dir = tmp();
  const out = path.join(dir, "monthly-cost.json");
  writeFileSync(out, "PREVIOUS");
  // 읽을 수 없는 REALESTATE_NOW 는 collectionNow 가 던진다 - 생성기 안에서 나는 실패의 대역.
  const env = { ...process.env, MONTHLY_COST_FILE: out, REALESTATE_NOW: "bad" };
  const script = path.join(root, "scripts/build-monthly-cost.ts");
  const log = execFileSync(process.execPath, [script, "--soft-fail"], { env, encoding: "utf8" });
  assert.match(log, /^::warning::환산 월 비용 생성 실패/m);
  assert.throws(() => execFileSync(process.execPath, [script], { env, stdio: "pipe" }), (err) => err.status === 1);
  assert.equal(readFileSync(out, "utf8"), "PREVIOUS");
});

test("칸 파일(research/monthly-cost/cells.json)은 파이프라인이 만지지 않는다 - 커밋 경로 밖이고 Daily·update-all 이 부르는 스크립트에 그 경로가 없다", () => {
  const sh = read("scripts/push-docs.sh");
  assert.match(sh, /^DATA_PATHS=\(docs\/data raw\)$/m);
  const entry = [...new Set([...code(daily).matchAll(/node scripts\/([a-z0-9-]+\.(?:ts|mjs))/g)].map((m) => m[1]))];
  assert.ok(entry.includes("build-monthly-cost.ts"));
  for (const name of entry) assert.ok(!/research\/monthly-cost|cells\.json/.test(read(`scripts/${name}`)), `${name} 이 칸 파일을 가리킨다`);
  assert.ok(!/research\/monthly-cost|cells\.json/.test(updateAll));
});
