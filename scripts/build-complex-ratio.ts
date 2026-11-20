import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICTS } from "./realestate-districts.ts";
import { readSameNames, readSlotFile } from "./realestate-raw.ts";
import { readRecollectedSlot } from "./realestate-recollect.ts";
import { recentMonths } from "./realestate-source.ts";
import { cellRatios, spreadOf } from "./complex-ratio.ts";
import { runRenewalCells } from "./build-renewal-cells.ts";
import { runJeonseRisk } from "./build-jeonse-risk.ts";
import { runReverseJeonse } from "./build-reverse-jeonse.ts";

const root = path.resolve(import.meta.dirname, "..");

/** 시세 화면과 같은 창. 칸 하나에 매매·전세가 각각 세 건씩 있어야 해서 짧으면 안 찬다. */
export const MONTHS = 6;

const outFile = process.env.COMPLEX_RATIO_FILE
  ? path.resolve(process.env.COMPLEX_RATIO_FILE)
  : path.join(root, "docs/data/complex-ratio.json");

const itemsOf = (files) =>
  files.filter((file) => file?.ok !== false && Array.isArray(file?.items)).flatMap((file) => file.items);

/**
 * DISTRICTS 순서로 담는다 - 끝나는 대로 담으면 출력 순서가 그날그날 달라진다.
 * 매매만 재수집 덧씌움을 합쳐 읽는다(#900 (가) 전환). 전세 비중(build-jeonse-risk)이 1년 전 값을 덧씌움을 읽은 complex-price-*.json 에서
 * 가져오는데 칸 집합·전세가율은 저장 매매로 만들어, 한 숫자 안에 두 기준이 섞였다 - round 202611 측정에서 어긋남 칸 53(18개 구, #900).
 * 전월세는 재수집 대상이 아니라 저장 그대로다. 덧씌움이 없으면 readRecollectedSlot 이 슬롯을 그대로 돌려줘 출력이 전과 같다.
 * 동명 단지 판정(readSameNames)은 덧씌움과 무관하게 늘 저장 원본이다(#861 정정 ④ 8행 고정).
 */
export async function readRaw(months, dir?) {
  const sameNames = await readSameNames(dir);
  const perDistrict = await Promise.all(
    DISTRICTS.map(async ({ code, name }) => {
      const [sales, rents] = await Promise.all([
        Promise.all(months.map((ym) => readRecollectedSlot("sale", code, ym, dir))).then(itemsOf),
        Promise.all(months.map((ym) => readSlotFile("rent", code, ym, dir))).then(itemsOf),
      ]);
      return [name, { sales, rents, same: sameNames[code] }];
    })
  );
  return Object.fromEntries(perDistrict);
}

export function buildPayload({ byDistrict, now }) {
  const districts = {};
  const all = [];

  for (const [name, { sales, rents, same }] of Object.entries<{ sales: unknown[]; rents: unknown[]; same?: Set<string> }>(byDistrict ?? {})) {
    const ratios = cellRatios(sales, rents, same);
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
  // 2년 전 계약 대비 신규 전세(#693 N11): 같은 원본(raw/rent)을 자기 창(M−23~M−21·M−4~M−2)으로 따로 읽는다(readRaw 를 쓰지 않음).
  // 소프트 실패라 던지지 않는다(build-reverse-jeonse.ts 머리 주석) - 아래 전세가율 파일과 무관하게 돈다.
  await runReverseJeonse({ now });
  const months = recentMonths(now, MONTHS);
  const byDistrict = await readRaw(months);
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

  // 전세가율 높은 칸(#690 N8): 방금 읽은 같은 원본으로 끝에서 만든다. 소프트 실패라 던지지 않는다(build-jeonse-risk.ts 머리 주석).
  await runJeonseRisk({ byDistrict, months: [months[0], months.at(-1)], now });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`단지별 전세가율 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
