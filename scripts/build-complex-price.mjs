import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { districtCells, districtMeta, indexLevels, marketDeal, referenceMonth, windowStart, WINDOW_DAYS } from "./complex-price.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";
import { INDEX_FILE } from "./fetch-price-index.mjs";
import { DISTRICTS } from "./realestate-districts.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { recentMonths } from "./realestate-source.mjs";
import { periods } from "./district-change.mjs";
import { shiftMonth } from "./outlook.mjs";
import { RETENTION_MONTHS, yearMonthOf } from "./realestate-slots.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = process.env.COMPLEX_PRICE_DIR ? path.resolve(process.env.COMPLEX_PRICE_DIR) : path.join(root, "docs/data");

export const complexPriceFileName = (slug) => `complex-price-${slug}.json`;

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 자치구마다 한 파일. 검색 화면은 고른 자치구의 것만 읽는다 - 서울 전체를 한 파일로 두면
 * 단지 하나를 보려고 수백 KB를 받는다.
 */
export function buildFiles({ itemsByDistrict, yearAgoByDistrict = {}, yearAgoMonths = null, index, outlook, now }) {
  const { levels, filled } = indexLevels(index, outlook);
  const reference = referenceMonth(levels);
  if (!reference) return null;

  const since = windowStart(now);
  const files = {};
  for (const { code, name } of DISTRICTS) {
    const slug = DISTRICT_SLUGS[name];
    if (!slug) continue;
    const deals = (itemsByDistrict[code] ?? []).map(marketDeal).filter((d) => d && d.date >= since);
    if (!deals.length) continue;
    files[slug] = {
      district: name,
      updatedAt: now.toISOString(),
      windowDays: WINDOW_DAYS,
      since,
      reference,
      // 기준 달이 공식 지수가 아니라 우리 원본으로 메운 달이면 화면이 그렇다고 적는다.
      referenceFilled: Object.values(filled).some((months) => months.includes(reference)),
      // 메운 달이 공식 지수보다 평균 얼마나 높게 나와 왔나(서울, %p). 화면 각주에 그대로 적는다.
      referenceBias: outlook?.regions?.find((r) => r.code === "200")?.nowcast?.bias ?? null,
      cells: districtCells(deals, levels, reference, {
        yearAgo: (yearAgoByDistrict[code] ?? []).map(marketDeal).filter(Boolean),
        yearAgoMonths,
      }),
      meta: districtMeta(deals),
    };
  }
  return { reference, files };
}

async function main() {
  const now = new Date();
  const [index, outlook] = await Promise.all([readJson(INDEX_FILE), readJson(path.join(dataDir, "outlook.json"))]);
  if (!index) {
    console.log("  단지 가격 위치: 실거래가격지수가 없어 건너뜀");
    return;
  }

  // 창(183일)을 다 덮으려면 이번 달 포함 일곱 달.
  const months = recentMonths(now, 7);
  const itemsByDistrict = {};
  await Promise.all(
    DISTRICTS.map(async ({ code }) => {
      const files = await Promise.all(months.map((m) => readSlotFile("sale", code, m)));
      itemsByDistrict[code] = files.filter((f) => f?.ok !== false && Array.isArray(f?.items)).flatMap((f) => f.items);
    })
  );

  // 1년 전 같은 칸: 갈아타기 화면과 같은 두 시기 규칙(신고 기한이 닫힌 최근 석 달의 1년 전 석 달, 원본이
  // 아직 거기까지 없으면 가장 이른 석 달)을 쓴다 - 화면마다 "1년 전"이 다르면 숫자가 서로 어긋난다.
  const allMonths = recentMonths(now, RETENTION_MONTHS);
  const present = [];
  for (const m of allMonths) if (await readSlotFile("sale", DISTRICTS[0].code, m)) present.push(m);
  const p = periods(shiftMonth(yearMonthOf(now), -2), present);
  const yearAgoByDistrict = {};
  if (p) {
    await Promise.all(
      DISTRICTS.map(async ({ code }) => {
        const files = await Promise.all(p.base.map((m) => readSlotFile("sale", code, m)));
        yearAgoByDistrict[code] = files.filter((f) => f?.ok !== false && Array.isArray(f?.items)).flatMap((f) => f.items);
      })
    );
  }
  const built = buildFiles({ itemsByDistrict, yearAgoByDistrict, yearAgoMonths: p?.base ?? null, index, outlook, now });
  if (!built) {
    console.log("  단지 가격 위치: 기준 달을 정하지 못해 건너뜀");
    return;
  }

  await mkdir(dataDir, { recursive: true });
  let cells = 0;
  let ranged = 0;
  // 자치구 순서대로 쓴다 - 완료 순서가 출력 순서가 되면 값이 안 변해도 diff가 난다.
  for (const [slug, file] of Object.entries(built.files)) {
    await writeFile(path.join(dataDir, complexPriceFileName(slug)), `${JSON.stringify(file)}\n`);
    for (const areas of Object.values(file.cells)) {
      for (const cell of Object.values(areas)) {
        cells += 1;
        if (cell.median) ranged += 1;
      }
    }
  }
  console.log(
    `  단지 가격 위치: 기준 ${built.reference}, ${Object.keys(built.files).length}개 구, ` +
      `칸 ${cells}개 중 범위를 낸 칸 ${ranged}개`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
