// 렌더 기반 접근성 검사(#325 = #278 PR A). 구운 폴더를 헤드리스 Chrome으로 열어, **브라우저가 실제로 그린
// 결과**에서 #274 체인 공통 규칙 1번의 ①~⑤를 잰다.
//
//   ① 가시 텍스트 다중집합(375·1280)   — 기준 폴더를 같이 줄 때만(`baseline`). 유틸리티로 숨긴 글자를 잡는다.
//   ② 가로 넘침(320·375)
//   ③ 대화형 요소 크기 44px · 입력칸 글자 16px · 글자 크기 하한 · 네 모드 각각의 대비 4.5:1
//   ④ 건너뛰기 링크가 첫 초점이고 #main으로 간다
//   ⑤ 영어 모드에서도 ①~③
//
// **입력이 매일 바뀌는 측정은 CI에 넣지 않는다**(#8 재발 방지 R3, `tools/golden`의 `test` ↔ `test:live`와 같은 선).
// 실제 `docs/`를 읽는 전수 검사는 PR 증빙이고, CI에서 상시로 도는 것은 고정 fixture를 읽는 `test/`의 변이 시험뿐이다.
import path from "node:path";
import { readdir } from "node:fs/promises";
import { serveDir } from "./serve.ts";
import { CONTRAST_PROBE, FIELD_PROBE, FOCUS_PROBE, FONT_PROBE, NARROW_WIDTHS, OVERFLOW_PROBE, TAP_PROBE, TEXT_PROBE, TEXT_WIDTHS } from "./probe.ts";

export { CONTRAST_LARGE, CONTRAST_NORMAL, FIELD_MIN, FONT_MIN, NARROW_WIDTHS, TAP_MIN, TAP_MIN_WIDTH, TEXT_WIDTHS } from "./probe.ts";

/**
 * 네 모드(test/style.test.mjs "네 갈래 팔레트"와 같은 넷):
 *   `:root` · `@media (prefers-color-scheme: dark)`의 `:root` · `[data-theme="dark"]` · `[data-theme="light"]`.
 * 앞의 둘은 **시스템 설정**이라 CDP의 `Emulation.setEmulatedMedia`로, 뒤의 둘은 **사람이 고른 것**이라
 * 루트 속성으로 흉내 낸다. 속성은 페이지 스크립트가 아니라 **우리가** 건다 — 스크립트를 끈 채로도
 * 같은 넷을 재야 하고(검사 ②의 "스크립트 끔"), 페이지가 localStorage를 어떻게 읽는지에 기대면
 * 그 구현이 바뀔 때 검사가 조용히 한 갈래만 재게 된다.
 */
export const MODES = [
  { name: "auto-light", scheme: "light", attr: null },
  { name: "auto-dark", scheme: "dark", attr: null },
  { name: "light", scheme: "light", attr: "light" },
  { name: "dark", scheme: "dark", attr: "dark" },
];

/** 검사 이름 → #274 체인 공통 규칙 1번의 번호. 보고서와 시험이 같은 이름을 쓴다. */
export const CHECKS = {
  "가시 텍스트": "①",
  "가로 넘침": "②",
  "대화형 요소 크기": "③",
  "입력칸 글자 크기": "③",
  "글자 크기 하한": "③",
  대비: "③",
  "건너뛰기 링크": "④",
};

const listPages = async (dir) => (await readdir(dir)).filter((f) => f.endsWith(".html")).sort();

/** 영어 모드는 페이지 스크립트가 번역한다 — 스크립트를 끄면 영어 화면 자체가 없다. */
export const EN_INIT = `try { localStorage.setItem("lang", "en"); } catch (e) {}`;

const bagDiff = (a, b) => {
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
};

/**
 * 장 하나를 재서 위반 목록을 낸다. `page`는 이미 그 장을 연 CDP 페이지다.
 * 반환: { findings: [{check, where, detail}], unmeasurable: [...], texts: {폭: [...]}}.
 */
export async function probePage(page, { url, settleMs = 0, wantTexts = false }: { url?: string; settleMs?: number; wantTexts?: boolean } = {}) {
  const findings = [];
  const unmeasurable = [];
  // **무엇을 몇 개나 봤는지**를 같이 센다. "위반 0건"만 돌려주면 "깨끗하다"와 "안 봤다"를 가를 수 없다
  // (#325 완료 조건 1-a의 경고: 0건 보고는 먼저 "도구가 안 본다"의 증거로 읽는다).
  const checked = { "대화형 요소 크기": 0, "입력칸 글자 크기": 0, "글자 크기 하한": 0, 대비: 0 };

  // ② 가로 넘침 — 좁은 폭부터. 폭을 바꾸면 레이아웃이 다시 돌아 다시 열 필요가 없다.
  for (const width of NARROW_WIDTHS) {
    await page.setWidth(width);
    const r = await page.evaluate(OVERFLOW_PROBE);
    if (r.over > 0) findings.push({ check: "가로 넘침", where: `${width}px`, detail: `+${r.over}px${r.culprits.length ? ` (${r.culprits.join(", ")})` : ""}` });
    // ③ 터치 크기는 **가장 좁은 폭**에서 가장 잘 깨진다(알약이 접히며 높이가 준다). 두 폭 다 본다.
    const tap = await page.evaluate(TAP_PROBE);
    checked["대화형 요소 크기"] += tap.checked;
    for (const t of tap.bad) {
      findings.push({ check: "대화형 요소 크기", where: `${width}px`, detail: `${t.el} ${t.w}×${t.h}px (${t.why})${t.text ? ` "${t.text}"` : ""}` });
    }
  }

  // ③ 입력칸·글자 크기는 375px에서 한 번. 폭에 따라 달라지는 자리가 아니다(미디어쿼리로 바꾼다면 320도 걸린다).
  await page.setWidth(375);
  const field = await page.evaluate(FIELD_PROBE);
  checked["입력칸 글자 크기"] += field.checked;
  for (const f of field.bad) findings.push({ check: "입력칸 글자 크기", where: "375px", detail: `${f.el} ${f.px}px` });
  const font = await page.evaluate(FONT_PROBE);
  checked["글자 크기 하한"] += font.checked;
  for (const f of font.bad) findings.push({ check: "글자 크기 하한", where: "375px", detail: `${f.el} ${f.px}px "${f.text}"` });

  // ③ 대비 — 네 모드 각각.
  for (const mode of MODES) {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode.scheme }] });
    await page.evaluate(mode.attr ? `document.documentElement.setAttribute("data-theme", ${JSON.stringify(mode.attr)})` : `document.documentElement.removeAttribute("data-theme")`);
    const r = await page.evaluate(CONTRAST_PROBE);
    checked["대비"] += r.checked;
    for (const c of r.bad) findings.push({ check: "대비", where: `375px·${mode.name}`, detail: `${c.el} ${c.ratio}:1 < ${c.want}:1 (${c.fg} on ${c.bg}, ${c.px}px${c.bold ? " 굵게" : ""}) "${c.text}"` });
    for (const u of r.unmeasurable) unmeasurable.push({ where: `375px·${mode.name}`, detail: `${u.el}: ${u.why}` });
  }
  // 모드를 되돌린다 — 다음 측정(초점·텍스트)이 마지막 모드에 묻지 않게.
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await page.evaluate(`document.documentElement.removeAttribute("data-theme")`);

  // ④ 건너뛰기 링크 — Tab 한 번. 초점 상태는 되돌릴 수 없으므로(한 번 누르면 다음 것으로 간다) 마지막에 가깝게 둔다.
  for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  const focus = await page.evaluate(FOCUS_PROBE);
  if (focus.href !== "#main") {
    findings.push({ check: "건너뛰기 링크", where: "375px", detail: `Tab 한 번 뒤 초점이 ${focus.el}${focus.href ? `[href=${focus.href}]` : ""} — #main으로 가는 건너뛰기 링크가 아니다` });
  }

  // ① 가시 텍스트 — 기준과 견줄 때만 모은다(혼자서는 판정할 수 없다).
  const texts = {};
  if (wantTexts) {
    for (const width of TEXT_WIDTHS) {
      await page.setWidth(width);
      // 폭이 바뀌면 줄바꿈이 달라질 뿐 텍스트 노드는 그대로다. 다시 열지 않는다 —
      // 다시 열면 초점이 풀리고, 스크립트를 켠 장은 데이터를 다시 받아 값이 흔들린다.
      texts[width] = await page.evaluate(TEXT_PROBE);
    }
  }
  return { url, findings, unmeasurable, checked, texts };
}

/**
 * 폴더 하나를 재다. `js`는 페이지 스크립트를 켤지, `lang`은 "ko"|"en".
 * 반환: { dir, js, lang, pages: { [file]: {findings, unmeasurable, texts} } }
 */
export async function checkDir(dir, { chrome, pages = null, js = false, lang = "ko", settleMs = null, wantTexts = false, onPage = null }: { chrome?: any; pages?: string[] | null; js?: boolean; lang?: string; settleMs?: number | null; wantTexts?: boolean; onPage?: ((file: string, r: any) => void) | null } = {}) {
  if (lang === "en" && !js) throw new Error("영어 모드는 페이지 스크립트가 번역한다 — js:false로는 잴 수 없다(검사 ⑤).");
  const files = pages ?? (await listPages(dir));
  const server = await serveDir(dir);
  const wait = settleMs ?? (js ? 250 : 0);
  const out = {};
  try {
    for (const file of files) {
      const page = await chrome.newPage({ allowOrigin: server.url, js, width: NARROW_WIDTHS[0], colorScheme: "light", initScript: lang === "en" ? EN_INIT : null });
      try {
        await page.goto(server.url + file, { settleMs: wait });
        out[file] = await probePage(page, { url: file, settleMs: wait, wantTexts });
        if (page.blocked.length) out[file].blocked = [...new Set(page.blocked)];
      } finally {
        await page.close();
      }
      onPage?.(file, out[file]);
    }
  } finally {
    await server.close();
  }
  return { dir: path.resolve(dir), js, lang, pages: out };
}

/** 검사 ①: 기준과 후보의 가시 텍스트 다중집합을 견준다. `checkDir(..., {wantTexts:true})` 결과 둘을 받는다. */
export function compareTexts(base, cand) {
  const findings = [];
  for (const file of Object.keys(cand.pages).sort()) {
    const a = base.pages[file];
    const b = cand.pages[file];
    if (!a) {
      findings.push({ page: file, check: "가시 텍스트", where: "-", detail: "기준 폴더에 없는 장이다" });
      continue;
    }
    for (const width of TEXT_WIDTHS) {
      const d = bagDiff(a.texts[width] ?? [], b.texts[width] ?? []);
      if (d.missing.length === 0 && d.added.length === 0) continue;
      const show = (xs) => xs.slice(0, 4).map((x) => `    ${x}`).join("\n") + (xs.length > 4 ? `\n    …외 ${xs.length - 4}개` : "");
      findings.push({
        page: file,
        check: "가시 텍스트",
        where: `${width}px`,
        detail: `기준에만 ${d.missing.length}줄 · 후보에만 ${d.added.length}줄\n${d.missing.length ? `  - 기준에만\n${show(d.missing)}` : ""}${d.missing.length && d.added.length ? "\n" : ""}${d.added.length ? `  + 후보에만\n${show(d.added)}` : ""}`,
      });
    }
  }
  return findings;
}

/** 검사 ① 결과를 후보 실행 안으로 넣는다 — 보고서가 장 단위로 한 줄을 내려면 장에 붙어 있어야 한다. */
export function mergeTextFindings(cand, findings) {
  for (const f of findings) {
    const page = cand.pages[f.page] ?? (cand.pages[f.page] = { url: f.page, findings: [], unmeasurable: [], texts: {} });
    page.findings.push({ check: f.check, where: f.where, detail: f.detail });
  }
  return cand;
}

/** `checkDir` 의 반환 모양 중 집계·보고서가 읽는 부분. */
type Run = { dir?: string; js?: boolean; lang?: string; pages: Record<string, any> };

/** 실행 여럿을 한 줄짜리 집계로. 반환: { total, byCheck } */
export function summarize(runs: Run[]) {
  const byCheck = {};
  let total = 0;
  for (const run of runs) {
    for (const r of Object.values(run.pages)) {
      for (const f of r.findings) {
        byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
        total += 1;
      }
    }
  }
  return { total, byCheck };
}

const modeLabel = (run) => `${run.lang === "en" ? "영어" : "한국어"}\u00b7스크립트 ${run.js ? "켬" : "끔"}`;

/**
 * 전수 보고서. **장마다 한 줄**이다 — 위반 0건인 장도 "0건"으로 한 줄을 차지한다.
 * 빠지면 "안 쟀다"와 구별이 안 된다(#325 완료 조건 1-c).
 */
export function formatReport(runs: Run[], { detail = true }: { detail?: boolean } = {}) {
  const lines = [];
  const s = summarize(runs);
  for (const run of runs) {
    lines.push(`## ${modeLabel(run)} — ${Object.keys(run.pages).length}장 (${run.dir})`);
    for (const file of Object.keys(run.pages).sort()) {
      const all = run.pages[file].findings;
      const by = {};
      for (const f of all) by[f.check] = (by[f.check] ?? 0) + 1;
      const tail = all.length ? ` (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(" \u00b7 ")})` : "";
      lines.push(`${file}\t${modeLabel(run)}\t위반 ${all.length}건${tail}`);
    }
  }
  lines.push("");
  lines.push(`합계: 위반 ${s.total}건 — ${Object.entries(s.byCheck).map(([k, n]) => `${k}(${CHECKS[k] ?? "?"}) ${n}`).join(" \u00b7 ") || "없음"}`);
  const unm = runs.flatMap((run) => Object.entries(run.pages).flatMap(([file, r]) => r.unmeasurable.map((u) => `${file} ${modeLabel(run)} ${u.where} ${u.detail}`)));
  lines.push(`측정 불가(배경이 이미지\u00b7그러데이션이라 색으로 못 잼): ${unm.length}건`);
  const seen = {};
  for (const run of runs) for (const r of Object.values(run.pages)) for (const [k, n] of Object.entries(r.checked ?? {})) seen[k] = (seen[k] ?? 0) + n;
  lines.push(`잰 것(위반이 아니라 **본 개수**): ${Object.entries(seen).map(([k, n]) => `${k} ${n}`).join(" \u00b7 ")}`);

  if (detail) {
    lines.push("");
    lines.push("### 항목별 상세");
    for (const run of runs) {
      for (const file of Object.keys(run.pages).sort()) {
        const all = run.pages[file].findings;
        if (all.length === 0) continue;
        lines.push(`- ${file} [${modeLabel(run)}]`);
        for (const f of all) lines.push(`    ${CHECKS[f.check] ?? "?"} ${f.check} [${f.where}] ${f.detail}`);
      }
    }
    for (const u of unm) lines.push(`    (측정 불가) ${u}`);
  }
  return lines.join("\n");
}
