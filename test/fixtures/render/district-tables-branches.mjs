// 자치구 문장·링크 4개와 표 6개 조각의 분기별 고정 fixture (#242 PR 1): districtSummaryHtml·districtRenewalHtml·districtFactsHtml·districtLinksHtml·
// conversionTableHtml·cancelDistrictsHtml·cancelMonthsHtml·renewalDistrictsHtml·renewalWolseDistrictsHtml·floorDistrictsHtml.
// 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않고 코드(district-slugs.mjs 등)도 부르지 않는다 - 자치구 25곳과 slug도 여기에 손으로 적었다.
// 한 줄이 한 분기다. `args`는 조각 함수에 그대로 넘기는 인자이고, `expect`는 React 조각이 내야 하는 글자다. 기대값은 글자 틀(`cvRow`·`LOW()` 등 감싸는 마크업)과
// 아래 값 표(값 → 칸에 나오는 글자)를 손으로 적어 이은 것이고, 입력을 가공해 만들지 않는다.
// test/render-parity.test.mjs가 이 표로 React 조각 출력이 expect와 같은지 견준다.
//
// 모든 조각에 같은 종류의 값 행을 넣었다(#240·#241 교훈 - `str()`을 빼도 시험이 통과하는 자리를 닫는다):
//  - 비문자열: true·false·0·NaN·{}·[1,2]·[] (이스케이프하던 칸은 `String(value ?? "")`이라 "true"·"false"·"0"·"NaN"·"[object Object]"·"1,2"·""로 나온다)
//  - null·undefined(이름 칸은 빈 글자, 값 칸은 "-" 또는 "null%"·"undefined%"처럼 legacy가 문자열에 끼우던 그대로)
//  - 특수문자 & < > " ' (이스케이프하던 칸은 `&amp;`·`&lt;`·`&gt;`·`&quot;`, `'`는 그대로)와 이미 이스케이프된 &amp;·&#x27;(한 번 더 이스케이프된다)
//  - 빈 값 행: 데이터 없음 null·undefined·{}·빈 목록 → null(자리표시를 비운다)
// 이스케이프 없이 문자열에 끼우던 칸(raw)에 특수문자가 든 문자열이 오면 React는 이스케이프해서 낸다(옛 legacy는 그대로 냈다) - 그 입력은 이 표가 아니라 RAW_TEXT_DIFF가 React의 글자를 적어 고정한다.

const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`;

// ================= 값 표 =================
// [번호, 조건, 입력 값, 이스케이프하던 이름 칸에 나오는 글자]
const NAME_VALUES = [
  ["a01", "보통 이름", "종로구", "종로구"],
  ["a02", `특수문자 & < > " '`, SP, SP_OUT],
  ["a03", "빈 문자열", "", ""],
  ["a04", "null → 빈 글자", null, ""],
  ["a05", "undefined → 빈 글자", undefined, ""],
  ["a06", "비문자열 false → \"false\"", false, "false"],
  ["a07", "비문자열 true → \"true\"", true, "true"],
  ["a08", "숫자 0 → \"0\"", 0, "0"],
  ["a09", "NaN → \"NaN\"", NaN, "NaN"],
  ["a10", "비문자열 {} → \"[object Object]\"", {}, "[object Object]"],
  ["a11", "비문자열 [1,2] → \"1,2\"", [1, 2], "1,2"],
  ["a12", "빈 배열 → 빈 글자", [], ""],
  ["a13", "이미 이스케이프된 &amp;·&#x27;은 한 번 더 이스케이프된다", "a&amp;b&#x27;", "a&amp;amp;b&amp;#x27;"],
  ["a14", "개행·한글·이모지는 그대로", "a\n한글 😀", "a\n한글 😀"],
];

// 이스케이프 없이 `${값}%`로 끼우던 칸(raw)의 글자. 특수문자가 든 문자열은 넣지 않았다(RAW_TEXT_DIFF).
const RAW_PCT_VALUES = [
  ["r01", "소수", 4.97, "4.97%"],
  ["r02", "0", 0, "0%"],
  ["r03", "음수", -3, "-3%"],
  ["r04", "숫자 모양 문자열", "5", "5%"],
  ["r05", "null은 \"null%\"", null, "null%"],
  ["r06", "undefined는 \"undefined%\"", undefined, "undefined%"],
  ["r07", "NaN", NaN, "NaN%"],
  ["r08", "false", false, "false%"],
  ["r09", "true", true, "true%"],
  ["r10", "{} → \"[object Object]%\"", {}, "[object Object]%"],
  ["r11", "[1,2] → \"1,2%\"", [1, 2], "1,2%"],
  ["r12", "빈 배열 → \"%\"", [], "%"],
  ["r13", "빈 문자열 → \"%\"", "", "%"],
];

// `pct()`를 거쳐 이스케이프하던 칸의 글자(null·undefined만 "-", 나머지는 값이다)
const PCT_VALUES = [
  ["p01", "값 2.3", 2.3, "2.3%"],
  ["p02", "0은 값이다", 0, "0%"],
  ["p03", "음수", -4, "-4%"],
  ["p04", "null → \"-\"", null, "-"],
  ["p05", "undefined → \"-\"", undefined, "-"],
  ["p06", "false는 값이다 → \"false%\"", false, "false%"],
  ["p07", "빈 문자열은 값이다 → \"%\"", "", "%"],
  ["p08", "NaN → \"NaN%\"", NaN, "NaN%"],
  ["p09", "{} → \"[object Object]%\"", {}, "[object Object]%"],
  ["p10", "[1,2] → \"1,2%\"", [1, 2], "1,2%"],
  ["p11", "특수문자는 이스케이프된다", SP, `${SP_OUT}%`],
  ["p12", "이미 이스케이프된 글자는 한 번 더", "&amp;", "&amp;amp;%"],
];

// `toLocaleString("ko-KR")`로 이스케이프 없이 끼우던 숫자 칸(raw)의 글자. null·undefined는 던진다(THROWS).
const COUNT_VALUES = [
  ["c01", "큰 수는 천 단위 쉼표", 1234567, "1,234,567"],
  ["c02", "0", 0, "0"],
  ["c03", "음수", -5, "-5"],
  ["c04", "소수", 1234.5, "1,234.5"],
  ["c05", "NaN", NaN, "NaN"],
  ["c06", "숫자 모양 문자열은 자기 글자", "12", "12"],
  ["c07", "문자열은 자기 글자", "abc", "abc"],
  ["c08", "true", true, "true"],
  ["c09", "false", false, "false"],
  ["c10", "{} → \"[object Object]\"", {}, "[object Object]"],
  ["c11", "[1,2] → \"1,2\"", [1, 2], "1,2"],
  ["c12", "빈 배열 → 빈 글자", [], ""],
  ["c13", "[1234]는 원소마다 쉼표 → \"1,234\"", [1234], "1,234"],
  ["c14", "빈 문자열 → 빈 글자", "", ""],
];

// ================= 표 여섯 개 공통 틀 =================
const frameHead = (cols) => `<thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>`;
const tbody = (rows) => `<tbody>${rows.join("")}</tbody>`;
const tr = (...cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const LOW = (text) => `<span class="low-sample">${text}</span>`;
// 한 칸만 바꾼 행을 만든다: 기본 행의 칸 목록에서 index번째 칸의 글자만 text로 바꾼다.
const swap = (cells, index, text) => cells.map((c, i) => (i === index ? text : c));

const rows = [];
const add = (id, fn, cond, args, expect, extra = {}) => rows.push({ id, fn, cond, args, expect, ...extra });

// ================= 전환율 표 conversionTableHtml =================
const CV_COLS = ["자치구", "전환율", "전세", "월세", "단지"];
const CV_HEAD = frameHead(CV_COLS);
const cvCaption = (text) => `<caption class="cost-label" style="caption-side:top;text-align:left;padding-bottom:8px">${text}</caption>`;
const cvTable = (label, bodyRows) => cvCaption(label) + CV_HEAD + tbody(bodyRows);
const BANDS = [
  { key: "under60", label: "60㎡ 미만" },
  { key: "60to85", label: "60~85㎡" },
  { key: "over85", label: "85㎡ 이상" },
];
const cell = (o = {}) => ({ district: "강남구", band: "60to85", rate: 4.97, jeonse10k: 95000, deposit10k: 40000, monthly10k: 215, pairs: 103, ...o });
const CV_BASE = ["강남구", "4.97%", "9.5억", "4억 / 215만원", "103"];
const cv = (cells, extra = {}) => ({ bands: BANDS, cells, ...extra });
{
  const fn = "conversionTableHtml";
  const T = (rowsHtml) => cvTable("60~85㎡ 기준", rowsHtml);
  add("CV-n01", fn, "데이터 null → null", [null], null);
  add("CV-n02", fn, "데이터 undefined → null", [undefined], null);
  add("CV-n03", fn, "빈 객체(cells 없음) → null", [{}], null);
  add("CV-n04", fn, "cells가 빈 목록 → null", [cv([])], null);
  add("CV-n05", fn, "cells가 null → null", [cv(null)], null);
  add("CV-n06", fn, "고른 면적대(60to85)가 아닌 칸만 있으면 → null", [cv([cell({ band: "over85" }), cell({ band: "under60" })])], null);
  add("CV-n07", fn, "다른 조각이 읽는 자리(districts·table·seoul)만 있고 cells가 없으면 → null", [{ districts: [{ district: "종로구" }], table: [{ district: "종로구" }], seoul: { leadKo: "X" } }], null);
  add("CV-b01", fn, "칸 하나(기본 면적대 60to85), 라벨은 bands에서", [cv([cell()])], T([tr(...CV_BASE)]));
  add("CV-b02", fn, "고른 면적대가 아닌 칸은 거른다", [cv([cell({ district: "빠짐", band: "over85" }), cell(), cell({ district: "빠짐2", band: undefined })])], T([tr(...CV_BASE)]));
  add("CV-b03", fn, "면적대를 인자로 고르면 그 면적대와 그 라벨", [cv([cell({ district: "큰집", band: "over85" }), cell()]), "over85"], cvTable("85㎡ 이상 기준", [tr("큰집", "4.97%", "9.5억", "4억 / 215만원", "103")]));
  add("CV-b04", fn, "면적대 인자가 undefined면 기본 면적대", [cv([cell()]), undefined], T([tr(...CV_BASE)]));
  add("CV-b05", fn, "bands에 없는 면적대를 고르면 키가 라벨", [cv([cell({ band: "x9" })]), "x9"], cvTable("x9 기준", [tr(...CV_BASE)]));
  // 정렬: 전환율이 높은 순, 같으면 들어온 순서
  add("CV-s01", fn, "전환율이 높은 순으로 정렬한다(입력은 낮은 순)", [cv([cell({ district: "가", rate: 3.1 }), cell({ district: "나", rate: 5.2 }), cell({ district: "다", rate: 4 })])], T([tr("나", "5.2%", "9.5억", "4억 / 215만원", "103"), tr("다", "4%", "9.5억", "4억 / 215만원", "103"), tr("가", "3.1%", "9.5억", "4억 / 215만원", "103")]));
  add("CV-s02", fn, "전환율이 같으면 들어온 순서를 지킨다", [cv([cell({ district: "가", rate: 4 }), cell({ district: "나", rate: 4 }), cell({ district: "다", rate: 4 })])], T([tr("가", "4%", "9.5억", "4억 / 215만원", "103"), tr("나", "4%", "9.5억", "4억 / 215만원", "103"), tr("다", "4%", "9.5억", "4억 / 215만원", "103")]));
  add("CV-s03", fn, "숫자 모양 문자열 전환율도 숫자로 견준다", [cv([cell({ district: "가", rate: "3" }), cell({ district: "나", rate: "10" })])], T([tr("나", "10%", "9.5억", "4억 / 215만원", "103"), tr("가", "3%", "9.5억", "4억 / 215만원", "103")]));
  add("CV-s04", fn, "음수 전환율도 값으로 정렬한다", [cv([cell({ district: "가", rate: -1 }), cell({ district: "나", rate: 1 })])], T([tr("나", "1%", "9.5억", "4억 / 215만원", "103"), tr("가", "-1%", "9.5억", "4억 / 215만원", "103")]));
  add("CV-s05", fn, "입력 순서를 바꾸지 않고 정렬한 사본으로 그린다(같은 입력을 두 번 불러도 같다)", [cv([cell({ district: "가", rate: 1 }), cell({ district: "나", rate: 2 })])], T([tr("나", "2%", "9.5억", "4억 / 215만원", "103"), tr("가", "1%", "9.5억", "4억 / 215만원", "103")]));
  // 라벨
  const labelCases = [
    ["l01", "bands가 없으면 키가 라벨", { cells: [cell()] }, "60to85 기준"],
    ["l02", "bands가 빈 목록이면 키가 라벨", { bands: [], cells: [cell()] }, "60to85 기준"],
    ["l03", "bands가 null이면 키가 라벨", { bands: null, cells: [cell()] }, "60to85 기준"],
    ["l04", "라벨이 없는(undefined) bands 항목은 키가 라벨", { bands: [{ key: "60to85" }], cells: [cell()] }, "60to85 기준"],
    ["l05", "라벨이 null이면 키가 라벨(?? 이라 빈 문자열은 안 걸린다)", { bands: [{ key: "60to85", label: null }], cells: [cell()] }, "60to85 기준"],
    ["l06", "라벨이 빈 문자열이면 빈 글자(키로 바뀌지 않는다)", { bands: [{ key: "60to85", label: "" }], cells: [cell()] }, " 기준"],
    ["l07", "라벨이 0이면 \"0\"", { bands: [{ key: "60to85", label: 0 }], cells: [cell()] }, "0 기준"],
    ["l08", "라벨이 false면 \"false\"", { bands: [{ key: "60to85", label: false }], cells: [cell()] }, "false 기준"],
    ["l09", "라벨이 {}면 \"[object Object]\"", { bands: [{ key: "60to85", label: {} }], cells: [cell()] }, "[object Object] 기준"],
    ["l10", "라벨이 [1,2]면 \"1,2\"", { bands: [{ key: "60to85", label: [1, 2] }], cells: [cell()] }, "1,2 기준"],
    ["l11", `라벨의 특수문자 & < > " '는 이스케이프`, { bands: [{ key: "60to85", label: SP }], cells: [cell()] }, `${SP_OUT} 기준`],
    ["l12", "라벨이 이미 이스케이프된 글자면 한 번 더", { bands: [{ key: "60to85", label: "&amp;" }], cells: [cell()] }, "&amp;amp; 기준"],
    ["l13", "같은 키가 둘이면 앞의 것", { bands: [{ key: "60to85", label: "앞" }, { key: "60to85", label: "뒤" }], cells: [cell()] }, "앞 기준"],
  ];
  for (const [no, cond, data, label] of labelCases) add(`CV-${no}`, fn, `머리말(caption): ${cond}`, [data], cvTable(label, [tr(...CV_BASE)]));
  // 면적대 값이 키와 같아야만 거른다(엄격 비교)
  add("CV-l14", fn, "면적대 인자가 숫자 모양 문자열이어도 키와 다르면 칸이 없다 → null", [cv([cell()]), 6085], null);
  // 칸 값
  for (const [no, cond, value, out] of NAME_VALUES) add(`CV-${no}`, fn, `자치구 칸: ${cond}`, [cv([cell({ district: value })])], T([tr(...swap(CV_BASE, 0, out))]));
  for (const [no, cond, value, out] of RAW_PCT_VALUES) add(`CV-${no}`, fn, `전환율 칸(이스케이프 없이 \`\${값}%\`): ${cond}`, [cv([cell({ rate: value })])], T([tr(...swap(CV_BASE, 1, out))]));
  const eokCases = [
    ["j01", "9.5억(95000)", 95000, "9.5억"],
    ["j02", "정수 억은 소수점 없이(40000 → 4억)", 40000, "4억"],
    ["j03", "소수 둘째 자리까지 반올림(12345 → 1.23억)", 12345, "1.23억"],
    ["j04", "0 → 0억", 0, "0억"],
    ["j05", "10억 이상(100000)", 100000, "10억"],
    ["j06", "1234567 → 123.46억(반올림)", 1234567, "123.46억"],
    ["j07", "1000억 이상은 천 단위 쉼표(12345678 → 1,234.57억)", 12345678, "1,234.57억"],
    ["j08", "음수(-5000 → -0.5억)", -5000, "-0.5억"],
    ["j09", "5 → 0억(0.0005억은 반올림해 0)", 5, "0억"],
    ["j10", "문자열 \"abc\" → NaN억", "abc", "NaN억"],
    ["j11", "null → 0억(null/10000은 0)", null, "0억"],
    ["j12", "undefined → NaN억", undefined, "NaN억"],
    ["j13", "true → 0억", true, "0억"],
    ["j14", "숫자 모양 문자열 \"50000\" → 5억", "50000", "5억"],
    ["j15", "{} → NaN억", {}, "NaN억"],
  ];
  for (const [no, cond, value, out] of eokCases) add(`CV-${no}`, fn, `전세 칸(억 환산): ${cond}`, [cv([cell({ jeonse10k: value })])], T([tr(...swap(CV_BASE, 2, out))]));
  for (const [no, cond, value, out] of eokCases) add(`CV-${no.replace("j", "d")}`, fn, `월세 칸의 보증금(같은 억 환산): ${cond}`, [cv([cell({ deposit10k: value })])], T([tr(...swap(CV_BASE, 3, `${out} / 215만원`))]));
  const manCases = [
    ["m01", "215 → 215만원", 215, "215만원"],
    ["m02", "0 → 0만원", 0, "0만원"],
    ["m03", "1234.5는 반올림해 쉼표(1,235만원)", 1234.5, "1,235만원"],
    ["m04", "1234567 → 1,234,567만원", 1234567, "1,234,567만원"],
    ["m05", "음수 -5", -5, "-5만원"],
    ["m06", "0.4는 반올림해 0", 0.4, "0만원"],
    ["m07", "-0.4는 반올림해 -0(ICU는 \"-0\"으로 쓴다)", -0.4, "-0만원"],
    ["m08", "문자열 \"abc\" → NaN만원", "abc", "NaN만원"],
    ["m09", "null → 0만원", null, "0만원"],
    ["m10", "undefined → NaN만원", undefined, "NaN만원"],
    ["m11", "true → 1만원", true, "1만원"],
    ["m12", "숫자 모양 문자열 \"300\" → 300만원", "300", "300만원"],
  ];
  for (const [no, cond, value, out] of manCases) add(`CV-${no}`, fn, `월세 칸의 월세: ${cond}`, [cv([cell({ monthly10k: value })])], T([tr(...swap(CV_BASE, 3, `4억 / ${out}`))]));
  for (const [no, cond, value, out] of COUNT_VALUES) add(`CV-${no.replace("c", "k")}`, fn, `단지 칸(이스케이프 없이 toLocaleString): ${cond}`, [cv([cell({ pairs: value })])], T([tr(...swap(CV_BASE, 4, out))]));
}

// ================= 해제 자치구 표 cancelDistrictsHtml =================
const KD_HEAD = frameHead(["자치구", "신고", "해제", "해제율", "미등기", "미등기율"]);
const kdTable = (bodyRows) => KD_HEAD + tbody(bodyRows);
const kd = (o = {}) => ({ district: "용산구", deals: 2171, cancelled: 50, cancelledShare: 2.3, matured: 1960, stale: 45, staleShare: 2.3, ...o });
const KD_BASE = ["용산구", "2,171", "50", "2.3%", "45", "2.3%"];
{
  const fn = "cancelDistrictsHtml";
  add("KD-n01", fn, "데이터 null → null", [null], null);
  add("KD-n02", fn, "데이터 undefined → null", [undefined], null);
  add("KD-n03", fn, "빈 객체(districts 없음) → null", [{}], null);
  add("KD-n04", fn, "districts가 빈 목록 → null", [{ districts: [] }], null);
  add("KD-n05", fn, "districts가 null → null", [{ districts: null }], null);
  add("KD-n06", fn, "districts가 빈 문자열(길이 0) → null", [{ districts: "" }], null);
  add("KD-n07", fn, "districts가 숫자 0(길이 없음) → null", [{ districts: 0 }], null);
  add("KD-n08", fn, "다른 조각이 읽는 자리(registrationByMonth·seoul)만 있으면 → null", [{ registrationByMonth: [{ month: "2024-11" }], seoul: { leadKo: "X" } }], null);
  add("KD-b01", fn, "한 곳", [{ districts: [kd()] }], kdTable([tr(...KD_BASE)]));
  add("KD-b02", fn, "여러 곳은 들어온 순서 그대로(정렬하지 않는다)", [{ districts: [kd({ district: "다", deals: 1 }), kd({ district: "가", deals: 3 }), kd({ district: "나", deals: 2 })] }], kdTable([tr("다", "1", "50", "2.3%", "45", "2.3%"), tr("가", "3", "50", "2.3%", "45", "2.3%"), tr("나", "2", "50", "2.3%", "45", "2.3%")]));
  add("KD-b03", fn, "읽지 않는 자리(matured)가 달라도 같은 글자", [{ districts: [kd({ matured: "x" })] }], kdTable([tr(...KD_BASE)]));
  for (const [no, cond, value, out] of NAME_VALUES) add(`KD-${no}`, fn, `자치구 칸: ${cond}`, [{ districts: [kd({ district: value })] }], kdTable([tr(...swap(KD_BASE, 0, out))]));
  const countCols = [["deals", "신고", 1], ["cancelled", "해제", 2], ["stale", "미등기", 4]];
  for (const [key, label, index] of countCols)
    for (const [no, cond, value, out] of COUNT_VALUES) add(`KD-${key}-${no}`, fn, `${label} 칸(이스케이프 없이 toLocaleString): ${cond}`, [{ districts: [kd({ [key]: value })] }], kdTable([tr(...swap(KD_BASE, index, out))]));
  for (const [key, label, index] of [["cancelledShare", "해제율", 3], ["staleShare", "미등기율", 5]])
    for (const [no, cond, value, out] of PCT_VALUES) add(`KD-${key}-${no}`, fn, `${label} 칸(pct): ${cond}`, [{ districts: [kd({ [key]: value })] }], kdTable([tr(...swap(KD_BASE, index, out))]));
}

// ================= 계약월별 등기 표 cancelMonthsHtml =================
const KM_HEAD = frameHead(["계약월", "계약", "등기 완료", "완료율"]);
const kmTable = (bodyRows) => KM_HEAD + tbody(bodyRows);
const km = (o = {}) => ({ month: "2024-11", filed: 3361, registered: 3347, share: 99.6, ...o });
const KM_BASE = ["2024-11", "3,361", "3,347", "99.6%"];
const trSpot = (...cells) => `<tr class="spot">${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const withMature = (months, ...list) => ({ registrationByMonth: list, seoul: { registration: { matureMonths: months } } });
{
  const fn = "cancelMonthsHtml";
  add("KM-n01", fn, "데이터 null → null", [null], null);
  add("KM-n02", fn, "데이터 undefined → null", [undefined], null);
  add("KM-n03", fn, "빈 객체 → null", [{}], null);
  add("KM-n04", fn, "registrationByMonth가 빈 목록 → null", [{ registrationByMonth: [] }], null);
  add("KM-n05", fn, "registrationByMonth가 null → null", [{ registrationByMonth: null }], null);
  add("KM-n06", fn, "다른 조각이 읽는 자리(districts·seoul)만 있으면 → null", [{ districts: [{ district: "용산구" }], seoul: { registration: { matureMonths: ["2024-11"] } } }], null);
  add("KM-b01", fn, "등기가 지난 달 목록이 없으면 줄을 강조하지 않는다", [{ registrationByMonth: [km()] }], kmTable([tr(...KM_BASE)]));
  add("KM-b02", fn, "matureMonths가 null이어도 강조 없음", [withMature(null, km())], kmTable([tr(...KM_BASE)]));
  add("KM-b03", fn, "matureMonths가 빈 목록이면 강조 없음", [withMature([], km())], kmTable([tr(...KM_BASE)]));
  add("KM-b04", fn, "matureMonths에 든 달은 줄에 class=\"spot\"", [withMature(["2024-11"], km())], kmTable([trSpot(...KM_BASE)]));
  add("KM-b05", fn, "matureMonths에 없는 달은 강조 없음", [withMature(["2024-12"], km())], kmTable([tr(...KM_BASE)]));
  add("KM-b06", fn, "달마다 따로 정한다(든 달만 spot, 입력 순서 그대로)", [withMature(["2024-12"], km({ month: "2024-11" }), km({ month: "2024-12" }), km({ month: "2025-01" }))], kmTable([tr("2024-11", "3,361", "3,347", "99.6%"), trSpot("2024-12", "3,361", "3,347", "99.6%"), tr("2025-01", "3,361", "3,347", "99.6%")]));
  add("KM-b07", fn, "month가 숫자이고 matureMonths가 문자열이면 같지 않아 강조 없음(엄격 비교)", [withMature(["202411"], km({ month: 202411 }))], kmTable([tr(...swap(KM_BASE, 0, "202411"))]));
  add("KM-b08", fn, "month가 숫자이고 matureMonths에도 같은 숫자면 강조", [withMature([202411], km({ month: 202411 }))], kmTable([trSpot(...swap(KM_BASE, 0, "202411"))]));
  add("KM-b09", fn, "matureMonths가 문자열이면 글자마다 한 항목(\"2\"가 든다)", [withMature("2024", km({ month: "2" }), km({ month: "x" }))], kmTable([trSpot("2", "3,361", "3,347", "99.6%"), tr("x", "3,361", "3,347", "99.6%")]));
  add("KM-b10", fn, "seoul·registration 중간 경로가 null이어도 강조 없음", [{ registrationByMonth: [km()], seoul: { registration: null } }], kmTable([tr(...KM_BASE)]));
  add("KM-b11", fn, "seoul이 null이어도 강조 없음", [{ registrationByMonth: [km()], seoul: null }], kmTable([tr(...KM_BASE)]));
  for (const [no, cond, value, out] of NAME_VALUES) add(`KM-${no}`, fn, `계약월 칸: ${cond}`, [{ registrationByMonth: [km({ month: value })] }], kmTable([tr(...swap(KM_BASE, 0, out))]));
  for (const [key, label, index] of [["filed", "계약", 1], ["registered", "등기 완료", 2]])
    for (const [no, cond, value, out] of COUNT_VALUES) add(`KM-${key}-${no}`, fn, `${label} 칸(이스케이프 없이 toLocaleString): ${cond}`, [{ registrationByMonth: [km({ [key]: value })] }], kmTable([tr(...swap(KM_BASE, index, out))]));
  for (const [no, cond, value, out] of RAW_PCT_VALUES) add(`KM-share-${no}`, fn, `완료율 칸(이스케이프 없이 \`\${값}%\`): ${cond}`, [{ registrationByMonth: [km({ share: value })] }], kmTable([tr(...swap(KM_BASE, 3, out))]));
}

// ================= 재계약(전세 갱신) 자치구 표 renewalDistrictsHtml =================
const RD_HEAD = `<thead><tr><th scope="col">자치구</th><th scope="col">갱신 − 신규</th><th scope="col">시세보다 싼 비율</th><th scope="col">맞물린 계약</th><th scope="col">상한 미달</th><th scope="col">요구권 행사</th></tr></thead>`;
const rdTable = (bodyRows) => RD_HEAD + tbody(bodyRows);
const rd = (o = {}) => ({ district: "강서구", renewals: 2590, gapMatched: 131, gapMedian: -22, gapCheaperShare: 79.4, rightUsed: 720, capMissShare: 46.1, ...o });
const RD_BASE = ["강서구", "-22%", "79.4%", "131", "46.1%", "720"];
const RD_LOW = LOW("표본 부족");
{
  const fn = "renewalDistrictsHtml";
  add("RD-n01", fn, "데이터 null → null", [null], null);
  add("RD-n02", fn, "데이터 undefined → null", [undefined], null);
  add("RD-n03", fn, "빈 객체(table 없음) → null", [{}], null);
  add("RD-n04", fn, "table이 빈 목록 → null", [{ table: [] }], null);
  add("RD-n05", fn, "table이 null → null", [{ table: null }], null);
  add("RD-n06", fn, "다른 조각이 읽는 자리(wolseTable·seoul)만 있으면 → null", [{ wolseTable: [{ district: "강동구" }], seoul: { wolse: { rate: 4.8, range: [] } } }], null);
  add("RD-b01", fn, "한 곳(값 칸)", [{ table: [rd()] }], rdTable([tr(...RD_BASE)]));
  add("RD-b02", fn, "여러 곳은 들어온 순서 그대로", [{ table: [rd({ district: "다" }), rd({ district: "가" }), rd({ district: "나" })] }], rdTable([tr(...swap(RD_BASE, 0, "다")), tr(...swap(RD_BASE, 0, "가")), tr(...swap(RD_BASE, 0, "나"))]));
  add("RD-b03", fn, "읽지 않는 자리(renewals·wolse)가 달라도 같은 글자", [{ table: [rd({ renewals: "x", wolse: { median: null } })] }], rdTable([tr(...RD_BASE)]));
  // 해자 2: 표본 부족 - 문턱은 빌더가 적용했고(null), 여기서는 null만 표본 부족이다. 클래스·문구가 바뀌면 이 행들이 실패한다.
  add("RD-L01", fn, "해자 2: gapMedian이 null이면 값 칸 대신 표본 부족 스팬(문턱은 빌더가 적용했다)", [{ table: [rd({ gapMedian: null })] }], rdTable([tr(...swap(RD_BASE, 1, RD_LOW))]), { moat: true });
  add("RD-L02", fn, "해자 2·순서: 표본 부족 칸이 한 줄의 값 없음 칸(-)들과 함께 있어도 표본 부족이 먼저 판정돼 스팬이 나온다(\"-\"가 아니다)", [{ table: [rd({ gapMedian: null, gapCheaperShare: null, capMissShare: null })] }], rdTable([tr("강서구", RD_LOW, "-", "131", "-", "720")]), { moat: true, order: true });
  add("RD-L03", fn, "해자 2·순서: gapMedian이 undefined면 표본 부족이 아니라 값 없음(\"-\")", [{ table: [rd({ gapMedian: undefined })] }], rdTable([tr(...swap(RD_BASE, 1, "-"))]), { moat: true, order: true });
  add("RD-L04", fn, "해자 2·순서: gapMedian 키가 아예 없어도 값 없음(\"-\")", [{ table: [{ district: "강서구", gapMatched: 131, gapCheaperShare: 79.4, rightUsed: 720, capMissShare: 46.1 }] }], rdTable([tr(...swap(RD_BASE, 1, "-"))]), { moat: true, order: true });
  add("RD-L05", fn, "해자 2: gapMedian 0은 표본 부족이 아니라 값(\"0%\")", [{ table: [rd({ gapMedian: 0 })] }], rdTable([tr(...swap(RD_BASE, 1, "0%"))]), { moat: true });
  add("RD-L06", fn, "해자 2: 표본 부족이 아닌 falsy(\"\"·false·NaN)는 값 글자로 나온다", [{ table: [rd({ gapMedian: "" }), rd({ gapMedian: false }), rd({ gapMedian: NaN })] }], rdTable([tr(...swap(RD_BASE, 1, "%")), tr(...swap(RD_BASE, 1, "false%")), tr(...swap(RD_BASE, 1, "NaN%"))]), { moat: true });
  add("RD-L07", fn, "해자 2: 문자열 \"null\"은 null이 아니라 값(\"null%\")", [{ table: [rd({ gapMedian: "null" })] }], rdTable([tr(...swap(RD_BASE, 1, "null%"))]), { moat: true });
  add("RD-L08", fn, "해자 2·문턱: 맞물린 계약이 적어도(gapMatched 0·59) 값이 있으면 값을 낸다 - 이 함수는 건수 문턱(MIN_GAP_SAMPLE)을 다시 적용하지 않는다", [{ table: [rd({ gapMatched: 0 }), rd({ gapMatched: 59 })] }], rdTable([tr(...swap(RD_BASE, 3, "0")), tr(...swap(RD_BASE, 3, "59"))]), { moat: true });
  add("RD-L09", fn, "해자 2: 표 안의 표본 부족 줄과 값 줄이 섞이면 줄마다 따로 정한다(입력 순서 그대로)", [{ table: [rd({ district: "가", gapMedian: null }), rd({ district: "나" }), rd({ district: "다", gapMedian: null })] }], rdTable([tr("가", RD_LOW, "79.4%", "131", "46.1%", "720"), tr(...swap(RD_BASE, 0, "나")), tr("다", RD_LOW, "79.4%", "131", "46.1%", "720")]), { moat: true });
  add("RD-L10", fn, "해자 2: 스팬은 title 없이 class만 있다(문구 \"표본 부족\" 고정)", [{ table: [rd({ gapMedian: null })] }], rdTable([tr(...swap(RD_BASE, 1, '<span class="low-sample">표본 부족</span>'))]), { moat: true });
  for (const [no, cond, value, out] of NAME_VALUES) add(`RD-${no}`, fn, `자치구 칸: ${cond}`, [{ table: [rd({ district: value })] }], rdTable([tr(...swap(RD_BASE, 0, out))]));
  for (const [no, cond, value, out] of PCT_VALUES.filter(([, , v]) => v !== null)) add(`RD-gap-${no}`, fn, `갱신−신규 칸(pct, null은 표본 부족이라 제외): ${cond}`, [{ table: [rd({ gapMedian: value })] }], rdTable([tr(...swap(RD_BASE, 1, out))]));
  for (const [key, label, index] of [["gapCheaperShare", "시세보다 싼 비율", 2], ["capMissShare", "상한 미달", 4]])
    for (const [no, cond, value, out] of PCT_VALUES) add(`RD-${key}-${no}`, fn, `${label} 칸(pct): ${cond}`, [{ table: [rd({ [key]: value })] }], rdTable([tr(...swap(RD_BASE, index, out))]));
  for (const [key, label, index] of [["gapMatched", "맞물린 계약", 3], ["rightUsed", "요구권 행사", 5]])
    for (const [no, cond, value, out] of COUNT_VALUES) add(`RD-${key}-${no}`, fn, `${label} 칸(이스케이프 없이 toLocaleString): ${cond}`, [{ table: [rd({ [key]: value })] }], rdTable([tr(...swap(RD_BASE, index, out))]));
}

// ================= 월세 재계약 표 renewalWolseDistrictsHtml =================
const rwHead = (h1, h2) => frameHead(["자치구", h1, h2, "시세보다 싼 비율", "맞물린 계약"]);
const rwTable = (h1, h2, bodyRows) => rwHead(h1, h2) + tbody(bodyRows);
const rw = (o = {}) => ({ district: "강동구", matched: 119, median: -22, cheaperShare: 85.7, range: [{ rate: 3, median: -26.9 }, { rate: 10, median: -14 }], ...o });
const RW_BASE = ["강동구", "-22%", "-26.9% / -14%", "85.7%", "119"];
const RW_LOW = LOW("표본 부족");
const wolseOf = (o = {}) => ({ rate: 4.8, range: [{ rate: 3 }, { rate: 10 }], ...o });
const rwData = (tableRows, wolse = wolseOf()) => ({ wolseTable: tableRows, seoul: { wolse } });
{
  const fn = "renewalWolseDistrictsHtml";
  const T = (bodyRows) => rwTable("갱신 − 신규 (4.8%)", "3% / 10%로 보면", bodyRows);
  add("RW-n01", fn, "데이터 null → null", [null], null);
  add("RW-n02", fn, "데이터 undefined → null", [undefined], null);
  add("RW-n03", fn, "빈 객체 → null", [{}], null);
  add("RW-n04", fn, "wolseTable이 빈 목록 → null", [rwData([])], null);
  add("RW-n05", fn, "wolseTable이 null → null", [rwData(null)], null);
  add("RW-n06", fn, "서울 월세 요약(seoul.wolse)이 없으면 표가 있어도 → null", [{ wolseTable: [rw()], seoul: {} }], null);
  add("RW-n07", fn, "seoul이 null → null", [{ wolseTable: [rw()], seoul: null }], null);
  add("RW-n08", fn, "seoul이 없으면 → null", [{ wolseTable: [rw()] }], null);
  add("RW-n09", fn, "wolse가 null → null", [rwData([rw()], null)], null);
  add("RW-n10", fn, "wolse가 0(falsy) → null", [rwData([rw()], 0)], null);
  add("RW-n11", fn, "wolse가 빈 문자열 → null", [rwData([rw()], "")], null);
  add("RW-n12", fn, "다른 조각이 읽는 자리(table)만 있으면 → null", [{ table: [{ district: "강서구" }], seoul: { wolse: wolseOf() } }], null);
  add("RW-b01", fn, "한 곳(값 칸), 머리글은 서울 요약의 전환율과 범위 양끝", [rwData([rw()])], T([tr(...RW_BASE)]));
  add("RW-b02", fn, "여러 곳은 들어온 순서 그대로", [rwData([rw({ district: "다" }), rw({ district: "가" })])], T([tr(...swap(RW_BASE, 0, "다")), tr(...swap(RW_BASE, 0, "가"))]));
  add("RW-b03", fn, "머리글 범위는 양끝만 쓴다(세 단계면 첫째와 셋째)", [rwData([rw()], wolseOf({ range: [{ rate: 3 }, { rate: 6 }, { rate: 10 }] }))], T([tr(...RW_BASE)]));
  add("RW-b04", fn, "범위가 한 단계뿐이면 양끝이 같다", [rwData([rw()], wolseOf({ range: [{ rate: 5 }] }))], rwTable("갱신 − 신규 (4.8%)", "5% / 5%로 보면", [tr(...RW_BASE)]));
  add("RW-b05", fn, "범위가 빈 목록이면 양끝이 없다(undefined)", [rwData([rw()], wolseOf({ range: [] }))], rwTable("갱신 − 신규 (4.8%)", "undefined% / undefined%로 보면", [tr(...RW_BASE)]));
  add("RW-b06", fn, "전환율이 없으면 \"undefined%\"", [rwData([rw()], wolseOf({ rate: undefined }))], rwTable("갱신 − 신규 (undefined%)", "3% / 10%로 보면", [tr(...RW_BASE)]));
  add("RW-b07", fn, `머리글의 특수문자 & < > " '는 이스케이프(전환율)`, [rwData([rw()], wolseOf({ rate: SP }))], rwTable(`갱신 − 신규 (${SP_OUT}%)`, "3% / 10%로 보면", [tr(...RW_BASE)]));
  add("RW-b08", fn, `머리글의 특수문자(범위 양끝)`, [rwData([rw()], wolseOf({ range: [{ rate: SP }, { rate: "<x>" }] }))], rwTable("갱신 − 신규 (4.8%)", `${SP_OUT}% / &lt;x&gt;%로 보면`, [tr(...RW_BASE)]));
  add("RW-b09", fn, "머리글의 비문자열(false·{}·[1,2])", [rwData([rw()], wolseOf({ rate: false, range: [{ rate: {} }, { rate: [1, 2] }] }))], rwTable("갱신 − 신규 (false%)", "[object Object]% / 1,2%로 보면", [tr(...RW_BASE)]));
  add("RW-b10", fn, "머리글의 null 전환율은 \"null%\"", [rwData([rw()], wolseOf({ rate: null }))], rwTable("갱신 − 신규 (null%)", "3% / 10%로 보면", [tr(...RW_BASE)]));
  // 해자 2
  add("RW-L01", fn, "해자 2: median이 null이면 값 칸 대신 표본 부족 스팬", [rwData([rw({ median: null })])], T([tr(...swap(RW_BASE, 1, RW_LOW))]), { moat: true });
  add("RW-L02", fn, "해자 2·순서: 표본 부족 칸이 같은 줄의 값 없음 칸(범위 \"-\"·싼 비율 \"-\")과 함께 있어도 표본 부족이 먼저 판정돼 스팬이 나온다", [rwData([rw({ median: null, range: [], cheaperShare: null })])], T([tr("강동구", RW_LOW, "-", "-", "119")]), { moat: true, order: true });
  add("RW-L03", fn, "해자 2·순서: median이 undefined면 표본 부족이 아니라 값 없음(\"-\")", [rwData([rw({ median: undefined })])], T([tr(...swap(RW_BASE, 1, "-"))]), { moat: true, order: true });
  add("RW-L04", fn, "해자 2: median 0은 값(\"0%\", 부호 없음)", [rwData([rw({ median: 0 })])], T([tr(...swap(RW_BASE, 1, "0%"))]), { moat: true });
  add("RW-L05", fn, "해자 2·문턱: 맞물린 계약이 적어도(matched 0·99) 값이 있으면 값을 낸다 - 이 함수는 건수 문턱(MIN_WOLSE_GAP_SAMPLE)을 다시 적용하지 않는다", [rwData([rw({ matched: 0 }), rw({ matched: 99 })])], T([tr(...swap(RW_BASE, 4, "0")), tr(...swap(RW_BASE, 4, "99"))]), { moat: true });
  add("RW-L06", fn, "해자 2: 표본 부족 줄과 값 줄이 섞이면 줄마다 따로 정한다", [rwData([rw({ district: "가", median: null }), rw({ district: "나" })])], T([tr("가", RW_LOW, "-26.9% / -14%", "85.7%", "119"), tr(...swap(RW_BASE, 0, "나"))]), { moat: true });
  add("RW-L07", fn, "해자 2: 스팬은 title 없이 class만 있다(문구 \"표본 부족\" 고정)", [rwData([rw({ median: null })])], T([tr(...swap(RW_BASE, 1, '<span class="low-sample">표본 부족</span>'))]), { moat: true });
  for (const [no, cond, value, out] of NAME_VALUES) add(`RW-${no}`, fn, `자치구 칸: ${cond}`, [rwData([rw({ district: value })])], T([tr(...swap(RW_BASE, 0, out))]));
  // 격차 칸: signed(양수면 +)
  const signedCases = [
    ["g01", "음수는 부호 그대로", -5.5, "-5.5%"],
    ["g02", "양수는 + 를 붙인다", 3, "+3%"],
    ["g03", "소수 양수", 0.5, "+0.5%"],
    ["g04", "숫자 모양 문자열 \"5\"는 양수로 견줘 +5%", "5", "+5%"],
    ["g05", "문자열 \"abc\"는 양수가 아니라 \"abc%\"", "abc", "abc%"],
    ["g06", "NaN은 \"NaN%\"", NaN, "NaN%"],
    ["g07", "false는 \"false%\"(양수 아님)", false, "false%"],
    ["g08", "true는 1이라 양수 → \"+true%\"", true, "+true%"],
    ["g09", "{}는 \"[object Object]%\"", {}, "[object Object]%"],
    ["g10", "빈 문자열은 \"%\"", "", "%"],
    ["g11", "특수문자는 이스케이프", SP, `${SP_OUT}%`],
  ];
  for (const [no, cond, value, out] of signedCases) add(`RW-${no}`, fn, `격차 칸(signed): ${cond}`, [rwData([rw({ median: value })])], T([tr(...swap(RW_BASE, 1, out))]));
  const rangeCases = [
    ["h01", "범위가 빈 목록이면 \"-\"", [], "-"],
    ["h02", "두 단계는 \" / \"로 잇는다", [{ rate: 3, median: -6.8 }, { rate: 10, median: -2.6 }], "-6.8% / -2.6%"],
    ["h03", "양수에는 +", [{ rate: 3, median: 1 }, { rate: 10, median: 2 }], "+1% / +2%"],
    ["h04", "한 단계의 median이 null이면 그 자리만 \"-\"", [{ rate: 3, median: 1 }, { rate: 10, median: null }], "+1% / -"],
    ["h05", "한 단계의 median이 undefined여도 \"-\"", [{ rate: 3, median: undefined }], "-"],
    ["h06", "세 단계", [{ rate: 3, median: -1 }, { rate: 6, median: 0 }, { rate: 10, median: 1 }], "-1% / 0% / +1%"],
    ["h07", "특수문자는 이스케이프", [{ rate: 3, median: SP }], `${SP_OUT}%`],
    ["h08", "비문자열 median(false·{})", [{ rate: 3, median: false }, { rate: 10, median: {} }], "false% / [object Object]%"],
  ];
  for (const [no, cond, value, out] of rangeCases) add(`RW-${no}`, fn, `범위 칸: ${cond}`, [rwData([rw({ range: value })])], T([tr(...swap(RW_BASE, 2, out))]));
  const cheaperCases = [
    ["s01", "값 85.7", 85.7, "85.7%"],
    ["s02", "0은 값", 0, "0%"],
    ["s03", "null만 \"-\"", null, "-"],
    ["s04", "undefined는 \"-\"가 아니라 \"undefined%\"(pct()와 다르다)", undefined, "undefined%"],
    ["s05", "false는 \"false%\"", false, "false%"],
    ["s06", "NaN", NaN, "NaN%"],
    ["s07", "특수문자는 이스케이프", SP, `${SP_OUT}%`],
    ["s08", "{}", {}, "[object Object]%"],
  ];
  for (const [no, cond, value, out] of cheaperCases) add(`RW-${no}`, fn, `싼 비율 칸: ${cond}`, [rwData([rw({ cheaperShare: value })])], T([tr(...swap(RW_BASE, 3, out))]));
  for (const [no, cond, value, out] of COUNT_VALUES) add(`RW-matched-${no}`, fn, `맞물린 계약 칸(이스케이프 없이 toLocaleString): ${cond}`, [rwData([rw({ matched: value })])], T([tr(...swap(RW_BASE, 4, out))]));
}

// ================= 층 격차 자치구 표 floorDistrictsHtml =================
const FD_HEAD = frameHead(["자치구", "1층 − 3층 이상", "맞물린 칸", "서울과 다른가"]);
const fdTable = (bodyRows) => FD_HEAD + tbody(bodyRows);
const fd = (o = {}) => ({ district: "강서구", cells: 35, median: -9.1, band: { low: -9.1, high: -5.6 }, distinct: false, ...o });
const FD_BASE = ["강서구", "-9.1%", "35", LOW("갈라 볼 수 없음")];
{
  const fn = "floorDistrictsHtml";
  add("FD-n01", fn, "데이터 null → null", [null], null);
  add("FD-n02", fn, "데이터 undefined → null", [undefined], null);
  add("FD-n03", fn, "빈 객체(districts 없음) → null", [{}], null);
  add("FD-n04", fn, "districts가 빈 목록 → null", [{ districts: [] }], null);
  add("FD-n05", fn, "districts가 null → null", [{ districts: null }], null);
  add("FD-n06", fn, "다른 조각이 읽는 자리(sale·jeonse·slugs)만 있으면 → null", [{ sale: { median: -9 }, jeonse: { median: -8 }, slugs: { 종로구: "jongno" } }], null);
  add("FD-b01", fn, "서울과 다른 구(distinct 참) → \"다르다\"", [{ districts: [fd({ distinct: true })] }], fdTable([tr("강서구", "-9.1%", "35", "다르다")]));
  add("FD-b02", fn, "여러 곳은 들어온 순서 그대로", [{ districts: [fd({ district: "다", distinct: true }), fd({ district: "가" })] }], fdTable([tr("다", "-9.1%", "35", "다르다"), tr(...swap(FD_BASE, 0, "가"))]));
  add("FD-b03", fn, "읽지 않는 자리(lead)가 달라도 같은 글자", [{ districts: [fd({ distinct: true })], lead: { ko: "X" } }], fdTable([tr("강서구", "-9.1%", "35", "다르다")]));
  // 해자 2
  add("FD-L01", fn, "해자 2: 서울과 안 갈리고 가른 범위(band)는 있으면 \"갈라 볼 수 없음\" 스팬", [{ districts: [fd()] }], fdTable([tr(...FD_BASE)]), { moat: true });
  add("FD-L02", fn, "해자 2: 범위(band)조차 못 냈으면(null) \"칸이 모자람\" 스팬", [{ districts: [fd({ band: null, median: null })] }], fdTable([tr("강서구", "-", "35", LOW("칸이 모자람"))]), { moat: true });
  add("FD-L03", fn, "해자 2·순서: 중앙값이 비어 \"-\"인 칸과 표본 부족 스팬이 한 줄에 같이 나온다 - 중앙값 칸과 판정 칸은 서로 영향을 주지 않는다", [{ districts: [fd({ median: null })] }], fdTable([tr("강서구", "-", "35", LOW("갈라 볼 수 없음"))]), { moat: true, order: true });
  add("FD-L04", fn, "해자 2·순서: distinct가 참이면 범위·중앙값이 비어도 표본 부족이 아니라 \"다르다\"가 먼저다", [{ districts: [fd({ distinct: true, band: null, median: null })] }], fdTable([tr("강서구", "-", "35", "다르다")]), { moat: true, order: true });
  add("FD-L05", fn, "해자 2: distinct 키가 아예 없으면(undefined) 표본 부족", [{ districts: [{ district: "강서구", cells: 35, median: -9.1, band: { low: 1 } }] }], fdTable([tr(...FD_BASE)]), { moat: true });
  add("FD-L06", fn, "해자 2: 표 안의 줄마다 따로 정한다(다르다·갈라 볼 수 없음·칸이 모자람)", [{ districts: [fd({ district: "가", distinct: true }), fd({ district: "나" }), fd({ district: "다", band: null, median: null })] }], fdTable([tr("가", "-9.1%", "35", "다르다"), tr(...swap(FD_BASE, 0, "나")), tr("다", "-", "35", LOW("칸이 모자람"))]), { moat: true });
  add("FD-L07", fn, "해자 2: 스팬은 title 없이 class만 있다(문구 두 가지 고정)", [{ districts: [fd(), fd({ band: null })] }], fdTable([tr(...swap(FD_BASE, 3, '<span class="low-sample">갈라 볼 수 없음</span>')), tr(...swap(FD_BASE, 3, '<span class="low-sample">칸이 모자람</span>'))]), { moat: true });
  add("FD-L08", fn, "해자 2·문턱: 맞물린 칸이 적어도(cells 0·12) distinct가 참이면 \"다르다\" - 이 함수는 칸 수 문턱을 다시 적용하지 않는다", [{ districts: [fd({ cells: 0, distinct: true }), fd({ cells: 12, distinct: true })] }], fdTable([tr("강서구", "-9.1%", "0", "다르다"), tr("강서구", "-9.1%", "12", "다르다")]), { moat: true });
  // distinct 값 종류(참/거짓 판정은 truthy 검사)
  const distinctCases = [
    ["d01", "true", true, true],
    ["d02", "숫자 1(truthy)", 1, true],
    ["d03", "문자열 \"false\"(truthy)", "false", true],
    ["d04", "문자열 \"0\"(truthy)", "0", true],
    ["d05", "{}(truthy)", {}, true],
    ["d06", "[](truthy)", [], true],
    ["d07", "false", false, false],
    ["d08", "0", 0, false],
    ["d09", "빈 문자열", "", false],
    ["d10", "null", null, false],
    ["d11", "NaN", NaN, false],
  ];
  for (const [no, cond, value, distinct] of distinctCases) add(`FD-dist-${no}`, fn, `서울과 다른가(distinct) 판정: ${cond} → ${distinct ? "다르다" : "표본 부족 스팬"}`, [{ districts: [fd({ distinct: value })] }], fdTable([tr(...swap(FD_BASE, 3, distinct ? "다르다" : LOW("갈라 볼 수 없음")))]));
  const bandCases = [
    ["b01", "{}(truthy)", {}, "갈라 볼 수 없음"],
    ["b02", "[](truthy)", [], "갈라 볼 수 없음"],
    ["b03", "문자열 \"x\"(truthy)", "x", "갈라 볼 수 없음"],
    ["b04", "true", true, "갈라 볼 수 없음"],
    ["b05", "null", null, "칸이 모자람"],
    ["b06", "undefined", undefined, "칸이 모자람"],
    ["b07", "0", 0, "칸이 모자람"],
    ["b08", "빈 문자열", "", "칸이 모자람"],
    ["b09", "false", false, "칸이 모자람"],
    ["b10", "NaN", NaN, "칸이 모자람"],
  ];
  for (const [no, cond, value, text] of bandCases) add(`FD-band-${no}`, fn, `가른 범위(band) 판정(distinct 거짓일 때): ${cond} → \"${text}\"`, [{ districts: [fd({ band: value })] }], fdTable([tr(...swap(FD_BASE, 3, LOW(text)))]));
  for (const [no, cond, value, out] of NAME_VALUES) add(`FD-name-${no}`, fn, `자치구 칸: ${cond}`, [{ districts: [fd({ district: value })] }], fdTable([tr(...swap(FD_BASE, 0, out))]));
  const medianCases = [
    ["m01", "값 -9.1", -9.1, "-9.1%"],
    ["m02", "0은 값", 0, "0%"],
    ["m03", "양수는 부호 없이", 3.2, "3.2%"],
    ["m04", "null → \"-\"", null, "-"],
    ["m05", "undefined는 \"-\"가 아니라 \"undefined%\"", undefined, "undefined%"],
    ["m06", "false", false, "false%"],
    ["m07", "빈 문자열", "", "%"],
    ["m08", "NaN", NaN, "NaN%"],
    ["m09", "{}", {}, "[object Object]%"],
    ["m10", "[1,2]", [1, 2], "1,2%"],
  ];
  for (const [no, cond, value, out] of medianCases) add(`FD-med-${no}`, fn, `중앙값 칸(이스케이프 없이): ${cond}`, [{ districts: [fd({ median: value })] }], fdTable([tr(...swap(FD_BASE, 1, out))]));
  for (const [no, cond, value, out] of COUNT_VALUES) add(`FD-cells-${no}`, fn, `맞물린 칸 칸(이스케이프 없이 toLocaleString): ${cond}`, [{ districts: [fd({ cells: value })] }], fdTable([tr(...swap(FD_BASE, 2, out))]));
}

// ================= 자치구 링크 districtLinksHtml =================
const DISTRICTS = [
  ["종로구", "jongno"], ["중구", "jung"], ["용산구", "yongsan"], ["성동구", "seongdong"], ["광진구", "gwangjin"], ["동대문구", "dongdaemun"], ["중랑구", "jungnang"],
  ["성북구", "seongbuk"], ["강북구", "gangbuk"], ["도봉구", "dobong"], ["노원구", "nowon"], ["은평구", "eunpyeong"], ["서대문구", "seodaemun"], ["마포구", "mapo"],
  ["양천구", "yangcheon"], ["강서구", "gangseo"], ["구로구", "guro"], ["금천구", "geumcheon"], ["영등포구", "yeongdeungpo"], ["동작구", "dongjak"], ["관악구", "gwanak"],
  ["서초구", "seocho"], ["강남구", "gangnam"], ["송파구", "songpa"], ["강동구", "gangdong"],
];
const LINKS = DISTRICTS.map(([name, slug]) => `<a href="./district-${slug}.html">${name}</a>`).join("");
const here = (name, slug) => LINKS.replace(`<a href="./district-${slug}.html">${name}</a>`, `<a href="./district-${slug}.html" aria-current="page">${name}</a>`);
const dlBlock = (heading, links) => `<h3 class="district-links-heading" id="district-links-heading">${heading}</h3><div class="district-links" id="district-links">${links}</div>`;
{
  const fn = "districtLinksHtml";
  add("DL-01", fn, "인자 없음: 머리글은 \"다른 지역\", 현재 구 없음(aria-current 없음), 스물다섯 곳 순서 그대로", [], dlBlock("다른 지역", LINKS));
  add("DL-02", fn, "현재 구가 null이면 강조 없음", [null], dlBlock("다른 지역", LINKS));
  add("DL-03", fn, "현재 구가 undefined면 기본값(null)이라 강조 없음", [undefined], dlBlock("다른 지역", LINKS));
  add("DL-04", fn, "현재 구가 중구면 그 링크에만 aria-current=\"page\"", ["중구"], dlBlock("다른 지역", here("중구", "jung")));
  add("DL-05", fn, "현재 구가 첫째(종로구)", ["종로구"], dlBlock("다른 지역", here("종로구", "jongno")));
  add("DL-06", fn, "현재 구가 마지막(강동구)", ["강동구"], dlBlock("다른 지역", here("강동구", "gangdong")));
  add("DL-07", fn, "목록에 없는 이름이면 강조 없음", ["없는구"], dlBlock("다른 지역", LINKS));
  add("DL-08", fn, "현재 구가 이름의 일부(\"중\")면 엄격 비교라 강조 없음", ["중"], dlBlock("다른 지역", LINKS));
  add("DL-09", fn, "현재 구가 빈 문자열이면 강조 없음", [""], dlBlock("다른 지역", LINKS));
  add("DL-10", fn, "현재 구가 비문자열(5·{}·false·[\"중구\"])이면 엄격 비교라 강조 없음", [5], dlBlock("다른 지역", LINKS));
  add("DL-11", fn, "현재 구가 배열 [\"중구\"]여도 문자열과 같지 않아 강조 없음", [["중구"]], dlBlock("다른 지역", LINKS));
  add("DL-12", fn, "머리글을 인자로 주면 그 글자(예산 화면의 \"자치구별 시세 보기\")", [null, "자치구별 시세 보기"], dlBlock("자치구별 시세 보기", LINKS));
  add("DL-13", fn, "현재 구와 머리글을 함께", ["마포구", "자치구별 시세 보기"], dlBlock("자치구별 시세 보기", here("마포구", "mapo")));
  add("DL-14", fn, "머리글이 undefined면 기본값(\"다른 지역\")", [null, undefined], dlBlock("다른 지역", LINKS));
  add("DL-15", fn, "머리글이 null이면 기본값이 아니라 빈 글자", [null, null], dlBlock("", LINKS));
  add("DL-16", fn, "머리글이 빈 문자열이면 빈 글자", [null, ""], dlBlock("", LINKS));
  add("DL-17", fn, `머리글의 특수문자 & < > " '`, [null, SP], dlBlock(SP_OUT, LINKS));
  add("DL-18", fn, "머리글이 false면 \"false\"", [null, false], dlBlock("false", LINKS));
  add("DL-19", fn, "머리글이 true면 \"true\"", [null, true], dlBlock("true", LINKS));
  add("DL-20", fn, "머리글이 0이면 \"0\"", [null, 0], dlBlock("0", LINKS));
  add("DL-21", fn, "머리글이 NaN이면 \"NaN\"", [null, NaN], dlBlock("NaN", LINKS));
  add("DL-22", fn, "머리글이 {}면 \"[object Object]\"", [null, {}], dlBlock("[object Object]", LINKS));
  add("DL-23", fn, "머리글이 [1,2]면 \"1,2\"", [null, [1, 2]], dlBlock("1,2", LINKS));
  add("DL-24", fn, "머리글이 빈 배열이면 빈 글자", [null, []], dlBlock("", LINKS));
  add("DL-25", fn, "머리글이 이미 이스케이프된 글자면 한 번 더", [null, "&amp;&#x27;"], dlBlock("&amp;amp;&amp;#x27;", LINKS));
  add("DL-26", fn, "머리글의 개행·한글·이모지는 그대로", [null, "a\n한글 😀"], dlBlock("a\n한글 😀", LINKS));
}

// ================= 자치구 문장 세 개 =================
// 문장은 district-summary.mjs·district-facts.mjs·renewal-facts.mjs가 만든다(legacy·JSX 같은 함수). 여기서는 그 문장이 조각에서 어떻게 감싸이고 이스케이프되는지와
// 인자 경로(null·빈 값)를 닫는다. 문장 모양 자체는 각 모듈의 기존 시험이 지킨다. 기대 문장은 손으로 적었다.
const ENT = { name: "종로구", sale: { avgPricePerPyeong10k: 5000, transactionCount: 10 } };
const RE = (...districts) => ({ districts });
const SUM_KO = "종로구 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 이 숫자들은 정부에 신고된 매매 10건을 집계한 것입니다.";
const SUM_EN = "Apartments in 종로구 trade at ₩50M per pyeong. For an 84m² unit that works out to about ₩1,270M. These figures are based on 10 sales reported to the government.";
{
  const fn = "districtSummaryHtml";
  add("DS-01", fn, "자치구 이름이 없으면(undefined) 빈 문자열(null이 아니다)", [RE(ENT), undefined], "");
  add("DS-02", fn, "자치구 이름이 null → 빈 문자열", [RE(ENT), null], "");
  add("DS-03", fn, "자치구 이름이 빈 문자열 → 빈 문자열", [RE(ENT), ""], "");
  add("DS-04", fn, "자치구 이름이 0(falsy) → 빈 문자열", [RE(ENT), 0], "");
  add("DS-05", fn, "자치구 이름이 false → 빈 문자열", [RE(ENT), false], "");
  add("DS-06", fn, "데이터가 null이면 그 구를 못 찾아 문장이 없다 → 빈 문자열", [null, "종로구"], "");
  add("DS-07", fn, "데이터가 undefined → 빈 문자열", [undefined, "종로구"], "");
  add("DS-08", fn, "데이터가 빈 객체(districts 없음) → 빈 문자열", [{}, "종로구"], "");
  add("DS-09", fn, "districts가 null → 빈 문자열", [{ districts: null }, "종로구"], "");
  add("DS-10", fn, "목록에 없는 구 → 빈 문자열", [RE(ENT), "없는구"], "");
  add("DS-11", fn, "한국어 문장(기본 locale): 매매 평당가·84㎡ 환산·건수 근거", [RE(ENT), "종로구"], SUM_KO);
  add("DS-12", fn, "locale을 \"ko\"로 주어도 같다", [RE(ENT), "종로구", "ko"], SUM_KO);
  add("DS-13", fn, "영어 문장", [RE(ENT), "종로구", "en"], SUM_EN);
  add("DS-14", fn, "spread가 undefined·null이어도 같은 문장(전세가율 문장이 없으면 쓰이지 않는다)", [RE(ENT), "종로구", "ko", undefined], SUM_KO);
  add("DS-15", fn, "표본 문턱: 건수가 5건이면 값을 낸다", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 5000, transactionCount: 5 } }), "종로구"], "종로구 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 이 숫자들은 정부에 신고된 매매 5건을 집계한 것입니다.");
  add("DS-16", fn, "해자 2: 표본 부족(건수 4건)이면 값을 내지 않고 모자란다고 적는다(값이 있어도)", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 4 } }), "종로구"], "종로구는 이번 달 아파트 매매 신고가 4건뿐이라 평균을 내지 않았습니다.", { moat: true });
  add("DS-17", fn, "해자 2: 표본 부족 영어 문장", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 4 } }), "종로구", "en"], "Only 4 apartment sales have been reported in 종로구 this month, too few to average.", { moat: true });
  add("DS-18", fn, "해자 2·순서: 표본 부족이면 값(평당가)·환산·건수 근거 문장은 하나도 나오지 않는다", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 0 } }), "종로구"], "종로구는 이번 달 아파트 매매 신고가 0건뿐이라 평균을 내지 않았습니다.", { moat: true, order: true });
  add("DS-19", fn, "해자 2: 건수 칸이 없으면 0건으로 적는다", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 9999 } }), "종로구"], "종로구는 이번 달 아파트 매매 신고가 0건뿐이라 평균을 내지 않았습니다.", { moat: true });
  add("DS-20", fn, "해자 2: 매매 칸이 아예 없는 구도 0건으로 적는다", [RE({ name: "종로구" }), "종로구"], "종로구는 이번 달 아파트 매매 신고가 0건뿐이라 평균을 내지 않았습니다.", { moat: true });
  add("DS-21", fn, "해자 2: 표본이 모자란 매매 + 전세만 충분한 구는 전세 문장이 뒤따른다", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 4 }, jeonse: { avgDepositPerPyeong10k: 3000, transactionCount: 8 } }), "종로구"], "종로구는 이번 달 아파트 매매 신고가 4건뿐이라 평균을 내지 않았습니다. 전세는 평당 보증금 3,000만원으로, 84㎡ 기준 약 7억 6,230만원입니다. 이 숫자들은 정부에 신고된 전세 8건을 집계한 것입니다.", { moat: true });
  add("DS-22", fn, `이름의 특수문자 & < > " '는 이스케이프(문장 전체를 한 번에)`, [RE({ ...ENT, name: SP }), SP], `${SP_OUT} 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 이 숫자들은 정부에 신고된 매매 10건을 집계한 것입니다.`);
  add("DS-23", fn, "이름이 숫자 5이고 자치구 이름도 5면 엄격 비교로 찾아 \"5 아파트\"", [RE({ ...ENT, name: 5 }), 5], "5 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 이 숫자들은 정부에 신고된 매매 10건을 집계한 것입니다.");
  add("DS-24", fn, "자치구 이름이 숫자 모양 문자열 \"5\"이고 이름이 숫자 5면 엄격 비교라 못 찾는다", [RE({ ...ENT, name: 5 }), "5"], "");
  add("DS-25", fn, "매매 평당가가 없는(null) 구는 표본이 충분해도 값이 없어 모자람 문장", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: null, transactionCount: 10 } }), "종로구"], "종로구는 이번 달 아파트 매매 신고가 10건뿐이라 평균을 내지 않았습니다.");
  add("DS-26", fn, "전세가율 문장과 칸 분포(spread)를 함께 낸다(건수 10·8건)", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 5000, transactionCount: 10 }, jeonse: { avgDepositPerPyeong10k: 3000, transactionCount: 8 } }), "종로구", "ko", { cells: 120, q1: 50, q3: 70, median: 60 }], "종로구 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 전세가율은 60.0%입니다(이 구 매매 10건·전세 8건 기준). 매매와 전세가 함께 신고된 단지·평형 120칸에서 하나씩 내면 절반이 50~70%에 들어옵니다. 이 숫자들은 정부에 신고된 매매 10건, 전세 8건을 집계한 것입니다.");
  // 자치구 이름이 falsy이고 목록에도 같은 falsy 이름(또는 이름 없음)이 있으면 찾아지지만, 이름이 없을 때는 찾기 전에 빈 문자열로 끝난다(문장을 만들지 않는다).
  const NAMELESS = { sale: ENT.sale };
  add("DS-31", fn, "자치구 이름이 undefined이고 목록에 이름 없는 구가 있어도 빈 문자열(찾기 전에 끝난다)", [RE(NAMELESS), undefined], "");
  add("DS-32", fn, "자치구 이름이 빈 문자열이고 목록에 이름이 빈 문자열인 구가 있어도 빈 문자열", [RE({ ...ENT, name: "" }), ""], "");
  add("DS-33", fn, "자치구 이름이 0이고 목록에 이름이 0인 구가 있어도 빈 문자열", [RE({ ...ENT, name: 0 }), 0], "");
  add("DS-34", fn, "자치구 이름이 null이고 목록에 이름이 null인 구가 있어도 빈 문자열", [RE({ ...ENT, name: null }), null], "");
  add("DS-35", fn, "자치구 이름이 false이고 목록에 이름이 false인 구가 있어도 빈 문자열", [RE({ ...ENT, name: false }), false], "");
  const objName = {};
  const arrName = [1, 2];
  add("DS-28", fn, "이름이 true이고 자치구 이름도 true면 \"true 아파트\"", [RE({ ...ENT, name: true }), true], "true 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 이 숫자들은 정부에 신고된 매매 10건을 집계한 것입니다.");
  add("DS-29", fn, "이름이 같은 객체 {}면 \"[object Object] 아파트\"(문장 전체가 글자로 바뀐다)", [RE({ ...ENT, name: objName }), objName], "[object Object] 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 이 숫자들은 정부에 신고된 매매 10건을 집계한 것입니다.");
  add("DS-30", fn, "이름이 같은 배열 [1,2]면 \"1,2 아파트\"", [RE({ ...ENT, name: arrName }), arrName], "1,2 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 이 숫자들은 정부에 신고된 매매 10건을 집계한 것입니다.");
  add("DS-27", fn, "같은 입력에서 spread를 빼면 칸 분포 문장만 빠진다", [RE({ name: "종로구", sale: { avgPricePerPyeong10k: 5000, transactionCount: 10 }, jeonse: { avgDepositPerPyeong10k: 3000, transactionCount: 8 } }), "종로구", "ko"], "종로구 아파트 매매가는 평당 5,000만원입니다. 84㎡(약 25평) 기준으로 환산하면 약 12억 7,049만원입니다. 전세가율은 60.0%입니다(이 구 매매 10건·전세 8건 기준). 이 숫자들은 정부에 신고된 매매 10건, 전세 8건을 집계한 것입니다.");
}
{
  const fn = "districtFactsHtml";
  const NEUT_KO = "위 시세표의 최근 네 주가 아니라, 최근 3개월 동안 신고된 1,234건을 전부 놓고 보면 이렇습니다. 튀는 데가 없습니다. 한 동이 거래를 가져가지도, 평형이나 연식이 한쪽으로 쏠리지도, 한 단지나 직거래가 평균을 흔들지도 않았습니다 — 넷 다 서울 중간에 가깝습니다. 서울 평균에 가까운 동네를 찾고 있다면 이런 구가 그것입니다.";
  add("DF-01", fn, "관찰이 없으면(null) 빈 문자열(null이 아니다)", [null], "");
  add("DF-02", fn, "관찰이 undefined → 빈 문자열", [undefined], "");
  add("DF-03", fn, "말할 것이 하나도 없는 구(문턱을 못 넘은 관찰은 키가 없다) → 빈 문자열", [{ total: 5 }], "");
  add("DF-04", fn, "튀는 것이 없다는 문장도 낸다(창 설명 + typical)", [{ total: 1234, typical: true }], NEUT_KO);
  add("DF-05", fn, "locale \"en\"", [{ total: 1234, typical: true }, "en"], "Looking at all 1,234 transactions reported over the past 3 months rather than the four-week average above: Nothing here stands out: no single neighbourhood dominates, the mix of unit sizes and building ages sits near the Seoul middle, and no one complex or direct-deal cluster is moving the average. If you are looking for a district that reads like Seoul itself, this is one of them.");
  add("DF-06", fn, "locale \"ko\"를 주어도 같다", [{ total: 1234, typical: true }, "ko"], NEUT_KO);
  add("DF-07", fn, "months를 주면 그 개월 수", [{ total: 1234, months: 5, directHeavy: { share: 0.234 } }], "위 시세표의 최근 네 주가 아니라, 최근 5개월 동안 신고된 1,234건을 전부 놓고 보면 이렇습니다. 중개를 끼지 않은 직거래가 23%입니다. 직거래에는 가족 간 증여성 거래와 시행사 정산이 섞이는데 둘 다 시장에서 붙은 값이 아니라, 이 구의 평균은 &quot;지금 사면 이 값&quot;과 거리가 있을 수 있습니다.");
  add("DF-08", fn, "months가 null이면 기본 3개월", [{ total: 1234, months: null, directHeavy: { share: 0.234 } }], "위 시세표의 최근 네 주가 아니라, 최근 3개월 동안 신고된 1,234건을 전부 놓고 보면 이렇습니다. 중개를 끼지 않은 직거래가 23%입니다. 직거래에는 가족 간 증여성 거래와 시행사 정산이 섞이는데 둘 다 시장에서 붙은 값이 아니라, 이 구의 평균은 &quot;지금 사면 이 값&quot;과 거리가 있을 수 있습니다.");
  add("DF-09", fn, "months가 false면(?? 라서 기본값이 안 걸린다) \"false개월\"", [{ total: 1234, months: false, directHeavy: { share: 0.234 } }], "위 시세표의 최근 네 주가 아니라, 최근 false개월 동안 신고된 1,234건을 전부 놓고 보면 이렇습니다. 중개를 끼지 않은 직거래가 23%입니다. 직거래에는 가족 간 증여성 거래와 시행사 정산이 섞이는데 둘 다 시장에서 붙은 값이 아니라, 이 구의 평균은 &quot;지금 사면 이 값&quot;과 거리가 있을 수 있습니다.");
  add("DF-10", fn, `동 이름의 특수문자 & < > " '는 이스케이프`, [{ total: 1234, concentrated: { dong: SP, share: 0.5, dongs: 7 } }], `위 시세표의 최근 네 주가 아니라, 최근 3개월 동안 신고된 1,234건을 전부 놓고 보면 이렇습니다. 그 가운데 50%가 ${SP_OUT} 한 곳에서 나왔습니다. 거래가 잡힌 동이 7곳인데도 그렇습니다 — 이 구의 평균은 사실상 ${SP_OUT} 평균에 가깝습니다.`);
  add("DF-11", fn, "동 이름이 비문자열(false·{})이면 \"false\"·\"[object Object]\"", [{ total: 1234, concentrated: { dong: false, share: 0.5, dongs: 7 } }], "위 시세표의 최근 네 주가 아니라, 최근 3개월 동안 신고된 1,234건을 전부 놓고 보면 이렇습니다. 그 가운데 50%가 false 한 곳에서 나왔습니다. 거래가 잡힌 동이 7곳인데도 그렇습니다 — 이 구의 평균은 사실상 false 평균에 가깝습니다.");
  add("DF-12", fn, "동 이름이 {}면 \"[object Object]\"", [{ total: 1234, concentrated: { dong: {}, share: 0.5, dongs: 7 } }], "위 시세표의 최근 네 주가 아니라, 최근 3개월 동안 신고된 1,234건을 전부 놓고 보면 이렇습니다. 그 가운데 50%가 [object Object] 한 곳에서 나왔습니다. 거래가 잡힌 동이 7곳인데도 그렇습니다 — 이 구의 평균은 사실상 [object Object] 평균에 가깝습니다.");
  add("DF-13", fn, "총 건수가 비숫자 문자열이면 그 글자 그대로(이스케이프는 문장 전체에)", [{ total: "a&b", typical: true }], "위 시세표의 최근 네 주가 아니라, 최근 3개월 동안 신고된 a&amp;b건을 전부 놓고 보면 이렇습니다. 튀는 데가 없습니다. 한 동이 거래를 가져가지도, 평형이나 연식이 한쪽으로 쏠리지도, 한 단지나 직거래가 평균을 흔들지도 않았습니다 — 넷 다 서울 중간에 가깝습니다. 서울 평균에 가까운 동네를 찾고 있다면 이런 구가 그것입니다.");
  add("DF-14", fn, "총 건수가 true면 \"true\"", [{ total: true, typical: true }], "위 시세표의 최근 네 주가 아니라, 최근 3개월 동안 신고된 true건을 전부 놓고 보면 이렇습니다. 튀는 데가 없습니다. 한 동이 거래를 가져가지도, 평형이나 연식이 한쪽으로 쏠리지도, 한 단지나 직거래가 평균을 흔들지도 않았습니다 — 넷 다 서울 중간에 가깝습니다. 서울 평균에 가까운 동네를 찾고 있다면 이런 구가 그것입니다.");
}
{
  const fn = "districtRenewalHtml";
  const CAP_KO = "계약갱신요구권을 쓴 재계약 가운데 46.1%가 상한 5%에 못 미친 선에서 맺어졌습니다. 서울 전체는 38%입니다 — 상한이 있는데도 거기까지 못 올린 계약이 이만큼이라는 것은, 집주인이 부르는 값을 이 동네 시장이 다 받아 주지 않았다는 뜻입니다.";
  add("DR-01", fn, "관찰이 없으면(null) 빈 문자열(null이 아니다)", [null], "");
  add("DR-02", fn, "관찰이 undefined → 빈 문자열", [undefined], "");
  add("DR-03", fn, "관찰이 빈 객체(말할 것이 없다) → 빈 문자열", [{}], "");
  add("DR-04", fn, "상한 미달이 많은 구", [{ capMissed: { share: 46.1, seoul: 38 } }], CAP_KO);
  add("DR-05", fn, "locale \"ko\"를 주어도 같다", [{ capMissed: { share: 46.1, seoul: 38 } }, "ko"], CAP_KO);
  add("DR-06", fn, "locale \"en\"", [{ capMissed: { share: 46.1, seoul: 38 } }, "en"], "Among renewals where the tenant invoked the statutory right, 46.1% ended below the 5% cap, against 38% across Seoul — the ceiling is there, and landlords here are more often not reaching it.");
  add("DR-07", fn, "문장 둘은 공백 하나로 잇는다(상한 미달 + 월세 전환이 적은 구)", [{ capMissed: { share: 46.1, seoul: 38 }, toWolseLight: { share: 10, seoul: 30 } }], `${CAP_KO} 전세로 살던 세입자가 재계약 때 월세로 바꾼 비율이 10%로, 서울 전체 30%보다 낮습니다 — 이 동네는 아직 전세가 전세로 남습니다.`);
  add("DR-08", fn, `숫자 자리의 특수문자 & < > " '는 이스케이프(문장 전체를 한 번에)`, [{ toWolseHeavy: { share: SP, seoul: "<x>" } }], `전세로 살던 세입자가 재계약 때 월세로 바꾼 비율이 ${SP_OUT}%입니다. 서울 전체는 &lt;x&gt;%입니다 — 이 동네에서 전세가 유독 빠르게 월세로 바뀌고 있습니다.`);
  add("DR-09", fn, "숫자 자리가 비문자열(false·{})이면 \"false\"·\"[object Object]\"", [{ toWolseLight: { share: false, seoul: {} } }], "전세로 살던 세입자가 재계약 때 월세로 바꾼 비율이 false%로, 서울 전체 [object Object]%보다 낮습니다 — 이 동네는 아직 전세가 전세로 남습니다.");
  add("DR-10", fn, "숫자 자리가 null·undefined면 \"null\"·\"undefined\"", [{ toWolseLight: { share: null, seoul: undefined } }], "전세로 살던 세입자가 재계약 때 월세로 바꾼 비율이 null%로, 서울 전체 undefined%보다 낮습니다 — 이 동네는 아직 전세가 전세로 남습니다.");
  add("DR-11", fn, "이미 이스케이프된 &amp;·&#x27;은 한 번 더 이스케이프된다", [{ toWolseLight: { share: "&amp;", seoul: "&#x27;" } }], "전세로 살던 세입자가 재계약 때 월세로 바꾼 비율이 &amp;amp;%로, 서울 전체 &amp;#x27;%보다 낮습니다 — 이 동네는 아직 전세가 전세로 남습니다.");
}

{
  // 월세화 흐름 24개월(V7). 문장은 scripts/rent-flow.ts 가 만들고 조각은 공백으로 잇기만 한다. 문턱(hasEnoughSample)은 빌더가 적용해 값이 null 로 온다.
  // 인자는 (자치구 이름, 산출물 전체, locale) - 이름이 문장마다 들어간다.
  const fn = "districtRentFlowHtml";
  const SEOUL = { compare: { base: { n: 65345, wolseShare: 44 }, recent: { n: 51410, wolseShare: 52.2 } }, renewals: { toWolseShare: 7.5 } };
  const RF = (districts, extra = {}) => ({ compare: { base: ["202506", "202507", "202508"], recent: ["202606", "202607", "202608"] }, closedSpan: ["202411", "202608"], partial: ["202609", "202610"], seoul: SEOUL, districts, ...extra });
  const RFD = (b = {}, r = {}, renewals = { fromJeonse: 783, toWolseShare: 11.5 }) => ({ compare: { base: { n: 605, wolseShare: 59.2, jn: 139, jmed: 69000, ...b }, recent: { n: 491, wolseShare: 67, jn: 88, jmed: 63000, ...r } }, renewals });
  const PARTIAL_KO = "2026년 9월·10월은 신고 기한이 남은 덜 찬 달이라 세지 않았습니다.";
  const share = (name, a, b, n0, n1, move) => `전월세 흐름(국토교통부 신고): ${name} 월세·반전세 비중은 2025년 6~8월 ${a}%(${n0}건)에서 2026년 6~8월 ${b}%(${n1}건)로 ${move}.`;
  const rest = (name) => `${name} 신규 전세 보증금 중앙값(면적 구분 없음)은 6.9억원(139건) → 6.3억원(88건)입니다. 2024년 11월~2026년 8월 ${name}에서 전세를 갱신한 783건 중 11.5%가 월세를 끼고 다시 계약했습니다(서울 7.5%). ${PARTIAL_KO}`;
  const SIMILAR = "서울(44.0% → 52.2%)과의 차이는 표본 오차 안이라 비슷한 흐름으로 봅니다.";
  const full = (name, n0 = "605", n1 = "491") => `${share(name, "59.2", "67.0", n0, n1, "7.8%p 올랐습니다")} ${SIMILAR} ${rest(name)}`;
  add("RF-01", fn, "이름이 없으면(null) 빈 문자열", [null, RF({ 종로구: RFD() })], "");
  add("RF-02", fn, "이름이 undefined → 빈 문자열", [undefined, RF({ 종로구: RFD() })], "");
  add("RF-03", fn, "견줄 창이 없는 산출물(compare 없음) → 문단을 지우지 않고 「자료가 비어」 한 줄", ["종로구", { districts: { 종로구: RFD() } }], "전월세 흐름(국토교통부 신고): 종로구 견줄 달의 신고 자료가 비어 내지 않습니다.");
  add("RF-03c", fn, "견줄 달 파일이 비어 구의 창이 null → 달 라벨과 함께 「자료가 비어」 한 줄", ["종로구", RF({ 종로구: { compare: { base: null, recent: RFD().compare.recent }, renewals: null } })], "전월세 흐름(국토교통부 신고): 종로구 견줄 달(2025년 6~8월·2026년 6~8월)의 신고 자료가 비어 내지 않습니다.");
  add("RF-03d", fn, "같은 경우 en", ["종로구", RF({ 종로구: { compare: null, renewals: null } }), "en"], "Rent flow (MOLIT lease filings): filing data for 종로구's comparison months (Jun–Aug 2025 vs Jun–Aug 2026) is missing, so no figures are given.");
  add("RF-03b", fn, "산출물에 없는 구 → 빈 문자열", ["중구", RF({ 종로구: RFD() })], "");
  add("RF-04", fn, "비중·서울 비교·중앙값·갱신 전환·덜 찬 달", ["종로구", RF({ 종로구: RFD() })], full("종로구"));
  add("RF-05", fn, "locale \"ko\"를 주어도 같다", ["종로구", RF({ 종로구: RFD() }), "ko"], full("종로구"));
  add("RF-06", fn, "locale \"en\"", ["종로구", RF({ 종로구: RFD() }), "en"], "Rent flow (MOLIT lease filings): in 종로구, monthly-rent and semi-jeonse leases went from 59.2% of filings in Jun–Aug 2025 (n=605) to 67.0% in Jun–Aug 2026 (n=491), up 7.8pp. The gap from Seoul (44.0% → 52.2%) is within sampling error, so we treat it as the same trend. The median new-jeonse deposit in 종로구, all sizes, went from ₩690M (n=139) to ₩630M (n=88). Of 783 jeonse leases renewed in 종로구 in Nov 2024–Aug 2026, 11.5% came back with monthly rent (Seoul 7.5%). Sep 2026 and Oct 2026 not counted (filing window still open).");
  add("RF-07", fn, "해자 2: 문턱을 못 넘은 값(null)은 숫자 대신 건수와 「내지 않는다」, 갱신 문장은 빠진다", ["종로구", RF({ 종로구: RFD({ n: 3, wolseShare: null, jn: 2, jmed: null }, { n: 4, wolseShare: null, jn: 1, jmed: null }, null) })], `전월세 흐름(국토교통부 신고): 종로구는 신고가 모자라 월세 비중을 내지 않습니다(2025년 6~8월 3건, 2026년 6~8월 4건). 종로구 신규 전세가 2건 → 1건뿐이라 보증금 중앙값을 내지 않습니다. ${PARTIAL_KO}`, { moat: true });
  add("RF-08", fn, `이름의 특수문자 & < > " '는 이스케이프(문장 전체를 한 번에)`, [SP, RF({ [SP]: RFD() })], full(SP_OUT));
  add("RF-09", fn, "이름·건수 자리가 비문자열(false·{})이면 \"false\"·\"[object Object]\"", [false, RF({ false: RFD({ n: false }, { n: {} }) })], full("false", "false", "[object Object]"));
  add("RF-10", fn, "표본 오차 밖으로 서울보다 더 오른 구", ["관악구", RF({ 관악구: RFD({ n: 5000, wolseShare: 40 }, { n: 5000, wolseShare: 60 }) })], `${share("관악구", "40.0", "60.0", "5,000", "5,000", "20.0%p 올랐습니다")} 서울(44.0% → 52.2%)보다 더 많이 올랐습니다. ${rest("관악구")}`);
  add("RF-11", fn, "표본 오차 밖으로 서울보다 덜 오른 구", ["서초구", RF({ 서초구: RFD({ n: 5000, wolseShare: 40 }, { n: 5000, wolseShare: 44 }) })], `${share("서초구", "40.0", "44.0", "5,000", "5,000", "4.0%p 올랐습니다")} 서울(44.0% → 52.2%)보다 덜 올랐습니다. ${rest("서초구")}`);
  add("RF-11b", fn, "서울과 갈려도 구 변화가 0이면 「반대」가 아니라 거의 그대로(flat)", ["성북구", RF({ 성북구: RFD({ n: 5000, wolseShare: 40 }, { n: 5000, wolseShare: 40 }) })], `${share("성북구", "40.0", "40.0", "5,000", "5,000", "그대로입니다")} 서울(44.0% → 52.2%)은 움직였지만 이 구의 변화는 표본 오차 안이라 거의 그대로로 봅니다. ${rest("성북구")}`);
  add("RF-11c", fn, "구 변화가 제 표본 오차 안이면(서울과 부호가 달라도) flat - en", ["성북구", RF({ 성북구: RFD({ n: 5000, wolseShare: 40 }, { n: 5000, wolseShare: 39.5 }) }), "en"], "Rent flow (MOLIT lease filings): in 성북구, monthly-rent and semi-jeonse leases went from 40.0% of filings in Jun–Aug 2025 (n=5,000) to 39.5% in Jun–Aug 2026 (n=5,000), down 0.5pp. Seoul moved (44.0% → 52.2%), but this district's change is within sampling error, so we treat it as roughly flat. The median new-jeonse deposit in 성북구, all sizes, went from ₩690M (n=139) to ₩630M (n=88). Of 783 jeonse leases renewed in 성북구 in Nov 2024–Aug 2026, 11.5% came back with monthly rent (Seoul 7.5%). Sep 2026 and Oct 2026 not counted (filing window still open).");
  add("RF-12", fn, "서울과 반대 방향(en)", ["강서구", RF({ 강서구: RFD({ n: 5000, wolseShare: 49.2 }, { n: 5000, wolseShare: 42.4 }) }), "en"], "Rent flow (MOLIT lease filings): in 강서구, monthly-rent and semi-jeonse leases went from 49.2% of filings in Jun–Aug 2025 (n=5,000) to 42.4% in Jun–Aug 2026 (n=5,000), down 6.8pp. Seoul moved the other way (44.0% → 52.2%). The median new-jeonse deposit in 강서구, all sizes, went from ₩690M (n=139) to ₩630M (n=88). Of 783 jeonse leases renewed in 강서구 in Nov 2024–Aug 2026, 11.5% came back with monthly rent (Seoul 7.5%). Sep 2026 and Oct 2026 not counted (filing window still open).");
  add("RF-13", fn, "비중이 같으면 「그대로」, 서울 값이 없으면 비교 문장과 괄호를 빼고, 덜 찬 달이 해를 넘기면 해를 다시 적는다", ["중구", RF({ 중구: RFD({ wolseShare: 60 }, { wolseShare: 60 }) }, { partial: ["202612", "202701"], seoul: {} })], "전월세 흐름(국토교통부 신고): 중구 월세·반전세 비중은 2025년 6~8월 60.0%(605건)에서 2026년 6~8월 60.0%(491건)로 그대로입니다. 중구 신규 전세 보증금 중앙값(면적 구분 없음)은 6.9억원(139건) → 6.3억원(88건)입니다. 2024년 11월~2026년 8월 중구에서 전세를 갱신한 783건 중 11.5%가 월세를 끼고 다시 계약했습니다. 2026년 12월·2027년 1월은 신고 기한이 남은 덜 찬 달이라 세지 않았습니다.");
}

{
  // 입주 예정 한 줄(#677). 문장은 scripts/move-in.ts 가 만들고 조각은 끝에 price-outlook 표 링크 하나를 붙인다. 인자는 (자치구 이름, move-in.json 전체, locale).
  const fn = "districtMoveInHtml";
  const MI = (rows, extra = {}) => ({ basis: "2026-06-30", byDistrict: { halves: ["2026H2", "2027H1", "2027H2", "2028H1"], rows, undated: null, ...extra } });
  const R = (name, units) => ({ name, units, rental: units.map(() => 0) });
  const KO_SRC = "자료: 한국부동산원·부동산114 입주예정물량정보(공공데이터포털 15111714). 이 값은 원자료를 가공한 것입니다.";
  const EN_SRC = "Data: Korea Real Estate Board and R114 scheduled move-in data (data.go.kr 15111714). These figures are derived from the original data.";
  const KO_META = " · 기준일 2026-06-30 · 예정월 기준(실제 입주 아님).";
  const EN_META = " · as of 2026-06-30 · by scheduled move-in month (not actual move-ins).";
  const LINK_KO = '<a href="./price-outlook.html#move-in-districts">자치구별 표 →</a>';
  const LINK_EN = '<a href="./price-outlook.html#move-in-districts">District table →</a>';
  const ko = (body) => `입주 예정(추정): ${body}${KO_META} ${KO_SRC} ${LINK_KO}`;
  const en = (body) => `Scheduled move-ins (estimate): ${body}${EN_META} ${EN_SRC} ${LINK_EN}`;
  const FULL = MI([R("서초구", [5231, 1300, 6056, 160])]);
  add("MI-01", fn, "이름이 null → 빈 문자열", [null, FULL], "");
  add("MI-02", fn, "집계가 없으면(null) 빈 문자열", ["서초구", null], "");
  add("MI-03", fn, "집계 표에 없는 구 → 빈 문자열", ["중구", FULL], "");
  add("MI-04", fn, "반기 열이 비면 빈 문자열", ["서초구", MI([R("서초구", [])], { halves: [] })], "");
  add("MI-05", fn, "네 반기 모두 있음(ko, 쉼표로 잇고 끝에 표 링크)", ["서초구", FULL], ko("2026년 하반기 5,231세대, 2027년 상반기 1,300세대, 2027년 하반기 6,056세대, 2028년 상반기 160세대"));
  add("MI-06", fn, "locale \"en\"", ["서초구", FULL, "en"], en("Jul–Dec 2026 5,231 homes, Jan–Jun 2027 1,300 homes, Jul–Dec 2027 6,056 homes, Jan–Jun 2028 160 homes"));
  add("MI-07", fn, "일부 반기만 있으면 0 인 반기는 적지 않고 「나머지 반기 없음」", ["중구", MI([R("중구", [0, 102, 0, 0])])], ko("2027년 상반기 102세대, 나머지 반기 없음"));
  add("MI-08", fn, "일부 반기만(en)", ["중구", MI([R("중구", [0, 102, 0, 0])]), "en"], en("Jan–Jun 2027 102 homes, none in the other half-years"));
  add("MI-09", fn, "어느 반기에도 없음 → 「예정 없음」", ["종로구", MI([R("종로구", [0, 0, 0, 0])])], ko("예정 없음"));
  add("MI-10", fn, "어느 반기에도 없음(en)", ["종로구", MI([R("종로구", [0, 0, 0, 0])]), "en"], en("none planned"));
  add("MI-11", fn, "달 미정 단지가 있는 구는 「달 미정 단지 따로 있음」(세대수는 내지 않는다)", ["구로구", MI([R("구로구", [295, 0, 132, 0])], { undated: { units: 302, rentalUnits: 0, districts: ["구로구"] } })], ko("2026년 하반기 295세대, 2027년 하반기 132세대, 나머지 반기 없음, 달 미정 단지 따로 있음"));
  add("MI-12", fn, "달 미정만 있는 구는 「없음」이라 하지 않는다", ["구로구", MI([R("구로구", [0, 0, 0, 0])], { undated: { units: 302, rentalUnits: 0, districts: ["구로구"] } })], ko("달이 정해진 예정 없음, 달 미정 단지 있음"));
  add("MI-13", fn, "달 미정만 있는 구(en)", ["구로구", MI([R("구로구", [0, 0, 0, 0])], { undated: { units: 302, rentalUnits: 0, districts: ["구로구"] } }), "en"], en("none with a set month; complexes with no month set exist"));
  // 기준일 칸은 문자열로 이어 붙이므로(json 에서 온 날짜) 특수문자는 이스케이프되고 비문자열은 String() 으로 나온다 - 실제 입력에는 없다(빌더가 쓴 날짜 문자열).
  const ZERO = [R("종로구", [0, 0, 0, 0])];
  add("MI-15", fn, "기준일의 특수문자 & < > \" ' 는 이스케이프", ["종로구", { ...MI(ZERO), basis: SP }], `입주 예정(추정): 예정 없음 · 기준일 ${SP_OUT} · 예정월 기준(실제 입주 아님). ${KO_SRC} ${LINK_KO}`);
  add("MI-16", fn, "기준일이 비문자열 true → \"true\", {} → \"[object Object]\"", ["종로구", { ...MI(ZERO), basis: true }], `입주 예정(추정): 예정 없음 · 기준일 true · 예정월 기준(실제 입주 아님). ${KO_SRC} ${LINK_KO}`);
  add("MI-17", fn, "기준일이 {}", ["종로구", { ...MI(ZERO), basis: {} }], `입주 예정(추정): 예정 없음 · 기준일 [object Object] · 예정월 기준(실제 입주 아님). ${KO_SRC} ${LINK_KO}`);
  add("MI-18", fn, "이름이 undefined → 빈 문자열", [undefined, FULL], "");
  add("MI-14", fn, "기준일이 없으면 그 칸만 빠진다", ["종로구", { byDistrict: MI([R("종로구", [0, 0, 0, 0])]).byDistrict }], `입주 예정(추정): 예정 없음 · 예정월 기준(실제 입주 아님). ${KO_SRC} ${LINK_KO}`);
}

{
  // 같은 집이 다시 팔렸을 때 한 줄(#716 G1). 문장은 scripts/district-facts.ts 가 만들고 조각은 끝에 갈아타기 쌍 표 링크 하나를 붙인다. 인자는 (자치구 이름, repeat-sales.json 전체, locale).
  const fn = "districtResaleHtml";
  const D = (rows, patch = {}) => ({
    window: { from: "202411", to: "202608", gap: [300, 730] },
    checks: { kill: false, enough: true },
    rows,
    ...patch,
  });
  const OK = { gu: "11170", n: 119, st: "ok", gap: 378, p: [19.5, 15.2, 23.3, 13.6] };
  const LINK_KO = '<a href="./switch-house.html#repeat-sales">같은 집 쌍 표 →</a>';
  const LINK_EN = '<a href="./switch-house.html#repeat-sales">Pairs table →</a>';
  const KO_OK = "같은 집이 다시 팔렸을 때(2024년 11월~2026년 8월 계약 쌍) 가격 변화 중앙값 +19.5%(90% 구간 +15.2% ~ +23.3%, 119쌍, 보유 중앙 378일). 같은 쌍 기간의 한국부동산원 R-ONE은 +13.6%, 차이의 원인은 재지 않았습니다. 시장 지수·구 시세 상승률이 아니며 연율화하지 않았습니다.";
  const EN_OK = "When the same home sold again (pairs contracted Nov 2024–Aug 2026): median price change +19.5% (90% range +15.2% to +23.3%, 119 pairs, median hold 378 days). Korea Real Estate Board R-ONE, same pairs: +13.6%; the cause of the gap was not measured. Not a market index or district price growth, not annualised.";
  add("RS-01", fn, "이름이 null → 빈 문자열", [null, D([OK])], "");
  add("RS-02", fn, "집계가 없으면(null) 빈 문자열", ["용산구", null], "");
  add("RS-03", fn, "표에 없는 구 → 빈 문자열", ["강남구", D([OK])], "");
  add("RS-04", fn, "킬 스위치가 걸렸으면(갈아타기 절이 접힐 때) 줄이 없다", ["용산구", D([OK], { checks: { kill: true, enough: true } })], "");
  add("RS-05", fn, "값을 낼 수 있는 구가 모자라면(enough 거짓) 줄이 없다", ["용산구", D([OK], { checks: { kill: false, enough: false } })], "");
  add("RS-06", fn, "ok 구(ko): 중앙값·90% 구간·쌍·보유 중앙·같은 쌍 R-ONE, 차이 원인 미측정, 시장 지수 아님·연율화 안 함, 끝에 쌍 표 링크", ["용산구", D([OK])], `${KO_OK} ${LINK_KO}`);
  add("RS-07", fn, "ok 구(en)", ["용산구", D([OK]), "en"], `${EN_OK} ${LINK_EN}`);
  add("RS-08", fn, "이상치 많은 구는 칸 안에 그 말을 더한다", ["용산구", D([{ ...OK, out: 1 }])], `${KO_OK.replace("보유 중앙 378일", "보유 중앙 378일, 이상치 많음")} ${LINK_KO}`);
  add("RS-09", fn, "thin 구(ko): 숫자 없이 표본 부족", ["종로구", D([{ gu: "11110", n: 53, st: "thin" }])], `같은 집이 다시 팔렸을 때: 표본 부족(n=53쌍)이라 값을 싣지 않습니다. ${LINK_KO}`);
  add("RS-10", fn, "thin 구(en)", ["종로구", D([{ gu: "11110", n: 53, st: "thin" }]), "en"], `When the same home sold again: not enough sample (n=53 pairs), so no figure is shown. ${LINK_EN}`);
  add("RS-11", fn, "흔들려 비운 구(shaky)도 숫자 없이", ["용산구", D([{ gu: "11170", n: 119, st: "shaky" }])], `같은 집이 다시 팔렸을 때: 값이 흔들려 싣지 않습니다(119쌍). ${LINK_KO}`);
  add("RS-16", fn, "이름이 undefined → 빈 문자열", [undefined, D([OK])], "");
  // 쌍 수(n)·보유 중앙(gap)은 json 에서 온 칸을 그대로 끼운다(실제 입력은 숫자 - 빌더가 센 값). 특수문자는 이스케이프되고 비문자열은 String() 으로 나온다.
  add("RS-13", fn, "쌍 수의 특수문자 & < > \" ' 는 이스케이프(thin 칸)", ["종로구", D([{ gu: "11110", n: SP, st: "thin" }])], `같은 집이 다시 팔렸을 때: 표본 부족(n=${SP_OUT}쌍)이라 값을 싣지 않습니다. ${LINK_KO}`);
  add("RS-14", fn, "쌍 수가 비문자열 true → \"true\"", ["종로구", D([{ gu: "11110", n: true, st: "thin" }])], `같은 집이 다시 팔렸을 때: 표본 부족(n=true쌍)이라 값을 싣지 않습니다. ${LINK_KO}`);
  add("RS-15", fn, "쌍 수가 {} → \"[object Object]\"", ["종로구", D([{ gu: "11110", n: {}, st: "thin" }])], `같은 집이 다시 팔렸을 때: 표본 부족(n=[object Object]쌍)이라 값을 싣지 않습니다. ${LINK_KO}`);
  add("RS-12", fn, "음수는 - 부호, 0 은 부호 없이 0.0%", ["용산구", D([{ ...OK, p: [-2.5, -4, 0, 0] }])], `${KO_OK.replace("+19.5%", "-2.5%").replace("+15.2% ~ +23.3%", "-4.0% ~ 0.0%").replace("+13.6%", "0.0%")} ${LINK_KO}`);
}

// 이스케이프 없이 문자열에 끼우던 칸(raw)에 `& < > "`가 든 문자열이 오면 React는 이스케이프해서 낸다(고정할 출력; 옛 legacy는 그대로 냈다).
// React가 내는 글자를 적는다. 실제 입력에는 없다 - 빌더가 숫자로만 만든다(PR 본문의 칸별 근거).
// `site`는 옛 legacy 코드에서 이스케이프 없이 끼우던 자리의 이름(참고용), `react`는 그 칸이 낸 전체 출력이다.
const RAWX = `a&b<c>"d'`; // 넣는 글자(옛 legacy는 그대로 냈다). React는 & < > "를 이스케이프하고 `'`는 &#x27;로 내지만 렌더러가 되돌린다 - 바뀌는 것은 & < > "뿐이다
const RAWX_REACT = "a&amp;b&lt;c&gt;&quot;d'"; // React가 낸 글자
// `fn`·`args`는 조각과 인자, `site`는 옛 legacy 코드에서 이스케이프 없이 끼우던 자리, `cell`은 그 자리의 글자를 넣어 줄 전체 출력을 만드는 함수다(손으로 적은 틀).
export const RAW_TEXT_DIFF = [];
{
  const diff = (id, fn, site, args, whole) => RAW_TEXT_DIFF.push({ id, fn, site, args, react: whole(RAWX_REACT) });
  diff("X-CV-rate", "conversionTableHtml", "`${cell.rate}%`", [{ bands: BANDS, cells: [cell({ rate: RAWX })] }], (t) => cvTable("60~85㎡ 기준", [tr("강남구", `${t}%`, "9.5억", "4억 / 215만원", "103")]));
  diff("X-CV-pairs", "conversionTableHtml", "cell.pairs.toLocaleString", [{ bands: BANDS, cells: [cell({ pairs: RAWX })] }], (t) => cvTable("60~85㎡ 기준", [tr("강남구", "4.97%", "9.5억", "4억 / 215만원", t)]));
  for (const [key, index, site] of [["deals", 1, "row.deals.toLocaleString"], ["cancelled", 2, "row.cancelled.toLocaleString"], ["stale", 4, "row.stale.toLocaleString"]])
    diff(`X-KD-${key}`, "cancelDistrictsHtml", site, [{ districts: [kd({ [key]: RAWX })] }], (t) => kdTable([tr(...swap(KD_BASE, index, t))]));
  for (const [key, index, site] of [["filed", 1, "row.filed.toLocaleString"], ["registered", 2, "row.registered.toLocaleString"]])
    diff(`X-KM-${key}`, "cancelMonthsHtml", site, [{ registrationByMonth: [km({ [key]: RAWX })] }], (t) => kmTable([tr(...swap(KM_BASE, index, t))]));
  diff("X-KM-share", "cancelMonthsHtml", "`${row.share}%`", [{ registrationByMonth: [km({ share: RAWX })] }], (t) => kmTable([tr(...swap(KM_BASE, 3, `${t}%`))]));
  for (const [key, index, site] of [["gapMatched", 3, "row.gapMatched.toLocaleString"], ["rightUsed", 5, "row.rightUsed.toLocaleString"]])
    diff(`X-RD-${key}`, "renewalDistrictsHtml", site, [{ table: [rd({ [key]: RAWX })] }], (t) => rdTable([tr(...swap(RD_BASE, index, t))]));
  diff("X-RW-matched", "renewalWolseDistrictsHtml", "row.matched.toLocaleString", [rwData([rw({ matched: RAWX })])], (t) => rwTable("갱신 − 신규 (4.8%)", "3% / 10%로 보면", [tr(...swap(RW_BASE, 4, t))]));
  diff("X-FD-median", "floorDistrictsHtml", "`${row.median}%`", [{ districts: [fd({ median: RAWX })] }], (t) => fdTable([tr(...swap(FD_BASE, 1, `${t}%`))]));
  diff("X-FD-cells", "floorDistrictsHtml", "row.cells.toLocaleString", [{ districts: [fd({ cells: RAWX })] }], (t) => fdTable([tr(...swap(FD_BASE, 2, t))]));
}

// ================= 던지는 입력 =================
// 숫자 칸을 toLocaleString으로 바꾸는 자리에 null·undefined가 오면 legacy는 TypeError를 던진다. React 조각도 같은 함수를 부르므로 같이 던진다(조용히 빈 칸을 내지 않는다).
export const DISTRICT_TABLES_THROWS = [];
{
  const t = (id, fn, cond, args) => DISTRICT_TABLES_THROWS.push({ id, fn, cond, args });
  for (const bad of [null, undefined]) {
    const name = String(bad);
    t(`T-CV-pairs-${name}`, "conversionTableHtml", `단지 칸이 ${name}`, [{ bands: BANDS, cells: [cell({ pairs: bad })] }]);
    t(`T-KD-deals-${name}`, "cancelDistrictsHtml", `신고 칸이 ${name}`, [{ districts: [kd({ deals: bad })] }]);
    t(`T-KD-cancelled-${name}`, "cancelDistrictsHtml", `해제 칸이 ${name}`, [{ districts: [kd({ cancelled: bad })] }]);
    t(`T-KD-stale-${name}`, "cancelDistrictsHtml", `미등기 칸이 ${name}`, [{ districts: [kd({ stale: bad })] }]);
    t(`T-KM-filed-${name}`, "cancelMonthsHtml", `계약 칸이 ${name}`, [{ registrationByMonth: [km({ filed: bad })] }]);
    t(`T-KM-registered-${name}`, "cancelMonthsHtml", `등기 완료 칸이 ${name}`, [{ registrationByMonth: [km({ registered: bad })] }]);
    t(`T-RD-gapMatched-${name}`, "renewalDistrictsHtml", `맞물린 계약 칸이 ${name}`, [{ table: [rd({ gapMatched: bad })] }]);
    t(`T-RD-rightUsed-${name}`, "renewalDistrictsHtml", `요구권 행사 칸이 ${name}`, [{ table: [rd({ rightUsed: bad })] }]);
    t(`T-RW-matched-${name}`, "renewalWolseDistrictsHtml", `맞물린 계약 칸이 ${name}`, [rwData([rw({ matched: bad })])]);
    t(`T-FD-cells-${name}`, "floorDistrictsHtml", `맞물린 칸 칸이 ${name}`, [{ districts: [fd({ cells: bad })] }]);
  }
  t("T-CV-row-null", "conversionTableHtml", "cells 항목이 null(band를 읽다 던진다)", [{ bands: BANDS, cells: [null] }]);
  t("T-CV-cells-str", "conversionTableHtml", "cells가 빈 문자열(?? 를 지나 필터가 없다)", [cv("")]);
  t("T-CV-bands-num", "conversionTableHtml", "bands가 배열이 아닌 숫자(find가 없다)", [{ bands: 5, cells: [cell()] }]);
  t("T-KD-row-null", "cancelDistrictsHtml", "districts 항목이 null", [{ districts: [null] }]);
  t("T-KD-str", "cancelDistrictsHtml", "districts가 문자열 \"ab\"(map이 없다)", [{ districts: "ab" }]);
  t("T-KM-mature-num", "cancelMonthsHtml", "matureMonths가 숫자(Set으로 못 바꾼다)", [withMature(5, km())]);
  t("T-RD-row-null", "renewalDistrictsHtml", "table 항목이 null", [{ table: [null] }]);
  t("T-RW-range-null", "renewalWolseDistrictsHtml", "wolse.range가 null(map이 없다)", [rwData([rw()], wolseOf({ range: null }))]);
  t("T-RW-range-missing", "renewalWolseDistrictsHtml", "wolse.range가 없다", [rwData([rw()], { rate: 4.8 })]);
  t("T-RW-row-range-null", "renewalWolseDistrictsHtml", "행의 range가 null(length를 읽다 던진다)", [rwData([rw({ range: null })])]);
  t("T-FD-row-null", "floorDistrictsHtml", "districts 항목이 null", [{ districts: [null] }]);
  t("T-DS-districts-str", "districtSummaryHtml", "districts가 문자열 \"ab\"(find가 없다)", [{ districts: "ab" }, "종로구"]);
  t("T-DF-total-missing", "districtFactsHtml", "관찰에 total이 없다(toLocaleString를 못 부른다)", [{}]);
}

export const DISTRICT_TABLES_BRANCHES = rows;

// 이 표가 덮는 조각 열세 개의 이름(시험이 표가 열세 개를 다 덮는지 본다). 열한째(districtRentFlowHtml)는 V7 이, 열두째(districtMoveInHtml)는 N5(#677)가, 열셋째(districtResaleHtml)는 G1(#716)이 더했다.
export const DISTRICT_TABLES_FNS = [
  "cancelDistrictsHtml",
  "cancelMonthsHtml",
  "conversionTableHtml",
  "districtFactsHtml",
  "districtLinksHtml",
  "districtMoveInHtml",
  "districtRenewalHtml",
  "districtRentFlowHtml",
  "districtResaleHtml",
  "districtSummaryHtml",
  "floorDistrictsHtml",
  "renewalDistrictsHtml",
  "renewalWolseDistrictsHtml",
];
