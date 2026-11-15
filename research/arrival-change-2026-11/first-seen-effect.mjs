// #862 조건 6 효과: 행 첫 관측일 상태(raw/first-seen)로 도착일을 앞당겼을 때 무엇이 달라지나. 호출 0, 작업 트리의 raw 만 읽는다.
// 사용: node research/arrival-change-2026-11/first-seen-effect.mjs [YYYY-MM-DD]   (기본 2026-11-15, KST 정오로 본다)
// 출력: 종류별 도장 행 중 앞당긴 행 수(구 창 안), 서울 1주·구 4주 대표값의 전후, week-digest 두 창의 전후.
import path from "node:path";
const REPO = path.resolve(import.meta.dirname, "../..");
const S = (p) => `${REPO}/scripts/${p}`;
const { readWindowItems, representWindow, representativeOverall, representativeDistricts } = await import(S("build-realestate.ts"));
const { readSlotFile, itemKey } = await import(S("realestate-raw.ts"));
const { readFirstSeen, effectiveArrivals } = await import(S("realestate-first-seen.ts"));
const { DISTRICTS } = await import(S("realestate-districts.ts"));
const { windowMonths } = await import(S("realestate-slots.ts"));
const { nextWeek, REPRESENT_WEEKS } = await import(S("realestate-weekly.ts"));
const { buildWeekDigest } = await import(S("build-week-digest.ts"));
const { mkdtemp, rename } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");

const date = process.argv[2] ?? "2026-11-15";
const now = new Date(`${date}T03:00:00Z`);
const win = representWindow(now, "arrival");
const districtFrom = nextWeek(win.from, -(REPRESENT_WEEKS - 1));

for (const kind of ["sale", "rent"]) {
  let stamped = 0, moved = 0;
  for (const ym of windowMonths(now)) for (const { code } of DISTRICTS) {
    const f = await readSlotFile(kind, code, ym);
    if (!f?.items) continue;
    const eff = effectiveArrivals(f, await readFirstSeen(kind, code, ym));
    f.items.forEach((it, i) => {
      const s = f.arrivals?.[itemKey(it)];
      if (!s || s < districtFrom) return;
      stamped += 1;
      if (eff[i] !== s) moved += 1;
    });
  }
  console.log(`${kind}: ${districtFrom}~ 도장 행 ${stamped} 중 첫 관측일로 앞당긴 행 ${moved}`);
}

const NONE = async () => null;
for (const [label, seen] of [["도장 그대로", NONE], ["첫 관측일", readFirstSeen]]) {
  const { items } = await readWindowItems(now, { ...win, from: districtFrom }, readSlotFile, seen);
  const week = new Map();
  for (const [k, rows] of items) { const kept = rows.filter((r) => r.date >= win.from); if (kept.length) week.set(k, kept); }
  const o = representativeOverall(week);
  const ds = representativeDistricts(items);
  const conc = ds.filter((d) => d.sale?.concentration).map((d) => `${d.name} ${d.sale.transactionCount}건 중 ${d.sale.concentration.rows}`);
  console.log(`${label}: 서울 ${win.from}~ 매매 ${o.sale.avgPricePerPyeong10k}만원 ${o.sale.transactionCount}건 · 전세 ${o.jeonse.transactionCount}건 · 월세 ${o.wolse.transactionCount}건 · 구 쏠림 ${conc.join(", ") || "없음"}`);
}

// week-digest: 상태 폴더를 잠시 옮겨 「도장 그대로」를 낸다(끝나면 되돌린다).
const out = await mkdtemp(path.join(tmpdir(), "first-seen-effect-"));
const fs = path.join(REPO, "raw", "first-seen");
const run = async (label, file) => {
  const d = await buildWeekDigest({ now, out: path.join(out, file) });
  for (const w of ["current", "previous"]) console.log(`${label} week-digest ${d[w].from}~${d[w].to}: 매매 ${d[w].sale} · 전세 ${d[w].jeonse} · 월세 ${d[w].wolse} · 직거래 ${d[w].direct} · 많은 구 ${d[w].districts.join(",")}`);
};
await run("첫 관측일", "new.json");
await rename(fs, `${fs}.hold`);
try { await run("도장 그대로", "old.json"); } finally { await rename(`${fs}.hold`, fs); }
