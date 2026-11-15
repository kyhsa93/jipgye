// #290 - 증감은 현재 값과 기준 값 양쪽의 신고 건수가 문턱 이상일 때만 낸다(서울 전체 100, 자치구·뉴스 칩 20). 모자라면 `change` 없이 `changeWithheld` 만 남기고 화면은 흐린 한 줄만 그린다.
// #862 2·3단계부터 빌드는 어느 날에도 7일 증감을 싣지 않는다 - 빌드 쪽 단언은 「건수와 관계없이 증감·#290 보류가 없다」로 바뀌었고, 화면·칩이 옛 모양(change·changeWithheld)을 그리는 길은 그대로 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CHANGE_MIN_COUNT, canShowChange } from "../scripts/realestate-format.ts";
import { attachChanges, findBaseline } from "../scripts/realestate-metrics.ts";
import { metricEntry } from "../scripts/news-context.ts";
import { realestateHtml } from "../scripts/prerender.ts";
import { withheldOf } from "../scripts/realestate-rows.ts";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { buildContext } from "../scripts/news-context.ts";

const root = path.resolve(import.meta.dirname, "..");
const sale = (count, price = 5000) => ({ avgPricePerPyeong10k: price, transactionCount: count });
const jeonse = (count, price = 3000) => ({ avgDepositPerPyeong10k: price, transactionCount: count });
const empty = { sale: null, saleNational84: null, jeonse: null, wolse: null };
const CONTRACT = { basis: "contract", from: "2026-09-14", to: "2026-10-11", until: "2026-10-12", weeks: 4, districtFrom: "2026-09-14", districtWeeks: 4 };
const build = (overall, districts) => attachChanges(overall, districts, CONTRACT);

// 바꾼 단언(#862 3단계): 예전에는 문턱 이상이면 change, 아래면 changeWithheld {current, baseline, min} 이 붙었다. 판정 함수(canShowChange)의 경계는 그대로 본다.
test("증감 문턱(canShowChange)은 현재·기준 양쪽의 N-1/N 경계이고, 빌드는 건수와 관계없이 증감·#290 보류를 싣지 않는다 (서울 100 · 자치구 20)", () => {
  assert.deepEqual(CHANGE_MIN_COUNT, { seoul: 100, district: 20 });
  for (const [min, scope] of [[100, "overall"], [20, "district"]]) {
    for (const [cur, base, shown] of [[min, min, true], [min - 1, min, false], [min, min - 1, false], [min - 1, min - 1, false]]) {
      const out = scope === "overall"
        ? build({ ...empty, sale: sale(cur, 5500) }, []).overall.sale
        : build(empty, [{ code: "1", sale: sale(cur, 5500) }]).districts[0].sale;
      assert.equal(canShowChange(cur, base, min), shown);
      assert.equal(out.avgPricePerPyeong10k, 5500, "값은 그대로 낸다");
      assert.deepEqual([out.changeWithheld, out.change, out.baselineDate], [undefined, undefined, undefined], `${scope} ${cur}/${base}`);
    }
  }
  // 종류마다 같다: 매매가 얇든 전세가 문턱을 채우든 둘 다 증감이 없다.
  const mixed = build({ ...empty, sale: sale(99), jeonse: jeonse(100, 3300) }, []).overall;
  assert.deepEqual([mixed.sale.changeWithheld, mixed.sale.change, mixed.jeonse.change, mixed.jeonse.changeWithheld], [undefined, undefined, undefined, undefined]);
  // 건수 필드가 없으면 0건으로 본다(브라우저 hasEnoughSample 과 같다).
  assert.equal(canShowChange(undefined, 500, 20), false);
});

// realestate-history.json 의 서울 전체 매매(날짜·건수·평당가)만 뜬 고정물. 08-24·08-31·10-12·10-13·10-19 가 막히던 날, 08-17·10-24·10-25 는 건수가 충분한 날이다.
// (10-06 은 이력에 14일 안의 기준이 없어 findBaseline 이 null 이라 애초에 증감이 붙지 않는다.)
const HISTORY = [
  ["2026-08-10", 139, 4109], ["2026-08-17", 573, 4459], ["2026-08-24", 18, 6341], ["2026-08-31", 25, 4306],
  ["2026-10-05", 3210, 4973], ["2026-10-06", 19, 10884], ["2026-10-12", 23, 6476], ["2026-10-13", 281, 5104],
  ["2026-10-17", 1153, 5478], ["2026-10-18", 1167, 5478], ["2026-10-19", 3042, 4914], ["2026-10-24", 1236, 5177], ["2026-10-25", 1250, 5184],
].map(([date, count, price]) => ({ date, overall: { sale: sale(count, price) }, districts: [] }));

// 바꾼 단언(#862 3단계): 예전에는 얇은 날 다섯이 changeWithheld {current, baseline, 100}, 08-17·10-24·10-25 가 +8.5%·−5.5%·−5.4% 증감이었다.
test("이력 재생: 기준 기록이 있는 날(얇든 차든)도 빌드는 change·changeWithheld 를 붙이지 않는다", () => {
  const run = (date) => {
    const i = HISTORY.findIndex((h) => h.date === date);
    const baseline = findBaseline(HISTORY.slice(0, i), new Date(`${date}T03:00:00Z`));
    return { baseline, sale: build({ ...empty, sale: HISTORY[i].overall.sale }, []).overall.sale };
  };
  const withBase = { "2026-08-24": "2026-08-17", "2026-08-31": "2026-08-24", "2026-10-12": "2026-10-05", "2026-10-13": "2026-10-06", "2026-10-19": "2026-10-12", "2026-08-17": "2026-08-10", "2026-10-24": "2026-10-17", "2026-10-25": "2026-10-18" };
  for (const [date, baseDate] of Object.entries(withBase)) {
    const { baseline, sale: out } = run(date);
    assert.equal(baseline.date, baseDate, `전제: ${date} 는 견줄 기록이 있다`);
    assert.deepEqual([out.change, out.baselineDate, out.changeWithheld], [undefined, undefined, undefined], date);
  }
  assert.equal(run("2026-10-06").sale.changeWithheld, undefined, "기준이 없으면 아무것도 안 붙는다");
});

test("뉴스 칩은 기준 쪽이 얇아 막힌 값에 증감 조각을 달지 않는다", () => {
  const district = (extra) => metricEntry({ sale: { ...sale(40, 5000), baselineDate: "2026-10-05", ...extra } }, "sale", { name: "강남구", nameEn: "Gangnam", slug: "gangnam" });
  const shown = district({ change: { value10k: 100, percent: 2 } });
  assert.match(shown.note, /10\/5 대비 \+2\.0%/);
  assert.match(shown.noteEn, /\+2\.0% vs Oct 5/);
  const blocked = district({ changeWithheld: { current: 40, baseline: 19, min: 20 } });
  assert.doesNotMatch(blocked.note, /대비/);
  assert.doesNotMatch(blocked.noteEn, /vs/);
  assert.match(blocked.note, /계약 40건/, "건수는 그대로 적는다");
  // 현재 쪽이 20건 아래면 예전처럼 달지 않는다.
  assert.doesNotMatch(district({ transactionCount: 19, change: { value10k: 100, percent: 2 } }).note, /대비/);
});

const WITHHELD_NOW = { current: 23, baseline: 3210, min: 100 };
const WITHHELD_BASE = { current: 281, baseline: 19, min: 100 };

test("구운 서울 전체 줄은 보류 문구만 낸다 - .change·건수 없이 한 줄, 자치구 줄은 증감만 빠진다", () => {
  const html = realestateHtml({
    overall: { sale: { ...sale(23, 6476), changeWithheld: WITHHELD_NOW }, jeonse: { ...jeonse(281, 3000), changeWithheld: WITHHELD_BASE } },
    districts: [{ name: "강남구", sale: { ...sale(30, 10000), changeWithheld: { current: 30, baseline: 5, min: 20 } } }],
  });
  const [overall, gangnam] = html.split("</tr>");
  assert.match(overall, /<span class="count">증감 보류 — 이번 주 집계 중\(23건\)<\/span>/);
  assert.match(overall, /<span class="count">증감 보류 — 비교 주 표본 부족\(19건\)<\/span>/);
  assert.doesNotMatch(overall, /class="change|23건<\/span><\/td>|<strong|<b>/);
  assert.doesNotMatch(gangnam, /증감 보류|class="change/);
  assert.match(gangnam, /<span class="count">30건<\/span>/);
});

test("index 는 보류 문구를 ko·en 짝으로 그리기만 하고 방향 클래스·굵게가 없다, 건수 없는 칸은 표본 부족이다", async () => {
  const realestate = JSON.parse(await readFile(path.join(root, "docs/data/realestate.json"), "utf8"));
  const { change: _a, baselineDate: _b, ...overallSale } = realestate.overall.sale;
  const { change: _c, baselineDate: _d, ...overallJeonse } = realestate.overall.jeonse;
  const patched = {
    ...realestate,
    overall: { ...realestate.overall, sale: { ...overallSale, transactionCount: 23, changeWithheld: WITHHELD_NOW }, jeonse: { ...overallJeonse, transactionCount: 281, changeWithheld: WITHHELD_BASE }, wolse: { avgDeposit10k: 20000, avgMonthlyRent10k: 90 } },
  };
  const grid = async (lang) => {
    const page = await loadIndexPage({
      storage: { lang },
      fetch: async (url) => {
        const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
        const body = name === "realestate" ? patched : JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8").catch(() => "{}"));
        return { ok: true, json: async () => body };
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    return page.byId("realestate-grid").innerHTML.split("</tr>")[0];
  };
  const ko = await grid("ko");
  assert.match(ko, /<span class="tx-count">증감 보류 — 이번 주 집계 중\(23건\)<\/span>/);
  assert.match(ko, /<span class="tx-count">증감 보류 — 비교 주 표본 부족\(19건\)<\/span>/);
  const en = await grid("en");
  assert.match(en, /<span class="tx-count">Change withheld — week still filling \(23 deals\)<\/span>/);
  assert.match(en, /<span class="tx-count">Change withheld — comparison week too thin \(19 deals\)<\/span>/);
  for (const row of [ko, en]) assert.doesNotMatch(row, /class="change|▲|▼|<strong|<b>/);
  // 건수 필드가 없는 지표(월세 칸)는 브라우저도 빌드(hasEnoughSample)처럼 0건으로 보아 표본 부족이다.
  assert.match(ko, /표본 0건/);
  assert.match(en, /0 txns only/);
});

test("구운 보류 문구(realestate-rows)와 index 의 한국어 사전 문구가 같다", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const text = html.match(/realestateWithheld: \(n, now\) => `(증감 보류[^`]*)`/)[1];
  const ko = new Function("n", "now", `return \`${text}\`;`);
  assert.equal(withheldOf({ changeWithheld: WITHHELD_NOW }), ko(23, true));
  assert.equal(withheldOf({ changeWithheld: WITHHELD_BASE }), ko(19, false));
  assert.equal(withheldOf({ sale: 1 }), null);
});

const readData = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const hasKey = (value, key) => JSON.stringify(value).includes(`"${key}"`);

test("history 에는 change·changeWithheld 가 들어가지 않는다 - attachChanges 는 입력을 바꾸지 않고, 옛 증감·보류도 걷는다", async () => {
  assert.equal(hasKey(await readData("realestate-history"), "changeWithheld"), false);
  assert.equal(hasKey(await readData("realestate-history"), "change"), false, "history 에 change 가 있다");
  const overall = { ...empty, sale: sale(23, 6476) };
  const districts = [{ code: "1", name: "a", sale: sale(30, 9000) }];
  const before = JSON.stringify([overall, districts]);
  build(overall, districts);
  assert.equal(JSON.stringify([overall, districts]), before, "appendHistory 에 넘기는 값이 오염된다");
  // 지난번 값으로 채운 구(carryForward)는 옛 증감·보류를 들고 온다 - 같이 걷는다.
  // 바꾼 단언(#862 3단계): 예전에는 보류(changeWithheld.baseline 5)로 바뀌어 남았다.
  const stale = { code: "1", name: "a", sale: { ...sale(30, 9000), change: { value10k: 1, percent: 1 }, baselineDate: "2026-10-01", changeWithheld: { current: 30, baseline: 5, min: 20 } } };
  const out = build(empty, [stale]).districts[0].sale;
  assert.deepEqual([out.change, out.baselineDate, out.changeWithheld], [undefined, undefined, undefined]);
});

test("옛 모양(changeWithheld 없음)과 새 모양을 index·시세 틀·구운 표·뉴스 칩이 예외 없이 굽고, 옛 모양은 보류 흔적이 없다", async () => {
  // 옛 모양 = 지금 data 에서 changeWithheld 를 걷은 것(다음 Daily 가 새 모양을 쓰면 data 자체가 새 모양이 된다).
  const old = JSON.parse(JSON.stringify(await readData("realestate"), (k, v) => (k === "changeWithheld" ? undefined : v)));
  const fresh = structuredClone(old);
  fresh.overall.sale = { ...fresh.overall.sale, changeWithheld: WITHHELD_NOW };
  delete fresh.overall.sale.change;
  fresh.districts[0].sale = { ...fresh.districts[0].sale, changeWithheld: WITHHELD_BASE };
  delete fresh.districts[0].sale.change;
  // 구운 표: 옛 모양은 overall 플래그와 상관없이 같은 칸이다.
  const { metricCell } = await import("../scripts/realestate-rows.ts");
  for (const k of ["sale", "jeonse", "wolse"]) assert.deepEqual(metricCell(k, old.overall[k], true), metricCell(k, old.overall[k], false));
  for (const data of [old, fresh]) {
    assert.ok(realestateHtml(data).startsWith("<tr>"));
    assert.ok(buildContext({ title: "서울 아파트 매매", preview: "" }, { realestate: data }) !== undefined);
    const page = await loadRealestatePage({ realestate: data });
    assert.ok(String(page.byId("district-grid").innerHTML).includes("<tr"));
    await loadIndexPage({ fetch: async () => ({ ok: true, json: async () => data }) });
  }
  assert.doesNotMatch(realestateHtml(old), /증감 보류/);
  assert.match(realestateHtml(fresh), /증감 보류/);
});
