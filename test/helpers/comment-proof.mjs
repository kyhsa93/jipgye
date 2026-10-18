// "주석만 바뀌었다"를 기계로 증명하는 도구 (#313 완료 조건 2). 시험 전용 - esbuild 는 여기서만 부른다
// (scripts/strip-inline-comments.mjs 는 esbuild 를 import 하지 않는다).
//
// 증명은 서로 다른 두 눈이다. 둘 다 통과해야 "주석만 바뀌었다"로 친다.
//
//  1. 구문 트리 눈 - 전후를 **같은 파서(esbuild)** 로 읽어 minifyWhitespace 로 다시 찍은 결과가 글자까지 같다.
//     식별자·문자열·숫자·연산자·낱말 하나라도 달라지면 다르다. (minify 는 공백만 접는다 - 식별자 축약·구문 압축은
//     꺼 둔 채라 이름이 그대로 남는다. 주석은 이 출력에 실리지 않는다. 비압축 출력은 객체 리터럴 안 주석 몇 개를
//     그대로 싣기도 해서 쓰지 않는다.)
//     한계: 구문 트리는 끝 쉼표·따옴표 모양·세미콜론·괄호 모양을 안 본다.
//  2. 글자 눈 - 후 문서가 전 문서에서 **지운 글자만으로** 만들어진다. 지운 덩어리는 공백과 완결된 주석(`// …` 줄 끝까지,
//     `/* … */`)뿐이고, 덩어리마다 주석이 하나 이상 들어 있다(주석 없이 공백만 지운 곳은 불합격 - 문자열 속 공백을 지우는 길을 막는다).
//     1이 못 보는 끝 쉼표·따옴표·세미콜론·괄호 변화는 여기서 걸린다(그것들은 공백도 주석도 아니다).
//     정렬은 되돌아가기(backtracking)로 한다 - 지운 주석의 글자와 남은 코드의 글자가 같을 때(`/` 따위)도 맞는 정렬을 찾는다.
import * as esbuild from "esbuild";

const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//y;

/** HTML 한 장의 인라인 <script> 본문 목록(src 없는 것 전부, JSON 섬 포함). */
export function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1])).map((m) => ({ attrs: m[1], body: m[2] }));
}

/** JS 인라인 스크립트(JSON 섬 제외)만. */
export function jsInlineScripts(html) {
  return inlineScripts(html).filter((s) => {
    const type = s.attrs.match(/\btype\s*=\s*["']?([^"'\s>]*)/i)?.[1]?.toLowerCase();
    return type === undefined || type === "" || type === "text/javascript" || type === "application/javascript" || type === "module";
  });
}

const tokens = (js) => esbuild.transformSync(js, { loader: "js", legalComments: "none", minifyWhitespace: true }).code;

/** 눈 1: 같은 파서가 읽은 구문이 같다. */
export function sameSyntax(before, after) {
  try {
    return tokens(before) === tokens(after);
  } catch {
    return false;
  }
}

/**
 * 눈 2: after 는 before 에서 (공백 + 완결된 주석)을 지운 것뿐이다. 덩어리마다 주석이 하나 이상 있어야 한다.
 * 돌려주는 값: { ok, removed: 지운 주석 개수, why? }
 */
export function onlyWhitespaceAndCommentsRemoved(before, after) {
  const n = before.length;
  const m = after.length;
  // 상태: [i(전 문서 위치), j(후 문서 위치), 지운 덩어리 안인가, 그 덩어리에 주석이 있나, 지금까지 지운 주석 수].
  // 지우는 길(주석 하나 통째 · 공백 한 글자)과 남기는 길(같은 글자)이 갈리는 곳마다 되돌아갈 수 있게 쌓는다.
  const stack = [[0, 0, 0, 0, 0]];
  const seen = new Set();
  let deepest = 0;
  while (stack.length) {
    const [i, j, inSeg, segComment, removed] = stack.pop();
    const key = ((i * (m + 1) + j) * 2 + inSeg) * 2 + segComment;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i > deepest) deepest = i;
    if (i === n) {
      if (j === m && (!inSeg || segComment)) return { ok: true, removed };
      continue;
    }
    const c = before[i];
    if (c === "/") {
      COMMENT.lastIndex = i;
      const hit = COMMENT.exec(before);
      if (hit) stack.push([i + hit[0].length, j, 1, 1, removed + 1]);
    }
    if (/\s/.test(c)) stack.push([i + 1, j, 1, segComment, removed]);
    if (j < m && c === after[j] && (!inSeg || segComment)) stack.push([i + 1, j + 1, 0, 0, removed]);
  }
  return { ok: false, removed: 0, why: `${deepest}번째 글자 근처에서 주석도 공백도 아닌 글자가 달라졌다: ${JSON.stringify(before.slice(Math.max(0, deepest - 40), deepest + 40))}` };
}

/** 한 스크립트 본문 쌍의 증명. */
export function proveCommentsOnly(before, after) {
  const syntax = sameSyntax(before, after);
  const chars = onlyWhitespaceAndCommentsRemoved(before, after);
  return { ok: syntax && chars.ok, syntax, chars, removed: chars.removed };
}

/** 문서 쌍: 스크립트 바깥은 글자까지 같고(주석 없는 문서는 전부 같다), 인라인 스크립트마다 증명이 선다. */
export function proveHtmlCommentsOnly(beforeHtml, afterHtml) {
  const outside = (html) => html.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi, (all, open, attrs, body, close) => (/\bsrc\s*=/i.test(attrs) ? all : `${open}${close}`));
  const a = jsInlineScripts(beforeHtml);
  const b = jsInlineScripts(afterHtml);
  if (outside(beforeHtml) !== outside(afterHtml)) return { ok: false, why: "스크립트 바깥(마크업·JSON 섬)이 달라졌다", removed: 0 };
  if (a.length !== b.length) return { ok: false, why: `인라인 스크립트 수가 달라졌다 ${a.length} → ${b.length}`, removed: 0 };
  let removed = 0;
  for (let k = 0; k < a.length; k += 1) {
    const r = proveCommentsOnly(a[k].body, b[k].body);
    if (!r.ok) return { ok: false, why: `${k + 1}번째 인라인 스크립트: 구문 ${r.syntax ? "같음" : "다름"} · 글자 ${r.chars.ok ? "통과" : r.chars.why}`, removed };
    removed += r.removed;
  }
  return { ok: true, removed };
}
