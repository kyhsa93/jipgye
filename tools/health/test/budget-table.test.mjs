// 원본: test/budget-table.test.mjs 의 실데이터 짝이다. 근거표 장(#871 PR-A)의 실데이터 점검 - 비차단(cto 착수 판정 4c). 루트 test/budget-table.test.mjs 는 고정 데이터와 구조만 보고, 여기는 커밋된 docs/data 와
// 같은 HEAD 로 만든 build/site 를 맞댄다: 오늘 reco 25개로 숫자가 실제로 구워졌는지, 구운 머리가 같은 함수로 다시 센 값과 같은지, reco 단지 이름이 실거래 검색 카드로
// 풀리는지(cto 5-(ii): reco 빌더가 soft-fail 해 어제 판이 남고 complex-price 만 새로 나가면 창이 어긋나 카드가 안 풀릴 수 있다 - 장은 막지 않고 여기서 센다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { budgetModel, budgetTableHtml, headText, recoCounts, recoViews } from "../../../scripts/budget-table.ts";
import { COUNTS_FILE } from "../../../scripts/build-reco-counts.ts";
import { DISTRICT_SLUGS } from "../../../scripts/district-slugs.ts";
import { SITE_DIR } from "../../../test/helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const data = (name) => readFile(path.join(root, "docs/data", `${name}.json`), "utf8").then(JSON.parse);
const slugs = Object.values(DISTRICT_SLUGS);
const files = await Promise.all(slugs.map((s) => data(`reco-${s}`).catch(() => null)));

test("근거표: 오늘 reco 25개가 장의 모양으로 읽히고, build/site 의 구운 보기가 같은 함수로 다시 그린 것과 같다", async () => {
  const views = recoViews(files);
  assert.ok(views, "reco 25개 중 없거나 모양이 다른 파일이 있다 - 장은 빈 자리(JS 꺼짐 안내)로 나갔다");
  const model = budgetModel(views);
  const html = await readFile(path.join(SITE_DIR, "buy-by-budget.html"), "utf8");
  const slot = html.match(/<!--prerender:budgetTable-->([\s\S]*?)<!--\/prerender:budgetTable-->/)?.[1];
  assert.ok(slot?.includes(headText(model, "ko")), "구운 머리가 오늘 데이터로 다시 센 것과 다르다");
  // 머리글 방향(scope)은 applyPrerender 가 단다 - 그것만 걷고 맞댄다.
  assert.equal(slot.replace(/ scope="(?:col|row)"/g, ""), budgetTableHtml(model));
  assert.ok(model.M > 0, "기본 조건(7억대·전체 면적)에서 값 낸 곳이 0이다");
  assert.ok(model.example && model.example.rows.length >= 1 && model.example.rows.length <= 3, "예시 줄 1~3");
});

test("근거표: reco 단지 이름(별칭 포함)이 같은 구 complex-price 칸 이름으로 전부 풀린다 - 미해결 0", async () => {
  const unresolved = [];
  let names = 0;
  for (const [i, slug] of slugs.entries()) {
    const reco = files[i];
    if (!reco) continue;
    const cells = (await data(`complex-price-${slug}`)).cells ?? {};
    const at = reco.apartmentFields.indexOf("name");
    const aliasAt = reco.apartmentFields.indexOf("aliases");
    for (const row of reco.apartments) {
      names++;
      const alias = row[aliasAt].map((k) => String(k).split("|").at(-1));
      if (!(row[at] in cells) && !alias.some((a) => a in cells)) unresolved.push(`${reco.district} ${row[at]}`);
    }
  }
  assert.ok(names > 0);
  assert.deepEqual(unresolved, [], `카드로 안 풀리는 단지 ${unresolved.length}/${names}곳`);
});

// PR-B(cto 조건 C): 렌더 단계가 만든 건수 파일이 build/site 에 있고 ≤6KB(gzip)이며, 같은 HEAD 의 reco 로 다시 센 것과 같다.
// 건수 단계는 reco 를 못 읽으면 경고만 남기고 파일 없이 끝난다(cto 4b) - 배포를 막지 않으니 그 경우를 여기서 잡는다.
test("근거표 건수 파일: build/site 에 있고 gzip ≤6KB, 오늘 reco 로 다시 센 것과 같다", async () => {
  const text = await readFile(path.join(SITE_DIR, COUNTS_FILE), "utf8").catch(() => null);
  assert.ok(text, `${COUNTS_FILE} 가 build/site 에 없다 - 렌더 로그의 build-reco-counts ::warning:: 를 본다(장은 구운 기본 보기만 보인다)`);
  const size = gzipSync(text, { level: 9 }).length;
  assert.ok(size <= 6 * 1024, `건수 파일 gzip ${size}B > 6KB(po 명세 ④)`);
  const views = recoViews(files);
  assert.ok(views);
  assert.deepEqual(JSON.parse(text), recoCounts(views));
});
