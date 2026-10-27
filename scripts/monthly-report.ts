/**
 * 월간 집계 리포트 「집계 월간: 서울 아파트 실거래 YYYY-MM」 산출 (#771, ceo 라운드 2026-10-27).
 *
 * 저장소의 docs/data/*.json(사이트가 그날 낸 값)만 읽어 Markdown 1부와 표별 CSV 를 임시 폴더에 만든다. 커밋하지 않는다 -
 * 올리는 것은 .github/workflows/monthly-report.yml 이다(GitHub Release `monthly-report-YYYY-MM`). 새 수집·새 셈은 없다.
 *
 * - 숫자는 JSON 값 그대로다. 창·문턱을 리포트용으로 다시 계산하지 않는다(E5 pm·cdo 결정, #771) - 다시 계산하면 사이트와 리포트의
 *   같은 달 같은 지표가 두 숫자가 된다(DIRECTION 체크리스트 10). 그래서 표마다 창이 다르고, 표 머리에 「비교 구간 …(n·문턱)」을 JSON 필드로 찍는다.
 * - 단위는 서울 전체·자치구·가격대·연식·면적대·권역이다. 행·단지 단위 값은 없다(입력 JSON 자체가 집계값이고, 단지 카드 JSON 은 읽지 않는다).
 * - n<3 인 칸은 비운다(MIN_CELL). 사이트 문턱(minCells 30·minDeals 100 등)에 걸려 JSON 이 null 로 낸 칸도 그대로 비운다.
 * - 표5 월 실부담(monthly-cost.json)은 ECOS 이용허락 확인 전까지 싣지 않는다(#771 본문) - 이 파일은 그 JSON 을 읽지 않고 번호만 비워 둔다.
 *   conversion.json 의 대출·예금 금리(ECOS) 필드도 같은 이유로 싣지 않는다.
 * - 7절은 「3개월 전망 채점 기록(C5)」: 등록 전망·구간·drift 추가일만 싣고 "vs 실측" 열은 없다(target 월 공식 지수 미발표, E5 researcher).
 *   8절 「범위 적중률(C6) 예고」는 숫자 없이 방법·건수만이다(PREREG v3, 첫 숫자는 빨라도 2027-01).
 * - 출처 문구는 scripts/source-lines.ts 의 ATTRIBUTION.monthlyReport 한 곳이다 - 이 파일에 출처 머리 글자를 적지 않는다(test/source-lines.test.mjs).
 * - 결정성: 같은 입력이면 같은 출력. 시계(Date.now)·파일 순서에 기대지 않고, 자치구 순서는 DISTRICTS 다. 호 번호(YYYY-MM)는
 *   week-digest.json 의 asOf(관측 시각 기준 이달, pm 결정)에서 오고 MONTHLY_REPORT_MONTH 로 덮어쓸 수 있다.
 *
 * 쓰는 법(저장소 루트): MONTHLY_REPORT_OUT_DIR=/tmp/x node scripts/monthly-report.ts
 *   선택: MONTHLY_REPORT_DATA_DIR(기본 docs/data), MONTHLY_REPORT_MONTH(YYYY-MM)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MIN_CELLS as FLOOR_MIN_CELLS } from "./floor-gap.ts";
import { REGIONS } from "./outlook.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { TREND_MIN_SAMPLE } from "./realestate-weekly.ts";
import { ATTRIBUTION } from "./source-lines.ts";

const root = path.resolve(import.meta.dirname, "..");
export const DEFAULT_DATA_DIR = path.join(root, "docs/data");

/** 칸의 표본이 이보다 적으면 값을 비운다(#771 본문 "n<3 비공개", PREREG 1절과 같은 문턱). */
export const MIN_CELL = 3;
export const TAG_PREFIX = "monthly-report-";
export const TITLE_PREFIX = "집계 월간: 서울 아파트 실거래";
export const ATTRIBUTION_LINE = ATTRIBUTION.monthlyReport.ko;
/** 문의 안내 한 줄(#771 본문·method.html 과 같은 뜻). Release 제목·본문·method.html 에 들어간다. */
export const CONTACT_LINE = "문의는 GitHub Discussions(https://github.com/kyhsa93/jipgye/discussions)로 — 공개 글이니 연락처는 쓰지 말고 소속·용도만 적어 주세요.";

/** 읽는 입력 파일. 표5(monthly-cost.json)는 여기 없다 - 추가하려면 ECOS 이용허락 확인(clo)이 먼저다. */
export const INPUT_FILES = [
  "week-digest.json",
  "realestate-trend.json",
  "segment-change.json",
  "conversion.json",
  "rent-flow.json",
  "cancellation.json",
  "registration.json",
  "direct-deals.json",
  "floor-gap.json",
  "record-high.json",
  "outlook-log.json",
] as const;

type Inputs = Record<(typeof INPUT_FILES)[number], any>;

export async function loadInputs(dataDir = DEFAULT_DATA_DIR): Promise<Inputs> {
  const out: Partial<Inputs> = {};
  for (const name of INPUT_FILES) {
    try {
      out[name] = JSON.parse(await readFile(path.join(dataDir, name), "utf8"));
    } catch (err) {
      throw new Error(`입력을 읽지 못했다: ${path.join(dataDir, name)} (${err.message})`);
    }
  }
  return out as Inputs;
}

// ---- 칸·표 모형 -------------------------------------------------------------------------------------------------------
// 칸은 값과 그 값의 표본 n 을 함께 든다. 비우는 판단(n<MIN_CELL, null)은 렌더 한 곳(cellText)에서만 한다 - 시험이 모형을 보고 비움을 확인한다.

/** min: 그 표의 사이트 문턱(JSON·사이트 상수 그대로). MIN_CELL 보다 크면 그 값으로 비운다. */
export type Cell = { v: number | string | null | undefined; n: number | null; min?: number };
export type Table = {
  id: number;
  title: string;
  /** 「비교 구간 …(n·문턱)」 - JSON 필드 그대로. */
  window: string;
  notes: string[];
  columns: string[];
  rows: Cell[][];
};

/** 값 칸: n 이 MIN_CELL 미만이거나 값이 없으면 비운다. n 을 주지 않으면 값 자체가 건수라서 그 건수를 n 으로 본다. */
export const cell = (v: Cell["v"], n?: number | null, min?: number): Cell => ({ v, n: n === undefined ? (typeof v === "number" ? v : null) : n, ...(min ? { min } : {}) });
/** 이름·날짜 같은 글자 칸: 비우지 않는다. */
export const label = (v: string | number): Cell => ({ v: String(v), n: Number.POSITIVE_INFINITY });
/** 그 줄에 해당 없는 칸(서울 전체 줄의 면적대 칸 등): 비어 보이지만 「비움」으로 세지 않는다. */
export const na = (): Cell => ({ v: "", n: Number.POSITIVE_INFINITY });
/** 구조상 빈 칸(na·label)이 아닌, 표본·문턱 때문에 비운 칸인가. */
export const isSuppressed = (c: Cell) => isBlank(c) && c.n !== Number.POSITIVE_INFINITY;

export function isBlank(c: Cell) {
  if (c.v === null || c.v === undefined || c.v === "") return true;
  return c.n === null || c.n === undefined || !(c.n >= Math.max(MIN_CELL, c.min ?? 0));
}

const group = (n: number) => {
  const [int, frac] = String(n).split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${frac ? `.${frac}` : ""}`;
};

/** 본문용 글자. CSV 는 자릿수 구분 없이 낸다(csv=true) - 숫자 열이 숫자로 읽히게. */
export function cellText(c: Cell, csv = false) {
  if (isBlank(c)) return "";
  return typeof c.v === "number" ? (csv ? String(c.v) : group(c.v)) : String(c.v);
}

const ym = (s: string) => (/^\d{6}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : s);
const span = (a: string, b: string) => `${ym(a)}~${ym(b)}`;
const first = (xs: readonly string[]) => xs[0];
const last = (xs: readonly string[]) => xs[xs.length - 1];
const tableCsvName = (tag: string, t: Table) => `${tag}-table-${String(t.id).padStart(2, "0")}.csv`;

// ---- 표 ------------------------------------------------------------------------------------------------------------

/** 1절 표1. 이달 신고 흐름 - week-digest.json 의 이전 주·이번 주(관측 시각 축). comparable:false·gaps 를 그대로 적는다. */
function tableWeekFlow(w: any): Table {
  const cur = w.current;
  const prev = w.previous;
  const pair = (k: string) => [cell(prev[k]), cell(cur[k])];
  const rows: Cell[][] = [
    [label("매매 신고 도착(건)"), ...pair("sale")],
    [label("전세 신고 도착(건)"), ...pair("jeonse")],
    [label("월세 신고 도착(건)"), ...pair("wolse")],
    [label("해제 표시 도착(건)"), ...pair("cancelArrived")],
    [label("해제일이 그 주인 해제(건)"), ...pair("cancelDated")],
    [label("직거래 도착(건)"), ...pair("direct")],
    [label("직거래 비중(%)"), cell(prev.directShare, prev.sale), cell(cur.directShare, cur.sale)],
    [label("신고가 판정 대상(건)"), ...pair("judged")],
    [label("그 가운데 신고가(건)"), ...pair("records")],
  ];
  const months = [...new Set([...Object.keys(prev.months?.sale ?? {}), ...Object.keys(cur.months?.sale ?? {}), ...Object.keys(prev.months?.rent ?? {}), ...Object.keys(cur.months?.rent ?? {})])].sort();
  for (const m of months) {
    rows.push([label(`계약월 ${ym(m)} 매매 도착(건)`), cell(prev.months?.sale?.[m] ?? null), cell(cur.months?.sale?.[m] ?? null)]);
    rows.push([label(`계약월 ${ym(m)} 전월세 도착(건)`), cell(prev.months?.rent?.[m] ?? null), cell(cur.months?.rent?.[m] ?? null)]);
  }
  return {
    id: 1,
    title: "이달 신고 흐름(관측 시각 축)",
    window: `비교 구간 ${prev.from}~${prev.to} vs ${cur.from}~${cur.to}(관측 축 trackedFrom ${w.trackedFrom} · basis ${w.basis} · comparable ${w.comparable} · 문턱 없음, n<${MIN_CELL} 비움)`,
    notes: [
      `관측 시각 축이다 - 그 주에 우리 수집에 처음 도착한 신고를 센 것이고 계약일·신고일 축이 아니다. 두 주의 수집 구멍: ${w.gaps?.length ? w.gaps.join(", ") : "없음"}.`,
      `comparable=${w.comparable}: 관측은 ${w.trackedFrom}부터라 앞선 해와 견줄 수 없고, 두 주 차이도 수집 시각에 좌우된다.`,
    ],
    columns: ["항목", `이전 주 ${prev.from}~${prev.to}`, `이번 주 ${cur.from}~${cur.to}`],
    rows,
  };
}

/** 2절 표2. 자치구 가격 수준 - realestate-trend.json 의 첫 주와 마감 주(4주 이동값). 변화율은 계산하지 않고 두 시점 값과 n 만 싣는다. */
function tableDistrictLevel(t: any): Table {
  const w0 = first(t.weeks);
  const w1 = t.settledWeek;
  // 평균값은 사이트 추이 그래프와 같은 문턱(TREND_MIN_SAMPLE)으로 비우고, 건수(n)는 그대로 낸다.
  const avg = (v: any, n: any) => cell(v, n, TREND_MIN_SAMPLE);
  const row = (name: string, series: any): Cell[] => {
    const a = series?.[w0] ?? {};
    const b = series?.[w1] ?? {};
    return [
      label(name),
      avg(a.sale?.avgPricePerPyeong10k, a.sale?.transactionCount),
      cell(a.sale?.transactionCount),
      avg(b.sale?.avgPricePerPyeong10k, b.sale?.transactionCount),
      cell(b.sale?.transactionCount),
      avg(b.sale?.national84?.avgPricePerPyeong10k, b.sale?.national84?.transactionCount),
      cell(b.sale?.national84?.transactionCount),
      avg(b.jeonse?.avgDepositPerPyeong10k, b.jeonse?.transactionCount),
      cell(b.jeonse?.transactionCount),
      avg(b.wolse?.avgDeposit10k, b.wolse?.transactionCount),
      avg(b.wolse?.avgMonthlyRent10k, b.wolse?.transactionCount),
      cell(b.wolse?.transactionCount),
    ];
  };
  const rows = [row("서울", t.overall), ...DISTRICTS.map((d) => row(d.name, t.districts?.[d.name]))];
  return {
    id: 2,
    title: "자치구 가격 수준(주 단위 4주 이동값)",
    window: `비교 구간 ${w0}~${w1}(${t.weeks.length}주 · ${t.movingWeeks}주 이동 · 마감 주 ${w1} · 대기 ${t.pendingWeeks.length}주 제외 · 문턱 TREND_MIN_SAMPLE ${TREND_MIN_SAMPLE}, n<${MIN_CELL} 비움)`,
    notes: [
      `값은 그 주까지 ${t.movingWeeks}주의 신고를 겹쳐 낸 평당(3.3㎡) 평균(만원)이다. 두 시점은 수준이지 변화율이 아니며, 구성(신고된 단지·면적)이 달라 두 값의 차이를 가격 변동으로 읽지 말 것.`,
      `대기 주 ${t.pendingWeeks.join(", ")}는 신고 기한(계약 후 30일)이 닫히지 않아 싣지 않는다.`,
    ],
    columns: ["구", `매매 평당 ${w0}`, "n", `매매 평당 ${w1}`, "n", `국민평형(84㎡) 평당 ${w1}`, "n", `전세 평당 ${w1}`, "n", `월세 보증금(만원) ${w1}`, `월세(만원) ${w1}`, "n"],
    rows,
  };
}

/** 3절 표3. 세그먼트 12개월 변화 - segment-change.json. 부트스트랩 90% 구간을 함께 싣는다. */
function tableSegment(s: any): Table {
  const rows: Cell[][] = [];
  for (const [kind, list] of [["가격대", s.price], ["연식", s.age], ["면적대", s.area]] as const) {
    for (const r of list) rows.push([label(kind), label(r.ko), cell(r.cells), cell(r.change, r.cells), cell(r.low, r.cells), cell(r.high, r.cells)]);
  }
  return {
    id: 3,
    title: "세그먼트 12개월 변화(같은 단지 같은 평형 칸)",
    window: `비교 구간 ${span(first(s.periods.base), last(s.periods.base))} vs ${span(first(s.periods.recent), last(s.periods.recent))}(칸 ${group(s.cells)} · 문턱 minCells ${s.minCells} · 연식 기준연도 ${s.ageRefYear}, n<${MIN_CELL} 비움)`,
    notes: [
      "같은 단지 같은 면적 묶음(칸)에서 두 구간의 중앙값 변화를 센 것이다. 구간은 부트스트랩 90% 구간이고 칸이 minCells 미만이면 사이트가 값을 내지 않는다(이 입력에서 그런 줄은 없다).",
      `칸 수 격자(가격대×연식): ${Object.entries(s.grid?.rows ?? {}).map(([k, v]: [string, any]) => `${s.price.find((p: any) => p.key === k)?.ko ?? k} ${(v as number[]).join("/")}`).join(" · ")} (연식 ${s.grid?.ages?.map((a: string) => s.age.find((x: any) => x.key === a)?.ko ?? a).join("/")}).`,
    ],
    columns: ["축", "구간", "칸", "변화(%)", "90% 하한", "90% 상한"],
    rows,
  };
}

/** 4절 표4. 전월세전환율 - conversion.json 의 서울·자치구×면적대 칸(rate, pairs). 대출·예금 금리(ECOS)는 싣지 않는다. */
function tableConversion(c: any): Table {
  const bands: any[] = c.bands;
  const byKey = new Map<string, any>();
  for (const x of c.cells) byKey.set(`${x.district}|${x.band}`, x);
  const row = (name: string, get: (b: any) => any): Cell[] => {
    const out: Cell[] = [label(name)];
    for (const b of bands) {
      const x = get(b);
      out.push(cell(x?.rate, x?.pairs), cell(x?.pairs));
    }
    return out;
  };
  const rows = [
    [label("서울(전체)"), cell(c.seoul.rate, c.seoul.pairs), cell(c.seoul.pairs), ...bands.slice(1).flatMap(() => [na(), na()])],
    ...DISTRICTS.map((d) => row(d.name, (b) => byKey.get(`${d.name}|${b.key}`))),
  ];
  return {
    id: 4,
    title: "전월세전환율(같은 단지 신규 전세·월세 조합)",
    window: `비교 구간 ${span(first(c.months), last(c.months))}(조합 ${group(c.seoul.pairs)} · 월별 추이 문턱 minPairs ${c.series.minPairs} · 칸 n<${MIN_CELL} 비움)`,
    notes: [
      "같은 단지에서 전세와 월세가 함께 신고된 조합으로 낸 전환율(%)이다. 서울 줄은 전체 한 값이라 면적대 칸은 비어 있다. 대출·예금 평균금리와 그것으로 계산한 월 실부담은 이 호에 싣지 않는다(표5 참조).",
    ],
    columns: ["구", ...bands.flatMap((b) => [`${b.label} 전환율(%)`, "조합 n"])],
    rows,
  };
}

/** 4절 표6. 전세→월세 흐름 - rent-flow.json 의 두 구간 비교(서울·자치구). */
function tableRentFlow(r: any): Table {
  const row = (name: string, d: any): Cell[] => {
    const b = d?.compare?.base ?? {};
    const c = d?.compare?.recent ?? {};
    return [
      label(name),
      cell(b.n),
      cell(b.wolseShare, b.n),
      cell(b.jn),
      cell(b.jmed, b.jn),
      cell(b.toWolseShare, b.fromJeonse),
      cell(c.n),
      cell(c.wolseShare, c.n),
      cell(c.jn),
      cell(c.jmed, c.jn),
      cell(c.toWolseShare, c.fromJeonse),
      cell(d?.renewals?.toWolseShare, d?.renewals?.fromJeonse),
    ];
  };
  const rows = [row("서울", r.seoul), ...DISTRICTS.map((d) => row(d.name, r.districts?.[d.name]))];
  const base = r.compare.base;
  const recent = r.compare.recent;
  return {
    id: 6,
    title: "전세→월세 흐름(신규 계약의 월세 비중과 전세 갱신의 월세 전환)",
    window: `비교 구간 ${span(first(base), last(base))} vs ${span(first(recent), last(recent))}(마감 구간 ${span(r.closedSpan[0], r.closedSpan[1])} · 미마감 ${r.partial.map(ym).join(", ")} 제외 · 문턱 없음, n<${MIN_CELL} 비움)`,
    notes: ["월세 비중(%)은 그 구간 신규 전월세 신고 가운데 월세의 몫, 전세 보증금 중앙(만원)은 신규 전세의 중앙값, 월세 전환(%)은 전세 갱신 가운데 월세로 바꾼 몫이다. 마지막 열은 마감 구간 전체의 전세 갱신 기준이다."],
    columns: ["구", "기준 n", "기준 월세 비중(%)", "기준 전세 n", "기준 전세 보증금 중앙", "기준 전세 갱신→월세(%)", "최근 n", "최근 월세 비중(%)", "최근 전세 n", "최근 전세 보증금 중앙", "최근 전세 갱신→월세(%)", "전체 전세 갱신→월세(%)"],
    rows,
  };
}

/** 5절 표7. 해제·등기 - cancellation.json(자치구)과 registration.json(서울 요약·자치구 등기). 두 파일의 창이 달라 머리에 둘 다 적는다. */
function tableCancellation(c: any, g: any): Table {
  const regBy = new Map<string, any>((g.districts ?? []).map((d: any) => [d.name, d]));
  const row = (name: string, d: any, reg: any): Cell[] => [
    label(name),
    cell(d?.deals),
    cell(d?.cancelled, d?.deals),
    cell(d?.cancelledShare, d?.deals),
    cell(d?.matured),
    cell(d?.stale, d?.matured),
    cell(d?.staleShare, d?.matured),
    cell(reg?.n),
    cell(reg?.registeredShare, reg?.n),
    cell(reg?.medianDays, reg?.n),
    cell(reg?.p90Days, reg?.n),
  ];
  const s = c.seoul;
  const rows = [
    row("서울", { deals: s.deals, cancelled: s.cancelled, cancelledShare: s.cancelledShare, matured: s.registration.matured, stale: s.registration.stale, staleShare: s.registration.staleShare }, g.seoul),
    ...DISTRICTS.map((d) => row(d.name, c.districts.find((x: any) => x.district === d.name), regBy.get(d.name))),
  ];
  const mature = c.seoul.registration.matureMonths;
  return {
    id: 7,
    title: "해제·등기(정정 재신고를 뺀 해제율, 익은 달의 미등기와 등기까지 걸린 날)",
    window: `비교 구간 ${span(first(c.months), last(c.months))}(해제, 신고 ${group(s.deals)}건 · 정정 재신고 ${group(s.correction.corrections)}건 제외) / 익은 달 ${mature[0]}~${mature[mature.length - 1]}(등기, 문턱 minDeals ${g.basis.minDeals} · 익은 달 기준 ${g.basis.matureShare}, n<${MIN_CELL} 비움)`,
    notes: [
      `해제 신고 ${group(s.correction.reported)}건 가운데 같은 계약 기록이 해제 표시 없이 다시 있는 ${group(s.correction.corrections)}건(${s.correction.share}%)은 해제에서 뺐다. 신고 사유는 원천에 없어 기록이 같다는 것까지만 확인한 것이다.`,
      `익은 달 = 그 달 계약의 ${Math.round(g.basis.matureShare * 100)}% 이상이 등기일을 가진 달. 등기율·걸린 날은 익은 달 계약만 센다(생존 편향 보정, DIRECTION 체크리스트 7). 등기는 원천에 등기일자가 기록된 거래로 세며 접수일·완료일 여부는 확인하지 않았다.`,
    ],
    columns: ["구", "신고(건)", "해제(건)", "해제율(%)", "익은 달 계약(건)", "미등기(건)", "미등기(%)", "등기 n", "등기율(%)", "등기까지 중앙(일)", "등기까지 p90(일)"],
    rows,
  };
}

/** 5절 표8. 직거래 - direct-deals.json 의 마감 달 비중과 같은 칸 가격 격차. 문턱 미달 칸은 JSON 이 null 로 낸다. */
function tableDirect(d: any): Table {
  // 마감 달 비중의 n 은 마감 달(partial 아님)의 매매 신고 합이다. 격차 칸의 모든 열은 칸 수(cells)를 n 으로 둔다 - 칸이 모자라면 건수도 같이 비운다.
  const closedDeals = (x: any) => (Array.isArray(x?.deals) ? x.deals.reduce((a: number, b: number, i: number) => (d.partial[i] ? a : a + b), 0) : null);
  const row = (name: string, x: any): Cell[] => [
    label(name),
    cell(x?.closedShare, closedDeals(x)),
    cell(x?.gap?.cells),
    cell(x?.gap?.directDeals, x?.gap?.cells),
    cell(x?.gap?.median, x?.gap?.cells),
    cell(x?.gap?.low, x?.gap?.cells),
    cell(x?.gap?.high, x?.gap?.cells),
    cell(x?.gap?.lowerShare, x?.gap?.cells),
  ];
  const rows = [row("서울", d.seoul), ...DISTRICTS.map((k) => row(k.name, d.districts?.[k.name]))];
  const partial = d.months.filter((_: string, i: number) => d.partial[i]);
  return {
    id: 8,
    title: "직거래(중개 없는 신고)의 비중과 같은 칸 가격 격차",
    window: `비교 구간 ${span(first(d.months), last(d.months))}(미마감 ${partial.map(ym).join(", ")} 제외 · 문턱 minDeals ${d.minDeals} · minCells ${d.minCells}, n<${MIN_CELL} 비움)`,
    notes: ["마감 달 직거래 비중(%)은 신고 기한이 닫힌 달의 매매 신고 가운데 직거래의 몫이다. 격차(%)는 같은 단지 같은 면적 칸에서 직거래가 중개거래 중앙값과 벌어진 중앙값과 그 구간이며, 칸이 minCells 미만이면 사이트가 값을 내지 않는다(비어 있는 구가 그것이다)."],
    columns: ["구", "마감 달 직거래 비중(%)", "격차 칸", "격차 직거래(건)", "격차 중앙(%)", "하한", "상한", "더 싼 칸(%)"],
    rows,
  };
}

/** 6절 표9. 층 격차 - floor-gap.json. 서울 두 줄(1층·최상층, 매매·전세)과 자치구. */
function tableFloor(f: any): Table {
  const seoul = (name: string, x: any): Cell[] => [label(name), cell(x.cells), cell(x.median, x.cells), cell(x.cheaperShare, x.cells), na(), na()];
  const rows: Cell[][] = [
    seoul("서울 매매 1층 vs 3층 이상", f.sale.low),
    seoul("서울 매매 최상층 vs 아래층", f.sale.top),
    seoul("서울 전세 1층 vs 3층 이상", f.jeonse.low),
    seoul("서울 전세 최상층 vs 아래층", f.jeonse.top),
  ];
  for (const d of DISTRICTS) {
    const x = f.districts.find((r: any) => r.district === d.name);
    rows.push([label(`${d.name} 매매 1층`), cell(x?.cells), cell(x?.median, x?.cells), na(), cell(x?.band?.low, x?.cells), cell(x?.band?.high, x?.cells)]);
    rows.push([label(`${d.name} 전세 1층`), cell(x?.jeonse?.cells), cell(x?.jeonse?.median, x?.jeonse?.cells), na(), cell(x?.jeonse?.band?.low, x?.jeonse?.cells), cell(x?.jeonse?.band?.high, x?.jeonse?.cells)]);
  }
  return {
    id: 9,
    title: "층 격차(같은 단지 같은 평형 안에서만 견준 1층·최상층)",
    window: `비교 구간 최근 ${f.months}개월(JSON months ${f.months}, 갱신 ${String(f.updatedAt).slice(0, 10)} · 자치구 문턱 MIN_CELLS ${FLOOR_MIN_CELLS} → JSON null 비움, n<${MIN_CELL} 비움)`,
    notes: [
      "격차(%)는 맞물린 칸들의 중앙값이고, 자치구 구간은 서울과 같은 분포에서 그 칸 수로 나올 수 있는 폭(노이즈 띠)이다. 띠 밖이면 서울과 다르다고 말할 수 있고 띠 안이면 갈라 볼 수 없다 - 순위가 아니다.",
      `서울과 다르다고 말할 수 있는 구(매매): ${f.districts.filter((r: any) => r.distinct).map((r: any) => r.district).join(", ") || "없음"}.`,
    ],
    columns: ["구분", "맞물린 칸", "격차 중앙(%)", "더 싼 칸(%)", "띠 하한", "띠 상한"],
    rows,
  };
}

/** 6절 표10. 신고가 다음 거래 - record-high.json 의 main·robust 12줄·자치구·가격대. 문턱은 JSON 값 그대로(E5 cdo). */
function tableRecordHigh(r: any): Table {
  const main = r.main;
  const robustRow = (x: any, name: string): Cell[] => [
    label(name),
    label(`${x.prior}/${x.span}/${x.wait}`),
    cell(x.records),
    cell(x.withNext),
    cell(x.none, x.records),
    cell(x.record, x.withNext),
    cell(x.all, x.allCount),
    cell(x.near, x.nearCount),
    cell(x.aboveOld, x.withNext),
  ];
  const rows: Cell[][] = [robustRow(main, "서울(본 설정)")];
  for (const x of r.robust) rows.push(robustRow(x, `서울(문턱 흔듦${x.holds ? ", 결론 유지" : ", 결론 달라짐"})`));
  const bd = (x: any, kind: string): Cell[] => [
    label(`${kind} ${x.ko}`),
    label(`${main.prior}/${main.span}/${main.wait}`),
    cell(x.records),
    cell(x.withNext),
    na(),
    cell(x.enough ? x.record : null, x.withNext),
    cell(x.enough ? x.all : null, x.allCount),
    na(),
    na(),
  ];
  for (const x of r.breakdown.districts) rows.push(bd(x, "자치구"));
  for (const x of r.breakdown.bands) rows.push(bd(x, "가격대"));
  return {
    id: 10,
    title: "신고가 다음 거래(90일 안의 다음 거래가 신고가 이상이었던 비율)",
    window: `비교 구간 거래 끝 ${r.end}(거래 ${group(r.deals)}건 · 문턱 prior ${main.prior} · span ${main.span}일 · wait ${main.wait}일 · 자치구·가격대 minWithNext ${r.breakdown.minWithNext}, n<${MIN_CELL} 비움)`,
    notes: [
      "신고가 = 같은 단지 같은 전용면적에서 그 전 거래가 prior 건 이상이고 첫 거래가 span 일 넘게 전인 칸의 그 전 최고가보다 비싼 거래. wait 일 안에 다음 거래가 없는 신고가도 빼지 않고 센다(없음 %). 「아무 거래 뒤」는 같은 질문을 신고가가 아닌 거래에 던진 대조군이다.",
      "자치구·가격대 줄은 다음 거래가 minWithNext 건 미만이면 비운다(이 입력에서는 모두 충족). 자치구 값은 순위가 아니다.",
    ],
    columns: ["구분", "prior/span/wait", "신고가(건)", "다음 거래 있음(건)", "다음 거래 없음(%)", "신고가 이상(%)", "아무 거래 뒤(%)", "거의 최고가 뒤(%)", "그 전 최고가는 넘음(%)"],
    rows,
  };
}

/** 7절 표11. 3개월 전망 채점 기록(C5) - outlook-log.json 의 등록 전망. "vs 실측" 열은 없다(E5 researcher). */
function tableOutlookLog(o: any): Table {
  const regionName = (code: string) => REGIONS.find((r) => r.code === code)?.name.ko ?? code;
  const rows: Cell[][] = o.entries.map((e: any) => [
    label(ym(e.origin)),
    label(regionName(e.region)),
    label(`${e.h}개월`),
    label(ym(e.target)),
    label(e.change),
    label(e.low),
    label(e.high),
    label(e.drift),
    label(e.driftAddedOn),
  ]);
  const origins = [...new Set(o.entries.map((e: any) => ym(e.origin)))].sort();
  const targets = [...new Set(o.entries.map((e: any) => ym(e.target)))].sort();
  return {
    id: 11,
    title: "3개월 전망 채점 기록(C5) - 등록된 전망과 구간",
    window: `비교 구간 등록 ${origins[0]}~${origins[origins.length - 1]} → 목표 ${targets[0]}~${targets[targets.length - 1]}(등록 전망 ${o.entries.length}건 · 그림자 ${o.shadow?.length ?? 0}건 · 문턱 없음 - 전망 값은 표본이 아니라 기록이다)`,
    notes: [
      "한 번 낸 전망은 고치지 않고 쌓는다(DIRECTION 1부). 실측 열은 없다 - 목표 월의 공식 실거래가격지수가 아직 발표되지 않았고, 첫 채점은 그 지수가 나오는 뒤 호다. 값은 공식 지수 변화율(%)과 80% 구간, drift 는 「지금까지의 평균 월 상승률이 이어진다」 기준선이다.",
      ...(o.shadow?.length
        ? [`그림자 기록 ${o.shadow.length}건(화면에 내지 않고 채점만 하는 지표 추가 모형): ${o.shadow.map((s: any) => `${regionName(s.region)} ${ym(s.origin)}→${ym(s.target)} ${s.indicator} 기본 ${s.base} / 추가 ${s.with}`).join("; ")}.`]
        : []),
    ],
    columns: ["등록 월", "권역", "지평", "목표 월", "전망(%)", "80% 하한", "80% 상한", "drift 기준선(%)", "drift 추가일"],
    rows,
  };
}

export function buildTables(i: Inputs): Table[] {
  return [
    tableWeekFlow(i["week-digest.json"]),
    tableDistrictLevel(i["realestate-trend.json"]),
    tableSegment(i["segment-change.json"]),
    tableConversion(i["conversion.json"]),
    tableRentFlow(i["rent-flow.json"]),
    tableCancellation(i["cancellation.json"], i["registration.json"]),
    tableDirect(i["direct-deals.json"]),
    tableFloor(i["floor-gap.json"]),
    tableRecordHigh(i["record-high.json"]),
    tableOutlookLog(i["outlook-log.json"]),
  ];
}

// ---- 렌더 ------------------------------------------------------------------------------------------------------------

export const countSuppressed = (tables: Table[]) => tables.reduce((a, t) => a + t.rows.flat().filter(isSuppressed).length, 0);

export function renderTable(t: Table) {
  const head = `| ${t.columns.join(" | ")} |`;
  const sep = `| ${t.columns.map(() => "---").join(" | ")} |`;
  const body = t.rows.map((r) => `| ${r.map((c) => cellText(c)).join(" | ")} |`);
  return [`#### 표${t.id}. ${t.title}`, "", t.window, "", ...t.notes.map((n) => `- ${n}`), "", head, sep, ...body, "", ATTRIBUTION_LINE, ""].join("\n");
}

const csvEscape = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export function renderCsv(t: Table) {
  const lines = [`# 표${t.id}. ${t.title}`, `# ${t.window}`, t.columns.map(csvEscape).join(","), ...t.rows.map((r) => r.map((c) => csvEscape(cellText(c, true))).join(",")), `# ${ATTRIBUTION_LINE}`];
  return `${lines.join("\n")}\n`;
}

/** 호 번호(YYYY-MM). week-digest.json 의 asOf(KST 날짜)가 이달이다(pm: 관측 시각 기준). 덮어쓰기는 MONTHLY_REPORT_MONTH. */
export function reportMonth(i: Inputs, override?: string) {
  const m = override ?? String(i["week-digest.json"].asOf ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error(`호 번호를 정하지 못했다: ${JSON.stringify(m)} (week-digest.json asOf 또는 MONTHLY_REPORT_MONTH)`);
  return m;
}

export function renderTitle(month: string) {
  return `${TITLE_PREFIX} ${month}`;
}

export function renderBody(i: Inputs, { month, tag }: { month: string; tag: string }) {
  const tables = buildTables(i);
  const byId = new Map(tables.map((t) => [t.id, t]));
  const T = (id: number) => renderTable(byId.get(id)!);
  const blank = countSuppressed(tables);
  const updated = INPUT_FILES.map((f) => `\`${f}\`(${String(i[f].updatedAt ?? i[f].asOf ?? "-").slice(0, 10)})`).join(", ");
  const w = i["week-digest.json"];
  const oLog = i["outlook-log.json"];

  return `# ${renderTitle(month)}

호 번호 ${month} · 기준 ${w.asOf}(관측 시각 기준 이달) · Release \`${tag}\`

${CONTACT_LINE}

## 읽는 법

- 모든 숫자는 집계 사이트가 그날 낸 \`docs/data/*.json\` 값 그대로이고, 이 리포트를 위해 창·문턱을 다시 계산하지 않았다. 그래서 표마다 비교 구간이 다르며 각 표 머리에 「비교 구간 …(n·문턱)」을 적었다. 사이트의 같은 지표와 같은 값이다.
- 단위는 서울 전체·자치구·가격대·연식·면적대·권역이다. 행·단지 단위 값은 없다. 표본이 ${MIN_CELL}건 미만인 칸과 사이트 문턱에 못 미친 칸은 비웠다(이 호에서 ${blank}칸).
- 입력: ${updated}. 괄호는 그 파일의 갱신일이다.
- 표5(월 실부담)는 한국은행 ECOS 값을 쓰는 표라 이용허락 확인 전까지 싣지 않는다. 번호는 비워 둔다.
- 이 숫자는 신고된 것을 센 것이지 전망이나 권유가 아니다. 자치구 줄은 순위가 아니다.

## 1. 이달 신고 흐름

${T(1)}
## 2. 자치구 가격 수준

${T(2)}
## 3. 세그먼트 12개월 변화

${T(3)}
## 4. 전세·월세

${T(4)}
#### 표5. (이 호에 없음)

월 실부담(\`monthly-cost.json\`)은 한국은행 ECOS 평균금리로 계산한 값이라 ECOS 이용허락 확인 전까지 싣지 않는다.

${T(6)}
## 5. 해제·등기·직거래

${T(7)}
${T(8)}
## 6. 층·신고가

${T(9)}
${T(10)}
## 7. 3개월 전망 채점 기록(C5)

${T(11)}
## 8. 범위 적중률(C6) 예고

- 무엇을 채점하나: 사이트의 단지 카드가 매일 내는 「같은 단지 같은 평형의 매매가 범위」(칸 n≥5 는 사분위, n=3~4 는 최저~최고)가 그 뒤 실제 거래를 얼마나 품었는가. 공칭은 50%다.
- 어떻게: 매월 1일 스냅샷, 후속 거래는 스냅샷 뒤 30·60·90일 세 창을 모두 싣고 신고 기한이 닫힌 뒤에만 센다. 공개 단위는 자치구(가격대 합산), 서울×가격대 5구간, 서울×칸 표본 구간 셋이고 각 줄 채점 100건 이상일 때만 숫자를 낸다. 규칙은 결과를 보기 전에 \`research/ledger-prereg-2026-10/PREREG.md\`(v3)에 적어 두었고 결과를 보고 바꾸지 않는다.
- 언제: 스냅샷 3회가 쌓인 뒤라 숫자는 빨라도 2027-01 호다. 이 호에는 적중률 숫자가 없다.
- C1 신고 도착 삼각표(계약일→첫 관측일 경과 0~7·8~14·15~21·22~30·31~45·46일 이상): 계약일 2026-10-01 이상만 쓰고 첫 닫힌 곡선은 2026-12-01 이후다. 이 호에는 싣지 않는다.
- 이 호의 C5 기록 건수: 등록 전망 ${oLog.entries.length}건, 그림자 ${oLog.shadow?.length ?? 0}건(표11).

## 첨부

- \`${tag}.md\`: 이 본문. \`${tag}-table-NN.csv\`: 표별 CSV(첫 두 줄과 마지막 줄은 \`#\` 주석 - 표 제목·비교 구간·출처 문구).
- 산출 스크립트는 \`scripts/monthly-report.ts\`, 입력은 저장소 \`docs/data/\`의 위 파일들이다. 같은 입력이면 같은 출력이다.

## 갱신

- 월 1회 내도록 설정돼 있다(수동 실행도 가능). 일정이나 지속을 약속하지 않으며, 중단·변경될 수 있고 늦어질 수 있다. 호마다 Release 가 따로이고 이전 호를 고치지 않는다. 인용할 때는 호 번호와 각 표의 비교 구간을 함께 적어 주기 바란다.
- 원천(국토교통부)이 기록을 수정하면 다음 호의 숫자가 달라질 수 있다.

## 문의

${CONTACT_LINE}

${ATTRIBUTION_LINE} 이 자료의 숫자는 가공값이고 원천의 원값이 아니다.
`;
}

// ---- 산출 ----------------------------------------------------------------------------------------------------------

export async function buildReport({ dataDir = DEFAULT_DATA_DIR, outDir, month: override = process.env.MONTHLY_REPORT_MONTH }: { dataDir?: string; outDir: string; month?: string }) {
  const inputs = await loadInputs(dataDir);
  const month = reportMonth(inputs, override);
  const tag = `${TAG_PREFIX}${month}`;
  const tables = buildTables(inputs);
  const body = renderBody(inputs, { month, tag });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${tag}.md`), body);
  for (const t of tables) await writeFile(path.join(outDir, tableCsvName(tag, t)), renderCsv(t));
  await writeFile(path.join(outDir, "tag.txt"), `${tag}\n`);
  await writeFile(path.join(outDir, "title.txt"), `${renderTitle(month)}\n`);
  return { month, tag, tables, blank: countSuppressed(tables), files: [`${tag}.md`, ...tables.map((t) => tableCsvName(tag, t))] };
}

async function main() {
  const outDir = process.env.MONTHLY_REPORT_OUT_DIR;
  if (!outDir) throw new Error("MONTHLY_REPORT_OUT_DIR(산출 폴더)가 필요하다");
  const dataDir = process.env.MONTHLY_REPORT_DATA_DIR ? path.resolve(process.env.MONTHLY_REPORT_DATA_DIR) : DEFAULT_DATA_DIR;
  const r = await buildReport({ dataDir, outDir: path.resolve(outDir) });
  console.log(`${r.tag}: 표 ${r.tables.length}개(표5 제외), 행 ${r.tables.reduce((a, t) => a + t.rows.length, 0)}개, 비움 ${r.blank}칸, 파일 ${r.files.length}개 → ${path.resolve(outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`리포트 산출 실패: ${err.message}`);
    process.exit(1);
  });
}
