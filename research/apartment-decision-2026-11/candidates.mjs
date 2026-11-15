// Seoul candidate-set tally for #872 (#866 P0-B). Read-only: no API calls, no writes outside stdout.
//
// node research/apartment-decision-2026-11/candidates.mjs > research/apartment-decision-2026-11/candidates.out
//
// 1. Tallies the published docs/data/reco-*.json (25 files): cells with a value (n>=3), grade, checks, excluded n<3 cells.
// 2. Re-attributes every raw sale row the builder read (scripts/build-recommendation.ts `generate`) to the first rule that drops it,
//    in the builder's own order: cancelled (cdealType) -> direct deal (dealingGbn) -> missing field -> outside 183-day window -> n<3 cell.
// 3. Cross-checks: sum of n over published cells == in-window market rows in n>=3 cells; n<3 cell count == sum of `excluded[].thin`.
// "now" is the published files' updatedAt, so the run is tied to the commit that holds them.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { locationKey, stableId } from "../../scripts/complex-id.ts";
import { areaGroups, marketDeal, windowStart } from "../../scripts/complex-price.ts";
import { DISTRICT_SLUGS } from "../../scripts/district-slugs.ts";
import { DISTRICTS } from "../../scripts/realestate-districts.ts";
import { refreshMonths } from "../../scripts/realestate-slots.ts";
import { recentMonths } from "../../scripts/realestate-source.ts";
import { GRADE } from "../../scripts/recommendation.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "docs/data");
const RAW = path.join(ROOT, "raw/sale");
const DAY_MS = 86_400_000;

const files = readdirSync(DATA).filter((f) => /^reco-[a-z]+\.json$/.test(f)).sort();
const recos = files.map((f) => JSON.parse(readFileSync(path.join(DATA, f), "utf8")));
const stamps = new Set(recos.map((r) => r.updatedAt));
if (stamps.size !== 1) throw new Error(`reco files disagree on updatedAt: ${[...stamps]}`);
const now = new Date([...stamps][0]);
const since = windowStart(now);
const today = now.toISOString().slice(0, 10);
const recentCut = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
const months = recentMonths(now, 7);
const refreshed = new Set(refreshMonths(now));

const field = (r, name) => r.cellFields.indexOf(name);
const afield = (r, name) => r.apartmentFields.indexOf(name);

console.log(`files ${files.length}, updatedAt ${now.toISOString()}, windowStart ${since}, slots ${months.join(",")}, refreshed ${[...refreshed].sort().join(",")}`);
console.log(`GRADE ${JSON.stringify(GRADE)}`);
console.log();

// ---- 1. published files ----
const pub = {};
const totals = { apartments: 0, cells: 0, enough: 0, partial: 0, thin: 0, few_deals: 0, stale_deal: 0, reg_line: 0, n: 0, noBuildYear: 0, aliased: 0, noJeonse: 0, noFloor: 0, households: 0, peerMax: 0 };
for (const r of recos) {
  const [CELLS, BY, ALIASES, HH] = ["cells", "buildYear", "aliases", "households"].map((n) => afield(r, n));
  const [N, GR, CK, JN, LF, POS] = ["n", "sampleGrade", "checks", "jeonseN", "lastFloor", "position"].map((n) => field(r, n));
  const t = { apartments: r.apartments.length, cells: 0, enough: 0, partial: 0, thin: r.excluded.reduce((s, e) => s + e.thin, 0), few_deals: 0, stale_deal: 0, reg_line: 0, n: 0 };
  for (const row of r.apartments) {
    if (row[BY] == null) totals.noBuildYear++;
    if (row[ALIASES]?.length) totals.aliased++;
    if (row[HH] != null) totals.households++;
    for (const cell of row[CELLS]) {
      t.cells++;
      t[cell[GR]]++;
      t.n += cell[N];
      for (const [code] of cell[CK]) t[code]++;
      if (!cell[JN]) totals.noJeonse++;
      if (cell[LF] == null) totals.noFloor++;
      totals.peerMax = Math.max(totals.peerMax, cell[POS][0][1]);
    }
  }
  pub[r.districtCode] = t;
  for (const k of Object.keys(t)) totals[k] += t[k];
}

// ---- 2. raw rows the builder read ----
const reasons = ["rows", "cancelled", "direct", "missing", "outside", "future", "inWindow", "thinDeals", "cellDeals", "thinCells", "cells"];
const raw = {};
const byMonth = {};
const recent = { deals: 0, cells: 0 };
const frozenDeals = { deals: 0 };
for (const { code } of DISTRICTS) {
  const t = Object.fromEntries(reasons.map((k) => [k, 0]));
  const inWindow = [];
  for (const m of months) {
    const slot = JSON.parse(readFileSync(path.join(RAW, `${code}-${m}.json`), "utf8"));
    if (slot.ok === false || !Array.isArray(slot.items)) throw new Error(`slot missing: ${code}-${m}`);
    byMonth[m] ??= { rows: 0, market: 0, inWindow: 0, observedAt: "" };
    if (slot.observedAt > byMonth[m].observedAt) byMonth[m].observedAt = slot.observedAt;
    for (const item of slot.items) {
      t.rows++;
      byMonth[m].rows++;
      if (String(item?.cdealType ?? "").trim()) { t.cancelled++; continue; }
      if (String(item?.dealingGbn ?? "").trim() === "직거래") { t.direct++; continue; }
      const d = marketDeal(item);
      if (!d) { t.missing++; continue; }
      byMonth[m].market++;
      if (d.date < since) { t.outside++; continue; }
      if (d.date > today) t.future++;
      t.inWindow++;
      byMonth[m].inWindow++;
      if (!refreshed.has(m)) frozenDeals.deals++;
      inWindow.push({ ...d, id: stableId(locationKey(item)) });
    }
  }
  const byId = Map.groupBy(inWindow, (d) => d.id);
  for (const group of byId.values()) {
    const label = areaGroups(group);
    for (const cell of Map.groupBy(group, (d) => label.get(d.area)).values()) {
      if (cell.length < GRADE.minDeals) { t.thinCells++; t.thinDeals += cell.length; continue; }
      t.cells++;
      t.cellDeals += cell.length;
      const fresh = cell.filter((d) => d.date >= recentCut).length;
      recent.deals += fresh;
      if (fresh) recent.cells++;
    }
  }
  raw[code] = t;
}

// ---- output ----
const sum = (obj, k) => Object.values(obj).reduce((s, t) => s + t[k], 0);
console.log("district | code | apartments | cells(n>=3) | enough | partial | excluded n<3 | few_deals | stale_deal | reg_line | sum n");
for (const { code, name } of DISTRICTS) {
  if (!DISTRICT_SLUGS[name]) continue;
  const t = pub[code];
  console.log([name, code, t.apartments, t.cells, t.enough, t.partial, t.thin, t.few_deals, t.stale_deal, t.reg_line, t.n].join(" | "));
}
console.log(["total", "", totals.apartments, totals.cells, totals.enough, totals.partial, totals.thin, totals.few_deals, totals.stale_deal, totals.reg_line, totals.n].join(" | "));
console.log();
console.log("row attribution (builder order) | rows");
const R = (k) => sum(raw, k);
console.log(`raw sale rows in ${months.length} slots x 25 | ${R("rows")}`);
console.log(`1 cancelled (cdealType non-empty) | ${R("cancelled")}`);
console.log(`2 direct deal (dealingGbn=직거래) | ${R("direct")}`);
console.log(`3 missing amount/area/date/name | ${R("missing")}`);
console.log(`4 contract before windowStart ${since} | ${R("outside")}`);
console.log(`5 in a cell with n<${GRADE.minDeals} | ${R("thinDeals")} (cells ${R("thinCells")})`);
console.log(`kept: in a cell with n>=${GRADE.minDeals} | ${R("cellDeals")} (cells ${R("cells")})`);
console.log(`in-window market rows with contract after ${today} | ${R("future")}`);
console.log();
console.log("district | rows | cancelled | direct | missing | outside | thin deals | thin cells | cell deals | cells");
for (const { code, name } of DISTRICTS) {
  const t = raw[code];
  console.log([name, t.rows, t.cancelled, t.direct, t.missing, t.outside, t.thinDeals, t.thinCells, t.cellDeals, t.cells].join(" | "));
}
console.log();
console.log("slot month | refreshed daily | rows | market rows | in-window market | last observedAt (max of 25)");
for (const m of months) {
  const t = byMonth[m];
  console.log([m, refreshed.has(m) ? "yes" : "frozen", t.rows, t.market, t.inWindow, t.observedAt].join(" | "));
}
console.log();
console.log(`in-window market rows from frozen slots: ${frozenDeals.deals} / ${R("inWindow")}`);
console.log(`deals in n>=3 cells with contract in last 30 days (>= ${recentCut}): ${recent.deals} / ${R("cellDeals")}, cells touched ${recent.cells}`);
console.log(`missing fields in published cells: buildYear null apartments ${totals.noBuildYear}/${totals.apartments}, households non-null ${totals.households}, jeonseN=0 cells ${totals.noJeonse}/${totals.cells}, lastFloor null cells ${totals.noFloor}, aliased apartments ${totals.aliased}, max peers_n ${totals.peerMax}`);
console.log();
const ok = [
  ["sum n == kept rows", totals.n, R("cellDeals")],
  ["cells == n>=3 cells", totals.cells, R("cells")],
  ["excluded thin == n<3 cells", totals.thin, R("thinCells")],
  ["enough+partial == cells", totals.enough + totals.partial, totals.cells],
  ["rows == sum of reasons + kept", R("rows"), R("cancelled") + R("direct") + R("missing") + R("outside") + R("thinDeals") + R("cellDeals")],
];
for (const [label, a, b] of ok) console.log(`check ${label}: ${a} ${a === b ? "==" : "!="} ${b}`);
if (ok.some(([, a, b]) => a !== b)) process.exitCode = 1;
