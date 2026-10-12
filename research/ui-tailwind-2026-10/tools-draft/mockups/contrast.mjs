#!/usr/bin/env node
// 대비 표(#275 브리프 4절): 시안 폴더의 index.html을 네 갈래(자동 라이트·자동 다크·강제 라이트·강제 다크)로 열어
// 브라우저가 실제로 계산한 토큰 값을 읽고 WCAG 대비를 낸다. CSS 파일을 손으로 옮겨 적지 않으므로 갈래가 갈리면 여기서 드러난다.
//   node tools/contrast.mjs --dir <폴더> [--out <json>] [--md <파일>]
// 글자 쌍(4.5:1): 글자·회색·액센트·오름·내림·링크 × 바탕·카드·옅은 판(+ 줄무늬가 있으면 줄무늬), 액센트 위 글자 × 액센트.
// 무늬·입력 테두리(3:1): 진한 테두리 × 바탕·카드.
import { writeFile } from "node:fs/promises";
import { launchChrome } from "../render-tools/lib/chrome.mjs";
import { serveDir } from "../render-tools/lib/serve.mjs";

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];

const MODES = [
  { name: "자동 라이트", colorScheme: "light", theme: null },
  { name: "자동 다크", colorScheme: "dark", theme: null },
  { name: "강제 라이트", colorScheme: "dark", theme: "light" },
  { name: "강제 다크", colorScheme: "light", theme: "dark" },
];
const TOKENS = ["bg", "card", "accent-weak", "stripe", "fg", "muted", "accent", "accent-on", "up", "down", "link", "border", "border-strong"];

const hex = (s) => {
  const m = s.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const server = await serveDir(opt.dir);
const chrome = await launchChrome();
const out = { dir: opt.dir, modes: [] };
try {
  for (const mode of MODES) {
    const init = `try { ${mode.theme ? `localStorage.setItem("theme", "${mode.theme}");` : `localStorage.removeItem("theme");`} } catch {}`;
    const page = await chrome.newPage({ allowOrigin: server.url, js: true, width: 375, height: 667, colorScheme: mode.colorScheme, initScript: init });
    try {
      await page.goto(server.url + "index.html", { settleMs: 800 });
      const t = await page.evaluate(`(() => { const cs = getComputedStyle(document.documentElement); const o = { dataTheme: document.documentElement.getAttribute("data-theme"), bodyBg: getComputedStyle(document.body).backgroundColor, bodyColor: getComputedStyle(document.body).color }; for (const k of ${JSON.stringify(TOKENS)}) o[k] = cs.getPropertyValue("--" + k).trim(); return o; })()`);
      const c = Object.fromEntries(TOKENS.map((k) => [k, hex(t[k] ?? "")]));
      const pairs = [];
      const add = (fgName, bgName, min, kind) => { if (c[fgName] && c[bgName]) { const r = ratio(c[fgName], c[bgName]); pairs.push({ fg: fgName, bg: bgName, fgHex: t[fgName], bgHex: t[bgName], ratio: Math.round(r * 100) / 100, min, pass: r >= min, kind }); } };
      const surfaces = ["bg", "card", "accent-weak", ...(c.stripe ? ["stripe"] : [])];
      for (const f of ["fg", "muted", "accent", "up", "down", "link"]) for (const s of surfaces) add(f, s, 4.5, "글자");
      add("accent-on", "accent", 4.5, "글자");
      for (const s of ["bg", "card"]) add("border-strong", s, 3, "무늬·입력 테두리");
      for (const s of ["bg", "card"]) add("border", s, 0, "참고(장식 테두리, 기준 없음)");
      out.modes.push({ mode: mode.name, colorScheme: mode.colorScheme, forced: mode.theme, tokens: t, pairs });
    } finally {
      await page.close();
    }
  }
} finally {
  await chrome.close();
  await server.close();
}
const same = (a, b) => TOKENS.every((k) => out.modes[a].tokens[k] === out.modes[b].tokens[k]);
out.branchesAgree = { lightAutoVsForced: same(0, 2), darkAutoVsForced: same(1, 3) };
const fails = out.modes.flatMap((m) => m.pairs.filter((p) => p.min > 0 && !p.pass).map((p) => `${m.mode}: ${p.fg}(${p.fgHex}) / ${p.bg}(${p.bgHex}) = ${p.ratio} < ${p.min}`));
out.fails = fails;
const lines = [];
lines.push(`| 쌍 | 기준 | ${out.modes.map((m) => m.mode).join(" | ")} |`, `|---|---:|${out.modes.map(() => "---:").join("|")}|`);
const keys = out.modes[0].pairs.map((p) => `${p.fg}|${p.bg}`);
for (const key of keys) {
  const cells = out.modes.map((m) => { const p = m.pairs.find((x) => `${x.fg}|${x.bg}` === key); return p ? `${p.ratio.toFixed(2)}${p.min > 0 && !p.pass ? " ✗" : ""}` : "–"; });
  const p0 = out.modes[0].pairs.find((x) => `${x.fg}|${x.bg}` === key);
  lines.push(`| \`--${p0.fg}\` / \`--${p0.bg}\` | ${p0.min > 0 ? p0.min + ":1" : "–"} | ${cells.join(" | ")} |`);
}
const tokLines = [`| 토큰 | 라이트 | 다크 |`, `|---|---|---|`, ...TOKENS.filter((k) => out.modes[0].tokens[k]).map((k) => `| \`--${k}\` | \`${out.modes[0].tokens[k]}\` | \`${out.modes[1].tokens[k]}\` |`)];
out.md = { pairs: lines.join("\n"), tokens: tokLines.join("\n") };
console.log(lines.join("\n"));
console.log(`갈래 일치: 라이트(자동=강제) ${out.branchesAgree.lightAutoVsForced}, 다크(자동=강제) ${out.branchesAgree.darkAutoVsForced}. data-theme: ${out.modes.map((m) => m.tokens.dataTheme ?? "(없음)").join(" / ")}`);
console.log(fails.length ? `미달 ${fails.length}건:\n${fails.join("\n")}` : "미달 0건");
if (opt.out) await writeFile(opt.out, JSON.stringify(out, null, 1));

// 내장 WebSocket이 닫히기를 기다리며 프로세스가 몇 분 남는 일이 있어(이 머신에서 관찰) 정리가 끝나면 바로 끝낸다.
process.exit(process.exitCode ?? 0);
