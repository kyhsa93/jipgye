// 나가는 사이트의 집계 전용 사이트맵 (#769, 배포 게이트). build/site/sitemap.xml 이 그 디렉터리의 장들과 맞는지만 본다 - 오늘 데이터 값이나 날짜에 기대는 단언은 없다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { SITE_DIR, sitePath } from "./helpers/site-root.mjs";
import { RATE_NOTICE_PAGES } from "../scripts/updated-stamp.ts";
import { SITEMAP_FILE, canonicalOf, isNoindex, lastmodOf } from "../scripts/sitemap.ts";
import { DEFAULT_BASE, locsOf } from "../scripts/deploy-check.ts";

const xml = readFileSync(sitePath(SITEMAP_FILE), "utf8");
const locs = locsOf(xml);
const htmls = readdirSync(SITE_DIR).filter((f) => f.endsWith(".html")).sort();
const read = (f) => readFileSync(path.join(SITE_DIR, f), "utf8");
/** 파일 -> 그 장의 정규 URL(index.html 은 루트). */
const urlOf = (f) => (f === "index.html" ? DEFAULT_BASE : `${DEFAULT_BASE}${f}`);

test("sitemap.xml 은 유효한 XML 이고 urlset 하나이며 changefreq·priority 가 없다", () => {
  assert.equal(XMLValidator.validate(xml), true);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(xml, /<sitemapindex|changefreq|priority/);
  assert.equal(new Set(locs).size, locs.length, "loc 이 겹친다");
});

test("사이트맵 URL 집합 = noindex 가 아닌 렌더 HTML 집합 (금리 종료 안내·noindex 장 없음, 새 장 없음)", () => {
  const indexable = htmls.filter((f) => !isNoindex(read(f)));
  assert.ok(indexable.length > 0 && indexable.length < htmls.length, "noindex 장이 하나도 없거나 색인 장이 없다");
  assert.deepEqual(locs, indexable.map(urlOf), "사이트맵 loc 이 색인 대상 장 집합과 다르다");
  for (const f of RATE_NOTICE_PAGES) assert.ok(!locs.includes(urlOf(f)), `${f}: 금리 종료 안내 장이 사이트맵에 있다`);
  for (const f of htmls.filter((f) => isNoindex(read(f)))) assert.ok(!locs.includes(urlOf(f)), `${f}: noindex 장이 사이트맵에 있다`);
});

test("각 loc 은 https://kyhsa93.github.io/jipgye/ 아래이고 그 장의 canonical 과 같다", () => {
  for (const loc of locs) {
    assert.ok(loc.startsWith(DEFAULT_BASE), `base 밖 loc: ${loc}`);
    const file = loc === DEFAULT_BASE ? "index.html" : loc.slice(DEFAULT_BASE.length);
    assert.equal(canonicalOf(read(file)), loc, `${file}: canonical 과 loc 이 다르다`);
  }
});

test("lastmod 는 그 장에 찍힌 데이터 기준일과 같고, 기준일이 없는 장(소개·방법)에는 없다 - 배포일 일괄 기입이 아니다", () => {
  const entries = [...xml.matchAll(/<url>\s*<loc>([^<]*)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>\s*)?<\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] ?? null }));
  assert.equal(entries.length, locs.length, "<url> 마다 loc 하나, lastmod 는 있거나 없거나다");
  for (const { loc, lastmod } of entries) {
    const file = loc === DEFAULT_BASE ? "index.html" : loc.slice(DEFAULT_BASE.length);
    assert.equal(lastmod, lastmodOf(read(file)), `${file}: lastmod 가 장의 기준일과 다르다`);
    if (lastmod) assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(entries.find((e) => e.loc === `${DEFAULT_BASE}about.html`)?.lastmod, null, "소개 장은 데이터를 읽지 않아 lastmod 가 없어야 한다");
  assert.equal(entries.find((e) => e.loc === `${DEFAULT_BASE}method.html`)?.lastmod, null, "방법 장은 데이터를 읽지 않아 lastmod 가 없어야 한다");
  assert.ok(entries.some((e) => e.lastmod), "데이터 장의 lastmod 가 하나도 없다");
});
