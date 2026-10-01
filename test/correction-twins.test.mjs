import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-cancellation.mjs";
import { correctionSentence, correctionStats, withoutCorrections } from "../scripts/cancellation.mjs";

const NOW = new Date("2026-10-01T00:00:00Z");
const base = {
  sggCd: 11710, umdNm: "가락동", jibun: "1", aptNm: "가락금호", excluUseAr: 84.9, floor: 1,
  dealYear: 2026, dealMonth: 4, dealDay: 25, dealAmount: "189,000", rgstDate: "", cdealType: "", cdealDay: "",
};
const cancelledOf = (x) => ({ ...x, cdealType: "O", cdealDay: "26.05.27" });

test("같은 계약이 해제 없이 다시 신고됐으면 그 해제는 정정이다 — 짝은 남기고 정정만 뺀다", () => {
  const live = { ...base, rgstDate: "26.07.30" };
  const other = { ...base, floor: 5 };
  const { items, corrections } = withoutCorrections([cancelledOf(base), live, cancelledOf(other)]);
  assert.equal(corrections.length, 1);
  assert.deepEqual(items, [live, cancelledOf(other)], "짝 없는 해제(진짜로 깨진 계약)를 빼거나 짝을 뺐다");
});

test("한 칸이라도 다르면 정정이 아니다", () => {
  for (const field of ["floor", "dealDay", "dealAmount", "excluUseAr", "jibun"]) {
    const live = { ...base, [field]: field === "dealAmount" ? "190,000" : field === "jibun" ? "2" : base[field] + 1 };
    assert.equal(withoutCorrections([cancelledOf(base), live]).corrections.length, 0, `${field}가 다른데 정정으로 봤다`);
  }
});

test("정정 비율과, 익은 달의 정정 짝이 등기까지 갔는지를 센다", () => {
  const twin = { ...base, rgstDate: "26.07.30" };
  const c = correctionStats(4, [{ item: cancelledOf(base), twin }, { item: cancelledOf({ ...base, dealMonth: 9 }), twin: { ...base, dealMonth: 9 } }], ["2026-04"]);
  assert.equal(c.share, 50);
  assert.equal(c.matured, 1, "덜 익은 9월 정정을 등기 비율에 넣었다");
  assert.equal(c.registeredShare, 100);
  assert.match(correctionSentence(c, "ko"), /신고를 고친 것입니다/);
});

test("빌드: 정정은 해제율에서 빠지고 따로 센다", () => {
  const later = Array.from({ length: 30 }, (_, i) => ({ ...base, floor: 10 + i, dealMonth: 9, dealDay: 1 }));
  const real = { ...base, floor: 3, cdealType: "O", cdealDay: "26.05.01" }; // 짝 없는 해제
  const items = [cancelledOf(base), { ...base, rgstDate: "26.07.30" }, real, ...Array.from({ length: 50 }, (_, i) => ({ ...base, floor: 20 + i })), ...later];
  const payload = buildPayload({ byDistrict: { 송파구: items }, months: ["202604"], now: NOW });
  assert.equal(payload.seoul.correction.corrections, 1);
  assert.equal(payload.seoul.cancelled, 1, "정정을 해제로 셌다");
  assert.equal(payload.seoul.deals, 52, "정정 기록과 그 짝을 두 번 셌다");
});
