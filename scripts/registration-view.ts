/**
 * 해제·등기 장의 「신고가 거래는 등기까지 갔나」 절(R1 PR2, #715). registration.json 에서 문장·표를 두 언어로 만든다.
 *
 * 순수 모듈이다. 숫자는 registration.ts 가 센 것을 그대로 쓰고 새로 세지 않는다. 빌드(prerender) 때 한국어는 제자리에,
 * 영어는 같은 장의 <template id="reg-en"> 에 굽는다 - 언어를 바꾸면 거기서 고르기만 한다(json 칸·fetch 추가 0).
 *
 * - 신고가 vs 나머지 표 1개와 서울 등기 일수 p90 한 문장만. 구별 미등기율·완료 곡선·가격대 일수는 이 장에 이미 있다.
 * - 「등기일자 기록」은 국토부 항목 「등기일자」(rgstDate) 칸이 채워진 거래까지만 - 접수·완료를 말하지 않는다.
 * - 「둘 다 없음」의 사유는 모른다. 허위·거짓 신고로 단정하는 말은 쓰지 않는다.
 * - 차이의 90% 구간이 0 을 품으면 「차이 없음」. 두 무리 중 하나라도 문턱 미달이면 표 대신 「데이터 없음」.
 * - 단지명·건별 값은 없다(입력에도 없다).
 */

/** 절 제목. 화면(cancelled-deals.html)에 구운 한국어와 같아야 한다 - 시험이 대조한다. */
export const REGISTRATION_HEADING = { ko: "신고가 거래는 등기까지 갔나", en: "Did record-high deals reach registration?" };

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2024-11" → 「2024년 11월」 / "Nov 2024". */
const ym = (m, en) => (en ? `${MONTHS_EN[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`);
const signed = (v) => `${v > 0 ? "+" : ""}${v}`;
const num = (v, en) => Number(v).toLocaleString(en ? "en-US" : "ko-KR");

/** 차이 칸: 「-0.3%p (-0.4~-0.1)」, 구간이 0 을 품으면 「차이 없음 (…)」. */
function diffCell(d, en) {
  if (!d) return en ? "No data" : "데이터 없음";
  const range = `(${signed(d.lo)}~${signed(d.hi)})`;
  return d.verdict === "none" ? `${en ? "No difference" : "차이 없음"} ${range}` : `${signed(d.diff)}%p ${range}`;
}

const span = (p, en) => `${ym(p.matureMonths[0], en)}~${ym(p.matureMonths.at(-1), en)}`;
const ready = (p) => p?.matureMonths?.length && p.records?.enough && p.records.record && p.records.rest;

/** 첫 문단: 신고가 vs 나머지 해제율(90% 구간)과 등기일자 비율, 서울 등기 일수 중간값·p90 한 문장. */
export function registrationLead(p, locale = "ko") {
  if (!p?.matureMonths?.length) return null;
  const en = locale === "en";
  const s = p.seoul;
  const days =
    s?.medianDays != null && s?.p90Days != null
      ? en
        ? ` Across Seoul, the registration date came a median ${s.medianDays} days after the contract, and within ${s.p90Days} days for nine in ten.`
        : ` 서울 전체로는 계약에서 등기일자까지 중간값 ${s.medianDays}일, 열에 아홉은 ${s.p90Days}일 안이었습니다.`
      : "";
  if (!ready(p)) {
    const head = en
      ? `Contracts from ${span(p, en)}: too few record-high deals to compare (at least ${p.records?.minN ?? p.basis?.minRecords} in each group), so no comparison is shown.`
      : `${span(p, en)} 계약은 신고가 거래가 문턱(두 무리 모두 ${p.records?.minN ?? p.basis?.minRecords}건)에 못 미쳐 견주지 않습니다.`;
    return head + days;
  }
  const { record: a, rest: b, diff } = p.records;
  const c = diff.cancelled;
  const cancelText = !c
    ? ""
    : c.verdict === "none"
      ? en
        ? ` — no clear difference (90% range ${signed(c.lo)}~${signed(c.hi)}%p)`
        : ` — 차이가 뚜렷하지 않습니다(90% 구간 ${signed(c.lo)}~${signed(c.hi)}%p)`
      : en
        ? ` (difference ${signed(c.diff)}%p, 90% range ${signed(c.lo)}~${signed(c.hi)}%p)`
        : `(차이 ${signed(c.diff)}%p, 90% 구간 ${signed(c.lo)}~${signed(c.hi)}%p)`;
  return en
    ? `For contracts from ${span(p, en)}, ${a.cancelledShare}% of ${num(a.n, en)} record-high deals — above the earlier top price for the same complex and unit size — were later cancelled, against ${b.cancelledShare}% of the other ${num(b.n, en)}${cancelText}. A registration date was on file for ${a.registeredShare}% of record-high deals and ${b.registeredShare}% of the rest.${days}`
    : `${span(p, en)} 계약만 보면, 같은 단지·같은 면적의 그 전 최고가를 넘은 신고가 거래 ${num(a.n, en)}건 가운데 ${a.cancelledShare}%가 나중에 해제됐고 나머지 거래 ${num(b.n, en)}건은 ${b.cancelledShare}%였습니다${cancelText}. 등기일자가 기록된 비율은 신고가 ${a.registeredShare}%, 나머지 ${b.registeredShare}%입니다.${days}`;
}

/** 표: 구분·거래 건수·등기일자 기록·해제·둘 다 없음. 차이 줄은 칸 안에 90% 구간을 함께 둔다(좁은 화면 카드에서도 남게). */
export function registrationTableHtml(p, locale = "ko") {
  if (!ready(p)) return null;
  const en = locale === "en";
  const head = en
    ? ["Group", "Deals", "Registration date on file", "Cancelled", "Neither"]
    : ["구분", "거래 건수", "등기일자 기록", "해제", "둘 다 없음"];
  const keys = ["registered", "cancelled", "neither"];
  const { record: a, rest: b, diff } = p.records;
  const row = (label, r) =>
    `<tr><td>${label}</td><td>${num(r.n, en)}</td>${keys.map((k) => `<td>${r[`${k}Share`]}%</td>`).join("")}</tr>`;
  const diffRow =
    `<tr><td>${en ? "Difference (90% range)" : "차이(90% 구간)"}</td><td>-</td>` +
    keys.map((k) => `<td>${diffCell(diff[k], en)}</td>`).join("") +
    "</tr>";
  return (
    `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${row(en ? "Record high" : "신고가", a)}${row(en ? "Other deals" : "나머지", b)}${diffRow}</tbody>`
  );
}

/** 표 아래 단서: 정의·사유 모름·문턱·뺀 것·확정 전 달. */
export function registrationNote(p, locale = "ko") {
  if (!p?.matureMonths?.length) return null;
  const en = locale === "en";
  const prior = p.basis?.record?.prior;
  const spanDays = p.basis?.record?.spanDays;
  const minN = p.records?.minN ?? p.basis?.minRecords;
  const pending = p.pending?.length ? `${ym(p.pending[0].month, en)}~${ym(p.pending.at(-1).month, en)}` : null;
  const unclassified = p.records?.unclassified;
  const removed = p.corrections?.removed;
  return en
    ? `"Registration date on file" means the registration date (rgstDate) field in the Ministry of Land's transaction data is filled in; whether that date marks filing or completion has not been confirmed. "Neither" means a deal with no cancellation and no registration date; the data gives no reason, so why is unknown, and it does not mean the filing was false. ` +
        `A record high follows the record-high screen's rule: above the earlier top among at least ${prior} uncancelled brokered deals spanning ${spanDays}+ days in the same complex and unit size. ` +
        `${unclassified != null ? `${num(unclassified, en)} deals with too short a history to classify are left out. ` : ""}${removed != null ? `${num(removed, en)} cancellation filings that were rewrites of the same contract are removed first. ` : ""}` +
        `Groups are compared only when each has at least ${minN} deals; when the 90% range includes 0 it reads "No difference". ` +
        `Only months where at least ${Math.round((p.basis?.matureShare ?? 0.8) * 100)}% of contracts have a registration date count.${pending ? ` ${pending} is not final yet and is left out.` : ""}`
    : `「등기일자 기록」은 국토교통부 실거래 자료의 「등기일자」(rgstDate) 칸이 채워진 거래입니다 - 그 날짜가 접수일인지 완료일인지는 확인하지 않았습니다. 「둘 다 없음」은 해제도 등기일자도 없는 거래로, 자료에 사유가 없어 이유를 알 수 없고 신고 내용이 사실과 다르다는 뜻도 아닙니다. ` +
        `신고가는 신고가 화면과 같은 규칙입니다 - 같은 단지·같은 면적에서 해제 안 된 중개거래가 ${prior}건 이상·${spanDays}일 이상 쌓인 뒤 그 전 최고가를 넘은 거래. ` +
        `${unclassified != null ? `이력이 짧아 어느 쪽으로도 가르지 못한 ${num(unclassified, en)}건은 뺐습니다. ` : ""}${removed != null ? `같은 계약을 고쳐 쓴 해제 신고 ${num(removed, en)}건은 먼저 뺐습니다. ` : ""}` +
        `두 무리 모두 ${minN}건 이상일 때만 견주고, 90% 구간이 0을 품으면 「차이 없음」으로 적습니다. ` +
        `계약의 ${Math.round((p.basis?.matureShare ?? 0.8) * 100)}% 이상이 등기일자를 가진 달만 셉니다.${pending ? ` ${pending}은 아직 확정 전이라 넣지 않았습니다.` : ""}`;
}

/** 두 언어 글자 묶음. 익은 달이 없으면 null. */
export function registrationView(p) {
  if (!p?.matureMonths?.length) return null;
  const both = (fn) => ({ ko: fn(p, "ko"), en: fn(p, "en") });
  return {
    heading: REGISTRATION_HEADING,
    lead: both(registrationLead),
    table: both(registrationTableHtml),
    note: both(registrationNote),
  };
}

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** <template id="reg-en"> 의 속: 자리(id)마다 영어 조각 하나. 표는 thead·tbody 만 - 안쪽 <template> 이라 표 훑개·카드화가 건드리지 않는다. */
export function registrationEnHtml(view) {
  if (!view?.lead?.en) return null;
  const parts = [
    ["reg-heading", esc(view.heading.en)],
    ["reg-lead", esc(view.lead.en)],
    ["reg-table", view.table.en ?? ""],
    ["reg-note", esc(view.note.en)],
  ];
  return parts.map(([id, html]) => `<template data-for="${id}">${html}</template>`).join("");
}
