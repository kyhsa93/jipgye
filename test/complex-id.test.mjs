// 동명 단지 칸 분리(#821). 값은 전부 지어낸 고정 데이터다 - 실데이터 값·건수·날짜에 기대지 않는다.
// 지키는 것: 구 안에서 둘 이상의 동에 있는 이름만 「이름 (동)」으로 갈리고, 이름이 유일한 칸은 키도 바이트도 그대로다.
// 칸을 쓰는 파일(위치·추이·재계약·전세가율·거래 목록)이 같은 키를 낸다 - 어긋나면 카드가 칸을 못 찾는다.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildHistoryFiles } from "../scripts/build-complex-history.ts";
import { buildFiles } from "../scripts/build-complex-price.ts";
import { buildFiles as buildRenewalFiles } from "../scripts/build-renewal-cells.ts";
import { complexesByDistrict } from "../scripts/build-search-index.ts";
import { complexKey, complexName, keyedDeal, sameNames } from "../scripts/complex-id.ts";
import { cellRatioEntries, cellRatios } from "../scripts/complex-ratio.ts";
import { buildDealFiles, buildRentFiles } from "../scripts/deal-files.ts";
import { districtFacts, factSentences } from "../scripts/district-facts.ts";
import { districtCounts } from "../scripts/jeonse-risk.ts";
import { buildLedger, complexHash, versionFor } from "../scripts/ledger-snapshot.ts";
import { readSameNames } from "../scripts/realestate-raw.ts";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";
import { complexFiles, rawSlots } from "./ledger-fixtures/source.mjs";

const SHA = "a".repeat(40);
const license = { sale: "제한 없음", rent: "제한 없음", checkedOn: "2026-11-01" };
const SEONGDONG = "11200";
const NOW = new Date("2026-10-01T00:00:00Z");
const index = { series: { 200: [["202606", 100], ["202607", 100], ["202608", 100]], 201: [["202606", 100], ["202607", 100], ["202608", 100]], 202: [["202606", 100], ["202607", 100], ["202608", 100]], 203: [["202606", 100], ["202607", 100], ["202608", 100]], 204: [["202606", 100], ["202607", 100], ["202608", 100]], 205: [["202606", 100], ["202607", 100], ["202608", 100]] } };

const sale = (umdNm, amount, over = {}) => ({ sggCd: 11200, aptNm: "벽산", umdNm, jibun: "1", excluUseAr: 84.82, dealAmount: amount, dealYear: 2026, dealMonth: 6, dealDay: 15, dealingGbn: "중개거래", cdealType: "", floor: 3, buildYear: 2000, ...over });
const rent = (umdNm, deposit, over = {}) => ({ sggCd: 11200, aptNm: "벽산", umdNm, excluUseAr: 84.82, deposit, monthlyRent: 0, contractType: "신규", dealYear: 2026, dealMonth: 6, dealDay: 15, ...over });
const renewal = (umdNm, over = {}) => rent(umdNm, "42,000", { contractType: "갱신", preDeposit: "40,000", preMonthlyRent: 0, useRRRight: "사용", ...over });

// 금호동1가·사근동의 벽산(비싼 곳·싼 곳)과 이름이 유일한 옆 단지 하나.
const SALES = [
  ...["190,000", "180,000", "200,000"].map((a) => sale("금호동1가", a)),
  ...["100,000", "105,000", "110,000"].map((a) => sale("사근동", a)),
  ...["70,000", "71,000", "72,000"].map((a) => sale("행당동", a, { aptNm: "옆단지", excluUseAr: 59.9 })),
];
const YEAR_AGO = [
  ...["150,000", "150,000", "150,000"].map((a) => sale("금호동1가", a, { dealYear: 2025 })),
  ...["80,000", "80,000", "80,000"].map((a) => sale("사근동", a, { dealYear: 2025 })),
];
const SAME = { [SEONGDONG]: new Set(["벽산"]) };

const price = (sameNames) => buildFiles({ itemsByDistrict: { [SEONGDONG]: SALES }, yearAgoByDistrict: { [SEONGDONG]: YEAR_AGO }, yearAgoMonths: ["202506"], index, outlook: null, now: NOW, sameNames }).files.seongdong;

test("키: 둘 이상의 동에 있는 이름만 「이름 (동)」, 이름이 유일하면 받은 글자 그대로", () => {
  const same = sameNames([sale("금호동1가", "1"), sale("사근동", "1"), sale("행당동", "1", { aptNm: "옆단지" }), sale("행당동", "1", { aptNm: "옆단지" }), sale("", "1", { aptNm: "동없음" })]);
  assert.deepEqual([...same], ["벽산"]);
  assert.equal(complexKey("벽산", "사근동", same), "벽산 (사근동)");
  assert.equal(complexKey("옆단지", "행당동", same), "옆단지");
  assert.equal(complexKey("벽산", "", same), "벽산", "동이 없는 줄에 빈 괄호를 붙였다");
  assert.equal(complexKey("벽산", "사근동"), "벽산", "동명 목록이 없으면 지금 키와 같아야 한다");
  assert.equal(complexName("벽산 (사근동)", "사근동"), "벽산");
  assert.equal(complexName("상계주공7(고층)", "상계동"), "상계주공7(고층)");
  const deal = { apt: "옆단지", dong: "행당동" };
  assert.equal(keyedDeal(deal, same), deal, "이름이 유일한 거래를 새 객체로 바꿨다");
});

test("원본에서 읽기: 구별로 따로 세고, 매매와 전월세를 합치고, 실패 슬롯은 세지 않는다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "complex-id-"));
  try {
    await mkdir(path.join(dir, "sale"));
    await mkdir(path.join(dir, "rent"));
    const put = (kind, name, body) => writeFile(path.join(dir, kind, `${name}.json`), JSON.stringify(body));
    await put("sale", "11200-202609", { ok: true, items: [sale("금호동1가", "1"), sale("행당동", "1", { aptNm: "옆단지" }), sale("옥수동", "1", { aptNm: "실패만" })] });
    await put("rent", "11200-202601", { ok: true, items: [rent("사근동", "1")] });
    await put("rent", "11200-202602", { ok: false, items: [rent("상왕십리동", "1", { aptNm: "실패만" })] });
    // 다른 구의 같은 이름은 원래 구가 갈라 준다 - 동명 단지가 아니다.
    await put("sale", "11110-202609", { ok: true, items: [sale("창신동", "1", { aptNm: "옆단지" })] });
    await writeFile(path.join(dir, "sale", "모양이-다름.json"), "{");
    const same = await readSameNames(dir);
    assert.deepEqual([...same[SEONGDONG]], ["벽산"]);
    assert.deepEqual([...same["11110"]], []);
    assert.deepEqual(await readSameNames(path.join(dir, "없는-폴더")), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("위치 칸: 동명 단지는 동별로 갈리고 값이 섞이지 않는다", () => {
  const { cells, meta } = price(SAME);
  assert.deepEqual(Object.keys(cells), ["벽산 (금호동1가)", "벽산 (사근동)", "옆단지"]);
  assert.equal(cells["벽산 (금호동1가)"]["84.82"].median, 190000);
  assert.equal(cells["벽산 (사근동)"]["84.82"].median, 105000);
  assert.equal(cells["벽산 (금호동1가)"]["84.82"].yearAgo.median, 150000, "1년 전 값에 다른 동이 섞였다");
  assert.equal(cells["벽산 (사근동)"]["84.82"].yearAgo.median, 80000, "1년 전 값에 다른 동이 섞였다");
  assert.equal(meta["벽산 (사근동)"].dong, "사근동");
  assert.equal(meta["벽산 (금호동1가)"].dong, "금호동1가");
});

test("이름이 유일한 칸은 동명 단지가 갈려도 키·값·바이트가 그대로다", () => {
  const before = price({});
  const after = price(SAME);
  assert.equal(JSON.stringify(after.cells["옆단지"]), JSON.stringify(before.cells["옆단지"]));
  assert.equal(JSON.stringify(after.meta["옆단지"]), JSON.stringify(before.meta["옆단지"]));
  // 동명 단지가 없는 구는 파일 전체가 같다.
  const alone = (sameNames) => JSON.stringify(buildFiles({ itemsByDistrict: { [SEONGDONG]: SALES.slice(6) }, index, outlook: null, now: NOW, sameNames }).files.seongdong);
  assert.equal(alone({ [SEONGDONG]: new Set() }), alone({}));
  assert.equal(alone(SAME), alone({}), "거래가 없는 동명 목록이 파일을 바꿨다");
});

test("24개월 추이: 위치 칸과 같은 키이고 달 값이 섞이지 않는다. 유일한 이름은 그대로", () => {
  const items = { [SEONGDONG]: SALES };
  const files = (sameNames, cells) => buildHistoryFiles({ itemsByDistrict: items, now: NOW, priceCells: { seongdong: cells }, sameNames }).seongdong.cells;
  const after = files(SAME, price(SAME).cells);
  assert.deepEqual(Object.keys(after), Object.keys(price(SAME).cells));
  assert.deepEqual(after["벽산 (사근동)"]["84.82"], [["202606", 105000, 3]]);
  assert.deepEqual(after["벽산 (금호동1가)"]["84.82"], [["202606", 190000, 3]]);
  assert.equal(JSON.stringify(after["옆단지"]), JSON.stringify(files({}, price({}).cells)["옆단지"]));
});

test("재계약 칸: 갱신 짝과 신규 전세가 동별로 갈린다. 유일한 이름은 그대로", () => {
  const rents = [...Array(3).fill(renewal("금호동1가")), ...Array(3).fill(renewal("사근동")), ...Array(3).fill(renewal("행당동", { aptNm: "옆단지" }))];
  const fresh = [...Array(3).fill(rent("금호동1가", "90,000")), ...Array(3).fill(rent("사근동", "50,000"))];
  const build = (sameNames) => buildRenewalFiles({ rentsByDistrict: { [SEONGDONG]: rents }, newByDistrict: { [SEONGDONG]: fresh }, months: ["202411", "202610"], now: NOW, sameNames }).seongdong.cells;
  const cells = build(SAME);
  assert.deepEqual(Object.keys(cells), ["벽산 (금호동1가)", "벽산 (사근동)", "옆단지"]);
  assert.equal(cells["벽산 (금호동1가)"]["84.82"].at(-1), 90000);
  assert.equal(cells["벽산 (사근동)"]["84.82"].at(-1), 50000);
  assert.equal(JSON.stringify(cells["옆단지"]), JSON.stringify(build({})["옆단지"]));
});

test("전세가율 칸: 동별로 갈리고, 전세가율 위험이 위치 파일의 같은 칸을 찾는다", () => {
  const sales = SALES.slice(0, 6);
  const rents = [...Array(3).fill(rent("금호동1가", "95,000")), ...Array(3).fill(rent("사근동", "84,000"))];
  assert.deepEqual(cellRatios(sales, rents, SAME[SEONGDONG]), [50, 80]);
  assert.deepEqual(cellRatios(sales, rents), [(89500 / 145000) * 100], "동명 목록 없이는 지금 칸과 같아야 한다");
  const entries = cellRatioEntries(sales, rents, SAME[SEONGDONG]);
  assert.deepEqual(entries.map((e) => e.key), ["벽산 (금호동1가)|84.82", "벽산 (사근동)|84.82"]);
  const counts = districtCounts(entries, price(SAME).cells);
  assert.deepEqual(counts, { cells: 2, compared: 2, high: 1, highCompared: 1, highFell: 0 }, "키가 어긋나 1년 전 값을 못 찾았다");
});

test("거래 목록·검색 색인: 동명 단지 줄만 키를 달고, 유일한 이름의 줄은 그대로다", () => {
  const deal = (dong, apt = "벽산") => ({ district: "성동구", dong, apt, area: 84.82, amount10k: 100000, deposit10k: 50000, date: "2026-09-01" });
  const source = { period: "202609", districts: { 성동구: [deal("사근동"), deal("금호동1가"), deal("행당동", "옆단지")] } };
  for (const build of [(s) => buildDealFiles(s, NOW, undefined, undefined, SAME), (s) => buildRentFiles(s, NOW, undefined, SAME)]) {
    const { deals } = build(source).seongdong;
    assert.deepEqual(deals.map((d) => d.apt).sort(), ["벽산 (금호동1가)", "벽산 (사근동)", "옆단지"]);
    assert.deepEqual(complexesByDistrict({ 성동구: deals }).성동구.sort(), ["벽산 (금호동1가)", "벽산 (사근동)", "옆단지"]);
  }
  assert.deepEqual(buildDealFiles(source, NOW).seongdong.deals.map((d) => d.apt).sort(), ["벽산", "벽산", "옆단지"], "동명 목록 없이는 지금 파일과 같아야 한다");
});

test("자치구 해설: 동을 앞에 따로 적으므로 키의 동을 되풀이하지 않는다", () => {
  const facts = districtFacts({ periods: ["202609"], deals: [{ dong: "사근동", apt: "벽산 (사근동)", area: 84.82, amount10k: 100000, buildYear: 2000 }] });
  assert.deepEqual([facts.top.dong, facts.top.apt], ["사근동", "벽산"]);
  assert.match(factSentences(facts).join(" "), /사근동 벽산 85㎡/);
});

test("원장: 2026-12 부터 v2, 이미 쓴 달은 v1 그대로. 유일한 이름의 h 는 그대로, 갈린 칸만 새 h", () => {
  assert.equal(versionFor("2026-11"), 1);
  assert.equal(versionFor("2026-12"), 2);
  const files = complexFiles();
  const jongno = files.find((f) => f.json.district === "종로구").json;
  jongno.cells["다라마을 (숭인동)"] = jongno.cells["다라마을"];
  delete jongno.cells["다라마을"];
  const lines = buildLedger({ month: "2026-12", sourceCommit: SHA, license, complexFiles: files, rawSlots: rawSlots() }).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].meta.v, 2);
  assert.equal(lines[0].meta.s, "2026-12-01");
  const hashes = new Set(lines.filter((l) => l.c6).map((l) => l.c6.h));
  assert.ok(hashes.has(complexHash("11110", "바사힐스")));
  assert.ok(hashes.has(complexHash("11110", "다라마을 (숭인동)")));
  assert.ok(!hashes.has(complexHash("11110", "다라마을")));
  const november = buildLedger({ month: "2026-11", sourceCommit: SHA, license, complexFiles: complexFiles(), rawSlots: rawSlots() });
  assert.equal(JSON.parse(november.split("\n")[0]).meta.v, 1);
});

// --- 화면 -------------------------------------------------------------------------

const settle = async (n = 40) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 5));
};
const row = (dong, apt, amount10k, date = "2026-09-20") => ({ dong, apt, area: 84.82, floor: 5, amount10k, date, buildYear: 2000, direct: false });
const DEALS = [
  ...[190000, 180000, 200000].map((a) => row("금호동1가", "벽산 (금호동1가)", a)),
  ...[100000, 105000, 110000].map((a) => row("사근동", "벽산 (사근동)", a)),
  row("행당동", "옆단지", 70000),
];
const SEARCH = { updatedAt: "2026-10-31T03:00:00.000Z", periods: ["202609"], slugs: { 성동구: "seongdong" }, districts: { 성동구: [] } };
const dealFile = { district: "성동구", updatedAt: "2026-10-31T03:00:00.000Z", periods: ["202609"], deals: DEALS };
const rentFile = { district: "성동구", updatedAt: "2026-10-31T03:00:00.000Z", periods: ["202609"], deals: [] };

async function card(query) {
  const budget = JSON.parse(await readFile(path.join(import.meta.dirname, "fixtures/site/data/budget-deals.json"), "utf8"));
  const p = await loadDealSearchPage({ budget, search: SEARCH, deals: { 성동구: dealFile }, rents: { 성동구: rentFile }, complexPrices: { 성동구: price(SAME) }, query });
  await settle();
  return p;
}

test("카드: 고른 동의 칸과 거래만 그리고 제목에 동을 적는다", async () => {
  const p = await card(`?district=성동구&apt=${encodeURIComponent("벽산 (사근동)")}`);
  const html = p.byId("complex-card").innerHTML;
  assert.match(html, /<h2>[^<]*벽산 \(사근동\)/);
  assert.match(html, /price-strong">10억 5,000만원/, "사근동 중앙값이 없다");
  assert.ok(!html.includes("19억"), "금호동1가 값이 사근동 카드에 섞였다");
  assert.match(html, /<td[^>]*>10억 5,000만원 <span class="count">3건/, "전세가율 표의 매매 중앙값에 다른 동이 섞였다");
});

test("옛 주소(동 없는 이름): 어느 동인지 모르면 섞인 카드를 그리지 않고 목록은 두 동 다 보인다", async () => {
  const p = await card("?district=성동구&apt=벽산");
  assert.equal(p.byId("complex-card").innerHTML, "");
  const html = p.resultHtml();
  assert.match(html, /벽산 \(금호동1가\)/);
  assert.match(html, /벽산 \(사근동\)/);
  assert.ok(!html.includes("옆단지"));
});

test("관심 단지: 동을 고른 칸은 그 동만 세고, 옛 항목(동 없는 이름)은 예전처럼 다 세며 새로 담으면 옛 항목을 대신한다", async () => {
  const JS = await readFile(path.join(import.meta.dirname, "../docs/watchlist.js"), "utf8");
  const items = new Map([["lang", "ko"], ["watchlist", JSON.stringify([["성동구", "벽산", ["2026-09-20|84.82|5|190000"]]])]]);
  const p = await card(`?district=성동구&apt=${encodeURIComponent("벽산 (사근동)")}`);
  p.sandbox.localStorage = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)) };
  new vm.Script(JS, { filename: "docs/watchlist.js" }).runInContext(p.sandbox);
  p.sandbox.window.cardWatch();
  await settle();
  assert.match(p.byId("watch-list").innerHTML, /벽산<\/a> <span class="count">지난 방문 뒤 새 신고 5건/, "옛 항목의 수가 0 이 됐다");
  p.byId("watch-toggle").onclick();
  await settle();
  const saved = JSON.parse(items.get("watchlist"));
  assert.deepEqual(saved.map((e) => e[1]), ["벽산 (사근동)"]);
  assert.equal(saved[0][2].length, 3, "다른 동 거래까지 적어 뒀다");
});
