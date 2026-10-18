import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, BUDGET_PAGE_EOK, budgetPageFile } from "./budget-pages.mjs";
import { applyPrerender, budgetBodyHtml, budgetFactsHtml, districtLinksHtml } from "./prerender.mjs";
import { clustering } from "./loan-cap.mjs";
import { lineCounts } from "./policy-loan.mjs";
import { budgetRulesHtml } from "./budget-rules.mjs";
import { bakeKoHeading } from "./page-heading.mjs";
import { createWriteSet } from "./render-writes.mjs";
import { escapeHtml } from "./html-escape.mjs";
import { stripInlineScriptComments } from "./strip-inline-comments.mjs";

const root = path.resolve(import.meta.dirname, "..");
const REALESTATE_PATH = path.join(root, "docs/realestate.html");
const METHOD_PATH = path.join(root, "docs/method.html");
const BASE_URL = "https://kyhsa93.github.io/jipgye/";

const BASE_TITLE = "서울 아파트 시세 - 25개 자치구 실거래가";
const BASE_DESCRIPTION =
  "국토교통부 실거래 신고 자료로 서울 25개 자치구의 아파트 매매·전세·월세 시세를 평당가와 84㎡ 환산가로 함께 보여줍니다. 매일 갱신합니다.";
const BASE_TITLE_KEY = 'title: "서울 아파트 시세",';
const BASE_TITLE_KEY_EN = 'title: "Seoul Apartment Prices",';

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

export function buildBudgetPage(baseHtml, page, budget, rates = null, mortgageSeries = null, complexFiles = null, capStats = null, policyCounts = null) {
  const band = (budget?.bands ?? []).find((b) => b.min10k === page.min10k) ?? null;
  const body = budgetBodyHtml(band, budget?.periods, rates, mortgageSeries, complexFiles, capStats, policyCounts);
  if (!body) return null;

  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);
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

  html = replaceOnce(
    html,
    '<section id="budget-section" hidden>',
    '<section id="budget-section">',
    "예산 섹션"
  );

  html = replaceOnce(
    html,
    '<div class="content-notice" id="budget-note"></div>',
    `<div class="content-notice" id="budget-note">${escapeHtml(budgetNoteKo(baseHtml))}</div>`,
    "매물 아님 안내"
  );

  // 예산 장의 본문(그 예산대 거래·후보·자금)을 서울 평균 카드와 추이 그래프보다 앞에 둔다. 모바일에서
  // 예산 본문이 1,702px 아래에서 시작했다(PO 검토 #33) - 이 장을 연 사람이 찾는 것은 서울 평균이 아니다.
  {
    const start = html.indexOf('<section id="budget-section">');
    const end = html.indexOf("</section>", start) + "</section>".length;
    const anchor = html.indexOf('<section id="overall-section">');
    if (start < 0 || anchor < 0 || anchor > start) throw new Error("예산 섹션을 앞으로 옮길 자리를 찾지 못했습니다");
    const block = html.slice(start, end);
    html = html.slice(0, start) + html.slice(end);
    html = html.slice(0, anchor) + block + "\n\n  " + html.slice(anchor);
  }

  html = replaceOnce(
    html,
    '<h2 id="budget-heading">예산으로 찾기</h2>',
    `<h2 id="budget-heading">예산으로 찾기</h2>\n    ${chipsHtml(page)}`,
    "예산 섹션 제목"
  );

  // 스물다섯 줄짜리 자치구 시세표는 여기 있을 것이 아니다.
  //
  // 이 표는 realestate.html이 원본인데 예산 페이지 열여덟 장에 그대로 복사돼 나갔다.
  // 페이지 본문의 절반이 옆 페이지와 글자까지 같아지는 가장 큰 원인이었고, "10억대로
  // 뭘 살 수 있나"에 답하지도 않는다. 표는 접고 자치구 링크만 남긴다 — 링크가 있어야
  // 자치구 페이지로 가는 길이 끊기지 않는다.
  html = replaceOnce(
    html,
    '<section id="district-section">',
    '<section id="district-section" hidden>',
    "자치구 시세 섹션"
  );

  // 문자열 패치(replaceOnce)가 전부 끝난 뒤에, 나가는 장의 인라인 스크립트에서 주석만 뗀다(#313). 틀에는 주석이 그대로 있다.
  return stripInlineScriptComments(applyPrerender(html, {
    budgetResult: body,
    budgetFactsKo: budgetFactsHtml(band, "ko"),
    budgetFactsEn: budgetFactsHtml(band, "en"),
    budgetPageNav: navHtml(page),
    // 섹션을 접는 것만으로는 부족하다. hidden은 눈에만 안 보일 뿐 스물다섯 줄이
    // HTML에는 그대로 실려 나가고, 중복을 재면 접기 전과 같은 값이 나온다.
    realestateHead: "",
    realestateTable: "",
    districtLinks: districtLinksHtml(null, "자치구별 시세 보기"),
  }));
}

/**
 * 렌더 시각. BUILD_NOW(ISO 8601)가 있으면 그 시각, 없으면 Date.now() — 미설정이면 전과 똑같이 돈다.
 * 이 파일이 렌더 단계 여섯 중 Date.now()를 부르는 유일한 곳이라(정책대출 `since`), 같은 입력으로 두 번 렌더해
 * 견주는 도구(tools/golden, #236)가 시각을 고정할 자리가 여기 하나다. 읽을 수 없는 값은 조용히 현재 시각으로
 * 넘기지 않고 멈춘다 — 고정했다고 믿은 렌더가 오늘 값으로 나가는 것이 더 나쁘다.
 */
export function buildNowMs(env = process.env) {
  if (!env.BUILD_NOW) return Date.now();
  const t = Date.parse(env.BUILD_NOW);
  if (Number.isNaN(t)) throw new Error(`BUILD_NOW를 읽을 수 없습니다: ${env.BUILD_NOW}`);
  return t;
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
  const budget = await readJson(path.join(root, "docs/data/budget-deals.json"));
  // 금리가 아직 없는 날에도 예산 페이지는 나와야 한다. 월 상환액 문단만 빠진다.
  const rates = await readJson(path.join(root, "docs/data/rates.json"));
  // 1년 사이 상환액 변화에 쓰는 한국은행 주담대 평균 금리(지표 수집이 받는 계열). 없으면 그 문장만 빠진다.
  const mortgageSeries = (await readJson(path.join(root, "raw/indicators/series.json")))?.series?.mortgage_rate ?? null;
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


  // 예산대 장과 method.html이 전부 렌더에 성공한 뒤에 쓴다(#237) - 중간에서 던지면 어느 파일도 바뀌지 않는다.
  const writes = createWriteSet();
  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const page of BUDGET_PAGES) {
    const html = buildBudgetPage(baseHtml, page, budget, rates, mortgageSeries, complexFiles, capStats, policyCounts);
    if (!html) {
      skipped.push(`${page.eok}억대`);
      continue;
    }

    const target = path.join(root, "docs", page.file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) continue;
    writes.stage(target, html);
    if (before === null) created += 1;
    else updated += 1;
  }

  // 장마다 똑같던 규칙 문단이 옮겨 간 자리(#66). 장과 같은 입력(금리·정책대출 거래 수)에서 같은 빌드에 굽는다.
  const method = await readFile(METHOD_PATH, "utf8");
  const methodNext = applyPrerender(method, {
    budgetRules: budgetRulesHtml({ rates, mortgageSeries, policyCounts }),
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
