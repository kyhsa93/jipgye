// K-apt 측정 스크립트 시험(#823). 실제 API를 부르지 않는다. 호출은 전부 이 파일 안의 스텁 서버로 간다.
//   node --test research/kapt-fill-2026-11/measure.test.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { allocate, ARTIFACT, classify, EXIT_STOPPED, foldDeals, guardReason, MAX_CALLS, MIN_DETAIL, normalizeJibun, overlap, parseParcels, sampleByDistrict, SERVICE, shapeOf } from "./measure.mjs";

const SCRIPT = path.join(import.meta.dirname, "measure.mjs");
// 초안을 .github/workflows/ 로 옮기면 그쪽을 본다.
const INSTALLED = path.resolve(import.meta.dirname, "../../.github/workflows/kapt-fill-measure.yml");
const WORKFLOW = readFileSync(existsSync(INSTALLED) ? INSTALLED : path.join(import.meta.dirname, "kapt-fill-measure.yml"), "utf8");
const KEY = "TESTKEY+secret/value==";

const code = (i) => `A${String(10000000 + i)}`;
const listRow = (i) => ({ bjdCode: i % 2 ? "1168010300" : "1135010500", kaptCode: code(i), kaptName: `비공개단지${i}`, as1: "서울특별시", as2: i % 2 ? "강남구" : "노원구", as3: i % 2 ? "수서동" : "상계동" });
const basisItem = (i) => ({
  kaptCode: code(i), kaptName: `비공개단지${i}`, bjdCode: listRow(i).bjdCode, kaptTel: "0212345678",
  kaptAddr: i % 2 ? `서울특별시 강남구 수서동 ${i} 비공개단지${i}` : `서울특별시 노원구 상계동 ${i} 비공개단지${i}`,
  kaptdaCnt: String(100 + i), hoCnt: 100 + i, kaptUsedate: "20040517",
});
const detailItem = (i) => (i % 2
  ? { kaptCode: code(i), kaptName: `비공개단지${i}`, subwayLine: "3호선", subwayStation: "수서역", kaptdWtimesub: "5~10분이내" }
  : { kaptCode: code(i), kaptName: `비공개단지${i}`, subwayLine: "", subwayStation: "", kaptdWtimesub: "" });
const ok = (body) => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, body } });
const gatewayError = (reason) => `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>${reason}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

/** 스텁 서버. handlers로 오퍼레이션별 응답을 바꾼다. 명세와 다른 키 파라미터·중복 키 전달은 400이다. */
async function withStub({ n = 6, handlers = {} }, fn) {
  const log = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const op = path.basename(url.pathname);
    const keyParam = op === "getAphusDtlInfoV5" ? "ServiceKey" : "serviceKey";
    log.push({ op, key: url.searchParams.get(keyParam), search: url.search });
    const reply = (status, body) => { res.statusCode = status; res.end(body); };
    if (url.searchParams.get(keyParam) !== KEY) return reply(400, "bad key param");
    const custom = handlers[op]?.(url, log.filter((c) => c.op === op).length);
    if (custom) return reply(custom[0], custom[1]);
    if (op === "getSidoAptList4") {
      if (url.searchParams.get("sidoCode") !== "11") return reply(400, "bad sido");
      const size = Math.min(Number(url.searchParams.get("numOfRows")), 2000);
      const page = Number(url.searchParams.get("pageNo"));
      const rows = Array.from({ length: n }, (_, i) => listRow(i)).slice((page - 1) * size, page * size);
      return reply(200, ok({ items: rows, numOfRows: String(size), pageNo: String(page), totalCount: String(n) }));
    }
    const i = Number(url.searchParams.get("kaptCode").slice(1)) - 10000000;
    if (op === "getAphusBassInfoV5") return reply(200, ok({ item: basisItem(i) }));
    if (op === "getAphusDtlInfoV5") return reply(200, ok({ item: detailItem(i) }));
    return reply(404, "no op");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, log);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "kapt-root-"));
  mkdirSync(path.join(root, "raw", "sale"), { recursive: true });
  const deal = (over) => ({ aptNm: "실거래이름", buildYear: 2010, cdealType: "", dealAmount: "100,000", dealDay: 5, dealMonth: 7, dealYear: 2026, dealingGbn: "중개거래", excluUseAr: 84.5, floor: 3, jibun: "1", sggCd: 11680, umdNm: "수서동", ...over });
  writeFileSync(path.join(root, "raw", "sale", "11680-202607.json"), JSON.stringify({ items: [
    deal({}), deal({ excluUseAr: 84.9 }), deal({ excluUseAr: 59 }), deal({ jibun: "3" }), deal({ jibun: "999" }), deal({ cdealType: "O" }),
    deal({ dealingGbn: "직거래", jibun: "5" }), deal({ jibun: "BL-1-2" }),
  ] }));
  return root;
}

function runFetch(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, "fetch", ...args], { env: { PATH: process.env.PATH, PUBLIC_DATA_PORTAL_API_KEY: KEY, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

async function fetchWith(base, { extra = [] } = {}) {
  const root = fixtureRoot();
  const out = mkdtempSync(path.join(tmpdir(), "kapt-out-"));
  const run = await runFetch(["--out", out, "--root", root, "--base-url", base, "--delay-ms", "0", "--retry-wait-ms", "0", ...extra]);
  const files = readdirSync(out);
  const all = files.map((f) => readFileSync(path.join(out, f), "utf8")).join("\n");
  const summary = files.includes("summary.json") ? JSON.parse(readFileSync(path.join(out, "summary.json"), "utf8")) : null;
  const artifact = files.includes("artifact-name") ? readFileSync(path.join(out, "artifact-name"), "utf8").trim() : null;
  rmSync(root, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  return { ...run, files, all, summary, artifact };
}

function assertNoSecret(result) {
  for (const needle of [KEY, encodeURIComponent(KEY)]) {
    assert.ok(!result.all.includes(needle), "파일에 키");
    assert.ok(!result.stdout.includes(needle), "stdout에 키");
    assert.ok(!result.stderr.includes(needle), "stderr에 키");
  }
}

// ── 순수 함수 ──

test("allocate: 서울 3,189단지면 상한 안이고 상세 표본이 하한 이상이다", () => {
  const plan = allocate(3189);
  assert.deepEqual([plan.basis, plan.detail], [3189, 1511]);
  assert.ok(plan.planned + plan.retryReserve <= MAX_CALLS[SERVICE.basis]);
  assert.ok(MAX_CALLS[SERVICE.basis] + MAX_CALLS[SERVICE.list] <= 5000, "두 서비스를 합쳐도 일 5,000 안");
});

test("allocate: 단지가 많아져도 상한을 넘지 않고, 적으면 전수다", () => {
  for (const n of [3300, 3301, 3336, 6000, 50000]) {
    const plan = allocate(n);
    assert.ok(plan.planned + plan.retryReserve <= MAX_CALLS[SERVICE.basis], String(n));
    assert.ok(plan.detail >= MIN_DETAIL, String(n));
  }
  assert.deepEqual(allocate(6), { basis: 6, detail: 6, planned: 12, retryReserve: 100 });
});

test("sampleByDistrict: 구별 비례, 결정적, 늘리면 표본이 늘기만 한다", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ kaptCode: code(i), bjdCode: i < 800 ? "1168010300" : "1135010500" }));
  const a = sampleByDistrict(rows, 100);
  assert.equal(a.length, 100);
  assert.equal(a.filter((r) => r.bjdCode.startsWith("11680")).length, 80);
  assert.deepEqual(sampleByDistrict([...rows].reverse(), 100).map((r) => r.kaptCode).sort(), a.map((r) => r.kaptCode).sort());
  const bigger = new Set(sampleByDistrict(rows, 300).map((r) => r.kaptCode));
  assert.ok(a.every((r) => bigger.has(r.kaptCode)));
});

test("normalizeJibun·parseParcels: 원본 지번과 K-apt 주소가 같은 꼴이 된다", () => {
  assert.equal(normalizeJibun("0072"), "72");
  assert.equal(normalizeJibun("652-0"), "652");
  assert.equal(normalizeJibun("12-03"), "12-3");
  assert.equal(normalizeJibun("산9-1"), "산9-1");
  assert.equal(normalizeJibun("10-"), "10");
  assert.equal(normalizeJibun("BL-1-2"), null);
  assert.equal(normalizeJibun("가-1"), null);
  assert.deepEqual(parseParcels("서울특별시 종로구 내수동 72 경희궁의아침3단지"), [{ dong: "내수동", jibun: "72" }]);
  assert.deepEqual(parseParcels("서울특별시 노원구 상계동 652,서울특별시 노원구 상계동 656 상계주공11단지"), [{ dong: "상계동", jibun: "652" }, { dong: "상계동", jibun: "656" }]);
  assert.deepEqual(parseParcels("서울특별시 중구 을지로3가 12-1, 13 어느단지"), [{ dong: "을지로3가", jibun: "12-1" }, { dong: "을지로3가", jibun: "13" }]);
  assert.deepEqual(parseParcels("서울특별시 강남구 수서동 산 9-1번지 단지"), [{ dong: "수서동", jibun: "산9-1" }]);
  assert.deepEqual(parseParcels("주소 없음"), []);
  assert.deepEqual(parseParcels(undefined), []);
});

test("classify: 인증·한도·규격·일시 오류를 가른다", () => {
  assert.equal(classify(401, "Unauthorized").kind, "auth");
  assert.equal(classify(403, "").kind, "auth");
  assert.equal(classify(429, "").kind, "quota");
  for (const reason of [20, 30, 31, 32, 33]) {
    const v = classify(200, gatewayError(reason));
    assert.deepEqual([v.kind, v.code, v.format], ["auth", reason, "xml"]);
  }
  assert.equal(classify(200, gatewayError(22)).kind, "quota");
  assert.equal(classify(200, gatewayError(12)).kind, "spec");
  assert.equal(classify(500, "Unauthorized").kind, "auth");
  assert.equal(classify(500, "Unexpected errors").kind, "transient");
  assert.equal(classify(200, ok({ item: {} })).kind, "ok");
  assert.equal(classify(200, "not json").kind, "other");
  assert.equal(classify(200, JSON.stringify({ response: { header: { resultCode: "03" } } })).kind, "nodata");
  assert.equal(classify(200, JSON.stringify({ response: { header: { resultCode: "99" } } })).kind, "other");
  assert.ok(!("msg" in classify(200, gatewayError(30))), "오류 원문을 돌려주지 않는다");
});

test("classify: 응답 모양 세 가지(items 배열·items.item·item)와 XML을 읽는다", () => {
  assert.equal(classify(200, ok({ items: [{ a: 1 }, { a: 2 }], totalCount: "2" })).items.length, 2);
  assert.equal(classify(200, ok({ items: { item: [{ a: 1 }] }, totalCount: 1 })).items.length, 1);
  assert.equal(classify(200, ok({ items: { item: { a: 1 } } })).items.length, 1);
  assert.equal(classify(200, ok({ item: { a: 1 } })).items.length, 1);
  assert.equal(classify(200, ok({ items: "" })).items.length, 0);
  const xml = classify(200, "<response><header><resultCode>00</resultCode></header><body><item><kaptdaCnt>0150</kaptdaCnt></item></body></response>");
  assert.deepEqual([xml.kind, xml.format, xml.items[0].kaptdaCnt], ["ok", "xml", "0150"]);
});

test("shapeOf: 글자를 지우고 구분자를 남긴다", () => {
  assert.equal(shapeOf("2호선, 분당선"), "9가, 가");
  assert.equal(shapeOf("수서역"), "가");
  assert.equal(shapeOf("KTX"), "A");
});

test("guardReason: 재실행·이미 호출한 실행·값을 못 읽은 경우를 거부한다", () => {
  const base = { attempt: "1", done: "0", earlyStops: "0", resume: "no", resultExists: false };
  assert.equal(guardReason(base), null);
  assert.match(guardReason({ ...base, attempt: "2" }), /재실행/);
  assert.match(guardReason({ ...base, done: "1" }), /이미 호출한/);
  assert.match(guardReason({ ...base, resultExists: true }), /측정이 끝나/);
  assert.match(guardReason({ ...base, done: "" }), /읽지 못했다/);
  assert.match(guardReason({ ...base, earlyStops: undefined }), /읽지 못했다/);
  assert.match(guardReason({ ...base, earlyStops: "1" }), /resume_after_early_stop/);
  assert.equal(guardReason({ ...base, earlyStops: "1", resume: "yes" }), null);
  assert.match(guardReason({ ...base, earlyStops: "2", resume: "yes" }), /상한/);
});

test("foldDeals·overlap: 지번으로 겹침을 세고 한 지번 여러 코드를 따로 센다", () => {
  const root = fixtureRoot();
  const deals = foldDeals(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(deals.totals.rows, 8);
  assert.equal(deals.totals.live, 7, "해제 표시 제외");
  assert.equal(deals.totals.market, 6, "직거래 제외");
  assert.equal(deals.totals.unparsedJibun, 1);
  const { summary, dealsByCode } = overlap(deals, [
    { code: "A", district: "11680", parcels: [{ dong: "수서동", jibun: "1" }] },
    { code: "B", district: "11680", parcels: [{ dong: "수서동", jibun: "3" }] },
    { code: "C", district: "11680", parcels: [{ dong: "수서동", jibun: "3" }] },
    { code: "D", district: "11350", parcels: [{ dong: "상계동", jibun: "1" }] },
    { code: "E", district: "11680", parcels: [] },
  ]);
  assert.equal(summary.hit.live, 4);
  assert.equal(summary.hit.keys, 2);
  assert.equal(summary.hit.cells, 3, "84.5·84.9는 한 칸, 59는 따로, 지번 3 한 칸");
  assert.equal(summary.hit.ambiguousParcels, 1);
  assert.equal(summary.hit.ambiguousLive, 1);
  assert.deepEqual(summary.kapt, { complexes: 5, addressParsed: 4, matchedAnyDeal: 3 });
  assert.equal(dealsByCode.get("A"), 3);
  assert.equal(dealsByCode.get("B"), undefined, "여러 코드 지번은 가중에서 뺀다");
});

// ── 스텁 호출 ──

test("fetch 정상: 요약만 남기고 키·단지 행을 쓰지 않으며 명세대로 부른다", async () => {
  await withStub({ n: 6 }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.artifact, ARTIFACT.done);
    assert.deepEqual(r.summary.calls, { [SERVICE.list]: 1, [SERVICE.basis]: 12 });
    assert.equal(log.length, 13);
    assert.ok(log.every((c) => c.key === KEY), "키가 한 번만 인코딩돼 그대로 도착한다");
    const { basis, detail, overlap: o } = r.summary.result;
    assert.equal(basis.ok, 6);
    assert.equal(basis.kaptdaCnt.filled, 6);
    assert.equal(basis.hhldCntFilled, 0, "명세에 없는 필드는 0으로 드러난다");
    assert.equal(basis.kaptUsedate.yyyymmdd, 6);
    assert.equal(detail.ok, 6);
    assert.equal(detail.filled.time, 3);
    assert.equal(detail.filled.all, 3);
    assert.deepEqual(detail.kaptdWtimesub.top, [["5~10분이내", 3]]);
    assert.deepEqual(detail.subwayStation.shapes.top, [["가", 3]]);
    assert.equal(o.denominators.live, 7);
    assert.equal(o.hit.parcels, 3, "수서동 1·3·5");
    assert.equal(o.hit.live, 5, "지번 1 세 건 + 3 한 건 + 5 직거래 한 건");
    assert.equal(detail.dealWeighted.dealsInSample, 5);
    assert.equal(detail.dealWeighted.dealsFilled, 5);
    assertNoSecret(r);
    assert.doesNotMatch(r.all, /비공개단지|A1000000|0212345678|수서역|apis\.data\.go\.kr|127\.0\.0\.1/, "단지별 행·주소가 파일에 없다");
    assert.deepEqual(r.files.sort(), ["artifact-name", "fetch-started.json", "result.out", "summary.json"]);
  });
});

test("인증 오류(HTTP 401): 첫 호출에서 멈추고 다시 시도하지 않으며 그 사실만 남긴다", async () => {
  const handlers = { getSidoAptList4: () => [401, "Unauthorized"] };
  await withStub({ handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(log.length, 1);
    assert.equal(r.artifact, ARTIFACT.earlyStop);
    assert.equal(r.summary.stop.kind, "auth");
    assert.equal(r.summary.stop.info.httpStatus, 401);
    assert.equal(r.summary.result, null);
    assert.match(r.stdout, /다시 시도하지 않는다/);
    assertNoSecret(r);
  });
});

test("인증 오류(HTTP 200 + 코드 30): 같은 키로도 다른 키로도 다시 부르지 않는다", async () => {
  const handlers = { getSidoAptList4: () => [200, gatewayError(30)] };
  await withStub({ handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(log.length, 1);
    assert.equal(r.summary.stop.info.code, 30);
    assert.doesNotMatch(r.all, /SERVICE_KEY_IS_NOT_REGISTERED/, "오류 원문을 쓰지 않는다");
  });
});

test("15058453만 승인 안 됨: 확인 호출 한 건에서 멈춘다(전수에 들어가지 않는다)", async () => {
  const handlers = { getAphusBassInfoV5: () => [200, gatewayError(20)] };
  await withStub({ n: 6, handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(r.artifact, ARTIFACT.earlyStop);
    assert.deepEqual(r.summary.calls, { [SERVICE.list]: 1, [SERVICE.basis]: 1 });
    assert.equal(r.summary.stop.info.service, SERVICE.basis);
    assert.equal(log.filter((c) => c.op === "getAphusDtlInfoV5").length, 0);
    assert.equal(r.summary.result, null);
  });
});

test("상세 오퍼레이션만 인증 오류: 기본 전수 전에 멈춘다", async () => {
  const handlers = { getAphusDtlInfoV5: () => [403, "Forbidden"] };
  await withStub({ n: 6, handlers }, async (base) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.deepEqual(r.summary.calls, { [SERVICE.list]: 1, [SERVICE.basis]: 2 });
    assert.equal(r.artifact, ARTIFACT.earlyStop);
  });
});

test("호출 상한: 단지가 6,000개여도 서비스 상한을 넘지 않는다", async () => {
  await withStub({ n: 6000 }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, 0, r.stderr);
    const detailCalls = log.filter((c) => c.op !== "getSidoAptList4").length;
    assert.ok(detailCalls <= MAX_CALLS[SERVICE.basis], String(detailCalls));
    assert.equal(detailCalls, 4700);
    assert.equal(log.filter((c) => c.op === "getSidoAptList4").length, 6);
    assert.equal(r.summary.result.basis.ok, 3300);
    assert.equal(r.summary.result.detail.ok, 1400);
  });
});

test("호출 상한: 일시 오류가 이어져도 서버가 받는 호출이 상한을 넘지 않는다", async () => {
  const handlers = { getAphusDtlInfoV5: (_url, nth) => (nth === 1 || nth % 2 === 0 ? null : [500, "x"]) };
  await withStub({ n: 3300, handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.ok(log.filter((c) => c.op !== "getSidoAptList4").length <= MAX_CALLS[SERVICE.basis]);
    assert.equal(r.summary.stop?.kind, "budget");
    assert.equal(r.code, 0, "일부 결과를 남기고 끝난다");
  });
});

test("호출 상한: 목록 페이지가 작아 상한 안에 다 못 받으면 단지 호출 없이 멈춘다", async () => {
  const handlers = { getSidoAptList4: (url) => [200, ok({ items: [listRow(Number(url.searchParams.get("pageNo")))], totalCount: "5000" })] };
  await withStub({ handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(log.length, MAX_CALLS[SERVICE.list]);
    assert.equal(r.summary.stop.kind, "list-incomplete");
    assert.equal(r.artifact, ARTIFACT.earlyStop);
  });
});

test("한도 코드(22): 전수 중간에 만나면 곧바로 멈추고 그때까지 요약을 남긴다", async () => {
  const handlers = { getAphusBassInfoV5: (_url, nth) => (nth === 3 ? [200, gatewayError(22)] : null) };
  await withStub({ n: 6, handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, 0);
    assert.equal(r.artifact, ARTIFACT.done, "호출이 이미 나가 다음 dispatch를 막는다");
    assert.equal(r.summary.stop.kind, "quota");
    assert.equal(r.summary.result.basis.ok, 2);
    assert.equal(log.filter((c) => c.op === "getAphusBassInfoV5").length, 3);
    assert.equal(log.filter((c) => c.op === "getAphusDtlInfoV5").length, 1);
  });
});

test("전수 중 인증 오류: 멈추고 실패로 끝나되 다음 dispatch를 막는다", async () => {
  const handlers = { getAphusBassInfoV5: (_url, nth) => (nth === 3 ? [401, "Unauthorized"] : null) };
  await withStub({ n: 6, handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(r.artifact, ARTIFACT.done);
    assert.equal(log.filter((c) => c.op === "getAphusBassInfoV5").length, 3);
  });
});

test("일시 오류: 한 번만 다시 부르고, 10건 연속 실패면 멈춘다", async () => {
  const once = { getAphusBassInfoV5: (_url, nth) => (nth === 2 ? [500, "x"] : null) };
  await withStub({ n: 6, handlers: once }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, 0);
    assert.equal(r.summary.result.basis.ok, 6);
    assert.equal(log.filter((c) => c.op === "getAphusBassInfoV5").length, 7);
  });
  const always = { getAphusBassInfoV5: (_url, nth) => (nth === 1 ? null : [500, "x"]) };
  await withStub({ n: 40, handlers: always }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.summary.stop.kind, "failed-in-a-row");
    // 확인 1건 + (detail 확인 뒤) 10단지 × 2회
    assert.equal(log.filter((c) => c.op === "getAphusBassInfoV5").length, 21);
    assert.equal(r.summary.result.basis.failed, 10);
  });
});

test("시간 상한: 넘으면 멈추고 요약을 남긴다", async () => {
  await withStub({ n: 50 }, async (base) => {
    const r = await fetchWith(base, { extra: ["--deadline-ms", "0"] });
    assert.equal(r.summary.stop.kind, "deadline");
    assert.deepEqual(r.summary.calls, { [SERVICE.list]: 0, [SERVICE.basis]: 0 });
  });
});

test("서울이 아닌 행이 오면 단지 호출 없이 멈춘다", async () => {
  const handlers = { getSidoAptList4: () => [200, ok({ items: [{ ...listRow(1), as1: "부산광역시" }], totalCount: "1" })] };
  await withStub({ handlers }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.summary.stop.kind, "list-not-seoul");
    assert.equal(log.length, 1);
  });
});

test("거부: 키 없음·저장소 안 출력·루프백 아닌 주소는 호출 전에 끝난다", async () => {
  await withStub({}, async (base, log) => {
    const root = fixtureRoot();
    const out = mkdtempSync(path.join(tmpdir(), "kapt-out-"));
    const noKey = await runFetch(["--out", out, "--root", root, "--base-url", base], { PUBLIC_DATA_PORTAL_API_KEY: "" });
    assert.equal(noKey.code, 2);
    const inside = await runFetch(["--out", path.join(root, "x"), "--root", root, "--base-url", base]);
    assert.equal(inside.code, 2);
    const repo = await runFetch(["--out", path.join(import.meta.dirname, "x"), "--root", root, "--base-url", base]);
    assert.equal(repo.code, 2);
    const remote = await runFetch(["--out", out, "--root", root, "--base-url", "https://example.com"]);
    assert.equal(remote.code, 2);
    const fastReal = await runFetch(["--out", out, "--root", root, "--delay-ms", "0"]);
    assert.equal(fastReal.code, 2, "실제 주소에는 시험용 인자를 못 쓴다");
    assert.equal(log.length, 0);
    assert.deepEqual(readdirSync(out), []);
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
});

// ── 워크플로 초안 ──

test("워크플로: dispatch 전용, 읽기 권한, 액션 SHA 고정, 쓰기 스텝 없음", () => {
  assert.match(WORKFLOW, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(WORKFLOW, /schedule:|pull_request|\n  push:/);
  assert.match(WORKFLOW, /permissions:\n  contents: read\n  actions: read\n\n/);
  assert.doesNotMatch(WORKFLOW, /git (commit|push|add)|contents: write/);
  for (const m of WORKFLOW.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  assert.match(WORKFLOW, /persist-credentials: false/);
});

test("워크플로: 시크릿은 PUBLIC_DATA_PORTAL_API_KEY 하나, 측정 스텝 env에만 있다", () => {
  assert.deepEqual([...WORKFLOW.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]), ["PUBLIC_DATA_PORTAL_API_KEY"]);
  const steps = WORKFLOW.split(/\n      - /);
  const withSecret = steps.filter((s) => s.includes("secrets."));
  assert.equal(withSecret.length, 1);
  assert.match(withSecret[0], /^name: 측정/);
  assert.match(withSecret[0], /measure\.mjs fetch --out "\$RUNNER_TEMP\/kapt-fill"/);
});

test("워크플로: 재실행 거부가 호출보다 먼저고, 입력은 run에 직접 박히지 않는다", () => {
  assert.ok(WORKFLOW.indexOf("name: 재실행 거부") < WORKFLOW.indexOf("name: 측정"));
  assert.match(WORKFLOW, /measure\.mjs guard --attempt "\$GITHUB_RUN_ATTEMPT"/);
  for (const name of Object.values(ARTIFACT)) assert.ok(WORKFLOW.includes(`artifacts?name=${name}"`), name);
  for (const block of WORKFLOW.split(/\n\s+run: \|?\n?/).slice(1)) assert.doesNotMatch(block.split("\n      - ")[0].split(/\n\s*\n/)[0], /\$\{\{/);
});
