import { readFile } from "node:fs/promises";
import path from "node:path";
import { accessibleTables } from "./table-a11y.ts";
import { fragment } from "./renderer.mjs";
import { createWriteSet } from "./render-writes.ts";
import { INDEX_NEWS, indexNewsItems } from "./news-items.ts";
import { escapeHtml } from "./html-escape.ts";
import { FALLBACK_NOTE_KO, hasFallback } from "./summary-note.ts";
import { SUMMARY_CATEGORIES_LABEL_KO, SUMMARY_HIGHLIGHTS_LABEL_KO, summaryMetaKo } from "./summary-box.ts";
import { linksBlockHtml, slugLinksHtml } from "./district-links.ts";
import {
  CONVERSION_BAND,
  cancelDistricts,
  cancelMonths,
  conversionTable,
  floorDistricts,
  renewalDistricts,
  renewalWolseDistricts,
} from "./district-tables.ts";
import { RATES_ROWS, isSavingCategory, netInterestText, rate, rateRange, selectRateRows } from "./rates-table.ts";
import { BUDGET_PAGES } from "./budget-pages.ts";
import { budgetFactSentences } from "./budget-facts.ts";
import { DISTRICT_PAGES } from "./district-slugs.ts";
import { districtSentences } from "./district-summary.ts";
import { factSentences } from "./district-facts.ts";
import { renewalSentences } from "./renewal-facts.ts";
import { BUDGET_MORE_LINKS, CANDIDATE_LIST, bodyShape, budgetAnswers, budgetBandLabel, budgetRuleHref, candidatesShape, capNote, costsNote, dealShape, loanNote, minCashNote, policyNote, whereText } from "./budget-fragments.mjs";
import { rateBridgeHtml } from "./rate-bridge.ts";
import { metricCell, topDistricts } from "./realestate-rows.ts";
import { headLabels, realestateTable } from "./realestate-table.mjs";
import { overallCards } from "./realestate-overall.mjs";
import { MIN_SAMPLE } from "./realestate-format.mjs";
import { stripInlineScriptComments } from "./strip-inline-comments.ts";

const root = path.resolve(import.meta.dirname, "..");
const INDEX_PATH = path.join(root, "docs/index.html");
const RATES_PATH = path.join(root, "docs/rates.html");
const NEWS_PATH = path.join(root, "docs/news.html");
// 시세 장은 틀(scripts/)과 나가는 장(docs/)으로 갈라져 있다(#374, rates-template.html 과 같은 모양). 틀에는 "왜"를 마음껏 적고,
// 이 파일이 틀을 채운 뒤 인라인 스크립트의 주석을 떼어 docs/realestate.html 로 낸다. 두 빌더(build-realestate-pages·build-budget-pages)도
// 같은 틀을 읽는다. docs/realestate.html 은 생성물이라 손으로 고치지 않는다.
export const REALESTATE_TEMPLATE_PATH = path.join(root, "scripts/realestate-template.html");
const REALESTATE_PATH = path.join(root, "docs/realestate.html");
const CONVERSION_PATH = path.join(root, "docs/jeonse-vs-wolse.html");
const CANCELLATION_PATH = path.join(root, "docs/cancelled-deals.html");
const RENEWAL_PATH = path.join(root, "docs/renewal-vs-new.html");
const FLOOR_PATH = path.join(root, "docs/floor-gap.html");
const OUTLOOK_PATH = path.join(root, "docs/price-outlook.html");
const RECORD_PATH = path.join(root, "docs/record-high.html");
const SWITCH_PATH = path.join(root, "docs/switch-house.html");
const METHOD_PATH = path.join(root, "docs/method.html");
const DATA_DIR = path.join(root, "docs/data");

// 표본 문턱은 realestate-format.mjs의 것 하나다(예전엔 여기에도 하나 더 있었다). 이 모듈에서 import하던 쪽을 위해 다시 내보낸다.
export { MIN_SAMPLE };
// MAX_DISTRICTS(첫 화면에 그리는 자치구 수)는 칸·정렬 규칙과 함께 realestate-rows.mjs로 옮겼다(JSX 쪽 조각과 같이 쓴다, #241 PR 3).

// escapeHtml과 linksBlockHtml은 순수 모듈로 옮겼다(JSX 쪽 조각과 같이 쓴다, #241 PR 2). 다른 모듈이 여기서 import하던 이름은 그대로 둔다.
export { escapeHtml };

// 첫 화면 AI 요약 상자. index.html renderSummary 가 JSON 을 받아 그리는 것과 같은 마크업·구조·글이다(#352): 하이라이트 구획(있을 때) →
// 분류 라벨 + 줄 div → 검증 폴백 안내(#350) → `.summary-meta`. 예전엔 `<p><strong>분류</strong> 줄</p>` 목록을 구워서, 요약 JSON 이 오는 순간
// 스크립트가 상자를 다시 그려 +40.4px 자랐다. 스크립트가 거르지 않는 것은 여기서도 거르지 않는다(항목마다 글이 있는지 보지 않는다).
// 스크립트가 분류 없이 그리는 길(요약 글 한 덩이, plainSummaryHtml)은 굽지 않는다 - 그때는 null 이라 구운 자리를 건드리지 않는다.
function summaryHtmlLegacy(summary) {
  const categories = Array.isArray(summary?.categories) ? summary.categories : [];
  if (!categories.length) return null;
  const highlights = Array.isArray(summary?.highlights) ? summary.highlights : [];

  const highlightsHtml = highlights.length
    ? `<div class="summary-highlights">` +
      `<div class="summary-section-label">${SUMMARY_HIGHLIGHTS_LABEL_KO}</div>` +
      highlights
        .map(
          (h) =>
            `<div class="summary-highlight">` +
            `<a href="${escapeHtml(h.link)}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a>` +
            `<span class="summary-link-source"> · ${escapeHtml(h.source)}</span>` +
            `<div class="summary-highlight-text">${escapeHtml(h.textKo)}</div>` +
            `</div>`
        )
        .join("") +
      `</div>` +
      `<div class="summary-section-label">${SUMMARY_CATEGORIES_LABEL_KO}</div>`
    : "";

  return (
    highlightsHtml +
    categories
      .map(
        (c) =>
          `<div class="summary-category">` +
          `<div class="summary-category-label">${escapeHtml(c.name)}</div>` +
          `<div class="summary-category-line">${escapeHtml(c.lineKo)}</div>` +
          `</div>`
      )
      .join("") +
    // 검증 폴백이 있는 날의 안내 한 줄. renderSummary 와 같은 마크업·같은 자리(분류 줄 뒤)다(#350).
    (hasFallback(categories) ? `<div class="summary-fallback-note">${escapeHtml(FALLBACK_NOTE_KO)}</div>` : "") +
    `<span class="summary-meta">${escapeHtml(summaryMetaKo(summary))}</span>`
  );
}
export const summaryHtml = fragment("summaryHtml", summaryHtmlLegacy);

function marketHtmlLegacy(market) {
  if (!market) return null;
  const rows = [];

  // 코스피는 첫 화면에서 증시 뉴스 장으로 옮겼다(UIUX #56, newsKospiHtml).
  if (typeof market.usdKrw?.value === "number") {
    const change = market.usdKrw.change
      ? `<span title="전일 수집분 대비">${escapeHtml(market.usdKrw.change)}</span>`
      : "-";
    rows.push(["원/달러 환율", `${market.usdKrw.value.toFixed(2)}원`, change]);
  }
  if (market.baseRate?.value) {
    rows.push(["기준금리", `${escapeHtml(market.baseRate.value)}%`, escapeHtml(market.baseRate.effectiveFrom ?? "-")]);
  }

  if (!rows.length) return null;
  return rows
    .map(
      ([name, value, change]) =>
        `<tr><td>${name}</td><td data-label="값">${value}</td><td data-label="증감">${change}</td></tr>`
    )
    .join("");
}
export const marketHtml = fragment("marketHtml", marketHtmlLegacy);

// 칸이 어떤 모양인지(없음·표본 부족·값)와 값의 글자는 realestate-rows.mjs가 정하고, 여기서는 마크업만 입힌다.
// 표본 건수(count)는 숫자가 아니어도 그대로 적는다 - 이스케이프하지 않는 것도 예전 그대로다(건수는 숫자로만 들어온다).
const lowSampleText = (count) =>
  `<span class="low-sample" title="신고 ${count}건이라 평균을 내기엔 표본이 부족합니다">` +
  `표본 ${count}건</span>`;

const cellHtml = (kind, metric) => {
  const cell = metricCell(kind, metric);
  if (cell.type === "none") return "-";
  if (cell.type === "low") return lowSampleText(cell.count);
  const change = cell.change ? ` <span class="change">${cell.change.sign}${cell.change.text}</span>` : "";
  const count = cell.count ? ` <span class="count">${cell.count}</span>` : "";
  return `${cell.text}${change}${count}`;
};

function realestateHtmlLegacy(realestate) {
  if (!realestate?.overall) return null;

  const row = (name, data) =>
    `<tr><td>${escapeHtml(name)}</td>` +
    `<td data-label="매매">${cellHtml("sale", data.sale)}</td>` +
    `<td data-label="전세">${cellHtml("jeonse", data.jeonse)}</td>` +
    `<td data-label="월세">${cellHtml("wolse", data.wolse)}</td></tr>`;

  return [row("서울 전체", realestate.overall), ...topDistricts(realestate).map((d) => row(d.name, d))].join("");
}
export const realestateHtml = fragment("realestateHtml", realestateHtmlLegacy);

function newsContextHtmlLegacy(context) {
  if (!context?.length) return "";
  return (
    `<div class="news-context">` +
    context
      .map(
        (c) =>
          `<a class="context-chip" href="${escapeHtml(c.href)}">` +
          `<span class="context-label">${escapeHtml(c.label)}</span>` +
          `<span class="context-value">${escapeHtml(c.value)}</span>` +
          (c.note ? `<span class="context-note">${escapeHtml(c.note)}</span>` : "") +
          `</a>`
      )
      .join("") +
    `</div>`
  );
}
export const newsContextHtml = fragment("newsContextHtml", newsContextHtmlLegacy);

// 첫 화면 뉴스 선택 규칙은 news-items.mjs에 있다 - JSX 쪽(render/entry.jsx)이 같은 함수를 가져다 쓴다(#241). 호출자 호환으로 다시 내보낸다.
export { INDEX_NEWS, indexNewsItems };

function newsHtmlLegacy(news) {
  const all = news?.items ?? [];
  if (!all.length) return null;
  const items = indexNewsItems(all);
  const more = all.length > items.length ? `<li class="news-more"><a href="./news.html">뉴스 전체 ${all.length}건 보기 →</a></li>` : "";
  return items
    .map(
      (item) =>
        `<li class="news-item">` +
        `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>` +
        `<div class="news-meta">${escapeHtml(item.source ?? "")}</div>` +
        (item.preview ? `<div class="news-preview">${escapeHtml(item.preview)}</div>` : "") +
        newsContextHtml(item.context) +
        `</li>`
    )
    .join("") + more;
}
export const newsHtml = fragment("newsHtml", newsHtmlLegacy);

// budgetBandLabel·eokText는 순수 모듈 budget-fragments.mjs로 옮겼다(JSX 쪽 조각과 같이 쓴다, #243 PR A). budgetBandLabel은 아래 파일 끝에서 같은 이름으로 다시 내보낸다.
// PR B: 거래 한 줄(dealShape)·"어디로 가는가" 문장(whereText)·후보 단지 모양(candidatesShape)·본문 앞부분(bodyShape)·budgetWhen·CANDIDATE_LIST도 같은 모듈로 옮겼다.
// 여기에는 클래스·태그·data-prerendered·이스케이프(마크업)만 남는다.

function budgetDealHtml(deal) {
  const { place, spec, when, price } = dealShape(deal);
  return (
    `<li class="budget-deal">` +
    `<span class="place">${escapeHtml(place)}</span>` +
    `<span class="spec">${escapeHtml(spec)}</span>` +
    `<span class="when">${escapeHtml(when)}</span>` +
    `<span class="price">${escapeHtml(price)}</span>` +
    `</li>`
  );
}

/** 이 예산이 서울에서 어디로 가는가(문장은 budget-fragments.mjs의 whereText). 말할 것이 없으면 빈 문자열이다. */
function budgetWhereHtml(band) {
  const text = whereText(band);
  // data-prerendered: 화면이 요약을 다시 그릴 때 이 문단이 지워지지 않게(#43에서 발견 - 전에는 지워졌다).
  // 속성은 값 있는 꼴(="")로 쓴다 - React는 맨 속성을 못 내서 JSX 쌍둥이와 바이트가 같으려면 이 꼴이어야 한다(#259, DOM은 같다).
  return text ? `<p class="budget-where" data-prerendered="">${escapeHtml(text)}</p>` : "";
}

function budgetBodyHtmlLegacy(band, periodList, rates = null, mortgageSeries = null, complexFiles = null, capStats = null, policyCounts = null) {
  const shape = bodyShape(band, periodList);
  if (!shape) return null;

  // districts: 이름은 이스케이프하고 건수는 숫자 서식 글자다(이 줄은 이스케이프 없이 아래 템플릿에 끼운다).
  const districts = shape.districts.map((d) => `${escapeHtml(d.name)} ${d.count}`).join(" · ");

  // 순서: 거래 요약 → 한눈에(돈 네 줄) → 후보 단지 → 돈 문단(근거) → 다음 질문 → 거래 12줄(예시).
  // 후보가 "이 돈이면 어디"의 답이고 거래 12줄은 예시라 맨 뒤다(UIUX #43). 화면(realestate.html)은
  // 요약을 다시 그리고 data-prerendered 덩어리를 이 순서 그대로 붙인 뒤 거래 목록을 붙인다 - 둘이 같아야 한다.
  return (
    `<p class="budget-summary">${escapeHtml(shape.summary)}` +
    (shape.periods ? ` <span class="when">${escapeHtml(shape.periods)}</span>` : "") +
    `</p>` +
    (districts ? `<div class="budget-districts">거래가 많은 지역: ${districts}</div>` : "") +
    budgetWhereHtml(band) +
    budgetAnswersHtml(band, rates) +
    budgetCandidatesHtml(band, complexFiles) +
    budgetLoanHtml(band, rates, mortgageSeries) +
    budgetCostsHtml(band) +
    budgetMinCashHtml(band) +
    budgetCapHtml(band, capStats) +
    budgetPolicyHtml(band, policyCounts) +
    budgetMoreHtml() +
    `<ul class="budget-deals">${band.deals.map(budgetDealHtml).join("")}</ul>`
  );
}
export const budgetBodyHtml = fragment("budgetBodyHtml", budgetBodyHtmlLegacy);

/**
 * 예산대 장 맨 위의 "한눈에" — 아래 문단 넷의 답만 한 줄씩(UIUX #43). 숫자는 문단과 같은 함수에서 나온다
 * (min-cash·purchase-costs·mortgage·policy-loan). 숫자 하나만 덩그러니 두지 않고 무엇의 값인지 앞에 적는다.
 */
function budgetAnswersHtmlLegacy(band, rates = null) {
  const answers = budgetAnswers(band, rates);
  if (!answers) return "";
  const lines = answers.lines
    .map(
      ({ label, value, note, text }) =>
        `<li><span class="answer-label">${escapeHtml(label)}</span>` +
        `<strong class="answer-value${text ? " answer-text" : ""}">${escapeHtml(value)}</strong>` +
        (note ? `<span class="answer-note">${escapeHtml(note)}</span>` : "") +
        `</li>`
    )
    .join("");
  return (
    `<section class="budget-answers" data-prerendered="">` +
    `<h3>${escapeHtml(answers.heading)}</h3><ul>${lines}</ul>` +
    `<p class="answer-more">근거와 예외는 아래 문단의 링크(→)에 있습니다.</p></section>`
  );
}
export const budgetAnswersHtml = fragment("budgetAnswersHtml", budgetAnswersHtmlLegacy);

/**
 * 장마다 똑같던 규칙 문단을 옮겨 간 자리(method.html의 #budget-rules-*)로 가는 링크(#66).
 * 문단 끝에 붙어, 숫자만 남은 문단에서도 예외·원문 기준일이 한 번 눌러 닿는 거리에 있게 한다.
 * 주소(`./method.html#budget-rules-<id>`)는 순수 모듈의 budgetRuleHref가 정한다(JSX 쪽 링크와 같이 쓴다). 클래스·공백·이스케이프는 이 마크업의 몫이다.
 */
export const budgetRuleLink = (id, text) => ` <a class="budget-rule-link" href="${budgetRuleHref(id)}">${escapeHtml(text)}</a>`;

/** 예산을 정한 사람이 다음에 묻는 것들로 가는 길(PO 검토 #33 - 예산대에서 이 화면들로 가는 링크가 0개였다). */
function budgetMoreHtmlLegacy() {
  return (
    `<section class="budget-more-links" data-prerendered=""><h3>매물을 보러 가기 전에</h3><ul>` +
    BUDGET_MORE_LINKS.map(([href, text]) => `<li><a href="${href}">${escapeHtml(text)}</a></li>`).join("") +
    `</ul></section>`
  );
}
export const budgetMoreHtml = fragment("budgetMoreHtml", budgetMoreHtmlLegacy);

/** 최소 필요 현금(scripts/min-cash.mjs) - 소득과 무관한 대출 천장(LTV·구간 상한)으로 계산한다(#31). */
function budgetMinCashHtmlLegacy(band) {
  const note = minCashNote(band);
  return note
    ? `<p class="budget-loan budget-mincash" data-prerendered="">${escapeHtml(note.sentence)}${budgetRuleLink(note.link.id, note.link.text)}</p>`
    : "";
}
export const budgetMinCashHtml = fragment("budgetMinCashHtml", budgetMinCashHtmlLegacy);

/** 정책대출 가격선에 걸친 예산대(4~9억대)에만 붙는 한 줄(scripts/policy-loan.mjs). */
function budgetPolicyHtmlLegacy(band, policyCounts) {
  const note = policyNote(band, policyCounts);
  return note
    ? `<p class="budget-loan budget-policy" data-prerendered="">${escapeHtml(note.sentence)}${budgetRuleLink(note.link.id, note.link.text)}</p>`
    : "";
}
export const budgetPolicyHtml = fragment("budgetPolicyHtml", budgetPolicyHtmlLegacy);

/** 15억 경계에 걸친 예산대에만 붙는 주담대 상한 한 줄(scripts/loan-cap.mjs). */
function budgetCapHtmlLegacy(band, capStats) {
  const note = capNote(band, capStats);
  return note
    ? `<p class="budget-loan budget-cap" data-prerendered="">${escapeHtml(note.sentence)}${note.link ? budgetRuleLink(note.link.id, note.link.text) : ""}</p>`
    : "";
}
export const budgetCapHtml = fragment("budgetCapHtml", budgetCapHtmlLegacy);

// CANDIDATE_LIST(목록에 이름을 올리는 단지 수)는 순수 모듈로 옮겼다(#243 PR B). test/complex-candidates.test.mjs가 여기서 import하므로 같은 이름으로 다시 내보낸다.
export { CANDIDATE_LIST };

/**
 * 이 예산대에 드는 단지·평형(단지 후보). 고르는 규칙과 글자는 budget-fragments.mjs의 candidatesShape(JSX 쪽 조각과 같이 쓴다)이고, 여기에는 마크업만 남는다.
 */
function budgetCandidatesHtmlLegacy(band, complexFiles) {
  const shape = candidatesShape(band, complexFiles);
  if (!shape) return "";
  if (shape.empty !== undefined) {
    return `<section class="budget-candidates" data-prerendered=""><h3>이 예산대의 단지 후보</h3><p>${escapeHtml(shape.empty)}</p></section>`;
  }
  const list = shape.rows
    .map(
      (row) =>
        `<li class="budget-deal"><a class="apt" href="${escapeHtml(row.href)}">${escapeHtml(row.apt)}</a>` +
        `<span class="meta">${escapeHtml(row.facts)}</span>` +
        `<span class="amount">${escapeHtml(row.amount)}</span>` +
        `<span class="meta">${escapeHtml(row.meta)}</span></li>`
    )
    .join("");
  return (
    `<section class="budget-candidates" data-prerendered=""><h3>이 예산대의 단지 후보</h3>` +
    `<p>${escapeHtml(shape.intro)}</p>` +
    `<div class="budget-districts">${escapeHtml(shape.bandCounts)}</div>` +
    `<div class="budget-districts">${escapeHtml(shape.districts)}</div>` +
    `<ul class="budget-deals">${list}</ul>` +
    `<p class="budget-more"><a href="${escapeHtml(shape.moreHref)}">${escapeHtml(shape.moreText)}</a></p></section>`
  );
}
export const budgetCandidatesHtml = fragment("budgetCandidatesHtml", budgetCandidatesHtmlLegacy);

/**
 * "매매가 말고 드는 돈". 규칙과 기준일은 scripts/purchase-costs.mjs 한 곳에 있다. 월 상환액과
 * 같은 상자를 쓴다 - 둘 다 "그래서 실제로 얼마"에 답하는 문단이다.
 */
function budgetCostsHtmlLegacy(band) {
  const note = costsNote(band);
  return note
    ? `<p class="budget-loan budget-costs" data-prerendered="">${escapeHtml(note.sentence)}${budgetRuleLink(note.link.id, note.link.text)}</p>`
    : "";
}
export const budgetCostsHtml = fragment("budgetCostsHtml", budgetCostsHtmlLegacy);

/**
 * 예산대 페이지가 자기 이야기를 하는 문단.
 *
 * 자치구 페이지의 `districtFactsHtml`과 같은 자리에 같은 방식으로 들어간다 — 두 언어를
 * 빌드에서 미리 만들어 두 벌 다 굽고, 화면은 `data-summary-lang`으로 고르기만 한다.
 */
function budgetFactsHtmlLegacy(band, locale = "ko") {
  const sentences = budgetFactSentences(band?.facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}
export const budgetFactsHtml = fragment("budgetFactsHtml", budgetFactsHtmlLegacy);

/**
 * "그래서 매달 얼마"를 붙인다. 이 화면은 예산에 답하면서 정작 그 예산이 매달 얼마가
 * 되는지는 말하지 않고 있었다 - 실거래와 금리를 같이 받는 곳이라야 자동으로 물릴 수 있다.
 */
function budgetLoanHtmlLegacy(band, rates, mortgageSeries = null) {
  const note = loanNote(band, rates);
  if (!note) return "";
  // 1억당 값·금리 범위와 1년 사이 변화(mortgageSeries로 만든 문장)는 열여덟 장에서 같은 값이라
  // method.html로 갔다(scripts/budget-rules.mjs, #66). mortgageSeries 인자는 호출부 호환으로 남긴다.
  // 문장은 이스케이프하지 않고 끼운다 - 글자가 숫자 서식과 코드 상수뿐이다(mortgage.mjs, PR 본문의 raw 보간 전수표).
  return `<p class="budget-loan" data-prerendered="">${note.sentence}${budgetRuleLink(note.link.id, note.link.text)}</p>`;
}
export const budgetLoanHtml = fragment("budgetLoanHtml", budgetLoanHtmlLegacy);

// budgetBandLabel은 공개 export다 - 순수 모듈로 옮긴 뒤에도 이 이름으로 다시 내보낸다(MIN_SAMPLE·escapeHtml과 같은 방식, #243 PR A).
export { budgetBandLabel };

function newsRealestateStatsHtmlLegacy(news) {
  const stats = news?.realestateStats ?? [];
  if (!stats.length) return null;
  return stats
    .map(
      (s) =>
        `<a class="stat-card" href="${escapeHtml(s.href)}">` +
        `<span class="stat-label">${escapeHtml(s.label)}</span>` +
        `<span class="stat-value">${escapeHtml(s.value)}</span>` +
        (s.note ? `<span class="stat-sub">${escapeHtml(s.note)}</span>` : "") +
        `</a>`
    )
    .join("");
}
export const newsRealestateStatsHtml = fragment("newsRealestateStatsHtml", newsRealestateStatsHtmlLegacy);

/**
 * 증시 뉴스 장의 코스피 카드(UIUX #56). 첫 화면 "돈의 값"에서 옮겨 왔다 - 계약을 앞둔 사람의 질문이
 * 아니라서(DIRECTION 1부 대상). 하루 늦은 종가라 어느 장의 값인지 같이 적는다.
 */
function newsKospiHtmlLegacy(market) {
  const k = market?.kospi;
  if (!k?.value) return null;
  return (
    `<div class="stat-card">` +
    `<span class="stat-label">${escapeHtml(k.asOf ? `코스피 ${k.asOf} 종가` : "코스피")}</span>` +
    `<span class="stat-value">${escapeHtml(k.value)}</span>` +
    (k.change ? `<span class="stat-sub">${escapeHtml(`전 거래일 대비 ${k.change}`)}</span>` : "") +
    `</div>`
  );
}
export const newsKospiHtml = fragment("newsKospiHtml", newsKospiHtmlLegacy);

function newsSummaryHtmlLegacy(summary, category = null) {
  const all = (summary?.categories ?? []).filter((c) => c.lineKo);
  const shown = category ? all.filter((c) => c.key === category) : all;
  if (!shown.length) return null;
  // 보이는 분류에 검증 폴백이 있으면 안내 한 줄을 붙인다 - 뉴스 틀 renderSummary 의 `shown.some(...)` 와 같은 조건이다(#350).
  return (
    shown.map((c) => `<p><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.lineKo)}</p>`).join("") +
    (hasFallback(shown) ? `<div class="summary-note">${escapeHtml(FALLBACK_NOTE_KO)}</div>` : "")
  );
}
export const newsSummaryHtml = fragment("newsSummaryHtml", newsSummaryHtmlLegacy);

function newsListHtmlLegacy(news, category = null) {
  const all = news?.items ?? [];
  const items = category ? all.filter((item) => item.category === category) : all;
  if (!items.length) return null;

  return items
    .map(
      (item) =>
        `<li class="news-item">` +
        `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>` +
        `<div class="news-meta">${escapeHtml(item.source ?? "")}</div>` +
        newsContextHtml(item.context) +
        `</li>`
    )
    .join("");
}
export const newsListHtml = fragment("newsListHtml", newsListHtmlLegacy);

// 시세표의 칸 규칙·정렬(`RE_LABELS`~`reDistrictRows` 열여섯 보조 함수)은 realestate-table.mjs로 옮겼다(JSX 쪽 조각과 같이 쓴다, #242 PR 2).
// 거기서는 마크업 없이 칸의 모양과 글자만 정하고, 여기서는 마크업만 입힌다. 어느 글자를 이스케이프하고 어느 글자를 그대로 끼우는지는 조각(part)의 esc가 정한다 - 예전 그대로다.
const RE_PART_CLASS = { strong: "price-strong", count: "count", ratio: "ratio", low: "low-sample", stale: "prev-tag" };
const rePartHtml = ({ type, text, title, dir, esc }) => {
  const body = esc ? escapeHtml(text) : text;
  if (type === "text") return body;
  const cls = type === "change" ? `change ${dir}` : RE_PART_CLASS[type];
  return `<span class="${cls}"${title === null ? "" : ` title="${escapeHtml(title)}"`}>${body}</span>`;
};
const reCellHtml = (parts) => parts.map(rePartHtml).join("");

function realestateHeadHtmlLegacy(kind = null, district = null) {
  const labels = headLabels(kind, district);
  return `<tr>${labels.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr>`;
}
export const realestateHeadHtml = fragment("realestateHeadHtml", realestateHeadHtmlLegacy);

function reRowHtml(row) {
  const body = row.cells.map((cell) => `<td data-label="${escapeHtml(cell.label)}">${reCellHtml(cell.parts)}</td>`).join("");
  const name = row.name.href ? `<a href="${row.name.href}">${escapeHtml(row.name.text)}</a>` : escapeHtml(row.name.text);
  return `<tr class="${row.overall ? "overall-row" : ""}"><td>${name}${reCellHtml(row.stale)}</td>${body}</tr>`;
}

const reDistrictRowHtml = (row) =>
  `<tr><td>${escapeHtml(row.label)}</td>` +
  row.cells.map((cell) => `<td data-label="${escapeHtml(cell.label)}">${reCellHtml(cell.parts)}</td>`).join("") +
  `</tr>`;

function realestateTableHtmlLegacy(realestate, kind = null, district = null) {
  const table = realestateTable(realestate, kind, district);
  if (!table) return null;
  return table.rows.map(table.byDistrict ? reDistrictRowHtml : reRowHtml).join("");
}
export const realestateTableHtml = fragment("realestateTableHtml", realestateTableHtmlLegacy);

// 시세 요약 카드의 규칙(몇 장을 어떤 글자로)과 `ratioBasis`(전세가율 카드 밑 신고 건수)는 realestate-overall.mjs로 옮겼다(JSX 쪽 조각과 같이 쓴다, #242 PR 3).
// 거기서는 마크업 없이 카드의 라벨·값·부가 글자만 정하고, 여기서는 마크업(`overall-card`·`label`·`value`·`sub` 클래스)만 입힌다.
// 어느 글자를 이스케이프하고 어느 글자를 그대로 끼우는지는 조각(seg)의 esc가 정한다 - 예전 그대로다.
const reSegHtml = ({ text, esc }) => (esc ? escapeHtml(text) : text);
const reSegsHtml = (segs) => segs.map(reSegHtml).join("");
// 여기서 구운 카드 가운데 "전세가율 단지별 중앙값" 한 장은 화면 스크립트가 로드 때 **숫자만** 떼어 둔다(scripts/realestate-template.html의 `bakedCard`·`bakedSpread`, #311).
// 그 카드의 값(complex-ratio.json)은 시세 다음에 받는데, 시세가 도착하면 renderOverall()이 #overall-cards를 통째로 다시 쓰면서 구운 카드를 지웠다 -
// 받는 동안·요청이 실패했을 때 사라졌다. 떼어 둔 숫자는 값이 **아직 안 왔을 때만** 쓴다: 값이 왔는데 표본이 모자라 빠진 것(spread=null)은
// 그대로 둬야 한다(DIRECTION 해자 2).
// **마크업이 아니라 숫자를 떼어 두는 이유**: 구운 조각은 늘 한국어라 그대로 되붙이면 영어 화면에 영어 카드 넉 장 옆에 한국어 카드 한 장이 선다(po 판정, PR #324).
// 숫자만 떼어 두고 라벨은 그 화면의 locale로 다시 세우면 새 문구도 고지도 필요 없다 - 영어 글자는 틀의 T.en에 이미 있다.
// 이 설명을 화면 스크립트가 아니라 여기 적은 것은 틀 자신이 제자리에서 나가던 때(cto 판정, #312와 같은 처리)의 흔적이다. 지금은 틀(scripts/realestate-template.html)을 옮겨(#374) 나가는 47장 모두 굽는 단계가 주석을 떼므로, 화면 스크립트 쪽에 옮겨 적어도 배포 바이트는 늘지 않는다.
// 떼어 두는 쪽은 이 함수가 내는 마크업(`overall-card` > `label`·`value`·`sub`)과 한국어 라벨 글자에 기댄다 - 둘 중 하나를 바꾸면 scripts/realestate-template.html도 같이 본다.
const overallCardHtml = ({ label, value, sub }) =>
  `<div class="overall-card"><div class="label">${escapeHtml(label)}</div>` +
  `<div class="value">${reSegsHtml(value)}</div>` +
  (sub ? `<div class="sub">${reSegsHtml(sub)}</div>` : "") +
  `</div>`;

function realestateOverallHtmlLegacy(realestate, kind = null, district = null, spread = null) {
  const cards = overallCards(realestate, kind, district, spread);
  if (!cards) return null;
  return cards.map(overallCardHtml).join("");
}
export const realestateOverallHtml = fragment("realestateOverallHtml", realestateOverallHtmlLegacy);

function districtSummaryHtmlLegacy(realestate, district, locale = "ko", spread = null) {
  if (!district) return "";
  const entry = (realestate?.districts ?? []).find((d) => d.name === district);
  const sentences = districtSentences(entry, realestate, locale, spread);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}
export const districtSummaryHtml = fragment("districtSummaryHtml", districtSummaryHtmlLegacy);

/**
 * 시세 문장 아래에 붙는 두 번째 문단.
 *
 * 위 문단은 스물다섯 구가 같은 틀이다 — 평당 얼마, 평균의 몇 배, 몇 번째. 이쪽은
 * 구마다 눈에 띄는 것만 골라 말하므로 문장의 개수도 종류도 구마다 다르고, 말할 것이
 * 없는 구에서는 통째로 비어 있다. 어느 쪽인지는 `district-facts.mjs`가 정한다.
 */
/**
 * 재계약에서 나온 관찰. 매매 거래에서 뽑은 관찰과 문단을 나눈다 - 앞 문단은 매매
 * 신고분 이야기이고 이쪽은 전월세 갱신 이야기라, 한 문단에 이어 붙이면 같은 표본을
 * 두고 하는 말처럼 읽힌다.
 */
function districtRenewalHtmlLegacy(facts, locale = "ko") {
  const sentences = renewalSentences(facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}
export const districtRenewalHtml = fragment("districtRenewalHtml", districtRenewalHtmlLegacy);

function districtFactsHtmlLegacy(facts, locale = "ko") {
  const sentences = factSentences(facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}
export const districtFactsHtml = fragment("districtFactsHtml", districtFactsHtmlLegacy);

function districtLinksHtmlLegacy(current = null, heading = "다른 지역") {
  const links = DISTRICT_PAGES.map(({ name, file }) =>
    name === current
      ? `<a href="./${file}" aria-current="page">${escapeHtml(name)}</a>`
      : `<a href="./${file}">${escapeHtml(name)}</a>`
  ).join("");
  return linksBlockHtml("district-links", heading, links);
}
export const districtLinksHtml = fragment("districtLinksHtml", districtLinksHtmlLegacy);

// 상수·값 모양·행 선택·정렬·세후 이자 칸은 rates-table.mjs에 있다 - JSX 쪽(render/entry.jsx)이 같은 계산을 가져다 쓴다(#240).
//
// Tailwind 유틸리티(#279). 이 조각이 실리는 금리 상품군 네 장은 색인 대상이다.
//
// ⚠️ **주석에 유틸리티 이름을 접두사까지 적지 않는다.** 이 파일은 src/css/main.css의 @source 목록에 있어 Tailwind와
// test/css-build.test.mjs가 **주석까지 글자로 훑는다** - 설명문이 class로 잡혀 "산출물에 규칙이 없는 class"로 걸리거나,
// 하필 `dark:` 변형을 설명하면 금지 넷 중 하나에 걸린다(실제로 한 번 걸렸다). 그래서 이름은 접두사 없이 적는다.
//
// ⚠️ **여기 더하는 유틸리티는 legacy.css의 같은 선언을 그대로 옮긴 것이다 - 보이는 모양을 바꾸지 않는다.** 이유:
// 이 조각이 들어가는 `#products-head`·`#products-body`는 **틀의 인라인 스크립트가 데이터를 받으면 통째로 다시 그린다**
// (scripts/rates-template.html의 renderProductsHead·renderProducts). 그쪽이 내는 마크업에는 이 class가 없으므로,
// 여기서 **모양이 달라지는** 유틸리티를 쓰면 **구운 첫 화면과 스크립트가 다시 그린 화면이 서로 다르게 보인다**(깜빡임).
// 그 스크립트를 고치는 길은 두 가지가 막혀 있다 - **S6**(인라인 스크립트 바이트가 늘면 하드)과 **틀은 #282 소관**이다.
// 그래서 이 PR은 **배선을 색인 4장에서 실증하는 데까지만** 하고, 모양을 바꾸는 일은 틀과 함께 가는 #282·#278 PR C로 넘긴다.
// 옮긴 짝(legacy.css):
//   .data-table th       color: var(--muted) · font-weight: 600 · font-size: var(--fs-xs)  -> `text-muted` `font-semibold` `text-xs`
//   .product-name        white-space: normal · word-break: keep-all                        -> `whitespace-normal` `break-keep`
//   .product-company     font-size: var(--fs-xs) · color: var(--muted)                     -> `text-xs` `text-muted`
//   .rate-strong         font-weight: 600 · color: var(--up)                               -> `font-semibold` `text-up`
//   .rate-low            font-weight: 600 · color: var(--down)                             -> `font-semibold` `text-down`
//   .net-interest        font-weight: 700                                                  -> `font-bold`
// 글자 크기 유틸리티가 line-height: inherit을 같이 내는데, line-height는 상속 속성이라 선언이 없을 때와 계산값이 같다(#278 PR B).
//
// 허브(docs/rates.html)도 같은 규칙으로 고쳤고, 그쪽은 다시 그리는 스크립트가 없어서 **모양이 바뀐다**(상품군 링크 넷이 카드가 된다).
// 거기 쓴 것 중 두 가지는 근거가 여기 있다:
//   - 읽는 단은 `max-w-read`(= --container-read -> max-width: var(--prose))를 쓴다. Tailwind가 미리 들고 있는 65ch짜리 prose 쪽은
//     그 값이 이겨 var(--prose)가 나오지 않는다(src/css/main.css 55~56행).
//   - **화면 폭 변형 가운데 열린 구간(max-) 쪽은 하나도 쓰지 않았다.** 그쪽은 `(width < 480px)`로 나오고 legacy.css의
//     `@media (max-width: 480px)`는 480px을 포함한다 - 정확히 480px 한 폭에서만 갈린다(같은 파일 52~53행).
//     갈릴 자리를 만들지 않는 쪽을 골랐다(#279 완료 조건 3).
//   - 주석에 유틸리티 이름을 접두사까지 적지 않는 규칙은 docs/*.html도 같다(@source 목록에 있다).
const TH_CLASS = "tw:text-muted tw:text-xs tw:font-semibold";
const rateTh = (label) => `<th scope="col" class="${TH_CLASS}">${label}</th>`;
function ratesHeadHtmlLegacy(category = "deposit") {
  return isSavingCategory(category)
    ? `<tr>${rateTh("상품")}${rateTh("기본금리")}${rateTh("최고금리")}${rateTh("세후 이자")}</tr>`
    : `<tr>${rateTh("상품")}${rateTh("금리 유형")}${rateTh("금리(최저~최고)")}${rateTh("평균")}</tr>`;
}
export const ratesHeadHtml = fragment("ratesHeadHtml", ratesHeadHtmlLegacy);

function ratesHtmlLegacy(rates, { category = "deposit", limit = RATES_ROWS } = {}) {
  const rows = selectRateRows(rates, category, limit);
  if (!rows) return null;

  const saving = isSavingCategory(category);
  // 훅 class(product-name·rate-strong·net-interest는 tools/golden/hook-classes.json에 있다)는 지우지 않고 뒤에 더한다.
  const productCell = (product) =>
    `<td><div class="product-name tw:whitespace-normal tw:break-keep">${escapeHtml(product.name ?? "-")}</div>` +
    `<div class="product-company tw:text-xs tw:text-muted">${escapeHtml(product.company ?? "")}</div></td>`;

  return rows
    .map(({ product, option }) =>
      saving
        ? `<tr>${productCell(product)}<td data-label="기본금리">${rate(option.rate)}</td>` +
          `<td class="rate-strong tw:font-semibold tw:text-up" data-label="최고금리">${rate(option.maxRate ?? option.rate)}</td>` +
          `<td class="net-interest tw:font-bold" data-label="세후 이자">${netInterestText(option, category)}</td></tr>`
        : `<tr>${productCell(product)}<td data-label="금리 유형">${escapeHtml(option.rateType ?? "-")}</td>` +
          `<td data-label="금리(최저~최고)">${rateRange(option.min, option.max)}</td>` +
          `<td class="rate-low tw:font-semibold tw:text-down" data-label="평균">${rate(option.avg)}</td></tr>`
    )
    .join("");
}
export const ratesHtml = fragment("ratesHtml", ratesHtmlLegacy);

export function applyPrerender(html, blocks) {
  let out = html;
  for (const [name, content] of Object.entries(blocks)) {
    const open = `<!--prerender:${name}-->`;
    const close = `<!--/prerender:${name}-->`;
    const start = out.indexOf(open);
    const end = out.indexOf(close);
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`${name} 자리표시 주석을 찾지 못했습니다. 대상 HTML에서 마커가 지워졌는지 확인해주세요.`);
    }
    if (content == null) continue;
    out = `${out.slice(0, start + open.length)}${content}${out.slice(end)}`;
  }
  // 틀에 손으로 쓴 표와 빌더가 채운 표가 모두 이 길을 지나므로 머리글 방향·표 이름은 여기서 한 번에 단다.
  return accessibleTables(out);
}

/**
 * 전세·월세 화면의 첫 문단과 표. 문장은 빌드가 이미 만들어 두었으므로 여기서는
 * 고르기만 한다. 표는 화면이 고른 자치구를 굵게 하려고 다시 그리지만, 조건을
 * 넣기 전에 보이는 첫 벌은 여기서 구워 나가야 검색에 걸린다.
 */
// 표 여섯(전환율·해제·미등기·재계약 둘·층 격차)의 행 선택·정렬·칸 글자는 district-tables.mjs에 있다 - JSX 쪽(render/entry.jsx)이 같은 계산을 가져다 쓴다(#242 PR 1). 여기는 마크업만 입힌다.
export { CONVERSION_BAND };

function conversionLeadHtmlLegacy(conversion) {
  return conversion?.seoul?.leadKo ? escapeHtml(conversion.seoul.leadKo) : null;
}
export const conversionLeadHtml = fragment("conversionLeadHtml", conversionLeadHtmlLegacy);

function conversionTableHtmlLegacy(conversion, band = CONVERSION_BAND) {
  const table = conversionTable(conversion, band);
  if (!table) return null;

  const body = table.rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.district)}</td><td>${row.rate}</td>` +
        `<td>${escapeHtml(row.jeonse)}</td>` +
        `<td>${escapeHtml(row.rent)}</td>` +
        `<td>${row.pairs}</td></tr>`
    )
    .join("");

  return (
    `<caption class="cost-label" style="caption-side:top;text-align:left;padding-bottom:8px;">${escapeHtml(table.caption)}</caption>` +
    `<thead><tr><th scope="col">자치구</th><th scope="col">전환율</th><th scope="col">전세</th><th scope="col">월세</th><th scope="col">단지</th></tr></thead>` +
    `<tbody>${body}</tbody>`
  );
}
export const conversionTableHtml = fragment("conversionTableHtml", conversionTableHtmlLegacy);

function conversionDistrictLinksHtmlLegacy(conversion) {
  return slugLinksHtml(conversion);
}
export const conversionDistrictLinksHtml = fragment("conversionDistrictLinksHtml", conversionDistrictLinksHtmlLegacy);

/** 해제·등기 화면. 조건을 넣을 것이 없는 읽는 화면이라 첫 벌이 곧 본문이다. */
function cancelLeadHtmlLegacy(cancellation) {
  return cancellation?.seoul?.leadKo ? escapeHtml(cancellation.seoul.leadKo) : null;
}
export const cancelLeadHtml = fragment("cancelLeadHtml", cancelLeadHtmlLegacy);

/** 문장은 빌더가 두 언어로 만든다(scripts/cancellation.mjs registrationSentence). 화면과 같은 글자를 꽂는다. */
function cancelMonthLeadHtmlLegacy(cancellation) {
  const text = cancellation?.seoul?.registrationLead?.ko;
  return text ? escapeHtml(text) : null;
}
export const cancelMonthLeadHtml = fragment("cancelMonthLeadHtml", cancelMonthLeadHtmlLegacy);

function cancelDistrictsHtmlLegacy(cancellation) {
  const rows = cancelDistricts(cancellation);
  if (!rows) return null;

  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.district)}</td><td>${row.deals}</td>` +
        `<td>${row.cancelled}</td><td>${escapeHtml(row.cancelledShare)}</td>` +
        `<td>${row.stale}</td><td>${escapeHtml(row.staleShare)}</td></tr>`
    )
    .join("");

  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">신고</th><th scope="col">해제</th><th scope="col">해제율</th><th scope="col">미등기</th><th scope="col">미등기율</th></tr></thead>` +
    `<tbody>${body}</tbody>`
  );
}
export const cancelDistrictsHtml = fragment("cancelDistrictsHtml", cancelDistrictsHtmlLegacy);

function cancelMonthsHtmlLegacy(cancellation) {
  const rows = cancelMonths(cancellation);
  if (!rows) return null;

  const body = rows
    .map(
      (row) =>
        `<tr${row.spot ? ' class="spot"' : ""}><td>${escapeHtml(row.month)}</td>` +
        `<td>${row.filed}</td><td>${row.registered}</td><td>${row.share}</td></tr>`
    )
    .join("");

  return `<thead><tr><th scope="col">계약월</th><th scope="col">계약</th><th scope="col">등기 완료</th><th scope="col">완료율</th></tr></thead><tbody>${body}</tbody>`;
}
export const cancelMonthsHtml = fragment("cancelMonthsHtml", cancelMonthsHtmlLegacy);

function cancelDistrictLinksHtmlLegacy(cancellation) {
  return slugLinksHtml(cancellation);
}
export const cancelDistrictLinksHtml = fragment("cancelDistrictLinksHtml", cancelDistrictLinksHtmlLegacy);

/** 재계약 화면. 문턱은 빌더가 이미 적용했으므로 여기서는 형식만 입힌다. */
function renewalLeadHtmlLegacy(renewal) {
  return renewal?.lead?.ko ? escapeHtml(renewal.lead.ko) : null;
}
export const renewalLeadHtml = fragment("renewalLeadHtml", renewalLeadHtmlLegacy);

function renewalCapLeadHtmlLegacy(renewal) {
  return renewal?.capLead?.ko ? escapeHtml(renewal.capLead.ko) : null;
}
export const renewalCapLeadHtml = fragment("renewalCapLeadHtml", renewalCapLeadHtmlLegacy);

function renewalDistrictsHtmlLegacy(renewal) {
  const rows = renewalDistricts(renewal);
  if (!rows) return null;

  const body = rows
    .map((row) => {
      // 문턱을 못 넘은 칸은 비우지 않는다. 화면 쪽 renderDistrictTable과 같은 규칙이다.
      const gap = row.gap.low ? '<span class="low-sample">표본 부족</span>' : escapeHtml(row.gap.text);
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${gap}</td>` +
        `<td>${escapeHtml(row.cheaper)}</td><td>${row.matched}</td>` +
        `<td>${escapeHtml(row.capMiss)}</td><td>${row.rightUsed}</td></tr>`
      );
    })
    .join("");

  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">갱신 − 신규</th><th scope="col">시세보다 싼 비율</th>` +
    `<th scope="col">맞물린 계약</th><th scope="col">상한 미달</th><th scope="col">요구권 행사</th></tr></thead><tbody>${body}</tbody>`
  );
}
export const renewalDistrictsHtml = fragment("renewalDistrictsHtml", renewalDistrictsHtmlLegacy);

function renewalWolseLeadHtmlLegacy(renewal) {
  return renewal?.wolseLead?.ko ? escapeHtml(renewal.wolseLead.ko) : null;
}
export const renewalWolseLeadHtml = fragment("renewalWolseLeadHtml", renewalWolseLeadHtmlLegacy);

/** 월세 재계약 표. 화면 쪽 renderWolse와 같은 모양이다. */
function renewalWolseDistrictsHtmlLegacy(renewal) {
  const table = renewalWolseDistricts(renewal);
  if (!table) return null;
  const body = table.rows
    .map((row) => {
      const gap = row.gap.low ? '<span class="low-sample">표본 부족</span>' : escapeHtml(row.gap.text);
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${gap}</td><td>${escapeHtml(row.range)}</td>` +
        `<td>${escapeHtml(row.cheaper)}</td><td>${row.matched}</td></tr>`
      );
    })
    .join("");
  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">${escapeHtml(table.rateHeading)}</th><th scope="col">${escapeHtml(table.endsHeading)}</th>` +
    `<th scope="col">시세보다 싼 비율</th><th scope="col">맞물린 계약</th></tr></thead><tbody>${body}</tbody>`
  );
}
export const renewalWolseDistrictsHtml = fragment("renewalWolseDistrictsHtml", renewalWolseDistrictsHtmlLegacy);

function renewalDistrictLinksHtmlLegacy(renewal) {
  return slugLinksHtml(renewal);
}
export const renewalDistrictLinksHtml = fragment("renewalDistrictLinksHtml", renewalDistrictLinksHtmlLegacy);

/** 층 격차 화면. 문턱과 문장은 빌더가 이미 정했으므로 여기서는 표만 만든다. */
function floorDistrictsHtmlLegacy(floor) {
  const rows = floorDistricts(floor);
  if (!rows) return null;

  // 갈라 볼 수 없는 구도 빼지 않는다 - 화면 쪽 renderDistrictTable과 같은 규칙이다.
  const body = rows
    .map((row) => {
      const verdict = row.lowText === null ? "다르다" : `<span class="low-sample">${row.lowText}</span>`;
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${row.median}</td>` +
        `<td>${row.cells}</td><td>${verdict}</td></tr>`
      );
    })
    .join("");

  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">1층 − 3층 이상</th><th scope="col">맞물린 칸</th>` +
    `<th scope="col">서울과 다른가</th></tr></thead><tbody>${body}</tbody>`
  );
}
export const floorDistrictsHtml = fragment("floorDistrictsHtml", floorDistrictsHtmlLegacy);

function floorDistrictLinksHtmlLegacy(floor) {
  return slugLinksHtml(floor);
}
export const floorDistrictLinksHtml = fragment("floorDistrictLinksHtml", floorDistrictLinksHtmlLegacy);

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const [summary, market, realestate, news] = await Promise.all(
    ["summary", "market", "realestate", "news"].map(readJson)
  );

  const blocks = {
    summary: summaryHtml(summary),
    market: marketHtml(market),
    realestate: realestateHtml(realestate),
    news: newsHtml(news),
  };

  const rates = await readJson("rates");
  const conversion = await readJson("conversion");
  const cancellation = await readJson("cancellation");
  const renewal = await readJson("renewal-facts");
  const floor = await readJson("floor-gap");
  const moveIn = await readJson("move-in");
  const outlook = await readJson("outlook");
  const indicators = await readJson("outlook-indicators");
  // 전망의 문장과 표는 빌더가 두 언어로 다 만들어 둔다. 여기서는 한국어를 꽂기만 한다.
  const outlookText = (key) => (outlook?.[key]?.ko ? escapeHtml(outlook[key].ko) : null);
  const record = await readJson("record-high");
  const change = await readJson("district-change");
  const recordText = (key) => (record?.[key]?.ko ? escapeHtml(record[key].ko) : null);

  const writes = createWriteSet();
  // 넷째 칸(선택)은 틀 경로다. 있으면 path_ 는 나가는 장이고, 틀을 채운 뒤 인라인 스크립트 주석을 떼어 path_ 에 쓴다(#374).
  for (const [file, path_, fileBlocks, templatePath] of [
    ["docs/index.html", INDEX_PATH, blocks],
    ["docs/rates.html", RATES_PATH, { rateBridgeKo: rateBridgeHtml("rates", "ko"), rateBridgeEn: rateBridgeHtml("rates", "en") }], // 허브: 표·상품군 문단은 상품군 페이지 넷이 그린다(#193)
    [
      "docs/news.html",
      NEWS_PATH,
      { newsSummary: newsSummaryHtml(summary), newsList: newsListHtml(news) },
    ],
    [
      "docs/realestate.html",
      REALESTATE_PATH,
      {
        realestateOverall: realestateOverallHtml(realestate),
        realestateHead: realestateHeadHtml(),
        realestateTable: realestateTableHtml(realestate),
        districtLinks: "",
        districtSummaryKo: "",
        districtSummaryEn: "",
        districtFactsKo: "",
        districtFactsEn: "",
        districtRenewalKo: "",
        districtRenewalEn: "",
      },
      REALESTATE_TEMPLATE_PATH,
    ],
    [
      "docs/jeonse-vs-wolse.html",
      CONVERSION_PATH,
      {
        conversionLead: conversionLeadHtml(conversion),
        conversionTable: conversionTableHtml(conversion),
        conversionDistrictLinks: conversionDistrictLinksHtml(conversion),
      },
    ],
    [
      "docs/renewal-vs-new.html",
      RENEWAL_PATH,
      {
        renewalLead: renewalLeadHtml(renewal),
        renewalCapLead: renewalCapLeadHtml(renewal),
        renewalDistricts: renewalDistrictsHtml(renewal),
        renewalWolseLead: renewalWolseLeadHtml(renewal),
        renewalWolseDistricts: renewalWolseDistrictsHtml(renewal),
        renewalDistrictLinks: renewalDistrictLinksHtml(renewal),
      },
    ],
    [
      "docs/floor-gap.html",
      FLOOR_PATH,
      {
        floorLead: floor?.lead?.ko ? escapeHtml(floor.lead.ko) : null,
        floorTopLead: floor?.topLead?.ko ? escapeHtml(floor.topLead.ko) : null,
        floorDistrictLead: floor?.districtLead?.ko ? escapeHtml(floor.districtLead.ko) : null,
        floorDistricts: floorDistrictsHtml(floor),
        floorDistrictLinks: floorDistrictLinksHtml(floor),
      },
    ],
    [
      "docs/switch-house.html",
      SWITCH_PATH,
      {
        switchLead: change?.lead?.ko ? escapeHtml(change.lead.ko) : null,
        switchTable: change?.table?.ko ?? null,
        switchRegions: change?.regionTable?.ko ?? null,
      },
    ],
    [
      "docs/record-high.html",
      RECORD_PATH,
      {
        recordLead: recordText("lead"),
        recordControl: recordText("control"),
        recordSurvival: recordText("survival"),
        recordRobust: record?.tables?.robust?.ko ?? null,
      },
    ],
    [
      "docs/price-outlook.html",
      OUTLOOK_PATH,
      {
        outlookLead: outlookText("lead"),
        outlookRegions: outlook?.tables?.regions?.ko ?? null,
        outlookLongLead: outlookText("longLead"),
        outlookNowcastLead: outlookText("nowcastLead"),
        outlookNowcast: outlook?.tables?.nowcast?.ko ?? null,
        outlookScore: outlook?.tables?.score?.ko ?? null,
        outlookRecordLead: outlookText("recordLead"),
        indicatorLead: indicators?.lead?.ko ? escapeHtml(indicators.lead.ko) : null,
        moveInLead: moveIn?.lead?.ko ? escapeHtml(moveIn.lead.ko) : null,
        moveInTable: moveIn?.table?.ko ?? null,
        moveInDistricts: moveIn?.districts?.ko ? escapeHtml(moveIn.districts.ko) : null,
        indicatorTable: indicators?.table?.ko ?? null,
      },
    ],
    // 손으로 쓴 장이라 채울 자리는 없다. 표의 머리글 방향·이름만 같은 길로 단다.
    ["docs/method.html", METHOD_PATH, {}],
    [
      "docs/cancelled-deals.html",
      CANCELLATION_PATH,
      {
        cancelLead: cancelLeadHtml(cancellation),
        cancelCorrectionLead: cancellation?.seoul?.correctionLead?.ko ? escapeHtml(cancellation.seoul.correctionLead.ko) : null,
        cancelDistricts: cancelDistrictsHtml(cancellation),
        cancelMonthLead: cancelMonthLeadHtml(cancellation),
        cancelMonths: cancelMonthsHtml(cancellation),
        cancelPriceLead: cancellation?.priceBands?.lead?.ko ? escapeHtml(cancellation.priceBands.lead.ko) : null,
        cancelPriceTable: cancellation?.priceBands?.table?.ko ?? null,
        cancelDistrictLinks: cancelDistrictLinksHtml(cancellation),
      },
    ],
  ]) {
    // 틀이 따로 있는 장은 틀을 읽어 채우고 훑개를 건다(훑개는 굽는 단계의 마지막이다). 나가는 장의 지금 내용은 "변경 없음" 비교용이다.
    const html = await readFile(templatePath ?? path_, "utf8");
    const current = templatePath ? await readFile(path_, "utf8").catch(() => null) : html;
    const filled = applyPrerender(html, fileBlocks);
    const next = templatePath ? stripInlineScriptComments(filled) : filled;

    for (const [name, content] of Object.entries(fileBlocks)) {
      console.log(`  ${file} ${name.padEnd(11)} ${content ? `${content.length}자` : "데이터 없음 - 건너뜀"}`);
    }

    if (next === current) {
      console.log(`  ${file} 변경 없음`);
      continue;
    }
    writes.stage(path_, next, `  ${file} 갱신`);
  }
  // 열한 장이 전부 렌더에 성공한 뒤에야 쓴다(#237) - 중간 장에서 던지면 어느 파일도 바뀌지 않는다.
  writes.commit();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`프리렌더 실패: ${err.message}`);
    process.exit(1);
  });
}
