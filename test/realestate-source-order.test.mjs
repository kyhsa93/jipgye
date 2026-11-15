// #572: realestate-source collect() 는 읽기를 동시에 하되 합치는 순서를 완료 순서가 아닌 months -> DISTRICTS 인덱스 순으로 둔다.
// 읽기 함수를 갈아 끼워 슬롯마다 끝나는 순서를 바꿔 본다 - 완료 순서가 새면 구 키 순서와 구별 거래 배열 순서가 달라진다.
// 입력은 전부 손으로 만든 슬롯이다(#8): 날짜·실제 원본에 따라 결과가 갈리지 않는다.
// 구 코드는 정수 꼴 문자열이라 Object.fromEntries 뒤 `Object.keys(districts)` 는 넣은 순서와 무관하게 오름차순이고 DISTRICTS 도 오름차순이다.
// 그래서 콜백 push 로 되돌렸을 때 실제로 갈리는 것은 구별 거래 배열 순서다(되돌려 돌려 봄, #572 PR 본문). 키 순서 단언은 코드가 바뀌어도 지키려고 둔다.
import test from "node:test";
import assert from "node:assert/strict";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { readDealSource, readRentSource } from "../scripts/realestate-source.ts";
import { rentItem, saleItem } from "./helpers/fake-molit.mjs";

const NOW = new Date("2026-11-15T03:00:00Z");
const MONTHS = ["202609", "202610", "202611"];
const SLOTS = MONTHS.length * DISTRICTS.length;
const slotIndex = (code, yearMonth) => MONTHS.indexOf(yearMonth) * DISTRICTS.length + DISTRICTS.findIndex((d) => d.code === code);

// 슬롯마다 이름으로 출처를 알 수 있는 거래 두 건. 매매는 해제 거래 한 건을 더 얹어 cancelled 합도 본다.
// 몇 슬롯은 비우거나(null·ok:false·빈 배열) 정규화에서 다 떨어지게 해서, 구 키가 처음 생기는 달이 구마다 다르게 한다.
const slotFile = (kind, code, yearMonth) => {
  const i = slotIndex(code, yearMonth);
  if (i % 7 === 3) return null;
  if (i % 11 === 5) return { ok: false, items: [] };
  if (i % 13 === 8) return { ok: true, items: [] };
  const make = kind === "sale" ? saleItem : rentItem;
  const dated = { dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)), dealDay: 3 };
  const items = [0, 1].map((n) => make({ ...dated, aptNm: `${kind}-${code}-${yearMonth}-${n}`, excluUseAr: 84.97 }));
  if (i % 17 === 2) return { ok: true, items: [make({ ...dated, aptNm: "" })] }; // 정규화에서 전부 떨어진다
  if (kind === "sale") items.push(make({ ...dated, aptNm: `해제-${code}-${yearMonth}`, cdealType: "O", cdealDay: "26.11.01" }));
  return { ok: true, items };
};

const readerWith = (delayOf) => async (kind, code, yearMonth) => {
  await new Promise((resolve) => setTimeout(resolve, delayOf(code, yearMonth)));
  return slotFile(kind, code, yearMonth);
};

const inOrder = readerWith(() => 0);
// 늦은 달이 먼저 끝나고 같은 달 안에서도 뒤 구가 먼저 끝나도록 지연을 거꾸로 준다.
const reversed = readerWith((code, yearMonth) => SLOTS - slotIndex(code, yearMonth));
// 씨앗 고정 의사난수(LCG) 0~30ms 지연 - 실행마다 같은 순서다.
const seeded = (seed) => {
  const delays = new Map();
  let s = seed;
  for (const yearMonth of MONTHS) {
    for (const { code } of DISTRICTS) {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      delays.set(`${code}-${yearMonth}`, s % 31);
    }
  }
  return readerWith((code, yearMonth) => delays.get(`${code}-${yearMonth}`));
};

// 정순일 때의 모양을 값으로 정렬하지 않고 인덱스 순으로 다시 세운다: 구 키는 DISTRICTS 순, 구 안의 거래는 달 순.
const expectedShape = (kind) => {
  const keys = [];
  const names = {};
  let cancelled = 0;
  for (const yearMonth of MONTHS) {
    for (const { code } of DISTRICTS) {
      const file = slotFile(kind, code, yearMonth);
      if (!file?.ok || !file.items.length) continue;
      const kept = file.items.filter((item) => item.aptNm && !item.cdealType);
      if (kind === "sale") cancelled += file.items.filter((item) => item.cdealType).length;
      if (!kept.length) continue;
      if (!names[code]) names[code] = [];
      names[code].push(...kept.map((item) => item.aptNm));
    }
  }
  for (const { code } of DISTRICTS) if (names[code]) keys.push(code);
  return { keys, names, cancelled };
};

for (const [kind, readSource] of [["sale", readDealSource], ["rent", readRentSource]]) {
  test(`${kind}: 슬롯이 거꾸로 끝나도 구 키는 DISTRICTS 순, 구별 거래는 months 순이고 정순 결과와 바이트가 같다 (#572)`, async () => {
    const base = await readSource(NOW, MONTHS, inOrder);
    const flipped = await readSource(NOW, MONTHS, reversed);
    const shape = expectedShape(kind);

    assert.ok(shape.keys.length > 20 && shape.keys.length < DISTRICTS.length, "구 키가 처음 생기는 달이 구마다 달라야 순서를 본다");
    for (const result of [base, flipped]) {
      assert.deepEqual(Object.keys(result.districts), shape.keys, "구 키 순서는 DISTRICTS 순서다");
      for (const code of shape.keys) {
        assert.deepEqual(result.districts[code].map((deal) => deal.apt), shape.names[code], `${code} 거래는 months 인덱스 순이다`);
      }
      if (kind === "sale") assert.equal(result.cancelled, shape.cancelled);
      else assert.equal("cancelled" in result, false);
    }
    assert.equal(JSON.stringify(flipped), JSON.stringify(base));
  });
}

test("sale·rent: 씨앗 고정 0~30ms 지연 세 벌도 정순 결과와 바이트가 같다 (#572)", async () => {
  for (const readSource of [readDealSource, readRentSource]) {
    const base = JSON.stringify(await readSource(NOW, MONTHS, inOrder));
    for (const seed of [1, 572, 20261115]) {
      assert.equal(JSON.stringify(await readSource(NOW, MONTHS, seeded(seed))), base, `seed ${seed}`);
    }
  }
});
