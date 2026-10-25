// 요약 상자(summaryHtml)의 고정 기대 마크업 (#248 P2). 예전에는 같은 입력을 legacy(`.legacy`)로 다시 그려 맞댔다 - 이제 legacy 출력이 아니라 이 손으로 적은 글자가 기준이다.
// 마크업(class 포함)은 test/*.mjs 가 아니라 이 fixture 에 둔다: tools/golden 의 훅 클래스 추출기(collectHookClasses)가 test/*.mjs 의 class="…" 를 읽어 새 훅 이름으로 잡기 때문이다.
// `.summary-meta` 안쪽 글자는 ICU 판에 따라 달라질 수 있어 시험이 자리표시(META)로 바꿔 맞댄다(그 글자는 test/summary-box.test.mjs 의 스크립트 대조가 본다).

// scripts/prerender.ts 래퍼(기본값 react)가 이 입력에서 내야 하는 글자.
export const SUMMARY_BASIC = {
  input: { highlights: [{ title: "제목", textKo: "본문" }], categories: [{ name: "분야", lineKo: "한 줄" }] },
  expect: "<div class=\"summary-highlights\"><div class=\"summary-section-label\">오늘의 핵심</div><div class=\"summary-highlight\"><a href=\"\" target=\"_blank\" rel=\"noopener\">제목</a><span class=\"summary-link-source\"> · </span><div class=\"summary-highlight-text\">본문</div></div></div><div class=\"summary-section-label\">분야별 요약</div><div class=\"summary-category\"><div class=\"summary-category-label\">분야</div><div class=\"summary-category-line\">한 줄</div></div><span class=\"summary-meta\">META</span>",
};

// test/fixtures/render/fragments.jsx(summaryHtml 쌍둥이)의 [입력, 기대]. 기대가 null 이면 분류가 없어 굽지 않는 입력이다.
export const SUMMARY_TWIN_CASES = [
  [null, null],
  [{}, null],
  [{ highlights: [], categories: [] }, null],
  // 분류가 없으면(하이라이트만 있어도) null이다.
  [{ highlights: [{ title: "제목", link: "u", source: "S", textKo: "본문" }] }, null],
  [{ categories: [{ name: "분야", lineKo: "한 줄" }] }, "<div class=\"summary-category\"><div class=\"summary-category-label\">분야</div><div class=\"summary-category-line\">한 줄</div></div><span class=\"summary-meta\">META</span>"],
  [{ highlights: [{ title: "a", link: "u", source: "S", textKo: "b" }], categories: [{ name: "c", lineKo: "d" }] }, "<div class=\"summary-highlights\"><div class=\"summary-section-label\">오늘의 핵심</div><div class=\"summary-highlight\"><a href=\"u\" target=\"_blank\" rel=\"noopener\">a</a><span class=\"summary-link-source\"> · S</span><div class=\"summary-highlight-text\">b</div></div></div><div class=\"summary-section-label\">분야별 요약</div><div class=\"summary-category\"><div class=\"summary-category-label\">c</div><div class=\"summary-category-line\">d</div></div><span class=\"summary-meta\">META</span>"],
  [{ model: "m", updatedAt: "2026-10-18T03:05:38.770Z", categories: [{ name: "c", lineKo: "d", fallbackReason: "x" }] }, "<div class=\"summary-category\"><div class=\"summary-category-label\">c</div><div class=\"summary-category-line\">d</div></div><div class=\"summary-fallback-note\">일부 항목은 검증에서 걸러져 헤드라인 요약으로 대체됐습니다.</div><span class=\"summary-meta\">META</span>"],
  // 특수문자: React가 `'`만 다르게(&#x27;) 내므로 래퍼의 치환 한 줄이 맞춰야 한다. & < > "는 그대로 이스케이프된다.
  [{ highlights: [{ title: `it's <b> & "q"`, link: "https://e.com/?a=1&b=2", source: `s'<`, textKo: "don't & <i>" }], categories: [{ name: `a'b`, lineKo: `c'd` }] }, "<div class=\"summary-highlights\"><div class=\"summary-section-label\">오늘의 핵심</div><div class=\"summary-highlight\"><a href=\"https://e.com/?a=1&amp;b=2\" target=\"_blank\" rel=\"noopener\">it's &lt;b&gt; &amp; &quot;q&quot;</a><span class=\"summary-link-source\"> · s'&lt;</span><div class=\"summary-highlight-text\">don't &amp; &lt;i&gt;</div></div></div><div class=\"summary-section-label\">분야별 요약</div><div class=\"summary-category\"><div class=\"summary-category-label\">a'b</div><div class=\"summary-category-line\">c'd</div></div><span class=\"summary-meta\">META</span>"],
  // 글이 비어도 거르지 않고 그린다.
  [{ highlights: [{ title: "빈 글", link: "u", source: "S", textKo: "" }, { title: "남음", link: "u", source: "S", textKo: "x" }], categories: [{ name: "n", lineKo: "" }] }, "<div class=\"summary-highlights\"><div class=\"summary-section-label\">오늘의 핵심</div><div class=\"summary-highlight\"><a href=\"u\" target=\"_blank\" rel=\"noopener\">빈 글</a><span class=\"summary-link-source\"> · S</span><div class=\"summary-highlight-text\"></div></div><div class=\"summary-highlight\"><a href=\"u\" target=\"_blank\" rel=\"noopener\">남음</a><span class=\"summary-link-source\"> · S</span><div class=\"summary-highlight-text\">x</div></div></div><div class=\"summary-section-label\">분야별 요약</div><div class=\"summary-category\"><div class=\"summary-category-label\">n</div><div class=\"summary-category-line\"></div></div><span class=\"summary-meta\">META</span>"],
];

// test/fixtures/site/data/summary.json 의 하이라이트 둘·분류 넷(증시만 검증 폴백)을 손으로 옮겨 적은 구운 상자(.summary-meta 는 뺀다). `note` 는 검증 폴백 안내 문구.
export const fixtureSiteSummaryBox = (note) => {
  const highlight = (n) =>
    `<div class="summary-highlight"><a href="https://example.com/h/${n}" target="_blank" rel="noopener">합성 핵심 ${n}</a><span class="summary-link-source"> · 합성 출처 ${n}</span><div class="summary-highlight-text">합성 핵심 ${n} 본문</div></div>`;
  const category = (name, line) => `<div class="summary-category"><div class="summary-category-label">${name}</div><div class="summary-category-line">${line}</div></div>`;
  return (
    `<div class="summary-highlights"><div class="summary-section-label">오늘의 핵심</div>${highlight(1)}${highlight(2)}</div>` +
    `<div class="summary-section-label">분야별 요약</div>` +
    category("부동산", "부동산 합성 한 줄") +
    category("금리·예금·투자상품", "금리·예금·투자상품 합성 한 줄") +
    category("기타 경제 소식", "기타 경제 소식 합성 한 줄") +
    category("증시·환율", "증시·환율 합성 한 줄") +
    `<div class="summary-fallback-note">${note}</div>`
  );
};
