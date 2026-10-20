#!/usr/bin/env node
// 화면 동일 증빙을 한 번에 낸다(#276 완료 조건 9, 방법은 cto 판정 https://github.com/kyhsa93/jipgye/issues/276#issuecomment-6119194912).
// lib/style-equal.ts가 재는 함수들이고 이 파일은 그것을 순서대로 돌려 보고서를 쓰는 진입점이다.
//
//   node tools/render/bin/style-equal.ts --base <기준 docs> --head <후보 docs> --out <보고서 폴더> [옵션]
//
// 기준·후보 docs 폴더는 **같은 BUILD_NOW로 렌더해서** 만든다(완료 조건 9-A 1번). 저장소에 이미 그 도구가 있다:
//   node tools/golden/bin/render.ts --repo <저장소> --sha <SHA> --out <폴더> --env TZ=Asia/Seoul --env BUILD_NOW=<ISO>
// 두 폴더가 style.css 하나만 다른 것을 이 스크립트가 다시 확인한다(A-1). 다르면 A에서 멈추지 않고 적어 둔 뒤 계속 간다 —
// 무엇이 더 다른지 보는 것이 목적이지 멈추는 것이 목적이 아니다. 판정(종료 코드)은 맨 끝에 한 번 한다.
//
// 옵션
//   --scope full|reduced|representative
//                         C의 범위. full = 67장 × 4모드 × 2폭(+영어 2장 × 2폭) = 540조건,
//                         reduced = 대표 5장만 4모드 × 2폭이고 나머지 62장은 1모드(auto-light) × 2폭 = 168조건,
//                         representative = **대표 5장만** 4모드 × 2폭(+영어 2장 × 2폭) = 44조건.
//                         **전수가 아니면 보고서 머리에 그 사실이 찍힌다**(완료 조건 9-C, cto 요청 6147173489).
//   --pages a.html,b.html C가 볼 장을 직접 고른다(4모드 × 2폭). 고른 장 가운데 영어 대상이 있으면 영어 조건도 함께 돈다.
//                         `--scope representative`는 이 목록을 대표 5장으로 둔 것과 같다. 전수로 오해되지 않게
//                         보고서 머리에 "고른 장만"이 찍힌다.
//   --only A,B,C          일부만 돌린다(기본 A,B,C).
//   --control             대조군 한 번(C-5): 후보 CSS의 색 하나를 일부러 바꿔 이 비교가 실제로 잡는지 보인다.
//   --concurrency N       한 번에 여는 탭 수(기본 4). 올리면 빨라지지만 메모리를 쓴다.
//   --batch N             브라우저 하나로 도는 조건 수(기본 40). 넘으면 Chrome을 새로 띄운다 - 한 번 띄워 1,080장을
//                         돌리면 렌더러가 쌓이다 Chrome이 죽고, 그러면 CDP 소켓이 끊겨 남은 조건을 통째로 못 잰다.
//   --legacy <파일>       B-3·B-4가 읽을 원문(기본 src/css/legacy.css). 기준 style.css와 글자가 같아야 한다.
//   --fixed-now <ISO>     페이지 안의 시계를 묶는 시각(기본 2026-01-01T00:00:00Z). 기준과 후보에 같은 값이 간다.
//   --job-timeout N       한 번 재는 데 주는 밀리초(기본 90000). 넘기면 그 조건을 "못 쟀다"로 적고 다음으로 간다 -
//                         한 장이 멈추면 540개가 통째로 서는 것을 실제로 한 번 겪었다. 못 쟌 조건이 있으면 판정은 실패다.
//
// 종료 코드: 0 = 전부 0(차이 없음), 1 = 차이가 있다(보고서에 전부 적힌다), 2 = 쓰는 법이 틀렸다.
//
// 못 보는 것은 lib/style-equal.ts 머리와 PR 본문 "이 방법이 못 덮는 것"에 적는다.
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchChrome } from "../lib/chrome.ts";
import { serveDir } from "../lib/serve.ts";
import {
  buildRewrites,
  collect,
  compareCollected,
  compareCssom,
  ENGLISH_PAGES,
  explain,
  fileDiff,
  MODES,
  premises,
  readCssom,
  REPRESENTATIVE,
  sha256,
  sourceFate,
  WIDTHS,
} from "../lib/style-equal.ts";
import { flattenCss } from "../../../test/helpers/css-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const ctlWrongType: number = "문자열";

// ── 인자 ────────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt: Record<string, any> = { scope: "full", only: "A,B,C", concurrency: "4", "fixed-now": "2026-01-01T00:00:00Z", "job-timeout": "90000" };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === "--control") opt.control = true;
  else if (k.startsWith("--")) opt[k.slice(2)] = argv[++i];
  else {
    console.error(`모르는 인자: ${k}`);
    process.exit(2);
  }
}
if (!opt.base || !opt.head || !opt.out) {
  console.error("사용: node tools/render/bin/style-equal.ts --base <기준 docs> --head <후보 docs> --out <폴더> [--scope full|reduced|representative] [--pages a.html,b.html] [--only A,B,C] [--control] [--concurrency N]");
  process.exit(2);
}
if (!["full", "reduced", "representative"].includes(opt.scope)) {
  console.error(`--scope는 full·reduced·representative 가운데 하나입니다(받은 값: ${opt.scope}).`);
  process.exit(2);
}
if (opt.pages && opt.scope !== "full") {
  console.error(`--pages와 --scope ${opt.scope}는 같이 쓸 수 없습니다. 장을 직접 고를 때는 --scope를 생략하세요.`);
  process.exit(2);
}
const only = new Set(opt.only.split(",").map((s) => s.trim().toUpperCase()));
const baseDir = path.resolve(opt.base);
const headDir = path.resolve(opt.head);
const outDir = path.resolve(opt.out);
const legacyFile = path.resolve(opt.legacy ?? path.join(repoRoot, "src/css/legacy.css"));
const concurrency = Math.max(1, Number(opt.concurrency) || 4);
const jobTimeout = Math.max(1000, Number(opt["job-timeout"]) || 90000);
/** 재는 일 하나에 시간 제한을 건다. 넘긴 것은 던져서 부르는 쪽이 "못 쟀다"로 적게 한다(조용히 0으로 세지 않는다). */
const withTimeout = (promise, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${label}: ${jobTimeout}ms 안에 끝나지 않았습니다`)), jobTimeout)))]).finally(() => clearTimeout(timer));
};
/** 차이가 났을 때 값을 펼쳐 볼 요소 수의 상한. 넘으면 앞에서부터 이만큼만 펼치고 "잘랐다"고 적는다. */
const DETAIL_CAP = 60;
const fixedNow = Date.parse(opt["fixed-now"]);
if (!Number.isFinite(fixedNow)) {
  console.error(`--fixed-now를 읽지 못했습니다: ${opt["fixed-now"]}`);
  process.exit(2);
}

// Chrome이 죽는 순간 CDP가 기다리던 요청이 한꺼번에 거절되는데, 그 가운데 아무도 await하지 않는 것이 섞여 프로세스를 죽인다.
// 여기서 받아 적고 계속 간다 - 실제로 못 잰 조건은 아래 재시도가 다시 잡고, 끝내 못 잰 것은 보고서에 "못 쟀다"로 남는다.
process.on("unhandledRejection", (e: any) => console.error(`(이어서 감) 처리되지 않은 거절: ${e?.message ?? e}`));

await mkdir(outDir, { recursive: true });
const report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  machine: { node: process.version, platform: `${process.platform}-${process.arch}` },
  input: { base: baseDir, head: headDir, legacy: legacyFile, scope: opt.scope, fixedNow: opt["fixed-now"], concurrency },
  // 범위를 줄였으면 여기서부터 보인다 - 보고서를 읽는 사람이 "전수"로 오해하지 않게 머리에 둔다.
  reduced: opt.scope === "reduced",
  // 전수가 아닌 모든 꼴(축소형·대표만·고른 장만)이 여기 한 줄로 찍힌다. coverage.full이 false면 전수가 아니다.
  coverage: null,
};
const log = (...a) => console.error(...a);
const section = (name) => log(`\n── ${name} ${"─".repeat(Math.max(0, 70 - name.length))}`);

// ── 공통 입력 ───────────────────────────────────────────────────────────────────────────────

const allPages = (await readdir(headDir)).filter((f) => f.endsWith(".html")).sort();
// C가 볼 장. --pages로 고르거나 --scope representative면 그 목록이고, 아니면 전부다.
// 고른 이름이 후보 docs에 없으면 조용히 빠지지 않고 여기서 멈춘다 - "0장을 돌고 통과"가 가장 나쁜 결과다.
const chosen = opt.pages ? opt.pages.split(",").map((s) => s.trim()).filter(Boolean) : opt.scope === "representative" ? [...REPRESENTATIVE] : null;
if (chosen) {
  const missing = chosen.filter((p) => !allPages.includes(p));
  if (missing.length) {
    console.error(`후보 docs에 없는 장입니다: ${missing.join(", ")}`);
    process.exit(2);
  }
}
const pages = chosen ? allPages.filter((p) => chosen.includes(p)) : allPages;
report.coverage = opt.pages
  ? { full: false, label: "고른 장만", note: `C는 고른 ${pages.length}장만 본다(4모드 × 2폭). 나머지 ${allPages.length - pages.length}장은 C가 보지 않는다.` }
  : opt.scope === "representative"
    ? { full: false, label: "대표만", note: `C는 대표 ${pages.length}장만 본다(4모드 × 2폭, 영어 조건 포함). 나머지 ${allPages.length - pages.length}장은 C가 보지 않는다.` }
    : opt.scope === "reduced"
      ? { full: false, label: "줄임", note: `C는 축소형이다 - 대표 5장만 4모드 × 2폭이고 나머지 ${allPages.length - REPRESENTATIVE.filter((p) => allPages.includes(p)).length}장은 1모드(auto-light) × 2폭이다.` }
      : { full: true, label: "전수", note: `C는 ${allPages.length}장 전부를 4모드 × 2폭으로 본다.` };
report.input.pages = { all: allPages.length, chosen: pages.length };
const legacyText = await readFile(legacyFile, "utf8");
const baseCssText = await readFile(path.join(baseDir, "style.css"), "utf8");
const headCssText = await readFile(path.join(headDir, "style.css"), "utf8");
report.input.bytes = { baseCss: Buffer.byteLength(baseCssText), headCss: Buffer.byteLength(headCssText), legacy: Buffer.byteLength(legacyText) };
report.input.sha256 = { baseCss: sha256(baseCssText), headCss: sha256(headCssText), legacy: sha256(legacyText) };
// 기준 style.css와 legacy.css가 글자로 같아야 B-3·B-4의 "원문"이 기준과 같은 것을 가리킨다(범위 1의 "글자 그대로 옮긴다").
report.input.legacyEqualsBaseCss = legacyText === baseCssText;

// C가 견줄 사용자 정의 속성 이름. 계산된 스타일 목록에 --* 가 안 나오는 브라우저가 있어 원문이 선언한 이름을 따로 읽힌다.
const customNames = [...new Set((legacyText.match(/--[\w-]+(?=\s*:)/g) ?? []))].sort();
report.input.customProps = customNames.length;

// ── A. 전제 ─────────────────────────────────────────────────────────────────────────────────

if (only.has("A")) {
  section("A. 전제 확인");
  const files = await fileDiff(baseDir, headDir);
  const [pb, ph] = [await premises(baseDir), await premises(headDir)];
  report.A = { files, base: pb, head: ph };
  log(`A-1 파일: 전체 ${files.total}, 같음 ${files.same}, 다름 ${files.differ.length} [${files.differ.join(", ")}], 기준에만 ${files.onlyBase.length}, 후보에만 ${files.onlyHead.length}`);
  log(`A-2 기준: 장 ${pb.pages}, 스타일시트 link 분포 ${JSON.stringify(pb.linkCounts)}, <style> ${pb.styleBlocks}, style 속성 ${pb.styleAttrs}, getComputedStyle 호출 ${pb.jsComputedStyle}`);
  log(`A-2 기준 CSS: !important ${pb.css.important}, revert-layer ${pb.css.revertLayer}, revert ${pb.css.revert}, @import ${pb.css.import}, @font-face ${pb.css.fontFace}, @keyframes ${pb.css.keyframes}, @supports ${pb.css.supports}, @property ${pb.css.property}, -webkit- ${pb.css.webkit}, :hover ${pb.css.hover}, :focus-visible ${pb.css.focusVisible}, @media print ${pb.css.mediaPrint}, forced-colors ${pb.css.forcedColors}, prefers-contrast ${pb.css.prefersContrast}`);
  log(`A-2 후보 CSS: !important ${ph.css.important}, revert-layer ${ph.css.revertLayer}, revert ${ph.css.revert}, @import ${ph.css.import}, @font-face ${ph.css.fontFace}, @keyframes ${ph.css.keyframes}, @supports ${ph.css.supports}, @property ${ph.css.property}, -webkit- ${ph.css.webkit}, :hover ${ph.css.hover}, :focus-visible ${ph.css.focusVisible}, @media print ${ph.css.mediaPrint}, forced-colors ${ph.css.forcedColors}, prefers-contrast ${ph.css.prefersContrast}`);
  // A-3은 CSSOM으로 읽은 뒤(B)에 확정한다. 글자로 먼저 한 번 세어 둔다 - 파서 둘이 같은 답을 내는지가 그 자체로 점검이다.
  const flatHead = flattenCss(headCssText).rules;
  const outsideText = flatHead.filter((r) => r.at[0] !== "@layer components");
  report.A.outsideByText = { total: flatHead.length, inLayer: flatHead.length - outsideText.length, outside: outsideText.map((r) => `${r.at.join(" > ")}${r.at.length ? " > " : ""}${r.selector}`) };
  log(`A-3(글자 파서) 후보 규칙 ${flatHead.length}개 중 @layer components 밖 ${outsideText.length}개${outsideText.length ? `: ${report.A.outsideByText.outside.join(" | ")}` : ""}`);
}

// ── 브라우저와 서버 ─────────────────────────────────────────────────────────────────────────

const needBrowser = only.has("B") || only.has("C");
let baseSrv = null;
let headSrv = null;
let controlDir = null;
let controlSrv = null;

// 브라우저는 **묶음마다 새로 띄운다**. 한 번 띄워 1,080장을 돌리면 렌더러가 쌓이다 Chrome이 죽고, 죽으면 CDP 소켓이 끊겨
// 남은 조건이 전부 "못 쟀다"가 된다(한 번 겪었다 — 그때는 조용히 서기까지 했다). 띄우는 데 0.3초면 되니 묶음마다 새로 띄우는 쪽이 싸다.
const batchSize = Math.max(1, Number(opt.batch) || 40);
async function withChrome(fn) {
  const chrome = await launchChrome();
  report.machine.chrome ??= chrome.version;
  try {
    return await fn(chrome);
  } finally {
    await chrome.close();
  }
}

try {
  if (needBrowser) {
    baseSrv = await serveDir(baseDir);
    headSrv = await serveDir(headDir);
  }

  // ── B. 규칙 단위 동일 ─────────────────────────────────────────────────────────────────────

  if (only.has("B")) {
    section("B. CSSOM 규칙 단위 동일");
    const sourceRules = flattenCss(legacyText).rules;
    // 기준 쪽에서 원문 판독(sourceProbe)도 같이 받는다 - B-3이 "원문에 있는데 CSSOM에 없는 선언"을 가리키기 때문이다.
    const { b, h } = await withChrome(async (chrome) => ({
      b: await readCssom(chrome, baseSrv.url, { page: "rates.html", sourceRules }),
      h: await readCssom(chrome, headSrv.url, { page: "rates.html" }),
    }));
    log(`\nChrome: ${report.machine.chrome} / Node ${process.version} / ${process.platform}-${process.arch}`);
    const cmp = compareCssom(b.cssom, h.cssom);
    const fate = sourceFate(sourceRules, b.source, b.cssom.rules);
    const rew = buildRewrites(legacyText, headCssText);
    report.B = {
      sheetCount: { base: b.cssom.sheetCount, head: h.cssom.sheetCount },
      compare: cmp,
      sourceFate: { aligned: fate.aligned, kept: fate.kept, droppedRules: fate.droppedRules, dropped: fate.dropped, shadowed: fate.shadowed },
      rewrites: rew,
    };
    log(`B-1·2 규칙: 기준 ${cmp.base.rules}개/선언 ${cmp.base.decls}개, 후보(@layer components 속) ${cmp.head.rules}개/선언 ${cmp.head.decls}개 → 차이 ${cmp.diffs}개`);
    if (cmp.firstDiff) log(`      처음 다른 자리 #${cmp.firstDiff.index}\n        기준: ${cmp.firstDiff.base}\n        후보: ${cmp.firstDiff.head}`);
    log(`B-1 층 분포: ${JSON.stringify(cmp.layers)} / 층 선언문: 기준 ${cmp.base.statements.length}개, 후보 ${cmp.head.statements.length}개 [${cmp.head.statements.join(" | ")}]`);
    log(`A-3(CSSOM) @layer components 밖 규칙 ${cmp.outside.length}개${cmp.outside.length ? `:\n  - ${cmp.outside.join("\n  - ")}` : " (요소에 닿는 선택자 0개)"}`);
    log(`B-3 원문 선언의 운명: 그대로 ${fate.kept}개, 브라우저가 버린 것 ${fate.dropped.length}개, 같은 블록에서 덮인 것 ${fate.shadowed.length}개, 규칙째 못 읽은 것 ${fate.droppedRules.length}개 (짝 맞음 ${fate.aligned})`);
    for (const d of fate.dropped) log(`      버림: ${d}`);
    for (const d of fate.droppedRules) log(`      규칙째 버림: ${d}`);
    log(`B-4 빌드가 고쳐 쓴 것: 규칙 ${rew.rules}개·선언 ${rew.decls}개 중 줄이 다른 규칙 ${rew.rewritten.length}개, 공백만 다른 토막 ${rew.whitespaceOnly.length}개, 지운 주석 ${rew.commentsRemoved}블록, 바이트 ${rew.bytes.source} → ${rew.bytes.built}`);
    for (const r of rew.rewritten.slice(0, 20)) log(`      #${r.index}\n        원문: ${r.source}\n        산출: ${r.built}`);
    if (rew.rewritten.length > 20) log(`      … 나머지 ${rew.rewritten.length - 20}개는 보고서 파일에 있다`);
  }

  // ── C. 계산된 스타일과 상자 ───────────────────────────────────────────────────────────────

  if (only.has("C")) {
    section(`C. 계산된 스타일·상자 (${report.coverage.label})`);
    const jobs = [];
    const rest = pages.filter((p) => !REPRESENTATIVE.includes(p));
    const reducedModes = opt.scope === "reduced";
    for (const page of pages) {
      // 축소형이면 대표 5장만 4모드이고 나머지는 auto-light 하나다(완료 조건 9-C가 적은 하한).
      // 장을 고른 꼴(--pages·representative)은 고른 장을 4모드로 본다 - 장을 줄인 것이지 모드를 줄인 것이 아니다.
      const modes = !reducedModes || REPRESENTATIVE.includes(page) ? MODES : [MODES[0]];
      for (const mode of modes) for (const width of WIDTHS) jobs.push({ page, mode, width, lang: null });
    }
    for (const page of ENGLISH_PAGES.filter((p) => pages.includes(p))) for (const width of WIDTHS) jobs.push({ page, mode: MODES[0], width, lang: "en" });
    report.C = { scope: opt.scope, coverage: report.coverage.label, pages: pages.length, pagesAll: allPages.length, pageList: chosen ? pages : null, representative: REPRESENTATIVE.filter((p) => pages.includes(p)), restPages: rest.length, jobs: jobs.length, renders: jobs.length * 2, results: [], totals: {} };
    log(`${report.coverage.note}`);
    log(`장 ${pages.length}개 → 조건 ${jobs.length}개(기준·후보 두 번이라 렌더 ${jobs.length * 2}회), 탭 ${concurrency}개 동시`);

    const copts = { customNames, fixedNow };
    let done = 0;
    let diffJobs = 0;
    let elements = 0;
    let values = 0;
    // (나) 견준 `이름:값` 쌍의 수를 기준·후보에서 따로 더한다. 둘이 같아야 "값을 하나도 빼지 않고 견뒀다"가 성립한다.
    let pairsBase = 0;
    let pairsHead = 0;
    let diffs = 0;
    let unsettled = 0;
    const t0 = Date.now();
    let failed = 0;
    const runJob = async (chrome, job) => {
      const label = `${job.page} ${job.mode.name} ${job.width}${job.lang ? ` ${job.lang}` : ""}`;
      let a;
      let b;
      try {
        a = await withTimeout(collect(chrome, baseSrv.url, job, copts), `기준 ${label}`);
        b = await withTimeout(collect(chrome, headSrv.url, job, copts), `후보 ${label}`);
      } catch (e) {
        // 다시 잴 수 있게 실패를 돌려준다. 여기서 보고서에 적어 버리면 재시도가 성공해도 "못 쟀다"가 남는다.
        job.lastError = e.message;
        return false;
      }
      const c = compareCollected(a, b);
      const row: Record<string, any> = { page: job.page, mode: job.mode.name, width: job.width, lang: job.lang, elements: c.elements, values: c.values, pairs: c.pairs, customNamesRead: c.customNamesRead, diffs: c.diffs, domMismatch: c.domMismatch, settled: a.settled && b.settled, blocked: { base: a.blocked, head: b.blocked } };
      if (c.diffs) {
        // 해시가 다른 자리만 값을 다시 읽는다 - 장마다 수백만 값이라 처음부터 값을 옮기면 느리다.
        // 한 번에 펼치는 요소 수를 DETAIL_CAP으로 막는다: 전부 펼치면 evaluate가 수십 MB를 돌려주다 Chrome이 죽는다(실측).
        // 잘랐으면 그 사실을 행에 적는다 - 차이가 0이 아닌 PR은 어차피 병합하지 않으므로 전부 펼칠 필요가 없다.
        const all = [...new Set(c.items.filter((i) => i.index >= 0).map((i) => i.index))];
        const idx = all.slice(0, DETAIL_CAP);
        row.detailCapped = all.length > idx.length ? { shown: idx.length, total: all.length } : null;
        const [da, db] = idx.length ? [await collect(chrome, baseSrv.url, job, { ...copts, detail: idx }), await collect(chrome, headSrv.url, job, { ...copts, detail: idx })] : [a, b];
        row.detail = explain(c.items.filter((i) => i.index < 0 || idx.includes(i.index)), da, db);
      }
      report.C.results.push(row);
      measured.add(job.id);
      elements += c.elements;
      values += c.values;
      pairsBase += c.pairs.base;
      pairsHead += c.pairs.head;
      diffs += c.diffs;
      if (c.diffs) diffJobs++;
      if (!row.settled) unsettled++;
      done++;
      if (done % 5 === 0 || c.diffs || !row.settled) log(`  ${done}/${jobs.length} ${label} 요소 ${c.elements} 값 ${c.values} 차이 ${c.diffs}${row.settled ? "" : " (조용해지지 않음)"}`);
      if (c.diffs) for (const d of row.detail.slice(0, 10)) log(`      ${d.path} ${d.what} ${d.prop}: 기준 ${d.base} / 후보 ${d.head}`);
      return true;
    };
    // 묶음(batchSize)마다 브라우저를 새로 띄우고, 그 안에서 탭을 concurrency개씩 돌린다.
    // 같은 브라우저의 다른 컨텍스트라 저장소(localStorage·SW)는 섞이지 않는다.
    // 브라우저가 죽으면(CDP 소켓이 끊기면) 그 묶음의 남은 조건이 통째로 실패하므로 **못 쟌 조건만 모아 다시 잰다**.
    // 재시도마다 묶음을 반으로 줄이고 마지막 판에는 탭 하나로 돈다 - 끝까지 못 잰 것은 "덮이지 않은 자리"로 보고서에 남는다.
    jobs.forEach((j, i) => (j.id = i));
    const measured = new Set();
    let remaining = jobs.slice();
    for (let pass = 1; remaining.length && pass <= 4; pass++) {
      const size = Math.max(1, Math.round(batchSize / 2 ** (pass - 1)));
      const tabs = pass >= 4 ? 1 : concurrency;
      if (pass > 1) log(`  ${pass}차: 못 쟌 ${remaining.length}개를 묶음 ${size}·탭 ${tabs}로 다시 잰다 (마지막 오류: ${remaining[0].lastError})`);
      const retry = [];
      for (let at = 0; at < remaining.length; at += size) {
        const queue = remaining.slice(at, at + size);
        const mine = queue.slice();
        try {
          await withChrome(async (chrome) => {
            await Promise.all(Array.from({ length: tabs }, async () => {
              for (let job = queue.shift(); job; job = queue.shift()) if (!(await runJob(chrome, job))) retry.push(job);
            }));
          });
        } catch (e) {
          // 브라우저를 띄우지도 못했거나 통째로 죽었다. 아직 손대지 않은 것까지 다음 판으로 넘긴다.
          const untouched = mine.filter((j) => !retry.includes(j) && !measured.has(j.id));
          for (const j of untouched) j.lastError = e.message;
          retry.push(...untouched);
          log(`  묶음이 통째로 죽었다(${e.message}) - ${untouched.length}개를 다음 판으로`);
        }
      }
      remaining = retry;
    }
    for (const job of remaining) {
      failed++;
      report.C.results.push({ page: job.page, mode: job.mode.name, width: job.width, lang: job.lang, error: job.lastError ?? "알 수 없음" });
      log(`  **끝내 못 쟀다**: ${job.page} ${job.mode.name} ${job.width}${job.lang ? ` ${job.lang}` : ""} — ${job.lastError}`);
    }
    report.C.results.sort((x, y) => (x.page === y.page ? (x.mode === y.mode ? x.width - y.width : x.mode < y.mode ? -1 : 1) : x.page < y.page ? -1 : 1));
    report.C.totals = { jobs: jobs.length, diffJobs, elements, values, pairsBase, pairsHead, customProps: customNames.length, diffs, unsettled, failed, seconds: Math.round((Date.now() - t0) / 1000) };
    log(`C 합계: 조건 ${jobs.length}개, 견준 요소 ${elements}개, 값 ${values}개, **차이 ${diffs}개**(차이 난 조건 ${diffJobs}개), 조용해지지 않은 조건 ${unsettled}개, 못 잰 조건 ${failed}개, ${report.C.totals.seconds}초`);
    // cto 개정 1(https://github.com/kyhsa93/jipgye/issues/276#issuecomment-6147173489): 열거 순서에만 면제를 주는 대가로 셋을 요건으로 둔다.
    log(`C 정렬 면제의 요건 셋: (가) 이름으로 정렬한 뒤 쌍을 전부 해시에 넣었다(값 누락 0 — 값이 다르면 해시가 다르다), ` +
      `(나) 견준 쌍 기준 ${pairsBase}개 / 후보 ${pairsHead}개 → ${pairsBase === pairsHead ? "같다" : "**다르다(차이다)**"}, ` +
      `(다) 원문이 선언한 사용자 정의 속성 ${customNames.length}개를 기준·후보에 같은 목록으로 읽혔다`);
  }

  // ── C-5. 대조군 ───────────────────────────────────────────────────────────────────────────

  // 대조군이 엎어져도 A·B·C의 보고서는 써야 한다 - 한 번 여기서 죽어 540조건을 다시 돌렸다.
  if (opt.control && needBrowser) try {
    section("C-5. 대조군(일부러 색 하나를 바꾼다)");
    controlDir = path.join(outDir, "control-docs");
    await cp(headDir, controlDir, { recursive: true });
    const css = await readFile(path.join(controlDir, "style.css"), "utf8");
    // 바꾸는 것은 딱 한 자리다. **처음 나오는 색 토큰 선언**을 고른다 - 토큰 이름을 코드에 박으면 이름이 바뀌는 날
    // 대조군이 조용히 사라진다(실제로 `--text`를 찾다 못 찾아 한 번 죽었다. 이 저장소의 본문 색은 `--fg`다).
    // 여러 요소가 물려 있는 토큰이라 비교가 못 잡으면 바로 보인다.
    const m = css.match(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/);
    if (!m) throw new Error("대조군으로 바꿀 색 토큰(--이름: #색;)을 후보 CSS에서 찾지 못했습니다.");
    const mutated = css.replace(m[0], `${m[1]}: #ff0000;`);
    await writeFile(path.join(controlDir, "style.css"), mutated);
    controlSrv = await serveDir(controlDir);
    const job = { page: REPRESENTATIVE[0], mode: MODES[0], width: WIDTHS[1], lang: null };
    const copts = { customNames, fixedNow };
    const { c, detail } = await withChrome(async (chrome) => {
      const a = await collect(chrome, baseSrv.url, job, copts);
      const b = await collect(chrome, controlSrv.url, job, copts);
      const c2 = compareCollected(a, b);
      const idx = [...new Set(c2.items.filter((i) => i.index >= 0).map((i) => i.index))].slice(0, 50);
      const [da, db] = [await collect(chrome, baseSrv.url, job, { ...copts, detail: idx }), await collect(chrome, controlSrv.url, job, { ...copts, detail: idx })];
      return { c: c2, detail: explain(c2.items.filter((i) => idx.includes(i.index)), da, db) };
    });
    report.control = { changed: `${m[0].trim()} → ${m[1]}: #ff0000;`, job: { page: job.page, mode: job.mode.name, width: job.width }, elements: c.elements, values: c.values, diffs: c.diffs, sample: detail.slice(0, 12) };
    log(`바꾼 것: ${report.control.changed}`);
    log(`${job.page} ${job.mode.name} ${job.width}: 요소 ${c.elements}, 값 ${c.values}, **차이 ${c.diffs}개** (0이면 이 비교는 쓸 수 없다)`);
    for (const d of detail.slice(0, 12)) log(`      ${d.path} ${d.what} ${d.prop}: 기준 ${d.base} / 대조군 ${d.head}`);
  } catch (e) {
    report.control = { error: e.message };
    log(`대조군을 돌리지 못했다: ${e.message}`);
  }
} finally {
  await controlSrv?.close();
  await baseSrv?.close();
  await headSrv?.close();
}

// ── 판정과 보고서 ───────────────────────────────────────────────────────────────────────────

const failures = [];
if (report.A) {
  if (report.A.files.differ.join() !== "style.css" || report.A.files.onlyBase.length || report.A.files.onlyHead.length) failures.push(`A-1: 다른 파일이 style.css 하나가 아니다(${report.A.files.differ.join(", ")})`);
  if (Object.keys(report.A.head.linkCounts).join() !== "1") failures.push(`A-2: 장마다 스타일시트가 하나가 아니다(${JSON.stringify(report.A.head.linkCounts)})`);
  if (report.A.head.styleBlocks !== 0) failures.push(`A-2: <style> 블록이 ${report.A.head.styleBlocks}장 있다`);
}
if (report.B) {
  if (report.B.compare.diffs !== 0) failures.push(`B-2: CSSOM 규칙이 ${report.B.compare.diffs}자리 다르다`);
  if (report.B.compare.outside.length !== 0) failures.push(`A-3: @layer components 밖에 요소에 닿는 규칙이 ${report.B.compare.outside.length}개 있다`);
  if (!report.B.sourceFate.aligned) failures.push("B-3: 원문과 CSSOM의 규칙 짝이 맞지 않는다");
}
if (report.C) {
  if (report.C.totals.diffs !== 0) failures.push(`C: 계산된 스타일·상자에 차이 ${report.C.totals.diffs}개`);
  if (report.C.totals.unsettled !== 0) failures.push(`C: 조용해지지 않은 조건 ${report.C.totals.unsettled}개(값을 믿을 수 없다)`);
  if (report.C.totals.failed !== 0) failures.push(`C: 못 잰 조건 ${report.C.totals.failed}개(시간 제한을 넘겼다 — 덮이지 않은 자리다)`);
  // (나) 쌍의 개수가 다르면 그 자체가 차이다. 조건마다도 보지만(compareCollected) 합계로 한 번 더 막는다.
  if (report.C.totals.pairsBase !== report.C.totals.pairsHead) failures.push(`C: 견준 쌍의 수가 기준 ${report.C.totals.pairsBase} / 후보 ${report.C.totals.pairsHead}로 다르다`);
  if (report.C.totals.customProps === 0) failures.push("C: 원문이 선언한 사용자 정의 속성을 하나도 읽히지 못했다(다 요건)");
}
if (opt.control && report.control?.error) failures.push(`C-5: 대조군을 돌리지 못했다 — ${report.control.error}`);
if (opt.control && report.control && report.control.diffs === 0) failures.push("C-5: 대조군을 잡지 못했다 — 이 비교는 증빙이 되지 않는다");
report.finishedAt = new Date().toISOString();
report.failures = failures;
report.ok = failures.length === 0;

await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
await writeFile(path.join(outDir, "summary.md"), summaryMarkdown(report));
section("판정");
log(`보고서: ${path.join(outDir, "report.json")} / ${path.join(outDir, "summary.md")}`);
if (!report.coverage.full) log(`**전수가 아니다 — C 범위: ${report.coverage.label}.** ${report.coverage.note}`);
log(failures.length ? `실패 ${failures.length}건:\n  - ${failures.join("\n  - ")}` : "전부 0 — 차이 없음.");
process.exit(failures.length ? 1 : 0);

/** PR 본문에 그대로 붙일 수 있는 요약. 숫자는 전부 위에서 센 것이다. */
function summaryMarkdown(r) {
  const L = [];
  L.push(`# 화면 동일 증빙 (#276 완료 조건 9)`, "");
  L.push(`- 잰 때: ${r.startedAt} → ${r.finishedAt}`);
  L.push(`- 머신: ${r.machine.platform}, Node ${r.machine.node}${r.machine.chrome ? `, ${r.machine.chrome}` : ""}`);
  L.push(`- 기준 docs: \`${r.input.base}\` / 후보 docs: \`${r.input.head}\``);
  L.push(`- style.css SHA-256: 기준 \`${r.input.sha256.baseCss}\` (${r.input.bytes.baseCss}바이트) / 후보 \`${r.input.sha256.headCss}\` (${r.input.bytes.headCss}바이트)`);
  L.push(`- 원문 \`legacy.css\` ${r.input.bytes.legacy}바이트, 기준 style.css와 글자 동일: **${r.input.legacyEqualsBaseCss}**`);
  // 전수가 아니면 머리에서 바로 보이게 한다 - "줄임"도 "대표만"도 같은 자리에 같은 꼴로 찍는다(cto 요청 6147173489).
  if (!r.coverage.full) L.push("", `> **전수가 아니다 — C 범위: ${r.coverage.label}.** ${r.coverage.note}`);
  if (r.A) {
    L.push("", "## A. 전제", "");
    L.push(`- A-1 \`diff -rq\`: 파일 ${r.A.files.total}개 중 같음 ${r.A.files.same}, 다름 ${r.A.files.differ.length}(\`${r.A.files.differ.join("`, `") || "없음"}\`), 한쪽에만 있는 파일 ${r.A.files.onlyBase.length + r.A.files.onlyHead.length}개`);
    L.push(`- A-2 장 ${r.A.head.pages}개, 스타일시트 \`<link>\` 분포 ${JSON.stringify(r.A.head.linkCounts)}, \`<style>\` ${r.A.head.styleBlocks}장, \`style=""\` ${r.A.head.styleAttrs}곳, JS의 \`getComputedStyle\`/\`getPropertyValue\` ${r.A.head.jsComputedStyle}곳`);
    const c2 = (k) => `기준 ${r.A.base.css[k]} / 후보 ${r.A.head.css[k]}`;
    L.push(`- A-2 CSS 원문: \`!important\` ${c2("important")}, \`revert-layer\` ${c2("revertLayer")}, \`revert\` ${c2("revert")}, \`@import\` ${c2("import")}, \`@font-face\` ${c2("fontFace")}, \`@keyframes\` ${c2("keyframes")}, \`@supports\` ${c2("supports")}, \`@property\` ${c2("property")}, \`-webkit-\` ${c2("webkit")}, \`:hover\` ${c2("hover")}, \`:focus-visible\` ${c2("focusVisible")}, \`@media print\` ${c2("mediaPrint")}, \`forced-colors\` ${c2("forcedColors")}, \`prefers-contrast\` ${c2("prefersContrast")}`);
    L.push(`- A-3(글자 파서) 후보 규칙 ${r.A.outsideByText.total}개 = \`@layer components\` 안 ${r.A.outsideByText.inLayer} + 밖 ${r.A.outsideByText.outside.length}${r.A.outsideByText.outside.length ? `\n  - ${r.A.outsideByText.outside.join("\n  - ")}` : ""}`);
  }
  if (r.B) {
    L.push("", "## B. CSSOM 규칙 단위", "");
    // 개정 2(cto 6147173489): 같은 CSS의 "선언 수"가 자에 따라 둘 나온다. 어느 자로 쟀는지 적지 않으면 뒤에 비교할 수 없다.
    L.push(`- B-1·2 기준 규칙 ${r.B.compare.base.rules}개·**선언 ${r.B.compare.base.decls}개(CSSOM 집계 — 속기가 롱핸드로 펼쳐진 뒤의 수)** / 후보 ${r.B.compare.head.rules}개·선언 ${r.B.compare.head.decls}개 → **차이 ${r.B.compare.diffs}개**(순서 포함)`);
    if (r.B.rewrites) L.push(`  - 같은 CSS를 **원문 글자로 세면 규칙 ${r.B.rewrites.rules}개·선언 ${r.B.rewrites.decls}개**(파일에 적힌 선언의 수). 두 수는 자가 다를 뿐 둘 다 맞는 수다.`);
    L.push(`- B-1 층 분포 ${JSON.stringify(r.B.compare.layers)}, 층 선언문 ${r.B.compare.head.statements.length}개: ${r.B.compare.head.statements.map((s) => `\`${s}\``).join(", ") || "없음"}`);
    L.push(`- A-3(CSSOM) \`@layer components\` 밖 규칙 **${r.B.compare.outside.length}개**${r.B.compare.outside.length ? `\n  - ${r.B.compare.outside.join("\n  - ")}` : " — 요소에 닿는 선택자 0개"}`);
    L.push(`- B-3 원문 선언: 그대로 ${r.B.sourceFate.kept}개, 브라우저가 버린 선언 ${r.B.sourceFate.dropped.length}개, 같은 블록에서 덮인 선언 ${r.B.sourceFate.shadowed.length}개, 규칙째 못 읽은 것 ${r.B.sourceFate.droppedRules.length}개`);
    for (const d of r.B.sourceFate.dropped) L.push(`  - 버림: \`${d}\``);
    L.push(`- B-4 빌드가 고쳐 쓴 것: 줄이 다른 규칙 **${r.B.rewrites.rewritten.length}개**, 공백만 다른 토막 ${r.B.rewrites.whitespaceOnly.length}개, 지운 주석 ${r.B.rewrites.commentsRemoved}블록, ${r.B.rewrites.bytes.source} → ${r.B.rewrites.bytes.built}바이트`);
    for (const x of r.B.rewrites.rewritten.slice(0, 30)) L.push(`  - #${x.index} 원문 \`${x.source}\` → 산출 \`${x.built}\``);
  }
  if (r.C) {
    L.push("", `## C. 계산된 스타일·상자 (${r.C.coverage ?? (r.C.scope === "full" ? "전수" : "축소")})`, "");
    L.push(`- 장 ${r.C.pages}개${r.C.pagesAll && r.C.pagesAll !== r.C.pages ? `(후보 docs의 ${r.C.pagesAll}장 가운데 고른 것: ${(r.C.pageList ?? []).join(", ")})` : ""} × 모드·폭 = 조건 ${r.C.jobs}개, 렌더 ${r.C.renders}회(기준·후보), ${r.C.totals.seconds}초`);
    L.push(`- 견준 요소 ${r.C.totals.elements}개, 값 ${r.C.totals.values}개 → **차이 ${r.C.totals.diffs}개**`);
    L.push(`- 조용해지지 않은 조건 ${r.C.totals.unsettled}개, 차이 난 조건 ${r.C.totals.diffJobs}개, 못 잰 조건 ${r.C.totals.failed}개`);
    // 사용자 정의 속성의 **열거 순서**에만 면제를 주고, 그 대가로 요건 셋을 지켰다는 것을 여기서 보인다(cto 개정 1 6147173489).
    L.push("", "### C-0. 정렬 면제의 요건 셋 (cto 개정 1)", "");
    L.push("- (가) 요소·의사요소마다 `이름:값` 쌍을 **이름으로 정렬한 뒤 전부** 견줬다. 값은 하나도 빼지 않았다 — 정렬한 쌍 **전체**를 이어 붙여 SHA-256을 내므로 값이 하나라도 다르면 반드시 해시가 달라진다(`lib/style-equal.ts`의 `styleText`).");
    L.push(`- (나) **견준 쌍의 개수**: 기준 ${r.C.totals.pairsBase}개 / 후보 ${r.C.totals.pairsHead}개 → **${r.C.totals.pairsBase === r.C.totals.pairsHead ? "같다" : "다르다 — 그 자체가 차이다"}**. 한쪽에만 있는 속성은 이 수에서 드러난다(조건마다도 견주고 합계로 한 번 더 본다).`);
    L.push(`- (다) \`cs\` 열거에 \`--*\`가 나오지 않는 환경을 대비해 **원문이 선언한 사용자 정의 속성 이름 ${r.C.totals.customProps}개**를 따로 읽혔고, 기준·후보에 **같은 목록**을 썼다(\`src/css/legacy.css\` 한 곳에서 뽑아 양쪽에 넘긴다).`);
    L.push("- 면제는 **열거 순서에만** 준다. 규칙 순서(증빙 B)는 종전대로 순서까지 견준다.");
    L.push("");
    L.push("", "| 장 | 모드 | 폭 | 요소 | 값 | 차이 |", "|---|---|---|---|---|---|");
    for (const x of r.C.results) L.push(x.error ? `| ${x.page}${x.lang ? ` (${x.lang})` : ""} | ${x.mode} | ${x.width} | — | — | **못 쟀다: ${x.error}** |` : `| ${x.page}${x.lang ? ` (${x.lang})` : ""} | ${x.mode} | ${x.width} | ${x.elements} | ${x.values} | ${x.diffs} |`);
  }
  if (r.control?.error) L.push("", "## C-5. 대조군", "", `- 돌리지 못했다: ${r.control.error}`);
  else if (r.control) {
    L.push("", "## C-5. 대조군", "");
    L.push(`- 바꾼 것: \`${r.control.changed}\` (${r.control.job.page}, ${r.control.job.mode}, ${r.control.job.width})`);
    L.push(`- 요소 ${r.control.elements}개·값 ${r.control.values}개에서 **차이 ${r.control.diffs}개** — 비교가 잡는다.`);
    for (const d of r.control.sample) L.push(`  - \`${d.path}\` ${d.what} \`${d.prop}\`: 기준 \`${d.base}\` → 대조군 \`${d.head}\``);
  }
  L.push("", "## 판정", "", r.ok ? "- 전부 0. 차이 없음." : `- 실패 ${r.failures.length}건\n  - ${r.failures.join("\n  - ")}`);
  return L.join("\n") + "\n";
}
