// 페이지 **안에서** 도는 탐침(#325 = #278 PR A). 여기 있는 것은 전부 **문자열**이다 — CDP의 `Runtime.evaluate`로
// 넘겨 브라우저가 돌린다. 그래서 이 파일의 함수는 바깥 변수를 쓰지 못하고, import도 못 한다.
//
// **왜 렌더로 재나**: 기존 접근성 시험은 `src/css/legacy.css`를 정규식으로 읽는다(#276). Tailwind 유틸리티로
// 그린 요소는 그 파일에 규칙이 없으므로 #279부터 그 시험은 눈이 먼다(#274 체인 공통 규칙 2번). CSS가 실제로
// 무엇을 했는지는 브라우저만 안다 — `getComputedStyle`·`getBoundingClientRect`·`checkVisibility`가 답이다.
//
// 못 보는 것(여기 적어 둔다 — "0건"이 "안 봤다"로 읽히지 않게):
//   - `::before`/`::after`의 `content` 글자. 텍스트 노드가 아니라 TreeWalker에 안 걸린다.
//   - 배경 **이미지**(그러데이션 포함) 위의 글자 대비. 픽셀을 읽어야 해서 색 계산으로는 못 낸다 →
//     위반이 아니라 `unmeasurable`로 따로 센다.
//   - 화면을 굴려야 보이는 것(스크롤 위치에 따라 달라지는 `position:sticky`의 겹침).

/** 대비 하한. WCAG 2.2 AA: 보통 글자 4.5:1, **큰 글자**(24px 이상, 또는 굵게 18.66px 이상) 3:1. */
export const CONTRAST_NORMAL = 4.5;
export const CONTRAST_LARGE = 3;

// 손가락이 닿는 크기. **높이와 폭에 다른 수를 쓴다.**
//   높이 44px: 이 저장소 자신의 기준이다(`--tap: 44px`, test/style.test.mjs "누르는 것은 손가락이 닿는
//     크기다"가 확인하는 CSS 규칙은 전부 `min-height: var(--tap)`이다 — **높이** 규칙이다).
//   폭 24px: WCAG 2.2 2.5.8 Target Size (Minimum, AA)의 24×24 CSS px.
// **왜 폭도 44로 걸지 않나 — 24~44 구간이 과녁이 아니기 때문이다.** 근거는 수의 크기가 아니라 **조성**이다.
//   - 그 구간에 들어오는 것의 거의 전부가 **줄바꿈으로 흐르는 글 속 링크**다 — `a 35.3×44px "종로구"`,
//     `a 37.56×44px "9억대"`. **폭이 곧 글자 수**이고 **높이는 이미 44px를 채운다.** 손가락이 닿는 데
//     문제가 없는 것을 폭만 보고 부르게 된다.
//   - 그 구간에서 **링크가 아닌 것은 `#archive-prev-day`·`#archive-next-day` 38×44px 한 짝뿐이다.**
//   - 반대로 **폭 24 문턱에 실제로 남는 것은 두 모양뿐이다** — `button.detail-toggle 21.59×44px "상세"`와
//     `input 13×44px`. 둘 다 글자 폭이 아니라 정말 작은 과녁이다.
//   ⇒ 폭 24는 "수가 작아서"가 아니라 **"24~44 구간이 글자 폭이라서"** 맞다. 이 근거는 아래 수를 보지 않고도 선다.
// **수**(merge-base `82ee67ee` 전수, 2026-10-15 cto 실측. 이슈 #329, 댓글 6183721307·6184041888):
//   주 수는 **폭** 축이다 — **폭 24px 미만 168건 ↔ 폭 44px로 걸면 5,696건**(둘 다 "폭 미달"로 걸린 줄 수).
//   보조로, 도구가 찍는 **합계**는 같은 바탕에서 **1,163 ↔ 6,691**이다.
//   **높이 미달 980건·넘침 5건·글자 크기 10건은 두 문턱에서 같다. 그래서 폭 문턱이 움직이는 수는 폭 축뿐이다.**
//   합계를 분모로 쓰면 문턱의 효과가 5.8배로 보이지만 폭 축으로 재면 34배다 — 축을 적는 것만으로는 안 고쳐지고
//   수 자체를 문턱이 움직이는 것으로 써야 한다.
// **판정에 0.5px 공차가 있어 실효 문턱은 폭 23.5 · 높이 43.5다**(아래 `h + 0.5 >= TAP && w + 0.5 >= TAP_W`).
//   폭이 23.5와 24 사이인 요소는 폭 24 목록에 **안 들어온다.** 수를 다시 세다가 위 수와 어긋나면 이 줄부터 읽어라.
// (`summary 288×32.39px`는 **높이 미달**이라 두 문턱 어느 쪽에서도 그대로 남는다 — 폭 문턱과는 무관한 축이다.)
export const TAP_MIN = 44;
export const TAP_MIN_WIDTH = 24;

/** 입력칸 글자 크기 하한. 16px 미만이면 iOS Safari가 초점에서 화면을 당기고 되돌려주지 않는다. */
export const FIELD_MIN = 16;

// 글자 크기 하한. 축척의 바닥은 `--fs-xs` 0.78rem = 12.48px이다(test/style.test.mjs "축척의 바닥이 한글이
// 읽히는 크기다"). 축척 바닥을 그대로 문턱으로 쓰면 반올림 하나에 걸리므로 **12px**을 하한으로 둔다 —
// 축척을 쓴 글자는 전부 통과하고, 축척 밖으로 내려간 것(`em` 상대 크기가 쌓여 작아지는 자리)만 걸린다.
export const FONT_MIN = 12;

/** 가로 넘침을 하드로 보는 폭(#211, #274 체인 공통 규칙 1번 ②: 320·375). */
export const NARROW_WIDTHS = [320, 375];

/** 가시 텍스트 다중집합을 견주는 폭(#274 체인 공통 규칙 1번 ①: 375·1280). */
export const TEXT_WIDTHS = [375, 1280];

// --- 페이지 안에서 도는 코드 -------------------------------------------------
//
// 한 덩어리로 둔다. 쪼개서 여러 번 evaluate하면 그 사이에 레이아웃이 바뀔 수 있고, 무엇보다
// 헬퍼를 매번 다시 보내야 한다.
const HELPERS = `
  const vis = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true });
  const clips = (cs) => cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.clipPath !== "none" || (cs.clip && cs.clip !== "auto");
  // 요소를 사람이 알아볼 이름으로. id가 있으면 그것, 없으면 태그 + class 둘 + 형제 순번.
  const label = (el) => {
    if (!el) return "(없음)";
    if (el.id) return "#" + el.id;
    const cls = [...el.classList].slice(0, 2).map((c) => "." + c).join("");
    const sibs = [...(el.parentElement?.children ?? [])].filter((x) => x.tagName === el.tagName);
    const nth = sibs.length > 1 ? ":nth-of-type(" + (sibs.indexOf(el) + 1) + ")" : "";
    return el.tagName.toLowerCase() + cls + nth;
  };
  const snip = (s, n) => { s = String(s).replace(/\\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  // "rgb(r g b / a)"·"rgba(r,g,b,a)"·"rgb(r,g,b)" 전부를 [r,g,b,a]로. getComputedStyle이 내는 꼴만 다룬다.
  const rgba = (s) => {
    const m = String(s).match(/-?[\\d.]+/g);
    if (!m || m.length < 3) return null;
    const [r, g, b] = m.slice(0, 3).map(Number);
    return [r, g, b, m.length > 3 ? Number(m[3]) : 1];
  };
  // 알파가 있는 색을 아래 색 위에 올린다(straight alpha over).
  const over = (top, bottom) => {
    const a = top[3];
    if (a >= 1) return [top[0], top[1], top[2], 1];
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
  };
  const lum = (c) => {
    const [r, g, b] = [c[0], c[1], c[2]].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // 글자 뒤에 실제로 깔린 색. 조상을 올라가며 반투명 배경을 합성하고, 불투명을 만나면 멈춘다.
  // 배경 **이미지**(그러데이션 포함)를 만나면 색 계산으로는 못 재므로 null을 돌려준다(위반이 아니라 "측정 불가").
  const backdrop = (el) => {
    let acc = [0, 0, 0, 0];
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage !== "none") return null;
      const bg = rgba(cs.backgroundColor);
      if (!bg || bg[3] === 0) continue;
      acc = acc[3] === 0 ? bg : over(acc, bg);
      if (acc[3] >= 1) return acc;
    }
    // 끝까지 불투명을 못 만나면 캔버스는 흰색이다(브라우저 기본).
    return acc[3] === 0 ? [255, 255, 255, 1] : over(acc, [255, 255, 255, 1]);
  };
  const BIG = ${CONTRAST_LARGE}, SMALL = ${CONTRAST_NORMAL}, TAP = ${TAP_MIN}, TAP_W = ${TAP_MIN_WIDTH}, FIELD = ${FIELD_MIN}, FLOOR = ${FONT_MIN};
  // 글자를 가진 텍스트 노드를 (노드, 부모요소, 글자)로. script/style/noscript/template 안은 뺀다.
  const textNodes = () => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest("script,style,noscript,template")) continue;
      const text = n.nodeValue.replace(/[ \\t\\n\\r\\f]+/g, " ").trim();
      if (text !== "") out.push({ node: n, el, text });
    }
    return out;
  };
`;

/**
 * 가시 텍스트 다중집합(검사 ①). 줄마다 `"글자" 상태` — 상태는 보임/숨김/가림/화면 밖.
 * 유틸리티로 숨기면(`tw:hidden`·`tw:sr-only`·`tw:invisible`·`tw:opacity-0`) 글자는 그대로인데 **상태가 바뀐다**.
 * 초안(research/.../tools-draft/render/lib/rendered.mjs)의 탐침을 이어받았다.
 */
export const TEXT_PROBE = `(() => {${HELPERS}
  const range = document.createRange();
  const texts = [];
  for (const { node, el, text } of textNodes()) {
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    let state = "보임";
    if (!vis(el) || rects.length === 0) state = "숨김";
    else {
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        const box = p.getBoundingClientRect();
        if ((box.width <= 1 || box.height <= 1) && clips(getComputedStyle(p))) { state = "가림"; break; }
      }
      if (state === "보임" && rects.every((r) => r.right + scrollX <= 0 || r.bottom + scrollY <= 0)) state = "화면 밖";
    }
    texts.push(JSON.stringify(text) + " " + state);
  }
  return texts;
})()`;

/**
 * 가로 넘침(검사 ②). 문서가 화면보다 넓어진 px. 자체 스크롤 상자 안의 표는 문서 폭을 넓히지 않으므로
 * 자연히 빠진다 — 그것이 `overflow-x:auto`를 두는 이유다.
 * 넘쳤으면 **무엇이 넘쳤는지**도 같이 센다. "+60px"만으로는 고칠 자리를 못 찾는다.
 */
export const OVERFLOW_PROBE = `(() => {${HELPERS}
  const spill = document.documentElement.scrollWidth - innerWidth;
  const culprits = [];
  if (spill > 0) {
    for (const el of document.body.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= innerWidth + 0.5) continue;
      // 넘친 조상 안에 든 자식은 원인이 아니라 결과다 — 스크롤을 만드는 가장 바깥 요소만 남긴다.
      if (el.parentElement && el.parentElement !== document.body && el.parentElement.getBoundingClientRect().right > innerWidth + 0.5) continue;
      culprits.push(label(el) + " 오른쪽 " + Math.round(r.right) + "px");
      if (culprits.length >= 5) break;
    }
  }
  return { over: Math.round(spill), culprits };
})()`;

/**
 * 대화형 요소 크기(검사 ③-터치). 글 속의 인라인 링크는 뺀다 — `display:inline`이면 줄 흐름을 따르는
 * 글자이지 누르는 판이 아니다(그 자리를 44px로 키우면 문단이 깨진다). 그 판정은 **렌더로** 한다:
 * CSS 파일을 읽지 않고 `getComputedStyle(el).display`를 본다.
 */
export const TAP_PROBE = `(() => {${HELPERS}
  const SEL = 'a[href], button, select, textarea, summary, [role="button"], [role="tab"], [role="link"], input:not([type="hidden"])';
  const bad = [];
  let checked = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!vis(el)) continue;
    if (el.disabled) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "inline") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    checked += 1;
    const w = Math.round(r.width * 100) / 100, h = Math.round(r.height * 100) / 100;
    if (h + 0.5 >= TAP && w + 0.5 >= TAP_W) continue;
    bad.push({ el: label(el), w, h, why: h + 0.5 < TAP ? "높이 " + TAP + "px 미만" : "폭 " + TAP_W + "px 미만", text: snip(el.textContent || el.getAttribute("aria-label") || "", 24) });
  }
  return { bad, checked };
})()`;

/** 입력칸 글자 크기(검사 ③-입력). 체크박스·라디오는 글자를 안 그리므로 뺀다. */
export const FIELD_PROBE = `(() => {${HELPERS}
  const bad = [];
  let checked = 0;
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!vis(el)) continue;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["hidden", "checkbox", "radio", "range", "color", "submit", "button", "image", "file"].includes(type)) continue;
    checked += 1;
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
    if (px + 0.01 >= FIELD) continue;
    bad.push({ el: label(el), px });
  }
  return { bad, checked };
})()`;

/** 글자 크기 하한(검사 ③-크기). 보이는 글자만 본다 — 숨은 것은 크기를 따질 자리가 아니다. */
export const FONT_PROBE = `(() => {${HELPERS}
  const seen = new Map();
  let checked = 0;
  for (const { el, text } of textNodes()) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    checked += 1;
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
    if (px + 0.01 >= FLOOR) continue;
    const key = label(el) + "|" + px;
    if (!seen.has(key)) seen.set(key, { el: label(el), px, text: snip(text, 32) });
  }
  return { bad: [...seen.values()], checked };
})()`;

/** 대비(검사 ③-대비). 네 모드 각각에서 돈다 — 모드는 부른 쪽이 바꾼다(lib/check.ts의 MODES). */
export const CONTRAST_PROBE = `(() => {${HELPERS}
  const bad = new Map();
  const unmeasurable = new Map();
  let checked = 0;
  for (const { el, text } of textNodes()) {
    if (!vis(el)) continue;
    if (el.closest("[disabled]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const want = large ? BIG : SMALL;
    const bg = backdrop(el);
    const key = label(el);
    if (!bg) { if (!unmeasurable.has(key)) unmeasurable.set(key, { el: key, why: "배경이 이미지·그러데이션이다", text: snip(text, 32) }); continue; }
    const fgRaw = rgba(cs.color);
    if (!fgRaw) continue;
    checked += 1;
    const fg = over(fgRaw, bg);
    const got = Math.round(ratio(fg, bg) * 100) / 100;
    if (got + 0.005 >= want) continue;
    if (!bad.has(key)) bad.set(key, { el: key, ratio: got, want, px: Math.round(px * 100) / 100, bold: weight >= 700, fg: cs.color, bg: "rgb(" + bg.slice(0, 3).map(Math.round).join(" ") + ")", text: snip(text, 32) });
  }
  return { bad: [...bad.values()], unmeasurable: [...unmeasurable.values()], checked };
})()`;

/**
 * 건너뛰기 링크(검사 ④). **지금 초점이 어디인지**를 구조로 읽는다. 누르는 것은 부른 쪽(CDP Input).
 * - `href`·`targetExists`: 초점 요소가 같은 장 안 조각(`#…`)으로 가는 링크이고 그 조각이 실제로 있는가.
 * - `inMain`: 초점이 `main` 안인가.
 * - `frame`: 초점이 **머리 틀** 안이면 그 이름. 건너뛰기를 눌렀는데도 여기 내려앉으면 아무것도 건너뛰지 못한 것이다.
 *   금지 구역 = `header` · `nav.page-nav` · `nav.sub-nav` · 사이트 검색(`form.site-search`, 입력 `#site-search-input`).
 *   머리가 `main` 안에 있는 실제 틀에서는 `inMain`만으로는 못 가른다(#463) — 그래서 둘을 따로 낸다.
 */
export const FRAME_SELECTOR = "header, nav.page-nav, nav.sub-nav, form.site-search, #site-search-input";
export const FOCUS_PROBE = `(() => {${HELPERS}
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { el: "(초점 없음)", href: null, targetExists: false, inMain: false, frame: null, text: "" };
  const href = el.getAttribute("href");
  const hash = href && href.charAt(0) === "#" ? href.slice(1) : null;
  const frame = el.closest(${JSON.stringify(FRAME_SELECTOR)});
  return {
    el: label(el),
    href,
    targetExists: hash !== null && hash !== "" && !!document.getElementById(hash),
    inMain: !!el.closest("main"),
    frame: frame ? label(frame) : null,
    text: snip(el.textContent || el.getAttribute("aria-label") || "", 40),
  };
})()`;
