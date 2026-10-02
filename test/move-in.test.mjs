import test from "node:test";
import assert from "node:assert/strict";
import { basisFrom, detailKeyFrom, fetchMoveIn } from "../scripts/fetch-move-in.mjs";
import { halfOf, moveInLead, moveInTableHtml, parseCsv, summarize } from "../scripts/move-in.mjs";

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
