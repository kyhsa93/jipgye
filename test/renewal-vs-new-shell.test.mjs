// 재계약(renewal-vs-new) 장의 껍데기를 Tailwind 유틸리티로 바꾼 개편(#281 PR 3)이 지켜야 하는 것.
//
// 이 장은 색인 대상이다(robots 메타 없음, 캐노니컬은 자기 자신). 그래서 모양을 바꾸는 유틸리티는 "껍데기 여는 태그에 class를 더하는 것"에만 있고,
// 글자·제목 계층·링크는 한 글자도 안 바뀐다(invariants 하드 항목이 따로 센다). 손으로 쓴 HTML 이라 빌더(replaceOnce)는 걸리지 않는다.
// 굽는 조각 여섯(<!--prerender:renewal…-->)과 다시 그려지는 표·링크(스크립트가 통째로 innerHTML 로 바꾼다)와 인라인 스크립트는 불변이다(S6, 두 렌더러).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const FILE = "renewal-vs-new.html";
const read = () => readFile(path.join(root, "docs", FILE), "utf8");
const tokens = (cls) => cls.split(/\s+/).filter(Boolean);

// 껍데기 일곱. 훅 class(JS·시험·다른 장의 규칙이 읽는 이름)는 그대로 있고 뒤에 유틸리티가 붙는다.
// 값은 방향 C의 머리·내비는 조밀하게(8)·본문 구획 사이는 넉넉하게(40)이고(#384·#385 와 같은 값), 높이 예산(첫 h2 ≤ merge-base)은
// 머리 아래 여백 16→8, 2층 내비 아래 여백 16→8로 16px를 산다. 이 수를 바꾸면 PR 본문의 윗변 표를 다시 재야 한다.
const SHELL = [
  { name: "머리글", pattern: /<header(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-2", "tw:1024:mb-6"] },
  { name: "1층 내비", pattern: /<nav class="([^"]*)" aria-label="섹션">/, hooks: ["page-nav"], utilities: ["tw:gap-2", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] },
  { name: "2층 내비", pattern: /<nav class="([^"]*)" aria-label="거래 유형">/, hooks: ["sub-nav"], utilities: ["tw:gap-2", "tw:mt-0", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] },
  ...["check", "lead", "district", "wolse", "cap"].map((id) => ({
    name: `${id} 구획`,
    pattern: new RegExp(`<section id="${id}-section"(?: class="([^"]*)")?>`),
    hooks: [],
    utilities: ["tw:mb-10", "tw:1024:mb-16"],
  })),
];

test("재계약 장의 껍데기는 같은 유틸리티를 갖고 훅 class는 그대로다 (#281)", async () => {
  const html = await read();
  for (const { name, pattern, hooks, utilities } of SHELL) {
    const m = html.match(pattern);
    assert.ok(m, `${FILE}: ${name}를 못 찾았다`);
    const have = tokens(m[1] ?? "");
    assert.deepEqual(have.filter((t) => !t.startsWith("tw:")), hooks, `${FILE}: ${name}의 훅 class가 바뀌었다`);
    assert.deepEqual(have.filter((t) => t.startsWith("tw:")).sort(), [...utilities].sort(), `${FILE}: ${name}의 유틸리티가 다르다 - 높이 예산(첫 h2 ≤ merge-base)을 다시 재야 한다`);
  }
  // 구획 id 가 바뀌어도 이 시험이 눈먼 채 통과하지 않게: 구획 다섯은 이 순서로 한 번씩(맨 앞 재계약 확인기는 #652 V3), 여섯째(질문 입구)는 스크립트가 채우므로 유틸리티가 없다.
  const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["check-section", "lead-section", "district-section", "wolse-section", "cap-section", "other-questions"], `${FILE}: 구획이 달라졌다`);
  // 첫 구획 위의 안내(방법 안내 aside)는 스크립트가 글자만 바꾸는 곳이고 모양은 #283 이 53장 한 번에 정했다(test/realestate-shell.test.mjs).
  const callout = html.match(/<aside\b[^>]*>/)?.[0];
  assert.equal(callout, '<aside class="method-callout tw:-ml-2.75 tw:pl-2 tw:border-l-3 tw:border-border-strong">', `${FILE}: 안내 aside 의 모양 유틸리티가 달라졌다(#283 이 53장 한 번에 정했다): ${callout}`);
  const entry = html.match(/<section id="other-questions"[^>]*>/)?.[0];
  assert.ok(entry && !entry.includes("tw:"), `${FILE}: 질문 입구 구획에 유틸리티가 붙었다: ${entry}`);
});

test("이 장에 <code>가 생기면 전부 글자 크기 유틸리티를 단다 (#281, #385 cto 판정 3 (1))", async () => {
  // <code>의 0.85em은 monospace 글꼴에서 13px 기준이라 375폭에서 11.05px가 된다(렌더 검사 ③ 글자 크기 하한 12px 미만).
  // 지금 이 장에는 <code>가 없다 - 처음 들이는 PR 이 method 와 같은 유틸리티(`tw:text-sm`)를 단다. 관용구를 `[&_code]` 로 바꾸지 않는다.
  const html = await read();
  const codes = [...html.matchAll(/<code\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of codes) assert.equal(tag, '<code class="tw:text-sm">', `<code>에 글자 크기 유틸리티가 없다: ${tag}`);
});

test("굽는 조각 여섯·다시 그려지는 링크·인라인 스크립트에는 유틸리티를 두지 않는다 (#281)", async () => {
  // 조각은 scripts/prerender.ts 와 scripts/render/entry.jsx 두 렌더러가 같은 글자로 내고, 표·링크는 스크립트가 데이터를 받으면 통째로 다시 그린다.
  // 여기에 모양이 바뀌는 유틸리티를 두면 구운 첫 화면과 다시 그린 화면이 어긋난다.
  const html = await read();
  const names = ["renewalLead", "renewalDistricts", "renewalWolseLead", "renewalWolseDistricts", "renewalCapLead", "renewalDistrictLinks"];
  for (const name of names) {
    const frag = html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];
    assert.ok(frag && frag.length > 30, `전제: ${name} 조각이 비었다 - 이 시험이 아무것도 안 본 것이다`);
    assert.ok(!frag.includes("tw:"), `굽는 조각 ${name}에 유틸리티가 있다`);
  }
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, `${FILE}: 인라인 스크립트가 ${scripts.length}개다`);
  assert.ok(scripts[0].length > 5000, `${FILE}: 인라인 스크립트를 못 찾았다`);
  assert.ok(!scripts[0].includes("tw:"), `${FILE}: 인라인 스크립트에 유틸리티가 있다`);
});

test("이 장은 색인 대상으로 남는다 - 캐노니컬은 자기 자신, robots 메타 없음, h1 하나, 제목 단계는 건너뛰지 않는다 (#281)", async () => {
  const html = await read();
  assert.ok(html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/jipgye/${FILE}">`), `${FILE}: 캐노니컬이 자기 자신이 아니다`);
  assert.ok(!/<meta\s+name="robots"/i.test(html), `${FILE}: robots 메타가 생겼다 - 색인 대상이다`);
  // 제목 계층은 스크립트 문자열 속 글자를 세지 않도록 <script>를 뺀 마크업에서 읽는다.
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const levels = [...markup.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.equal(levels.filter((n) => n === 1).length, 1, `${FILE}: h1이 하나가 아니다`);
  assert.equal(levels[0], 1, `${FILE}: 첫 제목이 h1이 아니다`);
  for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] - levels[i - 1] <= 1, `${FILE}: 제목 단계를 건너뛴다(h${levels[i - 1]} → h${levels[i]})`);
  assert.equal(levels.filter((n) => n === 2).length, 5, `${FILE}: h2가 다섯이 아니다(재계약 확인기 #652 V3 포함) - 본문 제목이 지워졌거나 늘었다`);
});
