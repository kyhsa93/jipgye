import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { judge, leadSentence, priceSeries, run } from "../scripts/indicator-backtest.mjs";
import { fetchRone, merge } from "../scripts/fetch-indicators.mjs";
import { shiftMonth } from "../scripts/outlook.mjs";

const root = path.resolve(import.meta.dirname, "..");

function noise(seed) {
  let state = seed >>> 0;
  const u = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 2 ** 32;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** 2006-01부터 240달. 월 변화가 phi만큼 이어지는 가격 계열. */
function prices(seed = 5) {
  const next = noise(seed);
  const rows = [];
  let level = Math.log(100);
  let r = 0;
  let month = "200601";
  for (let i = 0; i < 240; i += 1) {
    r = 0.5 * r + 0.01 * next();
    level += r;
    rows.push([month, Math.exp(level)]);
    month = shiftMonth(month, 1);
  }
  return rows;
}

/** 다음 3개월 가격 변화를 그대로 담은 '주담대 금리' - 진짜로 앞서는 지표. 나머지는 잡음. */
function seriesFor(priceRows, { leading = true } = {}) {
  const next = noise(99);
  const lead = priceRows.slice(0, -3).map(([m, v], i) => [m, leading ? Math.log(priceRows[i + 3][1] / v) * 100 + 0.05 * next() : next()]);
  const junk = priceRows.map(([m]) => [m, 100 + next()]);
  return {
    mortgage_rate: lead,
    kb_sale: junk, kb_jeonse: junk, base_rate: junk, ktb3: junk, unsold_seoul: junk,
    csi_house_seoul: junk, vol_seoul: junk, jratio_seoul: junk, supply_demand_seoul: junk,
  };
}

test("예측은 그 시점 뒤의 가격을 보지 않는다", () => {
  const rows = prices();
  const a = priceSeries(rows);
  // 오리진 바로 다음 달부터 바꾼다. 멀리서 바꾸면 한두 달 새는 누출을 못 본다.
  const origin = 150;
  const b = priceSeries(rows.map(([m, v], i) => [m, i > origin ? v * 3 : v]));
  // 상수 지표는 절편과 겹쳐 회귀가 안 풀리고 행이 통째로 빠진다 - 그러면 이 검사는 아무것도 안 본다.
  const fn = (t) => [Math.sin(t)];
  for (const h of [3, 6]) {
    const pred = (p, out) => {
      const row = out.find(([o]) => o === p.months[origin]);
      assert.ok(row, "오리진 행이 없다 - 검사가 아무것도 안 보고 통과한다");
      const actual = (p.lp[origin + h] - p.lp[origin]) * 100;
      return [actual - row[1], actual - row[2]].map((v) => Math.round(v * 1e9) / 1e9);
    };
    assert.deepEqual(pred(a, run(a, h, fn, 0)), pred(b, run(b, h, fn, 0)), "오리진 뒤 가격이 학습에 섞였다");
  }
});

test("진짜로 앞서는 지표는 '앞섬'으로 판정한다", () => {
  const rows = prices();
  const p = priceSeries(rows);
  const all = { 200: p, 210: p, 220: p, 230: p, 240: p, 250: p };
  const out = judge(all, seriesFor(rows));
  const mort = out.find((r) => r.id === "mort_lvl" && r.lag === 0);
  assert.equal(mort.verdict, "leads", "답을 담은 지표를 못 알아봤다 - 자가 너무 엄하다");
  assert.match(leadSentence(out, "ko"), /꾸준히 예측을 낫게 한 것은/);
});

test("잡음 지표는 앞서지 않는다고 적는다", () => {
  const rows = prices();
  const p = priceSeries(rows);
  const all = { 200: p, 210: p, 220: p, 230: p, 240: p, 250: p };
  const out = judge(all, seriesFor(rows, { leading: false }));
  assert.equal(out.filter((r) => r.verdict === "leads").length, 0, "잡음을 앞섬으로 읽었다");
  assert.match(leadSentence(out, "ko"), /더 잘 맞힌 것은 없었습니다/);
});

test("서울에서만 넘고 권역에서 재현되지 않으면 '앞섬'이 아니다", () => {
  const rows = prices();
  const seoul = priceSeries(rows);
  const other = priceSeries(prices(77));
  const all = { 200: seoul, 210: other, 220: other, 230: other, 240: other, 250: other };
  const mort = judge(all, seriesFor(rows)).find((r) => r.id === "mort_lvl" && r.lag === 0);
  assert.equal(mort.verdict, "seoulOnly");
});

test("먼저 공표된 값은 이겨도 '앞섬'으로 쓰지 않는다", () => {
  const rows = prices();
  const p = priceSeries(rows);
  const all = { 200: p, 210: p, 220: p, 230: p, 240: p, 250: p };
  // KB 매매를 가격 그 자체로 두면 +2개월 변형이 답을 미리 본다.
  const series = { ...seriesFor(rows, { leading: false }), kb_sale: rows };
  const out = judge(all, series);
  for (const lag of [1, 2]) {
    const kb = out.find((r) => r.id === "kb1" && r.lag === lag);
    assert.equal(kb.published, true, `KB 매매 +${lag}개월은 가격지수보다 먼저 공표된 같은 달이다`);
    assert.equal(kb.verdict, "published", "먼저 공표된 같은 달 값을 앞섬으로 적었다");
  }
});

test("R-ONE은 다섯 달씩 잘라 부르고, 받은 꼬리는 저장된 계열 위에 덮는다", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams;
    asked.push([q.get("START_WRTTIME"), q.get("END_WRTTIME")]);
    return { ok: true, json: async () => ({ SttsApiTblData: [{}, { row: [{ WRTTIME_IDTFR_ID: q.get("START_WRTTIME"), DTA_VAL: 1 }] }] }) };
  };
  await fetchRone({ statbl: "x", cls: 1, itm: 1 }, "202601", "202612", { fetchImpl });
  assert.deepEqual(asked, [["202601", "202605"], ["202606", "202610"], ["202611", "202612"]]);
  assert.deepEqual(merge([["202601", 1], ["202602", 2]], [["202602", 9]]), [["202601", 1], ["202602", 9]]);
});

test("정적 HTML이 오늘 판정 표를 싣는다", async () => {
  const [html, data] = await Promise.all([
    readFile(path.join(root, "docs/price-outlook.html"), "utf8"),
    readFile(path.join(root, "docs/data/outlook-indicators.json"), "utf8").then(JSON.parse),
  ]);
  const block = html.match(/<!--prerender:indicatorTable-->([\s\S]*?)<!--\/prerender:indicatorTable-->/)?.[1];
  assert.equal(block, data.table.ko);
  assert.ok(data.lead.en && data.table.en);
});

test("3차 후보(#57): 인허가는 연중 누계를 달 값으로 풀고, 외지인 비중은 3개월 합으로 낸다", async () => {
  const { monthlyFromYtd, candidates3 } = await import("../scripts/indicator-candidates-3.mjs");
  const m = monthlyFromYtd([["202401", 100], ["202402", 250], ["202403", 300], ["202501", 50]]);
  const ymi = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;
  assert.equal(m.get(ymi("202401")), 100, "1월은 누계 그대로");
  assert.equal(m.get(ymi("202402")), 150);
  assert.equal(m.get(ymi("202403")), 50);
  assert.equal(m.get(ymi("202501")), 50, "해가 바뀌면 다시 1월부터");

  const months = ["202601", "202602", "202603"];
  const series = {
    buyer_total_seoul: months.map((x) => [x, 100]),
    buyer_outside_seoul: [["202601", 10], ["202602", 20], ["202603", 30]],
  };
  const share = candidates3(series).find((c) => c.id === "out_share");
  assert.deepEqual(share.fn(ymi("202603")), [0.2], "60/300");
  assert.equal(share.fn(ymi("202602")), null, "석 달이 다 없으면 내지 않는다");
});

test("R-ONE 지역이 GRP에 있는 표는 GRP_ID로 건다", async () => {
  const { roneUrl } = await import("../scripts/fetch-indicators.mjs");
  const url = new URL(roneUrl({ statbl: "A_2024_00609", grp: 900002, cls: 500005, itm: 100001 }, "202601", "202605"));
  assert.equal(url.searchParams.get("GRP_ID"), "900002");
  assert.equal(url.searchParams.get("CLS_ID"), "500005");
  assert.equal(new URL(roneUrl({ statbl: "A", cls: 1, itm: 2 }, "202601", "202605")).searchParams.has("GRP_ID"), false);
});

test("매일 판정에 3차 후보가 들어간다", async () => {
  const { candidates } = await import("../scripts/indicator-backtest.mjs");
  const ids = candidates({}).map((c) => c.id);
  for (const id of ["out_share", "out_share12", "mort_bal12", "mort_bal_seoul12", "permits12", "permits_lag36"]) assert.ok(ids.includes(id), id);
});

test("표 끝에 백테스트에 못 들어간 건축HUB 주택인허가 한 행이 정적으로 붙고, 매일 판정 행 수는 그대로다 (#153)", async () => {
  const { NOT_TESTED, tableHtml } = await import("../scripts/indicator-backtest.mjs");
  const [html, payload] = await Promise.all([
    readFile(path.join(root, "docs/price-outlook.html"), "utf8"),
    readFile(path.join(root, "docs/data/outlook-indicators.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(NOT_TESTED.length, 1);
  // 판정 행(payload.rows)에는 정적 행이 섞이지 않는다 - 판정식·합격선은 건드리지 않았다.
  assert.ok(payload.rows.every((r) => r.id && r.verdict), "정적 행이 판정 행에 섞였다");
  const bodyRows = (h) => (h.match(/<tr>/g) ?? []).length - 1; // 머리 한 줄 제외
  assert.equal(bodyRows(payload.table.ko), payload.rows.length + NOT_TESTED.length);
  assert.equal(bodyRows(payload.table.en), payload.rows.length + NOT_TESTED.length);
  // 정적 HTML(ko)은 JSON 표 그대로이고, 접근성 caption 행 수도 맞다.
  assert.ok(html.includes(payload.table.ko), "정적 HTML 표가 JSON과 다르다");
  assert.ok(html.includes(`${bodyRows(payload.table.ko)}행 4열`), "caption 행 수가 표와 다르다");
  assert.equal(html.split("건축HUB 주택인허가</td>").length - 1, 1);
  assert.equal(payload.table.en.split("Building HUB housing permits</td>").length - 1, 1);
});

test("건축HUB 정적 행의 수치는 #133 기록(measure.json B2)과 같고, 사업명·사업주체명·지번·관리번호를 담지 않는다 (#153)", async () => {
  const { NOT_TESTED } = await import("../scripts/indicator-backtest.mjs");
  const measure = JSON.parse(await readFile(path.join(root, "research/housing-permits/measure.json"), "utf8"));
  assert.equal(measure.B2.verdict, "fail");
  const gap = (measure.B2.median * 100).toFixed(1);
  assert.equal(gap, "40.8");
  assert.equal(Math.round(measure.B2.threshold * 100), 10);
  // 호수 0 비율: #133 댓글의 124,721/130,181건.
  assert.equal(((124721 / 130181) * 100).toFixed(1), "95.8");
  const [row] = NOT_TESTED;
  for (const locale of ["ko", "en"]) {
    const text = [row[locale], row.verdict[locale], row.checked].join(" ");
    assert.ok(text.includes(`${gap}%`) && text.includes("95.8%"), locale);
    // 문구 속 숫자는 이 넷(괴리, "호수 0"의 0, 0 비율, 확인일)뿐이다 - 원본 값이 끼어들 틈이 없다.
    assert.deepEqual(text.match(/\d{4}-\d{2}-\d{2}|\d+(?:[.,]\d+)*/g).sort(), ["0", "2026-10-10", "40.8", "95.8"], locale);
    assert.ok(!/[A-Za-z0-9_-]{15,}|\d+[동호번지]|지번|관리번호|사업주체|mgmHsrgstPk|bldNm|platPlc/.test(text), locale);
  }
});
