// 나가는 사이트(build/site)의 Tailwind class 금지 점검 (#511 B5, 부모 #505).
//
// test/css-build.test.mjs 의 금지 넷은 훑는 **소스**(main.css 의 @source: 틀 14장·docs/*.js·scripts)의 토큰만 본다. 컷오버(#510) 전에는 생성 HTML 53장이
// docs/*.html 로 그 목록에 들어 있어 출력의 class 도 같이 보였지만, 이제 생성 장은 build/site 에만 있다. 생성 장의 class 는 틀·스크립트에서 나오므로 보통 같은 토큰이지만,
// 데이터나 조건에서 조립돼 소스에 글자로 없던 class 가 출력에만 나타나면 소스 쪽 점검은 못 본다 - 여기서 나가는 장을 직접 훑는다.
//   - 금지 넷(dark 변형·임의값·조립한 이름·초점 표시 지우기)에 걸리는 토큰이 출력에 0개.
//   - 출력에 쓰인 `tw:` 토큰마다 배포되는 style.css 에 규칙이 있다(규칙 없는 class 는 조용히 아무 효과가 없다).
// build/site 를 읽으므로 test/helpers/site-root.mjs 를 import 한다 - 이 파일은 배포 게이트(`npm run test:site`)에도 든다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { SITE } from "./helpers/site-root.mjs";
import { builtUtilityTokens, isLiteralToken, removesOutline, twTokens, usesArbitrary, usesDarkVariant } from "./helpers/css-source.mjs";

const root = path.resolve(import.meta.dirname, "..");

// build/site 아래 모든 *.html (하위 폴더 포함), 저장소 루트 기준 상대 경로.
async function htmlFiles(dir) {
  const out = [];
  for (const e of (await readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await htmlFiles(rel)));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

// 나가는 장 전체의 토큰: [{ file, token }]. 파일마다 중복은 한 번만.
async function outputTokens() {
  const files = await htmlFiles(SITE);
  const out = [];
  for (const file of files) for (const token of new Set(twTokens(await readFile(path.join(root, file), "utf8")))) out.push({ file, token });
  return { files, tokens: out };
}

const BANS = [
  ["`tw:dark:` 변형", usesDarkVariant],
  ["임의값 `tw:…[…]`", usesArbitrary],
  ["조립한(완전한 리터럴이 아닌) class", (t) => !isLiteralToken(t)],
  ["`tw:outline-none` 계열(초점 표시 지우기)", removesOutline],
];

test("나가는 장(build/site)의 Tailwind class 에 금지 넷이 하나도 없다 (#511)", async () => {
  const { files, tokens } = await outputTokens();
  // 하한: 나가는 장은 67장(틀 14 + 생성 53)이다. 훑기가 헛돌지 않는다는 것만 지킨다.
  assert.ok(files.length > 60, `나가는 장을 ${files.length}장밖에 못 찾았다`);
  for (const [name, bad] of BANS) {
    const hits = tokens.filter(({ token }) => bad(token)).map(({ file, token }) => `${file}: ${token}`);
    assert.deepEqual(hits, [], `${name} 이 나가는 장에 있다`);
  }
});

test("나가는 장에 쓰인 `tw:` class 마다 배포되는 style.css 에 규칙이 있다 (#511)", async () => {
  const { tokens } = await outputTokens();
  const css = await readFile(path.join(root, SITE, "style.css"), "utf8");
  const built = new Set(builtUtilityTokens(css));
  const missing = tokens.filter(({ token }) => isLiteralToken(token) && !built.has(token)).map(({ file, token }) => `${file}: ${token}`);
  assert.deepEqual(missing, [], "출력에 쓰였는데 style.css 에 규칙이 없는 class - 소스에 글자로 없는 class 이거나 node scripts/build-css.mjs 를 돌리지 않았다");
});
