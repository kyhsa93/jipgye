// 출처 문구 상수 (#588 PR1). 화면 출처 줄은 scripts/source-lines.ts 한 곳에 있고, 틀에는 {{src:<id>.ko|en}} 자리표시만 있다.
// 나가는 장(build/site)의 출처 줄이 상수와 같은지는 source-lines-site.test.mjs(배포 게이트)가 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ATTRIBUTION, DERIVED, FOOTERS, SOURCES, footerLine, stampSources } from "../scripts/source-lines.ts";
import { buildFigures, buildRelease, readSales, renderBody } from "../scripts/build-correction-release.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

// 출처 머리(「출처:」「Source:」「Sources:」, 사전 키 footerSource: 는 빼고)를 글자로 적어도 되는 파일. 그 밖에 나오면 상수를 거치지 않은 출처 문구다.
// Release 본문(scripts/build-correction-release.ts)도 상수를 import 한다(#588 PR2) - 허용 파일은 상수 모듈 하나다. test/ 의 글자 고정(legal 원문 바이트 핀)은 grep 범위 밖이다.
const ALLOW = new Set(["scripts/source-lines.ts"]);

test("출처 머리 글자는 상수 모듈 밖의 docs·scripts 에 없다 (#588 완료 조건 1)", () => {
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

// #588 단계 C(cpo·legal·cmo 판정): 글자를 그대로 고정한다 - 고치려면 판정이 먼저다.
test("가공 꼬리 글자와 장별 출처 줄 (#588 단계 C)", () => {
  assert.deepEqual({ ...DERIVED }, { ko: "이 값은 원자료를 가공한 것입니다.", en: "These figures are derived from the original data." });
  const lag = {
    budget: { ko: "신고된 거래만 집계되며 신고 기한(계약 후 30일)이 있어 최근 거래는 나중에 반영됩니다.", en: "Only reported deals are counted, and reporting can lag up to 30 days after contract." },
    jeonseVsWolse: { ko: "신고된 거래만 집계되며 신고 기한(계약 후 30일)이 있어 최근 계약은 나중에 반영됩니다.", en: "Only filed contracts are counted, and the 30-day filing window means recent contracts arrive later." },
  };
  for (const id of ["budget", "jeonseVsWolse"]) {
    for (const lang of ["ko", "en"]) {
      const line = FOOTERS[id][lang];
      assert.ok(line.endsWith(`. ${DERIVED[lang]} ${lag[id][lang]}`), `${id}.${lang}: 가공 꼬리가 신고 기한 꼬리 앞`);
      assert.ok(line.includes(SOURCES.ecos[lang]), `${id}.${lang}: ECOS`);
    }
  }
  assert.equal(
    FOOTERS.switchHouse.ko,
    "출처: 국토교통부 아파트 매매 실거래가 공개시스템(중개거래, 해제 제외), 한국부동산원 실거래가격지수·주택가격동향조사(R-ONE), 한국은행 경제통계시스템(ECOS). 이 값은 원자료를 가공한 것입니다."
  );
  assert.equal(
    FOOTERS.switchHouse.en,
    "Source: MOLIT apartment sale filings (brokered, cancelled excluded); Korea Real Estate Board transaction index and price survey (R-ONE); Bank of Korea ECOS. These figures are derived from the original data."
  );
  // price-outlook 은 같은 상수를 쓰고 출력은 그대로다.
  assert.ok(FOOTERS.priceOutlook.ko.includes(`${DERIVED.ko} 투자 판단을 대신하지 않습니다.`));
  assert.ok(FOOTERS.priceOutlook.en.endsWith(`${DERIVED.en} Not investment advice.`));
});

// ECOS 값을 화면에 싣는 장 종류(출처 줄 id). 새 ECOS 장이 생기면 여기에 더한다 - ECOS 약관 제7조②.
const ECOS_IDS = ["about", "method", "index", "stocks", "budget", "jeonseVsWolse", "switchHouse", "priceOutlook", "renewalConvert"];
// ECOS 값으로 계산해 보이는 장 종류 - 가공 꼬리가 있어야 한다. 값을 받은 그대로 보이는 장(index·stocks)과 설명 장(about·method)은 아니다.
const DERIVED_IDS = ["budget", "jeonseVsWolse", "switchHouse", "priceOutlook", "renewalConvert"];

test("ECOS 값을 싣는 장 종류는 출처 줄에 ECOS 를, 계산해 보이는 장은 가공 꼬리를 ko·en 모두 가진다 (#588 단계 C)", () => {
  for (const id of ECOS_IDS) {
    assert.ok(FOOTERS[id], id);
    assert.match(FOOTERS[id].ko, /ECOS/, `${id}.ko`);
    assert.match(FOOTERS[id].en, /ECOS/, `${id}.en`);
  }
  for (const id of Object.keys(FOOTERS)) {
    for (const lang of ["ko", "en"]) {
      assert.equal(FOOTERS[id][lang].includes(DERIVED[lang]), DERIVED_IDS.includes(id), `${id}.${lang}: 가공 꼬리`);
    }
    // ko·en 짝: 같은 장은 ECOS·R-ONE 표시도 양쪽이 같다.
    for (const word of [/ECOS/, /R-ONE/]) assert.equal(word.test(FOOTERS[id].ko), word.test(FOOTERS[id].en), `${id}: ${word} ko·en 짝`);
  }
  assert.match(FOOTERS.switchHouse.ko, /주택가격동향조사\(R-ONE\)/);
  assert.match(FOOTERS.switchHouse.en, /price survey \(R-ONE\)/);
});

test("Release 출처 문장은 legal 표 원문 상수(ATTRIBUTION.molitSale)와 글자까지 같다", async () => {
  const body = renderBody(buildFigures(await readSales(path.join(root, "test/fixtures/correction-twins/raw"))));
  const [ko, en] = body.split("\n---\n");
  assert.ok(ko.includes(ATTRIBUTION.molitSale.ko("수집 시각 2026-10-10")));
  assert.ok(en.includes(ATTRIBUTION.molitSale.en("collected 2026-10-10")));
  assert.equal(SOURCES.molitSale.dataset, "15126469");
});

test("Release 본문 산출 코드는 출처·기관·데이터셋 번호를 글자로 적지 않고 상수를 import 한다 (#588 PR2)", async () => {
  const src = await read("scripts/build-correction-release.ts");
  assert.match(src, /import \{ ATTRIBUTION, SOURCES \} from "\.\/source-lines\.ts"/);
  assert.doesNotMatch(src, /15126469|15126474|국토교통부|Ministry of Land|공공데이터포털|data\.go\.kr/);
  const body = renderBody(buildFigures(await readSales(path.join(root, "test/fixtures/correction-twins/raw"))));
  const [ko, en] = body.split("\n---\n");
  assert.ok(ko.includes(`(${SOURCES.molit.ko})이 기록을`));
  assert.ok(en.includes(`(${SOURCES.molit.en}) amends`));
});

const KB = /kb_sale|kb_jeonse|901Y06[23]|KB국민|KB Kookmin|raw\/indicators|series\.json/i;

test("Release 는 KB 계열(901Y062·901Y063, kb_sale·kb_jeonse)을 싣지 않는다 - 소스·워크플로가 raw/sale 만 읽는다 (legal #588)", async () => {
  const src = await read("scripts/build-correction-release.ts");
  assert.doesNotMatch(src, KB);
  const figures = buildFigures(await readSales(path.join(root, "test/fixtures/correction-twins/raw")));
  assert.deepEqual(figures.source, { datasetId: SOURCES.molitSale.dataset });
  const wf = await read(".github/workflows/correction-release.yml");
  assert.doesNotMatch(wf, KB);
});

test("Release 자산: 실제로 산출한 폴더의 모든 파일에 KB 계열 이름·값이 없고, 워크플로가 올리는 파일은 전부 그 산출물이다 (legal #588)", { skip: !hasPython && "python3 없음" }, async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "ct-kb-"));
  try {
    const { tag } = await buildRelease({ rawDir: path.join(root, "test/fixtures/correction-twins/raw"), outDir });
    const produced = (await readdir(outDir)).sort();
    for (const name of produced) {
      assert.doesNotMatch(name, KB, name);
      assert.doesNotMatch(await readFile(path.join(outDir, name), "utf8"), KB, name);
    }
    const lines = (await read(".github/workflows/correction-release.yml")).split("\n");
    const at = lines.findIndex((l) => l.includes("gh release create"));
    // 첫 줄은 --title·--notes-file, 다음 줄(\ 이어짐)이 자산 목록이다.
    const uploaded = [...lines[at + 1].matchAll(/"\$out\/([^"]+)"/g)].map((m) => m[1].replaceAll("$tag", tag)).sort();
    for (const name of uploaded) assert.ok(produced.includes(name), `워크플로가 산출물이 아닌 파일을 올린다: ${name}`);
    assert.deepEqual(uploaded, [`${tag}.csv`, `${tag}.json`, "README.md", "check.out", "check.py"].sort());
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
