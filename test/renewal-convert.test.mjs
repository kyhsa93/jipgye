// 반전세 전환 계산기(#673 N1, renewal-vs-new.html #convert)의 시험.
// 렌더된 장의 인라인 스크립트를 가짜 DOM(test/helpers/digest-page.mjs)에 올린 뒤, 같은 샌드박스에서 docs/renewal-convert.js 를 돌린다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { AREA_BANDS, MIN_PAIRS } from "../scripts/conversion.ts";
import { FOOTERS } from "../scripts/source-lines.ts";
import { loadPage, stubElement } from "./helpers/digest-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const JS = await readFile(path.join(root, "docs/renewal-convert.js"), "utf8");
const HTML = await readFile(path.join(root, SITE, "renewal-vs-new.html"), "utf8");
const SECTION = HTML.slice(HTML.indexOf('<section id="convert"'), HTML.indexOf('<section id="lead-section"'));

// 기존 재계약 화면 픽스처(인라인 스크립트가 renewal-facts 를 받아야 장이 선다).
const FACTS = { updatedAt: "2026-10-24T00:00:00Z", slugs: { 강남구: "gangnam" }, table: [{ district: "강남구", gapMedian: null, gapMatched: 1, rightUsed: 1 }] };
const CONVERSION = {
  months: ["202605", "202606", "202607", "202608", "202609", "202610"],
  bands: AREA_BANDS.map(({ key, label }) => ({ key, label })),
  slugs: { 강남구: "gangnam", 노원구: "nowon" },
  seoul: { rate: 4.8, pairs: 3366 },
  cells: [
    { district: "강남구", band: "60to85", rate: 4.95, pairs: 111 },
    // 빌드는 MIN_PAIRS 미만 칸을 내지 않는다 - 그래도 들어오면 화면이 서울로 내리는지 본다.
    { district: "노원구", band: "under60", rate: 6.1, pairs: 2 },
  ],
};
const MARKET = { baseRate: { value: "3.00", effectiveFrom: "2026년 08월 27일" } };

// 구운 장의 #convert 요소를 그 글자·data-en 그대로 세운다.
function seedFromHtml() {
  const seed = {};
  for (const m of SECTION.matchAll(/<(\w+)[^>]*\bid="(cv-[\w-]+)"([^>]*)>([^<]*)/g)) {
    const attrs = {};
    const en = m[0].match(/data-en="([^"]*)"/);
    if (en) attrs["data-en"] = en[1];
    const el = stubElement(attrs, m[2]);
    el.textContent = m[4];
    seed[m[2]] = el;
  }
  return seed;
}

async function open({ conversion = CONVERSION, market = MARKET, locale = "ko" } = {}) {
  const data = { "renewal-facts": FACTS, market };
  if (conversion) data.conversion = conversion;
  const page = await loadPage({ file: "renewal-vs-new.html", data, locale, seed: seedFromHtml() });
  new vm.Script(JS, { filename: "docs/renewal-convert.js" }).runInContext(page.sandbox);
  await page.settle();
  return page;
}

const set = async (page, values) => {
  for (const [id, value] of Object.entries(values)) {
    const el = page.byId(id);
    el.value = value;
    el.dispatch(id === "cv-gu" || id === "cv-band" ? "change" : "input");
  }
  await page.settle();
};
const answer = (page) => page.text("cv-answer");

const KO_SPAN = "2026.05~2026.10 신규 계약";
const KO_CAP = "법정 상한 5%(기준금리 3.00%, 2026년 08월 27일부터)";

test("문턱은 빌더와 같다: 화면 MIN = scripts/conversion.ts MIN_PAIRS", () => {
  assert.equal(Number(JS.match(/const MIN = (\d+);/)?.[1]), MIN_PAIRS);
});

test("자리·보이는 label·aria-live·출처 줄(ECOS 가공 꼬리)·스크립트는 이 장에만", async () => {
  const ids = [...HTML.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(0, 3), ["check-section", "convert", "lead-section"]);
  assert.match(SECTION, /^<section id="convert" class="tw:mb-10 tw:1024:mb-16">/);
  for (const [id, text] of [["cv-gu", "자치구(선택)"], ["cv-band", "전용면적(선택)"], ["cv-dep", "현재 보증금(만원, 선택)"], ["cv-amt", "월세로 돌릴 보증금(만원)"]]) {
    assert.ok(SECTION.includes(`<label for="${id}" id="${id}-label" data-en="`) && SECTION.includes(`">${text}</label>`), `${id} label`);
  }
  assert.match(SECTION, /<p class="lead" id="cv-answer" aria-live="polite"><\/p>/);
  assert.ok(SECTION.includes(`data-en="${FOOTERS.renewalConvert.en}">${FOOTERS.renewalConvert.ko}</p>`), "출처 줄이 source-lines 로 찍히지 않았다");
  assert.match(FOOTERS.renewalConvert.ko, /ECOS\) 기준금리\. 이 값은 원자료를 가공한 것입니다\.$/);
  assert.equal(HTML.split('<script src="./renewal-convert.js" defer></script>').length, 2);
  for (const other of ["index.html", "jeonse-vs-wolse.html", "switch-house.html"]) {
    assert.ok(!(await readFile(path.join(root, SITE, other), "utf8")).includes("renewal-convert.js"), other);
  }
});

test("서울 기본: 시장 전환율과 법정 상한 두 값, 날짜·n 을 답 한 문장에", async () => {
  const page = await open();
  assert.equal(answer(page), "", "금액 없이 답을 냈다");
  assert.match(page.html("cv-gu"), /<option value="">서울 전체<\/option><option value="강남구">강남구<\/option>/);
  await set(page, { "cv-amt": "10000" });
  assert.equal(answer(page), `서울 시장 전환율 4.8%(3,366쌍, ${KO_SPAN}) → 월 40만원, ${KO_CAP} → 월 41.7만원.`);
});

test("구×면적 칸: 그 칸 값과 n, 현재 보증금을 넣으면 바뀐 보증금도", async () => {
  const page = await open();
  await set(page, { "cv-gu": "강남구", "cv-band": "60to85", "cv-dep": "50000", "cv-amt": "10000" });
  // 10,000 × 4.95% ÷ 12 = 41.25 → 41.3, 10,000 × 5% ÷ 12 = 41.67 → 41.7 (0.1만원 반올림)
  assert.equal(answer(page), `강남구 60~85㎡ 시장 전환율 4.95%(111쌍, ${KO_SPAN}) → 월 41.3만원, ${KO_CAP} → 월 41.7만원. 보증금 50,000만원 → 40,000만원.`);
});

test("문턱: 단지쌍 3쌍 미만 칸·없는 칸·구만 고른 경우는 서울 값으로 내리고 그렇다고 적는다", async () => {
  const page = await open();
  const fallback = `고른 칸은 단지쌍이 3쌍 미만이라 서울 값입니다. 서울 시장 전환율 4.8%(3,366쌍, ${KO_SPAN}) → 월 40만원, ${KO_CAP} → 월 41.7만원.`;
  await set(page, { "cv-gu": "노원구", "cv-band": "under60", "cv-amt": "10000" });
  assert.equal(answer(page), fallback, "pairs 2 칸을 썼다");
  await set(page, { "cv-band": "over85" });
  assert.equal(answer(page), fallback, "없는 칸");
  await set(page, { "cv-band": "" });
  assert.equal(answer(page), fallback, "구만 고름");
  assert.doesNotMatch(answer(page), /6\.1%/);
});

test("서울 값도 문턱 미만이면 시장 값을 내지 않는다", async () => {
  const page = await open({ conversion: { ...CONVERSION, seoul: { rate: 4.8, pairs: 2 } } });
  await set(page, { "cv-amt": "10000" });
  assert.equal(answer(page), "");
});

test("공식 가장자리: 상한은 min(10%, 기준금리+2%p), 기준금리 없으면 상한 절을 뺀다, 금액>보증금·0·음수", async () => {
  let page = await open({ market: { baseRate: { value: "8.50", effectiveFrom: "2030년 01월 02일" } } });
  await set(page, { "cv-amt": "10000" });
  assert.match(answer(page), /법정 상한 10%\(기준금리 8\.50%, 2030년 01월 02일부터\) → 월 83\.3만원\.$/);

  page = await open({ market: { baseRate: { value: "2.75", effectiveFrom: "2025년 05월 29일" } } });
  await set(page, { "cv-amt": "3000" });
  // 3,000 × 4.75% ÷ 12 = 11.875 → 11.9
  assert.match(answer(page), /법정 상한 4\.75%\(기준금리 2\.75%, 2025년 05월 29일부터\) → 월 11\.9만원\.$/);

  page = await open({ market: null });
  await set(page, { "cv-amt": "10000" });
  assert.equal(answer(page), `서울 시장 전환율 4.8%(3,366쌍, ${KO_SPAN}) → 월 40만원.`);

  page = await open();
  await set(page, { "cv-dep": "5000", "cv-amt": "6000" });
  assert.equal(answer(page), "돌릴 금액이 현재 보증금보다 큽니다.");
  for (const v of ["0", "-100", ""]) {
    await set(page, { "cv-dep": "", "cv-amt": v });
    assert.equal(answer(page), "", `금액 ${v}`);
  }
  await set(page, { "cv-dep": "6000", "cv-amt": "6000" });
  assert.match(answer(page), / 보증금 6,000만원 → 0만원\.$/);
});

test("자료를 못 받으면 알린다", async () => {
  const page = await open({ conversion: null });
  assert.equal(answer(page), "전환율 자료를 불러오지 못했습니다.");
});

test("영어: 처음부터 en·언어 전환 왕복, label·고지·출처 줄도 따라간다", async () => {
  const page = await open({ locale: "en" });
  assert.equal(page.text("cv-heading"), "Converting part of the deposit to monthly rent");
  assert.equal(page.text("cv-source"), FOOTERS.renewalConvert.en);
  assert.match(page.text("cv-legal"), /^The statutory cap .* not a verdict or a legal judgment/);
  await set(page, { "cv-gu": "강남구", "cv-band": "60to85", "cv-dep": "50000", "cv-amt": "10000" });
  assert.equal(
    answer(page),
    "강남구 60–85m²: market rate 4.95% (111 pairs, new leases 2026.05~2026.10) → 41.3 (10k won) a month; statutory cap 5% (base rate 3.00% from 2026-08-27) → 41.7 a month. Deposit 50,000 → 40,000 (10k won)."
  );
  await page.click("lang-toggle");
  assert.equal(page.text("cv-heading"), "보증금 일부를 월세로 돌리면");
  assert.equal(page.text("cv-source"), FOOTERS.renewalConvert.ko);
  assert.match(answer(page), /^강남구 60~85㎡ 시장 전환율/);
  await page.click("lang-toggle");
  assert.match(answer(page), /^강남구 60–85m²: market rate/);
  await set(page, { "cv-band": "over85" });
  assert.match(answer(page), /^That pick has fewer than 3 complex pairs, so Seoul's figure is used\. Seoul: market rate 4\.8% \(3,366 pairs/);
});

test("입력은 URL 에 남지 않는다", async () => {
  const page = await open();
  await set(page, { "cv-gu": "강남구", "cv-band": "60to85", "cv-dep": "50000", "cv-amt": "10000" });
  assert.equal(page.search(), "");
  assert.doesNotMatch(JS, /history|location|URLSearchParams|localStorage/);
});

test("금지어: 판정·권유·평균·전망 표현이 없고, 「판정 아님」 고지는 있다", () => {
  const text = SECTION + JS;
  assert.doesNotMatch(text, /평균|전망|average|forecast|outlook/i);
  assert.doesNotMatch(text, /받아들이세요|요구하세요|청구할 수|위법|불법|should accept|you can demand|illegal/);
  assert.match(SECTION, /판정이나 법률 판단이 아닙니다/);
  assert.match(SECTION, /not a verdict or a legal judgment/);
});
