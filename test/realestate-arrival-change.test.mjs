// #862 2·3단계 - 서울·자치구 어느 값에도 7일 증감을 싣지 않는다. 신고 기준 날(서울 pm 11-15, 구 data-analyst 11-17 판정)도, 계약 기준으로 물러난 날(pm 11-15,
// #862 issuecomment-6890869728)도 같다. 매매가 한 단지·한 계약일로 쏠린 줄에는 「증감 보류」 없이 단서(건수·뺀 값)만 둔다 - 구 줄도 서울과 같은 문턱(isConcentrated)이다.
// 입력은 전부 고정이다 - 오늘 data 값에 기대지 않는다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachChanges, findBaseline } from "../scripts/realestate-metrics.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { representativeDistricts } from "../scripts/build-realestate.ts";
import { buildRealestateStats, metricEntry } from "../scripts/news-context.ts";
import { metricCell } from "../scripts/realestate-rows.ts";
import { overallCards } from "../scripts/realestate-overall.ts";
import { realestateTable } from "../scripts/realestate-table.ts";
import { barRows } from "../scripts/district-bars.ts";
import { realestateHtml, realestateOverallHtml, realestateTableHtml } from "../scripts/prerender.ts";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

const ARRIVAL = { basis: "arrival", from: "2026-11-09", to: "2026-11-15", until: "2026-11-16", weeks: 1, districtFrom: "2026-10-19", districtWeeks: 4 };
const CONTRACT = { basis: "contract", from: "2026-10-12", to: "2026-11-08", until: "2026-11-09", weeks: 4, districtFrom: "2026-10-12", districtWeeks: 4 };
// 10-19 형태: 계약 기준으로 물러난 날, 직전 기록(10-12)은 신고 기준이었다.
const CONTRACT_1019 = { basis: "contract", from: "2026-09-21", to: "2026-10-18", until: "2026-10-19", weeks: 4, districtFrom: "2026-09-21", districtWeeks: 4 };

const metrics = (count, price) => ({
  sale: { avgPricePerM2: price * 3000, avgPricePerPyeong10k: price, transactionCount: count },
  saleNational84: { avgPricePerPyeong10k: price, transactionCount: count },
  jeonse: { avgDepositPerM2: price * 1800, avgDepositPerPyeong10k: Math.round(price * 0.6), transactionCount: count },
  wolse: { avgConvertedPerPyeong10k: price, avgDeposit10k: 20000, avgMonthlyRent10k: 90, transactionCount: count },
});
const KINDS = ["sale", "saleNational84", "jeonse", "wolse"];
const district = (code, name, count, price, extra = {}) => ({ code, name, ...metrics(count, price), ...extra });
const noFields = (out, label) => {
  for (const [scope, entry] of [["서울", out.overall], ...out.districts.map((d) => [d.name, d])]) {
    for (const kind of KINDS) {
      assert.deepEqual([entry[kind]?.change, entry[kind]?.baselineDate], [undefined, undefined], `${label} ${scope} ${kind}`);
      if (kind !== "sale" || !entry.sale?.concentration) assert.equal(entry[kind]?.changeWithheld, undefined, `${label} ${scope} ${kind}`);
    }
  }
};

test("신고 기준 날: 건수가 문턱(서울 100·구 20) 이상이어도 서울·구 네 종류 모두 증감·기준일·#290 보류가 없다", () => {
  const out = attachChanges(metrics(1078, 5100), [district("11230", "동대문구", 435, 4652), district("11680", "강남구", 310, 9100)], ARRIVAL);
  for (const [scope, entry] of [["서울", out.overall], ...out.districts.map((d) => [d.name, d])]) {
    for (const kind of KINDS) {
      assert.deepEqual([entry[kind].change, entry[kind].baselineDate, entry[kind].changeWithheld], [undefined, undefined, undefined], `${scope} ${kind}`);
    }
  }
  assert.equal(out.overall.sale.avgPricePerPyeong10k, 5100, "값은 그대로다");
  // 표본이 얇은 날도 #290 문구(「증감 보류 — …」)가 없다 - 낼 증감이 없다.
  const thin = attachChanges(metrics(30, 5100), [district("11680", "강남구", 8, 9100)], ARRIVAL);
  assert.equal(thin.overall.sale.changeWithheld, undefined);
  assert.equal(thin.districts[0].sale.changeWithheld, undefined);
});

test("지난번 값으로 채운 구(carryForward)의 옛 증감·보류도 신고 기준 날에는 걷는다", () => {
  const carried = district("11680", "강남구", 310, 9100, { staleAt: "2026-11-14T03:00:00.000Z" });
  carried.sale = { ...carried.sale, change: { value10k: 100, percent: 1.1 }, baselineDate: "2026-11-07" };
  carried.jeonse = { ...carried.jeonse, changeWithheld: { current: 10, baseline: 30, min: 20 } };
  const [out] = attachChanges(metrics(1078, 5100), [carried], ARRIVAL).districts;
  assert.deepEqual([out.sale.change, out.sale.baselineDate, out.jeonse.changeWithheld], [undefined, undefined, undefined]);
  assert.equal(out.staleAt, "2026-11-14T03:00:00.000Z", "낡음 표시는 남는다");
});

// 바꾼 단언(#862 3단계): 예전에는 계약 기준 날이 판정 밖이라 서울·구 증감이 그대로였다. 이제 10-19 형태(계약 기준 날, 직전 기록은 신고 기준 10-12)도 증감이 0개다.
test("10-19 형태: 계약 기준 날의 기준 기록이 신고 기준이어도 서울·25개 구 네 종류 모두 증감·기준일·보류가 없다", () => {
  const history = [{ date: "2026-10-12", window: { basis: "arrival" }, overall: metrics(23, 6476), districts: DISTRICTS.map((d) => district(d.code, d.name, 40, 5000)) }];
  assert.equal(findBaseline(history, new Date("2026-10-19T03:00:00Z")).date, "2026-10-12", "전제: 예전 빌드라면 이 기록과 견줬다");
  const out = attachChanges(metrics(3042, 4914), DISTRICTS.map((d) => district(d.code, d.name, 120, 5100)), CONTRACT_1019);
  assert.equal(out.districts.length, 25);
  noFields(out, "10-19");
  assert.equal(out.overall.sale.avgPricePerPyeong10k, 4914, "값은 그대로다");
});

// 11-15 형태: 동대문(313/435)·성북(29/180)·도봉(29/220)이 쏠림, 강남은 아니다. 값은 고정 입력이다.
const CONC = {
  "11230": { rows: 313, share: 0.7195, without: { avgPricePerPyeong10k: 4536, transactionCount: 122 } },
  "11290": { rows: 29, share: 0.1611, without: { avgPricePerPyeong10k: 3600, transactionCount: 151 } },
  "11320": { rows: 29, share: 0.1318, without: { avgPricePerPyeong10k: 2900, transactionCount: 191 } },
};
const raw = [
  district("11230", "동대문구", 435, 4652),
  district("11290", "성북구", 180, 3620),
  district("11320", "도봉구", 220, 2880),
  district("11680", "강남구", 310, 9100),
].map((d) => (CONC[d.code] ? { ...d, sale: { ...d.sale, concentration: CONC[d.code] } } : d));
const data = (window = ARRIVAL) => ({
  updatedAt: "2026-11-15T03:00:00.000Z",
  window,
  ...attachChanges(metrics(1078, 5100), raw, window),
});
const CLUE = {
  동대문구: ["435건 · 한 단지·한 계약일 313건을 빼면 4,536만원(122건)", "435 filings · excluding 313 from one complex on one contract date: ₩45.4M (122 filings)"],
  성북구: ["180건 · 한 단지·한 계약일 29건을 빼면 3,600만원(151건)", "180 filings · excluding 29 from one complex on one contract date: ₩36M (151 filings)"],
  도봉구: ["220건 · 한 단지·한 계약일 29건을 빼면 2,900만원(191건)", "220 filings · excluding 29 from one complex on one contract date: ₩29M (191 filings)"],
};
const DETAIL = (name) => CLUE[name][0].replace(/^[\d,]+건 · /, "");
// 계약 기준 날은 같은 단서의 영어 건수 단위만 deals 다.
const clueOf = (window, name, i) => (i === 1 && window.basis === "contract" ? CLUE[name][1].replaceAll("filings", "deals") : CLUE[name][i]);
const NO_CHANGE = [/대비/, /\bvs\b/, /증감 보류/, /change withheld/, /class="change /, /▲|▼/];
const noChange = (html, where) => {
  for (const re of NO_CHANGE) assert.doesNotMatch(String(html), re, `${where}: ${re}`);
};

test("구 줄 쏠림 단서: 빌드 데이터에 REASON_NOTE 문구가 붙고 「증감 보류」는 없다, 쏠림 아닌 구는 그대로다 - 신고·계약 기준", () => {
  for (const window of [ARRIVAL, CONTRACT]) {
    for (const d of data(window).districts) {
      if (CLUE[d.name]) {
        assert.equal(d.sale.changeWithheld.reason, "concentration-note", d.name);
        assert.equal(d.sale.changeWithheld.text.ko.cell, clueOf(window, d.name, 0));
        assert.equal(d.sale.changeWithheld.text.en.cell, clueOf(window, d.name, 1));
      } else assert.equal(d.sale.changeWithheld, undefined, d.name);
      assert.equal(d.jeonse.changeWithheld, undefined, "전세·월세에는 단서가 없다");
    }
  }
});

// 11-16 형태(#862 3단계, cto 후속): 계약 기준으로 물러난 날, 기준이 될 11-09 기록은 서울 쏠림이 참이고 구 셋이 쏠림이다. 예전 빌드는 이 기록과 견줘
// 서울을 보류하고 구 증감을 그대로 냈다. 이제는 서울·25개 구 어디에도 증감·기준일·보류가 없고, 쏠린 줄에는 「증감 보류」 없는 단서만 남는다.
test("11-16 형태: 계약 기준 날, 기준 11-09 가 쏠림이어도 서울·25개 구 네 종류 모두 증감이 없고 쏠림 줄은 단서만 있다", async () => {
  const seoulConc = { rows: 313, share: 0.2903, without: { avgPricePerPyeong10k: 5422, transactionCount: 765 } };
  const concentrated = (entry) => (CONC[entry.code] ? { ...entry, sale: { ...entry.sale, concentration: CONC[entry.code] } } : entry);
  const all = DISTRICTS.map((d) => concentrated(district(d.code, d.name, 120, 5100)));
  const seoul = { ...metrics(1078, 5126), sale: { ...metrics(1078, 5126).sale, concentration: seoulConc } };
  const history = [{ date: "2026-11-09", window: CONTRACT, overall: seoul, districts: DISTRICTS.map((d) => concentrated(district(d.code, d.name, 110, 5000))) }];
  assert.equal(findBaseline(history, new Date("2026-11-16T03:00:00Z")).date, "2026-11-09", "전제: 예전 빌드라면 이 기록과 견줬다");
  // 지난번 값으로 채운 구는 11-09 의 옛 증감을 들고 온다 - 그것도 걷는다.
  all[0] = { ...all[0], staleAt: "2026-11-09T03:00:00.000Z", sale: { ...all[0].sale, change: { value10k: 100, percent: 2 }, baselineDate: "2026-11-02" } };
  const out = attachChanges(seoul, all, CONTRACT);
  assert.equal(out.districts.length, 25);
  noFields(out, "11-16");
  assert.equal(out.overall.sale.changeWithheld.reason, "concentration-note");
  assert.equal(out.overall.sale.changeWithheld.text.ko.cell, "1,078건 · 한 단지·한 계약일 313건을 빼면 5,422만원(765건)");
  for (const d of out.districts) {
    if (CONC[d.code]) {
      assert.equal(d.sale.changeWithheld.reason, "concentration-note", d.name);
      assert.deepEqual(Object.keys(d.sale.changeWithheld), ["reason", "text"], d.name);
    } else assert.equal(d.sale.changeWithheld, undefined, d.name);
  }
  assert.doesNotMatch(JSON.stringify(out), /증감 보류|change withheld/);
  // 빌드는 기준 기록을 넘기지 않는다 - 증감을 다시 싣는 것은 새 이슈의 몫이다(pm 11-15).
  const build = await readFile(path.resolve(import.meta.dirname, "../scripts/build-realestate.ts"), "utf8");
  assert.match(build, /attachChanges\(overall, districts, window\)/);
  assert.doesNotMatch(build, /findBaseline/);
});

test("구운 표·첫 화면·막대·칩: 신고·계약 기준 날 모두 증감 문자열이 없고 쏠린 구 줄에만 단서가 있다", async () => {
  for (const window of [ARRIVAL, CONTRACT]) await bakedScan(window);
});

async function bakedScan(window) {
  const d = data(window);
  // 시세 장 표(전 종류·매매)와 구운 첫 화면.
  for (const kind of [null, "sale"]) {
    const html = realestateTableHtml(d, kind);
    noChange(html, `표 ${kind}`);
    for (const name of Object.keys(CLUE)) assert.ok(html.includes(CLUE[name][0]), `표 ${kind} ${name}`);
    const rows = realestateTable(d, kind).rows;
    assert.ok(!rows.find((r) => r.name.text === "강남구").cells.some((c) => c.parts.some((p) => p.text.includes("한 단지"))), "강남구 줄");
  }
  const home = realestateHtml(d);
  noChange(home, "첫 화면");
  for (const name of Object.keys(CLUE)) assert.equal(metricCell("sale", d.districts.find((x) => x.name === name).sale).count, CLUE[name][0], name);
  // 집 지도 막대.
  for (const kind of ["sale", "jeonse", "wolse"]) assert.ok(barRows(d, kind).every((r) => r.change === null), `막대 ${kind}`);
  // 뉴스 칩(서울 카드·구 칩), 국·영.
  for (const chip of buildRealestateStats(d)) {
    noChange(chip.note, chip.label);
    noChange(chip.noteEn, chip.labelEn);
  }
  for (const name of Object.keys(CLUE)) {
    const entry = d.districts.find((x) => x.name === name);
    const chip = metricEntry(entry, "sale", { name, nameEn: name, window: d.window, district: true });
    noChange(chip.note, name);
    noChange(chip.noteEn, name);
    assert.match(chip.note, /한 단지·한 계약일 \d+건을 빼면/, name);
  }
  const plainChip = metricEntry(d.districts.find((x) => x.name === "강남구"), "jeonse", { name: "강남구", nameEn: "Gangnam", window: d.window, district: true });
  assert.equal(plainChip.note, window.basis === "arrival" ? "전 면적 평균 · 10/19~11/15 들어온 신고 310건" : "전 면적 평균 · 최근 4주 계약 310건");
}

test("화면 JS: 첫 화면과 시세 장·구 장 틀이 구운 쪽과 같은 단서를 그리고 증감을 그리지 않는다 - 국·영, 신고·계약 기준", async () => {
  for (const window of [ARRIVAL, CONTRACT]) {
    const d = data(window);
    for (const [lang, i] of [["ko", 0], ["en", 1]]) {
      const index = await loadIndexPage({ storage: { lang }, fetch: async () => ({ ok: true, json: async () => d }) });
      await new Promise((r) => setTimeout(r, 20));
      const grid = String(index.byId("realestate-grid").innerHTML);
      noChange(grid, `첫 화면 ${lang}`);
      for (const name of Object.keys(CLUE)) assert.ok(grid.includes(`<span class="tx-count">${clueOf(window, name, i)}</span>`), `첫 화면 ${lang} ${name}`);
      for (const kind of [null, "sale"]) {
        const page = await loadRealestatePage({ realestate: d, locale: lang, kind, file: "scripts/realestate-template.html" });
        const table = String(page.byId("district-grid").innerHTML);
        noChange(table, `시세 장 ${lang} ${kind}`);
        for (const name of Object.keys(CLUE)) assert.ok(table.includes(clueOf(window, name, i)), `시세 장 ${lang} ${kind} ${name}`);
      }
    }
  }
});

test("구 장: 세 줄 표와 건수 카드에 단서가 붙고(구운 쪽·틀 같음) 쏠림 아닌 구는 전과 같다", async () => {
  const d = data();
  for (const name of ["동대문구", "강남구"]) {
    const table = realestateTableHtml(d, null, name);
    const cards = realestateOverallHtml(d, null, name);
    noChange(table, `${name} 표`);
    const page = await loadRealestatePage({ realestate: d, district: name, file: "scripts/realestate-template.html" });
    assert.equal(String(page.tableHtml()), table, `${name} 표: 틀 = 구운 쪽`);
    assert.equal(String(page.overallHtml()), cards, `${name} 카드: 틀 = 구운 쪽`);
    if (name === "동대문구") {
      assert.ok(table.includes(CLUE[name][0]), table);
      const count = overallCards(d, null, name).find((c) => c.label === "거래 건수");
      assert.equal(count.sub.map((s) => s.text).join(""), DETAIL(name));
    } else {
      assert.doesNotMatch(table + cards, /한 단지/);
    }
  }
});

// 빌드: 구 4주 표본에서 가장 큰 한 단지·한 계약일 묶음이 그 구 표본의 5% 이상이면서 10행 이상이면 `sale.concentration` 이 붙는다(서울과 같은 isConcentrated).
const deal = (aptNm, day, amount = "50,000") => ({ aptNm, umdNm: "장안동", dealYear: 2026, dealMonth: 10, dealDay: day, dealAmount: amount, excluUseAr: 60, cdealType: "", cdealDay: "" });
const rowsOf = (list) => list.map((item) => ({ item, date: "2026-11-03" }));
const others = (n, tag) => Array.from({ length: n }, (_, i) => deal(`${tag}${i}`, 1, "60,000"));

test("빌드: 구 표본마다 따로 판정한다 - 20행 묶음은 200행 구에서 발동, 9행 묶음은 행 하한에 걸려 유지", () => {
  const items = new Map([
    ["sale:11230", rowsOf([...Array.from({ length: 20 }, () => deal("묶음단지", 8)), ...others(180, "동")])],
    ["sale:11680", rowsOf([...Array.from({ length: 9 }, () => deal("작은묶음", 8)), ...others(41, "강")])],
  ]);
  const [ddm, gn] = representativeDistricts(items);
  assert.deepEqual(ddm.sale.concentration, { rows: 20, share: 0.1, without: { avgPricePerPyeong10k: ddm.sale.concentration.without.avgPricePerPyeong10k, transactionCount: 180 } });
  assert.ok(ddm.sale.concentration.without.avgPricePerPyeong10k > ddm.sale.avgPricePerPyeong10k, "뺀 값은 묶음(5억)을 뺀 6억 행들의 값이다");
  assert.equal(gn.sale.concentration, undefined);
  assert.doesNotMatch(JSON.stringify([ddm, gn]), /묶음단지|작은묶음|장안동/, "단지명·동은 기록에 남지 않는다");
});
