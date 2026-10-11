import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { words, windows } from "../scripts/prose-share.mjs";
import { CLOSED_ISSUES, MERGED_PRS, EXCLUDED } from "../scripts/check-corrections-refs.mjs";

// #159: method.html의 「고친 오류」 한 절. 법무 조건(이슈 댓글 7개)을 구조·금지어로 못 박는다.
// 이슈·PR이 실제로 닫혔고 병합됐는지는 네트워크가 필요해 scripts/check-corrections-refs.mjs(수동)가 본다.
// 여기서는 값에 따라 갈리는 검사를 두지 않는다(#8).

const root = path.resolve(import.meta.dirname, "..");
const method = () => readFile(path.join(root, "docs/method.html"), "utf8");

// 절 = 제목(id)부터 다음 <h2>까지.
const sectionOf = (html, id) => {
  const start = html.indexOf(`<h2 id="${id}">`);
  assert.notEqual(start, -1, `${id} 절이 없다`);
  const end = html.indexOf("<h2", start + 5);
  return { start, end, text: html.slice(start, end) };
};
const items = (sec) => [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);

const KO_BANNED = ["사고", "유출", "부풀려", "잘못된 정보를 제공", "피해", "책임", "항상", "절대", "완전", "오류 0건"];
const EN_BANNED = ["always", "never", "complete", "leak", "breach", "damage", "liab", "fault", "blame", "zero errors", "inflat"];
// #80은 싣지 않는다. 그 건의 구체어(검색어·이벤트·URL 파라미터·키)도 이 절에 없어야 한다.
const PRIVACY_TERMS = ["검색어", "page_location", "search_term", "개인정보", "analytics", "분석 도구", "search event"];

test("한·영 두 절이 있고 항목 수가 같으며 10건 이하다", async () => {
  const html = await method();
  const ko = items(sectionOf(html, "corrections").text);
  const en = items(sectionOf(html, "corrections-en").text);
  assert.ok(ko.length >= 1 && ko.length <= 10, `한국어 ${ko.length}건`);
  assert.equal(en.length, ko.length);
  assert.equal(ko.length, 5, "초기 다섯 건(#28·#183·#65·#6·#29)");
});

test("절 머리는 면책 문단 하나이고 목록 앞에 있다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    const { text } = sectionOf(html, id);
    const head = text.slice(0, text.indexOf("<ul"));
    assert.equal((head.match(/<p>/g) || []).length, 1, `${id}: 목록 앞 문단은 하나`);
  }
  const ko = sectionOf(html, "corrections").text;
  assert.match(ko, /정부 원본을 가공해/);
  assert.match(ko, /모든 오류를 여기에 적는 것은 아닙니다/);
  assert.match(ko, /원본을 확인해/);
  assert.match(ko, /최근 것부터/);
  assert.doesNotMatch(ko, /날짜 순/);
  const en = sectionOf(html, "corrections-en").text;
  assert.match(en, /this site's counting method/);
  assert.doesNotMatch(en, /\bwe\b|mistake/i, "영어 면책 주어는 사이트이고 we·mistake를 쓰지 않는다");
});

test("항목마다 날짜·근거 링크가 있고 두 문장 이하이며 날짜는 내림차순이다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    const list = items(sectionOf(html, id).text);
    const dates = list.map((li) => li.match(/<strong>(\d{4}-\d{2}-\d{2})<\/strong>/)?.[1]);
    assert.ok(dates.every(Boolean), `${id}: 날짜가 없는 항목`);
    assert.deepEqual([...dates].sort().reverse(), dates, `${id}: 날짜가 내림차순이 아니다`);
    for (const li of list) {
      assert.match(li, /github\.com\/kyhsa93\/jipgye\/(issues|pull)\/\d+/, `${id}: 근거 링크 없음`);
      // 근거 링크 괄호와 소수점을 걷고 문장 끝(마침표 뒤 공백·끝)을 센다.
      const prose = li
        .replace(/\(<a [\s\S]*$/, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/g, " ")
        .replace(/\d+\.\d+/g, "N");
      const count = (prose.match(/\.(?=\s|$)/g) || []).length;
      assert.ok(count >= 1 && count <= 2, `${id}: 문장이 ${count}개다: ${li.slice(0, 60)}`);
    }
  }
});

test("근거 링크는 번호 목록(닫힌 이슈·병합된 PR)과 정확히 같고 #80은 없다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    const { text } = sectionOf(html, id);
    const issues = [...text.matchAll(/jipgye\/issues\/(\d+)/g)].map((m) => Number(m[1]));
    const prs = [...text.matchAll(/jipgye\/pull\/(\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual([...new Set(issues)].sort((a, b) => a - b), CLOSED_ISSUES, `${id}: 이슈 목록`);
    assert.deepEqual(prs, MERGED_PRS, `${id}: PR 목록`);
    for (const n of EXCLUDED) assert.ok(!text.includes(`#${n}`) && !text.includes(`/${n}"`), `${id}: #${n}`);
  }
});

test("쓰지 않을 말과 개인정보 건의 구체어가 없다", async () => {
  const html = await method();
  const ko = sectionOf(html, "corrections").text.replace(/<[^>]+>/g, " ");
  const en = sectionOf(html, "corrections-en").text.replace(/<[^>]+>/g, " ").toLowerCase();
  for (const w of KO_BANNED) assert.ok(!ko.includes(w), `한국어 절에 금지어: ${w}`);
  for (const w of EN_BANNED) assert.ok(!en.includes(w), `영어 절에 금지어: ${w}`);
  for (const w of PRIVACY_TERMS) {
    assert.ok(!ko.includes(w) && !en.includes(w.toLowerCase()), `개인정보 건 구체어: ${w}`);
  }
});

test("해제율 옛 값은 '당시 표본'으로 표시되고 지금 값과 섞이지 않는다", async () => {
  const html = await method();
  const ko = items(sectionOf(html, "corrections").text).find((li) => li.includes("2.1%"));
  const en = items(sectionOf(html, "corrections-en").text).find((li) => li.includes("2.1%"));
  assert.match(ko, /당시 표본/);
  assert.match(ko, /전체 거래 대비 해제 비율/);
  assert.match(en, /share of all transactions/);
  assert.match(en, /sample at that time/);
  for (const li of [ko, en]) assert.doesNotMatch(li, /78\.9|5,668|4,472/, "지금 값을 이 절에 옮겨 적지 않는다");
});

test("스타일 태그·새 페이지 없이 method.html 안의 정적 절이다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    assert.doesNotMatch(sectionOf(html, id).text, /<style|<script|prerender:/);
  }
});

// growth 규칙(AdSense 중복): 이 절의 연속 8단어(숫자 가림)가 다른 장·method.html의 다른 자리에 없다.
test("절의 문장은 docs/*.html 어디에도 같은 8단어 창으로 없다", async () => {
  const html = await method();
  const own = new Set();
  const spans = [];
  for (const id of ["corrections", "corrections-en"]) {
    const s = sectionOf(html, id);
    spans.push(s);
    for (const w of windows(words(s.text, { maskNumbers: true }))) own.add(w);
  }
  assert.ok(own.size > 100, "창이 너무 적다");
  // 항목끼리도 같은 문장 틀을 쓰지 않는다: 한 창이 두 항목에 있으면 안 된다.
  for (const id of ["corrections", "corrections-en"]) {
    const seen = new Map();
    for (const [i, li] of items(sectionOf(html, id).text).entries()) {
      for (const w of windows(words(li, { maskNumbers: true }))) {
        assert.ok(!seen.has(w) || seen.get(w) === i, `${id}: 항목 ${seen.get(w)}와 ${i}가 같은 문장 틀을 쓴다`);
        seen.set(w, i);
      }
    }
  }
  let rest = html;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) rest = rest.slice(0, s.start) + rest.slice(s.end);
  const others = [["method.html(절 밖)", rest]];
  for (const f of (await readdir(path.join(root, "docs"))).filter((n) => n.endsWith(".html") && n !== "method.html")) {
    others.push([f, await readFile(path.join(root, "docs", f), "utf8")]);
  }
  for (const [name, text] of others) {
    const w = windows(words(text, { maskNumbers: true }));
    const hit = [...own].filter((x) => w.has(x));
    assert.equal(hit.length, 0, `${name}와 같은 문장: ${hit[0]?.split("\u0001").join(" ")}`);
  }
});

// #217: 해제 문단(정정 재신고)에는 날마다 바뀌는 비율을 손으로 박지 않는다 - 그날 값은 cancelled-deals 첫 문단(correctionStats)이 싣는다.
// 값에 따라 갈리는 검사가 아니라 '숫자가 없다'는 구조 검사다(#8).
test("method 해제 문단은 정정 재신고 비율 숫자를 박지 않는다", async () => {
  const html = await method();
  const ko = html.match(/<p>해제를 세기 전에[\s\S]*?<\/p>/)?.[0];
  const en = html.match(/<p>Before cancellations are counted[\s\S]*?<\/p>/)?.[0];
  assert.ok(ko && en, "해제 문단 한·영이 있다");
  for (const p of [ko, en]) assert.ok(!/\d+(?:\.\d+)?%|넷에 셋|Three in four/.test(p), p.slice(0, 80));
});
