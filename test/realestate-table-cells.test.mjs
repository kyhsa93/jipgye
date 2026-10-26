import test from "node:test";
import assert from "node:assert/strict";
import { hasEnoughSample, isShortSample } from "../scripts/realestate-format.ts";
import { createReactRenderer } from "../scripts/render/react.ts";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

/**
 * 시세 표의 값 없는 칸 두 가지(#593 a·b, cto·cpo·uiux 판정 https://github.com/kyhsa93/jipgye/pull/642#issuecomment-6400071382).
 *  (a) 전세 표의 값 없는 줄은 이름 칸 + 값 칸 넷이다 - 머리글 다섯 칸과 맞아야 열 대응(a11y)이 서고 모바일 카드에 전세가율·거래건수 라벨이 남는다. colspan 은 쓰지 않는다.
 *  (b) 「신고 N건…」 문구는 표본이 모자랄 때(!hasEnoughSample)만이다. 표본은 충분한데 값만 없으면 「-」다(사실이 아닌 「N건뿐」을 적지 않는다).
 * 빌드(React, scripts/render/entry.jsx ← realestate-table.ts)와 브라우저(틀의 rowHtml·cellsFor·lowCell)가 같은 글자·같은 칸 수를 내야 한다(render-parity 방식).
 * 값·날짜에 기대지 않는다(#8): 입력은 전부 이 파일 안의 고정값이다.
 */

const renderer = await createReactRenderer();
const build = (data, kind = null, district = null) => renderer.render("realestateTableHtml", [data, kind, district]);
const buildHead = (kind = null, district = null) => renderer.render("realestateHeadHtml", [kind, district]);

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
async function inline(realestate, { kind = null, district = null, locale = "ko", mutate } = {}) {
  const page = await loadRealestatePage({ file: `${SITE}/realestate.html`, realestate, kind, district, locale, mutate });
  await settle();
  return { body: page.tableHtml(), head: page.headHtml() };
}

const saleOf = (n, v = 6000) => ({ avgPricePerPyeong10k: v, transactionCount: n });
const jeonseOf = (n, v = 3000) => ({ avgDepositPerPyeong10k: v, transactionCount: n });
const wolseOf = (n, v = 20264) => ({ avgDeposit10k: v, avgMonthlyRent10k: 128, transactionCount: n });

const rowsOf = (html) => html.split("</tr>").filter((r) => r.includes("<tr")).map((r) => r.slice(r.indexOf("<tr")) + "</tr>");
const cellsOf = (row) => [...row.matchAll(/<td data-label="([^"]*)">(.*?)<\/td>/g)].map((m) => ({ label: m[1], html: m[2] }));
const textOf = (html) => html.replace(/<[^>]+>/g, "").trim();
const ths = (head) => [...head.matchAll(/<th scope="col">(.*?)<\/th>/g)].map((m) => m[1]);

const JEONSE_LABELS = ["3.3㎡당 평균 보증금", "84㎡ 환산", "전세가율", "거래 건수"];

test("(a) 전세 표: 값 없는 줄도 이름 칸 + 값 칸 넷이고 data-label 이 머리글을 따른다(표본 부족·값 null·지표 없음)", () => {
  const head = ths(buildHead("jeonse"));
  assert.deepEqual(head, ["지역", ...JEONSE_LABELS]);
  const cases = {
    "지표 없음": {},
    "표본 부족 2건": { jeonse: jeonseOf(2) },
    "표본 충분·값 null": { jeonse: jeonseOf(40, null) },
    "표본 충분·값 없음(키 없음)": { jeonse: { transactionCount: 40 } },
    "0건": { jeonse: jeonseOf(0) },
  };
  for (const [name, entry] of Object.entries(cases)) {
    const [row] = rowsOf(build({ districts: [{ name: "종로구", ...entry }] }, "jeonse"));
    const cells = cellsOf(row);
    assert.equal(cells.length, head.length - 1, `${name}: 값 칸 수`);
    assert.deepEqual(cells.map((c) => c.label), JEONSE_LABELS, name);
    assert.equal(cells[2].html, "데이터 없음", `${name}: 전세가율 칸`);
    assert.equal(cells[3].html, "데이터 없음", `${name}: 거래건수 칸`);
    assert.ok(row.endsWith('<td data-label="전세가율">데이터 없음</td><td data-label="거래 건수">데이터 없음</td></tr>'), `${name}: 마지막 두 칸`);
    assert.doesNotMatch(row, /colspan/, `${name}: colspan 은 쓰지 않는다`);
  }
});

test("(a) 매매·월세·한 줄 표·자치구 표의 값 없는 줄은 그대로 세 칸이다(전세 표만 넷)", () => {
  const data = { overall: {}, districts: [{ name: "종로구" }] };
  for (const kind of ["sale", "wolse", null]) {
    for (const row of rowsOf(build(data, kind))) assert.equal(cellsOf(row).length, ths(buildHead(kind)).length - 1, String(kind));
  }
  const rows = rowsOf(build(data, null, "종로구"));
  assert.equal(rows.length, 3);
  for (const row of rows) assert.deepEqual(cellsOf(row).map((c) => c.label), ["3.3㎡당 평균", "84㎡ 환산", "거래 건수"]);
  // 서울 전체 줄도 같은 규칙이다
  const [overall] = rowsOf(build({ overall: { jeonse: jeonseOf(3) }, districts: [] }, "jeonse"));
  assert.equal(cellsOf(overall).length, 4);
});

test("(b) 표본 문턱 경계 0·1·4·5: 값이 없을 때 4건 이하만 「신고 N건」, 5건부터는 「-」(매매·전세·월세·한 줄 표·자치구 표)", () => {
  // 각 보기의 첫 줄 첫 값 칸(한 줄 표는 매매 칸, 자치구 표는 매매 줄의 평당가 칸)
  const view = {
    "매매 표": (n) => build({ districts: [{ name: "종로구", sale: saleOf(n, null) }] }, "sale"),
    "전세 표": (n) => build({ districts: [{ name: "종로구", jeonse: jeonseOf(n, null) }] }, "jeonse"),
    "월세 표": (n) => build({ districts: [{ name: "종로구", wolse: wolseOf(n, null) }] }, "wolse"),
    "한 줄 표(매매 칸)": (n) => build({ districts: [{ name: "종로구", sale: saleOf(n, null) }] }),
    "자치구 표(매매 줄)": (n) => build({ districts: [{ name: "종로구", sale: saleOf(n, null) }] }, null, "종로구"),
  };
  for (const [name, make] of Object.entries(view)) {
    for (const n of [0, 1, 4, 5, 6, 400]) {
      const first = cellsOf(rowsOf(make(n))[0])[0].html;
      if (n < 5) {
        assert.match(first, new RegExp(`^<span class="low-sample" title="[^"]*">신고 ${n}건</span>$`), `${name} n=${n}`);
      } else {
        assert.equal(first, "데이터 없음", `${name} n=${n}`);
      }
    }
  }
  // 문턱은 hasEnoughSample 한 곳이다
  for (const n of [0, 1, 4, 5]) assert.equal(isShortSample({ transactionCount: n }), !hasEnoughSample({ transactionCount: n }), String(n));
  for (const none of [undefined, null, 0, "", false]) assert.equal(isShortSample(none), false, `지표 없음 ${String(none)}`);
});

test("(b) 지표가 없으면 「데이터 없음」, 표본 부족이면 값이 있는 쪽과 상관없이 문구 - 건수는 n=7·값 비숫자 → 「데이터 없음」, n=3 → 「신고 3건」", () => {
  const one = (entry) => cellsOf(rowsOf(build({ districts: [{ name: "종로구", ...entry }] }, "sale"))[0])[0].html;
  assert.equal(one({}), "데이터 없음");
  assert.equal(one({ sale: null }), "데이터 없음");
  assert.equal(one({ sale: { ...saleOf(7), avgPricePerPyeong10k: "비숫자" } }), "데이터 없음");
  assert.equal(one({ sale: { ...saleOf(7), avgPricePerPyeong10k: NaN } }), "데이터 없음");
  assert.match(one({ sale: saleOf(3, null) }), /신고 3건/);
  assert.match(one({ sale: { ...saleOf(3), avgPricePerPyeong10k: "비숫자" } }), /신고 3건/);
});

// 같은 입력에서 구운 표와 자바스크립트가 다시 그린 표가 머리글·칸 수·라벨·글자까지 같다(한국어 화면).
const e = (name, o) => ({ name, ...o });
const CASES = [
  ["전세 표: 지표 없음·표본 부족·값 null(충분)·값 있음", { overall: { sale: saleOf(40), jeonse: jeonseOf(2) }, districts: [e("종로구", {}), e("중구", { sale: saleOf(40), jeonse: jeonseOf(3) }), e("용산구", { sale: saleOf(40), jeonse: jeonseOf(40, null) }), e("성동구", { sale: saleOf(40), jeonse: jeonseOf(30) })] }, { kind: "jeonse" }],
  ["전세 표: 경계 0·1·4·5건(값 null)", { overall: {}, districts: [0, 1, 4, 5].map((n, i) => e(`종로구${i}`, { jeonse: jeonseOf(n, null) })) }, { kind: "jeonse" }],
  ["매매 표: 경계 0·1·4·5건(값 null)", { overall: { sale: saleOf(5, null) }, districts: [0, 1, 4, 5].map((n, i) => e(`종로구${i}`, { sale: saleOf(n, null) })) }, { kind: "sale" }],
  ["월세 표: 경계 0·1·4·5건(보증금 null)", { overall: { wolse: wolseOf(4, null) }, districts: [0, 1, 4, 5].map((n, i) => e(`종로구${i}`, { wolse: wolseOf(n, null) })) }, { kind: "wolse" }],
  ["한 줄 표: 세 칸 경계", { overall: { sale: saleOf(5, null), jeonse: jeonseOf(4, null), wolse: wolseOf(1, null) }, districts: [e("종로구", { sale: saleOf(40, null), jeonse: jeonseOf(0, null), wolse: wolseOf(40, null) })] }, {}],
  ["자치구 표: 세 줄 경계", { overall: {}, districts: [e("종로구", { sale: saleOf(5, null), jeonse: jeonseOf(4, null), wolse: wolseOf(40, null) })] }, { district: "종로구" }],
  ["자치구 표: 지표 없음", { overall: {}, districts: [e("종로구", {})] }, { district: "종로구" }],
];

test("빌드(React)와 브라우저(rowHtml·cellsFor)가 같은 표를 낸다(ko, 머리글 포함 7개 입력)", async () => {
  for (const [name, data, opts] of CASES) {
    const built = build(data, opts.kind ?? null, opts.district ?? null);
    const drawn = await inline(data, opts);
    assert.deepEqual(rowsOf(drawn.body).map((r) => cellsOf(r)), rowsOf(built).map((r) => cellsOf(r)), `${name}: 칸`);
    assert.equal(drawn.body, built, `${name}: 본문 글자`);
    assert.deepEqual(ths(drawn.head), ths(buildHead(opts.kind ?? null, opts.district ?? null)), `${name}: 머리글`);
  }
});

test("브라우저 ko·en: 전세 표 값 없는 줄은 값 칸 넷(라벨이 머리글을 따른다), 4건 이하만 문구·5건부터 「데이터 없음」", async () => {
  const data = {
    overall: {},
    districts: [e("종로구", {}), e("중구", { jeonse: jeonseOf(2) }), e("용산구", { jeonse: jeonseOf(5, null) }), e("성동구", { jeonse: jeonseOf(4, null) })],
  };
  for (const locale of ["ko", "en"]) {
    const { body, head } = await inline(data, { kind: "jeonse", locale });
    const labels = ths(head).slice(1);
    assert.equal(labels.length, 4, locale);
    const byName = new Map(rowsOf(body).map((r) => [textOf(r.match(/<td>(.*?)<\/td>/)[1]), cellsOf(r)]));
    for (const [name, cells] of byName) {
      assert.deepEqual(cells.map((c) => c.label), labels, `${locale} ${name}`);
      assert.equal(cells.length, 4, `${locale} ${name}`);
    }
    const low = (n) => (locale === "ko" ? `신고 ${n}건` : `${n} reported`);
    const nd = locale === "ko" ? "데이터 없음" : "No data";
    const first = (name) => textOf(byName.get(name)[0].html);
    assert.equal(first("종로구"), nd, locale);
    assert.equal(first("중구"), low(2), locale);
    assert.equal(first("용산구"), nd, `${locale}: 5건·값 null`);
    assert.equal(first("성동구"), low(4), locale);
    for (const name of ["종로구", "중구", "용산구", "성동구"]) assert.deepEqual(byName.get(name).slice(1).map((c) => c.html), [nd, nd, nd], `${locale} ${name}`);
  }
});

test("변이: 틀의 칸 수·문턱 조건을 되돌리면 위 비교가 잡는다(시험이 눈이 멀지 않았다)", async () => {
  const [name, data, opts] = CASES[0];
  const built = build(data, opts.kind, null);
  const run = async (mutate) => (await inline(data, { ...opts, mutate })).body;
  assert.equal(await run((s) => s), built, "변이 없는 사본은 같다");
  const noPad = await run((s) => s.replace('...(k === "jeonse" ? [NA()] : [])', ""));
  assert.notEqual(noPad, built, `${name}: 전세 칸 수 되돌림을 못 잡는다`);
  const always = await run((s) => s.replace("raw && !hasEnoughSample(raw) ? lowSampleHtml(raw)", "raw ? lowSampleHtml(raw)"));
  assert.notEqual(always, built, `${name}: 표본 문턱 되돌림을 못 잡는다`);
});
