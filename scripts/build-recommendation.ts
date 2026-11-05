/**
 * 근거표 데이터 docs/data/reco-<구>.json 25개 (#816 P1-1). 브라우저는 고른 구 파일만 받아 거른다 - 억 구간×구×면적을 미리 구우면 터지고, 구 하나를 보려고 서울 전체를 받을 까닭이 없다.
 *
 * 칸은 저장 ID(complex-id.ts) + 1㎡ 묶음이고 창은 시세 화면과 같은 183일이다. 값은 complex-price.ts 의 summarize 를 그대로 부른다 - 같은 거래면 시세 화면과 같은 값이어야 한다.
 * 다만 동명 단지 키(#821)는 같은 동 안에서 지번이 갈리는 이름을 합치고 여기는 가르므로, 그런 칸은 시세 화면과 값이 다를 수 있다. 파일 안 순서는 ID 사전순이다 - 좋은 순서로 읽히지 않게, 입력 순서에 안 기대게.
 *
 * 실패(cto 2026-11-03 표 F1~F4): 소프트다. 예외·입력 없음·한도 초과면 `::warning` 을 찍고 **25개 전부 어제 판을 둔다**(renewal-cells 의 구 단위 유지와 다르다 - 세대가 섞이면 서울 전체를 묶은 값이 어긋난다).
 * 임시 폴더에 25개를 다 쓰고 검사한 뒤 rename 하고, 커밋은 뒤 단계라 반쯤 쓴 판이 나가지 않는다. 그래도 어제 판이 계속되면 check-data-progress 의 산출물 나이(30h·54h)와 tools/health 가 잡는다.
 * 값이 안 바뀐 날에도 updatedAt 을 새로 쓴다. 나이 검사가 그 값을 본다.
 *
 * 등록: update-all.mjs·daily-update.yml 양쪽에 `--soft-fail` 과 `|| echo` 를 함께 둔다. --soft-fail 은 모듈 로드 실패를 못 잡으므로(이 파일이 읽히기 전이다) 줄에서 한 겹 더 막는다 -
 * 한 빌더가 죽으면 같은 스텝의 그날 산출물이 전부 사라진다(#97).
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { collectionNow } from "./collection-now.ts";
import { aliasesOf, complexKey, locationKey, stableId } from "./complex-id.ts";
import { adjust, areaGroups, AREA_GROUP, dealDate, indexLevels, marketDeal, mode, quantile, referenceMonth, summarize, windowStart, WINDOW_DAYS } from "./complex-price.ts";
import { newJeonse } from "./complex-ratio.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { INDEX_FILE } from "./fetch-price-index.ts";
import { BASIS_DATE as CASH_BASIS } from "./min-cash.ts";
import { BASIS_DATE as COST_BASIS } from "./purchase-costs.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { RAW_DIR, readSameNames, readSlotFile } from "./realestate-raw.ts";
import { recentMonths } from "./realestate-source.ts";
import { addPeers, checksOf } from "./recommendation-reasons.ts";
import { ALGORITHM_VERSION, APARTMENT_FIELDS, areaBand, CELL_FIELDS, costFields, gradeOf, LIMITS, priceBand, SCHEMA_VERSION, TYPES } from "./recommendation.ts";

const root = path.resolve(import.meta.dirname, "..");
const DAY_MS = 86_400_000;

export const recoFileName = (slug) => `reco-${slug}.json`;

const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const byText = ([a]: [unknown, unknown], [b]: [unknown, unknown]) => (a < b ? -1 : a > b ? 1 : 0);

const groupBy = <T>(rows: T[], keyOf: (row: T) => string | number) => {
  const out = new Map<string | number, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
};

/** 1㎡ 안쪽에서 가장 가까운 칸 이름. 창 밖 거래·전세를 지금 칸에 붙인다 - 그 줄로 칸 묶음을 다시 짜면 값의 칸 구성이 바뀐다(complex-price 의 1년 전 칸과 같은 규칙). */
function countByLabel(rows: { area: number }[] = [], labels: number[]) {
  const counts = new Map<number, number>();
  for (const { area } of rows) {
    let best = null;
    for (const label of labels) if (Math.abs(label - area) < AREA_GROUP && (best === null || Math.abs(label - area) < Math.abs(best - area))) best = label;
    if (best !== null) counts.set(best, (counts.get(best) ?? 0) + 1);
  }
  return counts;
}

/** 칸의 마지막 거래. 같은 날이면 값이 큰 쪽(입력 순서에 안 기댄다). */
const lastOf = (deals) => [...deals].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount || (b.floor ?? 0) - (a.floor ?? 0)))[0];

/** n<3 칸의 값대에 쓸 값. 값은 내지 않지만 뺀 곳을 값을 낸 칸과 같은 값대 표에 세야 하므로 같은 지수로 고친 중앙값이다. */
const thinValue = (deals, levels, reference) => quantile(deals.map((d) => adjust(d, levels, reference).value).sort((a, b) => a - b), 0.5);

/**
 * 구 하나의 단지 줄과 뺀 곳(position 은 서울 전체를 본 뒤 addPeers 가 채운다).
 * items: 창을 덮는 매매 원본, older: 그보다 이전 12개월 안 매매 원본(건수만), rents: 창을 덮는 전월세 원본, same: 그 구의 동명 이름(화면 이름용).
 */
export function districtRows({ items, older = [], rents = [], levels, reference, now, same = undefined }) {
  const since = windowStart(now);
  const yearStart = new Date(now.getTime() - 365 * DAY_MS).toISOString().slice(0, 10);
  const today = dayOf(now.toISOString().slice(0, 10));
  const deal = (item) => {
    const d = marketDeal(item);
    return d ? { ...d, id: stableId(locationKey(item)) } : null;
  };
  const all = [...items, ...older].map(deal).filter(Boolean);
  const inWindow = all.filter((d) => d.date >= since);
  const olderById = groupBy(all.filter((d) => d.date < since && d.date >= yearStart), (d) => d.id);
  const jeonse = rents.filter((item) => String(item?.aptNm ?? "").trim() && newJeonse(item) && dealDate(item) >= since);
  const jeonseById = groupBy(jeonse.map((item) => ({ id: stableId(locationKey(item)), area: Number(item.excluUseAr) })), (r) => r.id);

  const apartments = [];
  const thin = new Map<string, number>();
  for (const [id, group] of [...groupBy(inWindow, (d) => d.id)].sort(byText)) {
    const label = areaGroups(group);
    const labels = [...new Set<number>(label.values())];
    const olderCount = countByLabel(olderById.get(id), labels);
    const jeonseCount = countByLabel(jeonseById.get(id), labels);

    const cells = [];
    for (const [area, cellDeals] of [...groupBy(group, (d) => label.get(d.area))].sort(([a], [b]) => Number(a) - Number(b))) {
      const name = Number(area);
      const last = lastOf(cellDeals);
      const n = cellDeals.length;
      const age = today - dayOf(last.date);
      const sampleGrade = gradeOf({ n, age });
      if (!sampleGrade) {
        const key = `${priceBand(thinValue(cellDeals, levels, reference))}|${areaBand(name)}`;
        thin.set(key, (thin.get(key) ?? 0) + 1);
        continue;
      }
      // n≥3 이라 값이 있다(summarize 의 반환형은 n<3 의 빈 칸까지 품는다).
      const s = summarize(cellDeals, levels, reference) as any;
      const cost = costFields(s.median, name);
      cells.push([
        name, n, s.median, s.low, s.high, s.raw, s.unadjusted,
        cost.extra, cost.total, cost.loanGeneral, cost.loanFirstTime, cost.cashGeneral, cost.cashFirstTime,
        last.amount, last.date, last.floor, n + (olderCount.get(name) ?? 0), jeonseCount.get(name) ?? 0,
        sampleGrade, [], checksOf({ n, age, median: s.median }),
      ]);
    }
    if (!cells.length) continue;
    const [, dong, , name] = String(id).split("|");
    apartments.push([id, String(complexKey(name, dong, same)), dong, mode(group.map((d) => d.buildYear)), null, aliasesOf(id), cells]);
  }
  const excluded = [...thin]
    .map(([key, count]) => {
      const [band, area] = key.split("|");
      return { band: Number(band), area, thin: count };
    })
    .sort((a, b) => a.band - b.band || (a.area < b.area ? -1 : 1));
  return { apartments, excluded };
}

/** 25개 파일. 거래가 없는 구도 빈 파일을 낸다 - 화면이 「그 구를 못 읽음」과 「그 구에 값 없음」을 가를 수 있게. 기준 달을 못 정하면 던진다. */
export function buildFiles({ itemsByDistrict, olderByDistrict = {}, rentsByDistrict = {}, arrivalByDistrict = {}, index, outlook = null, now, sameNames = {} }) {
  const { levels, filled } = indexLevels(index, outlook);
  const reference = referenceMonth(levels);
  if (!reference) throw new Error("기준 달을 정하지 못했다(실거래가격지수 없음)");

  const rules = [CASH_BASIS, COST_BASIS].sort()[0];
  const files: Record<string, any> = {};
  for (const { code, name } of DISTRICTS) {
    const slug = DISTRICT_SLUGS[name];
    if (!slug) continue;
    files[slug] = {
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      updatedAt: now.toISOString(),
      district: name,
      districtCode: code,
      windowDays: WINDOW_DAYS,
      asOf: {
        deals: arrivalByDistrict[code] ?? null,
        windowStart: windowStart(now),
        indexRef: reference,
        indexFilled: Object.values<string[]>(filled).some((months) => months.includes(reference)),
        rules,
      },
      types: TYPES,
      apartmentFields: APARTMENT_FIELDS,
      cellFields: CELL_FIELDS,
      ...districtRows({
        items: itemsByDistrict[code] ?? [],
        older: olderByDistrict[code] ?? [],
        rents: rentsByDistrict[code] ?? [],
        levels,
        reference,
        now,
        same: sameNames[code],
      }),
    };
  }
  addPeers(Object.values(files));
  return { reference, files };
}

/** 파일 내용과 gzip 크기, 한도 판정. 개수도 한도다 - 25개가 아니면 화면의 「n구를 못 읽음」이 거짓이 된다. */
export function checkLimits(files, limits = LIMITS) {
  const texts = Object.entries(files).map(([slug, file]) => [slug, `${JSON.stringify(file)}\n`]);
  const sizes = Object.fromEntries(texts.map(([slug, text]) => [slug, gzipSync(text, { level: 9 }).length]));
  const total = Object.values<number>(sizes).reduce((a, b) => a + b, 0);
  const problems = [];
  if (texts.length !== limits.files) problems.push(`파일 ${texts.length}개(${limits.files}개여야 한다)`);
  for (const [slug, size] of Object.entries<number>(sizes)) if (size > limits.fileGzip) problems.push(`${slug} ${size}B > ${limits.fileGzip}B`);
  if (total > limits.totalGzip) problems.push(`합 ${total}B > ${limits.totalGzip}B`);
  return { texts, sizes, total, problems };
}

/** 임시 폴더에 다 쓴 뒤 옮긴다. docs/data 옆이라 rename 이 같은 디스크이고, docs/data 밖이라 커밋(docs/data·raw)에 안 섞인다. */
async function writeAll(dataDir, texts) {
  const next = path.join(path.dirname(dataDir), ".reco-next");
  try {
    await rm(next, { recursive: true, force: true });
    await mkdir(next, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    for (const [slug, text] of texts) await writeFile(path.join(next, recoFileName(slug)), text);
    for (const [slug] of texts) await rename(path.join(next, recoFileName(slug)), path.join(dataDir, recoFileName(slug)));
  } finally {
    await rm(next, { recursive: true, force: true });
  }
}

/** 입력 슬롯. 값을 내는 달의 슬롯이 없거나 실패 표시면 그 세대를 포기한다 - 한 구의 거래가 빈 채로 나가면 「값 없음」으로 읽힌다. */
async function requiredSlots(kind, code, months, rawDir) {
  const files = await Promise.all(months.map((m) => readSlotFile(kind, code, m, rawDir)));
  const bad = months.filter((_, i) => files[i]?.ok === false || !Array.isArray(files[i]?.items));
  if (bad.length) throw new Error(`입력 슬롯 없음: ${kind} ${code} ${bad.join(",")}`);
  return files;
}

const readJson = (file) => readFile(file, "utf8").then(JSON.parse, () => null);

/** 한 세대 만들기. 실패는 던진다(파일은 하나도 안 바뀐다). */
export async function generate({ now, dataDir, rawDir = RAW_DIR, indexFile = INDEX_FILE, limits = LIMITS }) {
  const [index, outlook] = await Promise.all([readJson(indexFile), readJson(path.join(dataDir, "outlook.json"))]);
  if (!index) throw new Error("실거래가격지수가 없다");

  // 창(183일)을 다 덮으려면 이번 달 포함 일곱 달, 12개월 건수는 그 앞 여섯 달을 더 본다. 앞 여섯 달은 보관이 모자란 시점이 있어 없어도 된다(건수만 줄어든다).
  const months = recentMonths(now, 7);
  const olderMonths = recentMonths(now, 13).slice(0, 6);
  const itemsByDistrict = {};
  const olderByDistrict = {};
  const rentsByDistrict = {};
  const arrivalByDistrict = {};
  await Promise.all(
    DISTRICTS.map(async ({ code }) => {
      const [sale, rent, older] = await Promise.all([
        requiredSlots("sale", code, months, rawDir),
        requiredSlots("rent", code, months, rawDir),
        Promise.all(olderMonths.map((m) => readSlotFile("sale", code, m, rawDir))),
      ]);
      itemsByDistrict[code] = sale.flatMap((f) => f.items);
      rentsByDistrict[code] = rent.flatMap((f) => f.items);
      olderByDistrict[code] = older.filter((f) => f?.ok !== false && Array.isArray(f?.items)).flatMap((f) => f.items);
      arrivalByDistrict[code] = sale.flatMap((f) => Object.values<string>(f.arrivals ?? {})).sort().at(-1) ?? null;
    })
  );

  const built = buildFiles({ itemsByDistrict, olderByDistrict, rentsByDistrict, arrivalByDistrict, index, outlook, now, sameNames: await readSameNames(rawDir) });
  const checked = checkLimits(built.files, limits);
  if (checked.problems.length) throw new Error(`한도 초과: ${checked.problems.join(", ")}`);
  await writeAll(dataDir, checked.texts);
  return { ...built, ...checked };
}

async function main() {
  const dataDir = process.env.RECO_DATA_DIR ? path.resolve(process.env.RECO_DATA_DIR) : path.join(root, "docs/data");
  const { reference, files, sizes, total } = await generate({ now: collectionNow("BUILD_NOW"), dataDir });
  const list = Object.values<any>(files);
  const apartments = list.flatMap((f) => f.apartments);
  const cells = apartments.reduce((sum, row) => sum + row[APARTMENT_FIELDS.indexOf("cells")].length, 0);
  const thin = list.flatMap((f) => f.excluded).reduce((sum, e) => sum + e.thin, 0);
  console.log(`  근거표: 기준 ${reference}, ${list.length}개 구, 값을 낸 칸 ${cells}개·단지 ${apartments.length}개, 뺀 칸 ${thin}개, gzip 최대 ${Math.max(...Object.values<number>(sizes))}B·합 ${total}B`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const soft = process.argv.includes("--soft-fail");
  main().catch((err) => {
    if (soft) {
      console.log(`::warning::근거표 생성 실패 - 어제 reco-*.json 을 그대로 둡니다: ${err.message}`);
      return;
    }
    console.error(`근거표 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
