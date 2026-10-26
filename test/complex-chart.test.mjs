// 단지 카드 24개월 매매 추이(#728 X1 PR2). deal-search 인라인 스크립트를 가짜 DOM(test/helpers/deal-search-page.mjs)에 올린 뒤
// 같은 샌드박스에서 docs/complex-chart.js 를 돌린다(브라우저에서도 defer 라 인라인 다음에 돈다).
// complex-chart.js 가 지키는 것(바이트 한도 때문에 주석을 여기 둔다):
// - 장 전용 외부 JS 두 번째 파일(#736 판정: complex-card.js 2 KB 와 따로, gzip ≤900B, deal-search 만 defer, sw.js 밖).
//   인라인 전역(cache·district·locale·loadJson·formatEok)을 그대로 쓴다. 인라인 카드가 #card-chart 자리와 window.cardApt 를 두고
//   window.complexChart() 를 부른다. complex-card.js 는 건드리지 않는다.
// - 자료 = docs/data/complex-history-<slug>.json(scripts/build-complex-history.ts). 카드가 열릴 때 그 구 파일만 한 번 받는다.
//   cells[단지][평형] = [[YYYYMM, 월 중앙값(만원), 건수], ...], 창은 from~to 24개월(HISTORY_MONTHS) 고정이라 x = 달 번호 × 10.
// - 칸 = 이 단지에서 n≥3 달이 가장 많은 평형 하나(선으로 그릴 수 있는 칸, 같으면 파일 순서). 선은 n≥3 달만 잇고 n<3 달은 숨긴다(#728 판정).
//   n≥3 달이 둘 미만이면 그림 없이 #637 틀 이유(「비움: n≥3 달 k」).
// - 글 대안: 그림은 aria-hidden, 바로 아래 줄에 평형·n≥3 달 수·첫 달/끝 달 중앙값을 글로 적는다. 판정 문구·색 경고 없음.
// - 404·실패·구 미선택(slug 없음)은 자리를 비운다(soft-fail). 카드의 나머지는 그대로.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import vm from "node:vm";
import { HISTORY_MONTHS } from "../scripts/build-complex-history.ts";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const JS = await readFile(path.join(root, "docs/complex-chart.js"), "utf8");
const APT = "상계주공7(고층)";
const VERDICT = /비싸|싸다|싼 |저렴|적정|고평가|저평가|합리|바가지|급등|급락|폭등|폭락|expensive|cheap|fair|overpriced|underpriced|bargain|reasonable|soar|crash/i;

const settle = async (n = 40) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 5));
};

const FIXTURE = {
  district: "노원구",
  from: "202411",
  to: "202610",
  cells: {
    [APT]: {
      // n≥3 달 셋(202411·202505·202610), 얇은 달 둘(n 1·2)은 숨긴다.
      "59.39": [["202411", 50000, 3], ["202501", 99000, 1], ["202505", 52000, 4], ["202508", 10000, 2], ["202610", 56000, 6]],
      // 건수 합(40)은 더 많지만 n≥3 달이 하나라 고르지 않는다.
      "41.3": [["202411", 30000, 40]],
    },
    얇은단지: { "84.9": [["202411", 70000, 9], ["202412", 71000, 2]] },
  },
};

async function page({ locale = "ko", query = `?district=노원구&apt=${APT}`, files = { "complex-history-nowon": FIXTURE }, fetch } = {}) {
  const [budget, search, deals, rents] = await Promise.all([readJson("budget-deals"), readJson("deal-search"), readJson("deals-nowon"), readJson("rents-nowon")]);
  const p = await loadDealSearchPage({ budget, search, deals: { 노원구: deals }, rents: { 노원구: rents }, files, locale, query });
  await settle();
  const asked = [];
  const real = p.sandbox.fetch;
  p.sandbox.fetch = (url) => (asked.push(String(url)), (fetch ?? real)(url));
  new vm.Script(JS, { filename: "docs/complex-chart.js" }).runInContext(p.sandbox);
  await settle();
  const draw = (apt) => (new vm.Script(`window.cardApt = ${JSON.stringify(apt)}; window.complexChart();`).runInContext(p.sandbox), settle());
  return { ...p, asked: () => asked.filter((u) => u.includes("complex-history")), box: () => p.byId("card-chart").innerHTML, draw };
}
const points = (html) => html.match(/points="([^"]*)"/)?.[1].split(" ").map((xy) => xy.split(",").map(Number)) ?? [];

test("창은 24개월이라 x 를 달 번호 × 10 으로 둔다(빌드 상수와 어긋나면 깨진다)", () => {
  assert.equal(HISTORY_MONTHS, 24);
  assert.match(JS, /viewBox="0 0 232 60"/);
});

test("n≥3 달이 가장 많은 평형의 n≥3 달만 선으로 잇고 얇은 달은 숨긴다, 아래 줄이 글 대안", async () => {
  const p = await page();
  const html = p.box();
  assert.match(html, /^<h3>24개월 매매 추이<\/h3><svg [^>]*aria-hidden="true"/);
  const pts = points(html);
  assert.deepEqual(pts.map(([x]) => x), [2, 62, 232], "n<3 달(202501·202508)이 선에 들어갔거나 달 위치가 틀렸다");
  assert.deepEqual(pts.map(([, y]) => y), [58, 39, 2], "최저가 아래·최고가 위가 아니다");
  assert.match(html, /<p class="content-notice">59\.39㎡ 월 중간값, n≥3 달 3: 2024\.11 5억원 → 2026\.10 5억 6,000만원<\/p>$/);
  assert.doesNotMatch(html, /9억|1,000만원/, "얇은 달 값이 글에 섞였다");
  // 카드의 나머지는 그대로이고 자리 하나만 더했다.
  assert.match(p.byId("complex-card").innerHTML, /<div id="card-chart"><\/div><p id="card-rank"><\/p><div id="card-renewal">/);
});

test("n≥3 달이 둘 미만인 칸은 그림 없이 이유를 적는다", async () => {
  const p = await page();
  await p.draw("얇은단지");
  assert.equal(p.box(), '<h3>24개월 매매 추이</h3><p class="low-sample">84.9㎡ 비움: n≥3 달 1</p>');
  const en = await page({ locale: "en" });
  await en.draw("얇은단지");
  assert.equal(en.box(), '<h3>24-month sale trend</h3><p class="low-sample">84.9㎡ blank: n≥3 months 1</p>');
  // 파일에 없는 단지는 자리를 비운다.
  await p.draw("없는단지");
  assert.equal(p.box(), "");
});

test("영어 화면은 영어 제목·글 대안, 판정 문구는 원본에도 화면에도 없다", async () => {
  const p = await page({ locale: "en" });
  assert.match(p.box(), /^<h3>24-month sale trend<\/h3><svg/);
  assert.match(p.box(), /59\.39㎡ monthly median, n≥3 months 3: 2024\.11 ₩500M → 2026\.10 ₩560M<\/p>$/);
  assert.doesNotMatch(JS, VERDICT);
  assert.doesNotMatch(p.box() + (await page()).box(), VERDICT);
});

test("구 파일은 카드가 열릴 때 그 구 하나만 한 번 받는다", async () => {
  const none = await page({ query: "?district=노원구" });
  assert.deepEqual(none.asked(), [], "카드가 없는데 받았다");
  assert.equal(none.box(), "");
  const p = await page();
  assert.equal(p.asked().length, 1);
  assert.match(p.asked()[0], /\/data\/complex-history-nowon\.json/);
  await p.draw("얇은단지");
  await p.draw(APT);
  assert.equal(p.asked().length, 1, "같은 구를 다시 받았다");
});

test("파일이 없거나(404) 받다 실패하거나 구가 없으면 자리만 비우고 카드는 그대로", async () => {
  const missing = await page({ files: {} });
  assert.equal(missing.box(), "");
  assert.equal(missing.asked().length, 1);
  const down = await page({ fetch: async () => { throw new TypeError("network down"); } });
  assert.equal(down.box(), "");
  assert.match(down.byId("complex-card").innerHTML, /<div id="card-chart"><\/div>/);
  const noGu = await page({ query: `?apt=${APT}` });
  assert.equal(noGu.box(), "");
  assert.deepEqual(noGu.asked(), []);
});

test("실데이터: 노원구 파일로 실제 단지 추이가 그려진다", async () => {
  const p = await page({ files: { "complex-history-nowon": await readJson("complex-history-nowon") } });
  const pts = points(p.box());
  assert.ok(pts.length >= 2, "실데이터 단지에서 선이 안 그려졌다");
  assert.ok(pts.every(([x, y]) => x >= 2 && x <= 232 && y >= 2 && y <= 58));
  assert.match(p.box(), /㎡ 월 중간값, n≥3 달 \d+: \d{4}\.\d{2} /);
});

test("외부 JS 는 deal-search 만 defer 로 읽고 sw.js 사전캐시 밖, gzip ≤900B", async () => {
  for (const f of (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html"))) {
    const html = await readFile(path.join(root, "docs", f), "utf8");
    assert.equal(html.split('<script src="./complex-chart.js" defer></script>').length, f === "deal-search.html" ? 2 : 1, f);
  }
  assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes("complex-chart.js"), "sw.js 사전캐시에 들어갔다");
  const gz = gzipSync(JS, { level: 9 }).length;
  assert.ok(gz <= 900, `complex-chart.js gzip ${gz}B > 900B`);
});
