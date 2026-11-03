// PREREG v2 의 재현(#816 PR #856). 근거표 칸(별칭 합침)과 판정 칸(grade.mjs, 합치지 않음)의 차이를 센다. 결과는 alias-v2.out.
//
//   git archive f1bea675 scripts raw/sale raw/rent raw/ecos docs/data | tar -x -C <트리>
//   git archive cef5ab55 raw/sale raw/ecos | tar -x -C <고정 입력>
//   node research/sample-grade-2026-11/alias-v2.mjs --tree <트리> --seen <고정 입력> --now 2026-11-03T12:00:00Z
//
// 호출 0회. 원본만 읽고 저장소에 쓰지 않는다. 오차는 이미 본 구간(SEEN.windows)에서만 계산한다. 검증 구간은 별칭 줄의 건수만 세고 값·오차를 쓰지 않는다.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { assignCells, gradeOf, loadDeals, loadIndex, SEEN, stats, targetsOf, VALIDATION_WINDOW } from "./grade.mjs";

const { values: v } = parseArgs({ options: { tree: { type: "string" }, seen: { type: "string" }, now: { type: "string" } } });
const tree = path.resolve(v.tree);
const seenRoot = path.resolve(v.seen);
const now = new Date(v.now);
const { COMPLEX_ALIASES, complexKey, locationKey, stableId } = await import(path.join(tree, "scripts/complex-id.ts"));
const { areaGroups, indexLevels, marketDeal, referenceMonth, summarize, windowStart } = await import(path.join(tree, "scripts/complex-price.ts"));
const { DISTRICT_SLUGS } = await import(path.join(tree, "scripts/district-slugs.ts"));
const { DISTRICTS } = await import(path.join(tree, "scripts/realestate-districts.ts"));
const { readSameNames } = await import(path.join(tree, "scripts/realestate-raw.ts"));

const DAY = 86400000;
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const rawRows = (root, kind) =>
  readdirSync(path.join(root, "raw", kind))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => readJson(path.join(root, "raw", kind, f)).items ?? []);
const tallyOf = (cells) => {
  const out = { 충분: 0, "일부 부족": 0, "근거 부족": 0 };
  for (const cell of cells) out[gradeOf(cell)] += 1;
  return out;
};
const line = (t) => `충분 ${t.충분}  일부 부족 ${t["일부 부족"]}  근거 부족 ${t["근거 부족"]}  n≥3 ${t.충분 + t["일부 부족"]}`;

/** 저장소 빌더(build-recommendation.ts)와 같은 칸: 키마다 창 안 거래로 1㎡ 묶음. */
function cellsBy(deals, keyOf, today) {
  const groups = new Map();
  for (const d of deals) {
    const key = keyOf(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const cells = new Map();
  for (const [key, group] of groups) {
    const label = areaGroups(group);
    for (const d of group) {
      const id = `${key}#${label.get(d.area)}`;
      const cell = cells.get(id) ?? { id, key, area: label.get(d.area), n: 0, last: "", deals: [] };
      cell.n += 1;
      cell.last = d.date > cell.last ? d.date : cell.last;
      cell.deals.push(d);
      cells.set(id, cell);
    }
  }
  for (const cell of cells.values()) cell.age = today - dayOf(cell.last);
  return cells;
}

/** 등록 계산(grade.mjs seen)과 같은 칸 분포. */
function preregTally(root, asOf) {
  const day = dayOf(asOf);
  const inWindow = loadDeals(root).filter((d) => d.day >= day - 183 && d.day <= day).map((d) => ({ ...d }));
  assignCells(inWindow);
  const cells = new Map();
  for (const d of inWindow) {
    const cell = cells.get(d.cell) ?? { n: 0, last: -Infinity };
    cell.n += 1;
    cell.last = Math.max(cell.last, d.day);
    cells.set(d.cell, cell);
  }
  return tallyOf([...cells.values()].map(({ n, last }) => ({ n, age: day - last })));
}

function marketRows(root, since, until) {
  return rawRows(root, "sale").flatMap((item) => {
    const d = marketDeal(item);
    return d && d.date >= since && d.date <= until ? [{ ...d, location: locationKey(item), id: stableId(locationKey(item)) }] : [];
  });
}

const iso = now.toISOString().slice(0, 10);
const today = dayOf(iso);
const since = windowStart(now);
const deals = marketRows(tree, since, iso);
const byLocation = cellsBy(deals, (d) => d.location, today);
const byId = cellsBy(deals, (d) => d.id, today);
console.log(`입력 트리 기준 ${iso}, 창 ${since}~${iso}, 시장 거래 ${deals.length}`);
console.log(`칸 분포 grade.mjs 키          ${line(preregTally(tree, iso))}`);
console.log(`칸 분포 위치 키(지번 정규화)  ${line(tallyOf(byLocation.values()))}`);
console.log(`칸 분포 저장 ID(별칭 합침)    ${line(tallyOf(byId.values()))}`);

const index = readJson(path.join(tree, "raw/ecos/apt-price-index.json"));
const { levels } = indexLevels(index, readJson(path.join(tree, "docs/data/outlook.json")));
const reference = referenceMonth(levels);
const money = (cell) => (cell.n >= 3 ? `${(summarize(cell.deals, levels, reference).median / 10000).toFixed(2)}억` : "값 없음");
const show = (cell) => `${cell.key}#${cell.area}  n${cell.n}  마지막 ${cell.last}  ${gradeOf(cell)}  ${money(cell)}`;

const targets = [...new Set(Object.values(COMPLEX_ALIASES))].sort();
console.log(`\n== 별칭 ${Object.keys(COMPLEX_ALIASES).length}줄, 지수 기준 ${reference} ==`);
const rents = rawRows(tree, "rent");
for (const target of targets) {
  const keys = [target, ...Object.keys(COMPLEX_ALIASES).filter((k) => COMPLEX_ALIASES[k] === target)];
  console.log(`저장 ID ${target}`);
  for (const key of keys) {
    const seqs = new Set(rents.filter((item) => locationKey(item) === key).map((item) => String(item.aptSeq ?? "").trim()).filter(Boolean));
    console.log(`  aptSeq ${key}: ${[...seqs].join(",") || "-"}`);
  }
  for (const cell of byLocation.values()) if (keys.includes(cell.key)) console.log(`  합치기 전  ${show(cell)}`);
  for (const cell of byId.values()) if (cell.key === target) console.log(`  합친 뒤    ${show(cell)}`);
}
const aliasKeys = new Set(targets.flatMap((t) => [t, ...Object.keys(COMPLEX_ALIASES).filter((k) => COMPLEX_ALIASES[k] === t)]));
const before = [...byLocation.values()].filter((c) => aliasKeys.has(c.key));
const after = [...byId.values()].filter((c) => aliasKeys.has(c.key));
console.log(`합치기 전 n≥3 ${before.filter((c) => c.n >= 3).length}칸 / 합친 뒤 n≥3 ${after.filter((c) => c.n >= 3).length}칸 (근거 부족 ${before.filter((c) => c.n < 3).length} → ${after.filter((c) => c.n < 3).length})`);

console.log(`\n== 시세 카드(docs/data/complex-price-*.json)와 표: 저장 ID 칸 n≥3 전부 ==`);
const same = await readSameNames(path.join(tree, "raw"));
const slugOf = new Map(DISTRICTS.map(({ code, name }) => [code, DISTRICT_SLUGS[name]]));
const cards = new Map();
const compared = { 칸: 0, "n·값 같음": 0, "n 같고 값 다름": 0, "n 다름": 0, "카드에 면적 없음": 0, "카드에 동 붙은 이름 없음": 0, "카드에 이름 없음": 0 };
const differ = [];
for (const cell of byId.values()) {
  if (cell.n < 3) continue;
  const [code, dong, , name] = cell.key.split("|");
  const slug = slugOf.get(code);
  if (!cards.has(slug)) cards.set(slug, readJson(path.join(tree, `docs/data/complex-price-${slug}.json`)).cells);
  const shown = complexKey(name, dong, same[code]);
  const card = cards.get(slug)?.[shown]?.[String(cell.area)];
  const median = summarize(cell.deals, levels, reference).median;
  compared.칸 += 1;
  const kind = !cards.get(slug)?.[shown] ? (shown === name ? "카드에 이름 없음" : "카드에 동 붙은 이름 없음") : !card ? "카드에 면적 없음" : card.n !== cell.n ? "n 다름" : card.median !== median ? "n 같고 값 다름" : "n·값 같음";
  compared[kind] += 1;
  if (aliasKeys.has(cell.key)) differ.push(`  ${cell.key}#${cell.area} 표 n${cell.n} ${median} / 카드 ${card ? `n${card.n} ${card.median}` : "없음"}`);
}
console.log(`  ${JSON.stringify(compared)}`);
console.log(differ.join("\n"));
for (const key of ["11440|신수동|462|마포아이파크포레", "11440|신수동|462|신촌숲아이파크"]) {
  const name = key.split("|")[3];
  const card = cards.get("mapo")?.[name] ?? {};
  console.log(`  카드 ${name}: ${Object.entries(card).map(([area, c]) => `${area} n${c.n} ${c.median ?? "값 없음"}`).join("  ") || "없음"}`);
}

console.log(`\n== 입력 ${SEEN.commit}, 기준 ${SEEN.asOf} ==`);
const seenDeals = loadDeals(seenRoot);
console.log(`칸 분포 grade.mjs 키  ${line(preregTally(seenRoot, SEEN.asOf))}`);
const asOf = dayOf(SEEN.asOf);
const merged = seenDeals.filter((d) => d.day >= asOf - 183 && d.day <= asOf).map((d) => ({ ...d, key: COMPLEX_ALIASES[d.key] ?? d.key }));
assignCells(merged);
const mergedCells = new Map();
for (const d of merged) {
  const cell = mergedCells.get(d.cell) ?? { n: 0, last: -Infinity };
  cell.n += 1;
  cell.last = Math.max(cell.last, d.day);
  mergedCells.set(d.cell, cell);
}
console.log(`칸 분포 별칭 합침     ${line(tallyOf([...mergedCells.values()].map(({ n, last }) => ({ n, age: asOf - last }))))}`);

console.log(`\n== 이미 본 구간에서 판정 칸에 별칭을 합쳤다면 (참고. grade.mjs 는 합치지 않는다) ==`);
const seenIndex = loadIndex(seenRoot);
const aliased = assignCells(loadDeals(seenRoot).map((d) => ({ ...d, key: COMPLEX_ALIASES[d.key] ?? d.key })));
const gapOf = (rows) => {
  const [a, b] = [stats(rows.filter((r) => gradeOf(r) === "충분")), stats(rows.filter((r) => gradeOf(r) === "일부 부족"))];
  return `충분 ${a.n} / ${a.p80.toFixed(4)}  일부 부족 ${b.n} / ${b.p80.toFixed(4)}  차이 ${(a.p80 - b.p80).toFixed(4)}`;
};
for (const window of SEEN.windows) {
  console.log(`계약 ${window[0]}~${window.at(-1)}`);
  console.log(`  합치지 않음  ${gapOf(targetsOf(seenDeals, seenIndex, window).rows)}`);
  console.log(`  별칭 합침    ${gapOf(targetsOf(aliased, seenIndex, window).rows)}`);
}

console.log(`\n== 검증 구간의 별칭 키 거래 수 (건수만. 오차·등급을 계산하지 않는다) ==`);
const all = rawRows(tree, "sale").flatMap((item) => {
  const d = marketDeal(item);
  return d ? [{ month: d.month, alias: Object.hasOwn(COMPLEX_ALIASES, locationKey(item)), target: aliasKeys.has(locationKey(item)) }] : [];
});
for (const month of VALIDATION_WINDOW) {
  const rows = all.filter((r) => r.month === month);
  console.log(`  ${month}  시장 거래 ${rows.length}  별칭에 걸린 단지 ${rows.filter((r) => r.target).length}  그중 옮겨지는 왼쪽 키 ${rows.filter((r) => r.alias).length}`);
}
