/**
 * 앞으로 2년 서울 공동주택 입주 예정(#60). 숫자를 모아 사실 문장과 표를 만든다.
 *
 * 해석은 붙이지 않는다 - "입주가 많으면 값이 내린다"는 검증하지 않았다. 공급을 인허가로 재 본 지표는
 * 12개월 뒤 값을 더 잘 맞히지 못했다(#57, research/indicators-3/). 그 사실을 문장에 같이 적는다.
 * 사업유형: "분양임대"는 임대 단지가 아니라 분양과 임대분이 섞인 단지다(반포디에이치클래스트 5,007세대,
 * 디에이치 방배 등 재건축·재개발). 순수 임대는 "임대"(청년안심주택 등)뿐이라, 그것만 따로 떼어 적는다.
 */

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
    const gu = /서울특별시\s+(\S+구)/.exec(r["주소"])?.[1] ?? null;
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

const num = (n, en) => n.toLocaleString(en ? "en-US" : "ko-KR");
const ymText = (ym, en) => {
  const [y, m] = ym.split("-");
  return en ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}` : `${y}년 ${Number(m)}월`;
};
const halfText = (h, en) => {
  const m = /^(\d{4})(H[12]|\?)$/.exec(h);
  if (!m) return h;
  if (m[2] === "?") return en ? `${m[1]}, month not set` : `${m[1]}년 (달 미정)`;
  return en ? `${m[2] === "H1" ? "Jan–Jun" : "Jul–Dec"} ${m[1]}` : `${m[1]}년 ${m[2] === "H1" ? "상반기" : "하반기"}`;
};
const basisText = (basis, en) => {
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
  return `<thead><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
}

/** 자치구별 한 줄 - 많은 곳부터, 세대수만. 단지 수가 적은 구는 한 단지가 다 정한다는 것을 숫자로 보인다. */
export function moveInDistrictsText(s, locale = "ko") {
  if (!s) return null;
  const en = locale === "en";
  const list = s.districts.map((d) => (en ? `${d.name} ${num(d.units, true)} (${d.complexes})` : `${d.name} ${num(d.units)}세대(${d.complexes}곳)`));
  return (en ? "By district: " : "자치구별: ") + list.join(" · ");
}
