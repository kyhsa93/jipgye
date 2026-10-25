import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { directDealStats } from "./direct-deals.ts";
import { DISTRICTS } from "./realestate-districts.ts";

const root = path.resolve(import.meta.dirname, "..");

const outFile = () =>
  process.env.DIRECT_DEALS_FILE ? path.resolve(process.env.DIRECT_DEALS_FILE) : path.join(root, "docs/data/direct-deals.json");

/** 서울 거래가 한 건도 없으면 null - 호출자는 기존 파일을 그대로 둔다. */
export function buildPayload({ byDistrict, months, now }) {
  if (!Object.values(byDistrict ?? {}).flat().length) return null;
  return { updatedAt: now.toISOString(), ...directDealStats(byDistrict, months, DISTRICTS) };
}

/**
 * 해제 빌더(build-cancellation.ts)가 이미 읽은 24개월 원본으로 부른다 - 원본을 두 번 읽지 않고, 빌더 등록 줄
 * (update-all.mjs·daily-update.yml)을 늘리지 않는다(#691 판정). 던지면 호출자가 삼킨다.
 */
export async function writeDirectDeals({ byDistrict, months, now }) {
  const payload = buildPayload({ byDistrict, months, now });
  if (!payload) {
    console.log("  직거래: 매매 원본이 없어 기존 파일을 그대로 둡니다");
    return null;
  }
  const file = outFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(payload));
  const { seoul } = payload;
  console.log(
    `  직거래 비중 ${seoul.closedShare ?? "-"}% (닫힌 달) · 같은 칸 격차 ${seoul.gap.median ?? "-"}% · 칸 ${seoul.gap.cells}` +
      ` · 격차를 적는 구 ${Object.values(payload.districts).filter((r: any) => r.gap.median !== null).length}곳`
  );
  return payload;
}

/** 해제 빌더 안에서 부르는 소프트 실패 래퍼. 실패해도 해제 산출물과 Daily 는 그대로 간다. */
export async function tryWriteDirectDeals(input) {
  try {
    return await writeDirectDeals(input);
  } catch (err) {
    console.log(`  직거래 통계를 만들지 못했습니다 - 기존 파일을 그대로 둡니다: ${err?.message ?? err}`);
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { readRawSales } = await import("./build-cancellation.ts");
  const { recentMonths } = await import("./realestate-source.ts");
  const { RETENTION_MONTHS } = await import("./realestate-slots.ts");
  const now = new Date();
  const months = recentMonths(now, RETENTION_MONTHS);
  await writeDirectDeals({ byDistrict: await readRawSales(months), months, now });
}
