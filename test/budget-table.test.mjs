// 근거표 장(docs/buy-by-budget.html)의 구운 기본 보기 (#871 PR-A).
//
// 셋으로 나뉜다. (1) 고정 데이터로 scripts/budget-table.ts 의 계산·글자를 본다 - 오늘 데이터를 읽지 않는다(#8).
// (2) 손으로 고치는 틀 docs/buy-by-budget.html 의 구조(noindex·자리표시·폼 컨트롤 name 0·장 안 해시 앵커 0, cto 조건 B).
// (3) 나가는 장(build/site)의 구조만 - noindex·사이트맵 0·자리 존재. 이 파일이 site-root 를 import 하므로 배포 게이트(test:site)에 들고, 그래서
//     「실데이터로 숫자가 구워졌다」 같은 단언은 여기 두지 않고 tools/health/test/budget-table.test.mjs(비차단)에 둔다(cto 착수 판정 4c).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { budgetModel, budgetTableBlock, budgetTableHtml, checksOf, DEFAULT_BAND, dealSearchHref, headText, overBand, recoView, recoViews, relaxText, rowOrder } from "../scripts/budget-table.ts";
import { DISTRICT_SLUGS } from "../scripts/district-slugs.ts";
import { groupForPage } from "../scripts/page-assets.ts";
import { APARTMENT_FIELDS, CELL_FIELDS } from "../scripts/recommendation.ts";
import { isNoindex } from "../scripts/sitemap.ts";
import { PAGE_SOURCES } from "../scripts/updated-stamp.ts";
import { buildFixtureSite } from "./helpers/fixture-site.mjs";
import { SITE_DIR } from "./helpers/site-root.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const PAGE = "buy-by-budget.html";

// ---- 고정 데이터 ----------------------------------------------------------------------------------------------------------------
// 칸 하나. 값은 만원. checks 는 빌더가 싣는 [코드, 값] 쌍이다.
const cell = (areaSqm, median, o = {}) => {
  const c = {
    areaSqm, n: 4, median, low: median - 1_000, high: median + 1_500, rawMedian: median - 200, unadjustedDeals: 1,
    extraCost: 1_700, totalCost: median + 1_700, loanCapGeneral: 29_000, loanCapFirstTime: 40_000, cashGeneral: median - 27_300, cashFirstTime: median - 38_300,
    lastAmount: median + 300, lastDate: "2026-10-02", lastFloor: 7, deals12m: 9, jeonseN: 2, sampleGrade: "partial", position: [["peers_n", 99]], checks: [["few_deals", 4]],
    ...o,
  };
  return CELL_FIELDS.map((f) => c[f]);
};
const apt = (id, name, dong, cells, aliases = []) => APARTMENT_FIELDS.map((f) => ({ id, name, dong, buildYear: 2001, households: null, aliases, cells }[f]));

/** 25구 파일. extra 로 구별 내용을 덮는다. 기본은 칸 0개·뺀 칸 0개다. */
function files(extra = {}) {
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
const FIXTURE = {
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

const views = () => recoViews(files(FIXTURE));
const model = (o) => budgetModel(views(), o);
const textOf = (html) => html.replace(/<[^>]+>/g, " ");
// 화면에 나오는 글자: 태그 밖 글자 + 화면용 속성(data-*-en·aria-label·title·placeholder). 스크립트·head 는 뺀다(장 안 JS 의 "return" 같은 코드 낱말은 화면 글자가 아니다).
const shown = (html) =>
  `${textOf(html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<script[\s\S]*?<\/script>/g, ""))} ${[...html.matchAll(/\s(?:data-[\w-]*en|aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]).join(" ")}`;

// 금지어(po 명세 ③ 「금지어(시험, clo 확정)」 + clo PR #878 판정이 더한 것). 영어 "top" 은 ③ 의 열 머리 "Costs on top of price" 만 걷어 낸 뒤 검사한다(clo 판정).
const BANNED_KO = ["점수", "순위", "추천", "1위", "베스트", "TOP", "유망", "오를", "상승", "여력", "수익", "투자", "저평가", "기회", "지금 사야", "후보", "보장", "적기", "저렴", "급매", "가성비"];
const BANNED_EN = [/\bscore/i, /\brank/i, /\brecommend/i, /\bbest\b/i, /\btop\b/i, /\bupside/i, /\bundervalued/i, /\binvest/i, /\breturns?\b/i, /\bopportunit/i, /\bguarantee/i, /\bbargain/i, /\bcheap/i];
function assertNoBanned(text, where) {
  for (const w of BANNED_KO) assert.ok(!text.includes(w), `${where}: 「${w}」`);
  assert.doesNotMatch(text, /\d+\s*위(?![가-힣])/, `${where}: N위`);
  assert.doesNotMatch(text, /번째/, `${where}: 순번`);
  const en = text.replace(/\bon top of\b/gi, "");
  for (const re of BANNED_EN) assert.doesNotMatch(en, re, `${where}: ${re}`);
}

// ---- (1) 계산 --------------------------------------------------------------------------------------------------------------

test("recoView: 맞는 파일은 이름 붙은 줄로, schemaVersion·필드 이름·값 모양이 다르면 던지지 않고 null (cto 4a)", () => {
  const [one] = files(FIXTURE).filter((f) => f.district === "마포구");
  const v = recoView(one);
  assert.equal(v.district, "마포구");
  assert.deepEqual(v.apartments[0].aliases, ["신촌숲아이파크"], "별칭은 위치 키의 끝 이름");
  assert.equal(v.apartments[0].cells[1].median, 79_000);
  // 필드 순서가 바뀌어도 머리의 이름 목록으로 찾는다.
  const reordered = { ...one, cellFields: [...CELL_FIELDS].reverse(), apartments: one.apartments.map((a) => a.map((x, i) => (APARTMENT_FIELDS[i] === "cells" ? x.map((c) => [...c].reverse()) : x))) };
  assert.equal(recoView(reordered).apartments[0].cells[1].median, 79_000);
  for (const [why, bad] of [
    ["schemaVersion 2", { ...one, schemaVersion: 2 }],
    ["cellFields 에 median 없음", { ...one, cellFields: CELL_FIELDS.map((f) => (f === "median" ? "mid" : f)) }],
    ["apartmentFields 에 cells 없음", { ...one, apartmentFields: APARTMENT_FIELDS.filter((f) => f !== "cells") }],
    ["값이 글자", { ...one, apartments: [apt("x", "x", "x", [cell(59, "7억")])] }],
    ["뺀 칸 면적대 모름", { ...one, excluded: [{ band: 7, area: "small", thin: 1 }] }],
    ["asOf 없음", { ...one, asOf: null }],
    ["파일 아님", "x"],
  ]) assert.equal(recoView(bad), null, why);
});

test("recoViews·budgetTableBlock: 한 구라도 없거나 깨지면 null 이고 던지지 않는다 - 빈 자리를 그대로 둔다 (cto 4a)", () => {
  assert.equal(views().length, 25);
  const all = files(FIXTURE);
  assert.equal(recoViews(all.slice(1)), null, "24구");
  assert.equal(recoViews([...all.slice(1), all[1]]), null, "같은 구 둘");
  assert.equal(recoViews(all.map((f, i) => (i === 3 ? null : f))), null, "한 구 파일 없음(readJson null)");
  for (const input of [undefined, null, [], [null], "x", all.map(() => ({}))]) assert.equal(budgetTableBlock(input), null);
  assert.match(budgetTableBlock(all), /^<div data-lang="ko"[^>]*>[\s\S]*<div data-lang="en" lang="en">/);
});

test("머리: 조건에 드는 수 = 값을 낸 수 + 뺀 수, 뺀 이유·거래 창·지수 달 (78행 ①, po ③ 문구)", () => {
  const m = model();
  assert.equal(m.band, DEFAULT_BAND);
  assert.equal(m.M, 6, "노원 4 + 마포 2 (은평 8억대는 안 든다)");
  assert.equal(m.K, 12, "노원 5+2 + 마포 1 + 강남 4 (노원 9억대 3은 안 든다)");
  assert.equal(
    headText(m, "ko"),
    "7억대·전체 면적: 조건에 드는 단지·평형 18곳 — 값을 낸 곳 6, 뺀 곳 12(최근 183일 거래 3건 미만). 거래 2026-05-15~2026-11-14, 값은 2026년 8월 권역 지수 수준으로 고쳤습니다."
  );
  assert.equal(
    headText(m, "en"),
    "₩0.7B band, all sizes: 18 complex-size pairs match — 6 priced, 12 left out (fewer than 3 deals in 183 days). Deals 2026-05-15–2026-11-14, adjusted to the Aug 2026 regional index level."
  );
  // 계약 기준 창의 시작일을 함께 적는다(#872 결과 주의) - 「자료 기준」 끝날만 따로 쓰지 않는다.
  assert.ok(headText(m, "ko").includes("2026-05-15~"));
  assert.deepEqual(m.grid, [{ area: "under-60", M: 3, K: 1 }, { area: "60-85", M: 2, K: 5 }, { area: "over-85", M: 1, K: 6 }]);
  assert.equal(m.grid.reduce((s, g) => s + g.M, 0), m.M);
  assert.equal(m.grid.reduce((s, g) => s + g.K, 0), m.K);
});

test("자치구는 거르는 조건이 아니라 구별 건수로 묶는 축이다: 25구 모두 가나다순, 합이 머리와 같다", () => {
  const m = model();
  assert.equal(m.districts.length, 25);
  assert.deepEqual(m.districts.map((d) => d.name), Object.keys(DISTRICT_SLUGS).sort((a, b) => a.localeCompare(b, "ko")));
  assert.equal(m.districts.reduce((s, d) => s + d.M, 0), m.M);
  assert.equal(m.districts.reduce((s, d) => s + d.K, 0), m.K);
  assert.deepEqual(m.districts.find((d) => d.name === "강남구"), { name: "강남구", M: 0, K: 4 });
});

test("0곳이면 「면적대를 풀면 n곳」 - 서울 전체가 0일 때만 (78행 ①)", () => {
  // 9억대 60㎡ 미만: 값 낸 칸 0, 뺀 칸 3(노원) → 0곳이 아니다.
  assert.equal(model({ band: 9, area: "under-60" }).relax, null);
  // 9억대 85㎡ 초과: 0곳, 면적대를 풀면 9억대 전체 3곳.
  const m = model({ band: 9, area: "over-85" });
  assert.equal(m.M + m.K, 0);
  assert.equal(m.relax, 3);
  assert.equal(relaxText(m.relax, "ko"), "이 조건에 드는 곳이 없습니다. 면적대를 풀면 3곳입니다.");
  assert.ok(budgetTableHtml(m).includes("이 조건에 드는 곳이 없습니다. 면적대를 풀면 3곳입니다."));
  assert.ok(budgetTableHtml(m).includes("Nothing matches. Without the size filter, 3 match."));
  // 값대 전체가 0이면 풀 것이 없다 - 문장을 내지 않는다.
  assert.equal(model({ band: 30, area: "over-85" }).relax, null);
  assert.equal(model({ band: 30 }).relax, null, "전체 면적은 풀 면적대가 없다");
});

test("줄 순서는 단지명(localeCompare ko) → 동 → 면적 → id 하나뿐이다 (cpo 답 5)", () => {
  const r = (name, dong, areaSqm, id) => ({ apt: { name, dong, id }, cell: { areaSqm } });
  const rows = [r("나", "가동", 59, "b"), r("가", "나동", 84, "a"), r("가", "가동", 84, "c"), r("가", "가동", 59, "z"), r("가", "가동", 59, "y")];
  assert.deepEqual([...rows].sort(rowOrder).map((x) => `${x.apt.name}${x.apt.dong}${x.cell.areaSqm}${x.apt.id}`), ["가가동59y", "가가동59z", "가가동84c", "가나동84a", "나가동59b"]);
});

test("예시 줄: 값 낸 칸이 가장 많은 구, 면적대마다 첫 줄, 없는 면적대는 건너뛴다(≤3), 동률은 가나다 (cpo 답 6)", () => {
  const m = model();
  assert.equal(m.example.district, "노원구", "노원 4칸 > 마포 2칸");
  assert.deepEqual(m.example.rows.map((x) => `${x.apt.name}|${x.cell.areaSqm}`), ["가람|59.9", "건영 (상계동)|84.9", "가람|114.9"]);
  // 동률: 노원을 2칸으로 줄이면 마포와 같다 → 가나다로 노원(ㄴ) 이 마포(ㅁ)보다 앞.
  const tie = files({ ...FIXTURE, 노원구: { ...FIXTURE.노원구, apartments: FIXTURE.노원구.apartments.slice(0, 2) } });
  const t = budgetModel(recoViews(tie));
  assert.equal(t.example.district, "노원구");
  // 마포에는 85㎡ 초과 칸이 없다 → 두 줄만.
  const mapoOnly = files({ 마포구: FIXTURE.마포구 });
  const mm = budgetModel(recoViews(mapoOnly));
  assert.equal(mm.example.district, "마포구");
  assert.equal(mm.example.rows.length, 2);
  // 값 낸 칸이 서울에 하나도 없으면 예시 표가 없다.
  assert.equal(budgetModel(recoViews(files())).example, null);
});

test("확인할 것: 데이터 checks + over_band(브라우저와 같은 식), 「n일 전」은 데이터 값 (cto 조건 E)", () => {
  const c = { high: 80_000, checks: [["stale_deal", 120], ["reg_line", 15]] };
  assert.equal(overBand(c, 7), true, "8억 이상이면 7억대 위로 걸친다");
  assert.equal(overBand({ high: 79_999 }, 7), false);
  assert.deepEqual(checksOf(c, 7), [["stale_deal", 120], ["reg_line", 15], ["over_band", null]]);
  const html = budgetTableHtml(model());
  for (const s of ["마지막 거래 120일 전", "15억 대출 규제선 근처", "지난 거래 범위가 이 값대 위로 걸침", "거래 4건뿐", "Last deal 120 days ago", "Near the ₩1.5B loan-rule line", "Past deals reach above this band", "Only 4 deals"]) {
    assert.ok(html.includes(s), s);
  }
});

// ---- (1) 구운 글자 ---------------------------------------------------------------------------------------------------------

test("구운 보기: 금지어·「후보」·순번 0, 미래가치·균형 칸 없음, peers_n 열 없음 (완료 조건 4)", () => {
  for (const o of [{}, { band: 9, area: "over-85" }]) {
    const html = budgetTableHtml(model(o));
    assertNoBanned(shown(html), JSON.stringify(o));
    for (const w of ["미래가치", "균형", "Future value", "Balanced", "같은 값대·면적대 칸", "Same-band cells"]) assert.ok(!html.includes(w), w);
    assert.ok(!/peers_n|>99</.test(html), "peers_n 값이 실렸다");
  }
});

test("실거주는 데이터 status 가 바뀌어도 「검증 전」 한 줄 그대로다 (78행 ②)", () => {
  const on = files(FIXTURE).map((f) => ({ ...f, types: { ...f.types, living: { status: "on", reasons: [] } } }));
  const a = budgetTableBlock(files(FIXTURE));
  assert.equal(budgetTableBlock(on), a);
  assert.ok(a.includes("실거주 항목: 검증 전 — 역까지 거리와 세대수 값을 대조하고 있어 비워 둡니다."));
  assert.ok(a.includes("Day-to-day living: not yet verified — left blank while station-distance and household data are being checked."));
});

test("구운 예시 줄은 ≤3이고, 일반 값(생애최초 꺼짐)을 쓴다 (N6, cpo 답 3)", () => {
  const html = budgetTableHtml(model());
  const ko = html.slice(0, html.indexOf('<div data-lang="en"'));
  const table = ko.slice(ko.indexOf("예시(값을 낸 곳이 가장 많은 구의 가나다순 첫 줄)"));
  assert.equal((table.match(/<tr><td>/g) ?? []).length, 3);
  assert.ok(ko.includes("7억대 · 예시(값을 낸 곳이 가장 많은 구의 가나다순 첫 줄): 노원구"));
  assert.ok(ko.includes("7억대 · 자치구별 건수(거르는 조건이 아닙니다)"));
  assert.ok(ko.includes("2억 9,000만원"), "loanCapGeneral");
  assert.ok(!ko.includes("4억원"), "loanCapFirstTime(4억)이 실렸다");
});

test("값대×면적대 표는 뺀 곳이 있을 때만 (N6)", () => {
  assert.ok(budgetTableHtml(model()).includes("7억대 전용면적별 건수"));
  const none = budgetModel(recoViews(files({ 마포구: { ...FIXTURE.마포구, excluded: [] } })));
  assert.equal(none.K, 0);
  assert.ok(!budgetTableHtml(none).includes("전용면적별 건수"));
});

test("실거래 검색 링크: 구·단지·동만 싣고 값대·면적은 안 싣는다. 별칭이 있으면 별칭 이름 링크도, 「이름 (동)」은 동을 두 번 붙이지 않는다 (완료 조건 5, cto 5-(i))", () => {
  const html = budgetTableHtml(budgetModel(recoViews(files({ 마포구: FIXTURE.마포구 }))));
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
  assert.ok(hrefs.length > 0);
  for (const h of hrefs) {
    const u = new URL(h, "https://x/");
    assert.equal(u.pathname, "/deal-search.html", h);
    assert.deepEqual([...u.searchParams.keys()].filter((k) => !["district", "apt", "dong"].includes(k)), [], h);
  }
  const apts = hrefs.map((h) => new URL(h, "https://x/").searchParams.get("apt"));
  assert.ok(apts.includes("마포아이파크포레") && apts.includes("신촌숲아이파크"), "별칭 이름 링크");
  assert.ok(html.includes("신촌숲아이파크 →"));
  const nowon = budgetTableHtml(model());
  assert.ok(nowon.includes(dealSearchHref("노원구", "건영 (상계동)", "상계동").replaceAll("&", "&amp;")), "「이름 (동)」 그대로 카드 이름");
  assert.ok(nowon.includes(">건영 (상계동) · 2001년<"), "동이 두 번 붙었다");
  assert.ok(nowon.includes(">가람 (중계동) · 2001년<"));
});

// ---- (2) 틀 -----------------------------------------------------------------------------------------------------------------

const template = await readFile(path.join(repo, "docs", PAGE), "utf8");
const body = (html) => html.slice(html.indexOf("<body>"), html.indexOf("</body>"));

test("틀: noindex, 자리표시 하나, 빈 자리에는 JS 꺼짐 안내와 같은 값대 예산대 장 링크 (완료 조건 2, cto 4a)", () => {
  assert.ok(isNoindex(template));
  assert.equal(template.split("<!--prerender:budgetTable-->").length, 2);
  assert.equal(template.split("<!--/prerender:budgetTable-->").length, 2);
  const slot = template.match(/<!--prerender:budgetTable-->([\s\S]*?)<!--\/prerender:budgetTable-->/)[1];
  assert.ok(slot.includes("조건을 바꾸려면 자바스크립트가 필요합니다."));
  assert.ok(slot.includes("Changing conditions needs JavaScript."));
  assert.ok(slot.includes(`href="./budget-${DEFAULT_BAND}eok.html"`));
  assert.equal(groupForPage(PAGE), "budget", "content_group(cto 조건 G)");
  assert.deepEqual(PAGE_SOURCES[PAGE], ["reco"]);
});

test("틀: 폼 컨트롤에 name 0개, 장 안 해시 앵커는 공통 건너뛰기 링크 하나뿐, 주소를 건드리는 스크립트 0 (cto 조건 B, 완료 조건 5)", () => {
  const b = body(template);
  assert.equal((b.match(/<(?:input|select|textarea|button)\b[^>]*\sname=/g) ?? []).length, 0, "name 속성");
  assert.equal((b.match(/\sname=/g) ?? []).length, 0, "본문 어디에도 name 속성 0");
  // 사이트 공통 「본문 바로가기」(#content)만 있다 - 모든 장에 같은 것이 있고 이 장이 만든 앵커가 아니다.
  assert.deepEqual([...b.matchAll(/href="(#[^"]*)"/g)].map((m) => m[1]), ["#content"]);
  assert.equal((b.match(/<form\b/g) ?? []).length, 1, "폼은 사이트 검색 하나뿐(근거표 폼은 PR-B)");
  for (const b2 of b.match(/<button\b[^>]*>/g) ?? []) assert.match(b2, /type="button"/, b2);
  assert.doesNotMatch(b, /pushState|replaceState|location\s*(?:\.\w+\s*)?=(?!=)|location\.hash/, "주소를 바꾸는 코드");
  assert.ok(!/<script src="\.\/buy-by-budget|<script src="\.\/budget-table/.test(template), "장 전용 JS 는 PR-B");
});

test("틀: 화면 글자에 금지어·「후보」 0, 문구는 po ③ 그대로", () => {
  assertNoBanned(shown(template), PAGE);
  for (const s of [
    "<title>예산대로 보는 단지 근거표</title>",
    '<h1 id="page-title">예산대로 보는 단지 근거표</h1>',
    'title: "Complex evidence table by price band"',
    "값대와 면적대를 고르면 최근 183일 실거래로 값을 낸 단지·평형과, 거래가 모자라 뺀 곳을 자치구별로 셉니다. 줄은 가나다순이며 어느 곳을 고르라는 뜻이 아닙니다.",
    "이 표는 어느 단지가 더 낫다거나 값이 오른다고 말하지 않습니다. 국토교통부에 신고된 실거래로 센 값이며 매물이 아닙니다. 대출 상한과 필요 현금은 집이 없는 사람이 한 채를 산다고 가정해 규정으로 셈한 추정입니다. 기본은 생애최초가 아닌 일반 조건입니다. 실제로 빌릴 수 있는 돈은 소득(DSR)과 금융회사 심사에 따라 이보다 적을 수 있습니다.",
    "What you can actually borrow depends on income (DSR) and lender review and may be lower.",
    "This table does not say which complex is better or that prices will rise.",
  ]) assert.ok(template.includes(s), s);
});

test("고정 데이터 사이트: reco 25구가 없으면(고정 데이터는 5개뿐) 프리렌더가 실패하지 않고 빈 자리를 그대로 둔다 (cto 4a)", () => {
  const site = buildFixtureSite({ steps: ["scripts/prerender.ts"] });
  try {
    const html = site.read(`docs/${PAGE}`);
    const slot = html.match(/<!--prerender:budgetTable-->([\s\S]*?)<!--\/prerender:budgetTable-->/)[1];
    assert.equal(slot, template.match(/<!--prerender:budgetTable-->([\s\S]*?)<!--\/prerender:budgetTable-->/)[1]);
  } finally {
    site.cleanup();
  }
});

// ---- (3) 나가는 장(build/site) - 구조만 ------------------------------------------------------------------------------------

test("나가는 장: buy-by-budget 1장, noindex, sitemap.xml 에 0회, 자리표시가 남아 있다 (완료 조건 2)", async () => {
  const pages = (await readdir(SITE_DIR)).filter((f) => /^buy-by-budget.*\.html$/.test(f));
  assert.deepEqual(pages, [PAGE]);
  const html = await readFile(path.join(SITE_DIR, PAGE), "utf8");
  assert.ok(isNoindex(html));
  assert.equal((await readFile(path.join(SITE_DIR, "sitemap.xml"), "utf8")).split("buy-by-budget").length - 1, 0);
  const slot = html.match(/<!--prerender:budgetTable-->([\s\S]*?)<!--\/prerender:budgetTable-->/)?.[1];
  assert.ok(slot, "자리표시가 없다");
  // 구운 보기이거나(데이터가 맞을 때) 틀의 빈 자리 그대로다(cto 4a) - 어느 쪽인지는 여기서 묻지 않는다(그날 데이터에 기대지 않게, 실데이터 단언은 tools/health).
  assert.ok(slot.includes('id="bt-head-ko"') || slot.includes("조건을 바꾸려면 자바스크립트가 필요합니다."), "자리가 비었다");
  assert.ok(html.includes('<meta name="site-group" content="budget">'));
});
