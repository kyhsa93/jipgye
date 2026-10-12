#!/usr/bin/env node
// 소유자용 비교 한 장(mockups/compare.html)을 만든다: 현행·A·B·C를 나란히 놓은 단일 자기완결 HTML.
//   node tools/build-compare.mjs [--quality 68] [--mobile-crop 1700] [--desktop-crop 1400]
// 그림은 시트 PNG의 위쪽 구간을 WebP로 줄여 data: URI로 싣는다(외부 요청 0). 숫자는 measure/summary.json에서만 가져온다.
// 14MB를 넘으면 품질을 낮춰 다시 만든다.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchChrome } from "../render-tools/lib/chrome.mjs";
import { convert } from "./webp.mjs";

const M = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
const S = JSON.parse(await readFile(path.join(M, "measure/summary.json"), "utf8"));
const LIMIT = 14 * 1024 * 1024;
const CROP = { 375: Number(opt["mobile-crop"] ?? 1700), 1280: Number(opt["desktop-crop"] ?? 1400) };
const V = ["base", "a", "b", "c"];
const PAGES = [
  { id: "index", label: "첫 화면(index)", dir: "sheet", file: (m, w) => `index.auto-${m}.${w}.png`, modes: ["light", "dark"] },
  { id: "budget", label: "예산대(budget-7eok)", dir: "sheet", file: (m, w) => `budget-7eok.auto-${m}.${w}.png`, modes: ["light", "dark"] },
  { id: "rates", label: "금리(rates)", dir: "sheet", file: (m, w) => `rates.auto-${m}.${w}.png`, modes: ["light", "dark"] },
  { id: "outlook", label: "전망·비움 칸(price-outlook)", dir: "low-sample", file: (m, w) => `price-outlook.auto-${m}.${w}.png`, modes: ["light", "dark"] },
  { id: "layout", label: "레이아웃 방향(index 2층)", dir: "layout", file: (m, w) => `index.auto-${m}.${w}.png`, modes: ["light", "dark"], baseFrom: "index" },
  { id: "en", label: "영어(index)", dir: "en", file: (m, w) => `index.auto-${m}.${w}.en.png`, modes: ["light"] },
];
const jobs = [];
for (const p of PAGES) for (const m of p.modes) for (const w of [375, 1280]) for (const v of V) {
  if (p.baseFrom && v === "base") continue; // 현행에는 2층이 없다 — 화면에서는 현행 index를 참고로 쓴다
  jobs.push({ key: `${p.id}|${m}|${w}|${v}`, src: path.join(M, "sheets", v, p.dir, p.file(m, w)), height: CROP[w] });
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x) => (x == null ? "–" : Number(x).toLocaleString("en-US"));
const pct = (a, b) => `${a >= b ? "+" : "−"}${Math.abs(Math.round((a / b - 1) * 100))}%`;
const b = S.variants.base, A = S.variants.a, B = S.variants.b, C = S.variants.c;
const f = S.flip;

function swatches(v) {
  const c = S.variants[v].contrast;
  const light = c.modes[0].tokens, dark = c.modes[1].tokens;
  const names = [["bg", "바탕"], ["card", "카드"], ["fg", "글자"], ["muted", "회색"], ["accent", "액센트"], ["up", "오름"], ["down", "내림"]];
  const row = (t, label) => `<div class="sw-row"><span class="sw-label">${label}</span>${names.map(([k, ko]) => `<span class="sw" title="${ko} ${esc(t[k])}" style="background:${esc(t[k])}"></span>`).join("")}</div>`;
  return `<div class="sw-wrap" aria-label="색 견본(바탕·카드·글자·회색·액센트·오름·내림)">${row(light, "라이트")}${row(dark, "다크")}</div>`;
}
const lay = (v) => S.variants[v].layout;

const CARDS = [
  { v: "base", tag: "현행", name: "지금 배포된 화면", one: "기준 커밋 8c984329의 화면 그대로입니다.",
    pros: ["바꾸는 것이 없습니다. 아래 세 시안을 견주는 기준입니다."],
    cons: [`화면 글자의 ${b.index375.small}%(index)·${b.budget375.small}%(예산대)가 13.6px 이하입니다.`, `예산대 장은 요약 문장이 ${n(b.budget375.summary)}px에서 시작해 폰 첫 화면(667px) 밖입니다.`, `금리 장의 주 링크 4개가 ${b.rates375.hubLinks[0]}px 높이입니다.`],
    with: "–" },
  { v: "a", tag: "A", name: "정돈", one: "지금 모습에서 어긋난 것만 바로잡습니다.",
    pros: ["지금과 가장 닮았고 위험과 작업량이 가장 작습니다.", `작은 글씨(13.6px 이하) 비율이 index ${b.index375.small}% → ${A.index375.small}%로 줄어듭니다. 표 칸과 설명 글이 15px입니다.`, "브랜드색(남색)을 그대로 씁니다."],
    cons: [`답의 위치는 거의 그대로입니다(index 첫 제목 ${n(b.index375.h2)} → ${n(A.index375.h2)}px, 예산대 요약 ${n(b.budget375.summary)} → ${n(A.budget375.summary)}px).`, `화면이 조금 길어집니다(index ${pct(A.index375.height, b.index375.height)}, 예산대 ${pct(A.budget375.height, b.budget375.height)}).`, "넓은 화면의 빈 오른쪽은 표를 왼쪽에 붙이고 아래 절반을 2단으로 놓는 만큼만 나아집니다. 레이아웃 방향 장의 넓은 화면에서는 표·금리 표·추이 카드가 제각각 폭으로 왼쪽에 붙어, 오른쪽이 비는 문제가 모양만 바뀌어 남습니다(po 검토).", `영어 화면 첫 제목이 현행 ${n(b.indexEn.h2_375)}px보다 아래(A ${n(A.indexEn.h2_375)}·C ${n(C.indexEn.h2_375)}px), 구현 때 ${n(b.indexEn.h2_375)}px 이하로 고친다.`],
    with: "없음" },
  { v: "b", tag: "B", name: "계기판", one: "숫자가 먼저 보이는 조밀한 화면입니다.",
    pros: [`한 화면에 숫자가 가장 많이 보입니다(375폭 장 높이: index ${pct(B.index375.height, b.index375.height)}, 예산대 ${pct(B.budget375.height, b.budget375.height)}).`, `답이 가장 위에 옵니다(예산대 요약 문장 ${n(b.budget375.summary)} → ${n(B.budget375.summary)}px — 폰 첫 화면 안).`, "색을 가진 것이 오르내림(빨강·파랑)뿐이라 \"파랑 = 내렸다\"가 하나로 읽힙니다."],
    cons: [`작은 글씨가 남습니다(13.6px 이하 비율 index ${B.index375.small}%, 예산대 ${B.budget375.small}%). 라벨·건수는 12.5px입니다.`, "시세판처럼 읽힐 수 있습니다(대상은 \"시세를 구경하는 사람\"이 아닙니다).", `레이아웃 방향(추이 카드를 맨 위로)의 폰 화면은 질문 입구가 ${n(lay("b").index375.questionNav)}px로 내려가 첫 화면(667px) 밖입니다(현행 ${n(b.index375.questionNav)}px). 고르면 폰은 질문 입구가 먼저 오는 순서로 간다(시안의 폰 레이아웃 방향은 채택하지 않음). 넓은 화면의 12단 격자는 시안대로입니다.`, "표본 부족 표시는 A·C 방식으로 낮춘다(칸 전체 빗금은 값보다 빈 칸이 먼저 보인다는 po 판정)."],
    with: "브랜드색이 남색(#253e81)에서 먹색(#111418)으로 바뀝니다. 같이 바뀌는 것: 주소창 색(theme-color) 67장, 앱 설치 정보(manifest)의 theme_color, 앱 아이콘, 워드마크, 금리 틀, 검사 도구 픽스처 3장. 이 시안 화면에는 워드마크 색만 반영돼 있습니다." },
  { v: "c", tag: "C", name: "보고서", one: "문장이 답이고 표는 근거인, 읽는 화면입니다.",
    pros: ["답 문장과 \"표본이 모자라 비웠다\"는 설명이 가장 잘 읽힙니다. 본문 17px, 표본·기준·단서 설명은 회색 작은 글씨에서 본문색 15px로 올렸습니다.", `작은 글씨 비율이 index ${b.index375.small}% → ${C.index375.small}%, 전망 장 ${b.outlook375.small}% → ${C.outlook375.small}%로 줄어듭니다.`, `글자가 커졌는데도 답은 현행보다 위에 옵니다(index 첫 제목 ${n(b.index375.h2)} → ${n(C.index375.h2)}px, 예산대 요약 ${n(b.budget375.summary)} → ${n(C.budget375.summary)}px). 머리와 내비의 여백을 줄인 결과입니다.`],
    cons: [`화면이 길어집니다(폰에서 첫 장 ${pct(C.index375.height, b.index375.height)}, 전망 장 ${pct(C.outlook375.height, b.outlook375.height)}, 예산대 ${pct(C.budget375.height, b.budget375.height)}).`, "한 화면에 보이는 숫자가 줄어듭니다.", "넓은 화면에서 글이 가운데 좁은 단(44rem)으로 모입니다. \"넓은 화면을 쓰자\"는 2026-08-29 결정(a7bb2fde)을 글이 많은 장에서 뒤집는 것입니다.", `영어 화면 첫 제목이 현행 ${n(b.indexEn.h2_375)}px보다 아래(A ${n(A.indexEn.h2_375)}·C ${n(C.indexEn.h2_375)}px), 구현 때 ${n(b.indexEn.h2_375)}px 이하로 고친다.`],
    with: "없음" },
];

const verdict = (hit) => (hit ? `<span class="v hit">걸림</span>` : `<span class="v ok">안 걸림</span>`);
const condRows = [
  [`1. 375폭 장 높이가 현행의 1.3배를 넘는다`, `index ${n(f.cond1.index.base)} → ${n(f.cond1.index.c)}px(${f.cond1.index.ratio}배, 한도 ${n(f.cond1.index.limit)}px) · 예산대 ${n(f.cond1.budget.base)} → ${n(f.cond1.budget.c)}px(${f.cond1.budget.ratio}배, 한도 ${n(f.cond1.budget.limit)}px)`, verdict(f.cond1.hit)],
  [`2. 375폭에서 답 위치가 현행보다 아래로 내려간다`, `index 첫 제목 ${n(f.cond2.indexH2.base)} → ${n(f.cond2.indexH2.c)}px(레이아웃 방향 장은 ${n(f.cond2.indexH2.cLayout)}px) · 예산대 요약 문장 ${n(f.cond2.budgetSummary.base)} → ${n(f.cond2.budgetSummary.c)}px`, verdict(f.cond2.hit || f.cond2.hitLayout)],
  [`3. 전망 장(price-outlook)의 표가 375폭에서 가로로 넘친다`, `새로 넘치는 표 ${f.cond3.newTables.length}개, 성적표(일곱 열) 상자 안 넘김 ${n(f.cond3.tablesInBox.base["#score-table"])} → ${n(f.cond3.tablesInBox.c["#score-table"])}px(A ${n(f.cond3.tablesInBox.a["#score-table"])}). 화면 가로 넘침은 ${f.cond3.pageOverflow.c}px이고 권역 표(비움 칸)는 넘치지 않습니다. 성적표는 현행에서도 표 상자 안에서 옆으로 넘기는 표라, 엄격하게 읽으면 현행과 A도 걸리고 느슨하게 읽으면 아무도 안 걸립니다.`, `<span class="v note">판별 불가(po)</span>`],
];

const M_ROWS = [
  ["index 첫 제목(h2)의 위치", (o) => `${n(o.index375.h2)}px`],
  ["index 질문 입구의 위치", (o) => `${n(o.index375.questionNav)}px`],
  ["예산대 요약 문장의 위치", (o) => `${n(o.budget375.summary)}px`],
  ["예산대 \"한눈에\" 상자의 위치", (o) => `${n(o.budget375.answers)}px`],
  ["index 장 높이", (o) => `${n(o.index375.height)}px`],
  ["예산대 장 높이", (o) => `${n(o.budget375.height)}px`],
  ["전망 장 높이", (o) => `${n(o.outlook375.height)}px`],
  ["13.6px 이하 글자 비율(index)", (o) => `${o.index375.small}%`],
  ["13.6px 이하 글자 비율(예산대)", (o) => `${o.budget375.small}%`],
  ["가장 작은 글자", (o) => `${o.minFont}px`],
  ["44px보다 낮은 누르는 요소(index·예산대·금리)", (o) => `${o.under44["index.html"].under} · ${o.under44["budget-7eok.html"].under} · ${o.under44["rates.html"].under}개`],
  ["가로 넘침(320·375폭, 한·영) 최대", (o) => `${o.overflowMax}px`],
];
const allOk = ["a", "b", "c"].every((v) => S.variants[v].invariants.hard === 0 && S.variants[v].invariants.soft === 0 && S.variants[v].bytes.jsAllSame && S.variants[v].contrast.fails.length === 0);

function page(images, meta) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>집계 시안 비교</title>
<style>
/* 짜임: 위에서 아래로 한 단 — 고지 → 네 방향의 요약 카드 → 화면 비교(장·모드·폭 탭) → 실측과 권장. 색은 중립 먹색에 남색 한 방울. */
:root {
  color-scheme: light;
  --bg: #f6f7f9; --panel: #ffffff; --fg: #15181d; --muted: #586070; --line: #d9dde4; --line-strong: #8a92a0;
  --accent: #253e81; --accent-on: #ffffff; --accent-weak: #e8ecf6; --ok: #1f6b3a; --ok-bg: #e3f2e8; --warn: #8a3c0b; --warn-bg: #fbeadb;
  --frame: #e9ecf1;
  --sans: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #101216; --panel: #181b21; --fg: #e9ebef; --muted: #a3aab6; --line: #2c313b; --line-strong: #6f7786;
    --accent: #9db6f2; --accent-on: #101216; --accent-weak: #1c2333; --ok: #8fd6a6; --ok-bg: #16281c; --warn: #f3b889; --warn-bg: #2d1f14;
    --frame: #0b0c0f;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #101216; --panel: #181b21; --fg: #e9ebef; --muted: #a3aab6; --line: #2c313b; --line-strong: #6f7786;
  --accent: #9db6f2; --accent-on: #101216; --accent-weak: #1c2333; --ok: #8fd6a6; --ok-bg: #16281c; --warn: #f3b889; --warn-bg: #2d1f14;
  --frame: #0b0c0f;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans); font-size: 16px; line-height: 1.6; word-break: keep-all; overflow-wrap: break-word; }
.wrap { max-width: 1680px; margin: 0 auto; padding-inline: 16px; padding-block: 24px 64px; display: grid; gap: 32px; }
@media (min-width: 900px) { .wrap { padding-inline: 32px; } }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
h2 { font-size: 1.2rem; line-height: 1.3; margin: 0 0 12px; text-wrap: balance; }
h3 { font-size: 1rem; margin: 0; }
p { margin: 0; }
.sub { color: var(--muted); font-size: 0.9rem; margin-top: 6px; }
.notice { border: 1px solid var(--accent); background: var(--accent-weak); border-radius: 6px; padding: 14px 16px; display: grid; gap: 6px; }
.notice > p:first-child { max-width: 62rem; }
.choices { margin: 4px 0 0; padding-left: 1.2em; display: grid; gap: 6px; max-width: 62rem; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); align-items: start; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 16px; display: grid; gap: 10px; min-width: 0; }
.card.rec { border-color: var(--accent); box-shadow: inset 0 3px 0 var(--accent); }
.card-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.tag { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 8px; border-radius: 4px; background: var(--fg); color: var(--bg); font-weight: 700; font-size: 0.9rem; }
.rec-badge { margin-left: auto; font-size: 0.8rem; font-weight: 700; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 1px 10px; }
.one { font-weight: 600; }
.card dl { margin: 0; display: grid; gap: 8px; }
.card dt { font-size: 0.8rem; font-weight: 700; color: var(--muted); letter-spacing: 0.02em; }
.card dd { margin: 2px 0 0; font-size: 0.93rem; }
.card ul { margin: 0; padding-left: 1.1em; display: grid; gap: 4px; }
.sw-wrap { display: grid; gap: 4px; }
.sw-row { display: flex; align-items: center; gap: 4px; }
.sw-label { width: 3.2em; font-size: 0.75rem; color: var(--muted); }
.sw { width: 22px; height: 22px; border-radius: 3px; border: 1px solid var(--line-strong); }
.viewer { display: grid; gap: 12px; min-width: 0; }
.controls { display: grid; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; }
.ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ctl-label { width: 3em; flex-shrink: 0; font-size: 0.8rem; font-weight: 700; color: var(--muted); }
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg button { font: inherit; font-size: 0.9rem; min-height: 44px; padding: 6px 14px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--panel); color: var(--fg); cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-on); font-weight: 700; }
.seg button:disabled { opacity: 0.45; cursor: not-allowed; }
.seg button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hint { color: var(--muted); font-size: 0.85rem; }
.shots { display: grid; gap: 12px; align-items: start; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }
.shots.wide { grid-template-columns: repeat(auto-fit, minmax(min(100%, 560px), 1fr)); }
.shot { margin: 0; min-width: 0; display: grid; gap: 6px; }
.shot figcaption { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 0.85rem; }
.shot figcaption b { font-size: 1rem; }
.shot figcaption span { color: var(--muted); font-variant-numeric: tabular-nums; }
.frame { position: relative; background: var(--frame); border: 1px solid var(--line-strong); border-radius: 4px; line-height: 0; max-width: 100%; }
.shots:not(.wide) .frame { max-width: 377px; }
.frame.natural { overflow-x: auto; }
.frame img { display: block; width: 100%; height: auto; }
.frame.natural img { width: auto; max-width: none; }
.fold { position: absolute; left: 0; right: 0; border-top: 2px dashed var(--warn); pointer-events: none; }
.frame.natural .fold { display: none; }
.fold span { position: absolute; right: 0; top: 0; transform: translateY(-100%); background: var(--warn-bg); color: var(--warn); font-size: 11px; line-height: 1.4; padding: 1px 6px; border-radius: 3px 3px 0 0; }
.table-box { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
th, td { padding: 9px 12px; border-bottom: 1px solid var(--line); text-align: right; vertical-align: top; }
th:first-child, td:first-child { text-align: left; }
thead th { font-size: 0.8rem; color: var(--muted); border-bottom-color: var(--line-strong); white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
td.l { text-align: left; }
.v { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 0.82rem; font-weight: 700; white-space: nowrap; }
.v.ok { background: var(--ok-bg); color: var(--ok); }
.v.hit { background: var(--warn-bg); color: var(--warn); }
.v.note { margin-left: 6px; background: none; color: var(--muted); border: 1px solid var(--line-strong); font-weight: 600; }
.conds { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); align-items: start; }
.cond { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; display: grid; gap: 8px; min-width: 0; font-size: 0.93rem; }
.cond h3 { font-size: 0.98rem; line-height: 1.4; }
@media (max-width: 520px) {
  table { font-size: 0.8rem; }
  th, td { padding: 8px 5px; }
  thead th { white-space: normal; }
}
.prose { max-width: 46rem; display: grid; gap: 10px; }
.prose ul { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; }
.small { font-size: 0.88rem; color: var(--muted); }
section { display: grid; gap: 12px; min-width: 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86em; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>집계 디자인 시안 비교</h1>
    <p class="sub">현행 · A 정돈 · B 계기판 · C 보고서. 기준 ${esc(S.baseSha)}(2026-10-12 배포본), 로컬 시안입니다 — 배포된 사이트는 바뀌지 않았습니다. 이슈 #275.</p>
  </header>

  <div class="notice" role="note">
    <p><strong>디자인 방향을 한 번만 골라 주세요(D1) — 이 선택에는 색과 글자뿐 아니라 화면의 짜임(머리·내비·단 구성)의 방향도 들어 있고, 이후 장별 레이아웃은 다시 보여 드리지 않고 po가 고르신 방향에 맞는지 판정합니다.</strong> po 권장은 <strong>C 보고서</strong>입니다: 이 사이트가 파는 "답 문장과 표본이 모자라 비웠다는 설명"이 가장 잘 읽히고(13.6px 이하 글자 비율이 첫 장에서 64% → 6%), 글자를 키우고도 폰에서 답이 지금보다 위에 옵니다(예산대 요약 문장 735 → 689px). 고른 뒤에도 색·글자의 정확한 값과 간격, 시안에서 찾은 결함(넓은 화면의 정렬선, 영어 화면의 답 위치 등)은 조정되지만, 방향 자체(무엇을 앞세우는가·브랜드색·단 구성)와 내용·주소·접근성 하한은 바뀌지 않습니다. 세 시안 모두 글자·수치·링크는 지금과 같고, 배포된 사이트는 아직 바뀌지 않았습니다.</p>
    <ul class="choices">
      <li><strong>C 보고서 (권장)</strong> — 문장이 답이고 표는 근거인 읽는 화면. 대신 화면이 길어지고(폰에서 첫 장 +15%, 전망 장 +20%) 넓은 화면에서 글이 가운데 좁은 단으로 모입니다.</li>
      <li><strong>A 정돈</strong> — 지금 모습 그대로 글자만 키우고 어긋난 것을 바로잡습니다. 위험과 작업량이 가장 작지만 답의 위치와 넓은 화면의 빈 자리는 거의 그대로입니다.</li>
      <li><strong>B 계기판</strong> — 한 화면에 숫자가 가장 많이 보입니다. 대신 작은 글씨가 남고 시세판처럼 읽힐 수 있으며, 브랜드색이 남색에서 먹색으로 바뀌어 주소창 색(theme-color) 67장·manifest·앱 아이콘·워드마크가 같이 바뀝니다.</li>
      <li><strong>셋 다 아님</strong> — 지금 모습 그대로 Tailwind만 입힙니다.</li>
    </ul>
    <p class="small">짜임의 방향은 아래 화면 비교의 "레이아웃 방향" 탭에 있습니다. 문안은 po 검토(#275, 2026-10-12)의 최종 문안 그대로입니다.</p>
  </div>

  <section aria-labelledby="h-cards">
    <h2 id="h-cards">네 가지 방향</h2>
    <div class="cards">
      ${CARDS.map((c) => `<article class="card${c.v === "c" ? " rec" : ""}">
        <div class="card-head"><span class="tag">${esc(c.tag)}</span><h3>${esc(c.name)}</h3>${c.v === "c" ? `<span class="rec-badge">po 권장</span>` : ""}</div>
        <p class="one">${esc(c.one)}</p>
        ${swatches(c.v)}
        <dl>
          <div><dt>${c.v === "base" ? "그대로인 것" : "좋아지는 것"}</dt><dd><ul>${c.pros.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></dd></div>
          <div><dt>${c.v === "base" ? "지금의 문제" : "치르는 값"}</dt><dd><ul>${c.cons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></dd></div>
          <div><dt>같이 바뀌는 것</dt><dd>${esc(c.with)}</dd></div>
        </dl>
      </article>`).join("\n      ")}
    </div>
  </section>

  <section class="viewer" aria-labelledby="h-view">
    <h2 id="h-view">화면 비교</h2>
    <div class="controls">
      <div class="ctl"><span class="ctl-label" id="l-page">장</span><div class="seg" id="seg-page" role="group" aria-labelledby="l-page">${PAGES.map((p, i) => `<button type="button" id="page-${p.id}" data-k="page" data-v="${p.id}" aria-pressed="${i === 0}">${esc(p.label)}</button>`).join("")}</div></div>
      <div class="ctl"><span class="ctl-label" id="l-mode">모드</span><div class="seg" role="group" aria-labelledby="l-mode"><button type="button" id="mode-light" data-k="mode" data-v="light" aria-pressed="true">라이트</button><button type="button" id="mode-dark" data-k="mode" data-v="dark" aria-pressed="false">다크</button></div></div>
      <div class="ctl"><span class="ctl-label" id="l-width">폭</span><div class="seg" role="group" aria-labelledby="l-width"><button type="button" id="width-375" data-k="width" data-v="375" aria-pressed="true">모바일 375</button><button type="button" id="width-1280" data-k="width" data-v="1280" aria-pressed="false">데스크톱 1280</button></div></div>
      <div class="ctl"><span class="ctl-label" id="l-show">보기</span><div class="seg" role="group" aria-labelledby="l-show">${V.map((v) => `<button type="button" id="show-${v}" data-k="show" data-v="${v}" aria-pressed="true">${esc(S.variants[v].name)}</button>`).join("")}<button type="button" id="natural" data-k="natural" aria-pressed="false">원래 크기(상자 안에서 옆으로 넘겨 보기)</button></div></div>
      <p class="hint" id="hint"></p>
    </div>
    <div class="shots" id="shots"></div>
    <p class="small">그림은 헤드리스 Chrome으로 찍은 실제 내용의 화면입니다(광고·분석 요청은 막고 찍었습니다). 긴 장은 위쪽 ${n(CROP[375])}px(모바일)·${n(CROP[1280])}px(데스크톱)만 실었고 전체 높이는 그림 위에 적었습니다. 점선은 첫 화면이 끝나는 자리(모바일 667px, 데스크톱 800px)입니다. C의 넓은 화면(1280)은 po 검토 뒤 정렬선을 하나로 맞춰 다시 찍은 그림입니다 — 넓히는 것은 열이 넷 이상인 표와 석 장짜리 차트 줄뿐이고 나머지는 가운데 단에 맞춥니다.</p>
  </section>

  <section aria-labelledby="h-rec">
    <h2 id="h-rec">po 권장: C 보고서 — 미리 적어 둔 조건의 실측</h2>
    <div class="prose">
      <p>po는 시안을 보기 전에 "하나라도 걸리면 권장을 A로 바꾼다"는 조건 셋을 적어 두었습니다. 아래가 시안을 재어 본 값이고, po는 이 값과 화면을 보고 권장을 C로 확정했습니다. 조건 3은 C와 A를 가르지 못하는 조건이었다고 po가 판정해 통과로 치지 않았습니다.</p>
    </div>
    <div class="conds">${condRows.map((r) => `<div class="cond"><h3>${esc(r[0])}</h3><p>${esc(r[1])}</p><p>${r[2]}</p></div>`).join("")}</div>
  </section>

  <section aria-labelledby="h-num">
    <h2 id="h-num">현행 대비 실측(폰 375폭, 한국어)</h2>
    <div class="table-box"><table>
      <thead><tr><th>재는 것</th>${V.map((v) => `<th>${esc(S.variants[v].name)}</th>`).join("")}</tr></thead>
      <tbody>${M_ROWS.map(([label, fn]) => `<tr><td>${esc(label)}</td>${V.map((v) => `<td>${esc(fn(S.variants[v]))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <div class="prose small">
      <p>위치는 화면 맨 위에서부터의 거리입니다. 작을수록 답이 위에 있습니다. 폰 첫 화면은 667px입니다.</p>
      <p>${allOk ? "세 시안 모두 내용은 바꾸지 않았습니다: 67장의 글자·수치·링크·제목·스크립트가 현행과 같고(불변 검사 하드 0·소프트 0), 글자 대비는 네 갈래(자동·강제 × 라이트·다크) 모두 4.5:1 이상입니다. 웹폰트·움직임·새 외부 요청은 0입니다." : "불변 검사 또는 대비에 미달이 있습니다 — REPORT.md를 보세요."} 레이아웃 방향 장(index 1장)만 요소의 순서를 바꿨고, 바꾼 목록은 REPORT.md에 있습니다.</p>
      <p>보지 못한 것: 실기기(iOS Safari·안드로이드), 광고가 실제로 붙은 화면, 방문자의 기기·언어 비율(GA는 이 환경에서 볼 수 없습니다 — 소유자가 콘솔에서 볼 것).</p>
    </div>
  </section>
</div>
<script>
(function () {
  var IMG = ${JSON.stringify(images)};
  var META = ${JSON.stringify(meta)};
  var NAMES = ${JSON.stringify(Object.fromEntries(V.map((v) => [v, S.variants[v].name])))};
  var MODES = ${JSON.stringify(Object.fromEntries(PAGES.map((p) => [p.id, p.modes])))};
  var BASEFROM = ${JSON.stringify(Object.fromEntries(PAGES.filter((p) => p.baseFrom).map((p) => [p.id, p.baseFrom])))};
  var state = { page: "index", mode: "light", width: "375", show: { base: true, a: true, b: true, c: true }, natural: false };
  var shots = document.getElementById("shots");
  var hint = document.getElementById("hint");
  function render() {
    var modes = MODES[state.page];
    if (modes.indexOf(state.mode) < 0) state.mode = modes[0];
    document.getElementById("mode-dark").disabled = modes.indexOf("dark") < 0;
    var buttons = document.querySelectorAll(".controls button[data-k]");
    for (var i = 0; i < buttons.length; i++) {
      var bt = buttons[i], k = bt.getAttribute("data-k"), v = bt.getAttribute("data-v");
      var on = k === "show" ? state.show[v] : k === "natural" ? state.natural : state[k] === v;
      bt.setAttribute("aria-pressed", on ? "true" : "false");
    }
    shots.className = "shots" + (state.width === "1280" ? " wide" : "");
    shots.textContent = "";
    var order = ["base", "a", "b", "c"];
    for (var j = 0; j < order.length; j++) {
      var vr = order[j];
      if (!state.show[vr]) continue;
      var pageId = state.page, label = NAMES[vr];
      if (vr === "base" && BASEFROM[pageId]) { pageId = BASEFROM[pageId]; label += " (참고: 짜임을 바꾸지 않은 현행)"; }
      var key = pageId + "|" + state.mode + "|" + state.width + "|" + vr;
      var m = META[key];
      if (!m) continue;
      var fig = document.createElement("figure"); fig.className = "shot";
      var cap = document.createElement("figcaption");
      var bEl = document.createElement("b"); bEl.textContent = label; cap.appendChild(bEl);
      var sp = document.createElement("span");
      sp.textContent = (m.full > m.h ? "위쪽 " + m.h.toLocaleString() + "px / 전체 " : "전체 ") + m.full.toLocaleString() + "px" + (m.note ? " · " + m.note : "");
      cap.appendChild(sp); fig.appendChild(cap);
      var frame = document.createElement("div"); frame.className = "frame" + (state.natural ? " natural" : "");
      var img = document.createElement("img");
      img.src = IMG[key]; img.width = m.w; img.height = m.h; img.alt = label + " — " + document.getElementById("page-" + state.page).textContent + ", " + (state.mode === "dark" ? "다크" : "라이트") + ", " + state.width + "폭";
      frame.appendChild(img);
      var foldY = state.width === "375" ? 667 : 800;
      if (m.h > foldY) { var fold = document.createElement("div"); fold.className = "fold"; fold.style.top = (foldY / m.h * 100) + "%"; var fs = document.createElement("span"); fs.textContent = "첫 화면 끝 " + foldY + "px"; fold.appendChild(fs); frame.appendChild(fold); }
      fig.appendChild(frame); shots.appendChild(fig);
    }
    hint.textContent = state.page === "en" ? "영어 모드는 라이트만 찍었습니다." : state.page === "layout" ? "레이아웃 방향은 index 한 장에만 만들었습니다. 다른 장은 색·글자·간격만 바꾼 화면입니다." : state.width === "1280" ? "데스크톱 화면은 줄여서 보입니다. 글자를 읽으려면 \\"원래 크기\\"를 켜세요." : "";
  }
  document.querySelector(".controls").addEventListener("click", function (e) {
    var bt = e.target.closest ? e.target.closest("button[data-k]") : null;
    if (!bt || bt.disabled) return;
    var k = bt.getAttribute("data-k"), v = bt.getAttribute("data-v");
    if (k === "show") { state.show[v] = !state.show[v]; if (!state.show.base && !state.show.a && !state.show.b && !state.show.c) state.show[v] = true; }
    else if (k === "natural") state.natural = !state.natural;
    else state[k] = v;
    render();
  });
  render();
})();
</script>
</body>
</html>
`;
}

const chrome = await launchChrome();
let html = "", used = null;
try {
  for (const quality of [Number(opt.quality ?? 68), 58, 48, 38]) {
    const res = await convert(chrome, jobs.map((j) => ({ ...j, quality })));
    const images = {}, meta = {};
    jobs.forEach((j, i) => { images[j.key] = res[i].dataUri; meta[j.key] = { w: res[i].width, h: res[i].height, full: res[i].fullHeight }; });
    // 그림 옆에 붙이는 한 줄(그 장에서 답이 시작하는 자리)
    for (const v of V) for (const m of ["light", "dark"]) {
      const o = S.variants[v];
      const put = (k, note) => { if (meta[k]) meta[k].note = note; };
      put(`index|${m}|375|${v}`, `첫 제목 ${o.index375.h2}px`);
      put(`budget|${m}|375|${v}`, `요약 문장 ${o.budget375.summary}px`);
      put(`outlook|${m}|375|${v}`, `권역 표 ${o.outlook375.regionTable}px`);
      put(`rates|${m}|375|${v}`, `링크 높이 ${o.rates375.hubLinks[0]}px`);
      if (o.layout) put(`layout|${m}|375|${v}`, `질문 입구 ${o.layout.index375.questionNav}px`);
      if (m === "light") put(`en|${m}|375|${v}`, `첫 제목 ${o.indexEn.h2_375}px`);
    }
    html = page(images, meta);
    used = { quality, bytes: Buffer.byteLength(html), images: jobs.length, imageBytes: res.reduce((a, r) => a + r.bytes, 0) };
    console.log(`품질 ${quality}: compare.html ${used.bytes.toLocaleString()}바이트(그림 ${jobs.length}장 ${used.imageBytes.toLocaleString()}바이트)`);
    if (used.bytes <= LIMIT) break;
  }
} finally {
  await chrome.close();
}
if (used.bytes > LIMIT) { console.error("14MB를 넘는다 — 자르는 높이를 줄여 다시 돌릴 것"); process.exitCode = 1; }
await writeFile(path.join(M, "compare.html"), html);
await writeFile(path.join(M, "measure", "compare-build.json"), JSON.stringify({ ...used, crop: CROP, limit: LIMIT, jobs: jobs.map((j) => ({ key: j.key, src: path.relative(M, j.src) })) }, null, 1));
process.exit(process.exitCode ?? 0);
