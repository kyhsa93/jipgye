import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "./district-slugs.mjs";
import { BUDGET_PAGE_EOK, budgetPageFile } from "./budget-pages.mjs";
import { areaPrice } from "./realestate-format.mjs";
import { dealFileName } from "./deal-files.mjs";
import { districtFacts } from "./district-facts.mjs";
import {
  applyPrerender,
  districtFactsHtml,
  districtRenewalHtml,
  districtLinksHtml,
  districtSummaryHtml,
  realestateHeadHtml,
  realestateOverallHtml,
  realestateTableHtml,
} from "./prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE_PATH = path.join(root, "docs/realestate.html");
const BASE_URL = "https://kyhsa93.github.io/jipgye/";

const BASE_TITLE = "서울 아파트 시세 - 25개 자치구 실거래가";
const BASE_DESCRIPTION =
  "국토교통부 실거래 신고 자료로 서울 25개 자치구의 아파트 매매·전세·월세 시세를 평당가와 84㎡ 환산가로 함께 보여줍니다. 매일 갱신합니다.";

const BASE_TITLE_KEY = 'title: "서울 아파트 시세",';
const BASE_TITLE_KEY_EN = 'title: "Seoul Apartment Prices",';

export const REALESTATE_PAGES = [
  {
    kind: "sale",
    file: "apartment-sale.html",
    title: "서울 아파트 매매 시세 - 자치구별 평당가·84㎡ 환산",
    description:
      "서울 25개 자치구 아파트 매매 실거래가를 평당가와 84㎡ 환산가로 비교합니다. 국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적은 지역은 평균을 내지 않습니다.",
    titleEn: "Seoul Apartment Sale Prices by District",
  },
  {
    kind: "jeonse",
    file: "apartment-jeonse.html",
    title: "서울 아파트 전세 시세 - 자치구별 평당 보증금·84㎡ 환산",
    description:
      "서울 25개 자치구 아파트 전세 실거래 보증금을 평당가와 84㎡ 환산가로 비교합니다. 국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적은 지역은 평균을 내지 않습니다.",
    titleEn: "Seoul Apartment Jeonse Prices by District",
  },
  {
    kind: "wolse",
    file: "apartment-rent.html",
    title: "서울 아파트 월세 시세 - 자치구별 보증금·월세",
    description:
      "서울 25개 자치구 아파트 월세 실거래 보증금과 월세를 비교합니다. 국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적은 지역은 평균을 내지 않습니다.",
    titleEn: "Seoul Apartment Monthly Rent by District",
  },
];

function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

export function buildRealestatePage(baseHtml, page, realestate, spread = null) {
  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);
  html = html.replaceAll(`${BASE_URL}realestate.html`, `${BASE_URL}${page.file}`);

  html = replaceOnce(html, BASE_TITLE_KEY, `title: ${JSON.stringify(page.title)},`, "한국어 제목 사전");
  html = replaceOnce(html, BASE_TITLE_KEY_EN, `title: ${JSON.stringify(page.titleEn)},`, "영어 제목 사전");

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="realestate-kind" content="${page.kind}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  html = replaceOnce(
    html,
    '<a href="./realestate.html" data-re-page="all" aria-current="page">',
    '<a href="./realestate.html" data-re-page="all">',
    "시세 전체 링크"
  );

  html = replaceOnce(
    html,
    `<a href="./${page.file}" data-re-page="${page.kind}">`,
    `<a href="./${page.file}" data-re-page="${page.kind}" aria-current="page">`,
    "거래 유형 링크"
  );

  if (page.kind !== "sale") {
    html = replaceOnce(
      html,
      '<a href="./deal-search.html" data-re-page="search">',
      `<a href="./deal-search.html?kind=${page.kind}" data-re-page="search">`,
      "거래내역 검색 링크"
    );
  }

  return applyPrerender(html, {
    realestateOverall: realestateOverallHtml(realestate, page.kind, null, spread),
    realestateHead: realestateHeadHtml(page.kind),
    realestateTable: realestateTableHtml(realestate, page.kind),
    districtLinks: "",
    districtSummaryKo: "",
    districtSummaryEn: "",
    districtFactsKo: "",
    districtFactsEn: "",
    districtRenewalKo: "",
    districtRenewalEn: "",
  });
}

/**
 * 자치구 장의 "이 구에서" 길 - 이 구의 단지(실거래 검색), 이 구 84㎡ 환산이 들어가는 예산대, 재계약·갈아타기.
 * 전에는 이 장의 본문 링크가 다른 자치구 25개와 방법 링크뿐이었다(UIUX #45). 예산대는 3~20억대 장만 있어
 * 그 밖이면 끝 장으로 보낸다. 환산가가 없으면 그 링크만 뺀다.
 */
export function districtHereHtml(name, realestate) {
  const sale = realestate?.districts?.find((d) => d.name === name)?.sale;
  const price84 = sale ? areaPrice(sale.avgPricePerPyeong10k) : null;
  const eok = price84 ? Math.min(BUDGET_PAGE_EOK.at(-1), Math.max(BUDGET_PAGE_EOK[0], Math.floor(price84 / 10_000))) : null;
  const links = [
    [`./deal-search.html?district=${encodeURIComponent(name)}`, `${name} 실거래·단지 찾기`],
    eok ? [`./${budgetPageFile(eok)}`, `${name} 84㎡ 값에 맞는 ${eok}억대 후보`] : null,
    ["./renewal-vs-new.html", "재계약이 시세보다 싼가(구별 표)"],
    [`./switch-house.html?from=${encodeURIComponent(name)}`, `${name}에서 옮기면 — 갈아타기`],
  ].filter(Boolean);
  return `<p class="card-links district-here">${links.map(([href, text]) => `<a href="${href}">${text} →</a>`).join(" · ")}</p>`;
}

export function buildDistrictPage(baseHtml, district, realestate, deals = null, renewal = null, spread = null) {
  const title = `${district.name} 아파트 시세 - 매매·전세·월세 실거래가`;
  const description =
    `${district.name} 아파트 매매·전세·월세 실거래가를 평당가와 84㎡ 환산가로 보여줍니다. ` +
    "국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적으면 지난달 기준으로 표시합니다.";
  const titleEn = `${district.name} Apartment Prices - Sale, Jeonse & Rent`;

  let html = baseHtml;
  html = html.replaceAll(BASE_TITLE, title);
  html = html.replaceAll(BASE_DESCRIPTION, description);
  html = html.replaceAll(`${BASE_URL}realestate.html`, `${BASE_URL}${district.file}`);

  html = replaceOnce(html, BASE_TITLE_KEY, `title: ${JSON.stringify(title)},`, "한국어 제목 사전");
  html = replaceOnce(html, BASE_TITLE_KEY_EN, `title: ${JSON.stringify(titleEn)},`, "영어 제목 사전");
  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="realestate-district" content="${district.name}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );
  html = replaceOnce(
    html,
    '<!--/prerender:districtRenewalEn--></p>\n  </section>',
    `<!--/prerender:districtRenewalEn--></p>\n    ${districtHereHtml(district.name, realestate)}\n  </section>`,
    "자치구 요약 절 끝"
  );
  // 시세 템플릿의 제목은 서울 전체를 말한다. 자치구 장은 그 구의 숫자를 싣는다(UIUX #42).
  html = replaceOnce(html, '<h2 id="overall-heading">서울 전체 평균</h2>', `<h2 id="overall-heading">${district.name} 평균</h2>`, "평균 제목");
  html = replaceOnce(html, '<h2 id="district-heading">자치구별 시세</h2>', '<h2 id="district-heading">거래 유형별</h2>', "표 제목");

  html = replaceOnce(
    html,
    '<a href="./realestate.html" data-re-page="all" aria-current="page">',
    '<a href="./realestate.html" data-re-page="all">',
    "시세 전체 링크"
  );

  return applyPrerender(html, {
    realestateOverall: realestateOverallHtml(realestate, null, district.name, spread),
    realestateHead: realestateHeadHtml(null, district.name),
    realestateTable: realestateTableHtml(realestate, null, district.name),
    districtLinks: districtLinksHtml(district.name),
    districtSummaryKo: districtSummaryHtml(realestate, district.name, "ko", spread),
    districtSummaryEn: districtSummaryHtml(realestate, district.name, "en", spread),
    // 시세 문장은 realestate.json 하나로 스물다섯 구가 같은 틀을 쓴다. 이쪽은 그 구의
    // 전수 거래 파일을 따로 읽어, 그 구에서만 눈에 띄는 것을 말한다.
    districtFactsKo: districtFactsHtml(districtFacts(deals), "ko"),
    districtFactsEn: districtFactsHtml(districtFacts(deals), "en"),
    districtRenewalKo: districtRenewalHtml(renewal, "ko"),
    districtRenewalEn: districtRenewalHtml(renewal, "en"),
  });
}

async function main() {
  const [baseHtml, realestate, renewalFacts, complexRatio] = await Promise.all([
    readFile(SOURCE_PATH, "utf8"),
    readFile(path.join(root, "docs/data/realestate.json"), "utf8").then(JSON.parse),
    // 재계약 관찰은 없을 수 있다 - 그러면 그 문단만 비고 나머지는 그대로 나간다.
    readFile(path.join(root, "docs/data/renewal-facts.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null),
    // 단지별 전세가율 분포도 마찬가지다. 칸이 모자라는 구는 이 문장을 갖지 않는다.
    readFile(path.join(root, "docs/data/complex-ratio.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null),
  ]);

  for (const page of REALESTATE_PAGES) {
    await write(page.file, buildRealestatePage(baseHtml, page, realestate, complexRatio?.seoul ?? null));
  }

  let created = 0;
  let updated = 0;
  for (const district of DISTRICT_PAGES) {
    // 그 구의 전수 거래 파일. 없으면 관찰 문단이 통째로 비고 시세 문장만 남는다 —
    // 페이지를 못 만드는 것보다는 낫고, 실제로 파일이 아직 없는 구가 생길 수 있다.
    const deals = await readFile(
      path.join(root, "docs/data", dealFileName(DISTRICT_SLUGS[district.name])),
      "utf8"
    )
      .then(JSON.parse)
      .catch(() => null);
    const result = await write(
      district.file,
      buildDistrictPage(
        baseHtml,
        district,
        realestate,
        deals,
        renewalFacts?.districts?.[district.name] ?? null,
        complexRatio?.districts?.[district.name] ?? null
      ),
      true
    );
    if (result === "생성") created += 1;
    if (result === "갱신") updated += 1;
  }
  console.log(`  자치구 페이지 ${DISTRICT_PAGES.length}개 (생성 ${created} · 갱신 ${updated})`);

  async function write(file, html, quiet = false) {
    const target = path.join(root, "docs", file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) {
      if (!quiet) console.log(`  docs/${file} 변경 없음`);
      return "변경 없음";
    }
    await writeFile(target, html);
    const what = before === null ? "생성" : "갱신";
    if (!quiet) console.log(`  docs/${file} ${what}`);
    return what;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`부동산 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
