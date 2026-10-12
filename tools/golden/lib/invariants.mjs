// 불변 조건(invariants) 비교 (#274). 디자인이 바뀌어도 변하면 안 되는 것만 본다.
//
// canon.mjs(#236 S1)는 class를 포함한 모든 속성과 태그 트리를 견준다. Tailwind 도입과 디자인 개편은 class와 껍데기
// 구조를 바꾸므로 그 자는 더 못 쓴다. 이 모듈은 같은 parse5 트리에서 "디자인과 무관한 사실"만 뽑아 견준다.
// 판정 표는 #274 본문 범위 1이다. 괄호 안은 보고서·예외 목록이 쓰는 check 이름이다.
//
//   하드(하나라도 남으면 종료 1)
//     URL 집합(url-set)        .html 파일 이름 집합이 같다.
//     noindex 집합(noindex)    장마다 head의 meta[name=robots] **전부**의 content 다중집합(없음 포함)이 같다.
//     body 안 메타(body-meta)  body 안의 meta·base 줄의 다중집합이 같다(robots·refresh를 body에 넣어 head 검사를 비켜 가는 길).
//     head(head)               head의 title·meta·link·base 줄과 head 안 noscript 본문의 다중집합이 같다(robots는 위에서 따로).
//                              허용 예외는 HEAD_EXCEPTIONS 목록뿐이고, 예외 값이 다르면(여럿이면 전부) 소프트로 보고한다.
//     구조화 데이터(ld-json)   script[type="application/ld+json"] 개수가 같다(지금 0 — 새로 생기지 않는다).
//     본문 텍스트(text)        body의 **블록 단위 글자 흐름**의 다중집합이 같다. 블록 하나 안의 텍스트 노드를 공백까지 이어 붙인 것이
//                              한 항목이다(아래 "블록 단위 글자 흐름"). 숨김 표시([hidden]·[hidden:template]·[aria-hidden]·[inert] …)도 항목의 일부다.
//     속성 글자(attr-text)     title·alt·placeholder·label·lang·dir·aria-label·data-label·data-*-en(isTextAttr) 값의
//                              다중집합이 같다. 텍스트 노드만 보면 빠지는 글자다(좁은 화면 표 머리글은 data-label을 CSS가 그린다).
//     링크(links·link-target)  a[href]의 (href 원문·rel·target·링크 글자) 다중집합이 같고, 후보의 내부 링크 대상 파일이 있다.
//     참조 자원(resource-target)  link[href]·[src]·poster·srcset이 가리키는 내부 파일이 후보에 있다(style.css·manifest·아이콘을 지우는 길).
//     제목 계층(headings)      h1~h6의 (레벨·글자) 순서가 같다.
//     랜드마크(landmarks)      main·nav 개수, .skip-link의 href와 그 대상(있는지·어떤 요소인지), 본문 링크 중 몇 번째인지가 같다.
//     JS 훅(hooks)             기준의 id·data-*·aria-* (이름=값)과 훅 클래스가 후보에 그 수만큼 있다. 늘어난 것은 소프트(hooks-added).
//     인라인 script(inline-script)  본문과 순서가 같다(한·영 문자열표가 여기 있어 바이트 합만으로는 문구 변경이 지나간다).
//     S6(s6-*)                 script 줄 목록이 늘거나 바뀌지 않고(줄어드는 것만 허용), 인라인 script 바이트 합과
//                              외부 JS 바이트 합이 기준 이하다. 폴더 안 .js 전체 바이트 합도 기준 이하다.
//                              인라인 이벤트 핸들러 속성(on*)이 새로 생기거나 값이 바뀌지 않는다(s6-handlers — 속성 안의 JS다).
//     tw:dark:(tw-dark)        후보의 class·JS·CSS에 `tw:dark:` 변형이 없다(네 갈래 테마는 CSS 변수에서 갈린다).
//   소프트(종료 코드를 바꾸지 않고 목록만 낸다 — PR에 붙여 사람이 본다)
//     텍스트 순서(text-order), 텍스트 노드 경계(text-wrap — 글자·공백은 같고 인라인 래퍼·br만 다른 블록과 그 수),
//     details 접힘·펼침(details-open — 본문을 접는 일이라 po가 반드시 읽는다), head 허용 예외의 값(head-exception),
//     훅·script·on* 속성이 늘거나 준 것, 의미 속성(semantic), 폴더에서 사라진 파일(files-removed), 훅 목록 어긋남(hook-list*).
//   보지 않는 것: class·style 속성, 블록·중립 인라인 태그의 이름과 트리 모양, 주석, 속성 순서, 블록 가장자리의 공백.
//   **못 보는 것**: CSS가 하는 일 전부 — class로 숨긴 글자(display:none·sr-only·opacity 0), 가로 넘침, 요소 크기, 대비, 초점 순서.
//                   parse5는 CSS를 모른다. 렌더 기반 검사는 #278 PR A가 맡는다(test/invariants.test.mjs가 이 구멍을 시험으로 적어 둔다).
//
// 블록 단위 글자 흐름(#289 4번). 텍스트 노드 하나가 아니라 **블록 하나**가 비교 단위다 — 숫자를 <strong>으로 감싸 노드가 셋으로
// 잘려도 블록의 글자 흐름은 같다. 요소는 넷으로 나뉜다.
//   블록(TEXT_BLOCK)        흐름을 끊는다. 블록 양끝의 공백은 뗀다. SVG·MathML 안의 요소, 숨김 표시가 바뀌는 요소도 흐름을 끊는다.
//   중립 인라인(NEUTRAL_INLINE)  span·strong·em·b·i·small·mark·abbr — 흐름에 아무것도 보태지 않는다(감싸도 풀어도 흐름이 같다).
//   br                      공백 한 칸으로 센다(낱말 사이 공백 자리에 넣으면 흐름이 같고, 낱말 한가운데 넣으면 공백이 생긴 것이라 하드).
//   그 밖의 인라인          a·code·sup·sub·del·ins·s·u·q·time … 과 모르는 태그 — 뜻이 실리므로 흐름에 `‹태그›…‹/태그›`로 남는다.
//                           블록을 바깥에서 감싸면(`<del><p>…</p></del>`) 안쪽 블록의 항목에 `[in:del]` 표시로 남는다.
//                           (img·wbr·picture·source와 SVG·MathML 덩어리는 흐름을 끊지도 보태지도 않는다 — 아이콘 추가는 글자 변화가 아니다.)
// 그래서 블록 안의 글자 한 자·공백 한 칸(추가·삭제, 래퍼 경계 포함)·뜻 있는 태그·블록 나눔과 합침·블록 사이 이동은 전부 하드이고,
// 중립 인라인으로 감싸거나 푸는 것만 통과한다. 통과시킨 블록은 text-wrap(소프트)에 무엇이 감싸졌는지와 수를 적는다.
//
// 비교 조건(#8 부류): 기준은 PR의 merge-base, 후보는 PR 머리이고 **같은 입력·같은 BUILD_NOW로 렌더한 둘**만 견준다
// (bin/invariants.mjs --render). 다른 날 데이터로 구운 폴더끼리 견주면 데이터 때문에 텍스트가 갈린다.
//
// 훅 클래스는 손으로 적지 않는다. 소스에서 기계로 뽑아 hook-classes.json에 두고(collectHookClasses), 목록이 소스와
// 어긋나면 시험이 실패한다(hookListDrift). 비교 때는 그 목록에 **후보 폴더의 JS가 읽는 class**를 더한다 — 후보가
// 새 선택자를 들이면 목록을 고치기 전에도 잡히게 하려는 것이다. id·data-*·aria-*는 JS가 읽든 말든 전부 견준다.
//
// 의도한 차이(#274 범위 1): 하드 항목을 일부러 바꾸는 PR은 차이를 목록으로 적고 po·cmo가 확인한 것만 예외다.
// 도구는 그 목록을 JSON으로 받는다(applyExceptions) — 항목 문자열이 글자 그대로 맞는 것만 지우고, 목록에 없는 차이는 하드로 남는다.
//
// 의존은 canon.mjs와 같은 parse5 하나다. 입력 둘은 폴더이거나 snapshotDir이 낸 JSON이다.
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "parse5";
import { BLOCK, cleanChildren } from "./canon.mjs";
import { diffLines, listFiles } from "./compare.mjs";

// 2: #289 — texts가 텍스트 노드가 아니라 블록 흐름이고(shapes가 짝), robots·exceptions가 목록이며 handlers·bodyMeta·details·resources가 늘었다.
export const SNAPSHOT_VERSION = 2;

/** 내부 링크로 치는 절대 주소의 머리(canonical·og:url이 쓰는 값). */
export const SITE_BASE = "https://kyhsa93.github.io/jipgye/";

/** 훅 클래스 목록 파일. `node bin/invariants.mjs --hooks-write`가 쓰고 test/invariants.test.mjs가 소스와 대조한다. */
export const HOOK_LIST_FILE = path.join(import.meta.dirname, "../hook-classes.json");

/**
 * head에서 값이 달라도 하드 실패로 치지 않는 것(#274 범위 1 "허용 예외는 목록으로 명시").
 * 브랜드색이 바뀔 때만 달라진다. 달라지면 소프트로 보고하므로 조용히 지나가지는 않는다.
 * 아이콘·manifest의 색은 HTML이 아니라 파일 내용(docs/icons/*, manifest.webmanifest)이라 이 도구의 비교 대상이 아니다 —
 * 그 파일을 가리키는 link 줄(href)은 예외가 아니고 그대로 견준다.
 */
export const HEAD_EXCEPTIONS = [{ tag: "meta", attr: "name", value: "theme-color", mask: "content" }];

const TEXT_ATTR_NAMES = new Set("title alt placeholder label lang dir aria-label aria-description aria-placeholder aria-valuetext aria-roledescription data-label".split(" "));
/**
 * 값이 곧 글자인 속성(하드, 다중집합 동일). 화면이나 보조기술이 이 값을 읽는다.
 * data-*-en은 영어 모드에서 글자로 바꿔 끼우는 값이다(data-skip-en·data-brand-en).
 */
export const isTextAttr = (name) => TEXT_ATTR_NAMES.has(name) || /^data-.+-en$/.test(name);

/** 소프트로만 보는 의미 속성. 디자인 개편이 건드릴 이유가 없지만 본문의 하드 목록에는 없는 것. */
export const SEMANTIC_ATTRS = new Set("role hidden name for scope colspan rowspan headers type value".split(" "));

/**
 * 글자 흐름을 끊는 태그(#289 4번 "블록으로 치는 태그 목록"). canon.mjs의 BLOCK(공백이 접히는 자리)에서 br을 빼고,
 * 글자를 따로 담는 폼 컨트롤(button·input·textarea·label·legend)을 더했다 — 버튼 글자와 옆 문장은 한 문장이 아니다.
 * 이 목록의 태그끼리 바꾸는 것(div → section, p → li)은 흐름을 바꾸지 않는다. 블록을 나누거나 합치면 흐름이 달라진다.
 */
export const TEXT_BLOCK = new Set([...BLOCK, "button", "input", "textarea", "label", "legend"].filter((t) => t !== "br"));
/** 뜻을 바꾸지 않는 인라인. 이 태그로 글자를 감싸거나 푸는 것은 흐름을 바꾸지 않는다(text-wrap 소프트로 보고). 여덟 개로 확정(cto, PR #292) — code·kbd·time·u는 넣지 않는다. */
export const NEUTRAL_INLINE = new Set("span strong em b i small mark abbr".split(" "));
/** 흐름을 끊지도 보태지도 않는 빈 요소(아이콘·줄바꿈 기회). 글자가 든 속성(alt)은 attr-text가 본다. */
const TRANSPARENT = new Set("img wbr picture source".split(" "));
/** 브라우저 기본 스타일이 그리지 않는 요소(HTML 이름공간). 그 아래 글자에는 `[hidden:태그]` 표시가 붙는다. dialog는 open이 없을 때만. */
export const UA_HIDDEN = new Set("template noscript noembed noframes datalist canvas object video audio iframe title".split(" "));
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const NS_HTML = "http://www.w3.org/1999/xhtml";
const BR_SHAPE = "⏎";
const CUT = "┊";

const LANDMARK_TAGS = new Set(["main", "nav"]);
const SKIP_LINK_CLASS = "skip-link";

const WS = /[ \t\n\r\f]+/g;
const VERBATIM = new Set(["pre", "textarea"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const HEAD_TAGS = new Set(["title", "meta", "link", "base"]);
const IGNORED_ATTRS = new Set(["class", "style"]);
const CLASS_NAME = /^-?[A-Za-z_][\w-]*$/;

// `tw:dark:`·`tw:md:dark:` 같은 변형. CSS에서는 콜론이 `\:`로 적힌다.
const TW_DARK_CLASS = /^tw:(?:[^:\s]+:)*dark:/;
const TW_DARK_TEXT = /tw\\?:(?:[\w\-[\]=()@.]+\\?:)*dark\\?:[\w\-[\]/.%]*/g;

const norm = (s) => s.replace(WS, " ").trim();
const attrsOf = (node) => Object.fromEntries((node.attrs ?? []).map((a) => [a.name, a.value]));

/** class·style을 뺀 속성을 이름순으로 편다(canon과 같은 표기). mask에 든 속성은 값을 `*`로 가린다. */
function attrsText(node, mask = null) {
  return (node.attrs ?? [])
    .filter((a) => !IGNORED_ATTRS.has(a.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((a) => ` ${a.name}=${a.name === mask ? '"*"' : JSON.stringify(a.value)}`)
    .join("");
}

/** 요소 아래의 글자를 문서 순서로 이어 붙인다(script·style 제외, 공백 줄임). 제목·링크 글자에 쓴다. */
function textOf(node) {
  let out = "";
  const walk = (n) => {
    for (const kid of cleanChildren(n)) {
      if (kid.nodeName === "#text") out += kid.value;
      else if (kid.tagName && kid.tagName !== "script" && kid.tagName !== "style") walk(kid);
    }
  };
  walk(node);
  return norm(out);
}

/**
 * JS 원문에서 "읽는 class 이름"을 뽑는다: querySelector(All)·closest·matches의 선택자 문자열 안의 `.이름`,
 * getElementsByClassName·classList.add/remove/toggle/contains/replace의 문자열 인자, className이 든 줄의 문자열.
 * 정규식으로 읽는 어림이다 — 변수로 조립한 선택자(`querySelector(sel)`)는 못 읽는다(--hooks로 보탠다).
 */
export function jsClassRefs(js) {
  const out = new Set();
  const str = "(?:\\\\.|(?!\\1)[^\\\\])*";
  for (const m of js.matchAll(new RegExp(`\\b(?:querySelector(?:All)?|closest|matches)\\(\\s*(["'\`])(${str})\\1`, "g"))) {
    // 템플릿의 ${…}와 속성 선택자([href$=".html"])는 class가 아니다.
    const selector = m[2].replace(/\$\{[^}]*\}/g, " ").replace(/\[[^\]]*\]/g, " ");
    for (const c of selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(c[1]);
  }
  for (const m of js.matchAll(new RegExp(`\\bgetElementsByClassName\\(\\s*(["'\`])(${str})\\1`, "g"))) {
    for (const c of m[2].split(/\s+/).filter((x) => CLASS_NAME.test(x))) out.add(c);
  }
  for (const m of js.matchAll(/\bclassList\.(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g)) {
    // 인자 자리에 바로 놓인 문자열만 — `toggle("on", el.getAttribute("data-lang") === x)`의 "data-lang"은 class가 아니다.
    for (const c of m[1].matchAll(/(?:^|,)\s*(["'`])([A-Za-z_-][\w-]*)\1\s*(?=,|$)/g)) out.add(c[2]);
  }
  // `x.className = "summary-meta"`, `className = first?.className || "icon-toggle"` — 그 줄의 문자열을 class 목록으로 읽는다.
  for (const m of js.matchAll(/\bclassName\b([^;\n]*)/g)) {
    for (const s of m[1].matchAll(/(["'`])([A-Za-z_\- ][\w\- ]*)\1/g)) for (const c of s[2].split(" ").filter((x) => CLASS_NAME.test(x))) out.add(c);
  }
  return [...out].sort();
}

/**
 * 소스가 문자열로 쓰는 마크업의 class를 뽑는다: `class="a b"`, `class=\"a b\"`, `class='a'`.
 * 루트 test/*.mjs(구운 HTML을 정규식으로 읽는 시험)와 scripts/build-*-pages.mjs(틀을 문자열로 패치)가 기대는 이름이다.
 * 이름 모양이 아닌 조각(`${x}`, 정규식 `[^"]*`)은 버린다.
 */
export function markupClassRefs(source) {
  const out = new Set();
  for (const m of source.matchAll(/\bclass=\\?(["'])([^"'\\\n]*)/g)) {
    for (const c of m[2].split(/\s+/).filter((x) => CLASS_NAME.test(x))) out.add(c);
  }
  return [...out].sort();
}

/** 조상에게서 받은 숨김 표시(base)에 이 요소의 것을 더한다. 표시는 ` [hidden]`·` [hidden:template]`·` [aria-hidden]`·` [inert]`를 이어 붙인 문자열이다. */
function withMarks(base, node, a, inBody) {
  const own = [];
  if ("hidden" in a) own.push("[hidden]");
  if (inBody && node.namespaceURI === NS_HTML && (UA_HIDDEN.has(node.tagName) || (node.tagName === "dialog" && !("open" in a)))) own.push(`[hidden:${node.tagName}]`);
  if ((a["aria-hidden"] ?? "").trim().toLowerCase() === "true") own.push("[aria-hidden]");
  if ("inert" in a) own.push("[inert]");
  let out = base;
  for (const m of own) if (!out.includes(` ${m}`)) out += ` ${m}`;
  return out;
}

/** srcset·imagesrcset에서 주소만 뽑는다. data: 주소가 섞이면(쉼표가 주소 안에 있다) 읽지 않는다. */
const srcsetUrls = (value) => (value.includes("data:") ? [] : value.split(",").map((c) => c.trim().split(WS)[0]).filter(Boolean));

/** HTML 한 장에서 불변 사실을 뽑는다. 배열은 문서 순서다(다중집합 비교는 compare 쪽에서 센다). */
export function extractPage(html) {
  const page = {
    robots: [],
    head: [],
    bodyMeta: [],
    exceptions: [],
    ldJson: 0,
    texts: [],
    shapes: [],
    textAttrs: [],
    links: [],
    hrefs: [],
    resources: [],
    headings: [],
    landmarks: [],
    skip: [],
    details: [],
    ids: [],
    data: [],
    aria: [],
    semantic: [],
    handlers: [],
    classes: {},
    scripts: [],
    srcs: [],
    inline: [],
    inlineBytes: 0,
    jsRefs: [],
    twDark: [],
  };
  const refs = new Set();
  const idTag = {};
  const skips = [];
  let bodyLinks = 0;

  // 블록 하나의 글자 흐름을 모으는 통. flow는 비교 항목(하드), shape는 같은 흐름에 중립 인라인·br의 자리를 적은 것(text-wrap 소프트)이다.
  // mark는 숨김 표시에 "바깥에서 감싼 뜻 있는 인라인" 표시(` [in:del]`)를 이은 것이다 — 통이 그 태그의 여는 표시(`‹del›`)를 갖지 못할 때 붙는다.
  const openRun = (mark, verbatim) => ({ flow: [], shape: [], text: false, shaped: false, mark, verbatim });
  const flush = (run) => {
    if (!run.text) return; // 글자가 없는 블록(태그 표시뿐인 것 포함)은 항목이 아니다
    const fin = run.verbatim ? (s) => s : norm;
    page.texts.push(`${JSON.stringify(fin(run.flow.join("")))}${run.mark}`);
    page.shapes.push(run.shaped ? fin(run.shape.join("")) : 0);
  };
  let cur = openRun("", false);

  const headLine = (node, a) => {
    // robots는 하나도 빠짐없이 모은다(둘 이상이면 가장 좁은 지시가 이긴다 — 마지막 값만 보면 앞에 끼운 `none`이 지나간다). 이름은 대소문자를 가리지 않는다.
    if (node.tagName === "meta" && (a.name ?? "").trim().toLowerCase() === "robots") {
      page.robots.push(a.content ?? "");
      return;
    }
    const ex = HEAD_EXCEPTIONS.find((e) => e.tag === node.tagName && a[e.attr] === e.value);
    if (ex) {
      // 같은 이름의 메타가 여럿이면(media별 theme-color) 나머지 속성으로 가른다 — 전부 보고한다.
      const rest = (node.attrs ?? []).filter((x) => x.name !== ex.attr && x.name !== ex.mask && !IGNORED_ATTRS.has(x.name)).sort((x, y) => (x.name < y.name ? -1 : 1));
      page.exceptions.push(`${ex.tag}[${ex.attr}=${ex.value}]${rest.map((x) => `[${x.name}=${JSON.stringify(x.value)}]`).join("")} ${ex.mask}=${a[ex.mask] ?? null}`);
    }
    const body = node.tagName === "title" ? ` ${JSON.stringify(textOf(node))}` : "";
    page.head.push(`<${node.tagName}${attrsText(node, ex?.mask)}>${body}`);
  };

  const visit = (node, ctx) => {
    const tag = node.tagName;
    const a = attrsOf(node);
    const mark = withMarks(ctx.mark, node, a, ctx.inBody);
    const inHeadLine = ctx.inHead && HEAD_TAGS.has(tag);
    let isSkip = false;
    for (const { name, value } of node.attrs ?? []) {
      // 인라인 이벤트 핸들러(onclick·onload …): 속성 안의 JS다. head 줄에 있어도 따로 센다.
      if (name.length > 2 && name.startsWith("on")) page.handlers.push(`${name}=${JSON.stringify(value)}`);
      if (name === "id") {
        page.ids.push(value);
        idTag[value] ??= tag;
      } else if (name === "class") {
        for (const c of value.split(WS).filter(Boolean)) {
          page.classes[c] = (page.classes[c] ?? 0) + 1;
          if (c === SKIP_LINK_CLASS) isSkip = true;
          if (TW_DARK_CLASS.test(c)) page.twDark.push(`class ${c}`);
        }
      } else if (inHeadLine) {
        /* head의 title·meta·link는 headLine이 통째로 본다 */
      } else if (isTextAttr(name)) page.textAttrs.push(`${name}=${JSON.stringify(value)}${mark}`); // 태그 이름은 적지 않는다(div → section은 디자인이다)
      else if (name.startsWith("data-")) page.data.push(`${name}=${JSON.stringify(value)}`);
      else if (name.startsWith("aria-")) page.aria.push(`${name}=${JSON.stringify(value)}`);
      else if (SEMANTIC_ATTRS.has(name) && tag !== "script" && !(ctx.inBody && tag === "meta")) page.semantic.push(`${name}=${JSON.stringify(value)}`);
    }
    if (ctx.inBody && LANDMARK_TAGS.has(tag)) page.landmarks.push(tag);
    if (inHeadLine) headLine(node, a);
    // head 안 noscript의 본문은 파서에게 글자다(<meta http-equiv=refresh>·robots를 여기 넣으면 head 줄에 안 잡힌다).
    if (ctx.inHead && tag === "noscript") page.head.push(`<noscript> ${JSON.stringify(norm(cleanChildren(node).map((k) => k.value ?? "").join("")))}`);
    // body 안의 meta·base: 크롤러와 브라우저는 body에 놓인 robots·refresh·base도 읽는다.
    if (ctx.inBody && (tag === "meta" || tag === "base")) page.bodyMeta.push(`<${tag}${attrsText(node)}>`);
    // 참조 자원: 대상 파일이 있는지는 폴더 비교에서 본다(a[href]는 hrefs, script[src]는 srcs).
    if (tag === "link" && "href" in a) page.resources.push(a.href);
    if (tag !== "script" && "src" in a) page.resources.push(a.src);
    if ("poster" in a) page.resources.push(a.poster);
    if (tag === "object" && "data" in a) page.resources.push(a.data);
    for (const name of ["srcset", "imagesrcset"]) if (name in a) page.resources.push(...srcsetUrls(a[name]));
    if (ctx.inBody && tag === "details") {
      const summary = cleanChildren(node).find((k) => k.tagName === "summary");
      page.details.push(`details[${"open" in a ? "open" : "닫힘"}] 요약=${JSON.stringify(summary ? textOf(summary) : null)}`);
    }

    // 글자 흐름에서 이 요소의 자리: 덩어리(SVG·MathML — 바깥 흐름은 그대로 두고 안쪽을 따로 모은다) / 블록 / br / 중립 인라인 / 투명 / 뜻 있는 인라인.
    // 뜻 있는 인라인이 블록을 **바깥에서** 감싸면(`<del><p>…</p></del>`) 여는 표시가 든 통에는 글자가 없어 버려지고 안쪽 블록의 통은 새로 열린다.
    // 그래서 뜻 있는 인라인 조상을 ctx.inl로 내려보내 새로 여는 통(블록·블록이 닫힌 뒤 이어지는 통·덩어리)의 표시에 `[in:태그]`로 붙인다.
    const foreign = node.namespaceURI !== NS_HTML;
    const verbatim = ctx.verbatim || VERBATIM.has(tag);
    let inl = ctx.inl;
    let leave = () => {};
    if (foreign && !ctx.foreign) {
      const outer = cur;
      cur = openRun(mark + ctx.inl, false);
      leave = () => {
        flush(cur);
        cur = outer;
      };
    } else if (!ctx.inBody || ctx.foreign || TEXT_BLOCK.has(tag) || VERBATIM.has(tag) || mark !== ctx.mark) {
      flush(cur);
      cur = openRun(mark + ctx.inl, verbatim);
      leave = () => {
        flush(cur);
        cur = openRun(ctx.mark + ctx.inl, ctx.verbatim);
      };
    } else if (tag === "br") {
      cur.flow.push(" ");
      cur.shape.push(BR_SHAPE);
      cur.shaped = true;
    } else if (NEUTRAL_INLINE.has(tag)) {
      cur.shape.push(`‹${tag}›`);
      cur.shaped = true;
      leave = () => cur.shape.push(`‹/${tag}›`);
    } else if (!TRANSPARENT.has(tag)) {
      cur.flow.push(`‹${tag}›`);
      cur.shape.push(`‹${tag}›`);
      if (!VOID.has(tag)) {
        inl = `${ctx.inl} [in:${tag}]`;
        leave = () => {
          cur.flow.push(`‹/${tag}›`);
          cur.shape.push(`‹/${tag}›`);
        };
      }
    }

    if (tag === "script") {
      if ("src" in a) {
        page.scripts.push(`<script${attrsText(node)}>`);
        page.srcs.push(a.src);
      } else {
        const body = cleanChildren(node)
          .map((k) => k.value ?? "")
          .join("");
        page.inline.push(body.replace(/\r\n?/g, "\n")); // canon과 같이 줄바꿈만 정규화한다
        page.inlineBytes += Buffer.byteLength(body);
        for (const c of jsClassRefs(body)) refs.add(c);
        for (const m of body.match(TW_DARK_TEXT) ?? []) page.twDark.push(`script ${m}`);
      }
      if ((a.type ?? "").trim().toLowerCase() === "application/ld+json") page.ldJson++;
      leave();
      return;
    }
    if (tag === "style") {
      leave();
      return;
    }
    if (ctx.inBody && HEADINGS.has(tag)) page.headings.push(`${tag} ${JSON.stringify(textOf(node))}${mark}`);
    const isLink = tag === "a" && "href" in a;
    if (isLink) {
      if (ctx.inBody) bodyLinks++;
      page.hrefs.push(a.href);
      page.links.push(`href=${JSON.stringify(a.href)} rel=${JSON.stringify(a.rel ?? null)} target=${JSON.stringify(a.target ?? null)} 글자=${JSON.stringify(textOf(node))}`);
    }
    if (isSkip) skips.push({ tag, href: a.href ?? null, nth: isLink && ctx.inBody ? bodyLinks : null });
    const next = { mark, inl, verbatim, foreign, inHead: ctx.inHead || tag === "head", inBody: ctx.inBody || tag === "body" };
    for (const kid of cleanChildren(node)) {
      if (kid.nodeName === "#text") {
        if (!next.inBody) continue;
        cur.flow.push(kid.value);
        cur.shape.push(kid.value);
        if (verbatim ? kid.value !== "" : norm(kid.value) !== "") cur.text = true;
      } else if (kid.tagName) visit(kid, next);
    }
    leave();
  };

  for (const child of parse(html).childNodes) {
    if (child.tagName) visit(child, { mark: "", inl: "", verbatim: false, foreign: false, inHead: false, inBody: false });
  }
  flush(cur);
  page.jsRefs = [...refs].sort();
  // 건너뛰기 링크: href, 그 대상(#main이 가리키는 요소가 있는지·무엇인지), 본문 링크 중 몇 번째인지.
  page.skip = skips.map((s) => {
    const target = s.href?.startsWith("#") ? (idTag[s.href.slice(1)] ? `<${idTag[s.href.slice(1)]} id=${s.href.slice(1)}>` : "대상 없음") : "조각 링크 아님";
    return `${s.tag}.${SKIP_LINK_CLASS} href=${JSON.stringify(s.href)} → ${target}, ${s.nth === null ? "본문 링크가 아님" : `본문 링크 중 ${s.nth}번째`}`;
  });
  return page;
}

/**
 * 장(file)에서 본 주소(url)를 폴더 안 상대 경로로 푼다. 바깥 주소·조각(#)·mailto 따위는 null.
 * `./`·`../`·SITE_BASE로 시작하는 절대 주소를 풀고, 쿼리·조각은 뗀다. 폴더로 끝나면 index.html.
 */
export function resolveInternal(file, url, siteBase = SITE_BASE) {
  let u = url.trim();
  if (u === "" || u.startsWith("#")) return null;
  let base = path.posix.dirname(file);
  if (u.startsWith(siteBase)) {
    u = u.slice(siteBase.length);
    base = ".";
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u) || u.startsWith("//")) return null;
  else if (u.startsWith("/")) {
    // 사이트 절대 경로: Pages의 /jipgye/ 아래만 이 폴더다.
    const root = new URL(siteBase).pathname;
    if (!u.startsWith(root)) return null;
    u = u.slice(root.length);
    base = ".";
  }
  u = u.replace(/[?#].*$/, "");
  try {
    u = decodeURIComponent(u);
  } catch {
    /* 깨진 % 표기는 원문 그대로 찾는다 */
  }
  let rel = path.posix.normalize(path.posix.join(base, u));
  if (u === "" || u.endsWith("/")) rel = path.posix.join(rel, "index.html");
  return rel.startsWith("..") ? null : rel;
}

const isHtml = (f) => f.endsWith(".html");
const isJs = (f) => f.endsWith(".js") || f.endsWith(".mjs");

/**
 * 폴더 하나의 스냅숏. pages(.html마다 extractPage), files(모든 파일 경로 — 내부 링크 대상 확인용),
 * jsBytes(.js와 script src가 가리키는 파일의 바이트), jsHooks(폴더의 JS가 읽는 class), twDarkFiles(.js·.css 안의 tw:dark:).
 */
export async function snapshotDir(dir, { label = dir } = {}) {
  const files = await listFiles(dir);
  const pages = {};
  const hooks = new Set();
  const jsBytes = {};
  const twDarkFiles = [];
  for (const file of files) {
    if (isHtml(file)) {
      const page = extractPage(await readFile(path.join(dir, file), "utf8"));
      for (const c of page.jsRefs) hooks.add(c);
      delete page.jsRefs;
      pages[file] = page;
    } else if (isJs(file) || file.endsWith(".css")) {
      const text = await readFile(path.join(dir, file), "utf8");
      if (isJs(file)) {
        jsBytes[file] = Buffer.byteLength(text);
        for (const c of jsClassRefs(text)) hooks.add(c);
      }
      for (const m of new Set(text.match(TW_DARK_TEXT) ?? [])) twDarkFiles.push(`${file}: ${m}`);
    }
  }
  // script src가 .js가 아닌 이름을 가리켜도 바이트를 센다.
  for (const [file, page] of Object.entries(pages)) {
    for (const src of page.srcs) {
      const rel = resolveInternal(file, src);
      if (rel && !(rel in jsBytes) && files.includes(rel)) jsBytes[rel] = (await stat(path.join(dir, rel))).size;
    }
  }
  return { version: SNAPSHOT_VERSION, label, files, jsBytes, jsHooks: [...hooks].sort(), twDarkFiles, pages };
}

/** 폴더 경로나 스냅숏 JSON 경로를 스냅숏으로 읽는다. */
export async function loadSnapshot(input) {
  if ((await stat(input)).isDirectory()) return snapshotDir(input);
  const snap = JSON.parse(await readFile(input, "utf8"));
  if (snap.version !== SNAPSHOT_VERSION) throw new Error(`스냅숏 version이 ${SNAPSHOT_VERSION}이 아닙니다: ${input}`);
  return snap;
}

/** 스냅숏의 지문. label(경로)은 빼고 센다 — 같은 내용이면 어디서 떠도 같다. */
export function snapshotHash(snap) {
  return createHash("sha256").update(JSON.stringify({ ...snap, label: undefined })).digest("hex");
}

/**
 * 저장소 소스에서 훅 클래스를 뽑는다(#274 범위 1 "훅 클래스 목록은 기계로 뽑는다").
 *   js     — docs/ 아래 .js와 docs/*.html의 인라인 script가 선택자·classList·className으로 읽는 class(jsClassRefs).
 *   markup — test/*.mjs와 scripts/build-*-pages.mjs가 문자열로 쓰는 class="…"(markupClassRefs).
 * 읽는 것은 전부 코드다(인라인 script도 틀에서 온 코드). 그날의 데이터에 따라 갈리지 않게 구운 HTML의 class 속성은 읽지 않는다 —
 * 예컨대 low-sample은 표본이 모자란 날에만 구운 HTML에 나온다(#8 부류를 피한다).
 */
export async function collectHookClasses(repo) {
  const js = new Set();
  const markup = new Set();
  const docs = path.join(repo, "docs");
  for (const file of await listFiles(docs, (f) => isJs(f) || isHtml(f))) {
    const text = await readFile(path.join(docs, file), "utf8");
    for (const c of isHtml(file) ? extractPage(text).jsRefs : jsClassRefs(text)) js.add(c);
  }
  const sources = [
    ...(await readdir(path.join(repo, "test"))).filter((f) => f.endsWith(".mjs")).map((f) => path.join(repo, "test", f)),
    ...(await readdir(path.join(repo, "scripts"))).filter((f) => /^build-.*-pages\.mjs$/.test(f)).map((f) => path.join(repo, "scripts", f)),
  ];
  for (const file of sources.sort()) for (const c of markupClassRefs(await readFile(file, "utf8"))) markup.add(c);
  return { js: [...js].sort(), markup: [...markup].sort() };
}

/** 목록 파일을 읽는다. 반환: { js, markup, all }. */
export async function readHookList(file = HOOK_LIST_FILE) {
  const { js, markup } = JSON.parse(await readFile(file, "utf8"));
  return { js, markup, all: [...new Set([...js, ...markup])].sort() };
}

/** 목록 파일에 쓸 내용(끝에 줄바꿈). 이름을 한 줄에 하나씩 적어 diff가 읽히게 한다. */
export function formatHookList({ js, markup }) {
  return `${JSON.stringify(
    {
      "//": "기계로 뽑은 훅 클래스 목록(#274). 손으로 고치지 않는다 — `node bin/invariants.mjs --hooks-write --repo ../..`로 다시 만든다.",
      sources: {
        js: "docs/ 아래 .js와 docs/*.html 인라인 script의 querySelector(All)·closest·matches·getElementsByClassName·classList·className",
        markup: 'test/*.mjs와 scripts/build-*-pages.mjs가 문자열로 쓰는 class="…"',
      },
      js,
      markup,
    },
    null,
    2
  )}\n`;
}

/** 목록(list)과 소스에서 뽑은 것(collected)의 어긋남. 둘 다 비면 맞는 것이다. missing은 소스에만, stale은 목록에만 있는 이름. */
export function hookListDrift(list, collected) {
  const missing = [];
  const stale = [];
  for (const kind of ["js", "markup"]) {
    const inList = new Set(list[kind]);
    const inSource = new Set(collected[kind]);
    missing.push(...collected[kind].filter((c) => !inList.has(c)).map((c) => `${kind}: ${c}`));
    stale.push(...list[kind].filter((c) => !inSource.has(c)).map((c) => `${kind}: ${c}`));
  }
  return { missing, stale, ok: missing.length === 0 && stale.length === 0 };
}

/** 다중집합 차이. missing은 a에만(또는 더 많이) 있는 것, added는 b에만 있는 것. 같은 값이 여럿이면 ` ×n`을 붙인다. */
export function bagDiff(a, b) {
  const count = new Map();
  for (const x of a) count.set(x, (count.get(x) ?? 0) + 1);
  for (const x of b) count.set(x, (count.get(x) ?? 0) - 1);
  const missing = [];
  const added = [];
  for (const [x, n] of count) {
    if (n > 0) missing.push(n > 1 ? `${x} ×${n}` : x);
    else if (n < 0) added.push(n < -1 ? `${x} ×${-n}` : x);
  }
  return { missing, added };
}

const isSubsequence = (short, long) => {
  let i = 0;
  for (const x of long) if (i < short.length && short[i] === x) i++;
  return i === short.length;
};

function pageScriptBytes(file, page, snap, siteBase) {
  let bytes = 0;
  const missing = [];
  for (const src of page.srcs) {
    const rel = resolveInternal(file, src, siteBase);
    if (rel === null) continue; // 바깥 스크립트는 바이트를 못 센다 — 목록(s6-scripts)으로만 본다
    if (rel in snap.jsBytes) bytes += snap.jsBytes[rel];
    else missing.push(src);
  }
  return { bytes, missing };
}

/** 주소 목록(urls) 가운데 폴더 안을 가리키는데 그 파일이 없는 것. */
const dangling = (file, urls, snap, siteBase) => {
  const files = new Set(snap.files);
  return urls.filter((h) => {
    const rel = resolveInternal(file, h, siteBase);
    return rel !== null && !files.has(rel);
  });
};
/** 기준에서도 없던 것은 빼고, 후보에서 새로 대상이 사라진 주소만. */
const newlyDangling = (file, urlsA, urlsB, snapA, snapB, siteBase) => {
  const was = new Set(dangling(file, urlsA, snapA, siteBase));
  return [...new Set(dangling(file, urlsB, snapB, siteBase).filter((h) => !was.has(h)))];
};

const TEXT_ITEM = /^(".*")((?: \[[^\] ]+\])*)$/s;
/** texts 항목(`"글자 흐름" [표시]`)에서 글자 흐름만. */
const flowOf = (item) => JSON.parse(TEXT_ITEM.exec(item)[1]);
const NEUTRAL_MARK = new RegExp(`‹/?(?:${[...NEUTRAL_INLINE].join("|")})›`, "g");
/**
 * 블록 모양(shape)에서 텍스트 노드가 잘린 자리만 남긴다: 중립 인라인의 여닫는 자리를 `┊`로 바꾸고 겹친 것·양끝의 것을 지운다.
 * 노드 전체를 감싼 것(`‹span›글자‹/span›`)이나 strong → span은 잘린 자리가 같으므로 같은 키다(보고하지 않는다).
 */
function cutKey(shape) {
  return shape
    .replace(NEUTRAL_MARK, CUT)
    .replace(new RegExp(`[ ${CUT}]*${CUT}[ ${CUT}]*`, "g"), (m) => (m.includes(" ") ? ` ${CUT}` : CUT))
    .replace(new RegExp(` *${BR_SHAPE} *`, "g"), BR_SHAPE)
    .replace(new RegExp(`^[ ${CUT}]+|[ ${CUT}]+$`, "g"), "");
}

/**
 * 글자 흐름이 같은 블록끼리 모양을 견준다(#289 4번의 소프트 쪽). 반환: 인라인 경계만 다른 블록 쌍 [{ a, b }] — a·b는 보고에 적을 모양 문자열이다.
 * 같은 흐름이 여럿이면(표의 같은 숫자) 모양이 같은 것끼리 먼저 지우고 남은 것을 문서 순서로 짝짓는다.
 */
function wrapDiffs(a, b) {
  if (!a.shapes.some(Boolean) && !b.shapes.some(Boolean)) return [];
  const group = (page) => {
    const by = new Map();
    page.texts.forEach((item, i) => {
      if (!by.has(item)) by.set(item, []);
      by.get(item).push(page.shapes[i] || flowOf(item));
    });
    return by;
  };
  const [ga, gb] = [group(a), group(b)];
  const out = [];
  for (const [item, shapesA] of ga) {
    const shapesB = gb.get(item);
    if (!shapesB) continue; // 흐름이 다른 블록은 text(하드)가 적는다
    const mark = TEXT_ITEM.exec(item)[2];
    const restB = shapesB.map((s) => ({ s, key: cutKey(s), used: false }));
    const restA = [];
    for (const s of shapesA) {
      const key = cutKey(s);
      const same = restB.find((x) => !x.used && x.key === key);
      if (same) same.used = true;
      else restA.push(s);
    }
    const left = restB.filter((x) => !x.used);
    for (let i = 0; i < Math.min(restA.length, left.length); i++) out.push({ a: `${JSON.stringify(restA[i])}${mark}`, b: `${JSON.stringify(left[i].s)}${mark}` });
  }
  return out;
}

/** 한 장의 기준(a)·후보(b)를 견준다. 반환: findings [{ id, check, level: "hard"|"soft", missing, added, note? }]. */
export function comparePage(file, a, b, { snapA, snapB, hooks, siteBase = SITE_BASE }) {
  const out = [];
  const push = (id, check, level, missing, added, note) => {
    if (missing.length || added.length || note) out.push({ id, check, level, missing, added, ...(note ? { note } : {}) });
  };
  const bag = (id, check, level, x, y) => {
    const d = bagDiff(x, y);
    push(id, check, level, d.missing, d.added);
  };

  // robots 메타 전부를 다중집합으로 견준다. 한쪽에 하나도 없으면 "(robots 없음)"으로 적는다.
  const robots = bagDiff(a.robots, b.robots);
  if (robots.missing.length || robots.added.length) {
    const side = (list, all) => (list.length ? list : all.length ? [] : ["(robots 없음)"]);
    push("noindex", "noindex(meta robots)", "hard", side(robots.missing, a.robots), side(robots.added, b.robots));
  }
  bag("body-meta", "body 안의 meta·base", "hard", a.bodyMeta, b.bodyMeta);
  bag("head", "head(title·meta·link)", "hard", a.head, b.head);
  bag("head-exception", "head 허용 예외(값이 다르다)", "soft", a.exceptions, b.exceptions);
  if (a.ldJson !== b.ldJson) push("ld-json", "구조화 데이터(ld+json 개수)", "hard", [`${a.ldJson}개`], [`${b.ldJson}개`]);

  // 본문 텍스트: 블록 단위 글자 흐름의 다중집합. 글자·공백·뜻 있는 인라인 태그·블록 경계·숨김 표시가 전부 항목 안에 있다.
  const text = bagDiff(a.texts, b.texts);
  if (text.missing.length || text.added.length) {
    // 공백을 뺀 글자가 같으면 공백이나 블록 경계가 달라진 것이다 — 판정은 그대로 하드, 읽는 사람에게만 알린다.
    const chars = (t) => t.map(flowOf).join("").replace(/\s+/g, "");
    push("text", "본문 텍스트(다중집합)", "hard", text.missing, text.added, chars(a.texts) === chars(b.texts) ? "글자는 같고 블록 안 공백이나 블록 경계가 달라졌다(공백 추가·삭제, 블록 나눔·합침)" : undefined);
  } else if (a.texts.join("\n") !== b.texts.join("\n")) {
    const hunks = diffLines(a.texts, b.texts);
    push("text-order", "텍스트 순서", "soft", hunks.flatMap((h) => h.removed.map((t, i) => `A ${h.aStart + i + 1}번째: ${t}`)), hunks.flatMap((h) => h.added.map((t, i) => `B ${h.bStart + i + 1}번째: ${t}`)));
  }
  // 글자 흐름은 같고 텍스트 노드가 다르게 잘린 블록(중립 인라인으로 일부를 감싸거나 풀었다, br을 넣었다): 통과시키되 무엇이 감싸졌는지와 수를 낸다.
  const wraps = wrapDiffs(a, b);
  if (wraps.length) {
    const count = (list, re) => list.reduce((n, s) => n + (s.match(re) ?? []).length, 0);
    const opens = new RegExp(`‹(?:${[...NEUTRAL_INLINE].join("|")})›`, "g");
    const brs = new RegExp(BR_SHAPE, "g");
    const [wa, wb] = [wraps.map((w) => w.a), wraps.map((w) => w.b)];
    push("text-wrap", "텍스트 노드 경계(글자·공백은 같고 중립 인라인 래퍼·br만 다르다)", "soft", wa, wb, `블록 ${wraps.length}개 — 래퍼 ${count(wa, opens)}→${count(wb, opens)}개, br ${count(wa, brs)}→${count(wb, brs)}개`);
  }
  bag("details-open", "details 접힘·펼침(open) — 본문을 접거나 펴는 변화, po가 반드시 읽는다", "soft", a.details, b.details);

  bag("attr-text", "속성 글자(title·alt·placeholder·lang·aria-label·data-label …)", "hard", a.textAttrs, b.textAttrs);
  bag("links", "링크(a[href]·rel·target·글자)", "hard", a.links, b.links);
  push("link-target", "내부 링크 대상 없음", "hard", [], newlyDangling(file, a.hrefs, b.hrefs, snapA, snapB, siteBase));
  push("resource-target", "참조 자원 대상 없음(link[href]·[src]·poster·srcset)", "hard", [], newlyDangling(file, a.resources, b.resources, snapA, snapB, siteBase));

  if (a.headings.join("\n") !== b.headings.join("\n")) {
    const hunks = diffLines(a.headings, b.headings);
    push("headings", "제목 계층(h1~h6 순서)", "hard", hunks.flatMap((h) => h.removed), hunks.flatMap((h) => h.added));
  }

  const marks = bagDiff(a.landmarks, b.landmarks);
  const skipDiff = a.skip.join("\n") !== b.skip.join("\n");
  push("landmarks", "랜드마크(main·nav 개수, 건너뛰기 링크)", "hard", [...marks.missing, ...(skipDiff ? a.skip : [])], [...marks.added, ...(skipDiff ? (b.skip.length ? b.skip : [`(.${SKIP_LINK_CLASS} 없음)`]) : [])]);

  // 훅: 기준에 있던 것이 사라지면 하드, 늘어난 것은 소프트(PR에 목록으로 적는다).
  const hookMissing = [];
  const hookAdded = [];
  for (const [kind, x, y] of [["id", a.ids, b.ids], ["data", a.data, b.data], ["aria", a.aria, b.aria]]) {
    const d = bagDiff(x, y);
    hookMissing.push(...d.missing.map((m) => (kind === "id" ? `id=${JSON.stringify(m)}` : m)));
    hookAdded.push(...d.added.map((m) => (kind === "id" ? `id=${JSON.stringify(m)}` : m)));
  }
  for (const h of hooks) {
    const n = (a.classes[h] ?? 0) - (b.classes[h] ?? 0);
    if (n > 0) hookMissing.push(n > 1 ? `class~=${h} ×${n}` : `class~=${h}`);
    else if (n < 0) hookAdded.push(n < -1 ? `class~=${h} ×${-n}` : `class~=${h}`);
  }
  push("hooks", "JS 훅(id·data-*·aria-*·훅 클래스)", "hard", hookMissing, []);
  push("hooks-added", "JS 훅이 늘었다", "soft", [], hookAdded);

  // 인라인 script 본문·순서. 바이트 합만 보면 크기가 같거나 준 문구 변경(한·영 문자열표)이 지나간다.
  if (a.inline.join("\u0000") !== b.inline.join("\u0000")) {
    const lines = (list) => list.flatMap((body, i) => [`── 인라인 script ${i + 1}/${list.length} ──`, ...body.split("\n")]);
    const hunks = diffLines(lines(a.inline), lines(b.inline));
    push("inline-script", "인라인 script 본문·순서", "hard", hunks.flatMap((h) => h.removed.map((l, i) => `${h.aStart + i + 1}: ${l}`)), hunks.flatMap((h) => h.added.map((l, i) => `${h.bStart + i + 1}: ${l}`)));
  }

  // S6
  if (!isSubsequence(b.scripts, a.scripts)) {
    const d = bagDiff(a.scripts, b.scripts);
    push("s6-scripts", "S6 script 목록(늘거나 바뀜)", "hard", d.missing, d.added, d.missing.length || d.added.length ? undefined : "script 순서가 바뀌었다");
  } else if (b.scripts.length < a.scripts.length) {
    push("scripts-removed", "script가 줄었다", "soft", bagDiff(a.scripts, b.scripts).missing, []);
  }
  if (b.inlineBytes > a.inlineBytes) push("s6-inline-bytes", "S6 인라인 script 바이트", "hard", [`${a.inlineBytes}B`], [`${b.inlineBytes}B (+${b.inlineBytes - a.inlineBytes})`]);
  const extA = pageScriptBytes(file, a, snapA, siteBase);
  const extB = pageScriptBytes(file, b, snapB, siteBase);
  if (extB.bytes > extA.bytes) push("s6-external-bytes", "S6 외부 JS 바이트", "hard", [`${extA.bytes}B`], [`${extB.bytes}B (+${extB.bytes - extA.bytes})`]);
  push("s6-src-missing", "S6 script src 대상 없음", "hard", [], extB.missing.filter((s) => !extA.missing.includes(s)));
  // 인라인 이벤트 핸들러: 새로 생기거나 값이 바뀌면(= 후보에만 있는 것이 있으면) 하드, 줄기만 하면 소프트.
  const handlers = bagDiff(a.handlers, b.handlers);
  if (handlers.added.length) push("s6-handlers", "S6 인라인 이벤트 핸들러 속성(on*)이 생기거나 바뀜", "hard", handlers.missing, handlers.added);
  else push("handlers-removed", "인라인 이벤트 핸들러 속성(on*)이 줄었다", "soft", handlers.missing, []);

  push("tw-dark", "tw:dark: 변형", "hard", [], [...new Set(b.twDark)]);
  bag("semantic", "의미 속성(role·hidden·name·for·scope …)", "soft", a.semantic, b.semantic);
  return out;
}

const summarize = (pages, site) => {
  const status = (p) => (p.status === "onlyA" || p.status === "onlyB" ? p.status : p.findings.some((f) => f.level === "hard") ? "hard" : p.findings.length ? "soft" : "pass");
  for (const p of pages) p.status = status(p);
  const count = (s) => pages.filter((p) => p.status === s).length;
  const hard = pages.filter((p) => p.status !== "pass" && p.status !== "soft").length;
  return { total: pages.length, pass: count("pass"), soft: count("soft"), hard, ok: hard === 0 && site.every((f) => f.level !== "hard"), failing: pages.filter((p) => p.status !== "pass") };
};

/**
 * 스냅숏 둘을 견준다. hookList는 목록 파일의 훅 클래스(readHookList().all), extraHooks는 그 밖에 보탤 이름이다.
 * 후보 폴더의 JS가 읽는 class(snapB.jsHooks)는 늘 더한다.
 * 반환: { total, pass, soft, hard, ok, pages:[{file,status,findings}], site:[findings], failing, noindexA, noindexB, hooks, … }
 * status는 pass | soft | hard | onlyA | onlyB (onlyA·onlyB는 URL 집합 하드 실패다).
 */
export function compareSnapshots(snapA, snapB, { hookList = [], extraHooks = [], siteBase = SITE_BASE } = {}) {
  const hooks = [...new Set([...hookList, ...snapB.jsHooks, ...extraHooks])].sort();
  const all = [...new Set([...Object.keys(snapA.pages), ...Object.keys(snapB.pages)])].sort();
  const pages = all.map((file) => {
    const a = snapA.pages[file];
    const b = snapB.pages[file];
    if (!b) return { file, status: "onlyA", findings: [] };
    if (!a) return { file, status: "onlyB", findings: [] };
    return { file, status: "pass", findings: comparePage(file, a, b, { snapA, snapB, hooks, siteBase }) };
  });

  const site = [];
  const onlyA = pages.filter((p) => p.status === "onlyA").map((p) => p.file);
  const onlyB = pages.filter((p) => p.status === "onlyB").map((p) => p.file);
  if (onlyA.length || onlyB.length) site.push({ id: "url-set", check: "URL 집합(.html 파일)", level: "hard", missing: onlyA, added: onlyB });
  const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);
  const jsTotalA = sum(snapA.jsBytes);
  const jsTotalB = sum(snapB.jsBytes);
  if (jsTotalB > jsTotalA) {
    const names = [...new Set([...Object.keys(snapA.jsBytes), ...Object.keys(snapB.jsBytes)])].sort().filter((f) => snapA.jsBytes[f] !== snapB.jsBytes[f]);
    site.push({ id: "s6-js-total", check: "S6 폴더 안 JS 바이트 합", level: "hard", missing: [`${jsTotalA}B`], added: [`${jsTotalB}B (+${jsTotalB - jsTotalA})`, ...names.map((f) => `${f}: ${snapA.jsBytes[f] ?? "없음"} → ${snapB.jsBytes[f] ?? "없음"}`)] });
  }
  if (snapB.twDarkFiles.length) site.push({ id: "tw-dark", check: "tw:dark: 변형(.js·.css)", level: "hard", missing: [], added: snapB.twDarkFiles });
  // 폴더에서 사라진 파일(.html은 url-set이 본다). HTML이 속성으로 가리키는 것은 resource-target·link-target·s6-src-missing이 하드로 잡고,
  // JS가 fetch로 읽는 data/ 따위는 이 도구가 참조를 못 읽으므로 목록만 낸다.
  const filesB = new Set(snapB.files);
  const gone = snapA.files.filter((f) => !isHtml(f) && !filesB.has(f));
  if (gone.length) site.push({ id: "files-removed", check: "폴더에서 사라진 파일(.html 밖)", level: "soft", missing: gone, added: [] });

  // 메타가 여럿이면 하나라도 noindex(또는 같은 뜻의 none)면 그 장은 색인되지 않는다.
  const noindex = (snap) => Object.entries(snap.pages).filter(([, p]) => p.robots.some((r) => /\b(?:noindex|none)\b/i.test(r))).map(([f]) => f).sort();
  return {
    labelA: snapA.label,
    labelB: snapB.label,
    ...summarize(pages, site),
    pages,
    site,
    noindexA: noindex(snapA),
    noindexB: noindex(snapB),
    countA: Object.keys(snapA.pages).length,
    countB: Object.keys(snapB.pages).length,
    hooks,
    hooksFromList: hookList.length,
    jsTotalA,
    jsTotalB,
    excused: [],
    unusedExceptions: [],
  };
}

/** 폴더 장 이름 대신 쓰는 이름: 폴더 단위 항목(url-set·s6-js-total·tw-dark)의 예외는 page에 이것을 적는다. */
export const SITE_PAGE = "(폴더)";

/**
 * 훅 클래스 목록의 상태를 폴더 단위 소프트 항목으로 만든다(#289 5번 — `--render` 보고에 같이 낸다).
 *   hook-list          목록 파일(list)이 후보 소스에서 뽑은 것(head)과 어긋난다. missing은 목록에만, added는 소스에만 있는 이름.
 *   hook-list-dropped  기준 소스(base)에서는 훅이었는데 후보 소스에서는 아닌 이름. 후보가 선택자·시험 문자열을 지우면 그 class는
 *                      더는 훅으로 보지 않으므로(HTML에서 빠져도 hooks가 안 건다) 사람이 목록으로 읽어야 한다.
 * list·base·head는 { js, markup }이다. base를 안 주면 hook-list만 본다.
 */
export function hookListFindings({ list, head, base = null }) {
  const out = [];
  const drift = hookListDrift(list, head);
  if (!drift.ok) out.push({ id: "hook-list", check: "훅 클래스 목록(hook-classes.json)이 후보 소스와 어긋났다(- 목록에만, + 소스에만) — --hooks-write로 다시 만든다", level: "soft", missing: drift.stale, added: drift.missing });
  if (base) {
    const now = new Set([...head.js, ...head.markup]);
    const dropped = [...new Set([...base.js, ...base.markup])].filter((c) => !now.has(c)).sort();
    if (dropped.length) out.push({ id: "hook-list-dropped", check: "기준 소스에서는 훅이었고 후보 소스에서는 아닌 class(더는 훅으로 보지 않는다)", level: "soft", missing: dropped, added: [] });
  }
  return out;
}

/** 폴더 단위 항목을 결과에 보탠다(예외 목록을 적용하기 전에 부른다). */
export function withSiteFindings(result, findings) {
  const site = [...result.site, ...findings];
  return { ...result, ...summarize(result.pages, site), site };
}

/**
 * 의도한 차이(예외 목록)를 결과에 적용한다. 목록 한 줄은
 *   { page: "index.html" | "*", check: "<check 이름>", missing?: [항목…], added?: [항목…], reason: "…", confirmedBy: "…" }
 * 이고 reason·confirmedBy(po·cmo가 확인한 댓글 주소)가 비면 던진다. 항목은 보고서(--json)의 문자열과 **글자 그대로** 같아야 하고,
 * 맞은 항목만 하드에서 빠진다(한 줄이 한 장에서 같은 항목 하나를 지운다) — 목록에 없는 차이는 그대로 하드다.
 * 지워진 항목은 excused에, 한 번도 쓰이지 않은 줄은 unusedExceptions에 남는다(목록이 낡았다는 뜻이라 보고서에 적는다).
 */
export function applyExceptions(result, exceptions) {
  exceptions.forEach((e, i) => {
    for (const key of ["page", "check", "reason", "confirmedBy"]) {
      if (typeof e[key] !== "string" || e[key].trim() === "") throw new Error(`예외 목록 ${i + 1}번째 줄에 ${key}가 없습니다`);
    }
    if (!(e.missing?.length || e.added?.length)) throw new Error(`예외 목록 ${i + 1}번째 줄에 missing·added 항목이 없습니다(check 통째로는 예외가 되지 않습니다)`);
  });
  const used = new Set();
  const excused = [];
  const strip = (file, f) => {
    if (f.level !== "hard") return f;
    const out = { ...f, missing: [...f.missing], added: [...f.added] };
    exceptions.forEach((e, i) => {
      if (e.check !== f.id || (e.page !== "*" && e.page !== file)) return;
      for (const side of ["missing", "added"]) {
        for (const item of e[side] ?? []) {
          const at = out[side].indexOf(item);
          if (at < 0) continue;
          out[side].splice(at, 1);
          used.add(i);
          excused.push({ file, id: f.id, check: f.check, side, item, reason: e.reason, confirmedBy: e.confirmedBy });
        }
      }
    });
    return out;
  };
  const keep = (f) => f.missing.length || f.added.length || f.note;
  const pages = result.pages.map((p) => ({ ...p, findings: p.findings.map((f) => strip(p.file, f)).filter(keep) }));
  const site = result.site.map((f) => strip(SITE_PAGE, f)).filter(keep);
  return { ...result, ...summarize(pages, site), pages, site, excused, unusedExceptions: exceptions.filter((_, i) => !used.has(i)) };
}

/** 폴더(또는 스냅숏 JSON) 둘을 견준다. hookList를 안 주면 목록 파일을 읽는다. */
export async function compareInvariants(inputA, inputB, opts = {}) {
  const [a, b] = await Promise.all([loadSnapshot(inputA), loadSnapshot(inputB)]);
  return compareSnapshots(a, b, { hookList: (await readHookList()).all, ...opts });
}

/**
 * HTML 문자열 둘을 한 장으로 견준다(변이 시험용). jsA·jsB는 { "nav.js": "…" }처럼 그 장이 싣는 외부 JS의 내용이다.
 * 고정 사본 한 장만 견주므로 내부 링크·참조 자원의 대상은 전부 "있는 파일"로 친다(대상 확인은 폴더 비교에서 한다).
 */
export function compareHtmlInvariants(htmlA, htmlB, { file = "page.html", jsA = {}, jsB = jsA, hookList = [], extraHooks = [] } = {}) {
  const snap = (html, js, label) => {
    const page = extractPage(html);
    const hooks = new Set(page.jsRefs);
    delete page.jsRefs;
    const twDarkFiles = [];
    for (const [name, text] of Object.entries(js)) {
      for (const c of jsClassRefs(text)) hooks.add(c);
      for (const m of new Set(text.match(TW_DARK_TEXT) ?? [])) twDarkFiles.push(`${name}: ${m}`);
    }
    const files = [file, ...Object.keys(js), ...[...page.hrefs, ...page.resources].map((h) => resolveInternal(file, h)).filter(Boolean)];
    return { version: SNAPSHOT_VERSION, label, files, jsBytes: Object.fromEntries(Object.entries(js).map(([k, v]) => [k, Buffer.byteLength(v)])), jsHooks: [...hooks].sort(), twDarkFiles, pages: { [file]: page } };
  };
  const [a, b] = [snap(htmlA, jsA, "A"), snap(htmlB, jsB, "B")];
  // 한 장만 견주므로 "어느 쪽에든 이름이 나온 파일"은 양쪽에 다 있는 것으로 친다(대상 확인·사라진 파일은 폴더 비교의 일이다).
  a.files = b.files = [...new Set([...a.files, ...b.files])].sort();
  return compareSnapshots(a, b, { hookList, extraHooks });
}

const clip = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…(${s.length}자)` : s);
const num = (n) => n.toLocaleString("en-US");

function findingLines(f, maxItems, pad) {
  const lines = [`${pad}[${f.level === "hard" ? "하드" : "소프트"}] ${f.check} <${f.id}>: 기준에만 ${f.missing.length}, 후보에만 ${f.added.length}${f.note ? ` — ${f.note}` : ""}`];
  for (const m of f.missing.slice(0, maxItems)) lines.push(`${pad}  - ${clip(m)}`);
  if (f.missing.length > maxItems) lines.push(`${pad}  - …외 ${f.missing.length - maxItems}개`);
  for (const m of f.added.slice(0, maxItems)) lines.push(`${pad}  + ${clip(m)}`);
  if (f.added.length > maxItems) lines.push(`${pad}  + …외 ${f.added.length - maxItems}개`);
  return lines;
}

/** 사람이 읽는 보고. 폴더 단위·하드 실패를 먼저, 소프트를 뒤에, 예외로 지운 것을 끝에 적는다. */
export function formatInvariantsReport(r, { maxItems = 8 } = {}) {
  const same = (x, y) => (x.join("\n") === y.join("\n") ? "같음" : "다름");
  const lines = [
    `불변 비교(invariants): ${r.total}장 — 통과 ${r.pass}, 소프트만 ${r.soft}, 하드 실패 ${r.hard}${r.site.length ? `, 폴더 단위 ${r.site.length}건` : ""} → ${r.ok ? "통과" : "실패"}`,
    `  기준 A: ${r.labelA}`,
    `  후보 B: ${r.labelB}`,
    `  URL 집합: A ${r.countA}장 / B ${r.countB}장`,
    `  noindex 집합: A ${r.noindexA.length}장 / B ${r.noindexB.length}장 (${same(r.noindexA, r.noindexB)}) ${r.noindexB.join(", ")}`,
    `  폴더 안 JS 바이트 합: A ${num(r.jsTotalA)} / B ${num(r.jsTotalB)}`,
    `  훅 클래스 ${r.hooks.length}개(목록 파일 ${r.hooksFromList}개에 후보 JS가 읽는 것과 따로 보탠 것을 더했다)`,
  ];
  const wrapped = r.pages.map((p) => p.findings.find((f) => f.id === "text-wrap")).filter(Boolean);
  if (wrapped.length) lines.push(`  인라인 경계만 다른 블록(text-wrap, 통과): ${wrapped.length}장 ${num(wrapped.reduce((n, f) => n + f.added.length, 0))}개 — 장별 수와 무엇이 감싸졌는지는 아래 소프트 목록`);
  for (const f of r.site) lines.push(...findingLines(f, maxItems, ""));
  const order = { onlyA: 0, onlyB: 0, hard: 1, soft: 2 };
  for (const p of [...r.failing].sort((x, y) => order[x.status] - order[y.status])) {
    if (p.status === "onlyA" || p.status === "onlyB") {
      lines.push(`- ${p.file}: ${p.status === "onlyA" ? "기준에만 있다" : "후보에만 있다"} (하드)`);
      continue;
    }
    lines.push(`- ${p.file}: ${p.status === "hard" ? "하드 실패" : "소프트"}`);
    for (const f of p.findings) lines.push(...findingLines(f, maxItems, "    "));
  }
  if (r.excused.length) {
    lines.push(`의도한 차이로 지운 항목 ${r.excused.length}개(예외 목록):`);
    for (const e of r.excused.slice(0, maxItems * 4)) lines.push(`  ~ ${e.file} <${e.id}> ${e.side === "missing" ? "-" : "+"} ${clip(e.item, 120)} — ${e.reason} (${e.confirmedBy})`);
    if (r.excused.length > maxItems * 4) lines.push(`  ~ …외 ${r.excused.length - maxItems * 4}개`);
  }
  for (const e of r.unusedExceptions) lines.push(`쓰이지 않은 예외(목록이 낡았다): ${e.page} <${e.check}> — ${e.reason}`);
  return lines.join("\n");
}

/** 스냅숏을 장별 표(마크다운)로 편다 — 기준선 기록용(#274 범위 3: 장별 JS 바이트·canonical·noindex). */
export function formatSnapshotTable(snap, { siteBase = SITE_BASE } = {}) {
  const rows = ["| 장 | robots | canonical | 텍스트 블록 | 속성 글자 | a[href] | 제목 | id | script src | 인라인 JS(B) | 외부 JS(B) |", "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"];
  const total = { texts: 0, attrs: 0, links: 0, headings: 0, ids: 0, scripts: 0, inline: 0, ext: 0 };
  for (const [file, p] of Object.entries(snap.pages)) {
    const canonical = p.head.find((l) => l.startsWith("<link") && l.includes('rel="canonical"'))?.match(/href="([^"]*)"/)?.[1] ?? "(없음)";
    const ext = pageScriptBytes(file, p, snap, siteBase).bytes;
    const self = canonical === siteBase + file ? "자기 주소" : canonical;
    rows.push(`| ${file} | ${p.robots.length ? p.robots.join(" / ") : "(없음)"} | ${self} | ${p.texts.length} | ${p.textAttrs.length} | ${p.links.length} | ${p.headings.length} | ${p.ids.length} | ${p.scripts.length} | ${num(p.inlineBytes)} | ${num(ext)} |`);
    total.texts += p.texts.length;
    total.attrs += p.textAttrs.length;
    total.links += p.links.length;
    total.headings += p.headings.length;
    total.ids += p.ids.length;
    total.scripts += p.scripts.length;
    total.inline += p.inlineBytes;
    total.ext += ext;
  }
  rows.push(`| **합계 ${Object.keys(snap.pages).length}장** | | | ${num(total.texts)} | ${num(total.attrs)} | ${num(total.links)} | ${num(total.headings)} | ${num(total.ids)} | ${num(total.scripts)} | ${num(total.inline)} | ${num(total.ext)} |`);
  return rows.join("\n");
}
