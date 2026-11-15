// #862 구 7일 변화 측정(사전 등록 규칙: issuecomment-6890293999 「구 7일 변화」). 호출 0, git 읽기만.
// realestate-history.json 의 각 날짜 기록을 마지막으로 바꾼 커밋의 raw 트리로 그날 구 창(districtFrom~until) 표본을 다시 만들고,
// findBaseline 이 고른 기준 기록의 구 표본과 견준다. 종류: 화면에 구 증감이 실리는 매매·전세·월세(환산값).
// 짝 재추출: 두 표본을 행 동일성(종류·구·원본 행 JSON)으로 맞춰 앞(기준에만)·겹침(양쪽)·뒤(지금에만)로 나누고,
// 셋을 각각 복원 추출한다. 겹침은 한 번 뽑아 양쪽에 같이 쓴다. B회(기본 1,000).
// 출력: 구-일-종류마다 JSON 한 줄. 사용: node district7.mjs [B] > district7.jsonl
import { execFileSync } from "node:child_process";
import path from "node:path";
const REPO = path.resolve(import.meta.dirname, "../..");
const REF = process.env.REF ?? "main";
const S = (p) => `${REPO}/scripts/${p}`;
const { readWindowItems } = await import(S("build-realestate.ts"));
const { DISTRICTS } = await import(S("realestate-districts.ts"));
const { findBaseline, isRenewalContract, inSaleSample, WOLSE_CONVERSION_RATE } = await import(S("realestate-metrics.ts"));
const { CHANGE_MIN_COUNT } = await import(S("realestate-format.ts"));
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { maxBuffer: 1 << 30 }).toString();

const commits = git("log", "--reverse", "--format=%H", REF, "--", "docs/data/realestate-history.json").trim().split("\n");
const owner = new Map(); let prev = new Map();
for (const c of commits) {
  let h; try { h = JSON.parse(git("show", `${c}:docs/data/realestate-history.json`)); } catch { continue; }
  const cur = new Map(h.map((r) => [r.date, JSON.stringify(r)]));
  for (const [d, s] of cur) if (prev.get(d) !== s) owner.set(d, c);
  prev = cur;
}
const final = JSON.parse(git("show", `${REF}:docs/data/realestate-history.json`));

// 커밋별 raw 트리(경로 → blob), blob 내용은 해시로 캐시.
const trees = new Map(); const blobs = new Map();
const treeOf = (c) => {
  if (!trees.has(c)) {
    const m = new Map();
    for (const line of git("ls-tree", "-r", c, "raw/").split("\n")) { const t = line.indexOf("\t"); if (t > 0) m.set(line.slice(t + 1), line.slice(0, t).split(" ")[2]); }
    trees.set(c, m);
  }
  return trees.get(c);
};
const blob = (h) => { if (!blobs.has(h)) blobs.set(h, JSON.parse(git("cat-file", "blob", h))); return blobs.get(h); };

const P = 3.3058, RATE = WOLSE_CONVERSION_RATE;
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : null; };
// 구 하나의 종류별 행: [동일성 키, x, a]. x = 매매 금액(만원)·전세 보증금(만원)·월세 환산(보증금+월세×12÷4.8%, 만원).
function rowsOf(items, code) {
  const out = { sale: [], jeonse: [], wolse: [] };
  for (const { item } of items.get(`sale:${code}`) ?? []) {
    if (!inSaleSample(item)) continue;
    out.sale.push([JSON.stringify(item), num(item.dealAmount), Number(item.excluUseAr)]);
  }
  for (const { item } of items.get(`rent:${code}`) ?? []) {
    if (isRenewalContract(item)) continue;
    const dep = num(item.deposit), m = num(item.monthlyRent), a = Number(item.excluUseAr);
    if (dep == null || dep <= 0 || !Number.isFinite(a) || a <= 0) continue;
    if (m && m > 0) out.wolse.push([JSON.stringify(item), dep + (m * 12) / RATE, a]);
    else out.jeonse.push([JSON.stringify(item), dep, a]);
  }
  return out;
}
// summarizeSale·summarizeRent 와 같은 반올림.
const val = (kind, sx, sa) => (sa > 0 ? (kind === "wolse" ? Math.round((sx / sa) * P) : Math.round(((sx * 10000) / sa) * P / 10000)) : null);
const recVal = (m, kind) => (kind === "sale" ? m?.avgPricePerPyeong10k : kind === "jeonse" ? m?.avgDepositPerPyeong10k : m?.avgConvertedPerPyeong10k);

const samples = new Map();
for (const rec of final) {
  const c = owner.get(rec.date); const w = rec.window; if (!c || !w) continue;
  const tree = treeOf(c);
  const read = async (kind, code, ym) => { const h = tree.get(`raw/${kind}/${code}-${ym}.json`); return h ? blob(h) : null; };
  const { items } = await readWindowItems(new Date(`${rec.date}T03:00:00Z`), { ...w, from: w.districtFrom ?? w.from }, read);
  const per = new Map(); for (const { code } of DISTRICTS) per.set(code, rowsOf(items, code));
  samples.set(rec.date, per);
}

let seed = Number(process.env.SEED ?? 862); const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const draw = (xs, as) => { let sx = 0, sa = 0; const n = xs.length; for (let i = 0; i < n; i++) { const j = Math.floor(rnd() * n); sx += xs[j]; sa += as[j]; } return [sx, sa]; };
const B = Number(process.argv[2] ?? 1000);
const MIN = CHANGE_MIN_COUNT.district;
const hist = [];
for (const rec of final) {
  const base = findBaseline(hist.slice(), new Date(`${rec.date}T03:00:00Z`));
  hist.push(rec);
  const mine = samples.get(rec.date); if (!mine) continue;
  for (const { code, name } of DISTRICTS) {
    const rd = (rec.districts ?? []).find((d) => d.code === code);
    const bd = (base?.districts ?? []).find((d) => d.code === code);
    for (const kind of ["sale", "jeonse", "wolse"]) {
      const cur = mine.get(code)[kind];
      const out = { date: rec.date, basis: rec.window.basis, base: base?.date ?? null, baseBasis: base?.window?.basis ?? null, code, name, kind,
        n: cur.length, recN: rd?.[kind]?.transactionCount ?? null, v: val(kind, cur.reduce((s, r) => s + r[1], 0), cur.reduce((s, r) => s + r[2], 0)), recV: recVal(rd?.[kind], kind) ?? null,
        recChg: rd?.[kind]?.change?.percent ?? null, recWithheld: Boolean(rd?.[kind]?.changeWithheld) };
      const bs = base && samples.get(base.date)?.get(code)?.[kind];
      if (bs) { out.bn = bs.length; out.bv = val(kind, bs.reduce((s, r) => s + r[1], 0), bs.reduce((s, r) => s + r[2], 0)); out.baseRecV = recVal(bd?.[kind], kind) ?? null; }
      out.inSample = rec.window.basis === "arrival" && Boolean(base?.window) && Boolean(bs) && cur.length >= MIN && bs.length >= MIN && out.bv != null;
      if (out.inSample) {
        out.chg = out.v / out.bv - 1;
        // 앞·겹침·뒤 나누기(같은 행이 여러 번이면 개수대로 짝짓는다)
        const left = new Map(); for (const r of bs) { const a = left.get(r[0]) ?? []; a.push(r); left.set(r[0], a); }
        const O = [], K = [];
        for (const r of cur) { const a = left.get(r[0]); if (a?.length) { a.pop(); O.push(r); } else K.push(r); }
        const F = []; for (const a of left.values()) F.push(...a);
        out.nF = F.length; out.nO = O.length; out.nK = K.length;
        const xs = (g) => Float64Array.from(g, (r) => r[1]), as = (g) => Float64Array.from(g, (r) => r[2]);
        const [Fx, Fa, Ox, Oa, Kx, Ka] = [xs(F), as(F), xs(O), as(O), xs(K), as(K)];
        const d = new Float64Array(B);
        for (let b = 0; b < B; b++) {
          const [fx, fa] = draw(Fx, Fa), [ox, oa] = draw(Ox, Oa), [kx, ka] = draw(Kx, Ka);
          d[b] = val(kind, ox + kx, oa + ka) / val(kind, fx + ox, fa + oa) - 1;
        }
        d.sort();
        out.lo = d[Math.floor(B * 0.05)]; out.hi = d[Math.floor(B * 0.95) - 1]; out.half = (out.hi - out.lo) / 2;
      }
      console.log(JSON.stringify(out));
    }
  }
}
