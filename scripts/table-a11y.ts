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
 */

const AUTO = ' class="sr-only" data-auto';

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

function captionText({ title, heading, rows, heads }) {
  const korean = /[가-힣]/.test(`${title}${heading}`);
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

      const body = inner.replace(/<caption[^>]*data-auto[^>]*>[\s\S]*?<\/caption>/, "");
      const bodyAt = body.search(/<tbody(?=[\s>])/);
      const head = bodyAt === -1 ? body : body.slice(0, bodyAt);
      const rest = bodyAt === -1 ? "" : body.slice(bodyAt);
      const fixed = scoped(head, "col") + scoped(rest, "row");

      if (/<caption(?=[\s>])/.test(fixed)) return `${open}${fixed}</table>`;

      const heads = [...head.matchAll(/<th(?=[\s>])[^>]*>([\s\S]*?)<\/th>/g)].map((m) => plain(m[1])).filter(Boolean);
      const rows = (rest.match(/<tr(?=[\s>])/g) ?? []).length;
      const heading = plain([...html.slice(0, offset).matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].at(-1)?.[1] ?? "");
      const caption = `<caption${AUTO}>${escapeText(captionText({ title, heading, rows, heads }))}</caption>`;
      return `${open}${caption}${fixed}</table>`;
    }
  );
}
