// 자치구 25장의 「같은 집이 다시 팔렸을 때」 한 줄(#716 G1) 시험. 문장은 scripts/district-facts.ts, 값은 docs/data/repeat-sales.json 의 rows.
// 값에 기대지 않는다(#8) - 나가는 장의 줄을 json 에서 다시 읽어 만든 글자와 견주고, thin 문구·금지어·한계 문구·바이트만 본다.
// ok 구 수는 빌드 시점 값이다(2026-08 창의 23구를 가정하지 않는다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { SITE } from "./helpers/site-root.mjs";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { DISTRICT_PAGES } from "../scripts/district-slugs.ts";
import { RESALE_LINK, districtResaleSentence } from "../scripts/district-facts.ts";
import { FORBIDDEN } from "../scripts/repeat-sales.ts";
import { SOURCES } from "../scripts/source-lines.ts";
import { REALESTATE_PAGES, buildDistrictPage, buildRealestatePage } from "../scripts/build-realestate-pages.ts";

const root = path.resolve(import.meta.dirname, "..");
const json = async () => JSON.parse(await readFile(path.join(root, "docs/data/repeat-sales.json"), "utf8"));
const codeOf = (name) => DISTRICTS.find((d) => d.name === name).code;

const lineOf = (html, lang) => {
  const key = lang === "ko" ? "Ko" : "En";
  return new RegExp(`<p class="[^"]*" data-summary-lang="${lang}"(?: hidden)?><!--prerender:districtResale${key}-->([\\s\\S]*?)<!--/prerender:districtResale${key}--></p>`).exec(html)?.[1];
};
const LINK = {
  ko: `<a href="${RESALE_LINK.href}">${RESALE_LINK.ko}</a>`,
  en: `<a href="${RESALE_LINK.href}">${RESALE_LINK.en}</a>`,
};
const HEAD = { ko: "같은 집이 다시 팔렸을 때", en: "When the same home sold again" };
const CAUSAL = /편향|bias|더 올랐|더 올라|순위|가장 (높|많)|rank|outperform|(오르|올라|상승)[^.]{0,6}(전망|예상)|사야|살 때/i;
const FORBID = [...FORBIDDEN, "편향", "bias"];

test("나가는 자치구 장 25장: 한 줄이 ko/en 모두 json 의 그 구 칸과 같다 - ok 는 값·90% 구간·쌍·보유 중앙·R-ONE, thin 은 숫자 없이 표본 부족 (#716)", async () => {
  const j = await json();
  const byCode = new Map(j.rows.map((r) => [r.gu, r]));
  assert.equal(DISTRICT_PAGES.length, 25);
  let ok = 0;
  for (const district of DISTRICT_PAGES) {
    const html = await readFile(path.join(SITE, district.file), "utf8");
    const row = byCode.get(codeOf(district.name));
    assert.ok(row, `${district.name}: json 에 행이 없다`);
    for (const lang of ["ko", "en"]) {
      const line = lineOf(html, lang);
      assert.ok(line, `${district.file} ${lang}: 줄이 없다`);
      assert.equal(line, `${districtResaleSentence(codeOf(district.name), j, lang)} ${LINK[lang]}`, `${district.file} ${lang}: 글자가 데이터와 다르다`);
      assert.ok(line.startsWith(HEAD[lang]), `${district.file} ${lang}: 첫말`);
      if (row.st === "ok") {
        for (const v of row.p) assert.ok(line.includes(`${v > 0 ? "+" : ""}${v.toFixed(1)}%`), `${district.file} ${lang}: ${v}`);
        assert.ok(line.includes(lang === "ko" ? `${row.n}쌍` : `${row.n} pairs`), `${district.file} ${lang}: 쌍 수`);
        assert.ok(line.includes(lang === "ko" ? `보유 중앙 ${row.gap}일` : `median hold ${row.gap} days`), `${district.file} ${lang}: 보유 중앙`);
        assert.ok(line.includes("90%") && line.includes("R-ONE"), `${district.file} ${lang}: 구간·R-ONE`);
      } else {
        assert.ok(line.includes(lang === "ko" ? `n=${row.n}쌍` : `n=${row.n} pairs`) || line.includes(`${row.n}`), `${district.file} ${lang}: 쌍 수`);
        assert.doesNotMatch(line.replace(/<[^>]+>/g, ""), /%|R-ONE/, `${district.file} ${lang}: 값을 비운 구에 숫자가 있다`);
      }
    }
    assert.ok(html.includes('data-summary-lang="en" hidden><!--prerender:districtResaleEn-->'), `${district.file}: 영어 줄은 숨김으로 시작`);
    if (row.st === "ok") ok += 1;
  }
  assert.equal(ok, j.rows.filter((r) => r.st === "ok").length, "ok 구 수는 빌드 시점 json 의 값이다");
});

test("줄은 한 장에 ko·en 한 벌씩이고, 입주 예정 줄 뒤·구 링크 앞에 놓인다 - 서울 전체·거래유형 장에는 없다 (#716)", async () => {
  const [tpl, realestate, j] = await Promise.all([
    readFile(path.join(root, "scripts/realestate-template.html"), "utf8"),
    readFile(path.join(root, "docs/data/realestate.json"), "utf8").then(JSON.parse),
    json(),
  ]);
  const html = buildDistrictPage(tpl, DISTRICT_PAGES[0], realestate, null, null, null, null, null, j);
  assert.equal(html.match(/<!--prerender:districtResaleKo-->/g).length, 1);
  assert.equal(html.match(/<!--prerender:districtResaleEn-->/g).length, 1);
  const at = (s) => html.indexOf(s);
  assert.ok(at("<!--prerender:districtMoveInEn-->") < at("<!--prerender:districtResaleKo-->"));
  assert.ok(at("<!--/prerender:districtResaleEn-->") < at('class="card-links district-here"'));
  for (const p of REALESTATE_PAGES) {
    const page = buildRealestatePage(tpl, p, realestate);
    assert.equal(lineOf(page, "ko"), "", `${p.file}: 거래유형 장에는 줄이 없다`);
  }
});

test("thin 구(종로·중구 같은 표본 부족)는 숫자 없이 「표본 부족(n=…쌍)」, shaky 는 값 비움 - ko/en (#716)", () => {
  const D = (rows, patch = {}) => ({ window: { from: "202411", to: "202608", gap: [300, 730] }, checks: { kill: false, enough: true }, rows, ...patch });
  const rows = [
    { gu: codeOf("종로구"), n: 53, st: "thin" },
    { gu: codeOf("중구"), n: 88, st: "thin" },
    { gu: codeOf("용산구"), n: 119, st: "shaky" },
  ];
  assert.equal(districtResaleSentence(codeOf("종로구"), D(rows), "ko"), "같은 집이 다시 팔렸을 때: 표본 부족(n=53쌍)이라 값을 싣지 않습니다.");
  assert.equal(districtResaleSentence(codeOf("중구"), D(rows), "ko"), "같은 집이 다시 팔렸을 때: 표본 부족(n=88쌍)이라 값을 싣지 않습니다.");
  assert.equal(districtResaleSentence(codeOf("종로구"), D(rows), "en"), "When the same home sold again: not enough sample (n=53 pairs), so no figure is shown.");
  assert.match(districtResaleSentence(codeOf("용산구"), D(rows), "ko"), /값이 흔들려 싣지 않습니다\(119쌍\)/);
  // 표 자체가 접히면(킬 스위치·값을 낼 수 있는 구 13곳 미만) 줄도 없다.
  assert.equal(districtResaleSentence(codeOf("종로구"), D(rows, { checks: { kill: true, enough: true } }), "ko"), null);
  assert.equal(districtResaleSentence(codeOf("종로구"), D(rows, { checks: { kill: false, enough: false } }), "ko"), null);
  assert.equal(districtResaleSentence(codeOf("서초구"), D(rows), "ko"), null);
  assert.equal(districtResaleSentence(null, D(rows), "ko"), null);
  assert.equal(districtResaleSentence(codeOf("종로구"), null, "ko"), null);
});

test("한계 문구가 갈아타기 V8 절과 같다: 시장 지수 아님·연율화 안 함·R-ONE 차이는 원인 미측정(편향이라 부르지 않음), 금지어·순위·인과 0 (#716)", async () => {
  const j = await json();
  const ok = j.rows.find((r) => r.st === "ok");
  assert.ok(ok, "ok 구가 하나도 없다 - 이 시험은 값을 낼 수 있는 구가 있어야 한다");
  const texts = {
    ko: districtResaleSentence(ok.gu, j, "ko"),
    en: districtResaleSentence(ok.gu, j, "en"),
  };
  assert.ok(texts.ko.includes("시장 지수·구 시세 상승률이 아니며 연율화하지 않았습니다"));
  assert.ok(texts.ko.includes("차이의 원인은 재지 않았습니다"));
  // R-ONE 값은 쌍 기간에 맞춰 가공한 값이라 같은 문장에 가공 표시가 붙고, 기관 이름은 source-lines 의 SOURCES.reb 에서 온다(글자로 쓰지 않는다, legal #723). ko·en 짝.
  assert.ok(texts.ko.includes(`가공한 ${SOURCES.reb.ko} R-ONE 값은`) && /가공/.test(texts.ko));
  assert.ok(texts.en.includes(`${SOURCES.reb.en} R-ONE data, processed to the same pair periods`) && /processed/.test(texts.en));
  assert.doesNotMatch(texts.ko + texts.en, /바꿨|수정|corrected|adjusted/);
  assert.ok(texts.en.includes("Not a market index or district price growth, not annualised"));
  assert.ok(texts.en.includes("the cause of the gap was not measured"));
  for (const row of j.rows) {
    for (const lang of ["ko", "en"]) {
      const s = districtResaleSentence(row.gu, j, lang);
      for (const w of FORBID) assert.ok(!s.toLowerCase().includes(w.toLowerCase()), `${row.gu} ${lang}: 금지어 ${w}`);
      assert.doesNotMatch(s, CAUSAL, `${row.gu} ${lang}: 순위·인과 문장`);
      assert.ok(s.startsWith(HEAD[lang]));
    }
  }
});

test("rows 필드 불변: 줄은 gu·n·st·out·gap·p 와 window·checks 만 읽는다 - json 에 칸이 더해져도(#697) 글자가 같다 (#716)", async () => {
  const j = await json();
  const plus = {
    ...j,
    newTopLevel: { x: 1 },
    window: { ...j.window, note: "x" },
    rows: j.rows.map((r) => ({ ...r, extra: [1, 2, 3], by: { band: "x" }, p2: [0, 0, 0, 0] })),
  };
  for (const r of j.rows) for (const lang of ["ko", "en"]) assert.equal(districtResaleSentence(r.gu, plus, lang), districtResaleSentence(r.gu, j, lang));
  // 읽는 칸이 모두 있는지: ok 구 칸은 p 네 개와 gap·n 이다. 하나라도 이름이 바뀌면 이 시험이 먼저 깨진다.
  for (const r of j.rows) {
    assert.equal(typeof r.gu, "string");
    assert.equal(typeof r.n, "number");
    assert.ok(["ok", "thin", "shaky"].includes(r.st), `${r.gu}: st`);
    if (r.st === "ok") {
      assert.equal(r.p.length >= 4, true, `${r.gu}: p`);
      assert.equal(typeof r.gap, "number", `${r.gu}: gap`);
    }
  }
  assert.equal(typeof j.window.from, "string");
  assert.equal(typeof j.checks.enough, "boolean");
});

test("바이트: 나가는 25장에서 줄(두 문단)을 빼 보면 늘어난 것이 gzip 으로 장당 ≤ 450 B, 인라인 스크립트는 줄과 무관하다 (#716)", async () => {
  const [tpl, realestate, j] = await Promise.all([
    readFile(path.join(root, "scripts/realestate-template.html"), "utf8"),
    readFile(path.join(root, "docs/data/realestate.json"), "utf8").then(JSON.parse),
    json(),
  ]);
  const block = /    <p class="district-summary[^"]*" data-summary-lang="(?:ko|en)"(?: hidden)?><!--prerender:districtResale(?:Ko|En)-->[\s\S]*?<\/p>\n/g;
  const inline = (html) => [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("");
  for (const district of DISTRICT_PAGES) {
    const html = await readFile(path.join(SITE, district.file), "utf8");
    const without = html.replace(block, "");
    assert.equal(html.match(block)?.length, 2, `${district.file}: 줄 문단이 ko·en 두 개가 아니다`);
    const delta = gzipSync(html).length - gzipSync(without).length;
    assert.ok(delta <= 450, `${district.file}: gzip +${delta} B`);
    // 줄은 빌드 때 구운 글자다 - 줄을 넣고 빼도 인라인 스크립트·script 요소가 같다.
    const built = buildDistrictPage(tpl, district, realestate, null, null, null, null, null, j);
    const bare = buildDistrictPage(tpl, district, realestate);
    assert.equal(inline(built), inline(bare), `${district.file}: 줄이 인라인 스크립트를 바꿨다`);
    assert.equal(built.match(/<script/g)?.length, bare.match(/<script/g)?.length, `${district.file}: script 요소 수`);
    assert.equal(lineOf(bare, "ko"), "");
  }
});

test("줄의 링크가 가리키는 갈아타기 장 앵커(#repeat-sales)가 나가는 장에 있다 (#716)", async () => {
  const html = await readFile(path.join(SITE, "switch-house.html"), "utf8");
  assert.ok(RESALE_LINK.href.startsWith("./switch-house.html#"));
  assert.ok(html.includes(`id="${RESALE_LINK.href.split("#")[1]}"`), "갈아타기 장에 쌍 절 앵커가 없다");
});
