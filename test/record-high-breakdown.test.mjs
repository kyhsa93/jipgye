// 신고가 다음 거래 - 자치구·가격대별 행(N3). 신고가의 뜻(선행 3건·180일·90일)은 서울 전체와 같고 행만 나눈다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BANDS } from "../scripts/cancel-by-price.ts";
import { buildPayload } from "../scripts/build-record-high.ts";
import { MIN_ROW, breakdown, breakdownNote, breakdownTableHtml, byCell, measure } from "../scripts/record-high.ts";

const root = path.resolve(import.meta.dirname, "..");
const DAY = 86400000;
const t0 = Date.UTC(2025, 0, 1);
const END = t0 + 1000 * DAY;
const deal = (cell, day, amount) => ({ cell, time: t0 + day * DAY, amount, floor: 5 });

/** 구 code 에 신고가 n건(값 base*1.2), 그중 up 비율은 다음 거래가 신고가 이상. 아무 거래 대조군도 n칸. */
function district(code, n, up, base = 100_000) {
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const c = `${code}|r${i}|84`;
    list.push(deal(c, 0, base), deal(c, 100, base), deal(c, 200, base), deal(c, 300, base * 1.2));
    list.push(deal(c, 310, i < n * up ? base * 1.25 : base * 1.1));
    const o = `${code}|o${i}|84`;
    list.push(deal(o, 0, base), deal(o, 100, base), deal(o, 200, base), deal(o, 300, base * 0.99), deal(o, 310, base));
  }
  return list;
}

const DISTRICTS = [
  { code: "11680", ko: "강남구", en: "Gangnam-gu" },
  { code: "11110", ko: "종로구", en: "Jongno-gu" },
  { code: "11740", ko: "강동구", en: "Gangdong-gu" },
];

test("자치구 행은 그 구의 칸만 센다 - 비율·n, 구 목록 밖 코드는 서울 행에만", () => {
  const cells = byCell([...district("11680", 120, 0.25), ...district("11110", 150, 0.5), ...district("99999", 30, 1)]);
  const split = breakdown(cells, END, { districts: DISTRICTS, bands: BANDS });
  const by = Object.fromEntries(split.districts.map((r) => [r.key, r]));
  assert.deepEqual(
    split.districts.map((r) => r.ko),
    ["강남구", "강동구", "종로구"],
    "가나다순이 아니다"
  );
  assert.equal(by["11680"].withNext, 120);
  assert.equal(by["11680"].record, 25);
  assert.equal(by["11680"].all, 62.5); // 신고가 뒤 120건 중 30건 + 대조군 120건 전부 ≥ → 150/240
  assert.equal(by["11110"].record, 50);
  assert.equal(by["11740"].withNext, 0);
  const main = measure(cells, END);
  assert.equal(main.withNext, 300);
  assert.equal(by["11680"].withNext + by["11110"].withNext, 270, "구 목록 밖 30건은 구 행에 없다");
});

test("행 문턱 미달이면 비율을 비우고 n 만 남긴다", () => {
  const cells = byCell([...district("11680", MIN_ROW, 0.3), ...district("11110", MIN_ROW - 1, 0.3)]);
  const split = breakdown(cells, END, { districts: DISTRICTS, bands: BANDS });
  const by = Object.fromEntries(split.districts.map((r) => [r.key, r]));
  assert.equal(split.minWithNext, 100);
  assert.equal(by["11680"].enough, true);
  assert.equal(by["11680"].record, 30);
  assert.equal(by["11110"].enough, false);
  assert.equal(by["11110"].record, null);
  assert.equal(by["11110"].all, null);
  assert.equal(by["11110"].withNext, MIN_ROW - 1);
});

test("가격대는 세는 거래의 값으로 가르고, 그 전 최고가는 칸 전체에서 찾는다", () => {
  // 선행 3건은 9억~15억(10억), 신고가는 15억~25억(16억). 신고가는 15억~25억 행에 들어가고, 선행 거래가 다른 대라도 신고가다.
  const list = [];
  for (let i = 0; i < 110; i += 1) {
    const c = `11680|b${i}|84`;
    list.push(deal(c, 0, 100_000), deal(c, 100, 100_000), deal(c, 200, 100_000), deal(c, 300, 160_000), deal(c, 310, i < 55 ? 170_000 : 150_000));
  }
  const cells = byCell(list);
  const split = breakdown(cells, END, { districts: DISTRICTS, bands: BANDS });
  const by = Object.fromEntries(split.bands.map((r) => [r.key, r]));
  assert.deepEqual(split.bands.map((r) => r.key), ["upTo6", "upTo9", "upTo15", "upTo25", "over25"]);
  assert.equal(by.upTo25.withNext, 110);
  assert.equal(by.upTo25.record, 50);
  assert.equal(by.upTo15.withNext, 0, "선행 거래만 있던 대에 신고가가 생겼다");
  const main = measure(cells, END);
  assert.equal(split.bands.reduce((s, r) => s + r.withNext, 0), main.withNext, "가격대 행을 더하면 서울과 같아야 한다");
});

test("서울 수치는 그대로다 - pick 없는 measure 와 buildPayload 의 main·robust·문장", () => {
  const cells = byCell([...district("11680", 120, 0.25), ...district("11110", 150, 0.5)]);
  assert.deepEqual(measure(cells, END, { pick: null }), measure(cells, END));
  assert.deepEqual(measure(cells, END, { pick: () => true }), measure(cells, END));

  const toItem = (d) => {
    const [sggCd, aptNm, excluUseAr] = d.cell.split("|");
    const at = new Date(d.time);
    return {
      sggCd, aptNm, excluUseAr, dealingGbn: "중개거래", cdealType: "", floor: "5",
      dealAmount: d.amount.toLocaleString("en-US"),
      dealYear: at.getUTCFullYear(), dealMonth: at.getUTCMonth() + 1, dealDay: at.getUTCDate(),
    };
  };
  const items = [...district("11680", 120, 0.25), ...district("11110", 150, 0.5)].map(toItem);
  items.push(toItem(deal("11680|end|84", 1000, 100_000)));
  const payload = buildPayload({ items, now: new Date("2026-10-25T00:00:00Z") });
  assert.deepEqual(Object.keys(payload), ["updatedAt", "end", "deals", "main", "robust", "lead", "control", "survival", "breakdownNote", "tables", "breakdown"]);
  assert.deepEqual(payload.main, measure(byCell(items.map((i) => ({ cell: `${i.sggCd}|${i.aptNm}|${i.excluUseAr}`, time: Date.UTC(i.dealYear, i.dealMonth - 1, i.dealDay), amount: Number(i.dealAmount.replace(/,/g, "")), floor: 5 }))), END));
  assert.equal(payload.main.withNext, 270);
  assert.equal(payload.breakdown.districts.length, 25);
  const gangnam = payload.breakdown.districts.find((r) => r.ko === "강남구");
  assert.equal(gangnam.en, "Gangnam-gu");
  assert.equal(gangnam.record, 25);
  assert.equal(payload.breakdown.districts.find((r) => r.key === "11140").en, "Jung-gu");
});

test("표 글자는 두 언어로 - 서울 대조 행이 맨 위, 미달 행은 「표본 부족(n=…)」", () => {
  const cells = byCell([...district("11680", 1200, 0.25), ...district("11110", 12, 0.5)]);
  const main = measure(cells, END);
  const split = breakdown(cells, END, { districts: DISTRICTS, bands: BANDS });
  const ko = breakdownTableHtml(split.districts, main, "district", "ko");
  const en = breakdownTableHtml(split.districts, main, "district", "en");
  assert.match(ko, /<th scope="col">자치구<\/th><th scope="col">신고가 뒤 ≥<\/th>/);
  assert.match(ko, /<tbody><tr><td><strong>서울 전체<\/strong><\/td>/);
  assert.match(ko, /<td>강남구<\/td><td>25%<\/td><td>62.5%<\/td><td>1,200<\/td>/);
  assert.match(ko, /<td>종로구<\/td><td>-<\/td><td>-<\/td><td><span class="low-sample">표본 부족\(n=12\)<\/span><\/td>/);
  assert.match(en, /<th scope="col">District<\/th>/);
  assert.match(en, /<tbody><tr><td><strong>All Seoul<\/strong><\/td>/);
  assert.match(en, /<td>Jongno-gu<\/td><td>-<\/td><td>-<\/td><td><span class="low-sample">too few \(n=12\)<\/span><\/td>/);
  assert.match(breakdownTableHtml(split.bands, main, "band", "ko"), /<th scope="col">가격대<\/th>.*<td>9억~15억<\/td>/);
  assert.match(breakdownTableHtml(split.bands, main, "band", "en"), /<th scope="col">Price band<\/th>.*<td>₩0\.9–1\.5B<\/td>/);
  assert.match(breakdownNote(split, "ko"), /100건 미만인 행은 비율을 비웁니다/);
  assert.match(breakdownNote(split, "en"), /fewer than 100 record highs/);
  assert.equal(breakdownTableHtml([], main, "district", "ko"), null);
});

test("record-high.html 이 자치구·가격대별 절을 굽고 두 언어 제목을 갖는다", async () => {
  const html = await readFile(path.join(root, "docs/record-high.html"), "utf8");
  for (const name of ["recordDistricts", "recordBands", "recordBreakdownNote"]) {
    assert.ok(html.includes(`<!--prerender:${name}-->`) && html.includes(`<!--/prerender:${name}-->`), `${name} 자리가 없다`);
  }
  assert.match(html, /<h2 id="breakdown-heading">자치구·가격대별<\/h2>/);
  assert.match(html, /breakdownHeading: "자치구·가격대별"/);
  assert.match(html, /breakdownHeading: "By district and price band"/);
  assert.match(html, /\["district-table", "districts"\], \["band-table", "bands"\]/);
});
