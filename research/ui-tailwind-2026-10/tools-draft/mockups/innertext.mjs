#!/usr/bin/env node
// 렌더된 가시 텍스트 비교(#275 브리프 4절): document.body.innerText의 줄 단위 다중집합을 375·1280폭, 한·영에서 기준과 견준다.
//   node tools/innertext.mjs --base <기준 폴더> --dir <후보 폴더> --out <json> [--pages …] [--widths 375,1280] [--langs ko,en]
// 페이지 스크립트를 켠 화면이다(사용자가 보는 글자). 바깥 요청은 막는다. 기준과 후보를 장마다 연달아 열어 "n시간 전" 같은 글자가 갈릴 틈을 줄인다.
// innerText의 줄바꿈은 CSS(display)가 정하므로, 글자는 같고 줄만 달리 끊긴 경우를 가려내려고 둘을 더 낸다:
//   sameChars  — 공백을 다 뺀 글자열이 같은가(순서까지).
//   sameBag    — 공백을 다 뺀 글자의 다중집합이 같은가(2층처럼 순서를 바꾼 경우).
import { writeFile } from "node:fs/promises";
import { launchChrome } from "../render-tools/lib/chrome.mjs";
import { serveDir } from "../render-tools/lib/serve.mjs";

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
const pages = (opt.pages ?? "index.html,budget-7eok.html,rates.html,price-outlook.html").split(",");
const widths = (opt.widths ?? "375,1280").split(",").map(Number);
const langs = (opt.langs ?? "ko,en").split(",");
const WAIT = `(async () => { const isBudget = /budget-\\d+eok/.test(location.pathname); const ok = () => { const s = document.getElementById("budget-section"); return !!(s && !s.hidden && s.querySelector(".budget-summary") && s.querySelectorAll(".budget-deal").length > 0); }; const t0 = Date.now(); while (isBudget && !ok() && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100)); })()`;

const bag = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
const diff = (a, b) => { const m = bag(a); for (const x of b) m.set(x, (m.get(x) ?? 0) - 1); const missing = [], added = []; for (const [x, n] of m) { if (n > 0) missing.push(n > 1 ? `${x} ×${n}` : x); else if (n < 0) added.push(n < -1 ? `${x} ×${-n}` : x); } return { missing, added }; };

const sa = await serveDir(opt.base);
const sb = await serveDir(opt.dir);
const chrome = await launchChrome();
const out = { base: opt.base, dir: opt.dir, widths, langs, results: [] };
async function text(server, file, width, lang) {
  const init = `try { localStorage.removeItem("theme"); ${lang !== "ko" ? `localStorage.setItem("lang", ${JSON.stringify(lang)});` : ""} } catch {}`;
  const page = await chrome.newPage({ allowOrigin: server.url, js: true, width, height: 900, colorScheme: "light", initScript: init });
  try {
    await page.goto(server.url + file, { settleMs: 0 });
    await page.evaluate(WAIT);
    await new Promise((r) => setTimeout(r, 1500));
    return await page.evaluate(`document.body.innerText`);
  } finally { await page.close(); }
}
try {
  for (const file of pages) for (const lang of langs) for (const width of widths) {
    const [ta, tb] = [await text(sa, file, width, lang), await text(sb, file, width, lang)];
    const lines = (t) => t.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const d = diff(lines(ta), lines(tb));
    const squash = (t) => t.replace(/\s+/g, "");
    const sameChars = squash(ta) === squash(tb);
    const cb = diff([...squash(ta)], [...squash(tb)]);
    const sameBag = cb.missing.length === 0 && cb.added.length === 0;
    out.results.push({ page: file, lang, width, linesBase: lines(ta).length, linesCand: lines(tb).length, sameLines: d.missing.length === 0 && d.added.length === 0, sameChars, sameBag, missing: d.missing.slice(0, 40), added: d.added.slice(0, 40), missingCount: d.missing.length, addedCount: d.added.length });
    console.log(`${file} ${lang} ${width}: 줄 ${lines(ta).length}/${lines(tb).length} 줄 다중집합 ${d.missing.length === 0 && d.added.length === 0 ? "같음" : `다름(기준에만 ${d.missing.length}, 후보에만 ${d.added.length})`} · 글자열 ${sameChars ? "같음" : "다름"} · 글자 다중집합 ${sameBag ? "같음" : "다름"}`);
  }
  if (opt.out) await writeFile(opt.out, JSON.stringify(out, null, 1));
} catch (e) { console.error(e.stack ?? e.message); process.exitCode = 2; } finally { await chrome.close(); await sa.close(); await sb.close(); }
process.exit(process.exitCode ?? 0);
