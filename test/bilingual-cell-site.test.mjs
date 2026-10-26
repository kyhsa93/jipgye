import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "./helpers/site-root.mjs";
import { cellsOf, enOnly, koOnly } from "../scripts/bilingual-cell.ts";

/**
 * record-high·price-outlook 의 구운 표(#708): 영어 화면에서 데이터를 받기 전·못 받았을 때 보이는 글자에서 한글을 줄였다.
 * 「영어 화면에 보이는 글자」는 한국어 스팬(m-ko)을 뺀 표 조각이다(CSS 가 같은 것을 가린다 - 접근성 트리 실측은 PR 본문의 브라우저 확인).
 *
 * 세는 것: 장에서 표를 찾아 칸 단위로 센다. 어느 칸이 영어인지는 장 구조(머리글 줄·첫 칸·마지막 칸)로 정하고, 데이터 값·날짜에 기대지 않는다(#8).
 * 남은 한글(숫자 옆 단위 칸·「비움」·긴 칸 글 등)은 상한으로 못 박아 둔다 - 늘면 빨개지고, 줄이면 상한을 내린다.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const HANGUL = /[가-힣]/g;
const hangul = (html) => (html.replace(/<[^>]+>/g, "").match(HANGUL) ?? []).length;

async function tableOf(page, id) {
  const html = await read(`${SITE}/${page}.html`);
  const m = new RegExp(`<table[^>]*id="${id}"[^>]*>([\\s\\S]*?)</table>`).exec(html);
  assert.ok(m, `${page}: ${id} 표가 없다`);
  return m[1];
}
const bodyOf = (table) => table.replace(/<caption[\s\S]*?<\/caption>/, "");
const captionOf = (table) => /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(table)?.[1] ?? "";

test("record-high: 자치구 표는 영어 화면에 한글 0자 — 모든 행 이름이 로마자(-gu)·All Seoul", async () => {
  const table = bodyOf(await tableOf("record-high", "district-table"));
  const en = enOnly(table);
  assert.equal(hangul(en), 0);
  const names = cellsOf(en).filter((c) => c.section === "tbody" && c.col === 0).map((c) => c.inner.replace(/<[^>]+>/g, ""));
  assert.ok(names.length >= 20, `행 ${names.length}`);
  assert.equal(names[0], "All Seoul");
  for (const n of names.slice(1)) assert.match(n, /^[A-Z][a-z]+-gu$/, n);
});

test("record-high: 문턱 표 — 비교 기간 열(col 1)만 빼고 머리글·본문 모든 칸이 영어 화면에 한글 0자, 결론은 yes/no 형 영어 낱말이다", async () => {
  const table = bodyOf(await tableOf("record-high", "robust-table"));
  const cells = cellsOf(enOnly(table));
  const head = cells.filter((c) => c.section === "thead");
  const body = cells.filter((c) => c.section === "tbody");
  const last = body.filter((c) => c.col === 8);
  assert.equal(head.length, 9);
  assert.ok(last.length >= 6, `결론 칸 ${last.length}`);
  for (const c of [...head, ...body.filter((x) => x.col !== 1)]) assert.equal(hangul(c.inner), 0, c.inner);
  for (const c of last) assert.match(c.inner.replace(/<[^>]+>/g, ""), /^[A-Za-z][A-Za-z ]*$/, `결론 칸 영어 낱말: ${c.inner}`);
  // 남은 한글: 비교 기간 열의 「90일」·「180일」뿐이다(칸당 한글 1~2자 · 예산 +2 KB 안에서 가장 값이 낮은 열 - #708 E1b ②).
  const rest = body.filter((c) => hangul(c.inner));
  assert.ok(rest.length >= 6 && rest.every((c) => c.col === 1 && /^\d+일$/.test(c.inner)), `남은 칸 ${rest.map((c) => `${c.col}:${c.inner}`)}`);
  // 한국어 쪽 결론 칸은 그대로 한글이다(영어 낱말이 새지 않는다).
  for (const c of cellsOf(koOnly(table)).filter((x) => x.section === "tbody" && x.col === 8)) assert.match(c.inner, /^<span class="m-ko">[가-힣]+<\/span>$|^[가-힣]+$/);
  // 숫자·% 칸은 두 벌로 갈리지 않는다(바이트).
  for (const c of cellsOf(table).filter((x) => x.section === "tbody" && x.col >= 3 && x.col <= 7)) assert.ok(!/m-ko|m-en/.test(c.inner), c.inner);
});

test("record-high: 가격대 표 — 머리글 줄과 첫 칸(가격대 이름)은 영어, 영어 쪽 가격은 ₩ 단위, 표 전체가 영어 화면에 한글 0자", async () => {
  const table = bodyOf(await tableOf("record-high", "band-table"));
  const en = enOnly(table);
  const names = cellsOf(en).filter((c) => c.section === "tbody" && c.col === 0);
  assert.ok(names.length >= 4);
  for (const c of names) assert.equal(hangul(c.inner), 0, c.inner);
  assert.ok(names.some((c) => /₩/.test(c.inner)), "원화 기호 가격대");
  const head = cellsOf(en).filter((c) => c.section === "thead");
  assert.equal(head.length, 4);
  assert.equal(hangul(en), 0);
});

test("record-high 영어 화면 한글 상한 — 세 표 합계 (기준선 238자 → 12자 이하, −95% 이상: 남은 것은 문턱 표 비교 기간 열 12칸)", async () => {
  let total = 0;
  for (const id of ["robust-table", "district-table", "band-table"]) total += hangul(enOnly(bodyOf(await tableOf("record-high", id))));
  assert.ok(total <= 12, `영어 쪽 한글 ${total}자`);
  assert.ok(total <= 238 * 0.15, `기준선 대비 -85% 이상이어야 한다: ${total}자`);
});

test("price-outlook: 권역·월 칸 — 권역 표·직전 달 표·구×반기 입주 표의 머리글 줄과 첫 칸은 영어 화면에 한글 0자", async () => {
  for (const id of ["region-table", "nowcast-table", "move-in-districts"]) {
    const cells = cellsOf(enOnly(bodyOf(await tableOf("price-outlook", id)))).filter((c) => c.section === "thead" || (c.section === "tbody" && c.col === 0));
    assert.ok(cells.length >= 5, `${id}: 칸 ${cells.length}`);
    for (const c of cells) assert.equal(hangul(c.inner), 0, `${id}: ${c.inner}`);
  }
});

test("price-outlook: 구×반기 입주 표 행 이름은 로마자(-gu)", async () => {
  const cells = cellsOf(enOnly(bodyOf(await tableOf("price-outlook", "move-in-districts")))).filter((c) => c.section === "tbody" && c.col === 0);
  assert.ok(cells.length >= 20, `행 ${cells.length}`);
  for (const c of cells) assert.match(c.inner.replace(/<[^>]+>/g, ""), /^[A-Z][a-z]+-gu$/);
});

test("price-outlook: 직전 달 표 전체(본문 칸 포함)는 영어 화면에 한글 0자 — 권역 표는 「비움」 칸만 남는다", async () => {
  assert.equal(hangul(enOnly(bodyOf(await tableOf("price-outlook", "nowcast-table")))), 0);
  const region = enOnly(bodyOf(await tableOf("price-outlook", "region-table")));
  assert.deepEqual([...new Set(region.replace(/<[^>]+>/g, "|").split("|").filter((t) => HANGUL.test(t)))], ["비움"]);
});

test("두 장의 모든 표는 영어 caption(m-en)을 갖고, 그 caption 에는 한글이 0자다 — 접근성 이름이 영어 화면에서 영어", async () => {
  for (const page of ["record-high", "price-outlook"]) {
    const html = await read(`${SITE}/${page}.html`);
    const tables = [...html.matchAll(/<table(?=[\s>])[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/table>/g)];
    assert.ok(tables.length >= 3, `${page}: 표 ${tables.length}`);
    for (const [, id, inner] of tables) {
      const cap = captionOf(inner);
      const en = /<span class="m-en">([\s\S]*?)<\/span>/.exec(cap)?.[1];
      assert.ok(en, `${page}#${id}: 영어 caption 이 없다`);
      assert.equal(hangul(en), 0, `${page}#${id}: 영어 caption 에 한글`);
      assert.match(cap, /^<span class="m-ko">/);
    }
  }
});

test("한국어 쪽은 그대로다 — 영어 스팬을 걷은 칸의 글자가 데이터 json 의 한국어 표와 칸마다 같다", async () => {
  const record = JSON.parse(await read("docs/data/record-high.json"));
  const outlook = JSON.parse(await read("docs/data/outlook.json"));
  const texts = (html) => cellsOf(html).map((c) => c.inner.replace(/<[^>]+>/g, ""));
  const cases = [
    ["record-high", "district-table", record.tables.districts.ko],
    ["record-high", "band-table", record.tables.bands.ko],
    ["record-high", "robust-table", record.tables.robust.ko],
    ["price-outlook", "region-table", outlook.tables.regions.ko],
    ["price-outlook", "nowcast-table", outlook.tables.nowcast.ko],
    ["price-outlook", "score-table", outlook.tables.score.ko],
    ["price-outlook", "move-in-table", JSON.parse(await read("docs/data/move-in.json")).table.ko],
    ["price-outlook", "indicator-table", JSON.parse(await read("docs/data/outlook-indicators.json")).table.ko],
  ];
  for (const [page, id, ko] of cases) {
    const baked = texts(koOnly(bodyOf(await tableOf(page, id))));
    assert.ok(baked.length > 5, `${page}#${id}: 칸 ${baked.length}`);
    assert.deepEqual(baked, texts(ko), `${page}#${id}: 한국어 쪽이 json 과 다르다`);
  }
});

test("영어 화면 한글 상한 — price-outlook 의 이 PR 대상 표(권역·직전 달·구×반기 입주) 합계", async () => {
  let total = 0;
  for (const id of ["region-table", "nowcast-table", "move-in-districts"]) total += hangul(enOnly(bodyOf(await tableOf("price-outlook", id))));
  // 남는 것: 권역 표 「비움」 칸, 구×반기 표 본문 칸의 「n세대(임대 m)」·「없음」·「예정 없음」, 꼬리(출처·기준일 문장).
  assert.ok(total <= 520, `영어 쪽 한글 ${total}자`);
});

test("E1b ① price-outlook: 점수 표·입주 기간 표·지표 표의 머리글 줄은 영어 화면에 한글 0자, 영어 낱말이다", async () => {
  const want = { "score-table": ["Horizon", "Model", "Published?"], "move-in-table": ["Period"], "indicator-table": ["Indicator added", "3 months", "Verdict"] };
  for (const [id, words] of Object.entries(want)) {
    const heads = cellsOf(enOnly(bodyOf(await tableOf("price-outlook", id)))).filter((c) => c.section === "thead");
    assert.ok(heads.length >= 4, `${id}: 머리글 ${heads.length}`);
    for (const c of heads) assert.equal(hangul(c.inner), 0, `${id}: ${c.inner}`);
    const texts = heads.map((c) => c.inner.replace(/<[^>]+>/g, ""));
    for (const w of words) assert.ok(texts.some((t) => t.startsWith(w)), `${id}: 「${w}」 머리글이 없다 (${texts.join("|")})`);
  }
});

test("E1b ① price-outlook: 지표 표 — 한글이 긴 칸(이름 ≥10자·판정 ≥12자)은 영어 화면에 한글 0자", async () => {
  const table = bodyOf(await tableOf("price-outlook", "indicator-table"));
  const ko = cellsOf(koOnly(table)).filter((c) => c.section === "tbody");
  const en = cellsOf(enOnly(table)).filter((c) => c.section === "tbody");
  assert.equal(ko.length, en.length);
  assert.ok(ko.length >= 40 * 4, `칸 ${ko.length}`);
  let long = 0;
  ko.forEach((k, i) => {
    // 한국어 쪽 칸 글자 수로 가른다 - 영어 쪽 칸은 한글이 0 이어야 하는 칸이다.
    if (!((k.col === 0 && hangul(k.inner) >= 10) || (k.col === 3 && hangul(k.inner) >= 12))) return;
    long += 1;
    assert.equal(hangul(en[i].inner), 0, `${k.inner} → ${en[i].inner}`);
  });
  assert.ok(long >= 20, `영어로 굽힌 긴 칸 ${long}`);
});

test("E1b ① price-outlook 영어 화면 한글 상한 — 여섯 표 합계(#714 직전 1,557자 → ① 뒤 ≤1,010자). 남는 것: 「비움」·입주 본문 칸(③)·지표 표 짧은 칸·꼬리", async () => {
  let total = 0;
  for (const id of ["region-table", "nowcast-table", "move-in-table", "move-in-districts", "score-table", "indicator-table"]) total += hangul(enOnly(bodyOf(await tableOf("price-outlook", id))));
  assert.ok(total <= 1010, `영어 쪽 한글 ${total}자`);
  assert.ok(total >= 700, `하한 점검 — 표 구조가 바뀌었는지 보라: ${total}자`);
});
