import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUST, DERIVED, PAGE_SETS, setFiles, stampDataKeys } from "../scripts/data-keys.ts";
import { NEWS_PAGES } from "../scripts/build-news-pages.ts";
import { createWriteSet } from "../scripts/render-writes.ts";
import { DOCS_DIR } from "../scripts/site-dir.ts";
import { SITE_DIR } from "./helpers/site-root.mjs";

// 데이터 판 키(#695): 나가는 사본에서만 `?_=${Date.now()}` 를 `?v=<8자>` 로 바꾼다. 이 파일의 (a)~(d)는 임시 폴더의 고정 입력과 소스 글자만 보고,
// (e)는 build/site 를 읽되 키를 출력 사본에서 다시 계산해 대조한다 - 실제 docs/data 의 해시값을 글자로 단언하지 않는다(데이터가 날마다 바뀐다, #8).

const repo = path.resolve(import.meta.dirname, "..");
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const SW = 'const SHELL_ASSETS = ["./index.html", "./nav.js"];\n';

/** 임시 출력 디렉터리: { 상대 경로: 내용 }. 셸 목록을 읽는 sw.js 는 늘 있다. */
function site(files) {
  const root = mkdtempSync(path.join(tmpdir(), "data-keys-"));
  made.push(root);
  for (const [rel, text] of Object.entries({ "sw.js": SW, ...files })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** build-updated-stamp 와 같은 쓰기 묶음으로 돌리고 commit 한다. */
function stamp(root) {
  const writes = createWriteSet();
  const io = { read: (f) => writes.peek(f) ?? readFileSync(f, "utf8"), write: (f, t) => writes.stage(f, t) };
  const r = stampDataKeys({ siteRoot: root, io });
  writes.commit({ log: () => {} });
  return r;
}

const keysIn = (text) => [...text.matchAll(/\?v=([0-9a-f]{8})/g)].map((m) => m[1]);
const PAGE = (url) => `<script>\nasync function loadJson(name) {\n  const res = await fetch(\`${url}${BUST}\`);\n  return res.json();\n}\n</script>\n`;
const STATIC_PAGE = PAGE("./data/trend.json");
const DYNAMIC_PAGE = PAGE("./data/${name}.json");

function fixture(over = {}) {
  return site({
    "a.html": STATIC_PAGE,
    "renewal-vs-new.html": DYNAMIC_PAGE,
    "stock-news.html": DYNAMIC_PAGE,
    "news.html": DYNAMIC_PAGE,
    "renewal-convert.js": `const get = (f) => fetch(\`./data/\${f}.json${BUST}\`);\n`,
    "data/trend.json": '{"a":1}\n',
    "data/renewal-facts.json": '{"f":1}\n',
    "data/renewal-cells-aaa.json": '{"c":1}\n',
    "data/renewal-cells-bbb.json": '{"c":2}\n',
    "data/news.json": '{"n":1}\n',
    "data/summary.json": '{"s":1}\n',
    "data/conversion.json": '{"v":1}\n',
    "data/market.json": '{"m":1}\n',
    "data/unrelated.json": '{"u":1}\n',
    ...over,
  });
}
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");

test("(a) 정적 키는 그 파일 바이트의 sha256 앞 8자다 - 1 B 가 바뀌면 키가 바뀌고, 같으면 같다", () => {
  const one = fixture();
  const two = fixture();
  const three = fixture({ "data/trend.json": '{"a":2}\n' });
  for (const r of [one, two, three]) stamp(r);
  const [k1, k2, k3] = [one, two, three].map((r) => keysIn(read(r, "a.html")));
  assert.deepEqual(k1, [sha('{"a":1}\n').slice(0, 8)]);
  assert.deepEqual(k1, k2, "같은 바이트인데 키가 다르다");
  assert.notDeepEqual(k1, k3, "1 B 가 바뀌었는데 키가 같다");
  assert.ok(read(one, "a.html").includes(`fetch(\`./data/trend.json?v=${k1[0]}\`)`), "주소 모양이 ./data/<이름>.json?v=<8자> 가 아니다");
});

test("(a) 집합 키는 표의 파일 중 하나라도 1 B 바뀌면 바뀌고, 집합 밖 파일·같은 바이트에는 그대로다 - 생성 장은 틀의 집합을 물려받는다", () => {
  const base = fixture();
  const same = fixture();
  const cell = fixture({ "data/renewal-cells-bbb.json": '{"c":3}\n' });
  const outside = fixture({ "data/unrelated.json": '{"u":2}\n' });
  const news = fixture({ "data/summary.json": '{"s":2}\n' });
  for (const r of [base, same, cell, outside, news]) stamp(r);
  const key = (r, f) => keysIn(read(r, f))[0];
  assert.match(key(base, "renewal-vs-new.html"), /^[0-9a-f]{8}$/);
  assert.equal(key(base, "renewal-vs-new.html"), key(same, "renewal-vs-new.html"));
  assert.notEqual(key(base, "renewal-vs-new.html"), key(cell, "renewal-vs-new.html"), "글롭(renewal-cells-*) 파일이 바뀌었는데 키가 같다");
  assert.equal(key(base, "renewal-vs-new.html"), key(outside, "renewal-vs-new.html"), "집합 밖 파일에 키가 흔들린다");
  assert.equal(key(base, "stock-news.html"), key(base, "news.html"), "파생 장(stock-news)이 news.html 의 집합을 물려받지 않았다");
  assert.notEqual(key(base, "news.html"), key(news, "news.html"));
  assert.equal(key(base, "renewal-vs-new.html"), key(news, "renewal-vs-new.html"), "뉴스만 바뀌었는데 뉴스 없는 장의 키가 바뀌었다");
  assert.notEqual(key(base, "renewal-convert.js"), key(base, "news.html"));
  assert.deepEqual(setFiles(path.join(base, "data"), PAGE_SETS["renewal-vs-new.html"]), ["renewal-cells-aaa.json", "renewal-cells-bbb.json", "renewal-facts.json"]);
});

test("(b) 출력이 docs/ 자신이면 읽기·쓰기 0 이고 아무것도 바꾸지 않는다", () => {
  const calls = [];
  const io = { read: (f) => (calls.push(["read", f]), ""), write: (f) => calls.push(["write", f]), bytes: (f) => (calls.push(["bytes", f]), Buffer.alloc(0)) };
  assert.deepEqual(stampDataKeys({ siteRoot: DOCS_DIR, io }), { files: 0, keys: 0, missing: [] });
  assert.deepEqual(stampDataKeys({ siteRoot: `${DOCS_DIR}${path.sep}`, io }), { files: 0, keys: 0, missing: [] });
  assert.deepEqual(calls, []);
});

test("(c) 실패 셋: 치환 뒤 남은 Date.now 요청, 표에 없는 동적 장, 맞는 파일 0개 집합 - 던지고 디스크에는 아무것도 안 쓴다", () => {
  const cases = [
    ["남은 요청(모르는 모양)", { "odd.html": `<script>fetch(base + \`${BUST}\`);</script>` }, /남았다: odd\.html/],
    ["남은 요청(셸 JS)", { "nav.js": `fetch(\`./data/trend.json${BUST}\`);\n` }, /남았다: nav\.js/],
    ["표에 없는 동적 장", { "mystery.html": DYNAMIC_PAGE }, /집합 표.*mystery\.html/],
    ["0개 집합", { "floor-gap.html": DYNAMIC_PAGE }, /floor-gap\.html.*0개/],
  ];
  for (const [label, extra, re] of cases) {
    const root = fixture(extra);
    const before = read(root, "a.html");
    assert.throws(() => stamp(root), re, label);
    assert.equal(read(root, "a.html"), before, `${label}: 실패했는데 앞 장을 디스크에 썼다`);
  }
});

/** 소스에서 로더가 받는 이름을 훑는다: 글자 이름, 템플릿 이름(`${…}` -> *), news 의 load("…"), renewal-convert 의 get("…"), index 의 todayKeys 배열. */
function scannedNames(file, text) {
  const out = new Set();
  for (const m of text.matchAll(/\bloadJson\("([\w/-]+)"\)/g)) out.add(`${m[1]}.json`);
  for (const m of text.matchAll(/\bloadJson\(`([^`]*)`\)/g)) out.add(`${m[1].replace(/\$\{[^}]*\}/g, "*")}.json`);
  for (const m of text.matchAll(/\bload\("([\w-]+)"\)/g)) out.add(`${m[1]}.json`);
  if (file.endsWith(".js")) for (const m of text.matchAll(/\bget\("([\w-]+)"\)/g)) out.add(`${m[1]}.json`);
  const today = text.match(/const todayKeys = \[([^\]]*)\]/);
  if (today) for (const m of today[1].matchAll(/"([\w-]+)"/g)) out.add(`${m[1]}.json`);
  return [...out].sort();
}
const glob = (p) => new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
const DYNAMIC = /\.\/data\/[^`"'\s]*\$\{[^}`]*\}[^`"'\s]*?\.json\?_=\$\{Date\.now\(\)\}/;

test("(d) 집합 표가 소스와 맞는다: 동적 로더가 있는 소스 = 표의 키, 로더가 받는 이름은 모두 표에 있고 표의 항목은 모두 로더가 받는다", () => {
  const sources = [
    ...readdirSync(path.join(repo, "docs")).filter((f) => /\.(html|js)$/.test(f)).map((f) => [f, path.join(repo, "docs", f)]),
    ["realestate-template.html", path.join(repo, "scripts/realestate-template.html")],
  ];
  const dynamic = sources.filter(([, full]) => DYNAMIC.test(readFileSync(full, "utf8"))).map(([f]) => f).sort();
  assert.deepEqual(dynamic, Object.keys(PAGE_SETS).sort(), "동적 이름 로더가 있는 소스와 집합 표의 키가 다르다");
  for (const [file, patterns] of Object.entries(PAGE_SETS)) {
    const names = scannedNames(file, readFileSync(path.join(repo, "docs", file), "utf8"));
    assert.ok(names.length > 0, `${file}: 소스에서 받는 이름을 하나도 못 찾았다 - 훑개가 낡았다`);
    for (const name of names) {
      const covered = patterns.includes(name) || patterns.some((p) => glob(p).test(name)) || (name.includes("*") && patterns.some((p) => glob(name).test(p)));
      assert.ok(covered, `${file}: 로더가 받는 ${name} 가 집합 표에 없다 - scripts/data-keys.ts PAGE_SETS 에 더한다`);
    }
    for (const p of patterns) {
      const used = names.includes(p) || names.some((n) => glob(p).test(n) || (n.includes("*") && glob(n).test(p)));
      assert.ok(used, `${file}: 표의 ${p} 를 받는 로더가 소스에 없다`);
    }
  }
  assert.deepEqual(Object.keys(DERIVED).sort(), NEWS_PAGES.map((p) => p.file).sort(), "news 파생 장 목록이 build-news-pages 와 다르다");
  assert.deepEqual([...new Set(Object.values(DERIVED))], ["news.html"]);
});

test("(e) 나가는 사이트: Date.now 요청 0곳, 정적 키는 출력 사본 sha256 앞 8자, 동적 키는 집합을 다시 계산한 값과 같다", () => {
  const files = readdirSync(SITE_DIR).filter((f) => /\.(html|js)$/.test(f));
  const left = files.filter((f) => read(SITE_DIR, f).includes(BUST));
  assert.deepEqual(left, [], "build/site 에 ?_=${Date.now()} 가 남았다");
  const data = path.join(SITE_DIR, "data");
  let statics = 0;
  let dynamics = 0;
  for (const f of files) {
    const text = read(SITE_DIR, f);
    for (const m of text.matchAll(/\.\/data\/([\w-]+(?:\/[\w-]+)*\.json)\?v=([0-9a-f]{8})/g)) {
      statics++;
      assert.equal(m[2], sha(readFileSync(path.join(data, m[1]))).slice(0, 8), `${f}: ${m[1]} 의 키가 출력 사본의 해시와 다르다`);
    }
    for (const m of text.matchAll(/\.\/data\/[^`"'\s]*\$\{[^}`]*\}[^`"'\s]*?\.json\?v=([0-9a-f]{8})/g)) {
      dynamics++;
      const list = setFiles(data, PAGE_SETS[DERIVED[f] ?? f]);
      assert.ok(list.length > 0, `${f}: 집합이 비었다`);
      assert.equal(m[1], sha(list.map((x) => `${x} ${sha(readFileSync(path.join(data, x)))}\n`).join("")).slice(0, 8), `${f}: 집합 키가 다시 계산한 값과 다르다`);
    }
  }
  assert.ok(statics > 0 && dynamics > 0, `키를 박은 주소를 못 찾았다(정적 ${statics} · 동적 ${dynamics})`);
});
