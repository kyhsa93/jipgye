import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { diffHtml } from "../lib/compare.mjs";

// 비교기 변이 시험(낙제 시험, #236). 입력은 test/fixtures/의 고정 HTML 사본이다 — 오늘의 docs/나 골든 파일을 읽지 않는다.
//   잡혀야 하는 것 4(표본 부족 문장 삭제·noindex 제거·숫자 한 자리·인라인 script), 통과해야 하는 것 1(속성 순서),
//   대조군(동일 입력). 그 밖에 허용 차이(주석·엔티티·들여쓰기·CRLF)와 더 많은 낙제 변이를 함께 시험한다.
const fx = (name) => readFile(path.join(import.meta.dirname, "fixtures", name), "utf8");
const [BUDGET, RATES, ABOUT] = await Promise.all([fx("budget-7eok.html"), fx("rates.html"), fx("about.html")]);
const PAGES = { "budget-7eok": BUDGET, rates: RATES, about: ABOUT };

/** from이 정확히 한 번 있어야 바꾼다 — 고정 사본이 바뀌어 변이가 헛돌면 시험이 먼저 멈춘다. */
function mutate(html, from, to) {
  assert.equal(html.split(from).length - 1, 1, `변이 대상이 정확히 한 번 있어야 한다: ${from.slice(0, 50)}`);
  return html.replace(from, to);
}
const caught = (a, b) => diffHtml(a, b).length > 0;

test("대조군: 같은 입력은 통과한다", () => {
  for (const [name, html] of Object.entries(PAGES)) assert.equal(diffHtml(html, html).length, 0, name);
});

test("검출 1/4: 표본 부족 문장 한 줄 삭제", () => {
  const sentence = " 자치구는 한 주 표본이 얇아 최근 4주를 겹쳐 세고, 신고가 5건 미만인 구는 평균을 내지 않고 비워 둡니다.";
  const html = mutate(BUDGET, `<p id="method-callout-text">매물 호가가 아니라 국토교통부에 신고된 실거래입니다.${sentence}</p>`, `<p id="method-callout-text">매물 호가가 아니라 국토교통부에 신고된 실거래입니다.</p>`);
  assert.ok(caught(BUDGET, html));
});

test("검출 2/4: noindex 메타 제거", () => {
  const html = mutate(RATES, '<meta name="robots" content="noindex, follow">', "");
  assert.ok(caught(RATES, html));
  // 제거만이 아니라 값이 바뀐 것도 잡는다.
  assert.ok(caught(RATES, mutate(RATES, 'content="noindex, follow"', 'content="noindex"')));
});

test("검출 3/4: 본문 숫자 한 자리 변경", () => {
  const html = mutate(BUDGET, "7억대에서 575건이 거래됐습니다", "7억대에서 576건이 거래됐습니다");
  assert.ok(caught(BUDGET, html));
});

test("검출 4/4: 인라인 script 내용 변경", () => {
  const html = mutate(BUDGET, 'budgetHeading: "예산으로 찾기",', 'budgetHeading: "예산으로 찾기!",');
  assert.ok(caught(BUDGET, html));
  assert.ok(caught(ABOUT, ABOUT.replace("</script>", "// x\n</script>")), "script 끝에 한 줄 덧붙여도 잡는다");
});

test("통과: 속성 순서만 바꾼 변이(모든 태그의 속성을 뒤집는다)", () => {
  // 속성이 둘 이상인 시작 태그의 속성 순서를 통째로 뒤집는다. script 본문 안의 `<` 문자열은 건드리지 않게
  // 본문(<script>…</script>)은 떼어 두고 바꾼 뒤 되붙인다.
  const reverseAttrs = (html) => {
    const stash = [];
    const bare = html.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/g, (m) => `\u0000${stash.push(m) - 1}\u0000`);
    let changed = 0;
    const out = bare.replace(/<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?){2,})\s*(\/?)>/g, (m, tag, attrs, slash) => {
      const list = attrs.trim().match(/[\w:-]+(?:="[^"]*")?/g);
      changed++;
      return `<${tag} ${list.reverse().join(" ")}${slash}>`;
    });
    assert.ok(changed > 20, `뒤집힌 태그가 충분히 많아야 의미가 있다(${changed})`);
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  };
  for (const [name, html] of Object.entries(PAGES)) {
    const mutated = reverseAttrs(html);
    assert.notEqual(mutated, html, `${name}: 바이트는 달라야 한다`);
    assert.equal(diffHtml(html, mutated).length, 0, `${name}: 속성 순서는 통과`);
  }
});

test("통과: 주석 추가·엔티티 표기·태그 사이 들여쓰기·script CRLF (허용 차이)", () => {
  const withComment = BUDGET.replace("<main", "<!-- 아무 주석 --><main");
  assert.notEqual(withComment, BUDGET);
  assert.equal(diffHtml(BUDGET, withComment).length, 0);
  // &amp;를 숫자 엔티티로.
  const ent = BUDGET.replace("&amp;", "&#38;"); // 첫 번째는 본문(prerender 블록)의 것이다(둘째는 script 안의 문자열)
  assert.notEqual(ent, BUDGET);
  assert.equal(diffHtml(BUDGET, ent).length, 0);
  const crlf = BUDGET.replace(/<script>([\s\S]*?)<\/script>/, (m, body) => `<script>${body.replace(/\n/g, "\r\n")}</script>`);
  assert.notEqual(crlf, BUDGET);
  assert.equal(diffHtml(BUDGET, crlf).length, 0, "script 본문은 줄바꿈 정규화만 허용");
  const indented = RATES.replace("<body>", "<body>\n\n   ").replace("</body>", "\n  </body>");
  assert.equal(diffHtml(RATES, indented).length, 0, "블록 경계의 공백");
});

test("검출(추가): head 메타 값·canonical·제목 계층·링크·script src 순서·본문 공백 없애기", () => {
  assert.ok(caught(BUDGET, mutate(BUDGET, '<link rel="canonical" href="https://kyhsa93.github.io/jipgye/budget-7eok.html">', '<link rel="canonical" href="https://kyhsa93.github.io/jipgye/budget-7eok">')));
  assert.ok(caught(BUDGET, mutate(BUDGET, '<h2 id="budget-heading">', '<h3 id="budget-heading">')), "제목 계층");
  assert.ok(caught(BUDGET, mutate(BUDGET, '<a href="./index.html" id="nav-digest">', '<a href="./index" id="nav-digest">')), "a[href] 원문");
  const srcSwap = mutate(mutate(BUDGET, '<script src="./nav.js" defer></script>', "@@N@@"), '<script src="./search.js" defer></script>', '<script src="./nav.js" defer></script>').replace("@@N@@", '<script src="./search.js" defer></script>');
  assert.ok(caught(BUDGET, srcSwap), "script src 순서");
  assert.ok(caught(BUDGET, mutate(BUDGET, "7억대에서 575건이 거래됐습니다", "7억대에서575건이 거래됐습니다")), "공백 없애기");
});
