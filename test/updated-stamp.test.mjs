import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { STALE_DAYS, computeAges, kstDayNumber, readDataSources } from "../scripts/source-age.ts";
import { NO_DATA_PAGES, PAGE_SOURCES, baselineFor, stampAll, stampHtml } from "../scripts/updated-stamp.ts";
import { expandRenderPipeline } from "./helpers/workflow-text.mjs";
import { SITE } from "./helpers/site-root.mjs";

/**
 * 데이터 기준일(정적)과 "n일 전 자료"(보는 순간 계산)를 나눈 것을 묶는다 (#111).
 *
 * 날짜 의존 검사는 넣지 않는다(#8): 오늘 날짜는 전부 인자로 주입하고, 파일 시험은 고정 입력(임시 폴더)으로
 * 돈다. 저장소에 커밋된 docs/ 가 '생성물이 소스와 맞나'는 tools/health 가 비차단으로 보고(#507), 고정 소스로 찍은 출력은 test/fixture-site.test.mjs 가 본다.
 */

const root = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(root, SITE);

// 실제 틀과 같은 모양이다 (#282): 경고(#updated-warn)는 머리글, 기준일(#updated)은 바닥글.
// 옛 픽스처는 둘 다 머리글에 두어 '자리'를 박제하고 있었다 - 틀이 바뀌어도 아무 시험도 안 떨어졌다.
const SHELL = (inner) =>
  `<header><h1 id="page-title">제목</h1><div class="updated updated-warn" id="updated-warn" role="status" hidden></div></header>${inner}` +
  `<footer class="site-footer"><div class="updated" id="updated">불러오는 중...</div></footer>`;

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
    assert.match(r.updated.textContent, /^As of \d{4}-\d{2}-\d{2}$/, `${SITE}/${file}: 영어 화면에 '${r.updated.textContent}'`);
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
    assert.ok(!/id="updated"[^>]*>\s*불러오는 중/.test(html), `${SITE}/${f}: #updated에 '불러오는 중...'이 정적으로 남았다`);
  }
  // #282: #updated는 '기준일' 한 뜻만 진다. 데이터를 읽지 않는 세 장(NO_DATA_PAGES)의 제목 아래 한 줄은
  // 기준일이 아니라 꼬리표라 #tagline이고, 그래서 #updated를 가진 장 = PAGE_SOURCES의 장이다.
  const sourced = Object.keys(PAGE_SOURCES);
  assert.deepEqual(withUpdated.filter((f) => !sourced.includes(f)), [], "소스 표에 없는데 #updated가 있는 장 (PAGE_SOURCES에 넣거나 #tagline로 가를 것)");
  assert.deepEqual(sourced.filter((f) => !withUpdated.includes(f)), [], "표에는 있는데 #updated가 없는 장");
  // #577 B2: 금리 4장(기준일 있음)이 종료 안내 장(꼬리표)이 됐고 허브도 안내 장이다 - 기준일 64 -> 60, 꼬리표 3 -> 7.
  assert.equal(withUpdated.length, 60, "#updated(기준일)를 가진 장 수");
  assert.equal(withUpdated.length + NO_DATA_PAGES.length, files.length, "기준일 60 + 꼬리표 7 = 전체 67이어야 한다");
});

/** html에서 태그 하나의 안쪽을 잘라 돌려준다. 없으면 null. */
function inside(html, openRe, closeTag) {
  const m = openRe.exec(html);
  if (!m) return null;
  const end = html.indexOf(closeTag, m.index);
  return end < 0 ? null : html.slice(m.index, end);
}

/**
 * #282 되풀이 방지. 두 줄이 **제자리**에 있는지를 자리로 센다.
 *
 * 전에는 어느 시험도 자리를 안 봤다 - stampHtml의 정규식이 자리를 묻지 않아, 누가 틀을 고쳐 기준일을
 * 머리글로 되돌려도 1559개 중 아무것도 안 떨어졌다(cto 판정 6205647191 D절).
 *
 * 지키는 것은 셋이다.
 *   - 기준일(#updated)은 바닥글(.site-footer) 안에 있다 - 머리글을 24.4px 줄이려고 내린 것이다.
 *   - "n일 전 자료" 경고(#updated-warn)는 머리글 안에 있다 - 같이 내리면 낡은 자료 고지가 첫 화면에서
 *     사라진다(134조건 중 128 -> 1, po 6206109779 / cmo 6207405456).
 *   - 데이터를 읽지 않는 세 장은 기준일도 경고도 없고 꼬리표(#tagline)를 머리글에 가진다.
 */
test("저장소 docs: 기준일은 바닥글에, 낡은 자료 경고는 머리글에 있다 (#282)", async () => {
  const files = (await readdir(DOCS)).filter((f) => f.endsWith(".html")).sort();
  const bad = [];
  let dated = 0;
  let tagged = 0;
  for (const f of files) {
    const html = await readFile(path.join(DOCS, f), "utf8");
    const header = inside(html, /<header[\s>]/, "</header>");
    const footer = inside(html, /<footer class="site-footer"[\s>]/, "</footer>");
    if (!header) bad.push(`${f}: <header>가 없다`);
    if (NO_DATA_PAGES.includes(f)) {
      tagged += 1;
      if (html.includes('id="updated"')) bad.push(`${f}: 데이터를 읽지 않는 장인데 #updated가 있다`);
      if (html.includes('id="updated-warn"')) bad.push(`${f}: 데이터를 읽지 않는 장인데 #updated-warn이 있다`);
      if (!header?.includes('id="tagline"')) bad.push(`${f}: 꼬리표(#tagline)가 머리글에 없다`);
      continue;
    }
    dated += 1;
    if (!footer) bad.push(`${f}: <footer class="site-footer">가 없다`);
    else if (!footer.includes('id="updated"')) bad.push(`${f}: 기준일(#updated)이 바닥글에 없다`);
    if (header && !header.includes('id="updated-warn"')) bad.push(`${f}: 경고(#updated-warn)가 머리글에 없다`);
    if (header?.includes('id="updated"')) bad.push(`${f}: 기준일(#updated)이 머리글에 남아 있다`);
    if (footer?.includes('id="updated-warn"')) bad.push(`${f}: 경고(#updated-warn)가 바닥글로 내려갔다`);
    if ((html.match(/id="updated"/g) ?? []).length !== 1) bad.push(`${f}: #updated가 한 개가 아니다`);
    if ((html.match(/id="updated-warn"/g) ?? []).length !== 1) bad.push(`${f}: #updated-warn이 한 개가 아니다`);
  }
  assert.deepEqual(bad, [], bad.join(" | "));
  assert.equal(dated, 60, "기준일을 가진 장 수");
  assert.equal(tagged, 7, "꼬리표만 가진 장 수");
  assert.equal(dated + tagged, files.length, "60 + 7 = 67");
});

/** 기준일 줄을 다시 찍어도 경고 줄이 늘어나지 않는다 - 옛 정규식은 경고까지 삼켜 다시 뱉었다(#282). */
test("stampHtml은 떨어져 있는 경고 줄을 복제하지 않는다 (#282)", () => {
  const html = SHELL("<main>본문</main>");
  const once = stampHtml(html, "2026-10-16");
  const twice = stampHtml(once, "2026-10-17");
  for (const [label, out] of [["1회", once], ["2회", twice]]) {
    assert.equal((out.match(/id="updated-warn"/g) ?? []).length, 1, `${label}: 경고 줄이 하나여야 한다`);
    assert.equal((out.match(/id="updated"/g) ?? []).length, 1, `${label}: 기준일 줄이 하나여야 한다`);
    assert.ok(inside(out, /<header[\s>]/, "</header>").includes('id="updated-warn"'), `${label}: 경고는 머리글에 남아야 한다`);
    assert.ok(inside(out, /<footer class="site-footer"[\s>]/, "</footer>").includes('id="updated"'), `${label}: 기준일은 바닥글에 있어야 한다`);
  }
  assert.match(twice, /data-updated="2026-10-17">기준일 2026-10-17</);
});

// (#507) "저장소 docs: 찍힌 기준일이 그 장 소스의 가장 오래된 updatedAt과 같다 (오늘과 비교하지 않는다)" 는 커밋된 데이터와 커밋된 생성물을 맞대는 검사라 tools/health/test/updated-stamp.test.mjs 로 옮겼다(비차단). 같은 단언의 고정 데이터 짝은 test/fixture-site.test.mjs 에 있다.

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

test("스탬프 빌더가 렌더 파이프라인(deploy.yml)에, 모든 페이지 빌더 뒤에 있다", async () => {
  // (#510) update-all·daily-update 에서 렌더가 빠졌다 - 렌더는 deploy.yml 의 render-pipeline 한 줄(기본 여섯 단계)이다. 수집 쪽에는 스탬프 빌더가 없어야 한다.
  const [all, daily, wf] = await Promise.all([readFile(path.join(root, "scripts/update-all.mjs"), "utf8"), readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8"), readFile(path.join(root, ".github/workflows/deploy.yml"), "utf8")]);
  assert.ok(!all.includes("build-updated-stamp") && !daily.replace(/^\s*#.*$/gm, "").includes("build-updated-stamp"), "수집 쪽(update-all·daily-update)이 스탬프 빌더를 부른다 - docs/ 에 생성 HTML 이 생긴다");
  for (const [name, text] of [["deploy.yml", expandRenderPipeline(wf)]]) {
    const order = [...text.matchAll(/node scripts\/([a-z-]+\.(?:mjs|ts))/g)].map((m) => m[1]);
    const stamp = order.indexOf("build-updated-stamp.ts");
    assert.ok(stamp >= 0, `${name}이 build-updated-stamp.ts를 부르지 않는다`);
    assert.ok(stamp > order.indexOf("build-realestate-pages.ts"), `${name}: 페이지 빌더가 다시 쓰기 전에 찍으면 날짜가 덮인다`);
  }
});
