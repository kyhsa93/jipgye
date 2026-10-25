/**
 * 표의 접근 가능한 이름과 머리글 방향(#110).
 *
 * 스크린리더가 표를 읽을 때 쓰는 것은 둘이다 - `<th scope>`(이 칸이 열 머리글인지 행
 * 머리글인지)와 `<caption>`(이 표가 무엇인지). 표가 75개인데 scope는 0곳, caption은 1장에
 * 둘뿐이었다. 표마다 손으로 달면 새 표가 생길 때 또 빠지므로, 틀을 채우는 길(applyPrerender)
 * 끝에서 한 번 훑는다 - 빌더가 만든 표도, 틀에 손으로 쓴 표도 같은 길을 지난다.
 *
 * caption은 화면에는 안 보이게(sr-only) 두고, 장마다 다른 숫자를 넣는다: 그 장의 제목, 바로
 * 앞 소제목, 구워진 행 수·열 수. 같은 문장을 49장에 복사하면 반복 콘텐츠가 되기 때문이다
 * (AdSense). 행이 아직 없는 표(자바스크립트가 채우는 표)는 행 수를 쓰지 않는다 - 없는 숫자를
 * 지어 쓰지 않는다. 손으로 쓴 caption(data-auto가 없는 것)은 건드리지 않고, 만든 것은 매번
 * 새로 쓴다 - 행 수가 바뀌어도 낡은 숫자가 남지 않게.
 *
 * 스크립트 안 문자열의 표는 여기서 못 고친다. 그런 표는 틀에서 직접 scope·caption을 단다.
 *
 * 표 틀 속성(#707) - 모양만 말하던 caption 에 표가 말하는 것 한 줄과 영어 문안을 얹는다. 속성이 없는 표는 그대로다.
 *   data-summary="열 이름"  그 열(머리글 글자가 같은 열)의 숫자로 「가장 높은 행 X(값)·가장 낮은 행 Y(값)·서울 Z」 한 줄.
 *                           값은 구운 칸의 첫 숫자 글자 그대로다(새로 셈하지 않는다). 숫자가 아닌 칸·칸 수가 머리글과 다른 행은 건너뛴다.
 *                           높고 낮음은 「서울」 행을 뺀 행끼리 비교하고, 서울 행이 없으면 그 조각을 쓰지 않는다. 형용사·해석 0.
 *   data-summary-label="N"  행 이름을 앞 N칸을 「·」로 이은 것으로(기본 1칸). 선행 거래·기간처럼 한 칸으로 행이 안 갈릴 때.
 *   data-caption-en="..."   영어 제목(영어 쪽에는 요약한 열을 이 제목에 적는다). 있으면 caption 을 `<span class="m-ko">`·`<span class="m-en">`
 *                           두 벌로 굽고 영어 쪽에는 한글이 없다(CSS 가 쓰는 말 아닌 쪽을 숨긴다). 바이트를 아끼려고 나가는 표에서는 이 속성을
 *                           떼고, 이미 두 벌로 구운 caption 은 다시 돌려도 그대로 둔다.
 *   lang="en"               영어 구역 안의 표. 한국어 장 제목을 빼고 영어 소제목·영어 머리글로만 한 문안을 쓴다.
 */

import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { REGIONS } from "./outlook.ts";

const AUTO = ' class="sr-only" data-auto';
const HANGUL = /[가-힣]/;

const escapeText = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function scoped(part, scope) {
  return part.replace(/<th(?=[\s>])([^>]*)>/g, (tag, attrs) =>
    /\sscope=/.test(attrs) ? tag : `<th scope="${scope}"${attrs}>`
  );
}

const unescapeAttr = (s) => s.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const attrOf = (open, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(open);
  return m ? unescapeAttr(m[1]) : null;
};
const squash = (s) => s.replace(/\s+/g, "");

const SEOUL_ROW = /^(서울( 전체)?|Seoul( total)?)$/;
/** 칸의 맨 앞 숫자 글자 그대로(단위 포함). 숫자로 시작하지 않는 칸(비움·-·문장)은 null. */
const VALUE = /^\s*([+\-−]?\d[\d,]*(?:\.\d+)?(?:%p|%|만원)?)/;

/** 영어 문안의 행 이름. 자치구·권역은 로마자·영어 이름, 건·일은 단위만 옮기고, 그래도 한글이 남으면 몇 번째 행인지로 쓴다. */
function rowNameEn(parts, position) {
  const one = (part) => {
    if (!HANGUL.test(part)) return part;
    if (SEOUL_ROW.test(part)) return "Seoul";
    const slug = DISTRICT_SLUGS[part];
    if (slug) return `${slug[0].toUpperCase()}${slug.slice(1)}-gu`;
    const region = REGIONS.find((r) => r.name.ko === part);
    if (region) return region.name.en;
    return part.replace(/(\d[\d,]*)건↑/g, "$1+ deals").replace(/(\d[\d,]*)일/g, "$1 days");
  };
  const name = parts.map(one).join(", ");
  return HANGUL.test(name) ? `number ${position}` : name;
}

/** data-summary 열의 구운 숫자로 만든 조각들. 숫자 칸이 없으면 null. 값은 칸 글자 그대로다. */
function summaryParts({ rest, heads, column, labelCells }) {
  const at = heads.findIndex((h) => squash(h) === squash(column));
  if (at === -1) return null;
  const rows = [];
  let position = 0;
  for (const tr of rest.replace(/<tfoot[\s\S]*?<\/tfoot>/g, "").matchAll(/<tr(?=[\s>])[^>]*>([\s\S]*?)<\/tr>/g)) {
    position += 1;
    const cells = [...tr[1].matchAll(/<t([hd])(?=[\s>])[^>]*>([\s\S]*?)<\/t\1>/g)].map((m) => plain(m[2].replaceAll("&minus;", "−")));
    if (cells.length !== heads.length) continue;
    const value = VALUE.exec(cells[at])?.[1];
    if (!value) continue;
    rows.push({ parts: cells.slice(0, labelCells), position, value, number: Number.parseFloat(value.replaceAll(",", "").replace("−", "-")) });
  }
  const seoul = rows.find((r) => r.parts.length === 1 && SEOUL_ROW.test(r.parts[0]));
  const others = rows.filter((r) => r !== seoul);
  if (!others.length) return seoul ? { seoul, high: null, low: null } : null;
  const high = others.reduce((a, b) => (b.number > a.number ? b : a), others[0]);
  const low = others.reduce((a, b) => (b.number < a.number ? b : a), others[0]);
  const spread = others.length > 1 && high.number !== low.number;
  if (!seoul && !spread) return null;
  return { seoul, high: spread ? high : null, low: spread ? low : null };
}

function summaryText(found, column, korean) {
  if (!found) return "";
  const { seoul, high, low } = found;
  const name = (r) => (korean ? r.parts.join("·") : rowNameEn(r.parts, r.position));
  const pieces = korean
    ? [high && `가장 높은 행 ${name(high)}(${high.value})`, low && `가장 낮은 행 ${name(low)}(${low.value})`, seoul && `서울 ${seoul.value}`]
    : [high && `highest row ${name(high)} (${high.value})`, low && `lowest row ${name(low)} (${low.value})`, seoul && `Seoul ${seoul.value}`];
  const body = pieces.filter(Boolean).join(korean ? "·" : ", ");
  if (korean) return `${column ? `${column}: ` : ""}${body}`;
  return column ? `${column}: ${body}` : `${body[0].toUpperCase()}${body.slice(1)}`;
}

/** 영어 제목만 있는 영어 caption: 열 이름은 한글일 수 있어 쓰지 않고 행·열 수만 쓴다. */
function captionEnglish({ subject, rows, cols }) {
  if (!cols) return subject;
  return `${subject}: ${rows ? `${rows} row${rows === 1 ? "" : "s"}, ` : ""}${cols} column${cols === 1 ? "" : "s"}`;
}

function captionText({ title, heading, rows, heads }) {
  const korean = HANGUL.test(`${title}${heading}`);
  const subject = [title, heading].filter(Boolean).join(" - ");
  // 머리글도 행도 아직 없는 표(자바스크립트가 통째로 채운다)는 지어 쓸 숫자가 없다 - 제목만 쓴다.
  if (!heads.length) return subject;
  const shown = heads.slice(0, 4).join(korean ? "·" : ", ") + (heads.length > 4 ? (korean ? " 등" : ", …") : "");
  return korean
    ? `${subject}: ${rows ? `${rows}행 ` : ""}${heads.length}열(${shown})`
    : `${subject}: ${rows ? `${rows} row${rows === 1 ? "" : "s"}, ` : ""}${heads.length} column${heads.length === 1 ? "" : "s"} (${shown})`;
}

export function accessibleTables(html) {
  const title = plain(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "");

  return html.replace(
    /(<script[\s\S]*?<\/script>)|(<table(?=[\s>])[^>]*>)([\s\S]*?)<\/table>/g,
    (whole, script, open, inner, offset) => {
      if (script) return script;

      // 이미 두 벌로 구운 caption(data-caption-en 은 나가는 표에서 뗀다)은 다시 쓰지 않는다 - 영어 제목을 다시 만들 길이 없다.
      const bilingual = !/\sdata-caption-en=/.test(open) && /<caption[^>]*data-auto[^>]*><span class="m-ko">/.test(inner);
      const body = bilingual ? inner : inner.replace(/<caption[^>]*data-auto[^>]*>[\s\S]*?<\/caption>/, "");
      const bodyAt = body.search(/<tbody(?=[\s>])/);
      const head = bodyAt === -1 ? body : body.slice(0, bodyAt);
      const rest = bodyAt === -1 ? "" : body.slice(bodyAt);
      const fixed = scoped(head, "col") + scoped(rest, "row");

      if (/<caption(?=[\s>])/.test(fixed)) return `${open}${fixed}</table>`;

      const heads = [...head.matchAll(/<th(?=[\s>])[^>]*>([\s\S]*?)<\/th>/g)].map((m) => plain(m[1])).filter(Boolean);
      // 표 꼬리(tfoot, 출처·기준일 한 줄)는 자료 행이 아니다 - 행 수에 넣지 않는다(#677).
      const rows = (rest.replace(/<tfoot[\s\S]*?<\/tfoot>/g, "").match(/<tr(?=[\s>])/g) ?? []).length;
      const heading = plain([...html.slice(0, offset).matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].at(-1)?.[1] ?? "");

      const english = /\slang="en"/.test(open);
      const captionEn = attrOf(open, "data-caption-en");
      const column = attrOf(open, "data-summary");
      const found = column
        ? summaryParts({ rest, heads, column, labelCells: Math.max(1, Number(attrOf(open, "data-summary-label")) || 1) })
        : null;
      // 영어 구역의 표는 한국어 장 제목을 빼고 영어 소제목·머리글만으로 쓴다(영어 caption 에 한글 0자).
      const used = english && HANGUL.test(title) ? "" : title;
      const korean = HANGUL.test(`${used}${heading}`);
      const base = captionText({ title: used, heading, rows, heads });
      const sentence = (ko, label) => {
        const text = summaryText(found, label, ko);
        return text ? `. ${text}` : "";
      };
      let text = escapeText(`${base}${sentence(korean, column)}`);
      if (captionEn && !english) {
        const en = captionEnglish({ subject: captionEn, rows, cols: heads.length }) + sentence(false, "");
        text = `<span class="m-ko">${text}</span><span class="m-en">${escapeText(en)}</span>`;
      }
      return `${open.replace(/\sdata-caption-en="[^"]*"/, "")}<caption${AUTO}>${text}</caption>${fixed}</table>`;
    }
  );
}
