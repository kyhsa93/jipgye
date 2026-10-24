import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * 데이터 건강 점검은 워크플로에서 비차단이고, 실패하면 맨 끝에서 run 을 빨갛게 끝낸다 (#507, 구조 B-1).
 *
 * 커밋된 데이터와 그 생성물을 맞대는 검사는 루트 `npm test`에서 tools/health 로 옮겼다. 그 검사가 배포·병합을 막으면 옮긴 보람이 없고
 * (2026-09-02~10-01 한 검사가 매 run 을 막은 것과 같은 모양), 아무도 안 보는 곳에서 조용히 빨개져도 소용이 없다. 그래서 점검 스텝은
 * continue-on-error 로 두고(daily-pretest.test.mjs 의 수집 전 테스트와 같은 방식, #449), 맨 끝 반영 단계가 run 을 실패로 끝낸다.
 * 이 파일은 워크플로 YAML 의 스텝 줄만 읽는다 - 고정 입력이고, 데이터도 날짜도 네트워크도 보지 않는다(#8).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

const HEALTH = "데이터 건강 점검 (비차단)";
const REFLECT = "데이터 건강 점검 실패 반영";

/** 점검 스텝이 든 job 의 steps: 를 스텝 덩어리로 자른다. 덩어리마다 name · 8칸 키(id·if·continue-on-error) · run 본문(들여쓴 줄 전부). */
function steps(text) {
  const jobs = text.split(/\n(?= {2}[\w-]+:\n)/).slice(1); // jobs: 아래 2칸 키마다 한 덩어리
  const job = jobs.find((j) => j.includes(HEALTH));
  assert.ok(job, `'${HEALTH}' 가 든 job 이 없다`);
  const body = job.split(/\n {4}steps:\n/)[1];
  return body
    .split(/\n(?=      - )/)
    .filter((c) => c.startsWith("      - "))
    .map((chunk) => {
      const key = (k) => chunk.match(new RegExp(`^ {6}(?:- | {2})${k}: (.*)$`, "m"))?.[1]?.replace(/\s+#.*$/, "") ?? null;
      return { name: key("name") ?? key("uses"), id: key("id"), if: key("if"), coe: key("continue-on-error"), run: chunk.match(/^ {8}run: ([^|>\n].*)$/m)?.[1] ?? chunk.split(/^ {8}run: [|>]\n/m)[1] ?? "" };
    });
}
const index = (list, name) => {
  const i = list.findIndex((s) => s.name === name);
  assert.ok(i >= 0, `스텝 '${name}' 을 못 찾았다`);
  return i;
};

// (#510, 구조 B-4) 건강 점검은 수집 워크플로(daily-update·summarize)에서 deploy.yml 로 옮겼다 - 점검이 읽는 사이트(build/site)가 거기서 만들어진다. 수집은 커밋으로 끝난다.
// deploy.yml 에서는 build/site 기준 시험(배포 게이트) 뒤 · Pages 배포 앞이고, `--ignore-scripts` 로 pretest(사이트 재생성)를 건너뛰어 방금 만든 build/site 를 그대로 읽는다.
for (const [file, order, run] of [
  [".github/workflows/deploy.yml", { before: "Pages 배포", after: "테스트 (build/site 기준)" }, "npm run health --ignore-scripts"],
]) {
  test(`${file}: 건강 점검 스텝은 비차단이고 npm run health 를 부르며, 렌더·게이트 시험 뒤 · Pages 배포 앞이다`, async () => {
    const list = steps(await read(file));
    const h = list[index(list, HEALTH)];
    assert.equal(h.id, "health");
    assert.equal(h.coe, "true", "continue-on-error: true 가 아니면 점검 실패가 배포를 막는다");
    assert.equal(h.run.trim(), run);
    assert.ok(index(list, order.after) < index(list, HEALTH), `${order.after} 보다 앞이면 안 된다`);
    assert.ok(index(list, HEALTH) < index(list, order.before), `${order.before} 보다 뒤면 안 된다`);
  });

  test(`${file}: 반영 단계는 배포 뒤에서 steps.health.outcome == 'failure' 일 때만 exit 1 로 끝난다`, async () => {
    const list = steps(await read(file));
    const r = list[index(list, REFLECT)];
    // `!cancelled() &&` 는 #509 가 붙였다: 상태 함수가 없으면 앞 반영 단계가 먼저 exit 1 했을 때 이 단계가 건너뛰어져 점검 실패가 가려졌다.
    assert.equal(r.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), "!cancelled() && steps.health.outcome == 'failure'");
    assert.match(r.run, /^\s*exit 1$/m);
    assert.match(r.run, /::error::/);
    assert.ok(index(list, "Pages에 배포") < index(list, REFLECT), "배포보다 앞이면 반영 단계가 배포를 막는다");
    // always()·failure() 는 쓰지 않는다: 취소된 run 에서 돌면 안 된다(`!cancelled()` 만 허용).
    assert.ok(!/always\(\)|failure\(\)/.test(r.if));
  });
}

test("수집 워크플로(daily-update·summarize)에는 건강 점검이 없다 - 점검이 읽는 사이트가 거기서 안 만들어지고, 수집이 점검에 묶이지 않는다 (#510)", async () => {
  for (const f of ["daily-update.yml", "summarize.yml"]) {
    const text = (await read(`.github/workflows/${f}`)).replace(/^\s*#.*$/gm, "");
    assert.ok(!/npm run health|건강 점검/.test(text), `${f}: 건강 점검이 남았다`);
  }
});

test("test.yml: PR 의 건강 점검 스텝도 continue-on-error 라서 Test 판정을 빨갛게 하지 않는다", async () => {
  const list = steps(await read(".github/workflows/test.yml"));
  const h = list[index(list, HEALTH)];
  assert.equal(h.coe, "true");
  assert.equal(h.run.trim(), "npm run health");
  assert.ok(index(list, "npm test + 시험 개수 래칫") < index(list, HEALTH));
});

test("건강 점검 스텝이 걸린 워크플로는 deploy.yml 과 test.yml 둘뿐이다 (#510: 수집 워크플로에서 옮겼다)", async () => {
  const dir = path.join(root, ".github/workflows");
  const using = [];
  for (const f of (await readdir(dir)).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const text = await readFile(path.join(dir, f), "utf8");
    if (/^\s*run: .*npm run health\b/m.test(text)) using.push(f);
  }
  assert.deepEqual(using, ["deploy.yml", "test.yml"]);
});

test("npm run health 는 tools/health 의 npm test(= run-tests 래퍼 + test/COUNT 래칫)를 부른다", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts.health, "npm --prefix tools/health test");
  assert.equal(JSON.parse(await read("tools/health/package.json")).scripts.test, "node ../../scripts/run-tests.mjs");
});

test("pretest 가 사이트를 만든다: 루트와 tools/health 의 pretest 는 render-pipeline --out=build/site 이고, deploy.yml 의 점검은 --ignore-scripts 로 그것을 건너뛴다 (#510)", async () => {
  const want = (rel) => rel === "package.json" ? "node scripts/render-pipeline.ts --out=build/site" : "node ../../scripts/render-pipeline.ts --out=build/site";
  for (const rel of ["package.json", "tools/health/package.json"]) {
    assert.equal(JSON.parse(await read(rel)).scripts.pretest, want(rel), `${rel}: pretest 가 build/site 를 만들지 않는다 - 시험이 읽는 사이트가 없다`);
  }
  assert.equal(JSON.parse(await read("package.json")).scripts["test:site"], "node scripts/run-tests.mjs --site", "배포 게이트 명령이 바뀌었다 - deploy.yml 과 함께 고친다");
  const deploy = (await read(".github/workflows/deploy.yml")).replace(/^\s*#.*$/gm, "");
  assert.match(deploy, /run: npm run health --ignore-scripts$/m, "deploy.yml 의 점검이 pretest 를 건너뛰지 않는다 - 게이트가 본 build/site 를 다시 만든다");
  assert.match(deploy, /run: npm run test:site$/m, "deploy.yml 의 게이트 명령이 npm run test:site 가 아니다");
});

test("tools/health 의 시험 파일은 모두 원본 시험의 출처를 적었고, 원본이 가리키는 곳으로 옮긴 시험이 실제로 있다", async () => {
  const dir = path.join(root, "tools/health/test");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".test.mjs"));
  assert.ok(files.length >= 10, `건강 점검 시험 파일이 ${files.length}개뿐이다 - 옮긴 시험이 빠졌다`);
  for (const f of files) {
    const text = await readFile(path.join(dir, f), "utf8");
    assert.match(text.split("\n")[0], /^\/\/ 원본: test\/[\w-]+\.test\.mjs /, `${f}: 첫 줄에 원본 시험의 출처가 없다`);
    // 옮긴 자리의 원본 파일에 포인터 주석이 남아 있다 - 옮겼다는 사실이 원본 쪽에서도 읽힌다.
    const origin = await readFile(path.join(root, "test", f), "utf8");
    assert.ok(origin.includes(`tools/health/test/${f}`), `test/${f} 에 옮긴 곳을 가리키는 주석이 없다`);
  }
});
