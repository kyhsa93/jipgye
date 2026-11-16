// #900 (가) 두 경로 측정: 매매 슬롯을 저장 그대로(readSlotFile) 읽을 때와 덧씌움을 합쳐(readRecollectedSlot) 읽을 때의 차이.
// 실행: env -i PATH="$PATH" HOME="$HOME" node ga-900.mjs <wt> <outdir>   (<wt> = 코드 05a4469e, raw·docs/data = 데이터 커밋 cd20a99b)
// 순서는 PREREG.md 「실행 순서」. 경로마다 before(저장)를 먼저 만들어 재현 대조를 하고, 대조가 실패하면 그 경로의 after(덧씌움)는 만들지 않는다.
import { assertNoKeys, finish, head, leafDiff, multisetDiff, readJson, roundTag, sameAsPublished, slotTable, wtPaths, NO_APPLIED, UPDATED_AT } from "./lib-900.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const P = wtPaths(process.argv[2]);
const OUT = path.resolve(process.argv[3] ?? "out");
const { S, RAW, DATA } = P;
await mkdir(OUT, { recursive: true });
assertNoKeys();

const { DISTRICTS } = await S("realestate-districts.ts");
const { DISTRICT_SLUGS } = await S("district-slugs.ts");
const { RAW_DIR, readSameNames, readSlotFile } = await S("realestate-raw.ts");
const { readRecollectedSlot } = await S("realestate-recollect.ts");
const { readDealSource, recentMonths } = await S("realestate-source.ts");
if (path.resolve(RAW_DIR) !== RAW) {
  console.error(`멈춤: RAW_DIR ${RAW_DIR} 가 작업 트리 raw 가 아니다(REALESTATE_RAW_DIR 를 비운다)`);
  process.exit(3);
}
const sameNames = await readSameNames(RAW);
const stopped = [];

// ================================================================================================================
// (가-1) 거래 검색·예산: realestate-source.ts collect → build-budget-deals.ts (budget-deals·deal-search·budget-months·deals-<구>)
// ================================================================================================================
{
  head("(가-1) 거래 검색·예산");
  const NOW = new Date("2026-11-16T02:42:32.139Z"); // cd20a99b budget-deals.json updatedAt
  const months = recentMonths(NOW); // SEARCH_MONTHS 3
  const { buildPayload } = await S("build-budget-deals.ts");
  const { buildDealFiles, dealFileName } = await S("deal-files.ts");
  const slots = await slotTable(P, months, "(가-1) 거래 검색·예산");

  const build = async (read) => {
    const source = await readDealSource(NOW, months, read);
    return { source, payload: buildPayload(source, NOW), files: buildDealFiles(source, NOW, undefined, undefined, sameNames) };
  };
  const before = await build(readSlotFile);

  let ok = sameAsPublished("budget-deals.json", before.payload.screen, await readJson(`${DATA}/budget-deals.json`));
  ok = sameAsPublished("deal-search.json", before.payload.search, await readJson(`${DATA}/deal-search.json`)) && ok;
  ok = sameAsPublished("budget-months.json", before.payload.months, await readJson(`${DATA}/budget-months.json`)) && ok;
  let filesSame = 0;
  for (const { name } of DISTRICTS) {
    const slug = DISTRICT_SLUGS[name];
    const pub = await readJson(`${DATA}/${dealFileName(slug)}`).catch(() => null);
    const d = leafDiff(pub, before.files[slug] ?? null, UPDATED_AT);
    if (d.length) console.log(`[재현] ${dealFileName(slug)}: 다름 ${d.length}곳`);
    else filesSame += 1;
  }
  console.log(`[재현] deals-<구>.json: ${filesSame}/${DISTRICTS.length} 같음(updatedAt 제외)`);
  ok = ok && filesSame === DISTRICTS.length;

  if (!ok) {
    stopped.push("(가-1)");
    console.log("멈춤: (가-1) before 가 공개 파일과 다르다 - 이 경로의 after 는 만들지 않는다(PREREG 멈춤 4)");
  } else {
    const after = await build(readRecollectedSlot);
    // 어긋남 행: 소비자 출력(deals-<구>.json 전수 줄)에서 저장/덧씌움 사이에 나가거나 들어온 줄. 같은 칸 키(동·단지·면적·층·계약일)로 짝지어
    // 짝이 맞으면 「값이 바뀐 줄」, 남으면 「사라진 줄」·「새 줄」로 나눈다(나눔은 기록용, 판정은 합계).
    const cellKey = (row) => JSON.stringify([row.dong, row.apt, row.area, row.floor, row.date]);
    let total = 0;
    const perDistrict = [];
    const sum = { out: 0, in: 0, changed: 0, gone: 0, appeared: 0 };
    for (const { name } of DISTRICTS) {
      const slug = DISTRICT_SLUGS[name];
      const b = before.files[slug]?.deals ?? [];
      const a = after.files[slug]?.deals ?? [];
      const m = multisetDiff(b, a);
      if (!m.out && !m.in) continue;
      const outKeys = new Map();
      for (const r of m.outRows.map((t) => JSON.parse(t))) outKeys.set(cellKey(r), (outKeys.get(cellKey(r)) ?? 0) + 1);
      let changed = 0;
      for (const r of m.inRows.map((t) => JSON.parse(t))) {
        const k = cellKey(r);
        if ((outKeys.get(k) ?? 0) > 0) {
          outKeys.set(k, outKeys.get(k) - 1);
          changed += 1;
        }
      }
      const gone = m.out - changed;
      const appeared = m.in - changed;
      total += m.out + m.in;
      Object.assign(sum, { out: sum.out + m.out, in: sum.in + m.in, changed: sum.changed + changed, gone: sum.gone + gone, appeared: sum.appeared + appeared });
      perDistrict.push({ name, out: m.out, in: m.in, changed, gone, appeared, before: b.length, after: a.length });
    }
    console.log(`어긋남 행(나간 줄 + 들어온 줄): ${total} — 나간 ${sum.out} · 들어온 ${sum.in} (짝지은 값 바뀜 ${sum.changed} · 사라짐 ${sum.gone} · 새 줄 ${sum.appeared})`);
    for (const r of perDistrict) console.log(`  ${r.name}: 줄 ${r.before}→${r.after} · 나간 ${r.out} · 들어온 ${r.in} (값 바뀜 ${r.changed} · 사라짐 ${r.gone} · 새 줄 ${r.appeared})`);
    // 적용 0 이면 지표와 상관없이 「판정 불가」(PREREG 6절 v2). 기록에는 회차와 적용/덧씌움 슬롯 수를 붙인다.
    const v1 = slots.applied === 0 ? NO_APPLIED : total >= 1 ? "≥ 1 → 전환" : "= 0 → 전환하지 않음";
    console.log(`판정 입력 (가-1): 어긋남 행 ${total} ${v1} (문턱 1행, PREREG) · ${roundTag(slots)}`);

    // 공개 값 전후(기록): 화면 파일 세 개의 잎 차이 수. 단지명이 든 잎은 경로·값을 찍지 않고 수만 센다.
    for (const [label, b, a] of [
      ["budget-deals.json", before.payload.screen, after.payload.screen],
      ["deal-search.json", before.payload.search, after.payload.search],
      ["budget-months.json", before.payload.months, after.payload.months],
    ]) {
      const d = leafDiff(b, a, UPDATED_AT);
      console.log(`[공개 값] ${label}: 바뀐 잎 ${d.length} (글자 ${d.filter((x) => x.kind === "글자").length} · 숫자 ${d.filter((x) => x.kind === "숫자").length} · 기타 ${d.filter((x) => x.kind === "기타").length})`);
    }
    const bandRows = (p) => p.screen.bands.map((x) => `${x.min10k}-${x.max10k ?? ""}:${x.count}/${x.direct}`);
    const bb = bandRows(before.payload);
    const ab = bandRows(after.payload);
    console.log(`[공개 값] budget-deals 구간(최소-최대:건수/직거래) 바뀐 칸: ${bb.filter((x, i) => x !== ab[i]).length}/${bb.length}` + (bb.length !== ab.length ? ` · 구간 수 ${bb.length}→${ab.length}` : ""));
    for (let i = 0; i < Math.max(bb.length, ab.length); i += 1) if (bb[i] !== ab[i]) console.log(`  ${bb[i] ?? "-"} → ${ab[i] ?? "-"}`);
    console.log(`[공개 값] 해제 제외 건수 cancelled: ${before.source.cancelled} → ${after.source.cancelled}`);
    await writeFile(`${OUT}/ga1.json`, JSON.stringify({ perDistrict, sum, total, screenDiff: leafDiff(before.payload.screen, after.payload.screen, UPDATED_AT) }));
  }
}

// ================================================================================================================
// (가-2) 전세가율·전세 비중: build-complex-ratio.ts readRaw(매매 29행) → complex-ratio.json·jeonse-risk.json
// ================================================================================================================
{
  head("(가-2) 전세가율·전세 비중");
  const NOW = new Date("2026-11-16T02:45:01.520Z"); // cd20a99b complex-ratio.json·jeonse-risk.json updatedAt
  const { MONTHS, readRaw, buildPayload } = await S("build-complex-ratio.ts");
  const { cellRatioEntries } = await S("complex-ratio.ts");
  const { countDistricts } = await S("build-jeonse-risk.ts");
  const { buildRisk, priceLookup } = await S("jeonse-risk.ts");
  const { complexPriceFileName } = await S("build-complex-price.ts");
  const months = recentMonths(NOW, MONTHS);
  const slots = await slotTable(P, months, "(가-2) 전세가율·전세 비중");

  // readRaw(build-complex-ratio.ts 24~36행)와 같은 읽기인데 매매 읽기 함수만 갈아 끼운다. 전월세(30행)는 늘 저장 그대로.
  const itemsOf = (files) => files.filter((file) => file?.ok !== false && Array.isArray(file?.items)).flatMap((file) => file.items);
  const readRawWith = async (readSale) => {
    const same = await readSameNames(RAW);
    const per = await Promise.all(
      DISTRICTS.map(async ({ code, name }) => {
        const [sales, rents] = await Promise.all([
          Promise.all(months.map((ym) => readSale("sale", code, ym, RAW))).then(itemsOf),
          Promise.all(months.map((ym) => readSlotFile("rent", code, ym, RAW))).then(itemsOf),
        ]);
        return [name, { sales, rents, same: same[code] }];
      })
    );
    return Object.fromEntries(per);
  };
  const canon = (by) => JSON.stringify(Object.entries(by).map(([n, v]) => [n, v.sales, v.rents, v.same ? [...v.same].sort() : null]));

  const real = await readRaw(months, RAW);
  const mine = await readRawWith(readSlotFile);
  const selfOk = canon(real) === canon(mine);
  console.log(`[재현] 읽기 사본(readRawWith(readSlotFile)) = 빌더 readRaw: ${selfOk ? "같음" : "다름"}`);

  const risk = async (by) => buildRisk({ byDistrict: await countDistricts(by, DATA), now: NOW, months: [months[0], months.at(-1)] });
  const a1B = buildPayload({ byDistrict: real, now: NOW });
  const a2B = await risk(real);
  // pm 순서 판정: before 는 #910 계수 after(PR #923 84bd34c0)와 같아야 한다 - 칸 977, compared 710, high 13, 서울 중앙 49.4%.
  const expect = { cells: 977, compared: 710, high: 13, median: 49.4 };
  const got = { cells: a1B.seoul.cells, compared: a2B.seoul.compared, high: a2B.seoul.high, median: a1B.seoul.median };
  const pmOk = Object.keys(expect).every((k) => got[k] === expect[k]) && a2B.seoul.cells === a1B.seoul.cells;
  console.log(`[재현] #910 계수 after 대조: ${JSON.stringify(got)} (기대 ${JSON.stringify(expect)}, jeonse-risk 칸 ${a2B.seoul.cells}) → ${pmOk ? "같음" : "다름"}`);

  if (!selfOk || !pmOk) {
    stopped.push("(가-2)");
    console.log("멈춤: (가-2) before 가 기준과 다르다 - 이 경로의 after 는 만들지 않는다(PREREG 멈춤 4·5)");
  } else {
    const byA = await readRawWith(readRecollectedSlot);
    const a1A = buildPayload({ byDistrict: byA, now: NOW });
    const a2A = await risk(byA);

    // 어긋남 칸 = (a) 칸 집합에 들고 나는 칸 ∪ (b) 전세가율 값이 다른 칸 ∪ (c) 1년 전 값 맞물림(compared)이 다른 칸. 구마다 칸 키로 견준다.
    // (c)의 맞물림은 districtCounts(jeonse-risk.ts)와 같은 찾기·조건(yearAgo.median > 0 && raw > 0)이다.
    const tally = { a: 0, aIn: 0, aOut: 0, b: 0, c: 0, union: 0 };
    const rows = [];
    for (const { name } of DISTRICTS) {
      const price = await readJson(path.join(DATA, complexPriceFileName(DISTRICT_SLUGS[name]))).catch(() => null);
      const lookup = priceLookup(price?.cells);
      const comparable = (key) => {
        const cut = key.lastIndexOf("|");
        const cell = lookup.get(`${key.slice(0, cut).trim()}\u0000${Math.round(Number(key.slice(cut + 1)) * 100) / 100}`);
        return cell?.yearAgo?.median > 0 && cell?.raw > 0;
      };
      const eB = new Map(cellRatioEntries(real[name].sales, real[name].rents, real[name].same).map((c) => [c.key, c.ratio]));
      const eA = new Map(cellRatioEntries(byA[name].sales, byA[name].rents, byA[name].same).map((c) => [c.key, c.ratio]));
      const r = { name, a: 0, aIn: 0, aOut: 0, b: 0, c: 0, union: 0, aCompared: 0 };
      for (const key of new Set([...eB.keys(), ...eA.keys()])) {
        const inB = eB.has(key);
        const inA = eA.has(key);
        const a = inB !== inA;
        const b = inB && inA && !Object.is(eB.get(key), eA.get(key));
        // 양쪽에 다 있는 칸은 같은 키로 같은 가격 파일을 찾으므로 맞물림이 같다. 한쪽에만 있는 칸은 (a)이고, 그 칸이 맞물리는 칸이었으면 compared 가 달라진다.
        const c = a && comparable(key);
        if (a) {
          r.a += 1;
          if (inA) r.aIn += 1;
          else r.aOut += 1;
        }
        if (b) r.b += 1;
        if (c) r.c += 1;
        if (a || b || c) r.union += 1;
      }
      for (const k of Object.keys(tally)) tally[k] += r[k];
      if (r.union) rows.push(r);
    }
    console.log(`어긋남 칸(합집합): ${tally.union} — (a) 들고 난 칸 ${tally.a}(생김 ${tally.aIn} · 사라짐 ${tally.aOut}) · (b) 전세가율이 다른 칸 ${tally.b} · (c) 맞물림이 달라진 칸 ${tally.c}`);
    for (const r of rows) console.log(`  ${r.name}: 합 ${r.union} · (a) ${r.a}(+${r.aIn}/−${r.aOut}) · (b) ${r.b} · (c) ${r.c}`);
    const v2 = slots.applied === 0 ? NO_APPLIED : tally.union >= 1 ? "≥ 1 → 전환" : "= 0 → 전환하지 않음";
    console.log(`판정 입력 (가-2): 어긋남 칸 ${tally.union} ${v2} (문턱 1칸, PREREG) · ${roundTag(slots)}`);

    // 공개 값 전후(기록): 서울·구. 칸 이름은 없다(구 집계만).
    const line = (s) => (s ? JSON.stringify(s) : "null");
    console.log(`[공개 값] complex-ratio 서울 ${line(a1B.seoul)} → ${line(a1A.seoul)}`);
    console.log(`[공개 값] jeonse-risk 서울 ${line(a2B.seoul)} → ${line(a2A.seoul)}`);
    for (const { name } of DISTRICTS) {
      const x = [line(a1B.districts[name]), line(a1A.districts[name]), line(a2B.districts[name]), line(a2A.districts[name])];
      if (x[0] !== x[1] || x[2] !== x[3]) console.log(`  ${name}: 전세가율 ${x[0]} → ${x[1]} · 전세 비중 ${x[2]} → ${x[3]}`);
    }
    const d1 = leafDiff(a1B, a1A, UPDATED_AT);
    const d2 = leafDiff(a2B, a2A, UPDATED_AT);
    console.log(`[공개 값] complex-ratio.json 바뀐 잎 ${d1.length} · jeonse-risk.json 바뀐 잎 ${d2.length}`);
    await writeFile(`${OUT}/ga2.json`, JSON.stringify({ tally, rows, a1B, a1A, a2B, a2A }));
  }
}

console.log(`\n멈춘 경로: ${stopped.length ? stopped.join(", ") : "없음"}`);
finish();
