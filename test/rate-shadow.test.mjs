import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { scoreShadow, updateShadow } from "../scripts/build-outlook.mjs";
import { priceSeries, shadowForecast } from "../scripts/indicator-backtest.mjs";
import { predict, toSeries } from "../scripts/outlook.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readRaw = (p) => readFile(path.join(root, p), "utf8").then(JSON.parse);

test("그림자의 기준 모델은 화면에 낸 예측과 같은 모델이다", async () => {
  const [index, indicators] = await Promise.all([readRaw("raw/ecos/apt-price-index.json"), readRaw("raw/indicators/series.json")]);
  const shadow = shadowForecast(priceSeries(index.series["200"]), indicators.series);
  const s = toSeries(index.series["200"]);
  const shown = Math.round(predict(s.logs, s.logs.length - 1, 3).model * 10_000) / 100;
  assert.equal(shadow.base, shown, "그림자 기준 모델이 화면 모델과 다르면 둘을 견줄 수 없다");
  assert.ok(Number.isFinite(shadow.with));
});

test("같은 오리진의 그림자 예측은 다음 날 다시 내도 덮지 않는다", () => {
  const first = updateShadow(null, "202607", { base: 2.5, with: 2.0 });
  const again = updateShadow({ shadow: first }, "202607", { base: 9, with: 9 });
  assert.deepEqual(again, first);
  assert.equal(updateShadow({ shadow: first }, "202608", { base: 1, with: 1 }).length, 2);
  assert.deepEqual(updateShadow({ shadow: first }, "202608", null), first, "지표가 없는 날 빈 줄을 쌓았다");
});

test("지수가 나온 것만 두 모델을 나란히 채점한다", () => {
  const shadow = [{ origin: "202607", region: "200", h: 3, target: "202610", base: 2, with: 5 }];
  const months = ["202607", "202608", "202609", "202610"];
  const series = { 200: { months, logs: [0, 0, 0, Math.log(1.05)] } };
  const s = scoreShadow(shadow, series);
  assert.equal(s.scored, 1);
  assert.equal(s.base, 2.88);
  assert.equal(s.with, 0.12);
  assert.equal(scoreShadow(shadow, { 200: { months: months.slice(0, 3), logs: [0, 0, 0] } }).scored, 0);
});
