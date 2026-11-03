// 관심 단지(#732 X5). deal-search 인라인 스크립트를 가짜 DOM(test/helpers/deal-search-page.mjs)에 올린 뒤
// 같은 샌드박스에서 docs/watchlist.js 를 돌린다(브라우저에서도 defer 라 인라인 다음에 돈다).
// watchlist.js 가 지키는 것(바이트 한도 때문에 주석을 여기 둔다):
// - 장 전용 외부 JS(#681 예외: gzip ≤2KB, deal-search 만 defer, sw.js 밖). 인라인 전역(cache·district·locale·loadJson·escapeHtml·
//   squash·fullDeals)을 그대로 쓴다. 인라인 카드가 #card-watch 자리와 window.cardApt 를 두고 window.cardWatch() 를 부른다.
//   complex-card.js·complex-chart.js 는 건드리지 않는다. 목록 자리 #watch-list 는 카드 위.
// - localStorage "watchlist" = [[자치구, 단지, [본 신고 줄 키...]], ...] 최대 10곳. 줄 키 = date|area|floor|amount10k.
// - 「새 신고」 = 지금 deals-<gu> 목록에 있는데 지난 방문 때 적어 둔 키에 없던 줄(계약일이 아니라 목록에 새로 나타난 줄 - 늦게 신고된
//   거래도 센다). 기준은 장을 연 순간 읽은 값이라 같은 방문 안에서 다시 그려도 수가 그대로다. 센 뒤 지금 키를 적어 둔다.
// - 모든 저장소 접근은 try/catch(#726). 읽기가 막히면 아무것도 그리지 않고, 쓰기만 막히면 바꾸지 못했다고 적는다. 깨진 값은 빈 목록.
// - 알림·서버·쿠키 없음(O-C 소유자 보류). 새 자료 없음 - 이미 받는 deals-<gu>.json 만 쓴다.
// - 동명 단지(#821): 칸 키가 「이름 (동)」이 되면 #821 전에 담은 「벽산」은 어느 칸과도 맞지 않는다. 그 항목은 지우지 않는다(사용자가 고른 것이고 몇 명인지 못 센다).
//   수는 동별 줄을 합쳐 세고 「여러 동 합산」 표시와 동별 링크를 붙인다. 동 카드에서 담으면 옛 항목과 바꾸므로 수가 늘지 않아 10곳이 차 있어도 된다.
//   ?apt=벽산 은 후보가 둘이라 카드가 없고 빼기 단추도 카드에 있었다. 그래서 목록 줄마다 × 단추를 둔다 - 칸이 없어진 이름도 이 단추로만 지워진다.
//   카드가 없는 화면의 쓰기 실패는 목록 줄에 적는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import vm from "node:vm";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
// 고정 데이터(test/fixtures/site/data, #811): 새 신고 수는 「적어 둔 키에 없는 줄 수」라 APT 에 3건 이상·OTHER 에 1건 이상이 있어야 한다 -
// 실데이터 deals-nowon 은 그 단지 신고가 없는 달 깨진다. complex-card-nowon: 상계주공7(고층) 5건, 중계무지개 1건.
const fixtureRead = (name) => readFile(path.join(import.meta.dirname, `fixtures/site/data/${name}.json`), "utf8").then(JSON.parse);
const JS = await readFile(path.join(root, "docs/watchlist.js"), "utf8");
const HTML = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
const APT = "상계주공7(고층)";
const OTHER = "중계무지개";
const CARD = await fixtureRead("complex-card-nowon");
const DEALS = CARD.deals;
const keysOf = (apt) => DEALS.deals.filter((d) => d.apt === apt).map((d) => `${d.date}|${d.area}|${d.floor}|${d.amount10k}`);

const settle = async (n = 40) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 5));
};

/** saved: 저장소 값(문자열 그대로 또는 객체), storage: "read"(읽기부터 막힘)·"write"(쓰기만 막힘). */
async function page({ locale = "ko", query = `?district=노원구&apt=${APT}`, saved, storage, deals = DEALS } = {}) {
  const budget = await fixtureRead("budget-deals");
  const p = await loadDealSearchPage({ budget, search: CARD.search, deals: { 노원구: deals }, rents: { 노원구: CARD.rents }, locale, query });
  await settle();
  const items = new Map([["lang", locale]]);
  if (saved !== undefined) items.set("watchlist", typeof saved === "string" ? saved : JSON.stringify(saved));
  const boom = () => {
    throw new Error("storage blocked");
  };
  p.sandbox.localStorage = {
    getItem: (k) => (storage === "read" ? boom() : items.get(k) ?? null),
    setItem: (k, v) => (storage ? boom() : items.set(k, String(v))),
  };
  new vm.Script(JS, { filename: "docs/watchlist.js" }).runInContext(p.sandbox);
  p.sandbox.window.cardWatch(); // 인라인 renderResult 가 다시 그릴 때와 같다.
  await settle();
  const click = async () => (p.byId("watch-toggle").onclick(), settle());
  // 목록 줄의 × 단추. 단추는 innerHTML 글자로만 있어 위임 처리기에 data-w 를 넘긴다. 처리기는 단추가 아닌 곳의 클릭을 무시해야 한다.
  const drop = async (w) => (p.byId("watch-list").onclick({ target: { dataset: w === undefined ? {} : { w: String(w) } } }), settle());
  const stored = () => (items.has("watchlist") ? JSON.parse(items.get("watchlist")) : undefined);
  return { ...p, items, stored, click, drop, card: () => p.byId("card-watch").innerHTML, list: () => p.byId("watch-list").innerHTML };
}

test("빈 목록: 카드에 담기 단추만, 목록 자리는 비고 수는 없다", async () => {
  const p = await page();
  assert.match(p.byId("complex-card").innerHTML, /<\/h2><div id="card-watch"><\/div>/);
  assert.equal(p.card(), `<p><button type="button" class="chip" id="watch-toggle" aria-pressed="false">관심 단지 담기</button></p>`);
  assert.equal(p.list(), "");
  assert.equal(p.stored(), undefined, "보기만 했는데 저장소에 썼다");
});

test("담으면 지금 신고 줄을 적어 두고 새 신고 없음, 다시 누르면 뺀다", async () => {
  const p = await page();
  await p.click();
  assert.deepEqual(p.stored(), [["노원구", APT, keysOf(APT)]]);
  assert.match(p.card(), /aria-pressed="true">관심 단지 빼기<\/button> <span class="count">지난 방문 뒤 새 신고 없음<\/span>/);
  assert.match(p.list(), /<strong>관심 단지<\/strong> · <a href="\.\/deal-search\.html\?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=/);
  assert.match(p.list(), /이 브라우저에만 저장합니다\./);
  await p.click();
  assert.deepEqual(p.stored(), []);
  assert.match(p.card(), /관심 단지 담기/);
  assert.equal(p.list(), "");
});

test("재방문: 지난번 적어 둔 키에 없던 줄 수를 보이고, 같은 방문 안에서 다시 그려도 그대로, 저장은 지금 키로", async () => {
  const all = keysOf(APT);
  assert.ok(all.length >= 3, "픽스처 단지 거래가 너무 적다");
  const p = await page({ saved: [["노원구", APT, all.slice(2)]] });
  assert.match(p.card(), /<span class="count">지난 방문 뒤 새 신고 2건<\/span>/);
  assert.match(p.list(), /지난 방문 뒤 새 신고 2건/);
  assert.deepEqual(p.stored(), [["노원구", APT, all]]);
  p.sandbox.window.cardWatch();
  await settle();
  assert.match(p.card(), /새 신고 2건/, "같은 방문 안에서 수가 사라졌다");
  // 목록에서 빠진 옛 줄(두 달 창 밖)은 새 신고로 세지 않는다.
  const q = await page({ saved: [["노원구", APT, [...all, "2020-01-01|1|1|1"]]] });
  assert.match(q.card(), /새 신고 없음/);
});

test("다른 단지는 카드를 안 열어도 목록에서 그 구 거래 목록으로 센다 - 단지 미선택 화면", async () => {
  const keys = keysOf(OTHER);
  const p = await page({ query: "?district=노원구", saved: [["노원구", OTHER, keys.slice(1)], ["노원구", "없는단지", []]] });
  assert.match(p.list(), new RegExp(`${OTHER}</a> <span class="count">지난 방문 뒤 새 신고 1건</span>`));
  assert.match(p.list(), /없는단지<\/a> <span class="count">지난 방문 뒤 새 신고 없음<\/span>/);
  assert.equal(p.card(), "", "단지를 안 골랐는데 카드 줄이 생겼다");
});

test("저장소 읽기가 막히면 아무것도 그리지 않고 예외도 없다(#726)", async () => {
  const p = await page({ storage: "read", saved: [["노원구", APT, []]] });
  assert.equal(p.card(), "");
  assert.equal(p.list(), "");
  assert.match(p.resultHtml(), /\S/, "검색 결과가 사라졌다");
});

test("쓰기만 막히면 담지 못했다고 적고 상태는 그대로", async () => {
  const p = await page({ storage: "write" });
  await p.click();
  assert.match(p.card(), /aria-pressed="false">관심 단지 담기<\/button> <span role="status">저장소를 쓸 수 없어 바꾸지 못했습니다\.<\/span>/);
  assert.equal(p.list(), "");
});

test("깨진 값·모양이 다른 값은 빈 목록으로 읽는다", async () => {
  for (const saved of ["{not json", '{"a":1}', JSON.stringify([1, ["노원구"], ["노원구", APT, "x"]])]) {
    const p = await page({ saved });
    assert.match(p.card(), /aria-pressed="false">관심 단지 담기/, saved);
    assert.equal(p.list(), "", saved);
  }
});

test("10곳이 차면 더 담지 않고 한도를 적는다", async () => {
  const ten = Array.from({ length: 10 }, (_, i) => ["노원구", `단지${i}`, []]);
  const p = await page({ saved: ten });
  await p.click();
  assert.match(p.card(), /<span role="status">관심 단지는 10곳까지 담을 수 있습니다\.<\/span>/);
  assert.equal(p.stored().length, 10);
  assert.ok(!p.stored().some((e) => e[1] === APT));
  const many = await page({ saved: [...ten, ["노원구", "열한째", []]] });
  assert.ok(!many.list().includes("열한째"), "한도 넘는 값을 그렸다");
});

test("영어 화면은 같은 줄을 영어로", async () => {
  const all = keysOf(APT);
  const p = await page({ locale: "en", saved: [["노원구", APT, all.slice(1)]] });
  assert.match(p.card(), /aria-pressed="true">Unwatch<\/button> <span class="count">1 new report since your last visit<\/span>/);
  assert.doesNotMatch(p.card(), /[가-힣]/, "영어 카드 줄에 한글이 남았다");
  assert.match(p.list(), /<strong>Watchlist<\/strong>.*Stored in this browser only\./);
  const q = await page({ locale: "en", saved: [["노원구", APT, all.slice(3)]] });
  assert.match(q.card(), /3 new reports since your last visit/);
  const e = await page({ locale: "en" });
  assert.match(e.card(), />Watch this complex<\/button>/);
});

// 동명 단지 고정 데이터: 픽스처 줄 하나를 빌려 두 동의 키로 복제한다(값은 시험과 무관, 줄 키만 달라야 한다).
const OLD = "벽산";
const DONG_A = "벽산 (상계동)";
const DONG_B = "벽산 (중계동)";
const twin = (apt, floor) => ({ ...DEALS.deals.find((d) => d.apt === APT), apt, floor });
const TWINS = { ...DEALS, deals: [...DEALS.deals, twin(DONG_A, 3), twin(DONG_A, 4), twin(DONG_B, 5)] };
const twinKeys = TWINS.deals.filter((d) => String(d.apt).startsWith(`${OLD} (`)).map((d) => `${d.date}|${d.area}|${d.floor}|${d.amount10k}`);
const OLD_QUERY = `?district=노원구&apt=${OLD}`;
const dongLink = (apt) => `apt=${encodeURIComponent(apt).replace(/%20/g, "\\+").replace(/\(/g, "%28").replace(/\)/g, "%29")}">${apt.replace(/[()]/g, "\\$&")}</a>`;

test("옛 항목(#821): ?apt=벽산 은 카드가 없어도 목록에 합산 표시·동별 링크·수가 있고 × 로 지워진다", async () => {
  const p = await page({ query: OLD_QUERY, deals: TWINS, saved: [["노원구", OLD, twinKeys.slice(1)]] });
  assert.equal(p.card(), "", "후보가 둘이면 카드가 없어야 이 회귀를 재현한다");
  assert.match(p.list(), /벽산<\/a> <span class="count">여러 동 합산<\/span> /);
  assert.match(p.list(), new RegExp(dongLink(DONG_A)));
  assert.match(p.list(), new RegExp(dongLink(DONG_B)));
  assert.equal(p.list().split(`${DONG_A}</a>`).length, 2, "같은 동 링크가 줄 수만큼 겹쳤다");
  assert.match(p.list(), /<span class="count">지난 방문 뒤 새 신고 1건<\/span>/, "동별 줄을 합쳐 세야 한다");
  assert.match(p.list(), /<button type="button" class="chip" data-w="0" aria-label="관심 단지 빼기 벽산">×<\/button>/);
  await p.drop();
  assert.equal(p.stored().length, 1, "단추가 아닌 곳을 눌렀는데 지웠다");
  await p.drop(0);
  assert.deepEqual(p.stored(), []);
  assert.equal(p.list(), "");
});

test("× 는 그 줄만 지우고, 칸이 없어진 이름도 지운다. 동명이 아닌 줄에는 합산 표시가 없다", async () => {
  const saved = [["노원구", OTHER, keysOf(OTHER)], ["노원구", "없는단지", []], ["노원구", APT, keysOf(APT)]];
  const p = await page({ saved });
  assert.doesNotMatch(p.list(), /합산/);
  await p.drop(1);
  assert.deepEqual(p.stored().map((e) => e[1]), [OTHER, APT]);
  assert.match(p.card(), /aria-pressed="true">관심 단지 빼기/);
  await p.drop(1);
  assert.deepEqual(p.stored().map((e) => e[1]), [OTHER]);
  assert.match(p.card(), /aria-pressed="false">관심 단지 담기/, "지운 단지의 카드 줄이 그대로다");
});

test("옛 항목은 동 카드에서 담으면 바뀌고, 10곳이 차 있어도 된다 - 다른 단지는 그대로 거부", async () => {
  const others = Array.from({ length: 9 }, (_, i) => ["노원구", `단지${i}`, []]);
  const p = await page({ query: `?district=노원구&apt=${DONG_A}`, deals: TWINS, saved: [["노원구", OLD, twinKeys], ...others] });
  assert.match(p.card(), /aria-pressed="false">관심 단지 담기/);
  await p.click();
  assert.equal(p.stored().length, 10);
  assert.ok(!p.stored().some((e) => e[1] === OLD), "옛 항목이 남았다");
  assert.deepEqual(p.stored().at(-1)[1], DONG_A);
  assert.doesNotMatch(p.card(), /10곳까지/);
  assert.match(p.card(), /aria-pressed="true">관심 단지 빼기<\/button> <span class="count">지난 방문 뒤 새 신고 없음/);
  assert.doesNotMatch(p.list(), /합산/);
  // 다른 구의 같은 이름은 옛 항목이 아니다.
  const q = await page({ query: `?district=노원구&apt=${DONG_A}`, deals: TWINS, saved: [["성동구", OLD, []], ...others, ["노원구", "단지9", []]] });
  await q.click();
  assert.match(q.card(), /10곳까지/);
  assert.ok(q.stored().some((e) => e[0] === "성동구" && e[1] === OLD));
});

test("카드 없는 화면에서 × 쓰기가 막히면 목록에 적고 상태는 그대로, 카드가 있으면 카드에만 적는다", async () => {
  const p = await page({ query: OLD_QUERY, deals: TWINS, storage: "write", saved: [["노원구", OLD, twinKeys]] });
  await p.drop(0);
  assert.match(p.list(), /<span role="status">저장소를 쓸 수 없어 바꾸지 못했습니다\.<\/span>/);
  assert.equal(p.stored().length, 1);
  const q = await page({ storage: "write", saved: [["노원구", APT, keysOf(APT)]] });
  await q.drop(0);
  assert.match(q.card(), /role="status"/);
  assert.doesNotMatch(q.list(), /role="status"/, "같은 문장을 두 번 알렸다");
});

test("옛 항목 표시는 영어로도 낸다", async () => {
  const p = await page({ locale: "en", query: OLD_QUERY, deals: TWINS, saved: [["노원구", OLD, twinKeys]] });
  assert.match(p.list(), /<span class="count">dongs combined<\/span>/);
  assert.match(p.list(), /aria-label="Unwatch 벽산">×<\/button>/);
  assert.doesNotMatch(p.list().replace(/벽산|상계동|중계동|%[0-9A-F]{2}/g, ""), /[가-힣]/, "영어 줄에 한글 문구가 남았다");
});

test("외부 JS 는 gzip ≤2,048B, deal-search 만 defer 로 한 번 읽고 서비스워커 사전캐시에 없다 (#681 예외)", async () => {
  const size = gzipSync(JS, { level: 9 }).length;
  assert.ok(size <= 2048, `docs/watchlist.js gzip ${size}B`);
  assert.equal(HTML.split('<script src="./watchlist.js" defer></script>').length, 2);
  assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes("watchlist"), "sw.js 사전캐시에 들어갔다");
  for (const f of (await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html") && f !== "deal-search.html")) {
    assert.ok(!(await readFile(path.join(root, "docs", f), "utf8")).includes("watchlist.js"), `${f} 가 watchlist.js 를 읽는다`);
  }
});
