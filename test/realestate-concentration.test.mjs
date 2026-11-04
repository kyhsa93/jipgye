// #862 조건 3 - 서울 매매 대표값의 표본(도착·계약)에서 한 단지·한 계약일 행이 5% 이상이면서 10행 이상이면 증감을 보류하고 그 건수와 뺀 값을 함께 적는다.
// 대표값은 바꾸지 않고, 어느 값이 맞다고 말하지 않으며, 단지 이름은 어디에도 남기지 않는다. 문턱은 data-analyst 의 값 판단이다(사건을 본 뒤 정했다, method 에 적는다).
// 입력은 전부 고정이다 - 오늘 data 값에 기대지 않는다(#8). 저장 원본 재현은 PR 본문의 값 대조가 맡는다.
import test from "node:test";
import assert from "node:assert/strict";
import { CONCENTRATION, isConcentrated } from "../scripts/realestate-concentration.ts";
import { representativeOverall } from "../scripts/build-realestate.ts";
import { attachChanges } from "../scripts/realestate-metrics.ts";
import { buildRealestateStats } from "../scripts/news-context.ts";
import { metricCell, withheldOf } from "../scripts/realestate-rows.ts";
import { overallCards } from "../scripts/realestate-overall.ts";
import { realestateTable } from "../scripts/realestate-table.ts";
import { districtSentences } from "../scripts/district-summary.ts";
import { realestateHtml, realestateOverallHtml, realestateTableHtml } from "../scripts/prerender.ts";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const ARRIVAL = { basis: "arrival", from: "2026-11-02", to: "2026-11-04", until: "2026-11-09", weeks: 1, districtFrom: "2026-10-12", districtWeeks: 4 };
const CONTRACT = { basis: "contract", from: "2026-08-24", to: "2026-09-20", until: "2026-09-21", weeks: 4, districtFrom: "2026-08-24", districtWeeks: 4 };

const APT = "유일한테스트단지";
const deal = (aptNm, day = 8, { umdNm = "장안동", month = 10, amount = "50,000", area = 60, cdealType = "", cdealDay = "" } = {}) => ({
  aptNm, umdNm, dealYear: 2026, dealMonth: month, dealDay: day, dealAmount: amount, excluUseAr: area, cdealType, cdealDay,
});
const rows = (list) => list.map((item) => ({ item, date: "2026-11-03" }));
// 다른 행은 전부 서로 다른 단지다 - 최대 묶음이 입력의 묶음 크기가 되게 한다.
const others = (n, tag = "다른") => Array.from({ length: n }, (_, i) => deal(`${tag}단지${i}`, 1));
const bundle = (n, extra = {}) => Array.from({ length: n }, () => deal(APT, 8, extra));
const sample = (n, total) => new Map([["sale:11230", rows([...bundle(n), ...others(total - n)])]]);
const concentrationOf = (items) => representativeOverall(items).sale?.concentration;

test("문턱 값은 5%·10행이고 부동소수 없이 판정한다", () => {
  assert.deepEqual(CONCENTRATION, { minShare: 0.05, minRows: 10 });
  assert.equal(isConcentrated(10, 200), true, "정확히 5%");
  assert.equal(isConcentrated(9, 200), false);
});

const TABLE = [
  [754, 313, true, "이 사건 규모"],
  [754, 38, true, "5.04%"],
  [754, 37, false, "4.91%, 바로 아래"],
  [200, 10, true, "5.00% 경계"],
  [200, 9, false, "행 하한·비중 둘 다 아래"],
  [100, 10, true, "10%"],
  [100, 9, false, "9%이나 행 하한"],
  [1000, 50, true, "5.00%"],
  [1000, 49, false, "4.9%"],
  [3423, 172, true, "계약 기준 표본 크기, 5.02%"],
  [3423, 171, false, "4.996%"],
  [3423, 170, false, "4.97%"],
  [19, 2, false, "10.5%이나 행 하한"],
  [12, 10, true, "뺀 쪽이 2건"],
];

test("판정표: 표본에서 세는 경로로 발동과 유지가 갈린다", () => {
  for (const [total, n, fires, why] of TABLE) {
    assert.equal(isConcentrated(n, total), fires, `isConcentrated ${n}/${total} ${why}`);
    const found = concentrationOf(sample(n, total));
    assert.equal(Boolean(found), fires, `${n}/${total} ${why}`);
    if (fires) {
      assert.equal(found.rows, n);
      assert.equal(found.without.transactionCount, total - n);
    }
  }
});

test("대표값은 그대로이고 뺀 값은 구 건수 가중으로 낸다", () => {
  const rich = [...bundle(30), ...others(70)];
  const items = new Map([
    ["sale:11230", rows(rich)],
    ["sale:11680", rows(Array.from({ length: 300 }, (_, i) => deal(`강남단지${i}`, 2, { umdNm: "역삼동", amount: "200,000" })))],
  ]);
  const overall = representativeOverall(items);
  const c = overall.sale.concentration;
  assert.equal(overall.sale.transactionCount, 400);
  assert.equal(c.rows, 30);
  assert.equal(c.share, 0.075);
  assert.equal(c.without.transactionCount, 370);
  const rest = new Map(items);
  rest.set("sale:11230", rows(others(70)));
  assert.equal(c.without.avgPricePerPyeong10k, representativeOverall(rest).sale.avgPricePerPyeong10k);
  assert.notEqual(c.without.avgPricePerPyeong10k, overall.sale.avgPricePerPyeong10k);
  const { concentration: _c, ...value } = overall.sale;
  assert.deepEqual(Object.keys(value).sort(), ["avgPricePerM2", "avgPricePerPyeong10k", "transactionCount"]);
});

test("묶음이 아닌 경우는 발동하지 않는다: 두 계약일, 다른 단지, 같은 이름 다른 동, 다른 구", () => {
  const split = [...Array.from({ length: 6 }, () => deal(APT, 8)), ...Array.from({ length: 6 }, () => deal(APT, 9)), ...others(88)];
  assert.equal(concentrationOf(new Map([["sale:11230", rows(split)]])), undefined, "한 단지 두 계약일 6+6");
  const sameDay = [...Array.from({ length: 6 }, () => deal("가단지", 8)), ...Array.from({ length: 6 }, () => deal("나단지", 8)), ...others(88)];
  assert.equal(concentrationOf(new Map([["sale:11230", rows(sameDay)]])), undefined, "다른 단지 같은 계약일");
  const twoDong = [...Array.from({ length: 6 }, () => deal(APT, 8, { umdNm: "장안동" })), ...Array.from({ length: 6 }, () => deal(APT, 8, { umdNm: "답십리동" })), ...others(88)];
  assert.equal(concentrationOf(new Map([["sale:11230", rows(twoDong)]])), undefined, "같은 이름 다른 동");
  const twoDistricts = new Map([
    ["sale:11230", rows([...Array.from({ length: 6 }, () => deal(APT, 8)), ...others(44)])],
    ["sale:11680", rows([...Array.from({ length: 6 }, () => deal(APT, 8)), ...others(44, "강남")])],
  ]);
  assert.equal(concentrationOf(twoDistricts), undefined, "같은 이름 다른 구");
});

test("이름의 앞뒤 공백은 묶음을 가르지 않는다", () => {
  const spaced = [...Array.from({ length: 5 }, () => deal(APT, 8)), ...Array.from({ length: 5 }, () => deal(` ${APT} `, 8, { umdNm: " 장안동 " })), ...others(90)];
  assert.equal(concentrationOf(new Map([["sale:11230", rows(spaced)]])).rows, 10);
});

test("표본은 대표값이 세는 행과 같다: 해제·금액 0·면적 0 은 분자와 분모 모두에서 빠진다", () => {
  const withCancelled = [...bundle(9), deal(APT, 8, { cdealType: "O", cdealDay: "26.10.20" }), ...others(90)];
  const overall = representativeOverall(new Map([["sale:11230", rows(withCancelled)]]));
  assert.equal(overall.sale.transactionCount, 99, "N=99");
  assert.equal(overall.sale.concentration, undefined, "9행이라 유지");
  for (const bad of [{ amount: "0" }, { area: 0 }]) {
    const list = [...bundle(9), deal(APT, 8, bad), ...others(90)];
    assert.equal(concentrationOf(new Map([["sale:11230", rows(list)]])), undefined, JSON.stringify(bad));
  }
});

test("기록에 남는 모양: 행 수·비중·뺀 값뿐이고 단지명과 묶음 키가 없다, 발동하지 않으면 필드가 없다", () => {
  const overall = representativeOverall(sample(313, 754));
  const c = overall.sale.concentration;
  assert.deepEqual(Object.keys(c).sort(), ["rows", "share", "without"]);
  assert.deepEqual(Object.keys(c.without).sort(), ["avgPricePerPyeong10k", "transactionCount"]);
  assert.equal(c.share, 0.4151);
  const out = attachChanges(overall, [], null, ARRIVAL);
  for (const text of [JSON.stringify(overall), JSON.stringify(out)]) {
    assert.ok(!text.includes(APT), "단지명이 기록에 들어갔다");
    assert.ok(!text.includes("장안동"), "동 이름이 기록에 들어갔다");
    assert.ok(!text.includes("|"), "묶음 키가 기록에 들어갔다");
  }
  assert.ok(!Object.hasOwn(representativeOverall(sample(5, 754)).sale, "concentration"));
});

test("뺀 쪽이 5건 미만이면 값을 남기지 않는다", () => {
  const c = concentrationOf(sample(10, 12));
  assert.deepEqual(c.without, { avgPricePerPyeong10k: null, transactionCount: 2 });
  const zero = concentrationOf(sample(10, 10));
  assert.deepEqual(zero.without, { avgPricePerPyeong10k: null, transactionCount: 0 });
});

// 이 사건과 같은 값의 고정 지표. 5,422·13억 7,772만원은 #862 표의 값이다.
const FIRED = (total = 754, rowsN = 313, withoutValue = 5422, withoutN = 441, price = 5126) => ({
  avgPricePerPyeong10k: price,
  transactionCount: total,
  concentration: { rows: rowsN, share: rowsN / total, without: { avgPricePerPyeong10k: withoutValue, transactionCount: withoutN } },
});
const baselineWith = (date = "2026-10-28") => ({ date, overall: { sale: { avgPricePerPyeong10k: 5288, transactionCount: 435 }, jeonse: { avgDepositPerPyeong10k: 3000, transactionCount: 300 } }, districts: [] });
const attach = (sale, window, baseline = baselineWith()) =>
  attachChanges({ sale, saleNational84: null, jeonse: { avgDepositPerPyeong10k: 3193, transactionCount: 427 }, wolse: null }, [], baseline, window).overall;

test("발동한 날: 증감을 빼고 이유와 값을 남긴다, 전세 증감은 그대로다", () => {
  const out = attach(FIRED(), ARRIVAL);
  assert.equal(out.sale.change, undefined);
  assert.equal(out.sale.baselineDate, undefined);
  assert.equal(out.sale.avgPricePerPyeong10k, 5126, "대표값은 바꾸지 않는다");
  assert.equal(out.sale.changeWithheld.reason, "concentration");
  assert.deepEqual([out.sale.changeWithheld.current, out.sale.changeWithheld.baseline, out.sale.changeWithheld.min], [754, 435, 100]);
  assert.ok(out.jeonse.change, "전세는 규칙 밖이다");
});

test("비교할 기록이 없는 날도 발동 문구는 나간다", () => {
  const out = attach(FIRED(), ARRIVAL, null);
  assert.equal(out.sale.changeWithheld.reason, "concentration");
  assert.equal(out.sale.changeWithheld.baseline, 0);
  assert.match(out.sale.changeWithheld.text.ko.cell, /313건을 빼면/);
});

test("지금 표본과 기준일 표본이 둘 다 걸리면 지금 표본의 문구다", () => {
  const out = attach(FIRED(), ARRIVAL, baselineWith("2026-11-03"));
  assert.equal(out.sale.changeWithheld.reason, "concentration");
});

const CELL_KO = "754건 · 증감 보류 · 한 단지·한 계약일 313건을 빼면 5,422만원(441건)";
const CELL_EN = "754 filings · change withheld · excluding 313 from one complex on one contract date: ₩54.2M (441 filings)";

test("도착 기준 문구: 칸·칩 국·영이 표와 같다", () => {
  const out = attach(FIRED(), ARRIVAL);
  assert.equal(out.sale.changeWithheld.text.ko.cell, CELL_KO);
  assert.equal(out.sale.changeWithheld.text.en.cell, CELL_EN);
  const realestate = { window: ARRIVAL, overall: { ...out, wolse: { avgDeposit10k: 24368, avgMonthlyRent10k: 143, transactionCount: 521 } } };
  const [chip] = buildRealestateStats(realestate);
  assert.equal(chip.value, "13억 251만원", "칩 값도 대표값 그대로다");
  assert.equal(chip.note, "전 면적 평균 · 11/2~11/4 들어온 신고 754건 · 증감 보류 · 한 단지·한 계약일 313건을 빼면 13억 7,772만원(441건)");
  assert.equal(chip.noteEn, "All-size average · 754 filings arrived Nov 2–4 · change withheld · excluding 313 from one complex on one contract date: ₩1,378M (441 filings)");
});

test("계약 기준 문구: 3,423건 표본에서 172행은 보류, 171행은 유지이고 재도장을 말하지 않는다", () => {
  assert.equal(Boolean(concentrationOf(sample(172, 3423))), true);
  assert.equal(Boolean(concentrationOf(sample(171, 3423))), false);
  const out = attach(FIRED(3423, 172, 5000, 3251, 5059), CONTRACT);
  assert.equal(out.sale.changeWithheld.text.ko.cell, "3,423건 · 증감 보류 · 한 단지·한 계약일 172건을 빼면 5,000만원(3,251건)");
  assert.equal(out.sale.changeWithheld.text.en.cell, "3,423 deals · change withheld · excluding 172 from one complex on one contract date: ₩50M (3,251 deals)");
  const realestate = { window: CONTRACT, overall: { ...out, wolse: { avgDeposit10k: 24368, avgMonthlyRent10k: 143, transactionCount: 521 } } };
  const [chip] = buildRealestateStats(realestate);
  assert.match(chip.note, /^전 면적 평균 · 최근 4주 계약 3,423건 · 증감 보류 · 한 단지·한 계약일 172건을 빼면 12억 7,049만원\(3,251건\)$/);
  assert.match(chip.noteEn, /^All-size average · 3,423 deals in the last 4 weeks · change withheld · excluding 172 from one complex on one contract date: ₩1,270M \(3,251 deals\)$/);
  const all = JSON.stringify([out.sale.changeWithheld.text, chip.note, chip.noteEn]);
  for (const word of ["재도장", "다시 들어", "도장", "restamp", "re-stamp", "arrived again", "filings"]) assert.ok(!all.includes(word), word);
});

test("뺀 쪽이 모자란 날: 값을 내지 않는다고 적는다", () => {
  const thin = { avgPricePerPyeong10k: 5000, transactionCount: 12, concentration: { rows: 10, share: 10 / 12, without: { avgPricePerPyeong10k: null, transactionCount: 2 } } };
  const out = attach(thin, ARRIVAL);
  assert.equal(out.sale.changeWithheld.text.ko.cell, "12건 · 증감 보류 · 한 단지·한 계약일 10건을 빼면 2건이라 값을 내지 않습니다");
  assert.equal(out.sale.changeWithheld.text.en.cell, "12 filings · change withheld · excluding 10 from one complex on one contract date: only 2 filings remain, too few to average");
  const stats = buildRealestateStats({ window: ARRIVAL, overall: { ...out, wolse: { avgDeposit10k: 24368, avgMonthlyRent10k: 143, transactionCount: 521 } } });
  assert.match(stats[0].note, /10건을 빼면 2건이라 값을 내지 않습니다$/);
  assert.match(stats[0].noteEn, /only 2 filings remain, too few to average$/);
  const one = attach({ ...thin, transactionCount: 11, concentration: { rows: 10, share: 10 / 11, without: { avgPricePerPyeong10k: null, transactionCount: 1 } } }, CONTRACT);
  assert.match(one.sale.changeWithheld.text.en.cell, /only 1 deal remains, too few to average$/);
});

const dashboard = (window = ARRIVAL) => ({
  updatedAt: "2026-11-04T03:00:00.000Z",
  window,
  overall: {
    ...attach(FIRED(), window),
    wolse: { avgDeposit10k: 24368, avgMonthlyRent10k: 143, transactionCount: 521 },
  },
  districts: [
    { code: "11230", name: "동대문구", sale: { avgPricePerPyeong10k: 4652, transactionCount: 435 }, jeonse: { avgDepositPerPyeong10k: 2500, transactionCount: 200 } },
    { code: "11680", name: "강남구", sale: { avgPricePerPyeong10k: 9000, transactionCount: 50 }, jeonse: { avgDepositPerPyeong10k: 4000, transactionCount: 80 } },
  ],
});

test("칸 경로: 구운 첫 화면·화면 JS·시세 표·틀이 같은 문구를 서울 줄에만 그린다", async () => {
  const data = dashboard();
  assert.equal(withheldOf(data.overall.sale), CELL_KO);
  assert.equal(metricCell("sale", data.overall.sale, true).count, CELL_KO);
  assert.equal(metricCell("sale", data.overall.sale, true).change, null);
  const [overallRow] = realestateHtml(data).split("</tr>");
  assert.ok(overallRow.includes(`<span class="count">${CELL_KO}</span>`));
  assert.ok(realestateTableHtml(data).includes(CELL_KO));
  assert.ok(realestateTable(data, "sale").rows[0].cells.flatMap((c) => c.parts).some((p) => p.type === "count" && p.text === CELL_KO));
  for (const [lang, text] of [["ko", CELL_KO], ["en", CELL_EN]]) {
    const index = await loadIndexPage({ storage: { lang }, fetch: async () => ({ ok: true, json: async () => data }) });
    await new Promise((r) => setTimeout(r, 20));
    const rowsHtml = index.byId("realestate-grid").innerHTML.split("</tr>");
    assert.ok(rowsHtml[0].includes(`<span class="tx-count">${text}</span>`), rowsHtml[0]);
    assert.ok(!rowsHtml.slice(1).join("").includes(text));
    const page = await loadRealestatePage({ realestate: data, locale: lang, kind: "sale", file: "scripts/realestate-template.html" });
    const grid = String(page.byId("district-grid").innerHTML).split("</tr>");
    assert.ok(grid[0].includes(text), grid[0]);
    assert.ok(!grid.slice(1).join("").includes(text));
  }
});

// 데이터가 새 모양이 되는 날 배포 게이트가 물리지 않는지 고정 입력으로 본다 - 구운 표·카드와 나가는 장의 화면 JS 가 글자까지 같아야 한다.
test("구운 표·카드와 나가는 장의 화면 JS 가 같다 - 발동한 날과 기준일에 걸린 날", async () => {
  const held = { ...dashboard(), overall: { ...dashboard().overall, sale: attach({ avgPricePerPyeong10k: 5126, transactionCount: 754 }, ARRIVAL, baselineWith("2026-11-03")).sale } };
  for (const data of [dashboard(), held]) {
    for (const kind of [null, "sale", "jeonse", "wolse"]) {
      const page = await loadRealestatePage({ realestate: data, kind, file: `${SITE}/realestate.html` });
      assert.equal(page.tableHtml(), realestateTableHtml(data, kind), `${kind ?? "전체"} 표`);
      assert.equal(page.overallHtml(), realestateOverallHtml(data, kind), `${kind ?? "전체"} 카드`);
    }
  }
});

test("요약 카드: 전 종류 카드와 매매 장 카드, 구운 쪽과 틀 양쪽에 단서가 붙고 전세 카드에는 안 붙는다", async () => {
  const data = dashboard();
  const flat = (segs) => (segs ?? []).map((s) => s.text).join("");
  const all = overallCards(data);
  assert.equal(flat(all[0].value), "5,126만원", "카드 값은 대표값이다");
  assert.equal(flat(all[0].sub), `84㎡ 환산 13억 251만원 · ${CELL_KO}`);
  assert.equal(flat(all[1].sub).includes("증감 보류"), false);
  const saleCards = overallCards(data, "sale");
  const count = saleCards.find((c) => c.label === "거래 건수");
  assert.equal(flat(count.value), "754건");
  assert.equal(flat(count.sub), "증감 보류 · 한 단지·한 계약일 313건을 빼면 5,422만원(441건)");
  assert.ok(realestateOverallHtml(data).includes(CELL_KO));
  assert.ok(realestateOverallHtml(data, "sale").includes("증감 보류 · 한 단지·한 계약일 313건을 빼면 5,422만원(441건)"));
  for (const [lang, whole, detail] of [
    ["ko", CELL_KO, "증감 보류 · 한 단지·한 계약일 313건을 빼면 5,422만원(441건)"],
    ["en", CELL_EN, "change withheld · excluding 313 from one complex on one contract date: ₩54.2M (441 filings)"],
  ]) {
    const allPage = await loadRealestatePage({ realestate: data, locale: lang, file: "scripts/realestate-template.html" });
    assert.ok(String(allPage.byId("overall-cards").innerHTML).includes(whole), `전 종류 ${lang}`);
    const salePage = await loadRealestatePage({ realestate: data, locale: lang, kind: "sale", file: "scripts/realestate-template.html" });
    assert.ok(String(salePage.byId("overall-cards").innerHTML).includes(detail), `매매 ${lang}`);
    const jeonsePage = await loadRealestatePage({ realestate: data, locale: lang, kind: "jeonse", file: "scripts/realestate-template.html" });
    assert.ok(!String(jeonsePage.byId("overall-cards").innerHTML).includes(detail), `전세 ${lang}`);
  }
});

test("기준일에 걸린 날의 카드는 증감이 원래 없어 이유를 달지 않는다", () => {
  const out = attach({ avgPricePerPyeong10k: 5100, transactionCount: 500 }, ARRIVAL, baselineWith("2026-11-03"));
  const [sale] = overallCards({ overall: { ...out, wolse: null } });
  assert.equal(sale.sub.map((s) => s.text).join("").endsWith("500건"), true);
});

test("구 장 문장: 서울 평균을 말하는 문장 뒤에 단서가 온다, 발동하지 않은 날에는 없다", () => {
  const data = dashboard();
  const entry = data.districts[0];
  const ko = districtSentences(entry, data, "ko");
  const at = ko.findIndex((s) => s.includes("서울 평균 5,126만원의 0.9배"));
  assert.ok(at >= 0, ko.join("\n"));
  assert.equal(ko[at + 1], "서울 평균 표본 754건에는 한 단지·한 계약일 313건이 들어 있어, 빼면 5,422만원(441건)입니다.");
  const en = districtSentences(entry, data, "en");
  assert.equal(en[en.findIndex((s) => s.includes("the Seoul average of")) + 1], "The Seoul sample of 754 filings includes 313 from one complex on one contract date; the average without them is ₩54.2M (441 filings).");
  const contract = districtSentences(entry, dashboard(CONTRACT), "en").join(" ");
  assert.match(contract, /The Seoul sample of 754 deals includes 313/);

  const plain = { ...data, overall: { ...data.overall, sale: { avgPricePerPyeong10k: 5126, transactionCount: 754 } } };
  assert.doesNotMatch(districtSentences(entry, plain, "ko").join(" "), /한 단지·한 계약일/);
  const thin = { ...data, overall: { ...data.overall, sale: { avgPricePerPyeong10k: 5000, transactionCount: 12, concentration: { rows: 10, share: 0.83, without: { avgPricePerPyeong10k: null, transactionCount: 2 } } } } };
  assert.match(districtSentences(entry, thin, "ko").join(" "), /서울 평균 표본 12건에는 한 단지·한 계약일 10건이 들어 있어, 빼면 2건이라 값을 내지 않습니다\./);
});

// #862 pm 판정: 11-04 값으로 서울 전세가율은 62.3%이고 313행을 빼면 58.9%라 구 비교 문장의 방향이 갈린다. 어느 쪽이 맞는지 모르므로 쏠림 날에는 서울 비교를 내지 않는다.
const RATIO_PLAIN_KO = "전세가율은 53.7%로 서울 평균 62.3%보다 낮은 편이고, 2개 구를 전세가율 순으로 세우면 가장 높고 바로 아래는 강남구입니다(이 구 매매 435건·전세 200건, 서울 전체 매매 754건·전세 427건 기준).";
const RATIO_PLAIN_EN = "The jeonse ratio is 53.7%, below the Seoul average of 62.3%, the highest of 2 districts with the next one down being 강남구 (based on 435 sales and 200 jeonse here, 754 and 427 citywide).";
const ratioLine = (data, locale) => districtSentences(data.districts[0], data, locale).find((s) => s.startsWith(locale === "en" ? "The jeonse ratio" : "전세가율은"));

test("쏠림 날 구 장 전세가율 문장: 서울 비교와 서울 건수가 빠지고 구 값·구 순서는 남는다 - 국·영, 도착·계약", () => {
  for (const [window, unit] of [[ARRIVAL, "filings"], [CONTRACT, "deals"]]) {
    const data = dashboard(window);
    assert.equal(ratioLine(data, "ko"), "전세가율은 53.7%로, 2개 구를 전세가율 순으로 세우면 가장 높고 바로 아래는 강남구입니다(이 구 매매 435건·전세 200건 기준).");
    assert.equal(ratioLine(data, "en"), "The jeonse ratio is 53.7%, the highest of 2 districts with the next one down being 강남구 (based on 435 sales and 200 jeonse).");
    // 첫 문장의 비교와 단서는 그대로다 - 빠지는 것은 전세가율 비교뿐이다.
    const all = districtSentences(data.districts[0], data, "en").join(" ");
    assert.match(all, /0\.9× the Seoul average/);
    assert.match(all, new RegExp(`The Seoul sample of 754 ${unit} includes 313`));
  }
});

test("쏠림이 아닌 날의 전세가율 문장은 전과 같다 - 쏠림 없음, 기준일에만 걸린 날", () => {
  const data = dashboard();
  const plain = { ...data, overall: { ...data.overall, sale: { avgPricePerPyeong10k: 5126, transactionCount: 754 } } };
  assert.equal(ratioLine(plain, "ko"), RATIO_PLAIN_KO);
  assert.equal(ratioLine(plain, "en"), RATIO_PLAIN_EN);
  const held = { ...data, overall: { ...data.overall, sale: attach({ avgPricePerPyeong10k: 5126, transactionCount: 754 }, ARRIVAL, baselineWith("2026-11-03")).sale } };
  assert.equal(held.overall.sale.changeWithheld.reason, "baseline-concentration", "전제: 기준일에만 걸렸다");
  assert.equal(ratioLine(held, "ko"), RATIO_PLAIN_KO);
  assert.equal(ratioLine(held, "en"), RATIO_PLAIN_EN);
});

// #862 pm 최종 판정: 전세 장 요약 카드는 값 하나를 보여 주는 칸이라 62.3%를 유지하고 건수 줄에 두 값을 함께 밝힌다. 표 서울 줄은 칸 모양을 바꾸지 않는다.
const ratioCard = (cards) => cards.find((c) => c.label === "전세가율");
const flatSegs = (segs) => (segs ?? []).map((s) => s.text).join("");
const RATIO_NOTE_KO = "매매 754건 · 전세 427건 · 매매 표본에 한 단지·한 계약일 313건이 들어 있어, 빼면 58.9%";
const RATIO_NOTE_EN = "the sale sample includes 313 from one complex on one contract date; without them 58.9%";

test("전세 장 요약 카드: 값은 그대로이고 건수 줄에 뺀 값을 더한다 - 구운 쪽과 화면 쪽, 국·영", async () => {
  const data = dashboard();
  const card = ratioCard(overallCards(data, "jeonse"));
  assert.equal(flatSegs(card.value), "62.3%", "값은 유지한다");
  assert.equal(flatSegs(card.sub), RATIO_NOTE_KO);
  assert.ok(realestateOverallHtml(data, "jeonse").includes(RATIO_NOTE_KO));
  for (const [locale, text] of [["ko", RATIO_NOTE_KO], ["en", RATIO_NOTE_EN]]) {
    const page = await loadRealestatePage({ realestate: data, locale, kind: "jeonse", file: `${SITE}/realestate.html` });
    const html = String(page.byId("overall-cards").innerHTML);
    assert.ok(html.includes(text), `${locale}: ${html}`);
    assert.ok(html.includes(">62.3%<"), `${locale}: 값`);
  }
});

test("전세 장 요약 카드: 뺀 쪽 값이 없으면 숫자 없이 단서만 적는다", async () => {
  const data = dashboard();
  const thinSale = { avgPricePerPyeong10k: 5126, transactionCount: 12, concentration: { rows: 10, share: 10 / 12, without: { avgPricePerPyeong10k: null, transactionCount: 2 } } };
  const thin = { ...data, overall: { ...data.overall, sale: attach(thinSale, ARRIVAL).sale } };
  const sub = flatSegs(ratioCard(overallCards(thin, "jeonse")).sub);
  assert.equal(sub, "매매 12건 · 전세 427건 · 매매 표본에 한 단지·한 계약일 10건이 들어 있습니다");
  const page = await loadRealestatePage({ realestate: thin, locale: "en", kind: "jeonse", file: `${SITE}/realestate.html` });
  const html = String(page.byId("overall-cards").innerHTML);
  assert.ok(html.includes("the sale sample includes 10 from one complex on one contract date<"), html);
  assert.doesNotMatch(html, /without them/);
});

test("전세 장 요약 카드: 쏠림이 아닌 날과 기준일에만 걸린 날은 전과 같고, 표 서울 줄은 쏠림 날에도 칸 모양이 같다", async () => {
  const data = dashboard();
  const plain = { ...data, overall: { ...data.overall, sale: { avgPricePerPyeong10k: 5126, transactionCount: 754 } } };
  const held = { ...data, overall: { ...data.overall, sale: attach({ avgPricePerPyeong10k: 5126, transactionCount: 754 }, ARRIVAL, baselineWith("2026-11-03")).sale } };
  for (const day of [plain, held]) {
    assert.equal(flatSegs(ratioCard(overallCards(day, "jeonse")).sub), "매매 754건 · 전세 427건");
    const page = await loadRealestatePage({ realestate: day, kind: "jeonse", file: `${SITE}/realestate.html` });
    assert.ok(String(page.byId("overall-cards").innerHTML).includes(">매매 754건 · 전세 427건<"));
  }
  assert.equal(realestateTableHtml(data, "jeonse"), realestateTableHtml(plain, "jeonse"), "표 서울 줄은 그대로다");
});

test("문구에 값 단정·단지명·권유로 읽히는 말이 없다 - 칸·칩·문장, 국·영", () => {
  const banned = [APT, "오염", "왜곡", "정상", "진짜", "correct", "distort", "real price", "상승", "오를", "매수", "보장", "저평가", "기회", "rise", "undervalued", "buy now", "guarantee"];
  for (const window of [ARRIVAL, CONTRACT]) {
    const data = dashboard(window);
    const stats = buildRealestateStats(data);
    const texts = [
      JSON.stringify(data.overall.sale.changeWithheld.text),
      stats[0].note,
      stats[0].noteEn,
      ...districtSentences(data.districts[0], data, "ko").filter((s) => s.includes("한 단지")),
      ...districtSentences(data.districts[0], data, "en").filter((s) => s.includes("one complex")),
    ];
    for (const text of texts) for (const word of banned) assert.ok(!text.toLowerCase().includes(word.toLowerCase()), `${word}: ${text}`);
  }
});
