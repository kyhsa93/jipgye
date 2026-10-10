// 임시 시험용(시험 후 삭제). 2차 시험의 표본 확장과 매칭 대조용 매매 표본을 만든다 - 로컬에서 한 번 돌린다.
// 사용: node scripts/hub-price-probe-sample2.mjs [커밋=3a92151]
// - research/hub-price-probe/sample.json의 40지번(1차)을 앞에 두고, 같은 (시군구, 법정동)에서 40지번을 더 뽑아 80으로 만든다(법정동코드 전체자료가 없어 새 법정동은 못 붙인다).
// - 지번별 매매(raw/sale, 취소 제외)의 (전용면적, 층) 목록을 sale-sample.json에 둔다. 아파트 매매 신고 값이고 호 단위 공시가격 값은 없다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const commit = process.argv[2] ?? "3a92151";
const base = JSON.parse(readFileSync(new URL("../research/hub-price-probe/sample.json", import.meta.url), "utf8"));
const dir = mkdtempSync(path.join(tmpdir(), "hub-sample2-"));
execFileSync("sh", ["-c", `git archive ${commit} raw/sale | tar -x -C ${dir}`], { stdio: "inherit" });

const jkey = (it) => { const m = /^(\d+)(?:-(\d+))?$/.exec(String(it.jibun)); return m ? `${it.sggCd}|${it.umdNm}|${m[1].padStart(4, "0")}|${(m[2] ?? "0").padStart(4, "0")}` : null; };
const rows = new Map(); // sgg|umd|bun|ji -> [[area, floor]]
for (const f of readdirSync(path.join(dir, "raw", "sale"))) {
  const doc = JSON.parse(readFileSync(path.join(dir, "raw", "sale", f), "utf8"));
  for (const it of doc.items ?? []) {
    const k = jkey(it); if (!k) continue;
    if (it.cdealType || it.cdealDay) continue; // 해제 제외
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push([Number(it.excluUseAr), Number(it.floor)]);
  }
}
// 1차 표본의 법정동 이름 복원: (시군구, 번, 지)로 판 이름이 하나뿐이다(검증됨).
const byShort = new Map();
for (const k of rows.keys()) { const [g, u, b, j] = k.split("|"); const s = `${g}|${b}|${j}`; if (!byShort.has(s)) byShort.set(s, []); byShort.get(s).push(u); }
const dongOf = new Map(); // sgg|umd -> bjdongCd
const first = base.sample.map((s) => {
  const us = [...new Set(byShort.get(`${s.sigunguCd}|${s.bun}|${s.ji}`) ?? [])];
  if (us.length !== 1) throw new Error("법정동 이름이 하나로 정해지지 않는 표본이 있다");
  dongOf.set(`${s.sigunguCd}|${us[0]}`, s.bjdongCd);
  return { ...s, rk: `${s.sigunguCd}|${us[0]}|${s.bun}|${s.ji}` };
});
const cuts = base.meta.strataCuts; // 소 ≤3, 중 3~14, 대 14~
const stratumOf = (n) => (n <= cuts.소[1] ? "소" : n <= cuts.중[1] ? "중" : "대");
const h = (s) => createHash("sha256").update(s).digest("hex");
const have = new Set(first.map((s) => s.rk));
const per = { 소: 13, 중: 13, 대: 14 };
const extra = [];
for (const st of ["소", "중", "대"]) {
  const cand = [...rows].filter(([k, v]) => dongOf.has(k.split("|").slice(0, 2).join("|")) && !have.has(k) && stratumOf(v.length) === st).map(([k]) => k).sort((a, b) => h(a).localeCompare(h(b)));
  for (const k of cand.slice(0, per[st])) {
    const [g, u, b, j] = k.split("|");
    extra.push({ sigunguCd: g, bjdongCd: dongOf.get(`${g}|${u}`), bun: b, ji: j, stratum: st, saleDeals: rows.get(k).length, rk: k });
  }
}
const all = [...first, ...extra];
const sample = all.map(({ rk, ...s }) => s);
const sale = {};
for (const s of all) sale[`${s.sigunguCd}${s.bjdongCd}|${s.bun}|${s.ji}`] = rows.get(s.rk);
writeFileSync(new URL("../research/hub-price-probe/sample2.json", import.meta.url), `${JSON.stringify({ meta: { ...base.meta, size: sample.length, extra: extra.length }, sample })}\n`);
writeFileSync(new URL("../research/hub-price-probe/sale-sample.json", import.meta.url), `${JSON.stringify({ commit, sale })}\n`);
console.log(JSON.stringify({ size: sample.length, extra: extra.length, saleRows: Object.values(sale).reduce((a, v) => a + v.length, 0) }));
