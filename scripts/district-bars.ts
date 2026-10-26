// 자치구 가격 막대(#745 PR8). 25개 구를 값 순서로 세운 가로 막대를 빌드 때 HTML 로 굽는다 — 화면 스크립트 0 B.
// 매매/전세/월세 전환은 fieldset 안 라디오 + CSS :has(src/css/c-data.css)다. 막대 하나가 그 구의 장(district-*.html) 링크이고 값을 글자로 적으므로
// 막대 목록 자체가 텍스트 대안이다(같은 값의 표는 시세 장의 자치구별 시세 표 — 링크로 잇는다). 값은 docs/data/realestate.json 의 4주 평균 그대로 — 여기서 새로 세지 않는다.
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

/**
 * 막대 구역. 데이터가 없으면 빈 문자열이라 자리표시가 빈 채로 남는다.
 * - 시세 장(page): 제목 h2, 매매/전세/월세 전환(라디오 fieldset, CSS :has — 스크립트 0 B), 같은 장의 시세 표로 가는 링크.
 *   막대 ol 이 링크 + 값 글자라 그 자체가 텍스트 대안이고, 같은 값은 바로 아래 시세 표에 있어 대체 표를 따로 굽지 않는다.
 * - 메인(home): 제목 h3, 매매 막대 한 벌만(전환 없음) + 시세 장의 전체 막대로 가는 링크.
 */
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
        `<div class="dbars-panel" data-kind="${k}"><p class="dbars-unit">${both(`${KIND_LABEL[k][0]} ${KIND_UNIT[k][0]} · 높은 순 · 막대를 누르면 그 구의 장으로`, `${KIND_LABEL[k][1]}, ${KIND_UNIT[k][1]} · highest first · tap a bar for that district`)}</p>${barList(byKind[k])}</div>`
    )
    .join("");
  if (home) {
    return (
      `<section class="dbars dbars--home" aria-labelledby="dbars-heading"><h3 id="dbars-heading">${both("자치구별 매매 가격", "Sale prices by district")}</h3>` +
      `<p class="dbars-meta">${period}</p>${panels}` +
      `<p class="dbars-more"><a href="./realestate.html#district-bars">${both("전세·월세까지 전체 보기 →", "See jeonse and rent too →")}</a></p></section>`
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
    `<p class="dbars-more"><a href="#district-section">${both("같은 값을 표로 보기(자치구별 시세 표) →", "See the same figures in the table →")}</a></p></section>`
  );
}
