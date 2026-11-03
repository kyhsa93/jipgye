// 서울 좌표 측정 스크립트 시험(#847). 실제 API를 부르지 않는다. 호출은 전부 이 파일 안의 스텁 서버로 간다.
//   node --test research/seoul-coords-2026-11/measure.test.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT, ATTRIBUTION, buildIndex, classify, coordShape, EXIT_LEAK, EXIT_STOPPED, foldRent, foldSale, guardReason, hist, leaksKey, MAX_CALLS, measureOverlap, normalizeName, parseRoad, PATH_NAMES, quantiles, readCoord, rentRoadKey, safeErrorName, SERVICE, shapeOf, spreadBucket, windowCells } from "./measure.mjs";

const SCRIPT = path.join(import.meta.dirname, "measure.mjs");
const WORKFLOW = readFileSync(path.resolve(import.meta.dirname, "../../.github/workflows/seoul-coords-measure.yml"), "utf8");
const SOURCE = readFileSync(SCRIPT, "utf8");
const KEY = "TESTKEY+secret/value==0123456789abcdef";
const NOW = "2026-08-01T00:00:00Z";

// 저장되면 안 되는 값들. 출력 어디에도 없어야 한다.
const SECRET_VALUES = ["비공개단지", "0212345678", "0212345679", "EPIS12345", "127.123456", "37.654321", "127.123789", "37.654888", "역이름비공개"];

const aptRow = (over) => ({ SN: "1", APT_CD: "A10000000", APT_NM: "비공개단지", CMPX_CLSF: "아파트", APT_STDG_ADDR: "", APT_RDN_ADDR: "", CTPV_ADDR: "서울특별시", SGG_ADDR: "강남구", EMD_ADDR: "수서동", DADDR: "", RDN_ADDR: "", ROAD_DADDR: "", TELNO: "0212345678", FXNO: "0212345679", EPIS_MNG_NO: "EPIS12345", TNOHSH: "100", USE_APRV_YMD: "20040517", USE_YN: "Y", SE_CD: "2", XCRD: "127.100100", YCRD: "37.500100", MDFCN_YMD: "20250101", ...over });

/** 지번·도로명·여러 코드·좌표 없음·안 붙음이 한 번씩 나오는 고정 행. 여기에 빈 행을 덧대 쪽수를 만든다. */
const FIXED = [
  aptRow({ APT_CD: "A10000001", DADDR: "1 비공개단지", XCRD: "127.123456", YCRD: "37.654321" }),
  aptRow({ APT_CD: "A10000002", APT_RDN_ADDR: "서울특별시 강남구 광평로 10 (수서동, 비공개단지)", XCRD: "127.123789", YCRD: "37.654888" }),
  aptRow({ APT_CD: "A10000003", DADDR: "5", XCRD: "127.200000", YCRD: "37.500000" }),
  aptRow({ APT_CD: "A10000004", DADDR: "5", XCRD: "127.200100", YCRD: "37.500100" }),
  aptRow({ APT_CD: "A10000005", DADDR: "9", XCRD: "", YCRD: "" }),
];
const filler = (i) => aptRow({ APT_CD: `A2${String(i).padStart(7, "0")}`, EMD_ADDR: "다른동", DADDR: `${1000 + i}`, TNOHSH: String(i) });
const aptRows = (n) => [...FIXED, ...Array.from({ length: Math.max(0, n - FIXED.length) }, (_, i) => filler(i))].slice(0, n);
const STATIONS = [
  { BLDN_ID: "0001", BLDN_NM: "역이름비공개", ROUTE: "3호선", LAT: "37.5001", LOT: "127.1001" },
  { BLDN_ID: "0002", BLDN_NM: "역이름비공개2", ROUTE: "수인분당선", LAT: "127.2001", LOT: "37.5001" },
  { BLDN_ID: "0003", BLDN_NM: "역이름비공개3", ROUTE: "3호선", LAT: "", LOT: "" },
];
const okBody = (service, total, rows) => JSON.stringify({ [service]: { list_total_count: total, RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" }, row: rows } });
const errBody = (code, message) => JSON.stringify({ RESULT: { CODE: code, MESSAGE: message } });

/** 스텁 서버. 경로는 명세대로 /키/json/서비스/시작/끝/. 한 번에 1,000건을 넘으면 ERROR-336이다. */
async function withStub({ apt = 2500, handlers = {} } = {}, fn) {
  const log = [];
  const server = createServer((req, res) => {
    const parts = req.url.split("/").filter(Boolean);
    const [key, type, service, start, end] = parts;
    log.push({ url: req.url, key: decodeURIComponent(key ?? ""), type, service, start: Number(start), end: Number(end) });
    const reply = (status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
    const custom = handlers[service]?.(log.filter((c) => c.service === service).length, req.url);
    if (custom) return reply(...custom);
    if (decodeURIComponent(key ?? "") !== KEY) return reply(200, errBody("INFO-100", "인증키가 유효하지 않습니다"));
    if (type !== "json") return reply(200, errBody("ERROR-301", "파일타입"));
    if (Number(end) - Number(start) > 1000) return reply(200, errBody("ERROR-336", "1000건"));
    if (service === SERVICE.apt) return reply(200, okBody(service, apt, aptRows(apt).slice(Number(start) - 1, Number(end))));
    if (service === SERVICE.station) return reply(200, okBody(service, STATIONS.length, STATIONS.slice(Number(start) - 1, Number(end))));
    return reply(200, errBody("ERROR-310", "서비스 없음"));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, log);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "seoul-root-"));
  mkdirSync(path.join(root, "raw", "sale"), { recursive: true });
  mkdirSync(path.join(root, "raw", "rent"), { recursive: true });
  const deal = (jibun, aptNm, over = {}) => ({ aptNm, buildYear: 2010, cdealType: "", dealAmount: "100,000", dealDay: 5, dealMonth: 7, dealYear: 2026, dealingGbn: "중개거래", excluUseAr: 84.5, floor: 3, jibun, sggCd: 11680, umdNm: "수서동", ...over });
  const three = (jibun, name) => [deal(jibun, name), deal(jibun, name), deal(jibun, name)];
  writeFileSync(path.join(root, "raw", "sale", "11680-202607.json"), JSON.stringify({ items: [
    ...three("1", "가단지"), ...three("3", "나단지"), ...three("5", "다단지"), ...three("7", "라단지"), deal("9", "마단지"),
    deal("1", "가단지", { cdealType: "O" }), deal("BL-1", "바단지"),
  ] }));
  writeFileSync(path.join(root, "raw", "rent", "11680-202607.json"), JSON.stringify({ items: [
    { aptNm: "나단지", jibun: "3", sggCd: 11680, umdNm: "수서동", roadnm: "광평로 10", roadnmbonbun: 10, roadnmbubun: 0 },
    { aptNm: "라단지", jibun: "7", sggCd: 11680, umdNm: "수서동", roadnm: "", roadnmbonbun: "", roadnmbubun: "" },
  ] }));
  return root;
}

function runFetch(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, "fetch", ...args], { env: { PATH: process.env.PATH, SEOUL_OPENDATA_API_KEY: KEY, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

async function fetchWith(base, { env = {} } = {}) {
  const root = fixtureRoot();
  const out = mkdtempSync(path.join(tmpdir(), "seoul-out-"));
  const run = await runFetch(["--out", out, "--root", root, "--base-url", base, "--delay-ms", "0", "--now", NOW], env);
  const files = readdirSync(out);
  const all = files.map((f) => readFileSync(path.join(out, f), "utf8")).join("\n");
  const summary = files.includes("summary.json") ? JSON.parse(readFileSync(path.join(out, "summary.json"), "utf8")) : null;
  const artifact = files.includes("artifact-name") ? readFileSync(path.join(out, "artifact-name"), "utf8").trim() : null;
  rmSync(root, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  return { ...run, files, all, summary, artifact };
}

function assertNoKey(result) {
  for (const needle of [KEY, encodeURIComponent(KEY), "secret", "0123456789abcdef"]) {
    assert.ok(!result.all.includes(needle), "파일에 키");
    assert.ok(!result.stdout.includes(needle), "stdout에 키");
    assert.ok(!result.stderr.includes(needle), "stderr에 키");
  }
  assert.ok(!/openapi\.seoul|127\.0\.0\.1|\/json\//.test(`${result.all}${result.stdout}${result.stderr}`), "주소가 출력에 있다");
}

// ── 값 읽기 ──

test("readCoord: 값 범위로 경위도·뒤바뀜·투영·빈 값을 가른다", () => {
  assert.deepEqual(readCoord("127.05", "37.5"), { kind: "lonlat", lon: 127.05, lat: 37.5, inSeoul: true });
  assert.deepEqual(readCoord("37.5", "127.05"), { kind: "swapped", lon: 127.05, lat: 37.5, inSeoul: true });
  assert.equal(readCoord("129.1", "35.1").inSeoul, false, "부산은 경위도이지만 서울 밖");
  assert.equal(readCoord("200000.5", "450000.5").kind, "projected");
  assert.equal(readCoord("", "").kind, "empty");
  assert.equal(readCoord("127.05", "").kind, "partial");
  assert.equal(readCoord("0", "0").kind, "zero");
  assert.equal(readCoord("abc", "37.5").kind, "nonNumeric");
  assert.equal(readCoord("10", "20").kind, "other");
});

test("coordShape: 자릿수만 남긴다", () => {
  assert.equal(coordShape("127.123456"), "3.6");
  assert.equal(coordShape("37.5"), "2.1");
  assert.equal(coordShape("127"), "3.0");
  assert.equal(coordShape("abc"), "A");
});

test("shapeOf: 이름과 숫자를 지운다", () => {
  assert.equal(shapeOf("서울특별시 강남구 수서동 1-2 래미안(1차)"), "가 가 가 9-9 가(9가)");
  assert.equal(shapeOf("A13876112"), "A9");
  assert.equal(shapeOf("城東 Tower"), "가 A");
});

test("parseRoad: 띄어쓰기·괄호·앞에 덧붙은 구를 다룬다", () => {
  assert.deepEqual(parseRoad("서울특별시 강남구 테헤란로14길 34 (역삼동)"), { district: "11680", road: "테헤란로14길", bon: 34, bu: 0 });
  assert.deepEqual(parseRoad("강남구 서울특별시 강남구 테헤란로 14길 34"), { district: "11680", road: "테헤란로14길", bon: 34, bu: 0 });
  assert.deepEqual(parseRoad("서울특별시 노원구 동일로 1234-5 비공개단지"), { district: "11350", road: "동일로", bon: 1234, bu: 5 });
  assert.deepEqual(parseRoad("노원구 동일로1234"), { district: "11350", road: "동일로", bon: 1234, bu: 0 });
  assert.equal(parseRoad("서울특별시"), null);
  assert.equal(parseRoad("강남구"), null);
  assert.equal(parseRoad(""), null);
});

test("rentRoadKey: K-apt 도로명과 같은 키가 된다", () => {
  assert.equal(rentRoadKey({ sggCd: 11680, roadnm: "테헤란로14길 34", roadnmbonbun: 34, roadnmbubun: 0 }), "11680|테헤란로14길|34|");
  assert.equal(rentRoadKey({ sggCd: 11680, roadnm: "광평로 10-2", roadnmbonbun: "", roadnmbubun: "" }), "11680|광평로|10|2");
  assert.equal(rentRoadKey({ sggCd: 11680, roadnm: "" }), null);
});

test("normalizeName: 공백·괄호·아파트를 지운다", () => {
  assert.equal(normalizeName("래미안 강남(1차) 아파트"), "래미안강남");
  assert.equal(normalizeName("e-편한세상"), normalizeName("E-편한세상"));
});

test("hist: 자르지 않는다. 합이 입력과 같다", () => {
  const map = new Map(Array.from({ length: 200 }, (_, i) => [`모양${i}`, i + 1]));
  const table = hist(map);
  assert.equal(table.rows.length, 200);
  assert.equal(table.total, (200 * 201) / 2);
  assert.ok(!("otherCount" in table));
});

test("quantiles: 최솟값·최댓값을 남기지 않는다", () => {
  const q = quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(Object.keys(q), ["n", "p01", "p10", "p25", "p50", "p75", "p90", "p99"]);
  assert.equal(quantiles([]), null);
});

test("spreadBucket: 여러 코드의 좌표 폭으로 가른다", () => {
  const apts = new Map(Object.entries({
    a: { coord: readCoord("127.1", "37.5") },
    b: { coord: readCoord("127.1005", "37.5") },
    c: { coord: readCoord("127.102", "37.5") },
    d: { coord: readCoord("127.2", "37.5") },
    e: { coord: readCoord("", "") },
  }));
  assert.equal(spreadBucket(["a", "b"], apts), "within100m");
  assert.equal(spreadBucket(["a", "c"], apts), "within300m");
  assert.equal(spreadBucket(["a", "d"], apts), "wider");
  assert.equal(spreadBucket(["a", "e"], apts), "missingCoord");
});

// ── 판정 ──

test("classify: 문서의 코드표대로 가른다", () => {
  assert.equal(classify(200, errBody("INFO-100", "x"), SERVICE.apt).kind, "auth");
  assert.equal(classify(200, errBody("INFO-200", "x"), SERVICE.apt).kind, "nodata");
  assert.equal(classify(200, errBody("ERROR-336", "x"), SERVICE.apt).kind, "spec");
  assert.equal(classify(200, errBody("ERROR-500", "x"), SERVICE.apt).kind, "server");
  assert.equal(classify(200, errBody("ERROR-601", "x"), SERVICE.apt).kind, "server");
  assert.equal(classify(403, "denied", SERVICE.apt).kind, "auth");
  assert.equal(classify(429, "slow", SERVICE.apt).kind, "quota");
  assert.equal(classify(500, "<html>boom</html>", SERVICE.apt).kind, "http");
  const ok = classify(200, okBody(SERVICE.apt, 1, [{ a: 1 }]), SERVICE.apt);
  assert.equal(ok.kind, "ok");
  assert.equal(ok.total, 1);
  assert.equal(classify(200, "<RESULT><CODE>INFO-100</CODE></RESULT>", SERVICE.apt).kind, "auth", "XML 오류도 코드를 읽는다");
  assert.equal(classify(200, "{}", SERVICE.apt).kind, "other");
});

test("classify: 메시지 원문을 돌려주지 않는다", () => {
  const verdict = classify(200, errBody("INFO-100", "주소에 비밀이 있다"), SERVICE.apt);
  assert.ok(!JSON.stringify(verdict).includes("비밀"));
  assert.equal(classify(200, JSON.stringify({ RESULT: { CODE: "http://x/키" } }), SERVICE.apt).code, null, "꼴이 아닌 코드는 버린다");
});

test("safeErrorName: 메시지를 쓰지 않고 꼴이 맞는 이름만 남긴다", () => {
  assert.equal(safeErrorName(new TypeError(`Failed to parse URL from http://x/${KEY}`)), "TypeError");
  assert.equal(safeErrorName({ cause: { code: "ECONNREFUSED" } }), "ECONNREFUSED");
  assert.equal(safeErrorName({ name: `http://x/${KEY}` }), "Error");
});

test("leaksKey: 원문·인코딩·조각을 찾는다", () => {
  assert.ok(leaksKey(`a${KEY}b`, KEY));
  assert.ok(leaksKey(`a${encodeURIComponent(KEY)}b`, KEY));
  assert.ok(leaksKey("앞 value0123456789 뒤", KEY), "12자 조각");
  assert.ok(!leaksKey('{"calls":{"OpenAptInfo":3},"p50":1234}', KEY));
});

test("guardReason: 재실행·결과 있음·아티팩트 있음·읽지 못함을 거부한다", () => {
  const ok = { attempt: "1", done: "0", earlyStops: "0", resume: "no", resultExists: false };
  assert.equal(guardReason(ok), null);
  assert.match(guardReason({ ...ok, attempt: "2" }), /재실행/);
  assert.match(guardReason({ ...ok, done: "1" }), /아티팩트/);
  assert.match(guardReason({ ...ok, resultExists: true }), /결과 파일/);
  assert.match(guardReason({ ...ok, done: "" }), /읽지 못했다/);
  assert.match(guardReason({ ...ok, earlyStops: "1" }), /clo 댓글/);
  assert.equal(guardReason({ ...ok, earlyStops: "1", resume: "yes" }), null);
  assert.match(guardReason({ ...ok, earlyStops: "2", resume: "yes" }), /상한/);
});

// ── 겹침 ──

test("measureOverlap: 경로별로 따로 세고 사슬은 앞 단계가 비었을 때만 넘어간다", () => {
  const root = fixtureRoot();
  const now = new Date(NOW);
  const sale = foldSale(root, now);
  const rent = foldRent(root);
  const cells = windowCells(sale.inWindow, rent.same);
  rmSync(root, { recursive: true, force: true });
  assert.equal(cells.length, 4, "1·3·5·7번지 n≥3, 마단지는 1건");
  assert.equal(sale.totals.live, 14, "해제 1건은 뺀다");
  assert.equal(sale.totals.unparsedJibun, 1);

  const index = buildIndex(FIXED);
  const { deals, cells: onCells } = measureOverlap(sale, cells, index, rent);
  assert.deepEqual(Object.keys(deals), PATH_NAMES);

  // 동+나머지 주소 경로: 1번지(코드 하나, 좌표 있음), 5번지(코드 둘), 9번지(좌표 없음).
  assert.equal(deals.jibunDaddr.attached.live, 3 + 3 + 1);
  assert.equal(deals.jibunDaddr.unique.live, 3 + 1);
  assert.equal(deals.jibunDaddr.uniqueWithCoord.live, 3);
  assert.equal(deals.jibunDaddr.ambiguous.live, 3);
  assert.equal(deals.jibunDaddr.ambiguousSpread.within100m.live, 3, "두 코드의 좌표 폭이 100m 안");
  // 도로명: 전월세 다리로 3번지만. K-apt 지번을 거치지 않는다.
  assert.equal(deals.roadKapt.unique.live, 3);
  assert.equal(deals.roadSeoul.attached.live, 0);
  // 사슬: 지번으로 안 붙는 3번지만 도로명으로 넘어간다.
  assert.equal(deals.chainJibunRoad.uniqueWithCoord.live, 3 + 3);
  assert.equal(onCells.chainJibunRoad.attached, 3);
  assert.equal(onCells.chainJibunRoad.uniqueWithCoord, 2);
  assert.equal(onCells.chainJibunRoad.ambiguous, 1);
  assert.equal(onCells.chainJibunRoad.byDistrict["11680"].cells, 4);
  assert.equal(onCells.chainJibunRoad.byDistrict["11680"].uniqueWithCoord, 2);
});

test("buildIndex: USE_YN이 Y가 아니면 칸 값을 따로 뺀다", () => {
  const root = fixtureRoot();
  const sale = foldSale(root, new Date(NOW));
  const rent = foldRent(root);
  const cells = windowCells(sale.inWindow, rent.same);
  rmSync(root, { recursive: true, force: true });
  const rows = FIXED.map((r) => (r.APT_CD === "A10000001" ? { ...r, USE_YN: "X" } : r));
  const { cells: onCells } = measureOverlap(sale, cells, buildIndex(rows), rent);
  assert.equal(onCells.chainJibunRoad.uniqueWithCoord, 2);
  assert.equal(onCells.chainJibunRoad.uniqueWithCoordUseYes, 1);
});

// ── 전체 실행 ──

test("fetch: 쪽을 1,000건씩 받고 상한 안에서 끝나며 집계만 남긴다", async () => {
  await withStub({ apt: 2500 }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.artifact, ARTIFACT.done);
    assertNoKey(r);
    assert.deepEqual(log.map((c) => [c.service, c.start, c.end]), [
      [SERVICE.apt, 1, 1000], [SERVICE.apt, 1001, 2000], [SERVICE.apt, 2001, 2500], [SERVICE.station, 1, 1000],
    ]);
    for (const c of log) {
      assert.ok(c.end - c.start + 1 <= 1000);
      assert.equal(c.type, "json");
    }
    for (const value of SECRET_VALUES) assert.ok(!r.all.includes(value), `저장 금지 값: ${value}`);
    assert.ok(!r.stdout.includes("비공개단지"));

    const s = r.summary;
    assert.deepEqual(s.calls, { [SERVICE.apt]: 3, [SERVICE.station]: 1 });
    assert.equal(s.retries, 0);
    assert.equal(s.stop, null);
    assert.equal(s.result.frame.aptRows, 2500);
    assert.equal(s.result.frame.distinctCodes, 2500);
    assert.equal(s.result.apt.coords.XCRDShapes.total, 2499);
    assert.equal(s.result.apt.coords.kinds.rows.find(([k]) => k === "empty")[1], 1);
    assert.equal(s.result.stations.coords.kinds.rows.find(([k]) => k === "swapped")[1], 1);
    assert.equal(s.result.straightLineToNearestStation.usableStations, 2, "뒤바뀐 역은 뒤집어 쓰고 빈 역은 뺀다");
    assert.equal(s.result.stations.distinctNames, 3);
    assert.deepEqual(s.result.stations.routesInSeoulBox.rows, [["3호선", 1], ["수인분당선", 1]]);
    assert.equal(s.result.overlap.denominators.cellsNge3, 4);
    assert.ok(s.result.overlap.cellsNge3.chainJibunRoad.uniqueWithCoord >= 2);
    assert.ok(s.unverified.generalKeyDailyLimit.includes("공개 문서에 값 없음"));
    assert.ok(s.unverified.coordinateSystem.includes("측지계"));
  });
});

test("fetch: 형식 표를 자르지 않는다. 모양이 많아도 합이 채운 수와 같다", async () => {
  const rows = Array.from({ length: 300 }, (_, i) => aptRow({ APT_CD: `A3${String(i).padStart(7, "0")}`, DADDR: `${"-".repeat(i % 60)}x${"(".repeat(i % 7)}` }));
  await withStub({ handlers: { [SERVICE.apt]: () => [200, okBody(SERVICE.apt, rows.length, rows)] } }, async (base) => {
    const r = await fetchWith(base);
    const table = r.summary.result.apt.fields.shapes.DADDR;
    assert.ok(table.distinct > 40, `모양 ${table.distinct}`);
    assert.equal(table.total, 300);
    assert.equal(table.rows.reduce((a, row) => a + row[1], 0), 300);
    assert.ok(!("otherCount" in table));
  });
});

test("fetch: 표시를 summary·result.out·stdout에 싣는다", async () => {
  await withStub({ apt: 10 }, async (base) => {
    const r = await fetchWith(base);
    const a = r.summary.attribution;
    assert.equal(a.statement, "서울특별시 공공데이터를 사용한 결과");
    assert.equal(a.computedBy, "수치는 집계가 계산");
    assert.match(a.license, /공공누리 1유형/);
    assert.match(a.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(a.datasets.map((d) => d.id), ["OA-15818", "OA-21232"]);
    for (const d of ATTRIBUTION.datasets) {
      assert.ok(r.stdout.includes(d.id));
      assert.ok(r.stdout.includes(d.url));
    }
    assert.ok(r.stdout.includes("서울특별시 공공데이터를 사용한 결과"));
    assert.ok(r.stdout.includes("수치는 집계가 계산"));
    assert.ok(!/서울(특별)?시.{0,6}(후원|제휴|공식 인증)/.test(r.stdout), "후원·관계로 오인될 표현 금지");
  });
});

test("fetch: 리다이렉트를 따라가지 않는다. 키가 다른 곳으로 가지 않는다", async () => {
  await withStub({ handlers: { [SERVICE.apt]: (_, url) => [302, "", { location: `/moved${url}` }] } }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(r.artifact, ARTIFACT.earlyStop);
    assert.equal(log.length, 1, "한 번만 불렀다");
    assert.equal(r.summary.stop.kind, "redirect");
    assert.equal(r.summary.stop.info.httpStatus, 302);
    assert.equal(r.summary.result, null);
    assertNoKey(r);
  });
});

test("fetch: 재시도 없음. 서버 오류는 한 번 부르고 멈추고, 본문이 주소를 되비쳐도 남지 않는다", async () => {
  await withStub({ handlers: { [SERVICE.apt]: (_, url) => [500, `<html>Error at http://openapi.seoul.go.kr:8088${url}</html>`] } }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(log.length, 1);
    assert.equal(r.summary.calls[SERVICE.apt], 1);
    assert.equal(r.summary.stop.kind, "http");
    assertNoKey(r);
  });
});

test("fetch: 인증 오류는 바로 멈춘다", async () => {
  await withStub({ handlers: { [SERVICE.apt]: () => [200, errBody("INFO-100", "인증키가 유효하지 않습니다")] } }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(log.length, 1);
    assert.equal(r.summary.stop.kind, "auth");
    assert.equal(r.summary.stop.info.code, "INFO-100");
    assert.ok(!r.all.includes("유효하지"), "서버 메시지를 남기지 않는다");
    assert.match(r.stdout, /소유자에게 키 등록/);
    assertNoKey(r);
  });
});

test("fetch: 역 서비스 실패면 결과 없이 조기 중단이다. 단지 쪽 값만 남기지 않는다", async () => {
  await withStub({ apt: 10, handlers: { [SERVICE.station]: () => [200, errBody("ERROR-500", "서버 오류")] } }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(r.artifact, ARTIFACT.earlyStop);
    assert.equal(log.length, 2);
    assert.equal(r.summary.result, null);
    assert.equal(r.summary.stop.kind, "server");
  });
});

test("fetch: 상한을 넘는 건수면 첫 호출 뒤 더 부르지 않는다. 잘라서 하한을 내지 않는다", async () => {
  await withStub({ apt: MAX_CALLS[SERVICE.apt] * 1000 + 1 }, async (base, log) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_STOPPED);
    assert.equal(log.length, 1);
    assert.equal(r.summary.stop.kind, "over-budget");
    assert.equal(r.summary.result, null);
  });
});

test("fetch: 도중에 건수가 바뀌거나 행이 모자라면 판정 못 함으로 멈춘다", async () => {
  await withStub({ handlers: { [SERVICE.apt]: (n) => [200, okBody(SERVICE.apt, n === 1 ? 1500 : 1600, aptRows(1000))] } }, async (base) => {
    const r = await fetchWith(base);
    assert.equal(r.summary.stop.kind, "total-changed");
    assert.equal(r.summary.result, null);
  });
  await withStub({ handlers: { [SERVICE.apt]: () => [200, okBody(SERVICE.apt, 900, aptRows(10))] } }, async (base) => {
    const r = await fetchWith(base);
    assert.equal(r.summary.stop.kind, "incomplete");
  });
});

test("fetch: 연결이 안 되면 주소 없이 이름만 남긴다", async () => {
  const r = await fetchWith("http://127.0.0.1:9");
  assert.equal(r.code, EXIT_STOPPED);
  assert.equal(r.summary.stop.kind, "network");
  assert.match(r.summary.stop.info.network, /^[A-Za-z_]+$/);
  assert.equal(r.summary.calls[SERVICE.apt], 1, "재시도 없음");
  assertNoKey(r);
});

test("fetch: 응답 값에 키가 섞이면 아무 값도 쓰지 않고 멈추고 다음 dispatch를 막는다", async () => {
  const leaky = [{ ...STATIONS[0], ROUTE: KEY }];
  await withStub({ apt: 10, handlers: { [SERVICE.station]: () => [200, okBody(SERVICE.station, 1, leaky)] } }, async (base) => {
    const r = await fetchWith(base);
    assert.equal(r.code, EXIT_LEAK);
    assert.equal(r.artifact, ARTIFACT.done, "다음 dispatch를 막는 이름");
    assert.ok(!r.files.includes("summary.json"));
    assert.ok(!r.files.includes("result.out"));
    assert.ok(r.files.includes("key-exposure-stop.json"));
    assert.match(r.stderr, /재발급/);
    assertNoKey(r);
  });
});

test("fetch: 호출 전 거부(키 없음, sample, 저장소 안 출력, 루프백 밖 주소)", async () => {
  await withStub({}, async (base, log) => {
    const root = fixtureRoot();
    const out = mkdtempSync(path.join(tmpdir(), "seoul-out-"));
    const noKey = await runFetch(["--out", out, "--root", root, "--base-url", base], { SEOUL_OPENDATA_API_KEY: "" });
    assert.equal(noKey.code, 2);
    const sample = await runFetch(["--out", out, "--root", root, "--base-url", base], { SEOUL_OPENDATA_API_KEY: "sample" });
    assert.equal(sample.code, 2);
    const inRepo = await runFetch(["--out", path.join(root, "x"), "--root", root, "--base-url", base]);
    assert.equal(inRepo.code, 2);
    const away = await runFetch(["--out", out, "--root", root, "--base-url", "http://example.com"]);
    assert.equal(away.code, 2);
    const testArg = await runFetch(["--out", out, "--root", root, "--delay-ms", "0"]);
    assert.equal(testArg.code, 2);
    assert.equal(log.length, 0);
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
});

// ── 소스·워크플로 ──

test("소스: 호출 경계가 코드에 있다", () => {
  assert.match(SOURCE, /redirect: "manual"/);
  assert.equal((SOURCE.match(/await fetch\(/g) ?? []).length, 1, "호출은 한 곳뿐");
  assert.ok(!/console\.\w+\([^)]*\burl\b/.test(SOURCE), "주소를 찍지 않는다");
  assert.ok(!/err(or)?\.message/.test(SOURCE), "예외 메시지를 쓰지 않는다");
  assert.ok(!/PUBLIC_DATA_PORTAL_API_KEY|MOLIT_API_KEY|dotenv/.test(SOURCE), "다른 키로 넘어가지 않는다");
  for (const field of ["TELNO", "FXNO", "EPIS_MNG_NO", "APT_NM", "HMPG", "APT_CMPX"]) {
    assert.ok(!new RegExp(`(VALUE|SHAPE)_FIELDS = \\[[^\\]]*"${field}"`).test(SOURCE), `${field}는 값표·모양표에 넣지 않는다`);
  }
});

test("워크플로: dispatch 전용, 쓰기 권한 없음, 시크릿은 호출 스텝에만", () => {
  assert.match(WORKFLOW, /^on:\n {2}workflow_dispatch:/m);
  assert.ok(!/^\s*(schedule|push|pull_request|workflow_run|repository_dispatch):/m.test(WORKFLOW));
  assert.match(WORKFLOW, /permissions:\n {2}contents: read\n {2}actions: read\n/);
  assert.ok(!/: write\b/.test(WORKFLOW));
  assert.ok(!/git (push|commit)/.test(WORKFLOW));
  assert.equal((WORKFLOW.match(/secrets\./g) ?? []).length, 1);
  const secretStep = WORKFLOW.split(/\n {6}- /).filter((s) => s.includes("secrets."));
  assert.equal(secretStep.length, 1);
  assert.match(secretStep[0], /measure\.mjs fetch/);
  assert.ok(!/persist-credentials: true/.test(WORKFLOW));
  assert.match(WORKFLOW, /persist-credentials: false/);
  assert.ok(!/npm (ci|install)/.test(WORKFLOW.replace(/#.*$/gm, "")), "키 스텝에 제3자 코드를 올리지 않는다");
  assert.match(WORKFLOW, /issues\/847#issuecomment/);
  assert.match(WORKFLOW, /GITHUB_RUN_ATTEMPT/);
  assert.match(WORKFLOW, /actions\/artifacts\?name=seoul-coords"/);
  assert.match(WORKFLOW, /actions\/artifacts\?name=seoul-coords-early-stop"/);
  assert.match(WORKFLOW, /set -o pipefail/);
  for (const line of WORKFLOW.split("\n").filter((l) => /uses: /.test(l))) assert.match(line, /@[0-9a-f]{40} /, "액션은 해시로 고정");
});
