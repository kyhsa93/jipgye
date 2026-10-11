// 리드·링크 10개 조각의 분기별 고정 fixture (#241 PR 2): conversionLeadHtml·cancelLeadHtml·cancelMonthLeadHtml·renewalLeadHtml·renewalCapLeadHtml·
// renewalWolseLeadHtml·conversionDistrictLinksHtml·cancelDistrictLinksHtml·renewalDistrictLinksHtml·floorDistrictLinksHtml.
// 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않고 코드(district-slugs.mjs 등)도 부르지 않는다.
// 한 줄이 한 분기다. `args`는 legacy 함수에 그대로 넘기는 인자이고, `expect`는 legacy가 내야 하는 글자다 - 아래 값 표(LEAD_VALUES·SLUG_VALUES)의
// 기대값은 입력을 가공하지 않고 손으로 적었다. `wrap`은 값을 조각이 읽는 자리에 넣을 뿐이고 기대값을 만들지 않는다.
// test/render-parity.test.mjs가 이 표로 (1) legacy 출력이 expect와 같은지, (2) React 조각이 legacy와 바이트까지 같은지 견준다.
//
// 모든 조각에 같은 종류의 값 행을 넣었다(#240·#241 PR 1 교훈 - `str()`을 빼도 시험이 통과하는 자리를 닫는다):
//  - 비문자열: true·5·{}·[1,2]·[]·["a&b"] (legacy `escapeHtml`은 `String(value ?? "")`이라 "true"·"5"·"[object Object]"·"1,2"·""·"a&amp;b"로 낸다)
//  - falsy: ""·null·undefined·0·false·NaN → 리드는 null, "0"·" "은 truthy라 글자 그대로
//  - 비어 있음: 데이터 없음 null·undefined·{}·중간 경로 null·다른 조각이 읽는 자리만 있는 객체
//  - 특수문자: & < > " ' (이미 이스케이프된 &amp;·&#x27;도 - 한 번 더 이스케이프된다)

const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`;

// ================= 리드 6개 =================
// 한 조각의 글 자리 하나(`wrap`)와, 그 조각이 읽지 않는 자리만 채운 객체(`others`).
const FULL = { seoul: { leadKo: "X", registrationLead: { ko: "X" } }, lead: { ko: "X" }, capLead: { ko: "X" }, wolseLead: { ko: "X" } };
const without = (...keys) => {
  const o = structuredClone(FULL);
  for (const key of keys) {
    const [a, b] = key.split(".");
    if (b) delete o[a][b];
    else delete o[a];
  }
  return o;
};
const LEADS = [
  { fn: "conversionLeadHtml", tag: "CL", path: "seoul.leadKo", wrap: (v) => ({ seoul: { leadKo: v } }), partial: [{ seoul: null }, { seoul: {} }, { seoul: { leadKo: undefined } }], others: without("seoul.leadKo") },
  { fn: "cancelLeadHtml", tag: "KL", path: "seoul.leadKo", wrap: (v) => ({ seoul: { leadKo: v } }), partial: [{ seoul: null }, { seoul: {} }, { seoul: { leadKo: undefined } }], others: without("seoul.leadKo") },
  { fn: "cancelMonthLeadHtml", tag: "ML", path: "seoul.registrationLead.ko", wrap: (v) => ({ seoul: { registrationLead: { ko: v } } }), partial: [{ seoul: null }, { seoul: {} }, { seoul: { registrationLead: null } }, { seoul: { registrationLead: {} } }], others: without("seoul.registrationLead") },
  { fn: "renewalLeadHtml", tag: "RL", path: "lead.ko", wrap: (v) => ({ lead: { ko: v } }), partial: [{ lead: null }, { lead: {} }, { lead: { en: "X" } }], others: without("lead") },
  { fn: "renewalCapLeadHtml", tag: "PL", path: "capLead.ko", wrap: (v) => ({ capLead: { ko: v } }), partial: [{ capLead: null }, { capLead: {} }, { capLead: { en: "X" } }], others: without("capLead") },
  { fn: "renewalWolseLeadHtml", tag: "WL", path: "wolseLead.ko", wrap: (v) => ({ wolseLead: { ko: v } }), partial: [{ wolseLead: null }, { wolseLead: {} }, { wolseLead: { en: "X" } }], others: without("wolseLead") },
];

// [id 뒤 번호, 조건, 글 자리에 넣는 값, 기대 출력]
const LEAD_VALUES = [
  ["v01", "보통 문장", "전세가 월세보다 싸다", "전세가 월세보다 싸다"],
  ["v02", `특수문자 & < > " '`, SP, SP_OUT],
  ["v03", "빈 문자열 → null", "", null],
  ["v04", "null → null", null, null],
  ["v05", "undefined → null", undefined, null],
  ["v06", "숫자 0(falsy) → null", 0, null],
  ["v07", "false → null", false, null],
  ["v08", "NaN(falsy) → null", NaN, null],
  ["v09", "문자열 \"0\"은 truthy라 그대로", "0", "0"],
  ["v10", "공백 하나도 truthy라 그대로", " ", " "],
  ["v11", "비문자열 true → \"true\"", true, "true"],
  ["v12", "비문자열 5 → \"5\"", 5, "5"],
  ["v13", "비문자열 {} → \"[object Object]\"", {}, "[object Object]"],
  ["v14", "비문자열 [1,2] → \"1,2\"", [1, 2], "1,2"],
  ["v15", "빈 배열(truthy) → null이 아니라 빈 문자열", [], ""],
  ["v16", "배열 [\"a&b\"] → 이스케이프된 \"a&amp;b\"", ["a&b"], "a&amp;b"],
  ["v17", "개행·한글·이모지는 그대로", "a\n한글 😀", "a\n한글 😀"],
  ["v18", "이미 이스케이프된 &amp;·&#x27;은 한 번 더 이스케이프된다", "&amp; &#x27;", "&amp;amp; &amp;#x27;"],
  ["v19", "작은따옴표만 있으면 그대로(React의 &#x27;은 래퍼가 되돌린다)", "it's", "it's"],
  ["v20", "큰따옴표·꺾쇠 한 줄(태그처럼 보이는 글)", `<b>"굵게"</b>`, "&lt;b&gt;&quot;굵게&quot;&lt;/b&gt;"],
];

const LEAD_ROWS = LEADS.flatMap(({ fn, tag, path, wrap, partial, others }) => [
  { id: `${tag}-n1`, fn, cond: "데이터가 null → null", args: [null], expect: null },
  { id: `${tag}-n2`, fn, cond: "데이터가 undefined → null", args: [undefined], expect: null },
  { id: `${tag}-n3`, fn, cond: "빈 객체 → null", args: [{}], expect: null },
  ...partial.map((arg, i) => ({ id: `${tag}-p${i + 1}`, fn, cond: `읽는 자리(${path})의 중간 경로가 없거나 null·빈 객체 → null: ${JSON.stringify(arg, (_, v) => (v === undefined ? "(undefined)" : v))}`, args: [arg], expect: null })),
  { id: `${tag}-o1`, fn, cond: `다른 조각이 읽는 자리만 채워져 있으면(${path} 없음) → null(자리를 섞어 읽지 않는다)`, args: [others], expect: null },
  ...LEAD_VALUES.map(([no, cond, value, expect]) => ({ id: `${tag}-${no}`, fn, cond: `${path}: ${cond}`, args: [wrap(value)], expect })),
]);

// ================= 자치구 링크 4개 =================
const LINKS = [
  { fn: "conversionDistrictLinksHtml", tag: "CD" },
  { fn: "cancelDistrictLinksHtml", tag: "KD" },
  { fn: "renewalDistrictLinksHtml", tag: "RD" },
  { fn: "floorDistrictLinksHtml", tag: "FD" },
];

const a = (href, name) => `<a href="./district-${href}.html">${name}</a>`;

// [id 뒤 번호, 조건, slugs 자리에 넣는 값, 기대 출력] - slugs가 이런 값이어도 항목이 없으면 null
const EMPTY_SLUGS = [
  ["e1", "slugs가 null → null", null],
  ["e2", "slugs가 undefined → null", undefined],
  ["e3", "slugs가 빈 객체 → null", {}],
  ["e4", "slugs가 빈 배열 → null", []],
  ["e5", "slugs가 빈 문자열 → null", ""],
  ["e6", "slugs가 숫자 5(비객체 → 항목 없음) → null", 5],
  ["e7", "slugs가 true(비객체) → null", true],
  ["e8", "slugs가 0(falsy 숫자도 ?? 를 지나 항목 없음) → null", 0],
  ["e9", "slugs가 false → null", false],
];

// slug 자리의 값 → href에 들어가는 글자(`./district-<글자>.html`)
const SLUG_VALUES = [
  ["s01", "slug 문자열", "jongno", "jongno"],
  ["s02", "slug null → 빈 글자", null, ""],
  ["s03", "slug undefined → 빈 글자", undefined, ""],
  ["s04", "slug 빈 문자열 → 빈 글자", "", ""],
  ["s05", "slug false → \"false\"", false, "false"],
  ["s06", "slug 0 → \"0\"", 0, "0"],
  ["s07", "slug 7 → \"7\"", 7, "7"],
  ["s08", "slug true → \"true\"", true, "true"],
  ["s09", "slug {} → \"[object Object]\"", {}, "[object Object]"],
  ["s10", "slug [1,2] → \"1,2\"", [1, 2], "1,2"],
  ["s11", "slug [] → 빈 글자", [], ""],
  ["s12", "slug NaN → \"NaN\"", NaN, "NaN"],
  ["s13", `slug 특수문자 & < > " '`, SP, SP_OUT],
  ["s14", "slug가 이미 이스케이프된 &amp;·&#x27;이면 한 번 더 이스케이프", "a&amp;b&#x27;", "a&amp;amp;b&amp;#x27;"],
  ["s15", "slug에 공백·한글·슬래시", "a b/한글", "a b/한글"],
];

const LINK_ROWS = LINKS.flatMap(({ fn, tag }) => [
  { id: `${tag}-n1`, fn, cond: "데이터가 null → null", args: [null], expect: null },
  { id: `${tag}-n2`, fn, cond: "데이터가 undefined → null", args: [undefined], expect: null },
  { id: `${tag}-n3`, fn, cond: "빈 객체(slugs 없음) → null", args: [{}], expect: null },
  { id: `${tag}-n4`, fn, cond: "다른 조각이 읽는 자리(cells·districts·table·seoul)만 있고 slugs가 없으면 → null", args: [{ cells: [{ district: "종로구" }], districts: [{ district: "종로구" }], table: [{ district: "종로구" }], seoul: { leadKo: "X" } }], expect: null },
  ...EMPTY_SLUGS.map(([no, cond, slugs]) => ({ id: `${tag}-${no}`, fn, cond, args: [{ slugs }], expect: null })),
  { id: `${tag}-a1`, fn, cond: "항목 하나", args: [{ slugs: { 종로구: "jongno" } }], expect: a("jongno", "종로구") },
  { id: `${tag}-a2`, fn, cond: "항목 여럿은 입력 순서(이름 순이 아니다), 감싸는 요소 없이 이어 붙인다", args: [{ slugs: { 강남구: "gangnam", 종로구: "jongno", 중구: "jung" } }], expect: a("gangnam", "강남구") + a("jongno", "종로구") + a("jung", "중구") },
  { id: `${tag}-a3`, fn, cond: "정수 모양 키는 객체 규칙대로 먼저(1, 2, b) - 두 구현이 같은 Object.entries를 쓴다", args: [{ slugs: { b: "x", 2: "y", 1: "z" } }], expect: a("z", "1") + a("y", "2") + a("x", "b") },
  { id: `${tag}-a4`, fn, cond: `이름과 slug에 특수문자 & < > " '`, args: [{ slugs: { [SP]: SP } }], expect: a(SP_OUT, SP_OUT) },
  { id: `${tag}-a5`, fn, cond: "이름이 빈 문자열(키 \"\") → 빈 앵커 글자", args: [{ slugs: { "": "x" } }], expect: a("x", "") },
  { id: `${tag}-a6`, fn, cond: "slugs가 문자열 \"ab\"면 글자마다 항목(이름 \"0\"·\"1\")", args: [{ slugs: "ab" }], expect: a("a", "0") + a("b", "1") },
  { id: `${tag}-a7`, fn, cond: "slugs가 배열 [\"x\",\"y\"]면 인덱스가 이름", args: [{ slugs: ["x", "y"] }], expect: a("x", "0") + a("y", "1") },
  { id: `${tag}-a8`, fn, cond: "이름이 이미 이스케이프된 글자(&amp;)면 한 번 더 이스케이프", args: [{ slugs: { "a&amp;b": "x" } }], expect: a("x", "a&amp;amp;b") },
  ...SLUG_VALUES.map(([no, cond, slug, text]) => ({ id: `${tag}-${no}`, fn, cond, args: [{ slugs: { 종로구: slug } }], expect: a(text, "종로구") })),
]);

export const LEAD_LINKS_BRANCHES = [...LEAD_ROWS, ...LINK_ROWS];

// `*DistrictLinksHtml` 네 개와 `*LeadHtml` 여섯 개의 이름(시험이 표가 열 개를 다 덮는지 본다).
export const LEAD_LINKS_FNS = [...LEADS, ...LINKS].map((x) => x.fn).sort();
