// 원본: test/realestate-pages.test.mjs 의 아래 시험(들)을 글자 그대로 옮겼다(#507). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 데이터(docs/data·raw)와 그 생성물(docs/*.html)을 맞대는 검사라 데이터 하나만 바뀌어도 결과가 갈린다 - 루트 `npm test`에서는 비차단 점검으로 뺐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REALESTATE_PAGES, buildDistrictPage, buildRealestatePage } from "../../../scripts/build-realestate-pages.ts";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "../../../scripts/district-slugs.ts";
import { stampHtml } from "../../../scripts/updated-stamp.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

test("커밋된 거래 유형별 페이지가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, realestate, complexRatio] = await Promise.all([
    read("scripts/realestate-template.html"),
    readJson("realestate"),
    readJson("complex-ratio").catch(() => null),
  ]);

  for (const page of REALESTATE_PAGES) {
    const committed = await read(`docs/${page.file}`);
    // 틀에는 기준일이 비어 있고 날짜는 build-updated-stamp가 나중에 찍는다(#374). 커밋본의 날짜를 같이 찍어 견준다.
    const ymd = /data-updated="(\d{4}-\d{2}-\d{2})"/.exec(committed)?.[1];
    assert.ok(ymd, `docs/${page.file}에 기준일이 없다`);
    assert.equal(
      committed,
      stampHtml(buildRealestatePage(baseHtml, page, realestate, complexRatio?.seoul ?? null), ymd),
      `docs/${page.file}이 원본과 어긋납니다. node scripts/build-realestate-pages.ts를 실행하세요.`
    );
  }
});

test("커밋된 자치구 페이지 25개가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, realestate, renewal, complexRatio] = await Promise.all([
    read("scripts/realestate-template.html"),
    readJson("realestate"),
    readJson("renewal-facts").catch(() => null),
    readJson("complex-ratio").catch(() => null),
  ]);

  assert.equal(DISTRICT_PAGES.length, 25);
  for (const district of DISTRICT_PAGES) {
    // 자치구 페이지는 realestate.json 말고 그 구의 전수 거래 파일도 읽는다. 빌드가
    // 넘기는 것과 같은 것을 넘겨야 같은 결과가 나온다.
    const deals = await readJson(`deals-${DISTRICT_SLUGS[district.name]}`).catch(() => null);
    const committed = await read(`docs/${district.file}`);
    // 틀에는 기준일이 비어 있고 날짜는 build-updated-stamp가 나중에 찍는다(#374). 커밋본의 날짜를 같이 찍어 견준다.
    const ymd = /data-updated="(\d{4}-\d{2}-\d{2})"/.exec(committed)?.[1];
    assert.ok(ymd, `docs/${district.file}에 기준일이 없다`);
    assert.equal(
      committed,
      stampHtml(
        buildDistrictPage(
          baseHtml,
          district,
          realestate,
          deals,
          renewal?.districts?.[district.name] ?? null,
          complexRatio?.districts?.[district.name] ?? null
        ),
        ymd
      ),
      `docs/${district.file}이 원본과 어긋납니다. node scripts/build-realestate-pages.ts를 실행하세요.`
    );
  }
});
