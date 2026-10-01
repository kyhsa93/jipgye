import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { clampRows, ecosKey, searchAll } from "./ecos.mjs";
import { shiftMonth } from "./outlook.mjs";
import { yearMonthOf } from "./realestate-slots.mjs";

/**
 * "가격보다 먼저 움직이는가"를 매일 다시 재는 데 쓰는 지표 계열.
 *
 * 후보는 2026-10-01 조사(research/buyer-search-timing-2026-10/)에서 미리 정한 것 그대로다.
 * 결과를 보고 후보를 고르지 않는다 - 고르기 시작하면 66번 중 하나는 우연히 통과한다.
 *
 * 처음 계열은 조사 때 받은 것을 저장소에 두었고(raw/indicators/series.json), 매일은 최근
 * REFRESH_MONTHS만 다시 받아 덮는다(늦게 고쳐지는 값 반영). 한 계열을 못 받아도 나머지와
 * 어제 값으로 간다 - 지표 하나 때문에 데일리 수집 전체가 멈추면 안 된다.
 */

const root = path.resolve(import.meta.dirname, "..");
export const INDICATOR_FILE = process.env.INDICATOR_FILE
  ? path.resolve(process.env.INDICATOR_FILE)
  : path.join(root, "raw/indicators/series.json");

export const REFRESH_MONTHS = 14;

/** ECOS 계열. item은 경로에 그대로 붙는 항목 코드들. */
export const ECOS_SERIES = {
  kb_sale: { stat: "901Y062", item: "P63ACA" },
  kb_jeonse: { stat: "901Y063", item: "P64ACA" },
  base_rate: { stat: "722Y001", item: "0101000" },
  mortgage_rate: { stat: "121Y006", item: "BECBLA0302" },
  ktb3: { stat: "721Y001", item: "5020000" },
  unsold_seoul: { stat: "901Y074", item: "I410B" },
  csi_house_seoul: { stat: "511Y002", item: "FMFB/F0001" },
  // 3차(#57)
  mort_bal: { stat: "151Y005", item: "11110A0" },
  mort_bal_seoul: { stat: "151Y003", item: "11110A0/A00" },
  permits_seoul: { stat: "901Y105", item: "SEO" },
};

/**
 * 한국부동산원 부동산통계정보(R-ONE) OpenAPI. 키 없이 부르면 5줄만 주고 쪽 번호를 무시한다 -
 * 그래서 기간을 5개월씩 잘라 부른다.
 */
export const RONE_SERIES = {
  vol_seoul: { statbl: "A_2024_00554", cls: 500002, itm: 100001 },
  jratio_seoul: { statbl: "A_2024_00072", cls: 500008, itm: 100001 },
  supply_demand_seoul: { statbl: "A_2024_00076", cls: 500008, itm: 100001 },
  // 3차(#57): 서울 아파트 매매의 매입자 거주지 - 지역이 GRP(서울 900002), 분류가 CLS(합계 500001, 서울 밖 500005).
  buyer_total_seoul: { statbl: "A_2024_00609", grp: 900002, cls: 500001, itm: 100001 },
  buyer_outside_seoul: { statbl: "A_2024_00609", grp: 900002, cls: 500005, itm: 100001 },
};

export const RONE_BASE = "https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do";
const RONE_PAGE = 5;

export function roneUrl({ statbl, cls, itm, grp }, from, to) {
  const q = new URLSearchParams({
    // 지역이 GRP_ID에 있는 표(매입자거주지별 등)는 지역을 GRP로, 분류를 CLS로 건다.
    ...(grp ? { GRP_ID: String(grp) } : {}),
    Type: "json",
    pIndex: "1",
    pSize: String(RONE_PAGE),
    STATBL_ID: statbl,
    DTACYCLE_CD: "MM",
    CLS_ID: String(cls),
    ITM_ID: String(itm),
    START_WRTTIME: from,
    END_WRTTIME: to,
  });
  return `${RONE_BASE}?${q}`;
}

export async function fetchRone(spec, from, to, { fetchImpl = fetch } = {}) {
  const out = [];
  for (let month = from; month <= to; month = shiftMonth(month, RONE_PAGE)) {
    const end = shiftMonth(month, RONE_PAGE - 1) < to ? shiftMonth(month, RONE_PAGE - 1) : to;
    const res = await fetchImpl(roneUrl(spec, month, end));
    if (!res.ok) throw new Error(`r-one http ${res.status}`);
    const json = await res.json();
    const rows = json?.SttsApiTblData?.[1]?.row ?? [];
    for (const row of rows) {
      const value = Number(row.DTA_VAL);
      if (/^\d{6}$/.test(row.WRTTIME_IDTFR_ID) && Number.isFinite(value)) out.push([row.WRTTIME_IDTFR_ID, value]);
    }
  }
  return out;
}

export async function fetchEcos({ stat, item }, from, to, key) {
  const rows = await searchAll({ key, stat, cycle: "M", item, from, to, rows: clampRows(key, 1000) });
  // 빈 값("")을 Number로 바꾸면 0이 된다 - 0을 값으로 받으면 그 달 금리가 0%가 된다.
  return rows
    .filter((row) => String(row.DATA_VALUE ?? "").trim() !== "")
    .map((row) => [String(row.TIME), Number(row.DATA_VALUE)])
    .filter(([month, value]) => /^\d{6}$/.test(month) && Number.isFinite(value));
}

/** 받은 꼬리를 저장된 계열 위에 덮는다. 고쳐진 달은 새 값이 이긴다. */
export function merge(stored = [], fresh = []) {
  const byMonth = new Map(stored);
  for (const [month, value] of fresh) byMonth.set(month, value);
  return [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1));
}

async function main() {
  let stored;
  try {
    stored = JSON.parse(await readFile(INDICATOR_FILE, "utf8"));
  } catch {
    stored = { series: {} };
  }
  const now = new Date();
  const to = yearMonthOf(now);
  const from = shiftMonth(to, -REFRESH_MONTHS);
  const key = ecosKey();
  const series = { ...stored.series };
  const failed = [];

  const jobs = [
    ...Object.entries(ECOS_SERIES).map(([name, spec]) => [name, () => fetchEcos(spec, from, to, key)]),
    ...Object.entries(RONE_SERIES).map(([name, spec]) => [name, () => fetchRone(spec, from, to)]),
  ];
  // 하나씩 부른다 - 두 기관 모두 키 없는 호출이라 몰아서 부르면 막힐 수 있다.
  for (const [name, job] of jobs) {
    try {
      const fresh = await job();
      if (!fresh.length) throw new Error("빈 응답");
      series[name] = merge(stored.series?.[name], fresh);
    } catch (error) {
      failed.push(`${name}(${error.message})`);
    }
  }

  const changed = JSON.stringify(series) !== JSON.stringify(stored.series);
  if (changed) {
    await mkdir(path.dirname(INDICATOR_FILE), { recursive: true });
    await writeFile(INDICATOR_FILE, `${JSON.stringify({ source: "ECOS + R-ONE OpenAPI", series })}\n`);
  }
  console.log(
    `  지표 계열: ${jobs.length - failed.length}/${jobs.length} 갱신${changed ? "" : "(변경 없음)"}` +
      (failed.length ? ` · 못 받음(어제 값으로): ${failed.join(", ")}` : "")
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => console.error(`  지표 계열 수집 실패(어제 값으로 간다): ${error.message}`));
}
