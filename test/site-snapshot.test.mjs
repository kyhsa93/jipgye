import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { EXTRA_PROBES, capture, diffSnapshots, listFiles, renderDiff, urlOf } from "../scripts/site-snapshot.ts";

// 배포본 스냅샷과 전후 대조 (#510, 구조 B-4). 가짜 fetch 와 127.0.0.1 임시 서버만 쓴다 - 외부 네트워크·날짜·데이터를 안 본다(#8).
const run = promisify(execFile);
const BASE = "https://example.test/jipgye/";
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** 가짜 배포본: site 는 경로(키) -> 본문 | { status, body }. 없는 경로는 404 + 고정 본문. 요청을 requests 에 쌓는다. */
function fakeFetch(site, requests = []) {
  return async (url, opts) => {
    requests.push({ url, redirect: opts?.redirect });
    const key = url === BASE ? "/" : decodeURIComponent(url.slice(BASE.length));
    const hit = site[key];
    if (hit instanceof Error) throw hit;
    if (hit === undefined) return new Response("<h1>404</h1>", { status: 404 });
    return typeof hit === "string" ? new Response(hit, { status: 200 }) : new Response(hit.body, { status: hit.status });
  };
}

const SITE = { "/": "<html>홈</html>", "index.html": "<html>홈</html>", "a.html": "<html>a</html>", "b.html": "<html>b</html>", "sw.js": "cache-v1", "style.css": "x{}", "data/n.json": "{}" };
const KEYS = ["index.html", "a.html", "b.html", "sw.js", "style.css", "data/n.json"];
const fixed = () => new Date("2026-10-24T00:00:00Z");

test("capture: 목록·루트·덧붙임(sitemap·robots·404·없는 경로)을 한 번씩 GET 하고 상태·바이트·해시를 적는다 - 리다이렉트는 따라가지 않는다", async () => {
  const requests = [];
  const snap = await capture({ base: BASE, keys: KEYS, fetchImpl: fakeFetch(SITE, requests), now: fixed });
  assert.equal(snap.capturedAt, "2026-10-24T00:00:00.000Z");
  assert.deepEqual(Object.keys(snap.probes), [...new Set(["/", ...KEYS, ...EXTRA_PROBES])].sort(), "키가 글자순이 아니거나 덧붙임이 빠졌다");
  assert.equal(requests.length, Object.keys(snap.probes).length, "같은 URL 을 두 번 이상 받았다");
  assert.ok(requests.every((r) => r.url.startsWith(BASE) && r.redirect === "manual"), "base 밖을 요청했거나 리다이렉트를 따라간다");
  assert.deepEqual(snap.probes["a.html"], { status: 200, bytes: Buffer.byteLength("<html>a</html>"), sha256: sha("<html>a</html>") });
  assert.equal(snap.probes["sitemap.xml"].status, 404, "이 저장소 docs/ 에는 sitemap 이 없다 - 404 로 적힌다");
  assert.equal(snap.summary.sitemap.status, 404);
  assert.equal(snap.summary.notFound.sha256, sha("<h1>404</h1>"));
  assert.equal(snap.summary.swSha256, sha("cache-v1"));
  assert.deepEqual(snap.summary.html, ["a.html", "b.html", "index.html"], "HTML 목록은 200 인 최상위 .html 만");
  assert.equal(snap.summary.htmlCount, 3);
});

test("capture: 네트워크 오류는 그 경로의 error 로 남고 나머지는 계속된다", async () => {
  const snap = await capture({ base: BASE, keys: KEYS, fetchImpl: fakeFetch({ ...SITE, "a.html": new Error("ECONNRESET") }), now: fixed });
  assert.equal(snap.probes["a.html"].status, null);
  assert.equal(snap.probes["a.html"].error, "ECONNRESET");
  assert.equal(snap.probes["b.html"].status, 200);
});

test("diff: 같은 두 스냅샷은 차이 0 이고 합격선 항목(HTML 목록·sw.js·sitemap·404)이 모두 (같다) 로 찍힌다", async () => {
  const a = await capture({ base: BASE, keys: KEYS, fetchImpl: fakeFetch(SITE), now: fixed });
  const b = await capture({ base: BASE, keys: KEYS, fetchImpl: fakeFetch(SITE), now: () => new Date("2026-10-25T00:00:00Z") });
  const d = diffSnapshots(a, b);
  assert.deepEqual({ ...d, same: undefined }, { onlyBefore: [], onlyAfter: [], status: [], bytes: [], same: undefined });
  const text = renderDiff(a, b, d).join("\n");
  assert.match(text, /HTML 목록: 같다/);
  assert.match(text, /sw\.js sha256: .*\(같다\)/);
  assert.match(text, /sitemap\.xml: .*\(같다\)/);
  assert.match(text, /404 응답\(없는 경로\): .*\(같다\)/);
  assert.match(text, /요약: 같음 \d+ · 차이 0/);
});

test("diff: 바이트가 다른 장·sw.js 해시·없어진 장·상태 코드 변화를 종류별로 잡는다", async () => {
  const a = await capture({ base: BASE, keys: KEYS, fetchImpl: fakeFetch(SITE), now: fixed });
  const after = { ...SITE, "a.html": "<html>a 바뀜</html>", "sw.js": "cache-v2", "b.html": { status: 404, body: "없음" }, "style.css": { status: 500, body: "x" } };
  const b = await capture({ base: BASE, keys: KEYS, fetchImpl: fakeFetch(after), now: fixed });
  const d = diffSnapshots(a, b);
  assert.deepEqual(d.bytes.sort(), ["a.html", "sw.js"]);
  assert.deepEqual(d.status.map((s) => [s.key, s.before, s.after]).sort(), [["b.html", 200, 404], ["style.css", 200, 500]]);
  const text = renderDiff(a, b, d).join("\n");
  assert.match(text, /HTML 목록: 다르다 - 없어짐 b\.html/);
  assert.match(text, /sw\.js sha256: .*\(다르다\)/);
  assert.match(text, /바이트 다름: a\.html/);
  assert.match(text, /상태 코드: b\.html 200 -> 404/);
  assert.doesNotMatch(text, /참고: 차이가 method\.html/, "섞인 차이에 창 힌트를 붙였다");
});

test("diff: 전·후 목록이 다르면(후에만/전에만 찍힘) 목록 차이로 잡는다 - --like 가 목록을 맞추는 이유", async () => {
  const a = await capture({ base: BASE, keys: KEYS, fetchImpl: fakeFetch(SITE), now: fixed });
  const b = await capture({ base: BASE, keys: [...KEYS, "c.html"], fetchImpl: fakeFetch({ ...SITE, "c.html": "c" }), now: fixed });
  const d = diffSnapshots(a, b);
  assert.deepEqual(d.onlyAfter, ["c.html"]);
  assert.deepEqual(diffSnapshots(b, a).onlyBefore, ["c.html"]);
});

test("diff: 차이가 method.html·budget-*.html 뿐이면 예산 창(BUILD_NOW UTC 날짜) 힌트를 한 줄 붙인다 - 합격 판정은 사람이 한다", async () => {
  const site = { ...SITE, "method.html": "m1", "budget-7eok.html": "b1" };
  const keys = [...KEYS, "method.html", "budget-7eok.html"];
  const a = await capture({ base: BASE, keys, fetchImpl: fakeFetch(site), now: fixed });
  const b = await capture({ base: BASE, keys, fetchImpl: fakeFetch({ ...site, "method.html": "m2", "budget-7eok.html": "b2" }), now: fixed });
  const text = renderDiff(a, b).join("\n");
  assert.match(text, /참고: 차이가 method\.html·budget-\*\.html 뿐이다/);
  const c = await capture({ base: BASE, keys, fetchImpl: fakeFetch({ ...site, "method.html": "m2", "a.html": "다름" }), now: fixed });
  assert.doesNotMatch(renderDiff(a, c).join("\n"), /참고: 차이가/);
});

test("listFiles·urlOf: 디렉터리 아래 파일을 / 구분 상대 경로로 글자순으로 나열하고, URL 은 한글·공백을 인코딩하며 루트 키는 base 다", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "snap-list-"));
  try {
    mkdirSync(path.join(dir, "data/sub"), { recursive: true });
    for (const f of ["b.html", "a.html", "data/n.json", "data/sub/z.json"]) writeFileSync(path.join(dir, f), "x");
    assert.deepEqual(listFiles(dir), ["a.html", "b.html", "data/n.json", "data/sub/z.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(urlOf(BASE, "/"), BASE);
  assert.equal(urlOf(BASE, "data/강남 구.json"), `${BASE}data/${encodeURIComponent("강남 구")}.json`);
});

test("CLI: capture(--dir) -> capture(--like) -> diff 가 임시 서버에서 끝까지 돈다 - 같으면 종료 0, 바뀌면 1, 사용법 오류는 2", async () => {
  const docs = mkdtempSync(path.join(tmpdir(), "snap-docs-"));
  const out = mkdtempSync(path.join(tmpdir(), "snap-out-"));
  const state = { "/": "<html>홈</html>", "/index.html": "<html>홈</html>", "/a.html": "<html>a</html>", "/sw.js": "v1" };
  const server = createServer((req, res) => {
    const hit = state[req.url ?? ""];
    res.statusCode = hit === undefined ? 404 : 200;
    res.end(hit ?? "404");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const cli = path.resolve(import.meta.dirname, "../scripts/site-snapshot.ts");
  const node = (args) => run(process.execPath, [cli, ...args]).then((r) => ({ code: 0, ...r }), (e) => e);
  try {
    for (const f of ["index.html", "a.html", "sw.js"]) writeFileSync(path.join(docs, f), "x");
    const before = path.join(out, "before.json");
    const after = path.join(out, "after.json");
    const c1 = await node(["capture", `--base=${base}`, `--dir=${docs}`, `--out=${before}`]);
    assert.equal(c1.code, 0, c1.stderr);
    assert.match(c1.stdout, /HTML 2장/);
    const snap = JSON.parse(readFileSync(before, "utf8"));
    assert.deepEqual(Object.keys(snap.probes), ["/", "404.html", "__no_such_page__.html", "a.html", "index.html", "robots.txt", "sitemap.xml", "sw.js"]);

    const c2 = await node(["capture", `--base=${base}`, `--like=${before}`, `--out=${after}`]);
    assert.equal(c2.code, 0, c2.stderr);
    const same = await node(["diff", before, after]);
    assert.equal(same.code, 0, same.stdout);
    assert.match(same.stdout, /차이 0/);

    state["/sw.js"] = "v2"; // 배포가 SW 를 바꿨다
    const c3 = await node(["capture", `--base=${base}`, `--like=${before}`, `--out=${after}`]);
    assert.equal(c3.code, 0, c3.stderr);
    const changed = await node(["diff", before, after]);
    assert.equal(changed.code, 1);
    assert.match(changed.stdout, /sw\.js sha256: .*\(다르다\)/);
    assert.match(changed.stdout, /바이트 다름: sw\.js/);

    assert.equal((await node(["capture", `--base=${base}`, `--out=${after}`])).code, 2, "--dir·--like 둘 다 없으면 사용법 오류다");
    assert.equal((await node(["capture", `--base=${base}`, `--dir=${docs}`, `--like=${before}`, `--out=${after}`])).code, 2, "둘을 같이 주면 사용법 오류다");
    assert.equal((await node(["diff", before])).code, 2);
    assert.equal((await node(["nope"])).code, 2);
  } finally {
    server.close();
    rmSync(docs, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
