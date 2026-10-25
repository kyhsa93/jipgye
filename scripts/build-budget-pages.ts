import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, BUDGET_PAGE_EOK, budgetDescription, budgetPageFile } from "./budget-pages.ts";
import { areaLine, areasShape, budgetLeadText, districtOrder } from "./budget-fragments.ts";
import { withYearOn } from "./budget-facts.ts";
import { candidatesInBand } from "./complex-price.ts";
import { REALESTATE_TEMPLATE_PATH, applyPrerender, budgetBodyHtml, budgetFactsHtml, districtLinksHtml, realestateOverallHtml } from "./prerender.ts";
import { clustering } from "./loan-cap.ts";
import { latestRate } from "./mortgage.ts";
import { lineCounts } from "./policy-loan.ts";
import { budgetRulesHtml } from "./budget-rules.ts";
import { bakeKoHeading } from "./page-heading.ts";
import { createWriteSet } from "./render-writes.ts";
import { escapeHtml } from "./html-escape.ts";
import { stripInlineScriptComments } from "./strip-inline-comments.ts";
import { requireSite, sitePath } from "./site-dir.ts";
import { collectionNow } from "./collection-now.ts";

const root = path.resolve(import.meta.dirname, "..");
const REALESTATE_PATH = REALESTATE_TEMPLATE_PATH; // 빈 표지가 있는 틀(scripts/realestate-template.html). 나가는 docs/realestate.html 이 아니다(#374).
const BASE_URL = "https://kyhsa93.github.io/jipgye/";

const BASE_TITLE = "서울 아파트 시세, 자치구별로 얼마인가 - 25개 자치구 실거래가";
const BASE_DESCRIPTION =
  "국토교통부 실거래 신고 자료로 서울 25개 자치구의 아파트 매매·전세·월세 시세를 평당가와 84㎡ 환산가로 함께 보여줍니다. 매일 갱신합니다.";
const BASE_TITLE_KEY = 'title: "서울 아파트 시세",';
const BASE_TITLE_KEY_EN = 'title: "Seoul Apartment Prices",';

// 틀의 예산 섹션 제목. 장에서는 본문 칸으로 옮겨 가므로(buildBudgetPage) 틀 자리에서 떼는 글자와 본문에 넣는 글자가 같은 상수 하나다.
const DISTRICT_LINKS_HEADING = "자치구별 시세 보기 (이 예산대 거래가 많은 구부터)";
const BUDGET_HEADING_HTML = '<h2 id="budget-heading">예산으로 찾기</h2>';

function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

/**
 * 예산 칩 줄 - 열여덟 장 어디서든 다른 예산대로 한 번에 간다(UIUX #43). 전에는 맨 아래 이웃 두 링크뿐이라
 * 10억 → 7억이 세 장을 거쳤다. 가로 스크롤 없이 격자로 둔다(질문 입구와 같은 원칙).
 */
export function chipsHtml(page) {
  return (
    `<nav class="budget-chips" aria-label="예산대">` +
    BUDGET_PAGE_EOK.map((eok) =>
      eok === page.eok
        ? `<a href="./${budgetPageFile(eok)}" aria-current="page">${eok}억</a>`
        : `<a href="./${budgetPageFile(eok)}">${eok}억</a>`
    ).join("") +
    `</nav>`
  );
}

/**
 * "국토교통부에 신고된 실거래 기록이지 매물이 아니다" 안내(#budget-note)를 굽는다(#297, po 판정).
 *
 * 전에는 화면 스크립트만 넣었다. 그래서 realestate.json을 못 받으면 renderBudget이 돌지 않아, 구운 거래
 * 목록이 이 안내 없이 그대로 보였다(헤드리스 Chrome 확인: realestate.json 503일 때 #budget-note가 빈 칸).
 * 목록과 늘 같이 있어야 하는 안내라 빌드가 굽는다 - 받는 중·실패·스크립트를 끈 화면이 한 번에 풀린다.
 *
 * 글자는 **틀의 한국어 사전에서 그대로 떠 온다**. 같은 문장을 두 군데 적으면 갈라진다(체크리스트 10) -
 * 사전이 하나뿐인 원본이고, 여기는 그 값을 옮길 뿐이라 드리프트가 생길 자리가 없다. 영어 화면은 스크립트가
 * 첫 실행에서 영어 문장으로 바꾼다(cmo 판정 6147877878: 영어 문장은 같이 굽지 않는다 - 한 장에 두 언어가
 * 구워지면 수집기가 받는 언어 신호가 흐려진다).
 */
export function budgetNoteKo(baseHtml) {
  const koStart = baseHtml.indexOf("  ko: {");
  const enStart = baseHtml.indexOf("  en: {");
  const m = baseHtml.match(/\n\s*budgetNote:\s*\n\s*"((?:[^"\\]|\\.)*)",/);
  if (koStart < 0 || enStart < 0 || !m || m.index < koStart || m.index > enStart) {
    throw new Error("한국어 사전의 budgetNote 문장을 찾지 못했습니다");
  }
  return JSON.parse(`"${m[1]}"`);
}

function navHtml(page) {
  const links = [];
  if (BUDGET_PAGE_EOK.includes(page.eok - 1)) {
    links.push(`<a href="./${budgetPageFile(page.eok - 1)}">${page.eok - 1}억대</a>`);
  }
  if (BUDGET_PAGE_EOK.includes(page.eok + 1)) {
    links.push(`<a href="./${budgetPageFile(page.eok + 1)}">${page.eok + 1}억대</a>`);
  }
  links.push(`<a href="./deal-search.html?budget=${page.eok}">조건을 더해 찾기</a>`);
  return links.join("");
}

export function buildBudgetPage(baseHtml, page, budget, loanBasis = null, mortgageSeries = null, complexFiles = null, capStats = null, policyCounts = null, realestate = null) {
  const band = (budget?.bands ?? []).find((b) => b.min10k === page.min10k) ?? null;
  // 제목과 칩 줄은 본문 칸 안, 어디로 가는가 문장 뒤 후보 앞에 놓인다(#460) - 틀의 제목 자리는 비우고 본문이 들고 간다.
  // 단지 후보가 많은 구마다 한 줄(동·연식·평형, V12 #658) - 18장이 같은 틀 문장을 싣던 자리에 그 예산대의 데이터를 놓는다.
  const areaLines = areasShape(band, complexFiles).map(areaLine);
  const body = budgetBodyHtml(band, budget?.periods, loanBasis, mortgageSeries, complexFiles, capStats, policyCounts, `${BUDGET_HEADING_HTML}${chipsHtml(page)}`, areaLines);
  if (!body) return null;

  let html = baseHtml;

  // description 은 그 예산대의 답(후보가 많은 구·후보 수·거래 수)으로 굽는다(V12 #658). 값이 없으면 고정 문장.
  const description = budgetDescription(page, {
    deals: band?.count ?? 0,
    candidates: band && complexFiles?.length ? candidatesInBand(complexFiles, band.min10k, band.max10k ?? band.min10k + 10_000).length : 0,
    places: areasShape(band, complexFiles).slice(0, 3).map((a) => a.district),
  });
  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, description);
  html = html.replaceAll(`${BASE_URL}realestate.html`, `${BASE_URL}${page.file}`);
  html = replaceOnce(html, BASE_TITLE_KEY, `title: ${JSON.stringify(page.title)},`, "한국어 제목 사전");
  html = replaceOnce(html, BASE_TITLE_KEY_EN, `title: ${JSON.stringify(page.titleEn)},`, "영어 제목 사전");

  // 장 제목(h1)을 굽는다(#295). 사전 패치 뒤라 `title`은 이미 이 장의 제목이고, 화면 스크립트가 넣던 글자와 같다.
  html = bakeKoHeading(html);

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="budget-band" content="${page.min10k}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  // 틀의 구획 여는 태그는 구획 아래 여백 유틸리티 class 를 가진다(#283). 아래 needle 셋은 그 글자를 그대로 쓰므로 틀의 class 를 바꾸면 여기와
  // test/realestate-shell.test.mjs 를 같이 고친다.
  html = replaceOnce(
    html,
    '<section id="budget-section" class="tw:mb-10 tw:1024:mb-16" hidden>',
    '<section id="budget-section" class="tw:mb-10 tw:1024:mb-16">',
    "예산 섹션"
  );

  // 맨 위 안내의 한국어 문장: 시세 틀의 자치구 4주 평균 이야기 대신 이 예산대가 가는 곳(V12 #658). 구운 글자와 한국어 사전(화면 스크립트가 다시 쓰는 값)을
  // 같이 바꾼다 - 하나만 바꾸면 스크립트가 틀 문장으로 되돌린다. 영어 사전은 그대로다. 후보가 없으면 틀 문장 그대로.
  const lead = budgetLeadText(band, complexFiles);
  if (lead) {
    const baked = /<p id="method-callout-text" class="tw:text-fg">([^<]*)<\/p>/.exec(html)?.[1];
    if (!baked) throw new Error("맨 위 안내 문장을 찾지 못했습니다");
    html = replaceOnce(html, `<p id="method-callout-text" class="tw:text-fg">${baked}</p>`, `<p id="method-callout-text" class="tw:text-fg">${escapeHtml(lead)}</p>`, "맨 위 안내");
    html = replaceOnce(html, `methodCalloutText:\n      ${JSON.stringify(baked)},`, `methodCalloutText:\n      ${JSON.stringify(lead)},`, "한국어 안내 사전");
  }

  // 자치구 링크 머리글: 화면 스크립트가 한국어 사전의 otherDistricts 로 다시 쓰므로 사전도 같은 글자로(전에는 구운 「자치구별 시세 보기」가 「다른 지역」으로 바뀌었다).
  html = replaceOnce(html, 'otherDistricts: "다른 지역",', `otherDistricts: ${JSON.stringify(DISTRICT_LINKS_HEADING)},`, "한국어 자치구 링크 머리글 사전");

  html = replaceOnce(
    html,
    '<div class="content-notice" id="budget-note"></div>',
    `<div class="content-notice" id="budget-note">${escapeHtml(budgetNoteKo(baseHtml))}</div>`,
    "매물 아님 안내"
  );

  // 예산 장의 본문(그 예산대 거래·후보·자금)을 서울 평균 카드와 추이 그래프보다 앞에 둔다. 모바일에서
  // 예산 본문이 1,702px 아래에서 시작했다(PO 검토 #33) - 이 장을 연 사람이 찾는 것은 서울 평균이 아니다.
  {
    const start = html.indexOf('<section id="budget-section" class="tw:mb-10 tw:1024:mb-16">');
    const end = html.indexOf("</section>", start) + "</section>".length;
    const anchor = html.indexOf('<section id="overall-section"');
    if (start < 0 || anchor < 0 || anchor > start) throw new Error("예산 섹션을 앞으로 옮길 자리를 찾지 못했습니다");
    const block = html.slice(start, end);
    html = html.slice(0, start) + html.slice(end);
    html = html.slice(0, anchor) + block + "\n\n  " + html.slice(anchor);
  }

  html = replaceOnce(html, `${BUDGET_HEADING_HTML}\n    `, "", "예산 섹션 제목");

  // 스물다섯 줄짜리 자치구 시세표는 여기 있을 것이 아니다.
  //
  // 이 표는 realestate.html이 원본인데 예산 페이지 열여덟 장에 그대로 복사돼 나갔다.
  // 페이지 본문의 절반이 옆 페이지와 글자까지 같아지는 가장 큰 원인이었고, "10억대로
  // 뭘 살 수 있나"에 답하지도 않는다. 표는 접고 자치구 링크만 남긴다 — 링크가 있어야
  // 자치구 페이지로 가는 길이 끊기지 않는다.
  html = replaceOnce(
    html,
    '<section id="district-section" class="tw:mb-10 tw:1024:mb-16">',
    '<section id="district-section" class="tw:mb-10 tw:1024:mb-16" hidden>',
    "자치구 시세 섹션"
  );

  // 출처 줄: 시세 틀의 줄(국토부) 대신 ECOS 를 더한 예산대 줄(scripts/source-lines.ts FOOTERS.budget). 한국어 둘·영어 하나 - applyPrerender 가 꽂는다(#588).
  const sourceMarks = html.split("{{src:realestate.").length - 1;
  if (sourceMarks !== 3) throw new Error(`출처 줄 자리표시({{src:realestate.…}})가 3개가 아니라 ${sourceMarks}개입니다`);
  html = html.replaceAll("{{src:realestate.", "{{src:budget.");

  // 문자열 패치(replaceOnce)가 전부 끝난 뒤에, 나가는 장의 인라인 스크립트에서 주석만 뗀다(#313). 틀에는 주석이 그대로 있다.
  return stripInlineScriptComments(applyPrerender(html, {
    budgetResult: body,
    // 서울 전체 평균 카드. 틀의 표지가 비어 있어(#374) 여기서 채운다 - 전에는 prerender.ts 가 제자리에서 채운 장을 틀로 읽어 그대로 물려받았다.
    // 시세 장(docs/realestate.html)과 같은 호출(realestateOverallHtml(realestate))이라 글자까지 같다. 데이터가 없으면 null 이라 비운 채로 둔다.
    realestateOverall: realestateOverallHtml(realestate),
    // 사실 문단 끝에 같은 칸 1년 비교(#692) - 단지 가격 범위 파일에서 빌드 때 센다. 런타임 JS 는 늘지 않는다.
    budgetFactsKo: budgetFactsHtml(withYearOn(band, complexFiles), "ko"),
    budgetFactsEn: budgetFactsHtml(withYearOn(band, complexFiles), "en"),
    budgetPageNav: navHtml(page),
    // 섹션을 접는 것만으로는 부족하다. hidden은 눈에만 안 보일 뿐 스물다섯 줄이
    // HTML에는 그대로 실려 나가고, 중복을 재면 접기 전과 같은 값이 나온다.
    realestateHead: "",
    realestateTable: "",
    // 이 예산대 거래가 많은 구부터(V12 #658). 25개 이름이 18장에서 같은 순서로 실리던 자리다. 머리글은 위에서 사전 값과 같이 바꿨다.
    districtLinks: districtLinksHtml(null, DISTRICT_LINKS_HEADING, districtOrder(band)),
  }));
}

/**
 * 렌더 시각. BUILD_NOW(시간대를 가진 ISO 8601)가 있으면 그 시각, 없으면 Date.now() — 미설정이면 전과 똑같이 돈다.
 * 이 파일이 렌더 단계 다섯 중 Date.now()를 부르는 유일한 곳이라(정책대출 `since`), 같은 입력으로 두 번 렌더해
 * 견주는 도구(tools/golden, #236)가 시각을 고정할 자리가 여기 하나다. 읽을 수 없는 값은 조용히 현재 시각으로
 * 넘기지 않고 멈춘다 — 고정했다고 믿은 렌더가 오늘 값으로 나가는 것이 더 나쁘다.
 * 파서는 수집 스크립트 시계 변수와 같은 하나다(`collectionNow`, #248 f) — 시간대 없는 값·날짜만·달력에 없는 날도 멈춘다.
 * deploy.yml 이 넣는 `git log -1 --format=%cI`(오프셋을 가진 ISO)와 골든의 `…Z` 값은 그대로 읽힌다.
 */
export function buildNowMs(env = process.env) {
  // 미설정은 `Date.now()` 그대로다 - `collectionNow` 의 `new Date()` 는 Date.now 모킹(tools/golden/lib/mock-date-now.ts, 시험)을 안 따른다.
  return env.BUILD_NOW ? collectionNow("BUILD_NOW", env).getTime() : Date.now();
}

async function readCapDeals() {
  const dir = path.join(root, "raw/sale");
  const names = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"));
  const deals = [];
  for (const name of names) {
    const file = await readJson(path.join(dir, name));
    for (const item of file?.items ?? []) {
      if (String(item?.cdealType ?? "").trim()) continue;
      const amount = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
      if (!(amount > 0) || !item.dealYear) continue;
      const date = `${item.dealYear}-${String(item.dealMonth).padStart(2, "0")}-${String(item.dealDay).padStart(2, "0")}`;
      deals.push({ date, amount, area: Number(item.excluUseAr), direct: String(item?.dealingGbn ?? "").trim() === "직거래" });
    }
  }
  return deals;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  requireSite(); // 출력 디렉터리가 docs/ 가 아니면 docs/ 복사본이 먼저 있어야 한다(#508)
  const METHOD_PATH = sitePath("method.html");
  const budget = await readJson(path.join(root, "docs/data/budget-deals.json"));
  // 월 상환액과 1년 사이 변화에 쓰는 한국은행 ECOS 주담대 신규취급 평균금리(지표 수집이 받는 계열 121Y006). 전에는 월 상환액이
  // 금감원 공시 금리 파일의 상품 최저금리였다 - FSS 자료를 빼면서 이 계열 하나로 바꿨다(#577).
  // 계열이 없는 날에도 예산 페이지는 나와야 한다. 월 상환액 문단과 한눈에 금리 줄만 빠진다.
  const mortgageSeries = (await readJson(path.join(root, "raw/indicators/series.json")))?.series?.mortgage_rate ?? null;
  const loanBasis = latestRate(mortgageSeries);
  // 단지 후보는 단지 가격 범위(build-complex-price)의 자치구 파일들에서 고른다. 없으면 그 절만 빠진다.
  const dataDir = path.join(root, "docs/data");
  const complexFiles = (
    await Promise.all(
      (await readdir(dataDir)).filter((f) => /^complex-price-[a-z]+\.json$/.test(f)).sort().map((f) => readJson(path.join(dataDir, f)))
    )
  ).filter(Boolean);
  // 15억 경계 몰림은 원본 전체(해제 제외, 직거래 포함)에서 매일 다시 센다.
  const capDeals = await readCapDeals();
  const capStats = clustering(capDeals);
  // 정책대출 가격선 아래 거래 수: 최근 6개월, 해제·직거래 제외. 가격선은 시세에 긋는 선이라, 가족 간 거래처럼
  // 시세가 아닐 수 있는 직거래는 뺀다(단지 카드·후보와 같은 규칙, PO 2차 #41).
  const since = new Date(buildNowMs() - 183 * 86400000).toISOString().slice(0, 10);
  const policyCounts = lineCounts(capDeals.filter((d) => d.date >= since && !d.direct));
  if (!budget?.bands?.length) {
    console.log("  예산 데이터가 없습니다 - 예산 페이지를 만들지 않습니다");
    return;
  }

  const baseHtml = await readFile(REALESTATE_PATH, "utf8");
  const realestate = await readJson(path.join(root, "docs/data/realestate.json"));


  // 예산대 장과 method.html이 전부 렌더에 성공한 뒤에 쓴다(#237) - 중간에서 던지면 어느 파일도 바뀌지 않는다.
  const writes = createWriteSet();
  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const page of BUDGET_PAGES) {
    const html = buildBudgetPage(baseHtml, page, budget, loanBasis, mortgageSeries, complexFiles, capStats, policyCounts, realestate);
    if (!html) {
      skipped.push(`${page.eok}억대`);
      continue;
    }

    const target = sitePath(page.file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) continue;
    writes.stage(target, html);
    if (before === null) created += 1;
    else updated += 1;
  }

  // 장마다 똑같던 규칙 문단이 옮겨 간 자리(#66). 장과 같은 입력(금리·정책대출 거래 수)에서 같은 빌드에 굽는다.
  const method = await readFile(METHOD_PATH, "utf8");
  const methodNext = applyPrerender(method, {
    budgetRules: budgetRulesHtml({ mortgageSeries, policyCounts }),
  });
  if (methodNext !== method) writes.stage(METHOD_PATH, methodNext);
  writes.commit();

  console.log(`  예산 페이지 (생성 ${created} · 갱신 ${updated})${skipped.length ? ` · 거래 없어 건너뜀: ${skipped.join(", ")}` : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`예산 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
