/**
 * 낙제 사본 (#130). 접기(scripts/housing-permits-fold.mjs)가 어떤 실수를 하면 시험이 빨개져야 하는지를
 * 코드로 박아 둔다. 진짜 접기와 코드를 나누지 않는 독립 구현이다 - 진짜를 고쳐서 같이 틀리면 안 되기 때문.
 * 옵션 하나만 꺼서 실수 하나만 만든다:
 *   dedupe: false        -> 같은 사업을 신고·변경 건수만큼 센다
 *   dropCancelled: false -> 취소 사업을 포함한다
 *   keepUndated: false   -> 날짜 없는 사업을 조용히 버린다("미상" 칸에 세지 않는다)
 */
import { FIELDS, SERIES } from "../../scripts/housing-permits-spec.mjs";

const month = (v) => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v ?? "").trim());
  return m ? `${m[1]}-${m[2]}` : null;
};

export function flawedFold(items, { dedupe = true, dropCancelled = true, keepUndated = true } = {}) {
  let list = items;
  if (dedupe) {
    const latest = new Map();
    for (const it of items) {
      const prev = latest.get(it[FIELDS.id]);
      if (!prev || String(it[FIELDS.version] ?? "") >= String(prev[FIELDS.version] ?? "")) latest.set(it[FIELDS.id], it);
    }
    list = [...latest.values()];
  }
  const out = { series: {}, unknown: {} };
  for (const s of SERIES) { out.series[s] = {}; out.unknown[s] = {}; }
  for (const it of list) {
    if (dropCancelled && String(it[FIELDS.cancel] ?? "").trim()) continue;
    const sgg = String(it[FIELDS.sigungu]);
    const units = Number(it[FIELDS.units]);
    for (const s of SERIES) {
      const m = month(it[FIELDS.dates[s]]);
      if (m) {
        const cell = ((out.series[s][sgg] ??= {})[m] ??= { projects: 0, units: 0 });
        cell.projects += 1; cell.units += units;
      } else if (keepUndated) {
        const cell = (out.unknown[s][sgg] ??= { projects: 0, units: 0 });
        cell.projects += 1; cell.units += units;
      }
    }
  }
  return out;
}
