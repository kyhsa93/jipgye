// 표본 등급 계산 시험(#816). 합성 입력만 쓴다. 실제 원본·검증 구간을 읽지 않는다.
//   node --test research/sample-grade-2026-11/grade.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MIN_TARGETS, assignCells, dealOf, gradeOf, quantile, stats, targetsOf, verdict } from "./grade.mjs";

const SCRIPT = path.join(import.meta.dirname, "grade.mjs");

const item = (over = {}) => ({
  sggCd: "11680",
  umdNm: "역삼동",
  jibun: "1",
  aptNm: "가",
  excluUseAr: "84.5",
  dealAmount: "100,000",
  dealYear: 2026,
  dealMonth: 9,
  dealDay: 15,
  ...over,
});
const dealsOf = (...items) => assignCells(items.map((i) => dealOf(i)));

test("등급 경계: n=5·90일은 충분, n=4나 91일은 일부 부족, n=2는 근거 부족", () => {
  assert.equal(gradeOf({ n: 5, age: 90 }), "충분");
  assert.equal(gradeOf({ n: 5, age: 91 }), "일부 부족");
  assert.equal(gradeOf({ n: 4, age: 1 }), "일부 부족");
  assert.equal(gradeOf({ n: 3, age: 150 }), "일부 부족");
  assert.equal(gradeOf({ n: 2, age: 1 }), "근거 부족");
});

test("판정: 충분이 크면 새 버전, 같으면 유지, 대상이 모자라면 판정 불가", () => {
  const big = MIN_TARGETS;
  assert.equal(verdict({ n: big, p80: 7.0001 }, { n: big, p80: 7 }), "새 버전");
  assert.equal(verdict({ n: big, p80: 7 }, { n: big, p80: 7 }), "유지");
  assert.equal(verdict({ n: big, p80: 6 }, { n: big, p80: 7 }), "유지");
  assert.equal(verdict({ n: big - 1, p80: 9 }, { n: big, p80: 7 }), "판정 불가");
  assert.equal(verdict({ n: big, p80: 9 }, { n: big - 1, p80: 7 }), "판정 불가");
});

test("해제·직거래는 거래가 아니다", () => {
  assert.equal(dealOf(item({ cdealType: "O" })), null);
  assert.equal(dealOf(item({ dealingGbn: "직거래" })), null);
  assert.ok(dealOf(item({ dealingGbn: "중개거래" })));
});

test("칸: 지번이 다르면 다른 칸, 1㎡ 안이면 최다 면적 이름으로 묶는다", () => {
  const [a, b, c, d] = dealsOf(
    item({ excluUseAr: "84.1" }),
    item({ excluUseAr: "84.9" }),
    item({ excluUseAr: "84.9" }),
    item({ jibun: "2", excluUseAr: "84.9" }),
  );
  assert.equal(a.cell, b.cell);
  assert.ok(a.cell.endsWith("#84.9"));
  assert.equal(b.cell, c.cell);
  assert.notEqual(c.cell, d.cell);
});

test("앞 거래: 같은 날은 빼고 183일째는 넣으며, 앞 거래를 대상 달 지수로 고친다", () => {
  const deals = dealsOf(
    item({ dealYear: 2026, dealMonth: 3, dealDay: 16, dealAmount: "90,000" }), // 2026-09-15 − 183일
    item({ dealYear: 2026, dealMonth: 3, dealDay: 15, dealAmount: "1,000" }), // 184일, 창 밖
    item({ dealMonth: 9, dealDay: 15, dealAmount: "1,000" }), // 대상과 같은 날
    item({ dealMonth: 9, dealDay: 15, dealAmount: "100,000" }),
  );
  const index = { 230: new Map([["202603", 100], ["202609", 110]]) };
  const { rows, unadjusted } = targetsOf(deals, index, ["202609"]);
  assert.equal(rows.length, 2);
  assert.equal(unadjusted, 0);
  for (const row of rows) {
    assert.equal(row.n, 1);
    assert.equal(row.age, 183);
  }
  const hit = rows.find((r) => r.abs < 2);
  assert.ok(Math.abs(hit.signed - Math.log(100000 / 99000) * 100) < 1e-9);
});

test("P80은 선형 보간이고 빈 묶음은 NaN이다", () => {
  assert.equal(quantile(Float64Array.from([0, 10]), 0.8), 8);
  assert.ok(Number.isNaN(stats([]).p80));
});

function tree({ indexEnd, slots }) {
  const root = mkdtempSync(path.join(tmpdir(), "grade-"));
  mkdirSync(path.join(root, "raw/sale"), { recursive: true });
  mkdirSync(path.join(root, "raw/ecos"), { recursive: true });
  for (const slot of slots) {
    const [y, m] = [Number(slot.slice(0, 4)), Number(slot.slice(4))];
    const items = Array.from({ length: 12 }, (_, i) => item({ dealYear: y, dealMonth: m, dealDay: i + 1, dealAmount: String(100000 + i) }));
    writeFileSync(path.join(root, `raw/sale/11680-${slot}.json`), JSON.stringify({ items }));
  }
  const months = ["202606", "202607", "202608", "202609", "202610", "202611", "202612"].filter((m) => m <= indexEnd);
  const series = Object.fromEntries(["210", "220", "230", "240", "250"].map((c) => [c, months.map((m) => [m, 100])]));
  writeFileSync(path.join(root, "raw/ecos/apt-price-index.json"), JSON.stringify({ series }));
  return root;
}
const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, "judge", "--root", root, "--prereg", "a".repeat(40), ...args], { encoding: "utf8" });

test("judge: 지수가 구간 끝까지 없으면 호출 전에 멈춘다", () => {
  const out = run(tree({ indexEnd: "202610", slots: ["202610", "202611", "202612", "202701"] }));
  assert.equal(out.status, 1);
  assert.match(out.stderr, /지수에 202611 이 없다/);
});

test("judge: 구간 끝 슬롯이 얼기 전이면 멈춘다", () => {
  const out = run(tree({ indexEnd: "202611", slots: ["202610", "202611", "202612"] }));
  assert.equal(out.status, 1);
  assert.match(out.stderr, /얼지 않았다/);
});

test("judge: 커밋 40자리가 없으면 멈춘다", () => {
  const root = tree({ indexEnd: "202611", slots: ["202611", "202701"] });
  const out = spawnSync(process.execPath, [SCRIPT, "judge", "--root", root], { encoding: "utf8" });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /40자리/);
});

test("judge: 합성 트리에서 끝까지 돌고 대상이 모자라면 판정 불가라고 적는다", () => {
  const out = run(tree({ indexEnd: "202611", slots: ["202608", "202609", "202610", "202611", "202701"] }));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /판정: 판정 불가/);
});

test("seen: 고정 입력이 아니면 멈춘다", () => {
  const root = tree({ indexEnd: "202611", slots: ["202611"] });
  const out = spawnSync(process.execPath, [SCRIPT, "seen", "--root", root], { encoding: "utf8" });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /고정값과 다르다/);
});
