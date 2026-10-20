// JSX를 읽는 자작 로더 (#237). esbuild의 build API로 진입 파일 하나를 ESM 한 장으로 묶어 import한다.
//
// Node의 `--loader`·`--experimental-loader` 플래그와 `module.register`(훅)를 쓰지 않는다 - 그쪽은 Node 20·22·24에서
// 동작이 바뀌어 왔다(#237). 쓰는 것은 esbuild의 JS API와 평범한 동적 import뿐이다.
//
// - `packages: "external"`: react·react-dom 같은 bare import는 묶지 않고 저장소의 node_modules에서 읽는다.
//   그래야 렌더가 도는 react가 하나다. 상대경로 import(우리 코드)는 묶여 들어간다 - 그래서 JSX가 부르는 파일은 순수해야 한다.
// - 산출물은 `node_modules/.cache/` 아래 임시 폴더에 쓰고 import한 뒤 지운다. bare import를 풀려면 node_modules 안쪽이어야 하고,
//   docs/ 밖이라 배포로 나가지 않는다(S6).
// - 실패는 삼키지 않는다. 컴파일 오류·import 오류는 그대로 던진다(폴백은 #238의 일).
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const CACHE_DIR = path.join(root, "node_modules/.cache/jipgye-render");
// JSX가 이 둘을 (간접으로라도) 부르면 묶인 사본이 렌더러를 또 만들어 끝없이 돈다.
const FORBIDDEN = ["scripts/renderer.ts", "scripts/prerender.mjs"];

export async function loadJsxModule(entry, { cacheDir = CACHE_DIR } = {}) {
  const { build } = await import("esbuild");
  await mkdir(cacheDir, { recursive: true });
  const dir = await mkdtemp(path.join(cacheDir, "jsx-"));
  const outfile = path.join(dir, "entry.mjs");
  try {
    const { metafile } = await build({
      entryPoints: [path.resolve(entry)],
      outfile,
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node20",
      jsx: "automatic",
      metafile: true,
      logLevel: "silent",
    });
    const bad = Object.keys(metafile.inputs).filter((f) => FORBIDDEN.some((x) => f.endsWith(x)));
    if (bad.length) throw new Error(`JSX 진입 파일이 렌더러 스위치를 불러옵니다(${bad.join(", ")}). 공용 함수는 따로 뺀 파일에서 가져오세요.`);
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
