// #937 (F2) - 갈아타기(district-change)·가격대 변화(segment-change)가 재수집 덧씌움을 합친 원본(readAll().recollected)을 읽는다.
// 빌더가 그 목록을 넘기는지(연결 글자)는 recollect-sale 「소비자」 시험의 연결 블록이 본다 - 같은 단언을 여기 두지 않는다.
// 여기서는 계산 쪽 약속 둘을 본다: (i) 덧씌움이 없으면 두 출력이 지금(items)과 바이트까지 같다(#908 씨앗 규칙 그대로),
// (ii) 덧씌움이 있으면 출력이 달라지고, 그 값은 같은 덧씌움을 손으로 합친 행으로 만든 출력과 같다.
// 입력은 전부 손으로 만든 슬롯·덧씌움이고 시각은 고정이다(#8). 저장소의 docs/data·raw 는 읽지 않고 네트워크도 쓰지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saleItem } from "./helpers/fake-molit.mjs";
import { buildSlotFile, writeSlotFile } from "../scripts/realestate-raw.ts";
import { buildOverlay, writeOverlay } from "../scripts/realestate-recollect.ts";
import { buildPayload, readAll } from "../scripts/build-district-change.ts";
import { buildSegmentPayload } from "../scripts/segment-change.ts";
import { MIN_CELLS } from "../scripts/district-change.ts";

// 신고 기한이 닫힌 마지막 달은 202608 - 두 시기는 기준 202508~10, 최근 202606~08(1년 전 석 달이 다 있다).
const NOW = new Date("2026-10-01T00:00:00Z");
const OBSERVED = "2026-10-01T01:00:00.000Z";
const RECOLLECTED = "2026-11-15T11:36:00.000Z";
const JONGNO = "11110";
const JUNG = "11140";
const MONTHS = ["202508", "202509", "202510", "202606", "202607", "202608"];
const CELLS = MIN_CELLS + 4;
// 금액 구간(moneyPairs)은 이 시험의 단언과 무관하다 - 재추출을 줄여 부른다(buildPayload 머리 주석, #858). 빌드는 늘 MONEY_ROUNDS 다.
const MONEY_ROUNDS_TEST = 200;

// 구마다 칸(단지 × 전용면적) CELLS 개, 칸마다 여섯 달에 한 줄씩. 종로구는 +10% 안팎, 중구는 +2% 안팎이라 두 구의 구간이 갈린다.
// 기준 금액은 전부 6억 이하라 가격대 upTo6 칸이 2×CELLS 개, 준공 2005년이라 연식 10~29년 칸도 2×CELLS 개다 - 두 출력 모두 값이 null 이 아니다.
function rowsOf(code, yearMonth) {
  const rise = code === JONGNO ? 0.1 : 0.02;
  const recent = yearMonth >= "202606";
  return Array.from({ length: CELLS }, (_, i) => {
    const base = (code === JONGNO ? 40_000 : 45_000) + i * 400;
    const amount = Math.round(recent ? base * (1 + rise + (i % 5) * 0.002) : base);
    return saleItem({
      sggCd: Number(code), aptNm: `${code}단지${String(i).padStart(2, "0")}`, excluUseAr: i % 2 ? 59.97 : 84.97, dealAmount: amount.toLocaleString("en-US"),
      dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)), dealDay: 1 + (i % 28), floor: i + 1,
    });
  });
}

/** 두 구 × 여섯 달 슬롯을 쓴 raw 폴더와, 슬롯 이름 순(readAll 이 읽는 순서)의 저장 행. */
async function fixtureRaw() {
  const dir = await mkdtemp(path.join(tmpdir(), "recollect-switch-"));
  const raw = path.join(dir, "raw");
  const slots = new Map();
  for (const code of [JONGNO, JUNG]) {
    for (const yearMonth of MONTHS) {
      const slot = buildSlotFile({ kind: "sale", code, yearMonth, items: rowsOf(code, yearMonth), observedAt: OBSERVED });
      await writeSlotFile(slot, raw);
      slots.set(`${code}-${yearMonth}`, slot);
    }
  }
  return { raw, slots };
}

// 덧씌울 슬롯: 종로구 최근 시기 두 달. 칸마다 최근 석 달 가운데 두 달 값이 15% 내려가 중앙값이 바뀐다(한 달만이면 중앙값이 그대로다).
// 한 줄은 해제가 붙어(cdealType) 계산에서 빠진다.
const RECOLLECT = ["202607", "202608"];
function fetchedOf(slot) {
  const items = slot.items.map((item, i) =>
    i === 0 ? { ...item, cdealType: "O", cdealDay: "26.11.10" } : { ...item, dealAmount: Math.round(Number(String(item.dealAmount).replace(/,/g, "")) * 0.85).toLocaleString("en-US") }
  );
  return buildSlotFile({ kind: "sale", code: slot.district, yearMonth: slot.yearMonth, items, observedAt: RECOLLECTED }).items;
}

const run = (items) => ({
  change: JSON.stringify(buildPayload({ items, now: NOW, official: null, survey: null, sameNames: {}, moneyRounds: MONEY_ROUNDS_TEST })),
  segment: JSON.stringify(buildSegmentPayload({ items, now: NOW, sameNames: {} })),
});

function assertNotIdle({ change, segment }) {
  const d = JSON.parse(change);
  const s = JSON.parse(segment);
  const row = (code) => d.rows.find((r) => r.code === code);
  assert.notEqual(row(JONGNO).change, null, "종로구 줄이 값을 내야 대조가 헛돌지 않는다");
  assert.notEqual(row(JUNG).change, null, "중구 줄이 값을 내야 대조가 헛돌지 않는다");
  assert.equal(typeof d.pairs[`${JONGNO}-${JUNG}`], "boolean", "종로구·중구 쌍 판정이 있다");
  assert.notEqual(s.price.find((r) => r.key === "upTo6").change, null, "가격대 upTo6 구간이 값을 낸다");
  assert.notEqual(s.age.find((r) => r.key === "y10to29").change, null, "연식 10~29년 구간이 값을 낸다");
}

test("(i) 덧씌움이 없으면 readAll 의 recollected 로 만든 갈아타기·가격대 변화 JSON 이 items 로 만든 것과 바이트까지 같다", async () => {
  const { raw } = await fixtureRaw();
  const { items, recollected } = await readAll(raw);
  assert.equal(items.length, 2 * MONTHS.length * CELLS);
  const stored = run(items);
  const merged = run(recollected);
  assertNotIdle(stored);
  assert.equal(merged.change, stored.change);
  assert.equal(merged.segment, stored.segment);
});

test("(ii) 덧씌움이 있으면 출력이 달라지고, recollected 쪽은 같은 덧씌움을 손으로 합친 행으로 만든 출력과 같다", async () => {
  const { raw, slots } = await fixtureRaw();
  const fetched = new Map();
  for (const yearMonth of RECOLLECT) {
    const slot = slots.get(`${JONGNO}-${yearMonth}`);
    const items = fetchedOf(slot);
    const overlay = buildOverlay({ slot, items, totalCount: items.length, observedAt: RECOLLECTED });
    // 금액이 바뀐 줄은 계약 키가 달라 gone + appeared 로, 해제가 붙은 줄은 changed 로 잡힌다 - 세 갈래가 다 지나간다.
    assert.deepEqual([overlay.changed.length, overlay.appeared.length, overlay.gone.length], [1, CELLS - 1, CELLS - 1], "픽스처: 덧씌움 세 갈래");
    assert.equal(await writeOverlay(JONGNO, yearMonth, overlay, raw), true);
    fetched.set(`${JONGNO}-${yearMonth}`, items);
  }
  const { items, recollected } = await readAll(raw);
  // 손으로 합친 행: 슬롯 이름 순으로, 덧씌운 슬롯은 다시 받은 행(정규화·정렬 뒤), 나머지는 저장 행.
  const byHand = [...slots.keys()].sort().flatMap((key) => fetched.get(key) ?? slots.get(key).items);
  assert.deepEqual(recollected, byHand, "readAll 의 합친 목록이 손으로 합친 행과 같다");

  const stored = run(items);
  const merged = run(recollected);
  assertNotIdle(stored);
  assertNotIdle(merged);
  assert.notEqual(merged.change, stored.change, "덧씌움이 갈아타기에 닿지 않았다");
  assert.notEqual(merged.segment, stored.segment, "덧씌움이 가격대 변화에 닿지 않았다");
  const rowOf = (out) => JSON.parse(out.change).rows.find((r) => r.code === JONGNO).change;
  assert.ok(rowOf(merged) < rowOf(stored), `종로구 변화가 내려가야 한다: ${rowOf(stored)} → ${rowOf(merged)}`);
  const hand = run(byHand);
  assert.equal(merged.change, hand.change);
  assert.equal(merged.segment, hand.segment);
});
