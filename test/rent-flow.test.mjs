import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { COMPARE_MONTHS, RENT_FLOW_MONTHS, buildRentFlow, rentFlowSentences, spanLabel, versusSeoul } from "../scripts/rent-flow.ts";
import { rentFlowFile, writeRentFlowSoft } from "../scripts/build-renewal-facts.ts";
import { MIN_SAMPLE } from "../scripts/realestate-format.ts";
import { RETENTION_MONTHS } from "../scripts/realestate-slots.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

// 2026-10-26: 9월 계약은 10-31 이 지나야 마감이라 덜 찬 달이 9·10월 둘이다.
const NOW = new Date("2026-10-26T00:00:00Z");
const MONTHS = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 10 + i, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
});

const lease = (extra = {}) => ({ deposit: "50,000", monthlyRent: "0", contractType: "신규", ...extra });
const many = (n, extra) => Array.from({ length: n }, () => lease(extra));
const monthOf = (wolse, jeonse, renewals = []) => [...many(wolse, { monthlyRent: "100", deposit: "5,000" }), ...many(jeonse), ...renewals];

test("V7 상수: 계열 길이는 원본 보관 창과 같고, 화면 창은 석 달이다", () => {
  assert.equal(RENT_FLOW_MONTHS, RETENTION_MONTHS);
  assert.equal(COMPARE_MONTHS, 3);
});

test("buildRentFlow: 마감된 마지막 석 달을 1년 전 같은 석 달과 견주고, 덜 찬 달은 표시만 한다", () => {
  const byMonth = Object.fromEntries(MONTHS.map((m) => [m, monthOf(m >= "202606" ? 10 : 5, 5)]));
  const flow = buildRentFlow({ byDistrict: { 가구: byMonth }, months: MONTHS, now: NOW });
  assert.deepEqual(flow.partial, ["202609", "202610"]);
  assert.deepEqual(flow.compare, { base: ["202506", "202507", "202508"], recent: ["202606", "202607", "202608"] });
  assert.deepEqual(flow.closedSpan, ["202411", "202608"]);
  const d = flow.districts["가구"];
  assert.equal(d.series.length, 24);
  assert.deepEqual(d.series[0], { n: 10, w: 50, jn: 5, jmed: 50000 });
  assert.deepEqual(d.compare.base, { n: 30, wolseShare: 50, jn: 15, jmed: 50000, fromJeonse: 0, toWolseShare: null });
  assert.equal(d.compare.recent.wolseShare, 66.7);
  // 서울 값은 구를 모두 합쳐 다시 센다(구 값의 평균이 아니다)
  assert.equal(flow.seoul.compare.recent.n, 45);
  // 건별 행은 싣지 않는다 - 계열 칸은 집계 넷뿐이다
  assert.deepEqual(Object.keys(d.series[5]).sort(), ["jmed", "jn", "n", "w"]);
});

test("buildRentFlow: 값은 hasEnoughSample 문턱 아래면 null, 건수는 그대로 남긴다", () => {
  const thin = MIN_SAMPLE - 1;
  const byMonth = Object.fromEntries(MONTHS.map((m) => [m, monthOf(1, 0)]));
  for (const m of ["202606", "202607", "202608"]) byMonth[m] = [];
  byMonth["202606"] = many(thin);
  const flow = buildRentFlow({ byDistrict: { 가구: byMonth }, months: MONTHS, now: NOW });
  const r = flow.districts["가구"].compare.recent;
  assert.equal(r.n, thin);
  assert.equal(r.wolseShare, null);
  assert.equal(r.jmed, null);
  assert.equal(r.jn, thin);
  assert.equal(flow.districts["가구"].series[0].w, null, "한 건짜리 달은 비중을 내지 않는다");
});

test("buildRentFlow: 갱신 전환율은 renewal-facts 의 classify 로 센다(전세→월세 / 전세였던 갱신)", () => {
  const renew = (rent) => lease({ contractType: "갱신", preDeposit: "50,000", preMonthlyRent: "0", monthlyRent: rent });
  const byMonth = Object.fromEntries(MONTHS.map((m) => [m, monthOf(0, 0, [renew("0"), renew("0"), renew("0"), renew("50")])]));
  const flow = buildRentFlow({ byDistrict: { 가구: byMonth }, months: MONTHS, now: NOW });
  // 마감된 22개월 × 4건 = 88건, 그중 1/4 이 월세를 끼었다
  assert.deepEqual(flow.districts["가구"].renewals, { fromJeonse: 88, toWolseShare: 25 });
});

test("buildRentFlow: 견줄 달의 파일이 없으면(null) 그 창은 0건이 아니라 모름(null)이다", () => {
  const byMonth = Object.fromEntries(MONTHS.map((m) => [m, monthOf(5, 5)]));
  byMonth["202507"] = null;
  const flow = buildRentFlow({ byDistrict: { 가구: byMonth }, months: MONTHS, now: NOW });
  assert.equal(flow.districts["가구"].compare.base, null);
  assert.equal(flow.seoul.compare.base, null);
  assert.equal(flow.districts["가구"].series[MONTHS.indexOf("202507")], null);
  assert.deepEqual(rentFlowSentences("가구", flow, "ko"), []);
});

test("versusSeoul: 서울과의 차이가 표본 오차(2배) 안이면 비슷하다고만 한다 - 얇은 구는 같은 차이라도 비슷함이다", () => {
  const seoul = { base: { n: 60000, wolseShare: 44 }, recent: { n: 50000, wolseShare: 52 } };
  const big = (a, b) => versusSeoul({ n: 5000, wolseShare: a }, { n: 5000, wolseShare: b }, seoul);
  const thin = (a, b) => versusSeoul({ n: 60, wolseShare: a }, { n: 60, wolseShare: b }, seoul);
  assert.equal(big(40, 60).kind, "more");
  assert.equal(thin(40, 60).kind, "similar");
  assert.equal(big(40, 41).kind, "less");
  assert.equal(big(50, 45).kind, "opposite");
  assert.equal(big(40, 48.3).kind, "similar");
  assert.equal(versusSeoul({ n: 10, wolseShare: 1 }, { n: 10, wolseShare: 2 }, {}), null);
});

test("spanLabel: 해를 넘기는 창은 양쪽 해를 적는다", () => {
  assert.equal(spanLabel("202506", "202508"), "2025년 6~8월");
  assert.equal(spanLabel("202512", "202602"), "2025년 12월~2026년 2월");
  assert.equal(spanLabel("202512", "202602", "en"), "Dec 2025–Feb 2026");
});

test("writeRentFlowSoft: 임시 파일 뒤 이름 바꾸기 - 쓰고 나면 폴더에 그 파일 하나뿐이고, 실패하면 이전 파일이 그대로다", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "rent-flow-"));
  try {
    const raw = path.join(tmp, "raw");
    const out = path.join(tmp, "data", "rent-flow.json");
    // 원본이 하나도 없어도 산출물은 나온다(25구 모두 계열 null)
    assert.equal(await writeRentFlowSoft(NOW, { dir: raw, file: out }), true);
    assert.deepEqual(await readdir(path.dirname(out)), ["rent-flow.json"]);
    const first = JSON.parse(await readFile(out, "utf8"));
    assert.deepEqual(Object.keys(first.districts), DISTRICTS.map((d) => d.name));
    assert.equal(first.months.length, RENT_FLOW_MONTHS);

    // 쓸 수 없는 곳(부모가 파일) → false, 경고만, 던지지 않는다
    const blocker = path.join(tmp, "blocker");
    await writeFile(blocker, "x");
    assert.equal(await writeRentFlowSoft(NOW, { dir: raw, file: path.join(blocker, "rent-flow.json") }), false);

    // 이름 바꾸기 실패(대상이 폴더) → 이전 것 유지, 임시 파일 없음
    const asDir = path.join(tmp, "data2");
    await mkdir(path.join(asDir, "rent-flow.json"), { recursive: true });
    assert.equal(await writeRentFlowSoft(NOW, { dir: raw, file: path.join(asDir, "rent-flow.json") }), false);
    assert.deepEqual(await readdir(asDir), ["rent-flow.json"]);

    // 임시 파일조차 못 쓰는 폴더(읽기 전용) → 이전 파일이 바이트 그대로 남는다
    const ro = path.join(tmp, "ro");
    await mkdir(ro);
    await writeFile(path.join(ro, "rent-flow.json"), "이전");
    await chmod(ro, 0o555);
    try {
      assert.equal(await writeRentFlowSoft(NOW, { dir: raw, file: path.join(ro, "rent-flow.json") }), false);
      assert.equal(await readFile(path.join(ro, "rent-flow.json"), "utf8"), "이전");
      assert.deepEqual(await readdir(ro), ["rent-flow.json"]);
    } finally {
      await chmod(ro, 0o755);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("출력 경로 허용 목록: 기본 경로는 docs/data/rent-flow.json 하나이고, 빌더 소스에 그 밖의 쓰기 경로가 없다", async () => {
  assert.equal(path.relative(root, rentFlowFile), path.join("docs", "data", "rent-flow.json"));
  const src = (await read("scripts/rent-flow.ts")) + (await read("scripts/build-renewal-facts.ts"));
  const paths = [...src.matchAll(/"((?:\.\.\/)?(?:docs|raw|build|research|audit)\/[^"]*)"/g)].map((m) => m[1]);
  for (const p of paths) assert.match(p, /^docs\/data\//, `허용 밖 경로: ${p}`);
});

test("Daily 등록: 새 줄·새 단계 없이 기존 build-renewal-facts(실거래 수집 단계)가 부른다 - 워크플로·update-all 은 V7 이 건드리지 않는다", async () => {
  const [daily, updateAll, builder] = await Promise.all([read(".github/workflows/daily-update.yml"), read("scripts/update-all.mjs"), read("scripts/build-renewal-facts.ts")]);
  assert.doesNotMatch(daily, /rent-flow/);
  assert.doesNotMatch(updateAll, /rent-flow/);
  const step = daily.split("- name: 실거래 수집")[1]?.split("- name:")[0] ?? "";
  assert.ok(step.includes("node scripts/build-renewal-facts.ts"));
  const main = builder.slice(builder.indexOf("async function main()"));
  assert.ok(main.indexOf("writeRentFlowSoft(now)") >= 0, "main 이 월세화 흐름을 부르지 않는다");
  assert.ok(main.indexOf("writeRentFlowSoft(now)") < main.indexOf("if (!payload)"), "재계약 관찰이 비는 날 월세화 흐름이 건너뛰어진다");
  assert.doesNotMatch(await read("scripts/rent-flow.ts"), /fetch\(|https?:\/\//, "월세화 흐름은 네트워크를 쓰지 않는다");
});

test("커밋된 산출물: 25구 모두 문장이 나오고(값 또는 표본 부족), 출처·날짜 라벨·덜 찬 달 표시가 있다", async () => {
  const flow = JSON.parse(await read("docs/data/rent-flow.json"));
  assert.equal(Object.keys(flow.districts).length, 25);
  for (const { name } of DISTRICTS) {
    const ko = rentFlowSentences(name, flow, "ko").join(" ");
    const en = rentFlowSentences(name, flow, "en").join(" ");
    assert.match(ko, /^전월세 흐름\(국토교통부 신고\): /, name);
    assert.match(ko, /\d{4}년 \d+~\d+월|\d{4}년 \d+월~\d{4}년 \d+월/, `${name}: 날짜 라벨이 없다`);
    assert.match(ko, /\d건/, `${name}: 건수가 없다`);
    assert.ok(ko.split(name).length - 1 >= 2, `${name}: 구 이름이 문장에 없다`);
    assert.match(en, /^Rent flow \(MOLIT lease filings\): /, name);
    if (flow.partial.length) assert.match(ko, /덜 찬 달/, name);
  }
});
