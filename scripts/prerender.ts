import { readFile } from "node:fs/promises";
import path from "node:path";
import { accessibleTables } from "./table-a11y.ts";
import { fragment } from "./renderer.ts";
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
import { BUDGET_PAGES } from "./budget-pages.ts";
import { budgetFactSentences } from "./budget-facts.ts";
import { DISTRICT_PAGES } from "./district-slugs.ts";
import { districtSentences } from "./district-summary.ts";
import { factSentences } from "./district-facts.ts";
import { renewalSentences } from "./renewal-facts.ts";
import { BUDGET_MORE_LINKS, CANDIDATE_LIST, bodyShape, budgetAnswers, budgetBandLabel, budgetRuleHref, candidatesShape, capNote, costsNote, dealShape, loanNote, minCashNote, policyNote, whereText } from "./budget-fragments.ts";
import { metricCell, topDistricts } from "./realestate-rows.ts";
import { headLabels, realestateTable } from "./realestate-table.ts";
import { overallCards } from "./realestate-overall.ts";
import { MIN_SAMPLE } from "./realestate-format.ts";
import { stripInlineScriptComments } from "./strip-inline-comments.ts";
import { requireSite, siteLabel, sitePath } from "./site-dir.ts";

const root = path.resolve(import.meta.dirname, "..");
// 시세 장은 틀(scripts/)과 나가는 장(docs/)으로 갈라져 있다(#374). 틀에는 "왜"를 마음껏 적고,
// 이 파일이 틀을 채운 뒤 인라인 스크립트의 주석을 떼어 docs/realestate.html 로 낸다. 두 빌더(build-realestate-pages·build-budget-pages)도
// 같은 틀을 읽는다. docs/realestate.html 은 생성물이라 손으로 고치지 않는다.
export const REALESTATE_TEMPLATE_PATH = path.join(root, "scripts/realestate-template.html");
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
// #575 PR2 부터 어느 장에도 꽂지 않는다(메인 요약 상자는 뉴스 화면으로 옮겼다). 조각·parity 시험과 함께 지우는 것은 #575 PR4 몫이다.
export const summaryHtml = fragment("summaryHtml", summaryHtmlLegacy);

// 첫 화면 돈의 값 한 줄(#575 PR2): 기준금리 → 환율. 표·차트·실시간 환율은 뺐다. index.html renderMarket 이 같은 순서·같은 글로 다시 쓴다.
function marketHtmlLegacy(market) {
  if (!market) return null;
  const parts = [];
  if (market.baseRate?.value) parts.push(`한국은행 기준금리 ${escapeHtml(market.baseRate.value)}%`);
  if (typeof market.usdKrw?.value === "number") {
    parts.push(`원/달러 환율 ${market.usdKrw.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원`);
  }
  return parts.length ? parts.join(" · ") : null;
}
export const marketHtml = fragment("marketHtml", marketHtmlLegacy);

// 칸이 어떤 모양인지(없음·표본 부족·값)와 값의 글자는 realestate-rows.mjs가 정하고, 여기서는 마크업만 입힌다.
// 표본 건수(count)는 숫자가 아니어도 그대로 적는다 - 이스케이프하지 않는 것도 예전 그대로다(건수는 숫자로만 들어온다).
const lowSampleText = (count) =>
  `<span class="low-sample" title="신고 ${count}건이라 평균을 내기엔 표본이 부족합니다">` +
  `표본 ${count}건</span>`;

const cellHtml = (kind, metric, overall) => {
  const cell = metricCell(kind, metric, overall);
  if (cell.type === "none") return "-";
  if (cell.type === "low") return lowSampleText(cell.count);
  const change = cell.change ? ` <span class="change">${cell.change.sign}${cell.change.text}</span>` : "";
  const count = cell.count ? ` <span class="count">${cell.count}</span>` : "";
  return `${cell.text}${change}${count}`;
};

function realestateHtmlLegacy(realestate) {
  if (!realestate?.overall) return null;

  const row = (name, data, overall = false) =>
    `<tr><td>${escapeHtml(name)}</td>` +
    `<td data-label="매매">${cellHtml("sale", data.sale, overall)}</td>` +
    `<td data-label="전세">${cellHtml("jeonse", data.jeonse, overall)}</td>` +
    `<td data-label="월세">${cellHtml("wolse", data.wolse, overall)}</td></tr>`;

  return [row("서울 전체", realestate.overall, true), ...topDistricts(realestate).map((d) => row(d.name, d))].join("");
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

// 첫 화면 뉴스 자리는 뉴스 화면으로 가는 한 줄이다(#575 PR2). 기사·AI 요약은 news.html 에만 싣는다.
// 건수는 data-n 에도 적는다 - index.html renderNewsLink 가 언어를 바꿀 때 이 값을 쓴다(뉴스 JSON 을 다시 받지 않는다).
function newsHtmlLegacy(news) {
  const n = Array.isArray(news?.items) ? news.items.length : 0;
  if (!n) return null;
  return `<a href="./news.html" id="news-link" data-n="${n}">오늘 뉴스 ${n}건·AI 요약 →</a>`;
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

function budgetBodyHtmlLegacy(band, periodList, loanBasis = null, mortgageSeries = null, complexFiles = null, capStats = null, policyCounts = null, finderHtml = "") {
  const shape = bodyShape(band, periodList);
  if (!shape) return null;

  // districts: 이름은 이스케이프하고 건수는 숫자 서식 글자다(이 줄은 이스케이프 없이 아래 템플릿에 끼운다).
  const districts = shape.districts.map((d) => `${escapeHtml(d.name)} ${d.count}`).join(" · ");

  // 순서: 거래 요약 → 한눈에(돈 네 줄) → 지역 줄 → 어디로 가는가 → 예산으로 찾기(제목+칩) → 후보 단지 → 돈 문단(근거) → 다음 질문 → 거래 12줄(예시).
  // 답(한눈에)이 첫 화면 안에 들어오게 답이 아닌 것(지역 줄·where·칩)을 뒤로 옮겼다(#460, po 판정 6354774227·6361525534). 후보가 "이 돈이면 어디"의 답이고
  // 거래 12줄은 예시라 맨 뒤다(UIUX #43). 날짜 줄(#cross-basis)은 이 칸 밖 바로 위에 있다.
  // 화면(realestate.html)은 요약을 다시 그리고 data-prerendered 덩어리를 이 순서 그대로 붙인 뒤 거래 목록을 붙인다 - 지역 줄만 화면이 다시 그려 한눈에 바로 뒤에 끼운다.
  // 순서 한 벌: 이 함수 · render/entry.jsx 의 budgetBodyJsx · realestate-template.html 의 renderBudget(budgetHeadHtml) 셋은 같아야 하고, DOM 순서가 곧 화면 순서다(CSS order 로 바꾸지 않는다).
  // finderHtml: 예산으로 찾기 제목과 칩 줄(build-budget-pages 가 장마다 만든다). 비면 이 절은 없다.
  return (
    `<p class="budget-summary">${escapeHtml(shape.summary)}` +
    (shape.periods ? ` <span class="when">${escapeHtml(shape.periods)}</span>` : "") +
    `</p>` +
    budgetAnswersHtml(band, loanBasis) +
    (districts ? `<div class="budget-districts">거래가 많은 지역: ${districts}</div>` : "") +
    budgetWhereHtml(band) +
    (finderHtml ? `<div data-prerendered="">${finderHtml}</div>` : "") +
    budgetCandidatesHtml(band, complexFiles) +
    budgetLoanHtml(band, loanBasis, mortgageSeries) +
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
function budgetAnswersHtmlLegacy(band, loanBasis = null) {
  const answers = budgetAnswers(band, loanBasis);
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
    `<h2>${escapeHtml(answers.heading)}</h2><ul>${lines}</ul>` +
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
 * loanBasis는 mortgage.ts latestRate의 { rate, month }(한국은행 ECOS 주담대 신규취급 평균금리, #577)다.
 */
function budgetLoanHtmlLegacy(band, loanBasis, mortgageSeries = null) {
  const note = loanNote(band, loanBasis);
  if (!note) return "";
  // 1억당 값·금리 근거와 1년 사이 변화(mortgageSeries로 만든 문장)는 열여덟 장에서 같은 값이라
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
  // 안내 링크 쌍(#462)은 시세 장만 4주 문단 앵커로 간다. 예산대 장(<meta name="budget-band">)은 두 링크 모두 맨 위(method.html)로 둔다.
  if (out.includes('<meta name="budget-band"')) out = out.replace(/(href="\.\/method\.html)#four-weeks(?:-en)?"/g, '$1"');
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
  // 읽고 쓰는 장의 디렉터리. 기본은 docs/ 이고, JIPGYE_SITE_DIR 이 있으면 그 디렉터리의 복사본이다(#508, scripts/site-dir.ts). 데이터는 어느 쪽이든 docs/data 다.
  requireSite();
  const at = (rel) => sitePath(rel);
  const label = (rel) => siteLabel(rel);
  const [summary, market, realestate, news] = await Promise.all(
    ["summary", "market", "realestate", "news"].map(readJson)
  );

  const blocks = {
    market: marketHtml(market),
    realestate: realestateHtml(realestate),
    news: newsHtml(news),
  };

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
    [label("index.html"), at("index.html"), blocks],
    [
      label("news.html"),
      at("news.html"),
      { newsSummary: newsSummaryHtml(summary), newsList: newsListHtml(news) },
    ],
    [
      label("realestate.html"),
      at("realestate.html"),
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
      label("jeonse-vs-wolse.html"),
      at("jeonse-vs-wolse.html"),
      {
        conversionLead: conversionLeadHtml(conversion),
        conversionTable: conversionTableHtml(conversion),
        conversionDistrictLinks: conversionDistrictLinksHtml(conversion),
      },
    ],
    [
      label("renewal-vs-new.html"),
      at("renewal-vs-new.html"),
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
      label("floor-gap.html"),
      at("floor-gap.html"),
      {
        floorLead: floor?.lead?.ko ? escapeHtml(floor.lead.ko) : null,
        floorTopLead: floor?.topLead?.ko ? escapeHtml(floor.topLead.ko) : null,
        floorDistrictLead: floor?.districtLead?.ko ? escapeHtml(floor.districtLead.ko) : null,
        floorDistricts: floorDistrictsHtml(floor),
        floorDistrictLinks: floorDistrictLinksHtml(floor),
      },
    ],
    [
      label("switch-house.html"),
      at("switch-house.html"),
      {
        switchLead: change?.lead?.ko ? escapeHtml(change.lead.ko) : null,
        switchTable: change?.table?.ko ?? null,
        switchRegions: change?.regionTable?.ko ?? null,
      },
    ],
    [
      label("record-high.html"),
      at("record-high.html"),
      {
        recordLead: recordText("lead"),
        recordControl: recordText("control"),
        recordSurvival: recordText("survival"),
        recordRobust: record?.tables?.robust?.ko ?? null,
      },
    ],
    [
      label("price-outlook.html"),
      at("price-outlook.html"),
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
    [label("method.html"), at("method.html"), {}],
    [
      label("cancelled-deals.html"),
      at("cancelled-deals.html"),
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
    const html = await readFile((templatePath ?? path_) as string, "utf8");
    const current = templatePath ? await readFile(path_ as string, "utf8").catch(() => null) : html;
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
