// 11-15·11-08 서울 전세 도착 표본의 가장 큰 단지 묶음(단지, 단지+계약일). 호출 0.
import { execFileSync } from "node:child_process";
import path from "node:path";
const REPO = path.resolve(import.meta.dirname, "../.."); const S = (p) => `${REPO}/scripts/${p}`;
const { readWindowItems } = await import(S("build-realestate.ts"));
const { isRenewalContract } = await import(S("realestate-metrics.ts"));
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { maxBuffer: 1 << 30 }).toString();
const hist = (c) => JSON.parse(git("show", `${c}:docs/data/realestate-history.json`));
const log = git("log", "--format=%H", "main", "--", "docs/data/realestate-history.json").trim().split("\n");
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
for (const date of process.argv.slice(2)) {
  const c = log.slice().reverse().find((h) => { try { return hist(h).some((r) => r.date === date); } catch { return false; } });
  const rec = hist(c).find((r) => r.date === date);
  const read = async (kind, code, ym) => { if (kind !== "rent") return null; try { return JSON.parse(git("show", `${c}:raw/rent/${code}-${ym}.json`)); } catch { return null; } };
  const { items } = await readWindowItems(new Date(`${date}T03:00:00Z`), rec.window, read);
  const rows = [];
  for (const [key, rs] of items) for (const { item } of rs) {
    if (isRenewalContract(item)) continue; const dep = num(item.deposit), m = num(item.monthlyRent), a = Number(item.excluUseAr);
    if (!(dep > 0) || !(a > 0) || (m && m > 0)) continue;
    rows.push({ k1: `${key}|${item.aptNm}`, k2: `${key}|${item.aptNm}|${item.dealYear}-${item.dealMonth}-${item.dealDay}`, dep, a, ct: item.contractType });
  }
  const top = (f) => { const m = new Map(); for (const r of rows) m.set(r[f], (m.get(r[f]) ?? 0) + 1); return [...m].sort((x, y) => y[1] - x[1]).slice(0, 3); };
  const ppm = (rs) => Math.round((rs.reduce((s, r) => s + r.dep, 0) / rs.reduce((s, r) => s + r.a, 0)) * 3.3058);
  const t1 = top("k1")[0]; const pub = rows.filter((r) => /임대/.test(r.k1)); console.log(date, "임대 이름 행", pub.length, "/", rows.length, "값", ppm(pub), "나머지", ppm(rows.filter((r) => !/임대/.test(r.k1))));
  console.log(date, "n", rows.length, "pooled", ppm(rows), "top complex", JSON.stringify(top("k1")), "top complex+date", JSON.stringify(top("k2")),
    "without top complex", ppm(rows.filter((r) => r.k1 !== t1[0])), "top complex value", ppm(rows.filter((r) => r.k1 === t1[0])));
}
