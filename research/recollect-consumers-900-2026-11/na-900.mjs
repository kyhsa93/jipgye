// #900 (나) 여섯 빌더 측정: 빌더 파일은 고치지 않고(cto 조건 5) 내보낸 함수에 저장(S) 입력과 덧씌움(O) 입력을 차례로 넣어 공개 산출물을 견준다.
// 실행: env -i PATH="$PATH" HOME="$HOME" node na-900.mjs <wt> <outdir> [빌더 이름 ...]   (이름: direct switch record floor budget repeat, 없으면 전부)
// 빌더마다 S 를 먼저 만들어 공개 파일(cd20a99b)과 재현 대조하고, 실패하면 그 빌더의 O 는 만들지 않는다.
// 동명 단지 판정(sameNames)은 늘 저장 원본으로 한다(#861 정정 ④ 8행 고정 「아니오」).
import { assertNoKeys, finish, head, leafDiff, readJson, roundTag, sameAsPublished, slotTable, wtPaths, NO_APPLIED, UPDATED_AT } from "./lib-900.mjs";
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
 * 2단계 grep 범위: 공개 파일마다 그 파일을 읽는 화면 코드(PREREG 5절 v2 표, 05a4469e). cpo 목록(PR #934 교차검증 보완 2)에
 * render/entry.jsx(prerender.ts 조각의 마크업, prerender.ts 41행)를 모든 파일에, monthly-report.ts(GitHub Release 표)를 그것이 읽는 네 파일에 더했다 -
 * 범위를 넓히는 쪽(「읽음」이 늘어 「바뀜」 쪽)이다. 목록의 어느 파일에서든 키가 나오면 「읽음」이다(다른 JSON 의 같은 키여도 - 넓힘 쪽).
 */
const SCREEN_CODE = {
  "direct-deals.json": ["docs/cancelled-deals.html", "scripts/prerender.ts", "docs/method.html", "scripts/monthly-report.ts", "scripts/render/entry.jsx"],
  "district-change.json": ["docs/switch-house.html", "scripts/prerender.ts", "scripts/render/entry.jsx"],
  "segment-change.json": ["scripts/segment-change-view.ts", "scripts/prerender.ts", "docs/switch-house.html", "scripts/monthly-report.ts", "scripts/render/entry.jsx"],
  "record-high.json": ["docs/record-high.html", "scripts/prerender.ts", "scripts/news-context.ts", "scripts/monthly-report.ts", "scripts/render/entry.jsx"],
  "floor-gap.json": ["docs/floor-gap.html", "scripts/prerender.ts", "scripts/monthly-report.ts", "scripts/render/entry.jsx"],
  "repeat-sales.json": ["scripts/repeat-sales-view.ts", "scripts/prerender.ts", "scripts/district-facts.ts", "scripts/build-realestate-pages.ts", "scripts/render/entry.jsx"],
};
// 측정 작업 트리(05a4469e)의 화면 코드 글자. 목록 파일이 없으면 멈춘다(범위가 비면 「읽지 않음」이 결과를 보고 고르는 자리가 된다).
const CODE = new Map();
for (const f of new Set(Object.values(SCREEN_CODE).flat())) {
  const text = await readFile(path.join(P.wt, f), "utf8").catch(() => null);
  if (text === null) {
    console.error(`멈춤: 2단계 grep 범위 파일 ${f} 이 측정 작업 트리에 없다`);
    process.exit(1);
  }
  CODE.set(f, text.split("\n"));
}

/**
 * 식별자 꼴 데이터 값 맵 키(PREREG 5절 v3, 명시 목록 - 결과 전 고정). 경로가 prefix 로 시작하고 그 아래 마디가 더 있으면 grep 키는 key 다.
 * cd20a99b 공개 여섯 파일에서 「식별자 꼴 객체 키이면서 같은 파일의 글자 값으로도 나오는 것」은 segment-change grid.rows.<가격대> 한 곳이다(cpo v2 전수).
 * 키(upTo6·upTo9·upTo15·upTo25·over25)는 price[].key 글자이고 monthly-report.ts 206행이 Object.entries(s.grid?.rows) 로 돈다.
 */
const MAP_KEY_PATHS = {
  "segment-change.json": [{ prefix: ["grid", "rows"], key: "rows" }],
};

/**
 * 잎 경로의 grep 키. 1) MAP_KEY_PATHS 에 맞으면 그 key. 2) 아니면 「.」로 나눈 마디를 끝에서부터 보아 처음 나오는 식별자(^[A-Za-z_$][A-Za-z0-9_$]*$).
 * 배열 인덱스(rows.3.p → p)와 식별자가 아닌 데이터 값 맵 키(구 코드 쌍 11140-11170, 구 이름, 달 202609 등)는 건너뛰고 그 위 마디를 쓴다.
 * 식별자가 하나도 없으면 null - 그 파일을 읽는 코드가 있으므로 「읽음」으로 센다(넓힘 쪽).
 */
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const keyOf = (file, p) => {
  const segs = p.split(".");
  for (const { prefix, key } of MAP_KEY_PATHS[file] ?? []) if (segs.length > prefix.length && prefix.every((x, i) => segs[i] === x)) return key;
  return segs.reverse().find((seg) => IDENT.test(seg)) ?? null;
};

/**
 * 목록 완전성 관문(PREREG 7.10): S(= 재현 대조를 통과한 공개 파일, 이미 본 값)에서 「식별자 꼴 객체 키이면서 같은 파일의 글자 값으로도 나오는 것」의
 * 자리(부모 경로, 배열 인덱스는 #)를 모아 MAP_KEY_PATHS 밖의 자리를 돌려준다. O 는 보지 않는다 - 건너뛸 키가 결과에 따라 움직이지 않게.
 */
function unlistedMapKeys(file, value) {
  const strings = new Set();
  const collect = (v) => {
    if (typeof v === "string") strings.add(v);
    else if (v && typeof v === "object") for (const x of Object.values(v)) collect(x);
  };
  collect(value);
  const found = new Set();
  const walk = (v, at) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, [...at, "#"]));
    for (const [k, x] of Object.entries(v)) {
      if (IDENT.test(k) && strings.has(k)) found.add(at.join("."));
      walk(x, [...at, k]);
    }
  };
  walk(value, []);
  const listed = new Set((MAP_KEY_PATHS[file] ?? []).map(({ prefix }) => prefix.join(".")));
  return [...found].filter((at) => !listed.has(at));
}

/** 키를 읽는 화면 코드 자리(파일:줄). `LC_ALL=C grep -nwF -e <키> -- <목록>` 과 같은 규칙(앞뒤가 [A-Za-z0-9_] 가 아닌 자리). */
function hitsOf(file, key) {
  if (key === null) return ["(식별자 키 없음 - 읽음으로 셈)"];
  const re = new RegExp(`(?<![A-Za-z0-9_])${key.replace(/\$/g, "\\$")}(?![A-Za-z0-9_])`);
  const hits = [];
  for (const f of SCREEN_CODE[file]) CODE.get(f).forEach((line, i) => re.test(line) && hits.push(`${f}:${i + 1}`));
  return hits;
}

/**
 * 공개 산출물 견주기와 판정 입력 한 줄(PREREG 5절 v2). skip 은 화면에 나가지 않는다고 측정 전에 정한 경로.
 * 0. 덧씌움 적용 슬롯이 0 이면 「이번 회차 판정 불가(적용 0)」(pm 에 올림) - 지표와 상관없다.
 * 1. 글자 잎(문장·표 HTML, 두 언어, 한쪽에만 있는 글자 잎·빈 배열/객체 표시 포함)이 하나라도 다르면 「바뀜(글자)」.
 * 2. 글자 0 이면 숫자·기타 잎마다 grep 키를 화면 코드 목록(SCREEN_CODE[file])에서 찾는다.
 *    - 기타(불·null·한쪽에만 있는 잎, 숫자↔null·없음 포함): 키를 읽으면 「바뀜(기타)」 - 서식 적용 없이. 0곳이면 세지 않는다.
 *    - 숫자(양쪽 다 숫자): 키를 읽으면 그 코드의 서식을 전후 값에 손으로 적용해 판정한다(결과 표 옆에 줄을 적는다). 0곳이면 세지 않는다.
 * 3. 남는 차이가 없으면 「같음」 → 「아니오 확정」안, 회차·적용/덧씌움 슬롯 수를 함께 적는다.
 */
function report(label, before, after, { skip = UPDATED_AT, file = null, slots }) {
  if (file) {
    const extra = unlistedMapKeys(file, before);
    console.log(`[맵 키 목록] ${file}: 목록 밖 식별자 꼴 데이터 값 맵 키 ${extra.length ? extra.map((at) => `${at}.<k>`).join(", ") : "0"}`);
    if (extra.length) {
      console.error(`멈춤(7.10): ${label} - MAP_KEY_PATHS 에 없는 식별자 꼴 맵 키. 이 빌더는 판정하지 않는다(스크립트 원인 → 새 등록 sha)`);
      stopped.push(label);
      return [];
    }
  }
  const d = leafDiff(before, after, skip);
  const text = d.filter((x) => x.kind === "글자");
  const num = d.filter((x) => x.kind === "숫자");
  const other = d.filter((x) => x.kind === "기타");
  // 2단계 키 표: 키 → 숫자·기타 잎 수, 화면 코드 자리.
  const keys = new Map();
  if (file) {
    for (const x of [...num, ...other]) {
      const k = keyOf(file, x.path);
      const id = k ?? "(식별자 없음)";
      if (!keys.has(id)) keys.set(id, { num: 0, other: 0, hits: hitsOf(file, k) });
      keys.get(id)[x.kind === "숫자" ? "num" : "other"] += 1;
    }
  }
  const entries = [...keys.values()];
  const otherRead = entries.reduce((n, e) => n + (e.hits.length ? e.other : 0), 0);
  const numRead = entries.reduce((n, e) => n + (e.hits.length ? e.num : 0), 0);
  const unread = entries.reduce((n, e) => n + (e.hits.length ? 0 : e.num + e.other), 0);
  const verdict =
    slots.applied === 0
      ? NO_APPLIED
      : text.length
        ? "바뀜(글자)"
        : otherRead
          ? "바뀜(기타 - 화면 코드가 키를 읽음)"
          : numRead
            ? `숫자 - 화면 서식 판정(손, 읽히는 숫자 잎 ${numRead})`
            : "같음 → 「아니오 확정」안";
  console.log(
    `[비교] ${label}: 바뀐 잎 ${d.length} — 글자 ${text.length} · 숫자 ${num.length}(읽힘 ${numRead}) · 기타 ${other.length}(읽힘 ${otherRead}) · 화면 밖 ${unread} → ${verdict} · ${roundTag(slots)}`
  );
  if (file && !text.length) {
    console.log(`  2단계 범위 ${file}: ${SCREEN_CODE[file].join(" ")}`);
    for (const [id, e] of keys)
      console.log(`  키 ${id}: 숫자 ${e.num} · 기타 ${e.other} · 화면 코드 ${e.hits.length}곳${e.hits.length ? ` (${e.hits.slice(0, 3).join(", ")}${e.hits.length > 3 ? " …" : ""})` : ` - LC_ALL=C grep -nwF -e ${id} -- ${SCREEN_CODE[file].join(" ")} → 0`}`);
  }
  // 경로만 찍는다(글자 값은 길이만). 앞 40개. 전부는 out/<빌더>.json.
  for (const x of d.slice(0, 40)) {
    const v = (y) => (typeof y === "string" ? `글자${y.length}` : JSON.stringify(y));
    console.log(`  ${x.kind} ${x.path}: ${v(x.before)} → ${v(x.after)}`);
  }
  if (d.length > 40) console.log(`  … ${d.length - 40}곳 더(out 파일)`);
  verdictInput.push({ label, leaves: d.length, text: text.length, num: num.length, other: other.length, numRead, otherRead, unread, verdict, tag: roundTag(slots) });
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
  const slots = await slotTable(P, months, "(나-1) 직거래");
  const build = async (read) => buildPayload({ byDistrict: await readRawSales(months, RAW, read), months, now: NOW, sameNames });
  const before = await build(readSlotFile);
  if (!sameAsPublished("direct-deals.json", before, await readJson(`${DATA}/direct-deals.json`))) stopped.push("직거래");
  else {
    const after = await build(readRecollectedSlot);
    const d = report("직거래 direct-deals.json", before, after, { file: "direct-deals.json", slots });
    await writeFile(`${OUT}/na-direct.json`, JSON.stringify(d));
  }
}

// ---- 2. 갈아타기·가격대 변화(build-district-change.ts readAll().items → district-change.json·segment-change.json) ---------
if (pick.includes("switch")) {
  head("(나-2) 갈아타기·가격대 변화 district-change.json·segment-change.json");
  const NOW = new Date("2026-11-16T02:44:23.771Z");
  const { buildPayload } = await S("build-district-change.ts");
  const { buildSegmentPayload } = await S("segment-change.ts");
  const slots = await slotTable(P, allMonths, "(나-2) 갈아타기·가격대 변화(원본 전부)");
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
    const d1 = report("갈아타기 district-change.json", dcB, dc(recollected), { file: "district-change.json", slots });
    const d2 = report("가격대 변화 segment-change.json", scB, sc(recollected), { file: "segment-change.json", slots });
    await writeFile(`${OUT}/na-switch.json`, JSON.stringify({ d1, d2 }));
  }
}

// ---- 3. 신고가(build-record-high.ts readAll → record-high.json) ------------------------------------------------------
if (pick.includes("record")) {
  head("(나-3) 신고가 record-high.json");
  const NOW = new Date("2026-11-16T02:44:17.671Z");
  const { buildPayload } = await S("build-record-high.ts");
  const slots = await slotTable(P, allMonths, "(나-3) 신고가(원본 전부)");
  const { items, recollected } = await readAllSale();
  const before = buildPayload({ items, now: NOW, sameNames });
  if (!sameAsPublished("record-high.json", before, await readJson(`${DATA}/record-high.json`))) stopped.push("신고가");
  else {
    const d = report("신고가 record-high.json", before, buildPayload({ items: recollected, now: NOW, sameNames }), { file: "record-high.json", slots });
    await writeFile(`${OUT}/na-record.json`, JSON.stringify(d));
  }
}

// ---- 4. 층 격차(build-floor-gap.ts readRaw → floor-gap.json) ---------------------------------------------------------
if (pick.includes("floor")) {
  head("(나-4) 층 격차 floor-gap.json");
  const NOW = new Date("2026-11-16T02:43:56.886Z");
  const { MONTHS, buildPayload, saleRow, jeonseRow } = await S("build-floor-gap.ts");
  const months = recentMonths(NOW, MONTHS);
  const slots = await slotTable(P, months, "(나-4) 층 격차");
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
    const d = report("층 격차 floor-gap.json", before, await build(readRecollectedSlot), { file: "floor-gap.json", slots });
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
  const slots = await slotTable(P, allMonths, "(나-5) 예산 군집(원본 전부)");
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
  // 공개 대조가 없는 경로라 정적 동등성 세 줄을 결과 앞에 적는다(cto 머지 승인 메모 ②, PREREG 5절 v2).
  //  (i) 줄 고르기 = build-budget-pages.ts 239~254행과 같은 글자(capDealsOf).
  //  (ii) readAll 은 `ok === false || !Array.isArray(items)` 인 파일을 건너뛰고 readCapDeals 는 `file?.items ?? []` 로 읽는다. 둘이 갈릴 수 있는 파일은
  //       그 조건에 걸리는 파일뿐이다(cto v2 메모 2로 ok:false 에서 넓힘) - 실행 때 다시 세어 0 이 아니면 멈춘다(items 가 없어 둘 다 0줄인 파일도 넓힘 쪽으로 센다).
  //  (iii) clustering·lineCounts 는 세기뿐이라 파일·행 순서와 무관하다.
  const saleNames = (await readdir(path.join(RAW, "sale"))).filter((f) => f.endsWith(".json"));
  let skippedByReadAll = 0;
  for (const name of saleNames) {
    const file = await readJson(path.join(RAW, "sale", name));
    if (file?.ok === false || !Array.isArray(file?.items)) skippedByReadAll += 1;
  }
  console.log(`[정적 동등성] (i) 줄 고르기 239~254행 같은 글자 · (ii) raw/sale ok:false 또는 items 배열 아님 ${skippedByReadAll}/${saleNames.length} · (iii) clustering·lineCounts 순서 무관`);
  if (skippedByReadAll) {
    console.error(`멈춤(나-5): raw/sale ok:false 또는 items 배열 아님 ${skippedByReadAll}파일 - readAll 과 readCapDeals 가 다른 줄을 읽을 수 있다`);
    stopped.push("예산 군집");
  } else {
    const { items, recollected } = await readAllSale();
    const before = render(items);
    console.log(`[재현] 예산대 장: 공개 대조 없음(Daily 가 커밋하지 않고 배포 때 렌더한다). 렌더 장 ${Object.values(before.pages).filter(Boolean).length}/${BUDGET_PAGES.length}`);
    const after = render(recollected);
    report("예산 군집 capStats·policyCounts(숫자, 기록)", { capStats: before.capStats, policyCounts: before.policyCounts }, { capStats: after.capStats, policyCounts: after.policyCounts }, { skip: [], slots });
    verdictInput.pop(); // 위 줄은 기록이다 - 판정은 렌더한 글자로 한다.
    const changedPages = Object.keys(before.pages).filter((f) => before.pages[f] !== after.pages[f]);
    const rulesChanged = before.rules !== after.rules;
    const bVerdict = slots.applied === 0 ? NO_APPLIED : changedPages.length || rulesChanged ? "바뀜(글자)" : "같음 → 「아니오 확정」안";
    console.log(`[비교] 예산 군집: 바뀐 예산대 장 ${changedPages.length}/${BUDGET_PAGES.length}${changedPages.length ? ` (${changedPages.join(", ")})` : ""} · method 규칙 문단 ${rulesChanged ? "바뀜" : "같음"} → ${bVerdict} · ${roundTag(slots)}`);
    verdictInput.push({ label: "예산 군집 예산대 장·method 규칙 문단", text: changedPages.length + Number(rulesChanged), num: 0, other: 0, numRead: 0, otherRead: 0, unread: 0, verdict: bVerdict, tag: roundTag(slots) });
    await writeFile(`${OUT}/na-budget.json`, JSON.stringify({ changedPages, rulesChanged, before: { capStats: before.capStats, policyCounts: before.policyCounts }, after: { capStats: after.capStats, policyCounts: after.policyCounts } }));
  }
}

// ---- 6. 반복거래(build-repeat-sales.ts build({ rawDir }) → repeat-sales.json) ---------------------------------------------
if (pick.includes("repeat")) {
  head("(나-6) 반복거래 repeat-sales.json");
  const NOW = new Date("2026-11-16T02:44:59.272Z");
  const { build } = await S("build-repeat-sales.ts");
  const slots = await slotTable(P, allMonths, "(나-6) 반복거래(원본 전부)");
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
    const d = report("반복거래 repeat-sales.json", before, after, { skip: [...UPDATED_AT, /^provenance(\.|$)/], file: "repeat-sales.json", slots });
    await writeFile(`${OUT}/na-repeat.json`, JSON.stringify(d));
    await rm(rawO, { recursive: true, force: true });
  }
}

head("(나) 판정 입력");
// 기타 잎은 숫자 잎과 따로 센다(cto 머지 승인 메모 ③). 「아니오 확정」·「판정 불가」 기록에는 회차·적용/덧씌움 슬롯 수가 붙는다.
for (const v of verdictInput)
  console.log(`  ${v.label}: ${v.verdict} (글자 ${v.text} · 숫자 ${v.num}(읽힘 ${v.numRead}) · 기타 ${v.other}(읽힘 ${v.otherRead}) · 화면 밖 ${v.unread}) · ${v.tag}`);
console.log(`멈춘 빌더: ${stopped.length ? stopped.join(", ") : "없음"}`);
finish();
