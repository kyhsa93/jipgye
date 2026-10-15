// 「브라우저를 못 찾으면 **skip이 아니라 실패**」를 시험으로 못박는다(#274 체인 공통 규칙 1번, #325 장치 4).
//
// 왜 이것이 따로 필요한가: 건너뛴 시험은 `ℹ tests`에는 들어가고 `ℹ pass`에는 **0을 보탠다**.
// 그래서 변이 시험에 `GOLDEN_LIVE` 같은 env 게이트를 달면 "Chrome이 없어서 안 돌았다"가 초록으로 끝난다.
// `launchChrome`이 이미 그 자리에서 던지므로 — **그 성질을 고정한다.**
import test from "node:test";
import assert from "node:assert/strict";
import { findChrome, launchChrome } from "../lib/chrome.mjs";

test("Chrome 경로가 없으면 launchChrome이 그 자리에서 던진다 (건너뛰지 않는다)", async () => {
  await assert.rejects(() => launchChrome({ chromePath: null }), /Chrome을 찾지 못했습니다/);
});

test("findChrome은 CHROME_PATH를 먼저 본다", () => {
  const saved = process.env.CHROME_PATH;
  try {
    process.env.CHROME_PATH = "/이_실행파일은_없다";
    // 없는 경로는 후보에서 빠진다 — 이 기기의 Chrome으로 되돌아가되, 던지지는 않는다.
    assert.notEqual(findChrome(), "/이_실행파일은_없다");
  } finally {
    if (saved === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = saved;
  }
});

test("이 시험 파일에는 env 게이트가 없다", async () => {
  // 스스로를 읽어 확인한다. 나중에 누가 `if (!process.env.X) return;`을 넣으면 여기서 걸린다.
  const src = await (await import("node:fs/promises")).readFile(new URL("./mutation.test.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\{\s*skip:/, "변이 시험에 skip 옵션이 들어왔다");
  assert.doesNotMatch(src, /test\.skip\(/, "변이 시험에 test.skip이 들어왔다");
  assert.doesNotMatch(src, /process\.env\.\w+\s*(\?|&&|\|\||===|!==)/, "변이 시험이 환경변수로 갈린다 — Chrome 없음이 초록으로 끝나는 길이다");
});
