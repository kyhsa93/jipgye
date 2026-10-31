// 집계 전용 사이트맵 (#769) - 만드는 쪽의 규칙을 임시 폴더의 합성 장으로 본다. 저장소의 docs/data·오늘 날짜·build/site 를 읽지 않는다(#8).
// 나가는 사이트(build/site)의 sitemap.xml 이 그 장들과 맞는지는 test/sitemap-site.test.mjs(배포 게이트)가 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { DOCS_DIR } from "../scripts/site-dir.ts";
import { SITEMAP_FILE, canonicalOf, isNoindex, lastmodOf, sitemapEntries, sitemapXml, writeSitemap } from "../scripts/sitemap.ts";

const BASE = "https://example.test/site/";
const page = ({ canonical, noindex = false, updated = null }) =>
  `<!doctype html><html><head>${noindex ? '<meta name="robots" content="noindex, follow">' : ""}${canonical ? `<link rel="canonical" href="${canonical}">` : ""}</head><body>${
    updated ? `<div class="updated" id="updated" data-updated="${updated}">기준일 ${updated}</div>` : "<p>꼬리표</p>"
  }</body></html>`;

const made = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "sitemap-"));
  made.push(d);
  return d;
};
test.after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function fixture(files) {
  const root = tmp();
  for (const [name, html] of Object.entries(files)) writeFileSync(path.join(root, name), html);
  return root;
}

test("조각 함수: canonical·noindex·기준일 읽기", () => {
  const html = page({ canonical: `${BASE}a.html`, updated: "2026-10-23" });
  assert.equal(canonicalOf(html), `${BASE}a.html`);
  assert.equal(canonicalOf("<p>없음</p>"), null);
  assert.equal(isNoindex(page({ canonical: BASE, noindex: true })), true);
  assert.equal(isNoindex(html), false);
  assert.equal(lastmodOf(html), "2026-10-23");
  assert.equal(lastmodOf(page({ canonical: BASE })), null, "기준일 줄이 없는 장은 lastmod 가 없다");
});

test("noindex 가 아닌 장만, 파일 이름순으로, loc 은 canonical 그대로이고 lastmod 는 찍힌 기준일일 때만 있다", () => {
  const root = fixture({
    "z-last.html": page({ canonical: `${BASE}z-last.html`, updated: "2026-10-22" }),
    "index.html": page({ canonical: BASE, updated: "2026-10-23" }),
    "about.html": page({ canonical: `${BASE}about.html` }),
    "news.html": page({ canonical: `${BASE}news.html`, noindex: true, updated: "2026-10-23" }),
    "data.json": "{}",
  });
  const entries = sitemapEntries({ siteRoot: root });
  assert.deepEqual(entries, [
    { file: "about.html", loc: `${BASE}about.html`, lastmod: null },
    { file: "index.html", loc: BASE, lastmod: "2026-10-23" },
    { file: "z-last.html", loc: `${BASE}z-last.html`, lastmod: "2026-10-22" },
  ]);
  const xml = sitemapXml(entries);
  assert.equal(XMLValidator.validate(xml), true, "XML 이 유효하지 않다");
  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url>\n    <loc>${BASE}about.html</loc>\n  </url>\n` +
      `  <url>\n    <loc>${BASE}</loc>\n    <lastmod>2026-10-23</lastmod>\n  </url>\n` +
      `  <url>\n    <loc>${BASE}z-last.html</loc>\n    <lastmod>2026-10-22</lastmod>\n  </url>\n` +
      `</urlset>\n`,
  );
  assert.doesNotMatch(xml, /changefreq|priority/, "changefreq·priority 는 쓰지 않는다(#769)");
  // 같은 입력이면 같은 바이트 - 배포일·시계를 읽지 않는다.
  assert.equal(sitemapXml(sitemapEntries({ siteRoot: root })), xml);
});

test("canonical 이 없는 색인 장은 조용히 빠지지 않고 던진다", () => {
  const root = fixture({ "a.html": page({ canonical: null }) });
  assert.throws(() => sitemapEntries({ siteRoot: root }), /a\.html: canonical/);
  // noindex 장은 canonical 이 없어도 대상이 아니라 던지지 않는다.
  const root2 = fixture({ "n.html": page({ canonical: null, noindex: true }) });
  assert.deepEqual(sitemapEntries({ siteRoot: root2 }), []);
});

test("loc 의 & 같은 글자는 XML 로 이스케이프한다", () => {
  assert.match(sitemapXml([{ file: "q.html", loc: `${BASE}q.html?a=1&b=2`, lastmod: null }]), /<loc>https:\/\/example\.test\/site\/q\.html\?a=1&amp;b=2<\/loc>/);
});

test("writeSitemap: 출력 디렉터리에 sitemap.xml 을 올리고(쓰기 묶음의 최신 내용을 읽는다) loc 수를 돌려준다 - docs/ 자체면 아무것도 안 쓴다", () => {
  const root = fixture({ "a.html": page({ canonical: `${BASE}a.html`, updated: "2026-10-01" }), "b.html": page({ canonical: `${BASE}b.html`, noindex: true }) });
  const written = new Map();
  // 쓰기 묶음(#237)처럼 아직 디스크에 없는 최신 내용을 읽기로 준다 - 기준일 찍기가 올린 장을 그대로 본다.
  const staged = { [path.join(root, "a.html")]: page({ canonical: `${BASE}a.html`, updated: "2026-10-23" }) };
  const io = { read: (f) => staged[f] ?? readFileSync(f, "utf8"), write: (f, t) => written.set(f, t) };
  assert.equal(writeSitemap({ siteRoot: root, io }), 1);
  assert.deepEqual([...written.keys()], [path.join(root, SITEMAP_FILE)]);
  assert.match(written.get(path.join(root, SITEMAP_FILE)), /<lastmod>2026-10-23<\/lastmod>/, "쓰기 묶음에 올라간 최신 기준일을 읽지 않았다");

  // 기본 io 는 디스크다.
  assert.equal(writeSitemap({ siteRoot: root }), 1);
  assert.ok(existsSync(path.join(root, SITEMAP_FILE)));

  // docs/ 자체(render-pipeline 을 --out 없이 돌린 경우)에는 산출물을 두지 않는다.
  const calls = [];
  assert.equal(writeSitemap({ siteRoot: DOCS_DIR, io: { read: () => { throw new Error("읽지 않는다"); }, write: (f) => calls.push(f) } }), 0);
  assert.deepEqual(calls, []);
  assert.equal(existsSync(path.join(DOCS_DIR, SITEMAP_FILE)), false, "docs/sitemap.xml 이 생겼다 - 커밋 파일이 아니라 렌더 산출물이어야 한다(#769)");
});
