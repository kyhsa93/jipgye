// 문장·목록 7개 조각의 분기별 고정 fixture (#241 PR 1; summaryHtml 은 #593 에서 지웠다): marketHtml·newsContextHtml·newsHtml·newsSummaryHtml·newsListHtml·
// newsKospiHtml·newsRealestateStatsHtml. 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않는다.
// 한 줄이 한 분기다. `args`는 조각 함수에 그대로 넘기는 인자이고, `expect`는 React 조각이 내야 하는 글자다. 마크업은 일부러 손으로 적었다
// (아래 `li`·`chip`·`stat` 같은 도우미는 태그를 글자로 적을 뿐 입력을 가공하지 않는다 - 입력의 엔티티 변환은 기대값에 직접 적었다).
// 그래서 JSX 조각과 그 도우미가 같이 틀려도 걸린다. `order`는 기사 제목 순서만 보는 분기(정렬·자름)다. 데이터가 없으면 null, 칩이 없으면 빈 문자열.
// test/render-parity.test.mjs가 이 표로 React 조각 출력이 expect·order와 같은지 견준다(#248 P2: legacy 출력은 더 이상 기준이 아니다).
//
// 모든 조각에 같은 종류의 값 행을 넣었다(#240에서 `String(product.name ?? "-")`가 fixture 부재로 시험을 빠져나간 사례를 닫는다):
//  - 비문자열: false·0·숫자·{}·[]·true  - 비어 있음: null·undefined·""  - 특수문자: & < > " '
// 문자열 값은 `String(value ?? "")`을 거쳐 글자로 나가므로 false는 "false", {}는 "[object Object]", [1,2]는 "1,2", 0은 "0", null은 ""로 나온다.

// 특수문자 입력과 조각이 내는 글자(& < > "는 엔티티, '는 그대로 - React의 &#x27;은 렌더러가 되돌린다).
const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`;

const p = (name, text) => `<p><strong>${name}</strong> ${text}</p>`;
// 메인 돈의 값 한 줄(#575 PR2): 기준금리 → 환율, " · " 로 잇는다.
const base = (value) => `한국은행 기준금리 ${value}%`;
const usd = (value) => `원/달러 환율 ${value}원`;
const chip = (href, label, value, note) =>
  `<a class="context-chip" href="${href}"><span class="context-label">${label}</span><span class="context-value">${value}</span>${note === undefined ? "" : `<span class="context-note">${note}</span>`}</a>`;
const box = (...chips) => `<div class="news-context">${chips.join("")}</div>`;
const li = (title, link, source, { preview, ctx = "" } = {}) =>
  `<li class="news-item"><a href="${link}" target="_blank" rel="noopener">${title}</a><div class="news-meta">${source}</div>${preview === undefined ? "" : `<div class="news-preview">${preview}</div>`}${ctx}</li>`;
const kospi = (label, value, sub) =>
  `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub === undefined ? "" : `<span class="stat-sub">${sub}</span>`}</div>`;
// 증시 뉴스 장의 원/달러 환율 카드(#639 PR-2): 라벨·보조 글은 ko·en 을 둘 다 굽고 html lang 이 가린다(m-ko·m-en).
const bi = (ko, en) => `<span class="m-ko">${ko}</span><span class="m-en">${en}</span>`;
const fxCard = (at, value, change) =>
  `<div class="stat-card"><span class="stat-label">${bi(`원/달러 환율 ${at} 매매기준율`, `USD/KRW ${at} reference rate`)}</span><span class="stat-value">${value}</span>${change === undefined ? "" : `<span class="stat-sub">${bi(`전 영업일 대비 ${change}`, `vs previous business day ${change}`)}</span>`}</div>`;
const stat = (href, label, value, note) =>
  `<a class="stat-card" href="${href}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${note === undefined ? "" : `<span class="stat-sub">${note}</span>`}</a>`;

const n = (title, category = "economy", extra = {}) => ({ title, link: `https://e.com/${title}`, source: "S", category, ...extra });
// 검증 폴백 분야의 한 줄(#745 PR6, 옛 상자 끝 안내 줄 #350 을 대신한다). 글은 손으로 적는다 - scripts/summary-note.ts 의 상수와 같은지는
// test/summary-note.test.mjs 가 틀의 문자열 표와 대조한다.
const failed = (reason) => `요약 검증 실패: 제목만 표시(${reason})`;
const newsLink = (n) => `<a href="./news.html" id="news-link" data-n="${n}">오늘 뉴스 ${n}건·AI 요약 →</a>`;

const ROWS = [
  // ================= marketHtml (메인 돈의 값 한 줄, #575 PR2) =================
  { id: "M1", fn: "marketHtml", cond: "market이 null → null", args: [null], expect: null },
  { id: "M2", fn: "marketHtml", cond: "market이 undefined → null", args: [undefined], expect: null },
  { id: "M3", fn: "marketHtml", cond: "빈 객체 → null", args: [{}], expect: null },
  { id: "M4", fn: "marketHtml", cond: "코스피만 있다 → 한 줄에 코스피가 없어 null", args: [{ kospi: { value: "6,977.94", change: "164.60" } }], expect: null },
  { id: "M5", fn: "marketHtml", cond: "환율만 → 천 단위 쉼표·소수 둘째 자리, 끝에 원(증감은 싣지 않는다)", args: [{ usdKrw: { value: 1380.5, change: "+2.30" } }], expect: usd("1,380.50") },
  { id: "M7", fn: "marketHtml", cond: "환율 값이 숫자가 아니면(문자열·null·undefined) 환율은 빠진다 → null", args: [{ usdKrw: { value: "1380.5" } }, { usdKrw: { value: null } }, { usdKrw: {} }], expect: null, each: [null, null, null] },
  { id: "M8", fn: "marketHtml", cond: "환율 0은 숫자다(0.00원)·소수 셋째 자리는 반올림·큰 수도 쉼표", args: [{ usdKrw: { value: 0 } }, { usdKrw: { value: 1380.456 } }, { usdKrw: { value: 1234567.891 } }], expect: null, each: [usd("0.00"), usd("1,380.46"), usd("1,234,567.89")] },
  { id: "M8c", fn: "marketHtml", cond: "환율 값이 NaN이어도 typeof는 number라 남는다(NaN원)", args: [{ usdKrw: { value: NaN } }], expect: usd("NaN") },
  { id: "M9", fn: "marketHtml", cond: "기준금리만 → 값 N%(시행일은 싣지 않는다)", args: [{ baseRate: { value: "2.75", effectiveFrom: "2026-08-28" } }], expect: base("2.75") },
  { id: "M11", fn: "marketHtml", cond: "기준금리 값이 falsy(\"\"·0·null·undefined)면 빠진다 → null", args: [{ baseRate: { value: "", effectiveFrom: "x" } }, { baseRate: { value: 0 } }, { baseRate: { value: null } }, { baseRate: {} }], expect: null, each: [null, null, null, null] },
  { id: "M12", fn: "marketHtml", cond: "기준금리 값이 숫자 2.75·문자열 \"0\"(truthy)이면 남는다", args: [{ baseRate: { value: 2.75 } }, { baseRate: { value: "0" } }], expect: null, each: [base("2.75"), base("0")] },
  { id: "M13", fn: "marketHtml", cond: "둘 다 있으면 기준금리 → 환율 순, 사이는 ' · '(코스피는 무시)", args: [{ kospi: { value: "1" }, usdKrw: { value: 1380.5 }, baseRate: { value: "2.75" } }], expect: `${base("2.75")} · ${usd("1,380.50")}` },
  { id: "M14", fn: "marketHtml", cond: "환율 값 비숫자 + 기준금리 → 기준금리만", args: [{ usdKrw: { value: null }, baseRate: { value: "2.75" } }], expect: base("2.75") },
  { id: "M17", fn: "marketHtml", cond: "환율 기준일(ECOS, 코스피와 같은 M/D 모양)이 있으면 값 뒤에 '(10/23 기준)'(#639 PR-2)", args: [{ usdKrw: { value: 1324.7, asOf: "10/23" } }, { usdKrw: { value: 1324.7, asOf: "1/5" } }], expect: null, each: [usd("1,324.70") + "(10/23 기준)", usd("1,324.70") + "(1/5 기준)"] },
  { id: "M18", fn: "marketHtml", cond: "기준일이 없거나 M/D 모양이 아니면(옛 수집기의 RFC 날짜 글·\"\"·null·객체·숫자) 괄호를 생략한다", args: [{ usdKrw: { value: 1324.7 } }, { usdKrw: { value: 1324.7, asOf: "Fri, 23 Oct 2026 00:02:31 +0000" } }, { usdKrw: { value: 1324.7, asOf: "" } }, { usdKrw: { value: 1324.7, asOf: null } }, { usdKrw: { value: 1324.7, asOf: {} } }, { usdKrw: { value: 1324.7, asOf: 1023 } }], expect: null, each: [usd("1,324.70"), usd("1,324.70"), usd("1,324.70"), usd("1,324.70"), usd("1,324.70"), usd("1,324.70")] },
  { id: "M19", fn: "marketHtml", cond: "기준금리와 기준일 있는 환율 → 기준금리 · 환율(기준일), 환율이 null 이면 기준금리만", args: [{ usdKrw: { value: 1324.7, asOf: "10/23" }, baseRate: { value: "3.00" } }, { usdKrw: null, baseRate: { value: "3.00" } }], expect: null, each: [`${base("3.00")} · ${usd("1,324.70")}(10/23 기준)`, base("3.00")] },
  { id: "M15", fn: "marketHtml", cond: `특수문자: 기준금리 값 & < > " ' 은 엔티티`, args: [{ baseRate: { value: SP } }], expect: base(SP_OUT) },
  { id: "M16", fn: "marketHtml", cond: "비문자열: 기준금리 값 true·{}·[1,2]", args: [{ baseRate: { value: true } }, { baseRate: { value: {} } }, { baseRate: { value: [1, 2] } }], expect: null, each: [base("true"), base("[object Object]"), base("1,2")] },

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

  // ================= newsHtml (메인 뉴스 자리: 뉴스 화면으로 가는 한 줄, #575 PR2) =================
  { id: "N1a", fn: "newsHtml", cond: "news가 null → null", args: [null], expect: null },
  { id: "N1b", fn: "newsHtml", cond: "빈 객체·items 없음 → null", args: [{}], expect: null },
  { id: "N1c", fn: "newsHtml", cond: "items가 빈 배열 → null", args: [{ items: [] }], expect: null },
  { id: "N1d", fn: "newsHtml", cond: "news가 undefined → null", args: [undefined], expect: null },
  { id: "N1e", fn: "newsHtml", cond: "items가 배열이 아니면(문자열·객체) → null", args: [{ items: "abc" }, { items: { length: 3 } }], expect: null, each: [null, null] },
  { id: "N2", fn: "newsHtml", cond: "기사 하나 → 건수 1, 기사 글자는 싣지 않는다", args: [{ items: [{ title: SP, link: "https://e.com/1", source: "S" }] }], expect: newsLink(1) },
  { id: "N3", fn: "newsHtml", cond: "기사 스물넷 → data-n 과 글자에 같은 건수", args: [{ items: Array.from({ length: 24 }, (_, i) => n(`t${i}`)) }], expect: newsLink(24) },

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
  { id: "Y14", fn: "newsSummaryHtml", cond: "fallbackReason가 있는 분야는 헤드라인 목록(lineKo) 대신 「요약 검증 실패: 제목만 표시(이유)」(#745 PR6), 아는 이유 셋은 우리말", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "2", fallbackReason: "unverified-entity" }, { key: "c", name: "C", lineKo: "3", fallbackReason: "unverified-number" }, { key: "d", name: "D", lineKo: "4", fallbackReason: "generation-failed" }] }], expect: p("A", "1") + p("B", failed("원문에 없는 이름")) + p("C", failed("원문에 없는 숫자")) + p("D", failed("생성 실패")) },
  { id: "Y15", fn: "newsSummaryHtml", cond: "분야 필터가 있으면 그 분야만(다른 분야의 폴백 줄은 나오지 않는다)", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "2", fallbackReason: "x" }] }, "a"], expect: p("A", "1") },
  { id: "Y16", fn: "newsSummaryHtml", cond: "분야 필터가 폴백 분야를 가리키면 실패 줄 하나, 모르는 이유 코드는 그대로 괄호에", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "2", fallbackReason: "x" }] }, "b"], expect: p("B", failed("x")) },
  { id: "Y17", fn: "newsSummaryHtml", cond: "한 줄이 빈 분야는 fallbackReason가 있어도 보이지 않는다(화면의 shown은 한 줄 있는 것만)", args: [{ categories: [{ key: "a", name: "A", lineKo: "1" }, { key: "b", name: "B", lineKo: "", fallbackReason: "x" }] }], expect: p("A", "1") },
  { id: "Y18", fn: "newsSummaryHtml", cond: "fallbackReason가 null·\"\"·0·false·없음(falsy)이면 한 줄(lineKo) 그대로", args: [{ categories: [{ key: "a", name: "A", lineKo: "1", fallbackReason: null }, { key: "b", name: "B", lineKo: "2", fallbackReason: "" }, { key: "c", name: "C", lineKo: "3", fallbackReason: 0 }, { key: "d", name: "D", lineKo: "4", fallbackReason: false }, { key: "e", name: "E", lineKo: "5" }] }], expect: p("A", "1") + p("B", "2") + p("C", "3") + p("D", "4") + p("E", "5") },

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
  { id: "K8", fn: "newsKospiHtml", cond: "환율(ECOS, 기준일 M/D)이 있으면 코스피 카드 옆에 환율 카드 - 라벨 '원/달러 환율 {기준일} 매매기준율', 보조 '전 영업일 대비 {증감}', 영어는 m-en(#639 PR-2)", args: [{ kospi: { value: "5,001.01", asOf: "10/21", change: "182.92" }, usdKrw: { value: 1324.7, asOf: "10/23", change: "-1.20" } }], expect: kospi("코스피 10/21 종가", "5,001.01", "전 거래일 대비 182.92") + fxCard("10/23", "1,324.70", "-1.20") },
  { id: "K9", fn: "newsKospiHtml", cond: "환율 증감이 없으면(\"\"·null·undefined·0) 보조 줄을 내지 않는다", args: [{ usdKrw: { value: 1324.7, asOf: "10/23" } }, { usdKrw: { value: 1324.7, asOf: "10/23", change: null } }, { usdKrw: { value: 1324.7, asOf: "10/23", change: "" } }, { usdKrw: { value: 1324.7, asOf: "10/23", change: 0 } }], expect: null, each: [fxCard("10/23", "1,324.70"), fxCard("10/23", "1,324.70"), fxCard("10/23", "1,324.70"), fxCard("10/23", "1,324.70")] },
  { id: "K10", fn: "newsKospiHtml", cond: "환율 기준일이 없거나 M/D 모양이 아니면(옛 수집기의 값) 환율 카드를 내지 않는다 - 매매기준율이라 부를 수 없다", args: [{ usdKrw: { value: 1324.7 } }, { usdKrw: { value: 1324.7, asOf: "Fri, 23 Oct 2026 00:02:31 +0000" } }, { usdKrw: { value: 1324.7, asOf: "", change: "-1.19" } }, { kospi: { value: "1" }, usdKrw: { value: 1324.7, asOf: "Fri, 23 Oct 2026 00:02:31 +0000" } }], expect: null, each: [null, null, null, kospi("코스피", "1")] },
  { id: "K11", fn: "newsKospiHtml", cond: "환율이 null·값이 숫자가 아님이면 환율 카드는 빠지고 코스피 카드만 남는다", args: [{ kospi: { value: "1" }, usdKrw: null }, { kospi: { value: "1" }, usdKrw: { value: "1324.7", asOf: "10/23" } }, { kospi: { value: "1" }, usdKrw: { value: null, asOf: "10/23" } }], expect: null, each: [kospi("코스피", "1"), kospi("코스피", "1"), kospi("코스피", "1")] },
  { id: "K12", fn: "newsKospiHtml", cond: "코스피 없이 환율만 있어도 환율 카드는 난다", args: [{ usdKrw: { value: 1324.7, asOf: "10/23", change: "0.50" } }], expect: fxCard("10/23", "1,324.70", "0.50") },

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
// (옛 legacy는 값을 그대로 냈다.) 뉴스 링크는 RSS(https)에서 오고 맥락·통계 href는 코드가 정한 상대 경로라 실제 입력에서는 나오지 않는다.
// fixture 표에 넣지 않고 별도 시험이 이 출력이 지금 이대로인지 고정한다.
export const JAVASCRIPT_URL_DIFF = {
  fn: "newsListHtml",
  args: [{ items: [{ title: "t", link: "javascript:alert(1)", source: "s" }] }],
  react: li("t", "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')", "s"),
};
