/**
 * 근거표 장(docs/buy-by-budget.html)의 구운 기본 보기 (#871 PR-A). 순수 함수만 둔다 - prerender.ts 가 reco-<구>.json 25개를 읽어 넘기고,
 * PR-B 의 건수 파일(렌더 단계 파생)도 같은 함수로 센다(cto 착수 판정 1: 머리·구 건수의 드리프트를 구조로 0 으로).
 *
 * 지키는 선(DIRECTION 78행, #816·#856): 점수·순위·「추천」 글자 0, 같은 값대 안의 순번 0, 미래가치·균형 칸 없음, 실거주는 「검증 전」 고정.
 * 줄 순서는 단지명(localeCompare ko) → 동 → 면적 → id 하나뿐이다(cpo 답 5). 그 순서는 「어느 곳을 고르라」는 뜻이 아니라 찾기 쉬운 순서다.
 *
 * 데이터 모양이 다르면 던지지 않고 null 을 돌린다(cto 착수 판정 4a). prerender 는 null 이면 틀의 빈 자리(JS 꺼짐 안내 + 18장 링크)를 그대로 둔다 -
 * 근거표 한 장 때문에 배포 전체가 멈추지 않게.
 */

import { DISTRICT_SLUGS, districtNameEn } from "./district-slugs.ts";
import { escapeHtml } from "./html-escape.ts";
import { formatEok } from "./realestate-format.ts";
import { areaBand, GRADE, priceBand, SCHEMA_VERSION } from "./recommendation.ts";

/**
 * 구운 보기의 조건. 상수다 - 「오늘 값 낸 칸이 가장 많은 값대」를 매일 다시 고르면 N2 측정이 흔들린다(po 명세 ①, cpo 답 2).
 * 생애최초는 기본 꺼짐이라 구운 보기는 일반 값(loanCapGeneral·cashGeneral)을 쓴다(cpo 답 3).
 */
export const DEFAULT_BAND = 7;
export const AREAS = ["under-60", "60-85", "over-85"];

/** 장이 읽는 칸 이름. 파일 머리의 필드 목록에서 위치를 찾는다 - 코드에 위치를 박지 않으므로 필드 순서가 바뀌어도 맞고, 이름이 빠지면 null 이다. */
const APT_NEED = ["id", "name", "dong", "buildYear", "aliases", "cells"];
const CELL_NEED = ["areaSqm", "n", "median", "low", "high", "rawMedian", "extraCost", "totalCost", "loanCapGeneral", "cashGeneral", "lastAmount", "lastDate", "lastFloor", "deals12m", "sampleGrade", "checks"];
const CELL_NUMBERS = ["areaSqm", "n", "median", "low", "high", "rawMedian", "extraCost", "totalCost", "loanCapGeneral", "cashGeneral", "lastAmount", "deals12m"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isText = (v) => typeof v === "string" && v !== "";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** 줄 하나를 이름 붙은 객체로. 모양이 틀리면 null. */
function rowOf(row, at, need) {
  if (!Array.isArray(row)) return null;
  return Object.fromEntries(need.map((name) => [name, row[at[name]]]));
}

/**
 * reco-<구>.json 하나를 장이 쓰는 모양으로 바꾼다. schemaVersion·필드 이름·값 모양 중 하나라도 다르면 null(던지지 않는다).
 * 별칭(aliases)은 위치 키("구코드|동|지번|이름")의 끝 이름만 남긴다 - 그 이름으로도 실거래 검색 카드가 풀리게 링크를 하나 더 낸다(cto 5-(i)).
 */
export function recoView(file) {
  if (!file || typeof file !== "object" || file.schemaVersion !== SCHEMA_VERSION) return null;
  const { asOf } = file;
  if (!isText(file.district) || !isNum(file.windowDays) || !asOf || !DATE.test(asOf.deals ?? "") || !DATE.test(asOf.windowStart ?? "") || !/^\d{6}$/.test(asOf.indexRef ?? "")) return null;
  if (![file.apartmentFields, file.cellFields, file.apartments, file.excluded].every(Array.isArray)) return null;
  const aptAt = Object.fromEntries(APT_NEED.map((n) => [n, file.apartmentFields.indexOf(n)]));
  const cellAt = Object.fromEntries(CELL_NEED.map((n) => [n, file.cellFields.indexOf(n)]));
  if (Object.values(aptAt).includes(-1) || Object.values(cellAt).includes(-1)) return null;
  const apartments = [];
  for (const raw of file.apartments) {
    const apt = rowOf(raw, aptAt, APT_NEED);
    if (!apt || !isText(apt.id) || !isText(apt.name) || typeof apt.dong !== "string" || !Array.isArray(apt.aliases) || !Array.isArray(apt.cells)) return null;
    const cells = [];
    for (const rawCell of apt.cells) {
      const cell = rowOf(rawCell, cellAt, CELL_NEED);
      if (!cell || CELL_NUMBERS.some((n) => !isNum(cell[n])) || !DATE.test(cell.lastDate ?? "") || !Array.isArray(cell.checks)) return null;
      cells.push(cell);
    }
    const aliases = [...new Set(apt.aliases.map((key) => String(key).split("|").at(-1).trim()))].filter((name) => name && name !== apt.name);
    apartments.push({ id: apt.id, name: apt.name, dong: apt.dong, buildYear: isNum(apt.buildYear) ? apt.buildYear : null, aliases, cells });
  }
  for (const e of file.excluded) if (!e || !isNum(e.band) || !AREAS.includes(e.area) || !isNum(e.thin)) return null;
  return { district: file.district, windowDays: file.windowDays, asOf: { deals: asOf.deals, windowStart: asOf.windowStart, indexRef: asOf.indexRef }, apartments, excluded: file.excluded };
}

/** 25구 파일 전부. 한 구라도 없거나 모양이 다르면 null - 서울 건수가 빠진 구만큼 틀린 채로 나가지 않게. */
export function recoViews(files) {
  if (!Array.isArray(files) || files.length !== Object.keys(DISTRICT_SLUGS).length) return null;
  const views = files.map(recoView);
  if (views.includes(null)) return null;
  const names = new Set(views.map((v) => v.district));
  if (names.size !== views.length || ![...names].every((n) => n in DISTRICT_SLUGS)) return null;
  return views;
}

/** 줄 순서(cpo 답 5): 단지명 → 동 → 면적 → id. 정렬 조작은 없다. */
export const rowOrder = (a, b) =>
  a.apt.name.localeCompare(b.apt.name, "ko") || a.apt.dong.localeCompare(b.apt.dong, "ko") || a.cell.areaSqm - b.cell.areaSqm || (a.apt.id < b.apt.id ? -1 : a.apt.id > b.apt.id ? 1 : 0);

/** 「지난 거래 범위가 이 값대 위로 걸침」. 브라우저(PR-B)도 이 식을 그대로 쓰고 시험이 같은 고정 데이터로 맞댄다(cto 조건 E). */
export const overBand = (cell, band) => cell.high >= (band + 1) * 10_000;

const inBand = (cell, band, area) => priceBand(cell.median) === band && (area === "all" || areaBand(cell.areaSqm) === area);

/** 한 구의 값 낸 칸(M)·뺀 칸(K). 뺀 칸은 빌더가 값대×면적대로 이미 센 것(excluded)을 더한다. */
function countOf(view, band, area) {
  let M = 0;
  for (const apt of view.apartments) for (const cell of apt.cells) if (inBand(cell, band, area)) M++;
  const K = view.excluded.filter((e) => e.band === band && (area === "all" || e.area === area)).reduce((s, e) => s + e.thin, 0);
  return { M, K };
}

/**
 * 조건 하나의 머리·구별 건수·면적대 표·예시 줄. views 는 recoViews 의 결과.
 * 예시 줄(cpo 답 6, 측정 전 잠금): 이 값대·전체 면적에서 값 낸 칸이 가장 많은 구(동률이면 가나다), 그 구에서 면적대마다 줄 순서의 첫 줄, 없는 면적대는 건너뛴다(≤3).
 */
export function budgetModel(views, { band = DEFAULT_BAND, area = "all" } = {}) {
  const districts = views
    .map((v) => ({ name: v.district, ...countOf(v, band, area) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const M = districts.reduce((s, d) => s + d.M, 0);
  const K = districts.reduce((s, d) => s + d.K, 0);
  const grid = AREAS.map((a) => {
    const c = views.map((v) => countOf(v, band, a));
    return { area: a, M: c.reduce((s, x) => s + x.M, 0), K: c.reduce((s, x) => s + x.K, 0) };
  });
  // 면적대를 풀면 몇 곳인지는 서울 전체가 0일 때만 말한다(po 명세 ①). 자치구는 거르는 조건이 아니라 이 수에 들어가지 않는다.
  const all = grid.reduce((s, g) => s + g.M + g.K, 0);
  const relax = M + K === 0 && area !== "all" && all > 0 ? all : null;
  const priced = views.map((v) => ({ view: v, M: countOf(v, band, "all").M })).filter((x) => x.M > 0);
  priced.sort((a, b) => b.M - a.M || a.view.district.localeCompare(b.view.district, "ko"));
  const pick = priced[0]?.view ?? null;
  const rows = pick
    ? pick.apartments.flatMap((apt) => apt.cells.filter((cell) => inBand(cell, band, "all")).map((cell) => ({ apt, cell }))).sort(rowOrder)
    : [];
  const examples = AREAS.map((a) => rows.find((r) => areaBand(r.cell.areaSqm) === a)).filter(Boolean);
  const ends = [...new Set(views.map((v) => v.asOf.deals))].sort();
  const starts = [...new Set(views.map((v) => v.asOf.windowStart))].sort();
  const refs = [...new Set(views.map((v) => v.asOf.indexRef))].sort();
  return {
    band,
    area,
    M,
    K,
    relax,
    districts,
    grid,
    windowDays: views[0].windowDays,
    // 구마다 자료 날짜가 다르면 그 구 줄에 그 구의 마지막 날을 적는다(po 명세 ① 실패 상태). 머리는 가장 이른 시작~가장 늦은 끝이다.
    asOf: { start: starts[0], end: ends.at(-1), indexRef: refs.at(-1), mixed: ends.length > 1 },
    deals: Object.fromEntries(views.map((v) => [v.district, v.asOf.deals])),
    example: pick ? { district: pick.district, rows: examples } : null,
  };
}

// ---- 글자 -------------------------------------------------------------------------------------------------------------------
// 문장은 po 명세 ③ 그대로다(clo 대조는 PR 단계). ③ 에 없는 짧은 이름(면적대 영어·표 머리 몇 개)은 PR 본문 「판단 요청」에 적어 clo 에게 넘긴다.

const AREA_LABEL = {
  ko: { all: "전체 면적", "under-60": "60㎡ 미만", "60-85": "60~85㎡", "over-85": "85㎡ 초과" },
  en: { all: "all sizes", "under-60": "under 60㎡", "60-85": "60–85㎡", "over-85": "over 85㎡" },
};
const bandLabel = (band, lang) => (lang === "en" ? `₩${band / 10}B band` : `${band}억대`);
const monthLabel = (ref, lang) => {
  const [y, m] = [ref.slice(0, 4), Number(ref.slice(4))];
  return lang === "en" ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}` : `${y}년 ${m}월`;
};
const num = (n) => n.toLocaleString("ko-KR");
const money = (v, lang) => escapeHtml(formatEok(v, lang));
const areaText = (sqm) => `${sqm}㎡`;

/** 결과 머리(DIRECTION 78행 ①): 조건에 드는 수·값을 낸 수·뺀 수와 뺀 이유, 거래 창과 보정 지수 달. */
export function headText(model, lang) {
  const { band, area, M, K, windowDays, asOf } = model;
  const min = GRADE.minDeals;
  if (lang === "en") {
    return `${bandLabel(band, "en")}, ${AREA_LABEL.en[area]}: ${num(M + K)} complex-size pairs match — ${num(M)} priced, ${num(K)} left out (fewer than ${min} deals in ${windowDays} days). Deals ${asOf.start}–${asOf.end}, adjusted to the ${monthLabel(asOf.indexRef, "en")} regional index level.`;
  }
  return `${bandLabel(band, "ko")}·${AREA_LABEL.ko[area]}: 조건에 드는 단지·평형 ${num(M + K)}곳 — 값을 낸 곳 ${num(M)}, 뺀 곳 ${num(K)}(최근 ${windowDays}일 거래 ${min}건 미만). 거래 ${asOf.start}~${asOf.end}, 값은 ${monthLabel(asOf.indexRef, "ko")} 권역 지수 수준으로 고쳤습니다.`;
}

export const relaxText = (n, lang) => (lang === "en" ? `Nothing matches. Without the size filter, ${num(n)} match.` : `이 조건에 드는 곳이 없습니다. 면적대를 풀면 ${num(n)}곳입니다.`);

const LEFT_OUT = {
  ko: (days, min) => `뺀 곳은 최근 ${days}일 그 단지·평형 거래가 ${min}건 미만이라 값을 내지 않은 곳입니다.`,
  en: (days, min) => `Left out: fewer than ${min} deals for that complex and size in the last ${days} days, so no value is shown.`,
};
const LIVING = {
  ko: "실거주 항목: 검증 전 — 역까지 거리와 세대수 값을 대조하고 있어 비워 둡니다.",
  en: "Day-to-day living: not yet verified — left blank while station-distance and household data are being checked.",
};
const WORDS = {
  ko: {
    district: "자치구",
    priced: "값을 낸 곳",
    left: "뺀 곳",
    area: "전용면적",
    // 표 이름에는 값대를 앞에 붙인다 - 나가는 장의 caption 은 숫자를 품어야 한다(test/accessibility.test.mjs, 반복 문장 방지).
    gridCaption: (band) => `${bandLabel(band, "ko")} 전용면적별 건수`,
    districtCaption: (band) => `${bandLabel(band, "ko")} · 자치구별 건수(거르는 조건이 아닙니다)`,
    exampleCaption: (band, d) => `${bandLabel(band, "ko")} · 예시(값을 낸 곳이 가장 많은 구의 가나다순 첫 줄): ${d}`,
    cols: ["단지(동)·준공", "전용", "값(지난 거래 범위, 건수)", "마지막 거래", "매매가 위에 드는 돈", "대출 상한(규정 추정)", "필요 현금(이 가정)", "표본", "확인할 것"],
    built: (y) => `${y}년`,
    range: (lo, hi, n) => `지난 거래 ${lo}~${hi}, ${n}건`,
    raw: (v) => `보정 전 ${v}`,
    last: (amount, date, floor) => `${amount} · ${date} · ${floor}층`,
    total: (v) => `합계 ${v}`,
    deals12m: (n) => `12개월 ${n}건`,
    grade: { enough: "표본 충분(5건 이상·90일 안)", partial: "표본 부분" },
    checks: {
      few_deals: (n) => `거래 ${n}건뿐`,
      stale_deal: (d) => `마지막 거래 ${d}일 전`,
      reg_line: (l) => `${l}억 대출 규제선 근처`,
      over_band: () => "지난 거래 범위가 이 값대 위로 걸침",
    },
    link: "거래 목록·비교·관심 단지 →",
  },
  en: {
    district: "District",
    priced: "Priced",
    left: "Left out",
    area: "Floor area",
    gridCaption: (band) => `${bandLabel(band, "en")} · Counts by floor area`,
    districtCaption: (band) => `${bandLabel(band, "en")} · Counts by district (not a filter)`,
    exampleCaption: (band, d) => `${bandLabel(band, "en")} · Examples (first rows, alphabetical, from the district with the most priced pairs): ${d}`,
    cols: ["Complex (dong), built", "Area", "Value (past range, deals)", "Last deal", "Costs on top of price", "Loan cap (rule estimate)", "Cash needed (these assumptions)", "Sample", "Check"],
    built: (y) => `${y}`,
    range: (lo, hi, n) => `past ${lo}–${hi}, ${n} deals`,
    raw: (v) => `unadjusted ${v}`,
    last: (amount, date, floor) => `${amount} · ${date} · floor ${floor}`,
    total: (v) => `total ${v}`,
    deals12m: (n) => `${n} deals in 12 months`,
    grade: { enough: "Enough deals (5+, within 90 days)", partial: "Partial sample" },
    checks: {
      few_deals: (n) => `Only ${n} deals`,
      stale_deal: (d) => `Last deal ${d} days ago`,
      reg_line: (l) => `Near the ₩${l / 10}B loan-rule line`,
      over_band: () => "Past deals reach above this band",
    },
    link: "Deals, compare, watchlist →",
  },
};

/** 실거래 검색 카드 링크(#730·#732 재사용). 단지 정체(구·단지·동)만 싣고 값대·면적은 싣지 않는다(완료 조건 5). */
export const dealSearchHref = (district, apt, dong) =>
  `./deal-search.html?district=${encodeURIComponent(district)}&apt=${encodeURIComponent(apt)}${dong ? `&dong=${encodeURIComponent(dong)}` : ""}`;

/** 확인할 것: 데이터의 checks(few_deals·stale_deal·reg_line) + 입력에 달린 over_band. 「{d}일 전」은 데이터 값이고 시계를 읽지 않는다(cto 조건 E). */
export function checksOf(cell, band) {
  const list = cell.checks.filter((c) => Array.isArray(c) && c[0] in WORDS.ko.checks && c[0] !== "over_band").map(([code, value]) => [code, value]);
  if (overBand(cell, band)) list.push(["over_band", null]);
  return list;
}

function exampleRowHtml({ apt, cell }, district, band, lang) {
  const w = WORDS[lang];
  // 「이름 (동)」은 빌더가 같은 이름이 둘 이상인 구에서 이미 동을 붙인 이름이다(complexKey) - 동을 한 번 더 붙이지 않는다.
  const named = apt.name.endsWith(`(${apt.dong})`) || !apt.dong ? apt.name : `${apt.name} (${apt.dong})`;
  const built = apt.buildYear ? ` · ${w.built(apt.buildYear)}` : "";
  const links = [apt.name, ...apt.aliases].map((name, i) => `<a href="${escapeHtml(dealSearchHref(district, name, apt.dong))}">${i ? `${escapeHtml(name)} →` : w.link}</a>`).join(" · ");
  const checks = checksOf(cell, band).map(([code, value]) => w.checks[code](value)).join(" · ") || "-";
  const td = [
    `${escapeHtml(named)}${built}<br><small>${links}</small>`,
    areaText(cell.areaSqm),
    `${money(cell.median, lang)}<br><small>${w.range(money(cell.low, lang), money(cell.high, lang), num(cell.n))} · ${w.raw(money(cell.rawMedian, lang))}</small>`,
    w.last(money(cell.lastAmount, lang), cell.lastDate, cell.lastFloor),
    `${money(cell.extraCost, lang)}<br><small>${w.total(money(cell.totalCost, lang))}</small>`,
    money(cell.loanCapGeneral, lang),
    money(cell.cashGeneral, lang),
    `${w.grade[cell.sampleGrade] ?? "-"}<br><small>${w.deals12m(num(cell.deals12m))}</small>`,
    escapeHtml(checks),
  ];
  return `<tr>${td.map((t) => `<td>${t}</td>`).join("")}</tr>`;
}

function blockHtml(model, lang) {
  const w = WORDS[lang];
  const en = lang === "en" ? ' lang="en"' : "";
  const name = (d) => (lang === "en" ? districtNameEn(d) : d);
  const out = [];
  out.push(`<p class="lead" id="bt-head-${lang}">${escapeHtml(headText(model, lang))}</p>`);
  if (model.relax != null) out.push(`<p class="content-notice">${escapeHtml(relaxText(model.relax, lang))}</p>`);
  // 값대×면적대 표는 뺀 곳이 있을 때만(N6) - 뺀 곳이 0이면 머리 한 줄이 다 말한다.
  if (model.K > 0) {
    const rows = model.grid.map((g) => `<tr><th>${AREA_LABEL[lang][g.area]}</th><td>${num(g.M)}</td><td>${num(g.K)}</td></tr>`).join("");
    out.push(`<div class="table-scroll"><table class="rate-table"${en}><caption>${escapeHtml(w.gridCaption(model.band))}</caption><thead><tr><th>${w.area}</th><th>${w.priced}</th><th>${w.left}</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }
  out.push(`<p>${escapeHtml(LEFT_OUT[lang](model.windowDays, GRADE.minDeals))}</p>`);
  const late = (d) => (model.asOf.mixed && model.deals[d] !== model.asOf.end ? ` <small>~${model.deals[d]}</small>` : "");
  const drows = model.districts.map((d) => `<tr><th>${escapeHtml(name(d.name))}${late(d.name)}</th><td>${num(d.M)}</td><td>${num(d.K)}</td></tr>`).join("");
  out.push(`<div class="table-scroll"><table class="rate-table"${en}><caption>${escapeHtml(w.districtCaption(model.band))}</caption><thead><tr><th>${w.district}</th><th>${w.priced}</th><th>${w.left}</th></tr></thead><tbody>${drows}</tbody></table></div>`);
  if (model.example?.rows.length) {
    const { district, rows } = model.example;
    const body = rows.map((r) => exampleRowHtml(r, district, model.band, lang)).join("");
    out.push(`<div class="table-scroll"><table class="rate-table"${en}><caption>${escapeHtml(w.exampleCaption(model.band, name(district)))}</caption><thead><tr>${w.cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`);
  }
  out.push(`<p class="content-notice">${LIVING[lang]}</p>`);
  return `<div data-lang="${lang}"${lang === "ko" ? ' class="on"' : en}>${out.join("")}</div>`;
}

/** 구운 기본 보기(N6) 두 언어. 언어 전환은 틀의 인라인 스크립트가 [data-lang] 의 on 만 바꾼다. */
export function budgetTableHtml(model) {
  return `${blockHtml(model, "ko")}${blockHtml(model, "en")}`;
}

/** prerender 의 입구: 25구 파일 → 구운 HTML, 모양이 하나라도 다르면 null(빈 자리를 둔다). 계산 중 예외도 null 이다(cto 4a). */
export function budgetTableBlock(files) {
  try {
    const views = recoViews(files);
    return views ? budgetTableHtml(budgetModel(views)) : null;
  } catch {
    return null;
  }
}
