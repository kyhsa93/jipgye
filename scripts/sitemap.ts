// 집계 전용 사이트맵 (#769). 렌더 출력 디렉터리(build/site)에 sitemap.xml 을 만든다 - 커밋 파일이 아니라 산출물이다.
//
// 왜 따로 만드나: 호스트 루트 /sitemap.xml 은 블로그 저장소 소유이고, Search Console 의 그 항목은 "마지막 읽음 2023-12-15 · 29페이지 · 오류 1"에
// 몇 달째 고착돼 있다(2026-10-27 API 읽기). 집계 URL 5곳이 전부 "Google에 알려지지 않음"이라 별도 경로(/jipgye/sitemap.xml)의 사이트맵을 낸다.
// 루트 sitemap·robots.txt 는 건드리지 않는다(블로그 저장소 소유).
//
// 규칙 (이슈 #769 「무엇을」1):
//  - 대상: 출력 디렉터리 최상위의 *.html 중 `<meta name="robots" content="noindex…">` 가 없는 장. 404·비페이지는 없다(이 사이트는 최상위 HTML 이 전부 장이다).
//  - <loc> 은 그 장의 canonical 그대로다 - 장이 canonical 을 안 들고 있으면 던진다(조용히 빠지면 "사이트맵에 없어서 검색에 없음"을 아무도 못 본다, test/indexable-pages 의 교훈).
//    모두 https://kyhsa93.github.io/jipgye/ 아래인지는 시험(test/sitemap-site.test.mjs)과 deploy-check 가 본다.
//  - <lastmod> 은 사실일 때만: 장에 찍힌 데이터 기준일(build-updated-stamp 가 찍는 `id="updated" data-updated="YYYY-MM-DD"`)이다. 기준일이 없는 장(소개·방법)은 생략한다.
//    배포일 일괄 기입은 하지 않는다 - BUILD_NOW 와 무관하게 같은 입력이면 같은 바이트여야 한다(결정성).
//  - changefreq·priority 는 쓰지 않는다(구글이 무시한다고 밝힌 값이라 거짓 신호만 된다).
//  - 순서는 파일 이름순 - readdir 순서는 파일시스템마다 달라 그대로 쓰면 비결정적이다.
//
// 출력 디렉터리가 docs/ 자체면(render-pipeline 을 --out 없이 제자리로 돌린 경우) 만들지 않는다 - docs/ 는 손으로 고치는 소스라 산출물을 두지 않는다(stripPageScripts 와 같은 선, #784).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOCS_DIR } from "./site-dir.ts";

export const SITEMAP_FILE = "sitemap.xml";

/** HTML에서 <link rel="canonical"> 의 href. 없으면 null. deploy-check 가 배포본 대조에 같은 함수를 쓴다 - 만드는 쪽과 점검하는 쪽이 같은 눈이다. */
export function canonicalOf(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel=["']?canonical["']?/i.test(tag)) return tag.match(/\bhref=["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}

/** robots 메타에 noindex 가 있는 HTML 인가. */
export const isNoindex = (html: string): boolean => (html.match(/<meta\b[^>]*>/gi) ?? []).some((t) => /\bname=["']?robots["']?/i.test(t) && /noindex/i.test(t));

/** 장에 찍힌 데이터 기준일(YYYY-MM-DD). 기준일 줄이 없는 장(NO_DATA_PAGES)은 null. */
export const lastmodOf = (html: string): string | null => html.match(/<div class="updated" id="updated" data-updated="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? null;

export type SitemapEntry = { file: string; loc: string; lastmod: string | null };

const diskIo = { read: (file: string) => readFileSync(file, "utf8"), write: (file: string, text: string) => writeFileSync(file, text) };

/** 출력 디렉터리의 색인 대상 장 목록(파일 이름순). read 를 주면 쓰기 묶음에 올라간 최신 내용을 읽을 수 있다. */
export function sitemapEntries({ siteRoot, read = diskIo.read }: { siteRoot: string; read?: (file: string) => string }): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const file of readdirSync(siteRoot).filter((f) => f.endsWith(".html")).sort()) {
    const html = read(path.join(siteRoot, file));
    if (isNoindex(html)) continue;
    const loc = canonicalOf(html);
    if (!loc) throw new Error(`${file}: canonical 이 없어 사이트맵 <loc> 을 정할 수 없다`);
    out.push({ file, loc, lastmod: lastmodOf(html) });
  }
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** 항목 -> sitemap.xml 글자. 같은 항목이면 같은 바이트다. */
export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(({ loc, lastmod }) => `  <url>\n    <loc>${escapeXml(loc)}</loc>\n${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ""}  </url>\n`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("")}</urlset>\n`;
}

/** 출력 디렉터리에 sitemap.xml 을 올린다(io.write 는 쓰기 묶음). 돌려주는 값은 loc 수. docs/ 자체면 0 이고 아무것도 안 쓴다. */
export function writeSitemap({ siteRoot, io = diskIo }: { siteRoot: string; io?: typeof diskIo }): number {
  if (path.resolve(siteRoot) === DOCS_DIR) return 0;
  const entries = sitemapEntries({ siteRoot, read: io.read });
  io.write(path.join(siteRoot, SITEMAP_FILE), sitemapXml(entries));
  return entries.length;
}
