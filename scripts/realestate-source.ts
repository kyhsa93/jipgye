import { DISTRICTS } from "./realestate-districts.ts";
import { dropCancelled, normalizeDeal, normalizeRentDeal } from "./realestate-metrics.ts";
import { readSlotFile } from "./realestate-raw.ts";
import { shiftMonth, yearMonthOf } from "./realestate-slots.ts";

export const SEARCH_MONTHS = 3;

export function recentMonths(now, count = SEARCH_MONTHS) {
  const current = yearMonthOf(now);
  return Array.from({ length: count }, (_, i) => shiftMonth(current, -(count - 1 - i)));
}

// 읽기는 동시에 하되 합치는 건 고정 순서로 한다: months -> DISTRICTS 인덱스 순(값 정렬 아님).
// Promise.all 은 완료 순서가 아니라 넘긴 순서대로 결과를 돌려준다. 읽는 쪽 콜백에서 바로 Map 에 넣으면 구별 거래 배열과
// Map 키 순서가 슬롯 완료 순서를 따르고(내보내는 객체의 구 키는 정수 꼴이라 오름차순으로 다시 선다), budget-facts 의 면적 동률 안정 정렬이 그 순서를 그대로 남겨 budget-deals.json 의
// bands[*].facts.span.min 이 실행마다 갈렸다(#572, cto 11-15 실험: 0~30ms 지연을 섞은 23회 중 15회 다름·6종). #477 readWindowItems 와 같은 모양이다.
// `read` 는 시험이 완료 순서를 뒤집어 보려고 갈아 끼우는 자리다. 서명은 readSlotFile 과 같은 (kind, code, yearMonth).
async function collect(kind, months, normalize, read = readSlotFile) {
  const slots = await Promise.all(
    months.flatMap((yearMonth) =>
      DISTRICTS.map(async ({ code, name }) => ({ code, name, file: await read(kind, code, yearMonth) }))
    )
  );

  const byDistrict = new Map();
  let cancelled = 0;

  for (const { code, name, file } of slots) {
    if (file?.ok === false || !Array.isArray(file?.items)) continue;

    const items = kind === "sale" ? dropCancelled(file.items) : file.items;
    cancelled += file.items.length - items.length;

    const deals = items.map((item) => normalize(item, name)).filter(Boolean);
    if (!deals.length) continue;

    if (!byDistrict.has(code)) byDistrict.set(code, []);
    byDistrict.get(code).push(...deals);
  }

  return { byDistrict, cancelled };
}

export async function readDealSource(now, months = recentMonths(now), read = readSlotFile) {
  const { byDistrict, cancelled } = await collect("sale", months, normalizeDeal, read);
  return {
    period: months[months.length - 1],
    months,
    cancelled,
    districts: Object.fromEntries(byDistrict),
  };
}

export async function readRentSource(now, months = recentMonths(now), read = readSlotFile) {
  const { byDistrict } = await collect("rent", months, normalizeRentDeal, read);
  return {
    period: months[months.length - 1],
    months,
    districts: Object.fromEntries(byDistrict),
  };
}
