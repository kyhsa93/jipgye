/**
 * 앞으로 2년 서울 공동주택 입주 예정(#60). 숫자를 모아 사실 문장과 표를 만든다.
 *
 * 해석은 붙이지 않는다 - "입주가 많으면 값이 내린다"는 검증하지 않았다. 공급을 인허가로 재 본 지표는
 * 12개월 뒤 값을 더 잘 맞히지 못했다(#57, research/indicators-3/). 그 사실을 문장에 같이 적는다.
 * 사업유형: "분양임대"는 임대 단지가 아니라 분양과 임대분이 섞인 단지다(반포디에이치클래스트 5,007세대,
 * 디에이치 방배 등 재건축·재개발). 순수 임대는 "임대"(청년안심주택 등)뿐이라, 그것만 따로 떼어 적는다.
 */
import { DISTRICTS } from "./realestate-districts.ts";
import { moveInSourceLine } from "./source-lines.ts";

/** 따옴표 안 쉼표를 견디는 CSV 한 줄 읽기. */
export function parseCsv(text) {
  const rows = [];
  for (const line of String(text ?? "").replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map((cells) => Object.fromEntries(head.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])));
}

const TYPES = ["분양", "분양임대", "임대"];

/** 반기: "2026-12" → "2026H2", "2027-00"(달 미정) → "2027?". */
export const halfOf = (month) => {
  const [y, m] = String(month).split("-");
  if (!y || !m) return null;
  if (m === "00") return `${y}?`;
  return `${y}H${Number(m) <= 6 ? 1 : 2}`;
};

/** 주소의 자치구("서울특별시 서초구 …" → "서초구"). 못 읽으면 null. */
const guOf = (r) => /서울특별시\s+(\S+구)/.exec(r["주소"])?.[1] ?? null;

export function summarize(rows) {
  const seoul = rows.filter((r) => r["지역"] === "서울" && Number(r["세대수"]) > 0);
  if (!seoul.length) return null;
  const units = (list) => list.reduce((s, r) => s + Number(r["세대수"]), 0);
  const halves = new Map();
  for (const r of seoul) {
    const h = halfOf(r["입주예정월"]);
    if (!h) continue;
    if (!halves.has(h)) halves.set(h, []);
    halves.get(h).push(r);
  }
  const byDistrict = new Map();
  for (const r of seoul) {
    const gu = guOf(r);
    if (!gu) continue;
    if (!byDistrict.has(gu)) byDistrict.set(gu, []);
    byDistrict.get(gu).push(r);
  }
  const dated = seoul.map((r) => r["입주예정월"]).filter((m) => !m.endsWith("-00")).sort();
  return {
    complexes: seoul.length,
    units: units(seoul),
    from: dated[0] ?? null,
    to: dated.at(-1) ?? null,
    types: TYPES.map((type) => {
      const list = seoul.filter((r) => r["사업유형"] === type);
      return { type, complexes: list.length, units: units(list) };
    }),
    halves: [...halves]
      // 달 미정("2027?")은 그해 끝에 둔다.
      .sort(([a], [b]) => (a.replace("?", "H9") < b.replace("?", "H9") ? -1 : 1))
      .map(([half, list]) => ({ half, complexes: list.length, units: units(list), rentalUnits: units(list.filter((r) => r["사업유형"] === "임대")) })),
    districts: [...byDistrict]
      .map(([name, list]) => ({ name, complexes: list.length, units: units(list) }))
      .sort((a, b) => b.units - a.units || (a.name < b.name ? -1 : 1)),
  };
}

const num = (n, en?: boolean) => n.toLocaleString(en ? "en-US" : "ko-KR");
const ymText = (ym, en?: boolean) => {
  const [y, m] = ym.split("-");
  return en ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}` : `${y}년 ${Number(m)}월`;
};
const halfText = (h, en) => {
  const m = /^(\d{4})(H[12]|\?)$/.exec(h);
  if (!m) return h;
  if (m[2] === "?") return en ? `${m[1]}, month not set` : `${m[1]}년 (달 미정)`;
  return en ? `${m[2] === "H1" ? "Jan–Jun" : "Jul–Dec"} ${m[1]}` : `${m[1]}년 ${m[2] === "H1" ? "상반기" : "하반기"}`;
};
const basisText = (basis, en?: boolean) => {
  if (!basis) return "";
  const [y, m, d] = basis.split("-");
  return en ? `as of ${ymText(`${y}-${m}`, true).replace(/^(\w+)/, `$1 ${Number(d)},`)}` : `${y}년 ${Number(m)}월 ${Number(d)}일 기준`;
};

export function moveInLead(s, basis, locale = "ko") {
  if (!s) return null;
  const en = locale === "en";
  const t = Object.fromEntries(s.types.map((x) => [x.type, x]));
  const rental = t["임대"];
  const owned = { complexes: s.complexes - rental.complexes, units: s.units - rental.units };
  if (en) {
    return (
      `The Korea Real Estate Board and R114 estimate (${basisText(basis, true)}) that ${num(s.units, true)} homes in ${num(s.complexes, true)} apartment complexes of 30+ units will be completed in Seoul from ${ymText(s.from, true)} to ${ymText(s.to, true)}. ` +
      `${num(rental.units, true)} homes in ${rental.complexes} complexes are pure rental (youth housing and the like); the other ${num(owned.units, true)} homes in ${owned.complexes} complexes are for sale, including redevelopment complexes with some rental units. ` +
      `How move-ins move prices has not been verified here — supply measured by building permits did not improve the 12-month forecast.`
    );
  }
  return (
    `한국부동산원·부동산114 추정(${basisText(basis)})으로 ${ymText(s.from)}부터 ${ymText(s.to)}까지 서울에 30세대 이상 공동주택 ${num(s.complexes)}개 단지 ${num(s.units)}세대가 입주할 예정입니다. ` +
    `이 가운데 순수 임대(청년안심주택 등)가 ${rental.complexes}개 단지 ${num(rental.units)}세대이고, 나머지 ${owned.complexes}개 단지 ${num(owned.units)}세대는 분양 단지입니다(재건축·재개발로 임대분이 섞인 단지 포함). ` +
    `입주 물량이 값에 어떻게 작용하는지는 여기서 검증하지 않았습니다 — 인허가로 재 본 공급 지표는 12개월 뒤 값을 더 잘 맞히지 못했습니다.`
  );
}

export function moveInTableHtml(s, locale = "ko") {
  if (!s) return null;
  const en = locale === "en";
  const head = en ? ["Period", "Complexes", "Homes", "Of which pure rental"] : ["기간", "단지", "세대", "그중 순수 임대"];
  const rows = s.halves.map(
    (h) => `<tr><td>${halfText(h.half, en)}</td><td data-label="${head[1]}">${num(h.complexes, en)}</td><td data-label="${head[2]}">${num(h.units, en)}</td><td data-label="${head[3]}">${num(h.rentalUnits, en)}</td></tr>`
  );
  return `<thead><tr>${head.map((x) => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
}

/** 자치구별 한 줄 - 많은 곳부터, 세대수만. 단지 수가 적은 구는 한 단지가 다 정한다는 것을 숫자로 보인다. */
export function moveInDistrictsText(s, locale = "ko") {
  if (!s) return null;
  const en = locale === "en";
  const list = s.districts.map((d) => (en ? `${d.name} ${num(d.units, true)} (${d.complexes})` : `${d.name} ${num(d.units)}세대(${d.complexes}곳)`));
  return (en ? "By district: " : "자치구별: ") + list.join(" · ");
}

/**
 * 자치구 × 반기 집계(#677). 25구를 모두 낸다 - 예정이 없는 구도 한 줄이다("예정 없음"을 말하려면 그 구가 있어야 한다).
 * 반기는 자료에 있는 것만(달이 정해진 것), 오름차순이다. 달 미정("2027?")은 어느 칸에도 넣지 않고 undated 로 따로 센다 -
 * 칸에 넣으면 없는 달을 지어 쓰는 것이고, 버리면 구별 합이 서울 합과 어긋난다.
 * units 는 분양·분양임대·임대 모두의 세대수, rental 은 그중 순수 "임대"(청년안심주택 등)만이다(위 TYPES 설명). 둘 다 halves 와 같은 순서의 배열이다.
 * 자료에 25구 밖의 구 이름이 나오면 뒤에 덧붙인다 - 이름 목록이 낡아도 세대를 조용히 버리지 않는다.
 */
export function districtByHalf(rows, names = DISTRICTS.map((d) => d.name)) {
  const seoul = rows.filter((r) => r["지역"] === "서울" && Number(r["세대수"]) > 0);
  const cells = new Map();
  const undated = new Map();
  const halves = new Set<string>();
  const add = (map, key, units, rental) => {
    const cur = map.get(key) ?? { units: 0, rental: 0 };
    cur.units += units;
    cur.rental += rental;
    map.set(key, cur);
  };
  for (const r of seoul) {
    const gu = guOf(r);
    const half = halfOf(r["입주예정월"]);
    if (!gu || !half) continue;
    const units = Number(r["세대수"]);
    const rental = r["사업유형"] === "임대" ? units : 0;
    if (half.endsWith("?")) add(undated, gu, units, rental);
    else {
      halves.add(half);
      add(cells, `${gu}|${half}`, units, rental);
    }
  }
  const cols = [...halves].sort();
  const seen = new Set([...[...cells.keys()].map((k) => k.split("|")[0]), ...undated.keys()]);
  const all = [...names, ...[...seen].filter((g) => !names.includes(g)).sort()];
  const total = [...undated.values()].reduce((s, v) => ({ units: s.units + v.units, rental: s.rental + v.rental }), { units: 0, rental: 0 });
  return {
    halves: cols,
    rows: all.map((name) => ({
      name,
      units: cols.map((h) => cells.get(`${name}|${h}`)?.units ?? 0),
      rental: cols.map((h) => cells.get(`${name}|${h}`)?.rental ?? 0),
    })),
    undated: undated.size ? { units: total.units, rentalUnits: total.rental, districts: all.filter((g) => undated.has(g)) } : null,
  };
}

/**
 * 구×반기 표 조각(thead·tbody·tfoot). 칸은 「n세대(임대 m)」, 그 반기에 없으면 「없음」, 어느 반기에도 없는 구는 한 칸 「예정 없음」.
 * 꼬리 한 줄에 「추정치·기준일·예정월 기준(실제 입주 아님)·30세대 이상·임대 정의」와 출처(scripts/source-lines.ts)를 둔다 -
 * 화면이 이 조각을 통째로 바꿔 끼우므로(setTable) 문구가 표 밖에 있으면 언어가 따로 논다. 인과 문장은 쓰지 않는다.
 */
export function moveInDistrictTableHtml(d, basis, locale = "ko") {
  if (!d?.rows?.length || !d.halves.length) return null;
  const en = locale === "en";
  const none = en ? "None" : "없음";
  const noPlan = en ? "None planned" : "예정 없음";
  const cell = (u, r) => (u ? (en ? `${num(u, true)} homes (rental ${num(r, true)})` : `${num(u)}세대(임대 ${num(r)})`) : none);
  const head = [en ? "District" : "자치구", ...d.halves.map((h) => halfText(h, en))];
  const body = d.rows.map((row) => {
    const empty = row.units.every((u) => !u) && !d.undated?.districts.includes(row.name);
    const tds = empty ? `<td colspan="${d.halves.length}">${noPlan}</td>` : row.units.map((u, i) => `<td>${cell(u, row.rental[i])}</td>`).join("");
    return `<tr><th scope="row">${row.name}</th>${tds}</tr>`;
  });
  const note = en
    ? [
        "Estimate",
        basis ? `as of ${basis}` : null,
        "by scheduled move-in month (not actual move-ins)",
        "complexes of 30+ homes only",
        "rental means pure rental (youth housing and the like) only",
      ]
    : ["추정치", basis ? `기준일 ${basis}` : null, "입주 예정월 기준(실제 입주 아님)", "30세대 이상 단지만", "임대는 순수 임대(청년안심주택 등)만"];
  const undated = d.undated
    ? en
      ? ` Not in the table: ${num(d.undated.units, true)} homes with no move-in month set (${d.undated.districts.join(", ")}).`
      : ` 달 미정 ${num(d.undated.units)}세대(${d.undated.districts.join("·")})는 표에 넣지 않았습니다.`
    : "";
  const foot = `${note.filter(Boolean).join(" · ")}.${undated} ${moveInSourceLine(en ? "en" : "ko")}`;
  return (
    `<thead><tr>${head.map((x) => `<th scope="col">${x}</th>`).join("")}</tr></thead>` +
    `<tbody>${body.join("")}</tbody>` +
    `<tfoot><tr><td colspan="${head.length}">${foot}</td></tr></tfoot>`
  );
}
