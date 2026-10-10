/**
 * 사전 등록 순서 확인 (#133 완료 조건 1). 첫 실호출 전에 PREREG 커밋이 먼저임을 git 이력으로 확인한다.
 *
 *   node scripts/check-prereg-order.mjs --prereg <40자리 해시> [--prereg-path research/housing-permits/PREREG.md]
 *     [--output research/housing-permits/folded.json]
 *
 * 세 가지를 본다. (1) 해시가 40자리 전체이고 그 커밋에 PREREG 파일이 있다. (2) 그 커밋이 현재 HEAD의 조상이다
 * (git merge-base --is-ancestor; GitHub compare의 "ahead"와 같은 뜻이며 토큰이 필요 없다). (3) 결과 파일을
 * 건드린 커밋이 하나라도 있으면 모두 그 커밋의 후손이다 - 결과가 사전 등록보다 먼저 올라간 적이 없다.
 * 이력이 얕으면(fetch-depth 기본값) 틀리므로 워크플로는 fetch-depth: 0으로 받는다.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { parseArgs } from "node:util";

const execFileAsync = promisify(execFile);
const git = async (...args) => (await execFileAsync("git", args)).stdout.trim();
const ok = (...args) => execFileAsync("git", args).then(() => true, () => false);

class OrderError extends Error {}

export async function checkOrder({ prereg, preregPath, output }) {
  if (!/^[0-9a-f]{40}$/.test(prereg)) throw new OrderError(`PREREG 해시가 40자리 전체가 아니다: ${prereg}`);
  if (!(await ok("cat-file", "-e", `${prereg}:${preregPath}`))) throw new OrderError(`${prereg}에 ${preregPath}가 없다`);
  if (!(await ok("merge-base", "--is-ancestor", prereg, "HEAD"))) throw new OrderError(`PREREG 커밋 ${prereg}이 현재 기록의 조상이 아니다`);
  const touching = (await git("log", "--format=%H", "--", output)).split("\n").filter(Boolean);
  for (const sha of touching) {
    if (sha === prereg || !(await ok("merge-base", "--is-ancestor", prereg, sha))) throw new OrderError(`${output}를 바꾼 커밋 ${sha}이 PREREG보다 먼저(또는 무관하게) 올라갔다`);
  }
  return { touching: touching.length };
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      prereg: { type: "string" },
      "prereg-path": { type: "string", default: "research/housing-permits/PREREG.md" },
      output: { type: "string", default: "research/housing-permits/folded.json" },
    },
  });
  const r = await checkOrder({ prereg: v.prereg ?? "", preregPath: v["prereg-path"], output: v.output });
  console.log(`[check-prereg-order] 확인: PREREG ${v.prereg}가 HEAD의 조상이고, ${v.output}를 바꾼 커밋 ${r.touching}개는 모두 그 뒤다`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => { console.error(`[check-prereg-order] ${err.message}`); process.exitCode = 1; });
}
