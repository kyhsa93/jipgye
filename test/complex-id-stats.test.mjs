// 동명 단지 통계 칸 분리(#843). 값은 전부 지어낸 고정 데이터다 - 실데이터 값·건수·날짜에 기대지 않는다.
// #821 이 카드로 이어지는 칸을 옮긴 뒤 남은 통계 칸(신고가·갈아타기·층 격차·재계약 격차와, 그 칸 키를 그대로 쓰는 등기·이번 주·구간 변화·직거래)이
// complex-id.ts 키를 쓰는지 본다. 지키는 것: 다른 동의 같은 이름 단지 거래가 이 칸의 비교 상대가 되지 않고, 이름이 유일한 칸은 키도 값도 그대로다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPayload as buildDirect } from "../scripts/build-direct-deals.ts";
import { buildPayload as buildChange } from "../scripts/build-district-change.ts";
import { buildPayload as buildFloor, saleRow } from "../scripts/build-floor-gap.ts";
import { buildPayload as buildRecord } from "../scripts/build-record-high.ts";
import { buildPayload as buildRenewal } from "../scripts/build-renewal-facts.ts";
import { itemComplexKey } from "../scripts/complex-id.ts";
import { districtGaps } from "../scripts/direct-deals.ts";
import { cellChanges, toDeal as changeDeal } from "../scripts/district-change.ts";
import { cellKey, tally as floorTally, toCells } from "../scripts/floor-gap.ts";
import { byCell, measure, toDeal as recordDeal } from "../scripts/record-high.ts";
import { buildRegistrationPayload, recordClasses } from "../scripts/registration.ts";
import { renewalGap, tally as renewalTally, wolseRenewalGaps } from "../scripts/renewal-facts.ts";
import { buildSegmentPayload, segmentCells, toSegmentDeal } from "../scripts/segment-change.ts";
import { buildDigest, recordVerdict, saleCells } from "../scripts/week-digest.ts";

const SEONGDONG = "11200";
const NOW = new Date("2026-11-01T00:00:00Z");
// readSameNames 모양: 구 코드 → 그 구의 동명 단지. 성동구의 벽산만 갈린다.
const SAME = { [SEONGDONG]: new Set(["벽산"]) };

const sale = (umdNm, amount, [dealYear, dealMonth, dealDay], over = {}) => ({
  sggCd: 11200, aptNm: "벽산", umdNm, jibun: "1", excluUseAr: 84.82, dealAmount: amount, dealYear, dealMonth, dealDay,
  dealingGbn: "중개거래", cdealType: "", floor: 5, buildYear: 2000, rgstDate: "26.01.01", ...over,
});
const rent = (umdNm, deposit, over = {}) => ({ sggCd: 11200, aptNm: "벽산", umdNm, excluUseAr: 84.82, deposit, monthlyRent: 0, contractType: "신규", dealYear: 2026, dealMonth: 6, dealDay: 15, ...over });
const renewal = (umdNm, deposit, over = {}) => rent(umdNm, deposit, { contractType: "갱신", preDeposit: "40,000", preMonthlyRent: 0, useRRRight: "사용", ...over });

// 금호동1가의 비싼 벽산 셋 뒤에 사근동 벽산이 값을 올린다. 칸이 합쳐지면 사근동의 새 최고가가 금호동1가 값에 가려진다.
const EXPENSIVE = [[2025, 1, 5], [2025, 1, 6], [2025, 1, 7]].map((day) => sale("금호동1가", "200,000", day));
const CHEAP = [
  sale("사근동", "100,000", [2025, 1, 10]),
  sale("사근동", "101,000", [2025, 3, 10]),
  sale("사근동", "102,000", [2025, 5, 10]),
];
const RECORD = sale("사근동", "110,000", [2025, 9, 10]);
const HISTORY = [...EXPENSIVE, ...CHEAP, RECORD, sale("사근동", "110,000", [2026, 1, 10])];
const END = Date.UTC(2026, 0, 10);

test("줄의 키: 그 줄의 구 명단으로 찾고, 명단이 없으면 받은 글자 그대로다", () => {
  assert.equal(itemComplexKey({ sggCd: 11200, aptNm: "벽산", umdNm: "사근동" }, SAME), "벽산 (사근동)");
  assert.equal(itemComplexKey({ sggCd: "11200", aptNm: "벽산", umdNm: "사근동" }, SAME), "벽산 (사근동)", "구 코드가 문자열인 원본");
  assert.equal(itemComplexKey({ sggCd: 11110, aptNm: "벽산", umdNm: "창신동" }, SAME), "벽산", "다른 구의 명단으로 갈랐다");
  assert.equal(itemComplexKey({ sggCd: 11200, aptNm: "옆단지", umdNm: "행당동" }, SAME), "옆단지");
  assert.equal(itemComplexKey({ sggCd: 11200, aptNm: "벽산", umdNm: "사근동" }), "벽산", "명단이 없으면 지금 키와 같아야 한다");
});

test("신고가: 다른 동의 비싼 거래가 이 칸의 그 전 최고가가 되지 않는다", () => {
  const count = (same) => measure(byCell(HISTORY.map((item) => recordDeal(item, same)).filter(Boolean)), END, { wait: 0 }).records;
  assert.equal(count(undefined), 0, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(count(SAME), 1);
});

test("등기·이번 주 신고: 신고가 판정이 신고가 화면과 같은 칸을 본다", () => {
  assert.equal(recordClasses(HISTORY).get(RECORD), "rest", "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(recordClasses(HISTORY, SAME).get(RECORD), "record");
  assert.equal(recordVerdict(RECORD, saleCells(HISTORY)), false, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(recordVerdict(RECORD, saleCells(HISTORY, SAME), SAME), true);
});

test("갈아타기·구간 변화: 두 시기의 거래가 서로 다른 동이면 맞물린 칸이 아니다", () => {
  const items = [sale("금호동1가", "200,000", [2025, 7, 10]), sale("사근동", "100,000", [2026, 7, 10])];
  const periods = { base: ["202507"], recent: ["202607"] };
  const change = (same) => cellChanges(items.map((item) => changeDeal(item, same)), periods).get(SEONGDONG);
  assert.equal(change(undefined).length, 1, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(change(SAME), undefined, "동 차이를 변화로 셌다");
  const segment = (same) => segmentCells(items.map((item) => toSegmentDeal(item, same)), periods);
  assert.equal(segment(undefined).length, 1, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(segment(SAME).length, 0, "동 차이를 변화로 셌다");
});

test("층 격차: 다른 동의 윗층과 견주어 동 차이를 층 차이로 세지 않는다", () => {
  const rows = [
    sale("금호동1가", "130,000", [2026, 6, 1], { floor: 1 }),
    ...[3, 5, 7].map((floor) => sale("사근동", "100,000", [2026, 6, 2], { floor })),
  ].map(saleRow);
  const cells = (same) => toCells({ 성동구: rows }, same);
  assert.equal(cells(undefined).length, 1, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(floorTally(cells(undefined)).low.cells, 1, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(cells(SAME).length, 2);
  assert.equal(floorTally(cells(SAME)).low.cells, 0, "동 차이를 층 차이로 셌다");
});

test("재계약 격차: 다른 동의 신규를 이 단지의 시세로 쓰지 않는다", () => {
  const items = [rent("금호동1가", "60,000"), rent("금호동1가", "60,000"), rent("금호동1가", "60,000"), renewal("사근동", "42,000")];
  assert.equal(renewalGap(items, NOW).gapMatched, 1, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(renewalGap(items, NOW, SAME).gapMatched, 0);
  assert.equal(renewalTally(items, NOW, { sameNames: SAME }).gapMatched, 0, "화면이 쓰는 tally 에 명단이 닿지 않았다");

  const wolse = (fn, umdNm, over = {}) => fn(umdNm, "10,000", { monthlyRent: 100, ...over });
  const wolseItems = [wolse(rent, "금호동1가"), wolse(rent, "금호동1가"), wolse(rent, "금호동1가"), wolse(renewal, "사근동", { preMonthlyRent: 90 })];
  assert.equal(wolseRenewalGaps(wolseItems, NOW, 5).length, 1, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(wolseRenewalGaps(wolseItems, NOW, 5, SAME).length, 0);
  assert.equal(renewalTally(wolseItems, NOW, { wolseRate: 5, sameNames: SAME }).wolse.matched, 0, "월세 격차에 명단이 닿지 않았다");
});

test("직거래 격차: 층 격차와 같은 칸이라 다른 동의 거래와 견주지 않는다", () => {
  const items = [
    ...[1, 2, 3].map((d) => sale("금호동1가", "100,000", [2026, 6, d], { dealingGbn: "직거래" })),
    ...[1, 2, 3].map((d) => sale("사근동", "200,000", [2026, 6, d])),
  ];
  assert.equal(districtGaps({ 성동구: items }).get("성동구").gaps.length, 1, "고정 데이터가 섞임을 재현하지 못한다");
  assert.equal(districtGaps({ 성동구: items }, SAME).get("성동구")?.gaps.length ?? 0, 0);
});

test("이름이 유일한 칸은 동명 단지가 갈려도 키도 값도 그대로다", () => {
  const unique = [1, 2, 3, 4].map((d) => sale("행당동", "70,000", [2026, 6, d], { aptNm: "옆단지", excluUseAr: 59.9, floor: d }));
  const items = [...HISTORY, ...unique];
  const key = "11200|옆단지|59.9";
  assert.equal(recordDeal(unique[0], SAME).cell, key);
  assert.equal(changeDeal(unique[0], SAME).cell, key);
  assert.equal(cellKey(unique[0], SAME), key);
  assert.deepEqual(
    byCell(items.map((item) => recordDeal(item, SAME)).filter(Boolean)).get(key),
    byCell(items.map((item) => recordDeal(item)).filter(Boolean)).get(key)
  );
  const rowsOf = (same) => toCells({ 성동구: items.map(saleRow) }, same).find((c) => c.rows.length === 4 && c.rows[0].price === 70000);
  assert.deepEqual(rowsOf(SAME), rowsOf(undefined));
});

test("이름이 전부 유일하면 빌더 결과가 명단이 있으나 없으나 한 글자도 같다", () => {
  // 쉰 단지가 두 시기(2025·2026 7~9월)에 층마다 거래된다. 빌더마다 null 로 빠지지 않을 만큼만 넣는다 - 아래 null 검사가 공회전을 막는다.
  const sales = [];
  const rents = [];
  for (let i = 0; i < 50; i += 1) {
    const over = { aptNm: `단지${i}`, umdNm: `동${i % 5}`, excluUseAr: 59.9 };
    for (const [year, rise] of [[2025, 0], [2026, 5000]]) {
      for (const dealMonth of [7, 8, 9]) {
        for (const floor of [1, 3, 5, 7]) {
          const amount = (60000 + i * 500 + rise + floor * 100 + dealMonth * 10).toLocaleString("en-US");
          sales.push(sale(over.umdNm, amount, [year, dealMonth, floor + 1], { ...over, floor }));
        }
      }
    }
    for (let k = 0; k < 3; k += 1) rents.push(rent(over.umdNm, "50,000", over));
    rents.push(renewal(over.umdNm, "42,000", over));
  }
  const months = [...new Set(sales.map((s) => `${s.dealYear}${String(s.dealMonth).padStart(2, "0")}`))].sort();
  const rows = sales.map((item, i) => ({ kind: "sale", district: SEONGDONG, key: String(i), day: "2026-10-20", item }));
  const builders = {
    신고가: (extra) => buildRecord({ items: sales, now: NOW, ...extra }),
    갈아타기: (extra) => buildChange({ items: sales, now: NOW, official: null, survey: null, ...extra }),
    구간변화: (extra) => buildSegmentPayload({ items: sales, now: NOW, ...extra }),
    등기: (extra) => buildRegistrationPayload({ items: sales, now: NOW, ...extra }),
    층격차: (extra) => buildFloor({ sale: { 성동구: sales.map(saleRow) }, jeonse: {}, now: NOW, ...extra }),
    재계약: (extra) => buildRenewal({ byDistrict: { 성동구: rents }, now: NOW, wolseRate: 5, ...extra }),
    직거래: (extra) => buildDirect({ byDistrict: { 성동구: sales }, months, now: NOW, ...extra }),
    이번주: (extra) => buildDigest({ rows, saleItems: sales, now: NOW, ...extra }),
  };
  for (const [name, build] of Object.entries(builders)) {
    const plain = build({});
    assert.ok(plain, `${name}: 고정 데이터로 결과를 내지 못해 검사가 공회전한다`);
    assert.deepEqual(build({ sameNames: SAME }), plain, `${name}: 명단에 없는 이름의 값이 바뀌었다`);
  }
});

test("빌더가 원본 전체의 동명 명단을 칸 계산까지 넘긴다", async () => {
  // buildPayload 의 sameNames 는 기본값이 빈 명단이라, main 에서 빠뜨리면 시험이 아니라 사이트만 조용히 옛 칸으로 돌아간다.
  const source = (name) => readFile(path.join(import.meta.dirname, "../scripts", name), "utf8");
  for (const [file, pattern] of [
    ["build-record-high.ts", /buildPayload\(\{[^}]*sameNames: await readSameNames\(\)/],
    ["build-floor-gap.ts", /buildPayload\(\{[^}]*sameNames: await readSameNames\(\)/],
    ["build-renewal-facts.ts", /buildPayload\(\{[^}]*sameNames: await readSameNames\(\)/],
    ["build-week-digest.ts", /buildDigest\(\{[^}]*sameNames: await readSameNames\(dir\)/],
    ["build-cancellation.ts", /tryWriteDirectDeals\(\{[^}]*sameNames: await readSameNames\(\)/],
    // 직거래 단독 CLI는 #855에서 비활성화. 정상 호출자는 위 build-cancellation.ts에서 명단을 넘긴다.
    ["build-district-change.ts", /readSameNames\(\)\]\)/],
    ["build-district-change.ts", /writeRegistrationSoft\(\{[^}]*sameNames/],
    ["build-district-change.ts", /= buildPayload\(\{[^}]*sameNames/],
    ["build-district-change.ts", /writeSegmentChangeSoft\(\{[^}]*sameNames/],
  ]) {
    assert.match(await source(file), pattern, `${file}: 명단을 넘기지 않는다`);
  }
});
