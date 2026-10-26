/**
 * 전월세 만기 달력(N2, #674) - 「우리 구 전월세 계약은 앞으로 12개월 동안 언제 몰려서 끝나나」.
 *
 * 원본은 이미 들고 있는 국토부 전월세 신고 24개월 슬롯(raw/rent)의 `contractTerm`("25.02~27.02" 또는 시작 없는 "~27.02")이다.
 * 새 수집은 없다. 만기월 = 끝 YY.MM(2000+YY). 일(日)은 원본에 없어 만기는 달 단위까지만이다.
 * 계수(data-analyst 2026-10-26, #674 댓글 6403160720): 형식은 이 둘뿐, 채움 96.9%, 끝≤시작 118건(버린다), 월 13 이상 0건.
 *
 * 달마다 세는 것: 전체, 전세(월세 0)·월세(월세 >0, 반전세 포함 - contractType 은 신규/갱신이지 전세/월세가 아니다),
 * 계약갱신요구권 '사용' 표시가 붙은 계약(그 계약 자체가 요구권 갱신이라는 뜻). 같은 키의 행도 지우지 않는다 - 같은 건물 다른 호실이다(호 식별자 없음).
 *
 * 앞쪽 달이 모자란다(계수 4-1): 원본은 신고월 최근 24개월뿐이고 2년 계약은 만기 24~27개월 전에 신고된다. 그래서 창의 첫 석 달은
 * 늘 일부만 잡힌다 - 창이 한 달 밀리면 슬롯도 같이 밀린다. 그 달들은 `partial` 로 표시하고, 잡힌 몫(capture)을 원본에서 추정해 적는다.
 * 추정: 창 끝 석 달(첫 신고월에서 33개월 넘게 떨어져 긴 계약도 다 잡히는 달)의 「만기월 − 신고월」 분포에서, 그 셋이 모두 볼 수 있는
 * 구간(LAG_LO~LAG_HI) 안의 계약 가운데 각 partial 달의 한계(만기월 − 첫 신고월) 이하인 몫. 짧은 계약은 앞쪽 달에도 다 잡히므로 실제 몫은 이보다 조금 크다.
 *
 * 문턱은 새로 정하지 않는다: 칸 값을 낼지는 hasEnoughSample(realestate-format.ts, n≥5) 한 곳이 정한다. 못 넘은 칸은 null.
 * 공개는 구×달 건수뿐이고 건별·단지 단위 값은 싣지 않는다. 쓰는 곳은 docs/data/lease-expiry.json 하나다(build-renewal-facts.ts).
 */
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasEnoughSample } from "./realestate-format.ts";

/** 달력 길이(달). */
export const EXPIRY_MONTHS = 12;
/** 「일부만 집계」로 표시하는 창 앞쪽 달 수(계수 4-1: 11월 30%·12월 57%·1월 84%, 2월부터 97% 이상). */
export const PARTIAL_MONTHS = 3;
/** 잡힌 몫 추정에 쓰는 「만기월 − 신고월」 공통 구간(창 끝 석 달이 모두 끝까지 볼 수 있는 범위). */
export const LAG_LO = 12;
export const LAG_HI = 33;

const TERM = /^(?:(\d{2})\.(\d{2}))?~(\d{2})\.(\d{2})$/;

const idx = (yyyymm) => Number(yyyymm.slice(0, 4)) * 12 + Number(yyyymm.slice(4, 6)) - 1;
const ymOf = (i) => `${Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, "0")}`;

/** contractTerm → 만기월 `YYYYMM`. 형식 밖·달 범위 밖·끝 ≤ 시작이면 null. */
export function expiryMonth(term) {
  const m = TERM.exec(String(term ?? "").trim());
  if (!m) return null;
  const [, sy, sm, ey, em] = m;
  if (+em < 1 || +em > 12 || (sm && (+sm < 1 || +sm > 12))) return null;
  const end = `20${ey}${em}`;
  if (sy && idx(end) <= idx(`20${sy}${sm}`)) return null;
  return end;
}

const rentOf = (item) => {
  const text = String(item?.monthlyRent ?? "").replace(/,/g, "").trim();
  return /^\d+$/.test(text) ? Number(text) : 0;
};
const usedRight = (item) => String(item?.useRRRight ?? "").trim() === "사용";

const keep = (n) => (hasEnoughSample({ transactionCount: n }) ? n : null);

/**
 * 자치구 → 신고월 → 신고 목록(그 달 파일이 없거나 ok:false 면 null) 에서 산출물을 만든다. 순수 함수.
 * filed 는 오름차순 신고월(원본 창), 창은 마지막 신고월 다음 달부터 EXPIRY_MONTHS 개월이다.
 */
export function buildLeaseExpiry({ byDistrict, filed, now }) {
  const start = idx(filed.at(-1)) + 1;
  const months = Array.from({ length: EXPIRY_MONTHS }, (_, i) => ymOf(start + i));
  const first = idx(filed[0]);
  const blank = () => ({ t: Array(EXPIRY_MONTHS).fill(0), j: Array(EXPIRY_MONTHS).fill(0), w: Array(EXPIRY_MONTHS).fill(0), u: Array(EXPIRY_MONTHS).fill(0) });
  const seoul = blank();
  const seoulMissing = new Set<string>();
  const lags = new Map<number, number>();
  const districts: Record<string, any> = {};

  for (const [name, byMonth] of Object.entries(byDistrict ?? {})) {
    const c = blank();
    const missing = [];
    for (const m of filed) {
      const items = (byMonth as any)?.[m];
      if (!Array.isArray(items)) {
        missing.push(m);
        seoulMissing.add(m);
        continue;
      }
      for (const item of items) {
        const e = expiryMonth(item?.contractTerm);
        if (!e) continue;
        const k = idx(e) - start;
        // 잡힌 몫 추정용 - 창 끝 석 달의 만기만
        if (k >= EXPIRY_MONTHS - 3 && k < EXPIRY_MONTHS) {
          const lag = idx(e) - idx(m);
          lags.set(lag, (lags.get(lag) ?? 0) + 1);
        }
        if (k < 0 || k >= EXPIRY_MONTHS) continue;
        for (const s of [c, seoul]) {
          s.t[k] += 1;
          s[rentOf(item) > 0 ? "w" : "j"][k] += 1;
          if (usedRight(item)) s.u[k] += 1;
        }
      }
    }
    districts[name] = { ...pack(c), ...(missing.length ? { missing } : {}) };
  }

  let base = 0;
  for (const [lag, n] of lags) if (lag >= LAG_LO && lag <= LAG_HI) base += n;
  const capture = months.slice(0, PARTIAL_MONTHS).map((m) => {
    const limit = idx(m) - first;
    let got = 0;
    for (const [lag, n] of lags) if (lag >= LAG_LO && lag <= Math.min(limit, LAG_HI)) got += n;
    return base ? Math.round((got / base) * 100) : null;
  });

  return {
    updatedAt: now.toISOString(),
    months,
    filed: [filed[0], filed.at(-1)],
    partial: months.slice(0, PARTIAL_MONTHS),
    capture,
    seoul: { ...pack(seoul), ...(seoulMissing.size ? { missing: [...seoulMissing].sort() } : {}) },
    districts,
  };
}

const pack = (c) => ({ t: c.t.map(keep), j: c.j.map(keep), w: c.w.map(keep), u: c.u.map(keep) });

/** 임시 파일에 쓰고 같은 폴더에서 이름을 바꾼다(rent-flow 와 같은 모양) - 반쪽 파일이 남지 않고, 실패하면 이전 파일이 그대로다. */
export async function writeLeaseExpiryFile(file, payload) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(payload));
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
