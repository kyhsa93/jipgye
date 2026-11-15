// #862 조건 4 - 예전에는 비교 기준일의 표본이 한 단지·한 계약일 행으로 차 있으면 계약 기준 날 서울 매매 증감을 보류했다(기준일 11-03~11-08 목록 + 기록의 발동 정보).
// 3단계(pm 11-15, #862 issuecomment-6890869728)부터 계약 기준 날에도 7일 증감을 싣지 않으므로 이 보류는 없어졌다. 이 파일은 같은 날짜들(기준일이 걸리던 날·
// 기록이 빠진 날·자정 경계)에서 증감도 보류 문구도 나가지 않는지를 본다 - 바꾼 단언은 각 시험 위에 적는다. findBaseline 은 「예전이라면 무엇과 견줬나」의 전제로만 쓴다.
// 입력은 전부 고정이다 - 오늘 data 값에 기대지 않는다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachChanges, findBaseline } from "../scripts/realestate-metrics.ts";
import * as concentrationModule from "../scripts/realestate-concentration.ts";
import { buildRealestateStats } from "../scripts/news-context.ts";
import { metricCell, withheldOf } from "../scripts/realestate-rows.ts";
import { realestateTable } from "../scripts/realestate-table.ts";
import { realestateHtml, realestateTableHtml } from "../scripts/prerender.ts";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

const root = path.resolve(import.meta.dirname, "..");

const metrics = (count, price) => ({
  sale: { avgPricePerPyeong10k: price, transactionCount: count },
  saleNational84: { avgPricePerPyeong10k: price, transactionCount: count },
  jeonse: { avgDepositPerPyeong10k: price, transactionCount: count },
  wolse: { avgConvertedPerPyeong10k: price, avgDeposit10k: 20000, avgMonthlyRent10k: 90, transactionCount: count },
});
const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, "0")}`);
const record = (date, overall = metrics(500, 5000)) => ({ date, overall, districts: [] });
const HISTORY = days(1, 16).map((date) => record(date));

const ARRIVAL = { basis: "arrival", from: "2026-11-09", to: "2026-11-10", until: "2026-11-16", weeks: 1, districtFrom: "2026-10-19", districtWeeks: 4 };
const CONTRACT = { basis: "contract", from: "2026-09-14", to: "2026-10-11", until: "2026-10-12", weeks: 4, districtFrom: "2026-09-14", districtWeeks: 4 };

// now 는 `날짜T03:00:00Z`(KST 정오)다 - 하루 수집 시각과 같은 쪽이고 자정 경계는 따로 본다.
const run = (now, history = HISTORY, window = CONTRACT) => {
  const at = new Date(now);
  const baseline = findBaseline(history.filter((h) => h.date < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(at)), at);
  return { baseline, ...attachChanges(metrics(500, 5100), [], window) };
};
const at = (date) => `${date}T03:00:00Z`;

const KINDS = ["sale", "saleNational84", "jeonse", "wolse"];
const none = (entry, label) => {
  for (const kind of KINDS) assert.deepEqual([entry[kind].change, entry[kind].baselineDate, entry[kind].changeWithheld], [undefined, undefined, undefined], `${label} ${kind}`);
};

// 바꾼 단언(#862 3단계): 예전에는 CONCENTRATED_BASELINE_DATES 가 11-03~11-08 엿새였다. 기준일 보류가 없어지며 목록·판정·문구를 함께 지웠다.
test("기준일 보류 목록·판정·문구는 더 내보내지 않는다", () => {
  for (const name of ["CONCENTRATED_BASELINE_DATES", "isConcentratedBaseline", "baselineHeldText", "REASON_CURRENT", "REASON_BASELINE"]) {
    assert.equal(Object.hasOwn(concentrationModule, name), false, name);
  }
  assert.equal(concentrationModule.REASON_NOTE, "concentration-note", "단서 칸은 남는다");
});

// 바꾼 단언: 예전에는 기준 11-02 와 견준 +2.0% 증감이 있었다.
test("11-09 는 기준 11-02 가 있어도 계약 기준 날이라 증감이 없다", () => {
  const { baseline, overall } = run(at("2026-11-09"));
  assert.equal(baseline.date, "2026-11-02", "전제");
  none(overall, "11-09");
});

// 바꾼 단언: 예전에는 서울 매매만 보류(baseline-concentration)이고 84㎡·전세·월세는 +2.0% 증감이 있었다.
test("11-10~11-15 는 기준 11-03~11-08 이어도 서울 네 종류 모두 증감도 보류 문구도 없다", () => {
  for (const [i, date] of days(10, 15).entries()) {
    const { baseline, overall } = run(at(date));
    assert.equal(baseline.date, days(3, 8)[i], date);
    none(overall, date);
    assert.equal(overall.sale.avgPricePerPyeong10k, 5100, "값은 그대로다");
  }
});

// 바꾼 단언: 예전에는 기준 11-09 와 견준 증감이 있었다 - 11-16 이 이번 일의 기한이 된 날이다.
test("11-16 은 기준 11-09 가 있어도 증감이 없다", () => {
  const { baseline, overall } = run(at("2026-11-16"));
  assert.equal(baseline.date, "2026-11-09", "전제");
  none(overall, "11-16");
});

// 바꾼 단언: 예전에는 11-09 기록이 없으면 11-16 이 보류, 11-03 기록이 없으면 11-10 이 증감 있음이었다.
test("기록이 빠져 기준일이 바뀌어도 결과가 같다: 11-16(기준 11-08)·11-10(기준 11-02) 모두 증감·보류 없음", () => {
  const without = (date) => HISTORY.filter((h) => h.date !== date);
  const noNinth = run(at("2026-11-16"), without("2026-11-09"));
  assert.equal(noNinth.baseline.date, "2026-11-08");
  none(noNinth.overall, "11-16");
  const noThird = run(at("2026-11-10"), without("2026-11-03"));
  assert.equal(noThird.baseline.date, "2026-11-02");
  none(noThird.overall, "11-10");
});

// 바꾼 단언: 예전에는 #290 보류 {current 500, baseline 36, min 100} 과 「증감 보류 — 비교 주 표본 부족(36건)」이었다.
test("11-09 기준 11-02 가 36건이어도 #290 보류 문구가 없다 - 낼 증감이 없다", () => {
  const thin = HISTORY.map((h) => (h.date === "2026-11-02" ? record(h.date, metrics(36, 5000)) : h));
  const { overall } = run(at("2026-11-09"), thin);
  none(overall, "11-09");
  assert.equal(withheldOf(overall.sale), null);
});

// 바꾼 단언: 예전에는 기준 11-03 으로 보류(baseline-concentration)였다.
test("자정 경계: 11-10 00:30 KST 는 11-10 이라 기준 11-03 이지만 증감·보류가 없다", () => {
  const { baseline, overall } = run("2026-11-09T15:30:00Z");
  assert.equal(baseline.date, "2026-11-03");
  none(overall, "11-10");
});

// 바꾼 단언: 예전에는 기준 기록의 발동 정보로 서울 매매를 보류하고 전세 증감은 냈다.
test("목록 밖의 새 날도 기준 기록에 발동 정보가 있든 없든 증감·보류가 없다", () => {
  const flagged = { ...metrics(500, 5000), sale: { ...metrics(500, 5000).sale, concentration: { rows: 60, share: 0.12, without: { avgPricePerPyeong10k: 4900, transactionCount: 440 } } } };
  const { baseline, overall } = run(at("2026-12-20"), [record("2026-12-13", flagged)]);
  assert.equal(baseline.date, "2026-12-13", "전제");
  none(overall, "12-20");
});

// 바꾼 단언: 예전에는 계약 기준 날 자치구 매매 증감이 그대로 나갔다.
test("자치구도 계약 기준 날 증감·보류가 없다(신고 기준 날과 같다)", () => {
  const { districts } = attachChanges(metrics(500, 5100), [{ code: "1", name: "a", ...metrics(50, 5100) }], CONTRACT);
  none(districts[0], "구");
});

test("신고 기준 날은 기준일이 걸려도 보류 문구가 없다 - 증감이 원래 없고 칩은 기간과 건수만 적는다", () => {
  const { overall } = run(at("2026-11-10"), HISTORY, ARRIVAL);
  for (const kind of ["sale", "saleNational84", "jeonse", "wolse"]) {
    assert.deepEqual([overall[kind].change, overall[kind].baselineDate, overall[kind].changeWithheld], [undefined, undefined, undefined], kind);
  }
  const stats = buildRealestateStats({ window: ARRIVAL, overall });
  assert.equal(stats[0].note, "전 면적 평균 · 11/9~11/10 들어온 신고 500건");
  assert.equal(stats[0].noteEn, "All-size average · 500 filings arrived Nov 9–10");
  assert.doesNotMatch(stats[1].note, /대비/, "전세 칩에도 증감이 없다");
});

// 바꾼 단언: 예전 칸은 「500건 · 증감 보류 — 11/3 표본에 …」, 칩은 「… 500건 · 증감 보류」였다.
test("문구: 계약 기준 날 칩은 최근 4주 계약 건수만 적고(영어 단위 deals) 보류 조각이 없다", () => {
  const { overall } = run(at("2026-11-10"), HISTORY, CONTRACT);
  assert.equal(overall.sale.changeWithheld, undefined);
  const [sale] = buildRealestateStats({ window: CONTRACT, overall });
  assert.equal(sale.note, "전 면적 평균 · 최근 4주 계약 500건");
  assert.equal(sale.noteEn, "All-size average · 500 deals in the last 4 weeks");
});

const held = () => {
  const { overall } = run(at("2026-11-10"));
  return {
    updatedAt: "2026-11-10T03:00:00.000Z",
    window: CONTRACT,
    overall,
    districts: [{ code: "11680", name: "강남구", ...metrics(50, 9000) }],
  };
};
// 바꾼 단언(#862 3단계): 예전 서울 칸은 「500건 · 증감 보류 — 11/3 표본에 한 단지·한 계약일 행이 5% 이상」(영어 「500 deals · change withheld — …」)이었다.
// 이제 같은 날(계약 기준, 기준일 11-03) 서울 칸은 건수만이고, 구운 쪽·화면 JS 어디에도 증감·보류 글자가 없다.
const CELL = "500건";
// 영어 건수 칸은 장마다 단위가 다르다(첫 화면 「500 txns」, 시세 장 「500」) - 칸 끝에서 건수만 맞춘다.
const CELL_EN_HOME = '<span class="tx-count">500 txns</span>';
const CELL_EN_TABLE = '<span class="count">500</span>';
const NO_CHANGE = [/대비/, /\bvs\b/, /증감 보류/, /change withheld/i, /class="change /, /▲|▼/];
const noChange = (html, where) => {
  for (const re of NO_CHANGE) assert.doesNotMatch(String(html), re, `${where}: ${re}`);
};

test("구운 첫 화면 칸과 화면 JS 칸: 기준일이 걸리던 계약 기준 날 서울 칸은 건수만이고 증감·보류가 없다", async () => {
  const data = held();
  assert.equal(withheldOf(data.overall.sale), null);
  assert.deepEqual(metricCell("sale", data.overall.sale, true), { type: "value", text: "5,100만원", change: null, count: CELL });
  const [overallRow] = realestateHtml(data).split("</tr>");
  assert.ok(overallRow.includes(`<span class="count">${CELL}</span>`));
  noChange(realestateHtml(data), "구운 첫 화면");
  const grid = async (lang) => {
    const page = await loadIndexPage({ storage: { lang }, fetch: async () => ({ ok: true, json: async () => data }) });
    await new Promise((r) => setTimeout(r, 20));
    return String(page.byId("realestate-grid").innerHTML);
  };
  const ko = await grid("ko");
  assert.ok(ko.split("</tr>")[0].includes(`<span class="tx-count">${CELL}</span>`), ko);
  noChange(ko, "첫 화면 ko");
  const en = await grid("en");
  assert.ok(en.split("</tr>")[0].includes(CELL_EN_HOME), en);
  noChange(en, "첫 화면 en");
});

test("시세 장 표: 구운 줄과 틀의 화면 JS 가 계약 기준 날 증감·보류 없이 건수만 그린다 - 전 종류 표와 매매 표", async () => {
  const data = held();
  const parts = (kind) => realestateTable(data, kind).rows[0].cells.flatMap((c) => c.parts);
  for (const kind of [null, "sale"]) {
    assert.ok(parts(kind).some((p) => p.type === "count" && p.text === CELL), `구운 ${kind}`);
    assert.ok(!parts(kind).some((p) => p.type === "change"), `구운 ${kind}: 증감 조각`);
    noChange(realestateTableHtml(data, kind), `구운 표 ${kind}`);
  }
  for (const [kind, locale, text] of [[null, "ko", `<span class="count">${CELL}</span>`], ["sale", "ko", `<span class="count">${CELL}</span>`], [null, "en", CELL_EN_TABLE], ["sale", "en", CELL_EN_TABLE]]) {
    const page = await loadRealestatePage({ realestate: data, kind, locale, file: "scripts/realestate-template.html" });
    const html = String(page.byId("district-grid").innerHTML);
    assert.ok(html.split("</tr>")[0].includes(text), `${kind} ${locale}: ${html}`);
    noChange(html, `시세 장 ${kind} ${locale}`);
  }
});

test("낡은 realestate.json(reason 없음)은 예전과 같은 칸이다", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  assert.match(html, /realestateWithheld: \(n, now\)/, "#290 문구는 그대로 남는다");
  assert.equal(withheldOf({ changeWithheld: { current: 23, baseline: 3210, min: 100 } }), "증감 보류 — 이번 주 집계 중(23건)");
});
