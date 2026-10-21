// 검증 폴백 안내 줄은 구운 HTML 이 싣는다 (#350). 안 싣던 때는 요약 JSON 이 오는 순간 화면 스크립트가 줄을 붙여
// #summary-box 아래 구획이 한 줄(28.7px, 375폭)만큼 밀렸다 - 폴백이 있는 날에만(summary.json 의 categories[].fallbackReason).
// 이 파일의 시험은 데이터 값에 좌우되지 않는다: 고정 fixture 로 구운 결과를 보고, 저장소 docs/ 는 "원본·데이터로 다시 찍은 것과 같은가"만 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES, buildNewsPage } from "../scripts/build-news-pages.ts";
import { applyPrerender, newsSummaryHtml, summaryHtml } from "../scripts/prerender.mjs";
import { FALLBACK_NOTE_KO, hasFallback } from "../scripts/summary-note.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

const cat = (key, extra = {}) => ({ key, name: key, nameEn: key, lineKo: `${key} 줄`, lineEn: `${key} line`, fallbackReason: null, ...extra });
const WITH = { updatedAt: "2026-10-17T00:00:00Z", model: "stub", highlights: [], categories: [cat("realestate"), cat("rates"), cat("stocks", { fallbackReason: "unverified-entity" }), cat("other")] };
const WITHOUT = { ...WITH, categories: WITH.categories.map((c) => ({ ...c, fallbackReason: null })) };

/** 구운 HTML 에서 #summary-box 안쪽(자리표시 주석 사이)만 꺼낸다. */
const boxOf = (html, marker) => {
  const open = `<!--prerender:${marker}-->`;
  const a = html.indexOf(open);
  const b = html.indexOf(`<!--/prerender:${marker}-->`);
  assert.ok(a > 0 && b > a, `${marker} 자리표시를 찾지 못했다`);
  return html.slice(a + open.length, b);
};

test("안내 줄의 한국어 글자는 두 틀(뉴스 틀 fallbackNote · index.html summaryFallbackNote)의 한국어 표와 글자까지 같다 (#350)", async () => {
  const [news, index] = await Promise.all([read("docs/news.html"), read("docs/index.html")]);
  // 표는 한국어(ko) 다음 영어(en) 순서다 - 첫 번째가 한국어.
  const ko = (html, key) => html.match(new RegExp(`${key}: "([^"]+)"`))?.[1];
  assert.equal(ko(news, "fallbackNote"), FALLBACK_NOTE_KO, "뉴스 틀의 한국어 안내 문구가 구운 문구와 다르다");
  assert.equal(ko(index, "summaryFallbackNote"), FALLBACK_NOTE_KO, "index.html 의 한국어 안내 문구가 구운 문구와 다르다");
  // 마크업(class)도 화면 스크립트와 같아야 한다 - 스타일이 class 로 붙는다.
  assert.ok(news.includes('<div class="summary-note">${escapeHtml(t("fallbackNote"))}</div>'), "뉴스 틀 renderSummary 의 안내 마크업이 바뀌었다");
  assert.ok(index.includes('<div class="summary-fallback-note">${t("summaryFallbackNote")}</div>'), "index.html renderSummary 의 안내 마크업이 바뀌었다");
});

test("폴백이 있는 날 뉴스 장의 구운 #summary-box 에 안내 줄이 있고, 없는 날엔 없다 (#350)", async () => {
  const [baseHtml, news, market] = await Promise.all([read("docs/news.html"), readJson("news"), readJson("market")]);
  const note = `<div class="summary-note">${FALLBACK_NOTE_KO}</div>`;

  for (const page of NEWS_PAGES) {
    const withNote = boxOf(buildNewsPage(baseHtml, page, { news, summary: WITH, market }), "newsSummary");
    const without = boxOf(buildNewsPage(baseHtml, page, { news, summary: WITHOUT, market }), "newsSummary");
    // 증시 장만 폴백 분류를 보여 준다. 다른 분야 장은 자기 분야에 폴백이 없으니 줄이 없어야 한다(shown.some).
    assert.equal(withNote.includes(note), page.category === "stocks", `${page.file}: 폴백 있는 날의 안내 줄이 기대와 다르다`);
    assert.ok(!without.includes("summary-note"), `${page.file}: 폴백 없는 날에 안내 줄이 구워졌다`);
    if (page.category === "stocks") assert.ok(withNote.endsWith(note), "안내 줄은 분류 줄 뒤(상자 끝)에 있어야 한다 - 화면 스크립트와 같은 자리");
  }
  // 분야 필터 없는 허브(news.html)는 보이는 분류 전부를 보므로 하나라도 폴백이면 줄이 있다.
  assert.ok(newsSummaryHtml(WITH).endsWith(note));
  assert.ok(!newsSummaryHtml(WITHOUT).includes("summary-note"));
});

test("폴백이 있는 날 index.html 의 구운 #summary-box 에 안내 줄이 있고, 없는 날엔 없다 (#350)", async () => {
  const base = await read("docs/index.html");
  const note = `<div class="summary-fallback-note">${FALLBACK_NOTE_KO}</div>`;
  const withNote = boxOf(applyPrerender(base, { summary: summaryHtml(WITH) }), "summary");
  const without = boxOf(applyPrerender(base, { summary: summaryHtml(WITHOUT) }), "summary");
  // 안내 줄은 분류 줄 뒤, `.summary-meta`(#352) 앞이다 - 화면 스크립트가 안내를 붙인 뒤 meta 를 붙이는 순서.
  assert.ok(withNote.includes(`${note}<span class="summary-meta">`) && withNote.endsWith("</span>"), "index 의 안내 줄이 분류 줄 뒤·.summary-meta 앞에 없다");
  assert.ok(!without.includes("fallback-note"), "폴백 없는 날에 안내 줄이 구워졌다");
});

test("hasFallback 은 화면 스크립트와 같은 truthy 검사다 (#350)", () => {
  assert.equal(hasFallback([cat("a"), cat("b", { fallbackReason: "x" })]), true);
  for (const falsy of [null, undefined, "", 0, false]) assert.equal(hasFallback([cat("a", { fallbackReason: falsy })]), false);
  assert.equal(hasFallback(null), false);
  assert.equal(hasFallback([]), false);
});

test("커밋된 구운 장 다섯의 안내 줄 유무가 summary.json 과 맞는다 - 데이터가 바뀌면 다시 구워야 한다 (#350)", async () => {
  const summary = await readJson("summary");
  const noteOf = (html, cls) => html.includes(`<div class="${cls}">${FALLBACK_NOTE_KO}</div>`);

  const index = boxOf(await read("docs/index.html"), "summary");
  assert.equal(noteOf(index, "summary-fallback-note"), hasFallback(summary.categories), "docs/index.html 의 안내 줄이 summary.json 과 어긋난다. node scripts/prerender.mjs 를 실행하세요.");

  const hub = boxOf(await read("docs/news.html"), "newsSummary");
  assert.equal(noteOf(hub, "summary-note"), hasFallback(summary.categories.filter((c) => c.lineKo)), "docs/news.html 의 안내 줄이 summary.json 과 어긋난다.");
  for (const page of NEWS_PAGES) {
    const box = boxOf(await read(`docs/${page.file}`), "newsSummary");
    const shown = summary.categories.filter((c) => c.key === page.category && c.lineKo);
    assert.equal(noteOf(box, "summary-note"), hasFallback(shown), `docs/${page.file} 의 안내 줄이 summary.json 과 어긋난다. node scripts/build-news-pages.ts 를 실행하세요.`);
  }
});

// legacy 쌍둥이(React 렌더가 실패할 때만 도는 자동 폴백, render-pipeline.ts)의 class 는 기본 모드의 다른 시험이 하나도 못 본다:
// render-parity 의 sameHtml 이 class 를 지우고 비교해(#277) 래퍼 출력(react)과 legacy 가 class 만 달라도 통과하기 때문이다(#355).
// 아래 둘은 래퍼를 거치지 않고 .legacy 원본을 직접 불러 JIPGYE_RENDERER 와 무관하게 legacy 마크업을 본다. #248 이 legacy 를 지우는 날 같이 지운다.
test("legacy 뉴스 조각(newsSummaryHtml.legacy)의 안내 줄 class 는 summary-note 다 - 기본 모드에서도 잡는다 (#355)", () => {
  const note = `<div class="summary-note">${FALLBACK_NOTE_KO}</div>`;
  assert.equal(typeof newsSummaryHtml.legacy, "function", "래퍼에 legacy 원본이 없다");
  assert.ok(newsSummaryHtml.legacy(WITH).endsWith(note), "legacy 뉴스 조각의 안내 줄이 summary-note 로 상자 끝에 있지 않다");
  assert.ok(!newsSummaryHtml.legacy(WITHOUT).includes("summary-note"), "폴백 없는 날에 legacy 가 안내 줄을 구웠다");
});

test("legacy index 조각(summaryHtml.legacy)의 안내 줄 class 는 summary-fallback-note 다 - 기본 모드에서도 잡는다 (#355)", () => {
  const note = `<div class="summary-fallback-note">${FALLBACK_NOTE_KO}</div>`;
  assert.equal(typeof summaryHtml.legacy, "function", "래퍼에 legacy 원본이 없다");
  assert.ok(summaryHtml.legacy(WITH).includes(`${note}<span class="summary-meta">`), "legacy index 조각의 안내 줄이 summary-fallback-note 로 분류 줄 뒤(.summary-meta 앞)에 있지 않다");
  assert.ok(!summaryHtml.legacy(WITHOUT).includes("fallback-note"), "폴백 없는 날에 legacy 가 안내 줄을 구웠다");
});
