import test from "node:test";
import assert from "node:assert/strict";
import { summaryHtml } from "../scripts/prerender.ts";

const SUMMARY = {
  updatedAt: new Date().toISOString(),
  model: "stub",
  summary: { ko: "- 국토부: 요약", en: "- Ministry: summary" },
  highlights: [
    {
      title: "국토부, 신규 택지 후보지 발표",
      link: "https://example.com/a",
      source: "가상경제",
      category: "realestate",
      textKo: "국토교통부는 14일 신규 공공택지 후보지를 발표했다. 이번 후보지에는 3만 가구가 들어선다.",
      textEn: "The ministry announced new public housing sites on the 14th.",
    },
  ],
  categories: [
    {
      key: "realestate",
      name: "부동산",
      nameEn: "Real Estate",
      lineKo: "정부가 택지 공급 계획을 내놨다. 서울시는 다른 견해를 냈다. 협의는 연내 이어진다.",
      lineEn: "The government announced a land supply plan.",
      isFallback: false,
      fallbackReason: null,
      degraded: false,
      items: [{ title: "국토부, 신규 택지 후보지 발표", link: "https://example.com/a", source: "가상경제" }],
    },
  ],
};

// 메인 화면의 요약 상자(index.html renderSummary)를 돌려 보던 시험 넷(핵심 기사 순서·영어 요약·핵심 없는 날·태그 이스케이프)은
// 상자를 뉴스 화면으로 옮기며 지웠다(#575 PR2). 뉴스 화면 요약의 이스케이프·폴백은 load-failure·news-pages 시험이 본다.
// 아래는 아직 남아 있는 구운 조각(summaryHtml, 어느 장에도 꽂지 않는다 - 정리는 #575 PR4) 시험이다.
test("프리렌더 HTML에도 핵심 기사가 들어간다", () => {
  const html = summaryHtml(SUMMARY);

  assert.ok(html.includes("신규 공공택지 후보지를 발표했다"));
  assert.ok(html.includes("정부가 택지 공급 계획을 내놨다"));
  assert.ok(html.indexOf("신규 공공택지") < html.indexOf("정부가 택지 공급"), "핵심이 뒤에 있다");
});
