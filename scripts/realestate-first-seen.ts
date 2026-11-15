// 신고 기준 「이번 주에 들어온 행」의 도착일 복원(#862 2단계 조건 6). 슬롯의 `arrivals` 는 행 해시(itemKey)가 처음 보인 수집일이라,
// 등기일·해제·동이 붙어 해시가 바뀐 행과 응답에서 빠졌다 돌아온 행이 새 도장을 받아 그 주의 새 신고로 다시 세였다(11230-202610 313행: 10-21 도장 → 11-03 재도장).
//
// 슬롯과 `arrivals` 는 한 바이트도 바꾸지 않는다(조건 7 - 원장 C1 은 「소스 커밋 raw 의 지금 판 도착일」이 정의이고, 재도장도 그 정의 안이다). 대신 따로 둔 상태 파일에
// 「행 신원」이 처음 보인 날을 쌓고, 대표값(build-realestate readWindowItems)과 week-digest 가 도착일을 그 날로 앞당겨 읽는다.
//
// 왜 별도 상태인가(git 이력이 아니라): Daily 는 actions/checkout 기본값(얕은 클론 1커밋)으로 돌아 빌드 때 지난 판을 읽을 수 없다. 워크플로는 바꾸지 않는다.
// 상태는 raw/first-seen/<kind>/<구>-<달>.json 이다 - push-docs.sh 의 데이터 경로(raw) 안이라 Daily 커밋에 그대로 실리고, C1(ledger-snapshot 의 `raw/sale`·`raw/rent` 경로 패턴)과
// 슬롯을 읽는 다른 코드(raw/<kind>/ 바로 아래 `구-달.json` 만 읽는다)에 걸리지 않는다. 처음 상태는 git 이력을 처음부터 재생해 만든다(scripts/dev/first-seen-backfill.ts).
//
// 신원: 행에서 `rgstDate`·`cdealType`·`cdealDay`·`aptDong` 을 뺀 나머지 칸(#863 data-analyst 판정과 같은 정의 - 돌아온 매매 15행 중 14행은 rgstDate 와 aptDong 이 함께 채워졌다).
// 같은 신원의 행이 여럿이면 도착일 목록(중복 허용)으로 센다 - 정렬한 도장과 정렬한 기억을 차례로 짝지어 각자 이른 쪽을 쓴다. 그래야 신원이 같은 다른 거래가 새로 들어오면
// 그 하나는 새 도착으로 남는다. 한계: 신원이 같은 행이 빠진 뒤 「다른」 거래가 같은 신원으로 들어오면 돌아온 행으로 본다(구별할 칸이 없다).
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RAW_DIR, itemKey } from "./realestate-raw.ts";

/** 신원에서 빼는 칸. 이 칸만 바뀐 행은 같은 거래다. */
export const IDENTITY_SKIP = Object.freeze(["rgstDate", "cdealType", "cdealDay", "aptDong"]);

/** 도장이 없는 행(추적을 시작하기 전부터 있던 행, 또는 슬롯을 처음 받은 날의 행)의 날. 어느 날짜보다 앞이라 어떤 신고 창에도 들지 않는다. */
export const BEFORE_TRACKING = "0000-00-00";

export const FIRST_SEEN_DIR = "first-seen";

export const firstSeenPath = (kind, code, yearMonth, dir = RAW_DIR) => path.join(dir, FIRST_SEEN_DIR, kind, `${code}-${yearMonth}.json`);

/** 행 신원(12자 해시). 슬롯의 행은 키가 정렬된 모양(realestate-raw canonical)이라 남은 칸의 순서가 정해져 있다. */
export function rowIdentity(item) {
  const rest = Object.fromEntries(Object.entries(item ?? {}).filter(([key]) => !IDENTITY_SKIP.includes(key)));
  return createHash("sha1").update(JSON.stringify(rest)).digest("hex").slice(0, 12);
}

const earlier = (a, b) => (a < b ? a : b);

/** 상태 파일 { 날: [신원…] } → Map(신원 → 날 목록, 오름차순). 없거나 깨졌으면 null. */
export function parseFirstSeen(json) {
  if (!json || typeof json !== "object") return null;
  const seen = new Map();
  for (const day of Object.keys(json).sort()) {
    for (const id of json[day] ?? []) {
      if (!seen.has(id)) seen.set(id, []);
      seen.get(id).push(day);
    }
  }
  return seen;
}

/** Map → 파일 글자. 날 순, 날마다 신원 순(중복은 그대로)이고 한 날이 한 줄이라 Daily 커밋의 차이가 그날 줄 하나로 남는다. 같은 입력이면 같은 바이트다. */
export function serializeFirstSeen(seen) {
  const byDay = new Map();
  for (const [id, days] of seen) for (const day of days) byDay.set(day, [...(byDay.get(day) ?? []), id]);
  const lines = [...byDay.keys()].sort().map((day) => `${JSON.stringify(day)}:${JSON.stringify(byDay.get(day).sort())}`);
  return lines.length ? `{\n${lines.join(",\n")}\n}\n` : "{}\n";
}

/** 슬롯의 행을 신원별로 묶고, 묶음 안에서 도장 순(같으면 행 순)으로 세운다: Map(신원 → [{ index, stamp }]). */
function groupByIdentity(file) {
  const arrivals = file?.arrivals ?? {};
  const groups = new Map();
  (file?.items ?? []).forEach((item, index) => {
    const id = rowIdentity(item);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ index, stamp: arrivals[itemKey(item)] ?? null });
  });
  for (const rows of groups.values()) rows.sort((a, b) => (a.stamp ?? BEFORE_TRACKING).localeCompare(b.stamp ?? BEFORE_TRACKING) || a.index - b.index);
  return groups;
}

/**
 * 슬롯 행마다 읽을 도착일(행 순서의 배열). 도장이 없는 행은 예전처럼 undefined(어느 창에도 들지 않는다).
 * 도장이 있으면 같은 신원의 k번째 도장과 기억의 k번째 날 중 이른 쪽이다. 기억(seen)이 없으면 도장 그대로 - 상태 파일이 없는 곳에서는 예전과 같은 결과다.
 * seen 은 갱신 전이든 뒤든 답이 같다(갱신은 같은 짝의 이른 쪽을 남기므로).
 */
export function effectiveArrivals(file, seen) {
  const items = file?.items ?? [];
  const arrivals = file?.arrivals ?? {};
  if (!seen) return items.map((item) => arrivals[itemKey(item)]);
  const out = new Array(items.length);
  for (const [id, rows] of groupByIdentity(file)) {
    const known = seen.get(id) ?? [];
    rows.forEach(({ index, stamp }, k) => {
      out[index] = stamp == null ? undefined : k < known.length ? earlier(stamp, known[k]) : stamp;
    });
  }
  return out;
}

/** 지금 판의 행으로 기억을 갱신한다(제자리). 바뀌었으면 true. 빠진 행의 기억은 지우지 않는다 - 돌아오면 그 날로 읽어야 한다. */
export function updateFirstSeen(seen, file) {
  let changed = false;
  for (const [id, rows] of groupByIdentity(file)) {
    const known = seen.get(id) ?? [];
    const next = [...known];
    rows.forEach(({ stamp }, k) => {
      const day = stamp ?? BEFORE_TRACKING;
      next[k] = k < known.length ? earlier(day, known[k]) : day;
    });
    next.sort();
    if (next.length !== known.length || next.some((day, i) => day !== known[i])) {
      seen.set(id, next);
      changed = true;
    }
  }
  return changed;
}

export async function readFirstSeen(kind, code, yearMonth, dir = RAW_DIR) {
  try {
    return parseFirstSeen(JSON.parse(await readFile(firstSeenPath(kind, code, yearMonth, dir), "utf-8")));
  } catch {
    return null;
  }
}

/**
 * 창의 달(months) 슬롯마다 기억을 갱신해 쓰고, 창 밖 달의 상태 파일은 지운다. 신고 기준 대표값이 읽는 달(windowMonths)과 같은 달을 넘긴다.
 * 고정 순서(달 → 구 → 종류)로 돈다. 바뀐 파일만 쓴다. 돌려주는 값은 { written, removed } 파일 수.
 */
export async function refreshFirstSeen(months, codes, { dir = RAW_DIR, readSlot }) {
  let written = 0;
  for (const yearMonth of months) {
    for (const code of codes) {
      for (const kind of ["sale", "rent"]) {
        const file = await readSlot(kind, code, yearMonth, dir);
        if (file?.ok === false || !Array.isArray(file?.items)) continue;
        const seen = (await readFirstSeen(kind, code, yearMonth, dir)) ?? new Map();
        if (!updateFirstSeen(seen, file)) continue;
        const target = firstSeenPath(kind, code, yearMonth, dir);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, serializeFirstSeen(seen));
        written += 1;
      }
    }
  }
  let removed = 0;
  const keep = new Set(months);
  for (const kind of ["sale", "rent"]) {
    const names = await readdir(path.join(dir, FIRST_SEEN_DIR, kind)).catch(() => []);
    for (const name of names.sort()) {
      const matched = /^\d{5}-(\d{6})\.json$/.exec(name);
      if (!matched || keep.has(matched[1])) continue;
      await rm(path.join(dir, FIRST_SEEN_DIR, kind, name), { force: true });
      removed += 1;
    }
  }
  return { written, removed };
}
