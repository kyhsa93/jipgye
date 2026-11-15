// out/ 결과로 사전 등록(PREREG-858.md) 지표를 낸다.
import { readFileSync, existsSync } from "node:fs";
const at = (f) => JSON.parse(readFileSync(new URL(`./out/${f}.json`, import.meta.url), "utf8"));
const seeds = Array.from({ length: 20 }, (_, k) => 20261001 + 7919 * k);
const rPct = (x) => Math.round(Math.expm1(x) * 1000) / 10; // district-change.ts pct
const xPct = (x) => Math.expm1(x) * 100; // 반올림 전
const pairsOf = (band, f) => {
  const codes = Object.keys(band).sort(); const out = {};
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
    const [a, b] = [band[codes[i]].map(f), band[codes[j]].map(f)];
    out[`${codes[i]}-${codes[j]}`] = a[0] > b[1] || b[0] > a[1];
  }
  return out;
};
const ans = (m, f) => { const [lo, hi] = [f(m.low), f(m.high)]; return lo > 0 ? "up" : hi < 0 ? "down" : "none"; };
const answers = (money, f) => Object.fromEntries(Object.entries(money).map(([k, m]) => [k, ans(m, f)]));
const diff = (x, y) => Object.keys(x).filter((k) => x[k] !== y[k]);
const stat = (a) => { const s = [...a].sort((p, q) => p - q); return `중앙 ${s[s.length >> 1] === undefined ? "-" : (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2)} 최대 ${s.at(-1)} 범위 ${s[0]}~${s.at(-1)}`; };
const id = (x) => x;

const refB = at("band-100000-1"), refM = at("money-20000-1");
const refPR = pairsOf(refB, rPct), refPX = pairsOf(refB, xPct);
const refMR = answers(refM, Math.round), refMX = answers(refM, id);
console.log("기준 band 100000: 갈라 볼 수 있는 쌍 반올림", Object.values(refPR).filter(Boolean).length, "반올림 전", Object.values(refPX).filter(Boolean).length, "/", Object.keys(refPR).length, "둘이 다른 쌍", diff(refPR, refPX).join(","));
console.log("기준 money 20000: 말할 수 있는 쌍 반올림", Object.values(refMR).filter((v) => v !== "none").length, "반올림 전", Object.values(refMX).filter((v) => v !== "none").length, "둘이 다른 쌍", diff(refMR, refMX).join(",") || "없음");
const flipRate = { pair: {}, money: {} };
for (const R of [400, 1000, 2000, 4000, 10000]) {
  const FR = [], FX = [], S0 = [], RX = []; let p0;
  for (const [k, s] of seeds.entries()) {
    const f = `band-${R}-${s}`; if (!existsSync(new URL(`./out/${f}.json`, import.meta.url))) continue;
    const b = at(f); const pr = pairsOf(b, rPct), px = pairsOf(b, xPct);
    const d = diff(pr, refPR); FR.push(d.length); FX.push(diff(px, refPX).length); RX.push(diff(pr, px).length);
    if (k === 0) p0 = pr; else S0.push(diff(pr, p0).length);
    for (const key of d) ((flipRate.pair[R] ??= {})[key] = (flipRate.pair[R][key] ?? 0) + 1);
  }
  console.log(`쌍 R=${R} (씨앗 ${FR.length}): 기준 대비 반올림 [${stat(FR)}] 반올림 전 [${stat(FX)}] | k=0 대비 [${stat(S0)}] | 같은 실행 안 반올림/전 다른 쌍 [${stat(RX)}]`);
}
for (const R of [200, 500, 1000, 2000, 4000]) {
  const FR = [], FX = [], S0 = [], RX = []; let p0;
  for (const [k, s] of seeds.entries()) {
    const f = `money-${R}-${s}`; if (!existsSync(new URL(`./out/${f}.json`, import.meta.url))) continue;
    const m = at(f); const ar = answers(m, Math.round), ax = answers(m, id);
    const d = diff(ar, refMR); FR.push(d.length); FX.push(diff(ax, refMX).length); RX.push(diff(ar, ax).length);
    if (k === 0) p0 = ar; else S0.push(diff(ar, p0).length);
    for (const key of d) ((flipRate.money[R] ??= {})[key] = (flipRate.money[R][key] ?? 0) + 1);
  }
  console.log(`금액 R=${R} (씨앗 ${FR.length}): 기준 대비 반올림 [${stat(FR)}] 반올림 전 [${stat(FX)}] | k=0 대비 [${stat(S0)}] | 반올림/전 다른 쌍 [${stat(RX)}]`);
}
const names = { 11110: "종로", 11140: "중구", 11170: "용산", 11200: "성동", 11215: "광진", 11230: "동대문", 11260: "중랑", 11290: "성북", 11305: "강북", 11320: "도봉", 11350: "노원", 11380: "은평", 11410: "서대문", 11440: "마포", 11470: "양천", 11500: "강서", 11530: "구로", 11545: "금천", 11560: "영등포", 11590: "동작", 11620: "관악", 11650: "서초", 11680: "강남", 11710: "송파", 11740: "강동" };
const nm = (k) => k.split("-").map((c) => names[c] ?? c).join("-");
for (const kind of ["pair", "money"]) for (const [R, m] of Object.entries(flipRate[kind])) {
  const e = Object.entries(m).sort((a, b) => b[1] - a[1]);
  console.log(`${kind} R=${R} 한 번이라도 뒤집힌 쌍 ${e.length}개: ${e.slice(0, 8).map(([k, v]) => `${nm(k)} ${v}/20`).join(", ")}`);
}
const sd = refB["11200"], nw = refB["11350"];
console.log("성동 기준 하단 반올림 전", xPct(sd[0]).toFixed(3), "노원 기준 상단", xPct(nw[1]).toFixed(3), "→ 반올림", rPct(sd[0]), rPct(nw[1]));
const yn = refM["11170-11350"]; console.log("용산-노원 기준 money(만원)", Math.round(yn.change), Math.round(yn.low), Math.round(yn.high));
