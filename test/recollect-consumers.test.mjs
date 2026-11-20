// #900 (가) 전환 - 거래 검색·예산(realestate-source.ts readDealSource)과 전세가율·전세 비중(build-complex-ratio.ts readRaw)의 매매 읽기가
// 재수집 덧씌움(raw/recollect)을 합쳐 읽는다. 바꾸지 않는 소비자(동명 단지·대표 시세 두 분기·week-digest·원장 C1·전망)는 덧씌움이 생겨도 출력이 같다.
// 기본값(읽기 인자를 넘기지 않는 빌더의 실제 경로)을 보려고 REALESTATE_RAW_DIR 를 픽스처 raw 로 둔 하위 프로세스에서 모듈을 불러 계산한다 -
// RAW_DIR 는 모듈을 불러올 때 정해진다(realestate-raw.ts 7행).
// 입력은 전부 손으로 만든 슬롯·덧씌움이고 시각은 고정이다(#8). 국토부 API 는 부르지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { rentItem, saleItem } from "./helpers/fake-molit.mjs";
import { buildSlotFile, readSlotFile, writeSlotFile } from "../scripts/realestate-raw.ts";
import { buildOverlay, writeOverlay } from "../scripts/realestate-recollect.ts";
import { refreshFirstSeen } from "../scripts/realestate-first-seen.ts";

const root = path.resolve(import.meta.dirname, "..");
const exec = promisify(execFile);
const src = (rel) => readFile(path.join(root, rel), "utf8");

// cd20a99b budget-deals.json updatedAt(#900 PREREG 1절). 창: 거래 검색 202609~202611(SEARCH_MONTHS 3), 전세가율 202606~202611(MONTHS 6).
const NOW = "2026-11-16T02:42:32.139Z";
const JONGNO = "11110";
const JUNG = "11140";

const sale = (yearMonth, apt, i, extra = {}) =>
  saleItem({ aptNm: apt, dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)), dealDay: 1 + (i % 28), floor: i + 1, dealAmount: `${50000 + i * 1000}`, sggCd: JONGNO, ...extra });
const rent = (yearMonth, apt, i) =>
  rentItem({ aptNm: apt, dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)), dealDay: 1 + (i % 28), floor: i + 1, deposit: `${30000 + i * 500}` });

// 종로구 202609: 단지 열둘 × 매매 셋 = 전세가율 칸 열둘(MIN_CELLS_MEDIAN 10 이상이라 구 분위가 나온다). 단지01 은 덧씌움이 건드릴 두 줄(층 101·102)을
// 더 가져 그 두 줄이 빠져도 칸이 남는다. 새단지는 전세 셋만 있고 매매는 덧씌움에만 있다.
const APTS = Array.from({ length: 12 }, (_, i) => `단지${String(i + 1).padStart(2, "0")}`);
const stored0609 = () => [...APTS.flatMap((apt, a) => [0, 1, 2].map((n) => sale("202609", apt, a * 3 + n))), sale("202609", "단지01", 100), sale("202609", "단지01", 101)];
const rents0609 = () => [...APTS, "새단지"].flatMap((apt, a) => [0, 1, 2].map((n) => rent("202609", apt, a * 3 + n)));

async function writeTwice(raw, kind, code, yearMonth, first, second) {
  await writeSlotFile(buildSlotFile({ kind, code, yearMonth, items: first, observedAt: "2026-11-09T01:00:00.000Z" }), raw);
  await writeSlotFile(buildSlotFile({ kind, code, yearMonth, items: second, observedAt: "2026-11-16T01:00:00.000Z" }), raw);
}

/** 종로구 202609(매매 38행·전세 39행)·중구 202610(매매 5행)과 첫 관측일 상태. 둘째 판에 새로 보인 행이 이번 주 도착이다. */
async function fixtureRaw() {
  const dir = await mkdtemp(path.join(tmpdir(), "recollect-consumers-"));
  const raw = path.join(dir, "raw");
  const sales = stored0609();
  await writeTwice(raw, "sale", JONGNO, "202609", sales.slice(0, 30), sales);
  await writeTwice(raw, "rent", JONGNO, "202609", rents0609().slice(0, 30), rents0609());
  const jung = Array.from({ length: 5 }, (_, i) => sale("202610", "중구단지", i, { sggCd: JUNG }));
  await writeTwice(raw, "sale", JUNG, "202610", jung.slice(0, 3), jung);
  await refreshFirstSeen(["202609", "202610"], [JONGNO, JUNG], { dir: raw, readSlot: readSlotFile });
  return { dir, raw };
}

/** 202609 종로구 재수집 응답: 단지01 101층 줄에 해제가 붙고(changed), 102층 줄이 사라지고(gone), 새단지 매매 셋이 새로 나온다(appeared). */
async function writeRecollect(raw) {
  const slot = await readSlotFile("sale", JONGNO, "202609", raw);
  const at = (item, floor) => item.aptNm === "단지01" && Number(item.floor) === floor;
  const items = slot.items.map((item) => (at(item, 101) ? { ...item, cdealType: "O", cdealDay: "26.11.10" } : item)).filter((item) => !at(item, 102));
  items.push(...[0, 1, 2].map((n) => sale("202609", "새단지", 40 + n)));
  const canon = buildSlotFile({ kind: "sale", code: JONGNO, yearMonth: "202609", items, observedAt: "2026-11-15T11:36:00.000Z" }).items;
  const overlay = buildOverlay({ slot, items: canon, totalCount: canon.length, observedAt: "2026-11-15T11:36:00.000Z" });
  assert.deepEqual([overlay.changed.length, overlay.gone.length, overlay.appeared.length], [1, 1, 3], "픽스처: 덧씌움 세 갈래가 다 있다");
  assert.equal(await writeOverlay(JONGNO, "202609", overlay, raw), true);
}

// 하위 프로세스: 소비자마다 출력을 정본 JSON 의 sha256 으로 낸다. 바뀌는 쪽은 기록용 숫자도 함께 낸다.
const PROBE = `
import { createHash } from "node:crypto";
import path from "node:path";
const S = (f) => import(path.join(${JSON.stringify(path.join(root, "scripts"))}, f));
const NOW = new Date(${JSON.stringify(NOW)});
// Set(동명 단지)은 정렬한 배열로, Map(readWindowItems 의 items)은 넣은 순서의 [키, 값] 배열로 - JSON.stringify 는 둘 다 {} 로 지운다.
const sets = (_k, v) => (v instanceof Set ? [...v].sort() : v instanceof Map ? [...v] : v);
const picked = (w) => [...w.items.values()].flat().length;
const hash = (v) => createHash("sha256").update(JSON.stringify(v, sets)).digest("hex");
const { readSameNames, readSlotFile } = await S("realestate-raw.ts");
const { readDealSource, readRentSource, recentMonths } = await S("realestate-source.ts");
const { buildPayload: budgetPayload } = await S("build-budget-deals.ts");
const { buildDealFiles } = await S("deal-files.ts");
const { MONTHS, readRaw, buildPayload: ratioPayload } = await S("build-complex-ratio.ts");
const { readWindowItems, representWindow } = await S("build-realestate.ts");
const { buildWeekDigest } = await S("build-week-digest.ts");
const { DISTRICTS } = await S("realestate-districts.ts");

const sameNames = await readSameNames();
const deal = await readDealSource(NOW);
const dealStored = await readDealSource(NOW, recentMonths(NOW), readSlotFile);
const budget = (source) => ({ payload: budgetPayload(source, NOW), files: buildDealFiles(source, NOW, undefined, undefined, sameNames) });
const months = recentMonths(NOW, MONTHS);
const byDistrict = await readRaw(months);
// 고치기 전 readRaw 와 같은 계산(매매도 readSlotFile) - 덧씌움이 없을 때의 기대값.
const itemsOf = (files) => files.filter((f) => f?.ok !== false && Array.isArray(f?.items)).flatMap((f) => f.items);
const storedRaw = {};
for (const { code, name } of DISTRICTS) {
  storedRaw[name] = {
    sales: itemsOf(await Promise.all(months.map((ym) => readSlotFile("sale", code, ym)))),
    rents: itemsOf(await Promise.all(months.map((ym) => readSlotFile("rent", code, ym)))),
    same: sameNames[code],
  };
}
const ratio = ratioPayload({ byDistrict, now: NOW });
const arrival = await readWindowItems(NOW, representWindow(NOW, "arrival"));
const contract = await readWindowItems(NOW, representWindow(NOW, "contract"));
const digest = await buildWeekDigest({ now: NOW, out: process.env.PROBE_OUT });
const rentSource = await readRentSource(NOW);
console.log(JSON.stringify({
  switched: {
    deal: hash(deal), dealStored: hash(dealStored), budget: hash(budget(deal)), budgetStored: hash(budget(dealStored)),
    raw: hash(byDistrict), rawStored: hash(storedRaw), ratio: hash(ratio), ratioStored: hash(ratioPayload({ byDistrict: storedRaw, now: NOW })),
  },
  kept: { sameNames: hash(sameNames), arrival: hash(arrival), contract: hash(contract), digest: hash(digest), rentSource: hash(rentSource) },
  facts: {
    cancelled: deal.cancelled, deals: Object.values(deal.districts).flat().length,
    cells: ratio?.districts?.["종로구"]?.cells ?? null, arrival: picked(arrival), contract: picked(contract), digestSale: digest?.current?.sale ?? null,
  },
}));
`;

async function probe(dir, raw) {
  const env = { ...process.env, REALESTATE_RAW_DIR: raw, PROBE_OUT: path.join(dir, `digest-${Date.now()}.json`) };
  const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", PROBE], { env, cwd: root, maxBuffer: 16 << 20 });
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("조건 5: 덧씌움이 없으면 거래 검색·예산·전세가율 출력이 매매를 저장 그대로 읽던 때와 같다", async () => {
  const { dir, raw } = await fixtureRaw();
  try {
    const { switched, facts } = await probe(dir, raw);
    assert.equal(switched.deal, switched.dealStored, "readDealSource 기본값 = readSlotFile");
    assert.equal(switched.budget, switched.budgetStored, "budget-deals·deal-search·budget-months·deals-<구>");
    assert.equal(switched.raw, switched.rawStored, "readRaw 매매·전월세·동명 단지");
    assert.equal(switched.ratio, switched.ratioStored, "complex-ratio");
    // 대조가 빈 값끼리가 아니다.
    assert.deepEqual([facts.deals, facts.cancelled, facts.cells], [43, 0, 12]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("조건 2·4: 덧씌움이 생기면 거래 검색·예산·전세가율만 바뀌고, 동명 단지·대표 시세 두 분기·week-digest·전월세 읽기는 출력 해시가 같다", async () => {
  const { dir, raw } = await fixtureRaw();
  try {
    const before = await probe(dir, raw);
    await writeRecollect(raw);
    const after = await probe(dir, raw);

    assert.deepEqual(after.kept, before.kept, "덧씌움을 읽지 않는 소비자");
    assert.ok(before.facts.arrival > 0 && before.facts.contract > 0 && before.facts.digestSale > 0, "대조가 빈 값끼리가 아니다");
    assert.deepEqual(after.facts.arrival, before.facts.arrival);

    // 바뀌는 쪽: 해제 한 줄(changed)은 빠져 cancelled 로 세고, 사라진 한 줄(gone)은 빠지고, 새단지 세 줄(appeared)이 들어온다.
    assert.equal(after.facts.cancelled, before.facts.cancelled + 1);
    assert.equal(after.facts.deals, before.facts.deals - 2 + 3);
    assert.notEqual(after.switched.deal, after.switched.dealStored, "기본값이 덧씌움을 읽는다");
    assert.equal(after.switched.dealStored, before.switched.deal, "readSlotFile 로 넘기면 전과 같다(#572 읽기 인자)");
    assert.notEqual(after.switched.budget, before.switched.budget);
    // 전세가율: 새단지가 매매 셋을 얻어 칸이 하나 는다. 매매만 바뀌고 전월세 읽기는 그대로다(전월세 해시는 kept.rentSource).
    assert.equal(after.facts.cells, before.facts.cells + 1);
    assert.notEqual(after.switched.ratio, after.switched.ratioStored);
    assert.equal(after.switched.ratioStored, before.switched.ratio);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("조건 4(글자): 전망·대표 시세 주간 추이·동명 단지·week-digest·원장 C1 은 저장 슬롯을 읽고 읽기 층을 부르지 않는다", async () => {
  // readDeals(build-outlook)·readContractRows(build-realestate)는 내보내지 않아 위 하위 프로세스로 부를 수 없다 - 읽는 자리를 글자로 묶는다.
  const outlook = await src("scripts/build-outlook.ts");
  assert.match(outlook, /readSlotFile\("sale", code, month\)/);
  const realestate = await src("scripts/build-realestate.ts");
  assert.match(realestate, /contractRows\(await readSlotFile\(kind, code, yearMonth\), name\)/);
  assert.match(realestate, /export async function readWindowItems\(now, window, read = readSlotFile,/);
  for (const file of ["scripts/build-outlook.ts", "scripts/build-realestate.ts", "scripts/build-week-digest.ts", "scripts/ledger-snapshot.ts", "scripts/realestate-raw.ts"]) {
    assert.doesNotMatch(await src(file), /realestate-recollect|readRecollectedSlot/, file);
  }
});

test("조건 6: method 한·영에 「다시 받은 값을 쓰는 화면과 쓰지 않는 화면」 문단이 있고, 이번에 옮긴 두 화면과 단지 추이에 반영 시작일이 붙는다", async () => {
  const method = await src("docs/method.html");
  const ko = method.match(/<p id="recollected">[^\n]*<\/p>/)?.[0] ?? "";
  const en = method.match(/<p id="recollected-en">[^\n]*<\/p>/)?.[0] ?? "";
  // 갈아타기·가격대 변화(#937)는 「쓰는 화면」 끝에 반영 시작일과 함께 붙고 「아직 처음 받은 값」 목록에서 빠졌다.
  assert.match(ko, /합친 값을 쓰는 화면은 [^.]*단지 추이\(\d{4}-\d{2}-\d{2}부터\), 거래 검색&middot;예산 구간과 전세가율&middot;전세 비중\(\d{4}-\d{2}-\d{2}부터\), 갈아타기&middot;가격대 변화\(\d{4}-\d{2}-\d{2}부터\)입니다\./);
  assert.match(ko, /직거래, 신고가, 층 격차, 예산대 장의 규칙 문단, 반복거래는 아직 처음 받은 값을 씁니다/);
  assert.match(ko, /이번 주 새 신고와 대표 시세, 전망은 처음 받은 값을 그대로 씁니다/);
  assert.match(en, /complex trends \(from \d{4}-\d{2}-\d{2}\), deal search, budget bands, the jeonse ratio and jeonse share \(from \d{4}-\d{2}-\d{2}\), and district switching and price-band change \(from \d{4}-\d{2}-\d{2}\)\./);
  assert.match(en, /Direct deals, record highs, floor gaps, the rule paragraph on budget pages and repeat sales still use the values as first received/);
  assert.match(en, /This week's new filings, the representative prices and the outlook keep the values as first received/);
});
