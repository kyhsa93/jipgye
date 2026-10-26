// 자치구 가격 막대(#745 PR8). 25개 구를 값 순서로 세운 가로 막대를 빌드 때 HTML 로 굽는다 — 화면 스크립트 0 B.
// 매매/전세/월세 전환은 숨긴 라디오 + 형제 선택자(CSS, src/css/c-data.css)다. 막대 하나가 그 구의 장(district-*.html) 링크이고,
// 같은 값은 접힌 표로 한 번 더 낸다(차트 대체 표). 값은 docs/data/realestate.json 의 4주 평균 그대로 — 여기서 새로 세지 않는다.
// 표본이 MIN_SAMPLE 건 미만인 구는 막대를 그리지 않고 「표본 부족」으로 적는다. 증감은 색이 아니라 ▲▼ 와 부호 글자로 낸다.
import { escapeHtml } from "./html-escape.ts";
import { districtFile, districtNameEn, DISTRICT_SLUGS } from "./district-slugs.ts";
import { formatMan, hasEnoughSample, MIN_SAMPLE } from "./realestate-format.ts";

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

const changeText = (v: number | null, locale: "ko" | "en") =>
  v == null || v === 0 ? (v === 0 ? (locale === "en" ? "no change" : "변동 없음") : "–") : `${v > 0 ? "▲+" : "▼−"}${formatMan(Math.abs(v), locale)}`;

function barList(rows: BarRow[]) {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  const items = rows.map((r) => {
    const name = both(r.name, districtNameEn(r.name));
    if (r.value == null) {
      return `<li class="dbars-row is-thin"><a href="./${districtFile(r.slug)}"><span class="dbars-name">${name}</span><span class="dbars-thin">${both(`표본 부족 (${countKo(r.count)}, ${MIN_SAMPLE}건 미만)`, `Too few deals (${countEn(r.count)}, under ${MIN_SAMPLE})`)}</span></a></li>`;
    }
    const width = max > 0 ? Math.max(1, Math.round((r.value / max) * 1000) / 10) : 0;
    return `<li class="dbars-row"><a href="./${districtFile(r.slug)}"><span class="dbars-name">${name}</span><span class="dbars-track" aria-hidden="true"><span class="dbars-bar" style="width:${width}%"></span></span><span class="dbars-val">${both(`${valueText(r, "ko")} · ${countKo(r.count)}`, `${valueText(r, "en")} · ${countEn(r.count)}`)}</span></a></li>`;
  });
  return `<ol class="dbars-list">${items.join("")}</ol>`;
}

function altTable(byKind: Record<Kind, BarRow[]>, home: boolean) {
  const head = BAR_KINDS.map((k) => `<th scope="col">${both(`${KIND_LABEL[k][0]} ${KIND_UNIT[k][0]}`, `${KIND_LABEL[k][1]}, ${KIND_UNIT[k][1]}`)}</th><th scope="col">${both(`${KIND_LABEL[k][0]} 거래 건수`, `${KIND_LABEL[k][1]} deals`)}</th>`).join("");
  const change = BAR_KINDS.filter((k) => k !== "wolse");
  const changeHead = change.map((k) => `<th scope="col">${both(`${KIND_LABEL[k][0]} 증감(직전 기준일 대비)`, `${KIND_LABEL[k][1]} change vs previous date`)}</th>`).join("");
  const lookup = Object.fromEntries(BAR_KINDS.map((k) => [k, new Map(byKind[k].map((r) => [r.name, r]))]));
  const body = byKind.sale.map(({ name, slug }) => {
    const cells = BAR_KINDS.map((k) => {
      const r = lookup[k].get(name);
      const v = r?.value == null ? both("표본 부족", "Too few") : both(valueText(r, "ko"), valueText(r, "en"));
      return `<td>${v}</td><td>${both(countKo(r?.count ?? 0), countEn(r?.count ?? 0))}</td>`;
    }).join("");
    const ch = change.map((k) => `<td>${both(changeText(lookup[k].get(name)?.change ?? null, "ko"), changeText(lookup[k].get(name)?.change ?? null, "en"))}</td>`).join("");
    return `<tr><th scope="row"><a href="./${districtFile(slug)}">${both(name, districtNameEn(name))}</a></th>${cells}${ch}</tr>`;
  });
  return `<div class="table-wrap"><table class="data-table dbars-table"><caption class="sr-only">${both(`${home ? "메인 " : ""}자치구 ${body.length}곳의 매매·전세·월세 값과 거래 건수(매매 가격순)`, `${home ? "Home: s" : "S"}ale, jeonse and rent for ${body.length} districts with deal counts (by sale price)`)}</caption><thead><tr><th scope="col">${both("자치구", "District")}</th>${head}${changeHead}</tr></thead><tbody>${body.join("")}</tbody></table></div>`;
}

/**
 * 막대 구역 전체(제목·기준·전환·막대·대체 표). 데이터가 없으면 빈 문자열이라 자리표시가 빈 채로 남는다.
 * heading 은 놓이는 장의 제목 계층(시세 장 h2, 메인 h3). 라디오 name·id 는 장 안에서 한 벌뿐이라 고정이다.
 */
export function districtBarsHtml(data, { heading = "h2" }: { heading?: "h2" | "h3" } = {}) {
  if (!data?.districts?.length) return "";
  const byKind = Object.fromEntries(BAR_KINDS.map((k) => [k, barRows(data, k)])) as Record<Kind, BarRow[]>;
  if (BAR_KINDS.every((k) => byKind[k].every((r) => r.value == null))) return "";
  const w = data.window ?? {};
  const from = w.districtFrom ?? w.from;
  const weeks = w.districtWeeks ?? w.weeks;
  const period = from && w.to ? both(`기준: 계약일 ${from} ~ ${w.to}(최근 ${weeks}주) 신고분`, `Basis: contracts ${from} to ${w.to} (last ${weeks} weeks)`) : "";
  const radios = BAR_KINDS.map((k, i) => `<input class="sr-only" type="radio" name="dbars-kind" id="dbars-${k}" value="${k}"${i === 0 ? " checked" : ""}>`).join("");
  const labels = BAR_KINDS.map((k) => `<label class="c-chip" for="dbars-${k}">${both(KIND_LABEL[k][0], KIND_LABEL[k][1])}</label>`).join("");
  const panels = BAR_KINDS.map(
    (k) =>
      `<div class="dbars-panel" data-kind="${k}"><p class="dbars-unit">${both(`${KIND_LABEL[k][0]} ${KIND_UNIT[k][0]} · 높은 순 · 막대를 누르면 그 구의 장으로 갑니다`, `${KIND_LABEL[k][1]}, ${KIND_UNIT[k][1]} · highest first · tap a bar for that district`)}</p>${barList(byKind[k])}</div>`
  ).join("");
  const h = heading === "h3" ? "h3" : "h2";
  return (
    `<section class="dbars" id="district-bars" aria-labelledby="dbars-heading"><${h} id="dbars-heading">${both("자치구별 가격 한눈에", "Prices by district at a glance")}</${h}>` +
    `<p class="dbars-meta">${period}</p>${radios}` +
    `<div class="dbars-tabs c-chips" role="group" aria-label="거래 유형 / Deal type">${labels}</div>` +
    `<div class="dbars-panels">${panels}</div>` +
    `<details class="c-fold dbars-alt"><summary>${both("같은 값을 표로 보기", "See the same figures as a table")}</summary>${altTable(byKind, h === "h3")}</details></section>`
  );
}
