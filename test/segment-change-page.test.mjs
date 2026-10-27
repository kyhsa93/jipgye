// 갈아타기 「가격대·연식별 1년 변화」 표(N4 화면, #676 착수 판정 6403175619 · #685 판정 6403493330) 시험.
// 오늘 데이터에 기대지 않는다 - 얼린 segment-change.json(fixtures/segment-change/n4.json, #685 병합 때 산출)과 그것을 고친 합성 데이터만 쓴다.
// 값·구간·칸 수가 json 그대로인지, 「구별된다」는 pairs 가 true 인 쌍에만 쓰는지, 평균 회귀 한계가 모든 분기에 있는지, ko/en 금지어를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { segmentChangeHtml } from "../scripts/prerender.ts";
import { FORBIDDEN } from "../scripts/repeat-sales.ts";
import { SEGMENT_FORBIDDEN } from "../scripts/segment-change-view.ts";

const N4 = JSON.parse(await readFile(new URL("./fixtures/segment-change/n4.json", import.meta.url), "utf8"));
const html = (data) => segmentChangeHtml(data);
// #720(PR1) 병합 때 산출한 area 배열(면적대 4구간, MIN_CELLS 30). 얼린 N4 에 붙인다 - price·age 는 그대로.
const AREA = [
  { key: "upTo60", ko: "60㎡ 이하", en: "up to 60㎡", cells: 1531, change: 21.5, low: 20.6, high: 22.4 },
  { key: "a60to85", ko: "60~85㎡", en: "60–85㎡", cells: 1650, change: 17.7, low: 17.1, high: 18.2 },
  { key: "a85to135", ko: "85~135㎡", en: "85–135㎡", cells: 531, change: 13, low: 12.2, high: 14.3 },
  { key: "over135", ko: "135㎡ 초과", en: "over 135㎡", cells: 81, change: 6.5, low: 4.2, high: 9.6 },
];
const WITH_AREA = { ...N4, area: AREA };
const textOf = (h, lang) => {
  const other = lang === "ko" ? "m-en" : "m-ko";
  return h
    .replace(new RegExp(`<span class="${other}">[^<]*</span>`, "g"), "")
    .replace(/<caption[\s\S]*?<\/caption>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,)])/g, "$1");
};
const rowsOf = (h) => [...h.matchAll(/<tr><td><span class="m-ko">([^<]+)<\/span><span class="m-en">[^<]+<\/span><\/td>([\s\S]*?)<\/tr>/g)].map((m) => [m[1], m[2]]);
const pct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

const CAVEAT_KO = "칸을 기준 시기 중간값으로 가격대에 넣어, 기준값이 우연히 높거나 낮았던 칸이 양 끝 가격대에 모입니다(평균 회귀). 그래서 양 끝 가격대의 변화는 그만큼 어긋날 수 있고, 이를 보정하지 않았습니다.";
const CAVEAT_EN = "Units are banded by their base-period median, so units whose base value was by chance high or low gather in the end bands (regression to the mean). Changes in the end bands can be off for that reason; this is not corrected.";

test("표: 가격대 5줄·연식 3줄, 변화·90% 구간·칸 수가 segment-change.json 그대로다", () => {
  const rows = rowsOf(html(N4));
  const want = [...N4.price, ...N4.age];
  assert.equal(rows.length, 8);
  rows.forEach(([name, cells], i) => {
    const r = want[i];
    assert.equal(name, r.ko);
    assert.equal(cells, `<td>${pct(r.change)}</td><td>${pct(r.low)} ~ ${pct(r.high)}</td><td>${r.cells.toLocaleString("en-US")}</td>`, r.key);
  });
  // 칸 수 합 = 전체 칸(연식은 준공 연도 없는 칸만 빠진다 - 이 산출은 0)
  assert.equal(N4.price.reduce((a, r) => a + r.cells, 0), N4.cells);
  assert.equal(N4.age.reduce((a, r) => a + r.cells, 0) + N4.noBuildYear, N4.cells);
  const h = html(N4);
  assert.match(h, /<th scope="rowgroup" colSpan="4"><span class="m-ko">가격대\(기준 시기 중간값\)<\/span>/i);
  assert.match(h, /<th scope="rowgroup" colSpan="4"><span class="m-ko">연식\(2025년 기준\)<\/span>/i);
});

test("첫 줄: 두 시기·칸 수·가격대 기준(기준 시기 중간값)·연식 기준 해 (ko/en)", () => {
  const h = html(N4);
  assert.ok(textOf(h, "ko").includes("같은 칸(구·단지·전용면적)이 2025년 6~8월과 2026년 6~8월에 모두 거래된 3,793칸을 기준 시기 중간값의 가격대와 2025년 기준 연식으로 나눠, 칸마다 잰 변화의 중간값입니다."));
  assert.ok(textOf(h, "en").includes("traded in both Jun–Aug 2025 and Jun–Aug 2026, 3,793 in all, grouped by the price band of their base-period median and by building age as of 2025"));
});

test("「구별된다」는 pairs 가 true 인 쌍에만: 가격대 9/10(6억~9억과 15억~25억은 아님), 연식은 10년 미만과 30년 이상만", () => {
  const ko = textOf(html(N4), "ko");
  const en = textOf(html(N4), "en");
  assert.ok(ko.includes("90% 구간이 겹치지 않을 때만 구별된다고 적습니다. 가격대: 10쌍 가운데 9쌍이 구별되고, 6억~9억과 15억~25억은 구별되지 않습니다. 연식: 10년 미만과 30년 이상만 구별됩니다."), ko);
  assert.ok(en.includes("Price bands: 9 of 10 pairs can be told apart; ₩600–900M and ₩1.5–2.5B cannot. Building age: only under 10 years and 30 years or more can be told apart."), en);
  // 전제: 위 문장은 json pairs 그대로
  assert.equal(N4.pairs.price["upTo9-upTo25"], false);
  assert.equal(Object.values(N4.pairs.price).filter(Boolean).length, 9);
  assert.deepEqual(N4.pairs.age, { "under10-y10to29": false, "under10-over30": true, "y10to29-over30": false });
});

test("「구별된다」 문장의 분기: 모두·없음·적은 쪽만 나열, 값이 빈 줄은 쌍에서 빠진다, 조사(와/과·은/는)", () => {
  const allTrue = { ...N4, pairs: { price: Object.fromEntries(Object.keys(N4.pairs.price).map((k) => [k, true])), age: { ...N4.pairs.age, "under10-y10to29": false, "under10-over30": false, "y10to29-over30": false } } };
  const ko = textOf(html(allTrue), "ko");
  assert.ok(ko.includes("가격대: 10쌍 모두 구별됩니다.") && ko.includes("연식: 구별되는 쌍이 없습니다."), ko);
  assert.ok(textOf(html(allTrue), "en").includes("Building age: no pair can be told apart."));
  // 6억 이하(받침 없음) → 「와」
  const one = { ...N4, pairs: { ...N4.pairs, price: Object.fromEntries(Object.keys(N4.pairs.price).map((k) => [k, k === "upTo6-over25"])) } };
  assert.ok(textOf(html(one), "ko").includes("가격대: 6억 이하와 25억 초과만 구별됩니다."));
  // 25억 초과 값이 비면(칸 모자람) 그 줄은 비우고 쌍은 4줄 사이 6쌍만 센다
  const thin = { ...N4, price: N4.price.map((r) => (r.key === "over25" ? { ...r, cells: 20, change: null, low: null, high: null } : r)) };
  const h = html(thin);
  assert.ok(textOf(h, "ko").includes("가격대: 6쌍 가운데 5쌍이 구별되고, 6억~9억과 15억~25억은 구별되지 않습니다."), textOf(h, "ko"));
  const row = rowsOf(h).find(([n]) => n === "25억 초과")[1];
  assert.ok(row.includes("칸이 모자람(20칸)") && row.includes("too few units (20)") && !row.includes("%"));
});

test("평균 회귀 한계(#685 판정)가 표 바로 아래에 있다 - 모든 분기, ko/en", () => {
  const variants = [N4, { ...N4, pairs: {} }, { ...N4, noBuildYear: 12 }];
  for (const data of variants) {
    const h = html(data);
    assert.ok(textOf(h, "ko").includes(CAVEAT_KO));
    assert.ok(textOf(h, "en").includes(CAVEAT_EN));
    assert.ok(h.indexOf("</table>") < h.indexOf("평균 회귀"), "표 다음");
    assert.ok(h.indexOf("평균 회귀") - h.indexOf("</table>") < 120, "표 바로 아래 문단의 첫 문장");
  }
  assert.ok(textOf(html({ ...N4, noBuildYear: 12 }), "ko").includes("준공 연도가 없는 12칸은 연식에서만 뺐습니다."));
  assert.ok(!textOf(html(N4), "ko").includes("준공 연도가 없는"));
});

test("금지어: 오를·내릴·전망(N4 판정 ⑤)과 순위·지수·「더 움직였다」·싼/비싼 0건, 영어도", () => {
  for (const data of [N4, { ...N4, pairs: {} }]) {
    const h = html(data);
    const ko = textOf(h, "ko");
    const en = textOf(h, "en").toLowerCase();
    for (const w of [...SEGMENT_FORBIDDEN, ...FORBIDDEN, "순위", "지수", "더 움직", "더 올랐", "싼", "상승률"]) assert.ok(!ko.includes(w), w);
    for (const w of ["forecast", "outlook", "index", "rank", "cheap", "expensive", "rose more", "outperform"]) assert.ok(!en.includes(w), w);
    assert.ok(!/[가-힣]/.test(en), "영어 화면에 한국어가 남지 않는다");
  }
});

test("데이터가 없거나 모양이 다르면 조각이 비어 틀의 빈 자리가 남는다", () => {
  assert.equal(html(null), null);
  assert.equal(html({}), null);
  assert.equal(html({ price: [], age: [] }), null);
});

test("틀: 「25개 구」 표 아래 자리표시 하나, 인라인 스크립트는 이 표를 모른다(0 B)", async () => {
  const tpl = await readFile(new URL("../docs/switch-house.html", import.meta.url), "utf8");
  const sec = tpl.slice(tpl.indexOf('id="table-section"'), tpl.indexOf("</section>", tpl.indexOf('id="table-section"')));
  assert.ok(sec.includes('<div class="content-notice" id="table-note"></div>\n    <div class="segment-change" id="segment-change"><!--prerender:segmentChange--><!--/prerender:segmentChange--></div>'));
  const script = tpl.slice(tpl.lastIndexOf("<script>"));
  assert.ok(!/segment-change|segmentChange/.test(script), "인라인 스크립트에 이 표의 글자가 없다(S6 여유 0)");
});

test("조각 바이트: 4,000 B 이하(두 언어, #697 판정), 면적대 묶음을 더해도 5,000 B 이하(#719 PR2)", () => {
  const n = Buffer.byteLength(html(N4));
  assert.ok(n <= 4000, `${n}B`);
  const m = Buffer.byteLength(html(WITH_AREA));
  assert.ok(m <= 5000, `${m}B`);
});

test("영어 줄 이름은 375px 에 맞춘 짧은 이름, 문장 속 이름은 json 의 en 그대로", () => {
  const h = html(N4);
  for (const s of ["≤₩600M", "&gt;₩2.5B", "&lt;10 yrs", "10–29 yrs", "30+ yrs"]) assert.ok(h.includes(`<span class="m-en">${s}</span>`), s);
  assert.ok(textOf(h, "en").includes("only under 10 years and 30 years or more can be told apart"));
});

// #719 PR2: 면적대 묶음
test("면적대: area 가 있으면 셋째 묶음 4줄, 값·구간·칸 수가 json 그대로, 가격대·연식 줄은 그대로", () => {
  const h = html(WITH_AREA);
  const rows = rowsOf(h);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.slice(0, 8), rowsOf(html(N4)), "가격대·연식 줄 불변");
  rows.slice(8).forEach(([name, cells], i) => {
    const r = AREA[i];
    assert.equal(name, r.ko);
    assert.equal(cells, `<td>${pct(r.change)}</td><td>${pct(r.low)} ~ ${pct(r.high)}</td><td>${r.cells.toLocaleString("en-US")}</td>`, r.key);
  });
  assert.equal(AREA.reduce((a, r) => a + r.cells, 0), N4.cells, "칸 합 = 전체");
  assert.match(h, /<th scope="rowgroup" colSpan="4"><span class="m-ko">전용면적대<\/span><span class="m-en">Exclusive area<\/span>/i);
  assert.equal((h.match(/<tbody>/g) || []).length, 3);
  // 카드화(nav.js toCards)는 머리 칸 4개와 칸 수가 같은 줄에 data-label 을 붙인다 - 면적대 줄도 칸 4개
  for (const m of h.matchAll(/<tr><td>[\s\S]*?<\/tr>/g)) assert.equal((m[0].match(/<td/g) || []).length, 4);
  for (const s of ["≤60㎡", "60–85㎡", "85–135㎡", "&gt;135㎡"]) assert.ok(h.includes(`<span class="m-en">${s}</span>`), s);
});

test("면적대: 제목·첫 줄에 면적대, 겹침 한 줄(ko/en), 인과 문장 0, pairs.area 없으면 면적 「구별된다」 문장 없음", () => {
  const h = html(WITH_AREA);
  const ko = textOf(h, "ko");
  const en = textOf(h, "en");
  assert.ok(ko.trim().startsWith("가격대·연식·면적대별 1년 변화"));
  assert.ok(ko.includes("기준 시기 중간값의 가격대, 2025년 기준 연식, 전용면적대로 나눠, 칸마다 잰 변화의 중간값입니다."), ko);
  assert.ok(en.includes("grouped by the price band of their base-period median, by building age as of 2025 and by exclusive area: the median"), en);
  assert.ok(ko.includes("넓은 칸일수록 가격대도 높아 면적대와 가격대는 겹칩니다."));
  assert.ok(en.includes("Larger units tend to sit in higher price bands, so area and price bands overlap."));
  for (const w of ["원인", "때문", "덕분", "작을수록", "넓을수록"]) assert.ok(!ko.includes(w), w);
  for (const w of ["because", "cause", "due to"]) assert.ok(!en.toLowerCase().includes(w), w);
  assert.ok(!ko.includes("면적대:") && !en.includes("Area:"));
  assert.ok(!ko.includes("면적이 없는"), "칸 합 = 전체면 뺀 칸 문장 없음");
  for (const w of [...SEGMENT_FORBIDDEN, ...FORBIDDEN, "순위", "더 올랐"]) assert.ok(!ko.includes(w), w);
  assert.ok(!/[가-힣]/.test(en));
});

test("면적대: pairs.area 가 있으면 문장, 칸 모자란 줄은 「칸이 모자람」, 면적 없는 칸 수 문장", () => {
  const pairsArea = { "upTo60-a60to85": true, "upTo60-a85to135": true, "upTo60-over135": true, "a60to85-a85to135": true, "a60to85-over135": true, "a85to135-over135": true };
  assert.ok(textOf(html({ ...WITH_AREA, pairs: { ...N4.pairs, area: pairsArea } }), "ko").includes("면적대: 6쌍 모두 구별됩니다."));
  const thin = { ...WITH_AREA, area: AREA.map((r) => (r.key === "over135" ? { ...r, cells: 20, change: null, low: null, high: null } : r)) };
  const h = html(thin);
  const row = rowsOf(h).find(([n]) => n === "135㎡ 초과")[1];
  assert.ok(row.includes("칸이 모자람(20칸)") && !row.includes("%"));
  assert.ok(textOf(h, "ko").includes("면적이 없는 61칸은 면적대에서만 뺐습니다."));
  assert.ok(textOf(h, "en").includes("61 units without an area are left out of the area rows only."));
  // area 가 비거나 없으면 예전 표 그대로
  assert.equal(html({ ...N4, area: [] }), html(N4));
});
