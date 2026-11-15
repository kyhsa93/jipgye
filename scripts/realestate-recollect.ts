// 얼린 매매 슬롯의 재수집 덧씌움(#861). 슬롯(raw/sale/<구>-<달>.json)과 `arrivals` 는 한 바이트도 바꾸지 않고, 다시 받은 응답이 저장과 다른 행만
// 따로 둔 덧씌움 파일에 담는다. 합치는 읽기 층은 이 파일의 mergeRecollect 한 곳이고, 그것을 부르는 소비자는 시세 칸(build-complex-price)·
// 해제(build-cancellation)·등기(registration, build-district-change 가 부름) 셋이다(완료 조건 2).
//
// 왜 슬롯에 쓰지 않나: #820 판정 - 슬롯에 그대로 쓰면 202605~08 에서 13,653행이 오늘 도착으로 찍힌다(trackArrivals 는 행 해시가 처음 보인 날을
// 도장으로 쓴다). 그러면 신고 기준 주간 집계·week-digest·원장 C1 이 「이번 주 새 신고」를 수십 주치로 잘못 센다(조건 4).
//
// 어디에 두나: raw/recollect/sale/<구>-<달>.json. raw 아래라 push-docs.sh 의 데이터 경로에 실리고, 슬롯을 읽는 코드(raw/<kind>/ 바로 아래 `구-달.json`)와
// 원장 C1(ledger-snapshot readSource 의 `^raw\/(sale|rent)\/(\d{5})-(\d{6})\.json$`)에 걸리지 않는다 - data-analyst 11-15 판정(C1 은 덧씌움을 읽지 않는다).
// 행 신원의 첫 관측일(raw/first-seen, #885)도 이 파일을 읽지 않는다: 덧씌운 행에는 첫 관측일이 없다(동결과 재수집 사이 언제 나타났는지 모른다).
//
// 파일에 담는 것(#175 제한 1 - 원천 응답 항목과 수집 메타만):
//   changed  저장 행 하나(from = itemKey)를 바꾼 행(item). 계약 키(cancellation contractKey)가 같은 저장 행과 짝지은 것 - 등기일·해제·동이 붙은 행이 대부분이다.
//   appeared 저장에 짝이 없는 새 행.
//   gone     「원천에서 사라짐」(pm 11-15 범위 확인) - 응답에 짝이 없는 저장 행의 itemKey. 합칠 때 그 행을 뺀다. 행 본문은 슬롯에 그대로 있다.
// 그래서 합친 결과는 다시 받은 응답과 행 단위로 같다(건수까지). 바뀐 행이 하나도 없으면 파일을 두지 않는다.
//
// 낡은 덧씌움: 덧씌움은 만들 때의 슬롯(base.observedAt·base.count)에 대한 차이다. 슬롯이 그 뒤 다시 쓰였으면(백필·재조회) 차이가 맞지 않으므로
// 덧씌움을 버리고 슬롯 그대로 읽는다. 없앨 행(from·gone)이 슬롯에 없어도 같다 - 반쯤 합친 값을 내느니 저장 그대로가 낫다.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { contractKey, isCancelled } from "./cancellation.ts";
import { marketDeal } from "./complex-price.ts";
import { RAW_DIR, itemKey, readSlotFile } from "./realestate-raw.ts";

export const RECOLLECT_DIR = "recollect";

/** 덧씌움이 담을 수 있는 행 칸. 저장 매매 사본의 칸 그대로다(raw/sale 145,319행·#820 응답 37,042행 모두 이 20칸, 2026-11-15 셈). #175 제한 1(사본 필드 동결). */
export const SALE_FIELDS = Object.freeze([
  "aptDong", "aptNm", "buildYear", "buyerGbn", "cdealDay", "cdealType", "dealAmount", "dealDay", "dealMonth", "dealYear",
  "dealingGbn", "estateAgentSggNm", "excluUseAr", "floor", "jibun", "landLeaseholdGbn", "rgstDate", "sggCd", "slerGbn", "umdNm",
]);

export const overlayPath = (code, yearMonth, dir = RAW_DIR) => path.join(dir, RECOLLECT_DIR, "sale", `${code}-${yearMonth}.json`);

const sortKey = (item) => JSON.stringify(item);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 행에 SALE_FIELDS 밖 칸이 있으면 그 칸 이름들(정렬). 없으면 빈 배열. */
export function unknownFields(items) {
  const allowed = new Set(SALE_FIELDS);
  const out = new Set();
  for (const item of items ?? []) for (const key of Object.keys(item ?? {})) if (!allowed.has(key)) out.add(key);
  return [...out].sort();
}

function countBy(rows, keyOf) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

/** left 의 묶음마다 right 에 같은 키로 있는 수만큼 앞에서 덜어 낸 나머지. 같은 키가 여러 행일 수 있어 집합이 아니라 건수로 뺀다. */
function subtract(left, right) {
  const out = [];
  for (const [key, rows] of left) out.push(...rows.slice(right.get(key)?.length ?? 0));
  return out;
}

// 시세 칸 값을 가르는 다섯 칸(구·단지·면적·계약일·금액). #820 측정(research/slot-freeze-2026-11/measure.mjs)의 「값 행」 정의와 같다.
const valueKey = (item) => {
  const d = marketDeal(item);
  return d ? JSON.stringify([d.district, d.apt, d.area, d.date, d.amount]) : null;
};

/**
 * 저장 행과 다시 받은 행의 차이. 둘 다 buildSlotFile 이 정렬한 모양(canonical)이어야 해시가 맞는다.
 * 해시가 같은 행은 건수만큼 지우고, 남은 행끼리 계약 키로 짝짓는다(해제 아닌 행 먼저). 짝 없는 저장 행이 gone, 짝 없는 응답 행이 appeared 다.
 * 셈(회차 표, 조건 6): valueOut·valueIn 은 #820 의 값 나감·들어옴, gone·gonePublic 은 사라진 행(시장 행).
 */
export function diffRows(storedItems, fetchedItems) {
  const stored = storedItems ?? [];
  const fetched = fetchedItems ?? [];
  const storedByHash = countBy(stored, itemKey);
  const fetchedByHash = countBy(fetched, itemKey);
  const storedLeft = countBy(subtract(storedByHash, fetchedByHash), contractKey);
  const fetchedLeft = countBy(subtract(fetchedByHash, storedByHash), contractKey);
  const liveFirst = (a, b) => Number(isCancelled(a)) - Number(isCancelled(b)) || byText(sortKey(a), sortKey(b));

  const changed = [];
  const appeared = [];
  const gone = [];
  for (const key of [...new Set([...storedLeft.keys(), ...fetchedLeft.keys()])].sort()) {
    const before = [...(storedLeft.get(key) ?? [])].sort(liveFirst);
    const after = [...(fetchedLeft.get(key) ?? [])].sort(liveFirst);
    const paired = Math.min(before.length, after.length);
    for (let i = 0; i < paired; i += 1) changed.push({ from: itemKey(before[i]), item: after[i] });
    gone.push(...before.slice(paired));
    appeared.push(...after.slice(paired));
  }

  const storedValue = countBy(stored, valueKey);
  const fetchedValue = countBy(fetched, valueKey);
  return {
    changed,
    appeared,
    gone,
    counts: {
      rows: stored.length,
      received: fetched.length,
      market: stored.filter((item) => marketDeal(item)).length,
      valueOut: subtract(storedValue, fetchedValue).length,
      valueIn: subtract(fetchedValue, storedValue).length,
      changed: changed.length,
      appeared: appeared.length,
      gone: gone.length,
      gonePublic: gone.filter((item) => marketDeal(item)).length,
    },
  };
}

/**
 * 덧씌움 파일 내용. slot: 저장 슬롯(readSlotFile), items: 다시 받은 행(buildSlotFile 로 정렬한 것), observedAt: 다시 받은 시각.
 * 차이가 없으면 null(파일을 두지 않는다).
 */
export function buildOverlay({ slot, items, totalCount, observedAt }) {
  const { changed, appeared, gone } = diffRows(slot?.items, items);
  if (!changed.length && !appeared.length && !gone.length) return null;
  return {
    kind: "sale",
    district: slot.district,
    yearMonth: slot.yearMonth,
    observedAt,
    count: items.length,
    totalCount: Number.isInteger(totalCount) ? totalCount : items.length,
    base: { observedAt: slot.observedAt, count: slot.count },
    changed: changed.sort((a, b) => byText(a.from, b.from) || byText(sortKey(a.item), sortKey(b.item))),
    appeared: appeared.sort((a, b) => byText(sortKey(a), sortKey(b))),
    gone: gone.map(itemKey).sort(),
  };
}

/** 파일 글자. 머리 한 줄 뒤 행마다 한 줄이라 회차 사이 diff 가 행 단위로 남는다. 같은 입력이면 같은 바이트다. */
export function serializeOverlay({ changed, appeared, gone, ...meta }) {
  const list = (rows) => (rows.length ? `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]` : "[]");
  return `${JSON.stringify(meta).slice(0, -1)},"changed":${list(changed)},"appeared":${list(appeared)},"gone":${JSON.stringify(gone)}}\n`;
}

export async function readOverlay(code, yearMonth, dir = RAW_DIR) {
  try {
    return JSON.parse(await readFile(overlayPath(code, yearMonth, dir), "utf-8"));
  } catch {
    return null;
  }
}

/** 덧씌움을 쓰거나(overlay) 지운다(null). 바뀌었으면 true. */
export async function writeOverlay(code, yearMonth, overlay, dir = RAW_DIR) {
  const file = overlayPath(code, yearMonth, dir);
  const before = await readFile(file, "utf-8").catch(() => null);
  if (!overlay) {
    if (before === null) return false;
    await rm(file, { force: true });
    return true;
  }
  const text = serializeOverlay(overlay);
  if (text === before) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

/**
 * 합치는 읽기 층(한 곳). 슬롯 + 덧씌움 → 다시 받은 응답과 같은 행 목록. 덧씌움이 없거나 낡았으면 슬롯을 그대로 돌려준다(같은 객체).
 * 돌려주는 값의 arrivals 는 슬롯 것 그대로다 - 덧씌운 행에는 도착일이 없다(도착 기준 소비자는 이 함수를 부르지 않는다).
 */
export function mergeRecollect(slot, overlay) {
  if (!overlay || !slot || slot.ok === false || !Array.isArray(slot.items)) return slot;
  if (overlay.base?.observedAt !== slot.observedAt || overlay.base?.count !== slot.count) return slot;

  const drop = new Map();
  for (const key of [...(overlay.changed ?? []).map((row) => row.from), ...(overlay.gone ?? [])]) drop.set(key, (drop.get(key) ?? 0) + 1);
  const kept = [];
  for (const item of slot.items) {
    const key = itemKey(item);
    const left = drop.get(key) ?? 0;
    if (left > 0) drop.set(key, left - 1);
    else kept.push(item);
  }
  if ([...drop.values()].some((left) => left > 0)) return slot;

  const items = [...kept, ...(overlay.changed ?? []).map((row) => row.item), ...(overlay.appeared ?? [])].sort((a, b) => byText(sortKey(a), sortKey(b)));
  return { ...slot, count: items.length, totalCount: overlay.totalCount ?? items.length, items, recollectedAt: overlay.observedAt };
}

/** 소비자가 readSlotFile 대신 부르는 것. 매매만 덧씌운다(전월세는 재수집 대상이 아니다). */
export async function readRecollectedSlot(kind, code, yearMonth, dir = RAW_DIR) {
  const slot = await readSlotFile(kind, code, yearMonth, dir);
  if (kind !== "sale" || !slot) return slot;
  return mergeRecollect(slot, await readOverlay(code, yearMonth, dir));
}
