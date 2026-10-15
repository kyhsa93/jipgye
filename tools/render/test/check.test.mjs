// 브라우저 없이 도는 단위 시험(#325). 여기 있는 것은 순수 함수와 인자 해석이라 빠르고, 변이 시험이
// 느려서 못 재는 자리(옵션 조합·보고서 모양·전수 목록의 줄 수)를 맡는다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { CHECKS, compareTexts, formatReport, mergeTextFindings, summarize } from "../lib/check.mjs";
import { CONTRAST_LARGE, CONTRAST_NORMAL, FIELD_MIN, FONT_MIN, NARROW_WIDTHS, TAP_MIN, TAP_MIN_WIDTH, TEXT_WIDTHS } from "../lib/probe.mjs";
import { parseArgs, planRuns } from "../bin/check.mjs";

const run = promisify(execFile);
const BIN = path.resolve(import.meta.dirname, "../bin/check.mjs");

const fakeRun = (pages, { js = false, lang = "ko" } = {}) => ({
  dir: "/tmp/fake",
  js,
  lang,
  pages: Object.fromEntries(Object.entries(pages).map(([f, findings]) => [f, { url: f, findings, unmeasurable: [], checked: {}, texts: {} }])),
});

test("문턱 값이 저장소의 다른 기준과 같은 수다", () => {
  // 여기 수가 조용히 움직이면 도구가 "통과"를 내면서 기준이 내려간다.
  assert.equal(TAP_MIN, 44, "--tap: 44px (test/style.test.mjs)");
  assert.equal(TAP_MIN_WIDTH, 24, "WCAG 2.2 2.5.8 Target Size (Minimum, AA)");
  assert.equal(FIELD_MIN, 16, "16px 미만이면 iOS Safari가 초점에서 화면을 당긴다");
  assert.equal(FONT_MIN, 12, "축척 바닥 --fs-xs 0.78rem = 12.48px보다 아래");
  assert.equal(CONTRAST_NORMAL, 4.5);
  assert.equal(CONTRAST_LARGE, 3);
  assert.deepEqual(NARROW_WIDTHS, [320, 375], "#274 체인 공통 규칙 1번 ②");
  assert.deepEqual(TEXT_WIDTHS, [375, 1280], "#274 체인 공통 규칙 1번 ①");
});

test("검사 이름이 전부 체인 공통 규칙 1번의 번호를 달고 있다", () => {
  for (const [name, no] of Object.entries(CHECKS)) assert.match(no, /^[①②③④⑤]$/, `${name}의 번호가 ${no}다`);
  assert.equal(Object.keys(CHECKS).length, 7);
});

test("--js off와 --lang en은 함께 설 수 없다 — 영어는 스크립트가 번역한다", () => {
  assert.throws(() => planRuns({ js: "off", lang: "en" }), /스크립트/);
  // both끼리는 셋이다: (끔·ko) (켬·ko) (켬·en). (끔·en)은 빠진다.
  assert.deepEqual(planRuns({ js: "both", lang: "both" }), [
    { js: false, lang: "ko" },
    { js: true, lang: "ko" },
    { js: true, lang: "en" },
  ]);
});

test("인자 해석은 모르는 옵션을 받지 않는다", () => {
  assert.throws(() => parseArgs(["docs", "--rener"]), /모르는 옵션/);
  assert.throws(() => parseArgs(["--js"]), /값이 없다/);
  assert.throws(() => parseArgs([]), /폴더를 달라/);
  assert.throws(() => parseArgs(["a", "b"]), /폴더는 하나만/);
  assert.throws(() => parseArgs(["docs", "--js", "maybe"]), /--js는 on\|off\|both/);
  const o = parseArgs(["docs", "--pages", "a.html, b.html", "--baseline", "old", "--quiet"]);
  assert.deepEqual(o.pages, ["a.html", "b.html"]);
  assert.equal(o.baseline, "old");
  assert.equal(o.quiet, true);
});

test("검사 ①: 가시 텍스트 다중집합이 다르면 장마다 걸린다", () => {
  const base = { pages: { "a.html": { texts: { 375: [`"가" 보임`, `"나" 보임`], 1280: [`"가" 보임`] } } } };
  const cand = { pages: { "a.html": { texts: { 375: [`"가" 보임`, `"나" 숨김`], 1280: [`"가" 보임`] } } } };
  const f = compareTexts(base, cand);
  assert.equal(f.length, 1, "375px 한 줄만 걸려야 한다");
  assert.equal(f[0].where, "375px");
  assert.match(f[0].detail, /기준에만 1줄 · 후보에만 1줄/);
});

test("검사 ①: 기준에 없는 장은 그 자체로 걸린다", () => {
  const f = compareTexts({ pages: {} }, { pages: { "새.html": { texts: {} } } });
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /기준 폴더에 없는 장/);
});

test("검사 ① 결과가 장에 붙어 집계에 들어간다", () => {
  const cand = fakeRun({ "a.html": [] });
  mergeTextFindings(cand, [{ page: "a.html", check: "가시 텍스트", where: "375px", detail: "x" }]);
  assert.equal(summarize([cand]).total, 1);
  assert.equal(cand.pages["a.html"].findings.length, 1);
});

test("전수 보고서는 **위반 0건인 장도 한 줄**을 차지한다", () => {
  // 빠지면 "안 쟀다"와 구별이 안 된다(#325 완료 조건 1-c).
  const r = fakeRun({ "a.html": [], "b.html": [{ check: "가로 넘침", where: "320px", detail: "+9px" }] });
  const lines = formatReport([r], { detail: false }).split("\n");
  assert.ok(lines.some((l) => l.startsWith("a.html\t") && l.includes("위반 0건")), "0건인 장이 빠졌다");
  assert.ok(lines.some((l) => l.startsWith("b.html\t") && l.includes("위반 1건")));
  assert.match(formatReport([r], { detail: false }), /합계: 위반 1건/);
});

test("전수 보고서의 줄 수 = 장 수 × 실행 수", () => {
  // 켬·끔 둘로 돌리면 67장이 134줄이 된다(#325 완료 조건 1-c의 세는 수).
  const pages = Object.fromEntries([...Array(5)].map((_, i) => [`p${i}.html`, []]));
  const report = formatReport([fakeRun(pages, { js: false }), fakeRun(pages, { js: true })], { detail: false });
  const rows = report.split("\n").filter((l) => /^p\d\.html\t/.test(l));
  assert.equal(rows.length, 10);
  assert.equal(rows.filter((l) => l.includes("스크립트 끔")).length, 5);
  assert.equal(rows.filter((l) => l.includes("스크립트 켬")).length, 5);
});

test("도구가 돌지 못하면 종료 코드가 2다 — 위반 0건(0)과 섞이지 않는다", async () => {
  // "검사가 안 돌았다"가 "위반이 없다"로 읽히면 이 도구는 장식이 된다.
  await assert.rejects(
    () => run(process.execPath, [BIN, "/이_폴더는_없다"]),
    (e) => {
      assert.equal(e.code, 2, `종료 코드가 ${e.code}다`);
      assert.match(e.stderr, /검사를 돌리지 못했다/);
      return true;
    }
  );
});
