import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

// 상대 리터럴 specifier 존재 전수 (#425 완료 조건 10, #316 완료 조건 10의 원리: 사람이 알아채야 하는 조건을 시험이 알아채게).
// `tsc`는 .mjs 가 import 하는 줄의 specifier 를 못 본다(allowJs 끔) - .mjs 진입점이 개명된 .ts 를 가리키는 줄의 오탈자는
// PR CI 가 못 잡고 다음 무인 실행에서야 터진다. 그래서 scripts/·test/·tools/ 의 모든 .mjs·.ts·.jsx 에서 상대 리터럴 specifier
// (정적 import/export-from + import("…") 리터럴)를 읽어 가리키는 파일이 실제 있는지 본다.
// 읽는 법: esbuild(루트 의존 그대로, 새 의존 0)로 변환만 하고(번들 안 함) metafile 에 남는 import 기록을 쓴다 - 주석·문자열·
// 템플릿 안에 적힌 `from "./x"` 는 코드가 아니라 기록에 안 남으므로 오탐하지 않는다. 변환 결과는 쓰지 않는다(write: false).
// 범위 밖: research/(옛 분석 코드에 이미 없는 파일을 가리키는 곳이 있어 켜면 처음부터 빨갛다), import type(변환에서 지워진다 - tsc 가 본다),
// 문자열로 조립한 경로(readFile 대상 등 - 그건 각 시험이 자기 파일을 읽는 것으로 지킨다).
const root = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["scripts", "test", "tools"];
const LOADER = { ".mjs": "js", ".ts": "ts", ".jsx": "jsx" };

// 허용 목록(요구사항 f): 일부러 깨 둔 fixture. 이유를 적고, 시험이 「정말 읽히지 않는 파일인지」도 확인한다(허용 목록이 정상 파일을 가리지 않게).
const UNPARSEABLE_FIXTURES = new Map([
  ["test/fixtures/render/broken.jsx", "render-loader.test.mjs 가 문법 오류 입력의 거절을 보려고 일부러 깨 둔 파일(export const = ;)"],
]);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (LOADER[path.extname(e.name)]) yield p;
  }
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// 파일 하나의 상대 specifier 목록. 읽을 수 없는(문법 오류) 파일이면 null.
async function relativeSpecifiers(file) {
  let result;
  try {
    result = await build({
      stdin: { contents: readFileSync(file, "utf8"), sourcefile: file, loader: LOADER[path.extname(file)] },
      // verbatimModuleSyntax: 쓰이지 않는 값 import 도 기록에 남긴다(.ts 변환이 지우지 않게). import type 은 여전히 지워진다.
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      bundle: false,
      write: false,
      metafile: true,
      logLevel: "silent",
      outdir: path.join(tmpdir(), "relative-import-exists-unused"),
    });
  } catch {
    return null;
  }
  const output = Object.values(result.metafile.outputs)[0];
  return output.imports.map((i) => i.path).filter((p) => p.startsWith("."));
}

// 훑는다: { files, sites, missing: ["상대경로: specifier"], unparseable: ["상대경로"] }
async function scan(baseDir, dirs = SCAN_DIRS) {
  const out = { files: 0, sites: 0, missing: [], unparseable: [] };
  for (const top of dirs) {
    const dir = path.join(baseDir, top);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const file of walk(dir)) {
      out.files++;
      const rel = path.relative(baseDir, file).split(path.sep).join("/");
      const specs = await relativeSpecifiers(file);
      if (specs === null) {
        out.unparseable.push(rel);
        continue;
      }
      for (const spec of specs) {
        out.sites++;
        if (!isFile(path.resolve(path.dirname(file), spec))) out.missing.push(`${rel}: ${spec}`);
      }
    }
  }
  return out;
}

// 시험은 하나다(루트 test/COUNT 한 칸): 앞쪽 반은 대조군(이 훑개가 잡는다 · 오탐하지 않는다), 뒤쪽 반은 저장소 전수다.
test("scripts/·test/·tools/ 의 모든 상대 리터럴 import 가 가리키는 파일이 있다 (대조군 포함, 개명이 소리 없이 남기는 깨짐을 막는다)", async (t) => {
  // 대조군 1: 없는 파일을 가리키는 specifier(정적·동적)는 잡고, 주석·문자열·템플릿 안의 같은 글자는 센 적이 없다.
  const tmp = mkdtempSync(path.join(tmpdir(), "relative-import-exists-"));
  try {
    mkdirSync(path.join(tmp, "scripts"));
    mkdirSync(path.join(tmp, "test"));
    writeFileSync(path.join(tmp, "scripts", "there.ts"), "export const x = 1;\n");
    writeFileSync(path.join(tmp, "scripts", "ok.mjs"), 'import { x } from "./there.ts";\nexport const y = x;\n');
    // 옛 이름(.mjs)으로 되돌린 진입점의 모양: 있는 이름은 .ts 뿐이다.
    writeFileSync(path.join(tmp, "scripts", "entry.mjs"), 'import { x } from "./there.mjs";\nexport const z = await import("./also-missing.ts");\n');
    writeFileSync(
      path.join(tmp, "test", "noise.test.mjs"),
      '// import { a } from "./comment-only.mjs";\nconst code = \'import { b } from "./string-only.mjs";\';\nconst tpl = `await import("./template-only.mjs")`;\nexport { code, tpl };\n',
    );
    // import type 은 변환에서 지워진다(범위 밖, tsc 가 본다) - 값 import 만 대상이라는 경계를 못박는다.
    writeFileSync(path.join(tmp, "test", "typed.ts"), 'import type { T } from "../scripts/type-only-missing.ts";\nexport type U = T;\n');
    const control = await scan(tmp);
    assert.deepEqual(control.missing.sort(), ["scripts/entry.mjs: ./also-missing.ts", "scripts/entry.mjs: ./there.mjs"], "대조군: 없는 파일 둘(정적·동적)만 잡혀야 한다");
    assert.equal(control.sites, 3, "대조군: 센 곳은 ok.mjs 1 + entry.mjs 2 뿐이다(주석·문자열·템플릿 안과 import type 은 0)");
    assert.deepEqual(control.unparseable, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 허용 목록의 fixture 는 실제로 있고 정말 못 읽는 파일이어야 한다(허용 목록이 정상 파일을 가리지 않게).
  for (const [rel, why] of UNPARSEABLE_FIXTURES) {
    assert.ok(why.length > 10, `${rel}: 이유를 적는다`);
    assert.ok(isFile(path.join(root, rel)), `${rel} 이 없다 - 허용 목록에서 뺀다`);
    assert.equal(await relativeSpecifiers(path.join(root, rel)), null, `${rel} 은 이제 읽힌다 - 허용 목록에서 뺀다`);
  }

  // 저장소 전수.
  const r = await scan(root);
  t.diagnostic(`${r.files}파일 · 상대 specifier ${r.sites}곳 · 없는 파일 ${r.missing.length}`);
  assert.deepEqual(r.missing, [], "가리키는 파일이 없는 상대 import - 개명 때 specifier 를 못 따라 고쳤거나 오탈자다(다음 무인 실행에서 터진다)");
  // 읽히지 않는 파일은 허용 목록의 fixture 뿐이어야 한다.
  assert.deepEqual(r.unparseable.sort(), [...UNPARSEABLE_FIXTURES.keys()].sort(), "문법 오류로 못 읽는 파일이 허용 목록과 다르다 - 새로 깨진 파일이면 고치고, 일부러 깬 fixture 면 이유를 적어 UNPARSEABLE_FIXTURES 에 둔다");
  // 아무것도 안 훑고 통과하는 길을 막는다(경로 계산이 틀어져 0곳을 훑어도 「없는 것 0」이 되므로). 값은 오늘의 631곳/327파일보다 훨씬 낮은 하한이다.
  assert.ok(r.files >= 300 && r.sites >= 500, `훑은 양이 이상하게 적다(${r.files}파일 · ${r.sites}곳) - 훑는 범위가 틀어졌다`);
});
