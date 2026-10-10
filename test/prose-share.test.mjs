import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { words, windows, measure, formatLine } from "../scripts/prose-share.mjs";

// 이 검사는 측정 도구의 정의(이슈 #66 본문 「측정 정의」)가 코드에서 안 바뀌게 못 박는다.
// 실제 docs/를 재서 값을 단정하지 않는다 - 값은 페이지가 바뀌면 바뀌는 게 맞다(게이트 아님).

test("텍스트: 주석·script·style·svg를 지우고 태그·엔티티를 공백으로 바꿔 단어로 나눈다", () => {
  const html = `<p>가 나&nbsp;다</p><!-- 주석 단어 --><script>var a = 1;</script>
    <style>p { color: red }</style><svg><text>그림</text></svg><b>라</b>`;
  assert.deepEqual(words(html, { maskNumbers: false }), ["가", "나", "다", "라"]);
});

test("숫자 가리기: 숫자가 하나라도 든 토큰은 단위·쉼표째 #로 바뀐다", () => {
  const html = "<p>취득세 1,234만원 은 3.5% 이고 abc 입니다 2026-10-10</p>";
  assert.deepEqual(words(html, { maskNumbers: true }), ["취득세", "#", "은", "#", "이고", "abc", "입니다", "#"]);
  assert.ok(words(html, { maskNumbers: false }).includes("1,234만원"));
});

test("창: 연속 8단어, 8단어 미만이면 창이 없다", () => {
  const w = Array.from({ length: 10 }, (_, i) => `w${i}`);
  assert.equal(windows(w).size, 3);
  assert.equal(windows(w.slice(0, 7)).size, 0);
  assert.equal(windows(["a", "a", "a", "a", "a", "a", "a", "a", "a"]).size, 1, "장별 집합이라 중복 창은 하나");
});

const seq = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

test("공통 산문·고유율: 문서빈도로 센다", () => {
  // 4장 중 3장(과반 아님: 9장 이상 규칙을 장 수 4로 줄이면 과반=3)에 실리는 문단 + 각 장 고유 문단.
  const shared = seq("s", 20); // 창 13개
  const pages = new Map(
    ["a", "b", "c", "d"].map((k, i) => [k, `<p>${i < 3 ? shared : seq("z", 20)} ${seq(k, 20)}</p>`]),
  );
  const m = measure(pages, { maskNumbers: false });
  assert.equal(m.majority, 3, "과반 문턱은 ⌊n/2⌋+1");
  assert.equal(m.pages.length, 4);
  // a~c: 공통 13창 + 경계 걸친 창이 고유. d는 z가 d에서만 나오므로 전부 고유.
  const d = m.pages.find((p) => p.name === "d");
  assert.equal(d.common, 0);
  assert.equal(d.unique, d.windows);
  const a = m.pages.find((p) => p.name === "a");
  assert.equal(a.common, 13);
  assert.ok(m.commonShare > 0 && m.commonShare < 1);
  assert.ok(m.uniqueShare > 0 && m.uniqueShare < 1);
});

test("18장 기준 과반은 9장", () => {
  const pages = new Map(Array.from({ length: 18 }, (_, i) => [`p${i}`, `<p>${seq("x", 9)}</p>`]));
  assert.equal(measure(pages, { maskNumbers: true }).majority, 9);
});

test("숫자 가리기가 고유율을 바꾼다 - 숫자만 다른 문단은 가리면 같은 창이 된다", () => {
  const mk = (n) => `<p>세율은 ${n}% 이고 한도는 ${n}만원 이며 기준일은 ${n}일 입니다 끝</p>`;
  const pages = new Map([["a", mk(1)], ["b", mk(2)]]);
  assert.equal(measure(pages, { maskNumbers: false }).uniqueShare, 1);
  assert.equal(measure(pages, { maskNumbers: true }).uniqueShare, 0);
  assert.equal(measure(pages, { maskNumbers: true }).commonShare, 0, "2장 중 과반=2장, 둘 다 실린 창은 공통");
});

test("같은 입력은 같은 출력이다 - 입력 순서와 무관", () => {
  const entries = ["a", "b", "c"].map((k) => [k, `<p>${seq("q", 12)} ${seq(k, 12)}</p>`]);
  const x = measure(new Map(entries), { maskNumbers: true });
  const y = measure(new Map([...entries].reverse()), { maskNumbers: true });
  assert.equal(formatLine(x), formatLine(y));
  assert.deepEqual(x.pages, y.pages);
});

test("출력 한 줄 형식", () => {
  const m = measure(new Map([["a", `<p>${seq("a", 12)}</p>`], ["b", `<p>${seq("b", 12)}</p>`]]), { maskNumbers: true });
  assert.match(formatLine(m), /^공통 산문 \d+\.\d% · 고유율\(숫자 가림\) \d+\.\d% · 최저 장 \S+ \d+\.\d%$/);
});

test("CLI: 폴더를 받아 budget-{3..20}eok.html만 읽고 --both로 두 정의를 낸다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prose-"));
  try {
    for (let n = 3; n <= 20; n += 1) {
      await writeFile(path.join(dir, `budget-${n}eok.html`), `<p>${seq("c", 12)} ${n}억 ${seq(`u${n}_`, 12)}</p>`);
    }
    await writeFile(path.join(dir, "index.html"), "<p>무시</p>");
    const script = path.resolve(import.meta.dirname, "../scripts/prose-share.mjs");
    const one = execFileSync("node", [script, dir], { encoding: "utf8" });
    assert.equal(one.trim().split("\n").length, 1);
    assert.match(one, /18장|공통 산문/);
    const both = execFileSync("node", [script, dir, "--both"], { encoding: "utf8" }).trim().split("\n");
    assert.equal(both.length, 2);
    assert.match(both[1], /숫자 안 가림/);
    assert.equal(execFileSync("node", [script, dir], { encoding: "utf8" }), one, "두 번 돌려도 같다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
