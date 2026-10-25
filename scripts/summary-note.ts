// AI 요약 상자의 "검증 폴백 안내" 한 줄 (#350). 순수 모듈 - render/entry.jsx(JSX)가 이 글을 쓴다.
//
// 요약 봇이 분류 하나를 검증에서 걸러 헤드라인 목록으로 갈아 끼운 날(summary.json 의 categories[].fallbackReason)에는
// 화면 스크립트(index.html renderSummary, 뉴스 틀 renderSummary)가 상자 끝에 안내 한 줄을 붙인다. 구운 HTML 이 이 줄을 안 싣던 때는
// 요약 JSON 이 오는 순간 줄이 생겨 아래 구획이 한 줄(28.7px, 375폭)만큼 밀렸다. 그래서 구울 때도 같은 줄을 싣는다.
//
// 구운 쪽은 한국어다(구운 HTML 은 늘 한국어). 영어 문구와 한국어 문구의 원본은 각 틀의 문자열 표(뉴스 틀 fallbackNote ·
// index.html summaryFallbackNote)이고, 이 상수가 그 한국어와 글자까지 같은지는 test/summary-note.test.mjs 가 대조한다(체크리스트 10).

export const FALLBACK_NOTE_KO = "일부 항목은 검증에서 걸러져 헤드라인 요약으로 대체됐습니다.";

/** 화면 스크립트와 같은 조건: 보이는 분류 가운데 fallbackReason 이 있는 것이 하나라도 있다. */
export const hasFallback = (categories) => (categories ?? []).some((c) => c.fallbackReason);
