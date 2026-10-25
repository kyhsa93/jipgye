import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { capLead, districtRow, renewalFacts, seoulLead, seoulTally, sortRows, sortWolseRows, tally, wolseLead } from "./renewal-facts.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { readSlotFile } from "./realestate-raw.ts";
import { recentMonths } from "./realestate-source.ts";
import { RENT_FLOW_MONTHS, buildRentFlow, writeRentFlowFile } from "./rent-flow.ts";

const root = path.resolve(import.meta.dirname, "..");

// 신고 기한이 지나 닫힌 달만 세므로, 창이 짧으면 셀 것이 거의 남지 않는다.
export const MONTHS = 6;

const outFile = process.env.RENEWAL_FACTS_FILE
  ? path.resolve(process.env.RENEWAL_FACTS_FILE)
  : path.join(root, "docs/data/renewal-facts.json");

// 자치구별 월세화 흐름 24개월(V7). 같은 원본(raw/rent)을 읽는 이 빌더가 같이 만든다 - Daily 에 새 줄을 넣지 않는다.
export const rentFlowFile = process.env.RENT_FLOW_FILE
  ? path.resolve(process.env.RENT_FLOW_FILE)
  : path.join(root, "docs/data/rent-flow.json");

/** 자치구 → 달 → 신고 목록. 그 달 파일이 없거나 ok:false 면 null 로 둔다(그 달은 0건이 아니라 모름이다). DISTRICTS 순서. */
export async function readRentsByMonth(months, dir?) {
  const out = {};
  for (const { code, name } of DISTRICTS) {
    const files = await Promise.all(months.map((m) => readSlotFile("rent", code, m, dir)));
    out[name] = Object.fromEntries(
      months.map((m, i) => [m, files[i]?.ok !== false && Array.isArray(files[i]?.items) ? files[i].items : null])
    );
  }
  return out;
}

/**
 * 월세화 흐름을 만들어 쓴다. 실패는 경고 한 줄로 끝나고 이전 파일이 그대로 남는다(soft-fail, #644 와 같은 모양) -
 * 재계약 관찰(이 빌더의 본업)과 Daily 의 나머지 단계를 막지 않는다.
 */
export async function writeRentFlowSoft(now, { dir = undefined, file = rentFlowFile } = {}) {
  try {
    const months = recentMonths(now, RENT_FLOW_MONTHS);
    const payload = buildRentFlow({ byDistrict: await readRentsByMonth(months, dir), months, now });
    await mkdir(path.dirname(file), { recursive: true });
    await writeRentFlowFile(file, payload);
    const shown = Object.values(payload.districts).filter((d: any) => d.compare?.recent?.wolseShare != null).length;
    console.log(`  월세화 흐름: ${months[0]}~${months.at(-1)} · 비중을 낸 구 ${shown}/${Object.keys(payload.districts).length}`);
    return true;
  } catch (err) {
    console.log(`::warning::월세화 흐름 생성 실패 - 이전 파일을 그대로 둡니다: ${err.message}`);
    return false;
  }
}

/**
 * 자치구를 DISTRICTS 순서로 담는다 - 완료되는 대로 담으면 출력 순서가 그날그날
 * 달라져 뜻 없는 변경이 매일 커밋된다.
 */
export async function readRawRents(months, dir?) {
  const perDistrict = await Promise.all(
    DISTRICTS.map(async ({ code, name }) => {
      const files = await Promise.all(months.map((yearMonth) => readSlotFile("rent", code, yearMonth, dir)));
      const items = files
        .filter((file) => file?.ok !== false && Array.isArray(file?.items))
        .flatMap((file) => file.items);
      return [name, items];
    })
  );

  return Object.fromEntries(perDistrict.filter(([, items]) => items.length));
}

/** 월세 재계약을 묶을 배수 - 전세 vs 월세 화면이 실측한 서울 전환율. 없으면 월세 쪽은 내지 않는다. */
export async function readWolseRate(file = path.join(root, "docs/data/conversion.json")) {
  try {
    const rate = JSON.parse(await readFile(file, "utf8"))?.seoul?.rate;
    return rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

export function buildPayload({ byDistrict, now, wolseRate = null }) {
  const options = { wolseRate };
  const seoul = seoulTally(byDistrict, now, options);
  if (!seoul.renewals) return null;

  // 자치구 페이지가 쓰는 쪽(문턱을 넘은 관찰만)과 재계약 화면이 쓰는 쪽(스물다섯 구
  // 전부, 문턱을 못 넘었으면 못 넘었다고 적을 수 있게 건수까지)을 같이 담는다.
  // 한 번 센 것을 두 모양으로 내보내는 것이라 세는 일은 여전히 한 곳에서만 한다.
  const districts = {};
  const table = [];

  for (const [name, items] of Object.entries(byDistrict ?? {})) {
    const districtTally = tally(items, now, options);
    const facts = renewalFacts(districtTally, seoul);
    if (facts) districts[name] = facts;
    table.push(districtRow(name, districtTally));
  }

  const slugs = {};
  for (const row of table) {
    if (DISTRICT_SLUGS[row.district]) slugs[row.district] = DISTRICT_SLUGS[row.district];
  }

  return {
    updatedAt: now.toISOString(),
    seoul,
    districts,
    table: sortRows(table),
    ...(seoul.wolse ? { wolseTable: sortWolseRows(table), wolseLead: { ko: wolseLead(seoul, "ko"), en: wolseLead(seoul, "en") } } : {}),
    slugs,
    lead: { ko: seoulLead(seoul, "ko"), en: seoulLead(seoul, "en") },
    capLead: { ko: capLead(seoul, "ko"), en: capLead(seoul, "en") },
  };
}

async function main() {
  const now = new Date();
  await writeRentFlowSoft(now);
  const byDistrict = await readRawRents(recentMonths(now, MONTHS));
  const payload = buildPayload({ byDistrict, now, wolseRate: await readWolseRate() });

  if (!payload) {
    console.log("  갱신 신고가 없습니다 - 기존 재계약 관찰을 그대로 둡니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  const { seoul, districts } = payload;
  console.log(
    `  재계약 ${seoul.renewals.toLocaleString("ko-KR")}건 · 요구권 행사 ${seoul.rightUsed.toLocaleString("ko-KR")}건 중` +
      ` 상한 미달 ${seoul.capMissShare}% · 전세→월세 전환 ${seoul.toWolseShare}%`
  );
  if (seoul.gapMatched) {
    console.log(
      `  갱신 vs 신규 전세: 맞물린 ${seoul.gapMatched.toLocaleString("ko-KR")}건 중앙값 ${seoul.gapMedian}% ·` +
        ` 시세보다 싸게 맺어진 재계약 ${seoul.gapCheaperShare}%`
    );
  }
  if (seoul.wolse?.matched) {
    console.log(
      `  월세 갱신 vs 신규(전환율 ${seoul.wolse.rate}%): 맞물린 ${seoul.wolse.matched.toLocaleString("ko-KR")}건 중앙값 ${seoul.wolse.median}%` +
        ` · ${seoul.wolse.range.map((r) => `${r.rate}%에서 ${r.median}%`).join(" · ")}`
    );
  }
  console.log(`  문턱을 넘은 자치구 ${Object.keys(districts).length}곳: ${Object.keys(districts).join(", ") || "없음"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`재계약 관찰 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
