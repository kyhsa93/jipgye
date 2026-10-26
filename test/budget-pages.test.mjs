import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, budgetPageFile } from "../scripts/budget-pages.ts";
import { buildBudgetPage } from "../scripts/build-budget-pages.ts";
import { budgetBodyHtml, realestateOverallHtml } from "../scripts/prerender.ts";
import { buildBands, mergeBands } from "../scripts/budget-bands.ts";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { expandRenderPipeline } from "./helpers/workflow-text.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
// 월 상환액의 금리 근거: 한국은행 ECOS 주담대 신규취급 평균금리(mortgage.ts latestRate 모양, #577). 데이터 날에 기대지 않게 고정값.
const LOAN_BASIS = { rate: 4.66, month: "202608" };
// 단지 후보 절에 쓰는 6개월 칸 요약. 8억대(page8)에 후보가 생기도록 한 칸을 둔다.
const COMPLEX_FILES = [
  {
    district: "노원구",
    reference: "202608",
    cells: { 가단지: { "59.9": { n: 5, median: 85000, low: 84000, high: 86000, quartile: true, raw: 83000, unadjusted: 0 } } },
    meta: { 가단지: { dong: "상계동", buildYear: 2001 } },
  },
];

const deal = (amount10k, extra = {}) => ({
  district: "노원구",
  dong: "하계동",
  apt: "극동아파트",
  area: 55.72,
  floor: 7,
  amount10k,
  date: "2026-08-14",
  buildYear: 1988,
  ...extra,
});

const BUDGET = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  periods: ["202608"],
  bands: mergeBands({
    "202608": buildBands([
      deal(85_000, { apt: "팔억가단지" }),
      deal(88_000, { apt: "팔억나단지", district: "도봉구", dong: "창동", floor: 12 }),
    ]),
  }),
};

const REALESTATE = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  period: "202608",
  overall: {
    sale: { avgPricePerM2: 13_457_520, avgPricePerPyeong10k: 4449, transactionCount: 575 },
    jeonse: { avgDepositPerM2: 7_777_223, avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: [],
};

const page8 = BUDGET_PAGES.find((p) => p.eok === 8);
// 빌더가 읽는 틀(빈 표지, #374). 나가는 장 docs/realestate.html 이 아니다.
const baseHtml = () => readFile(path.join(root, "scripts/realestate-template.html"), "utf8");

test("주소는 예산 단위로 고정한다", () => {
  assert.equal(budgetPageFile(8), "budget-8eok.html");
  assert.deepEqual(
    [BUDGET_PAGES.at(0).eok, BUDGET_PAGES.at(-1).eok],
    [3, 20],
    "구간 목록이 바뀌면 이미 색인된 주소가 404가 된다"
  );
});

test("예산 페이지에 그 구간 거래와 제목이 들어간다", async () => {
  const html = buildBudgetPage(await baseHtml(), page8, BUDGET);

  assert.match(html, /<title>8억대로 살 수 있는 서울 아파트 - 최근 실거래<\/title>/);
  assert.match(html, /<meta name="budget-band" content="80000">/);
  assert.match(html, /<section id="budget-section" class="tw:mb-10 tw:1024:mb-16">/, "예산 섹션이 접힌 채로 나갔다");
  assert.match(html, /팔억가단지/);
  assert.match(html, /도봉구 창동 팔억나단지/);
  assert.match(html, /canonical" href="[^"]*budget-8eok\.html/);
});

test("예산 페이지의 서울 전체 평균 카드는 틀이 아니라 빌더가 채우고, 시세 장과 같은 글자다 (#374)", async () => {
  const overall = (html) => html.match(/<!--prerender:realestateOverall-->([\s\S]*?)<!--\/prerender:realestateOverall-->/)?.[1];
  const template = await baseHtml();
  assert.equal(overall(template), "", "틀의 카드 표지가 비어 있지 않다 - 예산 페이지가 채워진 장을 틀로 물려받는다");

  // 시세가 없는 호출(데이터가 없는 날)은 카드를 비운 채로 낸다. 시세를 넘기면 시세 장이 쓰는 호출(realestateOverallHtml)과 같은 글자가 든다.
  assert.equal(overall(buildBudgetPage(template, page8, BUDGET)), "");
  const cards = realestateOverallHtml(REALESTATE);
  assert.ok(cards, "시험 입력에서 카드가 안 나온다 - 시험이 아무것도 안 본 것이다");
  assert.equal(overall(buildBudgetPage(template, page8, BUDGET, null, null, null, null, null, REALESTATE)), cards);

  // 커밋된 열여덟 장은 나가는 시세 장과 같은 카드를 싣는다(둘 다 같은 realestate.json 에서 같은 호출로 굽는다).
  const shipped = overall(await readFile(path.join(root, `${SITE}/realestate.html`), "utf8"));
  assert.ok(shipped?.length > 0);
  for (const page of BUDGET_PAGES) {
    assert.equal(overall(await readFile(path.join(root, SITE, page.file), "utf8")), shipped, `${SITE}/${page.file}: 서울 전체 평균 카드가 시세 장과 다르다`);
  }
});

test("옆 칸 페이지와 조건 검색으로 가는 길을 남긴다", async () => {
  const html = buildBudgetPage(await baseHtml(), page8, BUDGET);
  assert.match(html, /href="\.\/budget-7eok\.html"/);
  assert.match(html, /href="\.\/budget-9eok\.html"/);
  assert.match(html, /href="\.\/deal-search\.html\?budget=8"/, "조건을 더 걸 수 있는 화면으로 가는 길이 없다");
  assert.ok(!html.includes("realestate.html?budget="), "예산 검색이 없는 페이지로 보낸다");
});

test("목록 양 끝에서는 없는 이웃을 링크하지 않는다", async () => {
  const base = await baseHtml();
  const lowest = BUDGET_PAGES.at(0);
  const budget = { periods: ["202608"], bands: buildBands([deal(lowest.min10k + 500)]) };

  const html = buildBudgetPage(base, lowest, budget);
  assert.ok(!html.includes(`budget-${lowest.eok - 1}eok.html`), "없는 아래 칸을 링크했다");
  assert.match(html, new RegExp(`budget-${lowest.eok + 1}eok\\.html`));
});

test("거래가 없는 구간은 페이지를 만들지 않는다", async () => {
  const empty = BUDGET_PAGES.find((p) => p.eok === 19);
  assert.equal(buildBudgetPage(await baseHtml(), empty, BUDGET), null);
});

test("예산대 목록은 어느 페이지에도 두지 않는다", async () => {
  for (const file of ["realestate.html", "deal-search.html", "apartment-sale.html", "district-gangnam.html", "budget-8eok.html"]) {
    const html = await readFile(path.join(root, SITE, file), "utf8");
    assert.ok(!html.includes("budget-links"), `${file}: 예산대 목록이 남아 있다`);
    assert.ok(!html.includes("예산대별 실거래"), `${file}: 예산대 목록 제목이 남아 있다`);
  }
});

test("프리렌더가 심은 거래 목록을 클라이언트가 그대로 다시 그린다", async () => {
  // 금리까지 넘긴다. 금리 없이 돌리면 월 상환액 문단이 애초에 없어서, 클라이언트가 그 문단을
  // 지우는 것(#26)을 이 검사가 볼 수 없었다.
  const band = BUDGET.bands.find((b) => b.min10k === page8.min10k);
  const prerendered = budgetBodyHtml(band, BUDGET.periods, LOAN_BASIS, null, COMPLEX_FILES);
  assert.match(prerendered, /budget-loan budget-costs/, "부대비용 문단이 빌드에 없다");
  assert.match(prerendered, /<section class="budget-candidates" data-prerendered(="")?>/, "단지 후보 절이 빌드에 없다");

  const page = await loadRealestatePage({
    realestate: REALESTATE,
    budget: BUDGET,
    budgetBand: page8.min10k,
    prerenderedBudget: prerendered,
  });

  assert.equal(page.budgetHtml(), prerendered, "클라이언트가 빌드가 구운 문단을 지웠다");
});

test("예산 페이지는 그 구간만 보여주고 주소를 건드리지 않는다", async () => {
  const page = await loadRealestatePage({
    realestate: REALESTATE,
    budget: BUDGET,
    budgetBand: page8.min10k,
    search: "",
  });

  assert.equal(page.byId("budget-section").hidden, false);
  assert.equal(page.sandbox.location.search, "");
  assert.ok(!page.budgetHtml().includes("data-budget-to"), "예산을 바꾸는 조작이 남았다");
});

test("예산 페이지는 시세 페이지에서 찍어내는 것들보다 먼저 돈다", async () => {
  // (#510) 렌더는 deploy.yml 의 render-pipeline 한 줄이다(update-all·daily-update 에서 빠졌다). 펼친 순서를 본다.
  for (const file of [".github/workflows/deploy.yml"]) {
    const text = expandRenderPipeline(await readFile(path.join(root, file), "utf8"));
    const budget = text.indexOf("build-budget-pages");
    const realestate = text.indexOf("build-realestate-pages");

    assert.ok(budget >= 0 && realestate >= 0, `${file}에 두 단계가 다 있어야 한다`);
    assert.ok(budget < realestate, `${file}: 예산 페이지가 자치구 페이지보다 늦게 돈다`);
  }
});

test("예산대마다 그 돈이 서울에서 어디로 가는지 다르게 말한다", async () => {
  // 지역 순위는 아래 줄에 숫자로도 있다. 그래도 문장을 두는 것은, 심사자든 사람이든
  // 페이지에서 읽는 것은 문장이고 숫자 목록이 아니기 때문이다 — 그리고 예산대마다
  // 답이 실제로 다르다.
  //
  // 여기서 재는 것은 **서로 다르게 말하는가**뿐이다. 몇 장이 이 문장을 갖는지는
  // 그날 분포가 정한다 — 문턱을 넘은 예산대가 몇 개인지에 달렸고, 달이 바뀌어 창이
  // 앞으로 밀리면 표본이 삼분의 일로 줄었다가 한 달에 걸쳐 회복한다. 그 수를 12로
  // 박아 두었더니 매달 1일에 깨졌고, 이 저장소에서 수집 후 테스트가 깨지는 값은
  // 그날 수집분이다. "문턱을 넘으면 말한다"는 동작 자체는 이 파일 아래쪽과
  // budget-facts.test.mjs가 표본을 직접 만들어 확인한다.
  const said = new Map();
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, SITE, page.file), "utf8");
    const prose = [
      /<p class="budget-where">([\s\S]*?)<\/p>/.exec(html)?.[1],
      /<p class="district-summary budget-facts" data-summary-lang="ko">([\s\S]*?)<\/p>/.exec(html)?.[1],
    ]
      // 자리표시 주석은 내용이 아니다. 안 걷어내면 아직 문장이 없는 페이지끼리
      // "같은 말을 한다"고 잡힌다.
      .map((text) => (text ?? "").replace(/<!--[\s\S]*?-->/g, "").trim())
      .filter(Boolean)
      .join(" ");
    if (prose) said.set(page.file, prose);
  }

  assert.equal(new Set(said.values()).size, said.size, "예산대가 서로 같은 말을 합니다");
});

test("몰려 있지도 흩어지지도 않은 예산대에서는 지어내지 않는다", async () => {
  const even = budgetBodyHtml(
    {
      eok: 9,
      count: 100,
      districts: [
        { name: "가구", count: 12 },
        { name: "나구", count: 11 },
        { name: "다구", count: 10 },
        { name: "라구", count: 10 },
      ],
      deals: [],
    },
    []
  );
  assert.doesNotMatch(even, /budget-where/, "상위 셋이 절반도 안 되는데 몰렸다고 말합니다");
});

test("예산 페이지는 자치구 시세표를 다시 싣지 않는다", async () => {
  // 스물다섯 줄짜리 시세표가 시세 틀(realestate-template.html)에서 예산 페이지 열여덟 장으로 그대로
  // 복사돼 나가면서, 페이지 본문의 절반이 옆 페이지와 글자까지 같아졌다. 표는 원본
  // 한 곳에 두고 여기서는 접는다 — "10억대로 뭘 살 수 있나"에 답하지도 않는 표다.
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, SITE, page.file), "utf8");
    assert.match(
      html,
      /<section id="district-section" class="tw:mb-10 tw:1024:mb-16" hidden>/,
      `${SITE}/${page.file}이 자치구 시세표를 다시 싣습니다`
    );
  }

  const source = await readFile(path.join(root, "scripts/realestate-template.html"), "utf8");
  assert.match(source, /<section id="district-section" class="tw:mb-10 tw:1024:mb-16">/, "원본에서까지 표를 접었습니다");
});

test("표를 접어도 자치구로 가는 길은 남는다", async () => {
  // 표에는 스물다섯 개 자치구 링크가 같이 들어 있었다. 표만 접고 끝내면 예산 페이지
  // 열여덟 장에서 자치구 페이지로 흘러가는 링크가 통째로 사라진다.
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, SITE, page.file), "utf8");
    const block = html.split("<!--prerender:districtLinks-->")[1]?.split("<!--/prerender")[0] ?? "";
    const links = [...block.matchAll(/href="\.\/(district-[a-z]+\.html)"/g)].map((m) => m[1]);
    assert.equal(links.length, 25, `${SITE}/${page.file}: 자치구 링크가 ${links.length}개입니다`);
  }
});

test("자치구 링크는 시세표 바깥에 있다", async () => {
  // 링크가 표와 같은 섹션 안에 있으면 예산 페이지에서 표를 접을 때 같이 접힌다.
  const source = await readFile(path.join(root, "scripts/realestate-template.html"), "utf8");
  const section = source.split('<section id="district-section" class="tw:mb-10 tw:1024:mb-16">')[1].split("</section>")[0];
  assert.ok(
    !section.includes("<!--prerender:districtLinks-->"),
    "자치구 링크가 시세표 섹션 안으로 들어왔습니다"
  );
});

test("접은 표는 HTML에서도 빠진다", async () => {
  // hidden은 눈에만 안 보이게 한다. 스물다섯 줄이 마크업에 그대로 남으면 중복을 재도
  // 접기 전과 같은 값이 나오고, 크롤러가 받는 바이트도 줄지 않는다.
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, SITE, page.file), "utf8");
    const body = /<tbody id="district-grid">([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
    assert.equal(
      body.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim(),
      "",
      `${SITE}/${page.file}: 접은 표의 내용이 HTML에 남아 있습니다`
    );
  }
});

test("예산대 장 머리는 본문과 같은 기간을, 건수는 직거래가 몇 건 섞였는지를 적는다 (#41)", async () => {
  const realestate = { ...REALESTATE, window: { basis: "arrival", from: "2026-09-28", to: "2026-10-01" } };
  const band = BUDGET.bands.find((b) => b.min10k === page8.min10k);
  const budget = { ...BUDGET, bands: BUDGET.bands.map((b) => (b === band ? { ...b, direct: 1 } : b)) };
  const page = await loadRealestatePage({ realestate, budget, budgetBand: page8.min10k });
  const head = page.byId("updated").textContent;
  assert.match(head, /8월 신고분 기준/, `머리: ${head}`);
  assert.doesNotMatch(head, /2026-09-28/, "맨 아래 서울 평균 카드의 창을 머리에 적었다");
  assert.match(page.budgetHtml(), /건이 거래됐습니다\(직거래 1건 포함\)/);
  const { budgetBodyHtml: prerender } = await import("../scripts/prerender.ts");
  assert.match(prerender({ ...band, direct: 1 }, BUDGET.periods, LOAN_BASIS, null, COMPLEX_FILES), /\(직거래 1건 포함\)/, "빌드와 화면이 갈렸다");
});

test("영어 화면의 예산대 장은 한국어로만 굽는 문단이 있다고 먼저 말한다 (#41)", async () => {
  const band = BUDGET.bands.find((b) => b.min10k === page8.min10k);
  const prerendered = budgetBodyHtml(band, BUDGET.periods, LOAN_BASIS, null, COMPLEX_FILES);
  const en = await loadRealestatePage({ realestate: REALESTATE, budget: BUDGET, budgetBand: page8.min10k, prerenderedBudget: prerendered, locale: "en" });
  assert.match(en.budgetHtml(), /are in Korean only/);
  const ko = await loadRealestatePage({ realestate: REALESTATE, budget: BUDGET, budgetBand: page8.min10k, prerenderedBudget: prerendered });
  assert.doesNotMatch(ko.budgetHtml(), /Korean only/);
});

test("예산대 장 맨 위 '한눈에'는 아래 문단과 같은 함수에서 나온 값을 한 줄씩 적는다 (#43)", async () => {
  const { budgetAnswersHtml } = await import("../scripts/prerender.ts");
  const html = budgetAnswersHtml({ min10k: 70_000 }, LOAN_BASIS);
  assert.match(html, /7억 5,000만원짜리를 산다면/);
  assert.match(html, /자기 돈이 적어도<\/span><strong class="answer-value">4억 6,950만원<\/strong><span class="answer-note">생애최초면 2억 4,250만원/);
  assert.match(html, /매매가 위에 더 드는 돈<\/span><strong class="answer-value">1,950만원/);
  assert.match(html, /1억을 빌리면 매달<\/span><strong class="answer-value">52만원<\/strong><span class="answer-note">30년 원리금균등, 한국은행 평균 연 4\.66%\(2026년 8월\)</);
  assert.match(html, /신생아 특례 선\(9억\) 안/);
  assert.match(html, /data-prerendered/, "화면이 다시 그릴 때 지워진다");
  assert.doesNotMatch(budgetAnswersHtml({ min10k: 70_000 }, null), /1억을 빌리면/, "금리가 없는 날 상환액 줄을 지어냈다");
});

test("예산대 본문 순서: 요약 → 한눈에 → 지역 줄 → 어디로 가는가 → 예산으로 찾기 → 후보 → 돈 문단 → 거래 목록, 화면이 다시 그려도 같다 (#43, #460)", async () => {
  const many = ["노원구", "도봉구", "강북구", "중랑구"].flatMap((district, i) =>
    Array.from({ length: 3 }, (_, k) => deal(80_000 + i * 1000 + k, { district, apt: `${district}단지${k}` }))
  );
  const budget = { ...BUDGET, bands: mergeBands({ "202608": buildBands(many) }) };
  const band = budget.bands.find((b) => b.min10k === page8.min10k);
  const prerendered = budgetBodyHtml(band, budget.periods, LOAN_BASIS, null, COMPLEX_FILES, null, null, FINDER);
  const at = (needle) => prerendered.indexOf(needle);
  assert.ok(at('class="budget-where"') > 0, "전제: 지역 문단이 있어야 한다");
  assert.ok(at("budget-summary") < at("budget-answers"), "거래 요약이 한눈에보다 뒤다");
  assert.ok(at("budget-answers") < at('class="budget-districts"'), "지역 줄이 한눈에보다 앞이다");
  assert.ok(at('class="budget-districts"') < at('class="budget-where"'), "어디로 가는가가 지역 줄보다 앞이다");
  assert.ok(at('class="budget-where"') < at('id="budget-heading"'), "예산으로 찾기가 어디로 가는가보다 앞이다");
  assert.ok(at('id="budget-heading"') < at('class="budget-chips"') && at('class="budget-chips"') < at("budget-candidates"), "칩이 제목 뒤·후보 앞이 아니다");
  assert.ok(at("budget-candidates") < at("budget-costs"), "후보가 돈 문단보다 뒤다");
  assert.ok(at("budget-costs") < prerendered.lastIndexOf('<ul class="budget-deals">'), "거래 목록이 돈 문단보다 앞이다");
  const page = await loadRealestatePage({ realestate: REALESTATE, budget, budgetBand: page8.min10k, prerenderedBudget: prerendered });
  assert.equal(page.budgetHtml(), prerendered, "화면이 다시 그리며 순서가 바뀌거나 지역 문단을 지웠다");
});

// 틀 밖에서 만들어 본문 칸 안에 놓는 제목+칩 마크업(build-budget-pages 가 장마다 만든다). 순서 시험은 이 모양만 본다.
const FINDER = '<h2 id="budget-heading">예산으로 찾기</h2><nav class="budget-chips" aria-label="예산대"><a href="./budget-8eok.html" aria-current="page">8억</a></nav>';
// 장 안 요소의 출현 순서(#460, po 판정 6361525534): 날짜 줄 → 거래 요약 → (영어 안내문) → 한눈에 → 지역 줄 → 어디로 가는가 → 예산으로 찾기 제목 → 칩 → 후보 단지.
// 지역 줄·어디로 가는가·후보는 그날 데이터에 따라 없을 수 있어 있을 때만 순서를 본다(데이터 값에 기대는 검사를 넣지 않는다).
const ORDER = ['id="cross-basis"', 'class="budget-summary"', 'class="budget-answers"', 'class="budget-districts"', 'class="budget-where"', 'id="budget-heading"', 'class="budget-chips"', 'class="budget-candidates"'];
const ORDER_REQUIRED = new Set(['id="cross-basis"', 'class="budget-summary"', 'class="budget-answers"', 'id="budget-heading"', 'class="budget-chips"']);
function assertOrder(html, label) {
  let prev = -1;
  let prevKey = "";
  for (const key of ORDER) {
    const i = html.indexOf(key);
    if (i < 0) {
      assert.ok(!ORDER_REQUIRED.has(key), `${label}: ${key} 가 없다`);
      continue;
    }
    assert.ok(i > prev, `${label}: ${key} 가 ${prevKey} 앞에 있다`);
    prev = i;
    prevKey = key;
  }
}

test("예산대 열여덟 장의 구운 HTML 은 날짜 줄 → 요약 → 한눈에 → 지역 줄 → 어디로 가는가 → 제목 → 칩 → 후보 순서다 (#460)", async () => {
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, SITE, page.file), "utf8");
    assertOrder(html, page.file);
    assert.equal([...html.matchAll(/<h2 id="budget-heading">예산으로 찾기<\/h2>/g)].length, 1, `${page.file}: 제목이 하나여야 한다`);
    assert.ok(html.indexOf('id="budget-result"') < html.indexOf('id="budget-heading"'), `${page.file}: 제목이 본문 칸 밖에 남았다`);
  }
});

test("예산대 화면이 다시 그려도(한국어·영어) 같은 순서이고 영어 안내문은 한눈에 바로 앞 형제다 (#460)", async () => {
  for (const page of BUDGET_PAGES) {
    const band = (buildBands([deal(page.min10k + 5_000, { apt: "가단지" }), deal(page.min10k + 6_000, { apt: "나단지", district: "도봉구" })]) ?? []).find((b) => b.min10k === page.min10k);
    const budget = { ...BUDGET, bands: [band] };
    const prerendered = budgetBodyHtml(band, budget.periods, LOAN_BASIS, null, COMPLEX_FILES, null, null, FINDER);
    for (const locale of ["ko", "en"]) {
      const view = await loadRealestatePage({ realestate: REALESTATE, budget, budgetBand: page.min10k, prerenderedBudget: prerendered, locale });
      const html = `<p class="updated cross-basis" id="cross-basis"></p>${view.budgetHtml()}`;
      assertOrder(html, `${page.file} ${locale}`);
      if (locale === "en") {
        assert.match(view.budgetHtml(), /<\/p><p class="content-notice">[^<]+<\/p><section class="budget-answers"/, `${page.file}: 영어 안내문이 한눈에 바로 앞 형제가 아니다`);
        assert.match(view.budgetHtml(), /<h2 id="budget-heading">Search by budget<\/h2>/, `${page.file}: 영어 제목이 아니다`);
      } else {
        assert.doesNotMatch(view.budgetHtml(), /content-notice/);
        assert.match(view.budgetHtml(), /<h2 id="budget-heading">예산으로 찾기<\/h2>/);
      }
    }
  }
});

test("예산대 열여덟 장 모두 한눈에 뒤에 예산 칩 줄이 있고 제 칩이 켜져 있다 (#43, #460)", async () => {
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, SITE, page.file), "utf8");
    const nav = html.match(/<nav class="budget-chips"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.equal((nav.match(/<a /g) ?? []).length, 18, `${page.file}: 칩이 열여덟이 아니다`);
    assert.match(nav, new RegExp(`href="\\./${page.file}" aria-current="page">${page.eok}억<`), `${page.file}: 제 칩이 안 켜졌다`);
    assert.ok(html.indexOf('id="budget-result"') < html.indexOf("budget-chips"), `${page.file}: 칩이 본문 칸 밖에 있다`);
    assert.ok(html.indexOf('class="budget-answers"') < html.indexOf("budget-chips"), `${page.file}: 칩이 한눈에 앞이다`);
  }
});

// ---- 기준 칩 넷과 머리 도장 「금리(8월분) MM-DD 갱신」 (#411 확장) ----

test("기준 칩 넷은 입력에서 달을 읽는다 - 거래 기간·보정 기준월·금리 월이 입력을 따라 바뀌고, 못 읽은 칸의 칩은 빠진다 (#411)", async () => {
  const { basisChips } = await import("../scripts/budget-fragments.ts");
  const texts = (...a) => basisChips(...a).map((c) => c.text);
  const ctx = { periodList: ["202610", "202608", "202609", "202609"], complexFiles: [{ reference: "202607" }] };
  assert.deepEqual(texts({ rate: 4.66, month: "202608" }, ctx), ["거래 8·9·10월 신고분", "보정 7월 값 기준", "금리 8월분", "규정 10-01 확인"]);
  // 같은 코드, 다른 입력 → 다른 달(하드코딩이면 여기서 빨강)
  assert.deepEqual(
    texts({ rate: 3.9, month: "202611" }, { periodList: ["202612", "202701"], complexFiles: [{ reference: "202611" }] }),
    ["거래 12·1월 신고분", "보정 11월 값 기준", "금리 11월분", "규정 10-01 확인"]
  );
  assert.equal(basisChips({ rate: 4.66, month: "202608" }, ctx).find((c) => c.kind === "rate").month, "202608", "도장이 읽는 달");
  // 못 읽으면 지어내지 않는다
  assert.deepEqual(texts(null), ["규정 10-01 확인"]);
  assert.deepEqual(texts({ rate: 4, month: "2026-08" }, { periodList: ["x", "202613"], complexFiles: [{ reference: "" }] }), ["규정 10-01 확인"]);
});

test("한눈에: 제목 바로 아래 기준 칩 줄, 금리 칩은 금리 줄이 있을 때만이고 data-rate-month 를 진다 (#411)", async () => {
  const { budgetAnswersHtml } = await import("../scripts/prerender.ts");
  const html = budgetAnswersHtml({ min10k: 70_000 }, LOAN_BASIS, { periodList: ["202609", "202608"], complexFiles: COMPLEX_FILES });
  assert.match(
    html,
    /<\/h2><p class="answer-basis"><span>거래 8·9월 신고분<\/span> <span>보정 8월 값 기준<\/span> <span data-rate-month="202608">금리 8월분<\/span> <span>규정 10-01 확인<\/span><\/p><ul>/
  );
  assert.doesNotMatch(budgetAnswersHtml({ min10k: 70_000 }, { rate: "4.5", month: "202608" }), /data-rate-month/, "금리 줄이 없는데 금리 칩이 섰다");
});

test("머리 도장 금리 칸: 「금리(8월분) 10-26 갱신」, 달을 못 읽으면 「금리 10-26 갱신」 (#411)", async () => {
  const { rateStampText } = await import("../scripts/budget-pages.ts");
  assert.equal(rateStampText("2026-10-26", "202608"), "금리(8월분) 10-26 갱신");
  assert.equal(rateStampText("2026-10-26", "202612"), "금리(12월분) 10-26 갱신");
  for (const bad of [null, undefined, "", "2026-08", "202600", "202613"]) assert.equal(rateStampText("2026-10-26", bad), "금리 10-26 갱신", String(bad));
});

test("예산대 18장 모두: 한눈에 기준 칩 넷과 새 도장 「실거래 MM-DD x 금리(N월분) MM-DD 갱신」, 칩 줄은 장당 400 B 안 (#411)", async () => {
  const { crossStampHtml } = await import("../scripts/updated-stamp.ts");
  const template = await baseHtml();
  const budget = {
    updatedAt: "2026-10-26T00:00:00.000Z",
    periods: ["202610", "202609", "202608"],
    bands: mergeBands({ "202609": buildBands(BUDGET_PAGES.map((p) => deal(p.min10k + 5_000, { apt: `${p.eok}억단지` }))) }),
  };
  assert.equal(BUDGET_PAGES.length, 18);
  for (const page of BUDGET_PAGES) {
    const built = buildBudgetPage(template, page, budget, LOAN_BASIS, null, COMPLEX_FILES);
    assert.ok(built, `${page.file}: 장이 안 나왔다`);
    const html = crossStampHtml(built, page.file, "2026-10-26", "2026-10-26");
    const row = html.match(/<p class="answer-basis">([\s\S]*?)<\/p>/);
    assert.ok(row, `${page.file}: 칩 줄이 없다`);
    assert.deepEqual([...row[1].matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]), ["거래 8·9·10월 신고분", "보정 8월 값 기준", "금리 8월분", "규정 10-01 확인"], page.file);
    assert.ok(Buffer.byteLength(row[0]) <= 400, `${page.file}: 칩 줄 ${Buffer.byteLength(row[0])} B`);
    assert.match(html, />실거래 10-26 x 금리\(8월분\) 10-26 갱신<\/p>/, `${page.file}: 새 도장 문구`);
  }
});
