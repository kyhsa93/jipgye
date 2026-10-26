// AI 요약 상자의 검증 폴백 줄과 요약 아래 근거 기사(#745 PR6, 옛 상자 끝 안내 줄 #350 을 대신한다).
// 폴백 분야(summary.json 의 categories[].fallbackReason)는 헤드라인 목록을 요약처럼 싣지 않고 「요약 검증 실패: 제목만 표시(이유)」를 낸다.
// 구운 쪽(entry.jsx newsSummary)과 화면 스크립트(뉴스 틀 renderSummary)가 같은 글자를 내는지, 근거 기사(제목·언론사·발행일·원문 링크)가 구워지는지 본다.
// 이 파일의 시험은 데이터 값에 좌우되지 않는다: 고정 fixture 로 구운 결과를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES, buildNewsPage } from "../scripts/build-news-pages.ts";
import { newsSummaryHtml } from "../scripts/prerender.ts";
import { FAILED_KO, REASONS_KO, failedLineKo, kstDate, sourcesMarkup } from "../scripts/summary-note.ts";
import { loadNewsPage } from "./helpers/news-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

const items = (key) => [
  { title: `${key} 기사 & "따옴표"`, link: `https://e.com/${key}?a=1&b=2`, source: "연합뉴스 경제" },
  { title: `${key} 둘째`, link: `https://e.com/${key}/2`, source: "뉴시스 경제" },
];
const cat = (key, extra = {}) => ({ key, name: key, nameEn: key, lineKo: `${key} 줄`, lineEn: `${key} line`, fallbackReason: null, items: items(key), ...extra });
const WITH = { updatedAt: "2026-10-17T00:00:00Z", model: "stub", highlights: [], categories: [cat("realestate"), cat("rates"), cat("stocks", { fallbackReason: "unverified-entity", lineKo: "증시·환율: 제목1, 제목2" }), cat("other")] };
const NEWS = { updatedAt: "2026-10-17T00:00:00Z", items: [{ title: "x", link: "https://e.com/stocks?a=1&b=2", publishedAt: "2026-10-16T16:30:00.000Z", source: "연합뉴스 경제", category: "stocks" }] };

const boxOf = (html, marker) => {
  const open = `<!--prerender:${marker}-->`;
  const a = html.indexOf(open);
  const b = html.indexOf(`<!--/prerender:${marker}-->`);
  assert.ok(a > 0 && b > a, `${marker} 자리표시를 찾지 못했다`);
  return html.slice(a + open.length, b);
};

test("폴백 줄의 한국어 글자는 뉴스 틀 문자열 표(T.ko.failed·reasons)와 글자까지 같고, 옛 안내 줄은 없다 (#745 PR6)", async () => {
  const news = await read("docs/news.html");
  assert.ok(news.includes(`failed: "${FAILED_KO}",`), "뉴스 틀의 failed 문구가 summary-note.ts 와 다르다");
  for (const [code, label] of Object.entries(REASONS_KO)) assert.ok(news.includes(`"${code}": "${label}"`), `뉴스 틀 reasons 에 ${code} → ${label} 이 없다`);
  assert.ok(!news.includes("fallbackNote"), "옛 상자 끝 안내 줄(fallbackNote)이 남아 있다");
  assert.equal(failedLineKo("unverified-number"), "요약 검증 실패: 제목만 표시(원문에 없는 숫자)");
  assert.equal(failedLineKo("새-코드"), "요약 검증 실패: 제목만 표시(새-코드)");
});

test("구운 요약: 폴백 분야는 헤드라인 목록 대신 실패 줄, 아래 근거 기사는 펼친 채 - 다른 분야는 접힌 채 (#745 PR6)", async () => {
  const [baseHtml, market] = await Promise.all([read("docs/news.html"), readJson("market")]);
  for (const page of NEWS_PAGES) {
    const html = buildNewsPage(baseHtml, page, { news: NEWS, summary: WITH, market });
    const box = boxOf(html, "newsSummary");
    const src = boxOf(html, "newsSources");
    assert.ok(!box.includes("제목1, 제목2"), `${page.file}: 검증 실패한 헤드라인 목록이 요약처럼 구워졌다`);
    assert.equal(box.includes(failedLineKo("unverified-entity")), page.category === "stocks", `${page.file}: 실패 줄 유무`);
    assert.equal((src.match(/<details /g) ?? []).length, 1, `${page.file}: 분야 장의 근거 묶음은 하나`);
    assert.equal(src.includes('<details class="summary-src" open>'), page.category === "stocks", `${page.file}: 폴백 분야만 펼친다`);
  }
  const src = sourcesMarkup(WITH, null, NEWS);
  assert.equal((src.match(/<details /g) ?? []).length, 4);
  // 제목·원문 링크(새 탭)·언론사·발행일(한국 시각 날짜). 16:30Z 는 한국 시각 다음 날 01:30.
  assert.ok(src.includes('<li><a href="https://e.com/stocks?a=1&amp;b=2" target="_blank" rel="noopener">stocks 기사 &amp; &quot;따옴표&quot;</a> <span class="news-meta">연합뉴스 경제 · 2026-10-17</span></li>'), src.slice(0, 400));
  assert.ok(src.includes('<span class="news-meta">뉴시스 경제</span>'), "발행일을 못 찾은 기사는 언론사만");
  assert.ok(src.includes('<span class="m-ko">stocks 근거 기사 2건</span><span class="m-en">stocks: 2 source articles</span>'));
  assert.equal(sourcesMarkup({ categories: [cat("a", { items: [] }), cat("b", { items: null })] }), "");
  assert.equal(kstDate("엉터리"), "");
  assert.equal(kstDate(undefined), "");
});

test("화면 스크립트도 같은 실패 줄을 그리고(한국어는 구운 것과 글자까지 같다), 영어는 영어 문구다 (#745 PR6)", async () => {
  const baked = newsSummaryHtml(WITH, "stocks");
  const ko = await loadNewsPage({ news: NEWS, summary: WITH, category: "stocks" });
  assert.equal(ko.byId("summary-box").innerHTML, baked);
  const en = await loadNewsPage({ news: NEWS, summary: WITH, category: "stocks", locale: "en" });
  assert.equal(en.byId("summary-box").innerHTML, "<p><strong>stocks</strong> Unverified: headlines only(unverified-entity)</p>");
  // 지난 기록(?date=)에서는 오늘 구운 근거 기사를 가린다.
  assert.equal(ko.byId("summary-src").hidden, false);
  const past = await loadNewsPage({ news: NEWS, summary: WITH, category: "stocks", search: "?date=2026-10-01", history: { news: [], summary: [] } });
  assert.equal(past.byId("summary-src").hidden, true);
});

// (#507) 커밋된 데이터(docs/data/summary.json)로 찍은 장의 실패 줄 유무를 맞대는 검사는 데이터 하나로 결과가 갈려 tools/health/test/summary-note.test.mjs 로 옮겼다(비차단).
// 같은 단언의 고정 데이터 짝은 test/fixture-site.test.mjs 에 있다.
