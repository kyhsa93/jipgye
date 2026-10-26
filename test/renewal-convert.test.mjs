// 반전세 전환 계산기(#673 N1, renewal-vs-new.html #convert)의 시험.
// 렌더된 장의 인라인 스크립트를 가짜 DOM(test/helpers/digest-page.mjs)에 올린 뒤, 같은 샌드박스에서 docs/renewal-convert.js 를 돌린다.
// 문구는 장의 #cv-answer data-msg(ko)·data-msg-en 에 있다(외부 JS gzip ≤2KB, #681 cto) - 구운 장에서 그대로 읽어 세운다.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { AREA_BANDS, MIN_PAIRS } from "../scripts/conversion.ts";
import { FOOTERS } from "../scripts/source-lines.ts";
import { loadPage, stubElement } from "./helpers/digest-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const JS = await readFile(path.join(root, "docs/renewal-convert.js"), "utf8");
const HTML = await readFile(path.join(root, SITE, "renewal-vs-new.html"), "utf8");
const SECTION = HTML.slice(HTML.indexOf('<section id="convert"'), HTML.indexOf('<section id="expiry"')); // 바로 아래는 #674 N2 만기 달력

// 기존 재계약 화면 픽스처(인라인 스크립트가 renewal-facts 를 받아야 장이 선다).
const FACTS = { updatedAt: "2026-10-24T00:00:00Z", slugs: { 강남구: "gangnam" }, table: [{ district: "강남구", gapMedian: null, gapMatched: 1, rightUsed: 1 }] };
const CONVERSION = {
  months: ["202605", "202606", "202607", "202608", "202609", "202610"],
  bands: AREA_BANDS.map(({ key, label }) => ({ key, label })),
  slugs: { 강남구: "gangnam", 강북구: "gangbuk", 노원구: "nowon" },
  seoul: { rate: 4.8, pairs: 3366 },
  cells: [
    { district: "강남구", band: "60to85", rate: 4.95, pairs: 111 },
    // 상한(5%)보다 높은 칸 - 오늘 75칸 중 16칸이 이렇다(#681 cpo).
    { district: "강북구", band: "under60", rate: 5.35, pairs: 20 },
    // 빌드는 MIN_PAIRS 미만 칸을 내지 않는다 - 그래도 들어오면 화면이 서울로 내리는지 본다.
    { district: "노원구", band: "under60", rate: 6.1, pairs: 2 },
  ],
};
const MARKET = { baseRate: { value: "3.00", effectiveFrom: "2026년 08월 27일" } };

// 구운 장의 #convert 요소를 그 글자·data-* 그대로 세운다.
function seedFromHtml() {
  const seed = {};
  for (const m of SECTION.matchAll(/<(\w+)[^>]*\bid="(cv-[\w-]+)"[^>]*>([^<]*)/g)) {
    const attrs = Object.fromEntries([...m[0].matchAll(/(data-[\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const el = stubElement(attrs, m[2]);
    el.textContent = m[3];
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
const KO_SEOUL = `서울 시장 전환율 4.8%(3,366쌍, ${KO_SPAN}) → 월 40.0만원, ${KO_CAP} → 월 41.7만원.`;

const LEGAL_KO =
  "법정 상한은 주택임대차보호법 제7조의2와 같은 법 시행령 제9조(연 10%와 한국은행 기준금리에 연 2%를 더한 비율 중 낮은 값, 2026.10.26 국가법령정보센터 현행 조문 확인)로 계산했습니다. 이 상한은 계약 기간 중이나 같은 집 재계약에서 기존 보증금의 전부·일부를 월세로 바꿀 때 적용되며, 새로 맺는 계약에는 적용되지 않을 수 있습니다. 시장 전환율은 전세 vs 월세 화면이 같은 단지 신규 계약으로 잰 자치구·면적대 중앙값이고, 단지쌍이 3쌍 미만이면 서울 값을 씁니다. 이 화면은 계산일 뿐 판정이나 법률 자문이 아닙니다 — 대한법률구조공단이나 주택임대차분쟁조정위원회에 문의하세요.";
const LEGAL_EN =
  "The statutory cap follows Article 7-2 of the Housing Lease Protection Act and Article 9 of its Enforcement Decree (the lower of 10% a year and the Bank of Korea base rate plus 2% a year; current text checked on the National Law Information Center on 2026-10-26). It applies when all or part of an existing deposit is converted to monthly rent during the lease or on renewal of the same home, and may not apply to a new lease. The market rate is the district and size-band median the jeonse vs monthly-rent page measures from new leases in the same complexes; a pick with fewer than 3 complex pairs uses Seoul's figure. This is a calculation, not a verdict or legal advice — contact the Korea Legal Aid Corporation or a Housing Lease Dispute Mediation Committee.";

test("문턱은 빌더와 같다: 화면 MIN = scripts/conversion.ts MIN_PAIRS", () => {
  assert.equal(Number(JS.match(/const MIN = (\d+);/)?.[1]), MIN_PAIRS);
});

test("자리·보이는 label·aria-live·출처 줄(ECOS 가공 꼬리)", () => {
  const ids = [...HTML.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(0, 4), ["check-section", "convert", "expiry", "lead-section"]);
  assert.match(SECTION, /^<section id="convert" class="tw:mb-10 tw:1024:mb-16">/);
  for (const [id, text] of [["cv-gu", "자치구(선택)"], ["cv-band", "전용면적(선택)"], ["cv-dep", "현재 보증금(만원, 선택)"], ["cv-amt", "월세로 돌릴 보증금(만원)"]]) {
    assert.ok(SECTION.includes(`<label for="${id}" id="${id}-label" data-en="`) && SECTION.includes(`">${text}</label>`), `${id} label`);
  }
  assert.match(SECTION, /<p class="lead" id="cv-answer" aria-live="polite" data-msg="[^"]+" data-msg-en="[^"]+"><\/p>/);
  for (const attr of ["data-msg", "data-msg-en"]) {
    assert.equal(SECTION.match(new RegExp(`${attr}="([^"]*)"`))[1].split("|").length, 14, `${attr} 문구 14개`);
  }
  assert.ok(SECTION.includes(`data-en="${FOOTERS.renewalConvert.en}">${FOOTERS.renewalConvert.ko}</p>`), "출처 줄이 source-lines 로 찍히지 않았다");
  assert.match(FOOTERS.renewalConvert.ko, /ECOS\) 기준금리\. 이 값은 원자료를 가공한 것입니다\.$/);
});

test("외부 JS 는 gzip ≤2,048B, renewal-vs-new 만 defer 로 한 번 읽고 서비스워커 사전캐시에 없다 (#681 cto)", async () => {
  const size = gzipSync(JS, { level: 9 }).length;
  assert.ok(size <= 2048, `docs/renewal-convert.js gzip ${size}B`);
  assert.equal(HTML.split('<script src="./renewal-convert.js" defer></script>').length, 2);
  assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes("renewal-convert"), "sw.js 사전캐시에 들어갔다");
  const users = [];
  for (const f of (await readdir(path.join(root, SITE))).filter((x) => x.endsWith(".html")).sort()) {
    if ((await readFile(path.join(root, SITE, f), "utf8")).includes("renewal-convert.js")) users.push(f);
  }
  assert.deepEqual(users, ["renewal-vs-new.html"]);
});

test("법정 상한 고지는 legal 확인 문구 그대로(조문·확인일 2026-10-26·적용 범위), 언어를 따라간다 (#681 legal)", async () => {
  assert.ok(SECTION.includes(`<p class="content-notice" id="cv-legal" data-en="${LEGAL_EN}">${LEGAL_KO}</p>`));
  const page = await open();
  assert.equal(page.text("cv-legal"), LEGAL_KO);
  await page.click("lang-toggle");
  assert.equal(page.text("cv-legal"), LEGAL_EN);
});

test("서울 기본: 시장 전환율과 법정 상한 두 값, 날짜·n 을 답 한 문장에", async () => {
  const page = await open();
  assert.equal(answer(page), "", "금액 없이 답을 냈다");
  assert.match(page.html("cv-gu"), /<option value="">서울 전체<\/option><option value="강남구">강남구<\/option>/);
  await set(page, { "cv-amt": "10000" });
  assert.equal(answer(page), KO_SEOUL);
});

test("구×면적 칸: 그 칸 값과 n, 현재 보증금을 넣으면 바뀐 보증금도", async () => {
  const page = await open();
  await set(page, { "cv-gu": "강남구", "cv-band": "60to85", "cv-dep": "50000", "cv-amt": "10000" });
  // 10,000 × 4.95% ÷ 12 = 41.25 → 41.3, 10,000 × 5% ÷ 12 = 41.67 → 41.7 (0.1만원 반올림)
  assert.equal(answer(page), `강남구 60~85㎡ 시장 전환율 4.95%(111쌍, ${KO_SPAN}) → 월 41.3만원, ${KO_CAP} → 월 41.7만원. 보증금 50,000만원 → 40,000만원.`);
});

test("문턱: 구·면적을 다 골랐는데 3쌍 미만이거나 없는 칸은 서울 값으로 내리고 그렇다고 적는다", async () => {
  const page = await open();
  await set(page, { "cv-gu": "노원구", "cv-band": "under60", "cv-amt": "10000" });
  assert.equal(answer(page), `고른 칸은 단지쌍이 3쌍 미만이라 서울 값입니다. ${KO_SEOUL}`, "pairs 2 칸을 썼다");
  assert.doesNotMatch(answer(page), /6\.1%/);
  await set(page, { "cv-band": "over85" });
  assert.equal(answer(page), `고른 칸은 단지쌍이 3쌍 미만이라 서울 값입니다. ${KO_SEOUL}`, "없는 칸");
});

test("구만 또는 면적만 고르면 「3쌍 미만」이 아니라 둘 다 고르라고 적고 서울 값 (#681 cpo 1)", async () => {
  const page = await open();
  const want = `자치구와 면적을 모두 골라야 그 칸 값을 씁니다. ${KO_SEOUL}`;
  await set(page, { "cv-gu": "강남구", "cv-amt": "10000" });
  assert.equal(answer(page), want, "구만");
  await set(page, { "cv-gu": "", "cv-band": "60to85" });
  assert.equal(answer(page), want, "면적만");
  assert.doesNotMatch(answer(page), /3쌍 미만/);
  await page.click("lang-toggle");
  assert.match(answer(page), /^Pick both a district and a size to use that cell's figure\. Seoul: market rate 4\.8%/);
});

test("시장 전환율이 법정 상한보다 높은 칸은 끝에 상한 금액 문장을 붙인다 (#681 cpo 2)", async () => {
  const page = await open();
  await set(page, { "cv-gu": "강북구", "cv-band": "under60", "cv-amt": "10000" });
  // 10,000 × 5.35% ÷ 12 = 44.58 → 44.6
  assert.equal(
    answer(page),
    `강북구 60㎡ 미만 시장 전환율 5.35%(20쌍, ${KO_SPAN}) → 월 44.6만원, ${KO_CAP} → 월 41.7만원. 이 칸의 신규 계약 전환율은 법정 상한보다 높습니다 — 상한이 적용되는 전환이라면 월 41.7만원을 넘을 수 없습니다.`
  );
  await page.click("lang-toggle");
  assert.match(answer(page), /a month\. This cell's new-lease rate is above the statutory cap; where the cap applies, the rent cannot exceed 41\.7 a month\.$/);
  await set(page, { "cv-gu": "강남구", "cv-band": "60to85" });
  assert.doesNotMatch(answer(page), /above the statutory cap/, "상한보다 낮은 칸에 붙였다");
});

test("월세 금액은 늘 소수 한 자리, 보증금·쌍 수는 정수 (#681 cpo)", async () => {
  const page = await open({ market: { baseRate: { value: "4.00", effectiveFrom: "2026년 08월 27일" } } });
  await set(page, { "cv-dep": "30000", "cv-amt": "12000" });
  // 12,000 × 4.8% ÷ 12 = 48 → 48.0, 상한 6% → 60.0
  assert.equal(answer(page), `서울 시장 전환율 4.8%(3,366쌍, ${KO_SPAN}) → 월 48.0만원, 법정 상한 6%(기준금리 4.00%, 2026년 08월 27일부터) → 월 60.0만원. 보증금 30,000만원 → 18,000만원.`);
  await page.click("lang-toggle");
  assert.match(answer(page), /→ 48\.0 \(10k won\) a month; statutory cap 6% \(base rate 4\.00% from 2026-08-27\) → 60\.0 a month\. Deposit 30,000 → 18,000 \(10k won\)\.$/);
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
  // 서울 4.8% > 상한 4.75% 라 상한 초과 문장이 이어진다.
  assert.match(answer(page), /법정 상한 4\.75%\(기준금리 2\.75%, 2025년 05월 29일부터\) → 월 11\.9만원\. 이 칸의 신규 계약 전환율은 법정 상한보다 높습니다/);

  page = await open({ market: null });
  await set(page, { "cv-amt": "10000" });
  assert.equal(answer(page), `서울 시장 전환율 4.8%(3,366쌍, ${KO_SPAN}) → 월 40.0만원.`);

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
  assert.equal(page.text("cv-legal"), LEGAL_EN);
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
  assert.match(SECTION, /판정이나 법률 자문이 아닙니다/);
  assert.match(SECTION, /not a verdict or legal advice/);
});
