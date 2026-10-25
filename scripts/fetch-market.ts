import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BASE_RATE, KEYED_MAX_ROWS, KOSPI, USD_KRW, changedOn, clampRows, ecosKey, searchAll, statisticSearch } from "./ecos.ts";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "market.json");
const historyFile = path.join(dataDir, "market-history.json");
const HISTORY_MAX_DAYS = 180;

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

const kstYmd = (date) => kstDateString(date).replaceAll("-", "");

/** ECOS의 20260827을 화면이 쓰는 "2026년 08월 27일"로. */
export function ymdLabel(time) {
  const text = String(time ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}년 ${text.slice(4, 6)}월 ${text.slice(6, 8)}일`;
}

/**
 * ECOS는 3.00을 "3"으로 준다. 화면은 늘 소수 둘째 자리까지 적어 왔다.
 *
 * 숫자로 바꿔 보고 판단하면 안 된다 - Number("")는 0이라, 값이 비어 온 날
 * 기준금리가 0.00%로 둔갑한다. 생긴 것부터 본다.
 */
export function rateLabel(value) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text).toFixed(2);
}

/** ECOS의 20260828을 화면이 쓰는 "8/28"로. */
export function shortYmd(time) {
  const text = String(time ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${Number(text.slice(4, 6))}/${Number(text.slice(6, 8))}`;
}

/**
 * 마감된 종가 둘로 값과 등락을 낸다.
 *
 * 등락을 계열 안에서 직접 빼는 것이 요점이다. 전에는 값은 이쪽에서, 등락은 저쪽에서
 * 받아 와 둘이 서로를 설명하지 못했다 - 저장된 값끼리 빼면 45.87이 움직였는데 등락은
 * 0.00이라고 적혀 있는 날이 사흘 연속 나왔다(이슈 #1).
 *
 * 앞 종가가 없으면 등락을 지어내지 않고 비운다. 0.00은 "안 움직였다"는 뜻이라
 * "모른다"의 자리에 놓으면 안 된다 - 그게 바로 이 오류가 났던 방식이다.
 */
export function kospiFrom(rows) {
  if (!rows.length) throw new Error("ecos 코스피 응답 없음");

  const last = rows.at(-1);
  const value = Number(last.DATA_VALUE);
  if (!Number.isFinite(value)) throw new Error("ecos 코스피 값 형식 이상");

  const format = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const asOf = shortYmd(last.TIME);

  const prev = rows.at(-2);
  const prevValue = prev ? Number(prev.DATA_VALUE) : NaN;
  if (!Number.isFinite(prevValue)) {
    return { value: format(value), change: null, direction: null, asOf };
  }

  const diff = value - prevValue;
  return {
    value: format(value),
    change: format(diff),
    direction: diff > 0 ? "RISING" : diff < 0 ? "FALLING" : "UNCHANGED",
    asOf,
  };
}

/** 종가 둘을 잡으려면 주말과 연휴를 건너뛸 만큼은 봐야 한다. */
export const KOSPI_WINDOW_DAYS = { sample: 9, keyed: 30 };

async function fetchKospi(now = new Date()) {
  const key = ecosKey();
  const span = key === "sample" ? KOSPI_WINDOW_DAYS.sample : KOSPI_WINDOW_DAYS.keyed;
  const rows = await statisticSearch({
    key,
    ...KOSPI,
    from: kstYmd(new Date(now.getTime() - span * 86400000)),
    to: kstYmd(now),
    rows: clampRows(key, span + 1),
  });
  return kospiFrom(rows);
}

/**
 * 원/달러 환율은 ECOS 731Y001(원/미국달러 매매기준율, 일별)에서 받는다(#639, 소유자 결정 A).
 *
 * 전에는 open.er-api(옛 환율 API)의 하루 한 번 스냅숏이었다. 그쪽은 재배포를 금지하고 링크 표시를
 * 요구해서(#638 법무 판정) 공개 docs/data 에 쌓을 수 없다 - 되돌아갈 길(대체 경로)도 두지 않는다.
 *
 * ECOS 는 영업일만 주고 하루 늦다. 그래서 "오늘 값"은 받을 수 있는 가장 최근 영업일 값이고,
 * 그 날짜를 asOf 에 따로 적는다(코스피와 같은 "8/28" 모양). 주말·연휴 값은 지어내지 않는다.
 *
 * 최근 1년 계열을 market.json 의 usdKrwDaily([["YYYY-MM-DD", 원]], 오름차순)에 둔다. 처음 한 번은
 * 1년을 다 받고(백필), 그 뒤로는 최근 FX_OVERLAP_DAYS 만 다시 받아 덮는다(늦게 고쳐지는 값 반영).
 * 호출 수: 인증키면 하루 1회(1,000줄 한 쪽에 1년이 들어간다), sample 키면 백필 때 약 25회·평소 2회.
 */
export const FX_WINDOW_DAYS = 366;
export const FX_OVERLAP_DAYS = 14;
/** 창 시작이 긴 연휴에 걸리면 첫 영업일이 며칠 늦다. 그 정도 늦은 첫날은 "1년을 다 갖고 있다"로 본다. */
export const FX_BACKFILL_SLACK_DAYS = 10;

const isoOfYmd = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const daysBefore = (now, days) => kstDateString(new Date(now.getTime() - days * 86400000));

type FxPoint = [string, number];

/**
 * ECOS 줄을 [날짜, 값]으로. 빈 값("")은 버린다 - Number("")는 0이라 그날 환율이 0원이 된다.
 * 같은 날이 두 번 오면 뒤의 것을 쓴다.
 */
export function fxRowsFrom(rows): FxPoint[] {
  const byDate = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = String(row?.TIME ?? "");
    const text = String(row?.DATA_VALUE ?? "").trim();
    if (!/^\d{8}$/.test(time) || !/^\d+(\.\d+)?$/.test(text)) continue;
    const value = Number(text);
    if (value > 0) byDate.set(isoOfYmd(time), value);
  }
  return [...byDate].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 저장된 계열이 1년을 다 덮지 못하면 창 시작부터(백필), 아니면 겹침만큼만 거슬러 받는다. */
export function fxFetchFrom(stored: FxPoint[] = [], now = new Date()) {
  const windowStart = daysBefore(now, FX_WINDOW_DAYS);
  if (!stored.length || stored[0][0] > daysBefore(now, FX_WINDOW_DAYS - FX_BACKFILL_SLACK_DAYS)) return windowStart;
  const overlap = daysBefore(now, FX_OVERLAP_DAYS);
  const last = stored.at(-1)[0];
  // 여러 날 못 돌았으면 마지막 저장일부터 메운다.
  if (last >= overlap) return overlap;
  return last > windowStart ? last : windowStart;
}

/** 받은 꼬리를 저장된 계열 위에 덮는다(새 값이 이긴다). 1년 창 밖은 버린다. */
export function mergeFx(stored: FxPoint[] = [], fresh: FxPoint[] = [], windowStart = ""): FxPoint[] {
  const byDate = new Map(stored);
  for (const [date, value] of fresh) byDate.set(date, value);
  return [...byDate].filter(([date]) => date >= windowStart).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 계열의 한 점을 화면이 읽어 온 usdKrw 모양으로. 등락은 바로 앞 영업일 값과 뺀다 -
 * 코스피처럼 같은 계열 안에서 재야 값과 등락이 서로를 설명한다(이슈 #1). 앞 값이 없으면 비운다.
 */
export function usdKrwAt(series: FxPoint[] = [], at = series.length - 1) {
  const point = series[at];
  if (!point) return null;
  const [date, value] = point;
  const asOf = shortYmd(date.replaceAll("-", ""));
  const prev = series[at - 1];
  if (!prev) return { value, asOf, prevValue: null, change: null, direction: null };
  const diff = value - prev[1];
  return {
    value,
    asOf,
    prevValue: prev[1],
    change: diff.toFixed(2),
    direction: diff > 0 ? "RISING" : diff < 0 ? "FALLING" : "UNCHANGED",
  };
}

/**
 * 지난번 market.json 에서 ECOS 계열을 꺼낸다. 모양이 다른 점은 버린다.
 * usdKrwDaily 가 없는 옛 파일의 usdKrw 는 open.er-api 값이라 이어 쓰지 않는다.
 */
export function storedFxSeries(previous): FxPoint[] {
  const rows = previous?.usdKrwDaily;
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && Number.isFinite(r[1]) && r[1] > 0);
}

export async function fetchUsdKrwSeries(stored: FxPoint[] = [], now = new Date(), { key = ecosKey(), fetchImpl = fetch } = {}) {
  const from = fxFetchFrom(stored, now);
  const rows = await searchAll(
    { key, ...USD_KRW, from: from.replaceAll("-", ""), to: kstYmd(now), rows: clampRows(key, KEYED_MAX_ROWS) },
    { fetchImpl }
  );
  const fresh = fxRowsFrom(rows);
  if (!fresh.length) throw new Error("ecos 환율 응답 없음");
  const series = mergeFx(stored, fresh, daysBefore(now, FX_WINDOW_DAYS));
  console.log(`[fetch-market] 원달러환율(ECOS 731Y001): ${from}부터 ${fresh.length}일 받음, 계열 ${series.length}일(${series[0][0]}~${series.at(-1)[0]})`);
  return series;
}

/**
 * 기록(market-history)의 날마다 usdKrw 를 ECOS 계열의 그날 값으로 맞춘다. 계열에 없는 날
 * (주말·연휴·아직 안 나온 오늘)은 usdKrw 를 지운다 - 앞 영업일 값을 끌어다 채우면 지어낸 값이고,
 * 옛 open.er-api 스냅숏을 남기면 재배포 문제가 그대로 남는다(#638).
 */
export function syncHistoryFx(history = [], series: FxPoint[] = []) {
  const indexOf = new Map(series.map(([date], i) => [date, i]));
  return history.map((entry) => {
    const at = indexOf.get(entry?.date);
    const fx = at === undefined ? null : usdKrwAt(series, at);
    const out = {};
    for (const [k, v] of Object.entries(entry)) {
      if (k !== "usdKrw") out[k] = v;
      else if (fx) out[k] = fx;
    }
    if (fx && !("usdKrw" in entry)) out["usdKrw"] = fx;
    return out;
  });
}

/**
 * 기준금리를 포털 HTML에서 긁던 옛 경로. 이제는 ECOS가 시행일을 못 줄 때만 부른다 -
 * sample 키는 열흘치만 주므로, 금리가 그보다 오래전에 바뀌었고 이전 기록도 없는
 * 첫 실행에서 그렇다.
 */
async function fetchBaseRateFromBok() {
  const res = await fetch("https://www.bok.or.kr/portal/singl/baseRate/list.do?menuNo=200643", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`base rate http ${res.status}`);
  const html = await res.text();
  const match = html.match(
    /<td class="fb">(\d{4})<\/td>\s*<td>(\d{1,2}월\s*\d{1,2}일)<\/td>\s*<td>([\d.]+)<\/td>/
  );
  if (!match) throw new Error("기준금리 표 형식 이상");
  const [, year, dateLabel, rate] = match;
  return { value: rate, effectiveFrom: `${year}년 ${dateLabel}` };
}

/** sample 키로 한 번에 받을 수 있는 열 건에 맞춘 창. 키가 있으면 넓게 본다. */
export const BASE_RATE_WINDOW_DAYS = { sample: 9, keyed: 400 };

export async function baseRateFrom(rows, previous, { bok = fetchBaseRateFromBok } = {}) {
  if (!rows.length) throw new Error("ecos 기준금리 응답 없음");

  const value = rateLabel(rows.at(-1).DATA_VALUE);
  if (!value) throw new Error("ecos 기준금리 값 형식 이상");

  const changed = changedOn(rows);
  if (changed) return { value, effectiveFrom: ymdLabel(changed) };

  // 받아 온 창이 통째로 같은 값이면 시행일은 그 전이다. 값이 그대로면 지난번에
  // 적어 둔 시행일이 여전히 맞다.
  if (previous?.value === value && previous?.effectiveFrom) {
    return { value, effectiveFrom: previous.effectiveFrom };
  }

  const scraped = await bok().catch(() => null);
  return { value, effectiveFrom: scraped?.effectiveFrom ?? null };
}

async function fetchBaseRate(previous, now = new Date()) {
  const key = ecosKey();
  const span = key === "sample" ? BASE_RATE_WINDOW_DAYS.sample : BASE_RATE_WINDOW_DAYS.keyed;
  const rows = await statisticSearch({
    key,
    ...BASE_RATE,
    from: kstYmd(new Date(now.getTime() - span * 86400000)),
    to: kstYmd(now),
    rows: clampRows(key, span + 1),
  });
  return baseRateFrom(rows, previous);
}

async function fetchWithFallback(label, fn, previous) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[fetch-market] ${label} 실패: ${err.message}`);
    return previous ?? null;
  }
}

/** ECOS 를 못 받으면 지난번 계열(ECOS 것만)을 그대로 쓴다. 옛 open.er-api 값으로 돌아가지 않는다. */
export async function fxSeriesOrPrevious(previous, now = new Date(), options = {}) {
  const stored = storedFxSeries(previous);
  return fetchWithFallback("원달러환율(ECOS)", () => fetchUsdKrwSeries(stored, now, options), stored);
}

/** 받은 값으로 market.json 과 market-history.json 에 쓸 내용을 만든다(파일은 안 건드린다). */
export function marketFiles({ now = new Date(), kospi = null, fxSeries = [], baseRate = null, history = [] }) {
  const series = fxSeries ?? [];
  const usdKrw = usdKrwAt(series);
  const market = { updatedAt: now.toISOString(), kospi, usdKrw, baseRate, usdKrwDaily: series };

  const today = kstDateString(now);
  // usdKrw 자리는 syncHistoryFx 가 계열의 그날 값으로 채우거나 지운다(키 순서를 옛 기록과 맞추려는 자리표).
  const entry = { date: today, kospi, usdKrw: null, baseRate };
  let next = history.filter((h) => h?.date !== today).concat(entry);
  next.sort((a, b) => a.date.localeCompare(b.date));
  if (next.length > HISTORY_MAX_DAYS) next = next.slice(next.length - HISTORY_MAX_DAYS);
  return { market, history: syncHistoryFx(next, series) };
}

/** market.json 글. 1년 계열은 한 점을 한 줄로 쓴다(점마다 네 줄로 펴면 첫 화면이 받는 파일이 두 배가 된다). */
export function marketJsonText(market) {
  const { usdKrwDaily = [], ...rest } = market;
  const text = JSON.stringify({ ...rest, usdKrwDaily: "__SERIES__" }, null, 2);
  const series = usdKrwDaily.length ? `[\n${usdKrwDaily.map((p) => `    ${JSON.stringify(p)}`).join(",\n")}\n  ]` : "[]";
  return text.replace('"__SERIES__"', () => series);
}

async function main() {
  let previous: { kospi?: unknown; usdKrw?: unknown; baseRate?: unknown; usdKrwDaily?: unknown } = {};
  try {
    previous = JSON.parse(await readFile(outFile, "utf-8"));
  } catch {
  }

  const now = new Date();
  const [kospi, fxSeries, baseRate] = await Promise.all([
    fetchWithFallback("코스피", fetchKospi, previous.kospi),
    fxSeriesOrPrevious(previous, now),
    fetchWithFallback("기준금리", () => fetchBaseRate(previous.baseRate), previous.baseRate),
  ]);

  const files = marketFiles({ now, kospi, fxSeries, baseRate, history: await readHistory() });
  await mkdir(dataDir, { recursive: true });
  await writeFile(outFile, marketJsonText(files.market));
  await writeFile(historyFile, JSON.stringify(files.history, null, 2));

  console.log("[fetch-market] 저장 완료");
}

async function readHistory() {
  try {
    const parsed = JSON.parse(await readFile(historyFile, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
