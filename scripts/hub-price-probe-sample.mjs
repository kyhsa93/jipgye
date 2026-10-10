// 임시 시험용(시험 후 삭제). 건축HUB 주택가격 시험의 표본 지번을 raw/sale에서 뽑는다 - 로컬에서 한 번 돌려 sample.json을 만든다.
// 사용: node scripts/hub-price-probe-sample.mjs <법정동코드 전체자료.txt(cp949)> <출력.json> [커밋=3a92151]
// 대상 지번 = 해당 커밋의 raw/sale(+raw/rent)에 한 번이라도 나온 서울 (시군구, 법정동, 지번). 지번 단위 값만 쓰고 호 단위 값은 없다.
// 표본: 매매 건수 3분위(소·중·대)로 나눠 구를 돌려 가며 결정적으로 뽑는다(해시 정렬).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [codeTxt, outFile, commit = "3a92151"] = process.argv.slice(2);
if (!codeTxt || !outFile) throw new Error("사용: hub-price-probe-sample.mjs <전체자료.txt> <출력.json> [커밋]");
const SIZE = 40;

const names = new Map(); // "서울특별시 종로구 청운동" -> 10자리
for (const line of new TextDecoder("euc-kr").decode(readFileSync(codeTxt)).split(/\r?\n/)) {
  const m = /^(11\d{8})\t([^\t]+)\t존재$/.exec(line);
  if (m) names.set(m[2], m[1]);
}
const dir = mkdtempSync(path.join(tmpdir(), "hub-sample-"));
execFileSync("sh", ["-c", `git archive ${commit} raw/sale raw/rent | tar -x -C ${dir}`], { stdio: "inherit" });

const SGG = new Map(readFileSync(new URL("./realestate-districts.mjs", import.meta.url), "utf8")
  .matchAll(/code: "(\d+)", name: "([^"]+)"/g).map((m) => [m[1], m[2]]));
const jib = new Map(); // key -> { sale: n, rent: n }
let unmapped = 0;
for (const kind of ["sale", "rent"]) {
  for (const f of readdirSync(path.join(dir, "raw", kind))) {
    const doc = JSON.parse(readFileSync(path.join(dir, "raw", kind, f), "utf8"));
    for (const it of doc.items ?? []) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(String(it.jibun));
      const code10 = names.get(`서울특별시 ${SGG.get(String(it.sggCd))} ${it.umdNm}`);
      if (!m || !code10) { unmapped += 1; continue; }
      const key = `${code10}|${m[1].padStart(4, "0")}|${(m[2] ?? "0").padStart(4, "0")}`;
      const e = jib.get(key) ?? { sale: 0, rent: 0 };
      e[kind] += 1;
      jib.set(key, e);
    }
  }
}
const all = [...jib].map(([key, v]) => ({ key, ...v }));
const saleJibun = all.filter((e) => e.sale > 0);
saleJibun.sort((a, b) => a.sale - b.sale || a.key.localeCompare(b.key));
const third = Math.floor(saleJibun.length / 3);
const strata = { 소: saleJibun.slice(0, third), 중: saleJibun.slice(third, 2 * third), 대: saleJibun.slice(2 * third) };
const h = (s) => createHash("sha256").update(s).digest("hex");
const picked = [];
const per = { 소: 13, 중: 13, 대: 14 };
for (const [name, list] of Object.entries(strata)) {
  const byGu = new Map();
  for (const e of [...list].sort((a, b) => h(a.key).localeCompare(h(b.key)))) {
    const gu = e.key.slice(0, 5);
    if (!byGu.has(gu)) byGu.set(gu, []);
    byGu.get(gu).push(e);
  }
  const guList = [...byGu.keys()].sort((a, b) => h(a).localeCompare(h(b)));
  let got = 0;
  for (let round = 0; got < per[name]; round += 1) {
    let any = false;
    for (const gu of guList) {
      const e = byGu.get(gu)[round];
      if (!e || got >= per[name]) continue;
      picked.push({ ...e, stratum: name });
      got += 1;
      any = true;
    }
    if (!any) break;
  }
}
const sample = picked.map((e) => {
  const [code10, bun, ji] = e.key.split("|");
  return { sigunguCd: code10.slice(0, 5), bjdongCd: code10.slice(5), bun, ji, stratum: e.stratum, saleDeals: e.sale };
});
const out = {
  meta: {
    commit, size: sample.length,
    targetJibunSale: saleJibun.length, targetJibunSaleOrRent: all.length, unmappedRows: unmapped,
    strataCuts: { 소: [strata.소[0]?.sale, strata.소.at(-1)?.sale], 중: [strata.중[0]?.sale, strata.중.at(-1)?.sale], 대: [strata.대[0]?.sale, strata.대.at(-1)?.sale] },
  },
  sample,
};
writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.meta));
