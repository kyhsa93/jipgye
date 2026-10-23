import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * deploy.yml 은 병행 가동이다 - 사이트를 build/site 로 만들어 커밋된 docs/ 와 해시만 맞대고, 배포하지 않는다 (#509, 구조 B-3).
 *
 * 이 워크플로가 배포 권한·환경·시크릿을 갖거나 수집 쪽 동시성 그룹을 쓰면 두 번째 배포 경로가 켜지는 것이고, 그것은 컷오버(B4)다 -
 * 되돌리기 어려운 단계를 병행 가동 PR 에서 조용히 밟지 않게 막는다. 또 daily-update·summarize 의 반영 단계는 `!cancelled() &&` 로 시작해야
 * 앞 반영 단계의 실패가 뒤 반영을 가리지 않는다(#507 cto·cpo 조건). 워크플로 YAML 의 글자만 읽는다 - 고정 입력이고, 네트워크·날짜·데이터를 보지 않는다(#8).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const DEPLOY = ".github/workflows/deploy.yml";

/** 주석을 걷어 낸다(전체 줄 주석과 `uses: … # v7.0.1` 꼬리). 주석에는 일부러 environment·secrets 같은 낱말이 쓰인다. */
const code = (text) => text.replace(/^\s*#.*\n/gm, "").replace(/(\S)[ \t]+#[ \t].*$/gm, "$1");

/** steps: 아래를 스텝 덩어리로 자르고, 머리와 8칸 키(name·id·if·uses·run)를 읽는다. 여러 줄 run 은 들여쓴 줄 전부. */
function steps(text) {
  const parts = code(text).split(/\n {4}steps:\n/);
  assert.ok(parts.length > 1, "steps: 를 못 찾았다");
  const body = parts.at(-1); // summarize.yml 은 job 이 둘(check·summarize)이고 반영 단계는 마지막 job 에 있다
  return body
    .split(/\n(?=      - )/)
    .filter((c) => c.startsWith("      - "))
    .map((chunk) => {
      const key = (k) => chunk.match(new RegExp(`^ {6}(?:- | {2})${k}: (.*)$`, "m"))?.[1] ?? null;
      const run = chunk.match(/^ {8}run: ([^|>\n].*)$/m)?.[1] ?? chunk.split(/^ {8}run: [|>]\n/m)[1] ?? chunk.match(/^ {6}- run: (.*)$/m)?.[1] ?? "";
      return { name: key("name"), id: key("id"), if: key("if"), uses: key("uses"), coe: key("continue-on-error"), run };
    });
}
const bare = (expr) => (expr ?? "").replace(/^\$\{\{\s*|\s*\}\}$/g, "");

/** deploy.yml 이 지킬 것의 위반 목록. 대조군이 같은 함수에 변이 사본을 넣어, 이 검사가 무는지(항상 참이 아닌지) 본다. */
function violations(text) {
  const out = [];
  const c = code(text);
  const on = c.split(/\npermissions:/)[0];
  if (!/^ {2}push:\n {4}branches: \[main\]$/m.test(on)) out.push("push 트리거가 main 한정이 아니다");
  if (/^ {4}paths(-ignore)?:/m.test(on)) out.push("push 에 경로 제한이 있다(경로 제한 없음이 계약이다)");
  if (!/^ {2}workflow_run:\n {4}workflows: \["Daily update", "Summarize"\]\n {4}types: \[completed\]$/m.test(on)) out.push("workflow_run 이 Daily update·Summarize completed 가 아니다");
  if (/^ {2}schedule:/m.test(on)) out.push("자체 크론이 있다");

  if (!/^permissions:\n {2}contents: read\n(?! {2}\w)/m.test(c)) out.push("permissions 가 contents: read 하나가 아니다");
  if (/secrets\./.test(c)) out.push("시크릿을 쓴다");
  if (/^\s*environment:/m.test(c)) out.push("배포 환경(environment)을 쓴다");
  if (/configure-pages|upload-pages-artifact|deploy-pages|id-token|pages: write/.test(c)) out.push("Pages 배포 요소가 있다");
  if (/push-docs|git push|git commit/.test(c)) out.push("커밋·푸시를 한다");
  const group = c.match(/^concurrency:\n {2}group: (.+)$/m)?.[1];
  if (!group) out.push("concurrency 그룹이 없다");
  else if (/^(digest-pipeline|pages)$/.test(group.replace(/["']/g, ""))) out.push(`동시성 그룹 ${group} 은 수집·배포와 겹친다`);

  const list = steps(text);
  for (const s of list) if (s.uses && !/@[0-9a-f]{40}$/.test(s.uses)) out.push(`SHA 로 고정되지 않은 액션: ${s.uses}`);

  const at = (pred) => list.findIndex(pred);
  const render = at((s) => s.id === "render");
  const hashes = at((s) => s.id === "hashes");
  const tests = at((s) => s.run.trim() === "npm test");
  const upload = at((s) => s.uses?.startsWith("actions/upload-artifact@"));
  const install = at((s) => s.run.trim() === "npm ci");
  const pin = at((s) => /BUILD_NOW=/.test(s.run));
  if (list[render]?.run.trim() !== "node scripts/render-pipeline.ts --out=build/site") out.push("렌더가 render-pipeline --out=build/site 한 줄이 아니다");
  if (!(install >= 0 && install < pin && pin < render)) out.push("npm ci -> 렌더 시각 고정 -> 렌더 순서가 아니다");
  if (!/\$\(git log -1 --format=%cI HEAD\)/.test(list[pin]?.run ?? "") || !/>> "\$GITHUB_ENV"/.test(list[pin]?.run ?? "")) out.push("BUILD_NOW 를 HEAD 커밋 시각으로 못박지 않는다");
  if (!/node scripts\/site-hashes\.ts compare docs build\/site\b/.test(list[hashes]?.run ?? "")) out.push("해시 대조가 docs 와 build/site 를 맞대지 않는다");
  if (list[hashes]?.coe !== "true") out.push("해시 대조가 continue-on-error 가 아니다(어긋나도 시험·목록 업로드가 돌아야 한다)");
  if (!(render < hashes && hashes < tests && tests < upload)) out.push("렌더 -> 해시 대조 -> 테스트 -> 목록 업로드 순서가 아니다");
  if (!/^\$\{\{ !cancelled\(\) && /.test(list[upload]?.if ?? "")) out.push("목록 업로드가 !cancelled() 로 시작하지 않는다(어긋난 날 목록이 안 남는다)");

  const reflects = list.filter((s) => s.run.includes("exit 1"));
  if (reflects.length !== 2) out.push(`반영 단계가 둘이 아니다(${reflects.length})`);
  for (const s of reflects) if (!/^!cancelled\(\) && steps\./.test(bare(s.if))) out.push(`반영 단계 '${s.name}' 의 if 가 !cancelled() && 로 시작하지 않는다`);
  if (list.at(-1)?.run.includes("exit 1") !== true || list.at(-2)?.run.includes("exit 1") !== true) out.push("반영 단계가 맨 끝 둘이 아니다");
  return out;
}

const deploy = await read(DEPLOY);

test("deploy.yml: 계약 위반이 없다 - main push·workflow_run 만, 읽기 권한, 시크릿·배포 환경·Pages 배포 없음, 수집·배포와 다른 동시성 그룹, SHA 고정", () => {
  assert.deepEqual(violations(deploy), []);
});

test("deploy.yml: 렌더는 build/site 로 한 번에, 해시는 커밋된 docs/ 와 맞댄다 - 스텝 순서와 id", () => {
  const list = steps(deploy);
  const names = list.map((s) => s.name ?? s.uses ?? s.run);
  const idx = (n) => {
    const i = names.findIndex((x) => x.includes(n));
    assert.ok(i >= 0, `스텝 '${n}' 이 없다`);
    return i;
  };
  assert.ok(idx("npm ci") < idx("렌더 시각 고정") && idx("렌더 시각 고정") < idx("사이트 생성") && idx("사이트 생성") < idx("산출 해시 대조"));
  assert.ok(idx("산출 해시 대조") < idx("테스트") && idx("테스트") < idx("산출 해시 목록 업로드") && idx("산출 해시 목록 업로드") < idx("렌더 폴백 반영"));
  assert.equal(list[idx("사이트 생성")].id, "render");
  assert.equal(list[idx("산출 해시 대조")].id, "hashes");
  assert.equal(list[idx("테스트")].run.trim(), "npm test");
  // 체크아웃은 하나다: push 는 그 커밋, workflow_run 은 main. 두 산출물이 같은 체크아웃에서 나온다는 것이 같은 SHA 의 뜻이다.
  assert.equal(list.filter((s) => s.uses?.startsWith("actions/checkout@")).length, 1);
  assert.match(deploy, /ref: \$\{\{ github\.event_name == 'workflow_run' && 'main' \|\| github\.sha \}\}/);
  // 목록은 실행마다 이름이 다르다(재실행도 run_attempt 로 갈린다) - 같은 이름이면 v4 이후 업로드가 실패한다.
  assert.match(deploy, /name: site-hashes-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
});

test("deploy.yml: 반영 단계 둘(렌더 폴백·해시 어긋남)은 맨 끝이고 steps 결과가 맞을 때만 exit 1 로 끝난다", () => {
  const list = steps(deploy);
  const [fallback, mismatch] = list.slice(-2);
  assert.equal(bare(fallback.if), "!cancelled() && steps.render.outputs.fallback == 'true'");
  assert.equal(bare(mismatch.if), "!cancelled() && steps.hashes.outcome == 'failure'");
  for (const s of [fallback, mismatch]) {
    assert.match(s.run, /::error::/);
    assert.match(s.run, /^\s*exit 1$/m);
  }
  // render-pipeline 이 쓰는 출력 이름과 같다(워크플로가 읽는 키가 이름 바꿈으로 조용히 끊기지 않게).
  assert.match(deploy, /steps\.render\.outputs\.fallback/);
});

test("대조군: 계약을 어긴 변이 사본은 위반으로 잡힌다 (검사가 항상 참이 아니다)", () => {
  const mutate = (from, to) => {
    assert.ok(deploy.includes(from), `변이 대상 '${from}' 을 못 찾았다`);
    return deploy.replace(from, to);
  };
  const cases = [
    ["permissions:\n  contents: read\n", "permissions:\n  contents: read\n  pages: write\n  id-token: write\n", /permissions|Pages/],
    ["  group: site-build\n", "  group: digest-pipeline\n", /digest-pipeline/],
    ["  group: site-build\n", "  group: pages\n", /pages/],
    ["    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    environment:\n      name: github-pages\n", /environment/],
    ["      - run: npm ci\n", "      - run: npm ci\n        env:\n          K: ${{ secrets.ECOS_API_KEY }}\n", /시크릿/],
    ["actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "actions/setup-node@v7", /SHA/],
    ["    branches: [main]\n", "    branches: [main]\n    paths: [docs/**]\n", /경로 제한/],
    ["        run: node scripts/render-pipeline.ts --out=build/site\n", "        run: node scripts/render-pipeline.ts\n", /build\/site/],
    ["        id: hashes\n        continue-on-error: true\n", "        id: hashes\n", /continue-on-error/],
    ["if: ${{ !cancelled() && steps.hashes.outcome == 'failure' }}", "if: steps.hashes.outcome == 'failure'", /!cancelled/],
    ["echo \"BUILD_NOW=$(git log -1 --format=%cI HEAD)\"", "echo \"X=1\"", /BUILD_NOW/],
  ];
  for (const [from, to, expect] of cases) {
    const found = violations(mutate(from, to));
    assert.ok(found.some((v) => expect.test(v)), `변이(${from.trim().split("\n")[0]})가 안 잡혔다: ${JSON.stringify(found)}`);
  }
});

test("컷오버가 아니다: 기존 배포 경로(daily-update·summarize·static)와 커밋된 docs/ 는 그대로 남아 있다", async () => {
  for (const f of ["daily-update.yml", "summarize.yml", "static.yml"]) {
    const t = code(await read(`.github/workflows/${f}`));
    assert.match(t, /actions\/deploy-pages@/, `${f} 의 Pages 배포가 없다 - 컷오버는 B4 다`);
    assert.match(t, /path: ["']?\.\/docs["']?/, `${f} 가 docs/ 를 안 올린다`);
  }
  for (const f of ["daily-update.yml", "summarize.yml"]) {
    const t = code(await read(`.github/workflows/${f}`));
    assert.match(t, /^\s+(?:run: )?node scripts\/render-pipeline\.ts/m, `${f} 의 렌더 스텝이 사라졌다`);
    assert.match(t, /^\s+run: npm test$/m, `${f} 의 테스트 스텝이 사라졌다`);
    assert.doesNotMatch(t, /--out=/, `${f} 의 렌더가 출력 디렉터리를 바꿨다 - 배포 산출물이 달라진다`);
  }
  assert.ok((await read("docs/index.html")).length > 0, "커밋된 docs/index.html 이 없다 - 생성 HTML 은 B4 가 걷어낸다");
});

for (const file of [".github/workflows/daily-update.yml", ".github/workflows/summarize.yml"]) {
  test(`${file}: 반영 단계는 모두 !cancelled() && 로 시작하고 steps 결과를 읽는다 (#507 cto·cpo - 앞 반영 단계가 뒤를 가리지 않는다)`, async () => {
    const text = await read(file);
    const reflects = steps(text).filter((s) => s.run.includes("exit 1"));
    assert.ok(reflects.length >= 2, `${file}: 반영 단계를 ${reflects.length}개밖에 못 찾았다`);
    for (const s of reflects) {
      assert.match(bare(s.if), /^!cancelled\(\) && steps\.[\w-]+\.(outcome|outputs\.[\w-]+) == '[\w]+'$/, `${s.name}: if 가 '!cancelled() && steps.… == …' 모양이 아니다: ${s.if}`);
      // YAML 에서 `!` 로 시작하는 맨 스칼라는 태그다 - ${{ }} 로 감싸야 한다(감싸지 않으면 워크플로가 파싱 오류로 0초 실패한다).
      assert.match(s.if, /^\$\{\{ .* \}\}$/, `${s.name}: if 를 \${{ }} 로 감싸지 않았다`);
    }
  });
}
