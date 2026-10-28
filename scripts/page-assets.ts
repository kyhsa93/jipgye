import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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
