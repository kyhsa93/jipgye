import { DISTRICTS } from "./realestate-districts.ts";
import { dropCancelled, normalizeDeal, normalizeRentDeal } from "./realestate-metrics.ts";
import { readSlotFile } from "./realestate-raw.ts";
import { readRecollectedSlot } from "./realestate-recollect.ts";
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

// 매매는 재수집 덧씌움을 합쳐 읽는다(#900 (가) 전환). 같은 장(deal-search)의 시세 칸(build-complex-price)이 이미 덧씌움을 읽어, 거래 목록만
// 저장 그대로면 한 장이 두 기준으로 그려졌다 - round 202611 측정에서 어긋남 행 36(나간 10·들어온 26, 15개 구, #900 issuecomment-6913088769).
// 바꾸는 곳은 #572 가 넣은 읽기 인자의 기본값 하나다(합치기는 realestate-recollect.ts mergeRecollect 한 곳, 합치는 순서는 collect 그대로).
// 덧씌움이 없거나 낡았으면 readRecollectedSlot 이 슬롯을 그대로 돌려주므로 출력은 readSlotFile 로 읽을 때와 같다.
// 전월세(readRentSource)는 재수집 대상이 아니라 readSlotFile 그대로 둔다 - 대표 시세(build-realestate)가 그 함수를 쓴다.
export async function readDealSource(now, months = recentMonths(now), read = readRecollectedSlot) {
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
