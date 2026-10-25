import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES, buildNewsPage } from "../scripts/build-news-pages.ts";
import { REALESTATE_PAGES, buildDistrictPage, buildRealestatePage } from "../scripts/build-realestate-pages.ts";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "../scripts/district-slugs.ts";
import { formatPercent } from "../scripts/realestate-format.ts";
import { readDataSources } from "../scripts/source-age.ts";
import { stripInlineScriptComments, stripJsComments } from "../scripts/strip-inline-comments.ts";
import { FALLBACK_NOTE_KO, hasFallback } from "../scripts/summary-note.ts";
import { CROSS_PAGES, PAGE_SOURCES, baselineFor, stampHtml } from "../scripts/updated-stamp.ts";
import {
  REALESTATE_TEMPLATE_PATH,
  applyPrerender,
  escapeHtml,
  marketHtml,
  newsHtml,
  realestateHeadHtml,
  realestateHtml,
  realestateOverallHtml,
  realestateTableHtml,
} from "../scripts/prerender.ts";
import { jsInlineScripts, proveCommentsOnly } from "./helpers/comment-proof.mjs";
import { buildFixtureSite } from "./helpers/fixture-site.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

/**
 * 고정 데이터로 렌더 스크립트를 실제로 돌려 본 결과가 데이터를 장의 제자리에 꽂는가 (#507, 구조 B-1).
 *
 * 이 파일의 시험은 저장소의 docs/data·raw 도, 오늘 날짜도 읽지 않는다. test/fixtures/site/data 의 얼린 데이터로 임시 폴더에서
 * prerender·build-news-pages·build-realestate-pages·build-updated-stamp 를 돌리고(test/helpers/fixture-site.mjs),
 * 그 출력을 본다. 아래 열세 시험은(금리 장 짝 하나는 #577 B2 로 지웠다) 예전에 각 시험 파일에 있던 "커밋된 docs/*.html 이 지금 docs/data 와 맞다" 시험의 짝이다 -
 * 같은 단언을, 커밋된 생성물·데이터 대신 고정 데이터와 그 출력에 대고 한다. 원래 시험(커밋된 짝 검사)은 tools/health 로 옮겼다.
 * 이름 앞 꼬리표는 옮겨 간 곳이다: [파일 이름] 원래 시험 이름.
 *
 * 빌드는 한 번(약 2초)이고 열세 시험이 나눠 쓴다. 틀(docs/*.html 중 손으로 쓰는 것, scripts/*-template.html)은 저장소 것을 그대로 쓴다.
 */

const repo = path.resolve(import.meta.dirname, "..");
const site = buildFixtureSite();
after(() => site.cleanup());

const fixtureRead = (name) => readFile(path.join(import.meta.dirname, "fixtures/site/data", `${name}.json`), "utf8").then(JSON.parse);
const repoRead = (rel) => readFile(path.join(repo, rel), "utf8");
const block = (html, name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];

// --- index.html · 요약 상자 --------------------------------------------------------------------------------------------

// #575 PR2: 메인의 AI 요약 상자·뉴스 다섯 건은 뉴스 화면으로 옮겼다 - 자리표시는 셋(값 한 줄·실거래·뉴스 화면 링크)이다.
// 옛 [summary-box] 짝(메인 요약 상자 = summaryHtml.legacy)은 상자가 없어져 지웠다. 기사 제목이 구운 HTML 에 있는지는 뉴스 화면 몫이다.
test("[prerender] 고정 데이터로 찍은 index.html 은 세 자리표시에 그 데이터의 조각을 싣는다 - 다시 그려도 같다", async () => {
  const html = site.read("docs/index.html");
  const [market, realestate, news] = await Promise.all(["market", "realestate", "news"].map(fixtureRead));

  const expected = applyPrerender(html, {
    market: marketHtml(market),
    realestate: realestateHtml(realestate),
    news: newsHtml(news),
  });

  assert.equal(html, expected, "docs/index.html 이 고정 데이터와 어긋난다. node scripts/prerender.ts 가 데이터를 자리표시에 못 꽂았다.");
  assert.equal(block(html, "news"), `<a href="./news.html" id="news-link" data-n="${news.items.length}">오늘 뉴스 ${news.items.length}건·AI 요약 →</a>`, "뉴스 자리에 고정 데이터 건수가 없다");
  assert.ok(!html.includes("<!--prerender:summary-->"), "메인에 요약 자리표시가 남았다");
});

test("[prerender] 고정 데이터로 찍은 news.html 에 첫 기사 제목·링크가 이스케이프되어 실제로 들어 있다", async () => {
  const html = site.read("docs/news.html");
  const news = await fixtureRead("news");
  const first = news.items[0];
  assert.ok(first, "기사가 한 건도 없다 - 고정 데이터가 비었다");
  assert.ok(html.includes(escapeHtml(first.title)), "첫 기사 제목이 정적 HTML에 없다");
  assert.ok(html.includes(escapeHtml(first.link)), "첫 기사 링크가 정적 HTML에 없다");
  // 고정 기사 제목에는 & < > " 가 들어 있다. 날것으로 들어갔다면 마크업이 깨진다.
  assert.ok(!html.includes("<b>\"따옴표\"</b>"), "제목의 마크업이 이스케이프되지 않았다");
});

test("[summary-note] 고정 요약의 검증 폴백 유무가 구운 장 다섯의 안내 줄 유무와 맞는다 (#350)", async () => {
  const summary = await fixtureRead("summary");
  assert.ok(hasFallback(summary.categories), "고정 요약에 폴백이 하나는 있어야 '있는 날' 갈래를 본다");
  assert.ok(!hasFallback(summary.categories.filter((c) => c.key === "realestate")), "폴백이 없는 분야가 하나는 있어야 '없는 날' 갈래를 본다");
  const noteOf = (html, cls) => html.includes(`<div class="${cls}">${FALLBACK_NOTE_KO}</div>`);
  const boxOf = (html, marker) => {
    const open = `<!--prerender:${marker}-->`;
    const a = html.indexOf(open);
    const b = html.indexOf(`<!--/prerender:${marker}-->`);
    assert.ok(a > 0 && b > a, `${marker} 자리표시를 찾지 못했다`);
    return html.slice(a + open.length, b);
  };
  // 메인 요약 상자는 #575 PR2 에서 뉴스 화면으로 옮겼다 - 안내 줄은 뉴스 장 다섯만 본다.

  const hub = boxOf(site.read("docs/news.html"), "newsSummary");
  assert.equal(noteOf(hub, "summary-note"), hasFallback(summary.categories.filter((c) => c.lineKo)), "docs/news.html 의 안내 줄이 고정 summary.json 과 어긋난다.");
  for (const page of NEWS_PAGES) {
    const box = boxOf(site.read(`docs/${page.file}`), "newsSummary");
    const shown = summary.categories.filter((c) => c.key === page.category && c.lineKo);
    assert.equal(noteOf(box, "summary-note"), hasFallback(shown), `docs/${page.file} 의 안내 줄이 고정 summary.json 과 어긋난다. node scripts/build-news-pages.ts 를 실행하세요.`);
  }
});

// --- 뉴스·금리·시세 페이지 -----------------------------------------------------------------------------------------------

test("[news-pages] 고정 데이터로 찍은 카테고리 페이지가 buildNewsPage 로 다시 찍은 결과와 같다", async () => {
  const [news, summary, market] = await Promise.all(["news", "summary", "market"].map(fixtureRead));
  const baseHtml = site.read("docs/news.html");

  for (const page of NEWS_PAGES) {
    const built = buildNewsPage(baseHtml, page, { news, summary, market });
    assert.equal(site.read(`docs/${page.file}`), built, `docs/${page.file}이 고정 데이터와 어긋납니다. node scripts/build-news-pages.ts를 실행하세요.`);
  }
});

test("[realestate-pages] 고정 데이터로 찍은 거래 유형별 페이지가 buildRealestatePage 로 다시 찍은 결과와 같다", async () => {
  const [baseHtml, realestate, complexRatio] = await Promise.all([repoRead("scripts/realestate-template.html"), fixtureRead("realestate"), fixtureRead("complex-ratio")]);

  for (const page of REALESTATE_PAGES) {
    const committed = site.read(`docs/${page.file}`);
    // 틀에는 기준일이 비어 있고 날짜는 build-updated-stamp가 나중에 찍는다(#374). 출력본의 날짜를 같이 찍어 견준다.
    const ymd = /data-updated="(\d{4}-\d{2}-\d{2})"/.exec(committed)?.[1];
    assert.ok(ymd, `docs/${page.file}에 기준일이 없다`);
    assert.equal(
      committed,
      stampHtml(buildRealestatePage(baseHtml, page, realestate, complexRatio?.seoul ?? null), ymd),
      `docs/${page.file}이 고정 데이터와 어긋납니다. node scripts/build-realestate-pages.ts를 실행하세요.`
    );
  }
});

test("[realestate-pages] 고정 데이터로 찍은 자치구 페이지 25개가 buildDistrictPage 로 다시 찍은 결과와 같다", async () => {
  const [baseHtml, realestate, renewal, complexRatio] = await Promise.all([
    repoRead("scripts/realestate-template.html"),
    fixtureRead("realestate"),
    fixtureRead("renewal-facts"),
    fixtureRead("complex-ratio"),
  ]);

  assert.equal(DISTRICT_PAGES.length, 25);
  for (const district of DISTRICT_PAGES) {
    // 자치구 페이지는 realestate.json 말고 그 구의 전수 거래 파일도 읽는다. 고정 데이터에는 그 파일이 없다 - 스크립트도 null 로 넘긴다.
    const deals = await fixtureRead(`deals-${DISTRICT_SLUGS[district.name]}`).catch(() => null);
    assert.equal(deals, null, `고정 데이터에 deals-${DISTRICT_SLUGS[district.name]} 가 생기면 이 시험의 전제(구별 거래 없음)가 바뀐다`);
    const committed = site.read(`docs/${district.file}`);
    const ymd = /data-updated="(\d{4}-\d{2}-\d{2})"/.exec(committed)?.[1];
    assert.ok(ymd, `docs/${district.file}에 기준일이 없다`);
    assert.equal(
      committed,
      stampHtml(
        buildDistrictPage(baseHtml, district, realestate, deals, renewal?.districts?.[district.name] ?? null, complexRatio?.districts?.[district.name] ?? null),
        ymd
      ),
      `docs/${district.file}이 고정 데이터와 어긋납니다. node scripts/build-realestate-pages.ts를 실행하세요.`
    );
  }
});

test("[inline-comments] 고정 데이터로 나가는 docs/realestate.html 은 틀을 채우고 훑개를 건 것뿐이다 (#374)", async () => {
  const template = await repoRead("scripts/realestate-template.html");
  const baked = site.read("docs/realestate.html");

  // 스크립트: 나가는 장의 인라인 스크립트는 틀의 것에서 훑개가 주석을 뗀 글자와 같고, 증명기(구문 + 지운 글자)도 통과한다.
  const a = jsInlineScripts(template);
  const b = jsInlineScripts(baked);
  assert.equal(a.length, b.length, "인라인 스크립트 수가 다르다");
  let removed = 0;
  for (let k = 0; k < a.length; k += 1) {
    assert.equal(b[k].body, stripJsComments(a[k].body), `${k + 1}번째 스크립트가 틀에서 주석만 뗀 것과 다르다`);
    const proof = proveCommentsOnly(a[k].body, b[k].body);
    assert.ok(proof.ok, `${k + 1}번째 스크립트: ${proof.chars.why ?? "구문이 다르다"}`);
    removed += proof.removed;
  }
  assert.ok(removed >= 40, `틀의 주석을 거의 못 뗐다(${removed}개) - 증명이 빈손이다`);

  // 마크업: 스크립트 본문을 비우고 표지 안쪽·기준일 줄을 접으면 둘이 글자까지 같다.
  const fold = (html) =>
    html
      .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2")
      .replace(/<!--prerender:(\w+)-->[\s\S]*?<!--\/prerender:\1-->/g, "<!--prerender:$1-->")
      .replace(/<div class="updated" id="updated"[^>]*>[^<]*<\/div>/, '<div class="updated" id="updated"></div>');
  assert.equal(fold(baked), fold(template), "표지 안과 기준일 말고도 틀과 다른 곳이 있다 - 출력이 틀과 다르게 나갔다");

  // 고정 데이터로 prerender.ts 가 하는 일(틀 채우기 -> 훑개)을 그대로 해 보면 출력과 같다(기준일 줄만 build-updated-stamp 가 마지막에 찍는다).
  const realestate = await fixtureRead("realestate");
  const stamp = (html) => html.replace(/<div class="updated" id="updated"[^>]*>[^<]*<\/div>/, '<div class="updated" id="updated"></div>');
  const rebuilt = stripInlineScriptComments(
    applyPrerender(template, {
      realestateOverall: realestateOverallHtml(realestate),
      realestateHead: realestateHeadHtml(),
      realestateTable: realestateTableHtml(realestate),
    })
  );
  assert.equal(stamp(baked), stamp(rebuilt), "고정 데이터로 찍은 docs/realestate.html 이 틀·데이터로 다시 찍은 결과와 다르다");
  assert.equal(REALESTATE_TEMPLATE_PATH, path.join(repo, "scripts/realestate-template.html"), "prerender.ts 가 읽는 시세 틀의 자리가 바뀌었다 - 위 틀 읽기도 같이 고친다");
});

test("[complex-ratio] 고정 분포로 찍은 노원구 페이지의 정적 카드와 자바스크립트가 그린 카드가 같은 값이다", async () => {
  const [realestate, complexRatio] = await Promise.all([fixtureRead("realestate"), fixtureRead("complex-ratio")]);
  const district = "노원구";
  const spread = complexRatio.districts[district];
  assert.ok(spread, `${district}에 분포가 없다 - 고정 데이터에서 빠졌다`);

  // 56.0처럼 정수로 떨어지는 날에도 화면은 "56.0%"를 적는다. 숫자를 그대로 붙이면 "56%"를 찾는다.
  const shown = formatPercent(spread.median).replace(".", "\\.");

  // 정적 HTML에 들어 있는 값
  const html = site.read("docs/district-nowon.html");
  assert.match(html, new RegExp(`단지별 중앙값</div><div class="value">${shown}`));

  // 자바스크립트가 붙은 뒤의 값. 다르면 화면이 한 번 튄다.
  const page = await loadRealestatePage({ realestate, complexRatio, district });
  for (let i = 0; i < 200 && !String(page.byId("overall-cards").innerHTML).includes("단지별"); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const rendered = String(page.byId("overall-cards").innerHTML);
  assert.match(rendered, new RegExp(`단지별 중앙값</div><div class="value">${shown}`));
  assert.match(rendered, new RegExp(`단지·평형 ${spread.cells.toLocaleString("ko-KR")}칸`));
});

// --- 데이터가 JSON 에 미리 만든 문장·표를 꽂는 장 ------------------------------------------------------------------------------

test("[record-high] 고정 데이터로 찍은 record-high.html 이 그 데이터의 문장과 표를 싣는다", async () => {
  const html = site.read("docs/record-high.html");
  const data = await fixtureRead("record-high");
  assert.equal(block(html, "recordRobust"), data.tables.robust.ko);
  assert.ok(block(html, "recordLead")?.includes(String(data.main.record)), "첫 문장이 고정 숫자를 싣지 않는다");
  assert.ok(data.lead.en && data.tables.robust.en);
});

test("[sample-size] 고정 데이터로 찍은 jeonse-vs-wolse 대출 금리 문장이 conversion.json 의 값·달과 같고 잔액 기준이라고 밝힌다 (#577 B1b)", async () => {
  const textOf = (html) => html.replace(/<[^>]+>/g, "");
  const { rateBasisLine } = await import("../scripts/conversion.ts");
  const [html, data] = await Promise.all([Promise.resolve(site.read("docs/jeonse-vs-wolse.html")), fixtureRead("conversion")]);
  const lead = textOf(block(html, "conversionLead") ?? "");
  // 금감원 공시 옵션별 중앙값(#183)은 끝났다 - 한국은행 평균금리 한 값이다.
  assert.ok(!lead.includes("중앙값은") && !/개 옵션 기준/.test(lead), `금감원 중앙값 문장이 남았다: ${lead}`);
  const rate = lead.match(/전세자금대출 평균금리는 (\d+(\.\d+)?)%/);
  assert.equal(Number(rate?.[1]), data.loan.rate);
  assert.equal(data.loan.basis, "balance");
  assert.match(data.loan.month, /^\d{6}$/);
  assert.equal(data.deposit.month, data.loan.month, "예금 금리가 '같은 달'이 아니다");
  assert.ok(lead.endsWith(rateBasisLine(data.loan.month, "ko")), `리드 끝에 금리 근거 줄(잔액 기준·달)이 없다: ${lead}`);
  assert.ok(lead.includes("기존 대출 잔액 기준"));
  assert.ok(data.seoul.leadEn.endsWith(rateBasisLine(data.loan.month, "en")));
  assert.equal(lead, data.seoul.leadKo, "화면 문장이 JSON의 문장과 다르다");
});

// (#520) test/sample-size.test.mjs 에서 옮겨 온 시험이다. 원래는 커밋된 docs/switch-house.html 과 커밋된 district-change.json 을 맞댔다.
test("[sample-size] 고정 데이터로 찍은 switch-house 권역 5줄 모두 '같은 칸(우리)' 값 옆에 칸 수가 있고 JSON과 같다", async () => {
  const textOf = (html) => html.replace(/<[^>]+>/g, "");
  const [html, data] = await Promise.all([Promise.resolve(site.read("docs/switch-house.html")), fixtureRead("district-change")]);
  assert.equal(data.regions.length, 5);
  const rows = [...block(html, "switchRegions").matchAll(/<tr><td>([^<]*)<\/td><td>([\s\S]*?)<\/td><td>/g)];
  assert.equal(rows.length, 5, "권역 줄이 5개가 아니다");
  for (const [i, [, name, ours]] of rows.entries()) {
    const region = data.regions[i];
    assert.equal(name, region.name.ko);
    assert.ok(Number.isInteger(region.cells) && region.cells > 0, `${name}: JSON에 칸 수가 없다`);
    assert.ok(textOf(ours).includes(`${region.cells.toLocaleString("ko-KR")}칸`), `${name}: 값 옆에 칸 수가 없다: ${ours}`);
  }
});

// --- 기준일 ------------------------------------------------------------------------------------------------------------------

test("[updated-stamp] 고정 소스로 찍은 기준일이 그 장 소스의 가장 오래된 updatedAt과 같다", () => {
  const sources = readDataSources(site.data);
  for (const [file, names] of Object.entries(PAGE_SOURCES)) {
    const html = site.read(`docs/${file}`);
    const want = baselineFor(names, sources);
    assert.match(html, new RegExp(`id="updated" data-updated="${want}">기준일 ${want}<`), `docs/${file}: 기준일이 ${want}이어야 한다 (node scripts/build-updated-stamp.ts)`);
  }
});

test("[cross-input-dates] 고정 소스로 찍은 교차값 화면 전부에 입력별 기준일 줄이 있고, 값은 소스 updatedAt의 가장 오래된 날짜다", () => {
  const sources = readDataSources(site.data);
  for (const [file, inputs] of Object.entries(CROSS_PAGES)) {
    const html = site.read(`docs/${file}`);
    const deals = baselineFor(inputs.deals, sources);
    const rates = baselineFor(inputs.rates, sources);
    const line = `<p class="updated cross-basis" id="cross-basis" data-deals="${deals}" data-rates="${rates}">실거래 ${deals.slice(5)} x 금리 ${rates.slice(5)}</p>`;
    assert.ok(html.includes(line), `docs/${file}: 기준일 줄이 ${line} 이어야 한다 (node scripts/build-updated-stamp.ts)`);
    assert.equal([...html.matchAll(/id="cross-basis"/g)].length, 1, `docs/${file}: 기준일 줄이 한 번이어야 한다`);
    assert.match(html, /<p class="updated updated-warn" id="cross-warn" role="status" hidden><\/p>/, `docs/${file}: 경고 자리`);
  }
});

// --- 이 파일이 저장소의 데이터를 안 읽는다는 것 -----------------------------------------------------------------------------

test("고정 데이터 작업 폴더의 docs/data 는 test/fixtures/site/data 와 같은 파일들이고 저장소의 docs/data 가 아니다", async () => {
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(site.data).sort(), readdirSync(path.join(import.meta.dirname, "fixtures/site/data")).sort());
  assert.notEqual(path.resolve(site.root), repo);
  // 고정 데이터의 기준 시각은 얼려 있다 - 오늘과 비교하는 시험이 아니다(#8).
  for (const name of ["news", "summary"]) assert.equal((await fixtureRead(name)).updatedAt, "2026-10-20T00:00:00.000Z");
});
