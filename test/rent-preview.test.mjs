import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PREVIEW_ROWS, buildPayload } from "../scripts/build-rent-preview.ts";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const NOW = new Date("2026-08-29T00:00:00Z");

// renewal: false = 원본 계약구분 「신규」(normalizeRentDeal). 빈칸이면 renewal 이 없다.
const deal = (extra = {}) => ({ dong: "상계동", apt: "가상", area: 59, floor: 3, deposit10k: 40000, date: "2026-08-01", renewal: false, ...extra });

test("전세와 월세를 갈라 담고 갱신은 뺀다", () => {
  const payload = buildPayload({
    now: NOW,
    byDistrict: {
      노원구: {
        periods: ["202608"],
        deals: [
          deal(),
          deal({ monthlyRent10k: 80 }),
          // 시세와 같은 규칙 - 갱신은 이전 조건을 잇는 것이라 지금 값이 아니다.
          deal({ renewal: true }),
        ],
      },
    },
  });
  assert.equal(payload.jeonse.total, 1);
  assert.equal(payload.wolse.total, 1);
  assert.equal(payload.jeonse.deals[0].district, "노원구", "어느 구 거래인지 안 담겼다");
});

test("계약구분이 빈 거래(renewal 없음)는 시세처럼 뺀다 (#910)", () => {
  const blank = (extra = {}) => {
    const { renewal: _r, ...rest } = deal(extra);
    return rest;
  };
  const payload = buildPayload({
    now: NOW,
    byDistrict: { 노원구: { periods: ["202608"], deals: [deal(), blank({ apt: "빈칸" }), blank({ apt: "빈칸월세", monthlyRent10k: 50 }), deal({ monthlyRent10k: 80 })] } },
  });
  assert.equal(payload.jeonse.total, 1, "계약구분이 빈 전세를 세었다");
  assert.equal(payload.wolse.total, 1, "계약구분이 빈 월세를 세었다");
  assert.ok(!payload.jeonse.deals.some((d) => d.apt === "빈칸"), "계약구분이 빈 전세가 목록에 담겼다");
});

test("담는 순서가 매일 같다", () => {
  // 같은 날짜가 여럿이면 읽어 온 순서대로 담히고, 그러면 값이 그대로여도 매일 diff가 난다.
  const rows = (order) => ({
    노원구: { deals: order.map((apt) => deal({ apt, date: "2026-08-01" })) },
  });
  const a = buildPayload({ now: NOW, byDistrict: rows(["다", "가", "나"]) });
  const b = buildPayload({ now: NOW, byDistrict: rows(["나", "다", "가"]) });
  assert.deepEqual(
    a.jeonse.deals.map((d) => d.apt),
    b.jeonse.deals.map((d) => d.apt)
  );
});

test("최근 것부터 정해진 수만 담는다", () => {
  const deals = Array.from({ length: PREVIEW_ROWS + 20 }, (_, i) =>
    deal({ apt: `가상${i}`, date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}` })
  );
  const payload = buildPayload({ now: NOW, byDistrict: { 노원구: { deals } } });
  assert.equal(payload.jeonse.deals.length, PREVIEW_ROWS);
  assert.equal(payload.jeonse.total, deals.length, "건수는 담은 수가 아니라 전체여야 한다");
  const dates = payload.jeonse.deals.map((d) => d.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "최근 것부터가 아니다");
});

test("전월세 신고가 없으면 만들지 않는다", () => {
  assert.equal(buildPayload({ now: NOW, byDistrict: { 노원구: { deals: [] } } }), null);
});

// --- 화면 ------------------------------------------------------------------

// 화면 시험의 맛보기 파일은 빌더(buildPayload)로 만든 고정 값이다 - 실데이터 rent-preview.json 은 전세·월세 어느 쪽이 0건인 날
// 「빈 화면이 아니다」「월 n만원」이 깨진다(#811). 월세 23만원은 예전 「월 23만원만원」 결함 그대로.
const PREVIEW = () =>
  buildPayload({
    now: NOW,
    byDistrict: { 노원구: { periods: ["202608"], deals: [deal(), deal({ apt: "가상월세", monthlyRent10k: 23, deposit10k: 1000 })] } },
  });

const load = async (extra) => {
  const page = await loadDealSearchPage({
    budget: await readJson("budget-deals"),
    search: await readJson("deal-search"),
    ...extra,
  });
  for (let i = 0; i < 300 && !page.resultHtml(); i += 1) await new Promise((r) => setTimeout(r, 5));
  return page;
};
const settle = async () => {
  for (let i = 0; i < 200; i += 1) await new Promise((r) => setTimeout(r, 5));
};

test("전세로 바꿔도 빈 화면이 아니다", async () => {
  const page = await load({ rentPreview: PREVIEW() });
  page.chooseKind("jeonse");
  await settle();
  const html = page.resultHtml();
  assert.match(html, /서울 전체 전세에서/, "서울 전체 건수를 안 보여준다");
  assert.match(html, /budget-deal/, "거래 목록이 없다");
});

// 미리보기 건수 문장이 실제로 센 범위를 말하는지(#929). total 은 전세·월세 모두 계약구분 「신규」만 센 수다
// (build-rent-preview.ts 가 갱신·빈칸을 kind 를 가르기 전에 뺀다). 전세는 35건(표시 30건)·월세 3건이라
// 문장의 수가 표시 수나 다른 탭의 수, 갱신·빈칸을 더한 수와 갈린다.
const NEW_ONLY_PREVIEW = () => {
  const blank = (extra) => {
    const { renewal: _r, ...rest } = deal(extra);
    return rest;
  };
  const day = (i) => `2026-08-${String((i % 28) + 1).padStart(2, "0")}`;
  return buildPayload({
    now: NOW,
    byDistrict: {
      노원구: {
        periods: ["202608"],
        deals: [
          ...Array.from({ length: 35 }, (_, i) => deal({ apt: `전세${i}`, date: day(i) })),
          deal({ apt: "전세갱신1", renewal: true }),
          deal({ apt: "전세갱신2", renewal: true }),
          blank({ apt: "전세빈칸" }),
          ...Array.from({ length: 3 }, (_, i) => deal({ apt: `월세${i}`, monthlyRent10k: 50, date: day(i) })),
          deal({ apt: "월세갱신", monthlyRent10k: 50, renewal: true }),
          blank({ apt: "월세빈칸", monthlyRent10k: 50 }),
        ],
      },
    },
  });
};

const NEW_ONLY_CASES = [
  { locale: "ko", kind: "jeonse", total: 35, line: "서울 전체 전세에서 35건이 거래됐습니다. 계약구분이 「신규」인 신고만 셉니다(갱신·미표기 제외).", note: "자치구를 고르면 건수는 조건에 맞는 전부를 셉니다." },
  { locale: "ko", kind: "wolse", total: 3, line: "서울 전체 월세에서 3건이 거래됐습니다. 계약구분이 「신규」인 신고만 셉니다(갱신·미표기 제외).", note: "자치구를 고르면 건수는 조건에 맞는 전부를 셉니다." },
  { locale: "en", kind: "jeonse", total: 35, line: "35 deals filed in All of Seoul, Jeonse. New contracts only (renewals and blank types excluded).", note: "with a district chosen, the count covers every filing that matches." },
  { locale: "en", kind: "wolse", total: 3, line: "3 deals filed in All of Seoul, Monthly rent. New contracts only (renewals and blank types excluded).", note: "with a district chosen, the count covers every filing that matches." },
];

for (const c of NEW_ONLY_CASES) {
  test(`서울 전체 미리보기 건수 문장은 신규만 센다고 말한다 - ${c.locale} ${c.kind} (#929)`, async () => {
    const preview = NEW_ONLY_PREVIEW();
    // 전제: 문장의 수가 total 에서만 올 수 있게 갈라 둔 자료다.
    assert.equal(preview[c.kind].total, c.total);
    assert.equal(preview.jeonse.deals.length, PREVIEW_ROWS);
    assert.notEqual(preview.jeonse.total, preview.wolse.total);

    const page = await load({ rentPreview: preview, locale: c.locale });
    page.chooseKind(c.kind);
    await settle();
    const html = page.resultHtml();
    assert.ok(html.includes(`<p class="budget-summary">${c.line}`), `미리보기 건수 문장이 다르다: ${html.slice(0, 300)}`);
    // 같은 화면에 「전부를 센다」가 남으면 위 문장과 어긋난다 - rentNote 는 그 구절을 자치구 목록으로 좁혀 말한다.
    const note = page.byId("search-note").textContent;
    assert.ok(note.includes(c.note), `rentNote 가 범위를 좁히지 않았다: ${note}`);
  });
}

test("조건을 걸면 맛보기로 세지 않는다", async () => {
  // 최근 서른 건 위에서 "60㎡ 미만"을 세면 서울에서 그 조건에 맞는 거래 수가
  // 아니라 이 목록 안의 수가 나온다. 화면에서는 구별되지 않는다.
  const page = await load({ rentPreview: PREVIEW() });
  page.chooseKind("jeonse");
  page.chooseArea("under60");
  await settle();
  const html = page.resultHtml();
  assert.ok(!/budget-deal/.test(html), "맛보기 목록 위에서 조건을 걸어 세었다");
  assert.match(html, /지역을 하나 골라야/);
});

test("맛보기 파일이 없으면 전과 똑같이 돈다", async () => {
  const page = await load({});
  page.chooseKind("jeonse");
  await settle();
  assert.match(page.resultHtml(), /지역을 하나 골라야/);
});

test("월세 값에 단위를 두 번 붙이지 않는다", async () => {
  const page = await load({ rentPreview: PREVIEW() });
  page.chooseKind("wolse");
  await settle();
  assert.ok(!/만원만원/.test(page.resultHtml()), "월 23만원만원 - 단위가 겹쳤다");
  assert.match(page.resultHtml(), /월 \d[\d,]*만원/);
});
