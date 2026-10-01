import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-cancellation.mjs";
import { MIN_DEALS, registrationSentence, registrationStats } from "../scripts/cancellation.mjs";
import { yearChangeSentence } from "../scripts/mortgage.mjs";

const NOW = new Date("2026-10-01T00:00:00Z");
const pad = (n) => String(n).padStart(2, "0");
/** 계약 2026-{month}-10, 등기 days일 뒤(없으면 미등기). */
const deal = (month, days, amount = "100,000") => {
  const d = days === null ? null : new Date(Date.UTC(2026, month - 1, 10 + days));
  return {
    sggCd: 11350, aptNm: "가", excluUseAr: 84.9, dealAmount: amount, dealYear: 2026, dealMonth: month, dealDay: 10,
    rgstDate: d ? `${String(d.getUTCFullYear()).slice(2)}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}` : "",
    cdealType: "",
  };
};
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test("여섯 달 창에 익은 달이 없어도 원본 전체로 등기를 센다 (#27)", () => {
  const young = many(150, () => deal(8, null)); // 8월 계약: 아직 등기 전
  const old = [...many(120, () => deal(3, 80)), ...many(10, () => deal(3, null))]; // 3월: 익은 달
  const payload = buildPayload({
    byDistrict: { 노원구: young },
    registrationByDistrict: { 노원구: [...old, ...young] },
    months: ["202605", "202610"],
    now: NOW,
  });
  const reg = payload.seoul.registration;
  assert.deepEqual(reg.matureMonths, ["2026-03"]);
  assert.equal(reg.staleShare, 7.7);
  assert.doesNotMatch(payload.seoul.registrationLead.ko, /null/);
  assert.equal(payload.districts[0].staleShare, 7.7, "자치구 미등기율도 원본 전체의 익은 달로 센다");
});

test("익은 달이 하나도 없으면 null을 찍지 않고 그렇다고 적는다", () => {
  const reg = registrationStats(many(150, () => deal(8, null)));
  const text = registrationSentence(reg, "ko");
  assert.doesNotMatch(text, /null|NaN|undefined/);
  assert.match(text, /아직 익은 달/);
  assert.doesNotMatch(registrationSentence(reg, "en"), /null|NaN|undefined/);
});

test("걸린 날은 익은 달 계약에서만 센다 — 덜 익은 달의 빠른 등기가 섞이면 짧게 나온다", () => {
  const items = [
    ...many(MIN_DEALS + 20, () => deal(3, 90)),
    ...many(150, () => deal(8, 20)), // 8월: 빨리 끝난 것만 등기됨 - 섞이면 중앙값을 끌어내릴 만큼 많다
    ...many(170, () => deal(8, null)),
  ];
  assert.equal(registrationStats(items).medianDays, 90);
});

test("가격대별 걸린 날은 그 대에 계약이 충분할 때만 낸다", () => {
  const items = [
    ...many(MIN_DEALS, () => deal(3, 60, "50,000")),
    ...many(MIN_DEALS, () => deal(3, 95, "200,000")),
    ...many(5, () => deal(3, 120, "300,000")),
  ];
  const { byPrice } = registrationStats(items);
  assert.equal(byPrice.upTo6.days, 60);
  assert.equal(byPrice.upTo25.days, 95);
  assert.equal(byPrice.over25.days, null, "다섯 건으로 낸 값");
  assert.match(registrationSentence(registrationStats(items), "ko"), /6억 이하 60일/);
});

test("1억당 상환액의 1년 변화는 같은 달 1년 전과 견주고, 다른 자라고 적는다", () => {
  const series = [["202508", 3.96], ["202607", 4.6], ["202608", 4.66]];
  const text = yearChangeSentence(series);
  assert.match(text, /2025년 8월 연 3.96%에서 2026년 8월 연 4.66%/);
  assert.match(text, /48만원에서 52만원으로 4만원 늘었습니다/);
  assert.match(text, /다른 자/);
  assert.equal(yearChangeSentence([["202607", 4.6], ["202608", 4.66]]), null, "1년 전 값이 없는데 문장을 만들었다");
});

test("미등기가 막 익은 한 달에 몰렸으면 그 달을 뺀 비율을 같이 적는다 (#34)", () => {
  // 3월: 다 등기(익음). 4월: 82%만 등기(막 익음) - 미등기 대부분이 4월에서 나온다.
  const items = [
    ...many(200, () => deal(3, 80)),
    ...many(2, () => deal(3, null)),
    ...many(82, () => deal(4, 80)),
    ...many(18, () => deal(4, null)),
  ];
  const reg = registrationStats(items);
  assert.equal(reg.latestMature.month, "2026-04");
  assert.equal(reg.latestMature.staleShareWithout, 1);
  assert.match(registrationSentence(reg, "ko"), /막 익은 2026년 4월 한 달에서 나옵니다 — 그 달을 빼면 1%입니다/);
});
