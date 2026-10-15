// CSS 원문을 글자로 읽는 작은 파서와 Tailwind class 토큰 읽기(#276). 의존이 없다.
// 쓰는 곳: test/css-build.test.mjs(산출물에 기존 규칙이 전부 남았는가, class 금지 규칙),
//          tools/render(화면 동일 증빙 - 브라우저가 버리는 선언과 빌드가 고쳐 쓴 선언을 원문끼리 견준다).
//
// 브라우저의 CSSOM이 아니라 글자를 읽는 이유: 브라우저는 모르는 선언(다른 엔진용 접두사)과 같은 블록 안에서 덮인
// 대체값을 버린다. "빌드가 원문을 그대로 옮겼는가"는 버려지는 것까지 봐야 하므로 원문끼리 견준다.
// 견주기 전에 고르는 것은 공백뿐이다(연속 공백·줄바꿈 → 한 칸). 값의 표기(#fff ↔ #ffffff 따위)는 고르지 않는다 -
// 빌드가 표기를 바꾸면 그대로 차이로 나온다.

const ws = (s) => s.replace(/\s+/g, " ").trim();

/** 주석을 걷어낸다. 문자열 안의 `/*`는 주석이 아니다. */
export function stripComments(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function skipString(text, i) {
  const quote = text[i];
  for (i++; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

// 블록 하나의 안쪽을 읽는다. 토막은 `{`(규칙의 머리), `;`(선언·문장), `}`(블록 끝)에서 끊긴다 - 문자열과 괄호 안에서는 끊지 않는다
// (url(data:…;base64,…)의 `;`).
function parseBlock(src, start) {
  const nodes = [];
  let i = start;
  for (;;) {
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '"' || c === "'") j = skipString(src, j) - 1;
      else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth <= 0 && (c === "{" || c === ";" || c === "}")) break;
    }
    const chunk = ws(src.slice(i, j));
    const end = src[j];
    if (end === "{") {
      const inner = parseBlock(src, j + 1);
      nodes.push({ type: "block", prelude: chunk, children: inner.nodes });
      i = inner.end;
      continue;
    }
    if (chunk) nodes.push(chunk.startsWith("@") ? { type: "statement", text: chunk } : { type: "decl", text: declText(chunk) });
    if (end === undefined) return { nodes, end: src.length };
    if (end === "}") return { nodes, end: j + 1 };
    i = j + 1;
  }
}

// `이름: 값`으로 고른다. `!important` 앞뒤 공백만 맞춘다.
function declText(chunk) {
  const at = chunk.indexOf(":");
  if (at === -1) return chunk;
  return `${chunk.slice(0, at).trim()}: ${chunk.slice(at + 1).trim().replace(/\s*!\s*important$/i, " !important")}`;
}

/** 원문 → 나무. 노드: { type: "block", prelude, children } | { type: "decl", text } | { type: "statement", text }. */
export function parseCss(text) {
  return parseBlock(stripComments(text), 0).nodes;
}

/**
 * 원문을 문서 순서의 규칙 목록으로 편다.
 *   rules      — { at: [감싼 블록의 머리…], selector, decls: ["이름: 값", …] }. 감싼 블록은 @media·@layer·@supports와 중첩 규칙의 부모다.
 *                선언이 없고 자식 블록만 있는 블록(@media 따위)은 줄로 내지 않고 자식의 at에만 남는다.
 *   statements — 맨 바깥의 `@…;` 문장(@layer 순서 선언, @import, @source).
 */
export function flattenCss(text) {
  const rules = [];
  const statements = [];
  const walk = (nodes, at) => {
    for (const n of nodes) {
      if (n.type === "statement" && at.length === 0) statements.push(n.text);
      if (n.type !== "block") continue;
      const own = n.children.filter((c) => c.type !== "block").map((c) => c.text);
      const blocks = n.children.filter((c) => c.type === "block");
      if (own.length || blocks.length === 0) rules.push({ at, selector: n.prelude, decls: own });
      walk(blocks, [...at, n.prelude]);
    }
  };
  walk(parseCss(text), []);
  return { rules, statements };
}

/** 한 줄로 적은 규칙(오류 문구·차이 목록용). */
export const ruleLine = (r) => `${r.at.length ? `${r.at.join(" > ")} > ` : ""}${r.selector} { ${r.decls.join("; ")} }`;

/** 진입 파일의 `@source "…";` 목록(따옴표 안의 글자 그대로). */
export function sourceGlobs(mainCss) {
  return flattenCss(mainCss).statements.map((s) => /^@source\s+(["'])(.*)\1$/.exec(s)?.[2]).filter(Boolean);
}

// ── Tailwind class 토큰 ─────────────────────────────────────────────────────────────────────────
// 접두사가 `tw`이므로 class는 전부 `tw:`로 시작한다(변형은 그 뒤에 온다: tw:md:hover:…). Tailwind는 @source 파일을
// 문법을 모르는 채 글자로 훑는다 - 주석에 적은 것도 class로 읽는다. 그래서 여기서도 글자로 읽는다:
// `tw:` 뒤로 공백·따옴표·백틱·꺾쇠가 나오기 전까지가 토큰 하나다.
const TOKEN = /(?<![A-Za-z0-9_-])tw:[^\s"'`<>]*/g;

/** 글 안의 토큰(중복 없이, 나온 순서). */
export function twTokens(text) {
  return [...new Set(text.match(TOKEN) ?? [])];
}

/** 완전한 리터럴인가: class에 쓰이는 글자로만 이뤄지고 `-`나 `:`로 끝나지 않는다. `tw:p-${n}`·`"tw:p-" + n`·`"tw:" + name`이 여기서 걸린다. */
export const isLiteralToken = (t) => /^tw:[A-Za-z0-9_\-:./()!%#,=&>~+*@[\]]+$/.test(t) && !/[-:]$/.test(t);

/** 대괄호·괄호 밖의 `:`에서 가른다. 첫 조각은 접두사(tw), 마지막 조각이 유틸리티, 그 사이가 변형이다. */
export function tokenParts(token) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of token) {
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    if (c === ":" && depth <= 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

/** dark 변형을 쓰는가(tw:dark:…, tw:md:dark:…). */
export const usesDarkVariant = (t) => tokenParts(t).slice(1, -1).includes("dark");

/** 임의값(대괄호)을 쓰는가: tw:p-[3px], tw:[&>p]:m-0, tw:data-[x=y]:flex. */
export const usesArbitrary = (t) => t.includes("[");

// 초점 표시를 지우는 유틸리티. 이 사이트의 초점 표시는 outline 하나다(legacy.css의 `a:focus-visible, … { outline: 2px solid var(--focus) }`).
// Tailwind v4.3.3 단독 실행 파일의 출력으로 확정한 목록(2026-10-12):
//   outline-none        → outline-style: none
//   outline-hidden      → outline-style: none (forced-colors에서만 투명한 2px 외곽선)
//   outline-0           → outline-width: 0px
//   outline-transparent → outline-color: transparent
//   outline-<색>/0      → 투명도 0%인 outline-color
// 중요 표시(!)는 앞이든 뒤든 떼고 본다. 변형(focus:, focus-visible:, md: …)이 붙어도 같다.
const OUTLINE_KILLERS = new Set(["outline-none", "outline-hidden", "outline-0", "outline-transparent"]);
export function removesOutline(t) {
  const utility = tokenParts(t).at(-1).replace(/^!|!$/g, "");
  return OUTLINE_KILLERS.has(utility) || /^outline-.+\/0+$/.test(utility);
}

/** 토큰이 산출물에서 갖는 class 선택자. Tailwind는 이름 글자가 아닌 것을 전부 역슬래시로 적는다(`.tw\:w-1\/2`). */
export const tokenSelector = (t) => `.${t.replace(/[^A-Za-z0-9_-]/g, "\\$&")}`;

/** 산출물 안의 `tw` 접두사 class 선택자들을 토큰으로 되돌린다. */
export function builtUtilityTokens(css) {
  return [...new Set((stripComments(css).match(/\.tw\\:(?:\\.|[A-Za-z0-9_-])+/g) ?? []).map((s) => s.slice(1).replace(/\\(.)/g, "$1")))];
}
