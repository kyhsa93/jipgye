import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { clampRows, ecosKey, searchAll } from "./ecos.ts";
import { shiftMonth } from "./outlook.ts";
import { yearMonthOf } from "./realestate-slots.ts";

/**
 * "가격보다 먼저 움직이는가"를 매일 다시 재는 데 쓰는 지표 계열.
 *
 * 후보는 2026-10-01 조사(research/buyer-search-timing-2026-10/)에서 미리 정한 것 그대로다.
 * 결과를 보고 후보를 고르지 않는다 - 고르기 시작하면 66번 중 하나는 우연히 통과한다.
 *
 * 처음 계열은 조사 때 받은 것을 저장소에 두었고(raw/indicators/series.json), 매일은 최근
 * REFRESH_MONTHS만 다시 받아 덮는다(늦게 고쳐지는 값 반영). 한 계열을 못 받아도 나머지와
 * 어제 값으로 간다 - 지표 하나 때문에 데일리 수집 전체가 멈추면 안 된다.
 *
 * KB 두 계열(KB_SERIES, ECOS 가 싣는 KB국민은행 지수)은 예외다(#588 3단계). 재배포 허락을 확인하지
 * 못해 원값을 저장소에 더 쌓지 않는다: 매일 전체 이력을 ECOS 에서 다시 받아 커밋하지 않는 cache/ 아래
 * 임시 파일(KB_HISTORY_FILE)에만 두고, 같은 잡의 build-indicators 가 그걸로 파생 판정표만 쓴다.
 * 전체 이력을 못 받으면 임시 파일을 남기지 않는다 - 그날 build-indicators 는 어제 파일을 그대로 둔다
 * (반쪽 이력으로 판정하면 롤링 오리진·12개월 차분이 비어 틀린 행이 나간다).
 * raw/indicators/series.json 에 이미 있는 kb_* 값은 손대지 않고 더 갱신하지도 않는다(정리는 별도 PR).
 */

const root = path.resolve(import.meta.dirname, "..");
export const INDICATOR_FILE = process.env.INDICATOR_FILE
  ? path.resolve(process.env.INDICATOR_FILE)
  : path.join(root, "raw/indicators/series.json");

export const REFRESH_MONTHS = 14;

/** KB 전체 이력의 임시 사본. cache/ 는 .gitignore 라 커밋되지 않는다(push-docs.sh 도 docs/data·raw 만 싣는다). */
export const KB_HISTORY_FILE = process.env.KB_HISTORY_FILE
  ? path.resolve(process.env.KB_HISTORY_FILE)
  : path.join(root, "cache/indicators/kb-history.json");

/** KB 주택가격지수(ECOS 4.4.1.1·4.4.1.2, 아파트 서울). 원값을 저장소에 두지 않는다 - 위 설명. */
export const KB_SERIES = {
  kb_sale: { stat: "901Y062", item: "P63ACA" },
  kb_jeonse: { stat: "901Y063", item: "P64ACA" },
};

/** KB 계열이 ECOS 에서 시작하는 달. 판정의 롤링 오리진이 여기부터 필요하다. */
export const KB_HISTORY_FROM = "198601";

/** ECOS 계열(KB 제외). item은 경로에 그대로 붙는 항목 코드들. */
export const ECOS_SERIES = {
  base_rate: { stat: "722Y001", item: "0101000" },
  mortgage_rate: { stat: "121Y006", item: "BECBLA0302" },
  ktb3: { stat: "721Y001", item: "5020000" },
  unsold_seoul: { stat: "901Y074", item: "I410B" },
  csi_house_seoul: { stat: "511Y002", item: "FMFB/F0001" },
  // 3차(#57)
  mort_bal: { stat: "151Y005", item: "11110A0" },
  mort_bal_seoul: { stat: "151Y003", item: "11110A0/A00" },
  permits_seoul: { stat: "901Y105", item: "SEO" },
  // #577: 전세 vs 월세 비교가 금감원 공시(rates.json) 대신 읽을 평균금리. 판정 후보가 아니다 -
  // indicator-backtest 의 후보 목록은 그대로다.
  // 전세자금대출은 신규취급액 표(121Y006)에 항목이 없고 잔액 기준 표(121Y015)에만 있다 - 기준이 다르다고 적어야 한다.
  jeonse_loan_rate: { stat: "121Y015", item: "BECBLB020210" },
  deposit_rate: { stat: "121Y002", item: "BEABAA211" },
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
    const json = await res.json() as { SttsApiTblData?: { row?: { DTA_VAL?: string; WRTTIME_IDTFR_ID?: string }[] }[] };
    const rows = json?.SttsApiTblData?.[1]?.row ?? [];
    for (const row of rows) {
      const value = Number(row.DTA_VAL);
      if (/^\d{6}$/.test(row.WRTTIME_IDTFR_ID) && Number.isFinite(value)) out.push([row.WRTTIME_IDTFR_ID, value]);
    }
  }
  return out;
}

export async function fetchEcos({ stat, item }, from, to, key, { fetchImpl = fetch } = {}) {
  const rows = await searchAll({ key, stat, cycle: "M", item, from, to, rows: clampRows(key, 1000) }, { fetchImpl });
  // 빈 값("")을 Number로 바꾸면 0이 된다 - 0을 값으로 받으면 그 달 금리가 0%가 된다.
  return rows
    .filter((row) => String(row.DATA_VALUE ?? "").trim() !== "")
    .map((row): [string, number] => [String(row.TIME), Number(row.DATA_VALUE)])
    .filter(([month, value]) => /^\d{6}$/.test(month) && Number.isFinite(value));
}

/** 받은 꼬리를 저장된 계열 위에 덮는다. 고쳐진 달은 새 값이 이긴다. */
export function merge(stored = [], fresh = []) {
  const byMonth = new Map(stored);
  for (const [month, value] of fresh) byMonth.set(month, value);
  return [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * KB 계열 하나의 전체 이력이 온전한지 본다. KB_HISTORY_FROM 부터 빠진 달 없이 이어져야 한다 -
 * 아니면 이유를, 맞으면 null 을 돌려준다. 반쪽 이력을 판정에 넣지 않으려는 문(門)이다.
 */
export function kbHistoryProblem(rows) {
  if (!Array.isArray(rows) || !rows.length) return "빈 이력";
  if (!rows.every((r) => Array.isArray(r) && /^\d{6}$/.test(r[0]) && Number.isFinite(r[1]))) return "모양이 다름";
  if (rows[0][0] !== KB_HISTORY_FROM) return `${KB_HISTORY_FROM}부터가 아님(${rows[0][0]})`;
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i][0] !== shiftMonth(rows[i - 1][0], 1)) return `${shiftMonth(rows[i - 1][0], 1)} 빠짐`;
  }
  return null;
}

/** KB 두 계열의 전체 이력을 받는다(계열마다 ECOS 1호출, 인증키 기준). 하나라도 온전하지 않으면 던진다. */
export async function fetchKbHistory(to, key, { fetchImpl = fetch } = {}) {
  const series = {};
  for (const [name, spec] of Object.entries(KB_SERIES)) {
    const rows = await fetchEcos(spec, KB_HISTORY_FROM, to, key, { fetchImpl });
    const problem = kbHistoryProblem(rows);
    if (problem) throw new Error(`${name} ${problem}`);
    series[name] = rows;
  }
  return series;
}

export async function collect({
  now = new Date(),
  key = ecosKey(),
  fetchImpl = fetch,
  indicatorFile = INDICATOR_FILE,
  kbFile = KB_HISTORY_FILE,
  log = console.log,
} = {}) {
  // 어제(로컬이면 지난 실행)의 임시 사본을 먼저 지운다. 오늘 못 받았는데 낡은 사본으로 판정하면 안 된다.
  await rm(kbFile, { force: true });
  let stored;
  try {
    stored = JSON.parse(await readFile(indicatorFile, "utf8"));
  } catch {
    stored = { series: {} };
  }
  const to = yearMonthOf(now);
  const from = shiftMonth(to, -REFRESH_MONTHS);
  // 저장분에 이미 있는 kb_* 는 그대로 옮기기만 한다(정리 PR 전까지). 새 값은 여기 들어오지 않는다.
  const series = { ...stored.series };
  const failed = [];

  const jobs = [
    ...Object.entries(ECOS_SERIES).map(([name, spec]) => [name, () => fetchEcos(spec, from, to, key, { fetchImpl })] as const),
    ...Object.entries(RONE_SERIES).map(([name, spec]) => [name, () => fetchRone(spec, from, to, { fetchImpl })] as const),
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
    await mkdir(path.dirname(indicatorFile), { recursive: true });
    await writeFile(indicatorFile, `${JSON.stringify({ source: "ECOS + R-ONE OpenAPI", series })}\n`);
  }
  log(
    `  지표 계열: ${jobs.length - failed.length}/${jobs.length} 갱신${changed ? "" : "(변경 없음)"}` +
      (failed.length ? ` · 못 받음(어제 값으로): ${failed.join(", ")}` : "")
  );

  let kbOk = false;
  try {
    const kb = await fetchKbHistory(to, key, { fetchImpl });
    await mkdir(path.dirname(kbFile), { recursive: true });
    await writeFile(kbFile, `${JSON.stringify({ source: "ECOS(KB국민은행) 전체 이력 - 커밋하지 않는 임시 사본(#588)", to, series: kb })}\n`);
    kbOk = true;
    log(`  KB 계열 전체 이력: ${Object.entries(kb).map(([k, v]) => `${k} ${v.length}개월`).join(", ")} (임시 사본, 커밋 안 함)`);
  } catch (error) {
    log(`::warning::KB 계열 전체 이력을 못 받았다(${error.message}) - 앞서지 않은 지표 판정은 어제 파일을 유지한다`);
  }
  return { failed, changed, kbOk };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  collect().catch((error) => console.error(`  지표 계열 수집 실패(어제 값으로 간다): ${error.message}`));
}
