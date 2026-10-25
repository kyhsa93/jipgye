import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

// research/repeat-sales-2026-10/repeat_bands_n6.py의 합성 입력 시험(#170 N6)을 npm test에 묶는다.
// 파이썬 시험은 임시 디렉터리에 합성 JSON만 쓰고 저장소 raw/는 열지 않는다. -I 격리, -B __pycache__ 없음.
const execFileAsync = promisify(execFile);
const pyTest = path.resolve(import.meta.dirname, "../research/repeat-sales-2026-10/test_repeat_bands_n6.py");

test("repeat_bands_n6.py 합성 입력 시험", async () => {
  try {
    const r = await execFileAsync("python3", ["-B", "-I", pyTest], { timeout: 120000 });
    assert.match(r.stderr, /\nOK\n?$/);
  } catch (e) {
    assert.fail(`python 시험 실패 (code ${e.code})\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});
