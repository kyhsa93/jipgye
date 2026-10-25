// 갈아타기 「같은 집이 다시 팔렸을 때」 절(#170 V8 R1) 시험. 얼린 v0 출력(fixtures/repeat-sales/v0.json)과 그것을 고친 합성 데이터만 쓴다 -
// 오늘 데이터에 기대지 않는다. 판정(#170 6402863306) 2~5번 문구·접힘·값 비움, ko/en, 금지어를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { repeatSalesHtml } from "../scripts/prerender.ts";
import { FORBIDDEN } from "../scripts/repeat-sales.ts";
import { stampSources } from "../scripts/source-lines.ts";

const V0 = JSON.parse(await readFile(new URL("./fixtures/repeat-sales/v0.json", import.meta.url), "utf8"));
const html = (data) => repeatSalesHtml(data);
/** 한 언어의 보이는 글자: 다른 언어 span·a 를 걷고 태그를 지운다. */
const textOf = (h, lang) => {
  const other = lang === "ko" ? "m-en" : "m-ko";
  return h
    .replace(new RegExp(`<(span|a) class="${other}"[^>]*>[^<]*</\\1>`, "g"), "")
    .replace(/<caption[\s\S]*?<\/caption>/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
};
const rowsOf = (h) => [...h.matchAll(/<tr><td>([^<]+)<\/td>([\s\S]*?)<\/tr>/g)].map((m) => [m[1], m[2]]);
const withChecks = (patch) => ({ ...V0, checks: { ...V0.checks, ...patch } });

const INTRO_KO = "2024년 11월~2026년 8월 계약 기준, 같은 집(단지·면적·층)이 300~730일 간격으로 두 번 중개거래된 쌍의 가격 변화 중앙값입니다. 시장 지수가 아니고 연율화하지 않았으며, 다시 팔린 집만 들어옵니다.";
const GAP_KO = "모든 구에서 한국부동산원 지수의 같은 기간 변화보다 큽니다(서울 전체 쌍 +18.3%, 같은 쌍 기간의 부동산원 +11.1%). 원인은 재지 않았습니다 — 다시 팔린 집의 구성, 직거래 제외, 지수 산정 방식 차이가 후보입니다.";

test("이름·첫 줄·격차 문장이 판정 2·3번 그대로다 (ko)", () => {
  const ko = textOf(html(V0), "ko");
  assert.ok(ko.startsWith("같은 집이 다시 팔렸을 때"), ko.slice(0, 40));
  assert.ok(ko.includes(INTRO_KO));
  assert.ok(ko.includes(GAP_KO));
  // 첫 줄은 수치(표)보다 위
  assert.ok(ko.indexOf(INTRO_KO) < ko.indexOf("+19.5%"));
});

test("영어도 같은 내용을 굽는다 (en)", () => {
  const en = textOf(html(V0), "en");
  assert.ok(en.startsWith("When the same home sold again"));
  assert.ok(en.includes("Contracts Nov 2024–Aug 2026: the median price change across pairs in which the same home (complex, area, floor) sold twice through a broker, 300–730 days apart."));
  assert.ok(en.includes("It is not a market index, it is not annualised, and only homes that sold again are included."));
  assert.ok(en.includes("In every district it is larger than the Korea Real Estate Board index change over the same periods (all Seoul pairs +18.3%; the Board over the same pair periods +11.1%). The cause has not been measured"));
  assert.ok(!/[가-힣]/.test(en.replace(/[가-힣]+구/g, "")), "자치구 이름 밖에 한국어가 남지 않는다");
});

test("표: 구 코드순 25줄, 종로·중구는 쌍 수만 두고 값을 비운다", () => {
  const rows = rowsOf(html(V0));
  assert.equal(rows.length, 25);
  assert.deepEqual([rows[0][0], rows[1][0], rows[2][0], rows[24][0]], ["종로구", "중구", "용산구", "강동구"]);
  for (const [i, n] of [[0, 53], [1, 88]]) {
    const cells = rows[i][1];
    assert.ok(cells.startsWith(`<td>${n}</td>`), cells);
    assert.ok(cells.includes(`쌍이 모자람(${n}쌍)`) && cells.includes(`too few pairs (${n})`));
    assert.ok(!/%/.test(cells), "비운 줄에 값이 없다");
  }
  assert.equal(rows[2][1], "<td>119</td><td>+19.5%</td><td>+15.2% ~ +23.3%</td><td>378</td><td>+13.6%</td>");
  assert.equal(rows[24][1], "<td>315</td><td>+24.5%</td><td>+23.8% ~ +26.0%</td><td>359</td><td>+13.8%</td>");
});

test("흔들림 구는 값을 비우고 사유를 적는다", () => {
  const data = { ...V0, rows: V0.rows.map((r) => (r.gu === "11170" ? { gu: r.gu, n: r.n, st: "shaky" } : r)) };
  const row = rowsOf(html(data))[2][1];
  assert.ok(row.includes("흔들림이 커 비움") && !row.includes("%"));
});

test("접힘: 킬 스위치가 발동하면 표 없이 한 줄", () => {
  const h = html(withChecks({ kill: true }));
  assert.ok(!h.includes("<table"));
  assert.equal((h.match(/<p /g) ?? []).length, 1);
  assert.ok(textOf(h, "ko").includes("사전에 정한 점검(한국부동산원 조사와의 최소 정합)을 넘지 못해 값을 싣지 않습니다"));
  assert.ok(textOf(h, "en").includes("failed the pre-set check"));
  assert.ok(!h.includes("+18.3%"), "접히면 격차 숫자도 없다");
});

test("접힘: 값을 낼 수 있는 구가 13곳 미만이면 표 없이 한 줄(곳 수를 적는다)", () => {
  const h = html(withChecks({ enough: false, published: 12 }));
  assert.ok(!h.includes("<table"));
  assert.ok(textOf(h, "ko").includes("값을 낼 수 있는 구가 12곳이라 사전에 정한 13곳에 못 미쳐"));
  assert.ok(textOf(h, "en").includes("only 12 districts"));
});

test("E: 간격 상관이 걸리면 구끼리 견주지 말라는 줄을 더한다", () => {
  assert.ok(!textOf(html(V0), "ko").includes("구끼리 견주지 않습니다"));
  assert.ok(textOf(html(withChecks({ dropCompare: true })), "ko").includes("구끼리 견주지 않습니다"));
});

test("격차 문장: 모든 구가 아니면 구 수로 적는다", () => {
  const ko = textOf(html({ ...V0, higher: 24 }), "ko");
  assert.ok(ko.includes("25개 구 가운데 24개 구에서 한국부동산원 지수의 같은 기간 변화보다 큽니다"));
  assert.ok(!ko.includes("모든 구에서"));
});

test("금지어·피할 말: 5-1 ⑦ 0건, 편향·bias 없음, 연율·시장 지수는 '아니다'로만", () => {
  for (const data of [V0, withChecks({ kill: true }), withChecks({ enough: false, published: 3 }), withChecks({ dropCompare: true })]) {
    const h = stampSources(html(data));
    const ko = textOf(h, "ko");
    const en = textOf(h, "en");
    for (const w of [...FORBIDDEN, "편향", "더 올랐", "상승률", "연평균"]) assert.ok(!ko.includes(w), w);
    for (const w of ["bias", "forecast", "outlook", "rose more", "annual rate"]) assert.ok(!en.toLowerCase().includes(w), w);
    assert.equal(ko.replaceAll("연율화하지 않았", "").includes("연율"), false);
    assert.equal(en.replaceAll("not annualised", "").includes("annualis"), false);
    // '지수'는 시장 지수가 아니라는 말과 부동산원 지수를 가리킬 때만
    assert.equal(ko.replace(/시장 지수가 아니고|한국부동산원 지수의|지수 산정 방식/g, "").includes("지수"), false);
    assert.equal(en.replace(/not a market index|Board index change|the index is built/g, "").toLowerCase().includes("index"), false);
    assert.equal(ko.replaceAll("순위가 아닙니다", "").includes("순위"), false);
  }
});

test("출처 줄은 자리표시로 굽고 source-lines.ts 가 국토부·R-ONE 을 꽂는다", () => {
  const h = html(V0);
  assert.ok(h.includes("{{src:repeatSales.ko}}") && h.includes("{{src:repeatSales.en}}"));
  const out = stampSources(h);
  assert.ok(textOf(out, "ko").includes("출처: 국토교통부 아파트 매매 실거래가 공개시스템(중개거래, 해제·직거래 제외), 한국부동산원 주택가격동향조사(R-ONE)."));
  assert.ok(textOf(out, "en").includes("Source: MOLIT apartment sale filings"));
  assert.ok(textOf(out, "en").includes("Korea Real Estate Board price survey (R-ONE)"));
});

test("데이터가 없으면 조각이 비어 틀의 빈 자리가 남는다", () => {
  assert.equal(html(null), null);
  assert.equal(html({}), null);
});

test("틀: 「다른 자와 견주면」 안의 자리표시 하나, 인라인 스크립트는 이 절을 모른다", async () => {
  const tpl = await readFile(new URL("../docs/switch-house.html", import.meta.url), "utf8");
  const check = tpl.slice(tpl.indexOf('id="check-section"'), tpl.indexOf("</section>", tpl.indexOf('id="check-section"')));
  assert.ok(check.includes('<div class="repeat-sales" id="repeat-sales"><!--prerender:repeatSales--><!--/prerender:repeatSales--></div>'));
  const script = tpl.slice(tpl.lastIndexOf("<script>"));
  assert.ok(!/repeat-sales|repeatSales/.test(script), "인라인 스크립트에 이 절의 글자가 없다(S6 여유 0)");
});

test("method.html: 두 언어 문단과 연구 기록 링크", async () => {
  const m = await readFile(new URL("../docs/method.html", import.meta.url), "utf8");
  for (const id of ["repeat-sales", "repeat-sales-en"]) {
    const at = m.indexOf(`<p id="${id}">`);
    assert.ok(at > 0, id);
    const p = m.slice(at, m.indexOf("</p>", at));
    assert.ok(p.includes("research/repeat-sales-2026-10/README.md"), id);
    for (const w of [...FORBIDDEN, "편향"]) assert.ok(!p.includes(w), `${id} ${w}`);
  }
});
