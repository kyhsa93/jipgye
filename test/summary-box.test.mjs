// index.html 구운 #summary-box 의 마크업이 화면 스크립트(renderSummary)가 JSON 을 받아 다시 그리는 모양과 같다 (#352).
// 구운 상자가 `<p><strong>분류</strong> 줄</p>` 목록이던 때는 요약 JSON 이 오는 순간 스크립트가 상자를 분류 라벨 div + 줄 div + `.summary-meta` 로 갈아 끼워
// 상자 높이가 바뀌고 아래 #news-section 이 밀렸다. 게다가 상자 틀에 placeholder class(점선 테두리·안쪽 여백 16px)가 붙은 채 구워져, 스크립트가 그 class 를 떼는 순간 폭도 달라졌다.
// 이 파일의 시험은 데이터 값에 좌우되지 않는다: 고정 fixture 를 실제 index.html 스크립트(test/helpers/index-page.mjs)에 먹여 나온 상자와
// 구운 조각(summaryHtml)을 글자까지 맞댄다. 저장소 docs/ 가 "원본·데이터로 다시 찍은 것과 같은가"는 tools/health 가 비차단으로 보고(#507), 고정 데이터로 찍은 출력은 test/fixture-site.test.mjs 가 본다.
//
// 주의: test/render-parity.test.mjs 의 sameHtml 은 class 를 지우고 비교한다(#277). 그래서 여기서는 래퍼(React) 출력을
// **정규화 없이** 문자열로 맞댄다(#355 와 같은 이유: class 가 스크립트와 같아야 스타일이 붙는다).
import test from "node:test";
import assert from "node:assert/strict";
import { summaryHtml } from "../scripts/prerender.ts";

const cat = (key, name, extra = {}) => ({ key, name, nameEn: key, lineKo: `${name} 한 줄`, lineEn: `${key} line`, fallbackReason: null, ...extra });
const highlight = (n, extra = {}) => ({ title: `핵심 ${n}`, link: `https://e.com/${n}`, source: `출처${n}`, textKo: `핵심 ${n} 본문`, textEn: `top ${n}`, ...extra });
const BASE = { updatedAt: "2026-10-18T03:05:38.770Z", model: "qwen3:14b", summary: { ko: "- 부동산: 요약", en: "- Real Estate: summary" } };
const CASES = {
  "하이라이트 없음 · 폴백 없음": { ...BASE, highlights: [], categories: [cat("realestate", "부동산"), cat("other", "기타 경제 소식"), cat("stocks", "증시·환율"), cat("rates", "금리·예금·투자상품")] },
  "하이라이트 없음 · 폴백 있음": { ...BASE, highlights: [], categories: [cat("realestate", "부동산"), cat("stocks", "증시·환율", { fallbackReason: "unverified-entity" })] },
  "하이라이트 둘 · 폴백 없음": { ...BASE, highlights: [highlight(1), highlight(2)], categories: [cat("realestate", "부동산"), cat("rates", "금리")] },
  "하이라이트 하나 · 폴백 있음": { ...BASE, highlights: [highlight(1)], categories: [cat("realestate", "부동산", { fallbackReason: "x" })] },
  // 스크립트 escapeHtml 은 & < > 만, 구운 쪽은 " 도 &quot; 로 낸다(아래 asScript 가 맞춘다). 속성(href)의 & 는 구운 쪽만 &amp; 로 낸다 - 파서가 같은 값으로 읽는다.
  "특수문자": { ...BASE, model: `m<b>&"'`, highlights: [highlight(1, { title: `T<i>&"'`, source: `S<>&"'`, textKo: `X<script>&"'` })], categories: [cat("a", `N<>&"'`, { lineKo: `L<img src=x onerror=1>&"'` })] },
  "모델 이름 없음": { updatedAt: BASE.updatedAt, highlights: [], categories: [cat("realestate", "부동산")] },
  "한국 날짜가 UTC 와 다른 시각": { ...BASE, updatedAt: "2026-10-17T15:30:00Z", highlights: [], categories: [cat("realestate", "부동산")] },
};

// #575 PR2: 메인의 요약 상자와 그 스크립트(renderSummary)를 뉴스 화면으로 옮기며 지웠다 - 구운 상자 = 스크립트 상자 대조(케이스 일곱)와
// "index.html 상자 틀에 placeholder 가 없다" 시험은 맞댈 상대가 없어져 지웠다. summaryHtml 조각은 어느 장에도 꽂지 않고 남아 있다(정리는 #575 PR4).

test("구운 상자의 뼈대 class 는 스크립트와 같은 이름이다 - 분류 라벨 + 줄 div, 끝에 .summary-meta, `<p>` 목록이 아니다 (#352)", () => {
  const html = summaryHtml(CASES["하이라이트 하나 · 폴백 있음"]);
  for (const cls of ["summary-highlights", "summary-section-label", "summary-highlight", "summary-link-source", "summary-highlight-text", "summary-category", "summary-category-label", "summary-category-line", "summary-fallback-note", "summary-meta"]) {
    assert.ok(html.includes(`class="${cls}"`), `React 구운 상자에 class="${cls}" 가 없다`);
  }
  assert.ok(!html.includes("<p>"), "구운 상자에 `<p>` 목록이 남았다");
  assert.ok(html.endsWith("</span>") && html.includes('<span class="summary-meta">'), ".summary-meta 가 상자 끝에 없다");
});

test("분류가 없으면 굽지 않는다 - 스크립트도 분류 없이는 구획을 그리지 않는다 (#352)", () => {
  for (const s of [null, {}, { categories: [] }, { highlights: [highlight(1)], categories: [] }]) {
    assert.equal(summaryHtml(s), null);
  }
});

// (#507) "커밋된 구운 index.html 의 상자가 summary.json 으로 다시 찍은 것과 같다 - 데이터가 바뀌면 다시 구워야 한다 (#352)" 는 tools/health 로 옮겼다가, 메인 요약 상자가 없어져(#575 PR2) 그 짝과 test/fixture-site.test.mjs 의 고정 데이터 짝을 함께 지웠다.
