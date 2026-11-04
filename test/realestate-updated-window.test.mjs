// #862 조건 1 대조에서 걸린 것 - 구 장의 값은 4주(districtFrom~to)를 세는데 머리 기준 줄은 서울 1주(from~to)를 적고 있었다.
import test from "node:test";
import assert from "node:assert/strict";
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
