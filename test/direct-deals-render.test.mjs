// 해제·등기 장의 직거래 절(#691 R). 문장·표는 빌더가 두 언어로 만들고, 장은 굽고(ko) 언어 전환 때 고르기만 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DIRECT_HEADING, MIN_CELLS, directLead, directNote } from "../scripts/direct-deals.ts";
import { buildPayload } from "../scripts/build-direct-deals.ts";
import { loadPage } from "./helpers/digest-page.mjs";
import { sitePath } from "./helpers/site-root.mjs";

const MONTHS = ["202608", "202609", "202610"];
const deal = (extra = {}) => ({
  sggCd: 11350,
  aptNm: "가단지",
  excluUseAr: 84.9,
  dealYear: 2026,
  dealMonth: 8,
  dealAmount: "100,000",
  dealingGbn: "중개거래",
  cdealType: "",
  ...extra,
});
const direct = (extra = {}) => deal({ dealingGbn: "직거래", ...extra });
const cells = (n, sggCd, name) =>
  Array.from({ length: n }, (_, k) => [
    ...[0, 1, 2].map(() => direct({ aptNm: `${name}${k}`, sggCd, dealAmount: "90,000" })),
    ...[0, 1, 2].map(() => deal({ aptNm: `${name}${k}`, sggCd })),
  ]).flat();

const STATS = buildPayload({
  byDistrict: { 노원구: cells(MIN_CELLS, 11350, "가"), 강남구: cells(2, 11680, "나") },
  months: MONTHS,
  now: new Date("2026-10-26T00:00:00Z"),
});

const SUB_NAV = ["all", "sale", "jeonse", "wolse", "search", "conversion", "renewal", "cancelled"];
const open = (data = { "direct-deals": STATS }) => loadPage({ file: "cancelled-deals.html", data, subNav: SUB_NAV });

test("문장: 격차는 중간값·90% 구간·칸 수를 함께 적고, 사유는 모른다고 하며 특수관계라 단정하지 않는다", () => {
  assert.match(STATS.lead.ko, /중간값 10% 낮았습니다\(/);
  assert.match(STATS.lead.ko, /90% 구간 -10~-10%/);
  assert.match(STATS.lead.ko, /\d+칸/);
  assert.match(STATS.lead.en, /median 10% below/);
  assert.match(STATS.note.ko, /알 수 없습니다/);
  assert.match(STATS.note.ko, /특수관계 거래라거나, 부당했다거나, 신고가 사실과 다르다고 말할 수 없습니다/);
  assert.match(STATS.note.ko, /달마다의 시세 변화를 걸러 다시 재도 격차는 줄지 않았습니다\(2026-10-26 확인\)/);
  // 「낮게 신고」는 거짓·다운 신고로 읽힐 수 있어 어느 글자에도 없다(#702 legal).
  for (const text of [STATS.heading.ko, STATS.lead.ko, STATS.note.ko]) assert.ok(!/낮게 신고/.test(text), text);
  for (const text of [STATS.heading.en, STATS.lead.en, STATS.note.en]) assert.ok(!/filed (a median|at)|How low/.test(text), text);
  assert.match(STATS.note.en, /unknown/);
  assert.match(STATS.note.ko, /2026년 9월·2026년 10월은 .*덜 찬 달/);
  assert.equal(directLead({ months: [] }), null);
  assert.ok(directNote(STATS, "ko").includes("자치구별 격차는 칸이 모자라 적지 않습니다."));
});

test("자치구가 하나도 문턱을 못 넘으면 왜 비었는지 문장에 적는다", () => {
  const thin = buildPayload({ byDistrict: { 노원구: cells(3, 11350, "가") }, months: MONTHS, now: new Date("2026-10-26T00:00:00Z") });
  assert.equal(thin.seoul.gap.median, null, "서울도 칸 문턱을 같이 건다");
  const enough = buildPayload({
    byDistrict: { 노원구: cells(MIN_CELLS - 1, 11350, "가"), 강남구: cells(5, 11680, "나") },
    months: MONTHS,
    now: new Date("2026-10-26T00:00:00Z"),
  });
  assert.match(enough.lead.ko, new RegExp(`가장 많은 구도 ${MIN_CELLS - 1}칸이라\\(문턱 ${MIN_CELLS}칸\\) 구별로는 직거래 비중만 적습니다`));
});

test("표: 구 표는 자치구·직거래 2열(서울 줄 먼저), 덜 찬 달 표시, 빈 달은 0%가 아니라 「-」", () => {
  assert.match(STATS.table.ko, /<tbody><tr><td>서울<\/td>/);
  assert.match(STATS.table.ko, /^<thead><tr><th scope="col">자치구<\/th><th scope="col">직거래<\/th><\/tr><\/thead>/);
  assert.match(STATS.table.ko, /<tr><td>강남구<\/td><td>[\d.]+%<\/td><\/tr>/);
  assert.ok(!/격차|90%/.test(STATS.table.ko) && !/Gap|90%/.test(STATS.table.en), "구별 격차 열은 두지 않는다(#702)");
  assert.match(STATS.monthTable.ko, /2026-10 \(덜 참\)/);
  assert.match(STATS.monthTable.en, /2026-10 \(filling\)/);
  assert.match(STATS.monthTable.ko, /<td>2026-09 \(덜 참\)<\/td><td>0<\/td><td>0<\/td><td>-<\/td>/);
});

test("덜 찬 달은 거래가 있어도 비중을 「-」로 둔다 - 건수는 남긴다(#702)", () => {
  const items = [deal({ dealMonth: 8 }), deal({ dealMonth: 10 }), direct({ dealMonth: 10 }), direct({ dealMonth: 9 })];
  const p = buildPayload({ byDistrict: { 노원구: items }, months: MONTHS, now: new Date("2026-10-26T00:00:00Z") });
  assert.deepEqual(p.seoul.share, [0, 100, 50], "JSON 의 원값은 둔다");
  assert.match(p.monthTable.ko, /<td>2026-09 \(덜 참\)<\/td><td>1<\/td><td>1<\/td><td>-<\/td>/);
  assert.match(p.monthTable.ko, /<td>2026-10 \(덜 참\)<\/td><td>2<\/td><td>1<\/td><td>-<\/td>/);
  assert.match(p.monthTable.ko, /<td>2026-08<\/td><td>1<\/td><td>0<\/td><td>0%<\/td>/);
});

test("장: 구운 제목은 빌더 제목과 같고, 언어를 바꾸면 빌더가 만든 영어로 바뀐다", async () => {
  const html = await readFile(sitePath("cancelled-deals.html"), "utf8");
  assert.ok(html.includes(`<h2 id="direct-heading">${DIRECT_HEADING.ko}</h2>`));
  const page = await open();
  assert.equal(page.text("direct-lead"), STATS.lead.ko);
  assert.equal(page.text("direct-note"), STATS.note.ko);
  assert.ok(page.html("direct-table").includes(STATS.table.ko));
  await page.click("lang-toggle");
  assert.equal(page.text("direct-heading"), DIRECT_HEADING.en);
  assert.equal(page.text("direct-lead"), STATS.lead.en);
  assert.ok(page.html("direct-month-table").includes(STATS.monthTable.en));
});

test("장: 직거래 자료를 못 받으면 구운 절을 건드리지 않는다", async () => {
  const page = await open({});
  assert.equal(page.html("direct-table"), "");
  assert.equal(page.html("direct-lead"), "");
});

test("굽기: 나가는 장에 직거래 절이 차 있고 단지명이 없다", async () => {
  const html = await readFile(sitePath("cancelled-deals.html"), "utf8");
  const section = html.match(/<section id="direct-section"[\s\S]*?<\/section>/)?.[0] ?? "";
  for (const name of ["directLead", "directTable", "directMonths", "directNote"]) {
    const frag = section.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1] ?? "";
    assert.ok(frag.length > 30, `${name} 가 비었다`);
  }
  const data = JSON.parse(await readFile(path.resolve(import.meta.dirname, "../docs/data/direct-deals.json"), "utf8"));
  assert.ok(!JSON.stringify(data).includes("aptNm"));
});
