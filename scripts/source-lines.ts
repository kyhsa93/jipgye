// 출처 문구를 한 곳에 모은다 (#588). 순수 모듈 - 의존 0.
//
// 화면의 출처 줄(`#footer-source` div 와 인라인 사전의 `footerSource`/`source`)은 손으로 쓴 틀에 `{{src:<id>.ko|en}}` 자리표시로 적고,
// 모든 장이 지나는 `applyPrerender`(scripts/prerender.ts)가 렌더 때 `stampSources` 로 이 표의 글자를 꽂는다(틀 경로를 안 지나는 about·deal-search 는
// prerender.ts 가 따로 찍는다). 그래서 docs/ 를 그대로 열면 자리표시가 보인다 - main 에는 생성 HTML 이 없고 배포가 렌더하므로 수용한다.
//
// 글자는 지금 화면에 나가는 문구를 그대로 재현한다(#588 PR1 은 바이트 불변). 문구를 바꾸면 그 장의 출력 바이트가 바뀌므로 골든 판정을 받는다.
// 장별 꼬리(「신고 기한…」)는 장마다 다른 설명이라 FOOTERS 에 그대로 둔다. 출처 이름만 SOURCES 를 거친다.
//
// 글자 제약: 출처 줄은 HTML 본문과 JS 큰따옴표 문자열 두 곳에 같은 글자로 들어간다 - `"` `\` `<` `>` `&` 와 줄바꿈을 쓰지 않는다(시험이 막는다).

/** 기관·시스템 이름. 데이터셋 번호는 기계용 식별자가 아니라 사람에게 보이는 출처 표기용이다(Release 본문). */
export const SOURCES = {
  molit: { ko: "국토교통부", en: "Ministry of Land, Infrastructure and Transport", abbr: "MOLIT" },
  molitSale: { dataset: "15126469" },
  molitRent: { dataset: "15126474" },
  bok: { ko: "한국은행", en: "Bank of Korea" },
  ecos: { ko: "한국은행 경제통계시스템(ECOS)", en: "Bank of Korea ECOS" },
  reb: { ko: "한국부동산원", en: "Korea Real Estate Board" },
  kb: { ko: "KB국민은행", en: "KB Kookmin Bank" },
} as const;

/**
 * legal 이 권한 출처 문구 원문(#450 legal Q4 표, 2026-10-25). 바이트를 고정한다 - 고치려면 legal 판정이 먼저다.
 * molitSale 은 Release 본문(scripts/build-correction-release.ts)이 수집 시각을 끼워 쓰는 문장이다. Release 는 이 상수를 import 한다(#588 PR2) - 수집 시각은 Release 가 끼운다.
 * ecos·rone 은 legal 이 한국어만 권했다 - 영어는 legal 판정 없이 만들지 않는다.
 */
export const ATTRIBUTION = {
  molitSale: {
    ko: (collected: string) =>
      `출처: ${SOURCES.molit.ko} 아파트 매매 실거래가 자료(공공데이터포털 ${SOURCES.molitSale.dataset}), ${collected}. 이 자료는 원천을 집계·가공한 값이며 ${SOURCES.molit.ko}가 후원·보증하지 않습니다.`,
    en: (collected: string) =>
      `Source: ${SOURCES.molit.en} apartment sale transaction data (data.go.kr ${SOURCES.molitSale.dataset}), ${collected}. These are aggregated and processed values derived from the source and are not endorsed or guaranteed by the Ministry.`,
  },
  ecos: { ko: `출처: ${SOURCES.ecos.ko}. 이 값은 원자료를 집계·가공한 것입니다.` },
  rone: { ko: `출처: ${SOURCES.reb.ko} R-ONE 부동산통계정보시스템. 이 값은 원자료를 집계·가공한 것이며 원자료 값을 바꾸지 않았습니다.` },
} as const;

type Lang = "ko" | "en";

/**
 * 출처 줄 한 줄: `출처: 이름, 이름. 꼬리`. 영어는 `Source: `. 장마다 다른 모양(about 의 `Sources: …; …`, 전망의 `…, and …`)은 opts 로 낸다.
 *   label  머리(기본 ko `출처: `, en `Source: `)
 *   sep    이름 사이(기본 `, `)
 *   and    true 면 마지막 이름 앞에 `and `(영어 목록)
 */
type LineOpts = { label?: string; sep?: string; and?: boolean };

export function footerLine(lang: Lang, names: readonly string[], tail = "", opts: LineOpts = {}) {
  const label = opts.label ?? (lang === "ko" ? "출처: " : "Source: ");
  const sep = opts.sep ?? ", ";
  const list = opts.and && names.length > 1 ? [...names.slice(0, -1), `and ${names.at(-1)}`] : [...names];
  return `${label}${list.join(sep)}.${tail ? ` ${tail}` : ""}`;
}

const M = SOURCES.molit;
const molitKo = (what: string) => `${M.ko} 아파트 ${what}`;
const molitEn = (what: string) => `${M.abbr} ${what}`;
const ko = (names: readonly string[], tail = "") => footerLine("ko", names, tail);
const en = (names: readonly string[], tail = "", opts: LineOpts = {}) => footerLine("en", names, tail, opts);

// 가공 꼬리(#588 단계 C, cpo·legal·cmo 판정): ECOS 값으로 월 상환액·전환 비교를 계산해 보이는 장과 price-outlook 이 같은 글자를 쓴다.
export const DERIVED = { ko: "이 값은 원자료를 가공한 것입니다.", en: "These figures are derived from the original data." } as const;

// 신고 기한 꼬리. 조사(은/는)까지 받는다 - 「거래는」·「계약은」.
const LAG_KO = (what: string, topic: string) => `신고된 ${what}만 집계되며 신고 기한(계약 후 30일)이 있어 최근 ${topic} 나중에 반영됩니다.`;
const LAG_EN_FILED = (counted: string, recent: string) => `Only filed ${counted} are counted, and the 30-day filing window means recent ${recent} arrive later.`;
const LAG_EN_REPORTED = "Only reported deals are counted, and reporting can lag up to 30 days after contract.";

/** 장별 출처 줄. 키가 곧 자리표시 id 다(`{{src:<id>.ko}}`). */
export const FOOTERS: Record<string, Record<Lang, string>> = {
  // ECOS 약관 제7조②(ECOS 에서 받은 정보임을 표시) - 한국은행 값은 모두 ECOS 로 받으므로 「한국은행」이 아니라 ECOS 를 적는다(legal #588, PR1 commit B).
  about: {
    ko: ko([molitKo("매매·전월세 실거래가 공개시스템"), SOURCES.ecos.ko, SOURCES.reb.ko]),
    en: en([M.en, SOURCES.ecos.en, SOURCES.reb.en], "", { label: "Sources: ", sep: "; " }),
  },
  method: {
    ko: ko([molitKo("매매·전월세 실거래가 공개시스템"), SOURCES.ecos.ko]),
    en: en([M.en, SOURCES.ecos.en], "", { label: "Sources: ", sep: "; " }),
  },
  // 첫 화면 돈의 값 한 줄: 기준금리와 원/달러 환율 모두 ECOS 다(환율은 일 계열 731Y001 의 매매기준율, #639).
  index: {
    ko: ko([`${SOURCES.ecos.ko} 기준금리·원/달러 환율(매매기준율)`]),
    en: en([`${SOURCES.ecos.en} (base rate, KRW/USD reference rate)`]),
  },
  // 증시·환율 뉴스 장: 코스피·환율 카드의 출처. 기사 RSS 줄은 build-news-pages.ts 가 이 줄 뒤에 잇는다(#639).
  stocks: {
    ko: ko([SOURCES.ecos.ko]),
    en: en([SOURCES.ecos.en]),
  },
  cancelledDeals: {
    ko: ko([molitKo("매매 실거래가 공개시스템")], LAG_KO("거래", "거래는")),
    en: en([molitEn("apartment sale filings")], LAG_EN_FILED("transactions", "deals")),
  },
  dealSearch: {
    ko: ko([molitKo("매매 실거래가 공개시스템")], LAG_KO("거래", "거래는")),
    en: en([molitEn("real transaction price disclosure")], LAG_EN_REPORTED),
  },
  realestate: {
    ko: ko([molitKo("매매·전월세 실거래가 공개시스템")], LAG_KO("거래", "거래는")),
    en: en([molitEn("real transaction price disclosure")], LAG_EN_REPORTED),
  },
  // 예산대 18장: 시세 틀을 쓰지만 월 상환액·1억당 값이 ECOS 주담대 평균금리라 ECOS 를 더한다(build-budget-pages 가 realestate → budget 으로 바꾼다).
  budget: {
    ko: ko([molitKo("매매·전월세 실거래가 공개시스템"), SOURCES.ecos.ko], `${DERIVED.ko} ${LAG_KO("거래", "거래는")}`),
    en: en([molitEn("real transaction price disclosure"), SOURCES.ecos.en], `${DERIVED.en} ${LAG_EN_REPORTED}`),
  },
  floorGap: {
    ko: ko([molitKo("매매·전월세 실거래가 공개시스템")], "신고된 거래만 집계되며 해제된 거래는 뺍니다."),
    en: en([molitEn("apartment sale and lease filings")], "Only filed transactions are counted, and cancelled deals are removed."),
  },
  jeonseVsWolse: {
    ko: ko([molitKo("전월세 실거래가"), SOURCES.ecos.ko], `${DERIVED.ko} ${LAG_KO("거래", "계약은")}`),
    en: en([molitEn("apartment rent filings"), SOURCES.ecos.en], `${DERIVED.en} ${LAG_EN_FILED("contracts", "contracts")}`),
  },
  recordHigh: {
    ko: ko([molitKo("매매 실거래가 공개시스템")], "중개거래만 세고 해제된 거래와 직거래는 뺍니다."),
    en: en([molitEn("apartment sale filings")], "Brokered sales only; cancelled and direct deals are excluded."),
  },
  renewalVsNew: {
    ko: ko([molitKo("전월세 실거래가 공개시스템")], "신고된 계약만 집계되며 신고 기한(계약 후 30일)이 지나 마감된 달만 셉니다."),
    en: en([molitEn("apartment jeonse and monthly rent filings")], "Only filed contracts are counted, and only months whose 30-day filing window has closed."),
  },
  // 재계약 확인기 절(#652 V3): 같은 장 안의 단지별 칸이라 창(24개월)과 범위(순수 전세 갱신)를 꼬리에 적는다.
  renewalCheck: {
    ko: ko([molitKo("전월세 실거래가 공개시스템")], "최근 24개월 순수 전세 갱신 신고를 단지·평형별로 셉니다. 이 값은 원자료를 집계·가공한 것입니다."),
    en: en([molitEn("apartment jeonse and monthly rent filings")], "Pure jeonse renewals filed in the last 24 months, counted by complex and unit type. These are aggregated and processed values."),
  },
  // 실거래가격지수는 ECOS 901Y089(build-district-change.ts)라 ECOS 를 적는다(제7조②). 주택가격동향조사는 R-ONE 직접 수집이라 R-ONE 을 적는다(#588 단계 C).
  switchHouse: {
    ko: ko([molitKo("매매 실거래가 공개시스템(중개거래, 해제 제외)"), `${SOURCES.reb.ko} 실거래가격지수·주택가격동향조사(R-ONE)`, SOURCES.ecos.ko], DERIVED.ko),
    en: en([molitEn("apartment sale filings (brokered, cancelled excluded)"), `${SOURCES.reb.en} transaction index and price survey (R-ONE)`, SOURCES.ecos.en], DERIVED.en, { sep: "; " }),
  },
  // 갈아타기의 같은 집 쌍 절(#170 V8): 쌍은 실거래, 견주는 값은 R-ONE 에서 직접 받은 주택가격동향조사(ECOS 경유 아님)라 R-ONE 을 적는다.
  repeatSales: {
    // 가공 꼬리(DERIVED)는 ECOS 값으로 계산한 장의 것이라(시험이 지킨다) 쓰지 않고, R-ONE 출처 문구(ATTRIBUTION.rone)의 가공 문장을 쓴다.
    ko: ko([molitKo("매매 실거래가 공개시스템(중개거래, 해제·직거래 제외)"), `${SOURCES.reb.ko} 주택가격동향조사(R-ONE)`], "이 값은 원자료를 집계·가공한 것이며 원자료 값을 바꾸지 않았습니다."),
    en: en([molitEn("apartment sale filings (brokered; cancelled and direct deals excluded)"), `${SOURCES.reb.en} price survey (R-ONE)`], "These are aggregated and processed values; the source values were not changed.", { sep: "; " }),
  },
  priceOutlook: {
    ko: ko(
      [`${SOURCES.reb.ko} 아파트 매매 실거래가격지수(한국은행 ECOS)`, molitKo("매매 실거래가 공개시스템"), `${SOURCES.kb.ko}(한국은행 ECOS 경제통계시스템 경유)`],
      `${DERIVED.ko} 투자 판단을 대신하지 않습니다.`
    ),
    en: en(
      [`${SOURCES.reb.en} apartment sale price index (${SOURCES.ecos.en})`, molitEn("apartment sale filings"), `${SOURCES.kb.en} (via ${SOURCES.ecos.en})`],
      `${DERIVED.en} Not investment advice.`,
      { and: true }
    ),
  },
};

const PLACEHOLDER = /\{\{src:([A-Za-z]+)\.(ko|en)\}\}/g;

/** html 의 `{{src:<id>.ko|en}}` 를 FOOTERS 글자로 바꾼다. 모르는 id 나 모양이 틀린 자리표시가 남으면 던진다(빈 출처로 배포되지 않게). */
export function stampSources(html: string) {
  if (!html.includes("{{src:")) return html;
  const out = html.replace(PLACEHOLDER, (whole, id: string, lang: Lang) => {
    const line = FOOTERS[id]?.[lang];
    if (line == null) throw new Error(`출처 자리표시 ${whole}: scripts/source-lines.ts FOOTERS 에 없는 id 다.`);
    return line;
  });
  const left = out.indexOf("{{src:");
  if (left !== -1) throw new Error(`출처 자리표시 모양이 틀렸다: ${out.slice(left, left + 40)}`);
  return out;
}
