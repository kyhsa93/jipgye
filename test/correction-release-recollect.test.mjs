// #892 - 정정 Release가 얼린 매매 슬롯의 재수집 덧씌움(raw/recollect, #861)을 사이트와 같은 입력으로 읽는다.
// 입력은 시험 입력(test/fixtures/correction-twins)의 사본과 손으로 만든 덧씌움뿐이다 - 값에 따라 갈리는 검사는 두지 않는다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  TAG_PREFIX, assertAllowedShape, buildFigures, buildRelease, readSales, recollectLine, renderBody, renderTitle, toCsv, writeRecollectedSales,
} from "../scripts/build-correction-release.ts";
import { buildPayload, readRawSales } from "../scripts/build-cancellation.ts";
import { buildOverlay, writeOverlay } from "../scripts/realestate-recollect.ts";
import { readSlotFile } from "../scripts/realestate-raw.ts";

const root = path.resolve(import.meta.dirname, "..");
const FIXTURE_RAW = path.join(root, "test/fixtures/correction-twins/raw");
const MONTHS = ["202603", "202604"]; // 시험 입력의 계약월 전부
const read = (rel) => readFile(path.join(root, rel), "utf8");

const hasPython = spawnSync("python3", ["--version"]).status === 0;
const python = (rawDir) =>
  execFileSync("python3", ["-I", path.join(root, "research/correction-twins/check.py")], { env: { ...process.env, REALESTATE_RAW_DIR: rawDir }, encoding: "utf8" });

/** 시험 입력 raw/sale의 사본(덧씌움 없음). */
async function rawCopy() {
  const dir = await mkdtemp(path.join(tmpdir(), "ct-rc-"));
  await mkdir(path.join(dir, "sale"), { recursive: true });
  await cp(path.join(FIXTURE_RAW, "sale"), path.join(dir, "sale"), { recursive: true });
  return dir;
}

const pick = (item, fields) => Object.entries(fields).every(([k, v]) => item[k] === v);

/**
 * 11110-202604를 다시 받았더니 달라진 응답. 해제·등기가 계약 뒤에 붙는 모양을 한 슬롯에 다 넣는다:
 * 짝 있는 해제의 짝(시험단지나)에 등기일이 붙고, 짝 없던 해제(시험단지라)에 해제 없는 같은 계약이 새로 나타나고,
 * 해제 없던 행(107)이 해제되고, 해제 없는 같은 계약 둘(시험단지마) 가운데 하나가 원천에서 사라진다.
 */
function recollected(items) {
  const out = items.map((item) => {
    if (pick(item, { aptNm: "시험단지나", cdealType: "" })) return { ...item, rgstDate: "26.07.01" };
    if (pick(item, { aptNm: "시험단지", jibun: "107" })) return { ...item, cdealType: "O", cdealDay: "26.06.10" };
    return item;
  });
  const twin = items.find((item) => pick(item, { aptNm: "시험단지라" }));
  out.push({ ...twin, cdealType: "", cdealDay: "", rgstDate: "26.06.01" });
  out.splice(out.findIndex((item) => pick(item, { aptNm: "시험단지마" })), 1);
  return out;
}

/** 시험 입력 사본에 위 덧씌움을 둔 raw. */
async function overlayRaw() {
  const dir = await rawCopy();
  const slot = await readSlotFile("sale", "11110", "202604", dir);
  const items = recollected(slot.items);
  const overlay = buildOverlay({ slot, items, totalCount: items.length, observedAt: "2026-11-28T03:00:00.000Z" });
  assert.ok(overlay.changed.length && overlay.appeared.length && overlay.gone.length, "덧씌움에 바뀜·나타남·사라짐이 다 있어야 한다");
  assert.equal(await writeOverlay("11110", "202604", overlay, dir), true);
  return dir;
}

/** 사이트 해제 화면과 같은 읽기·셈(build-cancellation main과 같은 모양 - 매매 창과 등기 창이 시험 입력의 달 전부). */
async function sitePayload(dir) {
  const byDistrict = await readRawSales(MONTHS, dir);
  return buildPayload({ byDistrict, months: MONTHS, now: new Date("2026-11-30T00:00:00.000Z"), registrationByDistrict: byDistrict });
}

/** 완료 조건 1이 맞추는 칸: Release seoul ↔ 사이트 seoul.correction·registration. */
const releaseSeoul = (figures) => ({
  reported: figures.seoul.cancelRecords,
  corrections: figures.seoul.withTwin,
  share: figures.seoul.sharePct,
  matureMonths: figures.seoul.registration.matureMonths,
  matured: figures.seoul.registration.records,
  registeredShare: figures.seoul.registration.withRegDatePct,
});
const siteSeoul = ({ seoul }) => ({
  reported: seoul.correction.reported,
  corrections: seoul.correction.corrections,
  share: seoul.correction.share,
  matureMonths: seoul.registration?.matureMonths ?? [],
  matured: seoul.correction.matured,
  registeredShare: seoul.correction.registeredShare,
});

/** writeRecollectedSales가 쓴 폴더로 낸 Release 숫자(buildRelease와 같은 입력). */
async function mergedFigures(rawDir) {
  const work = await mkdtemp(path.join(tmpdir(), "ct-rc-in-"));
  const recollectedSlots = await writeRecollectedSales(rawDir, work);
  return { work, recollectedSlots, figures: buildFigures(await readSales(work)) };
}

// ---- 완료 조건 1: 덧씌움 픽스처에서 Release seoul = 사이트 buildPayload ----

test("덧씌움이 있으면 Release seoul 해제 기록·짝·비율·등기율이 같은 입력의 사이트 buildPayload correction·registration과 같다(#892 조건 1)", async () => {
  const dir = await overlayRaw();
  const { figures, recollectedSlots } = await mergedFigures(dir);
  assert.deepEqual(recollectedSlots, [{ name: "11110-202604.json", recollectedAt: "2026-11-28T03:00:00.000Z" }]);
  assert.deepEqual(releaseSeoul(figures), siteSeoul(await sitePayload(dir)));
  // 시험이 헛돌지 않는다: 덧씌움을 합치지 않은 저장 그대로의 숫자와는 다르다(해제 기록·짝·등기율이 모두 움직이는 덧씌움이다).
  const stored = buildFigures(await readSales(dir));
  for (const key of ["reported", "corrections", "registeredShare"]) assert.notEqual(releaseSeoul(figures)[key], releaseSeoul(stored)[key], key);
});

test("덧씌움이 없으면 Release seoul은 같은 입력의 사이트 buildPayload와 같고 저장 그대로 읽은 값과도 같다", async () => {
  const dir = await rawCopy();
  const { figures, recollectedSlots } = await mergedFigures(dir);
  assert.deepEqual(recollectedSlots, []);
  assert.deepEqual(releaseSeoul(figures), siteSeoul(await sitePayload(dir)));
  assert.deepEqual(figures, buildFigures(await readSales(dir)));
});

test("buildRelease: 덧씌움 픽스처에서 JSON의 seoul이 사이트와 같고, check.py는 합친 폴더를 읽어 둘째·셋째 줄이 노드 값과 같다", { skip: !hasPython && "python3 없음" }, async () => {
  const dir = await overlayRaw();
  const outDir = await mkdtemp(path.join(tmpdir(), "ct-rc-out-"));
  const { figures, tag, recollected: slots } = await buildRelease({ rawDir: dir, outDir });
  assert.equal(slots.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(outDir, `${tag}.json`), "utf8")), figures);
  assert.deepEqual(releaseSeoul(figures), siteSeoul(await sitePayload(dir)));
  const out = await readFile(path.join(outDir, "check.out"), "utf8");
  const [, l2, l3] = out.trim().split("\n");
  const m2 = /해제 기록 (\d+)건 중 .* (\d+)건 \(/.exec(l2);
  const m3 = /둘 이상인 경우 (\d+)건 \(([\d.]+)%\)/.exec(l3);
  assert.deepEqual(
    [Number(m2[1]), Number(m2[2]), Number(m3[1]), Number(m3[2])],
    [figures.seoul.cancelRecords, figures.seoul.withTwin, figures.seoul.comparison.repeatedContracts, figures.seoul.comparison.sharePct],
  );
  // 저장 그대로 돌린 check.py와는 다르다 - check.py가 합친 폴더를 읽었다는 증거다.
  assert.notEqual(out, python(dir));
});

// ---- 완료 조건 2: 합치기는 mergeRecollect 한 곳 ----

test("합치기는 realestate-recollect.ts 한 곳이다 - 산출 스크립트는 readRecollectedSlot을 부르고, check.py는 덧씌움을 모른다(#892 조건 2)", async () => {
  const release = await read("scripts/build-correction-release.ts");
  assert.match(release, /import \{ readRecollectedSlot \} from "\.\/realestate-recollect\.ts";/);
  assert.doesNotMatch(release, /\.(changed|appeared|gone)\b|readOverlay|overlayPath|mergeRecollect\(/);
  // 노드 셈과 check.py는 같은 폴더(합친 사본)를 읽는다.
  assert.match(release, /buildFigures\(await readSales\(inputDir\)\)/);
  assert.match(release, /REALESTATE_RAW_DIR: path\.resolve\(inputDir\)/);
  const check = await read("research/correction-twins/check.py");
  assert.doesNotMatch(check, /recollect|overlay|changed|appeared|gone/);
});

// ---- 완료 조건 3: 덧씌움이 없으면 산출이 바이트까지 같다 ----

/** 덧씌움 없음·낡은 덧씌움(슬롯이 그 뒤 다시 쓰였다)·빈 덧씌움 폴더. 셋 다 합칠 것이 없다. */
async function noMergeCases() {
  const plain = await rawCopy();
  const stale = await rawCopy();
  const slot = await readSlotFile("sale", "11110", "202604", stale);
  const items = recollected(slot.items);
  const overlay = buildOverlay({ slot: { ...slot, observedAt: "2026-09-01T00:00:00.000Z" }, items, totalCount: items.length, observedAt: "2026-11-28T03:00:00.000Z" });
  await writeOverlay("11110", "202604", overlay, stale);
  const empty = await rawCopy();
  await mkdir(path.join(empty, "recollect", "sale"), { recursive: true });
  return { plain, stale, empty };
}

test("합칠 덧씌움이 없으면 입력 사본 폴더는 raw/sale과 파일 이름·바이트가 같다(python 없이도 돈다)", async () => {
  for (const [label, dir] of Object.entries(await noMergeCases())) {
    const work = await mkdtemp(path.join(tmpdir(), "ct-rc-in-"));
    assert.deepEqual(await writeRecollectedSales(dir, work), [], label);
    const names = (await readdir(path.join(dir, "sale"))).sort();
    assert.deepEqual((await readdir(path.join(work, "sale"))).sort(), names, label);
    for (const name of names) {
      assert.ok((await readFile(path.join(work, "sale", name))).equals(await readFile(path.join(dir, "sale", name))), `${label} ${name}`);
    }
  }
});

test("합칠 덧씌움이 없으면 Release 산출(JSON·CSV·README.md·title.txt·check.out)이 저장 그대로 읽던 산출과 바이트까지 같다(#892 조건 3)", { skip: !hasPython && "python3 없음" }, async () => {
  for (const [label, dir] of Object.entries({ fixture: FIXTURE_RAW, ...(await noMergeCases()) })) {
    const outDir = await mkdtemp(path.join(tmpdir(), "ct-rc-out-"));
    const { tag, recollected: slots } = await buildRelease({ rawDir: dir, outDir });
    assert.deepEqual(slots, [], label);
    // 이전 buildRelease: raw/sale을 그대로 readSales·check.py에 넘겼다.
    const before = buildFigures(await readSales(dir));
    assert.equal(tag, `${TAG_PREFIX}${before.asOf}`, label);
    const expected = {
      [`${tag}.json`]: `${JSON.stringify(before, null, 2)}\n`,
      [`${tag}.csv`]: toCsv(before),
      "README.md": renderBody(before, { tag }),
      "title.txt": `${renderTitle(before)}\n`,
      "check.out": python(dir),
    };
    for (const [name, text] of Object.entries(expected)) assert.equal(await readFile(path.join(outDir, name), "utf8"), text, `${label} ${name}`);
  }
});


// ---- 완료 조건 4: 「첨부」 입력 줄(legal #892 판정 1절 원문, ~/.claude/handoff/jipgye-1115-round/legal-892.md·#892 댓글) ----
// 원문을 글자 그대로 둔다. {재수집일}·{dates}만 바뀐다. 문구를 바꾸려면 legal 판정이 먼저다.

const LEGAL_KO = "- 입력: 매일 다시 받지 않는 지난 계약월 가운데 원천에서 한 달에 한 번 다시 받은 달의 매매 기록에는, 저장 파일과 다른 행만 둔 재수집 덧씌움(`raw/recollect`)을 합쳤습니다. 바뀐 행과 새 행은 다시 받은 값으로 넣고, 원천이 더는 내지 않는 행은 뺐습니다(재수집일 {재수집일}). 합치는 방식은 사이트 해제·등기 화면과 같은 함수(`scripts/realestate-recollect.ts`)이고, 합친 사본은 산출할 때만 만들어 저장소에 두지 않습니다. 이 Release의 태그가 가리키는 커밋의 저장소 루트에서 `REALESTATE_RAW_DIR=raw CORRECTION_OUT_DIR=<폴더> node scripts/build-correction-release.ts`로 다시 만들 수 있습니다. `check.out` 첫 줄 「입력 raw/sale」의 파일 수·건수는 그 합친 사본의 값이라, 저장소의 `raw/sale`을 `check.py`로 바로 읽은 값과 다를 수 있습니다.";
const LEGAL_EN = "- Input: for past contract months that are no longer refreshed daily but are re-fetched from the source once a month, the sale records include the re-collection overlay (`raw/recollect`), which keeps only the rows that differ from the stored files: changed and new rows take the re-fetched values, and rows the source no longer returns are left out (re-collected {dates}). The merge uses the same function as the site's cancellation and registration page (`scripts/realestate-recollect.ts`); the merged copy is made only during the build and is not kept in the repository. To reproduce, run `REALESTATE_RAW_DIR=raw CORRECTION_OUT_DIR=<dir> node scripts/build-correction-release.ts` from the repository root at the commit this release's tag points to. The file and row counts after \"입력 raw/sale\" on the first line of `check.out` are those of the merged copy, so they can differ from running `check.py` directly on the repository's `raw/sale`.";
const legal = (ko, en) => ({ ko: LEGAL_KO.replace("{재수집일}", ko), en: LEGAL_EN.replace("{dates}", en) });
const KO_ATTACH = "- `check.py`·`check.out`: 저장소의 `research/correction-twins/check.py`와 이 기준일 입력에서의 출력입니다. 파이썬 표준 라이브러리만 씁니다.";
const EN_ATTACH = "- `check.py` and `check.out`: `research/correction-twins/check.py` from the repository and its output on this as-of input. It uses only the Python standard library.";

/** slot 하나에 덧씌움을 둔다. mutate(items)가 다시 받은 행을 돌려준다. */
async function addOverlay(dir, code, yearMonth, mutate, observedAt) {
  const slot = await readSlotFile("sale", code, yearMonth, dir);
  const items = mutate(slot.items);
  assert.equal(await writeOverlay(code, yearMonth, buildOverlay({ slot, items, totalCount: items.length, observedAt }), dir), true);
}
const regDate = (jibun, rgstDate) => (items) => items.map((item) => (item.jibun === jibun && !item.cdealType ? { ...item, rgstDate } : item));

test("입력 줄: recollectLine은 legal 원문을 날짜만 바꿔 글자 그대로 낸다", () => {
  assert.deepEqual(recollectLine(["2026-11-28"]), legal("2026-11-28", "2026-11-28"));
});

test("입력 줄: 덧씌움을 합친 Release 본문은 「첨부」 check.py·check.out 글머리 바로 다음에 원문 한 줄을 한·영으로 싣고, JSON은 재수집일(KST)만 더 싣는다", async () => {
  const { figures } = await mergedFigures(await overlayRaw());
  assert.deepEqual(figures.recollectedOn, ["2026-11-28"]);
  assertAllowedShape(figures);
  const line = legal("2026-11-28", "2026-11-28");
  const body = renderBody(figures);
  assert.ok(body.includes(`${KO_ATTACH}\n${line.ko}\n- 숫자는 `), "ko: check.py 글머리 바로 다음");
  assert.ok(body.includes(`${EN_ATTACH}\n${line.en}\n- The numbers `), "en: check.py 글머리 바로 다음");
  assert.equal(body.split("- 입력: ").length, 2);
  assert.equal(body.split("- Input: ").length, 2);
});

test("입력 줄: 반영한 덧씌움이 없으면(없음·낡음·빈 폴더) 줄 전체가 없고 JSON에 재수집일 칸이 없다", async () => {
  for (const [label, dir] of Object.entries({ fixture: FIXTURE_RAW, ...(await noMergeCases()) })) {
    const { figures } = await mergedFigures(dir);
    assert.ok(!("recollectedOn" in figures), label);
    const body = renderBody(figures);
    assert.ok(body.includes(`${KO_ATTACH}\n- 숫자는 `) && body.includes(`${EN_ATTACH}\n- The numbers `), label);
    assert.doesNotMatch(body, /- 입력: |- Input: |raw\/recollect|재수집|re-collect/, label);
  }
});

test("입력 줄: 재수집일이 여럿이면 KST 날짜를 중복 없이 오름차순으로 ko 「·」, en 「, 」로 잇는다", async () => {
  const dir = await rawCopy();
  // UTC 시각이 아니라 한국 날짜로 센다: 12-11T16:30Z는 KST 12-12, 11-27T20:00Z는 KST 11-28(11110-202603과 같은 날 - 하나로 센다).
  await addOverlay(dir, "11110", "202604", regDate("111", "26.07.02"), "2026-12-11T16:30:00.000Z");
  await addOverlay(dir, "11110", "202603", regDate("111", "26.07.01"), "2026-11-28T03:00:00.000Z");
  await addOverlay(dir, "11140", "202604", regDate("111", "26.07.03"), "2026-11-27T20:00:00.000Z");
  const { figures, recollectedSlots } = await mergedFigures(dir);
  assert.equal(recollectedSlots.length, 3);
  assert.deepEqual(figures.recollectedOn, ["2026-11-28", "2026-12-12"]);
  const body = renderBody(figures);
  const line = legal("2026-11-28·2026-12-12", "2026-11-28, 2026-12-12");
  assert.ok(body.includes(`${KO_ATTACH}\n${line.ko}\n`) && body.includes(`${EN_ATTACH}\n${line.en}\n`));
});

test("재수집일 칸은 날짜 목록만 허용하고, figuresDigest(--same 판정)에는 들어가지 않는다 - asOf와 같은 메타 칸이다", async () => {
  const { figures } = await mergedFigures(await overlayRaw());
  for (const bad of [[], ["2026-11-28T03:00:00.000Z"], [11], "2026-11-28"]) {
    assert.throws(() => assertAllowedShape({ ...figures, recollectedOn: bad }), /recollectedOn/, JSON.stringify(bad));
  }
  const input = await readSales((await mergedFigures(await overlayRaw())).work);
  assert.equal(buildFigures({ ...input, recollectedAt: [] }).figuresDigest, buildFigures(input).figuresDigest);
});
