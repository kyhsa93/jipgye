// 재방문 데이터 전송량 측정 (#695 완료 2). 같은 docs/data 로 그린 두 렌더 출력(기준 base · 후보 head)을 Pages 헤더를 흉내 낸 로컬 서버로 띄우고,
// Chromium 으로 장을 두 번 연다(첫 방문 -> 재방문). 재방문 동안 서버가 /data/ 에 실제로 보낸 본문 바이트를 200·304 로 나눠 센다.
//
// 서버(Pages 재현, 2026-11-16 `curl -sI` 로 본 헤더): cache-control: max-age=600, ETag(내용 해시), If-None-Match 가 맞으면 304(본문 0), 쿼리는 무시한다.
// 「만료 뒤」는 서버가 max-age=0 + ETag 를 주는 것으로 대신한다(10분을 기다리지 않는다). 압축은 하지 않는다 - 바이트는 압축 전 본문이다(비율에는 영향이 없다).
//
// 경우(장마다, 렌더마다 넷): 서비스 워커 차단·허용 × 재방문 즉시·만료 뒤. 허용은 index.html 을 먼저 열어 SW 를 등록·활성화한 뒤 잰다.
//
// 쓰는 법: PLAYWRIGHT=<playwright 패키지 경로> node research/data-version-key-2026-11/measure.mjs --base=<렌더 폴더> --head=<렌더 폴더> [--out=result.json]
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const { chromium } = await import(pathToFileURL(path.join(process.env.PLAYWRIGHT, "index.mjs")).href);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".svg": "image/svg+xml" };

/** Pages 흉내 서버. log 는 /data/ 응답만 모은다. maxAge 는 바꿔 끼울 수 있다. */
function serve(dir) {
  const state = { maxAge: 600, log: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let rel = decodeURIComponent(url.pathname.replace(/^\/jipgye\//, "/"));
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(dir, rel);
    let body;
    try {
      if (!file.startsWith(dir) || !statSync(file).isFile()) throw new Error("x");
      body = readFileSync(file);
    } catch {
      res.writeHead(404, { "cache-control": `max-age=${state.maxAge}` });
      res.end();
      if (rel.startsWith("/data/")) state.log.push({ path: rel, query: url.search, status: 404, bytes: 0 });
      return;
    }
    const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
    const headers = { "cache-control": `max-age=${state.maxAge}`, etag, "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" };
    const hit = req.headers["if-none-match"] === etag;
    res.writeHead(hit ? 304 : 200, hit ? headers : { ...headers, "content-length": body.length });
    res.end(hit ? undefined : body);
    if (rel.startsWith("/data/")) state.log.push({ path: rel, query: url.search, status: hit ? 304 : 200, bytes: hit ? 0 : body.length });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ state, server, origin: `http://127.0.0.1:${server.address().port}` })));
}

const PAGES = [
  ["realestate", "realestate.html"],
  ["budget-7eok (틀, 표만)", "budget-7eok.html"],
  ["deal-search (강남구)", `deal-search.html?district=${encodeURIComponent("강남구")}`],
  ["news", "news.html"],
];

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function oneCase(browser, origin, state, target, { sw, expired }) {
  state.maxAge = expired ? 0 : 600;
  const context = await browser.newContext({ serviceWorkers: sw ? "allow" : "block" });
  try {
    if (sw) {
      const p = await context.newPage();
      await p.goto(`${origin}/jipgye/index.html`);
      await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await settle(p);
      await p.close();
    }
    const first = await context.newPage();
    await first.goto(`${origin}/jipgye/${target}`);
    await settle(first);
    const controlled = sw ? await first.evaluate(() => Boolean(navigator.serviceWorker.controller)) : false;
    await first.close();
    state.log = [];
    const again = await context.newPage();
    await again.goto(`${origin}/jipgye/${target}`);
    await settle(again);
    await again.close();
    const log = state.log;
    state.log = [];
    const sum = (f) => log.filter(f).reduce((s, e) => s + e.bytes, 0);
    return {
      controlled,
      requests: log.length,
      ok200: log.filter((e) => e.status === 200).length,
      not304: log.filter((e) => e.status === 304).length,
      bytes: sum(() => true),
      keyedBytes: sum((e) => e.query.startsWith("?v=")),
      keylessBytes: sum((e) => !e.query.startsWith("?v=") && !e.query.startsWith("?_=")),
      files: [...new Set(log.map((e) => `${e.path}${e.query.slice(0, 3)}:${e.status}`))].sort(),
    };
  } finally {
    await context.close();
  }
}

const builds = { base: path.resolve(arg("base")), head: path.resolve(arg("head")) };
const browser = await chromium.launch();
const rows = [];
try {
  for (const [label, target] of PAGES) {
    for (const sw of [false, true]) {
      for (const expired of [false, true]) {
        const row = { page: label, sw: sw ? "허용" : "차단", when: expired ? "만료 뒤" : "즉시" };
        for (const [name, dir] of Object.entries(builds)) {
          const { state, server, origin } = await serve(dir);
          try {
            row[name] = await oneCase(browser, origin, state, target, { sw, expired });
          } finally {
            server.close();
          }
        }
        row.change = row.base.bytes ? Math.round(((row.head.bytes - row.base.bytes) / row.base.bytes) * 1000) / 10 : null;
        rows.push(row);
        console.log(`${row.page} | SW ${row.sw} | ${row.when} | base ${row.base.bytes} B (200×${row.base.ok200}, 304×${row.base.not304}) | head ${row.head.bytes} B (200×${row.head.ok200}, 304×${row.head.not304}) | ${row.change}%${sw ? ` | 제어 base=${row.base.controlled} head=${row.head.controlled}` : ""}`);
      }
    }
  }
} finally {
  await browser.close();
}
if (arg("out")) writeFileSync(arg("out"), JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2) + "\n");
