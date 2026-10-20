#!/usr/bin/env node
// 렌더 기반 접근성 검사의 진입점(#325 = #278 PR A).
//
// ⚠️ **같은 폴더의 `bin/style-equal.ts`와 다른 파일이다.** 그쪽은 소유자가 뺀 「화면 동일 증빙」 전용
// 진입점이고(#276 완료 조건 9 폐기, #247), 이 이슈는 그것을 **고치지도 지우지도 않는다**(#325 결정 2).
// 이어받은 것은 `lib/chrome.ts`·`lib/serve.ts` 둘뿐이다.
//
// 쓰는 법:
//   node tools/render/bin/check.ts <폴더> [옵션]
//     --baseline <폴더>   기준 폴더. 주면 검사 ①(가시 텍스트 다중집합, 375·1280)을 함께 본다.
//     --pages a.html,b.html   장을 고른다(기본: 폴더의 .html 전부)
//     --js on|off|both    페이지 스크립트(기본 off). `both`면 끔·켬 둘 다 돌려 장마다 두 줄이 나온다.
//     --lang ko|en|both   화면 언어(기본 ko). 영어는 스크립트가 번역하므로 `--js off`와 함께 쓸 수 없다.
//     --json <파일>       결과를 JSON으로도 떨군다
//     --quiet             장별 상세를 빼고 집계만
//     --settle <ms>       load 뒤 기다리는 시간(기본: 스크립트 끔 0 / 켬 250)
//
// 종료 코드: **0 = 위반 0건 · 1 = 위반 있음 · 2 = 도구가 돌지 못했다**(Chrome 없음, 폴더 없음 따위).
// ⚠️ **Chrome을 못 찾으면 건너뛰지 않고 2로 죽는다**(#274 체인 공통 규칙 1번). 건너뛴 검사는
// "브라우저가 없어서 안 돌았다"를 초록으로 만든다 — 그 길을 여기서 막는다.
import { writeFile } from "node:fs/promises";
import { launchChrome } from "../lib/chrome.ts";
import { checkDir, compareTexts, formatReport, mergeTextFindings, summarize } from "../lib/check.ts";

function parseArgs(argv) {
  const opts = { dir: null, baseline: null, pages: null, js: "off", lang: "ko", json: null, quiet: false, settle: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a}에 값이 없다`);
      i += 1;
      return v;
    };
    if (a === "--baseline") opts.baseline = next();
    else if (a === "--pages") opts.pages = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--js") opts.js = next();
    else if (a === "--lang") opts.lang = next();
    else if (a === "--json") opts.json = next();
    else if (a === "--settle") opts.settle = Number(next());
    else if (a === "--quiet") opts.quiet = true;
    else if (a.startsWith("--")) throw new Error(`모르는 옵션: ${a}`);
    else if (opts.dir === null) opts.dir = a;
    else throw new Error(`폴더는 하나만 받는다(둘째: ${a})`);
  }
  if (!opts.dir) throw new Error("검사할 폴더를 달라: node bin/check.ts <폴더>");
  if (!["on", "off", "both"].includes(opts.js)) throw new Error(`--js는 on|off|both다(받은 것: ${opts.js})`);
  if (!["ko", "en", "both"].includes(opts.lang)) throw new Error(`--lang은 ko|en|both다(받은 것: ${opts.lang})`);
  return opts;
}

/** 옵션에서 (js, lang) 조합을 낸다. 영어는 스크립트가 번역하므로 js:false와 짝지을 수 없다. */
export function planRuns({ js, lang }) {
  const jsList = js === "both" ? [false, true] : [js === "on"];
  const langList = lang === "both" ? ["ko", "en"] : [lang];
  const runs = [];
  for (const j of jsList) for (const l of langList) if (!(l === "en" && !j)) runs.push({ js: j, lang: l });
  if (runs.length === 0) throw new Error("영어 모드는 페이지 스크립트가 번역한다 — `--lang en`은 `--js on`(또는 both)과 함께 쓴다.");
  return runs;
}

export { parseArgs };

async function main(argv) {
  const opts = parseArgs(argv);
  const plan = planRuns(opts);
  const chrome = await launchChrome();
  const runs = [];
  try {
    for (const { js, lang } of plan) {
      const common = { chrome, pages: opts.pages, js, lang, settleMs: opts.settle, wantTexts: Boolean(opts.baseline) };
      const cand = await checkDir(opts.dir, common);
      if (opts.baseline) {
        const base = await checkDir(opts.baseline, common);
        mergeTextFindings(cand, compareTexts(base, cand));
      }
      runs.push(cand);
    }
  } finally {
    await chrome.close();
  }
  const report = formatReport(runs, { detail: !opts.quiet });
  console.log(report);
  if (opts.json) await writeFile(opts.json, JSON.stringify({ chrome: chrome.version, runs }, null, 2));
  return summarize(runs).total === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`검사를 돌리지 못했다: ${e.message}`);
    process.exitCode = 2;
  }
}
