import test from "node:test";
import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  ALLOWED_COMPARISON, ALLOWED_DISTRICT, ALLOWED_MONTH, ALLOWED_SOURCE, ALLOWED_TOP, CSV_HEADER, MIN_CELL, SUPERSEDED_MARK, SUPERSEDED_PREFIX,
  assertAllowedShape, buildFigures, buildRelease, readSales, renderBody, renderTitle, supersede, toCsv,
} from "../scripts/build-correction-release.mjs";
import { repeatedLiveStats } from "../scripts/cancellation.ts";

// #218: 정정 재신고 집계 Release 산출. 값에 따라 갈리는 검사는 두지 않는다(#8) - 구조·금지어·두 구현의 일치만 본다.
const root = path.resolve(import.meta.dirname, "..");
const FIXTURE = path.join(root, "test/fixtures/correction-twins");
const REAL_RAW = path.join(root, "raw");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const wf = await read(".github/workflows/correction-release.yml");
const daily = await read(".github/workflows/daily-update.yml");
const updateAll = await read("scripts/update-all.mjs");

const hasPython = spawnSync("python3", ["--version"]).status === 0;
const python = (rawDir) =>
  execFileSync("python3", ["-I", path.join(root, "research/correction-twins/check.py")], { env: { ...process.env, REALESTATE_RAW_DIR: rawDir }, encoding: "utf8" });

const fixtureFigures = async () => buildFigures(await readSales(path.join(FIXTURE, "raw")));

/** 시험 입력의 사본을 임시 폴더에 만들고 파일 내용을 바꿔 준다. mutate(파일이름, json)이 json을 직접 고친다. */
async function fixtureCopy(mutate) {
  const dir = await mkdtemp(path.join(tmpdir(), "ct-"));
  await mkdir(path.join(dir, "sale"), { recursive: true });
  await cp(path.join(FIXTURE, "raw/sale"), path.join(dir, "sale"), { recursive: true });
  for (const name of await readdir(path.join(dir, "sale"))) {
    const file = path.join(dir, "sale", name);
    const json = JSON.parse(await readFile(file, "utf8"));
    mutate(name, json);
    await writeFile(file, JSON.stringify(json));
  }
  return dir;
}

// 행 단위 필드 이름. 출력(JSON·CSV·본문)에 이름 자체가 없어야 한다.
const ROW_FIELDS = ["aptNm", "jibun", "umdNm", "aptDong", "floor", "dealAmount", "excluUseAr", "rgstDate", "sggCd", "buyerGbn", "slerGbn", "estateAgentSggNm", "cdealType", "cdealDay", "dealYear", "dealMonth", "dealDay", "buildYear", "dealingGbn"];

// ---- 완료 조건 1: 행 필드 비출력 구조 시험 ----

test("출력 필드는 허용 목록으로 고정돼 있고 행 단위 필드 이름이 목록에 없다", () => {
  for (const allowed of [ALLOWED_TOP, ALLOWED_DISTRICT, ALLOWED_MONTH]) {
    for (const field of ROW_FIELDS) assert.ok(!allowed.includes(field), `허용 목록에 행 필드 ${field}`);
  }
});

test("허용 목록 밖 필드가 어느 층에 끼어도 assertAllowedShape가 거부한다", async () => {
  const base = await fixtureFigures();
  assert.equal(assertAllowedShape(base), true);
  const clone = () => structuredClone(base);
  const muts = [
    (f) => { f.aptNm = "x"; },
    (f) => { f.seoul.jibun = "1"; },
    (f) => { f.seoul.comparison.umdNm = "x"; },
    (f) => { f.seoul.registration.aptDong = "x"; },
    (f) => { f.districts[0].floor = 3; },
    (f) => { f.months[0].dealAmount = "1"; },
    (f) => { f.sample.rgstDate = "x"; },
    (f) => { f.source.aptNm = "x"; },
  ];
  for (const mut of muts) {
    const f = clone();
    mut(f);
    assert.throws(() => assertAllowedShape(f), /허용 목록에 없는 필드/);
  }
});

test("JSON·CSV·본문에 행 단위 필드 이름도, 입력에 있던 단지·동 값도 없다 - 키로 보고 값으로도 본다", async () => {
  const figures = await fixtureFigures();
  const outputs = [JSON.stringify(figures), toCsv(figures), renderBody(figures)];
  // 입력 행에 있던 값(시험 데이터의 단지·동·지번 이름)이 어디에도 새지 않는다.
  const leaked = ["시험단지", "시험동", "서울 시험구"];
  for (const text of outputs) {
    // 영어 본문에는 "floor area"라는 일반 단어가 있어 floor만 JSON·CSV에서 본다.
    const body = text === outputs[2];
    for (const field of ROW_FIELDS.filter((f) => !(body && f === "floor"))) assert.ok(!text.includes(field), `출력에 행 필드 이름 ${field}`);
    for (const value of leaked) assert.ok(!text.includes(value), `출력에 입력 값 ${value}`);
  }
  assert.equal(toCsv(figures).split("\n")[0], CSV_HEADER);
});

test("출력은 서울 전체·구·계약월 세 단위뿐이고 구×계약월 칸이 없다", async () => {
  const figures = await fixtureFigures();
  assert.deepEqual(Object.keys(figures).sort(), [...ALLOWED_TOP].sort());
  for (const row of figures.months) assert.deepEqual(Object.keys(row).sort(), [...ALLOWED_MONTH].sort());
  for (const row of figures.months) assert.ok(!("name" in row) && !("district" in row), "월 칸에 구가 들어 있다");
  assert.deepEqual(new Set(toCsv(figures).trim().split("\n").slice(1).map((l) => l.split(",")[0])), new Set(["seoul", "district", "month"]));
});

// ---- 구·월 n<3 칸 비공개(cpo가 지적한 빠진 시험) ----

test("해제 기록이 3건 미만인 구·월 칸은 숫자를 모두 비우고 CSV도 비어 있다", async () => {
  const figures = await fixtureFigures();
  assert.equal(MIN_CELL, 3);
  const jung = figures.districts.find((d) => d.name === "중구");
  const mar = figures.months.find((m) => m.month === "2026-03");
  assert.ok(jung && mar, "시험 입력에 해제 2건짜리 구와 1건짜리 월이 있어야 한다");
  for (const row of [jung, mar]) {
    assert.deepEqual([row.cancelRecords, row.withTwin, row.sharePct, row.suppressed], [null, null, null, true]);
  }
  assert.deepEqual([jung.registrationRecords, jung.withRegDatePct], [null, null]);
  const csv = toCsv(figures).split("\n");
  assert.equal(csv.find((l) => l.startsWith("district,중구")), "district,중구,,,,1,,");
  assert.equal(csv.find((l) => l.startsWith("month,2026-03")), "month,2026-03,,,,1,,");
  // 서울 전체 합에는 비공개 칸의 기록이 들어 있다(합은 집계다).
  assert.equal(figures.seoul.cancelRecords, 7);
});

test("어떤 입력에서도 공개된 칸은 해제 기록이 3건 이상이고 비공개 칸은 숫자가 없다(실제 raw 포함)", async () => {
  for (const rawDir of [path.join(FIXTURE, "raw"), REAL_RAW]) {
    const figures = buildFigures(await readSales(rawDir));
    for (const row of [...figures.districts, ...figures.months]) {
      if (row.suppressed) assert.deepEqual([row.cancelRecords, row.withTwin, row.sharePct], [null, null, null]);
      else assert.ok(row.cancelRecords >= MIN_CELL, `공개된 칸의 해제 기록이 ${row.cancelRecords}건`);
    }
    for (const d of figures.districts) {
      if (d.registrationRecords !== null) assert.ok(d.registrationRecords >= MIN_CELL);
      else assert.equal(d.withRegDatePct, null);
    }
    assert.ok(figures.seoul.registration.records === 0 || figures.seoul.registration.records >= MIN_CELL);
  }
});

// ---- 완료 조건 2: check.py와 노드 구현의 값 일치 ----

const nums = (line) => [...line.matchAll(/(\d[\d.]*)/g)].map((m) => Number(m[1]));

/** check.py 출력의 둘째·셋째 줄에서 해제 기록 수·짝 수·비교군 수를 뽑는다. */
function checkValues(out) {
  const [, l2, l3] = out.trim().split("\n");
  const m2 = /해제 기록 (\d+)건 중 .* (\d+)건 \(/.exec(l2);
  const m3 = /둘 이상인 경우 (\d+)건 \(([\d.]+)%\)/.exec(l3);
  assert.ok(m2 && m3, `check.py 출력을 못 읽었다: ${l2} / ${l3}`);
  return { cancelRecords: Number(m2[1]), withTwin: Number(m2[2]), repeatedContracts: Number(m3[1]), repeatedPct: Number(m3[2]) };
}

const nodeValues = (f) => ({
  cancelRecords: f.seoul.cancelRecords,
  withTwin: f.seoul.withTwin,
  repeatedContracts: f.seoul.comparison.repeatedContracts,
  repeatedPct: f.seoul.comparison.sharePct,
});

test("노드 구현이 고정된 check.out(시험 입력)과 같은 값을 낸다 - python3 없이도 돈다", async () => {
  const fixed = checkValues(await readFile(path.join(FIXTURE, "check.out"), "utf8"));
  assert.deepEqual(nodeValues(await fixtureFigures()), fixed);
});

test("check.py를 지금 돌린 출력이 고정된 check.out과 같고, 실제 raw에서도 노드와 같은 값이다", { skip: !hasPython && "python3 없음 - 위 고정 check.out 대조가 대신한다" }, async () => {
  assert.equal(python(path.join(FIXTURE, "raw")), await readFile(path.join(FIXTURE, "check.out"), "utf8"));
  assert.deepEqual(nodeValues(buildFigures(await readSales(REAL_RAW))), checkValues(python(REAL_RAW)));
});

test("check.py는 표준 라이브러리만 쓰고 입력 경로를 환경변수로 받는다", async () => {
  const src = await read("research/correction-twins/check.py");
  const imports = [...src.matchAll(/^import (.+)$/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" ")[0]));
  assert.deepEqual(imports.sort(), ["collections", "glob", "json", "os"]);
  assert.match(src, /REALESTATE_RAW_DIR/);
});

test("산출 스크립트는 환경변수 경로로 입력을 받고, 사이트와 같은 함수를 쓴다(산식 이중 구현 없음)", async () => {
  const src = await read("scripts/build-correction-release.mjs");
  assert.match(src, /from "\.\/cancellation\.ts"/);
  for (const fn of ["withoutCorrections", "correctionStats", "registrationStats", "repeatedLiveStats"]) assert.match(src, new RegExp(`\\b${fn}\\b`));
  assert.match(src, /RAW_DIR/);
  // 계약 키·정정 판정을 여기서 다시 정의하지 않는다.
  assert.doesNotMatch(src, /contractKey\s*=|function contractKey|new Map\(\)/);
});

// ---- 완료 조건 5: 본문 템플릿 ----

const KO_BANNED = ["사고", "유출", "부풀려", "잘못된 정보를 제공", "피해", "책임", "항상", "절대", "완전", "오류 0건"];
const EN_BANNED = ["always", "never", "complete", "leak", "breach", "damage", "liab", "fault", "blame", "zero errors", "inflat"];
// #221 금지어는 method.html 절 시험(test/method-corrections.test.mjs)과 같은 목록이다.
const ASSERTIVE = [/정정이다/, /정정입니다/, /고쳤/, /고친 것/, /고쳐 쓴/, /깨진 계약이 아니라/, /신고를 고/, /not a broken deal/i, /a correction to the filing/i, /corrected filing/i, /were corrected/i, /is a correction/i, /are corrections/i];
const SOLICIT_KO = [/매수/, /매도/, /추천/, /투자하/, /사세요/, /팔아/, /유망/];
const SOLICIT_EN = [/\bbuy\b/i, /\bsell\b/i, /\binvest/i, /recommend/i];

/**
 * 금지어 검사 전에 지우는 낱말 두 개. 둘 다 금지어의 일부로 우연히 걸리는 것이다: 'incomplete'는 legal이 R2에서 직접 쓴
 * 문장("신고가 아직 덜 쌓여" 영문 대안)의 낱말이고, 'defaultdict'는 check.py가 쓰는 표준 라이브러리 이름이다(fault).
 * 'complete'·'completely'·'default' 같은 다른 형태는 그대로 걸린다.
 */
const forBannedScan = (text) => text.replaceAll("incomplete", "").replaceAll("defaultdict", "");

function assertNeutral(label, text) {
  const lower = forBannedScan(text).toLowerCase();
  for (const w of KO_BANNED) assert.ok(!text.includes(w), `${label}: 한국어 금지어 ${w}`);
  for (const w of EN_BANNED) assert.ok(!lower.includes(w), `${label}: 영어 금지어 ${w}`);
  for (const re of ASSERTIVE) assert.ok(!re.test(text), `${label}: 단정 ${re}`);
  for (const re of [...SOLICIT_KO, ...SOLICIT_EN]) assert.ok(!re.test(text), `${label}: 권유 ${re}`);
}

/** 사이트 해제 lead 밖의 산출물(JSON·CSV·check.py·check.out·제목)은 '정정'·'재신고'·'정상 기록' 같은 이름 붙임도 없어야 한다(legal M2). */
function assertNoLabels(label, text) {
  for (const w of ["정정", "재신고", "정상 기록", "정정됨"]) assert.ok(!text.includes(w), `${label}: 이름 붙임 ${w}`);
}

const split = (body) => {
  const [ko, en] = body.split("\n---\n");
  assert.ok(ko && en, "한·영 두 구역이 있어야 한다");
  return { ko, en };
};

const CHECK_OUT_LINES = [
  /^입력 raw\/sale \d+개 파일, 최신 \d{5}-\d{6}\.json, \d+건$/,
  /^해제 기록 \d+건 중 같은 계약 기록이 해제되지 않은 채 다시 있는 것 \d+건 \(\d+\.\d%\)$/,
  /^비교: 해제되지 않은 기록끼리 같은 계약 기록이 둘 이상인 경우 \d+건 \(\d+\.\d{2}%\)$/,
  /^2026년 3월까지 계약 중 짝이 있는 해제 기록 \d+건 가운데 짝에 등기일이 있는 것 \d+건 \(\d+\.\d%, 본문 정의와 기준이 다른 일회성 값\)$/,
];

test("본문: 금지어·단정 문장·권유 문장이 한·영 어디에도 없다", async () => {
  const { ko, en } = split(renderBody(await fixtureFigures()));
  assertNeutral("본문 한국어", ko);
  assertNeutral("본문 영어", en);
});

test("산출물 전부(JSON·CSV·본문·제목·check.py·check.out)에 금지어·단정·권유 문장이 없다 - 시험 입력과 실제 raw 양쪽(legal M2)", async () => {
  const checkPy = await read("research/correction-twins/check.py");
  const checkOuts = [await readFile(path.join(FIXTURE, "check.out"), "utf8"), await read("research/correction-twins/check.out")];
  assertNeutral("check.py", checkPy);
  assertNoLabels("check.py", checkPy);
  checkOuts.forEach((text, i) => {
    assertNeutral(`check.out[${i}]`, text);
    assertNoLabels(`check.out[${i}]`, text);
  });
  for (const rawDir of [path.join(FIXTURE, "raw"), REAL_RAW]) {
    const figures = buildFigures(await readSales(rawDir));
    const body = renderBody(figures);
    const named = { json: JSON.stringify(figures, null, 2), csv: toCsv(figures), title: renderTitle(figures) };
    for (const [label, text] of Object.entries(named)) {
      assertNeutral(label, text);
      assertNoLabels(label, text);
    }
    assertNeutral("본문", body);
    // 본문은 표시 이름 '정정됨 (SUPERSEDED)'(legal이 이름을 유지하라고 했다)만 예외다.
    assertNoLabels("본문(표시 이름 제외)", body.replaceAll(SUPERSEDED_MARK, ""));
  }
});

test("check.out은 중립 문구 네 줄이고 고정본·실제 입력 양쪽이 같은 줄 구조다(값이 아니라 구조만 본다)", async () => {
  for (const text of [await readFile(path.join(FIXTURE, "check.out"), "utf8"), await read("research/correction-twins/check.out")]) {
    const lines = text.trimEnd().split("\n");
    assert.equal(lines.length, CHECK_OUT_LINES.length);
    lines.forEach((line, i) => assert.match(line, CHECK_OUT_LINES[i], `check.out ${i + 1}째 줄: ${line}`));
  }
});

test("본문: 사이트 correctionSentence와 맞는 '해제되지 않은 채 다시 있는' 구조 + 사유 미확인 + 비교군·표본 기간", async () => {
  const figures = await fixtureFigures();
  const { ko, en } = split(renderBody(figures));
  assert.match(ko, /해제되지 않은 채 다시 있습니다/);
  assert.match(ko, /신고 사유는 이 원천 자료에 없어 확인하지 않았고/);
  assert.match(en, /match a record of the same contract \(district, neighbourhood \(legal dong\), lot number, complex, floor area, floor, contract date, amount\) that appears again without a cancellation mark/);
  assert.match(en, /reason for a filing is not in the source data and was not checked/);
  assert.match(ko, /\(구·법정동·지번·단지·전용면적·층·계약일·금액\)/);
  for (const text of [ko, en]) {
    assert.ok(text.includes(String(figures.seoul.comparison.sharePct)), "비교군 비율이 없다");
    assert.ok(text.includes(figures.sample.firstContractMonth.replace("-", ".")) && text.includes(figures.sample.lastContractMonth.replace("-", ".")), "표본 기간이 없다");
  }
});

test("본문 비교군: 분자(계약 기록 개수)와 분모(기록 건수)의 단위가 다르다고 밝히고 겹친 기록 자체의 건수를 코드로 낸 값으로 적는다(legal M3)", async () => {
  const figures = await fixtureFigures();
  const c = figures.seoul.comparison;
  const { ko, en } = split(renderBody(figures));
  assert.ok(ko.includes(`그런 계약 기록이 ${c.repeatedContracts}개이고, 이 개수를 해제되지 않은 기록 ${c.liveRecords}건으로 나눈 값이 ${c.sharePct}%입니다(분자는 계약 기록의 개수, 분모는 기록의 건수라 단위가 다릅니다. 겹친 기록 자체를 세면 ${c.overlappingRecords}건입니다).`));
  assert.ok(en.includes(`there are ${c.repeatedContracts} such contract records, and ${c.repeatedContracts} divided by the ${c.liveRecords} records without a cancellation mark is ${c.sharePct}% (the numerator counts contract records and the denominator counts filings, so the units differ; counting the overlapping filings themselves gives ${c.overlappingRecords}).`));
  assert.doesNotMatch(ko, /해제되지 않은 기록 \d+건의 [\d.]+%/, "단위가 다른 분자·분모를 '건의 %'로 합쳐 적었다");
  // 허용 목록에 있고 JSON에도 나간다.
  assert.ok(ALLOWED_COMPARISON.includes("overlappingRecords"));
  assert.equal(JSON.parse(JSON.stringify(figures)).seoul.comparison.overlappingRecords, c.overlappingRecords);
  assert.ok(c.overlappingRecords >= 2 * c.repeatedContracts && c.overlappingRecords <= c.liveRecords);
});

test("repeatedLiveStats: 겹친 키의 개수(repeated)와 그 키에 속한 기록 건수(overlapping)를 따로 센다", () => {
  const rec = (floor, extra = {}) => ({ sggCd: 1, umdNm: "a", jibun: "1", aptNm: "b", excluUseAr: 84, floor, dealYear: 2026, dealMonth: 1, dealDay: 1, dealAmount: "1", cdealType: "", cdealDay: "", ...extra });
  const items = [rec(1), rec(1), rec(1), rec(2), rec(2), rec(3), rec(1, { cdealType: "O", cdealDay: "26.02.01" }), rec(4, { cdealType: "O", cdealDay: "26.02.01" })];
  assert.deepEqual(repeatedLiveStats(items), { liveRecords: 6, repeated: 2, overlapping: 5, share: Math.round((2 / 6) * 10000) / 100 });
  assert.deepEqual(repeatedLiveStats([]), { liveRecords: 0, repeated: 0, overlapping: 0, share: null });
});

test("겹친 기록 건수는 실제 raw에서 독립 셈과 같다(두 구현의 일치만 본다 - 값은 고정하지 않는다)", async () => {
  const { byDistrict } = await readSales(REAL_RAW);
  const live = Object.values(byDistrict).flat().filter((i) => !String(i.cdealType ?? "").trim() && !String(i.cdealDay ?? "").trim());
  const counts = new Map();
  for (const i of live) {
    const k = JSON.stringify([i.sggCd, i.umdNm, String(i.jibun), i.aptNm, i.excluUseAr, i.floor, i.dealYear, i.dealMonth, i.dealDay, i.dealAmount]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const multi = [...counts.values()].filter((n) => n >= 2);
  const figures = buildFigures(await readSales(REAL_RAW));
  assert.equal(figures.seoul.comparison.overlappingRecords, multi.reduce((a, b) => a + b, 0));
  assert.equal(figures.seoul.comparison.repeatedContracts, multi.length);
  assert.equal(figures.seoul.comparison.liveRecords, live.length);
  assert.ok(renderBody(figures).includes(`겹친 기록 자체를 세면 ${figures.seoul.comparison.overlappingRecords.toLocaleString("ko-KR")}건입니다`));
});

test("본문: 출처 문구(clo 조건 4)·가공값 구분이 한·영에 있고, 이용허락 문장·확인일은 본문·JSON 어디에도 없다(legal M4, R6)", async () => {
  const figures = await fixtureFigures();
  const body = renderBody(figures);
  const { ko, en } = split(body);
  assert.ok(ko.includes("출처: 국토교통부 아파트 매매 실거래가 자료(공공데이터포털 15126469), 수집 시각 2026-10-10. 이 자료는 원천을 집계·가공한 값이며 국토교통부가 후원·보증하지 않습니다."));
  assert.match(ko, /가공값이고 원천의 원값이 아닙니다/);
  assert.ok(en.includes("Source: Ministry of Land, Infrastructure and Transport apartment sale transaction data (data.go.kr 15126469), collected 2026-10-10. These are aggregated and processed values derived from the source and are not endorsed or guaranteed by the Ministry."));
  assert.doesNotMatch(body, /공개시스템/);
  // 이용허락: 코드에 박힌 확인일이 확인 없이 찍히지 않게 문장·JSON 필드·상수를 모두 없앤다.
  assert.doesNotMatch(body, /이용허락|제한 없음|No restrictions|license|확인\)|checked 20/i);
  const json = JSON.stringify(figures);
  assert.doesNotMatch(json, /license|이용허락|제한 없음|checkedAt/i);
  assert.deepEqual(ALLOWED_SOURCE, ["datasetId"]);
  assert.deepEqual(Object.keys(figures.source), ["datasetId"]);
  assert.doesNotMatch(await read("scripts/build-correction-release.mjs"), /LICENSE_CHECKED|licenseCheckedAt/);
});

test("수집 시각: 파일 observedAt의 KST 최솟값·최댓값을 JSON에 내고, 본문은 범위로 적는다(같은 날이면 하루만)(legal M1)", async () => {
  // 시험 입력은 모두 같은 날이다 - 단일 날짜.
  const same = await fixtureFigures();
  assert.deepEqual([same.collectedFrom, same.collectedTo, same.collectedAt, same.asOf], ["2026-10-10", "2026-10-10", "2026-10-10", "2026-10-10"]);
  const { ko: koSame, en: enSame } = split(renderBody(same));
  assert.ok(koSame.includes("수집 시각 2026-10-10. 이 자료는"));
  assert.ok(enSame.includes("collected 2026-10-10. These are"));
  assert.doesNotMatch(koSame + enSame, /~2026-10-10|between/);

  // 파일마다 다르다 - UTC 날짜(08-16)와 KST 날짜(08-17)가 갈리는 시각을 최솟값으로 둔다.
  const dir = await fixtureCopy((name, json) => {
    if (name === "11110-202603.json") json.observedAt = "2026-08-16T15:30:00.000Z";
    if (name === "11110-202604.json") json.observedAt = "2026-09-20T02:00:00.000Z";
  });
  const spread = buildFigures(await readSales(dir));
  assert.deepEqual([spread.collectedFrom, spread.collectedTo, spread.collectedAt, spread.asOf], ["2026-08-17", "2026-10-10", "2026-10-10", "2026-10-10"]);
  const { ko, en } = split(renderBody(spread));
  assert.ok(ko.includes("수집 시각 2026-08-17~2026-10-10(파일마다 수집일이 달라, 가장 늦은 날을 기준일로 했습니다). 이 자료는"));
  assert.ok(en.includes("collected between 2026-08-17 and 2026-10-10 (collection dates differ by file; the latest date is used as the as-of date). These are"));
  // 수집일은 숫자가 아니다 - 지문은 같고, 허용 목록 안이다.
  assert.equal(spread.figuresDigest, same.figuresDigest);
  assert.equal(assertAllowedShape(spread), true);
  assert.ok(ALLOWED_TOP.includes("collectedFrom") && ALLOWED_TOP.includes("collectedTo"));
});

test("본문: 등기율은 '짝에 등기일이 있는 비율' 하나로 정의하고 check.py의 3월까지 일회성 값과 구분한다", async () => {
  const { ko, en } = split(renderBody(await fixtureFigures()));
  assert.equal((ko.match(/등기율 = /g) || []).length, 1, "등기율 정의가 하나가 아니다");
  assert.match(ko, /^## 등기율 정의$/m);
  assert.match(ko, /등기율 = 짝 기록에 등기일이 있는 비율/);
  assert.match(ko, /registrationStats/);
  assert.match(ko, /2026년 3월까지만 센 일회성 값이라 위 정의와 기준이 다릅니다/);
  assert.equal((en.match(/Registration rate = /g) || []).length, 1);
  assert.match(en, /^## Registration rate: definition$/m);
  assert.doesNotMatch(ko + en, /하나만|one definition/);
  assert.match(en, /one-off figure for contract months up to March 2026/);
});

test("본문: 비공개 칸·최근 월 지연·구 순위 아님 문장이 한·영에 있다(legal R1·R2·R4)", async () => {
  const figures = await fixtureFigures();
  const hidden = figures.districts.filter((d) => d.suppressed).length + figures.months.filter((m) => m.suppressed).length;
  const { ko, en } = split(renderBody(figures));
  assert.ok(ko.includes(`칸의 해제 기록이 3건 미만이면 숫자를 비웠습니다(이 Release에서 ${hidden}칸). 서울 전체 값에서 다른 칸을 빼면 계산할 수 있는 칸이 있으며, 이는 작은 표본의 비율이 눈에 띄지 않게 하려는 기준입니다.`));
  assert.ok(en.includes(`numbers are left empty (cells withheld in this release: ${hidden}). Some of those figures can be worked out by subtracting other cells from the Seoul total; the rule only keeps ratios from very small samples from standing out.`));
  assert.ok(ko.includes("최근 계약월은 신고가 아직 덜 쌓여 건수가 적을 수 있어, 월별 건수를 앞선 달과 곧바로 견주지 마십시오."));
  assert.ok(en.includes("Recent contract months may still be incomplete because filings keep arriving, so do not compare monthly counts directly with earlier months."));
  assert.ok(ko.includes("구별 비율은 신고 관행과 집계 시점에 따라 달라질 수 있어 구 사이의 순위나 우열을 보이려는 것이 아닙니다."));
  assert.ok(en.includes("District figures can vary with filing practice and timing and are not meant to rank districts."));
});

test("본문 갱신 절: 월 1회 '설정돼 있다'일 뿐 약속이 아니고, 숫자가 바뀔 때의 표시 절차·인용 시 기준일 안내·표시의 뜻이 한·영에 있다(legal M5·M6)", async () => {
  const { ko, en } = split(renderBody(await fixtureFigures()));
  assert.ok(ko.includes('월 1회 다시 세도록 설정돼 있습니다(수동 실행도 가능). 일정이나 지속을 약속하지 않으며, 중단·변경될 수 있고 늦어질 수 있습니다. 숫자가 달라지면 새 Release를 올리고 이전 Release 본문 맨 위에 "정정됨 (SUPERSEDED)" 표시와 새 Release 링크를 남기도록 되어 있습니다. 숫자가 같으면 새로 올리지 않습니다. 현재 값은 가장 늦은 기준일의 Release이고, 이 Release를 인용할 때는 기준일을 함께 적어 주십시오.'));
  assert.ok(en.includes('This is set up to be recounted once a month (a manual run is also possible). No schedule or continuation is promised; it may be paused, changed or delayed. If the figures change, a new release is published and the previous release body is set to get a "정정됨 (SUPERSEDED)" notice with a link to the new one at the top. If the figures are the same, no new release is made. The current figures are those of the release with the latest as-of date; please cite the as-of date with any figure.'));
  assert.doesNotMatch(ko, /월 1회 다시 셉니다/);
  assert.match(ko, /그것만으로 이전 값에 셈의 오류가 있었다는 뜻은 아닙니다/);
  assert.match(ko, /셈 자체에 오류가 있어 숫자를 바꿀 때는 표시 옆에 그 이유를 적습니다/);
  assert.match(en, /it does not by itself mean the earlier figures contained a counting error/);
  assert.match(en, /the reason is stated next to the notice/);
});

test("supersede(legal M5): 이전 본문 맨 위에 '새 데이터 반영, 셈 오류 인정 아님' 안내를 한·영으로 붙이고, 다시 붙여도 중복되지 않는다", () => {
  const prev = "# 이전 본문\n숫자";
  const once = supersede(prev, "correction-twins-2026-11-12");
  const link = "https://github.com/kyhsa93/jipgye/releases/tag/correction-twins-2026-11-12";
  assert.ok(once.startsWith(SUPERSEDED_PREFIX) && SUPERSEDED_PREFIX === "> **정정됨 (SUPERSEDED)**");
  assert.ok(once.endsWith(`\n\n${prev}`));
  assert.ok(once.includes(`— 이 Release의 숫자는 새 기준일로 다시 센 새 Release \`correction-twins-2026-11-12\`(${link})의 숫자로 대체됐습니다. 새 데이터나 원천 기록의 수정이 반영된 것이며, 이 표시만으로 이전 값에 셈의 오류가 있었다는 뜻은 아닙니다. 아래 본문은 이 기준일의 값으로만 읽으십시오.`));
  assert.ok(once.includes(`This release's figures have been replaced by the recount in the new release \`correction-twins-2026-11-12\` (${link}). New data or amended source records are reflected; this notice alone does not mean the earlier figures contained a counting error. Read the text below only as the figures of its own as-of date.`));
  assert.doesNotMatch(once, /바뀌었습니다|superseded by/);
  assertNeutral("supersede 안내", once.slice(0, once.length - prev.length));
  assert.equal(supersede(once, "correction-twins-2026-12-12"), once);
});

test("supersede: 실제 본문(갱신 절에 표시 이름이 적혀 있다)에도 표시가 붙는다 - 본문 안의 표시 이름을 '이미 붙음'으로 읽지 않는다", async () => {
  const body = renderBody(await fixtureFigures(), { tag: "correction-twins-2026-10-10" });
  assert.ok(body.includes(SUPERSEDED_MARK), "본문 갱신 절에 표시 이름이 있어야 이 시험이 의미가 있다");
  const marked = supersede(body, "correction-twins-2026-11-12");
  assert.notEqual(marked, body, "표시가 붙지 않았다");
  assert.ok(marked.startsWith(SUPERSEDED_PREFIX) && marked.endsWith(body));
  assert.equal(supersede(marked, "correction-twins-2026-12-12"), marked);
});

test("Release 제목은 중립 문구이고 태그는 식별자라 그대로다(legal R8)", async () => {
  const figures = await fixtureFigures();
  assert.equal(renderTitle(figures), "서울 아파트 매매 해제 기록 집계 (기준일 2026-10-10) / Seoul apartment sale cancellation records, aggregate (as of 2026-10-10)");
  assertNeutral("제목", renderTitle(figures));
  assertNoLabels("제목", renderTitle(figures));
  assert.match(wf, /--title "\$\(cat "\$out\/title\.txt"\)"/);
  assert.doesNotMatch(wf, /--title "\$tag"/);
});

// ---- 숫자 지문(같은 숫자면 새 Release를 만들지 않는다) ----

test("figuresDigest: 같은 입력이면 같고 숫자가 바뀌면 다르며 기준일만 바뀐 것은 같다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ct-"));
  const a = await fixtureFigures();
  const b = await fixtureFigures();
  assert.equal(a.figuresDigest, b.figuresDigest);
  // 입력 파일 하나에서 해제 표시를 지운 사본
  const { cp, mkdir } = await import("node:fs/promises");
  await mkdir(path.join(dir, "sale"), { recursive: true });
  await cp(path.join(FIXTURE, "raw/sale"), path.join(dir, "sale"), { recursive: true });
  const file = path.join(dir, "sale/11110-202604.json");
  const json = JSON.parse(await readFile(file, "utf8"));
  json.observedAt = "2026-11-12T02:00:00.000Z"; // 기준일만 바뀜
  await writeFile(file, JSON.stringify(json));
  const dateOnly = buildFigures(await readSales(dir));
  assert.equal(dateOnly.asOf, "2026-11-12");
  assert.equal(dateOnly.figuresDigest, a.figuresDigest, "기준일만 바뀐 것을 숫자가 바뀐 것으로 봤다");
  json.items = json.items.slice(0, -1); // 정상 기록 하나 삭제
  await writeFile(file, JSON.stringify(json));
  assert.notEqual(buildFigures(await readSales(dir)).figuresDigest, a.figuresDigest);
});

test("CLI --same: 지문이 같으면 0, 다르면 1, 비교하지 못하면 2(내부 오류가 '숫자가 다름'으로 읽히지 않는다)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ct-"));
  const a = await fixtureFigures();
  const write = async (name, f) => { const p = path.join(dir, name); await writeFile(p, JSON.stringify(f)); return p; };
  const pa = await write("a.json", a);
  const pb = await write("b.json", { ...a, asOf: "2026-12-01" });
  const pc = await write("c.json", { ...a, figuresDigest: "0000" });
  const run = (x, y) => spawnSync("node", [path.join(root, "scripts/build-correction-release.mjs"), "--same", x, y], { encoding: "utf8" });
  assert.equal(run(pa, pb).status, 0);
  assert.equal(run(pa, pc).status, 1);
  // 비교 불가: 없는 파일·깨진 JSON·지문 없는 새 JSON·인자 부족은 2. 이전 쪽에 지문이 없는 것은 '다름'(1)이다.
  const broken = path.join(dir, "broken.json");
  await writeFile(broken, "{ not json");
  const noDigest = await write("nodigest.json", { ...a, figuresDigest: undefined });
  for (const [x, y, why] of [[path.join(dir, "missing.json"), pb, "없는 이전 파일"], [pa, path.join(dir, "missing.json"), "없는 새 파일"], [broken, pb, "깨진 이전 JSON"], [pa, broken, "깨진 새 JSON"], [pa, noDigest, "지문 없는 새 JSON"]]) {
    const r = run(x, y);
    assert.equal(r.status, 2, `${why}: 종료 코드 ${r.status}`);
    assert.match(r.stderr, /숫자를 비교하지 못했다/);
  }
  assert.equal(spawnSync("node", [path.join(root, "scripts/build-correction-release.mjs"), "--same", pa], { encoding: "utf8" }).status, 2, "인자 부족");
  assert.equal(run(noDigest, pa).status, 1, "이전 쪽에 지문이 없으면 같다고 볼 근거가 없다");
});

// ---- 산출 한 바퀴 ----

test("buildRelease: 시험 입력으로 파일 다섯 개와 tag.txt·title.txt가 나오고 check.out이 고정본과 같다", { skip: !hasPython && "python3 없음" }, async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "ct-out-"));
  const { tag } = await buildRelease({ rawDir: path.join(FIXTURE, "raw"), outDir });
  assert.match(tag, /^correction-twins-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual((await readdir(outDir)).sort(), ["README.md", "check.out", "check.py", `${tag}.csv`, `${tag}.json`, "tag.txt", "title.txt"].sort());
  assert.equal(await readFile(path.join(outDir, "title.txt"), "utf8"), `${renderTitle(await fixtureFigures())}\n`);
  assert.equal(await readFile(path.join(outDir, "check.out"), "utf8"), await readFile(path.join(FIXTURE, "check.out"), "utf8"));
  assert.equal(await readFile(path.join(outDir, "check.py"), "utf8"), await read("research/correction-twins/check.py"));
  assert.deepEqual(JSON.parse(await readFile(path.join(outDir, `${tag}.json`), "utf8")), await fixtureFigures());
});

test("산출물 폴더는 커밋 대상이 아니다 - 스크립트는 저장소 안에 기본 산출 경로를 두지 않는다", async () => {
  const src = await read("scripts/build-correction-release.mjs");
  assert.match(src, /CORRECTION_OUT_DIR\(산출 폴더\)가 필요하다/);
  assert.doesNotMatch(src, /path\.join\(root, "(dist|out)/);
});

// ---- 완료 조건 3·4: 워크플로 ----

test("워크플로: dispatch + 월 1회 cron이고 일일 수집·공시가격 API와 같은 분에 돌지 않는다", async () => {
  assert.match(wf, /^on:\n  schedule:\n    - cron: "\d+ \d+ \d+ \* \*"\n  workflow_dispatch:/m);
  const cron = wf.match(/cron: "(\d+) (\d+) (\d+) \* \*"/);
  assert.ok(cron, "월 1회(일 필드 고정) cron이어야 한다");
  const taken = [...(daily + (await read(".github/workflows/official-price-api.yml"))).matchAll(/cron: "(\d+) (\d+) /g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(!taken.includes(`${cron[1]} ${cron[2]}`), "다른 워크플로와 같은 시각이다");
});

test("워크플로: permissions는 contents: write 하나, 액션은 SHA 고정, 시크릿 없음", async () => {
  assert.match(wf, /^permissions:\n  contents: write\n(?!  )/m);
  assert.equal((wf.match(/permissions:/g) || []).length, 1);
  for (const m of wf.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  assert.doesNotMatch(wf, /secrets\.(?!GITHUB_TOKEN)/);
  assert.match(wf, /GH_TOKEN: \$\{\{ github\.token \}\}|GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  // 기존 워크플로와 같은 액션 SHA를 쓴다.
  const known = new Set([...(await read(".github/workflows/summarize.yml")).matchAll(/uses: (\S+)/g)].map((m) => m[1]));
  for (const m of wf.matchAll(/uses: (\S+)/g)) assert.ok(known.has(m[1]), `기존 워크플로에 없는 액션/SHA: ${m[1]}`);
});

test("워크플로: 별도 concurrency 그룹이고 digest-pipeline을 잡지 않는다", () => {
  assert.match(wf, /concurrency:\n  group: correction-release\n  cancel-in-progress: false/);
  assert.doesNotMatch(wf.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n"), /digest-pipeline/);
});

test("워크플로: 입력은 env로만 받고 run에 ${{ }}를 직접 보간하지 않는다", () => {
  for (const block of wf.split(/\n\s+run: /).slice(1)) {
    const body = block.split(/\n      - /)[0];
    assert.doesNotMatch(body, /\$\{\{/, `run 블록에 직접 보간: ${body.slice(0, 80)}`);
  }
  assert.match(wf, /REALESTATE_RAW_DIR: /);
  assert.match(wf, /CORRECTION_OUT_DIR: /);
});

test("워크플로: 일일 파이프라인과 update-all에 들어가지 않고, gh release create로 올리며 숫자가 같으면 건너뛴다", () => {
  assert.doesNotMatch(daily, /correction-release|build-correction-release/);
  assert.doesNotMatch(updateAll, /build-correction-release/);
  assert.match(wf, /gh release create "\$tag"/);
  assert.match(wf, /build-correction-release\.mjs --same/);
  assert.match(wf, /build-correction-release\.mjs --supersede/);
  assert.match(wf, /gh release edit/);
  assert.match(wf, /gh release list/);
  assert.match(wf, /--notes-file/);
  // 새 Release를 먼저 만들고, 이전 Release 표시는 그 뒤(실패해도 다음 실행이 다시 표시한다).
  assert.ok(wf.indexOf("gh release create") < wf.indexOf("gh release edit"));
});

// ---- 워크플로 단계를 가짜 gh로 직접 돌린다(legal·cto 수정 요청) ----
// 워크플로 YAML의 run 블록을 그대로 뽑아 bash로 돌린다. gh는 PATH 앞에 둔 가짜이고 호출을 기록한다. 가짜 gh의 `release list`는
// 실제 gh의 --jq 필터를 돌리지 않고 이미 걸러진 태그 목록을 그대로 낸다(필터 자체는 gh 안의 것이라 여기서 시험하지 않는다).

/** 이름으로 찾은 단계의 run 블록(YAML 들여쓰기 10칸을 걷어 낸 bash 본문). */
function stepRun(name) {
  const lines = wf.split("\n");
  const i = lines.findIndex((l) => l.trimEnd() === `      - name: ${name}`);
  assert.ok(i >= 0, `단계가 없다: ${name}`);
  const next = lines.findIndex((l, j) => j > i && l.startsWith("      - "));
  const r = lines.findIndex((l, j) => j > i && l === "        run: |");
  assert.ok(r > i && (next < 0 || r < next), `run 블록이 없다: ${name}`);
  const out = [];
  for (let j = r + 1; j < lines.length && (lines[j] === "" || lines[j].startsWith("          ")); j++) out.push(lines[j].slice(10));
  return out.join("\n");
}

const FAKE_GH = `#!/bin/bash
echo "$*" >> "$FAKE_GH_LOG"
d="$FAKE_GH_DIR"
case "$1 $2" in
  "release view")
    if [[ " $* " == *" --json "* ]]; then cat "$d/body-$3.md"; exit 0; fi
    [ -e "$d/exists-$3" ] ;;
  "release list")
    if [ -e "$d/list-fails" ]; then echo "HTTP 502: Bad Gateway" >&2; exit 1; fi
    cat "$d/tags.txt" ;;
  "release download")
    tag="$3"; dir=""
    while [ $# -gt 0 ]; do if [ "$1" = "--dir" ]; then dir="$2"; fi; shift; done
    if [ ! -e "$d/asset-$tag.json" ]; then echo "no assets match the file pattern" >&2; exit 1; fi
    cp "$d/asset-$tag.json" "$dir/$tag.json" ;;
  "release create") exit 0 ;;
  "release edit")
    tag="$3"; f=""
    while [ $# -gt 0 ]; do if [ "$1" = "--notes-file" ]; then f="$2"; fi; shift; done
    cp "$f" "$d/edited-$tag.md" ;;
  *) echo "예상 밖의 gh 호출: $*" >&2; exit 99 ;;
esac
`;

/**
 * 한 시나리오를 만든다: out(산출 폴더, 시험 입력 기준)과 fake(가짜 gh 상태 폴더). opts:
 * tags(release list가 내는 태그들), listFails, exists(gh release view가 성공할 태그), assets({태그: JSON 문자열}), bodies({태그: 본문}).
 */
async function scenario({ tags = [], listFails = false, exists = [], assets = {}, bodies = {} } = {}) {
  const figures = await fixtureFigures();
  const tag = `correction-twins-${figures.asOf}`;
  const base = await mkdtemp(path.join(tmpdir(), "ct-wf-"));
  const out = path.join(base, "out");
  const fake = path.join(base, "fake");
  const bin = path.join(base, "bin");
  const runnerTemp = path.join(base, "tmp");
  for (const d of [out, fake, bin, runnerTemp]) await mkdir(d, { recursive: true });
  await writeFile(path.join(out, "tag.txt"), `${tag}\n`);
  await writeFile(path.join(out, "title.txt"), `${renderTitle(figures)}\n`);
  await writeFile(path.join(out, `${tag}.json`), JSON.stringify(figures));
  await writeFile(path.join(out, `${tag}.csv`), toCsv(figures));
  await writeFile(path.join(out, "README.md"), renderBody(figures, { tag }));
  await writeFile(path.join(out, "check.py"), await read("research/correction-twins/check.py"));
  await writeFile(path.join(out, "check.out"), await readFile(path.join(FIXTURE, "check.out"), "utf8"));
  await writeFile(path.join(bin, "gh"), FAKE_GH);
  await chmod(path.join(bin, "gh"), 0o755);
  await writeFile(path.join(fake, "tags.txt"), tags.map((t) => `${t}\n`).join(""));
  if (listFails) await writeFile(path.join(fake, "list-fails"), "");
  for (const t of exists) await writeFile(path.join(fake, `exists-${t}`), "");
  for (const [t, json] of Object.entries(assets)) await writeFile(path.join(fake, `asset-${t}.json`), json);
  for (const [t, body] of Object.entries(bodies)) await writeFile(path.join(fake, `body-${t}.md`), body);
  const log = path.join(fake, "gh.log");
  await writeFile(log, "");
  const run = (name) =>
    spawnSync("bash", ["-c", stepRun(name)], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, RUNNER_TEMP: runnerTemp, CORRECTION_OUT_DIR: out, GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567", FAKE_GH_DIR: fake, FAKE_GH_LOG: log },
    });
  const calls = async () => (await readFile(log, "utf8")).split("\n").filter(Boolean);
  return { figures, tag, out, fake, run, calls };
}

const UPLOAD = "Release 올리기 (숫자가 같으면 건너뜀)";
const MARK_STEP = "이전 Release에 정정됨 표시";
const createCalls = (calls) => calls.filter((c) => c.startsWith("release create"));

test("워크플로: 직전 Release 목록을 못 읽으면(gh 일시 실패) 새 Release를 올리지 않고 단계가 실패한다(cto 필수)", async () => {
  const s = await scenario({ listFails: true });
  const r = s.run(UPLOAD);
  assert.notEqual(r.status, 0, `성공으로 끝났다\n${r.stdout}${r.stderr}`);
  const calls = await s.calls();
  assert.deepEqual(createCalls(calls), [], "목록을 못 읽었는데 Release를 만들었다");
  assert.ok(!calls.some((c) => c.startsWith("release download")));
});

test("워크플로 주석: 첫 Release는 dispatch로만 올라가도록 강제된 것이 없고 병합 뒤 첫 cron이 올린다고 적혀 있다", () => {
  assert.match(wf, /# 첫 Release: 워크플로가 dispatch로만 올라가도록 강제된 것은 없다\. 병합 뒤 처음 오는 매월 12일 17:43 UTC cron/);
  assert.doesNotMatch(wf, /첫 Release는 PR 병합·승인 뒤 dispatch로 올린다/);
  assert.match(wf, /cron: "43 17 12 \* \*"/, "주석의 시각이 cron과 같아야 한다");
});

test("워크플로: 올리기 단계의 prev 줄에 || true가 없다(cto 필수) - 3번 단계와 같다", () => {
  for (const name of [UPLOAD, MARK_STEP]) {
    const prevLines = stepRun(name).split("\n").filter((l) => !l.trimStart().startsWith("#") && l.includes("gh release list"));
    assert.ok(prevLines.length >= 1);
    for (const l of prevLines) assert.doesNotMatch(l, /\|\|\s*true/, `${name}: ${l}`);
  }
  assert.doesNotMatch(wf.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n"), /\|\|\s*true/);
});

test("워크플로: 직전 Release가 하나도 없으면(목록은 정상, 0건) 새 Release를 올리고 태그가 입력 커밋을 가리킨다(--target)", async () => {
  const s = await scenario({ tags: [] });
  const r = s.run(UPLOAD);
  assert.equal(r.status, 0, r.stderr);
  const calls = await s.calls();
  assert.equal(createCalls(calls).length, 1);
  assert.ok(!calls.some((c) => c.startsWith("release download")));
  const create = createCalls(calls)[0];
  assert.ok(create.startsWith(`release create ${s.tag} --target 0123456789abcdef0123456789abcdef01234567 --title ${renderTitle(s.figures)} --notes-file `), create);
  for (const f of [`${s.tag}.json`, `${s.tag}.csv`, "check.py", "check.out", "README.md"]) assert.ok(create.includes(`/${f}`), `자산 ${f}`);
});

test("워크플로: 직전 Release와 숫자가 같으면 새로 올리지 않고(종료 0), 다르면 올린다(--same 0·1)", async () => {
  const figures = await fixtureFigures();
  const prevTag = "correction-twins-2026-09-12";
  const same = await scenario({ tags: [prevTag], assets: { [prevTag]: JSON.stringify({ ...figures, asOf: "2026-09-12" }) } });
  const r1 = same.run(UPLOAD);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /숫자가 correction-twins-2026-09-12 와 같다/);
  assert.deepEqual(createCalls(await same.calls()), []);

  const differ = await scenario({ tags: [prevTag], assets: { [prevTag]: JSON.stringify({ ...figures, figuresDigest: "0000000000000000" }) } });
  const r2 = differ.run(UPLOAD);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /다르다 - 새 Release를 올린다/);
  assert.equal(createCalls(await differ.calls()).length, 1);
});

test("워크플로: --same이 비교하지 못하면(깨진 JSON·자산 없음) 새 Release로 넘어가지 않고 단계가 실패한다(cto 권장, exit 2)", async () => {
  const prevTag = "correction-twins-2026-09-12";
  const broken = await scenario({ tags: [prevTag], assets: { [prevTag]: "{ not json" } });
  const r1 = broken.run(UPLOAD);
  assert.notEqual(r1.status, 0, r1.stdout);
  assert.match(r1.stderr, /숫자를 비교하지 못했다/);
  assert.match(r1.stderr, /종료 코드 2/);
  assert.deepEqual(createCalls(await broken.calls()), []);

  const noAsset = await scenario({ tags: [prevTag], assets: {} });
  const r2 = noAsset.run(UPLOAD);
  assert.notEqual(r2.status, 0);
  assert.deepEqual(createCalls(await noAsset.calls()), []);
});

test("워크플로: 같은 이름의 Release가 이미 있으면 목록도 읽지 않고 건너뛴다", async () => {
  const figures = await fixtureFigures();
  const s = await scenario({ exists: [`correction-twins-${figures.asOf}`], listFails: true });
  const r = s.run(UPLOAD);
  assert.equal(r.status, 0, r.stderr);
  const calls = await s.calls();
  assert.deepEqual(calls.filter((c) => c.startsWith("release list") || c.startsWith("release create")), []);
});

test("워크플로: 이전 Release 표시 단계 - 실제 본문(표시 이름이 갱신 절에 적힌)에 표시를 붙이고, 이미 붙었으면 건너뛰며, 목록을 못 읽으면 실패한다", async () => {
  const figures = await fixtureFigures();
  const oldTag = "correction-twins-2026-09-12";
  const newTag = "correction-twins-2026-10-10";
  const oldBody = renderBody({ ...figures, asOf: "2026-09-12" }, { tag: oldTag });
  const s = await scenario({ tags: [newTag, oldTag], bodies: { [oldTag]: oldBody, [newTag]: renderBody(figures, { tag: newTag }) } });
  const r = s.run(MARK_STEP);
  assert.equal(r.status, 0, r.stderr);
  const edited = await readFile(path.join(s.fake, `edited-${oldTag}.md`), "utf8");
  assert.ok(edited.startsWith(SUPERSEDED_PREFIX), "이전 Release 본문 맨 위에 표시가 붙지 않았다");
  assert.ok(edited.includes(`\`${newTag}\``) && edited.endsWith(oldBody));
  assert.deepEqual((await s.calls()).filter((c) => c.startsWith("release edit")).map((c) => c.split(" ")[2]), [oldTag], "새 Release는 건드리지 않는다");

  // 이미 붙은 본문이면 다시 편집하지 않는다.
  const again = await scenario({ tags: [newTag, oldTag], bodies: { [oldTag]: edited, [newTag]: renderBody(figures, { tag: newTag }) } });
  assert.equal(again.run(MARK_STEP).status, 0);
  assert.deepEqual((await again.calls()).filter((c) => c.startsWith("release edit")), []);

  const failing = await scenario({ listFails: true });
  assert.notEqual(failing.run(MARK_STEP).status, 0);
  assert.deepEqual((await failing.calls()).filter((c) => c.startsWith("release edit")), []);
});
