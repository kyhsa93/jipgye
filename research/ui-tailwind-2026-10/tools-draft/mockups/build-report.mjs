#!/usr/bin/env node
// measure/summary.json에서 REPORT.md(전체)와 comment.md(#275 댓글)를 만든다. 표의 숫자는 전부 summary.json에서 온다.
//   node tools/build-report.mjs
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const M = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const S = JSON.parse(await readFile(path.join(M, "measure/summary.json"), "utf8"));
const CB = JSON.parse(await readFile(path.join(M, "measure/compare-build.json"), "utf8"));
const V = ["base", "a", "b", "c"], T = ["a", "b", "c"];
const NAME = Object.fromEntries(V.map((v) => [v, S.variants[v].name]));
const n = (x) => (x == null ? "–" : Number(x).toLocaleString("en-US"));
const o = (v) => S.variants[v];
const b = o("base"), f = S.flip;
const compareBytes = (await stat(path.join(M, "compare.html"))).size;
const commonBytes = (await stat(path.join(M, "css/common.css"))).size;
const mb = (x) => (x / 1024 / 1024).toFixed(2);
const table = (head, rows, align) => [`| ${head.join(" | ")} |`, `|${head.map((_, i) => (align?.[i] ?? (i === 0 ? "---" : "---:"))).join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const row4 = (label, fn) => [label, ...V.map((v) => fn(o(v), v))];
const ratio = (a, c) => `${(a / c).toFixed(2)}배`;

// ---- 시트 파일 수 ----
const sheetCount = {};
for (const v of V) { sheetCount[v] = {}; for (const d of await readdir(path.join(M, "sheets", v))) sheetCount[v][d] = (await readdir(path.join(M, "sheets", v, d))).filter((x) => x.endsWith(".png")).length; }
const sheetTotal = (v, withMethod = false) => Object.entries(sheetCount[v]).filter(([d]) => withMethod || d !== "method").reduce((a, [, c]) => a + c, 0);
const shotMeta = async (v, d) => JSON.parse(await readFile(path.join(M, "sheets", v, d, "shots.json"), "utf8")).shots;
let budgetReady = 0, budgetShots = 0, themeBad = 0, shotOverflow = 0, lowProbe = [];
for (const v of V) for (const d of Object.keys(sheetCount[v])) for (const s of await shotMeta(v, d)) {
  if (s.budgetReady != null) { budgetShots++; if (s.budgetReady) budgetReady++; }
  const want = s.mode.startsWith("forced-") ? s.mode.replace("forced-", "") : null;
  if ((s.dataTheme ?? null) !== want) themeBad++;
  if (s.overflow > 0) shotOverflow++;
  if (s.probeVisible != null) lowProbe.push(s.probeVisible);
}

// ---- 표들 ----
const tMeasure = table(["375폭 · 한국어", ...V.map((v) => NAME[v])], [
  row4("`index` 첫 `h2`의 y", (x) => n(x.index375.h2)),
  row4("`index` 질문 입구(`#question-nav`) y", (x) => n(x.index375.questionNav)),
  row4("`index` 시세표 y", (x) => n(x.index375.table)),
  row4("`index` 장 높이", (x) => `${n(x.index375.height)}${x === b ? "" : ` (${ratio(x.index375.height, b.index375.height)})`}`),
  row4("`index` 13.6px 이하 글자 비율", (x) => `${x.index375.small}%`),
  row4("`budget-7eok` 첫 `h2`의 y", (x) => n(x.budget375.h2)),
  row4("`budget-7eok` 요약 문장 y", (x) => n(x.budget375.summary)),
  row4("`budget-7eok` \"한눈에\" 상자 y", (x) => n(x.budget375.answers)),
  row4("`budget-7eok` 장 높이", (x) => `${n(x.budget375.height)}${x === b ? "" : ` (${ratio(x.budget375.height, b.budget375.height)})`}`),
  row4("`budget-7eok` 13.6px 이하 글자 비율", (x) => `${x.budget375.small}%`),
  row4("`rates` 장 높이", (x) => n(x.rates375.height)),
  row4("`rates` 허브 링크 4개 높이", (x) => `${x.rates375.hubLinks[0]}px`),
  row4("`price-outlook` 장 높이", (x) => `${n(x.outlook375.height)}${x === b ? "" : ` (${ratio(x.outlook375.height, b.outlook375.height)})`}`),
  row4("`price-outlook` 13.6px 이하 글자 비율", (x) => `${x.outlook375.small}%`),
  row4("`price-outlook` 권역 표 y", (x) => n(x.outlook375.regionTable)),
  row4("`price-outlook` 보이는 `.low-sample`", (x) => `${x.outlook375.lowVisible}개`),
  row4("`method` 장 높이(선택 추가)", (x) => n(x.method375.height)),
  row4("`style.css` 바이트", (x) => n(x.css.bytes)),
]);
const tA11y = table(["확인", ...V.map((v) => NAME[v])], [
  row4("글자 쌍 대비 4.5:1 미달(네 갈래)", (x) => `${x.contrast.fails.length}건`),
  row4("글자 쌍 최소 대비(라이트 / 다크)", (x) => { const m = (i) => x.contrast.modes[i].pairs.filter((p) => p.kind === "글자").sort((p, q) => p.ratio - q.ratio)[0]; return `${m(0).ratio.toFixed(2)} / ${m(1).ratio.toFixed(2)}`; }),
  row4("무늬·입력 테두리(`--border-strong`) 최소 대비", (x) => { const m = (i) => x.contrast.modes[i].pairs.filter((p) => p.min === 3).sort((p, q) => p.ratio - q.ratio)[0]; return m(0) ? `${m(0).ratio.toFixed(2)} / ${m(1).ratio.toFixed(2)}` : "토큰 없음(빗금은 `--border` 1.29 / 1.37)"; }),
  row4("네 갈래 일치(자동 = 강제)", (x) => (x.contrast.branchesAgree.lightAutoVsForced && x.contrast.branchesAgree.darkAutoVsForced ? "일치" : "**불일치**")),
  ...["index.html", "budget-7eok.html", "rates.html", "price-outlook.html", "method.html"].map((p) => row4(`44px 미만 대화형 요소 \`${p.replace(".html", "")}\``, (x) => `${x.under44[p].under}/${x.under44[p].total}`)),
  row4("입력칸 글자 크기 최솟값", (x) => `${x.fieldMin}px`),
  row4("보이는 글자 크기 최솟값", (x) => `${x.minFont}px`),
  row4("가로 넘침 최대(320·375 × 한·영, 5장)", (x) => `${x.overflowMax}px`),
  row4("`.low-sample` 글자 크기 / 빗금 선 색", (x) => `${x.outlook375.low.fontSize} / ${x.outlook375.low.beforeBorder.replace(/rgb\((\d+), (\d+), (\d+)\)/, (_, r, g, bl) => "#" + [r, g, bl].map((c) => Number(c).toString(16).padStart(2, "0")).join(""))}`),
]);
const under44Detail = T.map((v) => `- **${NAME[v]}**: ` + ["index.html", "budget-7eok.html", "rates.html", "price-outlook.html", "method.html"].map((p) => { const u = o(v).under44[p]; return `\`${p.replace(".html", "")}\` ${u.under}개${u.under ? ` (${Object.entries(u.groups).map(([k, c]) => `${k.replace(/\.budget-rule-link/, ".budget-rule-link")} ×${c}`).join(", ")})` : ""}`; }).join("; ")).join("\n");
const baseUnder = "- **현행**: " + ["index.html", "budget-7eok.html", "rates.html", "method.html"].map((p) => { const u = b.under44[p]; return `\`${p.replace(".html", "")}\` ${u.under}개 (${Object.entries(u.groups).map(([k, c]) => `${k} ×${c}`).join(", ")})`; }).join("; ");

const tInv = table(["확인", ...T.map((v) => NAME[v])], [
  ["invariants 1층(기준 67장 대 시안 67장)", ...T.map((v) => `하드 ${o(v).invariants.hard} · 소프트 ${o(v).invariants.soft} (통과 ${o(v).invariants.pass}/${o(v).invariants.total})`)],
  ["invariants 2층(`index.html`만 바뀜)", ...T.map((v) => `하드 ${o(v).layout.invariants.hard} · 소프트 ${o(v).layout.invariants.soft}`)],
  ["HTML 67장 sha256 동일(1층)", ...T.map((v) => `${o(v).bytes.htmlSame}/${o(v).bytes.htmlTotal}`)],
  ["JS 5개 sha256 동일(1층 / 2층)", ...T.map((v) => `${o(v).bytes.jsAllSame ? "동일" : "**다름**"} / ${o(v).bytes.layoutJsAllSame ? "동일" : "**다름**"}`)],
  ["2층에서 바뀐 HTML", ...T.map((v) => o(v).bytes.layoutHtmlDiff.map((x) => `\`${x}\``).join(", "))],
  ["렌더 비교(초안 `rendered.mjs`: 67장 × 320·375·1280, 스크립트 끔 — 보이는 글자·좁은 폭 넘침·첫 초점)", ...T.map((v) => `통과 ${o(v).rendered.pass}/${o(v).rendered.total}, 하드 ${o(v).rendered.hard}`)],
  ["`innerText` 줄 다중집합(4장 × 375·1280 × 한·영 = 16회, 스크립트 켬) 1층", ...T.map((v) => `같음 ${o(v).innertext.sameLines}/${o(v).innertext.runs}`)],
  ["`innerText` 2층(`index` × 375·1280 × 한·영 = 4회)", ...T.map((v) => `줄 다중집합 같음 ${o(v).layout.innertext.sameLines}/4, 글자 순서 같음 ${o(v).layout.innertext.sameChars}/4`)],
]);
const scanRow = (k, label) => [label, ...T.map((v) => `${Array.isArray(o(v).css.scan[k]) ? o(v).css.scan[k].length : o(v).css.scan[k]} / ${Array.isArray(o(v).css.layoutScan[k]) ? o(v).css.layoutScan[k].length : o(v).css.layoutScan[k]}`)];
const tNew = table(["덧붙인 CSS에서 센 것(1층 / 2층)", ...T.map((v) => NAME[v])], [
  scanRow("fontFace", "`@font-face`"), scanRow("importRule", "`@import`"), scanRow("url", "`url()`"), scanRow("animation", "`animation`"), scanRow("keyframes", "`@keyframes`"), scanRow("transition", "`transition`"), scanRow("sticky", "`position: sticky`"), scanRow("fixed", "`position: fixed`"), scanRow("overflowHidden", "`overflow: hidden`"),
  ["`height:` 선언", ...T.map((v) => (o(v).css.scan.fixedHeight.join(", ") || "0") + " / " + (o(v).css.layoutScan.fixedHeight.join(", ") || "0"))],
  ["새 바깥 요청(막힌 요청 목록이 현행과 다른 것)", ...T.map((v) => `${o(v).newBlocked.length}`)],
  ["새 로컬 요청(장별 자원 목록이 현행과 다른 것)", ...T.map((v) => `${Object.values(o(v).newLocal).flat().length}`)],
  ["화면의 `fixed`/`sticky` 요소", ...T.map((v) => o(v).fixedSticky.map((x) => `\`${x}\``).join(", ") + "(현행과 같음)")],
]);
const tLayout = table(["2층 `index` (375폭 · 한국어)", "현행", ...T.map((v) => `${NAME[v]} 2층`)], [
  ["첫 `h2`의 y", n(b.index375.h2), ...T.map((v) => n(o(v).layout.index375.h2))],
  ["질문 입구 y", n(b.index375.questionNav), ...T.map((v) => n(o(v).layout.index375.questionNav))],
  ["시세표 y", n(b.index375.table), ...T.map((v) => n(o(v).layout.index375.table))],
  ["장 높이 375", n(b.index375.height), ...T.map((v) => `${n(o(v).layout.index375.height)} (${ratio(o(v).layout.index375.height, b.index375.height)})`)],
  ["장 높이 1280", n(b.heights1280["index.html"]), ...T.map((v) => n(o(v).layout.index1280.height))],
  ["가로 넘침(320·375 × 한·영)", `${b.overflow["index.html|ko|320"].px}px(320 한) · ${b.overflow["index.html|en|320"].px}px(320 영)`, ...T.map((v) => `${Math.max(...Object.values(o(v).layout.overflow))}px`)],
  ["44px 미만", `${b.under44["index.html"].under}/${b.under44["index.html"].total}`, ...T.map((v) => `${o(v).layout.under44.under}/${o(v).layout.under44.total}`)],
  ["영어 375 첫 `h2`의 y", n(b.indexEn.h2_375), ...T.map((v) => n(o(v).layout.indexEn375.h2))],
  ["`style.css` 바이트", n(b.css.bytes), ...T.map((v) => n(o(v).layout.styleBytes))],
]);
const tEn = table(["영어 모드 `index`", ...V.map((v) => NAME[v])], [
  row4("375폭 첫 `h2`의 y", (x) => n(x.indexEn.h2_375)), row4("320폭 첫 `h2`의 y", (x) => n(x.indexEn.h2_320)), row4("375폭 장 높이", (x) => n(x.indexEn.height375)), row4("375폭 1층 내비가 상자 안에서 넘치는 폭", (x) => `${x.indexEn.navScroll375}px`),
]);
const tokens = (v) => o(v).contrast.md.tokens;
const TYPE = {
  a: "13 / 15 / 16 / 20 / 24 / 28px — 본문 16, 표 칸·설명·건수·기준일 15, `h2` 20, `h1` 24, 워드마크·가장 큰 답 28, 답 값 20(요약 카드 값 24, 480px 이하 20). 13px은 표 머리글·차트 축·꼬리표(`.live-badge`·`.sector-tag`·`.prev-tag`·`.tag`)·`.brand`, 그리고 360px 이하의 1층 내비. 줄 간격 1.5(현행 유지)",
  b: "12.5 / 14 / 15 / 18 / 22 / 28px — 본문 15(입력칸 16 유지), 표 칸·설명 14, 라벨·건수·기준일 12.5(본문색), `h2` 18, `h1` 22, 값 22(넓은 화면 요약 카드 값·워드마크 28). 줄 간격 1.45",
  c: "13 / 15 / 17 / 20 / 22 / 30px — 본문 17, 표 칸·표본·기준·단서 15(본문색), 답 문장(리드) 20(**480px 이하 18**), `h2` 22, `h1` 30(**560px 이하 26**, 워드마크는 30 유지). 13px은 표 머리글·차트 축·꼬리표·`.brand`·갱신 주기 안내. 줄 간격: 산문 1.75, 답 문장·단서 1.6, 표 1.5",
};
const SPACE = {
  a: "간격 4px 배수(4·8·12·16·24·32·48 가운데 머리·내비·카드·격자에 8·12·16·24를 적용). 반경 8px와 999px 둘",
  b: "간격 4·8·12·16·24(껍데기 여백 12, 타일 안쪽 12~16, 카드 사이 4~8, 표 행 높이 40px — 481px 이상). 반경 6px(비움 꼬리표만 4px)",
  c: "간격 8·16·24·40·64(구획 사이 40, 넓은 화면 64, 바닥글 위 64; 카드 안쪽에 12가 남아 있다). 반경 4px(빗금 칸 2px). 읽는 단 44rem, 넓히는 단 60rem",
};
const changesMd = (v) => o(v).layout.changes.map((c, i) => `${i + 1}. [${c.kind}] ${c.what} — ${c.why}`).join("\n");
const softMd = (v) => (o(v).layout.invariants.softItems ?? []).map((s) => `- \`${s.page}\` ${s.check}: 기준에만 ${s.missing.length} / 후보에만 ${s.added.length}\n${[...s.missing.map((x) => `  - − ${x}`), ...s.added.map((x) => `  - + ${x}`)].join("\n")}`).join("\n") || "- 없음";

const c1 = f.cond1, c2 = f.cond2, c3 = f.cond3;
const sc = (v) => c3.tablesInBox[v]["#score-table"];
const sn = (v) => (o(v).scrollers["budget-7eok.html|375"].find((x) => x.el.includes("sub-nav")) ?? { over: 0 }).over;
const condTable = table(["조건(브리프 3절)", "실측", "판정"], [
  ["1. C의 375폭 장 높이가 현행의 1.3배 초과", `\`index\` ${n(c1.index.base)} → ${n(c1.index.c)}px = ${c1.index.ratio}배(한도 ${n(c1.index.limit)}) · \`budget-7eok\` ${n(c1.budget.base)} → ${n(c1.budget.c)}px = ${c1.budget.ratio}배(한도 ${n(c1.budget.limit)}). 2층 \`index\`는 ${n(c1.layoutIndex.c)}px = ${c1.layoutIndex.ratio}배`, c1.hit ? "**걸림**" : "안 걸림"],
  ["2. C의 375폭에서 `index` 첫 `h2` 또는 `budget-7eok` 요약 문장이 현행보다 아래", `\`index\` 첫 \`h2\` ${c2.indexH2.base} → ${c2.indexH2.c}px(2층 ${c2.indexH2.cLayout}px) · 요약 문장 ${c2.budgetSummary.base} → ${c2.budgetSummary.c}px · (참고) "한눈에" 상자 ${c2.budgetAnswers.base} → ${c2.budgetAnswers.c}px`, c2.hit || c2.hitLayout ? "**걸림**" : "안 걸림(한국어, po 확인). 영어 모드에서는 내려간다 — 「못 맞춘 조건」 2번(po: 조건에 넣지 않고 구현 때 577px 이하로 고칠 결함)"],
  ["3. C의 `price-outlook` 표가 375폭에서 가로로 넘침", `문서 가로 넘침 ${c3.pageOverflow.c}px(현행 ${c3.pageOverflow.base}). 상자 안에서 넘치는 표: 현행 ${Object.entries(c3.tablesInBox.base).map(([k, x]) => `\`${k}\` ${x}px`).join(", ")} → C ${Object.entries(c3.tablesInBox.c).map(([k, x]) => `\`${k}\` ${x}px`).join(", ")}(A ${Object.values(c3.tablesInBox.a)[0]}px, B ${Object.values(c3.tablesInBox.b)[0]}px). 새로 넘치게 된 표 ${c3.newTables.length}개 — 권역 표(비움 칸)·nowcast·입주 표는 넘치지 않는다`, `**판별 불가(po 판정, 댓글 6120035484) — 통과로 치지 않는다.** 엄격하게 읽으면 현행과 A도 걸리고 느슨하게 읽으면 아무도 안 걸린다. 남는 사실: 새로 넘치는 표 ${c3.newTables.length}개, 성적표 상자 안 넘김 ${sc("base")} → ${sc("c")}px(A ${sc("a")})`],
], ["---", "---", "---"]);

const sheetList = V.map((v) => `- \`mockups/sheets/${v}/\` — ${Object.entries(sheetCount[v]).map(([d, c]) => `\`${d}/\` ${c}장`).join(", ")}${v === "base" ? ` (현행을 같은 도구·같은 시각에 다시 찍은 것 ${sheetTotal(v, true)}장)` : ` = 명세 ${sheetTotal(v)}장 + \`method\` 2장(선택 추가)`}`).join("\n");

const missed = [
  `**B 2층(폰)에서 질문 입구가 첫 화면 밖이다.** 브리프의 B 제약은 "질문 입구는 첫 화면에 남긴다(원칙 9)"인데, 같은 브리프의 폰 순서 "추이 카드 2열 → 질문 입구 → 표"대로 놓으면 375×667에서 질문 제목이 ${o("b").layout.index375.h2}px, 질문 묶음(\`#question-nav\`)이 ${o("b").layout.index375.questionNav}px에서 시작한다(현행 ${b.index375.h2}·${b.index375.questionNav}px). 금리·환율 카드 두 장을 시세표 뒤로 보내 줄인 값이 이것이다(넉 장을 다 위에 두면 924px였다). 넓은 화면(1280)에서는 질문 입구가 오른쪽 단 맨 위(y ${o("b").layout.index1280.questionNav}px)에 있다. B 1층은 순서를 바꾸지 않아 질문 입구가 ${o("b").index375.questionNav}px이다.`,
  `**영어 모드에서는 A와 C의 \`index\` 첫 \`h2\`가 현행보다 아래다**: 375폭 현행 ${b.indexEn.h2_375}px → A ${o("a").indexEn.h2_375}px · B ${o("b").indexEn.h2_375}px · C ${o("c").indexEn.h2_375}px (C 2층 ${o("c").layout.indexEn375.h2}px, A 2층 ${o("a").layout.indexEn375.h2}px). 영어 모드는 번역 안내 문단이 하나 더 있고 문장이 길어, 안내 글자를 키운 만큼 밀린다. 뒤집힘 조건 2의 기준값(425·735)은 한국어 화면의 값이라 한국어로 판정했다 — 영어를 조건에 넣을지는 po 판정.`,
  `**2층 거래 유형 내비(\`.sub-nav\`, 8항목)는 여전히 가로로 넘긴다.** 상자 안에서 넘치는 폭이 375폭 \`budget-7eok\`에서 현행 ${sn("base")}px → A ${sn("a")}px · B ${sn("b")}px · C ${sn("c")}px이다(글자가 커진 만큼). 1층 내비 넷은 560px 이하에서 4칸 격자로 바꿔 넘김을 없앴지만, 여덟 항목은 CSS만으로 풀지 못했다(줄바꿈하면 답이 한 줄 더 내려간다). 문서 가로 넘침은 아니다.`,
  `**\`price-outlook\` 성적표(7열)는 세 시안 모두 375폭에서 상자 안에서 넘친다**(현행 ${sc("base")}px, A ${sc("a")} · B ${sc("b")} · C ${sc("c")}px). \`data-label\`이 없는 표라 CSS만으로 카드로 바꿀 수 없다. 넘김 신호(오른쪽 끝 페이드)는 현행 그대로다.`,
  `**C의 글자 축척에 브리프에 없는 두 값이 있다**: 답 문장 20px을 480px 이하에서 18px로, \`h1\` 30px을 560px 이하에서 26px로 내렸다. 375폭에서 20px이면 한 줄이 17자이고, \`h1\` 30px이면 예산대 제목이 석 줄이 된다. 값 조정은 브리프 5절이 engineer에게 맡긴 범위지만 po 확인 대상이다.`,
  `**A의 13px 자리가 브리프보다 넓다**: 브리프는 "13px은 표 머리글과 차트 축에만"인데 꼬리표(\`.live-badge\`·\`.sector-tag\`·\`.prev-tag\`·\`.tag\`)·\`.brand\`·360px 이하의 1층 내비에도 13px을 썼다.`,
  `**B의 동반 변경(theme-color 67장·manifest·아이콘)은 시안 폴더에 넣지 않았다.** HTML을 한 바이트도 바꾸지 않으려는 것이고(invariants 1층 하드 0·소프트 0), 화면 스크린샷에는 드러나지 않는 값이다. 워드마크 색은 \`--accent\`를 따라 먹색으로 바뀌어 화면에 보인다. 아이콘 그림은 만들지 않았다.`,
  `**간격·반경은 주요 자리만 맞췄다.** 기준 \`style.css\`를 지우지 않고 뒤에 덧붙이는 방식이라, 덮지 않은 자리에는 현행 값(6·10·14·18px, 반경 10·12px 등)이 남아 있다. \`style.css\` 바이트가 현행보다 큰 것도 같은 이유다 — #278에서 \`@theme\`로 옮기면 이 값이 아니다.`,
  `**\`method\`의 \`em\` 기울임·\`code\` 11.05px·320폭 \`index\` 넘침 43px·차트 선의 팔레트 밖 색·차트 축 글자 잘림**은 세 시안 공통으로 고쳤다(\`css/common.css\`). 차트 x축 마지막 라벨은 SVG 밖으로 나가는 것을 자르지 않게 했을 뿐이고, 라벨 위치 자체(스크립트)는 그대로다.`,
];

const seen = `**직접 본 것(Read 도구로 원래 크기 구간을 열어 봄)**
- 마지막 실행분의 시트 5구간: \`c/sheet/budget-7eok.forced-dark.1280\`(1500~2700px), \`a/layout/index.auto-dark.375\`(0~1400), \`c/layout/index.auto-light.1280\`(0~1300), \`b/sheet/rates.forced-dark.375\`(전체), \`a/method/method.auto-light.1280\`(0~1200).
- 그 직전 실행분의 시트 12구간(그 뒤 바뀐 CSS는 단지 후보 카드의 \`align-content\` 한 줄뿐이다): \`b/layout/index.auto-light.375\`(0~1500), \`b/layout/index.auto-dark.1280\`(0~1400), \`a/sheet/index.auto-light.1280\`(300~1500), \`c/low-sample/price-outlook.auto-dark.1280\`(300~1600), \`c/sheet/rates.forced-light.375\`(전체), \`a/sheet/budget-7eok.auto-light.375\`(1300~2700), \`b/sheet/index.forced-light.375\`(2200~3600), \`c/en/index.auto-light.375.en\`(0~1200), \`c/sheet/index.auto-light.375\`(5300~끝), \`a/low-sample/price-outlook.auto-light.375\`(3300~4700), \`b/sheet/budget-7eok.auto-dark.375\`(3200~4600), \`c/sheet/budget-7eok.forced-dark.1280\`(1500~2900).
- \`compare.html\`: 1440폭 라이트(0~3000px — 요약 카드 넷과 \`index\` 375 라이트의 현행·A·B·C 나란히), 375폭 다크(0~1700px), 375폭 라이트의 조건 카드·실측 표 구간(좁은 폭에서 표가 잘려 보여 조건 표를 카드로 바꾸고 다시 열어 봤다). 탭 전환은 스크립트로 눌러 22가지 조합 모두 그림 4장이 뜨고 가로 넘침 0px임을 확인했다(눈으로 본 것은 기본 탭뿐이다).
- 그 전 반복에서 본 것(같은 시안, 이후 수정 전): A·B·C 각각 \`index\`·\`budget-7eok\`·\`price-outlook\` 375 라이트 위쪽 1500px, B·C \`index\` 1280 위쪽, 2층 A·B·C 375·1280 라이트 위쪽, C 영어 \`index\` 375, B \`price-outlook\` 강제 다크 375, A·B \`budget-7eok\` 1280, C \`price-outlook\` 1280, C \`rates\` 375, A \`index\` 강제 다크 375(1100~2500), C \`budget-7eok\` 다크 375, C \`method\` 375 위쪽, B \`rates\` 1280.
- 마지막 두 실행분에서 본 구간에는 깨진 레이아웃·겹침·잘린 글자·읽을 수 없는 대비가 없었다. 보면서 찾아 고친 것: B 넓은 화면 표의 세로 정렬, A 넓은 화면 시세표 칸 접힘, 금리 허브 목록 들여쓰기, 단지 후보 카드의 값 줄과 줄 간격, B 2층의 순서(질문 입구가 924px이던 것), C 넓은 화면에서 열이 적은 표가 60rem으로 벌어지던 것.

**보지 못한 것**
- 시안당 34장(+method 2장) 가운데 위에 적지 않은 장 전부 — 특히 강제 라이트·강제 다크의 대부분, \`rates\` A 낱장, 영어 1280, \`method\` 375(A·B), 2층 다크 1280(A·C), 긴 장의 아래쪽 구간 대부분.
- 기계 확인만 한 것: 시트 ${V.map((v) => sheetTotal(v, true)).reduce((a, c) => a + c, 0)}장 모두 \`data-theme\`이 기대값과 같고(어긋남 ${themeBad}), 문서 가로 넘침 0px(넘친 장 ${shotOverflow}), 예산대 ${budgetShots}장 모두 예산 구획이 보인 뒤 찍힘(${budgetReady}/${budgetShots}), \`price-outlook\` ${lowProbe.length}장 모두 보이는 \`.low-sample\` ${[...new Set(lowProbe)].join("·")}개.
- 실기기(iOS Safari·안드로이드), 스크린리더, 키보드 초점 순서의 눈 확인(첫 초점은 렌더 비교가 67장에서 현행과 같다고 판정), 768폭·1440폭 이상, 인쇄, 광고·분석이 붙은 화면, 5장 밖의 62장의 화면(이 62장은 렌더 비교의 글자·넘침·첫 초점만 통과).`;

const limits = `- **높이·위치 값은 헤드리스 Chrome ${S.chrome.replace("Chrome/", "")}, macOS, 뷰포트 375×667(1280은 800), 배율 1, load 뒤 1.5초의 값이다.** 글꼴은 이 머신의 시스템 글꼴(Apple SD Gothic Neo)이라 안드로이드·윈도에서는 줄바꿈과 높이가 달라진다. C의 조건 1·2는 여유가 있지만(높이 ${c1.index.ratio}배·${c1.budget.ratio}배, 답 위치 ${c2.indexH2.base - c2.indexH2.c}px·${c2.budgetSummary.base - c2.budgetSummary.c}px 위) 다른 글꼴에서의 값은 재지 않았다.
- **C의 답 위치는 머리·내비 여백을 줄여서 맞춘 것이다**(껍데기 위 여백 24 → 16px, 머리 아래 20 → 8px, 내비·검색 사이 20·12 → 8px). 글자만 키우고 여백을 그대로 두면 내려간다. 즉 조건 2 통과는 C라는 방향의 성질이 아니라 이 시안의 여백 선택에 달려 있다.
- **44px는 요소 상자 높이로 셌다**(브리프 4절). 뉴스 제목·단지 후보 이름·금리 허브 링크는 줄 높이를 늘리지 않고 위아래 안쪽 여백으로 누르는 자리만 넓혔다(현행 \`style.css\`가 표 안 링크에 쓰는 수법, UIUX #50). 누르는 자리가 이웃 링크와 겹치는지는 금리 허브(칸 간격으로 분리)만 따졌고 나머지는 눈으로 보지 않았다.
- **13.6px 이하 비율은 \`main\` 안 보이는 텍스트 노드의 공백 뺀 글자 수 기준이다.** po의 값(index 64%, budget 57%, price-outlook 73%)과 비율은 같고 글자 수의 절댓값은 세는 법이 달라 다르다. SVG 축 글자와 \`::before\`가 그리는 \`data-label\`은 이 셈에 들어가지 않는다.
- **\`innerText\` 비교는 "n시간 전" 같은 글자가 기준과 후보 사이에 갈릴 수 있다.** 장마다 연달아 열어 줄였고 이번 실행에서는 갈리지 않았다.
- **대비 표는 토큰 쌍의 계산값이다.** 빗금처럼 1px 선으로 그리는 무늬가 실제 화면에서 3:1로 보이는지는 선 굵기·배율에 달려 있어 눈으로 본 것(위 본 범위)이 근거다. \`--border\`(장식 테두리)는 기준이 없어 표에 참고로만 적었다.
- **B 동반 변경의 범위(브리프 미해결 5)**: \`docs/sw.js\`의 \`SHELL_ASSETS\`에 아이콘 두 장이 들어 있어(13~14행, \`CACHE_NAME = "jipgye-v15"\`) 아이콘 파일을 바꾸면 캐시 이름을 올려야 설치된 화면이 새 아이콘을 받는다 — 코드를 읽은 것이고 실행으로 확인하지 않았다. \`og:image\`는 주소가 같고 파일만 바뀌므로 바깥(메신저·검색)의 미리보기 캐시가 언제 바뀌는지는 **확인 못함**. \`theme-color\`는 67장 모두 \`#253e81\` 한 값이고(\`grep\`으로 셈), invariants 도구는 이 값 하나를 허용 예외로 둔다.
- **2층은 \`index\` 한 장뿐이다.** 답이 첫 화면 밖인 문제가 가장 큰 예산대 장의 레이아웃 방향은 만들지 않았다(브리프 미해결 4, pm 판정 대기).
- GA·Search Console·애드센스 값은 이 환경에서 볼 수 없어 쓰지 않았다. 방문자의 폰·영어 비율은 소유자가 콘솔에서 볼 것.`;

const handoff = `- **po**: 권장 확정(C/A). 조건 3의 성적표 해석, 영어 모드에서 A·C의 첫 \`h2\`가 내려간 것, C의 폰 글자 두 값(18·26px), A의 13px 자리, \`low-sample\`이 묻히지 않았는지(B는 칸 전체 빗금 + 테두리 꼬리표, A·C는 진한 빗금 칸 + 15px 글자)의 판정.
- **cmo**: 2층의 본문 순서 변화(B는 안내 문단이 검색창 아래에서 금리·환율 뒤로, 추이 카드가 질문 입구 앞으로), 광고가 끼어들 자리(B 타일 격자·C 44rem 단), B의 브랜드색 변경. 새 \`sticky\`/\`fixed\`는 0이다.
- **pm**: B 2층 폰의 질문 입구 위치(브리프 안의 두 요구가 부딪힌다)를 D1 문안에 적을지, 브리프 미해결 4(예산대 레이아웃 방향 1장) 판정, \`compare.html\` 전달 수단.
- **engineer(다음)**: 방향이 정해지면 \`test/style.test.mjs\`에서 바뀌는 시험 목록(브리프 미해결 7). 이 시안 CSS는 덮어쓰기라 그대로 옮기지 않고 토큰 표를 #278의 \`@theme\`로 옮긴다.`;


const P = JSON.parse(await readFile(path.join(M, "measure/summary-before-fix.json"), "utf8"));
const FD = JSON.parse(await readFile(path.join(M, "measure/fix-sheet-diff.json"), "utf8"));
const pc = P.variants.c, nc = o("c");
const same375 = ["index375", "budget375", "rates375", "method375"].every((k) => JSON.stringify(pc[k]) === JSON.stringify(nc[k])) && pc.outlook375.height === nc.outlook375.height && JSON.stringify(P.flip.cond1) === JSON.stringify(f.cond1) && JSON.stringify(P.flip.cond2) === JSON.stringify(f.cond2);
const fixSection = `**무엇을 고쳤나 (po 검토 댓글 6120035484의 결함 1 — C \`index\` 1280폭의 왼쪽 정렬선 둘)**

- 원인: C의 넓은 화면 규칙이 표·차트 격자·카드 묶음을 전부 60rem 띠로 넓혔다. 추이 카드 두 장은 격자의 "그 외 지표 더보기" 줄이 빈 칸을 접지 못하게 해 띠의 왼쪽 632px만 차지했고, 정렬선이 288px·160px로 번갈아 나왔다.
- 고친 규칙(\`css/c.css\`, 1024px 이상에만 걸린다): **넓히는 것은 띠를 가득 채우는 블록뿐**이다.
  - 열이 넷 이상인 표(\`.table-wrap:has(th:nth-child(4))\`)만 60rem — \`index\` 시세표. 세 열 이하(금리·환율 표)는 44rem 단 안.
  - 차트 격자는 단 안에서 두 칸. 보이는 카드가 **정확히 석 장**일 때만 세 칸으로 띠를 채운다(\`budget-7eok\`의 "최근 추이").
  - 요약 카드(\`.overall-cards\`)·\`.stat-cards\`·\`.options\`·\`.complex-card\`·"더보기"·단추·링크·단서는 전부 단의 정렬선.
  - 같은 결함 목록의 2번도 같이: 넓은 화면에서 "최고·최저"는 늘 값 아래 줄(카드마다 옆·아래로 갈리던 것).
- 결과(1280폭에서 \`main\`과 구획의 직계 블록 왼쪽·오른쪽 끝을 스크립트로 셈):

| C 1280폭 | 블록의 왼쪽~오른쪽 끝 |
|---|---|
| \`index\` 1층·2층 | 288~992px 27개 + **160~1120px 1개(시세표, 좌우 대칭)** |
| \`budget-7eok\` | 288~992px 19개 + **160~1120px 1개("최근 추이" 차트 석 장, 좌우 대칭)** |
| \`rates\`·\`price-outlook\`·\`method\` | 288~992px만(6·30·5개) — 고치기 전에도 어긋남이 없었다 |

**다시 잰 값**

| C | 고치기 전 | 고친 뒤 |
|---|---:|---:|
| \`index\` 1280 장 높이 | ${n(pc.heights1280["index.html"])} | ${n(nc.heights1280["index.html"])} |
| \`budget-7eok\` 1280 장 높이 | ${n(pc.heights1280["budget-7eok.html"])} | ${n(nc.heights1280["budget-7eok.html"])} |
| 2층 \`index\` 1280 장 높이 | ${n(pc.layout.index1280.height)} | ${n(nc.layout.index1280.height)} |
| \`style.css\` 바이트(1층 / 2층) | ${n(pc.css.bytes)} / ${n(pc.layout.styleBytes)} | ${n(nc.css.bytes)} / ${n(nc.layout.styleBytes)} |
| 375폭 값 전부(첫 \`h2\`·요약 문장·장 높이·글자 비율)와 뒤집힘 조건 1·2 | – | ${same375 ? "**달라지지 않았다**(1024px 이상에만 걸리는 규칙)" : "**달라졌다 — 3·4절 표를 볼 것**"} |
| invariants 1층 / 2층 | 하드 0·소프트 0 / 하드 0·소프트 0 | 하드 ${nc.invariants.hard}·소프트 ${nc.invariants.soft} / 하드 ${nc.layout.invariants.hard}·소프트 ${nc.layout.invariants.soft} |
| 렌더 비교 67장 · \`innerText\` 16회 | 통과 67 · 같음 16 | 통과 ${nc.rendered.pass} · 같음 ${nc.innertext.sameLines} |
| 가로 넘침 최대 · 대비 미달 · 글자 최소 · 입력 최소 | 0px · 0건 · 13px · 16px | ${nc.overflowMax}px · ${nc.contrast.fails.length}건 · ${nc.minFont}px · ${nc.fieldMin}px |
| 44px 미만 index / budget / rates / price-outlook / method | 0 / 4 / 2 / 0 / 12 | ${["index.html", "budget-7eok.html", "rates.html", "price-outlook.html", "method.html"].map((p) => nc.under44[p].under).join(" / ")} |
| HTML 67장·JS 5개 sha256 | 동일 | ${nc.bytes.htmlSame}/67 · ${nc.bytes.jsAllSame ? "동일" : "다름"} |

**바뀐 파일**

- \`css/c.css\`(넓히는 규칙), \`out/c/docs/style.css\`·\`out/c-layout/docs/style.css\`(다시 지음). A·B의 CSS와 산출물은 건드리지 않았다.
- \`sheets/c/\` 36장을 다시 찍었다. 픽셀이 바뀐 것은 ${FD.changed.length}장: 1280폭 \`index\` 4장·\`budget-7eok\` 4장·2층 \`index\` 2장·영어 \`index\` 1장(정렬), 그리고 375폭 \`index\` 계열 7장(뉴스의 "n시간 전" 글자가 시각에 따라 바뀐 것 — 높이와 위치는 같다). \`rates\`·\`price-outlook\`·\`method\`와 375폭 \`budget-7eok\` ${FD.same.length}장은 바이트까지 같다. 고치기 전 C 시트는 \`sheets-c-before-fix/\`에 남겼다.
- \`compare.html\`(${n(compareBytes)}바이트 = ${mb(compareBytes)}MB): C 그림을 다시 내장하고 문구를 po 검토에 맞췄다 — 맨 위에 po의 소유자 문안(최종) 네 문장과 선택지 넷, "po 권장", 조건 3 "판별 불가(po)", B 카드에 "고르면 폰은 질문 입구가 먼저"·"표본 부족 표시는 A·C 방식으로", A·C에 영어 화면 첫 제목 한 줄, A에 2층 넓은 화면의 제각각 폭. 375·1440폭 라이트·다크 가로 넘침 0px, 외부 요청 0, 탭 22가지 조합 모두 그림 4장.
- \`measure/c*.json\`·\`summary.json\`(다시 잼), \`measure/summary-before-fix.json\`(고치기 전 요약), \`REPORT.md\`.

**직접 본 것(수정분)**: 다시 찍은 C \`index\` 1280 — 1층 자동 라이트 전체(0~4,759px 세 구간), 2층 자동 라이트(700~2,200px), 2층 자동 다크(1,400~2,900px), 1층 강제 다크(800~2,300px), 그리고 \`budget-7eok\` 자동 라이트 1280(3,300px~끝). 제목·안내·검색·단추·링크·지역 선택·추이 카드·"더보기"·단서·금리 표·차트·요약·뉴스·바닥글이 모두 288px 선에 서고, 시세표 하나만 좌우 대칭으로 넓다. \`compare.html\`은 1440폭 라이트 위쪽 1,500px과 맨 아래(조건 카드·실측 표), 375폭 다크 위쪽 1,800px을 봤다. 강제 라이트·자동 다크 1280의 1층 \`index\`, 영어 1280, \`budget-7eok\` 다크·강제 1280은 열어 보지 않았다(같은 CSS이고, 블록 위치를 스크립트로 센 것은 자동 라이트다).

**남은 결함(이번에 고치지 않은 것)**

- \`budget-7eok\` 1280의 "최근 추이" 석 장은 띠를 채워 넓혔다. po의 기준("넓히는 블록은 띠를 채우고 좌우 대칭")에는 맞지만 그 구획에서 제목(288px)과 카드(160px)의 시작이 다르다 — 단 안에 2+1로 둘지는 po 판정.
- 표 칸의 안쪽 여백 때문에 표 안 글자는 정렬선보다 16px 안쪽에서 시작한다(금리·환율 표 304px, 시세표 176px).
- po 결함 7(차트 x축 마지막 라벨이 카드 오른쪽 끝을 넘는다 — \`index\` 1280에서 "10/5"·"10/12"가 992px 선을 넘는다)·8("이동" 단추가 혼자 다음 줄)·10(단지 후보 카드의 주소 줄)·영어 화면 첫 \`h2\`(A 615·C 616px)·C의 갱신 주기 안내 13px(po 불승인 — 15px로 올리거나 바닥글로)은 손대지 않았다. 구현 때 고칠 것으로 남는다.
- A·B 시안은 다시 찍지 않았다(바뀐 것이 없다). po가 적은 A 2층 1280의 제각각 폭, B 2층 폰 순서, B의 \`low-sample\`은 시안 그림에 그대로 있고 \`compare.html\` 문구로만 알렸다.`;

const header = `기준 \`${S.baseSha}\`의 \`docs/\` 사본(\`git archive\`)에 시안 CSS를 덧붙여 만든 **로컬 시안**이다. 저장소에 푸시·PR·브랜치 없음, 공유 사본 작업 트리 불변, 배포 사이트 불변, 유료 API·workflow dispatch 없음. 측정: 헤드리스 ${S.chrome}, 페이지 스크립트 켬, 바깥 요청 차단, load 뒤 1.5초(예산대 장은 #288 때문에 예산 구획이 다시 보인 뒤부터 1.5초). invariants는 main \`00b59502\`의 \`tools/golden\`.`;

const conclusion = `1. 시안 3종(A 정돈·B 계기판·C 보고서)의 1층 CSS와 2층 \`index\` 1장, 시안당 스크린샷 ${sheetTotal("a")}장(+\`method\` 2장), 소유자용 비교 한 장(\`mockups/compare.html\`, ${n(compareBytes)}바이트 = ${mb(compareBytes)}MB, 그림 ${CB.images}장 내장, 외부 요청 0)을 만들었다.
2. 세 시안 모두 1층 invariants 하드 0·소프트 0, HTML 67장·JS 5개 바이트 동일, 글자 대비 미달 0건, 320·375 가로 넘침 0px, 입력 16px, 글자 하한 ${Math.min(...T.map((v) => o(v).minFont))}px 이상, 웹폰트·움직임·새 \`sticky\`/\`fixed\`·새 요청 0이다.
3. **po 권장 C가 뒤집히는 조건 1·2는 한국어 375폭 실측에서 걸리지 않았고**(높이 ${c1.index.ratio}배·${c1.budget.ratio}배, 첫 \`h2\` ${c2.indexH2.base} → ${c2.indexH2.c}px, 요약 문장 ${c2.budgetSummary.base} → ${c2.budgetSummary.c}px), 조건 3은 po가 "판별 불가"로 판정했다(성적표 상자 안 넘김 현행 ${sc("base")} → C ${sc("c")}px, A ${sc("a")}px — C와 A를 가르지 못한다). **po는 권장을 C로 확정했다**(댓글 6120035484). 못 맞춘 것 가운데 가장 큰 것은 **B 2층 폰에서 질문 입구가 첫 화면 밖(${o("b").layout.index375.questionNav}px)**인 것이다 — po 판정: B를 고르면 폰은 질문 입구가 먼저 오는 순서로 간다.`;

const report = `# #275 디자인 시안 3종 — 제작과 실측 (engineer)

${header}

## 0. 수정분 (2026-10-12, po 검토 뒤)

${fixSection}

## 1. 결론

${conclusion}

## 2. 만든 것

| 무엇 | 어디 |
|---|---|
| 소유자용 비교 한 장 | \`mockups/compare.html\` — ${n(compareBytes)}바이트(${mb(compareBytes)}MB, 한도 14MB). WebP 품질 ${CB.quality}, 긴 장은 위쪽 ${n(CB.crop["375"])}px(모바일)·${n(CB.crop["1280"])}px(데스크톱)만 싣고 전체 높이를 그림 위에 표기. 탭: 장 6(\`index\`·\`budget-7eok\`·\`rates\`·\`price-outlook\`·레이아웃 방향·영어) × 모드(라이트·다크) × 폭(375·1280), 보기(현행·A·B·C 켜고 끄기, 원래 크기) |
| 1층 CSS(전 장) | \`mockups/css/common.css\`(세 시안 공통 결함 수정) + \`a.css\`·\`b.css\`·\`c.css\` |
| 2층 CSS·구조 | \`mockups/css/{a,b,c}-layout.css\`, 구조 변경은 \`mockups/tools/build-layout.mjs\`(문자열 한 번 찾기로 요소를 옮기거나 감싼다) |
| 지은 시안 폴더 | \`mockups/out/{a,b,c}/docs\`(1층), \`mockups/out/{a,b,c}-layout/docs\`(2층). \`style.css\` = 기준 \`style.css\` + 공통 + 시안 CSS(뒤에 덧붙임) |
| 스크린샷 시트 | \`mockups/sheets/{base,a,b,c}/\` — 아래 9절 |
| 측정 원본 | \`mockups/measure/*.json\`(probe·대비·invariants·렌더 비교·innerText·요약), 실행 로그 \`mockups/logs/\` |
| 도구 | \`mockups/tools/\`(이번에 쓴 것), \`mockups/render-tools/\`(초안 사본), \`mockups/tools-src/tools/golden\`(main의 invariants 도구, \`npm ci\`) |

## 3. 현행 대비 실측 (375×667, 한국어)

${tMeasure}

- y는 문서 맨 위에서 요소 위쪽까지의 px. 현행 값은 po 브리프의 값(425·735·947·5,788·6,927)과 같다.
- \`style.css\` 바이트는 기준 65,108에 덧붙인 만큼 늘어난 값이다(공통 \`common.css\` ${n(commonBytes)}바이트 + 시안 CSS). 덮어쓰기 방식의 크기라 #278에서 옮긴 뒤의 크기를 뜻하지 않는다.

## 4. po 권장 C가 뒤집히는 조건의 판정

${condTable}

## 5. 불변 확인

${tInv}

- 2층 소프트 목록:
  - A 2층·C 2층: 소프트 0. 옮긴 \`#update-schedule\`은 구운 HTML에서 빈 요소(스크립트가 채운다)라 invariants의 텍스트 순서에는 잡히지 않는다. 화면의 글자 순서는 바뀐다(\`innerText\` 글자 순서 같음 0/4, 줄 다중집합 같음 4/4).
  - B 2층:
${softMd("b").split("\n").map((l) => "  " + l).join("\n")}
- JS 5개: ${S.js.files.map((x) => `\`${x}\``).join(", ")} — 기준 sha256과 같다(값은 \`measure/summary.json\`의 \`js.base\`).

## 6. 접근성 실측

${tA11y}

44px 미만 목록(375폭, \`a\`·\`button\`·\`input\`·\`select\`·\`summary\`의 상자 높이). 남은 것은 전부 문단 안의 글자 링크다(문장 안 링크 — 접근성 기준의 예외로 표시).

${baseUnder}
${under44Detail}

영어 모드:

${tEn}

대비 표(브라우저가 계산한 토큰 값, 네 갈래). ✗는 미달.

${T.map((v) => `<details><summary>${NAME[v]} — 미달 ${o(v).contrast.fails.length}건</summary>\n\n${o(v).contrast.md.pairs}\n\n</details>`).join("\n\n")}

## 7. 새 외부 요청·웹폰트·움직임·\`sticky\`/\`fixed\`

${tNew}

- \`height:\` 선언은 장식 상자(빗금 칸 16·18px, 제목 밑줄 3px)와 B의 표 칸 높이 40px(표 칸의 \`height\`는 최소 높이로 동작한다)뿐이다. 본문 컨테이너의 고정 높이·\`overflow: hidden\`은 없다.
- 차트 SVG에 \`overflow: visible\`을 줬다(축 글자가 잘리던 것). 문서 가로 넘침은 0px 그대로다.

## 8. 토큰 표

${T.map((v) => `### ${NAME[v]}\n\n${tokens(v)}\n\n- 글자: ${TYPE[v]}\n- ${SPACE[v]}\n- 네 갈래: 자동 라이트 = 강제 라이트, 자동 다크 = 강제 다크(브라우저 계산값으로 확인).`).join("\n\n")}

세 시안 공통: 글꼴은 현행 스택 뒤에 \`"Noto Sans KR", system-ui\`만 덧붙였다(웹폰트 0). \`--link\`·\`--border-strong\`을 새로 뒀다. B만 \`--stripe\`(표 줄무늬)가 더 있다.

## 9. 스크린샷 시트

${sheetList}

- 파일 이름: \`<장>.<갈래>.<폭>[.en].png\`, 폴더마다 \`shots.json\`(환경·sha256·\`data-theme\`·넘침·예산 구획 준비 여부).
- 명세 34장 = 대표 3장 × 네 갈래 × 2폭 24 + \`price-outlook\` × 라이트·다크 × 2폭 4 + 영어 \`index\` × 2폭 2 + 2층 \`index\` × 라이트·다크 × 2폭 4. \`price-outlook\`은 보이는 \`.low-sample\`이 16개라 대체 장으로 바꾸지 않았다.
- 예산대 ${budgetShots}장은 모두 예산 구획이 다시 보이고 거래 목록이 그려진 뒤 찍었다(${budgetReady}/${budgetShots}, #288).

## 10. 2층(\`index\` 레이아웃 방향) — 바꾼 목록과 실측

**A 2층**

${changesMd("a")}

**B 2층**

${changesMd("b")}

**C 2층**

${changesMd("c")}

${tLayout}

- 브리프의 레이아웃 방향 가운데 **DOM을 바꾸지 않고 되는 것은 1층에 넣어 전 장에 입혔다**: 1층 내비 4칸 격자(560px 이하, 세 시안 공통), A의 표 왼쪽 붙이기(최대 56rem), C의 가운데 44rem 단 + 시세표·차트 격자 60rem. 그래서 2층에만 있는 것은 A: 머리 줄이기 + "AI 요약 | 뉴스" 2단, B: 12단 격자와 순서, C: 질문 목록 + 읽는 법 리드다.
- 제목 순서(\`h1\`~\`h6\`)는 세 시안 모두 그대로다(invariants \`headings\` 하드 0). B는 제목이 없는 묶음만 제목 사이로 옮겼다.

## 11. 못 맞춘 조건과 브리프와 달라진 점

${missed.map((m, i) => `${i + 1}. ${m}`).join("\n")}

## 12. 직접 본 범위

${seen}

## 13. 판단과 한계

${limits}

## 14. 다른 팀원에게 넘길 것

${handoff}

**소유자 결정 요청**: 이 보고서에서는 없다. D1(방향 선택)은 pm이 po 권장 확정 뒤 한 번에 올린다(#275 본문).

**올릴 이슈 초안**: 없음. 고친 결함(320폭 \`index\` 넘침, \`method\`의 \`code\` 11.05px·\`em\` 기울임, 기본 링크 색, 금리 허브 링크 18px, 차트 선의 고정색)은 어느 방향이든 #278 체인에서 같이 들어간다 — 방향이 "셋 다 아님"으로 정해지면 그때 \`[개선]\`으로 따로 올릴 것.

## 15. 재현

\`\`\`
cd mockups
sh tools/run-all.sh            # 짓기(1층·2층) → probe·대비·invariants·렌더 비교·innerText → 시트(현행·A·B·C)
node tools/summary.mjs         # measure/summary.json
node tools/build-compare.mjs --quality ${CB.quality} --mobile-crop ${CB.crop["375"]} --desktop-crop ${CB.crop["1280"]}   # compare.html
node tools/build-report.mjs    # REPORT.md, comment.md
\`\`\`

정리: 임시 서버·헤드리스 Chrome은 도구가 실행마다 닫는다(남은 프로세스 0 확인). 스크래치패드의 시험용 스크린샷은 지웠다. \`mockups/\` 밖의 파일은 쓰지 않았다(\`jipgye-ui-baseline\`의 기존 파일 읽기 전용, 공유 사본 \`~/workspace/jipgye\`는 \`git archive\`·\`git log\`로 읽기만).
`;

const comment = `시안: engineer — 디자인 시안 3종(A 정돈·B 계기판·C 보고서) 제작과 실측(#275 범위, 브리프 4절). 로컬 시안이고 저장소·배포 사이트는 바뀌지 않았다.

${header}

## 결론

${conclusion}

## 현행 대비 실측 (375×667, 한국어)

${tMeasure}

## po 권장 C가 뒤집히는 조건의 판정

${condTable}

## 불변 확인

${tInv}

B 2층의 소프트(텍스트 순서) 3건: 안내 문단과 "숫자를 만드는 방법 →"이 13·14번째 → 94·95번째로, "지역 선택"이 83번째 → 13번째로. A·C 2층은 소프트 0(옮긴 \`#update-schedule\`은 구운 HTML에서 빈 요소).

## 접근성

${tA11y}

- 44px 미만으로 남은 것은 세 시안 모두 문단 안의 글자 링크뿐이다(\`budget-7eok\`의 \`.budget-rule-link\` 4개, \`rates\` 연결 문단의 1~2개, \`method\` 본문 12개). \`rates\`의 허브 링크 4개는 18 → ${o("a").rates375.hubLinks[0]}·${o("b").rates375.hubLinks[0]}·${o("c").rates375.hubLinks[0]}px.
- 영어 모드 \`index\` 375폭 첫 \`h2\`: 현행 ${b.indexEn.h2_375} → A ${o("a").indexEn.h2_375} · B ${o("b").indexEn.h2_375} · C ${o("c").indexEn.h2_375}px. 1층 내비는 560px 이하에서 4칸 격자로 바꿔 영어에서도 넷째가 잘리지 않는다(현행은 상자 안에서 ${b.indexEn.navScroll375}px 넘침).

${T.map((v) => `<details><summary>대비 표 — ${NAME[v]} (미달 ${o(v).contrast.fails.length}건)</summary>\n\n${o(v).contrast.md.pairs}\n\n${tokens(v)}\n\n- 글자: ${TYPE[v]}\n- ${SPACE[v]}\n\n</details>`).join("\n\n")}

## 새 외부 요청·웹폰트·움직임·\`sticky\`/\`fixed\`

${tNew}

## 2층(\`index\` 레이아웃 방향)

${tLayout}

<details><summary>2층에서 바꾼 목록</summary>

**A 2층**

${changesMd("a")}

**B 2층**

${changesMd("b")}

**C 2층**

${changesMd("c")}

DOM을 바꾸지 않고 되는 방향(1층 내비 4칸 격자, A의 표 왼쪽 붙이기, C의 가운데 44rem 단 + 60rem 표)은 1층에 넣어 전 장에 입혔다.

</details>

## 못 맞춘 조건과 브리프와 달라진 점

${missed.map((m, i) => `${i + 1}. ${m}`).join("\n")}

## 시트 파일 (이미지는 올리지 않는다 — 로컬 \`~/workspace/jipgye-ui-baseline/mockups/\`)

- \`compare.html\` — 소유자용 비교 한 장(현행·A·B·C, ${mb(compareBytes)}MB, 그림 ${CB.images}장 내장, 외부 요청 0)
${sheetList.replaceAll("`mockups/", "`")}
- \`REPORT.md\` — 이 댓글의 전체판(토큰 표·44px 목록·재현 명령), \`measure/\` — 측정 원본 JSON, \`css/\` — 시안 CSS

## 직접 본 범위

${seen}

## 판단과 한계

${limits}

## 넘길 것

${handoff}
`;
const fixComment = `수정분: engineer — po 검토(6120035484)의 결함 1(C \`index\` 1280폭 정렬선)을 고쳐 C 시트를 다시 찍고, \`compare.html\` 문구를 po 검토에 맞췄다. 로컬 시안이고 저장소·배포 사이트는 바뀌지 않았다. 앞 댓글(6119934658)의 값 가운데 바뀐 것은 아래 표뿐이다.

${fixSection}
`;
await writeFile(path.join(M, "measure", "comment-fix.md"), fixComment);
await writeFile(path.join(M, "REPORT.md"), report);
await writeFile(path.join(M, "measure", "comment.md"), comment);
console.log(`REPORT.md ${Buffer.byteLength(report).toLocaleString()}바이트, comment.md ${Buffer.byteLength(comment).toLocaleString()}바이트(GitHub 댓글 한도 65,536자: ${comment.length.toLocaleString()}자)`);
