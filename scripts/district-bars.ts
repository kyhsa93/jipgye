// District price presentation, prerendered from the same source as the district table.
// Home uses an SVG district map; detailed pages use a sorted list and two-district comparison.
// Values remain the reported-period averages from realestate.json, not estimates or medians.
// Fewer than MIN_SAMPLE deals: no price or price color, only the count and a sample notice.
import { escapeHtml } from "./html-escape.ts";
import { districtFile, districtNameEn, DISTRICT_SLUGS } from "./district-slugs.ts";
import { formatMan, hasEnoughSample, MIN_SAMPLE } from "./realestate-format.ts";
import { SEOUL_MAP_PATHS, SEOUL_MAP_VIEWBOX } from "./seoul-map-paths.ts";

export const BAR_KINDS = ["sale", "jeonse", "wolse"] as const;
type Kind = (typeof BAR_KINDS)[number];

const VALUE_FIELD: Record<Kind, string> = { sale: "avgPricePerPyeong10k", jeonse: "avgDepositPerPyeong10k", wolse: "avgDeposit10k" };
const KIND_LABEL: Record<Kind, [string, string]> = { sale: ["매매", "Sale"], jeonse: ["전세", "Jeonse"], wolse: ["월세", "Monthly rent"] };
// 막대가 무엇을 재는지 — 용어는 시세 표(#751·#753)와 같다. 값은 평균이다(중간값 아님).
const KIND_UNIT: Record<Kind, [string, string]> = {
  sale: ["3.3㎡당 평균 가격", "average price per 3.3㎡"],
  jeonse: ["3.3㎡당 평균 보증금", "average deposit per 3.3㎡"],
  wolse: ["평균 보증금(월세는 옆에 따로)", "average deposit (monthly rent shown beside it)"],
};

const both = (ko: string, en: string) => `<span lang="ko">${escapeHtml(ko)}</span><span lang="en">${escapeHtml(en)}</span>`;
const countKo = (n: number) => `${n.toLocaleString("ko-KR")}건`;
const countEn = (n: number) => `${n.toLocaleString("en-US")} deals`;

export type BarRow = { name: string; slug: string; count: number; value: number | null; monthly: number | null; change: number | null };

/** 한 거래 유형의 25개 구 줄. 값이 있는 구는 값 큰 순(같으면 이름순), 표본 부족 구는 맨 뒤(이름순). */
export function barRows(data, kind: Kind): BarRow[] {
  const rows: BarRow[] = [];
  for (const d of data?.districts ?? []) {
    const slug = DISTRICT_SLUGS[d?.name];
    if (!slug) continue;
    const metric = d[kind];
    const raw = metric?.[VALUE_FIELD[kind]];
    const ok = hasEnoughSample(metric) && typeof raw === "number" && Number.isFinite(raw);
    rows.push({
      name: d.name,
      slug,
      count: metric?.transactionCount ?? 0,
      value: ok ? raw : null,
      monthly: ok && kind === "wolse" ? (metric.avgMonthlyRent10k ?? null) : null,
      // 월세의 증감은 환산가 기준이라 보증금 막대와 단위가 달라 싣지 않는다.
      change: ok && kind !== "wolse" && typeof metric.change?.value10k === "number" ? metric.change.value10k : null,
    });
  }
  return rows.sort((a, b) =>
    a.value == null || b.value == null
      ? (a.value == null ? 1 : 0) - (b.value == null ? 1 : 0) || a.name.localeCompare(b.name, "ko")
      : b.value - a.value || a.name.localeCompare(b.name, "ko")
  );
}

const valueText = (row: BarRow, locale: "ko" | "en") =>
  row.monthly != null
    ? `${formatMan(row.value, locale)} / ${locale === "en" ? "mo" : "월"} ${formatMan(row.monthly, locale)}`
    : formatMan(row.value, locale);

function barList(rows: BarRow[]) {
  const items = rows.map((r) => {
    const name = both(r.name, districtNameEn(r.name));
    if (r.value == null) {
      return `<li class="dbars-row is-thin" data-district="${r.slug}"><a href="./${districtFile(r.slug)}"><span class="dbars-name">${name}</span><span class="dbars-thin">${both(`표본 부족 (${countKo(r.count)}, ${MIN_SAMPLE}건 미만)`, `Too few deals (${countEn(r.count)}, under ${MIN_SAMPLE})`)}</span></a></li>`;
    }
    return `<li class="dbars-row" data-district="${r.slug}"><a href="./${districtFile(r.slug)}"><span class="dbars-name">${name}</span><span class="dbars-val">${both(`${valueText(r, "ko")} · ${countKo(r.count)}`, `${valueText(r, "en")} · ${countEn(r.count)}`)}</span></a></li>`;
  });
  return `<ol class="dbars-list">${items.join("")}</ol>`;
}

function districtSelect(rows: BarRow[], id: string, ko: string, en: string, selected: string) {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (["ko", "en"] as const).map((lang) => `<label class="dprice-select" lang="${lang}" for="${id}-${lang}" hidden>${escapeHtml(lang === "ko" ? ko : en)}<select class="c-select" id="${id}-${lang}" data-district-select>${sorted.map((r) => `<option value="${r.slug}"${r.slug === selected ? " selected" : ""}>${escapeHtml(lang === "ko" ? r.name : districtNameEn(r.name))}</option>`).join("")}</select></label>`).join("");
}

export function priceBand(value: number | null) {
  return value == null ? "thin" : String([3000, 5000, 7000, 10000].filter((n) => value >= n).length);
}

function districtMap(rows: BarRow[]) {
  const available = new Map(rows.map((r) => [r.name, r]));
  const first = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko")).find((r) => r.value != null) ?? rows[0];
  const shapes = SEOUL_MAP_PATHS.map((shape) => {
    const row = available.get(shape.name);
    if (!row) return "";
    const title = `${row.name} / ${districtNameEn(row.name)} · ${row.value == null ? "표본 부족 / Too few deals" : `${formatMan(row.value, "ko")} / ${formatMan(row.value, "en")} per 3.3㎡`}`;
    return `<a href="./${districtFile(row.slug)}" data-map-district="${row.slug}" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title><path d="${shape.path}" data-band="${priceBand(row.value)}"/><text x="${shape.x}" y="${shape.y}" text-anchor="middle" dominant-baseline="central" aria-hidden="true">${both(row.name.replace(/구$/, ""), districtNameEn(row.name).replace(/-gu$/, "" )).replaceAll("span", "tspan")}</text></a>`;
  }).join("");
  const cards = rows.map((row) => `<article class="dprice-card" data-map-card="${row.slug}"${row.slug === first.slug ? "" : " hidden"}><p class="dprice-eyebrow">${both("선택한 지역", "Selected district")}</p><h4>${both(row.name, districtNameEn(row.name))}</h4><p class="dprice-number">${row.value == null ? both("표본 부족", "Too few deals") : both(formatMan(row.value, "ko"), formatMan(row.value, "en"))}</p><p class="dbars-unit">${both("3.3㎡당 평균 매매 가격", "Average sale price per 3.3㎡")}</p><p>${both(`최근 신고 거래 ${countKo(row.count)}`, `${countEn(row.count)} reported in this period`)}</p>${row.value == null ? `<p class="dbars-unit">${both(`${MIN_SAMPLE}건 미만으로 가격을 표시하지 않습니다.`, `Price withheld for fewer than ${MIN_SAMPLE} deals.`)}</p>` : ""}<a class="c-btn c-btn--secondary" href="./${districtFile(row.slug)}">${both("이 지역 자세히 보기 →", "Explore this district →")}</a></article>`).join("");
  const legend = [["0", "3천 미만", "< ₩30M"], ["1", "3천–5천", "₩30–50M"], ["2", "5천–7천", "₩50–70M"], ["3", "7천–1억", "₩70–100M"], ["4", "1억 이상", "≥ ₩100M"], ["thin", "표본 부족", "Too few deals"]];
  return `<p class="dbars-unit">${both("궁금한 구를 선택해 가격을 확인하세요. 색상별 가격대는 아래 범례를 확인하세요.", "Select a district. See the legend below for each price band.")}</p><div class="dprice-layout"><div class="dprice-map-wrap"><svg class="dprice-map" viewBox="${SEOUL_MAP_VIEWBOX}" role="group" aria-label="${escapeHtml("서울 자치구 매매 가격 · Seoul district sale prices")}">${shapes}</svg><ul class="dprice-legend" aria-label="가격 범례 / Price legend">${legend.map(([band, ko, en]) => `<li><i data-band="${band}" aria-hidden="true"></i>${both(ko, en)}</li>`).join("")}</ul><p class="dprice-credit">${both("3.3㎡당 · 단위: 만원 · 지도: ", "Per 3.3㎡ · Map: ")}<a href="./licenses/seoul-map-NOTICE.txt">KOSTAT / Lucy Park</a></p></div><div>${districtSelect(rows, "dprice-home-select", "지역 선택", "Choose a district", first.slug)}<div data-map-cards aria-live="polite" aria-atomic="true">${cards}</div></div></div>`;
}

function comparison(rows: BarRow[], kind: Kind) {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return `<div class="dprice-compare" hidden><p class="dprice-eyebrow">${both("관심 지역 비교", "Compare districts")}</p><div class="dprice-compare-grid">${[0, 1].map((i) => `<div>${districtSelect(rows, `dprice-${kind}-${i}`, `지역 ${i + 1}`, `District ${i + 1}`, sorted[Math.min(i, sorted.length - 1)].slug)}<div class="dprice-card" data-compare-slot="${i}" aria-live="polite"></div></div>`).join("")}</div></div>`;
}

/** Keep the existing export and anchors so links and both render paths remain compatible. */
export function districtBarsHtml(data, { variant = "page" }: { variant?: "page" | "home" } = {}) {
  if (!data?.districts?.length) return "";
  const home = variant === "home";
  const kinds: readonly Kind[] = home ? ["sale"] : BAR_KINDS;
  const byKind = Object.fromEntries(kinds.map((k) => [k, barRows(data, k)])) as Record<Kind, BarRow[]>;
  if (kinds.every((k) => byKind[k].every((r) => r.value == null))) return "";
  const w = data.window ?? {};
  const from = w.districtFrom ?? w.from;
  const weeks = w.districtWeeks ?? w.weeks;
  const period = from && w.to ? both(`기준: 계약일 ${from} ~ ${w.to}(최근 ${weeks}주) 신고분`, `Basis: contracts ${from} to ${w.to} (last ${weeks} weeks)`) : "";
  const panels = kinds
    .map(
      (k) =>
        `<div class="dbars-panel" data-kind="${k}"><p class="dbars-unit">${both(`${KIND_LABEL[k][0]} ${KIND_UNIT[k][0]} · 높은 순 · 지역을 누르면 상세 보기`, `${KIND_LABEL[k][1]}, ${KIND_UNIT[k][1]} · highest first · select a district for details`)}</p>${comparison(byKind[k], k)}${barList(byKind[k])}</div>`
    )
    .join("");
  if (home) {
    return (
      `<section class="dbars dbars--home" aria-labelledby="dbars-heading"><h3 id="dbars-heading">${both("자치구별 매매 가격", "Sale prices by district")}</h3>` +
      `<p class="dbars-meta">${period}</p>${districtMap(byKind.sale)}` +
      `<p class="dbars-more"><a href="./realestate.html#district-bars">${both("전체 가격 목록·관심 지역 비교 →", "All prices and district comparison →")}</a></p><script src="./district-prices.js" defer></script></section>`
    );
  }
  const chips = BAR_KINDS.map(
    (k, i) => `<label class="c-chip"><input class="sr-only" type="radio" name="dbars-kind" id="dbars-${k}" value="${k}"${i === 0 ? " checked" : ""}>${both(KIND_LABEL[k][0], KIND_LABEL[k][1])}</label>`
  ).join("");
  return (
    `<section class="dbars" id="district-bars" aria-labelledby="dbars-heading"><h2 id="dbars-heading">${both("자치구별 가격 한눈에", "Prices by district at a glance")}</h2>` +
    `<p class="dbars-meta">${period}</p>` +
    `<fieldset class="dbars-tabs"><legend class="sr-only">${both("거래 유형", "Deal type")}</legend><div class="c-chips">${chips}</div></fieldset>` +
    `<div class="dbars-panels">${panels}</div>` +
    `<p class="dbars-more"><a href="#district-section">${both("같은 값을 표로 보기(자치구별 시세 표) →", "See the same figures in the table →")}</a></p><script src="./district-prices.js" defer></script></section>`
  );
}
