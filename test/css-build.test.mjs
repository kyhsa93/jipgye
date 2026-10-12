// 스타일시트 빌드 배선(#276)의 방어선. 인증키도 네트워크도 Tailwind 바이너리도 없이 돈다.
//
// docs/style.css는 이제 손으로 쓰는 파일이 아니라 src/css/main.css를 빌드한 산출물이다. 정규식으로 CSS를 읽는 기존 시험은
// 원문(src/css/legacy.css)을 읽는다. 그러면 "원문은 맞는데 산출물이 낡았다"가 시험 밖으로 빠지므로 여기서 잇는다:
//   - 원문의 규칙이 산출물에 전부, 같은 순서로 있다(아래 첫 시험). 바이트까지 같은지는 test.yml의 `build-css.mjs --check`가 본다.
//   - Tailwind class를 쓰는 방식의 금지 넷(dark 변형·임의값·조립한 이름·초점 표시 지우기).
//   - 바이너리 고정(버전·해시 표·검증 순서).
//
// 이 시험들이 **못 보는 것**: 유틸리티 class로 다시 그린 요소의 크기·대비·글자 크기. 기존 접근성 시험은 legacy.css의 규칙만 읽으므로
// class로 그린 요소는 그 밖이다. 지금은 HTML에 그런 class가 하나도 없어 빈틈이 없고(아래 신선도 시험이 0개임을 센다),
// 렌더 결과로 재는 검사는 #278 PR A가 만든다(#274 체인 공통 규칙 1·2).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INPUT, OUTPUT, TAILWIND_ASSETS, TAILWIND_VERSION, assetFor, cacheDir, checkFresh, ensureBinary, platformKey } from "../scripts/build-css.mjs";
import { builtUtilityTokens, flattenCss, isLiteralToken, removesOutline, ruleLine, sourceGlobs, stripComments, tokenSelector, twTokens, usesArbitrary, usesDarkVariant } from "./helpers/css-source.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const LEGACY = "src/css/legacy.css";

// 산출물의 components 층 안 규칙만, 층 머리를 벗겨서.
const inComponents = (flat) => flat.rules.filter((r) => r.at[0] === "@layer components").map((r) => ({ ...r, at: r.at.slice(1) }));

// main.css의 @source 목록을 실제 파일로 편다. 모양은 "폴더/*.확장자"와 파일 하나뿐이다(다른 모양이 생기면 여기서 던진다).
async function scannedFiles() {
  const cssDir = path.dirname(path.join(root, INPUT));
  const files = [];
  for (const glob of sourceGlobs(await read(INPUT))) {
    const abs = path.resolve(cssDir, glob);
    const star = /^\*(\.[a-z]+)$/.exec(path.basename(abs));
    if (star) {
      for (const f of (await readdir(path.dirname(abs))).sort()) if (f.endsWith(star[1])) files.push(path.join(path.dirname(abs), f));
    } else {
      assert.ok(!abs.includes("*"), `@source "${glob}": 이 시험이 펼 줄 모르는 모양이다`);
      await stat(abs);
      files.push(abs);
    }
  }
  return files;
}

// 훑는 소스 전체의 토큰: [{ file, token }]. 파일마다 중복은 한 번만.
async function scannedTokens() {
  const out = [];
  for (const file of await scannedFiles()) for (const token of twTokens(await readFile(file, "utf8"))) out.push({ file: path.relative(root, file), token });
  return out;
}

test("CSS 원문 파서: 주석·문자열·괄호 안의 구분자에 속지 않고 중첩을 편다", () => {
  const flat = flattenCss(`/* a { x: 1 } */
@layer one, two;
a,
b { color: red; background: url("data:x;y{z}") ; margin : 0 ! important }
@media (min-width: 1px) { .c::before { content: " } /* "; } .d{ } }
@layer two { @media print { e { f: g } } }
.n { top: 0; &:hover { top: 1px } }`);
  assert.deepEqual(flat.statements, ["@layer one, two"]);
  assert.deepEqual(flat.rules.map(ruleLine), [
    'a, b { color: red; background: url("data:x;y{z}"); margin: 0 !important }',
    '@media (min-width: 1px) > .c::before { content: " } /* " }',
    "@media (min-width: 1px) > .d {  }",
    "@layer two > @media print > e { f: g }",
    ".n { top: 0 }",
    ".n > &:hover { top: 1px }",
  ]);
  assert.equal(stripComments('a{b:"/* 주석 아님 */"}/* 주석 */'), 'a{b:"/* 주석 아님 */"}');
});

test("빌드 결과에 legacy 규칙이 전부, 같은 순서로 있다 (#276 완료 조건 5)", async () => {
  const legacy = flattenCss(await read(LEGACY));
  const builtText = await read(OUTPUT);
  const built = inComponents(flattenCss(builtText));
  // 컷오버를 revert해 legacy 조각이 돌아와도 읽히게 그려지려면(#246 롤백 경로) 옛 class의 규칙이 산출물에 남아 있어야 한다.
  assert.ok(legacy.rules.length > 400, `legacy.css에서 규칙을 ${legacy.rules.length}개밖에 못 읽었다`);
  assert.deepEqual(legacy.statements, [], "legacy.css에 @import 같은 문장이 생겼다 - 층 안으로 들어가면 뜻이 달라진다");
  const want = legacy.rules.map(ruleLine);
  const got = built.map(ruleLine);
  const at = want.findIndex((line, i) => line !== got[i]);
  assert.equal(at, -1, `${at + 1}번째 규칙부터 다르다. node scripts/build-css.mjs를 돌렸는가\n  원문: ${want[at]}\n  산출: ${got[at]}`);
  assert.equal(got.length, want.length, "산출물의 components 층에 원문에 없는 규칙이 있다");

  // 이 비교가 실제로 잡는지: 산출물에서 규칙 하나를 지우거나, 값 하나를 바꾸거나, 두 규칙의 순서를 바꾼다.
  const mutants = {
    "규칙 삭제": builtText.replace(/\n {2}\[hidden\] \{[^}]*\}/, ""),
    "값 변경": builtText.replace("--tap: 44px;", "--tap: 40px;"),
    "순서 바꿈": builtText.replace(/(\n {2}\[hidden\] \{[^}]*\})(\n {2}[^{}]+\{[^{}]*\})/, "$2$1"),
  };
  for (const [name, text] of Object.entries(mutants)) {
    assert.notEqual(text, builtText, `변이 "${name}"가 걸리지 않았다(산출물 모양이 달라졌다)`);
    assert.notDeepEqual(inComponents(flattenCss(text)).map(ruleLine), want, `변이 "${name}"를 못 잡았다`);
  }
});

test("산출물 신선도(바이너리 없이 보는 쪽): 배너·층 선언이 맞고, 소스의 class와 산출물의 유틸리티 규칙이 서로 빠짐없다", async () => {
  const main = await read(INPUT);
  const builtText = await read(OUTPUT);
  const built = flattenCss(builtText);

  // 어느 버전이 만든 것인가. 표의 버전을 올리고 다시 빌드하지 않으면 여기서 걸린다.
  assert.ok(builtText.startsWith(`/*! tailwindcss v${TAILWIND_VERSION} | MIT License | https://tailwindcss.com */\n`), `${OUTPUT}의 첫 줄이 v${TAILWIND_VERSION} 배너가 아니다`);
  assert.ok(builtText.includes("빌드 산출물이다. 손으로 고치지 않는다"), "산출물 머리의 '손으로 고치지 않는다' 안내가 없다(main.css의 느낌표 주석)");

  // 진입 파일의 모양: 층 순서, 접두사, preflight 없음, 자동 훑기 끔, @source 넷.
  const flatMain = flattenCss(main);
  assert.equal(flatMain.statements[0], "@layer theme, base, components, utilities", "층 순서 선언이 맨 앞이 아니다");
  assert.ok(flatMain.statements.includes('@import "./legacy.css" layer(components)'), "legacy.css를 components 층으로 불러오지 않는다");
  const imports = flatMain.statements.filter((s) => s.startsWith("@import") && s.includes("tailwindcss"));
  assert.deepEqual(imports, ['@import "tailwindcss/theme.css" layer(theme) prefix(tw)', '@import "tailwindcss/utilities.css" layer(utilities) prefix(tw) source(none)'], "Tailwind는 theme과 utilities만, 접두사를 붙여, 자동 훑기를 끄고 불러온다(preflight를 켜면 제목·목록·버튼이 바뀐다)");
  assert.deepEqual(sourceGlobs(main), ["../../docs/*.html", "../../docs/*.js", "../../scripts/render/entry.jsx", "../../scripts/*.mjs"], "@source 목록이 바뀌었다 - #276 본문의 목록과 함께 고친다");
  assert.ok(built.statements.includes("@layer theme, base, components, utilities"), "산출물에 층 순서 선언이 없다");

  // 소스 → 산출물: 소스에 적힌 class마다 규칙이 있다(오타이거나, class를 넣고 다시 빌드하지 않았거나).
  const tokens = await scannedTokens();
  const body = stripComments(builtText);
  const missing = tokens.filter(({ token }) => isLiteralToken(token) && !new RegExp(`${tokenSelector(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_\\\\-])`).test(body));
  assert.deepEqual(missing, [], "소스에 있는데 산출물에 규칙이 없는 class - 없는 유틸리티이거나 node scripts/build-css.mjs를 돌리지 않았다");
  // 산출물 → 소스: 산출물의 유틸리티는 전부 소스에 적힌 것이다(class를 지우고 다시 빌드하지 않으면 남는다).
  const known = new Set(tokens.map((t) => t.token));
  const stale = builtUtilityTokens(builtText).filter((t) => !known.has(t));
  assert.deepEqual(stale, [], "산출물에 있는데 소스에 없는 class - node scripts/build-css.mjs를 돌리지 않았다");

  // 못 잡는 것을 적어 둔다: 유틸리티의 **내용**이 낡은 것(같은 class인데 Tailwind 버전이 달라 선언이 다르다)과 테마 변수는 여기서 안 보인다.
  // 그쪽은 test.yml의 `node scripts/build-css.mjs --check`(바이트 대조)가 본다.
});

test("Tailwind class 토큰 읽기: 금지 넷의 판정이 예시를 잡고 멀쩡한 것은 통과시킨다", () => {
  const text = 'a tw:flex b "tw:md:hover:p-4" `tw:w-1/2` <i class=tw:!m-0> tw:bg-(--card) notw:x x-tw:y';
  assert.deepEqual(twTokens(text), ["tw:flex", "tw:md:hover:p-4", "tw:w-1/2", "tw:!m-0", "tw:bg-(--card)"]);
  for (const t of twTokens(text)) assert.ok(isLiteralToken(t) && !usesDarkVariant(t) && !usesArbitrary(t) && !removesOutline(t), `${t}: 멀쩡한 class가 걸렸다`);
  assert.equal(tokenSelector("tw:md:w-1/2"), ".tw\\:md\\:w-1\\/2");
  assert.deepEqual(builtUtilityTokens(".tw\\:flex{} .tw\\:focus\\:w-1\\/2:focus{} .tw\\:\\!m-0{} .twx{}"), ["tw:flex", "tw:focus:w-1/2", "tw:!m-0"]);

  // dark 변형: 네 갈래 팔레트(자동 라이트·자동 다크·강제 라이트·강제 다크)는 CSS 변수에서 갈린다. dark 변형은 OS 설정만 보므로
  // 사용자가 고른 테마(data-theme)와 어긋난다.
  for (const t of ["tw:dark:hidden", "tw:md:dark:bg-black", "tw:dark:hover:p-1"]) assert.ok(usesDarkVariant(t), `${t}: dark 변형을 못 잡았다`);
  for (const t of ["tw:bg-dark", "tw:darker:p-1", "tw:[.dark_&]:p-1"]) assert.ok(!usesDarkVariant(t), `${t}: dark 변형이 아닌데 걸렸다`);

  // 임의값: 축척(글자 크기·색·간격 토큰) 밖의 값이 class로 들어오는 길이다.
  for (const t of ["tw:p-[3px]", "tw:[&>p]:m-0", "tw:data-[x=y]:flex", "tw:bg-[#fff]"]) assert.ok(usesArbitrary(t), `${t}: 임의값을 못 잡았다`);

  // 조립한 이름: Tailwind는 소스를 글자로 훑으므로 조립한 class에는 규칙이 만들어지지 않는다.
  const assembled = twTokens('`tw:p-${n}` "tw:p-" + n; "tw:" + name; `tw:${a}:flex` tw:flex처럼');
  assert.deepEqual(assembled, ["tw:p-${n}", "tw:p-", "tw:", "tw:${a}:flex", "tw:flex처럼"]);
  for (const t of assembled) assert.ok(!isLiteralToken(t), `${t}: 완전한 리터럴이 아닌데 통과했다`);

  // 초점 표시 지우기(목록의 근거는 helpers/css-source.mjs의 주석 - v4.3.3 출력으로 확정).
  for (const t of ["tw:outline-none", "tw:outline-hidden", "tw:outline-0", "tw:outline-transparent", "tw:focus:outline-none", "tw:focus-visible:outline-hidden", "tw:!outline-none", "tw:outline-none!", "tw:md:hover:outline-0", "tw:outline-black/0"])
    assert.ok(removesOutline(t), `${t}: 초점 표시를 지우는데 못 잡았다`);
  for (const t of ["tw:outline", "tw:outline-2", "tw:outline-offset-2", "tw:outline-dashed", "tw:outline-current", "tw:outline-black/50", "tw:ring-0"]) assert.ok(!removesOutline(t), `${t}: 초점 표시를 지우지 않는데 걸렸다`);
});

// 금지 넷은 같은 모양이다: 훑는 소스(main.css의 @source 목록)의 토큰 중 판정에 걸리는 것이 0개.
const BANS = [
  ["`tw:dark:` 변형을 쓰지 않는다 - 네 갈래 팔레트는 CSS 변수에서 갈린다", usesDarkVariant],
  ["임의값 `tw:…[…]`을 쓰지 않는다", usesArbitrary],
  ["Tailwind class는 소스에 완전한 리터럴로만 쓴다 - `tw:p-${n}` 같은 조립 금지", (t) => !isLiteralToken(t)],
  ["`tw:outline-none` 계열(초점 표시를 지우는 유틸리티)을 쓰지 않는다", removesOutline],
];
for (const [name, bad] of BANS) {
  test(`${name} (#276)`, async () => {
    const files = await scannedFiles();
    assert.ok(files.length > 150, `훑는 소스를 ${files.length}개밖에 못 찾았다`);
    const hits = (await scannedTokens()).filter(({ token }) => bad(token)).map(({ file, token }) => `${file}: ${token}`);
    assert.deepEqual(hits, []);
  });
}

test("Tailwind 바이너리 고정: 버전 하나, 릴리스 자산 일곱의 SHA-256·크기 표, 표에 없는 플랫폼은 거절", () => {
  assert.match(TAILWIND_VERSION, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(TAILWIND_ASSETS).sort(), ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-arm64-musl", "linux-x64", "linux-x64-musl", "win32-x64"]);
  for (const [key, a] of Object.entries(TAILWIND_ASSETS)) {
    assert.match(a.sha256, /^[0-9a-f]{64}$/, `${key}: SHA-256 64자리`);
    assert.ok(Number.isInteger(a.bytes) && a.bytes > 50e6, `${key}: 크기`);
    assert.match(a.file, /^tailwindcss-[a-z0-9.-]+$/, `${key}: 자산 이름`);
  }
  assert.equal(new Set(Object.values(TAILWIND_ASSETS).map((a) => a.sha256)).size, 7, "해시가 겹친다(복사해 붙인 줄)");
  // CI(ubuntu-latest)와 소유자 머신(Apple Silicon)의 열쇠.
  assert.equal(platformKey({ platform: "linux", arch: "x64", musl: false }), "linux-x64");
  assert.equal(platformKey({ platform: "linux", arch: "arm64", musl: true }), "linux-arm64-musl");
  assert.equal(platformKey({ platform: "darwin", arch: "arm64" }), "darwin-arm64");
  assert.equal(assetFor("linux-x64").url, `https://github.com/tailwindlabs/tailwindcss/releases/download/v${TAILWIND_VERSION}/tailwindcss-linux-x64`);
  assert.throws(() => assetFor("freebsd-x64"), /해시 표에 이 플랫폼/);
  // 캐시는 저장소 밖이다 - 안에 두면 tools/golden의 작업 트리 스냅숏이 바이너리까지 복사한다.
  for (const env of [{}, { XDG_CACHE_HOME: path.join(os.tmpdir(), "xdg") }]) assert.ok(path.relative(root, cacheDir(env)).startsWith(".."), "캐시 폴더가 저장소 안이다");
  assert.equal(cacheDir({ TAILWIND_CACHE_DIR: "/x/y" }), "/x/y");
});

// 가짜 자산과 가짜 fetch로 내려받기 경로를 돈다(네트워크 없음).
const fakeAsset = (body, over = {}) => ({ file: "tailwindcss-fake", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), url: "https://example.invalid/tailwindcss-fake", ...over });
const fakeFetch = (body, { status = 200, url = "https://example.invalid/tailwindcss-fake" } = {}) => {
  const calls = [];
  const impl = async (u) => {
    calls.push(u);
    return { ok: status >= 200 && status < 300, status, url, body: (async function* () { yield body.subarray(0, 3); yield body.subarray(3); })() };
  };
  return { impl, calls };
};

test("Tailwind 바이너리 내려받기: 해시가 맞을 때만 제 이름을 갖고, 불일치·크기 초과·HTTP 오류·캐시 변조는 실패한다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jipgye-css-test-"));
  const log = () => {};
  try {
    const body = Buffer.from("#!/bin/sh\necho fake\n");
    const dest = (sub) => path.join(dir, sub, `v${TAILWIND_VERSION}`, "tailwindcss-fake");
    const leftovers = async (sub) => (await readdir(path.dirname(dest(sub))).catch(() => [])).sort();

    // 정상: 받아서 검증하고 실행 권한을 준다. 두 번째는 받지 않고 캐시를 다시 검증한다.
    const ok = fakeFetch(body);
    const file = await ensureBinary({ asset: fakeAsset(body), dir: path.join(dir, "ok"), fetchImpl: ok.impl, log });
    assert.equal(file, dest("ok"));
    assert.deepEqual(await readFile(file), body);
    assert.ok((await stat(file)).mode & 0o100, "실행 권한이 없다");
    await ensureBinary({ asset: fakeAsset(body), dir: path.join(dir, "ok"), fetchImpl: ok.impl, log });
    assert.equal(ok.calls.length, 1, "캐시가 있는데 다시 받았다");
    assert.deepEqual(await leftovers("ok"), ["tailwindcss-fake"], "임시 파일이 남았다");

    // 캐시된 파일이 바뀌었다(크기는 같고 한 글자 다름): 다시 받지 않고 실패한다.
    await writeFile(file, Buffer.from("#!/bin/sh\necho fakE\n"));
    await chmod(file, 0o755);
    await assert.rejects(ensureBinary({ asset: fakeAsset(body), dir: path.join(dir, "ok"), fetchImpl: ok.impl, log }), /SHA-256이 .*캐시된 파일이 표와 다릅니다/s);
    assert.equal(ok.calls.length, 1, "변조된 캐시를 조용히 다시 받았다");

    // 받은 내용의 해시가 표와 다르다: 한 번에 실패하고(다시 받지 않는다) 제 이름의 파일도 임시 파일도 남기지 않는다.
    const wrongHash = fakeFetch(body);
    await assert.rejects(ensureBinary({ asset: fakeAsset(body, { sha256: "0".repeat(64) }), dir: path.join(dir, "hash"), fetchImpl: wrongHash.impl, log }), /SHA-256이 .*실행하지 않습니다/s);
    assert.equal(wrongHash.calls.length, 1);
    assert.deepEqual(await leftovers("hash"), []);

    // 표의 크기보다 많이 온다 / 적게 온다.
    const tooBig = fakeFetch(body);
    await assert.rejects(ensureBinary({ asset: fakeAsset(body, { bytes: body.length - 1 }), dir: path.join(dir, "big"), fetchImpl: tooBig.impl, log }), /내려받기 실패: 표의 크기/);
    assert.deepEqual(await leftovers("big"), []);
    await assert.rejects(ensureBinary({ asset: fakeAsset(body, { bytes: body.length + 1 }), dir: path.join(dir, "small"), fetchImpl: fakeFetch(body).impl, log }), /크기가 \d+바이트입니다/);
    assert.deepEqual(await leftovers("small"), []);

    // HTTP 오류: 세 번 해 보고 실패한다. https 밖으로 넘어가도 실패한다.
    const notFound = fakeFetch(body, { status: 404 });
    await assert.rejects(ensureBinary({ asset: fakeAsset(body), dir: path.join(dir, "404"), fetchImpl: notFound.impl, log }), /내려받기 실패: HTTP 404/);
    assert.equal(notFound.calls.length, 3);
    await assert.rejects(ensureBinary({ asset: fakeAsset(body), dir: path.join(dir, "http"), fetchImpl: fakeFetch(body, { url: "http://example.invalid/x" }).impl, log }), /https가 아닌 주소/);
    assert.deepEqual(await leftovers("http"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("신선도 대조(--check의 속): 다시 만든 것이 커밋된 산출물과 한 바이트라도 다르면 다르다고 한다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jipgye-css-test-"));
  try {
    // Tailwind 대신 정해진 글자를 --output에 쓰는 가짜 실행 파일.
    const bin = path.join(dir, "fake-tailwind");
    await writeFile(bin, `#!/usr/bin/env node\nconst a = process.argv; require("node:fs").writeFileSync(a[a.indexOf("--output") + 1], "a{b:c}\\n" + a[a.indexOf("--input") + 1] + "\\n");\n`);
    await chmod(bin, 0o755);
    await mkdir(path.join(dir, "docs"));
    await writeFile(path.join(dir, OUTPUT), `a{b:c}\n${INPUT}\n`);
    assert.equal((await checkFresh(bin, { cwd: dir })).same, true);
    await writeFile(path.join(dir, OUTPUT), `a{b:c}\n${INPUT}\n\n`);
    const stale = await checkFresh(bin, { cwd: dir });
    assert.equal(stale.same, false, "끝의 줄바꿈 하나 차이를 같다고 했다");
    assert.equal(stale.committed.length - stale.built.length, 1);
    // 실행 파일이 실패하면 던진다(같다고 하지 않는다).
    await writeFile(bin, "#!/bin/sh\necho 고장 >&2\nexit 3\n");
    await assert.rejects(checkFresh(bin, { cwd: dir }), /Tailwind가 3로 끝났습니다/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("워크플로: test.yml이 산출물 신선도를 대조하고, 수집·렌더·배포 워크플로는 CSS를 만들지 않는다 (#276 범위 6·7)", async () => {
  const wf = (name) => read(`.github/workflows/${name}`);
  const testYml = await wf("test.yml");
  assert.match(testYml, /node scripts\/build-css\.mjs --check/, "test.yml에 신선도 스텝이 없다");
  assert.match(testYml, /TAILWIND_CACHE_DIR: \$\{\{ runner\.temp \}\}\//, "바이너리를 작업 폴더 밖($RUNNER_TEMP)에 받지 않는다");
  // 워크플로에는 해시를 다시 적지 않는다 - 고정 값은 scripts/build-css.mjs의 표 한 곳이다(두 곳이면 한쪽만 고쳐진다).
  for (const a of Object.values(TAILWIND_ASSETS)) assert.ok(!testYml.includes(a.sha256), "test.yml에 Tailwind 해시가 따로 적혀 있다");
  // 일일 경로는 틀에 데이터를 심을 뿐이다. 여기에 CSS 빌드가 들어가면 무인 실행이 80MB 내려받기에 기대게 된다.
  for (const name of (await readdir(path.join(root, ".github/workflows"))).filter((f) => f !== "test.yml")) {
    assert.doesNotMatch(await wf(name), /build-css|tailwind/i, `${name}이 CSS를 만든다`);
  }
  // 67장이 부르는 자리와 서비스워커 캐시 목록은 그대로다 - 산출 위치를 docs/style.css로 두는 이유.
  assert.equal(OUTPUT, "docs/style.css");
  assert.match(await read("docs/sw.js"), /"\.\/style\.css",/);
});
