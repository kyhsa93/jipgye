// 전월세 만기 달력(N2, #674) 빌더의 시험 - 파싱 규칙, 창, partial·잡힌 몫, 문턱, soft-fail, 출력 경로, Daily 등록.
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EXPIRY_MONTHS, LAG_HI, LAG_LO, PARTIAL_MONTHS, buildLeaseExpiry, expiryMonth } from "../scripts/lease-expiry.ts";
import { leaseExpiryFile, writeLeaseExpirySoft } from "../scripts/build-renewal-facts.ts";
import { MIN_SAMPLE } from "../scripts/realestate-format.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

const NOW = new Date("2026-10-26T00:00:00Z");
const FILED = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 10 + i, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
});
const empty = () => Object.fromEntries(FILED.map((m) => [m, []]));
const lease = (term, extra = {}) => ({ contractTerm: term, deposit: "50,000", monthlyRent: "0", contractType: "신규", useRRRight: "", ...extra });
const many = (n, term, extra) => Array.from({ length: n }, () => lease(term, extra));

test("expiryMonth: 두 형식만, 끝 달(2000+YY), 형식 밖·달 범위 밖·끝 ≤ 시작은 null", () => {
  assert.equal(expiryMonth("25.02~27.02"), "202702");
  assert.equal(expiryMonth(" 25.02~27.02 "), "202702");
  assert.equal(expiryMonth("~27.03"), "202703", "시작 없는 형식은 만기만 쓴다");
  for (const bad of ["", null, undefined, "27.02", "25.02-27.02", "2025.02~2027.02", "25.2~27.2", "25.02~27.13", "25.13~27.02", "25.02~27.00"]) {
    assert.equal(expiryMonth(bad), null, String(bad));
  }
  assert.equal(expiryMonth("27.02~27.02"), null, "끝 = 시작");
  assert.equal(expiryMonth("27.05~27.02"), null, "끝 < 시작");
});

test("buildLeaseExpiry: 창은 마지막 신고월 다음 달부터 12개월, 전세/월세(월세 0 기준)·요구권 사용을 센다", () => {
  const byMonth = empty();
  byMonth["202502"] = [...many(6, "25.03~27.02"), ...many(5, "25.03~27.02", { monthlyRent: "50" }), ...many(5, "25.03~27.02", { useRRRight: "사용", contractType: "갱신" })];
  byMonth["202509"] = [...many(7, "25.10~26.11"), lease("~26.09"), lease("26.10~28.10"), lease("깨진값")]; // 창 밖·깨진 값은 세지 않는다
  const out = buildLeaseExpiry({ byDistrict: { 가구: byMonth }, filed: FILED, now: NOW });
  assert.equal(out.months.length, EXPIRY_MONTHS);
  assert.deepEqual([out.months[0], out.months.at(-1)], ["202611", "202710"]);
  assert.deepEqual(out.filed, ["202411", "202610"]);
  const d = out.districts["가구"];
  const feb = out.months.indexOf("202702");
  assert.deepEqual([d.t[feb], d.j[feb], d.w[feb], d.u[feb]], [16, 11, 5, 5], "반전세(월세>0)는 월세, 요구권 '사용'만 센다");
  assert.equal(d.t[0], 7);
  assert.equal(out.seoul.t[feb], 16, "서울은 구를 모두 합쳐 다시 센다");
  // 건별 행·단지는 싣지 않는다 - 칸은 넷뿐
  assert.deepEqual(Object.keys(d).sort(), ["j", "t", "u", "w"]);
});

test("문턱: hasEnoughSample(n≥5) 아래 칸은 null, 넘으면 건수 그대로", () => {
  const byMonth = empty();
  byMonth["202503"] = [...many(MIN_SAMPLE, "25.04~27.03"), ...many(MIN_SAMPLE - 1, "25.04~27.04")];
  const out = buildLeaseExpiry({ byDistrict: { 가구: byMonth }, filed: FILED, now: NOW });
  const d = out.districts["가구"];
  assert.equal(d.t[out.months.indexOf("202703")], MIN_SAMPLE);
  assert.equal(d.t[out.months.indexOf("202704")], null);
  assert.equal(d.w[out.months.indexOf("202703")], null, "0건 칸도 null");
});

test("partial: 창의 첫 석 달, 잡힌 몫은 창 끝 석 달의 「만기월 − 신고월」 분포로 추정한다", () => {
  assert.equal(PARTIAL_MONTHS, 3);
  assert.deepEqual([LAG_LO, LAG_HI], [12, 33]);
  const byMonth = empty();
  // 창 끝 석 달(2027-08~10) 만기: 시차 24·25·26·27 각 10건 → 첫 신고월(202411)에서 24·25·26개월이 한계인 첫 석 달은 10/40·20/40·30/40
  for (const [lag, n] of [[24, 10], [25, 10], [26, 10], [27, 10]]) {
    const e = "202709";
    const fi = 2027 * 12 + 8 - lag;
    const filed = `${Math.floor(fi / 12)}${String((fi % 12) + 1).padStart(2, "0")}`;
    byMonth[filed].push(...many(n, `${filed.slice(2, 4)}.${filed.slice(4)}~${e.slice(2, 4)}.${e.slice(4)}`));
  }
  // 구간 밖 시차(11개월)는 분모에 넣지 않는다
  byMonth["202610"].push(...many(50, "26.10~27.09"));
  const out = buildLeaseExpiry({ byDistrict: { 가구: byMonth }, filed: FILED, now: NOW });
  assert.deepEqual(out.partial, ["202611", "202612", "202701"]);
  assert.deepEqual(out.capture, [25, 50, 75]);
  // 원본이 없으면 몫을 모른다(null)
  assert.deepEqual(buildLeaseExpiry({ byDistrict: { 가구: empty() }, filed: FILED, now: NOW }).capture, [null, null, null]);
});

test("빈 원본 달: 그 구와 서울에 missing 으로 적는다(0건이 아니라 모름)", () => {
  const byMonth = empty();
  byMonth["202501"] = null;
  const out = buildLeaseExpiry({ byDistrict: { 가구: byMonth, 나구: empty() }, filed: FILED, now: NOW });
  assert.deepEqual(out.districts["가구"].missing, ["202501"]);
  assert.equal(out.districts["나구"].missing, undefined);
  assert.deepEqual(out.seoul.missing, ["202501"]);
});

test("writeLeaseExpirySoft: 원본이 없어도 25구가 나오고, 쓸 수 없으면 false·이전 파일 유지", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "lease-expiry-"));
  try {
    const raw = path.join(tmp, "raw");
    const out = path.join(tmp, "data", "lease-expiry.json");
    assert.equal(await writeLeaseExpirySoft(NOW, { dir: raw, file: out }), true);
    assert.deepEqual(await readdir(path.dirname(out)), ["lease-expiry.json"]);
    const first = JSON.parse(await readFile(out, "utf8"));
    assert.deepEqual(Object.keys(first.districts), DISTRICTS.map((d) => d.name));

    const blocker = path.join(tmp, "blocker");
    await writeFile(blocker, "x");
    assert.equal(await writeLeaseExpirySoft(NOW, { dir: raw, file: path.join(blocker, "lease-expiry.json") }), false);

    const ro = path.join(tmp, "ro");
    await mkdir(ro);
    await writeFile(path.join(ro, "lease-expiry.json"), "이전");
    await chmod(ro, 0o555);
    try {
      assert.equal(await writeLeaseExpirySoft(NOW, { dir: raw, file: path.join(ro, "lease-expiry.json") }), false);
      assert.equal(await readFile(path.join(ro, "lease-expiry.json"), "utf8"), "이전");
      assert.deepEqual(await readdir(ro), ["lease-expiry.json"]);
    } finally {
      await chmod(ro, 0o755);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("출력 경로 허용 목록: 기본 경로는 docs/data/lease-expiry.json 하나이고, 빌더 소스에 그 밖의 쓰기 경로가 없다", async () => {
  assert.equal(path.relative(root, leaseExpiryFile), path.join("docs", "data", "lease-expiry.json"));
  const src = (await read("scripts/lease-expiry.ts")) + (await read("scripts/build-renewal-facts.ts"));
  const paths = [...src.matchAll(/"((?:\.\.\/)?(?:docs|raw|build|research|audit)\/[^"]*)"/g)].map((m) => m[1]);
  for (const p of paths) assert.match(p, /^docs\/data\//, `허용 밖 경로: ${p}`);
  assert.doesNotMatch(await read("scripts/lease-expiry.ts"), /fetch\(|https?:\/\//, "만기 달력은 네트워크를 쓰지 않는다");
});

test("Daily 등록: 새 줄·새 단계 없이 기존 build-renewal-facts(실거래 수집 단계)가 재계약 관찰보다 먼저 부른다", async () => {
  const [daily, updateAll, builder] = await Promise.all([read(".github/workflows/daily-update.yml"), read("scripts/update-all.mjs"), read("scripts/build-renewal-facts.ts")]);
  assert.doesNotMatch(daily, /lease-expiry/);
  assert.doesNotMatch(updateAll, /lease-expiry/);
  const step = daily.split("- name: 실거래 수집")[1]?.split("- name:")[0] ?? "";
  assert.ok(step.includes("node scripts/build-renewal-facts.ts"));
  const main = builder.slice(builder.indexOf("async function main()"));
  assert.ok(main.indexOf("writeLeaseExpirySoft(now)") >= 0, "main 이 만기 달력을 부르지 않는다");
  assert.ok(main.indexOf("writeLeaseExpirySoft(now)") < main.indexOf("if (!payload)"), "재계약 관찰이 비는 날 만기 달력이 건너뛰어진다");
});

test("커밋된 산출물: 모양·크기(≤15KB)만 본다 - 값·날짜로 갈리는 검사는 넣지 않는다", async () => {
  const body = await read("docs/data/lease-expiry.json");
  assert.ok(Buffer.byteLength(body) <= 15 * 1024, `${Buffer.byteLength(body)}B`);
  const d = JSON.parse(body);
  assert.equal(d.months.length, EXPIRY_MONTHS);
  assert.equal(d.partial.length, PARTIAL_MONTHS);
  assert.equal(d.capture.length, PARTIAL_MONTHS);
  assert.deepEqual(Object.keys(d.districts), DISTRICTS.map((x) => x.name));
  for (const r of [d.seoul, ...Object.values(d.districts)]) {
    for (const k of ["t", "j", "w", "u"]) {
      assert.equal(r[k].length, EXPIRY_MONTHS);
      for (const v of r[k]) assert.ok(v === null || (Number.isInteger(v) && v >= MIN_SAMPLE), String(v));
    }
  }
});
