/**
 * 데이터 기준일을 정적 HTML에 찍는다 (#111).
 *
 * 나눈 것: 기준일(YYYY-MM-DD)은 빌드가 HTML에 글자로 박고, "n일 전 자료" 경고는 페이지를 여는 순간
 * docs/nav.js가 KST 오늘로 계산한다. 경고를 빌드에 박으면 갱신·빌드가 멈추는 날(#97류) HTML이 같이
 * 얼어서 경고가 영영 안 뜬다. 기준일만 박으면 얼어도 거짓이 아니고, 경고는 보는 쪽 시계가 만든다.
 *
 * 두 줄이 서는 자리가 다르다 (#282). 기준일(#updated)은 바닥글이고 "n일 전 자료" 경고(#updated-warn)는 머리글이다.
 * 전에는 둘 다 머리글의 제목 바로 아래였는데, 글자 축척이 15px로 오른 뒤 375폭에서 기준일 한 줄이 두 줄이 되어
 * 머리글이 커졌다(실측: 67장 중 31장이 커지고 29장은 본문 시작이 9px 밀렸다 - po 댓글 6196624468·cmo 댓글
 * 6203583946이 따로 잰 같은 수). #278이 적어 둔 두 선택지 "15px로 올리거나 바닥글로 옮긴다" 중 뒤의 것이다.
 * 경고까지 같이 내리면 낡은 자료 고지가 첫 화면에서 사라진다(134조건 중 128 -> 1, 문서 좌표 중앙 154px -> 4,176px).
 * 그래서 기준일만 내리고 경고는 제자리에 둔다(po 6206109779 / cmo 6207405456). nav.js는 둘을 getElementById로
 * 따로 찾으므로 자리가 갈려도 JS는 한 줄도 안 바뀐다.
 * 데이터를 읽지 않는 장(NO_DATA_PAGES - 소개·방법과 금리 종료 안내 다섯)에는 기준일 줄이 아예 없다 - 그 장의 제목 아래 한 줄은 기준일이 아니라
 * 꼬리표라서 #tagline으로 이름을 갈랐다(#282, po 6206109779 / cmo 6207405456). 한 이름이 두 뜻을 지면
 * 다음 사람이 64장 규칙을 세 장에 민다.
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
import { rateStampText } from "./budget-pages.ts";
import { kstDateOf, readDataSources } from "./source-age.ts";

// 구 25곳·예산 18곳·아파트 3곳 + 부동산 첫 장이 같은 틀(realestate.html)에서 나오고 같은 네 파일을 읽는다.
const REALESTATE = ["realestate", "realestate-trend", "complex-ratio", "budget-deals"];
const DISTRICT_SLUGS = "dobong dongdaemun dongjak eunpyeong gangbuk gangdong gangnam gangseo geumcheon guro gwanak gwangjin jongno jung jungnang mapo nowon seocho seodaemun seongbuk seongdong songpa yangcheon yeongdeungpo yongsan".split(" ");
const BUDGETS = Array.from({ length: 18 }, (_, i) => `budget-${i + 3}eok`);

/** 장 -> 그 장이 읽는 소스 이름. 시험이 장의 loadJson/fetch 목록과 대조한다(빠뜨리면 빨강). */
export const PAGE_SOURCES = {
  "index.html": ["market", "news", "summary", "realestate", "realestate-trend"],
  "news.html": ["news", "summary"],
  "rate-news.html": ["news", "summary"],
  "realestate-news.html": ["news", "summary"],
  "stock-news.html": ["news", "summary"],
  "jeonse-vs-wolse.html": ["conversion"],
  "cancelled-deals.html": ["cancellation"],
  "renewal-vs-new.html": ["renewal-facts", "renewal-cells"],
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
 * deals는 그 화면이 읽는 파일(PAGE_SOURCES의 부분집합), rates는 빌드가 구워 넣은 금리의 소스다 - 예산대 장은 한국은행 ECOS 주담대 평균금리,
 * 전환율 장은 ECOS 전세자금대출·정기예금 평균금리다(#577 B1·B1b). ECOS 계열은 raw/indicators/series.json 이라 docs/data 소스가 아니어서, 같은 수집 단계가
 * 매일 그 계열로 다시 쓰는 outlook-indicators.json(build-indicators)의 updatedAt 을 금리 날짜로 쓴다.
 * 소스 이름과 가장 오래된 값 규칙은 baselineFor와 같다. 시험이 docs의 표지(budget-answers·전환율 리드)와 대조해
 * 여기 없는 교차값 화면이 생기면 빨강이 된다.
 */
export const CROSS_PAGES = {
  // 전환율 장의 금리는 build-conversion 이 conversion.json 에 구워 넣는다 - 계열이 없어 conversion 을 그대로 둔 날 금리 날짜가
  // 계열 날짜만 따라 새것처럼 보이지 않게, 두 소스 중 오래된 쪽을 금리 날짜로 쓴다(#577 B1b).
  "jeonse-vs-wolse.html": { deals: ["conversion"], rates: ["conversion", "outlook-indicators"] },
  ...Object.fromEntries(BUDGETS.map((b) => [`${b}.html`, { deals: ["budget-deals"], rates: ["outlook-indicators"] }])),
};

/** 데이터를 읽지 않는 장. 기준일이 없고, 제목 아래 한 줄은 #updated가 아니라 #tagline이다(#282). */
// 금리 종료 안내 다섯 장(#577 B2, 2027-01-23 삭제 예정 - #581)도 데이터를 읽지 않는다.
export const RATE_NOTICE_PAGES = ["deposit-rates.html", "mortgage-rates.html", "rates.html", "rent-loan-rates.html", "saving-rates.html"];
export const NO_DATA_PAGES = ["about.html", "method.html", ...RATE_NOTICE_PAGES];

/** 소스들 중 가장 오래된 updatedAt의 KST 날짜. 소스를 못 찾으면 던진다 - 조용히 자리표시자를 남기지 않는다. */
export function baselineFor(names, sources) {
  const byName = new Map<string, any>(sources.map((s) => [s.name, s]));
  let oldest = null;
  for (const n of names) {
    const s = byName.get(n);
    if (!s) throw new Error(`기준일 소스 ${n}을(를) 찾지 못했다 (docs/data에 updatedAt이 있는 파일이 없다)`);
    if (oldest === null || Date.parse(s.updatedAt) < Date.parse(oldest)) oldest = s.updatedAt;
  }
  if (oldest === null) throw new Error("기준일 소스가 비어 있다");
  return kstDateOf(oldest);
}

// 이미 찍힌 줄이든 처음 틀의 자리표시자 줄이든 기준일 한 줄만 바꾼다. 경고 자리(#updated-warn)는 건드리지 않는다 -
// 두 줄이 더는 붙어 있지 않기 때문이다(#282: 기준일은 바닥글, 경고는 머리글). 전에는 이 정규식이 경고 줄까지 삼켜
// 다시 뱉었고, 그대로 두면 떨어져 있는 경고 줄을 바닥글에 하나 더 만들어 id 가 둘이 된다.
const LINE = /<div class="updated" id="updated"[^>]*>[^<]*<\/div>/;

export function stampHtml(html, ymd) {
  if (!LINE.test(html)) throw new Error('id="updated" 줄을 찾지 못했다');
  return html.replace(LINE, () => `<div class="updated" id="updated" data-updated="${ymd}">기준일 ${ymd}</div>`);
}

// 장 하나를 읽고 쓰는 길. 기본은 디스크이고, 빌드 스크립트는 쓰기를 모아 뒀다가 한꺼번에 내려 쓴다(#237, render-writes.mjs).
const diskIo = { read: (file) => readFileSync(file, "utf8"), write: (file, text) => writeFileSync(file, text) };

/** docsDir의 장들에 기준일을 찍는다. 바뀐 파일만 쓰고, 찍은 장 목록을 돌려준다. */
export function stampAll({ docsDir, dataDir, pages = PAGE_SOURCES, io = diskIo }: { docsDir?: string; dataDir?: string; pages?: typeof PAGE_SOURCES; io?: typeof diskIo } = {}) {
  const sources = readDataSources(dataDir);
  const done = [];
  for (const file of readdirSync(docsDir).filter((f) => f.endsWith(".html")).sort()) {
    const names = pages[file];
    if (!names) continue;
    const full = path.join(docsDir, file);
    const before = io.read(full);
    const after = stampHtml(before, baselineFor(names, sources));
    if (after !== before) io.write(full, after);
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

/** 기준일 줄 HTML. 글자는 "실거래 MM-DD x 금리 MM-DD" 한 줄이고, 틀은 모든 장이 같다(숫자만 다르다, #66).
 * 줄의 "실거래" 날짜는 소스 json의 updatedAt, 곧 수집·집계 시각이지 거래 신고일이 아니다(#200).
 * rateText 를 주면 금리 칸을 그 글자로 쓴다 - 예산대 장의 「금리(8월분) 10-26 갱신」(#411 확장, budget-pages.ts rateStampText). */
export function crossLineHtml(dealsYmd, ratesYmd, indent = "", rateText = null) {
  return (
    `<p class="updated cross-basis" id="cross-basis" data-deals="${dealsYmd}" data-rates="${ratesYmd}">실거래 ${dealsYmd.slice(5)} x ${rateText ?? `금리 ${ratesYmd.slice(5)}`}</p>\n` +
    `${indent}<p class="updated updated-warn" id="cross-warn" role="status" hidden></p>`
  );
}

/** 교차값 화면에 입력별 기준일 줄을 찍는다. 이미 있으면 바꾸고, 자리를 못 찾으면 던진다(조용히 빠지지 않게). */
export function crossStampHtml(html, file, dealsYmd, ratesYmd) {
  // 예산대 장은 금리 값의 기준월을 장에 구운 금리 칩(data-rate-month)에서 읽는다 - 한눈에 금리 줄과 같은 값이다(#411 확장).
  const rateText = file === "jeonse-vs-wolse.html" ? null : rateStampText(ratesYmd, html.match(/data-rate-month="(\d{6})"/)?.[1]);
  if (CROSS_LINE.test(html)) {
    const indent = html.match(/([ \t]*)<p class="updated cross-basis"/)?.[1] ?? "";
    return html.replace(CROSS_LINE, () => crossLineHtml(dealsYmd, ratesYmd, indent, rateText));
  }
  const { re, before } = file === "jeonse-vs-wolse.html" ? CROSS_ANCHORS[1] : CROSS_ANCHORS[0];
  const m = re.exec(html);
  if (!m) throw new Error(`${file}: 입력별 기준일 줄을 놓을 자리를 찾지 못했다`);
  const line = `${m[1]}${crossLineHtml(dealsYmd, ratesYmd, m[1], rateText)}`;
  const end = m.index + m[0].length;
  return before ? `${html.slice(0, m.index)}${line}\n${html.slice(m.index)}` : `${html.slice(0, end)}\n${line}${html.slice(end)}`;
}

/** docsDir의 교차값 화면들에 입력별 기준일 줄을 찍는다. 바뀐 파일만 쓰고 찍은 장 목록을 돌려준다. */
export function crossStampAll({ docsDir, dataDir, pages = CROSS_PAGES, io = diskIo }: { docsDir?: string; dataDir?: string; pages?: typeof CROSS_PAGES; io?: typeof diskIo } = {}) {
  const sources = readDataSources(dataDir);
  const done = [];
  for (const [file, inputs] of Object.entries(pages)) {
    const full = path.join(docsDir, file);
    const before = io.read(full);
    const after = crossStampHtml(before, file, baselineFor(inputs.deals, sources), baselineFor(inputs.rates, sources));
    if (after !== before) io.write(full, after);
    done.push(file);
  }
  return done;
}
