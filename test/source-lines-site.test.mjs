// 나가는 장(build/site)의 출처 줄이 scripts/source-lines.ts 상수와 같다 (#588 PR1). 배포 게이트(site-root 를 import 한다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { SITE_DIR, sitePath } from "./helpers/site-root.mjs";
import { FOOTERS } from "../scripts/source-lines.ts";

const pages = (await readdir(SITE_DIR)).filter((f) => f.endsWith(".html")).sort();
// 한국어가 같고 영어만 다른 장이 있다(cancelledDeals·dealSearch) - 한국어로 후보를 고르고 영어로 가린다.
const idsOf = (ko) => Object.keys(FOOTERS).filter((id) => FOOTERS[id].ko === ko);
// 뉴스 장(news.html 과 카테고리 장, 뉴스 내비가 있는 장)의 출처 줄은 기사 RSS·AI 요약 안내라 출처 상수 대상이 아니다(#588 계획).
const isNews = (html) => html.includes('data-news-page="all"');

test("나가는 장에 출처 자리표시({{src:)가 남지 않는다", async () => {
  for (const f of pages) assert.ok(!(await readFile(sitePath(f), "utf8")).includes("{{src:"), f);
});

test("출처 줄이 있는 장은 div·한국어 사전·영어 사전이 모두 같은 상수다", async () => {
  let checked = 0;
  for (const f of pages) {
    const html = await readFile(sitePath(f), "utf8");
    const m = html.match(/<div id="footer-source">([^<]*)<\/div>/);
    if (!m || isNews(html)) continue;
    const id = idsOf(m[1]).find((k) => html.includes(FOOTERS[k].en));
    assert.ok(id, `${f}: 출처 줄이 상수에 없다 - ${m[1]}`);
    assert.equal(html.split(FOOTERS[id].ko).length - 1, 2, `${f} 한국어 두 벌`);
    assert.equal(html.split(FOOTERS[id].en).length - 1, 1, `${f} 영어 한 벌`);
    checked++;
  }
  // 손으로 쓴 틀 11장(index 포함) + realestate.html + 시세 틀에서 나온 46장(예산 18·거래유형 3·자치구 25) - 장이 빠지면 여기서 드러난다.
  assert.ok(checked >= 58, `출처 줄을 확인한 장 ${checked}장`);
});

test("ECOS 에서 받은 값을 보이는 장은 출처 줄에 ECOS 를 적는다 - ECOS 약관 제7조② (legal #588)", async () => {
  const footer = (html) => html.match(/<div id="footer-source">([^<]*)<\/div>/)?.[1] ?? "";
  for (const f of ["index.html", "about.html", "method.html", "jeonse-vs-wolse.html", "price-outlook.html"]) {
    assert.match(footer(await readFile(sitePath(f), "utf8")), /ECOS/, f);
  }
  let budget = 0;
  for (const f of pages) {
    const html = await readFile(sitePath(f), "utf8");
    if (!html.includes('<meta name="budget-band"')) continue;
    assert.equal(footer(html), FOOTERS.budget.ko, `${f}: 예산대 장의 출처 줄`);
    assert.ok(html.includes(FOOTERS.budget.en), `${f}: 예산대 장의 영어 출처 줄`);
    budget++;
  }
  assert.equal(budget, 18, "예산대 장 수");
});
