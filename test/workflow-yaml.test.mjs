import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", ".github", "workflows");

/**
 * 따옴표 없는 한 줄 스칼라 안의 ": "는 YAML 문법 오류다. official-price.yml 92행의
 * `run: ./scripts/push-docs.sh "chore: ..."`가 그랬고(#118), 문법 오류인 워크플로는
 * on: 조건과 상관없이 push마다 0초짜리 실패 run을 만든다.
 * 저장소에는 YAML 파서가 없고 devDependency를 늘리지 않으므로, 이 오류만 잡는
 * 최소 검사를 둔다: `key: 값` / `- 값` 줄에서 값이 따옴표·블록(|, >)·흐름([, {])·
 * 앵커·태그로 시작하지 않는데 값 안에 ": "가 있으면 위반. 블록 스칼라 본문은 건너뛴다.
 */
export function findPlainColonScalars(text) {
  const bad = [];
  const lines = text.split("\n");
  let blockIndent = -1; // >= 0이면 그 들여쓰기보다 깊은 줄은 블록 스칼라 본문
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    const indent = line.length - line.trimStart().length;
    if (blockIndent >= 0) {
      if (indent > blockIndent) return;
      blockIndent = -1;
    }
    const body = line.trimStart();
    if (body.startsWith("#")) return;
    const m = body.match(/^(?:-\s+)?(?:[^\s:#'"][^:#]*|"[^"]*"|'[^']*'):\s+(.*)$/) ?? body.match(/^-\s+(.*)$/);
    if (!m) return;
    const value = m[1].replace(/\s+#.*$/, "");
    if (/^[|>]/.test(value)) {
      blockIndent = indent;
      return;
    }
    if (value === "" || /^["'\[{&*!]/.test(value)) return;
    if (/:\s/.test(value) || /:$/.test(value)) bad.push(`${i + 1}행: ${body}`);
  });
  return bad;
}

test("검사기가 official-price.yml 92행 모양을 잡는다", () => {
  const broken = '    steps:\n      - run: ./push.sh "chore: 접기" raw/x\n';
  assert.equal(findPlainColonScalars(broken).length, 1);
  const fixed = '      - run: |\n          ./push.sh "chore: 접기" raw/x\n';
  assert.deepEqual(findPlainColonScalars(fixed), []);
  const quoted = '      description: "https://a.b (x: y)"\n';
  assert.deepEqual(findPlainColonScalars(quoted), []);
});

test("모든 워크플로에 따옴표 없는 스칼라 속 ': '가 없다", async () => {
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 6, `워크플로를 ${files.length}개밖에 못 찾았다`);
  for (const f of files) {
    const bad = findPlainColonScalars(await readFile(path.join(dir, f), "utf8"));
    assert.deepEqual(bad, [], `${f}: YAML 문법 오류(따옴표 없는 스칼라 속 ": ") - run은 'run: |' 블록으로 쓴다`);
  }
});
