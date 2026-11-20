// 입력 하나(A 또는 B)를 측정 작업 트리의 코드(= 등록 sha)로 다시 만들고, 그 입력의 공개 파일과 대조한 뒤 재추출 입력을 쓴다.
// 인자: <OUT 폴더> <A|B>. 이 파일이 있는 작업 트리의 scripts/·raw/·docs/data 를 읽는다(cto 조건 3).
//  - segment: 빌더와 같은 경로 readAll().items + readSameNames() (build-district-change.ts main 과 같다). now = 공개 segment-change.json 의 updatedAt.
//  - direct : readRawSales(recentMonths(now, RETENTION_MONTHS), undefined, readSlotFile) (build-cancellation.ts:138 과 같다). now = 공개 direct-deals.json 의 updatedAt.
// 재현이 updatedAt 말고 하나라도 다르면 종료 1(멈춤).
import { network, assertNoKeys, finish } from "./lib-909.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

void network;
assertNoKeys();
const [OUT, label] = [path.resolve(process.argv[2] ?? ""), process.argv[3]];
if (!process.argv[2] || !["A", "B"].includes(label)) {
  console.error("쓰는 법: node prep-909.mjs <OUT 폴더> <A|B>");
  process.exit(1);
}
const R = new URL("../../scripts/", import.meta.url).href;
const dc = await import(R + "district-change.ts");
const sc = await import(R + "segment-change.ts");
const bd = await import(R + "build-district-change.ts");
const dd = await import(R + "direct-deals.ts");
const bdd = await import(R + "build-direct-deals.ts");
const bc = await import(R + "build-cancellation.ts");
const { readSameNames, readSlotFile } = await import(R + "realestate-raw.ts");
const { RETENTION_MONTHS, yearMonthOf } = await import(R + "realestate-slots.ts");
const { recentMonths } = await import(R + "realestate-source.ts");
const { shiftMonth } = await import(R + "outlook.ts");
const { BANDS } = await import(R + "cancel-by-price.ts");

const DATA = new URL("../../docs/data/", import.meta.url);
const pubSeg = JSON.parse(await readFile(new URL("segment-change.json", DATA), "utf8"));
const pubDir = JSON.parse(await readFile(new URL("direct-deals.json", DATA), "utf8"));
// 입력 A 의 now 는 cto 착수 조건 3 에 적힌 값이다. 다르면 다른 파일을 읽고 있는 것이다.
const A_NOW = { segment: "2026-11-16T02:44:23.771Z", direct: "2026-11-16T02:43:39.411Z" };
if (label === "A" && (pubSeg.updatedAt !== A_NOW.segment || pubDir.updatedAt !== A_NOW.direct)) {
  console.error(`멈춤: 입력 A 공개 파일의 updatedAt 이 고정값과 다르다 (segment ${pubSeg.updatedAt}, direct ${pubDir.updatedAt})`);
  process.exit(1);
}
const nowSeg = new Date(pubSeg.updatedAt);
const nowDir = new Date(pubDir.updatedAt);
const strip = (p) => JSON.stringify({ ...JSON.parse(JSON.stringify(p)), updatedAt: null });
let bad = 0;
const check = (name, ok) => {
  console.log(`  ${ok ? "같음" : "다름"} ${name}`);
  if (!ok) bad += 1;
};

// ---- segment ----------------------------------------------------------------------------------------------------
const [{ items }, sameNames] = await Promise.all([bd.readAll(), readSameNames()]);
const segPayload = sc.buildSegmentPayload({ items, now: nowSeg, sameNames });
console.log(`[prep ${label}] segment now ${nowSeg.toISOString()} · 원본 행 ${items.length}`);
check("segment-change.json 전체(updatedAt 뺌)", segPayload !== null && strip(segPayload) === strip(pubSeg));
for (const k of ["periods", "cells", "price", "age", "area", "pairs", "grid"]) check(`  segment ${k}`, JSON.stringify(segPayload?.[k]) === JSON.stringify(pubSeg[k]));

// 빌더 안쪽(segmentRows 는 내보내지 않는다)을 같은 순서로 다시 짠다: 칸 이름 순 → 차원별 키 → 값 배열.
const deals = items.map((item) => sc.toSegmentDeal(item, sameNames)).filter(Boolean);
const available = [...new Set(deals.map((d) => d.month))].sort();
const p = dc.periods(shiftMonth(yearMonthOf(nowSeg), -2), available);
const refYear = Number(p.base[1].slice(0, 4));
const cells = sc.segmentCells(deals, p);
const dims = {
  price: { defs: BANDS, keyOf: (c) => sc.priceKeyOf(c.base) },
  age: { defs: sc.AGES, keyOf: (c) => sc.ageKeyOf(c.buildYear, refYear) },
  area: { defs: sc.AREAS, keyOf: (c) => sc.areaKeyOf(c.area) },
};
const segment = {};
for (const [dim, { defs, keyOf }] of Object.entries(dims)) {
  const byKey = new Map(defs.map((x) => [x.key, []]));
  for (const c of cells) byKey.get(keyOf(c))?.push(c.change);
  const rows = dc.districtRows(byKey, defs.map((x) => ({ code: x.key, name: x.ko })));
  const same = rows.every((r, i) => ["cells", "change", "low", "high"].every((f) => r[f] === pubSeg[dim][i]?.[f]) && r.code === pubSeg[dim][i]?.key);
  check(`  segment ${dim} 다시 짠 값 배열 → districtRows = 공개 행`, same && rows.length === pubSeg[dim].length);
  segment[dim] = defs.map((x) => ({ code: x.key, values: byKey.get(x.key) }));
}

// ---- direct -----------------------------------------------------------------------------------------------------
const months = recentMonths(nowDir, RETENTION_MONTHS);
const byDistrict = await bc.readRawSales(months, undefined, readSlotFile);
const dirPayload = bdd.buildPayload({ byDistrict, months, now: nowDir, sameNames });
console.log(`[prep ${label}] direct now ${nowDir.toISOString()} · 달 ${months[0]}~${months.at(-1)} (${months.length}) · 구 ${Object.keys(byDistrict).length}`);
check("direct-deals.json 전체(updatedAt 뺌)", dirPayload !== null && strip(dirPayload) === strip(pubDir));
const gaps = dd.districtGaps(byDistrict, sameNames);
const allGaps = [...gaps.values()].flatMap((g) => g.gaps);
const allDirect = [...gaps.values()].reduce((s, g) => s + g.directDeals, 0);
check("  direct 서울 칸 격차 → summarizeGaps = 공개 seoul.gap", JSON.stringify(dd.summarizeGaps(allGaps, allDirect, dd.MIN_CELLS)) === JSON.stringify(pubDir.seoul.gap));
// 판정 단위(S2): 서울 + 그 입력에서 칸이 MIN_CELLS(20) 이상인 자치구.
const direct = [{ unit: "서울", values: allGaps }];
for (const [name, g] of gaps) {
  if (g.gaps.length < dd.MIN_CELLS) continue;
  check(`  direct ${name} → summarizeGaps = 공개 gap`, JSON.stringify(dd.summarizeGaps(g.gaps, g.directDeals, dd.MIN_CELLS)) === JSON.stringify(pubDir.districts[name]?.gap));
  direct.push({ unit: name, values: g.gaps });
}
const most = Math.max(0, ...[...gaps.values()].map((g) => g.gaps.length));

// ---- 요약과 쓰기 --------------------------------------------------------------------------------------------------
const P = { price: Object.keys(pubSeg.pairs.price).length, age: Object.keys(pubSeg.pairs.age).length };
console.log(
  `[prep ${label}] 두 시기 ${p.base.join(",")} → ${p.recent.join(",")} (${p.months}개월) · 칸 ${cells.length} · ` +
    `구간 칸 수 가격대 ${segment.price.map((x) => x.values.length).join("·")} / 연식 ${segment.age.map((x) => x.values.length).join("·")} / 면적대 ${segment.area.map((x) => x.values.length).join("·")} · ` +
    `공개 쌍 P = ${P.price + P.age} (가격대 ${P.price} + 연식 ${P.age})`
);
console.log(`[prep ${label}] 직거래 판정 구간 ${direct.length}개: ${direct.map((d) => `${d.unit} ${d.values.length}칸`).join(", ")} (칸이 가장 많은 자치구 ${most}칸, 문턱 ${dd.MIN_CELLS})`);
if (bad) {
  console.error(`멈춤: 입력 ${label} 재현 대조 ${bad}곳이 다르다`);
  process.exit(1);
}
await mkdir(OUT, { recursive: true });
await writeFile(
  path.join(OUT, `input-909-${label}.json`),
  JSON.stringify({
    label,
    now: { segment: pubSeg.updatedAt, direct: pubDir.updatedAt },
    periods: p,
    months: [months[0], months.at(-1), months.length],
    minCells: { segment: dc.MIN_CELLS, direct: dd.MIN_CELLS },
    segment,
    direct,
    public: {
      segment: Object.fromEntries(Object.keys(dims).map((d) => [d, pubSeg[d].map((r) => ({ code: r.key, cells: r.cells, low: r.low ?? null, high: r.high ?? null }))])),
      pairs: pubSeg.pairs,
      direct: Object.fromEntries(direct.map(({ unit }) => [unit, unit === "서울" ? pubDir.seoul.gap : pubDir.districts[unit].gap])),
    },
  })
);
console.log(`[prep ${label}] 재현 일치 · input-909-${label}.json 씀`);
finish(`prep ${label}`);
