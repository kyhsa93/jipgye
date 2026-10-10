import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

// research/repeat-sales-2026-10/count_repeat.py의 합성 입력 시험(#70)을 npm test에 묶는다.
// 파이썬 시험은 임시 디렉터리에 합성 JSON만 쓰고, 저장소 raw/는 열지 않는다. python3는 ubuntu-latest에 있다.
// -I: 시험 파일 옆의 모듈이 import되지 않게 격리한다(시험은 경로로 직접 불러온다). -B: __pycache__를 만들지 않는다.
const execFileAsync = promisify(execFile);
const pyTest = path.resolve(import.meta.dirname, "../research/repeat-sales-2026-10/test_count_repeat.py");

test("count_repeat.py 합성 입력 시험", async () => {
  try {
    const r = await execFileAsync("python3", ["-B", "-I", pyTest], { timeout: 120000 });
    assert.match(r.stderr, /\nOK\n?$/);
  } catch (e) {
    assert.fail(`python 시험 실패 (code ${e.code})\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});
