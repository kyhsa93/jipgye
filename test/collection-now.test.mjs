import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { collectionNow } from "../scripts/collection-now.ts";

// #261: 수집 스크립트(fetch-realestate·build-realestate = REALESTATE_NOW; RATES_NOW 는 지운 fetch-rates(#577 C)의 이름이지만 함수 시험의 이름 인자로만 남는다)의 시각을 시험이 고정하는 자리.
// 고정 값만 쓴다 — 오늘 날짜에 기대지 않는다. 엄격도는 SUMMARY_NOW(summaryNow)와 같다: 시간대를 가진 ISO 8601만 받는다.

const root = path.resolve(import.meta.dirname, "..");

test("변수가 없거나 빈 문자열이면 지금(new Date())을 그대로 쓴다 — production 동작 불변", () => {
  // 실제 시각 앞뒤로 끼워 "지금"임을 본다(고정 시각과 비교할 수 없는 자리라 부등식이다).
  for (const env of [{}, { REALESTATE_NOW: "" }, { REALESTATE_NOW: undefined }]) {
    const before = new Date().getTime();
    const got = collectionNow("REALESTATE_NOW", env).getTime();
    const after = new Date().getTime();
    assert.ok(got >= before && got <= after, `지금이 아니다: ${got}`);
  }
});

test("이름이 다른 변수는 읽지 않는다", () => {
  assert.equal(collectionNow("RATES_NOW", { REALESTATE_NOW: "2026-10-31T15:00:00Z" }).toISOString() !== "2026-10-31T15:00:00.000Z", true);
  assert.equal(collectionNow("RATES_NOW", { RATES_NOW: "2026-10-31T15:00:00Z" }).toISOString(), "2026-10-31T15:00:00.000Z");
});

test("시간대를 가진 ISO 8601이면 그 시각이다", () => {
  assert.equal(collectionNow("RATES_NOW", { RATES_NOW: "2026-10-31T14:59:59Z" }).toISOString(), "2026-10-31T14:59:59.000Z");
  assert.equal(collectionNow("RATES_NOW", { RATES_NOW: "2026-10-31T15:00:01.250Z" }).toISOString(), "2026-10-31T15:00:01.250Z");
  assert.equal(collectionNow("RATES_NOW", { RATES_NOW: "2026-11-01T00:00:01+09:00" }).toISOString(), "2026-10-31T15:00:01.000Z");
  assert.equal(collectionNow("RATES_NOW", { RATES_NOW: "2026-10-31T14:59Z" }).toISOString(), "2026-10-31T14:59:00.000Z");
});

test("읽을 수 없는 값은 지금으로 넘기지 않고 변수 이름을 넣어 멈춘다", () => {
  for (const bad of [
    "2026-10-31", // 날짜만
    "2026-10-31T14:59:59", // 시간대 없음
    "어제",
    "2026-02-30T00:00:00Z", // 달력에 없는 날
    "2026-10-31T24:00:00Z", // 24시
    "2026-10-31 14:59:59Z", // T 없음
    " 2026-10-31T14:59:59Z",
  ]) {
    assert.throws(() => collectionNow("REALESTATE_NOW", { REALESTATE_NOW: bad }), /REALESTATE_NOW를 읽을 수 없습니다/, bad);
  }
});

test("production 워크플로는 이 변수를 설정하지 않는다 — 시험이 시각을 고정하려는 자리일 뿐이다", async () => {
  const dir = path.join(root, ".github", "workflows");
  const files = (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length > 0, "워크플로를 하나도 못 읽었다");
  for (const name of files) {
    const text = await readFile(path.join(dir, name), "utf-8");
    for (const variable of ["REALESTATE_NOW", "RATES_NOW"]) {
      assert.ok(!text.includes(variable), `${name} 이 ${variable} 를 설정한다 — 수집이 고정 시각으로 돈다`);
    }
  }
});
