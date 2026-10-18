// 찍어낸 장의 구운 `h1` (#295).
//
// 틀 `scripts/realestate-template.html`에서 찍어내는 46장(예산대 18·자치구 25·거래유형 3)은 틀의
// `<h1 id="page-title">서울 아파트 시세</h1>`를 그대로 물려받았고, 화면 스크립트 `applyLocale()`이 열린
// 뒤에야 그 장의 제목으로 바꿨다. 그래서 스크립트를 돌리지 않는 쪽(크롤러의 첫 수집·스크립트 차단·읽기
// 모드)이 받는 `h1`이 47장 모두 같았고, 예산대 18장에서는 바뀐 제목이 폭 412에서 두 줄이 되며 머리 아래가
// 35px 밀렸다(#288 뒤 남던 CLS 0.03~0.05).
//
// 그래서 생성 스크립트가 `h1`을 굽는다. 다만 **글자를 새로 정하지 않는다**(#295 범위 1): 그 장에 실려
// 나가는 한국어 사전에서 `applyLocale()`과 같은 규칙으로 고른 글자를 그대로 굽는다. 화면에 보이는 글자는
// 바뀌지 않고, 글자의 출처도 사전 하나로 남는다 — 사전을 고치면 구운 글자가 따라온다.
//
// 반대 방향(사전은 그대로인데 고르는 규칙만 여기서 갈라지는 것)은 `test/baked-h1.test.mjs`가 막는다.
// 그 시험은 찍어낸 46장을 전수로 열어 **그 장에 실린 스크립트를 실제로 돌리고** `h1`에 들어간 글자를
// 구운 글자와 견준다. 한쪽만 고치면 거기서 깨진다(cpo 권고, #295 완료 조건 5).
//
// 영어는 건드리지 않는다. 지금처럼 구운 한국어 `h1`이 먼저 보이고 `applyLocale()`이 영어로 바꾼다.
import { escapeHtml } from "./html-escape.mjs";

/** 틀에 있는 `h1` 한 줄. 생성 스크립트가 이 줄을 통째로 바꾼다. */
export const BASE_H1 = '<h1 id="page-title">서울 아파트 시세</h1>';

const KO_DICT_START = "const T = {\n  ko: {";
const EN_DICT_START = "\n  en: {";

/** 인라인 스크립트의 한국어 문자열표(`T.ko`) 블록만 잘라 낸다. 영어 블록의 같은 이름에 걸리지 않게 하려는 것이다. */
function koBlock(html) {
  const start = html.indexOf(KO_DICT_START);
  if (start < 0) throw new Error("한국어 문자열표를 찾지 못했습니다");
  const end = html.indexOf(EN_DICT_START, start);
  if (end < 0) throw new Error("한국어 문자열표의 끝(영어 문자열표)을 찾지 못했습니다");
  return html.slice(start, end);
}

/** `키: "값",` 한 줄. 값은 JSON 문자열 리터럴이라 그대로 파싱한다(생성 스크립트가 `JSON.stringify`로 써 넣는 것과 같은 모양). */
function koString(block, key) {
  const m = new RegExp(`\\n {4}${key}: ("(?:[^"\\\\]|\\\\.)*"),\\n`).exec(block);
  if (!m) throw new Error(`한국어 문자열표에서 ${key}를 찾지 못했습니다`);
  return JSON.parse(m[1]);
}

/** `districtTitle: (name) => \`${name} 아파트 시세\`,` — 구 이름 뒤에 붙는 꼬리만 읽어 같은 글자를 만든다. */
function koDistrictTitle(block) {
  const m = /\n {4}districtTitle: \(name\) => `\$\{name\}([^`]*)`,\n/.exec(block);
  if (!m) throw new Error("한국어 문자열표에서 districtTitle을 찾지 못했습니다");
  return (name) => `${name}${m[1]}`;
}

/**
 * 그 장의 한국어 화면에서 `applyLocale()`이 `h1`에 넣는 글자.
 *
 * 고르는 규칙은 `scripts/realestate-template.html`의 `applyLocale()` 첫 두 줄과 같다 — 자치구 장이면 `districtTitle(구 이름)`,
 * 거래유형 장이면 `titleSale`·`titleJeonse`·`titleWolse`, 그 밖(틀·예산대)이면 `title`이다. 예산대 장은 생성
 * 스크립트가 사전의 `title`을 그 장 제목으로 이미 바꿔 두므로, **사전 패치 뒤에** 불러야 그 장의 글자가 나온다.
 */
export function koHeading(html, { kind = null, districtName = null } = {}) {
  const block = koBlock(html);
  if (districtName) return koDistrictTitle(block)(districtName);
  const key = kind === "sale" ? "titleSale" : kind === "jeonse" ? "titleJeonse" : kind === "wolse" ? "titleWolse" : "title";
  return koString(block, key);
}

/** `h1` 한 줄을 그 장의 제목으로 바꾼 HTML. 못 찾으면 던진다(틀이 바뀌었는데 조용히 틀의 글자가 나가는 것이 더 나쁘다). */
export function bakeHeading(html, heading) {
  if (!html.includes(BASE_H1)) throw new Error(`장 제목(h1)을 찾지 못했습니다: ${BASE_H1}`);
  return html.replace(BASE_H1, `<h1 id="page-title">${escapeHtml(heading)}</h1>`);
}

/** 사전에서 고른 글자를 그대로 굽는다. 생성 스크립트 셋이 부르는 한 줄. */
export function bakeKoHeading(html, options) {
  return bakeHeading(html, koHeading(html, options));
}
