// 2년 전 계약 보증금 대 지금 신규 전세(#693 N11) 데이터의 시험: 창 롤오버(cto 조건 5 a~f)·줄 정의(조건 2·9)·합집합 면적 묶음(조건 3)·
// 문턱 재사용·원본 빠짐(조건 6)·소프트 실패·바이트 한도·같은 입력 같은 바이트·칸 이름 0·등록(조건 7·8).
// 오프라인 - 원본은 손으로 만든 줄과 임시 폴더의 슬롯 파일이다. 커밋된 데이터 값·오늘 날짜로 갈리는 검사는 없다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MIN_CELLS, MIN_DEALS_PER_SIDE } from "../scripts/complex-ratio.ts";
import { newJeonse } from "../scripts/renewal-cells.ts";
import { shiftMonth as outlookShiftMonth } from "../scripts/outlook.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { yearMonthOf } from "../scripts/realestate-slots.ts";
import {
  BASE_ROWS,
  THRESHOLDS,
  buildReverseJeonse,
  cellPairs,
  jeonseRow,
  monthsOf,
  pairRow,
  windowMonthsOf,
  windowsOf,
} from "../scripts/reverse-jeonse.ts";
import { MAX_FILE_BYTES, readDistricts, runReverseJeonse, writePayload } from "../scripts/build-reverse-jeonse.ts";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-11-16T03:00:00Z");
const W = windowsOf(NOW);
const APT = "가상단지";
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;

/** 원본 한 줄. ym 은 계약월(dealYear·dealMonth). */
const row = (ym, deposit, { area = 84.97, type = "신규", apt = APT, dong = "가상동", rent = 0 } = {}) => ({
  aptNm: apt,
  umdNm: dong,
  excluUseAr: area,
  deposit: Number(deposit).toLocaleString("en-US"),
  monthlyRent: rent,
  contractType: type,
  dealYear: Number(ym.slice(0, 4)),
  dealMonth: Number(ym.slice(4, 6)),
});
const [B0, B1, B2] = monthsOf(W.base);
const [N0, N1, N2] = monthsOf(W.now);

test("창 (a) 2026-11-16T03:00Z → 2년 전 202412~202502 / 지금 202607~202609", () => {
  assert.deepEqual(windowsOf(new Date("2026-11-16T03:00:00Z")), { base: ["202412", "202502"], now: ["202607", "202609"] });
  assert.deepEqual(windowMonthsOf(W), ["202412", "202501", "202502", "202607", "202608", "202609"]);
});

test("창 (b) 달은 KST 로 센다 - KST 11-30 23:59:59 까지는 (a)와 같고 KST 12-01 00:00 부터 한 달 밀린다(UTC 달이면 실패)", () => {
  assert.deepEqual(windowsOf(new Date("2026-11-30T14:59:59Z")), { base: ["202412", "202502"], now: ["202607", "202609"] });
  assert.deepEqual(windowsOf(new Date("2026-11-30T15:00:00Z")), { base: ["202501", "202503"], now: ["202608", "202610"] });
});

test("창 (c) 해 경계: M=2027-01 → 202502~202504 / 202609~202611", () => {
  assert.deepEqual(windowsOf(new Date("2027-01-10T03:00:00Z")), { base: ["202502", "202504"], now: ["202609", "202611"] });
});

// #586 판정 (c): 보관 창은 Daily 의 삭제 커밋으로 매달 밀린다 - 두 창이 매달 함께 밀리는 것은 정해진 동작이다.
test("창 (d)·(f) 연속 13개월: 두 창이 매달 정확히 한 달씩 함께 밀리고, 가운데 달 간격은 늘 19개월, 지금 창 끝 달은 같은 장 빌더의 shiftMonth(yearMonthOf(now), -2)", () => {
  let previous = null;
  for (let i = 0; i < 13; i += 1) {
    const now = new Date(Date.UTC(2026, 10 + i, 15, 3));
    const w = windowsOf(now);
    for (const side of ["base", "now"]) assert.equal(monthIndex(w[side][1]) - monthIndex(w[side][0]), 2, `${side} 는 3개월`);
    assert.equal(monthIndex(w.now[0]) + 1 - (monthIndex(w.base[0]) + 1), 19, `${yearMonthOf(now)} 가운데 달 간격`);
    assert.equal(w.now[1], outlookShiftMonth(yearMonthOf(now), -2), `${yearMonthOf(now)} 끝 달이 같은 장 빌더와 갈렸다`);
    assert.equal(monthIndex(w.base[0]), monthIndex(yearMonthOf(now)) - 23, "2년 전 창 = M−23~M−21");
    if (previous) {
      for (const side of ["base", "now"]) {
        assert.equal(monthIndex(w[side][0]) - monthIndex(previous[side][0]), 1, `${yearMonthOf(now)} ${side} 첫 달`);
        assert.equal(monthIndex(w[side][1]) - monthIndex(previous[side][1]), 1, `${yearMonthOf(now)} ${side} 끝 달`);
      }
    }
    previous = w;
  }
});

test("문턱은 complex-ratio 의 것을 그대로 쓰고, 2년 전 줄 정의는 「all」이다", () => {
  assert.deepEqual(THRESHOLDS, { perSide: MIN_DEALS_PER_SIDE, cells: MIN_CELLS });
  assert.equal(BASE_ROWS, "all");
});

test("줄 판정 동치: newJeonse(x) 는 「계약구분이 신규면 jeonseRow(x), 아니면 null」과 같다 (cto 조건 2)", () => {
  const same = new Set([APT]);
  const rows = [];
  for (const type of ["신규", " 신규 ", "갱신", "", undefined, "기타"]) {
    for (const rent of [0, "0", "", 30, "1,000"]) {
      for (const deposit of ["50,000", "0", "", "abc", 12000]) {
        for (const area of [84.97, "59.991", 0, ""]) rows.push({ ...row("202412", 1, { area }), contractType: type, monthlyRent: rent, deposit });
      }
    }
  }
  rows.push({ ...row("202412", 50000), aptNm: " " }, { ...row("202412", 50000), aptNm: undefined }, null, {});
  for (const x of rows) {
    const expected = String(x?.contractType ?? "").trim() === "신규" ? jeonseRow(x, same) : null;
    assert.deepEqual(newJeonse(x, same), expected, JSON.stringify(x));
  }
  assert.ok(rows.filter((x) => jeonseRow(x, same)).length > rows.filter((x) => newJeonse(x, same)).length, "갱신·빈칸 줄이 jeonseRow 에만 들어와야 한다");
});

test("2년 전 창은 신규·갱신·계약구분 빈칸을 모두 센다 (2년 전 줄을 newJeonse 로 바꾸면 실패, cto 조건 9)", () => {
  const items = [row(B0, 50000), row(B1, 50000, { type: "갱신" }), row(B2, 50000, { type: "" }), ...many(3, () => row(N1, 45000))];
  const { cells, rows } = cellPairs(items, W);
  assert.deepEqual(rows, { base: 3, now: 3 });
  assert.deepEqual(cells, [{ base: 50000, now: 45000 }]);
});

test("지금 창은 계약구분 빈칸을 뺀다 (지금 창 줄 판정을 빈칸을 받는 정의로 바꾸면 실패, cto 조건 9)", () => {
  // 빈칸을 받는 판정(「갱신」만 빼는 것 - #923 전 complex-ratio newJeonse 의 정의)을 여기 지역 함수로 둔다. complex-ratio 는 #923 에서
  // 「신규」만으로 바뀌어 더는 그 차이를 보여 주지 못한다(#924). 이 줄이 두 판정을 가른다는 것을 먼저 고정하고, 아래 rows·cells 가
  // 돌연변이 가드다 - 지금 창이 빈칸 줄을 받으면 now 가 3이 되고 칸 하나({ base: 50000, now: 45000 })가 생겨 둘 다 실패한다.
  const blankAllowing = (x) => (String(x?.contractType ?? "").trim() === "갱신" ? null : jeonseRow(x));
  const blank = row(N2, 45000, { type: "" });
  assert.ok(blankAllowing(blank), "빈칸 허용 판정은 이 줄을 받는다 - 이 시험이 그 차이를 본다");
  assert.equal(newJeonse(blank), null, "지금 창 판정(renewal-cells newJeonse)은 이 줄을 뺀다");
  const items = [...many(3, () => row(B0, 50000)), row(N0, 45000), row(N1, 45000), blank, row(N2, 45000, { type: "갱신" })];
  const { cells, rows } = cellPairs(items, W);
  assert.deepEqual(rows, { base: 3, now: 2 });
  assert.deepEqual(cells, [], "지금 창 신규 2건이면 칸이 아니다");
});

test("면적 묶음은 단지마다 두 창을 합친 면적으로 한 번 만든다 - 2년 전 84.0㎡ 와 지금 84.95㎡ 가 한 칸에 맞물린다 (cto 조건 3·9)", () => {
  // 창마다 따로 묶으면 2년 전은 「84」, 지금은 84.95·85.5 가 1㎡ 안이라 한 묶음 「84.95」가 되어 이름이 갈려 짝이 0이다.
  // 합쳐 묶으면 84.0 에서 1㎡ 안인 84.95 가 같은 칸이고, 85.5 는 84.0 에서 1㎡ 를 넘어 따로다(areaGroups 의 첫 면적 규칙).
  const items = [...many(3, () => row(B1, 60000, { area: 84.0 })), ...many(3, () => row(N1, 55000, { area: 84.95 })), ...many(3, () => row(N1, 70000, { area: 85.5 }))];
  assert.deepEqual(cellPairs(items, W).cells, [{ base: 60000, now: 55000 }]);
});

test("줄의 창은 계약월로 정한다 - 두 창 밖 달·반전세·단지명 없는 줄은 들어오지 않고, 동명 단지는 동으로 갈린다", () => {
  const items = [
    ...many(3, () => row(B0, 50000)),
    ...many(3, () => row(N0, 40000)),
    ...many(3, () => row(shiftMonth(N2, 1), 10000)),
    ...many(3, () => row(N0, 10000, { rent: 50 })),
    ...many(3, () => row(N0, 10000, { apt: "" })),
    ...many(3, () => row(B0, 80000, { dong: "다른동" })),
  ];
  assert.deepEqual(cellPairs(items, W).cells, [{ base: 65000, now: 40000 }], "동명 단지를 모르면 두 동의 2년 전 줄이 한 칸");
  assert.deepEqual(cellPairs(items, W, new Set([APT])).cells, [{ base: 50000, now: 40000 }]);
  assert.equal(cellPairs(items, W, new Set([APT])).rows.base, 6);
});

function shiftMonth(ym, delta) {
  const i = monthIndex(ym) + delta;
  return `${Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, "0")}`;
}

test("구 행: 칸이 MIN_CELLS 미만이면 값 없이 칸 수만, 같은 값은 낮은 칸이 아니고, 격차는 낮은 칸이 MIN_CELLS 이상일 때만", () => {
  assert.deepEqual(pairRow(many(MIN_CELLS - 1, () => ({ base: 2, now: 1 }))), { cells: MIN_CELLS - 1, short: true });
  const cells = [...many(5, () => ({ base: 100, now: 90 })), ...many(5, () => ({ base: 100, now: 100 })), ...many(10, () => ({ base: 100, now: 120 }))];
  assert.deepEqual(pairRow(cells), { cells: 20, fell: 5, fellShare: 25, gap: null });
  const fell = [...many(MIN_CELLS - 1, () => ({ base: 200, now: 190 })), { base: 100, now: 80 }];
  assert.deepEqual(pairRow(fell), { cells: 20, fell: 20, fellShare: 100, gap: { pct: -5, amount: -10 } });
});

test("서울 행은 셈한 구의 모든 칸(표본 부족 구 포함), 원본 빠진 구는 { missing: true }, json 에 단지명·칸 키가 없다", () => {
  const cellsOf = (n, prefix, now = 45000) =>
    many(n, (i) => [...many(3, () => row(B0, 50000, { apt: `${prefix}${i}` })), ...many(3, () => row(N0, now, { apt: `${prefix}${i}` }))]).flat();
  const payload = buildReverseJeonse({
    now: NOW,
    districts: [
      { name: "가구", items: cellsOf(MIN_CELLS, "가단지", 45000) },
      { name: "나구", items: cellsOf(2, "나단지", 55000) },
      { name: "다구", missing: true },
    ],
  });
  assert.deepEqual(payload.windows, W, "(e) json windows = windowsOf(now)");
  assert.equal(payload.baseRows, "all");
  assert.deepEqual(payload.min, THRESHOLDS);
  assert.deepEqual(payload.rows, { base: (MIN_CELLS + 2) * 3, now: (MIN_CELLS + 2) * 3 });
  assert.deepEqual(payload.districts.가구, { cells: 20, fell: 20, fellShare: 100, gap: { pct: -10, amount: -5000 } });
  assert.deepEqual(payload.districts.나구, { cells: 2, short: true });
  assert.deepEqual(payload.districts.다구, { missing: true });
  assert.deepEqual(payload.seoul, { cells: 22, fell: 20, fellShare: 90.9, gap: { pct: -10, amount: -5000 } });
  assert.deepEqual(Object.keys(payload), ["updatedAt", "windows", "min", "baseRows", "rows", "seoul", "districts"]);
  const body = JSON.stringify(payload);
  assert.ok(!/단지/.test(body), "단지명이 새어 나갔다");
  assert.equal(buildReverseJeonse({ now: NOW, districts: [{ name: "가구", items: [] }] }), null, "칸이 없으면 null");
});

/** 임시 원본: 구마다 여섯 슬롯. make(code, ym) 이 그 슬롯 파일 본문(또는 null 이면 파일 없음)을 돌려준다. */
async function rawDirWith(make) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reverse-jeonse-raw-"));
  await mkdir(path.join(dir, "rent"), { recursive: true });
  for (const { code } of DISTRICTS) {
    for (const ym of windowMonthsOf(W)) {
      const body = make(code, ym);
      if (body) await writeFile(path.join(dir, "rent", `${code}-${ym}.json`), JSON.stringify(body));
    }
  }
  return dir;
}
const slot = (items) => ({ ok: true, items });
const fullSlot = (code, ym) => {
  const base = monthsOf(W.base).includes(ym);
  return slot(many(MIN_CELLS, (i) => many(1, () => row(ym, base ? 50000 : 48000 + (i % 2) * 4000, { apt: `단지${code}-${i}` }))).flat());
};

test("빌더: 커밋할 모양으로 쓰고(한도 안·단지명 0), 같은 입력·같은 now 면 같은 바이트", async () => {
  const raw = await rawDirWith(fullSlot);
  const out = await mkdtemp(path.join(os.tmpdir(), "reverse-jeonse-out-"));
  try {
    const logs = [];
    const a = path.join(out, "a.json");
    const b = path.join(out, "b.json");
    const payload = await runReverseJeonse({ now: NOW, file: a, rawDir: raw, log: (m) => logs.push(m) });
    await runReverseJeonse({ now: NOW, file: b, rawDir: raw, log: () => {} });
    assert.equal(payload.seoul.cells, MIN_CELLS * DISTRICTS.length);
    assert.deepEqual(Object.keys(payload.districts), DISTRICTS.map((d) => d.name), "DISTRICTS 순서");
    const body = await readFile(a, "utf8");
    assert.equal(body, await readFile(b, "utf8"));
    assert.ok(Buffer.byteLength(body) <= MAX_FILE_BYTES);
    assert.ok(!body.includes("단지"), "단지명이 새어 나갔다");
    assert.deepEqual(JSON.parse(body).windows, windowsOf(NOW), "(e)");
    assert.doesNotMatch(logs.join("\n"), /::warning::/);
  } finally {
    await rm(raw, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("원본 빠짐 (cto 조건 6): 한 구의 여섯 슬롯 가운데 하나라도 없거나 ok:false 면 그 구는 셈하지 않는다", async () => {
  const [first, second] = DISTRICTS;
  const raw = await rawDirWith((code, ym) => {
    if (code === first.code && ym === N2) return null;
    if (code === second.code && ym === B0) return { ok: false, items: [] };
    return fullSlot(code, ym);
  });
  try {
    const districts = await readDistricts(windowMonthsOf(W), { rawDir: raw });
    assert.deepEqual(districts[0], { name: first.name, missing: true });
    assert.deepEqual(districts[1], { name: second.name, missing: true });
    const payload = await runReverseJeonse({ now: NOW, file: path.join(raw, "out.json"), rawDir: raw, log: () => {} });
    assert.deepEqual(payload.districts[first.name], { missing: true });
    assert.equal(payload.seoul.cells, MIN_CELLS * (DISTRICTS.length - 2), "서울 행에 빠진 구의 칸이 없다");
  } finally {
    await rm(raw, { recursive: true, force: true });
  }
});

test("원본 빠짐 (cto 조건 6): 어느 창의 한 달이 25구 모두에서 비면 쓰지 않고 경고 한 줄, 어제 파일을 둔다", async () => {
  const raw = await rawDirWith((code, ym) => (ym === B1 ? slot([]) : fullSlot(code, ym)));
  try {
    const file = path.join(raw, "reverse-jeonse.json");
    await writeFile(file, "어제 파일\n");
    const logs = [];
    assert.equal(await runReverseJeonse({ now: NOW, file, rawDir: raw, log: (m) => logs.push(m) }), null);
    assert.equal(logs.length, 1);
    assert.match(logs[0], new RegExp(`^::warning::.*${B1}`));
    assert.equal(await readFile(file, "utf8"), "어제 파일\n");
  } finally {
    await rm(raw, { recursive: true, force: true });
  }
});

test("소프트 실패: 읽기 함수가 던져도 던지지 않고 null, 기존 파일 바이트가 그대로", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reverse-jeonse-"));
  try {
    const file = path.join(dir, "reverse-jeonse.json");
    await writeFile(file, "어제 파일\n");
    const boom = async () => {
      throw new Error("읽기 실패");
    };
    for (const opts of [{ read: boom, readSame: async () => ({}) }, { readSame: boom }]) {
      const logs = [];
      assert.equal(await runReverseJeonse({ now: NOW, file, log: (m) => logs.push(m), ...opts }), null);
      assert.match(logs[0], /^::warning::.*읽기 실패/);
      assert.equal(await readFile(file, "utf8"), "어제 파일\n");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("바이트 한도: 넘으면 쓰지 않는다 (임시 파일도 남기지 않음)", async () => {
  const raw = await rawDirWith(fullSlot);
  try {
    const file = path.join(raw, "reverse-jeonse.json");
    await writeFile(file, "어제 파일\n");
    const logs = [];
    assert.equal(await runReverseJeonse({ now: NOW, file, rawDir: raw, maxBytes: 100, log: (m) => logs.push(m) }), null);
    assert.match(logs[0], /^::warning::.*B > 100B/);
    assert.equal(await readFile(file, "utf8"), "어제 파일\n");
    await assert.rejects(writePayload(file, { pad: "x".repeat(MAX_FILE_BYTES) }), /B > 8192B/);
    assert.equal(await readFile(file, "utf8"), "어제 파일\n");
    assert.deepEqual((await readdir(raw)).filter((name) => name.includes(".tmp")), []);
  } finally {
    await rm(raw, { recursive: true, force: true });
  }
});

test("등록 (cto 조건 7): build-complex-ratio main 에서 runRenewalCells 바로 다음·readRaw 앞에 한 줄, 등록 파일·readRaw 는 쓰지 않는다", async () => {
  const src = await readFile(path.join(root, "scripts/build-complex-ratio.ts"), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const call = main.search(/^\s*await runReverseJeonse\(\{ now \}\);$/m);
  assert.ok(call > 0, "호출 줄이 없다");
  assert.ok(main.indexOf("await runRenewalCells(") < call, "runRenewalCells 다음이어야 한다");
  assert.ok(call < main.indexOf("await readRaw("), "readRaw 앞이어야 한다");
  for (const file of ["scripts/update-all.mjs", ".github/workflows/daily-update.yml"]) {
    assert.ok(!(await readFile(path.join(root, file), "utf8")).includes("reverse-jeonse"), file);
  }
  const builder = await readFile(path.join(root, "scripts/build-reverse-jeonse.ts"), "utf8");
  assert.ok(!/\breadRaw\b|build-complex-ratio/.test(builder.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "readRaw 는 #900 이 바꿀 자리다");
});

test("줄 판정 출처: 지금 창은 renewal-cells 의 newJeonse 를 별칭으로 받고, 계약구분 문자열 비교·날짜 리터럴을 새로 두지 않는다", async () => {
  const src = await readFile(path.join(root, "scripts/reverse-jeonse.ts"), "utf8");
  assert.match(src, /^import \{ newJeonse as newJeonseRow \} from "\.\/renewal-cells\.ts";$/m);
  const ratioImport = src.split("\n").find((l) => l.includes('from "./complex-ratio.ts"')) ?? "";
  assert.doesNotMatch(ratioImport, /\bnewJeonse\b/, "complex-ratio newJeonse 는 #910 판정 대상이라 받지 않는다");
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(code, /contractType|"신규"|"갱신"/);
  assert.doesNotMatch(code, /\b(19|20)\d{2}-?(0[1-9]|1[0-2])\b/);
});

test("커밋된 reverse-jeonse.json 은 한도 안이고 구 집계 키만 있다", async () => {
  const body = await readFile(path.join(root, "docs/data/reverse-jeonse.json"), "utf8");
  assert.ok(Buffer.byteLength(body) <= MAX_FILE_BYTES);
  const data = JSON.parse(body);
  assert.deepEqual(Object.keys(data), ["updatedAt", "windows", "min", "baseRows", "rows", "seoul", "districts"]);
  assert.equal(data.baseRows, "all");
  assert.deepEqual(data.min, THRESHOLDS);
  assert.deepEqual(Object.keys(data.districts), DISTRICTS.map((d) => d.name));
  for (const row of [data.seoul, ...Object.values(data.districts)]) {
    for (const key of Object.keys(row)) assert.ok(["cells", "short", "missing", "fell", "fellShare", "gap"].includes(key), key);
    if (row.gap) assert.deepEqual(Object.keys(row.gap), ["pct", "amount"]);
  }
});

// ---- PR2(#693 N11): 전망 장 절의 글자·표 조각(scripts/reverse-jeonse-view.ts), 틀(docs/price-outlook.html), method 새 절 ----
// 입력은 이 파일 안에서 만든 json 모양이다 - 커밋된 데이터 값·오늘 날짜로 갈리지 않는다(#8). 구운 장(build/site)은 test/bilingual-cell-site.test.mjs 가 본다.

const { MISSING_TEXT, REVERSE_JEONSE_METHOD, countsText, districtCounts, noGapText, reverseJeonseView, shortText, spanText } = await import("../scripts/reverse-jeonse-view.ts");

/** 화면 json 모양. 첫 구는 표본 부족, 둘째 구는 원본 빠짐, 나머지는 하락 비율만 있고 격차 null(하락 칸 < min.cells). */
const viewData = ({ windows = W, min = THRESHOLDS, seoul = { cells: 948, fell: 46, fellShare: 4.9, gap: { pct: -3.8, amount: -3316 } }, missing = true } = {}) => ({
  updatedAt: NOW.toISOString(),
  windows,
  min,
  baseRows: BASE_ROWS,
  rows: { base: 100, now: 50 },
  seoul,
  districts: Object.fromEntries(
    DISTRICTS.map(({ name }, i) => [
      name,
      i === 0 ? { cells: 8, short: true } : i === 1 && missing ? { missing: true } : { cells: 30, fell: 2, fellShare: 6.7, gap: null },
    ])
  ),
});
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
const allKo = (v) => [v.lead.ko, v.table.ko, v.note.ko].join(" ");
const allEn = (v) => [v.lead.en, v.table.en, v.note.en].join(" ");
const rowOf = (html, name) => new RegExp(`<tr><th scope="row">${name}[\\s\\S]*?</tr>`).exec(html)?.[0] ?? "";

test("화면 조각: 두 창의 달·줄 정의는 json windows 에서 읽는다 - 창이 밀리면 문장도 밀린다 (완료 조건 1·3)", () => {
  const v = reverseJeonseView(viewData());
  assert.ok(v.lead.ko.includes("최근 3개월(2026년 7~9월)의 신규 전세 보증금"), v.lead.ko);
  assert.ok(v.lead.ko.includes("2년 전 계약 보증금(신규·갱신 포함, 2024년 12월~2025년 2월 계약)"), v.lead.ko);
  assert.ok(v.lead.en.includes("(Jul–Sep 2026)") && v.lead.en.includes("signed Dec 2024–Feb 2025"), v.lead.en);
  const next = reverseJeonseView(viewData({ windows: windowsOf(new Date("2026-11-30T15:00:00Z")) }));
  assert.ok(next.lead.ko.includes("(2026년 8~10월)") && next.lead.ko.includes("2025년 1~3월 계약"), next.lead.ko);
  assert.deepEqual(spanText(["202609", "202611"]), { ko: "2026년 9~11월", en: "Sep–Nov 2026" });
  assert.deepEqual(spanText(["202411", "202501"]), { ko: "2024년 11월~2025년 1월", en: "Nov 2024–Jan 2025" });
});

test("화면 조각: 서울 하락 비율·격차, 격차의 % 와 금액은 한 문장에 묶지 않는다 (cpo 4단계)", () => {
  const v = reverseJeonseView(viewData());
  assert.ok(v.lead.ko.includes("948칸 가운데") && v.lead.ko.includes("46칸, 4.9%입니다"), v.lead.ko);
  const sentences = v.lead.ko.split(/(?<=다\.) /);
  assert.ok(sentences.some((s) => s.includes("-3.8%")) && sentences.some((s) => s.includes("-3,316만원")), v.lead.ko);
  assert.ok(!sentences.some((s) => s.includes("-3.8%") && s.includes("-3,316만원")), "% 와 금액이 한 문장에 있다");
  const seoulRow = rowOf(v.table.ko, "서울");
  assert.ok(seoulRow.includes("<td>948</td>") && seoulRow.includes("46칸(4.9%)") && seoulRow.includes("-3.8%<div class=\"sub\">-3,316만원</div>"), seoulRow);
  assert.ok(rowOf(v.table.en, "All Seoul").includes("-₩33.2M"), v.table.en);
});

test("화면 조각: 격차 null 은 「하락 칸이 20칸 미만이라 격차를 내지 않음」 - 서울 행도 같은 문구, 표본 부족·원본 빠짐과 다른 문구 (완료 조건 2)", () => {
  const nullSeoul = reverseJeonseView(viewData({ seoul: { cells: 948, fell: 12, fellShare: 1.3, gap: null } }));
  const phrase = noGapText(THRESHOLDS.cells).ko;
  assert.equal(phrase, "하락 칸이 20칸 미만이라 격차를 내지 않음");
  assert.ok(rowOf(nullSeoul.table.ko, "서울").includes(`<td>${phrase}</td>`), "서울 행 격차 칸");
  assert.ok(rowOf(nullSeoul.table.ko, DISTRICTS[2].name).includes(`<td>${phrase}</td>`), "구 행 격차 칸");
  assert.ok(nullSeoul.lead.ko.includes(phrase), nullSeoul.lead.ko);
  assert.ok(!/-\d|만원/.test(text(rowOf(nullSeoul.table.ko, "서울")).replace(/\d+\.\d%|\d+\/\d+/g, "")), "격차 null 인데 숫자가 있다");
  const short = rowOf(nullSeoul.table.ko, DISTRICTS[0].name);
  assert.ok(short.includes(shortText(THRESHOLDS.cells).ko) && !short.includes(phrase), short);
  const missing = rowOf(nullSeoul.table.ko, DISTRICTS[1].name);
  assert.ok(missing.includes(MISSING_TEXT.ko) && !missing.includes(phrase) && !missing.includes("표본 부족"), missing);
  for (const v of [nullSeoul, reverseJeonseView(viewData())]) {
    for (const row of v.table.ko.match(/<tr>[\s\S]*?<\/tr>/g).slice(1)) assert.ok(!/<td>(?:-|−|)<\/td>/.test(row), `빈칸·「−」 칸: ${row}`);
  }
});

test("화면 조각: 문턱 숫자는 json min 에서 읽는다(박힌 20 이 아니다)", () => {
  const v = reverseJeonseView(viewData({ min: { perSide: 4, cells: 30 }, seoul: { cells: 948, fell: 12, fellShare: 1.3, gap: null } }));
  assert.ok(v.table.ko.includes("하락 칸이 30칸 미만이라 격차를 내지 않음") && v.table.ko.includes("표본 부족(견준 칸 30칸 미만)"));
  assert.ok(v.note.ko.includes("각 시기 4건 이상") && v.note.ko.includes("30칸 미만"));
  assert.ok(!/20칸/.test(allKo(v)), "박힌 20");
});

test("화면 조각: 「하락 비율이 나온 구 n/25」 옆에 표본 부족·원본이 빠진 구를 따로 적는다 (cpo 4단계)", () => {
  const v = reverseJeonseView(viewData());
  const c = districtCounts(viewData().districts);
  assert.deepEqual(c, { total: 25, shown: 23, short: 1, missing: 1 });
  assert.equal(countsText(c).ko, "하락 비율이 나온 구 23/25(표본 부족 1곳, 원본이 빠진 구 1곳)");
  assert.ok(rowOf(v.table.ko, "서울").includes(countsText(c).ko));
  assert.ok(v.lead.ko.includes("하락 비율이 나온 구는 23/25입니다(표본 부족 1곳, 원본이 빠진 구 1곳)."), v.lead.ko);
  const none = reverseJeonseView(viewData({ missing: false }));
  assert.ok(!allKo(none).includes("원본이 빠진") && none.lead.ko.includes("24/25입니다(표본 부족 1곳)."), none.lead.ko);
});

test("화면 조각: 「개별 계약 판정 아님」·method 링크가 있고, 「시세」·판정어·「중앙값」은 없다 (완료 조건 1·4, cpo 4단계)", () => {
  for (const v of [reverseJeonseView(viewData()), reverseJeonseView(viewData({ seoul: { cells: 948, fell: 3, fellShare: 0.3, gap: null } })), reverseJeonseView(viewData({ seoul: { cells: 12, short: true } }))]) {
    assert.ok(v.note.ko.includes("개별 계약의 판정이 아닙니다") && v.note.en.includes("not a verdict on any single contract"));
    assert.ok(v.note.ko.includes(`<a href="${REVERSE_JEONSE_METHOD.ko}">`) && v.note.en.includes(`<a href="${REVERSE_JEONSE_METHOD.en}">`));
    assert.doesNotMatch(allKo(v), /시세|역전세|위험|깡통|중앙값/);
    assert.doesNotMatch(allEn(v), /reverse jeonse|risk|market price/i);
  }
  assert.equal(REVERSE_JEONSE_METHOD.ko, "./method.html#reverse-jeonse");
  assert.equal(REVERSE_JEONSE_METHOD.en, "./method.html#reverse-jeonse-en");
});

test("화면 조각: 서울 칸이 문턱 미만이면 표본 부족 문장, json 이 화면 모양이 아니면 null(틀의 빈 자리 그대로)", () => {
  const v = reverseJeonseView(viewData({ seoul: { cells: 12, short: true } }));
  assert.ok(v.lead.ko.includes("12칸뿐이라") && !v.lead.ko.includes("하락 칸(하락 칸)"), v.lead.ko);
  for (const bad of [null, {}, { ...viewData(), windows: null }, { ...viewData(), min: {} }, { ...viewData(), districts: null }]) assert.equal(reverseJeonseView(bad), null);
});

test("틀: 절은 입주 절 아래·성적표 위, 영어 구역(hidden)이 한국어 구역 앞, 조각 다섯, 새 fetch 0, 언어 전환이 hidden 을 옮긴다 (cto 조건 10·11)", async () => {
  const html = await readFile(path.join(root, "docs/price-outlook.html"), "utf8");
  const at = (s) => html.indexOf(s);
  assert.ok(at('<section id="move-in-section"') < at('<section id="reverse-jeonse-section"') && at('<section id="reverse-jeonse-section"') < at('<section id="score-section"'));
  const section = html.slice(at('<section id="reverse-jeonse-section"'), html.indexOf("</section>", at('<section id="reverse-jeonse-section"')));
  // 표의 자동 caption 은 표 앞 마지막 h2 를 읽는다(scripts/table-a11y.ts) - 한국어 구역이 뒤라야 한국어 caption 에 영어 제목이 들어가지 않는다.
  assert.ok(section.indexOf('<div lang="en" hidden>') < section.indexOf('<div lang="ko">') && section.indexOf('<div lang="ko">') < section.indexOf("<table"));
  assert.ok(section.includes('<h2 id="reverse-jeonse-heading-en">') && section.includes('<h2 id="reverse-jeonse-heading">'));
  for (const name of ["reverseJeonseLead", "reverseJeonseLeadEn", "reverseJeonseTable", "reverseJeonseNote", "reverseJeonseNoteEn"]) assert.ok(section.includes(`<!--prerender:${name}-->`), name);
  assert.equal((section.match(/\slang="en" hidden/g) ?? []).length, 2);
  const script = html.slice(html.lastIndexOf("<script>"));
  assert.ok(!script.includes("reverse-jeonse\")") && !/loadJson\("reverse-jeonse"/.test(script), "새 fetch");
  assert.match(script, /for \(const el of document\.querySelectorAll\("#reverse-jeonse-section \[lang\]"\)\) el\.hidden = el\.lang !== locale;/);
  const prerender = await readFile(path.join(root, "scripts/prerender.ts"), "utf8");
  assert.match(prerender, /reverseJeonseView\(await readJson\("reverse-jeonse"\)\)/);
});

// method 새 절(완료 조건 5, cto 2차 확인 조건 10): <h2 id> 에서 다음 <h2 까지 잘라 본다(test/future-value-method.test.mjs 선례).
const methodHtml = await readFile(path.join(root, "docs/method.html"), "utf8");
const methodSection = (id) => {
  const start = methodHtml.indexOf(`<h2 id="${id}">`);
  assert.notEqual(start, -1, `${id} 절이 없다`);
  return methodHtml.slice(start, methodHtml.indexOf("<h2 ", start + 1));
};
const previousH2 = (id) => [...methodHtml.slice(0, methodHtml.indexOf(`<h2 id="${id}">`)).matchAll(/<h2 id="([^"]+)">/g)].at(-1)?.[1];

test("method: #reverse-jeonse·#reverse-jeonse-en 두 절이 각 언어 구역의 #switch-house 바로 뒤에 있고, 차례에도 있다", () => {
  const ko = methodHtml.indexOf('<div data-lang="ko"');
  const en = methodHtml.indexOf('<div data-lang="en"');
  assert.ok(ko < methodHtml.indexOf('<h2 id="reverse-jeonse">') && methodHtml.indexOf('<h2 id="reverse-jeonse">') < en);
  assert.ok(en < methodHtml.indexOf('<h2 id="reverse-jeonse-en">'));
  assert.equal(previousH2("reverse-jeonse"), "switch-house");
  assert.equal(previousH2("reverse-jeonse-en"), "switch-house-en");
  assert.ok(methodHtml.includes('<li><a href="#reverse-jeonse">') && methodHtml.includes('<li><a href="#reverse-jeonse-en">'));
});

test("method: 다섯 요소(두 창과 신고 기한, 24개월이 아닌 이유, 줄 정의와 한계, 문턱 셋, 개별 계약 판정 아님)가 ko·en 양쪽에 있다 (완료 조건 5)", () => {
  const want = {
    "reverse-jeonse": [
      "M−23~M−21", "M−4~M−2", "신고 기한(계약 후 30일)", "가운데 달끼리 19개월", "M−27~M−25",
      "신규·갱신·계약구분 빈칸 줄을 모두 셉니다", "계약구분 빈칸은 뺍니다", "시세 변화로 읽을 수 없습니다",
      `시기마다 ${THRESHOLDS.perSide}건 이상`, `견준 칸이 ${THRESHOLDS.cells}칸 이상일 때만 하락 비율`, `하락 칸이 ${THRESHOLDS.cells}칸 이상인 행에서만`, "서울 행도 같습니다",
      "개별 계약의 판정이 아닙니다",
    ],
    "reverse-jeonse-en": [
      "M−23 to M−21", "M−4 to M−2", "30-day filing window", "19 months apart", "M−27 to M−25",
      "new, renewed and those with the contract type left blank", "drops blank contract types", "cannot be read as a change in that home&rsquo;s market price",
      `${THRESHOLDS.perSide} or more contracts in each period`, `${THRESHOLDS.cells} or more units compared`, `${THRESHOLDS.cells} or more falling units`, "Seoul included",
      "not a verdict on any single contract",
    ],
  };
  for (const [id, words] of Object.entries(want)) {
    const s = methodSection(id);
    for (const w of words) assert.ok(s.includes(w), `${id}: 「${w}」`);
  }
});

test("method: 새 절은 「중앙값」·<code>·<section> 을 쓰지 않고, 실제 달은 「예:」 한 문장에만 둔다 (cto 2차 확인 조건 10)", () => {
  const ko = methodSection("reverse-jeonse");
  const en = methodSection("reverse-jeonse-en");
  for (const s of [ko, en]) {
    assert.ok(!s.includes("중앙값") && !/<code\b/.test(s) && !/<section\b/.test(s));
  }
  // 「YYYY년 M월」·「M월」 꼴의 달은 예시 문장 하나에만(그날의 달은 화면이 json windows 로 적는다).
  const koExample = /예: [^.]*\./.exec(ko)?.[0] ?? "";
  assert.ok(koExample.includes("2024년 12월~2025년 2월") && koExample.includes("2026년 7~9월"), koExample);
  assert.equal((ko.replace(koExample, "").match(/\d{4}년 \d{1,2}(?:~\d{1,2})?월/g) ?? []).length, 0);
  const enExample = /For example, [^.]*\./.exec(en)?.[0] ?? "";
  const MONTH = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g;
  assert.ok((enExample.match(MONTH) ?? []).length >= 3, enExample);
  assert.equal((en.replace(enExample, "").match(MONTH) ?? []).length, 0);
});
