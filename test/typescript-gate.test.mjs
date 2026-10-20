import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// clo 게이트 시험(#316 완료 조건 10, #421 완료 조건 8). TS 마이그레이션은 「파일을 만들지 않는다」는 전제 위에 선다 —
// 타입 검사(`tsc`)는 검사만 하고(noEmit), 실행은 Node 24 타입 스트리핑이 한다. 그래서 esbuild 선컴파일도, 산출물(.js·.d.ts)도 없다.
// 이 전제가 깨지면(tsconfig 가 파일을 내거나, 루트 `test`·`update` 가 esbuild 를 부르면) 라이선스·산출물 판단을 다시 해야 하므로 clo 게이트가 켜진다.
// tsconfig.json 은 주석 없는 순수 JSON 이다 - 루트에는 typescript 의존이 없어 이 시험이 JSON.parse 로 읽는다(주석이 끼면 여기서 터진다).
const root = path.resolve(import.meta.dirname, "..");

// 위반 목록. tsconfig: 읽은 tsconfig.json 객체, pkg: 루트 package.json 객체.
function gateViolations(tsconfig, pkg) {
  const out = [];
  const o = tsconfig.compilerOptions ?? {};
  if (o.noEmit !== true) out.push("noEmit 이 true 가 아니다");
  for (const k of ["outDir", "emitDeclarationOnly", "declaration"]) if (k in o) out.push(`${k} 가 있다`);
  for (const name of ["test", "update"]) {
    const line = pkg.scripts?.[name];
    if (typeof line !== "string") out.push(`루트 package.json 에 ${name} 줄이 없다`);
    else if (/esbuild/i.test(line)) out.push(`루트 ${name} 줄에 esbuild 가 있다`);
  }
  return out;
}

test("clo 게이트(#316): tsconfig.json 은 noEmit 이고 outDir·emitDeclarationOnly·declaration 이 없으며, 루트 test·update 줄에 esbuild 가 없다", () => {
  const tsconfig = JSON.parse(readFileSync(path.join(root, "tools", "typescript", "tsconfig.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(gateViolations(tsconfig, pkg), [], "clo 게이트가 켜진다 - 산출물이 생기는 길이 열렸다");

  // 대조군: 게이트가 실제로 무는지(항상 참인 단언이 아닌지). 이 시험이 넘기는 저장소 파일은 위 하나뿐이다.
  const ok = { compilerOptions: { noEmit: true } };
  const scripts = { test: "node scripts/run-tests.mjs", update: "node scripts/update-all.mjs" };
  assert.deepEqual(gateViolations(ok, { scripts }), []);
  assert.deepEqual(gateViolations({ compilerOptions: { noEmit: false } }, { scripts }), ["noEmit 이 true 가 아니다"]);
  assert.deepEqual(gateViolations({ compilerOptions: {} }, { scripts }), ["noEmit 이 true 가 아니다"]);
  for (const k of ["outDir", "emitDeclarationOnly", "declaration"]) {
    assert.deepEqual(gateViolations({ compilerOptions: { noEmit: true, [k]: k === "outDir" ? "dist" : false } }, { scripts }), [`${k} 가 있다`], k);
  }
  assert.deepEqual(gateViolations(ok, { scripts: { ...scripts, test: "esbuild a.ts && node scripts/run-tests.mjs" } }), ["루트 test 줄에 esbuild 가 있다"]);
  assert.deepEqual(gateViolations(ok, { scripts: { ...scripts, update: "node scripts/update-all.mjs && esbuild x" } }), ["루트 update 줄에 esbuild 가 있다"]);
  assert.deepEqual(gateViolations(ok, { scripts: { test: scripts.test } }), ["루트 package.json 에 update 줄이 없다"]);
});
