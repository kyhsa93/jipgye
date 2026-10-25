import test from "node:test";
import assert from "node:assert/strict";
import { bilingualCells, cellsOf, enOnly, koOnly } from "../scripts/bilingual-cell.ts";
import { accessibleTables } from "../scripts/table-a11y.ts";
import { districtNameEn, DISTRICT_SLUGS } from "../scripts/district-slugs.ts";
import { moveInDistrictTableHtml } from "../scripts/move-in.ts";

/**
 * 두 언어로 구운 표 칸(#708). 순수 함수만 본다 — 데이터 파일·날짜에 기대지 않는다(#8).
 * 사이트에 구워진 모양은 bilingual-cell-site.test.mjs 가 본다.
 */

const KO = '<thead><tr><th scope="col">자치구</th><th scope="col">신고가 뒤<br>≥</th></tr></thead><tbody><tr><td><strong>서울 전체</strong></td><td>44.2%</td></tr><tr><td>강남구</td><td>49.1%</td></tr></tbody><tfoot><tr><td colspan="2">출처 문장입니다</td></tr></tfoot>';
const EN = '<thead><tr><th scope="col">District</th><th scope="col">≥ after<br>record</th></tr></thead><tbody><tr><td><strong>All Seoul</strong></td><td>44.2%</td></tr><tr><td>Gangnam-gu</td><td>49.1%</td></tr></tbody><tfoot><tr><td colspan="2">Source sentence</td></tr></tfoot>';
const both = (ko, en) => `<span class="m-ko">${ko}</span><span class="m-en">${en}</span>`;

test("글자가 다른 칸만 m-ko·m-en 두 벌로 굽고 숫자 칸은 그대로 둔다", () => {
  const out = bilingualCells(KO, EN);
  assert.ok(out.includes(`<th scope="col">${both("자치구", "District")}</th>`));
  assert.ok(out.includes(`<td>${both("강남구", "Gangnam-gu")}</td>`));
  assert.ok(out.includes("<td>44.2%</td>") && out.includes("<td>49.1%</td>"), "숫자 칸은 두 벌로 만들지 않는다");
});

test("안쪽 태그가 같으면 글자 조각만 갈라 굽는다 (<strong> 은 밖에 남는다)", () => {
  const out = bilingualCells(KO, EN);
  assert.ok(out.includes(`<td><strong>${both("서울 전체", "All Seoul")}</strong></td>`));
});

test("어순이 갈리는 칸(「신고가 뒤<br>≥」 ↔ 「≥ after<br>record」)은 조각을 짝짓지 않고 안쪽 전체를 두 벌로 굽는다", () => {
  const out = bilingualCells(KO, EN);
  assert.ok(out.includes(`<th scope="col">${both("신고가 뒤<br>≥", "≥ after<br>record")}</th>`));
  // 영어 보기: 한국어 조각이 하나도 남지 않고, 영어 보기에서 「≥」 가 두 번 나오지 않는다.
  const en = enOnly(out);
  assert.ok(en.includes('<th scope="col"><span class="m-en">≥ after<br>record</span></th>'));
  assert.doesNotMatch(en, /신고가/);
});

test("꼬리(tfoot)는 합치지 않고 한국어 그대로다 — 긴 출처 문장이 바이트를 먹지 않게", () => {
  const out = bilingualCells(KO, EN);
  assert.ok(out.includes('<td colspan="2">출처 문장입니다</td>'));
  assert.doesNotMatch(out, /Source sentence/);
});

test("pick 이 거짓인 칸은 한국어 그대로다 (구·줄·칸 번호로 고른다)", () => {
  const out = bilingualCells(KO, EN, (c) => c.section === "thead");
  assert.ok(out.includes(`<th scope="col">${both("자치구", "District")}</th>`));
  assert.ok(out.includes("<td>강남구</td>"), "본문 칸은 고르지 않았다");
  const names = bilingualCells(KO, EN, (c) => c.section === "tbody" && c.col === 0);
  assert.ok(names.includes(both("강남구", "Gangnam-gu")) && names.includes("<th scope=\"col\">자치구</th>"));
});

test("두 조각의 칸 수·틀이 다르면 합치지 않고 한국어를 그대로 돌려준다 (엉뚱한 영어를 붙이지 않는다)", () => {
  assert.equal(bilingualCells(KO, EN.replace("<td>Gangnam-gu</td><td>49.1%</td>", "<td>Gangnam-gu</td>")), KO);
  assert.equal(bilingualCells(KO, EN.replace("<thead>", "<tbody>").replace("</thead>", "</tbody>")), KO);
  assert.equal(bilingualCells(KO, null), KO);
  assert.equal(bilingualCells(null, EN), null);
});

test("한국어 보기·영어 보기: 서로 다른 말이 새지 않는다 (중첩 스팬 포함)", () => {
  const out = bilingualCells(KO, EN);
  assert.equal(koOnly(out).replace(/<\/?span[^>]*>/g, ""), KO);
  assert.doesNotMatch(enOnly(out).replace(/<tfoot[\s\S]*<\/tfoot>/, ""), /[가-힣]/);
  const nested = `<td>${both('<span class="low-sample">비움</span>', '<span class="low-sample">blank</span>')}</td>`;
  assert.equal(koOnly(nested), '<td><span class="m-ko"><span class="low-sample">비움</span></span></td>');
  assert.equal(enOnly(nested), '<td><span class="m-en"><span class="low-sample">blank</span></span></td>');
});

test("칸 안 <span> 이 있는 칸도 글자 조각만 갈라 굽는다 (low-sample 은 밖에 남는다)", () => {
  const ko = '<tbody><tr><td><span class="low-sample">비움</span></td></tr></tbody>';
  const en = '<tbody><tr><td><span class="low-sample">blank</span></td></tr></tbody>';
  assert.equal(bilingualCells(ko, en), `<tbody><tr><td><span class="low-sample">${both("비움", "blank")}</span></td></tr></tbody>`);
});

test("cellsOf 는 구·줄·칸 번호를 센다", () => {
  const cells = cellsOf(KO);
  assert.deepEqual(
    cells.map((c) => [c.section, c.row, c.col]),
    [["thead", 0, 0], ["thead", 0, 1], ["tbody", 1, 0], ["tbody", 1, 1], ["tbody", 2, 0], ["tbody", 2, 1], ["tfoot", 3, 0]]
  );
});

test("두 벌 칸이 있어도 표 caption 의 한국어 문안은 한국어 칸만 읽는다 (행 이름이 한·영 이어 붙지 않는다)", () => {
  const body = bilingualCells(KO, EN);
  const html = `<html><head><title>제목</title></head><body><h2>소제목</h2><table class="t" data-caption-en="By district" data-summary="신고가 뒤≥">${body.replace("<tfoot>", "<tbody><tr><td>x</td><td>1</td></tr></tbody><tfoot>")}</table></body></html>`;
  const out = accessibleTables(html);
  const cap = /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(out)[1];
  const [, ko, en] = /^<span class="m-ko">([\s\S]*?)<\/span><span class="m-en">([\s\S]*?)<\/span>$/.exec(cap);
  assert.match(ko, /가장 높은 행 강남구\(49\.1%\)/);
  assert.doesNotMatch(ko, /Gangnam|District|All Seoul/);
  assert.match(en, /Highest row Gangnam-gu \(49\.1%\)/);
  assert.doesNotMatch(en, /[가-힣]/);
});

test("districtNameEn: 슬러그에서 만든 로마자 — 25개 구 모두 -gu 로 끝나고 한글이 없다", () => {
  assert.equal(districtNameEn("강남구"), "Gangnam-gu");
  assert.equal(districtNameEn("중구"), "Jung-gu");
  assert.equal(districtNameEn("영등포구"), "Yeongdeungpo-gu");
  assert.equal(districtNameEn("없는구"), "없는구", "목록에 없는 이름은 그대로");
  for (const name of Object.keys(DISTRICT_SLUGS)) assert.match(districtNameEn(name), /^[A-Z][a-z]+-gu$/);
});

test("입주 예정 구×반기 표의 영어 조각에는 자치구 행 이름·달 미정 구 목록에 한글이 없다", () => {
  const data = {
    halves: ["2026H2", "2027H1"],
    rows: [
      { name: "종로구", units: [0, 0], rental: [0, 0] },
      { name: "성동구", units: [100, 0], rental: [10, 0] },
    ],
    undated: { units: 5, rentalUnits: 0, districts: ["중구", "마포구"] },
  };
  const en = moveInDistrictTableHtml(data, "2026-06-30", "en");
  const ko = moveInDistrictTableHtml(data, "2026-06-30", "ko");
  assert.match(en, /<th scope="row">Jongno-gu<\/th>/);
  assert.match(en, /<th scope="row">Seongdong-gu<\/th>/);
  assert.match(en, /\(Jung-gu, Mapo-gu\)/);
  assert.doesNotMatch(en, /[가-힣]/);
  assert.match(ko, /<th scope="row">종로구<\/th>/, "한국어 쪽은 그대로");
  assert.match(ko, /중구·마포구/);
});
