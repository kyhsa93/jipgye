import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { districtFacts, factSentences } from "../scripts/district-facts.ts";
import { DISTRICT_SHAPE_KEYS, DISTRICT_SHAPE_MAX_COVER, DISTRICT_SHAPE_MIN_KINDS, districtShape, judgeDistrictShapes } from "../scripts/check-data-progress.ts";
import { shapeDeals } from "./helpers/district-shape-deals.mjs";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "../scripts/district-slugs.ts";

const root = path.resolve(import.meta.dirname, "..");
const dealsOf = (name) =>
  readFile(path.join(root, `docs/data/deals-${DISTRICT_SLUGS[name]}.json`), "utf8")
    .then(JSON.parse)
    .catch(() => null);

/**
 * 문턱을 하나도 넘지 않는 거래 200건.
 *
 * 실제 자치구를 골라 "이 구는 튀는 데가 없다"고 단언하던 검사가 있었는데, 동대문구에서
 * 한 단지가 5%를 넘은 날 깨졌다. 코드는 그대로인데 시장이 움직여서 깨진 것이고, 이
 * 저장소에서 그런 단언은 수집 후 테스트를 막아 그날 데이터를 통째로 날린다.
 *
 * 그래서 동작은 여기서 만든 표본으로 확인한다. 한 동이 30%(몰림 40%·흩어짐 20% 어느
 * 쪽도 아님), 전용 70㎡(소형 60·대형 85 어느 쪽도 아님), 준공 15년(노후 30·신축 5 어느
 * 쪽도 아님), 단지 스물다섯 곳에 고르게(한 단지 4% < 5%), 직거래 없음.
 */
const PLAIN_YEAR = 2026;

function plainDeals(over = (deal) => deal) {
  const deals = [];
  for (let i = 0; i < 200; i += 1) {
    deals.push(
      over({
        dong: i < 60 ? "몰린동" : `흩어진동${i % 9}`,
        apt: `단지${i % 25}`,
        area: 70,
        floor: 5,
        amount10k: 100000,
        date: "2026-08-01",
        buildYear: PLAIN_YEAR - 15,
        direct: false,
      }, i)
    );
  }
  return { deals, updatedAt: `${PLAIN_YEAR}-08-20T00:00:00.000Z`, periods: ["202606", "202607", "202608"] };
}

const NOTABLE = ["concentrated", "spreadOut", "smallHeavy", "largeHeavy", "old", "fresh", "oneComplex", "directHeavy"];

// 「자치구 페이지가 서로 다른 이야기를 한다」(조합 ≥ 8, 최다 ≤ 자치구 수/3)는 실데이터 판정이라 여기서 뺐다(#813 pm 결정 2).
// 시장이 움직이면 코드와 무관하게 깨져 그날 배포 데이터를 막는다(#8·#811). 실데이터 판정은 워치독의 비차단 경고로 옮겼다
// (scripts/check-data-progress.ts 의 district-shapes - 애드센스 사유 주석도 거기 있다). 여기서는 같은 함수·같은 문턱을 합성 입력으로만 본다.

test("관찰 키 아홉 개는 각각 켜질 수 있다 - 합성 거래, 날짜 고정 (#813)", () => {
  assert.equal(DISTRICT_SHAPE_KEYS.length, 9);
  assert.deepEqual(DISTRICT_SHAPE_KEYS.slice(0, -1), NOTABLE, "문턱 키 여덟 + typical");
  for (const key of DISTRICT_SHAPE_KEYS) {
    const file = shapeDeals(key === "typical" ? [] : [key]);
    assert.equal(districtShape(file), key, `${key} 하나만 켜져야 합니다`);
    assert.ok(districtFacts(file)[key], key);
  }
  // 축이 다른 키는 같이 켜진다. 조합 문자열은 키 순서대로 + 로 잇는다.
  assert.equal(districtShape(shapeDeals(["concentrated", "oneComplex", "directHeavy"])), "concentrated+oneComplex+directHeavy");
  assert.equal(districtShape(shapeDeals(["spreadOut", "largeHeavy", "fresh"])), "spreadOut+largeHeavy+fresh");
  // 얇은 구(120건 미만)는 빈 조합, 거래가 없거나 파일이 없으면 null(못 읽음으로 센다).
  assert.equal(districtShape(shapeDeals(["old"], { n: 100 })), "");
  assert.equal(districtShape({ deals: [] }), null);
  assert.equal(districtShape(null), null);
});

/** 합성 구 25개: 조합 목록을 차례로 돌려 쓴다. */
const districtsOf = (shapes, total = DISTRICT_PAGES.length) =>
  Array.from({ length: total }, (_, i) => districtShape(shapeDeals(shapes[i % shapes.length])));

test("합성 구 25개로 문턱을 넘는 경우와 못 넘는 경우를 각각 낸다 (#813, 문턱 pm 결정 1)", () => {
  assert.equal(DISTRICT_SHAPE_MIN_KINDS, 8);
  assert.equal(DISTRICT_SHAPE_MAX_COVER, 25 / 3);
  const singles = DISTRICT_SHAPE_KEYS.map((k) => (k === "typical" ? [] : [k]));
  // 통과: 아홉 조합 + 한 조합 = 10가지, 최다 3구.
  const pass = judgeDistrictShapes(districtsOf([...singles, ["concentrated", "oneComplex"]]));
  assert.deepEqual([pass.kinds, pass.biggest, pass.ok], [10, 3, true]);
  // 경계 통과: 정확히 8가지, 최다 8구(≤ 25/3). 구 수 = 8+3+3+3+2+2+2+2 = 25.
  const counts = [8, 3, 3, 3, 2, 2, 2, 2];
  const edge = judgeDistrictShapes(counts.flatMap((c, i) => Array(c).fill(districtShape(shapeDeals(singles[i])))));
  assert.deepEqual([edge.kinds, edge.biggest, edge.ok], [8, 8, true]);
  // 불통과(최다 9구): 같은 여덟 가지에서 한 구만 첫 조합으로 옮긴다.
  const over = judgeDistrictShapes([9, 2, 3, 3, 2, 2, 2, 2].flatMap((c, i) => Array(c).fill(districtShape(shapeDeals(singles[i])))));
  assert.deepEqual([over.kinds, over.biggest, over.ok], [8, 9, false]);
  // 불통과(조합 수): 일곱 가지뿐.
  const few = judgeDistrictShapes(districtsOf(singles.slice(0, 7)));
  assert.deepEqual([few.kinds, few.ok], [7, false]);
  // 불통과(한 조합이 덮음): 아홉 가지지만 typical 이 9구.
  const one = judgeDistrictShapes(districtsOf([...Array(9).fill([]), ...singles.slice(0, 8).flatMap((s) => [s, s])]));
  assert.deepEqual([one.kinds, one.biggest, one.ok], [9, 9, false]);
});

test("표본이 얇은 구에서는 비중을 말하지 않는다", async () => {
  // 종로구는 석 달 신고가 백 건이 안 된다. 그 위에서 "열 건 중 넷이 대형"이라고 하면
  // 스물몇 건짜리 이야기가 되고, 한 단지가 입주하면 다음 주에 뒤집힌다. 표본 위에
  // 조건을 얹으면 건수가 거짓말을 한다는 건 실거래 검색에서 이미 겪은 일이다.
  const thin = districtFacts({ deals: [{ dong: "가", apt: "나", area: 84, amount10k: 100000, buildYear: 1990 }] });
  assert.ok(thin.top, "가장 비싼 거래는 한 건만 있어도 사실이라 말한다");
  for (const key of ["concentrated", "spreadOut", "smallHeavy", "largeHeavy", "old", "fresh", "oneComplex", "directHeavy", "typical"]) {
    assert.equal(thin[key], undefined, `${key}는 표본이 얇으면 말하지 않아야 합니다`);
  }
  assert.equal(districtFacts({ deals: [] }), null);
  assert.equal(districtFacts(null), null);
  assert.deepEqual(factSentences(null), []);
});

test("말할 것이 없으면 문단이 통째로 빈다", async () => {
  // 비어 있는 것이 정상 경로다. 억지로 채우면 다시 한 틀이 된다.
  const only = factSentences(districtFacts({ deals: [{ dong: "가", apt: "나", area: 84, amount10k: 500000 }] }), "ko");
  assert.equal(only.length, 1, "얇은 구는 가장 비싼 거래 한 문장뿐이다");
  assert.match(only[0], /가장 비싸게 팔린/);
});

test("한 단지가 구를 대표해 버리면 그렇다고 말한다", async () => {
  // 대단지 입주장이면 그 구의 평균은 그 단지의 평균에 가깝고, 시세를 읽는 사람이
  // 알아야 하는 사실이다.
  const one = plainDeals((deal, i) => (i < 20 ? { ...deal, dong: "몰린동", apt: "대표단지" } : deal));
  assert.match(factSentences(districtFacts(one), "ko").join(" "), /한 단지가 유독 많이 팔렸습니다/);
  assert.doesNotMatch(factSentences(districtFacts(plainDeals()), "ko").join(" "), /한 단지가 유독/);
});

test("튀는 데가 없으면 그렇다고 말한다", async () => {
  // 지어내는 대신 재고서 아무것도 안 나왔다고 말한다. 문턱을 하나라도 넘으면
  // 이 문장이 나오면 안 된다 — 그러면 다시 모든 페이지에 붙는 한 줄이 된다.
  assert.match(factSentences(districtFacts(plainDeals()), "ko").join(" "), /튀는 데가 없습니다/);

  const small = plainDeals((deal) => ({ ...deal, area: 40 }));
  assert.doesNotMatch(factSentences(districtFacts(small), "ko").join(" "), /튀는 데가 없습니다/);
});

test("어느 구든 튀는 데가 없다는 말과 문턱을 넘은 관찰이 같이 나오지 않는다", async () => {
  // 실제 자료로 확인하되, 시장이 움직여도 깨지지 않는 것만 단언한다 — 어느 구가 어느
  // 관찰에 걸리는지는 데이터가 정하지만, 둘이 같이 나올 수 없다는 것은 코드가 정한다.
  //
  // 표본이 문턱(120건) 아래인 구는 둘 다 없는 것이 맞다. 재 보지도 않고 "튀는 데가
  // 없다"고 말하면 안 되기 때문이다 — 종로구가 실제로 그 상태다.
  for (const { name } of DISTRICT_PAGES) {
    const facts = districtFacts(await dealsOf(name));
    if (!facts) continue;
    assert.ok(
      !(facts.typical && NOTABLE.some((key) => facts[key])),
      `${name}: 문턱을 넘은 관찰과 "튀는 데가 없다"가 같이 나옵니다`
    );
  }
});

test("직거래가 많으면 시세를 그대로 읽지 말라고 적는다", async () => {
  // 직거래에는 증여성 거래와 시행사 정산이 섞인다. 스물다섯 구가 0%에서 41%까지
  // 갈리는데 시세표에는 흔적이 없어서, 평균만 보면 알 수 없는 사실이다.
  const heavy = plainDeals((deal, i) => (i < 30 ? { ...deal, direct: true } : deal));
  assert.match(factSentences(districtFacts(heavy), "ko").join(" "), /직거래가 \d+%/);

  const light = plainDeals((deal, i) => (i < 10 ? { ...deal, direct: true } : deal));
  assert.doesNotMatch(factSentences(districtFacts(light), "ko").join(" "), /직거래가 \d+%/);
});

test("영문 문단도 같은 관찰을 말한다", async () => {
  // 실데이터 노원구 대신 합성 표본 넷(튀는 데 없음·소형 몰림·직거래·한 단지)으로 - 실데이터는 그날 어느 관찰이 걸리는지 데이터가 정하고
  // 신고가 없는 달은 문단 자체가 비어 깨진다(#811). 합성 표본은 관찰 종류를 골고루 밟는다.
  const samples = [plainDeals(), plainDeals((deal) => ({ ...deal, area: 40 })), plainDeals((deal, i) => (i < 30 ? { ...deal, direct: true } : deal)), plainDeals((deal, i) => (i < 20 ? { ...deal, dong: "몰린동", apt: "대표단지" } : deal))];
  for (const sample of samples) {
    const ko = factSentences(districtFacts(sample), "ko");
    const en = factSentences(districtFacts(sample), "en");
    assert.equal(ko.length, en.length, "한쪽에만 있는 문장이 있으면 안 됩니다");
    // 한글이 남아 있는 것은 정상이다 — 상계동과 중계동 동진신안에는 영어 이름이 없고,
    // 기존 시세 문장도 "Apartments in 강남구"라고 쓴다. 없어야 하는 것은 한국어 *문장*이라
    // 종결어미로 잡는다.
    assert.doesNotMatch(en.join(" "), /입니다|습니다|합니다/, "영문 문단에 한국어 문장이 섞였습니다");
    assert.match(en.join(" "), /reported/, "영문 문단이 영어로 쓰여 있어야 합니다");
  }
});

test("영문 최고가는 소수점 없이 M 단위로 쓰고 한국어와 같은 반올림을 따른다", () => {
  // 영어 `eok`가 반올림한 글자 뒤에 `00M`을 이어 붙이던 때는 10억 미만이 `₩6.600M`처럼 나왔다.
  // 구운 영어 자치구 25장은 최고가가 모두 10억 이상이라 화면에는 없던 결함이고, 그래서 표본으로 가린다.
  // 10억 이상은 억 단위로 반올림해 굽는 것이 현행이고(쉼표 없음) 그대로 둔다.
  const cases = [
    // [만원, 영어, 한국어]
    [66000, "₩660M", "6.6억원"],
    [66500, "₩670M", "6.7억원"], // 한국어 반올림과 같은 쪽
    [90000, "₩900M", "9.0억원"],
    [95000, "₩950M", "9.5억원"],
    [158000, "₩1600M", "16억원"], // 10억 이상은 정수 억
    [320000, "₩3200M", "32억원"],
    [1000000, "₩10000M", "100억원"],
  ];
  for (const [amount10k, en, ko] of cases) {
    const facts = districtFacts({ deals: [{ dong: "가", apt: "나", area: 84, amount10k }] });
    const enText = factSentences(facts, "en").join(" ");
    const koText = factSentences(facts, "ko").join(" ");
    assert.ok(enText.includes(` ${en} for a `), `${amount10k}만원: 영어 ${en} 이어야 합니다 - ${enText}`);
    assert.ok(koText.includes(`로 ${ko}입니다`), `${amount10k}만원: 한국어 ${ko} 이어야 합니다 - ${koText}`);
    assert.doesNotMatch(enText, /₩\d+\.\d/, `${amount10k}만원: 영어 금액에 소수점이 남았습니다`);
  }
});

test("창을 밝히고 시작한다", async () => {
  // 위 시세표는 최근 네 주 계약분이고 여기 숫자는 석 달 신고분이라, 두 숫자가 어긋나
  // 보일 때 어느 쪽이 무엇인지 읽는 사람이 알 수 있어야 한다.
  // 합성 표본(석 달 창) - 실데이터 노원구는 신고가 없는 달 문단이 비어 lines[0] 이 없다(#811).
  const lines = factSentences(districtFacts(plainDeals()), "ko");
  assert.match(lines[0], /최근 네 주가 아니라/);
  assert.match(lines[0], /개월 동안 신고된/);
});
