/**
 * n<3 합침 (#133, PREREG 5절 "n<3 합침"). 순수 함수 - foldProjects와 folded.json 사이의 별도 단계다.
 * 처리 전 접기 결과는 저장소에 올리지 않는다(소유자 조건 2: 셀 안 사업 수 3 미만은 내지 않거나 합친다).
 *
 * 셀 = (구, 달, 계열). n = 중복·취소를 제거한 사업 수. 규칙:
 *  1. n이 3 미만인 구의 칸은 같은 달·계열의 "기타 구" 한 칸으로 합친다(구 이름은 남기지 않는다).
 *  2. 합친 구가 2개 이상이고 합친 칸의 n이 3 이상이어야 한다. 합친 구가 1개뿐이면 서울 합계와의 차로
 *     그 구가 역산되므로, 사업 수가 가장 적은 공개 구(같으면 코드 순)를 더 합친다. 조건이 설 때까지 되풀이한다.
 *  3. 공개 구를 다 합쳐도 안 서면(서울 전체가 n<3) 그 달·계열은 내지 않는다. PREREG의 "서울 합계만 낸다"는
 *     서울 합계도 n<3인 경우 소유자 조건 2의 "내지 않거나"로 처리한다 - meta.merge.suppressedCells로 센다.
 *  4. "미상" 칸(달 없음)에도 같은 규칙을 구 단위로 적용한다.
 *  5. 서울 전체 취소 호수 칸(cancelledPermit)은 사업 수 3 미만이면 내지 않는다.
 * 한 사업(대단지)이 호수를 지배하는 경우는 이 규칙이 막지 못한다(PREREG 5절 6항, 알려 둔 한계).
 */
export const MIN_PROJECTS = 3;
export const OTHER_KEY = "기타 구";

const sortedObject = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

/**
 * 한 칸 묶음 {구: {projects, units}} -> {public: {구: 칸}, other: 칸|null, suppressed: bool}.
 */
function mergeCells(cells) {
  const pub = new Map();
  const other = { projects: 0, units: 0 };
  let otherGus = 0;
  for (const gu of Object.keys(cells).sort()) {
    const c = cells[gu];
    if (c.projects < MIN_PROJECTS) {
      other.projects += c.projects; other.units += c.units; otherGus += 1;
    } else pub.set(gu, { projects: c.projects, units: c.units });
  }
  if (otherGus === 0) return { pub, other: null, merged: 0, suppressed: false };
  while (otherGus < 2 || other.projects < MIN_PROJECTS) {
    if (pub.size === 0) return { pub, other: null, merged: 0, suppressed: true };
    // 사업 수가 가장 적은 공개 구, 같으면 코드 순(결정성)
    const [gu, c] = [...pub].sort((a, b) => a[1].projects - b[1].projects || a[0].localeCompare(b[0]))[0];
    other.projects += c.projects; other.units += c.units; otherGus += 1;
    pub.delete(gu);
  }
  return { pub, other, merged: otherGus, suppressed: false };
}

export function mergeSmallCells(folded) {
  const stats = { minProjects: MIN_PROJECTS, otherKey: OTHER_KEY, mergedCells: 0, suppressedCells: 0 };
  const series = {};
  const unknown = {};
  const take = (r) => {
    if (r.suppressed) stats.suppressedCells += 1;
    else if (r.other) stats.mergedCells += 1;
  };

  for (const name of Object.keys(folded.series)) {
    const byMonth = {};
    for (const [gu, months] of Object.entries(folded.series[name])) {
      for (const [month, cell] of Object.entries(months)) (byMonth[month] ??= {})[gu] = cell;
    }
    const out = {};
    for (const month of Object.keys(byMonth).sort()) {
      const r = mergeCells(byMonth[month]);
      take(r);
      for (const [gu, c] of r.pub) (out[gu] ??= {})[month] = c;
      if (r.other) (out[OTHER_KEY] ??= {})[month] = r.other;
    }
    series[name] = sortedObject(Object.fromEntries(Object.entries(out).map(([gu, m]) => [gu, sortedObject(m)])));
  }

  for (const name of Object.keys(folded.unknown)) {
    const r = mergeCells(folded.unknown[name]);
    take(r);
    const out = Object.fromEntries(r.pub);
    if (r.other) out[OTHER_KEY] = r.other;
    unknown[name] = sortedObject(out);
  }

  const cancelledPermit = {};
  for (const [month, c] of Object.entries(folded.cancelledPermit ?? {})) {
    if (c.projects >= MIN_PROJECTS) cancelledPermit[month] = { ...c };
    else stats.suppressedCells += 1;
  }

  return {
    ...folded,
    meta: { ...folded.meta, merge: stats },
    series,
    unknown,
    cancelledPermit: sortedObject(cancelledPermit),
  };
}
