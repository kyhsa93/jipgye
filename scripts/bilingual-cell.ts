/**
 * 두 언어로 구운 표 칸(#708). 표 조각은 빌더가 한국어·영어 두 벌을 데이터 json 에 이미 만들어 둔다(`{ko, en}`). 화면의 스크립트는
 * 데이터를 받은 뒤에야 쓰는 말 쪽을 꽂으므로, 그 전(받는 중·못 받았을 때)의 구운 표는 한국어뿐이었다. 여기서는 두 벌의 같은 자리 칸을
 * 합쳐, 한글이 든 글자만 `<span class="m-ko">…</span><span class="m-en">…</span>` 로 굽는다 - 쓰는 말 아닌 쪽은 CSS(`table .m-ko`·
 * `table .m-en`)가 접근성 트리에서도 뺀다. 숫자처럼 두 벌이 같은 글자, 한글이 없는 글자(「~」·「%p」)는 그대로 둔다(바이트).
 *
 * 순수 함수다 - 파일·시계를 읽지 않는다. 두 조각의 칸 수·표 틀이 다르면(빌더가 어긋난 것) 합치지 않고 한국어 조각을 그대로 돌려준다:
 * 어긋난 칸에 엉뚱한 영어를 붙이느니 한국어로 남기는 쪽이 거짓이 아니다.
 */

export type Cell = { tag: string; attrs: string; inner: string; start: number; end: number; section: string; row: number; col: number };

export const HANGUL = /[가-힣]/;

/** 칸 안의 한글 글자 수(태그 뺀 글자). 바이트 대비 한글이 많은 칸만 두 벌로 굽는 `pick` 이 쓴다. */
export const hangulCount = (html: string) => (html.replace(/<[^>]+>/g, "").match(/[가-힣]/g) ?? []).length;

const CELL = /<(t[hd])((?:\s[^>]*)?)>([\s\S]*?)<\/\1>/g;
const MARK = /<(thead|tbody|tfoot|tr)(?=[\s>])/g;
const TOKEN = /(<[^>]+>)/;
const SPAN = /<span\b[^>]*>|<\/span>/g;

/** 조각 안의 칸을 차례로. 어느 구(thead·tbody·tfoot)의 몇 째 줄·몇 째 칸인지도 센다. */
export function cellsOf(html: string): Cell[] {
  const marks = [...html.matchAll(MARK)].map((m) => ({ at: m.index, name: m[1] }));
  return [...html.matchAll(CELL)].map((m) => {
    const before = marks.filter((x) => x.at < m.index);
    const lastRow = before.findLastIndex((x) => x.name === "tr");
    return {
      tag: m[1],
      attrs: m[2],
      inner: m[3],
      start: m.index,
      end: m.index + m[0].length,
      section: before.findLast((x) => x.name !== "tr")?.name ?? "tbody",
      row: before.filter((x) => x.name === "tr").length - 1,
      col: [...html.slice(before[lastRow]?.at ?? 0, m.index).matchAll(CELL)].length,
    };
  });
}

const both = (ko: string, en: string) => `<span class="m-ko">${ko}</span><span class="m-en">${en}</span>`;

/** 칸 안쪽: 태그 줄이 같으면 한글이 든 글자 조각만 두 벌로, 줄이 다르면 안쪽 전체를 두 벌로. */
function mergeInner(ko: string, en: string) {
  const a = ko.split(TOKEN);
  const b = en.split(TOKEN);
  // 글자 조각만 두 벌로 갈라도 되는 때: 태그 줄이 같고, 두 벌이 다른 글자 조각마다 한국어 쪽에 한글이 있다. 한글 없는 조각이 다르면
  // (「≥」↔「record」처럼 어순이 갈리는 것) 조각끼리 짝이 안 맞으니 안쪽 전체를 두 벌로 한다.
  const splittable =
    a.length === b.length && a.every((t, i) => (i % 2 ? t === b[i] : t === b[i] || HANGUL.test(t)));
  if (!splittable) return both(ko, en);
  return a.map((t, i) => (i % 2 || t === b[i] ? t : both(t, b[i]))).join("");
}

/** 기본: 꼬리(tfoot — 출처·기준일 문장)는 길어서 바이트를 쓰므로 합치지 않는다. 한글이 든 칸만 대상이다. */
const defaultPick = (ko: Cell) => ko.section !== "tfoot";

/**
 * 한국어 표 조각과 영어 표 조각을 칸 단위로 합친다.
 * `pick` 이 거짓인 칸은 한국어 그대로(영어 쪽에서 한글이 남는 칸이 된다 - 호출자가 센다).
 */
export function bilingualCells(ko: string | null | undefined, en: string | null | undefined, pick: (ko: Cell) => boolean = defaultPick) {
  if (!ko) return ko ?? null;
  if (!en) return ko;
  const a = cellsOf(ko);
  const b = cellsOf(en);
  if (a.length !== b.length || a.some((c, i) => c.tag !== b[i].tag || c.section !== b[i].section || c.row !== b[i].row || c.col !== b[i].col)) return ko;
  let out = "";
  let at = 0;
  a.forEach((cell, i) => {
    out += ko.slice(at, cell.start);
    at = cell.end;
    const merge = cell.inner !== b[i].inner && HANGUL.test(cell.inner) && pick(cell);
    out += merge ? `<${cell.tag}${cell.attrs}>${mergeInner(cell.inner, b[i].inner)}</${cell.tag}>` : ko.slice(cell.start, cell.end);
  });
  return out + ko.slice(at);
}

/**
 * 두 벌 칸에서 한 쪽 스팬(`m-ko` 또는 `m-en`)을 걷어 낸 보기. 스팬 안에 스팬이 들어 있을 수 있어(칸 전체를 감싼 경우) 깊이를 세어 닫는 태그를 찾는다.
 */
function dropSpans(html: string, cls: "m-ko" | "m-en") {
  const mark = `class="${cls}"`;
  if (!html.includes(mark)) return html;
  let out = "";
  let at = 0;
  let depth = 0;
  for (const m of html.matchAll(SPAN)) {
    const close = m[0] === "</span>";
    if (!depth) {
      if (!close && m[0].includes(mark)) {
        out += html.slice(at, m.index);
        depth = 1;
      }
    } else if (close) {
      depth -= 1;
      if (!depth) at = m.index + m[0].length;
    } else depth += 1;
  }
  return out + html.slice(at);
}

/** 한국어 보기(영어 스팬 제거) — 표 접근성 문안(table-a11y)이 칸 글자를 읽을 때 한국어·영어가 이어 붙지 않게 한다. */
export const koOnly = (html: string) => dropSpans(html, "m-en");

/** 영어 보기(한국어 스팬 제거) — 영어 화면에서 CSS 가 보여 주는 글자. */
export const enOnly = (html: string) => dropSpans(html, "m-ko");
