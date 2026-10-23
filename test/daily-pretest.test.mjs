import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 수집 전 테스트가 수집을 막지 않는다 (#449-A).
 *
 * 2026-09-02~10-01, "테스트 (수집 전)" 한 스텝이 같은 검사로 매 run 을 막아 수집이 통째로 사라졌다
 * (28일 시계열 유실 - 국토부 응답은 날짜별로 다시 받을 수 없다). 지금 형태는 그 스텝에 id: pretest 와
 * continue-on-error: true 를 달고, 맨 끝 "수집 전 테스트 실패 반영" 단계가 job 을 빨갛게 끝내는 것이다.
 *
 * 이 파일은 워크플로 YAML 을 읽어 GitHub Actions 의 스텝 실행 규칙(앞 스텝이 실패하면 상태 함수 없는 if 는
 * 건너뛴다, continue-on-error 스텝의 실패는 job 을 실패시키지 않는다)을 **그 파일에 대고** 흉내 낸다.
 * 고정 입력만 읽는다 - 네트워크도 날짜도 데이터도 보지 않는다(#8).
 *
 * 지키는 것은 수집분(데이터 보존)이다. 화면 신선도가 아니다: 수집 후 테스트도 실패하면 배포가 건너뛰어진다.
 */

const root = path.resolve(import.meta.dirname, "..");
const yml = await readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8");

const PRE = "테스트 (수집 전)";
const POST = "테스트 (수집 후)";
const REFLECT = "수집 전 테스트 실패 반영";
const COMMIT = "변경사항 커밋 및 푸시";
const COLLECT = "실거래 수집";
const NEWS = "뉴스 수집";
const DEPLOY = "Pages에 배포";

/** steps: 아래를 스텝으로 자르고, 스텝 머리(`      - `)와 8칸 키만 읽는다. 주석·run 본문·with/env 안쪽은 안 본다. */
function parseSteps(text) {
  const body = text.split(/\n {4}steps:\n/)[1];
  assert.ok(body, "steps: 를 못 찾았다");
  return body
    .split(/\n(?=      - )/)
    .filter((chunk) => chunk.startsWith("      - "))
    .map((chunk) => {
      const step = { run: "" };
      const lines = chunk.split("\n");
      let inRun = false;
      for (const [i, raw] of lines.entries()) {
        const line = i === 0 ? `        ${raw.slice(8)}` : raw; // 첫 줄의 `- key:` 를 8칸 키로 읽는다
        if (inRun) {
          if (line.startsWith("          ") || line.trim() === "") {
            step.run += `${line.trim()}\n`;
            continue;
          }
          inRun = false;
        }
        const m = line.match(/^ {8}([a-z-]+):\s*(.*)$/);
        if (!m) continue;
        const [, key, value] = m;
        if (key === "run") {
          if (/^[|>]/.test(value)) inRun = true;
          else step.run = `${value}\n`;
        } else {
          step[key] = value.replace(/\s+#.*$/, "");
        }
      }
      return step;
    });
}

const nameOf = (s) => s.name ?? s.uses;

/**
 * GitHub Actions 의 if 평가 중 이 워크플로가 쓰는 만큼. 상태 함수(success·always·failure·!cancelled)가 없으면
 * 앞에 success() && 가 암묵적으로 붙는다. 모르는 모양이 나오면 조용히 넘기지 않고 던진다 - 이 시험이 틀린 결론을 내지 않게.
 */
function evalIf(expr, ctx) {
  if (expr === undefined) return !ctx.jobFailed;
  const clauses = expr.replace(/^\$\{\{\s*|\s*\}\}$/g, "").split("&&").map((c) => c.trim());
  let hasStatus = false;
  const results = clauses.map((c) => {
    if (c === "success()") { hasStatus = true; return !ctx.jobFailed; }
    if (c === "always()") { hasStatus = true; return true; }
    if (c === "failure()") { hasStatus = true; return ctx.jobFailed; }
    if (c === "!cancelled()") { hasStatus = true; return true; }
    let m = c.match(/^env\.MODE\s*(==|!=)\s*'([^']*)'$/);
    if (m) return (ctx.mode === m[2]) === (m[1] === "==");
    m = c.match(/^steps\.([\w-]+)\.outcome\s*==\s*'([^']*)'$/);
    if (m) return (ctx.outcomes[m[1]] ?? "skipped") === m[2];
    m = c.match(/^steps\.([\w-]+)\.outputs\.([\w-]+)\s*==\s*'([^']*)'$/);
    if (m) return (ctx.outputs[m[1]]?.[m[2]] ?? "") === m[3];
    throw new Error(`이 시험이 모르는 if 식이다 - 시험의 evalIf 를 같이 고친다: ${c}`);
  });
  return (hasStatus || !ctx.jobFailed) && results.every(Boolean);
}

/** failNames 에 든 스텝(이름)은 실패한다. 렌더 폴백은 fallback=true 로 켠다. */
function simulate(text, { mode = "full", failNames = [], fallback = false } = {}) {
  const ctx = { mode, jobFailed: false, outcomes: {}, outputs: {} };
  const ran = [];
  const skipped = [];
  for (const step of parseSteps(text)) {
    const name = nameOf(step);
    if (!evalIf(step.if, ctx)) {
      skipped.push(name);
      if (step.id) ctx.outcomes[step.id] = "skipped";
      continue;
    }
    ran.push(name);
    // 스크립트가 터지는 경우는 failNames 로, `exit 1` 로 스스로 실패로 끝내는 반영 단계는 run 본문에서 읽는다.
    const failed = failNames.includes(name) || /^exit 1$/m.test(step.run);
    if (step.id) {
      ctx.outcomes[step.id] = failed ? "failure" : "success";
      if (name === "정적 HTML에 오늘 내용 심기" && fallback) ctx.outputs[step.id] = { fallback: "true" };
    }
    if (failed && step["continue-on-error"] !== "true") ctx.jobFailed = true;
  }
  return { ran, skipped, jobFailed: ctx.jobFailed };
}

/** 이 변경을 되돌린 사본: pretest 의 id·continue-on-error 와 반영 단계를 걷어낸다. */
function revert(text) {
  const bare = text.replace(`      - name: ${PRE}\n        id: pretest\n        continue-on-error: true\n`, `      - name: ${PRE}\n`);
  const cut = bare.indexOf("\n      # 수집 전 테스트가 실패한 날의 표시다");
  assert.ok(bare !== text && cut > 0, "되돌림 대상 모양을 못 찾았다 - 시험의 revert 를 같이 고친다");
  return `${bare.slice(0, cut)}\n`;
}

// ── 모양 ───────────────────────────────────────────────────────────────────

const steps = parseSteps(yml);
const byName = (n) => steps.find((s) => nameOf(s) === n);
const at = (n) => steps.findIndex((s) => nameOf(s) === n);

test("수집 전 테스트는 id: pretest + continue-on-error 이고 그대로 npm test 를 돈다 - 지우거나 약화하지 않는다", () => {
  const pre = byName(PRE);
  assert.ok(pre, `"${PRE}" 스텝이 없다 - 수집 전 테스트를 지우지 않는다`);
  assert.equal(pre.id, "pretest");
  assert.equal(pre["continue-on-error"], "true");
  assert.equal(pre.run, "npm test\n", "수집 전 테스트의 명령이 npm test 가 아니다(|| true 등으로 약화 금지)");
  assert.equal(pre.if, undefined, "수집 전 테스트에 조건이 붙었다");
  const tests = steps.filter((s) => /^npm test\b/.test(s.run));
  assert.equal(tests.length, 2, "npm test 스텝은 수집 전·후 둘이다");
  assert.ok(at(PRE) < at(NEWS), "수집 전 테스트가 수집보다 뒤로 갔다");
});

test("수집 후 테스트는 그대로다 - 막는 스텝이고 커밋 뒤 · 배포 앞이다 (배포 게이트)", () => {
  const post = byName(POST);
  assert.ok(post, `"${POST}" 스텝이 없다`);
  assert.equal(post.run, "npm test\n");
  for (const key of ["id", "if", "continue-on-error"]) {
    assert.equal(post[key], undefined, `수집 후 테스트에 ${key} 가 붙었다 - 배포 게이트가 풀린다`);
  }
  assert.ok(at(COMMIT) < at(POST), "수집 후 테스트가 커밋보다 앞이다");
  assert.ok(at(POST) < steps.findIndex((s) => s.uses?.startsWith("actions/configure-pages")), "수집 후 테스트가 배포 준비보다 뒤다");
});

test("실패 반영 단계는 맨 끝이고 steps.pretest.outcome == 'failure' 일 때 ::error:: 를 쓰고 exit 1 로 끝낸다", () => {
  const last = steps.at(-1);
  assert.equal(nameOf(last), REFLECT, "맨 끝 스텝이 수집 전 테스트 실패 반영이 아니다");
  assert.equal(last.if, "steps.pretest.outcome == 'failure'");
  assert.match(last.run, /::error::/);
  assert.match(last.run, /^exit 1$/m);
  assert.equal(last["continue-on-error"], undefined);
  // 커밋·수집·배포 트리거(deploy-pages)가 모두 끝난 뒤, 기존 두 반영 단계(금리·렌더 폴백)와 같은 자리다.
  for (const n of [COLLECT, COMMIT, POST, DEPLOY, "금리 수집 실패 반영", "렌더 폴백 반영"]) {
    assert.ok(at(n) >= 0 && at(n) < at(REFLECT), `${n} 이 반영 단계보다 뒤에 있다`);
  }
  assert.equal(steps.filter((s) => s.if?.includes("steps.pretest")).length, 1, "pretest 를 읽는 스텝이 하나가 아니다");
});

// ── 실행 흉내 (가)(다) ──────────────────────────────────────────────────────

const COLLECTION = [NEWS, "시장 지표 수집", COLLECT, "예·적금·대출 금리 수집", COMMIT];

test("흉내 자체: 실패가 없으면 반영 단계는 건너뛰고 job 은 성공이다", () => {
  const r = simulate(yml);
  assert.equal(r.jobFailed, false);
  assert.ok(r.skipped.includes(REFLECT));
  for (const n of [PRE, POST, DEPLOY, ...COLLECTION]) assert.ok(r.ran.includes(n), `${n} 이 안 돌았다`);
});

test("(가) 수집 전 테스트가 실패해도 수집·커밋이 돌고 run 최종 상태는 failure 다", () => {
  const r = simulate(yml, { failNames: [PRE] });
  for (const n of COLLECTION) assert.ok(r.ran.includes(n), `${n} 이 안 돌았다 - 수집분이 사라진다`);
  assert.equal(r.jobFailed, true, "run 이 초록으로 끝난다 - 수집 전 테스트 실패가 가려진다");
  assert.equal(r.ran.at(-1), REFLECT, "실패 반영이 맨 끝에서 돌지 않았다");
});

test("(다) 수집 전 실패 · 수집 후 통과 -> 배포가 실행되고 그 뒤에 실패로 끝난다 (실패 반영이 배포를 건너뛰게 하지 않는다)", () => {
  const r = simulate(yml, { failNames: [PRE] });
  for (const n of [POST, "Pages 배포", "Pages 아티팩트 업로드"]) assert.ok(r.ran.includes(n), `${n} 이 건너뛰어졌다`);
  assert.ok(r.ran.includes(DEPLOY), "배포가 건너뛰어졌다 - 화면 신선도를 잃는다");
  assert.ok(r.ran.indexOf(DEPLOY) < r.ran.indexOf(REFLECT), "배포가 실패 반영보다 뒤다");
  assert.equal(r.jobFailed, true);
});

test("수집 전 · 후 둘 다 실패 -> 수집·커밋은 돌고 배포는 건너뛴다 (화면은 어제 데이터에 머문다 - 허용된 잔여 위험)", () => {
  const r = simulate(yml, { failNames: [PRE, POST] });
  for (const n of COLLECTION) assert.ok(r.ran.includes(n), `${n} 이 안 돌았다`);
  assert.ok(r.skipped.includes(DEPLOY), "수집 후 테스트가 실패했는데 배포가 돌았다 - 배포 게이트가 풀렸다");
  assert.equal(r.jobFailed, true);
});

test("수집 후 테스트만 실패 -> 이전과 같다: 배포 건너뜀, 실패, 수집 전 반영은 안 돈다", () => {
  const r = simulate(yml, { failNames: [POST] });
  assert.ok(r.skipped.includes(DEPLOY));
  assert.ok(r.skipped.includes(REFLECT));
  assert.equal(r.jobFailed, true);
});

test("news 모드에서도 수집 전 테스트 실패가 뉴스 수집·커밋을 막지 않고 끝에서 실패로 끝난다", () => {
  const r = simulate(yml, { mode: "news", failNames: [PRE] });
  for (const n of [NEWS, COMMIT, POST, DEPLOY, REFLECT]) assert.ok(r.ran.includes(n), `${n} 이 안 돌았다`);
  assert.ok(r.skipped.includes(COLLECT));
  assert.equal(r.jobFailed, true);
});

test("기존 반영 단계(금리·렌더 폴백)는 그대로 동작한다 - 수집 전 테스트가 통과한 날 새 단계는 끼지 않는다", () => {
  const rates = simulate(yml, { failNames: ["예·적금·대출 금리 수집"] });
  assert.ok(rates.ran.includes("금리 수집 실패 반영") && rates.ran.includes(DEPLOY));
  assert.ok(rates.skipped.includes(REFLECT));
  assert.equal(rates.jobFailed, true);
  const render = simulate(yml, { fallback: true });
  assert.ok(render.ran.includes("렌더 폴백 반영") && render.ran.includes(DEPLOY));
  assert.ok(render.skipped.includes(REFLECT));
  assert.equal(render.jobFailed, true);
});

// ── 대조군 (나) ─────────────────────────────────────────────────────────────

test("(나) 대조군: 이 변경을 되돌린 사본에서는 (가)가 빨개진다 - 수집이 막히고 반영 단계도 없다", () => {
  const reverted = revert(yml);
  assert.ok(!reverted.includes("id: pretest") && !reverted.includes(`- name: ${REFLECT}`), "되돌림이 안 먹었다");
  const r = simulate(reverted, { failNames: [PRE] });
  assert.ok(!r.ran.includes(NEWS), "되돌린 사본에서도 수집이 돈다 - 대조가 무력하다");
  assert.ok(!r.ran.includes(COMMIT), "되돌린 사본에서도 커밋이 돈다 - 대조가 무력하다");
  assert.equal(r.jobFailed, true);
  // (가)의 단언을 그대로 되돌린 사본에 대면 걸린다: 수집·커밋 중 안 도는 것이 있다.
  assert.ok(COLLECTION.some((n) => !r.ran.includes(n)));
});

test("대조군: continue-on-error 만 빠져도 (가)가 빨개진다", () => {
  const partial = yml.replace(/(id: pretest\n) {8}continue-on-error: true\n/, "$1");
  assert.notEqual(partial, yml);
  const r = simulate(partial, { failNames: [PRE] });
  assert.ok(!r.ran.includes(COMMIT));
});
