import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, mkdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertDerived, foldStream, parseCsvLine, mapHeader, median } from "../scripts/official-price-fold.mjs";
import { normalizeJibun, areaKey, cellKey, cellKeyOfDeal, parcelKey, parcelKeyOfDeal } from "../scripts/official-price-key.mjs";
import { targetParcels } from "../scripts/fetch-official-price.mjs";

// 합성 입력만 쓴다 - 실제 공시가격 파일은 받지 않는다(15,851,336행, 호 단위 행).
const HEADER = ["시군구코드", "법정동명", "지번", "전용면적", "층", "호명", "공시가격", "기준연도", "단지명"];
const row = (sgg, dong, jibun, area, floor, ho, price, year = "2025") =>
  [sgg, dong, jibun, area, floor, ho, price, year, "가상단지"];
const csv = (rows, header = HEADER) =>
  "﻿" + [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\r\n") + "\r\n";
const sha = (text) => createHash("sha256").update(text).digest("hex");

const TARGET = parcelKey("11110", "가상동", "12-3");
const BASE = {
  license: "제한 없음", baseYear: 2025, pageModified: "2026-10-07",
  rawCommit: "a".repeat(40), targets: new Set([TARGET]),
};
// 호 3개(층 1·1·2) + 호 2개 칸 + 서울 밖 + 대상 아닌 지번
const GOOD = csv([
  row("1111010100", "가상동", "12-3", "84.97", "1", "101", "300000000"),
  row("1111010100", "가상동", "12-3", "84.97", "1", "102", "310000000"),
  row("1111010100", "가상동", "12-3", "84.97", "2", "201", "400000000"),
  row("1111010100", "가상동", "12-3", "59.9", "3", "301", "200000000"),
  row("1111010100", "가상동", "12-3", "59.9", "4", "401", "210000000"),
  row("1111010100", "가상동", "99", "84.97", "1", "101", "1"),
  row("2611010100", "가상동", "12-3", "84.97", "1", "101", "1"),
]);
const run = (text, extra = {}) => {
  const input = { ...BASE, sha256: sha(text), rows: 7, ...extra };
  return foldStream(Readable.from([Buffer.from(text)]), input);
};

test("키: 지번·면적 정규화가 실거래 원본과 공시가격 양쪽에서 같다", () => {
  assert.equal(normalizeJibun(199), "199");
  assert.equal(normalizeJibun("0062-0002"), "62-2");
  assert.equal(normalizeJibun("62-0"), "62");
  assert.equal(normalizeJibun("산 3-1"), "산3-1");
  assert.equal(normalizeJibun("abc"), null);
  assert.equal(areaKey("84.9700"), "85.0");
  assert.equal(areaKey(138.6533), "138.7");
  assert.equal(areaKey(0), null);
  assert.equal(cellKeyOfDeal({ sggCd: 11110, umdNm: "가상동", jibun: "12-3", excluUseAr: 84.97 }), cellKey("1111010100", "가상동", "0012-03", "84.97"));
  assert.equal(parcelKeyOfDeal({ sggCd: 11110, umdNm: "가상동", jibun: "12-3" }), TARGET);
});

test("접기: 호 3개 이상 칸·층만 값을 남기고 호 1~2개 칸은 값을 버리고 칸 수만 센다 (C2)", async () => {
  const out = await run(GOOD);
  assert.equal(out.cells.length, 1);
  assert.equal(out.meta.cellsBelowMin, 1);
  const [cell] = out.cells;
  assert.deepEqual({ s: cell.s, d: cell.d, j: cell.j, a: cell.a, n: cell.n, m: cell.m }, { s: "11110", d: "가상동", j: "12-3", a: "85.0", n: 3, m: 310000000 });
  assert.equal(cell.f, undefined, "층마다 호가 3개 미만이면 층 값도 없다");
  assert.deepEqual(out.parcels, [{ s: "11110", d: "가상동", j: "12-3", n: 5 }]);
  assert.equal(out.meta.seoulRows, 6);
  assert.equal(out.meta.targetParcelsFound, 1);
  assert.equal(out.meta.sha256Of, "csv");
});

test("접기: 층에 호 3개가 있으면 층 값이 남고 호 1~2개 층은 빠진다", async () => {
  const rows = [1, 2, 3].map((i) => row("1111010100", "가상동", "12-3", "84.97", "5", `50${i}`, String(i * 100)));
  rows.push(row("1111010100", "가상동", "12-3", "84.97", "6", "601", "999"));
  const text = csv(rows);
  const out = await foldStream(Readable.from([Buffer.from(text)]), { ...BASE, sha256: sha(text), rows: 4 });
  assert.deepEqual(out.cells[0].f, [{ l: 5, n: 3, m: 200 }]);
  assert.equal(out.cells[0].n, 4);
});

test("낙제: 호 1~2개 칸만 있으면 값이 하나도 나오지 않는다 (C2)", async () => {
  const text = csv([
    row("1111010100", "가상동", "12-3", "84.97", "1", "101", "300000000"),
    row("1111010100", "가상동", "12-3", "84.97", "2", "201", "400000000"),
  ]);
  const out = await foldStream(Readable.from([Buffer.from(text)]), { ...BASE, sha256: sha(text), rows: 2 });
  assert.deepEqual(out.cells, []);
  assert.equal(out.meta.cellsBelowMin, 1);
  assert.doesNotMatch(JSON.stringify(out), /300000000|400000000/);
});

test("낙제: 해시·행수·기준연도·이용허락 문자열이 어긋나면 던진다", async () => {
  await assert.rejects(run(GOOD, { sha256: "0".repeat(64) }), /SHA-256 불일치/);
  await assert.rejects(run(GOOD, { rows: 8 }), /행수 불일치/);
  await assert.rejects(run(GOOD, { baseYear: 2026 }), /기준연도/);
  await assert.rejects(run(GOOD, { license: "공공누리 1유형" }), /이용허락범위/);
  await assert.rejects(run(GOOD, { license: "" }), /이용허락범위/);
  await assert.rejects(run(GOOD, { rawCommit: "main" }), /rawCommit/);
  await assert.rejects(run(GOOD, { targets: new Set() }), /대상 지번/);
  const mixed = csv([row("1111010100", "가상동", "12-3", "84.97", "1", "101", "1", "2024")]);
  await assert.rejects(foldStream(Readable.from([Buffer.from(mixed)]), { ...BASE, sha256: sha(mixed), rows: 1 }), /기준연도/);
});

test("해시: 페이지 기재값이 zip 해시여도 환경으로 받은 zip 해시와 맞으면 통과하고 어느 쪽인지 남긴다", async () => {
  const zipSha = "ab".repeat(32);
  const out = await run(GOOD, { sha256: zipSha, zipSha256: zipSha });
  assert.equal(out.meta.sha256Of, "zip");
});

test("헤더: 필수 열이 없거나 알 수 없는 헤더면 던지고, 열 순서는 상관없다 (3)", async () => {
  const noPrice = HEADER.filter((h) => h !== "공시가격");
  assert.throws(() => mapHeader(noPrice), /필수 열이 헤더에 없다.*price/);
  assert.throws(() => mapHeader([...HEADER, "처음보는열"]), /알 수 없는 헤더: 처음보는열/);
  assert.throws(() => mapHeader([...HEADER, "공시가격"]), /두 번/);
  const shuffled = [...HEADER].reverse();
  assert.ok(mapHeader(shuffled).price >= 0);
  const split = HEADER.filter((h) => h !== "지번").concat(["본번", "부번"]);
  assert.ok(mapHeader(split).main >= 0);
  // 열 순서를 바꿔도 같은 결과
  const r = (x) => [...x].reverse();
  const text = csv(
    [1, 2, 3].map((i) => r(row("1111010100", "가상동", "12-3", "84.97", "1", `10${i}`, String(i)))),
    r(HEADER),
  );
  const out = await foldStream(Readable.from([Buffer.from(text)]), { ...BASE, sha256: sha(text), rows: 3 });
  assert.equal(out.cells[0].n, 3);
});

test("헤더: 본번·부번 두 열도 지번 정규화로 같은 칸이 된다", async () => {
  const header = HEADER.filter((h) => h !== "지번").concat(["본번", "부번"]);
  const rows = [1, 2, 3].map((i) => ["1111010100", "가상동", "84.97", "1", `10${i}`, "5", "2025", "x", "0012", "03"]);
  // 열 순서: 시군구코드, 법정동명, 전용면적, 층, 호명, 공시가격, 기준연도, 단지명, 본번, 부번
  const text = csv(rows, header);
  const out = await foldStream(Readable.from([Buffer.from(text)]), { ...BASE, sha256: sha(text), rows: 3 });
  assert.equal(out.cells[0].j, "12-3");
});

test("CSV: BOM 제거, 큰따옴표 이스케이프, 빈 필드, 청크 경계에 걸린 한글", async () => {
  assert.deepEqual(parseCsvLine('"a","b""c",""'), ["a", 'b"c', ""]);
  assert.deepEqual(parseCsvLine('a,,c,'), ["a", "", "c", ""]);
  assert.throws(() => parseCsvLine('"a,b'), /따옴표/);
  const buf = Buffer.from(GOOD);
  const out = await foldStream(Readable.from([buf.subarray(0, 50), buf.subarray(50, 53), buf.subarray(53)]), { ...BASE, sha256: sha(GOOD), rows: 7 });
  assert.equal(out.cells.length, 1);
  assert.equal(median([1, 2]), 2);
  assert.equal(median([3, 1, 2]), 2);
});

test("낙제: 열 수가 다른 줄이 있으면 던지고 오류에 원본 행 내용이 없다 (C1)", async () => {
  const text = GOOD + '"1111010100","가상동","비밀단지-101호"\r\n';
  const err = await run(text, { rows: 8 }).catch((e) => e);
  assert.match(err.message, /열 수/);
  assert.doesNotMatch(err.message, /비밀단지|101호/);
});

test("낙제: 허용 외 필드가 하나라도 있으면 실패한다 (C4)", async () => {
  const good = await run(GOOD);
  assert.doesNotThrow(() => assertDerived(good));
  const clone = () => structuredClone(good);

  for (const [where, mutate] of [
    ["top", (o) => { o.rows = []; }],
    ["meta", (o) => { o.meta.hoName = "101호"; }],
    ["cell 호", (o) => { o.cells[0].ho = "101"; }],
    ["cell 단지", (o) => { o.cells[0].apt = "가상단지"; }],
    ["parcel 동", (o) => { o.parcels[0].dong = "101동"; }],
    ["floor", (o) => { o.cells[0].f = [{ l: 1, n: 3, m: 1, ho: "101" }]; }],
  ]) {
    const o = clone();
    mutate(o);
    assert.throws(() => assertDerived(o), /허용 외 필드/, where);
  }
});

test("낙제: 호 n<3 칸·층이나 minHouseholds를 낮춘 결과는 실패한다 (C2)", async () => {
  const good = await run(GOOD);
  const lowCell = structuredClone(good); lowCell.cells[0].n = 2;
  assert.throws(() => assertDerived(lowCell), /칸 호수/);
  const lowFloor = structuredClone(good); lowFloor.cells[0].f = [{ l: 1, n: 2, m: 5 }];
  assert.throws(() => assertDerived(lowFloor), /층 호수/);
  const lowMin = structuredClone(good); lowMin.meta.minHouseholds = 1;
  assert.throws(() => assertDerived(lowMin), /minHouseholds/);
});

test("대상 지번: raw/sale·raw/rent 슬롯 파일에서 서울 지번을 모은다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "op-raw-"));
  for (const kind of ["sale", "rent"]) await mkdir(path.join(dir, kind));
  const slot = (items) => JSON.stringify({ ok: true, items });
  await writeFile(path.join(dir, "sale", "11110-202501.json"), slot([{ sggCd: 11110, umdNm: "가상동", jibun: "12-3" }, { sggCd: 11110, umdNm: "가상동", jibun: "" }]));
  await writeFile(path.join(dir, "rent", "11110-202501.json"), slot([{ sggCd: 11110, umdNm: "다른동", jibun: 7 }]));
  assert.deepEqual([...await targetParcels(dir)].sort(), ["11110|가상동|12-3", "11110|다른동|7"]);
});

const execFileP = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

test("CLI: 입력이 어긋나면 종료 코드 1이고 아무 파일도 만들지 않는다", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "op-cli-"));
  await mkdir(path.join(work, "raw", "sale"), { recursive: true });
  await writeFile(path.join(work, "raw", "sale", "11110-202501.json"), JSON.stringify({ items: [{ sggCd: 11110, umdNm: "가상동", jibun: "12-3" }] }));
  const out = path.join(work, "out");
  const args = (extra = {}) => {
    const a = { "--sha256": sha(GOOD), "--rows": "7", "--base-year": "2025", "--license": "제한 없음", "--raw-commit": "b".repeat(40), "--raw-dir": path.join(work, "raw"), "--out-dir": out, ...extra };
    return ["scripts/fetch-official-price.mjs", ...Object.entries(a).flat()];
  };
  const spawn = (a) => new Promise((resolve) => {
    const child = execFile("node", a, { cwd: root }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
    child.stdin.end(GOOD);
  });

  const bad = await spawn(args({ "--sha256": "0".repeat(64) }));
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /SHA-256 불일치/);
  await assert.rejects(stat(out));
  assert.equal((await spawn(args({ "--license": "저작자표시" }))).code, 1);
  await assert.rejects(stat(out));

  const ok = await spawn(args());
  assert.equal(ok.code, 0, ok.stderr);
  const written = JSON.parse(await readFile(path.join(out, "2025.json"), "utf8"));
  assert.doesNotThrow(() => assertDerived(written));
  assert.equal(written.meta.rawCommit, "b".repeat(40));
});

test("커밋된 raw/official-price/*.json은 허용 필드만 가진다 (C1·C4, 파일이 없으면 검사할 것이 없다)", async () => {
  let names = [];
  try { names = await readdir(path.join(root, "raw", "official-price")); } catch { /* 첫 dispatch 전 */ }
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const data = JSON.parse(await readFile(path.join(root, "raw", "official-price", name), "utf8"));
    assert.doesNotThrow(() => assertDerived(data), name);
    assert.equal(data.meta.license, "제한 없음", name);
  }
});

test("워크플로: dispatch 전용, 시크릿 없음, 최소 권한, 액션 SHA 고정, 입력이 run에 직접 박히지 않는다", async () => {
  const text = await readFile(path.join(root, ".github/workflows/official-price.yml"), "utf8");
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /schedule:|pull_request|push:/);
  assert.doesNotMatch(text, /secrets\./);
  assert.match(text, /permissions:\n  contents: write\n/);
  for (const m of text.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  for (const block of text.split(/\n\s+run: /).slice(1)) assert.doesNotMatch(block.split("\n- ")[0], /\$\{\{\s*inputs\./);
  // 해시·기준연도·이용허락 문자열은 코드가 아니라 입력으로만 받는다
  const code = await Promise.all(["official-price-fold", "official-price-key", "fetch-official-price"].map((n) => readFile(path.join(root, "scripts", `${n}.mjs`), "utf8")));
  assert.doesNotMatch(code.join("\n"), /BBDFE3E1|15851336|15,851,336/i);
  assert.match(text, /download_url[\s\S]*sha256[\s\S]*rows[\s\S]*base_year[\s\S]*license/);
});

test("연결: foldStream이 돌려주기 전에 assertDerived를 부른다 (#68 cto 후속)", async () => {
  // assertDerived 단독 시험은 있지만 foldStream 끝 호출이 빠져도 통과한다. ESM 함수를 가로챌 수 없어
  // 소스에서 foldStream 본문의 마지막 return 직전에 호출이 있는지 본다.
  const src = await readFile(path.join(root, "scripts", "official-price-fold.mjs"), "utf8");
  const body = src.slice(src.indexOf("export async function foldStream"));
  const call = body.indexOf("assertDerived(out);");
  assert.ok(call > 0, "foldStream 안에 assertDerived(out) 호출이 없다");
  assert.ok(call < body.lastIndexOf("return out;"), "assertDerived가 return보다 뒤에 있다");
  assert.ok(body.indexOf("MAX_OUTPUT_BYTES") > call, "assertDerived는 크기 검사보다 앞이어야 한다");
});

test("워크플로: curl은 https만 허용하고 리다이렉트도 https로 고정한다 (#68 cto 후속)", async () => {
  const text = await readFile(path.join(root, ".github/workflows/official-price.yml"), "utf8");
  const curls = text.split("\n").filter((l) => /\bcurl\b/.test(l) && !l.trim().startsWith("#"));
  assert.ok(curls.length >= 1);
  for (const l of curls) {
    assert.match(l, /--proto '=https'/, l);
    assert.match(l, /--proto-redir '=https'/, l);
  }
});
