#!/usr/bin/env node
// 시험 하한 갱신 (#548). `npm run count:bump` — 병합 담당이 하루 사이클 끝에 한 번 돌린다.
//
// 왜: PR 마다 COUNT 두 줄을 고치면 병합 충돌과 판정 토큰이 PR 수만큼 든다. PR 은 COUNT 를 건드리지 않고(내릴 때만 예외 —
// 본문에 사유, #315 범위 4), 오르는 쪽은 이 스크립트가 실제로 돈 개수로 한 번에 다시 쓴다.
//
// 하는 일: 패키지별 시험을 돌려(루트 `npm test`, `npm run test:site`, tools/golden·tools/render `npm test`, `npm run health`)
// 합계 줄을 scripts/test-count-ratchet.mjs 의 parseTotals 로 읽고, 아래를 **모두** 만족할 때만 그 패키지의 하한 파일을 다시 쓴다.
//   - 러너 종료 코드 0, fail 0, cancelled 0 (tests·pass 합계 줄이 둘 다 있다)
//   - skipped 가 늘지 않았다: 현재 하한이 말하는 skipped(= tests 하한 - pass 하한)보다 크지 않다
//   - tests·pass 가 현재 하한 이상이다(내리는 쓰기는 `--allow-lower` 없이는 거부)
// 쓰는 내용은 고정 머리 주석(COUNT_HEADER, ≤6줄)과 숫자 둘뿐이다. 설명은 PR 본문·이력에 둔다(test/run-tests.test.mjs 가 ≤6줄을 단언).
//
// 쓰는 법:
//   npm run count:bump                    # 다섯 패키지 전부(root·site·golden·health·render 순서 — root 의 pretest 가 build/site 를 만든다)
//   npm run count:bump -- --only root,site
//   npm run count:bump -- --dry-run       # 무엇을 쓸지만 찍는다
//   npm run count:bump -- --allow-lower   # 의도해서 내릴 때만. 이때는 러너가 래칫([개수])으로만 빨간 것도 받는다
//   node scripts/count-bump.mjs --floor <하한파일> --log <러너 로그> [--exit <코드>]   # 시험을 돌리지 않고 로그 하나로 한 파일만(대조군용)
// 종료 코드: 모두 반영되거나 그대로면 0, 하나라도 거부되면 1(나머지 패키지는 독립으로 반영된다), 사용법 오류 2.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseTotals, readFloors } from "./test-count-ratchet.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// 모든 COUNT 파일이 같은 머리를 쓴다 — 패키지별 설명을 덧붙이지 않는다(≤6줄은 시험이 지킨다).
export const COUNT_HEADER = [
  "# 시험 하한 둘 — 1행 tests 하한, 2행 pass 하한. 래칫: scripts/test-count-ratchet.mjs (#315).",
  "# PR 은 이 파일을 건드리지 않는다. 병합 담당이 하루 끝에 `npm run count:bump` 로 한 번 올린다(#548).",
  "# 내리는 변경만 PR 에서 직접 고치고 본문에 사유를 적는다(#315 범위 4). 설명은 PR 본문·이력에 둔다.",
].join("\n");

export function renderCount({ tests, pass }) {
  return `${COUNT_HEADER}\n${tests}\n${pass}\n`;
}

// 하한 파일 하나의 갱신 판정(파일을 읽지도 쓰지도 않는다). floors: { tests, pass }, exitCode: 러너 종료 코드(모르면 undefined).
// 반환: { ok, write, lines } — ok 가 거짓이면 write 는 null 이고 lines 가 이유다. ok 이고 write 가 하한과 같으면 "그대로"다.
export function decideBump(floors, logText, { exitCode, allowLower = false } = {}) {
  const t = parseTotals(logText);
  const missing = ["tests", "pass", "skipped", "fail", "cancelled"].filter((k) => t[k] === null);
  if (missing.length > 0) {
    return { ok: false, write: null, lines: [`거부[형식]: 합계 줄 ${missing.join("·")}을(를) 로그에서 찾지 못했다.`] };
  }
  // 비0 종료는 거부 — 단 --allow-lower 에서 러너가 래칫([개수])으로만 빨간 것(시험은 전부 초록)은 받는다: 내리려는 쓰기가 래칫에 먼저 막히기 때문이다.
  const ratchetOnly = allowLower && /래칫 실패\[개수\]/.test(logText) && !/run-tests 실패\[/.test(logText);
  if (exitCode !== undefined && exitCode !== 0 && !ratchetOnly) {
    return { ok: false, write: null, lines: [`거부[종료 코드]: 러너가 종료 코드 ${exitCode}로 끝났다 — 초록이 아니면 하한을 쓰지 않는다.`] };
  }
  if (t.fail !== 0 || t.cancelled !== 0) {
    return { ok: false, write: null, lines: [`거부[실패]: fail ${t.fail} · cancelled ${t.cancelled} — 초록이 아니면 하한을 쓰지 않는다.`] };
  }
  if (t.tests === 0 || t.pass === 0) {
    return { ok: false, write: null, lines: [`거부[개수]: tests ${t.tests} · pass ${t.pass} — 0 은 하한으로 쓰지 않는다.`] };
  }
  const floorSkipped = floors.tests - floors.pass;
  if (t.skipped > floorSkipped && !allowLower) {
    return {
      ok: false,
      write: null,
      lines: [`거부[skip]: skipped ${t.skipped} > 하한이 말하는 ${floorSkipped}(= tests ${floors.tests} - pass ${floors.pass}) — skip 이 는 채로 올리지 않는다. 정당하면 --allow-lower 와 PR 본문 사유.`],
    };
  }
  const lowers = ["tests", "pass"].filter((k) => t[k] < floors[k]);
  if (lowers.length > 0 && !allowLower) {
    return {
      ok: false,
      write: null,
      lines: [`거부[내림]: ${lowers.map((k) => `${k} ${t[k]} < 하한 ${floors[k]}`).join(" · ")} — 내리는 쓰기는 --allow-lower 가 있어야 한다(PR 본문에 사유).`],
    };
  }
  const write = { tests: t.tests, pass: t.pass };
  const same = write.tests === floors.tests && write.pass === floors.pass;
  return {
    ok: true,
    write,
    lines: [same ? `그대로: tests ${write.tests} · pass ${write.pass}` : `갱신: tests ${floors.tests} → ${write.tests} · pass ${floors.pass} → ${write.pass}`],
  };
}

// 파일을 읽어 판정하고, 통과이고 내용이 달라질 때만 고정 머리 + 숫자 둘로 다시 쓴다. dryRun 이면 쓰지 않는다.
export function bumpFloor(floorPath, logText, { exitCode, allowLower = false, dryRun = false } = {}) {
  const floors = readFloors(floorPath);
  const d = decideBump(floors, logText, { exitCode, allowLower });
  if (d.ok) {
    const next = renderCount(d.write);
    if (next !== readFileSync(floorPath, "utf8") && !dryRun) writeFileSync(floorPath, next);
  }
  return d;
}

// 패키지별 시험. floor 는 저장소 루트 기준, cwd 도 마찬가지다.
export const SUITES = [
  { name: "root", cwd: ".", cmd: ["npm", "test"], floor: "test/COUNT" },
  { name: "site", cwd: ".", cmd: ["npm", "run", "test:site"], floor: "test/COUNT-site" },
  { name: "golden", cwd: "tools/golden", cmd: ["npm", "test"], floor: "tools/golden/test/COUNT" },
  { name: "health", cwd: ".", cmd: ["npm", "run", "health"], floor: "tools/health/test/COUNT" },
  { name: "render", cwd: "tools/render", cmd: ["npm", "test"], floor: "tools/render/test/COUNT" },
];

function runSuite(s) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // 바깥 러너가 물려 준 값이 있으면 안쪽 러너가 리포터를 못 쓴다
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: path.join(ROOT, s.cwd), env, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return { exitCode: r.status ?? 1, log: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, signal: r.signal };
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error("사용법: node scripts/count-bump.mjs [--only root,site,golden,health,render] [--dry-run] [--allow-lower]\n        node scripts/count-bump.mjs --floor <하한파일> --log <러너 로그> [--exit <코드>] [--dry-run] [--allow-lower]");
  process.exit(2);
}

function main(argv) {
  const opts = { allowLower: false, dryRun: false, only: null, floor: null, log: null, exit: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-lower") opts.allowLower = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--only") opts.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--floor") opts.floor = argv[++i];
    else if (a === "--log") opts.log = argv[++i];
    else if (a === "--exit") opts.exit = Number(argv[++i]);
    else usage(`알 수 없는 인자: ${a}`);
  }

  if (opts.floor || opts.log) {
    if (!opts.floor || !opts.log) usage("--floor 와 --log 는 같이 쓴다.");
    if (opts.exit !== undefined && !Number.isInteger(opts.exit)) usage("--exit 는 정수다.");
    const d = bumpFloor(opts.floor, readFileSync(opts.log, "utf8"), { exitCode: opts.exit, allowLower: opts.allowLower, dryRun: opts.dryRun });
    for (const l of d.lines) (d.ok ? console.log : console.error)(`${opts.floor}: ${l}`);
    process.exitCode = d.ok ? 0 : 1;
    return;
  }

  if (process.features.typescript !== "strip") {
    console.error(`count-bump 실패[Node]: 타입 스트리핑이 켜진 Node 24 이상이 필요하다. 찾은 Node: ${process.version}.`);
    process.exit(1);
  }
  const names = SUITES.map((s) => s.name);
  if (opts.only && (opts.only.length === 0 || opts.only.some((n) => !names.includes(n)))) usage(`--only 는 ${names.join(",")} 중에서 고른다.`);
  const suites = SUITES.filter((s) => !opts.only || opts.only.includes(s.name));

  let refused = 0;
  for (const s of suites) {
    const floorPath = path.join(ROOT, s.floor);
    console.log(`[${s.name}] ${s.cmd.join(" ")} (cwd ${s.cwd})`);
    const run = runSuite(s);
    if (run.signal) {
      console.error(`[${s.name}] 거부[시그널]: 러너가 ${run.signal}로 끝났다.`);
      refused++;
      continue;
    }
    let d;
    try {
      d = bumpFloor(floorPath, run.log, { exitCode: run.exitCode, allowLower: opts.allowLower, dryRun: opts.dryRun });
    } catch (e) {
      d = { ok: false, lines: [e.message] };
    }
    for (const l of d.lines) (d.ok ? console.log : console.error)(`[${s.name}] ${s.floor}: ${l}`);
    if (!d.ok) {
      refused++;
      console.error(run.log.trim().split("\n").slice(-5).join("\n"));
    }
  }
  if (opts.dryRun) console.log("(--dry-run: 파일을 쓰지 않았다)");
  process.exitCode = refused > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main(process.argv.slice(2));
