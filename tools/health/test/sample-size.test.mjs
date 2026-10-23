// 원본: test/sample-size.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const json = async (file) => JSON.parse(await read(file));

const sentencesOf = (text) => text.split(/(?<=[다요)])\.\s+/).map((s) => s.trim()).filter(Boolean);
const textOf = (html) => html.replace(/<[^>]+>/g, "");
const block = (html, name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1] ?? "";

test("jeonse-vs-wolse: 대출 금리 문장의 상품·옵션 수가 conversion.json·rates.json과 같고 '평균'이라 쓰지 않는다", async () => {
  const [html, data, rates] = await Promise.all([
    read("docs/jeonse-vs-wolse.html"),
    json("docs/data/conversion.json"),
    json("docs/data/rates.json"),
  ]);
  const lead = textOf(block(html, "conversionLead"));
  assert.ok(!lead.includes("평균 금리는"), "중앙값을 '평균 금리는'이라고 쓴다(#183)");
  const sentence = sentencesOf(lead).find((s) => s.includes("전세자금대출의 옵션별 평균 금리의 중앙값은"));
  assert.ok(sentence, "대출 금리(중앙값) 문장이 없다");
  const rate = sentence.match(/중앙값은 (\d+(\.\d+)?)%/);
  assert.equal(Number(rate?.[1]), data.loan.rate);
  const n = sentence.match(/\(([0-9,]+)개 상품 중 평균 금리가 있는 ([0-9,]+)개 상품의 ([0-9,]+)개 옵션 기준\)/);
  assert.ok(n, `같은 문장에 상품·옵션 수가 없다: ${sentence}`);
  const num = (t) => Number(t.replaceAll(",", ""));
  assert.equal(num(n[1]), data.loan.products);
  assert.equal(num(n[2]), data.loan.productsWithAvg);
  assert.equal(num(n[3]), data.loan.options);
  // 옵션 수는 JSON 필드만 믿지 않고 원자료에서 다시 센다: 중앙값을 낸 입력 = avg가 숫자인 옵션.
  const avgOptions = rates.rentLoan.flatMap((p) => p.options ?? []).filter((o) => Number.isFinite(o?.avg)).length;
  assert.equal(data.loan.options, avgOptions);
  assert.equal(data.loan.products, rates.rentLoan.length);
  const withAvg = rates.rentLoan.filter((p) => (p.options ?? []).some((o) => Number.isFinite(o?.avg))).length;
  assert.equal(data.loan.productsWithAvg, withAvg);
  assert.ok(withAvg <= rates.rentLoan.length && avgOptions >= withAvg, "상품·옵션 수의 포함 관계가 맞지 않는다");
  assert.equal(lead, data.seoul.leadKo, "화면 문장이 JSON의 문장과 다르다");
});
