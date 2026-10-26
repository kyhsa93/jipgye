// 쉬운 용어(#745 PR5): 시세 화면·메인·소개·방법 장에서 「평당가·평단가·거래량」을 화면 글자로 내지 않고,
// 값을 못 낸 칸은 「-」가 아니라 「데이터 없음」(영어 No data)이다. 주석(HTML·JS 한 줄)은 화면에 나오지 않으므로 뺀다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RE_LABELS, reHeadLabels, headLabels } from "../scripts/realestate-table.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const visible = (src) =>
  src
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

const PAGES = ["scripts/realestate-template.html", "docs/realestate.html", "docs/index.html", "docs/about.html", "docs/method.html"];
const BANNED = ["평당가", "평단가", "거래량", "거래건수"];

test("시세·메인·소개·방법 장의 화면 글자에 어려운 용어(평당가·평단가·거래량·거래건수)가 없다", () => {
  for (const rel of PAGES) {
    const text = visible(read(rel));
    for (const word of BANNED) assert.ok(!text.includes(word), `${rel}: 「${word}」가 남았다`);
  }
});

test("시세표 라벨은 3.3㎡당 평균·거래 건수·중간값으로 적는다", () => {
  const labels = Object.values(RE_LABELS).join("|");
  for (const word of [...BANNED, "중앙값"]) assert.ok(!labels.includes(word), `RE_LABELS 에 「${word}」`);
  assert.deepEqual(reHeadLabels(null).slice(1), ["매매 3.3㎡당 평균", "전세 3.3㎡당 평균 보증금", "월세 평균 보증금 / 월세"]);
  assert.deepEqual(headLabels("sale", "종로구"), ["구분", "3.3㎡당 평균", "84㎡ 환산", "거래 건수"]);
});

test("값 없는 칸은 「데이터 없음」 / No data (틀·메인 모두 한·영 쌍)", () => {
  for (const rel of ["scripts/realestate-template.html", "docs/realestate.html", "docs/index.html"]) {
    const src = read(rel);
    assert.match(src, /noData: "데이터 없음"/, `${rel}: ko`);
    assert.match(src, /noData: "No data"/, `${rel}: en`);
  }
  const index = read("docs/index.html");
  for (const kind of ["sale", "jeonse", "wolse"]) assert.match(index, new RegExp(`if \\(!${kind}\\) return t\\("noData"\\);`), `index ${kind}`);
  assert.match(read("scripts/realestate-table.ts"), /const NONE = \(\) => \[part\("text", "데이터 없음"\)\];/);
});

test("메인 목적 카드 묶음의 aria-label 은 영어 쌍이 있고, 시장 동향 카드는 전망 장을 한 번만 잇는다(#748 후속)", () => {
  const index = read("docs/index.html");
  assert.match(index, /homeGoals: "무엇을 할까요"/);
  assert.match(index, /homeGoals: "What to do"/);
  assert.match(index, /getElementById\("home-goals"\)\.ariaLabel = t\("homeGoals"\)/);
  const at = index.indexOf("시장 동향");
  const card = index.slice(index.lastIndexOf("<div", at), index.indexOf("</p></div>", at));
  assert.equal(card.match(/price-outlook\.html/g).length, 1, card);
});
