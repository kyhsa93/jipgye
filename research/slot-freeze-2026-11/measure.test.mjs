// 슬롯 동결 측정 스크립트 시험(#820). 실제 API를 부르지 않는다. 호출은 전부 이 파일 안의 스텁 서버로 간다.
//   node --test research/slot-freeze-2026-11/measure.test.mjs
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CONTROL_CODES, CONTROL_MONTH, CORE_MONTHS, MAX_CALLS, PIN_DIGEST, STARTED_MARKER, THRESHOLDS, compareCells, diffSlot, inQuietHours, judge, plannedSlots } from "./measure.mjs";

const run = promisify(execFile);
const SCRIPT = path.join(import.meta.dirname, "measure.mjs");
const REPO = path.resolve(import.meta.dirname, "../..");
const KEY = "TESTKEY%2Bsecret%3D%3D";
const NOW = "2026-11-04T05:00:00.000Z"; // 14:00 KST

function row(over = {}) {
  return {
    aptDong: "", aptNm: "시험단지", buildYear: 2010, buyerGbn: "개인", cdealDay: "", cdealType: "", dealAmount: "100,000", dealDay: 5, dealMonth: 7, dealYear: 2026,
    dealingGbn: "중개거래", estateAgentSggNm: "서울 강남구", excluUseAr: 84.5, floor: 3, jibun: 10, landLeaseholdGbn: "N", rgstDate: "", sggCd: 11680, slerGbn: "개인", umdNm: "수서동",
    ...over,
  };
}
const REGISTERED = { rgstDate: "26.09.01", aptDong: 108 };
const CANCELLED = { cdealType: "O", cdealDay: "26.10.01" };

test("diffSlot: 같으면 변화 0", () => {
  const d = diffSlot([row(), row({ floor: 9 })], [row({ floor: 9 }), row()]);
  assert.deepEqual([d.changes.length, d.hashGone, d.valueOut, d.valueIn, d.marketRows], [0, 0, 0, 0, 2]);
});

test("diffSlot: 등기만 붙으면 등기 행이고 값 행이 아니다(aptDong이 같이 와도)", () => {
  const d = diffSlot([row()], [row(REGISTERED)]);
  assert.equal(d.counts.registered, 1);
  assert.deepEqual([d.valueOut, d.valueIn], [0, 0]);
});

test("diffSlot: 짝 없는 해제는 값이 나간다", () => {
  const d = diffSlot([row()], [row(CANCELLED)]);
  assert.deepEqual([d.counts.cancelMarked, d.counts.cancelNoTwin, d.counts.cancelWithTwin], [1, 1, 0]);
  assert.deepEqual([d.valueOut, d.valueIn], [1, 0]);
});

test("diffSlot: 해제 행이 새로 붙고 같은 키 정상 행이 남으면 짝 있는 해제이고 값이 안 바뀐다", () => {
  const d = diffSlot([row()], [row(), row(CANCELLED)]);
  assert.deepEqual([d.counts.appearedCancelled, d.counts.cancelWithTwin, d.counts.cancelNoTwin], [1, 1, 0]);
  assert.deepEqual([d.valueOut, d.valueIn], [0, 0]);
});

test("diffSlot: 금액 정정은 계약 키가 달라 사라짐 + 새 행, 값 행 2", () => {
  const d = diffSlot([row()], [row({ dealAmount: "90,000" })]);
  assert.deepEqual([d.counts.gone, d.counts.appeared], [1, 1]);
  assert.deepEqual([d.valueOut, d.valueIn], [1, 1]);
});

test("diffSlot: 직거래가 사라지면 사라짐이지만 값 행이 아니다", () => {
  const d = diffSlot([row({ dealingGbn: "직거래" })], []);
  assert.deepEqual([d.counts.gone, d.counts.gonePublic, d.valueOut, d.marketRows], [1, 0, 0, 0]);
});

test("diffSlot: 같은 키 행은 건수로 뺀다", () => {
  const d = diffSlot([row(), row()], [row()]);
  assert.deepEqual([d.counts.gone, d.valueOut], [1, 1]);
});

test("diffSlot: 기타 필드 변화는 등기로 세지 않는다", () => {
  const d = diffSlot([row()], [row({ estateAgentSggNm: "서울 서초구" })]);
  assert.equal(d.counts.other, 1);
  const already = diffSlot([row({ rgstDate: "26.09.01" })], [row({ rgstDate: "26.09.02" })]);
  assert.equal(already.counts.other, 1);
});

test("judge: 문턱 경계는 넘은 것으로 본다", () => {
  const quiet = { rows: { value: 0, market: 8671 }, cells: { changed: 0, band: 0, base: 3038 }, cancelShare: { before: 1.4, after: 1.4 }, mature: { before: ["a"], after: ["a"] } };
  assert.equal(judge(quiet).verdict, "재수집 불필요");
  assert.equal(judge({ ...quiet, rows: { value: 86, market: 8671 } }).triggers.a1, false);
  assert.equal(judge({ ...quiet, rows: { value: 87, market: 8671 } }).triggers.a1, true);
  assert.equal(judge({ ...quiet, rows: { value: 100, market: 10000 } }).triggers.a1, true);
  assert.equal(judge({ ...quiet, cells: { changed: 60, band: 0, base: 3038 } }).triggers.a2, false);
  assert.equal(judge({ ...quiet, cells: { changed: 61, band: 0, base: 3038 } }).triggers.a2, true);
  assert.equal(judge({ ...quiet, cells: { changed: 0, band: 30, base: 3038 } }).triggers.a3, false);
  assert.equal(judge({ ...quiet, cells: { changed: 0, band: 31, base: 3038 } }).verdict, "재수집 필요: 시세 칸");
  assert.equal(judge({ ...quiet, cancelShare: { before: 1.4, after: 1.5 } }).triggers.b2, false);
  assert.equal(judge({ ...quiet, cancelShare: { before: 1.4, after: 1.6 } }).triggers.b2, true);
  assert.equal(judge({ ...quiet, mature: { before: ["a"], after: ["a", "b"] } }).verdict, "재수집 필요: 해제·등기 화면만");
  assert.deepEqual(judge({ ...quiet, rows: { value: 9999, market: 1 }, invalid: ["대조"] }), { verdict: "무효", invalid: ["대조"] });
});

test("compareCells: 움직임·탈락·진입·억 구간을 나눠 센다", () => {
  const before = new Map([["a", 100000], ["b", 100000], ["c", 199999], ["d", 50000]]);
  const after = new Map([["a", 100000], ["b", 101000], ["c", 200000], ["e", 70000]]);
  const c = compareCells(before, after);
  assert.deepEqual([c.base, c.moved, c.lost, c.gained, c.changed, c.band], [4, 1, 1, 1, 3, 1]);
});

test("계획: 140슬롯, 겹침 없음, 상한 150 안에 다시 시도 몫 10", () => {
  const slots = plannedSlots();
  assert.equal(slots.length, 140);
  assert.equal(new Set(slots.map((s) => `${s.code}-${s.yearMonth}`)).size, 140);
  assert.equal(MAX_CALLS, 150);
  assert.ok(slots.every((s) => s.yearMonth !== "202611"));
});

test("조용한 시간: 08:00 이상 12:30 미만 KST", () => {
  const at = (hhmm) => new Date(`2026-11-04T${hhmm}:00+09:00`);
  assert.deepEqual(["07:59", "08:00", "12:29", "12:30"].map((t) => inQuietHours(at(t))), [false, true, true, false]);
});

test("PREREG에 문턱·고정값이 코드와 같게 적혀 있다", () => {
  const doc = readFileSync(path.join(import.meta.dirname, "PREREG.md"), "utf8");
  assert.ok(doc.includes(PIN_DIGEST));
  assert.deepEqual(THRESHOLDS, { rowShare: 0.01, cellShare: 0.02, cellMove: 0.01, bandShare: 0.01, cancelPp: 0.2 });
  for (const text of ["값 행 ÷ 시장 행 ≥ 1%", "칸 변화 ÷ n≥3 칸 ≥ 2%", "억 구간이 바뀐 칸 ÷ n≥3 칸 ≥ 1%", "0.2%p", "87행"]) assert.ok(doc.includes(text), text);
});

// ── 스텁 서버 끝에서 끝까지 ──
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toXml = (items) =>
  `<?xml version="1.0"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items
    .map((it) => `<item>${Object.entries(it).map(([k, v]) => `<${k}>${v === "" ? " " : esc(v)}</${k}>`).join("")}</item>`)
    .join("")}</items><numOfRows>9999</numOfRows><pageNo>1</pageNo><totalCount>${items.length}</totalCount></body></response>`;

/** 합성 원본. 본 슬롯마다 단지 하나·넉 건. 11680-202606만 실제 원본을 그대로 넣어 해석이 저장 형식을 되돌리는지 본다. big은 슬롯 키 → 행 배열로 그 슬롯을 덮어 쓴다. */
function makeRoot(big = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "slot-freeze-root-"));
  mkdirSync(path.join(root, "raw/sale"), { recursive: true });
  mkdirSync(path.join(root, "raw/ecos"), { recursive: true });
  mkdirSync(path.join(root, "docs/data"), { recursive: true });
  cpSync(path.join(REPO, "raw/ecos/apt-price-index.json"), path.join(root, "raw/ecos/apt-price-index.json"));
  cpSync(path.join(REPO, "docs/data/outlook.json"), path.join(root, "docs/data/outlook.json"));
  for (const { code, yearMonth } of plannedSlots()) {
    const items = big[`${code}-${yearMonth}`] ?? (code === "11680" && yearMonth === "202606"
      ? JSON.parse(readFileSync(path.join(REPO, "raw/sale/11680-202606.json"), "utf8")).items
      : [0, 1, 2, 3].map((i) =>
          row({
            sggCd: Number(code), aptNm: `단지${yearMonth}`, dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)), dealDay: 10 + i,
            dealAmount: (100000 + i * 10000).toLocaleString("en-US"), floor: i + 1,
          })
        ));
    const file = { kind: "sale", district: code, yearMonth, ok: true, resultCode: 0, count: items.length, totalCount: items.length, observedAt: "2026-08-17T00:00:00.000Z", previousObservedAt: null, arrivals: {}, items };
    writeFileSync(path.join(root, "raw/sale", `${code}-${yearMonth}.json`), `${JSON.stringify(file)}\n`);
  }
  return root;
}

async function withStub(root, respond, body) {
  const log = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    const code = url.searchParams.get("LAWD_CD");
    const ym = url.searchParams.get("DEAL_YMD");
    log.push({ code, ym, key: url.searchParams.get("serviceKey") });
    const stored = JSON.parse(readFileSync(path.join(root, "raw/sale", `${code}-${ym}.json`), "utf8")).items;
    const answer = respond({ code, ym, stored, calls: log.filter((c) => c.code === code && c.ym === ym).length });
    res.statusCode = answer.status ?? 200;
    res.end(answer.raw ?? toXml(answer.items ?? stored));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await body(`http://127.0.0.1:${server.address().port}/getRTMSDataSvcAptTradeDev`, log);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function cli(args, env = {}) {
  try {
    const r = await run(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, maxBuffer: 1 << 26 });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (err) {
    return { code: err.code, out: `${err.stdout}${err.stderr}` };
  }
}

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const snapshot = (dir) => new Map(walk(dir).map((f) => [f, readFileSync(f, "utf8")]));
const fetchArgs = (root, out, extra = []) => ["fetch", "--root", root, "--out", out, "--now", NOW, "--no-pin", "--delay-ms", "0", "--retry-wait-ms", "0", ...extra];

async function e2e(respond, big) {
  const root = makeRoot(big);
  const work = mkdtempSync(path.join(tmpdir(), "slot-freeze-out-"));
  const before = snapshot(root);
  try {
    return await withStub(root, respond, async (endpoint, log) => {
      const fetched = await cli(fetchArgs(root, path.join(work, "got")), { MOLIT_API_KEY: KEY, MOLIT_API_ENDPOINT: endpoint });
      const compared = await cli(["compare", "--root", root, "--refetched", path.join(work, "got"), "--out", path.join(work, "res")]);
      const summary = existsSync(path.join(work, "res/summary.json")) ? JSON.parse(readFileSync(path.join(work, "res/summary.json"), "utf8")) : null;
      const outputs = [fetched.out, compared.out, ...[...snapshot(work).values()]].join("\n");
      assert.deepEqual(snapshot(root), before, "원본이 바뀌었다(쓰기 0 위반)");
      for (const needle of [KEY, encodeURIComponent(KEY), decodeURIComponent(KEY), endpoint]) assert.ok(!outputs.includes(needle), `출력에 비밀값: ${needle}`);
      return { fetched, compared, summary, log, outputs };
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

test("끝에서 끝까지: 그대로 돌려주면 변화 0, 호출 140, 재수집 불필요, 실제 행도 해석을 지나 같다", async () => {
  const { fetched, summary, log } = await e2e(() => ({}));
  assert.equal(fetched.code, 0, fetched.out);
  assert.equal(log.length, 140);
  assert.ok(log.every((c) => c.key === decodeURIComponent(KEY)), "키가 운영 수집과 같은 모양으로 가지 않는다");
  assert.equal(summary.result.verdict, "재수집 불필요");
  assert.equal(summary.rowTest.value, 0);
  assert.equal(summary.cells.changed, 0);
  const real = summary.byMonth["202606"];
  assert.deepEqual([real.hashGone, real.gone, real.appeared, real.valueOut, real.valueIn], [0, 0, 0, 0, 0]);
  assert.ok(real.rows > 200, "실제 원본 슬롯이 안 들어갔다");
  assert.equal(summary.extraFields.length, 0);
});

test("끝에서 끝까지: 해제가 넉넉하면 값 문턱을 넘는다", async () => {
  const { summary } = await e2e(({ ym, stored }) => (ym === "202608" ? { items: stored.map((r, i) => (i === 0 ? { ...r, ...CANCELLED } : r)) } : {}));
  assert.equal(summary.rowTest.value, 25);
  assert.equal(summary.result.verdict, "재수집 필요: 시세 칸");
  assert.equal(summary.result.triggers.a1, true);
  assert.equal(summary.byMonth["202608"].cancelNoTwin, 25);
});

test("끝에서 끝까지: 등기만 잔뜩 붙으면 값은 그대로이고 해제·등기 화면만 판정된다", async () => {
  const { summary } = await e2e(({ ym, stored }) => (ym === "202604" ? { items: stored.map((r) => ({ ...r, ...REGISTERED })) } : {}));
  assert.equal(summary.result.verdict, "재수집 필요: 해제·등기 화면만");
  assert.equal(summary.rowTest.value, 0);
  assert.equal(summary.cells.changed, 0);
  assert.ok(summary.byMonth["202604"].registered > 0);
  assert.deepEqual([summary.result.triggers.a1, summary.result.triggers.b1], [false, true]);
});

test("끝에서 끝까지: 대조 슬롯 다수가 다 달라지면 무효이고 값은 판정하지 않는다", async () => {
  const { summary } = await e2e(({ ym, stored }) => (ym === CONTROL_MONTH ? { items: stored.map((r) => ({ ...r, jibun: `${r.jibun}-x` })) } : {}));
  assert.equal(summary.result.verdict, "무효");
});

test("끝에서 끝까지: 대조 슬롯 하나의 일괄 변화로는 무효가 되지 않는다", async () => {
  const one = CONTROL_CODES[1];
  const { summary } = await e2e(({ code, ym, stored }) => (ym === CONTROL_MONTH && code === one ? { items: stored.map((r) => ({ ...r, jibun: `${r.jibun}-x` })) } : {}));
  assert.equal(summary.control.shares.at(-1), 1);
  assert.notEqual(summary.result.verdict, "무효");
});

test("끝에서 끝까지: 새 필드는 빼고 비교하고 적는다, 없어진 필드는 무효", async () => {
  const extra = await e2e(({ stored }) => ({ items: stored.map((r) => ({ ...r, newField: "x" })) }));
  assert.equal(extra.summary.result.verdict, "재수집 불필요");
  assert.deepEqual(extra.summary.extraFields, ["newField"]);
  const gone = await e2e(({ stored }) => ({ items: stored.map(({ slerGbn, ...r }) => r) }));
  assert.equal(gone.summary.result.verdict, "무효");
});

test("끝에서 끝까지: 빈 응답 슬롯은 변화가 아니라 실패로 세고 많으면 무효", async () => {
  const { summary } = await e2e(({ ym, code }) => (ym === "202606" && code === "11680" ? { items: [] } : {}));
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.byMonth["202606"].gone, 0);
  const many = await e2e(({ ym }) => (ym === "202607" ? { items: [] } : {}));
  assert.equal(many.summary.result.verdict, "무효");
  assert.equal(many.summary.rowTest.value, 0);
  const totals = await e2e(({ ym, stored }) => (ym === "202607" ? { raw: toXml(stored).replace("<totalCount>4<", "<totalCount>5<") } : {}));
  assert.equal(totals.summary.result.verdict, "무효");
});

// 절반 아래 슬롯(PREREG 6절). 앞쪽 행만 남기고 응답 건수는 그 행 수와 맞는다.
const bigSlot = (n, code = "11500", month = 7, over = () => ({})) =>
  Array.from({ length: n }, (_, i) =>
    row({ sggCd: Number(code), aptNm: `큰단지${i % 40}`, dealMonth: month, dealDay: (i % 28) + 1, floor: (i % 30) + 1, dealAmount: (100000 + i * 100).toLocaleString("en-US"), ...over(i) })
  );
const keepFront = (key, n) => ({ code, ym, stored }) => (`${code}-${ym}` === key ? { items: stored.slice(0, n) } : {});

test("절반 아래: 395→201과 395→193의 판정이 같다. 절반에서 판정이 뒤집히지 않는다", async () => {
  const big = { "11500-202607": bigSlot(395) };
  const above = await e2e(keepFront("11500-202607", 201), big);
  const below = await e2e(keepFront("11500-202607", 193), big);
  assert.deepEqual([above.summary.rowTest.value, below.summary.rowTest.value], [194, 202]);
  assert.deepEqual([above.summary.result.verdict, below.summary.result.verdict], ["재수집 필요: 시세 칸", "재수집 필요: 시세 칸"]);
  assert.deepEqual([above.summary.failed.length, below.summary.failed.length], [0, 0]);
  assert.deepEqual([above.summary.shrunk.length, below.summary.shrunk.length], [0, 1]);
  assert.deepEqual(below.summary.shrunk[0], { code: "11500", yearMonth: "202607", group: "core", stored: 395, fetched: 193, gone: 202, gonePublic: 202, valueOut: 202 });
  assert.match(below.compared.out, /절반 아래\(변화로 셈\) 11500-202607 core: 행 395 → 193/);
  assert.doesNotMatch(above.compared.out, /절반 아래/);
});

test("절반 아래: 직거래만 사라지면(에드가휘경 모양) 사라짐으로 적히되 값 행은 0이고 판정을 막지 않는다", async () => {
  const big = { "11230-202608": bigSlot(390, "11230", 8, (i) => (i >= 77 ? { dealingGbn: "직거래", buyerGbn: "법인", slerGbn: "법인" } : {})) };
  const { summary } = await e2e(keepFront("11230-202608", 77), big);
  assert.deepEqual(summary.shrunk[0], { code: "11230", yearMonth: "202608", group: "core", stored: 390, fetched: 77, gone: 313, gonePublic: 0, valueOut: 0 });
  assert.equal(summary.rowTest.value, 0);
  assert.equal(summary.cells.changed, 0);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.result.triggers.a1 || summary.result.triggers.a2 || summary.result.triggers.a3, false);
});

test("절반 아래: totalCount가 안 맞거나 0행이면 그대로 실패이고 변화로 안 센다", async () => {
  const big = { "11500-202607": bigSlot(395) };
  const mismatch = await e2e(({ code, ym, stored }) => (`${code}-${ym}` === "11500-202607" ? { raw: toXml(stored.slice(0, 100)).replace("<totalCount>100<", "<totalCount>395<") } : {}), big);
  assert.deepEqual([mismatch.summary.failed.length, mismatch.summary.shrunk.length, mismatch.summary.rowTest.value], [1, 0, 0]);
  assert.match(mismatch.summary.failed[0].problem, /totalCount 395 ≠ 행 100/);
  const empty = await e2e(keepFront("11500-202607", 0), big);
  assert.deepEqual([empty.summary.failed.length, empty.summary.shrunk.length, empty.summary.rowTest.value], [1, 0, 0]);
});

test("절반 아래: 대조 슬롯이 다수 줄면 변화로 세어 무효가 된다", async () => {
  const big = Object.fromEntries(CONTROL_CODES.map((code) => [`${code}-${CONTROL_MONTH}`, bigSlot(40, code, 10)]));
  const { summary } = await e2e(({ code, ym, stored }) => (ym === CONTROL_MONTH && code !== CONTROL_CODES[0] ? { items: stored.slice(0, 10) } : {}), big);
  assert.equal(summary.result.verdict, "무효");
  assert.match(summary.result.invalid.join(), /대조 슬롯 중앙 변화/);
  assert.equal(summary.shrunk.length, 4);
});

test("상한: 첫 시도가 늘 실패해도 150회를 넘지 않는다", async () => {
  const { log, fetched } = await e2e(({ calls }) => (calls === 1 ? { status: 500 } : {}));
  assert.ok(log.length <= MAX_CALLS, `호출 ${log.length}`);
  assert.equal(fetched.code, 0);
});

test("상한: 드문 실패는 다시 시도하되 모든 슬롯이 첫 시도를 받는다", async () => {
  const { log } = await e2e(({ code, calls }) => (code === "11110" && calls === 1 ? { status: 500 } : {}));
  assert.equal(log.length, 140 + 7);
  assert.equal(new Set(log.map((c) => `${c.code}-${c.ym}`)).size, 140);
});

test("연속 실패: 다섯 슬롯이 내리 실패하면 멈춘다", async () => {
  const { log, summary } = await e2e(() => ({ status: 500 }));
  assert.equal(log.length, 10);
  assert.equal(summary.result.verdict, "무효");
});

test("비밀값: 응답이 키를 되돌려도 어디에도 남지 않는다", async () => {
  const raw = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>bad key ${KEY} / ${decodeURIComponent(KEY)}</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  const { outputs, log } = await e2e(() => ({ raw }));
  assert.equal(log.length, 10);
  assert.ok(outputs.includes("***"));
});

test("시작 표시: 호출한 실행은 비밀값으로 멈춰도 표시가 남고, 표시에는 비밀값이 없다", async () => {
  const root = makeRoot();
  const work = mkdtempSync(path.join(tmpdir(), "slot-freeze-out-"));
  const out = path.join(work, "got");
  try {
    await withStub(root, ({ stored }) => ({ items: stored.map((r) => ({ ...r, aptNm: decodeURIComponent(KEY) })) }), async (endpoint, log) => {
      const r = await cli(fetchArgs(root, out), { MOLIT_API_KEY: KEY, MOLIT_API_ENDPOINT: endpoint });
      assert.equal(r.code, 5, r.out);
      assert.ok(log.length > 0);
      assert.deepEqual(readdirSync(out), [STARTED_MARKER]);
      const marker = readFileSync(path.join(out, STARTED_MARKER), "utf8");
      assert.ok(!marker.includes(decodeURIComponent(KEY)) && !marker.includes(endpoint));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test("거부: 호출 전에 멈춘다(키 없음, 저장소 안 출력, 조용한 시간, 고정값 불일치)", async () => {
  const root = makeRoot();
  const work = mkdtempSync(path.join(tmpdir(), "slot-freeze-out-"));
  const out = path.join(work, "got");
  try {
    await withStub(root, () => ({}), async (endpoint, log) => {
      const env = { MOLIT_API_KEY: KEY, MOLIT_API_ENDPOINT: endpoint };
      assert.equal((await cli(fetchArgs(root, out))).code, 2);
      assert.equal((await cli(fetchArgs(root, path.join(REPO, "research/x")), env)).code, 2);
      assert.equal((await cli(fetchArgs(root, path.join(root, "x")), env)).code, 2);
      assert.equal((await cli(["fetch", "--root", root, "--out", out, "--now", "2026-11-04T00:30:00.000Z", "--no-pin"], env)).code, 3);
      assert.equal((await cli(["fetch", "--root", root, "--out", out, "--now", NOW], env)).code, 4);
      assert.equal(log.length, 0);
      assert.ok(!existsSync(out));
      assert.ok(!existsSync(path.join(REPO, "research/x")));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test("본 달 목록은 등록한 다섯 달이다", () => {
  assert.deepEqual(CORE_MONTHS, ["202604", "202605", "202606", "202607", "202608"]);
});

// ── 워크플로 (PREREG 5절). 스텝 본문을 그대로 꺼내 임시 저장소에서 GitHub 기본 셸(bash -e)로 돌린다. ──
const WORKFLOW = readFileSync(path.join(REPO, ".github/workflows/slot-freeze-measure.yml"), "utf8");
const stepOf = (name) => {
  const from = WORKFLOW.indexOf(`- name: ${name}\n`);
  assert.ok(from > 0, name);
  const next = WORKFLOW.slice(from + 1).search(/\n\n      (#|- )/);
  return WORKFLOW.slice(from, from + 1 + next);
};
const runBlock = (step) => step.slice(step.indexOf("run: |\n") + 7).split("\n").map((l) => l.slice(10)).join("\n");

function guardRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "slot-freeze-guard-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).stdout.trim();
  git("init", "-q");
  mkdirSync(path.join(dir, "research/slot-freeze-2026-11"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"));
  for (const f of ["research/slot-freeze-2026-11/PREREG.md", "research/slot-freeze-2026-11/measure.mjs", "scripts/complex-price.ts"]) writeFileSync(path.join(dir, f), "v1\n");
  git("add", "-A");
  git("commit", "-qm", "prereg");
  const bin = path.join(dir, ".bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), '#!/bin/sh\necho "$*" >> "$GH_LOG"\ntest -z "$GH_FAIL" || exit 1\nprintf "%s\\n" "$GH_OUT"\n', { mode: 0o755 });
  writeFileSync(path.join(dir, ".git/info/exclude"), ".bin\n");
  return { dir, git, prereg: git("rev-parse", "HEAD"), bin };
}

function runGuard(repo, env = {}) {
  const summaryFile = path.join(repo.bin, "summary.txt");
  const ghLog = path.join(repo.bin, "gh.log");
  writeFileSync(ghLog, "");
  const r = spawnSync("bash", ["-e", "-c", runBlock(stepOf("재실행 거부"))], {
    cwd: repo.dir,
    encoding: "utf8",
    env: { PATH: `${repo.bin}:${process.env.PATH}`, GH_LOG: ghLog, GH_OUT: "0", GITHUB_RUN_ATTEMPT: "1", GITHUB_REPOSITORY: "o/r", PREREG_COMMIT: repo.prereg, GITHUB_STEP_SUMMARY: summaryFile, ...env },
  });
  return { code: r.status, err: r.stderr, out: r.stdout, gh: readFileSync(ghLog, "utf8") };
}

test("재실행 거부: 첫 실행은 통과하고 이름으로 거른 아티팩트 목록을 본다", (t) => {
  const repo = guardRepo();
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  const r = runGuard(repo);
  assert.equal(r.code, 0, r.err);
  assert.match(r.gh, /api repos\/o\/r\/actions\/artifacts\?name=slot-freeze --jq \.total_count/);
});

test("재실행 거부: 재시도·아티팩트·확인 실패는 호출 전에 거부한다", (t) => {
  const repo = guardRepo();
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  for (const [env, why] of [
    [{ GITHUB_RUN_ATTEMPT: "2" }, /재실행/],
    [{ GITHUB_RUN_ATTEMPT: "" }, /재실행/],
    [{ GH_OUT: "1" }, /아티팩트/],
    [{ GH_OUT: "" }, /아티팩트/],
    [{ GH_OUT: "null" }, /아티팩트/],
    [{ GH_FAIL: "1" }, /^$/],
  ]) {
    const r = runGuard(repo, env);
    assert.notEqual(r.code, 0, JSON.stringify(env));
    assert.match(r.err, why, JSON.stringify(env));
  }
});

test("재실행 거부: 결과 파일이 이미 있으면 거부한다", (t) => {
  for (const name of ["summary.json", "result.out"]) {
    const repo = guardRepo();
    t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
    writeFileSync(path.join(repo.dir, "research/slot-freeze-2026-11", name), "{}\n");
    const r = runGuard(repo);
    assert.notEqual(r.code, 0, name);
    assert.match(r.err, /이미 있다/);
  }
});

test("재실행 거부: 등록 뒤 PREREG·스크립트가 바뀌면 거부하고, scripts/는 막지 않고 목록을 남긴다", (t) => {
  for (const name of ["PREREG.md", "measure.mjs"]) {
    const repo = guardRepo();
    t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
    writeFileSync(path.join(repo.dir, "research/slot-freeze-2026-11", name), "v2\n");
    repo.git("commit", "-qam", "change");
    const r = runGuard(repo);
    assert.notEqual(r.code, 0, name);
    assert.match(r.err, /등록 뒤/);
  }
  const repo = guardRepo();
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  writeFileSync(path.join(repo.dir, "scripts/complex-price.ts"), "v2\n");
  repo.git("commit", "-qam", "change");
  const r = runGuard(repo);
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(path.join(repo.bin, "summary.txt"), "utf8"), /scripts\/complex-price\.ts/);
});

test("워크플로: 거부 스텝이 호출 앞이고, 권한·토큰·시크릿 범위가 좁고, 순서 확인이 실제 산출을 본다", () => {
  assert.match(WORKFLOW, /permissions:\n  contents: read\n  actions: read\n\n/);
  assert.ok(WORKFLOW.indexOf("사전 등록 순서 확인") < WORKFLOW.indexOf("재실행 거부\n"));
  assert.ok(WORKFLOW.indexOf("- name: 재실행 거부") < WORKFLOW.indexOf("measure.mjs fetch"));
  assert.equal(WORKFLOW.match(/github\.token/g).length, 1);
  assert.match(stepOf("재실행 거부"), /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.equal(WORKFLOW.match(/secrets\./g).length, 2);
  assert.match(stepOf("다시 받기 (호출 상한 150)"), /secrets\.MOLIT_API_KEY[\s\S]*secrets\.MOLIT_API_ENDPOINT/);
  assert.match(WORKFLOW, /for output in summary\.json result\.out; do\n\s+node scripts\/check-prereg-order\.ts/);
  assert.doesNotMatch(WORKFLOW, /result\.json|초안|이 파일은 지운다/);
  assert.match(WORKFLOW, /if: \$\{\{ cancelled\(\) \}\}[\s\S]*got\/fetch-started\.json/);
  assert.ok(WORKFLOW.includes(`got/${STARTED_MARKER}`));
});

test("PREREG: 낡은 문구와 비공개 출처가 없고, 규칙이 코드와 같게 적혀 있다", () => {
  const doc = readFileSync(path.join(import.meta.dirname, "PREREG.md"), "utf8");
  for (const stale of ["workflow-draft", "초안", "cto 5절", "DE 5."]) assert.ok(!doc.includes(stale), stale);
  for (const text of ["#820 댓글", "PR의 검토자", "실패가 아니라 변화로 센다", "절반 아래(변화로 셈)", "GITHUB_RUN_ATTEMPT", STARTED_MARKER]) assert.ok(doc.includes(text), text);
  assert.ok(!doc.includes("절반 아래로 줄어듦"));
});
