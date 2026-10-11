#!/usr/bin/env node
// 두 디렉터리의 .html을 정준 덤프로 견준다. 같으면 종료 0, 다르면 1.
//   node bin/compare.mjs <dirA> <dirB> [--bytes] [--max-hunks N] [--max-lines N]
//   --bytes  정준 비교 대신(뒤에 덧붙여) 모든 파일을 바이트로도 견준다.
import { compareBytes, compareDirs, formatReport } from "../lib/compare.mjs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args.splice(i, 2)[1];
  return Number(v);
};
const maxHunks = flag("--max-hunks", 3);
const maxLines = flag("--max-lines", 6);
const bytesAt = args.indexOf("--bytes");
const bytes = bytesAt >= 0;
if (bytes) args.splice(bytesAt, 1);
const [a, b] = args;
if (!a || !b) {
  console.error("사용: node bin/compare.mjs <dirA> <dirB> [--bytes] [--max-hunks N] [--max-lines N]");
  process.exit(2);
}
const result = await compareDirs(a, b);
console.log(formatReport(result, { maxHunks, maxLines }));
let bad = result.failing.length > 0;
if (bytes) {
  const raw = await compareBytes(a, b);
  console.log(`바이트 비교: ${raw.same}/${raw.total}개 일치${raw.diffs.length ? `, 불일치 ${raw.diffs.map((d) => `${d.file}(${d.status})`).join(", ")}` : ""}`);
  bad ||= raw.diffs.length > 0;
}
process.exit(bad ? 1 : 0);
