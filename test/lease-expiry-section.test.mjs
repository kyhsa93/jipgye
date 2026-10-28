// 전월세 만기 달력 절(#674 N2, renewal-vs-new.html #expiry)의 시험.
// 렌더된 장의 인라인 스크립트를 가짜 DOM(test/helpers/digest-page.mjs)에 올린 뒤, 같은 샌드박스에서 docs/lease-expiry.js 를 돌린다(renewal-convert 시험과 같은 방식).
// 요구권 문구(#ex-legal)는 범위를 「표시가 있는 계약」·「한 번 쓸 수 있다」로 한정했다 - legal 확인 대상(#674, 문구를 바꾸면 legal 재확인).
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { FOOTERS } from "../scripts/source-lines.ts";
import { loadPage, stubElement } from "./helpers/digest-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const JS = await readFile(path.join(root, "docs/lease-expiry.js"), "utf8");
const HTML = await readFile(path.join(root, SITE, "renewal-vs-new.html"), "utf8");
const SECTION = HTML.slice(HTML.indexOf('<section id="expiry"'), HTML.indexOf('<section id="lead-section"'));

const FACTS = { updatedAt: "2026-10-24T00:00:00Z", slugs: { 강남구: "gangnam" }, table: [{ district: "강남구", gapMedian: null, gapMatched: 1, rightUsed: 1 }] };
const MONTHS = ["202611", "202612", "202701", "202702", "202703", "202704", "202705", "202706", "202707", "202708", "202709", "202710"];
const row = (t, j, w, u) => ({ t, j, w, u });
const EXPIRY = {
  updatedAt: "2026-10-26T00:00:00Z",
  months: MONTHS,
  filed: ["202411", "202610"],
  partial: MONTHS.slice(0, 3),
  capture: [28, 56, 84],
  seoul: row(
    [4874, 10546, 15192, 31408, 22900, 20266, 20487, 20344, 20736, 22709, 20249, 19351],
    [2236, 4850, 7931, 16819, 12634, 11306, 11948, 11200, 11582, 12742, 10890, 10739],
    [2638, 5696, 7261, 14589, 10266, 8960, 8539, 9144, 9154, 9967, 9359, 8612],
    [694, 1572, 2204, 4915, 4362, 3853, 4306, 3893, 4133, 4539, 3501, 4419]
  ),
  districts: {
    종로구: { ...row([42, 107, 159, 349, 192, 148, 168, 200, 189, 229, 238, 199], [11, 32, 57, 143, 84, 63, 81, 103, 88, 83, 81, 76], [31, 75, 102, 206, 108, 85, 87, 97, 101, 146, 157, 123], [null, 15, 19, 40, 32, 21, 41, 23, 25, 36, 38, 45]), missing: ["202501"] },
    강남구: row(Array(12).fill(500), Array(12).fill(300), Array(12).fill(200), Array(12).fill(100)),
  },
};

function seedFromHtml() {
  const seed = {};
  for (const m of SECTION.matchAll(/<(\w+)[^>]*\bid="(ex-[\w-]+)"[^>]*>([^<]*)/g)) {
    const attrs = Object.fromEntries([...m[0].matchAll(/(data-[\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const el = stubElement(attrs, m[2]);
    el.textContent = m[3];
    seed[m[2]] = el;
  }
  return seed;
}

async function open({ expiry = EXPIRY, locale = "ko" } = {}) {
  const data = { "renewal-facts": FACTS };
  if (expiry) data["lease-expiry"] = expiry;
  const page = await loadPage({ file: "renewal-vs-new.html", data, locale, seed: seedFromHtml() });
  new vm.Script(JS, { filename: "docs/lease-expiry.js" }).runInContext(page.sandbox);
  await page.settle();
  return page;
}
const pick = async (page, gu) => {
  page.byId("ex-gu").value = gu;
  page.byId("ex-gu").dispatch("change");
  await page.settle();
};
const rows = (page) => page.html("ex-table").split("<tr>").slice(2);

const NOTE_KO =
  "신고된 계약만 셉니다 — 미신고 계약과 계약기간이 비어 있는 신고(약 3%)는 빠집니다. 전세는 월세가 0원인 계약이고, 반전세는 월세에 넣었습니다. 만기는 이사나 매물과 같지 않습니다: 갱신(요구권·합의)이나 묵시적 갱신으로 그대로 살거나 중도에 해지하는 경우가 있어, 이 숫자는 끝나는 계약 수이지 나오는 집 수가 아닙니다. 뒤쪽 달도 아직 신고되지 않은 짧은 계약만큼 조금 적을 수 있습니다.";
const LEGAL_KO =
  "「요구권 사용」은 신고에 계약갱신요구권 사용 표시가 있는 계약입니다. 요구권은 한 번만 쓸 수 있습니다(주택임대차보호법 제6조의3). 표시가 없다고 요구권을 쓰지 않았다는 뜻은 아니며, 개별 계약에 무엇이 적용되는지는 이 화면이 판단하지 않습니다. 법률 판단이 아니니 대한법률구조공단·주택임대차분쟁조정위원회에서 상담하세요.";
const LEGAL_EN =
  "“Right used” means the filing is marked as renewed with the tenant’s contract renewal right. The right can be used only once (Housing Lease Protection Act, Article 6-3). An unmarked renewal does not mean the right was not used, and this page does not judge what applies to any lease. It is not legal advice — contact the Korea Legal Aid Corporation or a Housing Lease Dispute Mediation Committee.";
const PARTIAL_KO =
  "2026.11·2026.12·2027.01은 일부만 집계했습니다 — 원본이 최근 24개월 신고분뿐이라 이 달들에 끝나는 계약 가운데 약 28%·56%·84%만 잡혔습니다(2년 계약은 끝나기 24~27개월 전에 신고됩니다). 실제는 표보다 많습니다.";

test("자리: 전환 계산기 바로 아래·#lead-section 앞, 보이는 label·aria-live·출처 줄", () => {
  const ids = [...HTML.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(0, 5), ["check-section", "move", "convert", "expiry", "lead-section"]);
  assert.match(SECTION, /^<section id="expiry" class="tw:mb-10 tw:1024:mb-16">/);
  assert.ok(SECTION.includes('<label for="ex-gu" id="ex-gu-label" data-en="District">자치구</label><select id="ex-gu"></select>'));
  assert.match(SECTION, /<p class="lead" id="ex-answer" aria-live="polite" data-msg="[^"]+" data-msg-en="[^"]+"><\/p>/);
  for (const attr of ["data-msg", "data-msg-en"]) assert.equal(SECTION.match(new RegExp(`${attr}="([^"]*)"`))[1].split("|").length, 12, `${attr} 문구 12개`);
  assert.ok(SECTION.includes(`data-en="${FOOTERS.leaseExpiry.en}">${FOOTERS.leaseExpiry.ko}</p>`), "출처 줄이 source-lines 로 찍히지 않았다");
  assert.ok(SECTION.includes(`>${NOTE_KO}</p>`) && SECTION.includes(`>${LEGAL_KO}</p>`));
});

test("외부 JS 는 gzip ≤2,048B, renewal-vs-new 만 defer 로 한 번 읽고 서비스워커 사전캐시에 없다 (#681 예외)", async () => {
  const size = gzipSync(JS, { level: 9 }).length;
  assert.ok(size <= 2048, `docs/lease-expiry.js gzip ${size}B`);
  assert.equal(HTML.split('<script src="./lease-expiry.js" defer></script>').length, 2);
  assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes("lease-expiry"), "sw.js 사전캐시에 들어갔다");
  const users = [];
  for (const f of (await readdir(path.join(root, SITE))).filter((x) => x.endsWith(".html")).sort()) {
    if ((await readFile(path.join(root, SITE, f), "utf8")).includes("lease-expiry.js")) users.push(f);
  }
  assert.deepEqual(users, ["renewal-vs-new.html"]);
});

test("서울 기본: 답 한 문장(합계 n·다 잡힌 달 중 최다), 12행 표, 앞 석 달에 「일부만 집계」와 잡힌 몫", async () => {
  const page = await open();
  assert.match(page.html("ex-gu"), /^<option value="">서울 전체<\/option><option value="종로구">종로구<\/option>/);
  assert.equal(page.text("ex-answer"), "서울 전체: 2026.11~2027.10에 계약기간이 끝나는 신고 계약 229,062건. 다 잡힌 달 가운데 가장 많은 달은 2027.02(31,408건)입니다.");
  const r = rows(page);
  assert.deepEqual([...page.html("ex-table").matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((m) => m[1]), ["만기 달", "전체", "전세", "월세", "요구권 사용"]);
  assert.equal(r.length, 12);
  assert.match(page.html("ex-table"), /^<caption class="sr-only">전월세 계약은 언제 끝나나 \(2026\.11~2027\.10\)<\/caption>/);
  assert.match(page.html("ex-table"), /<thead><tr>(<th scope="col" style="white-space:normal">[^<]+<\/th>){5}<\/tr><\/thead>/);
  assert.match(r[0], /^<th scope="row">2026\.11<br><span class="low-sample" style="white-space:normal">일부만 집계<\/span><\/th><td>4,874<span aria-hidden="true"[^>]*width:16%"><\/span><\/td><td>2,236<\/td><td>2,638<\/td><td>694<\/td>/);
  assert.equal(r.filter((x) => x.includes("일부만 집계")).length, 3);
  assert.match(r[3], /width:100%/);
  assert.equal(page.text("ex-partial"), PARTIAL_KO);
});

test("구 고르기: 그 구 값, 5건 미만 칸은 「-」와 설명, 빈 원본 달은 적게 셌다고 알린다", async () => {
  const page = await open();
  await pick(page, "종로구");
  assert.equal(page.text("ex-answer"), "종로구: 2026.11~2027.10에 계약기간이 끝나는 신고 계약 2,220건. 다 잡힌 달 가운데 가장 많은 달은 2027.02(349건)입니다.");
  assert.match(rows(page)[0], /<td>-<\/td><\/tr>/);
  assert.equal(page.text("ex-partial"), `${PARTIAL_KO} 원본 신고월 1개가 비어 실제보다 적게 셌습니다. 「-」는 5건 미만이라 내지 않은 칸입니다.`);
  await pick(page, "강남구");
  // 값이 같으면 다 잡힌 달 가운데 맨 앞 - 앞 석 달(partial)은 최다 달로 고르지 않는다
  assert.match(page.text("ex-answer"), /가장 많은 달은 2027\.02\(500건\)/);
  assert.equal(page.text("ex-partial"), PARTIAL_KO);
  await pick(page, "없는구");
  assert.match(page.text("ex-answer"), /^서울 전체:/);
});

test("영어: 처음부터 en·언어 전환 왕복, 머리·고지·출처 줄도 따라간다", async () => {
  const page = await open({ locale: "en" });
  assert.equal(page.text("ex-heading"), "When leases end — the next 12 months");
  assert.equal(page.text("ex-source"), FOOTERS.leaseExpiry.en);
  assert.equal(page.text("ex-legal"), LEGAL_EN);
  assert.equal(page.text("ex-answer"), "All Seoul: 229,062 filed leases end between 2026.11 and 2027.10; among fully counted months, the most end in 2027.02 (31,408).");
  assert.match(rows(page)[1], /<span class="low-sample" style="white-space:normal">Partial<\/span>/);
  assert.match(page.text("ex-partial"), /^2026\.11, 2026\.12, 2027\.01 are partly counted: .* only about 28%, 56%, 84% of the leases ending then are captured/);
  await page.click("lang-toggle");
  assert.equal(page.text("ex-heading"), "전월세 계약은 언제 끝나나");
  assert.equal(page.text("ex-legal"), LEGAL_KO);
  assert.match(page.text("ex-answer"), /^서울 전체: /);
});

test("자료를 못 받으면 알리고 표를 그리지 않는다", async () => {
  const page = await open({ expiry: null });
  assert.equal(page.text("ex-answer"), "만기 자료를 불러오지 못했습니다.");
  assert.equal(page.html("ex-table"), "", "표를 그렸다");
});

test("고른 구는 URL 에 남지 않는다", async () => {
  const page = await open();
  await pick(page, "종로구");
  assert.equal(page.search(), "");
  assert.doesNotMatch(JS, /history|location|URLSearchParams|localStorage/);
});

test("금지어: 전망·권유·평균 표현이 없고, 만기 ≠ 이사·매물, 신고된 계약만, 법률 판단 아님 고지가 ko·en 으로 있다", () => {
  const text = SECTION + JS;
  assert.doesNotMatch(text, /평균|전망|예측|average|forecast|outlook|predict/i);
  assert.doesNotMatch(text, /5% 상한이 없|상한이 적용되지 않|받아들이세요|요구하세요|위법|불법|no 5% cap|illegal/);
  assert.match(SECTION, /만기는 이사나 매물과 같지 않습니다/);
  assert.match(SECTION, /A lease ending is not a move or a listing/);
  assert.match(SECTION, /신고된 계약만 셉니다/);
  assert.match(SECTION, /Only filed leases are counted/);
  assert.match(SECTION, /법률 판단이 아니니/);
  assert.match(SECTION, /It is not legal advice/);
  // #696 legal: 제6조의3② 「1회에 한하여」 - 한도를 분명히, 신고 표시를 사실로 단정하지 않는다
  assert.match(SECTION, /한 번만 쓸 수 있습니다/);
  assert.match(SECTION, /can be used only once/);
  assert.doesNotMatch(SECTION, /곧 요구권으로 갱신한 계약/);
});
