import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 수집·빌더가 쓰는 곳은 docs/data 와 raw 뿐이다 (#510, 구조 B-4). 오프라인 시험 - 소스 글자만 읽는다(#8).
 *
 * 컷오버 뒤 수집 워크플로(daily-update·summarize)는 `docs/data`·`raw` 만 커밋한다(push-docs.sh 의 DATA_PATHS). 그런데 수집·빌더 스크립트가 그 밖의 곳(예: docs/*.html, 틀·정적 자산,
 * 또는 읽기 전용이라고 믿은 곳)에 쓰면 그 변경은 **커밋에 안 실리고 조용히 버려진다** - 수집은 초록인데 결과가 사라지는 모양이다. 또 collector 가 생성 HTML 을 읽는 입력으로 삼으면
 * 컷오버 뒤 docs/ 에 그 장이 없어 조용히 틀린 값을 낸다(예: 검색 색인이 생성 장 목록을 docs/ 에서 읽는 식). 그래서 두 워크플로가 부르는 스크립트 전부(와 그것이 import 하는 scripts/ 안 모듈)가
 * 가리키는 저장소 경로 글자를 훑어, 허용된 곳(docs/data 아래, raw 아래, 커밋하지 않는 cache/)만 있음을 고정한다.
 *
 * 한계(정직하게): 소스 글자 검사라 경로를 런타임에 조립하는 쓰기(예: 환경변수로 받은 경로)는 못 본다 - 그런 시험 이음매(SEARCH_INDEX_FILE 등)는 기본값이 허용된 곳이고, 워크플로는 그 환경변수를
 * 안 준다. 실제로 쓴 파일이 데이터 경로 안인지는 push-docs.sh 가 커밋하는 범위가 마지막 방어선이다(test/push-docs.test.mjs).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

/** 주석을 걷는다(블록 주석과 줄 주석. `http://` 처럼 앞이 `:`·따옴표인 `//` 는 남긴다). */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** 워크플로가 `node scripts/<이름>` 으로 부르는 스크립트(주석 줄 제외, 중복 제거, 글자순). */
function calledScripts(...workflows) {
  const text = workflows.map((w) => w.replace(/^\s*#.*$/gm, "")).join("\n");
  return [...new Set([...text.matchAll(/node scripts\/([a-z0-9-]+\.(?:ts|mjs))/g)].map((m) => m[1]))].sort();
}

/** 이름들에서 시작해 `from "./x.ts"` 정적 import 를 따라 scripts/ 안 닫힘을 모은다: Map(이름 -> 주석 걷은 소스). */
async function closure(names, readScript) {
  const seen = new Map();
  const visit = async (name) => {
    if (seen.has(name)) return;
    const src = stripComments(await readScript(name));
    seen.set(name, src);
    for (const m of src.matchAll(/from "\.\/([a-z0-9-]+\.(?:ts|mjs))"/g)) await visit(m[1]);
  };
  for (const n of names) await visit(n);
  return seen;
}

/** 저장소 경로 글자의 위반 목록. 허용: docs/data·raw·cache 아래뿐. `docs` 그 자체나 docs/<data 아닌 것>(= 생성 HTML·틀·정적 자산)과 그 밖의 최상위 폴더는 위반이다. */
function pathViolations(sources) {
  const out = [];
  const judge = (file, where, top, second) => {
    if (top === "raw" || top === "cache") return;
    if (top === "docs" && second === "data") return;
    out.push(`${file}: ${where} - ${top}${second ? `/${second}` : ""} 는 수집이 쓸 곳이 아니다(허용: docs/data·raw·cache)`);
  };
  for (const [file, src] of sources) {
    // 1) 한 글자열에 담긴 경로: "../docs/data", "docs/data/x.json", `raw/${dir}`, "../cache/news-bodies.json"
    for (const m of src.matchAll(/(["'`])((?:\.\.\/|\.\/)*(?:docs|raw|cache|audit|research|ledger|build|tools|test|scripts|src)(?:\/[^"'`]*)?)\1/g)) {
      if (!m[2].includes("/")) continue; // 이름 하나뿐인 글자("docs")는 아래 3)이 문맥으로 본다
      const [top, second] = m[2].replace(/^(?:\.\.?\/)+/, "").split("/");
      judge(file, `경로 글자 ${JSON.stringify(m[2])}`, top, second);
    }
    // 3) 따로 적은 `"docs"` 는 바로 뒤가 `, "data"` 일 때만 허용한다(path.join(root, "docs", "data", …)).
    for (const m of src.matchAll(/"docs"(?!\s*,\s*"data")/g)) judge(file, `따로 적은 "docs" (뒤가 "data" 가 아니다)`, "docs", undefined);
    // 2) 루트 변수 뒤에 나눠 적은 경로: path.join(root, "docs", "data", …), path.join(root, "raw", …)
    for (const m of src.matchAll(/(?:root|repoRoot|REPO_ROOT|ROOT|rootDir)\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?/g)) {
      const parts = m[1].split("/");
      const [top, second] = parts.length > 1 ? parts : [parts[0], m[2]];
      judge(file, `루트 경로 ${JSON.stringify([m[1], m[2]].filter(Boolean))}`, top, second);
    }
  }
  return out;
}

const daily = await read(".github/workflows/daily-update.yml");
const summarize = await read(".github/workflows/summarize.yml");
const entry = calledScripts(daily, summarize);
const sources = await closure(entry, (n) => read(`scripts/${n}`));

test("수집·요약 워크플로가 부르는 스크립트와 그 import 닫힘이 충분히 잡힌다 (검사가 헛돌지 않는다)", () => {
  assert.ok(entry.length >= 25, `워크플로가 부르는 스크립트를 ${entry.length}개밖에 못 읽었다`);
  // fetch-rates.ts 는 #577 A(금감원 수집 중단)로 Daily 에서 빠졌다 - 이 목록에서도 뺀다.
  for (const must of ["fetch-news.ts", "fetch-realestate.ts", "build-realestate.ts", "build-search-index.ts", "news-context.ts", "summarize-news.ts", "translate-news.ts", "summary-needed.ts"]) {
    assert.ok(entry.includes(must), `${must} 가 워크플로 호출에서 빠졌다`);
  }
  assert.ok(sources.size >= 50, `import 닫힘이 ${sources.size}개뿐이다 - import 를 못 따라갔다`);
  // 실제로 경로 글자를 훑었다는 증거: docs/data·raw·cache 가 닫힘 안에 각각 있다.
  const all = [...sources.values()].join("\n");
  for (const need of [/docs\/data/, /\.\.\/raw|raw\//, /\.\.\/cache/]) assert.match(all, need);
});

test("수집·빌더 스크립트(와 import 닫힘)가 가리키는 저장소 경로는 docs/data·raw·cache 아래뿐이다 - docs/*.html·틀·정적 자산에 쓰지도 읽지도 않는다", () => {
  assert.deepEqual(pathViolations(sources), []);
});

test("대조군: 허용 밖 경로를 적은 합성 소스는 위반으로 잡히고, 허용된 경로는 거짓 위반을 안 낸다 (검사가 항상 참이 아니다)", () => {
  const bad = new Map([
    ["a.ts", 'const f = path.join(root, "docs", "index.html");'],
    ["b.ts", 'const f = path.resolve(import.meta.dirname, "../docs/district-gangnam.html");'],
    ["c.ts", 'const f = path.join(root, "docs/style.css");'],
    ["d.ts", "const f = `docs/budget-${n}eok.html`;"],
    ["e.ts", 'const d = path.resolve(import.meta.dirname, "../docs");'],
    ["f.ts", 'const d = path.join(root, "audit", "x.json");'],
    ["g.ts", 'const d = path.join(root, "build/site/index.html");'],
    ["h.ts", 'const d = path.join(root, "scripts", "rates-template.html");'],
  ]);
  const found = pathViolations(bad);
  for (const file of bad.keys()) assert.ok(found.some((v) => v.startsWith(`${file}:`)), `${file} 의 허용 밖 경로가 안 잡혔다: ${JSON.stringify(found)}`);
  const good = new Map([
    ["ok1.ts", 'const d = path.resolve(import.meta.dirname, "../docs/data");'],
    ["ok2.ts", 'const f = path.join(root, "docs/data/rates.json");'],
    ["ok3.ts", 'const f = path.join(root, "docs", "data", "x.json");'],
    ["ok4.ts", 'const d = path.join(root, "raw", "sale");'],
    ["ok5.ts", "const d = `raw/${dir}`;"],
    ["ok6.ts", 'const c = path.resolve(import.meta.dirname, "../cache/news-bodies.json");'],
    ["ok7.ts", 'const url = "https://example.com/docs/x"; // docs/index.html 은 주석'],
  ]);
  assert.deepEqual(pathViolations(new Map([...good].map(([k, v]) => [k, stripComments(v)]))), []);
});

test("커밋 범위와 맞물린다: 허용된 쓰기 경로 중 커밋되는 것은 docs/data·raw 이고, 나머지(cache)는 .gitignore 라 커밋되지 않는다", async () => {
  const sh = await read("scripts/push-docs.sh");
  assert.match(sh, /^DATA_PATHS=\(docs\/data raw\)$/m);
  const ignore = (await read(".gitignore")).split("\n").map((l) => l.trim());
  assert.ok(ignore.includes("cache/"), "cache/ 가 .gitignore 에 없다 - 뉴스 본문 캐시가 커밋될 수 있다");
  // 허용 목록과 커밋 목록의 어긋남: 허용은 {docs/data, raw, cache} 이고 커밋은 {docs/data, raw} 다. 이 시험이 그 차이가 cache 하나뿐임을 고정한다.
  const allowed = new Set(["docs/data", "raw", "cache"]);
  const committed = new Set(sh.match(/^DATA_PATHS=\((.*)\)$/m)[1].split(/\s+/));
  assert.deepEqual([...allowed].filter((p) => !committed.has(p)), ["cache"]);
});
