#!/usr/bin/env node
// 스타일시트를 만든다(#276): src/css/main.css → docs/style.css. Tailwind v4의 단독 실행 파일로 돌린다.
//
//   node scripts/build-css.mjs            다시 만들어 docs/style.css에 쓴다(고친 뒤 함께 커밋한다)
//   node scripts/build-css.mjs --check    임시 폴더에 다시 만들어 커밋된 docs/style.css와 바이트를 대조한다(다르면 종료 1)
//
// 언제 도는가: CSS 소스(src/css/)나 class를 쓰는 소스(main.css의 @source 목록)를 고친 사람이 손으로 돌린다.
// 수집·렌더(daily-update·summarize)는 CSS를 만들지 않는다 - 틀에 데이터를 심을 뿐이라 이 스크립트를 부르지 않는다.
// 낡은 산출물이 main에 들어오는 것은 test.yml의 --check 스텝이 막는다.
//
// 왜 npm 패키지가 아니라 단독 실행 파일인가: 루트 의존을 늘리지 않는다(package.json·락파일 불변, #276 "공통 불변").
// 대신 `npm audit`가 이 바이너리를 보지 못하므로 아래 고정 규칙을 사람이 지킨다.
//
// 고정 규칙(test.yml의 actionlint와 같은 모양: 버전 + SHA-256, 불일치면 실패):
//   - 버전과 플랫폼별 SHA-256·크기를 아래 표에 상수로 둔다. 표에 없는 플랫폼에서는 돌지 않는다.
//   - 받은 파일은 물론이고 캐시에 있던 파일도 **실행 전마다** 해시를 다시 잰다. 다르면 실행하지 않고 실패한다.
//   - 내려받기에 실패해도 실패한다. 조용히 건너뛰는 길은 없다.
//   - 바이너리는 저장소에 커밋하지 않는다. 캐시는 저장소 밖에 둔다(아래 cacheDir) - 저장소 안에 두면
//     tools/golden의 작업 트리 스냅숏(rsync)이 80MB짜리 파일을 렌더마다 복사한다.
//   - 버전을 올리는 것은 이 표를 고치는 PR로만 한다. 그때 릴리스 노트의 보안 항목을 읽고, 해시는 아래 두 출처에서
//     다시 가져와 서로 맞는지 본 뒤 적는다. 산출물(docs/style.css)이 바뀌면 같은 PR에서 화면이 같은지 다시 증빙한다.
//
// 해시 출처(2026-10-12 확인, 릴리스 게시 2026-07-16). 두 곳의 값이 일곱 자산 모두 같았다.
//   1. https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/sha256sums.txt
//   2. `gh api repos/tailwindlabs/tailwindcss/releases/tags/v4.3.3`의 assets[].digest (크기는 assets[].size)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const TAILWIND_VERSION = "4.3.3";

/** 플랫폼 열쇠(`process.platform-process.arch`, 리눅스 musl은 `-musl`) → 릴리스 자산. */
export const TAILWIND_ASSETS = {
  "darwin-arm64": { file: "tailwindcss-macos-arm64", bytes: 79826018, sha256: "cdf646702987a743464dff4d9c60fd4480d1c1e73dd819a9a67f1078815dce9d" },
  "darwin-x64": { file: "tailwindcss-macos-x64", bytes: 83656784, sha256: "7922e0953f2110c05976e3bf58f14e643d90427575e766b7d433f5f80cbee7e1" },
  "linux-arm64": { file: "tailwindcss-linux-arm64", bytes: 109881488, sha256: "55fd0b241214eff3de1e8ee4f22796662f2d2e7a49bcfca7477cfd0bac398195" },
  "linux-arm64-musl": { file: "tailwindcss-linux-arm64-musl", bytes: 105492344, sha256: "71ea4be79c9de9827545682df3e040053fb535d37c71ed2cfdedf9385a0868e0" },
  "linux-x64": { file: "tailwindcss-linux-x64", bytes: 111749248, sha256: "dc61b3ac6b8c9ca874c0cc4c57b2409791a64c5540404ca5f5367360babc313a" },
  "linux-x64-musl": { file: "tailwindcss-linux-x64-musl", bytes: 108529952, sha256: "a04d34ceacc8f52cbe8920ad846cdeb61d3d0021dba32db0d1f77c9d9fad7a6c" },
  "win32-x64": { file: "tailwindcss-windows-x64.exe", bytes: 112503296, sha256: "e0e260ce048014e9268f6237ff18f8ccf02cef521cbd0ae04e82c2cdf7aa3955" },
};

export const INPUT = "src/css/main.css";
export const OUTPUT = "docs/style.css";

const root = path.resolve(import.meta.dirname, "..");
const RETRIES = 3;

/** 이 프로세스의 플랫폼 열쇠. glibc 버전이 보고서에 없는 리눅스는 musl로 본다(Alpine). */
export function platformKey({ platform = process.platform, arch = process.arch, musl = null } = {}) {
  const isMusl = musl ?? (platform === "linux" && !process.report?.getReport?.().header?.glibcVersionRuntime);
  return `${platform}-${arch}${platform === "linux" && isMusl ? "-musl" : ""}`;
}

/** 열쇠에 맞는 자산과 내려받을 주소. 표에 없으면 던진다(다른 플랫폼의 파일로 대신하지 않는다). */
export function assetFor(key = platformKey()) {
  const asset = TAILWIND_ASSETS[key];
  if (!asset) throw new Error(`Tailwind v${TAILWIND_VERSION} 단독 실행 파일의 해시 표에 이 플랫폼(${key})이 없습니다. 표에 있는 것: ${Object.keys(TAILWIND_ASSETS).join(", ")}`);
  return { ...asset, key, url: `https://github.com/tailwindlabs/tailwindcss/releases/download/v${TAILWIND_VERSION}/${asset.file}` };
}

/** 바이너리를 두는 곳. 저장소 밖이다. `TAILWIND_CACHE_DIR`로 바꿀 수 있다(CI는 $RUNNER_TEMP 아래를 준다). */
export function cacheDir(env = process.env) {
  return env.TAILWIND_CACHE_DIR || path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "jipgye", "tailwindcss");
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** 파일의 크기와 SHA-256이 표와 같은지. 다르면 무엇이 다른지 적어 던진다. */
export async function verifyBinary(file, asset) {
  const { size } = await stat(file);
  if (size !== asset.bytes) throw new Error(`${file}: 크기가 ${size}바이트입니다(표는 ${asset.bytes}). 실행하지 않습니다.`);
  const actual = await sha256File(file);
  if (actual !== asset.sha256) throw new Error(`${file}: SHA-256이 ${actual}입니다(표는 ${asset.sha256}). 실행하지 않습니다.`);
}

// 임시 이름으로 받아 해시가 맞을 때만 제 이름으로 옮긴다 - 받다 만 파일이나 다른 내용의 파일이 제 이름을 갖는 순간이 없다.
// 해시 불일치는 다시 받지 않고 바로 실패한다(같은 주소가 다른 내용을 준다는 뜻이다). 다시 해 보는 것은 통신 오류뿐이다.
async function download(asset, dest, { fetchImpl = fetch, log = console.error } = {}) {
  await mkdir(path.dirname(dest), { recursive: true });
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const tmp = `${dest}.${process.pid}.${attempt}.part`;
    try {
      log(`Tailwind v${TAILWIND_VERSION} ${asset.file} 내려받기(${attempt}/${RETRIES}): ${asset.url}`);
      const res = await fetchImpl(asset.url, { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      if (res.url && !res.url.startsWith("https://")) throw new Error(`https가 아닌 주소로 넘어갔습니다: ${res.url}`);
      const out = await open(tmp, "w");
      try {
        let received = 0;
        for await (const chunk of res.body) {
          received += chunk.length;
          if (received > asset.bytes) throw new Error(`표의 크기(${asset.bytes}바이트)보다 많이 옵니다`);
          await out.write(chunk);
        }
      } finally {
        await out.close();
      }
    } catch (e) {
      await rm(tmp, { force: true });
      lastError = e;
      continue;
    }
    try {
      await verifyBinary(tmp, asset);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    await chmod(tmp, 0o755);
    await rename(tmp, dest);
    return;
  }
  throw new Error(`${asset.url} 내려받기 실패: ${lastError?.message ?? lastError}`);
}

/** 검증된 바이너리의 경로. 캐시에 없으면 받는다. 캐시에 있던 것도 해시를 다시 잰다. asset·fetchImpl은 시험이 갈아 끼운다. */
export async function ensureBinary({ asset = assetFor(), dir = cacheDir(), fetchImpl, log } = {}) {
  const file = path.join(dir, `v${TAILWIND_VERSION}`, asset.file);
  const cached = await stat(file).then(
    () => true,
    () => false
  );
  if (cached) {
    // 캐시된 파일이 표와 다르면 지우고 다시 받지 않는다 - 누가 바꿨는지 사람이 봐야 한다.
    await verifyBinary(file, asset).catch((e) => {
      throw new Error(`${e.message} 캐시된 파일이 표와 다릅니다. 원인을 본 뒤 그 파일을 지우고 다시 돌리세요.`);
    });
  } else await download(asset, file, { fetchImpl, log });
  return file;
}

/** 진입 파일을 빌드해 outFile에 쓴다. 압축·최적화 옵션은 주지 않는다 - 커밋 산출물은 읽을 수 있는 모양으로 둔다. */
export function runTailwind(bin, outFile, { cwd = root } = {}) {
  const r = spawnSync(bin, ["--input", INPUT, "--output", outFile], { cwd, encoding: "utf8" });
  if (r.error) throw new Error(`Tailwind 실행 실패: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`Tailwind가 ${r.status}로 끝났습니다:\n${r.stdout}${r.stderr}`);
}

/** 임시 폴더에 다시 만든 것과 커밋된 산출물이 같은지. 반환: { same, built, committed }(Buffer). */
export async function checkFresh(bin, { cwd = root } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "jipgye-css-"));
  try {
    const out = path.join(tmp, "style.css");
    runTailwind(bin, out, { cwd });
    const [built, committed] = await Promise.all([readFile(out), readFile(path.join(cwd, OUTPUT))]);
    return { same: built.equals(committed), built, committed };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length) {
    console.error(`모르는 인자: ${unknown.join(" ")}\n사용: node scripts/build-css.mjs [--check]`);
    process.exit(2);
  }
  try {
    const bin = await ensureBinary();
    if (args.includes("--check")) {
      const { same, built, committed } = await checkFresh(bin);
      if (!same) {
        // 어디서부터 다른지 한 줄만 보인다. 전체 차이는 다시 만든 뒤 `git diff docs/style.css`로 본다.
        const a = committed.toString("utf8").split("\n");
        const b = built.toString("utf8").split("\n");
        const at = a.findIndex((line, i) => line !== b[i]);
        const line = at === -1 ? a.length : at;
        console.error(`${OUTPUT}가 소스와 맞지 않습니다(커밋된 것 ${committed.length}바이트, 다시 만든 것 ${built.length}바이트).`);
        console.error(`처음 다른 줄 ${line + 1}:\n  커밋: ${a[line] ?? "(없음)"}\n  빌드: ${b[line] ?? "(없음)"}`);
        console.error("`node scripts/build-css.mjs`를 돌려 다시 만든 것을 함께 커밋하세요. 산출물을 손으로 고쳤다면 src/css/에서 고칩니다.");
        process.exit(1);
      }
      console.log(`${OUTPUT}: 소스로 다시 만든 것과 같습니다(${committed.length}바이트, Tailwind v${TAILWIND_VERSION} ${platformKey()}).`);
    } else {
      runTailwind(bin, OUTPUT);
      const { size } = await stat(path.join(root, OUTPUT));
      console.log(`${OUTPUT}: ${size}바이트(Tailwind v${TAILWIND_VERSION} ${platformKey()}).`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
