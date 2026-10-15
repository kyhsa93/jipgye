// ratesHtml·ratesHeadHtml 분기별 고정 fixture (#240). 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않는다.
// 한 줄이 한 분기다. `args`는 legacy 함수에 그대로 넘기는 인자이고, `expect`는 legacy가 내야 하는 글자 - 마크업은 일부러 손으로
// 적었다(조립 도우미가 마크업을 만들면 legacy·JSX 어느 쪽이 바뀌어도 도우미가 같이 따라가 걸리지 않는다). 데이터가 없으면 null.
// `order`는 첫 칸 상품 이름의 순서만 보는 분기(정렬·limit)다. test/render-parity.test.mjs가 이 표로
// (1) legacy 출력이 expect·order와 같은지, (2) React 조각이 legacy와 바이트까지 같은지, (3) 표의 모든 id가 분기 목록에 있는지 견준다.
// 세후 이자 값은 interest.mjs 공식으로 손계산했다: 예금 1천만 원 단리 r% = 10,000,000 x r/100 x 0.846,
// 적금 월 30만 원 12개월 월복리 연 4% = 66,801원, 예금 월복리 연 3% = 257,319원.

const product = (name, options) => ({ name, company: "은행", options });
// 예금·적금 옵션: 12개월 단리. maxRate 생략이면 undefined.
const sv = (rate, maxRate, extra = {}) => ({ term: 12, rate, maxRate, rateTypeName: "단리", ...extra });
const loan = (rateType, min, max, avg) => ({ rateType, min, max, avg });

// class 문자열은 #279에서 Tailwind 유틸리티가 더해진 뒤의 것이다 - 훅/legacy class는 그대로 두고 뒤에 붙는다(지우지 않는다).
const tr = (name, company, tds) => `<tr><td><div class="product-name tw:whitespace-normal tw:break-keep">${name}</div><div class="product-company tw:text-xs tw:text-muted">${company}</div></td>${tds}</tr>`;
const savingTds = (base, max, net) =>
  `<td data-label="기본금리">${base}</td><td class="rate-strong tw:font-semibold tw:text-up" data-label="최고금리">${max}</td><td class="net-interest tw:font-bold" data-label="세후 이자">${net}</td>`;
const loanTds = (type, range, avg) =>
  `<td data-label="금리 유형">${type}</td><td data-label="금리(최저~최고)">${range}</td><td class="rate-low tw:font-semibold tw:text-down" data-label="평균">${avg}</td>`;

const SAVING_HEAD = '<tr><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">상품</th><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">기본금리</th><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">최고금리</th><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">세후 이자</th></tr>';
const LOAN_HEAD = '<tr><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">상품</th><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">금리 유형</th><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">금리(최저~최고)</th><th scope="col" class="tw:text-muted tw:text-xs tw:font-semibold">평균</th></tr>';

const M = { category: "mortgage" };

export const RATES_BRANCHES = [
  // ---- ratesHtml: 데이터 없음 → null ----
  { id: "R1", fn: "ratesHtml", cond: "rates가 null → null", args: [null], expect: null },
  { id: "R2", fn: "ratesHtml", cond: "그 상품군 키가 없다 → null", args: [{ saving: [product("x", [sv(1, 2)])] }, M], expect: null },
  { id: "R3", fn: "ratesHtml", cond: "상품 배열이 비었다 → null", args: [{ deposit: [] }], expect: null },
  { id: "R8a", fn: "ratesHtml", cond: "저축: 12개월 옵션이 하나도 없는 상품만 있어 행이 비었다 → null", args: [{ deposit: [product("a", [sv(1, 2, { term: 6 })]), product("b", [sv(1, 2, { term: 24 })])] }], expect: null },
  { id: "R11a", fn: "ratesHtml", cond: "상품에 options가 없거나 비어 행이 없다 → null", args: [{ mortgage: [{ name: "a" }, { name: "b", options: [] }] }, M], expect: null },

  // ---- 저축 분기(saving true): 예금·적금 ----
  { id: "R4", fn: "ratesHtml", cond: "기본 인자(category 생략=deposit, limit 생략=20): 예금 한 행, 세후 이자는 1천만 원 기준", args: [{ deposit: [product("예금A", [sv(3, 3.5)])] }], expect: tr("예금A", "은행", savingTds("3.00%", "3.50%", "296,100원")) },
  { id: "R5a", fn: "ratesHtml", cond: "category=saving(적금), 월복리: 세후 이자는 월 30만 원 납입 기준(saving=true)", args: [{ saving: [product("적금A", [sv(3, 4, { rateTypeName: "월복리" })])] }, { category: "saving" }], expect: tr("적금A", "은행", savingTds("3.00%", "4.00%", "66,801원")) },
  { id: "R5b", fn: "ratesHtml", cond: "category=saving, 단리 옵션(복리 분기의 반대)", args: [{ saving: [product("적금B", [sv(3, 4)])] }, { category: "saving" }], expect: tr("적금B", "은행", savingTds("3.00%", "4.00%", "65,988원")) },
  { id: "R5c", fn: "ratesHtml", cond: "예금(category 기본) 월복리 옵션: 복리 이자 공식", args: [{ deposit: [product("예금C", [sv(3, 3, { rateTypeName: "월복리" })])] }], expect: tr("예금C", "은행", savingTds("3.00%", "3.00%", "257,319원")) },
  { id: "R5d", fn: "ratesHtml", cond: "옵션에 rateTypeName이 없으면 단리로 계산(복리 판정이 빈 문자열로 떨어진다)", args: [{ deposit: [product("예금D", [{ term: 12, rate: 3, maxRate: 3.5 }])] }], expect: tr("예금D", "은행", savingTds("3.00%", "3.50%", "296,100원")) },
  { id: "R6", fn: "ratesHtml", cond: "저축 정렬은 최고금리(maxRate) 내림차순", args: [{ deposit: [product("낮", [sv(1, 2)]), product("높", [sv(1, 5)]), product("중", [sv(1, 3)])] }], order: ["높", "중", "낮"] },
  { id: "R7", fn: "ratesHtml", cond: "저축은 12개월 옵션만 본다(6개월의 더 높은 값은 건너뜀)·12개월 중 최고값 선택·같은 값이면 먼저 나온 옵션 유지", args: [{ deposit: [product("a", [sv(1, 9, { term: 6 }), sv(1, 3), sv(1.5, 4), sv(2, 4)])] }], expect: tr("a", "은행", savingTds("1.50%", "4.00%", "338,400원")) },
  { id: "R8b", fn: "ratesHtml", cond: "저축: 12개월 옵션 없는 상품은 행에서 빠지고 나머지만 남는다", args: [{ deposit: [product("뺀다", [sv(1, 9, { term: 6 })]), product("남는다", [sv(1, 2)])] }], order: ["남는다"] },
  { id: "R9", fn: "ratesHtml", cond: "옵션 값(maxRate)이 null·undefined면 비교에서 빠지고, 값 있는 옵션이 첫 후보(fallback)보다 우선", args: [{ deposit: [product("a", [sv(1, null), sv(1, undefined), sv(0.5, 2.5)])] }], expect: tr("a", "은행", savingTds("0.50%", "2.50%", "211,500원")) },
  { id: "R10a", fn: "ratesHtml", cond: "값이 하나도 없으면 첫 12개월 옵션이 fallback 행이 되어 정렬 맨 뒤(둘 다 fallback이면 입력 순서)", args: [{ deposit: [product("값없음", [sv(2, null)]), product("값있음", [sv(1, 1.5)]), product("값없음2", [sv(3, null)])] }], order: ["값있음", "값없음", "값없음2"] },
  { id: "R11b", fn: "ratesHtml", cond: "options가 없거나 빈 상품은 행이 없다(다른 상품은 남는다)", args: [{ deposit: [{ name: "옵션없음" }, product("빈옵션", []), product("남는다", [sv(1, 2)])] }], order: ["남는다"] },
  { id: "R22", fn: "ratesHtml", cond: "값 0은 null이 아니다(maxRate 0 옵션이 비교에 들고, rate(0)은 0.00%)", args: [{ deposit: [product("널", [sv(1, null)]), product("영", [sv(0, 0)])] }], order: ["영", "널"] },
  { id: "R17", fn: "ratesHtml", cond: "최고금리 칸은 maxRate ?? rate: maxRate가 없으면 기본금리, 둘 다 숫자가 아니면 '-'(세후 이자도 '-')", args: [{ deposit: [product("a", [sv(2, undefined)]), product("b", [sv(null, null)])] }], expect: tr("a", "은행", savingTds("2.00%", "2.00%", "169,200원")) + tr("b", "은행", savingTds("-", "-", "-")) },
  { id: "R16a", fn: "ratesHtml", cond: "rate()가 숫자가 아니면 '-'(문자열 '3'·'4')", args: [{ deposit: [product("a", [sv("3", "4")])] }], expect: tr("a", "은행", savingTds("-", "-", "-")) },

  // ---- 대출 분기(saving false): mortgage·rentLoan ----
  { id: "R12a", fn: "ratesHtml", cond: "대출 정렬은 최저금리(min) 오름차순", args: [{ mortgage: [product("높", [loan("고정", 5, 6, 5.5)]), product("낮", [loan("변동", 3, 4, 3.5)]), product("중", [loan("고정", 4, 5, 4.5)])] }, M], order: ["낮", "중", "높"] },
  { id: "R12b", fn: "ratesHtml", cond: "대출은 term으로 거르지 않고 옵션 중 최저 min을 고른다", args: [{ mortgage: [product("a", [{ ...loan("고정", 3, 4, 3.5), term: 6 }, { ...loan("변동", 2.5, 4, 3), term: 36 }])] }, M], expect: tr("a", "은행", loanTds("변동", "2.50~4.00%", "3.00%")) },
  { id: "R12c", fn: "ratesHtml", cond: "대출 한 행의 칸: 금리 유형·최저~최고·평균(소수 둘째 자리 반올림)", args: [{ mortgage: [product("주담대", [loan("고정금리", 3.1, 4.25, 3.678)])] }, M], expect: tr("주담대", "은행", loanTds("고정금리", "3.10~4.25%", "3.68%")) },
  { id: "R13", fn: "ratesHtml", cond: "category=rentLoan도 대출 분기", args: [{ rentLoan: [product("전세대출B", [loan("변동", 2, 3, 2.5)])] }, { category: "rentLoan" }], expect: tr("전세대출B", "은행", loanTds("변동", "2.00~3.00%", "2.50%")) },
  { id: "R14", fn: "ratesHtml", cond: "대출: min이 null이면 비교에서 빠지고 그 상품은 fallback으로 맨 뒤", args: [{ mortgage: [product("값없음", [loan("고정", null, 9, 8)]), product("값있음", [loan("고정", 7, 9, 8)])] }, M], order: ["값있음", "값없음"] },
  { id: "R10b", fn: "ratesHtml", cond: "대출: 같은 값이면 먼저 나온 옵션 유지", args: [{ mortgage: [product("a", [loan("먼저", 3, 4, 3.5), loan("나중", 3, 5, 4)])] }, M], expect: tr("a", "은행", loanTds("먼저", "3.00~4.00%", "3.50%")) },
  { id: "R16b", fn: "ratesHtml", cond: "대출 평균(avg)이 없으면 '-'", args: [{ mortgage: [product("a", [loan("고정", 3, 4, undefined)])] }, M], expect: tr("a", "은행", loanTds("고정", "3.00~4.00%", "-")) },
  { id: "R18a", fn: "ratesHtml", cond: "rateRange: max가 숫자가 아니면 min 한 값", args: [{ mortgage: [product("a", [loan("고정", 3, "x", 3)])] }, M], expect: tr("a", "은행", loanTds("고정", "3.00%", "3.00%")) },
  { id: "R18b", fn: "ratesHtml", cond: "rateRange: min이 null이고 max만 있으면 max 한 값(정렬은 min 없음으로 fallback)", args: [{ mortgage: [product("a", [loan("고정", null, 4, 3)])] }, M], expect: tr("a", "은행", loanTds("고정", "4.00%", "3.00%")) },
  { id: "R18c", fn: "ratesHtml", cond: "rateRange: 둘 다 없으면 '-'", args: [{ mortgage: [product("a", [loan("고정", null, undefined, 3)])] }, M], expect: tr("a", "은행", loanTds("고정", "-", "3.00%")) },

  // ---- limit ----
  { id: "R15a", fn: "ratesHtml", cond: "limit=2면 정렬 뒤 앞 두 행만", args: [{ deposit: [product("1", [sv(1, 1)]), product("3", [sv(1, 3)]), product("2", [sv(1, 2)])] }, { limit: 2 }], order: ["3", "2"] },
  { id: "R15b", fn: "ratesHtml", cond: "limit=0이면 빈 문자열(null이 아니다)", args: [{ deposit: [product("a", [sv(1, 2)])] }, { limit: 0 }], expect: "" },
  { id: "R15c", fn: "ratesHtml", cond: "limit 생략이면 스무 행(상품 22개 중 최고금리 상위 20)", args: [{ deposit: Array.from({ length: 22 }, (_, i) => product(`p${String(i).padStart(2, "0")}`, [sv(1, 1 + i / 100)])) }], order: Array.from({ length: 20 }, (_, i) => `p${String(21 - i).padStart(2, "0")}`) },

  // ---- 누락 필드·특수문자 ----
  {
    id: "R20a", fn: "ratesHtml", cond: "name 누락→'-'·company 누락→''; name ''은 그대로 빈 칸·company null→''",
    args: [{ deposit: [{ options: [sv(1, 2)] }, { name: "", company: null, options: [sv(1, 1)] }] }],
    expect: tr("-", "", savingTds("1.00%", "2.00%", "169,200원")) + tr("", "", savingTds("1.00%", "1.00%", "84,600원")),
  },
  {
    id: "R20c", fn: "ratesHtml", cond: "비문자열 name·company(false·0·{}·[1,2]·true): legacy는 String()으로 'false'·'0'·'[object Object]'·'1,2'·'true'(전수 변이 #241 PR 2가 찾은 자리 - String()을 빼면 React는 false·{}를 비운다)",
    args: [{ deposit: [{ name: false, company: 0, options: [sv(1, 2)] }, { name: 0, company: false, options: [sv(1, 2)] }, { name: {}, company: [1, 2], options: [sv(1, 2)] }, { name: [1, 2], company: {}, options: [sv(1, 2)] }, { name: true, company: true, options: [sv(1, 2)] }] }],
    expect: tr("false", "0", savingTds("1.00%", "2.00%", "169,200원")) + tr("0", "false", savingTds("1.00%", "2.00%", "169,200원")) + tr("[object Object]", "1,2", savingTds("1.00%", "2.00%", "169,200원")) +
      tr("1,2", "[object Object]", savingTds("1.00%", "2.00%", "169,200원")) + tr("true", "true", savingTds("1.00%", "2.00%", "169,200원")),
  },
  {
    id: "R20d", fn: "ratesHtml", cond: "비문자열 rateType(false·0·{}·[1,2]·true): 대출 칸에 'false'·'0'·'[object Object]'·'1,2'·'true'(null만 '-')",
    args: [{ mortgage: ["a", "b", "c", "d", "e"].map((name, i) => product(name, [loan([false, 0, {}, [1, 2], true][i], 3, 4, 3.5)])) }, M],
    expect: [["a", "false"], ["b", "0"], ["c", "[object Object]"], ["d", "1,2"], ["e", "true"]].map(([name, type]) => tr(name, "은행", loanTds(type, "3.00~4.00%", "3.50%"))).join(""),
  },
  { id: "R20b", fn: "ratesHtml", cond: "대출 rateType이 null이면 '-'", args: [{ mortgage: [product("a", [loan(null, 3, 4, 3.5)])] }, M], expect: tr("a", "은행", loanTds("-", "3.00~4.00%", "3.50%")) },
  { id: "R21a", fn: "ratesHtml", cond: "특수문자 & < > \" '(저축 name·company): 앞 넷은 양쪽이 같은 엔티티, '는 래퍼가 되돌려 그대로", args: [{ deposit: [{ name: `A&B <i> "q" it's`, company: `C'D & <E>`, options: [sv(1, 2)] }] }], expect: tr("A&amp;B &lt;i&gt; &quot;q&quot; it's", "C'D &amp; &lt;E&gt;", savingTds("1.00%", "2.00%", "169,200원")) },
  { id: "R21b", fn: "ratesHtml", cond: "특수문자(대출 name·rateType)", args: [{ mortgage: [{ name: `m"<>&'`, company: "c", options: [loan(`T&<>"'`, 3, 4, 3.5)] }] }, M], expect: tr("m&quot;&lt;&gt;&amp;'", "c", loanTds("T&amp;&lt;&gt;&quot;'", "3.00~4.00%", "3.50%")) },

  // ---- ratesHeadHtml ----
  { id: "H1", fn: "ratesHeadHtml", cond: "deposit → 저축 머리글", args: ["deposit"], expect: SAVING_HEAD },
  { id: "H2", fn: "ratesHeadHtml", cond: "saving → 저축 머리글", args: ["saving"], expect: SAVING_HEAD },
  { id: "H3", fn: "ratesHeadHtml", cond: "mortgage → 대출 머리글", args: ["mortgage"], expect: LOAN_HEAD },
  { id: "H4", fn: "ratesHeadHtml", cond: "rentLoan → 대출 머리글", args: ["rentLoan"], expect: LOAN_HEAD },
  { id: "H5", fn: "ratesHeadHtml", cond: "기본 인자(생략=deposit) → 저축 머리글", args: [], expect: SAVING_HEAD },
  { id: "H6", fn: "ratesHeadHtml", cond: "null·알 수 없는 상품군 → 대출 머리글", args: [null], expect: LOAN_HEAD },
];
