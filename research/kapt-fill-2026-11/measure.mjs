// K-apt 15057332·15058453 채움률·값 형식·실거래 겹침 측정(#823). 호출량·이용 조건은 같은 폴더 README.md.
//
//   node research/kapt-fill-2026-11/measure.mjs plan [--n 3189]        호출 없음. 호출 계획과 실거래 분모를 찍는다
//   node research/kapt-fill-2026-11/measure.mjs guard --attempt N --done N --early-stops N --resume no|yes   호출 없음. 재실행 거부
//   node research/kapt-fill-2026-11/measure.mjs fetch --out <저장소 밖 폴더>   API 호출. 저장소에 쓰지 않고 요약만 남긴다
//
// fetch는 PUBLIC_DATA_PORTAL_API_KEY만 환경에서 읽는다. 다른 키로 넘어가지 않고 .env도 읽지 않는다.
// 인증 오류는 다시 시도하지 않고 멈춘다. 호출 주소·오류 원문은 남기지 않고 코드와 HTTP 상태만 남긴다.
// 응답의 단지별 행(코드·이름·주소·연락처)은 메모리에서 세는 데만 쓰고 파일에 쓰지 않는다.
// --base-url·--delay-ms·--retry-wait-ms·--deadline-ms는 시험의 스텁 서버에만 쓴다. 주소가 루프백이 아니면 거부한다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { areaGroups, marketDeal } from "../../scripts/complex-price.ts";
import { normalizeKey } from "../../scripts/official-price-api.ts";
import { DISTRICTS } from "../../scripts/realestate-districts.ts";

const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, "../..");

// 규격은 data.go.kr 상세 페이지의 명세(2026-11-03 확인)에서 옮겼다. 키 파라미터의 대소문자가 오퍼레이션마다 다르다.
export const API_BASE = "https://apis.data.go.kr/1613000";
export const SERVICE = { list: "15057332", basis: "15058453" };
export const OPS = {
  list: { service: SERVICE.list, path: "/AptListService4/getSidoAptList4", keyParam: "serviceKey" },
  basis: { service: SERVICE.basis, path: "/AptBasisInfoServiceV5/getAphusBassInfoV5", keyParam: "serviceKey" },
  detail: { service: SERVICE.basis, path: "/AptBasisInfoServiceV5/getAphusDtlInfoV5", keyParam: "ServiceKey" },
};
export const SEOUL_SIDO = "11";

// ── 호출 예산. 개발계정 일 5,000건의 단위(서비스·오퍼레이션)를 페이지에서 확인하지 못해 서비스 합산으로 잡는다. ──
export const DAILY_LIMIT = 5000;
export const MAX_CALLS = { [SERVICE.list]: 60, [SERVICE.basis]: 4800 };
export const RETRY_RESERVE = 100;
export const MIN_DETAIL = 1400;
export const LIST_PAGE_SIZE = 1000;
export const SAMPLE_SEED = "kapt-823-v1";
export const MAX_EARLY_STOPS = 2;

const PACE_MS = 1000; // 초당 1회 이하(공시가격 수집과 같다)
const TIMEOUT_MS = 15_000;
const RETRY_WAIT_MS = 3000;
const STOP_AFTER_FAILED = 10;
const DEADLINE_MS = 150 * 60_000;
const HISTOGRAM_TOP = 40;
export const EXIT_STOPPED = 6;
export const ARTIFACT = { done: "kapt-fill", earlyStop: "kapt-fill-early-stop" };
export const STARTED_MARKER = "fetch-started.json";
export const RESULT_FILES = ["summary.json", "result.out"];

const AUTH_CODES = new Set([20, 30, 31, 32, 33]);
const QUOTA_CODES = new Set([22, 23]);
const AUTH_TEXT = /SERVICE_KEY|SERVICE_ACCESS_DENIED|UNREGISTERED|DEADLINE_HAS_EXPIRED|UNSIGNED_CALL|Unauthorized|Forbidden/;
const QUOTA_TEXT = /LIMITED_NUMBER|rate limit/i;
const PLACEHOLDERS = new Set(["", "-", "--", "없음", "해당없음", "해당 없음", "null", "N/A", "n/a"]);

const CODE_TO_DISTRICT = new Set(DISTRICTS.map((d) => d.code));
const isLoopback = (url) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 순수 함수 ──

/** 호출 나누기. 기본 정보는 주소가 있어 겹침에 전수가 필요하고, 상세는 표본으로 채움률을 낸다. 상세 표본은 기본 정보 대상의 부분집합이다. */
export function allocate(n) {
  const room = MAX_CALLS[SERVICE.basis] - RETRY_RESERVE;
  const basis = Math.min(n, room - MIN_DETAIL);
  const detail = Math.min(basis, room - basis);
  return { basis, detail, planned: basis + detail, retryReserve: RETRY_RESERVE };
}

const rank = (code) => createHash("sha256").update(`${SAMPLE_SEED}:${code}`).digest("hex");

/** 구별 비례(최대 나머지) 표본. 구 안에서는 코드 해시 순서로 앞에서 잘라, count가 커지면 표본이 늘기만 한다. */
export function sampleByDistrict(rows, count) {
  const groups = new Map();
  for (const row of rows) {
    const code = String(row.bjdCode ?? "").slice(0, 5);
    const key = CODE_TO_DISTRICT.has(code) ? code : "?";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const keys = [...groups.keys()].sort();
  for (const key of keys) groups.get(key).sort((a, b) => (rank(a.kaptCode) < rank(b.kaptCode) ? -1 : 1));
  const quota = keys.map((key) => {
    const exact = (groups.get(key).length * count) / rows.length;
    return { key, take: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = count - quota.reduce((a, q) => a + q.take, 0);
  for (const q of [...quota].sort((a, b) => b.rest - a.rest || (a.key < b.key ? -1 : 1))) {
    if (left <= 0) break;
    q.take += 1;
    left -= 1;
  }
  return quota.flatMap((q) => groups.get(q.key).slice(0, q.take));
}

/** 지번 정규화. 본번 앞 0과 부번 0을 없앤다. "가-9"·"BL-9-9"처럼 숫자 지번이 아니면 null. */
export function normalizeJibun(raw) {
  const m = /^(산)?\s*0*(\d+)(?:-0*(\d*))?-?$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  return `${m[1] ?? ""}${m[2]}${m[3] && Number(m[3]) ? `-${m[3]}` : ""}`;
}

/** 법정동주소에서 [법정동, 지번] 목록. 지번이 쉼표로 여럿일 수 있고("… 상계동 652,서울특별시 노원구 상계동 656 단지명") 뒤쪽은 동을 생략할 수 있다. */
export function parseParcels(address) {
  const out = [];
  let dong = null;
  for (const part of String(address ?? "").split(",")) {
    const full = /(?:\S+구)\s+(\S+)\s+(산?\s?\d+(?:-\d*)?)(?=\s|번지|$)/.exec(part);
    const bare = /^\s*(산?\s?\d+(?:-\d*)?)(?=\s|번지|$)/.exec(part);
    if (full) dong = full[1];
    const jibun = normalizeJibun((full ? full[2] : bare?.[1] ?? "").replace(/\s/g, ""));
    if (dong && jibun) out.push({ dong, jibun });
  }
  return out;
}

/** 응답을 판정한다. 오류 원문은 돌려주지 않고 분류·코드·형식만 돌려준다. */
export function classify(httpStatus, text) {
  let parsed = null;
  let format = "other";
  try {
    parsed = JSON.parse(text);
    format = "json";
  } catch {
    if (/^\s*</.test(text)) {
      try {
        parsed = new XMLParser({ parseTagValue: false }).parse(text);
        format = "xml";
      } catch {
        parsed = null;
      }
    }
  }
  const root = parsed?.response ?? parsed;
  const header = root?.header ?? null;
  const rawCode = header?.resultCode ?? parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode ?? null;
  const code = rawCode === null || rawCode === "" ? null : Number(rawCode);
  const base = { httpStatus, format, code: Number.isFinite(code) ? code : null };
  if (httpStatus === 401 || httpStatus === 403) return { ...base, kind: "auth" };
  if (httpStatus === 429) return { ...base, kind: "quota" };
  if (code !== null && AUTH_CODES.has(code)) return { ...base, kind: "auth" };
  if (code !== null && QUOTA_CODES.has(code)) return { ...base, kind: "quota" };
  if (code === 12) return { ...base, kind: "spec" };
  if (code === null && AUTH_TEXT.test(text)) return { ...base, kind: "auth" };
  if (code === null && QUOTA_TEXT.test(text)) return { ...base, kind: "quota" };
  if (code === null && /NO_OPENAPI_SERVICE/.test(text)) return { ...base, kind: "spec" };
  if (httpStatus >= 500) return { ...base, kind: "transient" };
  if (httpStatus !== 200 || code === null) return { ...base, kind: "other" };
  if (code === 3) return { ...base, kind: "nodata", items: [], totalCount: 0 };
  if (code !== 0) return { ...base, kind: "other" };
  const body = root?.body ?? {};
  return { ...base, kind: "ok", items: itemsOf(body), totalCount: Number(body.totalCount ?? NaN) };
}

/** 목록은 명세상 body.items 배열, 단건은 body.item 객체다. 포털이 흔히 쓰는 body.items.item도 받는다. */
export function itemsOf(body) {
  const wrap = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);
  if (Array.isArray(body?.items)) return body.items;
  if (body?.items && typeof body.items === "object") return wrap(body.items.item);
  return wrap(body?.item);
}

const text = (v) => String(v ?? "").trim();
const isFilled = (v) => !PLACEHOLDERS.has(text(v));

/** 글자를 지운 값의 모양. 한글 묶음→가, 숫자 묶음→9, 영문 묶음→A. 구분자는 남긴다. */
export function shapeOf(value) {
  return text(value).replace(/[가-힣]+/g, "가").replace(/\d+/g, "9").replace(/[A-Za-z]+/g, "A").slice(0, 40);
}

function count(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function top(map, limit = HISTOGRAM_TOP) {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { distinct: rows.length, top: rows.slice(0, limit), otherCount: rows.slice(limit).reduce((a, r) => a + r[1], 0) };
}

/** 표본 비율의 95% 폭(%p). 모집단 유한 보정. */
export function marginPp(filled, sample, population) {
  if (!sample) return null;
  const p = filled / sample;
  const fpc = population > 1 ? Math.sqrt(Math.max(0, population - sample) / (population - 1)) : 1;
  return Math.round(1.96 * Math.sqrt((p * (1 - p)) / sample) * fpc * 10000) / 100;
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");

function quantiles(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { min: sorted[0], p01: at(0.01), p50: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1] };
}

/** 실거래 원본에서 단지 키·칸·거래를 지번별로 접는다. 단지 키 = 구+법정동+지번+단지명, 칸 = 단지 키+면적 묶음(scripts/complex-price.ts). */
export function foldDeals(root) {
  const dir = path.join(root, "raw", "sale");
  const parcels = new Map();
  const totals = { rows: 0, live: 0, market: 0, keys: 0, cells: 0, unparsedJibun: 0 };
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    for (const item of JSON.parse(readFileSync(path.join(dir, name), "utf8")).items ?? []) {
      totals.rows += 1;
      if (text(item.cdealType)) continue;
      totals.live += 1;
      const jibun = normalizeJibun(item.jibun);
      if (!jibun) totals.unparsedJibun += 1;
      const parcel = `${item.sggCd}|${text(item.umdNm)}|${jibun ?? `?${text(item.jibun)}`}`;
      if (!parcels.has(parcel)) parcels.set(parcel, { live: 0, market: 0, keys: new Map() });
      const p = parcels.get(parcel);
      p.live += 1;
      const apt = text(item.aptNm);
      if (!p.keys.has(apt)) p.keys.set(apt, []);
      const deal = marketDeal(item);
      if (deal) {
        p.market += 1;
        totals.market += 1;
        p.keys.get(apt).push(deal);
      }
    }
  }
  for (const p of parcels.values()) {
    p.cells = 0;
    for (const deals of p.keys.values()) p.cells += new Set(areaGroups(deals).values()).size;
    totals.keys += p.keys.size;
    totals.cells += p.cells;
    p.keyCount = p.keys.size;
    delete p.keys;
  }
  return { parcels, totals };
}

/** 지번 일치 겹침. complexes는 {code, district, parcels:[{dong,jibun}]}. */
export function overlap(deals, complexes) {
  const codesByParcel = new Map();
  let parsed = 0;
  for (const c of complexes) {
    if (c.parcels.length) parsed += 1;
    for (const { dong, jibun } of c.parcels) {
      const key = `${c.district}|${dong}|${jibun}`;
      if (!codesByParcel.has(key)) codesByParcel.set(key, new Set());
      codesByParcel.get(key).add(c.code);
    }
  }
  const hit = { keys: 0, cells: 0, live: 0, market: 0, parcels: 0, ambiguousParcels: 0, ambiguousLive: 0 };
  const dealsByCode = new Map();
  for (const [key, p] of deals.parcels) {
    const codes = codesByParcel.get(key);
    if (!codes) continue;
    hit.keys += p.keyCount;
    hit.cells += p.cells;
    hit.live += p.live;
    hit.market += p.market;
    hit.parcels += 1;
    if (codes.size > 1) {
      hit.ambiguousParcels += 1;
      hit.ambiguousLive += p.live;
    } else {
      count(dealsByCode, [...codes][0], p.live);
    }
  }
  const matchedComplexes = complexes.filter((c) => c.parcels.some(({ dong, jibun }) => deals.parcels.has(`${c.district}|${dong}|${jibun}`))).length;
  return {
    summary: {
      denominators: deals.totals,
      hit,
      kapt: { complexes: complexes.length, addressParsed: parsed, matchedAnyDeal: matchedComplexes },
    },
    dealsByCode,
  };
}

/** 재실행 거부. 하나라도 어긋나면 이유를 돌려준다. 값을 읽지 못한 경우(숫자가 아님)도 거부다. */
export function guardReason({ attempt, done, earlyStops, resume, resultExists }) {
  const nat = (v) => /^\d+$/.test(String(v ?? ""));
  if (!nat(attempt) || !nat(done) || !nat(earlyStops)) return `확인값을 읽지 못했다(attempt=${attempt}, done=${done}, early=${earlyStops})`;
  if (Number(attempt) !== 1) return `재실행이다(시도 ${attempt}). 호출 예산 밖이라 거부한다`;
  if (resultExists) return "결과 파일이 이미 저장소에 있다. 측정이 끝나 거부한다";
  if (Number(done) !== 0) return `아티팩트 ${ARTIFACT.done} 수가 0이 아니다(${done}). 이미 호출한 실행이 있어 거부한다`;
  if (Number(earlyStops) >= MAX_EARLY_STOPS) return `조기 중단이 ${earlyStops}회다. 상한 ${MAX_EARLY_STOPS}회라 거부한다`;
  if (Number(earlyStops) > 0 && resume !== "yes") return `조기 중단 ${earlyStops}회가 있다. 원인을 고친 뒤 resume_after_early_stop=yes로만 돌린다`;
  return null;
}

// ── 호출 ──

export class StopRun extends Error {
  constructor(kind, info = {}) {
    super(kind);
    this.kind = kind;
    this.info = info;
  }
}

function makeClient({ base, key, delayMs, retryWaitMs, deadlineAt }) {
  const calls = { [SERVICE.list]: 0, [SERVICE.basis]: 0 };
  const outcomes = new Map();
  const formats = new Map();
  let lastStart = 0;

  async function once(opName, params) {
    const op = OPS[opName];
    if (calls[op.service] >= MAX_CALLS[op.service]) throw new StopRun("budget", { service: op.service, op: opName });
    if (Date.now() >= deadlineAt) throw new StopRun("deadline", { service: op.service, op: opName });
    const wait = lastStart + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    calls[op.service] += 1;
    const query = new URLSearchParams(params).toString();
    const url = `${base}${op.path}?${op.keyParam}=${encodeURIComponent(key)}${query ? `&${query}` : ""}`;
    let verdict;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      verdict = classify(res.status, await res.text());
    } catch (err) {
      verdict = { kind: "transient", httpStatus: null, code: null, format: "none", network: err?.cause?.code ?? err?.name ?? "error" };
    }
    count(outcomes, `${opName}:${verdict.kind}:${verdict.code ?? verdict.httpStatus ?? verdict.network}`);
    count(formats, verdict.format);
    if (["auth", "quota", "spec"].includes(verdict.kind)) {
      throw new StopRun(verdict.kind, { service: op.service, op: opName, code: verdict.code, httpStatus: verdict.httpStatus });
    }
    return verdict;
  }

  /** 인증·한도·규격 오류는 once가 던져 다시 시도하지 않는다. 다시 시도는 일시 오류 한 번뿐이고 예산 안에서만 한다. */
  async function call(opName, params) {
    const first = await once(opName, params);
    if (first.kind !== "transient") return first;
    if (retryWaitMs) await sleep(retryWaitMs);
    return once(opName, params);
  }

  return { call, calls, outcomes, formats };
}

async function fetchList(client) {
  const rows = new Map();
  let total = null;
  for (let page = 1; ; page += 1) {
    const res = await client.call("list", { sidoCode: SEOUL_SIDO, pageNo: String(page), numOfRows: String(LIST_PAGE_SIZE) });
    if (res.kind !== "ok") throw new StopRun("list-failed", { service: SERVICE.list, op: "list", code: res.code, httpStatus: res.httpStatus });
    if (Number.isFinite(res.totalCount)) total = res.totalCount;
    for (const row of res.items) if (text(row.kaptCode)) rows.set(text(row.kaptCode), { kaptCode: text(row.kaptCode), bjdCode: text(row.bjdCode), as1: text(row.as1) });
    if (!res.items.length || (total !== null && rows.size >= total)) break;
    if (client.calls[SERVICE.list] >= MAX_CALLS[SERVICE.list]) break;
  }
  const list = [...rows.values()];
  if (total === null || list.length < total) throw new StopRun("list-incomplete", { service: SERVICE.list, op: "list", got: list.length, totalCount: total });
  const notSeoul = list.filter((r) => !r.as1.startsWith("서울")).length;
  if (notSeoul) throw new StopRun("list-not-seoul", { service: SERVICE.list, op: "list", notSeoul, got: list.length });
  if (!list.length) throw new StopRun("list-empty", { service: SERVICE.list, op: "list" });
  return list;
}

function newStats() {
  return {
    basis: { asked: 0, ok: 0, noItem: 0, failed: 0, keys: new Map(), households: { filled: 0, zero: 0, nonNumeric: 0, values: [] }, units: { filled: 0, zero: 0, nonNumeric: 0, values: [] }, hhldCntFilled: 0, useDate: { filled: 0, yyyymmdd: 0, shapes: new Map() }, address: { filled: 0, shapes: new Map() } },
    detail: { asked: 0, ok: 0, noItem: 0, failed: 0, keys: new Map(), time: new Map(), line: new Map(), stationShapes: new Map(), stations: new Set(), filled: { time: 0, line: 0, station: 0, all: 0 }, patterns: new Map(), byDistrict: new Map(), filledCodes: new Set() },
  };
}

function addNumber(slot, raw) {
  if (!isFilled(raw)) return;
  const n = Number(text(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) {
    slot.nonNumeric += 1;
    return;
  }
  slot.filled += 1;
  if (n === 0) slot.zero += 1;
  else slot.values.push(n);
}

function addBasis(stats, item, row, complexes) {
  const s = stats.basis;
  for (const k of Object.keys(item)) count(s.keys, k);
  addNumber(s.households, item.kaptdaCnt);
  addNumber(s.units, item.hoCnt);
  if (isFilled(item.hhldCnt)) s.hhldCntFilled += 1;
  if (isFilled(item.kaptUsedate)) {
    s.useDate.filled += 1;
    if (/^\d{8}$/.test(text(item.kaptUsedate))) s.useDate.yyyymmdd += 1;
    count(s.useDate.shapes, shapeOf(item.kaptUsedate));
  }
  if (isFilled(item.kaptAddr)) {
    s.address.filled += 1;
    count(s.address.shapes, shapeOf(item.kaptAddr).replace(/(가\s)+/g, "가 "));
  }
  const district = text(item.bjdCode || row.bjdCode).slice(0, 5);
  complexes.push({ code: row.kaptCode, district, parcels: parseParcels(item.kaptAddr) });
}

function addDetail(stats, item, row) {
  const s = stats.detail;
  for (const k of Object.keys(item)) count(s.keys, k);
  const filled = { time: isFilled(item.kaptdWtimesub), line: isFilled(item.subwayLine), station: isFilled(item.subwayStation) };
  const district = text(row.bjdCode).slice(0, 5);
  if (!s.byDistrict.has(district)) s.byDistrict.set(district, { n: 0, time: 0 });
  const d = s.byDistrict.get(district);
  d.n += 1;
  if (filled.time) {
    d.time += 1;
    s.filled.time += 1;
    s.filledCodes.add(row.kaptCode);
    count(s.time, text(item.kaptdWtimesub).slice(0, 40));
  }
  if (filled.line) {
    s.filled.line += 1;
    count(s.line, text(item.subwayLine).slice(0, 40));
  }
  if (filled.station) {
    s.filled.station += 1;
    s.stations.add(text(item.subwayStation));
    count(s.stationShapes, shapeOf(item.subwayStation));
  }
  if (filled.time && filled.line && filled.station) s.filled.all += 1;
  count(s.patterns, `시간${filled.time ? "O" : "X"} 호선${filled.line ? "O" : "X"} 역${filled.station ? "O" : "X"}`);
}

function publicStats(stats, population, samples, deals, complexes) {
  const b = stats.basis;
  const d = stats.detail;
  const numberView = (slot) => ({ filled: slot.filled, zero: slot.zero, nonNumeric: slot.nonNumeric, quantiles: quantiles(slot.values) });
  const walked = overlap(deals, complexes);
  // 거래 가중: 지번이 단지 하나로 풀린 거래만 분자·분모에 넣는다.
  let dealsInSample = 0;
  let dealsFilled = 0;
  for (const code of samples.detailCodes) {
    const n = walked.dealsByCode.get(code) ?? 0;
    dealsInSample += n;
    if (d.filledCodes.has(code)) dealsFilled += n;
  }
  return {
    frame: { listed: population, basisPlanned: samples.basis, detailPlanned: samples.detail, sampleSeed: SAMPLE_SEED },
    basis: {
      asked: b.asked, ok: b.ok, noItem: b.noItem, failed: b.failed,
      kaptdaCnt: numberView(b.households), hoCnt: numberView(b.units), hhldCntFilled: b.hhldCntFilled,
      kaptUsedate: { filled: b.useDate.filled, yyyymmdd: b.useDate.yyyymmdd, shapes: top(b.useDate.shapes, 10) },
      kaptAddr: { filled: b.address.filled, shapes: top(b.address.shapes, 10) },
      responseKeys: top(b.keys, 80),
    },
    detail: {
      asked: d.asked, ok: d.ok, noItem: d.noItem, failed: d.failed,
      filled: d.filled,
      marginPp: { time: marginPp(d.filled.time, d.ok, population) },
      kaptdWtimesub: top(d.time),
      subwayLine: top(d.line),
      subwayStation: { distinct: d.stations.size, shapes: top(d.stationShapes, 15) },
      patterns: top(d.patterns, 8),
      timeByDistrict: [...d.byDistrict.entries()].sort().map(([code, v]) => ({ code, ...v })),
      dealWeighted: { dealsInSample, dealsFilled },
      responseKeys: top(d.keys, 80),
    },
    overlap: walked.summary,
  };
}

function resultLines(summary) {
  const lines = [`호출 ${summary.calls[SERVICE.list]}+${summary.calls[SERVICE.basis]} (15057332 상한 ${MAX_CALLS[SERVICE.list]}, 15058453 상한 ${MAX_CALLS[SERVICE.basis]})`];
  if (summary.stop) lines.push(`멈춤: ${summary.stop.kind} ${JSON.stringify(summary.stop.info)}`);
  const r = summary.result;
  if (!r) return lines;
  const { basis: b, detail: d, overlap: o } = r;
  lines.push(`단지 목록 ${r.frame.listed}, 기본 정보 ${b.ok}/${b.asked}, 상세 ${d.ok}/${d.asked}`);
  if (r.frame.basisPlanned < r.frame.listed) lines.push(`주의: 기본 정보가 전수가 아니다(${r.frame.basisPlanned}/${r.frame.listed}). 지번 겹침은 하한이다`);
  lines.push(`kaptdaCnt ${b.kaptdaCnt.filled}(0값 ${b.kaptdaCnt.zero}) · hoCnt ${b.hoCnt.filled} · hhldCnt ${b.hhldCntFilled} · kaptUsedate ${b.kaptUsedate.filled}(yyyymmdd ${b.kaptUsedate.yyyymmdd}) / ${b.ok}`);
  lines.push(`kaptdWtimesub ${d.filled.time}/${d.ok} (${pct(d.filled.time, d.ok)}, 95% 폭 ±${d.marginPp.time}%p), subwayLine ${d.filled.line}, subwayStation ${d.filled.station}, 셋 다 ${d.filled.all}`);
  lines.push(`거래 가중 kaptdWtimesub ${d.dealWeighted.dealsFilled}/${d.dealWeighted.dealsInSample} (${pct(d.dealWeighted.dealsFilled, d.dealWeighted.dealsInSample)})`);
  const t = o.denominators;
  lines.push(`지번 겹침: 단지 키 ${o.hit.keys}/${t.keys} (${pct(o.hit.keys, t.keys)}), 칸 ${o.hit.cells}/${t.cells} (${pct(o.hit.cells, t.cells)}), 거래 ${o.hit.live}/${t.live} (${pct(o.hit.live, t.live)}), 한 지번 여러 코드 ${o.hit.ambiguousParcels}지번 ${o.hit.ambiguousLive}거래`);
  lines.push(`K-apt 쪽: 주소 해석 ${o.kapt.addressParsed}/${o.kapt.complexes}, 거래 있는 단지 ${o.kapt.matchedAnyDeal}`);
  return lines;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function fail(code, message) {
  console.error(message);
  return code;
}

async function cmdFetch(opts) {
  const key = normalizeKey(process.env.PUBLIC_DATA_PORTAL_API_KEY);
  if (!key) return fail(2, "PUBLIC_DATA_PORTAL_API_KEY가 없어 호출하지 않는다");
  if (!opts.out) return fail(2, "--out이 없다");
  const outDir = path.resolve(opts.out);
  for (const root of [REPO_ROOT, opts.root]) {
    if (!path.relative(root, outDir).startsWith("..")) return fail(2, "--out은 저장소 밖이어야 한다(쓰기 0)");
  }
  const testOnly = opts.delayMs !== undefined || opts.retryWaitMs !== undefined || opts.deadlineMs !== undefined;
  if ((opts.baseUrl || testOnly) && !isLoopback(opts.baseUrl ?? "")) return fail(2, "--base-url·시험용 인자는 루프백 주소에만 쓴다");

  const deals = foldDeals(opts.root);
  const client = makeClient({
    base: opts.baseUrl ?? API_BASE,
    key,
    delayMs: opts.delayMs ?? PACE_MS,
    retryWaitMs: opts.retryWaitMs ?? RETRY_WAIT_MS,
    deadlineAt: Date.now() + (opts.deadlineMs ?? DEADLINE_MS),
  });
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  // 호출을 시작한 실행은 어떻게 끝나도 이 표시가 아티팩트로 남아 다음 dispatch를 막는다.
  const started = `${JSON.stringify({ startedAt, commit: process.env.GITHUB_SHA ?? null })}\n`;
  writeFileSync(path.join(outDir, STARTED_MARKER), started);

  const stats = newStats();
  const complexes = [];
  let stop = null;
  let probed = false;
  let list = [];
  let samples = { basis: 0, detail: 0, detailCodes: [] };
  let failedInARow = 0;

  const measure = async (opName, row, add, slot) => {
    slot.asked += 1;
    const res = await client.call(opName, { kaptCode: row.kaptCode });
    if (res.kind === "ok" && res.items.length) {
      add(res.items[0]);
      slot.ok += 1;
      failedInARow = 0;
    } else if (res.kind === "ok" || res.kind === "nodata") {
      slot.noItem += 1;
      failedInARow = 0;
    } else {
      slot.failed += 1;
      failedInARow += 1;
      if (failedInARow >= STOP_AFTER_FAILED) throw new StopRun("failed-in-a-row", { op: opName, service: OPS[opName].service, code: res.code, httpStatus: res.httpStatus });
    }
    return res;
  };

  try {
    list = await fetchList(client);
    const plan = allocate(list.length);
    const basisRows = plan.basis === list.length ? list : sampleByDistrict(list, plan.basis);
    const detailRows = sampleByDistrict(basisRows, plan.detail);
    samples = { basis: plan.basis, detail: plan.detail, detailCodes: detailRows.map((r) => r.kaptCode) };
    const [probe] = detailRows;
    const onBasis = (row) => (item) => addBasis(stats, item, row, complexes);
    const onDetail = (row) => (item) => addDetail(stats, item, row);

    // 승인은 서비스마다 따로라, 전수에 들어가기 전에 두 오퍼레이션을 한 건씩 확인한다. 응답이 정상 형식이어야 조기 중단 구간을 벗어난다.
    for (const [opName, add, slot] of [["basis", onBasis(probe), stats.basis], ["detail", onDetail(probe), stats.detail]]) {
      const res = await measure(opName, probe, add, slot);
      if (res.kind !== "ok" && res.kind !== "nodata") throw new StopRun("probe-failed", { service: OPS[opName].service, op: opName, code: res.code, httpStatus: res.httpStatus });
    }
    probed = true;
    for (const row of basisRows) if (row !== probe) await measure("basis", row, onBasis(row), stats.basis);
    for (const row of detailRows) if (row !== probe) await measure("detail", row, onDetail(row), stats.detail);
  } catch (err) {
    if (!(err instanceof StopRun)) throw err;
    stop = { kind: err.kind, info: err.info };
  }

  const summary = {
    issue: 823,
    startedAt,
    finishedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    calls: client.calls,
    maxCalls: MAX_CALLS,
    stop,
    probed,
    outcomes: top(client.outcomes, 40),
    responseFormats: top(client.formats, 5),
    // 조기 중단은 그 사실만 남긴다. 호출을 시작하기 전 단계라 셀 값도 없다.
    result: probed ? publicStats(stats, list.length, samples, deals, complexes) : null,
  };
  const lines = resultLines(summary);
  const artifact = probed ? ARTIFACT.done : ARTIFACT.earlyStop;
  writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
  writeFileSync(path.join(outDir, "result.out"), `${lines.join("\n")}\n`);
  writeFileSync(path.join(outDir, "artifact-name"), `${artifact}\n`);

  // 마지막 방어선: 쓴 파일에 키가 있으면 지우고 실패한다.
  const needles = [...new Set([key, encodeURIComponent(key), process.env.PUBLIC_DATA_PORTAL_API_KEY])];
  const leaked = walk(outDir).filter((file) => needles.some((n) => readFileSync(file, "utf8").includes(n)));
  if (leaked.length) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, STARTED_MARKER), started);
    return fail(5, `출력 ${leaked.length}개에 비밀값이 있어 출력 폴더를 지웠다`);
  }
  for (const line of lines) console.log(line);
  if (stop && stop.kind === "auth") console.log("인증 오류로 멈췄다. 다시 시도하지 않는다. 소유자에게 키 등록을 요청한다");
  return !probed || stop?.kind === "auth" ? EXIT_STOPPED : 0;
}

function cmdPlan(opts) {
  const n = opts.n ?? 3189;
  const plan = allocate(n);
  const deals = foldDeals(opts.root);
  console.log(`서울 단지 ${n} (엑셀 2026-09-25분 고유 코드. API 값은 첫 목록 호출에서 정해진다)`);
  console.log(`15057332 목록: 페이지당 ${LIST_PAGE_SIZE}이면 ${Math.ceil(n / LIST_PAGE_SIZE)}회, 상한 ${MAX_CALLS[SERVICE.list]}`);
  console.log(`15058453 전수 두 오퍼레이션이면 ${n * 2}회 > 일 ${DAILY_LIMIT}회`);
  console.log(`15058453 계획: 기본 ${plan.basis} + 상세 ${plan.detail} = ${plan.planned}, 일시 오류 여분 ${plan.retryReserve}, 상한 ${MAX_CALLS[SERVICE.basis]}`);
  console.log(`상세 표본 95% 폭 최대 ±${marginPp(plan.detail / 2, plan.detail, n)}%p`);
  console.log(`실거래 분모(raw/sale): ${JSON.stringify(deals.totals)}`);
  return 0;
}

function cmdGuard(opts) {
  const resultExists = RESULT_FILES.some((f) => existsSync(path.join(HERE, f)));
  const reason = guardReason({ attempt: opts.attempt, done: opts.done, earlyStops: opts.earlyStops, resume: opts.resume, resultExists });
  if (reason) return fail(1, reason);
  console.log("재실행 거부 통과");
  return 0;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" }, root: { type: "string" }, n: { type: "string" },
      attempt: { type: "string" }, done: { type: "string" }, "early-stops": { type: "string" }, resume: { type: "string" },
      "base-url": { type: "string" }, "delay-ms": { type: "string" }, "retry-wait-ms": { type: "string" }, "deadline-ms": { type: "string" },
    },
  });
  const num = (v) => (v === undefined ? undefined : Number(v));
  const opts = {
    out: values.out, root: path.resolve(values.root ?? REPO_ROOT), n: num(values.n),
    attempt: values.attempt, done: values.done, earlyStops: values["early-stops"], resume: values.resume,
    baseUrl: values["base-url"], delayMs: num(values["delay-ms"]), retryWaitMs: num(values["retry-wait-ms"]), deadlineMs: num(values["deadline-ms"]),
  };
  const [cmd] = positionals;
  if (cmd === "plan") return cmdPlan(opts);
  if (cmd === "guard") return cmdGuard(opts);
  if (cmd === "fetch") return cmdFetch(opts);
  return fail(2, "명령은 plan·guard·fetch 가운데 하나다");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => {
      // 원문에 주소가 섞일 수 있어 종류만 찍는다.
      console.error(`예상 못 한 오류: ${err?.name ?? "Error"}`);
      process.exitCode = 1;
    },
  );
}
