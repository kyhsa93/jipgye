#!/usr/bin/env node
// 구운 폴더의 장 하나를 열어 식 하나를 돌려 본다(개발용). node tools/eval.mjs --dir d --page p --width 375 --expr '…' [--scheme dark] [--lang en]
import { launchChrome } from "../render-tools/lib/chrome.mjs";
import { serveDir } from "../render-tools/lib/serve.mjs";
const argv = process.argv.slice(2); const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
const server = await serveDir(opt.dir); const chrome = await launchChrome();
try {
  const page = await chrome.newPage({ allowOrigin: server.url, js: true, width: Number(opt.width ?? 375), height: 667, colorScheme: opt.scheme ?? "light", initScript: opt.lang ? `try{localStorage.setItem("lang","${opt.lang}")}catch{}` : null });
  await page.goto(server.url + opt.page, { settleMs: 2500 });
  const r = await page.evaluate(opt.expr);
  console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1));
} finally { await chrome.close(); await server.close(); }

// 내장 WebSocket이 닫히기를 기다리며 프로세스가 몇 분 남는 일이 있어(이 머신에서 관찰) 정리가 끝나면 바로 끝낸다.
process.exit(process.exitCode ?? 0);
