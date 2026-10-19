#!/usr/bin/env node
// `npm test`의 진입점 (#319). 루트·tools/golden·tools/render의 `"test"`가 모두 이 파일 하나를 부른다
// (루트 `node scripts/run-tests.mjs`, 나머지 둘 `node ../../scripts/run-tests.mjs`).
//
// 왜 래퍼인가: 시험 개수 래칫(#315)이 test.yml 안에만 있어서, 무인 워크플로 넷(daily-update·summarize·
// official-price·housing-permits)이 부르는 `npm test`는 맨몸이었다. 글롭이 러너에서 어긋나 `tests 0`이어도
// `node --test`는 종료 0이라 그 게이트들이 조용히 공회전한다(#315 구멍 2). 래칫을 `npm test` 안으로 옮기면
// 모든 호출이 지나는 한 곳에서 끝나고, 워크플로에는 하한 숫자도 `if:`도 들어갈 자리가 없다.
// 하한은 cwd 기준 `test/COUNT`다 — 세 패키지가 같은 상대 위치를 쓴다. 읽는 함수와 합계 줄을 대조하는 함수는
// scripts/test-count-ratchet.mjs 한 벌이다(test.yml의 옛 스텝도 같은 함수를 지난다).
//
// 하는 일, 순서대로(실패 메시지의 `[...]`가 어느 가드가 물었는지 갈린다):
//   1. [Node] `process.features.typescript === "strip"`이 아니면 종료 1. 버전이 아니라 기능으로 막는다 —
//      `node-version: "24"`는 메이저만 고정하는 자리가 9파일 11곳이라 러너가 바뀌어도 PR이 없다(#316 R-TS).
//      Node 22.16은 `false`라서 이 기기·로컬의 Node 22는 여기서 걸린다. `.nvmrc`는 #234가 열려 있어 아직 없다.
//   2. [하한 파일] `test/COUNT`를 먼저 읽는다 — 없거나 읽히지 않거나 숫자 줄이 정확히 둘이 아니면 시험을 돌리기 전에 종료 1.
//   3. 러너를 직접 띄운다. 리포터를 argv에 박는다(`spec`·stdout) — 그래도 합계 줄 형식 가드(4)는 남긴다. 둘 중 하나만
//      서도 틀린 통과가 안 나온다. stdout은 파이프로 받아 그대로 다시 쓴다(사람이 읽는 실패 내역이 줄면 안 된다).
//   4. 러너가 끝나면 [종료 코드]·[형식]·[개수]를 따로 판정하고 모두 찍는다. 시험이 빨간데 래칫만 통과해 초록이 되는 길은
//      없다: 러너의 종료 코드가 0이 아니면 그 코드 그대로 끝낸다(1 아닌 코드도).
//   5. [시그널] 러너가 시그널로 죽었으면 래칫을 돌리지 않는다. 중간에 죽은 출력으로 개수를 세면 그게 더 나쁘다. 종료 1.
//
// `npm test -- <인자>`는 러너 인자로 그대로 넘어간다. 글롭 **앞**에 둔다 — Node는 위치 인자(글롭) 뒤의 옵션을
// 옵션이 아니라 시험 파일에 넘기는 인자로 읽어, 뒤에 두면 `--test-name-pattern` 같은 것이 조용히 안 먹는다.
// 일부만 돌리는 인자는 개수가 하한 아래라 래칫이 문다.

import { spawn } from "node:child_process";
import { readFloors, checkRatchet } from "./test-count-ratchet.mjs";

const FLOOR_PATH = "test/COUNT";
const GLOB = "test/*.test.{mjs,ts}";

if (process.features.typescript !== "strip") {
  console.error(
    `run-tests 실패[Node]: 타입 스트리핑이 켜진 Node 24 이상이 필요하다. 찾은 Node: ${process.version}, ` +
      `process.features.typescript: ${JSON.stringify(process.features.typescript)}(필요한 값: "strip"). Node 24로 다시 돌린다.`,
  );
  process.exit(1);
}

let floors;
try {
  floors = readFloors(FLOOR_PATH);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// 색: 파이프로 받으면 러너가 색을 끈다. 터미널에서 돌릴 때만 켜 둔다(합계 줄은 이스케이프를 벗기고 읽는다).
const env = { ...process.env };
if (process.stdout.isTTY && env.NO_COLOR === undefined && env.FORCE_COLOR === undefined) env.FORCE_COLOR = "1";

const child = spawn(
  process.execPath,
  ["--test", "--test-reporter=spec", "--test-reporter-destination=stdout", ...process.argv.slice(2), GLOB],
  { stdio: ["inherit", "pipe", "inherit"], env },
);

const chunks = [];
child.stdout.on("data", (chunk) => {
  chunks.push(chunk);
  process.stdout.write(chunk);
});

// 이 프로세스가 시그널을 받으면 러너에 넘기고, 러너가 죽은 모양으로 아래 close에서 끝낸다.
for (const sig of ["SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));

child.on("error", (e) => {
  console.error(`run-tests 실패[러너]: 러너를 띄우지 못했다(${e.code ?? e.message}).`);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`run-tests 실패[시그널]: 러너가 ${signal}로 끝났다. 중간에 죽은 출력으로 개수를 세지 않으므로 래칫을 돌리지 않는다.`);
    process.exitCode = 1;
    return;
  }
  if (code !== 0) console.error(`run-tests 실패[종료 코드]: 러너가 종료 코드 ${code}로 끝났다.`);
  const r = checkRatchet(floors, Buffer.concat(chunks).toString("utf8"), { floorPath: FLOOR_PATH, logLabel: "러너 출력" });
  // 시험이 빨간 실행에서 "래칫 통과"만 찍으면 초록으로 읽힌다 - 통과 줄은 러너도 0일 때만 찍는다.
  if (!r.ok || code === 0) for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  process.exitCode = code !== 0 ? code : r.ok ? 0 : 1;
});
