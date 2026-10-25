import test from "node:test";
import assert from "node:assert/strict";
import { lowSampleCount } from "../scripts/realestate-format.ts";
import { lowSampleReason } from "../scripts/realestate-overall.ts";
import { createReactRenderer } from "../scripts/render/react.ts";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

/**
 * 시세 요약 카드: 신고가 1~4건이라 값을 비운 카드는 「-」 대신 이유를 적는다(#264, po·cmo·cpo 판정 댓글 6398304898).
 * 빌드(React, scripts/render/entry.jsx ← realestate-overall.ts)와 브라우저(틀의 renderOverall ← lowOr)가 같은 글자·같은 모양을 내야 첫 화면이 튀지 않는다.
 * 값·날짜에 기대지 않는다(#8): 입력은 전부 이 파일 안의 고정값이다.
 */

const renderer = await createReactRenderer();
const ssg = (...args) => renderer.render("realestateOverallHtml", args);

const metric = (n, f, v) => ({ [f]: v, transactionCount: n });
const sale = (n) => metric(n, "avgPricePerPyeong10k", 6000);
const jeonse = (n) => metric(n, "avgDepositPerPyeong10k", 3000);
const wolse = (n) => ({ avgDeposit10k: 20264, avgMonthlyRent10k: 128, transactionCount: n });

const LOW_KO = (n) => `<span class="low-sample">신고 ${n}건이라 비움</span>`;
const LOW_EN = (n) => `<span class="low-sample">Blank: only ${n} reported</span>`;

/** [[label, value], ...] 카드마다 라벨과 값 칸의 안쪽 마크업. 부가 글자(sub)는 이 변경이 건드리지 않아 뺀다. */
const pairs = (html) => [...html.matchAll(/<div class="label">(.*?)<\/div><div class="value">(.*?)<\/div>/g)].map((m) => [m[1], m[2]]);

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
async function inline(realestate, { kind = null, district = null, locale = "ko" } = {}) {
  const page = await loadRealestatePage({ file: `${SITE}/realestate.html`, realestate, kind, district, locale });
  await settle();
  return page.overallHtml();
}

test("lowSampleCount: 지표가 있고 1 <= n < 5(정수)일 때만 n, 경계는 0·1·4·5", () => {
  const e = (n) => ({ sale: sale(n) });
  assert.equal(lowSampleCount(e(0), "sale"), null, "0건은 이유를 적지 않는다");
  assert.equal(lowSampleCount(e(1), "sale"), 1);
  assert.equal(lowSampleCount(e(4), "sale"), 4);
  assert.equal(lowSampleCount(e(5), "sale"), null, "5건은 값을 낸다(문턱은 hasEnoughSample 한 곳)");
  assert.equal(lowSampleCount(e(400), "sale"), null);
  // 값이 null 이어도 건수가 1~4 면 이유를 적고(표의 lowOrNone 과 같다), 건수가 충분한데 값만 null 인 칸은 이유가 아니다.
  assert.equal(lowSampleCount({ sale: { avgPricePerPyeong10k: null, transactionCount: 3 } }, "sale"), 3);
  assert.equal(lowSampleCount({ sale: { avgPricePerPyeong10k: null, transactionCount: 40 } }, "sale"), null);
  // 세 종류
  assert.equal(lowSampleCount({ jeonse: jeonse(2) }, "jeonse"), 2);
  assert.equal(lowSampleCount({ wolse: wolse(3) }, "wolse"), 3);
  assert.equal(lowSampleCount({ wolse: wolse(3) }, "sale"), null, "다른 종류의 건수를 읽지 않는다");
});

test("lowSampleCount: 지표 없음·건수 없음·정수가 아닌 건수·모르는 kind 는 null(「-」 그대로)", () => {
  for (const entry of [undefined, null, {}, { sale: null }, { sale: 0 }, { sale: "" }, { sale: {} }]) assert.equal(lowSampleCount(entry, "sale"), null, JSON.stringify(entry));
  for (const n of [undefined, null, NaN, Infinity, -1, 0, 4.5, "4", "x", true, false, [], [3], {}]) assert.equal(lowSampleCount({ sale: sale(n) }, "sale"), null, String(n));
  for (const kind of ["foo", "Sale", "constructor", "__proto__", ["sale"], 5, null, undefined]) assert.equal(lowSampleCount({ sale: sale(3) }, kind), null, String(kind));
});

test("lowSampleReason: ko 글자는 「신고 {n}건이라 비움」", () => {
  assert.equal(lowSampleReason(1), "신고 1건이라 비움");
  assert.equal(lowSampleReason(4), "신고 4건이라 비움");
});

test("빌드: 1~4건 카드만 low-sample 스팬(title 없음)이고 n=0·지표 없음·충분한 건수는 「-」·값 그대로", () => {
  const all = (s, j, w) => ssg({ overall: { sale: s, jeonse: j, wolse: w } });
  const html = all(sale(3), jeonse(1), wolse(0));
  assert.deepEqual(pairs(html).map(([, v]) => v), [LOW_KO(3), LOW_KO(1), "-"]);
  assert.doesNotMatch(html, /title=/);
  assert.deepEqual(pairs(all(sale(5), undefined, wolse(4))).map(([, v]) => v), ["6,000만원", "-", LOW_KO(4)]);
  assert.deepEqual(pairs(ssg({ overall: { sale: sale(2) } }, "sale")), [["서울 전체", LOW_KO(2)]]);
  assert.deepEqual(pairs(ssg({ overall: { sale: sale(0) } }, "sale")), [["서울 전체", "-"]]);
  assert.deepEqual(pairs(ssg({ overall: {} }, "sale")), [["서울 전체", "-"]]);
  assert.deepEqual(pairs(ssg({ overall: { wolse: wolse(1) } }, "wolse")), [["서울 전체", LOW_KO(1)]]);
  assert.deepEqual(pairs(ssg({ districts: [{ name: "종로구", sale: sale(4) }] }, null, "종로구")), [["매매", LOW_KO(4)]]);
  assert.deepEqual(pairs(ssg({ districts: [{ name: "종로구", sale: sale(0) }] }, null, "종로구")), [["매매", "-"]]);
  assert.deepEqual(pairs(ssg({ districts: [{ name: "종로구" }] }, null, "종로구")), [["매매", "-"]]);
});

test("자치구 보기: 전세가 1~4건이라 사라지는 전세가율 카드는 되살리지 않는다(매매 카드 셋만)", () => {
  const html = ssg({ districts: [{ name: "노원구", sale: sale(40), jeonse: jeonse(3) }] }, null, "노원구");
  assert.deepEqual(pairs(html).map(([l]) => l), ["평당가", "84㎡ 환산", "거래건수"]);
  assert.doesNotMatch(html, /low-sample|전세가율|비움/);
});

// 같은 입력에서 구운 카드와 자바스크립트가 다시 그린 카드가 라벨·값까지 같다(한국어 화면).
const CASES = [
  ["서울 전체 세 카드(1·3·0건)", { overall: { sale: sale(3), jeonse: jeonse(1), wolse: wolse(0) }, districts: [] }, {}],
  ["서울 전체 세 카드(5건 경계·4건·4건)", { overall: { sale: sale(5), jeonse: jeonse(4), wolse: wolse(4) }, districts: [] }, {}],
  ["서울 전체 세 카드(지표 없음)", { overall: {}, districts: [] }, {}],
  ["매매 카드 4건", { overall: { sale: sale(4) }, districts: [] }, { kind: "sale" }],
  ["매매 카드 0건", { overall: { sale: sale(0) }, districts: [] }, { kind: "sale" }],
  ["전세 카드 1건(매매는 충분)", { overall: { sale: sale(40), jeonse: jeonse(1) }, districts: [] }, { kind: "jeonse" }],
  ["월세 카드 2건", { overall: { wolse: wolse(2) }, districts: [] }, { kind: "wolse" }],
  ["월세 카드 40건", { overall: { wolse: wolse(40) }, districts: [] }, { kind: "wolse" }],
  ["자치구 매매 4건", { overall: {}, districts: [{ name: "종로구", sale: sale(4) }] }, { district: "종로구" }],
  ["자치구 매매 0건", { overall: {}, districts: [{ name: "종로구", sale: sale(0) }] }, { district: "종로구" }],
  ["자치구 지표 없음", { overall: {}, districts: [{ name: "종로구" }] }, { district: "종로구" }],
  ["자치구 매매 충분·전세 3건", { overall: {}, districts: [{ name: "종로구", sale: sale(40), jeonse: jeonse(3) }] }, { district: "종로구" }],
];

test("빌드(React)와 브라우저(renderOverall)가 같은 카드를 낸다(ko, 12개 입력)", async () => {
  for (const [name, data, opts] of CASES) {
    const built = ssg(data, opts.kind ?? null, opts.district ?? null);
    const drawn = await inline(data, opts);
    assert.deepEqual(pairs(drawn), pairs(built), name);
  }
});

test("변이: 틀의 문구에 오타가 있거나 title 이 붙으면 위 비교가 잡는다(시험이 눈이 멀지 않았다)", async () => {
  const data = { overall: { sale: sale(3) }, districts: [] };
  const built = pairs(ssg(data));
  const run = async (mutate) => pairs((await (async () => {
    const page = await loadRealestatePage({ file: `${SITE}/realestate.html`, realestate: data, mutate });
    await settle();
    return page.overallHtml();
  })()));
  assert.deepEqual(await run((s) => s), built, "변이 없는 사본은 같다");
  const typo = await run((s) => s.replace("건이라 비움", "건이라 비웁"));
  assert.notDeepEqual(typo, built, "문구 오타를 못 잡는다");
  const titled = await run((s) => s.replace('`<span class="low-sample">${', '`<span class="low-sample" title="x">${'));
  assert.notDeepEqual(titled, built, "title 이 붙어도 못 잡는다");
});

test("브라우저: ko·en 글자, low-sample 스팬에 title 이 없다", async () => {
  const data = { overall: { sale: sale(3), jeonse: jeonse(1), wolse: wolse(0) }, districts: [] };
  const ko = await inline(data, { locale: "ko" });
  assert.deepEqual(pairs(ko).map(([, v]) => v), [LOW_KO(3), LOW_KO(1), "-"]);
  const en = await inline(data, { locale: "en" });
  assert.deepEqual(pairs(en).map(([, v]) => v), [LOW_EN(3), LOW_EN(1), "-"]);
  const enDistrict = await inline({ overall: {}, districts: [{ name: "종로구", sale: sale(4) }] }, { district: "종로구", locale: "en" });
  assert.deepEqual(pairs(enDistrict).map(([, v]) => v), [LOW_EN(4)]);
  for (const html of [ko, en, enDistrict]) assert.doesNotMatch(html, /low-sample[^>]*title=/);
});
