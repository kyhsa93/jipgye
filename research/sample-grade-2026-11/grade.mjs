// 표본 등급 계산(#816). 규칙은 같은 폴더 PREREG.md 가 정하고, 이 파일은 그 계산을 옮긴 것이다.
//
//   git archive cef5ab55 raw/sale raw/ecos | tar -x -C <임시 경로>
//   node research/sample-grade-2026-11/grade.mjs seen --root <임시 경로>     이미 본 구간과 흔들림 표. seen.out
//   node research/sample-grade-2026-11/grade.mjs judge --root <입력 트리> --prereg <40자리>   검증 구간 판정(PREREG 5절)
//
// 호출 0회. 원본만 읽고 저장소에 쓰지 않는다. 저장소 scripts/ 를 가져오지 않는다 — 등록 뒤 칸 키(#821)나
// 시세 코드가 바뀌어도 이 계산은 그대로여야 하기 때문이다.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const REGIONS = {
  210: ["11110", "11140", "11170"],
  220: ["11200", "11215", "11230", "11260", "11290", "11305", "11320", "11350"],
  240: ["11380", "11410", "11440"],
  250: ["11470", "11500", "11530", "11545", "11560", "11590", "11620"],
  230: ["11650", "11680", "11710", "11740"],
};
const REGION_OF = new Map(Object.entries(REGIONS).flatMap(([r, codes]) => codes.map((c) => [c, r])));

// ── 사전 등록 값 (PREREG 2·5절). 새 버전으로만 바꾼다. ──
export const GRADE = { minDeals: 3, enoughDeals: 5, recentDays: 90, windowDays: 183 };
export const MIN_TARGETS = 400;
export const VALIDATION_WINDOW = ["202609", "202610", "202611"];
export const SEEN = {
  commit: "cef5ab55",
  rawSale: "c62dfdaa4ffb19fdb58aa05b02b96bd92dfe0fb370fb1ed198d8333b072d095b",
  rawEcos: "805b78b1adbe48fc03a2f2b40f3ed61f9c93a0413867d5e1313628ba068af434",
  windows: [
    ["202606", "202607", "202608"],
    ["202603", "202604", "202605"],
    ["202512", "202601", "202602"],
  ],
  asOf: "2026-11-02",
};
const SEED = 816;
const REPS = 1000;

const DAY = 86400000;
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;

/** 시세 칸과 같은 거래 규칙(해제·직거래 제외). scripts/complex-price.ts marketDeal 의 사본. */
export function dealOf(item) {
  if (String(item?.cdealType ?? "").trim()) return null;
  if (String(item?.dealingGbn ?? "").trim() === "직거래") return null;
  const amount = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
  const area = Number(item?.excluUseAr);
  const [y, m, d] = [Number(item?.dealYear), Number(item?.dealMonth), Number(item?.dealDay)];
  const apt = String(item?.aptNm ?? "").trim();
  if (!(amount > 0) || !(area > 0) || !y || !m || !d || !apt) return null;
  const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const day = dayOf(date);
  if (!Number.isFinite(day)) return null;
  const district = String(item.sggCd);
  const key = [district, String(item?.umdNm ?? "").trim(), String(item?.jibun ?? "").trim(), apt].join("|");
  return { key, district, area: Math.round(area * 100) / 100, month: date.slice(0, 4) + date.slice(5, 7), day, amount };
}

/** 단지마다 1㎡ 묶음. 작은 면적부터, 묶음 첫 면적에서 1㎡ 미만이면 같은 묶음, 이름은 최다(같으면 작은 쪽). */
export function assignCells(deals) {
  const byKey = new Map();
  for (const deal of deals) (byKey.get(deal.key) ?? byKey.set(deal.key, []).get(deal.key)).push(deal);
  for (const group of byKey.values()) {
    const counts = new Map();
    for (const { area } of group) counts.set(area, (counts.get(area) ?? 0) + 1);
    const areas = [...counts.keys()].sort((a, b) => a - b);
    const label = new Map();
    let run = [];
    const close = () => {
      const name = [...run].sort((a, b) => counts.get(b) - counts.get(a) || a - b)[0];
      for (const a of run) label.set(a, name);
    };
    for (const a of areas) {
      if (run.length && a - run[0] >= 1) {
        close();
        run = [];
      }
      run.push(a);
    }
    if (run.length) close();
    for (const deal of group) deal.cell = `${deal.key}#${label.get(deal.area)}`;
  }
  return deals;
}

export function loadDeals(root) {
  const dir = path.join(root, "raw/sale");
  const deals = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    if (parsed.ok === false || !Array.isArray(parsed.items)) continue;
    for (const item of parsed.items) {
      const deal = dealOf(item);
      if (deal) deals.push(deal);
    }
  }
  return assignCells(deals);
}

export function loadIndex(root) {
  const { series } = JSON.parse(readFileSync(path.join(root, "raw/ecos/apt-price-index.json"), "utf8"));
  const out = {};
  for (const [code, rows] of Object.entries(series)) out[code] = new Map(rows.map(([m, v]) => [m, Number(v)]));
  return out;
}

export function quantile(sorted, q) {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}
const sortedOf = (values) => Float64Array.from(values).sort();

/** 대상 거래마다 직전 183일 같은 칸(계약일 기준, 대상 날 제외)의 보정 중앙값과 n·경과일·오차. */
export function targetsOf(deals, index, months) {
  const wanted = new Set(months);
  const byCell = new Map();
  for (const deal of deals) (byCell.get(deal.cell) ?? byCell.set(deal.cell, []).get(deal.cell)).push(deal);
  const rows = [];
  let noPrior = 0;
  let unadjusted = 0;
  for (const target of deals) {
    if (!wanted.has(target.month)) continue;
    const series = index[REGION_OF.get(target.district)];
    const to = series?.get(target.month);
    const prior = byCell
      .get(target.cell)
      .filter((p) => p.day < target.day && p.day >= target.day - GRADE.windowDays);
    if (!prior.length) {
      noPrior += 1;
      continue;
    }
    const values = sortedOf(
      prior.map((p) => {
        const from = series?.get(p.month);
        if (!(from > 0) || !(to > 0)) {
          unadjusted += 1;
          return p.amount;
        }
        return (p.amount * to) / from;
      }),
    );
    const signed = Math.log(target.amount / quantile(values, 0.5)) * 100;
    rows.push({
      key: target.key,
      month: target.month,
      day: target.day,
      n: prior.length,
      age: target.day - Math.max(...prior.map((p) => p.day)),
      abs: Math.abs(signed),
      signed,
    });
  }
  return { rows, noPrior, unadjusted };
}

/** PREREG 2절. n<3 근거 부족, n≥5 ∧ 90일 이내 충분, 나머지 일부 부족. */
export function gradeOf({ n, age }, { enoughDeals = GRADE.enoughDeals, recentDays = GRADE.recentDays } = {}) {
  if (n < GRADE.minDeals) return "근거 부족";
  return n >= enoughDeals && age <= recentDays ? "충분" : "일부 부족";
}

export function stats(rows) {
  if (!rows.length) return { n: 0, median: NaN, p80: NaN, bias: NaN };
  const abs = sortedOf(rows.map((r) => r.abs));
  const signed = sortedOf(rows.map((r) => r.signed));
  return { n: rows.length, median: quantile(abs, 0.5), p80: quantile(abs, 0.8), bias: quantile(signed, 0.5) };
}

/** 등록 판정. 반올림 전 값으로 비교한다. 경계값은 「크지 않다」. */
export function verdict(enough, partial) {
  if (enough.n < MIN_TARGETS || partial.n < MIN_TARGETS) return "판정 불가";
  return enough.p80 > partial.p80 ? "새 버전" : "유지";
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clusters(rows) {
  const map = new Map();
  for (const row of rows) (map.get(row.key) ?? map.set(row.key, []).get(row.key)).push(row);
  return [...map.values()];
}

/** 단지를 복원 재추출한 P80 차이(충분 − 일부 부족)의 P5·P95. 판정에 쓰지 않고 함께 적는다. */
export function gapInterval(rows, seed = SEED, reps = REPS) {
  const random = rng(seed);
  const groups = clusters(rows.filter((r) => gradeOf(r) !== "근거 부족"));
  const gaps = [];
  let above = 0;
  for (let i = 0; i < reps; i += 1) {
    const enough = [];
    const partial = [];
    for (let j = 0; j < groups.length; j += 1) {
      for (const row of groups[Math.floor(random() * groups.length)]) {
        (gradeOf(row) === "충분" ? enough : partial).push(row.abs);
      }
    }
    const gap = quantile(sortedOf(enough), 0.8) - quantile(sortedOf(partial), 0.8);
    gaps.push(gap);
    if (gap > 0) above += 1;
  }
  const sorted = sortedOf(gaps);
  return { p5: quantile(sorted, 0.05), p95: quantile(sorted, 0.95), above: above / reps };
}

/** 등급별 대상을 크기 size 로 줄였을 때 P80 이 얼마나 흔들리고 판정이 얼마나 뒤집히나. */
export function sizeJitter(rows, size, seed = SEED, reps = REPS) {
  const random = rng(seed + size);
  const enough = clusters(rows.filter((r) => gradeOf(r) === "충분"));
  const partial = clusters(rows.filter((r) => gradeOf(r) === "일부 부족"));
  const draw = (groups) => {
    const out = [];
    while (out.length < size) {
      for (const row of groups[Math.floor(random() * groups.length)]) {
        if (out.length < size) out.push(row.abs);
      }
    }
    return quantile(sortedOf(out), 0.8);
  };
  const a = [];
  const b = [];
  let above = 0;
  for (let i = 0; i < reps; i += 1) {
    const x = draw(enough);
    const y = draw(partial);
    a.push(x);
    b.push(y);
    if (x > y) above += 1;
  }
  const sa = sortedOf(a);
  const sb = sortedOf(b);
  return { enough: [quantile(sa, 0.05), quantile(sa, 0.95)], partial: [quantile(sb, 0.05), quantile(sb, 0.95)], flip: above / reps };
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function gradeTable(rows) {
  const groups = { 충분: [], "일부 부족": [], "근거 부족": [] };
  for (const row of rows) groups[gradeOf(row)].push(row);
  const out = {};
  for (const [name, list] of Object.entries(groups)) {
    out[name] = stats(list);
    console.log(`  ${name}  대상 ${out[name].n}  절대오차 중앙 ${f2(out[name].median)}  P80 ${f2(out[name].p80)}  치우침 ${f2(out[name].bias)}`);
  }
  return out;
}

export function rawSaleHash(root) {
  const dir = path.join(root, "raw/sale");
  const hash = createHash("sha256");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    hash.update(file);
    hash.update(readFileSync(path.join(dir, file)));
  }
  return hash.digest("hex");
}

function seen(root) {
  const hash = rawSaleHash(root);
  const ecos = createHash("sha256").update(readFileSync(path.join(root, "raw/ecos/apt-price-index.json"))).digest("hex");
  if (hash !== SEEN.rawSale || ecos !== SEEN.rawEcos) throw new Error(`입력이 고정값과 다르다. ${SEEN.commit} 을 꺼낸 트리에서 돌린다.`);
  const deals = loadDeals(root);
  const index = loadIndex(root);
  console.log(`입력 ${SEEN.commit}  raw/sale sha256 ${hash}  raw/ecos sha256 ${ecos}  시장 거래 ${deals.length}`);

  console.log(`\n== 칸 분포: 기준일 ${SEEN.asOf}, 창 183일, 칸은 창 안 거래로 묶음 ==`);
  const asOf = dayOf(SEEN.asOf);
  const inWindow = deals
    .filter((d) => d.day >= asOf - GRADE.windowDays && d.day <= asOf)
    .map((d) => ({ ...d }));
  assignCells(inWindow);
  const cells = new Map();
  for (const d of inWindow) {
    const cell = cells.get(d.cell) ?? { n: 0, last: -Infinity };
    cell.n += 1;
    cell.last = Math.max(cell.last, d.day);
    cells.set(d.cell, cell);
  }
  const tally = { 충분: 0, "일부 부족": 0, "근거 부족": 0 };
  for (const { n, last } of cells.values()) tally[gradeOf({ n, age: asOf - last })] += 1;
  console.log(`  ${JSON.stringify(tally)}  n≥3 ${tally.충분 + tally["일부 부족"]}`);

  const [main, ...earlier] = SEEN.windows;
  const { rows, noPrior, unadjusted } = targetsOf(deals, index, main);
  console.log(`\n== 다음 거래 오차, 계약 ${main[0]}~${main.at(-1)}: 직전 183일 같은 칸 보정 중앙값 대비. 값 없음 ${noPrior}, 보정 못 한 앞 거래 ${unadjusted} ==`);
  const bins = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 6], [7, 9], [10, 14], [15, 19], [20, Infinity]];
  for (const [lo, hi] of bins) {
    const s = stats(rows.filter((r) => r.n >= lo && r.n <= hi));
    console.log(`  n ${lo === hi ? lo : hi === Infinity ? `${lo}+` : `${lo}~${hi}`}  대상 ${s.n}  절대오차 중앙 ${f2(s.median)}  P80 ${f2(s.p80)}  치우침 ${f2(s.bias)}`);
  }

  console.log(`\n== n≥3 대상의 경과일별, 계약 ${main[0]}~${main.at(-1)} ==`);
  for (const [lo, hi] of [[0, 30], [31, 60], [61, 90], [91, 183]]) {
    const s = stats(rows.filter((r) => r.n >= GRADE.minDeals && r.age >= lo && r.age <= hi));
    console.log(`  ${lo}~${hi}일  대상 ${s.n}  절대오차 중앙 ${f2(s.median)}  P80 ${f2(s.p80)}  치우침 ${f2(s.bias)}`);
  }

  console.log(`\n== 등급별 오차 (이미 본 구간은 판정이 아니다) ==`);
  for (const window of [main, ...earlier]) {
    const data = window === main ? rows : targetsOf(deals, index, window).rows;
    console.log(`계약 ${window[0]}~${window.at(-1)}`);
    const t = gradeTable(data);
    const band = gapInterval(data);
    console.log(`  P80 차이(충분−일부 부족) ${f2(t.충분.p80 - t["일부 부족"].p80)}  단지 재추출 ${REPS}회 P5~P95 ${f2(band.p5)}~${f2(band.p95)}  양수 ${pct(band.above)}`);
  }

  console.log(`\n== 문턱 근처, 계약 ${main[0]}~${main.at(-1)} (n≥3 안에서만 가른다) ==`);
  const scored = rows.filter((r) => r.n >= GRADE.minDeals);
  for (const enoughDeals of [4, 5, 6]) {
    for (const recentDays of [60, 90, 120]) {
      const enough = scored.filter((r) => gradeOf(r, { enoughDeals, recentDays }) === "충분");
      const partial = scored.filter((r) => gradeOf(r, { enoughDeals, recentDays }) === "일부 부족");
      const [a, b] = [stats(enough), stats(partial)];
      console.log(`  n≥${enoughDeals} ∧ ${recentDays}일: 충분 대상 ${a.n} P80 ${f2(a.p80)} / 일부 부족 대상 ${b.n} P80 ${f2(b.p80)} / 차이 ${f2(a.p80 - b.p80)}`);
    }
  }

  console.log(`\n== 크기별 흔들림, 계약 ${main[0]}~${main.at(-1)}: 등급마다 대상을 그 수만큼 단지 단위로 뽑아 ${REPS}회 (시드 ${SEED}) ==`);
  for (const size of [100, 200, 400, 800, 1600]) {
    const j = sizeJitter(rows, size);
    console.log(`  ${size}건: 충분 P80 ${f2(j.enough[0])}~${f2(j.enough[1])}  일부 부족 P80 ${f2(j.partial[0])}~${f2(j.partial[1])}  충분이 더 큼 ${pct(j.flip)}`);
  }
}

function judge(root, prereg, windowArg) {
  const window = windowArg ? windowArg.split(",") : VALIDATION_WINDOW;
  if (!/^[0-9a-f]{40}$/.test(prereg ?? "")) throw new Error("--prereg 에 이 문서가 main 에 병합된 커밋 40자리를 준다.");
  const index = loadIndex(root);
  const end = window.at(-1);
  for (const code of Object.keys(REGIONS)) {
    if (!index[code]?.has(end)) throw new Error(`권역 ${code} 지수에 ${end} 이 없다. 값 없는 보정을 1로 메우지 않는다(PREREG 4절).`);
  }
  const [y, m] = [Number(end.slice(0, 4)), Number(end.slice(4))];
  const frozen = `${y + Math.floor(m / 12)}${String((m % 12) + 1).padStart(2, "0")}`;
  const months = readdirSync(path.join(root, "raw/sale")).map((f) => f.slice(6, 12));
  if (!months.some((month) => month > frozen)) throw new Error(`${end} 슬롯이 아직 얼지 않았다(PREREG 4절).`);
  const deals = loadDeals(root);
  const { rows, noPrior, unadjusted } = targetsOf(deals, index, window);
  console.log(`입력 raw/sale sha256 ${rawSaleHash(root)}  등록 커밋 ${prereg}  계약 ${window[0]}~${end}`);
  console.log(`값 없음 ${noPrior}, 보정 못 한 앞 거래 ${unadjusted}`);
  const t = gradeTable(rows);
  const band = gapInterval(rows);
  console.log(`P80 차이(충분−일부 부족) ${(t.충분.p80 - t["일부 부족"].p80).toFixed(6)}  단지 재추출 ${REPS}회 P5~P95 ${f2(band.p5)}~${f2(band.p95)}  양수 ${pct(band.above)}  (참고)`);
  console.log(`판정: ${verdict(t.충분, t["일부 부족"])}`);
  for (const month of window) {
    console.log(`참고 ${month}`);
    gradeTable(rows.filter((r) => r.month === month));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: { root: { type: "string" }, prereg: { type: "string" }, window: { type: "string" } },
  });
  const root = v.root && path.resolve(v.root);
  if (!root || !existsSync(path.join(root ?? "", "raw/sale"))) {
    console.error("사용법은 파일 머리를 본다. --root 에 raw/sale·raw/ecos 가 있는 트리를 준다.");
    process.exit(2);
  }
  try {
    if (positionals[0] === "seen") seen(root);
    else if (positionals[0] === "judge") judge(root, v.prereg, v.window);
    else throw new Error("seen 또는 judge 를 준다.");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
