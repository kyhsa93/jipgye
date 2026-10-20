// 동시 실행 시험용: 별도 프로세스에서 같은 SHA의 캐시를 만들고 경로를 출력한다.
//   node prepare.ts <repo> <sha> <cacheDir>
import { preparePristine } from "../../lib/render.ts";

const [repo, sha, cacheDir] = process.argv.slice(2);
const p = await preparePristine({ repo, sha, cacheDir, minFreeBytes: 0 });
console.log(p.dir);
