import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { STALE_DAYS, computeAges, kstDayNumber, readDataSources } from "../scripts/source-age.mjs";
import { NO_DATA_PAGES, PAGE_SOURCES, baselineFor, stampAll, stampHtml } from "../scripts/updated-stamp.mjs";

/**
 * 데이터 기준일(정적)과 "n일 전 자료"(보는 순간 계산)를 나눈 것을 묶는다 (#111).
 *
 * 날짜 의존 검사는 넣지 않는다(#8): 오늘 날짜는 전부 인자로 주입하고, 파일 시험은 고정 입력(임시 폴더)으로
 * 돈다. 저장소에 커밋된 docs/는 '생성물이 소스와 맞나'만 본다(오늘과 비교하지 않는다).
 */

const root = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(root, "docs");

const SHELL = (inner) => `<header><div class="updated" id="updated">불러오는 중...</div></header>${inner}`;

/** nav.js를 가짜 문서에서 돌린다. now는 주입하는 '지금' 시각(ISO). 경고 칸의 최종 상태를 돌려준다. */
async function runNav(html, nowIso, lang = "ko") {
  return (await runNavFull(html, nowIso, lang)).warn;
}

/** runNav + #updated 글자 + 언어 전환(MutationObserver 콜백 호출). setLang(l)은 lang을 바꾸고 관찰자를 깨운다. */
async function runNavFull(html, nowIso, lang = "ko") {
  const source = await readFile(path.join(DOCS, "nav.js"), "utf8");
  const date = html.match(/id="updated"[^>]*data-updated="([^"]*)"/)?.[1] ?? null;
  const text = html.match(/id="updated"[^>]*>([^<]*)</)?.[1] ?? "";
  const updated = { textContent: text, getAttribute: (n) => (n === "data-updated" ? date : null) };
  let current = lang;
  const observers = [];
  class FakeObserver {
    constructor(cb) {
      observers.push(cb);
    }
    observe() {}
  }
  const warn = { hidden: true, textContent: "" };
  const els = { updated, "updated-warn": warn };
  const RealDate = Date;
  const fixed = RealDate.parse(nowIso);
  class FakeDate extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  vm.runInNewContext(source, {
    Date: FakeDate,
    document: {
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: (id) => els[id] ?? null,
      documentElement: { getAttribute: () => current },
    },
    MutationObserver: FakeObserver,
    window: { addEventListener() {} },
  });
  const setLang = (l) => {
    current = l;
    for (const cb of observers) cb([]);
  };
  return { warn, updated, setLang };
}

const stamped = (ymd) => stampHtml(SHELL("<main>본문</main>"), ymd);

test("기준일이 HTML에 글자로 찍히고, 불러오는 중은 남지 않는다 (JS 없이도 보인다)", () => {
  const html = stamped("2026-10-08");
  assert.match(html, /<div class="updated" id="updated" data-updated="2026-10-08">기준일 2026-10-08<\/div>/);
  assert.ok(!html.includes("불러오는 중"), "자리표시자가 남았다");
  assert.match(html, /id="updated-warn"[^>]*hidden/, "경고 자리는 처음엔 숨겨져 있어야 한다");
});

test("다시 찍어도 같다 (멱등)", () => {
  const once = stamped("2026-10-08");
  assert.equal(stampHtml(once, "2026-10-08"), once);
  assert.match(stampHtml(once, "2026-10-09"), /data-updated="2026-10-09">기준일 2026-10-09</);
  assert.equal([...stampHtml(once, "2026-10-09").matchAll(/id="updated-warn"/g)].length, 1);
});

test("오늘=기준일+1일이면 경고가 없고, +2일 이상이면 'n일 전 자료'가 나온다", async () => {
  const html = stamped("2026-10-08");
  for (const [now, n] of [
    ["2026-10-08T03:00:00Z", 0],
    ["2026-10-09T03:00:00Z", 1],
    ["2026-10-10T03:00:00Z", 2],
    ["2026-10-15T03:00:00Z", 7],
  ]) {
    const warn = await runNav(html, now);
    if (n < 2) {
      assert.equal(warn.hidden, true, `${n}일 경과인데 경고가 열렸다`);
      assert.equal(warn.textContent, "");
    } else {
      assert.equal(warn.hidden, false, `${n}일 경과인데 경고가 없다`);
      assert.equal(warn.textContent, `${n}일 전 자료`);
    }
  }
});

test("날짜 경계는 KST다 (UTC 15시에 하루가 넘어간다)", async () => {
  const html = stamped("2026-10-08");
  // UTC 10-09 14:59 = KST 10-09 23:59 -> 1일. UTC 10-09 15:00 = KST 10-10 00:00 -> 2일.
  assert.equal((await runNav(html, "2026-10-09T14:59:59Z")).hidden, true);
  assert.equal((await runNav(html, "2026-10-09T15:00:00Z")).textContent, "2일 전 자료");
});

test("같은 HTML에 다른 오늘을 넣어도 HTML은 그대로고 경고만 달라진다", async () => {
  const html = stamped("2026-10-08");
  const before = html;
  const a = await runNav(html, "2026-10-09T03:00:00Z");
  const b = await runNav(html, "2026-10-20T03:00:00Z");
  assert.equal(html, before, "HTML이 바뀌었다");
  assert.notEqual(a.textContent, b.textContent);
  assert.equal(b.textContent, "12일 전 자료");
});

test("영어 화면에서는 영어로 경고한다", async () => {
  const warn = await runNav(stamped("2026-10-08"), "2026-10-15T03:00:00Z", "en");
  assert.equal(warn.textContent, "Data from 7 days ago");
});

test("영어 화면에서는 기준일 라벨이 'As of'이고, 한국어 화면에서는 '기준일'이다 (#123)", async () => {
  const html = stamped("2026-10-08");
  const en = await runNavFull(html, "2026-10-09T03:00:00Z", "en");
  assert.equal(en.updated.textContent, "As of 2026-10-08");
  const ko = await runNavFull(html, "2026-10-09T03:00:00Z", "ko");
  assert.equal(ko.updated.textContent, "기준일 2026-10-08");
});

test("화면 언어를 바꾸면 기준일 라벨이 따라간다 (ko -> en -> ko)", async () => {
  const r = await runNavFull(stamped("2026-10-08"), "2026-10-09T03:00:00Z", "ko");
  r.setLang("en");
  assert.equal(r.updated.textContent, "As of 2026-10-08");
  r.setLang("ko");
  assert.equal(r.updated.textContent, "기준일 2026-10-08");
});

test("페이지 스크립트가 #updated를 자기 문장으로 바꾼 장은 건드리지 않는다", async () => {
  const html = stamped("2026-10-08").replace(">기준일 2026-10-08<", ">Viewing archive 2026-10-01<");
  const r = await runNavFull(html, "2026-10-09T03:00:00Z", "en");
  assert.equal(r.updated.textContent, "Viewing archive 2026-10-01");
});

test("저장소 docs: 영어 화면에서 기준일을 찍은 모든 장의 라벨에 한국어가 0장이다 (#123)", async () => {
  let n = 0;
  for (const file of Object.keys(PAGE_SOURCES)) {
    const html = await readFile(path.join(DOCS, file), "utf8");
    const r = await runNavFull(html, "2026-10-09T03:00:00Z", "en");
    n += 1;
    assert.match(r.updated.textContent, /^As of \d{4}-\d{2}-\d{2}$/, `docs/${file}: 영어 화면에 '${r.updated.textContent}'`);
  }
  assert.equal(n, Object.keys(PAGE_SOURCES).length);
});

test("기준일이 없거나 깨졌으면 경고하지 않는다 (없는 날짜로 겁주지 않는다)", async () => {
  for (const html of [SHELL(""), stampHtml(SHELL(""), "2026-10-08").replace("2026-10-08", "어제")]) {
    const warn = await runNav(html, "2027-01-01T00:00:00Z");
    assert.equal(warn.hidden, true);
  }
});

test("브라우저 문턱·일수 계산이 source-age.mjs와 같다 (드리프트)", async () => {
  const nav = await readFile(path.join(DOCS, "nav.js"), "utf8");
  assert.equal(Number(nav.match(/const STALE_DAYS = (\d+)/)?.[1]), STALE_DAYS, "nav.js 문턱이 source-age.mjs와 다르다");
  const html = stamped("2026-10-08");
  for (const now of ["2026-10-08T14:59:59Z", "2026-10-08T15:00:00Z", "2026-10-09T15:00:00Z", "2026-10-10T20:00:00Z", "2026-11-30T00:00:00Z"]) {
    const [{ ageDays }] = computeAges([{ name: "x", file: "x", updatedAt: "2026-10-08T02:41:35.997Z" }], new Date(Date.parse(now) + 9 * 3600e3).toISOString().slice(0, 10));
    const warn = await runNav(html, now);
    assert.equal(warn.hidden, ageDays < STALE_DAYS, `${now}: 빌드 쪽 경과 ${ageDays}일과 브라우저 판정이 다르다`);
    if (!warn.hidden) assert.equal(warn.textContent, `${ageDays}일 전 자료`);
  }
  assert.equal(kstDayNumber("2026-10-08T15:00:00Z") - kstDayNumber("2026-10-08T14:59:59Z"), 1);
});

test("여러 소스를 읽는 장은 가장 오래된 updatedAt의 KST 날짜가 기준일이다", () => {
  const sources = [
    { name: "news", updatedAt: "2026-10-10T00:10:46.597Z" },
    { name: "summary", updatedAt: "2026-10-08T15:30:00.000Z" }, // KST 10-09 00:30
    { name: "rates", updatedAt: "2026-10-01T00:00:00.000Z" },
  ];
  assert.equal(baselineFor(["news", "summary"], sources), "2026-10-09");
  assert.equal(baselineFor(["summary", "news"], sources), "2026-10-09", "순서에 따라 갈린다");
  assert.equal(baselineFor(["rates"], sources), "2026-10-01");
  assert.throws(() => baselineFor(["news", "없는소스"], sources), /없는소스/, "소스가 없으면 조용히 넘어가지 않는다");
});

test("stampAll: 임시 폴더의 페이지에 그 페이지 소스의 가장 오래된 날짜를 찍는다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stamp-"));
  try {
    const docs = path.join(dir, "docs");
    const data = path.join(docs, "data");
    await mkdir(data, { recursive: true });
    await writeFile(path.join(data, "news.json"), JSON.stringify({ updatedAt: "2026-10-10T00:00:00Z" }));
    await writeFile(path.join(data, "summary.json"), JSON.stringify({ updatedAt: "2026-10-07T03:00:00Z" }));
    await writeFile(path.join(data, "news-history.json"), JSON.stringify({ entries: [] })); // updatedAt 없음: 소스 아님
    await writeFile(path.join(docs, "news.html"), SHELL("<main>뉴스</main>"));
    const done = await stampAll({ docsDir: docs, dataDir: data, pages: { "news.html": ["news", "summary"] }, noData: [] });
    assert.deepEqual(done, ["news.html"]);
    assert.match(await readFile(path.join(docs, "news.html"), "utf8"), /data-updated="2026-10-07">기준일 2026-10-07</);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("저장소 docs: id=updated가 있는 장은 모두 표에 있고 정적 '불러오는 중'이 0장이다", async () => {
  const files = (await readdir(DOCS)).filter((f) => f.endsWith(".html")).sort();
  const withUpdated = [];
  for (const f of files) {
    const html = await readFile(path.join(DOCS, f), "utf8");
    if (!html.includes('id="updated"')) continue;
    withUpdated.push(f);
    assert.ok(!/id="updated"[^>]*>\s*불러오는 중/.test(html), `docs/${f}: #updated에 '불러오는 중...'이 정적으로 남았다`);
  }
  const known = new Set([...Object.keys(PAGE_SOURCES), ...NO_DATA_PAGES]);
  assert.deepEqual(withUpdated.filter((f) => !known.has(f)), [], "소스 표에 없는 장 (PAGE_SOURCES 또는 NO_DATA_PAGES에 넣을 것)");
  assert.deepEqual([...known].filter((f) => !withUpdated.includes(f)), [], "표에는 있는데 #updated가 없는 장");
});

test("저장소 docs: 찍힌 기준일이 그 장 소스의 가장 오래된 updatedAt과 같다 (오늘과 비교하지 않는다)", async () => {
  const sources = readDataSources(path.join(DOCS, "data"));
  for (const [file, names] of Object.entries(PAGE_SOURCES)) {
    const html = await readFile(path.join(DOCS, file), "utf8");
    const want = baselineFor(names, sources);
    assert.match(html, new RegExp(`id="updated" data-updated="${want}">기준일 ${want}<`), `docs/${file}: 기준일이 ${want}이어야 한다 (node scripts/build-updated-stamp.mjs)`);
  }
});

test("소스 표가 장이 실제로 읽는 파일을 빠뜨리지 않는다", async () => {
  const sources = readDataSources(path.join(DOCS, "data"));
  const known = new Set(sources.map((s) => s.name));
  for (const [file, names] of Object.entries(PAGE_SOURCES)) {
    for (const n of names) assert.ok(known.has(n), `${file}: '${n}'은 updatedAt이 있는 소스가 아니다`);
    const html = await readFile(path.join(DOCS, file), "utf8");
    const read = new Set();
    for (const m of html.matchAll(/loadJson\("([a-z-]+)"\)|\.\/data\/([a-z-]+)\.json/g)) read.add(m[1] ?? m[2]);
    for (const m of html.matchAll(/loadJson\(`([a-z-]+)-\$\{/g)) read.add(m[1]); // 구별 묶음(deals-<구> 등)
    for (const n of read) if (known.has(n)) assert.ok(names.includes(n), `${file}이 읽는 ${n}.json이 소스 표에 없다`);
  }
});

test("스탬프 빌더가 update-all과 워크플로 양쪽에, 모든 페이지 빌더 뒤에 있다", async () => {
  const [all, wf] = await Promise.all([readFile(path.join(root, "scripts/update-all.mjs"), "utf8"), readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8")]);
  for (const [name, text] of [["update-all.mjs", all], ["daily-update.yml", wf]]) {
    const order = [...text.matchAll(/node scripts\/([a-z-]+\.mjs)/g)].map((m) => m[1]);
    const stamp = order.indexOf("build-updated-stamp.mjs");
    assert.ok(stamp >= 0, `${name}이 build-updated-stamp.mjs를 부르지 않는다`);
    assert.ok(stamp > order.indexOf("build-realestate-pages.mjs"), `${name}: 페이지 빌더가 다시 쓰기 전에 찍으면 날짜가 덮인다`);
  }
});
