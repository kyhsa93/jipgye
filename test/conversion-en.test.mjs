import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadConversionPage } from "./helpers/conversion-page.mjs";

// 영어 화면의 금액 표기 (#458). 영어 사전의 eok·man 이 한국어용 문자열 뒤에 "00M"·"0K" 를 이어 붙여
// 95,900만원이 `₩9.5900M`, 1,234만원이 `₩1,2340K` 로 나갔다. 사전이 숫자를 받아 단위(억 → M, 만원 → K)로 바꿔 쓴다.
// 이 값들은 이슈 합격선 그대로다: 1억 = 100M, 1만원 = 10K, 0.01억(= 1M) 아래는 한국어와 같게 반올림.

const EOK_CASES = [
  [95_900, "9.59억", "₩959M"],
  [65_900, "6.59억", "₩659M"],
  [5_000, "0.5억", "₩50M"],
  [123_400, "12.34억", "₩1,234M"],
  [40_000, "4억", "₩400M"],
  [320_000, "32억", "₩3,200M"],
  [95_950, "9.6억", "₩960M"], // 0.01억 아래 반올림: 한국어 9.6억과 같은 쪽
  [0, "0억", "₩0M"],
];

const MAN_CASES = [
  [247, "247만원", "₩2,470K"],
  [1_234, "1,234만원", "₩12,340K"], // 월 1,000만원 이상: 쉼표
  [173.8, "174만원", "₩1,740K"], // 소수는 한국어와 같게 정수로 반올림한 뒤 환산
  [0, "0만원", "₩0K"],
  [-5, "-5만원", "-₩50K"], // 전세에 남는 돈이 보증금보다 커서 비용이 음수일 때
  [-1_234, "-1,234만원", "-₩12,340K"],
  [-0.3, null, "₩0K"], // 반올림하면 -0 - "-₩0K" 가 되면 안 된다 (한국어의 "-0만원" 은 이 PR 의 면 밖)
];

const call = (page, expr) => vm.runInContext(expr, page.sandbox);

test("영어 억 표기는 소수 억·10억 이상·0 에서도 M 단위 정수와 쉼표다", async () => {
  const page = await loadConversionPage({ conversion: null });
  await page.toggleLang();

  for (const [value, , en] of EOK_CASES) assert.equal(call(page, `eok(${value})`), en, `eok(${value})`);
});

test("영어 만원 표기는 1,000만원 이상·0·음수에서도 K 단위 정수와 쉼표·부호다", async () => {
  const page = await loadConversionPage({ conversion: null });
  await page.toggleLang();

  for (const [value, , en] of MAN_CASES) assert.equal(call(page, `man(${value})`), en, `man(${value})`);
});

test("한국어 억·만원 표기는 그대로다", async () => {
  const page = await loadConversionPage({ conversion: null });

  for (const [value, ko] of EOK_CASES) assert.equal(call(page, `eok(${value})`), ko, `eok(${value})`);
  for (const [value, ko] of MAN_CASES) if (ko) assert.equal(call(page, `man(${value})`), ko, `man(${value})`);
});

test("영어로 바꾸면 표의 전세·보증금·월세가 새 표기로 나온다", async () => {
  const cell = (district, jeonse10k, deposit10k, monthly10k) => ({
    district, band: "60to85", rate: 4.5, jeonse10k, deposit10k, monthly10k, pairs: 12, noteKo: "", noteEn: "",
  });
  const conversion = {
    updatedAt: "2026-10-01T00:00:00Z",
    months: ["202610"],
    ltv: 0.8,
    bands: [{ key: "60to85", label: "60~85㎡" }],
    slugs: {},
    seoul: { rate: 4.5, pairs: 12, verdict: "even", leadKo: "가", leadEn: "a" },
    loan: { rate: 4.4 },
    deposit: { rate: 3.8 },
    cells: [cell("강남구", 95_900, 40_000, 1_234), cell("노원구", 5_000, 5_000, 247)],
  };
  const page = await loadConversionPage({ conversion });
  await page.toggleLang();
  const table = page.tableHtml();

  assert.match(table, /<td>₩959M<\/td>/);
  assert.match(table, /<td>₩400M \/ ₩12,340K<\/td>/);
  assert.match(table, /<td>₩50M<\/td>/);
  assert.match(table, /<td>₩50M \/ ₩2,470K<\/td>/);
  assert.doesNotMatch(table, /₩\d+\.\d|,\d{4}K/, "소수점이나 이어 붙인 옛 표기가 남았다");
});
