/**
 * 건축HUB 첫 실측 B1~B4 (#133, #58 단계 B). 정의는 research/housing-permits/PREREG.md 4절을 그대로 옮겼고
 * 이 파일에서 바꾼 것은 없다 - 문턱·창·판정 규칙을 고치려면 PREREG부터 바꿔야 한다(첫 실호출 뒤에는 바꾸지 않는다).
 *
 *   node scripts/housing-permits-measure.mjs [--folded research/housing-permits/folded.json]
 *     [--ecos raw/indicators/series.json] [--limit 5000] [--out research/housing-permits/measure.json]
 *
 * 입력은 합침을 거친 folded.json(저장소에 올라가는 것)과 저장소의 ECOS 계열 파일(permits_seoul = 901Y105 SEO의
 * 해마다 1월부터 쌓인 누계)이다. 네트워크는 쓰지 않는다. B1·B2는 통과/불통과(불가)/보류를 낸다 - 판정은 사람이
 * 이 출력을 #58에 옮겨 적는다. 이 스크립트는 판정을 바꿀 수 있는 입력(ECOS 항목명 등)을 추측하지 않는다.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DISTRICTS } from "./realestate-districts.mjs";
import { monthlyFromYtd } from "./indicator-candidates-3.mjs";
import { DAILY_LIMIT, SERIES } from "./housing-permits-spec.mjs";

/** PREREG B1: 시작은 이 달 이하(2012-12 이전 포함), 길이는 150개월 이상. 150 = 90 + 60 (PREREG 산식표). */
export const B1_START_MAX = "2012-12";
export const B1_MIN_MONTHS = 150;
/** PREREG B2: 12개월 창 상대 차이 중앙값 10% 이하, 창 12개 미만이면 보류. 10%는 pm 확정(출처 P). */
export const B2_MAX_MEDIAN = 0.1;
export const B2_MIN_WINDOWS = 12;
/** PREREG B4: 명세에 입력 시점 필드가 없을 때의 고정 지연 하한(개월), P90 분위. */
export const B4_FLOOR_MONTHS = 3;
export const B4_QUANTILE = 0.9;

const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** 한 계열의 서울 달별 호수(공개 구 + 기타 구 모두 합). Map("YYYY-MM" -> 호수). */
export function seoulMonthly(seriesOne) {
  const out = new Map();
  for (const months of Object.values(seriesOne ?? {})) {
    for (const [month, cell] of Object.entries(months)) out.set(month, (out.get(month) ?? 0) + cell.units);
  }
  return out;
}

export function measureB1(folded) {
  const expected = DISTRICTS.map((d) => d.code);
  const got = new Set(folded.meta?.districtsWithData ?? []);
  const missing = expected.filter((c) => !got.has(c));
  const reasons = [];
  if (missing.length) reasons.push(`응답이 없는 구 ${missing.length}곳`);
  // complete 필드가 아직 정해지지 않았으면(meta.completeField 없음) 그 계열은 길이를 따지지 않고 '대기'로 보고한다 -
  // 해소 규칙(PREREG 「complete 필드 해소 규칙」)이 전수 진단에서 정하기 전이라 시험 불가로도 통과로도 쓰지 않는다.
  const pending = folded.meta?.completeField ? [] : ["complete"];
  const series = {};
  for (const name of SERIES) {
    if (pending.includes(name)) { series[name] = { start: null, end: null, months: 0, gaps: 0, pending: true }; continue; }
    const months = [...seoulMonthly(folded.series?.[name]).keys()].sort();
    if (months.length === 0) { series[name] = { start: null, end: null, months: 0, gaps: 0 }; reasons.push(`${name} 계열이 비었다`); continue; }
    const span = monthIndex(months.at(-1)) - monthIndex(months[0]) + 1;
    series[name] = { start: months[0], end: months.at(-1), months: span, gaps: span - months.length };
    if (months[0] > B1_START_MAX) reasons.push(`${name} 시작 ${months[0]}이 ${B1_START_MAX}보다 늦다`);
    if (span < B1_MIN_MONTHS) reasons.push(`${name} 길이 ${span}개월이 ${B1_MIN_MONTHS}개월 미만`);
  }
  if (pending.length) reasons.push(`${pending.join("·")} 필드 미정 - 해소 규칙이 정하기 전이라 시험 불가 대기(후보 ② 포함)`);
  // 확정된 시험 불가 사유가 있으면 unable, 사유가 대기뿐이면 pending, 없으면 pass.
  const blocked = reasons.length > pending.length;
  return {
    verdict: blocked ? "unable" : pending.length ? "pending" : "pass",
    districts: { expected: expected.length, withData: expected.length - missing.length, missing },
    series, pending, reasons,
  };
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** 두 월별 Map(월 색인 -> 값)이 모두 덮는 12개월 창(끝 달 기준)마다 |hub-eco|/eco. */
function windowDiffs(hub, eco) {
  const diffs = [];
  for (const end of hub.keys()) {
    let h = 0; let e = 0; let ok = true;
    for (let k = 0; k < 12; k += 1) {
      if (!hub.has(end - k) || !eco.has(end - k)) { ok = false; break; }
      h += hub.get(end - k); e += eco.get(end - k);
    }
    if (ok && e > 0) diffs.push(Math.abs(h - e) / e);
  }
  return diffs;
}

/**
 * B2. permit 계열 하나만 ECOS 901Y105와 대응한다 - 착공·준공 집계는 B2로 검증되지 않는다.
 * 응답에서 취소를 구분할 수 없어(PREREG 4절 B2·5절 「취소 판정」) 값은 하나뿐이다: 취소 미반영 permit 계열 서울 합계의
 * 12개월 합. 판정은 그 값으로 하고 취소를 뺀 값과 나란히 적는 일은 하지 않는다.
 */
export function measureB2(folded, ecosRows) {
  const hub = new Map([...seoulMonthly(folded.series?.permit)].map(([m, v]) => [monthIndex(m), v]));
  const eco = monthlyFromYtd(ecosRows);
  const diffs = windowDiffs(hub, eco);
  const windows = diffs.length;
  let verdict = "hold";
  if (windows >= B2_MIN_WINDOWS) verdict = median(diffs) <= B2_MAX_MEDIAN ? "pass" : "fail";
  return {
    verdict,
    windows,
    median: windows ? median(diffs) : null,
    threshold: B2_MAX_MEDIAN,
    // 10%를 넘으면 선을 올려 통과시키지 않고 중단해 원인을 적는다(PREREG 4절 B2). 원인 후보만 미리 박아 둔다.
    ...(verdict === "fail" ? { causeCandidates: ["정의 차이", "누락", "취소 미반영"] } : {}),
    note: "permit(건축허가일 기준 인허가) 계열만 대조. 착공·준공 집계는 B2로 검증되지 않는다. 취소 미반영 단일 값으로 판정(응답에서 취소를 구분할 수 없음).",
  };
}

/** B3. 보고만 한다 - 합격 판정에 쓰지 않는다. */
export function measureB3(meta, limit = DAILY_LIMIT) {
  const calls = Number(meta.calls);
  return { calls, pages: Number(meta.pages), dongs: Number(meta.dongs), limit, pctOfLimit: Math.round((calls / limit) * 1000) / 10 };
}

/**
 * B4. 입력 시점 필드를 지정해 수집했으면(meta.inputLag) 규칙 3: n = max(3, ceil(P90(분포)))이고,
 * 아니면 규칙 2: n = 3. 응답 필드 이름 목록을 같이 내 사람이 "최초 입력·등록 시점" 필드가 있는지 본다
 * (모호하면 규칙 2 - PREREG 4번). P90은 가장 가까운 순위(올림) 방식이다.
 */
export function measureB4(meta) {
  const base = { responseFields: meta.responseFields ?? [] };
  const lag = meta.inputLag;
  if (!lag) return { ...base, rule: 2, n: B4_FLOOR_MONTHS };
  const keys = Object.keys(lag.histogram).map(Number).sort((a, b) => a - b);
  const total = keys.reduce((s, k) => s + lag.histogram[k], 0);
  if (total === 0) return { ...base, rule: 2, n: B4_FLOOR_MONTHS, note: "분포가 비어 규칙 2로 간다" };
  const rank = Math.ceil(B4_QUANTILE * total);
  let cum = 0;
  let p90 = keys.at(-1);
  for (const k of keys) { cum += lag.histogram[k]; if (cum >= rank) { p90 = k; break; } }
  return { ...base, rule: 3, field: lag.field, p90, n: Math.max(B4_FLOOR_MONTHS, Math.ceil(p90)), unparsed: lag.unparsed };
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      folded: { type: "string", default: "research/housing-permits/folded.json" },
      ecos: { type: "string", default: "raw/indicators/series.json" },
      limit: { type: "string", default: String(DAILY_LIMIT) },
      out: { type: "string", default: "research/housing-permits/measure.json" },
    },
  });
  const folded = JSON.parse(await readFile(v.folded, "utf8"));
  const ecos = JSON.parse(await readFile(v.ecos, "utf8"));
  const rows = ecos?.series?.permits_seoul;
  if (!Array.isArray(rows)) throw new Error("ECOS 파일에 series.permits_seoul(901Y105 SEO)이 없다");
  const report = {
    measuredFrom: { rawSha256: folded.meta.rawSha256, updatedAt: folded.meta.updatedAt },
    B1: measureB1(folded), B2: measureB2(folded, rows), B3: measureB3(folded.meta, Number(v.limit)), B4: measureB4(folded.meta),
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  await writeFile(v.out, `${text}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => { console.error(`[housing-permits-measure] ${err.message}`); process.exitCode = 1; });
}
