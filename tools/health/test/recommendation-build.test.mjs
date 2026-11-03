// 원본: test/recommendation-build.test.mjs 의 빌더 시험(고정 데이터)과 짝인 실데이터 점검이다(#816 P1-1). 커밋된 데이터를 보는 검사라 값·날짜에 따라 갈린다 - 그래서 여기(비차단)에 둔다.
// 첫 Daily 전에는 파일이 없다 - 파일이 없으면 건너뛴다. 빌더가 멈춘 것은 check-data-progress 의 산출물 나이(30h·54h)가 잡고, 이 시험은 입력이 멈춘 것(구별 도착일)과 한도 근접을 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { APARTMENT_FIELDS, LIMITS, TYPES } from "../../../scripts/recommendation.ts";

const dataDir = path.resolve(import.meta.dirname, "../../../docs/data");
const names = readdirSync(dataDir).filter((f) => /^reco-[a-z]+\.json$/.test(f));
const skip = names.length ? false : "첫 Daily 전: reco-*.json 없음";
const read = (name) => readFileSync(path.join(dataDir, name), "utf8");

/** 도착일 문턱(일). 지난 30일 관측 최장 5일 + 여유(ops, 2026-11-03). */
const ARRIVAL_DAYS = 7;
/** 한도의 90% 를 넘으면 한도가 터지기 전에 다시 판정한다. */
const NEAR = 0.9;

test("파일이 25개이고 유형은 전부 꺼져 있다", { skip }, () => {
  assert.equal(names.length, LIMITS.files);
  for (const name of names) assert.deepEqual(JSON.parse(read(name)).types, JSON.parse(JSON.stringify(TYPES)), name);
});

test("구별 도착일이 7일 안이다", { skip }, () => {
  const today = Date.now();
  const stale = names.filter((name) => {
    const { asOf } = JSON.parse(read(name));
    return !asOf.deals || today - Date.parse(`${asOf.deals}T00:00:00+09:00`) > (ARRIVAL_DAYS + 1) * 86_400_000;
  });
  assert.deepEqual(stale, []);
});

test("크기가 한도의 90% 안이다", { skip }, () => {
  const sizes = names.map((name) => [name, gzipSync(read(name), { level: 9 }).length]);
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  assert.deepEqual(sizes.filter(([, size]) => size > LIMITS.fileGzip * NEAR), []);
  assert.ok(total <= LIMITS.totalGzip * NEAR, `합 ${total}B`);
});

test("값을 낸 칸이 있다", { skip }, () => {
  const cells = APARTMENT_FIELDS.indexOf("cells");
  assert.ok(names.reduce((sum, name) => sum + JSON.parse(read(name)).apartments.reduce((s, row) => s + row[cells].length, 0), 0) > 0);
});
