// #900 (나) 여섯 빌더 측정: 빌더 파일은 고치지 않고(cto 조건 5) 내보낸 함수에 저장(S) 입력과 덧씌움(O) 입력을 차례로 넣어 공개 산출물을 견준다.
// 실행: env -i PATH="$PATH" HOME="$HOME" node na-900.mjs <wt> <outdir> [빌더 이름 ...]   (이름: direct switch record floor budget repeat, 없으면 전부)
// 빌더마다 S 를 먼저 만들어 공개 파일(cd20a99b)과 재현 대조하고, 실패하면 그 빌더의 O 는 만들지 않는다.
// 동명 단지 판정(sameNames)은 늘 저장 원본으로 한다(#861 정정 ④ 8행 고정 「아니오」).
import { assertNoKeys, finish, head, leafDiff, readJson, sameAsPublished, slotTable, wtPaths, UPDATED_AT } from "./lib-900.mjs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const P = wtPaths(process.argv[2]);
const OUT = path.resolve(process.argv[3] ?? "out");
const ALL = ["direct", "switch", "record", "floor", "budget", "repeat"];
const pick = process.argv.slice(4).length ? process.argv.slice(4) : ALL;
const { S, RAW, DATA } = P;
await mkdir(OUT, { recursive: true });
assertNoKeys();

const { DISTRICTS } = await S("realestate-districts.ts");
const { RAW_DIR, readSameNames, readSlotFile } = await S("realestate-raw.ts");
const { readRecollectedSlot } = await S("realestate-recollect.ts");
const { recentMonths } = await S("realestate-source.ts");
if (path.resolve(RAW_DIR) !== RAW) {
  console.error(`멈춤: RAW_DIR ${RAW_DIR} 가 작업 트리 raw 가 아니다(REALESTATE_RAW_DIR 를 비운다)`);
  process.exit(3);
}
const sameNames = await readSameNames(RAW);
const stopped = [];
const verdictInput = [];

/** 매매 원본 전부의 달(raw/sale 파일 이름). 전부를 읽는 빌더의 슬롯 표에 쓴다. */
const allMonths = [...new Set((await readdir(path.join(RAW, "sale"))).map((f) => /^\d{5}-(\d{6})\.json$/.exec(f)?.[1]).filter(Boolean))].sort();

/**
 * 공개 산출물 견주기와 판정 입력 한 줄. skip 은 화면에 나가지 않는다고 측정 전에 정한 경로(PREREG 「공개 자릿수」).
 * 글자 잎(문장·표 HTML, 두 언어)이 하나라도 다르면 「바뀜」. 글자 0 · 숫자 ≥ 1 이면 「숫자만 - 화면 자릿수 확인」(PREREG 2단계).
 */
function report(label, before, after, skip = UPDATED_AT) {
  const d = leafDiff(before, after, skip);
  const text = d.filter((x) => x.kind === "글자");
  const num = d.filter((x) => x.kind === "숫자");
  const other = d.filter((x) => x.kind === "기타");
  const verdict = text.length ? "바뀜(글자)" : num.length || other.length ? "숫자만 - 화면 자릿수 확인" : "같음";
  console.log(`[비교] ${label}: 바뀐 잎 ${d.length} — 글자 ${text.length} · 숫자 ${num.length} · 기타 ${other.length} → ${verdict}`);
  // 경로만 찍는다(글자 값은 길이만). 앞 40개. 전부는 out/<빌더>.json.
  for (const x of d.slice(0, 40)) {
    const v = (y) => (typeof y === "string" ? `글자${y.length}` : JSON.stringify(y));
    console.log(`  ${x.kind} ${x.path}: ${v(x.before)} → ${v(x.after)}`);
  }
  if (d.length > 40) console.log(`  … ${d.length - 40}곳 더(out 파일)`);
  verdictInput.push({ label, leaves: d.length, text: text.length, num: num.length, other: other.length, verdict });
  return d;
}

/** 매매 원본 전부: build-district-change.ts readAll - items = 저장, recollected = 같은 파일에 mergeRecollect(덧씌움). */
let allCache = null;
const readAllSale = async () => (allCache ??= await (await S("build-district-change.ts")).readAll(RAW));

// ---- 1. 직거래(build-cancellation.ts 137행 → build-direct-deals.ts) -------------------------------------------------
if (pick.includes("direct")) {
  head("(나-1) 직거래 direct-deals.json");
  const NOW = new Date("2026-11-16T02:43:39.411Z");
  const { RETENTION_MONTHS } = await S("realestate-slots.ts");
  const { readRawSales } = await S("build-cancellation.ts");
  const { buildPayload } = await S("build-direct-deals.ts");
  const months = recentMonths(NOW, RETENTION_MONTHS);
  await slotTable(P, months, "(나-1) 직거래");
  const build = async (read) => buildPayload({ byDistrict: await readRawSales(months, RAW, read), months, now: NOW, sameNames });
  const before = await build(readSlotFile);
  if (!sameAsPublished("direct-deals.json", before, await readJson(`${DATA}/direct-deals.json`))) stopped.push("직거래");
  else {
    const after = await build(readRecollectedSlot);
    const d = report("직거래 direct-deals.json", before, after);
    await writeFile(`${OUT}/na-direct.json`, JSON.stringify(d));
  }
}

// ---- 2. 갈아타기·가격대 변화(build-district-change.ts readAll().items → district-change.json·segment-change.json) ---------
if (pick.includes("switch")) {
  head("(나-2) 갈아타기·가격대 변화 district-change.json·segment-change.json");
  const NOW = new Date("2026-11-16T02:44:23.771Z");
  const { buildPayload } = await S("build-district-change.ts");
  const { buildSegmentPayload } = await S("segment-change.ts");
  await slotTable(P, allMonths, "(나-2) 갈아타기·가격대 변화(원본 전부)");
  const official = await readJson(`${RAW}/ecos/apt-price-index.json`).catch(() => null);
  const survey = await readJson(`${RAW}/indicators/rone-districts.json`).catch(() => null);
  const { items, recollected } = await readAllSale();
  const dc = (rows) => buildPayload({ items: rows, now: NOW, official, survey, sameNames });
  const sc = (rows) => buildSegmentPayload({ items: rows, now: NOW, sameNames });
  const dcB = dc(items);
  const scB = sc(items);
  const ok1 = sameAsPublished("district-change.json", dcB, await readJson(`${DATA}/district-change.json`));
  const ok2 = sameAsPublished("segment-change.json", scB, await readJson(`${DATA}/segment-change.json`));
  if (!ok1 || !ok2) stopped.push("갈아타기·가격대 변화");
  else {
    const d1 = report("갈아타기 district-change.json", dcB, dc(recollected));
    const d2 = report("가격대 변화 segment-change.json", scB, sc(recollected));
    await writeFile(`${OUT}/na-switch.json`, JSON.stringify({ d1, d2 }));
  }
}

// ---- 3. 신고가(build-record-high.ts readAll → record-high.json) ------------------------------------------------------
if (pick.includes("record")) {
  head("(나-3) 신고가 record-high.json");
  const NOW = new Date("2026-11-16T02:44:17.671Z");
  const { buildPayload } = await S("build-record-high.ts");
  await slotTable(P, allMonths, "(나-3) 신고가(원본 전부)");
  const { items, recollected } = await readAllSale();
  const before = buildPayload({ items, now: NOW, sameNames });
  if (!sameAsPublished("record-high.json", before, await readJson(`${DATA}/record-high.json`))) stopped.push("신고가");
  else {
    const d = report("신고가 record-high.json", before, buildPayload({ items: recollected, now: NOW, sameNames }));
    await writeFile(`${OUT}/na-record.json`, JSON.stringify(d));
  }
}

// ---- 4. 층 격차(build-floor-gap.ts readRaw → floor-gap.json) ---------------------------------------------------------
if (pick.includes("floor")) {
  head("(나-4) 층 격차 floor-gap.json");
  const NOW = new Date("2026-11-16T02:43:56.886Z");
  const { MONTHS, buildPayload, saleRow, jeonseRow } = await S("build-floor-gap.ts");
  const months = recentMonths(NOW, MONTHS);
  await slotTable(P, months, "(나-4) 층 격차");
  // build-floor-gap.ts 33~47행 readRaw(내보내지 않음)와 같은 읽기. 매매 읽기 함수만 갈아 끼우고 전월세는 늘 저장 그대로.
  const readRaw = async (kind, read, toPrice) => {
    const per = await Promise.all(
      DISTRICTS.map(async ({ code, name }) => {
        const files = await Promise.all(months.map((ym) => read(kind, code, ym, RAW)));
        const rows = files
          .filter((file) => file?.ok !== false && Array.isArray(file?.items))
          .flatMap((file) => file.items)
          .map(toPrice)
          .filter(Boolean);
        return [name, rows];
      })
    );
    return Object.fromEntries(per.filter(([, rows]) => rows.length));
  };
  const jeonse = await readRaw("rent", readSlotFile, jeonseRow);
  const build = async (read) => buildPayload({ sale: await readRaw("sale", read, saleRow), jeonse, now: NOW, sameNames });
  const before = await build(readSlotFile);
  if (!sameAsPublished("floor-gap.json", before, await readJson(`${DATA}/floor-gap.json`))) stopped.push("층 격차");
  else {
    const d = report("층 격차 floor-gap.json", before, await build(readRecollectedSlot));
    await writeFile(`${OUT}/na-floor.json`, JSON.stringify(d));
  }
}

// ---- 5. 예산 군집(build-budget-pages.ts readCapDeals → 예산대 장 HTML·method.html 규칙 문단) -----------------------------
if (pick.includes("budget")) {
  head("(나-5) 예산 군집 예산대 장·method 규칙 문단");
  // 렌더 시각: 배포가 넣는 BUILD_NOW(= HEAD 커밋 시각). 데이터 커밋 cd20a99b 의 커밋 시각으로 고정.
  const NOW_MS = Date.parse("2026-11-16T02:45:11Z");
  const { buildBudgetPage } = await S("build-budget-pages.ts");
  const { BUDGET_PAGES } = await S("budget-pages.ts");
  const { REALESTATE_TEMPLATE_PATH } = await S("prerender.ts");
  const { clustering } = await S("loan-cap.ts");
  const { lineCounts } = await S("policy-loan.ts");
  const { latestRate } = await S("mortgage.ts");
  const { budgetRulesHtml } = await S("budget-rules.ts");
  await slotTable(P, allMonths, "(나-5) 예산 군집(원본 전부)");
  // build-budget-pages.ts 239~254행 readCapDeals(내보내지 않음)와 같은 줄 고르기. 파일 순서는 세는 값(건수)에 영향이 없다.
  const capDealsOf = (items) => {
    const deals = [];
    for (const item of items) {
      if (String(item?.cdealType ?? "").trim()) continue;
      const amount = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
      if (!(amount > 0) || !item.dealYear) continue;
      const date = `${item.dealYear}-${String(item.dealMonth).padStart(2, "0")}-${String(item.dealDay).padStart(2, "0")}`;
      deals.push({ date, amount, area: Number(item.excluUseAr), direct: String(item?.dealingGbn ?? "").trim() === "직거래" });
    }
    return deals;
  };
  const budget = await readJson(`${DATA}/budget-deals.json`);
  const mortgageSeries = (await readJson(`${RAW}/indicators/series.json`).catch(() => null))?.series?.mortgage_rate ?? null;
  const loanBasis = latestRate(mortgageSeries);
  const complexFiles = (
    await Promise.all((await readdir(DATA)).filter((f) => /^complex-price-[a-z]+\.json$/.test(f)).sort().map((f) => readJson(path.join(DATA, f)).catch(() => null)))
  ).filter(Boolean);
  const baseHtml = await readFile(REALESTATE_TEMPLATE_PATH, "utf8");
  const realestate = await readJson(`${DATA}/realestate.json`).catch(() => null);
  const since = new Date(NOW_MS - 183 * 86400000).toISOString().slice(0, 10);
  const render = (items) => {
    const capDeals = capDealsOf(items);
    const capStats = clustering(capDeals);
    const policyCounts = lineCounts(capDeals.filter((d) => d.date >= since && !d.direct));
    const pages = Object.fromEntries(
      BUDGET_PAGES.map((page) => [page.file, buildBudgetPage(baseHtml, page, budget, loanBasis, mortgageSeries, complexFiles, capStats, policyCounts, realestate)])
    );
    return { capStats, policyCounts, pages, rules: budgetRulesHtml({ mortgageSeries, policyCounts }) };
  };
  const { items, recollected } = await readAllSale();
  const before = render(items);
  console.log(`[재현] 예산대 장: 공개 대조 없음(Daily 가 커밋하지 않고 배포 때 렌더한다). 렌더 장 ${Object.values(before.pages).filter(Boolean).length}/${BUDGET_PAGES.length}`);
  const after = render(recollected);
  report("예산 군집 capStats·policyCounts(숫자, 기록)", { capStats: before.capStats, policyCounts: before.policyCounts }, { capStats: after.capStats, policyCounts: after.policyCounts }, []);
  verdictInput.pop(); // 위 줄은 기록이다 - 판정은 렌더한 글자로 한다.
  const changedPages = Object.keys(before.pages).filter((f) => before.pages[f] !== after.pages[f]);
  const rulesChanged = before.rules !== after.rules;
  console.log(`[비교] 예산 군집: 바뀐 예산대 장 ${changedPages.length}/${BUDGET_PAGES.length}${changedPages.length ? ` (${changedPages.join(", ")})` : ""} · method 규칙 문단 ${rulesChanged ? "바뀜" : "같음"} → ${changedPages.length || rulesChanged ? "바뀜(글자)" : "같음"}`);
  verdictInput.push({ label: "예산 군집 예산대 장·method 규칙 문단", text: changedPages.length + Number(rulesChanged), num: 0, other: 0, verdict: changedPages.length || rulesChanged ? "바뀜(글자)" : "같음" });
  await writeFile(`${OUT}/na-budget.json`, JSON.stringify({ changedPages, rulesChanged, before: { capStats: before.capStats, policyCounts: before.policyCounts }, after: { capStats: after.capStats, policyCounts: after.policyCounts } }));
}

// ---- 6. 반복거래(build-repeat-sales.ts build({ rawDir }) → repeat-sales.json) ---------------------------------------------
if (pick.includes("repeat")) {
  head("(나-6) 반복거래 repeat-sales.json");
  const NOW = new Date("2026-11-16T02:44:59.272Z");
  const { build } = await S("build-repeat-sales.ts");
  await slotTable(P, allMonths, "(나-6) 반복거래(원본 전부)");
  // 대조 상대 N4(segment-change.json)는 두 실행 모두 cd20a99b 공개 파일로 고정한다 - 가격대 변화의 덧씌움 효과는 (나-2)에서 잰다.
  const opts = { roneFile: `${RAW}/indicators/rone-districts.json`, n4File: `${DATA}/segment-change.json`, now: NOW };
  const before = await build({ rawDir: RAW, ...opts });
  if (!sameAsPublished("repeat-sales.json", before, await readJson(`${DATA}/repeat-sales.json`))) stopped.push("반복거래");
  else {
    // 덧씌움을 합친 원본 사본: 덧씌움이 적용된 슬롯만 mergeRecollect 결과(readRecollectedSlot)로 쓰고 나머지는 바이트 그대로 복사한다.
    // 합친 슬롯의 행 순서는 mergeRecollect 의 정렬(행 JSON 글자순)이다 - 넓힌 구현이 읽기 층으로 읽으면 같은 순서다.
    const rawO = path.join(OUT, "rawO");
    await rm(rawO, { recursive: true, force: true });
    await mkdir(path.join(rawO, "sale"), { recursive: true });
    let merged = 0;
    for (const name of (await readdir(path.join(RAW, "sale"))).filter((f) => f.endsWith(".json"))) {
      const m = /^(\d{5})-(\d{6})\.json$/.exec(name);
      const slot = m ? await readRecollectedSlot("sale", m[1], m[2], RAW) : null;
      if (slot?.recollectedAt) {
        await writeFile(path.join(rawO, "sale", name), JSON.stringify(slot));
        merged += 1;
      } else await copyFile(path.join(RAW, "sale", name), path.join(rawO, "sale", name));
    }
    console.log(`  덧씌움 합친 사본: 합친 슬롯 ${merged}`);
    const after = await build({ rawDir: rawO, ...opts });
    // provenance(입력 트리 해시·파일 수 등)는 화면에 나가지 않는 출처 기록이라 판정에서 뺀다(PREREG 「공개 자릿수」 - 넓힐 때의 provenance 는 후속 이슈의 일).
    const d = report("반복거래 repeat-sales.json", before, after, [...UPDATED_AT, /^provenance(\.|$)/]);
    await writeFile(`${OUT}/na-repeat.json`, JSON.stringify(d));
    await rm(rawO, { recursive: true, force: true });
  }
}

head("(나) 판정 입력");
for (const v of verdictInput) console.log(`  ${v.label}: ${v.verdict} (글자 ${v.text} · 숫자 ${v.num} · 기타 ${v.other})`);
console.log(`멈춘 빌더: ${stopped.length ? stopped.join(", ") : "없음"}`);
finish();
