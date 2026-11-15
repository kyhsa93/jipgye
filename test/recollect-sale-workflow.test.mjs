import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// recollect-sale.yml 배선 (#861, cto PR #890 판정 「워크플로는 별도 PR」·머지 승인의 추가 지시). housing-permits-workflow 시험 틀에
// 규칙 표를 더했다: 규칙마다 실제 파일에서 위반 0 을 보고, 맨 아래 대조군이 규칙마다 일부러 어긴 사본을 잡는지 본다.
const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const text = await read(".github/workflows/recollect-sale.yml");
const daily = await read(".github/workflows/daily-update.yml");
const correction = await read(".github/workflows/correction-release.yml");
const testYml = await read(".github/workflows/test.yml");

const CALL = 'node scripts/recollect-sale.ts --run --approved-calls "$APPROVED_CALLS" --owner-notice "$OWNER_NOTICE"';
// 시험이 시각·쉬는 시간을 고정하는 자리일 뿐인 인자·환경변수(collection-now·fetch-realestate·recollect-sale). 주석에도 두지 않는다.
const FORBIDDEN = ["--now", "REALESTATE_NOW", "MOLIT_DELAY_MS", "MOLIT_RETRY_MS", "MOLIT_SWEEP_DELAY_MS"];

/** 주석 줄을 뺀 본문. */
const code = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const indent = (l) => l.length - l.trimStart().length;

/** 들여쓰기 블록: key 줄(예 `run:`·`env:`) 뒤로 그보다 깊이 들여쓴 줄들. 한 줄 값이면 그 값. */
function block(lines, at) {
  const head = lines[at];
  const inline = head.slice(head.indexOf(":") + 1).trim();
  const body = [];
  for (let i = at + 1; i < lines.length && (lines[i].trim() === "" || indent(lines[i]) > indent(head)); i++) body.push(lines[i]);
  return inline && inline !== "|" ? [inline, ...body].join("\n") : body.join("\n");
}

/** job 의 스텝들: { text, run, env, envKeys }. */
function steps(t) {
  const c = code(t);
  const start = c.indexOf("\n    steps:\n");
  if (start < 0) return [];
  return c
    .slice(start + "\n    steps:\n".length)
    .split(/\n(?= {6}- )/)
    .map((s) => {
      const lines = s.split("\n");
      const runAt = lines.findIndex((l) => /^ {8}run:/.test(l) || /^ {6}- run:/.test(l));
      const envAt = lines.findIndex((l) => /^ {8}env:\s*$/.test(l));
      const env = envAt < 0 ? "" : block(lines, envAt);
      return {
        text: s,
        run: runAt < 0 ? null : block(lines, runAt),
        env,
        envKeys: [...env.matchAll(/^ {10}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]),
      };
    });
}

const jobEnv = (t) => {
  const c = code(t);
  const a = c.indexOf("\n    env:\n");
  const b = c.indexOf("\n    steps:\n");
  return a < 0 || b < a ? "" : c.slice(a, b);
};
const callIndex = (list) => list.findIndex((s) => s.run?.includes("scripts/recollect-sale.ts"));

/** 규칙 표: 이름 → 위반 문구 목록(빈 배열이면 통과). */
const RULES = [
  ["dispatch 전용(cron·push·pull_request 없음), 입력 approved_calls·owner_notice 는 string·required", (t) => {
    const c = code(t);
    const v = [];
    if (!/^on:\n {2}workflow_dispatch:\n/m.test(c)) v.push("on: 이 workflow_dispatch 로 시작하지 않는다");
    if (/schedule:|cron:|pull_request|^ {2}push:|workflow_run|repository_dispatch/m.test(c)) v.push("dispatch 밖 트리거가 있다");
    for (const name of ["approved_calls", "owner_notice"]) {
      const m = c.match(new RegExp(`^ {6}${name}:\\n((?: {8}.*\\n)+)`, "m"));
      if (!m) v.push(`입력 ${name} 이 없다`);
      else if (!/type: string\n/.test(m[1]) || !/required: true\n/.test(m[1])) v.push(`입력 ${name} 이 string·required 가 아니다`);
    }
    return v;
  }],
  ["입력은 job env 로만 받고 run 에는 `${{` 가 없다", (t) => {
    const v = [];
    const env = jobEnv(t);
    if (!/^ {6}APPROVED_CALLS: \$\{\{ inputs\.approved_calls \}\}$/m.test(env)) v.push("job env 에 APPROVED_CALLS 가 없다");
    if (!/^ {6}OWNER_NOTICE: \$\{\{ inputs\.owner_notice \}\}$/m.test(env)) v.push("job env 에 OWNER_NOTICE 가 없다");
    const outside = code(t).replace(env, "");
    if (/\binputs\./.test(outside)) v.push("job env 밖에서 inputs 를 읽는다");
    const list = steps(t);
    if (list.filter((s) => s.run !== null).length < 4) v.push("run 스텝을 다 읽지 못했다");
    for (const s of list) if (s.run?.includes("${{")) v.push(`run 에 \${{ 가 있다: ${s.run.split("\n")[0]}`);
    return v;
  }],
  ["permissions 는 contents: write·actions: read 두 줄뿐이다", (t) => {
    const c = code(t);
    const v = [];
    if (!/\npermissions:\n {2}contents: write\n {2}actions: read\n\n/.test(c)) v.push("워크플로 permissions 가 정확히 두 줄이 아니다");
    if ((c.match(/permissions:/g) ?? []).length !== 1) v.push("permissions 가 둘 이상(job 수준 포함)이다");
    return v;
  }],
  ["concurrency 는 digest-pipeline·cancel-in-progress false 이고 대기 취소 주석이 있다", (t) => {
    const v = [];
    if (!/\nconcurrency:\n {2}group: digest-pipeline\n {2}cancel-in-progress: false\n/.test(code(t))) v.push("concurrency 가 digest-pipeline·false 가 아니다");
    if (!/대기 중 run 은 그룹당 하나/.test(t) || !/진행·대기 중인 run 이 없을 때만 dispatch/.test(t)) v.push("대기 취소·dispatch 조건 주석이 없다");
    return v;
  }],
  ["액션은 모두 40자 SHA 이고 저장소 다른 워크플로(test.yml)와 같은 SHA 다. checkout depth 1·node 24", (t) => {
    const v = [];
    const known = new Set([...testYml.matchAll(/uses: (\S+)/g)].map((m) => m[1]));
    const uses = [...code(t).matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    if (uses.length !== 2) v.push(`uses 가 ${uses.length}개다(checkout·setup-node 둘)`);
    for (const u of uses) {
      if (!/@[0-9a-f]{40}$/.test(u)) v.push(`SHA 고정이 아니다: ${u}`);
      else if (!known.has(u)) v.push(`test.yml 과 다른 SHA: ${u}`);
    }
    if (!/actions\/checkout@[0-9a-f]{40}[^\n]*\n {8}with:\n {10}fetch-depth: 1\n/.test(code(t))) v.push("checkout 이 depth 1 이 아니다");
    if (!/node-version: "24"/.test(t)) v.push("node 24 가 아니다");
    return v;
  }],
  ["시크릿은 정확히 MOLIT_API_KEY·MOLIT_API_ENDPOINT 이고 호출 스텝 env 에만 있다(그 env 는 둘 + GH_TOKEN 뿐)", (t) => {
    const v = [];
    const names = [...new Set([...code(t).matchAll(/secrets\.([A-Za-z_]+)/g)].map((m) => m[1]))].sort();
    if (JSON.stringify(names) !== JSON.stringify(["MOLIT_API_ENDPOINT", "MOLIT_API_KEY"])) v.push(`시크릿 집합이 다르다: ${names.join(",")}`);
    const list = steps(t);
    const at = callIndex(list);
    if (at < 0) return [...v, "호출 스텝이 없다"];
    const call = list[at];
    if (JSON.stringify([...call.envKeys].sort()) !== JSON.stringify(["GH_TOKEN", "MOLIT_API_ENDPOINT", "MOLIT_API_KEY"])) v.push(`호출 스텝 env 가 다르다: ${call.envKeys.join(",")}`);
    if (!/^ {10}MOLIT_API_KEY: \$\{\{ secrets\.MOLIT_API_KEY \}\}$/m.test(call.env)) v.push("MOLIT_API_KEY 가 호출 스텝 env 에 없다");
    if (!/^ {10}MOLIT_API_ENDPOINT: \$\{\{ secrets\.MOLIT_API_ENDPOINT \}\}$/m.test(call.env)) v.push("MOLIT_API_ENDPOINT 가 호출 스텝 env 에 없다");
    if (!/^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m.test(call.env)) v.push("GH_TOKEN 이 github.token 이 아니다");
    if (/secrets\./.test(jobEnv(t))) v.push("job env 에 시크릿이 있다");
    list.forEach((s, i) => { if (i !== at && /secrets\.|GH_TOKEN|github\.token/.test(s.text)) v.push(`호출 스텝 밖에 시크릿·토큰이 있다: ${s.text.split("\n")[0]}`); });
    if (/set -x|echo[^\n]*MOLIT_API/.test(code(t))) v.push("시크릿을 찍을 수 있는 줄이 있다");
    return v;
  }],
  ["main·run_attempt=1 가드가 호출 스텝보다 앞에 있다", (t) => {
    const list = steps(t);
    const at = callIndex(list);
    const guard = (re) => list.findIndex((s) => s.run !== null && re.test(s.run));
    const v = [];
    const ref = guard(/^\s*test "\$GITHUB_REF" = refs\/heads\/main\b/m);
    const attempt = guard(/^\s*test "\$GITHUB_RUN_ATTEMPT" = 1\b/m);
    if (ref < 0 || !(ref < at)) v.push("main 가드가 호출 스텝보다 앞에 없다");
    if (attempt < 0 || !(attempt < at)) v.push("run_attempt 가드가 호출 스텝보다 앞에 없다");
    return v;
  }],
  ["시각·쉬는 시간을 고정하는 인자·환경변수가 없다(주석 포함)", (t) => FORBIDDEN.filter((w) => t.includes(w)).map((w) => `${w} 가 있다`)],
  ["의존성은 npm ci --ignore-scripts, npm test 는 돌리지 않는다, timeout 20분", (t) => {
    const runs = steps(t).map((s) => s.run ?? "").join("\n");
    const v = [];
    if (!/^\s*npm ci --ignore-scripts$/m.test(runs)) v.push("npm ci --ignore-scripts 가 없다");
    if (/npm (run )?test|npm ci$|npm install/m.test(runs)) v.push("npm test·스크립트 있는 설치가 있다");
    if (!/^ {4}timeout-minutes: 20$/m.test(code(t))) v.push("timeout-minutes 20 이 아니다");
    return v;
  }],
  ["호출 명령이 정해진 그대로이고 종료 코드를 출력으로 남긴다", (t) => {
    const list = steps(t);
    const at = callIndex(list);
    if (at < 0) return ["호출 스텝이 없다"];
    const s = list[at];
    const v = [];
    if (!/^ {8}id: recollect$/m.test(s.text)) v.push("호출 스텝 id 가 recollect 가 아니다");
    if (!s.run.split("\n").some((l) => l.trim() === CALL)) v.push("호출 명령이 다르다");
    if ((code(t).match(/scripts\/recollect-sale\.ts/g) ?? []).length !== 1) v.push("recollect-sale.ts 를 두 번 이상 부른다");
    if (!/^\s*set \+e$/m.test(s.run) || !/^\s*code=\$\?$/m.test(s.run) || !/echo "code=\$code" >> "\$GITHUB_OUTPUT"/.test(s.run)) v.push("종료 코드를 출력으로 남기지 않는다");
    return v;
  }],
  ["git status 가 raw/recollect/ 밖을 가리키면 커밋 전에 실패한다", (t) => {
    const list = steps(t);
    const check = list.findIndex((s) => s.run?.includes("git status --porcelain"));
    const commit = list.findIndex((s) => s.run?.includes("push-docs.sh"));
    const v = [];
    if (check < 0) return ["경로 확인 스텝이 없다"];
    const s = list[check];
    if (!/grep -v -E '\^\.\. raw\/recollect\/'/.test(s.run) || !/exit 1/.test(s.run)) v.push("raw/recollect/ 밖이면 실패하지 않는다");
    if (/^ {8}if:/m.test(s.text)) v.push("경로 확인이 조건부다");
    if (!(check > callIndex(list) && check < commit)) v.push("경로 확인이 호출과 커밋 사이에 없다");
    return v;
  }],
  ["커밋은 종료 0·4 일 때만 push-docs.sh … raw/recollect 이고, 0 이 아니면 커밋 뒤 job 이 실패한다", (t) => {
    const list = steps(t);
    const commits = list.filter((s) => s.run?.includes("push-docs.sh"));
    const v = [];
    if (commits.length !== 1) return [`push-docs 스텝이 ${commits.length}개다`];
    const c = commits[0];
    if (!/^ {8}if: \$\{\{ steps\.recollect\.outputs\.code == '0' \|\| steps\.recollect\.outputs\.code == '4' \}\}$/m.test(c.text)) v.push("커밋 조건이 종료 0·4 가 아니다");
    if (!/^\s*\.\/scripts\/push-docs\.sh "chore: 매매 재수집 \$\{ROUND\}" raw\/recollect$/m.test(c.run)) v.push("push-docs 인자가 raw/recollect 하나가 아니다");
    const verdict = list.findIndex((s) => s.run !== null && /test "\$CODE" = 0/.test(s.run));
    if (verdict < 0 || verdict < list.indexOf(c)) v.push("종료 코드 판정 스텝이 커밋 뒤에 없다");
    else {
      if (/^ {8}if:/m.test(list[verdict].text)) v.push("판정 스텝이 조건부다");
      if (!/^ {10}CODE: \$\{\{ steps\.recollect\.outputs\.code \}\}$/m.test(list[verdict].env)) v.push("판정이 호출 스텝 종료 코드를 읽지 않는다");
    }
    return v;
  }],
];

for (const [name, check] of RULES) {
  test(`워크플로: ${name}`, () => assert.deepEqual(check(text), []));
}

test("push-docs.sh 는 메시지 뒤 경로 인자를 받으면 그 경로만 커밋한다(raw/recollect 를 그렇게 넘긴다)", async () => {
  const sh = await read("scripts/push-docs.sh");
  assert.match(sh, /message="\$\{1:\?[^"]*\}"\nshift\n/);
  assert.match(sh, /if \[ \$# -gt 0 \]; then\n\s+if \[ -z "\$\(git status --porcelain -- "\$@"\)" \]; then/);
});

test("머리 주석: 호출 뒤 기록 없이 끝난 run 절차가 스크립트 시작 줄 글자로 적혀 있고, 종료 4 이어 받기와 구분된다 (cpo 보완)", async () => {
  const script = await read("scripts/recollect-sale.ts");
  // 주석이 가리키는 시작 줄이 스크립트에 실제로 있는지(글자가 어긋나면 로그에서 못 찾는다).
  assert.match(script, /`\[recollect\] \$\{plan\.round\} 회차\$\{[^\n]*\n\s+`\$\{plan\.months\.join\("·"\)\} · 계획 \$\{plan\.planned\}회 · 상한 \$\{plan\.cap\}회`/);
  assert.match(text, /^# 호출 뒤 기록 없이 끝난 run[^\n]*종료 4 의 이어 받기와 다르다/m);
  assert.match(text, /^# {3}\[recollect\] <달> 회차: <달들> · 계획 N회 · 상한 M회/m);
  assert.match(text, /있으면: 새 dispatch 를 하지 않는다\. #861 에 run ID[\s\S]*cto 판정[\s\S]*남은 승인\(승인 − 이미 쓴 호출\)[\s\S]*소유자 답 전에는 호출 0/);
  assert.match(text, /없으면: 호출 전에 끝났으므로\(호출 0\) 같은 입력으로 다시 dispatch 해도 된다/);
});

test("daily-update.yml 에는 재수집이 섞이지 않는다", () => {
  assert.doesNotMatch(daily, /recollect/i);
});

test("correction-release.yml 은 sparse-checkout 으로 raw/recollect 를 받는다", () => {
  const m = correction.match(/sparse-checkout: \|\n((?: {12}\S.*\n)+)/);
  assert.ok(m, "sparse-checkout 목록을 못 읽었다");
  assert.ok(m[1].split("\n").map((l) => l.trim()).includes("raw/recollect"), m[1]);
});

// 대조군: 규칙마다 일부러 어긴 사본을 만들어 그 규칙이 잡는지 본다(규칙이 아무것도 안 읽고 통과하는 길을 막는다).
test("대조군: 규칙마다 어긴 사본을 잡는다", () => {
  const mutants = [
    ["dispatch 전용", "  workflow_dispatch:\n", "  schedule:\n    - cron: \"0 6 * * *\"\n  workflow_dispatch:\n"],
    ["dispatch 전용", "        type: string\n        required: true\n      owner_notice:", "        type: string\n        required: false\n      owner_notice:"],
    ["job env 로만", CALL, CALL.replace('"$APPROVED_CALLS"', '"${{ inputs.approved_calls }}"')],
    ["permissions", "  actions: read\n", "  actions: read\n  issues: write\n"],
    ["concurrency", "  cancel-in-progress: false\n", "  cancel-in-progress: true\n"],
    ["40자 SHA", "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "actions/setup-node@v7"],
    ["40자 SHA", "fetch-depth: 1", "fetch-depth: 0"],
    ["시크릿은 정확히", "          GH_TOKEN: ${{ github.token }}\n", "          GH_TOKEN: ${{ github.token }}\n          ECOS_API_KEY: ${{ secrets.ECOS_API_KEY }}\n"],
    ["시크릿은 정확히", "      OWNER_NOTICE: ${{ inputs.owner_notice }}\n", "      OWNER_NOTICE: ${{ inputs.owner_notice }}\n      MOLIT_API_KEY: ${{ secrets.MOLIT_API_KEY }}\n"],
    ["main·run_attempt", '          test "$GITHUB_RUN_ATTEMPT" = 1', '          echo "$GITHUB_RUN_ATTEMPT"'],
    ["고정하는 인자", CALL, `${CALL} --now 2026-11-26T06:00:00Z`],
    ["고정하는 인자", "          GH_TOKEN: ${{ github.token }}\n", "          GH_TOKEN: ${{ github.token }}\n          MOLIT_SWEEP_DELAY_MS: \"0\"\n"],
    ["npm ci --ignore-scripts", "npm ci --ignore-scripts", "npm ci"],
    ["npm ci --ignore-scripts", "    timeout-minutes: 20\n", "    timeout-minutes: 60\n"],
    ["호출 명령", CALL, CALL.replace("--run ", "--run --dry-run ")],
    ["호출 명령", 'echo "code=$code" >> "$GITHUB_OUTPUT"', 'echo "code=0" >> "$GITHUB_OUTPUT"'],
    ["git status", "grep -v -E '^.. raw/recollect/'", "grep -v -E '^.. raw/'"],
    ["커밋은 종료 0·4", " || steps.recollect.outputs.code == '4' }}", " || steps.recollect.outputs.code == '3' }}"],
    ["커밋은 종료 0·4", '"chore: 매매 재수집 ${ROUND}" raw/recollect', '"chore: 매매 재수집 ${ROUND}" raw'],
    ["커밋은 종료 0·4", '          test "$CODE" = 0 ||', "          true ||"],
    ["커밋은 종료 0·4", "      - name: 판정 (종료 0 이 아니면 실패)\n", "      - name: 판정 (종료 0 이 아니면 실패)\n        if: ${{ steps.recollect.outputs.code != '4' }}\n"],
  ];
  for (const [rule, from, to] of mutants) {
    assert.ok(text.includes(from), `대조군 원문이 워크플로에 없다: ${from}`);
    const mutated = text.replace(from, to);
    assert.notEqual(mutated, text);
    const [name, check] = RULES.find(([n]) => n.includes(rule)) ?? [];
    assert.ok(check, `규칙을 못 찾았다: ${rule}`);
    assert.notDeepEqual(check(mutated), [], `「${name}」이 변이를 못 잡았다: ${from} → ${to}`);
  }
});
