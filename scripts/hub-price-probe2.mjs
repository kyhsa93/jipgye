// 임시 시험용(시험 후 삭제). 건축HUB 2차 시험(#68). 1차(hub-price-probe.mjs)의 시크릿 안전 규칙을 그대로 유지한다.
// 규격: 활용가이드 건축HUB 건축물대장 1.0(data.go.kr 15134735 FILE_000000003051351, 확인일 2026-10-11)
//  - getBrHsprcInfo(8절): 필수 sigunguCd·bjdongCd, 옵션 platGbCd·bun·ji·startDate·endDate(검색시작일/종료일 YYYYMMDD, 어느 일자에 걸리는지는 가이드에 없다 - 시험으로 본다)·numOfRows(VARCHAR(3))·pageNo
//  - getBrExposPubuseAreaInfo(6절): 필수 sigunguCd·bjdongCd, 옵션 platGbCd·bun·ji·dongNm·hoNm·startDate·endDate·numOfRows·pageNo; 응답 exposPubuseGbCd(1전유/2공용)·mainAtchGbCd(0주건축물/1부속)·area·flrNo·mgmBldrgstPk
//
// 출력은 집계뿐이다(소유자 조건 C1): 응답 원문·호 단위 값(공시가격·면적·층·PK)·지번별 줄·키·URL은 stdout·stderr·파일 어디에도 내지 않는다.
// 조인·매칭은 메모리 안에서만 하고 지번이 끝나면 버린다. 오류는 이름·HTTP 상태·결과코드(숫자)만 남긴다 - err.message는 쓰지 않는다.
// 호출은 시작 간격 1.1초 이상, 재시도 없음. 연속 5회 실패·한도/키 오류·권한 오류(면적 서비스 첫 호출)면 멈춘다.
import { readFileSync, appendFileSync } from "node:fs";

const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";
const OP_PRICE = "getBrHsprcInfo";
const OP_AREA = "getBrExposPubuseAreaInfo";
const PAGE = 999; // numOfRows VARCHAR(3)의 최대
const MIN_GAP_MS = 1100;
const DEV_DAILY_LIMIT = 10000;
const STOP_CODES = new Set(["22", "30", "31", "32", "33"]); // 22 한도 초과, 30~33 키 오류
const MAX_CALLS_TOTAL = 2500;
const MAX_PAGES_PER_JIBUN = 30;
const FILTER = { startDate: "20260101", endDate: "20261231" };

function normalizeKey(raw) {
  let k = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (/%[0-9A-Fa-f]{2}/.test(k)) { try { k = decodeURIComponent(k); } catch { /* 그대로 */ } }
  return k;
}
const key = normalizeKey(process.env.PUBLIC_DATA_PORTAL_API_KEY);
if (!key) { console.error("PUBLIC_DATA_PORTAL_API_KEY 시크릿이 비어 있다. 호출하지 않고 종료한다."); process.exit(1); }

const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const { meta, sample: all } = readJson("../research/hub-price-probe/sample2.json");
const { sale: saleBy } = readJson("../research/hub-price-probe/sale-sample.json");
const nJibun = Math.max(1, Math.min(Number(process.env.MAX_JIBUN) || 40, all.length));
const nValid = Math.max(0, Math.min(Number(process.env.VALIDATE_JIBUN) || 6, nJibun));
const sample = all.slice(0, nJibun);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, b) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
const quant = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const dist = (arr) => (arr.length ? `최소 ${quant(arr, 0)} / p25 ${quant(arr, 0.25)} / 중앙 ${quant(arr, 0.5)} / p75 ${quant(arr, 0.75)} / p90 ${quant(arr, 0.9)} / 최대 ${quant(arr, 1)} (평균 ${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)}, n=${arr.length})` : "자료 없음");
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const yr = (v) => String(v ?? "").trim().slice(0, 4) || "(빈값)";
const a1 = (x) => Math.round(Number(x) * 10 + 1e-7); // 0.1㎡ 단위 정수

const net = { calls: 0, ok: 0, fail: 0, errCodes: {}, httpStatus: {}, consecutiveFail: 0, stoppedBy: null, last: 0 };
const lat = { price: [], area: [] }; const bytes = { price: [], area: [] }; const maxItemsPerPage = { price: 0, area: 0 };
const pageLat = { price: [], area: [] }; // 쪽이 꽉 찬(≥900건) 응답만
const pageBytes = { price: [], area: [] };

function extract(text) {
  try {
    const body = JSON.parse(text)?.response;
    if (body?.header) {
      const raw = body.body?.items;
      const item = raw && typeof raw === "object" ? raw.item : undefined;
      const items = Array.isArray(item) ? item : item && typeof item === "object" ? [item] : [];
      return { code: String(body.header.resultCode ?? ""), total: Number(body.body?.totalCount ?? 0), items };
    }
  } catch { /* 포털 게이트웨이 오류는 XML */ }
  return { code: /<(?:returnReasonCode|resultCode)>\s*(\d+)\s*</.exec(text)?.[1] ?? "?", total: 0, items: [], nonJson: true };
}

// 한 번 호출. 성공하면 {total, items}, 실패하면 null. 중단 조건이면 net.stoppedBy를 채운다.
async function call(op, params, tag) {
  if (net.stoppedBy) return null;
  if (net.consecutiveFail >= 5) { net.stoppedBy = "연속 실패 5회"; return null; }
  if (net.calls >= MAX_CALLS_TOTAL) { net.stoppedBy = `총 호출 상한 ${MAX_CALLS_TOTAL}`; return null; }
  const wait = net.last + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  net.last = Date.now();
  const qs = Object.entries({ ...params, numOfRows: PAGE, _type: "json" }).map(([k, v]) => `${k}=${v}`).join("&");
  const t0 = Date.now();
  net.calls += 1;
  let text = "";
  try {
    const res = await fetch(`${BASE}/${op}?${qs}&serviceKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(60000) });
    bump(net.httpStatus, `${tag} ${res.status}`);
    text = await res.text();
    lat[tag].push(Date.now() - t0); bytes[tag].push(Buffer.byteLength(text));
    if (!res.ok) throw Object.assign(new Error("http"), { tag: `${tag} HTTP ${res.status}`, auth: res.status === 401 || res.status === 403 });
  } catch (e) {
    net.fail += 1; net.consecutiveFail += 1;
    bump(net.errCodes, e?.tag ?? `${tag} ${e?.name ?? "Error"}/${e?.cause?.code ?? "-"}`); // 메시지·URL은 쓰지 않는다
    if (e?.auth) net.stoppedBy = `${tag} HTTP 권한 오류`;
    return null;
  }
  const r = extract(text);
  text = "";
  if (r.code !== "00") {
    net.fail += 1; net.consecutiveFail += 1; bump(net.errCodes, `${tag} resultCode ${r.code}`);
    if (STOP_CODES.has(r.code)) net.stoppedBy = `${tag} 결과코드 ${r.code}`;
    return null;
  }
  net.consecutiveFail = 0; net.ok += 1;
  maxItemsPerPage[tag] = Math.max(maxItemsPerPage[tag], r.items.length);
  if (r.items.length >= 900) { pageLat[tag].push(lat[tag].at(-1)); pageBytes[tag].push(bytes[tag].at(-1)); }
  return r;
}

// 한 지번의 모든 쪽을 받는다. onItems는 쪽마다 호출된다. 반환: {total, pages, truncated, okAll}
async function fetchAll(op, tag, s, extra, onItems) {
  let total = 0, pages = 0, got = 0;
  for (let p = 1; p <= MAX_PAGES_PER_JIBUN; p += 1) {
    const r = await call(op, { sigunguCd: s.sigunguCd, bjdongCd: s.bjdongCd, platGbCd: 0, bun: s.bun, ji: s.ji, ...extra, pageNo: p }, tag);
    if (!r) return { total, pages, truncated: false, okAll: false };
    pages += 1; total = r.total; got += r.items.length;
    onItems(r.items);
    if (got >= total || r.items.length === 0) return { total, pages, truncated: false, okAll: true };
  }
  return { total, pages, truncated: true, okAll: true };
}

const lines = [];
const L = (s = "") => lines.push(s);
const flush = () => {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
};

// ---- 0. 면적 서비스 권한 확인(1호출) ----
{
  const r = await call(OP_AREA, { sigunguCd: sample[0].sigunguCd, bjdongCd: sample[0].bjdongCd, platGbCd: 0, bun: sample[0].bun, ji: sample[0].ji, pageNo: 1 }, "area");
  if (!r) {
    L("## 건축HUB 2차 시험 - 면적 서비스 권한 확인에서 멈춤");
    L(`- getBrExposPubuseAreaInfo 첫 호출 실패. 분류: ${JSON.stringify(net.errCodes)}, HTTP: ${JSON.stringify(net.httpStatus)}${net.stoppedBy ? `, 중단: ${net.stoppedBy}` : ""}`);
    L("- 같은 키로 호출되지 않는다면 신규 활용신청은 소유자 몫이다. 이후 단계는 하지 않았다.");
    flush(); process.exit(1);
  }
  net.consecutiveFail = 0;
}

// ---- 1. 필터 검증(앞 nValid지번: 무필터 전쪽 vs 2026 필터 전쪽 vs startDate만) ----
const val = { n: 0, totalAll: [], totalF: [], totalS: [], reduced: 0, uAll: { std: {}, crtn: {} }, uF: { std: {}, crtn: {} }, all26std: 0, all26crtn: 0, f26std: 0, f26crtn: 0, fItems: 0, fOnlyStdOther: 0, pagesAll: [], pagesF: [], hoAll: [], hoF26: [] };
for (const s of sample.slice(0, nValid)) {
  const a = { std: {}, crtn: {}, pk: new Set(), pk26: new Set() }, f = { std: {}, crtn: {}, pk26: new Set() };
  const ra = await fetchAll(OP_PRICE, "price", s, {}, (items) => { for (const it of items) { bump(a.std, yr(it.stdDay)); bump(a.crtn, yr(it.crtnDay)); a.pk.add(it.mgmBldrgstPk); if (yr(it.stdDay) === "2026") a.pk26.add(it.mgmBldrgstPk); } });
  const rf = await fetchAll(OP_PRICE, "price", s, FILTER, (items) => { for (const it of items) { val.fItems += 1; bump(f.std, yr(it.stdDay)); bump(f.crtn, yr(it.crtnDay)); if (yr(it.stdDay) === "2026") f.pk26.add(it.mgmBldrgstPk); else val.fOnlyStdOther += 1; } });
  const rs = await call(OP_PRICE, { sigunguCd: s.sigunguCd, bjdongCd: s.bjdongCd, platGbCd: 0, bun: s.bun, ji: s.ji, startDate: FILTER.startDate, pageNo: 1 }, "price");
  if (!ra.okAll || !rf.okAll) continue;
  val.n += 1; val.totalAll.push(ra.total); val.totalF.push(rf.total); if (rs) val.totalS.push(rs.total);
  if (rf.total < ra.total) val.reduced += 1;
  val.pagesAll.push(ra.pages); val.pagesF.push(rf.pages);
  for (const [k, v] of Object.entries(a.std)) bump(val.uAll.std, k, v); for (const [k, v] of Object.entries(a.crtn)) bump(val.uAll.crtn, k, v);
  for (const [k, v] of Object.entries(f.std)) bump(val.uF.std, k, v); for (const [k, v] of Object.entries(f.crtn)) bump(val.uF.crtn, k, v);
  val.all26std += a.std["2026"] ?? 0; val.all26crtn += a.crtn["2026"] ?? 0; val.f26std += f.std["2026"] ?? 0; val.f26crtn += f.crtn["2026"] ?? 0;
  val.hoAll.push(a.pk.size); val.hoF26.push(f.pk26.size);
}
const filterWorks = val.n > 0 && val.reduced / val.n >= 0.8;

// ---- 2. 본 시험: 전 표본, 2026 필터(작동하면) + 면적 ----
const st = {
  n: 0, priceOk: 0, areaOk: 0,
  priceTotal: [], pricePages: [], areaTotal: [], areaPages: [], truncPrice: 0, truncArea: 0,
  byStratum: {}, // stratum -> {pP:[], pA:[]}
  ho26: [], hoPk: 0, hoWithArea: 0, hoPkInArea: 0, hoPkInAreaExposMain: 0,
  hsprcFilled: 0, hsprcItems: 0, kinds: {}, gbs: {},
  areaKinds: {}, areaRowsPerPk: [], areaPkAreaSum: 0,
  cellN: [], cellNfloor: [], cellsTotal: 0, cellsLt3: 0, hoInCellsLt3: 0, cellsFloorTotal: 0, cellsFloorLt3: 0,
  deals: 0, dealsJibunHasHub: 0, dealsJibunHasHubArea: 0, matchExact: 0, matchNear: 0, matchFloor: 0, matchExactN3: 0, dealsInHubJibun_exact: 0,
  jibunNoHsprc2026: 0, jibunMatched: 0, jibunAny: 0,
};
for (const s of sample) {
  if (net.stoppedBy) break;
  st.n += 1;
  const sg = st.byStratum[s.stratum] ?? (st.byStratum[s.stratum] = { pP: [], pA: [], n: 0 });
  sg.n += 1;
  const price = new Map(); // PK -> true (2026 기준일자 항목)
  let pItems = 0;
  const rp = await fetchAll(OP_PRICE, "price", s, filterWorks ? FILTER : {}, (items) => {
    for (const it of items) {
      pItems += 1; st.hsprcItems += 1;
      const v = Number(String(it.hsprc ?? "").trim());
      if (Number.isFinite(v) && v > 0) st.hsprcFilled += 1;
      bump(st.kinds, String(it.regstrKindCdNm ?? "").trim() || "(빈값)");
      if (yr(it.stdDay) === "2026") price.set(it.mgmBldrgstPk, true);
    }
  });
  if (!rp.okAll) continue;
  st.priceOk += 1; st.priceTotal.push(rp.total); st.pricePages.push(rp.pages); sg.pP.push(rp.pages);
  if (rp.truncated) st.truncPrice += 1;
  st.ho26.push(price.size);

  const areaOf = new Map(); // PK -> {main: 0.1㎡ 정수합, flr}
  const rowsPerPk = new Map();
  const ra = await fetchAll(OP_AREA, "area", s, {}, (items) => {
    for (const it of items) {
      const k = `${String(it.exposPubuseGbCdNm ?? "").trim() || "?"}/${String(it.mainAtchGbCdNm ?? "").trim() || "?"}`;
      bump(st.areaKinds, k);
      const pk = it.mgmBldrgstPk;
      if (String(it.exposPubuseGbCd) === "1") {
        rowsPerPk.set(pk, (rowsPerPk.get(pk) ?? 0) + 1);
        if (String(it.mainAtchGbCd) === "0") {
          const e = areaOf.get(pk) ?? { sum: 0, flr: Number(it.flrNo) };
          e.sum += Number(it.area) || 0;
          areaOf.set(pk, e);
        }
      }
    }
  });
  if (!ra.okAll) continue;
  st.areaOk += 1; st.areaTotal.push(ra.total); st.areaPages.push(ra.pages); sg.pA.push(ra.pages);
  if (ra.truncated) { st.truncArea += 1; continue; } // 쪽 상한에 걸린 지번은 조인 통계에서 뺀다
  for (const v of rowsPerPk.values()) st.areaRowsPerPk.push(v);

  // 조인(메모리 안에서만)
  const cells = new Map(), cellsF = new Map();
  for (const pk of price.keys()) {
    st.hoPk += 1;
    const e = areaOf.get(pk);
    if (rowsPerPk.has(pk)) st.hoPkInArea += 1;
    if (e && e.sum > 0) {
      st.hoPkInAreaExposMain += 1; st.hoWithArea += 1;
      const c = a1(e.sum);
      cells.set(c, (cells.get(c) ?? 0) + 1);
      const cf = `${c}|${e.flr}`;
      cellsF.set(cf, (cellsF.get(cf) ?? 0) + 1);
    }
  }
  for (const n of cells.values()) { st.cellN.push(n); st.cellsTotal += 1; if (n < 3) { st.cellsLt3 += 1; st.hoInCellsLt3 += n; } }
  for (const n of cellsF.values()) { st.cellNfloor.push(n); st.cellsFloorTotal += 1; if (n < 3) st.cellsFloorLt3 += 1; }

  const deals = saleBy[`${s.sigunguCd}${s.bjdongCd}|${s.bun}|${s.ji}`] ?? [];
  st.deals += deals.length;
  if (price.size > 0) { st.dealsJibunHasHub += deals.length; st.jibunAny += 1; } else st.jibunNoHsprc2026 += 1;
  if (cells.size > 0) {
    st.dealsJibunHasHubArea += deals.length;
    let hit = 0;
    for (const [area, flr] of deals) {
      const c = a1(area);
      const exact = cells.has(c);
      if (exact) { st.matchExact += 1; hit += 1; if ((cells.get(c) ?? 0) >= 3) st.matchExactN3 += 1; }
      if (exact || cells.has(c - 1) || cells.has(c + 1)) st.matchNear += 1;
      if (cellsF.has(`${c}|${flr}`)) st.matchFloor += 1;
    }
    if (hit > 0) st.jibunMatched += 1;
  }
}

// ---- 출력 ----
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
L("## 건축HUB 2차 시험(#68) - 집계만");
L(`- 표본 ${st.n}/${sample.length}지번(표본 확장 후 ${all.length}지번 중), 필터 검증 ${val.n}지번. 호출 ${net.calls}회(성공 ${net.ok}, 실패 ${net.fail})${net.stoppedBy ? `, 중단: ${net.stoppedBy}` : ""}. 쪽 크기 numOfRows=${PAGE}.`);
if (net.fail) L(`- 실패 분류: ${JSON.stringify(net.errCodes)}, HTTP: ${JSON.stringify(net.httpStatus)}`);
L("### 1. 2026 필터(startDate/endDate) 검증 (지번 단위 합산, 호 값 없음)");
L(`- 필터 ${FILTER.startDate}~${FILTER.endDate}. 검증 ${val.n}지번 중 totalCount가 줄어든 지번 ${val.reduced} (${pct(val.reduced, val.n)}) -> 필터 ${filterWorks ? "작동(본 시험에 적용)" : "작동하지 않음(본 시험은 무필터, 2026 기준일자만 메모리에서 거름)"}`);
L(`- 지번당 totalCount 무필터: ${dist(val.totalAll)}`);
L(`- 지번당 totalCount 2026 필터: ${dist(val.totalF)}`);
L(`- 지번당 totalCount startDate만(endDate 없이): ${dist(val.totalS)}`);
L(`- 쪽 수(999/쪽) 무필터 ${dist(val.pagesAll)}; 필터 ${dist(val.pagesF)}`);
L(`- 어느 일자에 걸리나: 무필터 전체의 stdDay 2026 항목 ${val.all26std}건, crtnDay 2026 항목 ${val.all26crtn}건. 필터 응답 ${val.fItems}건 중 stdDay 2026 ${val.f26std}건, crtnDay 2026 ${val.f26crtn}건, stdDay가 2026이 아닌 항목 ${val.fOnlyStdOther}건`);
L(`- 필터 응답의 stdDay 연도 분포 ${JSON.stringify(Object.fromEntries(Object.entries(val.uF.std).sort()))}; crtnDay 연도 분포 ${JSON.stringify(Object.fromEntries(Object.entries(val.uF.crtn).sort()))}`);
L(`- 무필터 응답의 crtnDay 연도 분포 ${JSON.stringify(Object.fromEntries(Object.entries(val.uAll.crtn).sort()))}`);
L(`- 서로 다른 호(PK) 수: 무필터 지번당 ${dist(val.hoAll)}; 필터에서 stdDay 2026인 호 ${dist(val.hoF26)}`);
L("### 2. hsprc 2026분 (본 시험)");
L(`- 항목 수(지번 totalCount): ${dist(st.priceTotal)}`);
L(`- 쪽 수: ${dist(st.pricePages)}; 쪽 상한(${MAX_PAGES_PER_JIBUN}) 도달 ${st.truncPrice}지번`);
L(`- hsprc 채움률 ${st.hsprcFilled}/${st.hsprcItems} (${pct(st.hsprcFilled, st.hsprcItems)}); 대장종류 ${JSON.stringify(st.kinds)}`);
L(`- 지번당 2026 기준일자 호 수: ${dist(st.ho26)}`);
L(`- 응답 크기(바이트, 모든 hsprc 호출): p50 ${quant(bytes.price, 0.5)} / p95 ${quant(bytes.price, 0.95)} / 최대 ${quant(bytes.price, 1)}; 지연(ms) p50 ${quant(lat.price, 0.5)} / p95 ${quant(lat.price, 0.95)} / 최대 ${quant(lat.price, 1)}`);
L(`- 꽉 찬 쪽(900건 이상) ${pageBytes.price.length}개: 바이트 p50 ${quant(pageBytes.price, 0.5)} / 최대 ${quant(pageBytes.price, 1)}; 지연 p50 ${quant(pageLat.price, 0.5)} / p95 ${quant(pageLat.price, 0.95)} / 최대 ${quant(pageLat.price, 1)}. 한 쪽 최대 항목 수 ${maxItemsPerPage.price}(999 미만이면 서버 상한 의심)`);
L("### 3. 면적(getBrExposPubuseAreaInfo)");
L(`- 같은 키로 호출됨. 성공 지번 ${st.areaOk}/${st.n}. 행 수(totalCount): ${dist(st.areaTotal)}`);
L(`- 쪽 수: ${dist(st.areaPages)}; 쪽 상한 도달(조인 통계에서 제외) ${st.truncArea}지번`);
L(`- 행 구분(전유공용/주부속) 분포 ${JSON.stringify(st.areaKinds)}`);
L(`- 응답 크기(바이트): p50 ${quant(bytes.area, 0.5)} / p95 ${quant(bytes.area, 0.95)} / 최대 ${quant(bytes.area, 1)}; 지연(ms) p50 ${quant(lat.area, 0.5)} / p95 ${quant(lat.area, 0.95)} / 최대 ${quant(lat.area, 1)}; 한 쪽 최대 항목 수 ${maxItemsPerPage.area}`);
L(`- 전유 행 수 / 전유부 PK 1개당: ${dist(st.areaRowsPerPk)}`);
L(`- 조인(mgmBldrgstPk): hsprc 2026 호 ${st.hoPk}개 중 면적 서비스 전유 행에 같은 PK가 있는 호 ${st.hoPkInArea} (${pct(st.hoPkInArea, st.hoPk)}), 그중 전유·주건축물 면적 합이 양수인 호(=호당 전용면적 채움) ${st.hoWithArea} (${pct(st.hoWithArea, st.hoPk)})`);
L("### 4. 매칭률(지번+전용면적 0.1㎡, 메모리 조인; 매매 표본은 3a92151의 raw/sale, 해제 제외)");
L(`- 표본 지번의 매매 ${st.deals}건. hsprc 2026 호가 있는 지번의 매매 ${st.dealsJibunHasHub}건(${pct(st.dealsJibunHasHub, st.deals)}); 지번 자체에 2026 호가 없는 지번 ${st.jibunNoHsprc2026}`);
L(`- 칸(지번, 면적)이 만들어진 지번의 매매 ${st.dealsJibunHasHubArea}건 기준: 면적 정확 일치 ${st.matchExact} (${pct(st.matchExact, st.dealsJibunHasHubArea)}), 0.1㎡ 이웃까지 ${st.matchNear} (${pct(st.matchNear, st.dealsJibunHasHubArea)}), 면적+층 일치 ${st.matchFloor} (${pct(st.matchFloor, st.dealsJibunHasHubArea)}); 일치 중 n>=3 칸에 든 것 ${st.matchExactN3}`);
L(`- 전체 매매 ${st.deals}건 대비 정확 일치 ${pct(st.matchExact, st.deals)}. 일치가 1건 이상인 지번 ${st.jibunMatched}/${st.jibunAny}`);
L("### 5. C2 - 칸의 호 수 n");
L(`- 칸(지번, 면적0.1) ${st.cellsTotal}개: n 분포 ${dist(st.cellN)}; n<3 칸 ${st.cellsLt3} (${pct(st.cellsLt3, st.cellsTotal)}), n<3 칸에 든 호 ${st.hoInCellsLt3}/${st.hoWithArea} (${pct(st.hoInCellsLt3, st.hoWithArea)})`);
L(`- 칸(지번, 면적, 층) ${st.cellsFloorTotal}개: n<3 ${st.cellsFloorLt3} (${pct(st.cellsFloorLt3, st.cellsFloorTotal)}); n 분포 ${dist(st.cellNfloor)}`);
L("### 6. 서울 전체 호출 수 추정 (표본 평균, 소·중·대 3분위 층화라 지번당 평균은 모집단 평균의 추정)");
const mp = mean(st.pricePages), ma = mean(st.areaPages);
if (mp && ma) {
  for (const [label, n] of [["매매 지번", meta.targetJibunSale], ["매매+전월세 지번", meta.targetJibunSaleOrRent]]) {
    const cp = Math.ceil(n * mp), ca = Math.ceil(n * ma);
    L(`- ${label} ${n}개: hsprc ${mp.toFixed(2)}쪽/지번 -> ${cp}회(${(cp / DEV_DAILY_LIMIT).toFixed(2)}일분); 면적 ${ma.toFixed(2)}쪽/지번 -> ${ca}회(${(ca / DEV_DAILY_LIMIT).toFixed(2)}일분); 합 ${cp + ca}회 = ${((cp + ca) / DEV_DAILY_LIMIT).toFixed(2)}일분 (개발계정 일 ${DEV_DAILY_LIMIT}회, 초당 1회면 약 ${((cp + ca) / 3600).toFixed(1)}시간)`);
  }
  L(`- 층별 평균 쪽 수(hsprc / 면적): ${JSON.stringify(Object.fromEntries(Object.entries(st.byStratum).map(([k, v]) => [k, [Number(mean(v.pP)?.toFixed(2)), Number(mean(v.pA)?.toFixed(2)), v.n]])))} (형식 [hsprc, 면적, 지번 수])`);
  L(`- 지번당 쪽 수 분산이 크다(최대 쪽 수 hsprc ${quant(st.pricePages, 1)} / 면적 ${quant(st.areaPages, 1)}). 표본이 ${st.n}개라 평균의 오차가 크다. 호출 상한은 ${MAX_PAGES_PER_JIBUN}쪽/지번.`);
} else L("- 성공 호출이 부족해 계산하지 못했다.");
flush();
process.exit(st.priceOk === 0 ? 1 : 0);
