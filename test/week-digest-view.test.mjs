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

test("수집 공백: 증감 낱말 0, 「수집 공백 n일」과 날짜 (ko/en)", () => {
  const ko = digestText(gapped, "ko");
  assert.doesNotMatch(all(ko).replace(ko.gap, ""), /늘었|줄었|같다/);
  assert.equal(ko.gap, "수집 공백 2일(10/11·10/23) — 공백 다음 날 신고가 몰려 늘었다·줄었다를 말하지 않는다.");
  assert.equal(ko.cards[0].sub, "직전 7일 1,010건");
  const en = digestText(gapped, "en");
  assert.doesNotMatch(all(en).replace(en.gap, ""), /\b(up|down|unchanged)\b/);
  assert.match(en.gap, /^Collection gap: 2 days \(Oct 11, Oct 23\)/);
  assert.match(digestText({ ...gapped, gaps: ["2026-10-23"] }, "en").gap, /1 day \(Oct 23\)/);
});

test("신고가·해제·직거래·많은 구·계약월 문장, 수집일≠계약일 명시", () => {
  const ko = digestText(digest(), "ko");
  assert.equal(ko.facts, "매매 새 신고 중 신고가 279건(같은 단지·면적 이전 최고가 초과, 판정 가능 752건 중) · 해제일이 이 7일인 해제 18건 · 직거래 9.4%");
  assert.equal(ko.districts, "매매 새 신고가 많았던 구: 노원구·강서구·구로구");
  assert.equal(ko.months, "신고일은 계약일과 다르다 — 새 신고의 계약월: 매매 10월 701·9월 286 / 전월세 10월 3,624");
  assert.match(ko.note, /^10\/19~10\/25 수집에 새로 보인 신고\(수집일 기준/);
  const en = digestText(digest(), "en");
  assert.match(en.facts, /^Of new sales: 279 record highs .* of 752 that can be judged\) · 18 cancellations dated in these 7 days · 9\.4% direct deals$/);
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
