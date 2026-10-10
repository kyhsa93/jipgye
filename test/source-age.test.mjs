// source-age: 고정 입력과 고정 '오늘'로만 돈다. 실제 docs/data 나 시계를 읽지 않는다(#8 교훈).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, summarize, kstDayNumber } from "../scripts/source-age.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "source-age-"));
  const data = join(root, "data");
  const raw = join(root, "raw");
  mkdirSync(data);
  mkdirSync(join(raw, "sale"), { recursive: true });
  const put = (p, o) => writeFileSync(p, JSON.stringify(o));
  // #97: 해제 통계가 2026-10-08 에 멈췄다. 나머지는 하루 전 밤(UTC) = KST 오늘 새벽 갱신.
  put(join(data, "cancellation.json"), { updatedAt: "2026-10-08T05:00:00Z" }); // KST 10-08 낮에 멈춤
  put(join(data, "news.json"), { updatedAt: "2026-10-09T17:27:08.356Z" });
  put(join(data, "rates-history.json"), { series: [] }); // updatedAt 없음 -> 소스 아님
  for (const [g, d] of [["mapo", "2026-10-09T17:00:00Z"], ["gangnam", "2026-10-05T17:00:00Z"], ["jung", "2026-10-09T17:00:00Z"], ["nowon", "2026-10-09T17:00:00Z"], ["guro", "2026-10-09T17:00:00Z"]])
    put(join(data, `deals-${g}.json`), { updatedAt: d });
  put(join(raw, "sale", "11110-202609.json"), { observedAt: "2026-09-01T00:00:00Z" });
  put(join(raw, "sale", "11110-202610.json"), { observedAt: "2026-10-09T02:55:47.863Z" });
  put(join(raw, "sale", "11200-202610.json"), { observedAt: "2026-10-08T02:55:47.863Z" });
  return { root, data, raw };
}

test("KST 날짜 경계: UTC 15:00 이후는 KST 다음 날", () => {
  assert.equal(kstDayNumber("2026-10-08T14:59:59Z") + 1, kstDayNumber("2026-10-08T15:00:00Z"));
});

test("#97 사고: updatedAt 2026-10-08 정지가 2026-10-10 에 경과 2일로 잡힌다", () => {
  const { root, data, raw } = fixture();
  try {
    const ages = collect({ today: "2026-10-10", dataDir: data, rawDir: raw });
    assert.equal(ages.find((a) => a.name === "cancellation").ageDays, 2);
    // 다른 소스가 더 오래 묵지 않게 구 묶음을 새것으로 바꾸면 해제 통계가 맨 위에 요약된다.
    writeFileSync(join(data, "deals-gangnam.json"), JSON.stringify({ updatedAt: "2026-10-09T17:00:00Z" }));
    const again = collect({ today: "2026-10-10", dataDir: data, rawDir: raw });
    assert.equal(again[0].name, "cancellation");
    assert.equal(again[0].ageDays, 2);
    assert.match(summarize(again), /^경과 최대 2일: cancellation\.json$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("구 묶음은 한 소스, 가장 오래된 값; updatedAt 없는 파일은 제외; raw 는 최근 달 최신 observedAt", () => {
  const { root, data, raw } = fixture();
  try {
    const ages = collect({ today: "2026-10-10", dataDir: data, rawDir: raw });
    const deals = ages.filter((a) => a.name === "deals");
    assert.equal(deals.length, 1);
    assert.equal(deals[0].file, "deals-gangnam.json");
    assert.equal(deals[0].ageDays, 4);
    assert.equal(ages.some((a) => a.name.startsWith("rates")), false);
    const sale = ages.find((a) => a.name === "raw/sale");
    assert.equal(sale.file, "raw/sale/11110-202610.json");
    assert.equal(sale.ageDays, 1);
    assert.deepEqual(ages.map((a) => a.ageDays), [...ages.map((a) => a.ageDays)].sort((a, b) => b - a));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("경과 1일은 정상, 상태줄 문턱(2일) 미만이면 이상 없음", () => {
  assert.equal(summarize([{ ageDays: 1, file: "a.json" }]), "경과 최대 1일 - 이상 없음");
});

test("#133: 주택 인허가 접기(월 1회 수집)가 소스로 잡히고, 월 단위 문턱 전에는 상태줄에 안 나온다", () => {
  const { root, data, raw } = fixture();
  const housing = join(root, "housing");
  mkdirSync(housing);
  try {
    writeFileSync(join(housing, "folded.json"), JSON.stringify({ meta: { updatedAt: "2026-09-20T03:00:00Z" } }));
    const ages = collect({ today: "2026-10-10", dataDir: data, rawDir: raw, housingDir: housing });
    const h = ages.find((a) => a.name === "housing-permits");
    assert.equal(h.ageDays, 20);
    assert.equal(h.file, "research/housing-permits/folded.json");
    // 20일 묵은 월 단위 소스는 이상이 아니다. 하루 단위 소스 기준으로 보면 최대 경과가 되지만 요약은 이를 세지 않는다.
    assert.doesNotMatch(summarize(ages), /housing-permits/);
    writeFileSync(join(housing, "folded.json"), JSON.stringify({ meta: { updatedAt: "2026-08-01T03:00:00Z" } }));
    const old = collect({ today: "2026-10-10", dataDir: data, rawDir: raw, housingDir: housing });
    assert.match(summarize(old), /housing-permits|research\/housing-permits\/folded\.json/);
    // 파일이 없거나 updatedAt이 없으면 소스가 아니다(첫 수집 전)
    rmSync(join(housing, "folded.json"));
    assert.equal(collect({ today: "2026-10-10", dataDir: data, rawDir: raw, housingDir: housing }).some((a) => a.name === "housing-permits"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
