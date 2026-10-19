import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyPrerender, ratesHeadHtml, ratesHtml } from "./prerender.mjs";
import { createWriteSet } from "./render-writes.mjs";
import { rateBridgeHtml } from "./rate-bridge.mjs";
import { stripInlineScriptComments } from "./strip-inline-comments.mjs";

const root = path.resolve(import.meta.dirname, "..");
// 상품군 페이지 넷의 틀. 예전에는 docs/rates.html이 이 틀을 겸했고 예금 페이지와 본문이 글자까지
// 같았다(#193). 지금 docs/rates.html은 네 장으로 가는 요약 허브(scripts/prerender.mjs가 채운다)다.
export const RATES_TEMPLATE_PATH = path.join(root, "scripts/rates-template.html");
const BASE_URL = "https://kyhsa93.github.io/jipgye/";

const BASE_TITLE = "예금·적금·대출 금리 비교";
const BASE_DESCRIPTION =
  "금융감독원 금융상품통합비교공시 데이터를 매일 갱신해 은행·저축은행 정기예금과 적금 금리, 주택담보대출·전세자금대출 금리를 한 표에서 비교합니다.";

// 틀 `en` 사전의 title·shareTitle(틀에서는 같은 글자)과 description. 한국어는 위 BASE_*가 장마다 갈리는데 영어는
// 한 값으로 남아 네 장이 같은 영어 title·공유 카드·description을 냈다(#337). 한국어와 같은 축으로 가른다.
// 문안은 po가 이슈 #337 댓글(2026-10-18)로 정했다. title은 검색 결과·탭, shareTitle은 공유 카드, h1은 화면 머리(짧아야 영어 전환 때 줄 수가 안 는다)라 셋을 따로 둔다.
const BASE_TITLE_EN = "Deposit, Savings & Loan Rates";
const BASE_DESCRIPTION_EN =
  "Daily-updated Korean bank and savings bank deposit, installment savings, mortgage and jeonse loan rates, from the FSS financial product disclosure data.";

export const RATE_PAGES = [
  {
    category: "deposit",
    file: "deposit-rates.html",
    title: "정기예금 금리 비교 - 은행·저축은행 12개월",
    description:
      "은행·저축은행 정기예금 금리를 12개월 기준 최고금리 순으로 비교합니다. 금융감독원 금융상품통합비교공시 데이터를 매일 갱신합니다.",
    titleEn: "Term Deposit Rates - Korean Banks & Savings Banks, 12-Month",
    h1En: "Term Deposit Rates",
    shareTitleEn: "Term Deposit Rates: Best 12-Month Rates in Korea",
    descriptionEn:
      "Compare Korean bank and savings bank term deposit rates by highest 12-month rate. Updated daily from FSS financial product disclosure data.",
  },
  {
    category: "saving",
    file: "saving-rates.html",
    title: "적금 금리 비교 - 은행·저축은행 12개월",
    description:
      "은행·저축은행 적금 금리를 12개월 기준 최고금리 순으로 비교합니다. 금융감독원 금융상품통합비교공시 데이터를 매일 갱신합니다.",
    titleEn: "Installment Savings Rates - Korean Banks & Savings Banks, 12-Month",
    h1En: "Installment Savings Rates",
    shareTitleEn: "Installment Savings Rates: Best 12-Month Rates in Korea",
    descriptionEn:
      "Compare Korean bank and savings bank installment savings rates by highest 12-month rate. Updated daily from FSS financial product disclosure data.",
  },
  {
    category: "mortgage",
    file: "mortgage-rates.html",
    title: "주택담보대출 금리 비교 - 은행별 최저금리",
    description:
      "은행 주택담보대출 금리를 최저금리 순으로 비교합니다. 금리 유형과 금리 범위, 지난달 평균금리를 함께 보여주며 매일 갱신합니다.",
    titleEn: "Mortgage Loan Rates - Lowest Rate by Korean Bank",
    h1En: "Mortgage Loan Rates",
    shareTitleEn: "Mortgage Loan Rates: Lowest Rate by Bank in Korea",
    descriptionEn:
      "Compare Korean bank mortgage loan rates by lowest rate, with rate type, rate range and last month's average. Updated daily from FSS data.",
  },
  {
    category: "rentLoan",
    file: "rent-loan-rates.html",
    title: "전세자금대출 금리 비교 - 은행별 최저금리",
    description:
      "은행 전세자금대출 금리를 최저금리 순으로 비교합니다. 금리 유형과 금리 범위, 지난달 평균금리를 함께 보여주며 매일 갱신합니다.",
    titleEn: "Jeonse Loan Rates - Lowest Rate by Korean Bank",
    h1En: "Jeonse Loan Rates",
    shareTitleEn: "Jeonse Loan Rates: Lowest Rate by Bank in Korea",
    descriptionEn:
      "Compare Korean bank jeonse loan rates by lowest rate, with rate type, rate range and last month's average. Updated daily from FSS data.",
  },
];

// 틀(scripts/rates-template.html)의 껍데기 - 머리·1층 내비·추이 구획 - 는 Tailwind 유틸리티를 쓴다(#282). 아래 문자열 패치 여덟 곳의 needle 은 틀의 글자 그대로여야 하므로,
// 링크 둘(1층 내비의 금리 비교 링크·본문 상품군 링크)에는 class 를 달지 않고 그 부모(<nav>)에 단다 - 링크에 달면 needle 이 깨져 아래 호출이 던진다(test/rate-shell.test.mjs 가 지킨다).
// 스크립트가 다시 그리는 조각(탭·조건 칸·표·추이 카드)과 인라인 스크립트에는 유틸리티를 두지 않는다 - 구운 첫 화면과 다시 그린 화면이 어긋나는데 S6 이 스크립트를 못 바꾸게 막는다.
// 이 주석에도 유틸리티 이름을 접두사까지 적지 않는다 - 이 파일은 src/css/main.css 의 @source 목록에 있어 Tailwind 가 주석까지 훑는다.
function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

export function buildRatePage(baseHtml, page, rates) {
  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);
  // 영어 사전의 title·shareTitle·description. 키까지 맞춰 한 번씩만 바꾼다 - 틀에서 둘이 같은 글자라 글자만 보고 바꾸면
  // 둘을 갈라 놓을 수 없다. 함수로 넘겨 문안의 `$`가 치환 패턴으로 읽히지 않게 한다.
  html = replaceOnce(html, `shareTitle: "${BASE_TITLE_EN}",`, () => `shareTitle: ${JSON.stringify(page.shareTitleEn)},`, "영어 공유 제목 사전");
  html = replaceOnce(html, `h1: "${BASE_TITLE_EN}",`, () => `h1: ${JSON.stringify(page.h1En)},`, "영어 h1 사전");
  html = replaceOnce(html, `title: "${BASE_TITLE_EN}",`, () => `title: ${JSON.stringify(page.titleEn)},`, "영어 제목 사전");
  html = replaceOnce(html, `description: "${BASE_DESCRIPTION_EN}",`, () => `description: ${JSON.stringify(page.descriptionEn)},`, "영어 설명 사전");

  html = html.replaceAll(`${BASE_URL}rates.html`, `${BASE_URL}${page.file}`);

  // 원본(rates.html)은 deposit-rates.html과 같은 페이지라 색인에서 빼 두었다. 여기서
  // 찍어내는 상품군 페이지 넷은 각자 다른 표를 그리므로 색인 대상으로 되돌린다.
  html = replaceOnce(
    html,
    '<meta name="robots" content="noindex, follow">',
    '<meta name="robots" content="index, follow">',
    "색인 지시"
  );

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="rates-category" content="${page.category}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  html = replaceOnce(
    html,
    '<a id="nav-rates" href="./rates.html" class="active" aria-current="page">',
    '<a id="nav-rates" href="./rates.html" class="active">',
    "금리 비교 내비게이션"
  );

  html = replaceOnce(
    html,
    `<a href="./${page.file}" data-rate-page="${page.category}">`,
    `<a href="./${page.file}" data-rate-page="${page.category}" aria-current="page">`,
    "상품군 링크"
  );

  // 문자열 패치(replaceOnce)가 전부 끝난 뒤에, 나가는 장의 인라인 스크립트에서 주석만 뗀다(#313). 틀에는 주석이 그대로 있다.
  return stripInlineScriptComments(applyPrerender(html, {
    rates: ratesHtml(rates, { category: page.category }),
    ratesHead: ratesHeadHtml(page.category),
    // 금리 다음에 볼 곳 문단은 상품군마다 다른 말을 한다(scripts/rate-bridge.mjs).
    rateBridgeKo: rateBridgeHtml(page.category, "ko"),
    rateBridgeEn: rateBridgeHtml(page.category, "en"),
  }));
}

async function main() {
  const [baseHtml, rates] = await Promise.all([
    readFile(RATES_TEMPLATE_PATH, "utf8"),
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
  ]);

  // 전 장이 렌더에 성공한 뒤에 쓴다(#237) - 중간 장에서 던지면 어느 파일도 바뀌지 않는다.
  const writes = createWriteSet();
  for (const page of RATE_PAGES) {
    const html = buildRatePage(baseHtml, page, rates);
    const target = path.join(root, "docs", page.file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) {
      console.log(`  docs/${page.file} 변경 없음`);
      continue;
    }
    writes.stage(target, html, `  docs/${page.file} ${before === null ? "생성" : "갱신"}`);
  }
  writes.commit();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`금리 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
