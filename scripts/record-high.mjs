/**
 * 신고가 다음 거래는 그 값을 따라갔나.
 *
 * "신고가"는 그 단지 그 평형의 새 시세처럼 읽힌다. 매물을 앞에 둔 사람은 그 값을 기준으로
 * 부른 값을 가늠하고, 내놓는 사람은 그 값으로 호가를 정한다. 그런데 같은 칸(구·단지·전용면적)에서
 * 신고가 바로 다음 거래가 그 신고가 이상이었던 비율을 세면, 아무 거래 뒤의 다음 거래보다 낮다.
 *
 * 세는 법이 결론을 만들지 않게 세 가지를 막았다.
 *
 * - 생존 편향(DIRECTION 체크리스트 7). 다음 거래가 있는 신고가만 세면 빨리 다시 팔리는 칸만
 *   남는다. 그래서 데이터 끝에서 WAIT_DAYS 이상 전에 생긴 거래만 놓고, 그 안에 다음 거래가
 *   없었던 것도 "다음 거래 없음"으로 같이 센다.
 * - 회귀 효과. 신고가는 정의상 위쪽 끝이라 다음 거래가 낮게 나오기 쉽다. 그래서 "그 전 최고가의
 *   98~100%였던 거래"(거의 최고가)를 대조군으로 같이 싣는다.
 * - 층. 신고가가 고층이었고 다음 거래가 저층이었을 뿐일 수 있다. 다음 거래가 같거나 높은 층인
 *   것만으로도 다시 센다.
 *
 * 문턱(선행 3건, 비교 기간 180일, 기다린 날 90일)을 2/5건, 90일, 180일로 흔들어도 결론이
 * 유지되는지 매번 다시 센다(research/record-high/). 365일은 원본이 2년이 안 돼 아직 셀 수 없다.
 */

export const MIN_PRIOR = 3;
export const MIN_SPAN_DAYS = 180;
export const WAIT_DAYS = 90;
export const NEAR_MAX = 0.98;

/** 흔들어 보는 문턱. 이 조합 전부에서 결론이 유지될 때만 "따라가지 않았다"고 쓴다. */
export const GRID = { prior: [2, 3, 5], span: [90, 180], wait: [90, 180] };

/** 조합 하나가 판정에 들어가려면 신고가가 이만큼은 있어야 한다. */
export const MIN_RECORDS = 100;

const DAY = 86400000;
const round1 = (value) => Math.round(value * 1000) / 10;

/** 원본 한 줄을 { cell, time, amount, floor }로. 해제·직거래는 뺀다(단지 가격 범위와 같은 규칙). */
export function toDeal(item) {
  if (String(item?.cdealType ?? "").trim()) return null;
  if (String(item?.dealingGbn ?? "").trim() !== "중개거래") return null;
  const amount = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
  const y = Number(item?.dealYear);
  const m = Number(item?.dealMonth);
  const d = Number(item?.dealDay);
  if (!(amount > 0) || !y || !m || !d) return null;
  return {
    cell: `${item.sggCd}|${item.aptNm}|${item.excluUseAr}`,
    time: Date.UTC(y, m - 1, d),
    amount,
    floor: Number(item?.floor) || 0,
  };
}

/** 칸별로 묶어 계약일 순으로. */
export function byCell(deals) {
  const cells = new Map();
  for (const deal of deals) {
    if (!cells.has(deal.cell)) cells.set(deal.cell, []);
    cells.get(deal.cell).push(deal);
  }
  for (const list of cells.values()) list.sort((a, b) => a.time - b.time);
  return cells;
}

const share = (values) => (values.length ? values.filter((v) => v >= 0).length / values.length : null);

/**
 * 문턱 한 벌로 센다. 같은 날 거래는 선행으로도 다음으로도 치지 않는다 - 같은 날 두 건 중
 * 어느 것이 먼저인지 원본은 모른다.
 */
export function measure(cells, end, { prior = MIN_PRIOR, span = MIN_SPAN_DAYS, wait = WAIT_DAYS } = {}) {
  const cut = end - wait * DAY;
  const out = { record: [], recordNone: 0, all: [], near: [], aboveOld: [], recordSameFloor: [], allSameFloor: [] };

  for (const list of cells.values()) {
    for (let i = 0; i < list.length; i += 1) {
      const deal = list[i];
      if (deal.time > cut) continue;
      const before = list.filter((x) => x.time < deal.time);
      if (before.length < prior || deal.time - before[0].time < span * DAY) continue;
      const next = list.find((x) => x.time > deal.time && x.time <= deal.time + wait * DAY);
      const max = Math.max(...before.map((x) => x.amount));
      const isRecord = deal.amount > max;

      if (!next) {
        if (isRecord) out.recordNone += 1;
        continue;
      }
      const change = next.amount / deal.amount - 1;
      const sameFloor = next.floor >= deal.floor;
      out.all.push(change);
      if (sameFloor) out.allSameFloor.push(change);
      if (isRecord) {
        out.record.push(change);
        out.aboveOld.push(next.amount > max);
        if (sameFloor) out.recordSameFloor.push(change);
      } else if (deal.amount >= NEAR_MAX * max) {
        out.near.push(change);
      }
    }
  }

  const median = (v) => {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const records = out.record.length + out.recordNone;
  return {
    prior,
    span,
    wait,
    records,
    withNext: out.record.length,
    none: records ? round1(out.recordNone / records) : null,
    record: out.record.length ? round1(share(out.record)) : null,
    recordMedian: out.record.length ? round1(median(out.record)) : null,
    all: out.all.length ? round1(share(out.all)) : null,
    allCount: out.all.length,
    near: out.near.length ? round1(share(out.near)) : null,
    nearCount: out.near.length,
    aboveOld: out.aboveOld.length ? round1(out.aboveOld.filter(Boolean).length / out.aboveOld.length) : null,
    recordSameFloor: out.recordSameFloor.length ? round1(share(out.recordSameFloor)) : null,
    recordSameFloorCount: out.recordSameFloor.length,
    allSameFloor: out.allSameFloor.length ? round1(share(out.allSameFloor)) : null,
  };
}

/** 결론: 신고가 다음 거래가 그 값 이상인 비율이 아무 거래 뒤보다 낮고, 그래도 절반 넘게는 그 전 최고가를 넘었다. */
export const holds = (m) => m.withNext >= MIN_RECORDS && m.record < m.all && m.aboveOld > 50;

export function grid(cells, end) {
  const rows = [];
  for (const prior of GRID.prior) {
    for (const span of GRID.span) {
      for (const wait of GRID.wait) {
        const m = measure(cells, end, { prior, span, wait });
        rows.push({ ...m, counted: m.withNext >= MIN_RECORDS, holds: holds(m) });
      }
    }
  }
  return rows;
}

// --- 문장 ------------------------------------------------------------------------

export function leadSentence(main, robust, locale = "ko") {
  if (!main || main.withNext < MIN_RECORDS) {
    return locale === "en"
      ? "Too few record highs with a following sale to say anything yet."
      : "다음 거래까지 이어진 신고가가 아직 적어 말할 수 있는 것이 없습니다.";
  }
  const counted = robust.filter((r) => r.counted);
  const stable = counted.length > 0 && counted.every((r) => r.holds);
  if (holds(main) && stable) {
    return locale === "en"
      ? `After a record high, the next sale in the same complex and unit type matched or beat it only ${main.record}% of the time — after any sale it is ${main.all}%. ` +
          `Yet ${main.aboveOld}% of those next sales still cleared the previous high. The floor moved up; the single record sale was not the new price.`
      : `신고가 다음에 같은 단지 같은 평형에서 거래된 값이 그 신고가 이상이었던 것은 ${main.record}%입니다. 아무 거래 뒤의 다음 거래는 ${main.all}%입니다. ` +
          `그래도 그 다음 거래의 ${main.aboveOld}%는 그 전 최고가는 넘었습니다 — 바닥은 올랐지만, 신고가 한 건이 곧 새 시세는 아니었습니다.`;
  }
  return locale === "en"
    ? `After a record high the next sale matched or beat it ${main.record}% of the time, against ${main.all}% after any sale. Across the threshold settings below the gap does not hold up, so this page does not claim record highs overshoot.`
    : `신고가 다음 거래가 그 값 이상이었던 것은 ${main.record}%, 아무 거래 뒤는 ${main.all}%입니다. 아래 문턱을 바꿔 세면 이 차이가 유지되지 않아, 이 화면은 "신고가가 시세를 앞질렀다"고 말하지 않습니다.`;
}

export function controlSentence(main, locale = "ko") {
  if (!main || main.withNext < MIN_RECORDS) return null;
  return locale === "en"
    ? `Part of this is just being at the top: sales within 2% below the previous high were followed by an equal or higher sale ${main.near}% of the time — a record high (${main.record}%) still falls short of that. ` +
        `It is not just floors either: counting only next sales on the same or a higher floor, record highs are followed ${main.recordSameFloor}% of the time and any sale ${main.allSameFloor}%.`
    : `위쪽 끝이라서 생기는 몫도 있습니다. 그 전 최고가의 98~100%였던 거래(거의 최고가) 뒤에는 다음 거래가 그 값 이상인 것이 ${main.near}%였습니다 — 신고가(${main.record}%)는 그보다도 낮습니다. ` +
        `층 때문만도 아닙니다. 다음 거래가 같거나 높은 층일 때만 세면 신고가 뒤는 ${main.recordSameFloor}%, 아무 거래 뒤는 ${main.allSameFloor}%입니다.`;
}

export function survivalSentence(main, locale = "ko") {
  if (!main || !main.records) return null;
  return locale === "en"
    ? `Only record highs at least ${main.wait} days old are counted, and ${main.none}% of them had no following sale within ${main.wait} days — they are counted as such rather than dropped, so fast-trading complexes are not over-represented.`
    : `${main.wait}일 넘게 지난 신고가만 셉니다. 그 가운데 ${main.none}%는 ${main.wait}일 안에 다음 거래가 없었습니다 — 빼지 않고 그렇게 셉니다. 다음 거래가 있는 것만 세면 빨리 다시 팔리는 단지만 남습니다.`;
}

const TABLE = {
  ko: {
    head: ["선행 거래", "비교 기간", "기다린 날", "신고가", "다음 거래 없음", "신고가 뒤 ≥", "아무 거래 뒤 ≥", "그 전 최고가 넘음", "결론"],
    days: (n) => `${n}일`,
    deals: (n) => `${n}건↑`,
    holds: "유지",
    breaks: "깨짐",
    thin: "표본 부족",
  },
  en: {
    head: ["Prior sales", "History", "Waited", "Records", "No next sale", "≥ after record", "≥ after any", "Beat old high", "Holds?"],
    days: (n) => `${n}d`,
    deals: (n) => `${n}+`,
    holds: "yes",
    breaks: "no",
    thin: "too few",
  },
};

export function gridTableHtml(rows, locale = "ko") {
  if (!rows?.length) return null;
  const t = TABLE[locale];
  const head = `<thead><tr>${t.head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>`;
  const tag = locale === "en" ? "en-US" : "ko-KR";
  const body = rows
    .map((r) => {
      const verdict = !r.counted
        ? `<span class="low-sample">${t.thin}</span>`
        : r.holds
          ? t.holds
          : `<span class="low-sample">${t.breaks}</span>`;
      const pct = (v) => (v === null ? "-" : `${v}%`);
      return (
        `<tr><td>${t.deals(r.prior)}</td><td>${t.days(r.span)}</td><td>${t.days(r.wait)}</td>` +
        `<td>${r.records.toLocaleString(tag)}</td><td>${pct(r.none)}</td><td>${pct(r.record)}</td>` +
        `<td>${pct(r.all)}</td><td>${pct(r.aboveOld)}</td><td>${verdict}</td></tr>`
      );
    })
    .join("");
  return `${head}<tbody>${body}</tbody>`;
}
