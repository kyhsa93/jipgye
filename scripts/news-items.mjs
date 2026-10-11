// 첫 화면 뉴스에 어느 기사를 싣는가. 순수 모듈 - prerender.mjs(legacy)와 render/entry.jsx(JSX)가 같은 함수를 쓴다(#241).

/**
 * 첫 화면 뉴스는 다섯 건만 - 부동산 먼저. 전에는 스물네 건이 다 실려 AI 요약의 주제별 헤드라인과 같은 기사를
 * 두 번 싣고 모바일 첫 화면의 58%를 차지했다(UIUX #48). 나머지는 뉴스 화면으로 보낸다. 화면(index.html
 * renderNews)도 같은 규칙이다.
 */
export const INDEX_NEWS = 5;
export function indexNewsItems(items) {
  const list = items ?? [];
  return [...list.filter((i) => i.category === "realestate"), ...list.filter((i) => i.category !== "realestate")].slice(0, INDEX_NEWS);
}
