// 재방문 데이터 전송량 측정 (#695 완료 2). 같은 docs/data 로 그린 두 렌더 출력(기준 base · 후보 head)을 Pages 헤더를 흉내 낸 로컬 서버로 띄우고,
// Chromium 으로 장을 두 번 연다(첫 방문 -> 재방문). 재방문 동안 서버가 /data/ 에 실제로 보낸 본문 바이트를 200·304 로 나눠 센다.
//
// 서버(Pages 재현, 2026-11-16 `curl -sI` 로 본 헤더): cache-control: max-age=600, ETag, If-None-Match 가 맞으면 304(본문 0), 쿼리는 무시한다.
// ETag 는 두 기준이 다르다: 이 흉내 서버는 내용 해시 ETag 이고, 실제 Pages 는 `"<배포 시각 16진>-<크기 16진>"`(약한 `W/` 포함)이라
// 600초 뒤 재검증은 그 사이 재배포가 없을 때만 304 다(#917). 흉내 서버의 ETag 동작은 #695 결과와 같은 기준을 지키려고 바꾸지 않는다.
// 「만료 뒤」는 서버가 max-age=0 + ETag 를 주는 것으로 대신한다(10분을 기다리지 않는다). 압축은 하지 않는다 - 바이트는 압축 전 본문이다(비율에는 영향이 없다).
//
// 경우(장마다, 렌더마다 넷): 서비스 워커 차단·허용 × 재방문 즉시·만료 뒤. 허용은 index.html 을 먼저 열어 SW 를 등록·활성화한 뒤 잰다.
//
// --set=917: 키 없이 받던 세 곳(search-index.json·reco-counts.json·reco-${sl}.json)은 장을 열기만 해서는 요청이 나가지 않는다. 장마다 고정한 조작
// (index 검색 입력칸 포커스, buy-by-budget 노원구 「줄 보기」)을 첫 방문과 재방문에서 똑같이 하고, 대상 파일별 값과 유효 조건(README 「#917」)을 함께 적는다.
// 옵션이 없으면 #695 때와 같은 네 장·같은 동작이다.
//
// 쓰는 법: PLAYWRIGHT=<playwright 패키지 경로> node research/data-version-key-2026-11/measure.mjs --base=<렌더 폴더> --head=<렌더 폴더> [--set=917] [--out=result.json]
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

const PAGES_695 = [
  ["realestate", "realestate.html"],
  ["budget-7eok (틀, 표만)", "budget-7eok.html"],
  ["deal-search (강남구)", `deal-search.html?district=${encodeURIComponent("강남구")}`],
  ["news", "news.html"],
];

/** 노원구 「줄 보기」: 버튼은 reco-counts.json 을 받은 뒤 그려지고 data-d 는 구 이름이 아니라 순번이다 - 「노원구」 행 머리의 버튼을 상한 안에서 기다린다. */
async function clickNowon(page) {
  const button = page.locator("#bt-live th", { hasText: "노원구" }).locator("button[data-d]");
  try {
    await button.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    throw new Error("[measure] buy-by-budget: 노원구 버튼이 15초 안에 그려지지 않았다 - 측정 실패(다른 구로 바꾸지 않는다)");
  }
  await button.click();
}

// [이름, 주소, 조작, 대상 파일]. 조작은 첫 방문·재방문 둘 다에서 한다 - 첫 방문에서 받아야 재방문의 캐시를 잴 수 있다.
const PAGES_917 = [
  ["index (검색 입력칸 포커스)", "index.html", (page) => page.focus("#site-search-input"), ["/data/search-index.json"]],
  ["buy-by-budget (노원구 줄 보기)", "buy-by-budget.html", clickNowon, ["/data/reco-counts.json", "/data/reco-nowon.json"]],
];

const SET = arg("set");
if (SET !== undefined && SET !== "917") throw new Error(`[measure] 모르는 --set=${SET}`);
const PAGES = SET === "917" ? PAGES_917 : PAGES_695;

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function oneCase(browser, origin, state, target, { sw, expired }, act, targets) {
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
    state.log = [];
    const first = await context.newPage();
    await first.goto(`${origin}/jipgye/${target}`);
    await settle(first);
    if (act) {
      await act(first);
      await settle(first);
    }
    const firstLog = state.log;
    const controlled = sw ? await first.evaluate(() => Boolean(navigator.serviceWorker.controller)) : false;
    await first.close();
    state.log = [];
    const again = await context.newPage();
    await again.goto(`${origin}/jipgye/${target}`);
    await settle(again);
    if (act) {
      await act(again);
      await settle(again);
    }
    await again.close();
    const log = state.log;
    state.log = [];
    const sum = (f) => log.filter(f).reduce((s, e) => s + e.bytes, 0);
    const extra = !targets
      ? {}
      : {
          // 첫 방문 대상 파일 200 수(유효 조건)와 재방문 대상 파일별 값(#917).
          firstOk200: Object.fromEntries(targets.map((t) => [t, firstLog.filter((e) => e.path === t && e.status === 200).length])),
          targets: Object.fromEntries(
            targets.map((t) => {
              const mine = log.filter((e) => e.path === t);
              return [t, { ok200: mine.filter((e) => e.status === 200).length, not304: mine.filter((e) => e.status === 304).length, bytes: mine.reduce((s, e) => s + e.bytes, 0) }];
            }),
          ),
        };
    return {
      controlled,
      requests: log.length,
      ok200: log.filter((e) => e.status === 200).length,
      not304: log.filter((e) => e.status === 304).length,
      bytes: sum(() => true),
      keyedBytes: sum((e) => e.query.startsWith("?v=")),
      keylessBytes: sum((e) => !e.query.startsWith("?v=") && !e.query.startsWith("?_=")),
      files: [...new Set(log.map((e) => `${e.path}${e.query.slice(0, 3)}:${e.status}`))].sort(),
      ...extra,
    };
  } finally {
    await context.close();
  }
}

const builds = { base: path.resolve(arg("base")), head: path.resolve(arg("head")) };
const browser = await chromium.launch();
const rows = [];
const failures = [];
try {
  for (const [label, target, act, targets] of PAGES) {
    for (const sw of [false, true]) {
      for (const expired of [false, true]) {
        const row = { page: label, sw: sw ? "허용" : "차단", when: expired ? "만료 뒤" : "즉시" };
        for (const [name, dir] of Object.entries(builds)) {
          const { state, server, origin } = await serve(dir);
          try {
            row[name] = await oneCase(browser, origin, state, target, { sw, expired }, act, targets);
          } finally {
            server.close();
          }
        }
        row.change = row.base.bytes ? Math.round(((row.head.bytes - row.base.bytes) / row.base.bytes) * 1000) / 10 : null;
        rows.push(row);
        console.log(`${row.page} | SW ${row.sw} | ${row.when} | base ${row.base.bytes} B (200×${row.base.ok200}, 304×${row.base.not304}) | head ${row.head.bytes} B (200×${row.head.ok200}, 304×${row.head.not304}) | ${row.change}%${sw ? ` | 제어 base=${row.base.controlled} head=${row.head.controlled}` : ""}`);
        if (targets) judge(row, sw, targets);
      }
    }
  }
} finally {
  await browser.close();
}
if (arg("out")) writeFileSync(arg("out"), JSON.stringify({ measuredAt: new Date().toISOString(), ...(SET ? { set: SET, failures } : {}), rows }, null, 2) + "\n");
if (failures.length) {
  console.error(failures.map((f) => `[measure] ${f}`).join("\n"));
  process.exitCode = 1;
}

/**
 * #917 유효 조건과 문턱(README 「#917」): 첫 방문 대상 파일 200 이 base·head 모두 1건 이상(아니면 조작 실패).
 * SW 허용 행은 측정 장이 SW 제어 아래이고 base 재방문에 대상 파일 200 이 1건 이상일 때만 인정하고, 그때 −80% 이상이어야 한다.
 * SW 차단 행은 기준도 HTTP 캐시가 받으니 기록만 하되, head 바이트가 base 보다 늘면 멈춘다.
 */
function judge(row, sw, targets) {
  const where = `${row.page} | SW ${row.sw} | ${row.when}`;
  for (const name of ["base", "head"]) for (const t of targets) if (row[name].firstOk200[t] < 1) failures.push(`${where}: ${name} 첫 방문에 ${t} 200 이 0건 - 조작 실패`);
  for (const t of targets) console.log(`  ${t} | base ${row.base.targets[t].bytes} B (200×${row.base.targets[t].ok200}, 304×${row.base.targets[t].not304}) | head ${row.head.targets[t].bytes} B (200×${row.head.targets[t].ok200}, 304×${row.head.targets[t].not304})`);
  if (sw) {
    row.valid = row.base.controlled && row.head.controlled && targets.every((t) => row.base.targets[t].ok200 >= 1);
    row.pass = row.valid && row.change !== null && row.change <= -80;
    if (!row.valid) failures.push(`${where}: 유효 조건 미달(SW 제어 또는 base 대상 파일 200) - 측정 실패`);
    else if (!row.pass) failures.push(`${where}: ${row.change}% - −80% 미달`);
  } else {
    row.recordOnly = true;
    if (row.head.bytes > row.base.bytes) failures.push(`${where}: 차단 행에서 head ${row.head.bytes} B > base ${row.base.bytes} B - 멈춤`);
  }
}
