// React 렌더러의 진입점 한 곳 (#237). 조각 함수는 각자 로더를 부르지 않고, 이 파일이 만든 렌더러를 `scripts/renderer.mjs`를 거쳐 쓴다.
//
// 이식된 조각의 목록은 진입 JSX(`entry.jsx`)의 `fragments`다. 이름은 `prerender.mjs`의 `*Html()` 함수 이름이고,
// 값은 그 함수와 같은 인자를 받아 React 요소를 돌려주는 함수다. #240(금리 조각)이 채웠고 #241~#243이 이어서 채운다.
// 목록에 없는 조각은 react 모드에서도 legacy에 맡긴다.
//
// 실패는 예외로 올라간다: 로더 오류, 진입 모듈 모양 오류, 조각을 그리다 난 오류 모두 삼키지 않는다(폴백은 #238).
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { loadJsxModule } from "./load-jsx.ts";

export const DEFAULT_ENTRY = path.join(import.meta.dirname, "entry.jsx");

// React는 텍스트와 속성값의 `'`를 `&#x27;`로 내고 legacy `escapeHtml`은 그대로 둔다. 뜻은 같고 바이트만 다르므로 여기서 한 줄로 맞춘다.
const toLegacyApostrophe = (html) => html.replaceAll("&#x27;", "'");

export async function createReactRenderer({ entry = DEFAULT_ENTRY } = {}) {
  const { fragments } = await loadJsxModule(entry);
  if (fragments === null || typeof fragments !== "object") {
    throw new Error(`${entry}는 fragments 객체를 내보내야 합니다`);
  }
  const table = new Map<string, Function>(Object.entries(fragments));
  for (const [name, fn] of table) {
    if (typeof fn !== "function") throw new Error(`fragments.${name}은 함수여야 합니다`);
  }
  return {
    /** 이식된 조각 이름(정렬). */
    names: () => [...table.keys()].sort(),
    has: (name) => table.has(name),
    /** legacy와 같은 자리에 쓰는 문자열. 조각이 null을 주면(데이터 없음) 그대로 null이다. */
    render(name, args) {
      const element = table.get(name)(...args);
      return element == null ? null : toLegacyApostrophe(renderToStaticMarkup(element));
    },
  };
}
