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

/**
 * 낙제 사본 (#133). n<3 합침(scripts/housing-permits-merge.mjs)의 독립 구현에서 규칙 하나만 끈다:
 *   merge: false -> 아무것도 합치지 않는다(n<3 셀이 그대로 나간다)
 *   guard: false -> 작은 구가 하나뿐이어도 그 구만 "기타 구"로 보낸다(서울 합계와의 차로 역산된다)
 * 입력은 한 달의 {구코드: {projects, units}} 한 칸이고 출력은 {구코드 또는 "기타 구": 칸}.
 */
export function flawedMergeMonth(cells, { merge = true, guard = true } = {}) {
  const out = {};
  const other = { projects: 0, units: 0 };
  let otherGus = 0;
  for (const [gu, c] of Object.entries(cells)) {
    if (merge && c.projects < 3) { other.projects += c.projects; other.units += c.units; otherGus += 1; } else out[gu] = { ...c };
  }
  if (otherGus === 0) return out;
  if (guard && otherGus < 2) {
    // 가장 사업 수가 적은 공개 구를 더 합친다(같으면 코드 순)
    const [gu] = Object.entries(out).sort((a, b) => a[1].projects - b[1].projects || a[0].localeCompare(b[0]))[0] ?? [];
    if (gu) { other.projects += out[gu].projects; other.units += out[gu].units; delete out[gu]; }
  }
  if (other.projects >= 3) out["기타 구"] = other;
  return out;
}

/**
 * B2 낙제 사본 (#133). 대조 정의(PREREG 4절 B2)에서 하나만 틀린 판정:
 *   useInclusive: true -> 취소를 포함한 값으로 판정한다(판정은 제외한 값이어야 한다)
 *   holdShort: false   -> 창이 12개 미만이어도 통과/불통과를 낸다(보류여야 한다)
 * hub·eco는 Map(월 색인 -> 값). 반환은 "pass"|"fail"|"hold".
 */
export function flawedB2Verdict(hubExcl, hubIncl, eco, { useInclusive = false, holdShort = true } = {}) {
  const hub = useInclusive ? hubIncl : hubExcl;
  const diffs = [];
  for (const [end] of hub) {
    let h = 0; let e = 0; let ok = true;
    for (let k = 0; k < 12; k += 1) {
      if (!hub.has(end - k) || !eco.has(end - k)) { ok = false; break; }
      h += hub.get(end - k); e += eco.get(end - k);
    }
    if (ok && e > 0) diffs.push(Math.abs(h - e) / e);
  }
  if (holdShort && diffs.length < 12) return "hold";
  if (diffs.length === 0) return "hold";
  diffs.sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  const median = diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
  return median <= 0.1 ? "pass" : "fail";
}
