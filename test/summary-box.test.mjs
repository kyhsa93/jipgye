// index.html 구운 #summary-box 의 마크업이 화면 스크립트(renderSummary)가 JSON 을 받아 다시 그리는 모양과 같다 (#352).
// 구운 상자가 `<p><strong>분류</strong> 줄</p>` 목록이던 때는 요약 JSON 이 오는 순간 스크립트가 상자를 분류 라벨 div + 줄 div + `.summary-meta` 로 갈아 끼워
// 상자 높이가 바뀌고 아래 #news-section 이 밀렸다. 게다가 상자 틀에 placeholder class(점선 테두리·안쪽 여백 16px)가 붙은 채 구워져, 스크립트가 그 class 를 떼는 순간 폭도 달라졌다.
// 이 파일의 시험은 데이터 값에 좌우되지 않는다: 고정 fixture 를 실제 index.html 스크립트(test/helpers/index-page.mjs)에 먹여 나온 상자와
// 구운 조각(summaryHtml)을 글자까지 맞댄다. 저장소 docs/ 는 "원본·데이터로 다시 찍은 것과 같은가"만 본다.
//
// 주의: test/render-parity.test.mjs 의 sameHtml 은 class 를 지우고 비교한다(#277). 그래서 여기서는 래퍼(React)·legacy 쌍둥이를 가리지 않고
// **정규화 없이** 문자열을 맞대고, legacy 쌍둥이(summaryHtml.legacy)를 래퍼를 거치지 않고 직접 불러 JIPGYE_RENDERER 와 무관하게 본다(#355 와 같은 이유).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { applyPrerender, summaryHtml } from "../scripts/prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

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

/** 실제 index.html 스크립트에 요약 JSON 을 먹여 #summary-box 에 들어간 마크업을 꺼낸다(안쪽 + 끝에 붙는 .summary-meta). */
async function scriptBox(summary) {
  let release;
  const gate = new Promise((r) => (release = r));
  const page = await loadIndexPage({
    fetch: async (url) => {
      const name = String(url).split("/data/")[1].split(".json")[0];
      if (name !== "summary") return { ok: false, json: async () => ({}) };
      await gate; // 상자에 appendChild 를 걸 때까지 요약 응답을 붙들어 둔다
      return { ok: true, json: async () => summary };
    },
  });
  const box = page.byId("summary-box");
  let meta = null;
  box.appendChild = (el) => (meta = el);
  release();
  for (let i = 0; i < 400 && !(String(box.innerHTML).trim() && meta); i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.ok(String(box.innerHTML).trim(), "스크립트가 상자를 그리지 않았다");
  assert.ok(meta, "스크립트가 .summary-meta 를 붙이지 않았다");
  // appendChild 된 노드를 마크업 글자로 옮긴다: textContent 는 직렬화기가 & < > 를 이스케이프한다.
  const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `${box.innerHTML}<span class="${meta.className}">${esc(meta.textContent)}</span>`;
}

/** 구운 쪽 글자를 스크립트 글자와 맞춘다: " 는 텍스트 노드에서 &quot; 든 " 든 같은 DOM 이므로 스크립트 쪽 표기로, href 의 & 도 마찬가지. */
const asScript = (html) => html.replaceAll("&quot;", '"').replace(/href="([^"]*)"/g, (_, h) => `href="${h.replaceAll("&amp;", "&")}"`);

for (const [label, summary] of Object.entries(CASES)) {
  test(`구운 요약 상자(React 래퍼·legacy 쌍둥이)가 스크립트가 그리는 상자와 글자까지 같다: ${label} (#352)`, async () => {
    const drawn = await scriptBox(summary);
    // 정규화 없음: class·구조·글이 모두 같아야 한다. 래퍼는 기본 모드(React)이고 .legacy 는 모드와 무관한 원본이다.
    assert.equal(asScript(summaryHtml(summary)), drawn, "React 쪽 구운 상자가 스크립트 상자와 다르다");
    assert.equal(asScript(summaryHtml.legacy(summary)), drawn, "legacy 쪽 구운 상자가 스크립트 상자와 다르다");
  });
}

test("구운 상자의 뼈대 class 는 스크립트와 같은 이름이다 - 분류 라벨 + 줄 div, 끝에 .summary-meta, `<p>` 목록이 아니다 (#352)", () => {
  const html = summaryHtml.legacy(CASES["하이라이트 하나 · 폴백 있음"]);
  for (const cls of ["summary-highlights", "summary-section-label", "summary-highlight", "summary-link-source", "summary-highlight-text", "summary-category", "summary-category-label", "summary-category-line", "summary-fallback-note", "summary-meta"]) {
    assert.ok(html.includes(`class="${cls}"`), `legacy 구운 상자에 class="${cls}" 가 없다`);
    assert.ok(summaryHtml(CASES["하이라이트 하나 · 폴백 있음"]).includes(`class="${cls}"`), `React 구운 상자에 class="${cls}" 가 없다`);
  }
  assert.ok(!html.includes("<p>"), "구운 상자에 `<p>` 목록이 남았다");
  assert.ok(html.endsWith("</span>") && html.includes('<span class="summary-meta">'), ".summary-meta 가 상자 끝에 없다");
});

test("분류가 없으면 굽지 않는다 - 스크립트도 분류 없이는 구획을 그리지 않는다 (#352)", () => {
  for (const s of [null, {}, { categories: [] }, { highlights: [highlight(1)], categories: [] }]) {
    assert.equal(summaryHtml(s), null);
    assert.equal(summaryHtml.legacy(s), null);
  }
});

test("index.html 의 상자 틀은 placeholder class 없이 구워진다 - 스크립트가 떼는 class 가 구운 쪽에 남으면 폭이 달라진다 (#352)", async () => {
  const html = await read("docs/index.html");
  const open = html.match(/<div[^>]*id="summary-box"[^>]*>/)?.[0];
  assert.ok(open, "#summary-box 를 찾지 못했다");
  assert.ok(!/class="[^"]*\bplaceholder\b/.test(open), `구운 상자 틀에 placeholder class 가 있다: ${open}`);
  // 상자에 구운 내용이 없을 때(요약이 아직 없을 때)에만 placeholder 가 맞다. 구운 내용이 있는 틀에는 없어야 한다.
  assert.ok(html.indexOf("<!--prerender:summary-->") > 0 && html.includes("summary-category"), "구운 상자가 비어 있다");
  assert.ok(applyPrerender(html, { summary: summaryHtml(CASES["하이라이트 없음 · 폴백 없음"]) }).includes('id="summary-box"><!--prerender:summary--><div class="summary-category">'), "상자 틀 바로 안쪽이 분류 div 로 시작하지 않는다");
});

test("커밋된 구운 index.html 의 상자가 summary.json 으로 다시 찍은 것과 같다 - 데이터가 바뀌면 다시 구워야 한다 (#352)", async () => {
  const [html, summary] = await Promise.all([read("docs/index.html"), readJson("summary")]);
  const a = html.indexOf("<!--prerender:summary-->") + "<!--prerender:summary-->".length;
  const baked = html.slice(a, html.indexOf("<!--/prerender:summary-->"));
  const strip = (h) => h.replace(/<span class="summary-meta">[^<]*<\/span>$/, "");
  assert.equal(strip(baked), strip(summaryHtml.legacy(summary)), "docs/index.html 의 구운 상자가 summary.json 과 어긋난다. node scripts/prerender.mjs 를 실행하세요.");
  // 날짜 글자는 ICU 판에 따라 달라질 수 있어 형태만 본다(같은 판 안의 정확한 글자는 위 스크립트 대조가 본다).
  const meta = baked.match(/<span class="summary-meta">([^<]*)<\/span>$/)?.[1];
  assert.match(meta ?? "", /^.+ 생성 · \d{4}\. \d{1,2}\. \d{1,2}\. (오전|오후) \d{1,2}:\d{2} KST$/, ".summary-meta 의 형태가 다르다");
});
