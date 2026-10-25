// 이번 주 새로 신고된 거래(#703 W1) 화면 문장·절 HTML. 고정 입력만 - 저장소 docs/data 는 읽지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { digestHtml, digestText } from "../scripts/week-digest-view.ts";

const win = (from, to, over = {}) => ({
  from, to, sale: 1011, jeonse: 2142, wolse: 2020, cancelArrived: 24, cancelDated: 18, direct: 93, directShare: 9.4,
  records: 279, judged: 752, districts: ["11350", "11500", "11530"], months: { sale: { "202609": 286, "202610": 701 }, rent: { "202610": 3624 } }, ...over,
});
const digest = (over = {}) => ({
  asOf: "2026-10-25", trackedFrom: "2026-08-18", basis: "unique-arrival-key", comparable: true, gaps: [],
  current: win("2026-10-19", "2026-10-25"), previous: win("2026-10-12", "2026-10-18", { sale: 1010, jeonse: 2142, wolse: 2100 }), ...over,
});
const gapped = digest({ comparable: false, gaps: ["2026-10-11", "2026-10-23"] });
const all = (t) => [t.heading, t.note, t.gap, t.facts, t.districts, t.months, ...t.cards.flatMap((c) => [c.label, c.value, c.sub])].filter(Boolean).join("\n");
const HANGUL = /[ㄱ-ㆎ가-힣]/;

test("공백 없는 두 주: 늘었다·줄었다·같다를 쓰고 공백 문장은 없다 (ko/en)", () => {
  const ko = digestText(digest(), "ko");
  assert.equal(ko.gap, null);
  assert.deepEqual(ko.cards.map((c) => c.sub), ["직전 7일 1,010건보다 늘었다(+1)", "직전 7일 2,142건과 같다", "직전 7일 2,100건보다 줄었다(−80)"]);
  const en = digestText(digest(), "en");
  assert.equal(en.gap, null);
  assert.deepEqual(en.cards.map((c) => c.sub), ["up 1 from 1,010 the 7 days before", "unchanged from 2,142 the 7 days before", "down 80 from 2,100 the 7 days before"]);
});

test("수집 공백: 증감 낱말 0, 빠진 날짜를 평어로 (ko/en, #713 판정 문구)", () => {
  const ko = digestText(gapped, "ko");
  assert.doesNotMatch(all(ko).replace(ko.gap, ""), /늘었|줄었|같다/);
  assert.equal(ko.gap, "10/11·10/23은 수집하지 못한 날이다. 빠진 날의 신고가 다음 날 한꺼번에 잡히므로, 지난 7일과 늘고 준 것은 비교하지 않는다.");
  assert.match(digestText({ ...gapped, gaps: ["2026-10-22"] }, "ko").gap, /^10\/22는 수집하지 못한 날이다/);
  assert.equal(ko.cards[0].sub, "직전 7일 1,010건");
  const en = digestText(gapped, "en");
  assert.doesNotMatch(all(en).replace(en.gap, ""), /\b(up|down|unchanged)\b/);
  assert.equal(en.gap, "We couldn't collect on Oct 11 and Oct 23. Filings missed on a gap day show up in a lump the next day, so we don't compare with the previous 7 days.");
  assert.match(digestText({ ...gapped, gaps: ["2026-10-23"] }, "en").gap, /^We couldn't collect on Oct 23\. /);
  assert.match(digestText({ ...gapped, gaps: ["2026-10-02", "2026-10-03", "2026-10-11"] }, "en").gap, /on Oct 2, Oct 3 and Oct 11\./);
});

test("신고가·해제·직거래·많은 구·계약월 문장, 수집일≠계약일 명시", () => {
  const ko = digestText(digest(), "ko");
  assert.equal(ko.facts, "새로 들어온 매매 중 역대 최고가를 넘은 건 279건(판단할 수 있던 752건 중) · 이 7일에 해제된 18건 · 직거래 9.4%");
  assert.doesNotMatch(ko.facts, /신고가/, "신고(filing)와 신고가(record high)가 겹쳐 읽힌다");
  assert.equal(ko.districts, "매매 새 신고가 많았던 구: 노원구·강서구·구로구");
  assert.equal(ko.months, "신고일은 계약일과 다르다 — 새로 들어온 매매는 대부분 10월 계약이다: 9월 286·10월 701 (전월세 10월 3,624)");
  // 「대부분」은 절반을 넘을 때만 - 고르면 섞였다고 쓴다.
  const even = digest({ current: win("2026-10-19", "2026-10-25", { months: { sale: { "202609": 500, "202610": 500 }, rent: {} } }) });
  assert.match(digestText(even, "ko").months, /여러 달 계약이 섞여 있다: 9월 500·10월 500/);
  assert.match(digestText(even, "en").months, /mix contracts from several months: Sep 500, Oct 500/);
  assert.match(ko.note, /^10\/19~10\/25 수집에 새로 보인 신고\(수집일 기준/);
  const en = digestText(digest(), "en");
  assert.equal(en.facts, "New sales above the previous high: 279 of the 752 we could judge · 18 cancelled in these 7 days · 9.4% direct deals");
  assert.equal(en.months, "Filing date is not contract date — most new sales were signed in Oct: Sep 286, Oct 701 (rentals Oct 3,624)");
  assert.equal(en.districts, "Districts with many new sales filings: Nowon-gu, Gangseo-gu, Guro-gu");
  assert.match(en.note, /Oct 19–Oct 25/);
});

test("영어 문장에 한글 0자, 순위·인과 낱말 0", () => {
  for (const d of [digest(), gapped]) {
    assert.doesNotMatch(all(digestText(d, "en")), HANGUL);
    const ko = all(digestText(d, "ko"));
    assert.doesNotMatch(ko, /1위|순위|때문|탓|영향으로/);
  }
});

test("절 HTML: 두 언어를 다 굽고(m-ko·m-en 짝), 데이터 없으면 빈 문자열", () => {
  const html = digestHtml(gapped);
  assert.equal(html.split('class="m-ko"').length + html.split('class="stat-note m-ko"').length, html.split('class="m-en"').length + html.split('class="stat-note m-en"').length);
  assert.match(html, /<h2 id="week-digest-heading">/);
  assert.match(html, /data-part="gap"/);
  assert.doesNotMatch(digestHtml(digest()), /data-part="gap"/);
  assert.doesNotMatch(html, /<script|style=/);
  assert.equal(digestHtml(null), "");
  assert.equal(digestHtml({}), "");
});

test("틀: news.html 기사 목록 위에 빈 자리표시 절이 있고 prerender 가 week-digest.json 을 꽂는다", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const tpl = await readFile(path.join(root, "docs/news.html"), "utf8");
  const at = tpl.indexOf('<section id="week-digest-section"');
  assert.ok(at > 0 && at < tpl.indexOf('<section id="news-section">'), "절이 기사 목록 위에 없다");
  assert.match(tpl, /<!--prerender:weekDigest--><!--\/prerender:weekDigest-->/);
  const pre = await readFile(path.join(root, "scripts/prerender.ts"), "utf8");
  assert.match(pre, /weekDigest \? \{ weekDigest: digestHtml\(weekDigest\) \} : \{\}/);
});
