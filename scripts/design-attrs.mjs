// 디자인 속성(class·style) 정규화 (#277). 비교를 "내용 비교"로 좁히는 자리는 전부 이 모듈 하나를 쓴다.
//
// 왜. Tailwind 도입(#276)과 디자인 개편(#279~#283)은 조각의 class를 바꾼다. 그런데 legacy↔react parity
// 시험(test/render-parity.test.mjs)과 tools/golden의 정준 덤프(lib/canon.mjs)는 class를 포함한 모든 속성을
// 글자 그대로 견준다 — 조각 JSX에 class를 하나 넣는 순간 둘 다 빨개진다. 그래서 **class와 style 두 속성만**
// 비교에서 뺀다. 지우는 속성 목록은 DESIGN_ATTRS 하나이고, parity 시험과 tools/golden이 같은 목록을 쓴다.
//
// 지우지 않는 것(= DIRECTION.md 369행이 지키는 것). id·data-*·aria-*(JS 훅), href, title·alt·placeholder·
// label·lang·dir 같은 속성 글자, 태그 이름과 트리 모양, 본문 텍스트와 수치, 제목 계층. **셋째 속성을 이 목록에
// 더하는 것은 369행을 깎는 일이므로 cto 판정이 필요하다.**
//
// 의존 0(parse5도 쓰지 않는다). 루트 test/와 tools/golden 양쪽이 import하므로 외부 의존을 들이지 않는다.

/** 비교에서 빼는 속성. 이 목록이 "느슨하게 하는 것"의 전부다. 늘리려면 cto 판정(#277 완료 조건 2-a). */
export const DESIGN_ATTRS = Object.freeze(["class", "style"]);

const DROP = new Set(DESIGN_ATTRS);

// 시작 태그 하나. 속성 자리는 따옴표 안의 `>`를 먹지 않게 따옴표를 먼저 먹는다.
const START_TAG = /<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
// 속성 하나: 앞 공백 + 이름 + (= 값)?. 값은 "…" | '…' | 따옴표 없는 토큰.
const ATTR = /(\s+)([^\s=/>]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
// 본문을 글자 그대로 두는 요소(안의 `<`는 태그가 아니다).
const RAW_TEXT = /<(script|style|textarea|title)(\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi;

/** 시작 태그의 속성 자리에서 class·style을 뺀 문자열을 돌려준다. 모양을 못 읽으면 원문 그대로 둔다. */
function stripFromAttrs(attrs) {
  if (attrs === "") return attrs;
  let rebuilt = "";
  let kept = "";
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(attrs))) {
    rebuilt += m[0];
    if (!DROP.has(m[2].toLowerCase())) kept += m[0];
  }
  // 되짚어 맞지 않으면(모르는 모양) 건드리지 않는다 — 조용히 글자를 지우는 것이 가장 나쁜 실패다.
  if (rebuilt !== attrs) return attrs;
  return kept;
}

/**
 * HTML 문자열(조각이든 한 장이든)에서 class·style 속성만 뺀다.
 * 문자열이 아니면(null·undefined·숫자) 그대로 돌려준다 — 조각이 null을 내는 자리가 있어서다.
 */
export function stripDesignAttrs(html) {
  if (typeof html !== "string") return html;
  // script·style·textarea·title 본문은 떼어 두고(안의 `<`가 태그로 읽히지 않게) 끝에 되붙인다.
  // 자리표시는 본문에 나올 수 없는 NUL로 감싼다(본문의 " 3 " 같은 글자를 자리표시로 잘못 읽지 않게).
  const stash = [];
  const bare = html.replace(RAW_TEXT, (hit) => {
    // 시작 태그 자체는 정규화 대상이다. 본문과 닫는 태그만 그대로 보관한다.
    const open = hit.match(/^<[a-zA-Z][^>]*>/)[0];
    stash.push(hit.slice(open.length));
    return `${open}\u0000${stash.length - 1}\u0000`;
  });
  const out = bare.replace(START_TAG, (whole, tag, attrs, slash) => {
    const kept = stripFromAttrs(attrs);
    return kept === attrs ? whole : `<${tag}${kept}${slash}>`;
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}
