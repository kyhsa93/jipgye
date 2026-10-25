import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) =>
  readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

let loaded = null;

// (#520) 추이 카드를 그리는 두 시험은 합성 추이로 돈다: 주 목록과 주 키(overall 의 키)가 맞아야 카드가 그려지는데, 실제 파일을 읽으면 그날 데이터의 모양
// (잠정 주가 있는가, 주 키가 어긋났는가)에 시험이 기댄다. 아래 합성 추이는 일부러 오늘 데이터와 아무 관계가 없다(주 목록·값 모두 손으로 둔 것).
const MONDAYS = ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30", "2026-04-06"];
const PENDING = ["2026-04-13", "2026-04-20"];
const syntheticTrend = ({ pending }) => {
  const pendingWeeks = pending ? PENDING : [];
  const entry = (i) => ({
    sale: { avgPricePerPyeong10k: 4000 + i * 25, transactionCount: 500 + i * 7, national84: { avgPricePerPyeong10k: 3900 + i * 20, transactionCount: 120 + i } },
    jeonse: { avgDepositPerPyeong10k: 2500 + i * 10, transactionCount: 300 + i * 3 },
    wolse: { transactionCount: 90 + i },
  });
  return {
    updatedAt: "2026-04-21T01:00:00.000Z",
    weeks: MONDAYS,
    pendingWeeks,
    movingWeeks: pendingWeeks,
    settledWeek: MONDAYS.at(-1),
    overall: Object.fromEntries([...MONDAYS, ...pendingWeeks].map((w, i) => [w, entry(i)])),
    districts: {},
  };
};

async function page({ trend, lang } = {}) {
  const names = [
    "summary", "market", "realestate", "news",
    "realestate-trend", "market-history", "summary-history", "news-history",
  ];
  const data = {};
  for (const name of names) data[name] = name === "realestate-trend" && trend ? trend : await readJson(name);
  loaded = data.realestate;
  return loadIndexPage({
    ...(lang ? { storage: { lang } } : {}),
    fetch: async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      return data[name] ? { ok: true, json: async () => data[name] } : { ok: false, json: async () => ({}) };
    },
  });
}

// scripts/realestate-rows.mjs의 MAX_DISTRICTS(prerender.ts가 그린다), index.html의 MAX_VISIBLE_DISTRICTS와 같은 수.
const VISIBLE = 4;
const districtCount = () => loaded.districts.length;
const shownCount = () => Math.min(districtCount(), VISIBLE);

const districtRows = (p) => p.app.document.querySelectorAll("#realestate-grid tr[data-district-name]");
const visible = (p) => districtRows(p).filter((r) => !r.hidden);

test("처음에는 상위 네 개 구만 보인다", async () => {
  const p = await page();
  assert.equal(districtRows(p).length, districtCount(), "받은 구가 DOM에 다 있어야 검색이 된다");
  assert.equal(visible(p).length, shownCount());
});

test("정적 HTML과 보이는 행 수가 같다", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const prerendered = html.split("<!--prerender:realestate-->")[1].split("<!--/prerender")[0];
  const p = await page();
  assert.equal((prerendered.match(/<tr/g) ?? []).length, visible(p).length + 1);
});

test("감춘 구도 검색하면 나온다", async () => {
  const p = await page();
  const hiddenNames = districtRows(p)
    .filter((r) => r.hidden)
    .map((r) => r.getAttribute("data-district-name"));
  assert.equal(hiddenNames.length, districtCount() - shownCount(), "감춘 구 수가 안 맞는다");
  assert.ok(hiddenNames.length > 0, "감춰진 구가 없어 검색으로 되살아나는지 볼 수 없다");

  const target = hiddenNames[0];
  const input = p.byId("realestate-search-input");
  input.value = target;
  input.dispatch("input");

  const shown = visible(p).map((r) => r.getAttribute("data-district-name"));
  assert.ok(shown.includes(target), `${target}를 검색했는데 안 나온다: ${shown.join(", ")}`);
});

test("검색어를 지우면 다시 접힌다", async () => {
  const p = await page();
  const input = p.byId("realestate-search-input");
  input.value = "구";
  input.dispatch("input");
  assert.equal(visible(p).length, districtCount(), "검색 중에는 전체가 대상이어야 한다");

  input.value = "";
  input.dispatch("input");
  assert.equal(visible(p).length, shownCount());
});

const showMore = (p) => p.byId("realestate-show-more");
const clickShowMore = (p) => showMore(p).dispatch("click", { target: { id: "realestate-show-more-button" } });

test("더 보기를 누르면 나머지 구가 펼쳐진다", async () => {
  const p = await page();
  assert.equal(showMore(p).hidden, false, "접어 놓고 펼 방법을 주지 않았다");
  assert.match(showMore(p).innerHTML, /realestate-show-more-button/, "펼치기 버튼이 없다");
  assert.match(
    showMore(p).innerHTML,
    new RegExp(`${districtCount() - shownCount()}`),
    "몇 개가 남았는지 말하지 않는다"
  );

  clickShowMore(p);
  assert.equal(visible(p).length, districtCount(), "펼쳤는데 전부 보이지 않는다");

  clickShowMore(p);
  assert.equal(visible(p).length, shownCount(), "접기가 되지 않는다");
});

test("검색 중에는 접었다는 말을 하지 않는다", async () => {
  const p = await page();
  const input = p.byId("realestate-search-input");
  input.value = "강남";
  input.dispatch("input");
  assert.equal(showMore(p).hidden, true, "검색 결과 밑에 '몇 개 더 보기'가 남았다");

  input.value = "";
  input.dispatch("input");
  assert.equal(showMore(p).hidden, false);
});

test("몇 개가 남았는지 소리로도 알린다", async () => {
  const p = await page();
  assert.match(p.byId("realestate-status").textContent, new RegExp(`${shownCount()}`), "접힌 뒤 건수를 안 알린다");

  const input = p.byId("realestate-search-input");
  input.value = "강남";
  input.dispatch("input");
  assert.match(p.byId("realestate-status").textContent, /1/, "검색 결과 건수를 안 알린다");
  // 뉴스 건수 알림(news-status)은 뉴스 칸과 함께 뉴스 화면으로 옮겼다(#575 PR2).
});

test("메인 화면 추이 카드에도 양 축 눈금과 짚을 자리를 둔다", async () => {
  const p = await page({ trend: syntheticTrend({ pending: true }) });
  const grid = p.byId("realestate-history-grid").innerHTML;

  assert.ok(grid.includes("polyline"), "추이 카드가 그려지지 않았다");
  assert.match(grid, /class="axis y"/, "세로 눈금이 없다");
  assert.match(grid, /class="axis x[^"]*"/, "가로 눈금이 없다");
  assert.match(grid, /class="marker" hidden/, "짚어줄 표시가 없다");
  assert.match(grid, /class="history-chart" id="chart-\d+"/, "차트마다 식별자가 없다");
  assert.ok(!grid.includes('preserveAspectRatio="none"'), "가로로 늘어나 글자가 찌그러진다");
});

// (#520) 예전에는 실제 파일의 pendingWeeks 가 비었는지에 따라 단언이 갈렸고, 비면 점선 없음만 보고 조용히 끝났다(데이터가 한쪽 갈래로 굳으면 점선 단언이 안 돈다).
// 이제 두 갈래를 합성 추이로 각각 항상 돈다.
// 1년 그림(합성 60주 = 확정 56 + 잠정 4, 2025-08-25 ~ 2026-10-12). 해가 바뀌므로 첫 눈금과 해가 바뀐 가운데 눈금에 두 자리 해가 붙는다 -
// 그러지 않으면 첫 눈금(8/25)과 끝 눈금이 한 해 차이인데도 같은 철로 읽힌다. 끝 눈금은 가운데와 같은 해라 짧게 둔다.
const YEAR_MONDAYS = Array.from({ length: 60 }, (_, i) => new Date(Date.parse("2025-08-25T00:00:00Z") + i * 7 * 86_400_000).toISOString().slice(0, 10));
const yearTrend = () => {
  const base = syntheticTrend({ pending: false });
  const entry = base.overall[MONDAYS[0]];
  return { ...base, weeks: YEAR_MONDAYS.slice(0, 56), pendingWeeks: YEAR_MONDAYS.slice(56), overall: Object.fromEntries(YEAR_MONDAYS.map((w) => [w, entry])) };
};

for (const lang of ["ko", "en"]) {
  test(`메인 화면 1년 추이는 60주를 다 그리고 첫·끝 눈금을 해로 가른다 (${lang})`, async () => {
    const p = await page({ trend: yearTrend(), lang });
    const grid = p.byId("realestate-history-grid").innerHTML;
    const first = grid.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";

    const [firm, pending] = [...first.matchAll(/points="([^"]+)"/g)].map((m) => m[1].split(" "));
    assert.equal(firm?.length, 56, "확정 구간을 다 그리지 않았다");
    assert.equal(pending?.length, 5, "잠정 구간이 마지막 확정 지점에서 이어지지 않는다");
    const xLabels = [...first.matchAll(/class="axis x[^"]*">([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(xLabels, ["'25 8/25", "'26 3/16", "10/12"], `해 표시가 없거나 어긋났다: ${xLabels.join(" | ")}`);
  });
}

test("메인 화면 한 해 안의 추이는 눈금에 해를 붙이지 않는다", async () => {
  const p = await page({ trend: syntheticTrend({ pending: true }) });
  const xLabels = [...p.byId("realestate-history-grid").innerHTML.matchAll(/class="axis x[^"]*">([^<]+)</g)].map((m) => m[1]);
  assert.ok(xLabels.length >= 3, "가로 눈금이 그려지지 않았다");
  assert.ok(xLabels.every((label) => /^\d{1,2}\/\d{1,2}$/.test(label)), `한 해 안인데 해를 붙였다: ${xLabels.join(" | ")}`);
});

// 소유자 결정: 접혀 있던 추이 카드(84㎡·전세 거래량·월세 거래량)를 처음부터 펴 둔다. 접는 단추(details)는 남겨 사람이 접을 수는 있다.
test("메인 화면 추이 카드는 처음부터 다 펴져 있다", async () => {
  const p = await page({ trend: syntheticTrend({ pending: false }) });
  const grid = p.byId("realestate-history-grid").innerHTML;

  assert.equal((grid.match(/class="history-card"/g) ?? []).length, 5, "추이 카드 다섯 장이 다 그려지지 않았다");
  const folds = [...grid.matchAll(/<details\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(folds.length > 0, "접는 단추가 사라졌다 - 아래 단언이 빈 채로 통과한다");
  assert.ok(folds.every((tag) => /\sopen(\s|>)/.test(tag)), `접힌 채로 시작하는 추이 카드가 남았다: ${folds.join(" ")}`);
  // 펴진 채로 시작하므로 단추 글이 "더보기"이면 거짓이다 - 무엇이 있는지만 말한다.
  assert.equal(grid.match(/<summary>([^<]*)<\/summary>/)?.[1], "그 외 지표 3개");
  const en = await page({ trend: syntheticTrend({ pending: false }), lang: "en" });
  assert.equal(en.byId("realestate-history-grid").innerHTML.match(/<summary>([^<]*)<\/summary>/)?.[1], "3 more indicators");
});

// 소유자 결정: 모든 추이 카드를 같은 크기로. 폭은 격자가(auto-fill — 카드 수와 상관없이 같은 칸), 키는 그래프 120px 와
// 값 두 줄(현재값 아래 최고·최저)이 정한다. 자리 예약(.trend-reserve-card)이 그 두 줄을 같이 잡아야 데이터가 올 때 안 밀린다.
test("추이 카드 크기 규칙: 같은 칸 폭, 값 두 줄, 예약도 두 줄", async () => {
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const rule = (sel) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.:()]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";

  assert.match(rule(".history-grid"), /grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 300px\), 1fr\)\)/, "카드 수에 따라 폭이 달라진다");
  assert.match(rule(".history-stats"), /flex-direction: column/, "값 줄이 폭에 따라 한 줄·두 줄로 갈린다");
  assert.match(rule(".trend-reserve-card::before"), /content: "\\00a0\\A\\00a0";[\s\S]*white-space: pre/, "예약 카드가 라벨·최고최저 두 줄을 잡지 않는다");

  const index = await readFile(path.join(root, "docs/index.html"), "utf8");
  assert.match(index, /h: 120,/, "그래프 높이가 120px 하나가 아니다");
  assert.match(index, /const h = CHART\.h;/, "그래프 높이가 폭을 따라간다");
});

test("메인 화면도 덜 찬 주를 점선으로 잇는다", async () => {
  const p = await page({ trend: syntheticTrend({ pending: true }) });
  const grid = p.byId("realestate-history-grid").innerHTML;

  assert.match(grid, /class="[^"]*\bpending\b[^"]*"[^>]*stroke-dasharray/, "잠정 구간이 점선이 아니다");
  assert.match(
    p.byId("realestate-history-note").textContent,
    /점선/,
    "점선이 무엇인지 밝히지 않았다"
  );
});

test("메인 화면은 잠정 주가 없으면 점선을 긋지 않고 안내도 하지 않는다", async () => {
  const p = await page({ trend: syntheticTrend({ pending: false }) });
  const grid = p.byId("realestate-history-grid").innerHTML;

  assert.ok(grid.includes("polyline"), "추이 카드가 그려지지 않았다 - 아래 단언이 빈 화면에서 통과한다");
  assert.ok(!grid.includes('spark pending'), "잠정 주가 없는데 점선을 그었다");
  assert.ok(!/stroke-dasharray/.test(grid), "잠정 주가 없는데 점선 속성이 남았다");
  assert.equal(p.byId("realestate-history-note").textContent, "", "잠정 주가 없는데 점선 안내가 남았다");
});

// 시장 지표(환율·기준금리) 추이 차트는 메인에서 뺐다 - 값 한 줄만 남는다(#575 PR2). 차트를 그리는 함수는 실거래 추이가 계속 쓴다.
test("메인에는 시장 지표 추이 격자가 없다", async () => {
  const p = await page();
  assert.equal(p.byId("history-grid").innerHTML, "", "시장 지표 추이를 다시 그렸다");
  assert.doesNotMatch(await readFile(path.join(root, "docs/index.html"), "utf8"), /id="history-grid"|market-history/);
});
