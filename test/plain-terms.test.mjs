// 쉬운 용어(#745 PR5): 시세 화면·메인·소개·방법 장에서 「평당가·평단가·거래량」을 화면 글자로 내지 않고,
// 값을 못 낸 칸은 「-」가 아니라 「데이터 없음」(영어 No data)이다. 주석(HTML·JS 한 줄)은 화면에 나오지 않으므로 뺀다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RE_LABELS, reHeadLabels, headLabels } from "../scripts/realestate-table.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const visible = (src) =>
  src
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

const PAGES = ["scripts/realestate-template.html", "docs/realestate.html", "docs/index.html", "docs/about.html", "docs/method.html"];
const BANNED = ["평당가", "평단가", "거래량", "거래건수"];

test("시세·메인·소개·방법 장의 화면 글자에 어려운 용어(평당가·평단가·거래량·거래건수)가 없다", () => {
  for (const rel of PAGES) {
    const text = visible(read(rel));
    for (const word of BANNED) assert.ok(!text.includes(word), `${rel}: 「${word}」가 남았다`);
  }
});

test("시세표 라벨은 3.3㎡당 평균·거래 건수·중간값으로 적는다", () => {
  const labels = Object.values(RE_LABELS).join("|");
  for (const word of [...BANNED, "중앙값"]) assert.ok(!labels.includes(word), `RE_LABELS 에 「${word}」`);
  assert.deepEqual(reHeadLabels(null).slice(1), ["매매 3.3㎡당 평균", "전세 3.3㎡당 평균 보증금", "월세 평균 보증금 / 월세"]);
  assert.deepEqual(headLabels("sale", "종로구"), ["구분", "3.3㎡당 평균", "84㎡ 환산", "거래 건수"]);
});

test("값 없는 칸은 「데이터 없음」 / No data (틀·메인 모두 한·영 쌍)", () => {
  for (const rel of ["scripts/realestate-template.html", "docs/realestate.html", "docs/index.html"]) {
    const src = read(rel);
    assert.match(src, /noData: "데이터 없음"/, `${rel}: ko`);
    assert.match(src, /noData: "No data"/, `${rel}: en`);
  }
  const index = read("docs/index.html");
  for (const kind of ["sale", "jeonse", "wolse"]) assert.match(index, new RegExp(`if \\(!${kind}\\) return t\\("noData"\\);`), `index ${kind}`);
  assert.match(read("scripts/realestate-table.ts"), /const NONE = \(\) => \[part\("text", "데이터 없음"\)\];/);
});

test("메인 목적 카드 묶음의 aria-label 은 영어 쌍이 있고, 시장 동향 카드는 전망 장을 한 번만 잇는다(#748 후속)", () => {
  const index = read("docs/index.html");
  assert.match(index, /homeGoals: "무엇을 할까요"/);
  assert.match(index, /homeGoals: "What to do"/);
  assert.match(index, /getElementById\("home-goals"\)\.ariaLabel = t\("homeGoals"\)/);
  const goals = /<nav class="home-goals"[^>]*>([\s\S]*?)<\/nav>/.exec(index)?.[1] ?? "";
  const card = [...goals.matchAll(/<div class="c-card">[\s\S]*?<\/div>/g)]
    .map((m) => m[0]).find((c) => c.includes("price-outlook.html"));
  assert.ok(card, "시장 흐름 카드가 없다");
  assert.equal((card.match(/price-outlook\.html/g) ?? []).length, 1, card);
});

// ---- PR5b(#745 뒤쪽): 다른 장·생성 문장의 「중앙값」→「중간값」, 인용·영어 문구, 용어 설명, 거래량 ----
const MEDIAN_PAGES = [
  "docs/method.html", "docs/switch-house.html", "docs/cancelled-deals.html", "docs/floor-gap.html", "docs/renewal-vs-new.html",
  "docs/jeonse-vs-wolse.html", "docs/price-outlook.html", "docs/complex-chart.js",
  "scripts/cancellation.ts", "scripts/direct-deals.ts", "scripts/floor-gap.ts", "scripts/renewal-facts.ts", "scripts/budget-facts.ts",
  "scripts/budget-fragments.ts", "scripts/budget-pages.ts", "scripts/complex-ratio.ts", "scripts/district-facts.ts", "scripts/rent-flow.ts",
  "scripts/repeat-sales-view.ts", "scripts/segment-change-view.ts",
];

test("다른 장과 생성 문장도 「중앙값」 대신 「중간값」으로 적는다(주석·legal 확인 고지 제외)", () => {
  for (const rel of MEDIAN_PAGES) assert.ok(!visible(read(rel).replace(/<p[^>]*id="cv-legal"[\s\S]*?<\/p>/, "")).includes("중앙값"), `${rel}: 「중앙값」이 남았다`);
});

test("method 의 인용은 시세표 라벨(전세가율 단지별 중간값)과 같고, 영어 문구는 No data 로 적는다", () => {
  assert.ok(read("docs/method.html").includes("&lsquo;" + RE_LABELS.ratioByComplex + "&rsquo;"));
  for (const rel of ["docs/index.html", "scripts/realestate-template.html", "docs/realestate.html"]) {
    const src = read(rel);
    assert.ok(!src.includes("left blank"), `${rel}: 「left blank」`);
    assert.ok(src.includes('show \\"No data\\"'), `${rel}: No data`);
  }
});

test("시세표 아래 용어·기준 기간 설명은 JS 없이 여는 details 이고 한·영 쌍이다", () => {
  for (const rel of ["scripts/realestate-template.html", "docs/realestate.html"]) {
    const src = read(rel);
    const ko = src.match(/<details class="c-fold re-terms" id="re-terms-ko" data-summary-lang="ko">\s*<summary>[^<]+<\/summary>([\s\S]*?)<\/details>/);
    const en = src.match(/<details class="c-fold re-terms" id="re-terms-en" data-summary-lang="en" hidden>\s*<summary>[^<]+<\/summary>([\s\S]*?)<\/details>/);
    assert.ok(ko && en, `${rel}: 한·영 details`);
    assert.equal(ko[1].match(/<dt>/g).length, en[1].match(/<dt>/g).length, `${rel}: 항목 수`);
    for (const word of ["3.3㎡당 평균", "84㎡ 환산", "거래 건수", "전세가율", "기준 기간", "최근 4주", "그 주"]) assert.ok(ko[1].includes(word), `${rel}: ${word}`);
    assert.ok(!/평당가|평단가|거래량|중앙값/.test(ko[1]), rel);
  }
});

test("전망 장 지표 설명·생성 라벨은 「거래량」 대신 「거래 건수」(인라인 바이트는 그대로)", () => {
  const outlook = read("docs/price-outlook.html");
  const note = outlook.slice(outlook.indexOf("indicatorNote:"), outlook.indexOf("regionNote:"));
  assert.ok(note.includes("거래 건수·전세가율") && !note.includes("거래량"), note.slice(0, 80));
  assert.ok(!visible(read("scripts/indicator-backtest.ts")).match(/ko: "거래량|하는 거래량/));
});
