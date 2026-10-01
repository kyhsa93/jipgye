import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, BUDGET_PAGE_EOK, budgetPageFile } from "./budget-pages.mjs";
import { applyPrerender, budgetBodyHtml, budgetFactsHtml, districtLinksHtml } from "./prerender.mjs";
import { clustering } from "./loan-cap.mjs";
import { lineCounts } from "./policy-loan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const REALESTATE_PATH = path.join(root, "docs/realestate.html");
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

  return applyPrerender(html, {
    budgetResult: body,
    budgetFactsKo: budgetFactsHtml(band, "ko"),
    budgetFactsEn: budgetFactsHtml(band, "en"),
    budgetPageNav: navHtml(page),
    // 섹션을 접는 것만으로는 부족하다. hidden은 눈에만 안 보일 뿐 스물다섯 줄이
    // HTML에는 그대로 실려 나가고, 중복을 재면 접기 전과 같은 값이 나온다.
    realestateHead: "",
    realestateTable: "",
    districtLinks: districtLinksHtml(null, "자치구별 시세 보기"),
  });
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
      deals.push({ date, amount, area: Number(item.excluUseAr) });
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
  // 정책대출 가격선 아래 거래 수: 최근 6개월, 해제 제외.
  const since = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
  const policyCounts = lineCounts(capDeals.filter((d) => d.date >= since));
  if (!budget?.bands?.length) {
    console.log("  예산 데이터가 없습니다 - 예산 페이지를 만들지 않습니다");
    return;
  }

  const baseHtml = await readFile(REALESTATE_PATH, "utf8");


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
    await writeFile(target, html);
    if (before === null) created += 1;
    else updated += 1;
  }

  console.log(`  예산 페이지 (생성 ${created} · 갱신 ${updated})${skipped.length ? ` · 거래 없어 건너뜀: ${skipped.join(", ")}` : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`예산 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
