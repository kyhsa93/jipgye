// 변이 fixture를 만든다(#325 완료 조건 1-b). 기준 fixture를 임시 폴더로 복사한 뒤 **이름 붙은 패치 하나**를 건다.
//
// 왜 파일로 안 두고 매번 만드나: 변이가 열하나인데 각각 폴더를 두면 같은 style.css가 열한 벌이 되고,
// 기준을 한 줄 고칠 때 열한 곳을 따라 고쳐야 한다. 그러면 "기준과 변이가 그 한 줄만 다르다"가 무너진다.
//
// ⚠️ **패치가 안 걸리면 그 자리에서 던진다.** 조용히 아무것도 안 바꾸면 변이 시험이 **기준을 재면서
// 통과**하게 된다 — 이 시험이 막으려는 바로 그 모양이다(PR #314의 첫 판 가드: 돌연변이 27/27 통과).
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const BASE = path.resolve(import.meta.dirname, "../fixtures/base");

type Mutation = { check: string; file: string; find: string; put: string; baseline?: boolean; lang?: string; js?: boolean };

/**
 * 변이 목록. `check`는 이 변이가 걸려야 하는 #274 체인 공통 규칙 1번의 검사 이름이고,
 * `lang`·`js`·`baseline`은 그 변이를 보려면 어떤 조건으로 돌려야 하는지다.
 */
export const MUTATIONS: Record<string, Mutation> = {
  // ① 유틸리티 class로 본문 한 블록 숨김 — 네 가지 각각. 글자는 HTML에 그대로 있다(parse5는 통과시킨다).
  "tw:hidden": { check: "가시 텍스트", baseline: true, file: "index.html", find: `<section id="block">`, put: `<section id="block" class="tw:hidden">` },
  "tw:sr-only": { check: "가시 텍스트", baseline: true, file: "index.html", find: `<section id="block">`, put: `<section id="block" class="tw:sr-only">` },
  "tw:invisible": { check: "가시 텍스트", baseline: true, file: "index.html", find: `<section id="block">`, put: `<section id="block" class="tw:invisible">` },
  "tw:opacity-0": { check: "가시 텍스트", baseline: true, file: "index.html", find: `<section id="block">`, put: `<section id="block" class="tw:opacity-0">` },

  // ② 대비 4.5:1 미달 — **`[data-theme="dark"]` 한 갈래에서만** 깨뜨린다. 네 모드를 다 도는지까지 함께 건다.
  대비: {
    check: "대비",
    file: "style.css",
    find: `:root[data-theme="dark"] {\n  --bg: #13151a;\n  --fg: #eceef2;\n  --muted: #a9b0bd;`,
    put: `:root[data-theme="dark"] {\n  --bg: #13151a;\n  --fg: #eceef2;\n  --muted: #3f4451;`,
  },

  // ③ 44px 미만 대화형 요소.
  "대화형 요소 크기": {
    check: "대화형 요소 크기",
    file: "style.css",
    find: `  justify-content: center;\n  min-height: var(--tap);\n  min-width: var(--tap);`,
    put: `  justify-content: center;\n  min-height: 30px;\n  min-width: var(--tap);`,
  },

  // ④ 입력 글자 16px 미만.
  "입력칸 글자 크기": {
    check: "입력칸 글자 크기",
    file: "style.css",
    find: `  background: var(--bg);\n  color: var(--fg);\n  font-size: 16px;`,
    put: `  background: var(--bg);\n  color: var(--fg);\n  font-size: 13px;`,
  },

  // ⑤ 320·375폭에서 넘치는 표 — 가로 스크롤 상자를 떼면 표가 문서를 넓힌다(#211과 같은 모양).
  "가로 넘침": { check: "가로 넘침", file: "style.css", find: `.scroller { overflow-x: auto; }`, put: `.scroller { overflow-x: visible; }` },

  // ⑥ 건너뛰기 링크 — 지우는 것과 #content 아닌 곳으로 보내는 것, 둘 다.
  "건너뛰기 링크 없음": { check: "건너뛰기 링크", file: "index.html", find: `<a class="skip-link" href="#content">본문 바로가기</a>\n`, put: `` },
  "건너뛰기 링크가 #main이 아님": { check: "건너뛰기 링크", file: "index.html", find: `<a class="skip-link" href="#content">`, put: `<a class="skip-link" href="#top">` },

  // ⑦ **영어 모드에서만** 나는 위반(①~⑤ 중 글자 크기 하한). 한국어로 돌면 안 걸린다 — 그것까지 시험이 건다.
  "영어 모드에서만": {
    check: "글자 크기 하한",
    lang: "en",
    js: true,
    file: "index.html",
    find: `    var t = T[lang];\n`,
    put: `    var t = T[lang];\n    if (lang === "en") document.getElementById("note").style.fontSize = "10px";\n`,
  },
};

/** 기준 fixture를 임시 폴더로 복사하고 패치 하나를 건다. 반환: 그 폴더 경로. */
export async function makeMutant(name) {
  const m = MUTATIONS[name];
  if (!m) throw new Error(`모르는 변이: ${name}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "jipgye-render-mutant-"));
  await cp(BASE, dir, { recursive: true });
  const target = path.join(dir, m.file);
  const before = await readFile(target, "utf8");
  const hits = before.split(m.find).length - 1;
  if (hits !== 1) throw new Error(`변이 "${name}": ${m.file}에서 찾을 자리가 ${hits}곳이다(1곳이어야 한다). 기준 fixture가 바뀌었는지 본다.`);
  await writeFile(target, before.replace(m.find, m.put));
  return dir;
}
