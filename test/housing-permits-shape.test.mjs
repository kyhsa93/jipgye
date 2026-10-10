import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { FIELDS, LICENSE } from "../scripts/housing-permits-spec.mjs";
import * as fold from "../scripts/housing-permits-fold.mjs";
import { realItem } from "./helpers/housing-permits-items.mjs";
import { DISTRICTS } from "../scripts/realestate-districts.mjs";

// 응답 모양 오류(ShapeError) 때의 진단 출력 (#133 남은 항목, #141). 첫 시험 호출(run 38025773084)이
// "mgmPmsrgstPk 없음"(옛 가정 이름)으로 멈췄는데 실제 필드 이름이 로그에 없어 무엇이 맞는지 알 수 없었다.
// 규칙: 필드 이름(키)·개수·타입 이름만 남기고 값은 한 글자도 안 된다. 전부 합성 응답과 로컬 스텁이다.
// 값 자리에는 VAL_ 로 시작하는 표지를 넣는다 - 출력 어디에 나와도 낙제다.

const VAL = "VAL_9f3a1c";
const KEY = "AbCdEfGh1234zzQq";
const script = path.resolve(import.meta.dirname, "../scripts/fetch-housing-permits.mjs");
const execFileAsync = promisify(execFile);
const D = FIELDS.dates;

/** 가정한 이름이 전부 틀린 응답 항목: 다른 이름 + 값은 표지 문자열. */
function wrongItem(n, extra = {}) {
  return { realPk: `${VAL}-pk-${n}`, bizName: `${VAL}-사업명-${n}`, addr: `${VAL}-서울 종로구 어딘가`, owner: `${VAL}-홍길동`, hhld: 12, nested: { a: VAL }, list: [VAL], empty: null, ...extra };
}
const envelope = (items, extra = {}) => ({
  response: { header: { resultCode: "00", resultMsg: `${VAL}-msg` }, body: { items: { item: items }, totalCount: items.length, pageNo: 1, ...extra } },
});
function goodItem(sgg, n, extra = {}) {
  // 실제 응답 모양(30개 키)이고, 값이 있는 자리(관리번호·사업명·주소)에는 표지를 넣는다.
  return realItem({ mgmHsrgstPk: `${VAL}-${sgg}-${n}`, bldNm: `${VAL}-bld`, platPlc: `${VAL}-addr`, sigunguCd: sgg, totHhldCnt: 10, ...extra });
}

function startStub(handler) {
  const hits = [];
  const server = createServer((req, res) => {
    const q = Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
    hits.push(q);
    const out = handler({ q, hits });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${server.address().port}/stub`, hits, close: () => new Promise((d) => server.close(d)) })));
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "housing-shape-"));
  const bjdong = path.join(dir, "bjdong.json");
  await writeFile(bjdong, JSON.stringify(Object.fromEntries(DISTRICTS.map((d) => [d.code, ["10100"]]))));
  return { bjdong, out: path.join(dir, "out") };
}

async function run(stub, s, extraArgs = []) {
  const env = { PATH: process.env.PATH, BUILDINGHUB_RETRY_MS: "0", BUILDINGHUB_PAGE_SIZE: "5", BUILDINGHUB_API_KEY: KEY, BUILDINGHUB_API_ENDPOINT: stub.base };
  const args = [script, "--bjdong-file", s.bjdong, "--out-dir", s.out, "--license", LICENSE.text, "--page-modified", "2026-09-01", "--collected-at", "2026-10-10T00:00:00.000Z", ...extraArgs];
  try {
    const r = await execFileAsync(process.execPath, args, { env, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "", all: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

// 응답 값 어느 것도 나오면 안 된다
const FORBIDDEN = [VAL, "홍길동", "서울 종로구 어딘가", "사업명", KEY];
function assertNoValues(text) {
  for (const f of FORBIDDEN) assert.ok(!text.includes(f), `값 문자열 "${f}"이 출력에 나옴`);
}

// ---- 핵심: 필드 이름이 틀린 첫 시험 호출 상황 ----

test("필드 이름 불일치: stderr에 envelope 키·첫 항목 키(정렬)·항목 수·타입 이름이 나오고 값은 없다", async () => {
  const s = await setup();
  const stub = await startStub(() => envelope([wrongItem(1), wrongItem(2), wrongItem(3)]));
  try {
    const r = await run(stub, s, ["--only-district", "11110", "--max-calls", "3"]);
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /mgmHsrgstPk 없음/, "기존 메시지 꼴은 유지(새 id 이름)");
    // 첫 항목 키: 정렬돼 있고 타입 이름이 붙는다
    const keys = ["addr", "bizName", "empty", "hhld", "list", "nested", "owner", "realPk"];
    let at = -1;
    for (const k of keys) {
      const i = r.stderr.indexOf(k, at + 1);
      assert.ok(i > at, `키 ${k}가 없거나 정렬 순서가 아님`);
      at = i;
    }
    assert.match(r.stderr, /realPk\(문자열\)/);
    assert.match(r.stderr, /hhld\(숫자\)/);
    assert.match(r.stderr, /nested\(객체\)/);
    assert.match(r.stderr, /list\(배열\)/);
    assert.match(r.stderr, /empty\(null\)/);
    // envelope 구조 이름
    for (const name of ["response", "header", "body", "items", "resultCode", "resultMsg", "totalCount"]) {
      assert.ok(r.stderr.includes(name), `envelope 키 ${name}가 없음`);
    }
    assert.match(r.stderr, /항목 3개/);
    assertNoValues(r.all);
    assert.ok(!r.all.includes("00)"), "resultCode 값이 나옴");
  } finally { await stub.close(); }
});

test("필드 이름 불일치: 쓰기 없이 종료 1이고 출력 형식은 시험 호출 요약의 필드 이름 줄과 같다", async () => {
  const s = await setup();
  const bad = await startStub(() => envelope([wrongItem(1)]));
  const good = await startStub(({ q }) => envelope([goodItem(q.sigunguCd, 1)]));
  try {
    const rb = await run(bad, s, ["--only-district", "11110"]);
    const rg = await run(good, s, ["--only-district", "11110"]);
    assert.equal(rb.code, 1);
    assert.equal(rg.code, 0, rg.all);
    // 두 경로 모두 같은 접두어의 줄을 낸다
    for (const r of [rb, rg]) {
      assert.match(r.all, /응답 구조 키:/);
      assert.match(r.all, /첫 항목 키 \d+개:/);
      assert.match(r.all, /항목 \d+개/);
      assert.match(r.all, /응답 필드 이름:/);
    }
    // 같은 응답 모양이면 같은 줄이 나온다(구조 줄은 한 글자도 다르지 않다)
    const line = (r) => r.all.split("\n").find((l) => l.includes("응답 구조 키:")).replace(/^\[[^\]]+\]\s*/, "");
    assert.equal(line(rb), line(rg));
    assertNoValues(rg.all);
  } finally { await bad.close(); await good.close(); }
});

// ---- 값이 키로 위장한 경우 ----

test("키 자리의 비정형 문자열은 <비정형 키>로 바뀌고 원문은 나오지 않는다", async () => {
  const s = await setup();
  const disguised = [
    `${VAL}-관리번호`, "홍길동 건설", "서울 종로구 청운동 1-2", "1234567890", "9abc", "a b", "a-b", "a.b", "",
    "a".repeat(80), `x${KEY}`, // 키 원문이 이름 안에 든 경우도 영문숫자라 패턴은 통과하나 마스킹 뒤에는 *** 가 되어 걸러져야 한다
  ];
  const item = { realPk: "v", ...Object.fromEntries(disguised.map((k) => [k, "v"])) };
  const stub = await startStub(() => envelope([item]));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /<비정형 키>/);
    assert.ok(r.stderr.includes("realPk"));
    assertNoValues(r.all);
    for (const k of disguised.filter((k) => k.length > 0 && k !== `x${KEY}`)) assert.ok(!r.all.includes(k), `위장 키 "${k.slice(0, 20)}"가 나옴`);
    assert.ok(!r.all.includes("a".repeat(41)), "긴 키가 잘리지 않고 나옴");
    assert.ok(!r.all.includes(`x${KEY}`) && !r.all.includes("***bcd"), "마스킹 전 키가 나옴");
  } finally { await stub.close(); }
});

test("키 개수 상한: 항목 키가 200개여도 이름은 상한 개수만 나오고 나머지는 개수로만 적힌다", async () => {
  const s = await setup();
  const item = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field${String(i).padStart(3, "0")}`, "v"]));
  const stub = await startStub(() => envelope([item]));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.equal(r.code, 1, r.all);
    const names = new Set(r.stderr.match(/field\d{3}/g) ?? []);
    assert.ok(names.size > 0 && names.size <= 60, `이름 ${names.size}개 - 상한을 넘음`);
    assert.match(r.stderr, /첫 항목 키 200개/, "전체 개수는 적는다");
    assert.match(r.stderr, /외 \d+개/);
    assert.ok(r.stderr.length < 20_000, "출력 크기 상한");
  } finally { await stub.close(); }
});

test("envelope 키가 많거나 위장돼도(헤더·본문 키) 같은 규칙이 적용된다", async () => {
  const s = await setup();
  const body = { items: { item: [wrongItem(1)] }, totalCount: 1, [`${VAL} 본문`]: "v", "홍길동": "v" };
  for (let i = 0; i < 100; i += 1) body[`b${String(i).padStart(3, "0")}`] = "v";
  const stub = await startStub(() => ({ response: { header: { resultCode: "00", resultMsg: "m", [`${VAL}-헤더`]: "v" }, body } }));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.equal(r.code, 1, r.all);
    assertNoValues(r.all);
    assert.match(r.stderr, /<비정형 키>/);
    assert.ok(new Set(r.stderr.match(/b\d{3}/g) ?? []).size <= 60);
  } finally { await stub.close(); }
});

// ---- 마스킹이 자르기보다 먼저 ----

test("마스킹 순서: 키 이름에 든 인증키는 상한 경계에서도 앞부분이 남지 않는다(unit)", () => {
  assert.equal(typeof fold.listKeys, "function", "listKeys 필요");
  const SECRET = "SECRETKEY12345678";
  const mask = (t) => String(t).split(SECRET).join("***");
  // 정렬 뒤 상한 경계(마지막 자리)에 비밀이 든 이름이 놓이게 한다
  const keys = [...Array.from({ length: 70 }, (_, i) => `k${String(i).padStart(3, "0")}`), `zz${SECRET}`, SECRET];
  const out = fold.listKeys(keys, mask);
  assert.ok(!out.includes(SECRET));
  assert.ok(!out.includes("SECRETKEY"), "비밀의 앞부분이 남음");
  assert.ok(!out.includes("zz"), "비밀이 든 이름이 일부라도 나옴");
  assert.match(out, /<비정형 키>/);
});

test("마스킹 순서: 상한 안 이름이 비밀 일부와 겹쳐도 먼저 마스킹한 뒤 판정한다(unit)", () => {
  const SECRET = "SECRETKEY12345678";
  const mask = (t) => String(t).split(SECRET).join("***");
  const out = fold.listKeys([`a${SECRET}`, "ok_name"], mask);
  assert.ok(!out.includes("SECRET"));
  assert.ok(out.includes("ok_name"));
});

test("listKeys: 정렬·상한·비정형 개수 (unit)", () => {
  const mask = (t) => String(t);
  const keys = Array.from({ length: 100 }, (_, i) => `k${String(99 - i).padStart(2, "0")}`);
  const out = fold.listKeys([...keys, "한글", "a b"], mask);
  const shown = out.match(/k\d{2}/g);
  assert.ok(shown.length <= 60);
  assert.deepEqual(shown, [...shown].sort());
  assert.match(out, /외 \d+개/);
  assert.match(out, /<비정형 키> 2개/);
});

// ---- 다른 ShapeError 경로 ----

test("다른 ShapeError 경로(시군구 불일치)도 같은 필드 이름 진단을 내고 값(시군구 코드 포함)은 없다", async () => {
  const s = await setup();
  const stub = await startStub(() => envelope([goodItem("SGGVAL", 1)]));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /응답 구조 키:/);
    assert.match(r.stderr, /첫 항목 키/);
    assert.ok(!r.all.includes("SGGVAL"), "응답 값(시군구)이 나옴");
    assertNoValues(r.all);
  } finally { await stub.close(); }
});

test("호수(totHhldCnt)가 비숫자여도 멈추지 않는다 - 0으로 기여하고 n에 센다(PREREG). 건수만 나가고 값은 없다", async () => {
  const s = await setup();
  const stub = await startStub(({ q }) => envelope([goodItem(q.sigunguCd, 1, { [FIELDS.units]: `${VAL}-많음` })]));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /호수 0 0·비숫자 1/);
    assertNoValues(r.all);
  } finally { await stub.close(); }
});

test("항목이 객체가 아닌 응답(문자열 항목)은 값 없이 거절하고 첫 항목 키 줄은 '객체인 항목 없음'이다", async () => {
  const s = await setup();
  const stub = await startStub(() => envelope([`${VAL}-문자열항목`]));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /객체가 아님/);
    assert.match(r.stderr, /객체인 항목 없음/);
    assertNoValues(r.all);
  } finally { await stub.close(); }
});

test("전수 순회 뒤 접기 단계의 ShapeError(날짜 필드가 어느 항목에도 없음)도 같은 진단을 낸다", async () => {
  const s = await setup();
  const stub = await startStub(({ q }) => {
    const it = goodItem(q.sigunguCd, 1);
    delete it[D.start];
    return envelope([it]);
  });
  try {
    const r = await run(stub, s); // 전체 수집 모드
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /어느 항목에도 없음/);
    assert.match(r.stderr, /응답 구조 키:/);
    assert.match(r.stderr, /첫 항목 키/);
    assertNoValues(r.all);
  } finally { await stub.close(); }
});

test("항목이 없거나 객체가 아닌 응답도 진단은 타입 이름만 낸다", async () => {
  const s = await setup();
  const stub = await startStub(() => ({ response: { header: { resultCode: "00", resultMsg: "m" }, body: { items: VAL, totalCount: 1 } } }));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.notEqual(r.code, 0);
    assertNoValues(r.all);
  } finally { await stub.close(); }
});

test("정상 시험 호출 요약의 필드 이름 줄에도 같은 규칙(비정형 키 대체)이 적용된다", async () => {
  const s = await setup();
  const stub = await startStub(({ q }) => envelope([goodItem(q.sigunguCd, 1, { "홍길동 건설": "v", [`x${KEY}`]: "v" })]));
  try {
    const r = await run(stub, s, ["--only-district", "11110"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /<비정형 키>/);
    assert.ok(r.stdout.includes(FIELDS.id));
    assert.ok(!r.all.includes("홍길동"));
    assert.ok(!r.all.includes(KEY));
    assert.ok(!r.all.includes(VAL));
  } finally { await stub.close(); }
});
