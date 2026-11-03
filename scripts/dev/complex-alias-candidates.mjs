#!/usr/bin/env node
// 저장 ID 별칭 후보 (#816 충돌 A). 같은 aptSeq 인데 저장 ID 가 둘 이상 남는 묶음과 각 ID 의 매매·전월세 줄 수를 찍는다. 수동 전용이고 호출 0회다.
// 매매가 둘 이상의 ID 에 있는 묶음을 사람이 보고 scripts/complex-id.ts 의 COMPLEX_ALIASES 에 옮긴다(추가 전용). 빌더는 이 값을 읽지 않는다 - ID 가 전월세 창에 기대게 되므로.
//   node scripts/dev/complex-alias-candidates.mjs [raw 폴더]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { aliasCandidates, locationKey, stableId } from "../complex-id.ts";

const raw = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../../raw"));
const rowsOf = (kind) => readdirSync(path.join(raw, kind)).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(path.join(raw, kind, f), "utf8")).items ?? []);
const countById = (rows) => {
  const out = new Map();
  for (const row of rows) {
    const id = stableId(locationKey(row));
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
};

const rents = rowsOf("rent");
const [sale, rent] = [countById(rowsOf("sale")), countById(rents)];
for (const { seq, ids } of aliasCandidates(rents)) {
  const both = ids.filter((id) => sale.get(id)).length > 1;
  console.log(`${both ? "옮길 것" : "매매 한쪽뿐"}  ${seq}  ${ids.map((id) => `${id} (매매 ${sale.get(id) ?? 0}, 전월세 ${rent.get(id) ?? 0})`).join("  +  ")}`);
}
