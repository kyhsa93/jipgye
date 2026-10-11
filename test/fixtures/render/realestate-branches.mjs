// 첫 화면 실거래 요약 표(realestateHtml)의 분기별 고정 fixture (#241 PR 3). 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3):
// 저장소의 docs/·docs/data를 읽지 않고, 코드(realestate-rows.mjs 등)도 부르지 않는다.
// 한 줄이 한 분기다. `args`는 legacy 함수에 그대로 넘기는 인자이고, `expect`는 legacy가 내야 하는 글자다.
// 기대값은 손으로 적었다 - 아래 `tr`·`CELL`은 기대 글자를 앞뒤로 감쌀 뿐 입력을 읽거나 계산하지 않는다.
// test/render-parity.test.mjs가 이 표로 (1) legacy 출력이 expect와 같은지, (2) React 조각이 legacy와 바이트까지 같은지 견준다.
//
// DIRECTION 해자 2의 분기(표본이 모자라면 값을 내지 않고 "표본 N건"이라 적는다)가 이 표의 `l`행이다. 전부 같은 모양의 값 행을 가진다
// (#240·#241 PR 1·2 교훈 - `String()`을 빼도 시험이 통과하는 자리를 닫는다):
//  - 비문자열: false·true·{}·[]·[1,2]·숫자 (이름·건수·값·증감·월세 자리마다)
//  - null·undefined, 특수문자 & < > " ', 빈 값 행(지표가 없는 칸·값이 없는 칸·빈 자치구)

const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`;

const tr = (name, sale, jeonse, wolse) =>
  `<tr><td>${name}</td><td data-label="매매">${sale}</td><td data-label="전세">${jeonse}</td><td data-label="월세">${wolse}</td></tr>`;
const ALL_DASH = (name) => tr(name, "-", "-", "-");
const OVERALL = "서울 전체";

// 기대 칸(손으로 적은 글자). 값 5,530 / 증감 +361 / 건수 684.
const LOW = (n) => `<span class="low-sample" title="신고 ${n}건이라 평균을 내기엔 표본이 부족합니다">표본 ${n}건</span>`;
const CHANGE = (t) => ` <span class="change">${t}</span>`;
const COUNT = (t) => ` <span class="count">${t}</span>`;

// ================= 칸 한 개(매매·전세·월세 각각) =================
// 값 필드 이름: 매매 avgPricePerPyeong10k, 전세 avgDepositPerPyeong10k, 월세 avgDeposit10k.
const KINDS = [
  { kind: "sale", tag: "S", field: "avgPricePerPyeong10k", other: "avgDepositPerPyeong10k", withChange: true },
  { kind: "jeonse", tag: "J", field: "avgDepositPerPyeong10k", other: "avgPricePerPyeong10k", withChange: true },
  { kind: "wolse", tag: "W", field: "avgDeposit10k", other: "avgPricePerPyeong10k", withChange: false },
];
// 칸 하나만 채운 데이터: 다른 두 칸은 지표가 없어 "-".
const cellRow = (kind, expectCell, name = OVERALL) =>
  tr(name, kind === "sale" ? expectCell : "-", kind === "jeonse" ? expectCell : "-", kind === "wolse" ? expectCell : "-");
const only = (kind, metric) => ({ overall: { [kind]: metric } });

// [id 뒤 번호, 조건, 지표 spec(count·change·value 키만), 종류별 기대 칸]
// 매매·전세 기대: "5,530만원" + 증감 + 건수. 월세 기대: "5,530만원 / 월 120만원" + 건수(증감 없음).
const BASE = { sale: "5,530만원", jeonse: "5,530만원", wolse: "5,530만원 / 월 120만원" };
const chg = (kind, text) => (kind === "wolse" ? "" : CHANGE(text));

// 값 칸(표본이 충분하다)과 건수·증감 분기. 모든 종류에 적용: 증감은 월세에서 빠진다.
const VALUE_ROWS = [
  ["c01", "표본 충분·증감 +·건수", { count: 684, change: { value10k: 361 } }, (k) => BASE[k] + chg(k, "+361만") + COUNT("684건")],
  ["c02", "증감 음수(-)", { count: 684, change: { value10k: -25 } }, (k) => BASE[k] + chg(k, "-25만") + COUNT("684건")],
  ["c03", "증감 0 → 부호 없음", { count: 684, change: { value10k: 0 } }, (k) => BASE[k] + chg(k, "0만") + COUNT("684건")],
  ["c04", "증감 -0 → 부호 없음", { count: 684, change: { value10k: -0 } }, (k) => BASE[k] + chg(k, "0만") + COUNT("684건")],
  ["c05", "증감 없음(undefined)", { count: 684 }, (k) => BASE[k] + COUNT("684건")],
  ["c06", "증감 null", { count: 684, change: null }, (k) => BASE[k] + COUNT("684건")],
  ["c07", "증감이 {}(value10k 없음)", { count: 684, change: {} }, (k) => BASE[k] + COUNT("684건")],
  ["c08", "증감 value10k가 문자열 \"361\" → 숫자가 아니라 증감 없음", { count: 684, change: { value10k: "361" } }, (k) => BASE[k] + COUNT("684건")],
  ["c09", "증감 value10k가 null → 증감 없음", { count: 684, change: { value10k: null } }, (k) => BASE[k] + COUNT("684건")],
  ["c10", "증감 value10k가 NaN(숫자라 낸다) → \"NaN만\"", { count: 684, change: { value10k: NaN } }, (k) => BASE[k] + chg(k, "NaN만") + COUNT("684건")],
  ["c11", "증감 소수 1234.5 → \"+1,234.5만\"", { count: 684, change: { value10k: 1234.5 } }, (k) => BASE[k] + chg(k, "+1,234.5만") + COUNT("684건")],
  ["c12", "증감 12345 → 천 단위 쉼표 \"+12,345만\"", { count: 684, change: { value10k: 12345 } }, (k) => BASE[k] + chg(k, "+12,345만") + COUNT("684건")],
  ["c13", "증감이 문자열 \"x\"(truthy 비객체) → 증감 없음", { count: 684, change: "x" }, (k) => BASE[k] + COUNT("684건")],
  ["c14", "증감이 숫자 5(truthy 비객체) → 증감 없음", { count: 684, change: 5 }, (k) => BASE[k] + COUNT("684건")],
  ["c15", "증감이 false → 증감 없음", { count: 684, change: false }, (k) => BASE[k] + COUNT("684건")],
  ["c16", "증감 value10k Infinity → \"+∞만\"", { count: 684, change: { value10k: Infinity } }, (k) => BASE[k] + chg(k, "+∞만") + COUNT("684건")],
  ["c17", "증감 value10k {} → 증감 없음", { count: 684, change: { value10k: {} } }, (k) => BASE[k] + COUNT("684건")],
  ["c20", "건수 5(문턱 경계, 충분) → 값 + \"5건\"", { count: 5 }, (k) => BASE[k] + COUNT("5건")],
  ["c21", "건수 1234567 → 쉼표 \"1,234,567건\"", { count: 1234567 }, (k) => BASE[k] + COUNT("1,234,567건")],
  ["c22", "건수가 문자열 \"7\"(\"7\">=5라 충분, 숫자가 아니라 건수 줄 없음)", { count: "7" }, (k) => BASE[k]],
  ["c23", "건수가 배열 [7](7>=5라 충분, 건수 줄 없음)", { count: [7] }, (k) => BASE[k]],
  ["c24", "건수 Infinity(충분) → \"∞건\"", { count: Infinity }, (k) => BASE[k] + COUNT("∞건")],
  ["c25", "건수 5.5(충분) → \"5.5건\"", { count: 5.5 }, (k) => BASE[k] + COUNT("5.5건")],
]; 

// 표본 부족: 값이 있어도 내지 않고 "표본 N건"(건수는 그대로 글자로). 모든 종류에 같다.
const LOW_ROWS = [
  ["l01", "건수 4(문턱 바로 아래) → \"표본 4건\"", { count: 4, change: { value10k: 361 } }, `<span class="low-sample" title="신고 4건이라 평균을 내기엔 표본이 부족합니다">표본 4건</span>`],
  ["l02", "건수 0", { count: 0 }, LOW(0)],
  ["l03", "건수 1", { count: 1 }, LOW(1)],
  ["l04", "건수 없음(undefined) → \"표본 undefined건\"", {}, LOW("undefined")],
  ["l05", "건수 null → \"표본 null건\"", { count: null }, LOW("null")],
  ["l06", "건수 -1", { count: -1 }, LOW(-1)],
  ["l07", "건수 4.5", { count: 4.5 }, LOW("4.5")],
  ["l08", "건수 NaN → \"표본 NaN건\"", { count: NaN }, LOW("NaN")],
  ["l09", "건수가 문자열 \"3\"", { count: "3" }, LOW("3")],
  ["l10", "건수가 문자열 \"abc\"(NaN 비교라 부족)", { count: "abc" }, LOW("abc")],
  ["l11", "건수 false → \"표본 false건\"", { count: false }, LOW("false")],
  ["l12", "건수 true → \"표본 true건\"", { count: true }, LOW("true")],
  ["l13", "건수 {} → \"표본 [object Object]건\"", { count: {} }, LOW("[object Object]")],
  ["l14", "건수 [] → \"표본 건\"(빈 글자)", { count: [] }, LOW("")],
  ["l15", "건수 [3] → \"표본 3건\"", { count: [3] }, LOW("3")],
  ["l16", "건수가 빈 문자열 → \"표본 건\"", { count: "" }, LOW("")],
  ["l17", "값이 없어도 표본 부족이 먼저(건수 4, 값 0)", { count: 4, value: 0 }, LOW(4)],
  ["l18", "건수 [1,2](\"1,2\">=5 는 NaN이라 부족) → \"표본 1,2건\"", { count: [1, 2] }, LOW("1,2")],
];

// 칸이 없거나 값이 없다 → "-". 지표 자체가 없는 것(m)과 값이 없는 것(v).
const NONE_METRICS = [
  ["m01", "지표가 없다(undefined)", undefined],
  ["m02", "지표 null", null],
  ["m03", "지표 0", 0],
  ["m04", "지표 빈 문자열", ""],
  ["m05", "지표 false", false],
];
// 값이 falsy면 "-"(표본은 충분하다)
const NO_VALUE = [
  ["v01", "값 0 → \"-\"", 0],
  ["v02", "값 null → \"-\"", null],
  ["v03", "값 undefined → \"-\"", undefined],
  ["v04", "값 빈 문자열 → \"-\"", ""],
  ["v05", "값 false → \"-\"", false],
  ["v06", "값 NaN(falsy) → \"-\"", NaN],
];
// 값이 truthy인데 숫자가 아니거나 모양이 특이한 것: legacy는 Number()를 거쳐 낸다(월세 칸은 앞쪽 값이라 "<값> / 월 120만원").
const ODD_VALUES = [
  ["o01", "값이 문자열 \"5530\" → \"5,530만원\"", "5530", "5,530만원"],
  ["o02", "값이 문자열 \"abc\" → \"NaN만원\"", "abc", "NaN만원"],
  ["o03", "값 true → \"1만원\"", true, "1만원"],
  ["o04", "값 {} → \"NaN만원\"", {}, "NaN만원"],
  ["o05", "값 [12] → \"12만원\"", [12], "12만원"],
  ["o06", "값 [](truthy) → \"0만원\"", [], "0만원"],
  ["o07", "값 1234.5678 → 소수 셋째 자리까지 \"1,234.568만원\"", 1234.5678, "1,234.568만원"],
  ["o08", "값 -5 → \"-5만원\"", -5, "-5만원"],
  ["o09", "값 Infinity → \"∞만원\"", Infinity, "∞만원"],
  ["o10", "값 0.5 → \"0.5만원\"", 0.5, "0.5만원"],
  ["o11", "값 [1,2] → \"NaN만원\"", [1, 2], "NaN만원"],
];

// 지표 입력 도우미: spec에 적은 키만 넣는다(`count`가 없으면 transactionCount 자체가 없고, `value`가 없으면 5530). 월세는 월세 자리(120)를 더한다.
const buildMetric = (k, spec) => {
  const m = { [k.field]: "value" in spec ? spec.value : 5530 };
  if (k.kind === "wolse") m.avgMonthlyRent10k = 120;
  if ("count" in spec) m.transactionCount = spec.count;
  if ("change" in spec) m.change = spec.change;
  return m;
};

const CELL_ROWS = KINDS.flatMap((k) => {
  const rows = [];
  for (const [no, cond, spec, expectOf] of VALUE_ROWS) {
    rows.push({ id: `${k.tag}-${no}`, fn: "realestateHtml", cond: `${k.kind}: ${cond}`, args: [only(k.kind, buildMetric(k, spec))], expect: cellRow(k.kind, expectOf(k.kind)) });
  }
  for (const [no, cond, spec, expectCell] of LOW_ROWS) {
    rows.push({ id: `${k.tag}-${no}`, fn: "realestateHtml", cond: `${k.kind}: ${cond}`, args: [only(k.kind, buildMetric(k, spec))], expect: cellRow(k.kind, expectCell) });
  }
  for (const [no, cond, metric] of NONE_METRICS) {
    rows.push({ id: `${k.tag}-${no}`, fn: "realestateHtml", cond: `${k.kind}: ${cond} → "-"`, args: [only(k.kind, metric)], expect: ALL_DASH(OVERALL) });
  }
  for (const [no, cond, value] of NO_VALUE) {
    rows.push({ id: `${k.tag}-${no}`, fn: "realestateHtml", cond: `${k.kind}: ${cond}`, args: [only(k.kind, buildMetric(k, { count: 10, value }))], expect: ALL_DASH(OVERALL) });
  }
  for (const [no, cond, value, text] of ODD_VALUES) {
    const tail = k.kind === "wolse" ? " / 월 120만원" : "";
    rows.push({ id: `${k.tag}-${no}`, fn: "realestateHtml", cond: `${k.kind}: ${cond}`, args: [only(k.kind, buildMetric(k, { count: 10, value }))], expect: cellRow(k.kind, text + tail + COUNT("10건")) });
  }
  // 이 칸의 값 필드가 아닌 다른 필드만 있으면 "-"(필드가 섞이지 않는다)
  rows.push({
    id: `${k.tag}-f01`,
    fn: "realestateHtml",
    cond: `${k.kind}: 다른 종류의 값 필드(${k.other})만 있으면 이 칸은 "-"`,
    args: [only(k.kind, { [k.other]: 7777, transactionCount: 10 })],
    expect: ALL_DASH(OVERALL),
  });
  return rows;
});

// 월세 칸만의 분기: 월세 자리(avgMonthlyRent10k)와 증감을 내지 않는 것
const WOLSE_ROWS = [
  ["w01", "정상: 보증금·월세·건수", { avgDeposit10k: 19312, avgMonthlyRent10k: 113, transactionCount: 966 }, "19,312만원 / 월 113만원" + COUNT("966건")],
  ["w02", "증감이 있어도 월세 칸은 증감을 내지 않는다", { avgDeposit10k: 5000, avgMonthlyRent10k: 100, transactionCount: 50, change: { value10k: 400 } }, "5,000만원 / 월 100만원" + COUNT("50건")],
  ["w03", "월세 자리가 없다(undefined) → \"월 NaN만원\"", { avgDeposit10k: 5000, transactionCount: 50 }, "5,000만원 / 월 NaN만원" + COUNT("50건")],
  ["w04", "월세 null → Number(null)=0 → \"월 0만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: null, transactionCount: 50 }, "5,000만원 / 월 0만원" + COUNT("50건")],
  ["w05", "월세 0 → \"월 0만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: 0, transactionCount: 50 }, "5,000만원 / 월 0만원" + COUNT("50건")],
  ["w06", "월세가 문자열 \"abc\" → \"월 NaN만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: "abc", transactionCount: 50 }, "5,000만원 / 월 NaN만원" + COUNT("50건")],
  ["w07", "월세가 문자열 \"113\" → \"월 113만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: "113", transactionCount: 50 }, "5,000만원 / 월 113만원" + COUNT("50건")],
  ["w08", "월세 false → \"월 0만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: false, transactionCount: 50 }, "5,000만원 / 월 0만원" + COUNT("50건")],
  ["w09", "월세 {} → \"월 NaN만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: {}, transactionCount: 50 }, "5,000만원 / 월 NaN만원" + COUNT("50건")],
  ["w10", "월세 [1,2] → \"월 NaN만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: [1, 2], transactionCount: 50 }, "5,000만원 / 월 NaN만원" + COUNT("50건")],
  ["w11", "월세 1234.5 → \"월 1,234.5만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: 1234.5, transactionCount: 50 }, "5,000만원 / 월 1,234.5만원" + COUNT("50건")],
  ["w12", "월세 true → \"월 1만원\"", { avgDeposit10k: 5000, avgMonthlyRent10k: true, transactionCount: 50 }, "5,000만원 / 월 1만원" + COUNT("50건")],
];

const WOLSE_CELL_ROWS = WOLSE_ROWS.map(([no, cond, metric, cell]) => ({ id: `W-${no}`, fn: "realestateHtml", cond: `wolse: ${cond}`, args: [only("wolse", metric)], expect: cellRow("wolse", cell) }));

// 한 줄에 세 칸이 서로 다른 모양(칸 자리가 섞이지 않는다): 매매 표본 부족, 전세 값, 월세 없음
const MIXED_ROWS = [
  {
    id: "X-01",
    fn: "realestateHtml",
    cond: "한 줄에 세 칸이 다른 모양: 매매 표본 부족·전세 값·월세 지표 없음",
    args: [{ overall: { sale: { avgPricePerPyeong10k: 9000, transactionCount: 2 }, jeonse: { avgDepositPerPyeong10k: 3031, transactionCount: 547, change: { value10k: -25 } } } }],
    expect: tr(OVERALL, LOW(2), "3,031만원" + CHANGE("-25만") + COUNT("547건"), "-"),
  },
  {
    id: "X-02",
    fn: "realestateHtml",
    cond: "한 줄에 세 칸이 다른 모양: 매매 값·전세 없음·월세 표본 부족",
    args: [{ overall: { sale: { avgPricePerPyeong10k: 5530, transactionCount: 684, change: { value10k: 361 } }, jeonse: null, wolse: { avgDeposit10k: 19312, avgMonthlyRent10k: 113, transactionCount: 3 } } }],
    expect: tr(OVERALL, "5,530만원" + CHANGE("+361만") + COUNT("684건"), "-", LOW(3)),
  },
  {
    id: "X-03",
    fn: "realestateHtml",
    cond: "세 칸 모두 표본 부족(건수가 칸마다 다르다)",
    args: [{ overall: { sale: { avgPricePerPyeong10k: 1, transactionCount: 1 }, jeonse: { avgDepositPerPyeong10k: 2, transactionCount: 2 }, wolse: { avgDeposit10k: 3, avgMonthlyRent10k: 3, transactionCount: 3 } } }],
    expect: tr(OVERALL, LOW(1), LOW(2), LOW(3)),
  },
  {
    id: "X-04",
    fn: "realestateHtml",
    cond: "세 칸 모두 값(서울 전체 실제 모양)",
    args: [{ overall: { sale: { avgPricePerPyeong10k: 5530, transactionCount: 684, change: { value10k: 361 } }, jeonse: { avgDepositPerPyeong10k: 3031, transactionCount: 547, change: { value10k: -25 } }, wolse: { avgDeposit10k: 19312, avgMonthlyRent10k: 113, transactionCount: 966 } } }],
    expect: tr(OVERALL, "5,530만원" + CHANGE("+361만") + COUNT("684건"), "3,031만원" + CHANGE("-25만") + COUNT("547건"), "19,312만원 / 월 113만원" + COUNT("966건")),
  },
];

// ================= 데이터 없음·서울 전체 줄 =================
const NONE_ROWS = [
  { id: "N-01", cond: "데이터가 null → null", args: [null], expect: null },
  { id: "N-02", cond: "데이터가 undefined → null", args: [undefined], expect: null },
  { id: "N-03", cond: "빈 객체(overall 없음) → null", args: [{}], expect: null },
  { id: "N-04", cond: "overall 없이 자치구만 있어도 → null", args: [{ districts: [{ name: "종로구", sale: { avgPricePerPyeong10k: 1, transactionCount: 9 } }] }], expect: null },
  { id: "N-05", cond: "overall이 null → null", args: [{ overall: null }], expect: null },
  { id: "N-06", cond: "overall이 0(falsy) → null", args: [{ overall: 0 }], expect: null },
  { id: "N-07", cond: "overall이 빈 문자열 → null", args: [{ overall: "" }], expect: null },
  { id: "N-08", cond: "overall이 false → null", args: [{ overall: false }], expect: null },
  { id: "N-09", cond: "overall이 NaN(falsy) → null", args: [{ overall: NaN }], expect: null },
  { id: "N-10", cond: "overall이 빈 객체(truthy)면 서울 전체 한 줄이 세 칸 모두 \"-\"", args: [{ overall: {} }], expect: ALL_DASH(OVERALL) },
  { id: "N-11", cond: "overall이 숫자 5(truthy 비객체)면 세 칸 모두 \"-\"", args: [{ overall: 5 }], expect: ALL_DASH(OVERALL) },
  { id: "N-12", cond: "overall이 문자열 \"x\"면 세 칸 모두 \"-\"", args: [{ overall: "x" }], expect: ALL_DASH(OVERALL) },
  { id: "N-13", cond: "overall이 true면 세 칸 모두 \"-\"", args: [{ overall: true }], expect: ALL_DASH(OVERALL) },
  { id: "N-14", cond: "overall이 빈 배열(truthy)이면 세 칸 모두 \"-\"", args: [{ overall: [] }], expect: ALL_DASH(OVERALL) },
  { id: "N-15", cond: "자치구 목록이 없다(undefined) → 서울 전체 한 줄", args: [{ overall: {} }], expect: ALL_DASH(OVERALL) },
  { id: "N-16", cond: "자치구 목록이 null → 서울 전체 한 줄", args: [{ overall: {}, districts: null }], expect: ALL_DASH(OVERALL) },
  { id: "N-17", cond: "자치구 목록이 빈 배열 → 서울 전체 한 줄", args: [{ overall: {}, districts: [] }], expect: ALL_DASH(OVERALL) },
  { id: "N-18", cond: "자치구 목록이 빈 문자열(펼칠 항목 없음) → 서울 전체 한 줄", args: [{ overall: {}, districts: "" }], expect: ALL_DASH(OVERALL) },
  { id: "N-19", cond: "자치구 목록이 문자열 \"ab\"면 글자마다 이름 없는 빈 행", args: [{ overall: {}, districts: "ab" }], expect: ALL_DASH(OVERALL) + ALL_DASH("") + ALL_DASH("") },
].map((r) => ({ fn: "realestateHtml", ...r }));

// ================= 자치구: 정렬·자름·이름 =================
// 입력 도우미: 매매 평당가와 건수만 가진 자치구. 기대 칸은 직접 적는다.
const d = (name, price, count = 10) => ({ name, sale: { avgPricePerPyeong10k: price, transactionCount: count } });
const dRow = (name, text) => tr(name, text, "-", "-");
const sale10 = (text) => `${text}${COUNT("10건")}`;
const OV = ALL_DASH(OVERALL);
const withDistricts = (districts) => [{ overall: {}, districts }];

const DISTRICT_ROWS = [
  {
    id: "D-01",
    cond: "매매 평당가가 높은 순으로 정렬한다(입력은 낮은 순)",
    args: withDistricts([d("가", 3000), d("나", 5000), d("다", 4000)]),
    expect: OV + dRow("나", sale10("5,000만원")) + dRow("다", sale10("4,000만원")) + dRow("가", sale10("3,000만원")),
  },
  {
    id: "D-02",
    cond: "평당가가 같으면 들어온 순서를 지킨다(안정 정렬)",
    args: withDistricts([d("가", 3000), d("나", 3000), d("다", 3000), d("라", 9000)]),
    expect: OV + dRow("라", sale10("9,000만원")) + dRow("가", sale10("3,000만원")) + dRow("나", sale10("3,000만원")) + dRow("다", sale10("3,000만원")),
  },
  {
    id: "D-03",
    cond: "여섯 곳이면 앞에서 MAX_DISTRICTS(4)곳만 그린다",
    args: withDistricts([d("a", 1000), d("b", 6000), d("c", 2000), d("d", 5000), d("e", 3000), d("f", 4000)]),
    expect: OV + dRow("b", sale10("6,000만원")) + dRow("d", sale10("5,000만원")) + dRow("f", sale10("4,000만원")) + dRow("e", sale10("3,000만원")),
  },
  {
    id: "D-04",
    cond: "정확히 네 곳이면 전부 그린다",
    args: withDistricts([d("a", 1000), d("b", 4000), d("c", 2000), d("d", 3000)]),
    expect: OV + dRow("b", sale10("4,000만원")) + dRow("d", sale10("3,000만원")) + dRow("c", sale10("2,000만원")) + dRow("a", sale10("1,000만원")),
  },
  {
    id: "D-05",
    cond: "네 곳 아래(둘)면 있는 만큼만 그린다",
    args: withDistricts([d("a", 1000), d("b", 2000)]),
    expect: OV + dRow("b", sale10("2,000만원")) + dRow("a", sale10("1,000만원")),
  },
  {
    id: "D-06",
    cond: "다섯째로 밀려난 곳은 이름에 특수문자가 있어도 나오지 않는다",
    args: withDistricts([d("a", 5000), d("b", 4000), d("c", 3000), d("d", 2000), d(SP, 1000)]),
    expect: OV + dRow("a", sale10("5,000만원")) + dRow("b", sale10("4,000만원")) + dRow("c", sale10("3,000만원")) + dRow("d", sale10("2,000만원")),
  },
  {
    id: "D-07",
    cond: "표본 부족인 곳은 평당가가 커도 값이 없는 것으로 쳐 뒤로(건수 4 → 표본 4건), 값이 없는 곳끼리는 들어온 순서",
    args: withDistricts([{ name: "부족", sale: { avgPricePerPyeong10k: 99999, transactionCount: 4 } }, d("정상", 100), { name: "지표없음" }, { name: "값없음", sale: { transactionCount: 10 } }]),
    expect:
      OV +
      dRow("정상", sale10("100만원")) +
      dRow("부족", LOW(4)) +
      tr("지표없음", "-", "-", "-") +
      dRow("값없음", "-"),
  },
  {
    id: "D-08",
    cond: "값이 없는 곳이 값이 있는 곳 앞에 들어와도 값 있는 곳이 앞으로(x가 null이면 뒤)",
    args: withDistricts([{ name: "없음" }, d("있음", 100)]),
    expect: OV + dRow("있음", sale10("100만원")) + tr("없음", "-", "-", "-"),
  },
  {
    id: "D-09",
    cond: "값이 있는 곳이 값 없는 곳 앞에 들어오면 그대로(y가 null이면 앞)",
    args: withDistricts([d("있음", 100), { name: "없음" }]),
    expect: OV + dRow("있음", sale10("100만원")) + tr("없음", "-", "-", "-"),
  },
  {
    id: "D-10",
    cond: "평당가 0(표본은 충분)은 값은 있는 것으로 쳐 null 앞에 서고, 칸은 \"-\"",
    args: withDistricts([{ name: "없음" }, d("영", 0), d("백", 100)]),
    expect: OV + dRow("백", sale10("100만원")) + dRow("영", "-") + tr("없음", "-", "-", "-"),
  },
  {
    id: "D-11",
    cond: "평당가가 문자열 \"9000\"이어도 숫자 비교로 정렬한다(칸은 \"9,000만원\")",
    args: withDistricts([d("오천", 5000), d("구천", "9000")]),
    expect: OV + dRow("구천", sale10("9,000만원")) + dRow("오천", sale10("5,000만원")),
  },
  {
    id: "D-12",
    cond: "평당가가 음수여도 정렬은 값으로 한다",
    args: withDistricts([d("음수", -5), d("영보다 큼", 5)]),
    expect: OV + dRow("영보다 큼", sale10("5만원")) + dRow("음수", sale10("-5만원")),
  },
  {
    id: "D-13",
    cond: "건수가 5(문턱)인 곳은 정렬에서 값으로 센다, 4인 곳은 null로 센다",
    args: withDistricts([d("넷", 9000, 4), d("다섯", 100, 5)]),
    expect: OV + dRow("다섯", "100만원" + COUNT("5건")) + dRow("넷", LOW(4)),
  },
  {
    id: "D-14",
    cond: "매매 지표가 falsy(0·\"\"·null·false)인 곳은 정렬에서 null, 칸은 \"-\"",
    args: withDistricts([{ name: "영", sale: 0 }, { name: "빈", sale: "" }, { name: "널", sale: null }, d("값", 10)]),
    expect: OV + dRow("값", sale10("10만원")) + tr("영", "-", "-", "-") + tr("빈", "-", "-", "-") + tr("널", "-", "-", "-"),
  },
  {
    id: "D-15",
    cond: "자치구 줄의 전세·월세 칸도 칸마다 자기 지표를 읽는다",
    args: withDistricts([{ name: "종로구", sale: { avgPricePerPyeong10k: 4000, transactionCount: 12, change: { value10k: -7 } }, jeonse: { avgDepositPerPyeong10k: 2500, transactionCount: 3 }, wolse: { avgDeposit10k: 8000, avgMonthlyRent10k: 90, transactionCount: 20 } }]),
    expect: OV + tr("종로구", "4,000만원" + CHANGE("-7만") + COUNT("12건"), LOW(3), "8,000만원 / 월 90만원" + COUNT("20건")),
  },
  {
    id: "D-16",
    cond: "빈 객체 자치구는 이름도 칸도 비어 있다",
    args: withDistricts([{}]),
    expect: OV + ALL_DASH(""),
  },
  {
    id: "D-17",
    cond: "이름만 있는 자치구는 세 칸 모두 \"-\"",
    args: withDistricts([{ name: "종로구" }]),
    expect: OV + ALL_DASH("종로구"),
  },
  {
    id: "D-18",
    cond: "서울 전체와 자치구가 같이 있다(실제 모양: 전체 값·자치구 정렬·다섯째 자름)",
    args: [
      {
        overall: { sale: { avgPricePerPyeong10k: 5530, transactionCount: 684, change: { value10k: 361 } }, jeonse: { avgDepositPerPyeong10k: 3031, transactionCount: 547, change: { value10k: -25 } }, wolse: { avgDeposit10k: 19312, avgMonthlyRent10k: 113, transactionCount: 966 } },
        districts: [d("노원구", 2860, 80), d("강남구", 11276, 141), d("서초구", 10100, 90), d("용산구", 9900, 3), d("송파구", 8000, 120)],
      },
    ],
    expect:
      tr(OVERALL, "5,530만원" + CHANGE("+361만") + COUNT("684건"), "3,031만원" + CHANGE("-25만") + COUNT("547건"), "19,312만원 / 월 113만원" + COUNT("966건")) +
      dRow("강남구", "11,276만원" + COUNT("141건")) +
      dRow("서초구", "10,100만원" + COUNT("90건")) +
      dRow("송파구", "8,000만원" + COUNT("120건")) +
      dRow("노원구", "2,860만원" + COUNT("80건")) ,
  },
];

// 이름 자리: 특수문자는 이스케이프, 비문자열은 String()처럼(false → "false"), null·undefined는 빈 글자. 서울 전체 줄의 이름은 고정이다.
const NAMES = [
  ["a01", "특수문자 & < > \" '", SP, SP_OUT],
  ["a02", "이미 이스케이프된 글자는 한 번 더(&amp; → &amp;amp;)", "a&amp;b", "a&amp;amp;b"],
  ["a03", "false → \"false\"", false, "false"],
  ["a04", "true → \"true\"", true, "true"],
  ["a05", "{} → \"[object Object]\"", {}, "[object Object]"],
  ["a06", "[] → 빈 글자", [], ""],
  ["a07", "[1,2] → \"1,2\"", [1, 2], "1,2"],
  ["a08", "숫자 0 → \"0\"", 0, "0"],
  ["a09", "숫자 7 → \"7\"", 7, "7"],
  ["a10", "null → 빈 글자", null, ""],
  ["a11", "undefined(이름 없음) → 빈 글자", undefined, ""],
  ["a12", "빈 문자열 → 빈 글자", "", ""],
  ["a13", "NaN → \"NaN\"", NaN, "NaN"],
  ["a14", "한글·이모지·개행은 그대로", "중구 😀\n", "중구 😀\n"],
  ["a15", "작은따옴표만(React의 &#x27;은 래퍼가 되돌린다)", "it's", "it's"],
  ["a16", "큰따옴표·꺾쇠 한 줄(태그처럼 보이는 글)", `<b>"굵게"</b>`, "&lt;b&gt;&quot;굵게&quot;&lt;/b&gt;"],
];
const NAME_ROWS = NAMES.map(([no, cond, name, out]) => ({
  id: `D-${no}`,
  cond: `자치구 이름: ${cond}`,
  args: withDistricts([{ name, sale: { avgPricePerPyeong10k: 1000, transactionCount: 10 } }]),
  expect: OV + dRow(out, sale10("1,000만원")),
}));

export const REALESTATE_BRANCHES = [
  ...NONE_ROWS,
  ...CELL_ROWS,
  ...WOLSE_CELL_ROWS,
  ...MIXED_ROWS,
  ...DISTRICT_ROWS.map((r) => ({ fn: "realestateHtml", ...r })),
  ...NAME_ROWS.map((r) => ({ fn: "realestateHtml", ...r })),
];

// 알려진 차이(허용 변환 밖): 표본 부족 칸의 건수(`transactionCount`)는 legacy가 이스케이프 없이 문자열에 끼운다(title 속성과 본문 두 곳).
// 건수가 숫자가 아니라 `& < > "` 가 든 문자열이면(실제 입력에는 없다: docs/data/realestate.json의 건수는 전부 숫자) legacy는 그대로 내고
// React는 이스케이프해서 내므로 글자가 달라진다. 이 표는 legacy의 글자와 React의 글자를 둘 다 적어 지금 이대로인지 고정한다(fixture 표에 넣지 않는다 - 바이트 일치가 아니다).
export const RAW_COUNT_DIFF = [
  {
    id: "Z-01",
    count: "<b>x</b>",
    legacy: `<span class="low-sample" title="신고 <b>x</b>건이라 평균을 내기엔 표본이 부족합니다">표본 <b>x</b>건</span>`,
    react: `<span class="low-sample" title="신고 &lt;b&gt;x&lt;/b&gt;건이라 평균을 내기엔 표본이 부족합니다">표본 &lt;b&gt;x&lt;/b&gt;건</span>`,
  },
  {
    id: "Z-02",
    count: `3"&4`,
    legacy: `<span class="low-sample" title="신고 3"&4건이라 평균을 내기엔 표본이 부족합니다">표본 3"&4건</span>`,
    react: `<span class="low-sample" title="신고 3&quot;&amp;4건이라 평균을 내기엔 표본이 부족합니다">표본 3&quot;&amp;4건</span>`,
  },
];
