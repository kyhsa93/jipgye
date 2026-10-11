import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OFFICIAL_PRICE_LICENSE, OFFICIAL_PRICE_LICENSE_CHECKED } from "../scripts/official-price-license.mjs";
import {
  ApiFatalError, ApiValidationError, MAX_PAGES_PER_PARCEL, OWNER_KEY_RE, buildPart, checkLicense, foldParcel, loadState, mergeParts, projectItem, runCollector, summaryLines,
} from "../scripts/official-price-api.mjs";
import { assertDerived } from "../scripts/official-price-fold.mjs";
import { loadTargets, orderTargets } from "../scripts/official-price-targets.mjs";
import { runExplore } from "../scripts/official-price-explore.mjs";
import { FAKE_KEY, FAKE_OWNER, buildParcel, hogs, pkey, startMock, target, targetsOf } from "./helpers/official-price-mock.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-11T00:00:00Z");
const COMMIT = "a".repeat(40);
const tmp = () => mkdtemp(path.join(tmpdir(), "op-api-"));

/** 지번 3개짜리 세계: 호 4개 칸 하나(+2호 칸 하나)가 들어 있는 지번, 호 1개 지번, 호 없는 지번 */
function world() {
  const ts = [target(1), target(2), target(3)];
  const uni = new Map();
  uni.set(pkey(ts[0]), buildParcel([...hogs(4, "A"), ...hogs(2, "B", "59.9", 10)]));
  uni.set(pkey(ts[1]), buildParcel(hogs(1, "C", "84.97")));
  uni.set(pkey(ts[2]), buildParcel([]));
  return { ts, targets: targetsOf(ts), uni };
}
const base = (o) => ({ rawCommit: COMMIT, license: "제한 없음", licenseChecked: "2026-10-01", now: NOW, gapMs: 0, budget: 1000, key: FAKE_KEY, ...o });
async function listFiles(dir) {
  const out = [];
  const walk = async (d) => { for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else out.push(path.relative(dir, p)); } };
  await walk(dir);
  return out.sort();
}
const readAll = async (dir) => (await Promise.all((await listFiles(dir)).map((f) => readFile(path.join(dir, f), "utf8")))).join("\n");

test("접기: 호 4개 칸은 중앙값·층별을 남기고 호 2개 칸은 값을 버리고 칸 수만 센다 (C2)", () => {
  const { uni, ts } = world();
  const p = uni.get(pkey(ts[0]));
  const items = (list, kind) => list.map((x) => projectItem(kind, x));
  const r = foldParcel(items(p.hsprc, "price"), items(p.area, "area"), [2025, 2026]);
  assert.equal(r[2026].households, 6);
  assert.equal(r[2026].cells.length, 1);
  assert.equal(r[2026].cellsBelow, 1);
  assert.equal(r[2026].cells[0].a, "85.0");
  assert.equal(r[2026].cells[0].n, 4);
  assert.deepEqual(Object.keys(r[2026].cells[0]).sort(), ["a", "f", "m", "n"].filter((k) => k in r[2026].cells[0]).sort());
  assert.equal(r[2026].cells[0].f, undefined, "층별은 층마다 호 3 이상일 때만 - 여기서는 없다");
  assert.notEqual(r[2025].cells[0].m, r[2026].cells[0].m, "stdDay 연도로 2025와 2026을 가른다");
});

test("접기: 층별(f)은 호 n>=3인 층만 남긴다", () => {
  const hs = Array.from({ length: 6 }, (_, i) => ({ id: `F${i}`, area: "84.97", flr: i < 4 ? 5 : 6, p2026: 400000000 + i * 10 })); // 5층 4호, 6층 2호
  const p = buildParcel(hs);
  const r = foldParcel(p.hsprc.map((x) => projectItem("price", x)), p.area.map((x) => projectItem("area", x)), [2025, 2026]);
  assert.deepEqual(r[2026].cells[0].f.map((x) => [x.l, x.n]), [[5, 4]]);
  assert.equal(r[2025].households, 0);
});

test("접기: 호당 항목 2건은 값이 같으면 하나, 다르면 crtnDay가 늦은 쪽이고 불일치 호 수만 센다", () => {
  const hs = [
    { id: "D1", area: "84.97", flr: 1, p2026: 400000000, dup2026: 400000000 }, // 같음
    { id: "D2", area: "84.97", flr: 1, p2026: 410000000, dup2026: 450000000, dupCrtn: "20260901" }, // 다름, 늦은 쪽 450000000
    { id: "D3", area: "84.97", flr: 1, p2026: 420000000, dup2026: 380000000, dupCrtn: "20260101" }, // 다름, 이른 쪽 380000000이 지고 420000000(20260301)이 이긴다
  ];
  const p = buildParcel(hs);
  const r = foldParcel(p.hsprc.map((x) => projectItem("price", x)), p.area.map((x) => projectItem("area", x)), [2026]);
  assert.equal(r[2026].households, 3);
  assert.equal(r[2026].mismatch, 2);
  assert.equal(r[2026].cells[0].n, 3);
  assert.equal(r[2026].cells[0].m, 420000000, "값 400000000·450000000·420000000의 중앙값");
});

test("접기: 면적 행이 없는 호는 칸에 못 들어가고 센다, 전용면적은 전유·주건축물 면적의 합", () => {
  const p = buildParcel(hogs(3, "G"));
  p.area = p.area.filter((r) => r.mgmBldrgstPk !== "FAKEPK-G-0");
  // 둘째 호에 주건축물 전유 행을 하나 더 붙여 합이 84.97 + 10 = 94.97이 되게
  p.area.push({ ...p.area[0], mgmBldrgstPk: "FAKEPK-G-1", area: "10" });
  const r = foldParcel(p.hsprc.map((x) => projectItem("price", x)), p.area.map((x) => projectItem("area", x)), [2025, 2026]);
  assert.equal(r[2026].unjoined, 1);
  assert.equal(r[2026].cells.length, 0, "칸이 둘로 갈려 둘 다 n<3");
  assert.equal(r[2026].cellsBelow, 2);
});

test("끝까지: 지번별로 받아 부분 파일을 쓰고 모의 서버 호출은 hsprc에만 요청 범위가 붙는다", async () => {
  const { ts, targets, uni } = world();
  const mock = await startMock(uni);
  const out = await tmp();
  try {
    const s = await runCollector(base({ targets, outDir: out, baseUrl: mock.base }));
    assert.equal(s.finishedNow, 3);
    assert.equal(s.status, "merged", "남은 지번이 없으면 같은 실행에서 병합한다");
    const files = await listFiles(out);
    assert.deepEqual(files, ["2025.json", "2026.json"], "병합 뒤 부분 파일은 지운다");
    const d26 = JSON.parse(await readFile(path.join(out, "2026.json"), "utf8"));
    assertDerived(d26, { allowEmptyParcels: true });
    assert.equal(d26.meta.rawCommit, COMMIT);
    assert.equal(d26.meta.requestStartDate, "20250101");
    assert.equal(d26.meta.requestEndDate, "20261231");
    assert.equal(d26.meta.license, "제한 없음");
    assert.equal(d26.meta.licenseChecked, "2026-10-01");
    assert.equal(d26.meta.apiCalls, mock.log.length);
    assert.equal(d26.meta.parcels, 3);
    assert.equal(d26.meta.cells, 1);
    assert.equal(d26.meta.cellsBelowMin, 1 + 1, "호 2개 칸 1 + 호 1개 칸 1");
    assert.equal(d26.meta.households, 6 + 1);
    assert.deepEqual(d26.parcels.map((p) => p.n).sort(), [0, 1, 6]);
    for (const l of mock.log) assert.equal(l.hasRange, l.op === "getBrHsprcInfo", "요청 범위는 hsprc에만");
    assert.ok(mock.log.every((l) => l.start === "20250101" && l.end === "20261231" || l.start === null));
    // 호 없는 지번은 면적을 받지 않는다(hsprc 1회로 끝)
    assert.equal(mock.log.filter((l) => l.key === pkey(ts[2])).length, 1);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("쪽 합산: 250호 지번은 hsprc 5쪽·면적 5쪽을 받아 합이 totalCount와 맞는다", async () => {
  const t = target(7);
  const uni = new Map([[pkey(t), buildParcel(hogs(250, "P"))]]);
  const mock = await startMock(uni);
  const out = await tmp();
  try {
    const s = await runCollector(base({ targets: targetsOf([t]), outDir: out, baseUrl: mock.base }));
    assert.equal(s.calls, 5 + 5, "항목은 호당 2025·2026 두 건이라 500건 = 5쪽, 면적은 전유+공용 500행 = 5쪽");
    const d = JSON.parse(await readFile(path.join(out, "2026.json"), "utf8"));
    assert.equal(d.cells[0].n, 250);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

const failCase = async (name, { uni, opts = {}, run = {}, rx }) => {
  const { targets } = world();
  const mock = await startMock(uni ?? world().uni, opts);
  const out = await tmp();
  try {
    await assert.rejects(() => runCollector(base({ targets, outDir: out, baseUrl: mock.base, ...run })), rx, name);
    assert.deepEqual(await listFiles(out), [], `${name}: 실패하면 아무것도 쓰지 않는다`);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
};

test("낙제: 응답 stdDay 연도가 요청 범위 밖이면 쓰기 없이 실패", async () => {
  await failCase("stdDay", { opts: { mutate: (op, list) => (op === "getBrHsprcInfo" ? list.map((x, i) => (i === 0 ? { ...x, stdDay: "20240101" } : x)) : list) }, rx: /stdDay 연도가 요청 범위 밖/ });
});

test("낙제: 쪽 합계가 totalCount와 다르면 쓰기 없이 실패", async () => {
  const t = target(1);
  const uni = new Map([[pkey(t), buildParcel(hogs(150, "S"))]]);
  const mock = await startMock(uni, { dropOnPage2: true });
  const out = await tmp();
  try {
    await assert.rejects(() => runCollector(base({ targets: targetsOf([t]), outDir: out, baseUrl: mock.base })), /쪽 합계가 totalCount와 다르다/);
    assert.deepEqual(await listFiles(out), []);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("낙제: 필수 필드(hsprc·mgmBldrgstPk·flrNo·area) 키가 응답에 없으면 쓰기 없이 실패", async () => {
  for (const [op, field] of [["getBrHsprcInfo", "hsprc"], ["getBrHsprcInfo", "mgmBldrgstPk"], ["getBrExposPubuseAreaInfo", "flrNo"], ["getBrExposPubuseAreaInfo", "area"]]) {
    await failCase(`${op}.${field}`, { opts: { mutate: (o, list) => (o === op ? list.map((x) => { const y = { ...x }; if (!(field === "flrNo" || field === "area") || y.exposPubuseGbCd === "1") delete y[field]; return y; }) : list) }, rx: /필수 필드가 없다/ });
  }
});

test("낙제: 소유자 계열 키가 응답에 있으면 쓰기 없이 멈추고 값은 어디에도 나오지 않는다 (C7)", async () => {
  const t = target(1);
  const uni = new Map([[pkey(t), buildParcel(hogs(4, "O"), { ownerField: true })]]);
  const mock = await startMock(uni);
  const out = await tmp();
  try {
    let msg = "";
    await assert.rejects(() => runCollector(base({ targets: targetsOf([t]), outDir: out, baseUrl: mock.base })), (e) => { msg = e.message; return e instanceof ApiValidationError && /소유자 계열 키/.test(e.message); });
    assert.ok(!msg.includes(FAKE_OWNER), "오류 문구에 소유자 값이 없다");
    assert.deepEqual(await listFiles(out), []);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
  for (const k of ["ownrNm", "ownerName", "jumin", "juminNo", "rrnNo", "소유자명", "성명", "주민번호", "psnNm"]) assert.match(k, OWNER_KEY_RE, k);
  for (const k of ["hsprc", "stdDay", "crtnDay", "mgmBldrgstPk", "exposPubuseGbCd", "mainAtchGbCd", "area", "flrNo", "flrGbCd", "hoNm", "dongNm", "bldNm", "platPlc"]) assert.doesNotMatch(k, OWNER_KEY_RE, k);
});

test("낙제: 이용허락 값(주입한 상수)이 비었거나 틀리거나 확인일이 365일을 넘으면 호출도 쓰기도 없이 실패 (C3)", async () => {
  const { targets, uni } = world();
  const mock = await startMock(uni);
  try {
    for (const [license, licenseChecked, rx] of [
      ["", "2026-10-01", /이용허락범위/], ["제한있음", "2026-10-01", /이용허락범위/], ["제한 없음", "", /확인일/], ["제한 없음", "2025-10-10", /365일/], ["제한 없음", "2026-12-01", /미래/], ["제한 없음", "20261001", /형식/],
    ]) {
      const out = await tmp();
      await assert.rejects(() => runCollector(base({ targets, outDir: out, baseUrl: mock.base, license, licenseChecked })), rx, `${license}/${licenseChecked}`);
      assert.deepEqual(await listFiles(out), []);
      await rm(out, { recursive: true, force: true });
    }
    assert.equal(mock.log.length, 0, "이용허락 검사에서 멈추면 호출하지 않는다");
    assert.doesNotThrow(() => checkLicense({ license: "제한 없음", checked: "2025-10-11", now: NOW }), "정확히 365일은 통과");
    assert.throws(() => checkLicense({ license: "제한 없음", checked: "2025-10-10", now: NOW }), /365일/);
  } finally { await mock.close(); }
});

test("낙제: n<3 칸이 값을 가지거나 허용 외 필드가 있으면 쓰기 직전 검사(buildPart·loadState)가 막는다 (C2·C4)", async () => {
  const t = target(1);
  const meta = { source: "data.go.kr/data/15134735", license: "제한 없음", licenseChecked: "2026-10-01", rawCommit: COMMIT, requestStartDate: "20250101", requestEndDate: "20261231", apiCalls: 1, targetParcels: 1, cappedParcels: 0 };
  const cell = { a: "84.9", n: 2, m: 1 };
  const byYear = { 2026: { cells: [cell], cellsBelow: 0, households: 2, mismatch: 0, unjoined: 0, invalid: 0 } };
  assert.throws(() => buildPart({ year: 2026, finished: [{ t, byYear }], meta }), /칸 호수/);
  byYear[2026].cells = [{ a: "84.9", n: 3, m: 1, hoNm: "가짜호" }];
  assert.throws(() => buildPart({ year: 2026, finished: [{ t, byYear }], meta }), /허용 외 필드/);
  byYear[2026].cells = [{ a: "84.9", n: 3, m: 1, f: [{ l: 1, n: 2, m: 1 }] }];
  assert.throws(() => buildPart({ year: 2026, finished: [{ t, byYear }], meta }), /층 호수/);
  byYear[2026].cells = [];
  assert.throws(() => buildPart({ year: 2026, finished: [{ t, byYear }], meta: { ...meta, ownerName: "x" } }), /허용 외 필드/);
  assert.doesNotThrow(() => buildPart({ year: 2026, finished: [{ t, byYear }], meta }));

  // 이미 디스크에 있는 부분 파일에 허용 외 키가 있으면 이어 받기도 멈춘다
  const out = await tmp();
  try {
    await mkdir(path.join(out, "2026"), { recursive: true });
    const bad = buildPart({ year: 2026, finished: [{ t, byYear }], meta });
    bad.parcels[0].hoNm = "가짜호";
    await writeFile(path.join(out, "2026", "part-001.json"), JSON.stringify(bad));
    await assert.rejects(() => loadState(out, [2026]), /허용 외 필드/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("연결: 부분 파일은 쓰기 직전 assertDerived를 거친다 (foldStream 끝 연결 시험의 API 경로판)", async () => {
  const src = await readFile(path.join(root, "scripts", "official-price-api.mjs"), "utf8");
  const body = src.slice(src.indexOf("export function buildPart"), src.indexOf("/** 진행 요약용 투영"));
  const call = body.indexOf("assertDerived(out");
  assert.ok(call > 0, "buildPart 안에 assertDerived 호출이 없다");
  assert.ok(call < body.lastIndexOf("return out;"), "assertDerived가 return보다 뒤에 있다");
  const run = src.slice(src.indexOf("export async function runCollector"));
  assert.ok(run.indexOf("buildPart(") < run.indexOf("writeFile("), "buildPart가 쓰기보다 앞이어야 한다");
  assert.ok(src.slice(src.indexOf("async function readParts")).indexOf("assertDerived(data") > 0, "읽어 들이는 부분 파일도 검사한다");
  const fold = await readFile(path.join(root, "scripts", "official-price-fold.mjs"), "utf8");
  const fb = fold.slice(fold.indexOf("export async function foldStream"));
  assert.ok(fb.indexOf("assertDerived(out);") > 0 && fb.indexOf("assertDerived(out);") < fb.lastIndexOf("return out;"), "foldStream 끝 assertDerived");
});

test("이어 받기: 예산이 모자라 멈춘 뒤 다시 돌리면 끝난 지번을 건너뛰고 결과가 한 번에 받은 것과 같다", async () => {
  const ts = [1, 2, 3, 4, 5, 6].map((n) => target(n));
  const uni = new Map(ts.map((t, i) => [pkey(t), buildParcel(hogs(3 + i, `R${i}`, "84.97", 0))]));
  const norm = (d) => ({ ...d, meta: { ...d.meta, apiCalls: 0 } });

  const mockA = await startMock(uni);
  const outA = await tmp();
  await runCollector(base({ targets: targetsOf(ts), outDir: outA, baseUrl: mockA.base }));
  const full = { 2025: norm(JSON.parse(await readFile(path.join(outA, "2025.json"), "utf8"))), 2026: norm(JSON.parse(await readFile(path.join(outA, "2026.json"), "utf8"))) };
  await mockA.close();

  const mockB = await startMock(uni);
  const outB = await tmp();
  try {
    const r1 = await runCollector(base({ targets: targetsOf(ts), outDir: outB, baseUrl: mockB.base, budget: 7 })); // 지번당 2회
    assert.equal(r1.status, "stopped");
    assert.match(r1.stopReason, /예산/);
    assert.ok(r1.finishedNow >= 1 && r1.finishedNow < 6);
    assert.ok((await listFiles(outB)).some((f) => /part-001/.test(f)));
    assert.ok(r1.calls <= 7);
    const callsBefore = mockB.log.length;
    const r2 = await runCollector(base({ targets: targetsOf(ts), outDir: outB, baseUrl: mockB.base, budget: 1000 }));
    assert.equal(r2.doneBefore, r1.finishedNow);
    assert.equal(r2.merged, true);
    const seen = new Set(mockB.log.slice(0, callsBefore).map((l) => l.key));
    const doneKeys = [...seen];
    // 2차 실행은 1차에 끝난 지번을 다시 부르지 않는다(1차에서 중간에 끊긴 지번은 처음부터 다시 받는다)
    const finished1 = r1.finishedNow;
    const second = new Set(mockB.log.slice(callsBefore).map((l) => l.key));
    assert.equal(second.size, 6 - finished1);
    assert.ok(doneKeys.length >= finished1);
    const got = { 2025: norm(JSON.parse(await readFile(path.join(outB, "2025.json"), "utf8"))), 2026: norm(JSON.parse(await readFile(path.join(outB, "2026.json"), "utf8"))) };
    assert.deepEqual(got, full);
    assert.deepEqual(await listFiles(outB), ["2025.json", "2026.json"]);
    // 병합이 끝난 뒤의 실행은 호출 없이 초록으로 끝난다
    const n = mockB.log.length;
    const r3 = await runCollector(base({ targets: targetsOf(ts), outDir: outB, baseUrl: mockB.base, license: undefined }));
    assert.equal(r3.status, "complete");
    assert.equal(mockB.log.length, n);
  } finally { await mockB.close(); await rm(outA, { recursive: true, force: true }); await rm(outB, { recursive: true, force: true }); }
});

test("이어 받기: 지번 중간에 끊기면 그 지번의 일부 값이 상태에 남지 않는다", async () => {
  const ts = [target(1), target(2)];
  const uni = new Map([[pkey(ts[0]), buildParcel(hogs(250, "M"))], [pkey(ts[1]), buildParcel(hogs(250, "N"))]]);
  const mock = await startMock(uni);
  const out = await tmp();
  try {
    const order = orderTargets(targetsOf(ts)).map(([k]) => k);
    // 첫 지번은 hsprc 3쪽 + 면적 5쪽 = 8회. 12회까지만 허용하면 둘째 지번은 중간(hsprc 3쪽 뒤 면적 첫 쪽 전후)에서 끊긴다.
    const r = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: mock.base, budget: 12 }));
    assert.equal(r.finishedNow, 1);
    const state = await loadState(out, [2025, 2026]);
    assert.deepEqual([...state.done], [order[0]]);
    const text = await readAll(out);
    assert.equal(JSON.parse(await readFile(path.join(out, "2026", "part-001.json"), "utf8")).parcels.length, 1);
    assert.ok(!text.includes("FAKEPK"));
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("한도 코드 22: 끝난 지번까지 저장하고 정상 종료(던지지 않음), 끊긴 지번은 상태에 없다", async () => {
  const ts = [1, 2, 3, 4].map((n) => target(n));
  const uni = new Map(ts.map((t, i) => [pkey(t), buildParcel(hogs(4, `L${i}`))]));
  const mock = await startMock(uni, { limitAfter: 5 }); // 지번 둘(4회) + 셋째 지번 첫 호출 뒤 22
  const out = await tmp();
  try {
    const r = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: mock.base }));
    assert.equal(r.status, "stopped");
    assert.match(r.stopReason, /결과코드 22/);
    assert.equal(r.finishedNow, 2);
    const s = await loadState(out, [2025, 2026]);
    assert.equal(s.done.size, 2);
    assert.equal(r.merged, false);
    assert.deepEqual(r.errCodes, { "결과코드 22": 1 });
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("HTTP 401·403은 실패(쓰기 없음), 오류 문구에 키가 없다", async () => {
  const { targets, uni } = world();
  const mock = await startMock(uni, { status401: true });
  const out = await tmp();
  try {
    let msg = "";
    await assert.rejects(() => runCollector(base({ targets, outDir: out, baseUrl: mock.base })), (e) => { msg = e.message; return e instanceof ApiFatalError; });
    assert.ok(!msg.includes(FAKE_KEY));
    assert.deepEqual(await listFiles(out), []);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("쪽 상한: 상한 쪽 수를 넘는 지번은 값을 쓰지 않고 지번 수만 센다(hsprc·면적 첫 쪽만 호출), 나머지가 끝나면 병합한다", async () => {
  const ts = [target(1), target(2)];
  const uni = new Map([[pkey(ts[0]), buildParcel(hogs(4, "K"))], [pkey(ts[1]), buildParcel(hogs(4, "Z"))]]);
  const big = pkey(ts[1]);
  // 면적 totalCount만 상한을 넘게 흉내 낸다(hsprc는 정상). 면적 첫 쪽으로 상한을 알면 hsprc는 첫 쪽만 받고 버린다.
  const mock = await startMock(uni, { totalOf: (op, key) => (key === big && op === "getBrExposPubuseAreaInfo" ? MAX_PAGES_PER_PARCEL * 100 + 1 : undefined), mutate: (op, list, { key }) => (key === big ? list.concat(Array.from({ length: 100 }, (_, i) => ({ ...list[0], mgmBldrgstPk: `FAKEPK-pad-${i}` }))) : list) });
  const out = await tmp();
  try {
    const r = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: mock.base }));
    assert.equal(r.cappedParcels, 1);
    assert.equal(r.finishedNow, 1);
    assert.deepEqual(mock.log.filter((l) => l.key === big).map((l) => `${l.op}#${l.page}`), ["getBrHsprcInfo#1", "getBrExposPubuseAreaInfo#1"], "상한 지번은 두 오퍼레이션의 첫 쪽만 부른다(hsprc 전체 재수신 없음)");
    assert.equal(r.merged, true);
    const d = JSON.parse(await readFile(path.join(out, "2026.json"), "utf8"));
    assert.equal(d.meta.cappedParcels, 1);
    assert.equal(d.parcels.length, 1);
    assert.equal(d.meta.targetParcels, 2);
    assert.ok(summaryLines(r, 9000).some((l) => /쪽 상한\(1500쪽\) 지번 1\(지번 수만/.test(l)));
    assert.equal(MAX_PAGES_PER_PARCEL, 1500);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("쪽 상한 1,500: 1,070쪽(면적)·1,070쪽(hsprc) 큰 지번은 끝까지 받아 접히고 쪽 합이 맞다", async () => {
  const t = target(1);
  const uni = new Map([[pkey(t), buildParcel(hogs(53500, "BIG"))]]); // hsprc 107,000건 = 1,070쪽, 면적 107,000행 = 1,070쪽
  const mock = await startMock(uni);
  const out = await tmp();
  try {
    const r = await runCollector(base({ targets: targetsOf([t]), outDir: out, baseUrl: mock.base, budget: 5000 }));
    assert.equal(r.cappedParcels, 0);
    assert.equal(r.finishedNow, 1);
    assert.equal(r.calls, 2140);
    assert.equal(r.merged, true);
    const d = JSON.parse(await readFile(path.join(out, "2026.json"), "utf8"));
    assert.equal(d.parcels[0].n, 53500);
    assert.equal(d.cells[0].n, 53500);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("쪽 상한 초과 지번: 같은 실행에서도 다음 실행에서도 hsprc를 다시 받지 않고, 상한을 올린 뒤 다음 실행은 그 지번을 받는다(병합 전)", async () => {
  const ts = [target(1), target(2), target(3)];
  const uni = new Map([[pkey(ts[0]), buildParcel(hogs(4, "S"))], [pkey(ts[1]), buildParcel(hogs(250, "P").map((h) => ({ ...h, p2025: 0 })))], [pkey(ts[2]), buildParcel(hogs(3, "F"))]]); // 250호: hsprc 3쪽(2026만)·면적 5쪽
  const capped = pkey(ts[1]);
  const out = await tmp();
  try {
    // 1회: 상한 3쪽 -> 250호 지번은 상한 지번, F 지번은 일시 오류라 병합 안 됨(부분 파일만 남음)
    const m1 = await startMock(uni, { failKeys: new Set([pkey(ts[2])]) });
    const r1 = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: m1.base, maxPages: 3 }));
    await m1.close();
    assert.equal(r1.cappedParcels, 1);
    assert.equal(r1.abandoned, 1);
    assert.equal(r1.merged, false);
    assert.deepEqual(m1.log.filter((l) => l.key === capped).map((l) => `${l.op}#${l.page}`), ["getBrHsprcInfo#1", "getBrExposPubuseAreaInfo#1"]);
    // 2회: 같은 상한 -> 상한 지번은 또 첫 쪽 둘만(hsprc 2~5쪽 없음)
    const m2 = await startMock(uni);
    const r2 = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: m2.base, maxPages: 3 }));
    await m2.close();
    assert.equal(r2.cappedParcels, 1);
    assert.deepEqual(m2.log.filter((l) => l.key === capped).map((l) => `${l.op}#${l.page}`), ["getBrHsprcInfo#1", "getBrExposPubuseAreaInfo#1"]);
    assert.equal(r2.merged, true, "남은 것이 상한 지번뿐이면 병합");
  } finally { await rm(out, { recursive: true, force: true }); }
  // 상한을 올리면(병합 파일이 없는 상태) 이전에 상한 지번으로만 분류돼 끝나지 않은 지번을 다시 받는다
  const out2 = await tmp();
  try {
    const m1 = await startMock(uni, { failKeys: new Set([pkey(ts[2])]) });
    await runCollector(base({ targets: targetsOf(ts), outDir: out2, baseUrl: m1.base, maxPages: 3 }));
    await m1.close();
    const m3 = await startMock(uni);
    const r3 = await runCollector(base({ targets: targetsOf(ts), outDir: out2, baseUrl: m3.base }));
    await m3.close();
    assert.equal(r3.cappedParcels, 0);
    assert.equal(r3.finishedNow, 2, "상한 지번이던 지번과 일시 오류였던 지번이 이번에 끝난다");
    assert.equal(m3.log.filter((l) => l.key === capped).length, 8, "hsprc 3쪽 + 면적 5쪽");
    assert.equal(r3.merged, true);
    assert.equal(JSON.parse(await readFile(path.join(out2, "2026.json"), "utf8")).meta.cappedParcels, 0);
  } finally { await rm(out2, { recursive: true, force: true }); }
});

test("병합 파일이 상한 지번을 뺀 채 있으면 호출 없이 끝나고 요약이 빠진 지번 수를 알린다", async () => {
  const ts = [target(1), target(2)];
  const uni = new Map([[pkey(ts[0]), buildParcel(hogs(4, "S"))], [pkey(ts[1]), buildParcel(hogs(250, "P").map((h) => ({ ...h, p2025: 0 })))]]);
  const out = await tmp();
  try {
    const m1 = await startMock(uni);
    const r1 = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: m1.base, maxPages: 3 }));
    await m1.close();
    assert.equal(r1.merged, true);
    const m2 = await startMock(uni);
    const r2 = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: m2.base }));
    await m2.close();
    assert.equal(r2.status, "complete");
    assert.equal(m2.log.length, 0);
    const lines = summaryLines(r2, 9000).join("\n");
    assert.match(lines, /쪽 상한 때문에 값이 빠진 채 병합된 지번이 1개/);
    assert.ok(!lines.includes("FAKEPK"));
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("요약: 투영 총 호출 수·남은 일수를 낸다", async () => {
  const ts = [1, 2, 3, 4, 5].map((n) => target(n));
  const uni = new Map(ts.map((t, i) => [pkey(t), buildParcel(hogs(4, `Q${i}`))]));
  const mock = await startMock(uni);
  const out = await tmp();
  try {
    const r = await runCollector(base({ targets: targetsOf(ts), outDir: out, baseUrl: mock.base, budget: 6 }));
    const lines = summaryLines(r, 6).join("\n");
    assert.match(lines, /투영: 지번당 평균 2\.0회 -> 총 10회, 남은 4회 = 약 1일/);
    assert.match(lines, /끝난 지번 3/);
  } finally { await mock.close(); await rm(out, { recursive: true, force: true }); }
});

test("병합: 부분 파일 사이에 같은 칸·지번이 있거나 메타가 다르면 실패", () => {
  const mk = (over = {}) => ({ name: "p", data: { meta: { source: "s", baseYear: 2026, license: "제한 없음", licenseChecked: "2026-10-01", rawCommit: COMMIT, requestStartDate: "20250101", requestEndDate: "20261231", apiCalls: 1, minHouseholds: 3, ...over }, cells: [{ s: "11110", d: "가", j: "1", a: "84.9", n: 3, m: 1 }], parcels: [{ s: "11110", d: "가", j: "1", n: 3 }] } });
  assert.throws(() => mergeParts([mk(), mk()], 2026, { targetParcels: 2, cappedParcels: 0 }), /같은 칸|같은 지번/);
  assert.throws(() => mergeParts([mk(), mk({ rawCommit: "b".repeat(40) })], 2026, { targetParcels: 2, cappedParcels: 0 }), /메타가 서로 다르다/);
});

test("대상 지번: 이름표로 법정동 코드를 풀고 고정 시드로 섞는다(같은 입력이면 같은 순서)", async () => {
  const dir = await tmp();
  try {
    await mkdir(path.join(dir, "sale"), { recursive: true });
    const it = (jibun, umd, sgg = 11110) => ({ sggCd: sgg, umdNm: umd, jibun, excluUseAr: 59, floor: 1 });
    await writeFile(path.join(dir, "sale", "11110-202501.json"), JSON.stringify({ items: [it("199", "청운동"), it("199", "청운동"), it("62-2", "청운동"), it("산1", "청운동"), it("5", "없는동"), it("0012-0003", "청운동")] }));
    const names = { "서울특별시 종로구 청운동": "1111010100" };
    const { targets, unmappedRows } = await loadTargets({ rawDir: dir, names });
    assert.equal(targets.size, 3);
    assert.equal(unmappedRows, 2);
    const t = targets.get("11110|청운동|199");
    assert.deepEqual([t.sigunguCd, t.bjdongCd, t.bun, t.ji, t.saleDeals], ["11110", "10100", "0199", "0000", 2]);
    assert.deepEqual(targets.get("11110|청운동|12-3") && [targets.get("11110|청운동|12-3").bun, targets.get("11110|청운동|12-3").ji], ["0012", "0003"]);
    assert.deepEqual(orderTargets(targets).map(([k]) => k), orderTargets(new Map([...targets].reverse())).map(([k]) => k));
    await assert.rejects(() => loadTargets({ rawDir: dir, names: { x: "1" } }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("커밋된 법정동 이름표는 housing-permits의 법정동 코드 목록과 같은 467개다", async () => {
  const names = JSON.parse(await readFile(path.join(root, "research/official-price/bjdong-names-seoul.json"), "utf8"));
  const codes = JSON.parse(await readFile(path.join(root, "research/housing-permits/bjdong-seoul.json"), "utf8"));
  const want = new Set(Object.entries(codes).flatMap(([g, ds]) => ds.map((d) => g + d)));
  assert.deepEqual(new Set(Object.values(names)), want);
  assert.equal(Object.keys(names).length, 467);
});

// ---- CLI: 비출력(C1)·시크릿 ----

async function cliWorld({ ownerField = false } = {}) {
  const dir = await tmp();
  await mkdir(path.join(dir, "raw", "sale"), { recursive: true });
  const names = { "서울특별시 종로구 청운동": "1111010100" };
  await writeFile(path.join(dir, "names.json"), JSON.stringify(names));
  const items = [];
  const uni = new Map();
  for (const [i, jibun] of ["10", "11", "12"].entries()) {
    items.push({ sggCd: 11110, umdNm: "청운동", jibun, excluUseAr: 59, floor: 1 });
    uni.set(`11110-10100-${jibun.padStart(4, "0")}-0000`, buildParcel(hogs(5, `X${i}`), { ownerField: ownerField && i === 1 }));
  }
  await writeFile(path.join(dir, "raw", "sale", "11110-202501.json"), JSON.stringify({ items }));
  return { dir, uni };
}
const runCli = async (dir, base, args = [], env = {}) => {
  const summary = path.join(dir, "summary.md");
  const r = await exec(process.execPath, [path.join(root, "scripts/fetch-official-price-api.mjs"), "--raw-dir", path.join(dir, "raw"), "--names-file", path.join(dir, "names.json"), "--out-dir", path.join(dir, "out"), "--raw-commit", COMMIT, ...args], {
    env: { PATH: process.env.PATH, PUBLIC_DATA_PORTAL_API_KEY: FAKE_KEY, OFFICIAL_PRICE_API_BASE: base, CALL_GAP_MS: "0", GITHUB_STEP_SUMMARY: summary, ...env },
  }).catch((e) => e);
  const sum = await readFile(summary, "utf8").catch(() => "");
  return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", summary: sum };
};

test("CLI: stdout·stderr·요약·파일에 호 단위 문자열(호명·동명·PK·호 가격)과 시크릿이 0회다 (C1)", async () => {
  const { dir, uni } = await cliWorld();
  const mock = await startMock(uni);
  try {
    const r = await runCli(dir, mock.base);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /끝난 지번 3/);
    const files = await readAll(path.join(dir, "out"));
    const all = [r.stdout, r.stderr, r.summary, files].join("\n");
    for (const needle of [FAKE_KEY, "가짜호", "가짜동", "가짜단지", "가짜 주소", "FAKEPK", "bldNm", "hoNm"]) assert.ok(!all.includes(needle), `${needle}가 출력·파일에 있다`);
    // 호 가격(300000000 + i*1000 등)은 칸 중앙값(n>=3)으로만 파일에 남는다 - 중앙값 외의 개별 값은 없다
    const d = JSON.parse(await readFile(path.join(dir, "out", "2026.json"), "utf8"));
    const medians = new Set(d.cells.flatMap((c) => [String(c.m), ...(c.f ?? []).map((f) => String(f.m))]));
    for (let i = 0; i < 5; i += 1) {
      const price = String(320000000 + i * 1000);
      if (medians.has(price)) continue;
      assert.ok(!all.includes(price), `호 가격 ${price}가 중앙값이 아닌데 출력·파일에 있다`);
    }
    assert.ok(mock.log.every((l) => l.serviceKey === FAKE_KEY));
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test("CLI: 소유자 계열 키가 응답에 있으면 종료 코드 1, 파일 없음, 소유자 값 비출력", async () => {
  const { dir, uni } = await cliWorld({ ownerField: true });
  const mock = await startMock(uni);
  try {
    const r = await runCli(dir, mock.base);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /소유자 계열 키/);
    assert.deepEqual(await listFiles(path.join(dir, "out")), []);
    for (const needle of [FAKE_OWNER, FAKE_KEY]) assert.ok(![r.stdout, r.stderr, r.summary].join("\n").includes(needle));
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test("CLI: 한도 코드 22는 종료 코드 0(초록)이고 끝난 지번만 저장한다", async () => {
  const { dir, uni } = await cliWorld();
  const mock = await startMock(uni, { limitAfter: 3 });
  try {
    const r = await runCli(dir, mock.base);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /중단: 결과코드 22/);
    const s = await loadState(path.join(dir, "out"), [2025, 2026]);
    assert.equal(s.done.size, 1);
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test("CLI: 이용허락 환경변수는 읽지 않는다(코드 상수만) - 변수를 틀리게 줘도 수집되고, 기본 밖 주소는 키 없이 거부", async () => {
  const { dir, uni } = await cliWorld();
  const mock = await startMock(uni);
  try {
    const r = await runCli(dir, mock.base, [], { OFFICIAL_PRICE_LICENSE: "비영리만", OFFICIAL_PRICE_LICENSE_CHECKED: "2020-01-01" });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(mock.log.length > 0);
    await rm(path.join(dir, "out"), { recursive: true, force: true });
    // 실서버 주소가 아닌 기본 밖 주소는 키를 보내지 않고 거부한다
    const bad = await runCli(dir, "https://example.com");
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /로컬 주소만/);
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test("기본 이용허락 상수(코드): 문자열이 제한 없음이고 확인일이 형식·미래·365일 안이다 - 만료되면 이 시험이 실패해 상수 갱신을 알린다 (C3)", () => {
  assert.equal(OFFICIAL_PRICE_LICENSE, "제한 없음");
  assert.match(OFFICIAL_PRICE_LICENSE_CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  // 시험 시점(실제 오늘) 기준. 실패하면: 상세 페이지(data.go.kr/data/15134735)를 다시 보고 scripts/official-price-license.mjs의 확인일을 고쳐 PR.
  assert.doesNotThrow(() => checkLicense({}), "기본 상수가 유효하지 않다(확인일 만료·형식·미래) - scripts/official-price-license.mjs 갱신 필요");
  assert.deepEqual(checkLicense({}), { license: OFFICIAL_PRICE_LICENSE, checked: OFFICIAL_PRICE_LICENSE_CHECKED });
  // 만료 경계: 확인일 + 365일은 통과, + 366일은 365일 초과로 멈춘다
  const at = new Date(`${OFFICIAL_PRICE_LICENSE_CHECKED}T00:00:00Z`);
  assert.doesNotThrow(() => checkLicense({ now: new Date(at.getTime() + 365 * 86400000) }));
  assert.throws(() => checkLicense({ now: new Date(at.getTime() + 366 * 86400000) }), /365일/);
});

test("워크플로: 건너뛰기 스텝과 이용허락 저장소 변수가 없다(상수로 옮김) - schedule은 바로 수집한다, 스텝은 6개", async () => {
  const text = await readFile(path.join(root, ".github/workflows/official-price-api.yml"), "utf8");
  const steps = text.split(/\n    steps:\n/)[1].split(/\n      - /);
  assert.equal(steps.length, 6);
  assert.doesNotMatch(text, /id: gate|steps\.gate|github\.event_name|vars\./);
  assert.doesNotMatch(text, /OFFICIAL_PRICE_LICENSE[A-Z_]*:/, "이용허락 값을 env로 받지 않는다");
  assert.ok(steps.findIndex((x) => /secrets\./.test(x)) > 0);
});

test("CLI: collect 예산 입력은 9,000으로 자르고 notice를 낸다(9,000 이하는 그대로), explore는 기존대로 9,001도 받는다", async () => {
  const { dir, uni } = await cliWorld();
  const mock = await startMock(uni);
  try {
    const big = await runCli(dir, mock.base, [], { DAILY_CALL_BUDGET: "9001" });
    assert.equal(big.code, 0, big.stderr);
    assert.match(big.stdout, /::notice::호출 예산 입력 9001회가 상한 9000회를 넘어 9000회로 잘랐다/);
    assert.match(big.stdout, /\(예산 9000\)/);
    await rm(path.join(dir, "out"), { recursive: true, force: true });
    const flag = await runCli(dir, mock.base, ["--budget", "50000"]);
    assert.match(flag.stdout, /\(예산 9000\)/);
    await rm(path.join(dir, "out"), { recursive: true, force: true });
    const ok = await runCli(dir, mock.base, [], { DAILY_CALL_BUDGET: "9000" });
    assert.doesNotMatch(ok.stdout, /::notice::호출 예산 입력/);
    assert.match(ok.stdout, /\(예산 9000\)/);
    await rm(path.join(dir, "out"), { recursive: true, force: true });
    const small = await runCli(dir, mock.base, [], { DAILY_CALL_BUDGET: "123" });
    assert.match(small.stdout, /\(예산 123\)/);
    const ex = await runCli(dir, mock.base, ["--explore"], { DAILY_CALL_BUDGET: "9001", EXPLORE_JIBUN: "1", EXPLORE_BIG: "0" });
    assert.doesNotMatch(ex.stdout, /::notice::호출 예산 입력/);
    assert.match(ex.stdout, /\(예산 9001\)/);
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test("탐색 모드(--explore): 파일을 쓰지 않고 집계만 낸다, 호·PK·가격 비출력", async () => {
  const { dir } = await cliWorld();
  const uni = new Map();
  // 호당 2건(값 일치 1, 불일치 1)·2025/2026 호 집합 일부만 겹침
  uni.set("11110-10100-0010-0000", buildParcel([
    { id: "E1", area: "84.97", flr: 1, p2025: 300000001, p2026: 310000001, dup2026: 310000001 },
    { id: "E2", area: "84.97", flr: 2, p2025: 300000002, p2026: 310000002, dup2026: 330000002 },
    { id: "E3", area: "84.97", flr: 3, p2026: 310000003 },
  ]));
  uni.set("11110-10100-0011-0000", buildParcel(hogs(250, "Y")));
  uni.set("11110-10100-0012-0000", buildParcel(hogs(3, "W")));
  const mock = await startMock(uni, { limitAfter: 10 });
  try {
    const r = await runCli(dir, mock.base, ["--explore"], { EXPLORE_JIBUN: "3", EXPLORE_BIG: "0" });
    assert.equal(r.code, 0, r.stderr);
    for (const head of ["(a) 호당 항목", "(b) 요청 범위", "(c) 큰 단지", "(d) 면적 응답", "(e) 일 한도", "(f) 서울 전체 투영"]) assert.ok(r.stdout.includes(head), head);
    assert.deepEqual(await listFiles(path.join(dir, "out")), [], "탐색은 쓰기 없음");
    const all = [r.stdout, r.stderr, r.summary].join("\n");
    for (const needle of [FAKE_KEY, "가짜호", "가짜동", "FAKEPK", "3100000"]) assert.ok(!all.includes(needle), `${needle}`);
    assert.match(r.stdout, /결과코드 22/);
    assert.match(r.stdout, /오퍼레이션/);
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test("탐색: 호당 2건 일치율·stdDay 분포·호 집합 일치율·면적 조기 종료 가능성을 집계로 낸다", async () => {
  const ts = [target(1), target(2)];
  const uni = new Map([
    [pkey(ts[0]), buildParcel([
      { id: "E1", area: "84.97", flr: 1, p2025: 1, p2026: 3, dup2026: 3 },
      { id: "E2", area: "84.97", flr: 2, p2025: 1, p2026: 3, dup2026: 4 },
      { id: "E3", area: "84.97", flr: 3, p2026: 3 },
    ])],
    [pkey(ts[1]), buildParcel(hogs(150, "V"))],
  ]);
  const mock = await startMock(uni);
  try {
    const r = await runExplore({ key: FAKE_KEY, baseUrl: mock.base, targets: targetsOf(ts), startDate: "20250101", endDate: "20261231", sampleN: 2, bigN: 0, budget: 500, gapMs: 0 });
    const text = r.lines.join("\n");
    assert.match(text, /2건 묶음 중 값이 같은 것 1\/2 \(50\.0%\)/);
    assert.match(text, /stdDay 연도 분포 \{"2025":\d+,"2026":\d+\}/);
    assert.match(text, /2026 기준 호 \d+, 둘 다에 있는 호/);
    assert.match(text, /조기 종료 가능성: 2026 기준 호가 전유 행에 전부 나온 지번 2\/2/);
    assert.match(text, /대상 2지번 투영 총 \d+회/);
    assert.ok(!text.includes("FAKEPK"));
  } finally { await mock.close(); }
});

test("탐색 (g): 큰 단지 면적에 pageNo 999·1000을 요청해 HTTP·결과코드·항목 수만 낸다(1,070쪽 지번은 정상 수신)", async () => {
  const ts = [target(1), target(2, { saleDeals: 9 })];
  const uni = new Map([[pkey(ts[0]), buildParcel(hogs(3, "G"))], [pkey(ts[1]), buildParcel(hogs(53500, "BIG"))]]);
  const mock = await startMock(uni);
  try {
    const r = await runExplore({ key: FAKE_KEY, baseUrl: mock.base, targets: targetsOf(ts), startDate: "20250101", endDate: "20261231", sampleN: 1, bigN: 1, budget: 6000, gapMs: 0 });
    const text = r.lines.join("\n");
    assert.match(text, /### \(g\)/);
    assert.match(text, /시험 지번의 면적 쪽 수 1070\n/);
    assert.match(text, /pageNo=999: HTTP 200, 결과코드 00, 항목 100건, totalCount 107000 -> 정상/);
    assert.match(text, /pageNo=1000: HTTP 200, 결과코드 00, 항목 100건, totalCount 107000 -> 정상/);
    for (const needle of ["FAKEPK", "가짜", FAKE_KEY, "3200000"]) assert.ok(!text.includes(needle), needle);
    assert.deepEqual(mock.log.slice(-2).map((l) => `${l.op}#${l.page}`), ["getBrExposPubuseAreaInfo#999", "getBrExposPubuseAreaInfo#1000"], "마지막 두 호출이 pageNo 시험");
  } finally { await mock.close(); }
});

test("탐색 (g): 서버가 큰 쪽 번호를 거절하면(결과코드 10) 거절 의심으로 집계하고 후속(dongNm 분할)을 안내한다", async () => {
  const ts = [target(1), target(2, { saleDeals: 9 })];
  const uni = new Map([[pkey(ts[0]), buildParcel(hogs(3, "G"))], [pkey(ts[1]), buildParcel(hogs(250, "B"))]]);
  const mock = await startMock(uni, { rejectPageAbove: 100 });
  try {
    const r = await runExplore({ key: FAKE_KEY, baseUrl: mock.base, targets: targetsOf(ts), startDate: "20250101", endDate: "20261231", sampleN: 1, bigN: 1, budget: 500, gapMs: 0 });
    const text = r.lines.join("\n");
    assert.match(text, /pageNo=1000: HTTP 200, 결과코드 10, 항목 0건, totalCount 0 -> 거절 의심/);
    assert.match(text, /dongNm별로 나눠 받는다\(PR-A2\)/);
    assert.ok(!text.includes("FAKEPK") && !text.includes(FAKE_KEY));
  } finally { await mock.close(); }
});

test("워크플로: official-price-api.yml은 dispatch+schedule, 별도 concurrency, SHA 고정, 시크릿은 호출 스텝 env에만, 입력은 env 경유", async () => {
  const text = await readFile(path.join(root, ".github/workflows/official-price-api.yml"), "utf8");
  assert.match(text, /^on:\n/m);
  assert.match(text, /\n  workflow_dispatch:\n/);
  assert.match(text, /\n  schedule:\n    - cron: /);
  assert.match(text, /permissions:\n  contents: write\n/);
  assert.match(text, /timeout-minutes: 300/);
  assert.match(text, /concurrency:\n  group: official-price-api\n/);
  assert.doesNotMatch(text, /group: digest-pipeline/);
  for (const m of text.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  // 시크릿은 secrets.PUBLIC_DATA_PORTAL_API_KEY 하나뿐이고 호출 스텝(수집) 블록 안에만 있다
  const refs = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(refs, ["PUBLIC_DATA_PORTAL_API_KEY"]);
  const jobEnv = text.split(/\n    steps:/)[0];
  assert.doesNotMatch(jobEnv, /secrets\./);
  const steps = text.split(/\n      - /);
  const holders = steps.filter((s) => /secrets\./.test(s));
  assert.equal(holders.length, 1);
  assert.match(holders[0], /fetch-official-price-api\.mjs/);
  assert.match(holders[0], /\n        env:\n(?:          .*\n)*?          PUBLIC_DATA_PORTAL_API_KEY: \$\{\{ secrets\.PUBLIC_DATA_PORTAL_API_KEY \}\}/);
  for (const block of text.split(/\n\s+run: /).slice(1)) assert.doesNotMatch(block.split("\n      - ")[0], /\$\{\{\s*(inputs|vars)\./, "run에 입력·변수를 직접 보간하지 않는다");
  assert.doesNotMatch(text, /actions\/cache|upload-artifact/);
  assert.doesNotMatch(text, /set -x|ACTIONS_STEP_DEBUG/);
  // daily-update는 건드리지 않았다: 이 워크플로의 이름이 거기 없다
  const daily = await readFile(path.join(root, ".github/workflows/daily-update.yml"), "utf8");
  assert.doesNotMatch(daily, /official-price-api/);
});
