// 구운 HTML의 정준 덤프 (#236 S1의 자). 두 HTML을 DOM으로 파싱해 줄 단위로 펴고, 같은 줄이면 같은 페이지로 본다.
//
// 허용하는 차이(= 정규화)는 다섯뿐이다.
//   1. 주석.
//   2. 속성 순서 (이름순으로 정렬해 덤프한다).
//   3. 엔티티 표기 (&amp; / &#38; / &#x26; — 파서가 풀어 버리므로 자연히 사라진다).
//   4. 본문 텍스트의 공백 "줄이기": 연속 공백을 한 칸으로 줄이고, 브라우저가 어차피 그리지 않는 자리
//      (블록 요소의 시작·끝, 블록 요소와 이웃한 자리)의 공백만 뺀다. 인라인 사이의 공백은 없애지 않는다
//      ("a b"와 "ab"는 다른 페이지다). pre·textarea는 손대지 않는다.
//   5. 인라인 script·style 본문은 줄바꿈(\r\n → \n)만 정규화한다.
//
// 남기는 것(= 어느 하나라도 달라지면 낙제): head의 meta·link·title 전부(robots가 없는 것은 `index, follow`와
// 다르다 — 없음을 따로 채워 넣지 않는다), 숨은(hidden) 조상 아래의 텍스트까지 포함한 본문 텍스트(줄 끝에
// `[hidden]` 표시), 제목 계층, 모든 a[href]의 원문, colspan 같은 표 셀 속성, 모든 속성 값, script src의
// 순서, 인라인 script 본문(JSON 섬 포함, 키 순서도 그대로 — 일부러 파싱해 느슨하게 만들지 않는다).
//
// 의존은 parse5 하나이고 이 폴더의 package.json에만 있다. 루트 test/는 이 모듈을 import하지 않는다.
import { parse } from "parse5";

// 블록 수준(또는 화면에 안 그려지는) 요소. 이 요소의 시작·끝·이웃에서는 공백이 접힌다.
export const BLOCK = new Set(
  (
    "html head body title meta link base style script template noscript address article aside blockquote details dialog " +
    "dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main menu nav ol p pre " +
    "section summary table caption colgroup col thead tbody tfoot tr td th ul br option optgroup select datalist"
  ).split(" ")
);
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const VERBATIM = new Set(["pre", "textarea"]);
const RAW_TEXT = new Set(["script", "style"]);

const WS = /[ \t\n\r\f]+/g;

function childrenOf(node) {
  // <template>의 내용은 content 조각에 들어 있다.
  return node.tagName === "template" && node.content ? node.content.childNodes : node.childNodes ?? [];
}

/** 주석을 빼고 이웃한 텍스트 노드를 이어 붙인다(주석이 사이에 있던 `a<!--c-->b`는 "ab"다). invariants.mjs도 같은 걸음으로 걷는다. */
export function cleanChildren(node) {
  const out = [];
  for (const child of childrenOf(node)) {
    if (child.nodeName === "#comment") continue;
    const last = out[out.length - 1];
    if (child.nodeName === "#text" && last?.nodeName === "#text") {
      out[out.length - 1] = { nodeName: "#text", value: last.value + child.value };
      continue;
    }
    out.push(child);
  }
  return out;
}

const isBlock = (n) => n && n.tagName && BLOCK.has(n.tagName);

function attrsText(node) {
  const attrs = [...(node.attrs ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return attrs.map((a) => (a.value === "" ? ` ${a.name}=""` : ` ${a.name}=${JSON.stringify(a.value)}`)).join("");
}

const markHidden = (hidden) => (hidden ? " [hidden]" : "");

function dump(node, depth, ctx, out) {
  const pad = "  ".repeat(depth);
  const kids = cleanChildren(node);
  const hidden = ctx.hidden || (node.attrs ?? []).some((a) => a.name === "hidden");
  out.push(`${pad}<${node.tagName}${attrsText(node)}>`);
  if (VOID.has(node.tagName)) return;

  if (RAW_TEXT.has(node.tagName)) {
    // 인라인 script·style: 줄바꿈만 정규화하고 한 줄씩 `| `로 펴서 diff가 어느 줄인지 가리키게 한다.
    const body = kids.map((k) => k.value ?? "").join("").replace(/\r\n?/g, "\n");
    if (body !== "") for (const line of body.split("\n")) out.push(`${pad}  | ${line}`);
    out.push(`${pad}</${node.tagName}>`);
    return;
  }

  const verbatim = ctx.verbatim || VERBATIM.has(node.tagName);
  const parentBlock = isBlock(node);
  kids.forEach((kid, i) => {
    if (kid.nodeName === "#text") {
      let text = kid.value;
      if (!verbatim) {
        text = text.replace(WS, " ");
        const prev = kids[i - 1];
        const next = kids[i + 1];
        // 시작 쪽: 부모(블록)의 첫 자식이거나 블록 요소 바로 뒤. 끝 쪽은 반대.
        if ((i === 0 && parentBlock) || isBlock(prev)) text = text.replace(/^ /, "");
        if ((i === kids.length - 1 && parentBlock) || isBlock(next)) text = text.replace(/ $/, "");
        if (text === "") return;
      }
      out.push(`${pad}  ${JSON.stringify(text)}${markHidden(hidden)}`);
    } else if (kid.tagName) {
      dump(kid, depth + 1, { hidden, verbatim }, out);
    }
  });
  out.push(`${pad}</${node.tagName}>`);
}

/** HTML 문자열 → 정준 덤프 줄 배열. */
export function canonLines(html) {
  const doc = parse(html);
  const out = [];
  // 문서 직속: doctype과 <html>. 주석은 뺀다.
  for (const child of doc.childNodes) {
    if (child.nodeName === "#documentType") out.push(`<!doctype ${child.name}>`);
    else if (child.tagName) dump(child, 0, { hidden: false, verbatim: false }, out);
  }
  return out;
}

export const canon = (html) => canonLines(html).join("\n");
