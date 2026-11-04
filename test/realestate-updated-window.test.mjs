// #862 조건 1 대조에서 걸린 것 - 구 장의 값은 4주(districtFrom~to)를 세는데 머리 기준 줄은 서울 1주(from~to)를 적고 있었다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

const realestate = {
  updatedAt: "2026-11-04T03:00:00.000Z",
  window: { basis: "arrival", from: "2026-11-02", to: "2026-11-04", until: "2026-11-09", weeks: 1, districtFrom: "2026-10-12", districtWeeks: 4 },
  overall: { sale: { avgPricePerPyeong10k: 5126, transactionCount: 754 } },
  districts: [{ code: "11230", name: "동대문구", sale: { avgPricePerPyeong10k: 4652, transactionCount: 435 } }],
};
const updated = async (opts) => {
  const page = await loadRealestatePage({ realestate, file: "scripts/realestate-template.html", ...opts });
  return String(page.byId("updated").textContent);
};

test("구 장의 머리 기준 줄은 구 창을, 서울 값이 먼저인 장은 서울 창을 적는다 - 국·영", async () => {
  assert.match(await updated({ district: "동대문구" }), /^신고 기준 2026-10-12 ~ 2026-11-04/);
  assert.match(await updated({ district: "동대문구", locale: "en" }), /^Filings 2026-10-12 ~ 2026-11-04/);
  assert.match(await updated({}), /^신고 기준 2026-11-02 ~ 2026-11-04/);
  assert.match(await updated({ kind: "sale" }), /^신고 기준 2026-11-02 ~ 2026-11-04/);
});

test("districtFrom 이 없는 옛 창도 구 장이 그대로 그린다", async () => {
  const { districtFrom: _a, districtWeeks: _b, ...old } = realestate.window;
  const page = await loadRealestatePage({ realestate: { ...realestate, window: old }, district: "동대문구", file: "scripts/realestate-template.html" });
  assert.match(String(page.byId("updated").textContent), /^신고 기준 2026-11-02 ~ 2026-11-04/);
});

// #862 pm 최종 판정: 시세 틀 안내는 기준에 따라 갈리지 않는 말로 쓴다. 계약 기준 날에 「그 주에 신고된」은 틀린 말이고, 기간은 머리 기준 줄이 말한다. 분기 없이 문자열만이다.
test("시세 틀 안내에 「그 주」가 없고 나머지 문장은 그대로다 - 국·영", async () => {
  const html = await readFile(path.resolve(import.meta.dirname, "../scripts/realestate-template.html"), "utf8");
  assert.ok(html.includes("서울 전체는 표시된 기간의 거래로, 자치구는 최근 4주 신고분을 겹쳐 냅니다"));
  assert.ok(html.includes("Seoul-wide figures cover deals in the period shown, while each district averages the last four weeks of filings"));
  assert.ok(!html.includes("서울 전체는 그 주에 신고된 거래로"));
  assert.ok(!html.includes("cover deals filed this week"));
});
