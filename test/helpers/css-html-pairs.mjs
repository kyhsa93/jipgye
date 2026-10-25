// CSS 규칙과 구운 HTML 의 class 사용을 짝으로 본다(#317).
//
// test/style.test.mjs 의 "누르는 것은 손가락이 닿는 크기다"는 CSS 에 그 규칙이 있고 --tap 을 쓰는지만 봤다. 구운 HTML 이 그 class 를 떨어뜨리고
// CSS 규칙만 남아도 아무것도 실패하지 않았다(머리 버튼 62장이 모양을 잃는다). 이 헬퍼는 두 쪽을 한 목록으로 묶는다 -
//   CSS 만 있고 HTML 이 안 쓴다 → 실패, HTML 은 쓰는데 CSS 규칙이 없다 → 실패, 쓰는 장이 하한보다 적다 → 실패.
//
// 짝의 목록은 아래 TAP_PAIRS 한 곳이다. 선택자를 늘리는 변경은 이 배열에 한 줄을 더하는 것으로 끝난다
// (CSS 쪽 --tap 검사도 HTML 쪽 장 수 검사도 이 배열을 돈다 - 따로 적을 자리가 없다).
//
// 장 수 하한은 주석이 아니라 아래 숫자다. 내릴 때 diff 에 걸리게 하려는 것이고, 장 수가 정당하게 줄면 같이 고친다.
// 처음 값은 merge-base(origin/main 579e7985)의 build/site 67장(*.html)을 직접 센 것이다(.page-nav a 67 · .sub-nav a 55 · .news-chip 1 ·
// .lang-toggle 5 · .icon-toggle 62).
//
// 넣지 않은 것: `theme-toggle` 은 class 가 아니라 id 다(`class="icon-toggle" id="theme-toggle"`) - 모양과 --tap 은 .icon-toggle 이 준다.
// .theme-toggle 규칙이 없는 것은 결함이 아니라 정상이다(#317 cpo 판정). 빠뜨린 것이 아니다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * [CSS 선택자, 그 class 를 쓰는 구운 장 수의 하한, (선택) "script"].
 * 선택자는 `.class` 이거나 `.class 태그`(그 class 요소 안의 태그)다. 셋째 칸 "script" 는 그 class 를 장의 마크업이 아니라 장의 인라인 스크립트가
 * 문자열로 만들어 쓰는 경우다 - .news-chip 은 index.html 스크립트가 뉴스 칩을 그릴 때 `class="news-chip"` 을 쓴다(구운 요소는 0).
 */
export const TAP_PAIRS = [
  [".page-nav a", 67],
  [".sub-nav a", 55],
  [".news-chip", 1, "script"],
  [".lang-toggle", 1], // 금리 4장이 쓰던 넷이 #577 B2 로 빠져 첫 화면 하나다(5 -> 1).
  [".icon-toggle", 62],
];

/** 짝 선택자를 HTML 에서 찾을 모양으로 푼다: `.page-nav a` → { cls: "page-nav", inner: "a" }. */
function shape(sel) {
  const m = sel.match(/^\.([\w-]+)(?: ([a-z][a-z0-9]*))?$/);
  if (!m) throw new Error(`짝 선택자 모양이 아니다: ${sel} (.class 또는 .class 태그)`);
  return { cls: m[1], inner: m[2] ?? null };
}

// 스크립트 본문과 주석 안의 글자는 장이 쓰는 class 가 아니다(문자열로 든 마크업이 장 수를 부풀리지 않게).
const strip = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, "");

const OPEN_TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>"']+(?:="[^"]*"|='[^']*')?)*)\s*\/?>/g;

const scripts = (html) => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
const SCRIPT_CLASS = /class=\\?"([^"\\]*)\\?"/g;

/** 이 장이 그 class 를 쓰는가. inner 가 있으면 그 class 요소 안에 inner 태그가 하나라도 있어야 쓰는 것이다. where="script" 면 인라인 스크립트의 class="…" 문자열을 본다. */
export function pageUses(html, sel, where = "markup") {
  const { cls, inner } = shape(sel);
  if (where === "script") return [...scripts(html).matchAll(SCRIPT_CLASS)].some((m) => m[1].split(/\s+/).includes(cls));
  const body = strip(html);
  for (const m of body.matchAll(OPEN_TAG)) {
    const klass = m[2].match(/\sclass="([^"]*)"/)?.[1];
    if (!klass || !klass.split(/\s+/).includes(cls)) continue;
    if (!inner) return true;
    const end = body.indexOf(`</${m[1]}>`, m.index);
    if (new RegExp(`<${inner}[\\s>]`).test(body.slice(m.index + m[0].length, end === -1 ? undefined : end))) return true;
  }
  return false;
}

/** 나가는 사이트의 *.html 전부를 { 상대경로: 글자 } 로 읽는다. */
export async function readSitePages(siteDir) {
  const pages = {};
  for (const rel of (await readdir(siteDir, { recursive: true })).filter((f) => f.endsWith(".html")).sort()) {
    pages[rel] = await readFile(path.join(siteDir, rel), "utf8");
  }
  return pages;
}

/**
 * 짝이 맞지 않는 곳을 글로 돌려준다(빈 배열이면 맞다). 순수 함수 - 파일을 읽지 않는다.
 * @param {(sel: string) => boolean} hasRule CSS 에 그 선택자의 규칙이 있는가
 * @param {Record<string, string>} pages 장 이름 → HTML 글자
 */
export function pairProblems(hasRule, pages, pairs = TAP_PAIRS) {
  const problems = [];
  for (const [sel, floor, where] of pairs) {
    const rule = hasRule(sel);
    const used = Object.keys(pages).filter((name) => pageUses(pages[name], sel, where));
    if (!rule) problems.push(`${sel}: CSS 규칙이 없는데 구운 HTML ${used.length}장이 쓴다`);
    if (used.length === 0) problems.push(`${sel}: CSS 규칙은 있는데 구운 HTML 이 한 장도 안 쓴다`);
    else if (used.length < floor) {
      const missing = Object.keys(pages).filter((name) => !used.includes(name));
      problems.push(`${sel}: 구운 HTML ${used.length}장뿐이다(하한 ${floor}) - 안 쓰는 장: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}`);
    }
  }
  return problems;
}
