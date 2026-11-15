// 각 날짜 기록의 서울 전체 표본(매매·전세·월세)을 그 기록을 마지막으로 바꾼 커밋 트리에서 다시 만들고, 기록 값과 대조한다.
// findBaseline 규칙으로 고른 기준 기록과의 7일 변화, 그리고 행 재추출(합친 표본에서 복원 추출, 양쪽 각각) 1,000회 90% 구간. 호출 0.
import { execFileSync } from "node:child_process";
import path from "node:path";
const REPO = path.resolve(import.meta.dirname, "../..");
const S = (p) => `${REPO}/scripts/${p}`;
const { readWindowItems, districtEntries } = await import(S("build-realestate.ts"));
const { computeOverall, findBaseline } = await import(S("realestate-metrics.ts"));
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { maxBuffer: 1 << 30 }).toString();
const commits = git("log", "--reverse", "--format=%H", "main", "--", "docs/data/realestate-history.json").trim().split("\n");
const owner = new Map(); let prev = new Map();
for (const c of commits) {
  let h; try { h = JSON.parse(git("show", `${c}:docs/data/realestate-history.json`)); } catch { continue; }
  const cur = new Map(h.map((r) => [r.date, JSON.stringify(r)]));
  for (const [d, s] of cur) if (prev.get(d) !== s) owner.set(d, c);
  prev = cur;
}
const final = JSON.parse(git("show", "main:docs/data/realestate-history.json"));
const samples = new Map();
for (const rec of final) {
  const c = owner.get(rec.date); const w = rec.window; if (!c || !w) continue;
  const read = async (kind, code, ym) => { try { return JSON.parse(git("show", `${c}:raw/${kind}/${code}-${ym}.json`)); } catch { return null; } };
  const now = new Date(`${rec.date}T03:00:00Z`);
  const { items } = await readWindowItems(now, { ...w }, read);
  const rows = []; for (const [key, rs] of items) for (const r of rs) rows.push({ key, item: r.item });
  samples.set(rec.date, { rec, rows });
}

const { isRenewalContract } = await import(S("realestate-metrics.ts"));
const P = 3.3058, RATE = 0.048;
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : null; };
const cancelled = (it) => String(it?.cdealType ?? "").trim().length > 0 || String(it?.cdealDay ?? "").trim().length > 0;
// 종류별 숫자 행: d=구 인덱스, x=값(매매 금액만원·전세 보증금만원·월세 환산만원), a=면적
function rowsOf(rows) {
  const out = { sale: [], jeonse: [], wolse: [] }; const idx = new Map();
  for (const { key, item } of rows) {
    const [kind, code] = key.split(":"); if (!idx.has(code)) idx.set(code, idx.size); const d = idx.get(code);
    const a = Number(item.excluUseAr); if (!Number.isFinite(a) || a <= 0) continue;
    if (kind === "sale") { const x = num(item.dealAmount); if (cancelled(item) || x == null || x <= 0) continue; out.sale.push([d, x, a]); }
    else { if (isRenewalContract(item)) continue; const dep = num(item.deposit); const m = num(item.monthlyRent); if (dep == null || dep <= 0) continue;
      if (m && m > 0) out.wolse.push([d, dep + (m * 12) / RATE, a]); else out.jeonse.push([d, dep, a]); }
  }
  return out;
}
// computeOverall 과 같은 식: 구별 (합 x / 합 a) 를 구 건수로 가중. 매매·전세는 ㎡당 원을 3.3㎡당 만원으로, 월세는 구별로 반올림한 뒤 가중.
function value(rs, kind) {
  const sx = new Map(), sa = new Map(), n = new Map();
  for (const [d, x, a] of rs) { sx.set(d, (sx.get(d) ?? 0) + x); sa.set(d, (sa.get(d) ?? 0) + a); n.set(d, (n.get(d) ?? 0) + 1); }
  let tw = 0, t = 0;
  for (const [d, c] of n) {
    const v = kind === "wolse" ? Math.round((sx.get(d) / sa.get(d)) * P) : (sx.get(d) * 10000) / sa.get(d);
    tw += v * c; t += c;
  }
  if (!t) return null;
  return kind === "wolse" ? Math.round(tw / t) : Math.round(((tw / t) * P) / 10000);
}
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const resample = (rs) => Array.from({ length: rs.length }, () => rs[Math.floor(rnd() * rs.length)]);
const B = Number(process.argv[2] ?? 1000);
const pick = (o, k) => (k === "sale" ? o?.sale?.avgPricePerPyeong10k : k === "jeonse" ? o?.jeonse?.avgDepositPerPyeong10k : o?.wolse?.avgConvertedPerPyeong10k);
const histSoFar = [];
const nums = new Map();
for (const [d, s] of samples) nums.set(d, rowsOf(s.rows));
for (const rec of final) {
  const base = findBaseline(histSoFar.slice(), new Date(`${rec.date}T03:00:00Z`));
  histSoFar.push(rec);
  const mine = nums.get(rec.date); if (!mine) continue;
  const out = { date: rec.date, basis: rec.window.basis, base: base?.date ?? null, baseBasis: base?.window?.basis ?? null };
  const bn = base && nums.get(base.date);
  for (const k of ["sale", "jeonse", "wolse"]) {
    out[k] = { v: value(mine[k], k), recV: pick(rec.overall, k), n: mine[k].length, recN: rec.overall?.[k]?.transactionCount ?? null };
    if (!bn || rec.window.basis !== "arrival") continue;
    out[k].bv = value(bn[k], k); out[k].baseRecV = pick(base.overall, k); out[k].baseN = bn[k].length;
    if (mine[k].length < 100 || bn[k].length < 100 || out[k].bv == null) continue;
    out[k].chg = out[k].v / out[k].bv - 1;
    const diffs = [];
    for (let b = 0; b < B; b++) diffs.push(value(resample(mine[k]), k) / value(resample(bn[k]), k) - 1);
    diffs.sort((a, b) => a - b);
    out[k].lo = diffs[Math.floor(B * 0.05)]; out[k].hi = diffs[Math.floor(B * 0.95) - 1];
  }
  console.log(JSON.stringify(out));
}
