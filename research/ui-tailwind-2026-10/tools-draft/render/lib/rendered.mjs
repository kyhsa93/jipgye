// 렌더 기반 검사(#274, cpo 댓글 2·4). invariants.mjs는 DOM만 읽어 CSS가 하는 일을 모른다 — class를 견주지 않으므로
// `tw:hidden`·`tw:sr-only`·`tw:invisible`·`tw:opacity-0`으로 본문을 숨겨도 텍스트 다중집합은 그대로 통과한다.
// 여기서는 구운 폴더 둘을 헤드리스 Chrome으로 열어, 브라우저가 실제로 그린 결과에서 셋을 견준다.
//
//   하드
//     보이는 글자   텍스트 노드마다 (글자, 상태)를 뽑아 폭마다 다중집합이 같다. 상태는 보임 / 숨김(display:none·
//                   visibility·opacity 0·크기 0) / 가림(1px 상자에 잘림 — sr-only) / 화면 밖(왼쪽·위로 밀어냄).
//     가로 넘침     좁은 폭(NARROW_MAX 이하)에서 문서의 scrollWidth − innerWidth가 기준보다 커지지 않는다
//                   (자체 스크롤 상자 안의 표는 문서 폭을 넓히지 않으므로 자연히 빠진다). 기준이 이미 넘치는 장은 보고서에 적는다.
//     첫 초점       Tab 한 번에 초점이 가는 요소가 같다(건너뛰기 링크가 첫 초점 자리를 지킨다).
//
// 페이지 스크립트는 끈다(js:false): 구운 HTML + CSS만 본다. JS를 켜면 환율 API·오늘 날짜에 따라 글자가 갈려
// 같은 입력에서도 결과가 흔들린다. 그래서 JS가 켜고 끄는 블록(언어 전환 따위)은 구운 초기 상태로만 본다.
// 바깥 요청은 전부 막는다(chrome.mjs). 못 보는 것: ::before/::after의 content(예: attr(data-label)) — 값은 invariants의 data-*가 본다.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { serveDir } from "./serve.mjs";

// 이 초안은 tools/golden 밖에서도 돌게 두 함수를 옮겨 적었다(원본: tools/golden/lib/invariants.mjs bagDiff, lib/compare.mjs listFiles).
function bagDiff(a, b) {
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
const listFiles = async (dir, pick) => (await readdir(dir)).filter(pick).sort();

export const DEFAULT_WIDTHS = [320, 375, 1280];
/** 이 폭 이하에서만 가로 넘침을 하드로 본다(#211, cpo 댓글 4: 320·375). */
export const NARROW_MAX = 480;

// 페이지 안에서 도는 탐침. 문자열로 넘기므로 바깥 변수를 쓰지 않는다.
const PROBE = `(() => {
  const texts = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const clips = (cs) => cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.clipPath !== "none" || (cs.clip && cs.clip !== "auto");
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,template")) continue;
    const text = n.nodeValue.replace(/[ \\t\\n\\r\\f]+/g, " ").trim();
    if (text === "") continue;
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    let state = "보임";
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true }) || rects.length === 0) state = "숨김";
    else {
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        const box = p.getBoundingClientRect();
        if ((box.width <= 1 || box.height <= 1) && clips(getComputedStyle(p))) {
          state = "가림";
          break;
        }
      }
      if (state === "보임" && rects.every((r) => r.right + scrollX <= 0 || r.bottom + scrollY <= 0)) state = "화면 밖";
    }
    texts.push(JSON.stringify(text) + " " + state);
  }
  return { texts, scrollWidth: document.documentElement.scrollWidth, innerWidth };
})()`;

const FOCUS = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return "(초점 없음)";
  const text = (el.textContent || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 60);
  return el.tagName.toLowerCase() + (el.getAttribute("href") ? "[href=" + el.getAttribute("href") + "]" : "") + (el.id ? "#" + el.id : "") + " " + JSON.stringify(text);
})()`;

/**
 * 폴더의 장들을 폭마다 열어 탐침을 돌린다. 반환: { [file]: { focus, widths: { [폭]: { texts, overflow } } } }.
 * chrome은 launchChrome()이 낸 것(부른 쪽이 닫는다). pages를 안 주면 폴더의 .html 전부.
 */
export async function probeDir(dir, { chrome, pages = null, widths = DEFAULT_WIDTHS, settleMs = 50 } = {}) {
  const files = pages ?? (await listFiles(dir, (f) => f.endsWith(".html")));
  const server = await serveDir(dir);
  const out = {};
  try {
    for (const file of files) {
      const page = await chrome.newPage({ allowOrigin: server.url, js: false, width: widths[0] });
      try {
        const entry = { focus: null, widths: {} };
        for (const width of widths) {
          await page.setWidth(width);
          await page.goto(server.url + file, { settleMs });
          const p = await page.evaluate(PROBE);
          entry.widths[width] = { texts: p.texts, overflow: p.scrollWidth - p.innerWidth };
        }
        // 마지막에 연 폭에서 Tab 한 번.
        for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        entry.focus = await page.evaluate(FOCUS);
        out[file] = entry;
      } finally {
        await page.close();
      }
    }
  } finally {
    await server.close();
  }
  return out;
}

/** 탐침 결과 둘을 견준다(브라우저 없이 도는 순수 함수). 반환: { total, pass, hard, ok, pages:[{file,status,findings}], overflowA } */
export function compareProbes(a, b) {
  const pages = [];
  const overflowA = [];
  for (const file of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const pa = a[file];
    const pb = b[file];
    if (!pa || !pb) {
      pages.push({ file, status: "hard", findings: [{ check: pa ? "후보에 없는 장" : "기준에 없는 장", missing: [], added: [] }] });
      continue;
    }
    const findings = [];
    for (const width of Object.keys(pa.widths)) {
      const wa = pa.widths[width];
      const wb = pb.widths[width];
      if (!wb) continue;
      const d = bagDiff(wa.texts, wb.texts);
      if (d.missing.length || d.added.length) findings.push({ check: `보이는 글자(${width}px)`, missing: d.missing, added: d.added });
      if (Number(width) <= NARROW_MAX) {
        if (wa.overflow > 0) overflowA.push(`${file} ${width}px +${wa.overflow}px`);
        if (wb.overflow > Math.max(wa.overflow, 0)) findings.push({ check: `가로 넘침(${width}px)`, missing: [`기준 +${Math.max(wa.overflow, 0)}px`], added: [`후보 +${wb.overflow}px`] });
      }
    }
    if (pa.focus !== pb.focus) findings.push({ check: "첫 초점(Tab 한 번)", missing: [pa.focus], added: [pb.focus] });
    pages.push({ file, status: findings.length ? "hard" : "pass", findings });
  }
  const hard = pages.filter((p) => p.status === "hard").length;
  return { total: pages.length, pass: pages.length - hard, hard, ok: hard === 0, pages, overflowA };
}

/** 폴더 둘을 같은 Chrome으로 열어 견준다. */
export async function compareRendered(dirA, dirB, { chrome, pages = null, widths = DEFAULT_WIDTHS } = {}) {
  const a = await probeDir(dirA, { chrome, pages, widths });
  const b = await probeDir(dirB, { chrome, pages, widths });
  return { ...compareProbes(a, b), labelA: path.resolve(dirA), labelB: path.resolve(dirB), widths, chrome: chrome.version, probes: { a, b } };
}

const clip = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…(${s.length}자)` : s);

export function formatRenderedReport(r, { maxItems = 8 } = {}) {
  const lines = [
    `렌더 기반 비교(rendered): ${r.total}장 — 통과 ${r.pass}, 하드 실패 ${r.hard} → ${r.ok ? "통과" : "실패"}`,
    `  기준 A: ${r.labelA}`,
    `  후보 B: ${r.labelB}`,
    `  폭 ${r.widths.join("·")}px, 페이지 스크립트 끔, 바깥 요청 막음, ${r.chrome}`,
    `  기준이 이미 가로로 넘치는 곳 ${r.overflowA.length}곳${r.overflowA.length ? `: ${r.overflowA.join(", ")}` : ""}`,
  ];
  for (const p of r.pages.filter((x) => x.status !== "pass")) {
    lines.push(`- ${p.file}: 하드 실패`);
    for (const f of p.findings) {
      lines.push(`    [하드] ${f.check}: 기준에만 ${f.missing.length}, 후보에만 ${f.added.length}`);
      for (const m of f.missing.slice(0, maxItems)) lines.push(`      - ${clip(m)}`);
      if (f.missing.length > maxItems) lines.push(`      - …외 ${f.missing.length - maxItems}개`);
      for (const m of f.added.slice(0, maxItems)) lines.push(`      + ${clip(m)}`);
      if (f.added.length > maxItems) lines.push(`      + …외 ${f.added.length - maxItems}개`);
    }
  }
  return lines.join("\n");
}
