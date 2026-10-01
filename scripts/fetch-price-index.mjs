import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { APT_PRICE_INDEX, clampRows, ecosKey, searchAll } from "./ecos.mjs";
import { REGIONS, shiftMonth } from "./outlook.mjs";
import { yearMonthOf } from "./realestate-slots.mjs";

const root = path.resolve(import.meta.dirname, "..");

export const INDEX_FILE = process.env.PRICE_INDEX_FILE
  ? path.resolve(process.env.PRICE_INDEX_FILE)
  : path.join(root, "raw/ecos/apt-price-index.json");

/** 지수가 시작하는 달. 처음 받을 때는 여기서부터 다 받는다. */
export const FIRST_MONTH = "200601";

/**
 * 매일 다시 받는 꼬리. 반복거래 지수는 늦게 들어온 신고로 최근 몇 달이 고쳐진다.
 * 1년 넘게 지난 달이 고쳐지는 일은 드물고, 고쳐져도 화면의 3개월 예측에 닿는 것은
 * 최근 여섯 달이다. sample 키로도 두 번이면 받는다.
 */
export const REFRESH_MONTHS = 14;

/** 받은 꼬리를 저장된 계열 위에 덮는다. 고쳐진 달은 새 값이 이긴다. */
export function mergeSeries(stored = [], fresh = []) {
  const byMonth = new Map(stored);
  for (const [month, value] of fresh) byMonth.set(month, value);
  return [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1));
}

export const toPairs = (rows) =>
  rows
    .map((row) => [String(row.TIME), Number(row.DATA_VALUE)])
    .filter(([month, value]) => /^\d{6}$/.test(month) && Number.isFinite(value) && value > 0);

async function readStored() {
  try {
    return JSON.parse(await readFile(INDEX_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const now = new Date();
  const key = ecosKey();
  const to = yearMonthOf(now);
  const stored = await readStored();
  const series = {};

  for (const { code, name } of REGIONS) {
    const before = stored?.series?.[code] ?? [];
    const from = before.length ? shiftMonth(to, -REFRESH_MONTHS) : FIRST_MONTH;
    const rows = await searchAll({ key, ...APT_PRICE_INDEX, item: code, from, to, rows: clampRows(key, 1000) });
    const fresh = toPairs(rows);
    if (!fresh.length) throw new Error(`ecos 실거래가격지수 ${code} 응답 없음`);
    series[code] = mergeSeries(before, fresh);
    console.log(`  실거래가격지수 ${name.ko}: ${series[code].length}개월, 마지막 ${series[code].at(-1).join(" ")}`);
  }

  const payload = { source: "ECOS 901Y089", series };
  // 값이 안 변한 날 파일을 다시 쓰면 매일 날짜만 바뀐 diff가 남는다.
  if (JSON.stringify(stored?.series) === JSON.stringify(series)) {
    console.log("  실거래가격지수 변경 없음");
    return;
  }
  await mkdir(path.dirname(INDEX_FILE), { recursive: true });
  await writeFile(INDEX_FILE, `${JSON.stringify(payload)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    // 지수를 못 받은 날은 어제 파일로 예측을 다시 만든다. 수집 전체를 멈출 일은 아니다.
    console.error(`  실거래가격지수 수집 실패: ${error.message}`);
  });
}
