// 자치구 링크 조각이 같이 쓰는 것. 순수 모듈 - prerender.mjs(legacy)와 render/entry.jsx(JSX)가 같은 함수·같은 경로 규칙을 쓴다(#241 PR 2).
// 여기서 `prerender.mjs`·`renderer.mjs`를 불러오면 안 된다(로더가 막는다).
import { escapeHtml } from "./html-escape.mjs";

/**
 * 링크 묶음의 머리글과 상자. 링크가 하나도 없으면 머리글도 내지 않는다(빈 문자열).
 * 지금 부르는 쪽은 districtLinksHtml(prerender.mjs)이고, JSX 쪽은 #242(E2)가 이 모듈로 이어 쓴다.
 * `links`는 이미 만든 `<a>` 글자 묶음이다.
 */
export function linksBlockHtml(id, heading, links) {
  if (!links) return "";
  return (
    `<h3 class="district-links-heading" id="${id}-heading">${escapeHtml(heading)}</h3>` +
    `<div class="district-links" id="${id}">${links}</div>`
  );
}

/** 빌더가 만든 `{ 자치구이름: slug }` 객체의 항목. 없거나 null이면 빈 목록(전환·해제·재계약·층 네 화면이 같은 모양의 `slugs`를 가진다). */
export const slugLinkEntries = (data) => Object.entries(data?.slugs ?? {});

/** 자치구 페이지로 가는 상대 경로. 코드가 정한 `./district-<slug>.html`이라 `javascript:`로 시작할 수 없다(slug가 null이면 빈 글자). */
export const slugLinkHref = (slug) => `./district-${String(slug ?? "")}.html`;

/** 네 화면(전환·해제·재계약·층)의 자치구 링크 `<a>` 묶음. 항목이 없으면 null(자리표시를 비운다). */
export function slugLinksHtml(data) {
  const links = slugLinkEntries(data)
    .map(([name, slug]) => `<a href="${escapeHtml(slugLinkHref(slug))}">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}
