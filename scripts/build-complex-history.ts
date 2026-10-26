/**
 * 이 단지 이 평형의 매매가가 지난 2년 동안 어떻게 움직였나(#728 X1).
 *
 * 단지 가격 위치(complex-price)는 "지금 어디쯤"만 말한다. 매수자가 다음으로 묻는 것은 "그동안 올랐나, 내렸나"다.
 * 칸(단지×평형)마다 최근 24개월의 달별 중앙값과 건수를 싣는다. 칸 묶음은 complex-price 와 같은 규칙
 * (marketDeal: 해제·직거래 제외, areaGroups: 1㎡ 안쪽 한 칸)이다 - 두 화면의 칸 이름이 어긋나면 카드가 칸을 못 찾는다.
 *
 * 값은 지수로 고치지 않은 계약가 그대로다. 달마다 건수(n)를 같이 실어 화면이 얇은 달·칸을 숨기게 한다
 * (PR2 규칙: n≥3 달만 선). 24개월 n≥6 칸은 37.6%, 구당 gzip 중앙값 17 KB·최대 26.7 KB였다(이슈 #728 0단계).
 * 그래도 구 하나가 예산(gzip 40 KB)을 넘으면 거래가 가장 적은 칸부터 덜어 내고 덜어 낸 칸 수를 적는다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { areaGroups, marketDeal, quantile } from "./complex-price.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { readSlotFile } from "./realestate-raw.ts";
import { recentMonths } from "./realestate-source.ts";
import { RETENTION_MONTHS } from "./realestate-slots.ts";

const root = path.resolve(import.meta.dirname, "..");

/** 창. 원본 보존 기간과 같은 24개월(이번 달 포함). */
export const HISTORY_MONTHS = RETENTION_MONTHS;

/** 구 파일 하나의 예산(gzip 바이트). */
export const GZIP_BUDGET = 40 * 1024;

export const complexHistoryFileName = (slug) => `complex-history-${slug}.json`;

/** 중앙값(원 단위 반올림). 짝수 개면 가운데 둘의 평균 - complex-price 와 같은 정의. */
export const median = (values) => Math.round(quantile([...values].sort((a, b) => a - b), 0.5));

const byName = ([a]: any[], [b]: any[]) => (a < b ? -1 : a > b ? 1 : 0);

type Series = [string, number, number][];

/**
 * 한 구의 칸별 달 계열: { 단지명: { 평형: [[YYYYMM, 중앙값, 건수], ...] } }. 거래 없는 달은 싣지 않는다.
 * deals 는 marketDeal 을 거친 것. months 밖의 거래는 버린다.
 */
export function districtHistory(deals, months) {
  const first = months[0];
  const last = months.at(-1);
  const byApt = new Map();
  for (const d of deals) {
    if (d.month < first || d.month > last) continue;
    if (!byApt.has(d.apt)) byApt.set(d.apt, []);
    byApt.get(d.apt).push(d);
  }
  const out = {};
  for (const [apt, aptDeals] of [...byApt].sort(byName)) {
    const label = areaGroups(aptDeals);
    const cells = new Map();
    for (const d of aptDeals) {
      const name = label.get(d.area);
      if (!cells.has(name)) cells.set(name, new Map());
      const byMonth = cells.get(name);
      if (!byMonth.has(d.month)) byMonth.set(d.month, []);
      byMonth.get(d.month).push(d.amount);
    }
    out[apt] = {};
    for (const [name, byMonth] of [...cells].sort(([a], [b]) => a - b)) {
      out[apt][name] = [...byMonth].sort(byName).map(([m, v]) => [m, median(v), v.length]);
    }
  }
  return out;
}

export const gzipSize = (file) => gzipSync(`${JSON.stringify(file)}\n`).length;

/**
 * 예산 안으로. 넘치면 24개월 건수가 가장 적은 칸부터(같으면 단지명·평형 역순) 덜어 낸다 - 얇은 칸은 화면에서도
 * 선을 못 그리는 칸이라 잃는 것이 가장 적다. file.trimmed 에 덜어 낸 칸 수를 남긴다.
 */
export function fitBudget(file, budget = GZIP_BUDGET) {
  if (gzipSize(file) <= budget) return file;
  const order = [];
  for (const [apt, areas] of Object.entries<Record<string, Series>>(file.cells)) {
    for (const [area, series] of Object.entries(areas)) {
      order.push({ apt, area, n: series.reduce((s, [, , n]) => s + n, 0) });
    }
  }
  order.sort((a, b) => a.n - b.n || (a.apt < b.apt ? 1 : a.apt > b.apt ? -1 : Number(b.area) - Number(a.area)));
  // 한 칸씩 지우며 매번 압축하면 느리다 - 덜어 낼 몫을 반씩 좁혀 찾는다.
  const without = (k) => {
    const drop = new Set(order.slice(0, k).map((c) => `${c.apt}\u0000${c.area}`));
    const cells = {};
    for (const [apt, areas] of Object.entries(file.cells)) {
      const kept = Object.fromEntries(Object.entries(areas).filter(([area]) => !drop.has(`${apt}\u0000${area}`)));
      if (Object.keys(kept).length) cells[apt] = kept;
    }
    return { ...file, trimmed: (file.trimmed ?? 0) + k, cells };
  };
  let lo = 1;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gzipSize(without(mid)) <= budget) hi = mid;
    else lo = mid + 1;
  }
  return without(lo);
}

/** 구마다 한 파일. itemsByDistrict: { 구 코드: 원본 줄[] }. */
export function buildHistoryFiles({ itemsByDistrict, now, budget = GZIP_BUDGET }) {
  const months = recentMonths(now, HISTORY_MONTHS);
  const files = {};
  for (const { code, name } of DISTRICTS) {
    const slug = DISTRICT_SLUGS[name];
    if (!slug) continue;
    const deals = (itemsByDistrict[code] ?? []).map(marketDeal).filter(Boolean);
    const cells = districtHistory(deals, months);
    if (!Object.keys(cells).length) continue;
    files[slug] = fitBudget(
      { district: name, updatedAt: now.toISOString(), from: months[0], to: months.at(-1), trimmed: 0, cells },
      budget
    );
  }
  return files;
}

/** 원본을 읽어 docs/data/complex-history-*.json 을 쓴다. 쓴 파일의 gzip 크기를 돌려준다. */
export async function writeComplexHistory({ dataDir = path.join(root, "docs/data"), now = new Date(), rawDir = undefined } = {}) {
  const months = recentMonths(now, HISTORY_MONTHS);
  const itemsByDistrict = {};
  await Promise.all(
    DISTRICTS.map(async ({ code }) => {
      const files = await Promise.all(months.map((m) => readSlotFile("sale", code, m, rawDir)));
      itemsByDistrict[code] = files.filter((f) => f?.ok !== false && Array.isArray(f?.items)).flatMap((f) => f.items);
    })
  );
  const files = buildHistoryFiles({ itemsByDistrict, now });
  await mkdir(dataDir, { recursive: true });
  const sizes = {};
  for (const [slug, file] of Object.entries(files)) {
    await writeFile(path.join(dataDir, complexHistoryFileName(slug)), `${JSON.stringify(file)}\n`);
    sizes[slug] = gzipSize(file);
  }
  return sizes;
}

/**
 * Daily 에서 부르는 판. 실패해도 단지 가격 위치(와 그 뒤 단계)를 막지 않는다 - 로그 한 줄만 남기고 false.
 * run 은 시험이 바꿔 끼운다.
 */
export async function buildComplexHistorySoft(options = {}, run = writeComplexHistory) {
  try {
    const sizes = await run(options);
    const kb = Object.values<number>(sizes).map((s) => s / 1024);
    const max = kb.length ? Math.max(...kb).toFixed(1) : "0";
    console.log(`  단지 가격 추이: ${kb.length}개 구, gzip 최대 ${max} KB`);
    return true;
  } catch (error) {
    console.log(`  단지 가격 추이: 실패해 건너뜀 (${error?.message ?? error})`);
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  buildComplexHistorySoft();
}
