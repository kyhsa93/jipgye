import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 수집 워크플로(daily-update·summarize)는 렌더·시험·배포를 하지 않는다 (#510, 구조 B-4. 전신: daily-pretest.test.mjs, #449-A).
 *
 * 2026-09-02~10-01, "테스트 (수집 전)" 한 스텝이 같은 검사로 매 run 을 막아 수집이 통째로 사라졌다(28일 시계열 유실 - 국토부 응답은 날짜별로 다시 받을 수 없다).
 * #449 는 그 스텝을 continue-on-error 로 풀고 맨 끝 반영 단계가 run 을 빨갛게 끝내게 했다(수집을 시험에서 떼어 냄). B4 는 그 끝까지 간다: 수집 워크플로에서 시험·렌더·건강 점검·
 * Pages 배포를 전부 deploy.yml 로 옮겼다. 그래서 수집이 시험에 막힐 수 있는 길이 구조적으로 없다 - 이 파일이 그 경계를 지킨다.
 *  - 두 워크플로에는 `npm test`·`npm run test:site`·`npm run health`·render-pipeline·Pages 단계·배포 환경이 없다(아래 `violations`).
 *  - 권한은 `contents: write` 하나다(pages·id-token 이 있으면 배포 단계가 돌아올 자리가 생긴다).
 *  - 커밋은 push-docs.sh 만 하고, 그 기본 경로가 docs/data·raw 로 한정돼 있다(test/push-docs.test.mjs).
 *  - 금감원(FSS finlife) 금리 수집과 그 실패 반영 단계는 없다(2026-10-25 소유자 결정, #577 A). 그래서 Daily 의 맨 끝 스텝은 커밋이다.
 *
 * 이 파일은 워크플로 YAML 을 읽어 GitHub Actions 의 스텝 실행 규칙(앞 스텝이 실패하면 상태 함수 없는 if 는 건너뛴다, continue-on-error 스텝의 실패는 job 을 실패시키지 않는다)을
 * **그 파일에 대고** 흉내 낸다. 고정 입력만 읽는다 - 네트워크도 날짜도 데이터도 보지 않는다(#8).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const DAILY = ".github/workflows/daily-update.yml";
const SUMMARIZE = ".github/workflows/summarize.yml";
const yml = await read(DAILY);
const summarizeYml = await read(SUMMARIZE);

const COMMIT = "변경사항 커밋 및 푸시";
const COLLECT = "실거래 수집";
const NEWS = "뉴스 수집";
const NEWS_CONTEXT = "기사에 실거래가 수치 붙이기";
const MARKET = "시장 지표 수집";

/** 주석을 걷어 낸다(전체 줄 주석과 `uses: … # v7.0.1` 꼬리). 주석에는 일부러 render-pipeline·npm test 같은 낱말이 쓰인다. */
const code = (text) => text.replace(/^\s*#.*\n/gm, "").replace(/(\S)[ \t]+#[ \t].*$/gm, "$1");

/** steps: 아래를 스텝으로 자르고, 스텝 머리(`      - `)와 8칸 키만 읽는다. 주석·run 본문·with/env 안쪽은 안 본다. 파일에 job 이 여럿이면 마지막 job 의 스텝이다. */
function parseSteps(text) {
  const body = text.split(/\n {4}steps:\n/).at(-1);
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
 * GitHub Actions 의 if 평가 중 이 워크플로가 쓰는 만큼. 상태 함수(success·always·failure·!cancelled)가 없으면 앞에 success() && 가 암묵적으로 붙는다.
 * 모르는 모양이 나오면 조용히 넘기지 않고 던진다 - 이 시험이 틀린 결론을 내지 않게.
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
    throw new Error(`이 시험이 모르는 if 식이다 - 시험의 evalIf 를 같이 고친다: ${c}`);
  });
  return (hasStatus || !ctx.jobFailed) && results.every(Boolean);
}

/** failNames 에 든 스텝(이름)은 실패한다. `exit 1` 로 스스로 실패로 끝내는 반영 단계는 run 본문에서 읽는다. */
function simulate(text, { mode = "full", failNames = [] } = {}) {
  const ctx = { mode, jobFailed: false, outcomes: {} };
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
    const failed = failNames.includes(name) || /^exit 1$/m.test(step.run);
    if (step.id) ctx.outcomes[step.id] = failed ? "failure" : "success";
    if (failed && step["continue-on-error"] !== "true") ctx.jobFailed = true;
  }
  return { ran, skipped, jobFailed: ctx.jobFailed };
}

/** 주석을 뺀 워크플로에서 build-conversion 을 부르는 줄 수. */
const conversionCalls = (text) => (code(text).match(/node scripts\/build-conversion\.ts/g) ?? []).length;

/** 수집 워크플로가 지킬 것의 위반 목록. 대조군이 같은 함수에 변이 사본을 넣어, 이 검사가 무는지(항상 참이 아닌지) 본다. */
function violations(text) {
  const out = [];
  const c = code(text);
  if (/render-pipeline|prerender\.ts|build-[a-z]+-pages\.ts|build-updated-stamp/.test(c)) out.push("렌더 스크립트를 부른다");
  if (/^\s*(?:- )?run: (?:npm test|npm run test|npm run health)\b/m.test(c)) out.push("시험·건강 점검을 부른다");
  if (/configure-pages|upload-pages-artifact|deploy-pages/.test(c)) out.push("Pages 배포 단계가 있다");
  if (/^\s*environment:/m.test(c)) out.push("배포 환경(environment)을 쓴다");
  if (/id-token|pages: write/.test(c)) out.push("배포 권한(pages·id-token)을 가진다");
  if (!/^permissions:\n {2}contents: write\n(?! {2}\w)/m.test(c)) out.push("permissions 가 contents: write 하나가 아니다");
  if (/^\s*(?:- )?run: .*git (?:push|commit|add)\b/m.test(c)) out.push("push-docs.sh 밖에서 직접 커밋·푸시한다");
  // 반영 단계의 말: 배포는 이 워크플로 밖이다. "배포는 끝났다"류 문장은 그날 해당 없는 거짓이 된다(#510 cpo 조건 A: 문구를 고치거나 없앤다).
  for (const m of c.matchAll(/::error::([^\n]*)/g)) if (/(?:커밋·)?배포(?:는|도)?\s*(?:끝났|나갔)/.test(m[1])) out.push(`반영 문구가 배포가 끝났다고 말한다: ${m[1].slice(0, 40)}`);
  // #577 A: 금감원 자료는 저작권 약관 위험으로 프로젝트에서 뺐다(소유자 결정 2026-10-25). 수집기·키·그 결과를 읽는 반영 단계가 돌아오지 않게 한다.
  if (/fetch-rates|FSS_FINLIFE|steps\.rates\b/.test(c)) out.push("금감원 금리 수집(fetch-rates·FSS_FINLIFE_API_KEY·steps.rates)이 있다 (#577)");
  return out;
}

// ── 모양 ───────────────────────────────────────────────────────────────────

const steps = parseSteps(yml);
const byName = (n) => steps.find((s) => nameOf(s) === n);
const at = (n) => steps.findIndex((s) => nameOf(s) === n);

test("daily-update.yml: 수집은 시험·렌더·건강 점검·Pages 배포를 부르지 않는다 - 위반이 없다", () => {
  assert.deepEqual(violations(yml), []);
  assert.equal(steps.filter((s) => /\bnpm (?:run )?(?:test|health)/.test(s.run)).length, 0, "시험·건강 점검 스텝이 남았다");
});

test("summarize.yml: 요약도 시험·렌더·건강 점검·Pages 배포를 부르지 않는다 - 위반이 없다 (rate 4장을 뺀 다섯 단계 렌더도 함께 없어졌다)", () => {
  assert.deepEqual(violations(summarizeYml), []);
  const list = parseSteps(summarizeYml);
  assert.equal(list.filter((s) => /\bnpm (?:run )?(?:test|health)/.test(s.run)).length, 0, "시험·건강 점검 스텝이 남았다");
  // 요약 -> 번역 -> 수치 붙이기 -> 커밋 순서가 맨 끝이다. 시험이 커밋 앞에 있던 옛 모양(요약이 시험 하나에 막혔다)으로 돌아가지 않는다.
  const names = list.map(nameOf);
  const order = ["AI 요약 생성", "뉴스 제목 영어 번역", "기사에 실거래가·금리 수치 붙이기", COMMIT].map((n) => names.indexOf(n)); // summarize.yml 의 단계 이름(이 PR 범위 밖)
  assert.ok(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || order[i - 1] < v), `요약 단계 순서가 다르다: ${order}`);
  assert.equal(names.at(-1), COMMIT, "맨 끝 스텝이 커밋이 아니다");
});

test("커밋 스텝은 둘 다 push-docs.sh 만 부르고 그 뒤에 수집 워크플로의 일이 없다 - 둘 다 커밋이 맨 끝이다 (#577 A 로 Daily 의 금리 반영이 빠졌다)", () => {
  for (const [file, text] of [[DAILY, yml], [SUMMARIZE, summarizeYml]]) {
    const list = parseSteps(text);
    const commit = list.find((s) => nameOf(s) === COMMIT);
    assert.ok(commit, `${file}: 커밋 스텝이 없다`);
    assert.match(commit.run, /\.\/scripts\/push-docs\.sh "/, `${file}: 커밋이 push-docs.sh 가 아니다`);
    assert.ok(!/push-docs\.sh[^\n]*\b(docs|\.)\s*$/m.test(commit.run), `${file}: push-docs.sh 에 경로 인자를 줬다 - 기본(docs/data·raw)이 계약이다`);
    assert.equal(nameOf(list.at(-1)), COMMIT, `${file}: 맨 끝 스텝이 커밋이 아니다`);
  }
});

test("금감원 금리 수집·실패 반영 단계가 없다 (#577 A) - 스텝 이름도, id: rates 도, 그 outcome 을 읽는 if 도 없다", () => {
  assert.equal(byName("예·적금·대출 금리 수집"), undefined, "금리 수집 스텝이 남았다");
  assert.equal(byName("금리 수집 실패 반영"), undefined, "금리 수집 실패 반영 스텝이 남았다");
  assert.equal(steps.filter((s) => s.id === "rates" || s.if?.includes("steps.rates")).length, 0, "rates 스텝이나 그 결과를 읽는 스텝이 남았다");
  assert.ok(!/fetch-rates|FSS_FINLIFE/.test(code(yml)), "fetch-rates 호출이나 FSS 키가 남았다");
  for (const n of [NEWS, MARKET, COLLECT, NEWS_CONTEXT, COMMIT]) assert.ok(at(n) >= 0, `${n} 스텝이 없다 - 다른 단계까지 지웠다`);
});

test("전환율(build-conversion)은 Daily 에 한 번만 있다 - 실거래 수집 안, 시장 지표 수집(ECOS series.json) 뒤다 (#577 C2. 두 번째 「전환율 다시 만들기」 단계는 없어졌다)", () => {
  assert.equal(steps.filter((s) => /전환율/.test(nameOf(s) ?? "")).length, 0, "별도 전환율 스텝이 남았다 - conversion 은 실거래 수집 안의 한 번뿐이다");
  assert.equal(conversionCalls(yml), 1, "build-conversion 호출이 한 번이 아니다");
  assert.match(byName(COLLECT).run, /node scripts\/build-conversion\.ts/, "실거래 수집 안의 build-conversion 이 빠졌다");
  assert.ok(at(MARKET) >= 0 && at(MARKET) < at(COLLECT), "시장 지표 수집이 실거래 수집 앞이 아니다 - conversion 이 어제 ECOS series.json 을 읽는다");
  assert.match(byName(MARKET).run, /fetch-indicators\.ts/, "ECOS series.json 을 쓰는 fetch-indicators 가 시장 지표 수집에 없다");
  assert.equal(byName(COLLECT).if, "env.MODE == 'full'");
  assert.ok(at(COLLECT) < at(NEWS_CONTEXT), "news-context 가 conversion 을 만드는 실거래 수집보다 앞이다");
});

// ── 실행 흉내 ───────────────────────────────────────────────────────────────

const COLLECTION = [NEWS, MARKET, COLLECT, NEWS_CONTEXT, COMMIT];

test("흉내 자체: 실패가 없으면 job 은 성공이고 커밋이 맨 끝에 돈다 - 시험·렌더·배포 스텝은 애초에 없다", () => {
  const r = simulate(yml);
  assert.equal(r.jobFailed, false);
  assert.equal(r.ran.at(-1), COMMIT);
  for (const n of COLLECTION) assert.ok(r.ran.includes(n), `${n} 이 안 돌았다`);
  assert.ok(!r.ran.some((n) => /테스트|정적 HTML|Pages|건강 점검/.test(n)), `수집 워크플로에 시험·렌더·배포류 스텝이 돈다: ${r.ran}`);
});

test("시장 지표 수집이 실패하면 conversion 을 만드는 실거래 수집은 건너뛴다 - 어제 ECOS series.json 으로 오늘 conversion 을 만들지 않는다", () => {
  const r = simulate(yml, { failNames: [MARKET] });
  assert.ok(r.skipped.includes(COLLECT), "시장 지표 수집이 실패했는데 실거래 수집이 돌았다");
  assert.equal(r.jobFailed, true);
});

test("news 모드에서는 뉴스 수집·커밋이 돌고 시장 지표·실거래(conversion 포함)는 건너뛴다", () => {
  const r = simulate(yml, { mode: "news" });
  for (const n of [NEWS, COMMIT]) assert.ok(r.ran.includes(n), `${n} 이 안 돌았다`);
  for (const n of [MARKET, COLLECT]) assert.ok(r.skipped.includes(n), `${n} 이 news 모드에서 돌았다`);
  assert.equal(r.jobFailed, false);
});

// ── 대조군 ──────────────────────────────────────────────────────────────────

test("대조군: 두 번째 build-conversion 스텝을 도로 넣은 사본은 한 번이 아니라고 잡힌다 - 세는 검사가 무는지", () => {
  const readded = yml.replace(/(\n {6}- name: 기사에 실거래가 수치 붙이기)/, "\n      - name: 전환율 다시 만들기 (금리 반영)\n        if: env.MODE == 'full'\n        continue-on-error: true\n        run: node scripts/build-conversion.ts\n$1");
  assert.notEqual(readded, yml);
  assert.equal(conversionCalls(readded), 2, "도로 넣은 호출을 못 센다 - 대조가 무력하다");
});

test("대조군: 시험·렌더·건강 점검·Pages 단계를 도로 넣은 사본은 위반으로 잡힌다 (검사가 항상 참이 아니다)", () => {
  const add = (src, stepText) => src.replace(/(\n {6}- name: 변경사항 커밋 및 푸시)/, `\n${stepText}$1`);
  const cases = [
    [add(yml, "      - name: 테스트\n        run: npm test\n"), /시험·건강 점검/],
    [add(yml, "      - name: 점검\n        run: npm run health\n"), /시험·건강 점검/],
    [add(yml, "      - name: 렌더\n        run: node scripts/render-pipeline.ts\n"), /렌더 스크립트/],
    [add(yml, "      - name: 렌더\n        run: node scripts/prerender.ts\n"), /렌더 스크립트/],
    [add(yml, "      - uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128\n"), /Pages 배포/],
    [yml.replace("jobs:\n  update:\n    runs-on: ubuntu-latest\n", "jobs:\n  update:\n    runs-on: ubuntu-latest\n    environment:\n      name: github-pages\n"), /environment/],
    [yml.replace("  contents: write\n", "  contents: write\n  pages: write\n  id-token: write\n"), /배포 권한|permissions/],
    [yml.replace("  contents: write\n", "  contents: read\n"), /permissions/],
    [add(yml, '      - name: 반영\n        run: echo "::error::원본 커밋·배포는 끝났다"\n'), /반영 문구/],
  ];
  for (const [mutated, expect] of cases) {
    assert.notEqual(mutated, yml, "변이가 안 먹었다");
    const found = violations(mutated);
    assert.ok(found.some((v) => expect.test(v)), `변이가 안 잡혔다(${expect}): ${JSON.stringify(found)}`);
  }
});

test("대조군: 금감원 금리 수집·FSS 키·그 결과를 읽는 반영 단계를 도로 넣은 사본은 #577 위반으로 잡힌다", () => {
  const add = (src, stepText) => src.replace(/(\n {6}- name: 변경사항 커밋 및 푸시)/, `\n${stepText}$1`);
  const cases = [
    add(yml, "      - name: 예·적금·대출 금리 수집\n        id: rates\n        run: node scripts/fetch-rates.ts\n"),
    add(yml, "      - name: 금리\n        run: echo\n        env:\n          FSS_FINLIFE_API_KEY: x\n"),
    `${yml}\n      - name: 금리 수집 실패 반영\n        if: \${{ !cancelled() && steps.rates.outcome == 'failure' }}\n        run: exit 1\n`,
  ];
  for (const mutated of cases) {
    assert.notEqual(mutated, yml, "변이가 안 먹었다");
    assert.ok(violations(mutated).some((v) => /#577/.test(v)), `변이가 안 잡혔다: ${JSON.stringify(violations(mutated))}`);
  }
});

test("Daily 의 스텝은 뉴스 수집 → 시장 지표 수집 → 실거래 수집 → 기사 수치 붙이기 → 커밋 다섯이다 (#577 A·C2 가 금리 단계와 두 번째 전환율 단계만 뺐다)", () => {
  const named = steps.filter((s) => s.name).map((s) => s.name);
  assert.deepEqual(named, [NEWS, MARKET, COLLECT, NEWS_CONTEXT, COMMIT]);
  assert.match(byName(COLLECT).run, /node scripts\/build-conversion\.ts/, "실거래 수집 안의 첫 build-conversion 이 빠졌다");
  assert.match(byName(MARKET).run, /fetch-market\.ts[\s\S]*fetch-move-in\.ts/, "ECOS·지표 수집이 바뀌었다");
});

test("대조군: 요약 워크플로에 같은 것을 도로 넣어도 잡힌다", () => {
  const mutated = summarizeYml.replace(/(\n {6}- name: 변경사항 커밋 및 푸시)/, "\n      - name: 테스트\n        run: npm test$1");
  assert.notEqual(mutated, summarizeYml);
  assert.ok(violations(mutated).some((v) => /시험/.test(v)));
});

test("어느 워크플로의 반영 문구도 「커밋·배포는 끝났다」 로 단정하지 않는다 (#510 cpo 조건 A) - 배포 여부는 deploy.yml 의 run 이 말한다", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = path.join(root, ".github/workflows");
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 10, "워크플로를 훑지 못했다");
  for (const f of files) {
    const text = code(await readFile(path.join(dir, f), "utf8"));
    assert.ok(!/커밋·배포는 끝났다/.test(text), `${f}: '커밋·배포는 끝났다' 문구가 남았다 - 그날 배포가 건너뛰어졌어도 이 문구가 나간다`);
  }
});
