// #7 월세→월세 재계약 격차: 전환율에 얼마나 달렸나, 자치구 문턱은 몇 건인가.
// node research/wolse-renewal/check.mjs
import { readFile } from "node:fs/promises";
import { readRawRents, MONTHS } from "../../scripts/build-renewal-facts.mjs";
import { recentMonths } from "../../scripts/realestate-source.mjs";
import { renewalGap, wolseRenewalGaps } from "../../scripts/renewal-facts.mjs";

const now = new Date();
const byDistrict = await readRawRents(recentMonths(now, MONTHS));
const all = Object.values(byDistrict).flat();
const conversion = JSON.parse(await readFile(new URL("../../docs/data/conversion.json", import.meta.url), "utf8"));
const rate = conversion.seoul.rate;

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const share = (v) => (v.filter((g) => g < 0).length / v.length) * 100;

console.log(`창 ${MONTHS}개월, 실측 전환율 ${rate}%`);
console.log("전세 갱신 vs 신규", JSON.stringify(renewalGap(all, now)));
for (const r of [3, rate, 6, 8, 10]) {
  const g = wolseRenewalGaps(all, now, r);
  console.log(`월세 전환율 ${r}%: 맞물림 ${g.length} 중앙값 ${median(g).toFixed(1)}% 더 싼 비율 ${share(g).toFixed(1)}%`);
}

// 부트스트랩: 서울 표본에서 n건을 뽑아 중앙값이 얼마나 흔들리나(전세 문턱과 같은 방법, 400회).
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const seoul = wolseRenewalGaps(all, now, rate);
for (const n of [20, 40, 60, 80, 100, 150, 200]) {
  const meds = [];
  for (let i = 0; i < 400; i += 1) meds.push(median(Array.from({ length: n }, () => seoul[Math.floor(rand() * seoul.length)])));
  meds.sort((a, b) => a - b);
  const lo = meds[10], hi = meds[389];
  console.log(`n=${String(n).padStart(3)}  ${lo.toFixed(1)}% ~ ${hi.toFixed(1)}%  폭 ${(hi - lo).toFixed(1)}%p`);
}

for (const [name, items] of Object.entries(byDistrict)) {
  const g = wolseRenewalGaps(items, now, rate);
  if (g.length) console.log(name.padEnd(5), g.length, median(g).toFixed(1), share(g).toFixed(0) + "%");
}
