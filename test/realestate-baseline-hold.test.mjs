// #862 조건 4 - 비교 기준일의 표본이 한 단지·한 계약일 행으로 차 있으면 서울 매매 증감을 내지 않는다.
// 판정은 오늘이 아니라 findBaseline 이 고른 기준일로 한다. 기록이 빠지면 기준일이 달라져 결과도 달라지는 것까지 본다.
// 입력은 전부 고정이다 - 오늘 data 값에 기대지 않는다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachChanges, findBaseline } from "../scripts/realestate-metrics.ts";
import { CONCENTRATED_BASELINE_DATES } from "../scripts/realestate-concentration.ts";
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
const run = (now, history = HISTORY, window = ARRIVAL) => {
  const at = new Date(now);
  const baseline = findBaseline(history.filter((h) => h.date < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(at)), at);
  return { baseline, ...attachChanges(metrics(500, 5100), [], baseline, window) };
};
const at = (date) => `${date}T03:00:00Z`;

test("기준일 목록은 2026-11-03~11-08 엿새다", () => {
  assert.deepEqual([...CONCENTRATED_BASELINE_DATES], days(3, 8));
});

test("11-09 는 기준 11-02 라 증감이 있다", () => {
  const { baseline, overall } = run(at("2026-11-09"));
  assert.equal(baseline.date, "2026-11-02");
  assert.equal(overall.sale.changeWithheld, undefined);
  assert.equal(Number(overall.sale.change.percent.toFixed(1)), 2.0);
  assert.equal(overall.sale.baselineDate, "2026-11-02");
});

test("11-10~11-15 는 기준 11-03~11-08 이라 서울 매매 증감만 없고, 84㎡·전세·월세 증감은 그대로다", () => {
  for (const [i, date] of days(10, 15).entries()) {
    const { baseline, overall } = run(at(date));
    assert.equal(baseline.date, days(3, 8)[i], date);
    assert.equal(overall.sale.change, undefined, `${date}: 서울 매매 증감이 나갔다`);
    assert.equal(overall.sale.baselineDate, undefined, date);
    assert.equal(overall.sale.avgPricePerPyeong10k, 5100, "값은 그대로다");
    assert.equal(overall.sale.changeWithheld.reason, "baseline-concentration", date);
    assert.equal(overall.sale.changeWithheld.baselineDate, baseline.date, date);
    for (const kind of ["saleNational84", "jeonse", "wolse"]) {
      assert.equal(Number(overall[kind].change.percent.toFixed(1)), 2.0, `${date} ${kind}`);
      assert.equal(overall[kind].changeWithheld, undefined, `${date} ${kind}`);
    }
  }
});

test("11-16 은 기준 11-09 라 증감이 있다", () => {
  const { baseline, overall } = run(at("2026-11-16"));
  assert.equal(baseline.date, "2026-11-09");
  assert.equal(overall.sale.changeWithheld, undefined);
  assert.ok(overall.sale.change);
});

test("기록이 빠지면 기준일을 따라간다: 11-09 기록이 없으면 11-16 은 보류, 11-03 기록이 없으면 11-10 은 증감 있음", () => {
  const without = (date) => HISTORY.filter((h) => h.date !== date);
  const noNinth = run(at("2026-11-16"), without("2026-11-09"));
  assert.equal(noNinth.baseline.date, "2026-11-08");
  assert.equal(noNinth.overall.sale.change, undefined);
  assert.equal(noNinth.overall.sale.changeWithheld.reason, "baseline-concentration");
  const noThird = run(at("2026-11-10"), without("2026-11-03"));
  assert.equal(noThird.baseline.date, "2026-11-02");
  assert.ok(noThird.overall.sale.change);
  assert.equal(noThird.overall.sale.changeWithheld, undefined);
});

test("11-09 기준 11-02 가 36건이면 #290 보류이고 reason 은 이 규칙이 아니다", () => {
  const thin = HISTORY.map((h) => (h.date === "2026-11-02" ? record(h.date, metrics(36, 5000)) : h));
  const { overall } = run(at("2026-11-09"), thin);
  assert.deepEqual(overall.sale.changeWithheld, { current: 500, baseline: 36, min: 100 });
  assert.equal(withheldOf(overall.sale), "증감 보류 — 비교 주 표본 부족(36건)");
});

test("자정 경계: 11-10 00:30 KST 는 11-10 이라 기준 11-03 으로 보류된다", () => {
  const { baseline, overall } = run("2026-11-09T15:30:00Z");
  assert.equal(baseline.date, "2026-11-03");
  assert.equal(overall.sale.change, undefined);
  assert.equal(overall.sale.changeWithheld.reason, "baseline-concentration");
});

test("목록 밖의 새 날도 기준 기록에 발동 정보가 있으면 보류한다", () => {
  const flagged = { ...metrics(500, 5000), sale: { ...metrics(500, 5000).sale, concentration: { rows: 60, share: 0.12, without: { avgPricePerPyeong10k: 4900, transactionCount: 440 } } } };
  const history = [record("2026-12-13", flagged)];
  const { overall } = run(at("2026-12-20"), history);
  assert.equal(overall.sale.change, undefined);
  assert.equal(overall.sale.changeWithheld.reason, "baseline-concentration");
  assert.ok(overall.jeonse.change, "전세는 막지 않는다");
});

test("자치구는 이 규칙으로 막지 않는다", () => {
  const baseline = { date: "2026-11-03", overall: metrics(500, 5000), districts: [{ code: "1", ...metrics(50, 5000) }] };
  const { districts } = attachChanges(metrics(500, 5100), [{ code: "1", name: "a", ...metrics(50, 5100) }], baseline, ARRIVAL);
  assert.ok(districts[0].sale.change);
  assert.equal(districts[0].sale.changeWithheld, undefined);
});

test("문구: 칸은 건수와 이유를 국·영으로, 칩은 기간과 증감 보류만 적는다", () => {
  const { overall } = run(at("2026-11-10"));
  assert.equal(overall.sale.changeWithheld.text.ko.cell, "500건 · 증감 보류 — 11/3 표본에 한 단지·한 계약일 행이 5% 이상");
  assert.equal(overall.sale.changeWithheld.text.en.cell, "500 filings · change withheld — 5%+ of the Nov 3 sample was one complex on one contract date");
  const stats = buildRealestateStats({ window: ARRIVAL, overall });
  assert.equal(stats[0].note, "전 면적 평균 · 11/9~11/10 들어온 신고 500건 · 증감 보류");
  assert.equal(stats[0].noteEn, "All-size average · 500 filings arrived Nov 9–10 · change withheld");
  assert.match(stats[1].note, /대비 \+2\.0%/, "전세 칩의 증감은 그대로다");
});

test("문구: 계약 기준 날은 영어 건수 단위가 deals 이고 칩은 최근 4주 계약이다", () => {
  const { overall } = run(at("2026-11-10"), HISTORY, CONTRACT);
  assert.equal(overall.sale.changeWithheld.text.ko.cell, "500건 · 증감 보류 — 11/3 표본에 한 단지·한 계약일 행이 5% 이상");
  assert.equal(overall.sale.changeWithheld.text.en.cell, "500 deals · change withheld — 5%+ of the Nov 3 sample was one complex on one contract date");
  const [sale] = buildRealestateStats({ window: CONTRACT, overall });
  assert.equal(sale.note, "전 면적 평균 · 최근 4주 계약 500건 · 증감 보류");
  assert.equal(sale.noteEn, "All-size average · 500 deals in the last 4 weeks · change withheld");
});

const held = () => {
  const { overall } = run(at("2026-11-10"));
  return {
    updatedAt: "2026-11-10T03:00:00.000Z",
    window: ARRIVAL,
    overall,
    districts: [{ code: "11680", name: "강남구", ...metrics(50, 9000) }],
  };
};
const CELL = "500건 · 증감 보류 — 11/3 표본에 한 단지·한 계약일 행이 5% 이상";
const CELL_EN = "500 filings · change withheld — 5%+ of the Nov 3 sample was one complex on one contract date";

test("구운 첫 화면 칸과 화면 JS 칸이 같은 문구를 reason 먼저 보고 그린다", async () => {
  const data = held();
  assert.equal(withheldOf(data.overall.sale), CELL);
  assert.equal(metricCell("sale", data.overall.sale, true).count, CELL);
  const [overallRow] = realestateHtml(data).split("</tr>");
  assert.ok(overallRow.includes(`<span class="count">${CELL}</span>`));
  const grid = async (lang) => {
    const page = await loadIndexPage({ storage: { lang }, fetch: async () => ({ ok: true, json: async () => data }) });
    await new Promise((r) => setTimeout(r, 20));
    return page.byId("realestate-grid").innerHTML.split("</tr>")[0];
  };
  const ko = await grid("ko");
  assert.ok(ko.includes(`<span class="tx-count">${CELL}</span>`), ko);
  const en = await grid("en");
  assert.ok(en.includes(`<span class="tx-count">${CELL_EN}</span>`), en);
});

test("시세 장 표: 구운 줄과 틀의 화면 JS 가 이유를 그린다 - 전 종류 표와 매매 표, 자치구 줄은 그대로", async () => {
  const data = held();
  const parts = (kind) => realestateTable(data, kind).rows[0].cells.flatMap((c) => c.parts);
  for (const kind of [null, "sale"]) {
    assert.ok(parts(kind).some((p) => p.type === "count" && p.text === CELL), `구운 ${kind}`);
    assert.ok(!parts(kind).some((p) => p.type === "change" && kind === "sale"), `구운 ${kind}: 증감 조각`);
  }
  assert.ok(realestateTableHtml(data).includes(CELL));
  for (const [kind, locale, text] of [[null, "ko", CELL], ["sale", "ko", CELL], [null, "en", CELL_EN], ["sale", "en", CELL_EN]]) {
    const page = await loadRealestatePage({ realestate: data, kind, locale, file: "scripts/realestate-template.html" });
    const html = String(page.byId("district-grid").innerHTML);
    const [overallRow, ...rest] = html.split("</tr>");
    assert.ok(overallRow.includes(text), `${kind} ${locale}: ${overallRow}`);
    assert.ok(!rest.join("").includes(text), "자치구 줄에는 붙지 않는다");
  }
});

test("낡은 realestate.json(reason 없음)은 예전과 같은 칸이다", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  assert.match(html, /realestateWithheld: \(n, now\)/, "#290 문구는 그대로 남는다");
  assert.equal(withheldOf({ changeWithheld: { current: 23, baseline: 3210, min: 100 } }), "증감 보류 — 이번 주 집계 중(23건)");
});
