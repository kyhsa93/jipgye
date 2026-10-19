// 시세 틀(scripts/realestate-template.html → 구운 47장: realestate · 거래 유형 3 · 예산대 18 · 자치구 25) 껍데기의 Tailwind 개편(#283)이 지켜야 하는 것.
//
// 이 개편의 범위는 여는 태그에 class 를 더하는 것뿐이다. 스크립트가 다시 그리는 조각(알림 `p.content-notice`·`#load-retry`·표 행·단지 카드·추이 카드)과
// 굽는 조각, 인라인 스크립트는 한 글자도 안 바뀐다 - 거기에 모양이 바뀌는 유틸리티를 두면 구운 첫 화면과 다시 그린 화면이 어긋나고
// `notifyBeside`·`foldReserve` 의 본문이 달라진다(#296 (바) cto 판정, #283 「범위」 기본값).
// 같은 PR 이 데스크톱 폭 간격(`tw:1024:` 변형)을 이 틀을 쓰는 장과 먼저 개편된 장 모두에 더하므로, 마지막 시험이 docs/ 전체를 훑어 빠진 장이 없음을 지킨다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { REALESTATE_PAGES } from "../scripts/build-realestate-pages.mjs";
import { BUDGET_PAGES } from "../scripts/budget-pages.mjs";
import { DISTRICT_PAGES } from "../scripts/district-slugs.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const tokens = (cls) => cls.split(/\s+/).filter(Boolean);

const FILES = ["realestate.html", ...REALESTATE_PAGES.map((p) => p.file), ...DISTRICT_PAGES.map((d) => d.file), ...BUDGET_PAGES.map((b) => b.file)];
const SECTION = ["tw:mb-10", "tw:1024:mb-16"];

// 껍데기. 훅 class(JS·시험·다른 장의 규칙이 읽는 이름)는 그대로 있고 뒤에 유틸리티가 붙는다.
// 값은 방향 C: 머리·내비는 조밀하게(8, 넓은 화면 24·16) · 본문 구획 사이는 넉넉하게(40, 넓은 화면 64)이고(#384~#399 와 같은 값),
// 높이 예산(첫 h2·답 시작 ≤ merge-base)은 머리 아래 여백 16→8, 1층 내비 아래 16→8, 2층 내비 위 -8→0·아래 16→8 에서 16px 를 산다.
// 이 수를 바꾸면 PR 본문의 188조건 표를 다시 재야 한다.
const SHELL = [
  { name: "머리글", pattern: /<header(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-2", "tw:1024:mb-6"] },
  { name: "1층 내비", pattern: /<nav class="([^"]*)" aria-label="섹션">/, hooks: ["page-nav"], utilities: ["tw:gap-2", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] },
  // 2층 내비의 칸 사이 간격(gap)은 legacy 6px 그대로다: 8px(tw:gap-2)로 키우면 768×1024 영어에서 8항목 내비의 넘침이 14px 늘어(71→85) po ③ 합격선 「768·1280 넘침량 후보 ≤ merge-base」를 못 지킨다.
  { name: "2층 내비", pattern: /<nav class="([^"]*)" aria-label="거래 유형">/, hooks: ["sub-nav"], utilities: ["tw:mt-0", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] },
  // 안내 상자(53장 한 번에): 왼쪽 3px 선(--border-strong) + 안 여백 8, 글자는 본문색. 선과 안 여백(3+8=11px)을 왼쪽 바깥 여백 -11px 으로 되받아 글자의 x·폭이 그대로다 -
  // 선이 글자 칸을 차지하게(안 여백 16 의 시안 모양) 하면 이미 개편된 여섯 장의 영어·한국어 7조건에서 줄이 하나 늘어 첫 h2 가 merge-base 보다 23.25px 내려간다(PR 본문).
  // 아래 여백 8 도 legacy 그대로다(16 으로 키우면 같은 여섯 장의 첫 h2 가 8px 내려간다).
  { name: "안내 상자", pattern: /<aside class="([^"]*)">/, hooks: ["method-callout"], utilities: ["tw:-ml-2.75", "tw:pl-2", "tw:border-l-3", "tw:border-border-strong"] },
  { name: "안내 문단", pattern: /<p id="method-callout-text"(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:text-fg"] },
  // 구획 다섯(서울 평균 · 구 요약 · 추이 · 예산 · 자치구). 숨김 여부는 장마다 다르므로 class 뒤의 속성은 보지 않는다.
  ...["overall", "district-summary", "trend", "budget", "district"].map((id) => ({
    name: `${id} 구획`,
    pattern: new RegExp(`<section id="${id}-section"(?: class="([^"]*)")?[^>]*>`),
    hooks: [],
    utilities: SECTION,
  })),
  // 추이 구획이 접혀 있는 동안 자리를 잡는 예약. 펴진 구획과 같은 유틸리티를 달아 한 곳에서 같은 값을 받는다(아래 시험이 둘이 같음을 지킨다).
  { name: "추이 예약", pattern: /<div class="(trend-reserve[^"]*)">/, hooks: ["trend-reserve"], utilities: SECTION },
];

test("시세 틀 47장과 틀의 껍데기는 같은 유틸리티를 갖고 훅 class는 그대로다 (#283)", async () => {
  assert.equal(FILES.length, 47, "틀을 쓰는 장 수가 바뀌었다 - 이 시험의 범위와 PR 본문의 188조건을 다시 센다");
  for (const file of ["scripts/realestate-template.html", ...FILES.map((f) => `docs/${f}`)]) {
    const html = await read(file);
    for (const { name, pattern, hooks, utilities } of SHELL) {
      const m = html.match(pattern);
      assert.ok(m, `${file}: ${name}를 못 찾았다`);
      const have = tokens(m[1] ?? "");
      assert.deepEqual(have.filter((t) => !t.startsWith("tw:")), hooks, `${file}: ${name}의 훅 class가 바뀌었다`);
      assert.deepEqual(have.filter((t) => t.startsWith("tw:")).sort(), [...utilities].sort(), `${file}: ${name}의 유틸리티가 다르다 - 188조건(첫 h2·답 시작 ≤ merge-base)을 다시 재야 한다`);
    }
    // 내비는 1층·2층 둘, 안내 aside 하나다. 더 생기면 위 SHELL 에 줄을 더하고 높이 예산을 다시 잰다.
    assert.equal([...html.matchAll(/<nav class="(?:page-nav|sub-nav)\b/g)].length, 2, `${file}: 1·2층 내비가 둘이 아니다`);
    assert.equal([...html.matchAll(/<aside\b/g)].length, 1, `${file}: aside 가 하나가 아니다`);
  }
});

test("추이 구획과 그 자리를 잡는 예약은 같은 여백 유틸리티를 받는다 - 구획이 펴지는 순간 앞뒤 간격이 안 어긋난다 (#283, #335 cto 판정 3)", async () => {
  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    const section = html.match(/<section id="trend-section" class="([^"]*)"/)?.[1];
    const reserve = html.match(/<div class="trend-reserve ([^"]*)">/)?.[1];
    assert.ok(section && reserve, `${file}: 추이 구획이나 예약을 못 찾았다 - 이 시험이 아무것도 안 본 것이다`);
    assert.deepEqual(tokens(reserve).sort(), tokens(section).sort(), `${file}: 구획과 예약의 여백이 다르다`);
    // 예약은 구획 바로 뒤 형제여야 한다(#338 이 접는 대상, CSS `#trend-section[hidden] + .trend-reserve`).
    assert.match(html, /<\/section>\s*<div class="trend-reserve tw:mb-10 tw:1024:mb-16">/, `${file}: 예약이 추이 구획 바로 뒤에 없다`);
  }
  // 옛 규칙의 숫자(24px)가 남아 있으면 유틸리티가 이기는 지금도 다음 사람이 그 숫자를 믿는다.
  const css = await read("src/css/legacy.css");
  const rule = css.match(/#trend-section\[hidden\] \+ \.trend-reserve \{([^}]*)\}/s)?.[1] ?? "";
  assert.ok(rule.includes("display: block;") && rule.includes("visibility: hidden;"), "src/css/legacy.css: 예약을 세우는 규칙이 사라졌다");
  assert.ok(!/margin-bottom\s*:/.test(rule), "src/css/legacy.css: 예약 규칙에 아래 여백 숫자가 남아 있다 - 틀의 유틸리티와 두 벌이 된다");
});

test("추이 구획과 예약의 .history-grid 는 둘 다 읽는 단 폭 유틸리티(tw:max-w-read)를 받는다 - 1280 에서 석 장 한 줄 띠가 아니라 단 안 2칸이다 (#283, po 6273570907)", async () => {
  // 구획 안 격자와 예약 안 격자가 같은 두 토큰(history-grid · tw:max-w-read)을 받으면 접힌 자리와 펴진 구획의 높이가 같이 움직인다(②-5 의 정적 보증).
  // 훅 class(history-grid)는 인라인 스크립트의 closest(".history-grid") 가 읽으므로 그대로 둔다. 다른 장의 history-grid(index 의 nested 등)는 이 틀 밖이다.
  const WANT = ["history-grid", "tw:max-w-read"];
  const grids = (html) => [...html.matchAll(/<div class="([^"]*)">/g)].map((m) => ({ cls: tokens(m[1]), at: m.index })).filter((g) => g.cls.includes("history-grid"));
  for (const file of ["scripts/realestate-template.html", ...FILES.map((f) => `docs/${f}`)]) {
    const html = await read(file);
    const g = grids(html);
    assert.equal(g.length, 2, `${file}: 여는 태그의 .history-grid 가 둘(구획 안 · 예약 안)이 아니다`);
    for (const { cls } of g) assert.deepEqual([...cls].sort(), [...WANT].sort(), `${file}: .history-grid 의 class 가 ${WANT.join(" ")} 가 아니다`);
    const sec = html.indexOf('<section id="trend-section"'), res = html.indexOf('<div class="trend-reserve');
    assert.ok(sec >= 0 && res > sec, `${file}: 추이 구획이나 예약을 못 찾았다`);
    assert.ok(g[0].at > sec && g[0].at < res, `${file}: 첫 격자가 추이 구획 안에 없다`);
    assert.ok(g[1].at > res, `${file}: 둘째 격자가 예약 안에 없다`);
  }
});

test("다시 그려지는 조각·굽는 조각·인라인 스크립트에는 유틸리티를 두지 않는다 (#283, #296 (바) cto 판정)", async () => {
  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    const scripts = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(scripts.length, 1, `${file}: 인라인 스크립트가 ${scripts.length}개다`);
    assert.ok(scripts[0].length > 50000, `${file}: 인라인 스크립트를 못 찾았다`);
    assert.ok(!scripts[0].includes("tw:"), `${file}: 인라인 스크립트에 유틸리티가 있다 - notifyBeside·foldReserve·showGridFailure 의 글자가 바뀐다`);
    assert.ok(scripts[0].includes('<p class="content-notice">') && scripts[0].includes('id="load-retry"'), `${file}: 알림 문자열이 달라졌다(#296)`);
    for (const m of html.matchAll(/<!--prerender:(\w+)-->([\s\S]*?)<!--\/prerender:\1-->/g)) {
      assert.ok(!m[2].includes("tw:"), `${file}: 굽는 조각 ${m[1]}에 유틸리티가 있다`);
    }
  }
});

test("이 틀에 <code>가 생기면 전부 글자 크기 유틸리티를 단다 (#283, #385 cto 판정 3 (1))", async () => {
  // 지금 이 틀에는 <code>가 없다(스크립트 문자열 포함). 처음 들이는 PR 이 method 와 같은 유틸리티(`tw:text-sm`)를 단다.
  for (const file of ["scripts/realestate-template.html", ...FILES.map((f) => `docs/${f}`)]) {
    for (const tag of (await read(file)).matchAll(/<code\b[^>]*>/g)) assert.equal(tag[0], '<code class="tw:text-sm">', `${file}: <code>에 글자 크기 유틸리티가 없다: ${tag[0]}`);
  }
});

test("docs/ 어느 장이든 머리·내비·구획 아래 여백 유틸리티는 넓은 화면(1024+) 변형을 같이 갖는다 (#283 이월)", async () => {
  // 폭 조건이 없는 tw:mb-2·tw:mb-10 은 1024 이상에서도 8/8/40 이다. 방향 C 시안은 데스크톱에서 머리 24 · 내비 16 · 구획 64 다.
  // 질문 입구(`nav.question-nav`)는 시안도 40 이라 구획과 다른 줄이다.
  const files = (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html")).sort();
  let headers = 0, navs = 0, sections = 0;
  for (const file of files) {
    const html = await read(`docs/${file}`);
    for (const m of html.matchAll(/<(header|nav|section)\b([^>]*)>/g)) {
      const cls = tokens(/\sclass="([^"]*)"/.exec(m[2])?.[1] ?? "");
      if (!cls.includes("tw:mb-2") && !cls.includes("tw:mb-10")) continue;
      if (m[1] === "header") { headers += 1; assert.ok(cls.includes("tw:1024:mb-6"), `${file}: 머리글에 tw:1024:mb-6 이 없다`); }
      else if (m[1] === "nav" && cls.includes("question-nav")) assert.ok(!cls.some((t) => t.startsWith("tw:1024:mb-")), `${file}: 질문 입구에 구획 값(64)이 붙었다 - 시안은 40`);
      else if (m[1] === "nav") { navs += 1; assert.ok(cls.includes("tw:1024:mb-4"), `${file}: 내비에 tw:1024:mb-4 가 없다`); }
      else { sections += 1; assert.ok(cls.includes("tw:1024:mb-16"), `${file}: 구획에 tw:1024:mb-16 이 없다`); }
    }
  }
  assert.ok(headers >= 66 && navs >= 100 && sections >= 200, `전제: 훑은 수가 너무 적다(머리 ${headers} · 내비 ${navs} · 구획 ${sections}) - 이 시험이 아무것도 안 본 것이다`);
});

test("안내 상자(aside.method-callout)가 있는 53장은 모두 같은 모양 유틸리티를 단다 (#283 이월)", async () => {
  const files = (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html")).sort();
  let n = 0;
  for (const file of files) {
    const html = await read(`docs/${file}`);
    if (!html.includes('class="method-callout')) continue;
    n += 1;
    assert.ok(html.includes('<aside class="method-callout tw:-ml-2.75 tw:pl-2 tw:border-l-3 tw:border-border-strong">'), `${file}: 안내 상자의 모양 유틸리티가 다르다`);
    assert.ok(html.includes('<p id="method-callout-text" class="tw:text-fg">'), `${file}: 안내 문단의 글자색 유틸리티가 없다`);
    assert.ok(/<a href="\.\/method\.html[^"]*" id="method-callout-link">/.test(html), `${file}: 안내 링크가 달라졌다`);
  }
  assert.equal(n, 53, `안내 상자가 있는 장이 ${n}장이다 - 53장(틀 47 + index + 도구 5)이어야 한다`);
});
