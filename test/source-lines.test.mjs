// 출처 문구 상수 (#588 PR1). 화면 출처 줄은 scripts/source-lines.ts 한 곳에 있고, 틀에는 {{src:<id>.ko|en}} 자리표시만 있다.
// 나가는 장(build/site)의 출처 줄이 상수와 같은지는 source-lines-site.test.mjs(배포 게이트)가 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ATTRIBUTION, FOOTERS, SOURCES, footerLine, stampSources } from "../scripts/source-lines.ts";
import { buildFigures, readSales, renderBody } from "../scripts/build-correction-release.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

// 출처 머리(「출처:」「Source:」「Sources:」, 사전 키 footerSource: 는 빼고)를 글자로 적어도 되는 파일. 그 밖에 나오면 상수를 거치지 않은 출처 문구다.
// build-correction-release.ts 는 Release 본문 - 상수 import 는 #588 PR2(Release 경로)에서 한다. 그때 이 줄을 지운다.
const ALLOW = new Set(["scripts/source-lines.ts", "scripts/build-correction-release.ts"]);

test("출처 머리 글자는 상수 모듈(과 PR2 대기 Release 본문) 밖의 docs·scripts 에 없다 (#588 완료 조건 1)", () => {
  const out = execFileSync("git", ["grep", "-lE", "출처:|(^|[^[:alnum:]])Sources?:", "--", "docs", "scripts"], { cwd: root, encoding: "utf8" }).trim();
  const stray = out.split("\n").filter((f) => f && !ALLOW.has(f));
  assert.deepEqual(stray, [], `상수를 거치지 않은 출처 문구: ${stray.join(", ")}`);
});

test("출처 줄은 HTML 본문·JS 큰따옴표 문자열 두 곳에 그대로 들어갈 수 있는 글자만 쓴다", () => {
  for (const [id, line] of Object.entries(FOOTERS)) {
    for (const lang of ["ko", "en"]) {
      assert.equal(typeof line[lang], "string", `${id}.${lang}`);
      assert.doesNotMatch(line[lang], /["\\<>&\n]/, `${id}.${lang}`);
      assert.match(line[lang], lang === "ko" ? /^출처: / : /^Sources?: /, `${id}.${lang}`);
    }
  }
});

test("stampSources: 자리표시를 상수로 바꾸고, 모르는 id·틀린 모양은 던진다", () => {
  assert.equal(stampSources("<div>{{src:about.ko}}</div>"), `<div>${FOOTERS.about.ko}</div>`);
  assert.equal(stampSources('x: "{{src:method.en}}",'), `x: "${FOOTERS.method.en}",`);
  assert.equal(stampSources("자리표시 없음"), "자리표시 없음");
  assert.throws(() => stampSources("{{src:nope.ko}}"), /FOOTERS 에 없는 id/);
  assert.throws(() => stampSources("{{src:about.fr}}"), /모양이 틀렸다/);
});

test("footerLine: 머리·구분·영어 and", () => {
  assert.equal(footerLine("ko", ["가", "나"], "꼬리."), "출처: 가, 나. 꼬리.");
  assert.equal(footerLine("en", ["A", "B", "C"], "", { and: true }), "Source: A, B, and C.");
  assert.equal(footerLine("en", ["A", "B"], "", { label: "Sources: ", sep: "; " }), "Sources: A; B.");
});

test("틀의 출처 줄은 자리표시다 - 장마다 한국어 두 벌(div·사전)·영어 한 벌", async () => {
  const PAGES = {
    "docs/index.html": "index", "docs/about.html": "about", "docs/method.html": "method", "docs/cancelled-deals.html": "cancelledDeals", "docs/deal-search.html": "dealSearch",
    "scripts/realestate-template.html": "realestate", "docs/realestate.html": "realestate", "docs/floor-gap.html": "floorGap",
    "docs/jeonse-vs-wolse.html": "jeonseVsWolse", "docs/record-high.html": "recordHigh", "docs/renewal-vs-new.html": "renewalVsNew",
    "docs/switch-house.html": "switchHouse", "docs/price-outlook.html": "priceOutlook",
  };
  for (const [file, id] of Object.entries(PAGES)) {
    const html = await read(file);
    assert.ok(html.includes(`<div id="footer-source">{{src:${id}.ko}}</div>`), `${file} div`);
    assert.equal(html.split(`{{src:${id}.ko}}`).length - 1, 2, `${file} ko`);
    assert.equal(html.split(`{{src:${id}.en}}`).length - 1, 1, `${file} en`);
  }
});

test("Release 출처 문장은 legal 표 원문 상수(ATTRIBUTION.molitSale)와 글자까지 같다", async () => {
  const body = renderBody(buildFigures(await readSales(path.join(root, "test/fixtures/correction-twins/raw"))));
  const [ko, en] = body.split("\n---\n");
  assert.ok(ko.includes(ATTRIBUTION.molitSale.ko("수집 시각 2026-10-10")));
  assert.ok(en.includes(ATTRIBUTION.molitSale.en("collected 2026-10-10")));
  assert.equal(SOURCES.molitSale.dataset, "15126469");
});

test("Release 는 KB 계열(901Y062·901Y063, kb_sale·kb_jeonse)을 싣지 않는다 - raw/sale 만 읽는다 (legal #588)", async () => {
  const src = await read("scripts/build-correction-release.ts");
  assert.doesNotMatch(src, /kb_sale|kb_jeonse|901Y06[23]|KB국민|series\.json|raw\/indicators/);
  const figures = buildFigures(await readSales(path.join(root, "test/fixtures/correction-twins/raw")));
  assert.deepEqual(figures.source, { datasetId: SOURCES.molitSale.dataset });
  const wf = await read(".github/workflows/correction-release.yml");
  assert.doesNotMatch(wf, /kb_sale|kb_jeonse|901Y06[23]|raw\/indicators/);
});
