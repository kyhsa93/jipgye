import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * deploy.yml 은 사이트를 만들고 게시하는 유일한 워크플로다 (#510, 구조 B-4 컷오버. 전신: #509 B-3 의 "배포하지 않는 병행 가동" 계약).
 *
 * B3 시절 이 파일은 정반대를 지켰다 - 배포 권한·환경·Pages 요소가 deploy.yml 에 들어오는 순간 두 번째 배포 경로가 켜져 컷오버가 되므로 막았다. 컷오버가 이 PR 이다.
 * 뒤집힌 계약(cto 판정 2026-10-24):
 *  - 트리거: push main(경로 제한 없음) + workflow_run [Daily update, Summarize] completed(취소 제외) + workflow_dispatch(롤백 전용, inputs 없음).
 *  - 어느 이벤트든 `main` HEAD 를 체크아웃한다. 동시성 그룹은 `pages`(cancel-in-progress false)이고 digest-pipeline 과 다르다.
 *  - 게이트는 렌더 성공(렌더 실패면 렌더 단계가 종료 1 - 폴백 없음, #248 P1) + build/site 기준 시험(`npm run test:site`) 둘뿐이다. 건강 점검은 비차단. 배포 산출물은 build/site 다.
 *  - 배포 경로는 이것 하나다: static.yml 은 지웠고, 수집 워크플로(daily-update·summarize)에는 배포 요소·배포 권한이 없다.
 *  - main 은 생성 HTML 53장을 들고 있지 않다(손으로 고치는 틀 14장은 남는다).
 * 워크플로 YAML 의 글자만 읽는다 - 고정 입력이고, 네트워크·날짜·데이터를 보지 않는다(#8). 마지막 시험만 `git ls-files` 로 "커밋된" 것을 센다.
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
  if (!/^ {2}workflow_dispatch:$/m.test(on)) out.push("workflow_dispatch 가 없다(롤백 경로)");
  if (/^ {2}workflow_dispatch:\n {4}\S/m.test(on)) out.push("workflow_dispatch 에 inputs 가 있다(롤백 전용 - 모드를 고르는 수동 경로가 아니다)");
  if (/^ {2}schedule:/m.test(on)) out.push("자체 크론이 있다");

  if (!/^permissions:\n {2}contents: read\n {2}pages: write\n {2}id-token: write\n(?! {2}\w)/m.test(c)) out.push("permissions 가 contents: read · pages: write · id-token: write 셋이 아니다");
  if (/secrets\./.test(c)) out.push("시크릿을 쓴다");
  if (!/^ {4}environment:\n {6}name: github-pages\n/m.test(c)) out.push("배포 환경(github-pages)이 없다");
  if (/push-docs|git push|git commit/.test(c)) out.push("커밋·푸시를 한다");
  const group = c.match(/^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (.+)$/m);
  if (!group) out.push("concurrency 그룹이 없다");
  else {
    if (group[1].replace(/["']/g, "") !== "pages") out.push(`동시성 그룹이 pages 가 아니다: ${group[1]}`);
    if (group[2] !== "false") out.push("cancel-in-progress 가 false 가 아니다(올라가는 중인 배포를 끊는다)");
  }
  if (!/^ {4}if: github\.event_name != 'workflow_run' \|\| github\.event\.workflow_run\.conclusion != 'cancelled'$/m.test(c)) out.push("취소된 상위 실행을 제외하는 job if 가 없다");

  const list = steps(text);
  for (const s of list) if (s.uses && !/@[0-9a-f]{40}$/.test(s.uses)) out.push(`SHA 로 고정되지 않은 액션: ${s.uses}`);

  // 체크아웃은 하나이고 어느 이벤트든 main 의 지금 HEAD 다(이벤트 SHA 가 아니다).
  const checkouts = list.filter((s) => s.uses?.startsWith("actions/checkout@"));
  if (checkouts.length !== 1) out.push(`체크아웃이 하나가 아니다(${checkouts.length})`);
  if (!/actions\/checkout@[0-9a-f]{40}\n {8}with:\n {10}ref: main\n/.test(c)) out.push("체크아웃이 ref: main 이 아니다");
  if (/github\.sha|github\.event\.workflow_run\.head_sha/.test(c)) out.push("이벤트 SHA 를 쓴다(main HEAD 만 받는다)");

  const at = (pred) => list.findIndex(pred);
  const install = at((s) => s.run.trim() === "npm ci");
  const pin = at((s) => /BUILD_NOW=/.test(s.run));
  const render = at((s) => s.id === "render");
  const gate = at((s) => s.run.trim() === "npm run test:site");
  const health = at((s) => s.id === "health");
  const configure = at((s) => s.uses?.startsWith("actions/configure-pages@"));
  const upload = at((s) => s.uses?.startsWith("actions/upload-pages-artifact@"));
  const deploy = at((s) => s.uses?.startsWith("actions/deploy-pages@"));
  if (list[render]?.run.trim() !== "node scripts/render-pipeline.ts --out=build/site") out.push("렌더가 render-pipeline --out=build/site 한 줄이 아니다");
  if (!(install >= 0 && install < pin && pin < render)) out.push("npm ci -> 렌더 시각 고정 -> 렌더 순서가 아니다");
  if (!/\$\(git log -1 --format=%cI HEAD\)/.test(list[pin]?.run ?? "") || !/>> "\$GITHUB_ENV"/.test(list[pin]?.run ?? "")) out.push("BUILD_NOW 를 HEAD 커밋 시각으로 못박지 않는다");
  if (list[render]?.coe || list[render]?.if) out.push("렌더 단계에 continue-on-error·if 가 붙었다 - 렌더 실패가 배포를 막지 않는다");
  if (/steps\.render\.outputs/.test(c)) out.push("렌더 단계의 출력을 읽는다 - 폴백 게이트는 지웠다(#248), render-pipeline 은 출력을 쓰지 않는다");
  if (gate < 0) out.push("배포 게이트가 npm run test:site 가 아니다");
  if (list.some((s) => s.run.trim() === "npm test")) out.push("기능 시험 전체(npm test)를 부른다 - 데이터 배포가 기능 시험에 막힌다");
  if (!(render >= 0 && render < gate && gate < health && health < configure && configure < upload && upload < deploy)) out.push("렌더 -> build/site 시험 -> 건강 점검 -> 배포 순서가 아니다");
  if (list[gate]?.coe || list[gate]?.if) out.push("배포 게이트 시험에 continue-on-error·if 가 붙었다 - 게이트가 풀린다");
  if (list[health]?.coe !== "true") out.push("건강 점검이 continue-on-error 가 아니다(비차단이어야 한다)");
  if (list[health]?.run.trim() !== "npm run health --ignore-scripts") out.push("건강 점검이 npm run health --ignore-scripts 가 아니다(pretest 가 build/site 를 다시 만든다)");
  if (!/path: "\.\/build\/site"/.test(c)) out.push("Pages 아티팩트 경로가 ./build/site 가 아니다");

  const reflects = list.filter((s) => s.run.includes("exit 1"));
  if (reflects.length !== 1) out.push(`반영 단계가 하나가 아니다(${reflects.length})`);
  for (const s of reflects) if (!/^!cancelled\(\) && steps\./.test(bare(s.if))) out.push(`반영 단계 '${s.name}' 의 if 가 !cancelled() && 로 시작하지 않는다`);
  if (!list.at(-1)?.run.includes("exit 1")) out.push("반영 단계가 맨 끝이 아니다");
  return out;
}

const deploy = await read(DEPLOY);

test("deploy.yml: 계약 위반이 없다 - main push·workflow_run·dispatch(롤백), 배포 권한·환경, pages 동시성, main HEAD 체크아웃, 렌더 실패 = job 실패·build/site 시험, SHA 고정", () => {
  assert.deepEqual(violations(deploy), []);
});

test("deploy.yml: 렌더는 build/site 로 한 번에, 게이트(build/site 시험) 뒤에 건강 점검(비차단)과 배포 - 스텝 순서와 id", () => {
  const list = steps(deploy);
  const names = list.map((s) => s.name ?? s.uses ?? s.run);
  const idx = (n) => {
    const i = names.findIndex((x) => x.includes(n));
    assert.ok(i >= 0, `스텝 '${n}' 이 없다`);
    return i;
  };
  const order = ["npm ci", "렌더 시각 고정", "사이트 생성", "테스트 (build/site 기준)", "데이터 건강 점검 (비차단)", "Pages 배포", "Pages 아티팩트 업로드", "Pages에 배포", "데이터 건강 점검 실패 반영"].map(idx);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "스텝 순서가 계약과 다르다");
  assert.equal(list[idx("사이트 생성")].id, "render");
  assert.equal(list[idx("데이터 건강 점검 (비차단)")].id, "health");
  assert.equal(list[idx("Pages에 배포")].id, "deployment");
  assert.equal(list[idx("테스트 (build/site 기준)")].run.trim(), "npm run test:site");
  // 체크아웃은 하나다: 어느 이벤트든 main HEAD. 렌더와 시험과 배포가 같은 체크아웃에서 나온다.
  assert.equal(list.filter((s) => s.uses?.startsWith("actions/checkout@")).length, 1);
  assert.match(deploy, /uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}ref: main\n/);
  // 배포 환경의 url 은 deployment 스텝의 출력이다.
  assert.match(deploy, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
});

test("deploy.yml: 반영 단계는 맨 끝 하나(건강 점검)이고 배포 뒤에서 steps.health.outcome == 'failure' 일 때만 exit 1 로 끝난다", () => {
  const list = steps(deploy);
  const last = list.at(-1);
  assert.equal(bare(last.if), "!cancelled() && steps.health.outcome == 'failure'");
  assert.match(last.run, /::error::/);
  assert.match(last.run, /^\s*exit 1$/m);
  assert.ok(list.findIndex((s) => s.id === "deployment") < list.length - 1, "반영 단계가 배포보다 앞이다 - 점검이 배포를 막는다");
  // 폴백 게이트는 지웠다(#248 P1): 렌더 실패는 렌더 단계의 종료 1 로 뒤 단계(시험·배포)가 안 돈다. exit 1 로 끝나는 단계는 이 반영 단계 하나뿐이다.
  assert.deepEqual(list.filter((s) => s.run.includes("exit 1")).map((s) => s.name), [last.name]);
});

test("대조군: 계약을 어긴 변이 사본은 위반으로 잡힌다 (검사가 항상 참이 아니다)", () => {
  const mutate = (from, to) => {
    assert.ok(deploy.includes(from), `변이 대상 '${from}' 을 못 찾았다`);
    return deploy.replace(from, to);
  };
  const cases = [
    ["  pages: write\n  id-token: write\n", "", /permissions/],
    ["  group: pages\n", "  group: digest-pipeline\n", /동시성 그룹/],
    ["  cancel-in-progress: false\n", "  cancel-in-progress: true\n", /cancel-in-progress/],
    ["    environment:\n      name: github-pages\n", "", /배포 환경/],
    ["      - run: npm ci\n", "      - run: npm ci\n        env:\n          K: ${{ secrets.ECOS_API_KEY }}\n", /시크릿/],
    ["actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "actions/setup-node@v7", /SHA/],
    ["    branches: [main]\n", "    branches: [main]\n    paths: [docs/**]\n", /경로 제한/],
    ["  workflow_dispatch:\n", "  workflow_dispatch:\n    inputs:\n      mode:\n        type: string\n", /inputs/],
    ["  workflow_dispatch:\n", "", /workflow_dispatch/],
    ["  workflow_run:\n    workflows: [\"Daily update\", \"Summarize\"]\n", "  workflow_run:\n    workflows: [\"Daily update\"]\n", /workflow_run/],
    ["          ref: main\n", "          ref: ${{ github.sha }}\n", /ref: main|이벤트 SHA/],
    ["        run: node scripts/render-pipeline.ts --out=build/site\n", "        run: node scripts/render-pipeline.ts\n", /build\/site/],
    ["        id: render\n", "        id: render\n        continue-on-error: true\n", /렌더 단계에 continue-on-error/],
    ["        run: npm run test:site\n", "        run: npm test\n", /게이트|기능 시험/],
    ["        run: npm run test:site\n", "        run: npm run test:site\n        continue-on-error: true\n", /continue-on-error|if/],
    ["        id: health\n        continue-on-error: true\n", "        id: health\n", /continue-on-error/],
    ["        run: npm run health --ignore-scripts\n", "        run: npm run health\n", /ignore-scripts/],
    ["          path: \"./build/site\"\n", "          path: \"./docs\"\n", /build\/site/],
    ["if: ${{ !cancelled() && steps.health.outcome == 'failure' }}", "if: steps.health.outcome == 'failure'", /!cancelled/],
    ["echo \"BUILD_NOW=$(git log -1 --format=%cI HEAD)\"", "echo \"X=1\"", /BUILD_NOW/],
    ["    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion != 'cancelled'\n", "", /취소된/],
  ];
  for (const [from, to, expect] of cases) {
    const found = violations(mutate(from, to));
    assert.ok(found.some((v) => expect.test(v)), `변이(${from.trim().split("\n")[0]})가 안 잡혔다: ${JSON.stringify(found)}`);
  }
});

test("배포 경로는 하나다: deploy-pages 를 쓰는 워크플로는 deploy.yml 뿐이고, static.yml 은 없으며, 수집 워크플로에는 배포 권한·환경이 없다 (B3 의 '배포 없음' 계약을 뒤집은 자리)", async () => {
  const dir = path.join(root, ".github/workflows");
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  assert.ok(!files.includes("static.yml"), "static.yml 이 남았다 - 옛 배포 경로(docs/ 게시)는 컷오버에서 지운다");
  const deployers = [];
  for (const f of files) {
    const t = code(await read(`.github/workflows/${f}`));
    if (/deploy-pages|upload-pages-artifact|configure-pages/.test(t)) deployers.push(f);
    if (f !== "deploy.yml") {
      assert.ok(!/pages: write|id-token: write|name: github-pages/.test(t), `${f}: 배포 권한·환경이 있다 - 배포는 deploy.yml 한 곳이다`);
    }
  }
  assert.deepEqual(deployers, ["deploy.yml"], "Pages 배포 단계를 가진 워크플로가 deploy.yml 하나가 아니다");
  // pages 동시성 그룹도 deploy.yml 하나가 쥔다(옛 static.yml 이 쥐던 그룹이다).
  for (const f of files) {
    const t = code(await read(`.github/workflows/${f}`));
    assert.equal(/^ {2}group: "?pages"?$/m.test(t), f === "deploy.yml", `${f}: pages 동시성 그룹 소유가 deploy.yml 하나가 아니다`);
  }
});

test("main 은 생성 HTML 을 들고 있지 않다: git ls-files docs 에 생성 49장이 없고 손으로 고치는 틀 13장·금리 종료 안내 5장·정적 자산·data 는 있다", () => {
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", "docs"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    assert.fail(`git ls-files 를 못 돌렸다(저장소 밖에서 돌린 시험이다): ${e.message}`);
  }
  const GENERATED = /^docs\/(rate-news|realestate-news|stock-news|apartment-(sale|jeonse|rent)|budget-\d+eok|district-[a-z]+)\.html$/;
  assert.deepEqual(listed.filter((f) => GENERATED.test(f)), [], "커밋된 생성 HTML 이 있다 - 사이트는 build/site 에만 생기고 main 은 들고 있지 않는다(#510)");
  const htmls = listed.filter((f) => /^docs\/[^/]+\.html$/.test(f));
  // 손으로 고치는 틀 13장 + 금리 종료 안내 5장(#577 B2 - 지운 금리 주소에 둔 noindex 장, 2027-01-23 삭제 #581).
  assert.equal(htmls.length, 18, `docs/ 의 소스 장이 18장이 아니다: ${htmls.length}`);
  for (const f of ["docs/index.html", "docs/style.css", "docs/nav.js", "docs/sw.js", "docs/manifest.webmanifest"]) assert.ok(listed.includes(f), `${f} 가 없다 - 소스·정적 자산은 docs/ 에 남는다`);
  assert.ok(listed.some((f) => f.startsWith("docs/data/")), "docs/data 가 없다");
  // .gitignore 는 docs/ 에서 제자리로 렌더한 생성 장이 실수로 커밋되지 않게 막는다(기본 render-pipeline 은 docs/ 를 제자리에서 고친다). 49장 이름 전부가 걸리고, 손으로 고치는 틀·금리 종료 안내 장은 안 걸린다.
  const sample = ["rate-news", "realestate-news", "stock-news", "apartment-sale", "apartment-jeonse", "apartment-rent", "budget-3eok", "budget-20eok", "district-gangnam", "district-yongsan"];
  const ignored = (rel) => {
    try {
      execFileSync("git", ["check-ignore", "-q", rel], { cwd: root, stdio: "pipe" });
      return true;
    } catch {
      return false; // 종료 1 = 무시되지 않는다
    }
  };
  for (const name of sample) assert.ok(ignored(`docs/${name}.html`), `docs/${name}.html 이 .gitignore 에 안 걸린다 - 제자리 렌더가 커밋될 수 있다`);
  for (const name of ["index", "rates", "deposit-rates", "saving-rates", "mortgage-rates", "rent-loan-rates", "news", "realestate", "method", "about", "deal-search", "cancelled-deals"]) assert.ok(!ignored(`docs/${name}.html`), `손으로 고치는 틀 docs/${name}.html 이 .gitignore 에 걸린다`);
});

// daily-update.yml 의 하나뿐이던 반영 단계(금리 수집 실패 반영)는 #577 A 에서 금감원 수집과 함께 빠져 0개다. 다시 생기면 같은 모양 규칙을 받는다.
for (const [file, min] of [[DEPLOY, 1], [".github/workflows/daily-update.yml", 0], [".github/workflows/summarize.yml", 0]]) {
  test(`${file}: 반영 단계(${min}개 이상)는 모두 !cancelled() && 로 시작하고 steps 결과를 읽는다 (#507 cto·cpo - 앞 반영 단계가 뒤를 가리지 않는다)`, async () => {
    const text = await read(file);
    const reflects = steps(text).filter((s) => s.run.includes("exit 1"));
    assert.ok(reflects.length >= min, `${file}: 반영 단계를 ${reflects.length}개밖에 못 찾았다`);
    for (const s of reflects) {
      assert.match(bare(s.if), /^!cancelled\(\) && steps\.[\w-]+\.(outcome|outputs\.[\w-]+) == '[\w]+'$/, `${s.name}: if 가 '!cancelled() && steps.… == …' 모양이 아니다: ${s.if}`);
      // YAML 에서 `!` 로 시작하는 맨 스칼라는 태그다 - ${{ }} 로 감싸야 한다(감싸지 않으면 워크플로가 파싱 오류로 0초 실패한다).
      assert.match(s.if, /^\$\{\{ .* \}\}$/, `${s.name}: if 를 \${{ }} 로 감싸지 않았다`);
    }
  });
}
