// 자치구 링크 조각이 같이 쓰는 것. 순수 모듈 - render/entry.jsx(JSX)가 같은 분기·같은 경로 규칙을 쓴다(#241 PR 2).
// 문자열 마크업 함수(legacy `linksBlockHtml`·`slugLinksHtml`)는 #248 P3 가 지웠다 - 마크업은 JSX 쪽에만 있다.
// 여기서 `prerender.ts`를 불러오면 안 된다(로더가 막는다).

/**
 * 링크 묶음의 모양(마크업 없이): 머리글과 상자의 id, 머리글 글자. 링크가 하나도 없으면 null이다(머리글도 내지 않는다).
 * JSX(`render/entry.jsx`의 districtLinksHtml)가 이 분기·id 규칙을 쓴다(#242 PR 1).
 * `hasLinks`는 링크가 있는지(JSX는 요소 개수).
 */
export function linksBlockShape(id, heading, hasLinks) {
  if (!hasLinks) return null;
  return { headingId: `${id}-heading`, boxId: id, heading };
}

/** 빌더가 만든 `{ 자치구이름: slug }` 객체의 항목. 없거나 null이면 빈 목록(전환·해제·재계약·층 네 화면이 같은 모양의 `slugs`를 가진다). */
export const slugLinkEntries = (data) => Object.entries(data?.slugs ?? {});

/** 자치구 페이지로 가는 상대 경로. 코드가 정한 `./district-<slug>.html`이라 `javascript:`로 시작할 수 없다(slug가 null이면 빈 글자). */
export const slugLinkHref = (slug) => `./district-${String(slug ?? "")}.html`;
