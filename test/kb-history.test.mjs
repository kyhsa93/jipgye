import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collect, ECOS_SERIES, KB_HISTORY_FROM, KB_SERIES, kbHistoryProblem, RONE_SERIES } from "../scripts/fetch-indicators.ts";
import { buildFile, readKbSeries, withKb } from "../scripts/build-indicators.ts";
import { shiftMonth } from "../scripts/outlook.ts";

/**
 * #588 3단계: KB 두 계열(ECOS 가 싣는 KB국민은행 지수)의 원값을 저장소에 더 쌓지 않는다. 매일 전체 이력을 받아
 * 커밋하지 않는 임시 사본에만 두고, 판정표(docs/data/outlook-indicators.json)는 그걸로 만든다. 못 받으면 어제 파일을 둔다.
 * 오프라인 시험 - ECOS·R-ONE 응답은 가짜 fetch 로 준다.
 */

const months = (from, to) => {
  const out = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
};
const kbStats = new Set(Object.values(KB_SERIES).map((s) => s.stat));

/** ECOS StatisticSearch 경로를 읽어 그 범위의 달마다 값을 돌려주는 가짜. broken(stat) 이면 그 표는 http 500. */
function fakeFetch({ broken = () => false, gap = null, asked = [] } = {}) {
  return async (url) => {
    asked.push(url);
    if (url.includes("r-one")) {
      const q = new URL(url).searchParams;
      return { ok: true, json: async () => ({ SttsApiTblData: [{}, { row: [{ WRTTIME_IDTFR_ID: q.get("START_WRTTIME"), DTA_VAL: "7" }] }] }) };
    }
    const [, , , , , , start, end, stat, , from, to] = new URL(url).pathname.split("/");
    if (broken(stat)) return { ok: false, status: 500 };
    const all = months(from, to)
      .filter((m) => m !== gap)
      .map((m, i) => ({ STAT_CODE: stat, TIME: m, DATA_VALUE: String(kbStats.has(stat) ? 50 + i / 10 : 3.5) }));
    return { ok: true, json: async () => ({ StatisticSearch: { list_total_count: all.length, row: all.slice(Number(start) - 1, Number(end)) } }) };
  };
}

async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), "kb-history-"));
  // 옛 모양: 저장분에 kb_* 가 이미 있다(정리 PR 전). 이 값은 그대로 남고 더 갱신되지 않아야 한다.
  const stored = { source: "ECOS + R-ONE OpenAPI", series: { kb_sale: [["198601", 1]], kb_jeonse: [["198601", 2]], base_rate: [["202001", 0.5]] } };
  await writeFile(path.join(dir, "series.json"), `${JSON.stringify(stored)}\n`);
  return { dir, indicatorFile: path.join(dir, "series.json"), kbFile: path.join(dir, "cache/kb-history.json"), stored };
}

const NOW = new Date("2026-10-25T00:00:00Z");

test("KB 는 판정 후보 계열과 따로 있고, 매일 갱신 목록(ECOS_SERIES)에는 없다 (#588)", () => {
  assert.deepEqual(KB_SERIES, { kb_sale: { stat: "901Y062", item: "P63ACA" }, kb_jeonse: { stat: "901Y063", item: "P64ACA" } });
  for (const name of Object.keys(KB_SERIES)) assert.equal(name in ECOS_SERIES, false, `${name} 가 매일 덮는 목록에 남았다`);
  assert.equal(KB_HISTORY_FROM, "198601");
});

test("수집: KB 새 값은 raw 에 들어가지 않고 임시 사본에만 전체 이력으로 남는다. 다른 계열은 전처럼 덮는다", async () => {
  const { dir, indicatorFile, kbFile, stored } = await sandbox();
  const asked = [];
  const logs = [];
  const result = await collect({ now: NOW, key: "k", fetchImpl: fakeFetch({ asked }), indicatorFile, kbFile, log: (s) => logs.push(s) });
  assert.equal(result.kbOk, true);
  const raw = JSON.parse(await readFile(indicatorFile, "utf8"));
  assert.deepEqual(raw.series.kb_sale, stored.series.kb_sale, "raw 의 kb_sale 이 바뀌었다 - 원값이 다시 쌓인다");
  assert.deepEqual(raw.series.kb_jeonse, stored.series.kb_jeonse);
  assert.equal(raw.series.base_rate.at(-1)[0], "202610", "다른 계열의 최근 14개월 덮기가 멈췄다");
  assert.equal(raw.series.base_rate[0][0], "202001", "저장분 위에 덮어야 한다");
  for (const name of [...Object.keys(ECOS_SERIES), ...Object.keys(RONE_SERIES)]) assert.ok(raw.series[name], name);
  const kb = JSON.parse(await readFile(kbFile, "utf8"));
  const expected = months(KB_HISTORY_FROM, "202610").length;
  for (const name of Object.keys(KB_SERIES)) {
    assert.equal(kb.series[name].length, expected, `${name} 전체 이력`);
    assert.equal(kbHistoryProblem(kb.series[name]), null);
  }
  // 인증키면 KB 계열마다 ECOS 1호출(1,000줄 한 쪽), 범위는 198601 부터.
  const kbCalls = asked.filter((u) => [...kbStats].some((s) => u.includes(`/${s}/`)));
  assert.equal(kbCalls.length, 2);
  for (const u of kbCalls) assert.match(u, /\/1\/1000\/901Y06[23]\/M\/198601\/202610\/P6[34]ACA$/);
  assert.ok(logs.some((s) => s.includes("KB 계열 전체 이력")));
  await rm(dir, { recursive: true, force: true });
});

test("수집: KB 전체 이력을 못 받으면 임시 사본을 남기지 않는다(낡은 사본도 지운다) - 다른 계열은 그대로 간다", async () => {
  for (const [label, opts] of [
    ["http 500", { broken: (stat) => stat === "901Y063" }],
    ["빠진 달", { gap: "199912" }],
  ]) {
    const { dir, indicatorFile, kbFile, stored } = await sandbox();
    await collect({ now: NOW, key: "k", fetchImpl: fakeFetch(), indicatorFile, kbFile, log: () => {} });
    const before = await readFile(kbFile, "utf8"); // 어제 사본
    assert.ok(before);
    const logs = [];
    const result = await collect({ now: NOW, key: "k", fetchImpl: fakeFetch(opts), indicatorFile, kbFile, log: (s) => logs.push(s) });
    assert.equal(result.kbOk, false, label);
    await assert.rejects(readFile(kbFile, "utf8"), { code: "ENOENT" }, `${label}: 낡은 KB 사본이 남았다`);
    assert.ok(logs.some((s) => s.startsWith("::warning::KB 계열 전체 이력을 못 받았다")), `${label}: 실패를 알리지 않았다`);
    const raw = JSON.parse(await readFile(indicatorFile, "utf8"));
    assert.deepEqual(raw.series.kb_sale, stored.series.kb_sale);
    assert.equal(raw.series.base_rate.at(-1)[0], "202610");
    await rm(dir, { recursive: true, force: true });
  }
});

test("이력 검사: 198601 부터 빠진 달 없이 이어져야 한다", () => {
  const ok = months("198601", "198612").map((m) => [m, 1]);
  assert.equal(kbHistoryProblem(ok), null);
  assert.match(kbHistoryProblem(ok.slice(1)), /198601부터가 아님/);
  assert.match(kbHistoryProblem([...ok.slice(0, 3), ...ok.slice(4)]), /198604 빠짐/);
  assert.equal(kbHistoryProblem([]), "빈 이력");
  assert.equal(readKbSeries({ series: { kb_sale: ok } }), null, "한 계열만 있으면 판정하지 않는다");
  assert.deepEqual(Object.keys(readKbSeries({ series: { kb_jeonse: ok, kb_sale: ok } })), ["kb_sale", "kb_jeonse"]);
});

test("판정: 옛 raw(kb_* 있음)와 새 raw(kb_* 없음)가 같은 KB 사본 아래 같은 계열이 되고, raw 의 옛 kb_* 는 쓰지 않는다", () => {
  const kb = { kb_sale: [["198601", 9]], kb_jeonse: [["198601", 8]] };
  const old = { source: "s", series: { kb_sale: [["198601", 1]], kb_jeonse: [["198601", 2]], base_rate: [["202001", 0.5]] } };
  const fresh = { source: "s", series: { base_rate: [["202001", 0.5]] } };
  assert.equal(JSON.stringify(withKb(old, kb)), JSON.stringify(withKb(fresh, kb)));
  assert.deepEqual(Object.keys(withKb(fresh, kb).series), ["kb_sale", "kb_jeonse", "base_rate"], "KB 가 앞(옛 raw 키 순서)");
  assert.equal(withKb(old, null), null);
});

/** 2006-01부터 240달 가격(작은 결정적 잡음). */
function priceRows() {
  let level = 100;
  return months("200601", shiftMonth("200601", 239)).map((m, i) => {
    level *= 1 + 0.004 * Math.sin(i / 5) + 0.001 * Math.cos(i * 1.7);
    return [m, level];
  });
}

test("빌더: KB 사본이 없으면 어제 파일을 그대로 두고 알린다. 있으면 같은 입력에 같은 바이트, 옛·새 raw 모양에 같은 바이트", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kb-build-"));
  const p = priceRows();
  const index = { series: { 200: p, 210: p, 220: p, 230: p, 240: p, 250: p } };
  const junk = (from) => months(from, "202609").map((m, i) => [m, 100 + Math.sin(i)]);
  const kb = { kb_sale: junk("198601"), kb_jeonse: junk("198601").map(([m, v]) => [m, v * 0.6]) };
  const rest = { base_rate: junk("200601"), mortgage_rate: junk("200601"), ktb3: junk("200601") };
  const f = (name) => path.join(dir, name);
  await writeFile(f("index.json"), JSON.stringify(index));
  await writeFile(f("old.json"), JSON.stringify({ source: "s", series: { kb_sale: [["198601", 1]], kb_jeonse: [["198601", 1]], ...rest } }));
  await writeFile(f("new.json"), JSON.stringify({ source: "s", series: rest }));
  await writeFile(f("out.json"), "어제 파일");
  const now = new Date("2026-10-25T09:00:00Z");
  const logs = [];
  const common = { indexFile: f("index.json"), now, log: (s) => logs.push(s) };

  assert.equal(await buildFile({ ...common, indicatorFile: f("old.json"), kbFile: f("none.json"), out: f("out.json") }), null);
  assert.equal(await readFile(f("out.json"), "utf8"), "어제 파일", "KB 없이 판정표를 다시 썼다 - KB 행이 빠지거나 옛 값으로 나간다");
  assert.ok(logs.some((s) => s.startsWith("::warning::앞서지 않은 지표: KB")));
  await writeFile(f("bad-kb.json"), JSON.stringify({ series: { kb_sale: kb.kb_sale.slice(12), kb_jeonse: kb.kb_jeonse } }));
  assert.equal(await buildFile({ ...common, indicatorFile: f("old.json"), kbFile: f("bad-kb.json"), out: f("out.json") }), null, "반쪽 이력");
  assert.equal(await readFile(f("out.json"), "utf8"), "어제 파일");

  await writeFile(f("kb.json"), JSON.stringify({ to: "202610", series: kb }));
  await buildFile({ ...common, indicatorFile: f("old.json"), kbFile: f("kb.json"), out: f("a.json") });
  await buildFile({ ...common, indicatorFile: f("old.json"), kbFile: f("kb.json"), out: f("b.json") });
  await buildFile({ ...common, indicatorFile: f("new.json"), kbFile: f("kb.json"), out: f("c.json") });
  const [a, b, c] = await Promise.all(["a", "b", "c"].map((n) => readFile(f(`${n}.json`), "utf8")));
  assert.equal(a, b, "같은 입력인데 바이트가 다르다");
  assert.equal(a, c, "raw 모양(옛·새)에 따라 판정표가 달라졌다");
  const payload = JSON.parse(a);
  assert.ok(payload.rows.some((r) => r.id === "kb1"), "KB 파생 행이 없다");
  assert.equal(payload.lastMonths.kb_sale, "202609");
  // 판정표에는 KB 원값(지수 수준)이 실리지 않는다.
  assert.equal(a.includes(String(kb.kb_sale[100][1])), false, "판정표에 KB 원값이 실렸다");
  await rm(dir, { recursive: true, force: true });
});

// ---- 정리(#588 3b): 추적 파일에 KB 원값이 없다 ----

test("정리: 추적되는 raw/indicators/series.json 에 kb_* 계열이 없다 (원값 재커밋 방지)", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const text = await readFile(path.join(root, "raw/indicators/series.json"), "utf8");
  const raw = JSON.parse(text);
  for (const name of Object.keys(KB_SERIES)) assert.equal(name in raw.series, false, `raw 에 ${name} 이 다시 생겼다 - KB 원값은 cache/indicators/kb-history.json(gitignore)에만 둔다`);
  assert.equal(/"kb_/.test(text), false, "raw 에 kb_ 키가 남아 있다");
  // 나머지 지표 계열은 그대로 있다(11행 판정에 쓰이는 입력이 같이 지워지지 않았다).
  for (const name of ["base_rate", "mortgage_rate", "ktb3", "vol_seoul", "jratio_seoul"]) assert.ok(raw.series[name]?.length > 100, `${name} 이 비었다`);
});

test("정리: .gitignore 가 KB 사본 경로를 막고, 연구 스크립트는 raw 가 아니라 임시 사본을 읽는다", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const ignore = (await readFile(path.join(root, ".gitignore"), "utf8")).split("\n").map((l) => l.trim());
  for (const line of ["cache/", "research/buyer-search-timing-2026-10/cache/series.json", "research/*/cache/kb-history.json"]) {
    assert.ok(ignore.includes(line), `.gitignore 에 ${line} 가 없다 - KB 원값이 다시 커밋될 수 있다`);
  }
  assert.ok(ignore.indexOf("research/buyer-search-timing-2026-10/cache/series.json") > ignore.indexOf("!research/*/cache/"), "연구 cache 예외(!) 보다 앞에 있으면 무시가 안 된다");
  for (const rel of ["research/kb-vintage/check.py", "research/buyer-search-timing-2026-10/series_io.py", "research/buyer-search-timing-2026-10/fetch_series.py"]) {
    const src = await readFile(path.join(root, rel), "utf8");
    assert.equal(src.includes("raw/indicators/series.json"), false, `${rel} 가 raw 의 KB 계열을 읽는다`);
    assert.ok(src.includes("kb-history.json"), `${rel} 가 KB 임시 사본 경로를 쓰지 않는다`);
  }
});
