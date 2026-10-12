#!/usr/bin/env node
// 렌더된 DOM에서 class 사용 빈도와 구조 개요를 뽑는다(시안 CSS를 쓰기 전에 무엇이 그려지는지 보는 용도).
//   node tools/dump.mjs --dir <폴더> --page budget-7eok.html [--width 375]
import { launchChrome } from "../render-tools/lib/chrome.mjs";
import { serveDir } from "../render-tools/lib/serve.mjs";
const argv = process.argv.slice(2); const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
const server = await serveDir(opt.dir); const chrome = await launchChrome();
try {
  const page = await chrome.newPage({ allowOrigin: server.url, js: true, width: Number(opt.width ?? 375), height: 667 });
  await page.goto(server.url + opt.page, { settleMs: 2500 });
  const r = await page.evaluate(`(() => {
    const count = {};
    for (const el of document.querySelectorAll("main *")) { if (!el.checkVisibility()) continue; const key = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : ""); count[key] = (count[key] ?? 0) + 1; }
    const outline = [];
    const walk = (el, d) => { if (d > ${Number(opt.depth ?? 4)}) return; for (const c of el.children) { if (!c.checkVisibility()) continue; const b = c.getBoundingClientRect(); outline.push("  ".repeat(d) + c.tagName.toLowerCase() + (c.id ? "#" + c.id : "") + (typeof c.className === "string" && c.className ? "." + c.className.trim().split(/\\s+/).join(".") : "") + " y=" + Math.round(b.top + scrollY) + " h=" + Math.round(b.height) + " fs=" + getComputedStyle(c).fontSize); walk(c, d + 1); } };
    walk(document.querySelector("main"), 0);
    return { count, outline, blocked: 0 };
  })()`);
  console.log(Object.entries(r.count).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + " " + k).join("\n"));
  console.log("-----"); console.log(r.outline.join("\n"));
  console.log("막은 요청:", page.blocked.join(" "));
} finally { await chrome.close(); await server.close(); }

// 내장 WebSocket이 닫히기를 기다리며 프로세스가 몇 분 남는 일이 있어(이 머신에서 관찰) 정리가 끝나면 바로 끝낸다.
process.exit(process.exitCode ?? 0);
