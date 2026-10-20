/**
 * 공시가격 API 탐색 모드 (#68 E3). `--explore`: 쓰기 없음, 집계만 출력.
 * 본 수집 전에 한 번 돌려 pm이 총 호출 투영·운영계정 증량 판단을 할 근거를 만든다.
 *
 * 확인하는 것
 *  (a) 호당 항목 2건의 값 일치율·crtnDay 차이
 *  (b) startDate~endDate 응답의 stdDay 연도 분포, 2025·2026 호 집합 일치율
 *  (c) 큰 단지(판매 건수 상위)의 실제 totalCount
 *  (d) 면적 응답의 쪽별 전유 행 분포, hsprc로 알게 된 호가 전유 행에 다 나오는 쪽(조기 종료 가능성)
 *  (e) 일 한도가 서비스 단위인지 오퍼레이션 단위인지의 단서(한도 코드가 나온 시점의 오퍼레이션별 호출 수, 다른 오퍼레이션 한 번 더 호출)
 *  (f) 이 표본으로 본 서울 전체 투영 호출 수
 *  (g) 면적 pageNo 3자리 가정 시험: 큰 단지 중 면적 쪽 수가 가장 큰 지번에 pageNo=999·1000을 한 번씩 요청해 HTTP 상태·결과코드·항목 수만 센다.
 *      1,000이 거절되면 후속(PR-A2)으로 면적을 dongNm(요청 파라미터)별로 나눠 받는다 - 동명은 메모리에서만 쓰고 출력·저장하지 않으며,
 *      나눈 요청의 쪽 합이 totalCount 합과 같아야 완료로 친다. 이 파일은 시험만 하고 분할은 구현하지 않는다.
 *
 * 출력은 집계뿐이다(C1): 호 단위 값·PK·지번 키·응답 원문이 없다. 검증이 어긋나도(범위 밖 stdDay, 쪽 합 불일치, 필수 필드 누락,
 * 소유자 계열 키) 던지지 않고 건수로 센다 - 탐색의 목적이 그 분포를 보는 것이다. 키 이름(스키마)은 출력하되 값은 아니다.
 */
import { orderTargets } from "./official-price-targets.ts";
import { ApiFatalError, MAX_PAGES_PER_PARCEL, OP_AREA, OP_PRICE, OWNER_KEY_RE, PAGE_SIZE, ParcelFailed, StopRun, AREA_FIELDS, PRICE_FIELDS, bump, fetchParcelOp, makeClient, extract } from "./official-price-api.ts";

const quant = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const dist = (arr) => (arr.length ? `최소 ${quant(arr, 0)} / p25 ${quant(arr, 0.25)} / 중앙 ${quant(arr, 0.5)} / p75 ${quant(arr, 0.75)} / p90 ${quant(arr, 0.9)} / 최대 ${quant(arr, 1)} (평균 ${mean(arr).toFixed(2)}, n=${arr.length})` : "자료 없음");
const pct = (a, b) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
const yr = (v) => (/^\d{4}/.test(String(v ?? "").trim()) ? String(v).trim().slice(0, 4) : "(빈값)");
const dayNum = (v) => { const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(v ?? "").trim()); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; };
const sortedObj = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));

/**
 * opts: key, baseUrl, targets(Map), startDate, endDate, sampleN, bigN, budget, gapMs, deadlineMs, fetchImpl, dailyBudget, totalLimitDays
 * 반환: { lines, calls } - lines는 출력할 줄(집계뿐).
 */
export async function runExplore(opts) {
  const { key, baseUrl, targets, startDate, endDate, sampleN = 40, bigN = 8, budget = 3000, gapMs, deadlineMs, fetchImpl, dailyBudget = 9000 } = opts;
  const client = makeClient({ baseUrl, key, budget, gapMs, deadlineMs, fetchImpl });
  const order = orderTargets(targets);
  const sample = order.slice(0, sampleN);
  const inSample = new Set(sample.map(([k]) => k));
  const big = [...targets].filter(([k]) => !inSample.has(k)).sort((a, b) => b[1].saleDeals - a[1].saleDeals || (a[0] < b[0] ? -1 : 1)).slice(0, bigN);
  const issues = { price: {}, area: {} };
  const keysSeen = { price: new Set(), area: new Set() };

  const A = { // (a)(b)
    groups: { 1: 0, 2: 0, "3+": 0 }, equal2: 0, crtnSame: 0, crtnLe365: 0, crtnGt365: 0, crtnMissing: 0,
    stdYears: {}, crtnYears: {}, pk25: 0, pk26: 0, both: 0, items: 0, hsprcInvalid: 0,
  };
  const C = { sample: { price: [], area: [], pricePages: [], areaPages: [], truncated: 0 }, big: { price: [], area: [], pricePages: [], areaPages: [] } };
  const D = { pages: {} as Record<string, { rows: number; expos: number }>, early: { parcels: 0, allFound: 0, ratio: [], pagesAll: 0, pagesNeeded: 0 }, areaKinds: {} }; // pages: 구간 -> {rows, expos}
  const bucket = (i) => (i <= 3 ? String(i) : i <= 5 ? "4-5" : i <= 10 ? "6-10" : i <= 30 ? "11-30" : "31+");
  let stopped = null;
  let fatal = null;
  let doneSample = 0;
  let doneBig = 0;
  let limitProbe = null;
  let bigBest = null; // 큰 단지 중 면적 쪽 수가 가장 큰 지번(pageNo 시험 대상). 키는 출력하지 않는다.
  let pageProbe = null;

  const one = async (t, group) => {
    const price = await fetchParcelOp(client, OP_PRICE, "price", t, { startDate, endDate }, { issues: issues.price, onRaw: (r) => { for (const k of Object.keys(r)) keysSeen.price.add(k); } });
    const area = await fetchParcelOp(client, OP_AREA, "area", t, {}, { issues: issues.area, onRaw: (r) => { for (const k of Object.keys(r)) keysSeen.area.add(k); } });
    const g = group === "big" ? C.big : C.sample;
    if (group === "big" && (!bigBest || area.pages > bigBest.pages)) bigBest = { t, pages: area.pages };
    g.price.push(price.total); g.area.push(area.total); g.pricePages.push(price.pages); g.areaPages.push(area.pages);
    if (price.capped || area.capped) { if (group !== "big") C.sample.truncated += 1; return; }

    // (a)(b) 호별 연도별 항목
    const byPkYear = new Map();
    const pkYear = { 2025: new Set(), 2026: new Set() };
    for (const it of price.items) {
      A.items += 1;
      bump(A.stdYears, yr(it.stdDay)); bump(A.crtnYears, yr(it.crtnDay));
      const v = Number(String(it.hsprc).replace(/,/g, ""));
      if (!(v > 0)) { A.hsprcInvalid += 1; continue; }
      const k = `${it.mgmBldrgstPk}|${yr(it.stdDay)}`;
      const list = byPkYear.get(k) ?? [];
      list.push({ v, crtn: dayNum(it.crtnDay) });
      byPkYear.set(k, list);
      if (pkYear[yr(it.stdDay)]) pkYear[yr(it.stdDay)].add(it.mgmBldrgstPk);
    }
    for (const list of byPkYear.values()) {
      if (list.length === 1) A.groups[1] += 1;
      else if (list.length === 2) {
        A.groups[2] += 1;
        if (list[0].v === list[1].v) A.equal2 += 1;
        if (list[0].crtn === null || list[1].crtn === null) A.crtnMissing += 1;
        else { const d = Math.abs(list[0].crtn - list[1].crtn); if (d === 0) A.crtnSame += 1; else if (d <= 365) A.crtnLe365 += 1; else A.crtnGt365 += 1; }
      } else A.groups["3+"] += 1;
    }
    A.pk25 += pkYear[2025].size; A.pk26 += pkYear[2026].size;
    for (const pk of pkYear[2026]) if (pkYear[2025].has(pk)) A.both += 1;

    // (d) 면적 응답: 쪽별 전유 행, 조기 종료 가능성
    const need = new Set(pkYear[2026]);
    const found = new Set();
    let completeAt = need.size === 0 ? 0 : null;
    area.items.forEach((it, i) => {
      const page = Math.floor(i / (area.pageSize || PAGE_SIZE)) + 1;
      const b = D.pages[bucket(page)] ?? (D.pages[bucket(page)] = { rows: 0, expos: 0 });
      b.rows += 1;
      const kind = `${it.exposPubuseGbCd}/${it.mainAtchGbCd ?? "-"}`;
      bump(D.areaKinds, kind);
      if (String(it.exposPubuseGbCd) === "1") {
        b.expos += 1;
        if (need.has(it.mgmBldrgstPk)) { found.add(it.mgmBldrgstPk); if (completeAt === null && found.size === need.size) completeAt = page; }
      }
    });
    D.early.parcels += 1;
    D.early.pagesAll += area.pages;
    if (completeAt !== null) { D.early.allFound += 1; D.early.ratio.push(completeAt === 0 ? 0 : completeAt / area.pages); D.early.pagesNeeded += Math.max(1, completeAt); }
    else D.early.pagesNeeded += area.pages; // 못 찾은 지번은 전부 읽는다
  };

  const run = async (list, group) => {
    for (const [, t] of list) {
      try { await one(t, group); if (group === "big") doneBig += 1; else doneSample += 1; } catch (e) {
        if (e instanceof StopRun) {
          stopped = e.reason;
          if (client.st.firstLimitAt && !limitProbe) {
            // (e) 한도 코드가 난 오퍼레이션이 아닌 쪽을 한 번 더 불러 같은 코드인지 본다(호출 예산을 한 번 넘긴다).
            const other = client.st.firstLimitAt.op === OP_PRICE ? OP_AREA : OP_PRICE;
            try { await client.page(other, t, 1, other === OP_PRICE ? { startDate, endDate } : {}); limitProbe = "다른 오퍼레이션은 한도 코드 없이 성공"; }
            catch (e2) { limitProbe = e2 instanceof StopRun ? `다른 오퍼레이션도 같은 한도 신호(${e2.reason})` : "다른 오퍼레이션 호출도 실패(한도 신호 아님)"; }
          }
          return false;
        }
        if (e instanceof ApiFatalError) { fatal = e.message; return false; }
        if (e instanceof ParcelFailed) { if (client.st.consecutiveFail >= 5) { stopped = "연속 호출 실패 5회"; return false; } continue; }
        throw e;
      }
    }
    return true;
  };
  if (await run(sample, "sample")) await run(big, "big");

  // (g) pageNo 999·1000 시험. 결과코드는 해석하지 않고(던지지 않고) 상태·코드·항목 수만 센다. 응답 원문·항목 값은 보관하지 않는다.
  if (bigBest && !stopped && !fatal) {
    pageProbe = { pages: bigBest.pages, results: [] };
    for (const pageNo of [999, 1000]) {
      try {
        const { res, text } = await client.send(OP_AREA, bigBest.t, pageNo, {});
        const r = extract(text);
        pageProbe.results.push({ pageNo, http: res.status, code: r.code, items: r.items.length, total: r.total, nonJson: Boolean(r.nonJson) });
      } catch (e) { pageProbe.results.push({ pageNo, error: e instanceof StopRun ? e.reason : "연결 실패" }); break; }
    }
  }

  // ---- 출력(집계뿐) ----
  const L = [];
  const calls = client.st.calls;
  L.push("## 공시가격 API 탐색(#68 E3) - 집계만, 쓰기 없음");
  L.push(`- 표본 ${doneSample}/${sample.length}지번(고정 시드 순서의 앞쪽 = 본 수집이 먼저 도는 지번), 큰 단지 ${doneBig}/${big.length}지번(매매 건수 상위). 호출 ${calls}회(예산 ${budget}). 기간 ${startDate}~${endDate}.`);
  L.push(`- 중단: ${stopped ?? "없음"}${fatal ? `; 오류: ${fatal}` : ""}. 호출 오류 분류: ${sortedObj(client.st.errCodes)}`);
  const iss = (o) => (Object.keys(o).length ? sortedObj(o) : "없음");
  L.push(`- 검증 위반 건수(탐색은 던지지 않고 센다): hsprc ${iss(issues.price)}; 면적 ${iss(issues.area)}`);
  const extra = (set, allowed) => [...set].filter((k) => !allowed.includes(k)).sort();
  const ownerLike = (set) => [...set].filter((k) => OWNER_KEY_RE.test(k)).sort();
  L.push(`- 응답 항목의 키(스키마, 값 아님) hsprc ${keysSeen.price.size}개 중 허용 외 ${extra(keysSeen.price, PRICE_FIELDS).length}개, 면적 ${keysSeen.area.size}개 중 허용 외 ${extra(keysSeen.area, AREA_FIELDS).length}개. 소유자 계열 패턴에 걸린 키: hsprc [${ownerLike(keysSeen.price)}], 면적 [${ownerLike(keysSeen.area)}]`);
  L.push(`- 허용 외 키 이름(C7 목록 갱신용): hsprc [${extra(keysSeen.price, PRICE_FIELDS)}]; 면적 [${extra(keysSeen.area, AREA_FIELDS)}]`);

  L.push("### (a) 호당 항목 수·값 일치(호·연도 단위)");
  const tot = A.groups[1] + A.groups[2] + A.groups["3+"];
  L.push(`- (호, stdDay 연도) 묶음 ${tot}개: 항목 1건 ${A.groups[1]}, 2건 ${A.groups[2]}, 3건 이상 ${A.groups["3+"]}`);
  L.push(`- 2건 묶음 중 값이 같은 것 ${A.equal2}/${A.groups[2]} (${pct(A.equal2, A.groups[2])}); crtnDay 차이: 같은 날 ${A.crtnSame}, 1~365일 ${A.crtnLe365}, 365일 초과 ${A.crtnGt365}, 날짜 없음 ${A.crtnMissing}`);
  L.push("### (b) 요청 범위 응답의 기준일(stdDay) 연도");
  L.push(`- 항목 ${A.items}건, stdDay 연도 분포 ${sortedObj(A.stdYears)}, crtnDay 연도 분포 ${sortedObj(A.crtnYears)}, hsprc 값이 비었거나 0인 항목 ${A.hsprcInvalid}`);
  L.push(`- 호 집합: 2025 기준 호 ${A.pk25}, 2026 기준 호 ${A.pk26}, 둘 다에 있는 호 ${A.both} (2026 호 중 ${pct(A.both, A.pk26)}가 2025에도 있음, 2025 호 중 ${pct(A.both, A.pk25)}가 2026에도 있음)`);
  L.push("### (c) 큰 단지의 실제 totalCount (지번 키 없이 값만)");
  L.push(`- 큰 단지 hsprc totalCount: ${dist(C.big.price)}; 면적 totalCount: ${dist(C.big.area)}`);
  L.push(`- 큰 단지 쪽 수 hsprc ${dist(C.big.pricePages)}; 면적 ${dist(C.big.areaPages)}; 쪽 상한(${MAX_PAGES_PER_PARCEL}쪽) 초과 여부는 쪽 수 최대가 그 값을 넘는지로 본다`);
  L.push(`- 일반 표본 hsprc totalCount ${dist(C.sample.price)}; 면적 totalCount ${dist(C.sample.area)}; 쪽 상한 초과 ${C.sample.truncated}지번`);
  L.push("### (d) 면적 응답의 쪽별 전유 행 분포");
  L.push(`- 쪽 구간별 [전체 행, 전유 행, 전유 비율]: ${JSON.stringify(Object.fromEntries(Object.entries(D.pages).map(([b, v]) => [b, [v.rows, v.expos, pct(v.expos, v.rows)]])))}`);
  L.push(`- 행 구분(전유공용/주부속) 분포 ${sortedObj(D.areaKinds)}`);
  L.push(`- 조기 종료 가능성: 2026 기준 호가 전유 행에 전부 나온 지번 ${D.early.allFound}/${D.early.parcels}; 전부 나온 쪽/전체 쪽 비율 ${dist(D.early.ratio.map((x) => Math.round(x * 100)))} (%); 면적 쪽 수 합 ${D.early.pagesAll} -> 조기 종료 시 ${D.early.pagesNeeded} (줄일 수 있는 면적 호출 ${pct(D.early.pagesAll - D.early.pagesNeeded, D.early.pagesAll)})`);
  L.push("### (e) 일 한도 단위 단서");
  const fl = client.st.firstLimitAt;
  L.push(`- 이번 탐색 호출: ${sortedObj(client.st.perOp)}. 한도·키 코드는 ${fl ? `${fl.calls}번째 호출(${fl.op})에서 처음 나옴, 그때까지 오퍼레이션별 ${sortedObj(fl.perOp)}, 코드 ${fl.code}` : "나오지 않았다(호출이 일 한도에 못 미침 - 단위 판단 불가)"}. ${limitProbe ? `이어서: ${limitProbe}.` : ""} 같은 날 다른 시험·수집의 호출은 이 수에 없다.`);
  L.push("### (f) 서울 전체 투영 호출 수 (일반 표본 기준, 큰 단지 별도 표본은 제외)");
  const per = C.sample.pricePages.map((p, i) => p + C.sample.areaPages[i]);
  if (per.length >= 2) {
    const m = mean(per); const se = sd(per) / Math.sqrt(per.length); const n = order.length;
    L.push(`- 지번당 호출(hsprc 쪽 + 면적 쪽, 쪽 상한 지번은 상한 쪽 수 미반영) ${dist(per)}; 표준오차 ${se.toFixed(2)}`);
    L.push(`- 대상 ${n}지번 투영 총 ${Math.round(m * n)}회 (95% 범위 약 ${Math.round((m - 1.96 * se) * n)}~${Math.round((m + 1.96 * se) * n)}회) = 하루 ${dailyBudget}회 기준 약 ${(m * n / dailyBudget).toFixed(1)}일(범위 ${((m - 1.96 * se) * n / dailyBudget).toFixed(1)}~${((m + 1.96 * se) * n / dailyBudget).toFixed(1)}일). 30일분(30만 회) 초과 여부: ${m * n > 300000 ? "초과" : "이하"}`);
    const saveRatio = D.early.pagesAll > 0 ? (D.early.pagesAll - D.early.pagesNeeded) / D.early.pagesAll : 0;
    const areaMean = mean(C.sample.areaPages);
    L.push(`- 면적 조기 종료를 쓰면(위 (d) 비율 적용) 지번당 약 ${(m - areaMean * saveRatio).toFixed(1)}회 -> 총 ${Math.round((m - areaMean * saveRatio) * n)}회. 본 수집에는 아직 조기 종료가 없다.`);
    L.push(`- 이 표본이 지번 ${per.length}개라 이틀치(약 ${Math.round(2 * dailyBudget / m)}지번) 표본보다 작으면 오차가 크다. 표본이 모자라면 본 수집의 일일 요약(투영)이 같은 수치를 매일 갱신한다.`);
  } else L.push("- 표본이 부족해 계산하지 못했다.");
  L.push("### (g) 면적 pageNo 3자리 시험 (큰 단지 중 면적 쪽 수 최대 지번, 지번 키 없이 숫자만)");
  if (!pageProbe) L.push("- 시험하지 못했다(큰 단지를 받지 못했거나 중단됨).");
  else {
    L.push(`- 시험 지번의 면적 쪽 수 ${pageProbe.pages}${pageProbe.pages >= 1000 ? "" : " (1,000쪽 미만이라 빈 응답과 거절을 쪽 번호로는 구분하지 못한다 - 결과코드·HTTP로만 본다)"}`);
    for (const x of pageProbe.results) {
      if (x.error) { L.push(`- pageNo=${x.pageNo}: 요청하지 못함(${x.error})`); continue; }
      const verdict = x.http !== 200 || x.code !== "00" ? "거절 의심(HTTP 200·결과코드 00이 아님)" : x.items > 0 ? "정상(항목 있음)" : pageProbe.pages >= x.pageNo ? "빈 응답인데 그 쪽이 있어야 한다(거절로 본다)" : "빈 응답(그 쪽이 없는 지번이라 정상 범위 밖)";
      L.push(`- pageNo=${x.pageNo}: HTTP ${x.http}, 결과코드 ${x.code}${x.nonJson ? "(JSON 아님)" : ""}, 항목 ${x.items}건, totalCount ${x.total} -> ${verdict}`);
    }
    L.push("- 1,000쪽이 거절이면 상한을 올려도 999쪽 넘는 지번은 받지 못한다 -> 후속: 면적을 dongNm별로 나눠 받는다(PR-A2).");
  }
  return { lines: L, calls, fatal: Boolean(fatal) };
}
