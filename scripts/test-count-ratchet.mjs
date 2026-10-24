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
//   하한파일(`test/COUNT`)은 주석(`#`)·빈 줄을 버리고 남는 줄이 **정확히 둘**이고 둘 다 숫자다 — 1행 `tests` 하한,
//   2행 `pass` 하한. 셋 이상은 낡은 쌍이 숨은 것이고(#417이 둘째 쌍을 덧붙여 래칫이 첫 쌍 1775만 읽었다) 한 줄뿐인 것도 실패다.
//   **주석이나 워크플로 인라인 숫자로 두지 않는다** — 파일이어야 올릴 때 diff에
//   잡혀 리뷰에 걸린다(#315 범위 3). 하한을 **낮추는** 변경은 PR 본문에 사유를 적는다(#315 범위 4).
//   **올리는 것은 PR 이 아니라 병합 담당이다(#548)** — 하루 끝에 `npm run count:bump`(scripts/count-bump.mjs)가 한 번 올린다. PR 은 COUNT 를 건드리지 않고, 내릴 때만 예외다.
//
// **`npm test`가 이 파일의 함수를 직접 부른다(#319).** scripts/run-tests.mjs가 러너를 띄워 같은 자리에서 래칫을 돌리므로,
// 하한 파일을 읽는 함수와 합계 줄을 읽는 함수는 여기 한 벌뿐이다(복제 금지 — 출처 하나). 실패 메시지의 `[...]`는
// 어느 가드가 물었는지 로그에서 갈리게 하려는 것이다(하한 파일 · 형식 · 개수).

import { readFileSync } from "node:fs";
import path from "node:path";

// 하한 파일: `#` 주석과 빈 줄을 버리고 남는 줄이 정확히 둘이고 둘 다 숫자다. 아니면 던진다.
export function readFloors(floorPath) {
  let text;
  try {
    text = readFileSync(floorPath, "utf8");
  } catch (e) {
    throw new Error(`래칫 실패[하한 파일]: ${floorPath}를 읽지 못했다(${e.code ?? e.message}).`);
  }
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  if (lines.length !== 2 || !lines.every((l) => /^\d+$/.test(l))) {
    throw new Error(
      `래칫 실패[하한 파일]: ${floorPath}는 주석·빈 줄을 뺀 줄이 숫자 둘(1행 tests 하한, 2행 pass 하한)이어야 한다 — 읽은 줄 ${lines.length}개: ${JSON.stringify(lines.slice(0, 6))}. ` +
        "쌍을 덧붙이지 말고 첫 두 줄을 제자리에서 고친다.",
    );
  }
  return { tests: Number(lines[0]), pass: Number(lines[1]) };
}

// 러너 출력의 합계 줄. 기본(spec) 리포터는 `ℹ tests N`·`ℹ pass N`, tap 리포터는 `# tests N`·`# pass N`이다.
// 파이프·리다이렉트로 비TTY가 되어도 기본 리포터는 `ℹ` 그대로다(pm 확인 2026-10-14). 색이 켜진 출력은 이스케이프를 벗기고 읽는다.
// 합계 줄을 읽는 곳은 이 함수 하나다 — 래칫(checkRatchet)과 하한 갱신(scripts/count-bump.mjs, #548)이 같이 쓴다(복제 금지).
// 반환: { tests, pass, skipped, fail, cancelled } — 각 값은 그 줄의 **마지막** 숫자이고, 줄이 없으면 null.
export function parseTotals(logText) {
  const log = logText.replace(/\x1b\[[0-9;]*m/g, "");
  const totals = {};
  for (const key of ["tests", "pass", "skipped", "fail", "cancelled"]) {
    const hits = [...log.matchAll(new RegExp(String.raw`^[ℹ#] ${key} (\d+)$`, "gm"))].map((m) => Number(m[1]));
    totals[key] = hits.length === 0 ? null : hits[hits.length - 1];
  }
  return totals;
}

// 러너 출력의 합계 줄을 하한과 대조한다.
// **못 찾으면 통과시키지 않는다** — 출력 형식이 바뀌어 래칫이 조용히 장식이 되는 것이 이 이슈가 막는 것이다.
// 반환: { ok, lines } — lines는 찍을 문장들(실패면 stderr, 통과면 stdout 한 줄).
export function checkRatchet(floors, logText, { floorPath, logLabel }) {
  const actual = parseTotals(logText);
  for (const key of ["tests", "pass"]) {
    if (actual[key] === null) {
      return { ok: false, lines: [`래칫 실패[형식]: ${logLabel}에서 "ℹ ${key} N" 합계 줄을 찾지 못했다. 러너 출력 형식이 바뀌었는지 본다.`] };
    }
  }

  const short = ["tests", "pass"].filter((key) => actual[key] < floors[key]);
  if (short.length > 0) {
    return {
      ok: false,
      lines: [
        ...short.map((key) => `래칫 실패[개수]: ${key} ${actual[key]}개 < 하한 ${floors[key]}개 (${floorPath}).`),
        "시험이 사라졌거나, 글롭이 파일을 못 집고 있거나, 돌던 시험이 skip으로 바뀌었다.",
        "정당하게 줄인 것이면 하한 파일을 같이 고치고 PR 본문에 사유를 적는다.",
      ],
    };
  }
  return { ok: true, lines: [`래칫 통과: tests ${actual.tests}개 >= ${floors.tests} · pass ${actual.pass}개 >= ${floors.pass} (${floorPath}).`] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const [floorPath, logPath] = process.argv.slice(2);
  if (!floorPath || !logPath) {
    console.error("사용법: node scripts/test-count-ratchet.mjs <하한파일> <npm test 로그파일>");
    process.exit(2);
  }
  try {
    const floors = readFloors(floorPath);
    const r = checkRatchet(floors, readFileSync(logPath, "utf8"), { floorPath, logLabel: logPath });
    for (const l of r.lines) (r.ok ? console.log : console.error)(l);
    process.exitCode = r.ok ? 0 : 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
