import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { USD_KRW } from "../scripts/ecos.ts";
import {
  FX_OVERLAP_DAYS,
  FX_WINDOW_DAYS,
  fetchUsdKrwSeries,
  fxFetchFrom,
  fxRowsFrom,
  fxSeriesOrPrevious,
  marketFiles,
  marketJsonText,
  mergeFx,
  storedFxSeries,
  syncHistoryFx,
  usdKrwAt,
} from "../scripts/fetch-market.ts";

// #639: 원/달러 환율을 open.er-api.com 에서 ECOS 731Y001(매매기준율, 일별)로 옮겼다.
const root = path.resolve(import.meta.dirname, "..");
const fixture = JSON.parse(await readFile(path.join(root, "test/fixtures/ecos/usdkrw-731y001.json"), "utf8"));
const fixtureRows = fixture.StatisticSearch.row;
// 2026-10-25(일) 09:30 KST - ECOS 의 마지막 값은 금요일(10-23)이다.
const SUNDAY = new Date("2026-10-25T00:30:00Z");
const day = (time, value) => ({ TIME: time, DATA_VALUE: value });

/** ECOS 처럼 답하는 가짜 fetch. 부른 주소를 모은다. */
function fakeEcos(rows) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const parts = String(url).split("/");
    const start = Number(parts[8]);
    const end = Number(parts[9]);
    const page = rows.slice(start - 1, end);
    return { ok: true, json: async () => (page.length ? { StatisticSearch: { list_total_count: rows.length, row: page } } : { RESULT: { CODE: "INFO-200" } }) };
  };
  return { urls, fetchImpl };
}

/** from 부터 to 까지 평일마다 한 줄(값은 날짜로 만든다). */
function weekdayRows(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const ymd = d.toISOString().slice(0, 10).replaceAll("-", "");
    out.push(day(ymd, String(1300 + (t / 86400000) % 50)));
  }
  return out;
}

test("표·항목·주기는 실제 응답에 적힌 것과 같다 (731Y001 원/미국달러 매매기준율, 일별, 원)", () => {
  assert.deepEqual(USD_KRW, { stat: "731Y001", item: "0000001", cycle: "D" });
  for (const row of fixtureRows) {
    assert.equal(row.STAT_CODE, USD_KRW.stat);
    assert.equal(row.ITEM_CODE1, USD_KRW.item);
    assert.equal(row.ITEM_NAME1, "원/미국달러(매매기준율)");
    assert.equal(row.UNIT_NAME, "원");
  }
});

test("실제 응답을 [날짜, 원] 계열로 읽고 주말은 비워 둔다", () => {
  const series = fxRowsFrom(fixtureRows);
  assert.equal(series.length, 10);
  assert.deepEqual(series[0], ["2026-10-12", 1338]);
  assert.deepEqual(series.at(-1), ["2026-10-23", 1324.6]);
  const dates = series.map(([d]) => d);
  for (const weekend of ["2026-10-17", "2026-10-18"]) assert.ok(!dates.includes(weekend), `${weekend} 값을 지어냈다`);
});

test("빈 값·이상한 값은 0원으로 둔갑하지 않고 버린다", () => {
  const series = fxRowsFrom([day("20261021", ""), day("20261022", " "), day("20261023", "abc"), day("2026102", "1300"), day("20261020", "0"), day("20261019", "1342.4")]);
  assert.deepEqual(series, [["2026-10-19", 1342.4]]);
  assert.deepEqual(fxRowsFrom(null), []);
});

test("받는 범위: 처음은 1년 백필, 그 뒤는 짧은 겹침, 쉬었으면 마지막 저장일부터", () => {
  assert.equal(FX_WINDOW_DAYS, 366);
  assert.equal(FX_OVERLAP_DAYS, 14);
  assert.equal(fxFetchFrom([], SUNDAY), "2025-10-24");
  const full = fxRowsFrom(weekdayRows("2025-10-24", "2026-10-23"));
  assert.equal(fxFetchFrom(full, SUNDAY), "2026-10-11");
  const stale = full.filter(([d]) => d <= "2026-09-30");
  assert.equal(fxFetchFrom(stale, SUNDAY), "2026-09-30");
  const short = full.filter(([d]) => d >= "2026-08-10");
  assert.equal(fxFetchFrom(short, SUNDAY), "2025-10-24", "1년을 덮지 못한 계열은 다시 백필한다");
});

test("1년 창 밖은 버리고, 겹친 날은 새 값이 이긴다", () => {
  const merged = mergeFx([["2025-09-01", 1400], ["2026-10-22", 1300]], [["2026-10-22", 1325.5], ["2026-10-23", 1324.6]], "2025-10-24");
  assert.deepEqual(merged, [["2026-10-22", 1325.5], ["2026-10-23", 1324.6]]);
});

test("백필은 인증키면 ECOS 1회로 1년을 받고 주소에 731Y001/D/…/0000001 을 싣는다", async () => {
  const { urls, fetchImpl } = fakeEcos(weekdayRows("2025-10-24", "2026-10-23"));
  const series = await fetchUsdKrwSeries([], SUNDAY, { key: "KEY", fetchImpl });
  assert.equal(urls.length, 1, `호출 ${urls.length}회`);
  assert.match(urls[0], /\/StatisticSearch\/KEY\/json\/kr\/1\/1000\/731Y001\/D\/20251024\/20261025\/0000001$/);
  assert.equal(series[0][0], "2025-10-24");
  assert.equal(series.at(-1)[0], "2026-10-23");
  assert.ok(series.length > 250 && series.length < 265, `1년 영업일 수가 아니다: ${series.length}`);
});

test("평소에는 겹침만 받고 sample 키도 두 쪽이면 끝난다", async () => {
  const stored = fxRowsFrom(weekdayRows("2025-10-24", "2026-10-21"));
  const { urls, fetchImpl } = fakeEcos(weekdayRows("2026-10-11", "2026-10-23"));
  const series = await fetchUsdKrwSeries(stored, SUNDAY, { key: "sample", fetchImpl });
  assert.ok(urls.length <= 2, `호출 ${urls.length}회`);
  assert.match(urls[0], /\/1\/10\/731Y001\/D\/20261011\/20261025\/0000001$/);
  assert.equal(series.at(-1)[0], "2026-10-23");
  assert.equal(series[0][0], "2025-10-24");
});

test("ECOS 를 못 받으면 지난번 ECOS 계열을 그대로 쓰고, 옛 open.er-api 값은 이어 쓰지 않는다", async () => {
  const broken = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const silence = console.error;
  console.error = () => {};
  try {
    const kept = fxRowsFrom(fixtureRows);
    const previous = { usdKrw: usdKrwAt(kept), usdKrwDaily: kept };
    const series = await fxSeriesOrPrevious(previous, SUNDAY, { key: "KEY", fetchImpl: broken });
    assert.deepEqual(series, kept);
    assert.equal(marketFiles({ now: SUNDAY, fxSeries: series }).market.usdKrw.value, 1324.6);

    const legacy = { usdKrw: { value: 1324.821047, asOf: "Sun, 25 Oct 2026 00:02:31 +0000" } };
    const none = await fxSeriesOrPrevious(legacy, SUNDAY, { key: "KEY", fetchImpl: broken });
    assert.deepEqual(none, []);
    assert.equal(marketFiles({ now: SUNDAY, fxSeries: none }).market.usdKrw, null);
  } finally {
    console.error = silence;
  }
  assert.deepEqual(storedFxSeries({ usdKrwDaily: [["2026-10-23", 1324.6], ["bad", 1], ["2026-10-22", ""], "x"] }), [["2026-10-23", 1324.6]]);
});

test("기록의 날마다 환율을 ECOS 그날 값으로 맞추고, 계열에 없는 날의 옛 값은 지운다", () => {
  const series = fxRowsFrom(fixtureRows);
  const history = [
    { date: "2026-10-16", kospi: { value: "1" }, usdKrw: { value: 1349.9, asOf: "Fri, 16 Oct 2026 00:02:31 +0000" }, baseRate: { value: "3.00" } },
    { date: "2026-10-17", kospi: { value: "1" }, usdKrw: { value: 1350.1 }, baseRate: { value: "3.00" } },
    { date: "2026-10-19", kospi: { value: "1" }, baseRate: { value: "3.00" } },
  ];
  const synced = syncHistoryFx(history, series);
  assert.equal(synced[0].usdKrw.value, 1348.5);
  assert.deepEqual(Object.keys(synced[0]), ["date", "kospi", "usdKrw", "baseRate"], "키 순서가 바뀌었다");
  assert.ok(!("usdKrw" in synced[1]), "토요일 기록에 open.er-api 값이 남았다");
  assert.equal(synced[2].usdKrw.value, 1342.4);
  assert.equal(synced[2].usdKrw.change, "-6.10");
  assert.equal(history[0].usdKrw.value, 1349.9, "받은 배열을 고쳐 썼다");
});

test("market.json 은 같은 내용을 쓰되 1년 계열은 한 점 한 줄로 쓴다", () => {
  const { market } = marketFiles({ now: SUNDAY, fxSeries: fxRowsFrom(fixtureRows) });
  const text = marketJsonText(market);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(market)));
  assert.match(text, /\n {4}\["2026-10-23",1324\.6\]\n {2}\]\n\}$/);
  assert.deepEqual(JSON.parse(marketJsonText({ ...market, usdKrwDaily: [] })).usdKrwDaily, []);
});

test("기록은 날짜당 하나, 오늘 것을 덮어쓴다", () => {
  const history = [{ date: "2026-10-25", kospi: { value: "old" } }, { date: "2026-10-23", kospi: { value: "x" } }];
  const { history: next } = marketFiles({ now: SUNDAY, kospi: { value: "new" }, fxSeries: fxRowsFrom(fixtureRows), history });
  assert.deepEqual(next.map((h) => h.date), ["2026-10-23", "2026-10-25"]);
  assert.equal(next[1].kospi.value, "new");
  assert.equal(next[0].usdKrw.value, 1324.6);
});

test("수집·화면·데이터 어디에도 open.er-api.com / exchangerate-api 가 남지 않았다", async () => {
  const banned = /open\.er-api\.com|exchangerate-api/i;
  const hits = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        await walk(full);
      } else if (/\.(ts|mjs|js|jsx|cjs|sh|yml|yaml|html|json)$/.test(entry.name)) {
        if (banned.test(await readFile(full, "utf8"))) hits.push(path.relative(root, full));
      }
    }
  }
  for (const dir of ["scripts", ".github", "test/fixtures"]) await walk(path.join(root, dir));
  for (const name of await readdir(path.join(root, "docs"))) {
    if (/\.(html|js)$/.test(name) && banned.test(await readFile(path.join(root, "docs", name), "utf8"))) hits.push(`docs/${name}`);
  }
  for (const name of ["market.json", "market-history.json"]) {
    if (banned.test(await readFile(path.join(root, "docs/data", name), "utf8"))) hits.push(`docs/data/${name}`);
  }
  assert.deepEqual(hits, []);
});
