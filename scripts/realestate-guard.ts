// 원본 슬롯에 쓰기 전에 응답을 거르는 판정(#863). 일 수집(fetch-realestate)과 얼린 슬롯 재수집(#861 조건 3)이 같은 함수를 쓴다.
//
// 왜 있나: 11230-202610 매매가 11-01·02 이틀 390행 → 77행으로 줄었고 `totalCount` 도 77로 맞아 그대로 슬롯과 화면에 나갔다. 빠진 313행은 11-03 에
// 돌아왔다(등기일이 붙어 해시는 전부 달랐다). 왜 빠졌는지는 모른다 - 그래서 응답을 고치지 않고, 줄어든 응답을 며칠 쓰지 않을 뿐이다.
//
// 이 판정이 막는 것은 「줄어든 응답이 슬롯에 쓰이는 것」 하나다. 돌아온 행의 재도장(등기일이 붙어 해시가 바뀐 행이 새 도착으로 찍힘)은 막지 못한다 -
// 원본 이력 57커밋에서 빠졌다 돌아온 매매 15건이 전부 해시가 바뀌어 돌아왔고 같은 해시로 돌아온 행은 0행이다(research/collection-drop-2026-11).
// 재도장은 #862 2단계 몫이다.
//
// 값(문턱·보류 일수)은 data-analyst 판정이다(#863 2026-11-15). 큰 감소 사건이 3건뿐이라 사건을 본 뒤 정한 값 판단이고 사전 등록이 아니다.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONCENTRATION } from "./realestate-concentration.ts";
import { RAW_DIR, buildSlotFile, kstDay, readSlotFile, writeSlotFile } from "./realestate-raw.ts";
import { slotKey } from "./realestate-slots.ts";

// 절반·행 수 규칙은 저장이 이만큼 이상인 슬롯에만 건다(#863 조건 2). 작은 슬롯은 1~2행 정정만으로 절반이 무너진다.
export const MIN_SAVED_ROWS = 20;

// 행 수 문턱은 #862 쏠림 규칙의 행 하한을 그대로 쓴다(숫자를 복제하지 않는다). 쏠림 규칙이 한 덩어리로 보는 크기가 10행부터이고,
// 이력의 감소는 1행 14건과 125·165·313행 3건뿐이라 2~124행 어디에 두어도 걸리는 사건이 같다.
export const DROP_ROWS = CONCENTRATION.minRows;

// 보류는 수집 회차가 아니라 그 슬롯을 받은 KST 날짜로 센다 - 10-09·10-10·10-18 처럼 하루에 2~3회차가 돈 날이 있어 회차로 세면 하루 만에 풀린다.
// 3일은 관측된 복귀 지연의 최댓값이다(큰 사건 2건 2일, 1행 사건 최대 3회차). 2일이면 11-01 사건과 여유가 0일이다.
export const HOLD_DAYS = 3;

// 보류 상태 파일. raw/ 아래라 데일리 워크플로가 원본과 같은 커밋(`push-docs.sh ... raw`)으로 남긴다. 보류가 없으면 파일도 없다.
export const HOLDS_FILE = "realestate-holds.json";

export const REASONS = Object.freeze({ zero: "zero", totalCount: "totalCount", half: "half", rows: "rows" });

/**
 * 응답을 저장 슬롯에 반영해도 되는가. 순수 함수 - 보류 일수를 모른다(일수는 nextHold 가 센다). #861 은 이 결과만 보고 그 회차에 반영하지 않는다.
 *
 * saved: readSlotFile 결과(없으면 null). response: { items, totalCount } - fetch 응답 그대로(totalCount 를 못 읽었으면 null).
 * 결과: { apply, reason, saved, received, releasable }. reason 은 REASONS 중 하나이거나 null(반영). releasable 은 보류 일수가 지나면 반영해도 되는 이유인가.
 *
 * - 저장이 없거나 깨진 슬롯(ok:false·count 없음)은 지킬 것이 없으니 그대로 반영한다. 잘린 첫 응답은 지금처럼 쓰고 slotStateOf 가 broken 으로 보아 다음에 다시 받는다.
 * - 0행: 행이 있던 슬롯에 빈 응답. 이력에 0건이다. 일수가 지나도 반영하지 않는다 - 국토부가 며칠 빈 응답을 주면 슬롯이 비고, 행이 돌아오는 날 전부 새 도착으로 찍힌다.
 * - totalCount 불일치: 응답이 스스로 잘렸다고 말한다. 이력에 0건이다. 반영하지 않는다.
 * - 절반 아래 또는 DROP_ROWS 이상 감소(저장 MIN_SAVED_ROWS 이상만): HOLD_DAYS 수집일 보류 뒤 반영한다 - 전월세 11260-202610 은 134개 신원이 빠진 뒤 31일째 돌아오지 않았다.
 */
export function judgeSlotResponse(saved, response) {
  const received = Array.isArray(response?.items) ? response.items.length : 0;
  const stored = saved && saved.ok !== false && Number.isInteger(saved.count) ? saved.count : null;
  const verdict = (reason) => ({ apply: reason === null, reason, saved: stored, received, releasable: reason === REASONS.half || reason === REASONS.rows });

  if (stored === null) return verdict(null);
  if (received === 0 && stored > 0) return verdict(REASONS.zero);
  if (Number.isInteger(response?.totalCount) && response.totalCount !== received) return { ...verdict(REASONS.totalCount), totalCount: response.totalCount };
  if (stored >= MIN_SAVED_ROWS) {
    if (received * 2 < stored) return verdict(REASONS.half);
    if (stored - received >= DROP_ROWS) return verdict(REASONS.rows);
  }
  return verdict(null);
}

/** 판정 이유의 한 줄(실행 요약용). #861 도 같은 글자를 쓴다. */
export function reasonText(verdict) {
  const counts = `저장 ${verdict.saved?.toLocaleString("ko-KR")}행 → 응답 ${verdict.received.toLocaleString("ko-KR")}행`;
  switch (verdict.reason) {
    case REASONS.zero:
      return `0행 응답(${counts})`;
    case REASONS.totalCount:
      return `totalCount 불일치(응답 ${verdict.received.toLocaleString("ko-KR")}행, totalCount ${verdict.totalCount?.toLocaleString("ko-KR")})`;
    case REASONS.half:
      return `절반 아래(${counts})`;
    case REASONS.rows:
      return `${DROP_ROWS}행 이상 감소(${counts})`;
    default:
      return "반영";
  }
}

/**
 * 보류 일수 세기. entry: 지난 보류 상태({ days, reason, saved, received }) 또는 undefined. day: 이번 응답을 받은 KST 날짜.
 * 결과: { apply, entry, released } - entry 가 null 이면 보류 상태를 지운다.
 *
 * 같은 날 두 번 받아도 하루로 센다. 보류한 날이 HOLD_DAYS 를 넘는 날(4번째 수집일) 아직도 걸리면 반영한다(released).
 * 반영할 응답이 오면(줄지 않았거나 돌아왔으면) 보류를 지운다. 0행·totalCount 처럼 일수와 무관하게 막는 응답은 보류 상태를 건드리지 않는다.
 */
export function nextHold(entry, verdict, day, holdDays = HOLD_DAYS) {
  if (verdict.apply) return { apply: true, entry: null, released: false };
  if (!verdict.releasable) return { apply: false, entry: entry ?? null, released: false };
  const days = entry?.days?.includes(day) ? entry.days : [...(entry?.days ?? []), day];
  if (days.length > holdDays) return { apply: true, entry: null, released: true };
  return { apply: false, entry: { days, reason: verdict.reason, saved: verdict.saved, received: verdict.received }, released: false };
}

export const holdsPath = (dir = RAW_DIR) => path.join(dir, HOLDS_FILE);

export async function readHolds(dir = RAW_DIR) {
  try {
    const parsed = JSON.parse(await readFile(holdsPath(dir), "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 키 순으로 쓴다(같은 상태면 같은 바이트). 보류가 하나도 없으면 파일을 지운다 - 평소 날에는 커밋에 아무것도 남지 않는다. 바뀌었으면 true. */
export async function writeHolds(holds, dir = RAW_DIR) {
  const keys = Object.keys(holds).sort();
  const file = holdsPath(dir);
  const before = await readFile(file, "utf-8").catch(() => null);
  if (keys.length === 0) {
    if (before === null) return false;
    await rm(file, { force: true });
    return true;
  }
  const text = `${JSON.stringify(Object.fromEntries(keys.map((key) => [key, holds[key]])), null, 2)}\n`;
  if (text === before) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

/** 이번 회차에 받지 않는 슬롯의 보류는 지운다(갱신 창을 벗어나 얼었거나 만료된 슬롯). 받으려다 실패한 슬롯은 남는다. */
export function pruneHolds(holds, fetchedKeys) {
  for (const key of Object.keys(holds)) if (!fetchedKeys.has(key)) delete holds[key];
  return holds;
}

/**
 * 한 슬롯의 응답을 판정하고, 반영할 때만 슬롯에 쓴다. 보류 중에는 슬롯 파일을 읽기만 하므로 슬롯·`arrivals` 가 바이트까지 그대로다.
 * 반영할 때는 지금까지와 같은 buildSlotFile → writeSlotFile 이라 도착 기록(trackArrivals)의 뜻이 바뀌지 않는다.
 * holds 는 readHolds 로 읽은 객체를 그대로 고친다 - 파일에 쓰는 것은 회차 끝의 writeHolds 한 번이다.
 */
export async function receiveSlot({ kind, code, yearMonth, response, observedAt, holds, dir = RAW_DIR }) {
  const saved = await readSlotFile(kind, code, yearMonth, dir);
  const verdict = judgeSlotResponse(saved, response);
  const key = slotKey(kind, code, yearMonth);
  const step = nextHold(holds[key], verdict, kstDay(observedAt));
  if (step.entry) holds[key] = step.entry;
  else delete holds[key];

  if (!step.apply) return { applied: false, changed: false, added: 0, verdict, hold: step.entry, released: false };

  const written = await writeSlotFile(
    buildSlotFile({ kind, code, yearMonth, items: response.items, totalCount: response.totalCount, observedAt }),
    dir
  );
  return { applied: true, ...written, verdict, hold: null, released: step.released };
}
