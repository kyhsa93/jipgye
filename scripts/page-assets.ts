import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOCS_DIR } from "./site-dir.ts";
import { stripJsComments } from "./strip-inline-comments.ts";

/** Functional content groups; regional and budget variants belong to their parent feature. */
export function groupForPage(file: string) {
  if (file === "index.html") return "overview";
  if (/^(news|rate-news|realestate-news|stock-news)\.html$/.test(file)) return "news";
  if (file === "deal-search.html") return "search";
  if (/^(jeonse-vs-wolse|renewal-vs-new)\.html$/.test(file)) return "calculators";
  if (/^budget-/.test(file)) return "budget";
  if (/^(realestate|apartment-|district-)/.test(file)) return "prices";
  if (file === "price-outlook.html") return "outlook";
  if (/^(floor-gap|record-high|switch-house|cancelled-deals)\.html$/.test(file)) return "analysis";
  return "info";
}

export const stylesheetVersion = (css: string | Buffer) => createHash("sha256").update(css).digest("hex").slice(0, 16);

/** Keep style.css for existing links/offline shell, but let new HTML bypass old HTTP caches. */
export function pageAssetHtml(html: string, file: string, version: string) {
  return html
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (tag) => tag.replace(/href="\.\/style\.css(?:\?v=[a-f0-9]+)?"/, `href="./style.css?v=${version}"`))
    .replace(/(<meta name="site-group" content=")[^"]*(">)/, `$1${groupForPage(file)}$2`);
}

const diskIo = { read: (file: string) => readFileSync(file, "utf8"), write: (file: string, text: string) => writeFileSync(file, text) };

/** Final render phase: one CSS digest shared by every page, no modification to source docs/. */
export function stampPageAssets({ siteRoot, io = diskIo }: { siteRoot: string; io?: typeof diskIo }) {
  let version: string;
  let changed = 0;
  for (const file of readdirSync(siteRoot).filter((name) => name.endsWith(".html"))) {
    const full = path.join(siteRoot, file);
    const before = io.read(full);
    if (!before.includes('href="./style.css')) continue;
    version ??= stylesheetVersion(readFileSync(path.join(siteRoot, "style.css")));
    const after = pageAssetHtml(before, file, version);
    if (before !== after) { io.write(full, after); changed++; }
  }
  return changed;
}

/**
 * 장 전용 외부 JS(sw.js 사전캐시 SHELL_ASSETS 에 없는 docs/*.js)의 주석을 나가는 사본에서만 뗀다(#784).
 * 틀의 인라인 스크립트(#313)와 같은 이유다 - 소스에는 "왜"를 그대로 적고, 브라우저로 나가는 바이트(S6, #681 의 gzip ≤2KB 는 전송 크기)는
 * 주석만큼 줄인다. 공용 셸 JS(nav·search·analytics·load-state)와 sw.js 는 건드리지 않는다. 출력이 docs/ 자신이면 소스를 고치게 되므로 아무것도 안 한다.
 */
export function pageScripts(siteRoot: string, read = diskIo.read) {
  const shell = new Set([...read(path.join(siteRoot, "sw.js")).matchAll(/"\.\/([\w-]+\.js)"/g)].map((m) => m[1]));
  return readdirSync(siteRoot).filter((name) => name.endsWith(".js") && name !== "sw.js" && !shell.has(name)).sort();
}

export function stripPageScripts({ siteRoot, io = diskIo }: { siteRoot: string; io?: typeof diskIo }) {
  if (path.resolve(siteRoot) === DOCS_DIR) return 0;
  let changed = 0;
  for (const name of pageScripts(siteRoot, io.read)) {
    const full = path.join(siteRoot, name);
    const before = io.read(full);
    const after = stripJsComments(before);
    if (after !== before) { io.write(full, after); changed++; }
  }
  return changed;
}
