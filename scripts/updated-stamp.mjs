/**
 * 데이터 기준일을 정적 HTML에 찍는다 (#111).
 *
 * 나눈 것: 기준일(YYYY-MM-DD)은 빌드가 HTML에 글자로 박고, "n일 전 자료" 경고는 페이지를 여는 순간
 * docs/nav.js가 KST 오늘로 계산한다. 경고를 빌드에 박으면 갱신·빌드가 멈추는 날(#97류) HTML이 같이
 * 얼어서 경고가 영영 안 뜬다. 기준일만 박으면 얼어도 거짓이 아니고, 경고는 보는 쪽 시계가 만든다.
 *
 * 기준일 = 그 장이 읽는 docs/data/*.json 소스들의 updatedAt 중 가장 오래된 값의 KST 날짜.
 * 소스 이름과 묶음 규칙(deals-<구> -> deals)은 source-age.mjs와 같다. updatedAt이 없는 파일은 소스가 아니다.
 *
 * 문턱(2일)은 source-age.mjs의 STALE_DAYS와 nav.js의 같은 이름 상수를 시험이 묶는다.
 *
 * 교차값(실거래 x 금리) 화면은 화면 단위 기준일 말고 입력별 기준일 줄을 하나 더 가진다 (#154). 화면 기준일이 가장
 * 오래된 한 날짜만 말하면 "금리만 낡았다"가 안 보이고, 예산대·전환율 화면은 금리를 빌드 때 구워 넣어서(rates.json을
 * 브라우저가 읽지 않는다) 화면 소스 표에도 금리가 없다. 줄도 같은 분리다: 날짜는 빌드가 글자로 박고, 어느 입력이
 * 며칠 낡았는지는 nav.js가 보는 순간 센다.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { kstDateOf, readDataSources } from "./source-age.mjs";

// 구 25곳·예산 18곳·아파트 3곳 + 부동산 첫 장이 같은 틀(realestate.html)에서 나오고 같은 네 파일을 읽는다.
const REALESTATE = ["realestate", "realestate-trend", "complex-ratio", "budget-deals"];
const DISTRICT_SLUGS = "dobong dongdaemun dongjak eunpyeong gangbuk gangdong gangnam gangseo geumcheon guro gwanak gwangjin jongno jung jungnang mapo nowon seocho seodaemun seongbuk seongdong songpa yangcheon yeongdeungpo yongsan".split(" ");
const BUDGETS = Array.from({ length: 18 }, (_, i) => `budget-${i + 3}eok`);

/** 장 -> 그 장이 읽는 소스 이름. 시험이 장의 loadJson/fetch 목록과 대조한다(빠뜨리면 빨강). */
export const PAGE_SOURCES = {
  "index.html": ["market", "news", "summary", "realestate", "realestate-trend"],
  "rates.html": ["rates"],
  "deposit-rates.html": ["rates"],
  "saving-rates.html": ["rates"],
  "mortgage-rates.html": ["rates"],
  "rent-loan-rates.html": ["rates"],
  "news.html": ["news", "summary"],
  "rate-news.html": ["news", "summary"],
  "realestate-news.html": ["news", "summary"],
  "stock-news.html": ["news", "summary"],
  "jeonse-vs-wolse.html": ["conversion"],
  "cancelled-deals.html": ["cancellation"],
  "renewal-vs-new.html": ["renewal-facts"],
  "floor-gap.html": ["floor-gap"],
  "price-outlook.html": ["outlook", "outlook-indicators", "move-in"],
  "record-high.html": ["record-high"],
  "switch-house.html": ["district-change"],
  "deal-search.html": ["deal-search", "budget-deals", "rent-preview", "complex-price", "deals", "rents"],
  "realestate.html": REALESTATE,
  "apartment-sale.html": REALESTATE,
  "apartment-jeonse.html": REALESTATE,
  "apartment-rent.html": REALESTATE,
  ...Object.fromEntries(BUDGETS.map((b) => [`${b}.html`, REALESTATE])),
  ...Object.fromEntries(DISTRICT_SLUGS.map((s) => [`district-${s}.html`, REALESTATE])),
};

/**
 * 교차값(금리로 계산한 값이 실거래 값과 같은 문장·같은 계산에 나오는) 화면 전수 -> 두 입력의 소스 이름.
 * deals는 그 화면이 읽는 파일(PAGE_SOURCES의 부분집합), rates는 빌드가 구워 넣은 rates.json이다.
 * 소스 이름과 가장 오래된 값 규칙은 baselineFor와 같다. 시험이 docs의 표지(budget-answers·전환율 리드)와 대조해
 * 여기 없는 교차값 화면이 생기면 빨강이 된다.
 */
export const CROSS_PAGES = {
  "jeonse-vs-wolse.html": { deals: ["conversion"], rates: ["rates"] },
  ...Object.fromEntries(BUDGETS.map((b) => [`${b}.html`, { deals: ["budget-deals"], rates: ["rates"] }])),
};

/** 데이터를 읽지 않는 장. #updated가 장 제목 줄이라 기준일이 없다. */
export const NO_DATA_PAGES = ["about.html", "method.html"];

/** 소스들 중 가장 오래된 updatedAt의 KST 날짜. 소스를 못 찾으면 던진다 - 조용히 자리표시자를 남기지 않는다. */
export function baselineFor(names, sources) {
  const byName = new Map(sources.map((s) => [s.name, s]));
  let oldest = null;
  for (const n of names) {
    const s = byName.get(n);
    if (!s) throw new Error(`기준일 소스 ${n}을(를) 찾지 못했다 (docs/data에 updatedAt이 있는 파일이 없다)`);
    if (oldest === null || Date.parse(s.updatedAt) < Date.parse(oldest)) oldest = s.updatedAt;
  }
  if (oldest === null) throw new Error("기준일 소스가 비어 있다");
  return kstDateOf(oldest);
}

// 이미 찍힌 줄(기준일 + 경고 자리)이나 처음 틀의 자리표시자 줄 어느 쪽이든 한 번에 바꾼다.
const LINE = /<div class="updated" id="updated"[^>]*>[^<]*<\/div>(\s*<div class="updated updated-warn" id="updated-warn"[^>]*><\/div>)?/;

export function stampHtml(html, ymd) {
  if (!LINE.test(html)) throw new Error('id="updated" 줄을 찾지 못했다');
  const indent = html.match(/([ \t]*)<div class="updated" id="updated"/)?.[1] ?? "";
  return html.replace(
    LINE,
    () => `<div class="updated" id="updated" data-updated="${ymd}">기준일 ${ymd}</div>\n${indent}<div class="updated updated-warn" id="updated-warn" role="status" hidden></div>`
  );
}

/** docsDir의 장들에 기준일을 찍는다. 바뀐 파일만 쓰고, 찍은 장 목록을 돌려준다. */
export function stampAll({ docsDir, dataDir, pages = PAGE_SOURCES } = {}) {
  const sources = readDataSources(dataDir);
  const done = [];
  for (const file of readdirSync(docsDir).filter((f) => f.endsWith(".html")).sort()) {
    const names = pages[file];
    if (!names) continue;
    const full = path.join(docsDir, file);
    const before = readFileSync(full, "utf8");
    const after = stampHtml(before, baselineFor(names, sources));
    if (after !== before) writeFileSync(full, after);
    done.push(file);
  }
  for (const file of Object.keys(pages)) {
    if (!done.includes(file)) throw new Error(`${file}이 docs에 없다`);
  }
  return done;
}

// 이미 찍힌 기준일 줄(+경고 자리). 처음 찍을 때는 없고, 다시 찍을 때는 통째로 바꾼다.
const CROSS_LINE = /<p class="updated cross-basis" id="cross-basis"[^>]*>[^<]*<\/p>\s*<p class="updated updated-warn" id="cross-warn"[^>]*><\/p>/;

/** 줄을 놓을 자리: 예산대 장은 결과 칸 앞(칸은 JS가 다시 그리므로 밖), 전환율 장은 리드 문단 뒤(리드도 JS가 다시 쓴다). */
const CROSS_ANCHORS = [
  { re: /([ \t]*)<div id="budget-result">/, before: true },
  { re: /([ \t]*)<p class="lead" id="lead">[\s\S]*?<\/p>/, before: false },
];

/** 기준일 줄 HTML. 글자는 "실거래 MM-DD x 금리 MM-DD" 한 줄이고, 틀은 모든 장이 같다(숫자만 다르다, #66). */
export function crossLineHtml(dealsYmd, ratesYmd, indent = "") {
  return (
    `<p class="updated cross-basis" id="cross-basis" data-deals="${dealsYmd}" data-rates="${ratesYmd}">실거래 ${dealsYmd.slice(5)} x 금리 ${ratesYmd.slice(5)}</p>\n` +
    `${indent}<p class="updated updated-warn" id="cross-warn" role="status" hidden></p>`
  );
}

/** 교차값 화면에 입력별 기준일 줄을 찍는다. 이미 있으면 바꾸고, 자리를 못 찾으면 던진다(조용히 빠지지 않게). */
export function crossStampHtml(html, file, dealsYmd, ratesYmd) {
  if (CROSS_LINE.test(html)) {
    const indent = html.match(/([ \t]*)<p class="updated cross-basis"/)?.[1] ?? "";
    return html.replace(CROSS_LINE, () => crossLineHtml(dealsYmd, ratesYmd, indent));
  }
  const { re, before } = file === "jeonse-vs-wolse.html" ? CROSS_ANCHORS[1] : CROSS_ANCHORS[0];
  const m = re.exec(html);
  if (!m) throw new Error(`${file}: 입력별 기준일 줄을 놓을 자리를 찾지 못했다`);
  const line = `${m[1]}${crossLineHtml(dealsYmd, ratesYmd, m[1])}`;
  const end = m.index + m[0].length;
  return before ? `${html.slice(0, m.index)}${line}\n${html.slice(m.index)}` : `${html.slice(0, end)}\n${line}${html.slice(end)}`;
}

/** docsDir의 교차값 화면들에 입력별 기준일 줄을 찍는다. 바뀐 파일만 쓰고 찍은 장 목록을 돌려준다. */
export function crossStampAll({ docsDir, dataDir, pages = CROSS_PAGES } = {}) {
  const sources = readDataSources(dataDir);
  const done = [];
  for (const [file, inputs] of Object.entries(pages)) {
    const full = path.join(docsDir, file);
    const before = readFileSync(full, "utf8");
    const after = crossStampHtml(before, file, baselineFor(inputs.deals, sources), baselineFor(inputs.rates, sources));
    if (after !== before) writeFileSync(full, after);
    done.push(file);
  }
  return done;
}
