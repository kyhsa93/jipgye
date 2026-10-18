import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RATE_PAGES, buildRatePage } from "../scripts/build-rate-pages.mjs";
import { ratesHtml } from "../scripts/prerender.mjs";
import { stampHtml } from "../scripts/updated-stamp.mjs";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readRates = () => read("docs/data/rates.json").then(JSON.parse);
// 구운 조각에는 #279에서 Tailwind 유틸리티가 붙었고, 틀의 인라인 스크립트가 데이터를 받아 다시 그리는 마크업에는 붙지 않는다
// (그 스크립트를 고치는 길은 S6와 #282로 막혀 있다 - scripts/prerender.mjs의 금리 조각 주석). 이 시험은 두 쪽을 맞대므로 둘 다 받는다.
// class를 글자 그대로 적는 이유: tools/golden의 훅 class 추출기가 이 줄의 class="…"를 읽어 hook-classes.json의 markup 쪽을 만든다 -
// `[^"]*` 같은 조각으로 적으면 그 이름이 훅 목록에서 조용히 빠진다(실측).
const PRODUCT_NAME = ['class="product-name tw:whitespace-normal tw:break-keep"', 'class="product-name"'];
const productNames = (html) => [...html.matchAll(new RegExp(`(?:${PRODUCT_NAME.join("|")})>([^<]*)`, "g"))].map((m) => m[1].trim());

test("커밋된 상품군별 페이지가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, rates] = await Promise.all([read("scripts/rates-template.html"), readRates()]);

  for (const page of RATE_PAGES) {
    const built = buildRatePage(baseHtml, page, rates);
    const committed = await read(`docs/${page.file}`);
    // 틀에는 기준일이 비어 있고 날짜는 build-updated-stamp가 나중에 찍는다. 커밋본의 날짜를 같이 찍어 견준다.
    const ymd = /data-updated="(\d{4}-\d{2}-\d{2})"/.exec(committed)?.[1];
    assert.ok(ymd, `docs/${page.file}에 기준일이 없다`);
    assert.equal(
      committed,
      stampHtml(built, ymd),
      `docs/${page.file}이 원본과 어긋납니다. node scripts/build-rate-pages.mjs를 실행하세요.`
    );
  }
});

test("각 페이지가 자기 상품군을 정규 URL·제목·첫 탭으로 선언한다", async () => {
  for (const page of RATE_PAGES) {
    const html = await read(`docs/${page.file}`);
    assert.ok(html.includes(`<title>${page.title}</title>`), `${page.file} 제목이 다르다`);
    assert.ok(
      html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/jipgye/${page.file}">`),
      `${page.file} 정규 URL이 자기 자신을 가리키지 않는다`
    );
    assert.ok(
      html.includes(`<meta name="rates-category" content="${page.category}">`),
      `${page.file} 첫 탭 지정이 없다`
    );
    assert.ok(!html.includes('title: "예금·적금·대출 금리 비교"'), `${page.file} 스크립트 사전에 옛 제목이 남았다`);
  }
});

test("각 페이지의 정적 표가 그 페이지 첫 화면과 같은 상품·순서다", async () => {
  const rates = await readRates();

  for (const page of RATE_PAGES) {
    const { byId } = await loadRatesPage({ file: `docs/${page.file}` });
    const rendered = productNames(byId.get("products-body").innerHTML);
    const prerendered = productNames(ratesHtml(rates, { category: page.category }));

    assert.ok(prerendered.length > 0, `${page.file} 정적 표가 비어 있다`);
    assert.deepEqual(prerendered, rendered.slice(0, prerendered.length), `${page.file} 표가 화면과 어긋난다`);
  }
});

test("네 페이지가 서로 다른 상품을 보여준다", async () => {
  const rates = await readRates();
  const firstRows = RATE_PAGES.map((page) => productNames(ratesHtml(rates, { category: page.category }))[0]);
  assert.equal(new Set(firstRows).size, RATE_PAGES.length, `상품군별로 표가 갈리지 않는다: ${firstRows}`);
});

test("모든 금리 페이지가 서로를 진짜 링크로 가리킨다", async () => {
  const files = ["docs/rates.html", ...RATE_PAGES.map((p) => `docs/${p.file}`)];
  for (const file of files) {
    const html = await read(file);
    for (const page of RATE_PAGES) {
      assert.ok(html.includes(`href="./${page.file}"`), `${file}에 ${page.file} 링크가 없다`);
    }
  }
});

test("허브(rates.html)는 색인에서 빠지고, 상품군 페이지 넷만 남는다", async () => {
  // 예전에는 rates.html이 예금 페이지와 본문이 글자까지 같아 둘 다 색인에 두면 같은 페이지 두 장이
  // 됐다. 지금 rates.html은 링크만 있는 허브(#193)라 그 이유는 없어졌지만 noindex는 그대로 둔다.
  // 여기서는 상품군 장이 허브의 noindex를 물려받지 않는지 본다(허브 쪽 단언은 test/rate-hub.test.mjs와 겹친다).
  const base = await read("docs/rates.html");
  assert.match(base, /<meta name="robots" content="noindex, follow">/);

  for (const page of RATE_PAGES) {
    const html = await read(`docs/${page.file}`);
    assert.match(
      html,
      /<meta name="robots" content="index, follow">/,
      `docs/${page.file}이 허브의 noindex를 그대로 물려받았습니다`
    );
  }
});

// #229: savingNote가 예금자보호 한도를 낡은 값(1인당 5천만원)으로 적었다. 2025-09-01부터 금융회사별 1억원이다.
// 4장 모두(대출 2장은 화면에 안 쓰이지만 같은 스크립트 사본이다)와 틀의 한·영 문장에 새 값이 있고 옛 값이 없는지 본다.
// 문자열 존재 검사일 뿐이고 날짜·데이터 값에 따라 갈리지 않는다(#8). 법무가 확정한 문장은 이슈 #229 댓글.
test("savingNote가 예금자보호 한도를 금융회사별 1억원으로 적고 옛 값(5천만원·KRW 50M)이 없다 — 틀과 4장, 한·영", async () => {
  const sources = ["scripts/rates-template.html", ...RATE_PAGES.map((p) => `docs/${p.file}`)];
  for (const file of sources) {
    const notes = [...(await read(file)).matchAll(/savingNote: "([^"]*)"/g)].map((m) => m[1]);
    assert.equal(notes.length, 2, `${file}: savingNote가 한·영 두 줄이 아니다`);
    const [ko, en] = notes;
    assert.match(ko, /[가-힣]/, `${file}: 첫 savingNote가 한국어가 아니다`);
    for (const w of ["금융회사별", "1억원"]) assert.ok(ko.includes(w), `${file}: 한국어 savingNote에 ${w}가 없다`);
    for (const w of ["per financial institution", "KRW 100 million"]) {
      assert.ok(en.includes(w), `${file}: 영어 savingNote에 ${w}가 없다`);
    }
    for (const w of ["5천만원", "1인당"]) assert.ok(!ko.includes(w), `${file}: 한국어 savingNote에 옛 문구 ${w}`);
    for (const w of ["KRW 50M", "per-person"]) assert.ok(!en.includes(w), `${file}: 영어 savingNote에 옛 문구 ${w}`);
  }
});

// 표 위 `.rates-facts` 한·영 문단은 방문자에게 한 번도 보인 적이 없고(`[data-lang]{display:none}`이
// `.on`이 있어야 풀리는데 이 문단은 `hidden`으로만 언어를 갈랐다) 크롤러에는 읽혔기에 소스에서 지웠다(#214 Z안).
// 데이터 값에 기대지 않고 날마다 안전한 검사다. 노출을 되살리는 #232의 PR은 문단을 소스에 다시 굽는
// 같은 PR에서 이 시험을 지운다 — 그 PR이 이 시험을 지우는 것이 재도입의 신호다.
test("금리 4장과 틀에 표 위 .rates-facts 문단·데이터 블록·렌더 함수가 없다 (#214, 재개는 #232)", async () => {
  const gone = /rates-facts|rate-facts-data|RATE_FACTS|renderRateFacts|prerender:rateFacts/;
  const sources = ["scripts/rates-template.html", ...RATE_PAGES.map((p) => `docs/${p.file}`)];
  for (const file of sources) {
    const hit = gone.exec(await read(file));
    assert.equal(hit, null, `${file}: 지운 .rates-facts 문단 흔적(${hit?.[0]})이 다시 들어왔다`);
  }
});

// 금리 네 장의 CLS가 0.632~0.687이었던 원인은 "추이 격자가 한 칸으로 태어나 넉 칸으로 늘어나는 것"이었다(#287).
// 고친 방식은 빈 칸 셋을 미리 깔고 칸 높이를 style.css가 잡는 것이라, 되풀이는 두 길로만 들어온다 —
// 카드 종류가 늘어 칸 수가 모자라거나, 높이를 잡는 규칙이 사라지거나. 둘 다 여기서 막는다.
// 값(금리·날짜)에 기대지 않는 구조 검사다(#8).
test("추이 격자는 그릴 카드 수만큼 자리를 미리 깔고, 그 칸의 높이를 style.css가 잡는다 (#287)", async () => {
  const sources = ["scripts/rates-template.html", ...RATE_PAGES.map((p) => `docs/${p.file}`)];
  for (const file of sources) {
    const html = await read(file);

    const grid = /<div[^>]+id="history-grid"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/.exec(html);
    assert.ok(grid, `${file}: 추이 격자를 찾지 못했다`);
    const cells = [...grid[1].matchAll(/<div class="(?:placeholder|history-reserve)"/g)].length;

    // renderHistory()가 그리는 카드 목록. 종류가 늘면 칸도 같이 늘어야 한다.
    const list = /const cards = \[([\s\S]*?)\]\s*\n\s*\.map\(historyCardHtml\)/.exec(html);
    assert.ok(list, `${file}: renderHistory의 카드 목록을 찾지 못했다`);
    const cards = [...list[1].matchAll(/\{ label:/g)].length;

    assert.equal(cells, cards, `${file}: 추이 격자 자리 ${cells}칸 ≠ 그릴 카드 ${cards}장 — 늘어나면 아래가 밀린다`);
  }

  // 자리만 깔고 높이를 안 잡으면 빈 칸이 0px이라 같은 밀림이 돌아온다.
  // 읽는 곳은 산출물(docs/style.css)이 아니라 원문이다 - #276부터 docs/style.css는 src/css/main.css를
  // 빌드한 결과라 층 안으로 들어가며 들여쓰기가 달라지고 선택자 목록이 한 줄로 합쳐진다(정규식이 못 읽는다).
  // 원문의 규칙이 산출물에 전부·같은 순서로 남는지는 test/css-build.test.mjs와 build-css.mjs --check가 본다.
  const css = await read("src/css/legacy.css");
  for (const rule of [
    /#history-grid > \.placeholder,\s*\n\.history-reserve \{[^}]*min-height:/,
    /\.update-schedule \{[^}]*min-height:/,
    /\.content-notice\.page-notice \{[^}]*min-height:/,
  ]) {
    assert.match(css, rule, `src/css/legacy.css: 자리를 잡는 min-height 규칙이 사라졌다`);
  }
});

// #337: 영어 화면에서 금리 네 장이 `<title>` 하나("Deposit, Savings & Loan Rates")를 공유했다. 한국어는 장마다 구운 <title>이
// 고유한데 영어는 틀의 `en` 사전 한 값이라 검색 결과·탭·공유 카드·GA page_title 이 한 줄로 합쳐졌다.
// 영어 title·shareTitle·description 의 출처는 RATE_PAGES(생성 스크립트)와 구워진 사전 두 곳이라 한쪽만 고치면 갈린다 -
// 그래서 구운 장의 스크립트를 실제로 돌려 `document.title`·description meta·h1 에 들어가는 글자를 받아 RATE_PAGES 와 견준다.
// 문안은 고정 문자열이고 날짜·금리 값에 기대지 않는다(#8).
// 영어 h1 길이 상한 25자 = po 확정 h1 문안(이슈 #337 댓글 6244892406)의 최대("Installment Savings Rates"). 이 PR 이전 h1("Deposit, Savings & Loan Rates")은
// 29자였고 main 에서 375폭 1줄이었다. 영어 title(46~66자)을 h1 에도 썼더니 375폭 1→2~3줄, 768폭 1→2줄이 되어 영어 전환 CLS 가 0.04→0.18 로 늘었다
// (Chrome 측정, PR #358 판정). h1 은 title 과 키를 나눠 이 길이 안에 둔다.
const EN_H1_MAX = 25;

test("영어 화면의 title·description·h1 은 장마다 다르고, 구운 스크립트가 넣는 글자가 RATE_PAGES 와 같다 (#337)", async () => {
  const titles = new Set();
  const descriptions = new Set();
  const h1s = new Set();
  for (const page of RATE_PAGES) {
    const en = await loadRatesPage({ file: `docs/${page.file}`, locale: "en" });
    assert.equal(en.sandbox.document.title, page.titleEn, `${page.file}: 영어 document.title`);
    assert.equal(en.byId.get('meta[name="description"]').attrs.content, page.descriptionEn, `${page.file}: 영어 description`);
    assert.equal(en.byId.get("page-title").textContent, page.h1En, `${page.file}: 영어 h1`);
    assert.ok(page.h1En.length <= EN_H1_MAX, `${page.file}: 영어 h1 이 ${EN_H1_MAX}자를 넘는다(${page.h1En.length}자): ${page.h1En}`);
    assert.ok(page.h1En.length < page.titleEn.length, `${page.file}: 영어 h1 이 title 보다 짧지 않다 - 둘을 나눈 이유가 없어진다`);
    h1s.add(page.h1En);
    titles.add(en.sandbox.document.title);
    descriptions.add(en.byId.get('meta[name="description"]').attrs.content);

    // 한국어는 구운 <title>·description 과 스크립트가 넣는 글자가 이미 같다 - 영어만 갈리던 것이 이 이슈다.
    const ko = await loadRatesPage({ file: `docs/${page.file}`, locale: "ko" });
    assert.equal(ko.sandbox.document.title, page.title, `${page.file}: 한국어 document.title`);
    assert.equal(ko.byId.get('meta[name="description"]').attrs.content, page.description, `${page.file}: 한국어 description`);
    assert.equal(ko.byId.get("page-title").textContent, page.title, `${page.file}: 한국어 h1(영어 h1 키가 없어 title 로 돌아간다)`);
  }
  assert.equal(titles.size, RATE_PAGES.length, `영어 title 이 겹친다: ${[...titles]}`);
  assert.equal(descriptions.size, RATE_PAGES.length, `영어 description 이 겹친다: ${[...descriptions]}`);
  assert.equal(h1s.size, RATE_PAGES.length, `영어 h1 이 겹친다: ${[...h1s]}`);
});

test("영어 공유 카드 제목(shareTitle)은 장마다 다르고, 틀의 옛 한 줄이 4장에 남지 않는다 (#337)", async () => {
  const shareTitles = new Set();
  for (const page of RATE_PAGES) {
    const html = await read(`docs/${page.file}`);
    const shares = [...html.matchAll(/shareTitle: "([^"]*)"/g)].map((m) => m[1]);
    assert.equal(shares.length, 2, `${page.file}: shareTitle 이 한·영 두 줄이 아니다`);
    assert.equal(shares[0], page.title, `${page.file}: 한국어 shareTitle`);
    assert.equal(shares[1], page.shareTitleEn, `${page.file}: 영어 shareTitle`);
    shareTitles.add(shares[1]);
    assert.ok(!html.includes("Deposit, Savings & Loan Rates"), `${page.file}: 영어 사전에 옛 공용 제목이 남았다`);
    assert.ok(!html.includes("Daily-updated Korean bank and savings bank deposit"), `${page.file}: 영어 사전에 옛 공용 description 이 남았다`);
  }
  assert.equal(shareTitles.size, RATE_PAGES.length, `영어 공유 제목이 겹친다: ${[...shareTitles]}`);
});

test("영어 문안이 JS 문자열을 깨지 않는다 - 따옴표·역슬래시·줄바꿈·치환 기호가 없다 (#337)", () => {
  for (const page of RATE_PAGES) {
    for (const text of [page.titleEn, page.h1En, page.shareTitleEn, page.descriptionEn]) {
      assert.match(text, /^[^"\\\n$]+$/, `${page.file}: 사전 문자열에 넣을 수 없는 글자가 있다: ${text}`);
    }
  }
});
