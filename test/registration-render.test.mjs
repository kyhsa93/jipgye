// 해제·등기 장의 「신고가 거래는 등기까지 갔나」 절(#715 PR2). 문장·표는 registration-view 가 두 언어로 만들고, 장은 굽고(ko) 언어 전환 때 고르기만 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REGISTRATION_HEADING, registrationView } from "../scripts/registration-view.ts";
import { loadPage } from "./helpers/digest-page.mjs";
import { sitePath } from "./helpers/site-root.mjs";

const group = (n, registered, cancelled, neither) => ({
  n,
  registered: 0,
  cancelled: 0,
  neither: 0,
  registeredShare: registered,
  cancelledShare: cancelled,
  neitherShare: neither,
  medianDays: 80,
  p90Days: 120,
});
const payload = (records) => {
  const p = {
    basis: { matureShare: 0.8, minDeals: 100, minRecords: 100, record: { prior: 3, spanDays: 180 }, interval: 0.9 },
    corrections: { reportedCancellations: 50, removed: 40 },
    matureMonths: ["2024-11", "2024-12", "2025-01"],
    pending: [{ month: "2025-02", deals: 10 }, { month: "2025-03", deals: 5 }],
    seoul: { ...group(1000, 96, 1.5, 2.5), medianDays: 81, p90Days: 123 },
    districts: [],
    records,
  };
  return { ...p, view: registrationView(p) };
};
const RECORDS = {
  minN: 100,
  enough: true,
  record: group(300, 96.6, 0.7, 2.6),
  rest: group(500, 95.2, 1, 3.8),
  diff: {
    registered: { diff: 1.4, lo: 1.1, hi: 1.7, verdict: "higher" },
    cancelled: { diff: -0.3, lo: -0.4, hi: -0.1, verdict: "lower" },
    neither: { diff: -1.1, lo: -1.4, hi: 0.2, verdict: "none" },
  },
  unclassified: 200,
};
const P = payload(RECORDS);
const V = P.view;
const SUB_NAV = ["all", "sale", "jeonse", "wolse", "search", "conversion", "renewal", "cancelled"];

test("문장: 해제율 비교는 90% 구간과 함께, 등기 일수 p90 한 문장, 사유는 모른다고 하고 허위·거짓을 말하지 않는다", () => {
  assert.match(V.lead.ko, /신고가 거래 300건 가운데 0\.7%가 나중에 해제됐고 나머지 거래 500건은 1%였습니다\(차이 -0\.3%p, 90% 구간 -0\.4~-0\.1%p\)/);
  assert.match(V.lead.ko, /중간값 81일, 열에 아홉은 123일 안/);
  assert.match(V.lead.en, /within 123 days for nine in ten/);
  assert.match(V.note.ko, /이유를 알 수 없고/);
  assert.match(V.note.ko, /접수일인지 완료일인지는 확인하지 않았습니다/);
  assert.match(V.note.ko, /2025년 2월~2025년 3월은 아직 확정 전/);
  assert.match(V.note.ko, /두 무리 모두 100건 이상/);
  for (const text of [V.heading.ko, V.lead.ko, V.note.ko, V.table.ko]) assert.ok(!/허위|거짓|띄우기/.test(text), text);
  for (const text of [V.heading.en, V.lead.en, V.note.en, V.table.en]) assert.ok(!/[가-힣]/.test(text), text);
});

test("표: 구분·거래 건수·등기일자 기록·해제·둘 다 없음 5열 3행, 구간이 0 을 품으면 「차이 없음」, 칸 수가 머리글과 같다(카드화 값 손실 없음)", () => {
  assert.match(V.table.ko, /^<thead><tr><th scope="col">구분<\/th><th scope="col">거래 건수<\/th><th scope="col">등기일자 기록<\/th><th scope="col">해제<\/th><th scope="col">둘 다 없음<\/th><\/tr><\/thead>/);
  assert.match(V.table.ko, /<tr><td>신고가<\/td><td>300<\/td><td>96\.6%<\/td><td>0\.7%<\/td><td>2\.6%<\/td><\/tr>/);
  assert.match(V.table.ko, /<td>-0\.3%p \(-0\.4~-0\.1\)<\/td><td>차이 없음 \(-1\.4~\+0\.2\)<\/td>/);
  assert.match(V.table.en, /No difference \(-1\.4~\+0\.2\)/);
  for (const html of [V.table.ko, V.table.en]) {
    const rows = html.match(/<tr>.*?<\/tr>/g);
    assert.equal(rows.length, 4);
    for (const row of rows) assert.equal((row.match(/<t[hd][ >]/g) ?? []).length, 5, row);
    assert.ok(!/colspan/.test(html));
  }
});

test("문턱 미달이면 표를 내지 않고 문장에 견주지 않는다고 적는다", () => {
  const thin = payload({ ...RECORDS, enough: false, record: null, rest: null, diff: {} });
  assert.equal(thin.view.table.ko, null);
  assert.match(thin.view.lead.ko, /문턱\(두 무리 모두 100건\)에 못 미쳐 견주지 않습니다/);
  assert.equal(registrationView({ matureMonths: [] }), null);
});

test("장: 구운 제목은 view 제목과 같고, 언어를 바꾸면 구운 영어 조각으로, 되돌리면 한국어로 바뀐다(표 caption 은 남긴다)", async () => {
  const html = await readFile(sitePath("cancelled-deals.html"), "utf8");
  assert.ok(html.includes(`<h2 id="reg-heading">${REGISTRATION_HEADING.ko}</h2>`));
  const en = html.match(/<template id="reg-en">([\s\S]*?)<\/template>\n/)?.[1] ?? "";
  const parts = [...en.matchAll(/<template data-for="([a-z-]+)">([\s\S]*?)<\/template>/g)];
  assert.deepEqual(parts.map((m) => m[1]), ["reg-heading", "reg-lead", "reg-table", "reg-note"]);
  const seed = { "reg-en": { content: { children: parts.map(([, id, inner]) => ({ dataset: { for: id }, innerHTML: inner })) } } };
  const cap = '<caption class="sr-only">c</caption>';
  for (const id of ["reg-heading", "reg-lead", "reg-note"]) seed[id] = { innerHTML: `${id}-ko`, querySelector: () => null };
  seed["reg-table"] = { innerHTML: `${cap}<tbody>ko</tbody>`, querySelector: () => ({ c: 1 }), prepend(c) { this.innerHTML = `${cap}${this.innerHTML}`; } };
  const page = await loadPage({ file: "cancelled-deals.html", data: {}, subNav: SUB_NAV, seed });
  assert.equal(page.html("reg-lead"), "reg-lead-ko");
  await page.click("lang-toggle");
  assert.equal(page.html("reg-heading"), REGISTRATION_HEADING.en);
  assert.ok(page.html("reg-table").startsWith(`${cap}<thead><tr><th scope="col">Group</th>`));
  assert.ok(!/[가-힣]/.test(en), "영어 조각에 한글이 없다");
  await page.click("lang-toggle");
  assert.equal(page.html("reg-table"), `${cap}<tbody>ko</tbody>`);
  assert.equal(page.html("reg-note"), "reg-note-ko");
});

test("굽기: 나가는 장에 절이 차 있고 구운 글자는 registration.json 숫자에서 다시 만든 것과 같으며, 단지·건별 필드가 없다", async () => {
  const html = await readFile(sitePath("cancelled-deals.html"), "utf8");
  const section = html.match(/<section id="reg-section"[\s\S]*?<\/section>/)?.[0] ?? "";
  for (const name of ["regLead", "regTable", "regNote", "regEn"]) {
    const frag = section.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1] ?? "";
    assert.ok(frag.length > 30, `${name} 가 비었다`);
  }
  const data = JSON.parse(await readFile(path.resolve(import.meta.dirname, "../docs/data/registration.json"), "utf8"));
  const view = registrationView(data);
  assert.ok(section.includes(view.table.ko) && section.includes(view.table.en), "구운 표가 숫자와 같다");
  assert.ok(!/aptNm|jibun|umdNm|"aptSeq"/.test(JSON.stringify(data)));
});
