import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("direct-deals standalone exits promptly with actionable error", () => {
  const result = spawnSync(process.execPath, ["scripts/build-direct-deals.ts"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, DIRECT_DEALS_FILE: path.join(root, "test", "__should-not-write-direct-deals.json") },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /단독 실행을 지원하지 않습니다/);
  assert.match(result.stderr, /build-cancellation\.ts/);
});
