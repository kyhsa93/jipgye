// 판정문에 함께 적는 값(PREREG v2 7·8절). 입력 커밋의 COMPLEX_ALIASES 로 칸을 합쳤을 때의 P80 차이를 합치지 않은 값과 나란히 찍는다. 판정은 grade.mjs judge 가 하고 이 값을 쓰지 않는다.
//
//   git archive <PREREG 4절 입력 커밋> raw/sale raw/ecos scripts | tar -x -C <트리>
//   node research/sample-grade-2026-11/alias-judge.mjs --root <트리> [--window 202609,202610,202611]
//
// 호출 0회. 원본만 읽고 저장소에 쓰지 않는다.
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { assignCells, gradeOf, loadDeals, loadIndex, stats, targetsOf, VALIDATION_WINDOW } from "./grade.mjs";

const { values: v } = parseArgs({ options: { root: { type: "string" }, window: { type: "string" } } });
const root = v.root && path.resolve(v.root);
const table = path.join(root ?? "", "scripts/complex-id.ts");
if (!root || !existsSync(table)) {
  console.error("--root 에 raw/sale·raw/ecos·scripts/complex-id.ts 가 있는 트리를 준다.");
  process.exit(2);
}
const { COMPLEX_ALIASES } = await import(table);
const window = v.window ? v.window.split(",") : VALIDATION_WINDOW;
const index = loadIndex(root);
const end = window.at(-1);
for (const series of Object.values(index)) {
  if (!series.has(end)) {
    console.error(`지수에 ${end} 이 없다. 값 없는 보정을 1로 메우지 않는다(PREREG 4절).`);
    process.exit(1);
  }
}

function gapOf(deals) {
  const { rows } = targetsOf(deals, index, window);
  const [a, b] = [stats(rows.filter((r) => gradeOf(r) === "충분")), stats(rows.filter((r) => gradeOf(r) === "일부 부족"))];
  return { a, b, gap: a.p80 - b.p80 };
}
const show = (name, { a, b, gap }) =>
  console.log(`${name}  충분 대상 ${a.n} P80 ${a.p80.toFixed(4)}  일부 부족 대상 ${b.n} P80 ${b.p80.toFixed(4)}  P80 차이 ${gap.toFixed(6)}`);

const plain = gapOf(loadDeals(root));
const merged = gapOf(assignCells(loadDeals(root).map((d) => ({ ...d, key: COMPLEX_ALIASES[d.key] ?? d.key }))));
console.log(`별칭 ${Object.keys(COMPLEX_ALIASES).length}줄, 계약 ${window[0]}~${end} (판정에 쓰지 않는다)`);
show("합치지 않음", plain);
show("별칭 합침", merged);
const sign = Number.isNaN(plain.gap) || Number.isNaN(merged.gap) ? "계산 못 함" : Math.sign(plain.gap) === Math.sign(merged.gap) ? "같다" : "다르다. 판정은 그대로 두고 별칭 효과로 뒤집히는 결과라고 적는다";
console.log(`부호: ${sign}`);
