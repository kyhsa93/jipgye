import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cellChanges,
  districtRows,
  leadSentence,
  pairVerdicts,
  periods,
  regionCheck,
  surveyChange,
  toDeal,
} from "./district-change.mjs";
import { DISTRICT_INDEX_FILE } from "./fetch-district-index.mjs";
import { INDEX_FILE } from "./fetch-price-index.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";
import { shiftMonth } from "./outlook.mjs";
import { RAW_DIR } from "./realestate-raw.mjs";
import { DISTRICTS } from "./realestate-districts.mjs";
import { yearMonthOf } from "./realestate-slots.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.DISTRICT_CHANGE_FILE
  ? path.resolve(process.env.DISTRICT_CHANGE_FILE)
  : path.join(root, "docs/data/district-change.json");

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const TABLE = {
  ko: { head: ["자치구", "변화", "90% 구간", "맞물린 칸", "부동산원 조사"], thin: "칸이 모자람" },
  en: { head: ["District", "Change", "90% range", "Matched", "REB survey"], thin: "too few cells" },
};
const signed = (v) => (v === null || v === undefined ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

export function tableHtml(rows, locale = "ko") {
  const t = TABLE[locale];
  const tag = locale === "en" ? "en-US" : "ko-KR";
  const sorted = [...rows].sort((a, b) => (b.change ?? -999) - (a.change ?? -999) || a.name.localeCompare(b.name, "ko"));
  const body = sorted
    .map((r) =>
      r.change === null
        ? `<tr><td>${r.name}</td><td colspan="2"><span class="low-sample">${t.thin}</span></td><td>${r.cells.toLocaleString(tag)}</td><td>${signed(r.survey)}</td></tr>`
        : `<tr><td>${r.name}</td><td>${signed(r.change)}</td><td>${signed(r.low)} ~ ${signed(r.high)}</td>` +
          `<td>${r.cells.toLocaleString(tag)}</td><td>${signed(r.survey)}</td></tr>`
    )
    .join("");
  return `<thead><tr>${t.head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody>`;
}

export function regionTableHtml(regions, locale = "ko") {
  const en = locale === "en";
  const head = en ? ["Region", "Same units (ours)", "Official transaction index", "Gap"] : ["권역", "같은 칸(우리)", "공식 실거래가격지수", "차이"];
  const pp = en ? "pp" : "%p";
  const body = regions
    .map((r) => `<tr><td>${en ? r.name.en : r.name.ko}</td><td>${signed(r.ours)}</td><td>${signed(r.official)}</td><td>${r.gap === null ? "-" : `${r.gap > 0 ? "+" : ""}${r.gap}${pp}`}</td></tr>`)
    .join("");
  return `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody>`;
}

export function buildPayload({ items, now, official, survey }) {
  const deals = items.map(toDeal).filter(Boolean);
  const available = [...new Set(deals.map((d) => d.month))].sort();
  // 신고 기한(30일)이 닫힌 마지막 달. 10월 1일이면 8월이다.
  const p = periods(shiftMonth(yearMonthOf(now), -2), available);
  if (!p) return null;
  const byDistrict = cellChanges(deals, p);
  const rows = districtRows(byDistrict, DISTRICTS).map((r) => ({ ...r, survey: surveyChange(survey?.series?.[r.code], p) }));
  const pairs = pairVerdicts(rows);
  const regions = regionCheck(byDistrict, official?.series, p);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });
  return {
    updatedAt: now.toISOString(),
    periods: p,
    rows,
    pairs,
    regions,
    slugs: Object.fromEntries(DISTRICTS.filter((d) => DISTRICT_SLUGS[d.name]).map((d) => [d.name, DISTRICT_SLUGS[d.name]])),
    lead: both((l) => leadSentence(rows, pairs, p, l)),
    table: both((l) => tableHtml(rows, l)),
    regionTable: both((l) => regionTableHtml(regions, l)),
  };
}

async function readAll() {
  const dir = path.join(RAW_DIR, "sale");
  const items = [];
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const file = await readJson(path.join(dir, name));
    if (file?.ok !== false && Array.isArray(file?.items)) items.push(...file.items);
  }
  return items;
}

async function main() {
  const [items, official, survey] = await Promise.all([readAll(), readJson(INDEX_FILE), readJson(DISTRICT_INDEX_FILE)]);
  const payload = buildPayload({ items, now: new Date(), official, survey });
  if (!payload) {
    console.log("  갈아타기: 두 시기를 정할 원본이 모자라 건너뜀");
    return;
  }
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  const ok = payload.rows.filter((r) => r.change !== null).length;
  const distinct = Object.values(payload.pairs).filter(Boolean).length;
  console.log(
    `  갈아타기: ${payload.periods.base[0]}~ → ${payload.periods.recent.at(-1)} (${payload.periods.months}개월), ` +
      `값을 낸 구 ${ok}/25, 갈라 볼 수 있는 쌍 ${distinct}/${Object.keys(payload.pairs).length}, ` +
      `권역 대조 ${payload.regions.map((r) => `${r.name.ko} ${r.ours}/${r.official}`).join(" ")}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
