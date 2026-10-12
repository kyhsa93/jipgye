// Lighthouse 결과(LHR)를 기준선 표로 접는 순수 함수(#274 범위 3, S7). 실행은 bin/lighthouse.mjs가 한다.
// Lighthouse는 이 폴더의 의존이 아니다 — 버전을 못 박아 npx로 부른다(락파일·package.json 불변).

/** 기준선을 잰 판(#274 본문). 판이 다르면 점수 산식이 달라 앞뒤를 견줄 수 없다 — 올릴 때는 기준선을 다시 잰다. */
export const LIGHTHOUSE_VERSION = "12.8.2";

/**
 * 측정 중 막는 바깥 주소. analytics.js가 부르는 GA·애드센스 로더와 첫 화면의 환율 API다.
 * 막는 이유: 측정이 실제 GA 속성에 조회를 쌓으면 안 되고(#247 관찰 중), 우리 변경과 무관한 바깥 응답 시간이 점수를 흔든다.
 * 그래서 이 숫자는 "우리가 내보낸 것"의 성능이고 광고·분석 스크립트를 실은 실제 방문의 성능이 아니다.
 */
export const BLOCKED_URL_PATTERNS = ["*googletagmanager.com*", "*google-analytics.com*", "*googlesyndication.com*", "*doubleclick.net*", "*exchangerate.fun*"];

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** LHR 한 개에서 표에 쓰는 값만 뽑는다. 점수는 0~100, 시간은 ms, 바이트는 B. 없는 값은 null. */
export function summarizeLhr(lhr) {
  const score = (id) => (lhr.categories?.[id]?.score == null ? null : Math.round(lhr.categories[id].score * 100));
  const audit = (id) => lhr.audits?.[id]?.numericValue ?? null;
  return {
    performance: score("performance"),
    accessibility: score("accessibility"),
    seo: score("seo"),
    fcp: audit("first-contentful-paint"),
    lcp: audit("largest-contentful-paint"),
    tbt: audit("total-blocking-time"),
    cls: audit("cumulative-layout-shift"),
    speedIndex: audit("speed-index"),
    bytes: audit("total-byte-weight"),
  };
}

/** 같은 장을 여러 번 잰 요약들의 지표별 중앙값. 지표마다 따로 중앙값을 낸다(한 실행을 고르는 것이 아니다). */
export function medianSummary(runs) {
  const out = {};
  for (const key of Object.keys(runs[0] ?? {})) {
    const vals = runs.map((r) => r[key]).filter((v) => v !== null);
    out[key] = vals.length ? median(vals) : null;
  }
  return out;
}

const ms = (v) => (v === null ? "—" : `${Math.round(v).toLocaleString("en-US")}ms`);
const fixed = (v, n) => (v === null ? "—" : v.toFixed(n));

/** rows: [{ page, note?, runs, median }] → 마크다운 표. */
export function formatLighthouseTable(rows) {
  const lines = ["| 장 | 구분 | 횟수 | 성능 | 접근성 | SEO | FCP | LCP | TBT | CLS | Speed Index | 총 바이트 |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const r of rows) {
    const m = r.median;
    lines.push(`| ${r.page} | ${r.note ?? ""} | ${r.runs} | ${m.performance ?? "—"} | ${m.accessibility ?? "—"} | ${m.seo ?? "—"} | ${ms(m.fcp)} | ${ms(m.lcp)} | ${ms(m.tbt)} | ${fixed(m.cls, 3)} | ${ms(m.speedIndex)} | ${m.bytes === null ? "—" : Math.round(m.bytes).toLocaleString("en-US")} |`);
  }
  return lines.join("\n");
}
