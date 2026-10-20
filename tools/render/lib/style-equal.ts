// 화면 동일 증빙(#276 완료 조건 9, 방법은 cto 판정 https://github.com/kyhsa93/jipgye/issues/276#issuecomment-6119194912).
// 스타일시트의 바이트는 바뀌는데 화면은 그대로여야 하는 PR이 쓴다. 구운 폴더 둘(기준·후보)을 받아 셋을 견준다.
//
//   A. 전제     두 폴더에서 다른 파일이 style.css 하나뿐인가, 장마다 스타일시트가 하나인가, 후보 CSS에서 components 층 밖에 무엇이 있는가.
//   B. 규칙     두 style.css를 **브라우저의 CSSOM으로** 읽어 (감싼 @media, 선택자, 선언 목록과 !important)를 순서대로 견준다.
//               정지 화면에서는 안 보이는 :hover·:focus-visible·다른 폭의 @media가 여기서 덮인다.
//               브라우저가 버리는 선언(다른 엔진용 접두사, 같은 블록에서 덮인 대체값)은 CSSOM에 없으므로 원문끼리 따로 견준다.
//   C. 그린 결과 장 × 테마 네 갈래 × 폭마다 모든 요소와 ::before·::after·::marker·::placeholder의 계산된 스타일 전 속성,
//               모든 요소의 상자(getBoundingClientRect), 문서의 scrollWidth·scrollHeight를 견준다.
//
// 요소를 1:1로 짝지을 수 있는 것은 두 폴더의 HTML·JS가 바이트로 같기 때문이다(A가 먼저 확인한다). 짝은 요소 경로(태그:nth-child 사슬)로 짓는다.
// 계산된 스타일은 요소·의사 요소마다 "속성:값;…" 문자열의 SHA-256으로 옮겨 견준다 - 장 하나가 수백만 값이라 값을 그대로 옮기면 느리다.
// 해시가 다른 자리만 값을 다시 읽어 (속성, 기준 값, 후보 값)을 낸다.
//
// 같은 입력에서도 결과가 흔들리지 않게 하는 것:
//   - 바깥 요청은 전부 막는다(GA·애드센스·환율 API). 조회가 쌓이지 않고, 바깥 응답이 화면을 흔들지 않는다.
//   - 페이지의 시계(Date)를 한 시각에 묶는다. "n분 전" 같은 글자가 기준과 후보 사이에 갈리지 않는다.
//   - fetch가 끝나고 DOM이 quietMs 동안 조용해진 뒤에 잰다.
//
// 못 보는 것(PR 본문 한계에 적는다): Chrome 밖의 엔진(Safari·Firefox)의 실제 렌더, @layer를 모르는 브라우저, 인쇄·forced-colors·
// prefers-contrast(규칙이 없어 "양쪽 다 없음"만 보인다), 마우스를 올리거나 초점이 간 상태의 계산된 스타일(B가 규칙으로 덮는다),
// 계산된 스타일이 같은데 그림이 다른 경우(래스터).
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { flattenCss, parseCss, ruleLine, stripComments } from "../../../test/helpers/css-source.mjs";

// 아래 함수 넷(cssomProbe·sourceProbe·initScript·collectProbe)은 Chrome 페이지 안에서 도는 코드라 이 이름들은 Node 가 아니라 브라우저의 전역이다.
// tsconfig 의 lib 에 dom 을 열지 않으려고(tools/golden 까지 DOM 전역이 열린다) 이 파일 범위에서만 any 로 선언한다(#423).
declare const document: any, getComputedStyle: any, MutationObserver: any, location: any;

export interface CtlX {
  name: string;
}

export const MODES = [
  // 강제 쪽은 OS와 반대로 둔다 - "사용자가 고른 테마가 OS 설정을 이기는가"가 깨지기 쉬운 자리다.
  { name: "auto-light", colorScheme: "light", theme: null },
  { name: "auto-dark", colorScheme: "dark", theme: null },
  { name: "forced-light", colorScheme: "dark", theme: "light" },
  { name: "forced-dark", colorScheme: "light", theme: "dark" },
];
export const WIDTHS = [375, 1280];
export const PSEUDOS = [null, "::before", "::after", "::marker", "::placeholder"];
/** #274 기준선의 대표 5장. */
export const REPRESENTATIVE = ["index.html", "realestate.html", "budget-7eok.html", "district-gangnam.html", "rates.html"];
/** 영어 모드로 한 번 더 보는 장(문구가 길어 넘침이 잘 난다). */
export const ENGLISH_PAGES = ["index.html", "budget-7eok.html"];

// ── A. 전제 ──────────────────────────────────────────────────────────────────────────────────

async function walkFiles(dir, rel = "") {
  const out = [];
  for (const e of (await readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walkFiles(dir, r)));
    else out.push(r);
  }
  return out;
}

/** 두 폴더의 파일을 바이트로 견준다(`diff -rq`와 같은 말). 반환: { total, same, differ: [..], onlyBase: [..], onlyHead: [..] }. */
export async function fileDiff(baseDir, headDir) {
  const [a, b] = await Promise.all([walkFiles(baseDir), walkFiles(headDir)]);
  const inB = new Set(b);
  const inA = new Set(a);
  const differ = [];
  let same = 0;
  for (const f of a.filter((x) => inB.has(x))) {
    const [x, y] = await Promise.all([readFile(path.join(baseDir, f)), readFile(path.join(headDir, f))]);
    if (x.equals(y)) same++;
    else differ.push(f);
  }
  return { total: new Set([...a, ...b]).size, same, differ, onlyBase: a.filter((x) => !inB.has(x)), onlyHead: b.filter((x) => !inA.has(x)) };
}

const count = (text, re) => (text.match(re) ?? []).length;

/** 한 폴더의 전제 사실(cto 댓글 A-2): 장마다 스타일시트 link 수, <style> 블록, style 속성, CSS 원문 안의 특수 구문 개수. */
export async function premises(dir) {
  const pages = (await readdir(dir)).filter((f) => f.endsWith(".html")).sort();
  let styleBlocks = 0;
  let styleAttrs = 0;
  const linkCounts = {};
  const otherLinks = [];
  for (const f of pages) {
    const html = await readFile(path.join(dir, f), "utf8");
    const links = html.match(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi) ?? [];
    linkCounts[links.length] = (linkCounts[links.length] ?? 0) + 1;
    for (const l of links) if (!/href=["']\.\/style\.css["']/.test(l)) otherLinks.push(`${f}: ${l}`);
    styleBlocks += count(html, /<style\b/gi);
    styleAttrs += count(html, /\sstyle="/g);
  }
  const css = stripComments(await readFile(path.join(dir, "style.css"), "utf8"));
  let jsComputedStyle = 0;
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".js") || x.endsWith(".html"))) jsComputedStyle += count(await readFile(path.join(dir, f), "utf8"), /getComputedStyle|getPropertyValue/g);
  return {
    pages: pages.length,
    linkCounts,
    otherLinks,
    styleBlocks,
    styleAttrs,
    jsComputedStyle,
    css: {
      important: count(css, /!\s*important/g),
      revertLayer: count(css, /revert-layer/g),
      revert: count(css, /\brevert\b(?!-layer)/g),
      import: count(css, /@import\b/g),
      fontFace: count(css, /@font-face\b/g),
      keyframes: count(css, /@keyframes\b/g),
      supports: count(css, /@supports\b/g),
      property: count(css, /@property\b/g),
      webkit: count(css, /-webkit-/g),
      hover: count(css, /:hover\b/g),
      focusVisible: count(css, /:focus-visible\b/g),
      mediaPrint: count(css, /@media[^{]*\bprint\b/g),
      forcedColors: count(css, /forced-colors/g),
      prefersContrast: count(css, /prefers-contrast/g),
    },
  };
}

// ── B. 규칙 단위 ─────────────────────────────────────────────────────────────────────────────

// 페이지 안에서 돈다: 그 장이 부른 style.css를 CSSOM으로 읽어 편다. 선언은 브라우저가 편 낱속성 단위(shorthand는 풀려 있다).
function cssomProbe() {
  const sheets = [...document.styleSheets];
  const sheet = sheets.find((s) => s.href && new URL(s.href).pathname.endsWith("/style.css"));
  const rules = [];
  const statements = [];
  const decls = (style) => {
    const out = [];
    for (let i = 0; i < style.length; i++) out.push([style[i], style.getPropertyValue(style[i]), style.getPropertyPriority(style[i])]);
    return out;
  };
  const walk = (list, ctx) => {
    for (const r of list) {
      const kind = r.constructor.name;
      if (kind === "CSSLayerStatementRule") statements.push({ ctx, text: r.cssText });
      else if (kind === "CSSLayerBlockRule") walk(r.cssRules, [...ctx, `@layer ${r.name}`]);
      else if (kind === "CSSMediaRule" || kind === "CSSSupportsRule" || kind === "CSSContainerRule") walk(r.cssRules, [...ctx, `@${kind.slice(3, -4).toLowerCase()} ${r.conditionText}`]);
      else if (kind === "CSSStyleRule") {
        rules.push({ ctx, selector: r.selectorText, decls: decls(r.style) });
        if (r.cssRules && r.cssRules.length) walk(r.cssRules, [...ctx, r.selectorText]);
      } else rules.push({ ctx, selector: `(${kind})`, decls: [], text: r.cssText });
    }
  };
  walk(sheet.cssRules, []);
  return { sheetCount: sheets.length, rules, statements };
}

// 페이지 안에서 돈다: 원문의 규칙·선언을 이 브라우저가 어떻게 읽는지. 선택자와 @media 조건은 브라우저의 표기로 고르고(못 읽으면 null),
// 선언은 빈 요소의 style에 넣어 본다 - 들어간 낱속성과 값이 곧 "브라우저가 이 선언을 읽은 결과"다. 아무것도 안 들어가면 버린 것이다.
function sourceProbe(sourceRules) {
  const el = document.createElement("style");
  document.head.appendChild(el);
  const scratch = el.sheet;
  const probe = document.createElement("div");
  const insert = (text) => {
    try {
      return scratch.cssRules[scratch.insertRule(text, scratch.cssRules.length)];
    } catch {
      return null;
    }
  };
  const out = sourceRules.map((r) => ({
    selector: insert(`${r.selector} {}`)?.selectorText ?? null,
    ctx: r.at.map((a) => {
      const rule = insert(`${a} {}`);
      return rule ? `@${rule.constructor.name.slice(3, -4).toLowerCase()} ${rule.conditionText}` : null;
    }),
    decls: r.decls.map((d) => {
      const at = d.indexOf(":");
      const prop = d.slice(0, at).trim();
      const value = d.slice(at + 1).trim();
      const important = /\s*!important$/.test(value);
      probe.style.cssText = "";
      probe.style.setProperty(prop, value.replace(/\s*!important$/, ""), important ? "important" : "");
      const longhands = [];
      for (let i = 0; i < probe.style.length; i++) longhands.push([probe.style[i], probe.style.getPropertyValue(probe.style[i]), probe.style.getPropertyPriority(probe.style[i])]);
      return { text: d, longhands };
    }),
  }));
  el.remove();
  return out;
}

const call = (fn, ...args) => `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;

/** 폴더의 한 장을 열어(스크립트는 끈다) 그 장이 부른 style.css의 CSSOM을 편다. sourceRules를 주면 원문 판독도 같이 낸다. */
export async function readCssom(chrome, serverUrl, { page = "rates.html", sourceRules = null } = {}) {
  const tab = await chrome.newPage({ allowOrigin: serverUrl, js: false });
  try {
    await tab.goto(serverUrl + page);
    const cssom = await tab.evaluate(call(cssomProbe));
    const source = sourceRules ? await tab.evaluate(call(sourceProbe, sourceRules)) : null;
    return { cssom, source };
  } finally {
    await tab.close();
  }
}

const cssomLine = (r) => `${r.ctx.length ? `${r.ctx.join(" > ")} > ` : ""}${r.selector} { ${r.decls.map(([p, v, pri]) => `${p}: ${v}${pri ? " !important" : ""}`).join("; ")}${r.text ? r.text : ""} }`;

/**
 * 기준과 후보의 CSSOM을 견준다(브라우저 없이 도는 순수 함수). 후보는 `@layer <layer>` 안의 규칙을 그 머리를 벗겨서 센다.
 * 반환: { ok, base: { rules, decls }, head: { rules, decls }, firstDiff, outside: [층 밖 규칙 줄], statements: [층 문장], layers: {층 이름: 규칙 수} }
 */
export function compareCssom(base, head, { layer = "components" } = {}) {
  const wrap = `@layer ${layer}`;
  const inLayer = head.rules.filter((r) => r.ctx[0] === wrap).map((r) => ({ ...r, ctx: r.ctx.slice(1) }));
  const outside = head.rules.filter((r) => r.ctx[0] !== wrap).map(cssomLine);
  const a = base.rules.map(cssomLine);
  const b = inLayer.map(cssomLine);
  let firstDiff = null;
  const n = Math.max(a.length, b.length);
  let diffs = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    diffs++;
    firstDiff ??= { index: i, base: a[i] ?? "(없음)", head: b[i] ?? "(없음)" };
  }
  const layers = {};
  for (const r of head.rules) {
    const name = r.ctx[0]?.startsWith("@layer ") ? r.ctx[0] : "(층 밖)";
    layers[name] = (layers[name] ?? 0) + 1;
  }
  const decls = (rules) => rules.reduce((sum, r) => sum + r.decls.length, 0);
  return {
    ok: diffs === 0 && base.statements.length === 0,
    diffs,
    firstDiff,
    base: { rules: a.length, decls: decls(base.rules), statements: base.statements.map((s) => s.text) },
    head: { rules: b.length, decls: decls(inLayer), statements: head.statements.map((s) => `${s.ctx.join(" > ")}${s.ctx.length ? " > " : ""}${s.text}`) },
    outside,
    layers,
  };
}

/**
 * 원문(legacy.css)의 선언마다 브라우저에서의 운명을 정한다(cto 댓글 B-3).
 *   sourceRules — flattenCss(원문).rules, probed — sourceProbe의 결과(같은 순서), cssomRules — 기준 CSSOM의 규칙.
 * 반환: { aligned, droppedRules: [규칙째 못 읽은 것], dropped: [브라우저가 버린 선언], shadowed: [같은 블록의 다른 선언에 덮인 선언], kept }
 */
export function sourceFate(sourceRules, probed, cssomRules) {
  const droppedRules = [];
  const dropped = [];
  const shadowed = [];
  let kept = 0;
  let k = 0;
  let aligned = true;
  sourceRules.forEach((r, i) => {
    const p = probed[i];
    const where = `${r.at.length ? `${r.at.join(" > ")} > ` : ""}${r.selector}`;
    if (p.selector === null || p.ctx.includes(null)) {
      droppedRules.push(where);
      return;
    }
    const rule = cssomRules[k++];
    if (!rule || rule.selector !== p.selector || rule.ctx.join("|") !== p.ctx.join("|")) {
      aligned = false;
      return;
    }
    const final = new Map(rule.decls.map(([name, value, pri]) => [name, `${value}|${pri}`]));
    for (const d of p.decls) {
      if (d.longhands.length === 0) dropped.push(`${where} { ${d.text} }`);
      else if (d.longhands.every(([name, value, pri]) => final.get(name) === `${value}|${pri}`)) kept++;
      else shadowed.push(`${where} { ${d.text} }`);
    }
  });
  if (k !== cssomRules.length) aligned = false;
  return { aligned, droppedRules, dropped, shadowed, kept };
}

// 원문의 선언·선택자를 공백을 고르기 **전** 글자로 뽑는다(빌드가 값 안의 줄바꿈을 접었는지 보려고).
function rawPieces(text) {
  const src = stripComments(text);
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth <= 0 && (c === "{" || c === ";" || c === "}")) {
      const piece = src.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  return out;
}

/**
 * 빌드가 고쳐 쓴 것(cto 댓글 B-4): 원문과 산출물을 글자로 견준다. 산출물은 `@layer <layer>` 안만 본다.
 * 반환: { rules, decls, rewritten: [공백을 골라도 다른 규칙], whitespaceOnly: [공백·줄바꿈만 다른 토막], commentsRemoved, kept: 보존된 느낌표 주석 수 }
 */
export function buildRewrites(sourceText, builtText, { layer = "components" } = {}) {
  const src = flattenCss(sourceText).rules;
  const out = flattenCss(builtText)
    .rules.filter((r) => r.at[0] === `@layer ${layer}`)
    .map((r) => ({ ...r, at: r.at.slice(1) }));
  const rewritten = [];
  const n = Math.max(src.length, out.length);
  for (let i = 0; i < n; i++) {
    const a = src[i] ? ruleLine(src[i]) : "(없음)";
    const b = out[i] ? ruleLine(out[i]) : "(없음)";
    if (a !== b) rewritten.push({ index: i, source: a, built: b });
  }
  // 공백을 고르기 전 글자: 토막(선택자·@머리·선언)의 다중집합을 견준다. 들여쓰기는 토막 밖이라 여기 안 잡힌다.
  const builtLayer = parseCss(builtText).find((n2) => n2.type === "block" && n2.prelude === `@layer ${layer}`);
  const inner = builtLayer ? stripComments(builtText).slice(stripComments(builtText).indexOf("{", stripComments(builtText).indexOf(`@layer ${layer} {`)) + 1, stripComments(builtText).lastIndexOf("}", stripComments(builtText).lastIndexOf("@layer")) ) : "";
  const a = rawPieces(sourceText);
  const b = rawPieces(inner);
  const whitespaceOnly = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i] && a[i].replace(/\s+/g, " ") === b[i].replace(/\s+/g, " ")) whitespaceOnly.push({ source: a[i], built: b[i] });
  return {
    rules: src.length,
    decls: src.reduce((sum, r) => sum + r.decls.length, 0),
    rewritten,
    whitespaceOnly,
    pieces: { source: a.length, built: b.length },
    commentsRemoved: (sourceText.match(/\/\*[\s\S]*?\*\//g) ?? []).length,
    bytes: { source: Buffer.byteLength(sourceText), built: Buffer.byteLength(builtText) },
  };
}

// ── C. 계산된 스타일과 상자 ─────────────────────────────────────────────────────────────────

// 문서가 뜨기 전에 돈다: 시계를 묶고, 진행 중인 fetch를 센다.
function initScript(fixedNow, theme, lang) {
  try {
    if (theme) localStorage.setItem("theme", theme);
    else localStorage.removeItem("theme");
    if (lang) localStorage.setItem("lang", lang);
    else localStorage.removeItem("lang");
  } catch {}
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target: any, args) => (args.length ? new target(...args) : new target(fixedNow)),
    apply: () => new RealDate(fixedNow).toString(),
    get: (target, key) => (key === "now" ? () => fixedNow : Reflect.get(target, key)),
  });
  const state = (globalThis.__renderProbe = { inflight: 0 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = function (...args) {
    state.inflight++;
    return realFetch.apply(this, args).finally(() => state.inflight--);
  };
}

// 페이지 안에서 돈다: 조용해질 때까지 기다린 뒤 모든 요소를 잰다.
async function collectProbe(opts) {
  const t0 = performance.now();
  await document.fonts.ready;
  let last = performance.now();
  const mo = new MutationObserver(() => (last = performance.now()));
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  let settled = false;
  while (performance.now() - t0 < opts.maxWaitMs) {
    await new Promise((r) => setTimeout(r, 50));
    if ((globalThis.__renderProbe?.inflight ?? 0) === 0 && performance.now() - last >= opts.quietMs) {
      settled = true;
      break;
    }
  }
  mo.disconnect();

  const enc = new TextEncoder();
  const sha = async (s) => {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  const origin = location.origin;
  const pathOf = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      let i = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) i++;
      parts.push(e.parentElement ? `${e.localName}:nth-child(${i})` : e.localName);
    }
    return parts.reverse().join(">");
  };
  const styleText = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    const seen = new Set();
    const parts = [];
    for (let i = 0; i < cs.length; i++) {
      seen.add(cs[i]);
      parts.push(`${cs[i]}:${cs.getPropertyValue(cs[i])}`);
    }
    // (다) `cs` 열거에 `--*`가 나오지 않는 환경이 있으므로 **원문이 선언한 이름 목록**(opts.customNames)을 따로 읽힌다.
    // 기준과 후보에 같은 목록이 간다(bin이 legacy.css 한 곳에서 뽑아 양쪽에 넘긴다). 이미 나온 것은 두 번 세지 않는다.
    for (const name of opts.customNames) if (!seen.has(name)) parts.push(`${name}:${cs.getPropertyValue(name)}`);
    // (가) **이름으로 정렬한 뒤 쌍을 전부 견준다.** Chrome이 계산된 스타일을 열거하는 순서는 사용자 정의 속성이 어느 층에서
    // 선언됐는지에 따라 달라진다 - legacy.css를 `@layer components` 안으로 옮기면 값은 그대로인데 `--fs-h2`와 `--prose`의
    // 자리가 바뀐다(실측: 속성 503개, 집합 동일, 481번째부터 순서만 다름). 정렬하지 않으면 모든 요소가 "다르다"로 잡힌다.
    //
    // 면제는 **열거 순서에만** 준다(cto 개정 1 https://github.com/kyhsa93/jipgye/issues/276#issuecomment-6147173489).
    // 정렬은 차이를 숨기는 데에도 쓸 수 있으므로 그 대가로 (가) 쌍을 하나도 빼지 않고 해시에 넣고 - 값이 다르면 반드시
    // 해시가 달라진다 - (나) 쌍의 개수를 아래 pairs로 따로 세어 기준·후보에서 견준다. 규칙 순서(증빙 B)는 종전대로
    // 순서까지 견준다.
    return parts.sort();
  };
  const want = opts.detail ? new Set(opts.detail) : null;
  const els = [...document.querySelectorAll("*")];
  const rows = [];
  const detail = {};
  let values = 0;
  // (나) 견준 `이름:값` 쌍의 수만 따로 센다. values에는 상자 4값·문서 4값이 섞여 있어 "쌍의 개수"를 가리키지 못한다.
  let pairs = 0;
  for (let index = 0; index < els.length; index++) {
    const el = els[index];
    const texts = opts.pseudos.map((p) => styleText(el, p));
    for (const t of texts) {
      values += t.length;
      pairs += t.length;
    }
    const b = el.getBoundingClientRect();
    const rect = `${b.x},${b.y},${b.width},${b.height}`;
    values += 4;
    rows.push([pathOf(el), await Promise.all(texts.map((t) => sha(t.join(";").replaceAll(origin, "")))), rect]);
    if (want?.has(index)) detail[index] = texts.map((t) => t.map((s) => s.replaceAll(origin, "")));
  }
  const root = document.documentElement;
  return {
    settled,
    waitedMs: Math.round(performance.now() - t0),
    theme: root.getAttribute("data-theme"),
    lang: root.getAttribute("lang"),
    props: getComputedStyle(root).length,
    customNamesRead: opts.customNames.length,
    pairs,
    values: values + 4,
    doc: `${root.scrollWidth},${root.scrollHeight},${document.body.scrollWidth},${document.body.scrollHeight}`,
    rows,
    detail,
  };
}

/** 한 장을 한 조건으로 열어 잰다. job: { page, mode(MODES의 하나), width, lang }. */
export async function collect(chrome, serverUrl, job, { customNames, fixedNow, quietMs = 300, maxWaitMs = 10000, height = 900, detail = null }: { customNames?: string[]; fixedNow?: number; quietMs?: number; maxWaitMs?: number; height?: number; detail?: number[] | null } = {}) {
  const tab = await chrome.newPage({ allowOrigin: serverUrl, js: true, width: job.width, height, colorScheme: job.mode.colorScheme, initScript: call(initScript, fixedNow, job.mode.theme, job.lang ?? null) });
  try {
    await tab.goto(serverUrl + job.page);
    const r = await tab.evaluate(call(collectProbe, { customNames, pseudos: PSEUDOS, quietMs, maxWaitMs, detail }));
    return { ...r, blocked: tab.blocked.length };
  } finally {
    await tab.close();
  }
}

/**
 * 잰 것 둘을 견준다(순수 함수). 반환: { elements, values, diffs, domMismatch, items: [{ index, path, what }] }.
 * what은 PSEUDOS의 자리("요소"·"::before"…)이거나 "상자"·"문서 크기"다.
 */
export function compareCollected(a, b) {
  const items = [];
  const domMismatch = a.rows.length !== b.rows.length || a.rows.some((r, i) => r[0] !== b.rows[i][0]);
  if (!domMismatch) {
    a.rows.forEach(([p, hashes, rect], i) => {
      const other = b.rows[i];
      hashes.forEach((h, j) => {
        if (h !== other[1][j]) items.push({ index: i, path: p, what: PSEUDOS[j] ?? "요소", pseudo: j });
      });
      if (rect !== other[2]) items.push({ index: i, path: p, what: "상자", base: rect, head: other[2] });
    });
  }
  if (a.doc !== b.doc) items.push({ index: -1, path: "(문서)", what: "문서 크기", base: a.doc, head: b.doc });
  if (a.values !== b.values) items.push({ index: -1, path: "(문서)", what: "견준 값의 수", base: String(a.values), head: String(b.values) });
  // (나) 쌍의 개수를 양쪽에서 세어 견준다 - 한쪽에만 있는 속성은 여기서 드러나고, 개수가 다르면 그 자체가 차이다(cto 개정 1).
  if (a.pairs !== b.pairs) items.push({ index: -1, path: "(문서)", what: "견준 쌍의 수", base: String(a.pairs), head: String(b.pairs) });
  // (다) 원문 선언 이름 목록을 양쪽에 같은 것으로 읽혔는지도 값으로 확인한다.
  if (a.customNamesRead !== b.customNamesRead) items.push({ index: -1, path: "(문서)", what: "읽힌 사용자 정의 속성 이름 수", base: String(a.customNamesRead), head: String(b.customNamesRead) });
  return { elements: a.rows.length, values: a.values, pairs: { base: a.pairs, head: b.pairs }, customNamesRead: { base: a.customNamesRead, head: b.customNamesRead }, diffs: items.length + (domMismatch ? 1 : 0), domMismatch, items };
}

/** 해시가 다른 자리의 값을 속성 단위로 편다. da·db는 detail을 주고 다시 잰 결과. */
export function explain(items, da, db) {
  const out = [];
  for (const it of items) {
    if (it.pseudo === undefined) {
      out.push({ path: it.path, what: it.what, prop: "", base: it.base, head: it.head });
      continue;
    }
    const a = new Map((da.detail[it.index]?.[it.pseudo] ?? []).map((s) => [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)]));
    const b = new Map((db.detail[it.index]?.[it.pseudo] ?? []).map((s) => [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)]));
    for (const name of new Set([...a.keys(), ...b.keys()])) if (a.get(name) !== b.get(name)) out.push({ path: it.path, what: it.what, prop: name, base: a.get(name) ?? "(없음)", head: b.get(name) ?? "(없음)" });
  }
  return out;
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
