// 재계약 확인기 화면(#652 V3, renewal-vs-new.html 맨 위 #check-section)의 시험.
// 손으로 만든 DOM(vm 샌드박스, test/helpers/digest-page.mjs)에서 렌더된 장의 인라인 스크립트를 돌린다 - 픽스처 칸을 빌더 함수로 만들어 넣는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { buildPayload } from "../scripts/build-renewal-facts.ts";
import { buildFiles } from "../scripts/build-renewal-cells.ts";
import { bandOf, BANDS } from "../scripts/renewal-cells.ts";
import { loadPage } from "./helpers/digest-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-08-26T00:00:00Z");

const lease = (extra = {}) => ({
  sggCd: 11350,
  aptNm: "상계주공",
  excluUseAr: 84.9,
  dealYear: 2026,
  dealMonth: 3,
  monthlyRent: "0",
  preMonthlyRent: "0",
  contractType: "갱신",
  useRRRight: "사용",
  deposit: "90,000",
  preDeposit: "88,000",
  ...extra,
});
const many = (n, extra) => Array.from({ length: n }, () => lease(extra));

// renewal-facts(구 목록·slugs 를 주는 기존 파일)는 기존 시험과 같은 픽스처.
const FACTS = buildPayload({
  byDistrict: { 노원구: [...many(250), ...many(3, { contractType: "신규", deposit: "100,000", preDeposit: "" })] },
  now: NOW,
});

// 노원구 칸: 상계주공 84.9 = 요구권 사용 6건(5.0% 4·4.5% 1·동결 1) + 표시 없음 5건(8% 2·3% 3), 신규 3건(중앙 95,000)
//           작은단지 59.9 = 사용 4건(5.0% 3·2% 1) + 표시 없음 2건.  얇은단지는 2건(cells 에 없음, fallback 에만).
const pre = "100,000";
const RENTS = [
  ...many(4, { preDeposit: pre, deposit: "105,000" }),
  ...many(1, { preDeposit: pre, deposit: "104,500" }),
  ...many(1, { preDeposit: pre, deposit: "100,000" }),
  ...many(2, { preDeposit: pre, deposit: "108,000", useRRRight: "" }),
  ...many(3, { preDeposit: pre, deposit: "103,000", useRRRight: "" }),
  ...many(3, { aptNm: "작은단지", excluUseAr: 59.9, preDeposit: pre, deposit: "105,000" }),
  ...many(1, { aptNm: "작은단지", excluUseAr: 59.9, preDeposit: pre, deposit: "102,000" }),
  ...many(2, { aptNm: "작은단지", excluUseAr: 59.9, preDeposit: pre, deposit: "106,000", useRRRight: "" }),
  ...many(2, { aptNm: "얇은단지", excluUseAr: 84.5, preDeposit: pre, deposit: "106,000", useRRRight: "" }),
];
const NEW = [90000, 95000, 99000].map((d) => lease({ contractType: "신규", deposit: String(d), preDeposit: "", useRRRight: "" }));
const CELLS = buildFiles({ rentsByDistrict: { 11350: RENTS }, newByDistrict: { 11350: NEW }, months: ["202411", "202610"], now: NOW }).nowon;

const open = (query = "", extra = {}) =>
  loadPage({ file: "renewal-vs-new.html", data: { "renewal-facts": FACTS, "renewal-cells-nowon": CELLS }, query, ...extra });

const answer = (page) => page.text("check-answer");
const table = (page) => page.html("check-table");
const setValue = async (page, id, value, type = "input") => {
  const el = page.byId(id);
  el.value = value;
  el.dispatch(type);
  await page.settle();
};

test("픽스처 칸 모양 확인(빌더가 만든 그대로)", () => {
  assert.deepEqual(CELLS.cells["상계주공"]["84.9"], [0, 1, 1, 4, 0, 0, 0, 3, 0, 2, 3, 95000]);
  assert.deepEqual(CELLS.cells["작은단지"]["59.9"], [0, 0, 1, 3, 0, 0, 0, 0, 0, 2, 0, null]);
  assert.equal(CELLS.cells["얇은단지"], undefined);
});

test("자리: 입력·답이 방법 안내보다 먼저, #lead-section 앞이며 입력 다섯은 보이는 label 이 있고 답은 aria-live", async () => {
  const html = await readFile(path.join(root, SITE, "renewal-vs-new.html"), "utf8");
  const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(0, 4), ["check-section", "convert", "expiry", "lead-section"]); // #convert 는 #673 N1, #expiry 는 #674 N2
  assert.ok(html.indexOf('id="check-section"') < html.indexOf("</aside>"));
  assert.ok(html.indexOf('id="check-optional"') < html.indexOf('id="check-answer"'), "선택 입력도 답보다 앞이어야 한다");
  assert.ok(html.indexOf("</aside>") < html.indexOf('id="convert"'), "계산 근거 안내가 비교 도구 바로 뒤에 남아야 한다");
  for (const [id, text] of [["check-gu", "자치구"], ["check-apt", "단지"], ["check-area", "전용면적"], ["check-old", "종전 보증금(만원, 선택)"], ["check-ask", "요구 보증금(만원, 선택)"]]) {
    assert.match(html, new RegExp(`<label for="${id}" id="${id}-label">${text.replace(/[()]/g, "\\$&")}</label>`), `${id} 의 보이는 label`);
  }
  assert.match(html, /<p class="lead" id="check-answer" aria-live="polite"><\/p>/);
  assert.match(html, /id="check-source">출처: 국토교통부 아파트 전월세 실거래가 공개시스템\. 최근 24개월/, "출처 줄이 source-lines 로 찍히지 않았다");
});

test("URL 로 들어온 칸: 답 문장(ko)이 판정 5 문구 그대로, 줄 n≥5 는 비율", async () => {
  const page = await open("?gu=nowon&apt=%EC%83%81%EA%B3%84%EC%A3%BC%EA%B3%B5&area=84.9");
  assert.equal(
    answer(page),
    "이 평형 전세 재계약 11건(최근 24개월) 가운데 갱신요구권을 쓴 6건은 66.7%가 5% 언저리(4.5~5%)에서 맺어졌고, 5%를 넘은 것은 0건입니다. 요구권 표시가 없는 5건은 40%가 5%를 넘었습니다."
  );
  const html = table(page);
  assert.match(html, /<th scope="row">갱신요구권 사용<\/th><td>0 \(0%\)<\/td><td>1 \(16\.7%\)<\/td><td>1 \(16\.7%\)<\/td><td>4 \(66\.7%\)<\/td><td>0 \(0%\)<\/td><td>6<\/td>/);
  assert.match(html, /<th scope="row">표시 없음<\/th><td>0 \(0%\)<\/td><td>0 \(0%\)<\/td><td>3 \(60%\)<\/td><td>0 \(0%\)<\/td><td>2 \(40%\)<\/td><td>5<\/td>/);
  assert.equal(page.text("check-new"), "같은 평형 신규 전세 중간값 95,000만원(최근 6개월 3건).");
  assert.doesNotMatch(answer(page) + html, /중앙값|평균|전망/, "답·표에 중앙값·평균·전망");
});

test("줄 문턱: 3~4건은 「n건 가운데 k건」·비율 없음, 3건 미만은 그 줄만 표본 부족(n건)", async () => {
  const page = await open("?gu=nowon&apt=%EC%9E%91%EC%9D%80%EB%8B%A8%EC%A7%80&area=59.9");
  assert.equal(
    answer(page),
    "이 평형 전세 재계약 6건(최근 24개월) 가운데 갱신요구권을 쓴 4건 가운데 3건이 5% 언저리(4.5~5%)에서 맺어졌고, 5%를 넘은 것은 0건입니다. 요구권 표시가 없는 갱신은 표본 부족(2건)입니다."
  );
  const html = table(page);
  assert.match(html, /<th scope="row">갱신요구권 사용<\/th><td>0<\/td><td>0<\/td><td>1<\/td><td>3<\/td><td>0<\/td><td>4<\/td>/);
  assert.match(html, /<th scope="row">표시 없음<\/th><td colspan="6"><span class="low-sample">표본 부족\(2건\)<\/span><\/td>/);
  assert.equal(page.text("check-new"), "같은 평형 신규 전세 0건(최근 6개월) — 중간값을 내기엔 적습니다.");
});

test("목록에 없는 단지·평형은 자치구×면적대로 내리고 답 첫머리에 그렇다고 적는다", async () => {
  const page = await open("?gu=nowon");
  await setValue(page, "check-apt", "얇은단지");
  assert.equal(page.byId("check-area").value, "", "목록에 없는 단지인데 평형을 골라 버렸다");
  assert.equal(answer(page), "");
  assert.match(page.html("check-area"), /<option value="b:60to85">60~85㎡ — 목록에 없는 평형\(구 전체\)<\/option>/);
  await setValue(page, "check-area", "b:60to85", "change");
  // 60~85㎡ 짝: 상계주공 11 + 얇은단지 2 = 13 (요구권 6 · 표시 없음 7). 작은단지(59.9)는 60㎡ 미만.
  assert.equal(
    answer(page),
    "갱신이 3건 미만인 단지·평형은 목록에 없습니다 — 아래는 노원구 60~85㎡ 전체 값입니다. 노원구 60~85㎡ 전세 재계약 13건(최근 24개월) 가운데 갱신요구권을 쓴 6건은 66.7%가 5% 언저리(4.5~5%)에서 맺어졌고, 5%를 넘은 것은 0건입니다. 요구권 표시가 없는 7건은 57.1%가 5%를 넘었습니다."
  );
  assert.equal(page.text("check-new"), "", "fallback 에 신규 중간값을 붙였다");
  assert.match(page.search(), /gu=nowon&apt=%EC%96%87%EC%9D%80%EB%8B%A8%EC%A7%80&area=b%3A60to85/);
});

test("요구액: 인상률과 그 구간 위 경계를 넘긴 건수 - 정확히 5.0%·4.5% 경계, 그 사이, 인하", async () => {
  const page = await open("?gu=nowon&apt=%EC%83%81%EA%B3%84%EC%A3%BC%EA%B3%B5&area=84.9");
  await setValue(page, "check-old", "48000");
  assert.doesNotMatch(answer(page), /요구액/, "요구액 없이 문장을 붙였다");
  const cases = [
    ["50400", "요구액은 종전보다 5% — 이 평형 재계약 가운데 5%보다 많이 올린 것은 2건입니다."], // 정확히 5.0% → 상한 근처, 5% 초과 2건
    ["50160", "요구액은 종전보다 4.5% — 이 평형 재계약 가운데 4.5%보다 많이 올린 것은 6건입니다."], // 정확히 4.5% → 0~4.5%, 위 구간 4+2
    ["50300", "요구액은 종전보다 4.8% — 이 평형 재계약 가운데 5%보다 많이 올린 것은 2건입니다."],
    ["50401", "요구액은 종전보다 5% — 이 평형 재계약 가운데 5%보다 많이 올린 것은 2건입니다."], // 5.002% → 5% 초과(표시는 반올림)
    ["49000", "요구액은 종전보다 2.1% — 이 평형 재계약 가운데 4.5%보다 많이 올린 것은 6건입니다."],
    ["48000", "요구액은 종전보다 0% — 이 평형 재계약 가운데 0%보다 많이 올린 것은 10건입니다."],
    ["47000", "요구액은 종전보다 -2.1% — 이 평형 재계약 가운데 0%보다 많이 올린 것은 10건입니다."],
  ];
  for (const [ask, want] of cases) {
    await setValue(page, "check-ask", ask);
    assert.ok(answer(page).endsWith(` ${want}`), `${ask}: ${answer(page)}`);
  }
  assert.doesNotMatch(page.search(), /48000|50/, "개인 입력값이 URL 에 들어갔다");
});

test("영어: 판정 5 영어 문구, 표·라벨·법무 문구에 한국어가 남지 않는다(단지·자치구 이름 제외)", async () => {
  const page = await open("?gu=nowon&apt=%EC%83%81%EA%B3%84%EC%A3%BC%EA%B3%B5&area=84.9");
  await page.click("lang-toggle");
  assert.equal(
    answer(page),
    "Of 11 jeonse renewals for this unit type (last 24 months), 66.7% of the 6 that used the renewal right settled near the 5% cap (4.5–5%), and 0 went above 5%. Of the 5 without that mark, 40% went above 5%."
  );
  for (const id of ["check-heading", "check-gu-label", "check-apt-label", "check-area-label", "check-old-label", "check-ask-label", "check-scope", "check-legal", "check-source", "check-new"]) {
    assert.doesNotMatch(page.text(id), /[가-힣]/, `${id}: ${page.text(id)}`);
  }
  assert.equal(page.text("check-heading"), "Check your renewal");
  assert.doesNotMatch(table(page), /[가-힣]/);
  assert.doesNotMatch(page.html("check-area").replace(/value="[^"]*"/g, ""), /[가-힣]/);
  await setValue(page, "check-apt", "작은단지");
  await setValue(page, "check-area", "59.9", "change");
  assert.equal(answer(page), "Of 6 jeonse renewals for this unit type (last 24 months), 3 of the 4 that used the renewal right settled near the 5% cap (4.5–5%), and 0 went above 5%. Those without that mark are too few (2).");
  await setValue(page, "check-area", "b:under60", "change");
  assert.match(answer(page), /^Unit types with fewer than 3 renewals are not listed — figures below are district-wide, in 노원구 under 60m²\. Of 6 jeonse renewals in 노원구 under 60m² \(last 24 months\), /);
  await page.click("lang-toggle");
  assert.equal(page.text("check-heading"), "우리 단지 재계약 확인", "한국어로 돌아오지 않았다");
});

test("자치구를 바꾸면 그 구 파일을 받고, 없는 구(404)는 아무 답도 내지 않는다", async () => {
  const page = await open();
  assert.match(page.html("check-gu"), /<option value="">고르기<\/option><option value="nowon">노원구<\/option>/);
  assert.equal(answer(page), "");
  await setValue(page, "check-gu", "nowon", "change");
  assert.match(page.html("check-apt-list"), /<option value="상계주공"><option value="작은단지">/);
  assert.equal(page.byId("check-area").value, "");
  await setValue(page, "check-apt", "상계주공");
  assert.equal(page.byId("check-area").value, "84.9", "하나뿐인 평형을 고르지 않았다");
  assert.match(answer(page), /^이 평형 전세 재계약 11건/);
  const missing = await loadPage({ file: "renewal-vs-new.html", data: { "renewal-facts": FACTS }, query: "?gu=nowon&apt=x&area=84.9" });
  assert.equal(missing.text("check-answer"), "");
  assert.equal(missing.html("check-table"), "");
});

test("드리프트: 화면의 구간 판정(ckBand)이 빌더의 bandOf 와 모든 격자에서 같다", async () => {
  const html = await readFile(path.join(root, SITE, "renewal-vs-new.html"), "utf8");
  const src = html.match(/^const ckBand = .*$/m)?.[0];
  assert.ok(src, "ckBand 를 못 찾았다");
  const ckBand = vm.runInNewContext(`(${src.replace(/^const ckBand = /, "").replace(/;$/, "")})`);
  for (const p of [1, 7, 100, 7000, 9999, 10000, 20000, 33333, 48000]) {
    for (let d = Math.floor(p * 0.9); d <= Math.ceil(p * 1.07); d += Math.max(1, Math.floor(p / 2000))) {
      assert.equal(BANDS[ckBand(d, p)], bandOf(d, p), `${p}→${d}`);
    }
    for (const d of [p, Math.round(p * 1.045), Math.round(p * 1.05), Math.round(p * 1.05) + 1]) assert.equal(BANDS[ckBand(d, p)], bandOf(d, p), `${p}→${d}`);
  }
});

test("금지어: 확인기 문구(ko/en)에 평균·전망·권유 표현이 없다", async () => {
  const html = await readFile(path.join(root, "docs/renewal-vs-new.html"), "utf8");
  const section = html.slice(html.indexOf('<section id="check-section"'), html.indexOf('<section id="convert"'));
  const dict = [...html.matchAll(/^\s+ck[A-Z]\w*:[\s\S]*?(?=^\s+ck[A-Z]\w*:|^\s+},?$)/gm)].map((m) => m[0]).join("\n");
  assert.ok(dict.includes("ckLegal") && dict.includes("Check your renewal"), "사전 조각을 못 읽었다");
  for (const text of [section, dict]) {
    assert.doesNotMatch(text, /평균|전망|average|forecast|outlook/i);
    assert.doesNotMatch(text, /받아들이세요|받아들여|쓸 수 있습니다|요구하세요|should accept|you can use/);
  }
});
