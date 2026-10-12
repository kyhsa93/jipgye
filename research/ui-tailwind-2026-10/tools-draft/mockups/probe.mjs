#!/usr/bin/env node
// 시안 실측(#275 브리프 4절): 구운 폴더의 장을 헤드리스 Chrome으로 열어 화면에서 잰다.
//   node tools/probe.mjs --dir <폴더> --out <json> [--pages a.html,b.html] [--widths 320,375,1280] [--langs ko,en] [--modes auto-light]
// 재는 것(장 × 폭 × 언어): 장 높이, 가로 넘침과 넘치는 요소, 첫 h2의 y, 답 위치(예산 요약·한눈에·질문 입구·시세표),
//   main 안 보이는 글자 중 13.6px 이하 비율, 보이는 글자의 최소 크기, 입력칸 최소 글자 크기,
//   44px 미만 대화형 요소(문장 안 링크 표시), 보이는 .low-sample 수, 스크롤 상자 안에서 넘치는 표, 바깥 요청.
// 찍는 조건은 기준선과 같다: 페이지 스크립트 켬, 바깥 요청 막음, load 뒤 1.5초. 뷰포트 높이 667(폭 1280은 800).
// 예산대 장은 #288 때문에 데이터가 그려질 때까지(#budget-section이 보이고 .budget-summary가 있을 때까지) 더 기다린다.
import { writeFile } from "node:fs/promises";
import { launchChrome } from "../render-tools/lib/chrome.mjs";
import { serveDir } from "../render-tools/lib/serve.mjs";

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
if (!opt.dir) {
  console.error("사용: node tools/probe.mjs --dir <폴더> [--out <json>] [--pages …] [--widths …] [--langs ko,en]");
  process.exit(2);
}
const pages = (opt.pages ?? "index.html,budget-7eok.html,rates.html,price-outlook.html").split(",");
const widths = (opt.widths ?? "320,375,1280").split(",").map(Number);
const langs = (opt.langs ?? "ko").split(",");
const colorScheme = opt.scheme ?? "light";

export const WAIT_READY = `(async () => {
  const isBudget = /budget-\\d+eok/.test(location.pathname);
  const t0 = Date.now();
  while (isBudget && Date.now() - t0 < 10000) {
    const s = document.getElementById("budget-section");
    if (s && !s.hidden && s.querySelector(".budget-summary") && s.querySelectorAll(".budget-deal").length > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return Date.now() - t0;
})()`;

const PROBE = `(() => {
  const vis = (el) => el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const y = (el) => (el && vis(el) ? Math.round(el.getBoundingClientRect().top + scrollY) : null);
  const q = (s) => document.querySelector(s);
  const main = q("main");
  // sr-only처럼 1px 상자에 잘린 것은 보이는 글자가 아니다.
  const clipped = (el) => { for (let p = el; p && p !== document.documentElement; p = p.parentElement) { const b = p.getBoundingClientRect(); const cs = getComputedStyle(p); if ((b.width <= 1 || b.height <= 1) && (cs.overflowX !== "visible" || cs.clipPath !== "none")) return true; } return false; };
  // 글자: 요소의 직접 텍스트 노드, 공백 뺀 글자 수.
  let total = 0, small = 0, minFs = Infinity; const minEls = []; const sizes = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,template")) continue;
    const text = n.nodeValue.replace(/\\s+/g, "");
    if (!text) continue;
    if (!vis(el) || clipped(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minFs - 0.001) { minFs = fs; minEls.length = 0; }
    if (Math.abs(fs - minFs) < 0.001 && minEls.length < 5) minEls.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : ""));
    if (main.contains(el)) { total += text.length; if (fs <= 13.61) small += text.length; const k = fs.toFixed(2); sizes[k] = (sizes[k] ?? 0) + text.length; }
  }
  // 입력칸
  const fields = [...document.querySelectorAll("input,select,textarea")].filter(vis).map((el) => parseFloat(getComputedStyle(el).fontSize));
  // 대화형 요소 높이
  const inter = [...document.querySelectorAll("a,button,input,select,summary")].filter((el) => vis(el) && !clipped(el) && el.type !== "hidden");
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "");
  const under = [];
  for (const el of inter) {
    const b = el.getBoundingClientRect();
    if (b.height >= 43.99) continue;
    // 문장 안 링크: 부모 블록에 이 링크 말고도 글자가 있다(앞뒤 텍스트). 목록의 주 동선(혼자 한 줄)은 예외가 아니다.
    const cs = getComputedStyle(el);
    let p = el.parentElement; while (p && getComputedStyle(p).display.startsWith("inline")) p = p.parentElement;
    const own = el.textContent.replace(/\\s+/g, "").length;
    const around = p ? p.textContent.replace(/\\s+/g, "").length - own : 0;
    const inSentence = el.tagName === "A" && cs.display.startsWith("inline") && around >= 12;
    under.push({ el: name(el), h: Math.round(b.height * 10) / 10, w: Math.round(b.width), text: (el.textContent || el.getAttribute("aria-label") || el.type || "").replace(/\\s+/g, " ").trim().slice(0, 28), inSentence, parent: p ? name(p) : null });
  }
  // 문서 가로 넘침과 넘치는 요소(자체 스크롤 상자 안은 뺀다)
  const overflow = document.documentElement.scrollWidth - innerWidth;
  const over = [];
  if (overflow > 0) for (const el of document.querySelectorAll("body *")) {
    if (!vis(el)) continue; const b = el.getBoundingClientRect();
    if (b.right > innerWidth + 0.5 && !el.closest(".table-scroll,.table-wrap,.page-nav,.sub-nav,.tabs,.sr-only") ) { over.push(name(el) + " +" + Math.round(b.right - innerWidth)); if (over.length >= 6) break; }
  }
  // 스크롤 상자 안에서 넘치는 표·내비
  const scrollers = [...document.querySelectorAll(".table-scroll,.table-wrap,.page-nav,.sub-nav")].filter(vis).map((el) => ({ el: name(el) + (el.querySelector("table[id]") ? " > table#" + el.querySelector("table[id]").id : ""), over: el.scrollWidth - el.clientWidth })).filter((x) => x.over > 0);
  const h2 = [...document.querySelectorAll("h2")].filter(vis)[0];
  const low = [...document.querySelectorAll(".low-sample")].filter(vis);
  const lowInfo = low.slice(0, 1).map((el) => { const cs = getComputedStyle(el); const b = getComputedStyle(el, "::before"); return { fontSize: cs.fontSize, color: cs.color, beforeW: b.width, beforeH: b.height, beforeBorder: b.borderTopColor, beforeBg: b.backgroundImage.slice(0, 120), bg: cs.backgroundImage.slice(0, 120) }; })[0] ?? null;
  const hub = [...document.querySelectorAll(".rate-hub a")].filter(vis).map((el) => Math.round(el.getBoundingClientRect().height * 10) / 10);
  return {
    theme: document.documentElement.getAttribute("data-theme"), lang: document.documentElement.lang,
    height: Math.ceil(document.documentElement.scrollHeight), overflow, over, scrollers,
    firstH2: h2 ? { y: y(h2), text: h2.textContent.trim().slice(0, 30), fontSize: getComputedStyle(h2).fontSize } : null,
    y: { questionNav: y(q("#question-nav")), firstQuestion: y(q("#question-nav a")), realestateTable: y(q("#realestate-section .data-table")), budgetChips: y(q(".budget-chips")), budgetSummary: y(q(".budget-summary")), budgetWhere: y(q(".budget-where")), budgetAnswers: y(q(".budget-answers")), lead: y(q(".lead")), regionTable: y(q("#region-table")), rateHub: y(q(".rate-hub")), historyGrid: y(q("#realestate-history-grid")) },
    text: { total, small, ratio: total ? Math.round((small / total) * 1000) / 10 : null, sizes },
    minFont: { px: minFs, els: minEls }, fieldMin: fields.length ? Math.min(...fields) : null,
    h1: q("h1") ? getComputedStyle(q("h1")).fontSize : null, body: getComputedStyle(document.body).fontSize,
    interactive: { total: inter.length, under44: under.length, under44NotSentence: under.filter((u) => !u.inSentence).length, list: under },
    lowSample: { visible: low.length, first: lowInfo }, hubLinks: hub,
    fixedSticky: [...document.querySelectorAll("body *")].filter((el) => { const p = getComputedStyle(el).position; return p === "fixed" || p === "sticky"; }).map(name),
  };
})()`;

const server = await serveDir(opt.dir);
let chrome;
const out = { dir: opt.dir, widths, langs, colorScheme, results: [] };
try {
  chrome = await launchChrome();
  out.chrome = chrome.version;
  for (const file of pages) for (const lang of langs) for (const width of widths) {
    const init = `try { localStorage.removeItem("theme"); ${lang !== "ko" ? `localStorage.setItem("lang", ${JSON.stringify(lang)});` : ""} } catch {}`;
    const page = await chrome.newPage({ allowOrigin: server.url, js: true, width, height: width >= 1024 ? 800 : 667, colorScheme, initScript: init });
    const reqs = [];
    try {
      await page.send("Network.enable");
      await page.goto(server.url + file, { settleMs: 0 });
      const waited = await page.evaluate(WAIT_READY);
      await new Promise((r) => setTimeout(r, 1500));
      const r = await page.evaluate(PROBE);
      const local = await page.evaluate(`performance.getEntriesByType("resource").map((e) => e.name.replace(location.origin, "")).sort()`);
      out.results.push({ page: file, lang, width, waitedMs: waited, ...r, blocked: [...page.blocked].sort(), localRequests: local });
      console.log(`${file} ${lang} ${width}: 높이 ${r.height} 넘침 ${r.overflow} 첫h2 ${r.firstH2?.y} 작은글자 ${r.text.ratio}% 최소 ${r.minFont.px}px 입력 ${r.fieldMin} <44 ${r.interactive.under44}/${r.interactive.total}(문장 밖 ${r.interactive.under44NotSentence}) low ${r.lowSample.visible}`);
    } finally {
      await page.close();
    }
  }
  if (opt.out) await writeFile(opt.out, JSON.stringify(out, null, 1));
} catch (e) {
  console.error(e.stack ?? e.message);
  process.exitCode = 2;
} finally {
  await chrome?.close();
  await server.close();
}

// 내장 WebSocket이 닫히기를 기다리며 프로세스가 몇 분 남는 일이 있어(이 머신에서 관찰) 정리가 끝나면 바로 끝낸다.
process.exit(process.exitCode ?? 0);
