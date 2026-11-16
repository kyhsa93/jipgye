// OUT/ 의 결과로 PREREG S1~S4 지표·문턱·선택을 낸다. 인자: <OUT 폴더> <판정 입력…> (B=A 면 A 하나, 아니면 A B).
// 문턱·예산·선택 순서는 lib-909.mjs 의 고정값을 그대로 쓴다. 결과를 보고 바꾸지 않는다(PREREG 「결과를 본 뒤 바꾸지 않는다」).
import { network, finish, CANDIDATES, SEEDS, BASE, BUDGET_S, CI, DIRECT_MAX, segLimits, pct, round1, pairsWithin, stat } from "./lib-909.mjs";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.argv[2]);
const labels = process.argv.slice(3);
if (!labels.length || labels.some((l) => !["A", "B"].includes(l))) {
  console.error("쓰는 법: node analyze-909.mjs <OUT 폴더> A [B]");
  process.exit(1);
}
const at = (f) => JSON.parse(readFileSync(path.join(OUT, f), "utf8"));
const fmt = (s) => `중앙 ${s.median} 최대 ${s.max} 범위 ${s.min}~${s.max}`;
let netRun = 0;
let files = 0;
const load = (label, R, seed) => {
  const o = at(`${label}-${R}-${seed}.json`);
  netRun += o.network;
  files += 1;
  return o;
};
const segRows = (o) => Object.fromEntries(Object.entries(o.segment).map(([dim, m]) => [dim, Object.entries(m).map(([code, [lo, hi]]) => ({ code, low: pct(lo), high: pct(hi) }))]));
const dirEnds = (o) => Object.fromEntries(Object.entries(o.direct).map(([u, [lo, hi]]) => [u, [round1(lo), round1(hi)]]));
const diffKeys = (x, y) => Object.keys(y).filter((k) => x[k] !== y[k]);

const pass = { segment: {}, direct: {} };
const residual = { segment: {}, direct: {} };
for (const label of labels) {
  const inp = at(`input-909-${label}.json`);
  const base = load(label, BASE.rounds, BASE.seed);
  const bRows = segRows(base);
  const bPairs = { price: pairsWithin(bRows.price), age: pairsWithin(bRows.age) };
  const P = { price: Object.keys(bPairs.price).length, age: Object.keys(bPairs.age).length };
  const Ptot = P.price + P.age;
  const pubP = Object.keys(inp.public.pairs.price).length + Object.keys(inp.public.pairs.age).length;
  const lim = segLimits(Ptot);
  const bDir = dirEnds(base);
  console.log(`\n== 입력 ${label}: segment now ${inp.now.segment} · direct now ${inp.now.direct} · 두 시기 ${inp.periods.base.join(",")} → ${inp.periods.recent.join(",")} · 직거래 달 ${inp.months.join("~").replace(/~(\d+)$/, " ($1개월)")}`);
  console.log(`기준(${BASE.rounds}번, 씨앗 ${BASE.seed}) segment 쌍 P = ${Ptot} (가격대 ${P.price} + 연식 ${P.age}; 공개 파일 ${pubP})${Ptot !== pubP ? " ← 다름: 멈춤" : ""} · 문턱 S1 중앙 ≤ ${lim.median}, 최대 ≤ ${lim.max}`);
  if (Ptot !== pubP) process.exit(1);
  console.log(`  기준 갈라 볼 수 있는 쌍: 가격대 ${Object.values(bPairs.price).filter(Boolean).length}/${P.price} · 연식 ${Object.values(bPairs.age).filter(Boolean).length}/${P.age}`);
  for (const [dim, rows] of Object.entries(bRows)) console.log(`  기준 ${dim}: ${rows.map((r) => `${r.code} ${r.low}~${r.high}`).join(" · ")}`);
  console.log(`  기준 직거래: ${Object.entries(bDir).map(([u, [lo, hi]]) => `${u} ${lo}~${hi}`).join(" · ")} · 문턱 S2 구간마다 D ≤ ${DIRECT_MAX}/20`);

  pass.segment[label] = {};
  pass.direct[label] = {};
  residual.segment[label] = {};
  residual.direct[label] = {};
  for (const R of CANDIDATES) {
    const F = [], Fp = [], Fa = [];
    const flips = {};
    const ends = {};
    let anyEnd = 0;
    const D = Object.fromEntries(Object.keys(bDir).map((u) => [u, 0]));
    for (const seed of SEEDS) {
      const o = load(label, R, seed);
      const rows = segRows(o);
      const dp = diffKeys(pairsWithin(rows.price), bPairs.price);
      const da = diffKeys(pairsWithin(rows.age), bPairs.age);
      Fp.push(dp.length);
      Fa.push(da.length);
      F.push(dp.length + da.length);
      for (const k of [...dp, ...da]) flips[k] = (flips[k] ?? 0) + 1;
      let changed = false;
      for (const [dim, rs] of Object.entries(rows)) rs.forEach((r, i) => {
        const b = bRows[dim][i];
        if (r.low !== b.low || r.high !== b.high) {
          ends[`${dim}:${r.code}`] = (ends[`${dim}:${r.code}`] ?? 0) + 1;
          changed = true;
        }
      });
      if (changed) anyEnd += 1;
      const de = dirEnds(o);
      for (const u of Object.keys(bDir)) if (de[u][0] !== bDir[u][0] || de[u][1] !== bDir[u][1]) D[u] += 1;
    }
    const s = stat(F);
    const okS = s.median <= lim.median && s.max <= lim.max;
    const okD = Object.values(D).every((d) => d <= DIRECT_MAX);
    pass.segment[label][R] = okS;
    pass.direct[label][R] = okD;
    residual.segment[label][R] = `${s.min}~${s.max}쌍(중간값 ${s.median}쌍) / ${Ptot}`;
    residual.direct[label][R] = Object.entries(D).map(([u, d]) => `${u} ${d}/20`).join(", ");
    console.log(`segment R=${R} (씨앗 ${F.length}): F_pair [${fmt(s)}] / ${Ptot} → S1 ${okS ? "통과" : "미달"} | 가격대 [${fmt(stat(Fp))}] / ${P.price} · 연식 [${fmt(stat(Fa))}] / ${P.age}`);
    const fl = Object.entries(flips).sort((a, b) => b[1] - a[1]);
    console.log(`  뒤집힌 쌍 ${fl.length}개: ${fl.map(([k, v]) => `${k} ${v}/20`).join(", ") || "없음"}`);
    console.log(`  보조(판정에 안 씀) 12구간 끝값이 기준과 다른 씨앗: 하나라도 다른 씨앗 ${anyEnd}/20 · 구간별 ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(", ") || "없음"}`);
    console.log(`direct R=${R}: D ${Object.entries(D).map(([u, d]) => `${u} ${d}/20`).join(", ")} → S2 ${okD ? "통과" : "미달"}`);
  }
}

// ---- 시간(S3)과 선택(S4) ------------------------------------------------------------------------------------------
const t = at("time-909.json");
const inc = (kind, R) => (t[kind][R] - t[kind][400]) / 1000;
console.log(`\n== 시간 (이 머신, 입력 ${t.label}, ${t.reps}회 중앙값, 부하 시작 ${t.load.start.join(" ")} · 끝 ${t.load.end.join(" ")}, 기다림 ${t.waited}회)`);
for (const R of CANDIDATES) {
  const s = inc("segment", R), d = inc("direct", R);
  const ci = [s * CI.ratio[0], s * CI.ratio[1]].map((x) => x.toFixed(2));
  const total = (CI.segment400s * t.segment[R]) / t.segment[400];
  console.log(
    `R=${R}: segment ${t.segment[R]}ms (증가 ${s.toFixed(2)}초) · direct ${t.direct[R]}ms (증가 ${d.toFixed(2)}초) · 합 증가 ${(s + d).toFixed(2)}초 | ` +
      `기록만: CI 환산 segment 증가 ${ci[0]}~${ci[1]}초(×${CI.ratio.join("~")}), CI segment 추정 ${total.toFixed(2)}초(11-16 Daily ${CI.segment400s}초 × 이 머신 비)`
  );
}
const choose = (kind, budget) => {
  const within = CANDIDATES.filter((R) => inc(kind, R) <= budget);
  const ok = within.filter((R) => labels.every((l) => pass[kind][l][R]));
  return ok.length ? { R: Math.min(...ok), passed: true, within } : { R: Math.max(...within), passed: false, within };
};
const cD = choose("direct", BUDGET_S);
const left = BUDGET_S - inc("direct", cD.R);
const cS = choose("segment", left);
const say = (name, c) =>
  `${name}: R = ${c.R} → ${c.R === 400 ? "바꾸지 않음" : "바꿈"}${c.passed ? " (문턱 통과 가장 작은 R)" : ` (통과 후보 없음 → 예산 안 가장 큰 R, 남는 값 ${labels.map((l) => `${l}: ${residual[name][l][c.R]}`).join(" / ")})`} · 예산 안 후보 ${c.within.join("·")}`;
console.log(`\n== 선택 (S4, 판정 입력 ${labels.join("·")}, 예산 ${BUDGET_S}초, direct 먼저)`);
console.log(say("direct", cD));
console.log(`segment 예산 = ${BUDGET_S} − direct 증가 ${inc("direct", cD.R).toFixed(2)} = ${left.toFixed(2)}초`);
console.log(say("segment", cS));
const expected = labels.length * (1 + CANDIDATES.length * SEEDS.length);
console.log(`읽은 결과 파일 ${files}개 (기대 ${expected})${files !== expected ? " ← 다름" : ""}`);
console.log(`재추출 실행의 네트워크 호출 합 ${netRun}`);
if (netRun || files !== expected) process.exit(2);
finish("analyze");
