// 행 첫 관측일 상태(raw/first-seen, #862 조건 6)의 처음 값을 git 이력에서 만든다. 수동 전용 - Daily 는 build-realestate 가 그날 판으로 이어서 갱신한다.
//
//   node scripts/dev/first-seen-backfill.ts [--ref origin/main] [--now 2026-11-15]
//
// main 의 첫 부모 이력에서 raw/sale·raw/rent 슬롯을 바꾼 커밋을 오래된 것부터 차례로 읽어, 창의 달(windowMonths(now)) 슬롯마다 그 판의 행으로 기억을 갱신한다
// (realestate-first-seen.ts updateFirstSeen - Daily 가 날마다 하는 것과 같은 함수). 끝나면 raw/first-seen/ 을 그 결과로 통째로 바꿔 쓴다. 호출 0회, git 읽기만.
// 같은 ref·now 면 같은 바이트다. 병합 직전에 최신 main 위에서 한 번 더 돌리면 그 사이 Daily 판까지 들어간다(이 PR 이 데이터 경로 raw 를 건드리는 이유).
import { spawn, execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DISTRICTS } from "../realestate-districts.ts";
import { RAW_DIR } from "../realestate-raw.ts";
import { windowMonths } from "../realestate-slots.ts";
import { FIRST_SEEN_DIR, firstSeenPath, serializeFirstSeen, updateFirstSeen } from "../realestate-first-seen.ts";

const root = path.resolve(import.meta.dirname, "../..");
const SLOT = /^raw\/(sale|rent)\/(\d{5})-(\d{6})\.json$/;

/** `git cat-file --batch` 하나로 blob 을 차례로 읽는다(수천 판을 git show 로 따로 부르면 느리다). */
function blobReader(cwd) {
  const proc = spawn("git", ["cat-file", "--batch"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  let buffer = Buffer.alloc(0);
  let waiting = null;
  const pump = () => {
    if (!waiting) return;
    const nl = buffer.indexOf(10);
    if (nl < 0) return;
    const head = buffer.subarray(0, nl).toString();
    if (head.endsWith(" missing")) {
      buffer = buffer.subarray(nl + 1);
      const done = waiting;
      waiting = null;
      done(null);
      return;
    }
    const size = Number(head.split(" ")[2]);
    if (buffer.length < nl + 1 + size + 1) return;
    const body = buffer.subarray(nl + 1, nl + 1 + size).toString();
    buffer = buffer.subarray(nl + 1 + size + 1);
    const done = waiting;
    waiting = null;
    done(body);
  };
  proc.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });
  return {
    read: (spec) =>
      new Promise((resolve) => {
        waiting = resolve;
        proc.stdin.write(`${spec}\n`);
        pump();
      }),
    close: () => proc.stdin.end(),
  };
}

async function main() {
  const { values } = parseArgs({ options: { ref: { type: "string", default: "origin/main" }, now: { type: "string" } } });
  const now = values.now ? new Date(`${values.now}T03:00:00Z`) : new Date();
  const months = new Set(windowMonths(now));
  const codes = new Set(DISTRICTS.map(({ code }) => code));

  const log = execFileSync("git", ["log", "--first-parent", "--reverse", "--format=C %H", "--name-only", values.ref, "--", "raw/sale", "raw/rent"], {
    cwd: root,
    maxBuffer: 1 << 28,
  }).toString();
  const steps = [];
  let commit = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("C ")) commit = line.slice(2);
    const m = SLOT.exec(line);
    if (m && months.has(m[3]) && codes.has(m[2])) steps.push({ commit, file: line, kind: m[1], code: m[2], yearMonth: m[3] });
  }

  const state = new Map();
  const reader = blobReader(root);
  let versions = 0;
  for (const step of steps) {
    const text = await reader.read(`${step.commit}:${step.file}`);
    if (text == null) continue; // 그 커밋에서 지운 슬롯
    const file = JSON.parse(text);
    if (file?.ok === false || !Array.isArray(file?.items)) continue;
    const key = `${step.kind}/${step.code}-${step.yearMonth}`;
    if (!state.has(key)) state.set(key, { ...step, seen: new Map() });
    updateFirstSeen(state.get(key).seen, file);
    versions += 1;
  }
  reader.close();

  await rm(path.join(RAW_DIR, FIRST_SEEN_DIR), { recursive: true, force: true });
  let bytes = 0;
  for (const key of [...state.keys()].sort()) {
    const { kind, code, yearMonth, seen } = state.get(key);
    const target = firstSeenPath(kind, code, yearMonth);
    const text = serializeFirstSeen(seen);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
    bytes += Buffer.byteLength(text);
  }
  const head = execFileSync("git", ["rev-parse", values.ref], { cwd: root }).toString().trim();
  console.log(`[first-seen-backfill] ref ${values.ref} (${head.slice(0, 8)}) · 달 ${[...months].join(",")} · 슬롯 판 ${versions}개 → 상태 ${state.size}개 (${bytes.toLocaleString("en-US")} B)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
