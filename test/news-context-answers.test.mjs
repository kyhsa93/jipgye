// #694 (N12): 기사 키워드 → 신고가·계약 해제·입주 물량·전월세전환율 답 화면 링크. 규칙은 보수적이어야 한다 -
// 맞는 기사에 붙는 것만큼, 증시·지방·분양·여러 구 기사에 안 붙는 것을 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachContext, buildContext } from "../scripts/news-context.ts";
import { newsContextHtml, newsListHtml } from "../scripts/prerender.ts";
import { loadNewsPage } from "./helpers/news-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readText = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => readText(`docs/data/${name}.json`).then(JSON.parse);

const REALESTATE = {
  window: { from: "2026-06-15", to: "2026-07-12", weeks: 4 },
  overall: {
    sale: { avgPricePerPyeong10k: 4449, transactionCount: 575 },
    jeonse: { avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: ["송파구", "노원구", "강남구", "강북구", "관악구", "동작구"].map((name) => ({
    code: "11000",
    name,
    sale: { avgPricePerPyeong10k: 6912, transactionCount: 16 },
  })),
};

const RECORD_HIGH = {
  main: { record: 44.2, all: 60.2, withNext: 17052 },
  breakdown: {
    districts: [
      { ko: "송파구", en: "Songpa-gu", record: 50.7, all: 60.1, withNext: 1500, enough: true },
      { ko: "노원구", en: "Nowon-gu", record: 33.6, all: 55, withNext: 80, enough: false },
      { ko: "강남구", en: "Gangnam-gu", record: 49.1, all: 57.8, withNext: 515, enough: true },
      { ko: "강북구", en: "Gangbuk-gu", record: 35.5, all: 58.8, withNext: 287, enough: true },
      { ko: "관악구", en: "Gwanak-gu", record: 37.2, all: 58, withNext: 400, enough: true },
      { ko: "동작구", en: "Dongjak-gu", record: 50.1, all: 59, withNext: 450, enough: true },
    ],
  },
};

const CANCELLATION = {
  months: ["202411", "202412", "202605"],
  seoul: { deals: 119831, cancelled: 1671, cancelledShare: 1.4 },
  districts: [
    { district: "송파구", deals: 5000, cancelled: 100, cancelledShare: 2 },
    { district: "노원구", deals: 50, cancelled: 1, cancelledShare: null },
  ],
};

const MOVE_IN = {
  seoul: {
    complexes: 108,
    units: 49668,
    from: "2026-07",
    to: "2028-06",
    districts: [
      { name: "서초구", complexes: 11, units: 12747 },
      { name: "송파구", complexes: 3, units: 1104 },
    ],
  },
  byDistrict: {
    rows: [
      { name: "종로구", units: [0, 0, 0, 0], rental: [0, 0, 0, 0] },
      { name: "송파구", units: [484, 0, 0, 620], rental: [484, 0, 0, 0] },
      { name: "서초구", units: [5231, 1300, 6056, 160], rental: [76, 1087, 342, 0] },
    ],
  },
};

const CONVERSION = {
  seoul: { rate: 4.8, pairs: 3366 },
  slugs: { 송파구: "songpa", 노원구: "nowon" },
  cells: [
    { district: "송파구", band: "60to85", rate: 4.5, pairs: 80 },
    { district: "송파구", band: "over85", rate: 4.1, pairs: 30 },
  ],
};

const DATA = { realestate: REALESTATE, recordHigh: RECORD_HIGH, cancellation: CANCELLATION, moveIn: MOVE_IN, conversion: CONVERSION };
const answers = (title, preview = null, data = DATA) =>
  buildContext({ title, preview }, data).filter((c) => c.kind !== "realestate");
const kinds = (title, preview = null, data = DATA) => answers(title, preview, data).map((c) => c.kind);

test("신고가 기사: 서울 전체는 서울 줄, 구 이름이 있으면 그 구 줄 (표본 넉넉한 구만)", () => {
  const [seoul] = answers("서울 아파트 신고가 행진, 매수세 몰린다");
  assert.equal(seoul.kind, "record-high");
  assert.equal(seoul.label, "서울 아파트 신고가 다음 거래");
  assert.equal(seoul.value, "그 값 이상 44.2%");
  assert.equal(seoul.href, "./record-high.html#breakdown-section");
  assert.equal(seoul.note, "신고가 17,052건 중 · 아무 거래 뒤는 60.2% · 관련 숫자 →");

  const [songpa] = answers("송파구 잠실 아파트 신고가 경신");
  assert.equal(songpa.label, "송파구 아파트 신고가 다음 거래");
  assert.equal(songpa.value, "그 값 이상 50.7%");
  assert.equal(songpa.labelEn, "Songpa-gu apartments: next sale after a record high");
  assert.equal(songpa.noteEn, "of 1,500 record highs · 60.1% after any sale · Related numbers →");
});

test("구 줄 표본이 모자라면 그 구 값을 쓰지 않고 서울 줄을 서울이라고 적어 붙인다", () => {
  const [chip] = answers("노원구 아파트 신고가");
  assert.equal(chip.label, "서울 아파트 신고가 다음 거래");
});

test("해제 기사: 서울 줄, 구 이름이 있고 표본이 넉넉하면 구 줄, 계약·거래 해제·취소만 센다", () => {
  const [seoul] = answers("서울 아파트 계약 해제 급증");
  assert.equal(seoul.kind, "cancellation");
  assert.equal(seoul.value, "1,671건 · 1.4%");
  assert.equal(seoul.note, "2024.11~2026.05 신고 119,831건 중 · 관련 숫자 →");
  assert.equal(seoul.href, "./cancelled-deals.html");

  const [songpa] = answers("송파 아파트 거래 취소 늘었다");
  assert.equal(songpa.label, "송파구 아파트 매매 계약 해제");
  assert.equal(songpa.href, "./cancelled-deals.html#district-section");

  assert.equal(answers("노원 아파트 계약 해제")[0].label, "서울 아파트 매매 계약 해제");
});

test("입주 물량 기사: 서울 합계, 구 합계(본문 문장과 같은 값), 예정 없는 구는 '예정 없음'", () => {
  const [seoul] = answers("서울 입주 폭탄 온다, 아파트 전세 불안");
  assert.equal(seoul.kind, "move-in");
  assert.equal(seoul.value, "49,668세대");
  assert.equal(seoul.note, "2026.07~2028.06 · 108개 단지 · 추정 · 관련 숫자 →");
  assert.equal(seoul.href, "./price-outlook.html#move-in-section");

  const [seocho] = answers("서초구 입주물량 급증…아파트 전셋값 영향은");
  assert.equal(seocho.value, "12,747세대");
  assert.equal(seocho.note, "2026.07~2028.06 · 11개 단지 · 그중 임대 1,505 · 추정 · 관련 숫자 →");
  assert.equal(seocho.href, "./price-outlook.html#move-in-districts");

  const [jongno] = answers("종로구 입주물량 없다 아파트");
  assert.equal(jongno.value, "예정 없음");
});

test("반전세·전환 기사: 서울 전환율, 구 이름이 있고 60~85㎡ 칸이 있으면 그 칸", () => {
  const [seoul] = answers("서울 반전세 확산, 월세 부담 커진다");
  assert.equal(seoul.kind, "conversion");
  assert.equal(seoul.value, "4.8%");
  assert.equal(seoul.href, "./jeonse-vs-wolse.html#rate-section");
  assert.equal(seoul.note, "같은 단지 전세·월세 3,366쌍 기준 · 관련 숫자 →");

  const [songpa] = answers("송파 반전세 늘었다, 월세 전환 가속");
  assert.equal(songpa.label, "송파구 60~85㎡ 전월세전환율");
  assert.equal(songpa.value, "4.5%");
  assert.equal(songpa.labelEn, "송파구 60-85㎡ jeonse-to-rent conversion rate");
});

test("증시 기사의 '신고가'는 부동산 답에 잇지 않는다", () => {
  assert.deepEqual(kinds("코스피 신고가 행진…서울 외국인 순매수"), []);
  assert.deepEqual(kinds("삼성전자 주가 신고가, 서울 증시 환호"), []);
  assert.deepEqual(kinds("코스닥 신고가 아파트 대신 주식"), []);
  // 부동산 신호어가 없는 신고가는 뭔지 모른다.
  assert.deepEqual(kinds("서울 금값 신고가"), []);
});

test("지방·서울이 아닌 곳 기사에는 서울 값을 붙이지 않는다", () => {
  assert.deepEqual(kinds("부산 아파트 신고가 속출"), []);
  assert.deepEqual(kinds("서울도 아닌데 아파트 신고가…이 도시"), []);
  assert.deepEqual(kinds("서울 아닌 경기 아파트 신고가"), []);
  assert.deepEqual(kinds("세종시 입주물량 0…성동구 얘기도 나온다"), []);
  assert.deepEqual(kinds("서울·경기 아파트 계약 해제 늘었다"), []);
  // 지역 표시가 아예 없으면 어디 얘기인지 모른다.
  assert.deepEqual(kinds("아파트 신고가 속출"), []);
});

test("자치구가 둘 이상이면 구를 고르지 않는다 - 서울이 있으면 서울 줄, 없으면 붙이지 않는다", () => {
  assert.deepEqual(kinds("강남 수억 내리고 강북은 신고가 아파트"), []);
  assert.equal(answers("강남 수억 내리고 강북은 신고가…서울 아파트")[0].label, "서울 아파트 신고가 다음 거래");
  // 단지 이름 속 구 이름(동작구 현대(관악))이 먼저 걸리던 사고 - 지금은 둘 다 세어 구를 고르지 않는다.
  assert.deepEqual(kinds("동작구 상도동 현대(관악) 10억 6500만원 최근 3년 신고가 아파트"), []);
});

test("분양·청약 계약 해제, 무관한 '해제', 키워드만 비슷한 '전환율'에는 붙이지 않는다", () => {
  assert.deepEqual(kinds("서울 아파트 분양 계약 해제 속출"), []);
  assert.deepEqual(kinds("서울 아파트 청약 당첨 계약 취소"), []);
  assert.deepEqual(kinds("서울 그린벨트 해제 아파트 공급"), []);
  assert.deepEqual(kinds("서울 광고 전환율 높이는 법"), []);
  assert.deepEqual(kinds("서울 입주 기업 모집"), []);
  assert.deepEqual(kinds("서울 입주 예정자 사전점검 아파트"), []);
});

test("키워드는 제목에서만 찾는다 - 미리보기에 곁다리로 나온 단어는 주제가 아니다", () => {
  assert.deepEqual(kinds("서울 아파트 시장 동향", "최근 일부 단지에서 신고가가 나왔지만 거래는 줄었다."), []);
  assert.deepEqual(kinds("서울 월세 부담", "반전세 비중이 늘었다."), []);
});

test("기사당 맥락 ≤2: 실거래 칩이 먼저, 새 답 칩이 남는 자리를 채운다", () => {
  const found = buildContext({ title: "서울 아파트 신고가에 입주물량 폭탄, 반전세·계약 해제까지" }, DATA);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((c) => c.kind), ["realestate", "record-high"]);

  const noPrice = buildContext({ title: "서울 아파트 신고가에 입주물량 폭탄, 반전세·계약 해제까지" }, { ...DATA, realestate: null });
  assert.deepEqual(noPrice.map((c) => c.kind), ["record-high", "cancellation"]);
});

test("데이터가 없거나 깨졌거나 읽다 던져도 기사와 다른 칩은 그대로다 (soft-fail)", () => {
  const item = { title: "서울 아파트 신고가 계약 해제 입주물량 반전세" };
  assert.deepEqual(buildContext(item, { realestate: REALESTATE }).map((c) => c.kind), ["realestate"]);
  assert.deepEqual(buildContext(item, {}), []);
  assert.deepEqual(buildContext(item), []);

  const broken = {
    realestate: REALESTATE,
    recordHigh: { main: "x", breakdown: { districts: 5 } },
    cancellation: { seoul: { cancelledShare: "1.4", cancelled: 1, deals: 2 }, districts: {} },
    moveIn: { seoul: null, byDistrict: null },
    conversion: [],
  };
  assert.deepEqual(buildContext(item, broken).map((c) => c.kind), ["realestate"]);

  const throwing = {
    realestate: REALESTATE,
    get recordHigh() {
      throw new Error("boom");
    },
    cancellation: CANCELLATION,
  };
  assert.deepEqual(buildContext(item, throwing).map((c) => c.kind), ["realestate", "cancellation"]);
});

test("값 문턱: 데이터가 비운 값(표본 부족)이나 서울 줄 문턱 미달은 붙이지 않는다", () => {
  const thin = { ...DATA, recordHigh: { ...RECORD_HIGH, main: { ...RECORD_HIGH.main, withNext: 99 } }, cancellation: { ...CANCELLATION, seoul: { ...CANCELLATION.seoul, cancelledShare: null } } };
  assert.deepEqual(kinds("서울 아파트 신고가", null, thin), []);
  assert.deepEqual(kinds("서울 아파트 계약 해제", null, thin), []);
});

test("금리·대출 값은 읽지도 적지도 않는다 (#577)", () => {
  const conversionWithRates = { ...CONVERSION, loan: { rate: 4.23, month: "2026-08" }, seoul: { ...CONVERSION.seoul, leadKo: "전세자금대출 평균금리는 4.23%입니다." } };
  const found = answers("서울 반전세 확산", null, { ...DATA, conversion: conversionWithRates });
  assert.equal(found.length, 1);
  assert.ok(!JSON.stringify(found).includes("금리"), `금리 문구가 칩에 있다: ${JSON.stringify(found)}`);
  assert.ok(!JSON.stringify(found).includes("4.23"));
  assert.ok(buildContext({ title: "서울 아파트 전세대출 금리 신고가" }, DATA).every((c) => c.kind !== "rates"));
});

test("attachContext 는 새 칩이 있어도 멱등이고, 붙일 게 없으면 context 를 만들지 않는다", () => {
  const news = { items: [{ title: "서울 아파트 신고가" }, { title: "국무회의 열려" }] };
  const once = attachContext(news, DATA);
  assert.deepEqual(attachContext(once, DATA), once);
  assert.ok(once.items[0].context.some((c) => c.kind === "record-high"));
  assert.ok(!("context" in once.items[1]));
});

test("프리렌더와 화면 렌더가 새 종류 칩을 그대로 그린다 (news.html 은 kind 를 읽지 않는다) - 한·영", async () => {
  const context = buildContext({ title: "송파구 아파트 신고가에 입주물량 폭탄" }, { ...DATA, realestate: null });
  assert.deepEqual(context.map((c) => c.kind), ["record-high", "move-in"]);

  const news = {
    updatedAt: new Date().toISOString(),
    items: [
      { title: "송파구 아파트 신고가에 입주물량 폭탄", titleEn: "Songpa record highs", link: "https://example.com/a", source: "가상경제", category: "realestate", publishedAt: new Date().toISOString(), context },
    ],
  };

  const ko = await loadNewsPage({ news, summary: { categories: [] } });
  const koHtml = ko.newsListHtml();
  assert.ok(koHtml.includes(newsContextHtml(context)), "화면 렌더가 칩을 다르게 그린다");
  assert.ok(newsListHtml(news).includes(newsContextHtml(context)), "프리렌더에 칩이 없다");
  assert.ok(koHtml.includes("송파구 아파트 신고가 다음 거래") && koHtml.includes("관련 숫자 →"));
  assert.ok(koHtml.includes('href="./record-high.html#breakdown-section"'));

  const en = await loadNewsPage({ news, summary: { categories: [] }, locale: "en" });
  const enHtml = en.newsListHtml();
  assert.ok(enHtml.includes("Songpa-gu apartments: next sale after a record high"));
  assert.ok(enHtml.includes("Related numbers →"));
  assert.ok(!enHtml.includes("관련 숫자"), "영어 화면에 한국어 문구가 남았다");

  const source = await readText("docs/news.html");
  assert.ok(!/\.kind\b/.test(source), "news.html 이 칩 kind 를 읽기 시작했다 - 새 종류가 바이트 없이 그려진다는 전제가 깨졌다");
});

test("칩이 가리키는 화면 자리(id)가 모두 있다", async () => {
  const anchors = [
    ["docs/record-high.html", "breakdown-section"],
    ["docs/cancelled-deals.html", "district-section"],
    ["docs/price-outlook.html", "move-in-section"],
    ["docs/price-outlook.html", "move-in-districts"],
    ["docs/jeonse-vs-wolse.html", "rate-section"],
  ];
  for (const [file, id] of anchors) {
    assert.ok((await readText(file)).includes(`id="${id}"`), `${file} 에 #${id} 가 없다`);
  }
});

test("실제 산출물 값을 그대로 쓴다 - 서울 신고가·해제·입주·전환율 칩", async () => {
  const [recordHigh, cancellation, moveIn, conversion] = await Promise.all(["record-high", "cancellation", "move-in", "conversion"].map(readJson));
  const real = { recordHigh, cancellation, moveIn, conversion };

  const chips = Object.fromEntries(
    [
      ["record-high", "서울 아파트 신고가"],
      ["cancellation", "서울 아파트 계약 해제"],
      ["move-in", "서울 입주 폭탄 아파트"],
      ["conversion", "서울 반전세 아파트"],
    ].map(([kind, title]) => [kind, buildContext({ title }, real).find((c) => c.kind === kind)])
  );

  assert.equal(chips["record-high"]?.value, `그 값 이상 ${recordHigh.main.record}%`);
  assert.ok(chips.cancellation?.value.endsWith(`${cancellation.seoul.cancelledShare}%`));
  assert.equal(chips["move-in"]?.value, `${moveIn.seoul.units.toLocaleString("ko-KR")}세대`);
  assert.equal(chips.conversion?.value, `${conversion.seoul.rate}%`);
});
