// out/ 결과로 PREREG.md 의 지표·통과 조건·선택 규칙을 그대로 계산한다. 인자 없음(입력 A·B 둘 다 읽는다).
// 빌드 시간은 out/time-908.json(time-908.mjs 가 쓴다)에서 읽는다. 없으면 판정을 내지 않는다.
import { readFileSync, existsSync } from "node:fs";
import { RULES, ORDER, LABEL, Z, C_WIDTH, KAPPA, X_FIXED, K_EXTRA, sampleSd } from "./rules-908.mjs";

const SEEDS = Array.from({ length: 20 }, (_, k) => 20261001 + 7919 * k);
const REF = { R: 20000, seed: 1 };
const CAND_R = 4000;
const FLIP_MED = 1, FLIP_MAX = 3; // #858 과 같은 문턱
const LOSS_CAP = 9; // 말할 수 있는 쌍 감소 상한(입력마다)
const TIME_CAP_MS = 7700; // 30 − 22.3 초(PR #912 실측), cto 조건 3

const at = (f) => JSON.parse(readFileSync(new URL(`./out/${f}.json`, import.meta.url), "utf8"));
const median = (a) => { const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const names = { 11110: "종로", 11140: "중구", 11170: "용산", 11200: "성동", 11215: "광진", 11230: "동대문", 11260: "중랑", 11290: "성북", 11305: "강북", 11320: "도봉", 11350: "노원", 11380: "은평", 11410: "서대문", 11440: "마포", 11470: "양천", 11500: "강서", 11530: "구로", 11545: "금천", 11560: "영등포", 11590: "동작", 11620: "관악", 11650: "서초", 11680: "강남", 11710: "송파", 11740: "강동" };
const nm = (k) => k.split("-").map((c) => names[c] ?? c).join("-");

console.log(`고정값: Z ${Z} · (가) X ${X_FIXED}만원 · (나) κ ${KAPPA.toFixed(6)} C ${C_WIDTH.toFixed(6)} · (다) 더 돌리는 씨앗 ${K_EXTRA}개 · 문턱 중앙 ≤ ${FLIP_MED} 최대 ≤ ${FLIP_MAX} · 감소 상한 ${LOSS_CAP} · 시간 ${TIME_CAP_MS}ms`);

/** 한 입력의 모든 규칙 답: ans[rule].ref[pair], ans[rule].seed[k][pair]. */
function answersOf(name) {
  const ref = at(`${name}-${REF.R}-${REF.seed}`);
  const runs = SEEDS.map((s) => at(`${name}-${CAND_R}-${s}`));
  const pairs = Object.keys(ref).sort();
  // 씨앗 20개 끝값의 표본표준편차 = 4,000번 끝값의 추첨 흔들림(참값 대용). (다)·(다′)의 기준 답에 쓴다.
  const sd20 = Object.fromEntries(pairs.map((p) => [p, { sdLow: sampleSd(runs.map((r) => r[p].low)), sdHigh: sampleSd(runs.map((r) => r[p].high)) }]));
  const ans = {};
  for (const rule of ORDER) {
    const f = RULES[rule];
    const refAns = Object.fromEntries(pairs.map((p) => [p, rule === "da" || rule === "da2" ? RULES.da(ref[p], sd20[p]) : f(ref[p])]));
    const seedAns = runs.map((run, k) => Object.fromEntries(pairs.map((p) => {
      if (rule !== "da") return [p, f(run[p])];
      // (다) 빌드: 지금 씨앗 k 와 더 돌리는 씨앗 k+1..k+K_EXTRA(20 안에서 돌린다)의 끝값 표본표준편차.
      const set = Array.from({ length: K_EXTRA + 1 }, (_, j) => runs[(k + j) % SEEDS.length][p]);
      return [p, f(run[p], { sdLow: sampleSd(set.map((m) => m.low)), sdHigh: sampleSd(set.map((m) => m.high)) })];
    })));
    ans[rule] = { ref: refAns, seed: seedAns };
  }
  return { pairs, ans, sd20 };
}

const diffKeys = (x, y, keys) => keys.filter((k) => x[k] !== y[k]);
const sayable = (a, keys) => keys.filter((k) => a[k] !== "none").length;

const inputs = ["A", "B"].filter((n) => existsSync(new URL(`./input-908-${n}.json`, import.meta.url)));
const res = {};
for (const name of inputs) {
  const inp = JSON.parse(readFileSync(new URL(`./input-908-${name}.json`, import.meta.url), "utf8"));
  const { pairs, ans } = answersOf(name);
  console.log(`\n== 입력 ${name} (now ${inp.now}, 두 시기 ${inp.periods.base.join(",")} → ${inp.periods.recent.join(",")}, 쌍 ${pairs.length})`);
  console.log("| 규칙 | 뒤집힘 중앙 | 뒤집힘 최대 | 범위 | k=0 대비 중앙/최대 | 늘↔줄 뒤집힘 | 기준 말할 수 있는 쌍 | 감소 | 씨앗별 감소 중앙 | 한 번이라도 뒤집힌 쌍 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  const sRa = sayable(ans.ra.ref, pairs);
  res[name] = {};
  for (const rule of ORDER) {
    const { ref, seed } = ans[rule];
    const F = seed.map((a) => diffKeys(a, ref, pairs).length);
    const F0 = seed.slice(1).map((a) => diffKeys(a, seed[0], pairs).length);
    const opp = seed.reduce((n, a) => n + pairs.filter((p) => a[p] !== "none" && ref[p] !== "none" && a[p] !== ref[p]).length, 0);
    const S = sayable(ref, pairs);
    const lossSeed = median(seed.map((a, k) => sayable(ans.ra.seed[k], pairs) - sayable(a, pairs)));
    const ever = {};
    for (const a of seed) for (const p of diffKeys(a, ref, pairs)) ever[p] = (ever[p] ?? 0) + 1;
    const everTxt = Object.entries(ever).sort((x, y) => y[1] - x[1]).map(([p, v]) => `${nm(p)} ${v}/20`).join(", ") || "없음";
    res[name][rule] = { medF: median(F), maxF: Math.max(...F), minF: Math.min(...F), loss: sRa - S, ever };
    console.log(`| ${LABEL[rule]} | ${median(F)} | ${Math.max(...F)} | ${Math.min(...F)}~${Math.max(...F)} | ${median(F0)}/${Math.max(...F0)} | ${opp} | ${S} | ${sRa - S} | ${lossSeed} | ${everTxt} |`);
  }
}

// 날마다의 뒤집힘: 데이터 몫과 추첨 몫(입력 B → A, 두 입력 모두 있는 쌍만).
if (inputs.length === 2) {
  const [A, B] = [answersOf("A"), answersOf("B")];
  const common = A.pairs.filter((p) => B.pairs.includes(p));
  console.log(`\n== 날마다의 뒤집힘 B → A (공통 쌍 ${common.length}, A 에만 ${A.pairs.length - common.length}, B 에만 ${B.pairs.length - common.length})`);
  console.log("| 규칙 | 화면 답 바뀜(씨앗 k=0) | 데이터 몫(기준 답도 바뀜) | 추첨 몫: 화면만 바뀜 | 추첨 몫: 기준만 바뀜 | 씨앗 20개 추첨 몫 중앙/최대 |");
  console.log("|---|---|---|---|---|---|");
  for (const rule of ORDER) {
    const D = new Set(diffKeys(A.ans[rule].ref, B.ans[rule].ref, common));
    const lot = SEEDS.map((_, k) => { const Pk = new Set(diffKeys(A.ans[rule].seed[k], B.ans[rule].seed[k], common)); return [...Pk].filter((p) => !D.has(p)).length + [...D].filter((p) => !Pk.has(p)).length; });
    const P0 = new Set(diffKeys(A.ans[rule].seed[0], B.ans[rule].seed[0], common));
    const both = [...P0].filter((p) => D.has(p));
    console.log(`| ${LABEL[rule]} | ${P0.size} | ${both.length} | ${[...P0].filter((p) => !D.has(p)).length} | ${[...D].filter((p) => !P0.has(p)).length} | ${median(lot)}/${Math.max(...lot)} |`);
  }
}

// 파이프라인 확인: 입력 B 의 (라) 줄은 #858 결과(같은 자료·횟수·씨앗·기준)를 그대로 내야 한다. 다르면 판정하지 않는다.
const K858 = { "11410-11650": 11, "11170-11590": 6, "11290-11650": 5, "11470-11650": 4, "11560-11680": 3, "11440-11560": 1 };
let ok858 = null;
if (res.B) {
  const r = res.B.ra;
  ok858 = r.medF === 2 && r.maxF === 3 && r.minF === 0 && JSON.stringify(Object.entries(r.ever).sort()) === JSON.stringify(Object.entries(K858).sort());
  console.log(`\n#858 재현(입력 B, (라)): ${ok858 ? "일치" : "불일치"} - 중앙 ${r.medF} 최대 ${r.maxF} 범위 ${r.minF}~${r.maxF}, 뒤집힌 쌍 ${Object.keys(r.ever).length}개`);
}

// 통과 조건과 선택 규칙(PREREG.md 「판정 규칙」).
const timeFile = new URL("./out/time-908.json", import.meta.url);
if (ok858 === false) { console.log("\n판정: #858 재현 불일치 - 보류(원인을 #908 에 적는다)"); process.exit(0); }
if (inputs.length !== 2 || !existsSync(timeFile)) { console.log("\n판정: 입력 A·B 와 빌드 시간(out/time-908.json)이 모두 있어야 낸다 - 보류"); process.exit(0); }
const time = JSON.parse(readFileSync(timeFile, "utf8"));
console.log("\n== 판정");
const pass = [];
for (const rule of ORDER) {
  const why = [];
  for (const n of ["A", "B"]) {
    const r = res[n][rule];
    if (!(r.medF <= FLIP_MED)) why.push(`${n} 중앙 ${r.medF}`);
    if (!(r.maxF <= FLIP_MAX)) why.push(`${n} 최대 ${r.maxF}`);
    if (!(r.loss <= LOSS_CAP)) why.push(`${n} 감소 ${r.loss}`);
  }
  if (!(time[rule]?.increaseMs <= TIME_CAP_MS)) why.push(`시간 +${time[rule]?.increaseMs}ms`);
  console.log(`${LABEL[rule]}: ${why.length ? "탈락 - " + why.join(", ") : "통과"} (빌드 시간 +${time[rule]?.increaseMs}ms)`);
  if (!why.length) pass.push(rule);
}
const key = (r) => [res.A[r].loss + res.B[r].loss, res.A[r].maxF + res.B[r].maxF, res.A[r].medF + res.B[r].medF, ORDER.indexOf(r)];
pass.sort((x, y) => { const [a, b] = [key(x), key(y)]; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; });
console.log(pass.length ? `고른 규칙: ${LABEL[pass[0]]} (통과 ${pass.map((r) => LABEL[r]).join(", ")})` : "통과한 후보 없음 → (라) 규칙 없음, method 흔들림 문장 확인(완료 조건 4)");
