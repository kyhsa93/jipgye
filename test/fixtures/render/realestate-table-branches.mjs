// 실거래 시세표 머리글·표 조각 둘의 분기별 고정 fixture (#242 PR 2): realestateHeadHtml·realestateTableHtml.
// 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않고 코드(district-slugs.mjs·realestate-table.mjs 등)도 부르지 않는다 - 자치구 25곳의 slug도 여기에 손으로 적었다.
// 한 줄이 한 분기다. `args`는 조각 함수에 그대로 넘기는 인자이고, `expect`는 React 조각이 내야 하는 글자다. 기대값은 글자 틀(`STRONG`·`CHG`·`LOW`·`rowTr` 등 감싸는 마크업)과
// 아래 값 표(값 → 칸에 나오는 글자: 평당가 6000 → "6,000만원"·"15억 2,459만원")를 손으로 적어 이은 것이고, 입력을 가공해 만들지 않는다. 값 글자는 모듈을 부르지 않고 내장 함수로 따로 셌다(PR 본문).
// test/render-parity.test.mjs가 이 표로 React 조각 출력이 expect와 같은지 견준다.
//
// 칸마다 같은 상태 표(STATES)를 세 보기로 돌린다: 세 종류를 한 줄에 놓는 표(보기 all)·종류 하나의 표(보기 kind)·자치구 페이지의 표(보기 district).
// 표본 부족(`low-sample`)이 나오는 곳은 이 세 보기가 서로 다른 코드 자리(reAllCells·reCells·reDistrictRows)이므로 세 곳을 모두 같은 상태로 닫는다(해자 2).
// 상태마다 { moat: true }는 표본 부족 칸이 나오는 행, { order: true }는 표본 부족이 값 없음("-")보다 먼저 판정되는 행이다(지표는 있는데 값이 없으면 "-"가 아니라 표본 부족이다).
//
// 모든 값 자리에 같은 종류의 값을 넣었다(#240·#241 교훈): 비문자열(true·false·0·NaN·{}·[1,2]·[])·null·undefined·특수문자 & < > " '·이미 이스케이프된 &amp;·빈 값 행.

const BASE = "2026-10-04";
const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`;

// ================= 글자 틀 (마크업) =================
const STRONG = (t) => `<span class="price-strong">${t}</span>`;
const COUNT = (t) => `<span class="count">${t}</span>`;
const RATIO = (t) => `<span class="ratio">${t}</span>`;
const CHG = (dir, arrow, t, title) => ` <span class="change ${dir}"${title === undefined ? "" : ` title="${title}"`}>${arrow}${t}</span>`;
const LOW = (n) => `<span class="low-sample" title="이번 달 신고가 ${n}건뿐이라 평균을 내지 않았습니다.">신고 ${n}건</span>`;
const WOLSE_TITLE = (base) => `${base} 대비 · 보증금과 월세를 묶은 ㎡당 값(보증금 + 월세×12÷4.8%)의 증감 — 그 주에 신고된 방 크기가 달라서 생기는 흔들림을 덜어 낸 값입니다`;
const PREV_TITLE = "이 지역은 오늘 실거래 조회에 실패해 지난번에 받은 값을 그대로 보여줍니다.";
const PREV = (label) => ` <span class="prev-tag" title="${PREV_TITLE}">${label}</span>`;

const tdA = (label, inner) => `<td data-label="${label}">${inner}</td>`;
const LBL = {
  all: ["매매 평당가", "전세 평당 보증금", "월세 보증금 / 월세"],
  sale: ["평당가", "84㎡ 환산", "거래건수"],
  jeonse: ["평당 보증금", "84㎡ 환산", "전세가율", "거래건수"],
  wolse: ["평균 보증금", "평균 월세", "거래건수"],
};
const DIST_LBL = ["평당가", "84㎡ 환산", "거래건수"];
const link = (name, slug) => `<a href="./district-${slug}.html">${name}</a>`;
const rowTr = (nameHtml, cells, { overall = false, stale = "" } = {}) => `<tr class="${overall ? "overall-row" : ""}"><td>${nameHtml}${stale}</td>${cells.join("")}</tr>`;
const distTr = (label, [price, area, count]) =>
  `<tr><td>${label}</td>${tdA(DIST_LBL[0], price)}${tdA(DIST_LBL[1], area)}${tdA(DIST_LBL[2], count)}</tr>`;
const distRows = (sale, jeonse, wolse) => distTr("매매", sale) + distTr("전세", jeonse) + distTr("월세", wolse);
const NONE3 = ["-", "-", "-"];

// 자치구 25곳과 slug(손으로 적었다)
const SLUGS = [
  ["종로구", "jongno"], ["중구", "jung"], ["용산구", "yongsan"], ["성동구", "seongdong"], ["광진구", "gwangjin"], ["동대문구", "dongdaemun"], ["중랑구", "jungnang"],
  ["성북구", "seongbuk"], ["강북구", "gangbuk"], ["도봉구", "dobong"], ["노원구", "nowon"], ["은평구", "eunpyeong"], ["서대문구", "seodaemun"], ["마포구", "mapo"],
  ["양천구", "yangcheon"], ["강서구", "gangseo"], ["구로구", "guro"], ["금천구", "geumcheon"], ["영등포구", "yeongdeungpo"], ["동작구", "dongjak"], ["관악구", "gwanak"],
  ["서초구", "seocho"], ["강남구", "gangnam"], ["송파구", "songpa"], ["강동구", "gangdong"],
];

// ================= 입력 틀 =================
const sale = (o = {}) => ({ avgPricePerPyeong10k: 6000, transactionCount: 40, change: { value10k: 120 }, baselineDate: BASE, ...o });
const jeonse = (o = {}) => ({ avgDepositPerPyeong10k: 3000, transactionCount: 30, change: { value10k: -50 }, baselineDate: BASE, ...o });
const wolse = (o = {}) => ({ avgDeposit10k: 20264, avgMonthlyRent10k: 128, transactionCount: 25, change: { value10k: 10, percent: 1.84 }, baselineDate: BASE, ...o });
const dist = (name, o = {}) => ({ name, sale: sale(), jeonse: jeonse(), wolse: wolse(), ...o });
const data = (districts, overall) => (overall === undefined ? { districts } : { overall, districts });

// 지표 칸의 키를 아예 두지 않는 상태(null·undefined와 다르다)
const ABSENT = Symbol("absent");

const rows = [];
const add = (id, fn, cond, args, expect, extra = {}) => rows.push({ id, fn, cond, args, expect, ...extra });

// ================= 머리글 realestateHeadHtml =================
{
  const fn = "realestateHeadHtml";
  const th = (labels) => `<tr>${labels.map((l) => `<th scope="col">${l}</th>`).join("")}</tr>`;
  const ALL = th(["지역", "매매 평당가", "전세 평당 보증금", "월세 보증금 / 월세"]);
  const SALE = th(["지역", "평당가", "84㎡ 환산", "거래건수"]);
  const JEONSE = th(["지역", "평당 보증금", "84㎡ 환산", "전세가율", "거래건수"]);
  const WOLSE = th(["지역", "평균 보증금", "평균 월세", "거래건수"]);
  const DISTRICT = th(["구분", "평당가", "84㎡ 환산", "거래건수"]);
  add("H-01", fn, "인자 없음 → 세 종류를 한 줄에 놓는 표", [], ALL);
  add("H-02", fn, "kind null", [null], ALL);
  add("H-03", fn, "kind undefined", [undefined], ALL);
  add("H-04", fn, "kind \"sale\"", ["sale"], SALE);
  add("H-05", fn, "kind \"jeonse\"(전세가율 칸이 더 있다)", ["jeonse"], JEONSE);
  add("H-06", fn, "kind \"wolse\"", ["wolse"], WOLSE);
  add("H-07", fn, "모르는 kind는 매매 머리글", ["foo"], SALE);
  add("H-08", fn, "kind 빈 문자열(falsy) → 세 종류 표", [""], ALL);
  add("H-09", fn, "kind 0·false(falsy) → 세 종류 표", [0], ALL);
  add("H-10", fn, "kind 특수문자 & < > \" ' → 모르는 종류라 매매 머리글(입력은 글자로 나오지 않는다)", [SP], SALE);
  add("H-11", fn, "자치구 페이지(district 있음)는 kind와 상관없이 구분·평당가·84㎡ 환산·거래건수", [null, "종로구"], DISTRICT);
  add("H-12", fn, "자치구 페이지에 kind를 줘도 같다(jeonse)", ["jeonse", "종로구"], DISTRICT);
  add("H-13", fn, "district가 없는 이름이어도 머리글은 같다(참 거짓만 본다)", ["wolse", "없는구"], DISTRICT);
  add("H-14", fn, "district 빈 문자열(falsy)이면 kind 머리글", ["wolse", ""], WOLSE);
  add("H-15", fn, "district null·undefined면 kind 머리글", ["sale", null], SALE);
  add("H-16", fn, "district undefined", ["jeonse", undefined], JEONSE);
  for (const [i, bad] of [true, 5, {}, [1, 2], []].entries()) add(`H-17${"abcde"[i]}`, fn, `district가 비문자열(${JSON.stringify(bad)})도 참이면 자치구 머리글`, [null, bad], DISTRICT);
  add("H-18", fn, "district 0·NaN(falsy)이면 kind 머리글", ["sale", 0], SALE);
  add("H-19", fn, "district NaN", ["sale", NaN], SALE);
  add("H-20", fn, "kind·district 특수문자는 머리글에 나오지 않는다", [SP, SP], DISTRICT);
}

// ================= 데이터 없음 realestateTableHtml → null =================
{
  const fn = "realestateTableHtml";
  const nones = [
    ["null", null],
    ["undefined", undefined],
    ["빈 객체", {}],
    ["districts 빈 목록", { districts: [] }],
    ["districts null", { districts: null }],
    ["overall null + districts 빈 목록", { overall: null, districts: [] }],
    ["overall undefined", { overall: undefined }],
    ["overall 0", { overall: 0, districts: [] }],
    ["overall 빈 문자열", { overall: "", districts: [] }],
    ["overall false", { overall: false }],
    ["districts 문자열 빈 값", { districts: "" }],
    ["districts 객체({}에는 length가 없다)", { districts: {} }],
  ];
  nones.forEach(([cond, value], i) => {
    add(`TN-${String(i + 1).padStart(2, "0")}`, fn, `데이터 없음: ${cond} → null`, [value], null);
    add(`TN-${String(i + 1).padStart(2, "0")}k`, fn, `데이터 없음: ${cond}(kind sale) → null`, [value, "sale"], null);
  });
  add("TN-30", fn, "자치구 페이지: 데이터 null → null", [null, null, "종로구"], null);
  add("TN-31", fn, "자치구 페이지: districts 빈 목록 → null", [{ districts: [] }, null, "종로구"], null);
  add("TN-32", fn, "자치구 페이지: 그 이름이 없으면 → null", [data([dist("중구")]), null, "종로구"], null);
  add("TN-33", fn, "자치구 페이지: overall만 있어도 자치구가 없으면 → null", [data([], dist("서울")), null, "종로구"], null);
  add("TN-35", fn, "자치구 페이지: 이름 비교는 엄격하다(이름이 숫자 5인 곳을 \"5\"로 찾을 수 없다)", [data([{ name: 5, sale: sale() }]), null, "5"], null);
  add("TN-36", fn, "자치구 페이지: 이름이 배열 [\"종로구\"]인 곳도 \"종로구\"로 찾을 수 없다", [data([{ name: ["종로구"], sale: sale() }]), null, "종로구"], null);
  add("TN-34", fn, "자치구 페이지: districts undefined", [{}, null, "종로구"], null);
}

// ================= 칸 상태 표 =================
// 값 표(값 → 칸에 나오는 글자). 평당가 V → [평당가 글자, 84㎡ 환산 글자, 전세가율(매매 6000 기준)]
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
const UP = (t, title = BASE) => CHG("up", "▲", t, title === null ? undefined : `${title} 대비`);
const DOWN = (t, title = BASE) => CHG("down", "▼", t, title === null ? undefined : `${title} 대비`);

// [id, 조건, 지표(필드 이름 f를 받아 만든다), 칸 모양]
//   칸 모양: { none } | { low: "건수 글자(이스케이프됨)" } | { v: V의 키, chg: 증감 글자, cnt: "40건"(종류 표·자치구 표의 건수), cntAll: "40건"|null(한 줄 표의 건수 - 숫자가 아니면 null) }
const val = (v, extra = {}) => (f) => ({ [f]: v, transactionCount: 40, change: { value10k: 120 }, baselineDate: BASE, ...extra });
const STATES = [];
const st = (id, cond, metric, shape, flags = {}) => STATES.push({ id, cond, metric, shape, ...flags });
const OK = (v, o = {}) => ({ v, chg: UP("120만원"), cnt: "40건", cntAll: "40건", ...o });

// -- 값이 있는 칸
st("v01", "보통 값(평당가 6000·40건·증감 +120)", val(6000), OK(6000));
st("v02", "값 0은 값이다(0만원)", val(0), OK(0));
st("v03", "1억 이상(2억 264만원)", val(20264), OK(20264));
st("v04", "딱 1억(1억원)", val(10000), OK(10000));
st("v05", "반올림하면 1억(9999.6 → 1억원)", val(9999.6), OK(9999.6));
st("v06", "소수 값 반올림(123.5 → 124만원)", val(123.5), OK(123.5));
st("v07", "음수 값(-5)", val(-5), OK("-5"));
// -- 표본 부족: 건수 문턱은 resolveMetric이 정한다(5건부터 값). 이 표는 문턱을 다시 적용하지 않는다.
st("n01", "건수 5건(경계)는 값", val(6000, { transactionCount: 5 }), OK(6000, { cnt: "5건", cntAll: "5건" }));
st("n02", "건수 4건은 값을 내지 않고 표본 4건", val(6000, { transactionCount: 4 }), { low: "4" }, { moat: true });
st("n03", "건수 0건은 표본 부족 0건", val(6000, { transactionCount: 0 }), { low: "0" }, { moat: true });
st("n04", "건수 칸이 없으면 0건으로 적는다", (f) => ({ [f]: 6000, change: { value10k: 120 }, baselineDate: BASE }), { low: "0" }, { moat: true });
st("n05", "건수 null이면 0건(?? 0)", val(6000, { transactionCount: null }), { low: "0" }, { moat: true });
st("n06", "건수 undefined면 0건", val(6000, { transactionCount: undefined }), { low: "0" }, { moat: true });
st("n07", "건수 문자열 \"9\"는 5 이상이라 값(건수 칸은 글자 그대로, 한 줄 표는 숫자가 아니라 건수를 뺀다)", val(6000, { transactionCount: "9" }), OK(6000, { cnt: "9건", cntAll: null }));
st("n08", "건수 문자열 \"5\"는 값(경계)", val(6000, { transactionCount: "5" }), OK(6000, { cnt: "5건", cntAll: null }));
st("n09", "건수 문자열 \"4\"는 표본 부족 4건", val(6000, { transactionCount: "4" }), { low: "4" }, { moat: true });
st("n10", "건수 NaN은 비교가 거짓이라 표본 부족 NaN건", val(6000, { transactionCount: NaN }), { low: "NaN" }, { moat: true });
st("n11", "건수 false는 표본 부족 false건", val(6000, { transactionCount: false }), { low: "false" }, { moat: true });
st("n12", "건수 true는 표본 부족 true건", val(6000, { transactionCount: true }), { low: "true" }, { moat: true });
st("n13", "건수 {}는 표본 부족 [object Object]건", val(6000, { transactionCount: {} }), { low: "[object Object]" }, { moat: true });
st("n14", "건수 [7]은 5 이상이라 값(배열이라 한 줄 표는 건수를 뺀다)", val(6000, { transactionCount: [7] }), OK(6000, { cnt: "7건", cntAll: null }));
st("n15", "건수 []는 표본 부족(빈 글자) - \"신고 건\"", val(6000, { transactionCount: [] }), { low: "" }, { moat: true });
st("n16", "건수 Infinity는 값(건수 ∞건)", val(6000, { transactionCount: Infinity }), OK(6000, { cnt: "∞건", cntAll: "∞건" }));
st("n17", "건수 음수 -1은 표본 부족 -1건", val(6000, { transactionCount: -1 }), { low: "-1" }, { moat: true });
st("n18", "건수 1234567은 천 단위 쉼표", val(6000, { transactionCount: 1234567 }), OK(6000, { cnt: "1,234,567건", cntAll: "1,234,567건" }));
st("n19", "건수 소수 5.5", val(6000, { transactionCount: 5.5 }), OK(6000, { cnt: "5.5건", cntAll: "5.5건" }));
st("n20", "건수 글자가 숫자가 아니면 그대로 표본 x건", val(6000, { transactionCount: "x" }), { low: "x" }, { moat: true });
st("n21", "건수 특수문자 & < > \" '는 표본 부족 글자·제목 모두 이스케이프(' 는 그대로)", val(6000, { transactionCount: `4&<>"'` }), { low: `4&amp;&lt;&gt;&quot;'` }, { moat: true });
st("n22", "건수 이미 이스케이프된 &amp;는 한 번 더", val(6000, { transactionCount: "&amp;" }), { low: "&amp;amp;" }, { moat: true });
// -- 지표는 있는데 값이 없다: 값 없음("-")이 아니라 표본 부족이 먼저다(순서)
st("o01", "순서: 값이 없고 건수도 4건 → \"-\"가 아니라 표본 부족", (f) => ({ transactionCount: 4 }), { low: "4" }, { moat: true, order: true });
st("o02", "표본 충분(40건)인데 값 칸이 없으면 \"-\"(#593 b - 「40건뿐」이라 적지 않는다)", (f) => ({ transactionCount: 40 }), { none: true });
st("o03", "표본 충분(40건)인데 값이 null이면 \"-\"(#593 b)", val(null), { none: true });
st("o04", "표본 충분(40건)인데 값이 NaN이면 \"-\"(#593 b)", val(NaN), { none: true });
st("o05", "표본 충분(40건)인데 값이 Infinity면 \"-\"(#593 b)", val(Infinity), { none: true });
st("o06", "표본 충분(40건)인데 값이 숫자 모양 문자열이면 \"-\"(#593 b)", val("6000"), { none: true });
st("o07", "표본 충분(40건)인데 값이 false면 \"-\"(#593 b)", val(false), { none: true });
st("o08", "표본 충분(40건)인데 값 undefined면 \"-\"(#593 b)", val(undefined), { none: true });
st("o09", "순서: 지표가 빈 객체 {}(truthy)면 표본 부족 0건", () => ({}), { low: "0" }, { moat: true, order: true });
st("o10", "순서: 지표가 빈 배열 [](truthy)면 표본 부족 0건", () => [], { low: "0" }, { moat: true, order: true });
st("o11", "순서: 지표가 숫자 5(truthy 비객체)면 표본 부족 0건", () => 5, { low: "0" }, { moat: true, order: true });
st("o12", "순서: 지표가 문자열 \"x\"면 표본 부족 0건", () => "x", { low: "0" }, { moat: true, order: true });
st("o13", "순서: 지표가 true면 표본 부족 0건", () => true, { low: "0" }, { moat: true, order: true });
st("o14", "순서: 지표가 [1,2]면 표본 부족 0건", () => [1, 2], { low: "0" }, { moat: true, order: true });
// -- 표본 문턱 경계에서 값만 없다(#593 b): 5건부터는 충분하니 "-", 4건 이하는 표본 부족(0건 포함)
st("o15", "경계: 값 null·5건(충분) → \"-\"", val(null, { transactionCount: 5 }), { none: true });
st("o16", "경계: 값 null·4건 → 표본 부족 4건", val(null, { transactionCount: 4 }), { low: "4" }, { moat: true, order: true });
st("o17", "경계: 값 null·1건 → 표본 부족 1건", val(null, { transactionCount: 1 }), { low: "1" }, { moat: true, order: true });
st("o18", "경계: 값 null·0건 → 표본 부족 0건(표는 0건도 적는다)", val(null, { transactionCount: 0 }), { low: "0" }, { moat: true, order: true });
st("o19", "경계: 값 null·건수 문자열 \"5\"(충분) → \"-\"", val(null, { transactionCount: "5" }), { none: true });
st("o20", "경계: 값 null·건수 문자열 \"4\" → 표본 부족 4건", val(null, { transactionCount: "4" }), { low: "4" }, { moat: true, order: true });
// -- 지표 자체가 없다 → 값 없음("-")
st("z01", "지표 칸이 없으면(키 없음) \"-\"", ABSENT, { none: true });
st("z02", "지표 null이면 \"-\"", () => null, { none: true });
st("z03", "지표 0(falsy)이면 \"-\"", () => 0, { none: true });
st("z04", "지표 빈 문자열이면 \"-\"", () => "", { none: true });
st("z05", "지표 false면 \"-\"", () => false, { none: true });
st("z06", "지표 NaN(falsy)이면 \"-\"", () => NaN, { none: true });
st("z07", "지표 undefined(키는 있다)면 \"-\"", () => undefined, { none: true });
// -- 증감(매매·전세): 값은 그대로, 증감 칸만 갈린다
const chg = (id, cond, change, chgText, extra = {}) => st(id, cond, val(6000, { change, ...extra }), OK(6000, { chg: chgText }));
chg("c01", "증감 undefined → 증감 없음", undefined, "");
chg("c02", "증감 null → 없음", null, "");
chg("c03", "증감 {} → 없음", {}, "");
chg("c04", "증감 value10k 0 → 없음", { value10k: 0 }, "");
chg("c05", "증감 value10k -0 → 없음(−0도 0이다)", { value10k: -0 }, "");
chg("c06", "증감 value10k 문자열 \"120\" → 없음", { value10k: "120" }, "");
chg("c07", "증감 value10k null → 없음", { value10k: null }, "");
chg("c08", "증감 value10k 음수 → 내림(▼)", { value10k: -50 }, DOWN("50만원"));
chg("c09", "증감 value10k NaN → 내림(▼)·글자 \"-\"", { value10k: NaN }, DOWN("-"));
chg("c10", "증감 value10k Infinity → 오름(▲)·글자 \"-\"", { value10k: Infinity }, UP("-"));
chg("c11", "증감 value10k -Infinity → 내림(▼)·글자 \"-\"", { value10k: -Infinity }, DOWN("-"));
chg("c12", "증감 2억(20000) → ▲2억원", { value10k: 20000 }, UP("2억원"));
chg("c13", "증감 0.4 → ▲0만원(반올림)", { value10k: 0.4 }, UP("0만원"));
chg("c14", "증감이 숫자 5(truthy 비객체) → 없음", 5, "");
chg("c15", "증감이 문자열 \"x\" → 없음", "x", "");
chg("c16", "증감이 true → 없음", true, "");
chg("c17", "증감이 [] → 없음", [], "");
chg("c18", "증감이 false → 없음", false, "");
chg("b01", "기준일 없음 → 제목 없는 증감", { value10k: 120 }, UP("120만원", null), { baselineDate: undefined });
chg("b02", "기준일 빈 문자열 → 제목 없음", { value10k: 120 }, UP("120만원", null), { baselineDate: "" });
chg("b03", "기준일 0 → 제목 없음", { value10k: 120 }, UP("120만원", null), { baselineDate: 0 });
chg("b04", "기준일 null → 제목 없음", { value10k: 120 }, UP("120만원", null), { baselineDate: null });
chg("b05", "기준일 false → 제목 없음", { value10k: 120 }, UP("120만원", null), { baselineDate: false });
chg("b06", "기준일 특수문자 → 제목에서 이스케이프", { value10k: 120 }, UP("120만원", SP_OUT), { baselineDate: SP });
chg("b07", "기준일 숫자 5 → \"5 대비\"", { value10k: 120 }, UP("120만원", "5"), { baselineDate: 5 });
chg("b08", "기준일 {} → \"[object Object] 대비\"", { value10k: 120 }, UP("120만원", "[object Object]"), { baselineDate: {} });
chg("b09", "기준일 true → \"true 대비\"", { value10k: 120 }, UP("120만원", "true"), { baselineDate: true });
chg("b10", "기준일 [](truthy) → \" 대비\"", { value10k: 120 }, UP("120만원", ""), { baselineDate: [] });
chg("b11", "기준일 문자열 \"0\"(truthy) → \"0 대비\"", { value10k: 120 }, UP("120만원", "0"), { baselineDate: "0" });
chg("b12", "기준일 이미 이스케이프된 &amp; → 한 번 더", { value10k: 120 }, UP("120만원", "&amp;amp;"), { baselineDate: "&amp;" });

// 값 칸 → 세 보기의 칸 글자. kind는 sale·jeonse.
function priceCells(kind, shape) {
  // 값 없는 줄의 칸 수: 머리글이 다섯 칸인 전세 표는 값 칸 넷이다(#593 a), 나머지는 셋.
  const pad = kind === "jeonse" ? ["-"] : [];
  if (shape.none) return { all: "-", kind: ["-", "-", "-", ...pad], dist: NONE3 };
  if (shape.low !== undefined) return { all: LOW(shape.low), kind: [LOW(shape.low), "-", "-", ...pad], dist: [LOW(shape.low), "-", "-"] };
  const [price, area, ratio] = V[shape.v];
  const cntAll = shape.cntAll === null ? "" : ` ${COUNT(shape.cntAll)}`;
  const base = [STRONG(price) + shape.chg, STRONG(area)];
  const kindCells = kind === "jeonse" ? [...base, ratio === "-" ? "-" : RATIO(ratio), COUNT(shape.cnt)] : [...base, COUNT(shape.cnt)];
  return { all: `${price}${shape.chg}${cntAll}`, kind: kindCells, dist: [...base, COUNT(shape.cnt)] };
}

for (const kind of ["sale", "jeonse"]) {
  const field = kind === "sale" ? "avgPricePerPyeong10k" : "avgDepositPerPyeong10k";
  const idx = kind === "sale" ? 0 : 1;
  const prefix = kind === "sale" ? "S" : "J";
  const labels = LBL[kind];
  for (const s of STATES) {
    const metric = s.metric === ABSENT ? undefined : s.metric(field);
    // 한 줄 표: 이 종류의 칸만 상태, 나머지는 지표 없음
    const entry = { name: "강남구" };
    if (s.metric !== ABSENT) entry[kind] = metric;
    const cells = priceCells(kind, s.shape);
    const flags = { moat: Boolean(s.moat), order: Boolean(s.order) };
    const allCells = ["-", "-", "-"];
    allCells[idx] = cells.all;
    add(`TA-${prefix}-${s.id}`, "realestateTableHtml", `한 줄 표(${kind} 칸): ${s.cond}`, [data([entry])], rowTr(link("강남구", "gangnam"), allCells.map((c, i) => tdA(LBL.all[i], c))), flags);
    // 종류 표: 전세는 전세가율이 매매에 기대므로 매매 6000(40건)을 같이 둔다
    const kEntry = kind === "jeonse" ? { name: "강남구", sale: sale(), ...(s.metric === ABSENT ? {} : { jeonse: metric }) } : entry;
    add(`T${prefix}-${s.id}`, "realestateTableHtml", `${kind} 표: ${s.cond}`, [data([kEntry]), kind], rowTr(link("강남구", "gangnam"), cells.kind.map((c, i) => tdA(labels[i], c))), flags);
    // 자치구 페이지 표
    const dEntry = { name: "강남구" };
    if (s.metric !== ABSENT) dEntry[kind] = metric;
    const dRows = kind === "sale" ? distRows(cells.dist, NONE3, NONE3) : distRows(NONE3, cells.dist, NONE3);
    add(`DR-${prefix}-${s.id}`, "realestateTableHtml", `자치구 페이지(${kind} 줄): ${s.cond}`, [data([dEntry]), null, "강남구"], dRows, flags);
  }
}

// ================= 월세 칸 =================
// [id, 조건, 지표, 칸 모양]  모양: { none } | { low } | { dep, rent, chg(종류 표의 월세 증감 글자), cnt, cntAll }
const WSTATES = [];
const ws = (id, cond, metric, shape, flags = {}) => WSTATES.push({ id, cond, metric, shape, ...flags });
const WOK = (o = {}) => ({ dep: "2억 264만원", rent: "128만원", chg: CHG("up", "▲", "1.8%", WOLSE_TITLE(BASE)), cnt: "25건", cntAll: "25건", ...o });
const wval = (extra = {}) => wolse(extra);
ws("v01", "보통 값(보증금 2억 264만원·월세 128만원·증감 +1.8%)", wval(), WOK());
ws("v02", "월세 월 0만원도 값이다", wval({ avgMonthlyRent10k: 0 }), WOK({ rent: "0만원" }));
ws("v03", "월세 1억 3,000만원(1억 이상은 억 표기)", wval({ avgMonthlyRent10k: 13000 }), WOK({ rent: "1억 3,000만원" }));
ws("v04", "월세가 없으면 \"월 -\"", wval({ avgMonthlyRent10k: undefined }), WOK({ rent: "-" }));
ws("v05", "월세가 문자열이면 \"월 -\"", wval({ avgMonthlyRent10k: "128" }), WOK({ rent: "-" }));
ws("v06", "월세가 NaN이면 \"월 -\"", wval({ avgMonthlyRent10k: NaN }), WOK({ rent: "-" }));
ws("v07", "월세가 null이면 \"월 -\"", wval({ avgMonthlyRent10k: null }), WOK({ rent: "-" }));
ws("v08", "보증금 0은 값이다(0만원)", wval({ avgDeposit10k: 0 }), WOK({ dep: "0만원" }));
ws("v09", "보증금 123.5 → 124만원", wval({ avgDeposit10k: 123.5 }), WOK({ dep: "124만원" }));
ws("n01", "건수 5건(경계)는 값", wval({ transactionCount: 5 }), WOK({ cnt: "5건", cntAll: "5건" }));
ws("n02", "건수 4건은 표본 4건", wval({ transactionCount: 4 }), { low: "4" }, { moat: true });
ws("n03", "건수 칸이 없으면 표본 0건", { avgDeposit10k: 20264, avgMonthlyRent10k: 128 }, { low: "0" }, { moat: true });
ws("n04", "건수 \"9\"는 값(한 줄 표는 건수를 뺀다)", wval({ transactionCount: "9" }), WOK({ cnt: "9건", cntAll: null }));
ws("n05", "건수 NaN은 표본 NaN건", wval({ transactionCount: NaN }), { low: "NaN" }, { moat: true });
ws("n06", "건수 특수문자는 이스케이프", wval({ transactionCount: `4&<>"'` }), { low: `4&amp;&lt;&gt;&quot;'` }, { moat: true });
ws("o01", "표본 충분(25건)인데 보증금이 없으면 \"-\"(#593 b)", { avgMonthlyRent10k: 128, transactionCount: 25 }, { none: true });
ws("o02", "표본 충분(25건)인데 보증금이 null이면 \"-\"(#593 b)", wval({ avgDeposit10k: null }), { none: true });
ws("o03", "표본 충분(25건)인데 보증금이 문자열이면 \"-\"(#593 b)", wval({ avgDeposit10k: "20264" }), { none: true });
ws("o06", "경계: 보증금 null·5건(충분) → \"-\"", wval({ avgDeposit10k: null, transactionCount: 5 }), { none: true });
ws("o07", "경계: 보증금 null·4건 → 표본 부족 4건", wval({ avgDeposit10k: null, transactionCount: 4 }), { low: "4" }, { moat: true, order: true });
ws("o08", "경계: 보증금 null·1건 → 표본 부족 1건", wval({ avgDeposit10k: null, transactionCount: 1 }), { low: "1" }, { moat: true, order: true });
ws("o09", "경계: 보증금 null·0건 → 표본 부족 0건", wval({ avgDeposit10k: null, transactionCount: 0 }), { low: "0" }, { moat: true, order: true });
ws("o04", "순서: 지표가 {}(truthy)면 표본 부족 0건", {}, { low: "0" }, { moat: true, order: true });
ws("o05", "순서: 지표가 \"x\"면 표본 부족 0건", "x", { low: "0" }, { moat: true, order: true });
ws("z01", "지표가 없으면(키 없음) \"-\"", ABSENT, { none: true });
ws("z02", "지표 null이면 \"-\"", null, { none: true });
ws("z03", "지표 0이면 \"-\"", 0, { none: true });
ws("z04", "지표 빈 문자열이면 \"-\"", "", { none: true });
ws("z05", "지표 false면 \"-\"", false, { none: true });
ws("z06", "지표 undefined(키는 있다)면 \"-\"", undefined, { none: true });
const wc = (id, cond, change, chgText, extra = {}) => ws(id, cond, wval({ change, ...extra }), WOK({ chg: chgText }));
wc("c01", "증감 undefined → 없음", undefined, "");
wc("c02", "증감 null → 없음", null, "");
wc("c03", "증감 {} → 없음", {}, "");
wc("c04", "증감 percent 없음 → 없음", { value10k: 10 }, "");
wc("c05", "증감 percent 문자열 → 없음", { value10k: 10, percent: "1.8" }, "");
wc("c06", "증감 value10k 0 → 없음(percent가 있어도)", { value10k: 0, percent: 1.84 }, "");
wc("c07", "증감 내림 value10k -10·percent -3.06 → ▼3.1%", { value10k: -10, percent: -3.06 }, CHG("down", "▼", "3.1%", WOLSE_TITLE(BASE)));
wc("c08", "증감 value10k 없음·percent 1.8 → 방향은 내림(▼)", { percent: 1.84 }, CHG("down", "▼", "1.8%", WOLSE_TITLE(BASE)));
wc("c09", "증감 percent 0 → ▲0.0%", { value10k: 5, percent: 0 }, CHG("up", "▲", "0.0%", WOLSE_TITLE(BASE)));
wc("c10", "증감 percent NaN → ▲NaN%", { value10k: 5, percent: NaN }, CHG("up", "▲", "NaN%", WOLSE_TITLE(BASE)));
wc("c11", "증감 percent Infinity → ▲Infinity%", { value10k: 5, percent: Infinity }, CHG("up", "▲", "Infinity%", WOLSE_TITLE(BASE)));
wc("c12", "증감 percent 12.34 → ▲12.3%", { value10k: 5, percent: 12.34 }, CHG("up", "▲", "12.3%", WOLSE_TITLE(BASE)));
wc("c13", "증감 value10k 문자열 \"5\"(0이 아니다)·percent 숫자 → 방향은 \"5\" > 0이라 오름", { value10k: "5", percent: 2 }, CHG("up", "▲", "2.0%", WOLSE_TITLE(BASE)));
wc("c14", "증감 value10k null·percent 숫자 → null > 0 거짓이라 내림", { value10k: null, percent: 2 }, CHG("down", "▼", "2.0%", WOLSE_TITLE(BASE)));
wc("c15", "증감 5(truthy 비객체) → 없음", 5, "");
wc("b01", "기준일 없음 → 제목 없는 증감", { value10k: 10, percent: 1.84 }, CHG("up", "▲", "1.8%"), { baselineDate: undefined });
wc("b02", "기준일 빈 문자열 → 제목 없음", { value10k: 10, percent: 1.84 }, CHG("up", "▲", "1.8%"), { baselineDate: "" });
wc("b03", "기준일 특수문자 → 제목에서 이스케이프", { value10k: 10, percent: 1.84 }, CHG("up", "▲", "1.8%", WOLSE_TITLE(SP_OUT)), { baselineDate: SP });
wc("b04", "기준일 숫자 5 → \"5 대비 · …\"", { value10k: 10, percent: 1.84 }, CHG("up", "▲", "1.8%", WOLSE_TITLE("5")), { baselineDate: 5 });
wc("b05", "기준일 {} → \"[object Object] 대비 · …\"", { value10k: 10, percent: 1.84 }, CHG("up", "▲", "1.8%", WOLSE_TITLE("[object Object]")), { baselineDate: {} });

for (const s of WSTATES) {
  const shape = s.shape;
  const entry = { name: "강남구" };
  if (s.metric !== ABSENT) entry.wolse = s.metric;
  const flags = { moat: Boolean(s.moat), order: Boolean(s.order) };
  let all;
  let kindCells;
  let distCells;
  if (shape.none) {
    all = "-";
    kindCells = ["-", "-", "-"];
    distCells = NONE3;
  } else if (shape.low !== undefined) {
    all = LOW(shape.low);
    kindCells = [LOW(shape.low), "-", "-"];
    distCells = [LOW(shape.low), "-", "-"];
  } else {
    all = `${shape.dep} / 월 ${shape.rent}${shape.cntAll === null ? "" : ` ${COUNT(shape.cntAll)}`}`;
    kindCells = [STRONG(shape.dep), STRONG(`월 ${shape.rent}`) + shape.chg, COUNT(shape.cnt)];
    distCells = [`${STRONG(shape.dep)} / ${STRONG(`월 ${shape.rent}`)}`, "-", COUNT(shape.cnt)];
  }
  add(`TA-W-${s.id}`, "realestateTableHtml", `한 줄 표(wolse 칸): ${s.cond}`, [data([entry])], rowTr(link("강남구", "gangnam"), ["-", "-", all].map((c, i) => tdA(LBL.all[i], c))), flags);
  add(`TW-${s.id}`, "realestateTableHtml", `wolse 표: ${s.cond}`, [data([entry]), "wolse"], rowTr(link("강남구", "gangnam"), kindCells.map((c, i) => tdA(LBL.wolse[i], c))), flags);
  add(`DR-W-${s.id}`, "realestateTableHtml", `자치구 페이지(wolse 줄): ${s.cond}`, [data([entry]), null, "강남구"], distRows(NONE3, NONE3, distCells), flags);
}

// ================= 한 줄 표에서 세 칸이 서로 영향을 주지 않는다 =================
{
  const fn = "realestateTableHtml";
  const e = (o) => ({ name: "강남구", ...o });
  add(
    "TA-M01",
    fn,
    "세 칸이 따로 판정된다: 매매 표본 부족·전세 값 없음·월세 표본 부족(순서: 표본 부족이 값 없음보다 먼저, 한 줄 안에서도)",
    [data([e({ sale: sale({ transactionCount: 4 }), wolse: wolse({ transactionCount: 3 }) })])],
    rowTr(link("강남구", "gangnam"), [tdA(LBL.all[0], LOW("4")), tdA(LBL.all[1], "-"), tdA(LBL.all[2], LOW("3"))]),
    { moat: true, order: true }
  );
  add(
    "TA-M02",
    fn,
    "세 칸 모두 값(한 줄 표)",
    [data([dist("강남구")])],
    rowTr(link("강남구", "gangnam"), [
      tdA(LBL.all[0], `6,000만원${UP("120만원")} ${COUNT("40건")}`),
      tdA(LBL.all[1], `3,000만원${DOWN("50만원")} ${COUNT("30건")}`),
      tdA(LBL.all[2], `2억 264만원 / 월 128만원 ${COUNT("25건")}`),
    ])
  );
  add(
    "TA-M03",
    fn,
    "전세 표본 부족인데 매매는 값이면 전세가율·거래건수 칸도 \"-\"(전세 표, 칸 4개 - #593 a)",
    [data([e({ sale: sale(), jeonse: jeonse({ transactionCount: 2 }) })]), "jeonse"],
    rowTr(link("강남구", "gangnam"), [tdA("평당 보증금", LOW("2")), tdA("84㎡ 환산", "-"), tdA("전세가율", "-"), tdA("거래건수", "-")]),
    { moat: true }
  );
  add(
    "TJ-M04",
    fn,
    "전세 값이 있어도 매매 표본이 모자라면 전세가율은 \"-\"(칸은 4개)",
    [data([e({ sale: sale({ transactionCount: 4 }), jeonse: jeonse() })]), "jeonse"],
    rowTr(link("강남구", "gangnam"), [tdA("평당 보증금", STRONG("3,000만원") + DOWN("50만원")), tdA("84㎡ 환산", STRONG("7억 6,230만원")), tdA("전세가율", "-"), tdA("거래건수", COUNT("30건"))]),
    { moat: true }
  );
  add(
    "TJ-M05",
    fn,
    "전세가율은 전세 ÷ 매매(3000 ÷ 5530 = 54.2%)",
    [data([e({ sale: sale({ avgPricePerPyeong10k: 5530 }), jeonse: jeonse() })]), "jeonse"],
    rowTr(link("강남구", "gangnam"), [tdA("평당 보증금", STRONG("3,000만원") + DOWN("50만원")), tdA("84㎡ 환산", STRONG("7억 6,230만원")), tdA("전세가율", RATIO("54.2%")), tdA("거래건수", COUNT("30건"))])
  );
}

// ================= 자치구 페이지: 세 줄이 서로 영향을 주지 않는다 =================
{
  const fn = "realestateTableHtml";
  add(
    "DR-M01",
    fn,
    "세 줄 모두 값: 매매·전세는 평당가(+증감)·84㎡ 환산·건수, 월세는 보증금 / 월세·\"-\"·건수(증감 없음)",
    [data([dist("강남구")]), null, "강남구"],
    distRows(
      [STRONG("6,000만원") + UP("120만원"), STRONG("15억 2,459만원"), COUNT("40건")],
      [STRONG("3,000만원") + DOWN("50만원"), STRONG("7억 6,230만원"), COUNT("30건")],
      [`${STRONG("2억 264만원")} / ${STRONG("월 128만원")}`, "-", COUNT("25건")]
    )
  );
  add(
    "DR-M02",
    fn,
    "세 줄이 따로 판정된다: 매매 표본 부족·전세 값 없음·월세 표본 부족",
    [data([{ name: "강남구", sale: sale({ transactionCount: 4 }), wolse: wolse({ transactionCount: 3 }) }]), null, "강남구"],
    distRows([LOW("4"), "-", "-"], NONE3, [LOW("3"), "-", "-"]),
    { moat: true, order: true }
  );
  add("DR-M03", fn, "자치구 페이지는 낡음 태그를 내지 않는다(staleAt이 있어도)", [data([dist("강남구", { staleAt: "2026-10-04T15:30:00Z" })]), null, "강남구"], distRows(
    [STRONG("6,000만원") + UP("120만원"), STRONG("15억 2,459만원"), COUNT("40건")],
    [STRONG("3,000만원") + DOWN("50만원"), STRONG("7억 6,230만원"), COUNT("30건")],
    [`${STRONG("2억 264만원")} / ${STRONG("월 128만원")}`, "-", COUNT("25건")]
  ));
  add("DR-M04", fn, "자치구 페이지: 같은 이름이 둘이면 첫째만(find)", [data([dist("강남구"), dist("강남구", { sale: sale({ avgPricePerPyeong10k: 1 }) })]), null, "강남구"], distRows(
    [STRONG("6,000만원") + UP("120만원"), STRONG("15억 2,459만원"), COUNT("40건")],
    [STRONG("3,000만원") + DOWN("50만원"), STRONG("7억 6,230만원"), COUNT("30건")],
    [`${STRONG("2억 264만원")} / ${STRONG("월 128만원")}`, "-", COUNT("25건")]
  ));
  add("DR-M05", fn, "자치구 페이지: kind를 줘도 같은 표", [data([dist("강남구")]), "wolse", "강남구"], distRows(
    [STRONG("6,000만원") + UP("120만원"), STRONG("15억 2,459만원"), COUNT("40건")],
    [STRONG("3,000만원") + DOWN("50만원"), STRONG("7억 6,230만원"), COUNT("30건")],
    [`${STRONG("2억 264만원")} / ${STRONG("월 128만원")}`, "-", COUNT("25건")]
  ));
}

// ================= 서울 전체 줄·자치구 줄 =================
{
  const fn = "realestateTableHtml";
  const FULL_ALL = (name, stale = "") => [
    tdA(LBL.all[0], `6,000만원${UP("120만원")} ${COUNT("40건")}`),
    tdA(LBL.all[1], `3,000만원${DOWN("50만원")} ${COUNT("30건")}`),
    tdA(LBL.all[2], `2억 264만원 / 월 128만원 ${COUNT("25건")}`),
  ];
  add("TO-01", fn, "서울 전체만 있으면 한 줄·class=\"overall-row\"·링크 없는 이름", [data([], dist("서울"))], rowTr("서울 전체", FULL_ALL(), { overall: true }));
  add("TO-02", fn, "서울 전체 + 자치구 한 곳", [data([dist("강남구")], dist("서울"))], rowTr("서울 전체", FULL_ALL(), { overall: true }) + rowTr(link("강남구", "gangnam"), FULL_ALL()));
  add("TO-03", fn, "자치구만 있고 서울 전체가 없으면 서울 전체 줄이 없다", [data([dist("강남구")])], rowTr(link("강남구", "gangnam"), FULL_ALL()));
  add("TO-04", fn, "서울 전체의 이름은 자치구 이름이 아니라 \"서울 전체\"(overall에 name이 있어도)", [data([], { ...dist("서울"), name: "종로구" })], rowTr("서울 전체", FULL_ALL(), { overall: true }));
  add("TO-05", fn, "서울 전체 칸이 표본 부족이면 서울 전체 줄에도 표본 부족 스팬", [data([], { sale: sale({ transactionCount: 4 }) })], rowTr("서울 전체", [tdA(LBL.all[0], LOW("4")), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")], { overall: true }), { moat: true });
  add("TO-06", fn, "서울 전체 빈 객체 {}(truthy)는 줄을 낸다(칸 모두 \"-\")", [data([], {})], rowTr("서울 전체", [tdA(LBL.all[0], "-"), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")], { overall: true }));
  add("TO-07", fn, "서울 전체가 숫자 5(truthy 비객체)면 줄은 나오고 칸은 \"-\"", [data([], 5)], rowTr("서울 전체", [tdA(LBL.all[0], "-"), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")], { overall: true }));
  add("TO-08", fn, "sale 표에서 서울 전체 줄", [data([], dist("서울")), "sale"], rowTr("서울 전체", [tdA("평당가", STRONG("6,000만원") + UP("120만원")), tdA("84㎡ 환산", STRONG("15억 2,459만원")), tdA("거래건수", COUNT("40건"))], { overall: true }));
  add("TO-09", fn, "jeonse 표에서 서울 전체 줄(전세가율 포함)", [data([], dist("서울")), "jeonse"], rowTr("서울 전체", [tdA("평당 보증금", STRONG("3,000만원") + DOWN("50만원")), tdA("84㎡ 환산", STRONG("7억 6,230만원")), tdA("전세가율", RATIO("50.0%")), tdA("거래건수", COUNT("30건"))], { overall: true }));
  add("TO-10", fn, "wolse 표에서 서울 전체 줄", [data([], dist("서울")), "wolse"], rowTr("서울 전체", [tdA("평균 보증금", STRONG("2억 264만원")), tdA("평균 월세", STRONG("월 128만원") + CHG("up", "▲", "1.8%", WOLSE_TITLE(BASE))), tdA("거래건수", COUNT("25건"))], { overall: true }));
  add("TO-11", fn, "sale 표에서 서울 전체의 매매가 표본 부족이면 [스팬, -, -]", [data([], { sale: sale({ transactionCount: 4 }) }), "sale"], rowTr("서울 전체", [tdA("평당가", LOW("4")), tdA("84㎡ 환산", "-"), tdA("거래건수", "-")], { overall: true }), { moat: true });
  add("TO-12", fn, "jeonse 표에서 서울 전체의 전세가 표본 부족이면 값 칸이 넷이다(머리글 다섯 칸에 맞춘다 - #593 a)", [data([], { jeonse: jeonse({ transactionCount: 4 }) }), "jeonse"], rowTr("서울 전체", [tdA("평당 보증금", LOW("4")), tdA("84㎡ 환산", "-"), tdA("전세가율", "-"), tdA("거래건수", "-")], { overall: true }), { moat: true });
}

// ================= 이름 칸 =================
{
  const fn = "realestateTableHtml";
  const nm = (name) => ({ name, sale: sale() });
  const SALE_ROW = (nameHtml) => rowTr(nameHtml, [tdA(LBL.all[0], `6,000만원${UP("120만원")} ${COUNT("40건")}`), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")]);
  SLUGS.forEach(([name, slug], i) => add(`NM-L${String(i + 1).padStart(2, "0")}`, fn, `자치구 ${name}은 ./district-${slug}.html로 링크`, [data([nm(name)])], SALE_ROW(link(name, slug))));
  add("NM-01", fn, "자치구 25곳이 아닌 이름은 링크 없는 글자", [data([nm("없는구")])], SALE_ROW("없는구"));
  add("NM-02", fn, "이름 특수문자 & < > \" '는 이스케이프(' 는 그대로)", [data([nm(SP)])], SALE_ROW(SP_OUT));
  add("NM-03", fn, "이름 이미 이스케이프된 &amp;는 한 번 더", [data([nm("a&amp;b&#x27;")])], SALE_ROW("a&amp;amp;b&amp;#x27;"));
  add("NM-04", fn, "이름 없음(키 없음) → \"-\"", [data([{ sale: sale() }])], SALE_ROW("-"));
  add("NM-05", fn, "이름 null → \"-\"", [data([nm(null)])], SALE_ROW("-"));
  add("NM-06", fn, "이름 undefined → \"-\"", [data([nm(undefined)])], SALE_ROW("-"));
  add("NM-07", fn, "이름 빈 문자열은 그대로 빈 칸(?? 는 빈 문자열을 건너뛰지 않는다)", [data([nm("")])], SALE_ROW(""));
  add("NM-08", fn, "이름 false → \"false\"", [data([nm(false)])], SALE_ROW("false"));
  add("NM-09", fn, "이름 true → \"true\"", [data([nm(true)])], SALE_ROW("true"));
  add("NM-10", fn, "이름 숫자 0 → \"0\"", [data([nm(0)])], SALE_ROW("0"));
  add("NM-11", fn, "이름 NaN → \"NaN\"", [data([nm(NaN)])], SALE_ROW("NaN"));
  add("NM-12", fn, "이름 {} → \"[object Object]\"", [data([nm({})])], SALE_ROW("[object Object]"));
  add("NM-13", fn, "이름 [1,2] → \"1,2\"", [data([nm([1, 2])])], SALE_ROW("1,2"));
  add("NM-14", fn, "이름 [] → 빈 글자", [data([nm([])])], SALE_ROW(""));
  add("NM-15", fn, "이름이 [\"종로구\"]면 객체 키로 읽혀 종로구 링크(글자는 \"종로구\") - 예전 그대로", [data([nm(["종로구"])])], SALE_ROW(link("종로구", "jongno")));
  add("NM-16", fn, "이름 \"서울 전체\"인 자치구 줄은 링크 없는 글자·class 비어 있음", [data([nm("서울 전체")])], SALE_ROW("서울 전체"));
  add("NM-17", fn, "이름 \"constructor\"는 객체 기본 키지만 DISTRICT_SLUGS 자기 키가 아니라 링크 없는 글자(#248 c)", [data([nm("constructor")])], SALE_ROW("constructor"));
  add("NM-18", fn, "이름 \"__proto__\"도 링크 없는 글자(#248 c)", [data([nm("__proto__")])], SALE_ROW("__proto__"));
  add("NM-19", fn, "이름 \"toString\"도 링크 없는 글자(#248 c)", [data([nm("toString")])], SALE_ROW("toString"));
  add("NM-20", fn, "이름 개행·한글·이모지는 그대로", [data([nm("a\n한글 😀")])], SALE_ROW("a\n한글 😀"));
  add("NM-21", fn, "서울 전체 줄의 이름은 입력과 무관하게 고정(overall.name 특수문자)", [data([], { name: SP, sale: sale() }), "sale"], rowTr("서울 전체", [tdA("평당가", STRONG("6,000만원") + UP("120만원")), tdA("84㎡ 환산", STRONG("15억 2,459만원")), tdA("거래건수", COUNT("40건"))], { overall: true }));
  add("NM-22", fn, "이름이 toString()으로 자치구 이름을 돌려주는 객체면 링크(글자도 그 이름) - 객체를 React 자식으로 넘기면 던지므로 글자로 바꿔 낸다", [data([nm({ toString: () => "종로구" })])], SALE_ROW(link("종로구", "jongno")));
}

// ================= 낡음 태그 =================
{
  const fn = "realestateTableHtml";
  const SALE_ONLY = (stale, name = link("종로구", "jongno")) =>
    rowTr(name, [tdA(LBL.all[0], `6,000만원${UP("120만원")} ${COUNT("40건")}`), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")], { stale });
  const row = (staleAt) => [data([{ name: "종로구", sale: sale(), staleAt }])];
  add("ST-01", fn, "낡음: 받은 날짜가 있으면 이름 뒤에 태그(한국 날짜, 10월 5일 새벽 = UTC 4일 15:30)", row("2026-10-04T15:30:00Z"), SALE_ONLY(PREV("10. 5.")));
  add("ST-02", fn, "낡음: 한국 날짜로 하루 전(UTC 4일 14:59:59 = KST 4일 23:59)", row("2026-10-04T14:59:59Z"), SALE_ONLY(PREV("10. 4.")));
  add("ST-03", fn, "낡음: 해를 넘기면 1. 1.", row("2026-12-31T15:00:00Z"), SALE_ONLY(PREV("1. 1.")));
  add("ST-04", fn, "낡음: 날짜만(UTC 자정 = KST 오전 9시)", row("2026-01-05"), SALE_ONLY(PREV("1. 5.")));
  add("ST-05", fn, "낡음: 없음(키 없음) → 태그 없음", [data([{ name: "종로구", sale: sale() }])], SALE_ONLY(""));
  add("ST-06", fn, "낡음: null → 태그 없음", row(null), SALE_ONLY(""));
  add("ST-07", fn, "낡음: undefined → 태그 없음", row(undefined), SALE_ONLY(""));
  add("ST-08", fn, "낡음: 빈 문자열 → 태그 없음", row(""), SALE_ONLY(""));
  add("ST-09", fn, "낡음: 0 → 태그 없음(falsy)", row(0), SALE_ONLY(""));
  add("ST-10", fn, "낡음: false → 태그 없음", row(false), SALE_ONLY(""));
  add("ST-11", fn, "낡음: 날짜가 아닌 글자 → 태그 없음", row("그날쯤"), SALE_ONLY(""));
  add("ST-12", fn, "낡음: 특수문자 글자 → 날짜가 아니라 태그 없음", row(SP), SALE_ONLY(""));
  add("ST-13", fn, "낡음: 숫자 epoch(1760000000000)는 날짜로 읽는다 → 10. 9.", row(1760000000000), SALE_ONLY(PREV("10. 9.")));
  add("ST-14", fn, "낡음: true는 epoch 1ms라 날짜로 읽힌다 → 1. 1.", row(true), SALE_ONLY(PREV("1. 1.")));
  add("ST-15", fn, "낡음: {} → 날짜가 아니라 태그 없음", row({}), SALE_ONLY(""));
  add("ST-16", fn, "낡음: [](truthy) → 날짜가 아니라 태그 없음", row([]), SALE_ONLY(""));
  add("ST-17", fn, "낡음: NaN(falsy) → 태그 없음", row(NaN), SALE_ONLY(""));
  add("ST-18", fn, "낡음: [2026]은 날짜로 읽힌다 → 1. 1.", row([2026]), SALE_ONLY(PREV("1. 1.")));
  add("ST-19", fn, "낡음: 링크 없는 이름에도 태그", [data([{ name: "없는구", sale: sale(), staleAt: "2026-10-04T15:30:00Z" }])], SALE_ONLY(PREV("10. 5."), "없는구"));
  add("ST-20", fn, "낡음: 서울 전체 줄에도 태그(이름 뒤)", [data([], { sale: sale(), staleAt: "2026-10-04T15:30:00Z" })], rowTr("서울 전체", [tdA(LBL.all[0], `6,000만원${UP("120만원")} ${COUNT("40건")}`), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")], { overall: true, stale: PREV("10. 5.") }));
  add("ST-21", fn, "낡음: 값이 없는 줄(표본 부족)에도 태그", [data([{ name: "종로구", sale: sale({ transactionCount: 4 }), staleAt: "2026-10-04T15:30:00Z" }])], rowTr(link("종로구", "jongno"), [tdA(LBL.all[0], LOW("4")), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")], { stale: PREV("10. 5.") }), { moat: true });
  add("ST-22", fn, "낡음: sale 표에서도 이름 칸 안에 붙는다", [data([{ name: "종로구", sale: sale(), staleAt: "2026-10-04T15:30:00Z" }]), "sale"], rowTr(link("종로구", "jongno"), [tdA("평당가", STRONG("6,000만원") + UP("120만원")), tdA("84㎡ 환산", STRONG("15억 2,459만원")), tdA("거래건수", COUNT("40건"))], { stale: PREV("10. 5.") }));
  add("ST-23", fn, "낡음: 두 곳 중 한 곳만 낡았다", [data([{ name: "종로구", sale: sale(), staleAt: "2026-10-04T15:30:00Z" }, { name: "중구", sale: sale({ avgPricePerPyeong10k: 5000 }) }])], rowTr(link("종로구", "jongno"), [tdA(LBL.all[0], `6,000만원${UP("120만원")} ${COUNT("40건")}`), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")], { stale: PREV("10. 5.") }) + rowTr(link("중구", "jung"), [tdA(LBL.all[0], `5,000만원${UP("120만원")} ${COUNT("40건")}`), tdA(LBL.all[1], "-"), tdA(LBL.all[2], "-")]));
}

// ================= 정렬 reSorted =================
{
  const fn = "realestateTableHtml";
  // 기대값은 줄 전체가 아니라 이름 순서 목록으로 적는다(order, expect 없음). 칸 모양은 위 표가 지킨다.
  const mk = (name, s, j, w) => ({ name, ...(s === undefined ? {} : { sale: sale({ avgPricePerPyeong10k: s }) }), ...(j === undefined ? {} : { jeonse: jeonse({ avgDepositPerPyeong10k: j }) }), ...(w === undefined ? {} : { wolse: wolse({ avgDeposit10k: w }) }) });
  const sorted = (id, cond, args, order) => rows.push({ id, fn, cond, args, order });
  sorted("SO-01", "매매 평당가가 높은 순(kind 없음은 매매 기준)", [data([mk("가", 3000), mk("나", 9000), mk("다", 5000)])], ["나", "다", "가"]);
  sorted("SO-02", "kind sale도 같다", [data([mk("가", 3000), mk("나", 9000), mk("다", 5000)]), "sale"], ["나", "다", "가"]);
  sorted("SO-03", "kind jeonse는 전세 평당 보증금 순", [data([mk("가", 1, 100), mk("나", 1, 900), mk("다", 1, 500)]), "jeonse"], ["나", "다", "가"]);
  sorted("SO-04", "kind wolse는 평균 보증금 순", [data([mk("가", 1, 1, 100), mk("나", 1, 1, 900), mk("다", 1, 1, 500)]), "wolse"], ["나", "다", "가"]);
  sorted("SO-05", "kind 없음은 전세·월세 값을 보지 않는다(매매만)", [data([mk("가", 1, 999, 999), mk("나", 2, 1, 1)])], ["나", "가"]);
  sorted("SO-06", "값이 같으면 들어온 순서(안정 정렬)", [data([mk("다", 5000), mk("가", 5000), mk("나", 5000)])], ["다", "가", "나"]);
  sorted("SO-07", "값이 없는 곳(지표 없음)은 뒤", [data([{ name: "가" }, mk("나", 3000), mk("다", 9000)])], ["다", "나", "가"]);
  sorted("SO-08", "표본 부족인 곳도 값이 없는 것으로 쳐 뒤(값이 커도)", [data([{ name: "가", sale: sale({ avgPricePerPyeong10k: 99999, transactionCount: 4 }) }, mk("나", 3000)])], ["나", "가"]);
  sorted("SO-09", "값이 둘 다 없으면 이름순(한글 가나다)", [data([mk("다"), mk("가"), mk("나")])], ["가", "나", "다"]);
  sorted("SO-10", "값 있는 곳이 앞, 값 없는 곳은 이름순으로 뒤", [data([mk("다"), mk("나", 1000), mk("가"), mk("라", 2000)])], ["라", "나", "가", "다"]);
  sorted("SO-11", "kind jeonse에서 전세 값이 없는 곳은 뒤(매매 값이 커도)", [data([mk("가", 9999), mk("나", 1, 100)]), "jeonse"], ["나", "가"]);
  sorted("SO-12", "kind wolse에서 월세 값이 없는 곳은 뒤", [data([mk("가", 9999, 9999), mk("나", 1, 1, 100)]), "wolse"], ["나", "가"]);
  sorted("SO-13", "이름이 없는 두 곳은 이름 \"\"로 비교해 같다(들어온 순서)", [data([{ sale: sale({ avgPricePerPyeong10k: undefined, transactionCount: 4 }) }, { }])], ["-", "-"]);
  sorted("SO-14", "값 음수도 비교된다(-5 < 0 < 10)", [data([mk("가", -5), mk("나", 0), mk("다", 10)])], ["다", "나", "가"]);
  sorted("SO-15", "서울 전체 줄은 정렬에 끼지 않고 맨 앞", [data([mk("가", 3000), mk("나", 9000)], dist("서울"))], ["서울 전체", "나", "가"]);
  sorted("SO-16", "소수 값 비교(5000.5 > 5000.4)", [data([mk("가", 5000.4), mk("나", 5000.5)])], ["나", "가"]);
  sorted("SO-17", "같은 값 둘 + 값 없는 곳 + 높은 값: 안정성과 뒤로 보내기", [data([mk("라"), mk("가", 5000), mk("나", 9000), mk("다", 5000)])], ["나", "가", "다", "라"]);
  sorted("SO-18", "라틴 이름 두 개(값 없음)는 이름순 a < b", [data([mk("b"), mk("a")])], ["a", "b"]);
}

// ================= 실제 모양 한 벌 =================
{
  const fn = "realestateTableHtml";
  const REAL = data(
    [
      { name: "노원구", sale: sale({ avgPricePerPyeong10k: 3000 }), jeonse: jeonse({ avgDepositPerPyeong10k: 2000 }), wolse: wolse({ avgDeposit10k: 10000 }) },
      { name: "강남구", sale: sale(), jeonse: jeonse(), wolse: wolse({ transactionCount: 4 }) },
      { name: "종로구", sale: sale({ transactionCount: 3 }), jeonse: jeonse({ transactionCount: 2 }), wolse: wolse({ avgDeposit10k: 20264 }), staleAt: "2026-10-04T15:30:00Z" },
    ],
    dist("서울")
  );
  const cellsAll = (s, j, w) => [tdA(LBL.all[0], s), tdA(LBL.all[1], j), tdA(LBL.all[2], w)];
  add(
    "TR-01",
    fn,
    "실제 모양(서울 전체 + 세 자치구, 표본 부족·낡음 섞임): 한 줄 표는 매매 평당가 순(강남 6000 > 노원 3000 > 표본 부족 종로)",
    [REAL],
    rowTr("서울 전체", cellsAll(`6,000만원${UP("120만원")} ${COUNT("40건")}`, `3,000만원${DOWN("50만원")} ${COUNT("30건")}`, `2억 264만원 / 월 128만원 ${COUNT("25건")}`), { overall: true }) +
      rowTr(link("강남구", "gangnam"), cellsAll(`6,000만원${UP("120만원")} ${COUNT("40건")}`, `3,000만원${DOWN("50만원")} ${COUNT("30건")}`, LOW("4"))) +
      rowTr(link("노원구", "nowon"), cellsAll(`3,000만원${UP("120만원")} ${COUNT("40건")}`, `2,000만원${DOWN("50만원")} ${COUNT("30건")}`, `1억원 / 월 128만원 ${COUNT("25건")}`)) +
      rowTr(link("종로구", "jongno"), cellsAll(LOW("3"), LOW("2"), `2억 264만원 / 월 128만원 ${COUNT("25건")}`), { stale: PREV("10. 5.") }),
    { moat: true }
  );
  add(
    "TR-02",
    fn,
    "실제 모양, 월세 표: 평균 보증금 순(종로 2억 264만원·강남 2억 264만원은 표본 부족이라 뒤·노원 1억원)",
    [REAL, "wolse"],
    rowTr("서울 전체", [tdA("평균 보증금", STRONG("2억 264만원")), tdA("평균 월세", STRONG("월 128만원") + CHG("up", "▲", "1.8%", WOLSE_TITLE(BASE))), tdA("거래건수", COUNT("25건"))], { overall: true }) +
      rowTr(link("종로구", "jongno"), [tdA("평균 보증금", STRONG("2억 264만원")), tdA("평균 월세", STRONG("월 128만원") + CHG("up", "▲", "1.8%", WOLSE_TITLE(BASE))), tdA("거래건수", COUNT("25건"))], { stale: PREV("10. 5.") }) +
      rowTr(link("노원구", "nowon"), [tdA("평균 보증금", STRONG("1억원")), tdA("평균 월세", STRONG("월 128만원") + CHG("up", "▲", "1.8%", WOLSE_TITLE(BASE))), tdA("거래건수", COUNT("25건"))]) +
      rowTr(link("강남구", "gangnam"), [tdA("평균 보증금", LOW("4")), tdA("평균 월세", "-"), tdA("거래건수", "-")]),
    { moat: true }
  );
  add(
    "TR-03",
    fn,
    "실제 모양, 전세 표: 전세 평당 보증금 순(강남 3000 > 노원 2000 > 표본 부족 종로, 종로는 값 칸 넷 - #593 a)",
    [REAL, "jeonse"],
    rowTr("서울 전체", [tdA("평당 보증금", STRONG("3,000만원") + DOWN("50만원")), tdA("84㎡ 환산", STRONG("7억 6,230만원")), tdA("전세가율", RATIO("50.0%")), tdA("거래건수", COUNT("30건"))], { overall: true }) +
      rowTr(link("강남구", "gangnam"), [tdA("평당 보증금", STRONG("3,000만원") + DOWN("50만원")), tdA("84㎡ 환산", STRONG("7억 6,230만원")), tdA("전세가율", RATIO("50.0%")), tdA("거래건수", COUNT("30건"))]) +
      rowTr(link("노원구", "nowon"), [tdA("평당 보증금", STRONG("2,000만원") + DOWN("50만원")), tdA("84㎡ 환산", STRONG("5억 820만원")), tdA("전세가율", RATIO("66.7%")), tdA("거래건수", COUNT("30건"))]) +
      rowTr(link("종로구", "jongno"), [tdA("평당 보증금", LOW("2")), tdA("84㎡ 환산", "-"), tdA("전세가율", "-"), tdA("거래건수", "-")], { stale: PREV("10. 5.") }),
    { moat: true }
  );
}

export const REALESTATE_TABLE_BRANCHES = rows;

// ================= 던지는 입력 =================
// 예전 코드가 TypeError를 던지는 입력. React 조각도 같은 함수를 부르므로 같이 던진다(조용히 빈 표를 내지 않는다).
export const REALESTATE_TABLE_THROWS = [];
{
  const t = (id, cond, args) => REALESTATE_TABLE_THROWS.push({ id, fn: "realestateTableHtml", cond, args });
  t("T-01", "districts 항목이 null(이름을 읽다 던진다)", [{ districts: [null] }]);
  t("T-02", "districts 항목이 null 둘(정렬이 이름을 읽다 던진다)", [{ districts: [null, null] }]);
  t("T-03", "districts 항목이 undefined", [{ districts: [undefined] }]);
  t("T-04", "자치구 페이지: districts가 문자열(find가 없다)", [{ districts: "ab" }, null, "종로구"]);
  t("T-05", "자치구 페이지: districts 항목이 null(find가 이름을 읽다 던진다)", [{ districts: [null] }, null, "종로구"]);
  t("T-06", "모르는 kind \"foo\"는 지표 이름을 찾지 못해 던진다(서울 전체 줄)", [{ overall: { sale: sale() } }, "foo"]);
  t("T-07", "모르는 kind \"foo\"(자치구 줄)", [{ districts: [dist("종로구")] }, "foo"]);
  t("T-08", "서울 전체가 있고 districts가 숫자 5(펼칠 수 없다)", [{ overall: sale(), districts: 5 }]);
  t("T-09", "서울 전체가 있고 districts가 객체 {}(펼칠 수 없다)", [{ overall: sale(), districts: {} }]);
  t("T-10", "서울 전체가 있고 districts가 true", [{ overall: sale(), districts: true }]);
}

export const REALESTATE_TABLE_FNS = ["realestateHeadHtml", "realestateTableHtml"];
