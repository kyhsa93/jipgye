import test from "node:test";
import assert from "node:assert/strict";
import { basisFrom, detailKeyFrom, fetchMoveIn } from "../scripts/fetch-move-in.ts";
import { halfOf, moveInLead, moveInTableHtml, parseCsv, summarize } from "../scripts/move-in.ts";
import { districtByHalf, moveInDistrictTableHtml, moveInDistrictsText } from "../scripts/move-in.ts";
import { buildPayload, stringify } from "../scripts/build-move-in.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { moveInSourceLine } from "../scripts/source-lines.ts";

const CSV = [
  "입주예정월,지역,사업유형,주소,아파트명,세대수",
  '2026-08,서울,분양,서울특별시 서초구 반포동 1-1,"가 단지 (1,2단지)",2000',
  "2026-10,서울,분양임대,서울특별시 서초구 방배동 2-2,나 단지,3000",
  "2027-03,서울,임대,서울특별시 중랑구 묵동 165,다(청년안심주택),900",
  "2027-00,서울,분양,서울특별시 강서구 화곡동 3,라 단지,300",
  "2027-01,경기,분양,경기도 안양시 동안구 비산동 354-10,마 단지,5000",
].join("\n");

test("따옴표 안 쉼표를 견디고 서울만 센다", () => {
  const rows = parseCsv(`﻿${CSV}`);
  assert.equal(rows[0]["아파트명"], "가 단지 (1,2단지)");
  assert.equal(rows[0]["세대수"], "2000", "따옴표 안 쉼표에서 칸이 밀렸다");
  const s = summarize(rows);
  assert.equal(s.complexes, 4);
  assert.equal(s.units, 6200);
  assert.equal(s.from, "2026-08");
  assert.equal(s.to, "2027-03", "달 미정(00)을 기간 끝으로 썼다");
  assert.deepEqual(s.districts.map((d) => d.name), ["서초구", "중랑구", "강서구"]);
});

test("반기로 묶고, 달 미정은 그해 끝에 둔다", () => {
  assert.equal(halfOf("2026-06"), "2026H1");
  assert.equal(halfOf("2026-07"), "2026H2");
  assert.equal(halfOf("2027-00"), "2027?");
  const s = summarize(parseCsv(CSV));
  assert.deepEqual(s.halves.map((h) => h.half), ["2026H2", "2027H1", "2027?"]);
});

test("'분양임대'는 임대 단지가 아니다 - 순수 임대만 떼어 적는다", () => {
  const s = summarize(parseCsv(CSV));
  const ko = moveInLead(s, "2026-06-30", "ko");
  assert.match(ko, /순수 임대\(청년안심주택 등\)가 1개 단지 900세대이고, 나머지 3개 단지 5,300세대는 분양 단지입니다/);
  assert.match(ko, /2026년 6월 30일 기준/);
  assert.match(ko, /검증하지 않았습니다/, "입주가 값을 움직인다는 해석을 검증 없이 붙였다");
  assert.doesNotMatch(moveInLead(s, "2026-06-30", "en"), /[가-힣]/);
  const table = moveInTableHtml(s, "ko");
  assert.match(table, /<td>2026년 하반기<\/td><td data-label="단지">2<\/td><td data-label="세대">5,000<\/td><td data-label="그중 순수 임대">0<\/td>/);
});

test("데이터 화면에서 상세 키를, 파일 이름에서 기준일을 읽는다", () => {
  assert.equal(detailKeyFrom(`onclick="fn_fileDataDown('15111714', 'uddi:0b257760-ac19-4841-adb4-b38b4d153397', '','1', '17')"`), "uddi:0b257760-ac19-4841-adb4-b38b4d153397");
  assert.equal(detailKeyFrom("<html></html>"), null);
  assert.equal(basisFrom("한국부동산원_주택공급정보_입주예정물량정보_20260630"), "2026-06-30");
});

test("받은 파일이 입주예정물량 CSV가 아니면 실패로 넘긴다(어제 파일 유지)", async () => {
  const fake = (csv) => async (url) => {
    if (String(url).includes("fileData.do")) return { ok: true, text: async () => "fn_fileDataDown('15111714', 'uddi:aa-bb'" };
    if (String(url).includes("selectFileDataDownload")) return { ok: true, text: async () => JSON.stringify({ status: true, atchFileId: "F1", fileDetailSn: 1, dataSetFileDetailInfo: { dataNm: "x_20260630" } }) };
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(csv).buffer };
  };
  const ok = await fetchMoveIn({ fetchImpl: fake(`﻿${CSV}`) });
  assert.equal(ok.meta.basis, "2026-06-30");
  assert.ok(ok.csv.startsWith("입주예정월,"), "BOM을 안 뗐다");
  await assert.rejects(fetchMoveIn({ fetchImpl: fake("JFIF....") }), /CSV 머리/);
});

// ── 구×반기 표 (#677) ──
const HANGUL = /[가-힣]/;
const CAUSAL = /입주[^.]{0,12}(많|몰리|늘)[^.]{0,12}(내린|내려|떨어|하락|오른|올라|상승)|전세[^.]{0,8}(내린다|내려간다|떨어진다|오른다)|supply[^.]{0,20}(lower|push|drive)/i;

test("구×반기 집계: 25구가 모두 나오고, 달 미정은 칸 밖에서 따로 센다", () => {
  const d = districtByHalf(parseCsv(CSV));
  assert.deepEqual(d.rows.map((r) => r.name), DISTRICTS.map((x) => x.name), "25구가 구 코드 순으로 모두 있어야 한다");
  assert.equal(d.rows.length, 25);
  assert.deepEqual(d.halves, ["2026H2", "2027H1"], "달 미정(2027?)을 반기 칸으로 세었다");
  const by = Object.fromEntries(d.rows.map((r) => [r.name, r]));
  assert.deepEqual([by["서초구"].units, by["서초구"].rental], [[5000, 0], [0, 0]], "분양 2000 + 분양임대 3000 이 같은 칸에 더해진다");
  assert.deepEqual([by["중랑구"].units, by["중랑구"].rental], [[0, 900], [0, 900]], "순수 임대만 rental");
  assert.deepEqual(by["종로구"].units, [0, 0], "예정이 없는 구도 줄이 있다");
  assert.deepEqual(d.undated, { units: 300, rentalUnits: 0, districts: ["강서구"] });
  const cellSum = d.rows.flatMap((r) => r.units).reduce((a, b) => a + b, 0);
  assert.equal(cellSum + d.undated.units, summarize(parseCsv(CSV)).units, "칸 합 + 달 미정 = 서울 합(세대를 버리지 않는다)");
});

test("구×반기 집계: 이름 목록에 없는 구는 버리지 않고 뒤에 덧붙인다", () => {
  const d = districtByHalf(parseCsv(CSV), ["서초구"]);
  assert.deepEqual(d.rows.map((r) => r.name), ["서초구", "강서구", "중랑구"]);
});

test("구×반기 표: 칸은 「n세대(임대 m)」 또는 「없음」, 어느 반기에도 없는 구는 「예정 없음」, 기준일·추정치·출처가 꼬리에 있다", () => {
  const d = districtByHalf(parseCsv(CSV));
  const ko = moveInDistrictTableHtml(d, "2026-06-30", "ko");
  assert.equal([...ko.matchAll(/<th scope="row">/g)].length, 25);
  assert.match(ko, /<th scope="row">종로구<\/th><td colspan="2">예정 없음<\/td>/);
  assert.match(ko, /<th scope="row">서초구<\/th><td>5,000세대\(임대 0\)<\/td><td>없음<\/td>/);
  assert.match(ko, /<th scope="row">중랑구<\/th><td>없음<\/td><td>900세대\(임대 900\)<\/td>/);
  assert.doesNotMatch(ko, /<th scope="row">강서구<\/th><td colspan/, "달 미정만 있는 구를 「예정 없음」이라 했다");
  assert.match(ko, /<th scope="col">2026년 하반기<\/th><th scope="col">2027년 상반기<\/th>/);
  const foot = /<tfoot>([\s\S]*)<\/tfoot>/.exec(ko)[1];
  assert.match(foot, /추정치 · 기준일 2026-06-30/);
  assert.match(foot, /실제 입주 아님/, "예정과 실제를 구분해 적는다");
  assert.match(foot, /달 미정 300세대\(강서구\)는 표에 넣지 않았습니다/);
  assert.ok(foot.includes(moveInSourceLine("ko")), "출처 줄은 scripts/source-lines.ts 에서 온다");
  assert.match(foot, /colspan="3"/);
  assert.doesNotMatch(ko, CAUSAL);
  assert.doesNotMatch(ko, /data-label/, "이 표에는 카드 모양이 없다 - 속성만 늘리지 않는다");
});

test("구×반기 표(영어): 한글이 없고(구 이름은 로마자, #708), 같은 표를 영어로 말한다", () => {
  const d = districtByHalf(parseCsv(CSV));
  const en = moveInDistrictTableHtml(d, "2026-06-30", "en");
  assert.doesNotMatch(en, HANGUL);
  assert.match(en, /<th scope="row">Jongno-gu<\/th><td colspan="2">None planned<\/td>/);
  assert.match(en, /<td>5,000 homes \(rental 0\)<\/td><td>None<\/td>/);
  assert.match(en, /Estimate · as of 2026-06-30 · by scheduled move-in month \(not actual move-ins\)/);
  assert.match(en, /Not in the table: 300 homes with no move-in month set \(Gangseo-gu\)/);
  assert.ok(en.includes(moveInSourceLine("en")));
  assert.doesNotMatch(en, CAUSAL);
  assert.equal(moveInDistrictTableHtml(null, "2026-06-30", "ko"), null);
});

test("json: 기존 필드는 그대로이고 byDistrict·districtTable 만 더해지며, 숫자 배열은 한 줄로 접힌다", () => {
  const meta = { name: "x", basis: "2026-06-30" };
  const now = new Date("2026-10-25T00:00:00Z");
  const p = buildPayload({ csv: CSV, meta, now });
  const s = summarize(parseCsv(CSV));
  assert.deepEqual(p.seoul, s);
  assert.deepEqual(p.districts, { ko: moveInDistrictsText(s, "ko"), en: moveInDistrictsText(s, "en") }, "districts 한 줄은 모양 불변");
  assert.deepEqual(p.lead, { ko: moveInLead(s, "2026-06-30", "ko"), en: moveInLead(s, "2026-06-30", "en") });
  assert.equal(p.byDistrict.rows.length, 25);
  assert.deepEqual(Object.keys(p.districtTable), ["ko", "en"]);
  assert.match(p.districtTable.ko, /2026-06-30/);
  const text = stringify(p);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(p)), "접어도 값이 같다");
  assert.match(text, /"halves": \["2026H2", "2027H1"\]/);
  assert.match(text, /"units": \[5000, 0\]/);
});
