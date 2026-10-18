// 소개(about)·숫자를 만드는 방법(method) 두 장의 껍데기를 Tailwind 유틸리티로 바꾼 개편(#281 PR 1)이 지켜야 하는 것.
//
// 이 두 장은 색인 대상이다(robots 메타 없음, 캐노니컬은 자기 자신). 그래서 모양을 바꾸는 유틸리티는 "껍데기의 여는 태그에 class를 더하는 것"과
// "method의 인라인 <code> 열두 개"에만 있고, 글자·제목 계층·링크는 한 글자도 안 바뀐다(invariants 하드 항목이 따로 센다).
// method의 <!--prerender:budgetRules--> 조각은 scripts/budget-rules.mjs가 굽는 글이라 건드리지 않고, 인라인 스크립트도 불변이다(S6).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const FILES = ["about.html", "method.html"];
const tokens = (cls) => cls.split(/\s+/).filter(Boolean);

// 껍데기 셋. 훅 class(JS·시험·다른 장의 규칙이 읽는 이름)는 그대로 있고 뒤에 유틸리티가 붙는다.
// 값은 방향 C의 머리·내비는 조밀하게(8)·본문 구획 아래는 넉넉하게(40)이고, 높이 예산(첫 h2 ≤ merge-base)은
// 머리 아래 여백 16→8, 내비 아래 여백 16→8로 16px를 사서 본문 아래(바닥글 위) 24→40에 다시 쓴다. 이 수를 바꾸면 PR 본문의 윗변 표를 다시 재야 한다.
const SHELL = [
  { name: "머리글", pattern: /<header(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-2"] },
  { name: "1층 내비", pattern: /<nav class="([^"]*)" aria-label="섹션">/, hooks: ["page-nav"], utilities: ["tw:gap-2", "tw:mb-2", "tw:*:rounded"] },
  { name: "본문 구획", pattern: /<section class="([^"]*)">\s*<div data-lang="ko"/, hooks: ["method-body"], utilities: ["tw:mb-10"] },
];

test("소개·방법 두 장의 껍데기는 같은 유틸리티를 갖고 훅 class는 그대로다 (#281)", async () => {
  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    for (const { name, pattern, hooks, utilities } of SHELL) {
      const m = html.match(pattern);
      assert.ok(m, `${file}: ${name}를 못 찾았다`);
      const have = tokens(m[1] ?? "");
      assert.deepEqual(have.filter((t) => !t.startsWith("tw:")), hooks, `${file}: ${name}의 훅 class가 바뀌었다`);
      assert.deepEqual(have.filter((t) => t.startsWith("tw:")).sort(), [...utilities].sort(), `${file}: ${name}의 유틸리티가 다르다 - 높이 예산(첫 h2 ≤ merge-base)을 다시 재야 한다`);
    }
  }
});

test("method의 인라인 <code>는 열두 개 전부 글자 크기 유틸리티를 달고, 소개에는 <code>가 없다 (#281)", async () => {
  // <code>의 0.85em은 monospace 글꼴에서 13px 기준이라 375폭에서 11.05px가 된다(렌더 검사 ③ 글자 크기 하한 12px 미만). 문장 속 글자는 15px 이상이다(po 기준 5).
  const method = await read("docs/method.html");
  const codes = [...method.matchAll(/<code\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(codes.length, 12, `method의 <code>가 ${codes.length}개다 - 한국어 6 + 영어 6이어야 한다. 늘렸다면 이 시험의 수와 PR 본문을 같이 고친다`);
  for (const tag of codes) assert.equal(tag, '<code class="tw:text-sm">', `<code>에 글자 크기 유틸리티가 없다: ${tag}`);
  assert.ok(!/<code\b/.test(await read("docs/about.html")), "소개에 <code>가 생겼다 - 같은 유틸리티를 달아야 하는지 본다");
});

test("굽는 조각(budgetRules)과 인라인 스크립트에는 유틸리티를 두지 않는다 (#281)", async () => {
  // 조각은 scripts/budget-rules.mjs(와 예산대 18장의 같은 글)가 내는 글이다. 여기에 모양이 바뀌는 유틸리티를 두면 굽는 쪽과 어긋난다.
  const method = await read("docs/method.html");
  const frag = method.match(/<!--prerender:budgetRules-->([\s\S]*?)<!--\/prerender:budgetRules-->/)?.[1];
  assert.ok(frag && frag.length > 500, "전제: budgetRules 조각이 비었다 - 이 시험이 아무것도 안 본 것이다");
  assert.ok(!frag.includes("tw:"), "굽는 조각 budgetRules에 유틸리티가 있다");
  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    const scripts = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(scripts.length, 1, `${file}: 인라인 스크립트가 ${scripts.length}개다`);
    assert.ok(scripts[0].length > 2000, `${file}: 인라인 스크립트를 못 찾았다`);
    assert.ok(!scripts[0].includes("tw:"), `${file}: 인라인 스크립트에 유틸리티가 있다`);
  }
});

test("두 장은 색인 대상으로 남는다 - 캐노니컬은 자기 자신, robots 메타 없음, h1 하나, 제목 단계는 건너뛰지 않는다 (#281)", async () => {
  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    assert.ok(
      html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/jipgye/${file}">`),
      `${file}: 캐노니컬이 자기 자신이 아니다`,
    );
    assert.ok(!/<meta\s+name="robots"/i.test(html), `${file}: robots 메타가 생겼다 - 색인 대상이다`);
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((n) => n === 1).length, 1, `${file}: h1이 하나가 아니다`);
    assert.equal(levels[0], 1, `${file}: 첫 제목이 h1이 아니다`);
    for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] - levels[i - 1] <= 1, `${file}: 제목 단계를 건너뛴다(h${levels[i - 1]} → h${levels[i]})`);
    assert.ok(levels.filter((n) => n === 2).length >= 8, `${file}: h2가 너무 적다 - 본문 제목이 지워졌다`);
  }
});
