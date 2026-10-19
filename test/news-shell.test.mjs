// 뉴스 틀(docs/news.html → news·rate-news·realestate-news·stock-news) 껍데기의 Tailwind 개편(#280 PR 1)이 지켜야 하는 것.
//
// 이 개편의 범위는 틀 껍데기(머리·내비·구획 틀)뿐이다. 다시 그려지는 조각(#news-list·#summary-box·시세 카드·코스피)은
// 스크립트와 두 렌더러(scripts/prerender.mjs · scripts/render/entry.jsx)가 같은 글자로 내는 마크업이라, 여기에 모양이 바뀌는
// 유틸리티를 두면 구운 첫 화면과 다시 그린 화면이 어긋난다. 그 스크립트를 맞추는 길은 S6이 막는다(#279 PR 본문).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES } from "../scripts/build-news-pages.mjs";
import { newsKospiHtml, newsListHtml, newsRealestateStatsHtml, newsSummaryHtml } from "../scripts/prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

const FILES = ["news.html", ...NEWS_PAGES.map((p) => p.file)];
const tokens = (cls) => cls.split(/\s+/).filter(Boolean);

// 껍데기 넷. 훅 class(JS·시험·다른 장의 규칙이 읽는 이름)는 그대로 있고, 뒤에 유틸리티가 붙는다.
// 값은 방향 C의 머리·내비는 조밀하게(8)·본문 구획 사이는 넉넉하게(40)이고, 높이 예산(#280 설계 입력: `#summary-box` 윗변 ≤ merge-base)은
// 머리 아래 여백 16→8, 2층 내비 아래 여백 16→8로 사서 쓴다. 이 수를 늘리면 PR 본문의 윗변 표를 다시 재야 한다.
const SHELL = [
  { name: "머리글", pattern: /<header(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-2", "tw:1024:mb-6"] },
  { name: "1층 내비", pattern: /<nav class="([^"]*)" aria-label="섹션">/, hooks: ["page-nav"], utilities: ["tw:gap-2", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] },
  { name: "2층 내비", pattern: /<nav class="([^"]*)" aria-label="분야">/, hooks: ["sub-nav"], utilities: ["tw:gap-2", "tw:mt-0", "tw:mb-2", "tw:1024:mb-4", "tw:*:rounded"] },
  { name: "요약 구획", pattern: /<section id="summary-section"(?: class="([^"]*)")?>/, hooks: [], utilities: ["tw:mb-10", "tw:1024:mb-16"] },
];

test("뉴스 4장의 껍데기는 같은 유틸리티를 갖고 훅 class는 그대로다 (#280)", async () => {
  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    for (const { name, pattern, hooks, utilities } of SHELL) {
      const m = html.match(pattern);
      assert.ok(m, `${file}: ${name}를 못 찾았다`);
      const have = tokens(m[1] ?? "");
      assert.deepEqual(have.filter((t) => !t.startsWith("tw:")), hooks, `${file}: ${name}의 훅 class가 바뀌었다`);
      assert.deepEqual(have.filter((t) => t.startsWith("tw:")).sort(), [...utilities].sort(), `${file}: ${name}의 유틸리티가 다르다 - 높이 예산(윗변 ≤ merge-base)을 다시 재야 한다`);
    }
  }
});

test("문자열 패치(replaceOnce) 다섯 곳의 needle이 틀에 글자 그대로 한 번씩 있고, 찍은 세 장은 aria-current가 정확히 하나다 (#280)", async () => {
  const template = await read("docs/news.html");
  const count = (s, needle) => s.split(needle).length - 1;
  const needles = [
    '<link rel="canonical"',
    '<a href="./news.html" data-news-page="all" aria-current="page">',
    ...NEWS_PAGES.map((p) => `<a href="./${p.file}" data-news-page="${p.category}">`),
    '<section id="realestate-stats-section" hidden>',
    '<section id="kospi-section" hidden>',
  ];
  for (const needle of needles) assert.equal(count(template, needle), 1, `틀에 needle이 한 번이 아니다: ${needle}`);

  // 호출 5곳(정의 한 줄과 주석은 센 것이 아니다) - 세 장 모두에서 맞아야 하므로 장 수와는 무관하게 빌더의 호출 수를 못박는다.
  const builder = await read("scripts/build-news-pages.mjs");
  const calls = builder.split("\n").filter((l) => /\breplaceOnce\(/.test(l) && !/^\s*(?:function |\/\/)/.test(l));
  assert.equal(calls.length, 5, `replaceOnce 호출이 ${calls.length}곳이다 - 다섯 needle과 짝이 맞아야 한다`);

  const expected = { "news.html": "all", ...Object.fromEntries(NEWS_PAGES.map((p) => [p.file, p.category])) };
  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    const block = html.match(/<nav class="sub-nav[^"]*" aria-label="분야">[\s\S]*?<\/nav>/)?.[0];
    assert.ok(block, `${file}: 2층 내비가 없다`);
    const anchors = [...block.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    assert.equal(anchors.length, 4, `${file}: 2층 링크가 ${anchors.length}개다`);
    const current = anchors.filter((a) => a.includes('aria-current="page"'));
    assert.equal(current.length, 1, `${file}: aria-current가 ${current.length}개다`);
    assert.match(current[0], new RegExp(`data-news-page="${expected[file]}"`), `${file}: aria-current가 자기 분야에 서 있지 않다`);
  }
});

test("다시 그려지는 조각과 인라인 스크립트에는 유틸리티를 두지 않는다 - 구운 화면과 다시 그린 화면이 어긋난다 (#280)", async () => {
  // 조각을 legacy.css 선언을 글자 그대로 옮긴 유틸리티로 바꾸려면 이 시험의 허용 목록을 같은 PR에서 늘리고, 두 렌더러가 같은 글자를 내는지 함께 본다.
  const [news, summary, market] = await Promise.all([readJson("news"), readJson("summary"), readJson("market").catch(() => null)]);
  const rendered = {
    newsListHtml: newsListHtml(news, "realestate"),
    newsSummaryHtml: newsSummaryHtml(summary, "stocks"),
    newsRealestateStatsHtml: newsRealestateStatsHtml(news),
    newsKospiHtml: newsKospiHtml(market),
  };
  for (const [name, html] of Object.entries(rendered)) {
    assert.ok(html == null || typeof html === "string", `${name}: 조각이 문자열이 아니다`);
    assert.ok(!(html ?? "").includes("tw:"), `${name}: 다시 그려지는 조각에 유틸리티가 있다`);
  }
  assert.ok(rendered.newsListHtml.includes("news-item"), "전제: 기사 목록 조각이 비었다 - 이 시험이 아무것도 안 본 것이다");

  for (const file of FILES) {
    const html = await read(`docs/${file}`);
    const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script && script.length > 5000, `${file}: 인라인 스크립트를 못 찾았다`);
    assert.ok(!script.includes("tw:"), `${file}: 인라인 스크립트에 유틸리티가 있다`);
    for (const id of ["news-list", "summary-box", "realestate-stats", "kospi-stats"]) {
      const body = html.match(new RegExp(`id="${id}">([\\s\\S]*?)</(?:ul|div)>`))?.[1] ?? "";
      assert.ok(!body.includes("tw:"), `${file}: #${id}의 구운 조각에 유틸리티가 있다`);
    }
  }
});
