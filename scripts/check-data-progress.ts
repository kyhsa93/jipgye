/**
 * 「run 은 초록, 진척은 0」 감시 - 데이터 쪽 (#657 V11).
 *
 * 워치독의 앞 세 검사(scripts/check-schedule-runs.ts)는 **실행**을 본다(떴는가·성공했는가·배포됐는가). 그런데 수집기는 대부분
 * 바깥 소스를 못 받으면 「어제 값으로 간다」(fetch-market·fetch-indicators·fetch-district-index·fetch-price-index·fetch-move-in 의 catch,
 * fetch-realestate 의 슬롯별 catch, 키가 없으면 생략). 그래서 run 은 초록인데 데이터는 멈춘 모양이 실행 검사에 안 보인다 -
 * 공시가격이 2026-10-23~25 에 그랬다(#68 V1, 그 수집기는 #660 이 따로 막았다). 이 스크립트는 **체크아웃한 main 의 데이터 자체**를 읽어
 * 소스마다 「마지막으로 앞으로 나간 때」를 그 소스의 주기에 견준다. 수집기·워크플로의 수집 경로는 바꾸지 않는다.
 *
 * 판정은 셋이다. ok(조용) · warn(`::warning::` 한 줄, run 은 초록) · fail(`::error::`, 종료 코드 1 = 워치독 run 이 빨개지고 실패 알림).
 * 문턱은 audit/갱신-사고-대응.md 의 경과 단계(마지막 성공 뒤 30h 미만 지연·30~54h 확인·54h 초과 알림)를 소스의 주기에 옮긴 것이다:
 *   - 하루 주기·시각 있는 소스(뉴스): 데이터 나이 = 실행 나이 + 수집 순간의 데이터 나이. 뒤의 것은 실측 최대 6.2h
 *     (news.json 커밋 150건, 2026-10-18~26: 커밋 시각 - 가장 새 기사 시각, 중앙 0.8h)라 NEWS_OFFSET_HOURS=6 을 더해 36h 경고·60h 실패.
 *   - 영업일 소스(코스피·환율 = ECOS 영업일 값, 실거래 원본 도착): 날짜만 있고 주말·연휴에는 값이 없다. 마지막 날짜와 오늘(KST) **사이의 평일 수**로 잰다.
 *     정상 최대 1(오늘 run 전), 단발 실패 2 - 여기까지 조용. 3 이상 경고(연속 실패, 또는 연휴 + 실패). 실패는 7 이상이다: 연휴 달력이 코드에 없고
 *     가장 긴 휴장(2025-10-03~09, 평일 5일)에 단발 실패가 겹치면 6이라(cto, #667), 그보다 짧게 잡으면 명절마다 거짓 경보가 난다(일일 소음 0 조건). 그동안의 전면 정지는 #499(54h) 가 잡는다.
 *   - 월 주기 계열(ECOS·R-ONE, 수집기 코드의 cycle "M"·DTACYCLE_CD "MM"): 마지막 달과 이번 달(KST)의 차이(달 수)를 계열의 정상 최대 지연 L 에 견준다.
 *     L 이하 조용, L+1 경고(한 번 늦음 = 확인), L+2 이상 실패(두 번 연속 = 알림). L 은 git 이력(2026-10-01~26, 10커밋)에서 달 초에 본 최대 지연이다 - 아래 표.
 *   - 그 밖(반기 파일·사람이 dispatch 하는 월간 작업): 각 줄의 주석.
 * 실패를 다시 울리지 않는 것: 공시가격 진척(official-price-api.yml 이 마지막 진척 3일 뒤 스스로 실패한다, #660) - 여기서는 경고만 한다.
 *
 * 빌더 산출물 나이 (F2, #657 D5): docs/data/*.json 의 최상위 `updatedAt` 을 일반 규칙으로 본다. 30h 초과 경고(로그만, 이슈 없음), 54h 초과 실패, 없거나 읽을 수 없으면 실패(제외 목록 밖).
 *   묶음(`rents-*` 등, 이름 규칙은 source-age 의 groupNames)은 가장 오래된 값으로 본다. 재생: 실제 워치독 틱 20개에서 54h 초과 0, 30h 초과 1(10-25 rates.json 32.5h, 그 파일은 #577 로 없어졌다).
 *   `monthly-cost`·`repeat-sales` 는 #657 에서 처음 `updatedAt` 을 받아 재생 밖이다 - 이 둘의 54h 에는 재생 근거가 없다(둘 다 Daily 수집 단계가 매 실행 부른다는 코드 사실뿐이다).
 *   잡는 것은 빌더가 안 돌거나 소프트 실패해 어제 파일을 둔 경우뿐이다. `updatedAt` 은 계산한 날이라 입력이 멈춘 채 다시 계산하면 못 잡는다. 재현율 근거는 없다(재생 기간에 빌더 동결 사고가 없어 합성 시험만 가능하다).
 *   수집이 전면 정지하면 소스 수십 개가 함께 늙으므로 `::error::`·`::warning::` 는 소스 수와 상위 5개만 1줄로 낸다.
 *
 * 경고의 출구 (#657 D1·D3·D4): 러너에서 돌면 끝에 ok 가 아닌 소스를 JSON 한 줄로 `GITHUB_OUTPUT`(report=)에 쓴다. 같은 워크플로의 `report` job 이 그것으로 이슈를 연다(scripts/report-data-progress.ts).
 *   이슈를 여느냐는 아래 코드 목록(ISSUE_GROUPS·NO_ISSUE_GROUPS)으로 정한다. 어느 쪽에도 없는 소스는 시험이 실패하고, 실행 중에는 report job 이 실패한다.
 *
 * `npm test` 에 넣지 않는다(#8: 날짜에 따라 갈리는 검사는 그날 배포를 멈춘다). 시험은 고정 입력·고정 시각으로만 돈다.
 *
 * 사용:
 *   node scripts/check-data-progress.ts                                  지금, 저장소 루트의 데이터
 *   node scripts/check-data-progress.ts --now=2026-10-26T05:29:00Z --root=<폴더>   (시험·재현용)
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MONTHLY_STALE_DAYS, groupNames } from "./source-age.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { RETENTION_MONTHS, shiftMonth } from "./realestate-slots.ts";

const KST_MS = 9 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** audit/갱신-사고-대응.md 의 경과 단계(마지막 성공 뒤): 30h 부터 확인, 54h 초과 알림. */
export const CHECK_HOURS = 30;
export const ALERT_HOURS = 54;
/** 뉴스: 수집 순간 가장 새 기사의 나이(실측 최대 6.2h). */
export const NEWS_OFFSET_HOURS = 6;
/** 영업일 소스: 마지막 값 날짜와 오늘 사이 평일 수. 3 이상 경고, 7 이상 실패(가장 긴 휴장 평일 5일 + 단발 실패 = 6, #667). */
export const BUSINESS_WARN_DAYS = 3;
export const BUSINESS_FAIL_DAYS = 7;

/**
 * 월 계열의 정상 최대 지연(달). 키는 scripts/fetch-indicators.ts 의 ECOS_SERIES·RONE_SERIES 와 같아야 한다(시험이 묶는다).
 * 2 = 달 초에 전전달 값까지 있는 계열(기준금리·국고채·소비자심리·전세가율·수급지수, 자치구 매매지수).
 * 3 = 달 초에 석 달 전 값까지인 계열(대출금리·미분양·거래량·매입자·대출잔액·인허가·예금/전세대출 금리, 실거래가격지수).
 */
export const MONTHLY_LAG: Record<string, number> = {
  base_rate: 2, ktb3: 2, csi_house_seoul: 2, jratio_seoul: 2, supply_demand_seoul: 2,
  mortgage_rate: 3, unsold_seoul: 3, mort_bal: 3, mort_bal_seoul: 3, permits_seoul: 3, jeonse_loan_rate: 3, deposit_rate: 3,
  vol_seoul: 3, buyer_total_seoul: 3, buyer_outside_seoul: 3,
};
/** R-ONE 자치구 매매지수(fetch-district-index, 월간)·ECOS 실거래가격지수(fetch-price-index, 월간·method 「두 달 늦게」 + 달 초 1). */
export const DISTRICT_INDEX_LAG = 2;
export const PRICE_INDEX_LAG = 3;
/** 입주예정물량: 반기 파일(다음 예정 2027-02-26, 기준 시점은 그 전 반기 말). 기준 시점 나이 270일 경고, 365일 실패. */
export const MOVE_IN_WARN_DAYS = 270;
export const MOVE_IN_FAIL_DAYS = 365;
/** 월간 원장(ledger-snapshot.yml, 사람이 dispatch). 첫 달과 기한(그달 며칠, KST). */
export const LEDGER_FIRST_MONTH = "2026-11";
export const LEDGER_DUE_DAY = 3;
/** 공시가격 진척 0 이 이만큼(일) 이어지면 경고한다. 실패는 그 워크플로가 3일에 스스로 낸다(#660). */
export const OFFICIAL_PRICE_WARN_DAYS = 2;

/**
 * 묶음 = 소스 이름의 첫 조각(`series/base_rate` -> `series`). **이슈를 여는 묶음의 코드 목록이고, 순서가 곧 틱당 상한에서 먼저 열리는 순서다**(#657 D4). 값을 바꾸는 것은 판정자 몫이다(사전 위임표).
 * 어느 시점에 경고가 나는지는 그 소스의 판정을 따른다: `official-price` 는 마지막 진척 2일, 슬롯 누락·빈 달·progress.json 없음은 즉시다. 상태 파일이 없어 연속을 세지 않는다.
 */
export const ISSUE_GROUPS = ["official-price", "raw", "series", "market", "rone-districts", "apt-price-index", "move-in", "housing-permits"];
/** 이슈를 열지 않는 묶음: news(60h 에 실패 메일), ledger(54h 에 실패 메일), docs(F2. 54h 에 실패 메일 - 10-25 `rates.json` 32.5h 같은 단발이 이슈로 남지 않게 한다). */
export const NO_ISSUE_GROUPS = ["news", "ledger", "docs"];
export const groupOf = (source: string) => source.split("/")[0];

/** F2 소스 이름 앞붙이. 묶음은 `docs`, 이슈 없음. */
const BUILDER_AGE_PREFIX = "docs/data/";
/** `updatedAt` 이 없어도 되는 파일(최상위가 배열인 이력과 원장 로그, #657 D6). 이 파일들은 나이를 재지 않는다. */
export const UPDATED_AT_EXCLUDED = ["market-history", "news-history", "realestate-history", "summary-history", "outlook-log"];
/**
 * F2 대상의 코드 목록(groupNames 이름). 판정에는 안 쓴다(목록 밖 파일도 `updatedAt` 을 본다, 일반 규칙).
 * 쓰임은 시험 하나다: docs/data 에 어느 쪽에도 없는 파일이 생기면 시험이 실패해 `updatedAt` 을 낼지 제외할지 그 PR 이 정하게 한다. 이름만 보고 값·날짜는 안 본다(#8).
 */
export const BUILDER_OUTPUTS = [
  "budget-deals", "budget-months", "cancellation", "complex-history", "complex-price", "complex-ratio", "conversion", "deal-search", "deals", "direct-deals",
  "district-change", "floor-gap", "jeonse-risk", "lease-expiry", "market", "monthly-cost", "move-in", "news", "outlook", "outlook-indicators",
  "realestate", "realestate-trend", "reco", "record-high", "registration", "renewal-cells", "renewal-facts", "rent-flow", "rent-preview", "rents", "repeat-sales",
  "search-index", "segment-change", "summary", "summary-source", "week-digest",
];
/** F2 코드 목록 어느 쪽에도 없는 파일 이름(시험용). */
export function unregisteredDataFiles(files: string[]) {
  const known = new Set([...BUILDER_OUTPUTS, ...UPDATED_AT_EXCLUDED]);
  return [...new Set(groupNames(files).filter((name) => !known.has(name)))];
}

type Level = "ok" | "warn" | "fail";
export type Check = { source: string; cadence: string; level: Level; last: string | null; detail: string; hours?: number | null };

const kstYmd = (ms: number) => new Date(ms + KST_MS).toISOString().slice(0, 10);
const ymNum = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;
const dayNum = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY_MS);

function readJson(file: string) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** 마지막 값 날짜(YYYY-MM-DD)와 오늘(YYYY-MM-DD) **사이**의 평일 수(양 끝 제외). */
export function weekdaysBetween(last: string, today: string) {
  let n = 0;
  for (let d = dayNum(last) + 1; d < dayNum(today); d += 1) {
    const w = new Date(d * DAY_MS).getUTCDay();
    if (w !== 0 && w !== 6) n += 1;
  }
  return n;
}

/** "10/23"(해 없음)·"2026-10-23"·RFC 시각 -> YYYY-MM-DD(KST). 해가 없으면 오늘보다 늦지 않은 가장 가까운 해. */
export function dateOf(value: unknown, today: string): string | null {
  const s = String(value ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) {
    const year = Number(today.slice(0, 4));
    const pad = (y: number) => `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return pad(year) > today ? pad(year - 1) : pad(year);
  }
  const t = Date.parse(s);
  return s && Number.isFinite(t) ? kstYmd(t) : null;
}

function businessCheck(source: string, last: string | null, today: string, what: string): Check {
  const cadence = "영업일";
  if (!last) return { source, cadence, level: "fail", last: null, detail: `${what}을 못 읽었다(파일 없음·모양 다름)` };
  const gap = weekdaysBetween(last, today);
  const level: Level = gap >= BUSINESS_FAIL_DAYS ? "fail" : gap >= BUSINESS_WARN_DAYS ? "warn" : "ok";
  return { source, cadence, level, last, detail: `마지막 ${what} ${last}, 오늘까지 사이 평일 ${gap}일(경고 ${BUSINESS_WARN_DAYS}·실패 ${BUSINESS_FAIL_DAYS})` };
}

function hoursCheck(source: string, lastMs: number | null, nowMs: number, offset: number, what: string): Check {
  const cadence = "하루";
  if (lastMs === null) return { source, cadence, level: "fail", last: null, detail: `${what}을 못 읽었다(파일 없음·모양 다름)` };
  const hours = (nowMs - lastMs) / HOUR_MS;
  const level: Level = hours > ALERT_HOURS + offset ? "fail" : hours > CHECK_HOURS + offset ? "warn" : "ok";
  return { source, cadence, level, last: new Date(lastMs).toISOString(), detail: `마지막 ${what} ${hours.toFixed(1)}시간 전(경고 ${CHECK_HOURS + offset}h·실패 ${ALERT_HOURS + offset}h)` };
}

/** 월 계열: 마지막 달 지연(달)과 빈 달. series = [[YYYYMM, 값], ...]. */
export function monthlyCheck(source: string, series: unknown, lag: number, month: string): Check {
  const cadence = `월(정상 지연 ≤${lag}달)`;
  const months = Array.isArray(series) ? series.map((r) => String(r?.[0] ?? "")).filter((x) => /^\d{6}$/.test(x)) : [];
  if (!months.length) return { source, cadence, level: "fail", last: null, detail: "계열을 못 읽었다(파일 없음·계열 없음)" };
  const last = months.at(-1);
  const behind = ymNum(month) - ymNum(last);
  const holes = months.length - 1 - (ymNum(last) - ymNum(months[0]));
  let level: Level = behind >= lag + 2 ? "fail" : behind >= lag + 1 ? "warn" : "ok";
  if (holes < 0 && level === "ok") level = "warn";
  return { source, cadence, level, last, detail: `마지막 달 ${last}, 이번 달보다 ${behind}달 늦음${holes < 0 ? `, 사이에 빈 달 ${-holes}개` : ""}` };
}

/** 여러 계열을 한 소스로(자치구 25개 등): 가장 나쁜 판정, 같으면 가장 늦은 계열. */
function worst(source: string, checks: Check[]): Check {
  if (!checks.length) return { source, cadence: "월", level: "fail", last: null, detail: "계열을 못 읽었다(파일 없음·계열 없음)" };
  const rank = { ok: 0, warn: 1, fail: 2 };
  const pick = checks.reduce((a, b) => (rank[b.level] > rank[a.level] || (rank[b.level] === rank[a.level] && (b.last ?? "") < (a.last ?? "")) ? b : a));
  return { ...pick, source, detail: `${checks.length}계열 중 가장 늦은 것: ${pick.detail}` };
}

/** 실거래 원본: 가장 새 달 슬롯들의 observedAt 최신(= 새 거래가 마지막으로 도착한 실행) + 보관 창 24달 × 25구 슬롯 수. */
export function rawChecks(rawDir: string, today: string): Check[] {
  const out: Check[] = [];
  for (const kind of ["sale", "rent"]) {
    const dir = path.join(rawDir, kind);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{5}-\d{6}\.json$/.test(f)) : [];
    if (!files.length) {
      out.push({ source: `raw/${kind}`, cadence: "영업일", level: "fail", last: null, detail: "원본 슬롯이 없다" });
      continue;
    }
    const newest = files.map((f) => f.slice(6, 12)).sort().at(-1);
    let best: number | null = null;
    for (const f of files.filter((x) => x.endsWith(`${newest}.json`))) {
      const t = Date.parse(readJson(path.join(dir, f))?.observedAt);
      if (Number.isFinite(t) && (best === null || t > best)) best = t;
    }
    const arrival = businessCheck(`raw/${kind}`, best === null ? null : kstYmd(best), today, "새 거래 도착");
    // 슬롯 수 감소: 가장 새 달부터 보관 창(RETENTION_MONTHS)만큼, 달마다 25구가 다 있어야 한다. 빠지면 경고(실패 아님 - 백필이 메운다).
    const have = new Set(files.map((f) => f.slice(0, 12)));
    let missing = 0;
    for (let i = 0; i < RETENTION_MONTHS; i += 1) {
      const ym = shiftMonth(newest, -i);
      for (const { code } of DISTRICTS) if (!have.has(`${code}-${ym}`)) missing += 1;
    }
    const expected = RETENTION_MONTHS * DISTRICTS.length;
    if (missing && arrival.level === "ok") arrival.level = "warn";
    arrival.detail += `, 슬롯 ${expected - missing}/${expected}${missing ? `(빠진 슬롯 ${missing})` : ""}`;
    out.push(arrival);
  }
  return out;
}

/** 시간대가 적힌 ISO 시각만 받는다. 시간대 없는 값은 러너 시간대에 따라 값이 달라진다. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** F2: docs/data/*.json 의 최상위 updatedAt 나이. 묶음은 가장 오래된 값, 하나라도 못 읽으면 그 묶음이 실패다. */
export function builderAgeChecks(dataDir: string, nowMs: number): Check[] {
  const files = existsSync(dataDir) ? readdirSync(dataDir).filter((f) => f.endsWith(".json")).sort() : [];
  const names = groupNames(files);
  const sources = new Map<string, { source: string; members: number; unreadable: string[]; oldest: number | null; oldestFile: string | null }>();
  files.forEach((f, i) => {
    if (UPDATED_AT_EXCLUDED.includes(names[i])) return;
    const isBundle = names[i] !== f.replace(/\.json$/, "");
    const cur = sources.get(names[i]) ?? { source: `${BUILDER_AGE_PREFIX}${names[i]}${isBundle ? "-*" : ""}`, members: 0, unreadable: [], oldest: null, oldestFile: null };
    sources.set(names[i], cur);
    cur.members += 1;
    const value = readJson(path.join(dataDir, f))?.updatedAt;
    const t = typeof value === "string" && ISO_WITH_ZONE.test(value) ? Date.parse(value) : NaN;
    if (!Number.isFinite(t)) cur.unreadable.push(f);
    else if (cur.oldest === null || t < cur.oldest) {
      cur.oldest = t;
      cur.oldestFile = f;
    }
  });
  const cadence = "빌더 산출물";
  return [...sources.values()].map((s) => {
    const bundle = s.members > 1 ? `(묶음 ${s.members}개 중 ${s.oldestFile ?? "?"})` : "";
    if (s.unreadable.length) {
      return { source: s.source, cadence, level: "fail" as Level, last: null, hours: null, detail: `updatedAt 이 없거나 읽을 수 없다: ${s.unreadable[0]}${s.unreadable.length > 1 ? ` 외 ${s.unreadable.length - 1}개` : ""}` };
    }
    const hours = (nowMs - s.oldest) / HOUR_MS;
    const level: Level = hours > ALERT_HOURS ? "fail" : hours > CHECK_HOURS ? "warn" : "ok";
    return { source: s.source, cadence, level, last: new Date(s.oldest).toISOString(), hours, detail: `마지막 빌드 ${hours.toFixed(1)}시간 전${bundle}(경고 ${CHECK_HOURS}h·실패 ${ALERT_HOURS}h)` };
  });
}

export function collectChecks({ root, now }: { root: string; now: Date }): Check[] {
  const nowMs = now.getTime();
  const today = kstYmd(nowMs);
  const month = today.slice(0, 7).replace("-", "");
  const checks: Check[] = [];
  const j = (rel: string) => readJson(path.join(root, rel));

  // 뉴스(fetch-news, 매 실행): 가장 새 기사 시각.
  const news = j("docs/data/news.json");
  const newest = (news?.items ?? []).map((i) => Date.parse(i?.publishedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  checks.push(hoursCheck("news", newest ?? null, nowMs, NEWS_OFFSET_HOURS, "기사"));

  // 시장 지표(fetch-market, ECOS 영업일 값): 코스피 asOf, 환율은 usdKrwDaily 마지막 날(없으면 asOf).
  const market = j("docs/data/market.json");
  checks.push(businessCheck("market/kospi", dateOf(market?.kospi?.asOf, today), today, "코스피 값 날짜"));
  const fxDaily = Array.isArray(market?.usdKrwDaily) ? market.usdKrwDaily.at(-1)?.[0] : null;
  checks.push(businessCheck("market/usdKrw", dateOf(fxDaily ?? market?.usdKrw?.asOf, today), today, "환율 값 날짜"));

  // 실거래 원본(fetch-realestate).
  checks.push(...rawChecks(path.join(root, "raw"), today));

  // 월 계열(fetch-indicators). kb_* 는 #588 로 더 쌓지 않는 계열이라 보지 않는다.
  const series = j("raw/indicators/series.json")?.series ?? {};
  for (const [name, lag] of Object.entries(MONTHLY_LAG)) checks.push(monthlyCheck(`series/${name}`, series[name], lag, month));
  const district = j("raw/indicators/rone-districts.json")?.series ?? {};
  checks.push(worst("rone-districts", Object.values(district).map((s) => monthlyCheck("", s, DISTRICT_INDEX_LAG, month))));
  const priceIndex = j("raw/ecos/apt-price-index.json")?.series ?? {};
  checks.push(worst("apt-price-index", Object.values(priceIndex).map((s) => monthlyCheck("", s, PRICE_INDEX_LAG, month))));

  // 입주예정물량(fetch-move-in, 반기 파일): 기준 시점 나이.
  const basis = j("raw/move-in/meta.json")?.basis;
  if (typeof basis === "string" && /^\d{4}-\d{2}-\d{2}$/.test(basis)) {
    const days = dayNum(today) - dayNum(basis);
    const level: Level = days > MOVE_IN_FAIL_DAYS ? "fail" : days > MOVE_IN_WARN_DAYS ? "warn" : "ok";
    checks.push({ source: "move-in", cadence: "반기", level, last: basis, detail: `기준 시점 ${basis}, ${days}일 전(경고 ${MOVE_IN_WARN_DAYS}·실패 ${MOVE_IN_FAIL_DAYS})` });
  } else checks.push({ source: "move-in", cadence: "반기", level: "fail", last: null, detail: "meta.json 기준 시점을 못 읽었다" });

  // 주택 인허가(housing-permits.yml, 사람이 dispatch, 월 1회): 경고만. 문턱은 source-age 의 MONTHLY_STALE_DAYS.
  const permitsAt = Date.parse(j("research/housing-permits/folded.json")?.meta?.updatedAt);
  if (Number.isFinite(permitsAt)) {
    const days = dayNum(today) - dayNum(kstYmd(permitsAt));
    checks.push({ source: "housing-permits", cadence: "월(수동)", level: days >= MONTHLY_STALE_DAYS ? "warn" : "ok", last: kstYmd(permitsAt), detail: `마지막 접기 ${days}일 전(경고 ${MONTHLY_STALE_DAYS}, 실패 없음 - 수동 작업)` });
  }

  // 공시가격(official-price-api.yml): 진척 상태 파일(#660). 실패는 그 워크플로가 낸다 - 여기서는 경고만.
  const p = j("raw/official-price/status/progress.json");
  if (p && typeof p === "object") {
    const done = Number(p.doneParcels), target = Number(p.targetParcels);
    const complete = Number.isFinite(done) && Number.isFinite(target) && target > 0 && done >= target;
    const at = Date.parse(p.lastProgressAt);
    const days = Number.isFinite(at) ? Math.floor((nowMs - at) / DAY_MS) : null;
    const stalled = !complete && (days === null ? Number(p.zeroProgressRuns) >= OFFICIAL_PRICE_WARN_DAYS : days >= OFFICIAL_PRICE_WARN_DAYS);
    checks.push({
      source: "official-price", cadence: "하루(진척)", level: stalled ? "warn" : "ok", last: p.lastProgressAt ?? null,
      detail: `끝난 지번 ${done}/${target}, 마지막 진척 ${days === null ? "모름" : `${days}일 전`}, 진척 0 실행 ${p.zeroProgressRuns ?? "?"}회(경고 ${OFFICIAL_PRICE_WARN_DAYS}일, 실패는 official-price-api.yml 이 3일에 낸다)`,
    });
  } else checks.push({ source: "official-price", cadence: "하루(진척)", level: "warn", last: null, detail: "progress.json 이 없다(#660 상태 파일)" });

  // 월간 원장(ledger-snapshot.yml, 사람이 dispatch): 첫 달부터, 그달 LEDGER_DUE_DAY 일(KST) 0시가 기한. 기한 뒤 54h 까지 경고, 그 뒤 실패.
  const ym = today.slice(0, 7);
  if (ym >= LEDGER_FIRST_MONTH) {
    const file = path.join(root, "ledger", `${ym}.jsonl.gz`);
    const dueMs = Date.parse(`${ym}-${String(LEDGER_DUE_DAY).padStart(2, "0")}T00:00:00Z`) - KST_MS;
    const late = (nowMs - dueMs) / HOUR_MS;
    const level: Level = existsSync(file) || late < 0 ? "ok" : late > ALERT_HOURS ? "fail" : "warn";
    checks.push({ source: "ledger", cadence: "월(수동)", level, last: existsSync(file) ? ym : null, detail: existsSync(file) ? `ledger/${ym}.jsonl.gz 있음` : late < 0 ? `기한(${ym}-0${LEDGER_DUE_DAY}) 전` : `ledger/${ym}.jsonl.gz 없음, 기한 뒤 ${late.toFixed(0)}h(실패 ${ALERT_HOURS}h)` });
  }

  // 빌더 산출물 나이(F2, #657 D5).
  checks.push(...builderAgeChecks(path.join(root, "docs/data"), nowMs));
  return checks;
}

/** F2 소스들을 한 줄로: 소스 수와 가장 오래된 상위 5개(못 읽은 것이 맨 앞). 수집 전면 정지 때 소스마다 한 줄씩 나오면 안 된다. */
export function builderAgeLine(checks: Check[], limit = 5) {
  const age = (c: Check) => c.hours ?? Infinity;
  const top = [...checks].sort((a, b) => age(b) - age(a) || a.source.localeCompare(b.source)).slice(0, limit);
  const names = top.map((c) => `${c.source.slice(BUILDER_AGE_PREFIX.length)}(${c.hours == null ? "updatedAt 못 읽음" : `${c.hours.toFixed(1)}h`})`).join(", ");
  return `소스 ${checks.length}개 - ${names}${checks.length > limit ? ` 외 ${checks.length - limit}개` : ""}`;
}

/** report job 에 넘기는 한 줄(ok 가 아닌 소스만). 모양은 scripts/report-data-progress.ts 의 parseReport 가 본다. 값은 우리 산출물뿐이고 비밀값이 없다. */
export function reportPayload(checks: Check[], now: Date) {
  const rows = checks.filter((c) => c.level !== "ok").map(({ source, cadence, level, last, detail }) => ({ source, cadence, level, last, detail }));
  return JSON.stringify({ version: 1, now: now.toISOString(), checks: rows });
}

export function main(argv: string[], { log = console.log, writeReport = () => {} }: { log?: (m: string) => void; writeReport?: (json: string) => void } = {}) {
  const arg = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const root = arg("root") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const now = arg("now") ? new Date(arg("now")) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--now 를 못 읽었다: ${arg("now")}`);
  const checks = collectChecks({ root, now });
  log(`데이터 진척 (KST ${kstYmd(now.getTime())}, ${now.toISOString()})`);
  // F2 는 소스가 수십 개라 ok 는 합계 한 줄로 줄이고, 경고·실패만 소스별로 찍는다.
  const isBuilderAge = (c: Check) => c.source.startsWith(BUILDER_AGE_PREFIX);
  const sourceChecks = checks.filter((c) => !isBuilderAge(c));
  const builderChecks = checks.filter(isBuilderAge);
  for (const c of [...sourceChecks, ...builderChecks.filter((b) => b.level !== "ok")]) log(`  ${c.level.padEnd(4)} ${c.source.padEnd(28)} ${c.cadence.padEnd(12)} ${c.detail}`);
  log(`  빌더 산출물 ${builderChecks.length}개 소스 중 ok ${builderChecks.filter((c) => c.level === "ok").length}`);
  for (const c of sourceChecks) {
    if (c.level === "warn") log(`::warning::데이터 진척 확인: ${c.source} - ${c.detail}`);
    if (c.level === "fail") log(`::error::데이터가 멈췄다: ${c.source} - ${c.detail}. run 은 초록이어도 수집기가 어제 값으로 가고 있다 - 그 수집 단계 로그를 본다(audit/갱신-사고-대응.md)`);
  }
  const builderWarn = builderChecks.filter((c) => c.level === "warn");
  const builderFail = builderChecks.filter((c) => c.level === "fail");
  if (builderWarn.length) log(`::warning::빌더 산출물 ${CHECK_HOURS}h 초과: ${builderAgeLine(builderWarn)}`);
  if (builderFail.length) log(`::error::빌더 산출물이 멈췄다(${ALERT_HOURS}h 초과 또는 updatedAt 못 읽음): ${builderAgeLine(builderFail)}. 빌더가 안 돌았거나 소프트 실패해 어제 파일을 두고 있다 - 수집 단계 로그를 본다(audit/갱신-사고-대응.md)`);
  // 종료 코드와 무관하게 쓴다: 실패가 있어도 경고는 이슈로 올라가야 한다(#657 report job).
  writeReport(reportPayload(checks, now));
  const fails = checks.filter((c) => c.level === "fail").length;
  log(fails ? `실패 ${fails}건` : `합격 - 경고 ${checks.filter((c) => c.level === "warn").length}건`);
  return fails ? 1 : 0;
}

// ---- method 「수집 상태」 줄 (#657, 빌드 때 데이터에서) ----

/** 공백을 세기 시작하는 날(B4 컷오버 뒤 수집이 다시 이어진 날). */
export const GAP_SINCE = "2026-10-01";

/**
 * market-history.json(full 실행마다 그날 한 줄)으로 한 줄을 만든다(공시가격 진척은 화면에 싣지 않고 워치독 경고에만 둔다, #667 cpo). 데이터가 없으면 null(줄을 안 그린다).
 * 공백 = GAP_SINCE(또는 기록 첫날)부터 마지막 기록일까지 기록이 없는 날 수. 빌드 날짜를 읽지 않는다(같은 데이터면 같은 줄).
 */
export function collectStatus(history: unknown) {
  const dates = Array.isArray(history) ? history.map((h) => String(h?.date ?? "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  if (!dates.length) return null;
  const last = dates.at(-1);
  const since = dates[0] > GAP_SINCE ? dates[0] : GAP_SINCE;
  const seen = new Set(dates);
  let gaps = 0;
  for (let d = dayNum(since); d <= dayNum(last); d += 1) if (!seen.has(new Date(d * DAY_MS).toISOString().slice(0, 10))) gaps += 1;
  const md = (d: string) => d.slice(5);
  return {
    ko: `<p>수집 상태: 마지막 수집 성공 ${md(last)} · ${md(since)} 이후 수집이 빠진 날 ${gaps}일</p>`,
    en: `<p>Collection: last successful run ${md(last)} · ${gaps} day${gaps === 1 ? "" : "s"} without collection since ${md(since)}</p>`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const output = process.env.GITHUB_OUTPUT;
    process.exitCode = main(process.argv.slice(2), output ? { writeReport: (json) => appendFileSync(output, `report=${json}\n`) } : {});
  } catch (e) {
    console.log(`::error::데이터 진척 검사가 돌지 못했다 - ${e.message}`);
    process.exitCode = 2;
  }
}
