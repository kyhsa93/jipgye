import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { FIELDS, OPERATION, SERIES } from "../scripts/housing-permits-spec.mjs";
import { foldProjects, parseDay } from "../scripts/housing-permits-fold.mjs";
import { DISTRICTS } from "../scripts/realestate-districts.mjs";
import { flawedFold } from "./helpers/housing-permits-mutants.mjs";

// 건축HUB 주택인허가 수집기 (#130, #58 단계 A). 전부 합성 입력이다 - 실제 API는 부르지 않는다.
// 필드·오퍼레이션 이름은 명세를 못 읽은 가정이라(housing-permits-spec.mjs) 시험도 FIELDS를 거쳐 쓴다.

const D = FIELDS.dates;
const project = ({ id, sgg = "11110", units = 0, permit = "", start = "", complete = "", cancel = "", version = "20240101" }) => ({
  [FIELDS.id]: id, [FIELDS.sigungu]: sgg, [FIELDS.units]: String(units),
  [D.permit]: permit, [D.start]: start, [D.complete]: complete,
  [FIELDS.cancel]: cancel, [FIELDS.version]: version,
});

// P1: 허가 2024-03, 착공 2024-06. 같은 사업이 변경 신고로 한 번 더 온다(최신 판이 120호).
// P2: 취소. P3: 허가일 없음(착공일은 있음). P4: 다른 구, 대시 날짜 꼴.
const FIXTURE = [
  project({ id: "P1", units: 100, permit: "20240315", start: "20240601", version: "20240315" }),
  project({ id: "P1", units: 120, permit: "20240315", start: "20240601", version: "20240420" }),
  project({ id: "P2", units: 50, permit: "20240320", cancel: "20240501" }),
  project({ id: "P3", units: 30, start: "20240710" }),
  project({ id: "P4", sgg: "11140", units: 10, permit: "2024-03-02" }),
];

/** 접기 정의 검사. 진짜는 통과하고, 낙제 사본은 던져야 한다. */
function checkFold(result) {
  const permit = result.series.permit;
  assert.deepEqual(permit["11110"]["2024-03"], { projects: 1, units: 120 }, "중복 사업은 최신 판 1건으로 센다");
  assert.deepEqual(permit["11140"]["2024-03"], { projects: 1, units: 10 });
  assert.equal(result.series.start["11110"]["2024-06"].units, 120);
  assert.deepEqual(result.series.start["11110"]["2024-07"], { projects: 1, units: 30 });
  assert.deepEqual(permit["11110"], { "2024-03": { projects: 1, units: 120 } }, "취소 사업은 어느 달에도 안 센다");
  assert.deepEqual(result.unknown.permit["11110"], { projects: 1, units: 30 }, "날짜 없는 사업은 미상 칸에 센다");
}

test("접기: 중복은 1건, 취소 제외, 호수 합, 월 귀속, 날짜 없음은 미상 칸", () => {
  const result = foldProjects(FIXTURE);
  checkFold(result);
  assert.equal(result.meta.input, 5);
  assert.equal(result.meta.projects, 3, "중복 제거·취소 제외 뒤 사업 수(P1·P3·P4)");
  assert.equal(result.meta.duplicates, 1);
  assert.equal(result.meta.cancelled, 1);
});

test("접기: 입력 순서가 바뀌어도 결과가 같다(결정성)", () => {
  assert.deepEqual(foldProjects([...FIXTURE].reverse()), foldProjects(FIXTURE));
});

test("접기: 변경 신고의 판 날짜가 같으면 입력에서 뒤에 온 것이 이긴다", () => {
  const a = project({ id: "X", units: 10, permit: "20240101", version: "20240201" });
  const b = project({ id: "X", units: 12, permit: "20240101", version: "20240201" });
  assert.equal(foldProjects([a, b]).series.permit["11110"]["2024-01"].units, 12);
});

test("접기: 최신 판이 취소면 그 사업은 빠진다(이전 판이 살아 있어도)", () => {
  const live = project({ id: "X", units: 10, permit: "20240101", version: "20240201" });
  const gone = project({ id: "X", units: 10, permit: "20240101", cancel: "20240301", version: "20240301" });
  const r = foldProjects([live, gone]);
  assert.deepEqual(r.series.permit, {});
  assert.equal(r.meta.cancelled, 1);
});

test("접기: 읽을 수 없는 날짜는 미상 칸(버리지 않는다), 달력에 없는 날짜도", () => {
  const r = foldProjects([
    project({ id: "A", units: 5, permit: "abc" }),
    project({ id: "B", units: 7, permit: "20241341" }),
  ]);
  assert.deepEqual(r.unknown.permit["11110"], { projects: 2, units: 12 });
  assert.equal(parseDay("2024-02-30"), null);
  assert.equal(parseDay("20240229"), "2024-02");
});

test("접기: 호수를 못 읽으면 쓰지 않고 실패한다", () => {
  assert.throws(() => foldProjects([project({ id: "A", units: "많음", permit: "20240101" })]), /호수/);
});

test("접기: 알 수 없는 필드(핵심 키 없음)면 실패한다 - 첫 실호출에서 가정이 틀린 경우", () => {
  const bad = { ...project({ id: "A", units: 1, permit: "20240101" }) };
  delete bad[FIELDS.units];
  assert.throws(() => foldProjects([bad]), new RegExp(`필드.*${FIELDS.units}`));
  const noSgg = { ...project({ id: "A", units: 1 }) };
  delete noSgg[FIELDS.sigungu];
  assert.throws(() => foldProjects([noSgg]), /필드/);
});

test("접기: 날짜·취소·판 필드는 전체에서 한 건도 없으면 실패(가정이 틀렸다는 뜻), 일부 비어 있는 건 정상", () => {
  const items = [project({ id: "A", units: 1, permit: "20240101" }), project({ id: "B", units: 1, permit: "20240201" })];
  const strip = (key) => items.map((it) => { const c = { ...it }; delete c[key]; return c; });
  for (const key of [D.permit, D.start, D.complete, FIELDS.cancel, FIELDS.version]) {
    assert.throws(() => foldProjects(strip(key)), /필드/, key);
  }
  // 한 건에서만 빠진 것은 API가 빈 값을 생략한 것으로 본다
  const partial = [...items];
  partial[1] = { ...items[1] }; delete partial[1][D.start];
  assert.doesNotThrow(() => foldProjects(partial));
});

test("낙제 시험 ①: 중복 사업을 두 번 센 사본은 빨강이다", () => {
  checkFold(flawedFold(FIXTURE)); // 기준선: 사본의 기본 옵션은 올바르다 - 옵션 하나가 실수 하나를 만든다
  assert.throws(() => checkFold(flawedFold(FIXTURE, { dedupe: false })));
});

test("낙제 시험 ②: 취소 사업을 포함한 사본은 빨강이다", () => {
  assert.throws(() => checkFold(flawedFold(FIXTURE, { dropCancelled: false })));
});

test("낙제 시험 ③: 날짜 없는 사업을 조용히 버린 사본은 빨강이다", () => {
  assert.throws(() => checkFold(flawedFold(FIXTURE, { keepUndated: false })));
});

test("SERIES는 사업승인·착공·사용승인 셋이고 FIELDS.dates와 같은 이름이다", () => {
  assert.deepEqual([...SERIES].sort(), Object.keys(D).sort());
  assert.equal(SERIES.length, 3);
});

// ---- 수집기 (자식 프로세스 + 스텁 서버) ----

const execFileAsync = promisify(execFile);
const script = path.resolve(import.meta.dirname, "../scripts/fetch-housing-permits.mjs");
const KEY_DECODED = "AbCdEfGh1234+/=zzQq";
const KEY_ENCODED = encodeURIComponent(KEY_DECODED);

function startStub(handler) {
  const hits = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const q = Object.fromEntries(url.searchParams);
    hits.push({ path: url.pathname, q });
    const out = handler({ path: url.pathname, q, hits });
    res.writeHead(out.status ?? 200, { "Content-Type": out.contentType ?? "application/json" });
    res.end(out.raw ?? JSON.stringify(out.json));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ base: `http://127.0.0.1:${server.address().port}/stub`, hits, close: () => new Promise((d) => server.close(d)) })));
}

const envelope = (items, totalCount, pageNo = 1) => ({
  response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: { items: { item: items }, totalCount, pageNo, numOfRows: 2 } },
});

/** 구마다 같은 4건(중복 포함)을 내는 정상 스텁. */
function goodHandler({ q }) {
  const sgg = q.sigunguCd;
  const items = [
    project({ id: `${sgg}-1`, sgg, units: 100, permit: "20240315", start: "20240601", version: "20240315" }),
    project({ id: `${sgg}-1`, sgg, units: 120, permit: "20240315", start: "20240601", version: "20240420" }),
    project({ id: `${sgg}-2`, sgg, units: 50, permit: "20240320", cancel: "20240501" }),
    project({ id: `${sgg}-3`, sgg, units: 30, start: "20240710" }),
  ];
  const page = Number(q.pageNo);
  const size = Number(q.numOfRows);
  return { json: envelope(items.slice((page - 1) * size, page * size), items.length, page) };
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "housing-"));
  const bjdong = path.join(dir, "bjdong.json");
  await writeFile(bjdong, JSON.stringify(Object.fromEntries(DISTRICTS.map((d) => [d.code, ["10100"]]))));
  return { dir, bjdong, out: path.join(dir, "out") };
}

async function run(env, args) {
  const clean = { PATH: process.env.PATH, BUILDINGHUB_RETRY_MS: "0", BUILDINGHUB_PAGE_SIZE: "2", ...env };
  try {
    const r = await execFileAsync(process.execPath, [script, ...args], { env: clean });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
const exists = (p) => access(p).then(() => true, () => false);

test("수집기: 키가 없으면 생략 로그만 남기고 정상 종료, 아무것도 쓰지 않고 네트워크도 안 쓴다", async () => {
  const s = await setup();
  const stub = await startStub(() => ({ json: {} }));
  try {
    const r = await run({ BUILDINGHUB_API_ENDPOINT: stub.base }, ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
    assert.equal(r.code, 0);
    assert.match(r.stdout + r.stderr, /BUILDINGHUB_API_KEY.*생략/);
    assert.equal(stub.hits.length, 0);
    assert.equal(await exists(s.out), false);
    const blank = await run({ BUILDINGHUB_API_KEY: "  \n", BUILDINGHUB_API_ENDPOINT: stub.base }, ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
    assert.equal(blank.code, 0, "공백뿐인 키도 없는 것으로 본다");
    assert.equal(stub.hits.length, 0);
  } finally { await stub.close(); }
});

for (const [label, key] of [["인코딩", KEY_ENCODED], ["디코딩", KEY_DECODED], ["공백·따옴표 낀 인코딩", ` "${KEY_ENCODED}"\n`]]) {
  test(`수집기: ${label} 키 형태 모두 같은 키로 보내고, 25구 전수 순회·페이지네이션·접기 결과를 쓴다`, async () => {
    const s = await setup();
    const stub = await startStub(goodHandler);
    try {
      const r = await run({ BUILDINGHUB_API_KEY: key, BUILDINGHUB_API_ENDPOINT: stub.base },
        ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(stub.hits.every((h) => h.path === `/stub/${OPERATION}`), "오퍼레이션 경로");
      assert.ok(stub.hits.every((h) => h.q.serviceKey === KEY_DECODED), "서버가 디코딩해 받은 키가 원래 키와 같다");
      assert.equal(new Set(stub.hits.map((h) => h.q.sigunguCd)).size, 25);
      assert.equal(stub.hits.length, 25 * 2, "구마다 4건을 2건씩 2쪽");
      assert.ok(stub.hits.every((h) => h.q.bjdongCd === "10100"));
      const file = JSON.parse(await readFile(path.join(s.out, "folded.json"), "utf8"));
      assert.deepEqual(file.series.permit["11110"]["2024-03"], { projects: 1, units: 120 });
      assert.deepEqual(file.unknown.permit["11680"], { projects: 1, units: 30 });
      assert.equal(file.meta.calls, 50);
      assert.match(file.meta.rawSha256, /^[0-9a-f]{64}$/);
      assert.ok(!JSON.stringify(file).includes(KEY_DECODED));
    } finally { await stub.close(); }
  });
}

test("수집기: 같은 입력이면 같은 파일을 쓴다(결정성)", async () => {
  const stub = await startStub(goodHandler);
  try {
    const texts = [];
    for (let i = 0; i < 2; i += 1) {
      const s = await setup();
      const r = await run({ BUILDINGHUB_API_KEY: KEY_ENCODED, BUILDINGHUB_API_ENDPOINT: stub.base }, ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
      assert.equal(r.code, 0, r.stderr);
      texts.push(await readFile(path.join(s.out, "folded.json"), "utf8"));
    }
    assert.equal(texts[0], texts[1]);
  } finally { await stub.close(); }
});

test("수집기: 한 구라도 실패하면 아무것도 쓰지 않고 실패 목록을 남긴다(종료 3)", async () => {
  const s = await setup();
  const stub = await startStub((c) => (c.q.sigunguCd === "11140" ? { status: 500, raw: "boom" } : goodHandler(c)));
  try {
    const r = await run({ BUILDINGHUB_API_KEY: KEY_ENCODED, BUILDINGHUB_API_ENDPOINT: stub.base }, ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /11140/);
    assert.match(r.stderr, /실패 1/);
    assert.equal(await exists(path.join(s.out, "folded.json")), false);
  } finally { await stub.close(); }
});

test("수집기: 응답 필드가 가정과 다르면 쓰지 않고 실패한다(종료 1)", async () => {
  const s = await setup();
  const stub = await startStub((c) => {
    const r = goodHandler(c);
    for (const it of r.json.response.body.items.item) delete it[FIELDS.units];
    return r;
  });
  try {
    const r = await run({ BUILDINGHUB_API_KEY: KEY_ENCODED, BUILDINGHUB_API_ENDPOINT: stub.base }, ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /필드/);
    assert.equal(await exists(path.join(s.out, "folded.json")), false);
  } finally { await stub.close(); }
});

test("수집기: 일 한도에 닿으면 중단하고 아무것도 쓰지 않는다(재시도도 호출로 센다)", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const r = await run({ BUILDINGHUB_API_KEY: KEY_ENCODED, BUILDINGHUB_API_ENDPOINT: stub.base, BUILDINGHUB_DAILY_LIMIT: "5" },
      ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /한도/);
    assert.equal(stub.hits.length, 5, "한도를 넘겨 부르지 않는다");
    assert.equal(await exists(path.join(s.out, "folded.json")), false);
  } finally { await stub.close(); }
});

test("수집기: 서버가 키를 본문에 에코해도 로그에 키가 남지 않는다(치환 먼저, 자르기는 그 뒤)", async () => {
  const s = await setup();
  // 200자 미리보기 경계에 키가 걸치게 한다. 자르기를 먼저 하면 키 앞부분이 남는다.
  const pad = "x".repeat(200 - 6);
  const stub = await startStub((c) => ({ status: 200, contentType: "text/html", raw: `${pad}${c.q.serviceKey} ${encodeURIComponent(c.q.serviceKey)}` }));
  try {
    const r = await run({ BUILDINGHUB_API_KEY: KEY_ENCODED, BUILDINGHUB_API_ENDPOINT: stub.base }, ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
    assert.equal(r.code, 3);
    const all = r.stdout + r.stderr;
    assert.ok(all.includes("본문 앞"), "진단 줄이 있다");
    for (const frag of [KEY_DECODED, KEY_ENCODED, KEY_DECODED.slice(0, 5), KEY_ENCODED.slice(0, 5)]) {
      assert.ok(!all.includes(frag), `키 조각이 로그에 남음: ${frag.slice(0, 3)}...`);
    }
  } finally { await stub.close(); }
});

test("수집기: 법정동 코드 목록이 없거나 25구를 다 담지 않으면 호출 없이 실패한다", async () => {
  const s = await setup();
  const stub = await startStub(goodHandler);
  try {
    const env = { BUILDINGHUB_API_KEY: KEY_ENCODED, BUILDINGHUB_API_ENDPOINT: stub.base };
    const none = await run(env, ["--bjdong-file", path.join(s.dir, "없음.json"), "--out-dir", s.out]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /법정동/);
    await writeFile(s.bjdong, JSON.stringify({ "11110": ["10100"] }));
    const part = await run(env, ["--bjdong-file", s.bjdong, "--out-dir", s.out]);
    assert.equal(part.code, 1);
    assert.equal(stub.hits.length, 0);
  } finally { await stub.close(); }
});
