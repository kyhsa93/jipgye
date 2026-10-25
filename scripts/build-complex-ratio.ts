import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICTS } from "./realestate-districts.ts";
import { readSlotFile } from "./realestate-raw.ts";
import { recentMonths } from "./realestate-source.ts";
import { cellRatios, spreadOf } from "./complex-ratio.ts";
import { runRenewalCells } from "./build-renewal-cells.ts";

const root = path.resolve(import.meta.dirname, "..");

/** 시세 화면과 같은 창. 칸 하나에 매매·전세가 각각 세 건씩 있어야 해서 짧으면 안 찬다. */
export const MONTHS = 6;

const outFile = process.env.COMPLEX_RATIO_FILE
  ? path.resolve(process.env.COMPLEX_RATIO_FILE)
  : path.join(root, "docs/data/complex-ratio.json");

const itemsOf = (files) =>
  files.filter((file) => file?.ok !== false && Array.isArray(file?.items)).flatMap((file) => file.items);

/** DISTRICTS 순서로 담는다 - 끝나는 대로 담으면 출력 순서가 그날그날 달라진다. */
export async function readRaw(months, dir?) {
  const perDistrict = await Promise.all(
    DISTRICTS.map(async ({ code, name }) => {
      const [sales, rents] = await Promise.all([
        Promise.all(months.map((ym) => readSlotFile("sale", code, ym, dir))).then(itemsOf),
        Promise.all(months.map((ym) => readSlotFile("rent", code, ym, dir))).then(itemsOf),
      ]);
      return [name, { sales, rents }];
    })
  );
  return Object.fromEntries(perDistrict);
}

export function buildPayload({ byDistrict, now }) {
  const districts = {};
  const all = [];

  for (const [name, { sales, rents }] of Object.entries<{ sales: unknown[]; rents: unknown[] }>(byDistrict ?? {})) {
    const ratios = cellRatios(sales, rents);
    all.push(...ratios);
    const spread = spreadOf(ratios);
    if (spread) districts[name] = spread;
  }

  if (!all.length) return null;
  return { updatedAt: now.toISOString(), seoul: spreadOf(all), districts };
}

async function main() {
  const now = new Date();
  // 재계약 확인기 데이터(#652 V3)를 여기서 함께 만든다 - 같은 원본(raw/rent)을 읽는 같은 단계이고, 신규 쪽이 이 화면의 창(MONTHS)을 쓴다.
  // update-all.mjs·daily-update.yml 에 따로 등록하지 않은 이유는 build-renewal-cells.ts 머리 주석. 소프트 실패라 던지지 않는다 -
  // 그 실패가 전세가율 파일을 막지 않게 먼저 돌리고 결과와 무관하게 아래로 간다.
  await runRenewalCells({ now, newMonths: MONTHS });
  const byDistrict = await readRaw(recentMonths(now, MONTHS));
  const payload = buildPayload({ byDistrict, now });

  if (!payload) {
    console.log("  단지별 전세가율을 낼 거래가 없습니다 - 기존 파일을 그대로 둡니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  const { seoul, districts }: { seoul: { cells: number; median: number; q1?: number; q3?: number }; districts: object } = payload;
  console.log(
    `  단지·평형 ${seoul.cells.toLocaleString("ko-KR")}칸 · 서울 중앙 ${seoul.median}% (절반이 ${seoul.q1}~${seoul.q3}%)`
  );
  console.log(`  분위를 말할 수 있는 자치구 ${Object.keys(districts).length}곳`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`단지별 전세가율 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
