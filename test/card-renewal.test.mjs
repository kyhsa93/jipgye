// 단지 카드 갱신 구간 한 줄(#717 C1). deal-search 인라인 스크립트를 가짜 DOM(test/helpers/deal-search-page.mjs)에 올린 뒤,
// 같은 샌드박스에서 docs/card-renewal.js 를 돌린다(브라우저에서도 defer 라 인라인 다음에 돈다).
// 칸 픽스처는 scripts/renewal-cells.ts 의 countLines·packLines 로 만든다 - 화면의 구간 해석이 빌드 배열 순서와 어긋나면 여기서 깨진다.
// card-renewal.js 가 지키는 것(바이트 한도 때문에 주석을 여기 둔다):
// - 장 전용 외부 JS(#681 예외: gzip ≤2KB, deal-search 만 defer, sw.js 밖). 인라인 전역(cache·district·locale·loadJson·escapeHtml·t)을
//   그대로 쓴다. 인라인 카드가 #card-renewal 자리와 window.cardApt 를 두고 window.cardRenewal() 을 부른다.
// - 칸 = packLines: [사용 표시 down·frozen·low·near·over, 표시 없음 같은 다섯, nw.n, nw.median] - 화면은 1 동결·3 상한 근처·4 초과를 두 줄 합으로.
// - 문턱은 파일의 min(show 3·ratio 5 = 빌드가 싣는 기존 상수). n < ratio 는 비율 없이 「표본 부족(n=…)」.
// - 확인기 링크는 gu·apt·area 만(이 장의 예산·동 등 조건은 싣지 않는다).
// - 평형 줄이 셋 이상이면 위 두 줄만 펼치고 나머지는 <details class="fold"> 로 접는다(#724). 기간·법무 주석 줄은 접지 않는다.
// - 받다 실패하면 카드 안 이 자리만 실패·재시도(#199 틀), 404 는 비운다.
// - 판단(위반·돌려받기 등) 없이 건수·비율만, 요구권은 「사용 표시가 있는 계약」·「한 번만 쓸 수 있습니다」까지(#696 법무).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import vm from "node:vm";
import { BANDS, countLines, packLines, THRESHOLDS } from "../scripts/renewal-cells.ts";
import { SITE } from "./helpers/site-root.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const JS = await readFile(path.join(root, "docs/card-renewal.js"), "utf8");
const HTML = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
const APT = "상계주공7(고층)";

const settle = async (n = 300) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 5));
};

// 짝 목록 → 파일 한 칸. [rr?, band] 를 count 번.
const cell = (...spec) => {
  const pairs = spec.flatMap(([rr, band, count]) => Array.from({ length: count }, () => ({ rr, band })));
  return [...packLines(countLines(pairs)), 0, null];
};
const FIXTURE = {
  updatedAt: "2026-10-25T00:00:00.000Z",
  window: ["202411", "202610"],
  min: THRESHOLDS,
  cells: {
    [APT]: {
      // 섞임: n 10, 사용 표시 5, 상한 근처 4(40%)·초과 2(20%)·동결 2(20%)
      "59.39": cell([true, "near", 3], [true, "frozen", 1], [true, "low", 1], [false, "over", 2], [false, "near", 1], [false, "frozen", 1], [false, "down", 1]),
      // 동결만
      "41.3": cell([false, "frozen", 6]),
      // 상한 꽉 채움
      "79.07": cell([true, "near", 5]),
      // 표본 부족(3 ≤ n < 5)
      "45.9": cell([true, "low", 2], [false, "over", 2]),
    },
  },
  fallback: {},
};

async function page({ locale = "ko", query = `?district=노원구&apt=${APT}`, files = { "renewal-cells-nowon": FIXTURE }, network } = {}) {
  const [budget, search, deals, rents] = await Promise.all([readJson("budget-deals"), readJson("deal-search"), readJson("deals-nowon"), readJson("rents-nowon")]);
  const p = await loadDealSearchPage({ budget, search, deals: { 노원구: deals }, rents: { 노원구: rents }, files, network, locale, query });
  await settle(40);
  new vm.Script(JS, { filename: "docs/card-renewal.js" }).runInContext(p.sandbox);
  await settle(40);
  return { ...p, box: () => p.byId("card-renewal").innerHTML };
}
const texts = (html) => [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1].replaceAll("&amp;", "&"), "https://x/"));

test("구간 순서는 renewal-cells.ts BANDS 그대로다(화면은 1=동결·3=상한 근처·4=초과를 읽는다)", () => {
  assert.deepEqual([...BANDS], ["down", "frozen", "low", "near", "over"]);
  assert.deepEqual(THRESHOLDS, { show: 3, ratio: 5 });
});

test("면적마다 갱신 n건·상한 근처·초과·동결 비율, 미달은 표본 부족(n=…) - ko", async () => {
  const p = await page();
  const html = p.box();
  assert.match(html, /<h3>갱신 계약 구간<\/h3>/);
  assert.deepEqual(texts(html), [
    "59.39㎡ 갱신 10건(사용 표시가 있는 계약 5건): 상한 근처 40%·초과 20%·동결 20%",
    "41.3㎡ 갱신 6건(사용 표시가 있는 계약 0건): 상한 근처 0%·초과 0%·동결 100%",
    "79.07㎡ 갱신 5건(사용 표시가 있는 계약 5건): 상한 근처 100%·초과 0%·동결 0%",
    "45.9㎡ 표본 부족(n=4)",
  ]);
  // 표본 미달 칸은 숫자(비율) 0
  assert.doesNotMatch(texts(html)[3], /%/);
  assert.match(html, /2024\.11~2026\.10 갱신으로 신고된 전세 계약/);
  assert.match(html, /요구권은 한 번만 쓸 수 있습니다\(주택임대차보호법 제6조의3\)\./);
  // 법률 판단 문구 0(#696 법무 한도)
  assert.doesNotMatch(html, /위반|돌려받|불법|English|Some of it/);
  // 카드의 나머지(가격·전세가율)는 그대로
  assert.match(p.byId("complex-card").innerHTML, /<div id="card-renewal"><\/div>/);
});

test("평형 줄이 셋 이상이면 위 두 줄만 펼치고 나머지는 접는다 - 기간·법무 주석은 접지 않는다 (#724)", async () => {
  const html = (await page()).box();
  const [open, rest] = html.split("<details");
  assert.equal(texts(open).length, 2);
  assert.deepEqual(texts(open).map((x) => x.split("㎡")[0]), ["59.39", "41.3"]);
  assert.match(rest, /^ class="fold"><summary>나머지 평형 2개<\/summary><ul>/);
  const [inside, after] = rest.split("</details>");
  assert.deepEqual(texts(inside).map((x) => x.split("㎡")[0]), ["79.07", "45.9"]);
  assert.match(after, /^<p class="content-notice">2024\.11~2026\.10 .*동결 = 보증금 그대로.*한 번만 쓸 수 있습니다/);
  const en = (await page({ locale: "en" })).box();
  assert.match(en, /<summary>2 more sizes<\/summary>/);
  assert.match(en.split("</details>")[1], /frozen = same deposit/);
  // 두 줄 이하면 접지 않는다
  const two = { ...FIXTURE, cells: { [APT]: { "59.39": FIXTURE.cells[APT]["59.39"], "41.3": FIXTURE.cells[APT]["41.3"] } } };
  const h2 = (await page({ files: { "renewal-cells-nowon": two } })).box();
  assert.equal(texts(h2).length, 2);
  assert.doesNotMatch(h2, /<details/);
});

test("영어 화면은 같은 칸을 영어로", async () => {
  const p = await page({ locale: "en" });
  const html = p.box();
  assert.match(html, /<h3>Renewal bands<\/h3>/);
  assert.deepEqual(texts(html), [
    "59.39㎡ 10 renewals (5 marked as using the renewal right): near the 5% cap 40% · above 5% 20% · frozen 20%",
    "41.3㎡ 6 renewals (0 marked as using the renewal right): near the 5% cap 0% · above 5% 0% · frozen 100%",
    "79.07㎡ 5 renewals (5 marked as using the renewal right): near the 5% cap 100% · above 5% 0% · frozen 0%",
    "45.9㎡ Too few (n=4)",
  ]);
  assert.match(html, /The right can be used only once \(Housing Lease Protection Act, Article 6-3\)\./);
  assert.doesNotMatch(html, /[가-힣]/, "영어 화면에 한글이 남았다");
});

test("면적 링크는 재계약 확인기(renewal-vs-new)로 gu·apt·area 셋만 싣는다 - 이 장의 다른 조건은 새지 않는다", async () => {
  const p = await page({ query: `?district=노원구&apt=${APT}&budget=5&dong=상계동&direct=exclude&area=60to85&age=new` });
  const urls = hrefs(p.box());
  assert.equal(urls.length, 4);
  for (const u of urls) {
    assert.equal(u.pathname, "/renewal-vs-new.html");
    assert.deepEqual([...u.searchParams.keys()], ["gu", "apt", "area"]);
    assert.equal(u.searchParams.get("gu"), "nowon");
    assert.equal(u.searchParams.get("apt"), APT);
  }
  assert.deepEqual(urls.map((u) => u.searchParams.get("area")), ["59.39", "41.3", "79.07", "45.9"]);
  // 확인기의 평형 선택지 값은 칸 키 그대로다(renewal-vs-new.html renderCheck 의 own) - 같은 키를 넘긴다.
  assert.ok(urls.every((u) => u.searchParams.get("area") in FIXTURE.cells[APT]));
});

test("칸이 없는 단지는 표본 부족 한 줄과 확인기 링크(gu·apt) - 숫자 0", async () => {
  const empty = { ...FIXTURE, cells: {} };
  const p = await page({ files: { "renewal-cells-nowon": empty } });
  const html = p.box();
  assert.match(html, /평형마다 갱신 신고가 3건 미만이라 표본 부족입니다\./);
  assert.doesNotMatch(html, /<li>|\d%·/);
  const [u] = hrefs(html);
  assert.deepEqual([...u.searchParams.keys()], ["gu", "apt"]);
});

test("파일이 없으면(404) 자리를 비우고, 받다 실패하면 카드 안 그 자리만 실패·재시도(#199 틀)", async () => {
  const none = await page({ files: {} });
  assert.equal(none.box(), "");

  const network = { failRenewal: true };
  const p = await page({ network });
  const failed = p.byId("card-renewal");
  assert.match(failed.innerHTML, /<p class="empty">갱신 구간을 불러오지 못했습니다\. <button type="button" id="load-retry-renewal-card">다시 시도<\/button><\/p>/);
  // 카드의 가격·전세가율은 그대로 그려져 있다
  assert.match(p.byId("complex-card").innerHTML, /전세가율/);
  network.failRenewal = false;
  p.byId("load-retry-renewal-card").dispatch("click", { currentTarget: {} });
  await settle(40);
  assert.equal(texts(p.box()).length, 4);
});

test("단지를 고르지 않으면 갱신 줄도 없다", async () => {
  const p = await page({ query: "?district=노원구" });
  assert.equal(p.box(), "");
});

test("실데이터 30단지(구마다 고르게, 순서 고정): 칸이 있는 단지는 칸마다 한 줄 - 표시율 100%", async () => {
  const names = (await readdir(path.join(root, "docs/data"))).filter((f) => /^renewal-cells-[a-z]+\.json$/.test(f)).sort();
  const files = {};
  for (const f of names) files[f.slice(0, -5)] = await readJson(f.slice(0, -5));
  const p = await page({ files });
  const slugs = (await readJson("deal-search")).slugs;
  const picks = [];
  for (let i = 0; picks.length < 30 && i < 400; i += 1) {
    const [gu, slug] = Object.entries(slugs)[i % 25];
    const apts = Object.keys(files[`renewal-cells-${slug}`]?.cells ?? {});
    if (apts.length) picks.push([gu, apts[(i * 7919) % apts.length]]);
  }
  assert.equal(picks.length, 30);
  for (const [gu, apt] of picks) {
    new vm.Script(`district = ${JSON.stringify(gu)}; window.cardApt = ${JSON.stringify(apt)}; window.cardRenewal();`).runInContext(p.sandbox);
    await settle(4);
    const want = Object.keys(files[`renewal-cells-${slugs[gu]}`].cells[apt]).length;
    assert.equal(texts(p.box()).length, want, `${gu} ${apt}`);
  }
});

test("외부 JS 는 gzip ≤2,048B, deal-search 만 defer 로 한 번 읽고 서비스워커 사전캐시에 없다 (#681 예외)", async () => {
  const size = gzipSync(JS, { level: 9 }).length;
  assert.ok(size <= 2048, `docs/card-renewal.js gzip ${size}B`);
  assert.equal(HTML.split('<script src="./card-renewal.js" defer></script>').length, 2);
  assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes("card-renewal"), "sw.js 사전캐시에 들어갔다");
  const users = [];
  for (const f of (await readdir(path.join(root, SITE))).filter((x) => x.endsWith(".html")).sort()) {
    if ((await readFile(path.join(root, SITE, f), "utf8")).includes("card-renewal.js")) users.push(f);
  }
  assert.deepEqual(users, ["deal-search.html"]);
});
