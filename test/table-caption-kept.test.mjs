import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadPage, stubElement } from "./helpers/digest-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

/**
 * 화면 스크립트가 표를 다시 그려도 빌드가 단 caption(sr-only, data-auto)은 남는다 (#300).
 *
 * 분석 6장은 표를 `table.innerHTML = ...`로 통째로 갈아 끼웠고, `<table>`의 직접 자식인 caption이 같이 지워졌다.
 * 눈에 보이는 화면은 그대로여서 스크린리더 사용자만 표의 이름을 잃었다. 구운 caption 15개가 대상이다
 * (cancelled-deals 3 · renewal-vs-new 2 · floor-gap 1 · record-high 1 · switch-house 2 · price-outlook 6).
 *
 * 이 저장소의 시험 환경에는 진짜 DOM이 없어서 표를 스스로 모형으로 세운다 - `innerHTML = ...`은 자식을 전부 갈아 끼우므로
 * caption도 지우고, `querySelector("caption")`·`prepend(caption)`은 caption 자리를 읽고 되돌린다. 그 위에서
 * 그 장에 실려 나간 스크립트를 그대로 돌려, 구운 caption이 남았는지와 다시 그려졌는지(쓰기 횟수)를 함께 본다.
 * 값은 구운 장에서 읽는다(목록에서 꺼내 넣으면 장과 목록이 어긋나는 것을 못 본다). 데이터·날짜에 기대지 않는다(#8).
 */

const root = path.resolve(import.meta.dirname, "..");
const CAPTION = /<caption class="sr-only" data-auto>[\s\S]*?<\/caption>/;

/** 구운 표의 모형: caption 자리와 나머지 내용을 따로 쥐고, innerHTML 쓰기는 둘 다 갈아 끼운다. */
function bakedTable(id, bakedHtml) {
  const tag = new RegExp(`<table[^>]*id="${id}"[^>]*>([\\s\\S]*?)</table>`).exec(bakedHtml);
  assert.ok(tag, `${id}: 구운 표가 없다`);
  const caption = CAPTION.exec(tag[1]);
  assert.ok(caption, `${id}: 구운 caption이 없다`);
  const state = { caption: { outerHTML: caption[0] }, body: tag[1].replace(CAPTION, ""), writes: 0 };
  const el = stubElement({}, id);
  Object.defineProperties(el, {
    innerHTML: {
      get: () => (state.caption?.outerHTML ?? "") + state.body,
      set: (value) => {
        state.writes += 1;
        state.caption = null; // 진짜 DOM에서도 innerHTML 쓰기는 caption을 포함한 자식을 전부 버린다
        state.body = String(value);
      },
    },
    querySelector: { value: (sel) => (sel === "caption" ? state.caption : null) },
    prepend: { value: (node) => (state.caption = node) },
  });
  return { el, state, baked: caption[0] };
}

const T = (marker) => ({
  ko: `<thead><tr><th scope="col">${marker}</th></tr></thead><tbody><tr><td>가</td></tr></tbody>`,
  en: `<thead><tr><th scope="col">${marker}</th></tr></thead><tbody><tr><td>A</td></tr></tbody>`,
});
const LEAD = { ko: "한국어 문장", en: "english sentence", leadKo: "한국어 문장", leadEn: "english sentence" };

/** 장마다: 파일 · 표 id · 스크립트가 읽는 자료(최소한의 모양). */
const PAGES = [
  {
    file: "cancelled-deals.html",
    ids: ["district-table", "month-table", "price-table"],
    data: {
      cancellation: {
        districts: [{ district: "가구", deals: 1, cancelled: 0, cancelledShare: 0, stale: 0, staleShare: 0 }],
        registrationByMonth: [{ month: "2026-03", filed: 1, registered: 1, share: 100 }],
        priceBands: { lead: LEAD, table: T("price") },
        seoul: { ...LEAD, registration: { matureMonths: [] } },
        slugs: {},
      },
    },
  },
  {
    file: "renewal-vs-new.html",
    ids: ["district-table", "wolse-table"],
    data: {
      "renewal-facts": {
        table: [{ district: "가구", gapMedian: 1, gapCheaperShare: 1, gapMatched: 1, capMissShare: 1, rightUsed: 1 }],
        wolseLead: LEAD,
        wolseTable: [{ district: "가구", median: 1, range: [{ median: 1 }], cheaperShare: 1, matched: 1 }],
        seoul: { wolse: { rate: 4.8, range: [{ rate: 3 }, { rate: 10 }] } },
        slugs: {},
      },
    },
  },
  {
    file: "floor-gap.html",
    ids: ["district-table"],
    data: { "floor-gap": { districts: [{ district: "가구", median: -1, cells: 1, distinct: true }], slugs: {} } },
  },
  {
    file: "record-high.html",
    ids: ["robust-table"],
    data: { "record-high": { main: {}, tables: { robust: T("robust") } } },
  },
  {
    file: "switch-house.html",
    ids: ["district-table", "region-table"],
    data: {
      "district-change": {
        rows: [
          { code: "A", name: "가구", change: null },
          { code: "B", name: "나구", change: null },
        ],
        table: T("district"),
        regionTable: T("region"),
        slugs: {},
      },
    },
  },
  {
    file: "price-outlook.html",
    ids: ["region-table", "nowcast-table", "move-in-table", "move-in-districts", "score-table", "indicator-table"],
    data: {
      outlook: { regions: [{}], tables: { regions: T("regions"), nowcast: T("nowcast"), score: T("score") } },
      "outlook-indicators": { lead: LEAD, table: T("indicator") },
      "move-in": { lead: LEAD, table: T("move-in"), districts: LEAD, districtTable: T("districts") },
    },
  },
];

const TOTAL = PAGES.reduce((n, p) => n + p.ids.length, 0);

async function open(page, locale) {
  const html = await readFile(path.join(root, SITE, page.file), "utf8");
  const tables = Object.fromEntries(page.ids.map((id) => [id, bakedTable(id, html)]));
  const seed = Object.fromEntries(Object.entries(tables).map(([id, t]) => [id, t.el]));
  const loaded = await loadPage({ file: page.file, data: page.data, locale, seed });
  return { tables, loaded };
}

const check = (page, tables, mode) => {
  for (const id of page.ids) {
    const { state, baked } = tables[id];
    assert.ok(state.writes > 0, `${page.file} #${id} (${mode}): 시험이 표를 다시 그리게 하지 못했다 - 시험이 헛돈다`);
    assert.equal(state.caption?.outerHTML, baked, `${page.file} #${id} (${mode}): 다시 그린 뒤 구운 caption이 사라졌다`);
  }
};

test("시험 대상은 구운 caption 15개다(6장)", () => {
  assert.equal(PAGES.length, 6);
  assert.equal(TOTAL, 15);
});

for (const page of PAGES) {
  test(`${page.file}: 표를 다시 그려도 구운 caption이 남는다 - 한국어·영어·다시 한국어`, async () => {
    const { tables, loaded } = await open(page, "ko");
    check(page, tables, "ko");

    // 언어를 영어로 바꾸면 모든 표를 다시 그린다. caption은 구운 한국어 그대로 남는다(영어 문안은 #122).
    await loaded.click("lang-toggle");
    for (const id of page.ids) assert.ok(tables[id].state.writes >= 2, `${page.file} #${id}: 영어로 바꿔도 다시 그리지 않았다`);
    check(page, tables, "ko→en");

    await loaded.click("lang-toggle");
    check(page, tables, "ko→en→ko");
  });

  test(`${page.file}: 영어로 열어도 구운 caption이 남는다`, async () => {
    const { tables } = await open(page, "en");
    check(page, tables, "en");
  });
}
