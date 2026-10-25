/**
 * 자치구별 월세화·전세 보증금 흐름 24개월 (V7).
 *
 * 「전세가 왜 안 보이나, 월세로 넘어간 게 얼마나 되나」에 그 구의 숫자로 답한다. 원본은 이미 들고 있는
 * 국토부 전월세 신고 24개월 슬롯(raw/rent, RETENTION_MONTHS)이다. 새 수집은 없다.
 *
 * 달마다 세는 것 셋:
 *  - 전월세 신고 중 월세·반전세(월세가 0보다 큰 계약) 비중
 *  - 「신규」로 신고된 순수 전세의 보증금 중앙값(면적을 가리지 않는다 - 화면에 그렇게 적는다)
 *  - 전세였다가 갱신한 계약 중 월세를 끼고 다시 맺은 비율(renewal-facts.ts 의 classify 그대로)
 *
 * 화면 문장은 한 달이 아니라 마감된 마지막 석 달을 1년 전 같은 석 달과 견준다 - 한 달짜리 구 표본은
 * 얇고, 같은 계절끼리 견줘야 이사철이 흐름처럼 보이지 않는다. 신고 기한(30일)이 남은 달은 「덜 찬 달」로
 * 표시만 하고 세지 않는다(isClosedMonth, 재계약 관찰과 같은 규칙).
 *
 * 표본 문턱은 새로 정하지 않는다: 값을 낼지는 hasEnoughSample(realestate-format.ts) 한 곳이 정한다.
 * 문턱을 못 넘은 값은 null 이고 건수(n)는 그대로 남긴다 - 화면이 「몇 건뿐이라 내지 않는다」고 적을 수 있게.
 * 공개 단위는 구×달 집계뿐이고 건별 행은 싣지 않는다.
 */
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasEnoughSample } from "./realestate-format.ts";
import { classify, isClosedMonth, isRenewal } from "./renewal-facts.ts";
import { SOURCES } from "./source-lines.ts";

/** 계열 길이. 원본 보관 창(RETENTION_MONTHS)과 같다 - 창이 굴러가도 산출물에는 그날의 24개월이 남는다. */
export const RENT_FLOW_MONTHS = 24;

/** 화면이 견주는 창(마감된 마지막 석 달 vs 1년 전 같은 석 달). */
export const COMPARE_MONTHS = 3;

const number = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return /^\d+$/.test(text) ? Number(text) : 0;
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const enough = (n) => hasEnoughSample({ transactionCount: n });
const pct1 = (part, whole) => (enough(whole) ? Math.round((part / whole) * 1000) / 10 : null);
/** 화면의 비율 글자. 소수 한 자리로 고정한다(67 과 59.2 가 나란히 서면 자릿수가 들쭉날쭉하다). */
const p1 = (v) => v.toFixed(1);

/** 한 묶음(달 하나 또는 석 달)의 집계. 값은 문턱을 넘을 때만, 건수는 늘. */
function summarize(items) {
  let n = 0;
  let wolse = 0;
  let fromJeonse = 0;
  let toWolse = 0;
  const deposits = [];
  for (const item of items) {
    if (number(item?.deposit) <= 0) continue;
    n += 1;
    const rent = number(item?.monthlyRent);
    if (rent > 0) wolse += 1;
    else if (String(item?.contractType ?? "").trim() === "신규") deposits.push(number(item.deposit));
    if (isRenewal(item)) {
      const row = classify(item);
      if (row.wasJeonse) {
        fromJeonse += 1;
        if (row.switched === "toWolse") toWolse += 1;
      }
    }
  }
  return {
    n,
    wolseShare: pct1(wolse, n),
    jn: deposits.length,
    jmed: enough(deposits.length) ? median(deposits) : null,
    fromJeonse,
    toWolseShare: pct1(toWolse, fromJeonse),
  };
}

/**
 * 자치구 → 달 → 신고 목록(그 달 파일이 없거나 ok:false 면 null)에서 산출물을 만든다.
 * months 는 오름차순 `YYYYMM`. 순수 함수 - 같은 입력이면 같은 출력.
 */
export function buildRentFlow({ byDistrict, months, now }) {
  const closed = months.filter((m) => isClosedMonth(Number(m.slice(0, 4)), Number(m.slice(4)), now));
  const partial = months.filter((m) => !closed.includes(m));
  const last = closed.at(-1);
  const recent = last ? closed.slice(-COMPARE_MONTHS) : [];
  const base = recent.map((m) => shift(m, -12));
  const compareOk = recent.length === COMPARE_MONTHS && base.every((m) => closed.includes(m));
  const closedSpan = closed.length ? [closed[0], last] : null;

  const seoulByMonth = new Map<string, any[]>(months.map((m) => [m, []]));
  const seoulMissing = new Set();
  const districts: Record<string, any> = {};
  for (const [name, byMonth] of Object.entries(byDistrict ?? {})) {
    const pick = (list) => (list.every((m) => Array.isArray(byMonth?.[m])) ? list.flatMap((m) => byMonth[m]) : null);
    const series = months.map((m) => {
      const items = byMonth?.[m];
      if (!Array.isArray(items)) {
        seoulMissing.add(m);
        return null;
      }
      seoulByMonth.get(m).push(...items);
      const { n, wolseShare, jn, jmed } = summarize(items);
      return { n, w: wolseShare, jn, jmed };
    });
    const span = closedSpan ? pick(closed) : null;
    districts[name] = {
      series,
      compare: compareOk ? { base: maybe(pick(base)), recent: maybe(pick(recent)) } : null,
      renewals: pick1(maybe(span)),
    };
  }

  const seoulPick = (list) => (list.some((m) => seoulMissing.has(m)) ? null : list.flatMap((m) => seoulByMonth.get(m)));
  return {
    updatedAt: now.toISOString(),
    months,
    partial,
    compare: compareOk ? { base, recent } : null,
    closedSpan,
    seoul: {
      compare: compareOk ? { base: maybe(seoulPick(base)), recent: maybe(seoulPick(recent)) } : null,
      renewals: closedSpan ? pick1(maybe(seoulPick(closed))) : null,
    },
    districts,
  };
}

const maybe = (items) => (items ? summarize(items) : null);
const pick1 = (s) => (s ? { fromJeonse: s.fromJeonse, toWolseShare: s.toWolseShare } : null);

function shift(yyyymm, delta) {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 임시 파일에 쓰고 같은 폴더에서 이름을 바꾼다(#644 와 같은 모양) - 반쪽 파일이 남지 않고, 실패하면 이전 파일이 그대로다.
 * 쓰는 곳은 docs/data 아래 한 파일뿐이다(test/rent-flow.test.mjs 가 경로를 고정한다).
 */
export async function writeRentFlowFile(file, payload) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(payload));
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

// ---- 화면 문장 (자치구 장, React SSG 조각 districtRentFlowHtml 이 부른다) ----

const ym = (m) => ({ y: Number(m.slice(0, 4)), mo: Number(m.slice(4)) });
const EN_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 달 구간 이름. ko 「2025년 6~8월」·「2025년 12월~2026년 2월」, en 「Jun–Aug 2025」·「Dec 2025–Feb 2026」. */
export function spanLabel(first, last, locale = "ko") {
  const a = ym(first);
  const b = ym(last);
  if (locale === "en") {
    return a.y === b.y ? `${EN_MON[a.mo - 1]}–${EN_MON[b.mo - 1]} ${b.y}` : `${EN_MON[a.mo - 1]} ${a.y}–${EN_MON[b.mo - 1]} ${b.y}`;
  }
  return a.y === b.y ? `${a.y}년 ${a.mo}~${b.mo}월` : `${a.y}년 ${a.mo}월~${b.y}년 ${b.mo}월`;
}

const money = (amount10k, en) => {
  const v = amount10k / 10000;
  const text = v >= 10 ? v.toFixed(0) : v.toFixed(1);
  return en ? `₩${Math.round(Number(text) * 100)}M` : `${text}억원`;
};

/**
 * 서울과 견준 한마디. 구의 비중 변화(d)와 서울 변화(dS)의 차이가 표본 오차(두 창 비율의 표준오차 합성, 2배) 안이면
 * 「비슷하다」고만 한다 - 얇은 구가 우연으로 「서울보다 빠르다」로 찍히지 않게. 문턱을 새로 고르지 않으려고 숫자 대신 오차로 가른다.
 */
export function versusSeoul(b, r, s) {
  if (s?.base?.wolseShare == null || s?.recent?.wolseShare == null) return null;
  const d = r.wolseShare - b.wolseShare;
  const dS = s.recent.wolseShare - s.base.wolseShare;
  const v = (p, n) => ((p / 100) * (1 - p / 100)) / n;
  const se = 100 * Math.sqrt(v(b.wolseShare, b.n) + v(r.wolseShare, r.n) + v(s.base.wolseShare, s.base.n) + v(s.recent.wolseShare, s.recent.n));
  const seoul = [s.base.wolseShare, s.recent.wolseShare];
  if (!(Math.abs(d - dS) > 2 * se)) return { kind: "similar", seoul };
  if (Math.sign(d) !== Math.sign(dS)) return { kind: "opposite", seoul };
  return { kind: Math.abs(d) > Math.abs(dS) ? "more" : "less", up: d > 0, seoul };
}

const VS = {
  ko: {
    similar: (s) => `서울(${s})과의 차이는 표본 오차 안이라 비슷한 흐름으로 봅니다.`,
    opposite: (s) => `서울(${s})과 반대 방향입니다.`,
    more: (s, up) => `서울(${s})보다 더 ${up ? "많이 올랐" : "많이 내렸"}습니다.`,
    less: (s, up) => `서울(${s})보다 덜 ${up ? "올랐" : "내렸"}습니다.`,
  },
  en: {
    similar: (s) => `The gap from Seoul (${s}) is within sampling error, so read it as the same trend.`,
    opposite: (s) => `Seoul moved the other way (${s}).`,
    more: (s, up) => `That is a bigger ${up ? "rise" : "fall"} than Seoul's (${s}).`,
    less: (s, up) => `That is a smaller ${up ? "rise" : "fall"} than Seoul's (${s}).`,
  },
};

/**
 * 자치구 한 곳의 문장. name 은 자치구 이름(산출물 districts 의 키), flow 는 산출물 전체(달·서울 값).
 * 문장마다 구 이름을 넣는다 - 스물다섯 장이 숫자만 바뀐 같은 문단이 되지 않게(prose-share 고유율, V7 완료 조건).
 * 문턱을 못 넘은 값은 숫자 대신 건수와 함께 「내지 않는다」고 적는다 - 빈칸으로 두지 않는다.
 */
export function rentFlowSentences(name, flow, locale = "ko") {
  const district = name == null ? null : flow?.districts?.[name];
  if (!district || !flow?.compare || !district.compare?.base || !district.compare?.recent) return [];
  const en = locale === "en";
  const tag = en ? "en-US" : "ko-KR";
  const n = (v) => v.toLocaleString(tag);
  const { base, recent } = flow.compare;
  const b = district.compare.base;
  const r = district.compare.recent;
  const baseL = spanLabel(base[0], base.at(-1), locale);
  const recentL = spanLabel(recent[0], recent.at(-1), locale);
  const src = en ? SOURCES.molit.abbr : SOURCES.molit.ko;
  const out = [];

  if (b.wolseShare !== null && r.wolseShare !== null) {
    const d = Math.round((r.wolseShare - b.wolseShare) * 10) / 10;
    const move = en
      ? d === 0 ? "unchanged" : `${d > 0 ? "up" : "down"} ${p1(Math.abs(d))}pp`
      : d === 0 ? "그대로입니다" : `${p1(Math.abs(d))}%p ${d > 0 ? "올랐습니다" : "내렸습니다"}`;
    out.push(
      en
        ? `Rent flow (${src} lease filings): in ${name}, monthly-rent and semi-jeonse leases went from ${p1(b.wolseShare)}% of filings in ${baseL} (n=${n(b.n)}) to ${p1(r.wolseShare)}% in ${recentL} (n=${n(r.n)}), ${move}.`
        : `전월세 흐름(${src} 신고): ${name} 전월세 신고 중 월세·반전세 비중은 ${baseL} ${p1(b.wolseShare)}%(${n(b.n)}건)에서 ${recentL} ${p1(r.wolseShare)}%(${n(r.n)}건)로 ${move}.`
    );
    const vs = versusSeoul(b, r, flow.seoul?.compare);
    if (vs) out.push(VS[en ? "en" : "ko"][vs.kind](`${p1(vs.seoul[0])}% → ${p1(vs.seoul[1])}%`, vs.up));
  } else {
    out.push(
      en
        ? `Rent flow (${src} lease filings): ${name} has too few filings to give the monthly-rent share (n=${n(b.n)} in ${baseL}, ${n(r.n)} in ${recentL}).`
        : `전월세 흐름(${src} 신고): ${name}는 신고가 모자라 월세 비중을 내지 않습니다(${baseL} ${n(b.n)}건, ${recentL} ${n(r.n)}건).`
    );
  }

  if (b.jmed !== null && r.jmed !== null) {
    out.push(
      en
        ? `The median new-jeonse deposit in ${name}, all sizes, went from ${money(b.jmed, en)} (n=${n(b.jn)}) to ${money(r.jmed, en)} (n=${n(r.jn)}).`
        : `${name} 신규 전세 보증금 중앙값(면적 구분 없음)은 ${money(b.jmed, en)}(${n(b.jn)}건) → ${money(r.jmed, en)}(${n(r.jn)}건)입니다.`
    );
  } else {
    out.push(
      en
        ? `${name} has too few new jeonse leases for a median deposit (n=${n(b.jn)} → ${n(r.jn)}).`
        : `${name} 신규 전세가 ${n(b.jn)}건 → ${n(r.jn)}건뿐이라 보증금 중앙값을 내지 않습니다.`
    );
  }

  const rw = district.renewals;
  if (rw?.toWolseShare != null && flow.closedSpan) {
    const spanL = spanLabel(flow.closedSpan[0], flow.closedSpan[1], locale);
    const sw = flow.seoul?.renewals?.toWolseShare;
    out.push(
      en
        ? `Of ${n(rw.fromJeonse)} jeonse leases renewed in ${name} in ${spanL}, ${p1(rw.toWolseShare)}% came back with monthly rent${sw != null ? ` (Seoul ${p1(sw)}%)` : ""}.`
        : `${spanL} ${name}에서 전세를 갱신한 ${n(rw.fromJeonse)}건 중 ${p1(rw.toWolseShare)}%가 월세를 끼고 다시 계약했습니다${sw != null ? `(서울 ${p1(sw)}%)` : ""}.`
    );
  }

  if (flow.partial?.length) {
    const p = flow.partial.map(ym);
    out.push(
      en
        ? `${p.map((x) => `${EN_MON[x.mo - 1]} ${x.y}`).join(" and ")} ${p.length > 1 ? "are" : "is"} still filling (30-day filing window) and not counted.`
        : `${p.map((x, i) => (i && x.y === p[i - 1].y ? `${x.mo}월` : `${x.y}년 ${x.mo}월`)).join("·")} 계약은 신고 기한(30일)이 남은 덜 찬 달이라 세지 않았습니다.`
    );
  }
  return out;
}
