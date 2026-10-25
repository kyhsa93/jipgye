/**
 * 어떤 집이 더 움직였나 - 가격대·연식 구간별 같은 칸 1년 변화(N4, #676).
 *
 * 갈아타기(district-change)와 같은 방법을 자치구 대신 가격대·연식 구간에 쓴다. 칸(구·단지·전용면적)을
 * 두 시기에 견주고, 두 시기 모두 거래된 칸의 로그 변화 중앙값을 그 구간의 변화로 본다. 칸을 다시 뽑은
 * 90% 구간, 칸 문턱(MIN_CELLS), 두 구간을 갈라 볼 수 있나(pairVerdicts)는 district-change 의 것을
 * 그대로 부른다 - 새 문턱도 새 판정 규칙도 없다.
 *
 * 칸이 어느 가격대에 드는지는 기준 시기 중앙값으로 정한다. 최근 값으로 정하면 많이 움직인 칸이 위 대로
 * 옮겨 가 대마다 변화가 저절로 벌어진다. 가격대는 해제율 화면(cancel-by-price)의 BANDS 5개 키 그대로다.
 * 연식은 기준 시기 가운데 달의 해 - 준공 연도이고, 준공 연도가 없는 칸은 연식 구간에서만 뺀다.
 *
 * 공개는 집계만이다 - 구간별 칸 수·변화·구간, 가격대×연식 칸 수. 단지·칸 단위 값은 내지 않는다.
 */

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BANDS } from "./cancel-by-price.ts";
import { MIN_CELLS, districtRows, pairVerdicts, periods, toDeal } from "./district-change.ts";
import { shiftMonth } from "./outlook.ts";
import { yearMonthOf } from "./realestate-slots.ts";

export const AGES = [
  { key: "under10", lo: -Infinity, hi: 10, ko: "10년 미만", en: "under 10 years" },
  { key: "y10to29", lo: 10, hi: 30, ko: "10~29년", en: "10–29 years" },
  { key: "over30", lo: 30, hi: Infinity, ko: "30년 이상", en: "30 years or more" },
];

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 원본 한 줄 → district-change 의 거래에 준공 연도를 더한 것. 해제·직거래는 toDeal 이 뺀다. */
export function toSegmentDeal(item) {
  const deal = toDeal(item);
  if (!deal) return null;
  const year = Number(item.buildYear);
  return { ...deal, buildYear: year > 1900 ? year : null };
}

/**
 * 두 시기 모두 거래된 칸마다 { base(기준 시기 중앙값), buildYear, change(로그 변화) }.
 * 칸 이름 순으로 정렬한다 - 원본 순서가 바뀌어도 다시 뽑기(씨앗 고정)의 결과가 같아야 한다.
 */
export function segmentCells(deals, { base, recent }) {
  const b = new Set(base);
  const r = new Set(recent);
  const cells = new Map();
  for (const d of deals) {
    const side = b.has(d.month) ? "base" : r.has(d.month) ? "recent" : null;
    if (!side) continue;
    if (!cells.has(d.cell)) cells.set(d.cell, { base: [], recent: [], buildYear: null });
    const c = cells.get(d.cell);
    c[side].push(d.amount);
    if (c.buildYear === null && d.buildYear) c.buildYear = d.buildYear;
  }
  return [...cells.entries()]
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .filter(([, c]) => c.base.length && c.recent.length)
    .map(([, c]) => {
      const mb = median(c.base);
      return { base: mb, buildYear: c.buildYear, change: Math.log(median(c.recent) / mb) };
    });
}

export const priceKeyOf = (amount) => BANDS.find((x) => amount > x.lo && amount <= x.hi)?.key ?? null;
export const ageKeyOf = (buildYear, refYear) => {
  if (!buildYear) return null;
  const age = refYear - buildYear;
  return AGES.find((x) => age >= x.lo && age < x.hi)?.key ?? null;
};

/** 구간 행 - district-change 의 districtRows(문턱·90% 구간) 그대로. 칸이 모자라면 값 없이 칸 수만. */
function segmentRows(cells, defs, keyOf) {
  const byKey = new Map<string, number[]>(defs.map((x) => [x.key, []]));
  for (const c of cells) byKey.get(keyOf(c))?.push(c.change);
  const rows = districtRows(byKey, defs.map((x) => ({ code: x.key, name: x.ko })));
  return rows.map(({ code, name, ...rest }) => ({ key: code, ko: name, en: defs.find((x) => x.key === code).en, ...rest }));
}

/** 가격대·연식 구간별 1년 변화. 두 시기를 정할 원본이 모자라면 null. */
export function buildSegmentPayload({ items, now }) {
  const deals = items.map(toSegmentDeal).filter(Boolean);
  const available = [...new Set(deals.map((d) => d.month))].sort();
  // 신고 기한(30일)이 닫힌 마지막 달 - build-district-change 와 같은 두 시기.
  const p = periods(shiftMonth(yearMonthOf(now), -2), available);
  if (!p) return null;
  const refYear = Number(p.base[1].slice(0, 4));
  const cells = segmentCells(deals, p);
  const priceOf = (c) => priceKeyOf(c.base);
  const ageOf = (c) => ageKeyOf(c.buildYear, refYear);
  const price = segmentRows(cells, BANDS, priceOf);
  const age = segmentRows(cells, AGES, ageOf);
  const code = (rows) => rows.map((r) => ({ ...r, code: r.key }));
  const grid = Object.fromEntries(BANDS.map((b) => [b.key, AGES.map((a) => cells.filter((c) => priceOf(c) === b.key && ageOf(c) === a.key).length)]));
  return {
    updatedAt: now.toISOString(),
    periods: p,
    minCells: MIN_CELLS,
    ageRefYear: refYear,
    cells: cells.length,
    noBuildYear: cells.filter((c) => !c.buildYear).length,
    price,
    age,
    pairs: { price: pairVerdicts(code(price)), age: pairVerdicts(code(age)) },
    grid: { ages: AGES.map((a) => a.key), rows: grid },
  };
}

// --- 쓰기(soft-fail) -----------------------------------------------------------------
//
// build-district-change 가 갈아타기 파일을 쓴 뒤 부른다. 무엇이 잘못돼도 ::warning 한 줄로 끝나고 어제 파일을
// 그대로 둔다 - 갈아타기 산출과 Daily 의 나머지 단계를 막지 않는다. 임시 이름에 쓴 뒤 rename 한다.

const root = path.resolve(import.meta.dirname, "..");
export const SEGMENT_CHANGE_NAME = "segment-change.json";
export const segmentChangeFile = process.env.SEGMENT_CHANGE_FILE
  ? path.resolve(process.env.SEGMENT_CHANGE_FILE)
  : path.join(root, "docs/data", SEGMENT_CHANGE_NAME);

export async function writeSegmentChangeSoft({ items, now, file = segmentChangeFile, log = console.log, build = buildSegmentPayload }) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    // 쓸 수 있는 이름은 하나다 - 다른 파일을 덮지 않는다.
    if (path.basename(file) !== SEGMENT_CHANGE_NAME) throw new Error(`허용되지 않은 출력 경로 ${file}`);
    const payload = build({ items, now });
    if (!payload) {
      log("  가격대·연식 변화: 두 시기를 정할 원본이 모자라 건너뜀(어제 파일 유지)");
      return false;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify(payload, null, 2));
    await rename(tmp, file);
    const shown = (rows) => rows.filter((r) => r.change !== null).length;
    const told = (pairs) => `${Object.values(pairs).filter(Boolean).length}/${Object.keys(pairs).length}`;
    log(
      `  가격대·연식 변화: 칸 ${payload.cells}, 값을 낸 가격대 ${shown(payload.price)}/${payload.price.length} · 연식 ${shown(payload.age)}/${payload.age.length}, ` +
        `갈라 볼 수 있는 쌍 가격대 ${told(payload.pairs.price)} · 연식 ${told(payload.pairs.age)}`
    );
    return true;
  } catch (err) {
    await unlink(tmp).catch(() => {});
    log(`::warning::가격대·연식 변화 생성 실패 - 이전 파일을 그대로 둡니다: ${err.message}`);
    return false;
  }
}
