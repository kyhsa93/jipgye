// 미래가치 시험 결과 공개(#816 P1-2): method.html 의 값이 research/ 에 고정한 측정 출력과 같고, 기준 파일이 측정 때 그대로이며,
// 문구 단서가 값과 같은 문단에 있다. 측정을 다시 돌리지 않는다(재현은 research/future-value-test-2026-11/reproduce.sh).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "research/future-value-test-2026-11");
const method = readFileSync(path.join(root, "docs/method.html"), "utf8");

const section = (id) => {
  const start = method.indexOf(`<h2 id="${id}">`);
  assert.notEqual(start, -1, `${id} 절이 없다`);
  const end = method.indexOf("<h2 ", start + 1);
  return method.slice(start, end).replace(/&minus;/g, "−");
};
const ko = () => section("future-value-test");
const en = () => section("future-value-test-en");

/** m8_future.out 의 S1 구간에서 항목별 구 내 ρ·구간·칸 수를, S2 구간에서 구 내 ρ 를 읽는다. */
function measured() {
  const out = readFileSync(path.join(dir, "m8_future.out"), "utf8");
  const [, s1, s2] = out.split(/===== S[12]:/);
  const row = (text, v) => new RegExp(`^${v}: n (\\d+) .*구내 ρ ([+-][\\d.]+) \\[([+-][\\d.]+),([+-][\\d.]+)\\]`, "m").exec(text);
  return Object.fromEntries(["V1", "V2", "V3", "V4", "B"].map((v) => {
    const a = row(s1, v);
    return [v, { n: Number(a[1]).toLocaleString("en-US"), rho: a[2], lo: a[3], hi: a[4], s2: row(s2, v)[2] }];
  }));
}
const minus = (x) => x.replace("-", "−");

test("기준 파일이 측정 때 적은 해시와 같다", () => {
  const [hash] = readFileSync(path.join(dir, "PREREG.sha256"), "utf8").split(/\s+/);
  assert.equal(createHash("sha256").update(readFileSync(path.join(dir, "PREREG.md"))).digest("hex"), hash);
});

test("표의 값은 고정한 측정 출력 그대로다 (ko·en, 다섯 항목)", () => {
  const m = measured();
  assert.deepEqual([m.V1.rho, m.V2.rho, m.V3.rho, m.V4.rho, m.B.rho], ["-0.145", "+0.246", "-0.123", "-0.118", "+0.011"]);
  for (const [name, html, sep] of [["ko", ko(), " ~ "], ["en", en(), " to "]]) {
    for (const [v, r] of Object.entries(m)) {
      const cell = `<td>${r.n}</td><td>${minus(r.rho)} (${minus(r.lo)}${sep}${minus(r.hi)})</td><td>${minus(r.s2)}</td>`;
      assert.ok(html.includes(cell), `${name} ${v}: ${cell}`);
    }
  }
});

test("판정 줄은 출력의 판정과 같다", () => {
  const out = readFileSync(path.join(dir, "m8_future.out"), "utf8");
  const verdicts = Object.fromEntries([...out.matchAll(/^(V[1-4]|B) \{.*\} → (통과|미달)$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(verdicts, { V1: "미달", V2: "통과", V3: "미달", V4: "미달", B: "미달" });
  assert.equal((ko().match(/0\/5, 미달/g) ?? []).length, 4);
  assert.equal((ko().match(/5\/5, 한 구간 통과/g) ?? []).length, 1);
  assert.equal((en().match(/0\/5, short/g) ?? []).length, 4);
  assert.equal((en().match(/5\/5, passed in one period/g) ?? []).length, 1);
});

test("결과 문단에 「상승기 한 구간·단지를 고르는 기준이 아님」이 같이 있다", () => {
  const paragraphs = (html) => [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  const ruleKo = /상승기 한 구간의 것이고, 단지를 고르는 기준이 아닙니다/;
  const ruleEn = /single rising period[\s\S]*not a basis for choosing a complex/;
  assert.ok(paragraphs(ko()).find((p) => /5개 항목 중 4개가 기준 미달/.test(p))?.match(ruleKo));
  assert.ok(paragraphs(en()).find((p) => /Four of the five items/.test(p))?.match(ruleEn));
  assert.ok(paragraphs(ko()).find((p) => /낮은 가격대에 몰립니다/.test(p))?.match(ruleKo));
  assert.ok(paragraphs(en()).find((p) => /concentrated in the lower ones/.test(p))?.match(ruleEn));
  assert.doesNotMatch(ko() + en(), /\+0\.386|\+0\.121|\+0\.089/);
  assert.match(ko(), /거래 수는 나누지 않았고/);
  assert.match(en(), /Deal count was not split/);
});

test("계획 없음을 적고, 사전 등록이라 부르지 않는다는 사실을 적는다", () => {
  assert.match(ko(), /낼 계획도 없습니다/);
  assert.match(en(), /has no plan to/);
  assert.match(ko(), /사전 등록이라고 부르지 않습니다/);
  assert.match(en(), /not called a pre-registration/);
  assert.doesNotMatch(ko(), /통과하면 낸|통과하면 점수|오를 곳|매수/);
  assert.doesNotMatch(en(), /once it passes|if it passes|likely to rise/i);
});
