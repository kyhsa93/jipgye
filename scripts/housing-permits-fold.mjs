/**
 * 사업 단위 목록 -> (시군구, 달) 호수 접기 (#130, #58 단계 A). 순수 함수 - 네트워크도 파일도 안 쓴다.
 *
 * 정의 (ceo 계획 4절, 이슈 #130 본문):
 *  - 같은 사업(FIELDS.id)이 여러 판으로 오면 **최신 판 1건**만 센다(판 날짜 같으면 입력에서 뒤에 온 것).
 *  - 최신 판이 취소(FIELDS.cancel 값 있음)면 그 사업은 어디에도 세지 않는다. meta.cancelled로만 센다.
 *  - 값은 호수 합. 날짜 계열(사업승인·착공·사용승인)마다 그 날짜의 달에 귀속한다.
 *  - 그 날짜가 없거나 읽을 수 없는 사업은 버리지 않고 계열별 "미상" 칸(unknown)에 센다.
 *  - 입력 순서가 바뀌어도 같은 결과(키를 정렬해 내보낸다).
 *  - 호수를 읽을 수 없거나 핵심 필드가 없으면 던진다 - 가정한 필드 이름이 틀린 것을 조용히 0으로 접지 않는다.
 *  - 호수 0인 달·구는 만들지 않는다. 0과 결측의 구분은 수집 쪽의 전수 순회 성공 기록이 맡는다.
 */
import { FIELDS, PROJECTED_FIELDS, SERIES } from "./housing-permits-spec.mjs";

export class ShapeError extends Error {}

// ---- 응답 모양 진단 (#133 남은 항목) ----
// 응답 모양 오류 때 공개 Actions 로그에 남기는 것은 **필드 이름(키)·개수·타입 이름뿐**이다. 사업 관리번호·사업명·주소·
// 사업주체명 같은 값은 어떤 경우에도 찍지 않는다. 키 자리에 값이 들어와 있을 수 있으니(XML 속성, 잘못된 파서 결과 등)
// 키는 영문으로 시작하는 짧은 영문숫자_ 이름일 때만 그대로 내고, 아니면 "<비정형 키>"로 센다.
// 순서는 마스킹 -> 판정 -> 자르기다(자르기를 먼저 하면 경계에 걸친 인증키 앞부분이 남는다, PR #109와 같은 원칙).

/** 한 줄에 이름으로 내는 키의 최대 개수. 넘는 것은 개수로만 적는다. */
export const MAX_KEYS = 50;
const KEY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** 값의 종류 이름. 값 자체는 담지 않는다. */
function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "배열";
  switch (typeof value) {
    case "string": return "문자열";
    case "number": return "숫자";
    case "boolean": return "불리언";
    case "object": return "객체";
    default: return "기타";
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * 키 목록 -> 한 줄. 정렬 -> (키마다) mask -> 이름 패턴 판정 -> 상한 자르기 순서다.
 * types를 주면 이름 뒤에 (타입 이름)을 붙인다(키 -> 값의 타입 이름 객체).
 */
export function listKeys(keys, mask, types = null) {
  const good = [];
  let odd = 0;
  for (const key of [...keys].map(String).sort()) {
    const shown = String(mask(key));
    if (KEY_NAME.test(shown)) good.push(types ? `${shown}(${types[key] ?? "?"})` : shown);
    else odd += 1;
  }
  const head = good.slice(0, MAX_KEYS).join(", ");
  const more = good.length > MAX_KEYS ? ` … 외 ${good.length - MAX_KEYS}개` : "";
  const oddText = odd > 0 ? `${head || more ? " · " : ""}<비정형 키> ${odd}개` : "";
  return (head + more + oddText) || "(없음)";
}

function keysOf(value, mask) {
  return isObject(value) ? listKeys(Object.keys(value), mask) : `(객체 아님: ${typeName(value)})`;
}

/**
 * 파싱된 응답 하나 -> 진단 줄 셋(문자열 배열). 값은 이 안에서 이미 버려져 있어 호출한 쪽이 들고 있어도 새지 않는다.
 *  1) 응답 구조 키: 최상위·response·header·body·items 컨테이너의 키 이름
 *  2) 항목 개수와 items·item 컨테이너의 타입 이름
 *  3) 첫 항목의 키 개수와 이름(타입 이름 포함)
 */
export function describeShape(parsed, mask) {
  const response = isObject(parsed) ? parsed.response : undefined;
  const body = isObject(response) ? response.body : undefined;
  const items = isObject(body) ? body.items : undefined;
  const rawItem = isObject(items) ? items.item : undefined;
  const list = rawItem === undefined || rawItem === null || rawItem === "" ? [] : Array.isArray(rawItem) ? rawItem : [rawItem];
  const first = list.find(isObject);
  const firstTypes = first ? Object.fromEntries(Object.entries(first).map(([k, v]) => [k, typeName(v)])) : null;
  return [
    `응답 구조 키: 최상위 [${keysOf(parsed, mask)}] · response [${keysOf(response, mask)}] · header [${keysOf(isObject(response) ? response.header : undefined, mask)}] · body [${keysOf(body, mask)}] · items [${keysOf(items, mask)}]`,
    `항목 ${list.length}개 · items ${typeName(items)} · item ${typeName(rawItem)}`,
    first ? `첫 항목 키 ${Object.keys(first).length}개: ${listKeys(Object.keys(first), mask, firstTypes)}` : "첫 항목 키 0개: (객체인 항목 없음)",
  ];
}

const CORE = [FIELDS.id, FIELDS.sigungu, FIELDS.units];
const NULLABLE = [FIELDS.cancel, FIELDS.version, ...Object.values(FIELDS.dates)];

/**
 * 필요한 필드만 남긴 사본(없는 필드는 만들지 않는다 - 아래 "한 건도 없으면 실패" 검사가 그대로 작동해야 한다).
 * extra는 입력 시점 필드(B4) 이름 하나.
 */
export function projectItem(item, extra = null) {
  const out = {};
  for (const key of extra ? [...PROJECTED_FIELDS, extra] : PROJECTED_FIELDS) {
    if (item && key in item) out[key] = item[key];
  }
  return out;
}

/** 매 항목에 있어야 하는 핵심 필드. 수집기는 쪽마다, 접기는 전체에 대해 부른다. */
export function assertCoreFields(items) {
  for (const item of items) {
    for (const key of CORE) {
      if (!item || !(key in item)) throw new ShapeError(`알 수 없는 응답 필드: ${key} 없음 (가정한 필드 이름이 틀렸을 수 있음)`);
    }
  }
}

/**
 * 날짜·취소·판 필드는 API가 빈 값을 생략할 수 있어 항목마다 요구하지 않는다. 대신 전체에서
 * 한 건도 없으면 필드 이름이 틀린 것으로 보고 던진다.
 */
function assertNullableFields(items) {
  if (items.length === 0) return;
  for (const key of NULLABLE) {
    if (!items.some((item) => key in item)) throw new ShapeError(`알 수 없는 응답 필드: ${key}가 어느 항목에도 없음`);
  }
}

/** "YYYYMMDD"·"YYYY-MM-DD" -> "YYYY-MM". 달력에 없는 날짜·다른 꼴은 null. */
export function parseDay(value) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}`;
}

/** 호수를 읽을 수 있으면 수, 아니면 null. 수집기가 쪽마다 불러 오류에 구·쪽 위치를 붙이게 한다. */
export function readUnits(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  const n = Number(text);
  return text === "" || !Number.isFinite(n) || n < 0 ? null : n;
}

// 공개 Actions 로그에 나가는 메시지다 - 사업 관리번호·읽지 못한 원래 값은 적지 않는다(#141). 위치는 수집기가 붙인다.
function parseUnits(value) {
  const n = readUnits(value);
  if (n === null) throw new ShapeError(`호수를 읽을 수 없음 (${FIELDS.units} 필드 값이 숫자가 아니거나 음수)`);
  return n;
}

const isCancelled = (item) => String(item[FIELDS.cancel] ?? "").trim() !== "";
const versionOf = (item) => String(item[FIELDS.version] ?? "").trim();

function add(cell, units) {
  cell.projects += 1;
  cell.units += units;
}

function sortedObject(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

/** options.inputTimeField: 입력 시점 필드 이름. 주면 meta 옆에 (입력월 - 사업승인월) 분포를 센다(B4, 사업 단위 값은 남기지 않는다). */
export function foldProjects(items, { inputTimeField = null } = {}) {
  assertCoreFields(items);
  assertNullableFields(items);

  const latest = new Map();
  items.forEach((item, index) => {
    const id = String(item[FIELDS.id]).trim();
    const prev = latest.get(id);
    // 판 날짜는 문자열 비교(YYYYMMDD·YYYY-MM-DD 같은 꼴끼리). 같으면 뒤에 온 입력이 이긴다.
    if (!prev || versionOf(item) > versionOf(prev.item) || (versionOf(item) === versionOf(prev.item) && index > prev.index)) {
      latest.set(id, { item, index });
    }
  });

  const series = Object.fromEntries(SERIES.map((s) => [s, {}]));
  const unknown = Object.fromEntries(SERIES.map((s) => [s, {}]));
  const cancelledPermit = {}; // 서울 전체, 달별. B2의 "취소 포함" 값 - 구별 칸은 만들지 않는다
  const lag = inputTimeField ? { field: inputTimeField, histogram: {}, unparsed: 0 } : null;
  let cancelled = 0;
  let projects = 0;

  for (const { item } of latest.values()) {
    if (isCancelled(item)) {
      cancelled += 1;
      const month = parseDay(item[FIELDS.dates.permit]);
      if (month) add((cancelledPermit[month] ??= { projects: 0, units: 0 }), parseUnits(item[FIELDS.units]));
      continue;
    }
    const sgg = String(item[FIELDS.sigungu]).trim();
    const units = parseUnits(item[FIELDS.units]);
    projects += 1;
    if (lag) {
      const input = parseDay(item[inputTimeField]);
      const permit = parseDay(item[FIELDS.dates.permit]);
      if (input && permit) {
        const d = monthIndex(input) - monthIndex(permit);
        lag.histogram[d] = (lag.histogram[d] ?? 0) + 1;
      } else lag.unparsed += 1;
    }
    for (const s of SERIES) {
      const month = parseDay(item[FIELDS.dates[s]]);
      if (month) add(((series[s][sgg] ??= {})[month] ??= { projects: 0, units: 0 }), units);
      else add((unknown[s][sgg] ??= { projects: 0, units: 0 }), units);
    }
  }

  for (const s of SERIES) {
    for (const sgg of Object.keys(series[s])) series[s][sgg] = sortedObject(series[s][sgg]);
    series[s] = sortedObject(series[s]);
    unknown[s] = sortedObject(unknown[s]);
  }
  if (lag) lag.histogram = Object.fromEntries(Object.keys(lag.histogram).map(Number).sort((a, b) => a - b).map((k) => [k, lag.histogram[k]]));
  return {
    meta: { input: items.length, projects, duplicates: items.length - latest.size, cancelled },
    series,
    unknown,
    cancelledPermit: sortedObject(cancelledPermit),
    ...(lag ? { inputLag: lag } : {}),
  };
}
