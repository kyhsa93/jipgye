import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * CI의 "워크플로 YAML 실파싱" 스텝(scripts/check-workflow-yaml.rb)이 일부러 깨뜨린
 * 사본에서 실패하고 정상 사본에서 통과하는지 본다(#121). test/workflow-yaml.test.mjs는
 * 따옴표 없는 스칼라 속 ": "만 잡으므로 이 시험은 그 밖의 모양을 맡는다.
 * ruby가 없는 로컬에서는 건너뛴다(ubuntu-latest CI에는 기본으로 있다).
 */
const script = path.resolve(import.meta.dirname, "..", "scripts", "check-workflow-yaml.rb");
const hasRuby = spawnSync("ruby", ["-v"]).status === 0;

const GOOD = 'name: X\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';
const BROKEN = {
  "들여쓰기 오류": 'name: X\njobs:\n  a:\n    runs-on: u\n   steps:\n    - run: echo\n',
  "닫히지 않은 따옴표": 'name: "X\non: push\n',
  "탭 문자": "name: X\njobs:\n\ta: 1\n",
  '따옴표 없는 ": " 스칼라': 'jobs:\n  a:\n    steps:\n      - run: ./p.sh "chore: x"\n',
  "중복 키": "name: X\nname: Y\non: push\n",
  "중복 키(중첩)": "jobs:\n  a:\n    runs-on: u\n    runs-on: v\n",
};

function check(content) {
  const dir = mkdtempSync(path.join(tmpdir(), "wfyaml-"));
  try {
    writeFileSync(path.join(dir, "w.yml"), content);
    return spawnSync("ruby", [script, dir], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("정상 워크플로는 통과한다", { skip: !hasRuby }, () => {
  const r = check(GOOD);
  assert.equal(r.status, 0, r.stderr);
});

for (const [name, content] of Object.entries(BROKEN)) {
  test(`깨진 워크플로(${name})는 실패한다`, { skip: !hasRuby }, () => {
    const r = check(content);
    assert.notEqual(r.status, 0, `${name}가 통과했다`);
  });
}
