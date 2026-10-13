#!/usr/bin/env node
// (#275 시안용 사본) draft-278-render-tools/bin/shots.mjs에서 두 가지만 바꿨다:
//   1. 예산대 장은 #288(데이터가 오기 전 스크립트가 구운 예산 구획을 숨긴다) 때문에, 구획이 다시 보이고 거래 목록이 그려질 때까지 기다린 뒤 settle을 센다.
//      shots.json에 budgetReady(구획이 보였는가)와 waitedMs를 적는다.
//   2. 뷰포트 높이를 --vh로 줄 수 있다(기본 900 — 기준선과 같다).
// 스크린샷 시트(#274 범위 3): 구운 폴더의 장을 테마 네 갈래 × 폭마다 전체 화면으로 찍는다. 개편 전후를 사람이 훑는 참고 자료다.
// **합격 조건이 아니다** — 픽셀 동일은 요구하지 않고, 같은 입력을 두 번 찍어도 일부가 달랐다(ceo 실측). PNG는 저장소에 커밋하지 않는다.
//   node bin/shots.mjs --dir <구운 폴더> --out <폴더> [--pages index.html,rates.html] [--widths 375,1280] [--lang en] [--settle 1500] [--modes auto-light] [--probe <선택자>]
// 네 갈래: auto-light(OS 라이트)·auto-dark(OS 다크)·forced-light(OS는 다크인데 localStorage.theme=light)·forced-dark(OS는 라이트인데 theme=dark).
//   강제 쪽을 OS와 반대로 두는 것은 "강제가 OS를 이기는가"가 깨지기 쉬운 자리라서다.
// 페이지 스크립트는 켠다(사용자가 보는 화면). 바깥 요청은 막는다 — GA·애드센스에 조회가 쌓이지 않고 환율 API가 화면을 흔들지 않는다.
//   그래서 환율 칸 같은 바깥 값은 구운 값 그대로 찍힌다.
// 출력: <out>/<장>.<갈래>.<폭>[.<언어>].png 와 <out>/shots.json(환경·파일별 sha256·막은 요청 수).
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchChrome } from "../render-tools/lib/chrome.mjs";
import { serveDir } from "../render-tools/lib/serve.mjs";

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
if (!opt.dir || !opt.out) {
  console.error("사용: node bin/shots.mjs --dir <구운 폴더> --out <폴더> [--pages a.html,b.html] [--widths 375,1280] [--lang en] [--settle 1500]");
  process.exit(2);
}
const pages = (opt.pages ?? "index.html,realestate.html,budget-7eok.html,district-gangnam.html,rates.html").split(",").filter(Boolean);
const widths = (opt.widths ?? "375,1280").split(",").map(Number);
const settleMs = Number(opt.settle ?? 1500);
const onlyModes = opt.modes ? opt.modes.split(",") : null; // 예: --modes auto-light
const probe = opt.probe ?? null; // 예: --probe .low-sample → 그 선택자에 맞는 요소 중 화면에 그려진 것의 수를 shots.json에 적는다
const MAX_HEIGHT = 16000; // Chrome이 한 장으로 찍을 수 있는 높이 안쪽으로 자른다

const WAIT_READY = `(async () => {
  const isBudget = /budget-\\d+eok/.test(location.pathname);
  const ok = () => { const s = document.getElementById("budget-section"); return !!(s && !s.hidden && s.querySelector(".budget-summary") && s.querySelectorAll(".budget-deal").length > 0); };
  const t0 = Date.now();
  while (isBudget && !ok() && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
  return { waitedMs: Date.now() - t0, budgetReady: isBudget ? ok() : null };
})()`;

const MODES = [
  { name: "auto-light", colorScheme: "light", theme: null },
  { name: "auto-dark", colorScheme: "dark", theme: null },
  { name: "forced-light", colorScheme: "dark", theme: "light" },
  { name: "forced-dark", colorScheme: "light", theme: "dark" },
];
const init = (theme, lang) =>
  `try { ${theme ? `localStorage.setItem("theme", ${JSON.stringify(theme)});` : `localStorage.removeItem("theme");`} ${lang ? `localStorage.setItem("lang", ${JSON.stringify(lang)});` : ""} } catch {}`;

await mkdir(opt.out, { recursive: true });
const server = await serveDir(opt.dir);
let chrome;
const shots = [];
try {
  chrome = await launchChrome();
  for (const file of pages) {
    for (const mode of MODES.filter((m) => !onlyModes || onlyModes.includes(m.name))) {
      for (const width of widths) {
        const page = await chrome.newPage({ allowOrigin: server.url, js: true, width, height: Number(opt.vh ?? 900), colorScheme: mode.colorScheme, initScript: init(mode.theme, opt.lang) });
        try {
          await page.goto(server.url + file, { settleMs: 0 });
          const ready = await page.evaluate(WAIT_READY);
          await new Promise((r) => setTimeout(r, settleMs));
          const state = await page.evaluate(`({ theme: document.documentElement.getAttribute("data-theme"), lang: document.documentElement.lang, height: Math.ceil(document.documentElement.scrollHeight), overflow: document.documentElement.scrollWidth - innerWidth })`);
          const probed = probe ? await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(probe)})].filter((el) => el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true })).length`) : null;
          const height = Math.min(state.height, MAX_HEIGHT);
          const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
          const png = Buffer.from(data, "base64");
          const name = `${file.replace(/\.html$/, "")}.${mode.name}.${width}${opt.lang ? `.${opt.lang}` : ""}.png`;
          await writeFile(path.join(opt.out, name), png);
          shots.push({ file: name, page: file, mode: mode.name, width, height, clipped: state.height > MAX_HEIGHT, dataTheme: state.theme, lang: state.lang, overflow: state.overflow, waitedMs: ready.waitedMs, budgetReady: ready.budgetReady, blockedRequests: page.blocked.length, ...(probe ? { probe, probeVisible: probed } : {}), bytes: png.length, sha256: createHash("sha256").update(png).digest("hex") });
          console.log(`${name}  ${width}×${height}  data-theme=${state.theme ?? "(없음)"} lang=${state.lang} 넘침 ${state.overflow}px${ready.budgetReady === null ? "" : ` 예산 구획 ${ready.budgetReady ? "보임" : "숨김(!)"}`}${probe ? ` ${probe} 보이는 것 ${probed}개` : ""}`);
        } finally {
          await page.close();
        }
      }
    }
  }
  await writeFile(path.join(opt.out, "shots.json"), `${JSON.stringify({ dir: path.resolve(opt.dir), chrome: chrome.version, node: process.version, platform: `${process.platform} ${process.arch}`, settleMs, lang: opt.lang ?? null, shots }, null, 2)}\n`);
  console.log(`${shots.length}장 → ${opt.out} (${chrome.version})`);
} catch (e) {
  console.error(e.stack ?? e.message);
  process.exitCode = 2;
} finally {
  await chrome?.close();
  await server.close();
}

// 내장 WebSocket이 닫히기를 기다리며 프로세스가 몇 분 남는 일이 있어(이 머신에서 관찰) 정리가 끝나면 바로 끝낸다.
process.exit(process.exitCode ?? 0);
