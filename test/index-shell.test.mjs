// 첫 화면(docs/index.html)의 껍데기를 Tailwind 유틸리티로 바꾼 개편(#398)이 지켜야 하는 것.
//
// 이 장은 색인 대상이다(robots 메타 없음, 캐노니컬은 루트). 모양을 바꾸는 유틸리티는 "껍데기 여는 태그에 class를 더하는 것"에만 있고,
// 글자·제목 계층·링크는 바뀌지 않는다(invariants 하드 항목이 따로 센다). 손으로 쓴 HTML 이라 빌더(replaceOnce)는 걸리지 않고, 굽는 조각 넷
// (<!--prerender:realestate·market·summary·news-->)은 scripts/prerender.ts 와 scripts/render/entry.jsx 두 렌더러가 같은 글자로 낸다.
// 이 개편이 껍데기 유틸리티 말고 더한 것은 하나다: 갱신 주기 안내(#update-schedule)를 머리에서 바닥글 첫 줄로 옮기고 15px 로 한다(po 「구현 때 고친다」 ①).
//
// 높이 예산(PR 본문): 머리 아래 16→8 · 1층 내비 아래 16→8 · 머리에서 뺀 갱신 주기 안내 한 줄(ko 41px)이 첫 h2 를 59px 올린다. 그 59px 은 질문 입구의 묶음 사이(8→24, 둘)와
// 입구 아래(16→40)에 도로 쓴다(시안 C 의 값) - 시세 구획(#realestate-section) 제목이 접히는 선(812px) 아래에 남아야 하기 때문이다. 선 안으로 올라오면 영어에서
// 번역 안내(#content-notice)가 켜질 때 그 구획이 한 번 밀려 CLS 로 잡힌다(#307 3번 새 이동 요소 0 - PR 본문 「1차 시도」). 이 수들을 바꾸면 윗변 표를 다시 잰다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const FILE = "index.html";
const read = (rel = `docs/${FILE}`) => readFile(path.join(root, rel), "utf8");
const tokens = (cls) => cls.split(/\s+/).filter(Boolean);

// 껍데기. 훅 class(JS·시험·다른 장의 규칙이 읽는 이름)는 그대로 있고 뒤에 유틸리티가 붙는다.
// 값은 방향 C의 머리·내비는 조밀하게(8)·본문 구획 사이는 넉넉하게(40)이고(#384·#385·#399 와 같은 값), 높이 예산(첫 h2 ≤ merge-base)은
// 머리 아래 여백 16→8, 1층 내비 아래 여백 16→8로 16px를 산다. 이 수를 바꾸면 PR 본문의 윗변 표(252 조건)를 다시 재야 한다.
const SHELL = [
  { name: "머리글", pattern: /<header(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-2", "tw:1024:mb-6"] },
  // 1층 내비는 다른 장과 같이 aria-label="섹션" 을 갖는다(#465, 예전엔 index 만 없었다). 훅 class 로 찾는다.
  { name: "1층 내비", pattern: /<nav class="(page-nav[^"]*)" aria-label="섹션">/, hooks: ["page-nav"], utilities: ["tw:gap-2", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] },
  // 질문 입구: 묶음 사이 24(grid gap 8→24) · 입구 아래 40(16→40). 시안 C(c-layout.css `.question-nav { gap: 24px }` · c.css `.question-nav { margin-bottom: 40px }`)와 같은 값이다.
  { name: "질문 입구", pattern: /<nav class="(question-nav[^"]*)" id="question-nav"/, hooks: ["question-nav"], utilities: ["tw:gap-6", "tw:mb-10"] },
  ...["realestate", "market", "summary", "news"].map((id) => ({
    name: `${id} 구획`,
    pattern: new RegExp(`<section id="${id}-section"(?: class="([^"]*)")?>`),
    hooks: [],
    utilities: ["tw:mb-10", "tw:1024:mb-16"],
  })),
];

test("index 의 껍데기는 같은 유틸리티를 갖고 훅 class는 그대로다 (#398)", async () => {
  const html = await read();
  for (const { name, pattern, hooks, utilities } of SHELL) {
    const m = html.match(pattern);
    assert.ok(m, `${FILE}: ${name}를 못 찾았다`);
    const have = tokens(m[1] ?? "");
    assert.deepEqual(have.filter((t) => !t.startsWith("tw:")), hooks, `${FILE}: ${name}의 훅 class가 바뀌었다`);
    assert.deepEqual(have.filter((t) => t.startsWith("tw:")).sort(), [...utilities].sort(), `${FILE}: ${name}의 유틸리티가 다르다 - 높이 예산(첫 h2 ≤ merge-base)을 다시 재야 한다`);
  }
  // 구획 id 가 바뀌어도 이 시험이 눈먼 채 통과하지 않게: 구획 다섯은 이 순서로 한 번씩이다.
  const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["realestate-section", "market-section", "summary-section", "news-section", "archive-section"], `${FILE}: 구획이 달라졌다`);
  // 마지막 구획(지난 기록)에는 달지 않는다: 바로 뒤가 .site-footer(margin-top 40)라 마진이 상쇄돼 40 이 이미 나온다(cto #399 판정 2(1)).
  // 이 상쇄는 .site-footer 의 margin-top 에 기댄다 - 그 값을 바꾸거나 구획과 바닥글 사이에 요소를 넣으면 이 구획에도 tw:mb-10 을 달고 장 높이를 다시 잰다.
  assert.ok(html.includes('<section id="archive-section">'), `${FILE}: 지난 기록 구획 여는 태그가 달라졌다`);
  assert.match(html, /<\/section>\n\n {2}<footer class="site-footer">/, `${FILE}: 지난 기록 구획과 바닥글 사이에 무엇이 끼었다 - 마진 상쇄가 깨진다`);
  const css = await read("src/css/legacy.css");
  assert.match(css, /\.site-footer \{\s*margin-top: 40px;/, ".site-footer 의 margin-top 이 40px 가 아니다 - 지난 기록 구획의 마진 상쇄 전제가 깨진다");
  // 방법 안내 aside 의 모양은 #283 이 53장 한 번에 정했다(test/realestate-shell.test.mjs 가 지킨다). 질문 입구 제목·검색창은 첫 h2 높이를 정하는 곳이라 유틸리티가 없다.
  for (const tag of [html.match(/<h2\b[^>]*id="question-heading"[^>]*>/)?.[0], html.match(/<form\b[^>]*role="search"[^>]*>/)?.[0]]) {
    assert.ok(tag && !tag.includes("tw:"), `${FILE}: 질문 입구 제목·검색창 여는 태그에 유틸리티가 붙었다: ${tag}`);
  }
});

test("갱신 주기 안내(#update-schedule)는 머리가 아니라 바닥글 첫 줄에 있고 15px 유틸리티를 단다 (#398, po 「구현 때 고친다」 ①)", async () => {
  // 13px 문장은 기준 5 위반이라 불승인이었다(#278). 머리에서 15px 로 키우면 영어 375폭에서 3줄→5줄이 되어 첫 h2 가 merge-base 보다 낮아지므로(PR 본문),
  // 시안(c-layout)이 한 대로 바닥글 첫 줄로 옮긴다. 바닥글은 접힌 선 밖이라 채워져도 이동으로 안 잡히고, 문구 "아래 갱신 시각"은 바로 아래 #updated 를 가리킨다.
  const html = await read();
  const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.ok(header.includes('id="page-title"'), "전제: 머리글을 못 읽었다 - 이 시험이 아무것도 안 본 것이다");
  assert.ok(!header.includes('id="update-schedule"'), `${FILE}: #update-schedule 이 머리에 있다`);
  const footer = html.match(/<footer class="site-footer">\n( {4}<div[^>]*>)([^\n]*)\n( {4}<div[^>]*>)/);
  assert.ok(footer, `${FILE}: 바닥글 첫 줄을 못 읽었다`);
  assert.equal(footer[1], '    <div class="update-schedule tw:text-sm tw:mb-2" id="update-schedule">', `${FILE}: 바닥글 첫 줄이 갱신 주기 안내가 아니다`);
  assert.equal(footer[2], "</div>", `${FILE}: 갱신 주기 안내는 구운 HTML 에서 비어 있어야 한다(스크립트가 채운다)`);
  assert.ok(footer[3].includes('id="updated"'), `${FILE}: 갱신 주기 안내 바로 아래가 #updated 가 아니다 - 문구의 "아래 갱신 시각"이 어긋난다`);
  assert.equal(html.split('id="update-schedule"').length - 1, 1, `${FILE}: #update-schedule 이 하나가 아니다`);
  // 스크립트가 이 요소를 읽는 길(id)은 그대로다 - 인라인 스크립트는 바뀌지 않는다.
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1] ?? "";
  assert.ok(script.includes('document.getElementById("update-schedule")'), `${FILE}: 스크립트가 #update-schedule 을 더는 id 로 읽지 않는다`);
});

test("굽는 조각 넷·인라인 스크립트에는 유틸리티를 두지 않고, <code>가 생기면 글자 크기 유틸리티를 단다 (#398)", async () => {
  // 조각은 두 렌더러가 같은 글자로 내고, 표·카드는 스크립트가 데이터를 받으면 통째로 다시 그린다. 여기에 모양이 바뀌는 유틸리티를 두면
  // 구운 첫 화면과 다시 그린 화면이 어긋난다. 같은 이유로 인라인 스크립트(한·영 문자열표 포함)는 한 글자도 안 바뀐다(S6).
  const html = await read();
  for (const name of ["realestate", "market", "summary", "news"]) {
    const frag = html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];
    assert.ok(frag && frag.length > 30, `전제: ${name} 조각이 비었다 - 이 시험이 아무것도 안 본 것이다`);
    assert.ok(!frag.includes("tw:"), `굽는 조각 ${name}에 유틸리티가 있다`);
  }
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, `${FILE}: 인라인 스크립트가 ${scripts.length}개다`);
  assert.ok(scripts[0].length > 50000, `${FILE}: 인라인 스크립트를 못 찾았다`);
  assert.ok(!scripts[0].includes("tw:"), `${FILE}: 인라인 스크립트에 유틸리티가 있다`);
  // 이 장에는 <code>가 없다 - 처음 들이는 PR 이 method 와 같은 유틸리티(`tw:text-sm`)를 단다.
  for (const tag of [...html.matchAll(/<code\b[^>]*>/g)].map((m) => m[0])) assert.equal(tag, '<code class="tw:text-sm">', `<code>에 글자 크기 유틸리티가 없다: ${tag}`);
});

test("index 는 색인 대상으로 남고 「답 시작」 자(시세표 첫 행)가 서 있다 (#398, #278 여덟째 선택자)", async () => {
  const html = await read();
  assert.ok(html.includes('<link rel="canonical" href="https://kyhsa93.github.io/jipgye/">'), `${FILE}: 캐노니컬이 루트가 아니다`);
  assert.ok(!/<meta\s+name="robots"/i.test(html), `${FILE}: robots 메타가 생겼다 - 색인 대상이다`);
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const levels = [...markup.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.equal(levels.filter((n) => n === 1).length, 1, `${FILE}: h1이 하나가 아니다`);
  assert.equal(levels[0], 1, `${FILE}: 첫 제목이 h1이 아니다`);
  for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] - levels[i - 1] <= 1, `${FILE}: 제목 단계를 건너뛴다(h${levels[i - 1]} → h${levels[i]})`);
  assert.equal(levels.filter((n) => n === 2).length, 6, `${FILE}: h2가 여섯이 아니다 - 본문 제목이 지워졌거나 늘었다`);
  // 「답 시작」 = #realestate-grid 의 첫 tr(thead 행이 아니다). index 에서만 센다 - 여섯 선택자는 이 장에 없고 #summary-box 는 있어도 세지 않는다(cto 판정 §2-1).
  // 표를 카드·다른 마크업으로 바꾸거나 첫 행을 지우면 자명 통과가 아니라 cto 판정 사안이다 - 이 시험이 먼저 알린다.
  for (const sel of ["budget-result", "calc-result", "search-result", "products-body", "overall-cards", "switch-answer"]) {
    assert.ok(!html.includes(`id="${sel}"`) && !html.includes(`class="${sel}"`), `${FILE}: 다른 장의 답 요소(#${sel})가 생겼다 - 문서 순서 첫째 규칙이 바뀐다(#278)`);
  }
  assert.equal(html.split('id="realestate-grid"').length - 1, 1, `${FILE}: #realestate-grid 가 하나가 아니다`);
  const tbody = html.match(/<tbody id="realestate-grid">([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const firstRow = tbody.match(/<tr>([\s\S]*?)<\/tr>/)?.[1] ?? "";
  assert.ok(/<td>[^<]+<\/td>/.test(firstRow), `${FILE}: 시세표 첫 행이 없거나 첫 칸이 비었다 - 「답 시작」 자가 눈먼다`);
  assert.ok(!/\berror\b/.test(firstRow), `${FILE}: 구운 첫 행이 오류 행이다`);
  // 첫 칸 이름의 출처가 둘이다: 구운 글자(두 렌더러)와 인라인 문자열표 realestateOverallLabel(스크립트가 .json 을 받아 다시 그릴 때, #405).
  // ko 는 구운 글자와 같아야 첫 칸 교체가 없고, en 은 시세 장(realestate.html)의 영어 사전 overall 과 같은 글자여야 한다. 문자열표는 ko 첫째·en 둘째이고 JS 를 실행하지 않는다.
  // 둘을 하나로 모으는 일은 렌더러 편집(D 면)이라 여기서 하지 않는다(#474) - 갈리면 이 단언이 먼저 알린다.
  const bakedName = firstRow.match(/^<td>([^<]+)<\/td>/)?.[1];
  const labels = [...html.matchAll(/realestateOverallLabel:\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 2, `${FILE}: realestateOverallLabel 이 ko·en 둘이 아니다`);
  assert.equal(labels[0], bakedName, `${FILE}: 구운 첫 칸 글자와 문자열표 ko realestateOverallLabel 이 다르다 - 방문자 화면에서 첫 칸이 바뀐다`);
  const realestateOverall = [...(await read("docs/realestate.html")).matchAll(/\boverall:\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.equal(realestateOverall.length, 2, "realestate.html: 사전 overall 이 ko·en 둘이 아니다");
  assert.equal(labels[1], realestateOverall[1], `${FILE}: 문자열표 en realestateOverallLabel 이 realestate.html 영어 사전 overall 과 다르다`);
});
