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
import { AREA_BANDS, LOAN_LTV, monthlyCost } from "../scripts/conversion.ts";
import { TAX_RATE } from "../scripts/interest.ts";
import { MONTHLY_LAG } from "../scripts/check-data-progress.ts";
import { FOOTERS } from "../scripts/source-lines.ts";
import { stripJsComments } from "../scripts/strip-inline-comments.ts";
import { loadPage, stubElement } from "./helpers/digest-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const CALC = await readFile(path.join(root, "docs/move-cost.js"), "utf8");
const TEXT = await readFile(path.join(root, "docs/move-text.js"), "utf8");
const JS = await readFile(path.join(root, "docs/renewal-move.js"), "utf8");
const BASIS = await readFile(path.join(root, "docs/renewal-move-basis.js"), "utf8");
const ANALYTICS = await readFile(path.join(root, "docs/analytics.js"), "utf8");
const CSS_BASE = await readFile(path.join(root, "src/css/c-base.css"), "utf8");
const HTML = await readFile(path.join(root, SITE, "renewal-vs-new.html"), "utf8");
const SECTION = HTML.slice(HTML.indexOf('<section id="move"'), HTML.indexOf('<section id="convert"'));

await import("../docs/move-cost.js");
await import("../docs/move-text.js");
const { compare, describe, LTV, TAX } = globalThis.jipgyeMoveCost;
const MSG = (lang) => SECTION.match(new RegExp(`${lang === "en" ? "data-msg-en" : "data-msg"}="([^"]*)"`))[1].split("|");

const FACTS = { updatedAt: "2026-10-24T00:00:00Z", slugs: { 송파구: "songpa" }, table: [{ district: "송파구", gapMedian: null, gapMatched: 1, rightUsed: 1 }] };
const CONVERSION = {
  updatedAt: "2026-10-28T02:09:29Z", loan: { rate: 4.23, month: "202608", basis: "balance" }, deposit: { rate: 3.14, month: "202608" }, slugs: {},
  cells: [
    { district: "송파구", band: "60to85", rate: 4.8, jeonse10k: 80000, deposit10k: 40000, monthly10k: 140, pairs: 75 },
    { district: "송파구", band: "under60", rate: 4.6, jeonse10k: 52000, deposit10k: 10000, monthly10k: 160, pairs: 40 },
    { district: "송파구", band: "over85", rate: 4.5, jeonse10k: 150000, deposit10k: 60000, monthly10k: 300, pairs: 30 },
  ],
};
// 확인기 칸 파일(renewal-cells-songpa) - #777 P1 대표 사례 A·B′ 의 칸 값 모양 그대로(실데이터 파일은 읽지 않는다).
const CELLS = {
  updatedAt: "2026-10-28T02:11:14Z", window: ["202411", "202610"], min: { show: 3, ratio: 5 },
  cells: { 헬리오시티: { "59.96": [0, 6, 6, 65, 0, 0, 1, 0, 0, 1, 16, 108000], "60": [0, 1, 1, 3, 0, 0, 1, 1, 1, 2, 3, 90000], "85": [0, 1, 1, 3, 0, 0, 1, 1, 1, 2, 3, 130000], "84.98": [2, 13, 25, 290, 0, 3, 24, 8, 31, 162, 54, 128500], "130.06": [1, 0, 0, 3, 0, 0, 0, 0, 0, 4, 0, null] } },
  fallback: { under60: [6, 18, 23, 74, 4, 5, 23, 10, 20, 32], "60to85": [5, 30, 53, 169, 0, 1, 18, 12, 21, 75] },
};
const Q = (apt, area) => `?${new URLSearchParams({ gu: "songpa", apt, area })}`;

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
  const section = SECTION.match(/^<section id="move"[^>]*>/)[0];
  seed.move = stubElement({ "data-i18n": section.match(/data-i18n="([^"]*)"/)[1] }, "move");
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

async function open({ conversion = CONVERSION, locale = "ko", query = "", cells = CELLS, status, ga = false } = {}) {
  const data = { "renewal-facts": FACTS };
  if (conversion) data.conversion = conversion;
  if (cells) data["renewal-cells-songpa"] = cells;
  const page = await loadPage({ file: "renewal-vs-new.html", data, locale, query, status, seed: seedFromHtml() });
  page.data = data; // 시험이 나중에 응답을 바꿀 수 있게(다시 시도)
  // ga: 실제 docs/analytics.js 를 같은 자리에 올린다(전송 대신 window.dataLayer 에 쌓인다 - 그 안에 개인 입력이 없는지 본다).
  if (ga) new vm.Script(ANALYTICS, { filename: "docs/analytics.js" }).runInContext(page.sandbox);
  new vm.Script(CALC, { filename: "docs/move-cost.js" }).runInContext(page.sandbox);
  new vm.Script(TEXT, { filename: "docs/move-text.js" }).runInContext(page.sandbox);
  new vm.Script(JS, { filename: "docs/renewal-move.js" }).runInContext(page.sandbox);
  new vm.Script(BASIS, { filename: "docs/renewal-move-basis.js" }).runInContext(page.sandbox);
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
// 견줄 수 있을 때 차이·월 현금 지출·기준은 핵심 숫자 카드가 말하고 답 문장은 카드에 없는 가정만 남는다(#799).
const key = (page) => page.html("mv-key").replace(/<[^>]+>/g, ""); // 가짜 DOM 은 innerHTML 의 글자를 세지 않는다

// data-analyst 사례 ① (#777): 헬리오시티 84.98㎡ 재계약 126,000 vs 송파구 60~85㎡ 대표 월세 40,000/140, 내 돈 126,000, 4.23%·3.14%·24개월.
const CASE1 = { "check-old": "120000", "check-ask": "126000", "mv-kind": "wolse", "mv-dep": "40000", "mv-rent": "140", "mv-cash": "126000" };
const input1 = (extra = {}) => ({ renew: 126000, kind: "wolse", deposit: 40000, rent: 140, cash: 126000, loanRate: 4.23, depositRate: 3.14, months: 24, opportunity: true, ...extra });

test("가정은 원래 모듈과 같다: 대출 80% = LOAN_LTV, 세율 = TAX_RATE, 오래된 금리 = MONTHLY_LAG.jeonse_loan_rate + 1", () => {
  assert.equal(LTV, LOAN_LTV);
  assert.equal(TAX, TAX_RATE);
  assert.equal(Number(TEXT.match(/const LAG = (\d+);/)?.[1]), MONTHLY_LAG.jeonse_loan_rate + 1);
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
  assert.match(SECTION, /^<section id="move" class="tw:mb-10 tw:1024:mb-16" data-i18n="[a-z0-9 -]+">/);
  for (const id of ["mv-kind", "mv-dep", "mv-rent", "mv-cash", "mv-rate", "mv-months", "mv-opp", "mv-drate"]) {
    assert.ok(SECTION.includes(`<label for="${id}" id="${id}-label" data-en="`), `${id} label`);
  }
  assert.match(SECTION, /<p class="lead" id="mv-answer" aria-live="polite" data-msg="[^"]+" data-msg-en="[^"]+"><\/p>/);
  assert.equal(MSG("ko").length, 109);
  assert.equal(MSG("en").length, 109);
  assert.ok(SECTION.includes(`data-en="${FOOTERS.renewalMove.en}">${FOOTERS.renewalMove.ko}</p>`), "출처 줄이 source-lines 로 찍히지 않았다");
  assert.match(FOOTERS.renewalMove.ko, /전세자금대출·정기예금 평균금리\. 이 값은 원자료를 가공한 것입니다\.$/);
});

test("판정·추천으로 읽히는 낱말이 절 안에 없다(legal #777)", () => {
  const text = (SECTION.replace(/<[^>]+>/g, " ") + MSG("ko").join(" ")).replace("판정하거나 권하는 것이 아니며", "");
  assert.doesNotMatch(text, /유리|불리|적정|안전한 계약|무조건|반드시|추천|권합니다|이득|손해|최선|보장/);
  // 고지의 부정문(「판정하거나 권하는 것이 아니며」 / "does not judge or recommend")은 legal 확정 문구라 뺀 뒤 본다.
  const en = (MSG("en").join(" ") + SECTION).replace("does not judge or recommend either option", "");
  assert.doesNotMatch(en, /recommend|fair price|better deal|\bguaranteed\b|\bguarantee(?! fees)|\bshould\b/i); // 「guarantee fees」(보증료, 넣지 않은 비용)는 약속이 아니다
});

test("외부 JS 넷은 각각 배포 사본(주석 뗀 것, #784) gzip ≤2,048B, renewal-vs-new 만 defer 로 한 번씩(계산이 먼저) 읽고 서비스워커 사전캐시에 없다 (#681)", async () => {
  for (const [name, src] of [["move-cost.js", CALC], ["move-text.js", TEXT], ["renewal-move.js", JS], ["renewal-move-basis.js", BASIS]]) {
    const size = gzipSync(stripJsComments(src), { level: 9 }).length;
    assert.ok(size <= 2048, `docs/${name} gzip ${size}B`);
    assert.equal(HTML.split(`<script src="./${name}" defer></script>`).length, 2, name);
    assert.ok(!(await readFile(path.join(root, "docs/sw.js"), "utf8")).includes(name), `${name} 가 sw.js 사전캐시에 들어갔다`);
  }
  assert.ok(HTML.indexOf("./move-cost.js") < HTML.indexOf("./move-text.js") && HTML.indexOf("./move-text.js") < HTML.indexOf("./renewal-move.js") && HTML.indexOf("./renewal-move.js") < HTML.indexOf("./renewal-move-basis.js"), "defer 실행 순서(계산 → 문장 → 화면 → 근거)에 기댄다");
  // 이 장의 장 전용 JS 는 여섯(group-cto 조건부 승인 #777 다섯 + group-ceo 판정 A #792 여섯째) - 일곱째나 파일당 한도 올리기는 다시 group-ceo 안건이다.
  const { pageScripts } = await import("../scripts/page-assets.ts");
  // 장에 붙은 장 전용 JS 를 속성과 무관하게 모은다 - defer 없이 붙인 파일도 목록·합계에서 빠지지 않게(group-cto #792 5 지적).
  const page = new Set(pageScripts(path.join(root, "docs")));
  const own = [...HTML.matchAll(/<script\b[^>]*\bsrc="\.\/([\w-]+\.js)"[^>]*>/g)].map((m) => m[1]).filter((f) => page.has(f)).sort();
  for (const f of own) assert.ok(HTML.includes(`<script src="./${f}" defer></script>`), `${f}: defer 로 붙지 않았다`);
  assert.deepEqual(own, ["lease-expiry.js", "move-cost.js", "move-text.js", "renewal-convert.js", "renewal-move-basis.js", "renewal-move.js"]);
  const total = (await Promise.all(own.map((f) => readFile(path.join(root, "docs", f), "utf8")))).reduce((n, src) => n + gzipSync(stripJsComments(src), { level: 9 }).length, 0);
  // 합계 상한은 실측에 맞춰 고정한다(P3 7,130B → P4 7,795B → P5 8,264B → #792 입력 흐름·칸 옆 오류·계산에 쓴 금리 뒤 8,662B → #792 5 계산·문장 분리(여섯째 파일, group-ceo A)·선택지별 금리 뒤 9,174B → #797 모바일 핵심 숫자 카드·금액 읽기·선택 조건 요약 뒤 9,738B, +564B 라 group-cto 재판정 조건부 승인 → #799 결과 아래 단추·금리 이름 뒤 9,737B, -1B) - 파일당 한도에서 저절로 나오는 5×2,048 은 아무것도 지키지 않는다(engineer #777 P3).
  // 늘리는 PR 은 이 숫자를 사유와 함께 고친다.
  assert.ok(total <= 9800, `이 장 장 전용 JS 합계 ${total}B > 9,800B`); // group-ceo 조건 ②: 병합 때 잰 값을 100B 단위로 올림, 그 뒤 +400B 넘게 늘면 group-cto 재판정
  const users = [];
  for (const f of (await readdir(path.join(root, SITE))).filter((x) => x.endsWith(".html")).sort()) {
    const page = await readFile(path.join(root, SITE, f), "utf8");
    if (/move-(cost|text)\.js|renewal-move(-basis)?\.js/.test(page)) users.push(f);
  }
  assert.deepEqual(users, ["renewal-vs-new.html"]);
});

test("고지 세 문단은 접지 않고 늘 보인다(legal) - details 안에 있지 않다", () => {
  const legal = SECTION.match(/<p class="content-notice" id="mv-legal" data-en="([^"]+)">([^<]+)<\/p>/);
  assert.ok(legal, "고지 문단이 없다");
  assert.match(legal[2], /판정하거나 권하는 것이 아니며.*한도는 판정하지 않습니다.*계약의 안전성은 판단하지 않습니다/);
  assert.match(legal[1], /does not judge or recommend.*do not assess whether you can borrow.*contract safety/);
  const details = SECTION.slice(SECTION.indexOf("<details"), SECTION.indexOf("</details>"));
  assert.ok(details && !details.includes('id="mv-legal"'), "고지가 접히는 상자 안에 있다");
});

test("화면: 요구 보증금이 없으면 확인기 칸으로 안내, 그다음엔 남은 칸 이름 - 결과를 만들어 내지 않는다", async () => {
  const M = MSG("ko");
  const page = await open();
  assert.equal(answer(page), M[2]);
  assert.equal(page.html("mv-table"), "");
  await set(page, { "check-ask": "126000" });
  assert.equal(answer(page), "넣을 칸: 비교할 집 보증금, 보증금에 넣을 내 돈");
  assert.equal(page.text("mv-renew"), "재계약: 요구 126,000만원");
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
    key(page),
    `입력한 조건으로 24개월 비용 차이(현금 지출 + 묶인 내 돈의 세후 예금이자 기준)이사가 ${man(-r.gapK)}만원 덜 듭니다` +
      `재계약 월 현금 지출${man(r.renew.cashK)}만원이사 월 현금 지출${man(r.move.cashK)}만원` +
      `일회성 비용 넣지 않음(0으로 계산) · 묶인 내 돈의 세후 예금이자 포함 현금 지출만 보면 재계약이 ${man(r.cashGapK)}만원 덜 듭니다.`
  );
  assert.match(key(page), /이사가 1,209\.6만원 덜 듭니다/);
  assert.equal(answer(page), "돌려받는 보증금과 대출 원금은 비용이 아닙니다. 금리·월세가 24개월 내내 같다고 본 계산입니다.", "답 문장에서 카드와 다른 가정이 빠졌다");
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
  assert.match(key(page), /^입력한 조건으로 24개월 비용 차이\(현금 지출 기준\)재계약이 3,360만원 덜 듭니다/);
  assert.doesNotMatch(key(page) + answer(page), /현금 지출만 보면/);
  assert.doesNotMatch(page.html("mv-table"), /예금이자/);
});

test("화면: 같은 비용이면 같다고 말하고, 80% 가정을 넘는 쪽이 있으면 승자 문장 없이 모자란 돈만", async () => {
  const page = await open();
  await set(page, { "check-ask": "50000", "mv-dep": "40000", "mv-cash": "60000", "mv-opp": false });
  assert.match(key(page), /^입력한 조건으로 24개월 비용 차이\(현금 지출 기준\)두 선택지의 비용이 같습니다/);
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
  assert.equal(page.text("mv-rate-note"), "대출 금리: 직접 넣은 값입니다. 예금 금리: 기회비용을 끄면 계산에 쓰지 않습니다.");
});

test("금리: 관측월이 기준일보다 LAG 개월 넘게 앞서면 알리고, 자료를 못 받으면 직접 넣으라고 한다", async () => {
  const stale = await open({ conversion: { ...CONVERSION, loan: { ...CONVERSION.loan, month: "202605" } } });
  assert.match(stale.text("mv-rate-note"), / 금리 관측월 2026-05 — 최근 금리와 다를 수 있습니다\.$/);
  // #797: 「선택 조건」이 접혀 있어도 보이게 결과 아래 근거 줄(계산에 쓴 금리 끝)에도 붙는다(legal).
  assert.doesNotMatch(stale.text("mv-basis-line"), /관측월/, "결과가 없는데 근거 줄을 채웠다");
  await set(stale, CASE1);
  assert.match(stale.text("mv-basis-line"), /\. 금리 관측월 2026-05 — 최근 금리와 다를 수 있습니다\./);
  const fresh = await open();
  assert.doesNotMatch(fresh.text("mv-rate-note"), /관측월 2026/);
  await set(fresh, CASE1);
  assert.doesNotMatch(fresh.text("mv-basis-line"), /관측월 2026/);
  const failed = await open({ conversion: null });
  assert.equal(failed.text("mv-rate-note"), "평균금리를 불러오지 못했습니다. 금리를 직접 넣으면 계산합니다.");
  assert.equal(failed.byId("mv-rate").value, "");
  await set(failed, { ...CASE1, "mv-rate": "4", "mv-drate": "3" });
  assert.match(key(failed), /^입력한 조건으로 24개월 비용 차이/);
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
  assert.equal(page.text("mv-heading"), "Renew or move: cost comparison");
  assert.match(key(page), /^Cost difference over 24 months under these inputs \(cash spent plus after-tax deposit interest forgone\)moving costs 1,209\.6 \(10k won\) less/);
  assert.match(key(page), / On cash alone, renewing costs 3,360 less\.$/);
  assert.equal(answer(page), "Deposits you get back and loan principal are not costs. Rates and rent are held fixed for 24 months.");
  assert.match(page.html("mv-table"), /<th scope="col">Renewal \(10k won\)<\/th><th scope="col">Move \(10k won\)<\/th>/);
  assert.match(page.text("mv-legal"), /^This is a calculation/);
  await page.click("lang-toggle");
  assert.equal(page.text("mv-heading"), "재계약·이사 비용 비교");
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

// ---- P3: 확인기가 고른 칸을 이어받는다 (#777 P3) ----

test("단지 기준: 같은 평형 신규 전세 중간값 단추와 자치구 참고 단추를 따로, 꼬리표를 달고 낸다 - 누르기 전에는 칸을 채우지 않는다", async () => {
  const page = await open({ query: Q("헬리오시티", "84.98") });
  assert.equal(page.byId("mv-dep").value, "", "참고값을 먼저 채웠다");
  assert.equal(page.byId("mv-ref-a").hidden, false);
  assert.equal(page.text("mv-ref-a"), "같은 평형 신규 전세 중간값 넣기 128,500만원 — 단지 기준·최근 6개월 54건");
  assert.equal(page.text("mv-ref-b"), "송파구 60~85㎡ 대표 전세 넣기 80,000만원 — 자치구 참고·단지 75곳, 이 단지 값이 아닙니다");
  assert.match(page.text("mv-basis-line"), /^기준: 송파구 헬리오시티 84\.98㎡ — 같은 단지·같은 평형\(단지 기준\)\. 갱신 통계: 2024-11~2026-10 순수 전세 갱신 558건\. 같은 평형 신규 전세: 최근 6개월 54건\. 층·향·동·집 상태/);
  await page.click("mv-ref-a");
  assert.equal(page.byId("mv-dep").value, 128500);
  assert.equal(page.text("mv-ref-note"), "비교할 집: 참고값(단지 기준)입니다 — 실제로 제시받은 조건이 있으면 그 값으로 고쳐 넣으세요.");
  await set(page, { "mv-dep": "120000" });
  assert.equal(page.text("mv-ref-note"), "비교할 집: 직접 넣은 값입니다.");
});

test("월세로 바꾸면 단지 중간값 단추는 숨고 자치구 대표 월세 단추가 보증금·월세를 함께 넣는다", async () => {
  const page = await open({ query: Q("헬리오시티", "84.98") });
  await set(page, { "mv-kind": "wolse" });
  assert.equal(page.byId("mv-ref-a").hidden, true);
  assert.equal(page.text("mv-ref-b"), "송파구 60~85㎡ 대표 월세 넣기 보증금 40,000·월세 140만원 — 자치구 참고·단지 75곳, 이 단지 값이 아닙니다");
  await page.click("mv-ref-b");
  assert.equal(page.byId("mv-dep").value, 40000);
  assert.equal(page.byId("mv-rent").value, 140);
  assert.match(page.text("mv-ref-note"), /^비교할 집: 참고값\(자치구 참고\)입니다/);
});

test("표본 부족: 신규 전세 중간값이 없으면 단추 대신 건수를 적고, 갱신 줄이 5건 미만이면 근거 줄에 표본 부족", async () => {
  const page = await open({ query: Q("헬리오시티", "130.06") });
  assert.equal(page.byId("mv-ref-a").hidden, true);
  assert.equal(page.text("mv-ref-note"), "같은 평형 신규 전세가 최근 6개월 0건이라 중간값을 내지 않았습니다.");
  assert.match(page.text("mv-basis-line"), / 같은 평형 신규 전세: 최근 6개월 0건\. 표본 부족: 한 줄이 갱신 4건뿐이라 그 줄은 비율 대신 건수만 냅니다\./);
});

test("자치구만: 넘겨받은 단지가 목록에 없으면 넘겨받은 면적의 구 전체 면적대로 내리고, 그 사실을 먼저 적는다", async () => {
  const page = await open({ query: Q("이문아이파크자이", "59.95") });
  assert.equal(page.search(), `?${new URLSearchParams({ gu: "songpa", apt: "이문아이파크자이", area: "b:under60" })}`);
  assert.equal(page.text("mv-ref-note"), "이 단지·평형은 단지 값이 없습니다. 아래는 송파구 60㎡ 미만 전체 값입니다.");
  assert.equal(page.byId("mv-ref-a").hidden, true, "구 전체 값에 단지 중간값 단추를 붙였다");
  assert.equal(page.text("mv-ref-b"), "송파구 60㎡ 미만 대표 전세 넣기 52,000만원 — 자치구 참고·단지 40곳, 이 단지 값이 아닙니다");
  assert.match(page.text("mv-basis-line"), /^기준: 송파구 60㎡ 미만 — 자치구 전체 값\(자치구 참고\)이며 같은 단지 거래가 아닙니다\. 갱신 통계: 2024-11~2026-10 순수 전세 갱신 215건\. 층·향/);
  assert.doesNotMatch(page.text("mv-basis-line"), /같은 평형 신규 전세/);
});

test("단지를 안 골랐으면 금액만으로 계산한다고 적고, 단지 자료를 못 받으면 확인기는 다시 시도를, 비교 절은 직접 넣으라고 한다", async () => {
  const none = await open();
  assert.match(none.text("mv-basis-line"), /^기준: 고른 단지 없음 — 넣은 금액만으로 계산했습니다\./);
  await set(none, CASE1);
  assert.match(key(none), /^입력한 조건으로 24개월 비용 차이[^)]*\)이사가/);
  const failed = await open({ query: Q("헬리오시티", "84.98"), cells: null, status: 500 });
  assert.match(failed.html("check-answer"), /^이 자치구의 단지 자료를 불러오지 못했습니다\. <button type="button" id="check-retry">다시 시도<\/button>$/);
  assert.equal(failed.text("mv-ref-note"), "단지 자료를 불러오지 못했습니다. 금액과 금리를 직접 넣으면 계산합니다.");
});

test("확인기에서 칸을 바꾸면 비교 절이 따라 바뀐다(같은 장, 다시 넣지 않는다)", async () => {
  const page = await open({ query: Q("헬리오시티", "84.98") });
  assert.match(page.text("mv-ref-a"), /128,500만원/);
  const area = page.byId("check-area");
  area.value = "130.06";
  area.dispatch("change");
  await page.settle();
  assert.equal(page.byId("mv-ref-a").hidden, true);
});

test("근거 줄: 비교할 집 금액이 참고값이면 그 출처를 결과 옆에 적는다 - 자치구 값을 같은 단지 기준처럼 보이지 않게(po·legal #777 P3)", async () => {
  const page = await open({ query: Q("헬리오시티", "84.98") });
  await page.click("mv-ref-b");
  assert.match(page.text("mv-basis-line"), /^기준: 송파구 헬리오시티 84\.98㎡ — .* 비교할 집 금액: 송파구 60~85㎡ 자치구 참고값\(최근 6개월, 단지 75곳\) — 이 단지 값이 아닙니다\. 층·향/);
  await page.click("mv-ref-a");
  assert.match(page.text("mv-basis-line"), / 비교할 집 금액: 같은 단지·같은 평형 신규 전세 중간값\(최근 6개월 54건\)\. 층·향/);
  await set(page, { "mv-dep": "100000" });
  assert.doesNotMatch(page.text("mv-basis-line"), /비교할 집 금액/, "직접 넣은 값에 참고값 출처를 붙였다");
});

test("받기 실패: 근거 줄도 「고른 단지 없음」이 아니라 자료를 못 받았다고 하고, 다시 시도를 누르면 다시 받아 칸을 잇는다", async () => {
  const page = await open({ query: Q("헬리오시티", "84.98"), cells: null, status: 500 });
  assert.match(page.text("mv-basis-line"), /^단지 자료를 불러오지 못했습니다\./);
  page.data["renewal-cells-songpa"] = CELLS;
  page.byId("check-retry").onclick(); // 단추는 그릴 때마다 새로 만들어지므로 onclick 하나로 묶는다(가짜 DOM 의 click 은 리스너만 부른다)
  await page.settle();
  assert.equal(page.text("mv-ref-note"), "");
  assert.match(page.text("mv-ref-a"), /128,500만원/);
  assert.match(page.text("mv-basis-line"), /^기준: 송파구 헬리오시티 84\.98㎡/);
});

test("「단지 값이 없습니다」는 넘겨받은 단지가 목록에 없을 때만 - 자료 있는 단지에서 면적대를 손으로 골라도 나오지 않는다(legal)", async () => {
  const page = await open({ query: Q("헬리오시티", "b:60to85") });
  assert.equal(page.text("mv-ref-note"), "");
  assert.match(page.text("mv-basis-line"), /^기준: 송파구 60~85㎡ — 자치구 전체 값/);
});

test("면적대 경계는 AREA_BANDS 와 같다 - 60㎡ 는 60~85㎡, 85㎡ 는 85㎡ 이상, 59.96㎡ 는 60㎡ 미만(화면 두 곳: 확인기 내리기·자치구 참고 칸)", async () => {
  for (const [area, band, ref, pairs] of [["59.96", "60㎡ 미만", "52,000", 40], ["60", "60~85㎡", "80,000", 75], ["85", "85㎡ 이상", "150,000", 30]]) {
    const page = await open({ query: Q("헬리오시티", area) });
    assert.equal(page.text("mv-ref-b"), `송파구 ${band} 대표 전세 넣기 ${ref}만원 — 자치구 참고·단지 ${pairs}곳, 이 단지 값이 아닙니다`, area);
    const down = await open({ query: Q("없는단지", area) });
    assert.equal(down.text("mv-ref-note"), `이 단지·평형은 단지 값이 없습니다. 아래는 송파구 ${band} 전체 값입니다.`, `내리기 ${area}`);
  }
  assert.deepEqual(AREA_BANDS.map((b) => [b.min, b.max]), [[0, 60], [60, 85], [85, Infinity]]);
});

test("표본 부족은 두 줄 중 작은 쪽이 min.ratio 미만일 때 - 한 줄만 적어도 적는다", async () => {
  const page = await open({ query: Q("헬리오시티", "59.96") }); // 요구권 77건 · 표시 없음 2건
  assert.match(page.text("mv-basis-line"), / 표본 부족: 한 줄이 갱신 2건뿐이라 그 줄은 비율 대신 건수만 냅니다\./);
  const fine = await open({ query: Q("헬리오시티", "84.98") }); // 330 · 228
  assert.doesNotMatch(fine.text("mv-basis-line"), /표본 부족/);
});

// ---- P4: 계측 (#777 P4, audit/ga4-setup.md) ----
const wait = (ms = 900) => new Promise((r) => setTimeout(r, ms)); // 화면·analytics.js 의 800ms 안정 대기보다 길게
const events = (page, name) => JSON.parse(JSON.stringify((page.sandbox.dataLayer ?? []).map((a) => Array.from(a)))).filter(([k, n]) => k === "event" && n === name).map(([, , p]) => p);

test("계측: 화면의 안정 대기 = analytics.js SEARCH_DEBOUNCE_MS", () => {
  assert.equal(Number(BASIS.match(/const WAIT = (\d+);/)?.[1]), Number(ANALYTICS.match(/const SEARCH_DEBOUNCE_MS = (\d+);/)?.[1]));
});

test("계측: 비교 시작은 비교 절의 첫 조작에 한 번 - 장을 여는 것·확인기 입력·언어 전환은 시작이 아니다", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await set(page, { "check-old": "120000", "check-ask": "126000" });
  await page.click("lang-toggle");
  assert.equal(events(page, "compare_start").length, 0);
  await page.click("mv-ref-a");
  await set(page, { "mv-cash": "126000", "mv-months": "36" });
  assert.equal(events(page, "compare_start").length, 1);
  assert.equal(events(page, "compare_start")[0].calculator_type, "renewal_move");
});

test("계측: 결과는 안정된 입력 한 벌당 한 번(calculator_result 재사용) - 첫 결과 first, 조건을 바꾼 뒤 repeat, 다시 그리기·언어 전환은 세지 않는다", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await set(page, CASE1);
  await wait();
  let got = events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move");
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].result_status, got[0].result_scope, got[0].result_outcome, got[0].result_round], ["success", "matched_complex", "move", "first"]);
  await page.click("lang-toggle");
  await page.click("lang-toggle");
  await wait();
  assert.equal(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").length, 1, "언어 전환을 새 결과로 셌다");
  await set(page, { "mv-months": "12" });
  await set(page, { "mv-months": "1" });
  await set(page, { "mv-months": "12" });
  await wait();
  got = events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move");
  assert.equal(got.length, 2, "입력 중간값까지 셌다");
  assert.equal(got[1].result_round, "repeat");
});

test("계측: 비교 불가는 사유와 함께(잘못된 입력·80% 가정 초과), 빈 칸(입력 중)·자료 실패는 세지 않고 성공으로도 세지 않는다", async () => {
  const page = await open({ ga: true, conversion: null });
  await set(page, { "check-ask": "126000", "mv-dep": "80000" });
  await wait();
  assert.equal(events(page, "calculator_unavailable").length, 0, "빈 칸을 비교 불가로 셌다");
  await set(page, { "mv-cash": "20000", "mv-rate": "4", "mv-drate": "3" });
  await wait();
  assert.deepEqual(events(page, "calculator_unavailable").map((p) => p.unavailable_reason), ["cash_short"]);
  await set(page, { "mv-months": "200" });
  await wait();
  assert.deepEqual(events(page, "calculator_unavailable").map((p) => p.unavailable_reason), ["cash_short", "invalid_input"]);
  assert.equal(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").length, 0, "비교 불가를 성공으로 셌다");
});

test("계측: 확인기 칸의 한 줄이 표본 부족(min.show 미만)이면 renewal_vs_new 비교 불가(low_sample)를 칸마다 한 번", async () => {
  const thin = await open({ ga: true, query: Q("헬리오시티", "130.06") }); // 두 줄 다 4건 - 비율 대신 건수지만 표본 부족은 아니다
  assert.equal(events(thin, "calculator_unavailable").length, 0);
  const page = await open({ ga: true, query: Q("헬리오시티", "59.96") }); // 표시 없음 줄 2건 < 3
  await page.click("lang-toggle");
  const low = events(page, "calculator_unavailable");
  assert.equal(low.length, 1);
  assert.deepEqual([low[0].calculator_type, low[0].unavailable_reason], ["renewal_vs_new", "low_sample"]);
});

test("계측: 근거 상자를 처음 펼칠 때 한 번", async () => {
  const page = await open({ ga: true });
  const box = page.byId("mv-basis");
  for (const open of [true, false, true]) {
    box.open = open;
    box.dispatch("toggle");
  }
  assert.equal(events(page, "evidence_open").length, 1);
});

test("개인정보: 금액·금리·단지명은 GA 로 나가는 어떤 값에도 없다(page_location 포함)", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await set(page, { ...CASE1, "mv-dep": "40123", "mv-rent": "141.7", "mv-cash": "126543", "mv-rate": "4.37", "mv-drate": "3.21", "mv-months": "27" });
  await page.click("mv-basis") ;
  await wait();
  const sent = JSON.stringify(page.sandbox.dataLayer);
  for (const secret of ["40123", "141.7", "126543", "4.37", "3.21", "126000", "120000", "헬리오시티", encodeURIComponent("헬리오시티")]) assert.ok(!sent.includes(secret), `GA 로 ${secret} 가 나갔다`);
  assert.ok(events(page, "calculator_result").length >= 1, "결과 이벤트가 없다 - 이 시험이 아무것도 안 봤다");
});

test("참고값을 넣은 뒤 확인기 칸이나 종류를 바꾸면 그 금액의 출처를 지우고 직접 넣은 값으로 돌린다(po·legal #777 P3 재판정)", async () => {
  const page = await open({ query: Q("헬리오시티", "84.98") });
  await page.click("mv-ref-b"); // 60~85㎡ 자치구 참고 80,000
  assert.match(page.text("mv-basis-line"), /자치구 참고값\(최근 6개월, 단지 75곳\)/);
  const area = page.byId("check-area");
  area.value = "59.96";
  area.dispatch("change");
  await page.settle();
  assert.equal(page.byId("mv-dep").value, 80000, "금액은 그대로다");
  assert.doesNotMatch(page.text("mv-basis-line"), /비교할 집 금액/, "다른 칸의 단지 수를 그 금액의 출처로 적었다");
  assert.equal(page.text("mv-ref-note").endsWith("비교할 집: 직접 넣은 값입니다."), true);
  const again = await open({ query: Q("헬리오시티", "84.98") });
  await again.click("mv-ref-a"); // 전세 중간값
  await set(again, { "mv-kind": "wolse" });
  assert.doesNotMatch(again.text("mv-basis-line"), /비교할 집 금액/, "전세 참고값을 월세 비교의 출처로 남겼다");
});

test("계측: 칸을 비웠다가 같은 값을 다시 넣어도 같은 입력은 한 번만 센다(engineer #777 P4 결함)", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await set(page, CASE1);
  await wait();
  await set(page, { "mv-cash": "" });
  await wait();
  await set(page, { "mv-cash": "126000" });
  await wait();
  assert.deepEqual(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").map((p) => p.result_round), ["first"]);
});

test("계측: 첫 결과 전에 여러 번 고쳐도 첫 결과는 first, 비교 불가가 800ms 안에 풀리면 세지 않는다, 잘못된 입력을 잠깐만 둬도 세지 않는다", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await set(page, { ...CASE1, "mv-months": "1" });
  await set(page, { "mv-months": "12" });
  await set(page, { "mv-months": "24" });
  await wait();
  assert.deepEqual(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").map((p) => p.result_round), ["first"]);
  await set(page, { "mv-cash": "1000" }); // 80% 초과
  await wait(300);
  await set(page, { "mv-cash": "126000" });
  await set(page, { "mv-months": "500" }); // 잘못된 입력
  await wait(300);
  await set(page, { "mv-months": "24" });
  await wait();
  assert.equal(events(page, "calculator_unavailable").length, 0, "잠깐 지나간 상태를 비교 불가로 셌다");
});

test("계측: 참고값 단추 하나만 눌러도 비교 시작이다", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await page.click("mv-ref-b");
  assert.equal(events(page, "compare_start").length, 1);
});

// ---- P5: 일회성 비용과 손익분기 (#777 P5) ----
// data-analyst 사례 ③(#777): 재계약 126,000 vs 송파구 대표 전세 80,000, 내 돈 60,000, 4.23%·3.14%, 이사 쪽 일회성 620(이사비 300 + 중개보수 320 가정).
const input3 = (extra = {}) => ({ renew: 126000, kind: "jeonse", deposit: 80000, cash: 60000, loanRate: 4.23, depositRate: 3.14, months: 24, opportunity: true, oneMove: 620, ...extra });
const KO = (x) => Number(x).toLocaleString("ko-KR", { maximumFractionDigits: 1 });

test("손익분기: 월 비용은 이사가 162.2만원 덜, 일회성은 620만원 더 → 3개월은 재계약이 133.4 덜, 4개월째부터 이사가 덜(사례 ③)", () => {
  const at = (months) => compare(input3({ months }));
  assert.equal(at(3).renew.monthK - at(3).move.monthK, 1622);
  assert.equal(at(3).gapK, 1334);
  assert.equal(at(3).cheaper, "renew");
  assert.equal(at(4).gapK, -288);
  assert.equal(at(4).cheaper, "move", "기간에 따라 순위가 뒤집힌다");
  const d = describe(at(24), MSG("ko"), KO, "jeonse");
  assert.match(d.whatIf, /^일회성 비용까지 넣으면 4개월째부터 이사가 덜 듭니다\(그 전에는 재계약이 덜 듭니다\)\. 기간별: 12개월 이사가 1,326\.4만원 덜 · 24개월 이사가 3,272\.8만원 덜 · 36개월 /);
  assert.ok(d.rows.some(([l, a, b]) => l === "일회성 비용" && a === "0" && b === "620"), "일회성 비용 줄");
  const total = d.rows.find(([l]) => l === "합계");
  assert.equal(total[2], KO(at(24).move.totalK / 10));
  assert.equal(at(24).move.totalK, at(24).move.cashTotalK + at(24).move.oppK * 24 + 6200, "합계 = 기간 현금 + 기회비용 + 일회성");
});

test("손익분기: 나누어떨어지면 그 달에 같아지고, 엇갈리지 않거나 10년 밖이면 날짜를 만들지 않는다, 일회성이 없으면 기간별만", () => {
  const M = MSG("ko");
  const base = { renew: 100000, kind: "wolse", deposit: 100000, cash: 100000, loanRate: 4, depositRate: 0, months: 24, opportunity: false };
  const w = (extra) => describe(compare({ ...base, ...extra }), M, KO, "wolse").whatIf;
  // 이사 쪽 월세 100 이 매달 더 들고, 재계약 쪽 일회성 300 이 처음에 더 든다 → 3개월째 같아진다
  assert.match(w({ rent: 100, oneRenew: 300 }), /^3개월째에 두 선택지의 비용이 같아지고, 그 뒤로는 재계약이 덜 듭니다\./);
  // 이사가 월세도 더, 일회성도 더 → 엇갈리지 않는다
  assert.match(w({ rent: 100, oneMove: 300 }), /^일회성 비용을 넣어도 기간과 상관없이 같은 쪽이 덜 듭니다\./);
  // 월 차이 0.1만원, 일회성 차이 50만원 → 500개월 = 10년 밖
  assert.match(w({ rent: 0.1, oneRenew: 50 }), /^일회성 비용을 넣어도 10년\(120개월\) 안에는 덜 드는 쪽이 바뀌지 않습니다\./);
  assert.match(w({ rent: 100 }), /^기간별: 12개월 재계약이 1,200만원 덜 · /, "일회성 없이 손익분기 문장을 만들었다");
  assert.equal(describe(compare({ ...base, rent: 100 }), M, KO, "wolse").rows.some(([l]) => l === "일회성 비용"), false);
});

test("일회성 비용 입력: 비우면 0, 음수는 칸 이름과 사유", () => {
  assert.equal(compare(input3({ oneMove: "" })).move.oneK, 0);
  const bad = compare(input3({ oneMove: -1 }));
  assert.deepEqual(bad.errors, [{ field: "oneMove", code: "range" }]);
  assert.equal(describe(bad, MSG("ko"), KO, "jeonse").text, "이사 쪽 일회성 비용: 0 이상이어야 합니다.");
});

test("화면: 일회성 비용을 넣으면 「조건을 바꾸면」 줄이 손익분기와 기간별 차이를 보이고, 표에 일회성 줄이 생긴다", async () => {
  const page = await open();
  await set(page, { "check-ask": "126000", "mv-dep": "80000", "mv-cash": "60000" });
  assert.match(page.text("mv-what-if"), /^기간별: 12개월 이사가/);
  await set(page, { "mv-once-move": "620" });
  assert.equal(page.text("mv-what-if"), describe(compare(input3()), MSG("ko"), KO, "jeonse").whatIf);
  assert.match(page.html("mv-table"), /<tr><th scope="row">일회성 비용<\/th><td>0<\/td><td>620<\/td><\/tr>/);
  assert.match(page.text("mv-once-help"), /법정 요율은 상한이며 이 화면은 계산하지 않습니다/);
  await set(page, { "mv-cash": "1000" });
  assert.equal(page.text("mv-what-if"), "", "견줄 수 없는데 손익분기를 만들었다");
});

test("네 스크립트가 찾는 id 는 모두 구운 장에 있다 - 가짜 DOM 은 없는 id 도 만들어 주므로 이 시험이 대신 본다", () => {
  const ids = new Set([...[CALC, TEXT, JS, BASIS].join("\n").matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));
  for (const id of SECTION.match(/data-i18n="([^"]+)"/)[1].split(" ")) ids.add(id);
  assert.ok(ids.size > 25, `id 를 ${ids.size}개밖에 못 찾았다`);
  const missing = [...ids].filter((id) => !HTML.includes(`id="${id}"`) && id !== "check-retry"); // check-retry 는 실패 때 basis 가 만든다
  assert.deepEqual(missing, []);
});

test("손익분기 경계: 정확히 120개월이면 그 달에 같아지고, 121개월이면 10년 안에 안 바뀐다, 1개월 미만이면 「그 전」이 없으니 기간과 상관없음(data-analyst #777 P5)", () => {
  const M = MSG("ko");
  const base = { renew: 100000, kind: "wolse", deposit: 100000, cash: 100000, loanRate: 4, depositRate: 0, months: 24, opportunity: false };
  const w = (extra) => describe(compare({ ...base, ...extra }), M, KO, "wolse").whatIf;
  assert.match(w({ rent: 0.1, oneRenew: 12 }), /^120개월째에 두 선택지의 비용이 같아지고/); // 월 0.1만원 × 120 = 12만원
  assert.match(w({ rent: 0.1, oneRenew: 12.1 }), /^일회성 비용을 넣어도 10년\(120개월\) 안에는/);
  assert.match(w({ rent: 100, oneRenew: 50 }), /^일회성 비용을 넣어도 기간과 상관없이 같은 쪽이 덜 듭니다\./, "0.5개월에 「그 전에는」을 만들었다");
  assert.match(w({ rent: 100, oneRenew: 100 }), /^1개월째에 두 선택지의 비용이 같아지고/);
});

test("현금 기준 비교에도 일회성 비용을 넣고, 「조건을 바꾸면」 줄에는 제목과 같은 기준을 붙인다(po #777 P5 재현 사례)", () => {
  // 재계약 50,000 vs 월세 10,000·60, 내 돈 50,000, 4%·3.5%, 이사 쪽 일회성 300 - 기회비용을 켜면 이사가, 현금만 보면 재계약이 덜 든다
  const input = { renew: 50000, kind: "wolse", deposit: 10000, rent: 60, cash: 50000, loanRate: 4, depositRate: 3.5, months: 24, opportunity: true, oneMove: 300 };
  const r = compare(input);
  assert.equal(r.cashGapK, 600 * 24 + 3000, "현금 기준 차이에 일회성 300만원이 빠졌다");
  assert.equal(r.cashCheaper, "renew");
  const d = describe(r, MSG("ko"), KO, "wolse");
  assert.match(d.key, /<p> 현금 지출만 보면 재계약이 1,740만원 덜 듭니다\.<\/p>$/);
  assert.match(d.whatIf, / \(현금 지출 \+ 묶인 내 돈의 세후 예금이자 기준\)\.$/);
  assert.match(describe(compare({ ...input, opportunity: false }), MSG("ko"), KO, "wolse").whatIf, / \(현금 지출 기준\)\.$/);
  const EN = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 1 });
  assert.match(describe(r, MSG("en"), EN, "wolse").whatIf, / less \(cash spent plus after-tax deposit interest forgone\)\.$/, "괄호 앞을 띄운다(영어 띄어쓰기, po #777 P5)");
  assert.deepEqual(compare({ ...input, oneRenew: -1 }).errors, [{ field: "oneRenew", code: "range" }]);
});

test("화면: 재계약 쪽 일회성 칸도 계산에 들어가고, 요구 보증금을 지우면 「조건을 바꾸면」 줄도 지운다", async () => {
  const page = await open();
  await set(page, { "check-ask": "126000", "mv-dep": "80000", "mv-cash": "60000", "mv-once-renew": "50" });
  assert.match(page.html("mv-table"), /<tr><th scope="row">일회성 비용<\/th><td>50<\/td><td>0<\/td><\/tr>/);
  assert.equal(page.text("mv-what-if"), describe(compare(input3({ oneMove: "", oneRenew: 50 })), MSG("ko"), KO, "jeonse").whatIf);
  await set(page, { "check-ask": "" });
  assert.equal(page.text("mv-what-if"), "");
});

test("계측: 일회성 비용만 바꿔도 새 결과(repeat)로 센다 - 서명에 일회성 칸이 들어 있다", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await set(page, CASE1);
  await wait();
  await set(page, { "mv-once-move": "300" });
  await wait();
  assert.deepEqual(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").map((p) => p.result_round), ["first", "repeat"]);
});

// ---- #792 보완 지시서: 요구 보증금 입력 흐름 · 빈칸과 잘못된 값 · 계산에 쓴 금리 ----
test("#792-1 요구 보증금: 통계에는 선택, 비용 비교에는 필요 - ① 칸과 확인기 칸은 같은 값 하나(어느 쪽에 넣어도 같이 바뀐다)", async () => {
  const page = await open({ query: Q("헬리오시티", "84.98") });
  assert.match(HTML, /<label for="check-ask" id="check-ask-label">요구 보증금\(만원\)<\/label><input[^>]*><p class="updated mv-won" id="check-ask-won"><\/p><\/div>\s*<\/div>\s*<p class="updated" id="check-ask-hint"[^>]*>두 보증금은 통계를 보는 데는 넣지 않아도 됩니다\. 요구 보증금은 아래 「재계약·이사 비용 비교」에 필요합니다\.<\/p>/);
  // 필수 세 칸 → 결과(핵심 숫자) → 상세 표·선택 조건(접기) 순서(#797 3)
  assert.match(SECTION, /<h3 id="mv-s1"[^>]*>① 재계약 조건<\/h3>[\s\S]*<label for="mv-ask" id="mv-ask-label"[^>]*>재계약 요구 보증금\(만원, 필요\)<\/label>[\s\S]*<h3 id="mv-s2"[^>]*>② 다른 집 조건<\/h3>[\s\S]*id="mv-dep"[\s\S]*<h3 id="mv-s3"[^>]*>③ 내 돈<\/h3>[\s\S]*id="mv-cash"[\s\S]*<h3 id="mv-s4"[^>]*>결과<\/h3>[\s\S]*id="mv-key"[\s\S]*id="mv-answer"[\s\S]*<details id="mv-table-box">[\s\S]*id="mv-table"[\s\S]*<details id="mv-more">[\s\S]*id="mv-rate"[\s\S]*id="mv-once-move"[\s\S]*id="mv-opp"/, "입력·결과 순서가 다르다");
  assert.match(page.text("check-answer"), /^이 평형 전세 재계약 558건/, "요구 보증금 없이 통계가 보여야 한다");
  await set(page, { "check-old": "120000", "mv-ask": "126000" });
  assert.equal(page.byId("check-ask").value, "126000", "① 칸 값이 확인기 칸으로 가지 않았다");
  assert.match(page.text("check-answer"), / 요구액은 종전보다 5% — /, "① 칸에 넣었는데 확인기가 다시 그려지지 않았다");
  await set(page, { "check-ask": "130000" });
  assert.equal(page.byId("mv-ask").value, "130000", "확인기 칸 값이 ① 칸에 비치지 않았다");
  await set(page, { "mv-dep": "128500", "mv-cash": "126000" });
  assert.match(key(page), /^입력한 조건으로 24개월 비용 차이/);
  await page.click("lang-toggle");
  assert.equal(page.text("mv-s1"), "1. Renewal terms");
  assert.equal(page.text("mv-ask-label"), "Asked deposit (10k won, needed)");
  assert.equal(page.byId("mv-ask").value, "130000", "언어를 바꾸자 값이 사라졌다");
});

test("#792-2 빈칸은 넣으라는 안내, 0·음수·숫자가 아닌 값은 그 칸 바로 아래 오류 - 이전 결과·손익분기는 남지 않고, 고치면 다시 계산한다", async () => {
  const page = await open({ ga: true });
  await set(page, { "mv-dep": "80000", "mv-cash": "60000", "mv-once-move": "620" });
  assert.equal(answer(page), "① 재계약 요구 보증금을 넣으면 견줍니다.");
  assert.equal(page.text("mv-err-ask"), "", "빈칸을 오류로 보였다");
  await set(page, { "mv-ask": "126000" });
  assert.match(page.text("mv-what-if"), /4개월째부터 이사가 덜/);
  for (const bad of ["0", "-100"]) {
    await set(page, { "mv-ask": bad });
    assert.equal(page.text("mv-err-ask"), "요구 보증금: 0보다 커야 합니다.", bad);
    assert.equal(answer(page), "요구 보증금: 0보다 커야 합니다.", bad);
    assert.equal(page.html("mv-table"), "", `${bad}: 이전 표가 남았다`);
    assert.equal(page.text("mv-what-if"), "", `${bad}: 이전 손익분기가 남았다`);
  }
  // 숫자로 읽히지 않는 글자(브라우저는 value 를 비우고 validity.badInput 을 켠다)는 빈칸이 아니라 잘못된 값이다.
  await set(page, { "mv-ask": "126000" });
  assert.equal(page.text("mv-err-ask"), "");
  page.byId("mv-ask").validity = { badInput: true };
  await set(page, { "mv-ask": "" });
  assert.equal(page.text("mv-err-ask"), "요구 보증금: 0보다 커야 합니다.");
  page.byId("mv-ask").validity = { badInput: false };
  await wait();
  assert.deepEqual(events(page, "calculator_unavailable").map((p) => p.unavailable_reason), ["invalid_input"]);
  await set(page, { "mv-ask": "126000" });
  assert.equal(page.text("mv-err-ask"), "");
  assert.match(key(page), /^입력한 조건으로 24개월 비용 차이[^)]*\)이사가/);
  assert.match(page.text("mv-what-if"), /4개월째부터 이사가 덜/);
  await wait();
  assert.equal(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").length, 1, "고친 뒤 결과를 세지 않았다");
  // 다른 칸의 잘못된 값도 그 칸 묶음 아래에
  await set(page, { "mv-months": "200", "mv-cash": "-1" });
  assert.equal(page.text("mv-err-loan"), "거주 기간: 1~120개월이어야 합니다.");
  assert.equal(page.text("mv-err-cash"), "보증금에 넣을 내 돈: 0 이상이어야 합니다.");
  assert.equal(page.text("mv-err-ask"), "");
});

test("#792-2 빈칸을 채우는 중은 비교 불가로도 결과로도 세지 않는다", async () => {
  const page = await open({ ga: true });
  await set(page, { "mv-ask": "126000", "mv-dep": "80000" });
  await wait();
  assert.equal(events(page, "calculator_unavailable").length, 0);
  assert.equal(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").length, 0);
});

const RATES = (page) => page.text("mv-basis-line").match(/ 계산에 쓴 금리: .*?(?= 층·향·동)/)?.[0] ?? "";
test("#792-3 근거 줄은 실제 계산에 쓴 금리와 출처를 적는다 - 평균 그대로·대출만·예금만·둘 다 고침·평균값으로 되돌림, 계산 결과는 출처와 무관", async () => {
  const page = await open();
  await set(page, CASE1);
  const ref = " 계산에 쓴 금리: 대출 4.23%(한국은행 평균, 2026-08) · 예금 3.14%(한국은행 평균, 2026-08).";
  assert.equal(RATES(page), ref);
  const before = answer(page);
  await set(page, { "mv-rate": "3.5" });
  assert.equal(RATES(page), " 계산에 쓴 금리: 대출 3.5%(직접 넣은 값) · 예금 3.14%(한국은행 평균, 2026-08). 참고 평균금리(한국은행): 대출 4.23%(2026-08) · 예금 3.14%(2026-08).");
  assert.match(page.text("mv-rate-note"), /^대출 금리: 직접 넣은 값입니다\. 예금 금리: 한국은행/);
  await set(page, { "mv-rate": "4.23", "mv-drate": "2.9" });
  assert.equal(RATES(page), " 계산에 쓴 금리: 대출 4.23%(한국은행 평균, 2026-08) · 예금 2.9%(직접 넣은 값). 참고 평균금리(한국은행): 대출 4.23%(2026-08) · 예금 3.14%(2026-08).");
  assert.match(page.text("mv-rate-note"), /^대출 금리: 한국은행 .* 예금 금리: 직접 넣은 값입니다\(세후로 셉니다\)\.$/);
  await set(page, { "mv-rate": "5", "mv-drate": "3" });
  assert.match(RATES(page), /^ 계산에 쓴 금리: 대출 5%\(직접 넣은 값\) · 예금 3%\(직접 넣은 값\)\. 참고 평균금리/);
  await set(page, { "mv-rate": "4.23", "mv-drate": "3.14" });
  assert.equal(RATES(page), ref, "평균값으로 되돌렸는데 직접 넣은 값으로 적었다");
  assert.equal(answer(page), before, "출처 표시가 계산 결과를 바꿨다");
  await page.click("lang-toggle");
  assert.match(page.text("mv-basis-line"), / Rates used: loan 4\.23% \(Bank of Korea average, 2026-08\) · deposit 3\.14% \(Bank of Korea average, 2026-08\)\./);
});

test("#792-3 기회비용을 끄면 예금 금리는 계산에 쓰지 않았다고 입력 쪽·근거 줄이 같이 말하고, 자료를 못 받으면 둘 다 직접 넣은 값", async () => {
  const page = await open();
  await set(page, { ...CASE1, "mv-opp": false });
  assert.equal(RATES(page), " 계산에 쓴 금리: 대출 4.23%(한국은행 평균, 2026-08) · 예금 금리는 쓰지 않았습니다(기회비용 끔).");
  assert.match(page.text("mv-rate-note"), / 예금 금리: 기회비용을 끄면 계산에 쓰지 않습니다\.$/);
  const failed = await open({ conversion: null });
  await set(failed, { ...CASE1, "mv-rate": "4", "mv-drate": "3" });
  assert.equal(RATES(failed), " 계산에 쓴 금리: 대출 4%(직접 넣은 값) · 예금 3%(직접 넣은 값).", "자료가 없는데 한국은행 평균을 적었다");
  const blank = await open();
  assert.equal(RATES(blank), "", "결과가 없는데 계산에 쓴 금리를 적었다");
});

test("#792-2 빈칸은 칸 옆 오류에 섞지 않고, 숫자가 아닌 글자는 어느 칸이든 잘못된 값이다", async () => {
  const page = await open();
  await set(page, { ...CASE1, "mv-dep": "", "mv-months": "200" });
  assert.equal(page.text("mv-err-dep"), "", "빈칸을 오류로 보였다");
  assert.equal(page.text("mv-err-loan"), "거주 기간: 1~120개월이어야 합니다.");
  assert.equal(answer(page), "넣을 칸: 비교할 집 보증금");
  await set(page, { "mv-dep": "40000", "mv-months": "24" });
  for (const [id, group, name] of [["mv-dep", "dep", "비교할 집 보증금"], ["mv-cash", "cash", "보증금에 넣을 내 돈"], ["mv-rate", "loan", "대출 금리"], ["mv-months", "loan", "거주 기간"]]) {
    page.byId(id).validity = { badInput: true };
    await set(page, { [id]: "" });
    assert.match(page.text(`mv-err-${group}`), new RegExp(`^${name}: `), `${id}: 숫자가 아닌 글자를 빈칸으로 봤다`);
    assert.doesNotMatch(answer(page), /^넣을 칸/, id);
    page.byId(id).validity = { badInput: false };
    await set(page, { [id]: CASE1[id] ?? (id === "mv-rate" ? "4.23" : id === "mv-months" ? "24" : "40000") });
  }
  assert.match(key(page), /^입력한 조건으로 24개월 비용 차이/);
});

test("#792-3 근거 줄의 금리는 실제 계산에 쓴 값 - 4.234 를 넣으면 bp 로 반올림한 4.23(평균과 같으면 평균으로 적는다)", async () => {
  const page = await open();
  await set(page, { ...CASE1, "mv-rate": "4.234", "mv-drate": "3.2049" });
  assert.equal(RATES(page), " 계산에 쓴 금리: 대출 4.23%(한국은행 평균, 2026-08) · 예금 3.2%(직접 넣은 값). 참고 평균금리(한국은행): 대출 4.23%(2026-08) · 예금 3.14%(2026-08).");
  assert.equal(compare({ ...input1(), loanRate: 4.234 }).gapK, compare(input1()).gapK, "계산이 4.23 을 쓰지 않는다");
});

// ---- #792 5: 선택지별 대출 금리 ----
const SPLIT = { renew: 126000, kind: "jeonse", deposit: 100000, cash: 60000, loanRate: 4.23, depositRate: 3.14, months: 24, opportunity: true };
test("#792-5 계산: 두 금리가 같으면 공통 금리와 결과가 같고, 금리 차이로 순위가 바뀐다, 대출 없는 선택지는 그 금리와 무관", () => {
  const common = compare(SPLIT);
  const same = compare({ ...SPLIT, split: true, renewRate: 4.23, moveRate: 4.23 });
  assert.deepEqual(same, common, "같은 금리인데 결과가 다르다");
  assert.equal(common.cheaper, "move");
  assert.equal(common.gapK, -22008);
  const diff = compare({ ...SPLIT, split: true, renewRate: 2.5, moveRate: 6 }); // 기존 대출 2.5% 를 두는 재계약 vs 6% 새 대출
  assert.equal(diff.cheaper, "renew", "금리 차이로 순위가 바뀌지 않았다");
  assert.equal(diff.gapK, 15000);
  assert.equal(diff.renew.interestK, 1375); // 66,000 × 2.5% ÷ 12
  assert.equal(diff.move.interestK, 2000); // 40,000 × 6% ÷ 12
  const noLoan = { ...SPLIT, cash: 130000 };
  assert.equal(compare({ ...noLoan, split: true, renewRate: 1, moveRate: 19 }).gapK, compare({ ...noLoan, split: true, renewRate: 9, moveRate: 2 }).gapK, "대출 없는 쪽 금리가 결과를 바꿨다");
  assert.deepEqual(compare({ ...SPLIT, split: true, renewRate: "", moveRate: 30, loanRate: "" }).errors, [{ field: "renewRate", code: "required" }, { field: "moveRate", code: "range" }], "켜면 공통 금리는 묻지 않는다");
});

test("#792-5 화면: 켜면 지금 금리를 두 칸에 옮기고, 끄면 공통 금리로, 다시 켜면 두 칸 값이 그대로 - 결과·표·손익분기가 같은 금리를 쓴다", async () => {
  const page = await open();
  await set(page, { "mv-ask": "126000", "mv-dep": "100000", "mv-cash": "60000", "mv-once-move": "300" });
  assert.equal(page.byId("mv-rr-field").hidden, true);
  const commonText = answer(page);
  page.byId("mv-split").checked = true;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  assert.equal(page.byId("mv-rate-renew").value, "4.23");
  assert.equal(page.byId("mv-rate-move").value, "4.23");
  assert.equal(page.byId("mv-rate-field").hidden, true);
  assert.equal(page.byId("mv-rr-field").hidden, false);
  assert.equal(answer(page), commonText, "같은 금리를 옮겨 넣었는데 결과가 바뀌었다");
  await set(page, { "mv-rate-renew": "2.5", "mv-rate-move": "6" });
  const input = { ...SPLIT, split: true, renewRate: "2.5", moveRate: "6", oneMove: "300" };
  const want = describe(compare(input), MSG("ko"), KO, "jeonse");
  assert.equal(answer(page), want.text);
  assert.equal(page.text("mv-what-if"), want.whatIf);
  assert.ok(page.html("mv-table").includes(`<tr><th scope="row">월 이자</th><td>137.5</td><td>200</td></tr>`), page.html("mv-table"));
  assert.match(page.text("mv-basis-line"), / 계산에 쓴 금리: 재계약 대출 2\.5%\(직접 넣은 값\) · 이사 대출 6%\(직접 넣은 값\) · 예금 3\.14%\(한국은행 평균, 2026-08\)\. 참고 평균금리/);
  assert.equal(page.byId("mv-rm-field").hidden, false, "이사 쪽 금리 칸이 숨겨져 있다");
  assert.equal(page.text("mv-rate-note").startsWith("대출 금리: 재계약 직접 넣은 값 · 이사 직접 넣은 값."), true, page.text("mv-rate-note"));
  page.byId("mv-split").checked = false;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  assert.equal(answer(page), commonText, "끄면 공통 금리로 돌아가야 한다");
  assert.equal(page.byId("mv-rate-renew").value, "2.5", "끄면서 두 칸 값을 지웠다");
  page.byId("mv-split").checked = true;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  assert.equal(answer(page), want.text, "다시 켰는데 두 칸 값이 그대로가 아니다");
});

test("#792-5 잘못된 선택지별 금리는 금리 칸 아래 오류, 빈칸은 넣을 칸 - 금리는 GA 로 나가지 않는다", async () => {
  const page = await open({ ga: true });
  await set(page, { "mv-ask": "126000", "mv-dep": "100000", "mv-cash": "60000" });
  page.byId("mv-split").checked = true;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  await set(page, { "mv-rate-renew": "25" });
  assert.equal(page.text("mv-err-loan"), "재계약 쪽 대출 금리: 0~20% 사이여야 합니다.");
  assert.equal(page.html("mv-table"), "");
  await set(page, { "mv-rate-renew": "", "mv-rate-move": "6.17" });
  assert.equal(answer(page), "넣을 칸: 재계약 쪽 대출 금리");
  await set(page, { "mv-rate-renew": "2.57" });
  await wait();
  const sent = JSON.stringify(page.sandbox.dataLayer);
  for (const secret of ["2.57", "6.17", "126000"]) assert.ok(!sent.includes(secret), `GA 로 ${secret} 가 나갔다`);
  assert.ok(events(page, "calculator_result").length >= 1);
});

test("#792-5 한쪽만 평균이면 그 칸만 「한국은행 평균」, 평균으로 둔 칸이 있으면 「새로 받는 금리가 아님」을 남긴다 - 재계약만 기존 금리로 고치는 흔한 경우", async () => {
  const page = await open();
  await set(page, { "mv-ask": "126000", "mv-dep": "100000", "mv-cash": "60000" });
  page.byId("mv-split").checked = true;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  assert.match(page.text("mv-rate-note"), /^대출 금리: 재계약 한국은행 평균, 2026-08 · 이사 한국은행 평균, 2026-08\. 평균으로 둔 칸은 .*개인이 새로 받는 금리가 아닙니다\./);
  await set(page, { "mv-rate-renew": "2.5" });
  assert.match(page.text("mv-rate-note"), /^대출 금리: 재계약 직접 넣은 값 · 이사 한국은행 평균, 2026-08\. 평균으로 둔 칸은/);
  assert.match(page.text("mv-basis-line"), / 계산에 쓴 금리: 재계약 대출 2\.5%\(직접 넣은 값\) · 이사 대출 4\.23%\(한국은행 평균, 2026-08\) · /);
  await set(page, { "mv-rate-renew": "4.23", "mv-rate-move": "6" });
  assert.match(page.text("mv-basis-line"), / 재계약 대출 4\.23%\(한국은행 평균, 2026-08\) · 이사 대출 6%\(직접 넣은 값\) · /, "이사 쪽 출처를 재계약 칸으로 판정했다");
  await set(page, { "mv-rate-renew": "3", "mv-rate-move": "6" });
  assert.doesNotMatch(page.text("mv-rate-note"), /평균으로 둔 칸은/, "평균으로 둔 칸이 없는데 경고를 남겼다");
});

test("#792-5 계측: 선택지별 금리만 바꿔도 새 결과(repeat)로 센다 - 서명에 켬/끔과 두 금리가 들어 있다", async () => {
  const page = await open({ ga: true });
  await set(page, { "mv-ask": "126000", "mv-dep": "100000", "mv-cash": "60000" });
  page.byId("mv-split").checked = true;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  await wait();
  await set(page, { "mv-rate-move": "6" });
  await wait();
  assert.deepEqual(events(page, "calculator_result").filter((p) => p.calculator_type === "renewal_move").map((p) => p.result_round), ["first", "repeat"]);
});

// ---- #797 모바일 사용성 ----
test("#797-2 근거 상자의 대출 금리 문구는 금리를 나눴는지에 맞춰 하나만 보인다", async () => {
  const page = await open();
  assert.equal(page.byId("mv-why-c").hidden, false);
  assert.equal(page.byId("mv-why-c2").hidden, true);
  page.byId("mv-split").checked = true;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  assert.equal(page.byId("mv-why-c").hidden, true, "선택지별 금리를 켰는데 「금리 하나로 계산」 문구가 보인다");
  assert.equal(page.byId("mv-why-c2").hidden, false);
  assert.match(SECTION, /<li id="mv-why-c2"[^>]*hidden>「선택지별 대출 금리 다르게 넣기」를 켠 동안에는 재계약 쪽에 넣은 금리\(기존 대출 포함\)와 이사 쪽에 넣은 금리를 각각 씁니다\.<\/li>/);
});

test("#797-5 금액 읽기: 만원 칸 바로 아래 「= 5억원」·「= 12억 6,000만원」, 1억 미만·빈 값·음수·잘못된 값은 비우고, 영어는 원 단위", async () => {
  const page = await open();
  for (const [value, want] of [["50000", "= 5억원"], ["126000", "= 12억 6,000만원"], ["9999", ""], ["", ""], ["-100", ""], ["126000.5", ""]]) {
    await set(page, { "mv-ask": value });
    assert.equal(page.text("mv-ask-won"), want, value);
    assert.equal(page.text("check-ask-won"), want, `${value}: 확인기 칸 아래도 같은 값이어야 한다`);
  }
  page.byId("mv-dep").validity = { badInput: true };
  await set(page, { "mv-dep": "" });
  assert.equal(page.text("mv-dep-won"), "", "숫자가 아닌 글자에 금액을 보였다");
  page.byId("mv-dep").validity = { badInput: false };
  await set(page, { "mv-dep": "80000", "mv-cash": "60000", "check-old": "120000", "mv-once-move": "12000" });
  assert.equal(page.text("mv-dep-won"), "= 8억원");
  assert.equal(page.text("mv-cash-won"), "= 6억원");
  assert.equal(page.text("check-old-won"), "= 12억원");
  assert.equal(page.text("mv-once-move-won"), "= 1억 2,000만원");
  await page.click("lang-toggle");
  assert.equal(page.text("mv-dep-won"), "= ₩800,000,000");
});

test("#797-4 핵심 숫자: 기간 비용 차이·두 월 현금 지출·일회성·예금이자 포함 여부 - 같으면 덜 든다고 하지 않고, 견줄 수 없거나 오류면 숨기며 이전 값이 남지 않는다", async () => {
  const page = await open();
  assert.equal(page.html("mv-key"), "", "입력 전에 핵심 숫자를 보였다");
  assert.equal(page.byId("mv-key").hidden, false, "알림 영역은 숨기지 않고 비운다(#799)");
  await set(page, CASE1);
  const r = compare(input1());
  assert.equal(page.html("mv-key"), describe(r, MSG("ko"), KO, "wolse").key, "화면 = 문장 모듈");
  assert.match(page.html("mv-key"), /^<p><span>입력한 조건으로 24개월 비용 차이\(현금 지출 \+ 묶인 내 돈의 세후 예금이자 기준\)<\/span><strong>이사가 1,209\.6만원 덜 듭니다<\/strong><\/p><p><span>재계약 월 현금 지출<\/span><strong>0만원<\/strong><span>이사 월 현금 지출<\/span><strong>140만원<\/strong><\/p><p>일회성 비용 넣지 않음\(0으로 계산\) · 묶인 내 돈의 세후 예금이자 포함<\/p><p> 현금 지출만 보면 재계약이 3,360만원 덜 듭니다\.<\/p>$/);
  assert.doesNotMatch(page.html("mv-key"), /보증금|대출/, "핵심 숫자에 보증금·원금을 섞었다");
  await set(page, { "mv-once-move": "300", "mv-opp": false });
  assert.match(page.html("mv-key"), /^<p><span>입력한 조건으로 24개월 비용 차이\(현금 지출 기준\)<\/span>[\s\S]*<p>일회성 비용 포함\(재계약 0 · 이사 300만원\) · 예금이자 넣지 않음<\/p><p><\/p>$/, "예금이자를 빼면 현금 기준 줄은 비고 CSS 가 숨긴다");
  await set(page, { "check-ask": "50000", "mv-kind": "jeonse", "mv-dep": "40000", "mv-cash": "60000", "mv-once-move": "" });
  assert.match(page.html("mv-key"), /<strong>두 선택지의 비용이 같습니다<\/strong>/);
  assert.doesNotMatch(page.html("mv-key"), /덜 듭니다/, "같은데 덜 든다고 했다");
  await set(page, { "check-ask": "126000", "mv-dep": "80000", "mv-cash": "1000" });
  assert.equal(page.html("mv-key"), "", "80% 가정을 넘었는데 핵심 숫자를 보였다");
  await set(page, { "mv-cash": "60000" });
  assert.notEqual(page.html("mv-key"), "");
  await set(page, { "mv-ask": "-100" });
  assert.equal(page.html("mv-key"), "", "잘못된 입력인데 이전 핵심 숫자가 남았다");
});

test("#797-3 「선택 조건」 제목 줄은 접어도 지금 가정을 요약하고, 그 안의 칸이 비었거나 잘못되면 펼친다", async () => {
  const page = await open();
  assert.equal(page.text("mv-more-now"), " 대출 4.23% · 24개월 · 일회성 비용 넣지 않음(0으로 계산) · 묶인 내 돈의 세후 예금이자 포함");
  await set(page, { "mv-once-move": "620", "mv-opp": false });
  assert.equal(page.text("mv-more-now"), " 대출 4.23% · 24개월 · 일회성 비용 포함(재계약 0 · 이사 620만원) · 예금이자 넣지 않음");
  page.byId("mv-split").checked = true;
  page.byId("mv-split").dispatch("change");
  await page.settle();
  assert.match(page.text("mv-more-now"), /^ 대출 재계약 4\.23% · 이사 4\.23% · 24개월 · /);
  page.byId("mv-more").open = false;
  await set(page, { ...CASE1, "mv-months": "200" });
  assert.equal(page.byId("mv-more").open, true, "선택 조건 칸이 잘못됐는데 접힌 채로 뒀다");
  page.byId("mv-more").open = false;
  await set(page, { "mv-months": "24", "mv-dep": "-1" });
  assert.equal(page.byId("mv-more").open, false, "필수 칸 오류인데 선택 조건을 펼쳤다");
});

test("#797-3 위의 두 입구·결과↔조건 이동 링크는 이 장 안 조각으로 가고, 고정 위치 단추를 두지 않는다(키보드가 칸을 가리지 않게)", () => {
  assert.match(HTML, /<nav class="page-jump" id="page-jump"[^>]*>\s*<a href="#check-section"><strong id="jump-check"[^>]*>우리 단지 재계약 시세 확인<\/strong>[\s\S]*<a href="#move"><strong id="jump-move"[^>]*>재계약·이사 비용 비교<\/strong>/);
  assert.ok(HTML.indexOf('id="page-jump"') < HTML.indexOf('<section id="check-section"'), "두 입구가 확인기보다 위에 있어야 한다");
  for (const [id, href] of [["mv-edit", "#mv-s1"], ["mv-to-more", "#mv-more"], ["mv-to-result", "#mv-s4"]]) assert.match(SECTION, new RegExp(`<a [^>]*href="${href}" id="${id}"`), id);
  assert.match(HTML, /<h2 id="check-heading">우리 단지 재계약 시세 확인<\/h2>/);
  assert.match(SECTION, /<h2 id="mv-heading"[^>]*>재계약·이사 비용 비교<\/h2>/);
  for (const css of [CSS_BASE]) assert.doesNotMatch(css.slice(css.indexOf("재계약 장(#797)")), /position:\s*(fixed|sticky)/, "고정 위치 요소를 더했다");
});

test("#797 계측: 새 접기 상자(선택 조건·상세 표)를 펼쳐도 근거 펼치기로 세지 않고, 이벤트 종류가 늘지 않는다", async () => {
  const page = await open({ ga: true, query: Q("헬리오시티", "84.98") });
  await set(page, CASE1);
  for (const id of ["mv-more", "mv-table-box"]) {
    page.byId(id).open = true;
    page.byId(id).dispatch("toggle");
  }
  await wait();
  assert.equal(events(page, "evidence_open").length, 0);
  const names = new Set(JSON.parse(JSON.stringify(page.sandbox.dataLayer.map((a) => Array.from(a)))).filter(([k]) => k === "event").map(([, n]) => n));
  assert.deepEqual([...names].sort(), ["calculator_result", "compare_start"].sort());
});

test("#797-3 결과 아래 「선택 조건 ↓」 링크는 접힌 상자로 옮겨 가며 연다", async () => {
  const page = await open();
  page.byId("mv-more").open = false;
  await page.click("mv-to-more");
  assert.equal(page.byId("mv-more").open, true);
});

test("#797-5 금액 읽기는 제 칸 안(입력 바로 뒤)에 있어 어느 칸 값인지 헷갈리지 않는다", () => {
  for (const id of ["check-old", "check-ask", "mv-ask", "mv-dep", "mv-cash", "mv-once-move", "mv-once-renew"]) {
    assert.match(HTML, new RegExp(`<div class="search-field"><label for="${id}"[^>]*>[^<]*</label><input [^>]*id="${id}"[^>]*><p class="updated mv-won" id="${id}-won"></p></div>`), id);
  }
});

test("#797-6 장 제목(h1)은 홈 카드·질문 링크·nav 와 같은 「재계약할까, 이사할까」(검색용 <title>·설명은 그대로)", async () => {
  assert.match(HTML, /<h1 id="page-title">재계약할까, 이사할까<\/h1>/);
  assert.match(HTML, /<title>전세 재계약 vs 새로 구하기 - 서울 아파트 갱신 보증금 비교<\/title>/);
  const page = await open();
  await page.click("lang-toggle");
  assert.equal(page.text("page-title"), "Renew or move?");
});

// ---- #799 결과 바로 아래 조건 수정, 선택지별 금리 요약 ----
test("#799 P2 결과 카드 바로 아래 「조건 고치기」·「선택 조건」 단추(52px 단추 모양), 그 뒤 짧은 가정 문장 → 접힌 기간별 차이·상세 표 → 근거 줄 → 고지", () => {
  assert.match(
    SECTION,
    /<h3 id="mv-s4"[^>]*>결과<\/h3>\s*<div class="mv-key" id="mv-key" aria-live="polite"><\/div>\s*<p class="mv-jump" id="mv-jump"><a class="c-btn c-btn--secondary" href="#mv-s1" id="mv-edit"[^>]*>조건 고치기 ↑<\/a> <a class="c-btn c-btn--secondary" href="#mv-more" id="mv-to-more"[^>]*>선택 조건 ↓<\/a><\/p>\s*<p class="lead" id="mv-answer"[^>]*><\/p>\s*<details id="mv-table-box"><summary id="mv-table-sum"[^>]*>기간별 차이와 상세 계산 표 — [^<]*<\/summary>\s*<p class="content-notice" id="mv-what-if"><\/p>\s*<div class="table-scroll"><table[^>]*id="mv-table"[\s\S]*?<\/details>\s*<p class="updated" id="mv-basis-line"><\/p>\s*<p class="content-notice" id="mv-legal"/
  );
  assert.match(CSS_BASE, /\n#mv-jump \{ display: flex; flex-wrap: wrap; gap: 8px;/);
  assert.doesNotMatch(CSS_BASE, /\n\.mv-jump \{/, "단추 줄 규칙이 「결과 보기 ↑」 문단(.mv-jump)에도 번진다");
  assert.match(CSS_BASE, /\.mv-key:empty \{ margin: 0; padding: 0; background: none; \}/);
  assert.doesNotMatch(SECTION, /id="mv-key"[^>]*hidden/, "알림 영역을 숨기면 첫 결과가 읽히지 않을 수 있다");
});

test("#799 P2 견줄 수 있으면 답 문장은 카드에 없는 가정(원금은 비용 아님·기간 내내 같음)만, 견줄 수 없거나 입력 중이면 이유 문장 - 단추는 어느 상태에서나 있다", async () => {
  const page = await open();
  assert.equal(answer(page), "① 재계약 요구 보증금을 넣으면 견줍니다.");
  await set(page, { ...CASE1, "mv-months": "36" });
  assert.equal(answer(page), "돌려받는 보증금과 대출 원금은 비용이 아닙니다. 금리·월세가 36개월 내내 같다고 본 계산입니다.");
  assert.doesNotMatch(answer(page), /덜 듭니다|월 현금 지출/, "카드와 같은 문장이 답에 남았다");
  assert.match(key(page), /^입력한 조건으로 36개월 비용 차이/);
  assert.match(page.text("mv-what-if"), /^기간별: 12개월 /, "기간별 차이를 지웠다(접기만 해야 한다)");
  for (const [o, want] of [[{ "mv-dep": "" }, /^넣을 칸: 비교할 집 보증금$/], [{ "mv-dep": "-1" }, /^비교할 집 보증금: 0 이상이어야 합니다\.$/], [{ "mv-dep": "80000", "mv-cash": "1000" }, /모자라 견주지 않았습니다/]]) {
    await set(page, o);
    assert.match(answer(page), want);
    assert.equal(key(page), "", "이전 결과 카드가 남았다");
    assert.equal(page.text("mv-what-if"), "", "이전 기간별 차이가 남았다");
  }
  assert.equal(MSG("ko")[16] + MSG("ko")[21] + MSG("en")[16] + MSG("en")[21], "", "쓰지 않는 옛 답 첫 문장 자리");
});

test("#799 P3 접힌 요약의 금리: 공통은 「대출 4.23%」, 나누면 「대출 재계약 3% · 이사 5%」, 비었거나 0~20% 밖이면 「확인 필요」(영어 같은 뜻), 껐다 켜도 칸 값 보존", async () => {
  const page = await open();
  const now = () => page.text("mv-more-now").split(" · 24개월")[0];
  const split = async (on) => ((page.byId("mv-split").checked = on), page.byId("mv-split").dispatch("change"), await page.settle());
  assert.equal(now(), " 대출 4.23%");
  await set(page, { "mv-rate": "" });
  assert.equal(now(), " 대출 확인 필요", "빈 공통 금리를 적용 금리처럼 보였다");
  await set(page, { "mv-rate": "25" });
  assert.equal(now(), " 대출 확인 필요");
  await set(page, { "mv-rate": "4.23" });
  await split(true);
  await set(page, { "mv-rate-renew": "3", "mv-rate-move": "5" });
  assert.equal(now(), " 대출 재계약 3% · 이사 5%");
  await set(page, { "mv-rate-move": "" });
  assert.equal(now(), " 대출 재계약 3% · 이사 확인 필요");
  await set(page, { "mv-rate-move": "30" });
  assert.equal(now(), " 대출 재계약 3% · 이사 확인 필요", "범위 밖 금리를 적용 금리처럼 보였다");
  await set(page, { "mv-rate-move": "0" });
  assert.equal(now(), " 대출 재계약 3% · 이사 0%", "0% 는 정상 값이다");
  await set(page, { "mv-rate-move": "5" });
  await split(false);
  assert.equal(now(), " 대출 4.23%");
  await split(true);
  assert.equal(now(), " 대출 재계약 3% · 이사 5%", "껐다 켜면 두 칸 값이 사라졌다");
  await page.click("lang-toggle");
  assert.match(page.text("mv-more-now"), /^ Loan \(Renewal 3% · Move 5%\) · 24 months · /, "영어에서 「Loan Renewal」(대출 갱신)로 읽히지 않게 괄호");
  await set(page, { "mv-rate-renew": "" });
  assert.match(page.text("mv-more-now"), /^ Loan \(Renewal check entry · Move 5%\) · /);
});
