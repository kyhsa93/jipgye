import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchRone, merge, REFRESH_MONTHS } from "./fetch-indicators.mjs";
import { shiftMonth } from "./outlook.mjs";
import { yearMonthOf } from "./realestate-slots.mjs";

/**
 * 한국부동산원 주택가격동향조사 - 월간 아파트 매매가격지수, 서울 자치구별(R-ONE A_2024_00045).
 *
 * 갈아타기 화면은 같은 단지·평형의 실거래 두 시기로 자치구의 1년 변화를 잰다. 이 계열은 그것을
 * 대조하는 다른 자다 - 실거래가 아니라 조사(표본 주택의 시세 조사)라 같을 이유는 없지만, 크게
 * 어긋나면 어느 쪽이든 의심해야 한다.
 *
 * 분류 코드는 키 없이 목록을 넘길 수 없어(5줄만 주고 쪽 번호를 무시한다) 하나씩 물어 찾았다
 * (2026-10-01). 키 없이 부르면 5줄씩이라 5개월씩 잘라 부른다(fetchRone).
 */

const root = path.resolve(import.meta.dirname, "..");
export const DISTRICT_INDEX_FILE = process.env.DISTRICT_INDEX_FILE
  ? path.resolve(process.env.DISTRICT_INDEX_FILE)
  : path.join(root, "raw/indicators/rone-districts.json");

export const STATBL = "A_2024_00045";
export const ITEM = 100001;

/** 자치구 → R-ONE 분류 코드. */
export const CLS = {
  11110: 530011, 11140: 530012, 11170: 530013,
  11200: 530015, 11215: 530016, 11230: 530017, 11260: 530018, 11290: 530019, 11305: 530020, 11320: 530021, 11350: 530022,
  11380: 530024, 11410: 530025, 11440: 530026,
  11470: 530029, 11500: 530030, 11530: 530031, 11545: 530032, 11560: 530033, 11590: 530034, 11620: 530035,
  11650: 530037, 11680: 530038, 11710: 530039, 11740: 530040,
};

/** 처음 받을 때의 시작. 1년 변화를 낼 만큼만 받는다. */
export const FIRST_MONTH = "202401";

async function main() {
  let stored;
  try {
    stored = JSON.parse(await readFile(DISTRICT_INDEX_FILE, "utf8"));
  } catch {
    stored = { series: {} };
  }
  const to = yearMonthOf(new Date());
  const series = { ...stored.series };
  const failed = [];
  for (const [code, cls] of Object.entries(CLS)) {
    const before = stored.series?.[code] ?? [];
    const from = before.length ? shiftMonth(to, -REFRESH_MONTHS) : FIRST_MONTH;
    try {
      const fresh = await fetchRone({ statbl: STATBL, cls, itm: ITEM }, from, to);
      if (!fresh.length) throw new Error("빈 응답");
      series[code] = merge(before, fresh);
    } catch (error) {
      failed.push(`${code}(${error.message})`);
    }
  }
  const changed = JSON.stringify(series) !== JSON.stringify(stored.series);
  if (changed) {
    await mkdir(path.dirname(DISTRICT_INDEX_FILE), { recursive: true });
    await writeFile(DISTRICT_INDEX_FILE, `${JSON.stringify({ source: `R-ONE ${STATBL}`, series })}\n`);
  }
  console.log(
    `  자치구 매매가격지수: ${Object.keys(CLS).length - failed.length}/${Object.keys(CLS).length} 갱신${changed ? "" : "(변경 없음)"}` +
      (failed.length ? ` · 못 받음(어제 값으로): ${failed.join(", ")}` : "")
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => console.error(`  자치구 매매가격지수 수집 실패(어제 값으로 간다): ${error.message}`));
}
