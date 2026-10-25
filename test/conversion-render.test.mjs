import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-conversion.ts";
import { loadConversionPage } from "./helpers/conversion-page.mjs";
import { stubElement } from "./helpers/digest-page.mjs";

const NOW = new Date("2026-08-26T00:00:00Z");

const rent = (extra) => ({
  district: "노원구",
  dong: "하계동",
  apt: "극동아파트",
  area: 84.9,
  date: "2026-08-14",
  renewal: false,
  ...extra,
});

/** 자치구 하나당 단지 셋씩 - MIN_PAIRS를 넘겨야 칸이 만들어진다. */
function dealsFor(district, { jeonse10k, deposit10k, monthly10k, area = 84.9 }) {
  return ["가", "나", "다"].flatMap((name) => [
    rent({ district, apt: `${district}${name}`, area, deposit10k: jeonse10k }),
    rent({ district, apt: `${district}${name}`, area, deposit10k, monthlyRent10k: monthly10k }),
  ]);
}

const DEALS = [
  ...dealsFor("노원구", { jeonse10k: 50_000, deposit10k: 20_000, monthly10k: 125 }),
  ...dealsFor("강남구", { jeonse10k: 95_000, deposit10k: 40_000, monthly10k: 220 }),
  ...dealsFor("노원구", { jeonse10k: 30_000, deposit10k: 10_000, monthly10k: 70, area: 45 }),
];

const SERIES = { jeonse_loan_rate: [["202607", 4]], deposit_rate: [["202607", 3.8]] };

const CONVERSION = buildPayload({ deals: DEALS, series: SERIES, months: ["202603", "202608"], now: NOW });

/** `#id { min-height: Nlh; }` 하나. 선언이 이것 하나가 아니면 던진다(px 로 베끼거나 height·overflow 를 두면 자동 광고가 깨진다 - 체인 규칙 3). */
function reservation(css, id) {
  const m = new RegExp(String.raw`\n#${id} \{([^{}]*)\}`).exec(css);
  return m ? lines(m[1], id) : null;
}

/** `@media (max-width: Wpx) { #id { min-height: Nlh; } }` 를 소스 순서대로 [W, N] 으로. */
function reservationSteps(css, id) {
  const re = new RegExp(String.raw`@media \(max-width: (\d+)px\) \{\s*#${id} \{([^{}]*)\}\s*\}`, "g");
  return [...css.matchAll(re)].map((m) => [Number(m[1]), lines(m[2], id)]);
}

function lines(decls, id) {
  const m = /^min-height:\s*(\d+)lh;$/.exec(decls.trim());
  assert.ok(m, `#${id} 예약은 "min-height: N lh" 하나여야 한다(지금 "${decls.trim()}") - px 로 베끼면 본문 줄 간격을 바꿀 때 따라오지 않고, height·overflow·position 을 두면 자동 광고가 깨진다(체인 규칙 3)`);
  return Number(m[1]);
}

const open = (extra = {}) => loadConversionPage({ conversion: CONVERSION, ...extra });

test("아무것도 고르지 않아도 첫 자치구의 비교가 나온다", async () => {
  const page = await open();
  const html = page.resultHtml();

  assert.match(html, /전세/);
  assert.match(html, /월세/);
  assert.match(html, /월 실부담/);
});

test("가진 돈이 늘면 전세 쪽 대출이자가 줄어든다", async () => {
  const cost = (html) => Number(/<div class="cost">([\d,.]+)만원<\/div>/.exec(html)?.[1]?.replace(/,/g, ""));

  const page = await open({ query: "?district=노원구&band=60to85&cash=2" });
  const poor = cost(page.resultHtml());

  await page.typeCash(4);
  const rich = cost(page.resultHtml());

  assert.ok(poor > rich, `가진 돈을 2억에서 4억으로 늘렸는데 부담이 ${poor} → ${rich}이다`);

  // 보증금 5억을 다 내고 나면 빌릴 것이 없다.
  await page.typeCash(5);
  assert.ok(!page.resultHtml().includes("빌리는 돈"), "5억 전세에 5억을 내고도 빌리고 있다");
});

test("가진 돈이 보증금의 20%도 안 되면 그쪽만 불가능하다고 말한다", async () => {
  // 강남 9.5억 전세는 80%를 빌려도 1억으로는 못 채운다. 반면 보증금 4억짜리 월세는
  // 같은 1억으로 성립하므로, 불가능하다는 말은 전세 카드에만 붙어야 한다.
  const page = await open({ query: "?district=강남구&band=60to85&cash=1" });
  const cards = page.resultHtml().split('<div class="option');

  const jeonseCard = cards.find((c) => c.includes(">전세<"));
  const wolseCard = cards.find((c) => c.includes(">월세<"));

  assert.match(jeonseCard, /보증금의 80%까지 빌려도/);
  assert.ok(!jeonseCard.includes("월 실부담"), "성립하지 않는 전세에 월 비용을 적었다");
  assert.match(wolseCard, /월 실부담/);
});

test("한쪽이 불가능하면 어느 쪽이 싸다고 말하지 않는다", async () => {
  const page = await open({ query: "?district=강남구&band=60to85&cash=1" });
  assert.match(page.resultHtml(), /가진 돈으로는 한쪽을 고를 수 없다/);
});

test("고른 자치구가 표에서 굵게 표시된다", async () => {
  const page = await open({ query: "?district=노원구&band=60to85&cash=3" });
  const table = page.tableHtml();

  assert.match(table, /<tr class="spot"><td>노원구/);
  assert.ok(!/<tr class="spot"><td>강남구/.test(table), "고르지 않은 자치구가 굵게 표시됐다");
});

test("자치구를 바꾸면 그 자치구에 있는 면적대만 고를 수 있다", async () => {
  const page = await open({ query: "?district=노원구&band=under60&cash=3" });
  assert.match(page.bandOptions(), /under60/);

  await page.chooseDistrict("강남구");
  assert.ok(!page.bandOptions().includes("under60"), "강남구에 없는 면적대가 남아 있다");
});

test("고른 조건이 주소에 남아 새로고침해도 그대로다", async () => {
  const page = await open();
  await page.chooseDistrict("강남구");
  await page.typeCash(7.5);

  const search = page.search();
  assert.match(search, /district=%EA%B0%95%EB%82%A8%EA%B5%AC|district=강남구/);
  assert.match(search, /cash=7\.5/);
});

test("첫 문단은 빌드가 만든 문장을 그대로 쓴다", async () => {
  const page = await open();
  assert.equal(page.leadText(), CONVERSION.seoul.leadKo);
});

test("영어로 바꾸면 문장도 표 머리도 영어가 된다", async () => {
  const page = await open();
  await page.toggleLang();

  assert.equal(page.leadText(), CONVERSION.seoul.leadEn);
  assert.match(page.tableHtml(), /District/);
  assert.match(page.resultHtml(), /Real monthly cost|cannot cover/);
});

test("자료가 없으면 조건 칸을 감추고 그렇다고 말한다", async () => {
  const page = await loadConversionPage({ conversion: null });

  assert.equal(page.byId("calc-controls").hidden, true);
  assert.match(page.resultHtml(), /아직 전환율을 낼 자료가 없습니다/);
});

test("불러오다 실패하면 다시 시도할 수 있다", async () => {
  const page = await loadConversionPage({ conversion: undefined, status: 500 });
  assert.match(page.resultHtml(), /다시 시도/);
});

// jeonse-vs-wolse의 CLS는 "입력 칸과 결과 자리가 빈 채로 태어나 데이터가 온 뒤에 채워지는 것"이었다
// (#287 (라), 2026-10-17 실측 0.1601~0.1876 - 절대 상한 0.1 의 1.6~1.9배). 고친 방식은 CSS 만으로 채우기 전과 뒤의 기하를
// 같게 만드는 것이라 되풀이는 다섯 길로 들어온다 - 구운 자리가 안 비거나(이름이 바뀌거나) · 규칙이 사라지거나 ·
// 예약이 px 로 바뀌거나 · 예약이 걸리는 폭이 카드가 쌓이는 폭에서 떨어지거나 · 고정 높이·overflow 로 바뀌거나.
// 다섯 다 여기서 막는다. 예약이 정확한가(카드 높이와 같은가)는 브라우저가 아는 일이라 PR 본문의 측정이 본다 -
// 카드 높이는 글에 달려 있고 글은 날마다 바뀔 수 있어(#8) 값에 기대는 시험이 되기 때문이다. 줄 수는 "정수 lh"인지만 본다.
test("입력 칸과 결과 자리는 데이터가 오기 전에도 자리를 잡는다 (#287)", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const read = (p) => readFile(path.join(root, p), "utf8");

  // (1) 예약이 걸리는 자리가 구운 장에 그 모양으로 있다. 규칙이 아무것도 안 집으면 조용히 죽는다.
  const html = await read("docs/jeonse-vs-wolse.html");
  assert.match(html, /<div class="search-controls" id="calc-controls">/, "docs/jeonse-vs-wolse.html: #calc-controls 가 없다 - 칸 폭 예약이 아무것도 안 집는다");
  assert.match(html, /<select id="district-select"><\/select>/, "docs/jeonse-vs-wolse.html: #district-select 가 빈 셀렉트로 구워지지 않는다");
  assert.match(html, /<select id="band-select"><\/select>/, "docs/jeonse-vs-wolse.html: #band-select 가 빈 셀렉트로 구워지지 않는다");
  assert.match(html, /<div id="calc-result"><\/div>/, "docs/jeonse-vs-wolse.html: #calc-result 가 빈 채로 구워지지 않는다 - 예약이 안 맞는다");
  assert.equal((html.match(/<div class="search-field">/g) ?? []).length, 3, "docs/jeonse-vs-wolse.html: 입력 칸이 셋이 아니다 - 줄 바뀜(≤520 에서 둘+하나)이 달라진다");

  const css = await read("src/css/legacy.css");
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // (2) 셀렉트가 든 칸의 최소 폭. 채워진 칸 폭이 아니라 rem 으로 못박혀야 빈 칸도 같은 폭을 갖는다.
  const field = /#calc-controls \.search-field:has\(select\) \{\s*min-width:\s*([\d.]+)rem;\s*\}/.exec(clean);
  assert.ok(field, "src/css/legacy.css: `#calc-controls .search-field:has(select) { min-width: N rem }` 가 사라졌다 - 채워질 때 둘째·셋째 칸이 오른쪽으로 밀린다");
  assert.ok(Number(field[1]) >= 8.65, `칸 최소 폭이 ${field[1]}rem 이다 - 채워진 둘째 칸(138px = 8.63rem, 2026-10-18 실측 - #335 글자 단 뒤 135.53px 에서 커졌다)보다 좁으면 폭 320 에서 채울 때 둘째 칸이 둘째 줄로 내려가 아래 전부가 54px 밀린다`);

  // (3) 결과 자리 예약: 기본(넓은 폭) 하나 + 폭이 좁아질수록 커지는 계단. 선언은 min-height 하나, 단위는 lh.
  const base = reservation(clean, "calc-result");
  assert.ok(base, "src/css/legacy.css: `#calc-result` 예약 규칙이 사라졌다 - 카드가 들어오는 순간 #calc-note 와 #rate-section 이 밀린다");
  const steps = reservationSteps(clean, "calc-result");
  assert.ok(steps.length >= 2, "src/css/legacy.css: 좁은 폭의 `#calc-result` 예약이 사라졌다 - 카드가 쌓이는 폭에서 예약이 모자라다");
  assert.deepEqual(steps.map(([w]) => w), [...steps.map(([w]) => w)].sort((x, y) => y - x), "#calc-result 계단이 넓은 폭부터 차례로 있지 않다 - 같은 선택자라 뒤의 것이 이겨 좁은 폭 규칙이 죽는다");
  let floor = base;
  for (const [width, lines] of steps) {
    assert.ok(lines > floor, `#calc-result 예약이 폭 ${width}px 에서 앞 단계(${floor}lh)보다 크지 않다 - 좁을수록 카드가 길다`);
    floor = lines;
  }

  // (4) 마지막 계단(가장 좁은 구간)이 갈리는 폭은 카드가 한 줄로 쌓이는 폭(.options 가 1열이 되는 폭)과 같아야 한다. 떨어지면 카드 둘이 나란한
  // 폭에서 쌓인 높이를 예약하거나 그 반대가 되어 예약이 크게 남거나 모자란다.
  const stack = /@media \(max-width: (\d+)px\) \{\s*\.options \{\s*grid-template-columns:\s*1fr;\s*\}\s*\}/.exec(clean);
  assert.ok(stack, "src/css/legacy.css: `.options` 를 한 줄로 쌓는 미디어 쿼리가 사라졌거나 모양이 달라졌다 - 예약이 갈리는 폭의 기준이 없다");
  assert.equal(String(steps.at(-1)[0]), stack[1], `#calc-result 예약이 마지막으로 갈리는 폭(${steps.at(-1)[0]}px)이 카드가 쌓이는 폭(${stack[1]}px)과 다르다`);
});

test("안내 자리는 폭마다 줄 수만큼, 결과 자리는 폭 계단으로 예약하고 실패해도 CSS 로 통째로 거두지 않는다 (#349·#348)", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const css = await readFile(path.resolve(import.meta.dirname, "..", "src/css/legacy.css"), "utf8");
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // 안내(#calc-note)는 글이 정해져 있고 줄 수만 폭에 따라 갈린다. 첫 그리기 직후 스크립트가 글을 넣을 때 아래(#rate-section)가
  // 밀리지 않도록 줄 수만큼 자리를 잡는다. 좁을수록 커지는 계단이고 단위는 lh(그 상자 자신의 줄 높이)다.
  const noteBase = reservation(clean, "calc-note");
  assert.ok(noteBase, "src/css/legacy.css: `#calc-note` 예약이 사라졌다 - 첫 그리기 직후 안내 글이 들어오며 #rate-section 이 밀린다(키 큰 화면)");
  const noteSteps = reservationSteps(clean, "calc-note");
  assert.ok(noteSteps.length >= 3, `#calc-note 폭 계단이 ${noteSteps.length}개뿐이다 - 안내 줄 수는 폭 320~569 에서 9줄에서 4줄까지 여섯 단으로 갈린다(2026-10-18 실측)`);
  assert.deepEqual(noteSteps.map(([w]) => w), [...noteSteps.map(([w]) => w)].sort((x, y) => y - x), "#calc-note 계단이 넓은 폭부터 차례로 있지 않다");
  let floor = noteBase;
  for (const [width, lines] of noteSteps) {
    assert.ok(lines > floor, `#calc-note 예약이 폭 ${width}px 에서 앞 단계(${floor}lh)보다 크지 않다 - 좁을수록 줄이 많다`);
    floor = lines;
  }

  // 결과 자리 계단은 앞 시험이 형태를 본다. 여기서는 숫자가 2026-10-18 실측(한국어 기본 칸, 23일치 conversion.json 의 최댓값)을 덮는지 본다.
  // 폭 ~402 637.69px(26.6줄) · 403~520 613.69px · 521~526 392.69px(16.4줄) · 527~1023 374.69px(15.6줄) · 1024~ 360px 이하.
  const stepAt = (base, steps, width) => steps.filter(([w]) => width <= w).at(-1)?.[1] ?? base;
  const resBase = reservation(clean, "calc-result");
  const resSteps = reservationSteps(clean, "calc-result");
  for (const [width, px] of [[320, 637.69], [402, 637.69], [412, 613.69], [520, 613.69], [521, 392.69], [768, 374.69], [1023, 374.69], [1024, 360]]) {
    const lines = stepAt(resBase, resSteps, width);
    assert.ok(lines * 24 >= px, `폭 ${width}px 의 #calc-result 예약이 ${lines}lh(${lines * 24}px)라 카드(${px}px)에 모자란다 - 채울 때 아래가 밀린다`);
  }

  // 실패한 날 예약을 CSS 로 거두는 길(`#calc-result:has(> .empty) { min-height: 0 }`)은 막혀 있다: 한 줄 안내가 들어오는 순간 #calc-note 가
  // 화면 안으로 올라와 CLS 가 0.1533(375x812)~0.2385 가 된다(#348 실측). 거두는 일은 스크립트의 showEmpty 가 보이는 곳이 안 움직이는 만큼만 한다.
  assert.doesNotMatch(clean, /#calc-result[^{}]*(:has\(|\[data-)/, "src/css/legacy.css: #calc-result 의 예약을 상태 선택자로 거두는 규칙이 있다 - 실패 경로에서 #calc-note 가 화면 안으로 올라온다(#348)");
});

test("요청이 끝내 실패하면 결과 자리 예약을 보이는 곳이 안 움직이는 만큼만 접고, 카드가 그려지면 다시 편다 (#348)", async () => {
  const stubBox = (top, height, style = {}) => {
    const box = stubElement({}, "calc-result");
    box.getBoundingClientRect = () => ({ top });
    box.offsetHeight = height;
    box.style = style;
    return box;
  };
  const folded = async ({ innerHeight, top, height = 648, status }) => {
    const box = stubBox(top, height);
    await open({ conversion: undefined, status, innerHeight, seed: { "calc-result": box } });
    return { box, minHeight: box.style.minHeight };
  };

  // 375x812: 결과 자리가 y=582 에서 시작하고 예약이 648px 이면 아래(#calc-note)는 y=1230 에 있다. 화면 아래(812)까지만 남기고 접으면
  // 접은 뒤의 #calc-note 위치(582+230=812)도 화면 밖이라 보이는 곳이 안 움직인다(CLS 0, 문서 높이 -418px).
  const a = await folded({ innerHeight: 812, top: 582, status: 404 });
  assert.equal(a.minHeight, "230px", "404(자료 없음) 때 접는 높이가 화면 아래까지 남은 만큼(812-582)이 아니다");
  assert.match(a.box.innerHTML, /class="empty"/);

  const b = await folded({ innerHeight: 812, top: 582, status: 500 });
  assert.equal(b.minHeight, "230px", "요청 실패(500) 때 접는 높이가 화면 아래까지 남은 만큼이 아니다");
  assert.match(b.box.innerHTML, /load-retry/, "요청 실패 때 다시 시도 단추가 없다");

  // 자리가 화면 아래에서 시작하면 끝까지 접어도(0) 아래는 화면 밖이다.
  const c = await folded({ innerHeight: 568, top: 606, status: 404 });
  assert.equal(c.minHeight, "0px");

  // 화면이 예약보다 높으면(키 큰 화면) 접으면 아래가 화면 안으로 올라오므로 접지 않는다. 늘리지도 않는다.
  const d = await folded({ innerHeight: 1400, top: 582, status: 404 });
  assert.ok(!d.minHeight, `키 큰 화면(1400)에서 예약을 ${d.minHeight} 로 바꿨다 - 접으면 #calc-note 가 올라오고, 늘리면 아래가 밀린다`);

  // 카드가 그려지면 접었던 높이를 지우고 CSS 예약으로 돌아간다(다시 시도 뒤 카드가 230px 상자에 들어오면 아래가 밀린다).
  const box = stubBox(582, 648, { minHeight: "230px" });
  await open({ seed: { "calc-result": box } });
  assert.match(box.innerHTML, /class="verdict"/, "카드가 그려지지 않았다");
  assert.equal(box.style.minHeight, "", "카드를 그리고도 접었던 min-height 가 남았다");
});
