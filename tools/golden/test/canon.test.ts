import test from "node:test";
import assert from "node:assert/strict";
import { canon } from "../lib/canon.ts";
import { diffHtml } from "../lib/compare.ts";

// 합성 HTML만 쓴다. 허용하는 차이(주석·속성 순서·엔티티·공백 줄이기·script 줄바꿈)는 같고, 나머지는 다르다.
const page = (body, head = "") => `<!doctype html><html lang="ko"><head><meta charset="utf-8">${head}<title>t</title></head><body>${body}</body></html>`;
const same = (a, b, why) => assert.equal(canon(a), canon(b), why);
const differ = (a, b, why) => assert.notEqual(canon(a), canon(b), why);

test("허용: 주석", () => {
  same(page("<p>a</p>"), page("<!-- 주석 --><p>a</p><!--x-->"));
  same(page("<p>a<!--c-->b</p>"), page("<p>ab</p>"), "주석이 사이에 있던 텍스트는 이어 붙은 글자다");
});

test("허용: 속성 순서. 속성 값과 이름은 그대로 비교한다", () => {
  same(page('<a href="./x.html" class="c" id="i">x</a>'), page('<a id="i" class="c" href="./x.html">x</a>'));
  differ(page('<a href="./x.html">x</a>'), page('<a href="./y.html">x</a>'), "href 원문");
  differ(page('<a href="./x.html">x</a>'), page('<a href="x.html">x</a>'), "./ 접두도 다른 값이다");
  differ(page('<a class="a b">x</a>'), page('<a class="b a">x</a>'), "class 안의 순서는 값이다");
});

test("허용: 엔티티 표기", () => {
  same(page("<p>a &amp; b &lt; c</p>"), page("<p>a &#38; b &#x3C; c</p>"));
  same(page('<p title="a&amp;b">x</p>'), page('<p title="a&#38;b">x</p>'));
  differ(page("<p>a&nbsp;b</p>"), page("<p>a b</p>"), "&nbsp;는 공백이 아니다");
});

test("허용: 공백 줄이기. 없애기는 불허", () => {
  same(page("<p>a   b\n\n c</p>"), page("<p>a b c</p>"), "연속 공백은 한 칸");
  same(page("<div>\n  <p>a</p>\n  <p>b</p>\n</div>"), page("<div><p>a</p><p>b</p></div>"), "블록 사이·블록 끝의 공백");
  same(page("<p> a </p>"), page("<p>a</p>"), "블록 시작·끝의 공백");
  differ(page("<p>a b</p>"), page("<p>ab</p>"), "글 사이 공백을 없애면 다르다");
  differ(page("<p><b>a</b> <i>b</i></p>"), page("<p><b>a</b><i>b</i></p>"), "인라인 사이 공백을 없애면 다르다");
  differ(page("<p>a<br>b</p>"), page("<p>ab</p>"), "br 자체는 남는다");
  differ(page("<pre>a  b</pre>"), page("<pre>a b</pre>"), "pre는 손대지 않는다");
});

test("남김: 본문 텍스트·숫자·hidden 아래 텍스트", () => {
  differ(page("<p>7억대에서 575건이</p>"), page("<p>7억대에서 576건이</p>"));
  differ(page("<p>a. 표본이 모자라 값을 내지 않습니다.</p>"), page("<p>a.</p>"));
  const hidden = canon(page('<div hidden><p>숨은 문장</p></div>'));
  assert.match(hidden, /"숨은 문장" \[hidden\]/, "hidden 조상 아래 텍스트는 줄 끝에 [hidden]을 단다");
  differ(page('<div hidden><p>x</p></div>'), page("<div><p>x</p></div>"), "hidden을 떼면 다르다");
  differ(page('<p>x</p>', ""), page('<p>x</p><p hidden></p>'), "빈 hidden 요소도 남는다");
});

test("남김: head 메타 전부 — robots 없음은 index, follow와 다르다", () => {
  const none = page("<p>x</p>");
  const idx = page("<p>x</p>", '<meta name="robots" content="index, follow">');
  const noidx = page("<p>x</p>", '<meta name="robots" content="noindex, follow">');
  differ(none, idx, "없음 ≠ index, follow");
  differ(idx, noidx);
  differ(page("<p>x</p>", '<link rel="canonical" href="https://a/x.html">'), page("<p>x</p>", '<link rel="canonical" href="https://a/y.html">'));
  differ(page("<p>x</p>", '<meta property="og:title" content="a">'), page("<p>x</p>", '<meta property="og:title" content="b">'));
});

test("남김: 제목 계층·표 셀 속성·script src 순서", () => {
  differ(page("<h2>a</h2>"), page("<h3>a</h3>"));
  differ(page('<table><tr><td colspan="2">a</td></tr></table>'), page('<table><tr><td colspan="3">a</td></tr></table>'));
  differ(page('<table><tr><td colspan="2">a</td></tr></table>'), page("<table><tr><td>a</td></tr></table>"));
  const ab = page('<script src="./search.js" defer></script><script src="./nav.js" defer></script>');
  const ba = page('<script src="./nav.js" defer></script><script src="./search.js" defer></script>');
  differ(ab, ba, "script 순서");
  differ(page('<script src="./nav.js" defer></script>'), page('<script src="./nav.js"></script>'), "defer 유무");
});

test("인라인 script·style: 줄바꿈 정규화만 허용(JSON 섬 포함)", () => {
  same(page("<script>var a = 1;\r\nvar b = 2;</script>"), page("<script>var a = 1;\nvar b = 2;</script>"));
  differ(page("<script>var a = 1;</script>"), page("<script>var a = 2;</script>"));
  differ(page("<script>var a = 1;</script>"), page("<script>var a =  1;</script>"), "script 안의 공백은 줄이지 않는다");
  const json = (s) => page(`<script type="application/json" id="rate-facts-data">${s}</script>`);
  same(json('{"a":1,"b":2}'), json('{"a":1,"b":2}'));
  differ(json('{"a":1,"b":2}'), json('{"b":2,"a":1}'), "JSON 키 순서도 일부러 느슨하게 하지 않는다");
  differ(json('{"a":1}'), json('{"a":2}'));
});

test("diffHtml은 어느 줄이 달라졌는지 가리킨다", () => {
  const hunks = diffHtml(page("<p>7억대에서 575건이</p>"), page("<p>7억대에서 576건이</p>"));
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0].removed.map((l) => l.trim()), ['"7억대에서 575건이"']);
  assert.deepEqual(hunks[0].added.map((l) => l.trim()), ['"7억대에서 576건이"']);
});
