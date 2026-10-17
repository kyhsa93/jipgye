// 문장·목록 8개 조각의 분기별 고정 fixture (#241 PR 1): summaryHtml·marketHtml·newsContextHtml·newsHtml·newsSummaryHtml·newsListHtml·
// newsKospiHtml·newsRealestateStatsHtml. 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않는다.
// 한 줄이 한 분기다. `args`는 legacy 함수에 그대로 넘기는 인자이고, `expect`는 legacy가 내야 하는 글자다. 마크업은 일부러 손으로 적었다
// (아래 `li`·`chip`·`stat` 같은 도우미는 태그를 글자로 적을 뿐 입력을 가공하지 않는다 - 입력의 엔티티 변환은 기대값에 직접 적었다).
// 그래서 legacy·JSX가 같이 틀려도 걸린다. `order`는 기사 제목 순서만 보는 분기(정렬·자름)다. 데이터가 없으면 null, 칩이 없으면 빈 문자열.
// test/render-parity.test.mjs가 이 표로 (1) legacy 출력이 expect·order와 같은지, (2) React 조각이 legacy와 바이트까지 같은지 견준다.
//
// 모든 조각에 같은 종류의 값 행을 넣었다(#240에서 `String(product.name ?? "-")`가 fixture 부재로 시험을 빠져나간 사례를 닫는다):
//  - 비문자열: false·0·숫자·{}·[]·true  - 비어 있음: null·undefined·""  - 특수문자: & < > " '
// legacy `escapeHtml`은 `String(value ?? "")`이라 false는 "false", {}는 "[object Object]", [1,2]는 "1,2", 0은 "0", null은 ""로 나온다.

// 특수문자 입력과 legacy가 내는 글자(& < > "는 엔티티, '는 그대로 - React의 &#x27;은 래퍼가 되돌린다).
const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`;

const p = (name, text) => `<p><strong>${name}</strong> ${text}</p>`;
const tr = (name, value, change) => `<tr><td>${name}</td><td data-label="값">${value}</td><td data-label="증감">${change}</td></tr>`;
const usd = (value, change) => tr("원/달러 환율", value, change);
const base = (value, from) => tr("기준금리", value, from);
const CHANGE = (text) => `<span title="전일 수집분 대비">${text}</span>`;
const chip = (href, label, value, note) =>
  `<a class="context-chip" href="${href}"><span class="context-label">${label}</span><span class="context-value">${value}</span>${note === undefined ? "" : `<span class="context-note">${note}</span>`}</a>`;
const box = (...chips) => `<div class="news-context">${chips.join("")}</div>`;
const li = (title, link, source, { preview, ctx = "" } = {}) =>
  `<li class="news-item"><a href="${link}" target="_blank" rel="noopener">${title}</a><div class="news-meta">${source}</div>${preview === undefined ? "" : `<div class="news-preview">${preview}</div>`}${ctx}</li>`;
const kospi = (label, value, sub) =>
  `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub === undefined ? "" : `<span class="stat-sub">${sub}</span>`}</div>`;
const stat = (href, label, value, note) =>
  `<a class="stat-card" href="${href}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${note === undefined ? "" : `<span class="stat-sub">${note}</span>`}</a>`;

const n = (title, category = "economy", extra = {}) => ({ title, link: `https://e.com/${title}`, source: "S", category, ...extra });
// 검증 폴백 안내 줄(#350). 글은 손으로 적는다 - scripts/summary-note.mjs 의 상수와 같은지는 test/summary-note.test.mjs 가 틀의 문자열 표와 대조한다.
const NOTE_TEXT = "일부 항목은 검증에서 걸러져 헤드라인 요약으로 대체됐습니다.";
const noteNews = `<div class="summary-note">${NOTE_TEXT}</div>`;
const noteIndex = `<div class="summary-fallback-note">${NOTE_TEXT}</div>`;
const MORE = '<li class="news-more"><a href="./news.html">뉴스 전체 ';

const ROWS = [
  // ================= summaryHtml =================
  { id: "S1", fn: "summaryHtml", cond: "summary가 null → null", args: [null], expect: null },
  { id: "S2", fn: "summaryHtml", cond: "summary가 undefined → null", args: [undefined], expect: null },
  { id: "S3", fn: "summaryHtml", cond: "빈 객체 → null", args: [{}], expect: null },
  { id: "S4", fn: "summaryHtml", cond: "highlights·categories가 둘 다 빈 배열 → null", args: [{ highlights: [], categories: [] }], expect: null },
  { id: "S5", fn: "summaryHtml", cond: "하이라이트만", args: [{ highlights: [{ title: "제목", textKo: "본문" }] }], expect: p("제목", "본문") },
  { id: "S6", fn: "summaryHtml", cond: "분야만", args: [{ categories: [{ name: "분야", lineKo: "한 줄" }] }], expect: p("분야", "한 줄") },
  {
    id: "S7", fn: "summaryHtml", cond: "둘 다 있으면 하이라이트 먼저, 분야 나중(각각 입력 순서)",
    args: [{ highlights: [{ title: "h1", textKo: "t1" }, { title: "h2", textKo: "t2" }], categories: [{ name: "c1", lineKo: "l1" }, { name: "c2", lineKo: "l2" }] }],
    expect: p("h1", "t1") + p("h2", "t2") + p("c1", "l1") + p("c2", "l2"),
  },
  {
    id: "S8", fn: "summaryHtml", cond: "글이 비었거나 falsy(\"\"·null·undefined·0·false)인 항목은 거른다(제목이 있어도), 남은 것만",
    args: [{
      highlights: [{ title: "a", textKo: "" }, { title: "b" }, { title: "c", textKo: null }, { title: "d", textKo: 0 }, { title: "e", textKo: false }, { title: "남음", textKo: "x" }],
      categories: [{ name: "f", lineKo: "" }, { name: "g" }, { name: "남음2", lineKo: "y" }],
    }],
    expect: p("남음", "x") + p("남음2", "y"),
  },
  { id: "S9", fn: "summaryHtml", cond: "걸러 남는 것이 없으면 null(항목은 있다)", args: [{ highlights: [{ title: "a", textKo: "" }], categories: [{ name: "b", lineKo: "" }] }], expect: null },
  { id: "S10", fn: "summaryHtml", cond: "highlights가 null이고 categories만 있다(?? [] 경로)", args: [{ highlights: null, categories: [{ name: "a", lineKo: "b" }] }], expect: p("a", "b") },
  { id: "S11", fn: "summaryHtml", cond: "categories가 null이고 highlights만 있다", args: [{ highlights: [{ title: "a", textKo: "b" }], categories: null }], expect: p("a", "b") },
  { id: "S12", fn: "summaryHtml", cond: `특수문자 & < > " '(제목·본문·분야·한 줄)`, args: [{ highlights: [{ title: SP, textKo: SP }], categories: [{ name: SP, lineKo: SP }] }], expect: p(SP_OUT, SP_OUT) + p(SP_OUT, SP_OUT) },
  {
    id: "S13", fn: "summaryHtml", cond: "비문자열: 제목 false·{}·[1,2], 글 숫자 7·true·{}, 분야 이름 0·false·{}·[1,2], 한 줄 [1,2]·\"x\"·\"y\"·\"z\"",
    args: [{
      highlights: [{ title: false, textKo: 7 }, { title: {}, textKo: true }, { title: [1, 2], textKo: {} }],
      categories: [{ name: 0, lineKo: [1, 2] }, { name: false, lineKo: "x" }, { name: {}, lineKo: "y" }, { name: [1, 2], lineKo: "z" }],
    }],
    expect: p("false", "7") + p("[object Object]", "true") + p("1,2", "[object Object]") + p("0", "1,2") + p("false", "x") + p("[object Object]", "y") + p("1,2", "z"),
  },
  { id: "S14", fn: "summaryHtml", cond: "제목·이름이 null·undefined·\"\"이면 빈 글자(글은 있다)", args: [{ highlights: [{ title: null, textKo: "a" }, { textKo: "b" }, { title: "", textKo: "c" }], categories: [{ lineKo: "d" }] }], expect: p("", "a") + p("", "b") + p("", "c") + p("", "d") },
  { id: "S15", fn: "summaryHtml", cond: "문자열 \"0\"은 truthy라 남는다(숫자 0과 다르다)", args: [{ highlights: [{ title: "t", textKo: "0" }] }], expect: p("t", "0") },
  { id: "S16", fn: "summaryHtml", cond: "분야 하나라도 fallbackReason이 있으면 분야 줄 뒤에 안내 한 줄(index.html renderSummary와 같은 마크업·자리, #350)", args: [{ categories: [{ name: "a", lineKo: "b" }, { name: "c", lineKo: "d", fallbackReason: "unverified-entity" }] }], expect: p("a", "b") + p("c", "d") + noteIndex },
  { id: "S17", fn: "summaryHtml", cond: "하이라이트가 있어도 안내 줄은 맨 끝(하이라이트 → 분야 → 안내)", args: [{ highlights: [{ title: "h", textKo: "t" }], categories: [{ name: "a", lineKo: "b", fallbackReason: "x" }] }], expect: p("h", "t") + p("a", "b") + noteIndex },
  { id: "S18", fn: "summaryHtml", cond: "fallbackReason가 null·undefined·\"\"·0·false(falsy)면 안내 줄 없음", args: [{ categories: [{ name: "a", lineKo: "1", fallbackReason: null }, { name: "b", lineKo: "2" }, { name: "c", lineKo: "3", fallbackReason: "" }, { name: "d", lineKo: "4", fallbackReason: 0 }, { name: "e", lineKo: "5", fallbackReason: false }] }], expect: p("a", "1") + p("b", "2") + p("c", "3") + p("d", "4") + p("e", "5") },
  { id: "S19", fn: "summaryHtml", cond: "한 줄이 빈 분야의 fallbackReason도 센다(화면은 categories 전체를 본다) - 글이 남은 분야가 있어야 조각이 선다", args: [{ categories: [{ name: "a", lineKo: "1" }, { name: "b", lineKo: "", fallbackReason: "x" }] }], expect: p("a", "1") + noteIndex },
  { id: "S20", fn: "summaryHtml", cond: "한 줄 있는 분야가 없으면 fallbackReason가 있어도 null(안내만 있는 상자는 만들지 않는다)", args: [{ categories: [{ name: "b", lineKo: "", fallbackReason: "x" }] }], expect: null },

  // ================= marketHtml =================
  { id: "M1", fn: "marketHtml", cond: "market이 null → null", args: [null], expect: null },
  { id: "M2", fn: "marketHtml", cond: "market이 undefined → null", args: [undefined], expect: null },
  { id: "M3", fn: "marketHtml", cond: "빈 객체 → null", args: [{}], expect: null },
  { id: "M4", fn: "marketHtml", cond: "코스피만 있다 → 이 표엔 코스피 행이 없어 null", args: [{ kospi: { value: "6,977.94", change: "164.60" } }], expect: null },
  { id: "M5", fn: "marketHtml", cond: "환율 증감이 있다 → 값 칸 N.NN원, 증감 칸에 title이 붙은 span(HTML 조각을 칸에 섞는 분기)", args: [{ usdKrw: { value: 1380.5, change: "+2.30" } }], expect: usd("1380.50원", CHANGE("+2.30")) },
  { id: "M6a", fn: "marketHtml", cond: "환율 증감이 없다(undefined) → 증감 칸 '-'(span 없음)", args: [{ usdKrw: { value: 1380.5 } }], expect: usd("1380.50원", "-") },
  { id: "M6b", fn: "marketHtml", cond: "환율 증감이 \"\" → '-'", args: [{ usdKrw: { value: 1380.5, change: "" } }], expect: usd("1380.50원", "-") },
  { id: "M6c", fn: "marketHtml", cond: "환율 증감이 null → '-'", args: [{ usdKrw: { value: 1380.5, change: null } }], expect: usd("1380.50원", "-") },
  { id: "M6d", fn: "marketHtml", cond: "환율 증감이 0·false(falsy) → '-'", args: [{ usdKrw: { value: 1380.5, change: 0 } }, { usdKrw: { value: 1, change: false } }], expect: null, each: [usd("1380.50원", "-"), usd("1.00원", "-")] },
  { id: "M7", fn: "marketHtml", cond: "환율 값이 숫자가 아니면(문자열·null·undefined) 행이 없다 → null", args: [{ usdKrw: { value: "1380.5", change: "+1" } }], expect: null },
  { id: "M8", fn: "marketHtml", cond: "환율 값 0은 숫자다(0.00원, 행이 있다)·소수 둘째 자리 반올림", args: [{ usdKrw: { value: 0 } }], expect: usd("0.00원", "-") },
  { id: "M8b", fn: "marketHtml", cond: "환율 값 소수 셋째 자리 이상은 toFixed(2)로 반올림", args: [{ usdKrw: { value: 1380.456, change: "x" } }], expect: usd("1380.46원", CHANGE("x")) },
  { id: "M8c", fn: "marketHtml", cond: "환율 값이 NaN이어도 typeof는 number라 행이 있다(NaN원)", args: [{ usdKrw: { value: NaN } }], expect: usd("NaN원", "-") },
  { id: "M9", fn: "marketHtml", cond: "기준금리만(적용일 있음) → 값 N%, 증감 칸에 적용일 글자", args: [{ baseRate: { value: "2.75", effectiveFrom: "2026-08-28" } }], expect: base("2.75%", "2026-08-28") },
  { id: "M10a", fn: "marketHtml", cond: "기준금리 적용일(effectiveFrom)이 없다(undefined) → '-'", args: [{ baseRate: { value: "2.75" } }], expect: base("2.75%", "-") },
  { id: "M10b", fn: "marketHtml", cond: "기준금리 적용일이 null → '-'(?? 경로)", args: [{ baseRate: { value: "2.75", effectiveFrom: null } }], expect: base("2.75%", "-") },
  { id: "M10c", fn: "marketHtml", cond: "기준금리 적용일이 \"\"이면 '-'가 아니라 빈 칸 그대로(?? 는 \"\"를 통과)", args: [{ baseRate: { value: "2.75", effectiveFrom: "" } }], expect: base("2.75%", "") },
  { id: "M10d", fn: "marketHtml", cond: "기준금리 적용일이 false·0이면 \"false\"·\"0\"(비문자열)", args: [{ baseRate: { value: "2.75", effectiveFrom: false } }, { baseRate: { value: "2.75", effectiveFrom: 0 } }], expect: null, each: [base("2.75%", "false"), base("2.75%", "0")] },
  { id: "M11", fn: "marketHtml", cond: "기준금리 값이 falsy(\"\"·0·null·undefined)면 행이 없다 → null", args: [{ baseRate: { value: "", effectiveFrom: "x" } }, { baseRate: { value: 0 } }, { baseRate: { value: null } }, { baseRate: {} }], expect: null, each: [null, null, null, null] },
  { id: "M12", fn: "marketHtml", cond: "기준금리 값이 숫자 2.75·문자열 \"0\"(truthy)이면 행이 있다", args: [{ baseRate: { value: 2.75 } }, { baseRate: { value: "0" } }], expect: null, each: [base("2.75%", "-"), base("0%", "-")] },
  {
    id: "M13", fn: "marketHtml", cond: "둘 다 있으면 환율 → 기준금리 순(코스피는 무시)",
    args: [{ kospi: { value: "1" }, baseRate: { value: "2.75", effectiveFrom: "2026-08-28" }, usdKrw: { value: 1380.5, change: "+2.30" } }],
    expect: usd("1380.50원", CHANGE("+2.30")) + base("2.75%", "2026-08-28"),
  },
  { id: "M14", fn: "marketHtml", cond: "환율 행은 없고 기준금리만 있다(환율 값 비숫자 + 기준금리)", args: [{ usdKrw: { value: null }, baseRate: { value: "2.75" } }], expect: base("2.75%", "-") },
  { id: "M15", fn: "marketHtml", cond: `특수문자: 환율 증감 <b>&"' 은 span 안에서 엔티티, 기준금리 값·적용일도`, args: [{ usdKrw: { value: 1, change: `<b>&"'` }, baseRate: { value: `2.7<5>"'`, effectiveFrom: SP } }], expect: usd("1.00원", CHANGE(`&lt;b&gt;&amp;&quot;'`)) + base(`2.7&lt;5&gt;&quot;'%`, SP_OUT) },
  { id: "M16", fn: "marketHtml", cond: "비문자열: 환율 증감 {}·5·[1,2](truthy)·기준금리 값 true·적용일 {}", args: [{ usdKrw: { value: 1, change: {} } }, { usdKrw: { value: 1, change: 5 } }, { usdKrw: { value: 1, change: [1, 2] } }, { baseRate: { value: true, effectiveFrom: {} } }], expect: null, each: [usd("1.00원", CHANGE("[object Object]")), usd("1.00원", CHANGE("5")), usd("1.00원", CHANGE("1,2")), base("true%", "[object Object]")] },

  // ================= newsContextHtml (칩이 없으면 null이 아니라 빈 문자열) =================
  { id: "C1", fn: "newsContextHtml", cond: "context가 undefined → 빈 문자열(null이 아니다)", args: [undefined], expect: "" },
  { id: "C2", fn: "newsContextHtml", cond: "context가 null → 빈 문자열", args: [null], expect: "" },
  { id: "C3", fn: "newsContextHtml", cond: "context가 빈 배열 → 빈 문자열", args: [[]], expect: "" },
  { id: "C4", fn: "newsContextHtml", cond: "칩 하나, 노트 있음", args: [[{ href: "./x.html", label: "L", value: "V", note: "N" }]], expect: box(chip("./x.html", "L", "V", "N")) },
  { id: "C5", fn: "newsContextHtml", cond: "노트가 없다(undefined)", args: [[{ href: "./x.html", label: "L", value: "V" }]], expect: box(chip("./x.html", "L", "V")) },
  { id: "C6", fn: "newsContextHtml", cond: "노트가 \"\"·null·0·false(falsy)면 노트 span을 내지 않는다", args: [[{ href: "a", label: "l", value: "v", note: "" }, { href: "b", label: "l", value: "v", note: null }, { href: "c", label: "l", value: "v", note: 0 }, { href: "d", label: "l", value: "v", note: false }]], expect: box(chip("a", "l", "v"), chip("b", "l", "v"), chip("c", "l", "v"), chip("d", "l", "v")) },
  { id: "C7", fn: "newsContextHtml", cond: "칩 둘은 입력 순서, 상자는 하나", args: [[{ href: "a", label: "l1", value: "v1", note: "n1" }, { href: "b", label: "l2", value: "v2" }]], expect: box(chip("a", "l1", "v1", "n1"), chip("b", "l2", "v2")) },
  { id: "C8", fn: "newsContextHtml", cond: `특수문자 & < > " '(href·라벨·값·노트): 속성에서도 같은 엔티티`, args: [[{ href: `./a.html?x=1&y="2"'<`, label: SP, value: SP, note: SP }]], expect: box(chip(`./a.html?x=1&amp;y=&quot;2&quot;'&lt;`, SP_OUT, SP_OUT, SP_OUT)) },
  { id: "C9", fn: "newsContextHtml", cond: "비문자열: href null→\"\"(href=\"\" 속성은 남는다), 라벨 false, 값 0, 노트 5", args: [[{ href: null, label: false, value: 0, note: 5 }]], expect: box(chip("", "false", "0", "5")) },
  { id: "C10", fn: "newsContextHtml", cond: "비문자열: 라벨 {}, 값 [1,2], 노트 true", args: [[{ href: 7, label: {}, value: [1, 2], note: true }]], expect: box(chip("7", "[object Object]", "1,2", "true")) },
  { id: "C11", fn: "newsContextHtml", cond: "필드가 전부 없는 칩({}): href=\"\"와 빈 라벨·빈 값", args: [[{}]], expect: box(chip("", "", "")) },

  // ================= newsHtml (첫 화면: 부동산 먼저·다섯 건·미리보기·맥락·더 보기) =================
  { id: "N1a", fn: "newsHtml", cond: "news가 null → null", args: [null], expect: null },
  { id: "N1b", fn: "newsHtml", cond: "빈 객체·items 없음 → null", args: [{}], expect: null },
  { id: "N1c", fn: "newsHtml", cond: "items가 빈 배열 → null", args: [{ items: [] }], expect: null },
  { id: "N1d", fn: "newsHtml", cond: "news가 undefined → null", args: [undefined], expect: null },
  { id: "N2", fn: "newsHtml", cond: "기사 하나(미리보기·맥락 없음): 링크는 새 창, 출처 줄", args: [{ items: [{ title: "T", link: "https://e.com/1", source: "S", category: "economy" }] }], expect: li("T", "https://e.com/1", "S") },
  { id: "N3", fn: "newsHtml", cond: "미리보기 + 맥락 칩이 있으면 출처 줄 뒤에 미리보기, 그 뒤에 칩 상자", args: [{ items: [{ title: "T", link: "L", source: "S", preview: "P", context: [{ href: "./r.html", label: "l", value: "v", note: "n" }] }] }], expect: li("T", "L", "S", { preview: "P", ctx: box(chip("./r.html", "l", "v", "n")) }) },
  { id: "N4", fn: "newsHtml", cond: "미리보기가 \"\"·null·undefined·0·false(falsy)면 미리보기 div가 없다", args: [{ items: [{ title: "a", link: "L", source: "S", preview: "" }, { title: "b", link: "L", source: "S", preview: null }, { title: "c", link: "L", source: "S" }, { title: "d", link: "L", source: "S", preview: 0 }, { title: "e", link: "L", source: "S", preview: false }] }], expect: ["a", "b", "c", "d", "e"].map((t) => li(t, "L", "S")).join("") },
  { id: "N5", fn: "newsHtml", cond: "출처가 없다(undefined·null)면 빈 출처 div(남는다)", args: [{ items: [{ title: "a", link: "L" }, { title: "b", link: "L", source: null }] }], expect: li("a", "L", "") + li("b", "L", "") },
  { id: "N6", fn: "newsHtml", cond: "context가 빈 배열이면 칩 상자를 내지 않는다(빈 문자열)", args: [{ items: [{ title: "T", link: "L", source: "S", context: [] }] }], expect: li("T", "L", "S") },
  {
    id: "N7", fn: "newsHtml", cond: "6건: 부동산(category=realestate) 먼저 → 나머지, 앞 다섯 건만, 끝에 '뉴스 전체 6건 보기'(입력은 일반 3건 뒤 부동산 3건)",
    args: [{ items: [n("e0"), n("e1"), n("e2"), n("r0", "realestate"), n("r1", "realestate"), n("r2", "realestate")] }],
    expect: ["r0", "r1", "r2", "e0", "e1"].map((t) => li(t, `https://e.com/${t}`, "S")).join("") + `${MORE}6건 보기 →</a></li>`,
  },
  { id: "N8", fn: "newsHtml", cond: "정확히 다섯 건이면 '더 보기' 줄이 없다(5 > 5가 거짓)", args: [{ items: [n("a"), n("b"), n("c"), n("d"), n("e")] }], order: ["a", "b", "c", "d", "e"], noMore: true },
  { id: "N9", fn: "newsHtml", cond: "일곱 건이면 다섯 건 + '뉴스 전체 7건 보기'(부동산이 없으면 입력 순서)", args: [{ items: [n("a"), n("b"), n("c"), n("d"), n("e"), n("f"), n("g")] }], order: ["a", "b", "c", "d", "e"], more: "7" },
  { id: "N10", fn: "newsHtml", cond: "부동산이 다섯 건을 넘으면 부동산만 다섯(앞에서부터), 나머지는 밀린다", args: [{ items: [n("e0"), ...Array.from({ length: 6 }, (_, i) => n(`r${i}`, "realestate"))] }], order: ["r0", "r1", "r2", "r3", "r4"], more: "7" },
  { id: "N11", fn: "newsHtml", cond: "category가 없는 기사는 부동산이 아닌 쪽(입력 순서로 부동산 뒤)", args: [{ items: [{ title: "x", link: "L", source: "S" }, n("r", "realestate")] }], order: ["r", "x"] },
  { id: "N12", fn: "newsHtml", cond: `특수문자 & < > " '(제목·링크·출처·미리보기·맥락)`, args: [{ items: [{ title: SP, link: `https://e.com/?a=1&b="2"'`, source: SP, preview: SP, context: [{ href: SP, label: SP, value: SP, note: SP }] }] }], expect: li(SP_OUT, `https://e.com/?a=1&amp;b=&quot;2&quot;'`, SP_OUT, { preview: SP_OUT, ctx: box(chip(SP_OUT, SP_OUT, SP_OUT, SP_OUT)) }) },
  { id: "N13", fn: "newsHtml", cond: "비문자열: 제목 false·{}, 링크 null·7, 출처 0·[1,2], 미리보기 5·true", args: [{ items: [{ title: false, link: null, source: 0, preview: 5 }, { title: {}, link: 7, source: [1, 2], preview: true }] }], expect: li("false", "", "0", { preview: "5" }) + li("[object Object]", "7", "1,2", { preview: "true" }) },
  { id: "N14", fn: "newsHtml", cond: "제목·링크 누락: 빈 제목·href=\"\"(속성은 남는다)", args: [{ items: [{ source: "S" }] }], expect: li("", "", "S") },
  { id: "N15", fn: "newsHtml", cond: "맥락 칩이 여럿인 기사와 없는 기사가 섞인 한 번의 목록(칩은 해당 기사 안에만)", args: [{ items: [{ title: "a", link: "L", source: "S", context: [{ href: "h", label: "l", value: "v" }] }, { title: "b", link: "L", source: "S" }] }], expect: li("a", "L", "S", { ctx: box(chip("h", "l", "v")) }) + li("b", "L", "S") },

  // ================= newsSummaryHtml(summary, category) =================
  { id: "Y1", fn: "newsSummaryHtml", cond: "summary가 null → null", args: [null], expect: null },
  { id: "Y2", fn: "newsSummaryHtml", cond: "빈 객체 → null", args: [{}], expect: null },
  { id: "Y3", fn: "newsSummaryHtml", cond: "categories가 빈 배열 → null", args: [{ categories: [] }], expect: null },
  { id: "Y4", fn: "newsSummaryHtml", cond: "한 줄(lineKo)이 비었거나 falsy인 분야뿐이면 → null", args: [{ categories: [{ name: "a", lineKo: "" }, { name: "b" }, { name: "c", lineKo: null }, { name: "d", lineKo: 0 }] }], expect: null },
  { id: "Y5", fn: "newsSummaryHtml", cond: "category 생략(기본 null) → 한 줄 있는 분야 전부(입력 순서), 하이라이트는 쓰지 않는다", args: [{ highlights: [{ title: "H", textKo: "t" }], categories: [{ key: "a", name: "부동산", lineKo: "줄1" }, { key: "b", name: "증시", lineKo: "줄2" }] }], expect: p("부동산", "줄1") + p("증시", "줄2") },
  { id: "Y6", fn: "newsSummaryHtml", cond: "category가 key와 같은 분야만", args: [{ categories: [{ key: "a", name: "부동산", lineKo: "줄1" }, { key: "b", name: "증시", lineKo: "줄2" }] }, "b"], expect: p("증시", "줄2") },
  { id: "Y7", fn: "newsSummaryHtml", cond: "category와 맞는 분야가 없다 → null", args: [{ categories: [{ key: "a", name: "부동산", lineKo: "줄1" }] }, "zzz"], expect: null },
  { id: "Y8", fn: "newsSummaryHtml", cond: "category가 \"\"(falsy)면 거르지 않는다(전부)", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "2" }] }, ""], expect: p("A", "1") + p("B", "2") },
  { id: "Y9", fn: "newsSummaryHtml", cond: "category가 맞아도 한 줄이 비면 그 분야는 빠진다 → null", args: [{ categories: [{ key: "a", name: "A", lineKo: "" }] }, "a"], expect: null },
  { id: "Y10", fn: "newsSummaryHtml", cond: "key가 없는 분야는 category가 truthy면 걸러진다", args: [{ categories: [{ name: "A", lineKo: "1" }, { key: "k", name: "B", lineKo: "2" }] }, "k"], expect: p("B", "2") },
  { id: "Y11", fn: "newsSummaryHtml", cond: `특수문자 & < > " '(이름·한 줄)`, args: [{ categories: [{ name: SP, lineKo: SP }] }], expect: p(SP_OUT, SP_OUT) },
  { id: "Y12", fn: "newsSummaryHtml", cond: "비문자열: 이름 false·0·{}·null, 한 줄 5·[1,2]·true·{}", args: [{ categories: [{ name: false, lineKo: 5 }, { name: 0, lineKo: [1, 2] }, { name: {}, lineKo: true }, { name: null, lineKo: {} }] }], expect: p("false", "5") + p("0", "1,2") + p("[object Object]", "true") + p("", "[object Object]") },
  { id: "Y13", fn: "newsSummaryHtml", cond: "이름이 없다(undefined) → 빈 글자", args: [{ categories: [{ lineKo: "x" }] }], expect: p("", "x") },
  { id: "Y14", fn: "newsSummaryHtml", cond: "보이는 분야에 fallbackReason가 있으면 분야 줄 뒤에 안내 한 줄(뉴스 틀 renderSummary의 shown.some, #350)", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "2", fallbackReason: "unverified-entity" }] }], expect: p("A", "1") + p("B", "2") + noteNews },
  { id: "Y15", fn: "newsSummaryHtml", cond: "분야 필터가 있으면 그 분야의 폴백만 센다(다른 분야의 폴백은 안내를 만들지 않는다)", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "2", fallbackReason: "x" }] }, "a"], expect: p("A", "1") },
  { id: "Y16", fn: "newsSummaryHtml", cond: "분야 필터가 폴백 있는 분야를 가리키면 그 한 줄 + 안내", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "2", fallbackReason: "x" }] }, "b"], expect: p("B", "2") + noteNews },
  { id: "Y17", fn: "newsSummaryHtml", cond: "한 줄이 빈 분야는 보이지 않으므로 그 분야의 fallbackReason는 안내를 만들지 않는다(화면의 shown은 한 줄 있는 것만)", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "", fallbackReason: "x" }] }], expect: p("A", "1") },
  { id: "Y18", fn: "newsSummaryHtml", cond: "fallbackReason가 null·\"\"·0·false·없음(falsy)이면 안내 줄 없음", args: [{ categories: [{ key: "a", name: "A", lineKo: "1", fallbackReason: null }, { key: "b", name: "B", lineKo: "2", fallbackReason: "" }, { key: "c", name: "C", lineKo: "3", fallbackReason: 0 }, { key: "d", name: "D", lineKo: "4", fallbackReason: false }, { key: "e", name: "E", lineKo: "5" }] }], expect: p("A", "1") + p("B", "2") + p("C", "3") + p("D", "4") + p("E", "5") },

  // ================= newsListHtml(news, category) — 뉴스 장: 정렬·자름·미리보기 없음 =================
  { id: "L1", fn: "newsListHtml", cond: "news가 null → null", args: [null], expect: null },
  { id: "L2", fn: "newsListHtml", cond: "빈 객체·items 없음 → null", args: [{}], expect: null },
  { id: "L3", fn: "newsListHtml", cond: "items가 빈 배열 → null", args: [{ items: [] }], expect: null },
  { id: "L4", fn: "newsListHtml", cond: "category와 맞는 기사가 없다 → null", args: [{ items: [n("a", "economy")] }, "realestate"], expect: null },
  { id: "L5", fn: "newsListHtml", cond: "category 생략: 전부, 입력 순서(부동산 먼저 정렬·다섯 건 자름·'더 보기' 줄이 없다), 미리보기는 내지 않는다", args: [{ items: [n("e0", "economy", { preview: "P" }), n("r0", "realestate"), n("e1"), n("r1", "realestate"), n("e2"), n("e3"), n("e4")] }], order: ["e0", "r0", "e1", "r1", "e2", "e3", "e4"], noMore: true, noPreview: true },
  { id: "L6", fn: "newsListHtml", cond: "category로 거르면 그 분야만(입력 순서)", args: [{ items: [n("e0", "economy"), n("r0", "realestate"), n("e1", "economy"), n("r1", "realestate")] }, "realestate"], order: ["r0", "r1"] },
  { id: "L7", fn: "newsListHtml", cond: "category가 \"\"(falsy)면 거르지 않는다", args: [{ items: [n("a", "economy"), n("b", "realestate")] }, ""], order: ["a", "b"] },
  { id: "L8", fn: "newsListHtml", cond: "한 건: 미리보기를 줘도 안 낸다, 맥락 칩은 낸다", args: [{ items: [{ title: "T", link: "L", source: "S", preview: "P", context: [{ href: "h", label: "l", value: "v", note: "n" }] }] }], expect: li("T", "L", "S", { ctx: box(chip("h", "l", "v", "n")) }) },
  { id: "L9", fn: "newsListHtml", cond: "맥락이 없거나 빈 배열이면 칩 상자 없음, 출처가 없으면 빈 출처 div", args: [{ items: [{ title: "a", link: "L", context: [] }, { title: "b", link: "L", source: null }] }], expect: li("a", "L", "") + li("b", "L", "") },
  { id: "L10", fn: "newsListHtml", cond: `특수문자 & < > " '(제목·링크·출처·맥락)`, args: [{ items: [{ title: SP, link: `https://e.com/?a=1&b="2"'`, source: SP, context: [{ href: SP, label: SP, value: SP, note: SP }] }] }], expect: li(SP_OUT, `https://e.com/?a=1&amp;b=&quot;2&quot;'`, SP_OUT, { ctx: box(chip(SP_OUT, SP_OUT, SP_OUT, SP_OUT)) }) },
  { id: "L11", fn: "newsListHtml", cond: "비문자열: 제목 false·{}, 링크 null·7, 출처 0·[1,2]", args: [{ items: [{ title: false, link: null, source: 0 }, { title: {}, link: 7, source: [1, 2] }] }], expect: li("false", "", "0") + li("[object Object]", "7", "1,2") },
  { id: "L12", fn: "newsListHtml", cond: "제목·링크·출처 누락: 빈 제목·href=\"\"·빈 출처", args: [{ items: [{}] }], expect: li("", "", "") },

  // ================= newsKospiHtml =================
  { id: "K1a", fn: "newsKospiHtml", cond: "market이 null → null", args: [null], expect: null },
  { id: "K1b", fn: "newsKospiHtml", cond: "market이 undefined → null", args: [undefined], expect: null },
  { id: "K1c", fn: "newsKospiHtml", cond: "빈 객체·kospi 없음 → null", args: [{}], expect: null },
  { id: "K1d", fn: "newsKospiHtml", cond: "kospi가 null·{} → null", args: [{ kospi: null }, { kospi: {} }], expect: null, each: [null, null] },
  { id: "K1e", fn: "newsKospiHtml", cond: "kospi.value가 \"\"·0·null·false(falsy)면 null(값 없는 카드는 안 낸다)", args: [{ kospi: { value: "", asOf: "x" } }, { kospi: { value: 0 } }, { kospi: { value: null } }, { kospi: { value: false } }], expect: null, each: [null, null, null, null] },
  { id: "K2", fn: "newsKospiHtml", cond: "값만 있다 → 라벨 '코스피', 증감 줄 없음", args: [{ kospi: { value: "6,977.94" } }], expect: kospi("코스피", "6,977.94") },
  { id: "K3", fn: "newsKospiHtml", cond: "기준일(asOf)이 있으면 라벨에 '코스피 날짜 종가', 증감이 있으면 '전 거래일 대비' 줄", args: [{ kospi: { value: "6,977.94", asOf: "2026-10-09", change: "+164.60" } }], expect: kospi("코스피 2026-10-09 종가", "6,977.94", "전 거래일 대비 +164.60") },
  { id: "K4", fn: "newsKospiHtml", cond: "asOf가 \"\"·null이면 '코스피'만, 증감이 \"\"·null·0이면 증감 줄 없음", args: [{ kospi: { value: "1", asOf: "", change: "" } }, { kospi: { value: "1", asOf: null, change: null } }, { kospi: { value: "1", change: 0 } }], expect: null, each: [kospi("코스피", "1"), kospi("코스피", "1"), kospi("코스피", "1")] },
  { id: "K5", fn: "newsKospiHtml", cond: `특수문자 & < > " '(값·기준일·증감)`, args: [{ kospi: { value: SP, asOf: SP, change: SP } }], expect: kospi(`코스피 ${SP_OUT} 종가`, SP_OUT, `전 거래일 대비 ${SP_OUT}`) },
  { id: "K6", fn: "newsKospiHtml", cond: "비문자열: 값 숫자 6977.94·true·{}, 기준일 {}·[1,2]·5, 증감 5·{}·[1,2]", args: [{ kospi: { value: 6977.94, asOf: {}, change: 5 } }, { kospi: { value: true, asOf: [1, 2], change: {} } }, { kospi: { value: {}, asOf: 5, change: [1, 2] } }], expect: null, each: [kospi("코스피 [object Object] 종가", "6977.94", "전 거래일 대비 5"), kospi("코스피 1,2 종가", "true", "전 거래일 대비 [object Object]"), kospi("코스피 5 종가", "[object Object]", "전 거래일 대비 1,2")] },
  { id: "K7", fn: "newsKospiHtml", cond: "문자열 \"0\"은 truthy라 카드가 있다", args: [{ kospi: { value: "0" } }], expect: kospi("코스피", "0") },

  // ================= newsRealestateStatsHtml =================
  { id: "T1a", fn: "newsRealestateStatsHtml", cond: "news가 null → null", args: [null], expect: null },
  { id: "T1b", fn: "newsRealestateStatsHtml", cond: "빈 객체·realestateStats 없음 → null", args: [{}], expect: null },
  { id: "T1c", fn: "newsRealestateStatsHtml", cond: "realestateStats가 빈 배열·null → null", args: [{ realestateStats: [] }, { realestateStats: null }], expect: null, each: [null, null] },
  { id: "T2", fn: "newsRealestateStatsHtml", cond: "카드 하나, 노트 있음", args: [{ realestateStats: [{ href: "./a.html", label: "L", value: "V", note: "N" }] }], expect: stat("./a.html", "L", "V", "N") },
  { id: "T3", fn: "newsRealestateStatsHtml", cond: "노트가 없다(undefined)·\"\"·null·0·false(falsy) → 노트 span 없음", args: [{ realestateStats: [{ href: "a", label: "l", value: "v" }, { href: "b", label: "l", value: "v", note: "" }, { href: "c", label: "l", value: "v", note: null }, { href: "d", label: "l", value: "v", note: 0 }, { href: "e", label: "l", value: "v", note: false }] }], expect: ["a", "b", "c", "d", "e"].map((h) => stat(h, "l", "v")).join("") },
  { id: "T4", fn: "newsRealestateStatsHtml", cond: "카드 둘은 입력 순서(이어 붙임, 감싸는 요소 없음)", args: [{ realestateStats: [{ href: "a", label: "l1", value: "v1", note: "n1" }, { href: "b", label: "l2", value: "v2" }] }], expect: stat("a", "l1", "v1", "n1") + stat("b", "l2", "v2") },
  { id: "T5", fn: "newsRealestateStatsHtml", cond: `특수문자 & < > " '(href·라벨·값·노트)`, args: [{ realestateStats: [{ href: `./a.html?x=1&y="2"'`, label: SP, value: SP, note: SP }] }], expect: stat(`./a.html?x=1&amp;y=&quot;2&quot;'`, SP_OUT, SP_OUT, SP_OUT) },
  { id: "T6", fn: "newsRealestateStatsHtml", cond: "비문자열: href null→\"\"(속성 남는다), 라벨 false, 값 0, 노트 5", args: [{ realestateStats: [{ href: null, label: false, value: 0, note: 5 }] }], expect: stat("", "false", "0", "5") },
  { id: "T7", fn: "newsRealestateStatsHtml", cond: "비문자열: href 7, 라벨 {}, 값 [1,2], 노트 true·필드 전부 없는 카드({})", args: [{ realestateStats: [{ href: 7, label: {}, value: [1, 2], note: true }, {}] }], expect: stat("7", "[object Object]", "1,2", "true") + stat("", "", "") },
];

// `each`가 있는 행은 `args`의 원소 하나(첫 인자)마다 한 번씩 부르고 `each[i]`가 그 기대값이다. 풀어 쓰면 id는 "M6d.1"·"M6d.2"처럼 번호가 붙는다.
export const NEWS_MARKET_BRANCHES = ROWS.flatMap((row) =>
  row.each
    ? row.each.map((expect, i) => ({ ...row, id: `${row.id}.${i + 1}`, args: [row.args[i]], expect, each: undefined }))
    : [row]
);

// 알려진 차이(허용 변환 밖): React 19는 href가 `javascript:` 로 시작하면(대소문자·앞 공백 무시) 그 URL을 막고 오류를 던지는 자리표시로 바꿔 낸다.
// legacy는 값을 그대로 낸다. 뉴스 링크는 RSS(https)에서 오고 맥락·통계 href는 코드가 정한 상대 경로라 실제 입력에서는 나오지 않는다.
// fixture 표에 넣지 않고(바이트 일치가 아니다) 별도 시험이 이 차이가 지금 이대로인지 고정한다.
export const JAVASCRIPT_URL_DIFF = {
  fn: "newsListHtml",
  args: [{ items: [{ title: "t", link: "javascript:alert(1)", source: "s" }] }],
  legacy: li("t", "javascript:alert(1)", "s"),
  react: li("t", "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')", "s"),
};
