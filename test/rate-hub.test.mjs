import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { RATE_PAGES } from "../scripts/build-rate-pages.ts";
import { countShared } from "../scripts/rate-dup.ts";
import { SITE } from "./helpers/site-root.mjs";

// #193: docs/rates.html은 상품군 네 장으로 가는 요약 허브다. 예금 페이지와 본문이 글자까지 같던 것을
// 없앴고(기준선: 같은 문단 2쌍·같은 문장 14쌍), 그게 다시 생기지 않게 지킨다.

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

test("허브는 네 상품군 장 각각과 같은 문단·같은 문장이 0쌍이다", async () => {
  const hub = await read(`${SITE}/rates.html`);
  for (const { file } of RATE_PAGES) {
    const r = countShared(hub, await read(`${SITE}/${file}`));
    assert.equal(r.sharedParagraphs, 0, `rates.html과 ${file}에 같은 문단 ${r.sharedParagraphs}쌍`);
    assert.equal(r.sharedSentences, 0, `rates.html과 ${file}에 같은 문장: ${r.sharedSentenceTexts.join(" | ")}`);
  }
});

test("허브가 네 장 각각으로 가는 링크를 한·영 양쪽에 갖고 대상 파일이 있다", async () => {
  const hub = await read(`${SITE}/rates.html`);
  const [ko, en] = [/<div data-lang="ko"[\s\S]*?<\/div>/.exec(hub)?.[0], /<div data-lang="en"[\s\S]*?<\/div>/.exec(hub)?.[0]];
  assert.ok(ko && en, "한·영 블록을 찾지 못했다");
  for (const { file } of RATE_PAGES) {
    assert.ok(ko.includes(`<a href="./${file}">`), `한국어 블록에 ${file} 링크가 없다`);
    assert.ok(en.includes(`<a href="./${file}">`), `영어 블록에 ${file} 링크가 없다`);
    await access(path.join(root, SITE, file));
  }
});

test("허브는 noindex를 유지하고 상품군 장은 색인 대상이다", async () => {
  assert.match(await read(`${SITE}/rates.html`), /<meta name="robots" content="noindex, follow">/);
  for (const { file } of RATE_PAGES) {
    assert.match(await read(`${SITE}/${file}`), /<meta name="robots" content="index, follow">/, `${file}`);
  }
});

test("허브는 표·금리 수치·데이터 읽기를 갖지 않는다", async () => {
  const hub = await read(`${SITE}/rates.html`);
  assert.ok(!/<table|<tbody|data\/rates\.json|%/.test(hub), "허브에 표나 금리 수치가 있다");
});

test("상품군 장의 틀은 docs 밖(scripts/rates-template.html)에 있다", async () => {
  await access(path.join(root, "scripts/rates-template.html"));
  await assert.rejects(access(path.join(root, `${SITE}/rates-template.html`)));
});

test("같은 <script src>가 한 장에 두 번 나오지 않는다 (docs/*.html 전체, 허브·상품군 장 포함)", async () => {
  // analytics.js가 두 번 돌면 GA 로더와 gtag('config')가 두 번 실행돼 page_view가 이중 집계될 수 있다.
  // 허브를 손으로 고치다 nav·search·analytics 세 줄이 두 번 들어간 적이 있다(#193 수정요청).
  // 이 저장소에 이런 일반 시험이 없어 여기 둔다 — 위 둘이 아니라 모든 장을 본다.
  const files = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html"));
  assert.ok(files.length > 50, `docs/*.html이 ${files.length}장뿐이다`);
  for (const f of files) {
    const seen = new Map();
    for (const m of (await read(`${SITE}/${f}`)).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
      seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
    }
    const dup = [...seen].filter(([, n]) => n > 1).map(([src, n]) => `${src} x${n}`);
    assert.deepEqual(dup, [], `${SITE}/${f}에 같은 스크립트가 여러 번: ${dup.join(", ")}`);
  }
});
