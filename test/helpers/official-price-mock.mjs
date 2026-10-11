// 건축HUB API 모의 서버 (#68). 실제 호출 없이 official-price-api를 시험한다.
// 모든 값은 합성이다. 호 단위 값(호명·동명·PK·가격)은 FAKE_* 문자열이라 출력에 새면 시험이 잡는다.
import http from "node:http";

export const FAKE_KEY = "FAKEKEY-do-not-print-0xA1B2";
export const FAKE_OWNER = "가짜소유자-홍길동";

/** 지번 키 = `${sigunguCd}-${bjdongCd}-${bun}-${ji}` */
export const pkey = (t) => `${t.sigunguCd}-${t.bjdongCd}-${t.bun}-${t.ji}`;

/**
 * hogs: [{ id, area, flr, p2025, p2026, dup2026?: 값(두 번째 항목 값), dupCrtn?: 늦은 crtnDay }]
 * 반환: { hsprc: 항목[], area: 행[] } (응답 항목 원형, 허용 외 필드 포함)
 */
export function buildParcel(hogs, { ownerField = false } = {}) {
  const hsprc = [];
  const area = [];
  for (const h of hogs) {
    const pk = `FAKEPK-${h.id}`;
    const common = { dongNm: `가짜동-${h.id}`, hoNm: `가짜호-${h.id}`, bldNm: "가짜단지", platPlc: "가짜 주소", ...(ownerField ? { ownrNm: FAKE_OWNER } : {}) };
    if (h.p2025) hsprc.push({ ...common, mgmBldrgstPk: pk, hsprc: String(h.p2025), stdDay: "20250101", crtnDay: "20250301" });
    if (h.p2026) hsprc.push({ ...common, mgmBldrgstPk: pk, hsprc: String(h.p2026), stdDay: "20260101", crtnDay: "20260301" });
    if (h.dup2026) hsprc.push({ ...common, mgmBldrgstPk: pk, hsprc: String(h.dup2026), stdDay: "20260101", crtnDay: h.dupCrtn ?? "20260401" });
    area.push({ ...common, mgmBldrgstPk: pk, exposPubuseGbCd: "1", exposPubuseGbCdNm: "전유", mainAtchGbCd: "0", area: String(h.area), flrGbCd: "20", flrNo: String(h.flr) });
    area.push({ ...common, mgmBldrgstPk: pk, exposPubuseGbCd: "2", mainAtchGbCd: "0", area: "30", flrGbCd: "20", flrNo: "1" });
  }
  return { hsprc, area };
}

const envelope = (items, total, code = "00") => JSON.stringify({ response: { header: { resultCode: code, resultMsg: "OK" }, body: { items: items.length ? { item: items } : "", numOfRows: 100, pageNo: 1, totalCount: total } } });

/**
 * 서버를 연다. universe: Map<지번키, {hsprc, area}>. 옵션:
 *  limitAfter: 이 호출 수 뒤부터 XML 한도 코드 22, status401: 401, mutate(op, items, ctx)->items (응답을 일부러 망가뜨림),
 *  failKeys: Set<지번키> (그 지번은 결과코드 99), rejectPageAbove: 이 쪽 번호 초과는 결과코드 10,
 *  totalOf(op, key)->number (큰 단지 totalCount 흉내: 첫 쪽만 의미 있음)
 * 반환: { base, calls, close, log: [{op, key, page, hasRange}] }
 */
export async function startMock(universe, opts = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const op = u.pathname.split("/").pop();
    const q = u.searchParams;
    const key = `${q.get("sigunguCd")}-${q.get("bjdongCd")}-${q.get("bun")}-${q.get("ji")}`;
    const page = Number(q.get("pageNo"));
    log.push({ op, key, page, hasRange: q.has("startDate") && q.has("endDate"), start: q.get("startDate"), end: q.get("endDate"), serviceKey: q.get("serviceKey") });
    if (opts.status401) { res.statusCode = 401; res.end("denied"); return; }
    if (opts.limitAfter !== undefined && log.length > opts.limitAfter) { res.setHeader("content-type", "application/xml"); res.end("<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>"); return; }
    if (opts.failKeys?.has(key)) { res.setHeader("content-type", "application/json"); res.end(envelope([], 0, "99")); return; } // 그 지번만 일시 오류(결과코드 99)
    if (opts.rejectPageAbove !== undefined && page > opts.rejectPageAbove) { res.setHeader("content-type", "application/json"); res.end(envelope([], 0, "10")); return; } // pageNo 자릿수 거절 흉내
    const parcel = universe.get(key);
    let list = parcel ? (op === "getBrHsprcInfo" ? parcel.hsprc : parcel.area) : [];
    if (op === "getBrHsprcInfo" && q.has("startDate") === false) list = list; // 무필터는 그대로
    if (opts.mutate) list = opts.mutate(op, list, { key, page });
    let total = list.length;
    if (opts.totalOf) total = opts.totalOf(op, key) ?? total;
    const slice = list.slice((page - 1) * 100, page * 100);
    if (opts.dropOnPage2 && page === 2) slice.pop(); // 쪽 합 불일치
    res.setHeader("content-type", "application/json");
    res.end(envelope(slice, total));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, log, close: () => new Promise((r) => server.close(r)) };
}

/** 대상 지번 객체 */
export const target = (n, extra = {}) => ({ s: "11110", d: "가상동", j: String(n), sigunguCd: "11110", bjdongCd: "10100", bun: String(n).padStart(4, "0"), ji: "0000", saleDeals: 1, ...extra });
export const targetsOf = (ts) => new Map(ts.map((t) => [`${t.s}|${t.d}|${t.j}`, t]));
/** n호, 같은 면적·층 패턴 */
export const hogs = (n, base = 100, area = "84.97", offset = 0) => Array.from({ length: n }, (_, i) => ({ id: `${base}-${i + offset}`, area, flr: 1 + (i % 3), p2025: 300000000 + i * 1000, p2026: 320000000 + i * 1000 }));
