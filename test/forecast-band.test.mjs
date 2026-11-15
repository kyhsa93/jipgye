// 전망 범위를 넓히는 관문(#819 완료 조건 3). 범위는 공식 지수 기준월(origin)로 가른다 - 202609 까지는 옛 범위(가운데 80%),
// 202610 부터 pm 판정 q=0.040 의 4~96번째 백분위다. 실시간 적중(rangeCoverage)은 옛 범위로 계속 재므로 판정 입력 384/596 이 그대로다.
//
// 입력은 판정에 쓴 고정 커밋 063414a0 의 raw/ecos/apt-price-index.json 사본이다(sha256 은 research/forecast-band-2026-11/judge.mjs 의 PIN 과 같다).
// main 의 raw 지수는 매달 바뀌므로 그것을 읽으면 공식 지수 달이 바뀔 때 빨개진다(#8) - 그래서 사본을 둔다.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { BAND, WIDE_BAND, WIDE_FROM, backtest, bandFor, predict, quantile, shiftMonth, toSeries } from "../scripts/outlook.ts";
import { buildPayload } from "../scripts/build-outlook.ts";

const root = path.resolve(import.meta.dirname, "..");
const FIXTURE = path.join(root, "test/fixtures/ecos/apt-price-index-063414a0.json");
const FIXTURE_SHA256 = "805b78b1adbe48fc03a2f2b40f3ed61f9c93a0413867d5e1313628ba068af434";
const index = JSON.parse(readFileSync(FIXTURE, "utf8"));

/** 값은 그대로 두고 달 이름만 delta 달 민다 - 같은 오차·같은 예측에서 시점만 바뀐다. */
const shifted = (delta) => ({
  ...index,
  series: Object.fromEntries(
    Object.entries(index.series).map(([code, rows]) => [code, rows.map(([month, value]) => [shiftMonth(month, delta), value])])
  ),
});

// 같은 빌드(buildPayload)를 시점만 다르게 두 번 돈다. 고정 입력의 마지막 달은 202608 이다.
const build = (data) =>
  buildPayload({ index: data, deals: [], months: [], now: new Date("2026-11-15T00:00:00Z"), log: null }).payload;
const at = {
  "202609": build(shifted(1)),
  "202610": build(shifted(2)),
};

const round2 = (value) => Math.round(value * 100) / 100;

/** 같은 계열·같은 시점에서 band 로 만든 3개월 범위를 따로 계산한다. */
function expectedRange(data, code, band) {
  const series = toSeries(data.series[code]);
  const errors = backtest(series, 3).map((row) => row.model).sort((a, b) => a - b);
  const point = predict(series.logs, series.logs.length - 1, 3).model * 100;
  return { low: round2(point + quantile(errors, band[0])), high: round2(point + quantile(errors, band[1])) };
}

test("고정 입력 사본은 판정에 쓴 커밋 063414a0 의 지수와 바이트가 같다", () => {
  assert.equal(createHash("sha256").update(readFileSync(FIXTURE)).digest("hex"), FIXTURE_SHA256);
});

test("범위 관문: 202609 이하는 [0.1, 0.9], 202610 부터 [0.04, 0.96] (#819 조건 3)", () => {
  assert.deepEqual(BAND, [0.1, 0.9]);
  assert.deepEqual(WIDE_BAND, [0.04, 0.96]);
  assert.equal(WIDE_FROM, "202610");
  for (const origin of ["202607", "202608", "202609"]) assert.equal(bandFor(origin), BAND, origin);
  for (const origin of ["202610", "202611", "202701"]) assert.equal(bandFor(origin), WIDE_BAND, origin);
});

test("(i) 같은 빌드에서 202609 시점은 옛 범위, 202610 시점은 넓힌 범위로 나온다", () => {
  for (const [origin, band, data] of [
    ["202609", BAND, shifted(1)],
    ["202610", WIDE_BAND, shifted(2)],
  ]) {
    const payload = at[origin];
    assert.equal(payload.lastOfficial, origin);
    const published = payload.regions.filter((r) => r.cards.find((c) => c.h === 3)?.forecast);
    assert.ok(published.length >= 4, `${origin}: 3개월 값을 낸 권역이 ${published.length}곳`);
    for (const region of published) {
      const { forecast } = region.cards.find((c) => c.h === 3);
      assert.deepEqual({ low: forecast.low, high: forecast.high }, expectedRange(data, region.code, band), `${origin} ${region.code}`);
    }
  }
  // 값이 같고 시점만 다르므로 넓힌 쪽이 옛 쪽을 감싼다.
  const old = at["202609"].regions.find((r) => r.code === "200").cards.find((c) => c.h === 3).forecast;
  const wide = at["202610"].regions.find((r) => r.code === "200").cards.find((c) => c.h === 3).forecast;
  assert.equal(wide.change, old.change);
  assert.ok(wide.low < old.low && wide.high > old.high, JSON.stringify({ old, wide }));
});

test("(ii) 고정 입력에서 rangeCoverage 는 옛 범위 그대로 384/596 이다", () => {
  const coverage = build(index).rangeCoverage;
  assert.deepEqual(coverage.regions, ["200", "240", "250", "230"]);
  assert.equal(coverage.from, "201401");
  assert.equal(coverage.to, "202605");
  assert.equal(coverage.inside, 384);
  assert.equal(coverage.origins, 596);
});

test("(iii) 202610 문장에는 「가운데 80%」/\"middle 80%\" 가 0건, 202609 문장에는 남아 있다", () => {
  const old = at["202609"].lead;
  const wide = at["202610"].lead;
  assert.match(old.ko, /지난 예측 오차의 가운데 80%를 얹으면/);
  assert.match(old.en, /with the middle 80% of past errors putting it between/);
  assert.doesNotMatch(wide.ko, /가운데 80/);
  assert.doesNotMatch(wide.en, /middle 80/);
  assert.match(wide.ko, /지난 예측 오차의 4~96번째 백분위를 얹으면/);
  assert.match(wide.en, /with the 4th–96th percentile of past errors putting it between/);
  assert.equal((wide.en.match(/[가-힣]/g) ?? []).length, 0);
});

// PREREG 7절: 넓힌 범위의 적중(482/596)은 같은 역사에서 고른 값이다. 앞날의 적중처럼 읽히는 표현을 막는다.
const FORBIDDEN = [
  /앞으로\s*80\s*%/,
  /80\s*%\s*확률/,
  /확률\s*80\s*%/,
  /10\s*번\s*중\s*8\s*번/,
  /열\s*번\s*중\s*여덟\s*번/,
  /will\s+contain\s+80\s*%/i,
  /80\s*%\s+(chance|probability)/i,
  /(chance|probability)\s+of\s+80\s*%/i,
];

/** docs/ 의 손으로 쓰는 틀·자산 + 전망 문장을 담은 outlook.json, 그리고 scripts/outlook.ts. */
function scanned() {
  const files = [path.join(root, "scripts/outlook.ts"), path.join(root, "docs/data/outlook.json")];
  // docs/data 의 나머지는 뉴스·수집 결과라 기사 문장이 섞인다 - 그 값에 따라 빨개지는 검사는 넣지 않는다(#8).
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (file === path.join(root, "docs/data")) continue;
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(html|js|css|txt|webmanifest|json)$/.test(name)) files.push(file);
    }
  };
  walk(path.join(root, "docs"));
  return files;
}

test("(iv) 미래 적중 표현(「앞으로 80%」「80% 확률」「10번 중 8번」\"will contain 80%\" 등)이 docs/·scripts/outlook.ts 에 0건", () => {
  const files = scanned();
  assert.ok(files.some((f) => f.endsWith("price-outlook.html")) && files.some((f) => f.endsWith("method.html")));
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // outlook.json 이 아직 없는 새 클론
    }
    text.split("\n").forEach((line, i) => {
      for (const re of FORBIDDEN) if (re.test(line)) hits.push(`${path.relative(root, file)}:${i + 1} ${re}`);
    });
  }
  assert.deepEqual(hits, []);
  // 같은 검사가 실제로 잡는지(낙제 시험).
  assert.ok(FORBIDDEN.some((re) => re.test("앞으로 80% 확률로 이 안에 듭니다")));
  assert.ok(FORBIDDEN.some((re) => re.test("The range will contain 80% of outcomes")));
});
