import test from "node:test";
import assert from "node:assert/strict";
import { mergeSmallCells, OTHER_KEY, MIN_PROJECTS } from "../scripts/housing-permits-merge.mjs";
import { SERIES } from "../scripts/housing-permits-spec.mjs";
import { flawedMergeMonth } from "./helpers/housing-permits-mutants.mjs";

// n<3 합침 (#133, PREREG 5절 "n<3 합침"). 전부 합성 입력이다.

const A = "11110"; const B = "11140"; const C = "11170";
const cell = (projects, units) => ({ projects, units });

/** 접기 결과 모양의 입력. permit 계열만 채우고 나머지는 비운다. */
function folded(permit, unknown = {}) {
  const series = Object.fromEntries(SERIES.map((s) => [s, {}]));
  const unk = Object.fromEntries(SERIES.map((s) => [s, {}]));
  for (const [month, cells] of Object.entries(permit)) {
    for (const [gu, c] of Object.entries(cells)) (series.permit[gu] ??= {})[month] = c;
  }
  unk.permit = unknown;
  return { meta: { input: 0, projects: 0, duplicates: 0, cancellation: "관측 불가" }, series, unknown: unk };
}

const INPUT = {
  "2024-01": { [A]: cell(5, 50), [B]: cell(1, 10), [C]: cell(2, 20) }, // 작은 구 둘: 합쳐 n=3
  "2024-02": { [A]: cell(10, 100), [B]: cell(1, 5) }, // 작은 구 하나: 가장 적은 공개 구를 더 합친다
  "2024-03": { [A]: cell(3, 30), [B]: cell(4, 40), [C]: cell(1, 7) }, // 더 합칠 구는 A(사업 수 최소)
  "2024-04": { [A]: cell(1, 8), [B]: cell(1, 9) }, // 다 합쳐도 n=2: 내지 않는다
  "2024-05": { [A]: cell(3, 30), [B]: cell(3, 31) }, // 모두 3 이상: 그대로
};

/** 합침 정의 검사. 진짜는 통과하고 낙제 사본은 던져야 한다. mergeMonth: (한 달 칸들) -> 한 달 칸들. */
function checkMergeMonth(mergeMonth) {
  const out = mergeMonth(INPUT["2024-01"]);
  assert.deepEqual(out, { [A]: cell(5, 50), [OTHER_KEY]: cell(3, 30) }, "n<3 둘은 기타 구 한 칸으로");
  const single = mergeMonth(INPUT["2024-02"]);
  assert.deepEqual(single, { [OTHER_KEY]: cell(11, 105) }, "작은 구가 하나면 가장 적은 공개 구를 더 합친다(역산 방지)");
  assert.deepEqual(mergeMonth(INPUT["2024-03"]), { [B]: cell(4, 40), [OTHER_KEY]: cell(4, 37) });
  assert.deepEqual(mergeMonth(INPUT["2024-04"]), {}, "합쳐도 n<3이면 내지 않는다");
  assert.deepEqual(mergeMonth(INPUT["2024-05"]), INPUT["2024-05"]);
}

/** 진짜 병합을 한 달짜리 입력으로 돌려 같은 검사에 건다. */
const realMonth = (cells) => {
  const out = mergeSmallCells(folded({ "2024-01": cells }));
  const month = {};
  for (const [gu, months] of Object.entries(out.series.permit)) month[gu] = months["2024-01"];
  return month;
};

test("합침: 정의대로 한 칸씩 돈다(진짜 구현)", () => checkMergeMonth(realMonth));

test("합침: MIN_PROJECTS는 3이다(소유자 조건 2)", () => assert.equal(MIN_PROJECTS, 3));

test("낙제 시험 ④: 합치지 않는 사본은 빨강이다", () => {
  assert.throws(() => checkMergeMonth((c) => flawedMergeMonth(c, { merge: false })));
});

test("낙제 시험 ⑤: 작은 구 하나만 기타 구로 보내는 사본은 빨강이다(서울 합계로 역산된다)", () => {
  assert.throws(() => checkMergeMonth((c) => flawedMergeMonth(c, { guard: false })));
});

test("합침: 여러 달 전체 - 어느 칸도 n<3이 없고, 호수 합은 내지 않은 칸만큼만 준다", () => {
  const out = mergeSmallCells(folded(INPUT));
  let units = 0;
  for (const months of Object.values(out.series.permit)) {
    for (const c of Object.values(months)) { assert.ok(c.projects >= MIN_PROJECTS); units += c.units; }
  }
  const input = Object.values(INPUT).flatMap((m) => Object.values(m)).reduce((s, c) => s + c.units, 0);
  assert.equal(units, input - (8 + 9), "2024-04의 두 칸만 빠진다");
  assert.equal(out.series.permit[A]?.["2024-04"], undefined);
  assert.equal(out.series.permit[OTHER_KEY]?.["2024-04"], undefined);
  assert.equal(out.meta.merge.suppressedCells, 1);
  assert.equal(out.meta.merge.minProjects, 3);
});

test("합침: 미상 칸에도 같은 규칙을 쓴다", () => {
  const out = mergeSmallCells(folded({}, { [A]: cell(1, 5), [B]: cell(1, 6), [C]: cell(2, 9) }));
  assert.deepEqual(out.unknown.permit, { [OTHER_KEY]: cell(4, 20) });
  const single = mergeSmallCells(folded({}, { [A]: cell(8, 80), [B]: cell(1, 6) }));
  assert.deepEqual(single.unknown.permit, { [OTHER_KEY]: cell(9, 86) });
});

test("합침: 입력을 바꾸지 않고, 입력 순서가 달라도 같은 결과를 낸다", () => {
  const input = folded(INPUT);
  const before = JSON.stringify(input);
  const a = mergeSmallCells(input);
  assert.equal(JSON.stringify(input), before);
  const shuffled = folded(Object.fromEntries(Object.entries(INPUT).reverse().map(([m, c]) => [m, Object.fromEntries(Object.entries(c).reverse())])));
  assert.equal(JSON.stringify(mergeSmallCells(shuffled)), JSON.stringify(a));
});

test("합침: 취소 계열은 만들지 않는다 - 취소를 관측할 수 없어 cancelledPermit이 출력에 없다 (PREREG 「취소 판정」)", () => {
  const out = mergeSmallCells(folded(INPUT));
  assert.ok(!("cancelledPermit" in out));
  assert.equal(out.meta.cancellation, "관측 불가");
});
