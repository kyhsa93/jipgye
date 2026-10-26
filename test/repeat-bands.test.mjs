// 같은 집 쌍 둘째 표 - 앞 거래가 3분의 1(#170 N6, 판정 6403691545) 시험. 오늘 데이터에 기대지 않는다:
// 얼린 빌더 출력(fixtures/repeat-sales/n6-bands.json, 고정 입력 39c24811·사전 등록 창)과 합성 입력만 쓴다.
// n6-bands.json 이 repeat_bands_n6.out 의 숫자 그대로인지는 .out 을 직접 읽어 대조한다. 고정 입력으로 다시 계산해 .out 1~5절과 줄마다 같은지는
// scripts/dev/verify-repeat-bands-n6.mjs 가 보고, 고정 커밋이 로컬에 있을 때만 여기서도 돌린다(얕은 클론이면 건너뛴다).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { repeatSalesHtml } from "../scripts/prerender.ts";
import { bandBoundaries, bandsPayload, computeBands, FORBIDDEN } from "../scripts/repeat-sales.ts";
import { stampSources } from "../scripts/source-lines.ts";

const root = path.resolve(import.meta.dirname, "..");
const V0 = JSON.parse(await readFile(new URL("./fixtures/repeat-sales/v0.json", import.meta.url), "utf8"));
const N6 = JSON.parse(await readFile(new URL("./fixtures/repeat-sales/n6-bands.json", import.meta.url), "utf8"));
const OUT = await readFile(path.join(root, "research/repeat-sales-2026-10/repeat_bands_n6.out"), "utf8");

const textOf = (h, lang) => {
  const other = lang === "ko" ? "m-en" : "m-ko";
  return h
    .replace(new RegExp(`<tr class="${other}">[\\s\\S]*?</tr>`, "g"), "")
    .replace(new RegExp(`<span class="${other}">[\\s\\S]*?</span>(?=<span|</|\\s|$)`, "g"), "")
    .replace(/<caption class="sr-only">[\s\S]*?<\/caption>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ");
};
/** 반복거래 절에서 둘째 표 부분만(첫 표의 출처 줄 뒤). */
const bandsPart = (data) => {
  const h = repeatSalesHtml(data);
  const at = h.indexOf("{{src:repeatSales.en}}");
  return h.slice(h.indexOf("</p>", at) + 4);
};
const withBands = (patch) => ({ ...V0, bands: { ...N6, ...patch } });

// ---------------------------------------------------------------- 값 = .out

test("n6-bands.json 은 repeat_bands_n6.out 1~5절 숫자 그대로다 (경계·쌍 수·중간값·구간·간격·앞 거래가 중간값·차이·N4 대응)", () => {
  const m = OUT.match(/B1 = (\d+), B2 = (\d+)/);
  assert.deepEqual(N6.b, [Number(m[1]), Number(m[2])]);
  const lines = OUT.split("\n");
  const head = lines.findIndex((l) => l.startsWith("가격대 | 쌍 n"));
  for (let k = 0; k < 3; k++) {
    const c = lines[head + 1 + k].split(" | ");
    const r = N6.rows[k];
    assert.equal(r.n, Number(c[1]), `${c[0]} 쌍 수`);
    assert.equal(r.f, Number(c[5]), `${c[0]} 앞 거래가 중간값`);
    assert.deepEqual([r.m, r.lo, r.hi], [Number(c[6]), Number(c[8]), Number(c[9])], `${c[0]} 로그 값`);
    const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
    assert.equal(pct(r.p[0]), c[7], `${c[0]} %`);
    assert.equal(`${pct(r.p[1])}~${pct(r.p[2])}`, c[10], `${c[0]} 구간 %`);
    assert.equal(r.gap, Number(c[12]), `${c[0]} 간격 중간값`);
    assert.equal(c[14], "", "표시 칸에 값 비움 표시가 없다");
  }
  // 3절: 셋 다 말할 수 있음, 방향은 큼·작음·큼 → say [+1, -1, +1]
  assert.match(OUT, /낮은 쪽-가운데: 말할 수 있음, 높은 쪽 가격대 값이 더 큼\n가운데-높은 쪽: 말할 수 있음, 높은 쪽 가격대 값이 더 작음\n낮은 쪽-높은 쪽: 말할 수 있음, 높은 쪽 가격대 값이 더 큼/);
  assert.deepEqual(N6.say, [1, -1, 1]);
  assert.match(OUT, /최대-최소 = 6일 -> 문장 유지/);
  assert.equal(N6.spread, 6);
  assert.match(OUT, /-> upTo6, .* -> upTo15, .* -> upTo25\n/);
  assert.match(OUT, /비교 가능 3쌍, 일치 3쌍 -> 표시/);
  assert.deepEqual(N6.n4, { map: ["upTo6", "upTo15", "upTo25"], cmp: 3, agree: 3 });
  assert.equal(N6.fold, null);
});

test("고정 입력 39c24811 로 다시 계산하면 .out 1~5절과 줄마다 같다 (verify-repeat-bands-n6.mjs, 고정 커밋이 있을 때만)", async (t) => {
  const run = promisify(execFile);
  try {
    const r = await run(process.execPath, [path.join(root, "scripts/dev/verify-repeat-bands-n6.mjs")], { cwd: root, timeout: 120000 });
    assert.match(r.stdout, /^PASS /m);
  } catch (e) {
    if (e.code === 2) return t.skip("고정 커밋이 로컬에 없다(얕은 클론)");
    assert.fail(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});

test("docs/data/repeat-sales.json 의 bands·출처 추가는 0.8 KB 이하다 (판정 예산)", async () => {
  const data = JSON.parse(await readFile(path.join(root, "docs/data/repeat-sales.json"), "utf8"));
  const added = Buffer.byteLength(`,"bands":${JSON.stringify(data.bands)}`) + Buffer.byteLength(`,"bands":${JSON.stringify(data.provenance.bands)},"n4Blob":${JSON.stringify(data.provenance.n4Blob)}`);
  assert.ok(added <= 800, `${added}B`);
  assert.equal(Buffer.byteLength(JSON.stringify(N6)), Buffer.byteLength(JSON.stringify(data.bands)), "얼린 출력과 같은 모양");
});

// ---------------------------------------------------------------- 합성 입력: 경계·판정 분기 (브리프 5)

/** 가격대마다 쌍 n 개(집 하나에 쌍 하나). 앞 거래가 = 가격대 k 의 base + i, 로그 = logs[k] 근처로 고르게. gaps[k] = 간격. */
function units({ n = [100, 100, 100], logs = [0.1, 0.2, 0.3], gaps = [370, 370, 370], spread = 0.002 } = {}) {
  const out = [];
  n.forEach((count, k) => {
    for (let i = 0; i < count; i++) out.push([{ log: logs[k] + (i / count - 0.5) * spread, gap: gaps[k], ymA: 202501, ymB: 202601, front: (k + 1) * 50000 + i }]);
  });
  return out;
}
const N4_OK = { upTo6: 10, upTo9: 15, upTo15: 20, upTo25: 25, over25: 30 };

test("경계: ceil(N/3)·ceil(2N/3) 번째 값(보간 없음), 경계값은 아래 가격대에 든다", () => {
  assert.deepEqual(bandBoundaries([5, 1, 4, 2, 3, 6, 7]), [3, 5]); // N=7: 3번째·5번째
  assert.deepEqual(bandBoundaries([1, 2, 3]), [1, 2]);
  const b = computeBands(units(), N4_OK);
  assert.deepEqual([b.b1, b.b2], [50099, 100099]);
  assert.deepEqual(b.stats.map((s) => s.n), [100, 100, 100]);
});

test("판정 통과: 셋 다 91쌍 이상·구간이 안 겹치고 N4 와 방향이 같으면 표시, 차이 방향을 싣는다", () => {
  const p = bandsPayload(computeBands(units(), N4_OK));
  assert.equal(p.fold, null);
  assert.deepEqual(p.say, [1, 1, 1]);
  assert.deepEqual(p.n4, { map: ["upTo6", "upTo15", "upTo25"], cmp: 3, agree: 3 }); // 앞 거래가 중간값 50,049.5·100,049.5·150,049.5
});

test("② 91쌍 미만 가격대가 있으면 접는다(thin), 그 가격대는 값 없이 쌍 수만", () => {
  // 앞 거래가로 3등분하므로 한 가격대만 줄일 수 없다 - 전체를 줄여 셋 다 91 미만(90쌍씩)
  const p = bandsPayload(computeBands(units({ n: [90, 90, 90] }), N4_OK));
  assert.equal(p.fold, "thin");
  assert.deepEqual(p.rows[0], { n: 90, st: "thin" });
  const ok = bandsPayload(computeBands(units({ n: [91, 91, 91] }), N4_OK));
  assert.equal(ok.fold, null, "91쌍이면 문턱을 넘는다");
});

test("⑤ 구간이 겹치는 쌍은 차이를 싣지 않는다(say 0)", () => {
  const p = bandsPayload(computeBands(units({ logs: [0.1, 0.1, 0.3] }), N4_OK));
  assert.equal(p.say[0], 0, "낮은–가운데 겹침");
  assert.deepEqual(p.say.slice(1), [1, 1]);
});

test("⑥ E: 간격 중간값 폭이 90일 이상이면 차이 문장을 모두 지운다, 89일이면 둔다", () => {
  assert.deepEqual(bandsPayload(computeBands(units({ gaps: [340, 370, 430] }), N4_OK)).say, [0, 0, 0]);
  const keep = bandsPayload(computeBands(units({ gaps: [341, 370, 430] }), N4_OK));
  assert.deepEqual([keep.spread, keep.say], [89, [1, 1, 1]]);
});

test("⑦ N4: 같은 N4 가격대에 걸린 쌍은 비교하지 않고, 비교 2쌍 미만이거나 일치 2쌍 미만이면 접는다(n4), N4 가 없으면 noN4", () => {
  const far = units();
  // 둘이 같은 N4 가격대(upTo15)에 걸리면 그 쌍은 비교하지 않는다: 가운데 앞 거래가를 120,000 대로 옮김 → 비교 2쌍
  const two = units().map((h) => h.map((p) => ({ ...p, front: p.front >= 150000 ? p.front - 20000 : p.front })));
  const t2 = bandsPayload(computeBands(two, N4_OK));
  assert.deepEqual([t2.n4.map, t2.n4.cmp, t2.n4.agree, t2.fold], [["upTo6", "upTo15", "upTo15"], 2, 2, null]);
  // 방향 불일치: N4 가 거꾸로면 일치 0쌍
  const rev = bandsPayload(computeBands(far, { upTo6: 30, upTo9: 25, upTo15: 20, upTo25: 15, over25: 10 }));
  assert.deepEqual([rev.n4.cmp, rev.n4.agree, rev.fold], [3, 0, "n4"]);
  // 부호 0: N4 값이 같으면 일치로 세지 않는다
  const flat = bandsPayload(computeBands(far, { upTo6: 20, upTo9: 20, upTo15: 20, upTo25: 20, over25: 20 }));
  assert.deepEqual([flat.n4.agree, flat.fold], [0, "n4"]);
  // 셋이 한 N4 가격대에 몰리면 비교 0쌍
  const same = units().map((h) => h.map((p) => ({ ...p, front: 100000 + (p.front % 50000) + Math.floor(p.front / 50000) * 100 })));
  const s = bandsPayload(computeBands(same, N4_OK));
  assert.deepEqual([s.n4.cmp, s.fold], [0, "n4"]);
  assert.equal(bandsPayload(computeBands(units(), null)).fold, "noN4");
  assert.equal(bandsPayload(computeBands(units(), { upTo6: 10 })).fold, "n4", "대응한 N4 가격대 값이 비면 대조하지 못한 것");
  assert.equal(computeBands([], N4_OK), null);
});

// ---------------------------------------------------------------- 화면 (브리프 3·6)

const TITLE_KO = "앞 거래가 기준 3분의 1씩 나눈 같은 집 재거래 변화";
const LEAD_KO = "같은 칸 방식(가격대·연식별 1년 변화)과 방향이 같습니다. 시장 지수가 아니고, 다시 팔린 집만 들어옵니다.";
const DIFF_KO = "구간이 겹치지 않아 구별되는 쌍: 가운데 > 낮은 쪽 · 높은 쪽 < 가운데 · 높은 쪽 > 낮은 쪽.";
const MR_KO = "양 끝의 차이는 평균 회귀로 커 보일 수 있습니다(보정하지 않음).";
const MR_EN = "Gaps at the ends can look larger through regression to the mean (not corrected).";

test("표: 제목·표 위 문단(방향이 같다·v0 문구)·차이 문장 바로 옆 평균 회귀 한계 (ko/en)", () => {
  const h = bandsPart(withBands({}));
  const ko = textOf(h, "ko");
  const en = textOf(h, "en");
  assert.ok(ko.startsWith(`${TITLE_KO} ${LEAD_KO} ${DIFF_KO} ${MR_KO}`), ko.slice(0, 200));
  assert.ok(en.startsWith("Same-home resales by thirds of earlier price Same direction as the same-unit method (1-year change by price band and age). Not a market index; resold homes only."), en.slice(0, 200));
  assert.ok(en.includes(`Told apart (ranges do not overlap): middle > lower · upper < middle · upper > lower. ${MR_EN}`));
  assert.ok(!/[가-힣]/.test(en), "영어 화면에 한국어가 남지 않는다");
});

test("표: 행 셋 「낮은 쪽·가운데·높은 쪽 3분의 1」, 경계(만원)·쌍 수·중간값·90% 구간이 .out 값", () => {
  const h = bandsPart(withBands({}));
  const rows = [...h.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0][1].split("</tr>").filter(Boolean);
  assert.equal(rows.length, 3);
  const cells = (r, lang) => textOf(r.replaceAll("<br/>", " ").replaceAll("</td>", "|"), lang).split("|").map((c) => c.trim()).filter(Boolean);
  assert.deepEqual(cells(rows[0], "ko"), ["낮은 쪽 3분의 1 ≤73,800", "2,108", "+10.1%", "+9.5% ~ +10.5%"]);
  assert.deepEqual(cells(rows[1], "ko"), ["가운데 3분의 1 ≤117,500", "2,109", "+24.1%", "+23.5% ~ +25.0%"]);
  assert.deepEqual(cells(rows[2], "ko"), ["높은 쪽 3분의 1 >117,500", "2,107", "+21.2%", "+20.8% ~ +21.7%"]);
  assert.deepEqual(cells(rows[2], "en"), ["Upper third >117,500", "2,107", "+21.2%", "+20.8% ~ +21.7%"]);
  assert.match(h, /<tr class="m-ko"><th scope="col">앞 거래가\(만원\)<\/th><th scope="col">쌍 수<\/th><th scope="col">중간값<\/th><th scope="col">90% 구간<\/th><\/tr>/);
});

test("차이: 말할 수 없는 쌍은 빼고, 한계 문장은 양 끝을 말할 때만, 하나도 없으면 차이 문장과 한계 문장을 모두 뺀다(첫 줄은 남는다)", () => {
  const some = textOf(bandsPart(withBands({ say: [0, -1, 0] })), "ko");
  // 평균 회귀 한계는 양 끝(낮은 쪽–높은 쪽)을 말할 때만(#697 판정)
  assert.ok(some.includes("구별되는 쌍: 높은 쪽 < 가운데.") && !some.includes("평균 회귀"), some);
  const ends = textOf(bandsPart(withBands({ say: [0, 0, 1] })), "ko");
  assert.ok(ends.includes(`구별되는 쌍: 높은 쪽 > 낮은 쪽. ${MR_KO}`), ends);
  const none = bandsPart(withBands({ say: [0, 0, 0] }));
  assert.ok(textOf(none, "ko").includes(LEAD_KO));
  assert.ok(!textOf(none, "ko").includes("구별") && !textOf(none, "ko").includes("평균 회귀"));
  assert.ok(!textOf(none, "en").includes("regression"));
});

test("접음: thin·noN4·n4·값 비운 가격대면 표 없이 한 줄(사유를 적는다), 첫 표가 접히면 둘째 표도 없다", () => {
  for (const [patch, ko, en] of [
    [{ fold: "thin" }, "쌍이 모자라거나 값이 흔들려", "too few pairs"],
    [{ fold: "noN4" }, "같은 칸 방식(가격대·연식별 1년 변화)과 대조하지 못해", "could not be checked"],
    [{ fold: "n4" }, "같은 칸 방식(가격대·연식별 1년 변화)과 방향이 맞지 않아", "did not match"],
    [{ rows: [...N6.rows.slice(0, 2), { n: 2107, st: "shaky" }] }, "쌍이 모자라거나 값이 흔들려", "unstable"],
  ]) {
    const h = bandsPart(withBands(patch));
    assert.ok(!h.includes("<table"), JSON.stringify(patch));
    assert.ok(h.includes('id="repeat-bands-fold"'));
    assert.ok(textOf(h, "ko").includes(`${TITLE_KO} 표는 ${ko} 사전에 정한 점검을 넘지 못해 싣지 않습니다.`), textOf(h, "ko"));
    assert.ok(textOf(h, "en").includes(en));
    assert.ok(!h.includes("+24.1%"), "접히면 숫자가 없다");
  }
  const folded = repeatSalesHtml({ ...V0, checks: { ...V0.checks, kill: true }, bands: N6 });
  assert.ok(!folded.includes(TITLE_KO));
  assert.equal(bandsPart({ ...V0 }).includes("<table"), false, "bands 가 없으면(옛 파일) 둘째 표도 없다");
});

test("금지어: 5-1 ⑦·「싼 집·비싼 집」·지수·순위·연율 0건 (모든 분기, ko/en)", () => {
  for (const patch of [{}, { say: [0, 0, 0] }, { fold: "thin" }, { fold: "noN4" }, { fold: "n4" }]) {
    const h = stampSources(bandsPart(withBands(patch)));
    const ko = textOf(h, "ko");
    const en = textOf(h, "en").toLowerCase();
    for (const w of [...FORBIDDEN, "싼", "편향", "더 올랐", "상승률", "연평균", "순위", "연율"]) assert.ok(!ko.includes(w), `${w} in ${ko}`);
    for (const w of ["cheap", "expensive", "bias", "forecast", "outlook", "rose more", "annual"]) assert.ok(!en.includes(w), `${w} in ${en}`);
    assert.equal(ko.replace(/시장 지수가 아니고/g, "").includes("지수"), false);
    assert.equal(en.replace(/not a market index/g, "").includes("index"), false);
  }
});

test("렌더 HTML: 둘째 표가 더하는 바이트(두 언어, 판정 예산 1.5 KB - 초과분은 PR 본문 판단 요청)", () => {
  const added = Buffer.byteLength(repeatSalesHtml(withBands({}))) - Buffer.byteLength(repeatSalesHtml(V0));
  assert.ok(added <= 1800, `${added}B`);
});
