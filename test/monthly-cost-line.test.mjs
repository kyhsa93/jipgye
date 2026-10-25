import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NAME, STALE_MONTHS, latestPoint, monthlyCostLineHtml, monthlyCostText } from "../scripts/monthly-cost-line.ts";
import { NAME as GENERATOR_NAME } from "../scripts/build-monthly-cost.ts";
import { FIXTURE_NOW, buildFixtureSite } from "./helpers/fixture-site.mjs";

// #621(#587 PR3) 전세 vs 월세 장의 환산 월 비용 서울 전체 한 줄. 픽스처는 build-monthly-cost.ts 의 docs/data/monthly-cost.json 모양(서울 전체만)을
// 손으로 만든 합성값이다 - 마지막 점(202508→202608)만 #587 ① 댓글의 재현 목표(전세안 165.2→208.8, 금리 몫 +8.65%, 월세안 175.0→205.3)에 맞췄다.
const FIXTURE = path.resolve(import.meta.dirname, "fixtures/monthly-cost/monthly-cost.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
const REF = "202610";

const KO =
  "환산 월 비용(평균금리 가정) · 서울 전체, 2025.08→2026.08: 전세안 월 165.2만원 → 208.8만원, +26.39%(95% 구간 +22.21~+28.43%) — 금리 몫 +8.65%, 보증금 몫 +16.33%. " +
  "월세안 월 175만원 → 205.3만원, +17.31%(95% 구간 +14.02~+20.64%) — 금리 몫 +4.68%, 보증금·월세 몫 +12.06%. " +
  "각 달까지 6개월 신규 계약의 중앙값이고, 보증금의 80%는 전세대출, 20%는 자기 돈(포기한 세후 예금이자)으로 가정했습니다. " +
  "대출·예금 금리는 시장 평균이며, 개인이 지금 새로 받는 금리와 다릅니다. 1년 변화 점 5개 가운데 마지막 점이며 아직 계열이 아닙니다.";
const EN =
  "Estimated monthly cost (at average rates), all of Seoul, 2025.08→2026.08: jeonse 165.2 → 208.8 (10k KRW a month), +26.39% (95% interval +22.21~+28.43%) — rate share +8.65%, deposit share +16.33%. " +
  "Monthly rent 175 → 205.3, +17.31% (95% interval +14.02~+20.64%) — rate share +4.68%, deposit-and-rent share +12.06%. " +
  "Medians of new contracts over the six months to each month; assumes 80% of the deposit is a jeonse loan and 20% your own money (forgone after-tax deposit interest). " +
  "Loan and deposit rates are market averages, not the rate you would get on a new loan. The last of 5 year-over-year points, not yet a series.";

const clone = () => JSON.parse(JSON.stringify(data));

test("이름은 판정 원문이고 생성기와 같다(「실부담」 없음)", () => {
  assert.deepEqual(NAME, { ko: "환산 월 비용(평균금리 가정)", en: "Estimated monthly cost (at average rates)" });
  assert.deepEqual(NAME, GENERATOR_NAME);
  assert.deepEqual(data.name, NAME);
  const text = monthlyCostText(data, REF);
  assert.ok(!text.ko.includes("실부담"));
});

test("파일이 있으면 마지막 점을 글자 그대로 적는다(ko/en)", () => {
  assert.deepEqual(monthlyCostText(data, REF), { ko: KO, en: EN });
});

test("정직성 문구: 평균금리 가정·#589 표현·80% 가정·점(계열 아님)·구간·두 몫", () => {
  const { ko, en } = monthlyCostText(data, REF);
  for (const s of ["평균금리 가정", "시장 평균이며, 개인이 지금 새로 받는 금리와 다릅니다", "80%", "아직 계열이 아닙니다", "95% 구간", "금리 몫", "보증금 몫"]) assert.ok(ko.includes(s), s);
  for (const s of ["at average rates", "market averages", "not the rate you would get on a new loan", "80%", "not yet a series", "95% interval", "rate share", "deposit share"])
    assert.ok(en.includes(s), s);
});

test("보이는 숫자는 파일 숫자 그대로이고 칸·중앙 보증금 원값은 싣지 않는다", () => {
  const p = data.points.at(-1);
  const html = monthlyCostLineHtml(data, REF);
  for (const side of [p.jeonse, p.wolse]) for (const v of [side.cost10k, side.baseCost10k, side.yoy, side.rateShare, ...side.ci]) assert.ok(html.includes(String(v)), String(v));
  for (const v of [p.jeonse.deposit10k, p.jeonse.baseDeposit10k, p.wolse.deposit10k, p.wolse.baseDeposit10k, p.pairs, p.basePairs]) assert.ok(!html.includes(String(v)), String(v));
  const districts = Object.keys(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures/site/data/conversion.json"), "utf8")).slugs);
  assert.equal(districts.length, 25);
  for (const name of districts) assert.ok(!html.includes(name), name);
  assert.equal((html.match(/<p /g) ?? []).length, 2);
  assert.match(html, /<p class="updated" data-mc="en" hidden>/);
});

test("파일이 없거나 모양이 어긋나면 그리지 않는다(지어낸 값·0 없음)", () => {
  assert.equal(monthlyCostLineHtml(null, REF), "");
  assert.equal(monthlyCostLineHtml({}, REF), "");
  assert.equal(monthlyCostLineHtml({ points: [] }, REF), "");
  assert.equal(monthlyCostLineHtml(data, undefined), "", "기준 달(전환율 창)이 없으면 그리지 않는다");
  const broken = [
    (d) => delete d.points.at(-1).jeonse.ci,
    (d) => (d.points.at(-1).wolse.levelShare = null),
    (d) => (d.points.at(-1).jeonse.cost10k = 0),
    (d) => (d.points.at(-1).jeonse.yoy = "26.39"),
    (d) => (d.points.at(-1).wolse.ci = [20, 10]),
    (d) => (d.points.at(-1).month = "2026-08"),
  ];
  for (const breakIt of broken) {
    const d = clone();
    breakIt(d);
    assert.equal(latestPoint(d, REF), null, String(breakIt));
    assert.equal(monthlyCostLineHtml(d, REF), "");
  }
});

test(`낡은 점(전환율 창 끝 달보다 ${STALE_MONTHS}달 넘게 전)·미래 점은 그리지 않는다`, () => {
  assert.ok(latestPoint(data, "202612"), "넉 달 전까지는 그린다");
  assert.equal(latestPoint(data, "202701"), null);
  assert.equal(latestPoint(data, "202607"), null, "창 끝보다 뒤인 점");
});

test("고정 데이터 렌더: 파일이 없으면 줄이 없고, 있으면 ko/en 두 문단이 구워진다", () => {
  const absent = buildFixtureSite({ steps: ["scripts/prerender.ts"] });
  try {
    const html = absent.read("docs/jeonse-vs-wolse.html");
    assert.ok(html.includes("<!--prerender:monthlyCostLine--><!--/prerender:monthlyCostLine-->"));
    assert.ok(!html.includes("data-mc=\"ko\""));
    assert.ok(!html.includes(NAME.ko));
  } finally {
    absent.cleanup();
  }
  const present = buildFixtureSite({ steps: [] });
  try {
    copyFileSync(FIXTURE, path.join(present.data, "monthly-cost.json"));
    const r = spawnSync(process.execPath, [path.join(present.root, "scripts/prerender.ts")], {
      cwd: present.root,
      env: { ...process.env, BUILD_NOW: FIXTURE_NOW },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const html = present.read("docs/jeonse-vs-wolse.html");
    assert.ok(html.includes(`<p class="updated" data-mc="ko">${KO}</p><p class="updated" data-mc="en" hidden>${EN}</p>`));
    // 줄은 첫 문단 바로 뒤에 놓인다.
    assert.ok(html.indexOf('data-mc="ko"') > html.indexOf("<!--/prerender:conversionLead-->"));
    assert.ok(html.indexOf('data-mc="ko"') < html.indexOf('id="cross-basis"'));
  } finally {
    present.cleanup();
  }
});
