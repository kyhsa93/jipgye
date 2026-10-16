import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { LOAN_LTV, compare, monthlyCost } from "../scripts/conversion.mjs";

const root = path.resolve(import.meta.dirname, "..");
const PAGE = path.join(root, "docs/jeonse-vs-wolse.html");

/**
 * 화면은 사용자가 가진 돈을 바꿀 때마다 다시 재야 해서 계산을 한 벌 더 가지고 있다.
 * 두 벌이 갈라지면 빌드가 내는 숫자와 화면이 보여주는 숫자가 달라지는데, 그건
 * 어느 쪽도 틀렸다고 말해 주지 않으므로 여기서 같은 입력에 같은 답이 나오는지 본다.
 */
async function pageCalculator() {
  const html = await readFile(PAGE, "utf8");
  const source = /const TAX_RATE = [\s\S]*?\n}\n\nconst cache = /.exec(html);
  assert.ok(source, "화면의 계산 코드를 찾지 못했습니다. 함수 이름이 바뀌었는지 확인하세요.");

  // 별도 컨텍스트에서 돌리면 거기서 만들어진 객체가 다른 realm에 속해, 값이 같아도
  // deepStrictEqual이 프로토타입 때문에 실패한다. 같은 realm에서 평가하되 전역이
  // 더럽혀지지 않도록 즉시실행 함수로 감싼다.
  const body = source[0].replace("\nconst cache = ", "");
  return vm.runInThisContext(`(() => { ${body}\nreturn { monthlyCost, compare, TAX_RATE, EOK }; })()`);
}

const CASES = [
  { jeonse10k: 50_000, deposit10k: 20_000, monthly10k: 125, cash10k: 20_000 },
  { jeonse10k: 95_000, deposit10k: 40_000, monthly10k: 220, cash10k: 30_000 },
  { jeonse10k: 95_000, deposit10k: 40_000, monthly10k: 220, cash10k: 10_000 },
  { jeonse10k: 62_500, deposit10k: 10_000, monthly10k: 173.8, cash10k: 70_000 },
  { jeonse10k: 30_000, deposit10k: 5_000, monthly10k: 90, cash10k: 0 },
  { jeonse10k: 68_750, deposit10k: 30_000, monthly10k: 140, cash10k: 68_750 },
];

const RATES = { loanRate: 4.38, depositRate: 3.8 };

test("화면의 월 비용 계산이 빌드 쪽과 한 자리도 다르지 않다", async () => {
  const page = await pageCalculator();

  for (const item of CASES) {
    for (const [label, args] of [
      ["전세", { deposit10k: item.jeonse10k }],
      ["월세", { deposit10k: item.deposit10k, monthlyRent10k: item.monthly10k }],
    ]) {
      const mine = monthlyCost({ ...args, cash10k: item.cash10k, ...RATES });
      const theirs = page.monthlyCost({ ...args, cash10k: item.cash10k, ...RATES, ltv: LOAN_LTV });
      assert.deepEqual(theirs, mine, `${label} ${JSON.stringify(item)}에서 두 계산이 갈라졌다`);
    }
  }
});

test("화면의 비교 결과가 빌드 쪽과 같은 쪽을 고른다", async () => {
  const page = await pageCalculator();

  for (const item of CASES) {
    const mine = compare({ ...item, ...RATES });
    const theirs = page.compare({ ...item, ...RATES, ltv: LOAN_LTV });
    assert.deepEqual(theirs, mine, `${JSON.stringify(item)}에서 두 비교가 갈라졌다`);
  }
});

test("화면이 쓰는 이자소득세율이 금리 화면과 같다", async () => {
  const page = await pageCalculator();
  const { TAX_RATE } = await import("../scripts/interest.mjs");
  assert.equal(page.TAX_RATE, TAX_RATE);
});

test("화면이 대출 한도를 빌드와 같은 값으로 넘긴다", async () => {
  // ltv는 화면이 스스로 정하지 않고 conversion.json에 실려 온다. 빌드가 넣는 값과
  // 테스트가 쓰는 값이 같아야 위의 두 검사가 의미를 가진다.
  const { buildPayload } = await import("../scripts/build-conversion.mjs");
  const deal = (extra) => ({
    district: "노원구",
    dong: "하계동",
    apt: "극동아파트",
    area: 84.9,
    date: "2026-08-14",
    renewal: false,
    ...extra,
  });
  const deals = ["가", "나", "다"].flatMap((name) => [
    deal({ apt: name, deposit10k: 50_000 }),
    deal({ apt: name, deposit10k: 20_000, monthlyRent10k: 125 }),
  ]);

  const payload = buildPayload({
    deals,
    rates: { rentLoan: [{ options: [{ min: 3, max: 5, avg: 4 }] }], deposit: [{ options: [{ term: 12, rate: 3.8 }] }] },
    months: ["202608"],
    now: new Date("2026-08-26T00:00:00Z"),
  });

  assert.equal(payload.ltv, LOAN_LTV);
});

// jeonse-vs-wolse의 CLS는 "조건 칸과 답 자리가 빈 채로 태어나 데이터가 온 뒤에 채워지는 것"이었다
// (#287 (라), 2026-10-16 실측 0.1876 = 절대 상한 0.1의 1.9배). 고친 방식은 비어 있는 동안만 서는 자리와
// 줄 묶음을 CSS로 못박는 것이라, 되풀이는 네 길로 들어온다 — 구운 자리가 안 비거나(또는 이름이 바뀌거나),
// 예약 규칙이 사라지거나, 반 줄 폭이 간격 토큰을 안 쓰게 되거나, 예약의 범위를 여는 class가 빠지거나.
// 넷 다 여기서 막는다. 값(시세·날짜)에 기대지 않는 구조 검사다(#8).
test("조건 칸과 답 자리는 데이터가 오기 전에도 자리를 잡는다 (#287)", async () => {
  const html = await readFile(PAGE, "utf8");

  // (1) 예약이 걸리는 자리는 ":empty"다 - 구운 장에서 비어 있지 않으면 규칙이 아예 안 붙는다.
  assert.match(html, /<div id="calc-result"><\/div>/, "docs/jeonse-vs-wolse.html: #calc-result가 빈 채로 구워지지 않는다 - :empty 예약이 안 붙는다");
  assert.match(
    html,
    /<div class="search-controls" id="calc-controls">/,
    "docs/jeonse-vs-wolse.html: #calc-controls가 search-controls class로 구워지지 않는다 - 반 줄 폭이 쓰는 --controls-gap-x 토큰의 범위가 사라졌다"
  );

  // 반 줄을 받는 칸은 "select를 품은 .search-field"다. 셀렉트 둘이 <option> 없이 구워지는 것이
  // 이 장의 이동을 만든 원인이고(69.53 -> 125.53·135.53px), 예약은 그 자리를 미리 잡는다.
  for (const id of ["district-select", "band-select"]) {
    assert.match(
      html,
      new RegExp(`<div class="search-field">\\s*<label for="${id}"[^>]*>[^<]*</label>\\s*<select id="${id}"></select>`),
      `docs/jeonse-vs-wolse.html: #${id}가 .search-field 안의 빈 <select>로 구워지지 않는다 - :has(select) 예약이 안 붙는다`
    );
  }

  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");

  // (2) 예약을 세우는 규칙 둘. 하나라도 빠지면 같은 밀림이 돌아온다.
  for (const rule of [
    /#calc-controls \.search-field:has\(select\) \{\n  flex-basis: calc\(50% - var\(--controls-gap-x\) \/ 2\);\n\}/,
    /#calc-result:empty,\n#calc-result:has\(> p:only-child\) \{\n  min-height: 100vh;\n\}/,
  ]) {
    assert.match(css, rule, "src/css/legacy.css: jeonse-vs-wolse 자리 예약 규칙이 사라졌다");
  }

  // (3) 반 줄은 .search-controls의 가로 간격을 나눠 쓴다. 토큰이 없어지면 calc가 죽는다
  // (숫자를 베껴 적으면 간격을 고칠 때 예약이 안 따라온다 - #336 교훈).
  assert.match(
    css,
    /\.search-controls \{\n(?:[^}]*\n)?  --controls-gap-x: 16px;\n(?:[^}]*\n)?  gap: 10px var\(--controls-gap-x\);/,
    "src/css/legacy.css: --controls-gap-x가 없어졌거나 gap이 그 토큰을 안 쓴다"
  );

  // (4) 한 문단짜리 답(자료 없음·불러오기 실패)도 예약을 받아야 한다. 장 안 스크립트가 그 모양으로
  // 답을 쓰는지 여기서 본다 - 모양이 바뀌면 :has(> p:only-child)가 아무것도 안 집는다.
  for (const re of [
    /getElementById\("calc-result"\)\.innerHTML = `<p class="empty">\$\{escapeHtml\(t\("notReady"\)\)\}<\/p>`/,
    /getElementById\("calc-result"\)\.innerHTML =\n\s*`<p class="empty">\$\{escapeHtml\(t\("loadError"\)\)\} <button type="button" id="load-retry">/,
  ]) {
    assert.match(html, re, "docs/jeonse-vs-wolse.html: 실패·자료없음 답이 한 문단(p:only-child) 모양이 아니다 - 예약이 걷혀 표가 화면 안으로 올라온다");
  }
});
