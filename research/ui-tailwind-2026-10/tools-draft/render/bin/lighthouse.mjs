#!/usr/bin/env node
// Lighthouse 기준선(#274 범위 3, S7): 장마다 N회(기본 3) 돌려 지표별 중앙값을 낸다. 합격 조건이 아니라 개편 전후를 견주는 자다.
//   node bin/lighthouse.mjs --dir <구운 폴더> --out <폴더> [--pages index.html,rates.html] [--runs 3]
//   node bin/lighthouse.mjs --base-url https://kyhsa93.github.io/jipgye/ --out <폴더> [--pages …] [--runs 3]
// --dir은 그 폴더를 127.0.0.1에 서빙해서 잰다 — 병합 전의 후보도 같은 방식으로 잴 수 있는 쪽이라 **앞뒤 비교는 이쪽으로 한다**.
// --base-url은 배포 사이트를 잰다(네트워크가 섞여 흔들린다, 참고용).
// 프리셋은 Lighthouse 기본(모바일 폼팩터, 시뮬레이션 스로틀링)이고 범주는 performance·accessibility·seo다.
// GA·애드센스·환율 API는 막는다(lib/lighthouse.mjs BLOCKED_URL_PATTERNS — 이유도 거기). 뒤 측정도 같은 머신·같은 Chrome으로 해야 견줄 수 있다.
// Lighthouse는 이 폴더의 의존이 아니다: 기본은 `npx -y lighthouse@<LIGHTHOUSE_VERSION>`이고, 미리 깔아 둔 것이 있으면
// LIGHTHOUSE_BIN=<…/node_modules/.bin/lighthouse>로 준다. 원본 LHR(JSON)은 --out에 남고 저장소에 커밋하지 않는다.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findChrome } from "../lib/chrome.mjs";
import { BLOCKED_URL_PATTERNS, formatLighthouseTable, LIGHTHOUSE_VERSION, medianSummary, summarizeLhr } from "../lib/lighthouse.mjs";
import { serveDir } from "../lib/serve.mjs";

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
if ((!opt.dir && !opt["base-url"]) || !opt.out) {
  console.error("사용: node bin/lighthouse.mjs (--dir <구운 폴더> | --base-url <주소>) --out <폴더> [--pages a.html,b.html] [--runs 3]");
  process.exit(2);
}
const pages = (opt.pages ?? "index.html,realestate.html,budget-7eok.html,district-gangnam.html,rates.html").split(",").filter(Boolean);
const runs = Number(opt.runs ?? 3);
const chromePath = findChrome();
const [cmd, pre] = process.env.LIGHTHOUSE_BIN ? [process.env.LIGHTHOUSE_BIN, []] : ["npx", ["-y", `lighthouse@${LIGHTHOUSE_VERSION}`]];

await mkdir(opt.out, { recursive: true });
const server = opt.dir ? await serveDir(opt.dir) : null;
const baseUrl = server?.url ?? opt["base-url"].replace(/\/?$/, "/");
// spawnSync를 쓰면 안 된다 — 이 프로세스가 --dir을 서빙하고 있어서, 이벤트 루프가 막히면 Lighthouse가 받을 응답이 없다.
const run = (args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...(chromePath ? { CHROME_PATH: chromePath } : {}) }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ status: -1, stderr: e.message }));
    child.on("close", (status) => resolve({ status, stderr }));
  });
const rows = [];
let env = null;
try {
  for (const file of pages) {
    const summaries = [];
    for (let n = 1; n <= runs; n++) {
      const outFile = path.join(opt.out, `${file.replace(/\.html$/, "")}.${n}.json`);
      const args = [...pre, baseUrl + file, "--quiet", "--output=json", `--output-path=${outFile}`, "--only-categories=performance,accessibility,seo", "--chrome-flags=--headless=new", ...BLOCKED_URL_PATTERNS.map((p) => `--blocked-url-patterns=${p}`)];
      const r = await run(args);
      if (r.status !== 0) throw new Error(`lighthouse 실패(${file} ${n}회차, 종료 ${r.status}): ${r.stderr.slice(-1500)}`);
      const lhr = JSON.parse(await readFile(outFile, "utf8"));
      if (lhr.runtimeError) throw new Error(`lighthouse 런타임 오류(${file} ${n}회차): ${lhr.runtimeError.message}`);
      env ??= { lighthouse: lhr.lighthouseVersion, userAgent: lhr.environment?.hostUserAgent, benchmarkIndex: lhr.environment?.benchmarkIndex, formFactor: lhr.configSettings?.formFactor, throttlingMethod: lhr.configSettings?.throttlingMethod, throttling: lhr.configSettings?.throttling };
      const s = summarizeLhr(lhr);
      summaries.push(s);
      console.error(`${file} ${n}/${runs}: 성능 ${s.performance} 접근성 ${s.accessibility} SEO ${s.seo} LCP ${Math.round(s.lcp ?? 0)}ms CLS ${(s.cls ?? 0).toFixed(3)} TBT ${Math.round(s.tbt ?? 0)}ms`);
    }
    rows.push({ page: file, runs: summaries.length, median: medianSummary(summaries), all: summaries });
  }
  const meta = { target: opt.dir ? `local:${path.resolve(opt.dir)}` : baseUrl, node: process.version, platform: `${process.platform} ${process.arch}`, blocked: BLOCKED_URL_PATTERNS, ...env };
  await writeFile(path.join(opt.out, "lighthouse.json"), `${JSON.stringify({ meta, rows }, null, 2)}\n`);
  console.log(formatLighthouseTable(rows));
  console.log(`\n환경: ${JSON.stringify(meta)}`);
} catch (e) {
  console.error(e.stack ?? e.message);
  process.exitCode = 1;
} finally {
  await server?.close();
}
