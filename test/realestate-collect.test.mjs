import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { errorXml, monthDays, rentItem, saleItem, startFakeMolit, successXml } from "./helpers/fake-molit.mjs";
import { MIN_SAMPLE } from "../scripts/realestate-format.mjs";
import { refreshMonths, windowMonths } from "../scripts/realestate-slots.ts";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date();
const PERIOD = windowMonths(NOW)[0];
const DISTRICT_COUNT = 25;

/**
 * 한 번 실행에 다시 받는 달.
 *
 * 보통은 당월과 전월 둘이지만, 달이 바뀐 직후 사흘(MONTH_START_GRACE_DAYS) 동안은
 * 전전월까지 셋을 받는다 - 신고 기한이 30일이라 그 시기에 지지난달로 늦게 들어오는
 * 신고가 있기 때문이다.
 *
 * 이 값을 둘로 박아 두면 매달 1~3일에만 검사가 깨진다. 코드가 바뀌지 않았는데
 * 달력 때문에 깨지는 단언이고, 이 저장소에서는 그 사흘 동안 수집 워크플로가
 * 통째로 멈춘다 - 수집 전에 도는 테스트 단계가 막기 때문이다.
 */
const REFRESH_MONTHS = refreshMonths(NOW);
const REFRESH_SLOTS = DISTRICT_COUNT * REFRESH_MONTHS.length;
const STEPS = ["scripts/fetch-realestate.mjs", "scripts/build-realestate.mjs"];

const spread = (kind, yearMonth, extra = {}) =>
  successXml(monthDays(yearMonth).map((on) => (kind === "sale" ? saleItem({ ...on, ...extra }) : rentItem({ ...on, ...extra }))));

async function collect(server, { rawDir, dataDir, backfillLimit = 0, env = {} }, steps = STEPS) {
  const options = {
    cwd: root,
    env: {
      ...process.env,
      MOLIT_API_ENDPOINT: server.saleUrl,
      MOLIT_API_KEY: "test",
      MOLIT_RENT_API_ENDPOINT: server.rentUrl,
      MOLIT_RENT_API_KEY: "test",
      REALESTATE_RAW_DIR: rawDir,
      REALESTATE_DATA_DIR: dataDir,
      MOLIT_BACKFILL_LIMIT: String(backfillLimit),
      MOLIT_SWEEP_DELAY_MS: "0",
      MOLIT_RETRY_MS: "0",
      ...env,
    },
  };

  let stdout = "";
  for (const step of steps) {
    const result = await run("node", [step], options);
    stdout += result.stdout + result.stderr;
  }
  return { stdout };
}

async function workspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "collect-"));
  return { rawDir: path.join(dir, "raw"), dataDir: path.join(dir, "data") };
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf-8"));
const rawNames = async (dir, kind) => (await readdir(path.join(dir, kind))).sort();

test("갱신 대상인 달의 원본을 25개구씩 받아 남긴다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);

  const expected = [...REFRESH_MONTHS].sort();

  for (const kind of ["sale", "rent"]) {
    const names = await rawNames(space.rawDir, kind);
    assert.equal(names.length, REFRESH_SLOTS, `${kind} 슬롯 수가 다르다`);
    assert.deepEqual([...new Set(names.map((name) => name.slice(6, 12)))].sort(), expected);
  }
});

test("원본은 응답을 그대로 담고 건수를 함께 남긴다", async (t) => {
  const server = await startFakeMolit((kind) =>
    successXml([kind === "sale" ? saleItem({ aptNm: "원본확인" }) : rentItem()])
  );
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);

  const file = await readJson(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`));
  assert.equal(file.ok, true);
  assert.equal(file.count, 1);
  assert.equal(file.totalCount, 1);
  assert.equal(file.items[0].aptNm, "원본확인");
  assert.equal(file.items[0].dealingGbn, "중개거래");
});

test("산출물은 신고가 마감된 최근 몇 주 계약분으로 만들어진다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => spread(kind, yearMonth));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });

  const payload = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(payload.districts.length, DISTRICT_COUNT);
  assert.equal(payload.window.weeks, 4);
  assert.ok(payload.window.from < payload.window.to, JSON.stringify(payload.window));
  assert.ok(!("period" in payload), "달 기준 필드가 남아 있다");
  assert.ok(!("previousPeriod" in payload), "지난달 비교가 남아 있다");
  assert.ok(payload.overall.sale.transactionCount > 0, "확정 구간에 든 거래가 없다");
});

test("응답이 그대로면 원본 파일을 다시 쓰지 않는다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  const file = path.join(space.rawDir, "sale", `11110-${PERIOD}.json`);
  const before = await stat(file);

  await collect(server, space);
  const after = await stat(file);

  assert.equal(after.mtimeMs, before.mtimeMs, "내용이 같은데 파일을 다시 썼다");
});

test("새로 신고된 거래만 유입으로 센다", async (t) => {
  let extra = false;
  const server = await startFakeMolit((kind) => {
    if (kind !== "sale") return successXml([rentItem()]);
    return successXml(extra ? [saleItem(), saleItem({ aptNm: "새로들어온단지" })] : [saleItem()]);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  extra = true;
  const { stdout } = await collect(server, space);

  const file = await readJson(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`));
  assert.equal(file.count, 2);
  assert.ok(file.previousObservedAt, "직전 관측 시각을 남기지 않았다");
  assert.match(stdout, new RegExp(`새 거래 ${REFRESH_SLOTS}건`), stdout);
});

test("조회에 실패한 슬롯은 남기지 않아 다음 실행이 다시 받는다", async (t) => {
  let failing = true;
  const server = await startFakeMolit((kind, { code }) => {
    if (failing && kind === "sale" && code === "11110") return errorXml("LIMITED NUMBER OF SERVICE REQUESTS");
    return successXml([kind === "sale" ? saleItem() : rentItem()]);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  assert.ok(!(await rawNames(space.rawDir, "sale")).includes(`11110-${PERIOD}.json`), "실패한 슬롯이 저장됐다");

  failing = false;
  await collect(server, space);
  assert.ok((await rawNames(space.rawDir, "sale")).includes(`11110-${PERIOD}.json`), "실패한 슬롯을 다시 받지 않았다");
});

test("백필은 상한만큼만, 남은 몫은 다음 실행이 이어받는다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, { ...space, backfillLimit: 10 });

  assert.match(stdout, /신규 10\b/, stdout);
  assert.match(stdout, /대기 \d+/, stdout);

  const total = (await rawNames(space.rawDir, "sale")).length + (await rawNames(space.rawDir, "rent")).length;
  assert.equal(total, REFRESH_SLOTS * 2 + 10, "갱신분 외에 상한만큼만 받아야 한다");
});

test("잘린 응답은 확정으로 굳히지 않고 다음 실행에 다시 받는다", async (t) => {
  let truncated = true;
  const server = await startFakeMolit((kind) => {
    if (kind !== "sale") return successXml([rentItem()]);
    return truncated ? successXml([saleItem()], 9999) : successXml([saleItem()]);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });
  const older = windowMonths(NOW)[3];
  assert.equal((await readJson(path.join(space.rawDir, "sale", `11110-${older}.json`))).totalCount, 9999);

  truncated = false;
  const { stdout } = await collect(server, { ...space, backfillLimit: 400 });

  assert.match(stdout, /재조회 \d+/, stdout);
  assert.equal((await readJson(path.join(space.rawDir, "sale", `11110-${older}.json`))).totalCount, 1);
});

test("원본만 있으면 조회 없이 산출물을 다시 만든다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => spread(kind, yearMonth));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });
  const first = await readFile(path.join(space.dataDir, "realestate.json"), "utf-8");

  await server.close();
  await collect(server, space, ["scripts/build-realestate.mjs"]);
  const second = await readFile(path.join(space.dataDir, "realestate.json"), "utf-8");

  const strip = (text) => text.replace(/"updatedAt": "[^"]+"/g, "");
  assert.equal(strip(second), strip(first), "원본만으로 같은 산출물을 만들지 못했다");
});

test("수집이 통째로 실패해도 지난 원본으로 산출물을 만든다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => spread(kind, yearMonth));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });

  const dead = { saleUrl: "http://127.0.0.1:1/sale", rentUrl: "http://127.0.0.1:1/rent" };
  const { stdout } = await collect(dead, space);

  assert.match(stdout, /시세 저장/, stdout);
  const payload = JSON.parse(await readFile(path.join(space.dataDir, "realestate.json"), "utf-8"));
  assert.equal(payload.districts.length, DISTRICT_COUNT);
});

test("전월세도 지역별 전수 파일로 남긴다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => {
    const on = { dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)) };
    return kind === "sale"
      ? successXml([saleItem(on)])
      : successXml([
          rentItem(on),
          rentItem({ ...on, aptNm: "월세단지", monthlyRent: "150", deposit: "10,000" }),
          rentItem({ ...on, aptNm: "갱신단지", contractType: "갱신", deposit: "45,000" }),
        ]);
  });
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, space);

  const months = refreshMonths(NOW);
  const file = JSON.parse(await readFile(path.join(space.dataDir, "rents-jongno.json"), "utf-8"));
  assert.equal(file.district, "종로구");
  assert.deepEqual(file.periods, [...months].sort(), "받아둔 달이 다 담기지 않았다");
  assert.equal(file.deals.length, 3 * months.length, "거래내역은 받아둔 달 전부를 담아야 한다");

  const jeonse = file.deals.find((deal) => deal.apt === "테스트단지");
  const wolse = file.deals.find((deal) => deal.apt === "월세단지");
  assert.ok(!("monthlyRent10k" in jeonse), "전세에 월세 항목이 남았다");
  assert.equal(wolse.monthlyRent10k, 150);
  assert.equal(file.deals.find((deal) => deal.apt === "갱신단지").renewal, true);
  assert.ok(file.deals.every((deal) => !("district" in deal)), "지역 이름이 거래마다 남았다");

  const total = DISTRICT_COUNT * months.length;
  assert.match(stdout, new RegExp(`전세 ${total * 2}건 · 월세 ${total}건`), stdout);
  assert.match(stdout, new RegExp(`갱신계약 ${total}건`), stdout);
});

test("날마다 새로 들어온 신고만 주간 시세로 쌓인다", async (t) => {
  let extra = 0;
  const server = await startFakeMolit((kind) => {
    const rows = Array.from({ length: 1 + extra }, (_, i) =>
      kind === "sale"
        ? saleItem({ aptNm: `단지${i}`, dealAmount: `${50000 + i * 1000}` })
        : rentItem({ aptNm: `전월세${i}`, deposit: `${30000 + i * 1000}` })
    );
    return successXml(rows);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  const first = JSON.parse(await readFile(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`), "utf-8"));
  assert.deepEqual(first.arrivals, {}, "처음 받은 거래에 신고일을 붙였다");

  extra = 2;
  await collect(server, space);
  const second = JSON.parse(await readFile(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`), "utf-8"));
  assert.equal(Object.keys(second.arrivals).length, 2, "새로 들어온 두 건만 잡아야 한다");
  assert.equal(second.count, 3);
});

test("연달아 실패하면 남은 슬롯을 다음 실행으로 넘긴다", async (t) => {
  const server = await startFakeMolit(() => undefined);
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(
    server,
    { ...space, backfillLimit: 50, env: { MOLIT_ABORT_AFTER: "5" } },
    ["scripts/fetch-realestate.mjs"]
  );

  assert.match(stdout, /5개 연속 실패로 중단했습니다/, stdout);
  assert.match(stdout, /남은 \d+개 슬롯은 다음 실행에서 받습니다/, stdout);
  assert.ok(!stdout.includes("재시도 스윕"), "전부 막힌 상태에서 스윕까지 돌았다");
});

test("한 슬롯이 실패해도 나머지는 계속 받는다", async (t) => {
  const server = await startFakeMolit((kind, { code }) =>
    kind === "sale" && code === "11110" ? undefined : successXml([kind === "sale" ? saleItem() : rentItem()])
  );
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, { ...space, env: { MOLIT_ABORT_AFTER: "5" } });

  assert.ok(!stdout.includes("연속 실패로 중단"), stdout);
  assert.ok((await rawNames(space.rawDir, "sale")).length >= DISTRICT_COUNT, "성공한 슬롯이 저장되지 않았다");
});

test("환경변수가 비어 있으면 기본값으로 돈다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, {
    ...space,
    env: { MOLIT_BACKFILL_LIMIT: "", MOLIT_CONCURRENCY: "", MOLIT_TIMEOUT_MS: "" },
  });

  assert.match(stdout, /신규 50\b/, `백필 상한이 0이 됐다: ${stdout}`);
  assert.ok((await rawNames(space.rawDir, "sale")).length > 0, "한 슬롯도 받지 못했다");
});

test("신고 기록이 창을 못 채우면 계약일 기준으로 낸다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => spread(kind, yearMonth));
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, { ...space, backfillLimit: 400 });

  assert.match(stdout, /신고가 자치구 절반에도 못 미칩니다/, stdout);
  const payload = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(payload.window.basis, "contract");
});

test("기준이 바뀌는 날에는 지난 기준 값을 물려받지 않는다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => spread(kind, yearMonth));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });
  const first = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(first.window.basis, "contract");

  const swapped = { ...first, window: { ...first.window, basis: "arrival" } };
  await writeFile(path.join(space.dataDir, "realestate.json"), JSON.stringify(swapped));

  await collect(server, { ...space, backfillLimit: 400 }, ["scripts/build-realestate.mjs"]);
  const again = await readJson(path.join(space.dataDir, "realestate.json"));

  assert.equal(again.window.basis, "contract");
  assert.equal(
    again.overall.sale.transactionCount,
    first.overall.sale.transactionCount,
    "다른 기준으로 만든 값이 섞였다"
  );
});

/**
 * 신고 건수를 단계마다 바꿀 수 있는 가짜 국토부. 단지 i번째가 그 달의 i번째 날 거래이고, 앞 단계 건수가 늘면 늘어난 만큼이 새 신고(= 이번 주 신고분)다.
 * `wolse`가 true면 홀수 번째 임대 건은 월세다(아니면 전부 전세 - rentItem 기본값).
 */
async function startArrivalMolit(state) {
  return startFakeMolit((kind, { yearMonth }) =>
    successXml(
      monthDays(yearMonth)
        .slice(0, kind === "sale" ? state.sale : state.rent)
        .map((on, i) =>
          kind === "sale"
            ? saleItem({ ...on, aptNm: `단지${i}` })
            : rentItem({ ...on, aptNm: `단지${i}`, ...(state.wolse && i % 2 === 1 ? { monthlyRent: 50 } : {}) })
        )
    )
  );
}

test("신고가 자치구 전반에 들어오면 신고일 기준으로 넘어간다", async (t) => {
  const state = { sale: 2, rent: 2, wolse: true };
  const server = await startArrivalMolit(state);
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });
  const before = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(before.window.basis, "contract", "첫 수집부터 신고일 기준을 썼다");

  state.sale = 5;
  state.rent = 5;
  const { stdout } = await collect(server, { ...space, backfillLimit: 400 });

  const after = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(after.window.basis, "arrival", stdout);
  assert.equal(after.window.weeks, 1, "서울 전체는 이번 주만 세야 한다");
  assert.equal(after.window.districtWeeks, 4, "자치구는 네 주를 겹쳐야 한다");
  assert.ok(after.window.districtFrom < after.window.from, "자치구 창이 더 넓지 않다");
  assert.ok(after.overall.sale.transactionCount > 0);
  // 서울 전체 카드 세 장이 다 값을 낼 만큼 찼을 때만 넘어간다(#387).
  for (const kind of ["sale", "jeonse", "wolse"]) {
    assert.ok(after.overall[kind]?.transactionCount >= MIN_SAMPLE, `${kind} 표본이 ${MIN_SAMPLE}건에 못 미친다`);
  }
});

test("신고가 자치구 절반을 넘어도 서울 전체 전세가 표본에 못 미치면 계약일 기준에 머문다 (#387)", async (t) => {
  // 2026-10-19 월요일 새벽의 모양: 매매 신고만 여러 구에 들어오고 전월세 신고는 아직 없다.
  const state = { sale: 2, rent: 2, wolse: true };
  const server = await startArrivalMolit(state);
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });

  state.sale = 5;
  const { stdout } = await collect(server, { ...space, backfillLimit: 400 });

  assert.match(stdout, /서울 전체 표본이 모자랍니다/, stdout);
  assert.match(stdout, /전세 0건/, stdout);
  const payload = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(payload.window.basis, "contract", "서울 전체가 '-'가 될 신고일 기준으로 넘어갔다");
  assert.ok(payload.overall.jeonse.transactionCount >= MIN_SAMPLE, "계약일 기준 서울 전체 전세가 비었다");
  assert.ok(payload.overall.wolse.transactionCount >= MIN_SAMPLE, "계약일 기준 서울 전체 월세가 비었다");
});

test("월세만 모자라도 계약일 기준에 머물고, 표본이 차면 신고일 기준으로 넘어간다 (#387)", async (t) => {
  // 월세 카드("월세 보증금 / 월세")도 서울 전체 값이 있어야 낸다 - 매매·전세만 보면 이 날 월세 카드가 '-'가 된다.
  const state = { sale: 2, rent: 2, wolse: false };
  const server = await startArrivalMolit(state);
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });

  state.sale = 5;
  state.rent = 5;
  const { stdout } = await collect(server, { ...space, backfillLimit: 400 });

  assert.match(stdout, /서울 전체 표본이 모자랍니다/, stdout);
  assert.match(stdout, /월세 부족/, stdout);
  const held = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(held.window.basis, "contract");

  // 월세 신고가 들어와 서울 전체가 찬다 = 화요일 이후의 모양. 같은 날 다시 돌려도 기준이 신고일로 넘어가고 history 에 그 기준이 남는다.
  state.wolse = true;
  state.rent = 6;
  const again = await collect(server, { ...space, backfillLimit: 400 });
  const arrived = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(arrived.window.basis, "arrival", again.stdout);
  assert.ok(arrived.overall.wolse.transactionCount >= MIN_SAMPLE);

  const history = await readJson(path.join(space.dataDir, "realestate-history.json"));
  assert.equal(history.at(-1).window?.basis, "arrival", "history 의 오늘 항목이 새 기준을 남기지 않았다");
});
