import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cancellationTiming,
  districtStats,
  isCancelled,
  leadSentence,
  priceStanding,
  registrationByMonth,
  registrationSentence,
  registrationStats,
} from "./cancellation.mjs";
import { priceBandSentence, priceBandStats, priceBandTableHtml } from "./cancel-by-price.mjs";
import { DISTRICTS } from "./realestate-districts.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { RETENTION_MONTHS } from "./realestate-slots.mjs";
import { recentMonths } from "./realestate-source.mjs";

const root = path.resolve(import.meta.dirname, "..");

// 해제도 등기도 신고 뒤에 몇 달에 걸쳐 일어난다. 석 달만 보면 등기가 끝난 계약이
// 얼마 없어 "늦었다"고 할 기준 자체를 세울 수 없다.
export const MONTHS = 6;

const outFile = process.env.CANCELLATION_FILE
  ? path.resolve(process.env.CANCELLATION_FILE)
  : path.join(root, "docs/data/cancellation.json");

/**
 * 시세용 읽기(readDealSource)는 해제 거래를 이미 버린 뒤에 넘겨준다.
 * 여기서는 버려진 쪽이 관심사라 원본을 그대로 읽는다.
 *
 * 자치구를 DISTRICTS 순서로 담는 것이 중요하다. 완료되는 대로 담으면 그날 디스크가
 * 어느 파일을 먼저 내주었는지가 그대로 출력 순서가 되고, 자치구 링크 줄이 빌드할
 * 때마다 뒤바뀌어 매일 뜻 없는 변경이 커밋된다.
 */
export async function readRawSales(months, dir) {
  const perDistrict = await Promise.all(
    DISTRICTS.map(async ({ code, name }) => {
      const files = await Promise.all(months.map((yearMonth) => readSlotFile("sale", code, yearMonth, dir)));
      const items = files
        .filter((file) => file?.ok !== false && Array.isArray(file?.items))
        .flatMap((file) => file.items);
      return [name, items];
    })
  );

  return Object.fromEntries(perDistrict.filter(([, items]) => items.length));
}

export function buildPayload({ byDistrict, months, now, registrationByDistrict = byDistrict }) {
  const all = Object.values(byDistrict ?? {}).flat();
  if (!all.length) return null;

  const cancelled = all.filter(isCancelled).length;
  const timing = cancellationTiming(all);
  const standing = priceStanding(all);
  // 등기는 원본 전체로 센다. 익은 달은 계약 뒤 넉 달은 지나야 생겨 여섯 달 창 안에는 없을 수 있다(#27).
  const registrationAll = Object.values(registrationByDistrict ?? {}).flat();
  const registration = registrationStats(registrationAll);
  const priceBands = priceBandStats(registrationAll);

  const seoul = {
    deals: all.length,
    cancelled,
    cancelledShare: Math.round((cancelled / all.length) * 1000) / 10,
    timing,
    standing,
    registration,
  };

  return {
    updatedAt: now.toISOString(),
    months,
    seoul: {
      ...seoul,
      leadKo: leadSentence({ deals: all.length, cancelled, timing, standing, months }, "ko"),
      leadEn: leadSentence({ deals: all.length, cancelled, timing, standing, months }, "en"),
      registrationLead: { ko: registrationSentence(registration, "ko"), en: registrationSentence(registration, "en") },
    },
    // 가격대별 해제율은 원본 전체에서 해제가 다 쌓인 달만, 같은 달 안에서 견준다(scripts/cancel-by-price.mjs).
    priceBands: priceBands
      ? {
          ...priceBands,
          lead: { ko: priceBandSentence(priceBands, "ko"), en: priceBandSentence(priceBands, "en") },
          table: { ko: priceBandTableHtml(priceBands, "ko"), en: priceBandTableHtml(priceBands, "en") },
        }
      : null,
    slugs: Object.fromEntries(
      Object.keys(byDistrict)
        .filter((name) => DISTRICT_SLUGS[name])
        .map((name) => [name, DISTRICT_SLUGS[name]])
    ),
    districts: districtStats(byDistrict, registration?.matureMonths ?? null, undefined, registrationByDistrict),
    registrationByMonth: registrationByMonth(registrationAll),
  };
}

async function main() {
  const now = new Date();
  const months = recentMonths(now, MONTHS);
  const byDistrict = await readRawSales(months);
  const registrationByDistrict = await readRawSales(recentMonths(now, RETENTION_MONTHS));

  const payload = buildPayload({ byDistrict, months, now, registrationByDistrict });
  if (!payload) {
    console.log("  매매 원본이 없습니다 - 기존 해제 데이터를 그대로 둡니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  const { seoul } = payload;
  console.log(
    `  해제 ${seoul.cancelled.toLocaleString("ko-KR")}건 / 신고 ${seoul.deals.toLocaleString("ko-KR")}건 (${seoul.cancelledShare}%)` +
      ` · 계약→해제 중앙값 ${seoul.timing?.medianDays ?? "-"}일`
  );
  console.log(
    `  등기 중앙값 ${seoul.registration?.medianDays ?? "-"}일 · 익은 달 ${(seoul.registration?.matureMonths ?? []).join(", ") || "-"}` +
      ` 계약 ${seoul.registration?.matured?.toLocaleString("ko-KR") ?? "-"}건 중 미등기` +
      ` ${seoul.registration?.stale?.toLocaleString("ko-KR") ?? "-"}건 (${seoul.registration?.staleShare ?? "-"}%)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`해제 통계 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
