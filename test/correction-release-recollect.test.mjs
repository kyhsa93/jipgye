// #892 - 정정 Release가 얼린 매매 슬롯의 재수집 덧씌움(raw/recollect, #861)을 사이트와 같은 입력으로 읽는다.
// 입력은 시험 입력(test/fixtures/correction-twins)의 사본과 손으로 만든 덧씌움뿐이다 - 값에 따라 갈리는 검사는 두지 않는다(#8).
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  TAG_PREFIX, buildFigures, buildRelease, readSales, renderBody, renderTitle, toCsv, writeRecollectedSales,
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

