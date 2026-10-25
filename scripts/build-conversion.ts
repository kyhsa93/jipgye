import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AREA_BANDS, LOAN_LTV, cellNote, conversionPairs, districtRates, leadSentence, median, verdictOf } from "./conversion.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { latestRate } from "./mortgage.ts";
import { readRentSource, recentMonths } from "./realestate-source.ts";

const root = path.resolve(import.meta.dirname, "..");

// 자치구를 세 면적대로 다시 쪼개면 한 칸이 얇아진다. 시세 화면이 쓰는 3개월로는
// 75칸 중 두 칸이 비어서, 여기서만 여섯 달을 본다. 전환율은 주 단위로 움직이는
// 값이 아니라 길게 봐도 무디어지지 않는다.
export const MONTHS = 6;

const outFile = process.env.CONVERSION_FILE
  ? path.resolve(process.env.CONVERSION_FILE)
  : path.join(root, "docs/data/conversion.json");

// 대출·예금 금리는 지표 수집(fetch-indicators)이 매일 받는 한국은행 ECOS 계열이다(#577 B1b). 전에는 금감원 공시(docs/data/rates.json)였다.
const seriesFile = process.env.SERIES_FILE
  ? path.resolve(process.env.SERIES_FILE)
  : path.join(root, "raw/indicators/series.json");

/**
 * 대출·예금 금리: ECOS 두 계열이 **둘 다 값을 가진 가장 최근 달**의 값.
 * - loan: jeonse_loan_rate(121Y015 BECBLB020210) 예금은행 전세자금대출 평균금리, **잔액 기준**(신규취급액 표에 항목이 없다, #580).
 * - deposit: deposit_rate(121Y002 BEABAA211) 정기예금 신규취급 평균금리.
 * 화면이 "예금 금리(같은 달)"라고 적으므로 두 계열의 달을 맞춘다 - 한쪽이 한 달 앞서 있으면 그 달은 건너뛴다.
 * 비거나 0 이하인 달은 쓰지 않는다(latestRate 와 같은 규칙, #269). 맞는 달이 없으면 null - 지어낸 금리로 판정하지 않는다.
 */
export function ratesOf(series) {
  const valid = (rows) => (Array.isArray(rows) ? rows.filter((row) => latestRate([row])) : []);
  const deposits = new Map(valid(series?.deposit_rate).map((row) => [String(row[0]), Number(row[1])]));
  const loanRow = valid(series?.jeonse_loan_rate).filter((row) => deposits.has(String(row[0]))).at(-1);
  if (!loanRow) return null;
  const month = String(loanRow[0]);
  return {
    loan: { rate: Number(loanRow[1]), month, basis: "balance" },
    deposit: { rate: deposits.get(month), month },
  };
}

export function buildPayload({ deals, series, months, now }) {
  const pairs = conversionPairs(deals);
  const cells = districtRates(pairs);
  if (!cells.length) return null;

  const rates = ratesOf(series);
  if (!rates) return null;
  const { loan, deposit } = rates;

  const seoulRate = Math.round(median(pairs.map((p) => p.rate)) * 100) / 100;
  const labelOf = (key) => AREA_BANDS.find((b) => b.key === key)?.label ?? key;
  const labelEnOf = (key) => ({ under60: "under 60m2", "60to85": "60-85m2", over85: "85m2 and up" })[key] ?? key;

  const noted = cells.map((cell) => ({
    ...cell,
    noteKo: cellNote(cell, loan.rate, labelOf(cell.band), "ko"),
    noteEn: cellNote(cell, loan.rate, labelEnOf(cell.band), "en"),
  }));

  const lead = { rate: seoulRate, loanRate: loan.rate, loanMonth: loan.month, pairs: pairs.length, months };
  return {
    updatedAt: now.toISOString(),
    months,
    ltv: LOAN_LTV,
    bands: AREA_BANDS.map(({ key, label }) => ({ key, label })),
    slugs: Object.fromEntries(
      [...new Set(cells.map((c) => c.district))].filter((name) => DISTRICT_SLUGS[name]).map((name) => [name, DISTRICT_SLUGS[name]])
    ),
    seoul: {
      rate: seoulRate,
      pairs: pairs.length,
      verdict: verdictOf(seoulRate, loan.rate),
      leadKo: leadSentence(lead, "ko"),
      leadEn: leadSentence(lead, "en"),
    },
    loan,
    deposit,
    cells: noted,
  };
}

async function main() {
  const now = new Date();
  const months = recentMonths(now, MONTHS);
  const source = await readRentSource(now, months);
  const deals = Object.values(source.districts ?? {}).flat();

  if (!deals.length) {
    console.log("  전월세 원본이 없습니다 - 기존 전환율 데이터를 그대로 둡니다");
    return;
  }

  let series = null;
  try {
    series = JSON.parse(await readFile(seriesFile, "utf-8"))?.series ?? null;
  } catch {
    console.log("  지표 계열 파일이 없습니다 - 기존 전환율 데이터를 그대로 둡니다");
    return;
  }

  // 두 금리 계열이 아직 없거나(수집 전) 같은 달 값이 없으면 기존 conversion.json 을 그대로 둔다 - 화면은 마지막으로 만든 값을
  // 그 값의 금리 날짜와 함께 계속 보이고(교차 기준일 줄이 낡음을 알린다), 비거나 지어낸 금리를 내보내지 않는다.
  if (!ratesOf(series)) {
    console.log("  ECOS 전세자금대출·정기예금 금리(같은 달)가 없습니다 - 기존 전환율 데이터를 그대로 둡니다");
    return;
  }

  const payload = buildPayload({ deals, series, months, now });
  if (!payload) {
    console.log("  전환율을 낼 수 있는 단지가 없습니다 - 기존 전환율 데이터를 그대로 둡니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  console.log(
    `  전월세 전환율 ${payload.cells.length}칸 · 단지쌍 ${payload.seoul.pairs.toLocaleString("ko-KR")}개` +
      ` (${months[0]}~${months[months.length - 1]} 신규계약)`
  );
  console.log(
    `  서울 중앙 전환율 ${payload.seoul.rate}% · 전세자금대출(잔액) ${payload.loan.rate}% · 정기예금 ${payload.deposit.rate}% (${payload.loan.month})`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`전환율 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
