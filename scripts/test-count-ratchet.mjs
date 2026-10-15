#!/usr/bin/env node
// 시험 개수 래칫 (#315).
//
// `node --test`에는 구멍이 둘 있다(#315 본문, pm 재현 2026-10-14 · Node v24.16.0):
//   1. 글롭을 따옴표 없이 쓰면 셸이 먼저 펼쳐, 안 맞는 파일은 Node에 **인자로 전달조차 되지 않는다**.
//   2. 글롭이 **하나도 안 맞아도 종료 코드가 0**이다.
// 둘이 겹치면 "시험이 통째로 사라졌는데 CI는 초록"이 된다. 1은 package.json의 따옴표로 막고,
// 2는 이 스크립트가 막는다 — 실제로 돈 개수가 커밋된 하한보다 작으면 실패시킨다.
//
// **하한은 둘이다 — `tests`와 `pass`를 같이 본다.**
//   `tests`만 보면 시험을 **전부 skip으로 바꾸는 길**이 열린다(cto 실측: 5개를 전부 skip시키면
//   `ℹ tests 5 · pass 0`, Node 종료 0, `tests` 하한만으로는 통과한다 — 래칫이 장식이 된다).
//   그렇다고 `pass`만 보면 tools/golden의 **정당한 게이트 skip 11개**(`GOLDEN_LIVE`)가 매번 걸린다.
//   둘 다 하한으로 두면, 정당한 skip이 하나 늘 때 `pass` 하한이 걸려 **고치는 사람이 COUNT를 내리며
//   PR 본문에 사유를 적게 된다**(#315 범위 4의 원래 뜻).
//
// 쓰는 법: node scripts/test-count-ratchet.mjs <하한파일> <npm test 로그파일>
//   하한파일(`test/COUNT`)은 주석(`#`)·빈 줄을 버리고 남는 **첫 두 줄**이 숫자다 — 1행 `tests` 하한,
//   2행 `pass` 하한. **주석이나 워크플로 인라인 숫자로 두지 않는다** — 파일이어야 올릴 때 diff에
//   잡혀 리뷰에 걸린다(#315 범위 3). 하한을 **낮추는** 변경은 PR 본문에 사유를 적는다(#315 범위 4).

import { readFileSync } from "node:fs";

const [floorPath, logPath] = process.argv.slice(2);
if (!floorPath || !logPath) {
  console.error("사용법: node scripts/test-count-ratchet.mjs <하한파일> <npm test 로그파일>");
  process.exit(2);
}

// 하한 파일: `#` 주석과 빈 줄을 버리고 남는 첫 두 줄이 숫자다.
const floorLines = readFileSync(floorPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));
const floors = {};
for (const [i, key] of ["tests", "pass"].entries()) {
  const line = floorLines[i];
  if (!/^\d+$/.test(line ?? "")) {
    console.error(`래칫 실패: ${floorPath}의 ${i + 1}번째 숫자 줄(${key} 하한)을 읽지 못했다(읽은 줄: ${JSON.stringify(line)}).`);
    process.exit(1);
  }
  floors[key] = Number(line);
}

// 러너 출력의 합계 줄. 기본(spec) 리포터는 `ℹ tests N`·`ℹ pass N`, tap 리포터는 `# tests N`·`# pass N`이다.
// 파이프·리다이렉트로 비TTY가 되어도 기본 리포터는 `ℹ` 그대로다(pm 확인 2026-10-14).
// **못 찾으면 통과시키지 않는다** — 출력 형식이 바뀌어 래칫이 조용히 장식이 되는 것이 이 이슈가 막는 것이다.
const log = readFileSync(logPath, "utf8");
const actual = {};
for (const key of ["tests", "pass"]) {
  const hits = [...log.matchAll(new RegExp(String.raw`^[ℹ#] ${key} (\d+)$`, "gm"))].map((m) => Number(m[1]));
  if (hits.length === 0) {
    console.error(`래칫 실패: ${logPath}에서 "ℹ ${key} N" 합계 줄을 찾지 못했다. 러너 출력 형식이 바뀌었는지 본다.`);
    process.exit(1);
  }
  actual[key] = hits[hits.length - 1];
}

const short = ["tests", "pass"].filter((key) => actual[key] < floors[key]);
if (short.length > 0) {
  for (const key of short) console.error(`래칫 실패: ${key} ${actual[key]}개 < 하한 ${floors[key]}개 (${floorPath}).`);
  console.error("시험이 사라졌거나, 글롭이 파일을 못 집고 있거나, 돌던 시험이 skip으로 바뀌었다.");
  console.error("정당하게 줄인 것이면 하한 파일을 같이 고치고 PR 본문에 사유를 적는다.");
  process.exit(1);
}
console.log(`래칫 통과: tests ${actual.tests}개 >= ${floors.tests} · pass ${actual.pass}개 >= ${floors.pass} (${floorPath}).`);
