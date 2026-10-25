// 캐시 폴더 시험용(#605): 별도 프로세스가 **환경변수만으로** 캐시 위치를 정해 SHA 캐시를 만들고 경로를 출력한다.
//   GOLDEN_CACHE_DIR=<작업> GOLDEN_SHA_CACHE_DIR=<공유> node prepare-env.ts <repo> <sha|--src>
import { preparePristine } from "../../lib/render.ts";

const [repo, sha] = process.argv.slice(2);
const p = await preparePristine(sha === "--src" ? { srcDir: repo, minFreeBytes: 0 } : { repo, sha, minFreeBytes: 0 });
console.log(p.dir);
await p.dispose();
