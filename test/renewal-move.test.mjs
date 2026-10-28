// 재계약 vs 이사 비교 절(#777, renewal-vs-new.html #move)의 시험.
// 계산은 docs/move-cost.js 한 벌이고 화면(docs/renewal-move.js)과 이 시험이 같은 함수를 부른다 - 그래서 "화면 = 계산 모듈"은
// 화면 문장·표의 금액을 같은 입력의 compare() 결과에서 다시 만들어 맞대는 것으로 본다. 문구는 장의 #mv-answer data-msg(ko)·data-msg-en
// (장 전용 외부 JS gzip ≤2KB, #681) - 구운 장에서 그대로 읽어 세운다. 계산 가정(대출 80%·세율 15.4%·금리 지연)은 원래 모듈과 대조한다.
// 사례 숫자는 data-analyst 가 #777 에서 손으로 낸 값(2026-10-28 대표값)을 입력으로만 쓴다 - 실데이터 파일은 읽지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { LOAN_LTV, monthlyCost } from "../scripts/conversion.ts";
import { TAX_RATE } from "../scripts/interest.ts";
import { MONTHLY_LAG } from "../scripts/check-data-progress.ts";
import { FOOTERS } from "../scripts/source-lines.ts";
import { stripJsComments } from "../scripts/strip-inline-comments.ts";
import { loadPage, stubElement } from "./helpers/digest-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const CALC = await readFile(path.join(root, "docs/move-cost.js"), "utf8");
const JS = await readFile(path.join(root, "docs/renewal-move.js"), "utf8");
const HTML = await readFile(path.join(root, SITE, "renewal-vs-new.html"), "utf8");
const SECTION = HTML.slice(HTML.indexOf('<section id="move"'), HTML.indexOf('<section id="convert"'));

await import("../docs/move-cost.js");
const { compare, describe, LTV, TAX } = globalThis.jipgyeMoveCost;
const MSG = (lang) => SECTION.match(new RegExp(`${lang === "en" ? "data-msg-en" : "data-msg"}="([^"]*)"`))[1].split("|");

const FACTS = { updatedAt: "2026-10-24T00:00:00Z", slugs: { 송파구: "songpa" }, table: [{ district: "송파구", gapMedian: null, gapMatched: 1, rightUsed: 1 }] };
const CONVERSION = { updatedAt: "2026-10-28T02:09:29Z", loan: { rate: 4.23, month: "202608", basis: "balance" }, deposit: { rate: 3.14, month: "202608" }, cells: [], slugs: {} };

// 구운 장의 #move 요소를 그 글자·data-*·value·checked·hidden 그대로 세운다. 확인기의 두 보증금 칸도 같이.
function seedFromHtml() {
  const seed = {};
  const part = SECTION + HTML.slice(HTML.indexOf('id="check-optional"'), HTML.indexOf('id="check-answer"'));
  for (const m of part.matchAll(/<(\w+)([^>]*)\bid="((?:mv|check)-[\w-]+)"([^>]*)>([^<]*)/g)) {
    const tag = m[1] + m[2] + m[4];
    const attrs = Object.fromEntries([...tag.matchAll(/(data-[\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const el = stubElement(attrs, m[3]);
    el.textContent = m[5];
    el.value = tag.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
    el.checked = /\bchecked\b/.test(tag);
    el.hidden = /\bhidden\b/.test(tag);
    seed[m[3]] = el;
  }
  // 가짜 DOM 은 없는 id 도 만들어 주므로, 표를 innerHTML 로 갈 때 caption 이 떨어져 나가는 것을 따로 흉내 낸다 -
  // 떨어진 caption 에 글자를 쓰면 실제 브라우저에서 null 이 되는 자리다(2026-10-28 실측 결함).
  const table = seed["mv-table"];
  const cap = seed["mv-caption"];
  let attached = true;
  cap._t = cap.textContent;
  Object.defineProperty(table, "innerHTML", { set: (v) => ((table._html = v), (attached = false)), get: () => table._html ?? "" });
  table.prepend = (el) => (el === cap ? (attached = true) : null);
  Object.defineProperty(cap, "textContent", { set: (v) => { if (!attached) throw new Error("떨어진 caption 에 썼다"); cap._t = v; }, get: () => cap._t });
  return seed;
}

async function open({ conversion = CONVERSION, locale = "ko" } = {}) {
  const data = { "renewal-facts": FACTS };
  if (conversion) data.conversion = conversion;
  const page = await loadPage({ file: "renewal-vs-new.html", data, locale, seed: seedFromHtml() });
  new vm.Script(CALC, { filename: "docs/move-cost.js" }).runInContext(page.sandbox);
  new vm.Script(JS, { filename: "docs/renewal-move.js" }).runInContext(page.sandbox);
  await page.settle();
  return page;
}

const set = async (page, values) => {
  for (const [id, value] of Object.entries(values)) {
    const el = page.byId(id);
    if (id === "mv-opp") el.checked = value;
    else el.value = value;
    el.dispatch(id === "mv-kind" || id === "mv-opp" ? "change" : "input");
  }
  await page.settle();
};
const answer = (page) => page.text("mv-answer");

// data-analyst 사례 ① (#777): 헬리오시티 84.98㎡ 재계약 126,000 vs 송파구 60~85㎡ 대표 월세 40,000/140, 내 돈 126,000, 4.23%·3.14%·24개월.
const CASE1 = { "check-old": "120000", "check-ask": "126000", "mv-kind": "wolse", "mv-dep": "40000", "mv-rent": "140", "mv-cash": "126000" };
const input1 = (extra = {}) => ({ renew: 126000, kind: "wolse", deposit: 40000, rent: 140, cash: 126000, loanRate: 4.23, depositRate: 3.14, months: 24, opportunity: true, ...extra });

test("가정은 원래 모듈과 같다: 대출 80% = LOAN_LTV, 세율 = TAX_RATE, 오래된 금리 = MONTHLY_LAG.jeonse_loan_rate + 1", () => {
  assert.equal(LTV, LOAN_LTV);
  assert.equal(TAX, TAX_RATE);
  assert.equal(Number(JS.match(/const LAG = (\d+);/)?.[1]), MONTHLY_LAG.jeonse_loan_rate + 1);
});

test("계산: 기회비용을 켜고 끄면 순위가 뒤집힌다(사례 ①) - 원금·돌려받는 보증금은 비용이 아니다", () => {
  const on = compare(input1());
  assert.equal(on.comparable, true);
  assert.equal(on.renew.loan, 0);
  assert.equal(on.move.loan, 0);
  assert.equal(on.renew.totalK, 2789 * 24); // 126,000 × 3.14% ÷ 12 × (1 − 15.4%) = 278.9만원/월
  assert.equal(on.move.totalK, (1400 + 885) * 24); // 월세 140 + 40,000 의 세후 이자 88.5
  assert.equal(on.gapK, -12096);
  assert.equal(on.cheaper, "move");
  assert.equal(on.cashCheaper, "renew");
  assert.equal(on.cashGapK, 33600);
  const off = compare(input1({ opportunity: false }));
  assert.equal(off.cheaper, "renew");
  assert.equal(off.gapK, 33600);
  assert.equal(off.renew.oppK, 0);
});

test("계산: 금리에 따라 뒤집힌다(사례 ②, 강남구 대표 전세 95,000 vs 월세 40,000/235, 내 돈 40,000)", () => {
  const at = (loanRate) => compare({ renew: 95000, kind: "wolse", deposit: 40000, rent: 235, cash: 40000, loanRate, depositRate: 3.14, months: 1, opportunity: true });
  assert.equal(at(4.23).cheaper, "renew");
  assert.equal(at(4.23).gapK, 411);
  assert.equal(at(5.5).cheaper, "move");
  assert.equal(at(5.5).gapK, -171);
});

test("계산: 월 차이는 전세 vs 월세 화면의 monthlyCost 차이와 같다(절대값은 다르다) - 실현 가능한 입력 전수 표본", () => {
  let n = 0;
  for (const cash of [0, 20000, 60000, 90000, 126000, 200000]) {
    for (const [renew, deposit, rent] of [[126000, 80000, 0], [126000, 40000, 140], [95000, 95000, 0], [50000, 10000, 103.8]]) {
      for (const loanRate of [0, 3.5, 4.23, 7]) {
        const r = compare({ renew, kind: rent ? "wolse" : "jeonse", deposit, rent, cash, loanRate, depositRate: 3.14, months: 1, opportunity: true });
        if (!r.comparable) continue;
        const a = monthlyCost({ deposit10k: renew, cash10k: cash, loanRate, depositRate: 3.14 });
        const b = monthlyCost({ deposit10k: deposit, monthlyRent10k: rent, cash10k: cash, loanRate, depositRate: 3.14 });
        assert.ok(Math.abs(r.gapK / 10 - (b.cost10k - a.cost10k)) <= 0.15, `${cash} ${renew}/${deposit}/${rent} ${loanRate}%`);
        n += 1;
      }
    }
  }
  assert.ok(n > 40, `본 사례가 ${n}개뿐이다`);
});

test("계산: 80%까지 빌려도 모자라면 견주지 않고 모자란 돈을 낸다(monthlyCost 와 같은 값), 대출이 없으면 이자 0", () => {
  const r = compare({ renew: 126000, kind: "jeonse", deposit: 80000, cash: 20000, loanRate: 4.23, months: 24 });
  assert.equal(r.comparable, false);
  assert.equal(r.cheaper, null);
  assert.equal(r.renew.short, monthlyCost({ deposit10k: 126000, cash10k: 20000, loanRate: 4.23, depositRate: 0 }).short10k);
  assert.equal(r.move.feasible, true);
  const none = compare({ renew: 50000, kind: "jeonse", deposit: 40000, cash: 60000, loanRate: 4.23, months: 24 });
  assert.equal(none.renew.loan + none.move.loan, 0);
  assert.equal(none.renew.interestK + none.move.interestK, 0);
  assert.equal(none.gapK, 0);
  assert.equal(none.cheaper, null);
});

test("계산: 금리는 bp 정수로 바꿔 반올림한다 - 78,000 × 3.01% ÷ 12 = 195.65 → 195.7만원(부동소수로 바로 셈하면 195.6499… 로 내려간다)", () => {
  assert.equal(Math.round(((78000 * 3.01) / 100 / 12) * 10), 1956, "대조: 전세 vs 월세 화면식(금액 × 금리 ÷ 100 ÷ 12)의 부동소수는 내려간다 - 이 사례가 정수화를 실제로 본다");
  const r = compare({ renew: 138000, kind: "jeonse", deposit: 138000, cash: 60000, loanRate: 3.01, months: 24 });
  assert.equal(r.renew.loan, 78000);
  assert.equal(r.renew.interestK, 1957);
  assert.equal(r.renew.cashTotalK, 1957 * 24);
});

test("계산: 잘못된 입력은 칸과 사유로 돌려주고 결과를 내지 않는다", () => {
  const r = compare({ renew: "", kind: "wolse", deposit: -1, rent: 0, cash: -5, loanRate: 25, depositRate: 3, months: 0.5, opportunity: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    { field: "renew", code: "required" },
    { field: "deposit", code: "range" },
    { field: "rent", code: "range" },
    { field: "cash", code: "range" },
    { field: "loanRate", code: "range" },
    { field: "months", code: "range" },
  ]);
  assert.equal(compare({ ...input1(), deposit: 0 }).ok, true, "월세 집 보증금 0 은 받는다");
  assert.equal(compare({ ...input1(), kind: "jeonse", deposit: 0 }).ok, false, "전세 보증금 0 은 안 받는다");
  assert.equal(compare({ ...input1(), opportunity: false, depositRate: "" }).ok, true, "기회비용을 끄면 예금 금리는 안 묻는다");
});

test("자리: 확인기 → 방법 안내 → #move → #convert, 보이는 label, aria-live 답, 출처 줄(ECOS 가공 꼬리)", () => {
  const ids = [...HTML.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(0, 5), ["check-section", "move", "convert", "expiry", "lead-section"]);
  assert.ok(HTML.indexOf("</aside>") < HTML.indexOf('<section id="move"'), "방법 안내가 확인기에 붙어 있어야 한다");
  assert.match(SECTION, /^<section id="move" class="tw:mb-10 tw:1024:mb-16">/);
  for (const id of ["mv-kind", "mv-dep", "mv-rent", "mv-cash", "mv-rate", "mv-months", "mv-opp", "mv-drate"]) {
    assert.ok(SECTION.includes(`<label for="${id}" id="${id}-label" data-en="`), `${id} label`);
  }
  assert.match(SECTION, /<p class="lead" id="mv-answer" aria-live="polite" data-msg="[^"]+" data-msg-en="[^"]+"><\/p>/);
  assert.equal(MSG("ko").length, 47);
  assert.equal(MSG("en").length, 47);
  assert.ok(SECTION.includes(`data-en="${FOOTERS.renewalMove.en}">${FOOTERS.renewalMove.ko}</p>`), "출처 줄이 source-lines 로 찍히지 않았다");
  assert.match(FOOTERS.renewalMove.ko, /전세자금대출·정기예금 평균금리\. 이 값은 원자료를 가공한 것입니다\.$/);
});

test("판정·추천으로 읽히는 낱말이 절 안에 없다(legal #777)", () => {
  const text = (SECTION.replace(/<[^>]+>/g, " ") + MSG("ko").join(" ")).replace("판정하거나 권하는 것이 아니며", "");
  assert.doesNotMatch(text, /유리|불리|적정|안전한 계약|무조건|반드시|추천|권합니다|이득|손해|최선|보장/);
  // 고지의 부정문(「판정하거나 권하는 것이 아니며」 / "does not judge or recommend")은 legal 확정 문구라 뺀 뒤 본다.
  const en = (MSG("en").join(" ") + SECTION).replace("does not judge or recommend either option", "");
  assert.doesNotMatch(en, /recommend|fair price|better deal|guarantee|\bshould\b/i);
});

test("외부 JS 둘은 각각 배포 사본(주석 뗀 것, #784) gzip ≤2,048B, renewal-vs-new 만 defer 로 한 번씩(계산이 먼저) 읽고 서비스워커 사전캐시에 없다 (#681)", async () => {
  for (const [name, src] of [["move-cost.js", CALC], ["renewal-move.js", JS]]) {
    const size = gzipSync(stripJsComments(src), { level: 9 }).length;
    assert.ok(size <= 2048, `docs/${name} gzip ${size}B`);
    assert.equal(HTML.split(`<script src="./${name}" defer></script>`).length, 2, name);
    assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes(name), `${name} 가 sw.js 사전캐시에 들어갔다`);
  }
  assert.ok(HTML.indexOf("./move-cost.js") < HTML.indexOf("./renewal-move.js"));
  const users = [];
  for (const f of (await readdir(path.join(root, SITE))).filter((x) => x.endsWith(".html")).sort()) {
    const page = await readFile(path.join(root, SITE, f), "utf8");
    if (page.includes("move-cost.js") || page.includes("renewal-move.js")) users.push(f);
  }
  assert.deepEqual(users, ["renewal-vs-new.html"]);
});

test("고지 세 문단은 접지 않고 늘 보인다(legal) - details 안에 있지 않다", () => {
  const legal = SECTION.match(/<p class="content-notice" id="mv-legal" data-en="([^"]+)">([^<]+)<\/p>/);
  assert.ok(legal, "고지 문단이 없다");
  assert.match(legal[2], /판정하거나 권하는 것이 아니며.*한도는 판정하지 않습니다.*계약의 안전성은 판단하지 않습니다/);
  assert.match(legal[1], /does not judge or recommend.*do not assess whether you can borrow.*contract safety/);
  assert.ok(!/<details[^>]*>[\s\S]*id="mv-legal"/.test(SECTION));
});

test("화면: 요구 보증금이 없으면 확인기 칸으로 안내, 그다음엔 남은 칸 이름 - 결과를 만들어 내지 않는다", async () => {
  const M = MSG("ko");
  const page = await open();
  assert.equal(answer(page), M[2]);
  assert.equal(page.html("mv-table"), "");
  await set(page, { "check-ask": "126000" });
  assert.equal(answer(page), "넣을 칸: 비교할 집 보증금, 보증금에 넣을 내 돈");
  assert.equal(page.text("mv-renew"), "재계약: 요구 126,000만원 (위 「우리 단지 재계약 확인」 칸)");
  await set(page, { "mv-kind": "wolse", "mv-dep": "40000", "mv-cash": "10" });
  assert.equal(answer(page), "넣을 칸: 비교할 집 월세");
  assert.equal(page.byId("mv-rent-field").hidden, false);
  await set(page, { "mv-rent": "-3", "mv-months": "200" });
  assert.equal(answer(page), "비교할 집 월세: 0보다 커야 합니다. 거주 기간: 1~120개월이어야 합니다.");
});

test("화면 = 계산 모듈: 사례 ① 의 제목·부제·역전 줄·표 금액이 compare() 결과와 같다", async () => {
  const page = await open();
  await set(page, CASE1);
  const r = compare(input1());
  const man = (k) => (k / 10).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  assert.equal(
    answer(page),
    `입력한 조건으로 24개월 동안 이사가 ${man(-r.gapK)}만원 덜 듭니다(현금 지출 + 묶인 내 돈의 세후 예금이자 기준).` +
      ` 월 현금 지출은 재계약 ${man(r.renew.cashK)}만원 · 이사 ${man(r.move.cashK)}만원입니다. 돌려받는 보증금과 대출 원금은 비용이 아닙니다. 금리·월세가 24개월 내내 같다고 본 계산입니다.` +
      ` 현금 지출만 보면 재계약이 ${man(r.cashGapK)}만원 덜 듭니다.`
  );
  assert.match(answer(page), /이사가 1,209\.6만원 덜 듭니다/);
  const table = page.html("mv-table");
  assert.equal(page.text("mv-caption"), "재계약과 이사 - 두 선택지(2개)의 보증금·대출·월 비용·합계", "표를 갈아 끼워도 caption 요소가 남는다(#300)");
  for (const [label, a, b] of [
    ["필요 보증금", "126,000", "40,000"],
    ["계산상 대출(원금, 비용 아님)", "0", "0"],
    ["월세", "0", "140"],
    ["24개월 현금 지출", man(r.renew.cashTotalK), man(r.move.cashTotalK)],
    ["묶인 내 돈의 세후 예금이자(24개월)", man(r.renew.oppK * 24), man(r.move.oppK * 24)],
    ["합계", man(r.renew.totalK), man(r.move.totalK)],
  ]) {
    assert.ok(table.includes(`<tr><th scope="row">${label}</th><td>${a}</td><td>${b}</td></tr>`), `${label}: ${table}`);
  }
  // 합계 줄의 차이 = 제목의 금액(모순 없음)
  assert.equal(r.move.totalK - r.renew.totalK, r.gapK);
});

test("화면: 기회비용을 끄면 제목 기준이 바뀌고 표에서 그 줄이 빠지며 역전 줄이 없다", async () => {
  const page = await open();
  await set(page, { ...CASE1, "mv-opp": false });
  assert.match(answer(page), /^입력한 조건으로 24개월 동안 재계약이 3,360만원 덜 듭니다\(현금 지출 기준\)\./);
  assert.doesNotMatch(answer(page), /현금 지출만 보면/);
  assert.doesNotMatch(page.html("mv-table"), /예금이자/);
});

test("화면: 같은 비용이면 같다고 말하고, 80% 가정을 넘는 쪽이 있으면 승자 문장 없이 모자란 돈만", async () => {
  const page = await open();
  await set(page, { "check-ask": "50000", "mv-dep": "40000", "mv-cash": "60000", "mv-opp": false });
  assert.match(answer(page), /^입력한 조건으로 24개월 동안 두 선택지의 비용이 같습니다\(현금 지출 기준\)\./);
  await set(page, { "check-ask": "126000", "mv-dep": "80000", "mv-cash": "20000" });
  assert.equal(answer(page), "재계약: 보증금의 80%까지 빌린다고 가정해도 5,200만원 모자라 견주지 않았습니다. 80%는 계산 가정이며 실제 대출 가능 여부와는 다릅니다.");
  assert.match(page.html("mv-table"), /<tr><th scope="row">합계<\/th><td>-<\/td><td>[\d,.]+<\/td><\/tr>/);
});

test("금리: 평균금리를 참고값으로 미리 넣고 출처·관측월을 적으며, 고치면 직접 넣은 값으로 바뀐다", async () => {
  const page = await open();
  assert.equal(page.byId("mv-rate").value, 4.23);
  assert.equal(page.byId("mv-drate").value, 3.14);
  assert.match(page.text("mv-rate-note"), /^대출 금리: 한국은행 전세자금대출 평균금리\(기존 대출 잔액 기준, 2026-08\) — 개인이 새로 받는 금리가 아닙니다\..* 예금 금리: 한국은행 정기예금 신규취급 평균금리\(2026-08\), 세후/);
  await set(page, { "mv-rate": "3.9" });
  assert.match(page.text("mv-rate-note"), /^대출 금리: 직접 넣은 값입니다\. 예금 금리: 한국은행/);
  await set(page, { "mv-opp": false });
  assert.equal(page.text("mv-rate-note"), "대출 금리: 직접 넣은 값입니다.");
});

test("금리: 관측월이 기준일보다 LAG 개월 넘게 앞서면 알리고, 자료를 못 받으면 직접 넣으라고 한다", async () => {
  const stale = await open({ conversion: { ...CONVERSION, loan: { ...CONVERSION.loan, month: "202605" } } });
  assert.match(stale.text("mv-rate-note"), / 금리 관측월 2026-05 — 최근 금리와 다를 수 있습니다\.$/);
  const fresh = await open();
  assert.doesNotMatch(fresh.text("mv-rate-note"), /관측월 2026/);
  const failed = await open({ conversion: null });
  assert.equal(failed.text("mv-rate-note"), "평균금리를 불러오지 못했습니다. 금리를 직접 넣으면 계산합니다.");
  assert.equal(failed.byId("mv-rate").value, "");
  await set(failed, { ...CASE1, "mv-rate": "4", "mv-drate": "3" });
  assert.match(answer(failed), /^입력한 조건으로 24개월 동안/);
});

test("내 돈 칸: 종전 보증금이 있으면 「대출 없이 지금 보증금뿐이면」 단추가 그 값을 넣는다", async () => {
  const page = await open();
  assert.equal(page.byId("mv-cash-fill").hidden, true);
  await set(page, { "check-old": "120000" });
  assert.equal(page.byId("mv-cash-fill").hidden, false);
  assert.equal(page.text("mv-cash-fill"), "대출 없이 지금 보증금뿐이면 120,000만원 넣기");
  await page.click("mv-cash-fill");
  assert.equal(page.byId("mv-cash").value, 120000);
});

test("언어: 영어로 바꾸면 라벨·답·표·고지가 영어로, 다시 바꾸면 구운 한국어로", async () => {
  const page = await open();
  await set(page, CASE1);
  await page.click("lang-toggle");
  assert.equal(page.text("mv-heading"), "If you move instead");
  assert.match(answer(page), /^Under these inputs, moving costs 1,209\.6 \(10k won\) less over 24 months \(cash spent plus after-tax deposit interest forgone\)\./);
  assert.match(answer(page), / On cash alone, renewing costs 3,360 less\.$/);
  assert.match(page.html("mv-table"), /<th scope="col">Renewal \(10k won\)<\/th><th scope="col">Move \(10k won\)<\/th>/);
  assert.match(page.text("mv-legal"), /^This is a calculation/);
  await page.click("lang-toggle");
  assert.equal(page.text("mv-heading"), "다른 집으로 옮기면");
  assert.match(page.text("mv-legal"), /^이 값은 입력한 조건이/);
});

test("개인 입력은 주소에 실리지 않는다", async () => {
  const page = await open();
  await set(page, CASE1);
  assert.doesNotMatch(page.search(), /126000|40000|mv-|cash/);
});

test("화면 = 계산 모듈: 답 문장과 표는 describe(compare(입력)) 그대로다(ko·en, 오류·한도 초과 포함)", async () => {
  const cases = [
    [CASE1, input1()],
    [{ ...CASE1, "mv-opp": false }, input1({ opportunity: false })],
    [{ "check-ask": "126000", "mv-dep": "80000", "mv-cash": "20000" }, { renew: 126000, kind: "jeonse", deposit: 80000, cash: 20000, loanRate: 4.23, depositRate: 3.14, months: 24, opportunity: true }],
    [{ "check-ask": "126000", "mv-kind": "wolse", "mv-dep": "40000", "mv-rent": "0", "mv-cash": "1", "mv-months": "0" }, { renew: 126000, kind: "wolse", deposit: 40000, rent: 0, cash: 1, loanRate: 4.23, depositRate: 3.14, months: 0, opportunity: true }],
  ];
  for (const locale of ["ko", "en"]) {
    const fmt = (x) => Number(x).toLocaleString(locale === "en" ? "en-US" : "ko-KR", { maximumFractionDigits: 1 });
    for (const [ui, input] of cases) {
      const page = await open({ locale });
      await set(page, ui);
      const d = describe(compare(input), MSG(locale), fmt, input.kind);
      assert.equal(answer(page), d.text, `${locale} ${JSON.stringify(ui)}`);
      for (const row of d.rows ?? []) assert.ok(page.html("mv-table").includes(`<tr><th scope="row">${row[0]}</th><td>${row[1]}</td><td>${row[2]}</td></tr>`), row[0]);
    }
  }
});
