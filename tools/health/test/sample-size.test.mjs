// 원본: test/sample-size.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "../../../test/helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const json = async (file) => JSON.parse(await read(file));

const textOf = (html) => html.replace(/<[^>]+>/g, "");
const block = (html, name) => html.match(new RegExp(`<!--prerender:${name}-->([\\s\\S]*?)<!--/prerender:${name}-->`))?.[1] ?? "";

test("jeonse-vs-wolse: 대출 금리 문장이 conversion.json 의 값·달과 같고, 그 값이 ECOS 계열(raw/indicators/series.json)의 같은 달 값이며 잔액 기준이라고 밝힌다 (#577 B1b)", async () => {
  const { rateBasisLine } = await import("../../../scripts/conversion.ts");
  const { ratesOf } = await import("../../../scripts/build-conversion.ts");
  const [html, data, raw] = await Promise.all([
    read(`${SITE}/jeonse-vs-wolse.html`),
    json("docs/data/conversion.json"),
    json("raw/indicators/series.json"),
  ]);
  const lead = textOf(block(html, "conversionLead"));
  assert.ok(!lead.includes("중앙값은") && !/개 옵션 기준/.test(lead), `금감원 중앙값 문장이 남았다(conversion.json 이 B1b 전 모양): ${lead}`);
  const rate = lead.match(/전세자금대출 평균금리는 (\d+(\.\d+)?)%/);
  assert.equal(Number(rate?.[1]), data.loan.rate);
  assert.equal(data.loan.basis, "balance");
  assert.equal(data.deposit.month, data.loan.month, "예금 금리가 '같은 달'이 아니다");
  assert.ok(lead.endsWith(rateBasisLine(data.loan.month, "ko")), `리드 끝에 금리 근거 줄(잔액 기준·달)이 없다: ${lead}`);
  // 값은 JSON 만 믿지 않고 원자료(ECOS 계열)에서 다시 낸다. 계열이 그 뒤 새 달을 받았는데 전환율을 다시 만들지 않았으면 여기서 갈린다.
  const fromSeries = ratesOf(raw.series);
  assert.ok(fromSeries, "series.json 에 전세자금대출·정기예금 같은 달 값이 없다");
  assert.deepEqual({ loan: data.loan, deposit: data.deposit }, fromSeries);
  assert.equal(lead, data.seoul.leadKo, "화면 문장이 JSON의 문장과 다르다");
});
