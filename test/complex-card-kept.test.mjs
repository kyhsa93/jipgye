import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_PAGES } from "../scripts/district-slugs.ts";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

/**
 * 구운 "전세가율 단지별 중앙값" 카드가 데이터를 받는 동안·못 받았을 때 살아 있는지 본다(#311).
 *
 * 왜 사라졌었나: `complex-ratio.json`은 `realestate.json` 다음에 받는데, 시세가 도착하면 `renderOverall()`이
 * `#overall-cards`를 통째로 다시 쓴다. 그때 `cache.complexRatio`가 아직 없으면 `complexSpread()`가 null이고
 * `complexCard()`가 빈 문자열이라, 빌드가 구워 둔 카드가 지워졌다. 요청이 실패하거나 404면 그 방문 내내 없었다.
 *
 * 값이 **왔는데** 표본이 모자라 없는 것(`spread`가 null)은 다른 경우다 - 그때는 그대로 빼야 한다(DIRECTION 해자 2:
 * 표본이 모자라면 값을 내지 않는다). 그 둘을 가르는 것까지 여기서 고정한다.
 *
 * 날짜·데이터 값에 기대지 않는다(#8): 어느 장에 카드가 구워져 있는지를 적어 두지 않고 **그 장의 구운 HTML에서
 * 읽어** 판정한다. 종로구처럼 표본이 모자라 카드가 없는 장은 "없는 자리에 무엇이 생기지 않는다"로 뒤집어 본다.
 */

const root = path.resolve(import.meta.dirname, "..");
const CARD_RE = /<div class="overall-card">[\s\S]*?<\/div><\/div>/g;

// 카드 라벨은 틀에서 읽는다(베껴 적으면 틀이 바뀔 때 시험만 옛 글자를 보고 통과한다).
// 구운 조각은 늘 한국어지만 되세우는 쪽은 숫자만 가져가고 라벨은 그 화면의 locale로 다시 세운다(po 판정, PR #324) -
// 그래서 영어 화면에서는 값이 오기 전에도 영어 라벨이어야 한다.
const TEMPLATE = await readFile(path.join(root, "scripts/realestate-template.html"), "utf8");
const LABELS = Object.fromEntries(
  [...TEMPLATE.matchAll(/ {4}thRatioByComplex: "([^"]+)",/g)].map((m, i) => [["ko", "en"][i], m[1]])
);
assert.equal(Object.keys(LABELS).length, 2, "틀에서 전세가율 단지별 중앙값 라벨 둘을 못 찾았다");
const LABEL = LABELS.ko;

/** 그 장에 구워져 나간 #overall-cards 안쪽. 프리렌더 마커 사이가 그 요소의 innerHTML이다. */
async function bakedOverall(file) {
  const html = await readFile(path.join(root, file), "utf8");
  const open = "<!--prerender:realestateOverall-->";
  const close = "<!--/prerender:realestateOverall-->";
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  assert.ok(start >= 0 && end > start, `${file}: 프리렌더 마커가 없다`);
  const inner = `${open}${html.slice(start + open.length, end)}${close}`;
  const kind = /<meta name="realestate-kind" content="([^"]*)">/.exec(html)?.[1] ?? null;
  const district = /<meta name="realestate-district" content="([^"]*)">/.exec(html)?.[1] ?? null;
  const card = (inner.match(CARD_RE) ?? []).find((c) => c.replace(/<[^>]*>/g, "").startsWith(LABEL)) ?? null;
  return { inner, kind, district, card };
}

const REALESTATE = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  period: "202608",
  overall: {
    sale: { avgPricePerM2: 13_457_520, avgPricePerPyeong10k: 4449, transactionCount: 575 },
    jeonse: { avgDepositPerM2: 7_777_223, avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: DISTRICT_PAGES.map(({ name }) => ({
    name,
    sale: { avgPricePerM2: 13_457_520, avgPricePerPyeong10k: 4449, transactionCount: 575 },
    jeonse: { avgDepositPerM2: 7_777_223, avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  })),
};

const RATIO = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  seoul: { median: 51.1, cells: 1234 },
  districts: Object.fromEntries(DISTRICT_PAGES.map(({ name }) => [name, { median: 52.3, cells: 321 }])),
};

/** 적은 데이터 파일의 응답을 놓아 줄 때까지 붙들어 둔다. 붙든 동안이 "받는 중"이다. */
function hold(name) {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  return { gate: (n) => (n === name ? held : undefined), release };
}

const refuse = (name) => (n) => {
  if (n === name) throw new TypeError("network down");
};

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function open(file, extra = {}) {
  const baked = await bakedOverall(file);
  const page = await loadRealestatePage({
    file,
    realestate: REALESTATE,
    kind: baked.kind,
    district: baked.district,
    baked: { "overall-cards": { innerHTML: baked.inner } },
    ...extra,
  });
  await settle();
  return { page, baked };
}

/** 네 상태 × 두 언어. `complexRatio`가 있는 것이 "정상"이고 나머지 셋은 값이 안 오는 경우다. */
const STATES = [
  ["받는 중", () => ({ complexRatio: RATIO, ...hold("complex-ratio") }), false],
  ["네트워크 실패", () => ({ complexRatio: RATIO, gate: refuse("complex-ratio") }), false],
  ["404", () => ({ complexRatio: undefined }), false],
  ["정상", () => ({ complexRatio: RATIO }), true],
];

function cardsOf(page) {
  return (page.overallHtml().match(CARD_RE) ?? []).map((c) => c.replace(/<[^>]*>/g, ""));
}

async function checkPage(file, locale) {
  for (const [state, make, arrived] of STATES) {
    const { gate, release, ...rest } = make();
    const { page, baked } = await open(file, { locale, gate, ...rest });
    if (release) release();
    const where = `${file} · ${locale} · ${state}`;
    const cards = cardsOf(page);
    if (!baked.card) {
      // 구운 카드가 없던 장(종로구처럼 표본 미달). 없던 자리에 무엇이 생기면 안 된다 - 값이 왔을 때만 생긴다.
      if (!arrived) assert.equal(cards.filter((c) => c.startsWith(LABEL)).length, 0, `${where}: 없던 카드가 생겼다`);
      continue;
    }
    // 값이 오기 전이든 뒤든 라벨은 늘 그 화면의 locale이다(한국어 조각을 그대로 되붙이지 않는다).
    const kept = cards.filter((c) => c.startsWith(LABELS[locale]));
    assert.equal(kept.length, 1, `${where}: ${LABELS[locale]} 카드가 ${kept.length}장이다`);
    assert.equal(cards.filter((c) => c.startsWith(LABELS.ko)).length, locale === "ko" ? 1 : 0, `${where}: 한국어 카드가 남았다`);
    if (!arrived) {
      // 숫자는 구운 것 그대로다. 한국어 화면이면 글자 하나까지 구운 카드와 같아야 한다.
      const nums = baked.card.replace(/<[^>]*>/g, "").slice(LABELS.ko.length);
      for (const n of nums.match(/[\d.,]+/g) ?? []) assert.ok(kept[0].includes(n), `${where}: 구운 숫자 ${n}이 사라졌다`);
      if (locale === "ko") assert.ok(page.overallHtml().includes(baked.card), `${where}: 구운 카드를 지우거나 바꿨다`);
    }
  }
}

test("대표 장: 구운 전세가율 단지별 중앙값 카드가 네 상태 · 두 언어에서 남는다 (#311)", async () => {
  for (const file of [`${SITE}/apartment-jeonse.html`, `${SITE}/district-gangnam.html`]) {
    for (const locale of ["ko", "en"]) await checkPage(file, locale);
  }
});

test("찍어낸 자치구 스물다섯 장 + 전세 한 장에 실려 나간 스크립트도 같다 (#311)", async () => {
  // 대상 25장(전세 1 + 자치구 24) 전수 × 네 상태 × 두 언어. 종로구는 구운 카드가 없는 장으로 같은 틀에서 같이 본다.
  for (const locale of ["ko", "en"]) {
    for (const { file } of DISTRICT_PAGES) await checkPage(`${SITE}/${file}`, locale);
    await checkPage(`${SITE}/apartment-jeonse.html`, locale);
  }
});

test("대조군: 구운 카드가 없는 장은 값이 안 와도 그대로다 (#311 완료 조건 6)", async () => {
  // apartment-sale·budget-7eok은 전세가율 카드를 그리는 분기를 아예 타지 않고, district-jongno는 그 분기를 타지만
  // 표본이 모자라 구워진 카드가 없다. 값이 안 온 세 상태에서 카드 장수가 흔들리면 안 된다(없던 자리에 아무것도 안 생긴다).
  for (const file of [`${SITE}/apartment-sale.html`, `${SITE}/budget-7eok.html`, `${SITE}/district-jongno.html`]) {
    const { baked } = await open(file);
    const bakedCount = (baked.inner.match(CARD_RE) ?? []).length;
    for (const [state, make, arrived] of STATES) {
      if (arrived) continue;
      const { gate, release, ...rest } = make();
      const { page } = await open(file, { gate, ...rest });
      if (release) release();
      const cards = cardsOf(page);
      assert.equal(cards.filter((c) => c.startsWith(LABEL)).length, 0, `${file} · ${state}: 전세가율 단지별 중앙값 카드가 생겼다`);
      assert.equal(cards.length, bakedCount, `${file} · ${state}: 카드 장수가 구운 것과 다르다`);
    }
  }
});

test("값이 왔는데 표본이 모자라면 구운 카드를 되살리지 않는다 (해자 2, #311)", async () => {
  // `complex-ratio.json`은 왔는데 이 자치구·서울 몫이 문턱 미달이라 빠진 경우다. 구운 값은 어제 것이라 되붙이면 안 된다.
  const empty = { updatedAt: RATIO.updatedAt, seoul: null, districts: {} };
  for (const file of [`${SITE}/apartment-jeonse.html`, `${SITE}/district-gangnam.html`]) {
    const { page, baked } = await open(file, { complexRatio: empty });
    assert.ok(baked.card, `${file}: 이 시험은 구운 카드가 있는 장을 전제로 한다`);
    assert.equal(
      cardsOf(page).filter((c) => c.startsWith(LABEL)).length,
      0,
      `${file}: 표본이 모자란데 구운 카드를 되살렸다`
    );
  }
});

test("영어 화면에서는 값이 오기 전에도 라벨이 영어다 — 구운 한국어 조각을 그대로 되붙이지 않는다 (#311, po 판정)", async () => {
  // 구운 조각은 늘 한국어다. 그대로 되붙이면 영어 카드 넉 장 옆에 한국어 한 장이 서고 고지도 없다(PR #324 po 판정).
  // 숫자만 떼어 오고 라벨은 T.en으로 다시 세운다 - 새 문구도 새 번역도 만들지 않는다.
  for (const file of [`${SITE}/apartment-jeonse.html`, `${SITE}/district-gangnam.html`]) {
    for (const [, make, arrived] of STATES) {
      if (arrived) continue;
      const { gate, release, ...rest } = make();
      const { page, baked } = await open(file, { locale: "en", gate, ...rest });
      if (release) release();
      const kept = cardsOf(page).filter((c) => c.startsWith(LABELS.en));
      assert.equal(kept.length, 1, `${file}: 영어 라벨 카드가 ${kept.length}장이다`);
      assert.ok(!page.overallHtml().includes(LABELS.ko), `${file}: 한국어 라벨이 남아 있다`);
      // 숫자는 구운 것 그대로여야 한다(새로 지어내지 않는다).
      const pct = /([\d.]+)%/.exec(baked.card)[1];
      assert.ok(kept[0].includes(`${pct}%`), `${file}: 구운 값 ${pct}%가 사라졌다`);
    }
  }
});

test("값이 도착하면 구운 카드를 새 값으로 바꾼다 (#311)", async () => {
  const { gate, release } = hold("complex-ratio");
  const { page, baked } = await open(`${SITE}/district-gangnam.html`, { complexRatio: RATIO, gate });
  assert.ok(page.overallHtml().includes(baked.card), "받는 중에 구운 카드가 없다");
  release();
  await settle();
  const kept = cardsOf(page).filter((c) => c.startsWith(LABEL));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /52\.3%/, "도착한 값으로 다시 그리지 않았다");
  assert.match(kept[0], /321칸/);
});
