// 굽는 단계에서 인라인 <script> 본문의 주석만 뗀다 (#313).
//
// 왜: 틀(scripts/realestate-template.html · scripts/rates-template.html …)의 인라인 스크립트에 적은 주석은 굽는 과정에서
// 글자 그대로 복사돼 장마다 실려 나간다. 브라우저는 그 바이트를 매번 받고 파싱한다. 그래서 "왜 이렇게 했는지"를
// 코드에 적는 일과 S6(브라우저로 나가는 JS를 늘리지 않는다)가 부딪쳤다(#297: 11줄 +2,017B → 5줄 +804B → +184B).
// 틀에는 "왜"를 마음껏 적고, 나가는 장에서만 주석을 뗀다. 틀이 단일 출처다 - 소스맵은 쓰지 않는다(바이트가 늘어 S6).
//
// 왜 esbuild 로 직접 안 떼나: `esbuild.transform`은 주석만 버리는 것이 아니라 코드를 **다시 찍는다**. 루트의
// 시세 틀 본문(옮기기 전 docs/realestate.html, 54,080B)을 minify 없이 넣어 봐도 568줄이 달라졌다(문자열 줄 합치기·끝 쉼표 삭제·
// 들여쓰기 정규화). 그건 "주석 말고 다른 변환은 하지 않는다"(#313 범위 3)를 어긴다. 그래서 주석 구간만 찾아 그 글자만
// 지우는 작은 훑개를 쓰고, esbuild 는 "주석만 바뀌었다"를 기계로 증명하는 쪽에서 쓴다
// (test/inline-comments.test.mjs - 전후를 같은 파서로 읽어 구문 트리가 같고, 지워진 글자가 공백과 주석뿐임을 본다).
// 그래서 이 모듈은 esbuild 를 import 하지 않는다 - JIPGYE_RENDERER=legacy 경로가 로더·esbuild 를 안 부르는 성질(renderer.mjs)을 그대로 지킨다.
//
// 지우는 것은 주석 글자와 그 때문에 비는 줄·줄 끝 공백뿐이다. 식별자·문자열·공백 압축·구문 변환은 없다.
// 훑개가 모르는 모양을 만나면(닫히지 않은 문자열·템플릿·정규식·블록 주석) 조용히 넘기지 않고 던진다.

const SP = ""; // 같은 줄 안의 주석이 있던 자리
const NL = ""; // 줄바꿈을 품은 블록 주석이 있던 자리(ASI 때문에 줄바꿈을 남겨야 한다)

// 바로 앞 토큰이 이 낱말이면 `/`는 나눗셈이 아니라 정규식의 시작이다.
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

const isIdStart = (c) => /[A-Za-z_$\u0080-￿]/.test(c);
const isIdPart = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c);
const isDigit = (c) => c >= "0" && c <= "9";

/**
 * JS 소스에서 주석 구간 [{ start, end, block, nl }]을 찾는다(end는 배타). 문자열·템플릿 리터럴·정규식 리터럴 안의
 * `//`·`/*`는 주석이 아니다. 훑는 중 닫히지 않은 구조를 만나면 던진다.
 */
export function findJsComments(src) {
  const comments = [];
  const n = src.length;
  // 템플릿 리터럴 안 `${ … }`의 중괄호를 짝짓는 스택. 맨 위가 "tpl"이면 그 `}`는 템플릿 본문으로 돌아가는 자리다.
  const braces = [];
  // 바로 앞 의미 있는 토큰. regexOk: 지금 `/`가 정규식의 시작일 수 있는가.
  let regexOk = true;
  let i = 0;

  const fail = (what, at) => {
    const line = src.slice(0, at).split("\n").length;
    throw new Error(`인라인 스크립트의 ${what}가 닫히지 않았습니다(${line}행)`);
  };

  const scanTemplate = (from) => {
    // from: 여는 백틱 다음 자리 또는 `}` 다음 자리. 본문을 훑다 `${`를 만나면 코드로 나가고, 닫는 백틱을 만나면 끝낸다.
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === "\\") {
        j += 2;
      } else if (c === "`") {
        return { next: j + 1, closed: true };
      } else if (c === "$" && src[j + 1] === "{") {
        braces.push("tpl");
        return { next: j + 2, closed: false };
      } else {
        j += 1;
      }
    }
    fail("템플릿 리터럴", from);
  };

  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    // 주석
    if (c === "/" && src[i + 1] === "/") {
      let e = src.indexOf("\n", i);
      if (e < 0) e = n;
      comments.push({ start: i, end: e, block: false, nl: false });
      i = e;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close < 0) fail("블록 주석", i);
      const e = close + 2;
      comments.push({ start: i, end: e, block: true, nl: src.slice(i, e).includes("\n") });
      i = e;
      continue;
    }
    // 문자열
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j += 1;
        else if (src[j] === "\n") fail("문자열", i);
        j += 1;
      }
      if (j >= n) fail("문자열", i);
      i = j + 1;
      regexOk = false;
      continue;
    }
    // 템플릿
    if (c === "`") {
      const r = scanTemplate(i + 1);
      i = r.next;
      regexOk = r.closed ? false : true;
      continue;
    }
    // 정규식 또는 나눗셈
    if (c === "/") {
      if (!regexOk) {
        i += 1;
        regexOk = true;
        continue;
      }
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === "\\") j += 2;
        else if (d === "\n") fail("정규식", i);
        else if (d === "[") { inClass = true; j += 1; }
        else if (d === "]") { inClass = false; j += 1; }
        else if (d === "/" && !inClass) break;
        else j += 1;
      }
      if (j >= n) fail("정규식", i);
      j += 1;
      while (j < n && isIdPart(src[j])) j += 1; // 플래그
      i = j;
      regexOk = false;
      continue;
    }
    // 낱말
    if (isIdStart(c) || c === "#") {
      let j = i + 1;
      while (j < n && isIdPart(src[j])) j += 1;
      const word = src.slice(i, j);
      i = j;
      regexOk = REGEX_AFTER_WORD.has(word);
      continue;
    }
    // 숫자
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && (isIdPart(src[j]) || src[j] === "." || ((src[j] === "+" || src[j] === "-") && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))))) j += 1;
      i = j;
      regexOk = false;
      continue;
    }
    // 구두점
    if (c === "{") {
      braces.push("{");
      i += 1;
      regexOk = true;
      continue;
    }
    if (c === "}") {
      const top = braces.pop();
      if (top === "tpl") {
        const r = scanTemplate(i + 1);
        i = r.next;
        regexOk = r.closed ? false : true;
      } else {
        i += 1;
        regexOk = true; // 블록 끝 뒤의 `/`는 새 문장의 정규식이 흔하다(객체 리터럴 뒤 나눗셈은 드물다)
      }
      continue;
    }
    i += 1;
    regexOk = !(c === ")" || c === "]");
  }
  if (braces.includes("tpl")) fail("템플릿 리터럴의 ${", n);
  return comments;
}

/**
 * JS 소스에서 주석만 뗀다. 주석만 있는 줄은 줄째, 코드 뒤에 붙은 주석은 그 주석과 앞의 공백을 지운다.
 * 주석이 없으면 받은 문자열을 그대로 돌려준다(같은 문자열).
 */
export function stripJsComments(src) {
  const comments = findJsComments(src);
  if (comments.length === 0) return src;
  if (src.includes(SP) || src.includes(NL)) throw new Error("소스에 내부 표지 글자(U+E000·U+E001)가 있습니다");

  let marked = "";
  let pos = 0;
  for (const cm of comments) {
    marked += src.slice(pos, cm.start) + (cm.nl ? NL : SP);
    pos = cm.end;
  }
  marked += src.slice(pos);

  const out = [];
  for (const line of marked.split("\n")) {
    if (!line.includes(SP) && !line.includes(NL)) {
      out.push(line);
      continue;
    }
    if (line.replaceAll(SP, "").replaceAll(NL, "").trim() === "") continue; // 주석뿐인 줄은 줄째
    let text = "";
    let k = 0;
    while (k < line.length) {
      const ch = line[k];
      if (ch !== SP && ch !== NL) {
        text += ch;
        k += 1;
        continue;
      }
      // 연달아 붙은 표지(주석 둘 사이에 공백뿐이면 한 덩어리로 본다)
      let end = k;
      let nl = false;
      while (end < line.length && (line[end] === SP || line[end] === NL || line[end] === " " || line[end] === "\t")) {
        if (line[end] === NL) nl = true;
        end += 1;
      }
      const prevIsWs = text === "" || /\s$/.test(text);
      const rest = line.slice(end).replaceAll(SP, "").replaceAll(NL, "");
      if (rest.trim() === "") {
        text = text.replace(/[ \t]+$/, ""); // 줄 끝 주석: 앞 공백까지
      } else if (nl) {
        text = text.replace(/[ \t]+$/, "") + "\n"; // 줄바꿈을 품은 블록 주석은 줄바꿈 하나로 남긴다(ASI)
      } else if (!prevIsWs) {
        text += " "; // `a/* c */b`·`a/* c */ b` - 두 토큰이 붙지 않게 한 칸
      }
      k = end;
    }
    out.push(text);
  }
  return out.join("\n");
}

/** 인라인 <script>(src 없음, JS 종류)의 본문. JSON 섬(type="application/json"·ld+json 등)은 JS가 아니라 건드리지 않는다. */
const INLINE_SCRIPT = /(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi;

function isExecutableInline(attrs) {
  if (/\bsrc\s*=/i.test(attrs)) return false;
  const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]*)/i)?.[1]?.toLowerCase();
  return type === undefined || type === "" || type === "text/javascript" || type === "application/javascript" || type === "module";
}

/** HTML 한 장의 인라인 스크립트 본문에서 주석을 뗀다. 스크립트 밖(마크업·JSON 섬·외부 script 태그)은 한 글자도 안 건드린다. */
export function stripInlineScriptComments(html) {
  return html.replace(INLINE_SCRIPT, (all, open, attrs, body, close) =>
    isExecutableInline(attrs) ? open + stripJsComments(body) + close : all
  );
}
