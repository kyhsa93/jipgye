/**
 * 사업 단위 목록 -> (시군구, 달) 호수 접기 (#130, #58 단계 A). 순수 함수 - 네트워크도 파일도 안 쓴다.
 *
 * 정의 (PREREG 5절 명확화 2, 이슈 #133·#146):
 *  - 접기 키는 FIELDS.id(mgmHsrgstPk) 단독이다. 같은 키가 여러 행이면 **crtnDay가 큰 행 1건**만 센다('최신 생성 행' -
 *    crtnDay는 판 날짜가 아니라 그 행의 생성일이다). 같으면 totHhldCnt가 큰 쪽, 그래도 같으면 apprvDay가 큰 쪽(PREREG 4항).
 *    그래도 같은 행끼리는 수집 순서에 기대지 않게 내용(JSON)이 큰 쪽을 쓴다. 동률 건수는 meta.ties로 보고한다.
 *  - 취소는 이 응답에서 관측할 수 없다(PREREG 「취소 판정」 4항, A안). 취소를 구분하지 않고 접은 사업 전부를 센다.
 *    meta.cancellation = "관측 불가"이며 0건이 아니다. 취소 계열(cancelledPermit)은 만들지 않는다.
 *  - 값은 totHhldCnt(호수) 합. 0이거나 숫자가 아닌 사업은 호수 합에 0으로 기여하고 n(사업 수)에는 센다(PREREG 「호수」).
 *    그 건수를 meta.unitsZero·meta.unitsInvalid로 보고한다.
 *  - 날짜 계열(permit·start·complete)마다 그 날짜의 달에 귀속한다. complete 필드는 해소 규칙이 정하기 전(FIELDS.dates.complete가
 *    null)에는 계열을 만들지 않고 meta.completeField = null로 남긴다.
 *  - 그 날짜가 없거나 읽을 수 없는 사업은 버리지 않고 계열별 "미상" 칸(unknown)에 센다.
 *  - 입력 순서가 바뀌어도 같은 결과(키를 정렬해 내보낸다).
 *  - 핵심 필드가 없으면 던진다 - 필드 이름이 틀린 것을 조용히 0으로 접지 않는다.
 *  - 사업이 있으면 호수가 0이어도 그 칸의 n으로 센다(칸이 생긴다). 사업이 0건인 달·구는 만들지 않고, 0과 결측의 구분은
 *    수집 쪽의 전수 순회 성공 기록이 맡는다.
 */
import { CANCELLATION, COMPLETE_CANDIDATES, FIELDS, PROJECTED_FIELDS, SERIES } from "./housing-permits-spec.mjs";

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
const NULLABLE = [FIELDS.version, FIELDS.tieBreak, ...Object.values(FIELDS.dates).filter(Boolean)];

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
 * 항목이 객체가 아니면 값 없이 거절한다 - 문자열이 들어와 있으면 그 값(공개 로그에 나갈 수 있는)을 메시지에 넣지 않고
 * 타입 이름만 적는다. 수집기는 쪽마다, 응답 모양 진단이 먼저 쌓인 뒤에 부른다.
 */
export function assertItemObjects(items) {
  items.forEach((item, index) => {
    if (!isObject(item)) throw new ShapeError(`응답 항목이 객체가 아님: ${index + 1}번째 항목 (${typeName(item)})`);
  });
}

/**
 * 날짜·생성일 필드는 API가 빈 값을 생략할 수 있어 항목마다 요구하지 않는다. 대신 전체에서
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

// 호수는 0·비숫자·음수도 던지지 않는다(PREREG 「호수」): 호수 합에 0으로 기여하고 n에는 센다.
const unitsOf = (item) => readUnits(item[FIELDS.units]) ?? 0;

const digits = (v) => String(v ?? "").trim().replace(/\D/g, "");
const keyOf = (item) => String(item[FIELDS.id] ?? "").trim();

/**
 * 같은 키의 두 행 중 이길 쪽. crtnDay -> totHhldCnt -> apprvDay 순(PREREG 4항), 그래도 같으면 내용 비교로 순서와 무관하게 정한다.
 * tally가 있으면 어디까지 동률이었는지 센다(sameCrtn: crtnDay가 같아 다음 기준으로 넘어간 쌍 비교 횟수, full: 세 기준이 모두 같은 쌍 비교 횟수).
 */
function wins(a, b, tally) {
  const byDay = digits(a[FIELDS.version]).localeCompare(digits(b[FIELDS.version]), "en");
  if (byDay !== 0) return byDay > 0;
  tally.sameCrtn += 1;
  const byUnits = unitsOf(a) - unitsOf(b);
  if (byUnits !== 0) return byUnits > 0;
  const byPermit = digits(a[FIELDS.tieBreak]).localeCompare(digits(b[FIELDS.tieBreak]), "en");
  if (byPermit !== 0) return byPermit > 0;
  tally.full += 1;
  return JSON.stringify(a) > JSON.stringify(b);
}

function add(cell, units) {
  cell.projects += 1;
  cell.units += units;
}

function sortedObject(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

/**
 * options.inputTimeField: 입력 시점 필드 이름. 주면 meta 옆에 (입력월 - 건축허가월) 분포를 센다(B4, 사업 단위 값은 남기지 않는다).
 * options.completeField: complete 계열 필드. 기본은 FIELDS.dates.complete(해소 전에는 null)이고, null이면 complete 계열을 만들지 않는다.
 */
export function foldProjects(items, { inputTimeField = null, completeField = FIELDS.dates.complete } = {}) {
  assertCoreFields(items);
  assertNullableFields(items);
  const dateField = { ...FIELDS.dates, complete: completeField };

  const latest = new Map();
  const tally = { sameCrtn: 0, full: 0 };
  let blankKey = 0;
  items.forEach((item, index) => {
    let id = keyOf(item);
    // 키가 비면 서로 다른 사업을 한 키로 뭉치지 않는다 - 그 행은 각각 한 사업으로 세고 건수를 보고한다.
    if (id === "") { id = `\u0000blank-${index}`; blankKey += 1; }
    const prev = latest.get(id);
    if (!prev || wins(item, prev, tally)) latest.set(id, item);
  });

  const series = Object.fromEntries(SERIES.map((s) => [s, {}]));
  const unknown = Object.fromEntries(SERIES.map((s) => [s, {}]));
  const lag = inputTimeField ? { field: inputTimeField, histogram: {}, unparsed: 0 } : null;
  let projects = 0;
  let unitsZero = 0;
  let unitsInvalid = 0;

  for (const item of latest.values()) {
    const sgg = String(item[FIELDS.sigungu]).trim();
    const raw = readUnits(item[FIELDS.units]);
    if (raw === null) unitsInvalid += 1;
    else if (raw === 0) unitsZero += 1;
    const units = raw ?? 0;
    projects += 1;
    if (lag) {
      const input = parseDay(item[inputTimeField]);
      const permit = parseDay(item[dateField.permit]);
      if (input && permit) {
        const d = monthIndex(input) - monthIndex(permit);
        lag.histogram[d] = (lag.histogram[d] ?? 0) + 1;
      } else lag.unparsed += 1;
    }
    for (const s of SERIES) {
      if (!dateField[s]) continue; // 해소 전 complete: 계열을 만들지 않는다
      const month = parseDay(item[dateField[s]]);
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
    meta: {
      input: items.length, projects, duplicates: items.length - latest.size,
      ties: { sameCrtnDay: tally.sameCrtn, full: tally.full }, blankKey, unitsZero, unitsInvalid,
      cancellation: CANCELLATION, completeField: completeField ?? null, completeCandidates: COMPLETE_CANDIDATES,
    },
    series,
    unknown,
    ...(lag ? { inputLag: lag } : {}),
  };
}
