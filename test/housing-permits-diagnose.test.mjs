import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createDiagnostics } from "../scripts/housing-permits-diagnose.mjs";
import { FIELDS, LICENSE } from "../scripts/housing-permits-spec.mjs";
import { DISTRICTS } from "../scripts/realestate-districts.mjs";

// 수집기 진단 출력 (#147). 규칙: 출력은 개수·비율·연도 히스토그램·코드성 범주뿐이고, 개별 값
// (관리번호·사업명·주소·지번·날짜 원문)은 어떤 형태로도 나오지 않는다. 전부 합성 응답이다.
// 낙제: 심은 값 문자열이 한 글자라도 나옴 / 3 미만 범주가 '기타'로 안 묶임 / 분모 100 미만이 '판정 불가'가 아님 /
//       날짜로 못 읽은 값이 분자·분모에 들어감.

const lines = (diag) => diag.lines((s) => s).join("\n");
/** 진단이 읽는 실제 응답 키(명세 30개 중 쓰는 것)로 만든 합성 항목. */
function row(extra = {}) {
  return {
    mgmHsrgstPk: "", sigunguCd: "11110", bjdongCd: "10100", bun: "", ji: "", bldNm: "",
    apprvDay: "", stcnsDay: "", stcnsSchedDay: "", useInsptDay: "", useInsptSchedDay: "", crtnDay: "",
    demolStrtDay: "", demolEndDay: "", demolExtngDay: "", demolExtngGbCd: "", purpsCd: "", strctCd: "", totHhldCnt: "10",
    ...extra,
  };
}
const feed = (items) => { const d = createDiagnostics(); for (const i of items) d.add(i); return d; };
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

test("채움률: 공백·\"0\"·\"00000000\"은 비어 있는 것으로 센다", () => {
  const out = lines(feed([
    row({ apprvDay: "20240101" }), row({ apprvDay: "0" }), row({ apprvDay: "00000000" }), row({ apprvDay: "  " }),
  ]));
  assert.match(out, /apprvDay 1\/4\b/);
  assert.match(out, /purpsCd 0\/4\b/);
});

test("연도 히스토그램: 건수 3 미만 칸은 기타로 묶이고 그 연도는 나오지 않는다", () => {
  const out = lines(feed([
    ...many(5, () => row({ apprvDay: "20240315" })),
    ...many(3, () => row({ apprvDay: "20231201" })),
    row({ apprvDay: "19870101" }),
    ...many(2, () => row({ apprvDay: "19910505" })),
  ]));
  const line = out.split("\n").find((l) => l.includes("날짜 apprvDay"));
  assert.match(line, /2024 5건/);
  assert.match(line, /2023 3건/);
  assert.match(line, /기타 3건/);
  assert.ok(!line.includes("1987") && !line.includes("1991"), "3 미만 칸의 연도가 나옴");
  assert.match(line, /날짜로 읽힘 11\b/);
});

test("날짜: 실행일(2026-10-10) 이후는 부등호 >, 달력에 없는 값은 읽히지 않은 것이다", () => {
  const out = lines(feed([
    row({ apprvDay: "20261010" }), row({ apprvDay: "20261011" }), row({ apprvDay: "20990101" }),
    row({ apprvDay: "20261301" }), row({ apprvDay: "2026-10-12" }), row({ apprvDay: "99999999" }),
  ]));
  const line = out.split("\n").find((l) => l.includes("날짜 apprvDay"));
  assert.match(line, /날짜로 읽힘 3\b/, "8자리 숫자로 달력에 있는 것만");
  assert.match(line, /못 읽음 3\b/);
  assert.match(line, /2026-10-10 이후 2\b/, "당일은 이후가 아니다");
});

function dayRows(n, fields) {
  return many(n, () => row(fields));
}

test("complete 해소 지표: 분모 100 이상이면 비율, 날짜로 못 읽은 값은 분자·분모에서 빠진다", () => {
  const items = [
    ...dayRows(120, { stcnsDay: "20200101", useInsptDay: "20210101", useInsptSchedDay: "20270101" }),
    // 못 읽는 값: 읽혔다면 (a) 분자 또는 (b) 분자가 됐을 형태
    ...dayRows(10, { stcnsDay: "20200101", useInsptDay: "99999999", useInsptSchedDay: "abc" }),
  ];
  const out = lines(feed(items));
  const a1 = out.split("\n").find((l) => l.includes("useInsptDay (a)"));
  const b1 = out.split("\n").find((l) => l.includes("useInsptDay (b)"));
  const a2 = out.split("\n").find((l) => l.includes("useInsptSchedDay (a)"));
  const b2 = out.split("\n").find((l) => l.includes("useInsptSchedDay (b)"));
  assert.match(a1, /0\/120\b/, "99999999는 읽히지 않아 분모 120에 안 든다");
  assert.match(b1, /120\/120\b/, "(b)는 세 필드 모두 읽힌 120건만");
  assert.match(a2, /120\/120\b/);
  assert.match(b2, /120\/120\b/);
  assert.match(a1, /100\.0%|0\.0%/);
  assert.ok(!/판정 불가/.test(a1 + b1 + a2 + b2));
  assert.match(a1, /제외 10\b/);
});

test("complete 해소 지표: 분모 99는 판정 불가(분모 부족), 100은 비율이 나온다", () => {
  const at = (n) => lines(feed(dayRows(n, { stcnsDay: "20200101", useInsptDay: "20210101", useInsptSchedDay: "20220101" })));
  const small = at(99);
  assert.match(small, /useInsptDay \(a\) 판정 불가\(분모 부족\)/);
  assert.match(small, /useInsptDay \(b\) 판정 불가\(분모 부족\)/);
  assert.match(small, /useInsptSchedDay \(a\) 판정 불가\(분모 부족\)/);
  assert.ok(!/useInsptDay \(a\)[^\n]*%/.test(small), "분모 부족인데 비율이 나옴");
  const edge = at(100);
  assert.ok(!/판정 불가/.test(edge));
  assert.match(edge, /useInsptDay \(a\)[^\n]*0\/100[^\n]*0\.0%/);
  assert.match(edge, /useInsptDay \(b\)[^\n]*100\/100[^\n]*100\.0%/);
});

test("complete 해소 지표: 어떤 필드를 고른다는 판정 문구는 없다", () => {
  const out = lines(feed(dayRows(150, { stcnsDay: "20200101", useInsptDay: "20210101", useInsptSchedDay: "20220101" })));
  assert.ok(!/고정|확정|채택|선택|complete로/.test(out), "이 모드는 지표만 낸다");
});

test("(b)는 stcnsDay가 읽히지 않으면 분모에서 빠진다", () => {
  const items = [
    ...dayRows(100, { stcnsDay: "20200101", useInsptDay: "20190101", useInsptSchedDay: "20210101" }),
    ...dayRows(50, { stcnsDay: "", useInsptDay: "20190101", useInsptSchedDay: "20210101" }),
  ];
  const out = lines(feed(items));
  assert.match(out.split("\n").find((l) => l.includes("useInsptDay (b)")), /0\/100\b/);
  assert.match(out.split("\n").find((l) => l.includes("useInsptSchedDay (b)")), /100\/100\b/);
  assert.match(out.split("\n").find((l) => l.includes("useInsptDay (a)")), /0\/150\b/);
});

test("순서 관계: 둘 다 읽힌 건 중 앞뒤 건수", () => {
  const out = lines(feed([
    row({ apprvDay: "20200101", stcnsDay: "20200101", useInsptDay: "20190101", useInsptSchedDay: "20210101" }),
    row({ apprvDay: "20200102", stcnsDay: "20200101", useInsptDay: "20210101" }),
    row({ apprvDay: "20200101", stcnsDay: "", useInsptDay: "20210101" }),
    row({ apprvDay: "abc", stcnsDay: "20200101" }),
  ]));
  assert.match(out, /apprvDay<=stcnsDay 1\/2\b/);
  assert.match(out, /stcnsDay<=useInsptDay 1\/2\b/);
  assert.match(out, /stcnsDay<=useInsptSchedDay 1\/1\b/);
});

test("키: PK 고유·중복 수, 조합 키 고유 수, crtnDay 다름·동률 묶음 수. 해시도 값도 나오지 않는다", () => {
  const out = lines(feed([
    row({ mgmHsrgstPk: "PKMARK-A", bun: "1", ji: "2", bldNm: "NMMARK-1", crtnDay: "20240101" }),
    row({ mgmHsrgstPk: "PKMARK-A", bun: "1", ji: "2", bldNm: "NMMARK-1", crtnDay: "20240101" }), // 동률
    row({ mgmHsrgstPk: "PKMARK-B", bun: "3", ji: "4", bldNm: "NMMARK-2", crtnDay: "20240101" }),
    row({ mgmHsrgstPk: "PKMARK-B", bun: "3", ji: "4", bldNm: "NMMARK-2", crtnDay: "20240202" }), // 다름, 최대 하나
    row({ mgmHsrgstPk: "PKMARK-C", bun: "5", ji: "6", bldNm: "NMMARK-1", crtnDay: "20240101" }),
    row({ mgmHsrgstPk: "", bun: "7", ji: "8", bldNm: "NMMARK-3" }),
  ]));
  assert.match(out, /mgmHsrgstPk 고유 3\b/);
  assert.match(out, /중복 2\b/, "6건 중 PK가 있는 5건, 고유 3 -> 중복 행 2");
  assert.match(out, /빈 값 1\b/);
  assert.match(out, /조합 키 후보 고유 5\b/);
  assert.match(out, /중복 PK 묶음 2/);
  assert.match(out, /crtnDay가 서로 다른 묶음 1\b/);
  assert.match(out, /최대 crtnDay 동률 묶음 1\b/);
  assert.ok(!out.includes("PKMARK") && !out.includes("NMMARK"));
  assert.ok(!/[0-9a-f]{16,}/.test(out), "해시처럼 보이는 문자열");
});

test("범주: 3 미만은 기타, 형식이 코드가 아닌 값은 값이 많아도 나오지 않는다, 허용 목록 밖 필드는 범주를 내지 않는다", () => {
  const out = lines(feed([
    ...many(4, () => row({ purpsCd: "01000", strctCd: "11", demolExtngGbCd: "" })),
    ...many(3, () => row({ purpsCd: "02000", strctCd: "11" })),
    ...many(2, () => row({ purpsCd: "ZZ777", strctCd: "12" })),
    row({ purpsCd: "QQ888", strctCd: "13" }),
    ...many(5, () => row({ purpsCd: "주거 용도 설명-MARK", bldNm: "NMMARK" })),
  ]));
  const p = out.split("\n").find((l) => l.includes("범주 purpsCd"));
  assert.match(p, /01000 4건/);
  assert.match(p, /02000 3건/);
  assert.match(p, /기타 3건/, "ZZ777 2건 + QQ888 1건");
  assert.ok(!p.includes("ZZ777") && !p.includes("QQ888"));
  assert.match(p, /코드 형식 아님 5건/);
  assert.ok(!out.includes("MARK"));
  assert.ok(!/범주 bldNm|범주 bun|범주 sigunguCd/.test(out));
});

test("호수: 0·비숫자·합", () => {
  const out = lines(feed([
    row({ totHhldCnt: "10" }), row({ totHhldCnt: "5" }), row({ totHhldCnt: "0" }),
    row({ totHhldCnt: "" }), row({ totHhldCnt: "많음-MARK" }), row({ totHhldCnt: "-3" }),
  ]));
  assert.match(out, /totHhldCnt[^\n]*0 3\b|값 0 1건/);
  assert.match(out, /값 0 1건/);
  assert.match(out, /공백 1건/);
  assert.match(out, /숫자 아님·음수 2건/);
  assert.match(out, /양수 합 15\b/);
  assert.ok(!out.includes("MARK"));
});

test("demol: 채워진 건 수와 허가 달과 같은 달인 건 수", () => {
  const out = lines(feed([
    row({ apprvDay: "20200115", demolEndDay: "20200120" }),
    row({ apprvDay: "20200115", demolEndDay: "20200220" }),
    row({ apprvDay: "", demolEndDay: "20200220" }),
    row({ apprvDay: "20200115", demolExtngGbCd: "01" }),
    row({ apprvDay: "20200115" }),
  ]));
  assert.match(out, /demol\* 하나라도 채워진 건 4\/5\b/);
  assert.match(out, /demolEndDay 허가 달과 같은 달 1\/2\b/);
});

test("빈 응답 동 수를 센다", () => {
  const d = createDiagnostics();
  d.noteEmptyDong(); d.noteEmptyDong();
  assert.match(lines(d), /빈 응답\(0건\) 동 2\b/);
});

test("값 비노출: 모든 문자열 필드에 심은 값이 출력 전체에 한 글자도 나오지 않는다", () => {
  const plant = (n) => `SECRET-${n}-q7x`;
  const items = many(30, (i) => row({
    mgmHsrgstPk: plant("pk"), bldNm: plant("nm"), platPlc: plant("addr"), bun: plant("bun"), ji: plant("ji"),
    apprvDay: plant("d1"), stcnsDay: plant("d2"), useInsptDay: plant("d3"), crtnDay: plant("d4"),
    purpsCd: plant("cd"), strctCd: plant("cd2"), totHhldCnt: plant("n"), [`extra${i}`]: plant("x"),
  }));
  const out = lines(feed(items));
  assert.ok(!/SECRET|q7x/.test(out), "심은 값이 진단 출력에 나옴");
});

// ---- 수집기 끝에서 끝: 호출 수 불변·출력 전체 값 비노출 ----

const MARK = "SECRET-e2e-7d1";
const KEY = "AbCdEfGh1234zzQq";
const script = path.resolve(import.meta.dirname, "../scripts/fetch-housing-permits.mjs");
const execFileAsync = promisify(execFile);

function e2eItem(sgg, n, extra = {}) {
  return {
    // 수집기의 기존 필드 가정(FIELDS)도 채워 접기 검사를 통과시킨다 - FIELDS 매핑은 이 PR에서 바꾸지 않는다.
    [FIELDS.id]: `${MARK}-pk-${n}`, [FIELDS.sigungu]: sgg, [FIELDS.units]: "10",
    [FIELDS.dates.permit]: "20240315", [FIELDS.dates.start]: "20240601", [FIELDS.dates.complete]: "", [FIELDS.cancel]: "", [FIELDS.version]: "20240315",
    ...row({
      mgmHsrgstPk: `${MARK}-${n}`, sigunguCd: sgg, bldNm: `${MARK}-nm`, platPlc: `${MARK}-addr`, bun: `${MARK}-b`, ji: `${MARK}-j`,
      apprvDay: "20240315", stcnsDay: "20240601", useInsptDay: `${MARK}-date`, purpsCd: n % 2 ? "01000" : "ZQ9", totHhldCnt: "10",
    }), ...extra,
  };
}
const envelope = (items, totalCount) => ({
  response: { header: { resultCode: "00", resultMsg: "OK" }, body: { items: { item: items }, totalCount } },
});
function startStub(handler) {
  const hits = [];
  const server = createServer((req, res) => {
    const q = Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
    hits.push({ q });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(handler({ q })));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ base: `http://127.0.0.1:${server.address().port}/stub`, hits, close: () => new Promise((d) => server.close(d)) })));
}
async function run(stub, extraArgs, makeItem = e2eItem) {
  void makeItem;
  const dir = await mkdtemp(path.join(tmpdir(), "housing-diag-"));
  const bjdong = path.join(dir, "bjdong.json");
  await writeFile(bjdong, JSON.stringify(Object.fromEntries(DISTRICTS.map((d) => [d.code, ["10100", "10200"]]))));
  const env = { PATH: process.env.PATH, BUILDINGHUB_RETRY_MS: "0", BUILDINGHUB_PAGE_SIZE: "2", BUILDINGHUB_API_KEY: KEY, BUILDINGHUB_API_ENDPOINT: stub.base };
  const args = [script, "--bjdong-file", bjdong, "--out-dir", path.join(dir, "out"), "--license", LICENSE.text,
    "--page-modified", "2026-09-01", "--collected-at", "2026-10-10T00:00:00.000Z", ...extraArgs];
  try {
    const r = await execFileAsync(process.execPath, args, { env, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    return { code: e.code, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}
const goodHandler = (makeItem) => ({ q }) => {
  const all = [1, 2, 3, 4].map((n) => makeItem(q.sigunguCd, n));
  const page = Number(q.pageNo), size = Number(q.numOfRows);
  return envelope(all.slice((page - 1) * size, page * size), all.length);
};

test("시험 호출 요약에 진단이 들어가고, 호출 수는 진단이 없을 때와 같고, 심은 값은 stdout·stderr에 없다", async () => {
  const stub = await startStub(goodHandler(e2eItem));
  try {
    const r = await run(stub, ["--only-district", "11140"]);
    assert.equal(r.code, 0, r.out);
    assert.equal(stub.hits.length, 4, "동 둘 x 2쪽 - 진단이 호출을 늘리면 안 된다");
    assert.match(r.out, /진단 채움률/);
    assert.match(r.out, /진단 날짜 apprvDay/);
    assert.match(r.out, /진단 complete 해소 지표 useInsptDay/);
    assert.match(r.out, /판정 불가\(분모 부족\)/, "표본 8건");
    assert.match(r.out, /기타 \d+건/, "ZQ9 4건은 3 이상이라 나오고 3 미만 날짜 칸은 기타");
    assert.ok(!r.out.includes("SECRET") && !r.out.includes(MARK), "심은 값이 출력에 나옴");
  } finally { await stub.close(); }
});

test("필드 가정이 틀려 접기 전에 멈추는 경로에도 진단 줄이 나오고 값은 없다", async () => {
  // FIELDS가 아는 필드 없이 실제 이름만 있는 응답: assertCoreFields가 던진다. 그 전에 쌓은 진단이 남아야 시험이 쓸모 있다.
  const bare = (sgg, n) => row({ mgmHsrgstPk: `${MARK}-${n}`, sigunguCd: sgg, bldNm: `${MARK}-nm`, apprvDay: "20240315" });
  const stub = await startStub(goodHandler(bare));
  try {
    const r = await run(stub, ["--only-district", "11140"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /알 수 없는 응답 필드/);
    assert.match(r.out, /진단 채움률/);
    assert.ok(!r.out.includes("SECRET") && !r.out.includes(MARK));
  } finally { await stub.close(); }
});

test("전수 모드에서도 호출 수·folded.json meta 모양은 그대로이고 진단은 로그에만 있다", async () => {
  const stub = await startStub(goodHandler(e2eItem));
  try {
    const r = await run(stub, []);
    assert.equal(r.code, 0, r.out);
    assert.equal(stub.hits.length, DISTRICTS.length * 4);
    assert.match(r.out, /진단 채움률/);
    assert.ok(!r.out.includes(MARK));
  } finally { await stub.close(); }
});
