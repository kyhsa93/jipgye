// 전망 장 입주 예정 절의 구×반기 표(#677 PR1): 나가는 장의 글자·인라인 바이트·화면 스크립트와 json 키의 맞물림.
// 값(세대수)에 기대지 않는다(#8) - 25구가 다 있고, 칸의 모양이 규칙대로이고, 꼬리에 기준일·추정치·출처가 있는지만 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "./helpers/site-root.mjs";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { moveInSourceLine } from "../scripts/source-lines.ts";
import { districtMoveInSentence } from "../scripts/move-in.ts";
import { koOnly } from "../scripts/bilingual-cell.ts";
import { DISTRICT_PAGES } from "../scripts/district-slugs.ts";
import { REALESTATE_PAGES, buildDistrictPage, buildRealestatePage } from "../scripts/build-realestate-pages.ts";

const root = path.resolve(import.meta.dirname, "..");
const page = () => readFile(path.join(SITE, "price-outlook.html"), "utf8");
const json = async () => JSON.parse(await readFile(path.join(root, "docs/data/move-in.json"), "utf8"));
const fragment = (html) => new RegExp("<!--prerender:moveInDistricts-->([\\s\\S]*?)<!--/prerender:moveInDistricts-->").exec(html)?.[1];

test("나가는 전망 장: 25구가 모두 한 줄씩 「n세대(임대 m)」·「없음」·「예정 없음」으로, 꼬리에 추정치·기준일·출처 (#677)", async () => {
  const raw = fragment(await page());
  assert.ok(raw, "구운 조각이 없다");
  // 머리글·구 이름은 두 벌(m-ko·m-en)로 구워진다(#708): 25구 모두 영어 이름이 따로 있고, 한국어 보기(영어 스팬을 걷고 한국어 스팬을 벗김)는 전과 같은 모양이다.
  assert.equal([...raw.matchAll(/<th scope="row"><span class="m-ko">[^<]+<\/span><span class="m-en">[A-Z][a-z]+-gu<\/span><\/th>/g)].length, 25);
  const frag = koOnly(raw).replace(/<span class="m-ko">([^<]*)<\/span>/g, "$1");
  const rows = [...frag.matchAll(/<tr><th scope="row">([^<]+)<\/th>([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(rows.map((m) => m[1]), DISTRICTS.map((d) => d.name), "25구가 구 코드 순으로 모두 있어야 한다");
  const halves = [...frag.matchAll(/<th scope="col">/g)].length - 1;
  assert.ok(halves >= 1, "반기 칸이 없다");
  const CELL = /^<td>(?:\d{1,3}(?:,\d{3})*세대\(임대 \d{1,3}(?:,\d{3})*\)|없음)<\/td>$/;
  for (const [, name, cells] of rows) {
    if (cells === `<td colspan="${halves}">예정 없음</td>`) continue;
    const tds = cells.match(/<td>[^<]*<\/td>/g) ?? [];
    assert.equal(tds.join(""), cells, `${name}: 칸 모양이 아니다`);
    assert.equal(tds.length, halves, `${name}: 칸 수`);
    for (const td of tds) assert.match(td, CELL, `${name}: ${td}`);
  }
  const foot = /<tfoot>([\s\S]*)<\/tfoot>/.exec(frag)?.[1];
  assert.ok(foot, "표 꼬리가 없다");
  assert.match(foot, /추정치 · 기준일 \d{4}-\d{2}-\d{2}/);
  assert.match(foot, /실제 입주 아님/);
  assert.ok(foot.includes(moveInSourceLine("ko")), "출처 줄이 source-lines 의 글자가 아니다");
  assert.doesNotMatch(frag, /입주[^.]{0,12}(많|몰리|늘)[^.]{0,12}(내린|내려|떨어|하락|오른|올라|상승)|전세[^.]{0,8}(내린다|내려간다|떨어진다|오른다)/, "인과 문장");
});

test("구운 조각은 json 의 districtTable.ko 와 같고 영어는 같은 키에 있다 - 화면 스크립트가 같은 키를 고른다 (#677)", async () => {
  const [html, j] = [await page(), await json()];
  // 구운 조각은 머리글·구 이름을 두 벌(m-ko·m-en)로 굽는다(#708) - 영어 스팬을 걷고 한국어 스팬을 벗기면 json 의 한국어 조각이다.
  assert.equal(koOnly(fragment(html)).replace(/<span class="m-ko">([^<]*)<\/span>/g, "$1"), j.districtTable.ko);
  assert.ok(j.districtTable.en?.includes("None planned") && j.districtTable.en.includes(moveInSourceLine("en")));
  assert.equal(j.byDistrict.rows.length, 25);
  const tpl = await readFile(path.join(root, "docs/price-outlook.html"), "utf8");
  assert.ok(tpl.includes('setTable("move-in-districts", mi.districtTable?.[locale] ?? "");'), "스크립트가 districtTable 을 안 고른다 - 영어로 바꿀 때 표가 안 바뀐다");
  assert.match(tpl, /<table class="rate-table" id="move-in-districts"[ >]/, "표 요소 id 가 스크립트가 쓰는 move-in-districts 가 아니다");
});

test("전망 장 인라인 스크립트는 구×반기 표 때문에 늘지 않는다 - origin/main 17367 B 이하 (#677, S6 인라인 바이트)", async () => {
  const tpl = await readFile(path.join(root, "docs/price-outlook.html"), "utf8");
  const script = [...tpl.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("");
  assert.ok(Buffer.byteLength(script) <= 17367, `인라인 스크립트 ${Buffer.byteLength(script)} B`);
});

// ---- 자치구 장 입주 예정 한 줄(#677 PR2) ----
// 값(세대수)을 시험에 적지 않는다(#8) - 나가는 장의 줄을 json(byDistrict)에서 다시 읽어 만든 글자와 견주고, 모양과 표지만 본다.
const lineOf = (html, lang) => {
  const key = lang === "ko" ? "Ko" : "En";
  return new RegExp(`<p class="[^"]*" data-summary-lang="${lang}"(?: hidden)?><!--prerender:districtMoveIn${key}-->([\\s\\S]*?)<!--/prerender:districtMoveIn${key}--></p>`).exec(html)?.[1];
};
const LINK = { ko: '<a href="./price-outlook.html#move-in-districts">자치구별 표 →</a>', en: '<a href="./price-outlook.html#move-in-districts">District table →</a>' };
const CAUSAL = /입주[^.]{0,12}(많|몰리|늘)[^.]{0,12}(내린|내려|떨어|하락|오른|올라|상승)|전세[^.]{0,8}(내린다|내려간다|떨어진다|오른다)|(?:move-ins?|supply)[^.]{0,20}(push|drive|cause|lower|raise)/i;

test("나가는 자치구 장 25장: 입주 예정 한 줄이 ko/en 모두 json 의 그 구 칸과 같다 - 기준일·실제 입주 아님·출처·표 링크 (#677)", async () => {
  const j = await json();
  const byName = new Map(j.byDistrict.rows.map((r) => [r.name, r]));
  assert.equal(DISTRICT_PAGES.length, 25);
  for (const district of DISTRICT_PAGES) {
    const html = await readFile(path.join(SITE, district.file), "utf8");
    const row = byName.get(district.name);
    assert.ok(row, `${district.name}: json 에 행이 없다`);
    for (const lang of ["ko", "en"]) {
      const line = lineOf(html, lang);
      assert.ok(line, `${district.file} ${lang}: 줄이 없다`);
      assert.equal(line, `${districtMoveInSentence(district.name, j, lang)} ${LINK[lang]}`, `${district.file} ${lang}: 글자가 데이터와 다르다`);
      assert.ok(line.includes(`${lang === "ko" ? "기준일" : "as of"} ${j.basis}`), `${district.file} ${lang}: 기준일`);
      assert.ok(line.includes(lang === "ko" ? "실제 입주 아님" : "not actual move-ins"), `${district.file} ${lang}: 실제 입주 아님`);
      assert.ok(line.includes(moveInSourceLine(lang)), `${district.file} ${lang}: 출처 줄이 source-lines 의 글자가 아니다`);
      const empty = row.units.every((u) => !u) && !j.byDistrict.undated?.districts.includes(district.name);
      if (empty) assert.ok(line.includes(lang === "ko" ? "예정 없음" : "none planned"), `${district.file} ${lang}: 빈 구는 「예정 없음」`);
      else for (const u of row.units.filter((x) => x > 0)) assert.ok(line.includes(u.toLocaleString(lang === "ko" ? "ko-KR" : "en-US")), `${district.file} ${lang}: ${u}`);
      assert.doesNotMatch(line, CAUSAL, `${district.file} ${lang}: 인과 문장`);
    }
    assert.ok(html.includes('data-summary-lang="en" hidden><!--prerender:districtMoveInEn-->'), `${district.file}: 영어 줄은 숨김으로 시작`);
  }
});

test("입주 예정 한 줄: 집계가 없으면 그 줄만 빈다 - 서울 전체 장에는 없다 - 인라인 스크립트는 줄 때문에 늘지 않는다 (#677)", async () => {
  const [j, tpl, realestate] = await Promise.all([
    json(),
    readFile(path.join(root, "scripts/realestate-template.html"), "utf8"),
    readFile(path.join(root, "docs/data/realestate.json"), "utf8").then(JSON.parse),
  ]);
  const inline = (html) => [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("");
  const district = DISTRICT_PAGES[0];
  const without = buildDistrictPage(tpl, district, realestate);
  const withLine = buildDistrictPage(tpl, district, realestate, null, null, null, null, j);
  assert.equal(lineOf(without, "ko"), "");
  assert.equal(lineOf(without, "en"), "");
  assert.ok(lineOf(withLine, "ko")?.startsWith("입주 예정(추정): "));
  assert.equal(inline(withLine), inline(without), "줄이 인라인 스크립트를 바꿨다 - 줄은 빌드 때 구운 글자여야 한다");
  assert.equal(withLine.match(/<script/g)?.length, without.match(/<script/g)?.length, "스크립트 요소 수");
  const all = buildRealestatePage(tpl, REALESTATE_PAGES[0], realestate);
  assert.equal(lineOf(all, "ko"), "", "서울 전체 장에는 입주 예정 줄이 없다");
});

test("입주 예정 한 줄: 빈 구는 「예정 없음」, 달 미정만 있는 구는 「없음」이라 하지 않는다 (#677)", () => {
  const mi = (rows, undated = null) => ({ basis: "2026-06-30", byDistrict: { halves: ["2026H2", "2027H1"], rows, undated } });
  const zero = (name) => ({ name, units: [0, 0], rental: [0, 0] });
  assert.ok(districtMoveInSentence("종로구", mi([zero("종로구")]), "ko").startsWith("입주 예정(추정): 예정 없음 · 기준일 2026-06-30"));
  assert.ok(districtMoveInSentence("종로구", mi([zero("종로구")]), "en").startsWith("Scheduled move-ins (estimate): none planned"));
  const undated = { units: 5, rentalUnits: 0, districts: ["구로구"] };
  const gu = districtMoveInSentence("구로구", mi([zero("구로구")], undated), "ko");
  assert.ok(gu.includes("달 미정 단지"));
  assert.ok(!gu.startsWith("입주 예정(추정): 예정 없음"));
  assert.equal(districtMoveInSentence("없는구", mi([zero("종로구")]), "ko"), null);
  assert.equal(districtMoveInSentence("종로구", null, "ko"), null);
});
