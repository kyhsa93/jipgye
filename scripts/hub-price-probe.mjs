// 임시 시험용(시험 후 삭제). 건축HUB 건축물대장 주택가격(getBrHsprcInfo, data.go.kr 15134735)이 공시가격 대체 공급원이
// 되는지 표본 지번으로 재 본다. 규격: 활용가이드 8) 주택가격 조회(확인일 2026-10-11) - 필수 sigunguCd·bjdongCd, 옵션 platGbCd·bun·ji·numOfRows·pageNo.
//
// 출력은 집계뿐이다. 응답 원문·호 단위 값·지번별 줄·키·URL은 어떤 경로로도 stdout·stderr·파일에 내지 않는다(소유자 조건 C1).
// 응답은 받자마자 숫자 집계로 줄이고 버린다. 오류는 이름·HTTP 상태·공공데이터포털 결과코드(숫자)만 남긴다 - err.message는 쓰지 않는다.
// 호출은 초당 1회 이하, 재시도 없음. 연속 5회 실패 또는 한도·키 오류 코드면 즉시 멈춘다.
import { readFileSync } from "node:fs";

const ENDPOINT = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrHsprcInfo";
const PAGE_SIZE = 100;
const MIN_GAP_MS = 1100;
const DEV_DAILY_LIMIT = 10000; // 개발계정 신청 가능 트래픽(15134735 페이지, 확인일 2026-10-11). 운영계정은 활용사례 등록 시 증량 신청.
const STOP_CODES = new Set(["22", "30", "31", "32", "33"]); // 22 한도 초과, 30~33 키 오류(가이드 에러코드표)

function normalizeKey(raw) {
  let k = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (/%[0-9A-Fa-f]{2}/.test(k)) { try { k = decodeURIComponent(k); } catch { /* 그대로 */ } }
  return k;
}
const key = normalizeKey(process.env.PUBLIC_DATA_PORTAL_API_KEY);
if (!key) { console.error("PUBLIC_DATA_PORTAL_API_KEY 시크릿이 비어 있다. 호출하지 않고 종료한다."); process.exit(1); }

const { meta, sample: all } = JSON.parse(readFileSync(new URL("../research/hub-price-probe/sample.json", import.meta.url), "utf8"));
const maxCalls = Math.max(1, Math.min(Number(process.env.MAX_CALLS) || all.length, all.length, 60));
const sample = all.slice(0, maxCalls);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, b) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
const quant = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const stat = { calls: 0, ok: 0, fail: 0, errCodes: {}, httpStatus: {}, latency: [], bytes: [], totalCounts: [], itemsSeen: 0, hsprcFilled: 0, hsprcZeroOrBad: 0,
  stdYear: {}, kind: {}, gb: {}, jibunWithItems: 0, jibunWithPrice: 0, jibunMultiPrice: 0, jibunTruncated: 0, pagesNeeded: [], bldNmFilled: 0, crtnYear: {}, shape: {} };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

function extract(text) {
  try {
    const body = JSON.parse(text)?.response;
    if (body?.header) {
      const raw = body.body?.items;
      const item = raw && typeof raw === "object" ? raw.item : undefined;
      const items = Array.isArray(item) ? item : item && typeof item === "object" ? [item] : [];
      return { code: String(body.header.resultCode ?? ""), total: Number(body.body?.totalCount ?? 0), items };
    }
  } catch { /* JSON이 아님 - 포털 게이트웨이 오류는 XML로 온다 */ }
  const code = /<(?:returnReasonCode|resultCode)>\s*(\d+)\s*</.exec(text)?.[1] ?? "?";
  return { code, total: 0, items: [], nonJson: true };
}

let consecutiveFail = 0;
let stoppedBy = null;
for (const s of sample) {
  if (consecutiveFail >= 5) { stoppedBy = "연속 실패 5회"; break; }
  const qs = `sigunguCd=${s.sigunguCd}&bjdongCd=${s.bjdongCd}&platGbCd=0&bun=${s.bun}&ji=${s.ji}&numOfRows=${PAGE_SIZE}&pageNo=1&_type=json&serviceKey=${encodeURIComponent(key)}`;
  const t0 = Date.now();
  stat.calls += 1;
  let text = "";
  try {
    const res = await fetch(`${ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(20000) });
    bump(stat.httpStatus, res.status);
    text = await res.text();
    stat.latency.push(Date.now() - t0);
    stat.bytes.push(Buffer.byteLength(text));
    if (!res.ok) throw Object.assign(new Error("http"), { tag: `HTTP ${res.status}` });
  } catch (e) {
    stat.fail += 1; consecutiveFail += 1;
    bump(stat.errCodes, e?.tag ?? `${e?.name ?? "Error"}/${e?.cause?.code ?? "-"}`); // 메시지·URL은 쓰지 않는다
    await sleep(MIN_GAP_MS);
    continue;
  }
  const r = extract(text);
  text = ""; // 원문 버림
  if (r.code !== "00") {
    stat.fail += 1; consecutiveFail += 1; bump(stat.errCodes, `resultCode ${r.code}`);
    if (STOP_CODES.has(r.code)) { stoppedBy = `결과코드 ${r.code}`; break; }
    await sleep(MIN_GAP_MS);
    continue;
  }
  consecutiveFail = 0; stat.ok += 1;
  stat.totalCounts.push(r.total);
  stat.pagesNeeded.push(Math.max(1, Math.ceil(r.total / PAGE_SIZE)));
  if (r.total > r.items.length) stat.jibunTruncated += 1;
  if (r.items.length) stat.jibunWithItems += 1;
  const prices = new Set();
  let priced = 0;
  for (const it of r.items) {
    stat.itemsSeen += 1;
    const v = Number(String(it.hsprc ?? "").trim());
    if (String(it.hsprc ?? "").trim() !== "" && Number.isFinite(v) && v > 0) { stat.hsprcFilled += 1; priced += 1; prices.add(v); } else stat.hsprcZeroOrBad += 1;
    bump(stat.stdYear, String(it.stdDay ?? "").trim().slice(0, 4) || "(빈값)");
    bump(stat.crtnYear, String(it.crtnDay ?? "").trim().slice(0, 4) || "(빈값)");
    bump(stat.kind, String(it.regstrKindCdNm ?? "").trim() || "(빈값)");
    bump(stat.gb, String(it.regstrGbCdNm ?? "").trim() || "(빈값)");
    if (String(it.bldNm ?? "").trim()) stat.bldNmFilled += 1;
  }
  if (priced) stat.jibunWithPrice += 1;
  if (prices.size > 1) stat.jibunMultiPrice += 1;
  await sleep(MIN_GAP_MS);
}

const meanPages = stat.pagesNeeded.length ? stat.pagesNeeded.reduce((a, b) => a + b, 0) / stat.pagesNeeded.length : null;
const lines = [];
const L = (s = "") => lines.push(s);
L("## 건축HUB 주택가격(getBrHsprcInfo) 표본 시험 - 집계만");
L(`- 표본: ${sample.length}지번(대상 지번 기준 커밋 ${meta.commit}), 호출 ${stat.calls}회(성공 ${stat.ok}, 실패 ${stat.fail})${stoppedBy ? `, 중단: ${stoppedBy}` : ""}`);
if (stat.fail) L(`- 실패 분류: ${JSON.stringify(stat.errCodes)}, HTTP 상태: ${JSON.stringify(stat.httpStatus)}`);
L(`- 각 호출은 첫 쪽(numOfRows ${PAGE_SIZE})만 받았다. 아래 채움률·분포는 받은 항목(${stat.itemsSeen}건) 기준이고 지번의 전체가 아니다.`);
L("### (a) 공시가격(hsprc) 채움률");
L(`- 항목 단위: ${stat.hsprcFilled}/${stat.itemsSeen} (${pct(stat.hsprcFilled, stat.itemsSeen)}), 비었거나 0·비숫자 ${stat.hsprcZeroOrBad}`);
L(`- 지번 단위: 항목이 있는 지번 ${stat.jibunWithItems}/${stat.ok}, 그중 값이 있는 지번 ${stat.jibunWithPrice} (${pct(stat.jibunWithPrice, stat.ok)})`);
L("### (b) 기준일자(stdDay) 연도 분포 (건수)");
L(`- ${JSON.stringify(Object.fromEntries(Object.entries(stat.stdYear).sort()))}`);
L(`- 생성일자(crtnDay) 연도: ${JSON.stringify(Object.fromEntries(Object.entries(stat.crtnYear).sort()))}`);
L("### (c) 단지·호 단위 응답 여부 (구분 코드명 분포, 건수)");
L(`- 대장종류(regstrKindCdNm): ${JSON.stringify(stat.kind)}`);
L(`- 대장구분(regstrGbCdNm): ${JSON.stringify(stat.gb)}`);
L(`- 건물명 채움 ${stat.bldNmFilled}/${stat.itemsSeen}; 한 지번 안에서 서로 다른 값이 둘 이상인 지번 ${stat.jibunMultiPrice}/${stat.jibunWithPrice} (호·동별로 값이 다르면 호 단위)`);
L(`- 한 지번의 항목 수(totalCount) 분포: 최소 ${quant(stat.totalCounts, 0)} / 중앙 ${quant(stat.totalCounts, 0.5)} / p90 ${quant(stat.totalCounts, 0.9)} / 최대 ${quant(stat.totalCounts, 1)}; 첫 쪽에 다 안 담긴 지번 ${stat.jibunTruncated}/${stat.ok}`);
L("### (d) 응답 크기·지연");
L(`- 지연(ms): p50 ${quant(stat.latency, 0.5)} / p95 ${quant(stat.latency, 0.95)} / 최대 ${quant(stat.latency, 1)} (가이드 평균응답 500ms, 최대 30tps)`);
L(`- 응답 바이트: p50 ${quant(stat.bytes, 0.5)} / p95 ${quant(stat.bytes, 0.95)} / 최대 ${quant(stat.bytes, 1)}`);
L("### (e) 서울 전체 대상 지번 호출 수 대 일일 한도");
const tgtSale = meta.targetJibunSale; const tgtAll = meta.targetJibunSaleOrRent;
if (meanPages) {
  for (const [label, n] of [["매매 지번", tgtSale], ["매매+전월세 지번", tgtAll]]) {
    const calls = Math.ceil(n * meanPages);
    L(`- ${label} ${n}개 x 지번당 평균 ${meanPages.toFixed(2)}쪽(쪽 크기 ${PAGE_SIZE}) = 약 ${calls}회 / 개발계정 일 ${DEV_DAILY_LIMIT}회 = ${(calls / DEV_DAILY_LIMIT).toFixed(2)}일분 (초당 1회면 약 ${(calls / 3600).toFixed(1)}시간)`);
  }
  L(`- 표본 평균 쪽 수는 표본 ${stat.ok}개 지번의 평균이라 불확실하다. 쪽 크기를 키우면(numOfRows는 VARCHAR(3)) 호출 수가 줄 수 있으나 이 시험은 ${PAGE_SIZE}만 써 봤다.`);
} else L("- 성공 호출이 없어 계산하지 못했다.");
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import("node:fs"); appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`); }
process.exit(stat.ok === 0 ? 1 : 0);
