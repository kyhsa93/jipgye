#!/usr/bin/env node
// measure/*.json을 읽어 보고서·댓글·비교 한 장이 같이 쓰는 요약(measure/summary.json)과 마크다운 표(measure/summary.md)를 만든다.
// 숫자를 손으로 옮겨 적지 않으려는 것이다 — 세 문서의 표는 전부 여기서 나온다.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const M = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const J = async (f) => JSON.parse(await readFile(path.join(M, "measure", f), "utf8"));
const V = ["base", "a", "b", "c"];
const NAME = { base: "현행", a: "A 정돈", b: "B 계기판", c: "C 보고서" };
const data = {};
for (const v of V) data[v] = (await J(`${v}.json`)).results;
const layout = {};
for (const v of ["a", "b", "c"]) layout[v] = (await J(`${v}-layout.json`)).results;
const get = (rs, page, width, lang = "ko") => rs.find((r) => r.page === page && r.width === width && r.lang === lang);
const n = (x) => (x == null ? "–" : x.toLocaleString("en-US"));

const S = { generatedAt: new Date().toISOString(), baseSha: "8c984329", chrome: (await J("base.json")).chrome, variants: {} };

// ---- 현행 대비 실측(375폭, 한국어) ----
for (const v of V) {
  const rs = data[v];
  const ix = get(rs, "index.html", 375), bu = get(rs, "budget-7eok.html", 375), ra = get(rs, "rates.html", 375), po = get(rs, "price-outlook.html", 375), me = get(rs, "method.html", 375);
  S.variants[v] = {
    name: NAME[v],
    index375: { h2: ix.firstH2.y, questionNav: ix.y.questionNav, table: ix.y.realestateTable, height: ix.height, small: ix.text.ratio },
    budget375: { h2: bu.firstH2.y, summary: bu.y.budgetSummary, answers: bu.y.budgetAnswers, height: bu.height, small: bu.text.ratio },
    rates375: { h2: ra.firstH2.y, hub: ra.y.rateHub, height: ra.height, small: ra.text.ratio, hubLinks: ra.hubLinks },
    outlook375: { h2: po.firstH2.y, lead: po.y.lead, regionTable: po.y.regionTable, height: po.height, small: po.text.ratio, lowVisible: po.lowSample.visible, low: po.lowSample.first, scrollers: po.scrollers.filter((s) => s.el.includes("table")) },
    method375: me ? { height: me.height, small: me.text.ratio, min: me.minFont.px } : null,
    heights1280: Object.fromEntries(["index.html", "budget-7eok.html", "rates.html", "price-outlook.html", "method.html"].map((p) => [p, get(rs, p, 1280)?.height])),
  };
}
// ---- 넘침(320·375, 한·영), 글자 하한, 입력, 44px ----
const PAGES = ["index.html", "budget-7eok.html", "rates.html", "price-outlook.html", "method.html"];
for (const v of V) {
  const rs = data[v];
  const o = S.variants[v];
  o.overflow = {};
  for (const p of PAGES) for (const lang of ["ko", "en"]) for (const w of [320, 375]) { const r = get(rs, p, w, lang); if (r) o.overflow[`${p}|${lang}|${w}`] = { px: r.overflow, over: r.over }; }
  o.overflowMax = Math.max(...Object.values(o.overflow).map((x) => x.px));
  o.overflowNonZero = Object.entries(o.overflow).filter(([, x]) => x.px > 0).map(([k, x]) => `${k.replaceAll("|", " ")} +${x.px}px (${x.over.join(", ")})`);
  o.minFont = Math.min(...rs.map((r) => r.minFont.px));
  o.minFontWhere = [...new Set(rs.filter((r) => Math.abs(r.minFont.px - o.minFont) < 0.001).flatMap((r) => r.minFont.els.map((e) => `${r.page} ${e}`)))].slice(0, 6);
  o.fieldMin = Math.min(...rs.filter((r) => r.fieldMin != null).map((r) => r.fieldMin));
  o.under44 = {};
  for (const p of PAGES) { const r = get(rs, p, 375); if (!r) continue; const groups = {}; for (const u of r.interactive.list) { const k = `${u.el.replace(/#[\w-]+/, "")}${u.inSentence ? " [문장 안]" : ""} — ${u.h}px`; groups[k] = (groups[k] ?? 0) + 1; } o.under44[p] = { under: r.interactive.under44, total: r.interactive.total, notSentence: r.interactive.under44NotSentence, groups, list: r.interactive.list }; }
  o.fixedSticky = [...new Set(rs.flatMap((r) => r.fixedSticky))];
  o.blocked = [...new Set(rs.flatMap((r) => r.blocked.map((u) => u.replace(/\?.*$/, ""))))].sort();
  o.localRequests = Object.fromEntries(PAGES.map((p) => [p, get(rs, p, 375)?.localRequests.map((u) => u.replace(/\?.*$/, "")).sort()]));
  o.scrollers = Object.fromEntries(PAGES.flatMap((p) => [320, 375].map((w) => [`${p}|${w}`, get(rs, p, w)?.scrollers ?? []])));
  o.lowSampleDark = null;
}
// 영어 375·320 index
for (const v of V) { const rs = data[v]; S.variants[v].indexEn = { h2_375: get(rs, "index.html", 375, "en").firstH2.y, height375: get(rs, "index.html", 375, "en").height, h2_320: get(rs, "index.html", 320, "en").firstH2.y, navScroll375: get(rs, "index.html", 375, "en").scrollers.filter((s) => s.el.includes("page-nav")).map((s) => s.over)[0] ?? 0 }; }
// ---- 2층 ----
const changes = await J("layout-changes.json");
for (const v of ["a", "b", "c"]) {
  const rs = layout[v];
  const ix = get(rs, "index.html", 375), wd = get(rs, "index.html", 1280);
  let inv = null; try { inv = await J(`invariants-${v}-layout.json`); } catch {}
  S.variants[v].layout = {
    index375: { h2: ix.firstH2.y, h2Text: ix.firstH2.text, questionNav: ix.y.questionNav, firstQuestion: ix.y.firstQuestion, table: ix.y.realestateTable, historyGrid: ix.y.historyGrid, height: ix.height, small: ix.text.ratio },
    index1280: { h2: wd.firstH2.y, questionNav: wd.y.questionNav, table: wd.y.realestateTable, historyGrid: wd.y.historyGrid, height: wd.height, scrollers: wd.scrollers },
    overflow: Object.fromEntries(rs.filter((r) => r.width <= 375).map((r) => [`${r.lang} ${r.width}`, r.overflow])),
    under44: { under: ix.interactive.under44, total: ix.interactive.total, list: ix.interactive.list },
    minFont: Math.min(...rs.map((r) => r.minFont.px)), fieldMin: Math.min(...rs.map((r) => r.fieldMin)),
    indexEn375: { h2: get(rs, "index.html", 375, "en").firstH2.y, navScroll: get(rs, "index.html", 375, "en").scrollers.filter((s) => s.el.includes("page-nav")).map((s) => s.over)[0] ?? 0 },
    scrollers375: ix.scrollers,
    changes: changes[v].changes, indexBytes: changes[v].indexBytes, styleBytes: changes[v].styleBytes,
    invariants: inv ? { total: inv.total, hard: inv.hard, soft: inv.soft, softItems: inv.pages?.filter((p) => p.status !== "pass").flatMap((p) => p.findings.map((f) => ({ page: p.file, check: f.check, level: f.level, missing: f.missing, added: f.added }))) } : null,
  };
}
// ---- invariants·대비·렌더 비교·JS 지문·CSS 바이트 ----
const sha = async (f) => createHash("sha256").update(await readFile(f)).digest("hex");
const jsFiles = (await readdir(path.join(M, "base/docs"))).filter((f) => f.endsWith(".js")).sort();
S.js = { files: jsFiles, base: Object.fromEntries(await Promise.all(jsFiles.map(async (f) => [f, await sha(path.join(M, "base/docs", f))]))) };
S.htmlCount = (await readdir(path.join(M, "base/docs"))).filter((f) => f.endsWith(".html")).length;
const baseCss = (await readFile(path.join(M, "base/docs/style.css"))).length;
S.variants.base.css = { bytes: baseCss };
S.variants.base.contrast = await J("contrast-base.json");
for (const v of ["a", "b", "c"]) {
  const o = S.variants[v];
  const inv = await J(`invariants-${v}.json`);
  o.invariants = { total: inv.total, pass: inv.pass, hard: inv.hard, soft: inv.soft };
  o.contrast = await J(`contrast-${v}.json`);
  const rd = await J(`rendered-${v}.json`);
  o.rendered = { total: rd.total, pass: rd.pass, hard: rd.hard, overflowA: rd.overflowA, widths: rd.widths };
  const it = await J(`innertext-${v}.json`);
  o.innertext = { runs: it.results.length, sameLines: it.results.filter((r) => r.sameLines).length, sameChars: it.results.filter((r) => r.sameChars).length, diffs: it.results.filter((r) => !r.sameLines).map((r) => ({ where: `${r.page} ${r.lang} ${r.width}`, missing: r.missing.slice(0, 6), added: r.added.slice(0, 6), sameChars: r.sameChars })) };
  const itl = await J(`innertext-${v}-layout.json`);
  o.layout.innertext = { runs: itl.results.length, sameLines: itl.results.filter((r) => r.sameLines).length, sameChars: itl.results.filter((r) => r.sameChars).length, sameBag: itl.results.filter((r) => r.sameBag).length };
  // JS·HTML 바이트 동일
  const jsSame = {}; for (const f of jsFiles) jsSame[f] = (await sha(path.join(M, "out", v, "docs", f))) === S.js.base[f];
  const htmls = (await readdir(path.join(M, "base/docs"))).filter((f) => f.endsWith(".html"));
  let htmlSame = 0; for (const f of htmls) if ((await sha(path.join(M, "out", v, "docs", f))) === (await sha(path.join(M, "base/docs", f)))) htmlSame++;
  let htmlSameL = 0; const diffL = []; for (const f of htmls) { if ((await sha(path.join(M, "out", `${v}-layout`, "docs", f))) === (await sha(path.join(M, "base/docs", f)))) htmlSameL++; else diffL.push(f); }
  const jsSameL = {}; for (const f of jsFiles) jsSameL[f] = (await sha(path.join(M, "out", `${v}-layout`, "docs", f))) === S.js.base[f];
  o.bytes = { jsSame, jsAllSame: Object.values(jsSame).every(Boolean), htmlSame, htmlTotal: htmls.length, layoutHtmlSame: htmlSameL, layoutHtmlDiff: diffL, layoutJsAllSame: Object.values(jsSameL).every(Boolean) };
  const css = await readFile(path.join(M, "out", v, "docs/style.css"), "utf8");
  const added = css.slice((await readFile(path.join(M, "base/docs/style.css"), "utf8")).length);
  const addedL = (await readFile(path.join(M, "css", `${v}-layout.css`), "utf8"));
  const grep = (src, re) => (src.replace(/\/\*[\s\S]*?\*\//g, "").match(re) ?? []);
  const scan = (src) => ({ fontFace: grep(src, /@font-face/g).length, animation: grep(src, /\banimation(-name)?\s*:/g).length, transition: grep(src, /\btransition(-[a-z]+)?\s*:/g).length, keyframes: grep(src, /@keyframes/g).length, sticky: grep(src, /position\s*:\s*sticky/g).length, fixed: grep(src, /position\s*:\s*fixed/g).length, overflowHidden: grep(src, /overflow(-[xy])?\s*:\s*hidden/g).length, fixedHeight: grep(src, /(?:^|[;{\s])height\s*:\s*[^;]+/g).map((s) => s.trim()), url: grep(src, /url\([^)]*\)/g), importRule: grep(src, /@import/g).length });
  o.css = { bytes: Buffer.byteLength(css), added: Buffer.byteLength(added), baseKept: css.startsWith(await readFile(path.join(M, "base/docs/style.css"), "utf8")), scan: scan(added), layoutAdded: Buffer.byteLength(addedL), layoutScan: scan(addedL) };
  o.newBlocked = o.blocked.filter((u) => !S.variants.base.blocked.includes(u));
  o.newLocal = Object.fromEntries(Object.entries(o.localRequests).map(([p, list]) => [p, (list ?? []).filter((u) => !(S.variants.base.localRequests[p] ?? []).includes(u))]));
}
// ---- C가 뒤집히는 세 조건 ----
const b = S.variants.base, c = S.variants.c;
const tableOver = (v) => Object.fromEntries((S.variants[v].outlook375.scrollers).map((s) => [s.el.replace(/^.*table#/, "#"), s.over]));
S.flip = {
  cond1: { rule: "C의 375폭 장 높이가 현행의 1.3배를 넘는다", index: { base: b.index375.height, c: c.index375.height, limit: Math.floor(b.index375.height * 1.3), ratio: Math.round((c.index375.height / b.index375.height) * 1000) / 1000 }, budget: { base: b.budget375.height, c: c.budget375.height, limit: Math.floor(b.budget375.height * 1.3), ratio: Math.round((c.budget375.height / b.budget375.height) * 1000) / 1000 }, layoutIndex: { c: c.layout.index375.height, ratio: Math.round((c.layout.index375.height / b.index375.height) * 1000) / 1000 } },
  cond2: { rule: "C의 375폭에서 index 첫 h2 또는 budget-7eok 요약 문장이 현행보다 아래로 내려간다", indexH2: { base: b.index375.h2, c: c.index375.h2, cLayout: c.layout.index375.h2 }, budgetSummary: { base: b.budget375.summary, c: c.budget375.summary }, budgetAnswers: { base: b.budget375.answers, c: c.budget375.answers } },
  cond3: { rule: "C의 price-outlook 표가 375폭에서 가로로 넘친다", pageOverflow: { base: b.overflow["price-outlook.html|ko|375"].px, c: c.overflow["price-outlook.html|ko|375"].px }, tablesInBox: { base: tableOver("base"), a: tableOver("a"), b: tableOver("b"), c: tableOver("c") } },
};
S.flip.cond1.hit = S.flip.cond1.index.c > S.flip.cond1.index.limit || S.flip.cond1.budget.c > S.flip.cond1.budget.limit;
S.flip.cond2.hit = S.flip.cond2.indexH2.c > S.flip.cond2.indexH2.base || S.flip.cond2.budgetSummary.c > S.flip.cond2.budgetSummary.base;
S.flip.cond2.hitLayout = S.flip.cond2.indexH2.cLayout > S.flip.cond2.indexH2.base;
S.flip.cond3.hitPage = S.flip.cond3.pageOverflow.c > 0;
S.flip.cond3.newTables = Object.keys(S.flip.cond3.tablesInBox.c).filter((k) => !(k in S.flip.cond3.tablesInBox.base));

await writeFile(path.join(M, "measure", "summary.json"), JSON.stringify(S, null, 1));

// ---- 콘솔 요약 ----
const row = (label, f) => `| ${label} | ${V.map((v) => f(S.variants[v], v)).join(" | ")} |`;
const lines = [`| 375폭 한국어 | ${V.map((v) => NAME[v]).join(" | ")} |`, `|---|${V.map(() => "---:").join("|")}|`,
  row("index 첫 h2 y", (o) => n(o.index375.h2)), row("index 질문 입구 y", (o) => n(o.index375.questionNav)), row("index 시세표 y", (o) => n(o.index375.table)), row("index 장 높이", (o) => n(o.index375.height)), row("index 13.6px 이하 글자", (o) => o.index375.small + "%"),
  row("budget-7eok 첫 h2 y", (o) => n(o.budget375.h2)), row("budget-7eok 요약 문장 y", (o) => n(o.budget375.summary)), row("budget-7eok \"한눈에\" y", (o) => n(o.budget375.answers)), row("budget-7eok 장 높이", (o) => n(o.budget375.height)), row("budget-7eok 13.6px 이하", (o) => o.budget375.small + "%"),
  row("rates 장 높이", (o) => n(o.rates375.height)), row("rates 허브 링크 높이", (o) => o.rates375.hubLinks.join("·")), row("price-outlook 장 높이", (o) => n(o.outlook375.height)), row("price-outlook 13.6px 이하", (o) => o.outlook375.small + "%"), row("price-outlook 권역 표 y", (o) => n(o.outlook375.regionTable)), row("보이는 .low-sample", (o) => o.outlook375.lowVisible),
  row("method 장 높이", (o) => n(o.method375?.height)),
  row("style.css 바이트", (o) => n(o.css.bytes)), row("글자 최소(px)", (o) => o.minFont), row("입력칸 최소(px)", (o) => o.fieldMin), row("가로 넘침 최대(320·375, 한·영)", (o) => o.overflowMax + "px"),
  row("44px 미만 index", (o) => `${o.under44["index.html"].under}/${o.under44["index.html"].total}`), row("44px 미만 budget-7eok", (o) => `${o.under44["budget-7eok.html"].under}/${o.under44["budget-7eok.html"].total}`), row("44px 미만 rates", (o) => `${o.under44["rates.html"].under}/${o.under44["rates.html"].total}`), row("44px 미만 price-outlook", (o) => `${o.under44["price-outlook.html"].under}/${o.under44["price-outlook.html"].total}`), row("44px 미만 method", (o) => `${o.under44["method.html"].under}/${o.under44["method.html"].total}`),
];
console.log(lines.join("\n"));
for (const v of V) console.log(v, "넘침:", S.variants[v].overflowNonZero.join("; ") || "없음", "| 최소 글자:", S.variants[v].minFont, S.variants[v].minFontWhere.slice(0, 3).join(", "), "| fixed/sticky:", S.variants[v].fixedSticky.join(","));
for (const v of ["a", "b", "c"]) { const o = S.variants[v]; console.log(v, "invariants", JSON.stringify(o.invariants), "| rendered", JSON.stringify(o.rendered), "| innertext", o.innertext.sameLines + "/" + o.innertext.runs, "chars", o.innertext.sameChars, "| js same", o.bytes.jsAllSame, "html same", o.bytes.htmlSame + "/" + o.bytes.htmlTotal, "| css scan", JSON.stringify(o.css.scan), "| new req", o.newBlocked.length, JSON.stringify(Object.values(o.newLocal).flat())); console.log(v, "layout", JSON.stringify({ ...o.layout, changes: undefined, under44: { under: o.layout.under44.under, list: o.layout.under44.list.map((u) => u.el + " " + u.h) } })); console.log(v, "layoutScan", JSON.stringify(o.css.layoutScan), "layout html diff", o.bytes.layoutHtmlDiff.join(","), "js", o.bytes.layoutJsAllSame); }
console.log("flip", JSON.stringify(S.flip, null, 1));
console.log("scrollers", JSON.stringify(Object.fromEntries(V.map((v) => [v, Object.fromEntries(Object.entries(S.variants[v].scrollers).filter(([, x]) => x.length))])), null, 0));
