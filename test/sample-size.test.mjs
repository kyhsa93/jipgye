import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_SLUGS } from "../scripts/district-slugs.mjs";
import { realestateOverallHtml } from "../scripts/prerender.mjs";
import { districtSentences } from "../scripts/district-summary.mjs";
import { regionTableHtml } from "../scripts/build-district-change.mjs";
import { leadSentence as conversionLead } from "../scripts/conversion.mjs";
import { controlSentence, leadSentence as recordLead, survivalSentence } from "../scripts/record-high.mjs";

/**
 * 값 옆에 표본 수가 없는 칸 4종 (#172). 규칙은 하나다 - 값 바로 옆, 같은 문장 안에 건수와 단위.
 * 값이 비워진 칸(#171)에는 이 규칙을 적용하지 않고 n만 남긴다. 그래서 값 있음/없음 두 갈래로 나눠 본다.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const json = async (file) => JSON.parse(await read(file));

const PERCENT = /\d+(\.\d+)?%/;
const COUNT = /[0-9,]+\s?(건|개|단지|칸)/;
// 전세가율 값 옆 표본 수는 신고 건수라 단위가 '건'이어야 한다. 위 COUNT를 쓰면 문장 안의 "25개 구"에도 맞아
// 건수가 빠져도 시험이 통과한다(#182).
const COUNT_GEON = /[0-9,]+건/;
const sentencesOf = (text) => text.split(/(?<=[다요)])\.\s+/).map((s) => s.trim()).filter(Boolean);
const textOf = (html) => html.replace(/<[^>]+>/g, "");
const block = (html, name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1] ?? "";

// --- 1. 구 전세가율 25장 ----------------------------------------------------------

const districtPages = Object.entries(DISTRICT_SLUGS).map(([name, slug]) => ({ name, file: `docs/district-${slug}.html` }));

async function ratioSentenceOf({ name, file }) {
  const html = await read(file);
  const ko = block(html, "districtSummaryKo");
  const ratio = sentencesOf(ko).find((s) => s.startsWith("전세가율은"));
  return { name, html, ko, ratio };
}

test("district 25장: 전세가율 값(카드·문장)이 있으면 같은 칸·문장 안에 건수가 있다", async () => {
  assert.equal(districtPages.length, 25);
  let withValue = 0;
  for (const page of districtPages) {
    const { html, ratio } = await ratioSentenceOf(page);
    const card = html.match(/<div class="label">전세가율<\/div><div class="value">([^<]*)<\/div>(<div class="sub">([^<]*)<\/div>)?/);
    if (!ratio && !card) continue; // 값이 비워진 구: 아래 시험이 따로 본다
    withValue += 1;
    assert.ok(ratio, `${page.name}: 카드에 값이 있는데 전세가율 문장이 없다`);
    assert.ok(PERCENT.test(ratio) && COUNT_GEON.test(ratio), `${page.name}: 전세가율 문장에 값 옆 건수가 없다: ${ratio}`);
    assert.ok(card, `${page.name}: 전세가율 카드가 없다`);
    assert.ok(COUNT_GEON.test(card[3] ?? ""), `${page.name}: 전세가율 카드 밑에 건수가 없다: ${card[0]}`);
    // 서울 평균 값도 같은 문장에 있으므로, 그 건수도 같은 문장에 있다.
    if (/서울 평균/.test(ratio)) assert.match(ratio, /서울 전체 매매 [0-9,]+건·전세 [0-9,]+건/, `${page.name}: 서울 평균 옆 건수가 없다`);
  }
  assert.equal(withValue, 25, "값이 있는 구가 25개가 아니다 - 이 시험이 일부만 본다");
});

test("district 25장: 전세가율 문장에서 숫자와 그 구 이름을 지운 문장이 서로 달라야 한다 (AdSense 중복)", async () => {
  const seen = new Map();
  for (const page of districtPages) {
    const { name, ratio } = await ratioSentenceOf(page);
    assert.ok(ratio, `${name}: 전세가율 문장이 없다`);
    const bare = ratio.replaceAll(name, "").replace(/[0-9][0-9.,]*/g, "").replace(/\s+/g, " ");
    const twin = seen.get(bare);
    assert.equal(twin, undefined, `${name}과(와) ${twin}의 전세가율 문장이 숫자·이름을 지우면 같다: ${bare}`);
    seen.set(bare, name);
  }
  assert.equal(seen.size, 25);
});

test("district: 값이 없는 구는 전세가율 문장이 없고, 값이 있는 구는 건수를 단다 (#171 두 갈래)", () => {
  const sale = { avgPricePerPyeong10k: 5000, transactionCount: 40 };
  const jeonse = { avgDepositPerPyeong10k: 2500, transactionCount: 30 };
  const entry = (name, withJeonse) => ({ name, sale, ...(withJeonse ? { jeonse } : {}) });
  const realestate = { overall: entry("서울", true), districts: [entry("가구", true), entry("나구", true), entry("다구", false)] };

  // 값 없음(전세 표본이 없어 비율을 내지 않은 칸): % 값이 든 전세가율 문장이 없다. n 규칙도 적용하지 않는다.
  const blank = districtSentences(realestate.districts[2], realestate, "ko", null).join(" ");
  assert.ok(!/전세가율/.test(blank), `값이 없는 칸에 전세가율 문장이 남았다: ${blank}`);

  // 값 있음: 문장 안에 % 값과 건수가 함께 있다.
  const filled = districtSentences(realestate.districts[0], realestate, "ko", null).find((s) => s.startsWith("전세가율은"));
  assert.ok(filled && PERCENT.test(filled) && COUNT_GEON.test(filled), `값이 있는 칸에 건수가 없다: ${filled}`);
});

test("district 전세가율 시험: 건수 없이 '개'만 있는 합성 문장('25개 구')은 실패한다 (#182 음성)", () => {
  const synthetic = "전세가율은 54.8%로 서울 평균 55.0%보다 낮고, 25개 구를 전세가율 순으로 세우면 가장 높습니다.";
  assert.ok(PERCENT.test(synthetic) && COUNT.test(synthetic), "전제: 옛 정규식은 이 문장에 맞는다");
  assert.ok(!COUNT_GEON.test(synthetic), "'25개 구'가 건수로 읽혔다");
  assert.ok(COUNT_GEON.test("서울 전체 매매 684건·전세 547건"));
});

// --- 1-2. 구가 아닌 화면의 서울 전체 전세가율 카드 (#182) -------------------------------

const RATIO_CARD = /<div class="label">전세가율<\/div><div class="value">([^<]*)<\/div>(?:<div class="sub">([^<]*)<\/div>)?/g;

test("서울 전체 전세가율 카드: 정적 HTML의 % 카드마다 같은 카드 안에 건수가 있다", async () => {
  const files = (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html") && !f.startsWith("district-"));
  let cards = 0;
  for (const f of files) {
    for (const m of (await read(`docs/${f}`)).matchAll(RATIO_CARD)) {
      cards += 1;
      assert.ok(PERCENT.test(m[1]) ? COUNT_GEON.test(m[2] ?? "") : true, `${f}: 전세가율 값 옆에 건수가 없다: ${m[0]}`);
    }
  }
  assert.ok(cards >= 1, "전세가율 카드가 하나도 없다 - 이 시험이 아무것도 보지 않았다");
});

test("서울 전체 전세가율 카드: 빌드와 브라우저 템플릿이 같은 표기를 만든다 (드리프트)", async () => {
  const [template, ...copies] = await Promise.all(
    ["realestate.html", "apartment-jeonse.html", "budget-3eok.html", "budget-20eok.html"].map((f) => read(`docs/${f}`))
  );
  assert.match(template, /t\("thSale"\)\} \$\{t\("countUnit"\)\(resolveMetric\(overall, "sale"\)\.metric\.transactionCount\)\} · /);
  for (const c of copies) assert.equal(c.includes('card(\n          t("thRatio")'), true, "복제 화면의 템플릿이 원본과 다르다");
});

test("서울 전체 전세가율 카드: 값이 있으면 % 옆에 건수, 값이 비면 % 없이 카드가 없다 (#171 두 갈래)", () => {
  const entry = (jeonse) => ({
    name: "서울",
    sale: { avgPricePerPyeong10k: 5000, transactionCount: 684 },
    ...(jeonse ? { jeonse: { avgDepositPerPyeong10k: 2500, transactionCount: 547 } } : {}),
  });
  const filled = realestateOverallHtml({ overall: entry(true), districts: [] }, "jeonse");
  const card = filled.match(/<div class="label">전세가율<\/div><div class="value">([^<]*)<\/div><div class="sub">([^<]*)<\/div>/);
  assert.ok(card && PERCENT.test(card[1]), `값이 있는데 전세가율 카드가 없다: ${filled}`);
  assert.equal(card[2], "매매 684건 · 전세 547건");

  const blank = realestateOverallHtml({ overall: entry(false), districts: [] }, "jeonse");
  assert.ok(blank === null || !/전세가율<\/div>/.test(blank), "전세 표본이 없는데 전세가율 카드가 남았다");
});

// --- 2. jeonse-vs-wolse 대출 금리 ---------------------------------------------------

test("jeonse-vs-wolse: 대출 금리 문장의 상품·옵션 수가 conversion.json·rates.json과 같고 '평균'이라 쓰지 않는다", async () => {
  const [html, data, rates] = await Promise.all([
    read("docs/jeonse-vs-wolse.html"),
    json("docs/data/conversion.json"),
    json("docs/data/rates.json"),
  ]);
  const lead = textOf(block(html, "conversionLead"));
  assert.ok(!lead.includes("평균 금리는"), "중앙값을 '평균 금리는'이라고 쓴다(#183)");
  const sentence = sentencesOf(lead).find((s) => s.includes("전세자금대출의 옵션별 평균 금리의 중앙값은"));
  assert.ok(sentence, "대출 금리(중앙값) 문장이 없다");
  const rate = sentence.match(/중앙값은 (\d+(\.\d+)?)%/);
  assert.equal(Number(rate?.[1]), data.loan.rate);
  const n = sentence.match(/([0-9,]+)개 상품, ([0-9,]+)개 옵션 기준/);
  assert.ok(n, `같은 문장에 상품·옵션 수가 없다: ${sentence}`);
  assert.equal(Number(n[1].replaceAll(",", "")), data.loan.products);
  assert.equal(Number(n[2].replaceAll(",", "")), data.loan.options);
  // 옵션 수는 JSON 필드만 믿지 않고 원자료에서 다시 센다: 중앙값을 낸 입력 = avg가 숫자인 옵션.
  const avgOptions = rates.rentLoan.flatMap((p) => p.options ?? []).filter((o) => Number.isFinite(o?.avg)).length;
  assert.equal(data.loan.options, avgOptions);
  assert.equal(data.loan.products, rates.rentLoan.length);
  assert.equal(lead, data.seoul.leadKo, "화면 문장이 JSON의 문장과 다르다");
});

test("conversion 문장: 상품·옵션 수를 받으면 영어도 같은 문장에 적는다", () => {
  const input = { rate: 4.8, loanRate: 4.5, loanProducts: 41, loanOptions: 49, pairs: 3166, months: ["202605", "202610"] };
  assert.match(conversionLead(input, "ko"), /평균 금리의 중앙값은 4\.5%\(41개 상품, 49개 옵션 기준\)입니다/);
  assert.match(conversionLead(input, "en"), /median of the per-option average jeonse loan rates is 4\.5% \(49 options across 41 loan products\)\./);
  assert.doesNotMatch(conversionLead(input, "ko"), /평균 금리는/);
  assert.doesNotMatch(conversionLead(input, "en"), /The average jeonse loan rate/);
  // 옵션 수를 모르면 아는 단위(상품 수)만 적는다.
  assert.match(conversionLead({ ...input, loanOptions: undefined }, "ko"), /\(41개 상품 기준\)/);
});

// --- 3. switch-house 권역표 ---------------------------------------------------------

test("switch-house: 권역 5줄 모두 '같은 칸(우리)' 값 옆에 칸 수가 있고 JSON과 같다", async () => {
  const [html, data] = await Promise.all([read("docs/switch-house.html"), json("docs/data/district-change.json")]);
  assert.equal(data.regions.length, 5);
  const rows = [...block(html, "switchRegions").matchAll(/<tr><td>([^<]*)<\/td><td>([\s\S]*?)<\/td><td>/g)];
  assert.equal(rows.length, 5, "권역 줄이 5개가 아니다");
  for (const [i, [, name, ours]] of rows.entries()) {
    const region = data.regions[i];
    assert.equal(name, region.name.ko);
    assert.ok(Number.isInteger(region.cells) && region.cells > 0, `${name}: JSON에 칸 수가 없다`);
    assert.ok(textOf(ours).includes(`${region.cells.toLocaleString("ko-KR")}칸`), `${name}: 값 옆에 칸 수가 없다: ${ours}`);
  }
});

test("switch-house 권역표: 값이 있으면 % 옆에 칸 수, 값이 비면 % 없이 칸 수만 (#171 두 갈래)", () => {
  const regions = [
    { name: { ko: "가권", en: "A" }, cells: 120, ours: 12.3, official: 10, gap: 2.3 },
    { name: { ko: "나권", en: "B" }, cells: 7, ours: null, official: 10, gap: null },
  ];
  for (const locale of ["ko", "en"]) {
    const [filled, blank] = regionTableHtml(regions, locale).match(/<td>[^<]*<\/td><td>[\s\S]*?<\/td><td>[^<]*<\/td><td>[^<]*<\/td>/g);
    const ours = (row) => textOf(row.split("</td>")[1]);
    assert.match(ours(filled), PERCENT);
    assert.match(ours(filled), locale === "ko" ? /\(120칸\)/ : /\(120 cells\)/);
    assert.ok(!PERCENT.test(ours(blank)), `값이 빈 칸에 %가 남았다: ${ours(blank)}`);
    assert.match(ours(blank), locale === "ko" ? /\(7칸\)/ : /\(7 cells\)/);
  }
});

// --- 4. record-high 리드 문단 -------------------------------------------------------

test("record-high: 리드 문단 3개의 % 문장마다 같은 문장 안에 건수가 있다", async () => {
  const [html, data] = await Promise.all([read("docs/record-high.html"), json("docs/data/record-high.json")]);
  for (const name of ["recordLead", "recordControl", "recordSurvival"]) {
    const text = block(html, name);
    assert.ok(text, `${name} 문단이 비었다`);
    for (const sentence of sentencesOf(text).filter((s) => PERCENT.test(s))) {
      assert.match(sentence, COUNT, `${name}: % 값 옆에 건수가 없다: ${sentence}`);
    }
  }
  // 영어 문장도 같은 규칙이다(JSON의 en).
  for (const key of ["lead", "control", "survival"]) {
    for (const sentence of data[key].en.split(/(?<=[a-z)%])\.\s+/).filter((s) => PERCENT.test(s))) {
      assert.match(sentence, /[0-9,]{3,}/, `${key} en: % 값 옆에 건수가 없다: ${sentence}`);
    }
  }
});

test("record-high: 문장의 건수가 JSON의 분모와 같고, 생존 문장의 건수는 문턱표의 같은 줄 n 열과 같다", async () => {
  const data = await json("docs/data/record-high.json");
  const ko = (n) => n.toLocaleString("ko-KR");
  const { main } = data;
  assert.ok(data.lead.ko.includes(`신고가 ${ko(main.withNext)}건 중 ${main.record}%`));
  assert.ok(data.lead.ko.includes(`${ko(main.allCount)}건 중 ${main.all}%`));
  assert.ok(data.lead.ko.includes(`${ko(main.withNext)}건 중 ${main.aboveOld}%`));
  assert.ok(data.control.ko.includes(`${ko(main.nearCount)}건 중 ${main.near}%`));
  assert.ok(data.control.ko.includes(`${ko(main.recordSameFloorCount)}건 중 ${main.recordSameFloor}%`));
  assert.ok(data.control.ko.includes(`${ko(main.allSameFloorCount)}건 중 ${main.allSameFloor}%`));
  assert.ok(data.survival.ko.includes(`${ko(main.records)}건 가운데 ${main.none}%`));

  // 문턱을 바꿔 센 표에서 이 문장이 쓴 설정(선행 3건·180일·기다린 90일)의 '신고가' 열.
  const cells = [...data.tables.robust.ko.matchAll(/<tr>((?:<td>[\s\S]*?<\/td>)+)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1]))
  );
  const row = cells.find((r) => r[0] === `${main.prior}건↑` && r[1] === `${main.span}일` && r[2] === `${main.wait}일`);
  assert.ok(row, "표에 리드 문장과 같은 설정의 줄이 없다");
  assert.equal(row[3], ko(main.records));
});

test("record-high 문장: 분모가 없는 입력(표본 부족)은 숫자 없는 안내만 한다", () => {
  assert.ok(!/\d/.test(recordLead({ withNext: 0 }, [], "ko")));
  assert.equal(controlSentence({ withNext: 0 }, "ko"), null);
  assert.equal(survivalSentence({ records: 0 }, "ko"), null);
});
