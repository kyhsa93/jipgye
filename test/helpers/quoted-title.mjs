// 출처·링크 붙은 목록 항목의 제목 글자 자리(#945 (c), #950). 뉴스 목록(scripts/render/entry.jsx NewsItem)과 근거 기사 목록(scripts/summary-note.ts sourcesMarkup) 두 꼴이
// 모두 `<li…><a href="http…" target="_blank" rel="noopener">제목</a>` 이다. 제목 글자만 잡고 li·a·출처 줄은 남긴다.
// 인용 제목은 언론 원문이라 우리 글을 보는 낱말 검사에서 빼되, 제목을 고치거나 숨기지는 않는다(인용 변경, #945 H1).
// fx-screens(「실시간」 낱말)와 news-pages(정적 목록의 상대 시간)가 같은 범위를 쓰도록 한 벌만 둔다. site-root 를 부르지 않는다 - 게이트 선택(scripts/site-test-files.mjs)에 영향 없음.
export const QUOTED_TITLE = /(<li\b[^>]*><a href="https?:\/\/[^"]*" target="_blank" rel="noopener">)([^<]*)(<\/a>)/g;

// 제목 글자만 비운 글. 둘레 글·출처 줄·맥락 칩은 그대로 남는다.
export const withoutQuotedTitles = (html) => html.replace(QUOTED_TITLE, "$1$3");
