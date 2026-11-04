// #862 조건 2 - 뉴스 칩의 기간·표본 문구. 신고 기준 값에 「최근 1주 계약」이라 적던 것과, 전 면적 평균을 84㎡로 환산한 값이 84㎡ 거래만의 값으로 읽히던 것을 막는다.
// 입력은 전부 고정이다 - 오늘 data 값에 기대지 않는다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildContext, buildRealestateStats, metricEntry } from "../scripts/news-context.ts";

const root = path.resolve(import.meta.dirname, "..");

const ARRIVAL = { basis: "arrival", from: "2026-11-02", to: "2026-11-04", until: "2026-11-09", weeks: 1, districtFrom: "2026-10-12", districtWeeks: 4 };
const CONTRACT = { basis: "contract", from: "2026-08-24", to: "2026-09-20", until: "2026-09-21", weeks: 4, districtFrom: "2026-08-24", districtWeeks: 4 };

const sale = (count, price = 5126, extra = {}) => ({ avgPricePerPyeong10k: price, transactionCount: count, ...extra });
const jeonse = (count, price = 3193, extra = {}) => ({ avgDepositPerPyeong10k: price, transactionCount: count, ...extra });
const wolse = (count) => ({ avgDeposit10k: 24368, avgMonthlyRent10k: 143, transactionCount: count });

const seoul = (window, overall = {}) => buildRealestateStats({ window, overall: { sale: sale(754), jeonse: jeonse(427), wolse: wolse(521), ...overall } });
const seocho = (kind, metric, window) => metricEntry({ [kind]: metric }, kind, { name: "서초구", nameEn: "서초구", slug: "seocho", window, district: true });

test("서울 칩은 신고 기준이면 서울 창의 기간과 들어온 신고 건수를 적는다 - 국·영", () => {
  const [s, j, w] = seoul(ARRIVAL);
  assert.equal(s.label, "서울 아파트 매매 (84㎡ 환산)");
  assert.equal(s.labelEn, "Seoul apartment sale (scaled to 84㎡)");
  assert.equal(j.label, "서울 아파트 전세 (84㎡ 환산)");
  assert.equal(j.labelEn, "Seoul apartment jeonse (scaled to 84㎡)");
  assert.equal(s.note, "전 면적 평균 · 11/2~11/4 들어온 신고 754건");
  assert.equal(s.noteEn, "All-size average · 754 filings arrived Nov 2–4");
  assert.equal(j.note, "전 면적 평균 · 11/2~11/4 들어온 신고 427건");
  assert.equal(w.note, "11/2~11/4 들어온 신고 521건", "월세는 환산값이 아니라 전 면적 표시를 달지 않는다");
  assert.equal(w.label, "서울 아파트 월세");
});

test("구 칩은 신고 기준이면 구 창(districtFrom~to)을 적는다 - 서울 주 기간을 빌려 쓰지 않는다", () => {
  const s = seocho("sale", sale(98, 9500), ARRIVAL);
  assert.equal(s.label, "서초구 아파트 매매 (84㎡ 환산)");
  assert.equal(s.labelEn, "서초구 apartment sale (scaled to 84㎡)");
  assert.equal(s.note, "전 면적 평균 · 10/12~11/4 들어온 신고 98건");
  assert.equal(s.noteEn, "All-size average · 98 filings arrived Oct 12–Nov 4");
  const j = seocho("jeonse", jeonse(200), ARRIVAL);
  assert.equal(j.label, "서초구 아파트 전세 (84㎡ 환산)");
  assert.equal(j.labelEn, "서초구 apartment jeonse (scaled to 84㎡)");
});

test("기사 칩 경로(buildContext)가 구와 서울을 각자의 창으로 낸다", () => {
  const realestate = {
    window: ARRIVAL,
    overall: { sale: sale(754) },
    districts: [{ code: "11650", name: "서초구", sale: sale(98, 9500) }],
  };
  assert.match(buildContext({ title: "서초 아파트" }, { realestate })[0].note, /10\/12~11\/4 들어온 신고 98건/);
  assert.match(buildContext({ title: "서울 아파트값" }, { realestate })[0].note, /11\/2~11\/4 들어온 신고 754건/);
});

test("하루짜리 창은 날짜 하나만 적는다", () => {
  const oneDay = { ...ARRIVAL, from: "2026-11-02", to: "2026-11-02" };
  const [s] = seoul(oneDay, { sale: sale(36) });
  assert.equal(s.note, "전 면적 평균 · 11/2 들어온 신고 36건");
  assert.equal(s.noteEn, "All-size average · 36 filings arrived Nov 2");
});

test("계약 기준은 「최근 N주 계약」을 유지하고, 영어는 1주일 때 단수다", () => {
  const [s] = seoul(CONTRACT, { sale: sale(3423) });
  assert.equal(s.note, "전 면적 평균 · 최근 4주 계약 3,423건");
  assert.equal(s.noteEn, "All-size average · 3,423 deals in the last 4 weeks");
  const [one] = seoul({ ...CONTRACT, weeks: 1 }, { sale: sale(300) });
  assert.equal(one.note, "전 면적 평균 · 최근 1주 계약 300건");
  assert.equal(one.noteEn, "All-size average · 300 deals in the last week");
});

test("증감이 있으면 표본 뒤에 그대로 붙는다", () => {
  const [s] = seoul(ARRIVAL, { sale: sale(754, 5126, { change: { value10k: 100, percent: 2 }, baselineDate: "2026-10-28" }) });
  assert.equal(s.note, "전 면적 평균 · 11/2~11/4 들어온 신고 754건 · 10/28 대비 +2.0%");
  assert.equal(s.noteEn, "All-size average · 754 filings arrived Nov 2–4 · +2.0% vs Oct 28");
});

test("신고 기준 칩에는 계약·1주·84㎡ 매매로 읽히는 말이 없다 - 서울·구, 국·영", () => {
  const banned = ["계약 7", "계약 9", "최근 1주", "in the last 1 weeks", "in the last week", "84㎡ 매매", "84㎡ 전세", "84㎡ sale", "84㎡ jeonse", "deals"];
  const chips = [...seoul(ARRIVAL), seocho("sale", sale(98), ARRIVAL), seocho("jeonse", jeonse(200), ARRIVAL)];
  for (const chip of chips) {
    for (const text of [chip.label, chip.labelEn, chip.note, chip.noteEn]) {
      for (const word of banned) assert.ok(!text.includes(word), `${word}: ${text}`);
    }
  }
});

test("뉴스 장의 안내는 전 면적 환산임을 말하고 제목은 「오늘의 시세」라 하지 않는다 - 정적 줄과 사전 양쪽", async () => {
  const html = await readFile(path.join(root, "docs/news.html"), "utf8");
  const ko = "국토교통부 실거래 신고 자료입니다. 매매·전세는 전 면적 평균을 84㎡로 환산한 값이라 84㎡ 거래만의 값이 아닙니다.";
  const en = "From Ministry of Land transaction filings. Sale and jeonse figures average all sizes and scale the result to 84㎡; they are not averages of 84㎡ deals.";
  assert.equal(html.split(ko).length - 1, 2, "정적 줄과 사전이 같은 문장이다");
  assert.ok(html.includes(en));
  for (const old of ["전용 84㎡ 환산가", "converted to an 84㎡ unit", "오늘의 서울 아파트 시세", "Seoul apartment prices today"]) {
    assert.ok(!html.includes(old), old);
  }
  assert.equal(html.split("서울 아파트 신고 평균").length - 1, 2, "제목 정적 줄과 사전");
  assert.ok(html.includes("Seoul apartment filings: averages"));
});
