// index.html AI 요약 상자(#summary-box)의 한국어 글 두 가지 (#352). 순수 모듈 - prerender.mjs(legacy)와 render/entry.jsx(JSX)가 같은 글을 쓴다.
//
// 구운 상자가 `<p><strong>분류</strong> 줄</p>` 목록이던 때는 요약 JSON 이 오는 순간 화면 스크립트(index.html renderSummary)가 상자를
// 분류 라벨 div + 줄 div + `.summary-meta` 로 다시 그려 상자가 +40.4px 자랐고 아래 #news-section 이 233.1px 밀렸다(375폭, #352).
// 그래서 구울 때도 스크립트와 같은 마크업을 싣는다. 마크업(class·구조)은 두 렌더러가 각자 쓰고, 여기에는 글자만 둔다.
//
// 구운 쪽은 한국어다(구운 HTML 은 늘 한국어). 두 구획 이름의 원본은 index.html 문자열 표(summaryHighlightsLabel · summaryCategoriesLabel)이고,
// 이 상수가 그 한국어와 글자까지 같은지, fmtUpdated 와 같은 식인지는 test/summary-box.test.mjs 가 대조한다(체크리스트 10).

export const SUMMARY_HIGHLIGHTS_LABEL_KO = "오늘의 핵심";
export const SUMMARY_CATEGORIES_LABEL_KO = "분야별 요약";

/** index.html fmtUpdated(locale ko)와 같은 식: 한국 시각, 날짜 medium · 시각 short, 뒤에 " KST". */
export function fmtUpdatedKo(iso) {
  if (!iso) return "-";
  return (
    new Date(iso).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " KST"
  );
}

/** index.html 의 summaryMeta(ko): `${model} 생성 · ${date}`. 모델 이름이 없으면 "AI". */
export const summaryMetaKo = (summary) => `${summary?.model ?? "AI"} 생성 · ${fmtUpdatedKo(summary?.updatedAt)}`;
