import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonLines } from "../lib/canon.mjs";
import { compareBytes, compareDirs, formatReport, listFiles, treeHash } from "../lib/compare.mjs";
import { collectHookClasses, compareInvariants, formatInvariantsReport, hookListDrift, hookListFindings, readHookList, snapshotDir, snapshotHash } from "../lib/invariants.mjs";
import { RENDER_STAGES, preparePristine, readWorkflowStages, renderIsolated } from "../lib/render.mjs";

// 실제 저장소로 돌리는 측정(#236 완료 조건 1·2와 변이 시험의 시각 의존 확인). `npm run test:live`(GOLDEN_LIVE=1)에서만 돈다.
// 읽는 것: 저장소의 실제 docs/·raw/ — 그래서 `npm test`(고정 fixture만)와 갈랐고 CI에도 넣지 않는다(#8 재발 방지, R3).
//
// 환경변수
//   GOLDEN_REPO       저장소 경로(기본: 이 폴더의 두 단계 위)
//   GOLDEN_SHA        렌더할 커밋(기본 HEAD). 렌더는 `git archive`한 깨끗한 사본에서 돈다.
//   GOLDEN_BUILD_NOW  자기 비교에 고정해 줄 시각(기본 2026-10-11T00:00:00Z)
//   GOLDEN_BASE_SHA   (선택) BUILD_NOW 이전 코드의 커밋. 있으면 "미설정이면 바이트 동일"을 변경 전·후 코드로 시험한다.
const LIVE = process.env.GOLDEN_LIVE === "1";
const REPO = path.resolve(process.env.GOLDEN_REPO ?? path.join(import.meta.dirname, "../../.."));
const SHA = process.env.GOLDEN_SHA ?? "HEAD";
const NOW = process.env.GOLDEN_BUILD_NOW ?? "2026-10-11T00:00:00Z";
const BASE_SHA = process.env.GOLDEN_BASE_SHA ?? null;
const opts = { skip: LIVE ? false : "GOLDEN_LIVE=1(npm run test:live)에서만 돈다" };
const say = (...a) => console.log("GOLDEN-LIVE", ...a);

const git = (...a) => spawnSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).stdout.trim();

let pristine;
let basePristine;
async function getPristine() {
  pristine ??= await preparePristine({ repo: REPO, sha: SHA });
  return pristine;
}
// 정리는 모든 시험이 같은 방식으로 한다(#263): pristine.dispose(). SHA 캐시는 남고(개수 상한이 정리) --src 스냅숏이면 지워진다.
after(async () => {
  await pristine?.dispose();
  await basePristine?.dispose();
});
const dayAfter = (iso, n = 1) => new Date(Date.parse(iso) + n * 86400000).toISOString();

async function pair(env, { a = {}, b = {} } = {}) {
  const p = await getPristine();
  const [one, two] = [await renderIsolated(p, { env: { ...env, ...a } }), await renderIsolated(p, { env: { ...env, ...b } })];
  try {
    return { cmp: await compareDirs(one.docsDir, two.docsDir), bytes: await compareBytes(one.docsDir, two.docsDir), one, two, touched: [...one.touched, ...two.touched] };
  } finally {
    await Promise.all([one.dispose(), two.dispose()]);
  }
}

test("입력 기록: SHA와 raw/ 지문", opts, async () => {
  const full = git("rev-parse", SHA);
  say("HEAD", full, `(${git("log", "-1", "--format=%s", full)})`);
  say("raw tree", git("rev-parse", `${full}:raw`));
  say("raw/indicators/series.json blob", git("rev-parse", `${full}:raw/indicators/series.json`));
  say("docs/data tree", git("rev-parse", `${full}:docs/data`));
  say("node", process.version, "TZ(호출자)", process.env.TZ ?? "(미설정)");
  const htmlCount = (await listFiles(path.join(REPO, "docs"), (f) => f.endsWith(".html"))).length;
  say("find docs -name '*.html' | wc -l =", htmlCount);
  assert.equal(htmlCount, 67, "착수 때 센 장 수(이슈 본문 67)가 바뀌었다 — 이슈의 숫자를 다시 확인한다");
});

test("렌더 단계 목록이 daily-update.yml과 같다", opts, async () => {
  const fromWorkflow = await readWorkflowStages(path.join(REPO, ".github/workflows/daily-update.yml"));
  assert.deepEqual(RENDER_STAGES, fromWorkflow);
});

for (const tz of ["UTC", "Asia/Seoul"]) {
  test(`같은 SHA legacy 2회 자기 비교 diff 0 (TZ=${tz}, BUILD_NOW 고정)`, opts, async () => {
    const docsBefore = await treeHash(path.join(REPO, "docs"));
    const r = await pair({ TZ: tz, BUILD_NOW: NOW });
    say(`TZ=${tz} BUILD_NOW=${NOW}`, `정준 ${r.cmp.equal}/${r.cmp.total}장 일치`, `바이트 ${r.bytes.same}/${r.bytes.total}개 일치`, `렌더 ${Math.round(r.one.totalMs)}ms·${Math.round(r.two.totalMs)}ms`);
    assert.equal(r.cmp.failing.length, 0, formatReport(r.cmp));
    assert.equal(r.cmp.total, 67);
    assert.deepEqual(r.bytes.diffs, [], "정준뿐 아니라 바이트로도 같다");
    assert.deepEqual(r.touched.filter((f) => !f.startsWith("docs/")), [], "렌더가 docs/ 밖을 쓰지 않았다");
    assert.equal(await treeHash(path.join(REPO, "docs")), docsBefore, "저장소 작업 트리의 docs/는 렌더 전후로 같다");
  });
}

test("TZ가 달라도(UTC vs Asia/Seoul) 출력이 같다 — 시각 의존 지점 탐색", opts, async () => {
  const r = await pair({ BUILD_NOW: NOW }, { a: { TZ: "UTC" }, b: { TZ: "Asia/Seoul" } });
  say(`UTC vs Asia/Seoul: 정준 ${r.cmp.equal}/${r.cmp.total}장 일치, 바이트 ${r.bytes.same}/${r.bytes.total}`);
  assert.equal(r.cmp.failing.length, 0, formatReport(r.cmp));
  assert.deepEqual(r.bytes.diffs, []);
});

test("시각 의존 확인: BUILD_NOW를 하루 다르게 준 두 렌더는 정책대출 문장을 가진 장에서 1장 이상 낙제, 같은 값이면 0장", opts, async () => {
  // 정책대출 거래 수 문장(`policyShareSentence`, "…중개거래 N건(직거래 제외) 가운데 디딤돌 일반 선 아래는…")을 가진 장.
  // 2026-10-10 #66 이후 이 문장은 예산대 18장이 아니라 method.html 한 자리에만 있다(그 전에는 budget-3~9eok 7장에 있었다).
  const isPolicyLine = (l) => l.includes("중개거래") && l.includes("선 아래는");
  const policyPages = async (dir) => {
    const out = [];
    for (const f of await listFiles(dir, (n) => n.endsWith(".html"))) {
      if (canonLines(await readFile(path.join(dir, f), "utf8")).some(isPolicyLine)) out.push(f);
    }
    return out;
  };
  // 같은 값(대조군)
  const control = await pair({ TZ: "UTC", BUILD_NOW: NOW });
  say(`같은 값 ${NOW} 두 렌더: 낙제 ${control.cmp.failing.length}장`);
  assert.equal(control.cmp.failing.length, 0);

  // 하루 다른 쌍: 경계 거래가 없는 날은 0장일 수 있으므로 날짜 쌍을 하루씩 밀어 가며 1장 이상 나오는 쌍을 찾는다.
  const p = await getPristine();
  let found = null;
  const tried = [];
  for (let k = 0; k < 14 && !found; k++) {
    const d1 = dayAfter(NOW, k);
    const d2 = dayAfter(NOW, k + 1);
    const one = await renderIsolated(p, { env: { TZ: "UTC", BUILD_NOW: d1 } });
    const two = await renderIsolated(p, { env: { TZ: "UTC", BUILD_NOW: d2 } });
    try {
      const cmp = await compareDirs(one.docsDir, two.docsDir);
      const policy = await policyPages(one.docsDir);
      tried.push({ d1, d2, failing: cmp.failing.length });
      say(`쌍 ${d1} vs ${d2}: 낙제 ${cmp.failing.length}장 (정책대출 거래 수 문장을 가진 장 ${policy.length}장: ${policy.join(", ")})`);
      if (cmp.failing.length) found = { d1, d2, cmp, policy, inv: await compareInvariants(one.docsDir, two.docsDir) };
    } finally {
      await Promise.all([one.dispose(), two.dispose()]);
    }
  }
  assert.ok(found, `14쌍을 밀어 봤지만 낙제가 없다: ${JSON.stringify(tried)}`);
  const failNames = found.cmp.failing.map((f) => f.file);
  say(`낙제 ${failNames.length}장: ${failNames.join(", ")}`);
  say(formatReport(found.cmp, { maxHunks: 1, maxLines: 2 }).split("\n").slice(0, 8).join("\n"));
  assert.ok(failNames.every((f) => found.policy.includes(f)), "낙제한 장은 모두 정책대출 문장을 가진 장이다");
  const changed = found.cmp.failing.flatMap((f) => f.hunks.flatMap((h) => [...h.removed, ...h.added]));
  assert.ok(changed.length > 0 && changed.every(isPolicyLine), "달라진 줄은 전부 그 정책대출 거래 수 문장이다(다른 시각 의존이 없다)");
  // invariants(#274)도 같은 장을 본문 텍스트로 낙제시킨다 — BUILD_NOW가 다른 두 렌더는 디자인이 같아도 "다르다".
  // 그래서 기준과 후보는 같은 입력·같은 BUILD_NOW로 렌더해 견준다(bin/invariants.mjs --render).
  const invHard = found.inv.pages.filter((p) => p.status === "hard");
  say(`invariants: BUILD_NOW가 하루 다른 쌍에서 하드 ${invHard.length}장(${invHard.map((p) => p.file).join(", ")}), check ${[...new Set(invHard.flatMap((p) => p.findings.map((f) => f.id)))].join("·")}`);
  assert.deepEqual(invHard.map((p) => p.file), failNames, "정준 비교가 낙제시킨 장과 같다");
  assert.ok(invHard.every((p) => p.findings.every((f) => f.id === "text")), "달라진 것은 본문 텍스트뿐이다");
});

test("invariants(#274): 같은 SHA를 같은 BUILD_NOW로 두 번 렌더하면 diff 0, 커밋된 docs/는 자기 자신과 diff 0", opts, async () => {
  const p = await getPristine();
  const [one, two] = [await renderIsolated(p, { env: { BUILD_NOW: NOW } }), await renderIsolated(p, { env: { BUILD_NOW: NOW } })];
  try {
    const r = await compareInvariants(one.docsDir, two.docsDir);
    say(formatInvariantsReport(r).split("\n").slice(0, 7).join("\nGOLDEN-LIVE "));
    assert.equal(r.ok, true, formatInvariantsReport(r));
    assert.deepEqual([r.total, r.pass, r.soft, r.hard, r.site.length], [67, 67, 0, 0, 0], "하드도 소프트도 없다");
    assert.equal(r.noindexA.length, 6, "noindex 6장(이슈 본문)");
  } finally {
    await Promise.all([one.dispose(), two.dispose()]);
  }
  const committed = path.join(p.dir, "docs");
  const self = await compareInvariants(committed, committed);
  assert.deepEqual([self.ok, self.total, self.pass], [true, 67, 67]);
  say(`invariants 스냅숏(커밋된 docs/, ${p.label}) sha256`, snapshotHash(await snapshotDir(committed)));
});

test("invariants(#274): 실제 67장에 변이를 넣는다 — class만 바꾸면 통과, 숫자 한 자리·id 제거는 장마다 잡힌다", opts, async () => {
  const { cp, mkdtemp, readFile: read, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const p = await getPristine();
  const base = path.join(p.dir, "docs");
  const files = await listFiles(base, (f) => f.endsWith(".html"));
  const hooks = new Set((await readHookList()).all);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "golden-inv-live-"));
  // 인라인 script는 건드리지 않고(그 안의 class 문자열은 JS다) 태그의 속성만 바꾼다.
  const outsideScripts = (html, fn) => {
    const stash = [];
    return fn(html.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/g, (m) => `\u0000${stash.push(m) - 1}\u0000`)).replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  };
  const variants = {
    // 훅 class는 남기고 나머지 class를 갈아 끼운다 + style 값을 바꾼다.
    classOnly: (html) => outsideScripts(html, (h) => h.replace(/ class="([^"]*)"/g, (m, v) => ` class="${[...v.split(/\s+/).filter((c) => hooks.has(c)), "tw:flex", "tw:p-4"].join(" ")}"`).replace(/ style="[^"]*"/g, ' style="margin:0"')),
    // body의 첫 숫자 한 자리를 바꾼다(태그 밖 텍스트).
    digit: (html) => outsideScripts(html, (h) => h.replace(/(<body[\s\S]*?>[^<>]*?)(\d)(?=[^<>]*<)/, (m, pre, d) => `${pre}${(Number(d) + 1) % 10}`)),
    // body의 첫 id를 지운다.
    noId: (html) => outsideScripts(html, (h) => h.replace(/(<body[\s\S]*?) id="[^"]*"/, "$1")),
  };
  try {
    for (const [name, fn] of Object.entries(variants)) {
      const dir = path.join(tmp, name);
      await cp(base, dir, { recursive: true });
      let changed = 0;
      for (const f of files) {
        const html = await read(path.join(base, f), "utf8");
        const out = fn(html);
        if (out !== html) changed++;
        await writeFile(path.join(dir, f), out);
      }
      const r = await compareInvariants(base, dir);
      say(`변이 ${name}: 바뀐 장 ${changed}/67, 통과 ${r.pass}, 소프트 ${r.soft}, 하드 ${r.hard}`);
      assert.equal(changed, 67, `${name}: 67장 모두 변이가 들어갔다`);
      if (name === "classOnly") assert.deepEqual([r.ok, r.pass], [true, 67], formatInvariantsReport(r));
      else assert.equal(r.hard, 67, `${name}: 67장 모두 잡힌다\n${formatInvariantsReport(r, { maxItems: 2 }).split("\n").slice(0, 30).join("\n")}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("invariants(#274): 훅 클래스 목록이 렌더할 SHA의 소스와 맞는다", opts, async () => {
  const p = await getPristine();
  const collected = await collectHookClasses(p.dir);
  const drift = hookListDrift(await readHookList(), collected);
  say(`훅 클래스 목록 대 ${p.label}: 소스에만 ${drift.missing.length}, 목록에만 ${drift.stale.length}`);
  assert.deepEqual([drift.missing, drift.stale], [[], []]);
  // --render가 보고에 같이 내는 항목(#289 5번): 같은 소스끼리는 어긋남도 빠진 이름도 없다.
  assert.deepEqual(hookListFindings({ list: await readHookList(), base: collected, head: collected }), []);
});

test("invariants(#289): 실제 67장에 변이를 넣는다 — 숫자를 strong으로 감싸면 통과(소프트), 감싸며 한 자리 바꾸면·main을 del로 감싸면·on* 속성·style.css 삭제는 장마다 잡힌다", opts, async () => {
  const { cp, mkdtemp, readFile: read, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const p = await getPristine();
  const base = path.join(p.dir, "docs");
  const files = await listFiles(base, (f) => f.endsWith(".html"));
  const tmp = await mkdtemp(path.join(os.tmpdir(), "golden-inv-live-"));
  const outsideScripts = (html, fn) => {
    const stash = [];
    return fn(html.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/g, (m) => `\u0000${stash.push(m) - 1}\u0000`)).replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  };
  // body의 첫 숫자 한 자리(태그 밖 텍스트)를 고른다 — 위 digit 변이와 같은 자리다.
  const FIRST_DIGIT = /(<body[\s\S]*?>[^<>]*?)(\d)(?=[^<>]*<)/;
  const variants = {
    // 그 숫자를 <strong>으로 감싼다(텍스트 노드가 셋으로 잘린다) — 글자 흐름은 같다.
    wrap: { fn: (html) => outsideScripts(html, (h) => h.replace(FIRST_DIGIT, (m, pre, d) => `${pre}<strong class="tw:font-bold">${d}</strong>`)), expect: "soft", id: "text-wrap" },
    // 감싸면서 한 자리를 바꾼다.
    wrapDigit: { fn: (html) => outsideScripts(html, (h) => h.replace(FIRST_DIGIT, (m, pre, d) => `${pre}<strong>${(Number(d) + 1) % 10}</strong>`)), expect: "hard", id: "text" },
    // 감싸면서 래퍼 뒤에 공백 한 칸을 넣는다(67장 모두 그 숫자 뒤가 공백이 아닌 자리다 — 공백인 장이 생기면 줄어서 같아지고 아래 단언이 알린다).
    wrapSpace: { fn: (html) => outsideScripts(html, (h) => h.replace(FIRST_DIGIT, (m, pre, d) => `${pre}<strong>${d}</strong> `)), expect: "hard", id: "text" },
    // main을 바깥에서 <del>로 감싼다(뜻 있는 인라인이 블록을 감싼다 — 안쪽 블록 항목마다 [in:del]이 붙는다, PR #292 cto 보완).
    delOutside: { fn: (html) => outsideScripts(html, (h) => h.replace(/<main(?=[\s>])/, "<del><main").replace("</main>", "</main></del>")), expect: "hard", id: "text" },
    // body의 첫 id 달린 요소에 인라인 이벤트 핸들러를 건다.
    handler: { fn: (html) => outsideScripts(html, (h) => h.replace(/(<body[\s\S]*?) id="/, '$1 onclick="x()" id="')), expect: "hard", id: "s6-handlers" },
    // HTML은 그대로 두고 style.css만 지운다.
    noCss: { fn: (html) => html, remove: "style.css", expect: "hard", id: "resource-target", unchanged: true },
  };
  try {
    for (const [name, v] of Object.entries(variants)) {
      const dir = path.join(tmp, name);
      await cp(base, dir, { recursive: true });
      let changed = 0;
      for (const f of files) {
        const html = await read(path.join(base, f), "utf8");
        const out = v.fn(html);
        if (out !== html) changed++;
        await writeFile(path.join(dir, f), out);
      }
      if (v.remove) await rm(path.join(dir, v.remove));
      const r = await compareInvariants(base, dir);
      const withId = r.pages.filter((pg) => pg.findings.some((f) => f.id === v.id && f.level === v.expect)).length;
      say(`변이 ${name}: 바뀐 장 ${changed}/67, 통과 ${r.pass}, 소프트 ${r.soft}, 하드 ${r.hard}, <${v.id}> ${withId}장`);
      assert.equal(changed, v.unchanged ? 0 : 67, `${name}: 67장 모두 변이가 들어갔다`);
      const report = formatInvariantsReport(r, { maxItems: 2 }).split("\n").slice(0, 30).join("\n");
      if (v.expect === "soft") assert.deepEqual([r.ok, r.hard, r.soft, withId], [true, 0, 67, 67], `${name}: 67장 모두 하드 없이 소프트로 보고된다\n${report}`);
      else assert.deepEqual([r.hard, withId], [67, 67], `${name}: 67장 모두 <${v.id}>로 잡힌다\n${report}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("BUILD_NOW 미설정이면 현행 코드와 바이트 동일 (Date.now를 같은 값으로 모킹한 변경 전·후 비교)", { ...opts, skip: LIVE && BASE_SHA ? false : opts.skip || "GOLDEN_BASE_SHA가 없다" }, async () => {
  const mock = NOW;
  const base = (basePristine = await preparePristine({ repo: REPO, sha: BASE_SHA }));
  const head = await getPristine();
  say("변경 전", base.label, "변경 후", head.label, "Date.now 모킹", mock);
  const a = await renderIsolated(base, { mockNow: mock });
  const b = await renderIsolated(head, { mockNow: mock });
  const c = await renderIsolated(head, { env: { BUILD_NOW: mock } });
  try {
    const ab = await compareBytes(a.docsDir, b.docsDir);
    const ac = await compareBytes(a.docsDir, c.docsDir);
    say(`변경 전(모킹) vs 변경 후(BUILD_NOW 미설정, 모킹): 바이트 ${ab.same}/${ab.total}개 일치`);
    say(`변경 전(모킹) vs 변경 후(BUILD_NOW=모킹값): 바이트 ${ac.same}/${ac.total}개 일치`);
    assert.deepEqual(ab.diffs, []);
    assert.deepEqual(ac.diffs, []);
    assert.ok(ab.total >= 180);
  } finally {
    await Promise.all([a.dispose(), b.dispose(), c.dispose()]);
  }
});
