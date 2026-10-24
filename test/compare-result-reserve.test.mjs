// switch-house #compare-result 높이 예약 (#538). 실패하면 이 자리에 쓸 수 없음 문장(한 줄)이 선다 - 예약이 그 한 줄을 이미 잡고 있어야
// 실패 전후 #compare-section 높이 변화가 0 이다. 폭 ≤430 은 2줄(예전부터), 431 이상은 1줄(26.3px, 실제 Chrome 실측).
// 높이·CLS 는 실제 Chrome 에서 잰다(PR 증빙). 여기서는 그 측정이 기대는 규칙이 깨지지 않게 CSS 원문을 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

/** css 를 최상위 문장(규칙·@media 블록)으로 나눈다 - 주석은 걷고 중괄호 깊이로 자른다. */
function topLevel(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        out.push(src.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return out;
}
const compareRules = (statements) => statements.filter((s) => !s.startsWith("@") && /(^|[\s,])#compare-result\s*[,{]/.test(s));

test("#compare-result 는 최상위(미디어 밖)에서 1lh 를 예약하고 폭 ≤430 만 2lh 로 덮는다 (#538)", async () => {
  const top = topLevel(await read("src/css/legacy.css"));
  const base = compareRules(top);
  assert.equal(base.length, 1, `미디어 밖 #compare-result 규칙이 하나가 아니다: ${base.length}`);
  assert.match(base[0], /^#compare-result\s*\{\s*min-height:\s*1lh;\s*\}$/, "미디어 밖 #compare-result 는 min-height:1lh 하나여야 한다 - 이 선택자만, 이 속성만");
  const media = top.filter((s) => s.startsWith("@media (max-width: 430px) {") && /#compare-result/.test(s));
  assert.equal(media.length, 1, "폭 ≤430 #compare-result 덮어쓰기가 하나가 아니다");
  assert.match(media[0], /#compare-result\s*\{\s*min-height:\s*2lh;\s*\}/, "폭 ≤430 에서는 2lh 여야 한다(2줄 문장)");
  assert.ok(top.indexOf(base[0]) < top.indexOf(media[0]), "미디어 밖 규칙이 ≤430 덮어쓰기보다 뒤에 있다 - 같은 명시도라 뒤가 이긴다");
  // 다른 미디어(폭 하한·다른 상한)에는 이 id 가 없다 - 예약이 한 조건에서만 갈린다.
  for (const s of top) if (s.startsWith("@media") && !s.startsWith("@media (max-width: 430px) {")) assert.equal(/#compare-result/.test(s), false, `다른 미디어에 #compare-result 가 있다: ${s.slice(0, 60)}`);
});

test("만든 docs/style.css 에도 같은 두 규칙이 실려 있다 (#538)", async () => {
  const css = (await read("docs/style.css")).replace(/\s+/g, " ");
  assert.equal([...css.matchAll(/#compare-result \{/g)].length, 2, "#compare-result 규칙이 둘이 아니다");
  assert.ok(css.includes("#compare-result { min-height: 1lh; } @media (max-width: 430px) { #compare-result { min-height: 2lh; } }"), "1lh 기본 + ≤430 2lh 덮어쓰기 순서가 아니다");
});
