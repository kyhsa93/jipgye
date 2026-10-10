import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, writeFile, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { realItem } from "./helpers/housing-permits-items.mjs";
import { DAILY_LIMIT, FIELDS, LICENSE, PAGE_SIZE } from "../scripts/housing-permits-spec.mjs";
import { foldProjects } from "../scripts/housing-permits-fold.mjs";
import { DISTRICTS } from "../scripts/realestate-districts.mjs";

// 중단 진행 로그·시험 호출 모드·사업 관리번호 비노출 (#141). 전부 합성 응답과 로컬 스텁 서버다 - 실제 API는 부르지 않는다.
// 사업 관리번호 자리에는 MARK가 들어간다. 이 문자열이 stdout·stderr·파일 어디에도 나오면 낙제다.

const MARK = "PKMARK-9f3a1c";
const KEY = "AbCdEfGh1234zzQq";
const script = path.resolve(import.meta.dirname, "../scripts/fetch-housing-permits.mjs");
const execFileAsync = promisify(execFile);
const D = FIELDS.dates;

function item(sgg, n, extra = {}) {
  // 실제 응답 모양(30개 키). 관리번호 자리에 표지를 넣는다.
  return realItem({ mgmHsrgstPk: `${MARK}-${sgg}-${n}`, sigunguCd: sgg, totHhldCnt: 10, apprvDay: "20240315", stcnsDay: "20240601", crtnDay: "20240315", ...extra });
}
const envelope = (items, totalCount) => ({
  response: { header: { resultCode: "00", resultMsg: "OK" }, body: { items: { item: items }, totalCount } },
});

/** 구마다 동 하나에 항목 4건. 쪽 크기 2라 동당 2쪽. */
function goodHandler({ q }) {
  const all = [1, 2, 3, 4].map((n) => item(q.sigunguCd, n));
  const page = Number(q.pageNo), size = Number(q.numOfRows);
  return { json: envelope(all.slice((page - 1) * size, page * size), all.length) };
}

function startStub(handler) {
  const hits = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const q = Object.fromEntries(url.searchParams);
    hits.push({ q });
    const out = handler({ q, hits });
    res.writeHead(out.status ?? 200, { "Content-Type": out.contentType ?? "application/json" });
    res.end(out.raw ?? JSON.stringify(out.json));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ base: `http://127.0.0.1:${server.address().port}/stub`, hits, close: () => new Promise((d) => server.close(d)) })));
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "housing-trial-"));
  const bjdong = path.join(dir, "bjdong.json");
  // 구마다 동 둘(처리한 동 수를 세려면 하나로는 모자란다)
  await writeFile(bjdong, JSON.stringify(Object.fromEntries(DISTRICTS.map((d) => [d.code, ["10100", "10200"]]))));
  return { dir, bjdong, out: path.join(dir, "out"), raw: path.join(dir, "raw") };
}

async function run(env, args) {
  const clean = { PATH: process.env.PATH, BUILDINGHUB_RETRY_MS: "0", BUILDINGHUB_PAGE_SIZE: "2", BUILDINGHUB_API_KEY: KEY, ...env };
  const full = [...args, "--license", LICENSE.text, "--page-modified", "2026-09-01", "--collected-at", "2026-10-10T00:00:00.000Z"];
  try {
    const r = await execFileAsync(process.execPath, [script, ...full], { env: clean, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    return { code: e.code, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}
const exists = (p) => access(p).then(() => true, () => false);
const base = (s, stub) => ({ env: { BUILDINGHUB_API_ENDPOINT: stub.base }, args: ["--bjdong-file", s.bjdong, "--out-dir", s.out] });

// ---- (1) 중단 시 진행 로그 ----

test("진행 로그: 일 한도로 멈추면 처리한 동·쪽·호출·누적 항목 개수가 남고, 관리번호·키는 없다", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    // 호출 5번: 동1(2쪽) 끝, 동2(2쪽) 끝, 세 번째 동의 첫 쪽에서 6번째 호출이 한도
    const r = await run({ ...b.env, BUILDINGHUB_DAILY_LIMIT: "5" }, b.args);
    assert.equal(r.code, 3);
    assert.equal(stub.hits.length, 5);
    assert.match(r.out, /진행/);
    assert.match(r.out, /처리한 동 2\b/, "끝까지 받은 동 수");
    assert.match(r.out, /쪽 5\b/);
    assert.match(r.out, /호출 5\b/);
    assert.match(r.out, /누적 항목 (9|10)\b/, "받은 항목 수(5쪽 x 2건에서 마지막 쪽 1건 포함 가능)");
    assert.ok(!r.out.includes(MARK), "사업 관리번호가 로그에 나옴");
    assert.ok(!r.out.includes(KEY), "키가 로그에 나옴");
  } finally { await stub.close(); }
});

test("진행 로그: 429로 멈출 때도 남고, 위치는 구 코드와 쪽 번호뿐이다", async () => {
  const s = await setup();
  const stub = await startStub((c) => (c.hits.length >= 3 ? { status: 429, raw: "too many" } : goodHandler(c)));
  try {
    const b = base(s, stub);
    const r = await run(b.env, b.args);
    assert.equal(r.code, 3);
    assert.match(r.out, /진행/);
    assert.match(r.out, /처리한 동 1\b/);
    assert.match(r.out, /쪽 2\b/);
    assert.match(r.out, /11110/);
    assert.ok(!r.out.includes(MARK), "관리번호가 로그에 나옴");
  } finally { await stub.close(); }
});

test("진행 로그: 일부 동 실패로 끝나도 처리한 동 수·쪽 수가 남는다", async () => {
  const s = await setup();
  const stub = await startStub((c) => (c.q.sigunguCd === "11140" ? { status: 500, raw: "boom" } : goodHandler(c)));
  try {
    const b = base(s, stub);
    const r = await run(b.env, b.args);
    assert.equal(r.code, 3);
    assert.match(r.out, /진행/);
    assert.match(r.out, /처리한 동 \d+/);
    assert.ok(!r.out.includes(MARK));
  } finally { await stub.close(); }
});

// ---- (5) 오류 메시지에서 사업 관리번호 제거 ----

test("오류 메시지: 응답의 시군구가 요청한 구와 다르면 구·요청 위치만 남기고 관리번호·응답 값은 없다", async () => {
  const s = await setup();
  const stub = await startStub((c) => {
    const r = goodHandler(c);
    if (c.q.sigunguCd === "11140" && c.q.pageNo === "2") r.json.response.body.items.item[0][FIELDS.sigungu] = "99999-VALUE";
    return r;
  });
  try {
    const b = base(s, stub);
    const r = await run(b.env, b.args);
    assert.equal(r.code, 1);
    assert.match(r.out, /11140/);
    assert.ok(!r.out.includes(MARK), "사업 관리번호가 오류 메시지에 나옴");
    assert.ok(!r.out.includes("99999-VALUE"), "응답의 시군구 값이 나옴");
    assert.equal(await exists(path.join(s.out, "folded.json")), false);
  } finally { await stub.close(); }
});

test("호수 비숫자는 더 이상 오류가 아니다 - 호수 합에 0으로 기여하고 n에 센다, 수집은 계속된다(PREREG 호수)", async () => {
  const s = await setup();
  const stub = await startStub((c) => {
    const r = goodHandler(c);
    if (c.q.sigunguCd === "11140" && c.q.pageNo === "2") r.json.response.body.items.item[0][FIELDS.units] = "많음-VALUE";
    return r;
  });
  try {
    const b = base(s, stub);
    const r = await run(b.env, b.args);
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes("많음-VALUE"), "읽지 못한 원래 값이 나옴");
    assert.ok(!r.out.includes(MARK));
  } finally { await stub.close(); }
});

test("오류 메시지: 접기 단계(foldProjects)의 필드 오류에도 관리번호가 없다", () => {
  const bad = item("11110", 1);
  delete bad[FIELDS.units];
  assert.throws(() => foldProjects([bad]), (e) => /totHhldCnt/.test(e.message) && !e.message.includes(MARK));
});

test("오류 메시지: 항목이 든 본문이 한도·오류 진단에 미리보기로 실리지 않는다", async () => {
  const s = await setup();
  // 헤더가 없는 데이터 모양 응답: 본문 앞부분에 관리번호가 있다
  const stub = await startStub(() => ({ json: { body: { items: { item: [item("11110", 1)] } } } }));
  try {
    const b = base(s, stub);
    const r = await run(b.env, b.args);
    assert.notEqual(r.code, 0);
    assert.ok(!r.out.includes(MARK), "진단 미리보기에 관리번호가 나옴");
  } finally { await stub.close(); }
});

// ---- (2) 시험 호출 모드 ----

test("시험 호출: 한 구만 지정하면 그 구만 부른다(다른 구 호출이 있으면 낙제)", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    const r = await run(b.env, [...b.args, "--only-district", "11140"]);
    assert.equal(r.code, 0, r.out);
    assert.ok(stub.hits.length > 0);
    assert.ok(stub.hits.every((h) => h.q.sigunguCd === "11140"), "지정하지 않은 구를 불렀다");
    assert.equal(stub.hits.length, 4, "동 둘 x 2쪽");
    assert.match(r.out, /시험 호출/);
    assert.match(r.out, /처리한 동 2\b/);
    assert.ok(!r.out.includes(MARK));
  } finally { await stub.close(); }
});

test("시험 호출: 호출 수 상한을 넘기지 않고, 상한 도달은 정상 종료(요약만)다", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    const r = await run(b.env, [...b.args, "--only-district", "11110", "--max-calls", "3"]);
    assert.ok(stub.hits.length <= 3, `상한 3을 넘겨 ${stub.hits.length}번 불렀다`);
    assert.equal(stub.hits.length, 3);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /상한/);
    assert.match(r.out, /호출 3\b/);
    assert.match(r.out, /완료 아님|미완/);
  } finally { await stub.close(); }
});

test("시험 호출: 상한만 줘도(구 지정 없이) 상한을 넘기지 않는다", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    const r = await run(b.env, [...b.args, "--max-calls", "2"]);
    assert.equal(r.code, 0, r.out);
    assert.equal(stub.hits.length, 2);
  } finally { await stub.close(); }
});

test("시험 호출: folded.json도 out-dir도 원본(RAW_DIR)도 만들지 않는다", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    const r = await run({ ...b.env, BUILDINGHUB_RAW_DIR: s.raw }, [...b.args, "--only-district", "11110"]);
    assert.equal(r.code, 0, r.out);
    assert.equal(await exists(s.out), false, "out-dir을 만들었다");
    assert.equal(await exists(path.join(s.out, "folded.json")), false);
    assert.equal(await exists(s.raw), false, "시험 모드가 원본 폴더를 만들었다");
    assert.deepEqual((await readdir(s.dir)).sort(), ["bjdong.json"]);
  } finally { await stub.close(); }
});

test("시험 호출: 요약에 개수와 필드 이름뿐이고, 쪽 크기 확인용 수치가 있다", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    const r = await run(b.env, [...b.args, "--only-district", "11110"]);
    assert.match(r.out, /요청 쪽 크기 2\b/);
    assert.match(r.out, /한 쪽 최대 수신 항목 2\b/);
    assert.match(r.out, /누적 항목 8\b/);
    assert.match(r.out, new RegExp(FIELDS.id), "필드 이름은 남겨도 된다");
    assert.ok(!r.out.includes(MARK), "관리번호 값이 요약에 나옴");
  } finally { await stub.close(); }
});

test("시험 호출: 알 수 없는 구·잘못된 상한은 호출 없이 종료 1", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    for (const bad of [["--only-district", "99999"], ["--only-district", " "], ["--only-district", "1111"], ["--max-calls", "0"], ["--max-calls", "-3"], ["--max-calls", "abc"], ["--max-calls", " "]]) {
      const r = await run(b.env, [...b.args, ...bad]);
      assert.equal(r.code, 1, `${bad.join(" ")}: ${r.out}`);
    }
    assert.equal(stub.hits.length, 0);
  } finally { await stub.close(); }
});

test("시험 호출: 상한은 일 한도를 올리지 못한다(낮추기만)", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    const r = await run({ ...b.env, BUILDINGHUB_DAILY_LIMIT: "2" }, [...b.args, "--max-calls", "1000"]);
    assert.equal(stub.hits.length, 2, "일 한도 2를 넘어 불렀다");
    assert.equal(r.code, 3, "일 한도 도달은 시험 상한 도달과 달리 실패 종료");
  } finally { await stub.close(); }
});

test("시험 호출이 아니면(옵션 없음) 이전과 같이 folded.json을 쓴다", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const b = base(s, stub);
    const r = await run(b.env, b.args);
    assert.equal(r.code, 0, r.out);
    assert.equal(await exists(path.join(s.out, "folded.json")), true);
  } finally { await stub.close(); }
});

// ---- (6) 한도 상수 ----

test("일 한도 상수는 그대로 5000이다(소유자 조건 5, 올리는 변경이 아니다)", () => {
  assert.equal(DAILY_LIMIT, 5000);
});

// ---- (3) 쪽 크기 가정은 그대로(상향을 구현하지 않는다) ----

test("쪽 크기: 기본 100을 유지하고 spec에 사실/추정 구분이 적혀 있다", async () => {
  assert.equal(PAGE_SIZE, 100);
  const spec = await readFile(path.resolve(import.meta.dirname, "../scripts/housing-permits-spec.mjs"), "utf8");
  assert.match(spec, /\[사실\]/);
  assert.match(spec, /\[추정\]/);
});
