import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { accessibleTables } from "./table-a11y.mjs";
import { DEFAULT_AMOUNT, formatWon, netInterestOf } from "./interest.mjs";
import { BUDGET_PAGES } from "./budget-pages.mjs";
import { budgetFactSentences } from "./budget-facts.mjs";
import { DISTRICT_PAGES, DISTRICT_SLUGS, districtFile } from "./district-slugs.mjs";
import { districtSentences } from "./district-summary.mjs";
import { factSentences } from "./district-facts.mjs";
import { renewalSentences } from "./renewal-facts.mjs";
import { apartmentOptions, loanSentence, monthlyPayment, rateSpread } from "./mortgage.mjs";
import { BASIS_DATE as COSTS_DATE, costsSentence, purchaseCosts } from "./purchase-costs.mjs";
import { candidatesInBand } from "./complex-price.mjs";
import { BASIS_DATE as CAP_DATE, capSentence } from "./loan-cap.mjs";
import { BASIS_DATE as POLICY_DATE_BASIS, policyShort, policySentence } from "./policy-loan.mjs";
import { BASIS_DATE as MIN_CASH_DATE, minCash, minCashSentence } from "./min-cash.mjs";
import { WOLSE_CONVERSION_RATE } from "./realestate-metrics.mjs";
import { rateFacts, factSentences as rateSentences } from "./rate-facts.mjs";
import {
  KIND_FIELDS,
  areaPrice,
  formatEok,
  formatMan,
  formatPercent,
  jeonseRatio,
  metricOf,
  monthLabel,
  resolveMetric,
  valueOf,
} from "./realestate-format.mjs";

const root = path.resolve(import.meta.dirname, "..");
const INDEX_PATH = path.join(root, "docs/index.html");
const RATES_PATH = path.join(root, "docs/rates.html");
const NEWS_PATH = path.join(root, "docs/news.html");
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

export const MIN_SAMPLE = 5;
// 첫 화면에 그리는 자치구 수. 모바일에서 표는 행마다 카드로 펼쳐지므로
// 열한 행이면 요약까지 1,500px을 내려야 한다. 나머지는 표 밑 '더 보기'로 편다.
// index.html의 MAX_VISIBLE_DISTRICTS와 같아야 한다 - 다르면 자바스크립트가
// 붙는 순간 표 길이가 튀고, 그걸 index-realestate-rows 검사가 잡는다.
const MAX_DISTRICTS = 4;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function summaryHtml(summary) {
  const highlights = (summary?.highlights ?? []).filter((h) => h.textKo);
  const categories = (summary?.categories ?? []).filter((c) => c.lineKo);
  if (!highlights.length && !categories.length) return null;

  return [
    ...highlights.map((h) => `<p><strong>${escapeHtml(h.title)}</strong> ${escapeHtml(h.textKo)}</p>`),
    ...categories.map((c) => `<p><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.lineKo)}</p>`),
  ].join("");
}

export function marketHtml(market) {
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

const man = (value) => `${Number(value).toLocaleString("ko-KR")}만원`;

const lowSampleText = (metric) =>
  `<span class="low-sample" title="신고 ${metric.transactionCount}건이라 평균을 내기엔 표본이 부족합니다">` +
  `표본 ${metric.transactionCount}건</span>`;

const changeText = (change) => {
  if (!change || typeof change.value10k !== "number") return "";
  const sign = change.value10k > 0 ? "+" : change.value10k < 0 ? "-" : "";
  return ` <span class="change">${sign}${Math.abs(change.value10k).toLocaleString("ko-KR")}만</span>`;
};
const countText = (metric) =>
  typeof metric?.transactionCount === "number"
    ? ` <span class="count">${metric.transactionCount.toLocaleString("ko-KR")}건</span>`
    : "";
const enough = (metric) => Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

const metricCell = (metric, valueText) => {
  if (!metric) return "-";
  if (!enough(metric)) return lowSampleText(metric);
  return valueText(metric) ?? "-";
};

const saleCell = (sale) =>
  metricCell(sale, (m) =>
    m.avgPricePerPyeong10k ? `${man(m.avgPricePerPyeong10k)}${changeText(m.change)}${countText(m)}` : null
  );
const jeonseCell = (jeonse) =>
  metricCell(jeonse, (m) =>
    m.avgDepositPerPyeong10k ? `${man(m.avgDepositPerPyeong10k)}${changeText(m.change)}${countText(m)}` : null
  );
const wolseCell = (wolse) =>
  metricCell(wolse, (m) =>
    m.avgDeposit10k ? `${man(m.avgDeposit10k)} / 월 ${man(m.avgMonthlyRent10k)}${countText(m)}` : null
  );

export function realestateHtml(realestate) {
  if (!realestate?.overall) return null;

  const priceOf = (d) => ((d.sale?.transactionCount ?? 0) >= MIN_SAMPLE ? d.sale?.avgPricePerPyeong10k ?? null : null);
  const districts = [...(realestate.districts ?? [])]
    .sort((a, b) => {
      const [x, y] = [priceOf(a), priceOf(b)];
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    })
    .slice(0, MAX_DISTRICTS);

  const row = (name, data) =>
    `<tr><td>${escapeHtml(name)}</td>` +
    `<td data-label="매매">${saleCell(data.sale)}</td>` +
    `<td data-label="전세">${jeonseCell(data.jeonse)}</td>` +
    `<td data-label="월세">${wolseCell(data.wolse)}</td></tr>`;

  return [row("서울 전체", realestate.overall), ...districts.map((d) => row(d.name, d))].join("");
}

export function newsContextHtml(context) {
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

/**
 * 첫 화면 뉴스는 다섯 건만 - 부동산 먼저. 전에는 스물네 건이 다 실려 AI 요약의 주제별 헤드라인과 같은 기사를
 * 두 번 싣고 모바일 첫 화면의 58%를 차지했다(UIUX #48). 나머지는 뉴스 화면으로 보낸다. 화면(index.html
 * renderNews)도 같은 규칙이다.
 */
export const INDEX_NEWS = 5;
export function indexNewsItems(items) {
  const list = items ?? [];
  return [...list.filter((i) => i.category === "realestate"), ...list.filter((i) => i.category !== "realestate")].slice(0, INDEX_NEWS);
}

export function newsHtml(news) {
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

const budgetBandLabel = (band) => {
  const from = Math.round(band.min10k / 10_000);
  const to = band.max10k === null ? null : Math.round(band.max10k / 10_000);
  if (to === null) return `${from}억 이상`;
  if (from === 0) return `${to}억 미만`;
  return `${from}억대`;
};

const budgetWhen = (date) => {
  const [, month, day] = String(date ?? "").split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : "";
};

function budgetDealHtml(deal) {
  const place = [deal.district, deal.dong, deal.apt].filter(Boolean).join(" ");
  const spec = [`${deal.area}㎡`, deal.floor ? `${deal.floor}층` : null].filter(Boolean).join(" · ");
  return (
    `<li class="budget-deal">` +
    `<span class="place">${escapeHtml(place)}</span>` +
    `<span class="spec">${escapeHtml(spec)}</span>` +
    `<span class="when">${escapeHtml(budgetWhen(deal.date))}</span>` +
    `<span class="price">${escapeHtml(formatEok(deal.amount10k))}</span>` +
    `</li>`
  );
}

/**
 * 이 예산이 서울에서 어디로 가는가.
 *
 * 지역 순위는 이미 아래 줄에 숫자로 있지만, 숫자를 세 개 읽고 나서야 알게 되는 것과
 * 한 문장으로 읽는 것은 다르다. 그리고 예산대마다 답이 실제로 다르다 — 4억대는 노원·
 * 도봉·중랑이고 18억대는 강동·송파·성동이라, 이 한 줄이 열여덟 장에서 열여덟 번
 * 다른 말을 한다.
 *
 * 상위 세 구가 절반을 넘을 때만 쓴다. 고르게 흩어진 예산대에서 "여기에 몰려 있다"고
 * 하면 사실이 아니고, 그럴 때는 흩어졌다는 것이 답이다.
 */
function budgetWhereHtml(band) {
  const districts = band.districts ?? [];
  if (districts.length < 3 || !band.count) return "";

  const top3 = districts.slice(0, 3);
  const share = top3.reduce((sum, d) => sum + d.count, 0) / band.count;
  const names = top3.map((d) => d.name).join("·");
  const label = budgetBandLabel(band);

  const text =
    share >= 0.5
      ? `${label} 거래의 ${Math.round(share * 100)}%가 ${names} 세 곳에서 나왔습니다. 이 예산으로 서울에서 고를 수 있는 곳은 사실상 여기입니다.`
      : districts.length >= 10
        ? `${label} 거래는 ${districts.length}개 구에 흩어져 있고 상위 세 곳(${names})을 합쳐도 ${Math.round(share * 100)}%입니다. 이 예산에서는 지역이 아니라 단지가 선택을 가릅니다.`
        : "";

  // data-prerendered: 화면이 요약을 다시 그릴 때 이 문단이 지워지지 않게(#43에서 발견 - 전에는 지워졌다).
  return text ? `<p class="budget-where" data-prerendered>${escapeHtml(text)}</p>` : "";
}

export function budgetBodyHtml(band, periodList, rates = null, mortgageSeries = null, complexFiles = null, capStats = null, policyCounts = null) {
  if (!band) return null;

  const periods = (periodList ?? []).map((p) => monthLabel(p)).filter(Boolean).join(", ");
  const districts = (band.districts ?? [])
    .map((d) => `${escapeHtml(d.name)} ${d.count.toLocaleString("ko-KR")}`)
    .join(" · ");

  // 순서: 거래 요약 → 한눈에(돈 네 줄) → 후보 단지 → 돈 문단(근거) → 다음 질문 → 거래 12줄(예시).
  // 후보가 "이 돈이면 어디"의 답이고 거래 12줄은 예시라 맨 뒤다(UIUX #43). 화면(realestate.html)은
  // 요약을 다시 그리고 data-prerendered 덩어리를 이 순서 그대로 붙인 뒤 거래 목록을 붙인다 - 둘이 같아야 한다.
  return (
    `<p class="budget-summary">${escapeHtml(`${budgetBandLabel(band)}에서 ${band.count.toLocaleString("ko-KR")}건이 거래됐습니다${band.direct ? `(직거래 ${band.direct.toLocaleString("ko-KR")}건 포함)` : ""}.`)}` +
    (periods ? ` <span class="when">${escapeHtml(`${periods} 신고분 기준`)}</span>` : "") +
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

/**
 * 예산대 장 맨 위의 "한눈에" — 아래 문단 넷의 답만 한 줄씩(UIUX #43). 숫자는 문단과 같은 함수에서 나온다
 * (min-cash·purchase-costs·mortgage·policy-loan). 숫자 하나만 덩그러니 두지 않고 무엇의 값인지 앞에 적는다.
 */
export function budgetAnswersHtml(band, rates = null) {
  const eok = Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null;
  if (eok === null) return "";
  const price = (eok + 0.5) * 10_000;
  const g = minCash(price);
  const f = minCash(price, { firstTime: true });
  const costs = purchaseCosts(price);
  const spread = rateSpread(apartmentOptions(rates));
  const perEok = spread ? monthlyPayment(10_000, spread.mid) : null;
  const policy = policyShort(eok);
  const line = (label, value, note = "", text = false) =>
    `<li><span class="answer-label">${escapeHtml(label)}</span>` +
    `<strong class="answer-value${text ? " answer-text" : ""}">${escapeHtml(value)}</strong>` +
    (note ? `<span class="answer-note">${escapeHtml(note)}</span>` : "") +
    `</li>`;
  const lines = [
    line("자기 돈이 적어도", eokText(g.cash), f.cash < g.cash ? `생애최초면 ${eokText(f.cash)}` : ""),
    perEok ? line("1억을 빌리면 매달", eokText(Math.round(perEok)), `30년 원리금균등, 연 ${spread.mid}%`) : "",
    line("매매가 위에 더 드는 돈", eokText(costs.total), "취득세·지방교육세·중개보수 상한"),
    policy ? line("정책대출 가격선", policy, "", true) : "",
  ].join("");
  return (
    `<section class="budget-answers" data-prerendered>` +
    `<h3>${escapeHtml(`${eokText(price)}짜리를 산다면 — 한눈에`)}</h3><ul>${lines}</ul>` +
    `<p class="answer-more">근거와 예외는 아래 문단의 링크(→)에 있습니다.</p></section>`
  );
}

/**
 * 장마다 똑같던 규칙 문단을 옮겨 간 자리(method.html의 #budget-rules-*)로 가는 링크(#66).
 * 문단 끝에 붙어, 숫자만 남은 문단에서도 예외·원문 기준일이 한 번 눌러 닿는 거리에 있게 한다.
 */
export const budgetRuleLink = (id, text) => ` <a class="budget-rule-link" href="./method.html#budget-rules-${id}">${escapeHtml(text)}</a>`;

/** 예산을 정한 사람이 다음에 묻는 것들로 가는 길(PO 검토 #33 - 예산대에서 이 화면들로 가는 링크가 0개였다). */
export function budgetMoreHtml() {
  const links = [
    ["./floor-gap.html", "1층·최상층은 얼마나 싸야 정상인가"],
    ["./record-high.html", "신고가가 나왔다는데 그 값인가"],
    ["./switch-house.html", "갈아타기 — 갈 동네는 얼마나 올랐나"],
    ["./price-outlook.html", "3개월 뒤 아파트값과 그 오차"],
    ["./cancelled-deals.html#month-section", "계약에서 등기(잔금)까지 걸리는 날"],
  ];
  return (
    `<section class="budget-more-links" data-prerendered><h3>매물을 보러 가기 전에</h3><ul>` +
    links.map(([href, text]) => `<li><a href="${href}">${escapeHtml(text)}</a></li>`).join("") +
    `</ul></section>`
  );
}

/** 최소 필요 현금(scripts/min-cash.mjs) - 소득과 무관한 대출 천장(LTV·구간 상한)으로 계산한다(#31). */
export function budgetMinCashHtml(band) {
  const eok = Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null;
  const sentence = minCashSentence(eok);
  return sentence
    ? `<p class="budget-loan budget-mincash" data-prerendered>${escapeHtml(sentence)}${budgetRuleLink("mincash", `소득·기존 주택 예외와 원문(${MIN_CASH_DATE} 확인) →`)}</p>`
    : "";
}

/** 정책대출 가격선에 걸친 예산대(4~9억대)에만 붙는 한 줄(scripts/policy-loan.mjs). */
export function budgetPolicyHtml(band, policyCounts) {
  const eok = Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null;
  const sentence = policySentence(eok, policyCounts);
  return sentence
    ? `<p class="budget-loan budget-policy" data-prerendered>${escapeHtml(sentence)}${budgetRuleLink("policy", `가격선 정의와 거래 수(${POLICY_DATE_BASIS} 확인) →`)}</p>`
    : "";
}

/** 15억 경계에 걸친 예산대에만 붙는 주담대 상한 한 줄(scripts/loan-cap.mjs). */
export function budgetCapHtml(band, capStats) {
  const eok = Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null;
  const sentence = capSentence(eok, capStats);
  // 16억대 이상은 구간표·소득 단서가 method.html로 갔다. 14·15억대 문장은 그대로 장에 있다.
  const moved = Number.isFinite(eok) && eok >= 16 && eok <= 24;
  return sentence
    ? `<p class="budget-loan budget-cap" data-prerendered>${escapeHtml(sentence)}${moved ? budgetRuleLink("cap", `구간표와 원문(${CAP_DATE} 확인) →`) : ""}</p>`
    : "";
}

/** 목록에 이름을 올리는 단지 수. 나머지는 검색의 "단지로 묶어 보기"로 보낸다 - 열여덟 장이 같은 긴 목록이 되지 않게. */
export const CANDIDATE_LIST = 12;

const eokText = (value10k) => {
  const n = Math.round(value10k);
  const eok = Math.floor(n / 10_000);
  const man = n % 10_000;
  if (!eok) return `${man.toLocaleString("ko-KR")}만원`;
  return man ? `${eok}억 ${man.toLocaleString("ko-KR")}만원` : `${eok}억원`;
};

/**
 * 이 예산대에 드는 단지·평형(단지 후보). 기준 달 값으로 고친 중앙값으로 가른다 - 거래 목록은 "언제
 * 얼마에 팔렸나"이고, 이것은 "지금 이 예산이면 어느 단지의 어느 평형인가"다(scripts/complex-price.mjs).
 * 자치구는 거르는 조건이 아니라 묶는 축이다 - 자치구를 먼저 고르게 하면 겹친 조건에서 빈 화면이 잦다.
 */
export function budgetCandidatesHtml(band, complexFiles) {
  if (!band || !complexFiles?.length) return "";
  const min = band.min10k;
  const max = band.max10k ?? min + 10_000;
  const rows = candidatesInBand(complexFiles, min, max);
  const reference = complexFiles[0]?.reference;
  const month = reference ? `${reference.slice(0, 4)}년 ${Number(reference.slice(4))}월` : "기준 달";
  const label = `${min / 10_000}억대`;
  if (!rows.length) {
    return (
      `<section class="budget-candidates" data-prerendered><h3>이 예산대의 단지 후보</h3>` +
      `<p>${escapeHtml(`${month} 값으로 고친 중앙값이 ${label}인 단지·평형이 없습니다. 같은 평형이 6개월 동안 3번 이상 거래돼야 범위를 낼 수 있습니다.`)}</p></section>`
    );
  }
  const byDistrict = new Map();
  for (const row of rows) byDistrict.set(row.district, (byDistrict.get(row.district) ?? 0) + 1);
  const districts = [...byDistrict].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  // 평형대로 나눈다 - 상위가 재건축 소형으로만 채워지면 59·84형을 찾는 사람이 다시 걸러야 했다(#35).
  const BANDS = [
    ["60㎡ 미만", (r) => r.area < 60],
    ["60~85㎡", (r) => r.area >= 60 && r.area <= 85],
    ["85㎡ 초과", (r) => r.area > 85],
  ];
  const per = Math.floor(CANDIDATE_LIST / BANDS.length);
  const first = BANDS.flatMap(([, f]) => rows.filter(f).slice(0, per));
  // 한 평형대가 모자라면 남은 자리는 다른 평형대의 다음 순번으로 채운다 - 목록 길이는 예산대마다 같다.
  const picked = [...first, ...rows.filter((r) => !first.includes(r)).slice(0, CANDIDATE_LIST - first.length)];
  const list = picked
    .sort((a, b) => a.area - b.area || b.n - a.n)
    .map((row) => {
      const href = `./deal-search.html?district=${encodeURIComponent(row.district)}&apt=${encodeURIComponent(row.apt)}`;
      const facts = [row.district, row.dong, `${row.area}\u33a1`, row.buildYear ? `${row.buildYear}년` : null].filter(Boolean).join(" · ");
      const range = `${row.quartile ? "가운데 절반" : "최저~최고"} ${eokText(row.low)}~${eokText(row.high)}`;
      return (
        `<li class="budget-deal"><a class="apt" href="${escapeHtml(href)}">${escapeHtml(row.apt)}</a>` +
        `<span class="meta">${escapeHtml(facts)}</span>` +
        `<span class="amount">${escapeHtml(eokText(row.median))}</span>` +
        `<span class="meta">${escapeHtml(`${range} · ${row.n}건`)}</span></li>`
      );
    })
    .join("");
  const bandCounts = BANDS.map(([label, f]) => `${label} ${rows.filter(f).length}`).join(" · ");
  return (
    `<section class="budget-candidates" data-prerendered><h3>이 예산대의 단지 후보</h3>` +
    `<p>${escapeHtml(
      `${month} 값으로 고친 중앙값이 ${label}인 단지·평형은 서울에 ${rows.length.toLocaleString("ko-KR")}곳입니다. ` +
        `같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.`
    )}</p>` +
    `<div class="budget-districts">${escapeHtml(`평형대별: ${bandCounts}`)}</div>` +
    `<div class="budget-districts">${escapeHtml(`자치구별: ${districts.map(([d, n]) => `${d} ${n}`).join(" · ")}`)}</div>` +
    `<ul class="budget-deals">${list}</ul>` +
    `<p class="budget-more"><a href="./deal-search.html?budget=${min / 10_000}&amp;group=1">${escapeHtml(
      rows.length > CANDIDATE_LIST
        ? `평형대마다 거래가 많은 곳을 고루 ${picked.length}곳만 적었습니다. ${rows.length}곳 전부와 평형·연식 조건은 실거래 검색에서 단지로 묶어 보세요 →`
        : "평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →"
    )}</a></p></section>`
  );
}

/**
 * "매매가 말고 드는 돈". 규칙과 기준일은 scripts/purchase-costs.mjs 한 곳에 있다. 월 상환액과
 * 같은 상자를 쓴다 - 둘 다 "그래서 실제로 얼마"에 답하는 문단이다.
 */
export function budgetCostsHtml(band) {
  const eok = Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null;
  const sentence = costsSentence(eok);
  return sentence
    ? `<p class="budget-loan budget-costs" data-prerendered>${escapeHtml(sentence)}${budgetRuleLink("costs", `중과·예외와 원문(${COSTS_DATE} 확인) →`)}</p>`
    : "";
}

/**
 * 예산대 페이지가 자기 이야기를 하는 문단.
 *
 * 자치구 페이지의 `districtFactsHtml`과 같은 자리에 같은 방식으로 들어간다 — 두 언어를
 * 빌드에서 미리 만들어 두 벌 다 굽고, 화면은 `data-summary-lang`으로 고르기만 한다.
 */
export function budgetFactsHtml(band, locale = "ko") {
  const sentences = budgetFactSentences(band?.facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

/**
 * "그래서 매달 얼마"를 붙인다. 이 화면은 예산에 답하면서 정작 그 예산이 매달 얼마가
 * 되는지는 말하지 않고 있었다 - 실거래와 금리를 같이 받는 곳이라야 자동으로 물릴 수 있다.
 */
export function budgetLoanHtml(band, rates, mortgageSeries = null) {
  const spread = rateSpread(apartmentOptions(rates));
  const eok = Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null;
  const sentence = loanSentence(spread, { eok });
  if (!sentence) return "";
  // 1억당 값·금리 범위와 1년 사이 변화(mortgageSeries로 만든 문장)는 열여덟 장에서 같은 값이라
  // method.html로 갔다(scripts/budget-rules.mjs, #66). mortgageSeries 인자는 호출부 호환으로 남긴다.
  return `<p class="budget-loan" data-prerendered>${sentence}${budgetRuleLink("loan", "1억당 값과 금리 근거 →")}</p>`;
}

export { budgetBandLabel };

function linksBlockHtml(id, heading, links) {
  if (!links) return "";
  return (
    `<h3 class="district-links-heading" id="${id}-heading">${escapeHtml(heading)}</h3>` +
    `<div class="district-links" id="${id}">${links}</div>`
  );
}

export function newsRealestateStatsHtml(news) {
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

/**
 * 증시 뉴스 장의 코스피 카드(UIUX #56). 첫 화면 "돈의 값"에서 옮겨 왔다 - 계약을 앞둔 사람의 질문이
 * 아니라서(DIRECTION 1부 대상). 하루 늦은 종가라 어느 장의 값인지 같이 적는다.
 */
export function newsKospiHtml(market) {
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

export function newsSummaryHtml(summary, category = null) {
  const all = (summary?.categories ?? []).filter((c) => c.lineKo);
  const shown = category ? all.filter((c) => c.key === category) : all;
  if (!shown.length) return null;
  return shown
    .map((c) => `<p><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.lineKo)}</p>`)
    .join("");
}

export function newsListHtml(news, category = null) {
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

const RE_LABELS = {
  district: "지역",
  sale: "매매",
  jeonse: "전세",
  wolse: "월세",
  colSale: "매매 평당가",
  colJeonse: "전세 평당 보증금",
  colWolse: "월세 보증금 / 월세",
  perPyeong: "평당가",
  perPyeongDeposit: "평당 보증금",
  area: "84㎡ 환산",
  deposit: "평균 보증금",
  monthly: "평균 월세",
  count: "거래건수",
  ratio: "전세가율",
  ratioByComplex: "전세가율 단지별 중앙값",
  overall: "서울 전체",
};

const reCount = (n) => `${n.toLocaleString("ko-KR")}건`;
const reMan = (v) => formatMan(v);
const reEok = (v) => formatEok(v);

function reHeadLabels(kind) {
  if (!kind) return [RE_LABELS.district, RE_LABELS.colSale, RE_LABELS.colJeonse, RE_LABELS.colWolse];
  if (kind === "wolse") return [RE_LABELS.district, RE_LABELS.deposit, RE_LABELS.monthly, RE_LABELS.count];
  if (kind === "jeonse") {
    return [RE_LABELS.district, RE_LABELS.perPyeongDeposit, RE_LABELS.area, RE_LABELS.ratio, RE_LABELS.count];
  }
  return [RE_LABELS.district, RE_LABELS.perPyeong, RE_LABELS.area, RE_LABELS.count];
}

export function realestateHeadHtml(kind = null, district = null) {
  const labels = district
    ? ["구분", RE_LABELS.perPyeong, RE_LABELS.area, RE_LABELS.count]
    : reHeadLabels(kind);
  return `<tr>${labels.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr>`;
}

function reChange(change, baselineDate) {
  if (!change || typeof change.value10k !== "number" || change.value10k === 0) return "";
  const dir = change.value10k > 0 ? "up" : "down";
  const arrow = change.value10k > 0 ? "▲" : "▼";
  const title = baselineDate ? ` title="${escapeHtml(`${baselineDate} 대비`)}"` : "";
  return ` <span class="change ${dir}"${title}>${arrow}${reMan(Math.abs(change.value10k))}</span>`;
}

function reWolseChange(change, baselineDate) {
  if (!change || typeof change.percent !== "number" || change.value10k === 0) return "";
  const dir = change.value10k > 0 ? "up" : "down";
  const arrow = change.value10k > 0 ? "▲" : "▼";
  const rate = `${(WOLSE_CONVERSION_RATE * 100).toFixed(1)}%`;
  const title = baselineDate
    ? ` title="${escapeHtml(`${baselineDate} 대비 · 보증금과 월세를 묶은 ㎡당 값(보증금 + 월세×12÷${rate})의 증감 — 그 주에 신고된 방 크기가 달라서 생기는 흔들림을 덜어 낸 값입니다`)}"`
    : "";
  return ` <span class="change ${dir}"${title}>${arrow}${Math.abs(change.percent).toFixed(1)}%</span>`;
}

const reCountSpan = (metric) =>
  typeof metric?.transactionCount === "number"
    ? ` <span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`
    : "";


function reLowSample(metric) {
  const n = metric?.transactionCount ?? 0;
  return `<span class="low-sample" title="${escapeHtml(`이번 달 신고가 ${n}건뿐이라 평균을 내지 않았습니다.`)}">${escapeHtml(`신고 ${n}건`)}</span>`;
}

function reCells(entry, kind) {
  const resolved = resolveMetric(entry, kind);
  if (!resolved) {
    const raw = entry?.[KIND_FIELDS[kind].metric];
    return [raw ? reLowSample(raw) : "-", "-", "-"];
  }
  const { metric } = resolved;
  const change = (c, d) => reChange(c, d);

  if (kind === "wolse") {
    return [
      `<span class="price-strong">${reMan(metric.avgDeposit10k)}</span>`,
      `<span class="price-strong">월 ${reMan(metric.avgMonthlyRent10k)}</span>${reWolseChange(metric.change, metric.baselineDate)}`,
      `<span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`,
    ];
  }
  const perPyeong = valueOf(metric, kind);
  const cells = [
    `<span class="price-strong">${reMan(perPyeong)}</span>${change(metric.change, metric.baselineDate)}`,
    `<span class="price-strong">${reEok(areaPrice(perPyeong))}</span>`,
  ];
  if (kind === "jeonse") {
    const ratio = jeonseRatio(entry);
    cells.push(ratio ? `<span class="ratio">${formatPercent(ratio.ratio)}</span>` : "-");
  }
  cells.push(`<span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`);
  return cells;
}

function reAllCells(entry) {
  return ["sale", "jeonse", "wolse"].map((kind) => {
    const resolved = resolveMetric(entry, kind);
    if (!resolved) {
      const raw = entry?.[KIND_FIELDS[kind].metric];
      return raw ? reLowSample(raw) : "-";
    }
    const { metric } = resolved;
    if (kind === "wolse") {
      return `${reMan(metric.avgDeposit10k)} / 월 ${reMan(metric.avgMonthlyRent10k)}${reCountSpan(metric)}`;
    }
    const change = reChange(metric.change, metric.baselineDate);
    return `${reMan(valueOf(metric, kind))}${change}${reCountSpan(metric)}`;
  });
}

function reStaleTag(entry) {
  const at = entry?.staleAt;
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const label = date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
  return ` <span class="prev-tag" title="${escapeHtml("이 지역은 오늘 실거래 조회에 실패해 지난번에 받은 값을 그대로 보여줍니다.")}">${escapeHtml(label)}</span>`;
}

function reDistrictLink(label) {
  const slug = DISTRICT_SLUGS[label];
  return slug ? `<a href="./${districtFile(slug)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

function reRow(entry, label, isOverall, kind) {
  const labels = reHeadLabels(kind);
  const cells = kind ? reCells(entry, kind) : reAllCells(entry);
  const body = cells
    .map((cell, i) => `<td data-label="${escapeHtml(labels[i + 1])}">${cell}</td>`)
    .join("");
  const name = isOverall ? escapeHtml(label) : reDistrictLink(label);
  return `<tr class="${isOverall ? "overall-row" : ""}"><td>${name}${reStaleTag(entry)}</td>${body}</tr>`;
}

function reSorted(districts, kind) {
  const key = kind ?? "sale";
  return [...districts].sort((a, b) => {
    const av = valueOf(resolveMetric(a, key)?.metric, key);
    const bv = valueOf(resolveMetric(b, key)?.metric, key);
    if (av === null && bv === null) return (a.name ?? "").localeCompare(b.name ?? "");
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
}

function reDistrictRows(entry) {
  const labels = [RE_LABELS.sale, RE_LABELS.jeonse, RE_LABELS.wolse];
  return ["sale", "jeonse", "wolse"]
    .map((kind, i) => {
      const cell = (price, area, count) =>
        `<tr><td>${escapeHtml(labels[i])}</td>` +
        `<td data-label="${escapeHtml(RE_LABELS.perPyeong)}">${price}</td>` +
        `<td data-label="${escapeHtml(RE_LABELS.area)}">${area}</td>` +
        `<td data-label="${escapeHtml(RE_LABELS.count)}">${count}</td></tr>`;

      const resolved = resolveMetric(entry, kind);
      if (!resolved) {
        const raw = entry?.[KIND_FIELDS[kind].metric];
        return cell(raw ? reLowSample(raw) : "-", "-", "-");
      }
      const { metric } = resolved;
        const change = reChange(metric.change, metric.baselineDate);
      const price =
        kind === "wolse"
          ? `<span class="price-strong">${reMan(metric.avgDeposit10k)}</span> / <span class="price-strong">월 ${reMan(metric.avgMonthlyRent10k)}</span>`
          : `<span class="price-strong">${reMan(valueOf(metric, kind))}</span>${change}`;
      const area = kind === "wolse" ? "-" : `<span class="price-strong">${reEok(areaPrice(valueOf(metric, kind)))}</span>`;
      return cell(price, area, `<span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`);
    })
    .join("");
}

export function realestateTableHtml(realestate, kind = null, district = null) {
  const districts = realestate?.districts ?? [];
  if (district) {
    const entry = districts.find((d) => d.name === district);
    return entry ? reDistrictRows(entry) : null;
  }
  if (!realestate?.overall && !districts.length) return null;
  return (
    (realestate.overall ? reRow(realestate.overall, RE_LABELS.overall, true, kind) : "") +
    reSorted(districts, kind)
      .map((d) => reRow(d, d.name ?? "-", false, kind))
      .join("")
  );
}

export function realestateOverallHtml(realestate, kind = null, district = null, spread = null) {
  const overall = district
    ? (realestate?.districts ?? []).find((d) => d.name === district)
    : realestate?.overall;
  if (!overall) return null;

  const card = (label, value, sub) =>
    `<div class="overall-card"><div class="label">${escapeHtml(label)}</div>` +
    `<div class="value">${value}</div>` +
    (sub ? `<div class="sub">${sub}</div>` : "") +
    `</div>`;

  // 전세가율 카드 옆에 칸 하나하나에서 낸 값의 중앙값을 나란히 둔다.
  // 표의 값은 이 표의 두 열을 나눈 것이라 표와는 맞고, 이 값은 실제 단지와 맞는다.
  // 하나를 다른 하나로 갈아 끼우면 같은 행의 숫자들과 어긋나므로 둘을 같이 둔다.
  const complexCard = () =>
    spread
      ? card(
          RE_LABELS.ratioByComplex,
          formatPercent(spread.median),
          escapeHtml(`단지·평형 ${spread.cells.toLocaleString("ko-KR")}칸`)
        )
      : "";

  if (district) {
    const sale = resolveMetric(overall, "sale")?.metric;
    const ratio = jeonseRatio(overall);
    return (
      (sale
        ? card(RE_LABELS.perPyeong, reMan(valueOf(sale, "sale")), "") +
          card(RE_LABELS.area, reEok(areaPrice(valueOf(sale, "sale"))), "") +
          card(RE_LABELS.count, escapeHtml(reCount(sale.transactionCount)), "")
        : card(RE_LABELS.sale, "-", "")) +
      (ratio ? card(RE_LABELS.ratio, formatPercent(ratio.ratio), "") : "") +
      complexCard()
    );
  }

  if (!kind) {
    return ["sale", "jeonse", "wolse"]
      .map((k) => {
        const metric = resolveMetric(overall, k)?.metric;
        const label = RE_LABELS[k === "sale" ? "colSale" : k === "jeonse" ? "colJeonse" : "colWolse"];
        if (!metric) return card(label, "-", "");
        if (k === "wolse") {
          return card(
            label,
            `${reMan(metric.avgDeposit10k)} / 월 ${reMan(metric.avgMonthlyRent10k)}`,
            escapeHtml(reCount(metric.transactionCount))
          );
        }
        return card(
          label,
          reMan(valueOf(metric, k)),
          `${escapeHtml(RE_LABELS.area)} ${reEok(areaPrice(valueOf(metric, k)))} · ${escapeHtml(reCount(metric.transactionCount))}`
        );
      })
      .join("");
  }

  const metric = resolveMetric(overall, kind)?.metric;
  if (!metric) return card(RE_LABELS.overall, "-", "");
  if (kind === "wolse") {
    return (
      card(RE_LABELS.deposit, reMan(metric.avgDeposit10k), "") +
      card(RE_LABELS.monthly, `월 ${reMan(metric.avgMonthlyRent10k)}`, "") +
      card(RE_LABELS.count, escapeHtml(reCount(metric.transactionCount)), "")
    );
  }
  const perPyeong = valueOf(metric, kind);
  const ratio = kind === "jeonse" ? jeonseRatio(overall) : null;
  return (
    card(kind === "jeonse" ? RE_LABELS.perPyeongDeposit : RE_LABELS.perPyeong, reMan(perPyeong), "") +
    card(RE_LABELS.area, reEok(areaPrice(perPyeong)), "") +
    (ratio ? card(RE_LABELS.ratio, formatPercent(ratio.ratio), "") : "") +
    (kind === "jeonse" ? complexCard() : "") +
    card(RE_LABELS.count, escapeHtml(reCount(metric.transactionCount)), "")
  );
}

export function districtSummaryHtml(realestate, district, locale = "ko", spread = null) {
  if (!district) return "";
  const entry = (realestate?.districts ?? []).find((d) => d.name === district);
  const sentences = districtSentences(entry, realestate, locale, spread);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

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
export function districtRenewalHtml(facts, locale = "ko") {
  const sentences = renewalSentences(facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

export function districtFactsHtml(facts, locale = "ko") {
  const sentences = factSentences(facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

export function districtLinksHtml(current = null, heading = "다른 지역") {
  const links = DISTRICT_PAGES.map(({ name, file }) =>
    name === current
      ? `<a href="./${file}" aria-current="page">${escapeHtml(name)}</a>`
      : `<a href="./${file}">${escapeHtml(name)}</a>`
  ).join("");
  return linksBlockHtml("district-links", heading, links);
}

const RATES_TERM = 12;
const RATES_ROWS = 20;
const SAVING_CATEGORIES = new Set(["deposit", "saving"]);

const rate = (value) => (typeof value === "number" ? `${value.toFixed(2)}%` : "-");
const rateRange = (min, max) =>
  typeof min === "number" && typeof max === "number" ? `${min.toFixed(2)}~${max.toFixed(2)}%` : rate(min ?? max);

const RATE_CATEGORIES = ["deposit", "saving", "mortgage", "rentLoan"];

/**
 * 표가 보여주는 것 옆에 붙는 문단.
 *
 * 어느 상품군인지는 이 페이지에서 탭으로 바뀐다 — 페이지를 다시 받지 않는다. 그래서
 * 네 상품군 것을 빌드에서 미리 계산해 한 덩이로 넘기고, 화면은 고르기만 한다. 같은
 * 계산을 브라우저 쪽에 한 벌 더 두면 차트 코드처럼 두 곳을 같이 고쳐야 하는 짐이 하나
 * 더 생기고, 실제로 그 짐 때문에 같은 수정을 두 번 한 적이 있다.
 */
export function rateFactsData(rates) {
  const out = {};
  for (const category of RATE_CATEGORIES) {
    const facts = rateFacts(rates, category);
    out[category] = { ko: rateSentences(facts, "ko"), en: rateSentences(facts, "en") };
  }
  return out;
}

/**
 * `<script type="application/json">` 안에 넣을 수 있게 만든 JSON.
 *
 * `JSON.stringify`는 `<`도 `/`도 건드리지 않는다. 상품 이름에 `</script`가 들어 있으면
 * 그 자리에서 스크립트 태그가 닫히고 뒤가 마크업이 된다 — 이 데이터는 금감원 API에서
 * 그대로 받아 오는 것이라 내용을 우리가 정하지 못한다.
 */
export function jsonForScript(value) {
  return JSON.stringify(value).replaceAll("</", "<\\/").replaceAll("<!--", "<\\u0021--");
}

export function rateFactsHtml(rates, category = "deposit", locale = "ko") {
  const sentences = rateSentences(rateFacts(rates, category), locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

export function ratesHeadHtml(category = "deposit") {
  return SAVING_CATEGORIES.has(category)
    ? "<tr><th scope=\"col\">상품</th><th scope=\"col\">기본금리</th><th scope=\"col\">최고금리</th><th scope=\"col\">세후 이자</th></tr>"
    : "<tr><th scope=\"col\">상품</th><th scope=\"col\">금리 유형</th><th scope=\"col\">금리(최저~최고)</th><th scope=\"col\">평균</th></tr>";
}

export function ratesHtml(rates, { category = "deposit", limit = RATES_ROWS } = {}) {
  const products = rates?.[category] ?? [];
  if (!products.length) return null;

  const saving = SAVING_CATEGORIES.has(category);
  const key = saving ? "maxRate" : "min";
  const asc = !saving;

  const rows = [];
  for (const product of products) {
    let best = null;
    let bestValue = null;
    let fallback = null;
    for (const option of product.options ?? []) {
      if (saving && option.term !== RATES_TERM) continue;
      fallback ??= option;
      const value = option[key];
      if (value === null || value === undefined) continue;
      if (best === null || (asc ? value < bestValue : value > bestValue)) {
        best = option;
        bestValue = value;
      }
    }
    if (best) rows.push({ product, option: best, sort: bestValue });
    else if (fallback) rows.push({ product, option: fallback, sort: null });
  }

  rows.sort((a, b) => {
    if (a.sort === null || b.sort === null) return (a.sort === null) - (b.sort === null);
    return asc ? a.sort - b.sort : b.sort - a.sort;
  });

  if (!rows.length) return null;

  const productCell = (product) =>
    `<td><div class="product-name">${escapeHtml(product.name ?? "-")}</div>` +
    `<div class="product-company">${escapeHtml(product.company ?? "")}</div></td>`;

  const amount = DEFAULT_AMOUNT[saving && category === "saving" ? "saving" : "deposit"];
  const netCell = (option) => {
    const net = netInterestOf(option, { amount, saving: category === "saving" });
    return net === null ? "-" : formatWon(net);
  };

  return rows
    .slice(0, limit)
    .map(({ product, option }) =>
      saving
        ? `<tr>${productCell(product)}<td data-label="기본금리">${rate(option.rate)}</td>` +
          `<td class="rate-strong" data-label="최고금리">${rate(option.maxRate ?? option.rate)}</td>` +
          `<td class="net-interest" data-label="세후 이자">${netCell(option)}</td></tr>`
        : `<tr>${productCell(product)}<td data-label="금리 유형">${escapeHtml(option.rateType ?? "-")}</td>` +
          `<td data-label="금리(최저~최고)">${rateRange(option.min, option.max)}</td>` +
          `<td class="rate-low" data-label="평균">${rate(option.avg)}</td></tr>`
    )
    .join("");
}

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
export const CONVERSION_BAND = "60to85";

export function conversionLeadHtml(conversion) {
  return conversion?.seoul?.leadKo ? escapeHtml(conversion.seoul.leadKo) : null;
}

export function conversionTableHtml(conversion, band = CONVERSION_BAND) {
  const rows = (conversion?.cells ?? []).filter((cell) => cell.band === band);
  if (!rows.length) return null;

  const label = conversion.bands?.find((b) => b.key === band)?.label ?? band;
  const eok = (value10k) => `${(Math.round((value10k / 10000) * 100) / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억`;
  const man = (value10k) => `${Math.round(value10k).toLocaleString("ko-KR")}만원`;

  const body = [...rows]
    .sort((a, b) => b.rate - a.rate)
    .map(
      (cell) =>
        `<tr><td>${escapeHtml(cell.district)}</td><td>${cell.rate}%</td>` +
        `<td>${escapeHtml(eok(cell.jeonse10k))}</td>` +
        `<td>${escapeHtml(`${eok(cell.deposit10k)} / ${man(cell.monthly10k)}`)}</td>` +
        `<td>${cell.pairs.toLocaleString("ko-KR")}</td></tr>`
    )
    .join("");

  return (
    `<caption class="cost-label" style="caption-side:top;text-align:left;padding-bottom:8px;">${escapeHtml(`${label} 기준`)}</caption>` +
    `<thead><tr><th scope="col">자치구</th><th scope="col">전환율</th><th scope="col">전세</th><th scope="col">월세</th><th scope="col">단지</th></tr></thead>` +
    `<tbody>${body}</tbody>`
  );
}

export function conversionDistrictLinksHtml(conversion) {
  const slugs = conversion?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}

/** 해제·등기 화면. 조건을 넣을 것이 없는 읽는 화면이라 첫 벌이 곧 본문이다. */
export function cancelLeadHtml(cancellation) {
  return cancellation?.seoul?.leadKo ? escapeHtml(cancellation.seoul.leadKo) : null;
}

/** 문장은 빌더가 두 언어로 만든다(scripts/cancellation.mjs registrationSentence). 화면과 같은 글자를 꽂는다. */
export function cancelMonthLeadHtml(cancellation) {
  const text = cancellation?.seoul?.registrationLead?.ko;
  return text ? escapeHtml(text) : null;
}

export function cancelDistrictsHtml(cancellation) {
  const rows = cancellation?.districts ?? [];
  if (!rows.length) return null;

  const pct = (value) => (value === null || value === undefined ? "-" : `${value}%`);
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.district)}</td><td>${row.deals.toLocaleString("ko-KR")}</td>` +
        `<td>${row.cancelled.toLocaleString("ko-KR")}</td><td>${escapeHtml(pct(row.cancelledShare))}</td>` +
        `<td>${row.stale.toLocaleString("ko-KR")}</td><td>${escapeHtml(pct(row.staleShare))}</td></tr>`
    )
    .join("");

  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">신고</th><th scope="col">해제</th><th scope="col">해제율</th><th scope="col">미등기</th><th scope="col">미등기율</th></tr></thead>` +
    `<tbody>${body}</tbody>`
  );
}

export function cancelMonthsHtml(cancellation) {
  const rows = cancellation?.registrationByMonth ?? [];
  if (!rows.length) return null;

  const mature = new Set(cancellation?.seoul?.registration?.matureMonths ?? []);
  const body = rows
    .map(
      (row) =>
        `<tr${mature.has(row.month) ? ' class="spot"' : ""}><td>${escapeHtml(row.month)}</td>` +
        `<td>${row.filed.toLocaleString("ko-KR")}</td><td>${row.registered.toLocaleString("ko-KR")}</td><td>${row.share}%</td></tr>`
    )
    .join("");

  return `<thead><tr><th scope="col">계약월</th><th scope="col">계약</th><th scope="col">등기 완료</th><th scope="col">완료율</th></tr></thead><tbody>${body}</tbody>`;
}

export function cancelDistrictLinksHtml(cancellation) {
  const slugs = cancellation?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}

/** 재계약 화면. 문턱은 빌더가 이미 적용했으므로 여기서는 형식만 입힌다. */
export function renewalLeadHtml(renewal) {
  return renewal?.lead?.ko ? escapeHtml(renewal.lead.ko) : null;
}

export function renewalCapLeadHtml(renewal) {
  return renewal?.capLead?.ko ? escapeHtml(renewal.capLead.ko) : null;
}

export function renewalDistrictsHtml(renewal) {
  const rows = renewal?.table ?? [];
  if (!rows.length) return null;

  const pct = (value) => (value === null || value === undefined ? "-" : `${value}%`);
  const body = rows
    .map((row) => {
      // 문턱을 못 넘은 칸은 비우지 않는다. 화면 쪽 renderDistrictTable과 같은 규칙이다.
      const gap =
        row.gapMedian === null
          ? '<span class="low-sample">표본 부족</span>'
          : escapeHtml(pct(row.gapMedian));
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${gap}</td>` +
        `<td>${escapeHtml(pct(row.gapCheaperShare))}</td><td>${row.gapMatched.toLocaleString("ko-KR")}</td>` +
        `<td>${escapeHtml(pct(row.capMissShare))}</td><td>${row.rightUsed.toLocaleString("ko-KR")}</td></tr>`
      );
    })
    .join("");

  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">갱신 − 신규</th><th scope="col">시세보다 싼 비율</th>` +
    `<th scope="col">맞물린 계약</th><th scope="col">상한 미달</th><th scope="col">요구권 행사</th></tr></thead><tbody>${body}</tbody>`
  );
}

export function renewalWolseLeadHtml(renewal) {
  return renewal?.wolseLead?.ko ? escapeHtml(renewal.wolseLead.ko) : null;
}

/** 월세 재계약 표. 화면 쪽 renderWolse와 같은 모양이다. */
export function renewalWolseDistrictsHtml(renewal) {
  const rows = renewal?.wolseTable ?? [];
  const wolse = renewal?.seoul?.wolse;
  if (!rows.length || !wolse) return null;
  const signed = (value) => (value === null || value === undefined ? "-" : `${value > 0 ? "+" : ""}${value}%`);
  const ends = wolse.range.map((r) => r.rate);
  const body = rows
    .map((row) => {
      const gap = row.median === null ? '<span class="low-sample">표본 부족</span>' : escapeHtml(signed(row.median));
      const range = row.range.length ? row.range.map((r) => signed(r.median)).join(" / ") : "-";
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${gap}</td><td>${escapeHtml(range)}</td>` +
        `<td>${escapeHtml(row.cheaperShare === null ? "-" : `${row.cheaperShare}%`)}</td><td>${row.matched.toLocaleString("ko-KR")}</td></tr>`
      );
    })
    .join("");
  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">${escapeHtml(`갱신 − 신규 (${wolse.rate}%)`)}</th><th scope="col">${escapeHtml(`${ends[0]}% / ${ends.at(-1)}%로 보면`)}</th>` +
    `<th scope="col">시세보다 싼 비율</th><th scope="col">맞물린 계약</th></tr></thead><tbody>${body}</tbody>`
  );
}

export function renewalDistrictLinksHtml(renewal) {
  const slugs = renewal?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}

/** 층 격차 화면. 문턱과 문장은 빌더가 이미 정했으므로 여기서는 표만 만든다. */
export function floorDistrictsHtml(floor) {
  const rows = floor?.districts ?? [];
  if (!rows.length) return null;

  // 갈라 볼 수 없는 구도 빼지 않는다 - 화면 쪽 renderDistrictTable과 같은 규칙이다.
  const body = rows
    .map((row) => {
      const verdict = row.distinct
        ? "다르다"
        : `<span class="low-sample">${row.band ? "갈라 볼 수 없음" : "칸이 모자람"}</span>`;
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${row.median === null ? "-" : `${row.median}%`}</td>` +
        `<td>${row.cells.toLocaleString("ko-KR")}</td><td>${verdict}</td></tr>`
      );
    })
    .join("");

  return (
    `<thead><tr><th scope="col">자치구</th><th scope="col">1층 − 3층 이상</th><th scope="col">맞물린 칸</th>` +
    `<th scope="col">서울과 다른가</th></tr></thead><tbody>${body}</tbody>`
  );
}

export function floorDistrictLinksHtml(floor) {
  const slugs = floor?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}

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

  for (const [file, path_, fileBlocks] of [
    ["docs/index.html", INDEX_PATH, blocks],
    ["docs/rates.html", RATES_PATH, { rates: ratesHtml(rates), ratesHead: ratesHeadHtml(), rateFactsKo: rateFactsHtml(rates, "deposit", "ko"), rateFactsEn: rateFactsHtml(rates, "deposit", "en"), rateFactsData: jsonForScript(rateFactsData(rates)) }],
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
    const html = await readFile(path_, "utf8");
    const next = applyPrerender(html, fileBlocks);

    for (const [name, content] of Object.entries(fileBlocks)) {
      console.log(`  ${file} ${name.padEnd(11)} ${content ? `${content.length}자` : "데이터 없음 - 건너뜀"}`);
    }

    if (next === html) {
      console.log(`  ${file} 변경 없음`);
      continue;
    }
    await writeFile(path_, next);
    console.log(`  ${file} 갱신`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`프리렌더 실패: ${err.message}`);
    process.exit(1);
  });
}
