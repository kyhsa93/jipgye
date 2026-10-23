import test from "node:test";
import assert from "node:assert/strict";
import { globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

// 시험 파일 집합 일치 단언 (#320, #315 후속). 이 파일 자신이 `test/` 바로 아래 `*.test.mjs` 다 - `npm test` 의 글롭
// (`test/*.test.{mjs,ts}`)이 집는 자리다. 자기가 안 돌면 이 단언은 의미가 없다(마지막 시험이 그걸 본다).
//
// 왜: `npm test` 의 글롭은 `**` 가 없어 폴더 바로 아래 한 단만 본다(`**` 로 넓히면 자체 탐색이 tools/golden/test·research/ 를 집어
// #309 의 분리를 깬다 - #318 에서 cto 가 판정). 그래서 시험이 조용히 안 도는 길이 둘 남는다.
//   1. 자리가 틀림 - test/sub/x.test.mjs (글롭 밖)
//   2. 이름이 틀림 - test/x.spec.mjs · test/x-test.mjs (바로 아래인데 글롭에 안 걸림)
// 둘 다 시험을 더하는 변경이라 개수가 줄지 않고, #315 의 래칫(하한)은 통과한다. 그래서 래칫과 별개로 집합을 단언한다.
//
// 무엇을: 「`node:test` 를 import 하는 파일의 집합」 == 「글롭이 집는 파일의 집합」. 기준이 import 인 이유는 확장자·이름 규약이
// 러너가 보는 것이 아니라 글롭이 보는 것이라, 그걸 기준 삼으면 재려는 대상으로 재는 꼴이 되기 때문이다.
// 어긋나면 양쪽 차집합을 둘 다 찍는다 - 안 돌고 있는 파일(import 에는 있고 글롭에 없다)과 글롭에 걸리는데 시험이 아닌 파일.
//
// 검출 방법(#320 본문: engineer 가 고르고 근거를 PR 에 적는다): 정규식이 아니라 esbuild 가 파싱해 metafile 에 남기는 import 기록이다.
// #118 의 전례 - 정규식은 주석·문자열 안의 `import … from "node:test"` 를 세고, 반대로 줄바꿈된 import 를 놓친다. esbuild 는
// 이미 루트 의존이고 test/relative-import-exists.test.mjs 가 같은 방식으로 쓴다(새 의존 0). 읽을 수 없는(문법 오류) 파일은
// import 0 으로 본다 - 일부러 깨 둔 test/fixtures/render/broken.jsx 가 있다. 깨진 시험 파일은 어차피 못 도는 파일이다.
// 비용: 시험을 헬퍼에 감싸 재수출하고 시험 파일은 헬퍼만 import 하는 구조는 시험 파일 쪽이 import 집합에서 빠져 걸린다
// (지금 test/helpers 에 그런 것 0건). 그 구조를 쓰려면 이 단언을 먼저 고친다 - 시험 파일이 러너와 같은 근거로 보이는 상태를 지키는 제약이다.
//
// 범위: `npm test` 가 scripts/run-tests.mjs 를 거치는 네 패키지(루트·tools/golden·tools/render·tools/health(#507)). research/ 는 CI 밖이라 뺀다.
const root = path.resolve(import.meta.dirname, "..");
const PACKAGES = [".", "tools/golden", "tools/render", "tools/health"];

// 글롭은 래퍼 소스의 `const GLOB = "…"` 한 곳에서 읽는다 - 여기에 다시 적으면 한쪽만 고쳐진다.
function runnerGlob() {
  const src = readFileSync(path.join(root, "scripts", "run-tests.mjs"), "utf8");
  const m = src.match(/^const GLOB = "([^"]+)";$/m);
  assert.ok(m, "scripts/run-tests.mjs 에서 `const GLOB = \"…\";` 줄을 못 찾았다 - 글롭을 읽는 이 단언을 같이 고친다");
  return m[1];
}

const LOADER = { ".mjs": "js", ".cjs": "js", ".js": "js", ".jsx": "jsx", ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx" };

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (LOADER[path.extname(e.name)]) yield p;
  }
}

// 파일이 `node:test` 를 import(정적·동적 리터럴·require)하는가. 문법 오류면 false.
async function importsNodeTest(file) {
  let result;
  try {
    result = await build({
      stdin: { contents: readFileSync(file, "utf8"), sourcefile: file, loader: LOADER[path.extname(file)] },
      // verbatimModuleSyntax: 쓰이지 않는 값 import 도 기록에 남긴다(.ts 변환이 지우지 않게).
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      // 번들은 안 쓴다(external "*" 라 아무 파일도 안 읽는다). bundle: false 는 require("node:test") 호출을 기록에 안 남긴다.
      // format esm: 기본 iife 는 최상위 await 가 있는 시험 파일을 오류로 거절한다(실측: budget-pages·load-failure·golden mutation).
      bundle: true,
      external: ["*"],
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
      outdir: path.join(tmpdir(), "test-set-unused"),
    });
  } catch {
    return false;
  }
  return Object.values(result.metafile.outputs)[0].imports.some((i) => i.path === "node:test");
}

// pkgDir/test 아래(하위폴더 포함)의 두 집합 차. 경로는 pkgDir 기준 `/` 구분.
async function testSetDiff(pkgDir, glob) {
  const rel = (p) => path.relative(pkgDir, p).split(path.sep).join("/");
  const picked = new Set(globSync(glob, { cwd: pkgDir }).map((p) => p.split(path.sep).join("/")));
  const importing = new Set();
  const testDir = path.join(pkgDir, "test");
  for (const file of walk(testDir)) if (await importsNodeTest(file)) importing.add(rel(file));
  return {
    notRun: [...importing].filter((f) => !picked.has(f)).sort(),
    notTests: [...picked].filter((f) => !importing.has(f)).sort(),
  };
}

function describeDiff(label, glob, { notRun, notTests }) {
  const lines = [];
  if (notRun.length) lines.push(`  안 돌고 있다(node:test 를 import 하는데 글롭 ${glob} 에 안 걸린다):`, ...notRun.map((f) => `    ${f}`));
  if (notTests.length) lines.push(`  글롭에는 걸리는데 node:test 를 import 하지 않는다(시험이 아니다):`, ...notTests.map((f) => `    ${f}`));
  if (!lines.length) return "";
  return [
    `${label}: 시험 파일 집합이 글롭과 어긋났다.`,
    ...lines,
    `  시험 파일은 패키지의 test/ 바로 아래 *.test.{mjs,ts} 로 둔다 - 글롭이 \`${glob}\` 라 하위 폴더나 다른 이름은 조용히 안 돈다.`,
    `  나누고 싶으면 이 단언이 아니라 글롭을 먼저 고친다(\`**\` 는 #309 의 분리를 깨므로 cto 판정, #320).`,
  ].join("\n");
}

// 가짜 패키지: files = { "test/ok.test.mjs": 내용 }. 기본으로 import 하는 시험 하나를 둔다.
const IMPORTS = 'import test from "node:test";\ntest("x", () => {});\n';
function fixturePackage(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "jipgye-test-set-"));
  for (const [name, body] of Object.entries({ "test/ok.test.mjs": IMPORTS, ...files })) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

async function diffOf(files) {
  const dir = fixturePackage(files);
  try {
    return await testSetDiff(dir, runnerGlob());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 저장소 전수 ----

test("글롭은 래퍼 한 곳에서 읽고, 모양이 이 단언이 가정한 `test/*.test.{mjs,ts}` 다", () => {
  // 글롭이 바뀌면(예: 확장자 추가) 아래 대조군의 기대가 같이 바뀌어야 하므로 모양이 바뀌면 여기서 알린다.
  assert.equal(runnerGlob(), "test/*.test.{mjs,ts}");
});

test("`npm test` 가 래퍼를 거치는 패키지는 전부 이 단언의 범위에 있다 - 새 패키지가 조용히 빠지지 않는다", () => {
  const found = [];
  for (const dir of [".", ...readdirSync(path.join(root, "tools"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `tools/${e.name}`)]) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (/run-tests\.mjs/.test(pkg.scripts?.test ?? "")) found.push(dir);
  }
  assert.deepEqual(found.sort(), [...PACKAGES].sort(), "run-tests.mjs 를 부르는 패키지가 이 파일의 PACKAGES 와 다르다 - 새 패키지면 PACKAGES 에 더한다");
});

for (const pkg of PACKAGES) {
  test(`${pkg === "." ? "루트" : pkg}: node:test 를 import 하는 파일의 집합 == 글롭이 집는 파일의 집합`, async () => {
    const glob = runnerGlob();
    const diff = await testSetDiff(path.join(root, pkg), glob);
    const label = path.posix.join(pkg, "test");
    assert.equal(describeDiff(label, glob, diff), "");
    // 비어 있는 집합끼리의 일치로 통과하지 않게(글롭이 깨져 둘 다 0이면 #315 래칫이 받지만 여기서도 하나는 본다).
    assert.ok(globSync(glob, { cwd: path.join(root, pkg) }).length > 0, `${label}: 글롭이 집는 파일이 0개다`);
  });
}

test("이 파일 자신이 글롭이 집는 자리에 있다 (범위 4)", () => {
  const picked = globSync(runnerGlob(), { cwd: root }).map((p) => p.split(path.sep).join("/"));
  assert.ok(picked.includes("test/test-set.test.mjs"), "test/test-set.test.mjs 가 글롭에 안 걸린다 - 이 단언이 안 돈다");
});

// ---- 대조군: 단언이 실제로 무는가 (#320 완료 조건 2·3·3-b·3-c) ----

test("대조군: 어긋남이 없는 패키지는 빈 차집합이고 메시지도 비어 있다", async () => {
  const d = await diffOf({ "test/helpers/h.mjs": "export const h = 1;\n", "test/fixtures/a/data.json": "{}" });
  assert.deepEqual(d, { notRun: [], notTests: [] });
  assert.equal(describeDiff("t", "g", d), "");
});

test("대조군 1(자리가 틀림): 하위 폴더의 .test.mjs·.test.ts 는 안 돈다고 찍힌다", async () => {
  const d = await diffOf({ "test/sub/x.test.mjs": IMPORTS, "test/sub/deep/y.test.ts": IMPORTS });
  assert.deepEqual(d, { notRun: ["test/sub/deep/y.test.ts", "test/sub/x.test.mjs"], notTests: [] });
});

test("대조군 2(이름이 틀림): 바로 아래의 x.spec.mjs·x-test.mjs·.test.cjs·.test.mts 도 찍히고, 옛 「하위 폴더에 .test.* 가 없다」 단언은 이걸 못 본다", async () => {
  const files = {
    "test/x.spec.mjs": IMPORTS,
    "test/x-test.mjs": IMPORTS,
    "test/c.test.cjs": 'const t = require("node:test");\nt("c", () => {});\n',
    "test/m.test.mts": IMPORTS,
  };
  const d = await diffOf(files);
  assert.deepEqual(d, { notRun: ["test/c.test.cjs", "test/m.test.mts", "test/x-test.mjs", "test/x.spec.mjs"], notTests: [] });
  // 옛 단언(하위 폴더 안의 `.test.*`)은 같은 상태에서 0건이라 통과한다 - 집합 일치로 바꾼 이유.
  const dir = fixturePackage(files);
  try {
    const sub = [...walk(path.join(dir, "test"))].filter((f) => path.dirname(f) !== path.join(dir, "test") && /\.test\./.test(path.basename(f)));
    assert.deepEqual(sub, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("대조군 3(반대 방향): 글롭에 걸리는데 import 가 없는 파일, 주석·문자열에만 node:test 가 있는 파일, 헬퍼만 import 하는 파일이 찍힌다", async () => {
  const d = await diffOf({
    "test/none.test.mjs": "export const x = 1;\n",
    "test/comment.test.mjs": '// import test from "node:test";\nconst s = \'import test from "node:test"\';\n',
    "test/wrapped.test.mjs": 'import test from "./helpers/t.mjs";\ntest("w", () => {});\n',
    "test/helpers/t.mjs": 'import test from "node:test";\nexport default test;\n',
  });
  // 헬퍼가 import 하는 구조는 양쪽에서 걸린다: 시험 파일(글롭 쪽)과 헬퍼(import 쪽). 본문 「비용」에 적은 제약이다.
  assert.deepEqual(d, {
    notRun: ["test/helpers/t.mjs"],
    notTests: ["test/comment.test.mjs", "test/none.test.mjs", "test/wrapped.test.mjs"],
  });
});

test("대조군 4: 문법 오류 파일은 import 0으로 읽어 던지지 않는다 (test/fixtures/render/broken.jsx 같은 일부러 깬 파일)", async () => {
  const d = await diffOf({ "test/fixtures/broken.jsx": "export const = ;\n", "test/fixtures/broken.mjs": "import test from \"node:test\"; const = ;\n" });
  assert.deepEqual(d, { notRun: [], notTests: [] });
});

test("실패 메시지는 양쪽 차집합과 길을 알려 준다 (범위 2)", async () => {
  const glob = runnerGlob();
  const d = await diffOf({ "test/sub/x.test.mjs": IMPORTS, "test/none.test.mjs": "export {};\n" });
  const msg = describeDiff("test", glob, d);
  assert.match(msg, /안 돌고 있다/);
  assert.match(msg, /test\/sub\/x\.test\.mjs/);
  assert.match(msg, /시험이 아니다/);
  assert.match(msg, /test\/none\.test\.mjs/);
  assert.match(msg, /test\/ 바로 아래 \*\.test\.\{mjs,ts\}/);
  assert.match(msg, /하위 폴더나 다른 이름은 조용히 안 돈다/);
});
