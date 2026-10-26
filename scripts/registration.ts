/**
 * 신고된 거래는 끝까지 갔나 - 등기일자가 기록된 거래·해제·둘 다 없음 비율, 신고가 vs 나머지(R1, #715).
 *
 * 새 정의는 없다. 해제·등기·정정·익은 달은 cancellation.ts, 신고가는 record-high.ts 의 것을 부른다.
 *
 * - 정정 먼저 뺀다(withoutCorrections). 빼지 않으면 해제를 3~4배로 잡는다(#28).
 * - 「등기」는 원본 rgstDate(국토부 항목명 「등기일자」) 칸이 채워진 거래까지만이다 - 그 날짜가 접수일인지 완료일인지는
 *   국토부 API 문서를 인용하기 전까지 말하지 않는다. 그래서 「등기일자가 기록된」이라고만 쓴다.
 * - 익은 달(그 달 계약의 MATURE_SHARE 이상이 등기일자를 가진 달, registrationStats 의 정의)만 비율에 넣는다.
 *   덜 익은 달은 「확정 전」으로 달과 건수만 둔다 - 같은 장에 두 정의를 두지 않는다(180일 기준은 쓰지 않는다).
 * - 「둘 다 없음」의 사유는 원본에 없다. 허위 신고라고 단정하지 않는다.
 * - 신고가는 record-high.ts 규칙 그대로(toDeal·byCell·MIN_PRIOR·MIN_SPAN_DAYS - 해제 안 된 중개거래 이력에서 선행
 *   MIN_PRIOR 건 이상·MIN_SPAN_DAYS 일 이상, 그 전 최고가 초과). 해제된 거래도 같은 이력에 견줘 가른다 - 그래야 해제율을
 *   견줄 수 있다. 해제 안 된 거래의 신고가 수는 measure() 와 같아야 하고, 다르면 던진다(soft-fail 이 이전 파일을 지킨다).
 * - 문턱은 계산 전에 고정했다: 구 행 MIN_DEALS(100)건, 신고가 비교는 두 무리 모두 MIN_RECORDS(100)건. 차이의 90% 구간이
 *   0 을 품으면 「차이 없음」으로 그대로 낸다.
 *
 * 공개는 집계만이다 - 서울·자치구 비율과 건수. 단지·칸·건별 값은 내지 않는다.
 */

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MATURE_SHARE,
  MIN_DEALS,
  dayGap,
  dealDate,
  isCancelled,
  isRegistered,
  median,
  monthKey,
  parseShortDate,
  registrationStats,
  withoutCorrections,
} from "./cancellation.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { MIN_PRIOR, MIN_RECORDS, MIN_SPAN_DAYS, byCell, measure, toDeal } from "./record-high.ts";

const DAY = 86400000;
/** 90% 구간(양쪽). */
export const Z90 = 1.6448536269514722;
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const pp = (v) => Math.round(v * 1000) / 10;

/** 세 갈래는 겹치지 않는다: 해제가 먼저, 해제 아니면 등기일자 기록, 둘 다 아니면 둘 다 없음. */
export function outcomeOf(item) {
  if (isCancelled(item)) return "cancelled";
  return isRegistered(item) ? "registered" : "neither";
}

/** 계약에서 등기일자까지 날. 경계(0 이상 400 미만)는 cancellation.ts registrationStats 의 걸린 날과 같다 - 시험이 대조한다. */
export function daysToRegistration(item) {
  const gap = dayGap(dealDate(item), parseShortDate(item?.rgstDate));
  return gap !== null && gap >= 0 && gap < 400 ? gap : null;
}

/** 가장 가까운 순위(nearest-rank) 분위수. 날이 정수라 보간하지 않는다. */
export function quantile(values, q) {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

/** 무리 하나의 세 갈래 건수와 비율, 등기일자까지 날 중앙값·p90. 문턱 미달이면 비율·날을 비운다. */
export function outcomeStats(items, minN = MIN_DEALS) {
  const counts = { registered: 0, cancelled: 0, neither: 0 };
  const days = [];
  for (const item of items) {
    const o = outcomeOf(item);
    counts[o] += 1;
    if (o === "registered") {
      const gap = daysToRegistration(item);
      if (gap !== null) days.push(gap);
    }
  }
  const n = items.length;
  const enough = n >= minN;
  return {
    n,
    ...counts,
    registeredShare: enough ? pct(counts.registered, n) : null,
    cancelledShare: enough ? pct(counts.cancelled, n) : null,
    neitherShare: enough ? pct(counts.neither, n) : null,
    medianDays: enough && days.length ? median(days) : null,
    p90Days: enough && days.length ? quantile(days, 0.9) : null,
  };
}

/** Wilson 점수 구간(비율 0~1). */
export function wilson(x, n, z = Z90) {
  if (!n) return null;
  const p = x / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** 두 비율 차이(a - b)의 Newcombe 혼성 점수 구간. 비율이 1~3% 로 작아 정규 근사 대신 쓴다. */
export function diffInterval(xa, na, xb, nb, z = Z90) {
  const pa = xa / na;
  const pb = xb / nb;
  const [la, ua] = wilson(xa, na, z);
  const [lb, ub] = wilson(xb, nb, z);
  const d = pa - pb;
  return { diff: d, lo: d - Math.sqrt((pa - la) ** 2 + (ub - pb) ** 2), hi: d + Math.sqrt((ua - pa) ** 2 + (pb - lb) ** 2) };
}

/**
 * 거래마다 신고가인지. 이력은 record-high.ts 와 같다 - toDeal(해제 안 된 중개거래)을 byCell 로 묶은 칸.
 * 세는 거래는 해제 여부와 상관없이 중개거래면 toDeal 을 해제 표시만 지우고 불러 같은 칸·값·날로 바꾼다.
 * 반환: Map(item → "record" | "rest"). 이력이 모자라 가를 수 없는 거래(중개거래 아님·선행 부족)는 넣지 않는다.
 */
export function recordClasses(items) {
  const cells = byCell(items.map(toDeal).filter(Boolean));
  const out = new Map();
  for (const item of items) {
    const deal = toDeal({ ...item, cdealType: "" });
    if (!deal) continue;
    const before = (cells.get(deal.cell) ?? []).filter((x) => x.time < deal.time);
    if (before.length < MIN_PRIOR || deal.time - before[0].time < MIN_SPAN_DAYS * DAY) continue;
    out.set(item, deal.amount > Math.max(...before.map((x) => x.amount)) ? "record" : "rest");
  }
  // 정의 대조: 해제 안 된 거래 가운데 신고가 수는 record-high.ts measure()(기다린 날 0)의 신고가 수와 같아야 한다.
  const live = [...out].filter(([item, c]) => c === "record" && toDeal(item)).length;
  const expected = measure(cells, Infinity, { wait: 0 }).records;
  if (live !== expected) throw new Error(`신고가 정의 불일치: ${live} ≠ record-high ${expected}`);
  return out;
}

/** 신고가 vs 나머지. 두 무리 모두 MIN_RECORDS 이상일 때만 차이·구간·판정을 낸다. */
export function recordComparison(record, rest, minN = MIN_RECORDS) {
  const a = outcomeStats(record, minN);
  const b = outcomeStats(rest, minN);
  const enough = a.n >= minN && b.n >= minN;
  const diffs = {};
  for (const key of ["cancelled", "neither", "registered"]) {
    if (!enough) {
      diffs[key] = null;
      continue;
    }
    const { diff, lo, hi } = diffInterval(a[key], a.n, b[key], b.n);
    diffs[key] = { diff: pp(diff), lo: pp(lo), hi: pp(hi), verdict: lo <= 0 && hi >= 0 ? "none" : diff > 0 ? "higher" : "lower" };
  }
  return { minN, enough, record: a, rest: b, diff: diffs };
}

/** items: 원본 매매 전체(서울). now: 만든 때. 익은 달이 없으면 null. */
export function buildRegistrationPayload({ items, now }) {
  const all = items ?? [];
  const reportedCancellations = all.filter(isCancelled).length;
  const cleaned = withoutCorrections(all);
  const kept = cleaned.items;
  const matureMonths = registrationStats(kept)?.matureMonths ?? [];
  if (!matureMonths.length) return null;
  const mature = new Set(matureMonths);
  const matured = kept.filter((item) => mature.has(monthKey(item)));

  const pendingCounts = new Map();
  for (const item of kept) {
    const key = monthKey(item);
    if (!mature.has(key)) pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1);
  }

  const byCode = new Map(DISTRICTS.map((d) => [String(d.code), []]));
  for (const item of matured) byCode.get(String(item.sggCd))?.push(item);

  const classes = recordClasses(kept);
  const record = [];
  const rest = [];
  for (const item of matured) {
    const c = classes.get(item);
    if (c === "record") record.push(item);
    else if (c === "rest") rest.push(item);
  }

  return {
    updatedAt: now.toISOString(),
    basis: {
      registered: "rgstDate(등기일자)가 기록된 거래 - 접수일·완료일 여부는 미확인",
      matureShare: MATURE_SHARE,
      minDeals: MIN_DEALS,
      minRecords: MIN_RECORDS,
      record: { prior: MIN_PRIOR, spanDays: MIN_SPAN_DAYS },
      interval: 0.9,
      neitherReason: "unknown",
    },
    corrections: { reportedCancellations, removed: cleaned.corrections.length },
    matureMonths,
    pending: [...pendingCounts].sort(([a], [b]) => a.localeCompare(b)).map(([month, deals]) => ({ month, deals })),
    seoul: outcomeStats(matured),
    districts: DISTRICTS.map((d) => ({ code: String(d.code), name: d.name, ...outcomeStats(byCode.get(String(d.code))) })),
    records: { ...recordComparison(record, rest), unclassified: matured.length - record.length - rest.length },
  };
}

const root = path.resolve(import.meta.dirname, "..");
export const REGISTRATION_NAME = "registration.json";
export const registrationFile = process.env.REGISTRATION_FILE
  ? path.resolve(process.env.REGISTRATION_FILE)
  : path.join(root, "docs/data", REGISTRATION_NAME);

/** Daily(build-district-change) 안 soft-fail 호출. 던지지 않는다 - 실패하면 ::warning 만 남기고 이전 파일을 그대로 둔다. */
export async function writeRegistrationSoft({ items, now, file = registrationFile, log = console.log, build = buildRegistrationPayload }) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    if (path.basename(file) !== REGISTRATION_NAME) throw new Error(`허용되지 않은 출력 경로 ${file}`);
    const payload = build({ items, now });
    if (!payload) {
      log("  등기·해제: 익은 달이 없어 건너뜀(어제 파일 유지)");
      return false;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify(payload));
    await rename(tmp, file);
    const r = payload.records;
    log(
      `  등기·해제: 익은 달 ${payload.matureMonths.length}개, 서울 ${payload.seoul.n}건 등기일자 ${payload.seoul.registeredShare}% · 해제 ${payload.seoul.cancelledShare}% · 둘 다 없음 ${payload.seoul.neitherShare}%, ` +
        `신고가 ${r.record.n} vs 나머지 ${r.rest.n}`
    );
    return true;
  } catch (err) {
    await unlink(tmp).catch(() => {});
    log(`::warning::등기·해제 비율 생성 실패 - 이전 파일을 그대로 둡니다: ${err.message}`);
    return false;
  }
}
