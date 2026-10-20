#!/usr/bin/env node
// 두 디렉터리의 .html을 정준 덤프로 견준다. 같으면 종료 0, 다르면 1.
//   node bin/compare.ts <dirA> <dirB> [--no-class-style] [--bytes] [--max-hunks N] [--max-lines N]
//   --bytes           정준 비교 대신(뒤에 덧붙여) 모든 파일을 바이트로도 견준다.
//   --no-class-style  내용 비교 모드(#277). class·style **두 속성만** 덤프에서 빼고 나머지는 그대로 견준다.
//                     기본 모드(이 플래그가 없을 때)는 손대지 않았다 — class 한 글자가 달라도 종료 1이다.
//                     --bytes는 이 모드와 무관하다(바이트 비교는 언제나 글자 그대로다).
import { compareBytes, compareDirs, formatReport } from "../lib/compare.ts";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args.splice(i, 2)[1];
  return Number(v);
};
const maxHunks = flag("--max-hunks", 3);
const maxLines = flag("--max-lines", 6);
const take = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const bytes = take("--bytes");
const ignoreDesignAttrs = take("--no-class-style");
const [a, b] = args;
if (!a || !b) {
  console.error("사용: node bin/compare.ts <dirA> <dirB> [--no-class-style] [--bytes] [--max-hunks N] [--max-lines N]");
  process.exit(2);
}
const result = await compareDirs(a, b, { ignoreDesignAttrs });
console.log(`비교 모드: ${ignoreDesignAttrs ? "내용(class·style 제외)" : "기본(모든 속성)"}`);
console.log(formatReport(result, { maxHunks, maxLines }));
let bad = result.failing.length > 0;
if (bytes) {
  const raw = await compareBytes(a, b);
  console.log(`바이트 비교: ${raw.same}/${raw.total}개 일치${raw.diffs.length ? `, 불일치 ${raw.diffs.map((d) => `${d.file}(${d.status})`).join(", ")}` : ""}`);
  bad ||= raw.diffs.length > 0;
}
process.exit(bad ? 1 : 0);
