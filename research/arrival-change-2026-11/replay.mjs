// realestate-history.json 의 각 날짜 기록을 마지막으로 바꾼 커밋의 raw/sale 트리로 그날 구 매매 표본(구 창)을 다시 만든다. 호출 0, git 읽기만.
// 출력: 날짜·구별 표본 수(기록과 대조), 가장 큰 한 단지·한 계약일 묶음, 묶음을 뺀 구 값. JSON 줄.
import { execFileSync } from "node:child_process";
import path from "node:path";
const REPO = path.resolve(import.meta.dirname, "../..");
const S = (p) => `${REPO}/scripts/${p}`;
const { readWindowItems } = await import(S("build-realestate.ts"));
const { DISTRICTS } = await import(S("realestate-districts.ts"));
const { summarizeSaleItems, inSaleSample } = await import(S("realestate-metrics.ts"));
const { concentrationKey } = await import(S("realestate-concentration.ts"));
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { maxBuffer: 1 << 30 }).toString();
const commits = git("log", "--reverse", "--format=%H", "main", "--", "docs/data/realestate-history.json").trim().split("\n");
const owner = new Map(); // date -> commit (그 날짜 기록을 마지막으로 바꾼 커밋)
let prev = new Map();
for (const c of commits) {
  let h; try { h = JSON.parse(git("show", `${c}:docs/data/realestate-history.json`)); } catch { continue; }
  const cur = new Map(h.map((r) => [r.date, JSON.stringify(r)]));
  for (const [d, s] of cur) if (prev.get(d) !== s) owner.set(d, c);
  prev = cur;
}
const final = JSON.parse(git("show", "main:docs/data/realestate-history.json"));
const contractDate = (item) => {
  const y = Number(item.dealYear), m = Number(item.dealMonth), d = Number(item.dealDay);
  return y && m && d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};
for (const rec of final) {
  const c = owner.get(rec.date); const w = rec.window;
  if (!c || !w) { console.log(JSON.stringify({ date: rec.date, skip: !c ? "no-commit" : "no-window" })); continue; }
  const read = async (kind, code, ym) => {
    if (kind !== "sale") return null;
    try { return JSON.parse(git("show", `${c}:raw/sale/${code}-${ym}.json`)); } catch { return null; }
  };
  const now = new Date(`${rec.date}T03:00:00Z`);
  const win = { ...w, from: w.districtFrom ?? w.from };
  const { items } = await readWindowItems(now, win, read);
  for (const { code, name } of DISTRICTS) {
    const rows = items.get(`sale:${code}`) ?? [];
    const sample = rows.filter((r) => inSaleSample(r.item));
    const bundles = new Map();
    for (const r of sample) { const k = concentrationKey(code, r.item, contractDate(r.item)); if (k) bundles.set(k, (bundles.get(k) ?? 0) + 1); }
    let big = null; for (const [k, n] of bundles) if (!big || n > big.n) big = { k, n };
    const all = summarizeSaleItems(rows.map((r) => r.item)).sale;
    const rest = big ? summarizeSaleItems(rows.filter((r) => concentrationKey(code, r.item, contractDate(r.item)) !== big.k).map((r) => r.item)).sale : null;
    const recD = (rec.districts ?? []).find((d) => d.code === code);
    const regFilled = big ? sample.filter((r) => concentrationKey(code, r.item, contractDate(r.item)) === big.k && String(r.item.rgstDate ?? "").trim()).length : 0;
    console.log(JSON.stringify({ date: rec.date, basis: w.basis, commit: c.slice(0, 8), code, name, n: sample.length, recN: recD?.sale?.transactionCount ?? null,
      val: all?.avgPricePerPyeong10k ?? null, recVal: recD?.sale?.avgPricePerPyeong10k ?? null, big: big?.n ?? 0, bigKey: big?.k ?? null, regFilled,
      without: rest?.avgPricePerPyeong10k ?? null, withoutN: rest?.transactionCount ?? 0 }));
  }
}
