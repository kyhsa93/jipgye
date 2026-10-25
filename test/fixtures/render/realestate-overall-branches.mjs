// 실거래 시세 요약 카드 조각 하나의 분기별 고정 fixture (#242 PR 3): realestateOverallHtml(realestate, kind, district, spread).
// 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않고 코드(realestate-overall.mjs·realestate-format.mjs 등)도 부르지 않는다.
// 한 줄이 한 분기다. `args`는 조각 함수에 그대로 넘기는 인자이고, `expect`는 React 조각이 내야 하는 글자다. 기대값은 글자 틀(`CARD`)과 아래 값 표(값 → 카드에 나오는 글자:
// 평당가 6000 → "6,000만원"·"15억 2,459만원")를 손으로 적어 이은 것이고, 입력을 가공해 만들지 않는다. 값 글자는 모듈을 부르지 않고 내장 함수로 따로 셌다(PR 본문).
// test/render-parity.test.mjs가 이 표로 React 조각 출력이 expect와 같은지 견준다.
//
// 이 조각에는 `low-sample` 스팬이 없다. 값을 못 낸 카드(표본 부족이든 값 없음이든)는 모두 "-"다 - 문턱은 렌더 때 resolveMetric(MIN_SAMPLE 5)이 한 곳에서 정한다.
// 그래서 해자 2 행은 두 가지다: 표본 부족(값은 있는데 건수가 모자람) → 값을 내지 않는다({ held: "sample" }, 기대 글자에 그 값이 나오지 않는다),
// 값 없음(건수는 충분한데 값 칸이 비었다) → 역시 "-"({ held: "value" }). 지표 칸 자체가 없으면({ held: "absent" }) 역시 "-"다.
//
// 모든 값 자리에 같은 종류의 값을 넣었다(#240·#241 교훈): 비문자열(true·false·0·NaN·{}·[1,2]·[])·null·undefined·특수문자 & < > " '·이미 이스케이프된 &amp;·빈 값 행.

const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`;

// ================= 글자 틀 (마크업) =================
const CARD = (label, value, sub) =>
  `<div class="overall-card"><div class="label">${label}</div><div class="value">${value}</div>${sub === undefined ? "" : `<div class="sub">${sub}</div>`}</div>`;

const COL = { sale: "매매 평당가", jeonse: "전세 평당 보증금", wolse: "월세 보증금 / 월세" };

// ================= 입력 틀 =================
const sale = (o = {}) => ({ avgPricePerPyeong10k: 6000, transactionCount: 40, change: { value10k: 120 }, baselineDate: "2026-10-04", ...o });
const jeonse = (o = {}) => ({ avgDepositPerPyeong10k: 3000, transactionCount: 30, change: { value10k: -50 }, baselineDate: "2026-10-04", ...o });
const wolse = (o = {}) => ({ avgDeposit10k: 20264, avgMonthlyRent10k: 128, transactionCount: 25, change: { value10k: 10, percent: 1.84 }, baselineDate: "2026-10-04", ...o });
const ABSENT = Symbol("absent");

const rows = [];
const add = (id, cond, args, expect, extra = {}) => rows.push({ id, fn: "realestateOverallHtml", cond, args, expect, ...extra });

// ================= 데이터 없음 → null =================
{
  const nones = [
    ["null", null],
    ["undefined", undefined],
    ["빈 객체", {}],
    ["overall 없음 + districts 빈 목록", { districts: [] }],
    ["overall null", { overall: null }],
    ["overall undefined", { overall: undefined }],
    ["overall 0", { overall: 0 }],
    ["overall 빈 문자열", { overall: "" }],
    ["overall false", { overall: false }],
    ["overall NaN", { overall: NaN }],
    ["districts만 있고 overall 없음(자치구가 있어도 서울 전체가 없으면 null)", { districts: [{ name: "종로구", sale: sale() }] }],
  ];
  nones.forEach(([cond, value], i) => {
    const n = String(i + 1).padStart(2, "0");
    add(`ON-${n}`, `데이터 없음: ${cond} → null`, [value], null);
    add(`ON-${n}k`, `데이터 없음: ${cond}(kind sale) → null`, [value, "sale"], null);
    add(`ON-${n}s`, `데이터 없음: ${cond}(spread가 있어도) → null`, [value, "jeonse", null, { median: 46.7, cells: 13 }], null);
  });
  add("ON-20", "자치구 페이지: 데이터 null → null", [null, null, "종로구"], null);
  add("ON-21", "자치구 페이지: districts 빈 목록 → null", [{ districts: [] }, null, "종로구"], null);
  add("ON-22", "자치구 페이지: 그 이름이 없으면 → null(서울 전체가 있어도)", [{ overall: { sale: sale() }, districts: [{ name: "중구", sale: sale() }] }, null, "종로구"], null);
  add("ON-23", "자치구 페이지: districts undefined → null", [{ overall: { sale: sale() } }, null, "종로구"], null);
  add("ON-24", "자치구 페이지: districts null → null", [{ overall: { sale: sale() }, districts: null }, null, "종로구"], null);
  add("ON-25", "자치구 페이지: 이름 비교는 엄격하다(이름이 숫자 5인 곳을 \"5\"로 찾을 수 없다)", [{ districts: [{ name: 5, sale: sale() }] }, null, "5"], null);
  add("ON-26", "자치구 페이지: 이름이 배열 [\"종로구\"]인 곳도 \"종로구\"로 찾을 수 없다", [{ districts: [{ name: ["종로구"], sale: sale() }] }, null, "종로구"], null);
  for (const [i, bad] of [true, 5, {}, [1, 2], []].entries()) {
    add(`ON-3${i}`, `자치구 페이지: district가 비문자열(${JSON.stringify(bad)})이면 이름이 같은 곳이 없어 null`, [{ overall: { sale: sale() }, districts: [{ name: "종로구", sale: sale() }] }, null, bad], null);
  }
  add("ON-40", "자치구 페이지: 이름 특수문자(& < > \" ')가 없는 이름이면 null(입력이 글자로 나오지 않는다)", [{ overall: { sale: sale() }, districts: [{ name: "종로구", sale: sale() }] }, null, SP], null);
  add("ON-41", "district 빈 문자열(falsy)이면 서울 전체 카드", [{ overall: { sale: sale() } }, "sale", ""], CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건"));
  add("ON-42", "district 0·NaN·null·undefined(falsy)도 서울 전체 카드", [{ overall: { sale: sale() } }, "sale", 0], CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건"));
  add("ON-43", "district가 참이면 kind·서울 전체는 읽지 않는다(서울 전체가 없어도 자치구 카드)", [{ districts: [{ name: "종로구", sale: sale() }] }, "wolse", "종로구"], CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건"));
}

// ================= 칸 상태 표 =================
// 값 표(값 → 카드에 나오는 글자). 평당가 V → [평당가 글자, 84㎡ 환산 글자, 전세가율(매매 6000 기준)]
const V = {
  6000: ["6,000만원", "15억 2,459만원", "100.0%"],
  20264: ["2억 264만원", "51억 4,906만원", "337.7%"],
  10000: ["1억원", "25억 4,099만원", "166.7%"],
  9999.6: ["1억원", "25억 4,089만원", "166.7%"],
  123.5: ["124만원", "3,138만원", "2.1%"],
  0: ["0만원", "0만원", "-"],
  "-5": ["-5만원", "-1억 -127만원", "-0.1%"],
  3000: ["3,000만원", "7억 6,230만원", "50.0%"],
};

// [id, 조건, 지표(필드 이름 f를 받아 만든다), 모양]
//   모양: { held: "sample" | "value" | "absent" }(값을 내지 않는다 → "-") | { v: V의 키, cnt: "40건" }
const val = (v, extra = {}) => (f) => ({ [f]: v, transactionCount: 40, change: { value10k: 120 }, baselineDate: "2026-10-04", ...extra });
const STATES = [];
const st = (id, cond, metric, shape) => STATES.push({ id, cond, metric, shape });
const OK = (v, cnt = "40건") => ({ v, cnt });
const HELD = (held) => ({ held });

// -- 값이 있는 칸
st("v01", "보통 값(평당가 6000·40건)", val(6000), OK(6000));
st("v02", "값 0은 값이다(0만원)", val(0), OK(0));
st("v03", "1억 이상(2억 264만원)", val(20264), OK(20264));
st("v04", "딱 1억(1억원)", val(10000), OK(10000));
st("v05", "반올림하면 1억(9999.6 → 1억원)", val(9999.6), OK(9999.6));
st("v06", "소수 값 반올림(123.5 → 124만원)", val(123.5), OK(123.5));
st("v07", "음수 값(-5)", val(-5), OK("-5"));
// -- 표본 부족: 건수 문턱은 resolveMetric이 정한다(5건부터 값). 이 조각은 문턱을 다시 적용하지 않는다. 값(6000)이 있어도 내지 않는다.
st("n01", "건수 5건(경계)는 값", val(6000, { transactionCount: 5 }), OK(6000, "5건"));
st("n02", "건수 4건은 값이 있어도 내지 않는다", val(6000, { transactionCount: 4 }), HELD("sample"));
st("n03", "건수 0건은 내지 않는다", val(6000, { transactionCount: 0 }), HELD("sample"));
st("n04", "건수 칸이 없으면 0건이라 내지 않는다", (f) => ({ [f]: 6000, change: { value10k: 120 }, baselineDate: "2026-10-04" }), HELD("sample"));
st("n05", "건수 null이면 0건(?? 0)이라 내지 않는다", val(6000, { transactionCount: null }), HELD("sample"));
st("n06", "건수 undefined면 내지 않는다", val(6000, { transactionCount: undefined }), HELD("sample"));
st("n07", "건수 문자열 \"9\"는 5 이상이라 값(건수 글자 그대로)", val(6000, { transactionCount: "9" }), OK(6000, "9건"));
st("n08", "건수 문자열 \"5\"는 값(경계)", val(6000, { transactionCount: "5" }), OK(6000, "5건"));
st("n09", "건수 문자열 \"4\"는 내지 않는다", val(6000, { transactionCount: "4" }), HELD("sample"));
st("n10", "건수 NaN은 비교가 거짓이라 내지 않는다", val(6000, { transactionCount: NaN }), HELD("sample"));
st("n11", "건수 false는 내지 않는다", val(6000, { transactionCount: false }), HELD("sample"));
st("n12", "건수 true는 내지 않는다", val(6000, { transactionCount: true }), HELD("sample"));
st("n13", "건수 {}는 내지 않는다", val(6000, { transactionCount: {} }), HELD("sample"));
st("n14", "건수 [7]은 5 이상이라 값(배열 글자 \"7건\")", val(6000, { transactionCount: [7] }), OK(6000, "7건"));
st("n15", "건수 []는 내지 않는다", val(6000, { transactionCount: [] }), HELD("sample"));
st("n16", "건수 Infinity는 값(건수 ∞건)", val(6000, { transactionCount: Infinity }), OK(6000, "∞건"));
st("n17", "건수 음수 -1은 내지 않는다", val(6000, { transactionCount: -1 }), HELD("sample"));
st("n18", "건수 1234567은 천 단위 쉼표", val(6000, { transactionCount: 1234567 }), OK(6000, "1,234,567건"));
st("n19", "건수 소수 5.5는 값", val(6000, { transactionCount: 5.5 }), OK(6000, "5.5건"));
st("n20", "건수 글자 \"x\"는 비교가 거짓이라 내지 않는다", val(6000, { transactionCount: "x" }), HELD("sample"));
st("n21", "건수 특수문자 & < > \" '는 비교가 거짓이라 내지 않는다(글자로 나오지 않는다)", val(6000, { transactionCount: `4&<>"'` }), HELD("sample"));
st("n22", "건수 이미 이스케이프된 &amp;도 내지 않는다", val(6000, { transactionCount: "&amp;" }), HELD("sample"));
// 건수 글자 자리에 특수문자가 닿게 하는 입력: 값(valueOf)은 5 이상이라 통과하고 글자(toLocaleString)가 특수문자다. 그 글자 자리가 이스케이프되는지(이스케이프 자리)를 본다.
const SPECIAL_COUNT = { valueOf: () => 9, toLocaleString: () => SP };
st("n23", "건수 객체의 글자가 특수문자 & < > \" '(값은 9) → 글자는 이스케이프된다", val(6000, { transactionCount: SPECIAL_COUNT }), OK(6000, `${SP_OUT}건`));
st("n24", "건수 객체의 글자가 이미 이스케이프된 &amp;(값은 9) → 한 번 더", val(6000, { transactionCount: { valueOf: () => 9, toLocaleString: () => "&amp;" } }), OK(6000, "&amp;amp;건"));
st("n25", "건수 객체의 글자가 빈 문자열(값은 9) → \"건\"", val(6000, { transactionCount: { valueOf: () => 9, toLocaleString: () => "" } }), OK(6000, "건"));
// -- 지표는 있는데 값이 없다(건수는 충분하다): 역시 "-"
st("o01", "값 없음: 값 칸이 없고 건수도 4건", () => ({ transactionCount: 4 }), HELD("value"));
st("o02", "값 없음: 건수는 충분한데 값 칸이 없다", () => ({ transactionCount: 40 }), HELD("value"));
st("o03", "값 없음: 값이 null", val(null), HELD("value"));
st("o04", "값 없음: 값이 NaN", val(NaN), HELD("value"));
st("o05", "값 없음: 값이 Infinity", val(Infinity), HELD("value"));
st("o06", "값 없음: 값이 숫자 모양 문자열", val("6000"), HELD("value"));
st("o07", "값 없음: 값이 false", val(false), HELD("value"));
st("o08", "값 없음: 값 undefined", val(undefined), HELD("value"));
st("o09", "값 없음: 지표가 빈 객체 {}(truthy)", () => ({}), HELD("value"));
st("o10", "값 없음: 지표가 빈 배열 []", () => [], HELD("value"));
st("o11", "값 없음: 지표가 숫자 5(truthy 비객체)", () => 5, HELD("value"));
st("o12", "값 없음: 지표가 문자열 \"x\"", () => "x", HELD("value"));
st("o13", "값 없음: 지표가 true", () => true, HELD("value"));
st("o14", "값 없음: 지표가 [1,2]", () => [1, 2], HELD("value"));
// -- 지표 자체가 없다
st("z01", "지표 칸이 없다(키 없음)", ABSENT, HELD("absent"));
st("z02", "지표 null", () => null, HELD("absent"));
st("z03", "지표 0(falsy)", () => 0, HELD("absent"));
st("z04", "지표 빈 문자열", () => "", HELD("absent"));
st("z05", "지표 false", () => false, HELD("absent"));
st("z06", "지표 NaN(falsy)", () => NaN, HELD("absent"));
st("z07", "지표 undefined(키는 있다)", () => undefined, HELD("absent"));

// 값 상태 → 카드 글자
const heldOut = (s) => Boolean(s.shape.held);

for (const kind of ["sale", "jeonse"]) {
  const field = kind === "sale" ? "avgPricePerPyeong10k" : "avgDepositPerPyeong10k";
  const P = kind === "sale" ? "S" : "J";
  const label = kind === "sale" ? "평당가" : "평당 보증금";
  for (const s of STATES) {
    const metric = s.metric === ABSENT ? undefined : s.metric(field);
    const flags = { held: s.shape.held ?? null };
    const [price, area, ratio] = s.shape.v === undefined ? [] : V[s.shape.v];
    // (1) 세 종류를 한 줄에 놓는 서울 전체 카드(kind 없음): 이 종류만 상태, 나머지는 지표 없음("-")
    const entryAll = {};
    if (s.metric !== ABSENT) entryAll[kind] = metric;
    const mid = (k) => (k === kind ? (heldOut(s) ? CARD(COL[k], "-") : CARD(COL[k], price, `84㎡ 환산 ${area} · ${s.shape.cnt}`)) : CARD(COL[k], "-"));
    add(`OA-${P}-${s.id}`, `서울 전체 세 카드(${kind} 칸): ${s.cond}`, [{ overall: entryAll, districts: [] }], mid("sale") + mid("jeonse") + CARD(COL.wolse, "-"), flags);
    // (2) 종류 하나의 서울 전체 카드: 전세는 전세가율이 매매에 기대므로 매매 6000(40건)을 같이 둔다
    const kEntry = kind === "jeonse" ? { sale: sale(), ...(s.metric === ABSENT ? {} : { jeonse: metric }) } : entryAll;
    let kExpect;
    if (heldOut(s)) kExpect = kind === "sale" ? CARD("서울 전체", "-") : CARD("서울 전체", "-");
    else if (kind === "sale") kExpect = CARD(label, price) + CARD("84㎡ 환산", area) + CARD("거래건수", s.shape.cnt);
    else kExpect = CARD(label, price) + CARD("84㎡ 환산", area) + (ratio === "-" ? "" : CARD("전세가율", ratio, `매매 40건 · 전세 ${s.shape.cnt}`)) + CARD("거래건수", s.shape.cnt);
    add(`OK-${P}-${s.id}`, `${kind} 카드: ${s.cond}`, [{ overall: kEntry, districts: [] }, kind], kExpect, flags);
    // (3) 자치구 페이지 카드: sale 상태는 jeonse 없이(전세가율 없음), jeonse 상태는 매매 6000과 함께(전세가율)
    const dEntry = kind === "sale" ? { name: "강남구", ...(s.metric === ABSENT ? {} : { sale: metric }) } : { name: "강남구", sale: sale(), ...(s.metric === ABSENT ? {} : { jeonse: metric }) };
    let dExpect;
    if (kind === "sale") {
      dExpect = heldOut(s) ? CARD("매매", "-") : CARD("평당가", price) + CARD("84㎡ 환산", area) + CARD("거래건수", s.shape.cnt);
    } else {
      dExpect = CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건") + (heldOut(s) || ratio === "-" ? "" : CARD("전세가율", ratio, `매매 40건 · 전세 ${s.shape.cnt}`));
    }
    add(`OD-${P}-${s.id}`, `자치구 페이지(${kind} 상태): ${s.cond}`, [{ districts: [dEntry] }, null, "강남구"], dExpect, flags);
  }
}

// ================= 월세 칸 =================
// 모양: { held } | { dep, rent, cnt }
const WSTATES = [];
const ws = (id, cond, metric, shape) => WSTATES.push({ id, cond, metric, shape });
const WOK = (o = {}) => ({ dep: "2억 264만원", rent: "128만원", cnt: "25건", ...o });
ws("v01", "보통 값(보증금 2억 264만원·월세 128만원·25건)", wolse(), WOK());
ws("v02", "월세 0만원도 값이다", wolse({ avgMonthlyRent10k: 0 }), WOK({ rent: "0만원" }));
ws("v03", "월세 1억 3,000만원(1억 이상은 억 표기)", wolse({ avgMonthlyRent10k: 13000 }), WOK({ rent: "1억 3,000만원" }));
ws("v04", "월세 칸이 없으면 \"월 -\"(값은 보증금으로 낸다)", wolse({ avgMonthlyRent10k: undefined }), WOK({ rent: "-" }));
ws("v05", "월세가 문자열이면 \"월 -\"", wolse({ avgMonthlyRent10k: "128" }), WOK({ rent: "-" }));
ws("v06", "월세가 NaN이면 \"월 -\"", wolse({ avgMonthlyRent10k: NaN }), WOK({ rent: "-" }));
ws("v07", "월세가 null이면 \"월 -\"", wolse({ avgMonthlyRent10k: null }), WOK({ rent: "-" }));
ws("v08", "보증금 0은 값이다(0만원)", wolse({ avgDeposit10k: 0 }), WOK({ dep: "0만원" }));
ws("v09", "보증금 123.5 → 124만원", wolse({ avgDeposit10k: 123.5 }), WOK({ dep: "124만원" }));
ws("n01", "건수 5건(경계)는 값", wolse({ transactionCount: 5 }), WOK({ cnt: "5건" }));
ws("n02", "건수 4건은 값이 있어도 내지 않는다", wolse({ transactionCount: 4 }), { held: "sample" });
ws("n03", "건수 칸이 없으면 내지 않는다", { avgDeposit10k: 20264, avgMonthlyRent10k: 128 }, { held: "sample" });
ws("n04", "건수 \"9\"는 값(글자 그대로)", wolse({ transactionCount: "9" }), WOK({ cnt: "9건" }));
ws("n05", "건수 NaN은 내지 않는다", wolse({ transactionCount: NaN }), { held: "sample" });
ws("n06", "건수 특수문자는 비교가 거짓이라 내지 않는다", wolse({ transactionCount: `4&<>"'` }), { held: "sample" });
ws("n07", "건수 객체의 글자가 특수문자(값은 9) → 이스케이프", wolse({ transactionCount: SPECIAL_COUNT }), WOK({ cnt: `${SP_OUT}건` }));
ws("o01", "값 없음: 보증금이 없다(건수는 충분)", { avgMonthlyRent10k: 128, transactionCount: 25 }, { held: "value" });
ws("o02", "값 없음: 보증금이 null", wolse({ avgDeposit10k: null }), { held: "value" });
ws("o03", "값 없음: 보증금이 문자열", wolse({ avgDeposit10k: "20264" }), { held: "value" });
ws("o04", "값 없음: 지표가 {}(truthy)", {}, { held: "value" });
ws("o05", "값 없음: 지표가 \"x\"", "x", { held: "value" });
ws("z01", "지표가 없다(키 없음)", ABSENT, { held: "absent" });
ws("z02", "지표 null", null, { held: "absent" });
ws("z03", "지표 0", 0, { held: "absent" });
ws("z04", "지표 빈 문자열", "", { held: "absent" });
ws("z05", "지표 false", false, { held: "absent" });

for (const s of WSTATES) {
  const flags = { held: s.shape.held ?? null };
  const entry = s.metric === ABSENT ? {} : { wolse: s.metric };
  const held = Boolean(s.shape.held);
  add(`OA-W-${s.id}`, `서울 전체 세 카드(월세 칸): ${s.cond}`, [{ overall: entry, districts: [] }], CARD(COL.sale, "-") + CARD(COL.jeonse, "-") + (held ? CARD(COL.wolse, "-") : CARD(COL.wolse, `${s.shape.dep} / 월 ${s.shape.rent}`, s.shape.cnt)), flags);
  add(
    `OK-W-${s.id}`,
    `월세 카드: ${s.cond}`,
    [{ overall: entry, districts: [] }, "wolse"],
    held ? CARD("서울 전체", "-") : CARD("평균 보증금", s.shape.dep) + CARD("평균 월세", `월 ${s.shape.rent}`) + CARD("거래건수", s.shape.cnt),
    flags
  );
  add(`OD-W-${s.id}`, `자치구 페이지: 월세 칸은 카드에 나오지 않는다(${s.cond})`, [{ districts: [{ name: "강남구", sale: sale(), ...(s.metric === ABSENT ? {} : { wolse: s.metric }) }] }, null, "강남구"], CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건"), flags);
}

// ================= 세 종류가 함께 있는 서울 전체 카드 =================
{
  const full = { sale: sale(), jeonse: jeonse(), wolse: wolse() };
  const ALL3 = CARD(COL.sale, "6,000만원", "84㎡ 환산 15억 2,459만원 · 40건") + CARD(COL.jeonse, "3,000만원", "84㎡ 환산 7억 6,230만원 · 30건") + CARD(COL.wolse, "2억 264만원 / 월 128만원", "25건");
  add("OM-01", "세 종류 모두 값(kind 없음)", [{ overall: full }], ALL3);
  add("OM-02", "kind 빈 문자열(falsy)도 세 종류", [{ overall: full }, ""], ALL3);
  add("OM-03", "kind 0·false·NaN(falsy)도 세 종류", [{ overall: full }, 0], ALL3);
  add("OM-04", "세 종류 카드는 spread를 읽지 않는다(spread가 와도 같다)", [{ overall: full }, null, null, { median: 46.7, cells: 13 }], ALL3);
  add("OM-05", "매매만 표본 부족(4건)이면 매매 카드만 \"-\"", [{ overall: { ...full, sale: sale({ transactionCount: 4 }) } }], CARD(COL.sale, "-") + CARD(COL.jeonse, "3,000만원", "84㎡ 환산 7억 6,230만원 · 30건") + CARD(COL.wolse, "2억 264만원 / 월 128만원", "25건"), { held: "sample" });
  add("OM-06", "전세만 값 없음이면 전세 카드만 \"-\"", [{ overall: { ...full, jeonse: jeonse({ avgDepositPerPyeong10k: null }) } }], CARD(COL.sale, "6,000만원", "84㎡ 환산 15억 2,459만원 · 40건") + CARD(COL.jeonse, "-") + CARD(COL.wolse, "2억 264만원 / 월 128만원", "25건"), { held: "value" });
  add("OM-07", "월세만 표본 부족이면 월세 카드만 \"-\"", [{ overall: { ...full, wolse: wolse({ transactionCount: 4 }) } }], CARD(COL.sale, "6,000만원", "84㎡ 환산 15억 2,459만원 · 40건") + CARD(COL.jeonse, "3,000만원", "84㎡ 환산 7억 6,230만원 · 30건") + CARD(COL.wolse, "-"), { held: "sample" });
  add("OM-08", "세 종류 모두 표본 부족이면 \"-\" 세 장", [{ overall: { sale: sale({ transactionCount: 4 }), jeonse: jeonse({ transactionCount: 4 }), wolse: wolse({ transactionCount: 4 }) } }], CARD(COL.sale, "-") + CARD(COL.jeonse, "-") + CARD(COL.wolse, "-"), { held: "sample" });
  add("OM-09", "서울 전체가 빈 객체 {}(truthy)면 \"-\" 세 장", [{ overall: {} }], CARD(COL.sale, "-") + CARD(COL.jeonse, "-") + CARD(COL.wolse, "-"));
  for (const [i, v] of [5, "x", true, [], [1, 2]].entries()) add(`OM-1${i}`, `서울 전체가 비객체(${JSON.stringify(v)})면 \"-\" 세 장`, [{ overall: v }], CARD(COL.sale, "-") + CARD(COL.jeonse, "-") + CARD(COL.wolse, "-"));
  add("OM-20", "서울 전체가 있고 district가 없으면 자치구 목록은 읽지 않는다(districts가 이상한 값이어도)", [{ overall: full, districts: "ab" }], ALL3);
  add("OM-21", "district가 참이면 서울 전체는 읽지 않고 그 자치구만(서울 전체와 값이 달라도)", [{ overall: full, districts: [{ name: "종로구", sale: sale({ avgPricePerPyeong10k: 5000 }) }] }, null, "종로구"], CARD("평당가", "5,000만원") + CARD("84㎡ 환산", "12억 7,049만원") + CARD("거래건수", "40건"));
  add("OM-22", "이름이 같은 자치구가 둘이면 첫째", [{ districts: [{ name: "종로구", sale: sale({ avgPricePerPyeong10k: 5000 }) }, { name: "종로구", sale: sale() }] }, null, "종로구"], CARD("평당가", "5,000만원") + CARD("84㎡ 환산", "12억 7,049만원") + CARD("거래건수", "40건"));
  add("OM-23", "자치구가 비어 있어도(이름만) 매매 카드 하나만 \"-\"", [{ districts: [{ name: "종로구" }] }, null, "종로구"], CARD("매매", "-"), { held: "absent" });
  add("OM-24", "자치구 항목이 이름만이고 spread가 있으면 \"-\" 카드 뒤에 단지별 카드", [{ districts: [{ name: "종로구" }] }, null, "종로구", { median: 46.7, cells: 13 }], CARD("매매", "-") + CARD("전세가율 단지별 중앙값", "46.7%", "단지·평형 13칸"), { held: "absent" });
}

// ================= 종류 카드의 kind 값 =================
{
  const o = { overall: { sale: sale(), jeonse: jeonse(), wolse: wolse() } };
  const DASH = CARD("서울 전체", "-");
  add("OKN-01", "모르는 kind \"foo\"는 지표가 없어 \"서울 전체 -\" 한 장", [o, "foo"], DASH, { held: "absent" });
  add("OKN-02", "kind 특수문자(& < > \" ')는 글자로 나오지 않는다 → \"서울 전체 -\"", [o, SP], DASH, { held: "absent" });
  add("OKN-03", "kind \"constructor\"(객체 기본 키) → \"서울 전체 -\"", [o, "constructor"], DASH, { held: "absent" });
  add("OKN-04", "kind \"__proto__\" → \"서울 전체 -\"", [o, "__proto__"], DASH, { held: "absent" });
  add("OKN-05", "kind \"toString\" → \"서울 전체 -\"", [o, "toString"], DASH, { held: "absent" });
  add("OKN-06", "kind 대문자 \"Sale\"는 다른 이름이라 → \"서울 전체 -\"", [o, "Sale"], DASH, { held: "absent" });
  add("OKN-07", "kind가 참인 비문자열(true) → \"서울 전체 -\"", [o, true], DASH, { held: "absent" });
  add("OKN-08", "kind 5 → \"서울 전체 -\"", [o, 5], DASH, { held: "absent" });
  add("OKN-09", "kind [] → \"서울 전체 -\"", [o, []], DASH, { held: "absent" });
  add("OKN-10", "kind [\"sale\"]는 객체 키로 읽혀 매매를 찾는다(전세 카드 규칙은 아니다)", [o, ["sale"]], CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건"));
  add("OKN-11", "kind [\"jeonse\"]는 전세 값을 찾지만 === \"jeonse\"가 아니라 평당가 라벨·전세가율·단지별 카드 없음", [o, ["jeonse"], null, { median: 46.7, cells: 13 }], CARD("평당가", "3,000만원") + CARD("84㎡ 환산", "7억 6,230만원") + CARD("거래건수", "30건"));
  add("OKN-12", "kind [\"wolse\"]는 월세 값을 찾지만 === \"wolse\"가 아니라 평당가 라벨(값은 월세의 평균 보증금)", [o, ["wolse"]], CARD("평당가", "2억 264만원") + CARD("84㎡ 환산", "51억 4,906만원") + CARD("거래건수", "25건"));
}

// ================= 전세가율 카드와 그 밑 건수(ratioBasis) =================
{
  const mkD = (s, j) => [{ districts: [{ name: "종로구", sale: s, jeonse: j }] }, null, "종로구"];
  const SALE3 = (price, area, cnt) => CARD("평당가", price) + CARD("84㎡ 환산", area) + CARD("거래건수", cnt);
  const R = (ratio, sc, jc) => CARD("전세가율", ratio, `매매 ${sc} · 전세 ${jc}`);
  add("OR-01", "자치구: 매매 6000·전세 3000 → 전세가율 50.0%와 두 건수", mkD(sale(), jeonse()), SALE3("6,000만원", "15억 2,459만원", "40건") + R("50.0%", "40건", "30건"));
  add("OR-02", "자치구: 매매 20264·전세 3000 → 14.8%", mkD(sale({ avgPricePerPyeong10k: 20264 }), jeonse()), SALE3("2억 264만원", "51억 4,906만원", "40건") + R("14.8%", "40건", "30건"));
  add("OR-03", "자치구: 매매 10000·전세 3000 → 30.0%", mkD(sale({ avgPricePerPyeong10k: 10000 }), jeonse()), SALE3("1억원", "25억 4,099만원", "40건") + R("30.0%", "40건", "30건"));
  add("OR-04", "자치구: 전세가 매매보다 비싸면(전세 6000·매매 3000) 200.0%", mkD(sale({ avgPricePerPyeong10k: 3000 }), jeonse({ avgDepositPerPyeong10k: 6000 })), SALE3("3,000만원", "7억 6,230만원", "40건") + R("200.0%", "40건", "30건"));
  add("OR-05", "자치구: 두 건수가 모두 경계(5건)면 전세가율이 나온다", mkD(sale({ transactionCount: 5 }), jeonse({ transactionCount: 5 })), SALE3("6,000만원", "15억 2,459만원", "5건") + R("50.0%", "5건", "5건"));
  add("OR-06", "자치구: 매매가 표본 부족(4건)이면 매매 카드는 \"-\"이고 전세가율도 없다", mkD(sale({ transactionCount: 4 }), jeonse()), CARD("매매", "-"), { held: "sample" });
  add("OR-07", "자치구: 전세가 표본 부족(4건)이면 매매 카드 셋만 있고 전세가율이 없다(전세 값은 내지 않는다)", mkD(sale(), jeonse({ transactionCount: 4 })), SALE3("6,000만원", "15억 2,459만원", "40건"), { held: "sample" });
  add("OR-08", "자치구: 전세 값이 없으면(건수는 충분) 전세가율이 없다", mkD(sale(), jeonse({ avgDepositPerPyeong10k: undefined })), SALE3("6,000만원", "15억 2,459만원", "40건"), { held: "value" });
  add("OR-09", "자치구: 전세 값이 0이면 비를 내지 않는다(0은 값이지만 나눌 수 없다)", mkD(sale(), jeonse({ avgDepositPerPyeong10k: 0 })), SALE3("6,000만원", "15억 2,459만원", "40건"), { held: "value" });
  add("OR-10", "자치구: 매매 값이 0이면 매매 카드는 0만원이고 전세가율은 없다", mkD(sale({ avgPricePerPyeong10k: 0 }), jeonse()), SALE3("0만원", "0만원", "40건"));
  add("OR-11", "자치구: 전세 지표가 없으면 전세가율이 없다", mkD(sale(), undefined), SALE3("6,000만원", "15억 2,459만원", "40건"), { held: "absent" });
  add("OR-12", "자치구: 두 건수 글자 그대로(\"9\"·[7])", mkD(sale({ transactionCount: "9" }), jeonse({ transactionCount: [7] })), SALE3("6,000만원", "15억 2,459만원", "9건") + R("50.0%", "9건", "7건"));
  add("OR-13", "자치구: 두 건수 글자가 특수문자(값은 9)면 둘 다 이스케이프", mkD(sale({ transactionCount: SPECIAL_COUNT }), jeonse({ transactionCount: SPECIAL_COUNT })), SALE3("6,000만원", "15억 2,459만원", `${SP_OUT}건`) + R("50.0%", `${SP_OUT}건`, `${SP_OUT}건`));
  add("OR-14", "자치구: 건수가 큰 수면 천 단위 쉼표(1234567)", mkD(sale({ transactionCount: 1234567 }), jeonse({ transactionCount: 1000 })), SALE3("6,000만원", "15억 2,459만원", "1,234,567건") + R("50.0%", "1,234,567건", "1,000건"));
  add("OR-15", "자치구: 매매 지표가 없으면 \"매매 -\"뿐(전세가 있어도 비는 없다)", mkD(undefined, jeonse()), CARD("매매", "-"), { held: "absent" });
  add("OR-16", "자치구: 전세·매매 둘 다 없으면 \"매매 -\"뿐", mkD(undefined, undefined), CARD("매매", "-"), { held: "absent" });
  add("OR-17", "전세 카드(서울 전체): 매매 표본 부족(4건)이면 전세 카드에 전세가율이 없다", [{ overall: { sale: sale({ transactionCount: 4 }), jeonse: jeonse() } }, "jeonse"], CARD("평당 보증금", "3,000만원") + CARD("84㎡ 환산", "7억 6,230만원") + CARD("거래건수", "30건"), { held: "sample" });
  add("OR-18", "전세 카드(서울 전체): 매매 없음이면 전세가율이 없다", [{ overall: { jeonse: jeonse() } }, "jeonse"], CARD("평당 보증금", "3,000만원") + CARD("84㎡ 환산", "7억 6,230만원") + CARD("거래건수", "30건"), { held: "absent" });
  add("OR-19", "전세 카드(서울 전체): 두 건수가 이스케이프되어 전세가율 밑에 붙는다", [{ overall: { sale: sale({ transactionCount: SPECIAL_COUNT }), jeonse: jeonse({ transactionCount: SPECIAL_COUNT }) } }, "jeonse"], CARD("평당 보증금", "3,000만원") + CARD("84㎡ 환산", "7억 6,230만원") + R("50.0%", `${SP_OUT}건`, `${SP_OUT}건`) + CARD("거래건수", `${SP_OUT}건`));
  add("OR-20", "매매 카드(서울 전체)는 전세가율을 내지 않는다(전세가 있어도)", [{ overall: { sale: sale(), jeonse: jeonse() } }, "sale"], SALE3("6,000만원", "15억 2,459만원", "40건"));
  add("OR-21", "세 종류 카드(kind 없음)는 전세가율 카드가 없다", [{ overall: { sale: sale(), jeonse: jeonse() } }], CARD(COL.sale, "6,000만원", "84㎡ 환산 15억 2,459만원 · 40건") + CARD(COL.jeonse, "3,000만원", "84㎡ 환산 7억 6,230만원 · 30건") + CARD(COL.wolse, "-"));
  add("OR-22", "kind 월세 카드는 전세가율 카드가 없다(전세·매매가 있어도)", [{ overall: { sale: sale(), jeonse: jeonse(), wolse: wolse() } }, "wolse"], CARD("평균 보증금", "2억 264만원") + CARD("평균 월세", "월 128만원") + CARD("거래건수", "25건"));
}

// ================= 단지별 중앙값 카드(spread) =================
{
  const full = { sale: sale(), jeonse: jeonse() };
  const SALE3 = CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건");
  const RATIO = CARD("전세가율", "50.0%", "매매 40건 · 전세 30건");
  const JEONSE3 = (ratio) => CARD("평당 보증금", "3,000만원") + CARD("84㎡ 환산", "7억 6,230만원") + ratio;
  const CX = (pct, cells) => CARD("전세가율 단지별 중앙값", pct, `단지·평형 ${cells}칸`);
  const dis = (spread) => [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", spread];
  const jeo = (spread) => [{ overall: full }, "jeonse", null, spread];
  // spread가 없는 값(falsy)
  [["null", null], ["undefined", undefined], ["0", 0], ["빈 문자열", ""], ["false", false], ["NaN", NaN]].forEach(([c, v], i) => {
    add(`OS-0${i}d`, `자치구: spread ${c} → 단지별 카드 없음`, dis(v), SALE3 + RATIO);
    add(`OS-0${i}j`, `전세 카드: spread ${c} → 단지별 카드 없음`, jeo(v), JEONSE3(RATIO + CARD("거래건수", "30건")));
  });
  // 값
  const spreads = [
    ["a", "median 46.7·cells 13", { median: 46.7, cells: 13 }, "46.7%", "13"],
    ["b", "q1·q3가 있어도 쓰지 않는다(median 49.3·cells 1173)", { median: 49.3, cells: 1173, q1: 41.3, q3: 56.9 }, "49.3%", "1,173"],
    ["c", "median 0 → 0.0%", { median: 0, cells: 10 }, "0.0%", "10"],
    ["d", "median 100(정수) → 100.0%", { median: 100, cells: 20 }, "100.0%", "20"],
    ["e", "median 반올림(46.74 → 46.7)", { median: 46.74, cells: 13 }, "46.7%", "13"],
    ["f", "median 음수 → -3.5%", { median: -3.5, cells: 13 }, "-3.5%", "13"],
    ["g", "median 없음 → \"-\"", { cells: 13 }, "-", "13"],
    ["h", "median null → \"-\"", { median: null, cells: 13 }, "-", "13"],
    ["i", "median 문자열 \"46.7\" → \"-\"", { median: "46.7", cells: 13 }, "-", "13"],
    ["j", "median NaN → \"-\"", { median: NaN, cells: 13 }, "-", "13"],
    ["k", "median Infinity → \"-\"", { median: Infinity, cells: 13 }, "-", "13"],
    ["l", "median false → \"-\"", { median: false, cells: 13 }, "-", "13"],
    ["m", "median {} → \"-\"", { median: {}, cells: 13 }, "-", "13"],
    ["n", "median [] → \"-\"", { median: [], cells: 13 }, "-", "13"],
    ["o", "median 특수문자 → \"-\"(글자로 나오지 않는다)", { median: SP, cells: 13 }, "-", "13"],
    ["p", "cells 0 → \"0칸\"", { median: 46.7, cells: 0 }, "46.7%", "0"],
    ["q", "cells 문자열 \"13\" → 글자 그대로", { median: 46.7, cells: "13" }, "46.7%", "13"],
    ["r", "cells NaN → \"NaN칸\"", { median: 46.7, cells: NaN }, "46.7%", "NaN"],
    ["s", "cells Infinity → \"∞칸\"", { median: 46.7, cells: Infinity }, "46.7%", "∞"],
    ["t", "cells 음수 → \"-5칸\"", { median: 46.7, cells: -5 }, "46.7%", "-5"],
    ["u", "cells 소수 → 쉼표·소수 \"1,234.5칸\"", { median: 46.7, cells: 1234.5 }, "46.7%", "1,234.5"],
    ["v", "cells [7] → \"7칸\"", { median: 46.7, cells: [7] }, "46.7%", "7"],
    ["w", "cells {} → \"[object Object]칸\"", { median: 46.7, cells: {} }, "46.7%", "[object Object]"],
    ["x", "cells true → \"true칸\"", { median: 46.7, cells: true }, "46.7%", "true"],
    ["y", "cells false → \"false칸\"", { median: 46.7, cells: false }, "46.7%", "false"],
    ["z", "cells 빈 문자열 → \"칸\"", { median: 46.7, cells: "" }, "46.7%", ""],
    ["A", "cells 특수문자 → 이스케이프", { median: 46.7, cells: SP }, "46.7%", SP_OUT],
    ["B", "cells 이미 이스케이프된 &amp; → 한 번 더", { median: 46.7, cells: "&amp;" }, "46.7%", "&amp;amp;"],
    ["C", "cells 1e21 → 큰 수 글자", { median: 46.7, cells: 1e21 }, "46.7%", "1,000,000,000,000,000,000,000"],
  ];
  for (const [k, cond, spread, pct, cells] of spreads) {
    add(`OS-1${k}d`, `자치구: ${cond}(전세가율 카드 뒤)`, dis(spread), SALE3 + RATIO + CX(pct, cells));
    add(`OS-1${k}j`, `전세 카드: ${cond}(전세가율 카드와 건수 카드 사이)`, jeo(spread), JEONSE3(RATIO + CX(pct, cells) + CARD("거래건수", "30건")));
  }
  // spread가 와도 안 읽는 곳
  add("OS-20", "매매 카드(kind sale)는 spread를 읽지 않는다", [{ overall: full }, "sale", null, { median: 46.7, cells: 13 }], SALE3);
  add("OS-21", "월세 카드(kind wolse)는 spread를 읽지 않는다", [{ overall: { wolse: wolse() } }, "wolse", null, { median: 46.7, cells: 13 }], CARD("평균 보증금", "2억 264만원") + CARD("평균 월세", "월 128만원") + CARD("거래건수", "25건"));
  add("OS-22", "spread가 이상해도(cells 없음) 읽지 않는 곳은 던지지 않는다(kind sale)", [{ overall: full }, "sale", null, {}], SALE3);
  // 자치구 카드의 순서: 매매 셋 → 전세가율 → 단지별(전세가율이 없어도 단지별은 붙는다)
  add("OS-30", "자치구: 전세가율이 없어도 단지별 카드는 붙는다(전세 지표 없음)", [{ districts: [{ name: "종로구", sale: sale() }] }, null, "종로구", { median: 46.7, cells: 13 }], SALE3 + CX("46.7%", "13"));
  add("OS-31", "자치구: 매매가 표본 부족이어도 단지별 카드는 붙는다(\"매매 -\" 뒤)", [{ districts: [{ name: "종로구", sale: sale({ transactionCount: 4 }) }] }, null, "종로구", { median: 46.7, cells: 13 }], CARD("매매", "-") + CX("46.7%", "13"), { held: "sample" });
  add("OS-32", "전세 카드: 전세가율이 없어도(매매 없음) 단지별 카드는 건수 카드 앞에 붙는다", [{ overall: { jeonse: jeonse() } }, "jeonse", null, { median: 46.7, cells: 13 }], JEONSE3(CX("46.7%", "13") + CARD("거래건수", "30건")), { held: "absent" });
  add("OS-33", "전세 카드: 전세가 표본 부족이면 \"서울 전체 -\" 한 장뿐(단지별 카드도 없다)", [{ overall: { sale: sale(), jeonse: jeonse({ transactionCount: 4 }) } }, "jeonse", null, { median: 46.7, cells: 13 }], CARD("서울 전체", "-"), { held: "sample" });
  add("OS-34", "서울 전체 세 카드(kind 없음)도 spread를 읽지 않는다", [{ overall: full }, null, null, { median: 46.7, cells: 13 }], CARD(COL.sale, "6,000만원", "84㎡ 환산 15억 2,459만원 · 40건") + CARD(COL.jeonse, "3,000만원", "84㎡ 환산 7억 6,230만원 · 30건") + CARD(COL.wolse, "-"));
}

// ================= 실제 모양 한 벌 =================
{
  const REAL = {
    overall: { sale: sale(), jeonse: jeonse(), wolse: wolse() },
    districts: [
      { name: "강남구", sale: sale(), jeonse: jeonse(), wolse: wolse({ transactionCount: 4 }) },
      { name: "종로구", sale: sale({ transactionCount: 3 }), jeonse: jeonse({ transactionCount: 2 }), wolse: wolse() },
    ],
  };
  const SPREAD = { median: 49.3, cells: 1173, q1: 41.3, q3: 56.9 };
  add(
    "OT-01",
    "실제 모양, 서울 전체 세 카드(월세는 서울 전체 값)",
    [REAL],
    CARD(COL.sale, "6,000만원", "84㎡ 환산 15억 2,459만원 · 40건") + CARD(COL.jeonse, "3,000만원", "84㎡ 환산 7억 6,230만원 · 30건") + CARD(COL.wolse, "2억 264만원 / 월 128만원", "25건")
  );
  add(
    "OT-02",
    "실제 모양, 서울 전체 전세 카드(전세가율·단지별 중앙값·건수)",
    [REAL, "jeonse", null, SPREAD],
    CARD("평당 보증금", "3,000만원") + CARD("84㎡ 환산", "7억 6,230만원") + CARD("전세가율", "50.0%", "매매 40건 · 전세 30건") + CARD("전세가율 단지별 중앙값", "49.3%", "단지·평형 1,173칸") + CARD("거래건수", "30건")
  );
  add(
    "OT-03",
    "실제 모양, 강남구 페이지(매매 셋·전세가율·단지별 중앙값)",
    [REAL, null, "강남구", SPREAD],
    CARD("평당가", "6,000만원") + CARD("84㎡ 환산", "15억 2,459만원") + CARD("거래건수", "40건") + CARD("전세가율", "50.0%", "매매 40건 · 전세 30건") + CARD("전세가율 단지별 중앙값", "49.3%", "단지·평형 1,173칸")
  );
  add(
    "OT-04",
    "실제 모양, 종로구 페이지(매매·전세 둘 다 표본 부족: \"매매 -\"뿐이고 전세가율은 없다)",
    [REAL, null, "종로구", null],
    CARD("매매", "-"),
    { held: "sample" }
  );
  add(
    "OT-05",
    "실제 모양, 서울 전체 월세 카드",
    [REAL, "wolse"],
    CARD("평균 보증금", "2억 264만원") + CARD("평균 월세", "월 128만원") + CARD("거래건수", "25건")
  );
}

export const REALESTATE_OVERALL_BRANCHES = rows;

// ================= 던지는 입력 =================
// 예전 코드가 TypeError를 던지는 입력. React 조각도 같은 함수를 부르므로 같이 던진다(조용히 빈 카드를 내지 않는다).
export const REALESTATE_OVERALL_THROWS = [];
{
  const full = { sale: sale(), jeonse: jeonse() };
  const t = (id, cond, args) => REALESTATE_OVERALL_THROWS.push({ id, fn: "realestateOverallHtml", cond, args });
  t("OTH-01", "자치구 페이지: districts가 문자열(find가 없다)", [{ districts: "ab" }, null, "종로구"]);
  t("OTH-02", "자치구 페이지: districts가 빈 문자열(?? []로 바뀌지 않는다)", [{ districts: "" }, null, "종로구"]);
  t("OTH-03", "자치구 페이지: districts가 객체 {}", [{ districts: {} }, null, "종로구"]);
  t("OTH-04", "자치구 페이지: districts가 숫자 5", [{ districts: 5 }, null, "종로구"]);
  t("OTH-05", "자치구 페이지: districts가 true", [{ districts: true }, null, "종로구"]);
  t("OTH-06", "자치구 페이지: districts 항목이 null(이름을 읽다 던진다)", [{ districts: [null] }, null, "종로구"]);
  t("OTH-07", "자치구 페이지: districts 항목이 undefined", [{ districts: [undefined] }, null, "종로구"]);
  t("OTH-08", "자치구 페이지 spread가 5(truthy, cells가 없다)", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", 5]);
  t("OTH-09", "자치구 페이지 spread가 true", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", true]);
  t("OTH-10", "자치구 페이지 spread가 \"x\"", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", "x"]);
  t("OTH-11", "자치구 페이지 spread가 {}(cells 없음)", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", {}]);
  t("OTH-12", "자치구 페이지 spread가 [](cells 없음)", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", []]);
  t("OTH-13", "자치구 페이지 spread에 median만(cells 없음)", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", { median: 46.7 }]);
  t("OTH-14", "자치구 페이지 spread.cells가 null", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", { median: 46.7, cells: null }]);
  t("OTH-15", "자치구 페이지 spread.cells가 undefined", [{ districts: [{ name: "종로구", ...full }] }, null, "종로구", { median: 46.7, cells: undefined }]);
  t("OTH-16", "전세 카드 spread가 {}", [{ overall: full }, "jeonse", null, {}]);
  t("OTH-17", "전세 카드 spread.cells가 null", [{ overall: full }, "jeonse", null, { median: 46.7, cells: null }]);
  t("OTH-18", "전세 카드 spread가 5", [{ overall: full }, "jeonse", null, 5]);
  t("OTH-19", "매매 지표가 없어도(매매 없음) 자치구 spread가 이상하면 던진다", [{ districts: [{ name: "종로구" }] }, null, "종로구", {}]);
  t("OTH-20", "서울 전체가 있어도 district를 주면 districts(문자열)를 읽다 던진다", [{ overall: full, districts: "ab" }, null, "종로구"]);
}

export const REALESTATE_OVERALL_FNS = ["realestateOverallHtml"];
