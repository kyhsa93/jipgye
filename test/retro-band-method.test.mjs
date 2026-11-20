import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HORIZONS, loadLib, MIN_N, UNITS, validateOutput } from "../research/retro-band-2026-11/retro.mjs";

// 소급 계산 결과와 method 소급 절(#656 PR2, P1-8·P2-5~P2-8). 커밋된 retro.json 과 손으로 쓰는 틀 docs/method.html 만 읽는다 -
// retro.json 은 입력 커밋을 고정해 한 번 낸 파일이라 매일 데이터에 따라 바뀌지 않는다. outlook.json 의 record.scored 처럼
// 날짜에 따라 바뀌는 값은 여기서 보지 않는다(#8) - PR 본문의 git diff 가 본다.
const ROOT = path.resolve(import.meta.dirname, "..");
const retro = JSON.parse(readFileSync(path.join(ROOT, "research/retro-band-2026-11/retro.json"), "utf8"));
const html = readFileSync(path.join(ROOT, "docs/method.html"), "utf8");
const lib = await loadLib(ROOT);

// 표기 규칙: 비율·구간은 소수 넷째 자리 값을 백분율 둘째 자리로, 건수는 천 단위 쉼표.
const pct = (v) => `${(Math.round(v * 1e4) / 100).toFixed(2)}%`;
const bare = (v) => pct(v).slice(0, -1);
const cnt = (n) => n.toLocaleString("en-US");

const LANG = {
  ko: {
    id: "retro-band",
    table: "retro-band-table",
    noticeId: "retro-band-notice",
    title: "소급 계산: 지난 범위의 적중",
    mark: "소급",
    titleBan: ["성적표", "전망", "예측", "지수", "신뢰도"],
    sectionBan: ["성적표", "전망", "예측", "신뢰도"],
    first: "공칭 50%에 못 미칩니다.",
    notice: /^소급 계산입니다\. 사이트가 그때 낸 값을 얼려 채점한 기록이 아니라, \d{4}-\d{2}-\d{2}에 지금 자료로 되돌아가 다시 낸 범위를 채점한 값입니다\. 늦은 신고·나중 해제·현재 지수가 섞였고, 같은 칸 거래는 서로 닮아 구간이 실제 불확실성보다 좁으며, 값이 오른 국면 한 번만 담았습니다\. 얼려 둔 기록의 채점은 2027-01부터 따로 싣습니다\.$/,
    names: { "seoul|all": "서울 전체", "price|6eok-or-less": "가격대 6억 이하", "price|6-9eok": "가격대 6~9억", "price|9-15eok": "가격대 9~15억", "price|15-25eok": "가격대 15~25억", "price|over-25eok": "가격대 25억 초과", "cellN|3-4": "칸 거래 3~4건", "cellN|5+": "칸 거래 5건 이상" },
    win: (r) => `${r.h}일(달초 ${r.snapshots}회)`,
    ci: (r) => `${bare(r.ciLow)} ~ ${bare(r.ciHigh)}%`,
    counting: (n) => `집계 중(${cnt(n)}건)`,
    ref: (o) => `${pct(o.rate)}(${cnt(o.n)}건)`,
    inputDate: (d) => `입력 기준일 ${d}`,
  },
  en: {
    id: "retro-band-en",
    table: "retro-band-table-en",
    noticeId: "retro-band-notice-en",
    title: "Retrospective calculation: hit rate of past ranges",
    mark: "Retrospective",
    titleBan: ["scorecard", "forecast", "prediction", "index", "confidence"],
    sectionBan: ["scorecard", "forecast", "prediction", "confidence"],
    first: "It falls short of the nominal 50%.",
    notice: /^This is a retrospective calculation\. It is not a record of values the site published and froze at the time; it scores ranges rebuilt on \d{4}-\d{2}-\d{2} from today's data\. Late filings, later cancellations and the current index are mixed in; deals in the same cell resemble each other, so the intervals are narrower than the real uncertainty; and it covers only one period of rising prices\. Scoring of the frozen record will appear separately from 2027-01\.$/,
    names: { "seoul|all": "Seoul, all", "price|6eok-or-less": "Price band: KRW 0.6 billion or less", "price|6-9eok": "Price band: KRW 0.6&ndash;0.9 billion", "price|9-15eok": "Price band: KRW 0.9&ndash;1.5 billion", "price|15-25eok": "Price band: KRW 1.5&ndash;2.5 billion", "price|over-25eok": "Price band: over KRW 2.5 billion", "cellN|3-4": "Cells with 3&ndash;4 deals", "cellN|5+": "Cells with 5 or more deals" },
    win: (r) => `${r.h} days (${r.snapshots} month-starts)`,
    ci: (r) => `${bare(r.ciLow)} to ${bare(r.ciHigh)}%`,
    counting: (n) => `Still counting (${cnt(n)})`,
    ref: (o) => `${pct(o.rate)} (n = ${cnt(o.n)})`,
    inputDate: (d) => `input as of ${d}`,
  },
};

/** 소제목부터 다음 소제목 앞까지. */
function section(id) {
  const start = html.indexOf(`<h2 id="${id}">`);
  assert.ok(start >= 0, `#${id} 절이 없다`);
  const end = html.indexOf("<h2", start + 1);
  return html.slice(start, end);
}
const textOf = (s) => s.replace(/<[^>]+>/g, "").trim();
const tableOf = (sec, id) => {
  const m = sec.match(new RegExp(`<table[^>]*id="${id}"[^>]*>[\\s\\S]*?</table>`));
  assert.ok(m, `#${id} 표가 없다`);
  return m[0];
};
const bodyRows = (table) => [...table.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]));

/** 표 한 줄의 기대 칸(행 이름, 창, n, 적중률, 95% 구간, 위, 아래, 참고 둘). n<최소 n 줄은 적중률 자리에 「집계 중(n건)」. */
function expectedCells(L, r) {
  const head = [L.names[`${r.unit}|${r.segment}`], L.win(r), cnt(r.n)];
  const main = r.rate === null ? [L.counting(r.n), "&mdash;", "&mdash;", "&mdash;"] : [pct(r.rate), L.ci(r), pct(r.aboveRate), pct(r.belowRate)];
  const ref = [r.reference.indexOff, r.reference.dropLast30].map((o) => (o.rate === null ? L.counting(o.n) : L.ref(o)));
  return [...head, ...main, ...ref];
}

// --- retro.json ---

test("P1-8 키 허용 목록·구 이름·구 코드·칸 해시 검사가 실제 retro.json 에도 통과한다", () => {
  validateOutput(retro, lib.DISTRICTS);
  assert.equal(retro.label, "소급");
});

test("P2-5 retro.json 은 공개 단위 × h = 24줄이고 S 수는 11/10/9, n<100 이면 적중률이 null 이다", () => {
  assert.equal(retro.rows.length, 24);
  assert.equal(UNITS.length * HORIZONS.length, 24);
  const counts = { 30: 11, 60: 10, 90: 9 };
  assert.deepEqual(retro.snapshots.horizons.map((x) => [x.h, x.count]), Object.entries(counts).map(([h, c]) => [Number(h), c]));
  for (const r of retro.rows) {
    const where = `${r.unit}/${r.segment}/${r.h}`;
    assert.equal(r.snapshots, counts[r.h], where);
    for (const k of ["n", "hits", "above", "below"]) assert.ok(Number.isInteger(r[k]), `${where} ${k}`);
    assert.equal(r.hits + r.above + r.below, r.n, where);
    if (r.n < MIN_N) {
      assert.equal(r.rate, null, where);
    } else {
      for (const k of ["rate", "ciLow", "ciHigh", "aboveRate", "belowRate"]) assert.equal(typeof r[k], "number", `${where} ${k}`);
      assert.ok(r.ciLow <= r.rate && r.rate <= r.ciHigh, where);
    }
  }
});

// --- method 소급 절 ---

for (const [lang, L] of Object.entries(LANG)) {
  const sec = section(L.id);
  const table = tableOf(sec, L.table);

  test(`P2-6 ${lang} 소급 표 24줄의 숫자·표기가 retro.json 과 같다`, () => {
    const rows = bodyRows(table);
    assert.equal(rows.length, retro.rows.length);
    retro.rows.forEach((r, i) => assert.deepEqual(rows[i], expectedCells(L, r), `${r.unit}/${r.segment}/${r.h}`));
  });

  test(`P2-6 ${lang} 절 본문의 백분율(둘째 자리)은 전부 retro.json 에서 나온 값이다`, () => {
    const known = new Set();
    for (const r of retro.rows) {
      for (const k of ["rate", "ciLow", "ciHigh", "aboveRate", "belowRate"]) if (r[k] !== null) known.add(bare(r[k]));
      for (const o of Object.values(r.reference)) if (o.rate !== null) known.add(bare(o.rate));
    }
    for (const x of retro.seoulBySnapshot) for (const e of [x.low, x.high]) if (e) known.add(bare(e.rate));
    const found = [...textOf(sec.replace(table, "")).matchAll(/\d+\.\d{2}(?=%|\s|&)/g)].map((m) => m[0]);
    assert.ok(found.length > 0, "본문에 숫자가 하나도 없다 - 시험이 빈손이다");
    for (const v of found) assert.ok(known.has(v), `retro.json 에 없는 값: ${v}`);
    for (const x of retro.seoulBySnapshot) {
      for (const e of [x.low, x.high]) assert.ok(sec.includes(e.s), `${x.h} ${e.s}`);
    }
  });

  test(`P2-6 ${lang} 제목·캡션·표 머리에 「${L.mark}」, 금지어·금지 수치 0`, () => {
    const h2 = textOf(sec.match(/<h2[^>]*>[\s\S]*?<\/h2>/)[0]);
    assert.equal(h2, L.title);
    const caption = textOf(table.match(/<caption>([\s\S]*?)<\/caption>/)[1]);
    const thead = table.match(/<thead>([\s\S]*?)<\/thead>/)[1];
    const groups = [...thead.matchAll(/<th scope="colgroup"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1]);
    assert.equal(groups.length, 2);
    // en 참고 열 머리는 문장 가운데라 소문자(retrospective)다.
    for (const t of [h2, caption, ...groups]) assert.ok(t.toLowerCase().includes(L.mark.toLowerCase()), t);
    assert.ok(caption.includes(L.inputDate(retro.inputDate)), caption);
    for (const w of L.titleBan) {
      assert.ok(!h2.toLowerCase().includes(w), `제목 금지어 ${w}`);
      assert.ok(!caption.toLowerCase().includes(w), `캡션 금지어 ${w}`);
    }
    const text = textOf(sec).toLowerCase();
    for (const w of L.sectionBan) assert.ok(!text.includes(w), `절 금지어 ${w}`);
    for (const w of ["64.4", "384/596"]) assert.ok(!sec.includes(w), `금지 수치 ${w}`);
    assert.doesNotMatch(sec, /q\s*값|q-value|q value/i);
  });

  test(`P2-6 ${lang} 고지문은 details 밖, 바로 다음 형제가 div.table-scroll 이고 그 첫 표가 소급 표다`, () => {
    const m = sec.match(new RegExp(`<p id="${L.noticeId}">([\\s\\S]*?)</p>\\s*<div class="table-scroll">\\s*<table[^>]*id="([^"]+)"`));
    assert.ok(m, "고지문 바로 뒤에 div.table-scroll > table 이 없다");
    assert.match(m[1], L.notice);
    assert.equal(m[2], L.table);
    const before = html.slice(0, html.indexOf(`<p id="${L.noticeId}">`));
    assert.equal((before.match(/<details[\s>]/g) ?? []).length, (before.match(/<\/details>/g) ?? []).length, "고지문이 <details> 안에 있다");
  });

  test(`P2-6 ${lang} 소급 표에 <strong> 0, 절에 <script> 0`, () => {
    assert.ok(!table.includes("<strong"));
    assert.ok(!sec.includes("<script"));
  });

  test(`P2-7 ${lang} 서울 전체 95% 구간 상한이 50% 밑인 창이 있으면 첫 문장이 「${L.first}」, 접은 줄 0`, () => {
    const short = retro.rows.some((r) => r.unit === "seoul" && r.ciHigh !== null && r.ciHigh < retro.nominal);
    const first = textOf(sec.match(/<p>([\s\S]*?)<\/p>/)[1]);
    if (short) assert.ok(first.startsWith(L.first), first);
    else assert.ok(!sec.includes(L.first));
    assert.equal(bodyRows(table).length, 24);
    assert.ok(!/<details[\s>]/.test(sec), "절 안에 접는 부분이 있다");
  });
}

test("P2-6 장 전체 <script> 수는 소급 절을 넣기 전 main(60c51cbc)과 같은 4개다", () => {
  assert.equal((html.match(/<script[\s>]/g) ?? []).length, 4);
});

test("차례: ko·en 각각 소급 절 항목이 #complex-price 바로 다음이다", () => {
  assert.ok(html.includes('<li><a href="#complex-price">단지 평형별 매매가 범위는 지난 거래를 기준 달 값으로 고쳐 냅니다</a></li>\n          <li><a href="#retro-band">소급 계산: 지난 범위의 적중</a></li>'));
  assert.ok(html.includes('<li><a href="#complex-price-en">Sale ranges by unit type adjust past deals to a reference month</a></li>\n          <li><a href="#retro-band-en">Retrospective calculation: hit rate of past ranges</a></li>'));
});

test("P2-8 소급 값은 소급 절 밖(전망·사전 등록 표 포함)에 0번 나온다", () => {
  const outside = html.replace(section(LANG.ko.id), "").replace(section(LANG.en.id), "");
  for (const r of retro.rows) {
    if (r.rate === null) continue;
    for (const v of [LANG.ko.ci(r), LANG.en.ci(r), pct(r.rate)]) assert.ok(!outside.includes(v), v);
  }
  assert.ok(!outside.includes("retro.json"));
  assert.ok(!/소급 적중률|Retrospective hit rate/.test(outside));
});
