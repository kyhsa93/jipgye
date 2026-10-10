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
import { FIELDS, SERIES } from "./housing-permits-spec.mjs";

export class ShapeError extends Error {}

const CORE = [FIELDS.id, FIELDS.sigungu, FIELDS.units];
const NULLABLE = [FIELDS.cancel, FIELDS.version, ...Object.values(FIELDS.dates)];

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

function parseUnits(value, id) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  const n = Number(text);
  if (text === "" || !Number.isFinite(n) || n < 0) throw new ShapeError(`호수를 읽을 수 없음 (${FIELDS.units}=${JSON.stringify(String(value))}, 사업 ${id})`);
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

export function foldProjects(items) {
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
  let cancelled = 0;
  let projects = 0;

  for (const [id, { item }] of latest) {
    if (isCancelled(item)) { cancelled += 1; continue; }
    const sgg = String(item[FIELDS.sigungu]).trim();
    const units = parseUnits(item[FIELDS.units], id);
    projects += 1;
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
  return {
    meta: { input: items.length, projects, duplicates: items.length - latest.size, cancelled },
    series,
    unknown,
  };
}
