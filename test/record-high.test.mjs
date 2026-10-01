import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MIN_RECORDS, byCell, grid, holds, leadSentence, measure, toDeal } from "../scripts/record-high.mjs";

const root = path.resolve(import.meta.dirname, "..");
const DAY = 86400000;
const t0 = Date.UTC(2025, 0, 1);

const deal = (cell, day, amount, floor = 5) => ({ cell, time: t0 + day * DAY, amount, floor });

/** 선행 3건(0·100·200일, 값 100) 뒤 300일에 신고가(record), 그다음 next. */
function cellWithRecord(name, record, next, { nextDay = 310, nextFloor = 5, recordFloor = 5 } = {}) {
  const list = [deal(name, 0, 100), deal(name, 100, 100), deal(name, 200, 100), deal(name, 300, record, recordFloor)];
  if (next !== null) list.push(deal(name, nextDay, next, nextFloor));
  return list;
}

const END = t0 + 1000 * DAY;

test("해제된 거래와 직거래는 세지 않는다", () => {
  const item = { sggCd: 1, aptNm: "가", excluUseAr: 84, dealAmount: "10,000", dealYear: 2026, dealMonth: 1, dealDay: 2, dealingGbn: "중개거래" };
  assert.ok(toDeal(item));
  assert.equal(toDeal({ ...item, cdealType: "O" }), null);
  assert.equal(toDeal({ ...item, dealingGbn: "직거래" }), null);
});

test("다음 거래가 없는 신고가도 빼지 않고 센다 — 생존 편향", () => {
  const cells = byCell([...cellWithRecord("a", 120, 110), ...cellWithRecord("b", 120, null)]);
  const m = measure(cells, END);
  assert.equal(m.records, 2);
  assert.equal(m.withNext, 1);
  assert.equal(m.none, 50, "다음 거래가 없는 신고가를 버렸다");
});

test("기다린 날을 다 채우지 못한 최근 거래는 세지 않는다", () => {
  const cells = byCell(cellWithRecord("a", 120, null));
  assert.equal(measure(cells, t0 + 330 * DAY).records, 0, "아직 90일이 안 지난 신고가를 '다음 거래 없음'으로 셌다");
});

test("90일 뒤의 거래는 '다음 거래'가 아니다", () => {
  const cells = byCell(cellWithRecord("a", 120, 110, { nextDay: 300 + 91 }));
  const m = measure(cells, END);
  assert.equal(m.withNext, 0);
  assert.equal(m.records, 1);
});

test("같은 날 거래는 선행으로도 다음으로도 치지 않는다", () => {
  const list = [...cellWithRecord("a", 120, null), deal("a", 300, 90)];
  const m = measure(byCell(list), END);
  assert.equal(m.withNext, 0, "같은 날 거래를 다음 거래로 셌다");
});

test("같은 날 두 거래는 서로의 '그 전 최고가'가 되지 않는다", () => {
  // 원본은 같은 날 두 건 중 어느 것이 먼저인지 모른다. 목록 순서로 앞의 것을 선행으로 치면
  // 같은 날 125와 120 중 120은 신고가에서 빠지는데, 그 순서는 우연이다.
  const list = [deal("a", 0, 100), deal("a", 100, 100), deal("a", 200, 100), deal("a", 300, 125), deal("a", 300, 120)];
  assert.equal(measure(byCell(list), END).records, 2);
});

test("층을 맞춘 비교는 다음 거래가 같거나 높은 층일 때만 센다", () => {
  const cells = byCell([
    ...cellWithRecord("a", 120, 110, { nextFloor: 2, recordFloor: 10 }),
    ...cellWithRecord("b", 120, 125, { nextFloor: 12, recordFloor: 10 }),
  ]);
  const m = measure(cells, END);
  assert.equal(m.record, 50);
  assert.equal(m.recordSameFloor, 100);
});

/** 신고가 n건을 만든다. 다음 거래가 신고가 이상인 비율 recordUp, 그 전 최고가를 넘는 비율 aboveOld. */
function population({ n = MIN_RECORDS + 20, recordUp, aboveOld = 0.6, otherUp = 0.6 }) {
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const up = i < n * recordUp;
    const next = up ? 125 : i < n * (recordUp + (1 - recordUp) * aboveOld) ? 110 : 95;
    list.push(...cellWithRecord(`r${i}`, 120, next));
    // 신고가가 아닌 거래 뒤의 다음 거래(아무 거래 대조군을 채운다)
    const base = [deal(`o${i}`, 0, 100), deal(`o${i}`, 100, 100), deal(`o${i}`, 200, 100), deal(`o${i}`, 300, 99)];
    base.push(deal(`o${i}`, 310, i < n * otherUp ? 105 : 95));
    list.push(...base);
  }
  return byCell(list);
}

test("신고가 뒤가 아무 거래 뒤보다 낮을 때만 '따라가지 않았다'고 쓴다", () => {
  const cells = population({ recordUp: 0.3 });
  const main = measure(cells, END);
  assert.ok(holds(main));
  const robust = grid(cells, END);
  assert.match(leadSentence(main, robust, "ko"), /곧 새 시세는 아니었습니다/);
});

test("결론이 뒤집히면 문장도 바뀐다 — 문장을 고정하지 않는다", () => {
  const cells = population({ recordUp: 0.9 });
  const main = measure(cells, END);
  assert.equal(holds(main), false);
  const lead = leadSentence(main, grid(cells, END), "ko");
  assert.doesNotMatch(lead, /곧 새 시세는 아니었습니다/);
  assert.match(lead, /말하지 않습니다/);
});

test("문턱 조합 하나라도 깨지면 첫 문장을 쓰지 않는다", () => {
  const cells = population({ recordUp: 0.3 });
  const main = measure(cells, END);
  const robust = grid(cells, END).map((r, i) => (i === 0 ? { ...r, counted: true, holds: false } : r));
  assert.doesNotMatch(leadSentence(main, robust, "ko"), /곧 새 시세는 아니었습니다/);
});

test("표본이 모자라면 아무 말도 하지 않는다", () => {
  const cells = population({ n: 10, recordUp: 0.1 });
  const main = measure(cells, END);
  assert.match(leadSentence(main, grid(cells, END), "ko"), /아직 적어/);
});

test("정적 HTML이 오늘 데이터의 문장과 표를 싣는다", async () => {
  const [html, data] = await Promise.all([
    readFile(path.join(root, "docs/record-high.html"), "utf8"),
    readFile(path.join(root, "docs/data/record-high.json"), "utf8").then(JSON.parse),
  ]);
  const block = (name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1];
  assert.equal(block("recordRobust"), data.tables.robust.ko);
  assert.ok(block("recordLead")?.includes(String(data.main.record)), "첫 문장이 오늘 숫자를 싣지 않는다");
  assert.ok(data.lead.en && data.tables.robust.en);
});
