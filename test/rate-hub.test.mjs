import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { RATE_PAGES } from "../scripts/build-rate-pages.mjs";
import { countShared } from "../scripts/rate-dup.mjs";

// #193: docs/rates.html은 상품군 네 장으로 가는 요약 허브다. 예금 페이지와 본문이 글자까지 같던 것을
// 없앴고(기준선: 같은 문단 2쌍·같은 문장 14쌍), 그게 다시 생기지 않게 지킨다.

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

test("허브는 네 상품군 장 각각과 같은 문단·같은 문장이 0쌍이다", async () => {
  const hub = await read("docs/rates.html");
  for (const { file } of RATE_PAGES) {
    const r = countShared(hub, await read(`docs/${file}`));
    assert.equal(r.sharedParagraphs, 0, `rates.html과 ${file}에 같은 문단 ${r.sharedParagraphs}쌍`);
    assert.equal(r.sharedSentences, 0, `rates.html과 ${file}에 같은 문장: ${r.sharedSentenceTexts.join(" | ")}`);
  }
});

test("허브가 네 장 각각으로 가는 링크를 한·영 양쪽에 갖고 대상 파일이 있다", async () => {
  const hub = await read("docs/rates.html");
  const [ko, en] = [/<div data-lang="ko"[\s\S]*?<\/div>/.exec(hub)?.[0], /<div data-lang="en"[\s\S]*?<\/div>/.exec(hub)?.[0]];
  assert.ok(ko && en, "한·영 블록을 찾지 못했다");
  for (const { file } of RATE_PAGES) {
    assert.ok(ko.includes(`<a href="./${file}">`), `한국어 블록에 ${file} 링크가 없다`);
    assert.ok(en.includes(`<a href="./${file}">`), `영어 블록에 ${file} 링크가 없다`);
    await access(path.join(root, "docs", file));
  }
});

test("허브는 noindex를 유지하고 상품군 장은 색인 대상이다", async () => {
  assert.match(await read("docs/rates.html"), /<meta name="robots" content="noindex, follow">/);
  for (const { file } of RATE_PAGES) {
    assert.match(await read(`docs/${file}`), /<meta name="robots" content="index, follow">/, `${file}`);
  }
});

test("허브는 표·금리 수치·데이터 읽기를 갖지 않는다", async () => {
  const hub = await read("docs/rates.html");
  assert.ok(!/<table|<tbody|data\/rates\.json|%/.test(hub), "허브에 표나 금리 수치가 있다");
});

test("상품군 장의 틀은 docs 밖(scripts/rates-template.html)에 있다", async () => {
  await access(path.join(root, "scripts/rates-template.html"));
  await assert.rejects(access(path.join(root, "docs/rates-template.html")));
});
