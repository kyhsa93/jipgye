// 근거표(#871) 시험이 같이 쓰는 고정 데이터와 금지어 검사 - test/budget-table.test.mjs(구운 보기)와 test/budget-table-js.test.mjs(장 전용 JS)가
// 같은 데이터로 두 쪽 출력을 맞댄다(cto 조건 E). 오늘 데이터를 읽지 않는다(#8).
import assert from "node:assert/strict";
import { DISTRICT_SLUGS } from "../../scripts/district-slugs.ts";
import { APARTMENT_FIELDS, CELL_FIELDS } from "../../scripts/recommendation.ts";
import { budgetModel, recoViews } from "../../scripts/budget-table.ts";

// ---- 고정 데이터 ----------------------------------------------------------------------------------------------------------------
// 칸 하나. 값은 만원. checks 는 빌더가 싣는 [코드, 값] 쌍이다.
export const cell = (areaSqm, median, o = {}) => {
  const c = {
    areaSqm, n: 4, median, low: median - 1_000, high: median + 1_500, rawMedian: median - 200, unadjustedDeals: 1,
    extraCost: 1_700, totalCost: median + 1_700, loanCapGeneral: 29_000, loanCapFirstTime: 40_000, cashGeneral: median - 27_300, cashFirstTime: median - 38_300,
    lastAmount: median + 300, lastDate: "2026-10-02", lastFloor: 7, deals12m: 9, jeonseN: 2, sampleGrade: "partial", position: [["peers_n", 99]], checks: [["few_deals", 4]],
    ...o,
  };
  return CELL_FIELDS.map((f) => c[f]);
};
export const apt = (id, name, dong, cells, aliases = []) => APARTMENT_FIELDS.map((f) => ({ id, name, dong, buildYear: 2001, households: null, aliases, cells }[f]));

/** 25구 파일. extra 로 구별 내용을 덮는다. 기본은 칸 0개·뺀 칸 0개다. */
export function files(extra = {}) {
  return Object.keys(DISTRICT_SLUGS).map((district) => ({
    schemaVersion: 1,
    algorithmVersion: "reco-0",
    updatedAt: "2026-11-14T03:15:56.201Z",
    district,
    districtCode: "00000",
    windowDays: 183,
    asOf: { deals: "2026-11-14", windowStart: "2026-05-15", indexRef: "202608", indexFilled: false, rules: "2026-10-01" },
    types: { living: { status: "off", reasons: ["no_transit"] }, future: { status: "none", reasons: ["not_planned"] }, balanced: { status: "none", reasons: ["not_planned"] } },
    apartmentFields: [...APARTMENT_FIELDS],
    cellFields: [...CELL_FIELDS],
    apartments: [],
    excluded: [],
    ...extra[district],
  }));
}

// 노원구: 값 낸 7억대 칸 4개(면적대 셋 모두) - 예시 줄을 내는 구. 「이름 (동)」 한 곳을 넣었다(cto 5, 시험 고정 데이터 조건).
// 마포구: 별칭이 있는 단지 하나(마포아이파크포레 ← 신촌숲아이파크, 오늘 데이터와 같은 모양) - 값 낸 칸 2개.
// 강남구: 값 낸 칸 0·뺀 칸만. 은평구: 7억대 밖 칸만(8억대) - 7억대 건수에 안 든다.
export const FIXTURE = {
  노원구: {
    apartments: [
      apt("11350|하계동|1|건영", "건영 (하계동)", "하계동", [cell(53.14, 72_600)]),
      apt("11350|상계동|2|건영", "건영 (상계동)", "상계동", [cell(84.9, 71_000, { high: 81_000, checks: [["stale_deal", 120], ["reg_line", 15]] })]),
      apt("11350|중계동|3|가람", "가람", "중계동", [cell(59.9, 70_500, { sampleGrade: "enough" }), cell(114.9, 76_000)]),
    ],
    excluded: [{ band: 7, area: "60-85", thin: 5 }, { band: 7, area: "over-85", thin: 2 }, { band: 9, area: "under-60", thin: 3 }],
  },
  마포구: {
    apartments: [apt("11440|신수동|462|마포아이파크포레", "마포아이파크포레", "신수동", [cell(59.75, 74_000), cell(84.93, 79_000)], ["11440|신수동|462|신촌숲아이파크"])],
    excluded: [{ band: 7, area: "under-60", thin: 1 }],
  },
  강남구: { excluded: [{ band: 7, area: "over-85", thin: 4 }] },
  은평구: { apartments: [apt("11380|불광동|5|북한산", "북한산", "불광동", [cell(84.0, 82_000)])] },
};

export const views = () => recoViews(files(FIXTURE));
export const model = (o) => budgetModel(views(), o);
export const textOf = (html) => html.replace(/<[^>]+>/g, " ");
// 화면에 나오는 글자: 태그 밖 글자 + 화면용 속성(data-*-en·aria-label·title·placeholder). 스크립트·head 는 뺀다(장 안 JS 의 "return" 같은 코드 낱말은 화면 글자가 아니다).
export const shown = (html) =>
  `${textOf(html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<script[\s\S]*?<\/script>/g, ""))} ${[...html.matchAll(/\s(?:data-[\w-]*en|aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]).join(" ")}`;

// 금지어(po 명세 ③ 「금지어(시험, clo 확정)」 + clo PR #878 판정이 더한 것). 영어 "top" 은 ③ 의 열 머리 "Costs on top of price" 만 걷어 낸 뒤 검사한다(clo 판정).
const BANNED_KO = ["점수", "순위", "추천", "1위", "베스트", "TOP", "유망", "오를", "상승", "여력", "수익", "투자", "저평가", "기회", "지금 사야", "후보", "보장", "적기", "저렴", "급매", "가성비"];
const BANNED_EN = [/\bscore/i, /\brank/i, /\brecommend/i, /\bbest\b/i, /\btop\b/i, /\bupside/i, /\bundervalued/i, /\binvest/i, /\breturns?\b/i, /\bopportunit/i, /\bguarantee/i, /\bbargain/i, /\bcheap/i];
export function assertNoBanned(text, where) {
  for (const w of BANNED_KO) assert.ok(!text.includes(w), `${where}: 「${w}」`);
  assert.doesNotMatch(text, /\d+\s*위(?![가-힣])/, `${where}: N위`);
  assert.doesNotMatch(text, /번째/, `${where}: 순번`);
  const en = text.replace(/\bon top of\b/gi, "");
  for (const re of BANNED_EN) assert.doesNotMatch(en, re, `${where}: ${re}`);
}

