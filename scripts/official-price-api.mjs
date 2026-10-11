/**
 * 공시가격 API 수집기 (#68 E1). 건축HUB 건축물대장 OpenAPI(data.go.kr 15134735)의
 * getBrHsprcInfo(주택가격)와 getBrExposPubuseAreaInfo(전유공용면적)를 지번별로 받아
 * mgmBldrgstPk로 조인하고, 호당 전용면적·층으로 칸 (시군구, 법정동, 지번, 전용면적 0.1㎡)에 접는다.
 * 접는 규칙은 zip 경로와 같은 칸 키 모듈(official-price-key.mjs)·같은 중앙값·같은 n>=3 규칙을 쓴다.
 *
 * 소유자 조건(이 파일이 지키는 것)
 *  - C1: 호 단위 값(호명·동명·PK·면적·가격)과 응답 원문은 지번 하나를 처리하는 동안 메모리에만 있고 접은 뒤 버린다.
 *        로그·요약·파일·아티팩트·캐시 어디에도 쓰지 않는다. 오류는 고정 문구·숫자 코드만 낸다(err.message·URL 비출력).
 *  - C2: 호 n<3 칸은 값을 버리고 칸 수만 센다. C4: 파생본은 assertDerived(허용 필드 고정)를 통과해야 쓴다.
 *  - C3: 이용허락 문자열이 "제한 없음"이 아니거나 확인일이 365일을 넘으면 쓰기 없이 멈춘다.
 *  - C7: 응답 항목에서 허용 목록의 필드만 꺼내 쓰고(나머지는 버린다), 소유자·성명·주민번호 계열 키가 보이면 쓰기 없이 멈춘다.
 *
 * 상태 = 파생본의 부분집합: raw/official-price/<연도>/part-NNN.json 에 끝난 지번의 접힌 칸과 지번 줄이 남고,
 * 다음 실행은 그 지번 줄을 읽어 건너뛴다. 모든 지번이 끝나면 병합해 <연도>.json, 부분 파일은 지운다.
 * 쓰기는 실행 끝에서 한 번이다 - 검증이 어긋나 던지면 아무것도 쓰지 않는다.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { areaKey, cellKey } from "./official-price-key.mjs";
import { OFFICIAL_PRICE_LICENSE, OFFICIAL_PRICE_LICENSE_CHECKED } from "./official-price-license.mjs";
import { ALLOWED_KEYS, MAX_OUTPUT_BYTES, MIN_HOUSEHOLDS, REQUIRED_LICENSE, assertDerived, median } from "./official-price-fold.mjs";
import { orderTargets } from "./official-price-targets.mjs";

export const DEFAULT_BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";
export const SOURCE = "data.go.kr/data/15134735";
export const OP_PRICE = "getBrHsprcInfo";
export const OP_AREA = "getBrExposPubuseAreaInfo";
/** 서버 쪽당 100건 상한(시험: numOfRows=999도 100). */
export const PAGE_SIZE = 100;
/**
 * 지번당 쪽 상한. 탐색(E3)에서 큰 단지의 면적 응답이 최대 1,070쪽, hsprc가 최대 286쪽이었다(관측 최대 1.4배 여유로 1,500).
 * 걸리면 그 지번은 값을 쓰지 않고 지번 수만 센다. 면적 pageNo는 활용가이드에 3자리로 적혀 있어 서버가 999 초과를 거절할 수 있다 -
 * 탐색 모드의 pageNo 1,000 시험(official-price-explore.mjs (g))이 거절하면 후속(PR-A2)으로 면적을 dongNm(요청 파라미터)별로
 * 나눠 받는다. 이 상수를 올리는 것으로는 해결되지 않는다.
 */
export const MAX_PAGES_PER_PARCEL = 1500;
export const DEFAULT_START_DATE = "20250101";
export const DEFAULT_END_DATE = "20261231";
export const DEFAULT_DAILY_BUDGET = 9000;
/** 시작 간격 하한(초당 1회 이하). */
export const MIN_GAP_MS = 1100;
/** 한도(22)·키 오류(30~33): 끝난 지번까지 저장하고 정상 종료한다. */
export const STOP_CODES = new Set(["22", "30", "31", "32", "33"]);
export const LICENSE_MAX_AGE_DAYS = 365;

/** 응답 항목에서 꺼내 쓰는 필드의 전부(C7). 나머지 키는 읽자마자 버린다. */
export const PRICE_FIELDS = ["hsprc", "stdDay", "crtnDay", "mgmBldrgstPk"];
export const AREA_FIELDS = ["mgmBldrgstPk", "exposPubuseGbCd", "mainAtchGbCd", "area", "flrGbCd", "flrNo"];
/** 소유자·성명·주민번호 계열 키. 응답 항목에 하나라도 있으면 멈춘다. (전체 필드 명세를 못 봐서 이름 패턴으로 막는다.) */
export const OWNER_KEY_RE = /own|jumin|jmno|rrn|resno|ssn|regno|psn|prsn|소유|성명|주민|명의/i;
const GROUND_FLOOR = "20"; // flrGbCd 지상

/** 고정 문구로만 말하는 오류들 - 값이 메시지에 들어가지 않는다(C1). */
export class ApiValidationError extends Error { constructor(m, code) { super(m); this.name = "ApiValidationError"; this.code = code; } }
/** 쓰기 없이 실패해야 하는 오류(키 권한 등). */
export class ApiFatalError extends Error { constructor(m) { super(m); this.name = "ApiFatalError"; } }
/** 끝난 지번까지 저장하고 정상 종료해야 하는 신호. */
export class StopRun extends Error { constructor(reason) { super(reason); this.name = "StopRun"; this.reason = reason; } }
/** 이 지번만 버리고 다음으로 가는 일시 오류. */
export class ParcelFailed extends Error { constructor(m) { super(m); this.name = "ParcelFailed"; } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const yearOf = (v) => /^\d{4}/.test(String(v ?? "").trim()) ? Number(String(v).trim().slice(0, 4)) : null;

export function normalizeKey(raw) {
  let k = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (/%[0-9A-Fa-f]{2}/.test(k)) { try { k = decodeURIComponent(k); } catch { /* 그대로 */ } }
  return k;
}

/** 응답 본문 -> {code, total, items(원본 객체), nonJson}. 포털 게이트웨이 오류는 XML이다. */
export function extract(text) {
  try {
    const body = JSON.parse(text)?.response;
    if (body?.header) {
      const raw = body.body?.items;
      const item = raw && typeof raw === "object" ? raw.item : undefined;
      const items = Array.isArray(item) ? item : item && typeof item === "object" ? [item] : [];
      return { code: String(body.header.resultCode ?? ""), total: Number(body.body?.totalCount ?? 0), items };
    }
  } catch { /* XML */ }
  return { code: /<(?:returnReasonCode|resultCode)>\s*(\d+)\s*</.exec(text)?.[1] ?? "?", total: 0, items: [], nonJson: true };
}

/**
 * 항목 -> 허용 필드만 남긴 객체. 소유자 계열 키가 있으면 던진다(C7, 쓰기 없이 멈춤).
 * 필수 필드 키가 항목에 아예 없으면 던진다(값이 비어 있는 것은 호출한 쪽이 센다).
 * issues가 주어지면(탐색 모드) 던지지 않고 세기만 한다.
 */
export function projectItem(kind, item, issues) {
  const fail = (code, msg) => { if (issues) { bump(issues, code); return false; } throw new ApiValidationError(msg, code); };
  if (!item || typeof item !== "object") { fail("item-shape", "응답 항목이 객체가 아니다"); return null; }
  for (const k of Object.keys(item)) {
    if (OWNER_KEY_RE.test(k)) { fail("owner-field", `응답에 소유자 계열 키가 있다: ${k}`); return null; } // 키 이름만(값 아님)
  }
  const fields = kind === "price" ? PRICE_FIELDS : AREA_FIELDS;
  const own = (k) => Object.prototype.hasOwnProperty.call(item, k);
  let need = fields;
  if (kind === "area") {
    // 공용 행은 면적·층이 비어도 된다. 전유 행만 전 필드가 있어야 한다.
    need = ["mgmBldrgstPk", "exposPubuseGbCd"];
    if (own("exposPubuseGbCd") && String(item.exposPubuseGbCd).trim() === "1") need = fields;
  }
  const missing = need.filter((k) => !own(k));
  if (missing.length) { fail("field-missing", `응답 항목에 필수 필드가 없다: ${missing.join(",")}`); return null; }
  const out = {};
  for (const k of fields) if (own(k)) out[k] = String(item[k] ?? "").trim();
  return out;
}

/** 이용허락 문자열·확인일 검사 (C3). 틀리면 던진다. 값은 official-price-license.mjs의 상수가 기본이고, 시험은 인자로 주입한다(빠뜨리면 기본 상수). */
export function checkLicense({ license = OFFICIAL_PRICE_LICENSE, checked = OFFICIAL_PRICE_LICENSE_CHECKED, now = new Date() } = {}) {
  if ((license ?? "").trim() !== REQUIRED_LICENSE) throw new ApiValidationError(`이용허락범위가 "${REQUIRED_LICENSE}"이 아니거나 비었다`, "license");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((checked ?? "").trim());
  if (!m) throw new ApiValidationError("이용허락 확인일이 YYYY-MM-DD 형식이 아니거나 비었다", "license-date");
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - at) / 86400000);
  if (!Number.isFinite(days) || days < 0) throw new ApiValidationError("이용허락 확인일이 미래이거나 올바른 날짜가 아니다", "license-date");
  if (days > LICENSE_MAX_AGE_DAYS) throw new ApiValidationError(`이용허락 확인일이 ${LICENSE_MAX_AGE_DAYS}일을 넘었다 - 상세 페이지를 다시 보고 갱신할 것`, "license-stale");
  return { license: license.trim(), checked: checked.trim() };
}

/**
 * 호출기. 시작 간격·호출 수 예산·마감 시각을 지킨다. 재시도 없음.
 * 반환 객체의 page(op, target, pageNo, extra)는 {total, items(원본)}을 돌려주거나 던진다:
 *  - StopRun: 한도·키 코드(22,30~33)·HTTP 429·예산·마감
 *  - ApiFatalError: HTTP 401/403
 *  - ParcelFailed: 그 밖의 오류(연결·5xx·그 외 결과코드)
 */
export function makeClient({ baseUrl = DEFAULT_BASE, key, budget, gapMs = MIN_GAP_MS, deadlineMs = Infinity, timeoutMs = 60000, fetchImpl = fetch, now = Date.now, wait = sleep }) {
  const st = { calls: 0, last: 0, consecutiveFail: 0, errCodes: {}, firstLimitAt: null, perOp: {} };
  return {
    st,
    /** 쪽 하나를 요청하되 결과코드는 해석하지 않는다. 반환 {res, text}. 연결 실패는 ParcelFailed. 탐색의 pageNo 시험과 page()가 같이 쓴다. */
    async send(op, t, pageNo, extra = {}) {
      if (st.calls >= budget) throw new StopRun("호출 예산 소진");
      if (now() >= deadlineMs) throw new StopRun("실행 시간 상한");
      const gap = st.last + gapMs - now();
      if (gap > 0) await wait(gap);
      st.last = now();
      st.calls += 1;
      bump(st.perOp, op);
      const params = { sigunguCd: t.sigunguCd, bjdongCd: t.bjdongCd, platGbCd: 0, bun: t.bun, ji: t.ji, ...extra, numOfRows: PAGE_SIZE, pageNo, _type: "json" };
      const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
      let text = "";
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/${op}?${qs}&serviceKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(timeoutMs) });
        text = await res.text();
      } catch (e) {
        st.consecutiveFail += 1;
        bump(st.errCodes, `${e?.name ?? "Error"}/${e?.cause?.code ?? "-"}`); // 메시지·URL은 쓰지 않는다
        throw new ParcelFailed("호출 실패");
      }
      return { res, text };
    },
    async page(op, t, pageNo, extra = {}) {
      const { res, text: body } = await this.send(op, t, pageNo, extra);
      let text = body;
      if (res.status === 401 || res.status === 403) { bump(st.errCodes, `HTTP ${res.status}`); throw new ApiFatalError(`HTTP ${res.status} 권한 오류 - 키·활용신청을 확인할 것`); }
      if (res.status === 429) { bump(st.errCodes, "HTTP 429"); st.firstLimitAt ??= { calls: st.calls, perOp: { ...st.perOp }, op, code: "429" }; throw new StopRun("HTTP 429"); }
      const r = extract(text);
      text = "";
      if (!res.ok && r.code === "?" ) { st.consecutiveFail += 1; bump(st.errCodes, `HTTP ${res.status}`); throw new ParcelFailed("HTTP 오류"); }
      if (STOP_CODES.has(r.code)) {
        bump(st.errCodes, `결과코드 ${r.code}`);
        st.firstLimitAt ??= { calls: st.calls, perOp: { ...st.perOp }, op, code: r.code };
        throw new StopRun(`결과코드 ${r.code}`);
      }
      if (r.code !== "00") { st.consecutiveFail += 1; bump(st.errCodes, `결과코드 ${r.code}`); throw new ParcelFailed("결과코드 오류"); }
      st.consecutiveFail = 0;
      return { total: r.total, items: r.items };
    },
  };
}

/** 첫 쪽 응답 {total, items}로 본 필요한 쪽 수. totalCount를 못 읽으면 1(검증은 fetchParcelOp가 던진다). */
export function planPages(first) {
  const total = first.total;
  if (!Number.isInteger(total) || total < 0) return 1;
  return Math.max(1, Math.ceil(total / Math.max(1, Math.min(PAGE_SIZE, first.items.length || PAGE_SIZE))));
}

/**
 * 한 지번의 한 오퍼레이션을 모든 쪽 받는다. 첫 쪽의 totalCount로 필요한 쪽 수를 알고,
 * 쪽 상한을 넘으면 {capped:true}로 첫 쪽 뒤에 멈춘다(값 없음). 쪽 합이 totalCount와 다르면 던진다.
 * first가 주어지면 그 응답을 1쪽으로 쓴다(호출 안 함) - 호출한 쪽이 상한·예산을 먼저 보려고 1쪽을 미리 받은 경우.
 * 반환: {total, pages, items(허용 필드만), capped}
 */
export async function fetchParcelOp(client, op, kind, t, extra, { issues, onPlan, onRaw, first, maxPages = MAX_PAGES_PER_PARCEL } = {}) {
  const items = [];
  let total = 0;
  let pageSize = PAGE_SIZE;
  let pages = 1;
  for (let p = 1; p <= pages; p += 1) {
    const r = p === 1 && first ? first : await client.page(op, t, p, extra);
    if (p === 1) {
      total = r.total;
      if (!Number.isInteger(total) || total < 0) { const m = "totalCount를 읽을 수 없다"; if (issues) bump(issues, "total-unreadable"); else throw new ApiValidationError(m, "total"); }
      if (total > 0 && r.items.length === 0) { if (issues) bump(issues, "first-page-empty"); else throw new ApiValidationError("첫 쪽이 비었는데 totalCount가 0이 아니다", "pages-sum"); }
      pageSize = Math.max(1, Math.min(PAGE_SIZE, r.items.length || PAGE_SIZE));
      pages = Math.max(1, Math.ceil(total / pageSize));
      if (pages > maxPages) return { total, pages, items: [], capped: true };
      onPlan?.(pages);
    } else if (r.total !== total) {
      if (issues) bump(issues, "total-changed"); else throw new ApiValidationError("쪽마다 totalCount가 다르다", "total-changed");
    }
    for (const raw of r.items) {
      onRaw?.(raw); // 탐색 모드의 키 이름 목록용(값은 보지 않는다)
      const it = projectItem(kind, raw, issues);
      if (it) items.push(it);
    }
    if (p < pages && r.items.length === 0) break;
  }
  const seen = items.length;
  if (seen !== total) {
    // 소유자 계열 키로 버려진 항목은 탐색 모드(issues)에서만 생긴다.
    if (issues) bump(issues, "pages-sum"); else throw new ApiValidationError("쪽 합계가 totalCount와 다르다", "pages-sum");
  }
  return { total, pages, pageSize, items, capped: false };
}

/**
 * 한 지번을 칸으로 접는다(순수 함수, 호 단위 값은 이 함수 안에서만 산다).
 * priceItems: 허용 필드만 남긴 hsprc 항목, areaItems: 같은 전유공용면적 항목, years: [2025, 2026]
 * 반환: years별 { cells:[{a,n,m,f?}] (n>=3만), cellsBelow, households, mismatch, unjoined, invalid }
 * stdDay 연도가 years 밖이면 던진다(요청 범위 밖 응답).
 */
export function foldParcel(priceItems, areaItems, years, issues) {
  // 호별 전용면적(전유·주건축물 면적 합)과 지상 층
  const areaOf = new Map(); // pk -> { sum(1e-4㎡ 정수), flr:number|null }
  for (const it of areaItems) {
    if (it.exposPubuseGbCd !== "1" || it.mainAtchGbCd !== "0") continue;
    const a = Number(String(it.area).replace(/,/g, ""));
    if (!(a > 0)) continue; // 값이 비었거나 0: 합에 못 넣는다(호는 unjoined로 센다)
    const e = areaOf.get(it.mgmBldrgstPk) ?? { sum: 0, flr: null };
    e.sum += Math.round(a * 10000);
    if (it.flrGbCd === GROUND_FLOOR) {
      const f = Number(it.flrNo);
      if (Number.isInteger(f) && (e.flr === null || f < e.flr)) e.flr = f;
    }
    areaOf.set(it.mgmBldrgstPk, e);
  }

  const res = Object.fromEntries(years.map((y) => [y, { byPk: new Map(), invalid: 0 }]));
  for (const it of priceItems) {
    const y = yearOf(it.stdDay);
    if (!years.includes(y)) {
      if (issues) { bump(issues, "std-out-of-range"); continue; }
      throw new ApiValidationError("응답 stdDay 연도가 요청 범위 밖이다", "std-out-of-range");
    }
    const v = Number(String(it.hsprc).replace(/,/g, ""));
    if (!(v > 0) || !it.mgmBldrgstPk) { res[y].invalid += 1; continue; }
    const list = res[y].byPk.get(it.mgmBldrgstPk) ?? [];
    list.push({ v, crtn: String(it.crtnDay ?? "") });
    res[y].byPk.set(it.mgmBldrgstPk, list);
  }

  const out = {};
  for (const y of years) {
    const cells = new Map();
    let mismatch = 0;
    let unjoined = 0;
    for (const [pk, list] of res[y].byPk) {
      // 호당 항목 2건 규칙: 값이 같으면 하나, 다르면 crtnDay가 늦은 쪽(같으면 큰 값). 불일치 호 수만 센다.
      if (new Set(list.map((x) => x.v)).size > 1) mismatch += 1;
      list.sort((a, b) => (a.crtn < b.crtn ? 1 : a.crtn > b.crtn ? -1 : b.v - a.v));
      const price = list[0].v;
      const e = areaOf.get(pk);
      const ak = e ? areaKey(e.sum / 10000) : null;
      if (!ak) { unjoined += 1; continue; }
      const c = cells.get(ak) ?? { all: [], floors: new Map() };
      c.all.push(price);
      if (e.flr !== null) { const fl = c.floors.get(e.flr) ?? []; fl.push(price); c.floors.set(e.flr, fl); }
      cells.set(ak, c);
    }
    const kept = [];
    let below = 0;
    for (const [a, c] of [...cells].sort(([x], [z]) => (x < z ? -1 : 1))) {
      if (c.all.length < MIN_HOUSEHOLDS) { below += 1; continue; } // 값을 버리고 칸 수만 센다 (C2)
      const f = [...c.floors].filter(([, v]) => v.length >= MIN_HOUSEHOLDS).sort(([x], [z]) => x - z).map(([l, v]) => ({ l, n: v.length, m: median(v) }));
      const cell = { a, n: c.all.length, m: median(c.all) };
      if (f.length) cell.f = f;
      kept.push(cell);
    }
    out[y] = { cells: kept, cellsBelow: below, households: res[y].byPk.size, mismatch, unjoined, invalid: res[y].invalid };
  }
  return out;
}

// ---- 상태(부분 파일)·병합 ----

const partName = (n) => `part-${String(n).padStart(3, "0")}.json`;

/** 연도 폴더의 부분 파일들을 읽고 허용 필드 검사(C4)를 한다. 반환: [{name, data}] (이름순) */
async function readParts(outDir, year) {
  let names;
  try { names = (await readdir(path.join(outDir, String(year)))).filter((n) => /^part-\d{3,}\.json$/.test(n)).sort(); } catch { return []; }
  const parts = [];
  for (const name of names) {
    const data = JSON.parse(await readFile(path.join(outDir, String(year), name), "utf8"));
    assertDerived(data, { allowEmptyParcels: true });
    parts.push({ name, data });
  }
  return parts;
}

/** 끝난 지번 키 집합. 연도별 부분 파일의 지번 줄이 서로 다르면 던진다. */
export async function loadState(outDir, years) {
  const per = {};
  for (const y of years) per[y] = await readParts(outDir, y);
  const keysOf = (parts) => new Set(parts.flatMap((p) => p.data.parcels.map((x) => `${x.s}|${x.d}|${x.j}`)));
  const done = keysOf(per[years[0]]);
  for (const y of years.slice(1)) {
    const k = keysOf(per[y]);
    if (k.size !== done.size || [...k].some((x) => !done.has(x))) throw new ApiValidationError("연도별 부분 파일의 끝난 지번이 서로 다르다", "state-mismatch");
  }
  const nextPart = Math.max(0, ...per[years[0]].map((p) => Number(/\d+/.exec(p.name)[0]))) + 1;
  const prior = { calls: 0, parcels: 0 };
  for (const p of per[years[0]]) { prior.calls += p.data.meta.apiCalls ?? 0; prior.parcels += p.data.parcels.length; }
  return { done, nextPart, prior, parts: per };
}

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

export async function isComplete(outDir, years) {
  for (const y of years) if (!(await exists(path.join(outDir, `${y}.json`)))) return false;
  return true;
}

/** 부분 파일들을 <연도>.json 으로 병합한다. 20MB를 넘으면 던진다(닫지 말고 pm에). 반환: 병합 결과 {year: out}. */
export function mergeParts(parts, year, extraMeta) {
  const cells = [];
  const parcels = [];
  const seenCell = new Set();
  const seenParcel = new Set();
  const sum = { apiCalls: 0, cellsBelowMin: 0, households: 0, householdsMismatch: 0, householdsUnjoined: 0, householdsInvalid: 0 };
  const same = {};
  for (const { data } of parts) {
    const m = data.meta;
    for (const k of Object.keys(sum)) sum[k] += m[k] ?? 0;
    for (const k of ["rawCommit", "requestStartDate", "requestEndDate", "baseYear", "source"]) {
      if (same[k] !== undefined && same[k] !== m[k]) throw new ApiValidationError("부분 파일의 메타가 서로 다르다(요청 범위·대상 지번 커밋)", "state-mismatch");
      same[k] = m[k];
    }
    for (const c of data.cells) {
      const k = `${c.s}|${c.d}|${c.j}|${c.a}`;
      if (seenCell.has(k)) throw new ApiValidationError("부분 파일 사이에 같은 칸이 두 번 나온다", "state-mismatch");
      seenCell.add(k); cells.push(c);
    }
    for (const p of data.parcels) {
      const k = `${p.s}|${p.d}|${p.j}`;
      if (seenParcel.has(k)) throw new ApiValidationError("부분 파일 사이에 같은 지번이 두 번 나온다", "state-mismatch");
      seenParcel.add(k); parcels.push(p);
    }
  }
  cells.sort((a, b) => { const x = `${a.s}|${a.d}|${a.j}|${a.a}`; const z = `${b.s}|${b.d}|${b.j}|${b.a}`; return x < z ? -1 : x > z ? 1 : 0; });
  parcels.sort((a, b) => { const x = `${a.s}|${a.d}|${a.j}`; const z = `${b.s}|${b.d}|${b.j}`; return x < z ? -1 : x > z ? 1 : 0; });
  const last = parts.at(-1).data.meta;
  const out = {
    meta: {
      source: same.source, baseYear: year, license: last.license, licenseChecked: last.licenseChecked, rawCommit: same.rawCommit,
      requestStartDate: same.requestStartDate, requestEndDate: same.requestEndDate,
      apiCalls: sum.apiCalls + (extraMeta.unrecordedCalls ?? 0), targetParcels: extraMeta.targetParcels, parcels: parcels.length, cells: cells.length,
      cellsBelowMin: sum.cellsBelowMin, households: sum.households, householdsMismatch: sum.householdsMismatch,
      householdsUnjoined: sum.householdsUnjoined, householdsInvalid: sum.householdsInvalid, cappedParcels: extraMeta.cappedParcels,
      minHouseholds: MIN_HOUSEHOLDS, merged: true,
    },
    cells, parcels,
  };
  assertDerived(out, { allowEmptyParcels: true });
  const size = Buffer.byteLength(JSON.stringify(out));
  if (size > MAX_OUTPUT_BYTES) throw new ApiValidationError(`병합 파일 ${size}바이트가 20MB를 넘는다 - 닫지 말고 pm에 올릴 것`, "too-big");
  return out;
}

/** 이번 실행에 끝난 지번들로 연도별 부분 파일 내용을 만든다. */
export function buildPart({ year, finished, meta }) {
  const cells = [];
  const parcels = [];
  const agg = { cellsBelowMin: 0, households: 0, householdsMismatch: 0, householdsUnjoined: 0, householdsInvalid: 0 };
  for (const { t, byYear } of finished) {
    const r = byYear[year];
    for (const c of r.cells) cells.push({ s: t.s, d: t.d, j: t.j, ...c });
    parcels.push({ s: t.s, d: t.d, j: t.j, n: r.households });
    agg.cellsBelowMin += r.cellsBelow; agg.households += r.households; agg.householdsMismatch += r.mismatch;
    agg.householdsUnjoined += r.unjoined; agg.householdsInvalid += r.invalid;
  }
  const out = { meta: { ...meta, baseYear: year, parcels: parcels.length, cells: cells.length, ...agg, minHouseholds: MIN_HOUSEHOLDS }, cells, parcels };
  assertDerived(out, { allowEmptyParcels: true }); // 쓰기 직전 (C4·C2)
  return out;
}

/** 진행 요약용 투영: 지금까지 지번당 평균 호출 수 × 전체 지번. */
export function project({ callsSoFar, doneParcels, totalParcels, dailyBudget }) {
  if (doneParcels <= 0) return null;
  const perParcel = callsSoFar / doneParcels;
  const total = Math.round(perParcel * totalParcels);
  const left = Math.max(0, total - callsSoFar);
  return { perParcel, total, left, days: Math.ceil(left / dailyBudget) };
}

/**
 * 실행 한 번. 쓰기는 맨 끝이다. opts:
 *  baseUrl, key, rawDir(대상 지번을 정한 raw/ 체크아웃), names, loadTargets 결과 대신 targets(Map) 주입 가능, outDir, rawCommit,
 *  startDate, endDate, budget, gapMs, deadlineMs, softDeadlineMs, license·licenseChecked(비우면 official-price-license.mjs 상수), now(Date), fetchImpl, log(line)
 * 반환: 요약 객체(값 없음). 던지면 아무것도 쓰지 않은 것이다.
 */
export async function runCollector(opts) {
  const {
    key, targets, outDir, rawCommit, startDate = DEFAULT_START_DATE, endDate = DEFAULT_END_DATE, budget = DEFAULT_DAILY_BUDGET,
    gapMs = MIN_GAP_MS, deadlineMs = Infinity, softDeadlineMs = Infinity, license = OFFICIAL_PRICE_LICENSE, licenseChecked = OFFICIAL_PRICE_LICENSE_CHECKED, now = new Date(), fetchImpl, baseUrl, log = () => {},
    maxPages = MAX_PAGES_PER_PARCEL, // 시험용으로만 줄인다
  } = opts;
  const y0 = Number(startDate.slice(0, 4));
  const y1 = Number(endDate.slice(0, 4));
  const years = [];
  for (let y = y0; y <= y1; y += 1) years.push(y);
  const summary = { status: "", years, maxPages, calls: 0, finishedNow: 0, cappedParcels: 0, abandoned: 0, stopReason: null, wrote: [], merged: false };

  if (await isComplete(outDir, years)) {
    summary.status = "complete";
    // 병합 뒤에는 상한을 올려도 빠진 지번을 받을 길이 없다 - 몇 개가 빠진 채 병합됐는지만 알린다(지번 수, 키 아님).
    try { summary.cappedInMerged = JSON.parse(await readFile(path.join(outDir, `${years[0]}.json`), "utf8")).meta?.cappedParcels ?? null; } catch { summary.cappedInMerged = null; }
    log("공시가격 API 수집은 이미 끝났다(병합 파일 있음). 호출 없이 종료한다.");
    return summary;
  }
  const lic = checkLicense({ license, checked: licenseChecked, now });
  if (!/^[0-9a-f]{40}$/.test(rawCommit ?? "")) throw new ApiValidationError("rawCommit이 40자리 커밋 해시가 아니다", "input");
  if (!key) throw new ApiValidationError("PUBLIC_DATA_PORTAL_API_KEY가 비었다", "input");

  const order = orderTargets(targets);
  const state = await loadState(outDir, years);
  const pending = order.filter(([k]) => !state.done.has(k));
  const client = makeClient({ baseUrl, key, budget, gapMs, deadlineMs, fetchImpl });
  const finished = [];
  let stopped = null;

  for (const [k, t] of pending) {
    if (Date.now() >= softDeadlineMs) { stopped = "실행 시간 상한(새 지번 시작 안 함)"; break; }
    try {
      // 순서: hsprc 1쪽 -> (주택가격이 있으면) 면적 1쪽 -> 두 쪽 수로 상한·예산을 본 뒤에야 나머지 쪽을 받는다.
      // 상한 지번은 쪽 상한 판정(면적 첫 쪽의 totalCount)까지 호출이 2회뿐이라 매 실행 hsprc 전체를 다시 받는 낭비가 없다.
      // 못 끝낼 예산이면 시작한 일을 버리지 않고 여기서 멈춘다(받은 쪽은 버려지고 다음 실행에 처음부터).
      const afford = (more) => { if (client.st.calls + more > budget) throw new StopRun("호출 예산 소진(이 지번을 끝낼 예산이 모자라 다음 실행으로)"); };
      const priceFirst = await client.page(OP_PRICE, t, 1, { startDate, endDate });
      const pricePages = planPages(priceFirst);
      if (pricePages > maxPages) { summary.cappedParcels += 1; continue; }
      let price;
      let areaItems = [];
      if (priceFirst.items.length === 0) { // 2025·2026 주택가격이 없는 지번은 면적을 받지 않는다(1쪽 검증만)
        price = await fetchParcelOp(client, OP_PRICE, "price", t, { startDate, endDate }, { first: priceFirst, maxPages });
      } else {
        const areaFirst = await client.page(OP_AREA, t, 1, {});
        const areaPages = planPages(areaFirst);
        if (areaPages > maxPages) { summary.cappedParcels += 1; continue; }
        afford(pricePages - 1 + areaPages - 1);
        price = await fetchParcelOp(client, OP_PRICE, "price", t, { startDate, endDate }, { first: priceFirst, maxPages });
        areaItems = (await fetchParcelOp(client, OP_AREA, "area", t, {}, { first: areaFirst, maxPages })).items;
      }
      finished.push({ k, t, byYear: foldParcel(price.items, areaItems, years) }); // 호 단위 값은 여기서 버려진다
    } catch (e) {
      if (e instanceof StopRun) { stopped = e.reason; break; } // 이 지번은 통째로 버리고 다음 실행에 처음부터
      if (e instanceof ParcelFailed) {
        summary.abandoned += 1;
        if (client.st.consecutiveFail >= 5) { stopped = "연속 호출 실패 5회"; break; }
        continue;
      }
      throw e; // 검증 실패·권한 오류: 쓰기 없이 실패
    }
  }
  summary.calls = client.st.calls;
  summary.errCodes = client.st.errCodes;
  summary.finishedNow = finished.length;
  summary.stopReason = stopped;
  summary.targetParcels = order.length;
  summary.doneBefore = state.done.size;

  const meta = {
    source: SOURCE, license: lic.license, licenseChecked: lic.checked, rawCommit, requestStartDate: startDate, requestEndDate: endDate,
    apiCalls: client.st.calls, targetParcels: order.length, cappedParcels: summary.cappedParcels,
  };
  // 쓸 것을 전부 만들고 검사한 뒤에야 쓴다.
  const toWrite = [];
  if (finished.length) {
    for (const y of years) toWrite.push({ file: path.join(outDir, String(y), partName(state.nextPart)), data: buildPart({ year: y, finished, meta }) });
  }
  for (const w of toWrite) { await mkdir(path.dirname(w.file), { recursive: true }); await writeFile(w.file, JSON.stringify(w.data) + "\n"); summary.wrote.push(path.relative(outDir, w.file)); }

  summary.doneNow = state.done.size + finished.length;
  const remaining = order.length - summary.doneNow;
  // 끝까지 돌았고(중단 없음) 남은 것이 쪽 상한 지번뿐이면 병합한다.
  if (stopped === null && remaining === summary.cappedParcels && summary.abandoned === 0 && summary.doneNow > 0) {
    const merged = {};
    for (const y of years) {
      const parts = await readParts(outDir, y);
      merged[y] = mergeParts(parts, y, { targetParcels: order.length, cappedParcels: summary.cappedParcels, unrecordedCalls: finished.length ? 0 : summary.calls });
    }
    for (const y of years) await writeFile(path.join(outDir, `${y}.json`), JSON.stringify(merged[y]) + "\n");
    for (const y of years) for (const p of await readParts(outDir, y)) await rm(path.join(outDir, String(y), p.name));
    summary.merged = true;
  }
  const proj = project({ callsSoFar: state.prior.calls + summary.calls, doneParcels: summary.doneNow, totalParcels: order.length, dailyBudget: budget });
  summary.projection = proj;
  summary.callsSoFar = state.prior.calls + summary.calls;
  summary.status = summary.merged ? "merged" : stopped ? "stopped" : "pass-done";
  return summary;
}

/** 요약을 줄로. 호 단위 값·지번 키·응답 원문은 없다(C1). */
export function summaryLines(s, budget) {
  const L = [];
  L.push("## 공시가격 API 수집(#68) - 집계만");
  if (s.status === "complete") {
    L.push("- 이미 끝남: 병합 파일이 있어 호출하지 않았다.");
    if (s.cappedInMerged > 0) L.push(`- 주의: 쪽 상한 때문에 값이 빠진 채 병합된 지번이 ${s.cappedInMerged}개 있다(상한을 올려도 병합 뒤에는 받지 않는다 - pm에 올릴 것).`);
    return L;
  }
  L.push(`- 대상 지번 ${s.targetParcels}, 끝난 지번 ${s.doneNow}(이번 ${s.finishedNow}, 이전 ${s.doneBefore}), 남은 지번 ${s.targetParcels - s.doneNow}`);
  L.push(`- 이번 호출 ${s.calls}회(예산 ${budget}), 지금까지 ${s.callsSoFar}회. 버린 지번(일시 오류) ${s.abandoned}, 쪽 상한(${s.maxPages ?? MAX_PAGES_PER_PARCEL}쪽) 지번 ${s.cappedParcels}(지번 수만 적는다)`);
  if (s.errCodes && Object.keys(s.errCodes).length) L.push(`- 오류 분류: ${JSON.stringify(s.errCodes)}`);
  L.push(`- 중단: ${s.stopReason ?? "없음(남은 지번을 끝까지 돌았다)"}`);
  if (s.projection) L.push(`- 투영: 지번당 평균 ${s.projection.perParcel.toFixed(1)}회 -> 총 ${s.projection.total}회, 남은 ${s.projection.left}회 = 약 ${s.projection.days}일(하루 ${budget}회 기준)`);
  else L.push("- 투영: 끝난 지번이 없어 계산하지 못했다.");
  L.push(`- 쓴 파일 ${s.wrote.length}개${s.merged ? ", 병합 완료(부분 파일 삭제)" : ""}`);
  return L;
}
