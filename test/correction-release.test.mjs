import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  ALLOWED_DISTRICT, ALLOWED_MONTH, ALLOWED_TOP, CSV_HEADER, MIN_CELL, SUPERSEDED_MARK,
  assertAllowedShape, buildFigures, buildRelease, readSales, renderBody, supersede, toCsv,
} from "../scripts/build-correction-release.mjs";

// #218: 정정 재신고 집계 Release 산출. 값에 따라 갈리는 검사는 두지 않는다(#8) - 구조·금지어·두 구현의 일치만 본다.
const root = path.resolve(import.meta.dirname, "..");
const FIXTURE = path.join(root, "test/fixtures/correction-twins");
const REAL_RAW = path.join(root, "raw");
const read = (rel) => readFile(path.join(root, rel), "utf8");

const hasPython = spawnSync("python3", ["--version"]).status === 0;
const python = (rawDir) =>
  execFileSync("python3", ["-I", path.join(root, "research/correction-twins/check.py")], { env: { ...process.env, REALESTATE_RAW_DIR: rawDir }, encoding: "utf8" });

const fixtureFigures = async () => buildFigures(await readSales(path.join(FIXTURE, "raw")));

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
  const m3 = /같은 계약 (\d+)건 \(([\d.]+)%\)/.exec(l3);
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
  assert.match(src, /from "\.\/cancellation\.mjs"/);
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

const split = (body) => {
  const [ko, en] = body.split("\n---\n");
  assert.ok(ko && en, "한·영 두 구역이 있어야 한다");
  return { ko, en };
};

test("본문: 금지어·단정 문장·권유 문장이 한·영 어디에도 없다", async () => {
  const { ko, en } = split(renderBody(await fixtureFigures()));
  for (const w of KO_BANNED) assert.ok(!ko.includes(w), `한국어 금지어: ${w}`);
  for (const w of EN_BANNED) assert.ok(!en.toLowerCase().includes(w), `영어 금지어: ${w}`);
  for (const re of ASSERTIVE) {
    assert.ok(!re.test(ko), `한국어 단정: ${re}`);
    assert.ok(!re.test(en), `영어 단정: ${re}`);
  }
  for (const re of SOLICIT_KO) assert.ok(!re.test(ko), `한국어 권유: ${re}`);
  for (const re of SOLICIT_EN) assert.ok(!re.test(en), `영어 권유: ${re}`);
});

test("본문: 사이트 correctionSentence와 맞는 '해제되지 않은 채 다시 있는' 구조 + 사유 미확인 + 비교군·표본 기간", async () => {
  const figures = await fixtureFigures();
  const { ko, en } = split(renderBody(figures));
  assert.match(ko, /해제되지 않은 채 다시 있습니다/);
  assert.match(ko, /신고 사유는 공개되지 않아 확인하지 않았고/);
  assert.match(en, /again without a cancellation mark/);
  assert.match(en, /reason for a filing is not published and was not checked/);
  for (const text of [ko, en]) {
    assert.ok(text.includes(String(figures.seoul.comparison.sharePct)), "비교군 비율이 없다");
    assert.ok(text.includes(figures.sample.firstContractMonth.replace("-", ".")) && text.includes(figures.sample.lastContractMonth.replace("-", ".")), "표본 기간이 없다");
  }
});

test("본문: 출처 문구(clo 조건 4)·이용허락 확인일·가공값 구분이 한·영에 있다", async () => {
  const figures = await fixtureFigures();
  const { ko, en } = split(renderBody(figures));
  assert.ok(ko.includes(`출처: 국토교통부 아파트 매매 실거래가 공개시스템(공공데이터포털 15126469), 수집 시각 ${figures.collectedAt}. 이 자료는 원천을 집계·가공한 값이며 국토교통부가 후원·보증하지 않습니다.`));
  assert.match(ko, /가공값이고 원천의 원값이 아닙니다/);
  assert.match(ko, /"제한 없음"\(2026-10-11 확인\)/);
  assert.match(en, /Source: Ministry of Land, Infrastructure and Transport apartment sale transaction disclosure system \(data\.go\.kr 15126469\), collected /);
  assert.match(en, /not endorsed or guaranteed by the Ministry/);
  assert.match(en, /"No restrictions" \(checked 2026-10-11\)/);
});

test("본문: 등기율은 '짝에 등기일이 있는 비율' 하나로 정의하고 check.py의 3월까지 일회성 값과 구분한다", async () => {
  const { ko, en } = split(renderBody(await fixtureFigures()));
  assert.equal((ko.match(/등기율 = /g) || []).length, 1, "등기율 정의가 하나가 아니다");
  assert.match(ko, /등기율 = 짝 기록에 등기일이 있는 비율/);
  assert.match(ko, /registrationStats/);
  assert.match(ko, /2026년 3월까지만 센 일회성 값이라 위 정의와 기준이 다릅니다/);
  assert.equal((en.match(/Registration rate = /g) || []).length, 1);
  assert.match(en, /one-off figure for contract months up to March 2026/);
});

test("본문: 갱신 주기와 숫자가 바뀔 때의 '정정됨' 표시 절차가 한·영에 있다", async () => {
  const { ko, en } = split(renderBody(await fixtureFigures()));
  assert.match(ko, /월 1회 다시 셉니다/);
  assert.match(ko, /새 Release를 올리고, 이전 Release 본문 맨 위에 "정정됨 \(SUPERSEDED\)" 표시/);
  assert.match(ko, /숫자가 같으면 새로 올리지 않습니다/);
  assert.match(en, /Recounted once a month/);
  assert.match(en, /previous release body gets a "정정됨 \(SUPERSEDED\)" notice/);
});

test("supersede: 이전 본문 맨 위에 표시를 붙이고, 다시 붙여도 중복되지 않는다", () => {
  const prev = "# 이전 본문\n숫자";
  const once = supersede(prev, "correction-twins-2026-11-12");
  assert.ok(once.startsWith(`> **${SUPERSEDED_MARK}**`));
  assert.ok(once.includes("correction-twins-2026-11-12") && once.endsWith(prev));
  assert.equal(supersede(once, "correction-twins-2026-12-12"), once);
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

test("CLI --same: 지문이 같으면 0, 다르면 1", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ct-"));
  const a = await fixtureFigures();
  const write = async (name, f) => { const p = path.join(dir, name); await writeFile(p, JSON.stringify(f)); return p; };
  const pa = await write("a.json", a);
  const pb = await write("b.json", { ...a, asOf: "2026-12-01" });
  const pc = await write("c.json", { ...a, figuresDigest: "0000" });
  const run = (x, y) => spawnSync("node", [path.join(root, "scripts/build-correction-release.mjs"), "--same", x, y], { encoding: "utf8" });
  assert.equal(run(pa, pb).status, 0);
  assert.equal(run(pa, pc).status, 1);
});

// ---- 산출 한 바퀴 ----

test("buildRelease: 시험 입력으로 파일 다섯 개와 tag.txt가 나오고 check.out이 고정본과 같다", { skip: !hasPython && "python3 없음" }, async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "ct-out-"));
  const { tag } = await buildRelease({ rawDir: path.join(FIXTURE, "raw"), outDir });
  assert.match(tag, /^correction-twins-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual((await readdir(outDir)).sort(), ["README.md", "check.out", "check.py", `${tag}.csv`, `${tag}.json`, "tag.txt"].sort());
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

const wf = await read(".github/workflows/correction-release.yml");
const daily = await read(".github/workflows/daily-update.yml");
const updateAll = await read("scripts/update-all.mjs");

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
