// deploy-check: 가짜 fetch 와 임시 docs/ 로만 돈다. 네트워크·실제 배포본·시계를 쓰지 않는다(#8 교훈, #99).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDeploy, render, canonicalOf, locsOf, linksOf, urlOf } from "../scripts/deploy-check.mjs";

const BASE = "https://example.test/site/";

const PAGE_A = `<link rel="canonical" href="${BASE}a.html"><a href="./b.html#x">b</a><a href="https://other.test/x">밖</a><a href="missing.html">없음</a><script>const t = \`<a href="\${u}">\`;</script>`;
const PAGE_B = `<link rel="canonical" href="${BASE}b.html"><a href="./">홈</a><script src="app.js"></script>`;
const INDEX = `<link rel="canonical" href="${BASE}"><a href="a.html?q=1">a</a>`;

function fixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "deploy-check-"));
  const docs = join(root, "docs");
  mkdirSync(join(docs, "data"), { recursive: true });
  const files = { "index.html": INDEX, "a.html": PAGE_A, "b.html": PAGE_B, "app.js": "x=1", "data/n.json": "{}", ...extra };
  for (const [k, v] of Object.entries(files)) writeFileSync(join(docs, k), v);
  return { root, docs, files };
}

/** 배포본 흉내. site: URL -> 본문 | { status, body }. 요청한 URL을 requests 에 쌓는다. */
function fakeFetch(site, requests = []) {
  return async (url, opts) => {
    requests.push({ url, method: opts?.method, redirect: opts?.redirect });
    const hit = site[url];
    if (hit === undefined) return new Response("nf", { status: 404 });
    if (hit instanceof Error) throw hit;
    return typeof hit === "string" ? new Response(hit, { status: 200 }) : new Response(hit.body ?? "", { status: hit.status });
  };
}

const deployedFrom = (files, over = {}) => ({
  [BASE]: files["index.html"],
  [`${BASE}a.html`]: files["a.html"],
  [`${BASE}b.html`]: files["b.html"],
  [`${BASE}app.js`]: files["app.js"],
  [`${BASE}data/n.json`]: files["data/n.json"],
  [`${BASE}sitemap.xml`]: `<urlset><url><loc>${BASE}</loc></url><url><loc>${BASE}a.html</loc></url><url><loc>${BASE}b.html</loc></url></urlset>`,
  ...over,
});

const run = (docs, site, requests, extra = {}) => checkDeploy({ base: BASE, docsDir: docs, fetchImpl: fakeFetch(site, requests), gapMs: 0, ...extra });

test("조각 함수: canonical·loc·링크 추출 (쿼리·해시 제거, 범위 밖·템플릿 조각 제외)", () => {
  assert.equal(canonicalOf(`<link rel="stylesheet" href="s.css"><link rel="canonical" href="${BASE}a.html">`), `${BASE}a.html`);
  assert.equal(canonicalOf("<p>없음</p>"), null);
  assert.deepEqual(locsOf("<loc> a </loc><loc>b</loc>"), ["a", "b"]);
  const { targets, skipped } = linksOf(PAGE_A, `${BASE}a.html`, BASE);
  // canonical <link href> 도 내부 링크 대상이다(자기 자신)
  assert.deepEqual(targets.sort(), [`${BASE}a.html`, `${BASE}b.html`, `${BASE}missing.html`]);
  assert.equal(skipped, 1);
  assert.equal(urlOf(BASE, "index.html"), BASE);
});

test("전부 같으면 이상 0 - 요청은 GET 이고 base 밖으로 나가지 않으며 리다이렉트를 따르지 않는다", async () => {
  const { root, docs, files } = fixture({ "a.html": PAGE_A.replace('<a href="missing.html">없음</a>', "") });
  try {
    const requests = [];
    const r = await run(docs, deployedFrom(files), requests);
    assert.deepEqual(r.problems, []);
    assert.equal(r.unchecked, 0);
    assert.equal(r.counts.locs, 3);
    assert.equal(r.counts.html, 3);
    assert.ok(requests.length > 0);
    for (const q of requests) {
      assert.equal(q.method, "GET");
      assert.equal(q.redirect, "manual");
      assert.ok(q.url.startsWith(BASE), `base 밖 요청: ${q.url}`);
    }
    assert.equal(new Set(requests.map((q) => q.url)).size, requests.length, "같은 URL을 두 번 받았다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("해시 불일치·상태 이상·깨진 링크·canonical 불일치를 각각 잡고, 계속 그러면 재현으로 센다", async () => {
  const { root, docs, files } = fixture();
  try {
    const site = deployedFrom(files, {
      [`${BASE}app.js`]: "x=2", // 해시 불일치
      [`${BASE}data/n.json`]: { status: 500 }, // 상태 이상
      [`${BASE}b.html`]: PAGE_B.replace(`${BASE}b.html`, `${BASE}other.html`), // 해시 불일치 + sitemap loc canonical 불일치
    });
    const r = await run(docs, site);
    const by = (k) => r.problems.filter((p) => p.kind === k);
    assert.deepEqual(by("hash").map((p) => p.target).sort(), ["app.js", "b.html"]);
    assert.deepEqual(by("status").map((p) => p.target), ["data/n.json"]);
    assert.deepEqual(by("link").map((p) => p.target), [`${BASE}missing.html`]);
    assert.match(by("link")[0].detail, /상태 404.*a\.html/);
    assert.deepEqual(by("canonical").map((p) => p.target), [`${BASE}b.html`]);
    assert.ok(r.problems.every((p) => p.persisted === true));
    const out = render(r, { base: BASE, today: "2026-10-10", seconds: 1.5 }).join("\n");
    assert.match(out, /^배포본 https:\/\/example\.test\/site\/ \(KST 2026-10-10\)/);
    assert.match(out, /해시 불일치 2 · 상태 이상 1 · 깨진 링크 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("두 번째에 사라지는 이상은 1회만 - 배포 중간에 본 것은 재현이 아니다", async () => {
  const { root, docs, files } = fixture({ "a.html": PAGE_A.replace('<a href="missing.html">없음</a>', "") });
  try {
    const site = deployedFrom(files);
    const calls = new Map();
    const flaky = async (url, opts) => {
      calls.set(url, (calls.get(url) ?? 0) + 1);
      if (url === `${BASE}app.js` && calls.get(url) === 1) return new Response("옛것", { status: 200 });
      return fakeFetch(site)(url, opts);
    };
    const r = await checkDeploy({ base: BASE, docsDir: docs, fetchImpl: flaky, gapMs: 0 });
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].persisted, false);
    assert.match(render(r, { base: BASE, today: "2026-10-10", seconds: 0 }).join("\n"), /해시 불일치 0 .*1회만 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sitemap 이 없으면 없다고 센다 (loc 0), 요청 실패는 상태 이상으로 적고 멈추지 않는다", async () => {
  const { root, docs, files } = fixture({ "a.html": PAGE_A.replace('<a href="missing.html">없음</a>', "") });
  try {
    const site = deployedFrom(files);
    delete site[`${BASE}sitemap.xml`];
    site[`${BASE}app.js`] = new Error("ECONNRESET");
    const r = await run(docs, site);
    assert.equal(r.counts.sitemapStatus, 404);
    assert.equal(r.counts.locs, 0);
    assert.deepEqual(r.problems.map((p) => [p.kind, p.target]), [["status", "app.js"], ["link", `${BASE}app.js`]]); // 링크 대상이기도 한 파일이라 둘 다 적힌다
    assert.match(render(r, { base: BASE, today: "2026-10-10", seconds: 0 }).join("\n"), /sitemap 없음\(404\) - loc 0 대 html 파일 3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sitemap 의 제3자 loc 은 요청하지 않고, 파일 없는 loc 은 이상으로 적는다", async () => {
  const { root, docs, files } = fixture({ "a.html": PAGE_A.replace('<a href="missing.html">없음</a>', "") });
  try {
    const requests = [];
    const site = deployedFrom(files, { [`${BASE}sitemap.xml`]: `<loc>https://evil.test/x</loc><loc>${BASE}ghost.html</loc>`, [`${BASE}ghost.html`]: `<link rel="canonical" href="${BASE}ghost.html">` });
    const r = await run(docs, site, requests);
    assert.ok(!requests.some((q) => q.url.includes("evil.test")));
    assert.deepEqual(r.problems.map((p) => [p.kind, p.target, p.detail]), [["sitemap", `${BASE}ghost.html`, "docs/ 에 대응 파일 없음"]]);
    assert.equal(r.counts.locNoFile, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("시간 한도를 넘기면 남은 요청을 시작하지 않고 미확인으로 센다", async () => {
  const { root, docs, files } = fixture();
  try {
    let t = 0;
    const now = () => t;
    const slow = async (url, opts) => {
      t += 100; // 요청 하나가 100ms 쓴 것으로 친다
      return fakeFetch(deployedFrom(files))(url, opts);
    };
    const r = await checkDeploy({ base: BASE, docsDir: docs, fetchImpl: slow, concurrency: 1, budgetMs: 250, gapMs: 0, now });
    assert.ok(r.unchecked > 0);
    assert.match(render(r, { base: BASE, today: "2026-10-10", seconds: 0 }).join("\n"), /미확인 [1-9]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
