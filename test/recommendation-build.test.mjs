// 근거표 빌더(#816 P1-1). 값은 전부 지어낸 고정 데이터다 - 실데이터 값·크기·날짜 단언 금지(실데이터는 tools/health/test/recommendation-build.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildFiles as buildPriceFiles } from "../scripts/build-complex-price.ts";
import { buildFiles, checkLimits, generate, recoFileName } from "../scripts/build-recommendation.ts";
import { DISTRICT_SLUGS } from "../scripts/district-slugs.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { APARTMENT_FIELDS, CELL_FIELDS, cellField, LIMITS } from "../scripts/recommendation.ts";
import { recentMonths } from "../scripts/realestate-source.ts";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-08-15T03:00:00Z");
const NOWON = "11350";
const SEONGDONG = "11200";
const months = ["202601", "202602", "202603", "202604", "202605", "202606", "202607", "202608"];
const flat = months.map((m) => [m, 100]);
const index = { series: Object.fromEntries(["200", "210", "220", "230", "240", "250"].map((code) => [code, flat])) };

const sale = (over = {}) => ({
  sggCd: NOWON, aptNm: "가단지", umdNm: "상계동", jibun: "1", excluUseAr: 84.9, dealAmount: "100,000",
  dealYear: 2026, dealMonth: 7, dealDay: 15, dealingGbn: "중개거래", cdealType: "", floor: 3, buildYear: 2000, ...over,
});
const rent = (over = {}) => ({
  sggCd: NOWON, aptNm: "가단지", umdNm: "상계동", jibun: "1", excluUseAr: 84.9, deposit: "50,000", monthlyRent: 0,
  contractType: "신규", dealYear: 2026, dealMonth: 7, dealDay: 1, ...over,
});
const many = (count, over = {}) => Array.from({ length: count }, (_, i) => sale({ dealDay: i + 1, ...over }));

const A = APARTMENT_FIELDS.reduce((acc, name, i) => ({ ...acc, [name]: i }), {});
const C = (name) => cellField(name);
const build = (itemsByDistrict, extra = {}) => buildFiles({ itemsByDistrict, index, now: NOW, ...extra }).files;
const rowsOf = (file) => file.apartments.map((row) => ({ id: row[A.id], name: row[A.name], cells: row[A.cells] }));

test("25개 구 파일을 모두 낸다. 거래가 없는 구도 빈 파일이고 머리는 같다", () => {
  const files = build({ [NOWON]: many(3) });
  assert.equal(Object.keys(files).length, LIMITS.files);
  assert.equal(files.nowon.district, "노원구");
  assert.deepEqual(files.jongno.apartments, []);
  assert.deepEqual(files.jongno.excluded, []);
  assert.equal(files.jongno.schemaVersion, 1);
  assert.equal(files.jongno.algorithmVersion, "reco-0");
  assert.equal(checkLimits(files).problems.length, 0);
});

test("날짜를 나눠 싣는다: 빌드 시각·구별 도착일·창 시작·보정 기준달·규정 대조일", () => {
  const { nowon } = build({ [NOWON]: many(3) }, { arrivalByDistrict: { [NOWON]: "2026-08-14" } });
  assert.equal(nowon.updatedAt, NOW.toISOString());
  assert.deepEqual(nowon.asOf, { deals: "2026-08-14", windowStart: "2026-02-13", indexRef: "202608", indexFilled: false, rules: "2026-10-01" });
});

test("점수 칸이 없다. 세대수는 null, 어느 파일에도 판정·순위·시험 글자가 없다", () => {
  const files = build({ [NOWON]: many(5) });
  const [row] = files.nowon.apartments;
  assert.equal(row[A.households], null);
  assert.equal(CELL_FIELDS.includes("scores"), false);
  assert.deepEqual(Object.values(files.nowon.types).map((type) => type.status), ["off", "none", "none"]);
  const text = JSON.stringify(files);
  assert.doesNotMatch(text, /추천|유리|불리|저평가|유망|투자|TOP/);
  assert.doesNotMatch(text, /score|"living":[^{]/i);
  assert.doesNotMatch(text, /rank|prereg/i, "순위 값·시험 사유 코드를 싣지 않는다(pm·clo, #856)");
});

test("n<3 은 값을 내지 않고 K 로만 센다: 평균 대입 0, 값대는 값을 낸 칸과 같은 지수 보정", () => {
  const rising = { series: Object.fromEntries(["200", "210", "220", "230", "240", "250"].map((code) => [code, [["202607", 100], ["202608", 110]]])) };
  const { files } = buildFiles({
    itemsByDistrict: { [NOWON]: [...many(2, { dealAmount: "95,000" }), ...many(1, { aptNm: "나단지", jibun: "2", excluUseAr: 59 })] },
    index: rising,
    now: NOW,
  });
  assert.deepEqual(files.nowon.apartments, [], "값을 낸 칸이 없는 단지는 줄이 없다");
  // 9.5억 ×110/100 = 10.45억 → 10억대(원값 9.5억이면 9억대), 10억 ×1.1 = 11억 → 11억대.
  assert.deepEqual(files.nowon.excluded, [
    { band: 10, area: "60-85", thin: 1 },
    { band: 11, area: "under-60", thin: 1 },
  ]);
});

test("같은 단지 안에서 칸마다 따로 판정한다: 3건 칸은 값, 2건 칸은 뺀 곳", () => {
  const { nowon } = build({ [NOWON]: [...many(3), ...many(2, { excluUseAr: 59 })] });
  const [row] = rowsOf(nowon);
  assert.deepEqual(row.cells.map((c) => c[C("areaSqm")]), [84.9]);
  assert.equal(nowon.excluded.reduce((sum, e) => sum + e.thin, 0), 1);
});

test("값은 시세 화면 계산 그대로이고, 칸 모양은 파일 머리의 목록과 같다", () => {
  const items = [...many(5), sale({ dealAmount: "120,000", dealDay: 20, floor: 9 })];
  const { nowon } = build({ [NOWON]: items });
  const price = buildPriceFiles({ itemsByDistrict: { [NOWON]: items }, index, now: NOW }).files.nowon.cells["가단지"]["84.9"];
  const [cell] = rowsOf(nowon)[0].cells;
  assert.equal(cell.length, CELL_FIELDS.length);
  assert.deepEqual(nowon.cellFields, CELL_FIELDS);
  assert.deepEqual(nowon.apartmentFields, APARTMENT_FIELDS);
  assert.equal(cell[C("median")], price.median);
  assert.equal(cell[C("low")], price.low);
  assert.equal(cell[C("high")], price.high);
  assert.equal(cell[C("rawMedian")], price.raw);
  assert.equal(cell[C("unadjustedDeals")], price.unadjusted);
  assert.equal(cell[C("n")], 6);
  assert.equal(cell[C("lastAmount")], 120_000);
  assert.equal(cell[C("lastDate")], "2026-07-20");
  assert.equal(cell[C("lastFloor")], 9);
  assert.equal(cell[C("totalCost")], cell[C("median")] + cell[C("extraCost")]);
});

test("표본 등급은 기준일에서 칸 마지막 계약일까지로 잰다(경계 90일은 충분)", () => {
  const at = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    return many(5, { dealYear: y, dealMonth: m }).map((item) => ({ ...item, dealDay: d }));
  };
  // 2026-08-15 에서 90일 전은 05-17, 91일 전은 05-16.
  const grade = (date) => rowsOf(build({ [NOWON]: at(date) }).nowon)[0].cells[0];
  assert.equal(grade("2026-05-17")[C("sampleGrade")], "enough");
  assert.deepEqual(grade("2026-05-17")[C("checks")], []);
  assert.equal(grade("2026-05-16")[C("sampleGrade")], "partial");
  assert.deepEqual(grade("2026-05-16")[C("checks")], [["stale_deal", 91]]);
});

test("거래 규칙: 해제·직거래는 빼고, 창 밖 거래는 값에 안 든다", () => {
  const items = [...many(3), sale({ cdealType: "O" }), sale({ dealingGbn: "직거래" }), sale({ dealYear: 2025, dealMonth: 12 })];
  const [cell] = rowsOf(build({ [NOWON]: items }).nowon)[0].cells;
  assert.equal(cell[C("n")], 3);
});

test("동명 단지: 벽산 3곳이 값이 섞이지 않고 갈리며 화면 이름은 동을 단다. 같은 동 다른 지번도 갈린다", () => {
  const byeoksan = (umdNm, jibun, amount) => many(3, { sggCd: SEONGDONG, aptNm: "벽산", umdNm, jibun, dealAmount: amount });
  const items = [...byeoksan("금호동1가", "1", "190,000"), ...byeoksan("사근동", "2", "105,000"), ...byeoksan("하왕십리동", "3", "170,000"), ...byeoksan("사근동", "9", "80,000")];
  const { seongdong } = build({ [SEONGDONG]: items }, { sameNames: { [SEONGDONG]: new Set(["벽산"]) } });
  assert.deepEqual(
    rowsOf(seongdong).map((r) => [r.id, r.name, r.cells[0][C("median")]]),
    [
      ["11200|금호동1가|1|벽산", "벽산 (금호동1가)", 190_000],
      ["11200|사근동|2|벽산", "벽산 (사근동)", 105_000],
      ["11200|사근동|9|벽산", "벽산 (사근동)", 80_000],
      ["11200|하왕십리동|3|벽산", "벽산 (하왕십리동)", 170_000],
    ]
  );
});

test("별칭: 표에 있는 위치 키는 한 줄로 합쳐 세고, 옛 키를 줄에 남긴다", () => {
  const items = [
    ...many(2, { sggCd: "11740", umdNm: "강일동", jibun: "114", aptNm: "강동리버스트4단지" }),
    ...many(1, { sggCd: "11740", umdNm: "강일동", jibun: "742", aptNm: "강동리버스트4단지" }),
  ];
  const { gangdong } = build({ 11740: items });
  assert.equal(gangdong.apartments.length, 1);
  const [row] = gangdong.apartments;
  assert.equal(row[A.id], "11740|강일동|114|강동리버스트4단지");
  assert.deepEqual(row[A.aliases], ["11740|강일동|742|강동리버스트4단지"]);
  assert.equal(row[A.cells][0][C("n")], 3);
  assert.deepEqual(gangdong.excluded, []);
});

test("전월세가 줄거나 없어도 ID·값이 그대로다 - 전세 건수만 달라진다", () => {
  const items = many(5);
  const withRent = build({ [NOWON]: items }, { rentsByDistrict: { [NOWON]: [rent(), rent({ dealDay: 2 })] } }).nowon;
  const without = build({ [NOWON]: items }).nowon;
  assert.equal(withRent.apartments[0][A.id], without.apartments[0][A.id]);
  assert.equal(withRent.apartments[0][A.cells][0][C("median")], without.apartments[0][A.cells][0][C("median")]);
  assert.equal(withRent.apartments[0][A.cells][0][C("jeonseN")], 2);
  assert.equal(without.apartments[0][A.cells][0][C("jeonseN")], 0);
});

test("전세 건수: 창 안 신규 순수 전세만, 지금 칸의 1㎡ 안쪽만. 갱신·반전세·다른 평형·창 밖은 안 센다", () => {
  const rents = [
    rent(), rent({ excluUseAr: 84.5 }),
    rent({ contractType: "갱신" }), rent({ monthlyRent: 50 }), rent({ excluUseAr: 59 }), rent({ dealYear: 2025, dealMonth: 12 }),
  ];
  const [cell] = rowsOf(build({ [NOWON]: many(3) }, { rentsByDistrict: { [NOWON]: rents } }).nowon)[0].cells;
  assert.equal(cell[C("jeonseN")], 2);
});

test("12개월 건수: 창의 n + 그 앞 거래. 값·n·칸 묶음은 창 밖 거래로 바뀌지 않는다", () => {
  const older = [sale({ dealYear: 2025, dealMonth: 12 }), sale({ dealYear: 2025, dealMonth: 12, excluUseAr: 84.2 }), sale({ dealYear: 2025, dealMonth: 12, excluUseAr: 59 }), sale({ dealYear: 2025, dealMonth: 8, dealDay: 14 })];
  const base = rowsOf(build({ [NOWON]: many(3) }).nowon)[0].cells[0];
  const [cell] = rowsOf(build({ [NOWON]: many(3) }, { olderByDistrict: { [NOWON]: older } }).nowon)[0].cells;
  assert.equal(cell[C("deals12m")], 5);
  assert.equal(cell[C("n")], 3);
  assert.equal(cell[C("median")], base[C("median")]);
});

test("결정성: 입력 순서가 달라도 같은 바이트이고, 파일 안 순서는 ID 사전순이다(거래 수 순이 아니다)", () => {
  const items = [...many(9, { aptNm: "다단지", jibun: "3" }), ...many(3, { aptNm: "가단지", jibun: "1" }), ...many(5, { aptNm: "나단지", jibun: "2" }), ...many(3, { aptNm: "가단지", jibun: "1", excluUseAr: 59 })];
  const rents = [rent(), rent({ aptNm: "나단지", jibun: "2" })];
  const first = JSON.stringify(build({ [NOWON]: items }, { rentsByDistrict: { [NOWON]: rents } }));
  const second = JSON.stringify(build({ [NOWON]: [...items].reverse() }, { rentsByDistrict: { [NOWON]: [...rents].reverse() } }));
  assert.equal(first, second);
  const { nowon } = JSON.parse(first);
  assert.deepEqual(nowon.apartments.map((r) => r[A.id]), ["11350|상계동|1|가단지", "11350|상계동|2|나단지", "11350|상계동|3|다단지"]);
  assert.deepEqual(nowon.apartments[0][A.cells].map((c) => c[C("areaSqm")]), [59, 84.9], "칸은 면적 오름차순");
  assert.deepEqual(Object.keys(JSON.parse(first)), DISTRICTS.map((d) => DISTRICT_SLUGS[d.name]), "구 순서 고정");
});

test("같은 값대의 위치는 구를 가로질러 잰다", () => {
  const files = build({ [NOWON]: many(3), [SEONGDONG]: many(4, { sggCd: SEONGDONG, umdNm: "옥수동", buildYear: 2010 }) });
  assert.deepEqual(rowsOf(files.nowon)[0].cells[0][C("position")], [["peers_n", 2]]);
  assert.deepEqual(rowsOf(files.seongdong)[0].cells[0][C("position")], [["peers_n", 2]]);
});

test("기준 달을 못 정하면 던진다(빌더가 어제 판을 둔다)", () => {
  assert.throws(() => buildFiles({ itemsByDistrict: {}, index: { series: {} }, now: NOW }), /기준 달/);
});

test("한도: 구당·합·개수를 따로 잡는다", () => {
  const files = build({ [NOWON]: many(3) });
  assert.deepEqual(checkLimits(files).problems, []);
  assert.match(checkLimits(files, { ...LIMITS, fileGzip: 10 }).problems.join(), /jongno .*> 10B/);
  assert.match(checkLimits(files, { ...LIMITS, totalGzip: 10 }).problems.join(), /합 \d+B > 10B/);
  const fewer = { ...files };
  delete fewer.nowon;
  assert.match(checkLimits(fewer).problems.join(), /파일 24개/);
});

// ── 파일까지 ──
async function fixtureRepo({ skip = () => false, sales = many(5) } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "reco-build-"));
  const rawDir = path.join(dir, "raw");
  const dataDir = path.join(dir, "docs/data");
  await mkdir(path.join(rawDir, "sale"), { recursive: true });
  await mkdir(path.join(rawDir, "rent"), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const indexFile = path.join(dir, "index.json");
  await writeFile(indexFile, JSON.stringify(index));
  for (const { code } of DISTRICTS) {
    for (const yearMonth of recentMonths(NOW, 7)) {
      for (const kind of ["sale", "rent"]) {
        if (skip(kind, code, yearMonth)) continue;
        const items = kind === "sale" && code === NOWON && yearMonth === "202607" ? sales : [];
        const arrivals = items.length ? { a: "2026-08-14", b: "2026-08-02" } : {};
        await writeFile(path.join(rawDir, kind, `${code}-${yearMonth}.json`), JSON.stringify({ ok: true, items, arrivals }));
      }
    }
  }
  return { dir, rawDir, dataDir, indexFile };
}
const recoNames = async (dataDir) => (await readdir(dataDir)).filter((f) => f.startsWith("reco-")).sort();

test("쓰기: 25개가 다 생기고, 도착일이 실리고, 임시 폴더가 남지 않는다", async () => {
  const repo = await fixtureRepo();
  try {
    const { files } = await generate({ now: NOW, ...repo });
    assert.equal((await recoNames(repo.dataDir)).length, 25);
    const written = JSON.parse(await readFile(path.join(repo.dataDir, recoFileName("nowon")), "utf8"));
    assert.deepEqual(written, JSON.parse(JSON.stringify(files.nowon)));
    assert.equal(written.asOf.deals, "2026-08-14");
    assert.deepEqual(await readdir(path.join(repo.dir, "docs")), ["data"]);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("값이 그대로인 날도 updatedAt 을 새로 쓴다, 그 밖의 바이트는 같다", async () => {
  const repo = await fixtureRepo();
  try {
    await generate({ now: NOW, ...repo });
    const one = await readFile(path.join(repo.dataDir, recoFileName("nowon")), "utf8");
    await generate({ now: new Date(NOW.getTime() + 60_000), ...repo });
    const two = await readFile(path.join(repo.dataDir, recoFileName("nowon")), "utf8");
    assert.notEqual(one, two);
    const blank = (text) => text.replace(/"updatedAt":"[^"]+"/, "");
    assert.equal(blank(one), blank(two));
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

async function keepsYesterday(repo, run_, pattern) {
  try {
    await generate({ now: NOW, ...repo });
    const before = await readFile(path.join(repo.dataDir, recoFileName("jongno")), "utf8");
    await assert.rejects(run_(), pattern);
    assert.equal(await readFile(path.join(repo.dataDir, recoFileName("jongno")), "utf8"), before, "어제 판이 그대로여야 한다");
    assert.equal((await recoNames(repo.dataDir)).length, 25);
    assert.deepEqual(await readdir(path.join(repo.dir, "docs")), ["data"], "임시 폴더가 남았다");
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
}

test("한도를 넘으면 25개 전부 어제 판을 둔다", async () => {
  const repo = await fixtureRepo();
  await keepsYesterday(repo, () => generate({ now: new Date(NOW.getTime() + 60_000), ...repo, limits: { ...LIMITS, fileGzip: 10 } }), /한도 초과/);
});

test("값을 내는 달의 슬롯이 없거나 실패 표시면 그 세대를 포기한다", async () => {
  const repo = await fixtureRepo();
  await keepsYesterday(
    repo,
    async () => {
      await rm(path.join(repo.rawDir, "sale", `${NOWON}-202608.json`));
      return generate({ now: NOW, ...repo });
    },
    /입력 슬롯 없음: sale 11350 202608/
  );
  const failed = await fixtureRepo();
  await keepsYesterday(
    failed,
    async () => {
      await writeFile(path.join(failed.rawDir, "rent", `${SEONGDONG}-202608.json`), JSON.stringify({ ok: false }));
      return generate({ now: NOW, ...failed });
    },
    /입력 슬롯 없음: rent 11200 202608/
  );
});

test("창 앞 달의 슬롯은 없어도 된다(12개월 건수만 줄어든다), 지수가 없으면 포기한다", async () => {
  const repo = await fixtureRepo();
  await keepsYesterday(
    repo,
    async () => {
      await generate({ now: NOW, ...repo });
      await rm(repo.indexFile);
      return generate({ now: NOW, ...repo });
    },
    /실거래가격지수가 없다/
  );
});

test("진입점: --soft-fail 은 경고 + 종료 0 + 파일 그대로, 플래그가 없으면 종료 1", async () => {
  const repo = await fixtureRepo();
  try {
    await generate({ now: NOW, ...repo });
    const before = await readFile(path.join(repo.dataDir, recoFileName("nowon")), "utf8");
    const env = { ...process.env, BUILD_NOW: NOW.toISOString(), RECO_DATA_DIR: repo.dataDir, REALESTATE_RAW_DIR: repo.rawDir, PRICE_INDEX_FILE: path.join(repo.dir, "없는 파일.json") };
    const script = path.join(root, "scripts/build-recommendation.ts");
    const soft = await run(process.execPath, [script, "--soft-fail"], { env });
    assert.match(soft.stdout, /^::warning::근거표 생성 실패 .*실거래가격지수가 없다/m);
    assert.equal(await readFile(path.join(repo.dataDir, recoFileName("nowon")), "utf8"), before);
    await assert.rejects(run(process.execPath, [script], { env }), (err) => err.code === 1 && /근거표 생성 실패/.test(err.stderr));
    const ok = await run(process.execPath, [script, "--soft-fail"], { env: { ...env, PRICE_INDEX_FILE: repo.indexFile } });
    assert.match(ok.stdout, /근거표: 기준 202608, 25개 구, 값을 낸 칸 1개·단지 1개, 뺀 칸 0개/);
    assert.doesNotMatch(ok.stdout, /::warning/);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("등록: 두 곳 모두 --soft-fail 과 로드 실패를 막는 `|| echo` 를 같이 둔다(모듈 로드 실패는 --soft-fail 이 못 잡는다)", async () => {
  const line = /node scripts\/build-recommendation\.ts --soft-fail \|\| echo "::warning::/;
  for (const file of ["scripts/update-all.mjs", ".github/workflows/daily-update.yml"]) {
    assert.match(await readFile(path.join(root, file), "utf8"), line, file);
  }
  // 그 겹이 실제로 막는지: 읽히지 않는 모듈을 같은 모양으로 불러도 셸은 0 으로 끝난다.
  const dir = await mkdtemp(path.join(tmpdir(), "reco-load-"));
  try {
    await writeFile(path.join(dir, "broken.ts"), 'import "./없는 모듈.ts";\n');
    const out = await run("bash", ["-ec", `"${process.execPath}" "${dir}/broken.ts" --soft-fail 2>/dev/null || echo "::warning::x"; echo 다음 단계`]);
    assert.match(out.stdout, /::warning::x\n다음 단계/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
