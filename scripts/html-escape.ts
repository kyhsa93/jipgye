// HTML 글자 이스케이프. 순수 모듈 - prerender.ts와 district-links.mjs가 같은 함수를 쓴다(#241 PR 2).
// prerender.ts가 같은 이름으로 다시 내보내므로 `import { escapeHtml } from "./prerender.ts"`는 그대로 된다.
// JSX 쪽은 이 함수를 쓰지 않는다: React가 `& < > "`를 같은 엔티티로 내고(`'`만 `&#x27;`, 래퍼가 되돌린다), 값 변환(`String(value ?? "")`)은 entry.jsx의 `str()`이 한다.
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
