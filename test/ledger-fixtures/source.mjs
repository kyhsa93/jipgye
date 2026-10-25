// 원장 스냅샷 시험의 소스 픽스처 (#482). 실제 complex-price-*.json·raw 슬롯의 모양을 줄여 옮겼다 - 이름·숫자는 지어낸 것이다.
import { DISTRICTS } from "../../scripts/realestate-districts.ts";
import { itemKey } from "../../scripts/realestate-raw.ts";

const cell = (n, median, low, high, extra = {}) =>
  n < 3 ? { n } : { n, median, low, high, quartile: n >= 5, raw: median - 1000, unadjusted: 0, from: "2026-05-02", top: { amount: high, floor: 7, date: "2026-06-16" }, areas: [84.9], ...extra };

/** complex-price 25개(구 순서). 종로구에만 칸이 있다 - n=1·2(비공개), n=3·4(최저~최고), n=5·9(사분위), 가격대 경계 6·9·15·25억. */
export function complexFiles() {
  return DISTRICTS.map(({ name }) => ({
    json: {
      district: name,
      updatedAt: "2026-10-31T23:30:00.000Z",
      windowDays: 183,
      since: "2026-05-01",
      reference: "202609",
      cells:
        name !== "종로구"
          ? {}
          : {
              가나아파트: { "59.85": cell(1), "84.9": cell(2) },
              다라마을: { "59.9": cell(3, 60000, 58000, 61000), "84.84": cell(4, 60001, 59000, 62000, { yearAgo: { median: 50000, n: 9, months: ["202508"] } }) },
              바사힐스: { "114.2": cell(5, 90000, 88000, 91000), "84.95": cell(9, 150000, 140000, 155000) },
              자차타워: { "134.6": cell(6, 250000, 240000, 260000), "164.1": cell(3, 250001, 249000, 270000) },
            },
      meta: { 가나아파트: { dong: "창신동", buildYear: 2002 } },
    },
  }));
}

const sale = (day, month, extra = {}) => ({ aptDong: "", aptNm: "다라마을", buildYear: 2013, cdealDay: "", cdealType: "", dealAmount: "60,000", dealDay: day, dealMonth: month, dealYear: 2026, dealingGbn: "중개거래", excluUseAr: 59.9, floor: 3, rgstDate: "", sggCd: 11110, umdNm: "숭인동", ...extra });
const rent = (day, month) => ({ aptNm: "가나아파트", deposit: "25,000", dealDay: day, dealMonth: month, dealYear: 2026, excluUseAr: 64.88, floor: 8, monthlyRent: 0, sggCd: 11110, umdNm: "평창동" });

function slot(kind, district, yearMonth, rows, withArrivals = true) {
  // rows: [item, 첫 관측일 | null]. 같은 행이 두 줄이면 키가 하나라 도착일도 하나다(PREREG 5절 - 건수는 행으로 센다).
  const head = { kind, district, yearMonth, ok: true, resultCode: 0, count: rows.length, totalCount: rows.length, observedAt: "2026-10-31T23:10:00.000Z", previousObservedAt: null };
  const arrivals = {};
  for (const [item, day] of rows) if (day) arrivals[itemKey(item)] = day;
  return { kind, json: { ...head, ...(withArrivals ? { arrivals } : {}), items: rows.map(([item]) => item) } };
}

/** raw 슬롯. 202609 계약(제외)·같은 행 두 줄·해제·등기·도착 없는 행·arrivals 키가 없는 옛 모양 슬롯이 섞여 있다. */
export function rawSlots() {
  const twin = sale(3, 10);
  return [
    slot("sale", "11110", "202610", [
      [twin, "2026-10-09"], // 6일 → 0-7
      [twin, "2026-10-09"], // 같은 행 두 줄: 2행으로 센다
      [sale(1, 10, { cdealDay: "26.10.20", cdealType: "O" }), "2026-10-20"], // 19일 → 15-21, 해제 첫 관측
      [sale(2, 10, { rgstDate: "26.10.30" }), "2026-10-31"], // 29일 → 22-30, 등기 첫 관측
      [sale(4, 10, { floor: 9 }), "2026-10-12"], // 8일 → 8-14
      [sale(5, 10, { floor: 11 }), null], // 슬롯 첫 수집분이라 도착일이 없다 → skipped
    ]),
    slot("sale", "11110", "202609", [[sale(30, 9), "2026-10-01"]]), // 계약월 < 202610 → 제외
    slot("rent", "11110", "202610", [
      [rent(1, 10), "2026-10-31"], // 30일 → 22-30
      [rent(15, 10), "2026-10-31"], // 16일 → 15-21
    ]),
    slot("rent", "11140", "202610", [[rent(20, 10), "2026-10-24"]], false), // 옛 모양(arrivals 키 없음) → skipped
  ];
}
