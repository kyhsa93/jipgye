import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shiftMonth } from "../scripts/outlook.ts";

// 네트워크 없음: ECOS 는 fetchImpl 스텁이 주소의 구간·쪽을 읽어 답한다(#587).
// kbFile 도 임시로 돌린다 - collect 는 시작할 때 kbFile 을 지우고 끝에 쓰므로 저장소의 cache/ 를 건드리면 안 된다.
const dir = await mkdtemp(path.join(os.tmpdir(), "jipgye-indicators-"));
const FILE = path.join(dir, "series.json");
const KB_FILE = path.join(dir, "kb-history.json");
const { collect } = await import("../scripts/fetch-indicators.ts");
const go = (fetchImpl) => collect({ fetchImpl, now: NOW, key: "sample", indicatorFile: FILE, kbFile: KB_FILE, log: () => {} });

const NOW = new Date("2026-10-15T03:00:00Z"); // to=202610, 갱신 창 시작=202508
const JEONSE = "121Y015";
// 쪽을 넘겨 가며 받으므로 같은 구간이 여러 번 나온다 - 구간만 중복 없이 센다.
const asked = (calls, stat) => [...new Set(calls.filter((url) => url.includes(`/${stat}/M/`)).map((url) => url.split("/").slice(-3, -1).join("-")))].map((r) => r.split("-"));

function stub({ value = () => 1.5, ok = true } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!ok) return { ok: false, status: 500 };
    const [, , , , , , , , start, end, stat, , from, to] = url.split("/");
    const months = [];
    for (let m = from; m <= to; m = shiftMonth(m, 1)) months.push(m);
    const row = months.slice(start - 1, end).map((TIME) => ({ TIME, DATA_VALUE: String(value(stat, TIME)) }));
    const body = url.includes("ecos.bok.or.kr") && row.length ? { StatisticSearch: { row } } : { RESULT: { CODE: "INFO-200" } };
    return { ok: true, json: async () => body };
  };
  return { calls, fetchImpl };
}

async function run(stored, options) {
  await writeFile(FILE, JSON.stringify({ source: "t", series: stored }));
  const s = stub(options);
  await go(s.fetchImpl);
  return { calls: s.calls, series: JSON.parse(await readFile(FILE, "utf8")).series };
}

test("저장 첫 달이 since 보다 늦으면 since 부터, 아니면 최근 14개월을 받는다", async () => {
  const late = await run({ jeonse_loan_rate: [["202508", 3.98]] });
  assert.deepEqual(asked(late.calls, JEONSE)[0], ["201501", "202610"]);
  const full = await run({ jeonse_loan_rate: [["201501", 4.1], ["202508", 3.98]] });
  assert.deepEqual(asked(full.calls, JEONSE)[0], ["202508", "202610"]);
  assert.equal(late.series.jeonse_loan_rate[0][0], "201501");
  assert.equal(late.series.deposit_rate[0][0], "200001", "저장본이 없는 계열도 since 부터 받는다");
});

test("같은 응답으로 두 번 돌리면 결과 바이트가 같다", async () => {
  await run({ deposit_rate: [["202508", 2.48]] });
  const first = await readFile(FILE, "utf8");
  const again = await stub();
  await go(again.fetchImpl);
  assert.equal(await readFile(FILE, "utf8"), first);
  assert.deepEqual(asked(again.calls, "121Y002")[0], ["202508", "202610"], "메운 뒤에는 14개월 범위로 돌아간다");
});

test("창보다 오래된 달에 다른 값이 와도 저장값을 지키고 없는 달만 더한다", async () => {
  const { series } = await run({ jeonse_loan_rate: [["201601", 9], ["202610", 9]] });
  const byMonth = new Map(series.jeonse_loan_rate);
  assert.equal(byMonth.get("201601"), 9);
  assert.equal(byMonth.get("201501"), 1.5);
  assert.equal(byMonth.get("201602"), 1.5);
});

test("창 안의 달에 다른 값이 오면 새 값이 이긴다", async () => {
  const { series } = await run({ jeonse_loan_rate: [["201601", 9], ["202610", 9]] });
  assert.equal(new Map(series.jeonse_loan_rate).get("202610"), 1.5);
});

test("since 없는 계열은 요청 범위가 그대로다", async () => {
  const { calls } = await run({ base_rate: [["202001", 9]] });
  for (const stat of ["722Y001", "721Y001", "121Y006"]) assert.deepEqual(asked(calls, stat), [["202508", "202610"]]);
  assert.equal(new Map((await run({ base_rate: [["202001", 9]] })).series.base_rate).get("202001"), 9);
});

test("받기에 실패하면 저장본이 바뀌지 않는다", async () => {
  const stored = { jeonse_loan_rate: [["202508", 3.98]], deposit_rate: [["202508", 2.48]] };
  const { series } = await run(stored, { ok: false });
  assert.deepEqual(series, stored);
});
