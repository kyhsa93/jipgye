import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOAN_LTV, MIN_PAIRS, conversionPairs, districtRates, median, monthlyCost } from "./conversion.ts";
import { MONTHS } from "./build-conversion.ts";
import { collectionNow } from "./collection-now.ts";
import { TAX_RATE } from "./interest.ts";
import { latestRate } from "./mortgage.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { normalizeRentDeal } from "./realestate-metrics.ts";
import { readSlotFile } from "./realestate-raw.ts";
import { shiftMonth, yearMonthOf } from "./realestate-slots.ts";

/**
 * 환산 월 비용(평균금리 가정) — #587 PR2(#620). 판정: https://github.com/kyhsa93/jipgye/issues/587#issuecomment-6397183813
 *
 * 정의(80/20 금융비 환산): 보증금의 80%(LOAN_LTV)는 전세자금대출 평균금리(ECOS 121Y015, 잔액 기준)로 빌리고, 나머지 20%는
 * 자기 돈이라 정기예금 신규취급 평균금리(121Y002) 세후(15.4%)만큼 기회비용을 붙인다. 월세안은 월세 + 같은 금융비다.
 * 식은 전세vs월세 화면과 같은 conversion.ts 의 monthlyCost 한 벌만 부른다(사본 없음):
 *   - 집에 드는 쪽: monthlyCost(보증금, 월세, 가진 돈 = 보증금의 20%) → 80% 대출이자 + 월세(남는 돈 0).
 *   - 기회비용 쪽: monthlyCost(보증금 0, 가진 돈 = 같은 20%) → 그 돈을 예금에 둘 때의 세후 이자(cost = −이자).
 *   두 값의 차 = 월세 + 대출이자 + 포기한 세후 예금이자.
 * monthlyCost 는 금액에 1차 동차이고 반올림(0.1만원)을 끝에 한 번만 한다. 그 반올림이 두 번 겹치지 않게 금액을 SCALE 배로
 * 넣고 나눈다 — 값은 같고 자릿수만 늘어난다(내보낼 때 0.1만원으로 한 번 반올림).
 *
 * 창: 전환율 화면과 같은 6개월 창(build-conversion 의 MONTHS)·신규계약·단지쌍(conversionPairs)·칸 n≥3(MIN_PAIRS).
 * 서울 전체 값 = 창 안 단지쌍 전부의 중앙 전세보증금(전세안), 중앙 월세보증금·중앙 월세(월세안). 금리는 창 끝 달의 값.
 * 점: 1년 변화(m−12 → m). m 은 마감된 달(이번 달 전) ∩ 두 금리 계열이 m·m−12 둘 다 값을 가진 달 ∩ 두 창 모두 원본이 다 있는 달.
 * 「계열」이 아니라 「점」이다 — 12점 계열은 원본 29개월(202411~202703) 뒤 별도 이슈(#586 핀).
 *
 * 구간: 부트스트랩 백분위 95%(2.5·97.5 분위, 선형 보간, 2,000회). 두 창을 각각 따로 **단지쌍 단위로** 복원 추출(단지쌍 = 같은
 * 단지·같은 면적대의 전세·월세 묶음 — 중앙값을 내는 단위와 같다)해 중앙값을 다시 내고 1년 변화를 센다. data-analyst 가 쓴 방식이다
 * (#587 ① 댓글: 서울 전세안 95% 22.2~28.4 를 이 방식이 그대로 재현한다; 단지 이름으로 면적대를 묶어 뽑으면 아래 끝이 21~22 로
 * 조금 넓어진다). 칸 안에서는 단지 하나 = 쌍 하나라 둘이 같다. 시드 고정(mulberry32), 점·칸마다 키에서 시드를 갈라 같은 입력이면
 * 같은 바이트다. 구간 끝은 몬테카를로 값이라 시드를 바꾸면 ±1%p 안팎 흔들린다(그래서 칸 공개는 10,000회·폭 ≤29%p, 29~31%p 는 보류).
 *
 * 분해: 금리 몫 = 기준 달 보증금(·월세)을 그대로 두고 금리만 m 의 것으로 바꿨을 때의 변화. 나머지(보증금 몫, 월세안은 보증금·월세
 * 수준 몫) = (1+전체)/(1+금리 몫) − 1. 둘은 곱으로 전체가 된다.
 *
 * 내보내기: 이 스크립트는 docs/data/monthly-cost.json(서울 전체 한 줄) 하나만 쓴다 — Daily 「실거래 수집」이 `--soft-fail` 로 부른다(#631).
 * 75칸 값은 수동 전용 scripts/dev/build-monthly-cost-cells.mjs 가 따로 쓴다(판정: 칸 값은 docs 로 내보내지 않고 Daily 가 커밋하지 않음).
 * 칸 public 은 10,000회·시드 587 에서 구간 폭 ≤29%p 일 때만 참이다(29~31%p 는 몬테카를로 흔들림 구간이라 보류, #630 cto 결정).
 *
 * 실패: 쓰기는 같은 폴더 임시 파일 → rename 이라 반쯤 쓴 파일이 남지 않는다. `--soft-fail` 이면 실패를 경고로 찍고 종료 0 — 기존 파일을
 * 그대로 두고 Daily 를 멈추지 않는다(수집·다른 빌더 산출물이 이 생성기 하나 때문에 버려지지 않게). 손으로 돌릴 때(플래그 없음)는 종료 1.
 */

export const NAME = { ko: "환산 월 비용(평균금리 가정)", en: "Estimated monthly cost (at average rates)" };
export const SCALE = 1000;
export const ITERATIONS = 2000;
export const SEED = 587;
export const LEVEL = 0.95;
/** 칸 공개 문턱(%p)과 그 판정에 필요한 최소 반복 수(#630 cto 결정). 29 초과 31 이하는 withheld(보류)로 따로 표시한다. */
export const PUBLIC_WIDTH = 29;
export const WITHHELD_WIDTH = 31;
export const PUBLIC_ITERATIONS = 10_000;
/** 1년 변화 점 하나가 원본에서 덮어야 하는 달 수: 두 창(6+6)과 그 사이 = 12 + 6 = 18 (점 수 = 원본 개월 − 17). */
export const SPAN_MONTHS = 12 + MONTHS;

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.MONTHLY_COST_FILE ? path.resolve(process.env.MONTHLY_COST_FILE) : path.join(root, "docs/data/monthly-cost.json");
const seriesFile = process.env.SERIES_FILE ? path.resolve(process.env.SERIES_FILE) : path.join(root, "raw/indicators/series.json");

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const pct = (ratio) => round2(ratio * 100);

/** 80/20 환산 월 비용(만원/월, 반올림 전). 금리나 보증금이 없거나 이상하면 null — 지어낸 값을 내지 않는다. */
export function convertedCost({ deposit10k, monthlyRent10k = 0, loanRate, depositRate }) {
  if (!(Number(deposit10k) > 0) || !(Number(monthlyRent10k) >= 0)) return null;
  const own10k = deposit10k * (1 - LOAN_LTV);
  const housing = monthlyCost({ deposit10k: deposit10k * SCALE, monthlyRent10k: monthlyRent10k * SCALE, cash10k: own10k * SCALE, loanRate, depositRate });
  const idle = monthlyCost({ deposit10k: 0, cash10k: own10k * SCALE, loanRate, depositRate });
  if (!housing || !idle || !housing.feasible) return null;
  return (housing.cost10k - idle.cost10k) / SCALE;
}

/** m 달의 두 금리. 둘 중 하나라도 비거나 0 이하면 null(ratesOf·latestRate 와 같은 규칙). */
export function ratesAt(series, month) {
  const pick = (rows) => {
    const row = (Array.isArray(rows) ? rows : []).find((r) => Array.isArray(r) && String(r[0]) === month);
    return row && latestRate([row]) ? Number(row[1]) : null;
  };
  const loanRate = pick(series?.jeonse_loan_rate);
  const depositRate = pick(series?.deposit_rate);
  return loanRate == null || depositRate == null ? null : { loanRate, depositRate };
}

export const windowOf = (end) => Array.from({ length: MONTHS }, (_, i) => shiftMonth(end, i - (MONTHS - 1)));

/** 결정적 의사난수(mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 키 문자열에서 시드를 가른다(FNV-1a). 칸이 늘거나 줄어도 다른 칸의 구간이 흔들리지 않는다. */
export function seedOf(key, seed = SEED) {
  let h = 0x811c9dc5 ^ seed;
  for (const ch of String(key)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 정렬된 배열의 q 분위(선형 보간, R type 7). */
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const pairKey = (p) => `${p.district}\u0000${p.dong}\u0000${p.apt}\u0000${p.band}`;

/** 재표집 단위(단지쌍)를 입력 순서와 무관한 순서(코드 단위 비교)로 둔다 — 같은 입력이면 같은 추출. */
export const stableOrder = (pairs) => [...pairs].sort((a, b) => cmp(pairKey(a), pairKey(b)));

const levels = (pairs) => ({
  jeonse10k: median(pairs.map((p) => p.jeonse10k)),
  deposit10k: median(pairs.map((p) => p.deposit10k)),
  monthly10k: median(pairs.map((p) => p.monthly10k)),
});

const costsOf = (lv, rates) => ({
  jeonse: convertedCost({ deposit10k: lv.jeonse10k, ...rates }),
  wolse: convertedCost({ deposit10k: lv.deposit10k, monthlyRent10k: lv.monthly10k, ...rates }),
});

function resample(pairs, rand) {
  const picked = new Array(pairs.length);
  for (let i = 0; i < pairs.length; i += 1) picked[i] = pairs[Math.floor(rand() * pairs.length)];
  return levels(picked);
}

/** 두 창의 단지쌍을 따로 복원 추출해 전세안·월세안 1년 변화(비율)의 백분위 구간을 낸다. */
export function bootstrapYoy({ basePairs, pairs, baseRates, rates, key, iterations = ITERATIONS, seed = SEED }) {
  const rand = mulberry32(seedOf(key, seed));
  const units0 = stableOrder(basePairs);
  const units1 = stableOrder(pairs);
  const jeonse = [];
  const wolse = [];
  for (let b = 0; b < iterations; b += 1) {
    const c0 = costsOf(resample(units0, rand), baseRates);
    const c1 = costsOf(resample(units1, rand), rates);
    if (c0.jeonse && c1.jeonse) jeonse.push(c1.jeonse / c0.jeonse - 1);
    if (c0.wolse && c1.wolse) wolse.push(c1.wolse / c0.wolse - 1);
  }
  const interval = (xs) => {
    if (!xs.length) return null;
    xs.sort((a, b) => a - b);
    const tail = (1 - LEVEL) / 2;
    return [pct(quantile(xs, tail)), pct(quantile(xs, 1 - tail))];
  };
  return { jeonse: interval(jeonse), wolse: interval(wolse) };
}

/** 한 점의 서울 전체 값·분해(구간 제외). */
export function seoulPoint({ month, basePairs, pairs, baseRates, rates }) {
  const lv0 = levels(basePairs);
  const lv1 = levels(pairs);
  const c0 = costsOf(lv0, baseRates);
  const c1 = costsOf(lv1, rates);
  if (!c0.jeonse || !c1.jeonse || !c0.wolse || !c1.wolse) return null;

  const rateOnlyJeonse = convertedCost({ deposit10k: lv0.jeonse10k, ...rates }) / c0.jeonse - 1;
  const rateOnlyWolse = convertedCost({ deposit10k: lv0.deposit10k, monthlyRent10k: lv0.monthly10k, ...rates }) / c0.wolse - 1;
  const yoyJ = c1.jeonse / c0.jeonse - 1;
  const yoyW = c1.wolse / c0.wolse - 1;
  const base = shiftMonth(month, -12);
  return {
    month,
    base,
    window: windowOf(month),
    baseWindow: windowOf(base),
    rates: { loan: rates.loanRate, deposit: rates.depositRate },
    baseRates: { loan: baseRates.loanRate, deposit: baseRates.depositRate },
    pairs: pairs.length,
    basePairs: basePairs.length,
    jeonse: {
      deposit10k: lv1.jeonse10k,
      baseDeposit10k: lv0.jeonse10k,
      cost10k: round1(c1.jeonse),
      baseCost10k: round1(c0.jeonse),
      yoy: pct(yoyJ),
      rateShare: pct(rateOnlyJeonse),
      depositShare: pct((1 + yoyJ) / (1 + rateOnlyJeonse) - 1),
    },
    wolse: {
      deposit10k: lv1.deposit10k,
      monthly10k: lv1.monthly10k,
      baseDeposit10k: lv0.deposit10k,
      baseMonthly10k: lv0.monthly10k,
      cost10k: round1(c1.wolse),
      baseCost10k: round1(c0.wolse),
      yoy: pct(yoyW),
      rateShare: pct(rateOnlyWolse),
      levelShare: pct((1 + yoyW) / (1 + rateOnlyWolse) - 1),
    },
  };
}

/** 한 점의 75칸(두 창 모두 n≥MIN_PAIRS 인 칸). research/ 전용. */
export function cellPoints({ month, basePairs, pairs, baseRates, rates, iterations = ITERATIONS, seed = SEED }) {
  const byCell = (list) => {
    const map = new Map();
    for (const p of list) {
      const key = `${p.district}\u0000${p.band}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return map;
  };
  const cells0 = byCell(basePairs);
  const cells1 = byCell(pairs);
  const rows0 = new Map(districtRates(basePairs).map((c) => [`${c.district}\u0000${c.band}`, c]));
  const out = [];
  for (const cell of districtRates(pairs)) {
    const key = `${cell.district}\u0000${cell.band}`;
    const prev = rows0.get(key);
    if (!prev || prev.pairs < MIN_PAIRS) continue;
    const j0 = convertedCost({ deposit10k: prev.jeonse10k, ...baseRates });
    const j1 = convertedCost({ deposit10k: cell.jeonse10k, ...rates });
    if (!j0 || !j1) continue;
    const ci = bootstrapYoy({
      basePairs: cells0.get(key),
      pairs: cells1.get(key),
      baseRates,
      rates,
      key: `${month}|${cell.district}|${cell.band}`,
      iterations,
      seed,
    }).jeonse;
    const width = ci ? round2(ci[1] - ci[0]) : null;
    out.push({
      district: cell.district,
      band: cell.band,
      pairs: cell.pairs,
      basePairs: prev.pairs,
      cost10k: round1(j1),
      baseCost10k: round1(j0),
      yoy: pct(j1 / j0 - 1),
      ci,
      width,
      excludesZero: ci ? ci[0] > 0 || ci[1] < 0 : false,
      public: width != null && width <= PUBLIC_WIDTH && iterations >= PUBLIC_ITERATIONS && seed === SEED,
      withheld: width != null && width > PUBLIC_WIDTH && width <= WITHHELD_WIDTH,
    });
  }
  return out;
}

/**
 * 두 파일의 내용. dealsByMonth: { "YYYYMM": 신규·정규화된 전월세 건[] } — 원본이 다 있는 달만 담는다(없는 달은 키가 없다).
 * lastClosed: 마감된 마지막 달. 점이 하나도 없으면 null(호출자는 기존 파일을 그대로 둔다).
 * withCells: false 면 칸을 세지 않는다(cells: null) — Daily 는 서울 한 줄만 쓴다. 서울 값은 withCells 와 무관하게 같은 바이트다.
 * cellIterations: 칸 구간의 반복 수(수동 칸 스크립트가 PUBLIC_ITERATIONS 를 준다). 서울 구간은 iterations 그대로.
 */
export function buildPayload({ dealsByMonth, series, lastClosed, iterations = ITERATIONS, seed = SEED, withCells = true, cellIterations = iterations }) {
  const months = Object.keys(dealsByMonth ?? {}).sort();
  if (!months.length || !/^\d{6}$/.test(String(lastClosed ?? ""))) return null;
  const covered = (end) => windowOf(end).every((m) => Array.isArray(dealsByMonth[m]));
  const pairsOf = (end) => conversionPairs(windowOf(end).flatMap((m) => dealsByMonth[m]));

  const seoul = [];
  const cells = [];
  for (let m = shiftMonth(months[0], SPAN_MONTHS - 1); m <= lastClosed; m = shiftMonth(m, 1)) {
    const base = shiftMonth(m, -12);
    if (!covered(m) || !covered(base)) continue;
    const rates = ratesAt(series, m);
    const baseRates = ratesAt(series, base);
    if (!rates || !baseRates) continue;
    const basePairs = pairsOf(base);
    const pairs = pairsOf(m);
    if (!basePairs.length || !pairs.length) continue;

    const point = seoulPoint({ month: m, basePairs, pairs, baseRates, rates });
    if (!point) continue;
    const ci = bootstrapYoy({ basePairs, pairs, baseRates, rates, key: `${m}|seoul`, iterations, seed });
    seoul.push({ ...point, jeonse: { ...point.jeonse, ci: ci.jeonse }, wolse: { ...point.wolse, ci: ci.wolse } });
    if (withCells) cells.push({ month: m, base, cells: cellPoints({ month: m, basePairs, pairs, baseRates, rates, iterations: cellIterations, seed }) });
  }
  if (!seoul.length) return null;

  const definition = {
    loanShare: LOAN_LTV,
    taxRate: TAX_RATE,
    loanSeries: "ECOS 121Y015 BECBLB020210 (balance basis)",
    depositSeries: "ECOS 121Y002 BEABAA211",
    windowMonths: MONTHS,
    minPairs: MIN_PAIRS,
    unit: "10k KRW / month",
  };
  const interval = { method: "bootstrap-percentile", resample: "complex-band pair", iterations, seed, level: LEVEL };
  return {
    seoul: { name: NAME, definition, interval, points: seoul },
    cells: withCells
      ? { name: NAME, definition, interval: { ...interval, iterations: cellIterations }, publicWidth: PUBLIC_WIDTH, withheldWidth: WITHHELD_WIDTH, publicIterations: PUBLIC_ITERATIONS, points: cells }
      : null,
  };
}

/** 원본에서 달마다 전월세 건을 읽는다. 25개 구 파일이 모두 정상인 달만 담는다(빠진 달을 채우지 않는다). */
export async function readDealsByMonth(months) {
  const out = {};
  for (const month of months) {
    const deals = [];
    let complete = true;
    for (const { code, name } of DISTRICTS) {
      const file = await readSlotFile("rent", code, month);
      if (!file || file.ok === false || !Array.isArray(file.items)) {
        complete = false;
        break;
      }
      for (const item of file.items) {
        const deal = normalizeRentDeal(item, name);
        if (deal) deals.push(deal);
      }
    }
    if (complete) out[month] = deals;
  }
  return out;
}

/** 같은 폴더 임시 파일에 다 쓴 뒤 rename — 중간에 죽어도 기존 파일이 그대로다. 실패하면 임시 파일을 지운다(커밋 경로에 찌꺼기를 남기지 않는다). */
export async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, text);
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Daily 진입점: 서울 한 줄을 만들어 outFile 하나에만 쓴다. 쓸 값이 없으면 기존 파일을 그대로 두고 null.
 * readDeals·write 는 시험 이음매(기본은 원본 읽기·writeAtomic).
 */
export async function generate({ now = new Date(), outFile: out = outFile, seriesFile: seriesPath = seriesFile, readDeals = readDealsByMonth, write = writeAtomic } = {}) {
  const lastClosed = shiftMonth(yearMonthOf(now), -1);

  let series = null;
  try {
    series = JSON.parse(await readFile(seriesPath, "utf-8"))?.series ?? null;
  } catch {
    console.log("  지표 계열 파일이 없습니다 - 환산 월 비용 파일을 그대로 둡니다");
    return null;
  }

  // 원본 보관 한도(24개월)만큼 거슬러 본다. 그보다 오래된 달은 #586 핀에서 읽는 별도 이슈의 몫이다.
  const months = Array.from({ length: 24 }, (_, i) => shiftMonth(lastClosed, i - 23));
  const dealsByMonth = await readDeals(months);
  const payload = buildPayload({ dealsByMonth, series, lastClosed, withCells: false });
  if (!payload) {
    console.log("  1년 변화를 낼 수 있는 달이 없습니다(원본 창·두 금리 계열) - 환산 월 비용 파일을 그대로 둡니다");
    return null;
  }

  await write(out, JSON.stringify(payload.seoul));
  for (const p of payload.seoul.points) {
    console.log(
      `  ${p.base}→${p.month} 전세안 ${p.jeonse.baseCost10k}→${p.jeonse.cost10k} (${p.jeonse.yoy}%, 95% ${p.jeonse.ci?.join("~")}, 금리 몫 ${p.jeonse.rateShare}%)` +
        ` · 월세안 ${p.wolse.baseCost10k}→${p.wolse.cost10k} (${p.wolse.yoy}%)`
    );
  }
  return payload.seoul;
}

async function main() {
  await generate({ now: collectionNow("REALESTATE_NOW") });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const soft = process.argv.includes("--soft-fail");
  main().catch((err) => {
    if (soft) {
      // Daily: 실패해도 기존 파일을 그대로 두고 다음 단계로 간다(GitHub Actions 경고로 남긴다).
      console.log(`::warning::환산 월 비용 생성 실패 - 기존 docs/data/monthly-cost.json 을 그대로 둡니다: ${err.message}`);
      return;
    }
    console.error(`환산 월 비용 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
