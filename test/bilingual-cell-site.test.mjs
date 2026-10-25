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

test("record-high: 문턱 표 — 머리글 줄·결론 칸(마지막 칸)은 영어, 결론은 yes/no 형 영어 낱말이다", async () => {
  const table = bodyOf(await tableOf("record-high", "robust-table"));
  const cells = cellsOf(enOnly(table));
  const head = cells.filter((c) => c.section === "thead");
  const last = cells.filter((c) => c.section === "tbody" && c.col === 8);
  assert.equal(head.length, 9);
  assert.ok(last.length >= 6, `결론 칸 ${last.length}`);
  for (const c of [...head, ...last]) assert.equal(hangul(c.inner), 0, c.inner);
  for (const c of last) assert.match(c.inner.replace(/<[^>]+>/g, ""), /^[A-Za-z][A-Za-z ]*$/, `결론 칸 영어 낱말: ${c.inner}`);
  // 한국어 쪽 결론 칸은 그대로 한글이다(영어 낱말이 새지 않는다).
  for (const c of cellsOf(koOnly(table)).filter((x) => x.section === "tbody" && x.col === 8)) assert.match(c.inner, /^<span class="m-ko">[가-힣]+<\/span>$|^[가-힣]+$/);
});

test("record-high: 가격대 표 — 첫 칸(가격대 이름)은 영어, 영어 쪽 가격은 ₩ 단위", async () => {
  const table = bodyOf(await tableOf("record-high", "band-table"));
  const names = cellsOf(enOnly(table)).filter((c) => c.section === "tbody" && c.col === 0);
  assert.ok(names.length >= 4);
  for (const c of names) assert.equal(hangul(c.inner), 0, c.inner);
  assert.ok(names.some((c) => /₩/.test(c.inner)), "원화 기호 가격대");
});

test("record-high 영어 화면 한글 상한 — 세 표 합계 (기준선 238자 → 남은 것은 문턱 표 단위 칸·가격대 표 머리글)", async () => {
  let total = 0;
  for (const id of ["robust-table", "district-table", "band-table"]) total += hangul(enOnly(bodyOf(await tableOf("record-high", id))));
  assert.ok(total <= 60, `영어 쪽 한글 ${total}자`);
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
